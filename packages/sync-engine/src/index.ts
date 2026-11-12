/**
 * @lemma/sync-engine: serverless, end-to-end encrypted sync.
 *
 * Pure logic only. The host reads and writes files (a backup file, or a file in a synced
 * folder) and shows the UI. Data moves as one encrypted snapshot; devices merge snapshots
 * record by record with last-writer-wins and tombstones for deletions.
 */
import { LEGACY } from './legacy';

export { LEGACY };

// ---------------------------------------------------------------------------
// Types (copied from apps/web so this package has no app dependency)
// ---------------------------------------------------------------------------

/** Any synced record. `updated` is a ms timestamp; `deleted` marks a tombstone. */
export interface SyncRecord {
  id: string;
  updated: number;
  deleted?: boolean;
  /** Device that wrote this version; used to break timestamp ties. */
  device?: string;
  [k: string]: unknown;
}

export interface SyncSnapshot {
  format: 'lemma-sync';
  version: 1;
  deviceId: string;
  createdAt: number;
  collections: Record<string, SyncRecord[]>;
  settings?: Record<string, unknown>;
  /** Per-key timestamps for `settings`. A key without one counts as 0. */
  settingsUpdated?: Record<string, number>;
}

export interface HistoryEntry {
  id: string;
  input: string;
  expression: string;
  display: string;
  plain: string;
  extra?: string[];
  approximate?: boolean;
  pinned?: boolean;
  at: number;
}

export interface NotebookCell {
  id: string;
  type: string;
  source: string;
}

export interface Notebook {
  version: 1;
  id: string;
  title: string;
  angle: 'deg' | 'rad';
  cells: NotebookCell[];
  created: number;
  updated: number;
}

/** Collection names the app uses. Any other name (reminders, notes, ...) works the same way. */
export const COLLECTIONS = {
  history: 'history',
  formulas: 'formulas',
  variables: 'variables',
  notebooks: 'notebooks',
  reminders: 'reminders',
  notes: 'notes',
} as const;

export const SNAPSHOT_FORMAT = 'lemma-sync';
export const SNAPSHOT_VERSION = 1;
export const TOMBSTONE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type SyncErrorCode =
  | 'wrong-passphrase'
  | 'corrupt'
  | 'unsupported-version'
  | 'not-lemma'
  | 'weak-passphrase'
  | 'invalid-snapshot'
  | 'crypto-unavailable';

export class SyncError extends Error {
  constructor(readonly code: SyncErrorCode, message: string) {
    super(message);
    this.name = new.target.name;
  }
}
export class WrongPassphraseError extends SyncError {
  constructor() {
    super('wrong-passphrase', 'The passphrase is wrong for this sync file.');
  }
}
export class CorruptFileError extends SyncError {
  constructor(detail: string) {
    super('corrupt', `The sync file is damaged or incomplete (${detail}).`);
  }
}
export class UnsupportedVersionError extends SyncError {
  constructor(detail: string) {
    super('unsupported-version', `This sync file needs a newer version of Lemma (${detail}).`);
  }
}
export class NotLemmaFileError extends SyncError {
  constructor() {
    super('not-lemma', 'This is not an Lemma sync file.');
  }
}
export class WeakPassphraseError extends SyncError {
  constructor(message: string) {
    super('weak-passphrase', message);
  }
}
export class InvalidSnapshotError extends SyncError {
  constructor(detail: string) {
    super('invalid-snapshot', `The sync data is not valid (${detail}).`);
  }
}

// ---------------------------------------------------------------------------
// Canonical JSON (stable key order) for comparison and tie-breaking
// ---------------------------------------------------------------------------

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Snapshot keys (collection and setting names) come from a file: read and write them as own properties only,
 * so names like "constructor" or "__proto__" are plain data, not Object.prototype members.
 */
const own = <T>(o: Record<string, T> | undefined, k: string): T | undefined => (o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const put = <T>(o: Record<string, T>, k: string, v: T) => Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });

