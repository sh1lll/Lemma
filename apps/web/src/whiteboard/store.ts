// Boards in IndexedDB ("lemma-boards"). Like lesson/gallery.ts, every call fails with a clear Error rather
// than hanging when IndexedDB is missing, disabled, blocked or unresponsive.
import type { Obj } from './model';

const DB_NAME = 'lemma-boards';
const DB_VERSION = 1;
const STORE = 'boards';
const TIMEOUT_MS = 8000;
const LAST_KEY = 'lemma:last-board';
const STASH_KEY = 'lemma:board-stash:';

export interface BoardSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  count: number;
}

export interface BoardRecord extends BoardSummary {
  objects: Obj[];
  camera?: { x: number; y: number; z: number };
}

const unavailable = (why: string) => new Error(`Boards can't be saved: ${why}`);
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    let idb: IDBFactory | undefined;
    try {
      idb = typeof indexedDB === 'undefined' ? undefined : indexedDB;
    } catch {
      idb = undefined;
    }
    if (!idb) {
      reject(unavailable('this browser has no IndexedDB, or site storage is disabled.'));
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = idb.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(unavailable(`storage is blocked (${(e as Error).message || 'access denied'}).`));
      return;
    }
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(unavailable('IndexedDB did not respond. It may be blocked by browser settings or private browsing.'));
    }, TIMEOUT_MS);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
    };
    req.onsuccess = () => {
      clearTimeout(timer);
      const db = req.result;
      // Answered after we gave up: close it, so it doesn't block a later open or upgrade. The next call reopens.
      if (timedOut) {
        db.close();
        return;
      }
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      clearTimeout(timer);
      reject(unavailable(req.error?.message || 'could not open the database.'));
    };
    req.onblocked = () => {
      clearTimeout(timer);
      reject(unavailable('the database is in use by another Lemma tab. Close other tabs and try again.'));
    };
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(STORE, mode);
    } catch (e) {
      dbPromise = null;
      reject(unavailable((e as Error).message || 'transaction failed.'));
      return;
    }
    const timer = setTimeout(() => {
      try {
        tx.abort();
      } catch {
        /* finished */
      }
      reject(new Error('Boards: the operation timed out.'));
    }, TIMEOUT_MS);
    let result = undefined as T;
    let req: IDBRequest<T>;
    try {
      req = fn(tx.objectStore(STORE));
    } catch (e) {
      clearTimeout(timer);
      reject(new Error(`Boards: ${(e as Error).message}`));
      return;
    }
    req.onsuccess = () => {
      result = req.result;
    };
    tx.oncomplete = () => {
      clearTimeout(timer);
      resolve(result);
    };
    const fail = () => {
      clearTimeout(timer);
      const err = tx.error ?? req.error;
      reject(new Error(err?.name === 'QuotaExceededError' ? 'Boards: not enough storage space to save this board.' : `Boards: ${err?.message || 'the operation failed.'}`));
    };
    tx.onerror = fail;
    tx.onabort = fail;
  });
}

export const boards = {
  async list(): Promise<BoardSummary[]> {
    // Summaries only; a cursor avoids structured-cloning every board's objects.
    const db = await openDb();
    return new Promise<BoardSummary[]>((resolve, reject) => {
      const out: BoardSummary[] = [];
      let tx: IDBTransaction;
      try {
        tx = db.transaction(STORE, 'readonly');
      } catch (e) {
        dbPromise = null;
        reject(unavailable((e as Error).message));
        return;
      }
      const timer = setTimeout(() => reject(new Error('Boards: the operation timed out.')), TIMEOUT_MS);
      const req = tx.objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return;
        const r = c.value as BoardRecord;
        out.push({ id: r.id, title: r.title, createdAt: r.createdAt, updatedAt: r.updatedAt, count: r.count ?? r.objects?.length ?? 0 });
        c.continue();
      };
      tx.oncomplete = () => {
        clearTimeout(timer);
        resolve(out.sort((a, b) => b.updatedAt - a.updatedAt));
      };
      tx.onerror = tx.onabort = () => {
        clearTimeout(timer);
        reject(new Error(`Boards: ${tx.error?.message || 'could not list boards.'}`));
      };
    });
  },
  async get(id: string): Promise<BoardRecord | undefined> {
    return (await run<BoardRecord | undefined>('readonly', (s) => s.get(id) as IDBRequest<BoardRecord | undefined>)) ?? undefined;
  },
  async put(rec: BoardRecord): Promise<void> {
    await run('readwrite', (s) => s.put(rec));
  },
  async remove(id: string): Promise<void> {
    await run('readwrite', (s) => s.delete(id));
  },
  lastId(): string | null {
    try {
      return localStorage.getItem(LAST_KEY);
    } catch {
      return null;
    }
  },
  setLastId(id: string): void {
    try {
      localStorage.setItem(LAST_KEY, id);
    } catch {
      /* storage disabled */
    }
  },
  /**
   * Synchronous write-ahead copy of a board with unsaved edits, taken when the page is hidden or unloaded:
   * an IndexedDB write started then may never finish. Read back (if newer) the next time the board opens.
   */
  saveStash(rec: BoardRecord): void {
    try {
      localStorage.setItem(STASH_KEY + rec.id, JSON.stringify(rec));
    } catch {
      /* storage disabled or full: the IndexedDB save is all there is */
    }
  },
  stash(id: string): BoardRecord | undefined {
    try {
      const raw = localStorage.getItem(STASH_KEY + id);
      const r = raw ? (JSON.parse(raw) as BoardRecord) : undefined;
      return r && r.id === id && Array.isArray(r.objects) && typeof r.updatedAt === 'number' ? r : undefined;
    } catch {
      return undefined;
    }
  },
  /** Forgets the stash once a save at least as new has landed (or the board is deleted, with no `savedAt`). */
  dropStash(id: string, savedAt = Infinity): void {
    try {
      const s = boards.stash(id);
      if (s && s.updatedAt <= savedAt) localStorage.removeItem(STASH_KEY + id);
      else if (!s) localStorage.removeItem(STASH_KEY + id);
    } catch {
      /* storage disabled */
    }
  },
};
