import type { AnswerResult } from '@lemma/math-core';
import { f, fail, need, ok, primaryOf, strip, type Ctx } from './common';
import { readPairs, takePredict } from './paired';
import { evalModel, type Model, type ModelKind, type StatPlot } from './plot';

// ---------- least squares ----------

/**
 * Solves min ‖A·c − y‖² by Householder QR (columns of A given separately). Exact up to rounding and far better
 * conditioned than the normal equations. Null when the columns are (numerically) dependent.
 */
export function lstsq(cols: number[][], y: number[]): number[] | null {
  const n = y.length;
  const p = cols.length;
  const A = cols.map((c) => c.slice());
  const b = y.slice();
  const v = new Array<number>(n);
  for (let j = 0; j < p; j++) {
    const col = A[j]!;
    let norm = 0;
    for (let i = j; i < n; i++) norm += col[i]! * col[i]!;
    norm = Math.sqrt(norm);
    if (norm === 0) return null;
    const alpha = col[j]! > 0 ? -norm : norm;
    let vv = 0;
    for (let i = j; i < n; i++) {
      v[i] = col[i]! - (i === j ? alpha : 0);
      vv += v[i]! * v[i]!;
    }
    if (vv === 0) continue;
    const reflect = (x: number[]) => {
      let d = 0;
      for (let i = j; i < n; i++) d += v[i]! * x[i]!;
      const k = (2 * d) / vv;
      for (let i = j; i < n; i++) x[i] = x[i]! - k * v[i]!;
    };
    for (let k = j; k < p; k++) reflect(A[k]!);
    reflect(b);
  }
  // R is the upper triangle: R[i][k] = A[k][i] for i ≤ k.
  let big = 0;
  for (let j = 0; j < p; j++) big = Math.max(big, Math.abs(A[j]![j]!));
  const c = new Array<number>(p).fill(0);
  for (let i = p - 1; i >= 0; i--) {
    const rii = A[i]![i]!;
    if (!(Math.abs(rii) > big * 1e-11)) return null;
    let s = b[i]!;
    for (let k = i + 1; k < p; k++) s -= A[k]![i]! * c[k]!;
    c[i] = s / rii;
  }
  return c;
}

// ---------- models ----------

const PARAMS: Record<ModelKind, number> = { linear: 2, quadratic: 3, cubic: 4, exponential: 2, power: 2, logarithmic: 2 };
export const MODEL_NAME: Record<ModelKind, string> = {
  linear: 'Linear', quadratic: 'Quadratic', cubic: 'Cubic', exponential: 'Exponential', power: 'Power', logarithmic: 'Logarithmic',
};
const LOG_X = (k: ModelKind) => k === 'power' || k === 'logarithmic';
const LOG_Y = (k: ModelKind) => k === 'exponential' || k === 'power';

export interface Fit {
  model: Model;
  /** Coefficients as shown: highest power first for polynomials; [a, b] for the others (see `equation`). */
  coef: number[];
  r2: number;
  residuals: number[];
  ssRes: number;
  n: number;
  p: number;
}

