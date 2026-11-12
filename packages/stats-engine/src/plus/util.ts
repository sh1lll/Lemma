/**
 * Shared helpers for the "stats plus" chunk (advanced tests, regression, time series, econometrics, ML math,
 * distributions, Markov chains). Lives in its own lazy chunk; nothing here is in the main bundle.
 */
import { MathError, type Answer, type AnswerResult } from '@lemma/math-core';
import { f, normalize, numbersIn, primaryOf, type Ctx } from '../common';
import { betaIncBoth, chi2Sf, gammaP, lnGamma, normCdf, normInv, normSf, tTail } from '../special';

export { f, primaryOf, type Ctx };
export const KIND = 'stats';

export type Line = { label: string; display: string };
export type Table = NonNullable<Answer['table']>;

/** Plus-chunk context: the normalised text plus the raw input (newlines kept, for pasted tables). */
export interface PCtx extends Ctx {
  /** Raw input with newlines kept, lowercased. */
  raw: string;
}

export type PHandler = (c: PCtx) => AnswerResult | null;

/** Lowercases and normalises each line separately so pasted tables keep their rows. */
export function prepare(input: string): PCtx {
  const raw = input.replace(/\r\n?/g, '\n').toLowerCase();
  const s = normalize(input);
  return { input, s, rest: s, raw };
}

export class Need extends Error {}

/** A missing input is a question back to the user, never a guess. */
export function needErr(c: Ctx, what: string): AnswerResult {
  return { ok: false, kind: KIND, input: c.input, error: new MathError('ambiguous-reference', what) };
}

export function bad(message: string): never {
  throw new MathError('domain', message);
}

export function answer(
  c: Ctx,
  a: { expression: string; value?: number; display?: string; digits?: number; lines?: Line[]; notes?: string[]; table?: Table; plot?: Answer['plot'] },
): Answer {
  let primary: Answer['primary'];
  let value: Answer['value'];
  if (a.value !== undefined && Number.isFinite(a.value)) {
    const p = primaryOf(a.value, a.digits ?? 8);
    primary = a.display ? { display: a.display, plain: p.primary.plain, spoken: a.display } : p.primary;
    value = p.value;
  } else {
    const d = a.display ?? (a.value === undefined ? '' : f(a.value));
    primary = { display: d, plain: d, spoken: d };
  }
  return {
    ok: true,
    kind: KIND,
    input: c.input,
    expression: a.expression,
    primary,
    value,
    lines: a.lines ?? [],
    notes: a.notes ?? [],
    ...(a.table ? { table: a.table } : {}),
    ...(a.plot ? { plot: a.plot } : {}),
  };
}

export const fmt = (x: number, d = 6) => f(x, d);
export const fmtP = (p: number) => (p < 1e-4 && p > 0 ? p.toExponential(3).replace('e', '×10^').replace('+', '') : f(p, 4));
export const list = (xs: number[], d = 6, max = 12) => xs.slice(0, max).map((x) => f(x, d)).join(', ') + (xs.length > max ? ', …' : '');

// ---------- significance ----------

/** "alpha 0.01", "α = 1%", "at the 1% level", "significance level 0.10". Default 0.05. */
export function alphaOf(c: Ctx): { a: number; stated: boolean } {
  const m =
    /(?:alpha|significance(?: level)?|level of significance|sig\.? level)\s*(?:=|:|of|is|at)?\s*(\d*\.?\d+)\s*(%)?/.exec(c.s) ??
    /(?:at|with) (?:the |a )?(\d*\.?\d+)\s*(%)?\s*(?:significance|level)/.exec(c.s);
  if (m) {
    let v = Number(m[1]);
    if (m[2] || v >= 1) v /= 100;
    if (v > 0 && v < 1) return { a: v, stated: true };
  }
  return { a: 0.05, stated: false };
}

