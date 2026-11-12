/**
 * Monte Carlo simulation cells: `simulate 10000: sum of 2 dice >= 10`, `simulate 5000 seed 7: x = normal(100, 15); x > 130`.
 *
 * The body is a tiny language (statements separated by `;`, the last one is the quantity of interest). A
 * true/false last statement estimates a probability (Wilson 95% interval); a numeric one estimates a mean
 * (normal-approximation 95% interval). Runs are reproducible: a seeded PRNG (xoshiro128**), and a line
 * without an explicit seed gets one derived from its text. When the body contains exactly one random
 * quantity with known distribution, the exact value is computed too, so the estimate can be checked.
 *
 * Pure and synchronous: hosts may run it in a Worker (it only needs plain data in and out).
 */

export interface SimRequest {
  /** The text after the colon. */
  body: string;
  trials: number;
  seed: number;
  /** Notebook variables usable by name (numbers only). */
  consts?: Record<string, number>;
}

export interface SimHistogram {
  /** Discrete: one bar per integer value. */
  discrete: boolean;
  bins: { x0: number; x1: number; count: number; hits: number }[];
  /** What is plotted ("x", "dice(2)", "outcome"). */
  label: string;
}

export interface SimulationSummary {
  mode: 'probability' | 'mean';
  /** The body as understood (phrases rewritten to functions). */
  program: string;
  trials: number;
  seed: number;
  estimate: number;
  /** 95% confidence interval. */
  lo: number;
  hi: number;
  hits?: number;
  sd?: number;
  histogram: SimHistogram;
  exact?: { value: number; fraction?: string; how: string; withinCI: boolean };
  /** Why there is no exact value (when one was looked for and not found). */
  exactNote?: string;
  ms: number;
}

export class SimError extends Error {}

export const MAX_TRIALS = 2_000_000;
export const DEFAULT_TRIALS = 10_000;

// ---------- the simulate line ----------
const LINE = /^simulate(?:\s+(\d[\d,_]*(?:\.\d+)?\s*[km]?))?(?:\s*(?:trials|times|runs|samples))?(?:\s*(?:,\s*)?(?:with\s+)?seed\s*=?\s*(\d+))?\s*:\s*(.+)$/i;

export function isSimulateLine(line: string): boolean {
  return /^simulate\b/i.test(line.trim());
}

/** Parses "simulate 10000 seed 42: …". Throws SimError for a malformed header. */
export function parseSimulateLine(line: string): { trials: number; seed: number; seedGiven: boolean; body: string } {
  const m = LINE.exec(line.trim());
  if (!m) throw new SimError('Write it as “simulate 10000: <event or quantity>”, e.g. simulate 10000: sum of 2 dice >= 10');
  let trials = DEFAULT_TRIALS;
  if (m[1]) {
    const raw = m[1].replace(/[,_\s]/g, '').toLowerCase();
    trials = Number(raw.replace(/[km]$/, '')) * (raw.endsWith('k') ? 1e3 : raw.endsWith('m') ? 1e6 : 1);
  }
  if (!Number.isInteger(trials) || trials < 1) throw new SimError('The number of trials must be a whole number');
  if (trials > MAX_TRIALS) throw new SimError(`At most ${MAX_TRIALS.toLocaleString('en-US')} trials per simulation`);
  const body = m[3]!.trim();
  const seedGiven = m[2] !== undefined;
  const seed = seedGiven ? Number(m[2]) >>> 0 : hashSeed(body);
  return { trials, seed, seedGiven, body };
}

/** Stable default seed from the body text (FNV-1a), so an unchanged line gives the same result every run. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0) % 1_000_000;
}

/** Rewrites "simulate …" with a new seed (the re-run button). */
export function withSeed(line: string, seed: number): string {
  const m = LINE.exec(line.trim());
  if (!m) return line;
  return `simulate ${m[1] ? m[1].trim() : DEFAULT_TRIALS} seed ${seed}: ${m[3]!.trim()}`;
}

// ---------- PRNG ----------
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private spare: number | null = null;
  constructor(seed: number) {
    // splitmix32 to fill the state.
    let s = seed >>> 0;
    const next = () => {
      s = (s + 0x9e3779b9) | 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next();
    if (!(this.a | this.b | this.c | this.d)) this.a = 1;
  }
  /** xoshiro128**: uniform in [0, 1). */
  next(): number {
    const r = Math.imul(rotl(Math.imul(this.b, 5), 7), 9);
    const t = this.b << 9;
    this.c ^= this.a;
    this.d ^= this.b;
    this.b ^= this.c;
    this.a ^= this.d;
    this.c ^= t;
    this.d = rotl(this.d, 11);
    return (r >>> 0) / 4294967296;
  }
  normal(): number {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return s;
    }
    let u: number;
    let v: number;
    let q: number;
    do {
      u = 2 * this.next() - 1;
      v = 2 * this.next() - 1;
      q = u * u + v * v;
    } while (q >= 1 || q === 0);
    const f = Math.sqrt((-2 * Math.log(q)) / q);
    this.spare = v * f;
    return u * f;
  }
}
const rotl = (x: number, k: number) => (x << k) | (x >>> (32 - k));

