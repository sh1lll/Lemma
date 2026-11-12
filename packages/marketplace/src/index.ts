import { validateManifest, type PluginManifest } from '@lemma/plugin-engine';
import { TRUSTED_KEYS } from './keys';

/**
 * The Lemma extension marketplace: a signed, static index that any static host (or the app's bundled copy)
 * can serve. No server code runs.
 *
 *   site/index.json                      signed envelope { keyId, signature, index }
 *   site/manifests/<id>/<release>.json   one file per extension version (immutable)
 *
 * The index lists each extension with the SHA-256 of its manifest (canonical JSON). The whole index is signed
 * with Ed25519; the app ships the public key. So a host (or anyone in the middle) can't change a listing or a
 * manifest without the app noticing, and installing still goes through the app's own approval for scripts.
 *
 * Browser-safe: WebCrypto only.
 */

export { TRUSTED_KEYS };

export const INDEX_FORMAT = 'lemma-marketplace';
export const SIGNED_FORMAT = 'lemma-marketplace-signed';

export const CATEGORIES = {
  'health-fitness': 'Health & fitness',
  'home-diy': 'Home & DIY',
  travel: 'Travel & driving',
  money: 'Money',
  'science-tech': 'Science & tech',
  cooking: 'Cooking',
  'numbers-text': 'Numbers & text',
} as const;
export type Category = keyof typeof CATEGORIES;

export interface MarketplaceEntry {
  id: string;
  name: string;
  description: string;
  kind: 'formula' | 'script';
  category: Category;
  release: string;
  author: string;
  /** Example inputs, for display and search. */
  examples: string[];
  /** Script extensions: requested network hosts. */
  permissions: string[];
  /** Relative to index.json. */
  path: string;
  /** SHA-256 hex of canonicalJson(manifest). */
  sha256: string;
  size: number;
}

export interface MarketplaceIndex {
  format: typeof INDEX_FORMAT;
  version: 1;
  /** ISO time the index was built; clients refuse an online index older than one they've already seen. */
  generated: string;
  entries: MarketplaceEntry[];
}

export interface SignedIndex {
  format: typeof SIGNED_FORMAT;
  version: 1;
  keyId: string;
  /** Base64 Ed25519 signature over UTF-8 canonicalJson(index). */
  signature: string;
  index: MarketplaceIndex;
}

/** What the app bundles for offline use: the signed index plus every manifest it lists. */
export interface MarketplaceBundle {
  signed: SignedIndex;
  manifests: Record<string, unknown>;
}

export class MarketplaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarketplaceError';
  }
}

/** Stable JSON: object keys sorted, no whitespace. Signatures and hashes are computed over this. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new MarketplaceError('non-finite number');
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new MarketplaceError('WebCrypto is not available');
  return s;
};

export async function sha256Hex(text: string): Promise<string> {
  const d = new Uint8Array(await subtle().digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toBase64(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

let edSupport: Promise<boolean> | null = null;
/** Ed25519 in WebCrypto: Chrome/Edge 137+, Firefox 129+, Safari 17+, Node 20+. */
export function ed25519Supported(): Promise<boolean> {
  edSupport ??= (async () => {
    try {
      await subtle().importKey('raw', new Uint8Array(32), { name: 'Ed25519' }, false, ['verify']);
      return true;
    } catch {
      return false;
    }
  })();
  return edSupport;
}

const ENTRY_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;
const HEX64 = /^[0-9a-f]{64}$/;
const SAFE_PATH = /^manifests\/[a-z0-9.-]+\/[0-9A-Za-z.+-]+\.json$/;

function checkIndexShape(index: unknown): MarketplaceIndex {
  const i = index as MarketplaceIndex;
  if (!i || typeof i !== 'object' || i.format !== INDEX_FORMAT || i.version !== 1) throw new MarketplaceError('Not an Lemma marketplace index');
  if (typeof i.generated !== 'string' || Number.isNaN(Date.parse(i.generated))) throw new MarketplaceError('Index has no valid build time');
  if (!Array.isArray(i.entries) || i.entries.length > 5000) throw new MarketplaceError('Index entries are missing or too many');
  const ids = new Set<string>();
  for (const e of i.entries) {
    if (!e || typeof e.id !== 'string' || !ENTRY_ID.test(e.id) || ids.has(e.id)) throw new MarketplaceError(`Bad or duplicate entry id "${String(e?.id)}"`);
    ids.add(e.id);
    if (!HEX64.test(e.sha256) || typeof e.path !== 'string' || !SAFE_PATH.test(e.path)) throw new MarketplaceError(`Entry ${e.id} has a bad hash or path`);
    if (!(e.category in CATEGORIES)) throw new MarketplaceError(`Entry ${e.id} has an unknown category`);
    if (e.kind !== 'formula' && e.kind !== 'script') throw new MarketplaceError(`Entry ${e.id} has an unknown kind`);
    for (const k of ['name', 'description', 'release', 'author'] as const) if (typeof e[k] !== 'string') throw new MarketplaceError(`Entry ${e.id} is missing ${k}`);
    if (!Array.isArray(e.examples) || !Array.isArray(e.permissions)) throw new MarketplaceError(`Entry ${e.id} is malformed`);
  }
  return i;
}

