/** Shared machinery for the models area: column parsing, OLS with diagnostics, Levenberg–Marquardt. */
import { lstsq } from '../regression';
import { chiSf, fSf, inv, mean, pastedTable, rawNums, tSf, type Column, type Line, type PCtx, type Table, bad, f } from './util';

export const NUMS = '-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:e[-+]?\\d+)?';

/** Display helpers: estimates to 7 significant digits. */
export const g7 = (x: number) => (Number.isNaN(x) ? '—' : f(x, 7));
export const g6 = (x: number) => (Number.isNaN(x) ? '—' : f(x, 6));

/**
 * Labelled lists written inline: "y: 3 7 7 x1: 1 2 3", "x = [1, 2, 3]". Names are single tokens. Numbers glued to
 * letters belong to the next name ("x2:"), never to the data.
 */
export function namedLists(text: string): Column[] {
  const re = new RegExp(`(?:^|[\\s,;(])([a-z][a-z0-9_]*)\\s*(?::|=)\\s*\\[?\\s*((?:${NUMS}(?:\\s*[,;]?\\s*)(?![a-z]))+)`, 'g');
  const out: Column[] = [];
  for (const m of text.matchAll(re)) {
    const xs = rawNums(m[2]!);
    if (xs.length >= 2) out.push({ name: m[1]!, xs });
  }
  return out;
}

/** Numeric columns from a pasted table (lowercased header names), or inline labelled lists. */
export function dataColumns(c: PCtx): Column[] {
  if (c.raw.includes('\n')) {
    const t = pastedTable(c.raw);
    if (t) {
      const cols: Column[] = [];
      t.columns.forEach((name, j) => {
        const xs = t.rows.map((r) => r[j]);
        if (xs.every((x) => typeof x === 'number')) cols.push({ name: name.trim().toLowerCase(), xs: xs as number[] });
      });
      if (cols.length >= 2) return cols;
    }
  }
  return namedLists(c.s);
}

/** "regress y on x1 x2", "y on x1 and x3", "y ~ x1 + x2": the response and predictor names that exist as columns. */
export function modelSpec(text: string, names: string[]): { y: string; xs: string[] } | null {
  const has = new Set(names);
  const m = /([a-z][a-z0-9_]*)\s+(?:on|~)\s+([a-z0-9_ ,+&]+)/.exec(text);
  if (!m || !has.has(m[1]!)) return null;
  const xs: string[] = [];
  for (const w of m[2]!.split(/[\s,+&]+/)) {
    if (!w || w === 'and') continue;
    if (has.has(w)) xs.push(w);
    else break;
  }
  return xs.length ? { y: m[1]!, xs } : null;
}

export function checkLengths(cols: Column[]): void {
  const n = cols[0]!.xs.length;
  const badCol = cols.find((c) => c.xs.length !== n);
  if (badCol) bad(`Every variable needs the same number of values: ${cols.map((c) => `${c.name} has ${c.xs.length}`).join(', ')}`);
}

/** Response and predictors: explicit spec, else a column named y, else the last column. */
export function roles(text: string, cols: Column[], exclude: string[] = []): { y: Column; xs: Column[] } {
  const usable = cols.filter((c) => !exclude.includes(c.name));
  const spec = modelSpec(text, usable.map((c) => c.name));
  const by = (n: string) => usable.find((c) => c.name === n)!;
  if (spec) return { y: by(spec.y), xs: spec.xs.map(by) };
  const y = usable.find((c) => c.name === 'y') ?? usable[usable.length - 1]!;
  return { y, xs: usable.filter((c) => c !== y) };
}

export interface OLS {
  names: string[];
  b: number[];
  se: number[];
  t: number[];
  p: number[];
  n: number;
  k: number;
  df: number;
  sse: number;
  sst: number;
  r2: number;
  adj: number;
  sigma: number;
  F: number;
  Fp: number;
  e: number[];
  fit: number[];
  XtXi: number[][];
  X: number[][];
  y: number[];
  intercept: boolean;
}

