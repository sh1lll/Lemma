import { D, type AnswerResult } from '@lemma/math-core';
import { blank, f, fail, need, NUM, ok, pctOf, primaryOf, prob, take, type Ctx } from './common';
import { data, dquartiles } from './descriptive';
import { MEAN_NAMES, normal, parseEvent, SD_NAMES } from './distributions';
import { readPairs } from './paired';
import type { StatPlot } from './plot';
import { normCdf, normSf } from './special';

/**
 * Statistical plots: histogram, box plot, dot plot, scatter plot and the normal curve with a shaded area.
 * Each answers in text (counts, five-number summary, probability) and carries the chart as Answer.plot.
 */

export const PLOT_WORDS =
  /\bhistogram\b|\bbox(?:[- ]and[- ]whiskers?)?[- ]?plot\b|\bboxplot\b|\bbox and whiskers?\b|\bdot ?plot\b|\bscatter ?(?:plot|graph|chart|diagram)?\b|\bscatterplot\b|\bnormal (?:curve|graph|plot)\b|\bbell curve\b|\bshade\b/;

/** 1, 2 or 5 × 10^k, at least `raw`. */
function niceUp(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}
const tidy = (x: number) => Number(x.toPrecision(12));

/**
 * Bins for a histogram. Small-range whole numbers get one bar per value (centred on it); otherwise Sturges'
 * rule picks the bin count and the width is rounded up to a "nice" 1, 2 or 5 × 10^k. Bins are [a, b) except
 * the last, which also holds its right edge.
 */
export function histogramBins(xs: number[], opts: { bins?: number; width?: number } = {}): { edges: number[]; counts: number[]; discrete: boolean } {
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const discrete = !opts.bins && !opts.width && xs.every(Number.isInteger) && hi - lo <= 30;
  let start: number;
  let width: number;
  let k: number;
  if (discrete) {
    start = lo - 0.5;
    width = 1;
    k = hi - lo + 1;
  } else if (hi === lo) {
    width = opts.width ?? niceUp(Math.max(Math.abs(lo) * 0.1, 1e-9));
    start = lo - width / 2;
    k = 1;
  } else {
    width = opts.width ?? niceUp((hi - lo) / (opts.bins ?? Math.ceil(Math.log2(xs.length) + 1)));
    if (opts.bins && !opts.width) width = (hi - lo) / opts.bins;
    start = opts.bins && !opts.width ? lo : Math.floor(lo / width) * width;
    k = Math.max(1, Math.ceil(tidy((hi - start) / width)));
  }
  if (k > 200) fail(`That makes ${k} bins; use a wider bin width (at most 200 bins)`);
  const edges = Array.from({ length: k + 1 }, (_, i) => tidy(start + i * width));
  const counts = new Array<number>(k).fill(0);
  for (const x of xs) {
    const i = Math.min(k - 1, Math.max(0, Math.floor(tidy((x - start) / width))));
    counts[i]!++;
  }
  return { edges, counts, discrete };
}

/** Five-number summary with Tukey fences: whiskers reach the furthest values within 1.5 × IQR of the box. */
export function boxStats(xs: number[]): { min: number; q1: number; median: number; q3: number; max: number; lo: number; hi: number; outliers: number[] } {
  const sorted = [...xs].sort((a, b) => a - b);
  const [q1, median, q3] = dquartiles(sorted.map((x) => new D(x))).map((d) => d.toNumber()) as [number, number, number];
  const iqr = q3 - q1;
  const fenceLo = q1 - 1.5 * iqr;
  const fenceHi = q3 + 1.5 * iqr;
  const inside = sorted.filter((x) => x >= fenceLo && x <= fenceHi);
  return {
    min: sorted[0]!,
    q1,
    median,
    q3,
    max: sorted[sorted.length - 1]!,
    lo: inside[0] ?? q1,
    hi: inside[inside.length - 1] ?? q3,
    outliers: sorted.filter((x) => x < fenceLo || x > fenceHi),
  };
}

const list = (xs: number[]) => xs.map((x) => f(x, 8)).join(', ');

function numbers(c: Ctx, what: string, example: string): number[] {
  const xs = data(c);
  if (!xs || xs.length === 0) throw need(c, `Which numbers? (e.g. "${example}")`);
  if (xs.length < 2) fail(`A ${what} needs at least 2 values`);
  return xs.map((x) => x.toNumber());
}

