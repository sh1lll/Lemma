/**
 * Pictures placed on the graph live in IndexedDB (they can be megabytes; localStorage is for small text). Rows keep
 * only the key. Decoded images are cached per key for the session.
 */

const DB = 'lemma-graphing';
const STORE = 'images';
let db: Promise<IDBDatabase> | null = null;
const cache = new Map<string, Promise<HTMLImageElement | null>>();

function open(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.catch(() => (db = null));
  return db;
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = run(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function putImage(key: string, blob: Blob): Promise<void> {
  await tx('readwrite', (s) => s.put(blob, key));
  cache.delete(key);
}

export function getImage(key: string): Promise<HTMLImageElement | null> {
  if (!key) return Promise.resolve(null);
  let p = cache.get(key);
  if (!p) {
    p = tx<Blob | undefined>('readonly', (s) => s.get(key) as IDBRequest<Blob | undefined>)
      .then((blob) => (blob ? decode(blob) : null))
      .catch(() => null);
    cache.set(key, p);
  }
  return p;
}

export function decode(blob: Blob): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = URL.createObjectURL(blob);
  });
}

/** Removes stored pictures no row refers to any more. */
export async function pruneImages(keep: Set<string>): Promise<void> {
  try {
    const keys = (await tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys())) as string[];
    for (const k of keys) if (!keep.has(k)) await tx('readwrite', (s) => s.delete(k));
  } catch {
    // IndexedDB unavailable: nothing to prune.
  }
}
