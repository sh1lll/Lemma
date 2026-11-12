import type { Node } from './ast';
import { walk } from './ast';
import { CONSTANTS, isFunctionName } from './builtins';
import type { Dec } from './decimal';
import { MathError } from './errors';
import type { UserFunction } from './evaluate';

/**
 * Compiles an AST into a plain-float closure for high-volume evaluation (plotting, numeric analysis).
 * Closures rather than `new Function`, so it runs under strict Content-Security-Policy (Electron, extensions).
 * Domain errors yield NaN instead of throwing, which plotting code treats as a gap.
 */

export type FloatEnv = Record<string, number>;
export type FloatFn = (env: FloatEnv) => number;

export interface FloatOptions {
  angle: 'deg' | 'rad';
  vars?: ReadonlyMap<string, Dec>;
  fns?: ReadonlyMap<string, UserFunction>;
  /** Names supplied at call time through `env` (x, y, t, θ, slider parameters). */
  free: ReadonlySet<string>;
}

const G = 7;
const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];

export function gamma(z: number): number {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  z -= 1;
  let x = LANCZOS[0]!;
  for (let i = 1; i < G + 2; i++) x += LANCZOS[i]! / (z + i);
  const t = z + G + 0.5;
  return Math.sqrt(2 * Math.PI) * t ** (z + 0.5) * Math.exp(-t) * x;
}

function factorial(n: number): number {
  if (Number.isInteger(n)) {
    if (n < 0) return NaN;
    if (n > 170) return Infinity;
    let r = 1;
    for (let k = 2; k <= n; k++) r *= k;
    return r;
  }
  return gamma(n + 1);
}

