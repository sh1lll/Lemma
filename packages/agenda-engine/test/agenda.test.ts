import { describe, expect, it } from 'vitest';
import { Temporal } from '@lemma/date-engine';
import {
  addDays,
  agendaView,
  dayOf,
  diffDays,
  makeActivity,
  normalizeTopic,
  planExam,
  progress,
  pruneActivities,
  quality,
  reviewsDue,
  sm2,
  splitRecords,
  streaks,
  taskProgress,
  topicMemory,
  weekSentence,
  type Activity,
  type ActivityKind,
  type Day,
  type Task,
  type Topic,
} from '../src';

const NY = 'America/New_York';
let seq = 0;
/** An activity at noon New York time on `day`. */
function act(day: Day, kind: ActivityKind, topic?: Topic, correct?: boolean): Activity {
  const at = Temporal.ZonedDateTime.from(`${day}T12:00[${NY}]`).epochMilliseconds + seq;
  const a = makeActivity({ kind, ...(topic ? { topic } : {}), ...(correct !== undefined ? { correct } : {}), at }, NY, `a${++seq}`);
  if (!a) throw new Error('bad activity');
  return a;
}
const many = (n: number, day: Day, kind: ActivityKind, topic: Topic | undefined, right: number): Activity[] =>
  Array.from({ length: n }, (_, i) => act(day, kind, topic, kind === 'calc' || kind === 'lesson' ? undefined : i < right));

function mkTask(p: Partial<Task> & Pick<Task, 'due'>): Task {
  return { id: p.id ?? 'task', type: 'task', kind: 'assignment', title: 'Problem set 4', text: '', topics: [], start: '2026-10-29', created: 0, updated: 0, ...p };
}

describe('days', () => {
  it('adds and diffs across month, year and DST boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02'); // US DST ends Nov 1
    expect(addDays('2027-03-14', -1)).toBe('2027-03-13'); // US DST starts Mar 14
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(diffDays('2026-10-29', '2026-11-14')).toBe(16);
    expect(diffDays('2027-03-13', '2027-03-15')).toBe(2);
  });

  it('dayOf uses the local calendar day', () => {
    const t = Date.parse('2026-10-30T03:30:00Z');
    expect(dayOf(t, 'America/Los_Angeles')).toBe('2026-10-29');
    expect(dayOf(t, 'Asia/Tokyo')).toBe('2026-10-30');
  });
});

describe('activities', () => {
  it('normalises topics from ids, labels, keywords and problems', () => {
    expect(normalizeTopic('integral')).toBe('integral');
    expect(normalizeTopic('Integrals')).toBe('integral');
    expect(normalizeTopic('chain rule')).toBe('derivative');
    expect(normalizeTopic('solve 2x + 3 = 11')).toBe('linear');
    expect(normalizeTopic('something else')).toBeUndefined();
  });

  it('makeActivity fills id, day and drops junk', () => {
    const a = makeActivity({ kind: 'practice', topic: 'Integrals', correct: false, at: new Date('2026-10-30T03:30:00Z') }, 'America/Los_Angeles');
    expect(a).toMatchObject({ type: 'activity', kind: 'practice', topic: 'integral', correct: false, day: '2026-10-29' });
    expect(a!.id).toMatch(/^a-/);
    expect(makeActivity({ kind: 'nonsense' as ActivityKind }, NY)).toBeNull();
  });

  it('splitRecords tolerates bad and deleted records', () => {
    const ok = act('2026-10-29', 'practice', 'integral', true);
    const t = mkTask({ due: '2026-10-30', topics: ['integral', 'bogus' as Topic] });
    const { tasks, activities } = splitRecords([null, 5, { id: 'x' }, { ...t, id: 'gone', deleted: true }, t, ok, { type: 'task', id: 'y', due: 'friday' }]);
    expect(tasks.map((x) => x.id)).toEqual(['task']);
    expect(tasks[0]!.topics).toEqual(['integral']);
    expect(activities).toEqual([ok]);
  });

  it('pruneActivities keeps the recent log', () => {
    const old = act('2025-01-01', 'calc');
    const recent = act('2026-10-01', 'calc');
    expect(pruneActivities([old, recent], '2026-10-29')).toEqual([recent]);
  });
});

