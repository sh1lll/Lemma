import type { Attempt, Exam, Result } from './types';

/** localStorage for the exam center: one exam in progress, and the history of finished attempts. */

const RUN_KEY = 'lemma.exam.run.v1';
const HISTORY_KEY = 'lemma.exam.history.v1';
const MAX_HISTORY = 30;
export const RUN_STORAGE_KEY = RUN_KEY;

export interface SavedRun<S = unknown> {
  v: 1;
  exam: Exam;
  attempt: Attempt;
  st: S;
  savedAt: number;
  /** The tab that is running this sitting; another tab that finds a different owner stops writing. */
  owner?: string;
}

export interface HistoryEntry {
  id: string;
  name: string;
  family: string;
  room: string;
  finishedAt: number;
  percent: number;
  score: string;
  estimate: boolean;
  raw: number;
  possible: number;
  exam: Exam;
  attempt: Attempt;
  result: Result;
}

function read<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const runStore = {
  load<S>(): SavedRun<S> | null {
    const r = read<SavedRun<S>>(RUN_KEY);
    return r && r.v === 1 && r.exam && r.attempt ? r : null;
  },
  save<S>(exam: Exam, attempt: Attempt, st: S, owner?: string): boolean {
    return write(RUN_KEY, { v: 1, exam, attempt, st, savedAt: Date.now(), ...(owner ? { owner } : {}) } satisfies SavedRun<S>);
  },
  clear(): void {
    try {
      localStorage.removeItem(RUN_KEY);
    } catch {
      /* storage unavailable */
    }
  },
};

export const history = {
  list(): HistoryEntry[] {
    return read<HistoryEntry[]>(HISTORY_KEY) ?? [];
  },
  add(exam: Exam, attempt: Attempt, result: Result): HistoryEntry {
    const e: HistoryEntry = {
      id: `${exam.id}-${attempt.startedAt}`,
      name: exam.profile.name,
      family: exam.profile.family,
      room: exam.profile.room,
      finishedAt: attempt.finishedAt ?? Date.now(),
      percent: result.percent,
      score: result.score,
      estimate: result.estimate,
      raw: result.raw,
      possible: result.possible,
      exam,
      attempt,
      result,
    };
    const list = [e, ...this.list().filter((x) => x.id !== e.id)].slice(0, MAX_HISTORY);
    // Storage is small: drop the oldest full records until it fits.
    while (list.length && !write(HISTORY_KEY, list)) list.pop();
    return e;
  },
  remove(id: string): void {
    write(HISTORY_KEY, this.list().filter((x) => x.id !== id));
  },
};