function histogram(c: Ctx): AnswerResult {
  const consume = (re: RegExp) => {
    const m = re.exec(c.rest);
    if (!m) return null;
    c.rest = blank(c.rest, m.index, m.index + m[0].length);
    return Number(m[1]);
  };
  const width = consume(new RegExp(`\\b(?:with\\s+)?(?:a\\s+)?(?:bin|class|bucket)?\\s*(?:width|size)\\s*(?:of|=|:)?\\s*(${NUM})`));
  const bins = consume(/\b(?:with\s+|in(?:to)?\s+|using\s+)?(\d+)\s+(?:bins?|classes|buckets|bars|intervals)\b/);
  if (width !== null && !(width > 0)) fail('The bin width must be positive');
  if (bins !== null && !(bins >= 1)) fail('Use at least one bin');
  const xs = numbers(c, 'histogram', 'histogram of 2, 3, 3, 5, 7, 8');
  const { edges, counts, discrete } = histogramBins(xs, { bins: bins ?? undefined, width: width ?? undefined });
  const n = xs.length;
  const k = counts.length;
  const w = tidy(edges[1]! - edges[0]!);
  const label = (i: number) => (discrete ? f(edges[i]! + 0.5) : `${f(edges[i]!)} to ${f(edges[i + 1]!)}`);
  let top = 0;
  counts.forEach((v, i) => v > counts[top]! && (top = i));
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const plot: StatPlot = {
    type: 'histogram',
    edges,
    counts,
    summary: `Histogram of ${n} values in ${k} ${discrete ? 'bars, one per value' : `bins of width ${f(w)}`}, from ${f(edges[0]!)} to ${f(edges[k]!)}. ` +
      `The tallest bar is ${label(top)} with ${counts[top]} value${counts[top] === 1 ? '' : 's'}.`,
    xLabel: 'value',
    yLabel: 'count',
  };
  return ok(c, {
    expression: `Histogram of ${n} values · ${discrete ? 'one bar per value' : `${k} bins of width ${f(w)}`}`,
    primary: { display: `${k} ${discrete ? 'bars' : 'bins'}`, plain: String(k), spoken: `${k} ${discrete ? 'bars' : 'bins'}` },
    lines: [
      { label: 'Tallest bar', display: `${label(top)} (${counts[top]})` },
      { label: 'Mean', display: f(mean, 10) },
      { label: 'Range', display: `${f(Math.min(...xs))} to ${f(Math.max(...xs))}` },
      { label: 'n', display: String(n) },
    ],
    table: {
      columns: [discrete ? 'Value' : 'Bin', 'Count', 'Share'],
      rows: counts.map((v, i) => [discrete ? label(i) : `[${f(edges[i]!)}, ${f(edges[i + 1]!)}${i === k - 1 ? ']' : ')'}`, String(v), pctOf(v / n, 3)]),
      highlightRow: top,
      caption: 'Frequency table',
    },
    notes: discrete ? [] : [`Bins include their left edge; the last also includes its right edge${bins === null && width === null ? ". Say \"with 5 bins\" or \"bin width 10\" to change them" : ''}`],
    plot,
  });
}

function boxPlot(c: Ctx): AnswerResult {
  const xs = numbers(c, 'box plot', 'box plot of 1, 3, 4, 5, 7, 20');
  const b = boxStats(xs);
  const iqr = b.q3 - b.q1;
  const { primary, value } = primaryOf(b.median, 10);
  const plot: StatPlot = {
    type: 'box',
    ...b,
    summary: `Box plot of ${xs.length} values: minimum ${f(b.min)}, first quartile ${f(b.q1)}, median ${f(b.median)}, third quartile ${f(b.q3)}, maximum ${f(b.max)}. ` +
      (b.outliers.length ? `${b.outliers.length} outlier${b.outliers.length === 1 ? '' : 's'}: ${list(b.outliers)}.` : 'No outliers.'),
    xLabel: 'value',
  };
  return ok(c, {
    expression: `Box plot of ${xs.length} values · median`,
    primary,
    value,
    lines: [
      { label: 'Minimum', display: f(b.min, 10) },
      { label: 'Q1', display: f(b.q1, 10) },
      { label: 'Median', display: f(b.median, 10) },
      { label: 'Q3', display: f(b.q3, 10) },
      { label: 'Maximum', display: f(b.max, 10) },
      { label: 'IQR', display: f(iqr, 10) },
      { label: 'Outliers', display: b.outliers.length ? list(b.outliers) : 'none' },
    ],
    notes: ['Quartiles are medians of the lower and upper halves; whiskers reach the furthest values within 1.5 × IQR of the box, and points beyond are outliers'],
    plot,
  });
}

