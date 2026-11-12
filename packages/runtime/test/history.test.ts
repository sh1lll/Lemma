import { createSession } from '@lemma/math-core';
import { describe, expect, it } from 'vitest';
import { outcomeToJSON, Runtime, type RouteOptions } from '../src';

const json = async (rt: Runtime, q: string, opts: RouteOptions = {}) => outcomeToJSON(await rt.compute(q, createSession(), opts), q);

describe('routing inflation, holidays and historical rates', () => {
  const rt = new Runtime();

  it('answers inflation from the bundled table', async () => {
    expect((await json(rt, "$100 in 1990 in today's dollars")).display).toBe('$240.01');
    expect((await json(rt, "what's $50,000 from 1985 worth in 2020")).display).toBe('$120,265.33');
    expect((await json(rt, 'inflation from 2000 to 2024')).display).toBe('82.17%');
    expect((await json(rt, 'inflation from 2000 to 2031')).error?.message).toMatch(/future|1913–2024/);
  });

  it('answers holiday questions', async () => {
    expect((await json(rt, 'holidays in 2026 in the UK')).display).toBe('8 bank holidays');
    expect((await json(rt, 'is July 4 2027 a holiday')).display).toMatch(/^Yes · Independence Day/);
  });

  it('historical rates respect the live-rates setting and need a rate source', async () => {
    expect((await json(rt, '100 usd to eur on 2015-03-01', { liveRates: false, requestRates: async () => Promise.reject(new Error('x')) })).error?.message).toMatch(/turned off/);
    expect((await json(rt, '100 usd to eur on 2015-03-01')).error?.message).toMatch(/not available here/);
  });

  it('fetches a dated rate once and converts', async () => {
    const { fxHistory } = await import('../src/engines/history');
    const calls: string[] = [];
    fxHistory.fetchFn = (async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ amount: 1, base: 'EUR', date: '2015-02-27', rates: { USD: 1.124 } }));
    }) as unknown as typeof fetch;
    const opts: RouteOptions = { liveRates: true, requestRates: () => Promise.reject(new Error('latest rates not used')) };
    const r = await json(rt, '100 usd to eur on 2015-03-01', opts);
    expect(r.display).toBe('€88.97');
    expect(r.source).toMatchObject({ asOf: '2015-02-27' });
    await json(rt, '200 usd to eur on 2015-03-01', opts);
    expect(calls).toHaveLength(1);
    // Ordinary conversions still use the latest rates path.
    expect((await json(rt, '100 usd to eur', opts)).error?.message).toMatch(/latest rates not used/);
  });
});
