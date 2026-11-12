import type { Answer } from '@lemma/math-core';
import { createSession } from '@lemma/math-core';
import { describe, expect, it } from 'vitest';
import { Runtime } from '../../runtime/src';

/*
 * Battery for the MODELS area of the stats-plus chunk: multiple / polynomial / logistic / nonlinear regression with
 * diagnostics, time series (ACF/PACF, AR, ARIMA, smoothing, ADF, cointegration, Granger, VAR, GARCH) and econometrics
 * (panel FE/RE, Hausman, IV/2SLS, DiD, RDD, Kalman).
 *
 * Every row runs through the full router. Expected values come from the source named in each row: closed forms,
 * textbook / Wikipedia worked examples, exact constructions, hand arithmetic, or an independent stdlib-Python
 * reimplementation (exact rational arithmetic for least squares, Numerical-Recipes incomplete beta / gamma for p-values)
 * written separately from the TypeScript engine. Iterative estimators (MA/ARIMA CSS, GARCH MLE, logistic IRLS) are
 * checked by properties that hold at any correct optimum (score equations, nesting, likelihood at a reference point).
 */

const rt = new Runtime();

interface Row {
  q: string;
  src?: string;
  value?: number;
  lines?: Record<string, number>;
  cells?: [string, string, number][];
  text?: string;
  error?: string;
  fn?: string;
  tol?: number;
}

const num = (s: string | undefined): number => {
  if (s === undefined) return NaN;
  const sup: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' };
  const t = s
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]/g, (ch) => sup[ch]!)
    .replace(/−/g, '-')
    .replace(/,/g, '')
    .replace(/\s/g, '')
    .replace(/×10\^?/, 'e');
  return Number(/^[-+0-9.e]+/.exec(t)?.[0] ?? NaN);
};
const lineOf = (a: Answer, label: string) => a.lines?.find((l) => l.label === label)?.display;
function cellOf(a: Answer, row: string, col: string): string | undefined {
  const t = a.table;
  if (!t) return undefined;
  const j = t.columns.indexOf(col);
  const r = t.rows.find((x) => x[0] === row);
  return j >= 0 && r ? r[j] : undefined;
}
function close(actual: number, expected: number, tol: number, what: string) {
  const ok = Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected)) + 1e-9;
  expect(ok, `${what}: got ${actual}, expected ${expected}`).toBe(true);
}

/** Labelled lists in an input: "x: 1 2 3 y: 0 1 1". */
function columnsIn(q: string): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const g of q.matchAll(/([a-z][a-z0-9_]*)\s*:\s*((?:-?[\d.]+(?:\s+|$))+)/g)) m.set(g[1]!, g[2]!.trim().split(/\s+/).map(Number));
  return m;
}

const CHECKS: Record<string, (a: Answer, q: string, arg: number) => void> = {
  logisticScore(a, q) {
    const cols = columnsIn(q);
    const names = [...cols.keys()];
    const yName = cols.has('y') ? 'y' : names[names.length - 1]!;
    const xs = names.filter((n) => n !== yName);
    const y = cols.get(yName)!;
    const b0 = num(cellOf(a, '(Intercept)', 'Estimate'));
    const bs = xs.map((n) => num(cellOf(a, n, 'Estimate')));
    expect(Number.isFinite(b0) && bs.every(Number.isFinite), 'coefficients present').toBe(true);
    const score = new Array(xs.length + 1).fill(0);
    let ll = 0;
    y.forEach((yi, i) => {
      const eta = b0 + bs.reduce((s, b, j) => s + b * cols.get(xs[j]!)![i]!, 0);
      const p = 1 / (1 + Math.exp(-eta));
      score[0] += yi - p;
      xs.forEach((n, j) => (score[j + 1] += (yi - p) * cols.get(n)![i]!));
      ll += yi ? Math.log(p) : Math.log(1 - p);
    });
    // Coefficients are displayed to 7 significant digits, so the score is only zero to that precision.
    for (const s of score) expect(Math.abs(s)).toBeLessThan(2e-3);
    close(num(lineOf(a, 'Log-likelihood')), ll, 1e-4, 'log-likelihood');
  },
  maCheck(a, _q, sse0) {
    expect(num(lineOf(a, 'SSE'))).toBeLessThanOrEqual(sse0 * (1 + 1e-6));
    expect(Math.abs(num(lineOf(a, 'θ1')))).toBeLessThan(1);
  },
  sseAtMost(a, _q, v) {
    expect(num(lineOf(a, 'SSE'))).toBeLessThanOrEqual(v * (1 + 1e-5) + 1e-9);
  },
  garchCheck(a, _q, llref) {
    const w = num(lineOf(a, 'ω'));
    const al = num(lineOf(a, 'α'));
    const be = num(lineOf(a, 'β'));
    expect(w).toBeGreaterThan(0);
    expect(al).toBeGreaterThanOrEqual(0);
    expect(be).toBeGreaterThanOrEqual(0);
    expect(al + be).toBeLessThan(1);
    expect(num(lineOf(a, 'Log-likelihood'))).toBeGreaterThanOrEqual(llref - 1e-6);
    close(num(lineOf(a, 'Long-run variance')), w / (1 - al - be), 1e-3, 'long-run variance');
  },
};