export type Tail = 'two' | 'greater' | 'less';
export function tailOf(s: string): { tail: Tail; stated: boolean } {
  if (/\b(?:one[- ]sided|one[- ]tailed|right[- ]tailed|upper[- ]tailed)\b.*\b(?:less|lower|left)\b|\bleft[- ]tailed\b|\blower[- ]tailed\b|\balternative\s*(?:=|:)?\s*less\b|\bh1\s*:?[^,;]*</.test(s)) return { tail: 'less', stated: true };
  if (/\bright[- ]tailed\b|\bupper[- ]tailed\b|\bone[- ]sided\b|\bone[- ]tailed\b|\balternative\s*(?:=|:)?\s*greater\b|\bh1\s*:?[^,;]*>/.test(s)) return { tail: 'greater', stated: true };
  return { tail: 'two', stated: /\btwo[- ](?:sided|tailed)\b/.test(s) };
}

export interface TestReport {
  test: string;
  statName: string;
  stat: number;
  df?: string | number;
  p: number;
  alpha: { a: number; stated: boolean };
  h0: string;
  h1: string;
  /** Plain-language conclusion when H0 is rejected / not rejected. */
  reject: string;
  retain: string;
  lines?: Line[];
  table?: Table;
  assumptions?: string[];
  notes?: string[];
  tailNote?: boolean;
  plot?: Answer['plot'];
}

/** Every hypothesis test answers the same way: test, statistic, df, p-value, decision at α, plain conclusion, assumptions. */
export function testAnswer(c: Ctx, o: TestReport): Answer {
  const rej = o.p < o.alpha.a;
  const decision = `${rej ? 'Reject' : 'Fail to reject'} H₀ at α = ${f(o.alpha.a)}`;
  const notes = [...(o.notes ?? [])];
  if (o.assumptions?.length) notes.push(`Assumes: ${o.assumptions.join('; ')}`);
  if (!o.alpha.stated) notes.push('α = 0.05 (say “alpha 0.01” to change)');
  const p = primaryOf(o.p, 6);
  const pd = fmtP(o.p);
  return {
    ok: true,
    kind: KIND,
    input: c.input,
    expression: o.test,
    primary: { display: `p = ${pd}`, plain: p.primary.plain, spoken: `p equals ${p.primary.spoken}. ${decision}` },
    value: p.value,
    lines: [
      { label: 'Test', display: o.test },
      { label: o.statName, display: f(o.stat, 6) },
      ...(o.df !== undefined ? [{ label: 'Degrees of freedom', display: typeof o.df === 'number' ? f(o.df, 6) : o.df }] : []),
      { label: 'p-value', display: pd },
      { label: 'Hypotheses', display: `H₀: ${o.h0} · H₁: ${o.h1}` },
      { label: 'Decision', display: decision },
      { label: 'Conclusion', display: rej ? o.reject : o.retain },
      ...(o.lines ?? []),
    ],
    notes,
    ...(o.table ? { table: o.table } : {}),
    ...(o.plot ? { plot: o.plot } : {}),
  };
}

/** Upper-tail p for a test statistic with the given survival function and tail. */
export function pFrom(stat: number, tail: Tail, sf: (x: number) => number): number {
  if (tail === 'greater') return sf(stat);
  if (tail === 'less') return 1 - sf(stat);
  return Math.min(1, 2 * Math.min(sf(stat), 1 - sf(stat)));
}

