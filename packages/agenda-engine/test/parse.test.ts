import { describe, expect, it } from 'vitest';
import { Temporal } from '@lemma/date-engine';
import { isAsk, parseTask, type Task } from '../src';

// Thursday 29 October 2026, 7:00 pm in New York.
const NOW = Temporal.ZonedDateTime.from('2026-10-29T19:00[America/New_York]');

function task(text: string, now: Temporal.ZonedDateTime | Date | number = NOW, locale = 'en-US', tz?: string): Task {
  const r = parseTask(text, now, locale, { id: 't1', ...(tz ? { timeZone: tz } : {}) });
  if (isAsk(r)) throw new Error(`"${text}" asked: ${r.ask}`);
  return r;
}

describe('parseTask: the spec examples', () => {
  it('Problem set 4 due Friday, 12 problems', () => {
    const t = task('Problem set 4 due Friday, 12 problems');
    expect(t).toMatchObject({ id: 't1', type: 'task', kind: 'assignment', title: 'Problem set 4', due: '2026-10-30', count: 12, start: '2026-10-29', topics: [] });
    expect(t.created).toBe(NOW.epochMilliseconds);
  });

  it('Calc test on the 14th, chapters 3–4', () => {
    const t = task('Calc test on the 14th, chapters 3–4');
    expect(t).toMatchObject({ kind: 'exam', title: 'Calc test', due: '2026-11-14', scope: 'Chapters 3–4', topics: ['derivative', 'integral'], topicsGuessed: true });
    expect(t.count).toBeUndefined();
  });

  it('named topics win over the subject guess', () => {
    const t = task('Calc test on the 14th, chapter 3 derivatives');
    expect(t.topics).toEqual(['derivative']);
    expect(t.topicsGuessed).toBeUndefined();
    expect(t.scope).toBe('Chapter 3');
  });
});

describe('parseTask: dates', () => {
  it.each([
    // weekdays (Thursday today)
    ['Worksheet due friday', '2026-10-30'],
    ['Worksheet due Fri', '2026-10-30'],
    ['Worksheet due Monday', '2026-11-02'],
    ['Worksheet due thursday', '2026-10-29'],
    ['Worksheet due next thursday', '2026-11-05'],
    ['Quiz this Tuesday', '2026-11-03'],
    ['Problems due on sat', '2026-10-31'],
    // relative
    ['Homework due today', '2026-10-29'],
    ['Homework due tonight', '2026-10-29'],
    ['Homework due tomorrow', '2026-10-30'],
    ['Homework due the day after tomorrow', '2026-10-31'],
    ['Project in 2 weeks', '2026-11-12'],
    ['Project in two weeks', '2026-11-12'],
    ['Project in a week', '2026-11-05'],
    ['Project in 10 days', '2026-11-08'],
    ['Project in a couple of days', '2026-10-31'],
    ['Project in 1 month', '2026-11-29'],
    ['Project 3 days from now', '2026-11-01'],
    ['Reading by the end of the week', '2026-10-30'],
    ['Reading by end of month', '2026-10-31'],
    ['Reading this weekend', '2026-10-31'],
    ['Reading next week', '2026-11-06'],
    // day of month
    ['Exam on the 14th', '2026-11-14'],
    ['Exam on the fourteenth', '2026-11-14'],
    ['Exam on the 29th', '2026-10-29'],
    ['Exam on the 28th', '2026-11-28'],
    ['Exam on the 31st', '2026-10-31'],
    ['Exam on the 3rd', '2026-11-03'],
    ['Exam on the twenty-first', '2026-11-21'],
    // month names and numbers
    ['Final exam December 14th', '2026-12-14'],
    ['Final exam on Dec 14', '2026-12-14'],
    ['Final exam 14 december', '2026-12-14'],
    ['Final exam on the 13th of november', '2026-11-13'],
    ['Exam friday the 13th of november', '2026-11-13'],
    ['Midterm March 3', '2027-03-03'],
    ['Midterm 11/3', '2026-11-03'],
    ['Midterm 2026-12-01', '2026-12-01'],
    ['Midterm 1/15/2027', '2027-01-15'],
  ])('%s → %s', (text, due) => {
    expect(task(text).due).toBe(due);
  });

  it('skips months without the day ("on the 31st" in November → December 31)', () => {
    expect(task('Quiz on the 31st', Temporal.ZonedDateTime.from('2026-11-02T10:00[America/New_York]')).due).toBe('2026-12-31');
  });

  it('reads numeric dates in the locale order', () => {
    expect(task('Worksheet due 3/11', NOW, 'en-GB').due).toBe('2026-11-03');
    expect(task('Worksheet due 3/11', NOW, 'en-US').due).toBe('2027-03-11');
  });

  it('takes "today" in the given time zone when now is a timestamp', () => {
    const at = new Date('2026-10-30T03:00:00Z'); // Oct 29, 8 pm in LA; Oct 30, noon in Tokyo
    expect(task('Quiz tomorrow', at, 'en-US', 'America/Los_Angeles').due).toBe('2026-10-30');
    expect(task('Quiz tomorrow', at.getTime(), 'en-US', 'Asia/Tokyo').due).toBe('2026-10-31');
  });

  it('keeps a time of day', () => {
    const t = task('Algebra quiz tomorrow at 9am');
    expect(t).toMatchObject({ due: '2026-10-30', time: '09:00', kind: 'exam', title: 'Algebra quiz' });
    expect(task('Problem set due Friday 11:59 pm').time).toBe('23:59');
  });

  it('does not read SAT as Saturday', () => {
    const t = task('SAT practice test on the 7th');
    expect(t.due).toBe('2026-11-07');
    expect(t.kind).toBe('exam');
    expect(t.title).toBe('SAT practice test');
  });
});