// ---------- parsing ----------
type Node =
  | { t: 'num'; v: number }
  | { t: 'var'; name: string }
  | { t: 'un'; op: '-' | 'not'; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'call'; name: string; args: Node[]; id: number };

interface Stmt {
  assign?: string;
  expr: Node;
}

/** Plain-English phrases → functions. */
export function rewritePhrases(body: string): string {
  return body
    .toLowerCase()
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/≠/g, '!=')
    .replace(/×/g, '*')
    .replace(/−/g, '-')
    .replace(/\b(?:the )?sum of (\d+) d(\d+)s?\b/g, 'dice($1, $2)')
    .replace(/\b(?:the )?sum of (\d+) (?:fair )?(?:six-sided )?dice\b/g, 'dice($1)')
    .replace(/\b(\d+)d(\d+)\b/g, 'dice($1, $2)')
    .replace(/\b(\d+) (?:fair )?(?:six-sided )?dice\b/g, 'dice($1)')
    .replace(/\b(?:a |one )?(?:fair )?(?:six-sided )?die(?: roll)?\b(?!\s*\()/g, 'dice(1)')
    .replace(/\b(?:the )?(?:number of )?heads in (\d+) (?:fair )?(?:coin )?(?:flips|tosses)\b/g, 'heads($1)')
    .replace(/\b(?:the )?(?:number of )?tails in (\d+) (?:fair )?(?:coin )?(?:flips|tosses)\b/g, 'heads($1)')
    .replace(/\b(?:a |one )?(?:fair )?coin (?:flip|toss)\b/g, 'coin()')
    .replace(/\b(?:the )?(?:final position of )?(?:a )?random walk (?:of |with )?(\d+)(?: steps)?\b/g, 'walk($1)')
    .replace(/\bat least\b/g, '>=')
    .replace(/\bat most\b/g, '<=')
    .replace(/\b(?:more|greater) than\b/g, '>')
    .replace(/\b(?:less|fewer) than\b/g, '<')
    .replace(/\b(?:equals|is equal to)\b/g, '==')
    .replace(/\s+/g, ' ')
    .trim();
}

type Tok = { k: 'num'; v: number } | { k: 'id'; v: string } | { k: 'op'; v: string };

