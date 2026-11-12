/** Time series on typed data: ACF/PACF, AR/ARIMA, smoothing, moving averages, ADF, cointegration, Granger, VAR, GARCH. */
import type { AnswerResult } from '@lemma/math-core';
import { coefTable, g6, g7, namedLists, NUMS, ols } from './models-core';
import { alphaOf, answer, bad, f, mean, needErr, nelderMead, nums, solve, testAnswer, zCdf, fSf, type Column, type Line, type PCtx, type PHandler } from './util';

// ---------- parameter & data extraction ----------

/** Finds "name 3" / "name = 3" / "name: 3" in c.rest, blanks it and returns the number. */
function takeNum(c: PCtx, names: string): number | null {
  const m = new RegExp(`(?:^|[^a-z0-9_])(?:${names})(?![a-z0-9_])\\s*(?:=|:|of|is)?\\s*(${NUMS})`).exec(c.rest);
  if (!m) return null;
  c.rest = c.rest.slice(0, m.index) + ' '.repeat(m[0].length) + c.rest.slice(m.index + m[0].length);
  return Number(m[1]);
}

function wipe(c: PCtx, re: RegExp): void {
  c.rest = c.rest.replace(new RegExp(re.source, 'g'), (m) => ' '.repeat(m.length));
}

/** The series: every number left after the parameters are taken. */
function series(c: PCtx, min: number, what = 'values'): number[] {
  const xs = nums(c.rest.replace(/[a-z_]+\d+/g, ' '));
  if (xs.length < min) bad(`This needs at least ${min} ${what} (got ${xs.length}); give the series as a list, e.g. "… of 5 7 6 8 9 8 10 12"`);
  return xs;
}

