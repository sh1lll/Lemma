import { matchPlugin, runFormula, validateManifest, type PluginManifest } from '@lemma/plugin-engine';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import {
  canonicalJson,
  CATEGORIES,
  INDEX_FORMAT,
  MarketplaceError,
  SIGNED_FORMAT,
  verifyManifest,
  verifySignedIndex,
  type Category,
  type MarketplaceBundle,
  type MarketplaceEntry,
  type MarketplaceIndex,
  type SignedIndex,
} from '../src/index';

/** Node-only: build and sign the static marketplace from a folder of manifests (extensions/<category>/<id>.json). */

export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

/** Raw 32-byte Ed25519 public key, base64. */
export function rawPublicKey(key: KeyObject): string {
  const der = createPublicKey(key).export({ type: 'spki', format: 'der' });
  return der.subarray(der.length - 32).toString('base64');
}

export const keyIdFor = (publicKeyB64: string) => `lemma-${sha256(Buffer.from(publicKeyB64, 'base64')).slice(0, 12)}`;

export function generateKeys(): { privatePem: string; publicKey: string; keyId: string } {
  const { privateKey } = generateKeyPairSync('ed25519');
  const publicKey = rawPublicKey(privateKey);
  return { privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), publicKey, keyId: keyIdFor(publicKey) };
}

export function signIndex(index: MarketplaceIndex, privatePem: string): SignedIndex {
  const key = createPrivateKey(privatePem);
  if (key.asymmetricKeyType !== 'ed25519') throw new MarketplaceError('The signing key must be Ed25519');
  const publicKey = rawPublicKey(key);
  const signature = sign(null, Buffer.from(canonicalJson(index), 'utf8'), key).toString('base64');
  return { format: SIGNED_FORMAT, version: 1, keyId: keyIdFor(publicKey), signature, index };
}

export interface SourceManifest {
  file: string;
  category: Category;
  manifest: PluginManifest;
}

