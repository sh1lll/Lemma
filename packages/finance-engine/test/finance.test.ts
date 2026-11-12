import type { Answer } from '@lemma/math-core';
import { D } from '@lemma/math-core';
import { describe, expect, it } from 'vitest';
import { answerFinance } from '../src';

function ask(input: string): Answer {
  const r = answerFinance(input);
  if (!r) throw new Error(`"${input}" not recognised`);
  if (!r.ok) throw new Error(`"${input}" failed: ${r.error.message}`);
  return r;
}
const show = (input: string) => ask(input).primary.display;
const line = (input: string, label: string) => ask(input).lines?.find((l) => l.label === label)?.display;

describe('finance', () => {
  it('loan payment (spec example)', () => {
    const q = 'Calculate the monthly payment on a $300,000 loan at 4.5% over 30 years.';
    expect(show(q)).toBe('$1,520.06');
    expect(line(q, 'Total interest')).toBe('$247,220.13');
    expect(ask(q).table?.rows.at(-1)?.[3]).toBe('$0.00');
  });

  it('mortgage with down payment', () => {
    expect(show('mortgage on $400k house with 20% down at 6.5% for 30 years')).toBe('$2,022.62');
  });

  it('asks for missing loan inputs instead of guessing', () => {
    const r = answerFinance('monthly payment on a $20,000 car loan over 5 years');
    expect(r?.ok).toBe(false);
    if (r && !r.ok) expect(r.error.message).toMatch(/interest rate/);
  });

  it.each([
    ['$10,000 at 5% compounded monthly for 10 years', '$16,470.09'],
    ['compound interest on 5000 at 4% for 3 years', '$5,624.32'],
    ['invest 1000 at 7% for 30 years adding 200 a month compounded monthly', '$252,110.70'],
    ['simple interest on 2000 at 3% for 5 years', '$300.00'],
    ['present value of 10000 in 5 years at 6%', '$7,472.58'],
    ['cagr from 1000 to 2500 over 5 years', '20.11%'],
    ['apy of 5% compounded daily', '5.1267%'],
    ['npv at 8% of -1000, 300, 400, 500', '$17.63'],
    ['npv at 12% of -1000, 300, 400, 500', '−$57.38'],
    ['irr of -1000, 300, 400, 500', '8.90%'],
    ['roi if i invest 1000 and get back 1500', '50%'],
  ])('%s → %s', (q, expected) => {
    expect(show(q)).toBe(expected);
  });
});

describe('shopping', () => {
  it.each([
    ['18% tip on $64.50', '$11.61'],
    ['tip 20% on 120 split 4 ways', '$24.00'],
    ['split $120 between 4 people', '$30.00'],
    ['8.25% tax on $49.99', '$54.11'],
    ['price before 8% tax on $108', '$100.00'],
    ['margin if cost is 40 and price is 60', '33.33%'],
    ['markup with cost 40 and price 60', '50%'],
    ['price for 30% margin on cost 40', '$57.14'],
    ['break even with fixed costs 5000, price 25 and variable cost 15 per unit', '500 units'],
  ])('%s → %s', (q, expected) => {
    expect(show(q)).toBe(expected);
  });

  it('shows a tip table when no rate is given', () => {
    const r = ask('tip on $80');
    expect(r.table?.rows.map((x) => x[1])).toEqual(['$12.00', '$14.40', '$16.00', '$17.60']);
  });

  it('compares unit prices (spec Experience B)', () => {
    const r = ask('Compare the price per kilogram of these three products: 500 g for $3.49, 1 kg for $5.99, 750 g for $4.99, and tell me which is cheapest');
    expect(r.primary.display).toBe('$5.99');
    expect(r.table?.highlightRow).toBe(1);
    expect(r.table?.rows.map((x) => x[3])).toEqual(['$6.98', '$5.99', '$6.65']);
    expect(r.lines?.[0]?.display).toMatch(/\$0\.66 less per kg/);
  });

  it('compares counts and multipacks', () => {
    const r = ask('which is cheaper: 12 eggs for $3.99 or 18 eggs for $5.49');
    expect(r.table?.highlightRow).toBe(1);
    expect(r.primary.unit).toBe('/ egg');
    expect(r.table?.rows[1]?.[2]).toBe('18 eggs');
    const v = ask('compare 6 x 330 ml for $4.50 vs 2 l for $2.99');
    expect(v.table?.rows.map((x) => x[3])).toEqual(['$2.27', '$1.50']);
  });

  it('ignores plain arithmetic and conversions', () => {
    expect(answerFinance('5 + 5')).toBeNull();
    expect(answerFinance('50 miles to km')).toBeNull();
  });
});

describe('follow-ups on the previous answer', () => {
  const ans = new D('97.18');
  const display = (q: string, a: InstanceType<typeof D> | null = ans) => {
    const r = answerFinance(q, { ans: a });
    return r && r.ok ? r.primary.display : null;
  };
  it('splits that / it / the bill', () => {
    expect(display('split that 3 ways')).toBe('$32.39');
    expect(display('split it between 2')).toBe('$48.59');
    expect(display('split the bill 4 ways')).toBe('$24.30');
  });
  it('tips on it', () => expect(display('tip 20% on that')).toBe('$19.44'));
  it('still asks when there is no previous answer', () => expect(display('split that 3 ways', null)).toBeNull());
  it('an explicit amount wins over the previous answer', () => expect(display('split 60 3 ways')).toBe('$20.00'));
});
