import { describe, expect, it } from 'vitest';
import { bestGuess, misreadFixes } from '../src/solve/ocr';

// One-tap fixes for what a photo reader typically gets wrong: only plausible ones, only ones that change the line.
describe('misread fixes', () => {
  const labels = (q: string) => misreadFixes(q).map(([l]) => l);
  const fixed = (q: string, label: string) => misreadFixes(q).find(([l]) => l === label)?.[1];

  it('letters inside numbers', () => {
    expect(fixed('1S + 2', 'S → 5')).toBe('15 + 2');
    expect(fixed('3O * 2', 'O → 0')).toBe('30 * 2');
    expect(fixed('l2 - 4', 'l → 1')).toBe('12 - 4');
    expect(fixed('2z + 1', 'z → 2')).toBe('22 + 1');
  });

  it('times signs, powers and minus signs', () => {
    expect(fixed('3x4', 'x → ×')).toBe('3 * 4');
    expect(fixed('x2 + 5x + 6 = 0', 'x2 → x²')).toBe('x^2 + 5x + 6 = 0');
    expect(fixed('7 — 2', '— → −')).toBe('7 - 2');
  });

  it('offers nothing for a clean line, and never more than five', () => {
    expect(labels('2x + 3 = 11')).toEqual([]);
    expect(misreadFixes('1S2O3lzBg+4~5').length).toBeLessThanOrEqual(5);
  });

  it('the best guess puts the near-certain misreads right, and raises a power only where the layout says one was there', () => {
    expect(bestGuess('V144 + 23', 'A square root or bar may have been misread')).toBe('sqrt(144) + 2^3');
    expect(bestGuess('3X + 5 = 20', null)).toBe('3x + 5 = 20');
    expect(bestGuess('12 + 34', null)).toBe('12 + 34');
    expect(bestGuess('1S + 2', null)).toBe('15 + 2');
  });
});