/**
 * Total order on versions of one record: newer `updated` wins; on a tie a tombstone wins,
 * then the larger device id, then the larger canonical JSON. Picking the maximum of a total
 * order is what makes merge commutative, associative and idempotent.
 */
export function compareRecords(a: SyncRecord, b: SyncRecord): number {
  if (a.updated !== b.updated) return a.updated < b.updated ? -1 : 1;
  const da = a.deleted ? 1 : 0;
  const db = b.deleted ? 1 : 0;
  if (da !== db) return da - db;
  const dev = cmpStr(a.device ?? '', b.device ?? '');
  if (dev !== 0) return dev;
  return cmpStr(canonicalJson(a), canonicalJson(b));
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

export interface ChangeRef {
  collection: string;
  id: string;
}
/**
 * A local version replaced by a remote one with the same timestamp but different content
 * (a true tie, settled by the device id and then the content). Also counted in `updated`/`deleted`.
 */
export type Conflict = ChangeRef;
export interface MergeChanges {
  /** Live records new to the local side (including ones restored over a local tombstone). */
  added: ChangeRef[];
  /** Local live records replaced by a different remote version. */
  updated: ChangeRef[];
  /** Local live records replaced by a remote tombstone. */
  deleted: ChangeRef[];
  conflicts: Conflict[];
  /** Setting keys whose local value changed. */
  settings: string[];
}
export interface MergeResult {
  merged: SyncSnapshot;
  changes: MergeChanges;
  /**
   * Live records that only one side has, when that side is older than the tombstone window (its snapshot, or
   * `localSyncedAt`). The other side may have deleted them so long ago that the tombstone is gone, so merging
   * brings them back. They are kept (dropping them could lose real data); callers should warn the user.
   */
  maybeDeleted: ChangeRef[];
}
export interface MergeOptions {
  /** Clock for tombstone GC (default Date.now()). */
  now?: number;
  /** Tombstones older than this are dropped (default 90 days). */
  tombstoneMaxAgeMs?: number;
  /** When the local side last merged with the other side; flags `maybeDeleted` if older than the tombstone window. */
  localSyncedAt?: number;
}

/**
 * Merges a remote snapshot into the local one. `changes` describes what changed from the local
 * side's point of view. The merged snapshot keeps the local deviceId; its data is independent
 * of argument order.
 */
export function merge(local: SyncSnapshot, remote: SyncSnapshot, opts: MergeOptions = {}): MergeResult {
  const horizon = (opts.now ?? Date.now()) - (opts.tombstoneMaxAgeMs ?? TOMBSTONE_MAX_AGE_MS);
  const changes: MergeChanges = { added: [], updated: [], deleted: [], conflicts: [], settings: [] };
  const maybeDeleted: ChangeRef[] = [];
  const remoteStale = remote.createdAt < horizon;
  const localStale = opts.localSyncedAt !== undefined && opts.localSyncedAt < horizon;
  const names = [...new Set([...Object.keys(local.collections), ...Object.keys(remote.collections)])].sort();
  const collections: Record<string, SyncRecord[]> = {};

  for (const collection of names) {
    const byId = new Map<string, SyncRecord>();
    for (const r of own(local.collections, collection) ?? []) {
      const prev = byId.get(r.id);
      if (!prev || compareRecords(r, prev) > 0) byId.set(r.id, r);
    }
    const localById = new Map(byId);
    const remoteIds = new Set<string>();
    for (const r of own(remote.collections, collection) ?? []) {
      remoteIds.add(r.id);
      const prev = byId.get(r.id);
      if (!prev) {
        byId.set(r.id, r);
        continue;
      }
      const c = compareRecords(r, prev);
      const isLocal = localById.get(r.id) === prev;
      if (c > 0) {
        if (isLocal && r.updated === prev.updated) changes.conflicts.push({ collection, id: r.id });
        byId.set(r.id, r);
      }
    }

    const out: SyncRecord[] = [];
    for (const [id, rec] of byId) {
      const before = localById.get(id);
      if (rec !== before) {
        if (!rec.deleted && (!before || before.deleted)) changes.added.push({ collection, id });
        else if (rec.deleted && before && !before.deleted) changes.deleted.push({ collection, id });
        else if (!rec.deleted && before && !before.deleted && canonicalJson(rec) !== canonicalJson(before)) {
          changes.updated.push({ collection, id });
        }
      }
      if (!rec.deleted) {
        // Only the stale side has it: it may be a deletion whose tombstone was already collected.
        if (remoteStale && !localById.has(id)) maybeDeleted.push({ collection, id });
        else if (localStale && !remoteIds.has(id) && rec.updated <= opts.localSyncedAt!) maybeDeleted.push({ collection, id });
      }
      if (rec.deleted && rec.updated < horizon) continue; // tombstone GC
      out.push(rec);
    }
    out.sort((a, b) => cmpStr(a.id, b.id));
    put(collections, collection, out);
  }

  const merged: SyncSnapshot = {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    deviceId: local.deviceId,
    createdAt: Math.max(local.createdAt, remote.createdAt),
    collections,
  };

  if (local.settings || remote.settings) {
    const ls = local.settings ?? {};
    const rs = remote.settings ?? {};
    const lt = local.settingsUpdated ?? {};
    const rt = remote.settingsUpdated ?? {};
    const settings: Record<string, unknown> = {};
    const stamps: Record<string, number> = {};
    for (const key of [...new Set([...Object.keys(ls), ...Object.keys(rs)])].sort()) {
      const inL = hasOwn(ls, key);
      const inR = hasOwn(rs, key);
      let useRemote: boolean;
      if (!inL) useRemote = true;
      else if (!inR) useRemote = false;
      else {
        const tl = own(lt, key) ?? 0;
        const tr = own(rt, key) ?? 0;
        useRemote = tr !== tl ? tr > tl : cmpStr(canonicalJson(rs[key]), canonicalJson(ls[key])) > 0;
      }
      const value = useRemote ? rs[key] : ls[key];
      const stamp = Math.max(inL ? own(lt, key) ?? 0 : 0, inR ? own(rt, key) ?? 0 : 0);
      put(settings, key, value);
      put(stamps, key, stamp);
      if (useRemote && (!inL || canonicalJson(value) !== canonicalJson(ls[key]))) changes.settings.push(key);
    }
    merged.settings = settings;
    merged.settingsUpdated = stamps;
  }

  return { merged, changes, maybeDeleted };
}

/** Drops tombstones older than `maxAgeMs`. merge() already does this. */
export function gcTombstones(snapshot: SyncSnapshot, now = Date.now(), maxAgeMs = TOMBSTONE_MAX_AGE_MS): SyncSnapshot {
  const horizon = now - maxAgeMs;
  const collections: Record<string, SyncRecord[]> = {};
  for (const [name, records] of Object.entries(snapshot.collections)) {
    put(collections, name, records.filter((r) => !(r.deleted && r.updated < horizon)));
  }
  return { ...snapshot, collections };
}

// ---------------------------------------------------------------------------
// Building snapshots from app state
// ---------------------------------------------------------------------------

/** Settings that stay on each device. `theme` syncs only when the user opts in. */
export const DEVICE_SETTINGS: readonly string[] = ['voiceEngine', 'showKeypad', 'theme'];
const SECRET_KEY = /(api|ai|access|private|secret)[-_]?keys?$|^keys?$|secret|token|password|passphrase|credential/i;

export interface SettingsFilterOptions {
  /** Sync the theme too (off by default). */
  syncTheme?: boolean;
}

function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (!SECRET_KEY.test(k)) put(out, k, stripSecrets(v));
    return out;
  }
  return value;
}