function dotPlot(c: Ctx): AnswerResult {
  const xs = numbers(c, 'dot plot', 'dot plot of 1, 2, 2, 3, 3, 3, 5');
  const tally = new Map<number, number>();
  for (const x of xs) tally.set(x, (tally.get(x) ?? 0) + 1);
  const keys = [...tally.keys()].sort((a, b) => a - b);
  if (keys.length > 200) fail('A dot plot of more than 200 different values is unreadable; try a histogram');
  const counts = keys.map((k) => tally.get(k)!);
  const most = Math.max(...counts);
  const modes = keys.filter((k) => tally.get(k) === most);
  const sorted = [...xs].sort((a, b) => a - b);
  const n = xs.length;
  const median = n % 2 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
  const plot: StatPlot = {
    type: 'dot',
    values: keys,
    counts,
    summary: `Dot plot of ${n} values across ${keys.length} distinct values from ${f(keys[0]!)} to ${f(keys[keys.length - 1]!)}. ` +
      `The tallest stack is ${list(modes)} with ${most} dot${most === 1 ? '' : 's'}.`,
    xLabel: 'value',
    yLabel: 'count',
  };
  return ok(c, {
    expression: `Dot plot of ${n} values`,
    primary: { display: `${n} dots`, plain: String(n), spoken: `${n} dots` },
    lines: [
      { label: most > 1 && modes.length > 1 ? 'Modes' : 'Mode', display: most > 1 ? list(modes) : 'none (every value appears once)' },
      { label: 'Median', display: f(median, 10) },
      { label: 'Range', display: `${f(keys[0]!)} to ${f(keys[keys.length - 1]!)}` },
    ],
    table: { columns: ['Value', 'Count'], rows: keys.map((k, i) => [f(k, 10), String(counts[i])]), caption: 'Tally' },
    notes: [],
    plot,
  });
}

