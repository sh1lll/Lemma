import { D } from '@lemma/math-core';

/**
 * Other ways to show a Scientific answer: a fraction (S⇔D), a mixed number (3 1/2), and an exact form for common
 * irrationals (√2, √3/2, 3π/4). Recognised from the 50-digit value, so only genuine matches are offered.
 */

type Dec = InstanceType<typeof D>;

export interface AnswerLike {
  display: string;
  fraction?: string;
  value: Dec;
}

export interface FormPrefs {
  mixed: boolean;
  exactFirst: boolean;
}

export interface AnswerForm {
  kind: 'decimal' | 'fraction' | 'mixed' | 'exact';
  text: string;
}

const pretty = (s: string) => s.replace(/^-/, '−');

/** "7/2" → "3 1/2"; proper fractions stay as they are. */
export function mixedNumber(fraction: string): string | null {
  const m = /^(-?)(\d+)\/(\d+)$/.exec(fraction.trim());
  if (!m) return null;
  const n = BigInt(m[2]!);
  const d = BigInt(m[3]!);
  if (n < d) return null;
  const whole = n / d;
  const rest = n % d;
  return `${m[1]}${whole}${rest ? ` ${rest}/${d}` : ''}`;
}

/** Best rational p/q with q ≤ maxDen, by continued fractions; null if it isn't within `tol`. */
function rationalOf(x: Dec, maxDen: number, tol: Dec): [bigint, bigint] | null {
  const neg = x.isNegative();
  let v = x.abs();
  let [p0, q0, p1, q1] = [0n, 1n, 1n, 0n];
  for (let i = 0; i < 40; i++) {
    const a = v.floor();
    const ab = BigInt(a.toFixed(0));
    [p0, q0, p1, q1] = [p1, q1, ab * p1 + p0, ab * q1 + q0];
    if (q1 > BigInt(maxDen)) {
      [p1, q1] = [p0, q0];
      break;
    }
    const frac = v.minus(a);
    if (new D(p1.toString()).div(q1.toString()).minus(x.abs()).abs().lte(tol)) break;
    if (frac.isZero()) break;
    v = new D(1).div(frac);
  }
  if (q1 === 0n) return null;
  if (new D(p1.toString()).div(q1.toString()).minus(x.abs()).abs().gt(tol)) return null;
  return [neg ? -p1 : p1, q1];
}

function squareFree(n: bigint): [bigint, bigint] {
  let out = 1n;
  let inside = n;
  for (let f = 2n; f * f <= inside && f < 10_000n; f++) {
    while (inside % (f * f) === 0n) {
      inside /= f * f;
      out *= f;
    }
  }
  return [out, inside];
}

/** √2, 2√3, √3/2, −√5/5; π/4, 3π/2, 2π. Null when the value isn't one of these. */
export function exactForm(x: Dec): string | null {
  if (x.isZero() || !x.isFinite()) return null;
  const tol = x.abs().mul('1e-30').plus('1e-40');
  // Rational multiples of π.
  const overPi = rationalOf(x.div(D.acos(-1)), 1000, tol.div(3));
  if (overPi && overPi[0] !== 0n && (overPi[0] < 0n ? -overPi[0] : overPi[0]) < 10_000n) {
    const [p, q] = overPi;
    const abs = p < 0n ? -p : p;
    return pretty(`${p < 0n ? '-' : ''}${abs === 1n ? '' : abs}π${q === 1n ? '' : `/${q}`}`);
  }
  // Square roots of rationals: x² = p/q → √(pq)/q.
  const sq = rationalOf(x.mul(x), 10_000, tol.mul(x.abs()).mul(4));
  if (sq && sq[0] > 0n) {
    const [p, q] = sq;
    const [out, inside] = squareFree(p * q);
    if (inside === 1n) return null; // rational, handled as a fraction
    if (inside > 10_000n) return null;
    const g = gcd(out, q);
    const num = out / g;
    const den = q / g;
    return pretty(`${x.isNegative() ? '-' : ''}${num === 1n ? '' : num}√${inside}${den === 1n ? '' : `/${den}`}`);
  }
  return null;
}

function gcd(a: bigint, b: bigint): bigint {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Every form worth offering for this answer, the preferred one first. */
export function answerForms(a: AnswerLike, prefs: FormPrefs): AnswerForm[] {
  const forms: AnswerForm[] = [{ kind: 'decimal', text: a.display }];
  if (a.fraction && a.fraction.includes('/')) {
    const mixed = mixedNumber(a.fraction);
    if (prefs.mixed && mixed) forms.push({ kind: 'mixed', text: pretty(mixed) });
    forms.push({ kind: 'fraction', text: pretty(a.fraction) });
    if (!prefs.mixed && mixed) forms.push({ kind: 'mixed', text: pretty(mixed) });
  } else if (!a.fraction) {
    const exact = exactForm(a.value);
    if (exact) forms.push({ kind: 'exact', text: exact });
  }
  if (prefs.exactFirst && forms.length > 1) forms.push(forms.shift()!);
  return forms;
}
