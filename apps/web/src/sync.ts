import {
  applySnapshotSettings,
  buildSnapshot,
  canonicalJson,
  decrypt,
  diffSummary,
  encrypt,
  estimatePassphraseStrength,
  formulasToItems,
  itemsToFormulas,
  itemsToVariables,
  liveRecords,
  merge,
  newDeviceId,
  SyncError,
  toSnapshotSettings,
  trackChanges,
  variablesToItems,
  type MergeResult,
  type SyncRecord,
  type SyncSnapshot,
  LEGACY,
} from '@lemma/sync-engine';

/**
 * Encrypted backup, restore and (desktop) folder sync. Everything is encrypted on this device with the user's
 * passphrase before it is written anywhere; there is no Lemma server.
 */

const STATE = 'lemma.sync-state.v1';
const K = {
  history: 'lemma.history.v1',
  formulas: 'lemma.formulas.v1',
  vars: 'lemma.vars.v1',
  settings: 'lemma.settings.v1',
  notes: 'lemma.notes.v1',
  nbIndex: 'lemma.notebooks.v1',
  /** Finished exam attempts (exam/store.ts): scores and reviews are study history too. */
  exams: 'lemma.exam.history.v1',
  /** The user's own symbols from the symbol menu (symbols/store.ts). */
  symbols: 'lemma.symbols.v1',
  /** Named matrices from the Matrix mode (matrix/store.ts). */
  matrices: 'lemma.matrices.v1',
  nb: (id: string) => `lemma.notebook.${id}`,
};

interface SyncState {
  deviceId: string;
  records: Record<string, SyncRecord[]>;
  settingsUpdated: Record<string, number>;
  lastSync?: number;
}

const get = <T>(k: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const put = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v));

function state(): SyncState {
  const s = get<SyncState | null>(STATE, null);
  return s ?? { deviceId: newDeviceId(), records: {}, settingsUpdated: {} };
}

/** The current data as items per collection (what the sync engine tracks). */
function currentItems(): Record<string, { id: string }[]> {
  const nbIndex = get<{ id: string }[]>(K.nbIndex, []);
  return {
    history: get<{ id: string }[]>(K.history, []),
    formulas: formulasToItems(get<string[]>(K.formulas, [])),
    variables: variablesToItems(get<Record<string, string>>(K.vars, {})),
    notebooks: nbIndex.map((m) => get<{ id: string } | null>(K.nb(m.id), null)).filter((x): x is { id: string } => !!x),
    notes: get<{ id: string }[]>(K.notes, []),
    agenda: get<{ id: string }[]>('lemma.agenda.v1', []),
    exams: get<{ id: string }[]>(K.exams, []),
    symbols: get<{ id: string }[]>(K.symbols, []),
    matrices: get<{ id: string }[]>(K.matrices, []),
  };
}

/** Builds this device's snapshot, recording what changed since the last sync. */
export function localSnapshot(): { snap: SyncSnapshot; st: SyncState } {
  const st = state();
  const now = Date.now();
  const items = currentItems();
  const collections: Record<string, SyncRecord[]> = {};
  for (const [name, list] of Object.entries(items)) collections[name] = trackChanges(st.records[name] ?? [], list, { now, device: st.deviceId });
  const settings = get<Record<string, unknown>>(K.settings, {});
  for (const key of Object.keys(toSnapshotSettings(settings))) st.settingsUpdated[key] ??= now;
  const snap = buildSnapshot({ deviceId: st.deviceId, collections, settings: toSnapshotSettings(settings), settingsUpdated: st.settingsUpdated, now });
  return { snap, st };
}

/**
 * Writes a merged snapshot back into local storage, all or nothing: if storage fills up part way (a big restore
 * on a nearly full device), every key goes back to what it was, so notebooks never lose their index and the sync
 * state never disagrees with the data.
 */