/** The part of the settings that may leave the device: no API keys or secrets, no device-specific choices. */
export function toSnapshotSettings(settings: object, opts: SettingsFilterOptions = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(settings)) {
    if (v === undefined || SECRET_KEY.test(k)) continue;
    if (DEVICE_SETTINGS.includes(k) && !(k === 'theme' && opts.syncTheme)) continue;
    put(out, k, stripSecrets(v));
  }
  return out;
}

/** Applies synced settings over local ones, keeping local device-specific choices and secrets. */
export function applySnapshotSettings<T extends object>(local: T, synced: Record<string, unknown> | undefined, opts: SettingsFilterOptions = {}): T {
  return { ...local, ...toSnapshotSettings(synced ?? {}, opts) } as T;
}

/** Updates per-key setting timestamps after the user changed settings. */
export function stampSettings(
  previous: object,
  next: object,
  stamps: Record<string, number> = {},
  now = Date.now(),
): Record<string, number> {
  const prev = previous as Record<string, unknown>;
  const out = { ...stamps };
  for (const [k, v] of Object.entries(next)) {
    if (!(k in prev) || canonicalJson(prev[k]) !== canonicalJson(v)) out[k] = Math.max(now, (stamps[k] ?? 0) + 1);
  }
  return out;
}

export interface TrackOptions {
  now?: number;
  device?: string;
}

