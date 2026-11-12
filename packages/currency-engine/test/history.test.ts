import { describe, expect, it } from 'vitest';
import { HistoricalRates, parseHistorical, type DateResolver } from '../src';

const resolve: DateResolver = (t) => {
  if (/^\d{4}-\d\d-\d\d$/.test(t)) return { iso: t, notes: [] };
  if (t === 'last christmas') return { iso: '2025-12-25', notes: [] };
  if (t === 'march 2 2015') return { iso: '2015-03-02', notes: [] };
  return null;
};
const NOW = Date.parse('2026-10-29T20:00:00Z');

/** ECB reference rates (EUR base) as Frankfurter returns them for a weekend request. */
function mock(responses: Record<string, { date: string; rates: Record<string, number> } | 'fail'>) {
  const calls: string[] = [];
  const fetchFn = (async (url: string) => {
    calls.push(url);
    const d = /v1\/(\d{4}-\d\d-\d\d)\?from=EUR$/.exec(url)?.[1] ?? '';
    const r = responses[d];
    if (!r || r === 'fail') throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify({ amount: 1, base: 'EUR', date: r.date, rates: r.rates }), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

describe('historical exchange rates', () => {
  it('parses dated questions', () => {
    expect(parseHistorical('100 usd to eur on 2015-03-01', resolve)).toMatchObject({ date: '2015-03-01', parsed: { quantity: '100', from: { code: 'USD' }, to: [{ code: 'EUR' }] } });
    expect(parseHistorical('eur to gbp last christmas', resolve)).toMatchObject({ date: '2025-12-25', parsed: { quantity: '1', from: { code: 'EUR' } } });
    expect(parseHistorical('what was 50 pounds in dollars on march 2 2015?', resolve)).toMatchObject({ date: '2015-03-02', parsed: { quantity: '50', from: { code: 'GBP' } } });
    expect(parseHistorical('exchange rate usd to jpy on 2020-01-02', resolve)).toMatchObject({ parsed: { from: { code: 'USD' }, to: [{ code: 'JPY' }] } });
    expect(parseHistorical('100 usd to eur', resolve)).toBeNull();
    expect(parseHistorical('days until 2015-03-01', resolve)).toBeNull();
  });

  it('fetches once per date, converts, and says when the previous business day was used', async () => {
    const m = mock({ '2015-03-01': { date: '2015-02-27', rates: { USD: 1.124, GBP: 0.7273 } } });
    const h = new HistoricalRates({ fetchFn: m.fetchFn, now: () => NOW });
    const first = h.answer('100 usd to eur on 2015-03-01', resolve);
    expect(first).toEqual({ pending: '2015-03-01' });
    await h.request('2015-03-01');
    await h.request('2015-03-01');
    expect(m.calls).toEqual(['https://api.frankfurter.dev/v1/2015-03-01?from=EUR']);
    const r = h.answer('100 usd to eur on 2015-03-01', resolve);
    if (!r || 'pending' in r || !r.ok) throw new Error('expected an answer');
    expect(r.primary.display).toBe('€88.97');
    expect(r.source).toMatchObject({ asOf: '2015-02-27', stale: false });
    expect(r.notes.join(' ')).toMatch(/2015-03-01 was a Sunday, so this uses the previous business day’s rates \(Friday 2015-02-27\)/);
    expect(r.expression).toBe('$100.00 → EUR on 2015-03-01');
    const g = h.answer('100 usd to gbp on 2015-03-01', resolve);
    expect(g && !('pending' in g) && g.ok && g.primary.display).toBe('£64.71');
  });

  it('names TARGET holidays, refuses impossible dates, and remembers failures briefly', async () => {
    const m = mock({ '2025-12-25': { date: '2025-12-24', rates: { GBP: 0.8725 } }, '2020-01-02': 'fail' });
    const h = new HistoricalRates({ fetchFn: m.fetchFn, now: () => NOW });
    await h.request('2025-12-25');
    const r = h.answer('eur to gbp last christmas', resolve);
    expect(r && !('pending' in r) && r.ok && r.notes.join(' ')).toMatch(/no rates on 2025-12-25 \(a TARGET holiday\)/);
    const early = h.answer('100 usd to eur on 1998-12-31', resolve);
    expect(early && !('pending' in early) && !early.ok && early.error.message).toMatch(/start on 4 January 1999/);
    const future = h.answer('100 usd to eur on 2027-01-04', resolve);
    expect(future && !('pending' in future) && !future.ok && future.error.message).toMatch(/in the future/);
    await expect(h.request('2020-01-02')).rejects.toThrow(/Couldn't load historical exchange rates/);
    const failed = h.answer('100 usd to eur on 2020-01-02', resolve);
    expect(failed && !('pending' in failed) && !failed.ok).toBe(true);
  });

  it('persists past rates to storage and reloads them offline', async () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const m = mock({ '2015-03-01': { date: '2015-02-27', rates: { USD: 1.124 } } });
    await new HistoricalRates({ fetchFn: m.fetchFn, storage, now: () => NOW }).request('2015-03-01');
    const offline = new HistoricalRates({ fetchFn: mock({}).fetchFn, storage, now: () => NOW });
    const r = offline.answer('100 usd to eur on 2015-03-01', resolve);
    expect(r && !('pending' in r) && r.ok && r.primary.display).toBe('€88.97');
  });
});
