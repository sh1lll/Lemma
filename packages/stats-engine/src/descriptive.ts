import { D, type AnswerResult, type Dec } from '@lemma/math-core';
import { blank, f, fail, fd, need, NUM, numbersIn, ok, primaryOf, strip, take, values, type Ctx } from './common';
import { MEAN_NAMES, SD_NAMES } from './distributions';

// ---------- exact helpers on Decimals ----------
const dsum = (xs: Dec[]) => xs.reduce((a, b) => a.plus(b), new D(0));
const dmean = (xs: Dec[]) => dsum(xs).div(xs.length);
function dvar(xs: Dec[], sample: boolean): Dec {
  const m = dmean(xs);
  const ss = xs.reduce((a, x) => a.plus(x.minus(m).pow(2)), new D(0));
  return ss.div(xs.length - (sample ? 1 : 0));
}
function dmedian(sorted: Dec[]): Dec {
  const n = sorted.length;
  const h = Math.floor(n / 2);
  return n % 2 ? sorted[h]! : sorted[h - 1]!.plus(sorted[h]!).div(2);
}
/** Q1/Q3 as medians of the lower and upper halves, excluding the median when n is odd. */
export function dquartiles(sorted: Dec[]): [Dec, Dec, Dec] {
  const n = sorted.length;
  if (n === 1) return [sorted[0]!, sorted[0]!, sorted[0]!];
  const h = Math.floor(n / 2);
  return [dmedian(sorted.slice(0, h)), dmedian(sorted), dmedian(sorted.slice(n - h))];
}
/** Linear interpolation between closest ranks: position (n − 1)·p, as Excel PERCENTILE.INC / R type 7. */
function dpercentile(sorted: Dec[], p: number): Dec {
  const h = new D(sorted.length - 1).mul(p);
  const lo = h.floor().toNumber();
  const frac = h.minus(lo);
  const a = sorted[lo]!;
  const b = sorted[Math.min(lo + 1, sorted.length - 1)]!;
  return a.plus(b.minus(a).mul(frac));
}
function modes(xs: Dec[]): Dec[] {
  const counts = new Map<string, { v: Dec; n: number }>();
  for (const x of xs) {
    const k = x.toString();
    const e = counts.get(k);
    if (e) e.n++;
    else counts.set(k, { v: x, n: 1 });
  }
  const max = Math.max(...[...counts.values()].map((e) => e.n));
  if (max === 1) return [];
  return [...counts.values()].filter((e) => e.n === max).map((e) => e.v);
}
/** Adjusted Fisher–Pearson sample skewness G1 (Excel SKEW). */
function skewness(xs: number[]): number {
  const n = xs.length;
  const m = xs.reduce((a, b) => a + b, 0) / n;
  let m2 = 0;
  let m3 = 0;
  for (const x of xs) {
    const d = x - m;
    m2 += d * d;
    m3 += d * d * d;
  }
  const s = Math.sqrt(m2 / (n - 1));
  return ((n / ((n - 1) * (n - 2))) * m3) / (s * s * s);
}
/** Sample excess kurtosis G2 (Excel KURT). */
function kurtosis(xs: number[]): number {
  const n = xs.length;
  const m = xs.reduce((a, b) => a + b, 0) / n;
  let m2 = 0;
  let m4 = 0;
  for (const x of xs) {
    const d = (x - m) * (x - m);
    m2 += d;
    m4 += d * d;
  }
  const s2 = m2 / (n - 1);
  return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * (m4 / (s2 * s2)) - (3 * (n - 1) * (n - 1)) / ((n - 2) * (n - 3));
}

const list = (xs: Dec[], max = 12) => xs.slice(0, max).map((x) => fd(x)).join(', ') + (xs.length > max ? ', …' : '');
const QUARTILE_NOTE = 'Quartiles: median of each half, excluding the overall median when n is odd (Tukey/TI-84 method)';
const PERCENTILE_NOTE = 'Percentile by linear interpolation between closest ranks (Excel PERCENTILE.INC)';

