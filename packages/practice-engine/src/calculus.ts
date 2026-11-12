/**
 * A deliberately small symbolic layer for calculus exercises. Every expression is a sum of terms
 *   c · x^n · f(p(x))
 * with integer c and n, and f one of sin, cos, exp, ln (of x only) or a power of a polynomial.
 * That closure is enough for the power, product and chain rules on the forms we generate, and we control
 * how results print, so answers come out in the form a textbook would write.
 */
import { MINUS, num } from './format';

/** Polynomial as integer-coefficient monomials, highest power first. */
export type Poly = { c: number; n: number }[];

export type Fn =
  | { kind: 'sin' | 'cos' | 'exp'; arg: Poly }
  | { kind: 'ln'; abs?: boolean }
  | { kind: 'pow'; arg: Poly; m: number };

export interface Term {
  c: number;
  n: number;
  f?: Fn;
}

export type Expr = Term[];

export const X: Poly = [{ c: 1, n: 1 }];

export function poly(...pairs: [number, number][]): Poly {
  return pairs.filter(([c]) => c !== 0).map(([c, n]) => ({ c, n })).sort((a, b) => b.n - a.n);
}

export function polyDeriv(p: Poly): Poly {
  return p.filter((t) => t.n !== 0).map((t) => ({ c: t.c * t.n, n: t.n - 1 }));
}

function fnKey(f?: Fn): string {
  if (!f) return '';
  if (f.kind === 'ln') return 'ln';
  if (f.kind === 'pow') return `pow${f.m}:${polyPlain(f.arg)}`;
  return `${f.kind}:${polyPlain(f.arg)}`;
}

/** Combines like terms and drops zeros, keeping first-seen order. */
export function simplify(e: Expr): Expr {
  const out: Term[] = [];
  for (const t of e) {
    if (t.f?.kind === 'pow' && t.f.m === 0) t.f = undefined;
    const same = out.find((o) => o.n === t.n && fnKey(o.f) === fnKey(t.f));
    if (same) same.c += t.c;
    else out.push({ ...t });
  }
  return out.filter((t) => Math.abs(t.c) > 1e-12);
}

/** d/dx of one term, as a list of terms (product rule + chain rule). */
export function termDeriv(t: Term): Expr {
  const out: Term[] = [];
  if (t.n !== 0) out.push({ c: t.c * t.n, n: t.n - 1, f: t.f });
  const f = t.f;
  if (!f) return out;
  if (f.kind === 'ln') {
    out.push({ c: t.c, n: t.n - 1 });
    return out;
  }
  for (const d of polyDeriv(f.arg)) {
    if (f.kind === 'sin') out.push({ c: t.c * d.c, n: t.n + d.n, f: { kind: 'cos', arg: f.arg } });
    else if (f.kind === 'cos') out.push({ c: -t.c * d.c, n: t.n + d.n, f: { kind: 'sin', arg: f.arg } });
    else if (f.kind === 'exp') out.push({ c: t.c * d.c, n: t.n + d.n, f });
    else if (f.kind === 'pow') out.push({ c: t.c * f.m * d.c, n: t.n + d.n, f: { kind: 'pow', arg: f.arg, m: f.m - 1 } });
  }
  return out;
}

export function deriv(e: Expr): Expr {
  return simplify(e.flatMap(termDeriv));
}

// ---------- printing ----------

function isX(p: Poly): boolean {
  return p.length === 1 && p[0]!.c === 1 && p[0]!.n === 1;
}

function monoPlain(c: number, n: number): string {
  if (n === 0) return num(c);
  const v = n === 1 ? 'x' : `x^${n}`;
  return c === 1 ? v : c === -1 ? MINUS + v : num(c) + v;
}

function signedJoin(parts: string[]): string {
  let s = '';
  for (const p of parts) {
    if (!s) s = p;
    else if (p.startsWith(MINUS)) s += ` ${MINUS} ${p.slice(1)}`;
    else s += ` + ${p}`;
  }
  return s || '0';
}

export function polyPlain(p: Poly): string {
  return signedJoin(p.map((t) => monoPlain(t.c, t.n)));
}

function monoTex(c: number, n: number): string {
  const sign = c < 0 ? '-' : '';
  const a = Math.abs(c);
  if (n === 0) return sign + a;
  const v = n === 1 ? 'x' : `x^{${n}}`;
  return sign + (a === 1 ? '' : String(a)) + v;
}