/**
 * Turns the app's current items into sync records, given the records from the last snapshot.
 * Unchanged items keep their old version; changed ones get a new timestamp (or their own
 * numeric `updated`, as notebooks have); items that disappeared become tombstones.
 */
export function trackChanges<T extends { id: string }>(previous: readonly SyncRecord[], current: readonly T[], opts: TrackOptions = {}): SyncRecord[] {
  const now = opts.now ?? Date.now();
  const prevById = new Map(previous.map((r) => [r.id, r]));
  const body = (r: object) => {
    const { updated: _u, device: _d, deleted: _x, ...rest } = r as SyncRecord;
    return canonicalJson(rest);
  };
  const out: SyncRecord[] = [];
  const seen = new Set<string>();
  for (const item of current) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const prev = prevById.get(item.id);
    const own = (item as { updated?: unknown }).updated;
    if (prev && !prev.deleted && body(prev) === body(item) && (typeof own !== 'number' || own === prev.updated)) {
      out.push(prev);
      continue;
    }
    let updated = typeof own === 'number' && Number.isFinite(own) ? own : now;
    if (prev && updated <= prev.updated) updated = prev.updated + 1;
    const rec: SyncRecord = { ...(item as object), id: item.id, updated };
    delete rec.deleted;
    if (opts.device) rec.device = opts.device;
    else delete rec.device;
    out.push(rec);
  }
  for (const prev of previous) {
    if (seen.has(prev.id)) continue;
    seen.add(prev.id);
    if (prev.deleted) out.push(prev);
    else {
      const tomb: SyncRecord = { id: prev.id, updated: Math.max(now, prev.updated + 1), deleted: true };
      if (opts.device) tomb.device = opts.device;
      out.push(tomb);
    }
  }
  return out;
}

/** Live (not deleted) records, without the sync-only `deleted` and `device` fields. */
export function liveRecords<T = SyncRecord>(records: readonly SyncRecord[] | undefined): T[] {
  return (records ?? [])
    .filter((r) => !r.deleted)
    .map((r) => {
      const { deleted: _x, device: _d, ...rest } = r;
      return rest as T;
    });
}

/** Variables `{name: decimalString}` as items keyed by name. */
export const variablesToItems = (vars: Record<string, string>) => Object.entries(vars).map(([id, value]) => ({ id, value }));
export const itemsToVariables = (records: readonly SyncRecord[] | undefined): Record<string, string> =>
  Object.fromEntries(liveRecords<{ id: string; value: string }>(records).map((r) => [r.id, String(r.value)]));