describe('task progress', () => {
  const task = mkTask({ due: '2026-10-30', count: 12, topics: ['derivative'] });

  it('counts matching problems between start and due ("7 of 12")', () => {
    const log = [
      ...many(5, '2026-10-29', 'practice', 'derivative', 3),
      ...many(2, '2026-10-30', 'calc', 'derivative', 0),
      act('2026-10-30', 'lesson', 'derivative'), // lessons aren't problems
      act('2026-10-30', 'practice', 'integral', true), // other topic
      act('2026-10-28', 'practice', 'derivative', true), // before the task was added
      act('2026-10-31', 'practice', 'derivative', true), // after it was due
    ];
    expect(taskProgress(task, log)).toEqual({ done: 7, total: 12, complete: false, fraction: 7 / 12 });
    expect(taskProgress({ ...task, extra: 5 }, log).complete).toBe(true);
    expect(taskProgress({ ...task, topics: [] }, log).done).toBe(8); // + the integral; still not the lesson or out-of-range ones
    expect(taskProgress({ ...task, done: true }, []).complete).toBe(true);
  });

  it('agendaView orders today, reviews and upcoming', () => {
    const tasks = [
      mkTask({ id: 'late', due: '2026-10-28' }),
      mkTask({ id: 'today', due: '2026-10-29' }),
      mkTask({ id: 'later', due: '2026-11-10' }),
      mkTask({ id: 'soon', due: '2026-11-02' }),
      mkTask({ id: 'finished', due: '2026-11-02', done: true }),
    ];
    const v = agendaView(tasks, [], '2026-10-29');
    expect(v.dueToday.map((t) => t.id)).toEqual(['late', 'today']);
    expect(v.upcoming.map((t) => t.id)).toEqual(['soon', 'later']);
    expect(v.finished.map((t) => t.id)).toEqual(['finished']);
  });
});

describe('SM-2 schedule', () => {
  it('maps accuracy to quality', () => {
    expect([quality(10, 10), quality(8, 10), quality(6, 10), quality(4, 10), quality(1, 10), quality(0, 10)]).toEqual([5, 4, 3, 2, 1, 0]);
  });

  it('grows intervals 1, 6, then × ease, and resets on a miss', () => {
    let s = { reps: 0, interval: 0, ease: 2.5 };
    const intervals: number[] = [];
    for (let i = 0; i < 4; i++) {
      s = sm2(s, 5);
      intervals.push(s.interval);
    }
    expect(intervals).toEqual([1, 6, 16, 45]);
    expect(s.ease).toBeCloseTo(2.9);
    const miss = sm2(s, 1);
    expect(miss).toMatchObject({ reps: 0, interval: 1 });
    expect(miss.ease).toBeCloseTo(2.9 - 0.54);
    expect(sm2({ reps: 0, interval: 0, ease: 1.3 }, 0).ease).toBe(1.3);
    expect(sm2({ reps: 5, interval: 50, ease: 2.5 }, 5).interval).toBe(60); // capped
  });

  it('builds one session per topic per day from the log', () => {
    const log = [...many(5, '2026-10-20', 'practice', 'integral', 5), ...many(4, '2026-10-21', 'test', 'integral', 4), act('2026-10-25', 'lesson', 'integral')];
    const m = topicMemory(log).get('integral')!;
    expect(m).toMatchObject({ reps: 2, interval: 6, due: '2026-10-27', last: '2026-10-25', right: 9, total: 9 });
  });

  it('suggests reviewing what you got wrong, the next day', () => {
    const log = many(5, '2026-10-28', 'practice', 'integral', 1);
    expect(reviewsDue(log, [], '2026-10-28')).toEqual([]);
    const [r] = reviewsDue(log, [], '2026-10-29');
    expect(r).toMatchObject({ topic: 'integral', kind: 'missed', title: 'Review integrals today', reason: 'You got 1 of 5 right yesterday.', overdue: 0 });
  });

  it('ranks missed above scheduled above stale, and drops topics done well today', () => {
    const log = [
      ...many(5, '2026-10-01', 'practice', 'derivative', 5), // due Oct 2, very overdue but well known
      ...many(4, '2026-10-27', 'exam', 'integral', 1), // missed
      act('2026-09-20', 'lesson', 'stats'), // stale (39 days idle)
      ...many(3, '2026-10-28', 'practice', 'percent', 0),
      ...many(3, '2026-10-29', 'practice', 'percent', 3), // missed yesterday, fixed today
    ];
    const r = reviewsDue(log, [], '2026-10-29');
    expect(r.map((x) => [x.topic, x.kind])).toEqual([
      ['integral', 'missed'],
      ['derivative', 'due'],
      ['stats', 'stale'],
    ]);
    expect(r[2]!.reason).toBe("You haven't practised statistics in 39 days.");
    expect(reviewsDue(log, [], '2026-10-29', { limit: 1 })).toHaveLength(1);
  });

  it('pulls exam topics forward, including ones never practised', () => {
    const exam = mkTask({ id: 'calc', kind: 'exam', title: 'Calc test', due: '2026-11-02', topics: ['derivative', 'integral'] });
    const log = many(5, '2026-10-01', 'practice', 'percent', 5).concat(many(4, '2026-10-27', 'practice', 'derivative', 4));
    const r = reviewsDue(log, [exam], '2026-10-29');
    const integral = r.find((x) => x.topic === 'integral')!;
    expect(integral).toMatchObject({ kind: 'exam', title: 'Start integrals today', taskId: 'calc' });
    expect(integral.reason).toBe('On Calc test in 4 days, and not practised yet.');
    const derivative = r.find((x) => x.topic === 'derivative')!;
    expect(derivative).toMatchObject({ kind: 'due', reason: 'Scheduled review: last practised 2 days ago. On Calc test in 4 days.', taskId: 'calc' });
    expect(r.map((x) => x.topic).indexOf('integral')).toBeLessThan(r.map((x) => x.topic).indexOf('percent'));
  });
});

