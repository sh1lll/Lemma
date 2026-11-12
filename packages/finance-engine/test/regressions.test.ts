import { D } from '@lemma/math-core';
import { describe, expect, it } from 'vitest';
import { answerFinance } from '../src';

const r = (q: string) => answerFinance(q, { ans: new D(100) });
const show = (q: string) => {
  const a = r(q);
  if (!a || !a.ok) throw new Error(`${q}: ${a ? a.error.message : 'null'}`);
  return a.primary.display;
};
const refused = (q: string) => {
  const a = r(q);
  expect(a?.ok, q).toBe(false);
};

describe('finance regressions', () => {
  it('reads "$500 a month" as a monthly contribution, not a lump sum', () => {
    // Independent: 500·((1 + 0.07/12)^360 − 1)/(0.07/12) = 609,985.50
    expect(show('invest $500 a month at 7% compounded monthly for 30 years')).toBe('$609,985.50');
    // Annual compounding, monthly deposits at the equivalent rate (1.07^(1/12) − 1): 584,726.30
    expect(show('invest $500 a month at 7% for 30 years')).toBe('$584,726.30');
    expect(show('deposit 200 every month for 5 years at 4%')).toBe('$13,235.80');
    expect(show('what will 100 per month at 5% be worth in 10 years')).toBe('$15,436.32');
    expect(show('invest 1000 at 5% per year for 10 years')).toBe('$1,628.89');
  });

  it('refuses degenerate inputs instead of printing Infinity / NaN / negative payments', () => {
    refused('loan of 1000 at 5% over 0 years');
    refused('mortgage $400k with $500k down at 6% for 30 years');
    refused('CAGR from 1000 to 2500 over 0 years');
    refused('roi 0 and 100');
    refused('savings of 10000 at 4% for 0 years');
  });

  it('keeps a money amount after "split" as the bill', () => {
    expect(show('split $100 among 3 people with 20% tip')).toBe('$20.00');
    expect(show('tip 20% on 120 split 4 ways')).toBe('$24.00');
  });

  it('compares multi-buy deals without item words', () => {
    for (const q of ['3 for $5 vs 5 for $8', '3 for 5 vs 5 for 8', '$5 for 3 vs $8 for 5', 'compare 3 for $5 and 5 for $8']) {
      const a = r(q);
      expect(a?.ok && a.primary.display, q).toBe('$1.60');
      expect(a?.ok && a.expression, q).toMatch(/Option 2 \(5 items for \$8\.00\)/);
    }
    expect(show('3 apples for $5 vs 5 apples for $8')).toBe('$1.60');
  });

  it('never splits a bare number into a count and a price', () => {
    expect(show('break even with fixed costs 5000, price 25 and variable cost 15 per unit')).toBe('500 units');
  });

  it('reads a plain "cost" next to fixed costs as the variable cost per unit', () => {
    for (const q of ['break even fixed 1000 price 50 cost 30', 'break even fixed 1000 cost 30 price 50']) {
      const a = r(q);
      expect(a?.ok && a.primary.display, q).toBe('50 units');
      expect(a?.ok && a.notes.join(' '), q).toMatch(/variable cost per unit/);
    }
  });
});
