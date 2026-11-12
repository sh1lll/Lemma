import { describe, expect, it } from 'vitest';
import { calculate, createSession } from '../src';

/** Functions and forms the math keyboard inserts (root, round, list statistics). */
const val = (input: string) => {
  const r = calculate(input, createSession());
  if (!r.ok) throw new Error(`"${input}" failed: ${r.error.message}`);
  return r.formatted.plain;
};

describe('keyboard templates evaluate', () => {
  it.each([
    ['root(27, 3)', '3'],
    ['root(-32, 5)', '-2'],
    ['root(16, 4)', '2'],
    ['round(2.567, 2)', '2.57'],
    ['round(2.5)', '3'],
    ['round(-2.5)', '-3'],
    ['(3)/(4)', '0.75'],
    ['abs(-4)', '4'],
    ['nPr(5, 2)', '20'],
    ['nCr(5, 2)', '10'],
    ['log(8, 2)', '3'],
    ['asin(1)', '90'],
  ])('%s = %s', (input, out) => expect(val(input)).toBe(out));
});

describe('list statistics', () => {
  it.each([
    ['mean([1, 2, 3])', '2'],
    ['mean(1, 2, 3, 4)', '2.5'],
    ['median([3, 1, 2])', '2'],
    ['median([3, 1, 2, 10])', '2.5'],
    ['var([1, 2, 3, 4])', '1.66666666667'],
    ['varp([1, 2, 3, 4])', '1.25'],
    ['stdev([2, 4, 4, 4, 5, 5, 7, 9])', '2.1380899353'],
    ['stdevp([2, 4, 4, 4, 5, 5, 7, 9])', '2'],
    ['stdevp(1, 2, 3, 4)', '1.11803398875'],
    ['max([1, 9, 2]) + min([4, 5])', '13'],
    ['mean([1, 2], [3])', '2'],
    ['mean([1, 2, 3', '2'],
  ])('%s = %s', (input, out) => expect(val(input)).toBe(out));

  it('keeps exact fractions for rational statistics', () => {
    const r = calculate('mean([1, 2])', createSession());
    expect(r.ok && r.fraction).toBe('3/2');
  });

  it('rejects a list outside a function call and too few values', () => {
    expect(calculate('[1, 2] + 1', createSession()).ok).toBe(false);
    expect(calculate('stdev([1])', createSession()).ok).toBe(false);
  });
});