describe('streaks', () => {
  it('counts consecutive days, alive until today ends', () => {
    expect(streaks(['2026-10-26', '2026-10-27', '2026-10-28'], '2026-10-29')).toEqual({ current: 3, longest: 3, activeToday: false });
    expect(streaks(['2026-10-26', '2026-10-27', '2026-10-29'], '2026-10-29')).toEqual({ current: 1, longest: 2, activeToday: true });
    expect(streaks(['2026-10-20', '2026-10-21'], '2026-10-29')).toEqual({ current: 0, longest: 2, activeToday: false });
    expect(streaks(['2026-12-31', '2027-01-01'], '2027-01-01').current).toBe(2);
  });

  it('uses local calendar days across the autumn DST change (25-hour day)', () => {
    // 00:30 EDT and 23:30 EST on Nov 1 are 24 h apart but the same local day.
    const a = Temporal.ZonedDateTime.from('2026-11-01T00:30[America/New_York]').epochMilliseconds;
    const b = a + 24 * 3_600_000;
    expect([dayOf(a, NY), dayOf(b, NY)]).toEqual(['2026-11-01', '2026-11-01']);
    const days = [Date.parse('2026-10-31T16:00:00Z'), a, b, Temporal.ZonedDateTime.from('2026-11-02T08:00[America/New_York]').epochMilliseconds].map((t) => dayOf(t, NY));
    expect(streaks(days, '2026-11-02')).toEqual({ current: 3, longest: 3, activeToday: true });
  });

  it('a spring-forward gap of 24 h can skip a local day, and the streak reflects it', () => {
    const a = Temporal.ZonedDateTime.from('2027-03-13T23:30[America/New_York]').epochMilliseconds;
    const b = a + 24 * 3_600_000; // 00:30 EDT on Mar 15: Mar 14 had only 23 hours
    expect(dayOf(b, NY)).toBe('2027-03-15');
    expect(streaks([dayOf(a, NY), dayOf(b, NY)], '2027-03-15').current).toBe(1);
  });

  it('keeps the day a session was recorded in when you travel', () => {
    // Studied at 11 pm in New York on Oct 28, then flew to Tokyo; the stored day stays Oct 28.
    const at = Temporal.ZonedDateTime.from('2026-10-28T23:00[America/New_York]').epochMilliseconds;
    const ny = makeActivity({ kind: 'practice', topic: 'integral', correct: true, at }, NY, 'x')!;
    expect(ny.day).toBe('2026-10-28');
    expect(dayOf(at, 'Asia/Tokyo')).toBe('2026-10-29');
    const tokyoToday = dayOf(at + 20 * 3_600_000, 'Asia/Tokyo'); // Oct 30 in Tokyo
    const p = progress([ny, makeActivity({ kind: 'calc', at: at + 20 * 3_600_000 }, 'Asia/Tokyo', 'y')!], tokyoToday);
    expect(p.streak).toEqual({ current: 1, longest: 1, activeToday: true });
  });
});

