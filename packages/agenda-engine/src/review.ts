import { addDays, diffDays } from './days';
import { TOPIC_IDS, topicNoun } from './topics';
import type { Activity, Day, Task, Topic } from './types';

/**
 * Spaced review, SM-2 per topic.
 *
 * The schedule is rebuilt from the activity log every time (nothing extra is stored, so synced devices agree):
 *  1. Graded answers (practice, test, exam, check-my-work) are grouped into one *session* per topic per day.
 *  2. The session's accuracy becomes an SM-2 quality grade q (0–5):
 *       ≥ 90 % → 5, ≥ 75 % → 4, ≥ 60 % → 3, ≥ 40 % → 2, > 0 % → 1, 0 % → 0.
 *  3. SM-2 update (Wozniak, 1987):
 *       q < 3  → repetitions = 0, interval = 1 day (see it again tomorrow)
 *       q ≥ 3  → repetitions + 1; interval = 1, then 6, then round(interval × ease)
 *       ease   = max(1.3, ease + 0.1 − (5 − q)(0.08 + (5 − q)·0.02)), starting at 2.5
 *     Intervals are capped at 60 days so nothing disappears for a whole term.
 *  4. The topic is due on (session day + interval).
 * Ungraded activity (lessons, plain calculations) only updates "last practised".
 */

export interface TopicMemory {
  topic: Topic;
  reps: number;
  interval: number;
  ease: number;
  /** Next review day. */
  due: Day;
  /** Last day with any activity on this topic. */
  last: Day;
  /** Last graded session. */
  lastSession?: { day: Day; right: number; total: number; quality: number };
  right: number;
  total: number;
}

export const MAX_INTERVAL = 60;
export const STALE_DAYS = 21;

export function quality(right: number, total: number): number {
  if (total <= 0) return 3;
  const a = right / total;
  return a >= 0.9 ? 5 : a >= 0.75 ? 4 : a >= 0.6 ? 3 : a >= 0.4 ? 2 : a > 0 ? 1 : 0;
}

/** One SM-2 step. */
export function sm2(prev: { reps: number; interval: number; ease: number }, q: number): { reps: number; interval: number; ease: number } {
  const ease = Math.max(1.3, prev.ease + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (q < 3) return { reps: 0, interval: 1, ease };
  const reps = prev.reps + 1;
  const interval = reps === 1 ? 1 : reps === 2 ? 6 : Math.min(MAX_INTERVAL, Math.max(1, Math.round(prev.interval * prev.ease)));
  return { reps, interval: Math.min(MAX_INTERVAL, interval), ease };
}

/** The review state of every topic that has any activity. */
export function topicMemory(activities: readonly Activity[]): Map<Topic, TopicMemory> {
  const sessions = new Map<string, { topic: Topic; day: Day; right: number; total: number }>();
  const last = new Map<Topic, Day>();
  for (const a of activities) {
    if (!a.topic) continue;
    const prev = last.get(a.topic);
    if (!prev || a.day > prev) last.set(a.topic, a.day);
    if (a.correct === undefined || a.kind === 'lesson') continue;
    const key = `${a.day}|${a.topic}`;
    const s = sessions.get(key) ?? { topic: a.topic, day: a.day, right: 0, total: 0 };
    s.total++;
    if (a.correct) s.right++;
    sessions.set(key, s);
  }
  const out = new Map<Topic, TopicMemory>();
  for (const s of [...sessions.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))) {
    const m = out.get(s.topic) ?? { topic: s.topic, reps: 0, interval: 0, ease: 2.5, due: s.day, last: s.day, right: 0, total: 0 };
    const q = quality(s.right, s.total);
    const next = sm2(m, q);
    Object.assign(m, next, { due: addDays(s.day, next.interval), lastSession: { day: s.day, right: s.right, total: s.total, quality: q } });
    m.right += s.right;
    m.total += s.total;
    out.set(s.topic, m);
  }
  for (const [topic, day] of last) {
    const m = out.get(topic);
    if (m) m.last = day > m.last ? day : m.last;
    else out.set(topic, { topic, reps: 0, interval: 0, ease: 2.5, due: addDays(day, STALE_DAYS), last: day, right: 0, total: 0 });
  }
  return out;
}

export type ReviewReason = 'missed' | 'due' | 'stale' | 'exam';

export interface ReviewSuggestion {
  topic: Topic;
  /** "Review integrals today". */
  title: string;
  /** Why, in a short sentence. */
  reason: string;
  kind: ReviewReason;
  /** Higher first. */
  priority: number;
  /** Days past the scheduled review (0 when due today). */
  overdue: number;
  /** The exam this helps with, if any. */
  taskId?: string;
}