function horizon(c: PCtx): number {
  const h = takeNum(c, 'forecast(?: horizon)?|forecasts|h|steps?(?: ahead)?|periods? ahead|ahead') ?? 1;
  if (!(Number.isInteger(h) && h >= 1 && h <= 100)) bad('The forecast horizon must be a whole number from 1 to 100');
  return h;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// ---------- ACF / PACF ----------
export function acf(x: number[], K: number): number[] {
  const n = x.length;
  const m = mean(x);
  const c0 = sum(x.map((v) => (v - m) ** 2)) / n;
  const out: number[] = [];
  for (let k = 1; k <= K; k++) {
    let s = 0;
    for (let t = 0; t + k < n; t++) s += (x[t]! - m) * (x[t + k]! - m);
    out.push(s / n / c0);
  }
  return out;
}

/** Durbin–Levinson recursion. */
export function pacf(x: number[], K: number): number[] {
  const r = [1, ...acf(x, K)];
  const out: number[] = [];
  let prev: number[] = [];
  for (let k = 1; k <= K; k++) {
    let phi: number[];
    if (k === 1) phi = [r[1]!];
    else {
      const num = r[k]! - prev.reduce((s, p, j) => s + p * r[k - 1 - j]!, 0);
      const den = 1 - prev.reduce((s, p, j) => s + p * r[j + 1]!, 0);
      const pkk = num / den;
      phi = [...prev.map((p, j) => p - pkk * prev[k - 2 - j]!), pkk];
    }
    out.push(phi[k - 1]!);
    prev = phi;
  }
  return out;
}

const ACF_WORDS = /\b(?:acf|pacf|autocorrelations?|autocorrelation function|partial autocorrelations?|correlogram)\b/;
export const acfHandler: PHandler = (c) => {
  if (!ACF_WORDS.test(c.s) || /\bdurbin|\bwatson\b|\bregress/.test(c.s)) return null;
  const K0 = takeNum(c, 'lags?|max lag|up to lag|lag order');
  wipe(c, /\b(?:partial )?autocorrelations?(?: function)?\b|\bacf\b|\bpacf\b/);
  const x = series(c, 3);
  const n = x.length;
  const K = Math.min(K0 ?? Math.min(10, n - 1), n - 1);
  if (!(K >= 1)) bad('The lag must be at least 1');
  const a = acf(x, K);
  const p = pacf(x, K);
  const bound = 1.96 / Math.sqrt(n);
  const lines: Line[] = [];
  a.forEach((v, k) => lines.push({ label: `ACF lag ${k + 1}`, display: g7(v) }));
  p.forEach((v, k) => lines.push({ label: `PACF lag ${k + 1}`, display: g7(v) }));
  lines.push({ label: 'Approx. 95% bound', display: `± ${g6(bound)}` });
  const q = n * (n + 2) * sum(a.map((r, k) => (r * r) / (n - k - 1)));
  lines.push({ label: `Ljung–Box Q(${K})`, display: g7(q) });
  const sig = a.map((v, k) => (Math.abs(v) > bound ? k + 1 : 0)).filter(Boolean);
  const partialOnly = /\bpacf\b|\bpartial\b/.test(c.s);
  return answer(c, {
    expression: `${partialOnly ? 'Partial autocorrelation' : 'Autocorrelation'} of ${n} values, lags 1–${K}`,
    value: partialOnly ? p[0]! : a[0]!,
    display: `${partialOnly ? 'PACF' : 'r'}(1) = ${g6(partialOnly ? p[0]! : a[0]!)}`,
    lines,
    table: { columns: ['Lag', 'ACF', 'PACF'], rows: a.map((v, k) => [String(k + 1), g7(v), g7(p[k]!)]) },
    notes: [
      'Sample ACF rₖ = Σ(xₜ − x̄)(xₜ₊ₖ − x̄) / Σ(xₜ − x̄)²; PACF by the Durbin–Levinson recursion',
      sig.length ? `Lags outside ±1.96/√n: ${sig.join(', ')}` : 'No autocorrelation outside ±1.96/√n',
    ],
  });
};

// ---------- AR / ARIMA ----------
function diff(x: number[]): number[] {
  return x.slice(1).map((v, i) => v - x[i]!);
}

interface ArmaFit {
  mu: number;
  phi: number[];
  theta: number[];
  sse: number;
  resid: number[];
  m: number;
}

function cssResid(w: number[], mu: number, phi: number[], theta: number[]): number[] {
  const p = phi.length;
  const e = new Array<number>(w.length).fill(0);
  for (let t = p; t < w.length; t++) {
    let v = w[t]! - mu;
    for (let i = 0; i < p; i++) v -= phi[i]! * (w[t - 1 - i]! - mu);
    for (let j = 0; j < theta.length; j++) if (t - 1 - j >= 0) v -= theta[j]! * e[t - 1 - j]!;
    e[t] = v;
  }
  return e;
}

function invertible(theta: number[]): boolean {
  if (theta.length === 1) return Math.abs(theta[0]!) < 1;
  if (theta.length === 2) {
    const [a, b] = theta as [number, number];
    return Math.abs(b) < 1 && b + a > -1 && b - a > -1;
  }
  return true;
}

function fitArma(w: number[], p: number, q: number, withMean: boolean): ArmaFit {
  // Pure AR: conditional sum of squares is exactly OLS.
  const rows: number[][] = [];
  const ys: number[] = [];
  for (let t = p; t < w.length; t++) {
    rows.push([...(withMean ? [1] : []), ...Array.from({ length: p }, (_v, i) => w[t - 1 - i]!)]);
    ys.push(w[t]!);
  }
  let mu = withMean ? mean(w) : 0;
  let phi = new Array<number>(p).fill(0);
  if (p > 0 || withMean) {
    if (rows[0]!.length) {
      const o = ols(rows, ys, rows[0]!.map((_v, j) => String(j)), withMean);
      const c0 = withMean ? o.b[0]! : 0;
      phi = o.b.slice(withMean ? 1 : 0);
      const s = sum(phi);
      mu = withMean ? (Math.abs(1 - s) > 1e-12 ? c0 / (1 - s) : mean(w)) : 0;
    }
  }
  const sseOf = (mu_: number, ph: number[], th: number[]) => sum(cssResid(w, mu_, ph, th).slice(p).map((v) => v * v));
  if (q === 0) {
    const e = cssResid(w, mu, phi, []);
    return { mu, phi, theta: [], sse: sseOf(mu, phi, []), resid: e, m: w.length - p };
  }
  const pack = (x: number[]) => ({ mu: withMean ? x[0]! : 0, ph: x.slice(withMean ? 1 : 0, (withMean ? 1 : 0) + p), th: x.slice((withMean ? 1 : 0) + p) });
  const obj = (x: number[]) => {
    const { mu: m_, ph, th } = pack(x);
    if (!invertible(th)) return 1e300;
    const s = sseOf(m_, ph, th);
    return Number.isFinite(s) ? s : 1e300;
  };
  let x0 = [...(withMean ? [mu] : []), ...phi, ...new Array<number>(q).fill(0)];
  let best = { x: x0, f: obj(x0) };
  for (let r = 0; r < 4; r++) {
    const res = nelderMead(obj, best.x, { step: best.x.map((v) => (Math.abs(v) > 1e-3 ? 0.1 * Math.abs(v) : 0.1)), tol: 1e-14 });
    if (res.f < best.f - 1e-15 * Math.abs(best.f)) best = res;
    else break;
    x0 = best.x;
  }
  const { mu: mu2, ph, th } = pack(best.x);
  return { mu: mu2, phi: ph, theta: th, sse: best.f, resid: cssResid(w, mu2, ph, th), m: w.length - p };
}

function forecastArma(w: number[], fit: ArmaFit, h: number): number[] {
  const hist = w.slice();
  const e = fit.resid.slice();
  const out: number[] = [];
  for (let k = 0; k < h; k++) {
    const t = hist.length;
    let v = fit.mu;
    fit.phi.forEach((p, i) => (v += p * (hist[t - 1 - i]! - fit.mu)));
    fit.theta.forEach((th, j) => (v += th * (e[t - 1 - j] ?? 0)));
    hist.push(v);
    e.push(0);
    out.push(v);
  }
  return out;
}

/** Undo d differences: lastLevels[i] is the last value of the i-times differenced series. */
function integrate(fw: number[], levels: number[][]): number[] {
  let cur = fw;
  for (let i = levels.length - 1; i >= 0; i--) {
    let last = levels[i]![levels[i]!.length - 1]!;
    cur = cur.map((v) => (last = last + v));
  }
  return cur;
}

const ARIMA = /\barima\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)|\barma\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)|\bar\s*\(\s*(\d+)\s*\)|\bma\s*\(\s*(\d+)\s*\)|\bar(\d)\b|\bma(\d)\b|\bautoregressive (?:model )?(?:of )?order (\d+)\b/;