describe('progress', () => {
  const today = '2026-10-29';
  const log = [
    ...many(10, '2026-10-29', 'practice', 'integral', 8),
    ...many(4, '2026-10-27', 'test', 'derivative', 2),
    ...many(3, '2026-10-26', 'calc', 'percent', 0),
    act('2026-10-25', 'lesson', 'integral'),
    ...many(10, '2026-10-18', 'practice', 'integral', 5),
    act('2026-11-03', 'practice', 'integral', true), // future (clock skew on another device): ignored
  ];
  const p = progress(log, today);

  it('problems per topic', () => {
    expect(p.byTopic.map((s) => [s.topic, s.done, s.correct, s.accuracy])).toEqual([
      ['integral', 20, 13, 13 / 20],
      ['derivative', 4, 2, 0.5],
      ['percent', 3, 0, null],
    ]);
    expect(p.totalProblems).toBe(27);
  });

  it('daily counts, weekly summary and trend', () => {
    expect(p.daily).toHaveLength(14);
    expect(p.daily.at(-1)).toEqual({ day: today, problems: 10, active: true });
    expect(p.daily.find((d) => d.day === '2026-10-25')).toEqual({ day: '2026-10-25', problems: 0, active: true });
    expect(p.week).toMatchObject({ problems: 17, graded: 14, accuracy: 10 / 14, activeDays: 4, lessons: 1, topTopic: 'integral', prevProblems: 10, prevAccuracy: 0.5 });
    expect(weekSentence(p.week)).toBe('Last 7 days: 17 problems on 4 days, 71% right (up from 50%), 1 lesson. Most practised: integrals.');
    expect(p.trend).toHaveLength(8);
    expect(p.trend.at(-1)).toMatchObject({ start: '2026-10-23', end: today, graded: 14 });
    expect(p.trend.at(-2)).toMatchObject({ accuracy: 0.5, graded: 10 });
    expect(p.trend[0]!.accuracy).toBeNull();
    expect(p.streak).toEqual({ current: 1, longest: 3, activeToday: true }); // Oct 28 had nothing
  });

  it('empty log', () => {
    const e = progress([], today);
    expect(e.byTopic).toEqual([]);
    expect(e.streak.current).toBe(0);
    expect(weekSentence(e.week)).toMatch(/No study/);
  });
});