/** Reads extensions/<category>/*.json, validating each manifest and running its examples. */
export async function readSources(srcDir: string): Promise<SourceManifest[]> {
  const out: SourceManifest[] = [];
  const problems: string[] = [];
  for (const cat of (await readdir(srcDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    if (!(cat in CATEGORIES)) {
      problems.push(`${cat}/: unknown category (use one of ${Object.keys(CATEGORIES).join(', ')})`);
      continue;
    }
    for (const f of (await readdir(join(srcDir, cat))).filter((f) => f.endsWith('.json')).sort()) {
      const file = join(srcDir, cat, f);
      try {
        const raw = await readFile(file, 'utf8');
        if (raw.length > 200_000) throw new Error('larger than 200 kB');
        const manifest = validateManifest(JSON.parse(raw));
        if (f !== `${manifest.id}.json`) throw new Error(`file name must be ${manifest.id}.json`);
        if (!manifest.author) throw new Error('author is required in the marketplace');
        if (!manifest.examples?.length) throw new Error('at least one example is required in the marketplace');
        for (const ex of manifest.examples) {
          const match = matchPlugin(manifest, ex.input);
          if (!match) throw new Error(`example "${ex.input}" doesn't match any template`);
          if (manifest.kind === 'formula' && ex.expect !== undefined) {
            const r = runFormula(manifest, match, ex.input);
            if (!r.ok) throw new Error(`example "${ex.input}" fails: ${r.error.message}`);
            if (r.primary.display !== ex.expect) throw new Error(`example "${ex.input}" gives ${r.primary.display}, expected ${ex.expect}`);
          }
        }
        out.push({ file, category: cat as Category, manifest });
      } catch (e) {
        problems.push(`${relative(srcDir, file)}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  const seen = new Map<string, string>();
  for (const s of out) {
    const prev = seen.get(s.manifest.id);
    if (prev) problems.push(`${relative(srcDir, s.file)}: duplicate id ${s.manifest.id} (also in ${prev})`);
    seen.set(s.manifest.id, relative(srcDir, s.file));
  }
  if (problems.length) throw new MarketplaceError(`Marketplace sources have problems:\n  ${problems.join('\n  ')}`);
  return out;
}

const writeAtomic = async (file: string, text: string) => {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, text);
  await rename(tmp, file);
};

export interface BuildOptions {
  srcDir: string;
  outDir: string;
  privatePem: string;
  /** Build time; defaults to now, or the previous index's time when no entry changed (so rebuilds are stable). */
  now?: Date;
  /** Public keys the result must verify against (defaults to the ones the app ships). */
  trustedKeys?: Record<string, string>;
}

export async function buildSite(o: BuildOptions): Promise<{ signed: SignedIndex; written: string[] }> {
  const sources = await readSources(o.srcDir);
  const entries: MarketplaceEntry[] = [];
  const files: [string, string][] = [];
  const manifests: Record<string, unknown> = {};
  for (const { manifest: m, category } of sources.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name, 'en'))) {
    const canonical = canonicalJson(m);
    const path = `manifests/${m.id}/${m.release}.json`;
    const target = join(o.outDir, path);
    // Published versions are immutable: a changed manifest needs a new release number.
    if (existsSync(target)) {
      const old = canonicalJson(JSON.parse(await readFile(target, 'utf8')));
      if (old !== canonical) throw new MarketplaceError(`${m.id} ${m.release} was already published with different content; bump "release"`);
    }
    entries.push({
      id: m.id,
      name: m.name,
      description: m.description,
      kind: m.kind,
      category,
      release: m.release,
      author: m.author!,
      examples: (m.examples ?? []).map((e) => e.input).slice(0, 3),
      permissions: m.kind === 'script' ? (m.permissions ?? []).map((p) => p.replace(/^network:/, '')) : [],
      path,
      sha256: sha256(canonical),
      size: Buffer.byteLength(canonical),
    });
    files.push([path, `${JSON.stringify(m, null, 2)}\n`]);
    manifests[m.id] = JSON.parse(canonical);
  }

  let generated = (o.now ?? new Date()).toISOString();
  const indexFile = join(o.outDir, 'index.json');
  if (!o.now && existsSync(indexFile)) {
    const prev = JSON.parse(await readFile(indexFile, 'utf8')) as SignedIndex;
    if (canonicalJson(prev.index?.entries) === canonicalJson(entries)) generated = prev.index.generated;
  }
  const index: MarketplaceIndex = { format: INDEX_FORMAT, version: 1, generated, entries };
  const signed = signIndex(index, o.privatePem);

  // Refuse to publish something the app would reject.
  await verifySignedIndex(JSON.parse(JSON.stringify(signed)), o.trustedKeys).catch((e: unknown) => {
    throw new MarketplaceError(
      `${e instanceof Error ? e.message : String(e)}.\nThe signing key's id is ${signed.keyId}; add its public key to packages/marketplace/src/keys.ts (see PUBLISHING.md).`,
    );
  });

  const written: string[] = [];
  for (const [p, text] of files) {
    await writeAtomic(join(o.outDir, p), text);
    written.push(p);
  }
  const bundle: MarketplaceBundle = { signed, manifests };
  await writeAtomic(join(o.outDir, 'bundle.json'), `${JSON.stringify(bundle)}\n`);
  await writeAtomic(indexFile, `${JSON.stringify(signed, null, 2)}\n`);
  written.push('bundle.json', 'index.json');
  return { signed, written };
}

/** Verifies a built site folder: signature, every manifest's hash, and the bundle. */
export async function verifySite(outDir: string, trustedKeys?: Record<string, string>): Promise<{ entries: number }> {
  const signed = JSON.parse(await readFile(join(outDir, 'index.json'), 'utf8')) as unknown;
  const index = await verifySignedIndex(signed, trustedKeys);
  for (const e of index.entries) await verifyManifest(e, JSON.parse(await readFile(join(outDir, e.path), 'utf8')));
  const bundle = JSON.parse(await readFile(join(outDir, 'bundle.json'), 'utf8')) as MarketplaceBundle;
  const bIndex = await verifySignedIndex(bundle.signed, trustedKeys);
  for (const e of bIndex.entries) await verifyManifest(e, bundle.manifests[e.id]);
  return { entries: index.entries.length };
}