function scatter(c: Ctx): AnswerResult {
  const pairs = readPairs(c);
  if (!pairs) return need(c, 'Give the points, e.g. "scatter plot (1, 2) (2, 4) (3, 5)" or "scatter plot x: 1, 2, 3 y: 2, 4, 5"');
  const { xs, ys } = pairs;
  if (xs.length !== ys.length) fail(`x has ${xs.length} values but y has ${ys.length}`);
  const n = xs.length;
  if (n < 2) fail('A scatter plot needs at least 2 points');
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  xs.forEach((x, i) => {
    sxx += (x - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
    sxy += (x - mx) * (ys[i]! - my);
  });
  const r = sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
  const points: number[] = [];
  xs.forEach((x, i) => points.push(x, ys[i]!));
  const strength = Number.isNaN(r) ? '' : Math.abs(r) >= 0.8 ? 'strong' : Math.abs(r) >= 0.5 ? 'moderate' : Math.abs(r) >= 0.2 ? 'weak' : 'little or no';
  const trend = Number.isNaN(r) ? '' : ` ${strength[0]!.toUpperCase()}${strength.slice(1)} ${Math.abs(r) >= 0.2 ? (r > 0 ? 'positive' : 'negative') + ' ' : ''}linear association (r = ${f(r, 4)}).`;
  const plot: StatPlot = {
    type: 'scatter',
    points,
    summary: `Scatter plot of ${n} points, x from ${f(Math.min(...xs))} to ${f(Math.max(...xs))}, y from ${f(Math.min(...ys))} to ${f(Math.max(...ys))}.${trend}`,
    xLabel: 'x',
    yLabel: 'y',
  };
  const notes = ['Say "fit a line to …" or "quadratic regression of …" to add a fitted curve'];
  if (Number.isNaN(r)) {
    return ok(c, { expression: `Scatter plot of ${n} points`, primary: { display: `${n} points`, plain: String(n), spoken: `${n} points` }, lines: [{ label: 'r', display: 'undefined (no spread in x or y)' }], notes, plot });
  }
  const { primary, value } = primaryOf(r, 10);
  return ok(c, {
    expression: `Scatter plot of ${n} points · correlation r`,
    primary,
    value,
    lines: [{ label: 'r²', display: f(r * r, 10) }, { label: 'Association', display: `${strength}${Math.abs(r) >= 0.2 ? `, ${r > 0 ? 'positive' : 'negative'}` : ''}` }, { label: 'n', display: String(n) }],
    notes,
    plot,
  });
}

function normalCurve(c: Ctx): AnswerResult | null {
  // Parameters and event read from a scratch copy; the text answer comes from the normal-distribution handler.
  const scratch: Ctx = { ...c, rest: c.s };
  const meanP = take(scratch, MEAN_NAMES);
  let sd = take(scratch, SD_NAMES)?.v ?? null;
  if (sd === null) {
    const v = take(scratch, 'variance|var');
    if (v) sd = Math.sqrt(v.v);
  }
  const e = parseEvent(scratch);
  const mu = meanP?.v ?? (sd === null ? 0 : null);
  const sigma = sd ?? (meanP ? null : 1);
  if (mu === null) return need(c, 'What is the mean? (or say “standard normal”)');
  if (sigma === null) return need(c, 'What is the standard deviation?');
  if (!(sigma > 0)) fail('The standard deviation must be positive');
  const standard = mu === 0 && sigma === 1;
  const v = standard ? 'Z' : 'X';
  const dist = standard ? 'Standard normal' : `Normal(μ = ${f(mu)}, σ = ${f(sigma)})`;

  if (!e) {
    const plot: StatPlot = {
      type: 'normal', mean: mu, sd: sigma, lo: null, hi: null, area: null, label: dist,
      summary: `${dist} curve: bell-shaped, centred on ${f(mu)}. About 68% of the area lies between ${f(mu - sigma)} and ${f(mu + sigma)}, and 95% between ${f(mu - 2 * sigma)} and ${f(mu + 2 * sigma)}.`,
      xLabel: standard ? 'z' : 'x',
    };
    return ok(c, {
      expression: `Normal curve · ${dist}`,
      primary: { display: `μ = ${f(mu)}, σ = ${f(sigma)}`, plain: `mean ${f(mu)}, sd ${f(sigma)}`, spoken: `mean ${f(mu)}, standard deviation ${f(sigma)}` },
      lines: [
        { label: '68% between', display: `${f(mu - sigma)} and ${f(mu + sigma)}` },
        { label: '95% between', display: `${f(mu - 2 * sigma)} and ${f(mu + 2 * sigma)}` },
        { label: '99.7% between', display: `${f(mu - 3 * sigma)} and ${f(mu + 3 * sigma)}` },
      ],
      notes: ['Say "shade above 130" or "shade P(85 < X < 115)" to shade an area'],
      plot,
    });
  }
  if (e.lo === e.hi) fail('A single value has no area under a continuous curve; shade a range such as "above 130"');

  const answer = normal(c);
  if (!answer || !answer.ok) return answer;
  const z = (x: number) => (x - mu) / sigma;
  const lo = Number.isFinite(e.lo) ? e.lo : null;
  const hi = Number.isFinite(e.hi) ? e.hi : null;
  const area = lo === null ? normCdf(z(hi!)) : hi === null ? normSf(z(lo)) : Math.max(0, normCdf(z(hi)) - normCdf(z(lo)));
  const ev = lo === null ? `${v} < ${f(hi!)}` : hi === null ? `${v} > ${f(lo)}` : `${f(lo)} < ${v} < ${f(hi)}`;
  const label = `P(${ev}) = ${prob(area, 6)}`;
  const where = lo === null ? `below ${f(hi!)}` : hi === null ? `above ${f(lo)}` : `between ${f(lo)} and ${f(hi)}`;
  answer.plot = {
    type: 'normal', mean: mu, sd: sigma, lo, hi, area, label,
    summary: `${dist} curve with the area ${where} shaded. The shaded area is ${prob(area, 6)}, or ${pctOf(area, 4)} of the total.`,
    xLabel: standard ? 'z' : 'x',
  } satisfies StatPlot;
  return answer;
}

/** The plot handler: claims inputs naming a plot (and "shade …" on a normal curve). */
export function plots(c: Ctx): AnswerResult | null {
  if (!PLOT_WORDS.test(c.s)) return null;
  try {
    if (/\bhistogram\b/.test(c.s)) return histogram(c);
    if (/\bbox(?:[- ]and[- ]whiskers?)?[- ]?plot\b|\bboxplot\b|\bbox and whiskers?\b/.test(c.s)) return boxPlot(c);
    if (/\bdot ?plot\b/.test(c.s)) return dotPlot(c);
    if (/\bnormal\b|\bbell\b|\bgaussian\b|\bz\b|\bshade\b/.test(c.s) && !/\bscatter/.test(c.s)) {
      if (/\b(?:binom\w*|poisson|uniform|exponential|geometric)\b/.test(c.s)) fail('Shading is available on the normal curve; for other distributions, ask for the probability');
      return normalCurve(c);
    }
    // A scatter plot with a fit is the regression's plot (points plus the fitted curve).
    if (/\bscatter/.test(c.s) && !/\bfit\w*|\bregress\w*|\btrend ?line\b|\bleast[- ]squares\b/.test(c.s)) return scatter(c);
  } catch (e) {
    // numbers() reports a missing list as a question, not an error.
    if (e && typeof e === 'object' && 'ok' in e) return e as AnswerResult;
    throw e;
  }
  return null;
}