/**
 * Verifies a signed index against the trusted keys and returns the index. Throws MarketplaceError when the
 * signature is missing, made with an unknown key, or doesn't match (any change to any byte of the listing).
 */
export async function verifySignedIndex(raw: unknown, keys: Record<string, string> = TRUSTED_KEYS): Promise<MarketplaceIndex> {
  const s = raw as SignedIndex;
  if (!s || typeof s !== 'object' || s.format !== SIGNED_FORMAT || s.version !== 1) throw new MarketplaceError('Not a signed Lemma marketplace index');
  if (typeof s.keyId !== 'string' || !Object.prototype.hasOwnProperty.call(keys, s.keyId)) throw new MarketplaceError('Index is signed with a key this app doesn’t trust');
  if (typeof s.signature !== 'string') throw new MarketplaceError('Index is not signed');
  if (!(await ed25519Supported())) throw new MarketplaceError('This browser can’t verify Ed25519 signatures');
  let sig: Uint8Array<ArrayBuffer>;
  let pub: Uint8Array<ArrayBuffer>;
  try {
    sig = fromBase64(s.signature);
    pub = fromBase64(keys[s.keyId]!);
  } catch {
    throw new MarketplaceError('Malformed signature');
  }
  const key = await subtle().importKey('raw', pub, { name: 'Ed25519' }, false, ['verify']);
  const ok = await subtle().verify({ name: 'Ed25519' }, key, sig, new TextEncoder().encode(canonicalJson(s.index)));
  if (!ok) throw new MarketplaceError('The marketplace index signature doesn’t match; it may have been altered');
  return checkIndexShape(s.index);
}

/** Checks a downloaded manifest against its index entry (hash, id, release), then validates it as an extension. */
export async function verifyManifest(entry: MarketplaceEntry, raw: unknown): Promise<PluginManifest> {
  const hash = await sha256Hex(canonicalJson(raw));
  if (hash !== entry.sha256) throw new MarketplaceError(`“${entry.name}” doesn’t match the signed index (hash mismatch); not installed`);
  const m = validateManifest(raw);
  if (m.id !== entry.id || m.release !== entry.release || m.kind !== entry.kind) throw new MarketplaceError(`“${entry.name}” doesn’t match its listing`);
  return m;
}

/** Compares dotted releases numerically ("1.10.0" > "1.9.2"); non-numeric parts compare as text. */
export function compareReleases(a: string, b: string): number {
  const pa = a.split(/[.+-]/);
  const pb = b.split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0';
    const y = pb[i] ?? '0';
    const nx = /^\d+$/.test(x) ? Number(x) : NaN;
    const ny = /^\d+$/.test(y) ? Number(y) : NaN;
    const c = !Number.isNaN(nx) && !Number.isNaN(ny) ? nx - ny : x < y ? -1 : x > y ? 1 : 0;
    if (c) return Math.sign(c);
  }
  return 0;
}

/** Installed extensions with a newer release in the index. */
export function findUpdates(installed: readonly { id: string; release: string }[], index: MarketplaceIndex): { id: string; from: string; to: MarketplaceEntry }[] {
  const byId = new Map(index.entries.map((e) => [e.id, e]));
  return installed.flatMap((m) => {
    const e = byId.get(m.id);
    return e && compareReleases(e.release, m.release) > 0 ? [{ id: m.id, from: m.release, to: e }] : [];
  });
}

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Every word of the query must appear in the name, description, examples, author or category. */
export function searchEntries(entries: readonly MarketplaceEntry[], query: string, category?: Category | ''): MarketplaceEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return entries.filter((e) => {
    if (category && e.category !== category) return false;
    if (!words.length) return true;
    const hay = fold([e.name, e.description, e.author, CATEGORIES[e.category], ...e.examples].join(' '));
    return words.every((w) => hay.includes(w));
  });
}
