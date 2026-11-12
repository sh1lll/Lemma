import { createSession } from '@lemma/math-core';
import { describe, expect, it } from 'vitest';
import { outcomeToJSON, Runtime } from '../src';

// No symbolic backend here: an equation must reach the symbolic path (and say SymPy is unavailable), never a number.
const rt = new Runtime();
const json = async (q: string) => outcomeToJSON(await rt.compute(q, createSession(), { liveRates: false }), q);

describe('routing regressions (spoken forms)', () => {
  it.each([
    ['square root of 144', '12'], // was 20736: geometry read "square … 144" as a square's area
    ['what is the square root of 81', '9'],
    ['the cube root of 27', '3'],
    ['what is 5 times the square root of 4', '10'],
    ['square 5', '25'],
    ['2 to the power of 10', '1,024'],
    ['10 divided by 4', '2.5'],
    ['7 over 2', '3.5'],
    ['what is 3 cubed', '27'],
    ['sqrt of 16', '4'],
    ['5 in to cm', '12.7'],
    ['0 k to c', '−273.15'],
  ])('%s → %s', async (q, want) => {
    const r = await json(q);
    expect(r.ok, `${q}: ${r.error?.message}`).toBe(true);
    expect(r.display).toBe(want);
  });

  it.each(['solve x squared minus 4 equals 0', 'x squared minus 4 equals 0', 'solve 2x plus 3 equals 7', 'x cubed minus x equals 0', 'solve x squared is greater than 4'])(
    '%s goes to the equation solver, never to a number',
    async (q) => {
      const r = await json(q);
      expect(r.kind).toBe('error');
      expect(r.error?.message).toMatch(/Symbolic algebra/);
    },
  );

  it('answers the local time instead of assigning a variable called "time"', async () => {
    const r = await json('what time is it');
    expect(r.kind).toBe('answer');
    expect(r.expression).toBe('Time now');
  });

  it('routes "2pm in tokyo" (no space before pm) to time zones', async () => {
    const r = await json('2pm in tokyo');
    expect(r.kind).toBe('answer');
    expect(r.expression).toMatch(/→ Tokyo/);
  });
});