export const arimaHandler: PHandler = (c) => {
  if (/\bgarch\b|\bvar\s*\(|\bvector autoreg/.test(c.s)) return null;
  const m = ARIMA.exec(c.s);
  if (!m) return null;
  let p = 0;
  let d = 0;
  let q = 0;
  if (m[1] !== undefined) [p, d, q] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if (m[4] !== undefined) [p, q] = [Number(m[4]), Number(m[5])];
  else if (m[6] !== undefined || m[8] !== undefined || m[10] !== undefined) p = Number(m[6] ?? m[8] ?? m[10]);
  else q = Number(m[7] ?? m[9]);
  if (p > 8 || q > 4 || d > 2) bad('Supported orders: p ≤ 8, d ≤ 2, q ≤ 4');
  wipe(c, new RegExp(ARIMA.source));
  const h = /\bforecast|\bpredict|\bahead\b/.test(c.s) ? horizon(c) : 1;
  const yw = /\byule[- ]?walker\b/.test(c.s);
  wipe(c, /\byule[- ]?walker\b/);
  const x = series(c, 3);
  const need = d + 2 * (p + q) + 3;
  if (x.length < need) bad(`ARIMA(${p},${d},${q}) needs at least ${need} observations here (got ${x.length})`);
  const levels: number[][] = [x];
  let w = x;
  for (let i = 0; i < d; i++) {
    w = diff(w);
    levels.push(w);
  }
  levels.pop();
  const withMean = d === 0;
  const name = q === 0 && d === 0 ? `AR(${p})` : p === 0 && d === 0 ? `MA(${q})` : d === 0 ? `ARMA(${p},${q})` : `ARIMA(${p},${d},${q})`;
  const lines: Line[] = [];
  const notes: string[] = [];
  let table: ReturnType<typeof coefTable> | undefined;
  let fit: ArmaFit;
  let method: string;
  if (yw && q === 0 && d === 0) {
    const r = [1, ...acf(x, p)];
    const R = Array.from({ length: p }, (_v, i) => Array.from({ length: p }, (_w, j) => r[Math.abs(i - j)]!));
    const phi = solve(R, r.slice(1)) ?? bad('The Yule–Walker equations are singular for this series');
    const mu = mean(x);
    const c0 = sum(x.map((v) => (v - mu) ** 2)) / x.length;
    const s2 = c0 * (1 - phi.reduce((s, v, i) => s + v * r[i + 1]!, 0));
    fit = { mu, phi, theta: [], sse: NaN, resid: cssResid(x, mu, phi, []), m: x.length - p };
    method = 'Yule–Walker (method of moments on the sample autocorrelations)';
    phi.forEach((v, i) => lines.push({ label: `φ${i + 1}`, display: g7(v) }));
    lines.push({ label: 'Mean', display: g7(mu) }, { label: 'σ²', display: g7(s2) });
  } else {
    fit = fitArma(w, p, q, withMean);
    method = q === 0 ? 'conditional least squares (OLS on lagged values)' : 'conditional sum of squares (Nelder–Mead), pre-sample errors set to 0';
    fit.phi.forEach((v, i) => lines.push({ label: `φ${i + 1}`, display: g7(v) }));
    fit.theta.forEach((v, i) => lines.push({ label: `θ${i + 1}`, display: g7(v) }));
    if (withMean) {
      lines.push({ label: 'Mean', display: g7(fit.mu) });
      lines.push({ label: 'Intercept', display: g7(fit.mu * (1 - sum(fit.phi))) });
    }
    const k = p + q + (withMean ? 1 : 0);
    lines.push({ label: 'SSE', display: g7(fit.sse) }, { label: 'σ²', display: g7(fit.sse / Math.max(1, fit.m - k)) });
    if (q === 0 && p > 0) {
      const rows: number[][] = [];
      const ys: number[] = [];
      for (let t = p; t < w.length; t++) {
        rows.push([...(withMean ? [1] : []), ...Array.from({ length: p }, (_v, i) => w[t - 1 - i]!)]);
        ys.push(w[t]!);
      }
      const o = ols(rows, ys, [...(withMean ? ['Intercept'] : []), ...Array.from({ length: p }, (_v, i) => `φ${i + 1}`)], withMean);
      if (o.df > 0) table = coefTable(o);
    }
  }
  const fw = forecastArma(w, fit, h);
  const fc = d ? integrate(fw, levels) : fw;
  fc.forEach((v, i) => lines.push({ label: `Forecast ${i + 1}`, display: g7(v) }));
  if (fit.theta.some((t) => Math.abs(t) > 0.98)) notes.push('An MA coefficient sits at the invertibility boundary (|θ| ≈ 1): the series may be over-differenced, and the CSS fit is unreliable');
  if (p >= 1 && sum(fit.phi.map(Math.abs)) >= 1 && p === 1) notes.push('|φ₁| ≥ 1: the fitted AR part is not stationary; consider differencing (d = 1)');
  if (d === 0 && x.length >= 10) {
    const ad = adfStat(x, 0, 'c');
    if (ad && ad.stat > mackinnon('c', 1, ad.T)[1]) notes.push('An ADF test does not reject a unit root at 5%: the series may need differencing');
  }
  if (x.length < 30) notes.push(`Only ${x.length} observations: estimates and forecasts are rough`);
  const wantForecast = /\bforecast|\bpredict|\bahead\b/.test(c.s);
  return answer(c, {
    expression: `${name} fitted by ${method} · n = ${x.length}${d ? `, differenced ${d}×` : ''}`,
    value: wantForecast ? fc[0]! : fit.phi.length ? fit.phi[0]! : fit.theta.length ? fit.theta[0]! : fc[0]!,
    display: wantForecast ? `forecast ${g6(fc[0]!)}` : lines.filter((l) => /^[φθ]/.test(l.label)).map((l) => `${l.label} = ${l.display}`).join(', ') || `forecast ${g6(fc[0]!)}`,
    lines,
    notes: [...notes, d ? 'No constant after differencing (as R’s arima)' : 'Mean estimated with the coefficients'],
    ...(table ? { table } : {}),
  });
};

// ---------- smoothing ----------
function sesRun(x: number[], a: number): { level: number; sse: number } {
  let l = x[0]!;
  let sse = 0;
  for (let t = 1; t < x.length; t++) {
    sse += (x[t]! - l) ** 2;
    l = a * x[t]! + (1 - a) * l;
  }
  return { level: l, sse };
}

function holtRun(x: number[], a: number, b: number): { l: number; tr: number; sse: number } {
  let l = x[0]!;
  let tr = x[1]! - x[0]!;
  let sse = 0;
  for (let t = 1; t < x.length; t++) {
    sse += (x[t]! - (l + tr)) ** 2;
    const ln = a * x[t]! + (1 - a) * (l + tr);
    tr = b * (ln - l) + (1 - b) * tr;
    l = ln;
  }
  return { l, tr, sse };
}

function hwRun(x: number[], m: number, a: number, b: number, g: number): { l: number; tr: number; s: number[]; sse: number } {
  let l = sum(x.slice(0, m)) / m;
  let tr = (sum(x.slice(m, 2 * m)) / m - l) / m;
  const s = x.slice(0, m).map((v) => v - l);
  let sse = 0;
  for (let t = m; t < x.length; t++) {
    const st = s[t - m]!;
    sse += (x[t]! - (l + tr + st)) ** 2;
    const ln = a * (x[t]! - st) + (1 - a) * (l + tr);
    tr = b * (ln - l) + (1 - b) * tr;
    s.push(g * (x[t]! - ln) + (1 - g) * st);
    l = ln;
  }
  return { l, tr, s, sse };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function optimise(obj: (p: number[]) => number, k: number): number[] {
  // Coarse grid start, then Nelder–Mead inside [0, 1]^k.
  let best: number[] = new Array<number>(k).fill(0.5);
  let bestF = obj(best);
  const grid = [0.1, 0.3, 0.5, 0.7, 0.9];
  const rec = (i: number, cur: number[]) => {
    if (i === k) {
      const v = obj(cur);
      if (v < bestF) [best, bestF] = [cur.slice(), v];
      return;
    }
    for (const gv of grid) rec(i + 1, [...cur, gv]);
  };
  rec(0, []);
  const res = nelderMead((p) => (p.some((v) => v < 0 || v > 1) ? 1e300 : obj(p)), best, { step: new Array<number>(k).fill(0.05), tol: 1e-14 });
  return res.f < bestF ? res.x.map(clamp01) : best;
}

export const smoothingHandler: PHandler = (c) => {
  const hw = /\bholt[- ]?winters?\b|\btriple exponential\b/.test(c.s);
  const holt = !hw && /\bholt\b|\bdouble exponential\b/.test(c.s);
  const ses = !hw && !holt && /\bexponential smoothing\b|\bexponentially smoothed\b|\bses\b/.test(c.s);
  if (!hw && !holt && !ses) return null;
  const h = horizon(c);
  const m = hw ? takeNum(c, 'season(?:al)?(?: length| period)?|period|m|frequency') : null;
  const a0 = takeNum(c, 'alpha|α|smoothing (?:constant|factor|parameter)');
  const b0 = takeNum(c, 'beta|β');
  const g0 = takeNum(c, 'gamma|γ');
  wipe(c, /\bholt[- ]?winters?\b|\badditive\b|\btriple exponential smoothing\b|\bdouble exponential smoothing\b|\bsimple exponential smoothing\b|\bexponential smoothing\b/);
  for (const v of [a0, b0, g0]) if (v !== null && !(v >= 0 && v <= 1)) bad('Smoothing parameters must be between 0 and 1');
  const lines: Line[] = [];
  const notes: string[] = [];
  if (ses) {
    const x = series(c, 2);
    let a = a0;
    if (a === null) {
      a = optimise((p) => sesRun(x, p[0]!).sse, 1)[0]!;
      notes.push('α chosen to minimise the one-step-ahead squared errors');
    }
    const r = sesRun(x, a);
    lines.push({ label: 'α', display: g7(a) }, { label: 'Level', display: g7(r.level) }, { label: 'Forecast', display: g7(r.level) }, { label: 'SSE', display: g7(r.sse) });
    notes.push('Simple exponential smoothing ℓₜ = αyₜ + (1 − α)ℓₜ₋₁ with ℓ₁ = y₁; every future forecast equals the last level');
    return answer(c, { expression: `Simple exponential smoothing · ${x.length} values`, value: r.level, display: `forecast ${g6(r.level)}`, lines, notes });
  }
  if (holt) {
    const x = series(c, 3);
    let a = a0;
    let b = b0;
    if (a === null || b === null) {
      const o = optimise((p) => holtRun(x, a ?? p[0]!, b ?? p[a === null ? 1 : 0]!).sse, (a === null ? 1 : 0) + (b === null ? 1 : 0));
      if (a === null) a = o[0]!;
      if (b === null) b = o[a0 === null ? 1 : 0]!;
      notes.push('Unstated smoothing parameters chosen to minimise one-step-ahead squared errors');
    }
    const r = holtRun(x, a, b);
    for (let k = 1; k <= h; k++) lines.push({ label: `Forecast ${k}`, display: g7(r.l + k * r.tr) });
    lines.push({ label: 'Level', display: g7(r.l) }, { label: 'Trend', display: g7(r.tr) }, { label: 'α', display: g7(a) }, { label: 'β', display: g7(b) }, { label: 'SSE', display: g7(r.sse) });
    notes.push("Holt's linear method; ℓ₁ = y₁, b₁ = y₂ − y₁; forecast ℓ + h·b");
    return answer(c, { expression: `Holt linear trend smoothing · ${x.length} values`, value: r.l + r.tr, display: `forecast ${g6(r.l + r.tr)}`, lines, notes });
  }
  if (m === null) return needErr(c, 'What is the season length? e.g. "holt winters season 4 of …"');
  if (!(Number.isInteger(m) && m >= 2)) bad('The season length must be a whole number ≥ 2');
  const x = series(c, 2 * m, 'values (two full seasons)');
  const fixed = [a0, b0, g0];
  const free = fixed.filter((v) => v === null).length;
  let par = fixed as (number | null)[];
  if (free) {
    const o = optimise((p) => {
      let i = 0;
      const q = fixed.map((v) => v ?? p[i++]!);
      return hwRun(x, m, q[0]!, q[1]!, q[2]!).sse;
    }, free);
    let i = 0;
    par = fixed.map((v) => v ?? o[i++]!);
    notes.push('Unstated smoothing parameters chosen to minimise one-step-ahead squared errors');
  }
  const [a, b, g] = par as [number, number, number];
  const r = hwRun(x, m, a, b, g);
  const n = x.length;
  for (let k = 1; k <= h; k++) lines.push({ label: `Forecast ${k}`, display: g7(r.l + k * r.tr + r.s[n - m + ((k - 1) % m)]!) });
  lines.push({ label: 'Level', display: g7(r.l) }, { label: 'Trend', display: g7(r.tr) }, { label: 'α', display: g7(a) }, { label: 'β', display: g7(b) }, { label: 'γ', display: g7(g) }, { label: 'SSE', display: g7(r.sse) });
  notes.push('Additive Holt–Winters; initial level = mean of season 1, trend = (mean of season 2 − mean of season 1)/m, seasonals = season-1 deviations');
  const f1 = r.l + r.tr + r.s[n - m]!;
  return answer(c, { expression: `Holt–Winters additive smoothing · season ${m} · ${n} values`, value: f1, display: `forecast ${g6(f1)}`, lines, notes });
};

export const movingAverageHandler: PHandler = (c) => {
  if (!/\bmoving average\b|\brolling (?:mean|average)\b|\bsma\b/.test(c.s) || /\bma\s*\(|\barima\b|\bmodel\b|\bprocess\b/.test(c.s)) return null;
  const wm = /(\d+)[- ](?:point|period|day|week|month|year|term|step)s?\b/.exec(c.rest);
  let k: number | null = null;
  if (wm) {
    k = Number(wm[1]);
    c.rest = c.rest.replace(wm[0], ' '.repeat(wm[0].length));
  } else k = takeNum(c, 'window(?: size)?|span|order|k|n|period|length');
  if (k === null) return needErr(c, 'How many values in each average? e.g. "3-point moving average of …"');
  if (!(Number.isInteger(k) && k >= 2)) bad('The window must be a whole number ≥ 2');
  const x = series(c, k);
  const ma: number[] = [];
  for (let t = k - 1; t < x.length; t++) ma.push(mean(x.slice(t - k + 1, t + 1)));
  const rows = x.map((v, t) => [String(t + 1), g7(v), t >= k - 1 ? g7(ma[t - k + 1]!) : '—']);
  const last = ma[ma.length - 1]!;
  return answer(c, {
    expression: `${k}-point trailing moving average of ${x.length} values`,
    value: last,
    display: `latest average ${g6(last)}`,
    lines: [{ label: 'Moving averages', display: ma.map((v) => g6(v)).join(', ') }, { label: 'Next-period forecast', display: g7(last) }],
    table: { columns: ['t', 'Value', 'Moving average'], rows },
    notes: ['Each average covers the current and previous values; as a naive forecast the next value is the latest average'],
  });
};

// ---------- unit roots ----------
type Variant = 'n' | 'c' | 'ct';
function adfStat(x: number[], lags: number, v: Variant): { stat: number; T: number } | null {
  const d = diff(x);
  const rows: number[][] = [];
  const ys: number[] = [];
  for (let t = lags + 1; t < x.length; t++) {
    const r: number[] = [];
    if (v !== 'n') r.push(1);
    if (v === 'ct') r.push(t + 1);
    r.push(x[t - 1]!);
    for (let j = 1; j <= lags; j++) r.push(d[t - 1 - j]!);
    rows.push(r);
    ys.push(d[t - 1]!);
  }
  if (ys.length <= rows[0]!.length + 1) return null;
  const o = ols(rows, ys, rows[0]!.map((_v, j) => String(j)), v !== 'n');
  const idx = v === 'n' ? 0 : v === 'c' ? 1 : 2;
  return { stat: o.t[idx]!, T: ys.length };
}

/** MacKinnon (2010) response-surface critical values [1%, 5%, 10%]; N = number of variables (1 = ADF, 2 = Engle–Granger). */
function mackinnon(v: Variant, N: 1 | 2, T: number): [number, number, number] {
  const tab: Record<string, number[][]> = {
    'n1': [[-2.56574, -2.2358, -3.627, 0], [-1.941, -0.2686, -3.365, 31.223], [-1.61682, 0.2656, -2.714, 25.364]],
    'c1': [[-3.43035, -6.5393, -16.786, -79.433], [-2.86154, -2.8903, -4.234, -40.04], [-2.56677, -1.5384, -2.809, 0]],
    'ct1': [[-3.95877, -9.0531, -28.428, -134.155], [-3.41049, -4.3904, -9.036, -45.374], [-3.12705, -2.5856, -3.925, -22.38]],
    'c2': [[-3.90001, -10.534, -30.03, 0], [-3.33613, -6.1101, -6.823, 0], [-3.04445, -4.2412, -2.72, 0]],
  };
  const rows = tab[`${v}${N}`]!;
  return rows.map(([a, b, cc, d]) => a! + b! / T + cc! / T ** 2 + d! / T ** 3) as [number, number, number];
}

/** MacKinnon (1994) approximate p-value for the constant-only ADF statistic. */
function adfPConst(tau: number): number {
  if (tau <= -18.83) return 0;
  if (tau >= 2.74) return 1;
  const z = tau <= -1.61 ? 2.1659 + 1.4412 * tau + 0.038269 * tau * tau : 1.7339 + 0.93202 * tau - 0.12745 * tau * tau - 0.010368 * tau ** 3;
  return zCdf(z);
}

function unitRootAnswer(c: PCtx, stat: number, T: number, lags: number, crit: [number, number, number], p: number | null, title: string, extra: Line[], notes: string[]): AnswerResult {
  const al = alphaOf(c);
  const level = al.a <= 0.01 ? 0 : al.a <= 0.05 ? 1 : 2;
  const cv = crit[level]!;
  const reject = p !== null ? p < al.a : stat < cv;
  const alphaShown = p !== null ? al.a : [0.01, 0.05, 0.1][level]!;
  const bracket = stat < crit[0] ? 'p < 0.01' : stat < crit[1] ? '0.01 < p < 0.05' : stat < crit[2] ? '0.05 < p < 0.10' : 'p > 0.10';
  const decision = `${reject ? 'Reject' : 'Fail to reject'} H₀ at α = ${f(alphaShown)}`;
  const lines: Line[] = [
    { label: 'ADF statistic', display: g7(stat) },
    { label: 'Lags', display: String(lags) },
    { label: 'Observations used', display: String(T) },
    { label: 'Critical value 1%', display: g6(crit[0]) },
    { label: 'Critical value 5%', display: g6(crit[1]) },
    { label: 'Critical value 10%', display: g6(crit[2]) },
    { label: 'p-value', display: p !== null ? `${g6(p)} (MacKinnon approximation)` : `${bracket} (from the critical values)` },
    { label: 'Decision', display: decision },
    ...extra,
  ];
  return answer(c, { expression: title, value: stat, display: `τ = ${g6(stat)}`, lines, notes: [...notes, ...(al.stated ? [] : ['α = 0.05 (say “alpha 0.01” to change)'])] });
}

export const adfHandler: PHandler = (c) => {
  if (!/\b(?:augmented )?dickey[- ]?fuller\b|\badf\b|\bunit root\b/.test(c.s) || /\bcointegrat|\bengle\b/.test(c.s)) return null;
  const v: Variant = /\btrend\b/.test(c.s) ? 'ct' : /\bno (?:constant|drift|intercept)\b|\bwithout (?:a )?(?:constant|drift|intercept)\b|\bnone\b/.test(c.s) ? 'n' : 'c';
  const L = takeNum(c, 'lags?|lag order|augmentation lags');
  takeNum(c, 'alpha|significance(?: level)?');
  wipe(c, /\b(?:augmented )?dickey[- ]?fuller\b|\badf\b|\bunit root\b/);
  const x = series(c, 8);
  const lags = L ?? Math.floor(Math.cbrt(x.length - 1));
  if (!(Number.isInteger(lags) && lags >= 0)) bad('The number of lags must be a whole number ≥ 0');
  const r = adfStat(x, lags, v);
  if (!r) bad(`Too few observations for ${lags} lags`);
  const crit = mackinnon(v, 1, r.T);
  const p = v === 'c' ? adfPConst(r.stat) : null;
  const vName = { n: 'no constant', c: 'constant', ct: 'constant and trend' }[v];
  const reject = p !== null ? p < alphaOf(c).a : r.stat < crit[1];
  return unitRootAnswer(c, r.stat, r.T, lags, crit, p, `Augmented Dickey–Fuller test (${vName}, ${lags} lag${lags === 1 ? '' : 's'}) · n = ${x.length}`,
    [{ label: 'Hypotheses', display: 'H₀: unit root (non-stationary) · H₁: stationary' }, { label: 'Conclusion', display: reject ? 'The series looks stationary (no unit root).' : 'Cannot rule out a unit root: treat the series as non-stationary (difference it).' }],
    [`Regression Δyₜ = ${v === 'n' ? '' : v === 'c' ? 'α + ' : 'α + βt + '}γyₜ₋₁ + Σδᵢ Δyₜ₋ᵢ; statistic = γ̂/SE(γ̂)`, 'Critical values: MacKinnon (2010) response surfaces', ...(L === null ? [`Lags = ⌊(n − 1)^(1/3)⌋ = ${lags} (say “lags 2” to change)`] : [])]);
};

/** Two or more labelled series ("x: … y: …"), or two lists separated by ";" / "vs". */
function seriesPair(c: PCtx): Column[] {
  const lab = namedLists(c.s);
  if (lab.length >= 2) return lab;
  const parts = c.rest.split(/\s*[;|]\s*|\s+(?:vs\.?|versus|and)\s+/).map((p) => nums(p)).filter((xs) => xs.length >= 3);
  return parts.map((xs, i) => ({ name: `series ${i + 1}`, xs }));
}

export const cointegrationHandler: PHandler = (c) => {
  if (!/\bcointegrat\w*|\bengle[- ]granger\b/.test(c.s)) return null;
  const L = takeNum(c, 'lags?');
  const cols = seriesPair(c);
  if (cols.length < 2) return needErr(c, 'Give the two series, e.g. "cointegration test x: … y: …"');
  const [a, b] = cols as [Column, Column];
  if (a.xs.length !== b.xs.length) bad(`The series have ${a.xs.length} and ${b.xs.length} values`);
  const yv = cols.find((k) => k.name === 'y') ?? b;
  const xv = yv === b ? a : b;
  const n = xv.xs.length;
  if (n < 10) bad('Cointegration testing needs at least 10 observations per series');
  const o = ols(xv.xs.map((v) => [1, v]), yv.xs, ['(Intercept)', xv.name]);
  const lags = L ?? Math.floor(Math.cbrt(n - 1));
  const r = adfStat(o.e, lags, 'n') ?? bad(`Too few observations for ${lags} lags`);
  const crit = mackinnon('c', 2, r.T);
  const reject = r.stat < crit[alphaOf(c).a <= 0.01 ? 0 : alphaOf(c).a <= 0.05 ? 1 : 2];
  return unitRootAnswer(c, r.stat, r.T, lags, crit, null, `Engle–Granger cointegration test · ${yv.name} on ${xv.name} · n = ${n}`,
    [
      { label: 'Cointegrating slope', display: g7(o.b[1]!) },
      { label: 'Cointegrating intercept', display: g7(o.b[0]!) },
      { label: 'Hypotheses', display: 'H₀: no cointegration (residuals have a unit root) · H₁: cointegrated' },
      { label: 'Conclusion', display: reject ? `${yv.name} and ${xv.name} look cointegrated: a stable long-run relationship.` : `No evidence of cointegration between ${yv.name} and ${xv.name}.` },
    ],
    ['Step 1: OLS of y on x; step 2: ADF (no constant) on the residuals', 'Critical values: MacKinnon (2010), 2 variables with constant (stricter than plain ADF values)', ...(L === null ? [`Lags = ${lags}`] : [])]);
};

export const grangerHandler: PHandler = (c) => {
  if (!/\bgranger\b/.test(c.s) || /\bcointegrat|\bengle\b/.test(c.s)) return null;
  const p = takeNum(c, 'lags?|lag order|order|p') ?? 1;
  if (!(Number.isInteger(p) && p >= 1 && p <= 12)) bad('The lag must be a whole number from 1 to 12');
  const cols = seriesPair(c);
  if (cols.length < 2) return needErr(c, 'Give both series, e.g. "granger causality x: … y: … lag 2"');
  const dir = /\bdoes\s+([a-z][a-z0-9_]*)\s+granger[- ]cause\s+([a-z][a-z0-9_]*)|\b([a-z][a-z0-9_]*)\s+granger[- ]causes?\s+([a-z][a-z0-9_]*)/.exec(c.s);
  const find = (nm?: string) => cols.find((k) => k.name === nm);
  let cause = find(dir?.[1] ?? dir?.[3]);
  let eff = find(dir?.[2] ?? dir?.[4]);
  if (!cause || !eff) {
    cause = find('x') ?? cols[0]!;
    eff = find('y') ?? cols.find((k) => k !== cause)!;
  }
  const x = cause.xs;
  const y = eff.xs;
  if (x.length !== y.length) bad(`The series have ${x.length} and ${y.length} values`);
  const T = y.length;
  if (T - p <= 2 * p + 2) bad(`${p} lag${p > 1 ? 's' : ''} need more observations (got ${T})`);
  const U: number[][] = [];
  const R: number[][] = [];
  const ys: number[] = [];
  for (let t = p; t < T; t++) {
    const yl = Array.from({ length: p }, (_v, j) => y[t - 1 - j]!);
    const xl = Array.from({ length: p }, (_v, j) => x[t - 1 - j]!);
    U.push([1, ...yl, ...xl]);
    R.push([1, ...yl]);
    ys.push(y[t]!);
  }
  const u = ols(U, ys, U[0]!.map((_v, j) => String(j)));
  const r = ols(R, ys, R[0]!.map((_v, j) => String(j)));
  const dfu = ys.length - (2 * p + 1);
  const F = ((r.sse - u.sse) / p) / (u.sse / dfu);
  const pv = fSf(F, p, dfu);
  return testAnswer(c, {
    test: `Granger causality F-test · does ${cause.name} help predict ${eff.name}? · ${p} lag${p > 1 ? 's' : ''}`,
    statName: 'F',
    stat: F,
    df: `${p}, ${dfu}`,
    p: pv,
    alpha: alphaOf(c),
    h0: `lags of ${cause.name} add nothing to predicting ${eff.name}`,
    h1: `${cause.name} Granger-causes ${eff.name}`,
    reject: `Past values of ${cause.name} improve predictions of ${eff.name} (Granger causality; not proof of true causation).`,
    retain: `No evidence that past ${cause.name} helps predict ${eff.name} beyond ${eff.name}'s own past.`,
    lines: [{ label: 'RSS restricted', display: g7(r.sse) }, { label: 'RSS unrestricted', display: g7(u.sse) }],
    assumptions: ['both series stationary', 'linear relationships', 'errors independent with constant variance'],
  });
};

export const varHandler: PHandler = (c) => {
  const m = /\bvar\s*\(\s*(\d+)\s*\)|\bvector autoregress\w*(?:\s+(?:of )?order\s+(\d+))?/.exec(c.s);
  if (!m) return null;
  const p = Number(m[1] ?? m[2] ?? 1);
  if (!(p >= 1 && p <= 6)) bad('VAR order must be from 1 to 6');
  const cols = namedLists(c.s);
  if (cols.length < 2) return needErr(c, 'Give at least two labelled series, e.g. "var(1) y1: … y2: …"');
  const n = cols[0]!.xs.length;
  if (cols.some((k) => k.xs.length !== n)) bad(`Every series needs the same length: ${cols.map((k) => `${k.name} has ${k.xs.length}`).join(', ')}`);
  const K = cols.length;
  if (n - p <= K * p + 2) bad(`A VAR(${p}) in ${K} variables needs more than ${K * p + p + 2} observations (got ${n})`);
  const X: number[][] = [];
  for (let t = p; t < n; t++) X.push([1, ...Array.from({ length: p }, (_v, l) => cols.map((k) => k.xs[t - 1 - l]!)).flat()]);
  const names = ['Constant', ...Array.from({ length: p }, (_v, l) => cols.map((k) => `${k.name} lag ${l + 1}`)).flat()];
  const fits = cols.map((k) => ols(X, k.xs.slice(p), names));
  const rows = cols.map((k, i) => [k.name, ...fits[i]!.b.map((v) => g7(v))]);
  const lastRow = [1, ...Array.from({ length: p }, (_v, l) => cols.map((k) => k.xs[n - 1 - l]!)).flat()];
  const fc = fits.map((o) => o.b.reduce((s, v, j) => s + v * lastRow[j]!, 0));
  const lines: Line[] = cols.map((k, i) => ({ label: `Forecast ${k.name}`, display: g7(fc[i]!) }));
  fits.forEach((o, i) => lines.push({ label: `R² ${cols[i]!.name}`, display: g7(o.r2) }));
  return answer(c, {
    expression: `VAR(${p}) by equation-wise OLS · ${K} series · n = ${n}`,
    value: fc[0]!,
    display: `next ${cols[0]!.name} ≈ ${g6(fc[0]!)}`,
    lines,
    table: { columns: ['Equation', ...names], rows },
    notes: ['Each equation regresses one series on a constant and the lags of every series', 'Assumes: stationary series, serially uncorrelated errors'],
  });
};

// ---------- GARCH(1,1) ----------
export const garchHandler: PHandler = (c) => {
  if (!/\bgarch\b/.test(c.s)) return null;
  const om = /\bgarch\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)|\bgarch\s+(\d+)\s*,?\s*(\d+)\b/.exec(c.s);
  if (om && (Number(om[1] ?? om[3]) !== 1 || Number(om[2] ?? om[4]) !== 1)) bad('Only GARCH(1,1) is supported');
  if (om) wipe(c, new RegExp(om[0].replace(/[()]/g, '\\$&')));
  wipe(c, /\bgarch\b/);
  const r = series(c, 2, 'returns');
  if (r.length < 20) bad(`GARCH(1,1) needs a longer return series: at least 20 observations (got ${r.length})`);
  const n = r.length;
  const mu = mean(r);
  const e = r.map((v) => v - mu);
  const v0 = sum(e.map((v) => v * v)) / n;
  if (!(v0 > 0)) bad('The returns have zero variance');
  const ll = (w: number, a: number, b: number) => {
    let h = v0;
    let s = 0;
    for (let t = 0; t < n; t++) {
      if (t) h = w + a * e[t - 1]! ** 2 + b * h;
      if (!(h > 0)) return -Infinity;
      s += -0.5 * (Math.log(2 * Math.PI) + Math.log(h) + e[t]! ** 2 / h);
    }
    return s;
  };
  // Unconstrained parameters: ω = e^u0, persistence = σ(u1), α share = σ(u2).
  const sig = (u: number) => 1 / (1 + Math.exp(-u));
  const logit = (q: number) => Math.log(q / (1 - q));
  const decode = (u: number[]) => {
    const s = sig(u[1]!);
    const sh = sig(u[2]!);
    return [Math.exp(u[0]!), s * sh, s * (1 - sh)] as const;
  };
  const obj = (u: number[]) => {
    const [w, a, b] = decode(u);
    const v = -ll(w, a, b);
    return Number.isFinite(v) ? v : 1e300;
  };
  const starts: [number, number, number][] = [[0.1 * v0, 0.1, 0.8], [0.05 * v0, 0.05, 0.9], [0.2 * v0, 0.15, 0.6], [0.5 * v0, 0.2, 0.3]];
  let best = { x: [0, 0, 0], f: Infinity };
  for (const [w, a, b] of starts) {
    const u0 = [Math.log(w), logit(a + b), logit(a / (a + b))];
    const f0 = obj(u0);
    let res = nelderMead(obj, u0, { step: [0.5, 0.5, 0.5], tol: 1e-13 });
    res = nelderMead(obj, res.x, { step: [0.1, 0.1, 0.1], tol: 1e-14 });
    const cand = res.f <= f0 ? res : { x: u0, f: f0 };
    if (cand.f < best.f) best = cand;
  }
  const [w, a, b] = decode(best.x);
  const L = -best.f;
  let h = v0;
  for (let t = 1; t < n; t++) h = w + a * e[t - 1]! ** 2 + b * h;
  const next = w + a * e[n - 1]! ** 2 + b * h;
  const pers = a + b;
  const lrv = w / (1 - pers);
  const notes = [
    'Gaussian maximum likelihood (Nelder–Mead from several starts); constant mean = sample mean; σ²₁ = sample variance',
    'σ²ₜ = ω + α·ε²ₜ₋₁ + β·σ²ₜ₋₁',
  ];
  if (a < 1e-4) notes.push('α ≈ 0: no detectable ARCH effect in these returns, so β (and the volatility dynamics) are not identified; a constant-variance model fits as well');
  if (pers > 0.995) notes.push('α + β is close to 1: volatility shocks are nearly permanent (IGARCH-like); the long-run variance is poorly determined');
  if (n < 250) notes.push(`Only ${n} returns: GARCH estimates are imprecise below a few hundred observations`);
  return answer(c, {
    expression: `GARCH(1,1) fitted to ${n} returns`,
    value: Math.sqrt(next),
    display: `next-period volatility ${g6(Math.sqrt(next))}`,
    lines: [
      { label: 'ω', display: g7(w) },
      { label: 'α', display: g7(a) },
      { label: 'β', display: g7(b) },
      { label: 'Persistence (α + β)', display: g7(pers) },
      { label: 'Long-run variance', display: g7(lrv) },
      { label: 'Long-run volatility', display: g7(Math.sqrt(lrv)) },
      { label: 'Next-period variance', display: g7(next) },
      { label: 'Next-period volatility', display: g7(Math.sqrt(next)) },
      { label: 'Half-life of shocks', display: pers > 0 && pers < 1 ? `${g6(Math.log(0.5) / Math.log(pers))} periods` : '—' },
      { label: 'Log-likelihood', display: g7(L) },
      { label: 'Mean', display: g7(mu) },
      { label: 'Observations', display: String(n) },
    ],
    notes,
  });
};
