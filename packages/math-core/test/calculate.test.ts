import { describe, expect, it } from 'vitest';
import { calculate, commit, createSession, splitChain, type CalcSuccess, type Session } from '../src';

function ok(input: string, session: Session = createSession()): CalcSuccess {
  const r = calculate(input, session);
  if (!r.ok) throw new Error(`"${input}" failed: ${r.error.message}`);
  return r;
}
const val = (input: string, session?: Session) => ok(input, session).formatted.plain;

describe('arithmetic', () => {
  it.each([
    ['1 + 2 * 3', '7'],
    ['(1 + 2) * 3', '9'],
    ['10 / 4', '2.5'],
    ['2^10', '1024'],
    ['2^3^2', '512'],
    ['-2^2', '-4'],
    ['2^-1', '0.5'],
    ['0.1 + 0.2', '0.3'],
    ['7 mod 3', '1'],
    ['-7 mod 3', '2'],
    ['5!', '120'],
    ['|-3| + 1', '4'],
    ['1.5e3', '1500'],
    ['2(3 + 4)', '14'],
    ['2pi', '6.28318530718'],
    ['sqrt(16)', '4'],
    ['sqrt 2', '1.41421356237'],
    ['cbrt(-27)', '-3'],
    ['root(81, 4)', '3'],
    ['(-8)^(1/3)', '-2'],
    ['12,000 + 450', '12450'],
    ['1/3 + 1/6', '0.5'],
    ['ncr(5,2)', '10'],
    ['round(2.345, 2)', '2.35'],
    ['avg(2, 4, 9)', '5'],
    ['(1 + 2', '3'],
  ])('%s = %s', (input, expected) => {
    expect(val(input)).toBe(expected);
  });

  it('formats large and small numbers', () => {
    expect(ok('10^20').formatted.display).toBe('1 × 10²⁰');
    expect(ok('12000+450').formatted.display).toBe('12,450');
    expect(ok('1/3').fraction).toBe('1/3');
    expect(ok('1/3').approximate).toBe(true);
    expect(ok('1/4').approximate).toBe(false);
  });
});

describe('scientific', () => {
  it('uses degrees by default and snaps exact values', () => {
    expect(val('sin(30)')).toBe('0.5');
    expect(val('cos(90)')).toBe('0');
    expect(val('asin(1)')).toBe('90');
    expect(val('log(1000)')).toBe('3');
    expect(val('ln(e)')).toBe('1');
    expect(val('logb2 8')).toBe('3');
  });
  it('supports radians', () => {
    const s = createSession();
    s.angle = 'rad';
    expect(val('sin(pi/2)', s)).toBe('1');
    expect(val('sin(90°)', s)).toBe('1');
  });
});

describe('errors are explicit, never guessed', () => {
  it.each([
    ['1/0', 'division-by-zero'],
    ['sqrt(-1)', 'domain'],
    ['tan(90)', 'domain'],
    ['5 +', 'incomplete'],
    ['foo + 1', 'unknown-name'],
    ['2 3', 'syntax'],
    ['ans + 1', 'ambiguous-reference'],
    ['1.5!', 'domain'],
  ])('%s → %s', (input, code) => {
    const r = calculate(input, createSession());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(code);
  });
});