/** Saved formulas keyed by the name they define (`f(x) = ...` → `f`), so edits replace rather than duplicate. */
export const formulaId = (source: string) => /^\s*([A-Za-z_]\w*)\s*\(/.exec(source)?.[1] ?? source.trim();
export const formulasToItems = (sources: readonly string[]) => sources.map((source) => ({ id: formulaId(source), source }));
export const itemsToFormulas = (records: readonly SyncRecord[] | undefined): string[] =>
  liveRecords<{ source: string }>(records).map((r) => String(r.source));

export interface BuildSnapshotInput {
  deviceId: string;
  collections: Record<string, SyncRecord[]>;
  settings?: object;
  settingsUpdated?: Record<string, number>;
  now?: number;
  syncTheme?: boolean;
}

/** Builds a snapshot. Settings pass through toSnapshotSettings, so secrets never enter it. */
export function buildSnapshot(input: BuildSnapshotInput): SyncSnapshot {
  const snap: SyncSnapshot = {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    deviceId: input.deviceId,
    createdAt: input.now ?? Date.now(),
    collections: input.collections,
  };
  if (input.settings) {
    const settings = toSnapshotSettings(input.settings, { syncTheme: input.syncTheme });
    const stamps: Record<string, number> = {};
    for (const k of Object.keys(settings)) stamps[k] = input.settingsUpdated?.[k] ?? 0;
    snap.settings = settings;
    snap.settingsUpdated = stamps;
  }
  return snap;
}

/** An empty snapshot, for a device's first merge. */
export const emptySnapshot = (deviceId: string, now = Date.now()): SyncSnapshot => ({
  format: SNAPSHOT_FORMAT,
  version: SNAPSHOT_VERSION,
  deviceId,
  createdAt: now,
  collections: {},
});

/** A random device id. */
export function newDeviceId(): string {
  const b = randomBytes(8);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Checks the shape of parsed JSON and returns it as a snapshot. */
export function parseSnapshot(value: unknown): SyncSnapshot {
  if (!value || typeof value !== 'object') throw new InvalidSnapshotError('not an object');
  const s = value as Partial<SyncSnapshot>;
  // Saved before the rename: the same format under its old name.
  if ((s.format as string) === LEGACY.snapshotFormat) s.format = SNAPSHOT_FORMAT;
  if (s.format !== SNAPSHOT_FORMAT) throw new InvalidSnapshotError('unknown format');
  if (s.version !== SNAPSHOT_VERSION) throw new UnsupportedVersionError(`snapshot version ${String(s.version)}`);
  if (typeof s.deviceId !== 'string' || typeof s.createdAt !== 'number') throw new InvalidSnapshotError('missing device or date');
  if (!s.collections || typeof s.collections !== 'object') throw new InvalidSnapshotError('missing collections');
  for (const [name, records] of Object.entries(s.collections)) {
    if (!Array.isArray(records)) throw new InvalidSnapshotError(`collection ${name} is not a list`);
    for (const r of records as unknown[]) {
      const rec = r as Partial<SyncRecord> | null;
      if (!rec || typeof rec.id !== 'string' || typeof rec.updated !== 'number' || !Number.isFinite(rec.updated)) {
        throw new InvalidSnapshotError(`bad record in ${name}`);
      }
    }
  }
  if (s.settings !== undefined && (typeof s.settings !== 'object' || s.settings === null)) throw new InvalidSnapshotError('bad settings');
  return s as SyncSnapshot;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOUNS: Record<string, [string, string]> = {
  history: ['history entry', 'history entries'],
  formulas: ['formula', 'formulas'],
  variables: ['variable', 'variables'],
  notebooks: ['notebook', 'notebooks'],
  reminders: ['reminder', 'reminders'],
  notes: ['note', 'notes'],
  exams: ['exam result', 'exam results'],
  symbols: ['symbol', 'symbols'],
};
const noun = (collection: string, n: number) => {
  const pair = NOUNS[collection];
  if (pair) return n === 1 ? pair[0] : pair[1];
  return `${collection} ${n === 1 ? 'record' : 'records'}`;
};

/** "12 history entries added, 1 notebook updated, 2 deleted, 1 setting changed". */
export function diffSummary(changes: MergeChanges): string {
  const order: string[] = [];
  const counts = new Map<string, { added: number; updated: number; deleted: number }>();
  const bump = (refs: ChangeRef[], kind: 'added' | 'updated' | 'deleted') => {
    for (const { collection } of refs) {
      let c = counts.get(collection);
      if (!c) {
        c = { added: 0, updated: 0, deleted: 0 };
        counts.set(collection, c);
        order.push(collection);
      }
      c[kind]++;
    }
  };
  bump(changes.added, 'added');
  bump(changes.updated, 'updated');
  bump(changes.deleted, 'deleted');
  const parts: string[] = [];
  for (const collection of order) {
    const c = counts.get(collection)!;
    let named = false;
    for (const kind of ['added', 'updated', 'deleted'] as const) {
      const n = c[kind];
      if (!n) continue;
      parts.push(named ? `${n} ${kind}` : `${n} ${noun(collection, n)} ${kind}`);
      named = true;
    }
  }
  const s = changes.settings.length;
  if (s) parts.push(`${s} ${s === 1 ? 'setting' : 'settings'} changed`);
  const k = changes.conflicts.length;
  if (k) parts.push(`${k} ${k === 1 ? 'conflict' : 'conflicts'} resolved`);
  if (!parts.length) return 'Already up to date';
  const text = parts.join(', ');
  return text[0]!.toUpperCase() + text.slice(1);
}

/** Size in bytes of the snapshot as UTF-8 JSON (before compression and encryption). */
export function snapshotSize(snapshot: SyncSnapshot): number {
  return new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
}

// ---------------------------------------------------------------------------
// Passphrase strength
// ---------------------------------------------------------------------------

export const MIN_PASSPHRASE_LENGTH = 10;
export interface PassphraseStrength {
  score: 0 | 1 | 2 | 3 | 4;
  reason: string;
}
const COMMON = new Set([
  'password', 'password1', 'password123', 'passw0rd', '123456789', '1234567890', 'qwertyuiop', 'iloveyou',
  'letmein', 'welcome', 'admin', 'abc123', 'football', 'monkey', 'dragon', 'sunshine', 'lemma',
  'correcthorsebatterystaple', 'qwerty123', '1q2w3e4r5t', 'trustno1',
]);

/** A rough 0-4 strength score with a short reason. Never logs or stores the passphrase. */
export function estimatePassphraseStrength(p: string): PassphraseStrength {
  const chars = [...p];
  const len = chars.length;
  if (len === 0) return { score: 0, reason: 'Enter a passphrase.' };
  const lower = p.toLowerCase().replace(/[\s\-_.]/g, '');
  if (COMMON.has(lower) || COMMON.has(lower.replace(/\d+$/, ''))) return { score: 0, reason: 'This is a very common password.' };
  if (new Set(chars).size <= 2) return { score: 0, reason: 'Too many repeated characters.' };
  if (len < MIN_PASSPHRASE_LENGTH) return { score: 1, reason: `Too short: use at least ${MIN_PASSPHRASE_LENGTH} characters.` };

  let pool = 0;
  if (/[a-z]/.test(p)) pool += 26;
  if (/[A-Z]/.test(p)) pool += 26;
  if (/\d/.test(p)) pool += 10;
  if (/[^A-Za-z0-9\s]/.test(p)) pool += 33;
  if (/\s/.test(p)) pool += 1;
  if (/[^\x00-\x7f]/.test(p)) pool += 50;
  // Penalize runs and sequences: count only characters that differ from the previous pattern.
  let effective = 1;
  for (let i = 1; i < len; i++) {
    const a = chars[i - 1]!.codePointAt(0)!;
    const b = chars[i]!.codePointAt(0)!;
    effective += a === b || Math.abs(a - b) === 1 ? 0.25 : 1;
  }
  const words = p.trim().split(/[\s\-_.]+/).filter((w) => w.length >= 3).length;
  let bits = effective * Math.log2(Math.max(pool, 2));
  if (words >= 4) bits = Math.max(bits, words * 12); // diceware-style phrases
  if (bits < 45) return { score: 1, reason: 'Weak: add more words or vary the characters.' };
  if (bits < 60) return { score: 2, reason: 'Fair: a longer phrase would be safer.' };
  if (bits < 80) return { score: 3, reason: 'Good.' };
  return { score: 4, reason: 'Strong.' };
}

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

/**
 * File layout (all integers big-endian). The whole header is the AES-GCM additional data,
 * so changing any header byte fails authentication.
 *
 *   off  len  field
 *    0    8   magic "LEMMENC1"
 *    8    1   container version (1)
 *    9    1   KDF id (1 = PBKDF2-HMAC-SHA-256)
 *   10    4   KDF iterations (u32)
 *   14    1   compression (0 = none, 1 = gzip)
 *   15    1   salt length (16)
 *   16    1   IV length (12)
 *   17    1   check length (16)
 *   18   16   salt
 *   34   12   IV
 *   46   16   passphrase check (PBKDF2 output bytes 32..47, separate from the key)
 *   62    …   AES-256-GCM ciphertext followed by the 16-byte tag
 */
export const MAGIC = 'LEMMENC1';
export const CONTAINER_VERSION = 1;
export const KDF_PBKDF2_SHA256 = 1;
export const DEFAULT_ITERATIONS = 600_000;
const MAX_ITERATIONS = 10_000_000;
const SALT_LEN = 16;
const IV_LEN = 12;
const CHECK_LEN = 16;
const TAG_LEN = 16;
export const HEADER_LEN = 18 + SALT_LEN + IV_LEN + CHECK_LEN;
const COMPRESSION_NONE = 0;
const COMPRESSION_GZIP = 1;

export interface EncryptOptions {
  /** PBKDF2 iterations; values below 600,000 are raised to 600,000. */
  iterations?: number;
  /** Set false to skip gzip (default: gzip when CompressionStream exists). */
  compress?: boolean;
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new SyncError('crypto-unavailable', 'Encryption is not available in this environment.');
  return s;
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(n);
  if (!globalThis.crypto?.getRandomValues) throw new SyncError('crypto-unavailable', 'Secure random numbers are not available.');
  globalThis.crypto.getRandomValues(b);
  return b;
}

async function pipe(data: Uint8Array<ArrayBuffer>, stream: GenericTransformStream): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Response(new Blob([data]).stream().pipeThrough(stream as TransformStream<Uint8Array, Uint8Array>));
  return new Uint8Array(await out.arrayBuffer());
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const s = subtle();
  const base = await s.importKey('raw', new TextEncoder().encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await s.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, (32 + CHECK_LEN) * 8));
  const key = await s.importKey('raw', bits.slice(0, 32), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const check = bits.slice(32, 32 + CHECK_LEN);
  bits.fill(0);
  return { key, check };
}

/** Encrypts a snapshot with a passphrase. Throws WeakPassphraseError under 10 characters. */
export async function encrypt(snapshot: SyncSnapshot, passphrase: string, opts: EncryptOptions = {}): Promise<Uint8Array> {
  if ([...passphrase].length < MIN_PASSPHRASE_LENGTH) {
    throw new WeakPassphraseError(`Use a passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters.`);
  }
  const iterations = Math.min(MAX_ITERATIONS, Math.max(DEFAULT_ITERATIONS, Math.floor(opts.iterations ?? DEFAULT_ITERATIONS)));
  const json = new TextEncoder().encode(JSON.stringify(snapshot));
  const gzip = opts.compress !== false && typeof CompressionStream === 'function';
  const plain = gzip ? await pipe(json, new CompressionStream('gzip')) : json;

  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const { key, check } = await deriveKey(passphrase, salt, iterations);

  const header = new Uint8Array(HEADER_LEN);
  header.set(new TextEncoder().encode(MAGIC), 0);
  const view = new DataView(header.buffer);
  view.setUint8(8, CONTAINER_VERSION);
  view.setUint8(9, KDF_PBKDF2_SHA256);
  view.setUint32(10, iterations);
  view.setUint8(14, gzip ? COMPRESSION_GZIP : COMPRESSION_NONE);
  view.setUint8(15, SALT_LEN);
  view.setUint8(16, IV_LEN);
  view.setUint8(17, CHECK_LEN);
  header.set(salt, 18);
  header.set(iv, 18 + SALT_LEN);
  header.set(check, 18 + SALT_LEN + IV_LEN);

  const cipher = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: header, tagLength: 128 }, key, plain));
  const out = new Uint8Array(HEADER_LEN + cipher.byteLength);
  out.set(header, 0);
  out.set(cipher, HEADER_LEN);
  return out;
}