// ---------- distributions used by tests ----------
export const tSf = (t: number, df: number) => (t >= 0 ? tTail(t, df) : 1 - tTail(t, df));
export const zSf = normSf;
export const zCdf = normCdf;
export const zInv = normInv;
export const chiSf = chi2Sf;
/** P(F > x) for F(d1, d2). */
export function fSf(x: number, d1: number, d2: number): number {
  if (!(x > 0)) return 1;
  const z = (d1 * x) / (d1 * x + d2);
  return betaIncBoth(d2 / (d1 * x + d2), d2 / 2, d1 / 2, z)[0];
}
export function fCdf(x: number, d1: number, d2: number): number {
  return 1 - fSf(x, d1, d2);
}
/** Inverse F CDF by bisection. */
export function fInv(p: number, d1: number, d2: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return Infinity;
  let lo = 0;
  let hi = 1;
  while (fCdf(hi, d1, d2) < p) {
    lo = hi;
    hi *= 2;
    if (hi > 1e12) return Infinity;
  }
  for (let i = 0; i < 200 && hi - lo > 1e-14 * hi; i++) {
    const mid = (lo + hi) / 2;
    if (fCdf(mid, d1, d2) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
export { gammaP, lnGamma };

// ---------- data input ----------

const NUMRE = /-?(?:\d+(?:\.\d+)?|\.\d+)(?:e[-+]?\d+)?/g;

/** Numbers in a fragment (commas as list separators unless "1,000"-style grouping is clear). */
export function nums(text: string): number[] {
  return numbersIn(text).map((n) => n.v);
}

/** Every number, ignoring names: for strings already known to be pure data. */
export function rawNums(text: string): number[] {
  return [...text.matchAll(NUMRE)].map((m) => Number(m[0])).filter(Number.isFinite);
}

export interface Column {
  name: string;
  xs: number[];
}

/**
 * A pasted table (CSV, TSV, semicolons or spaces), one row per line, optionally with a header row.
 * Null unless at least 2 data rows and 2 columns.
 */
export function pastedTable(raw: string): { columns: string[]; rows: (number | null)[][]; text: string[][] } | null {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  // Drop a leading instruction line ("anova:" / "regress y on x") that has fewer separators than the data.
  const body = lines.filter((l) => /\d/.test(l) || /[,\t;]/.test(l));
  if (body.length < 3 && !(body.length >= 2 && lines.length >= 2)) return null;
  const sepOf = (l: string) => (l.includes('\t') ? '\t' : l.includes(';') && !l.includes(',') ? ';' : l.includes(',') ? ',' : ' ');
  // Find the first line that splits into ≥ 2 cells consistently with the next.
  let start = -1;
  let sep = ',';
  for (let i = 0; i + 1 < lines.length; i++) {
    const s = sepOf(lines[i + 1]!);
    const a = split(lines[i]!, s);
    const b = split(lines[i + 1]!, s);
    if (a.length >= 2 && a.length === b.length) {
      start = i;
      sep = s;
      break;
    }
  }
  if (start < 0) return null;
  const grid = lines.slice(start).map((l) => split(l, sep));
  const width = grid[0]!.length;
  const rowsAll = grid.filter((r) => r.length === width);
  const isNum = (x: string) => /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?%?$/i.test(x.replace(/[$€£,]/g, ''));
  const header = rowsAll[0]!.some((x) => x && !isNum(x)) && rowsAll.slice(1).some((r) => r.some(isNum));
  const columns = header ? rowsAll[0]!.map((h, i) => h || `col${i + 1}`) : Array.from({ length: width }, (_v, i) => `col${i + 1}`);
  const data = header ? rowsAll.slice(1) : rowsAll;
  if (data.length < 2) return null;
  const rows = data.map((r) => r.map((x) => (isNum(x) ? Number(x.replace(/[$€£,%]/g, '')) : null)));
  return { columns, rows, text: data };
}

function split(line: string, sep: string): string[] {
  return (sep === ' ' ? line.split(/\s+/) : line.split(sep)).map((x) => x.trim());
}

/** Numeric columns of a pasted table (columns with any non-number are skipped unless `keepText`). */
export function tableColumns(raw: string): Column[] | null {
  const t = pastedTable(raw);
  if (!t) return null;
  const cols: Column[] = [];
  t.columns.forEach((name, j) => {
    const xs = t.rows.map((r) => r[j]);
    if (xs.every((x) => x !== null && x !== undefined)) cols.push({ name, xs: xs as number[] });
  });
  return cols.length ? cols : null;
}

/**
 * Labelled lists: "group a: 1 2 3; group b: 4 5 6", "x1 = [1,2,3] x2 = [4,5,6] y = [..]", "control: 1,2 treatment: 3,4".
 * Names are short phrases ending in ":" or "=".
 */
export function labelledColumns(text: string): Column[] {
  const re = /([a-z][a-z0-9_ ]{0,24}?)\s*(?::|=)\s*[[(]?\s*((?:-?(?:\d+(?:\.\d+)?|\.\d+)(?:e[-+]?\d+)?\s*(?:,|;)?\s*)+)[\])]?/g;
  const out: Column[] = [];
  for (const m of text.matchAll(re)) {
    const xs = rawNums(m[2]!);
    const name = m[1]!.trim().replace(/^(?:and|with|for|of|vs|versus|on|where|the)\s+/, '');
    if (xs.length >= 2) out.push({ name, xs });
  }
  return out;
}

/** Bracketed lists: "[1, 2, 3] [4, 5, 6]" or "(1 2 3), (4 5 6)" with at least 3 numbers each (pairs are points). */
export function bracketLists(text: string, min = 3): number[][] {
  const out: number[][] = [];
  for (const m of text.matchAll(/[[(]\s*([-\d.eE\s,;]+?)\s*[\])]/g)) {
    const xs = rawNums(m[1]!);
    if (xs.length >= min) out.push(xs);
  }
  return out;
}

/**
 * Groups of numbers, in order of preference: a pasted table's columns, labelled lists, bracketed lists, then plain
 * lists separated by ";", "|", newlines, " vs " or " and ".
 */
export function groupsOf(c: PCtx, text = c.rest): Column[] {
  if (c.raw.includes('\n')) {
    const t = tableColumns(c.raw);
    if (t && t.length >= 2) return t;
  }
  const lab = labelledColumns(text);
  if (lab.length >= 2) return lab;
  const br = bracketLists(text, 2);
  if (br.length >= 2) return br.map((xs, i) => ({ name: `group ${i + 1}`, xs }));
  const lines = c.raw.split('\n').map((l) => rawNums(l)).filter((xs) => xs.length >= 2);
  if (lines.length >= 2) return lines.map((xs, i) => ({ name: `group ${i + 1}`, xs }));
  for (const sep of [/\s*[;|]\s*/, /\s+(?:vs\.?|versus)\s+/, /\s+and\s+/]) {
    const parts = text.split(sep).map((p) => nums(p)).filter((xs) => xs.length >= 1);
    if (parts.length >= 2 && parts.filter((xs) => xs.length >= 2).length >= 2) return parts.map((xs, i) => ({ name: `group ${i + 1}`, xs }));
  }
  return [];
}

/** A matrix: "[[1,2],[3,4]]", "[1 2; 3 4]", rows on separate lines, or rows separated by ";" or "/". */
export function matrixOf(c: PCtx, text = c.rest): number[][] | null {
  const nested = /\[\s*\[([\s\S]*?)\]\s*\]/.exec(text);
  if (nested) {
    const rows = nested[0].slice(1, -1).split(/\]\s*,?\s*\[/).map((r) => rawNums(r));
    if (rows.length >= 2 && rows.every((r) => r.length === rows[0]!.length && r.length >= 1)) return rows;
  }
  const semi = /\[([^\]]*;[^\]]*)\]/.exec(text);
  if (semi) {
    const rows = semi[1]!.split(';').map((r) => rawNums(r));
    if (rows.length >= 2 && rows.every((r) => r.length === rows[0]!.length && r.length >= 1)) return rows;
  }
  if (c.raw.includes('\n')) {
    const rows = c.raw.split('\n').map((l) => l.trim()).filter((l) => l && /^[-\d.\s,;\t|]+$/.test(l)).map((l) => rawNums(l));
    if (rows.length >= 2 && rows.every((r) => r.length === rows[0]!.length && r.length >= 2)) return rows;
  }
  for (const sep of [';', '/', '|']) {
    if (!text.includes(sep)) continue;
    const parts = text.split(sep);
    const rows = parts.map((r) => rawNums(r)).filter((r) => r.length);
    if (rows.length >= 2 && rows.every((r) => r.length === rows[0]!.length && r.length >= 2)) return rows;
  }
  return null;
}

/** Named scalar parameter, e.g. param(c, 'tp|true positives') → 50 for "tp 50" / "tp = 50" / "50 true positives". */
export function param(text: string, names: string): number | null {
  const NUMS = '(-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:e[-+]?\\d+)?)';
  const m =
    new RegExp(`(?:^|[^a-z0-9_])(?:${names})(?![a-z0-9_])\\s*(?:=|:|is|of|was|at)?\\s*${NUMS}\\s*(%)?`).exec(text) ??
    new RegExp(`(?:^|[^a-z0-9_.])${NUMS}\\s*(%)?\\s+(?:${names})(?![a-z0-9_])`).exec(text);
  if (!m) return null;
  const v = Number(m[1]);
  return m[2] ? v / 100 : v;
}

// ---------- numerics ----------
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const mean = (xs: number[]) => sum(xs) / xs.length;
export function variance(xs: number[], sample = true): number {
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return s / (xs.length - (sample ? 1 : 0));
}
export const sd = (xs: number[], sample = true) => Math.sqrt(variance(xs, sample));
export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}
export function cov(x: number[], y: number[]): number {
  const mx = mean(x);
  const my = mean(y);
  let s = 0;
  for (let i = 0; i < x.length; i++) s += (x[i]! - mx) * (y[i]! - my);
  return s / (x.length - 1);
}
export function corr(x: number[], y: number[]): number {
  return cov(x, y) / Math.sqrt(variance(x) * variance(y));
}
/** Average ranks (ties share the mean rank), 1-based. */
export function ranks(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k]![1]] = avg;
    i = j + 1;
  }
  return r;
}