function apply(merged: SyncSnapshot, st: SyncState): void {
  const c = merged.collections;
  const notebooks = liveRecords<{ id: string; title: string; updated: number }>(c.notebooks);
  const writes: [key: string, value: unknown][] = [
    [K.history, liveRecords(c.history).sort((a, b) => Number((b as { at?: number }).at ?? 0) - Number((a as { at?: number }).at ?? 0))],
    [K.formulas, itemsToFormulas(c.formulas)],
    [K.vars, itemsToVariables(c.variables)],
    [K.notes, liveRecords(c.notes)],
    ['lemma.agenda.v1', liveRecords(c.agenda)],
    [K.symbols, liveRecords(c.symbols)],
    [K.matrices, liveRecords<{ name?: string }>(c.matrices).sort((a, b) => String(a.name).localeCompare(String(b.name)))],
    [K.exams, liveRecords<{ finishedAt?: number }>(c.exams).sort((a, b) => Number(b.finishedAt ?? 0) - Number(a.finishedAt ?? 0))],
    ...notebooks.map((nb) => [K.nb(nb.id), nb] as [string, unknown]),
    ...(c.notebooks ?? []).filter((r) => r.deleted).map((r) => [K.nb(r.id), undefined] as [string, unknown]),
    [K.nbIndex, notebooks.map((n) => ({ id: n.id, title: n.title, updated: n.updated }))],
    [K.settings, applySnapshotSettings(get<Record<string, unknown>>(K.settings, {}), merged.settings)],
    [STATE, { ...st, records: merged.collections, settingsUpdated: merged.settingsUpdated ?? st.settingsUpdated, lastSync: Date.now() } satisfies SyncState],
  ];
  const before = writes.map(([k]) => [k, localStorage.getItem(k)] as const);
  try {
    for (const [k, v] of writes) {
      if (v === undefined) localStorage.removeItem(k);
      else put(k, v);
    }
  } catch (e) {
    for (const [k, v] of before.reverse()) {
      try {
        if (v === null) localStorage.removeItem(k);
        else localStorage.setItem(k, v);
      } catch {
        // Putting back what was there needs no more room than it had.
      }
    }
    if ((e as { name?: string }).name === 'QuotaExceededError')
      throw new Error('There isn’t enough storage on this device for this backup, so nothing was changed. Delete old notes, notebooks or exam results and try again.');
    throw e;
  }
  window.dispatchEvent(new CustomEvent('lemma:agenda-change'));
}

/** diffSummary plus a warning when merging may have brought back items deleted longer ago than tombstones last. */
const summarize = (r: MergeResult) =>
  diffSummary(r.changes) +
  (r.maybeDeleted.length
    ? `. ${r.maybeDeleted.length} item${r.maybeDeleted.length === 1 ? '' : 's'} came back that may have been deleted on another device more than 90 days ago; delete ${r.maybeDeleted.length === 1 ? 'it' : 'them'} again if so`
    : '');

export async function exportBackup(passphrase: string): Promise<{ bytes: Uint8Array; name: string }> {
  const { snap, st } = localSnapshot();
  const bytes = await encrypt(snap, passphrase);
  // Remembering what was exported only helps later merges: a full device must still be able to make its backup.
  try {
    put(STATE, { ...st, records: snap.collections });
  } catch {
    // Storage is full; the backup itself is complete.
  }
  return { bytes, name: `lemma-backup-${new Date().toISOString().slice(0, 10)}.lemmasync` };
}

/** Decrypts `bytes`, merges into this device, saves. Returns a one-line summary. */
export async function importAndMerge(bytes: Uint8Array, passphrase: string): Promise<string> {
  const remote = await decrypt(bytes, passphrase);
  const { snap, st } = localSnapshot();
  const r = merge(snap, remote);
  apply(r.merged, st);
  return summarize(r);
}

/** Desktop folder sync: read the shared file (if any), merge, write the merged result back. */
export async function syncWithFile(read: () => Promise<Uint8Array | null>, write: (b: Uint8Array) => Promise<void>, passphrase: string): Promise<{ summary: string; changedHere: boolean }> {
  const existing = await read();
  const { snap, st } = localSnapshot();
  let merged = snap;
  let summary = 'Sync file created';
  let changedHere = false;
  if (existing) {
    const remote = await decrypt(existing, passphrase);
    const r = merge(snap, remote, { localSyncedAt: st.lastSync });
    merged = r.merged;
    summary = summarize(r);
    const c = r.changes;
    changedHere = c.added.length + c.updated.length + c.deleted.length + c.settings.length > 0;
  }
  apply(merged, st);
  await write(await encrypt(merged, passphrase));
  return { summary, changedHere };
}