export interface FileHeader {
  version: number;
  kdf: number;
  iterations: number;
  compressed: boolean;
}

/** Reads and checks the header without the passphrase. Throws the typed errors for bad files. */
export function readHeader(bytes: Uint8Array): FileHeader {
  // A file made before the rename starts with the old magic; it opens the same way (the header is the
  // authenticated data either way, so it's checked as written).
  const legacy = new TextEncoder().encode(LEGACY.magic);
  const isLegacy = bytes.byteLength >= 8 && legacy.every((b, i) => bytes[i] === b);
  const magic = isLegacy ? legacy : new TextEncoder().encode(MAGIC);
  const prefix = Math.min(bytes.byteLength, 7);
  for (let i = 0; i < prefix; i++) if (bytes[i] !== magic[i]) throw new NotLemmaFileError();
  if (bytes.byteLength < 8) throw new CorruptFileError('truncated header');
  if (bytes[7] !== magic[7]) {
    if (bytes[7]! >= 0x30 && bytes[7]! <= 0x39) throw new UnsupportedVersionError(`container LEMMENC${String.fromCharCode(bytes[7]!)}`);
    throw new NotLemmaFileError();
  }
  if (bytes.byteLength < 18) throw new CorruptFileError('truncated header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint8(8);
  if (version !== CONTAINER_VERSION) throw new UnsupportedVersionError(`container version ${version}`);
  const kdf = view.getUint8(9);
  if (kdf !== KDF_PBKDF2_SHA256) throw new UnsupportedVersionError(`key derivation ${kdf}`);
  const iterations = view.getUint32(10);
  const compression = view.getUint8(14);
  if (compression !== COMPRESSION_NONE && compression !== COMPRESSION_GZIP) throw new UnsupportedVersionError(`compression ${compression}`);
  if (view.getUint8(15) !== SALT_LEN || view.getUint8(16) !== IV_LEN || view.getUint8(17) !== CHECK_LEN) throw new CorruptFileError('bad header lengths');
  if (iterations < 1 || iterations > MAX_ITERATIONS) throw new CorruptFileError('bad key derivation parameters');
  if (bytes.byteLength < HEADER_LEN + TAG_LEN) throw new CorruptFileError('truncated');
  return { version, kdf, iterations, compressed: compression === COMPRESSION_GZIP };
}

/** Decrypts a sync file. Throws WrongPassphraseError, CorruptFileError, UnsupportedVersionError or NotLemmaFileError. */
export async function decrypt(bytes: Uint8Array, passphrase: string): Promise<SyncSnapshot> {
  const header = readHeader(bytes);
  const data = new Uint8Array(bytes); // own copy, plain ArrayBuffer
  const salt = data.slice(18, 18 + SALT_LEN);
  const iv = data.slice(18 + SALT_LEN, 18 + SALT_LEN + IV_LEN);
  const storedCheck = data.subarray(18 + SALT_LEN + IV_LEN, HEADER_LEN);
  const { key, check } = await deriveKey(passphrase, salt, header.iterations);
  let diff = 0;
  for (let i = 0; i < CHECK_LEN; i++) diff |= check[i]! ^ storedCheck[i]!;
  if (diff !== 0) throw new WrongPassphraseError();

  let plain: Uint8Array<ArrayBuffer>;
  try {
    plain = new Uint8Array(
      await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: data.slice(0, HEADER_LEN), tagLength: 128 }, key, data.slice(HEADER_LEN)),
    );
  } catch {
    // The passphrase check matched, so a failed tag means the file was altered or cut short.
    throw new CorruptFileError('authentication failed');
  }
  if (header.compressed) {
    if (typeof DecompressionStream !== 'function') throw new UnsupportedVersionError('gzip is not available here');
    try {
      plain = await pipe(plain, new DecompressionStream('gzip'));
    } catch {
      throw new CorruptFileError('bad compressed data');
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
  } catch {
    throw new CorruptFileError('bad JSON');
  }
  return parseSnapshot(parsed);
}