function lex(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const num = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?/i.exec(s.slice(i));
    if (num) {
      out.push({ k: 'num', v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const id = /^[a-z_][a-z0-9_]*/i.exec(s.slice(i));
    if (id) {
      out.push({ k: 'id', v: id[0].toLowerCase() });
      i += id[0].length;
      continue;
    }
    const op = /^(?:==|!=|<=|>=|&&|\|\||\*\*|[-+*/^%(),;<>=!])/.exec(s.slice(i));
    if (!op) throw new SimError(`Unexpected “${ch}” in the simulation`);
    out.push({ k: 'op', v: op[0] });
    i += op[0].length;
  }
  return out;
}

const RANDOM: Record<string, { min: number; max: number; usage: string }> = {
  dice: { min: 0, max: 2, usage: 'dice(n, sides = 6)' },
  coin: { min: 0, max: 1, usage: 'coin(p = 0.5) → 1 for heads, 0 for tails' },
  heads: { min: 1, max: 2, usage: 'heads(flips, p = 0.5)' },
  binomial: { min: 2, max: 2, usage: 'binomial(n, p)' },
  bernoulli: { min: 1, max: 1, usage: 'bernoulli(p)' },
  normal: { min: 0, max: 2, usage: 'normal(mean = 0, sd = 1)' },
  uniform: { min: 0, max: 2, usage: 'uniform(a = 0, b = 1)' },
  randint: { min: 2, max: 2, usage: 'randint(a, b) (inclusive)' },
  exponential: { min: 0, max: 1, usage: 'exponential(rate = 1)' },
  poisson: { min: 1, max: 1, usage: 'poisson(mean)' },
  walk: { min: 1, max: 1, usage: 'walk(steps): final position of a ±1 random walk' },
};
const MATH1: Record<string, (x: number) => number> = {
  abs: Math.abs, sqrt: Math.sqrt, floor: Math.floor, ceil: Math.ceil, round: Math.round, exp: Math.exp, ln: Math.log, log: Math.log10, sin: Math.sin, cos: Math.cos, tan: Math.tan,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E, true: 1, false: 0 };

class Parser {
  private i = 0;
  private ids = 0;
  constructor(private toks: Tok[]) {}
  private peek(): Tok | undefined {
    return this.toks[this.i];
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return !!t && t.k === 'op' && t.v === v;
  }
  private isWord(v: string): boolean {
    const t = this.peek();
    return !!t && t.k === 'id' && t.v === v;
  }
  private expect(v: string): void {
    if (!this.isOp(v)) throw new SimError(`Expected “${v}” in the simulation`);
    this.i++;
  }
  program(): Stmt[] {
    const out: Stmt[] = [];
    while (this.i < this.toks.length) {
      if (this.isOp(';')) {
        this.i++;
        continue;
      }
      const t = this.peek()!;
      const n = this.toks[this.i + 1];
      if (t.k === 'id' && n && n.k === 'op' && n.v === '=' && !(t.v in RANDOM) && !(t.v in MATH1)) {
        this.i += 2;
        out.push({ assign: t.v, expr: this.or() });
      } else out.push({ expr: this.or() });
      if (this.i < this.toks.length && !this.isOp(';')) throw new SimError('Separate statements with “;”');
    }
    if (!out.length) throw new SimError('Nothing to simulate');
    return out;
  }
  private or(): Node {
    let a = this.and();
    while (this.isOp('||') || this.isWord('or')) {
      this.i++;
      a = { t: 'bin', op: 'or', a, b: this.and() };
    }
    return a;
  }
  private and(): Node {
    let a = this.not();
    while (this.isOp('&&') || this.isWord('and')) {
      this.i++;
      a = { t: 'bin', op: 'and', a, b: this.not() };
    }
    return a;
  }
  private not(): Node {
    if (this.isOp('!') || this.isWord('not')) {
      this.i++;
      return { t: 'un', op: 'not', a: this.not() };
    }
    return this.cmp();
  }
  private cmp(): Node {
    let a = this.add();
    for (;;) {
      const t = this.peek();
      if (!t || t.k !== 'op' || !['<', '<=', '>', '>=', '==', '!=', '='].includes(t.v)) return a;
      this.i++;
      a = { t: 'bin', op: t.v === '=' ? '==' : t.v, a, b: this.add() };
    }
  }
  private add(): Node {
    let a = this.mul();
    for (;;) {
      if (this.isOp('+') || this.isOp('-')) {
        const op = (this.toks[this.i++] as { v: string }).v;
        a = { t: 'bin', op, a, b: this.mul() };
      } else return a;
    }
  }
  private mul(): Node {
    let a = this.unary();
    for (;;) {
      if (this.isOp('*') || this.isOp('/') || this.isOp('%')) {
        const op = (this.toks[this.i++] as { v: string }).v;
        a = { t: 'bin', op, a, b: this.unary() };
      } else return a;
    }
  }
  private unary(): Node {
    if (this.isOp('-')) {
      this.i++;
      return { t: 'un', op: '-', a: this.unary() };
    }
    if (this.isOp('+')) {
      this.i++;
      return this.unary();
    }
    return this.pow();
  }
  private pow(): Node {
    const a = this.primary();
    if (this.isOp('^') || this.isOp('**')) {
      this.i++;
      return { t: 'bin', op: '^', a, b: this.unary() };
    }
    return a;
  }
  private primary(): Node {
    const t = this.peek();
    if (!t) throw new SimError('The simulation ends too early');
    this.i++;
    if (t.k === 'num') return { t: 'num', v: t.v };
    if (t.k === 'op' && t.v === '(') {
      const e = this.or();
      this.expect(')');
      return e;
    }
    if (t.k === 'id') {
      if (this.isOp('(')) {
        this.i++;
        const args: Node[] = [];
        if (!this.isOp(')')) {
          args.push(this.or());
          while (this.isOp(',')) {
            this.i++;
            args.push(this.or());
          }
        }
        this.expect(')');
        const spec = RANDOM[t.v];
        if (spec && (args.length < spec.min || args.length > spec.max)) throw new SimError(`Use ${spec.usage}`);
        if (!spec && !MATH1[t.v] && t.v !== 'min' && t.v !== 'max') throw new SimError(`Unknown function “${t.v}”. Random: ${Object.keys(RANDOM).join(', ')}`);
        return { t: 'call', name: t.v, args, id: this.ids++ };
      }
      // A bare random name ("coin", "die") means a call with defaults.
      if (RANDOM[t.v] && RANDOM[t.v]!.min === 0) return { t: 'call', name: t.v, args: [], id: this.ids++ };
      return { t: 'var', name: t.v };
    }
    throw new SimError(`Unexpected “${t.v}” in the simulation`);
  }
}

function print(n: Node): string {
  switch (n.t) {
    case 'num':
      return String(n.v);
    case 'var':
      return n.name;
    case 'un':
      return n.op === '-' ? `-${print(n.a)}` : `not ${print(n.a)}`;
    case 'bin':
      return `${print(n.a)} ${n.op} ${print(n.b)}`;
    case 'call':
      return `${n.name}(${n.args.map(print).join(', ')})`;
  }
}

// ---------- compiling ----------
type Fn = () => number;
interface Env {
  slots: Float64Array;
  rng: Rng;
  /** When set, the random call with this id returns `value` (exact analysis). */
  fixed: { id: number; value: number } | null;
}

const isBool = (n: Node): boolean =>
  (n.t === 'bin' && ['<', '<=', '>', '>=', '==', '!=', 'and', 'or'].includes(n.op)) || (n.t === 'un' && n.op === 'not') || (n.t === 'call' && (n.name === 'coin' || n.name === 'bernoulli'));

function compile(n: Node, env: Env, slotOf: Map<string, number>, consts: Record<string, number>): Fn {
  switch (n.t) {
    case 'num': {
      const v = n.v;
      return () => v;
    }
    case 'var': {
      const slot = slotOf.get(n.name);
      if (slot !== undefined) return () => env.slots[slot]!;
      const c = consts[n.name] ?? CONSTS[n.name];
      if (c !== undefined) return () => c;
      throw new SimError(`“${n.name}” isn’t defined (define it before the simulation, or with “${n.name} = …;” inside it)`);
    }
    case 'un': {
      const a = compile(n.a, env, slotOf, consts);
      return n.op === '-' ? () => -a() : () => (a() ? 0 : 1);
    }
    case 'bin': {
      const a = compile(n.a, env, slotOf, consts);
      const b = compile(n.b, env, slotOf, consts);
      switch (n.op) {
        case '+': return () => a() + b();
        case '-': return () => a() - b();
        case '*': return () => a() * b();
        case '/': return () => a() / b();
        case '%': return () => a() % b();
        case '^': return () => Math.pow(a(), b());
        case '<': return () => (a() < b() ? 1 : 0);
        case '<=': return () => (a() <= b() ? 1 : 0);
        case '>': return () => (a() > b() ? 1 : 0);
        case '>=': return () => (a() >= b() ? 1 : 0);
        case '==': return () => (Math.abs(a() - b()) < 1e-9 ? 1 : 0);
        case '!=': return () => (Math.abs(a() - b()) >= 1e-9 ? 1 : 0);
        case 'and': return () => (a() && b() ? 1 : 0);
        case 'or': return () => (a() || b() ? 1 : 0);
      }
      throw new SimError(`Unknown operator ${n.op}`);
    }
    case 'call': {
      const args = n.args.map((x) => compile(x, env, slotOf, consts));
      const arg = (i: number, d: number): Fn => args[i] ?? (() => d);
      if (MATH1[n.name]) {
        const f = MATH1[n.name]!;
        const a = arg(0, NaN);
        return () => f(a());
      }
      if (n.name === 'min' || n.name === 'max') {
        const f = n.name === 'min' ? Math.min : Math.max;
        return () => f(...args.map((g) => g()));
      }
      const draw = sampler(n.name, arg, env);
      const id = n.id;
      return () => (env.fixed && env.fixed.id === id ? env.fixed.value : draw());
    }
  }
}

const intArg = (v: number, what: string, max: number): number => {
  if (!Number.isInteger(v) || v < 0 || v > max) throw new SimError(`${what} must be a whole number from 0 to ${max.toLocaleString('en-US')}`);
  return v;
};
const probArg = (v: number): number => {
  if (!(v >= 0 && v <= 1)) throw new SimError('A probability must be between 0 and 1');
  return v;
};

function sampler(name: string, arg: (i: number, d: number) => Fn, env: Env): Fn {
  const rng = env.rng;
  const u = () => rng.next();
  switch (name) {
    case 'dice': {
      const n = arg(0, 1);
      const s = arg(1, 6);
      return () => {
        const k = intArg(n(), 'The number of dice', 10_000);
        const sides = intArg(s(), 'The number of sides', 1_000_000);
        let t = 0;
        for (let i = 0; i < k; i++) t += Math.floor(u() * sides) + 1;
        return t;
      };
    }
    case 'coin': {
      const p = arg(0, 0.5);
      return () => (u() < probArg(p()) ? 1 : 0);
    }
    case 'bernoulli': {
      const p = arg(0, 0.5);
      return () => (u() < probArg(p()) ? 1 : 0);
    }
    case 'heads':
    case 'binomial': {
      const n = arg(0, 1);
      const p = arg(1, 0.5);
      return () => binomialDraw(intArg(n(), 'The number of trials', 10_000_000), probArg(p()), rng);
    }
    case 'walk': {
      const n = arg(0, 1);
      return () => {
        const k = intArg(n(), 'The number of steps', 10_000_000);
        return 2 * binomialDraw(k, 0.5, rng) - k;
      };
    }
    case 'normal': {
      const m = arg(0, 0);
      const s = arg(1, 1);
      return () => {
        const sd = s();
        if (!(sd >= 0)) throw new SimError('A standard deviation can’t be negative');
        return m() + sd * rng.normal();
      };
    }
    case 'uniform': {
      const a = arg(0, 0);
      const b = arg(1, 1);
      return () => {
        const lo = a();
        return lo + (b() - lo) * u();
      };
    }
    case 'randint': {
      const a = arg(0, 0);
      const b = arg(1, 1);
      return () => {
        const lo = Math.ceil(a());
        const hi = Math.floor(b());
        if (hi < lo) throw new SimError('randint(a, b) needs a ≤ b');
        return lo + Math.floor(u() * (hi - lo + 1));
      };
    }
    case 'exponential': {
      const r = arg(0, 1);
      return () => {
        const rate = r();
        if (!(rate > 0)) throw new SimError('An exponential rate must be positive');
        return -Math.log(1 - u()) / rate;
      };
    }
    case 'poisson': {
      const l = arg(0, 1);
      return () => poissonDraw(l(), rng);
    }
  }
  throw new SimError(`Unknown random function ${name}`);
}

/** Inversion against a cached CDF for large n; direct Bernoulli sums for small n. */
const cdfCache = new Map<string, Float64Array>();
function cachedCdf(key: string, build: () => Float64Array): Float64Array {
  let c = cdfCache.get(key);
  if (!c) {
    if (cdfCache.size > 64) cdfCache.clear();
    c = build();
    cdfCache.set(key, c);
  }
  return c;
}
function invert(cdf: Float64Array, x: number, offset = 0): number {
  let lo = 0;
  let hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid]! > x) hi = mid;
    else lo = mid + 1;
  }
  return lo + offset;
}