function binom(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/** Fits `kind` to the points by least squares, refusing (with the reason) when it can't apply. */
export function fitModel(kind: ModelKind, xs: number[], ys: number[]): Fit {
  const n = xs.length;
  const p = PARAMS[kind];
  const name = MODEL_NAME[kind].toLowerCase();
  if (xs.length !== ys.length) fail(`x has ${xs.length} values but y has ${ys.length}`);
  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    if (LOG_Y(kind) && !(y > 0)) {
      fail(`${MODEL_NAME[kind]} regression needs every y above 0, because it fits ln y; y = ${f(y)} at x = ${f(x)} isn't. Try a linear or quadratic fit instead.`);
    }
    if (LOG_X(kind) && !(x > 0)) {
      fail(`${MODEL_NAME[kind]} regression needs every x above 0, because it uses ln x; x = ${f(x)} isn't.`);
    }
  }
  const ts = LOG_X(kind) ? xs.map(Math.log) : xs;
  const distinct = new Set(ts).size;
  if (distinct < p) {
    const what = n < p ? `you gave ${n}` : `you gave ${distinct} different x value${distinct === 1 ? '' : 's'}`;
    fail(`A ${name} fit needs at least ${p} points with different x values; ${what}`);
  }
  const ws = LOG_Y(kind) ? ys.map(Math.log) : ys;
  const m = ts.reduce((a, b) => a + b, 0) / n;
  const s = Math.sqrt(ts.reduce((a, t) => a + (t - m) * (t - m), 0) / n) || 1;
  const us = ts.map((t) => (t - m) / s);
  const deg = kind === 'quadratic' ? 2 : kind === 'cubic' ? 3 : 1;
  const cols = Array.from({ length: deg + 1 }, (_, k) => us.map((u) => u ** k));
  const c = lstsq(cols, ws);
  if (!c) fail(`These points don't determine a ${name} fit`);
  const model: Model = { kind, c, m, s };

  // Coefficients in the raw variable, for the equation shown to people.
  let coef: number[];
  if (kind === 'linear' || kind === 'quadratic' || kind === 'cubic') {
    const raw = new Array<number>(deg + 1).fill(0);
    for (let k = 0; k <= deg; k++) for (let j = 0; j <= k; j++) raw[j] = raw[j]! + (c[k]! * binom(k, j) * (-m) ** (k - j)) / s ** k;
    // Expanding the centred form leaves rounding dust (1.8e-15) where a coefficient is really 0; drop it.
    const X = Math.max(...xs.map(Math.abs)) || 1;
    const Y = Math.max(...ys.map(Math.abs)) || 1;
    coef = raw.map((a, j) => (Math.abs(a) * X ** j < 1e-11 * Y ? 0 : a)).reverse();
  } else {
    let a0 = c[0]! - (c[1]! * m) / s;
    const b = c[1]! / s;
    if (kind === 'logarithmic' && Math.abs(a0) < 1e-11 * (Math.max(...ys.map(Math.abs)) || 1)) a0 = 0;
    coef = LOG_Y(kind) ? [Math.exp(a0), b] : [a0, b];
  }

  const my = ys.reduce((a, b) => a + b, 0) / n;
  let ssRes = 0;
  let ssTot = 0;
  const residuals = ys.map((y, i) => {
    const r = y - evalModel(model, xs[i]!);
    ssRes += r * r;
    ssTot += (y - my) * (y - my);
    return r;
  });
  // Rounding leaves a residual of ~1e-16 on an exact fit; call that exact.
  if (ssRes <= 1e-24 * Math.max(1, ssTot)) ssRes = 0;
  const r2 = ssTot === 0 ? NaN : 1 - ssRes / ssTot;
  return { model, coef, r2, residuals, ssRes, n, p };
}

// ---------- presentation ----------

const plainNum = (v: number) => f(v, 10).replace(/,/g, '').replace('−', '-');