function choose(n: number, k: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || n < 0) return NaN;
  if (k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

const gcd = (a: number, b: number): number => {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
};

function root(x: number, n: number): number {
  if (x < 0) return n % 2 === 1 ? -((-x) ** (1 / n)) : NaN;
  return x ** (1 / n);
}

type F1 = (a: number) => number;

function floatFunctions(angle: 'deg' | 'rad'): Record<string, (...a: number[]) => number> {
  const k = angle === 'deg' ? Math.PI / 180 : 1;
  const inv = (f: F1): F1 => (x) => f(x) / k;
  return {
    sqrt: Math.sqrt,
    cbrt: Math.cbrt,
    root,
    abs: Math.abs,
    sign: Math.sign,
    floor: Math.floor,
    ceil: Math.ceil,
    trunc: Math.trunc,
    round: (x, p = 0) => Math.round(x * 10 ** p) / 10 ** p,
    ln: Math.log,
    log: (x, b) => (b === undefined ? Math.log10(x) : Math.log(x) / Math.log(b)),
    exp: Math.exp,
    sin: (x) => Math.sin(x * k),
    cos: (x) => Math.cos(x * k),
    tan: (x) => Math.tan(x * k),
    sec: (x) => 1 / Math.cos(x * k),
    csc: (x) => 1 / Math.sin(x * k),
    cot: (x) => 1 / Math.tan(x * k),
    asin: inv(Math.asin),
    acos: inv(Math.acos),
    atan: inv(Math.atan),
    sinh: Math.sinh,
    cosh: Math.cosh,
    tanh: Math.tanh,
    asinh: Math.asinh,
    acosh: Math.acosh,
    atanh: Math.atanh,
    fact: factorial,
    dfact: (n) => {
      if (!Number.isInteger(n) || n < -1) return NaN;
      let r = 1;
      for (let k = n; k > 1; k -= 2) r *= k;
      return r;
    },
    ncr: choose,
    npr: (n, r) => (r > n ? 0 : factorial(n) / factorial(n - r)),
    gcd,
    lcm: (a, b) => (a && b ? Math.abs(a * b) / gcd(a, b) : 0),
    min: Math.min,
    max: Math.max,
    avg: (...a) => a.reduce((s, x) => s + x, 0) / a.length,
  };
}

const ALIASES: Record<string, string> = { arcsin: 'asin', arccos: 'acos', arctan: 'atan', choose: 'ncr', comb: 'ncr', perm: 'npr', factorial: 'fact', sqr: 'sqrt', mean: 'avg', average: 'avg' };

/** Names in the expression that are not constants, functions, or known session variables. */
export function freeNames(ast: Node, vars?: ReadonlyMap<string, Dec>): string[] {
  const out = new Set<string>();
  walk(ast, (m) => {
    if (m.type === 'name' && !(m.name in CONSTANTS) && !vars?.has(m.name) && m.name !== 'ans' && m.name !== 'base') out.add(m.name);
  });
  return [...out];
}

type Compiled = (env: FloatEnv, args: number[]) => number;

export function compileFloat(ast: Node, opts: FloatOptions): FloatFn {
  const fnTable = floatFunctions(opts.angle);
  let depth = 0;

  const binary = (n: Extract<Node, { type: 'binary' }>, params: ReadonlyMap<string, number>): Compiled => {
    const l = comp(n.left, params);
    const r = comp(n.right, params);
    // Same "a + b%" convention as the exact evaluator.
    if ((n.op === '+' || n.op === '-') && n.right.type === 'percent') {
      return n.op === '+' ? (e, x) => l(e, x) * (1 + r(e, x)) : (e, x) => l(e, x) * (1 - r(e, x));
    }
    switch (n.op) {
      case '+':
        return (e, x) => l(e, x) + r(e, x);
      case '-':
        return (e, x) => l(e, x) - r(e, x);
      case '*':
        return (e, x) => l(e, x) * r(e, x);
      case '/':
        return (e, x) => l(e, x) / r(e, x);
      case 'mod':
        return (e, x) => {
          const a = l(e, x);
          const b = r(e, x);
          return a - b * Math.floor(a / b);
        };
      case '^':
        return (e, x) => {
          const b = l(e, x);
          const p = r(e, x);
          // Real odd roots of negatives: (−8)^(1/3) = −2, matching the exact evaluator.
          if (b < 0 && !Number.isInteger(p)) {
            const inv = 1 / p;
            const ri = Math.round(inv);
            if (Math.abs(inv - ri) < 1e-9 && ri % 2 !== 0) return -((-b) ** p);
          }
          return b ** p;
        };
    }
  };

  const call = (n: Extract<Node, { type: 'call' }>, params: ReadonlyMap<string, number>): Compiled => {
    const args = n.args.map((a) => comp(a, params));
    const user = opts.fns?.get(n.name);
    if (user) {
      if (++depth > 50) throw new MathError('overflow', `${n.name} is recursive and can't be plotted`);
      const body = comp(user.body, new Map(user.params.map((p, i) => [p, i])));
      depth--;
      return (e, x) => body(e, args.map((a) => a(e, x)));
    }
    const m = /^(root|logb)(\d+)$/.exec(n.name);
    if (m) {
      const k = Number(m[2]);
      const a = args[0]!;
      return m[1] === 'root' ? (e, x) => root(a(e, x), k) : (e, x) => Math.log(a(e, x)) / Math.log(k);
    }
    const f = fnTable[ALIASES[n.name] ?? n.name];
    if (!f) throw new MathError('unknown-name', `Unknown function "${n.name}"`);
    if (args.length === 1) {
      const a = args[0]!;
      return (e, x) => f(a(e, x));
    }
    if (args.length === 2) {
      const a = args[0]!;
      const b = args[1]!;
      return (e, x) => f(a(e, x), b(e, x));
    }
    return (e, x) => f(...args.map((a) => a(e, x)));
  };

  const comp = (n: Node, params: ReadonlyMap<string, number>): Compiled => {
    switch (n.type) {
      case 'num': {
        const v = Number(n.value);
        return () => v;
      }
      case 'name': {
        const name = n.name;
        const p = params.get(name);
        if (p !== undefined) return (_e, a) => a[p]!;
        if (opts.free.has(name)) return (e) => e[name] ?? NaN;
        const v = opts.vars?.get(name) ?? CONSTANTS[name];
        if (v) {
          const f = v.toNumber();
          return () => f;
        }
        throw new MathError('unknown-name', `Unknown name "${name}"`);
      }
      case 'percent': {
        const a = comp(n.arg, params);
        return (e, x) => a(e, x) / 100;
      }
      case 'degree': {
        const a = comp(n.arg, params);
        return opts.angle === 'deg' ? a : (e, x) => (a(e, x) * Math.PI) / 180;
      }
      case 'factorial': {
        const a = comp(n.arg, params);
        return (e, x) => factorial(a(e, x));
      }
      case 'neg': {
        const a = comp(n.arg, params);
        return (e, x) => -a(e, x);
      }
      case 'of': {
        const l = comp(n.left, params);
        const r = comp(n.right, params);
        return (e, x) => l(e, x) * r(e, x);
      }
      case 'off': {
        const l = comp(n.left, params);
        const r = comp(n.right, params);
        return (e, x) => r(e, x) * (1 - l(e, x));
      }
      case 'binary':
        return binary(n, params);
      case 'call':
        return call(n, params);
      case 'assign':
        return comp(n.value, params);
      case 'define':
        throw new MathError('syntax', 'A formula definition has no value by itself');
    }
  };

  const fn = comp(ast, new Map());
  const none: number[] = [];
  return (env) => fn(env, none);
}

export { isFunctionName };
