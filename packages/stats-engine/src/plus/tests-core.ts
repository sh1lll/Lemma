/**
 * Building blocks for the TESTS area: input cleaning, group parsing, tails, exact null distributions and the
 * noncentral t used for power.
 */
import { normCdf, normSf, tInv, tTail } from '../special';
import { lnGamma, pastedTable, rawNums, labelledColumns, bracketLists, nums, type Column, type PCtx, type Tail } from './util';

/** Removes parameters that carry digits but are not data (alpha, confidence, "two-way", seeds …). */
export function dataText(s: string): string {
  return s
    .replace(/\b(?:alpha|significance(?: level)?|level of significance|sig\.? level)\s*(?:=|:|of|is|at)?\s*\d*\.?\d+\s*%?/g, ' ')
    .replace(/\b(?:at|with) (?:the |a )?\d*\.?\d+\s*%?\s*(?:significance|level)\b/g, ' ')
    .replace(/\d*\.?\d+\s*%\s*(?:confidence|conf\b|ci\b|level|interval)?/g, ' ')
    .replace(/\bconfidence(?: level)?\s*(?:=|:|of|is)?\s*\d*\.?\d+/g, ' ')
    .replace(/\b(?:one|two|1|2|k)[- ](?:way|sample|sided|tailed|tail)\b/g, ' ')
    .replace(/\b2\s*(?:x|×|by)\s*2\b/g, ' ')
    .replace(/\b[ftuh][- ]?test\b/g, ' ')
    .replace(/\btype (?:i{1,2}|1|2)\b/g, ' ')
    .replace(/\b(?:seed|resamples|replicates|replications|iterations)\s*(?:=|:)?\s*\d+/g, ' ');
}

export function tailFor(s: string): { tail: Tail; stated: boolean } {
  const alt = /\balternative\s*(?:=|:|is)?\s*["']?(greater|less|two)/.exec(s);
  if (alt) return { tail: alt[1] === 'greater' ? 'greater' : alt[1] === 'less' ? 'less' : 'two', stated: true };
  if (/\b(?:less|smaller|left[- ]tailed|lower[- ]tailed|lower[- ]tail|decrease[sd]?)\b/.test(s)) return { tail: 'less', stated: true };
  if (/\b(?:greater|larger|right[- ]tailed|upper[- ]tailed|upper[- ]tail|increase[sd]?)\b|\b(?:one|1)[- ](?:sided|tailed)\b/.test(s)) return { tail: 'greater', stated: true };
  return { tail: 'two', stated: /\b(?:two|2)[- ](?:sided|tailed)\b/.test(s) };
}

export const H1SYM: Record<Tail, string> = { two: '≠', greater: '>', less: '<' };

const INSTR = /^.*\b(?:anova|analysis of variance|tests?|alpha|cronbach'?s?|kaplan|meier|variances?|independence|homogeneity|contingency|kruskal|wallis|whitney|wilcoxon|table|survival|replication|levene|bartlett|correlation|spearman|kendall|tau)\b[^\d.\-]*/;

/** Drops a leading instruction line ("anova", "kaplan meier") above pasted data, keeping any data on it. */
export function dataLines(raw: string): string[] {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2 && INSTR.test(lines[0]!)) {
    const rem = lines[0]!.replace(INSTR, '').replace(/^[:\s]+/, '').trim();
    if (rawNums(rem).length) lines[0] = rem;
    else lines.shift();
  }
  return lines;
}

/**
 * Groups for k-sample tests. A pasted table with a header row gives one group per column; lines without a header
 * give one group per line; otherwise labelled lists ("a: 1 2 3 b: …"), brackets, or lists split by ; | vs and.
 */
export function groupsFor(c: PCtx, min = 2): Column[] {
  const text = dataText(c.rest);
  if (c.raw.includes('\n')) {
    const lines = dataLines(c.raw);
    const t = pastedTable(lines.join('\n'));
    if (t && !t.columns.every((h, i) => h === `col${i + 1}`)) {
      const cols: Column[] = [];
      t.columns.forEach((name, j) => {
        const xs = t.rows.map((r) => r[j]).filter((x): x is number => typeof x === 'number');
        if (xs.length) cols.push({ name, xs });
      });
      if (cols.length >= 2) return cols;
    }
    const rows = lines
      .map((l) => {
        const m = /^([a-z][\w ]{0,20}?)\s*[:=]\s*(.*)$/.exec(l);
        return m ? { name: m[1]!.trim(), xs: rawNums(m[2]!) } : { name: '', xs: rawNums(l) };
      })
      .filter((r) => r.xs.length >= min - 1 && r.xs.length >= 1);
    if (rows.length >= 2) return rows.map((r, i) => ({ name: r.name || `group ${i + 1}`, xs: r.xs }));
  }
  const lab = labelledColumns(text).filter((col) => !/^(?:alpha|seed|median|mu|mu0|n|df)$/.test(col.name));
  if (lab.length >= 2) return lab;
  const br = bracketLists(text, 2);
  if (br.length >= 2) return br.map((xs, i) => ({ name: `group ${i + 1}`, xs }));
  for (const sep of [/\s*[;|]\s*/, /\s+(?:vs\.?|versus|against|compared (?:to|with))\s+/, /\s+and\s+/]) {
    const parts = text.split(sep).map((p) => nums(p)).filter((xs) => xs.length >= 1);
    if (parts.length >= 2 && parts.filter((xs) => xs.length >= 2).length >= 2) return parts.map((xs, i) => ({ name: `group ${i + 1}`, xs }));
  }
  return [];
}

/** Two equal-length paired samples ("x: … y: …", "before: … after: …", "a vs b", "(1,2) (3,4)…"). */
export function pairsFor(c: PCtx): [number[], number[]] | null {
  const tuples = [...c.rest.matchAll(/\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g)];
  if (tuples.length >= 3) return [tuples.map((m) => Number(m[1])), tuples.map((m) => Number(m[2]))];
  const g = groupsFor(c);
  if (g.length === 2) return [g[0]!.xs, g[1]!.xs];
  return null;
}

/** Keeps only the "last" numbers after a keyword: "median 4" → 4 and removes it from the text. */
export function takeNum(text: string, names: string): { v: number | null; rest: string } {
  const re = new RegExp(`(?:^|[^a-z0-9_])(?:${names})(?![a-z0-9_])\\s*(?:=|:|is|of|at)?\\s*(-?(?:\\d+(?:\\.\\d+)?|\\.\\d+))`);
  const m = re.exec(text);
  if (!m) return { v: null, rest: text };
  return { v: Number(m[1]), rest: text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length) };
}

