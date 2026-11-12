import { D, createSession, type Answer } from '@lemma/math-core';
import { describe, expect, it } from 'vitest';
import { answerCurrency, fetchRates, parseCurrency, type RatesSnapshot } from '../src';

const rates: RatesSnapshot = {
  base: 'EUR',
  date: '2026-10-29',
  rates: { USD: 1.113, GBP: 0.83578, JPY: 175.92, INR: 106.0345, CAD: 1.5577 },
  fetchedAt: Date.parse('2026-10-29T17:00:00Z'),
  source: { name: 'test', url: 'https://example.test' },
};
const NOW = Date.parse('2026-10-29T20:00:00Z');

function ask(input: string, session = createSession()): Answer {
  const r = answerCurrency(input, rates, session, NOW);
  if (!r || 'pending' in r) throw new Error(`"${input}" not recognised`);
  if (!r.ok) throw new Error(r.error.message);
  return r;
}

describe('currency', () => {
  it.each([
    ['100 usd to eur', '€89.85'],
    ['$50 in yen', '¥7,903'],
    ['€20 to pounds', '£16.72'],
    ['convert 1,000 yen to dollars', '$6.33'],
    ['how much is 50 euros in dollars', '$55.65'],
    ['2k gbp to inr', '₹253,737.83'],
    ['10 eur to cad', '15.58 CAD'],
  ])('%s → %s', (q, expected) => {
    expect(ask(q).primary.display).toBe(expected);
  });

  it('converts to several currencies and discloses source and assumptions', () => {
    const r = ask('100 dollars to eur, gbp and jpy');
    expect(r.lines?.slice(0, 2).map((l) => l.display)).toEqual(['£75.09', '¥15,806']);
    expect(r.notes[0]).toBe('Read "dollars" as US dollars');
    expect(r.source?.asOf).toBe('2026-10-29');
    expect(r.source?.stale).toBe(false);
  });

  it('marks old rates stale and uses the previous answer', () => {
    const s = createSession();
    s.ans = new D(10);
    const r = answerCurrency('that many eur to usd', rates, s, NOW + 7 * 86_400_000) as Answer;
    expect(r.primary.display).toBe('$11.13');
    expect(r.source?.stale).toBe(true);
  });

  it('reports pending without rates and ignores non-currency input', () => {
    expect(answerCurrency('100 usd to eur', null)).toEqual({ pending: true });
    expect(answerCurrency('50 miles to km', rates)).toBeNull();
    expect(answerCurrency('5 + 5', rates)).toBeNull();
  });

  it('validates the rate service response', async () => {
    const fake = (async () => new Response(JSON.stringify({ base: 'EUR', date: '2026-10-29', rates: { USD: 1.1, BAD: -1, x: 2 } }))) as typeof fetch;
    const snap = await fetchRates(fake);
    expect(snap.rates).toEqual({ USD: 1.1 });
    const broken = (async () => new Response('{"oops":1}')) as typeof fetch;
    await expect(fetchRates(broken)).rejects.toThrow();
  });
});

describe('shorthand thousands and long inputs', () => {
  it('"k" multiplies by a thousand, decimals included', () => {
    expect(parseCurrency('convert 1.2k yen to dollars')?.quantity).toBe('1200');
    expect(parseCurrency('5k usd to eur')?.quantity).toBe('5000');
    expect(parseCurrency('0.5k gbp to usd')?.quantity).toBe('500');
    expect(parseCurrency('2.25k eur to usd')?.quantity).toBe('2250');
  });
  it('long non-questions are rejected in linear time', () => {
    const t = performance.now();
    expect(parseCurrency('what is '.repeat(8000))).toBeNull();
    expect(performance.now() - t).toBeLessThan(50);
  });
});