function binomialDraw(n: number, p: number, rng: Rng): number {
  if (n <= 40) {
    let k = 0;
    for (let i = 0; i < n; i++) if (rng.next() < p) k++;
    return k;
  }
  if (n > 200_000) return Math.max(0, Math.min(n, Math.round(n * p + Math.sqrt(n * p * (1 - p)) * rng.normal())));
  const cdf = cachedCdf(`b${n},${p}`, () => {
    const pmf = binomialPmf(n, p);
    const c = new Float64Array(pmf.length);
    let acc = 0;
    for (let i = 0; i < pmf.length; i++) c[i] = acc += pmf[i]!;
    return c;
  });
  return invert(cdf, rng.next() * cdf[cdf.length - 1]!);
}

function poissonDraw(lambda: number, rng: Rng): number {
  if (!(lambda >= 0) || lambda > 1e6) throw new SimError('poisson(mean) needs a mean from 0 to 1,000,000');
  if (lambda < 30) {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= rng.next();
    } while (p > L);
    return k - 1;
  }
  const { lo, pmf } = poissonPmf(lambda);
  const cdf = cachedCdf(`p${lambda}`, () => {
    const c = new Float64Array(pmf.length);
    let acc = 0;
    for (let i = 0; i < pmf.length; i++) c[i] = acc += pmf[i]!;
    return c;
  });
  return invert(cdf, rng.next() * cdf[cdf.length - 1]!, lo);
}