/** Least squares (Householder QR for the coefficients, (X'X)⁻¹ for the covariance). X given as rows. */
export function ols(X: number[][], y: number[], names: string[], intercept = true): OLS {
  const n = y.length;
  const k = X[0]!.length;
  if (n <= k - 1 || n < k) bad(`${k} coefficients need at least ${k} observations (there ${n === 1 ? 'is' : 'are'} ${n})`);
  const cols = Array.from({ length: k }, (_v, j) => X.map((r) => r[j]!));
  const b = lstsq(cols, y);
  const XtX = Array.from({ length: k }, (_v, a) => Array.from({ length: k }, (_w, c) => X.reduce((s, r) => s + r[a]! * r[c]!, 0)));
  const XtXi = b ? inv(XtX) : null;
  if (!b || !XtXi) {
    const which = collinearCulprit(cols, names);
    bad(`The predictors are perfectly collinear${which ? ` (${which})` : ''}, so the coefficients are not identified. Drop one of them.`);
  }
  // Round-off cleanup: a coefficient whose largest contribution is ~1e-11 of the response scale is exactly 0.
  const yScale = Math.max(...y.map(Math.abs), 1e-300);
  cols.forEach((col, j) => {
    if (Math.abs(b[j]!) * Math.max(...col.map(Math.abs)) < 1e-11 * yScale) b[j] = 0;
  });
  const fit = X.map((r) => r.reduce((s, v, j) => s + v * b[j]!, 0));
  const e = y.map((v, i) => v - fit[i]!);
  const sse = e.reduce((s, v) => s + v * v, 0);
  const ym = mean(y);
  const sst = intercept ? y.reduce((s, v) => s + (v - ym) ** 2, 0) : y.reduce((s, v) => s + v * v, 0);
  const df = n - k;
  const s2 = df > 0 ? sse / df : NaN;
  const tiny = sse <= 1e-20 * Math.max(1, sst);
  const se = XtXi.map((r, j) => (tiny ? 0 : Math.sqrt(s2 * r[j]!)));
  const t = b.map((v, j) => (se[j] === 0 ? (Math.abs(v) < 1e-12 ? NaN : Infinity * Math.sign(v)) : v / se[j]!));
  const p = t.map((v) => (Number.isNaN(v) ? NaN : !isFinite(v) ? 0 : df > 0 ? Math.min(1, 2 * tSf(Math.abs(v), df)) : NaN));
  const r2 = tiny ? 1 : 1 - sse / sst;
  const q = k - (intercept ? 1 : 0);
  const adj = df > 0 ? 1 - ((1 - r2) * (n - (intercept ? 1 : 0))) / df : NaN;
  const F = q > 0 && df > 0 ? (tiny ? Infinity : (r2 / q) / ((1 - r2) / df)) : NaN;
  const Fp = Number.isNaN(F) ? NaN : !isFinite(F) ? 0 : fSf(F, q, df);
  return { names, b, se, t, p, n, k, df, sse, sst, r2, adj, sigma: Math.sqrt(s2), F, Fp, e, fit, XtXi, X, y, intercept };
}

function collinearCulprit(cols: number[][], names: string[]): string | null {
  for (let j = 1; j < cols.length; j++) {
    const others = cols.filter((_c, i) => i !== j);
    const b = lstsq(others, cols[j]!);
    if (!b) continue;
    const res = cols[j]!.map((v, i) => v - others.reduce((s, c, m) => s + c[i]! * b[m]!, 0));
    if (res.every((r) => Math.abs(r) < 1e-9 * Math.max(1, Math.abs(cols[j]![0]!)))) return `${names[j]} is an exact linear combination of the others`;
  }
  return null;
}

/** White / MacKinnon–White heteroscedasticity-consistent standard errors. */
export function robustSE(o: OLS, kind: 'HC0' | 'HC1'): number[] {
  const k = o.k;
  const meat = Array.from({ length: k }, (_v, a) => Array.from({ length: k }, (_w, c) => o.X.reduce((s, r, i) => s + r[a]! * r[c]! * o.e[i]! ** 2, 0)));
  const A = o.XtXi;
  const V = A.map((r) => meat[0]!.map((_v, j) => r.reduce((s, v, m) => s + v * meat[m]![j]!, 0)));
  const W = V.map((r) => A[0]!.map((_v, j) => r.reduce((s, v, m) => s + v * A[m]![j]!, 0)));
  const scale = kind === 'HC1' ? o.n / (o.n - k) : 1;
  return W.map((r, j) => Math.sqrt(r[j]! * scale));
}

export function durbinWatson(e: number[]): number {
  let num = 0;
  let den = 0;
  for (let i = 0; i < e.length; i++) {
    den += e[i]! ** 2;
    if (i) num += (e[i]! - e[i - 1]!) ** 2;
  }
  return num / den;
}

/** VIF_j = 1/(1 − R²_j) regressing each predictor on the others (with an intercept). */
export function vifs(xs: Column[]): number[] {
  if (xs.length < 2) return xs.map(() => 1);
  return xs.map((c, j) => {
    const others = xs.filter((_v, i) => i !== j);
    const X = c.xs.map((_v, i) => [1, ...others.map((o) => o.xs[i]!)]);
    const r = ols(X, c.xs, ['(Intercept)', ...others.map((o) => o.name)]);
    return 1 / (1 - r.r2);
  });
}