// ---------- linear algebra (small dense) ----------
export type Mat = number[][];
export const T = (A: Mat): Mat => A[0]!.map((_v, j) => A.map((r) => r[j]!));
export function mul(A: Mat, B: Mat): Mat {
  return A.map((r) => B[0]!.map((_v, j) => r.reduce((s, a, k) => s + a * B[k]![j]!, 0)));
}
export const mulv = (A: Mat, v: number[]) => A.map((r) => r.reduce((s, a, k) => s + a * v[k]!, 0));
export const eye = (n: number): Mat => Array.from({ length: n }, (_v, i) => Array.from({ length: n }, (_w, j) => (i === j ? 1 : 0)));

/** Inverse by Gauss–Jordan with partial pivoting; null when singular. */
export function inv(A: Mat): Mat | null {
  const n = A.length;
  const M = A.map((r, i) => [...r, ...eye(n)[i]!]);
  let scale = 0;
  for (const r of A) for (const x of r) scale = Math.max(scale, Math.abs(x));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    if (!(Math.abs(M[p]![c]!) > 1e-12 * (scale || 1))) return null;
    [M[c], M[p]] = [M[p]!, M[c]!];
    const piv = M[c]![c]!;
    for (let j = 0; j < 2 * n; j++) M[c]![j]! /= piv;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const fct = M[r]![c]!;
      if (fct !== 0) for (let j = 0; j < 2 * n; j++) M[r]![j]! -= fct * M[c]![j]!;
    }
  }
  return M.map((r) => r.slice(n));
}

