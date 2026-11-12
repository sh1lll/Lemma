import { compileFloat, D, MathError, parseInput, createSession, splitLetterProducts, type Answer, type AnswerFailure, type AnswerResult } from '@lemma/math-core';

export type Result = AnswerResult | null;
export type Line = { label: string; display: string };
export type Table = NonNullable<Answer['table']>;

/** Readable number: up to `sig` significant digits, trailing zeros dropped, no exponent for ordinary sizes. */
export function fmt(x: number, sig = 6): string {
  if (Number.isNaN(x)) return 'undefined';
  if (!Number.isFinite(x)) return x > 0 ? '∞' : '−∞';
  if (x === 0) return '0';
  if (Number.isInteger(x) && Math.abs(x) < 1e15) return String(x);
  const a = Math.abs(x);
  if (a >= 1e15 || a < 1e-6) {
    const [m, e] = x.toExponential(sig - 1).split('e');
    return `${m!.replace(/\.?0+$/, '')}e${e}`;
  }
  const s = x.toPrecision(sig);
  return s.includes('e') ? String(Number(s)) : s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** Rounds to a fixed number of decimals for display in step tables. */
export function fix(x: number, d = 6): string {
  if (!Number.isFinite(x)) return fmt(x);
  const s = x.toFixed(d).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

export interface AnsOpts {
  lines?: Line[];
  table?: Table;
  notes?: string[];
  value?: number;
  unit?: string;
  spoken?: string;
  exactness?: Answer['exactness'];
  plot?: Answer['plot'];
  figure?: string;
}

export function answer(input: string, kind: string, expression: string, display: string, o: AnsOpts = {}): Answer {
  const a: Answer = {
    ok: true,
    kind,
    input,
    expression,
    primary: { display, plain: display, spoken: o.spoken ?? display, ...(o.unit ? { unit: o.unit } : {}) },
    notes: o.notes ?? [],
  };
  if (o.value !== undefined && Number.isFinite(o.value)) a.value = new D(o.value);
  if (o.lines?.length) a.lines = o.lines;
  if (o.table) a.table = o.table;
  if (o.exactness) a.exactness = o.exactness;
  if (o.plot) a.plot = o.plot;
  if (o.figure) (a as Answer & { figure?: unknown }).figure = { type: 'svg', svg: o.figure };
  return a;
}

export function fail(input: string, kind: string, message: string): AnswerFailure {
  return { ok: false, kind, input, error: new MathError('domain', message) };
}

/** Thrown inside handlers for user-facing refusals; caught by the dispatcher. */
export class Refusal extends Error {}
export const refuse = (msg: string): never => {
  throw new Refusal(msg);
};

const NUM = /[-−]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?(?:\s*\/\s*(?:\d+(?:\.\d*)?|\.\d+))?/gi;
/** All numbers in a string, fractions "1/4" included. */
export function numbers(s: string): number[] {
  return (s.match(NUM) ?? []).map(parseNum);
}
export function parseNum(t: string): number {
  const c = t.replace(/−/g, '-').replace(/\s+/g, '');
  if (c.includes('/')) {
    const [a, b] = c.split('/');
    return Number(a) / Number(b);
  }
  return Number(c);
}

/** One named numeric parameter: "p=61", "p = 61", "p is 61", "beta 0.3". */
export function param(s: string, names: string[], dflt?: number): number | undefined {
  for (const n of names) {
    const re = new RegExp(`(?:^|[^a-z0-9_])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:=|:|is|of)?\\s*([-−]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[-+]?\\d+)?(?:\\s*\\/\\s*\\d+(?:\\.\\d+)?)?)`, 'i');
    const m = re.exec(s);
    if (m) return parseNum(m[1]!);
  }
  return dflt;
}

const FN_VARS = new Set(['x', 'y', 't', 'z', 'u', 'v', 'n']);

/** Compiles "x^3 - 2x - 5" / "sin x" / "e^(-x^2)" to a float function of the given variables (radians). */
export function compile(text: string, vars: string[] = ['x']): (...a: number[]) => number {
  let cleaned = text
    .replace(/^\s*(?:f|g|y)\s*\(\s*[a-z]\w*\s*(?:,\s*[a-z]\w*\s*)*\)\s*=\s*/i, '')
    .replace(/^\s*y\s*=\s*/i, '')
    .replace(/π/g, 'pi')
    .trim();
  if (!cleaned) refuse('No function given');
  // "3x1" would read as 3 × 1; give subscripted variables letter-only aliases.
  const alias = vars.map((v, i) => (/^[a-z]+_?\d+$/i.test(v) ? `qz${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}` : v));
  vars.forEach((v, i) => {
    if (alias[i] === v) return;
    const m = /^([a-z]+)_?(\d+)$/i.exec(v)!;
    cleaned = cleaned.replace(new RegExp(`(?<![a-z])${m[1]}_?${m[2]}(?!\\d)`, 'gi'), () => ` ${alias[i]}`);
  });
  let ast;
  try {
    const keep = (n: string) => alias.includes(n) || FN_VARS.has(n);
    ast = splitLetterProducts(parseInput(cleaned, createSession()), keep);
  } catch (e) {
    refuse(`Couldn’t read the function “${text.trim()}”${e instanceof Error ? `: ${e.message}` : ''}`);
  }
  const f = compileFloat(ast!, { angle: 'rad', free: new Set(alias) });
  return (...a: number[]) => {
    const env: Record<string, number> = {};
    alias.forEach((v, i) => (env[v] = a[i] ?? 0));
    return f(env);
  };
}

export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

export function modpow(b: bigint, e: bigint, m: bigint): bigint {
  if (m === 1n) return 0n;
  let r = 1n;
  b = ((b % m) + m) % m;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
}

export function egcd(a: bigint, b: bigint): [bigint, bigint, bigint] {
  let [or, r] = [a, b];
  let [os, s] = [1n, 0n];
  let [ot, t] = [0n, 1n];
  while (r !== 0n) {
    const q = or / r;
    [or, r] = [r, or - q * r];
    [os, s] = [s, os - q * s];
    [ot, t] = [t, ot - q * t];
  }
  return [or, os, ot];
}

export function modinv(a: bigint, m: bigint): bigint | null {
  const [g, x] = egcd(((a % m) + m) % m, m);
  if (g !== 1n) return null;
  return ((x % m) + m) % m;
}

/** Fraction display for probabilities and small rationals, when one exists with a small denominator. */
export function frac(x: number, maxDen = 1000): string | null {
  if (Number.isInteger(x)) return null;
  for (let d = 2; d <= maxDen; d++) {
    const n = Math.round(x * d);
    if (Math.abs(n / d - x) < 1e-12) return `${n}/${d}`;
  }
  return null;
}

export const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
export const log2 = (x: number) => Math.log(x) / Math.LN2;

/** Splits "a, b, c" or "a b c" lists of tokens. */
export function tokens(s: string): string[] {
  return s.split(/[\s,;]+/).filter(Boolean);
}

/** A matrix written "[[1,2],[3,4]]" or "1 2; 3 4". */
export function parseMatrix(s: string): number[][] | null {
  const t = s.trim();
  if (/\[\s*\[/.test(t)) {
    const rows = [...t.matchAll(/\[([^[\]]*)\]/g)].map((m) => numbers(m[1]!));
    return rows.length && rows.every((r) => r.length) ? rows : null;
  }
  if (t.includes(';')) {
    const rows = t.split(';').map((r) => numbers(r));
    return rows.every((r) => r.length) ? rows : null;
  }
  return null;
}
