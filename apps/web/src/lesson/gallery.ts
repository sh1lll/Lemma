// Local video gallery in IndexedDB ("lemma-videos"). Every call fails with a clear Error rather than
// hanging when IndexedDB is missing, disabled, blocked or unresponsive.
import { scriptDuration, STYLE_LOOKS, isStyleId, type LessonScript } from './script-timeline';
import { lessonDuration, type Lesson } from './timeline';

const DB_NAME = 'lemma-videos';
const DB_VERSION = 1;
const STORE = 'videos';
const TIMEOUT_MS = 8000;
export const VIDEOS_CHANGED_EVENT = 'lemma:videos-changed';

export interface VideoSummary {
  id: string;
  title: string;
  /** ms since epoch */
  createdAt: number;
  /** seconds */
  duration: number;
  /** bytes */
  size: number;
  /** Teaching style label (e.g. "Chalkboard") for videos made from a lesson script. */
  style?: string;
  /** True when a WebVTT caption file was saved with the video. */
  captions?: boolean;
}

export interface VideoRecord extends VideoSummary {
  mime: string;
  blob: Blob;
  /** The old step-card Lesson, or a LessonScript (has `scenes`). */
  lesson: Lesson | LessonScript;
  /** WebVTT captions, when the export produced them. */
  vtt?: string;
}

export const isLessonScript = (l: Lesson | LessonScript): l is LessonScript => Array.isArray((l as LessonScript).scenes);

const unavailable = (why: string) => new Error(`Video gallery unavailable: ${why}`);

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    let idb: IDBFactory | undefined;
    try {
      idb = typeof indexedDB === 'undefined' ? undefined : indexedDB;
    } catch {
      idb = undefined; // some browsers throw on access when storage is disabled
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
    const timer = setTimeout(
      () => reject(unavailable('IndexedDB did not respond. It may be blocked by browser settings or private browsing.')),
      TIMEOUT_MS,
    );
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => {
      clearTimeout(timer);
      const db = req.result;
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

/** Runs one request in a transaction; resolves when the transaction commits. */
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
        /* already finished */
      }
      reject(new Error('Video gallery: the operation timed out.'));
    }, TIMEOUT_MS);
    let result = undefined as T;
    let req: IDBRequest<T>;
    try {
      req = fn(tx.objectStore(STORE));
    } catch (e) {
      clearTimeout(timer);
      reject(new Error(`Video gallery: ${(e as Error).message}`));
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
      const quota = err?.name === 'QuotaExceededError';
      reject(new Error(quota ? 'Video gallery: not enough storage space to save this video.' : `Video gallery: ${err?.message || 'the operation failed.'}`));
    };
    tx.onerror = fail;
    tx.onabort = fail;
  });
}

function notify() {
  try {
    window.dispatchEvent(new CustomEvent(VIDEOS_CHANGED_EVENT));
  } catch {
    /* non-window context */
  }
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function cloneLesson(l: Lesson): Lesson {
  return {
    title: l.title,
    question: l.question,
    ...(l.questionTex !== undefined ? { questionTex: l.questionTex } : {}),
    steps: l.steps.map((s) => ({ text: s.text, ...(s.tex !== undefined ? { tex: s.tex } : {}) })),
    answer: { display: l.answer.display, ...(l.answer.tex !== undefined ? { tex: l.answer.tex } : {}) },
  };
}

export const gallery = {
  async save(entry: { lesson: Lesson | LessonScript; blob: Blob; mime: string; duration?: number; vtt?: string }): Promise<string> {
    const l = entry.lesson;
    const script = isLessonScript(l);
    const rec: VideoRecord = {
      id: newId(),
      title: l.title || 'Untitled lesson',
      createdAt: Date.now(),
      duration: entry.duration ?? (script ? scriptDuration(l) : lessonDuration(l)),
      size: entry.blob.size,
      mime: entry.mime || entry.blob.type,
      blob: entry.blob,
      lesson: script ? (JSON.parse(JSON.stringify(l)) as LessonScript) : cloneLesson(l),
      ...(script && isStyleId(l.style) ? { style: STYLE_LOOKS[l.style].label } : {}),
      ...(entry.vtt ? { vtt: entry.vtt } : {}),
    };
    await run('readwrite', (s) => s.put(rec));
    notify();
    return rec.id;
  },

  async list(): Promise<VideoSummary[]> {
    const all = await run<VideoRecord[]>('readonly', (s) => s.getAll() as IDBRequest<VideoRecord[]>);
    return all
      .map(({ id, title, createdAt, duration, size, style, vtt }) => ({ id, title, createdAt, duration, size, ...(style ? { style } : {}), ...(vtt ? { captions: true } : {}) }))
      .sort((a, b) => b.createdAt - a.createdAt);
  },

  async get(id: string): Promise<VideoRecord | undefined> {
    return (await run<VideoRecord | undefined>('readonly', (s) => s.get(id) as IDBRequest<VideoRecord | undefined>)) ?? undefined;
  },

  async remove(id: string): Promise<void> {
    await run('readwrite', (s) => s.delete(id));
    notify();
  },
};

export type VideoGallery = typeof gallery;