/** The data list, or null when the numbers are not written as a list ("average speed 60 mph for 2 hours"). */
export function data(c: Ctx): Dec[] | null {
  const nums = numbersIn(c.rest);
  for (let i = 1; i < nums.length; i++) {
    const gap = c.rest.slice(nums[i - 1]!.end, nums[i]!.index);
    if (!/^(?:[\s,;&+]|and\b)*$/.test(gap)) return null;
  }
  return nums.map((n) => new D(c.rest.slice(n.index, n.end).replace(/,/g, '')));
}

type Stat =
  | 'summary' | 'weighted' | 'zscore' | 'percentile' | 'quartiles' | 'iqr' | 'sd' | 'variance' | 'skewness' | 'kurtosis'
  | 'median' | 'mode' | 'geomean' | 'harmean' | 'mean' | 'range' | 'sum' | 'count' | 'min' | 'max';

const STATS: [Stat, RegExp][] = [
  ['summary', /\b(?:summary|summari[sz]e|stats|statistics|describe|descriptive|five[- ]number|5[- ]number)\b/],
  ['weighted', /\bweighted (?:average|mean|avg)\b/],
  ['zscore', /\bz[- ]?scores?\b|\bstandard score\b|\bstandardi[sz]e/],
  ['percentile', /\bpercentile\b/],
  ['iqr', /\biqr\b|\binter-?quartile range\b/],
  ['quartiles', /\bquartiles?\b|\bq[13]\b/],
  ['sd', new RegExp(`\\b(?:${SD_NAMES}|standard dev)\\b`)],
  ['variance', /\bvariance\b|\bvar\b/],
  ['skewness', /\bskew(?:ness)?\b/],
  ['kurtosis', /\bkurtosis\b/],
  ['median', /\bmedian\b/],
  ['mode', /\bmodes?\b|\bmost (?:common|frequent)\b/],
  ['geomean', /\bgeometric (?:mean|average)\b/],
  ['harmean', /\bharmonic (?:mean|average)\b/],
  ['mean', /\b(?:mean|average|avg|arithmetic mean)\b/],
  ['range', /\brange\b/],
  ['sum', /\b(?:sum|total|add up)\b/],
  ['count', /\b(?:count|how many (?:numbers|values|items))\b/],
  ['min', /\b(?:minimum|min|smallest|lowest)\b(?:\s*(?:of|value|\(|:|in))/],
  ['max', /\b(?:maximum|max|largest|biggest|highest)\b(?:\s*(?:of|value|\(|:|in))/],
];

const LABEL: Record<Stat, string> = {
  summary: 'Summary', weighted: 'Weighted average', zscore: 'z-score', percentile: 'Percentile', quartiles: 'Quartiles', iqr: 'Interquartile range',
  sd: 'standard deviation', variance: 'variance', skewness: 'Skewness', kurtosis: 'Excess kurtosis', median: 'Median', mode: 'Mode',
  geomean: 'Geometric mean', harmean: 'Harmonic mean', mean: 'Mean', range: 'Range', sum: 'Sum', count: 'Count', min: 'Minimum', max: 'Maximum',
};

export function descriptive(c: Ctx): AnswerResult | null {
  const hit = STATS.find(([, re]) => re.test(c.s));
  if (!hit) return null;
  const stat = hit[0];
  const population = /\bpopulation\b/.test(c.s);
  const notes: string[] = [];

  // ---- statistics with parameters of their own ----
  if (stat === 'weighted') {
    const m = /\bweights?\b/.exec(c.rest);
    if (!m) return need(c, 'What are the weights? (e.g. "with weights 0.2, 0.5, 0.3")');
    const xs = values(c.rest.slice(0, m.index));
    const ws = values(c.rest.slice(m.index));
    if (xs.length === 0) return need(c, 'Which values? (e.g. "weighted average of 80, 90, 70 with weights 0.2, 0.5, 0.3")');
    if (xs.length !== ws.length) fail(`There are ${xs.length} values but ${ws.length} weights`);
    const dx = xs.map((x) => new D(x));
    const dw = ws.map((w) => new D(w));
    const W = dsum(dw);
    if (W.isZero()) fail('The weights add up to zero');
    const v = dx.reduce((a, x, i) => a.plus(x.mul(dw[i]!)), new D(0)).div(W);
    const { primary, value } = primaryOf(v, 12);
    if (!W.eq(1)) notes.push(`Weights add up to ${fd(W)}; the result is divided by that total`);
    return ok(c, {
      expression: `Weighted average of ${xs.length} values`,
      primary,
      value,
      lines: [{ label: 'Σ w·x', display: fd(v.mul(W)) }, { label: 'Σ w', display: fd(W) }],
      notes,
    });
  }

  if (stat === 'zscore') {
    // "z-score of 85 in 70, 80, 90" or "z-score of 85 with mean 80 and sd 5"
    strip(c, /\bz[- ]?scores?\b|\bstandard score\b|\bstandardi[sz]e\b/);
    const mu = take(c, MEAN_NAMES);
    const sd = take(c, SD_NAMES);
    let x: number | null = null;
    const xm = new RegExp(`(?:^|\\s)(?:of|for|x\\s*=|value|score)\\s*(${NUM})`).exec(c.rest);
    let rest = c.rest;
    if (xm) {
      x = Number(xm[1]);
      rest = blank(rest, xm.index, xm.index + xm[0].length);
    }
    if (mu && sd) {
      if (x === null) {
        const left = values(rest);
        if (left.length !== 1) return need(c, 'Which value should be standardized?');
        x = left[0]!;
      }
      if (!(sd.v > 0)) fail('The standard deviation must be positive');
      const z = (x - mu.v) / sd.v;
      const { primary, value } = primaryOf(z, 10);
      return ok(c, { expression: `z-score of ${f(x)} with mean ${f(mu.v)} and SD ${f(sd.v)}`, primary, value, lines: [{ label: 'Formula', display: 'z = (x − μ) / σ' }], notes });
    }
    const inIdx = rest.search(/\b(?:in|among|within|from|relative to|compared to)\b/);
    const xs = values(inIdx >= 0 ? rest.slice(inIdx) : rest);
    if (x === null && inIdx >= 0) {
      const before = values(rest.slice(0, inIdx));
      if (before.length === 1) x = before[0]!;
    }
    if (x === null) return need(c, 'Which value should be standardized? (e.g. "z-score of 85 in 70, 80, 90")');
    if (xs.length < 2) return need(c, 'Give the data set or the mean and standard deviation (e.g. "with mean 80 and sd 5")');
    const dx = xs.map((v) => new D(v));
    const m = dmean(dx);
    const s = dvar(dx, !population).sqrt();
    if (s.isZero()) fail('All values are equal, so the standard deviation is 0');
    const z = new D(x).minus(m).div(s);
    const { primary, value } = primaryOf(z, 10);
    notes.push(population ? 'Population standard deviation (divides by n)' : 'Sample standard deviation (divides by n − 1); say “population” to divide by n');
    return ok(c, {
      expression: `z-score of ${f(x)} within ${xs.length} values`,
      primary,
      value,
      lines: [{ label: 'Mean', display: fd(m) }, { label: population ? 'Population SD' : 'Sample SD', display: fd(s) }, { label: 'Formula', display: 'z = (x − mean) / SD' }],
      notes,
    });
  }

  let p: number | null = null;
  if (stat === 'percentile') {
    const m = new RegExp(`(${NUM})\\s*(?:st|nd|rd|th|%)?\\s*percentile`).exec(c.rest) ?? new RegExp(`percentile\\s*(?:=|:)?\\s*(${NUM})`).exec(c.rest);
    if (!m) return need(c, 'Which percentile? (e.g. "90th percentile of …")');
    p = Number(m[1]) / 100;
    if (!(p >= 0 && p <= 1)) fail('A percentile must be between 0 and 100');
    c.rest = blank(c.rest, m.index, m.index + m[0].length);
  }

  const xs = data(c);
  if (!xs) return null;
  if (xs.length === 0) return need(c, `Which numbers? (e.g. "${stat === 'summary' ? 'summary of' : (LABEL[stat] ?? stat).toLowerCase() + ' of'} 3, 5, 7, 10")`);
  // A single number after a keyword ("range of 300 miles", "max 5") is not a statistics question.
  if (xs.length < 2 && !['sd', 'variance', 'skewness', 'kurtosis'].includes(stat)) return null;
  const n = xs.length;
  const sorted = [...xs].sort((a, b) => a.comparedTo(b));
  const fl = xs.map((x) => x.toNumber());
  const needN = (k: number, what: string) => {
    if (n < k) fail(`${what} needs at least ${k} values`);
  };
  const sdNote = population ? 'Population (divides by n)' : 'Sample (divides by n − 1); say “population” to divide by n';
  const desc = (what: string) => `${what} of ${n} value${n === 1 ? '' : 's'}`;
  const one = (v: Dec, expression: string, lines: { label: string; display: string }[] = []) => {
    const { primary, value } = primaryOf(v, 12);
    return ok(c, { expression, primary, value, lines, notes });
  };

  switch (stat) {
    case 'summary': {
      const mean = dmean(xs);
      const [q1, q2, q3] = dquartiles(sorted);
      const rows: [string, string][] = [
        ['Count', String(n)],
        ['Sum', fd(dsum(xs))],
        ['Mean', fd(mean)],
        ['Median', fd(q2)],
        ['Mode', (() => { const m = modes(xs); return m.length ? list(m) : 'none'; })()],
        ['Minimum', fd(sorted[0]!)],
        ['Maximum', fd(sorted[n - 1]!)],
        ['Range', fd(sorted[n - 1]!.minus(sorted[0]!))],
        ['Q1', fd(q1)],
        ['Q3', fd(q3)],
        ['IQR', fd(q3.minus(q1))],
      ];
      if (n >= 2) {
        rows.push(['Sample std dev', fd(dvar(xs, true).sqrt())], ['Sample variance', fd(dvar(xs, true))]);
      }
      rows.push(['Population std dev', fd(dvar(xs, false).sqrt())], ['Population variance', fd(dvar(xs, false))]);
      if (n >= 3) rows.push(['Skewness', f(skewness(fl), 8)]);
      if (n >= 4) rows.push(['Excess kurtosis', f(kurtosis(fl), 8)]);
      notes.push(QUARTILE_NOTE, 'Skewness and kurtosis are the bias-adjusted sample versions (Excel SKEW / KURT)');
      const { primary, value } = primaryOf(mean, 12);
      return ok(c, {
        expression: `Summary statistics of ${n} values`,
        primary: { ...primary, display: primary.display, spoken: `mean ${primary.spoken}` },
        value,
        lines: [{ label: 'Mean', display: fd(mean) }],
        table: { columns: ['Statistic', 'Value'], rows: rows.map((r) => [...r]), caption: `Data: ${list(xs)}` },
        notes,
      });
    }
    case 'percentile': {
      notes.push(PERCENTILE_NOTE);
      return one(dpercentile(sorted, p!), desc(`${f(p! * 100)}th percentile`));
    }
    case 'quartiles': {
      const [q1, q2, q3] = dquartiles(sorted);
      notes.push(QUARTILE_NOTE);
      const v = `${fd(q1)}, ${fd(q2)}, ${fd(q3)}`;
      if (/\bq1\b|first quartile|lower quartile/.test(c.s)) return one(q1, desc('First quartile (Q1)'), [{ label: 'Q3', display: fd(q3) }]);
      if (/\bq3\b|third quartile|upper quartile/.test(c.s)) return one(q3, desc('Third quartile (Q3)'), [{ label: 'Q1', display: fd(q1) }]);
      return ok(c, {
        expression: desc('Quartiles'),
        primary: { display: v, plain: v.replace(/,(?=\d)/g, ''), spoken: `Q1 ${fd(q1)}, median ${fd(q2)}, Q3 ${fd(q3)}` },
        lines: [{ label: 'Q1', display: fd(q1) }, { label: 'Median (Q2)', display: fd(q2) }, { label: 'Q3', display: fd(q3) }, { label: 'IQR', display: fd(q3.minus(q1)) }],
        notes,
      });
    }
    case 'iqr': {
      const [q1, , q3] = dquartiles(sorted);
      notes.push(QUARTILE_NOTE);
      return one(q3.minus(q1), desc('Interquartile range'), [{ label: 'Q1', display: fd(q1) }, { label: 'Q3', display: fd(q3) }]);
    }
    case 'sd':
    case 'variance': {
      if (!population) needN(2, stat === 'sd' ? 'A sample standard deviation' : 'A sample variance');
      notes.push(sdNote);
      const v = dvar(xs, !population);
      const what = `${population ? 'Population' : 'Sample'} ${stat === 'sd' ? 'standard deviation' : 'variance'}`;
      return stat === 'sd'
        ? one(v.sqrt(), desc(what), [{ label: 'Mean', display: fd(dmean(xs)) }, { label: 'Variance', display: fd(v) }])
        : one(v, desc(what), [{ label: 'Mean', display: fd(dmean(xs)) }, { label: 'Standard deviation', display: fd(v.sqrt()) }]);
    }
    case 'skewness': {
      needN(3, 'Skewness');
      notes.push('Bias-adjusted sample skewness G1 (Excel SKEW)');
      return one(new D(skewness(fl)).toSignificantDigits(10), desc('Skewness'));
    }
    case 'kurtosis': {
      needN(4, 'Kurtosis');
      notes.push('Bias-adjusted sample excess kurtosis G2 (Excel KURT); a normal distribution has 0');
      return one(new D(kurtosis(fl)).toSignificantDigits(10), desc('Excess kurtosis'));
    }
    case 'median':
      return one(dmedian(sorted), desc('Median'));
    case 'mode': {
      const m = modes(xs);
      if (!m.length) {
        return ok(c, { expression: desc('Mode'), primary: { display: 'No mode', plain: 'none', spoken: 'no mode, every value appears once' }, notes: ['Every value appears exactly once'] });
      }
      if (m.length > 1) notes.push(`${m.length} values tie for most frequent`);
      const shown = list(m);
      const { value } = primaryOf(m[0]!, 12);
      return ok(c, { expression: desc('Mode'), primary: { display: shown, plain: m.map((x) => x.toString()).join(', '), spoken: m.map((x) => x.toString()).join(' and ') }, value, notes });
    }
    case 'geomean': {
      if (xs.some((x) => x.lte(0))) fail('The geometric mean needs positive values');
      return one(D.exp(dsum(xs.map((x) => x.ln())).div(n)), desc('Geometric mean'));
    }
    case 'harmean': {
      if (xs.some((x) => x.lte(0))) fail('The harmonic mean needs positive values');
      return one(new D(n).div(dsum(xs.map((x) => new D(1).div(x)))), desc('Harmonic mean'));
    }
    case 'mean':
      return one(dmean(xs), desc('Mean'), [{ label: 'Sum', display: fd(dsum(xs)) }, { label: 'Count', display: String(n) }]);
    case 'range':
      return one(sorted[n - 1]!.minus(sorted[0]!), desc('Range'), [{ label: 'Minimum', display: fd(sorted[0]!) }, { label: 'Maximum', display: fd(sorted[n - 1]!) }]);
    case 'sum':
      return one(dsum(xs), desc('Sum'));
    case 'count':
      return one(new D(n), `Count of ${n} values`);
    case 'min':
      return one(sorted[0]!, desc('Minimum'));
    case 'max':
      return one(sorted[n - 1]!, desc('Maximum'));
  }
  return null;
}

