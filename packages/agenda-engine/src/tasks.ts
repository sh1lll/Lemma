import { addDays, dayOf, diffDays, isDay } from './days';
import { newId } from './parse';
import { planExam } from './plan';
import { reviewsDue, type ReviewSuggestion } from './review';
import { normalizeTopic, TOPIC_IDS } from './topics';
import { PROBLEM_KINDS, type Activity, type ActivityEvent, type ActivityKind, type AgendaRecord, type Day, type Task } from './types';

const KINDS: readonly ActivityKind[] = ['practice', 'test', 'exam', 'calc', 'lesson'];

/** Turns an app event into a log record. Returns null for an event it can't use. */
export function makeActivity(evt: ActivityEvent, timeZone: string, id?: string): Activity | null {
  if (!evt || !KINDS.includes(evt.kind)) return null;
  const at = evt.at instanceof Date ? evt.at.getTime() : typeof evt.at === 'number' && Number.isFinite(evt.at) ? evt.at : Date.now();
  const a: Activity = { id: id ?? newId('a', at), type: 'activity', kind: evt.kind, at, day: dayOf(at, timeZone) };
  const topic = normalizeTopic(evt.topic);
  if (topic) a.topic = topic;
  if (typeof evt.correct === 'boolean') a.correct = evt.correct;
  return a;
}

export interface TaskProgress {
  done: number;
  total?: number;
  complete: boolean;
  /** 0–1, or null when the task has no count. */
  fraction: number | null;
}

/**
 * Problems that count towards a task: practice/test/exam answers and solved calculations between the day it
 * was added and its due day, on one of its topics (any topic if it names none), plus "+1"s logged by hand.
 * Wrong answers count too: the task is about doing the problems; accuracy feeds the review schedule.
 */
export function taskProgress(task: Task, activities: readonly Activity[]): TaskProgress {
  const counted = activities.filter(
    (a) => PROBLEM_KINDS.includes(a.kind) && a.day >= task.start && a.day <= task.due && (task.topics.length === 0 || (a.topic !== undefined && task.topics.includes(a.topic))),
  ).length;
  const done = counted + Math.max(0, task.extra ?? 0);
  const total = task.count;
  const complete = !!task.done || (total !== undefined && done >= total);
  return { done, ...(total !== undefined ? { total } : {}), complete, fraction: total ? Math.min(1, done / total) : null };
}

/** Splits a stored list into tasks and activities, dropping anything malformed (old versions, bad sync data). */
export function splitRecords(records: readonly unknown[]): { tasks: Task[]; activities: Activity[] } {
  const tasks: Task[] = [];
  const activities: Activity[] = [];
  for (const r of records) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Partial<AgendaRecord> & { deleted?: boolean };
    if (o.deleted || typeof o.id !== 'string') continue;
    if (o.type === 'task' && isDay((o as Task).due) && isDay((o as Task).start) && typeof (o as Task).title === 'string') {
      const t = o as Task;
      tasks.push({ ...t, topics: Array.isArray(t.topics) ? t.topics.filter((x) => TOPIC_IDS.includes(x)) : [] });
    } else if (o.type === 'activity' && isDay((o as Activity).day) && KINDS.includes((o as Activity).kind) && typeof (o as Activity).at === 'number') {
      activities.push(o as Activity);
    }
  }
  activities.sort((a, b) => a.at - b.at);
  return { tasks, activities };
}

/** Keeps the log bounded: activity older than `keepDays` is dropped (progress charts look back 8 weeks). */
export function pruneActivities(activities: readonly Activity[], today: Day, keepDays = 400, max = 5000): Activity[] {
  const from = addDays(today, -keepDays);
  const kept = activities.filter((a) => a.day >= from);
  return kept.length > max ? kept.slice(kept.length - max) : kept;
}

export interface TodayItem {
  kind: 'task' | 'review' | 'plan';
  task?: Task;
  review?: ReviewSuggestion;
  label?: string;
}

export interface AgendaView {
  /** Not done, due today or earlier (overdue first). */
  dueToday: Task[];
  /** Exam plan items for today, per exam. */
  examToday: { task: Task; items: ReturnType<typeof planExam>['days'][number]['items'] }[];
  reviews: ReviewSuggestion[];
  /** Not done, due after today, soonest first. */
  upcoming: Task[];
  /** Done or complete, most recent first (last 14 days). */
  finished: Task[];
}

/** Everything the agenda screen shows, in order. */
export function agendaView(tasks: readonly Task[], activities: readonly Activity[], today: Day, opts: { reviewLimit?: number } = {}): AgendaView {
  const open = tasks.filter((t) => !taskProgress(t, activities).complete);
  const byDue = (a: Task, b: Task) => (a.due < b.due ? -1 : a.due > b.due ? 1 : (a.time ?? '99') < (b.time ?? '99') ? -1 : 1);
  const dueToday = open.filter((t) => diffDays(today, t.due) <= 0).sort(byDue);
  const upcoming = open.filter((t) => diffDays(today, t.due) > 0).sort(byDue);
  const examToday = open
    .filter((t) => t.kind === 'exam' && diffDays(today, t.due) >= 0)
    .map((task) => ({ task, items: planExam(task, today, activities).days.find((d) => d.day === today)?.items.filter((i) => i.kind !== 'exam') ?? [] }))
    .filter((x) => x.items.length > 0);
  const finished = tasks
    .filter((t) => taskProgress(t, activities).complete && diffDays(t.due, today) <= 14)
    .sort((a, b) => b.updated - a.updated);
  // An exam-only nudge is redundant when today's exam plan already practises that topic.
  const planned = new Set(examToday.flatMap((e) => e.items.flatMap((i) => (i.kind === 'practice' && i.topic ? [i.topic] : []))));
  const reviews = reviewsDue(activities, tasks, today)
    .filter((r) => !(r.kind === 'exam' && planned.has(r.topic)))
    .slice(0, opts.reviewLimit ?? 4);
  return { dueToday, examToday, reviews, upcoming, finished };
}