// ---------------------------------------------------------------------------
// Optional sync server (apps/sync-server). The server stores only the encrypted file above.
// ---------------------------------------------------------------------------

/**
 * The sync ID and access token come from the passphrase through PBKDF2 with their own salt, separate from the random
 * per-file salt that protects the data. The salt includes the server's address, so the same passphrase on two servers
 * gives unrelated spaces and one precomputed dictionary doesn't fit every server. The server sees the ID and the
 * token's hash, never the passphrase or the encryption key.
 */
export const serverIdSalt = (base: string) => `lemma/sync-server-id/v2 ${base}`;
/** The fixed salt used before the server address was part of it. Only read (see legacyRemote), never written. */
export const SERVER_ID_SALT = 'lemma/sync-server-id/v1';
export const SERVER_ID_ITERATIONS = 600_000;
/** Starting a server space needs more than a backup does: anyone who sees its ID can guess offline. */
export const MIN_SERVER_PASSPHRASE_LENGTH = 16;

export interface ServerCredentials {
  id: string;
  token: string;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

let credCache: { passphrase: string; salt: string; creds: Promise<ServerCredentials> } | null = null;

export function serverCredentials(passphrase: string, salt: string, iterations = SERVER_ID_ITERATIONS): Promise<ServerCredentials> {
  const cacheable = iterations === SERVER_ID_ITERATIONS && salt !== SERVER_ID_SALT && salt !== LEGACY.syncIdSalt;
  if (cacheable && credCache?.passphrase === passphrase && credCache.salt === salt) return credCache.creds;
  const creds = (async () => {
    const s = globalThis.crypto.subtle;
    const base = await s.importKey('raw', new TextEncoder().encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await s.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations }, base, 512));
    return { id: hex(bits.slice(0, 32)), token: hex(bits.slice(32, 64)) };
  })();
  if (cacheable) credCache = { passphrase, salt, creds };
  return creds;
}

/** "https://sync.example.com/" → "https://sync.example.com". Plain http only for this computer. null if unusable. */
export function normalizeServerUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
  if (u.username || u.password || u.search || u.hash) return null;
  return (u.origin + u.pathname).replace(/\/+$/, '');
}

export class SyncServerError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = 'SyncServerError';
  }
}

export interface ServerSyncOptions {
  /** Called when the server has nothing for this passphrase. Return false to stop (catches typos). */
  confirmCreate?: () => Promise<boolean> | boolean;
  /** This device's data; defaults to the app's local storage. */
  local?: () => { snap: SyncSnapshot; lastSync?: number; commit: (merged: SyncSnapshot) => void };
  fetch?: typeof fetch;
  /** Attempts when another device uploads in between (HTTP 412). */
  attempts?: number;
  iterations?: number;
}

export interface ServerSyncResult {
  summary: string;
  changedHere: boolean;
  created: boolean;
  uploaded: boolean;
}

const sameData = (a: SyncSnapshot, b: SyncSnapshot) =>
  canonicalJson({ c: a.collections, s: a.settings ?? {}, u: a.settingsUpdated ?? {} }) === canonicalJson({ c: b.collections, s: b.settings ?? {}, u: b.settingsUpdated ?? {} });

const storageLocal = () => {
  const { snap, st } = localSnapshot();
  return { snap, lastSync: st.lastSync, commit: (merged: SyncSnapshot) => apply(merged, st) };
};

async function serverFail(res: Response): Promise<never> {
  let why = '';
  try {
    why = ((await res.json()) as { error?: string }).error ?? '';
  } catch {
    // not JSON
  }
  if (res.status === 429) throw new SyncServerError(`The sync server is busy. Try again in ${res.headers.get('Retry-After') ?? 'a minute'} s.`, 429);
  if (res.status === 413) throw new SyncServerError('Your data is larger than this sync server accepts.', 413);
  if (res.status === 403) throw new SyncServerError('The sync server refused this device’s access key.', 403);
  throw new SyncServerError(`Sync server error ${res.status}${why ? `: ${why}` : ''}`, res.status);
}

