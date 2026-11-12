import { describe, expect, it } from 'vitest';
import { answerDate, Temporal, type DateEngineContext } from '../src';

// Thursday 29 October 2026, 7:00 pm in New York.
const ctx: DateEngineContext = {
  now: Temporal.ZonedDateTime.from('2026-10-29T19:00[America/New_York]'),
  dateOrder: 'mdy',
  locale: 'en-US',
};

function ask(input: string) {
  const r = answerDate(input, ctx);
  if (!r) throw new Error(`"${input}" not recognised`);
  if (!r.ok) throw new Error(`"${input}" failed: ${r.error.message}`);
  return r;
}
const show = (input: string) => ask(input).primary.display;

describe('date engine', () => {
  it.each([
    ['How many days until Christmas?', '57 days'],
    ['days until dec 25', '57 days'],
    ['weeks until christmas', '8 weeks, 1 day'],
    ['business days until christmas', '41 business days'],
    ['days until new year', '64 days'],
    ['days until halloween', '2 days'],
    ['days until thanksgiving', '28 days'],
    ['days between jan 1 2026 and dec 31 2026', '364 days'],
    ['days between 2024-02-01 and 2024-03-01', '29 days'],
    ['months between march 15 2020 and today', '79 months, 14 days'],
    ['days since jan 1', '301 days'],
    ['years between march 15 2020 and today', '6 years, 7 months, 14 days'],
    ['90 days from today', 'Wednesday, January 27, 2027'],
    ['10 business days from today', 'Thursday, November 12, 2026'],
    ['3 weeks ago', 'Thursday, October 8, 2026'],
    ['in 2 months', 'Tuesday, December 29, 2026'],
    ['jan 31 2027 + 1 month', 'Sunday, February 28, 2027'],
    ['what day is july 4 2027', 'Sunday'],
    ['what day of the week was 1969-07-20', 'Sunday'],
    ['is 2028 a leap year', 'Yes'],
    ['is 2100 a leap year', 'No'],
    ['how old is someone born on may 14 1990', '36 years'],
    ['week number', 'Week 44'],
    ['day of the year', 'Day 302'],
    ['unix 1700000000', 'Tue, Nov 14, 5:13 PM 2023'],
    ['how long from 9:15am to 5:40pm', '8h 25m'],
    ['hours until 11pm', '4 hours'],
    ['easter 2027', undefined],
    ['what is the date today', 'Thursday, October 29, 2026'],
  ])('%s → %s', (input, expected) => {
    if (expected === undefined) return; // parse-only cases are covered below
    expect(show(input)).toBe(expected);
  });

  it('converts time zones', () => {
    expect(show('time in tokyo')).toBe('8:00 AM');
    expect(show('3pm new york to london')).toBe('7:00 PM');
    expect(show('9am pst in ist')).toBe('9:30 PM');
    expect(show('11pm london in tokyo')).toBe('8:00 AM (+1 day)');
    expect(ask('what time is it in sydney').lines?.[2]?.display).toBe('15h ahead');
  });

  it('computes Easter and flags ambiguous numeric dates', () => {
    expect(show('what day is easter 2027')).toBe('Sunday');
    expect(ask('what day is easter 2027').lines?.[0]?.display).toBe('Sunday, March 28, 2027');
    expect(ask('what day is 3/4/2027').notes).toContain('Read 3/4/2027 as month/day');
  });

  it('leaves non-date input alone', () => {
    expect(answerDate('5 + 5', ctx)).toBeNull();
    expect(answerDate('50 miles to km', ctx)).toBeNull();
    expect(answerDate('20% of 450', ctx)).toBeNull();
  });
});
