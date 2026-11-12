import { describe, expect, it } from 'vitest';
import { calculate, commit, createSession, delatex, type CalcSuccess } from '../src';

const ok = (q: string, s = createSession()) => {
  const r = calculate(q, s);
  if (!r.ok) throw new Error(`${q}: ${r.error.message}`);
  return r;
};

describe('variable definitions', () => {
  it('defines several variables at once and commits them all', () => {
    const s = createSession();
    const r = ok('a = 3, b = 4', s);
    expect(r.formatted.display).toBe('a = 3, b = 4');
    commit(s, r);
    expect(ok('a + b', s).formatted.display).toBe('7');
    commit(s, ok('p = 1 and q = p + 1', s));
    expect(s.vars.get('q')?.toString()).toBe('2');
    commit(s, ok('u = 2; v = 5', s));
    expect(ok('u*v', s).formatted.display).toBe('10');
  });
  it('accepts :=, ←, define … as and store … in', () => {
    const s = createSession();
    for (const q of ['r := 2', 'w ← 9', 'define k as 5', 'store 7 in m', 'let rate be 0.2', 'set y to 7', 'price = 19.99']) commit(s, ok(q, s) as CalcSuccess);
    expect(['r', 'w', 'k', 'm', 'rate', 'y', 'price'].map((n) => s.vars.get(n)?.toString())).toEqual(['2', '9', '5', '7', '0.2', '7', '19.99']);
  });
  it('reads a run of defined letters as a product', () => {
    const s = createSession();
    commit(s, ok('a = 3', s));
    commit(s, ok('x = 2', s));
    expect(ok('ax', s).formatted.display).toBe('6');
    expect(calculate('qq', createSession()).ok).toBe(false);
  });
});

describe('notation', () => {
  it.each([
    ['sin(pi/4)', '0.707106781187'],
    ['tg(45°)', '1'],
    ['ctg(45°)', '1'],
    ['lg(1000)', '3'],
    ['sen(30)', '0.5'],
    ['log2(8)', '3'],
    ['log_2(32)', '5'],
    ['C(5,2)', '10'],
    ['A(6,2)', '30'],
    ['10C3', '120'],
    ['⁵C₂', '10'],
    ['5‰ of 2000', '10'],
    ['½ + ¼', '0.75'],
    ['2⁵', '32'],
    ['10⁻³', '0.001'],
    ['3 lakh + 50 thousand', '350,000'],
    ['2万', '20,000'],
    ['1,00,000 + 1', '100,001'],
  ])('%s → %s', (q, want) => expect(ok(q).formatted.display).toBe(want));

  it('converts LaTeX to plain input', () => {
    expect(delatex('\\frac{1}{2} + \\frac{1}{3}')).toBe('((1)/(2)) + ((1)/(3))');
    expect(delatex('\\sqrt[3]{27}')).toBe('root(27, 3)');
    expect(delatex('x^{2} - 4 = 0')).toBe('x^(2) - 4 = 0');
    expect(delatex('\\int_0^1 x^2 dx')).toBe('integrate x^2 dx from 0 to 1');
    expect(delatex('\\lim_{x \\to 0} \\frac{\\sin x}{x}')).toBe('limit of ((sin x)/(x)) as x -> 0');
    expect(ok(delatex('\\left(1+2\\right)^2')).formatted.display).toBe('9');
  });
});
