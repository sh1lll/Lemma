import type { AnswerResult } from '@lemma/math-core';
import { blank, f, fail, need, NUM, ok, primaryOf, values, type Ctx } from './common';
import { fitModel, regressionPlot, residualLines, residualNotes } from './regression';
import { tTail } from './special';

/** Reads (x, y) pairs: "(1,2), (2,4)" or "x: 1,2,3 y: 2,4,6". */
export function readPairs(c: Ctx): { xs: number[]; ys: number[] } | null {
  const tuple = new RegExp(`\\(\\s*(${NUM})\\s*[,;]\\s*(${NUM})\\s*\\)`, 'g');
  const tuples = [...c.rest.matchAll(tuple)];
  if (tuples.length >= 2) {
    return { xs: tuples.map((m) => Number(m[1])), ys: tuples.map((m) => Number(m[2])) };
  }
  const xy =
    /(?:^|[^a-z])(?:x|x values|x-values|xs)\s*(?:[:=]|values|are|is)?\s*(.*?)(?:^|[^a-z])(?:y|y values|y-values|ys)\s*(?:[:=]|values|are|is)?\s*(.*)$/.exec(c.rest);
  if (xy) {
    const xs = values(xy[1]!);
    const ys = values(xy[2]!);
    if (xs.length >= 1 || ys.length >= 1) return { xs, ys };
  }
  return null;
}

/** "predict at x = 6", "predict y when x is 6", "estimate for x=6": consumes it and returns x, or null. */
export function takePredict(c: Ctx): number | null {
  const pm = new RegExp(`\\b(?:predict(?:ion|ed)?|estimate|forecast)\\w*(?:\\s+(?:y|the value|value))?(?:\\s+(?:at|for|when|if|with|of))?\\s*(?:x\\s*(?:=|is|of)?\\s*)?(${NUM})`).exec(c.rest) ??
    // "at x = 6", but not "for x = 1, 2, 3 y = …" (that is the data).
    new RegExp(`\\b(?:at|when|for|if)\\s+x\\s*(?:=|is|of)\\s*(${NUM})(?!\\s*[,;]?\\s*-?\\.?\\d)`).exec(c.rest);
  if (!pm) return null;
  c.rest = blank(c.rest, pm.index, pm.index + pm[0].length);
  return Number(pm[1]);
}

export function paired(c: Ctx): AnswerResult | null {
  const kind = /\bcovariance\b|\bcov\b/.test(c.s)
    ? 'cov'
    : /\bcorrelation\b|\bcorrelate|\bpearson\b|\bcorrel\b|\br value\b|\bcoefficient of determination\b|\br[- ]?squared\b|\br\s*(?:\^\s*2|²)/.test(c.s)
      ? 'cor'
      : /\bregression\b|\bregress\b|\bbest[- ]fit\b|\bleast[- ]squares\b|\btrend ?line\b|\blinear (?:fit|model)\b|\bline of fit\b|\bfit (?:a |the )?(?:straight )?line\b|\bscatter ?plot\b.*\bfit|\bpredict|\bslope\b|\bintercept\b/.test(c.s)
        ? 'reg'
        : null;
  if (!kind) return null;

  const at = takePredict(c);

  const pairs = readPairs(c);
  if (!pairs) return need(c, 'Give the paired data, e.g. "x: 1, 2, 3, 4 y: 2, 4, 5, 8" or "(1, 2), (2, 4), (3, 5)"');
  const { xs, ys } = pairs;
  if (xs.length !== ys.length) fail(`x has ${xs.length} values but y has ${ys.length}`);
  const n = xs.length;
  if (n < 2) fail('Need at least 2 (x, y) pairs');

  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const notes: string[] = [];

  if (kind === 'cov') {
    const population = /\bpopulation\b/.test(c.s);
    const cov = sxy / (population ? n : n - 1);
    notes.push(population ? 'Population covariance (divides by n)' : 'Sample covariance (divides by n − 1); say “population” to divide by n');
    const { primary, value } = primaryOf(cov, 10);
    return ok(c, {
      expression: `${population ? 'Population' : 'Sample'} covariance of ${n} (x, y) pairs`,
      primary,
      value,
      lines: [
        { label: population ? 'Sample covariance' : 'Population covariance', display: f(sxy / (population ? n - 1 : n), 10) },
        { label: 'Mean of x', display: f(mx, 10) },
        { label: 'Mean of y', display: f(my, 10) },
      ],
      notes,
    });
  }

  if (sxx === 0) fail('All x values are equal, so there is no line or correlation');
  const r = syy === 0 ? NaN : sxy / Math.sqrt(sxx * syy);
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const eq = `y = ${f(slope, 8)}x ${intercept < 0 ? '−' : '+'} ${f(Math.abs(intercept), 8)}`;
  const lines = [
    { label: 'Slope', display: f(slope, 10) },
    { label: 'Intercept', display: f(intercept, 10) },
    { label: 'Equation', display: eq },
    { label: 'r', display: f(r, 10) },
    { label: 'r²', display: f(r * r, 10) },
    { label: 'n', display: String(n) },
  ];

  if (kind === 'cor') {
    if (Number.isNaN(r)) fail('All y values are equal, so the correlation is undefined');
    const extra: { label: string; display: string }[] = [];
    if (n > 2 && Math.abs(r) < 1) {
      const t = (r * Math.sqrt(n - 2)) / Math.sqrt(1 - r * r);
      extra.push({ label: 't (H₀: ρ = 0)', display: f(t, 6) }, { label: 'p-value (two-sided)', display: f(2 * tTail(t, n - 2), 6) });
    }
    const want = /\br\s*(?:\^2|2|²)|r-squared|r squared|coefficient of determination/.test(c.s);
    const { primary, value } = primaryOf(want ? r * r : r, 10);
    notes.push('Pearson product-moment correlation');
    return ok(c, {
      expression: `${want ? 'Coefficient of determination r²' : 'Correlation r'} of ${n} (x, y) pairs`,
      primary,
      value,
      lines: [lines[3]!, lines[4]!, ...extra, lines[0]!, lines[1]!, lines[5]!],
      notes,
    });
  }

  notes.push('Least-squares line of y on x');
  const fit = fitModel('linear', xs, ys);
  lines.push(...residualLines(fit, xs));
  notes.push(...residualNotes(fit, xs));
  const plot = regressionPlot(fit, xs, ys, eq);
  if (at !== null) {
    const yhat = intercept + slope * at;
    const { primary, value } = primaryOf(yhat, 10);
    if (at < Math.min(...xs) || at > Math.max(...xs)) notes.push(`x = ${f(at)} is outside the data range (${f(Math.min(...xs))} to ${f(Math.max(...xs))}); extrapolation is unreliable`);
    return ok(c, {
      expression: `Predicted y at x = ${f(at)} from the regression of ${n} pairs`,
      primary,
      value,
      lines,
      notes,
      plot,
    });
  }
  const { value } = primaryOf(slope, 10);
  return ok(c, {
    expression: `Linear regression of ${n} (x, y) pairs`,
    primary: { display: eq, plain: `y = ${f(slope, 10).replace(/,/g, '')}*x + ${f(intercept, 10).replace(/,/g, '').replace('−', '-')}`, spoken: `y equals ${f(slope, 4)} x ${intercept < 0 ? 'minus' : 'plus'} ${f(Math.abs(intercept), 4)}` },
    value,
    lines,
    notes,
    plot,
  });
}