/** "y = 2.01x² − 0.03x + 1.1" (display) and "2.01*x^2 - 0.03*x + 1.1" (plain). */
export function equation(fit: Fit, digits = 6): { display: string; plain: string; spoken: string } {
  const { kind } = fit.model;
  const k = fit.coef;
  const sup = ['', '', '²', '³'];
  if (kind === 'linear' || kind === 'quadratic' || kind === 'cubic') {
    const deg = k.length - 1;
    const d: string[] = [];
    const p: string[] = [];
    const s: string[] = [];
    k.forEach((a, i) => {
      const pow = deg - i;
      if (a === 0 && d.length) return;
      const mag = f(Math.abs(a), digits);
      const term = pow === 0 ? mag : `${mag === '1' ? '' : mag}x${sup[pow]}`;
      const sign = a < 0 ? '−' : '+';
      d.push(d.length ? `${sign} ${term}` : a < 0 ? `−${term}` : term);
      const pt = pow === 0 ? plainNum(Math.abs(a)) : `${plainNum(Math.abs(a))}*x${pow > 1 ? `^${pow}` : ''}`;
      p.push(p.length ? `${a < 0 ? '-' : '+'} ${pt}` : a < 0 ? `-${pt}` : pt);
      s.push(`${s.length ? (a < 0 ? 'minus ' : 'plus ') : a < 0 ? 'minus ' : ''}${f(Math.abs(a), 4)}${pow === 0 ? '' : pow === 1 ? ' x' : ` x ${pow === 2 ? 'squared' : 'cubed'}`}`);
    });
    return { display: `y = ${d.join(' ')}`, plain: p.join(' '), spoken: `y equals ${s.join(' ')}` };
  }
  const [a, b] = k as [number, number];
  if (kind === 'exponential') {
    return { display: `y = ${f(a, digits)}·e^(${f(b, digits)}x)`, plain: `${plainNum(a)}*e^(${plainNum(b)}*x)`, spoken: `y equals ${f(a, 4)} times e to the ${f(b, 4)} x` };
  }
  if (kind === 'power') {
    return { display: `y = ${f(a, digits)}·x^${f(b, digits)}`, plain: `${plainNum(a)}*x^(${plainNum(b)})`, spoken: `y equals ${f(a, 4)} times x to the ${f(b, 4)}` };
  }
  const sign = b < 0 ? '−' : '+';
  return {
    display: `y = ${f(a, digits)} ${sign} ${f(Math.abs(b), digits)}·ln(x)`,
    plain: `${plainNum(a)} ${b < 0 ? '-' : '+'} ${plainNum(Math.abs(b))}*ln(x)`,
    spoken: `y equals ${f(a, 4)} ${b < 0 ? 'minus' : 'plus'} ${f(Math.abs(b), 4)} natural log x`,
  };
}

/** Plain-language notes on the residuals: exact fits, and runs of one sign that betray a missed curve. */
export function residualNotes(fit: Fit, xs: number[]): string[] {
  const { n, p, residuals, model } = fit;
  if (n === p) return [`${n} points and ${p} parameters: the curve passes through every point exactly, so R² = 1 says nothing about fit. Add more data.`];
  if (fit.ssRes === 0) return ['Every point lies exactly on the curve (all residuals are 0)'];
  const scale = Math.max(...residuals.map(Math.abs));
  const signs = xs
    .map((x, i) => ({ x, r: residuals[i]! }))
    .sort((a, b) => a.x - b.x)
    .filter((e) => Math.abs(e.r) > scale * 1e-9)
    .map((e) => Math.sign(e.r));
  let runs = signs.length ? 1 : 0;
  for (let i = 1; i < signs.length; i++) if (signs[i] !== signs[i - 1]) runs++;
  if (signs.length >= 6 && runs <= 3) {
    const hint = model.kind === 'linear' ? '; a quadratic or exponential fit may suit better' : '';
    return [`Residuals come in ${runs} long runs of one sign (a pattern, not noise): the ${MODEL_NAME[model.kind].toLowerCase()} model misses some curvature${hint}`];
  }
  return [`Residuals change sign ${runs - 1} time${runs === 2 ? '' : 's'} across ${signs.length} points with no clear pattern`];
}

/** Residual rows for the answer: standard error (when there are spare degrees of freedom) and the largest miss. */
export function residualLines(fit: Fit, xs: number[]): { label: string; display: string }[] {
  const out: { label: string; display: string }[] = [];
  if (fit.n > fit.p) out.push({ label: 'Residual std error', display: f(Math.sqrt(fit.ssRes / (fit.n - fit.p)), 6) });
  let worst = 0;
  fit.residuals.forEach((r, i) => Math.abs(r) > Math.abs(fit.residuals[worst]!) && (worst = i));
  out.push({ label: 'Largest residual', display: `${f(fit.residuals[worst]!, 6)} at x = ${f(xs[worst]!, 8)}` });
  return out;
}

export function regressionPlot(fit: Fit, xs: number[], ys: number[], label: string): StatPlot {
  const points: number[] = [];
  xs.forEach((x, i) => points.push(x, ys[i]!));
  const r2 = Number.isNaN(fit.r2) ? '' : ` R² = ${f(fit.r2, 4)}.`;
  return {
    type: 'regression',
    points,
    model: fit.model,
    label,
    summary: `Scatter plot of ${fit.n} points with the fitted ${MODEL_NAME[fit.model.kind].toLowerCase()} curve ${label}.${r2}`,
    xLabel: 'x',
    yLabel: 'y',
  };
}

