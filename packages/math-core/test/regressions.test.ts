import { describe, expect, it } from 'vitest';
import { calculate, createSession, D, parseInput, print, splitLetterProducts, type CalcSuccess } from '../src';

const calc = (q: string) => {
  const r = calculate(q, createSession());
  if (!r.ok) throw new Error(`${q}: ${r.error.message}`);
  return r as CalcSuccess;
};

describe('exact rational arithmetic', () => {
  it.each([
    ['1/3*3 - 1', '0'],
    ['1/7*7 - 1', '0'],
    ['1/3 + 1/3 + 1/3 - 1', '0'],
    ['floor(1/3*3)', '1'],
    ['(2/3)^-2', '2.25'],
    ['1e-1001 * 1e1001', '1'],
  ])('%s = %s exactly', (q, want) => {
    expect(calc(q).value.toString()).toBe(want);
    expect(calc(q).approximate).toBe(false);
  });

  it('does not offer bogus fractions', () => {
    expect(calc('1/3*3').fraction).toBeUndefined(); // was "1/1"
    expect(calc('1e-50').fraction).toBeUndefined(); // was "0/1"
    expect(calc('(2/3)^-2').fraction).toBe('9/4');
  });
});

describe('natural language', () => {
  it('reads money words after spoken numbers and "sqrt of"', () => {
    expect(calc('twelve dollars times 3').formatted.display).toBe('36');
    expect(calc('sqrt of 16').formatted.display).toBe('4');
  });
});

describe('splitLetterProducts', () => {
  const split = (q: string, keep?: (n: string) => boolean) => print(splitLetterProducts(parseInput(q, createSession()), keep));
  it('reads letter runs as products, with powers on the last letter', () => {
    expect(split('mx + b')).toBe('m × x + b');
    expect(split('ax^2 + bx + c')).toBe('a × x^2 + b × x + c');
    expect(split('sinx')).toBe('sin(x)');
    expect(split('2pix')).toBe('2 × (π × x)');
    expect(split('theta^2')).toBe('theta^2');
    expect(split('rate * x', (n) => n === 'rate')).toBe('rate × x');
  });
});

describe('spoken phrasing', () => {
  it.each([
    ['the square of 5', '25'],
    ['square of 5', '25'],
    ['what is the square of 5', '25'],
    ['the cube of 3', '27'],
    ['point five', '0.5'],
    ['point five three', '0.53'],
    ['point five plus 1', '1.5'],
    ['2 plus point 5', '2.5'],
    ['five point five', '5.5'], // a whole part is kept
    ['zero point five', '0.5'],
  ])('%s = %s', (q, want) => expect(calc(q).value.toString()).toBe(want));

  it('reads a leading + or "plus"/"minus" as a sign when there is no previous result', () => {
    for (const [q, want] of [['+5', '5'], ['plus 5', '5'], ['minus 5', '-5']] as const) {
      const r = calc(q);
      expect(r.value.toString(), q).toBe(want);
      expect(r.notes.join(' '), q).toMatch(/No previous result yet/);
    }
  });

  it('explains why "*2" / "times 3" can\'t run without a previous result', () => {
    for (const q of ['*2', 'times 3', '/ 4']) {
      const r = calculate(q, createSession());
      expect(r.ok, q).toBe(false);
      if (!r.ok) expect(r.error.message, q).toMatch(/continues from the previous result, and there isn't one yet/);
    }
  });

  it('still continues from the previous result when there is one', () => {
    const s = createSession();
    s.ans = new D(10);
    for (const [q, want] of [['+5', '15'], ['plus 5', '15'], ['*2', '20'], ['minus 5', '5']] as const) {
      const r = calculate(q, s);
      expect(r.ok && r.value.toString(), q).toBe(want);
    }
  });
});
