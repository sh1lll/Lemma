/**
 * Known-tricky inputs, each pinned to the answer Lemma intends, with the reason. Where people (or calculators)
 * disagree, the app picks one reading, shows it, and offers the other as an alternative; these rows lock that in.
 * Part of the build-time corpus (`npm run corpus`).
 */
import { createSession } from '@lemma/math-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { Runtime } from '../../src/router';
import { run, verdict } from './check';
import type { Case } from './generate';

type Row = Omit<Case, 'cat'> & { why: string; alt?: string };

const TRICKY: Row[] = [
  // Order of operations.
  { q: '-2^2', num: '-4', display: '−4', alt: '4', why: 'Exponent before negation (standard convention); (−2)² offered as the alternative' },
  { q: '−2²', num: '-4', display: '−4', why: 'Unicode minus and superscript read the same way' },
  { q: '(-2)^2', num: '4', display: '4', why: 'Brackets make the base negative' },
  { q: '-3^2', num: '-9', why: 'Same rule' },
  { q: '6/2(1+2)', num: '9', display: '9', alt: '1', why: 'Left to right: (6/2)·3; the "implied multiplication first" reading (1) is offered' },
  { q: '6÷2(1+2)', num: '9', alt: '1', why: '÷ is /' },
  { q: '6/(2(1+2))', num: '1', why: 'Explicit brackets' },
  { q: '2^3^2', num: '512', why: 'Powers associate to the right: 2^(3^2)' },
  { q: '8/2*4', num: '16', why: '× and ÷ left to right' },
  { q: '1/2/2', num: 0.25, fraction: '1/4', why: 'Division is left-associative' },
  { q: '10 - 5 - 2', num: '3', why: 'Subtraction is left-associative' },
  { q: '2 + 3 * 4 ^ 2 / 8 - 1', num: '7', why: 'Full precedence ladder' },
  { q: '2(3+4)', num: '14', why: 'Implied multiplication' },
  { q: '(1+2)(3+4)', num: '21', why: 'Implied multiplication of brackets' },
  // Zero, infinity and undefined.
  { q: '0^0', num: '1', display: '1', why: 'Convention used by calculators, combinatorics and power series (0⁰ = 1)' },
  { q: '1/0', error: /zero/i, why: 'Undefined, never ∞ or a huge number' },
  { q: '0/0', error: /zero/i, why: 'Undefined' },
  { q: '1/(1/0)', error: /zero/i, why: 'An undefined step poisons the whole expression' },
  { q: '5 mod 0', error: /zero/i, why: 'Undefined' },
  { q: 'log(0)', error: true, why: '−∞ is not a value' },
  { q: 'ln(0)', error: true, why: '−∞ is not a value' },
  { q: 'tan(90)', error: true, why: 'tan 90° is undefined (never 1.6 × 10¹⁶)' },
  { q: 'sqrt(-4)', error: true, why: 'Not real; complex answers (2i) come from the CAS in the browser, never a real number here' },
  { q: '(-4)^(1/2)', error: true, why: 'Not real (see sqrt(-4))' },
  { q: '0.5!', error: true, why: 'Factorial needs a whole number (the gamma function is offered separately)' },
  { q: '-0', num: '0', display: '0', why: 'No negative zero on screen' },
  { q: '0 * -1', num: '0', display: '0', why: 'No negative zero on screen' },
  { q: '(-8)^(1/3)', num: '-2', why: 'Odd roots of negatives are real' },
  { q: '(-27)^(1/3)', num: '-3', why: 'Odd roots of negatives are real' },
  // Huge and tiny numbers.
  { q: '9999999999999999 + 1', num: '10000000000000000', why: 'Beyond float precision; must stay exact' },
  { q: '2^100', num: '1267650600228229401496703205376', why: 'Exact' },
  { q: '1234567890123', num: '1234567890123', display: '1,234,567,890,123', why: 'Every digit of a 13-digit integer is shown (was 1,234,567,890,120)' },
  { q: '999999999999999', num: '999999999999999', display: '999,999,999,999,999', why: 'Largest fixed-notation integer' },
  { q: '10^100', num: '1e100', display: '1 × 10¹⁰⁰', why: 'Scientific notation past 10¹⁵' },
  { q: '1e400 / 1e399', num: '10', why: 'No overflow (decimal arithmetic, not doubles)' },
  { q: '0.000001 * 0.000001', num: '1e-12', display: '1 × 10⁻¹²', why: 'No underflow' },
  { q: '25!', num: '15511210043330985984000000', why: 'Exact' },
  { q: '100!', display: '9.33262154439 × 10¹⁵⁷', why: 'Display correct to 12 digits (the value is held to 50 significant digits)' },
  // Floating-point traps.
  { q: '0.1 + 0.2', num: '0.3', display: '0.3', fraction: '3/10', why: 'Decimal arithmetic: never 0.30000000000000004' },
  { q: '1 - 0.9', num: '0.1', display: '0.1', why: 'Decimal arithmetic' },
  { q: '0.1 * 3', num: '0.3', display: '0.3', why: 'Decimal arithmetic' },
  { q: '1/3 * 3', num: '1', display: '1', why: 'Exact rationals' },
  { q: '10/3 * 3', num: '10', why: 'Exact rationals' },
  { q: 'sqrt(2)^2', display: '2', why: 'Shown as 2 (value within 10⁻⁴⁰)' },
  { q: '√2 * √2', display: '2', why: 'Shown as 2' },
  { q: 'sin(30)^2 + cos(30)^2', display: '1', why: 'Shown as 1' },
  { q: 'cos(90)', num: '0', display: '0', why: 'Exactly 0 in degrees (never 6.1 × 10⁻¹⁷)' },
  { q: 'sin(180)', num: '0', display: '0', why: 'Exactly 0' },
  { q: '1/3', display: '0.333333333333', fraction: '1/3', why: '12 significant digits plus the exact fraction' },
  { q: '2/3', display: '0.666666666667', fraction: '2/3', why: 'Rounded half up in the last digit' },
  // Typography and locale.
  { q: '5 − 3', num: '2', why: 'Unicode minus (U+2212)' },
  { q: '−5 + 3', num: '-2', display: '−2', why: 'Leading Unicode minus' },
  { q: '3 × 4 ÷ 2', num: '6', why: '× and ÷ symbols' },
  { q: '3,5 + 1,25', num: 4.75, display: '4,75', why: 'Comma decimals: answered in the same convention' },
  { q: '1,5', num: 1.5, why: 'A lone comma decimal (one digit after the comma cannot be a thousands group)' },
  { q: '1,000 + 1', num: '1001', why: 'Comma thousands separator' },
  { q: '1,234,567 * 2', num: '2469134', why: 'Comma thousands separator' },
  { q: '.5 + .5', num: '1', why: 'Leading decimal point' },
  { q: '5.', num: '5', why: 'Trailing decimal point' },
  { q: '2 3', error: true, why: 'Two numbers with no operator: asked, never guessed (not 23, not 6)' },
  { q: '1 000 000 + 1', error: true, why: 'Space-separated thousands are refused rather than guessed (could be a list)' },
  // Percent.
  { q: '100 + 10%', num: '110', why: 'Calculator convention: a + b% is a increased by b%' },
  { q: '100 - 10%', num: '90', why: 'Calculator convention' },
  { q: '(100 + 10%) - 10%', num: '99', why: 'Percent changes compound' },
  { q: '5% + 5%', num: 0.1, display: '0.1', why: 'Two percentages add as like terms (10%), not 5% increased by 5% (was 0.0525)' },
  { q: '50% of 50%', num: 0.25, why: 'Percent of a percent' },
  { q: '17 % 5', num: 0.85, why: '% is percent (17% × 5); use "17 mod 5" for the remainder' },
  { q: '17 mod 5', num: '2', why: 'Remainder' },
  { q: '-7 mod 3', num: '2', why: 'Mathematical modulo takes the sign of the divisor' },
  { q: 'mod(17, 5)', num: '2', why: 'Function form (was "continues from the previous result")' },
  { q: '20% off $80', num: '64', display: '$64.00', why: 'Money stays money (was a bare 64)' },
  { q: '$19.99 + $5', num: 24.99, display: '$24.99', why: 'Money arithmetic to the cent, no fraction' },
  { q: '$80 / $20', num: '4', display: '4', why: 'A ratio of two amounts is a plain number' },
  { q: '¥1000 * 1.1', num: '1100', display: '¥1,100', why: 'Yen has no minor unit' },
  // Angles: degrees by default; π means radians.
  { q: 'sin(30)', num: 0.5, display: '0.5', why: 'Degrees are the default angle mode' },
  { q: 'sin(pi/6)', num: 0.5, display: '0.5', why: 'An argument in π is read as radians' },
  { q: 'asin(0.5)', num: '30', display: '30°', why: 'Inverse trig answers in degrees, with the unit shown' },
  // Rounding.
  { q: 'round 2.5', num: '3', why: 'Half away from zero (school rounding), not banker’s rounding' },
  { q: 'round -2.5', num: '-3', why: 'Half away from zero' },
  { q: 'round 2.675 to 2 decimal places', num: 2.68, why: 'Decimal input is exact (a double would give 2.67)' },
  { q: '1000 at 5% compounded annually for 3 years', num: 1157.63, display: '$1,157.63', why: '$1,157.625 rounds half up to the cent (was $1,157.62, banker’s rounding)' },
  { q: 'compound interest on 5000 at 4% for 3 years', display: '$5,624.32', why: 'Intended: the final amount, with "Interest earned" shown as a line (finance-engine test pins this)' },
  // Units with case-sensitive symbols.
  { q: '1 B to bits', num: '8', why: 'B is a byte (was read as a bit)' },
  { q: '8 b to B', num: '1', why: 'b is a bit' },
  { q: '423 B into kilobytes', num: 0.423, why: 'A unit conversion, not a 423-billion-parameter model' },
  { q: 'how many miles per hour in 100 knots', num: 115.07794480235425, rel: 1e-12, why: 'Compound target unit after "how many"' },
];

describe(`known-tricky inputs (${TRICKY.length})`, () => {
  let rt: Runtime;
  beforeAll(async () => {
    rt = new Runtime();
    await rt.loadAll();
  }, 60_000);

  for (const row of TRICKY) {
    it(`${row.q}  →  ${row.error ? 'refused' : (row.display ?? row.num)}   (${row.why})`, async () => {
      expect(verdict({ cat: 'tricky', ...row }, await run(rt, row.q))).toBeNull();
      if (row.alt) {
        const o = await rt.compute(row.q, createSession());
        expect(o.kind === 'calc' && o.result.alternatives.map((a) => a.value.toString())).toContain(row.alt);
      }
    });
  }
});