// ---------- exact distributions ----------
function logGamma(x: number): number {
  // Lanczos approximation (g = 7, n = 9).
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0]!;
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i]! / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function binomialPmf(n: number, p: number): Float64Array {
  const out = new Float64Array(n + 1);
  if (p === 0 || p === 1) {
    out[p === 0 ? 0 : n] = 1;
    return out;
  }
  const lp = Math.log(p);
  const lq = Math.log1p(-p);
  const lnf = logGamma(n + 1);
  for (let k = 0; k <= n; k++) out[k] = Math.exp(lnf - logGamma(k + 1) - logGamma(n - k + 1) + k * lp + (n - k) * lq);
  return out;
}

function poissonPmf(lambda: number): { lo: number; pmf: Float64Array } {
  const sd = Math.sqrt(lambda);
  const lo = Math.max(0, Math.floor(lambda - 12 * sd - 10));
  const hi = Math.ceil(lambda + 12 * sd + 20);
  const pmf = new Float64Array(hi - lo + 1);
  for (let k = lo; k <= hi; k++) pmf[k - lo] = lambda === 0 ? (k === 0 ? 1 : 0) : Math.exp(k * Math.log(lambda) - lambda - logGamma(k + 1));
  return { lo, pmf };
}

/** Distribution of the sum of n dice with `sides` faces (repeated convolution). */
function dicePmf(n: number, sides: number): { lo: number; pmf: Float64Array } {
  let pmf = new Float64Array([1]);
  for (let i = 0; i < n; i++) {
    const next = new Float64Array(pmf.length + sides - 1);
    for (let j = 0; j < pmf.length; j++) {
      const c = pmf[j]! / sides;
      if (!c) continue;
      for (let f = 0; f < sides; f++) next[j + f]! += c;
    }
    pmf = next;
  }
  return { lo: n, pmf };
}

