import { D, type Dec } from './decimal';
import { MathError } from './errors';

export type AngleMode = 'deg' | 'rad';

interface FnCtx {
  angle: AngleMode;
}

interface FnDef {
  min: number;
  max: number;
  /** Rational-preserving functions keep exact fraction display available (abs, floor, nCr, …). */
  rational?: boolean;
  fn: (a: Dec[], ctx: FnCtx) => Dec;
}

const PI = D.acos(-1);
const DEG = PI.div(180);
const FACTORIAL_LIMIT = 5000;

const toRad = (x: Dec, ctx: FnCtx) => (ctx.angle === 'deg' ? x.mul(DEG) : x);
const fromRad = (x: Dec, ctx: FnCtx) => (ctx.angle === 'deg' ? x.div(DEG) : x);

function requireInt(x: Dec, what: string): void {
  if (!x.isInteger()) throw new MathError('domain', `${what} needs a whole number`);
}

export function factorial(n: Dec): Dec {
  requireInt(n, 'Factorial');
  if (n.isNegative()) throw new MathError('domain', 'Factorial of a negative number is undefined');
  if (n.gt(FACTORIAL_LIMIT)) throw new MathError('overflow', `Factorial is limited to n ≤ ${FACTORIAL_LIMIT}`);
  let r = new D(1);
  for (let k = 2, end = n.toNumber(); k <= end; k++) r = r.mul(k);
  return r;
}

/** n!! = n·(n−2)·(n−4)·…, down to 1 or 2. */
export function doubleFactorial(n: Dec): Dec {
  requireInt(n, 'Double factorial');
  if (n.lt(-1)) throw new MathError('domain', 'Double factorial is only defined for n ≥ −1');
  if (n.gt(FACTORIAL_LIMIT * 2)) throw new MathError('overflow', `Double factorial is limited to n ≤ ${FACTORIAL_LIMIT * 2}`);
  let r = new D(1);
  for (let k = n.toNumber(); k > 1; k -= 2) r = r.mul(k);
  return r;
}

function combinations(n: Dec, k: Dec): Dec {
  requireInt(n, 'nCr');
  requireInt(k, 'nCr');
  if (n.isNegative() || k.isNegative()) throw new MathError('domain', 'nCr needs non-negative arguments');
  if (k.gt(n)) return new D(0);
  const kk = D.min(k, n.minus(k)).toNumber();
  let r = new D(1);
  for (let i = 1; i <= kk; i++) r = r.mul(n.minus(kk).plus(i)).div(i);
  return r.round();
}

function permutations(n: Dec, k: Dec): Dec {
  requireInt(n, 'nPr');
  requireInt(k, 'nPr');
  if (n.isNegative() || k.isNegative()) throw new MathError('domain', 'nPr needs non-negative arguments');
  if (k.gt(n)) return new D(0);
  let r = new D(1);
  for (let i = 0, end = k.toNumber(); i < end; i++) r = r.mul(n.minus(i));
  return r;
}

function gcd(a: Dec, b: Dec): Dec {
  requireInt(a, 'gcd');
  requireInt(b, 'gcd');
  a = a.abs();
  b = b.abs();
  while (!b.isZero()) [a, b] = [b, a.mod(b)];
  return a;
}

function sqrt(x: Dec): Dec {
  if (x.isNegative()) throw new MathError('domain', 'Square root of a negative number has no real result');
  return x.sqrt();
}

function nthRoot(x: Dec, n: Dec): Dec {
  requireInt(n, 'Root index');
  if (n.isZero()) throw new MathError('domain', 'The 0th root is undefined');
  if (x.isNegative()) {
    // Odd roots of negatives are real: ∛−8 = −2.
    if (n.mod(2).isZero()) throw new MathError('domain', 'Even root of a negative number has no real result');
    return nthRoot(x.neg(), n).neg();
  }
  return n.eq(2) ? x.sqrt() : n.eq(3) ? x.cbrt() : x.pow(new D(1).div(n));
}

function log(x: Dec, base?: Dec): Dec {
  // Zero gets its own message: it isn't a complex-number question (the router sends those to the CAS).
  if (x.isZero()) throw new MathError('domain', 'The logarithm of 0 is undefined (it falls to −∞)');
  if (x.lt(0)) throw new MathError('domain', 'Logarithm is only defined for positive numbers');
  if (!base) return D.log10(x);
  if (base.lte(0) || base.eq(1)) throw new MathError('domain', 'Logarithm base must be positive and not 1');
  return D.ln(x).div(D.ln(base));
}

function tan(x: Dec, ctx: FnCtx): Dec {
  // tan is undefined at odd multiples of 90°; the float-free Decimal result would otherwise be a huge bogus number.
  const quarterTurns = ctx.angle === 'deg' ? x.div(90) : x.div(PI.div(2));
  if (quarterTurns.isInteger() && !quarterTurns.mod(2).isZero()) throw new MathError('domain', 'tan is undefined here');
  return D.tan(toRad(x, ctx));
}

function inverseTrig(f: (x: Dec) => Dec, name: string, bounded: boolean) {
  return (a: Dec[], ctx: FnCtx) => {
    const x = a[0]!;
    if (bounded && x.abs().gt(1)) throw new MathError('domain', `${name} is only defined for −1 ≤ x ≤ 1`);
    return fromRad(f(x), ctx);
  };
}

const one = (f: (x: Dec, ctx: FnCtx) => Dec, rational = false): FnDef => ({ min: 1, max: 1, rational, fn: (a, ctx) => f(a[0]!, ctx) });