export function solve(A: Mat, b: number[]): number[] | null {
  const Ai = inv(A);
  return Ai ? mulv(Ai, b) : null;
}

/** Eigen-decomposition of a symmetric matrix (cyclic Jacobi). Eigenvalues descending, vectors as columns. */
export function symEig(A: Mat): { values: number[]; vectors: Mat } {
  const n = A.length;
  const a = A.map((r) => r.slice());
  const v = eye(n);
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i]![j]! ** 2;
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p]![q]!) < 1e-300) continue;
        const theta = (a[q]![q]! - a[p]![p]!) / (2 * a[p]![q]!);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const cs = 1 / Math.sqrt(t * t + 1);
        const sn = t * cs;
        for (let k = 0; k < n; k++) {
          const akp = a[k]![p]!;
          const akq = a[k]![q]!;
          a[k]![p] = cs * akp - sn * akq;
          a[k]![q] = sn * akp + cs * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p]![k]!;
          const aqk = a[q]![k]!;
          a[p]![k] = cs * apk - sn * aqk;
          a[q]![k] = sn * apk + cs * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k]![p]!;
          const vkq = v[k]![q]!;
          v[k]![p] = cs * vkp - sn * vkq;
          v[k]![q] = sn * vkp + cs * vkq;
        }
      }
  }
  const order = a.map((r, i) => [r[i]!, i] as const).sort((x, y) => y[0] - x[0]);
  const values = order.map(([val]) => val);
  const vectors = v.map((row) => order.map(([, i]) => row[i]!));
  // Sign convention: largest-magnitude component of each vector positive.
  for (let j = 0; j < n; j++) {
    let big = 0;
    for (let i = 0; i < n; i++) if (Math.abs(vectors[i]![j]!) > Math.abs(vectors[big]![j]!)) big = i;
    if (vectors[big]![j]! < 0) for (let i = 0; i < n; i++) vectors[i]![j] = -vectors[i]![j]!;
  }
  return { values, vectors };
}