function erfc(x: number): number {
  // Numerical Recipes erfcc: fractional error < 1.2e-7 everywhere.
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
const normCdf = (x: number, m: number, s: number) => (s === 0 ? (x >= m ? 1 : 0) : 0.5 * erfc(-(x - m) / (s * Math.SQRT2)));

type Dist =
  | { kind: 'discrete'; lo: number; pmf: Float64Array; values?: Float64Array }
  | { kind: 'continuous'; cdf: (x: number) => number; pdf: (x: number) => number; a: number; b: number };

function distributionOf(name: string, args: number[]): Dist | null {
  const a0 = args[0];
  const a1 = args[1];
  switch (name) {
    case 'dice': {
      const n = a0 ?? 1;
      const s = a1 ?? 6;
      if (!Number.isInteger(n) || !Number.isInteger(s) || n < 0 || s < 1 || n * (s - 1) > 200_000 || n > 2000) return null;
      return { kind: 'discrete', ...dicePmf(n, s) };
    }
    case 'coin':
    case 'bernoulli': {
      const p = a0 ?? 0.5;
      return { kind: 'discrete', lo: 0, pmf: new Float64Array([1 - p, p]) };
    }
    case 'heads':
    case 'binomial': {
      const n = a0 ?? 1;
      if (!Number.isInteger(n) || n > 200_000) return null;
      return { kind: 'discrete', lo: 0, pmf: binomialPmf(n, a1 ?? 0.5) };
    }
    case 'walk': {
      const n = a0 ?? 1;
      if (!Number.isInteger(n) || n > 200_000) return null;
      const pmf = binomialPmf(n, 0.5);
      const values = new Float64Array(n + 1).map((_, k) => 2 * k - n);
      return { kind: 'discrete', lo: 0, pmf, values };
    }
    case 'randint': {
      if (a0 === undefined || a1 === undefined) return null;
      const lo = Math.ceil(a0);
      const hi = Math.floor(a1);
      if (hi < lo || hi - lo > 1_000_000) return null;
      return { kind: 'discrete', lo, pmf: new Float64Array(hi - lo + 1).fill(1 / (hi - lo + 1)) };
    }
    case 'poisson': {
      if (a0 === undefined || a0 < 0 || a0 > 1e5) return null;
      return { kind: 'discrete', ...poissonPmf(a0) };
    }
    case 'normal': {
      const m = a0 ?? 0;
      const s = a1 ?? 1;
      if (!(s > 0)) return null;
      return { kind: 'continuous', cdf: (x) => normCdf(x, m, s), pdf: (x) => Math.exp(-0.5 * ((x - m) / s) ** 2) / (s * Math.sqrt(2 * Math.PI)), a: m - 12 * s, b: m + 12 * s };
    }
    case 'uniform': {
      const a = a0 ?? 0;
      const b = a1 ?? 1;
      if (!(b > a)) return null;
      return { kind: 'continuous', cdf: (x) => Math.min(1, Math.max(0, (x - a) / (b - a))), pdf: (x) => (x >= a && x <= b ? 1 / (b - a) : 0), a, b };
    }
    case 'exponential': {
      const r = a0 ?? 1;
      if (!(r > 0)) return null;
      return { kind: 'continuous', cdf: (x) => (x <= 0 ? 0 : 1 - Math.exp(-r * x)), pdf: (x) => (x < 0 ? 0 : r * Math.exp(-r * x)), a: 0, b: 60 / r };
    }
  }
  return null;
}

function walk(n: Node, f: (x: Node) => void): void {
  f(n);
  if (n.t === 'un') walk(n.a, f);
  else if (n.t === 'bin') {
    walk(n.a, f);
    walk(n.b, f);
  } else if (n.t === 'call') n.args.forEach((x) => walk(x, f));
}

/** Rational approximation for display (1/6, 11/64) when one is exact to ~1e-11. */
export function asFraction(x: number, maxDen = 100_000): string | undefined {
  if (!Number.isFinite(x) || x < 0 || x > 1) return undefined;
  if (x === 0 || x === 1) return undefined;
  let [h0, h1, k0, k1] = [0, 1, 1, 0];
  let v = x;
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(v);
    [h0, h1] = [h1, a * h1 + h0];
    [k0, k1] = [k1, a * k1 + k0];
    if (k1 > maxDen) return undefined;
    if (Math.abs(h1 / k1 - x) < 1e-13) return `${h1}/${k1}`;
    const frac = v - a;
    if (frac < 1e-15) break;
    v = 1 / frac;
  }
  return undefined;
}

// ---------- running ----------
const Z95 = 1.959963984540054;