// ---------- handler ----------

const MODELS: [ModelKind, RegExp][] = [
  ['quadratic', /\bquadratic\b|\bparabol\w*|\bsecond[- ](?:degree|order)\b|\bdegree (?:2|two)\b/],
  ['cubic', /\bcubic\b|\bthird[- ](?:degree|order)\b|\bdegree (?:3|three)\b/],
  ['exponential', /\bexponential(?:ly)?\b|\bexp\b/],
  ['power', /\bpower\b/],
  ['logarithmic', /\blogarithmic\b|\blog\b|\bln\b/],
];
const FIT_WORD = /\bregress\w*|\bfit\w*|\bleast[- ]squares\b|\btrend ?(?:line|curve)\b|\bmodel\b/;

/**
 * Curve fits other than the straight line (which the paired-data handler answers): quadratic, cubic,
 * exponential, power and logarithmic regression, each with R², residual notes and a plot.
 */
export function regression(c: Ctx): AnswerResult | null {
  if (!FIT_WORD.test(c.s)) return null;
  const kind = MODELS.find(([, re]) => re.test(c.s))?.[0];
  if (!kind) {
    if (/\bpolynomial\b/.test(c.s)) return need(c, 'Which degree? Say "quadratic" (degree 2) or "cubic" (degree 3)');
    if (/\bfit (?:a |the )?(?:curve|model)\b/.test(c.s)) return need(c, 'Which kind of curve? Linear, quadratic, cubic, exponential, power or logarithmic');
    return null;
  }
  strip(c, /\bdegree (?:2|3|two|three)\b|\b(?:second|third)[- ](?:degree|order)\b/);
  const at = takePredict(c);
  const pairs = readPairs(c);
  if (!pairs) return need(c, 'Give the data as points, e.g. "(1, 2) (2, 4.1) (3, 5.9)", or as "x: 1, 2, 3 y: 2, 4.1, 5.9"');
  const { xs, ys } = pairs;
  const fit = fitModel(kind, xs, ys);
  const eq = equation(fit);
  const letters = fit.coef.length === 2 && kind !== 'linear' ? ['a', 'b'] : ['a', 'b', 'c', 'd'];
  const lines = [
    ...fit.coef.map((v, i) => ({ label: letters[i]!, display: f(v, 10) })),
    { label: 'Equation', display: eq.display },
    { label: 'R²', display: Number.isNaN(fit.r2) ? 'undefined (all y equal)' : f(fit.r2, 10) },
    ...residualLines(fit, xs),
    { label: 'n', display: String(fit.n) },
  ];
  if (kind === 'exponential') lines.splice(2, 0, { label: 'As a·bˣ', display: `y = ${f(fit.coef[0]!, 6)}·${f(Math.exp(fit.coef[1]!), 6)}^x` });
  const notes = [
    LOG_Y(kind)
      ? `Least squares on ln y${LOG_X(kind) ? ' against ln x' : ''}, as calculators do; R² is measured on y itself`
      : kind === 'logarithmic'
        ? 'Least squares of y against ln x'
        : `Least-squares ${MODEL_NAME[kind].toLowerCase()} fit`,
    ...residualNotes(fit, xs),
  ];
  const plot = regressionPlot(fit, xs, ys, eq.display);
  const title = `${MODEL_NAME[kind]} regression of ${fit.n} (x, y) pairs`;
  if (at !== null) {
    const yhat = evalModel(fit.model, at);
    if (!Number.isFinite(yhat)) fail(`The ${MODEL_NAME[kind].toLowerCase()} model is undefined at x = ${f(at)}`);
    if (at < Math.min(...xs) || at > Math.max(...xs)) notes.push(`x = ${f(at)} is outside the data range (${f(Math.min(...xs))} to ${f(Math.max(...xs))}); extrapolation is unreliable`);
    const { primary, value } = primaryOf(yhat, 10);
    return ok(c, { expression: `Predicted y at x = ${f(at)} · ${title}`, primary, value, lines, notes, plot });
  }
  return ok(c, { expression: title, primary: eq, lines, notes, plot });
}