/** Nelder–Mead minimiser (for likelihoods: GARCH, ARIMA, nonlinear least squares). */
export function nelderMead(fn: (x: number[]) => number, x0: number[], opts: { step?: number[]; iters?: number; tol?: number } = {}): { x: number[]; f: number } {
  const n = x0.length;
  const iters = opts.iters ?? 4000 * n;
  const tol = opts.tol ?? 1e-12;
  let pts: number[][] = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const p = x0.slice();
    p[i] = p[i]! + (opts.step?.[i] ?? (Math.abs(p[i]!) > 1e-8 ? 0.1 * Math.abs(p[i]!) : 0.05));
    pts.push(p);
  }
  let vals = pts.map(fn);
  for (let it = 0; it < iters; it++) {
    const order = vals.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    pts = order.map(([, i]) => pts[i]!);
    vals = order.map(([v]) => v);
    if (Math.abs(vals[n]! - vals[0]!) <= tol * (Math.abs(vals[0]!) + 1e-30) && it > 10) break;
    const cen = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) cen[j]! += pts[i]![j]! / n;
    const at = (t: number) => cen.map((cj, j) => cj + t * (pts[n]![j]! - cj));
    const xr = at(-1);
    const fr = fn(xr);
    if (fr < vals[0]!) {
      const xe = at(-2);
      const fe = fn(xe);
      if (fe < fr) [pts[n], vals[n]] = [xe, fe];
      else [pts[n], vals[n]] = [xr, fr];
    } else if (fr < vals[n - 1]!) {
      [pts[n], vals[n]] = [xr, fr];
    } else {
      const xc = fr < vals[n]! ? at(-0.5) : at(0.5);
      const fc = fn(xc);
      if (fc < Math.min(fr, vals[n]!)) [pts[n], vals[n]] = [xc, fc];
      else {
        for (let i = 1; i <= n; i++) {
          pts[i] = pts[i]!.map((x, j) => pts[0]![j]! + 0.5 * (x - pts[0]![j]!));
          vals[i] = fn(pts[i]!);
        }
      }
    }
  }
  let best = 0;
  for (let i = 1; i <= n; i++) if (vals[i]! < vals[best]!) best = i;
  return { x: pts[best]!, f: vals[best]! };
}

/** Seeded PRNG (mulberry32) so resampling answers are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Quick seeded hash of a string (for reproducible default seeds). */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
