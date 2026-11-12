/** Regression beyond the basic fits: multiple OLS with diagnostics, simple-regression inference, polynomial, logistic, nonlinear. */
import type { AnswerResult } from '@lemma/math-core';
import { readPairs } from '../paired';
import {
  breuschPagan, checkLengths, coefTable, dataColumns, durbinWatson, equationOf, fitLines, g6, g7, levenbergMarquardt, namedLists, ols, robustSE, roles, vifs, type OLS,
} from './models-core';
import { alphaOf, answer, bad, inv, mean, needErr, testAnswer, tSf, zSf, type Column, type Line, type PCtx, type PHandler } from './util';

const ROBUST = /\brobust (?:standard errors?|se'?s?|errors)\b|\bhc[0-3]\b|\bheteroscedasticity[- ]consistent\b|\bwhite (?:standard errors?|se)\b|\bsandwich\b/;

function robustKind(s: string): 'HC0' | 'HC1' | null {
  if (/\bhc0\b/.test(s)) return 'HC0';
  if (ROBUST.test(s)) return 'HC1';
  return null;
}

/** Full OLS report: coefficients table, fit statistics, diagnostics. */
function olsAnswer(c: PCtx, y: Column, xs: Column[], title: string): AnswerResult {
  checkLengths([y, ...xs]);
  const n = y.xs.length;
  const k = xs.length + 1;
  if (n <= k) bad(`${k} coefficients need more than ${k} observations to estimate the error variance (there are ${n})`);
  const X = y.xs.map((_v, i) => [1, ...xs.map((x) => x.xs[i]!)]);
  const o = ols(X, y.xs, ['(Intercept)', ...xs.map((x) => x.name)]);
  const s = c.s;
  const rk = robustKind(s);
  const rse = rk ? robustSE(o, rk) : null;
  const lines: Line[] = [{ label: 'Equation', display: equationOf(o, y.name) }, ...fitLines(o)];
  const notes: string[] = ['Ordinary least squares; t-tests use n − k degrees of freedom'];
  const dw = durbinWatson(o.e);
  lines.push({ label: 'Durbin–Watson', display: g7(dw) });
  if (xs.length >= 2) {
    const v = vifs(xs);
    xs.forEach((x, j) => lines.push({ label: `VIF ${x.name}`, display: g7(v[j]!) }));
    const worst = Math.max(...v);
    if (worst > 10) notes.push(`Multicollinearity warning: a VIF above 10 (max ${g6(worst)}) inflates the standard errors`);
    else if (worst > 5) notes.push(`Moderate multicollinearity (max VIF ${g6(worst)})`);
  }
  if (/breusch|pagan|heterosc|\bbp test\b/.test(s) || rk) {
    const bp = breuschPagan(o);
    lines.push({ label: 'Breusch–Pagan LM', display: g7(bp.lm) }, { label: 'Breusch–Pagan p-value', display: g6(bp.p) });
    notes.push(`Breusch–Pagan (Koenker studentised): n·R² of e² on the predictors, χ²(${bp.df}); ${bp.p < 0.05 ? 'evidence of heteroscedasticity at 5%' : 'no evidence of heteroscedasticity at 5%'}`);
  }
  if (rk) notes.push(`${rk} robust standard errors (${rk === 'HC1' ? 'HC0 × n/(n − k), as Stata’s “robust”' : 'White 1980'})`);
  if (o.r2 === 1) notes.push('Perfect fit: residuals are zero, so standard errors and tests are degenerate');
  else if (dw < 1 || dw > 3) notes.push(`Durbin–Watson ${g6(dw)} is far from 2: residuals look autocorrelated (only meaningful for ordered data)`);
  if (n < 10 * xs.length) notes.push(`Only ${n} observations for ${xs.length} predictor${xs.length > 1 ? 's' : ''}: estimates are imprecise`);
  notes.push('Assumes: linear model, independent errors with constant variance (normal errors for exact t/F tests)');
  return answer(c, {
    expression: `${title} · ${y.name} on ${xs.map((x) => x.name).join(', ')} · n = ${n}`,
    value: o.r2,
    display: `R² = ${g6(o.r2)}`,
    lines,
    notes,
    table: coefTable(o, rse ? { label: `Robust SE (${rk})`, se: rse } : undefined),
  });
}

const OLS_WORDS =
  /\bmultiple (?:linear )?regression\b|\bmultivariate regression\b|\bmultiple linear\b|\bregress\s+[a-z][a-z0-9_]*\s+on\b|\bols\b|\bvif\b|\bvariance inflation\b|\bdurbin\b|\bwatson\b|\bbreusch\b|\bpagan\b|\badjusted r\b|\bf[- ]statistic\b|\bregression significan|\bis the regression significant\b|\bsignificance of the regression\b/;

/** Multiple regression from a pasted table or labelled lists. */
export const multipleRegression: PHandler = (c) => {
  if (!(OLS_WORDS.test(c.s) || ROBUST.test(c.s))) return null;
  if (/\blogistic\b|\blogit\b|\bprobit\b|\bpolynomial\b|\bdegree\b|\bfixed effects?\b|\brandom effects?\b|\bpanel\b|\b2sls\b|\binstrument/.test(c.s)) return null;
  const cols = dataColumns(c);
  if (cols.length < 2) {
    // A single x/y pair list is a simple regression; let that handler (or the basic engine) take it.
    return /\bmultiple\b|\bregress\b|\bols\b/.test(c.s) ? needErr(c, 'Give the data as a table with a header row (y,x1,x2 …) or as labelled lists, e.g. "y: 3 7 7 11 x1: 1 2 3 4 x2: 2 1 4 3"') : null;
  }
  const { y, xs } = roles(c.raw.split('\n')[0]! + ' ' + c.s, cols);
  if (!xs.length) return needErr(c, 'Which predictors? e.g. "regress y on x1 x2"');
  if (/\bregression significan|\bis the regression significant\b|\bsignificance of the regression\b|\bf[- ]test\b/.test(c.s)) return overallF(c, y, xs);
  return olsAnswer(c, y, xs, xs.length > 1 ? 'Multiple linear regression (OLS)' : 'Linear regression (OLS)');
};

function overallF(c: PCtx, y: Column, xs: Column[]): AnswerResult {
  checkLengths([y, ...xs]);
  const X = y.xs.map((_v, i) => [1, ...xs.map((x) => x.xs[i]!)]);
  const o = ols(X, y.xs, ['(Intercept)', ...xs.map((x) => x.name)]);
  return testAnswer(c, {
    test: `Overall F-test of the regression · ${y.name} on ${xs.map((x) => x.name).join(', ')}`,
    statName: 'F',
    stat: o.F,
    df: `${xs.length}, ${o.df}`,
    p: o.Fp,
    alpha: alphaOf(c),
    h0: 'all slope coefficients are 0',
    h1: 'at least one slope is not 0',
    reject: `The predictors jointly explain a significant share of the variation in ${y.name} (R² = ${g6(o.r2)}).`,
    retain: `No evidence that the predictors jointly explain ${y.name} (R² = ${g6(o.r2)}).`,
    lines: [{ label: 'R²', display: g7(o.r2) }],
    table: coefTable(o),
    assumptions: ['linear model', 'independent, normally distributed errors with constant variance'],
  });
}

// ---------- simple regression inference ----------
const INFER = /\b(?:test (?:the |for (?:the )?)?slope|slope (?:t[- ]?)?test|significance of the slope|is the slope significant|confidence interval (?:for|of) the slope|slope (?:confidence interval|ci)|ci for the slope|standard errors?|residuals?|residual plot|adjusted r(?:[- ]?squared|²|2)?)\b/;

export const simpleInference: PHandler = (c) => {
  if (!INFER.test(c.s)) return null;
  if (!/\bregression\b|\bslope\b|\bresiduals?\b|\bline\b|\bfit\b|\badjusted r\b/.test(c.s)) return null;
  if (c.raw.includes('\n') || /\b(?:x2|x3)\s*[:=]/.test(c.s)) return null;
  const pairs = readPairs(c);
  if (!pairs || pairs.xs.length < 2) return null;
  const { xs, ys } = pairs;
  if (xs.length !== ys.length) bad(`There are ${xs.length} x values but ${ys.length} y values`);
  const n = xs.length;
  if (n < 3) bad('Regression inference needs at least 3 points');
  const o = ols(xs.map((x) => [1, x]), ys, ['(Intercept)', 'x']);
  if (/\bresiduals?\b|\bresidual plot\b/.test(c.s) && !/\bstandard errors?\b/.test(c.s)) {
    const rows = xs.map((x, i) => [String(i + 1), g7(x), g7(ys[i]!), g7(o.fit[i]!), g7(o.e[i]!)]);
    const big = o.e.map((e, i) => [Math.abs(e) / o.sigma, i] as const).filter(([z]) => z > 2);
    return answer(c, {
      expression: `Residuals of the least-squares line ŷ = ${g6(o.b[0]!)} + ${g6(o.b[1]!)}x`,
      value: o.sse,
      display: `SSE = ${g6(o.sse)}`,
      lines: [{ label: 'SSE', display: g7(o.sse) }, { label: 'Residual standard error', display: g7(o.sigma) }, { label: 'Durbin–Watson', display: g7(durbinWatson(o.e)) }, { label: 'R²', display: g7(o.r2) }],
      table: { columns: ['Obs', 'x', 'y', 'Fitted', 'Residual'], rows },
      notes: [
        'Residual = observed − fitted; they sum to 0 for least squares with an intercept',
        ...(big.length ? [`Large standardised residuals (|e|/s > 2) at observation${big.length > 1 ? 's' : ''} ${big.map(([, i]) => i + 1).join(', ')}`] : []),
      ],
    });
  }
  const df = n - 2;
  const tcrit = tInvLocal(0.975, df);
  const lines: Line[] = [
    { label: 'Equation', display: `y = ${g6(o.b[0]!)} + ${g6(o.b[1]!)}x` },
    { label: 'Slope CI lower', display: g7(o.b[1]! - tcrit * o.se[1]!) },
    { label: 'Slope CI upper', display: g7(o.b[1]! + tcrit * o.se[1]!) },
    ...fitLines(o),
  ];
  if (/\btest\b|\bsignifican/.test(c.s) && !/\bconfidence interval\b/.test(c.s)) {
    return testAnswer(c, {
      test: `t-test for the slope of y on x · n = ${n}`,
      statName: 't',
      stat: o.t[1]!,
      df,
      p: o.p[1]!,
      alpha: alphaOf(c),
      h0: 'slope β₁ = 0',
      h1: 'β₁ ≠ 0',
      reject: `y changes significantly with x (slope ${g6(o.b[1]!)} per unit of x).`,
      retain: `No significant linear relationship between x and y (slope ${g6(o.b[1]!)}).`,
      lines,
      table: coefTable(o),
      assumptions: ['linear relationship', 'independent errors with constant variance', 'normally distributed errors'],
    });
  }
  return answer(c, {
    expression: `Simple linear regression inference · y on x · n = ${n}`,
    value: o.b[1]!,
    display: `slope = ${g6(o.b[1]!)}`,
    lines,
    table: coefTable(o),
    notes: [`95% slope CI uses t(0.975, ${df}) = ${g6(tcrit)}`, 'Assumes: linear relationship, independent normal errors with constant variance'],
  });
};

function tInvLocal(p: number, df: number): number {
  let lo = 0;
  let hi = 1;
  while (1 - tSf(hi, df) < p) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const m = (lo + hi) / 2;
    if (1 - tSf(m, df) < p) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

// ---------- polynomial ----------
const SUP = ['', '', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
export const polynomial: PHandler = (c) => {
  const dm = /\bdegree[- ]?(\d+)\b|\b(\d+)(?:st|nd|rd|th)?[- ](?:degree|order) polynomial\b|\bpolynomial (?:of )?(?:degree|order)\s*(\d+)\b|\border[- ]?(\d+) polynomial\b/.exec(c.s);
  if (!dm || !/\bpolynomial\b|\bdegree \d+ (?:fit|regression)\b/.test(c.s)) return null;
  const d = Number(dm[1] ?? dm[2] ?? dm[3] ?? dm[4]);
  if (!(d >= 1 && d <= 12)) bad('Polynomial degree must be between 1 and 12');
  c.rest = c.rest.replace(dm[0], ' ');
  const pairs = readPairs(c);
  if (!pairs || pairs.xs.length < 1) return needErr(c, 'Give the points, e.g. "(1, 2) (2, 5) …" or "x: 1 2 3 4 5 y: …"');
  const { xs, ys } = pairs;
  if (xs.length !== ys.length) bad(`There are ${xs.length} x values but ${ys.length} y values`);
  const k = d + 1;
  if (xs.length < k) bad(`A degree-${d} polynomial has ${k} coefficients, so it needs at least ${k} points (got ${xs.length})`);
  const names = ['(Intercept)', 'x', ...Array.from({ length: d - 1 }, (_v, i) => `x^${i + 2}`)];
  const o = ols(xs.map((x) => Array.from({ length: k }, (_v, j) => x ** j)), ys, names);
  let eq = `y = ${g6(o.b[0]!)}`;
  for (let j = 1; j < k; j++) {
    const v = o.b[j]!;
    if (Math.abs(v) < 1e-12 * Math.max(1, ...o.b.map(Math.abs))) continue;
    eq += ` ${v < 0 ? '−' : '+'} ${g6(Math.abs(v))}x${j > 1 ? (SUP[j] ?? `^${j}`) : ''}`;
  }
  const notes = ['Least squares on 1, x, x², … (QR factorisation)'];
  if (xs.length === k) notes.push('As many points as coefficients: the polynomial interpolates the data, so there is no error estimate');
  else if (xs.length < 2 * k) notes.push('Few points per coefficient: high-degree polynomials overfit and extrapolate badly');
  return answer(c, {
    expression: `Degree-${d} polynomial regression · n = ${xs.length}`,
    value: o.r2,
    display: eq,
    lines: [{ label: 'Equation', display: eq }, ...fitLines(o)],
    table: coefTable(o),
    notes,
  });
};

// ---------- logistic regression ----------
export const logistic: PHandler = (c) => {
  if (!/\blogistic regression\b|\blogit\b|\blogistic model\b(?! growth)/.test(c.s)) return null;
  let cols = dataColumns(c);
  if (cols.length < 2) {
    const pairs = readPairs(c);
    if (pairs) cols = [{ name: 'x', xs: pairs.xs }, { name: 'y', xs: pairs.ys }];
  }
  if (cols.length < 2) return needErr(c, 'Give the data, e.g. "logistic regression x: 1 2 3 4 5 6 y: 0 0 1 0 1 1" or a table with a 0/1 response');
  const { y, xs } = roles(c.raw.split('\n')[0]! + ' ' + c.s, cols);
  checkLengths([y, ...xs]);
  if (!y.xs.every((v) => v === 0 || v === 1)) bad(`The response ${y.name} must be 0 or 1 for logistic regression (binary outcome)`);
  const n = y.xs.length;
  const k = xs.length + 1;
  if (n <= k) bad(`${k} coefficients need more than ${k} observations`);
  const ones = y.xs.filter((v) => v === 1).length;
  if (ones === 0 || ones === n) bad(`All responses are ${ones ? 1 : 0}: the model can't be estimated`);
  const X = y.xs.map((_v, i) => [1, ...xs.map((x) => x.xs[i]!)]);
  let b = new Array<number>(k).fill(0);
  let ll = -Infinity;
  let iters = 0;
  let separated = false;
  let H: number[][] | null = null;
  for (; iters < 100; iters++) {
    const eta = X.map((r) => r.reduce((s, v, j) => s + v * b[j]!, 0));
    const p = eta.map((e) => 1 / (1 + Math.exp(-e)));
    const w = p.map((q) => q * (1 - q));
    const g = b.map((_v, j) => X.reduce((s, r, i) => s + r[j]! * (y.xs[i]! - p[i]!), 0));
    const M = b.map((_v, a) => b.map((_w, cc) => X.reduce((s, r, i) => s + r[a]! * r[cc]! * w[i]!, 0)));
    H = inv(M);
    const llNew = y.xs.reduce<number>((s, v, i) => s + (v ? logSig(eta[i]!) : logSig(-eta[i]!)), 0);
    if (!H) {
      separated = true;
      break;
    }
    const step = H.map((r) => r.reduce((s, v, j) => s + v * g[j]!, 0));
    b = b.map((v, j) => v + step[j]!);
    if (Math.max(...b.map(Math.abs)) > 30 || (llNew > -1e-7 && iters > 5)) {
      separated = true;
      break;
    }
    if (Math.max(...step.map(Math.abs)) < 1e-11 && Math.abs(llNew - ll) < 1e-12) {
      ll = llNew;
      break;
    }
    ll = llNew;
  }
  if (separated)
    bad('Complete or quasi-complete separation: a combination of the predictors perfectly separates the 0s from the 1s, so the maximum-likelihood estimates do not exist (they diverge to ±∞). Consider penalised (Firth) logistic regression or exact methods.');
  const eta = X.map((r) => r.reduce((s, v, j) => s + v * b[j]!, 0));
  ll = y.xs.reduce<number>((s, v, i) => s + (v ? logSig(eta[i]!) : logSig(-eta[i]!)), 0);
  const pbar = ones / n;
  const ll0 = ones * Math.log(pbar) + (n - ones) * Math.log(1 - pbar);
  const se = H!.map((r, j) => Math.sqrt(r[j]!));
  const names = ['(Intercept)', ...xs.map((x) => x.name)];
  const rows = names.map((nm, j) => {
    const z = b[j]! / se[j]!;
    return [nm, g7(b[j]!), g7(se[j]!), g6(z), g6(2 * zSf(Math.abs(z))), g7(Math.exp(b[j]!))];
  });
  const mcf = 1 - ll / ll0;
  const lr = 2 * (ll - ll0);
  const eq = `logit(p) = ${g6(b[0]!)}${xs.map((x, j) => ` ${b[j + 1]! < 0 ? '−' : '+'} ${g6(Math.abs(b[j + 1]!))}·${x.name}`).join('')}`;
  const notes = ['Maximum likelihood by iteratively reweighted least squares (Newton–Raphson); Wald z-tests', 'Odds ratio = e^coefficient: the multiplicative change in the odds per unit increase'];
  if (Math.min(ones, n - ones) < 10 * xs.length) notes.push(`Only ${Math.min(ones, n - ones)} events in the smaller outcome class: estimates and Wald tests are unreliable (rule of thumb: ≥ 10 per predictor)`);
  return answer(c, {
    expression: `Logistic regression (IRLS) · ${y.name} on ${xs.map((x) => x.name).join(', ')} · n = ${n}`,
    value: b[1]!,
    display: eq,
    lines: [
      { label: 'Equation', display: eq },
      { label: 'Log-likelihood', display: g7(ll) },
      { label: 'Null log-likelihood', display: g7(ll0) },
      { label: 'McFadden pseudo-R²', display: g7(mcf) },
      { label: 'Likelihood-ratio χ²', display: `${g7(lr)} on ${xs.length} df` },
      { label: 'AIC', display: g7(2 * k - 2 * ll) },
      { label: 'Iterations', display: String(iters + 1) },
    ],
    table: { columns: ['Term', 'Estimate', 'Std. error', 'z', 'p-value', 'Odds ratio'], rows },
    notes,
  });
};

const logSig = (x: number) => (x >= 0 ? -Math.log1p(Math.exp(-x)) : x - Math.log1p(Math.exp(x)));

// ---------- nonlinear least squares ----------
interface NLModel {
  name: string;
  params: string[];
  f: (x: number, p: number[]) => number;
  start: (xs: number[], ys: number[]) => number[];
  formula: string;
}

function linFit(xs: number[], ys: number[]): [number, number] {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  xs.forEach((x, i) => {
    sxy += (x - mx) * (ys[i]! - my);
    sxx += (x - mx) ** 2;
  });
  const b = sxx ? sxy / sxx : 0;
  return [my - b * mx, b];
}

const MODELS: [RegExp, NLModel][] = [
  [
    /\bmichaelis|\bmenten\b/,
    {
      name: 'Michaelis–Menten',
      params: ['Vmax', 'Km'],
      formula: 'y = Vmax·x/(Km + x)',
      f: (x, p) => (p[0]! * x) / (p[1]! + x),
      start: (xs, ys) => {
        const ok = xs.map((x, i) => [x, ys[i]!] as const).filter(([x, y]) => x > 0 && y > 0);
        const [a, b] = linFit(ok.map(([x]) => 1 / x), ok.map(([, y]) => 1 / y));
        const V = a > 0 ? 1 / a : Math.max(...ys) * 1.2;
        return [V, a > 0 ? b / a : mean(xs)];
      },
    },
  ],
  [
    /\blogistic (?:growth|curve)\b|\bsigmoidal growth\b/,
    {
      name: 'Logistic growth',
      params: ['K', 'r', 'x0'],
      formula: 'y = K/(1 + e^(−r(x − x0)))',
      f: (x, p) => p[0]! / (1 + Math.exp(-p[1]! * (x - p[2]!))),
      start: (xs, ys) => {
        const K = Math.max(...ys) * 1.1;
        const ok = xs.map((x, i) => [x, ys[i]!] as const).filter(([, y]) => y > 0 && y < K);
        const [a, b] = linFit(ok.map(([x]) => x), ok.map(([, y]) => Math.log(y / (K - y))));
        return [K, b || 1, b ? -a / b : mean(xs)];
      },
    },
  ],
  [
    /a\s*\*?\s*(?:e\s*\^|exp)\s*\(?\s*b\s*\*?\s*x\s*\)?\s*\+\s*c\b|\bexponential (?:plus|with) (?:a )?constant\b|\boffset exponential\b/,
    {
      name: 'Exponential with offset',
      params: ['a', 'b', 'c'],
      formula: 'y = a·e^(bx) + c',
      f: (x, p) => p[0]! * Math.exp(p[1]! * x) + p[2]!,
      start: (xs, ys) => {
        const lo = Math.min(...ys);
        const hi = Math.max(...ys);
        const inc = ys[ys.length - 1]! >= ys[0]!;
        const c0 = inc ? lo - 0.1 * (hi - lo || 1) : hi + 0.1 * (hi - lo || 1);
        const [la, b] = linFit(xs, ys.map((y) => Math.log(Math.abs(y - c0))));
        return [(inc ? 1 : -1) * Math.exp(la), b, c0];
      },
    },
  ],
];

export const nonlinear: PHandler = (c) => {
  const hit = MODELS.find(([re]) => re.test(c.s));
  const named = /\bnon-?linear (?:regression|fit|least squares|model)\b|\bcurve fit\b/.test(c.s);
  if (!hit) return named ? needErr(c, 'Which model? Supported: Michaelis–Menten, logistic growth, y = a*exp(b*x) + c (the basic fits also cover exponential, power and logarithmic curves)') : null;
  if (!/\bfit\b|\bregression\b|\bestimate\b|\bleast squares\b|\bmodel\b/.test(c.s)) return null;
  const m = hit[1];
  c.rest = c.rest.replace(/y\s*=\s*[^:]*?(?=\bx\s*[:=])/, ' ');
  const pairs = readPairs(c);
  if (!pairs) return needErr(c, 'Give the data, e.g. "x: 1 2 3 4 y: …" or "(1, 2) (2, 3) …"');
  const { xs, ys } = pairs;
  if (xs.length !== ys.length) bad(`There are ${xs.length} x values but ${ys.length} y values`);
  if (xs.length <= m.params.length) bad(`${m.name} has ${m.params.length} parameters, so it needs more than ${m.params.length} points`);
  let best = levenbergMarquardt(m.f, xs, ys, m.start(xs, ys));
  // A second start from the first solution polishes the last digits.
  const again = levenbergMarquardt(m.f, xs, ys, best.p);
  if (again.sse <= best.sse) best = again;
  if (!best.p.every(Number.isFinite)) bad(`The ${m.name} fit did not converge for these data`);
  const ym = mean(ys);
  const sst = ys.reduce((s, v) => s + (v - ym) ** 2, 0);
  const r2 = 1 - best.sse / sst;
  const notes = ['Nonlinear least squares by Levenberg–Marquardt from a linearised starting point'];
  if (!best.converged) notes.push('The optimiser stopped before full convergence: treat the estimates with care');
  return answer(c, {
    expression: `${m.name} fit ${m.formula} · n = ${xs.length}`,
    value: best.p[0]!,
    display: m.params.map((p, j) => `${p} = ${g6(best.p[j]!)}`).join(', '),
    lines: [...m.params.map((p, j) => ({ label: p, display: g7(best.p[j]!) })), { label: 'R²', display: g7(r2) }, { label: 'SSE', display: g7(best.sse) }],
    notes,
  });
};

export { namedLists, type OLS };