export interface ReviewOptions {
  limit?: number;
  /** Not practised for this many days → suggest it even if SM-2 says later. */
  staleDays?: number;
  /** Exams within this many days pull their topics forward. */
  examHorizon?: number;
}

const days = (n: number) => (n === 1 ? '1 day' : `${n} days`);

/**
 * Reviews to do today, most useful first. Ranking (higher first):
 *   missed  — last session under 60 %:          3 + 2·(1 − accuracy) + overdue bonus
 *   due     — SM-2 review day reached:          1.5 + min(overdue / interval, 1)
 *   stale   — not practised for staleDays+:     1 + min((idle − staleDays) / staleDays, 1)
 *   exam    — on an exam within examHorizon, not practised today: 1.5 (never practised at all: 2)
 * plus up to +1.5 when the topic is on an exam soon (more the closer it is).
 * A topic practised with a passing grade today is never suggested again the same day.
 */
export function reviewsDue(activities: readonly Activity[], tasks: readonly Task[], today: Day, opts: ReviewOptions = {}): ReviewSuggestion[] {
  const staleDays = opts.staleDays ?? STALE_DAYS;
  const horizon = opts.examHorizon ?? 14;
  const mem = topicMemory(activities.filter((a) => a.day <= today));
  const exams = tasks
    .filter((t) => t.kind === 'exam' && !t.done && diffDays(today, t.due) >= 0 && diffDays(today, t.due) <= horizon)
    .sort((a, b) => (a.due < b.due ? -1 : 1));
  const examFor = (topic: Topic) => exams.find((e) => e.topics.includes(topic));
  const out: ReviewSuggestion[] = [];

  for (const m of mem.values()) {
    const s = m.lastSession;
    if (s && s.day === today && s.quality >= 3) continue;
    const exam = examFor(m.topic);
    const examBoost = exam ? 1.5 * (1 - diffDays(today, exam.due) / (horizon + 1)) : 0;
    const overdue = diffDays(m.due, today);
    const idle = diffDays(m.last, today);
    const noun = topicNoun(m.topic);
    let sug: Omit<ReviewSuggestion, 'topic' | 'title' | 'taskId'> | null = null;
    if (s && overdue >= 0 && s.quality < 3) {
      const acc = s.right / s.total;
      sug = {
        kind: 'missed',
        reason: `You got ${s.right} of ${s.total} right ${s.day === addDays(today, -1) ? 'yesterday' : `${days(diffDays(s.day, today))} ago`}.`,
        priority: 3 + 2 * (1 - acc) + Math.min(overdue, 3) * 0.1,
        overdue,
      };
    } else if (s && overdue >= 0) {
      sug = { kind: 'due', reason: `Scheduled review: last practised ${days(idle)} ago.`, priority: 1.5 + Math.min(overdue / Math.max(1, m.interval), 1), overdue };
    } else if (idle >= staleDays) {
      sug = { kind: 'stale', reason: `You haven't practised ${noun} in ${days(idle)}.`, priority: 1 + Math.min((idle - staleDays) / staleDays, 1), overdue: Math.max(0, overdue) };
    }
    if (!sug && exam && m.last !== today) sug = { kind: 'exam', reason: '', priority: 1.5, overdue: 0 };
    if (!sug) continue;
    if (exam) {
      const left = diffDays(today, exam.due);
      const when = left === 0 ? 'today' : left === 1 ? 'tomorrow' : `in ${days(left)}`;
      sug.reason = `${sug.reason ? `${sug.reason} ` : ''}On ${exam.title} ${when}.`;
    }
    out.push({ topic: m.topic, title: `Review ${noun} today`, ...sug, priority: sug.priority + examBoost, ...(exam ? { taskId: exam.id } : {}) });
  }

  // Exam topics never practised at all.
  for (const e of exams) {
    for (const topic of e.topics) {
      if (mem.has(topic) || out.some((o) => o.topic === topic)) continue;
      const left = diffDays(today, e.due);
      out.push({
        topic,
        title: `Start ${topicNoun(topic)} today`,
        reason: `On ${e.title} ${left === 0 ? 'today' : left === 1 ? 'tomorrow' : `in ${days(left)}`}, and not practised yet.`,
        kind: 'exam',
        priority: 2 + 1.5 * (1 - left / (horizon + 1)),
        overdue: 0,
        taskId: e.id,
      });
    }
  }

  out.sort((a, b) => b.priority - a.priority || TOPIC_IDS.indexOf(a.topic) - TOPIC_IDS.indexOf(b.topic));
  return opts.limit ? out.slice(0, opts.limit) : out;
}
