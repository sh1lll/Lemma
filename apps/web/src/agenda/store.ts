import {
  AGENDA_STORAGE_KEY,
  dayOf,
  makeActivity,
  pruneActivities,
  splitRecords,
  taskProgress,
  type Activity,
  type ActivityEvent,
  type AgendaRecord,
  type Day,
  type Task,
} from '@lemma/agenda-engine';

/**
 * Agenda storage. One localStorage list under `lemma.agenda.v1` holding tasks and activity records, each
 * with a stable id, so the sync engine can merge it record by record (collection "agenda"). Device-only
 * preferences (browser notifications) live under a separate key and are not synced.
 */

export const PREFS_KEY = 'lemma.agenda.prefs.v1';
export const CHANGE_EVENT = 'lemma:agenda-change';

export interface AgendaPrefs {
  notify: boolean;
  /** taskId → day it was last announced, so each task notifies once per day. */
  notified: Record<string, Day>;
}

// ---- clock (the harness and tests can pin it) -------------------------------------------------------------

let clock: () => number = () => Date.now();
let zone: string | undefined;

export function setAgendaClock(now: (() => number) | null, timeZone?: string): void {
  clock = now ?? (() => Date.now());
  zone = timeZone;
}
export const nowMs = () => clock();
export const timeZone = () => zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
export const today = (): Day => dayOf(clock(), timeZone());
export const locale = () => (typeof navigator !== 'undefined' && navigator.language) || 'en-US';

// ---- records ----------------------------------------------------------------------------------------------

function readRaw(): unknown[] {
  try {
    const v = localStorage.getItem(AGENDA_STORAGE_KEY);
    const parsed: unknown = v ? JSON.parse(v) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function load(): { tasks: Task[]; activities: Activity[] } {
  return splitRecords(readRaw());
}

function save(tasks: readonly Task[], activities: readonly Activity[]): void {
  const list: AgendaRecord[] = [...tasks, ...pruneActivities(activities, today())];
  try {
    localStorage.setItem(AGENDA_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Storage full or blocked (private mode): the agenda keeps working for this session.
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function saveTask(task: Task): void {
  const { tasks, activities } = load();
  const i = tasks.findIndex((t) => t.id === task.id);
  const next = { ...task, updated: Math.max(nowMs(), (tasks[i]?.updated ?? 0) + 1) };
  if (i >= 0) tasks[i] = next;
  else tasks.push(next);
  save(tasks, activities);
}

export function deleteTask(id: string): Task | null {
  const { tasks, activities } = load();
  const t = tasks.find((x) => x.id === id) ?? null;
  if (t) save(tasks.filter((x) => x.id !== id), activities);
  return t;
}

export interface Advanced {
  task: Task;
  done: number;
  total?: number;
  complete: boolean;
}

export interface RecordResult {
  activity: Activity;
  /** Tasks this event moved forward ("Problem set 4: 8 of 12"). */
  advanced: Advanced[];
}

/**
 * Logs a study event. Safe to call any time (before the agenda is mounted, with bad input, with storage
 * blocked); never throws. Returns what it recorded, or null if the event was unusable.
 */
/** Does the one-time set-up (dates, time zone, reading the store) without recording anything. */
export function warmActivity(): void {
  try {
    makeActivity({ kind: 'calc', topic: '2 + 2', at: nowMs() }, timeZone());
    load();
  } catch {
    /* warming only */
  }
}

export function recordActivity(evt: ActivityEvent): RecordResult | null {
  try {
    const activity = makeActivity({ ...evt, at: evt?.at ?? nowMs() }, timeZone());
    if (!activity) return null;
    const { tasks, activities } = load();
    const before = new Map(tasks.map((t) => [t.id, taskProgress(t, activities).done]));
    activities.push(activity);
    save(tasks, activities);
    const advanced: Advanced[] = [];
    for (const task of tasks) {
      if (task.done) continue;
      const p = taskProgress(task, activities);
      if (p.done > (before.get(task.id) ?? 0)) advanced.push({ task, done: p.done, complete: p.complete, ...(p.total !== undefined ? { total: p.total } : {}) });
    }
    return { activity, advanced };
  } catch {
    return null;
  }
}

// ---- prefs ------------------------------------------------------------------------------------------------

export function loadPrefs(): AgendaPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<AgendaPrefs> | null;
    return { notify: !!v?.notify, notified: v?.notified && typeof v.notified === 'object' ? v.notified : {} };
  } catch {
    return { notify: false, notified: {} };
  }
}

export function savePrefs(p: AgendaPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
