import { describe, expect, it } from 'vitest';
import { answerDate, Temporal, type DateEngineContext } from '../src';

const ctx: DateEngineContext = { now: Temporal.ZonedDateTime.from('2026-10-30T15:00[America/New_York]'), dateOrder: 'mdy', locale: 'en-US' };
function ask(input: string) {
  const r = answerDate(input, ctx);
  if (!r) throw new Error(`"${input}" not recognised`);
  if (!r.ok) throw new Error(`"${input}" failed: ${r.error.message}`);
  return r;
}
const show = (q: string) => ask(q).primary.display;

describe('date regressions', () => {
  it('reads two-digit birth years as the past', () => {
    expect(show('how old am i if born 1/1/85')).toBe('41 years');
    expect(show('days until 1/1/27')).toBe('63 days');
  });

  it('answers in the unit asked for', () => {
    expect(show('how many seconds until midnight')).toBe('32,400 seconds');
    expect(show('minutes until 5pm')).toBe('120 minutes');
    expect(show('until 5pm')).toBe('2 hours');
  });

  it('parses the whole time before the zone', () => {
    expect(show('9:30 am pst in ist')).toBe('10:00 PM');
    expect(show('noon utc to utc+5:30')).toBe('5:30 PM');
    expect(show('midnight london to tokyo')).toBe('9:00 AM');
  });

  it('finds zones renamed since older ICU data, and IANA ids', () => {
    expect(ask('time in kolkata').notes).toContain('IANA zone Asia/Kolkata');
    expect(show('time in kathmandu')).toBe('12:45 AM');
    expect(show('time in Asia/Kolkata')).toBe('12:30 AM');
    expect(ask('time in kyiv').expression).toBe('Time in Kyiv');
    expect(ask('time in rome').expression).toBe('Time in Rome');
  });

  it('tells the local time', () => {
    for (const q of ['what time is it', 'current time', 'the time', 'time now']) expect(show(q)).toBe('3:00 PM');
  });

  it('accepts "what date is …" phrasing for date arithmetic', () => {
    expect(ask('what date is 100 days from now').primary.plain).toBe('2027-02-07');
    expect(ask('what is the date 90 days ago').primary.plain).toBe('2026-08-01');
  });
});
