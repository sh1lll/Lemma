import { describe, expect, it } from 'vitest';
import { Temporal } from '@lemma/date-engine';
import { answerProductivity } from '../src';

const ctx = { now: Temporal.ZonedDateTime.from('2026-10-29T19:00[America/New_York]'), dateOrder: 'mdy' as const, locale: 'en-US' };
const seconds = (q: string) => {
  const r = answerProductivity(q, ctx);
  if (!r || !r.ok) throw new Error(`${q}: ${r ? r.error.message : 'null'}`);
  return r.action.type === 'timer' ? r.action.seconds : null;
};

describe('timer regressions', () => {
  it('reads seventy/eighty-something spoken minutes', () => {
    expect(seconds('seventy five minute timer')).toBe(4500); // was 5 minutes labelled "seventy"
    expect(seconds('eighty minute timer')).toBe(4800);
  });
  it('accepts days up to the 7-day cap and explains beyond it', () => {
    expect(seconds('timer for 2 days')).toBe(172800);
    const r = answerProductivity('timer for 8 days', ctx);
    expect(r && !r.ok && r.error.message).toMatch(/up to 7 days/);
  });
});