export function runSimulation(req: SimRequest): SimulationSummary {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const program = rewritePhrases(req.body);
  const stmts = new Parser(lex(program)).program();
  const trials = Math.min(Math.max(1, Math.floor(req.trials)), MAX_TRIALS);
  const consts = req.consts ?? {};
  const slotOf = new Map<string, number>();
  for (const s of stmts) if (s.assign && !slotOf.has(s.assign)) slotOf.set(s.assign, slotOf.size);
  const env: Env = { slots: new Float64Array(Math.max(1, slotOf.size)), rng: new Rng(req.seed), fixed: null };

  const last = stmts[stmts.length - 1]!;
  // "130 < x": put the random side on the left so it is the one plotted.
  const varies = (n: Node) => {
    let v = false;
    walk(n, (x) => (v ||= (x.t === 'call' && !!RANDOM[x.name]) || (x.t === 'var' && slotOf.has(x.name))));
    return v;
  };
  const FLIP: Record<string, string> = { '<': '>', '<=': '>=', '>': '<', '>=': '<=', '==': '==', '!=': '!=' };
  if (last.expr.t === 'bin' && FLIP[last.expr.op] && !varies(last.expr.a) && varies(last.expr.b)) last.expr = { t: 'bin', op: FLIP[last.expr.op]!, a: last.expr.b, b: last.expr.a };
  const mode: SimulationSummary['mode'] = isBool(last.expr) ? 'probability' : 'mean';
  // For a comparison, plot its left side (the random quantity) and highlight the trials that satisfy it.
  const plotted = mode === 'probability' && last.expr.t === 'bin' && ['<', '<=', '>', '>=', '==', '!='].includes(last.expr.op) ? last.expr.a : mode === 'mean' ? last.expr : null;

  const body = stmts.slice(0, -1).map((s) => ({ slot: slotOf.get(s.assign ?? '') ?? -1, f: compile(s.expr, env, slotOf, consts) }));
  const lastSlot = last.assign ? slotOf.get(last.assign)! : -1;
  const final = compile(last.expr, env, slotOf, consts);
  const plotFn = plotted && plotted !== last.expr ? compile(plotted, env, slotOf, consts) : null;
  const cmp = plotFn ? (last.expr as Extract<Node, { t: 'bin' }>) : null;
  const rhsFn = cmp ? compile(cmp.b, env, slotOf, consts) : null;

  const values = new Float64Array(trials);
  const hitsArr = mode === 'probability' ? new Uint8Array(trials) : null;
  let sum = 0;
  let sumSq = 0;
  let hits = 0;
  for (let i = 0; i < trials; i++) {
    for (const s of body) {
      const v = s.f();
      if (s.slot >= 0) env.slots[s.slot] = v;
    }
    let v: number;
    let pv: number;
    if (plotFn && cmp && rhsFn) {
      // Evaluate the plotted side once and reuse it in the comparison (same random draws).
      pv = plotFn();
      v = compareOp(cmp.op, pv, rhsFn());
    } else {
      v = final();
      pv = v;
    }
    if (lastSlot >= 0) env.slots[lastSlot] = v;
    if (!Number.isFinite(v)) throw new SimError(`A trial produced ${v} (check divisions and logarithms)`);
    if (hitsArr) {
      if (v) {
        hits++;
        hitsArr[i] = 1;
      }
      values[i] = plotFn ? pv : v ? 1 : 0;
    } else {
      sum += v;
      sumSq += v * v;
      values[i] = v;
    }
  }

  let estimate: number;
  let lo: number;
  let hi: number;
  let sd: number | undefined;
  if (mode === 'probability') {
    estimate = hits / trials;
    // Wilson score interval.
    const z2 = Z95 * Z95;
    const centre = (estimate + z2 / (2 * trials)) / (1 + z2 / trials);
    const half = (Z95 * Math.sqrt((estimate * (1 - estimate)) / trials + z2 / (4 * trials * trials))) / (1 + z2 / trials);
    lo = Math.max(0, centre - half);
    hi = Math.min(1, centre + half);
  } else {
    estimate = sum / trials;
    sd = trials > 1 ? Math.sqrt(Math.max(0, (sumSq - trials * estimate * estimate) / (trials - 1))) : 0;
    const half = (Z95 * sd) / Math.sqrt(trials);
    lo = estimate - half;
    hi = estimate + half;
  }

  const histogram = buildHistogram(values, hitsArr, plotted ? print(plotted) : 'outcome', !plotted);
  const exactR = exactValue(stmts, mode, consts);
  const summary: SimulationSummary = {
    mode,
    program: stmts.map((s) => (s.assign ? `${s.assign} = ` : '') + print(s.expr)).join('; '),
    trials,
    seed: req.seed,
    estimate,
    lo,
    hi,
    histogram,
    ms: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0),
  };
  if (mode === 'probability') summary.hits = hits;
  if (sd !== undefined) summary.sd = sd;
  if (typeof exactR === 'string') summary.exactNote = exactR;
  else if (exactR) {
    // Round-off in the exact computation is far below any CI width; allow it so a CI edge doesn't flip the check.
    const tol = 1e-9;
    summary.exact = {
      value: exactR.value,
      how: exactR.how,
      fraction: mode === 'probability' && exactR.discrete ? asFraction(exactR.value) : undefined,
      withinCI: exactR.value >= lo - tol && exactR.value <= hi + tol,
    };
  }
  return summary;
}

function compareOp(op: string, a: number, b: number): number {
  switch (op) {
    case '<': return a < b ? 1 : 0;
    case '<=': return a <= b ? 1 : 0;
    case '>': return a > b ? 1 : 0;
    case '>=': return a >= b ? 1 : 0;
    case '==': return Math.abs(a - b) < 1e-9 ? 1 : 0;
    default: return Math.abs(a - b) >= 1e-9 ? 1 : 0;
  }
}

