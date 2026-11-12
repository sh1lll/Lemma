import { normCdf, normInv, normPdf, tCdf, tInv, tPdf } from '@lemma/stats-engine/src/special';
import type { GraphItem } from './spec';

/**
 * Inference rows: one-sample t and z, two-sample t (Welch), one-proportion z, each as a test or an interval.
 * The distribution functions come from the statistics engine. Results include drawable items: the distribution
 * curve with the rejection region (a test) or the confidence interval (an interval) shaded.
 */

export type InferTest = 't1' | 'z1' | 't2' | 'p1';
export type Alt = 'ne' | 'lt' | 'gt';

export interface InferInput {
  test: InferTest;
  mode: 'test' | 'interval';
  /** Raw data (overrides the summary numbers when given). */
  data?: number[];
  data2?: number[];
  mean?: number;
  sd?: number;
  n?: number;
  mean2?: number;
  sd2?: number;
  n2?: number;
  /** Successes, for a proportion. */
  x?: number;
  /** Known population σ, for a z test. */
  sigma?: number;
  /** Hypothesised value (μ₀, p₀, or the difference μ₁ − μ₂). */
  h0: number;
  alt: Alt;
  /** Confidence level, 0–1. */
  level: number;
}

export interface InferResult {
  statName: 't' | 'z';
  stat: number;
  df?: number;
  p?: number;
  ci?: [number, number];
  estimate: number;
  se: number;
  /** Lines for the row ("t = 2.31", "p = 0.034", …). */
  lines: [string, string][];
  /** One sentence for screen readers. */
  summary: string;
}

const fmt = (v: number, d = 4) => (Number.isFinite(v) ? String(Number(v.toPrecision(d))) : '—');

function describe(xs: number[]): { mean: number; sd: number; n: number } {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : NaN;
  return { mean, sd, n };
}

