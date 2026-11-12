import type { Topic } from '@lemma/practice-engine';

export type { Topic };

/** A calendar day in the user's local time, `YYYY-MM-DD`. Days never shift with DST or time-zone changes. */
export type Day = string;

export type TaskKind = 'assignment' | 'exam' | 'study';

/**
 * A study task. Stored as a sync record (stable `id`, `updated` timestamp) in the `agenda` collection.
 * Progress is not stored on the task: it is derived from the activity log, so two devices never conflict on it.
 */
export interface Task {
  id: string;
  type: 'task';
  kind: TaskKind;
  /** Short title with the date and count phrases removed ("Problem set 4"). */
  title: string;
  /** What the user typed or said. */
  text: string;
  /** Due day (an exam's day). */
  due: Day;
  /** Optional time of day, `HH:MM` (24 h). */
  time?: string;
  /** Number of problems to do, if any. */
  count?: number;
  /** "Chapters 3–4", "Section 2.1". */
  scope?: string;
  /** Practice topics this task covers; empty means any topic counts. */
  topics: Topic[];
  /** True when topics were inferred from the subject ("calc test") rather than named. */
  topicsGuessed?: boolean;
  /** First day whose activity counts towards the task (the day it was added). */
  start: Day;
  created: number;
  updated: number;
  /** Checked off by hand. */
  done?: boolean;
  /** Problems done outside the app ("+1"). */
  extra?: number;
}

export type ActivityKind = 'practice' | 'test' | 'exam' | 'calc' | 'lesson';

/** What the app reports when you study. `at` is a ms timestamp or Date; defaults to now. */
export interface ActivityEvent {
  kind: ActivityKind;
  /** A practice-engine Topic id, a topic label ("Integrals") or free text ("chain rule"). */
  topic?: string;
  /** Whether the answer was right; omit when there was nothing to grade (a lesson, a plain calculation). */
  correct?: boolean;
  at?: number | Date;
}

/** One logged study event. Append-only, so merging two devices is a plain union. */
export interface Activity {
  id: string;
  type: 'activity';
  kind: ActivityKind;
  topic?: Topic;
  correct?: boolean;
  at: number;
  /** Local day when it happened (fixed at record time so travel doesn't move past study days). */
  day: Day;
}

export type AgendaRecord = Task | Activity;

/** Activity kinds that count as solving a problem (lessons count for streaks only). */
export const PROBLEM_KINDS: readonly ActivityKind[] = ['practice', 'test', 'exam', 'calc'];