function texJoin(parts: string[]): string {
  let s = '';
  for (const p of parts) {
    if (!s) s = p;
    else if (p.startsWith('-')) s += ` - ${p.slice(1)}`;
    else s += ` + ${p}`;
  }
  return s || '0';
}

export function polyTex(p: Poly): string {
  return texJoin(p.map((t) => monoTex(t.c, t.n)));
}

function fnPlain(f: Fn): string {
  if (f.kind === 'ln') return f.abs ? 'ln|x|' : 'ln(x)';
  const a = polyPlain(f.arg);
  if (f.kind === 'exp') return isX(f.arg) ? 'e^x' : `e^(${a})`;
  if (f.kind === 'pow') return f.m === 1 ? `(${a})` : `(${a})^${f.m}`;
  return `${f.kind}(${a})`;
}

function fnTex(f: Fn): string {
  if (f.kind === 'ln') return f.abs ? '\\ln|x|' : '\\ln x';
  const a = polyTex(f.arg);
  if (f.kind === 'exp') return `e^{${a}}`;
  if (f.kind === 'pow') return f.m === 1 ? `(${a})` : `(${a})^{${f.m}}`;
  return isX(f.arg) ? `\\${f.kind} x` : `\\${f.kind}(${a})`;
}

/**
 * Coefficients are integers in generated questions; worked solutions for user input can produce simple
 * fractions (∫ x² dx = x³/3). Returns [p, q] with q > 0, or throws when the value isn't a small fraction.
 */
export function ratio(c: number): [number, number] {
  for (let q = 1; q <= 1000; q++) {
    const p = Math.round(c * q);
    if (Math.abs(p / q - c) < 1e-9 * Math.max(1, Math.abs(c))) return [p, q];
  }
  throw new Error(`coefficient ${c} is not a simple fraction`);
}

/** A coefficient as text: 3, −2, 1/3. */
export function coefPlain(c: number): string {
  const [p, q] = ratio(c);
  return q === 1 ? num(p) : `${num(p)}/${q}`;
}

export function termPlain(t: Term): string {
  const [p, q] = ratio(t.c);
  const sign = p < 0 ? MINUS : '';
  const a = Math.abs(p);
  if (t.n < 0) {
    const den = t.n === -1 ? 'x' : `x^${-t.n}`;
    return `${sign}${a}/${q === 1 ? den : `(${q}${den})`}` + (t.f ? ` ${fnPlain(t.f)}` : '');
  }
  const xs = t.n === 0 ? '' : t.n === 1 ? 'x' : `x^${t.n}`;
  const coef = a === 1 && (xs || t.f) ? '' : String(a);
  const head = coef + xs;
  // "24x(…)" would read as 24 × (…) in math-core ("x" as a times sign), so a power factor gets an explicit dot.
  const sep = !t.f || !head ? '' : t.f.kind === 'pow' ? (xs ? '·' : '') : t.f.kind === 'exp' && !xs ? '' : ' ';
  const body = t.f ? head + sep + fnPlain(t.f) : head;
  return sign + body + (q === 1 ? '' : `/${q}`);
}

export function termTex(t: Term): string {
  const [p, q] = ratio(t.c);
  const sign = p < 0 ? '-' : '';
  const a = Math.abs(p);
  if (t.n < 0) {
    const den = t.n === -1 ? 'x' : `x^{${-t.n}}`;
    return `${sign}\\frac{${a}}{${q === 1 ? '' : q}${den}}` + (t.f ? fnTex(t.f) : '');
  }
  const xs = t.n === 0 ? '' : t.n === 1 ? 'x' : `x^{${t.n}}`;
  const coef = a === 1 && (xs || t.f) ? '' : String(a);
  const head = coef + xs;
  const body = !t.f ? head : head + (head && t.f.kind !== 'exp' && t.f.kind !== 'pow' ? '\\,' : '') + fnTex(t.f);
  return q === 1 ? sign + body : `${sign}\\frac{${body}}{${q}}`;
}

export function exprPlain(e: Expr): string {
  return signedJoin(e.map(termPlain));
}

export function exprTex(e: Expr): string {
  return texJoin(e.map(termTex));
}

export { fnPlain, fnTex };