export function infer(inp: InferInput): InferResult {
  const level = Math.min(0.9999, Math.max(0.5, inp.level));
  let est: number;
  let se: number;
  let df: number | undefined;
  let statName: 't' | 'z' = 't';
  let seTest: number;
  if (inp.test === 'p1') {
    const n = inp.n ?? NaN;
    const x = inp.x ?? NaN;
    if (!(n > 0) || !(x >= 0) || x > n) throw new Error('Enter the successes x and the sample size n (x ≤ n)');
    est = x / n;
    se = Math.sqrt((est * (1 - est)) / n);
    seTest = Math.sqrt((inp.h0 * (1 - inp.h0)) / n);
    statName = 'z';
    if (inp.mode === 'test' && !(inp.h0 > 0 && inp.h0 < 1)) throw new Error('p₀ must be between 0 and 1');
  } else if (inp.test === 't2') {
    const a = inp.data?.length ? describe(inp.data) : { mean: inp.mean ?? NaN, sd: inp.sd ?? NaN, n: inp.n ?? NaN };
    const b = inp.data2?.length ? describe(inp.data2) : { mean: inp.mean2 ?? NaN, sd: inp.sd2 ?? NaN, n: inp.n2 ?? NaN };
    if (!(a.n > 1 && b.n > 1) || !(a.sd >= 0 && b.sd >= 0) || !Number.isFinite(a.mean + b.mean)) throw new Error('Each sample needs a mean, a standard deviation and n ≥ 2');
    const va = (a.sd * a.sd) / a.n;
    const vb = (b.sd * b.sd) / b.n;
    est = a.mean - b.mean;
    se = seTest = Math.sqrt(va + vb);
    df = (va + vb) ** 2 / ((va * va) / (a.n - 1) + (vb * vb) / (b.n - 1));
  } else {
    const d = inp.data?.length ? describe(inp.data) : { mean: inp.mean ?? NaN, sd: inp.sd ?? NaN, n: inp.n ?? NaN };
    if (inp.test === 'z1') {
      const sigma = inp.sigma ?? d.sd;
      if (!(d.n > 0) || !(sigma > 0) || !Number.isFinite(d.mean)) throw new Error('Enter the mean, σ and n');
      est = d.mean;
      se = seTest = sigma / Math.sqrt(d.n);
      statName = 'z';
    } else {
      if (!(d.n > 1) || !(d.sd >= 0) || !Number.isFinite(d.mean)) throw new Error('Enter the mean, the standard deviation and n (n ≥ 2)');
      est = d.mean;
      se = seTest = d.sd / Math.sqrt(d.n);
      df = d.n - 1;
    }
  }
  const cdf = (v: number) => (statName === 'z' ? normCdf(v) : tCdf(v, df!));
  const inv = (p: number) => (statName === 'z' ? normInv(p) : tInv(p, df!));
  const lines: [string, string][] = [];
  const what = inp.test === 'p1' ? 'p̂' : inp.test === 't2' ? 'x̄₁ − x̄₂' : 'x̄';
  lines.push([what, fmt(est, 6)]);
  if (inp.mode === 'test') {
    const stat = (est - inp.h0) / seTest;
    const p = inp.alt === 'lt' ? cdf(stat) : inp.alt === 'gt' ? 1 - cdf(stat) : 2 * Math.min(cdf(stat), 1 - cdf(stat));
    lines.push([statName, fmt(stat)]);
    if (df !== undefined) lines.push(['df', fmt(df, 5)]);
    lines.push(['p', fmt(p)]);
    const sig = p < 1 - level;
    const summary = `${statName} = ${fmt(stat)}${df !== undefined ? ` with ${fmt(df, 5)} degrees of freedom` : ''}, p-value ${fmt(p)}: ${sig ? 'significant' : 'not significant'} at the ${fmt((1 - level) * 100, 3)}% level.`;
    return { statName, stat, df, p, estimate: est, se, lines, summary };
  }
  const crit = inv(1 - (1 - level) / 2);
  const ci: [number, number] = [est - crit * se, est + crit * se];
  lines.push(['interval', `(${fmt(ci[0], 6)}, ${fmt(ci[1], 6)})`]);
  lines.push([`${statName}*`, fmt(crit)]);
  if (df !== undefined) lines.push(['df', fmt(df, 5)]);
  return { statName, stat: crit, df, ci, estimate: est, se, lines, summary: `${fmt(level * 100, 3)}% confidence interval from ${fmt(ci[0], 6)} to ${fmt(ci[1], 6)}.` };
}

/** Items to draw: the curve and the shaded region(s). Tests use the statistic's scale; intervals the estimate's. */
export function inferItems(id: number, inp: InferInput, r: InferResult): { items: GraphItem[]; view: { xMin: number; xMax: number; yMin: number; yMax: number } } {
  const pdf = (v: number) => (r.statName === 'z' ? normPdf(v) : tPdf(v, r.df!));
  if (inp.mode === 'test') {
    const f = (e: Record<string, number>) => pdf(e.x ?? NaN);
    const s = Math.abs(r.stat);
    const span = Math.max(4, s + 1);
    const items: GraphItem[] = [{ kind: 'explicit', id, label: `${r.statName} distribution`, f }];
    const tail = (from: number, to: number) => items.push({ kind: 'shade', id, label: 'p-value region', f, from, to });
    if (inp.alt === 'lt') tail(-Infinity, r.stat);
    else if (inp.alt === 'gt') tail(r.stat, Infinity);
    else {
      tail(-Infinity, -s);
      tail(s, Infinity);
    }
    const top = pdf(0);
    return { items, view: { xMin: -span, xMax: span, yMin: -top * 0.15, yMax: top * 1.35 } };
  }
  const f = (e: Record<string, number>) => pdf(((e.x ?? NaN) - r.estimate) / r.se) / r.se;
  const [lo, hi] = r.ci!;
  const half = Math.max(hi - lo, r.se * 8) * 0.75;
  const top = pdf(0) / r.se;
  return {
    items: [
      { kind: 'explicit', id, label: 'sampling distribution', f },
      { kind: 'shade', id, label: 'confidence interval', f, from: lo, to: hi },
    ],
    view: { xMin: r.estimate - half, xMax: r.estimate + half, yMin: -top * 0.15, yMax: top * 1.35 },
  };
}