async function check(r: Row) {
  const o = await rt.compute(r.q, createSession(), { liveRates: false });
  if (r.error) {
    expect(o.kind, `${r.q} should be refused`).toBe('error');
    if (o.kind === 'error') expect(o.error.message).toMatch(new RegExp(r.error, 'i'));
    return;
  }
  if (o.kind !== 'answer') throw new Error(`${r.q} → ${o.kind}${o.kind === 'error' ? `: ${o.error.message}` : ''}`);
  const a = o.result;
  const tol = r.tol ?? 1e-5;
  if (r.value !== undefined) close(a.value!.toNumber(), r.value, tol, 'value');
  for (const [label, v] of Object.entries(r.lines ?? {})) close(num(lineOf(a, label)), v, tol, `line ${label}`);
  for (const [row, col, v] of r.cells ?? []) close(num(cellOf(a, row, col)), v, tol, `cell ${row}/${col}`);
  if (r.text) expect(JSON.stringify([a.expression, a.primary, a.lines, a.notes])).toMatch(new RegExp(r.text));
  if (r.fn) {
    const [name, arg] = r.fn.split(':');
    CHECKS[name!]!(a, r.q, Number(arg));
  }
}

// Generated rows (inputs + expected values); each row names its reference.
const ROWS: Row[] = [
  // exact construction y = 2 + 3·x1 − x2
  {"q": "multiple regression y: 3 7 7 11 11 15 x1: 1 2 3 4 5 6 x2: 2 1 4 3 6 5", "lines": {"R²": 1}, "cells": [["(Intercept)", "Estimate", 2], ["x1", "Estimate", 3], ["x2", "Estimate", -1]]},
  // independent exact-fraction OLS (stdlib Python reference)
  {"q": "regress y on x1 x2\ny,x1,x2\n5,1,3\n6,2,1\n9,3,4\n8,4,1\n12,5,5\n17,6,9\n13,7,2\n16,8,6", "lines": {"R²": 0.9865614916415018, "Adjusted R²": 0.9811860882981025}, "cells": [["(Intercept)", "Estimate", 2.2007874015748032], ["x1", "Estimate", 1.2828083989501313], ["x2", "Estimate", 0.7165354330708661]]},
  // independent exact-fraction OLS (stdlib Python reference) (TSV paste)
  {"q": "multiple regression\ny\tx1\tx2\n5\t1\t3\n6\t2\t1\n9\t3\t4\n8\t4\t1\n12\t5\t5\n17\t6\t9\n13\t7\t2\n16\t8\t6", "cells": [["(Intercept)", "Estimate", 2.2007874015748032], ["x1", "Estimate", 1.2828083989501313], ["x2", "Estimate", 0.7165354330708661], ["x1", "Std. error", 0.10753109789620359], ["x2", "t", 7.476599827277695]]},
  // independent exact-fraction OLS (stdlib Python reference) (space-separated paste)
  {"q": "ols\ny x1 x2\n5 1 3\n6 2 1\n9 3 4\n8 4 1\n12 5 5\n17 6 9\n13 7 2\n16 8 6", "cells": [["(Intercept)", "Estimate", 2.2007874015748032], ["x1", "Estimate", 1.2828083989501313], ["x2", "Estimate", 0.7165354330708661], ["x1", "p-value", 7.294794604844664e-05]]},
  // independent exact-fraction OLS (stdlib Python reference) HC1 = HC0·n/(n−k), White (1980) / MacKinnon–White (1985)
  {"q": "regress y on x1 x2 with robust standard errors\ny,x1,x2\n5,1,3\n6,2,1\n9,3,4\n8,4,1\n12,5,5\n17,6,9\n13,7,2\n16,8,6", "cells": [["x1", "Robust SE (HC1)", 0.12407315000147626], ["x2", "Robust SE (HC1)", 0.10106633339693591], ["(Intercept)", "Robust SE (HC1)", 0.5590698199305704]]},
  // independent exact-fraction OLS (stdlib Python reference) HC0 White (1980)
  {"q": "regress y on x1 x2 hc0\ny,x1,x2\n5,1,3\n6,2,1\n9,3,4\n8,4,1\n12,5,5\n17,6,9\n13,7,2\n16,8,6", "cells": [["x1", "Robust SE (HC0)", 0.09808843761909716], ["x2", "Robust SE (HC0)", 0.07989995207406494]]},
  // independent exact-fraction OLS (stdlib Python reference) Breusch–Pagan (Koenker studentised n·R² of e² on X)
  {"q": "regress y on x1 x2 breusch pagan\ny,x1,x2\n5,1,3\n6,2,1\n9,3,4\n8,4,1\n12,5,5\n17,6,9\n13,7,2\n16,8,6", "lines": {"Breusch–Pagan LM": 1.9175367237437562, "Breusch–Pagan p-value": 0.3833647619830569}},
  // independent exact-fraction OLS (stdlib Python reference) Durbin–Watson Σ(eₜ−eₜ₋₁)²/Σe²
  {"q": "regress y on x1 x2 durbin watson\ny,x1,x2\n5,1,3\n6,2,1\n9,3,4\n8,4,1\n12,5,5\n17,6,9\n13,7,2\n16,8,6", "lines": {"Durbin–Watson": 1.9553867785252779, "Residual standard error": 0.6123188574608002}},
  // independent exact-fraction OLS (stdlib Python reference)
  {"q": "regress y on x1 x2 f statistic\ny,x1,x2\n5,1,3\n6,2,1\n9,3,4\n8,4,1\n12,5,5\n17,6,9\n13,7,2\n16,8,6", "lines": {"F-statistic": 183.53255162758137, "F p-value": 2.0935226524207437e-05}},
  // independent exact-fraction OLS (stdlib Python reference) (labelled lists)
  {"q": "multiple regression y: 5 6 9 8 12 17 13 16 x1: 1 2 3 4 5 6 7 8 x2: 3 1 4 1 5 9 2 6", "lines": {"Observations": 8}, "cells": [["(Intercept)", "Estimate", 2.2007874015748032], ["x1", "Estimate", 1.2828083989501313], ["x2", "Estimate", 0.7165354330708661]]},
  // independent exact-fraction OLS (stdlib Python reference) VIF_j = 1/(1 − R²_j)
  {"q": "regress y on x1 x2 x3 vif\ny,x1,x2,x3\n10,2,1,5\n15,4,3,3\n12,3,2,6\n21,6,5,2\n18,5,4,7\n25,8,6,1\n24,7,7,4\n30,9,8,8\n31,10,8,3\n37,12,11,6", "lines": {"VIF x1": 38.16621253405992, "VIF x2": 38.35933242506809, "VIF x3": 1.1931198910081744}},
  // independent exact-fraction OLS (stdlib Python reference)
  {"q": "multiple regression adjusted r squared\ny,x1,x2,x3\n10,2,1,5\n15,4,3,3\n12,3,2,6\n21,6,5,2\n18,5,4,7\n25,8,6,1\n24,7,7,4\n30,9,8,8\n31,10,8,3\n37,12,11,6", "lines": {"R²": 0.9979569669761469, "Adjusted R²": 0.9969354504642203, "F-statistic": 976.9366968860859}},
  // independent exact-fraction OLS (stdlib Python reference) (subset of columns)
  {"q": "regress y on x1\ny,x1,x2,x3\n10,2,1,5\n15,4,3,3\n12,3,2,6\n21,6,5,2\n18,5,4,7\n25,8,6,1\n24,7,7,4\n30,9,8,8\n31,10,8,3\n37,12,11,6", "lines": {"R²": 0.9946020362145199}, "cells": [["x1", "Estimate", 2.7294372294372296], ["(Intercept)", "Estimate", 4.285714285714286]]},
  // independent exact-fraction OLS (stdlib Python reference)
  {"q": "regress y on x1 and x3\ny,x1,x2,x3\n10,2,1,5\n15,4,3,3\n12,3,2,6\n21,6,5,2\n18,5,4,7\n25,8,6,1\n24,7,7,4\n30,9,8,8\n31,10,8,3\n37,12,11,6", "cells": [["x1", "Estimate", 2.7294372294372296], ["x3", "Estimate", 0.16129032258064516], ["x3", "Std. error", 0.08809737170837095]]},
  // independent exact-fraction OLS (stdlib Python reference) (response = last column)
  {"q": "multiple regression\nprice,size,sales\n2,5,10\n4,3,15\n3,6,12\n6,2,21\n5,7,18\n8,1,25\n7,4,24\n9,8,30\n10,3,31\n12,6,37", "cells": [["price", "Estimate", 2.7294372294372296], ["size", "Estimate", 0.16129032258064516]]},
  // independent exact-fraction OLS (stdlib Python reference) HC1
  {"q": "multiple regression with robust se y: 10 15 12 21 18 25 24 30 31 37 x1: 2 4 3 6 5 8 7 9 10 12 x2: 1 3 2 5 4 6 7 8 8 11 x3: 5 3 6 2 7 1 4 8 3 6", "cells": [["x3", "Robust SE (HC1)", 0.09278346993683496]]},
  // hand: ŷ = 2.2 + 0.6x, residuals −0.8 0.6 1 −0.6 −0.2, SSE 2.4
  {"q": "residuals of regression x: 1 2 3 4 5 y: 2 4 5 4 5", "value": 2.4, "cells": [["1", "Residual", -0.8], ["3", "Residual", 1.0], ["5", "Fitted", 5.2]]},
  // hand: SE(b1) = √(0.8/10), t = 2.12132, df 3; p from t distribution
  {"q": "test the slope x: 1 2 3 4 5 y: 2 4 5 4 5", "value": 0.12402706265755463, "lines": {"t": 2.1213203435596424}},
  // hand: 0.6 ± t(0.975,3)=3.182446 × 0.282843
  {"q": "confidence interval for the slope x: 1 2 3 4 5 y: 2 4 5 4 5", "lines": {"Slope CI lower": -0.3001317452914304, "Slope CI upper": 1.5001317452914305}},
  // hand: SE(b0) = √(0.8·(1/5 + 9/10)) = 0.938083
  {"q": "linear regression standard errors x: 1 2 3 4 5 y: 2 4 5 4 5", "cells": [["(Intercept)", "Std. error", 0.938083151964686], ["x", "Std. error", 0.282842712474619], ["x", "Estimate", 0.6]]},
  // independent exact-fraction OLS (stdlib Python reference) overall F-test
  {"q": "is the regression significant\ny,x1,x2\n5,1,3\n6,2,1\n9,3,4\n8,4,1\n12,5,5\n17,6,9\n13,7,2\n16,8,6", "value": 2.0935226524207437e-05, "lines": {"F": 183.53255162758137}},
  // hand: adj R² = 1 − 0.4·4/3 = 0.466667
  {"q": "adjusted r squared x: 1 2 3 4 5 y: 2 4 5 4 5", "lines": {"R²": 0.6, "Adjusted R²": 0.4666666666666667}},
  // exact construction y = 1 − 2x + 0.5x² + 0.25x⁴
  {"q": "degree 4 polynomial fit x: 0 1 2 3 4 5 6 y: 1 -0.25 3 19.75 65 159.75 331", "lines": {"R²": 1}, "cells": [["(Intercept)", "Estimate", 1], ["x", "Estimate", -2], ["x^2", "Estimate", 0.5], ["x^3", "Estimate", 0], ["x^4", "Estimate", 0.25]]},
  // exact y = x²
  {"q": "polynomial regression degree 2 (1,1) (2,4) (3,9) (4,16)", "lines": {"R²": 1}, "cells": [["x^2", "Estimate", 1], ["x", "Estimate", 0]]},
  // validation: 6 coefficients need ≥ 6 points
  {"q": "polynomial regression degree 5 x: 1 2 3 4 5 y: 1 4 9 16 25", "error": "at least 6"},
  // independent exact-fraction OLS (stdlib Python reference)
  {"q": "polynomial degree 3 fit adjusted r squared x: 1 2 3 4 5 6 7 8 y: 2.1 3.9 9.2 15.8 26.1 35.7 50.3 63.9", "lines": {"R²": 0.9994059289557323, "Adjusted R²": 0.9989603756725316}, "cells": [["x^3", "Estimate", -0.03989898989898996], ["x^2", "Std. error", 0.4070427179036421]]},
  // closed form for one binary predictor: b0 = ln(3/2), b1 = ln odds ratio = ln(8/3), SE(b1) = √(1/3+1/2+1/4+1)
  {"q": "logistic regression x: 0 0 0 0 0 1 1 1 1 1 y: 1 1 1 0 0 1 1 1 1 0", "cells": [["(Intercept)", "Estimate", 0.4054651081081644], ["x", "Estimate", 0.9808292530117262], ["x", "Std. error", 1.4433756729740643], ["(Intercept)", "Std. error", 0.9128709291752768], ["x", "Odds ratio", 2.6666666666666665]], "tol": 1e-06},
  // Wikipedia "Logistic regression" hours-studied example: −4.0777 (SE 1.7610), 1.5046 (SE 0.6287)
  {"q": "logistic regression x: 0.5 0.75 1 1.25 1.5 1.75 1.75 2 2.25 2.5 2.75 3 3.25 3.5 4 4.25 4.5 4.75 5 5.5 y: 0 0 0 0 0 0 1 0 1 0 1 0 1 0 1 1 1 1 1 1", "cells": [["(Intercept)", "Estimate", -4.0777], ["x", "Estimate", 1.5046], ["(Intercept)", "Std. error", 1.761], ["x", "Std. error", 0.6287]], "tol": 0.0002},
  // Wikipedia example: z = 2.393, p = 0.0167 for hours; score equations X'(y − p̂) = 0 at the MLE
  {"q": "logit hours: 0.5 0.75 1 1.25 1.5 1.75 1.75 2 2.25 2.5 2.75 3 3.25 3.5 4 4.25 4.5 4.75 5 5.5 pass: 0 0 0 0 0 0 1 0 1 0 1 0 1 0 1 1 1 1 1 1", "cells": [["hours", "z", 2.393], ["hours", "p-value", 0.0167]], "fn": "logisticScore", "tol": 0.002},
  // perfect separation: MLE does not exist (Albert & Anderson 1984)
  {"q": "logistic regression x: 1 2 3 4 5 6 y: 0 0 0 1 1 1", "error": "separat"},
  // validation: response must be 0/1
  {"q": "logistic regression x: 1 2 3 4 y: 0 2 1 0", "error": "0 or 1|0/1|binary"},
  // score equations X'(y − p̂) = 0 and log-likelihood recomputed from the coefficients
  {"q": "logistic regression y: 0 0 1 0 0 1 0 1 1 1 x1: 1 2 3 4 5 6 7 8 9 10 x2: 3 1 4 1 5 9 2 6 5 3", "fn": "logisticScore"},
  // exact construction Vmax = 10, Km = 2
  {"q": "nonlinear fit michaelis-menten x: 1 2 3 4 5 6 y: 3.3333333333 5 6 6.6666666667 7.1428571429 7.5", "lines": {"Vmax": 10, "Km": 2}, "tol": 1e-05},
  // exact construction a = 2, b = 0.5, c = 1
  {"q": "nonlinear regression y = a*exp(b*x) + c x: 0 1 2 3 4 5 y: 3 4.2974425414 6.4365636569 9.9633781407 15.7781121979 25.3649879214", "lines": {"a": 2, "b": 0.5, "c": 1}, "tol": 1e-05},
  // exact construction K = 100, r = 1, x0 = 3
  {"q": "logistic growth fit x: 0 1 2 3 4 5 6 y: 4.7425873178 11.9202922022 26.894142137 50 73.105857863 88.0797077978 95.2574126822", "lines": {"K": 100, "r": 1, "x0": 3}, "tol": 1e-05},
  // sample ACF rₖ = Σ(xₜ−x̄)(xₜ₊ₖ−x̄)/Σ(xₜ−x̄)² (Box–Jenkins); PACF by Durbin–Levinson; Python reference
  {"q": "acf of 5 7 6 8 9 8 10 12 11 13 14 13 lag 3", "value": 0.6954022988505747, "lines": {"ACF lag 1": 0.6954022988505747, "ACF lag 2": 0.4942528735632184, "ACF lag 3": 0.2793103448275862}},
  // sample ACF rₖ = Σ(xₜ−x̄)(xₜ₊ₖ−x̄)/Σ(xₜ−x̄)² (Box–Jenkins); PACF by Durbin–Levinson; Python reference
  {"q": "pacf of 5, 7, 6, 8, 9, 8, 10, 12, 11, 13, 14, 13 lags 3", "lines": {"PACF lag 1": 0.6954022988505747, "PACF lag 2": 0.02065877838183571, "PACF lag 3": -0.13882321776481443}},
  // hand: r₁ = (−2·−1 + −1·0 + 0·1 + 1·2)/10 = 0.4
  {"q": "autocorrelation lag 1 of 1 2 3 4 5", "lines": {"ACF lag 1": 0.4}},
  // AR(1) by OLS on (yₜ, yₜ₋₁): conditional least squares; Python exact OLS
  {"q": "fit ar(1) to 5 7 6 8 9 8 10 12 11 13 14 13", "lines": {"φ1": 0.8118279569892473, "Intercept": 2.489247311827957}},
  // AR(2) by OLS; Python exact OLS
  {"q": "ar(2) model 5 7 6 8 9 8 10 12 11 13 14 13", "lines": {"φ1": 0.41223947691050267, "φ2": 0.5126685737637924, "Intercept": 1.7973028197793217}},
  // Yule–Walker AR(1): φ = r₁
  {"q": "ar(1) yule-walker 5 7 6 8 9 8 10 12 11 13 14 13", "lines": {"φ1": 0.6954022988505747}},
  // AR(1) OLS recursion ŷ = c + φ·y
  {"q": "ar(1) 5 7 6 8 9 8 10 12 11 13 14 13 forecast 2", "value": 13.043010752688172, "lines": {"Forecast 1": 13.043010752688172, "Forecast 2": 13.077928084171578}},
  // Yule–Walker equations R·φ = r
  {"q": "ar(2) yule walker 5 7 6 8 9 8 10 12 11 13 14 13", "lines": {"φ1": 0.6810361368724016, "φ2": 0.020658778381835684}},
  // random walk: forecasts equal the last value 13
  {"q": "arima(0,1,0) 5 7 6 8 9 8 10 12 11 13 14 13 forecast 3", "lines": {"Forecast 1": 13, "Forecast 2": 13, "Forecast 3": 13}},
  // ARIMA(1,1,0) without constant: CSS = OLS of Δyₜ on Δyₜ₋₁
  {"q": "arima(1,1,0) 5 7 6 8 9 8 10 12 11 13 14 13 forecast 2", "lines": {"φ1": -0.16, "Forecast 1": 13.16, "Forecast 2": 13.1344}},
  // ARIMA(1,0,0) CSS ≡ OLS AR(1); mean = c/(1 − φ)
  {"q": "arima(1,0,0) 5 7 6 8 9 8 10 12 11 13 14 13", "lines": {"φ1": 0.8118279569892473, "Mean": 13.228571428571424}},
  // property: CSS optimum ≤ SSE at θ = 0 (= Σ(y−ȳ)² = 96.6667) and |θ| < 1
  {"q": "ma(1) 5 7 6 8 9 8 10 12 11 13 14 13", "fn": "maCheck:96.66666666666666"},
  // property: nested in ARIMA(1,1,0), so CSS ≤ 21.36
  {"q": "arima(1,1,1) 5 7 6 8 9 8 10 12 11 13 14 13 forecast 2", "fn": "sseAtMost:21.36"},
  // SES recursion ℓₜ = αyₜ + (1−α)ℓₜ₋₁, ℓ₁ = y₁; Python reference
  {"q": "simple exponential smoothing alpha 0.3 of 5 7 6 8 9 8 10 12 11 13 14 13", "lines": {"Forecast": 12.12536206604, "SSE": 62.46832989583964}},
  // property: optimised α has SSE ≤ grid minimum over α = 0.01…1 (25.451278)
  {"q": "exponential smoothing of 5 7 6 8 9 8 10 12 11 13 14 13", "fn": "sseAtMost:25.451278331178724"},
  // hand: 10 → 11 → 12.5
  {"q": "exponential smoothing alpha 0.5 of 10 12 14", "value": 12.5, "lines": {"Forecast": 12.5}},
  // perfect linear trend: forecasts 11 and 13
  {"q": "holt alpha 0.5 beta 0.5 of 1 3 5 7 9 forecast 2", "lines": {"Forecast 1": 11, "Forecast 2": 13}},
  // Holt's linear method, ℓ₁ = y₁, b₁ = y₂ − y₁; Python reference
  {"q": "holt linear alpha 0.8 beta 0.2 of 5 7 6 8 9 8 10 12 11 13 14 13 forecast 3", "lines": {"Forecast 1": 14.127620061067248, "Forecast 3": 15.572486376963482, "SSE": 25.6567397740178}},
  // pure seasonal pattern: forecasts repeat 10, 20, 30
  {"q": "holt winters season 3 of 10 20 30 10 20 30 10 20 30 forecast 3", "lines": {"Forecast 1": 10, "Forecast 2": 20, "Forecast 3": 30}},
  // additive Holt–Winters, initial level/trend/seasonals from the first two seasons; Python reference
  {"q": "holt winters additive period 4 alpha 0.3 beta 0.1 gamma 0.2 of 12 18 25 15 14 20 27 17 16 22 30 19 18 24 32 21 forecast 4", "lines": {"Forecast 1": 19.826852327991112, "Forecast 2": 26.072800111851087, "Forecast 4": 23.68386029201355, "SSE": 6.3966345653272825}},
  // hand: 4, 6, 8
  {"q": "3-point moving average of 2 4 6 8 10", "value": 8, "cells": [["3", "Moving average", 4], ["5", "Moving average", 8]]},
  // hand: last four (11+13+14+13)/4 = 12.75
  {"q": "moving average window 4 of 5 7 6 8 9 8 10 12 11 13 14 13", "value": 12.75},
  // ADF regression Δyₜ = α (+ βt) + γyₜ₋₁ + Σδᵢ Δyₜ₋ᵢ, statistic = γ̂/SE; Python exact OLS; 5% critical value MacKinnon (2010) constant: −2.86154 − 2.8903/T − 4.234/T² − 40.040/T³
  {"q": "adf test lags 0 of 10 9.74 10.25 10.02 9.7 8.77 8.56 9.67 10.09 11.13 11.38 11.77 11.96 10.29 11.15 11.66 12.16 10.47 8.73 7.84 7.37 7.68 7.63 8.15 7.51", "value": -0.8916134258461578, "lines": {"ADF statistic": -0.8916134258461578, "Critical value 5%": -2.9922162731481485}},
  // ADF regression Δyₜ = α (+ βt) + γyₜ₋₁ + Σδᵢ Δyₜ₋ᵢ, statistic = γ̂/SE; Python exact OLS
  {"q": "augmented dickey fuller lags 1 of 10 9.74 10.25 10.02 9.7 8.77 8.56 9.67 10.09 11.13 11.38 11.77 11.96 10.29 11.15 11.66 12.16 10.47 8.73 7.84 7.37 7.68 7.63 8.15 7.51", "lines": {"ADF statistic": -1.3541394026598679, "Lags": 1, "Observations used": 23}},
  // ADF regression Δyₜ = α (+ βt) + γyₜ₋₁ + Σδᵢ Δyₜ₋ᵢ, statistic = γ̂/SE; Python exact OLS; trend 5%: −3.41049 − 4.3904/T − 9.036/T² − 45.374/T³
  {"q": "dickey fuller with trend lags 0 of 10 9.74 10.25 10.02 9.7 8.77 8.56 9.67 10.09 11.13 11.38 11.77 11.96 10.29 11.15 11.66 12.16 10.47 8.73 7.84 7.37 7.68 7.63 8.15 7.51", "lines": {"ADF statistic": -1.2684060023208183, "Critical value 5%": -3.6123930960648143}},
  // ADF regression Δyₜ = α (+ βt) + γyₜ₋₁ + Σδᵢ Δyₜ₋ᵢ, statistic = γ̂/SE; Python exact OLS; strongly mean-reverting series rejects the unit root
  {"q": "unit root test lags 0 3 -2 4 -3 2 -4 3 -1 2 -3 4 -2 3 -3 1 -2 4 -3 2 -1", "lines": {"ADF statistic": -16.91607433466993}, "text": "Reject H₀"},
  // Engle–Granger: OLS y on x, then ADF (no constant) on residuals; Python exact OLS
  {"q": "cointegration test x: 5 3.78 4.16 5.15 4.64 3.31 3.24 3.72 4.82 3.6 2.31 3.02 3.49 5.02 6 5.9 5.63 8.2 7.91 7.13 5.99 6.09 6.24 5.9 5.84 6.11 6.8 7.9 8.11 6.32 y: 11.35 7.85 9.23 10.56 10.28 7.23 7.59 10.09 10.62 8.62 4.96 6.9 8.31 10.99 13.19 12.85 11.76 17.68 16.41 16.2 12.73 13.52 13.48 13.28 12.38 13.72 14.54 17.43 17.53 13.71 lags 0", "lines": {"ADF statistic": -6.72445038633127, "Cointegrating slope": 2.059584852210979}},
  // Engle–Granger with 1 lagged difference; Python exact OLS
  {"q": "engle granger cointegration x: 5 3.78 4.16 5.15 4.64 3.31 3.24 3.72 4.82 3.6 2.31 3.02 3.49 5.02 6 5.9 5.63 8.2 7.91 7.13 5.99 6.09 6.24 5.9 5.84 6.11 6.8 7.9 8.11 6.32 y: 11.35 7.85 9.23 10.56 10.28 7.23 7.59 10.09 10.62 8.62 4.96 6.9 8.31 10.99 13.19 12.85 11.76 17.68 16.41 16.2 12.73 13.52 13.48 13.28 12.38 13.72 14.54 17.43 17.53 13.71 lags 1", "lines": {"ADF statistic": -3.065127486293404}},
  // Granger F = ((RSS_r − RSS_u)/p)/(RSS_u/(T − 2p − 1)); Python exact OLS + F distribution
  {"q": "granger causality x: -1.18 -1.15 0.67 -2.29 -0.14 -2.26 1.1 0.2 1.36 -0.5 0.4 -0.29 -0.74 0.15 -1.26 -0.35 0.7 0.06 -0.41 2.19 y: 0 -0.91 -1.49 0.17 -2.04 -0.92 -2.26 1.21 0.53 1.33 0.34 1.43 0.09 -0.88 1.09 -1.41 -0.89 0.63 1.38 -0.39 lag 1", "value": 1.0395914728123257e-07, "lines": {"F": 82.37732174726551}},
  // Granger F-test with 2 lags; Python reference
  {"q": "does x granger cause y lag 2 x: -1.18 -1.15 0.67 -2.29 -0.14 -2.26 1.1 0.2 1.36 -0.5 0.4 -0.29 -0.74 0.15 -1.26 -0.35 0.7 0.06 -0.41 2.19 y: 0 -0.91 -1.49 0.17 -2.04 -0.92 -2.26 1.21 0.53 1.33 0.34 1.43 0.09 -0.88 1.09 -1.41 -0.89 0.63 1.38 -0.39", "value": 4.268917326292795e-06, "lines": {"F": 37.05302445054636}},
  // VAR(1) by equation-wise OLS on a constant and both first lags; Python exact OLS
  {"q": "var(1) y1: 1 0.63 0.19 0.18 0.75 0.43 0.65 0.57 0.17 -0.33 -0.75 -0.51 -0.32 -0.32 -0.01 y2: 0.5 0.78 0.83 0.44 0.33 0.49 0.33 -0.03 -0.09 -0.49 -0.4 -0.41 -0.7 -0.38 -0.51", "cells": [["y1", "Constant", -0.007842994559678957], ["y1", "y1 lag 1", 0.40801891866445295], ["y1", "y2 lag 1", 0.40419804513390456], ["y2", "y1 lag 1", 0.2680946970537293], ["y2", "y2 lag 1", 0.689010942420069]]},
  // VAR(1) one-step forecast; Python reference
  {"q": "vector autoregression forecast y1: 1 0.63 0.19 0.18 0.75 0.43 0.65 0.57 0.17 -0.33 -0.75 -0.51 -0.32 -0.32 -0.01 y2: 0.5 0.78 0.83 0.44 0.33 0.49 0.33 -0.03 -0.09 -0.49 -0.4 -0.41 -0.7 -0.38 -0.51", "lines": {"Forecast y1": -0.2180641867646148, "Forecast y2": -0.444373293462616}},
  // property: MLE log-likelihood ≥ value at (ω = 0.1·var, α = 0.1, β = 0.8) = 125.02853; ω > 0, α, β ≥ 0, α + β < 1
  {"q": "garch(1,1) returns -0.0064 -0.0073 -0.0045 0.0271 -0.0048 -0.0546 0.013 -0.0101 -0.0079 0.0041 0.0078 0.0382 0.0224 0.0037 -0.0241 -0.0331 0.0082 0.0426 0.0014 -0.0035 0.0171 -0.0462 -0.0107 0.0163 0.0286 -0.0079 0.0121 0.0078 0.0241 -0.0346 0.0183 -0.0483 -0.0907 -0.0267 -0.0391 0.0372 0.0279 -0.05 0.0357 -0.0418 -0.0036 -0.0117 0.0044 0.0301 0.0233 0.0126 0.0226 0.0165 -0.0211 -0.0239 -0.0156 0.0162 -0.008 0.073 -0.0314 -0.0417 0.0298 0.0544 0.0205 0.0328", "fn": "garchCheck:125.02853236235707"},
  // property: log-likelihood ≥ 67.625847 at (0.05·var, 0.05, 0.9); long-run variance = ω/(1 − α − β)
  {"q": "fit garch 1 1 to -0.0096, -0.0109, -0.0067, 0.0406, -0.0072, -0.0819, 0.0195, -0.0152, -0.0119, 0.0062, 0.0117, 0.0573, 0.0336, 0.0056, -0.0362, -0.0496, 0.0123, 0.0639, 0.0021, -0.0053, 0.0256, -0.0693, -0.016, 0.0244, 0.0429, -0.0119, 0.0181, 0.0117, 0.0362, -0.0519, 0.0275, -0.0725, -0.1361, -0.0401, -0.0587, 0.0558, 0.0418, -0.075, 0.0536, -0.0627", "fn": "garchCheck:67.62584657712318"},
  // exact construction yᵢₜ = αᵢ + 2xᵢₜ: within estimator gives 2
  {"q": "fixed effects regression y on x\nid,time,y,x\n1,1,7,1\n1,2,9,2\n1,3,11,3\n1,4,13,4\n2,1,3,2\n2,2,5,3\n2,3,9,5\n2,4,11,6\n3,1,10,0\n3,2,12,1\n3,3,12,1\n3,4,16,3", "value": 2, "cells": [["x", "Estimate", 2]]},
  // within (entity-demeaned) OLS, σ² = SSR/(NT − N − K) (Wooldridge 2010 §10.5); Python exact
  {"q": "panel fixed effects regress y on x z\nfirm,year,y,x,z\n1,1,7.4,1.0,0.5\n1,2,9.47,2.5,0.1\n1,3,10.03,3.1,0.9\n1,4,12.38,4.2,0.4\n2,1,14.44,2.2,0.7\n2,2,16.39,2.9,0.2\n2,3,18.62,4.8,0.6\n2,4,20.51,6.1,0.8\n3,1,1.71,0.3,0.3\n3,2,1.53,1.1,0.9\n3,3,2.9,1.4,0.5\n3,4,4.92,2.8,0.1\n4,1,17.73,3.3,0.4\n4,2,17.32,3.0,0.6\n4,3,18.94,4.4,0.2\n4,4,20.44,5.2,0.7", "cells": [["x", "Estimate", 1.469847713340321], ["z", "Estimate", -0.7714425821334413], ["x", "Std. error", 0.07539169447510287], ["z", "Std. error", 0.3415217223889652]]},
  // Swamy–Arora random effects: θ = 1 − √(σ²ₑ/(Tσ²ᵤ + σ²ₑ)), quasi-demeaned OLS (Baltagi 2013 §2.3); Python reference
  {"q": "random effects regress y on x z\nfirm,year,y,x,z\n1,1,7.4,1.0,0.5\n1,2,9.47,2.5,0.1\n1,3,10.03,3.1,0.9\n1,4,12.38,4.2,0.4\n2,1,14.44,2.2,0.7\n2,2,16.39,2.9,0.2\n2,3,18.62,4.8,0.6\n2,4,20.51,6.1,0.8\n3,1,1.71,0.3,0.3\n3,2,1.53,1.1,0.9\n3,3,2.9,1.4,0.5\n3,4,4.92,2.8,0.1\n4,1,17.73,3.3,0.4\n4,2,17.32,3.0,0.6\n4,3,18.94,4.4,0.2\n4,4,20.44,5.2,0.7", "lines": {"θ": 0.7390040455644576}, "cells": [["x", "Estimate", 1.720272477116972], ["z", "Estimate", -0.7265729385285041], ["(Intercept)", "Estimate", 7.336297848101589]], "tol": 1e-06},
  // Hausman H = (b_FE − b_RE)²/(V_FE − V_RE), χ²(1) (Hausman 1978); Python reference using the same FE/RE fits, both variances with the within-estimator σ²ₑ
  {"q": "hausman test fixed vs random effects y on x\nfirm,year,y,x,z\n1,1,7.4,1.0,0.5\n1,2,9.47,2.5,0.1\n1,3,10.03,3.1,0.9\n1,4,12.38,4.2,0.4\n2,1,14.44,2.2,0.7\n2,2,16.39,2.9,0.2\n2,3,18.62,4.8,0.6\n2,4,20.51,6.1,0.8\n3,1,1.71,0.3,0.3\n3,2,1.53,1.1,0.9\n3,3,2.9,1.4,0.5\n3,4,4.92,2.8,0.1\n4,1,17.73,3.3,0.4\n4,2,17.32,3.0,0.6\n4,3,18.94,4.4,0.2\n4,4,20.44,5.2,0.7", "value": 8.883260919833692e-37, "lines": {"H": 160.48092753880854}, "tol": 1e-05},
  // just-identified IV: β = cov(z, y)/cov(z, x); Python reference
  {"q": "iv regression y: 5 6.8 9.1 9.9 13.2 14.8 16.1 18.9 19.7 23 x: 2.1 2.9 4.2 4.8 6.1 7.2 7.9 9.1 9.8 11.2 z: 1 2 3 4 5 6 7 8 9 10", "value": 1.9473046638400968, "cells": [["x", "Estimate", 1.9473046638400968]]},
  // 2SLS with exogenous control w; SE from structural residuals with the actual x (Wooldridge 2010 §5.2); Python exact
  {"q": "2sls y: 5 6.8 9.1 9.9 13.2 14.8 16.1 18.9 19.7 23 x: 2.1 2.9 4.2 4.8 6.1 7.2 7.9 9.1 9.8 11.2 z: 1 2 3 4 5 6 7 8 9 10 w: 3 1 4 1 5 9 2 6 5 3", "cells": [["x", "Estimate", 1.9446076658832039], ["w", "Estimate", 0.009894985837401006], ["x", "Std. error", 0.035638263634962704], ["(Intercept)", "Estimate", 0.9131214970168147]]},
  // first-stage F for excluding the instrument; Python exact
  {"q": "instrumental variables y: 5 6.8 9.1 9.9 13.2 14.8 16.1 18.9 19.7 23 x: 2.1 2.9 4.2 4.8 6.1 7.2 7.9 9.1 9.8 11.2 z: 1 2 3 4 5 6 7 8 9 10 w: 3 1 4 1 5 9 2 6 5 3 first stage", "lines": {"First-stage F": 3034.131106806078}},
  // 2×2 DiD: (15 − 10) − (9 − 8) = 4
  {"q": "difference in differences treated before 10 after 15 control before 8 after 9", "value": 4, "lines": {"Treated change": 5, "Control change": 1}},
  // 2×2 DiD: 6 − 1 = 5
  {"q": "diff-in-diff treatment pre 20 post 26 control pre 18 post 19", "value": 5},
  // 2×2 DiD: 0.9 − 0.3 = 0.6
  {"q": "did treated before 3.2 after 4.1 control before 3.0 after 3.3", "value": 0.6},
  // saturated 2×2 regression: coefficient on treated×post = difference of the four cell means
  {"q": "difference in differences regression\ny,treated,post\n10,0,0\n11,0,0\n12,0,1\n13,0,1\n9,1,0\n10,1,0\n16,1,1\n17,1,1\n10.5,0,0\n12.5,0,1\n9.5,1,0\n16.5,1,1", "value": 5.0, "lines": {"DiD estimate": 5.0}},
  // validation: the control group is needed
  {"q": "difference in differences treated before 10 after 15", "error": "control"},
  // exact construction y = 1 + x + 5·[x ≥ 0]: jump 5
  {"q": "regression discontinuity cutoff 0 x: -5 -4 -3 -2 -1 0 1 2 3 4 5 y: -4 -3 -2 -1 0 6 7 8 9 10 11", "value": 5, "lines": {"Jump at cutoff": 5}},
  // local linear regression on each side within the bandwidth (uniform kernel), jump = difference of intercepts at the cutoff; Python exact
  {"q": "rdd cutoff 1 bandwidth 3 x: -4 -3.5 -3 -2.2 -1.5 -1 -0.4 0.2 0.6 1.1 1.9 2.5 3.1 3.8 y: 0.2 0.15 0.8 0.7 1.35 1.5 1.5 2.3 2.2 5.65 6.25 6.05 6.55 7", "value": 3.18696180868312, "lines": {"Jump at cutoff": 3.18696180868312}},
  // local level model: predict P += q; K = P/(P + r); update a += K(y − a), P = (1 − K)P; diffuse start; Python reference
  {"q": "kalman filter local level q 0.5 r 1 data 4.4 4 3.5 4.6 5.2 4.9 5.6 6.1", "value": 5.65099107098009, "lines": {"Filtered level": 5.65099107098009}},
  // validation: columns must have equal lengths
  {"q": "multiple regression y: 1 2 3 4 x1: 1 2 3 x2: 4 3 2 1", "error": "same length|equal length|values"},
  // validation: x2 = 2·x1 is perfectly collinear
  {"q": "multiple regression y: 1 2 3 5 4 6 x1: 1 2 3 4 5 6 x2: 2 4 6 8 10 12", "error": "collinear"},
  // validation: 3 coefficients need more than 3 observations
  {"q": "multiple regression y: 1 2 3 x1: 1 2 4 x2: 3 1 2", "error": "observations"},
  // validation: too few observations for ARIMA(2,1,2)
  {"q": "arima(2,1,2) of 1 2 3", "error": "observations|values"},
  // validation: GARCH needs a longer return series
  {"q": "garch(1,1) returns 0.01 0.02", "error": "observations|returns|values"},
  // unchanged basic engine: least squares y = 1.95x + 0.1
  {"q": "fit a line to (1,2) (2,4.1) (3,5.9)", "text": "1.95x"},
  // unchanged basic engine: exact y = x²
  {"q": "quadratic regression of (1,1) (2,4) (3,9) (4,16)", "text": "y = x²"},
];

describe('stats-plus models battery', () => {
  it('has at least 80 distinct inputs', () => {
    expect(new Set(ROWS.map((r) => r.q)).size).toBeGreaterThanOrEqual(80);
  });
  it.each(ROWS.map((r) => [r.q.replace(/\n/g, ' ⏎ ').slice(0, 90), r] as const))('%s', async (_name, r) => {
    await check(r);
  });
});
