import { LEGACY } from '@lemma/sync-engine/src/legacy';

/**
 * Data saved before the app was renamed Lemma (the old names are in packages/sync-engine/src/legacy.ts), moved
 * once to the new names on first start. Imported first by main.ts, so it runs before anything reads storage.
 *  - Same origin (a browser, the dev server): localStorage keys and IndexedDB databases are renamed in place.
 *  - The desktop app: its pages moved to a new address, so the old address's storage was exported by the shell
 *    (apps/desktop/legacy.mjs) and is handed over here to be written under the new names.
 * Existing data under a new name is never overwritten. Delete this file (and its import) with legacy.ts.
 */
const DONE = 'lemma.legacy-moved';

type Dump = { local: Record<string, string>; databases: DbDump[] };
interface DbDump {
  name: string;
  version: number;
  stores: { name: string; keyPath: string | string[] | null; autoIncrement: boolean; indexes: { name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }[]; rows: [unknown, unknown][] }[];
}

const renameKey = (k: string): string | null => {
  for (const p of LEGACY.storagePrefixes) if (k.startsWith(p)) return `lemma${p.slice(-1)}${k.slice(p.length)}`;
  return null;
};

function moveLocal(local: Record<string, string>, removeOld: boolean): void {
  for (const [k, v] of Object.entries(local)) {
    const to = renameKey(k) ?? k;
    if (localStorage.getItem(to) === null) localStorage.setItem(to, v);
    if (removeOld && to !== k) localStorage.removeItem(k);
  }
}

const req = <T>(r: IDBRequest<T>) => new Promise<T>((ok, no) => ((r.onsuccess = () => ok(r.result)), (r.onerror = () => no(r.error))));

async function readDb(name: string): Promise<DbDump | null> {
  const db = await new Promise<IDBDatabase | null>((ok) => {
    const r = indexedDB.open(name);
    // Opening a database that doesn't exist creates it: abort that, there's nothing to move.
    r.onupgradeneeded = () => r.transaction?.abort();
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ok(null);
  });
  if (!db) return null;
  try {
    const names = [...db.objectStoreNames];
    if (!names.length) return null;
    const tx = db.transaction(names, 'readonly');
    const stores = await Promise.all(
      names.map(async (s) => {
        const os = tx.objectStore(s);
        const [keys, values] = await Promise.all([req(os.getAllKeys()), req(os.getAll())]);
        const indexes = [...os.indexNames].map((i) => {
          const ix = os.index(i);
          return { name: i, keyPath: ix.keyPath, unique: ix.unique, multiEntry: ix.multiEntry };
        });
        return { name: s, keyPath: os.keyPath, autoIncrement: os.autoIncrement, indexes, rows: keys.map((k, n) => [k, values[n]] as [unknown, unknown]) };
      }),
    );
    return { name, version: db.version, stores };
  } finally {
    db.close();
  }
}

async function writeDb(name: string, d: DbDump): Promise<void> {
  const db = await new Promise<IDBDatabase>((ok, no) => {
    const r = indexedDB.open(name, d.version);
    r.onupgradeneeded = () => {
      for (const s of d.stores) {
        if (r.result.objectStoreNames.contains(s.name)) continue;
        const os = r.result.createObjectStore(s.name, { keyPath: s.keyPath ?? undefined, autoIncrement: s.autoIncrement });
        for (const i of s.indexes) os.createIndex(i.name, i.keyPath, { unique: i.unique, multiEntry: i.multiEntry });
      }
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
  try {
    const stores = d.stores.map((s) => s.name).filter((s) => db.objectStoreNames.contains(s));
    if (!stores.length) return;
    const tx = db.transaction(stores, 'readwrite');
    for (const s of d.stores) {
      if (!stores.includes(s.name)) continue;
      const os = tx.objectStore(s.name);
      // add(), not put(): a record already saved under the new name wins.
      for (const [k, v] of s.rows) os.keyPath === null ? os.add(v, k as IDBValidKey).onerror = (e) => e.preventDefault() : (os.add(v).onerror = (e) => e.preventDefault());
    }
    await new Promise<void>((ok, no) => ((tx.oncomplete = () => ok()), (tx.onerror = () => no(tx.error))));
  } finally {
    db.close();
  }
}

/** Blobs travel from the desktop shell as { "\u0000blob": type, data: base64 }. */
function revive(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(revive);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o['\u0000blob'] === 'string') return new Blob([Uint8Array.from(atob(String(o.data)), (c) => c.charCodeAt(0))], { type: String(o['\u0000blob']) });
    if (typeof o['\u0000bytes'] === 'string') return Uint8Array.from(atob(String(o['\u0000bytes'])), (c) => c.charCodeAt(0)).buffer;
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, revive(x)]));
  }
  return v;
}

async function moveDatabases(dumps: DbDump[]): Promise<void> {
  for (const d of dumps) {
    const to = LEGACY.databases[d.name];
    if (to) await writeDb(to, d);
  }
}

function start(): void {
  let local: Storage | null = null;
  try {
    local = localStorage;
    if (local.getItem(DONE)) return;
  } catch {
    return; // storage blocked: nothing saved, nothing to move
  }
  // Same origin: keys are renamed straight away (synchronously, before the app reads its settings).
  const old: Record<string, string> = {};
  for (let i = 0; i < local.length; i++) {
    const k = local.key(i)!;
    if (renameKey(k)) old[k] = local.getItem(k)!;
  }
  moveLocal(old, true);
  const desktop = (window as unknown as { lemmaDesktop?: { legacyDump?: () => Promise<string | null>; legacyDone?: () => void } }).lemmaDesktop;
  void (async () => {
    // Same-origin databases.
    const dumps = (await Promise.all(Object.keys(LEGACY.databases).map(readDb))).filter((d): d is DbDump => !!d);
    await moveDatabases(dumps);
    for (const d of dumps) indexedDB.deleteDatabase(d.name);
    // The desktop app's old address, exported by the shell.
    const raw = desktop?.legacyDump ? await desktop.legacyDump() : null;
    if (raw) {
      const dump = revive(JSON.parse(raw)) as Dump;
      moveLocal(dump.local, false);
      await moveDatabases(dump.databases);
      desktop!.legacyDone?.();
      // Settings and history were read before this arrived: start again with them in place.
      local!.setItem(DONE, '1');
      location.reload();
      return;
    }
    local!.setItem(DONE, '1');
  })().catch(() => undefined);
}

start();