describe('exam plan', () => {
  const exam = mkTask({ id: 'calc', kind: 'exam', title: 'Calc test', due: '2026-11-14', topics: ['derivative', 'integral'], scope: 'Chapters 3–4' });

  it('plans every day to the exam, mock two days before, light review the day before', () => {
    const log = [...many(10, '2026-10-27', 'practice', 'integral', 3), ...many(10, '2026-10-27', 'practice', 'derivative', 9)];
    const plan = planExam(exam, '2026-10-29', log);
    expect(plan.daysLeft).toBe(16);
    expect(plan.days).toHaveLength(17);
    expect(plan.days[0]!.day).toBe('2026-10-29');
    expect(plan.days.at(-1)).toEqual({ day: '2026-11-14', items: [{ kind: 'exam', label: 'Calc test' }] });
    expect(plan.mockDay).toBe('2026-11-12');
    expect(plan.days.find((d) => d.day === '2026-11-12')!.items).toEqual([{ kind: 'mock', label: 'Full mock exam (Chapters 3–4)', done: false }]);
    const last = plan.days.find((d) => d.day === '2026-11-13')!.items;
    expect(last).toHaveLength(1);
    expect(last[0]).toMatchObject({ kind: 'practice', light: true, problems: 5 });

    // Weak integrals (30 %) outweigh strong derivatives (90 %).
    const w = Object.fromEntries(plan.weights.map((x) => [x.topic, x]));
    expect(w.integral!.weight).toBeGreaterThan(w.derivative!.weight);
    expect(w.integral!.share + w.derivative!.share).toBeCloseTo(1);
    let integral = 0;
    let derivative = 0;
    for (const d of plan.days.slice(0, -3)) {
      const sum = d.items.reduce((s, i) => s + (i.kind === 'practice' ? i.problems : 0), 0);
      expect(sum).toBe(10);
      for (const i of d.items) if (i.kind === 'practice') i.topic === 'integral' ? (integral += i.problems) : (derivative += i.problems);
    }
    expect(integral).toBeGreaterThan(derivative);
    expect(derivative).toBeGreaterThan(0); // every topic still visited
  });

  it('marks items done from the day’s activity', () => {
    const plan0 = planExam(exam, '2026-10-29', []);
    const first = plan0.days[0]!.items[0]!;
    if (first.kind !== 'practice') throw new Error('expected practice');
    const log = many(first.problems, '2026-10-29', 'practice', first.topic, first.problems);
    const plan1 = planExam(exam, '2026-10-29', log);
    expect(plan1.days[0]!.items.find((i) => i.kind === 'practice' && i.topic === first.topic)).toMatchObject({ done: true });
  });

  it('short countdowns', () => {
    const tomorrow = planExam({ ...exam, due: '2026-10-30' }, '2026-10-29', []);
    expect(tomorrow.days.map((d) => d.items.map((i) => i.kind))).toEqual([['mock'], ['exam']]);
    const mockDone = planExam({ ...exam, due: '2026-10-30' }, '2026-10-29', [act('2026-10-29', 'exam', 'derivative', true)]);
    expect(mockDone.days[0]!.items[0]).toMatchObject({ kind: 'mock', done: true });
    const three = planExam({ ...exam, due: '2026-11-01' }, '2026-10-29', []);
    expect(three.mockDay).toBe('2026-10-30');
    expect(three.days.map((d) => d.items[0]!.kind)).toEqual(['practice', 'mock', 'practice', 'exam']);
    expect(three.days[2]!.items[0]).toMatchObject({ light: true });
    // The mock day doesn't move as the days pass.
    expect(planExam(exam, '2026-11-12', []).mockDay).toBe('2026-11-12');
    expect(planExam(exam, '2026-11-11', []).mockDay).toBe('2026-11-12');
    const today = planExam({ ...exam, due: '2026-10-29' }, '2026-10-29', []);
    expect(today.days).toHaveLength(1);
    expect(today.days[0]!.items.map((i) => i.kind)).toEqual(['practice', 'exam']);
    expect(planExam({ ...exam, due: '2026-10-20' }, '2026-10-29', []).days).toEqual([]);
  });

  it('falls back to practised topics when the exam names none', () => {
    const log = [...many(5, '2026-10-27', 'practice', 'stats', 1), ...many(5, '2026-10-27', 'practice', 'geometry', 5)];
    const plan = planExam({ ...exam, topics: [] }, '2026-10-29', log);
    expect(plan.weights.map((w) => w.topic)).toEqual(['stats', 'geometry']);
    const none = planExam({ ...exam, topics: [] }, '2026-10-29', []);
    expect(none.days[0]!.items[0]).toMatchObject({ kind: 'practice', problems: 10, label: '10 problems' });
  });

  it('shows today’s plan in the agenda view', () => {
    const v = agendaView([exam], [], '2026-10-29');
    expect(v.examToday).toHaveLength(1);
    expect(v.examToday[0]!.items.every((i) => i.kind === 'practice')).toBe(true);
    expect(v.upcoming.map((t) => t.id)).toEqual(['calc']);
    expect(diffDays('2026-10-29', exam.due)).toBe(16);
  });
});
