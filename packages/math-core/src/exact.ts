import { D, type Dec } from './decimal';

/**
 * Exact rational shadow of a Decimal value: numerator / denominator as BigInts, denominator > 0, in lowest terms.
 * Decimal division rounds at 50 digits, so 1/3·3 − 1 would otherwise come out as −1 × 10⁻⁵⁰ rather than 0.
 * Rational operations carry this alongside the Decimal; once the numbers get huge the shadow is dropped and the
 * Decimal result (already correct to 50 digits) stands alone.
 */
export type Exact = readonly [n: bigint, d: bigint];

const MAX_BITS = 4096;
const MAX_LITERAL_EXP = 1000;

const abs = (x: bigint) => (x < 0n ? -x : x);
function gcd(a: bigint, b: bigint): bigint {
  a = abs(a);
  b = abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}
const bits = (x: bigint) => abs(x).toString(16).length * 4;

function make(n: bigint, d: bigint): Exact | undefined {
  if (d === 0n) return undefined;
  if (d < 0n) [n, d] = [-n, -d];
  const g = gcd(n, d);
  if (g > 1n) [n, d] = [n / g, d / g];
  if (bits(n) > MAX_BITS || bits(d) > MAX_BITS) return undefined;
  return [n, d];
}

/** A numeric literal ("12.5", "1e-3", "2.5E+4") as an exact fraction. */
export function exactLiteral(s: string): Exact | undefined {
  const m = /^(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m || s.length > 1200) return undefined;
  const [, ip = '', fp = '', ex = '0'] = m;
  const e = Number(ex) - fp.length;
  if (!Number.isFinite(e) || Math.abs(e) > MAX_LITERAL_EXP) return undefined;
  const digits = BigInt((ip + fp).replace(/^0+(?=\d)/, '') || '0');
  return e >= 0 ? make(digits * 10n ** BigInt(e), 1n) : make(digits, 10n ** BigInt(-e));
}

export const exactInt = (k: number | bigint): Exact => [BigInt(k), 1n];

export const add = (a: Exact, b: Exact) => make(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
export const sub = (a: Exact, b: Exact) => make(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
export const mul = (a: Exact, b: Exact) => make(a[0] * b[0], a[1] * b[1]);
export const div = (a: Exact, b: Exact) => (b[0] === 0n ? undefined : make(a[0] * b[1], a[1] * b[0]));
export const neg = (a: Exact): Exact => [-a[0], a[1]];

export function floor(a: Exact): bigint {
  const q = a[0] / a[1];
  return a[0] < 0n && q * a[1] !== a[0] ? q - 1n : q;
}

/** Floored modulo, matching the evaluator: −7 mod 3 = 2. */
export function mod(a: Exact, b: Exact): Exact | undefined {
  const q = div(a, b);
  if (!q) return undefined;
  const p = mul(b, exactInt(floor(q)));
  return p && sub(a, p);
}

/** a^k for an integer k, when the result stays a reasonable size. */
export function pow(a: Exact, k: Dec): Exact | undefined {
  if (!k.isInteger() || k.abs().gt(MAX_BITS)) return undefined;
  const e = k.abs().toNumber();
  if (Math.max(bits(a[0]), bits(a[1])) * e > MAX_BITS * 2) return undefined;
  if (a[0] === 0n && k.isNegative()) return undefined;
  const r = make(a[0] ** BigInt(e), a[1] ** BigInt(e));
  return r && k.isNegative() ? div([1n, 1n], r) : r;
}

export const cmp = (a: Exact, b: Exact) => {
  const l = a[0] * b[1];
  const r = b[0] * a[1];
  return l < r ? -1 : l > r ? 1 : 0;
};

/** The Decimal for an exact value (rounded once, at working precision). */
export const toDec = (a: Exact): Dec => (a[1] === 1n ? new D(a[0].toString()) : new D(a[0].toString()).div(a[1].toString()));