describe('natural language', () => {
  it.each([
    ["What's 18 percent of 275?", '49.5'],
    ['what is twenty five times four', '100'],
    ['one hundred and five divided by five', '21'],
    ['three point five plus two', '5.5'],
    ['two thirds of 90', '60'],
    ['the square root of 144', '12'],
    ['5 squared plus 3 cubed', '52'],
    ['2 to the power of 8', '256'],
    ['sine of 30 degrees', '0.5'],
    ['15% off 80', '68'],
    ['80 plus 15 percent', '92'],
    ['increase 200 by 15%', '230'],
    ['2.5 million / 4', '625000'],
    ['5 x 3', '15'],
    ['the average of 3, 4 and 5', '4'],
    ['five factorial', '120'],
    ['ten choose three', '120'],
    ['what is 7 and a half times 2', '15'],
    ['the cube root of 64', '4'],
    ['18% of $64.50', '11.61'],
    ['$1,200 * 3', '3600'],
    ['€12.50 + €7.50', '20'],
    ['15% off a $80', '68'],
  ])('%s = %s', (input, expected) => {
    expect(val(input)).toBe(expected);
  });

  it('offers the alternative grouping for "percent of … plus …"', () => {
    const r = ok('what is 20 percent of 450 plus 30');
    expect(r.formatted.plain).toBe('120');
    expect(r.alternatives.map((a) => a.formatted.plain)).toEqual(['96']);
  });

  it('flags 6/2(1+2) as ambiguous', () => {
    const r = ok('6/2(1+2)');
    expect(r.formatted.plain).toBe('9');
    expect(r.alternatives[0]?.formatted.plain).toBe('1');
  });
});

describe('conversation context', () => {
  it('follows the spec example', () => {
    const s = createSession();
    const steps: [string, string][] = [
      ["What's 20% of 450?", '90'],
      ['Add that to the original number.', '540'],
      ['Now subtract 15.', '525'],
      ['times 2', '1050'],
      ['divide by 10', '105'],
      ['* 2', '210'],
    ];
    for (const [input, expected] of steps) {
      const r = ok(input, s);
      expect(r.formatted.plain, input).toBe(expected);
      commit(s, r);
    }
  });

  it('supports variables', () => {
    const s = createSession();
    commit(s, ok('x = 12', s));
    commit(s, ok('let rate be 0.2', s));
    expect(val('x * rate', s)).toBe('2.4');
    expect(val('3x', s)).toBe('36');
  });

  it('asks rather than guesses when "the original" has no referent', () => {
    const r = calculate('add 5 to the original number', createSession());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ambiguous-reference');
  });
});

describe('custom formulas', () => {
  it('defines and calls user functions', () => {
    const s = createSession();
    commit(s, ok('f(x) = x^2 + 1', s));
    commit(s, ok('bmi(w, h) = w / h^2', s));
    expect(val('f(3)', s)).toBe('10');
    expect(val('2f(2) + 1', s)).toBe('11');
    expect(val('round(bmi(70, 1.75), 1)', s)).toBe('22.9');
    expect(calculate('f(1, 2)', s).ok).toBe(false);
    expect(calculate('sqrt(x) = 1', s).ok).toBe(false);
  });
});

describe('voice chaining', () => {
  it('splits a spoken run of steps', () => {
    expect(splitChain('5 plus 3 then times 2 then minus 4')).toEqual(['5 plus 3', 'times 2', 'minus 4']);
    expect(splitChain('12 times 8, and then divide by 4, after that add 1')).toEqual(['12 times 8', 'divide by 4', 'add 1']);
    expect(splitChain('2 + 2')).toEqual(['2 + 2']);
  });
  it('runs the steps in spoken order, each on the previous result', () => {
    const s = createSession();
    let last = '';
    for (const step of splitChain('5 plus 3 then times 2 then minus 4 then square root of that')) {
      const r = ok(step, s);
      commit(s, r);
      last = r.formatted.plain;
    }
    expect(Number(last)).toBeCloseTo(Math.sqrt(12), 9);
  });
  it('"x 3" spoken at the start means times 3', () => {
    const s = createSession();
    commit(s, ok('7', s));
    expect(val('x 3', s)).toBe('21');
  });
});

describe('"x" as times vs the variable', () => {
  it('spaced or digit-x-digit is multiplication', () => {
    expect(val('3 x 4')).toBe('12');
    expect(val('3x4')).toBe('12');
    expect(val('(2+1) x (3)')).toBe('9');
  });
  it('attached to a coefficient before a bracket, x is the variable', () => {
    const s = createSession();
    commit(s, ok('x = 2', s));
    expect(val('2x(x+1)', s)).toBe('12');
    expect(val('24x (3x^2+2)^3', s)).toBe(String(24 * 2 * 14 ** 3));
    expect(val('2x (x+1)', s)).toBe('12');
  });
});
