import { D } from '@lemma/math-core';
import { describe, expect, it } from 'vitest';
import { answerCurrency, type RatesSnapshot } from '../src';

const rates: RatesSnapshot = { base: 'EUR', date: '2026-10-29', rates: { USD: 1.113 }, fetchedAt: 0, source: { name: 't', url: 'https://example.test' } };

describe('currency regressions', () => {
  it('reports a missing target rate instead of throwing', () => {
    const r = answerCurrency('100 usd to eur and yuan', rates);
    expect(r && 'ok' in r && !r.ok && r.error.message).toBe('No rate available for CNY');
  });

  it('converts one unit when no amount is given, and says so', () => {
    for (const q of ['usd to eur', 'USD to EUR', 'convert usd to eur']) {
      const r = answerCurrency(q, rates);
      expect(r && 'ok' in r && r.ok, q).toBe(true);
      if (r && 'ok' in r && r.ok) {
        expect(r.value!.toFixed(4), q).toBe(new D(1).div(1.113).toFixed(4));
        expect(r.notes.join(' '), q).toMatch(/No amount given, so this converts 1 USD/);
      }
    }
    const withAmount = answerCurrency('5 usd to eur', rates);
    expect(withAmount && 'ok' in withAmount && withAmount.ok && withAmount.notes.join(' ')).not.toMatch(/No amount/);
  });
});
