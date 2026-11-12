import { addDays, diffDays } from './days';
import { TOPIC_IDS, topicLabel } from './topics';
import { PROBLEM_KINDS, type Activity, type Day, type Topic } from './types';

/** Progress from the activity log. A "problem" is a practice/test/exam answer or a solved calculation; lessons count only towards streaks. */

export interface TopicStat {
  topic: Topic;
  label: string;
  /** Problems done. */
  done: number;
  graded: number;
  correct: number;
  accuracy: number | null;
}

export interface Streak {
  /** Consecutive study days ending today — or yesterday, since today isn't over. */
  current: number;
  longest: number;
  activeToday: boolean;
}

export interface WeekSummary {
  problems: number;
  graded: number;
  accuracy: number | null;
  activeDays: number;
  lessons: number;
  topTopic?: Topic;
  prevProblems: number;
  prevAccuracy: number | null;
}

export interface TrendPoint {
  /** First day of the 7-day window. */
  start: Day;
  end: Day;
  graded: number;
  accuracy: number | null;
}

export interface ProgressStats {
  byTopic: TopicStat[];
  streak: Streak;
  /** Problems per day, oldest first. */
  daily: { day: Day; problems: number; active: boolean }[];
  week: WeekSummary;
  /** Accuracy per rolling 7-day window, oldest first. */
  trend: TrendPoint[];
  totalProblems: number;
}

const isProblem = (a: Activity) => PROBLEM_KINDS.includes(a.kind);
const acc = (list: readonly Activity[]) => {
  const g = list.filter((a) => a.correct !== undefined);
  return { graded: g.length, accuracy: g.length ? g.filter((a) => a.correct).length / g.length : null };
};

/** Streaks over study days. Days are local `YYYY-MM-DD`, so DST and travel can't break or double-count a day. */
export function streaks(activeDays: Iterable<Day>, today: Day): Streak {
  const set = new Set([...activeDays].filter((d) => d <= today));
  const sorted = [...set].sort();
  let longest = 0;
  let run = 0;
  let prev: Day | null = null;
  for (const d of sorted) {
    run = prev && diffDays(prev, d) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  const activeToday = set.has(today);
  let current = 0;
  let d = activeToday ? today : addDays(today, -1);
  while (set.has(d)) {
    current++;
    d = addDays(d, -1);
  }
  return { current, longest, activeToday };
}

export function progress(activities: readonly Activity[], today: Day, opts: { days?: number; weeks?: number } = {}): ProgressStats {
  const past = activities.filter((a) => a.day <= today);
  const problems = past.filter(isProblem);

  const byTopic: TopicStat[] = TOPIC_IDS.map((topic) => {
    const list = problems.filter((a) => a.topic === topic);
    const g = acc(list);
    return { topic, label: topicLabel(topic), done: list.length, graded: g.graded, correct: list.filter((a) => a.correct).length, accuracy: g.accuracy };
  })
    .filter((s) => s.done > 0)
    .sort((a, b) => b.done - a.done || TOPIC_IDS.indexOf(a.topic) - TOPIC_IDS.indexOf(b.topic));

  const nDays = opts.days ?? 14;
  const perDay = new Map<Day, number>();
  const active = new Set<Day>();
  for (const a of past) {
    active.add(a.day);
    if (isProblem(a)) perDay.set(a.day, (perDay.get(a.day) ?? 0) + 1);
  }
  const daily = Array.from({ length: nDays }, (_, i) => {
    const day = addDays(today, i - nDays + 1);
    return { day, problems: perDay.get(day) ?? 0, active: active.has(day) };
  });

  const inRange = (list: readonly Activity[], from: Day, to: Day) => list.filter((a) => a.day >= from && a.day <= to);
  const weekStart = addDays(today, -6);
  const thisWeek = inRange(past, weekStart, today);
  const lastWeek = inRange(problems, addDays(today, -13), addDays(today, -7));
  const thisProblems = thisWeek.filter(isProblem);
  const counts = new Map<Topic, number>();
  for (const a of thisProblems) if (a.topic) counts.set(a.topic, (counts.get(a.topic) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1] || TOPIC_IDS.indexOf(a[0]) - TOPIC_IDS.indexOf(b[0]))[0];
  const tw = acc(thisProblems);
  const week: WeekSummary = {
    problems: thisProblems.length,
    graded: tw.graded,
    accuracy: tw.accuracy,
    activeDays: new Set(thisWeek.map((a) => a.day)).size,
    lessons: thisWeek.filter((a) => a.kind === 'lesson').length,
    prevProblems: lastWeek.length,
    prevAccuracy: acc(lastWeek).accuracy,
    ...(top ? { topTopic: top[0] } : {}),
  };

  const nWeeks = opts.weeks ?? 8;
  const trend: TrendPoint[] = Array.from({ length: nWeeks }, (_, i) => {
    const end = addDays(today, -7 * (nWeeks - 1 - i));
    const start = addDays(end, -6);
    return { start, end, ...acc(inRange(problems, start, end)) };
  });

  return { byTopic, streak: streaks(active, today), daily, week, trend, totalProblems: problems.length };
}

/** "This week: 34 problems on 5 days, 82% right (up from 74%). Most practised: integrals." */
export function weekSentence(w: WeekSummary): string {
  if (!w.problems && !w.lessons) return 'No study logged in the last 7 days yet.';
  const parts = [`${w.problems} problem${w.problems === 1 ? '' : 's'} on ${w.activeDays} day${w.activeDays === 1 ? '' : 's'}`];
  if (w.accuracy !== null) {
    const pct = Math.round(w.accuracy * 100);
    const prev = w.prevAccuracy === null ? null : Math.round(w.prevAccuracy * 100);
    parts.push(`${pct}% right${prev === null || prev === pct ? '' : ` (${pct > prev ? 'up' : 'down'} from ${prev}%)`}`);
  }
  if (w.lessons) parts.push(`${w.lessons} lesson${w.lessons === 1 ? '' : 's'}`);
  let s = `Last 7 days: ${parts.join(', ')}.`;
  if (w.topTopic) s += ` Most practised: ${topicLabel(w.topTopic).toLowerCase()}.`;
  return s;
}