export const FUNCTIONS: Record<string, FnDef> = {
  sqrt: one(sqrt),
  cbrt: one((x) => nthRoot(x, new D(3))),
  root: { min: 2, max: 2, fn: (a) => nthRoot(a[0]!, a[1]!) },
  abs: one((x) => x.abs(), true),
  sign: one((x) => new D(x.isZero() ? 0 : x.isNegative() ? -1 : 1), true),
  floor: one((x) => x.floor(), true),
  ceil: one((x) => x.ceil(), true),
  trunc: one((x) => x.trunc(), true),
  round: {
    min: 1,
    max: 2,
    rational: true,
    fn: (a) => {
      const places = a[1] ?? new D(0);
      requireInt(places, 'round places');
      return a[0]!.toDecimalPlaces(places.toNumber(), D.ROUND_HALF_UP);
    },
  },
  ln: one((x) => {
    if (x.lte(0)) throw new MathError('domain', 'ln is only defined for positive numbers');
    return D.ln(x);
  }),
  log: { min: 1, max: 2, fn: (a) => log(a[0]!, a[1]) },
  exp: one((x) => D.exp(x)),
  sin: one((x, c) => D.sin(toRad(x, c))),
  cos: one((x, c) => D.cos(toRad(x, c))),
  tan: one(tan),
  sec: one((x, c) => new D(1).div(D.cos(toRad(x, c)))),
  csc: one((x, c) => new D(1).div(D.sin(toRad(x, c)))),
  cot: one((x, c) => new D(1).div(tan(x, c))),
  asin: { min: 1, max: 1, fn: inverseTrig((x) => D.asin(x), 'asin', true) },
  acos: { min: 1, max: 1, fn: inverseTrig((x) => D.acos(x), 'acos', true) },
  atan: { min: 1, max: 1, fn: inverseTrig((x) => D.atan(x), 'atan', false) },
  sinh: one((x) => D.sinh(x)),
  cosh: one((x) => D.cosh(x)),
  tanh: one((x) => D.tanh(x)),
  asinh: one((x) => D.asinh(x)),
  acosh: one((x) => {
    if (x.lt(1)) throw new MathError('domain', 'acosh is only defined for x ≥ 1');
    return D.acosh(x);
  }),
  atanh: one((x) => {
    if (x.abs().gte(1)) throw new MathError('domain', 'atanh is only defined for −1 < x < 1');
    return D.atanh(x);
  }),
  fact: one(factorial, true),
  dfact: one(doubleFactorial, true),
  ncr: { min: 2, max: 2, rational: true, fn: (a) => combinations(a[0]!, a[1]!) },
  npr: { min: 2, max: 2, rational: true, fn: (a) => permutations(a[0]!, a[1]!) },
  gcd: { min: 2, max: 2, rational: true, fn: (a) => gcd(a[0]!, a[1]!) },
  lcm: {
    min: 2,
    max: 2,
    rational: true,
    fn: (a) => {
      const g = gcd(a[0]!, a[1]!);
      return g.isZero() ? g : a[0]!.mul(a[1]!).abs().div(g);
    },
  },
  avg: { min: 1, max: Infinity, rational: true, fn: (a) => a.reduce((x, y) => x.plus(y), new D(0)).div(a.length) },
  min: { min: 1, max: Infinity, rational: true, fn: (a) => D.min(...a) },
  max: { min: 1, max: Infinity, rational: true, fn: (a) => D.max(...a) },
  // List statistics (the keyboard's func tab): median, sample and population variance / standard deviation.
  median: { min: 1, max: Infinity, rational: true, fn: (a) => median(a) },
  var: { min: 2, max: Infinity, rational: true, fn: (a) => variance(a, true) },
  varp: { min: 1, max: Infinity, rational: true, fn: (a) => variance(a, false) },
  stdev: { min: 2, max: Infinity, fn: (a) => variance(a, true).sqrt() },
  stdevp: { min: 1, max: Infinity, fn: (a) => variance(a, false).sqrt() },
};

function median(a: Dec[]): Dec {
  const s = [...a].sort((x, y) => x.cmp(y));
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : s[m - 1]!.plus(s[m]!).div(2);
}

function variance(a: Dec[], sample: boolean): Dec {
  const mean = a.reduce((x, y) => x.plus(y), new D(0)).div(a.length);
  const ss = a.reduce((x, y) => x.plus(y.minus(mean).pow(2)), new D(0));
  return ss.div(sample ? a.length - 1 : a.length);
}

const ALIASES: Record<string, string> = {
  arcsin: 'asin',
  arccos: 'acos',
  arctan: 'atan',
  choose: 'ncr',
  comb: 'ncr',
  perm: 'npr',
  factorial: 'fact',
  sqr: 'sqrt',
  mean: 'avg',
  average: 'avg',
  stddev: 'stdev',
  stdevs: 'stdev',
  variance: 'var',
  vars: 'var',
};

/** Resolves aliases and the digit-suffixed families root3 (∛) and logb2 (log base 2). */
export function resolveFunction(name: string): { def: FnDef; boundArg?: Dec } | undefined {
  const real = ALIASES[name] ?? name;
  const def = FUNCTIONS[real];
  if (def) return { def };
  const m = /^(root|logb)(\d+)$/.exec(name);
  if (!m) return undefined;
  const k = new D(m[2]!);
  return m[1] === 'root'
    ? { def: { min: 1, max: 1, fn: (a) => nthRoot(a[0]!, k) }, boundArg: k }
    : { def: { min: 1, max: 1, fn: (a) => log(a[0]!, k) }, boundArg: k };
}

export function isFunctionName(name: string): boolean {
  return resolveFunction(name) !== undefined;
}

export const CONSTANTS: Record<string, Dec> = {
  pi: PI,
  e: D.exp(1),
  tau: PI.mul(2),
  phi: new D(1).plus(new D(5).sqrt()).div(2),
};

export { DEG, PI };