// ---------- exact null distributions ----------

/** Counts of the Wilcoxon signed-rank statistic V (sum of positive ranks 1..n). */
export function signedRankCounts(n: number): number[] {
  const max = (n * (n + 1)) / 2;
  const c = new Array<number>(max + 1).fill(0);
  c[0] = 1;
  for (let r = 1; r <= n; r++) for (let s = max; s >= r; s--) c[s]! += c[s - r]!;
  return c;
}

/** Counts of the Mann–Whitney U for sample sizes m, n (no ties), indexed by U = 0..m·n. */
export function rankSumCounts(m: number, n: number): number[] {
  const N = m + n;
  const maxS = (N * (N + 1)) / 2;
  // dp[k][s]: number of k-subsets of {1..i} with sum s
  let dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(maxS + 1).fill(0));
  dp[0]![0] = 1;
  for (let i = 1; i <= N; i++) {
    const next = dp.map((r) => r.slice());
    for (let k = 1; k <= Math.min(i, m); k++) for (let s = i; s <= maxS; s++) next[k]![s]! += dp[k - 1]![s - i]!;
    dp = next;
  }
  const base = (m * (m + 1)) / 2;
  const out = new Array<number>(m * n + 1).fill(0);
  for (let s = base; s <= base + m * n; s++) out[s - base] = dp[m]![s]!;
  return out;
}

/** Exact p from integer counts of a discrete statistic (index = value). */
export function exactP(counts: number[], obs: number, tail: Tail): number {
  const tot = counts.reduce((a, b) => a + b, 0);
  let le = 0;
  let ge = 0;
  counts.forEach((cnt, v) => {
    if (v <= obs + 1e-9) le += cnt;
    if (v >= obs - 1e-9) ge += cnt;
  });
  if (tail === 'greater') return ge / tot;
  if (tail === 'less') return le / tot;
  return Math.min(1, (2 * Math.min(le, ge)) / tot);
}

// ---------- noncentral t ----------

/** P(T' > c) (upper) or P(T' < c) (lower) for noncentral t(df, ncp), by integrating over χ. */
export function nct(c: number, df: number, ncp: number, upper: boolean): number {
  if (df > 1e6) return upper ? normSf(c - ncp) : normCdf(c - ncp);
  const M = 4000;
  const hi = 1 + 12 / Math.sqrt(df) + 3;
  const h = hi / M;
  const lg = (df / 2) * Math.log(df / 2) - lnGamma(df / 2) + Math.log(2);
  let s = 0;
  for (let i = 1; i <= M; i++) {
    const u = i * h;
    const g = Math.exp(lg + (df - 1) * Math.log(u) - (df * u * u) / 2);
    const v = upper ? normSf(c * u - ncp) : normCdf(c * u - ncp);
    s += (i === M ? 1 : i % 2 ? 4 : 2) * g * v;
  }
  // u = 0 endpoint: density is 0 for df > 1; for df = 1 it is finite.
  if (df === 1) s += Math.exp(lg) * (upper ? normSf(-ncp) : normCdf(-ncp));
  return Math.min(1, Math.max(0, (s * h) / 3));
}

/** Power of a t test (both rejection tails counted for two-sided). */
export function tPower(n: number, d: number, samples: 1 | 2, alpha: number, tail: Tail): number {
  const df = (n - 1) * samples;
  const ncp = Math.sqrt(n / samples) * d;
  if (tail === 'two') {
    const c = tInv(1 - alpha / 2, df);
    return nct(c, df, ncp, true) + nct(-c, df, ncp, false);
  }
  const c = tInv(1 - alpha, df);
  return tail === 'greater' ? nct(c, df, ncp, true) : nct(-c, df, ncp, false);
}

export function tTwoSided(t: number, df: number): number {
  return Math.min(1, 2 * tTail(Math.abs(t), df));
}

/** Smallest continuous n ≥ 2 with power(n) ≥ target, by bisection (power increases with n). */
export function solveN(power: (n: number) => number, target: number, lo = 2): number {
  let hi = lo;
  while (power(hi) < target) {
    hi *= 2;
    if (hi > 1e8) return Infinity;
  }
  let a = hi === lo ? lo : hi / 2;
  let b = hi;
  if (power(a) >= target) return a;
  for (let i = 0; i < 100 && b - a > 1e-7 * b; i++) {
    const m = (a + b) / 2;
    if (power(m) < target) a = m;
    else b = m;
  }
  return (a + b) / 2;
}
