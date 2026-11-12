import { addDays, diffDays } from './days';
import { TOPIC_IDS, topicAdjective, topicLabel } from './topics';
import { PROBLEM_KINDS, type Activity, type Day, type Task, type Topic } from './types';

/**
 * Countdown plan for an exam task: suggested practice per day from today until the exam, weighted towards
 * weak and neglected topics, with one full mock exam near the end.
 *
 *  Weights (per topic on the exam):   never practised → 1.5
 *                                      otherwise       → 0.5 + 2·(1 − accuracy over the last 30 days)
 *                                                        + 0.5·min(days since last practice / 14, 1)
 *  Each practice day picks the 1–2 topics with the most accumulated weight ("credit", weighted round-robin),
 *  so heavier topics come up more often but every topic is visited. A day's problems are split by weight.
 *
 *  Mock exam:  two days before the exam, and the day before is a light review. The mock day is anchored to
 *              the exam (not to today), so it stays put as the plan is recomputed day by day.
 *              Exam tomorrow → the mock is today. Exam today → no mock; a short warm-up on the weakest topic.
 *
 * The plan is recomputed from today and the latest history, so it adapts as you practise.
 */

export type PlanItem =
  | { kind: 'practice'; topic?: Topic; problems: number; label: string; done: boolean; light?: boolean }
  | { kind: 'mock'; label: string; done: boolean }
  | { kind: 'exam'; label: string };

export interface PlanDay {
  day: Day;
  items: PlanItem[];
}

export interface TopicWeight {
  topic: Topic;
  weight: number;
  /** Share of practice, 0–1. */
  share: number;
  accuracy: number | null;
}

export interface ExamPlan {
  taskId: string;
  examDay: Day;
  daysLeft: number;
  weights: TopicWeight[];
  days: PlanDay[];
  mockDay?: Day;
}

export interface PlanOptions {
  problemsPerDay?: number;
}

export function topicWeights(topics: readonly Topic[], activities: readonly Activity[], today: Day): TopicWeight[] {
  const since = addDays(today, -30);
  const raw = topics.map((topic) => {
    const mine = activities.filter((a) => a.topic === topic && a.day <= today);
    if (!mine.length) return { topic, weight: 1.5, accuracy: null };
    const graded = mine.filter((a) => a.correct !== undefined && a.day >= since);
    const accuracy = graded.length ? graded.filter((a) => a.correct).length / graded.length : null;
    const last = mine.reduce((d, a) => (a.day > d ? a.day : d), mine[0]!.day);
    const idle = Math.min(diffDays(last, today) / 14, 1);
    return { topic, weight: 0.5 + 2 * (1 - (accuracy ?? 0.5)) + 0.5 * idle, accuracy };
  });
  const sum = raw.reduce((s, r) => s + r.weight, 0) || 1;
  return raw.map((r) => ({ ...r, weight: Math.round(r.weight * 1000) / 1000, share: r.weight / sum }));
}

function doneOn(activities: readonly Activity[], day: Day, topic: Topic | undefined): number {
  return activities.filter((a) => a.day === day && PROBLEM_KINDS.includes(a.kind) && a.kind !== 'exam' && (topic === undefined || a.topic === topic)).length;
}

/** Fallback topics when an exam names none: what you've practised, weakest first. */
function fallbackTopics(activities: readonly Activity[], today: Day): Topic[] {
  const seen = TOPIC_IDS.filter((t) => activities.some((a) => a.topic === t));
  return topicWeights(seen, activities, today)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4)
    .map((w) => w.topic);
}

export function planExam(task: Task, today: Day, activities: readonly Activity[], opts: PlanOptions = {}): ExamPlan {
  const per = Math.max(3, opts.problemsPerDay ?? 10);
  const examDay = task.due;
  const daysLeft = diffDays(today, examDay);
  const topics = task.topics.length ? [...task.topics] : fallbackTopics(activities, today);
  const weights = topicWeights(topics, activities, today);
  const plan: ExamPlan = { taskId: task.id, examDay, daysLeft, weights, days: [] };
  if (daysLeft < 0) return plan;

  const byWeight = [...weights].sort((a, b) => b.weight - a.weight || TOPIC_IDS.indexOf(a.topic) - TOPIC_IDS.indexOf(b.topic));
  const weakest = byWeight[0]?.topic;
  const mockDone = (from: Day) => activities.some((a) => a.kind === 'exam' && a.day >= from && a.day < examDay);
  const practice = (day: Day, topic: Topic | undefined, problems: number, light = false): PlanItem => {
    const label = `${light ? 'Light review: ' : ''}${problems} ${topic ? `${topicAdjective(topic)} ` : ''}problem${problems === 1 ? '' : 's'}`;
    return { kind: 'practice', topic, problems, label, done: doneOn(activities, day, topic) >= problems, ...(light ? { light } : {}) };
  };

  if (daysLeft === 0) {
    plan.days.push({ day: today, items: [practice(today, weakest, Math.min(5, per), true), { kind: 'exam', label: `${task.title} today` }] });
    return plan;
  }

  const mockDay = daysLeft >= 2 ? addDays(examDay, -2) : today;
  plan.mockDay = mockDay;
  const credit = new Map<Topic, number>(weights.map((w) => [w.topic, 0]));
  for (let i = 0; i < daysLeft; i++) {
    const day = addDays(today, i);
    if (day === mockDay) {
      plan.days.push({ day, items: [{ kind: 'mock', label: `Full mock exam${task.scope ? ` (${task.scope})` : ''}`, done: mockDone(day) }] });
      continue;
    }
    const light = daysLeft >= 2 && i === daysLeft - 1;
    if (!weights.length) {
      plan.days.push({ day, items: [practice(day, undefined, light ? Math.ceil(per / 2) : per, light)] });
      continue;
    }
    // Weighted round-robin: everyone earns their weight; the richest 1–2 topics are practised and pay it back.
    for (const w of weights) credit.set(w.topic, (credit.get(w.topic) ?? 0) + w.weight);
    const pick = [...weights]
      .sort((a, b) => credit.get(b.topic)! - credit.get(a.topic)! || TOPIC_IDS.indexOf(a.topic) - TOPIC_IDS.indexOf(b.topic))
      .slice(0, Math.min(light ? 1 : 2, weights.length));
    const total = weights.reduce((s, w) => s + w.weight, 0);
    const pickSum = pick.reduce((s, w) => s + w.weight, 0);
    for (const p of pick) credit.set(p.topic, credit.get(p.topic)! - total * (p.weight / pickSum));
    const budget = light ? Math.ceil(per / 2) : per;
    let left = budget;
    const items = pick.map((p, idx) => {
      const n = idx === pick.length - 1 ? left : Math.max(3, Math.round((budget * p.weight) / pickSum));
      left -= n;
      return practice(day, p.topic, Math.max(1, n), light);
    });
    plan.days.push({ day, items });
  }
  plan.days.push({ day: examDay, items: [{ kind: 'exam', label: `${task.title}${task.time ? ` at ${task.time}` : ''}` }] });
  return plan;
}

/** "Derivatives 60 %, Integrals 40 %". */
export function describeWeights(w: readonly TopicWeight[]): string {
  return w.map((x) => `${topicLabel(x.topic)} ${Math.round(x.share * 100)}%`).join(', ');
}