describe('parseTask: counts, topics, titles', () => {
  it.each([
    ['20 integral problems in 2 weeks', 20, ['integral']],
    ['Problem set five due Friday, twelve problems', 12, []],
    ['Stats homework due 11/3, problems 1-29 odd', 15, ['stats']],
    ['Textbook #2-20 even due Monday', 10, []],
    ['Questions 5 to 14 on derivatives due monday', 10, ['derivative']],
    ['Do 8 more chain rule problems tomorrow', 8, ['derivative']],
  ])('%s → %d problems', (text, count, topics) => {
    const t = task(text);
    expect(t.count).toBe(count);
    expect(t.topics).toEqual(topics);
  });

  it('builds clean titles', () => {
    expect(task('Problem set five due Friday, twelve problems').title).toBe('Problem set 5');
    expect(task('Stats homework due 11/3, problems 1-29 odd').title).toBe('Stats homework, problems 1-29 odd');
    expect(task('add: geometry worksheet due monday').title).toBe('Geometry worksheet');
    expect(task('20 integral problems in 2 weeks').title).toBe('Problems');
  });

  it('classifies the kind', () => {
    expect(task('Midterm on the 14th').kind).toBe('exam');
    expect(task('Quiz friday').kind).toBe('exam');
    expect(task('Homework friday').kind).toBe('assignment');
    expect(task('Read about logarithms friday')).toMatchObject({ kind: 'study', topics: ['exponents'] });
  });

  it('maps several topics', () => {
    expect(task('Test on the 14th: quadratics, systems of equations and percentages').topics).toEqual(['percent', 'quadratic', 'system']);
  });
});

describe('parseTask: asks when it cannot tell', () => {
  it('asks for a missing date', () => {
    const r = parseTask('Problem set 5, 10 problems', NOW);
    expect(isAsk(r) && r.ask).toMatch(/When is "Problem set 5" due\?/);
    const e = parseTask('Calc test, chapters 3-4', NOW);
    expect(isAsk(e) && e.ask).toMatch(/^When is Calc test\?/);
  });

  it('asks when the date has passed', () => {
    const r = parseTask('Problem set due 2026-10-01', NOW);
    expect(isAsk(r) && r.ask).toMatch(/October 1, 2026 has already passed/);
  });

  it('asks for something to add when empty', () => {
    expect(isAsk(parseTask('   ', NOW))).toBe(true);
  });

  it('gives each task a unique id by default', () => {
    const a = parseTask('Quiz friday', NOW) as Task;
    const b = parseTask('Quiz friday', NOW) as Task;
    expect(a.id).not.toBe(b.id);
    expect(a.id).toMatch(/^t-/);
  });
});