/** Koenker's studentised Breusch–Pagan: n·R² from regressing e² on the predictors; χ²(k − 1). */
export function breuschPagan(o: OLS): { lm: number; df: number; p: number } {
  const e2 = o.e.map((v) => v * v);
  const aux = ols(o.X, e2, o.names, o.intercept);
  const df = o.k - (o.intercept ? 1 : 0);
  const lm = o.n * aux.r2;
  return { lm, df, p: chiSf(lm, df) };
}

export function coefTable(o: OLS, extra?: { label: string; se: number[] }): Table {
  const cols = ['Term', 'Estimate', 'Std. error', 't', 'p-value'];
  if (extra) cols.push(extra.label, 'Robust t', 'Robust p');
  const rows = o.names.map((nm, j) => {
    const r = [nm, g7(o.b[j]!), g7(o.se[j]!), g6(o.t[j]!), g6(o.p[j]!)];
    if (extra) {
      const se = extra.se[j]!;
      const t = o.b[j]! / se;
      r.push(g7(se), g6(t), g6(o.df > 0 ? Math.min(1, 2 * tSf(Math.abs(t), o.df)) : NaN));
    }
    return r;
  });
  return { columns: cols, rows };
}

export function equationOf(o: OLS, yName: string): string {
  let s = `${yName} = ${g6(o.b[0]!)}`;
  for (let j = 1; j < o.b.length; j++) {
    const v = o.b[j]!;
    s += ` ${v < 0 ? '−' : '+'} ${g6(Math.abs(v))}·${o.names[j]}`;
  }
  return s;
}

export function fitLines(o: OLS): Line[] {
  return [
    { label: 'R²', display: g7(o.r2) },
    { label: 'Adjusted R²', display: g7(o.adj) },
    { label: 'Residual standard error', display: `${g7(o.sigma)}` },
    { label: 'F-statistic', display: g7(o.F) },
    { label: 'F p-value', display: g6(o.Fp) },
    { label: 'Observations', display: String(o.n) },
    { label: 'SSE', display: g7(o.sse) },
  ];
}

/** Levenberg–Marquardt least squares with a central-difference Jacobian. */
export function levenbergMarquardt(model: (x: number, p: number[]) => number, xs: number[], ys: number[], p0: number[]): { p: number[]; sse: number; converged: boolean } {
  let p = p0.slice();
  const resid = (q: number[]) => ys.map((y, i) => y - model(xs[i]!, q));
  const sseOf = (q: number[]) => {
    const r = resid(q);
    const s = r.reduce((a, v) => a + v * v, 0);
    return Number.isFinite(s) ? s : Infinity;
  };
  let sse = sseOf(p);
  let lambda = 1e-3;
  let converged = false;
  for (let it = 0; it < 2000; it++) {
    const r = resid(p);
    const J = xs.map((x) =>
      p.map((v, j) => {
        const h = 1e-6 * Math.max(1, Math.abs(v));
        const up = p.slice();
        const dn = p.slice();
        up[j] = v + h;
        dn[j] = v - h;
        return (model(x, up) - model(x, dn)) / (2 * h);
      }),
    );
    const k = p.length;
    const JtJ = Array.from({ length: k }, (_v, a) => Array.from({ length: k }, (_w, c) => J.reduce((s, row) => s + row[a]! * row[c]!, 0)));
    const Jtr = Array.from({ length: k }, (_v, a) => J.reduce((s, row, i) => s + row[a]! * r[i]!, 0));
    let improved = false;
    for (let tries = 0; tries < 30; tries++) {
      const A = JtJ.map((row, a) => row.map((v, c) => (a === c ? v * (1 + lambda) + 1e-300 : v)));
      const Ai = inv(A);
      if (!Ai) {
        lambda *= 10;
        continue;
      }
      const d = Ai.map((row) => row.reduce((s, v, c) => s + v * Jtr[c]!, 0));
      const q = p.map((v, j) => v + d[j]!);
      const s = sseOf(q);
      if (s < sse) {
        const rel = (sse - s) / Math.max(sse, 1e-300);
        const step = Math.max(...d.map((v, j) => Math.abs(v) / Math.max(1e-12, Math.abs(q[j]!))));
        p = q;
        sse = s;
        lambda = Math.max(lambda / 10, 1e-12);
        improved = true;
        if (rel < 1e-15 || step < 1e-13 || sse < 1e-28) converged = true;
        break;
      }
      lambda *= 10;
    }
    if (!improved) {
      converged = true;
      break;
    }
    if (converged) break;
  }
  return { p, sse, converged };
}

/** Largest relative change check for repeated optimiser restarts. */
export const finite = (xs: number[]) => xs.every((v) => Number.isFinite(v));