function buildHistogram(values: Float64Array, hits: Uint8Array | null, label: string, boolean: boolean): SimHistogram {
  if (boolean) {
    let t = 0;
    for (const v of values) t += v;
    return { discrete: true, label: 'outcome', bins: [{ x0: 0, x1: 0, count: values.length - t, hits: 0 }, { x0: 1, x1: 1, count: t, hits: t }] };
  }
  let min = Infinity;
  let max = -Infinity;
  let integral = true;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    if (integral && !Number.isInteger(v)) integral = false;
  }
  if (integral && max - min <= 60) {
    const bins = Array.from({ length: max - min + 1 }, (_, i) => ({ x0: min + i, x1: min + i, count: 0, hits: 0 }));
    values.forEach((v, i) => {
      const b = bins[v - min]!;
      b.count++;
      if (hits?.[i]) b.hits++;
    });
    return { discrete: true, label, bins };
  }
  const n = 30;
  const width = max > min ? (max - min) / n : 1;
  const bins = Array.from({ length: max > min ? n : 1 }, (_, i) => ({ x0: min + i * width, x1: min + (i + 1) * width, count: 0, hits: 0 }));
  values.forEach((v, i) => {
    const b = bins[Math.min(bins.length - 1, Math.floor((v - min) / width))]!;
    b.count++;
    if (hits?.[i]) b.hits++;
  });
  return { discrete: false, label, bins };
}

/**
 * The exact probability or mean when the program has exactly one random draw with a known distribution and
 * constant parameters: discrete ones by summing over the support, continuous ones by finding where the
 * event switches on and off (bisection) and using the CDF, or by numerical integration for a mean.
 * Returns a reason string when there is no exact value.
 */
function exactValue(stmts: Stmt[], mode: SimulationSummary['mode'], consts: Record<string, number>): { value: number; how: string; discrete?: boolean } | string | null {
  const calls: Extract<Node, { t: 'call' }>[] = [];
  for (const s of stmts) walk(s.expr, (n) => n.t === 'call' && RANDOM[n.name] && calls.push(n));
  if (calls.length === 0) return 'No random quantity in the simulation';
  if (calls.length > 1) return 'No exact value: the simulation combines more than one random draw';
  const call = calls[0]!;
  const env: Env = { slots: new Float64Array(8), rng: new Rng(1), fixed: { id: call.id, value: 0 } };
  const slotOf = new Map<string, number>();
  for (const s of stmts) if (s.assign && !slotOf.has(s.assign)) slotOf.set(s.assign, slotOf.size);
  env.slots = new Float64Array(Math.max(1, slotOf.size));
  let args: number[];
  try {
    args = call.args.map((a) => {
      let random = false;
      walk(a, (n) => {
        if (n.t === 'var' && slotOf.has(n.name)) random = true;
      });
      if (random) throw new SimError('parameters depend on the simulation');
      return compile(a, env, new Map(), consts)();
    });
  } catch {
    return null;
  }
  const dist = distributionOf(call.name, args);
  if (!dist) return null;
  const fns = stmts.map((s) => ({ slot: s.assign ? slotOf.get(s.assign)! : -1, f: compile(s.expr, env, slotOf, consts) }));
  const evalAt = (x: number): number => {
    env.fixed = { id: call.id, value: x };
    let v = 0;
    for (const s of fns) {
      v = s.f();
      if (s.slot >= 0) env.slots[s.slot] = v;
    }
    return v;
  };
  const what = `${call.name}(${args.join(', ')})`;
  if (dist.kind === 'discrete') {
    let acc = 0;
    for (let i = 0; i < dist.pmf.length; i++) {
      const p = dist.pmf[i]!;
      if (!p) continue;
      const v = evalAt(dist.values ? dist.values[i]! : dist.lo + i);
      acc += mode === 'probability' ? (v ? p : 0) : p * v;
    }
    return { value: acc, how: `summed over every outcome of ${what}`, discrete: true };
  }
  // Continuous: grid in x, then refine each switch of the event by bisection.
  const N = 20_000;
  const { a, b } = dist;
  const h = (b - a) / N;
  if (mode === 'mean') {
    // Simpson's rule on E[f(X)].
    let s = evalAt(a) * dist.pdf(a) + evalAt(b) * dist.pdf(b);
    for (let i = 1; i < N; i++) {
      const x = a + i * h;
      s += (i % 2 ? 4 : 2) * evalAt(x) * dist.pdf(x);
    }
    return { value: (s * h) / 3, how: `numerical integration over ${what}` };
  }
  let p = 0;
  let prevX = -Infinity;
  let prevOn = evalAt(a - h) !== 0;
  let start = prevOn ? -Infinity : NaN;
  const boundary = (x0: number, x1: number, on0: boolean): number => {
    for (let k = 0; k < 60; k++) {
      const mid = (x0 + x1) / 2;
      if ((evalAt(mid) !== 0) === on0) x0 = mid;
      else x1 = mid;
    }
    return (x0 + x1) / 2;
  };
  const cdf = (x: number) => (x === -Infinity ? 0 : x === Infinity ? 1 : dist.cdf(x));
  for (let i = 0; i <= N + 1; i++) {
    const x = a + (i - 1) * h;
    const on = evalAt(x) !== 0;
    if (i > 0 && on !== prevOn) {
      const edge = boundary(prevX, x, prevOn);
      if (on) start = edge;
      else p += cdf(edge) - cdf(start);
    }
    prevOn = on;
    prevX = x;
  }
  if (prevOn) p += 1 - cdf(start);
  return { value: Math.min(1, Math.max(0, p)), how: `from the CDF of ${what}` };
}