/**
 * Download → merge → upload with If-Match → retry on 412. The local copy is only changed after the merged
 * result is safely on the server (or when the server already has exactly the merged data).
 */
export async function syncWithServer(baseUrl: string, passphrase: string, opts: ServerSyncOptions = {}): Promise<ServerSyncResult> {
  const base = normalizeServerUrl(baseUrl);
  if (!base) throw new SyncServerError('Use an https:// address for the sync server.');
  const f = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const { id, token } = await serverCredentials(passphrase, serverIdSalt(base), opts.iterations);
  const url = `${base}/v1/sync/${id}`;
  const auth = { Authorization: `Bearer ${token}` };
  const call = async (init: RequestInit) => {
    try {
      return await f(url, { ...init, cache: 'no-store', credentials: 'omit' });
    } catch {
      throw new SyncServerError('Can’t reach the sync server. Check the address and your connection.');
    }
  };
  const legacyRemote = async (): Promise<SyncSnapshot | null> => {
    for (const salt of [SERVER_ID_SALT, LEGACY.syncIdSalt]) {
      const old = await serverCredentials(passphrase, salt, opts.iterations);
      const res = await f(`${base}/v1/sync/${old.id}`, { headers: { Authorization: `Bearer ${old.token}` }, cache: 'no-store', credentials: 'omit' }).catch(() => null);
      if (res?.status === 200) return decrypt(new Uint8Array(await res.arrayBuffer()), passphrase);
    }
    return null;
  };
  const attempts = opts.attempts ?? 5;
  let confirmed = false;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const got = await call({ headers: auth });
    let etag: string | null = null;
    let remote: SyncSnapshot | null = null;
    if (got.status === 200) {
      etag = got.headers.get('ETag');
      remote = await decrypt(new Uint8Array(await got.arrayBuffer()), passphrase);
    } else if (got.status !== 404) await serverFail(got);
    else if (!confirmed) {
      // Synced before the salt included the server address (or before the rename): the data is under an old ID.
      // Bring it across to the new ID instead of starting empty.
      const old = await legacyRemote();
      if (old) remote = old;
      else {
        if ([...passphrase].length < MIN_SERVER_PASSPHRASE_LENGTH || estimatePassphraseStrength(passphrase).score < 3)
          throw new SyncServerError(`Nothing is stored under this passphrase yet. To start syncing, choose a stronger passphrase: at least ${MIN_SERVER_PASSPHRASE_LENGTH} characters, such as four or more random words.`);
        if (opts.confirmCreate && !(await opts.confirmCreate())) throw new SyncServerError('Sync cancelled.');
      }
      confirmed = true;
    }

    const local = (opts.local ?? storageLocal)();
    let merged = local.snap;
    let summary = 'Started syncing with this server';
    let changedHere = false;
    let upload = true;
    if (remote) {
      const r = merge(local.snap, remote, { localSyncedAt: local.lastSync });
      merged = r.merged;
      summary = summarize(r);
      const c = r.changes;
      changedHere = c.added.length + c.updated.length + c.deleted.length + c.settings.length > 0;
      upload = !etag || !sameData(merged, remote); // no ETag: found under an old ID, so always write the new one
    }
    if (upload) {
      const body = await encrypt(merged, passphrase);
      const put = await call({
        method: 'PUT',
        headers: { ...auth, 'Content-Type': 'application/octet-stream', ...(etag ? { 'If-Match': etag } : { 'If-None-Match': '*' }) },
        body: body as BodyInit,
      });
      if (put.status === 412) {
        // Another device wrote in between: start over from its version.
        await new Promise((r) => setTimeout(r, 50 + Math.random() * 250 * (attempt + 1)));
        continue;
      }
      if (!put.ok) await serverFail(put);
    }
    local.commit(merged);
    return { summary, changedHere, created: !remote, uploaded: upload };
  }
  throw new SyncServerError('Other devices kept changing the data while syncing. Try again.', 412);
}

export const lastSync = (): number | undefined => state().lastSync;
export { estimatePassphraseStrength, SyncError };
