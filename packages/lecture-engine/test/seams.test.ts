import { describe, expect, it } from 'vitest';
import { findSeam, mergeSeams, windows } from '../src';

const R = 16000;

describe('windows', () => {
  it('empty and short audio', () => {
    expect(windows(0, R)).toEqual([]);
    expect(windows(R * 10, R)).toEqual([{ start: 0, end: R * 10 }]);
    expect(windows(R * 30, R)).toEqual([{ start: 0, end: R * 30 }]);
  });

  it('30 s windows with 2 s overlap cover every sample', () => {
    const len = R * 95 + 123;
    const w = windows(len, R);
    expect(w[0]).toEqual({ start: 0, end: 30 * R });
    expect(w[1]).toEqual({ start: 28 * R, end: 58 * R });
    expect(w.at(-1)!.end).toBe(len);
    for (let i = 1; i < w.length; i++) {
      expect(w[i]!.start).toBe(w[i - 1]!.end - 2 * R);
      expect(w[i]!.end - w[i]!.start).toBeLessThanOrEqual(30 * R);
    }
    expect(w).toHaveLength(4);
  });

  it('custom sizes', () => {
    const w = windows(100, 10, { windowSec: 3, overlapSec: 1 });
    expect(w.slice(0, 2)).toEqual([
      { start: 0, end: 30 },
      { start: 20, end: 50 },
    ]);
    expect(w.at(-1)!.end).toBe(100);
  });
});

describe('mergeSeams', () => {
  it('removes words heard in both windows', () => {
    expect(mergeSeams('so the derivative of x squared is', 'x squared is two x and that is the power rule')).toBe(
      'so the derivative of x squared is two x and that is the power rule',
    );
  });

  it('is case- and punctuation-insensitive at the seam', () => {
    expect(mergeSeams('The mean is the sum of the values.', 'Sum of the values, divided by n.')).toBe('The mean is the sum of the values, divided by n.');
  });

  it('drops a garbled fragment at either edge', () => {
    // "squ" is the cut-off end of window a; "red" the cut-off start of window b.
    expect(mergeSeams('a squared plus b squ', 'red plus b squared equals c squared')).toBe('a squared plus b squared equals c squared');
  });

  it('concatenates when nothing overlaps', () => {
    expect(mergeSeams('first window text', 'completely different words')).toBe('first window text completely different words');
    expect(mergeSeams('', 'b only')).toBe('b only');
    expect(mergeSeams('a only', '')).toBe('a only');
  });

  it('does not treat one shared short word as overlap', () => {
    expect(mergeSeams('we take the', 'the limit as h goes to zero'.replace(/^the /, 'a '))).toBe('we take the a limit as h goes to zero');
    expect(findSeam('and then the', 'the next part')).toEqual({ keepA: 3, skipB: 0 });
  });

  it('reports how much to keep and skip', () => {
    expect(findSeam('one two three four five', 'four five six seven')).toEqual({ keepA: 4, skipB: 1 });
  });
});
