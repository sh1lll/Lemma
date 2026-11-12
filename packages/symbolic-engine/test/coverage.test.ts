import { createSession } from '@lemma/math-core';
import { describe, expect, it } from 'vitest';
import { answerArithmetic, answerNumberExtras, commaDecimal, parseSymbolic } from '../src';

const s = createSession();
const arith = (q: string) => {
  const r = answerArithmetic(q, s);
  if (!r || !r.ok) throw new Error(`${q}: ${r ? r.error.message : 'not recognised'}`);
  return r.primary.display;
};
const nt = (q: string) => {
  const r = answerNumberExtras(q);
  if (!r || !r.ok) throw new Error(`${q}: ${r ? r.error.message : 'not recognised'}`);
  return r.primary.display;
};

describe('equation requests', () => {
  it('solves bare equations with letter coefficients for the sensible variable', () => {
    expect(parseSymbolic('ax+bx=2', s)).toMatchObject({ op: 'solve', exprs: ["(((Symbol('a'))*(Symbol('x')))+((Symbol('b'))*(Symbol('x')))) - (2)"], rels: ['='] });
    expect(parseSymbolic('solve a x^2 + b x + c = 0 for x', s)?.vars).toEqual(['x']);
    expect(parseSymbolic('solve PV=nRT for T', s)?.exprs[0]).toContain("Symbol('T')");
    expect(parseSymbolic('solve 1/R = 1/R1 + 1/R2 for R', s)?.exprs[0]).toContain("Symbol('R1')");
  });
  it('reads comma/and lists of equations as systems, but lists of assignments as assignments', () => {
    expect(parseSymbolic('x+y=5, x-y=1', s)).toMatchObject({ op: 'solve', rels: ['=', '='] });
    expect(parseSymbolic('solve x+y=5 and x-y=1', s)?.exprs).toHaveLength(2);
    expect(parseSymbolic('a = 3, b = 4', s)).toBeNull();
    expect(parseSymbolic('x = 5', s)).toBeNull();
    expect(parseSymbolic('f(x) = x^2 + 1', s)).toBeNull();
    expect(parseSymbolic('sin(x) = 1/2', s)?.op).toBe('solve');
  });
  it('reads compound inequalities and domains', () => {
    expect(parseSymbolic('-3 < 2x + 1 < 7', s)?.rels).toEqual(['<', '<']);
    expect(parseSymbolic('solve tan(x) = sqrt(3) between 0 and 360 degrees', s)).toMatchObject({ degrees: true });
    expect(parseSymbolic('x ≠ 3', s)?.rels).toEqual(['!=']);
  });
});

describe('everyday arithmetic', () => {
  it.each([
    ['round 3.14159 to 2 decimal places', '3.14'],
    ['round 2.5 to the nearest integer', '3'],
    ['round 2.5 half to even', '2'],
    ['round 0.0045678 to 3 significant figures', '0.00457'],
    ['1 3/4 + 2 1/2', '4 1/4'],
    ['simplify 12/18', '2/3'],
    ['3/4 ÷ 1/2', '3/2'],
    ['0.(3) as a fraction', '1/3'],
    ['0.1666... as a fraction', '1/6'],
    ['3/8 as a percent', '37.5%'],
    ['17/5 as a mixed number', '3 2/5'],
    ['which is bigger 3/5 or 5/8', '5/8 > 3/5'],
    ['3:4 = x:12', 'x = 9'],
    ['share 120 in the ratio 2:3', '48 : 72'],
    ['percent change from 50 to 75', '+50%'],
    ['what percent of 80 is 20', '25%'],
    ['original price if sale price is 64 after 20% off', '80'],
    ['17 ÷ 5 with remainder', '3 r 2'],
    ['gcd of 252 and 105', '21'],
    ['lcm(4, 6, 10)', '60'],
    ['2024 in roman numerals', 'MMXXIV'],
    ['MCMXCIV to number', '1994'],
    ['spell 42', 'forty-two'],
    ['2.5 crore in millions', '25 million'],
    ['24:6', '4'],
    ['15:3 + 2', '7'],
    ['2h45m + 1h30m', '4h 15m'],
    ['45000 in scientific notation', '4.5 × 10⁴'],
    ['a^2 + b^2 where a = 3, b = 4', '25'],
  ])('%s → %s', (q, want) => expect(arith(q)).toBe(want));

  it('reads comma decimal separators when the calculator could not', () => {
    const r = commaDecimal('3,5 + 1,25', s);
    expect(r?.ok && r.primary.display).toBe('4,75');
    expect(commaDecimal('1,234 + 1', s)).toBeNull();
  });
});

describe('number theory, counting and sets', () => {
  it.each([
    ['inverse of 3 mod 11', '4'],
    ['x ≡ 2 mod 3, x ≡ 3 mod 5, x ≡ 2 mod 7', 'x ≡ 23 (mod 105)'],
    ['fibonacci 20', '6,765'],
    ['permutations of 10 taken 3', '720'],
    ['how many ways to arrange 5 books', '120'],
    ['arrangements of the letters in MISSISSIPPI', '34,650'],
    ['{1,2,3} union {3,4,5}', '{1, 2, 3, 4, 5}'],
    ['is {1,2} a subset of {1,2,3}', 'Yes'],
    ['order of (1 2 3)(4 5)', '6'],
    ['continued fraction of sqrt(7)', '[2; (1, 1, 1, 4)]'],
    ['1 + ω', 'ω'],
  ])('%s → %s', (q, want) => expect(nt(q)).toBe(want));
});
