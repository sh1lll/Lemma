/**
 * The TESTS area: F and ANOVA (one-/two-way), equal-variance tests, contingency tables (χ² independence, Fisher,
 * McNemar), two proportions and A/B tests, nonparametric tests, power and sample size, Type I/II errors, margin of
 * error, effect sizes, psychometrics, meta-analysis, bootstrap/jackknife and survival (Kaplan–Meier, log-rank).
 */
import type { AnswerResult } from '@lemma/math-core';
import { normCdf, normInv, normSf } from '../special';
import {
  dataLines, dataText, exactP, groupsFor, H1SYM, pairsFor, rankSumCounts, signedRankCounts, solveN, tailFor, takeNum, tPower,
} from './tests-core';
import {
  alphaOf, answer, bad, chiSf, fInv, fmt, fmtP, fSf, hashSeed, list, matrixOf, mean, median, needErr, nums, param, pastedTable,
  pFrom, ranks, rawNums, rng, sum, testAnswer, tSf, variance, type Column, type Line, type PCtx, type PHandler, type Tail,
} from './util';

const NUM = '(-?(?:\\d+(?:\\.\\d+)?|\\.\\d+))';
const sq = (x: number) => x * x;

// ---------- shared ----------

function dfPair(s: string): [number, number] | null {
  const d1 = param(s, 'df1|dfn|numerator df|df numerator|numerator degrees of freedom|v1|nu1');
  const d2 = param(s, 'df2|dfd|denominator df|df denominator|denominator degrees of freedom|v2|nu2');
  if (d1 !== null && d2 !== null) return [d1, d2];
  const m =
    new RegExp(`\\b(?:df|d\\.f\\.|degrees of freedom)\\s*(?:=|:|of|are)?\\s*\\(?\\s*${NUM}\\s*(?:,|and|/|&)\\s*${NUM}`).exec(s) ??
    new RegExp(`\\bf\\s*\\(\\s*${NUM}\\s*,\\s*${NUM}\\s*\\)`).exec(s);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function checkDf(d1: number, d2: number) {
  if (!(d1 > 0 && d2 > 0)) bad('Degrees of freedom must be positive');
}

/** "95%" (confidence) → α = 0.05; otherwise the stated α. */
function alphaOrLevel(c: PCtx): { a: number; stated: boolean } {
  const al = alphaOf(c);
  if (al.stated) return al;
  const m = /(\d+(?:\.\d+)?)\s*%/.exec(c.s);
  if (m) {
    const lvl = Number(m[1]) / 100;
    if (lvl > 0.5 && lvl < 1) return { a: 1 - lvl, stated: true };
  }
  return al;
}

const decide = (p: number, a: number) => (p < a ? `Reject H₀ at α = ${fmt(a)}` : `Fail to reject H₀ at α = ${fmt(a)}`);

// ---------- F distribution ----------

const fCritical: PHandler = (c) => {
  if (!/\bcritical f\b|\bf[- ]?crit(?:ical)?\b|\bf\b[^.;]*\bcritical\b|\bcritical value[^.;]*\bf\b/.test(c.s)) return null;
  if (/\b(?:t|z|chi|chi-square)\b/.test(c.s.replace(/\bf\b/g, ''))) return null;
  const df = dfPair(c.s);
  if (!df) return needErr(c, 'Which degrees of freedom? (e.g. "F critical value df 3 and 20" or "df1 2 df2 12")');
  checkDf(...df);
  const a = alphaOrLevel(c);
  const v = fInv(1 - a.a, df[0], df[1]);
  return answer(c, {
    expression: `Critical F (upper tail α = ${fmt(a.a)}), df = ${fmt(df[0])}, ${fmt(df[1])}`,
    value: v,
    digits: 7,
    lines: [
      { label: 'Upper-tail area', display: fmt(a.a) },
      { label: 'Area to the left', display: fmt(1 - a.a) },
    ],
    notes: [
      ...(a.stated ? [] : ['α = 0.05 (say “alpha 0.01” to change)']),
      'For a two-sided variance-ratio test use α/2 in each tail',
    ],
  });
};

const fPvalue: PHandler = (c) => {
  const m = new RegExp(`\\bf\\s*(?:=|statistic(?: of| =| is)?|value of|ratio of|of)\\s*${NUM}`).exec(c.s);
  if (!m || !/\bdf\b|degrees of freedom|d\.f\./.test(c.s)) return null;
  if (/\btest\b/.test(c.s) && !/p[- ]?value|probability/.test(c.s)) return null;
  const df = dfPair(c.s.slice(0, m.index) + ' ' + c.s.slice(m.index + m[0].length));
  if (!df) return needErr(c, 'Which degrees of freedom? (e.g. "with df 2 and 10")');
  checkDf(...df);
  const x = Number(m[1]);
  if (x < 0) bad('An F statistic cannot be negative');
  const p = fSf(x, df[0], df[1]);
  const a = alphaOf(c);
  return answer(c, {
    expression: `Upper-tail p-value P(F ≥ ${fmt(x)}), F(${fmt(df[0])}, ${fmt(df[1])})`,
    value: p,
    lines: [
      { label: 'p-value', display: fmtP(p) },
      { label: `Critical F (α = ${fmt(a.a)})`, display: fmt(fInv(1 - a.a, df[0], df[1])) },
      { label: 'Decision', display: decide(p, a.a) },
    ],
    notes: a.stated ? [] : ['α = 0.05'],
  });
};

const fTestVariances: PHandler = (c) => {
  if (!/\bf[- ]?test\b|\bvariance ratio\b|\bequal(?:ity of)? variances?\b|\bcompare (?:the )?(?:two )?variances\b|\btest (?:for |of )?(?:the )?(?:two )?variances\b/.test(c.s)) return null;
  if (/\blevene\b|\bbartlett\b|\banova\b|\bcritical\b/.test(c.s)) return null;
  const a = alphaOf(c);
  const tail = tailFor(c.s);
  const s1 = param(c.s, 's1|sd1|std1|sigma1');
  const s2 = param(c.s, 's2|sd2|std2|sigma2');
  const v1 = param(c.s, 'variance1|var1|variance 1|s1\\^2|s1²');
  const v2 = param(c.s, 'variance2|var2|variance 2|s2\\^2|s2²');
  const n1 = param(c.s, 'n1');
  const n2 = param(c.s, 'n2');
  let A: { v: number; n: number };
  let B: { v: number; n: number };
  if ((s1 !== null || v1 !== null) && (s2 !== null || v2 !== null) && n1 !== null && n2 !== null) {
    A = { v: v1 ?? sq(s1!), n: n1 };
    B = { v: v2 ?? sq(s2!), n: n2 };
  } else {
    const g = groupsFor(c);
    if (g.length !== 2) return needErr(c, 'Give two samples (e.g. "f test 1 2 3 vs 2 4 9") or s1, n1, s2, n2');
    if (g[0]!.xs.length < 2 || g[1]!.xs.length < 2) bad('Each sample needs at least 2 values');
    A = { v: variance(g[0]!.xs), n: g[0]!.xs.length };
    B = { v: variance(g[1]!.xs), n: g[1]!.xs.length };
  }
  if (!(A.n >= 2 && B.n >= 2)) bad('Each sample needs n ≥ 2');
  if (!(A.v > 0 && B.v > 0)) bad('Both variances must be positive');
  const F = A.v / B.v;
  const d1 = A.n - 1;
  const d2 = B.n - 1;
  const p = pFrom(F, tail.tail, (x) => fSf(x, d1, d2));
  return testAnswer(c, {
    test: `F test for two variances · n = ${fmt(A.n)} and ${fmt(B.n)}`,
    statName: 'F',
    stat: F,
    df: `${fmt(d1)}, ${fmt(d2)}`,
    p,
    alpha: a,
    h0: 'σ₁² = σ₂²',
    h1: `σ₁² ${H1SYM[tail.tail]} σ₂²`,
    reject: 'The two population variances differ.',
    retain: 'No evidence that the two population variances differ.',
    lines: [
      { label: 'Variance 1', display: fmt(A.v) },
      { label: 'Variance 2', display: fmt(B.v) },
    ],
    assumptions: ['both populations normal (the F test is very sensitive to non-normality; Levene’s test is more robust)', 'independent samples'],
  });
};

// ---------- ANOVA ----------

function oneWay(groups: number[][]) {
  const all = groups.flat();
  const N = all.length;
  const k = groups.length;
  const gm = mean(all);
  const ssb = sum(groups.map((g) => g.length * sq(mean(g) - gm)));
  const ssw = sum(groups.map((g) => { const m = mean(g); return sum(g.map((x) => sq(x - m))); }));
  const d1 = k - 1;
  const d2 = N - k;
  const msb = ssb / d1;
  const msw = ssw / d2;
  const F = msw === 0 ? (msb === 0 ? NaN : Infinity) : msb / msw;
  return { ssb, ssw, d1, d2, msb, msw, F, p: Number.isFinite(F) ? fSf(F, d1, d2) : F === Infinity ? 0 : 1, N, k };
}

function validGroups(g: Column[], what: string): void {
  if (g.length < 2) bad(`${what} needs at least 2 groups (separate them with ";", "|", new lines or labels like "a: 1 2 3 b: 4 5 6")`);
  if (g.some((x) => x.xs.length < 1)) bad('Every group needs at least one value');
}

const anova: PHandler = (c) => {
  if (!/\banova\b|\banalysis of variance\b/.test(c.s)) return null;
  if (/\b(?:two|2)[- ]way\b|\btwo[- ]factor\b|\bfactorial\b|\bwith(?:out)? replication\b/.test(c.s)) return twoWay(c);
  const g = groupsFor(c);
  if (g.length < 2) return needErr(c, 'ANOVA needs at least 2 groups (e.g. "anova 1 2 3; 4 5 6; 7 8 9")');
  validGroups(g, 'ANOVA');
  const r = oneWay(g.map((x) => x.xs));
  if (r.d2 < 1) bad('Not enough values: ANOVA needs more values than groups');
  if (!Number.isFinite(r.F)) bad('All values within every group are identical, so F is undefined');
  const a = alphaOf(c);
  const vars = g.filter((x) => x.xs.length >= 2).map((x) => variance(x.xs));
  const notes: string[] = [];
  if (vars.length >= 2 && Math.min(...vars) > 0 && Math.max(...vars) / Math.min(...vars) > 4) notes.push('The largest group variance is more than 4× the smallest: consider Welch’s ANOVA or Kruskal–Wallis');
  notes.push('Post-hoc pairwise comparisons (Tukey HSD) are not computed here');
  const sst = r.ssb + r.ssw;
  return testAnswer(c, {
    test: `One-way ANOVA · ${r.k} groups, ${r.N} values`,
    statName: 'F',
    stat: r.F,
    df: `${r.d1}, ${r.d2}`,
    p: r.p,
    alpha: a,
    h0: 'all group means are equal',
    h1: 'at least one mean differs',
    reject: 'At least one group mean differs from the others.',
    retain: 'No evidence that the group means differ.',
    lines: [
      { label: 'η²', display: fmt(r.ssb / sst) },
      ...g.map((x) => ({ label: `Mean (${x.name}, n = ${x.xs.length})`, display: fmt(mean(x.xs)) })),
    ],
    table: {
      columns: ['Source', 'SS', 'df', 'MS', 'F', 'p'],
      rows: [
        ['Between groups', fmt(r.ssb), String(r.d1), fmt(r.msb), fmt(r.F), fmtP(r.p)],
        ['Within groups', fmt(r.ssw), String(r.d2), fmt(r.msw), '', ''],
        ['Total', fmt(sst), String(r.N - 1), '', '', ''],
      ],
    },
    assumptions: ['independent observations', 'each group roughly normal', 'equal variances (check with Levene’s test)'],
    notes,
  });
};

interface Cells {
  aNames: string[];
  bNames: string[];
  cells: number[][][];
  labels: [string, string];
}

/** Two-way data: "r1c1 | r1c2 ; r2c1 | r2c2" (cells of replicates), a long table (factor, factor, value), or a matrix. */
function twoWayData(c: PCtx): Cells | null {
  const text = dataText(c.rest);
  if (text.includes('|') && /;|\n/.test(text + c.raw)) {
    const rows = text.split(/;/).filter((r) => r.includes('|') || rawNums(r).length);
    const cells = rows.map((r) => r.split('|').map((x) => rawNums(x))).filter((r) => r.some((x) => x.length));
    if (cells.length >= 2 && cells.every((r) => r.length === cells[0]!.length && r.length >= 2)) {
      return { aNames: cells.map((_r, i) => `A${i + 1}`), bNames: cells[0]!.map((_x, j) => `B${j + 1}`), cells, labels: ['A', 'B'] };
    }
  }
  if (c.raw.includes('\n')) {
    const t = pastedTable(dataLines(c.raw).join('\n'));
    if (t && t.columns.length >= 3) {
      const isText = (j: number) => t.rows.some((r) => r[j] === null);
      const factors = t.columns.map((_h, j) => j).filter(isText);
      const numeric = t.columns.map((_h, j) => j).filter((j) => !isText(j));
      if (factors.length === 2 && numeric.length >= 1) {
        const [fa, fb] = factors as [number, number];
        const y = numeric[numeric.length - 1]!;
        const aNames = [...new Set(t.text.map((r) => r[fa]!))];
        const bNames = [...new Set(t.text.map((r) => r[fb]!))];
        const cells = aNames.map(() => bNames.map(() => [] as number[]));
        t.rows.forEach((r, i) => cells[aNames.indexOf(t.text[i]![fa]!)]![bNames.indexOf(t.text[i]![fb]!)]!.push(r[y] as number));
        // Header names keep the case they were typed in.
        const hdr = c.input.split(/\r?\n/).map((l) => l.trim().split(/\s*[,\t;]\s*|\s+/)).find((cells) => cells.length === t.columns.length && cells.every((x, j) => x.toLowerCase() === t.columns[j]));
        return { aNames, bNames, cells, labels: [hdr?.[fa] ?? t.columns[fa]!, hdr?.[fb] ?? t.columns[fb]!] };
      }
    }
  }
  const M = matrixOf(c, text);
  if (M) return { aNames: M.map((_r, i) => `row ${i + 1}`), bNames: M[0]!.map((_x, j) => `column ${j + 1}`), cells: M.map((r) => r.map((x) => [x])), labels: ['rows', 'columns'] };
  return null;
}

function twoWay(c: PCtx): AnswerResult {
  const d = twoWayData(c);
  if (!d) return needErr(c, 'Give the data as a matrix (rows = levels of A, columns = levels of B, e.g. "4 6 8; 5 7 9; 7 8 12"), cells of replicates ("4 5 | 6 7 ; 5 6 | 9 8") or a pasted table with two factor columns and a value column');
  const a = d.aNames.length;
  const b = d.bNames.length;
  if (a < 2 || b < 2) bad('Each factor needs at least 2 levels');
  const reps = d.cells.flat().map((x) => x.length);
  if (reps.some((r) => r === 0)) bad('Every combination of the two factors needs at least one value');
  if (reps.some((r) => r !== reps[0])) bad('Unbalanced design (unequal numbers of values per cell): only balanced two-way ANOVA is supported here');
  const n = reps[0]!;
  const all = d.cells.flat(2);
  const gm = mean(all);
  const rowMean = d.cells.map((r) => mean(r.flat()));
  const colMean = d.bNames.map((_x, j) => mean(d.cells.map((r) => r[j]!).flat()));
  const ssa = b * n * sum(rowMean.map((m) => sq(m - gm)));
  const ssb = a * n * sum(colMean.map((m) => sq(m - gm)));
  const sst = sum(all.map((x) => sq(x - gm)));
  const al = alphaOf(c);
  const [la, lb] = d.labels;
  const rows: string[][] = [];
  const lines: Line[] = [];
  const effect = (name: string, ss: number, df: number, msE: number, dfE: number) => {
    const F = ss / df / msE;
    const p = fSf(F, df, dfE);
    rows.push([name, fmt(ss), String(df), fmt(ss / df), fmt(F), fmtP(p)]);
    lines.push({ label: `F (${name})`, display: fmt(F) }, { label: `p (${name})`, display: fmtP(p) }, { label: `Decision (${name})`, display: decide(p, al.a) });
    return p;
  };
  let summary: string;
  if (n === 1) {
    const sse = sst - ssa - ssb;
    const dfE = (a - 1) * (b - 1);
    if (!(sse > 1e-12 * sst)) bad('The residual sum of squares is 0, so F is undefined');
    const pA = effect(la, ssa, a - 1, sse / dfE, dfE);
    const pB = effect(lb, ssb, b - 1, sse / dfE, dfE);
    rows.push(['Error', fmt(sse), String(dfE), fmt(sse / dfE), '', ''], ['Total', fmt(sst), String(a * b - 1), '', '', '']);
    summary = `${la}: p = ${fmtP(pA)} · ${lb}: p = ${fmtP(pB)}`;
  } else {
    const ssCells = n * sum(d.cells.flat().map((x) => sq(mean(x) - gm)));
    const ssab = ssCells - ssa - ssb;
    const sse = sst - ssCells;
    const dfE = a * b * (n - 1);
    if (!(sse > 0)) bad('Replicates within every cell are identical, so F is undefined');
    const pA = effect(la, ssa, a - 1, sse / dfE, dfE);
    const pB = effect(lb, ssb, b - 1, sse / dfE, dfE);
    const pAB = effect(`${la}×${lb}`, ssab, (a - 1) * (b - 1), sse / dfE, dfE);
    rows.push(['Error', fmt(sse), String(dfE), fmt(sse / dfE), '', ''], ['Total', fmt(sst), String(a * b * n - 1), '', '', '']);
    summary = `${la}: p = ${fmtP(pA)} · ${lb}: p = ${fmtP(pB)} · ${la}×${lb}: p = ${fmtP(pAB)}`;
  }
  return answer(c, {
    expression: `Two-way ANOVA ${n === 1 ? 'without replication' : `with ${n} replicates per cell`} · ${a} × ${b} levels`,
    display: summary,
    lines,
    table: { columns: ['Source', 'SS', 'df', 'MS', 'F', 'p'], rows },
    notes: [
      ...(n === 1 ? ['Without replication the interaction cannot be separated from error (additive model assumed)'] : []),
      'Assumes: independent observations; normal residuals; equal variances across cells',
      ...(al.stated ? [] : ['α = 0.05 (say “alpha 0.01” to change)']),
    ],
  });
}

// ---------- equal variances ----------

const equalVariance: PHandler = (c) => {
  const lev = /\blevene\b|\bbrown[- ]forsythe\b/.test(c.s);
  const bart = /\bbartlett\b/.test(c.s);
  if (!lev && !bart) return null;
  const g = groupsFor(c.s.includes('mean') ? { ...c, rest: c.rest.replace(/\b(?:center(?:ed)?|centre)?\s*(?:=|on)?\s*mean\b/, ' ') } : c);
  validGroups(g, lev ? 'Levene’s test' : 'Bartlett’s test');
  if (g.some((x) => x.xs.length < 2)) bad('Every group needs at least 2 values');
  const a = alphaOf(c);
  const k = g.length;
  const N = sum(g.map((x) => x.xs.length));
  if (lev) {
    const useMean = /\bmean\b/.test(c.s) && !/\bbrown[- ]forsythe\b/.test(c.s);
    const z = g.map((x) => { const ctr = useMean ? mean(x.xs) : median(x.xs); return x.xs.map((v) => Math.abs(v - ctr)); });
    const r = oneWay(z);
    if (!Number.isFinite(r.F)) bad('All absolute deviations are equal within groups, so the statistic is undefined');
    return testAnswer(c, {
      test: `Levene's test for equal variances (${useMean ? 'centred on the mean' : 'centred on the median, Brown–Forsythe'}) · ${k} groups`,
      statName: 'F',
      stat: r.F,
      df: `${r.d1}, ${r.d2}`,
      p: r.p,
      alpha: a,
      h0: 'all group variances are equal',
      h1: 'at least one variance differs',
      reject: 'The group variances are not all equal.',
      retain: 'No evidence that the group variances differ.',
      assumptions: ['independent observations'],
    });
  }
  const vs = g.map((x) => variance(x.xs));
  if (vs.some((v) => !(v > 0))) bad('Every group needs a positive variance for Bartlett’s test');
  const sp = sum(g.map((x, i) => (x.xs.length - 1) * vs[i]!)) / (N - k);
  const num = (N - k) * Math.log(sp) - sum(g.map((x, i) => (x.xs.length - 1) * Math.log(vs[i]!)));
  const den = 1 + (sum(g.map((x) => 1 / (x.xs.length - 1))) - 1 / (N - k)) / (3 * (k - 1));
  const K = num / den;
  return testAnswer(c, {
    test: `Bartlett's test for equal variances · ${k} groups`,
    statName: 'K²',
    stat: K,
    df: k - 1,
    p: chiSf(K, k - 1),
    alpha: a,
    h0: 'all group variances are equal',
    h1: 'at least one variance differs',
    reject: 'The group variances are not all equal.',
    retain: 'No evidence that the group variances differ.',
    assumptions: ['each group normal (Bartlett is sensitive to non-normality; Levene is more robust)'],
  });
};

// ---------- contingency tables ----------

function contingency(c: PCtx): number[][] | null {
  if (c.raw.includes('\n')) {
    const lines = dataLines(c.raw);
    const t = pastedTable(lines.join('\n'));
    if (t) {
      const cols = t.columns.map((_h, j) => j).filter((j) => t.rows.every((r) => typeof r[j] === 'number'));
      if (cols.length >= 2) return t.rows.map((r) => cols.map((j) => r[j] as number));
    }
  }
  return matrixOf(c, dataText(c.rest));
}

function checkCounts(M: number[][]) {
  if (M.some((r) => r.some((x) => x < 0))) bad('Counts cannot be negative');
  if (M.some((r) => r.some((x) => !Number.isFinite(x)))) bad('Counts must be numbers');
}

const chiIndependence: PHandler = (c) => {
  const chi = /\bchi\b|chi-square|chi squared|chi-squared/.test(c.s);
  const named = /\bindependence\b|\bhomogeneity\b|\bcontingency\b|\bassociation\b|\bcram[eé]r/.test(c.s);
  if (!(chi && named) && !/\bcontingency table\b|\btests? (?:of|for) (?:independence|homogeneity)\b/.test(c.s) && !(chi && /\[\s*\[/.test(c.s))) return null;
  if (/\bobserved\b|\bexpected\b|\bgoodness\b|\bgof\b/.test(c.s)) return null;
  const M = contingency(c);
  if (!M) return needErr(c, 'Give the contingency table, e.g. "[[10, 20], [30, 40]]" or "10 20; 30 40"');
  checkCounts(M);
  const r = M.length;
  const k = M[0]!.length;
  if (r < 2 || k < 2) bad('A contingency table needs at least 2 rows and 2 columns');
  const R = M.map((row) => sum(row));
  const C = M[0]!.map((_x, j) => sum(M.map((row) => row[j]!)));
  const T = sum(R);
  if (R.some((x) => x === 0) || C.some((x) => x === 0)) bad('A row or column total is 0: remove empty rows/columns');
  const E = M.map((_row, i) => C.map((cj) => (R[i]! * cj) / T));
  const stat = (yates: boolean) => {
    let x = 0;
    M.forEach((row, i) => row.forEach((o, j) => {
      const e = E[i]![j]!;
      const d = yates ? Math.max(0, Math.abs(o - e) - 0.5) : Math.abs(o - e);
      x += (d * d) / e;
    }));
    return x;
  };
  const is2 = r === 2 && k === 2;
  const yates = is2 && /\byates\b|\bcontinuity\b/.test(c.s) && !/\bwithout\b|\bno (?:yates|correction)\b/.test(c.s);
  const x2 = stat(yates);
  const df = (r - 1) * (k - 1);
  const p = chiSf(x2, df);
  const V = Math.sqrt(stat(false) / (T * (Math.min(r, k) - 1)));
  const minE = Math.min(...E.flat());
  const small = E.flat().filter((e) => e < 5).length;
  const notes: string[] = [];
  if (small) notes.push(`${small} of ${r * k} expected counts are below 5${minE < 1 ? ' (one below 1)' : ''}: the χ² approximation may be poor${is2 ? '; use Fisher’s exact test' : ''}`);
  if (is2) notes.push(yates ? 'Yates continuity correction applied' : 'No continuity correction (say “with Yates correction” to apply it)');
  const homog = /\bhomogeneity\b/.test(c.s);
  return testAnswer(c, {
    test: `Chi-square test of ${homog ? 'homogeneity' : 'independence'} · ${r}×${k} table, N = ${fmt(T)}`,
    statName: 'χ²',
    stat: x2,
    df,
    p,
    alpha: alphaOf(c),
    h0: homog ? 'the row groups have the same distribution' : 'rows and columns are independent',
    h1: homog ? 'the distributions differ' : 'rows and columns are associated',
    reject: homog ? 'The groups’ distributions differ.' : 'There is an association between the row and column variables.',
    retain: homog ? 'No evidence that the distributions differ.' : 'No evidence of an association between the row and column variables.',
    lines: [
      { label: "Cramér's V", display: fmt(V) },
      ...(is2 && !yates ? [{ label: 'χ² (Yates)', display: fmt(stat(true)) }, { label: 'p (Yates)', display: fmtP(chiSf(stat(true), 1)) }] : []),
      { label: 'Smallest expected count', display: fmt(minE) },
    ],
    table: { columns: ['', ...C.map((_x, j) => `Col ${j + 1} (obs / exp)`)], rows: M.map((row, i) => [`Row ${i + 1}`, ...row.map((o, j) => `${fmt(o)} / ${fmt(E[i]![j]!, 4)}`)]), caption: 'Observed / expected counts' },
    assumptions: ['independent observations', 'expected counts ≥ 5 in (nearly) every cell'],
    notes,
  });
};

function lnFact(n: number): number {
  let s = 0;
  for (let i = 2; i <= n; i++) s += Math.log(i);
  return s;
}

const fisher: PHandler = (c) => {
  if (!/\bfisher\b/.test(c.s)) return null;
  const M = contingency(c);
  if (!M) return needErr(c, 'Give the 2×2 table, e.g. "fisher exact test [[3, 1], [1, 3]]"');
  checkCounts(M);
  if (M.length !== 2 || M[0]!.length !== 2) bad('Fisher’s exact test here needs a 2×2 table');
  if (M.flat().some((x) => !Number.isInteger(x))) bad('Fisher’s exact test needs whole-number counts');
  const [[a, b], [cc, d]] = M as [[number, number], [number, number]];
  const r1 = a + b;
  const c1 = a + cc;
  const n = a + b + cc + d;
  if (n === 0) bad('The table is empty');
  const lo = Math.max(0, r1 + c1 - n);
  const hi = Math.min(r1, c1);
  const base = lnFact(c1) + lnFact(n - c1) + lnFact(r1) + lnFact(n - r1) - lnFact(n);
  const pmf = (x: number) => Math.exp(base - lnFact(x) - lnFact(c1 - x) - lnFact(r1 - x) - lnFact(n - c1 - r1 + x));
  const tail = tailFor(c.s);
  const po = pmf(a);
  let p = 0;
  for (let x = lo; x <= hi; x++) {
    const px = pmf(x);
    if (tail.tail === 'greater' ? x >= a : tail.tail === 'less' ? x <= a : px <= po * (1 + 1e-7)) p += px;
  }
  p = Math.min(1, p);
  const or = b * cc === 0 ? (a * d === 0 ? NaN : Infinity) : (a * d) / (b * cc);
  return testAnswer(c, {
    test: `Fisher's exact test · 2×2 table, N = ${n}`,
    statName: 'Sample odds ratio (ad/bc)',
    stat: or,
    p,
    alpha: alphaOf(c),
    h0: 'odds ratio = 1 (no association)',
    h1: `odds ratio ${H1SYM[tail.tail]} 1`,
    reject: 'The two variables are associated.',
    retain: 'No evidence of an association.',
    assumptions: ['row and column totals treated as fixed (conditional test)'],
    notes: [tail.tail === 'two' ? 'Two-sided p: sum of the probabilities of all tables no more likely than the observed one' : `One-sided (${tail.tail})`],
  });
};

const mcnemar: PHandler = (c) => {
  if (!/\bmcnemar\b/.test(c.s)) return null;
  const M = contingency(c);
  if (!M) return needErr(c, 'Give the paired 2×2 table, e.g. "mcnemar test [[794, 86], [150, 570]]"');
  checkCounts(M);
  if (M.length !== 2 || M[0]!.length !== 2) bad('McNemar’s test needs a 2×2 table of paired outcomes');
  const b = M[0]![1]!;
  const cc = M[1]![0]!;
  if (b + cc === 0) bad('There are no discordant pairs (both off-diagonal counts are 0)');
  const correct = !/\bwithout (?:continuity )?correction\b|\bno correction\b|\buncorrected\b/.test(c.s);
  const x2 = sq(Math.max(0, Math.abs(b - cc) - (correct ? 1 : 0))) / (b + cc);
  const m = Math.round(b + cc);
  let pe = 0;
  for (let k = 0; k <= Math.min(b, cc); k++) pe += Math.exp(lnFact(m) - lnFact(k) - lnFact(m - k) - m * Math.LN2);
  return testAnswer(c, {
    test: `McNemar's test for paired proportions · discordant pairs ${fmt(b)} and ${fmt(cc)}`,
    statName: 'χ²',
    stat: x2,
    df: 1,
    p: chiSf(x2, 1),
    alpha: alphaOf(c),
    h0: 'the two paired proportions are equal (b = c)',
    h1: 'they differ',
    reject: 'The paired proportions differ (the change is not symmetric).',
    retain: 'No evidence that the paired proportions differ.',
    lines: [{ label: 'Exact binomial p', display: fmtP(Math.min(1, 2 * pe)) }],
    assumptions: ['pairs are independent of each other'],
    notes: [correct ? 'With continuity correction (say “without correction” to drop it)' : 'Without continuity correction', ...(b + cc < 25 ? ['Fewer than 25 discordant pairs: prefer the exact binomial p'] : [])],
  });
};

// ---------- two proportions and A/B tests ----------

function proportionPairs(s: string): { x: number; n: number }[] {
  const re = /(\d+(?:\.\d+)?)\s*(?:conversions?|successes|clicks|sign-?ups|purchases|yes(?:es)?|users|visitors|people|cases)?\s*(?:out of|of|\/|in)\s*(\d+(?:\.\d+)?)/g;
  return [...s.replace(/(\d),(\d{3})\b/g, '$1$2').matchAll(re)].map((m) => ({ x: Number(m[1]), n: Number(m[2]) }));
}

const AB = /\ba\/b\b|\bab test\b|\bsplit test\b|\ba\/b test\b/;
const SIZE = /\bsample size\b|\bhow many\b|\bper (?:variant|group|arm)\b|\bneeded\b|\brequired\b/;

const twoProportions: PHandler = (c) => {
  if (!/\b(?:two|2)[- ]proportions?\b|\bcompare (?:two |the )?proportions\b|\bdifference (?:in|between|of) (?:two )?proportions\b/.test(c.s) && !AB.test(c.s)) return null;
  if (SIZE.test(c.s) || /\bpower\b/.test(c.s)) return null;
  const pr = proportionPairs(c.s);
  if (pr.length < 2) return needErr(c, 'Give both groups as counts, e.g. "120 of 2400 vs 150 of 2300"');
  const [A, B] = pr as [{ x: number; n: number }, { x: number; n: number }];
  for (const g of [A, B]) {
    if (!(g.n > 0)) bad('Each group needs a positive sample size');
    if (g.x < 0 || g.x > g.n) bad(`${fmt(g.x)} successes out of ${fmt(g.n)} is impossible`);
  }
  const p1 = A.x / A.n;
  const p2 = B.x / B.n;
  const pp = (A.x + B.x) / (A.n + B.n);
  const se = Math.sqrt(pp * (1 - pp) * (1 / A.n + 1 / B.n));
  const z = se === 0 ? 0 : (p1 - p2) / se;
  const tail = tailFor(c.s);
  const p = se === 0 ? 1 : pFrom(z, tail.tail, normSf);
  const a = alphaOf(c);
  const seU = Math.sqrt((p1 * (1 - p1)) / A.n + (p2 * (1 - p2)) / B.n);
  const zc = normInv(1 - a.a / 2);
  const ab = AB.test(c.s);
  const notes: string[] = [];
  if ([A.x, A.n - A.x, B.x, B.n - B.x].some((v) => v < 5)) notes.push('Fewer than 5 successes or failures in a group: the normal approximation is unreliable (use Fisher’s exact test)');
  if (!tail.stated) notes.push('Two-sided (say “one-sided greater” for a one-sided test)');
  return testAnswer(c, {
    test: `${ab ? 'A/B test (two-proportion z-test)' : 'Two-proportion z-test'} · ${fmt(A.x)}/${fmt(A.n)} vs ${fmt(B.x)}/${fmt(B.n)}`,
    statName: 'z',
    stat: z,
    p,
    alpha: a,
    h0: 'p₁ = p₂',
    h1: `p₁ ${H1SYM[tail.tail]} p₂`,
    reject: ab ? `The difference in conversion rate is statistically significant (B ${p2 > p1 ? 'beats' : 'trails'} A).` : 'The two proportions differ.',
    retain: ab ? 'The difference in conversion rate is not statistically significant.' : 'No evidence that the two proportions differ.',
    lines: [
      { label: ab ? 'Rate A' : 'p̂₁', display: `${fmt(p1 * 100, 5)}%` },
      { label: ab ? 'Rate B' : 'p̂₂', display: `${fmt(p2 * 100, 5)}%` },
      { label: 'Difference (2 − 1)', display: `${fmt((p2 - p1) * 100, 5)} percentage points` },
      ...(p1 > 0 ? [{ label: 'Relative change', display: `${fmt(((p2 - p1) / p1) * 100, 5)}%` }] : []),
      { label: `${fmt((1 - a.a) * 100)}% CI for p₂ − p₁`, display: `${fmt((p2 - p1 - zc * seU) * 100, 5)} to ${fmt((p2 - p1 + zc * seU) * 100, 5)} percentage points` },
      { label: 'Pooled proportion', display: fmt(pp) },
    ],
    assumptions: ['independent random samples', 'n·p and n·(1 − p) at least 5–10 in each group'],
    notes,
  });
};

function rate(s: string, names: string): number | null {
  const v = param(s, names);
  if (v === null) return null;
  if (v >= 1) bad(`A rate of ${fmt(v)} isn't a proportion: write it as a percentage ("10%") or a decimal ("0.10")`);
  if (v <= 0) bad('Rates must be positive');
  return v;
}

function powerOf(s: string): number {
  let pw = param(s, 'power');
  if (pw === null) return 0.8;
  if (pw >= 1) pw /= 100;
  if (!(pw > 0 && pw < 1)) bad('Power must be between 0 and 1 (or 0% and 100%)');
  return pw;
}

const abSampleSize: PHandler = (c) => {
  if (!(AB.test(c.s) || /\bconversion rate\b|\bbaseline\b/.test(c.s)) || !SIZE.test(c.s)) return null;
  const p1 = rate(c.s, 'baseline(?: conversion)?(?: rate)?|control(?: rate)?|current(?: conversion)?(?: rate)?|p1');
  if (p1 === null) return needErr(c, 'What is the baseline conversion rate? (e.g. "baseline 10%")');
  const notes: string[] = [];
  let p2 = rate(c.s, 'target(?: rate)?|variant(?: rate)?|expected(?: rate)?|new rate|p2');
  if (p2 === null) {
    const m = /\b(?:mde|minimum detectable (?:effect|difference|lift|change)|detectable (?:effect|difference)|lift|uplift)\s*(?:=|:|of|is)?\s*(\d*\.?\d+)\s*(%|percentage points?|pp\b|points?)?/.exec(c.s);
    if (!m) return needErr(c, 'What change should the test detect? (e.g. "mde 2 percentage points", "mde 20% relative" or "target 12%")');
    const raw = Number(m[1]);
    const unit = m[2] ?? '';
    const relative = /\brelative\b|\blift\b|\buplift\b/.test(c.s) && !/percentage point|\bpp\b|\babsolute\b/.test(c.s);
    let delta: number;
    if (relative) {
      delta = p1 * (unit === '%' || raw >= 1 ? raw / 100 : raw);
      notes.push(`Relative effect: ${fmt(p1 * 100)}% × ${fmt(unit === '%' || raw >= 1 ? raw : raw * 100)}% = ${fmt(delta * 100)} percentage points`);
    } else {
      if (!unit && raw >= 1) bad(`Is the effect ${fmt(raw)}% or ${fmt(raw)} percentage points? Write "%" or "percentage points"`);
      delta = unit ? raw / 100 : raw;
      notes.push(`Effect read as an absolute change of ${fmt(delta * 100)} percentage points (${fmt(p1 * 100)}% → ${fmt((p1 + delta) * 100)}%); say “relative” for a relative lift`);
    }
    p2 = p1 + delta;
  }
  if (!(p2 > 0 && p2 < 1)) bad('The target rate must be between 0% and 100%');
  if (p2 === p1) bad('The target rate equals the baseline: there is no effect to detect');
  const pw = powerOf(c.s);
  const a = alphaOf(c);
  const za = normInv(1 - a.a / 2);
  const zb = normInv(pw);
  const pb = (p1 + p2) / 2;
  const n = sq(za * Math.sqrt(2 * pb * (1 - pb)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) / sq(p2 - p1);
  const N = Math.ceil(n - 1e-9);
  return answer(c, {
    expression: `A/B test sample size per variant · ${fmt(p1 * 100)}% → ${fmt(p2 * 100)}%, power ${fmt(pw * 100)}%, α = ${fmt(a.a)} two-sided`,
    value: N,
    display: `${N.toLocaleString('en-US')} per variant`,
    lines: [
      { label: 'Total (both variants)', display: (2 * N).toLocaleString('en-US') },
      { label: 'Exact n', display: fmt(n, 8) },
      { label: 'Formula', display: 'n = (z₁₋α/₂·√(2p̄q̄) + z₁₋β·√(p₁q₁ + p₂q₂))² / (p₂ − p₁)²' },
    ],
    notes: [...notes, 'Rounded up to a whole number per variant', ...(a.stated ? [] : ['α = 0.05 two-sided']), ...(param(c.s, 'power') === null ? ['Power 80% (say “power 90%” to change)'] : [])],
  });
};

// ---------- power and sample size ----------

const rejectionRule: PHandler = (c) => {
  const m = new RegExp(`\\breject\\w*(?: h0| the null(?: hypothesis)?)?\\s*(?:if|when|whenever)\\s*(?:xbar|the sample mean|sample mean|the mean|mean|x̄)\\s*(>=|<=|>|<)\\s*${NUM}`).exec(c.s);
  if (!m || !/\btype (?:i{1,2}|1|2) error\b|\bpower\b|\balpha\b|\bbeta\b/.test(c.s)) return null;
  const rest = c.s.slice(0, m.index) + ' ' + c.s.slice(m.index + m[0].length);
  const mu0 = param(rest, 'mu0|mu_0|null mean|h0 mean');
  const mu1 = param(rest, 'mu1|mu_1|true mean|alternative mean|actual mean');
  const sigma = param(rest, 'sigma|sd|standard deviation|population sd');
  const n = param(rest, 'n|sample size');
  if (mu0 === null || sigma === null || n === null) return needErr(c, 'Give mu0, sigma and n (and mu1 for a Type II error)');
  if (!(sigma > 0 && n > 0)) bad('sigma and n must be positive');
  const cut = Number(m[2]);
  const up = m[1]!.startsWith('>');
  const se = sigma / Math.sqrt(n);
  const pReject = (mu: number) => (up ? normSf((cut - mu) / se) : normCdf((cut - mu) / se));
  const t1 = pReject(mu0);
  const wantII = /\btype (?:ii|2) error\b|\bbeta\b|\bpower\b/.test(c.s);
  if (wantII && mu1 === null) return needErr(c, 'A Type II error needs the true mean mu1');
  const lines: Line[] = [{ label: 'Type I error α', display: fmt(t1) }, { label: 'Standard error', display: fmt(se) }];
  if (mu1 !== null) lines.push({ label: 'Type II error β', display: fmt(1 - pReject(mu1)) }, { label: 'Power', display: fmt(pReject(mu1)) });
  const power = /\bpower\b/.test(c.s);
  const v = !wantII ? t1 : power ? pReject(mu1!) : 1 - pReject(mu1!);
  return answer(c, {
    expression: `${!wantII ? 'Type I error' : power ? 'Power' : 'Type II error'} of the rule “reject H₀ if x̄ ${m[1]} ${fmt(cut)}” · μ₀ = ${fmt(mu0)}${mu1 !== null ? `, μ₁ = ${fmt(mu1)}` : ''}, σ = ${fmt(sigma)}, n = ${fmt(n)}`,
    value: v,
    lines,
    notes: ['x̄ ~ Normal(μ, σ/√n), σ known'],
  });
};

const power: PHandler = (c) => {
  const asksPower = /\bpower\b|\btype (?:ii|2) error\b|\bbeta error\b/.test(c.s);
  const asksN = /\bsample size\b|\bhow many (?:subjects|participants|people|patients|per group|observations)\b|\bminimum n\b|\brequired n\b/.test(c.s);
  if (!asksPower && !asksN) return null;
  if (!/\b[tz][- ]?test\b|\bdelta\b|\beffect size\b|\bcohen|\bd\s*(?:=|:)?\s*\d|\bmu0\b|\bmu1\b|\bp1\b|\bp2\b|\bproportions\b|\bmeans\b|\bsigma\b/.test(c.s)) return null;
  if (/\bmargin\b|\bwithin\b|\bconfidence interval\b/.test(c.s)) return null;
  const a = alphaOf(c);
  const tail = tailFor(c.s);
  const target = powerOf(c.s);
  const nGiven = param(c.s, 'n|sample size|n per group');
  const solveForN = asksN || (nGiven === null && param(c.s, 'power') !== null);
  const wantBeta = /\btype (?:ii|2) error\b|\bbeta error\b/.test(c.s);
  const notes: string[] = [];
  if (!a.stated) notes.push('α = 0.05 (say “alpha 0.01” to change)');

  // two proportions (R power.prop.test)
  const p1 = param(c.s, 'p1');
  const p2 = param(c.s, 'p2');
  if (p1 !== null && p2 !== null) {
    for (const p of [p1, p2]) if (!(p > 0 && p < 1)) bad('p1 and p2 must be between 0 and 1');
    if (p1 === p2) bad('p1 equals p2: there is no difference to detect');
    const k = tail.tail === 'two' ? 2 : 1;
    const qa = normInv(1 - a.a / k);
    const pw = (n: number) => normCdf((Math.sqrt(n) * Math.abs(p1 - p2) - qa * Math.sqrt((p1 + p2) * (1 - (p1 + p2) / 2))) / Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)));
    notes.push('Normal approximation as in R’s power.prop.test; n is per group');
    if (solveForN) {
      const n = solveN(pw, target);
      return answer(c, {
        expression: `Sample size per group to detect p₁ = ${fmt(p1)} vs p₂ = ${fmt(p2)} with power ${fmt(target)} (${tail.tail === 'two' ? 'two' : 'one'}-sided α = ${fmt(a.a)})`,
        value: Math.ceil(n - 1e-9),
        lines: [{ label: 'Exact n', display: fmt(n, 8) }, { label: 'Total', display: String(2 * Math.ceil(n - 1e-9)) }],
        notes: [...notes, 'Rounded up'],
      });
    }
    if (nGiven === null) return needErr(c, 'What sample size per group? (or ask for the sample size and give the power)');
    const pv = pw(nGiven);
    return answer(c, {
      expression: `${wantBeta ? 'Type II error' : 'Power'} of a two-proportion test · p₁ = ${fmt(p1)}, p₂ = ${fmt(p2)}, n = ${fmt(nGiven)} per group, α = ${fmt(a.a)}`,
      value: wantBeta ? 1 - pv : pv,
      lines: [{ label: 'Power', display: fmt(pv) }, { label: 'Type II error β', display: fmt(1 - pv) }],
      notes,
    });
  }

  // means
  let d = param(c.s, 'd|effect size|cohen\'?s d|cohens d|standardi[sz]ed effect');
  const mu0 = param(c.s, 'mu0|mu_0|null mean');
  const mu1 = param(c.s, 'mu1|mu_1|true mean|alternative mean');
  let delta = param(c.s, 'delta|difference|mean difference|effect');
  if (delta === null && mu0 !== null && mu1 !== null) delta = mu1 - mu0;
  const sdv = param(c.s, 'sd|sigma|standard deviation|std');
  if (d === null) {
    if (delta === null) return needErr(c, 'Give the effect size d, or the difference (delta, or mu0 and mu1) and the standard deviation');
    if (sdv === null) {
      d = delta;
      notes.push('Standard deviation 1 assumed (give "sd" to change)');
    } else {
      if (!(sdv > 0)) bad('The standard deviation must be positive');
      d = delta / sdv;
    }
  }
  if (d === 0) bad('An effect of 0 cannot be detected');
  const isZ = /\bz[- ]?test\b|\bsigma known\b|\bknown sigma\b/.test(c.s);
  const samples: 1 | 2 = /\b(?:one|1)[- ]?sample\b|\bpaired\b|\bmu0\b/.test(c.s) ? 1 : 2;
  // One-sided in the direction of the effect.
  const t: Tail = tail.tail === 'two' ? 'two' : d > 0 ? 'greater' : 'less';
  const zPow = (n: number) => {
    const ncp = Math.sqrt(n / samples) * d!;
    if (t === 'two') {
      const zc = normInv(1 - a.a / 2);
      return normSf(zc - ncp) + normCdf(-zc - ncp);
    }
    const zc = normInv(1 - a.a);
    return t === 'greater' ? normSf(zc - ncp) : normCdf(-zc - ncp);
  };
  const pw = (n: number) => (isZ ? zPow(n) : tPower(n, d!, samples, a.a, t));
  const kind = `${samples === 1 ? 'one-sample' : 'two-sample'} ${isZ ? 'z' : 't'} test`;
  const side = t === 'two' ? 'two-sided' : 'one-sided';
  notes.push(isZ ? 'z test: σ treated as known' : 'Exact power from the noncentral t distribution (as R’s power.t.test, both tails counted)');
  if (samples === 2) notes.push('n is per group');
  if (solveForN) {
    const n = solveN(pw, target, isZ ? 1 : 2);
    if (!Number.isFinite(n)) bad('The required sample size is unrealistically large');
    return answer(c, {
      expression: `Sample size for a ${kind} · d = ${fmt(d)}, power ${fmt(target)}, ${side} α = ${fmt(a.a)}`,
      value: Math.ceil(n - 1e-9),
      lines: [{ label: 'Exact n', display: fmt(n, 8) }, ...(samples === 2 ? [{ label: 'Total', display: String(2 * Math.ceil(n - 1e-9)) }] : [])],
      notes: [...notes, 'Rounded up'],
    });
  }
  if (nGiven === null) return needErr(c, 'What sample size n? (or ask for the sample size and give the power)');
  if (!(nGiven >= (isZ ? 1 : 2))) bad('n is too small');
  const pv = pw(nGiven);
  return answer(c, {
    expression: `${wantBeta ? 'Type II error' : 'Power'} of a ${kind} · d = ${fmt(d)}, n = ${fmt(nGiven)}, ${side} α = ${fmt(a.a)}`,
    value: wantBeta ? 1 - pv : pv,
    lines: [{ label: 'Power', display: fmt(pv) }, { label: 'Type II error β', display: fmt(1 - pv) }, { label: 'Effect size d', display: fmt(d) }],
    notes,
  });
};

// ---------- nonparametric ----------

const hasTies = (xs: number[]) => new Set(xs).size !== xs.length;
function tieSum(xs: number[]): number {
  const m = new Map<number, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  let s = 0;
  for (const t of m.values()) s += t * t * t - t;
  return s;
}

const mannWhitney: PHandler = (c) => {
  if (!/\bmann[- ]?whitney\b|\bwilcoxon rank[- ]sum\b|\brank[- ]sum test\b|\bu[- ]test\b/.test(c.s)) return null;
  const g = groupsFor(c);
  if (g.length !== 2) return needErr(c, 'Give two samples with at least 2 values each, e.g. "mann whitney 1 2 3 vs 4 5 6" or "x: … y: …"');
  const x = g[0]!.xs;
  const y = g[1]!.xs;
  if (x.length < 2 || y.length < 2) bad('Each sample needs at least 2 values');
  const tail = tailFor(c.s);
  const m = x.length;
  const n = y.length;
  const R = ranks([...x, ...y]);
  const W = sum(R.slice(0, m)) - (m * (m + 1)) / 2;
  const ties = hasTies([...x, ...y]);
  let p: number;
  const notes: string[] = [];
  if (!ties && m < 50 && n < 50) {
    p = exactP(rankSumCounts(m, n), W, tail.tail);
    notes.push('Exact p-value (no ties)');
  } else {
    const N = m + n;
    const sig = Math.sqrt(((m * n) / 12) * (N + 1 - tieSum([...x, ...y]) / (N * (N - 1))));
    const z0 = W - (m * n) / 2;
    const corr = tail.tail === 'two' ? Math.sign(z0) * 0.5 : tail.tail === 'greater' ? 0.5 : -0.5;
    const z = (z0 - corr) / sig;
    p = pFrom(z, tail.tail, normSf);
    notes.push(`${ties ? 'Ties present: n' : 'N'}ormal approximation with ${ties ? 'tie and ' : ''}continuity correction (z = ${fmt(z, 5)})`);
  }
  return testAnswer(c, {
    test: `Mann–Whitney U (Wilcoxon rank-sum) test · n = ${m} and ${n}`,
    statName: 'W',
    stat: W,
    p,
    alpha: alphaOf(c),
    h0: 'the two distributions are the same (location shift 0)',
    h1: `sample 1 tends to be ${tail.tail === 'two' ? 'different from' : tail.tail === 'greater' ? 'larger than' : 'smaller than'} sample 2`,
    reject: 'The two groups differ in location.',
    retain: 'No evidence that the two groups differ in location.',
    lines: [
      { label: 'U₁ (= W)', display: fmt(W) },
      { label: 'U₂', display: fmt(m * n - W) },
      { label: 'Medians', display: `${fmt(median(x))} and ${fmt(median(y))}` },
    ],
    assumptions: ['independent samples', 'continuous, similarly shaped distributions'],
    notes,
  });
};

function signedRank(c: PCtx, d: number[], label: string): AnswerResult {
  const zeros = d.filter((v) => v === 0).length;
  const nz = d.filter((v) => v !== 0);
  if (nz.length < 1) bad('All differences are zero');
  const tail = tailFor(c.s);
  const R = ranks(nz.map(Math.abs));
  const V = sum(R.filter((_r, i) => nz[i]! > 0));
  const n = nz.length;
  const ties = hasTies(nz.map(Math.abs));
  const notes: string[] = [];
  if (zeros) notes.push(`${zeros} zero difference${zeros > 1 ? 's' : ''} dropped`);
  let p: number;
  if (!ties && !zeros && n < 50) {
    p = exactP(signedRankCounts(n), V, tail.tail);
    notes.push('Exact p-value');
  } else {
    const mu = (n * (n + 1)) / 4;
    const sig = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24 - tieSum(nz.map(Math.abs)) / 48);
    const z0 = V - mu;
    const corr = tail.tail === 'two' ? Math.sign(z0) * 0.5 : tail.tail === 'greater' ? 0.5 : -0.5;
    const z = (z0 - corr) / sig;
    p = pFrom(z, tail.tail, normSf);
    notes.push(`Normal approximation with ${ties ? 'tie and ' : ''}continuity correction (z = ${fmt(z, 5)})`);
  }
  return testAnswer(c, {
    test: `Wilcoxon signed-rank test · ${label}`,
    statName: 'V',
    stat: V,
    p,
    alpha: alphaOf(c),
    h0: 'the differences are symmetric about 0',
    h1: `median difference ${H1SYM[tail.tail]} 0`,
    reject: 'The median difference is not zero.',
    retain: 'No evidence that the median difference differs from zero.',
    lines: [{ label: 'Pairs used', display: String(n) }, { label: 'Median difference', display: fmt(median(d)) }],
    assumptions: ['differences independent and symmetric about their median'],
    notes,
  });
}

/** One- or two-sample input: returns differences (x − y − m0) and a label. */
function diffsFor(c: PCtx): { d: number[]; label: string } | null {
  const t = takeNum(dataText(c.rest), 'median|mu|mu0|m0|hypothesi[sz]ed median|null median|against');
  const m0 = t.v ?? 0;
  const cc: PCtx = { ...c, rest: t.rest };
  const g = groupsFor(cc);
  if (g.length === 2) {
    const [x, y] = [g[0]!.xs, g[1]!.xs];
    if (x.length !== y.length) bad(`Paired samples need the same number of values (${x.length} and ${y.length})`);
    return { d: x.map((v, i) => v - y[i]! - m0), label: `${x.length} pairs (first − second)` };
  }
  if (g.length > 2) bad('Give one sample (with a median to test against) or two paired samples');
  const xs = nums(t.rest);
  if (xs.length < 2) return null;
  if (t.v === null) return null;
  return { d: xs.map((v) => v - m0), label: `${xs.length} values against median ${fmt(m0)}` };
}

const wilcoxonSigned: PHandler = (c) => {
  if (!/\bwilcoxon\b|\bsigned[- ]rank\b/.test(c.s) || /\brank[- ]sum\b/.test(c.s)) return null;
  const r = diffsFor(c);
  if (!r) return needErr(c, 'Give paired samples ("x: … y: …") or one sample and the median to test against ("median 0")');
  return signedRank(c, r.d, r.label);
};

const signTest: PHandler = (c) => {
  if (!/\bsign test\b/.test(c.s)) return null;
  const r = diffsFor(c);
  if (!r) return needErr(c, 'Give paired samples ("before: … after: …") or one sample and the median ("median 4")');
  const plus = r.d.filter((v) => v > 0).length;
  const minus = r.d.filter((v) => v < 0).length;
  const n = plus + minus;
  if (n === 0) bad('All values equal the median: no signs to test');
  const tail = tailFor(c.s);
  const pmf = (k: number) => Math.exp(lnFact(n) - lnFact(k) - lnFact(n - k) - n * Math.LN2);
  let le = 0;
  let ge = 0;
  for (let k = 0; k <= n; k++) {
    if (k <= plus) le += pmf(k);
    if (k >= plus) ge += pmf(k);
  }
  const p = tail.tail === 'greater' ? ge : tail.tail === 'less' ? le : Math.min(1, 2 * Math.min(le, ge));
  return testAnswer(c, {
    test: `Sign test · ${r.label}`,
    statName: 'Positive signs',
    stat: plus,
    p,
    alpha: alphaOf(c),
    h0: 'P(+) = P(−) = 0.5 (median difference 0)',
    h1: `median ${H1SYM[tail.tail]} hypothesised value`,
    reject: 'The median differs from the hypothesised value.',
    retain: 'No evidence that the median differs from the hypothesised value.',
    lines: [{ label: 'Negative signs', display: String(minus) }, { label: 'Ties dropped', display: String(r.d.length - n) }],
    assumptions: ['independent observations (no symmetry or normality needed)'],
    notes: ['Exact binomial p-value'],
  });
};

const kruskal: PHandler = (c) => {
  if (!/\bkruskal\b/.test(c.s)) return null;
  const g = groupsFor(c);
  if (g.length < 2) return needErr(c, 'Kruskal–Wallis needs at least 2 groups, e.g. "kruskal wallis 1 2 3; 4 5 6; 7 8 9"');
  validGroups(g, 'Kruskal–Wallis');
  const all = g.flatMap((x) => x.xs);
  const N = all.length;
  if (N < 3) bad('Not enough values');
  const R = ranks(all);
  let i = 0;
  let H = 0;
  for (const x of g) {
    const rs = R.slice(i, i + x.xs.length);
    i += x.xs.length;
    H += sq(sum(rs)) / x.xs.length;
  }
  H = (12 / (N * (N + 1))) * H - 3 * (N + 1);
  const C = 1 - tieSum(all) / (N * N * N - N);
  if (C === 0) bad('All values are equal');
  H /= C;
  const df = g.length - 1;
  const notes: string[] = [];
  if (C < 1) notes.push('Corrected for ties');
  if (g.some((x) => x.xs.length < 5)) notes.push('Some groups have fewer than 5 values: the χ² approximation is rough');
  return testAnswer(c, {
    test: `Kruskal–Wallis test · ${g.length} groups, ${N} values`,
    statName: 'H',
    stat: H,
    df,
    p: chiSf(H, df),
    alpha: alphaOf(c),
    h0: 'all groups come from the same distribution',
    h1: 'at least one group differs in location',
    reject: 'At least one group differs from the others.',
    retain: 'No evidence that the groups differ.',
    lines: g.map((x) => ({ label: `Median (${x.name})`, display: fmt(median(x.xs)) })),
    assumptions: ['independent samples', 'similarly shaped distributions'],
    notes,
  });
};

function pearson(x: number[], y: number[]): number {
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i]! - mx) * (y[i]! - my);
    sxx += sq(x[i]! - mx);
    syy += sq(y[i]! - my);
  }
  return sxy / Math.sqrt(sxx * syy);
}

function permuteCount(n: number, S: number): [number, number, number] {
  // Counts of permutations with Σd² ≤ S and ≥ S (exact Spearman null), n ≤ 9.
  const used = new Array<boolean>(n).fill(false);
  let le = 0;
  let ge = 0;
  let tot = 0;
  const rec = (i: number, acc: number) => {
    if (i === n) {
      tot++;
      if (acc <= S + 1e-9) le++;
      if (acc >= S - 1e-9) ge++;
      return;
    }
    for (let v = 0; v < n; v++) {
      if (used[v]) continue;
      used[v] = true;
      rec(i + 1, acc + sq(v - i));
      used[v] = false;
    }
  };
  rec(0, 0);
  return [le, ge, tot];
}

const rankCorrelation: PHandler = (c) => {
  const sp = /\bspearman\b/.test(c.s);
  const kd = /\bkendall\b/.test(c.s);
  if (!sp && !kd) return null;
  const pr = pairsFor(c);
  if (!pr) return needErr(c, 'Give paired data, e.g. "x: 1 2 3 4 5 y: 2 1 4 3 5"');
  const [x, y] = pr;
  if (x.length !== y.length) bad(`x has ${x.length} values but y has ${y.length}`);
  const n = x.length;
  if (n < 3) bad('Need at least 3 pairs');
  const tail = tailFor(c.s);
  const a = alphaOf(c);
  if (sp) {
    const rx = ranks(x);
    const ry = ranks(y);
    const rho = pearson(rx, ry);
    if (!Number.isFinite(rho)) bad('One variable is constant, so the correlation is undefined');
    let p: number;
    const notes: string[] = [];
    if (n <= 9 && !hasTies(x) && !hasTies(y)) {
      const S = sum(rx.map((r, i) => sq(r - ry[i]!)));
      const [le, ge, tot] = permuteCount(n, S);
      // small S ↔ large ρ
      p = tail.tail === 'greater' ? le / tot : tail.tail === 'less' ? ge / tot : Math.min(1, (2 * Math.min(le, ge)) / tot);
      notes.push('Exact permutation p-value');
    } else if (Math.abs(rho) >= 1) {
      p = 0;
      notes.push('Perfect rank correlation');
    } else {
      const t = rho * Math.sqrt((n - 2) / (1 - rho * rho));
      p = pFrom(t, tail.tail, (v) => tSf(v, n - 2));
      notes.push(`t approximation: t = ${fmt(t, 5)} with ${n - 2} df${hasTies(x) || hasTies(y) ? ' (ties share average ranks)' : ''}`);
    }
    return testAnswer(c, {
      test: `Spearman rank correlation · ${n} pairs`,
      statName: 'ρ',
      stat: rho,
      p,
      alpha: a,
      h0: 'ρ = 0 (no monotonic association)',
      h1: `ρ ${H1SYM[tail.tail]} 0`,
      reject: `There is a ${rho > 0 ? 'positive' : 'negative'} monotonic association.`,
      retain: 'No evidence of a monotonic association.',
      assumptions: ['paired observations independent of each other'],
      notes,
    });
  }
  let C = 0;
  let D = 0;
  let tx = 0;
  let ty = 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const s = (x[i]! - x[j]!) * (y[i]! - y[j]!);
      if (s > 0) C++;
      else if (s < 0) D++;
      else {
        if (x[i] === x[j] && y[i] !== y[j]) tx++;
        if (y[i] === y[j] && x[i] !== x[j]) ty++;
      }
    }
  const tau = (C - D) / Math.sqrt((C + D + tx) * (C + D + ty));
  if (!Number.isFinite(tau)) bad('One variable is constant, so τ is undefined');
  const tcount = (xs: number[]) => [...xs.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<number, number>()).values()];
  const ux = tcount(x);
  const uy = tcount(y);
  const s1 = (ts: number[], f: (t: number) => number) => sum(ts.map(f));
  const v0 = n * (n - 1) * (2 * n + 5);
  const vt = s1(ux, (t) => t * (t - 1) * (2 * t + 5));
  const vu = s1(uy, (t) => t * (t - 1) * (2 * t + 5));
  const v1 = (s1(ux, (t) => t * (t - 1)) * s1(uy, (t) => t * (t - 1))) / (2 * n * (n - 1));
  const v2 = n > 2 ? (s1(ux, (t) => t * (t - 1) * (t - 2)) * s1(uy, (t) => t * (t - 1) * (t - 2))) / (9 * n * (n - 1) * (n - 2)) : 0;
  const z = (C - D) / Math.sqrt((v0 - vt - vu) / 18 + v1 + v2);
  return testAnswer(c, {
    test: `Kendall's tau-b · ${n} pairs`,
    statName: 'τ',
    stat: tau,
    p: pFrom(z, tail.tail, normSf),
    alpha: a,
    h0: 'τ = 0',
    h1: `τ ${H1SYM[tail.tail]} 0`,
    reject: `There is a ${tau > 0 ? 'positive' : 'negative'} monotonic association.`,
    retain: 'No evidence of a monotonic association.',
    lines: [{ label: 'Concordant pairs', display: String(C) }, { label: 'Discordant pairs', display: String(D) }],
    assumptions: ['paired observations independent of each other'],
    notes: [`Normal approximation (z = ${fmt(z, 5)})${n < 10 ? '; with fewer than 10 pairs an exact test is preferable' : ''}`],
  });
};

// ---------- margin of error ----------

const marginOfError: PHandler = (c) => {
  if (!/\bmargin of error\b|\bmoe\b/.test(c.s)) return null;
  if (/\bsample size\b(?! \d)|\bhow (?:many|large|big)\b|\bout of\b|\bsuccesses\b|\bxbar\b|\bmean\b|\bsd\b|\bstandard deviation\b/.test(c.s)) return null;
  let s = c.s;
  const pRaw = /\b(?:p|proportion|phat|p-hat|expected proportion)\s*(?:=|:|of|is)?\s*(\d*\.?\d+)\s*(%)?/.exec(s);
  let p = 0.5;
  const notes: string[] = [];
  if (pRaw) {
    p = pRaw[2] ? Number(pRaw[1]) / 100 : Number(pRaw[1]);
    if (!(p > 0 && p < 1)) bad('The proportion must be between 0 and 1 (or 0% and 100%)');
    s = s.slice(0, pRaw.index) + ' ' + s.slice(pRaw.index + pRaw[0].length);
  } else notes.push('p = 0.5 (the most conservative choice; give "p 0.3" to refine)');
  const N = param(s, 'population(?: size)?|population of');
  if (N !== null) s = s.replace(/\bpopulation(?: size)?(?: of)?\s*(?:=|:|is)?\s*\d+/, ' ');
  const n = param(s, 'n|sample size|sample of|respondents|people|voters|participants|interviews|surveyed');
  if (n === null) return needErr(c, 'What is the sample size? (e.g. "margin of error n 1000")');
  if (!(n > 0)) bad('The sample size must be positive');
  const m = /(\d+(?:\.\d+)?)\s*%/.exec(s);
  let level = 0.95;
  if (m) {
    level = Number(m[1]) / 100;
    if (!(level > 0 && level < 1)) bad('The confidence level must be between 0% and 100%');
  } else notes.push('95% confidence (say e.g. “99%” to change)');
  const z = normInv(1 - (1 - level) / 2);
  let E = z * Math.sqrt((p * (1 - p)) / n);
  const lines: Line[] = [{ label: 'z*', display: fmt(z, 7) }, { label: 'Standard error', display: fmt(Math.sqrt((p * (1 - p)) / n)) }];
  if (N !== null) {
    if (!(N > n)) bad('The population must be larger than the sample');
    const fpc = Math.sqrt((N - n) / (N - 1));
    E *= fpc;
    lines.push({ label: 'Finite population correction', display: fmt(fpc) });
  }
  return answer(c, {
    expression: `Margin of error for a proportion · n = ${fmt(n)}, p = ${fmt(p)}, ${fmt(level * 100)}% confidence${N !== null ? `, population ${fmt(N)}` : ''}`,
    value: E,
    display: `± ${fmt(E * 100, 4)}%`,
    lines: [{ label: 'As a proportion', display: `± ${fmt(E)}` }, ...lines, { label: 'Formula', display: `z*·√(p(1 − p)/n)${N !== null ? '·√((N − n)/(N − 1))' : ''}` }],
    notes: [...notes, 'Assumes a simple random sample'],
  });
};

// ---------- effect size ----------

const cohenD: PHandler = (c) => {
  if (!/\bcohen'?s? d\b|\bcohens d\b|\bhedges'? g\b|\beffect size\b/.test(c.s)) return null;
  if (/\bpower\b|\bsample size\b/.test(c.s)) return null;
  const m1 = param(c.s, 'mean1|m1|xbar1|mean 1|mu1');
  const m2 = param(c.s, 'mean2|m2|xbar2|mean 2|mu2');
  const s1 = param(c.s, 'sd1|s1|sigma1|std1|sd 1');
  const s2 = param(c.s, 'sd2|s2|sigma2|std2|sd 2');
  const n1 = param(c.s, 'n1');
  const n2 = param(c.s, 'n2');
  let d: number;
  const lines: Line[] = [];
  const notes: string[] = [];
  if (m1 !== null && m2 !== null && s1 !== null && s2 !== null) {
    if (!(s1 > 0 && s2 > 0)) bad('Standard deviations must be positive');
    let sp: number;
    if (n1 !== null && n2 !== null) {
      if (!(n1 >= 2 && n2 >= 2)) bad('Each group needs n ≥ 2');
      sp = Math.sqrt(((n1 - 1) * s1 * s1 + (n2 - 1) * s2 * s2) / (n1 + n2 - 2));
      d = (m1 - m2) / sp;
      const J = 1 - 3 / (4 * (n1 + n2) - 9);
      lines.push({ label: "Hedges' g", display: fmt(d * J) });
    } else {
      sp = Math.sqrt((s1 * s1 + s2 * s2) / 2);
      d = (m1 - m2) / sp;
      notes.push('No sample sizes given: pooled SD = √((s₁² + s₂²)/2)');
    }
    lines.unshift({ label: 'Pooled SD', display: fmt(sp) });
  } else {
    const g = groupsFor(c);
    if (g.length !== 2) return needErr(c, 'Give two groups, or mean1, sd1, n1, mean2, sd2, n2');
    const [x, y] = [g[0]!.xs, g[1]!.xs];
    if (x.length < 2 || y.length < 2) bad('Each group needs at least 2 values');
    const sp = Math.sqrt(((x.length - 1) * variance(x) + (y.length - 1) * variance(y)) / (x.length + y.length - 2));
    if (!(sp > 0)) bad('Both groups have zero spread, so d is undefined');
    d = (mean(x) - mean(y)) / sp;
    lines.push({ label: 'Pooled SD', display: fmt(sp) }, { label: "Hedges' g", display: fmt(d * (1 - 3 / (4 * (x.length + y.length) - 9))) });
  }
  const ad = Math.abs(d);
  lines.push({ label: 'Magnitude', display: ad < 0.2 ? 'negligible (< 0.2)' : ad < 0.5 ? 'small (0.2–0.5)' : ad < 0.8 ? 'medium (0.5–0.8)' : 'large (≥ 0.8)' });
  return answer(c, { expression: "Cohen's d · (mean₁ − mean₂) / pooled SD", value: d, lines, notes: [...notes, 'Cohen’s benchmarks: 0.2 small, 0.5 medium, 0.8 large'] });
};

// ---------- psychometrics ----------

const cronbach: PHandler = (c) => {
  if (!/\bcronbach\b|\bcoefficient alpha\b|\binternal consistency\b/.test(c.s)) return null;
  const M = contingencyLike(c);
  if (!M) return needErr(c, 'Give the item scores as a matrix, one row per respondent and one column per item, e.g. "[[3,4,3],[5,5,4],[2,3,2]]"');
  const n = M.length;
  const k = M[0]!.length;
  if (k < 2) bad('Cronbach’s α needs at least 2 items (columns)');
  if (n < 2) bad('Cronbach’s α needs at least 2 respondents (rows)');
  const items = M[0]!.map((_x, j) => M.map((r) => r[j]!));
  const tot = M.map((r) => sum(r));
  const vt = variance(tot);
  if (!(vt > 0)) bad('Total scores have no variance, so α is undefined');
  const alphaK = (cols: number[][]) => {
    const kk = cols.length;
    const t = cols[0]!.map((_x, i) => sum(cols.map((col) => col[i]!)));
    return (kk / (kk - 1)) * (1 - sum(cols.map((col) => variance(col))) / variance(t));
  };
  const al = alphaK(items);
  const lab = al >= 0.9 ? 'excellent' : al >= 0.8 ? 'good' : al >= 0.7 ? 'acceptable' : al >= 0.6 ? 'questionable' : al >= 0.5 ? 'poor' : 'unacceptable';
  return answer(c, {
    expression: `Cronbach's α · ${k} items, ${n} respondents`,
    value: al,
    lines: [
      { label: 'Interpretation', display: `${lab} (George & Mallery rule of thumb)` },
      { label: 'Sum of item variances', display: fmt(sum(items.map((i) => variance(i)))) },
      { label: 'Variance of total scores', display: fmt(vt) },
    ],
    ...(k >= 3 ? { table: { columns: ['Item', 'Mean', 'α if item deleted'], rows: items.map((col, j) => [String(j + 1), fmt(mean(col)), fmt(alphaK(items.filter((_x, i) => i !== j)))]) } } : {}),
    notes: ['α = k/(k − 1)·(1 − Σ item variances / total variance); rows are respondents, columns are items'],
  });
};

function contingencyLike(c: PCtx): number[][] | null {
  return contingency(c);
}

const tScore: PHandler = (c) => {
  const st = /\bstanines?\b/.test(c.s);
  if (!/\bt[- ]?scores?\b/.test(c.s) && !st) return null;
  if (/\bt[- ]?test\b|\bdf\b|\bcritical\b|\bdegrees of freedom\b/.test(c.s)) return null;
  let rest = c.s;
  const mu = takeNum(rest, 'mean|mu|average|population mean');
  rest = mu.rest;
  const sdv = takeNum(rest, 'sd|standard deviation|sigma|std');
  rest = sdv.rest;
  const xs = nums(rest);
  if (!xs.length) return needErr(c, 'Which score? (e.g. "t-score for 130 mean 100 sd 15")');
  const stan = (z: number) => Math.min(9, Math.max(1, Math.round(2 * z + 5)));
  if (xs.length === 1) {
    if (mu.v === null || sdv.v === null) return needErr(c, 'Give the mean and standard deviation of the norm group (e.g. "mean 100 sd 15")');
    if (!(sdv.v > 0)) bad('The standard deviation must be positive');
    const z = (xs[0]! - mu.v) / sdv.v;
    const T = 50 + 10 * z;
    return answer(c, {
      expression: `${st ? 'Stanine' : 'T-score'} of ${fmt(xs[0]!)} · mean ${fmt(mu.v)}, SD ${fmt(sdv.v)}`,
      value: st ? stan(z) : T,
      lines: [
        { label: 'z', display: fmt(z) },
        { label: 'T-score (50 + 10z)', display: fmt(T) },
        { label: 'Stanine', display: String(stan(z)) },
        { label: 'Percentile (normal)', display: `${fmt(normCdf(z) * 100, 4)}%` },
      ],
      notes: ['Psychometric T-score (mean 50, SD 10), not a t statistic'],
    });
  }
  const m = mu.v ?? mean(xs);
  const s = sdv.v ?? Math.sqrt(variance(xs));
  if (!(s > 0)) bad('The scores have no spread');
  const zs = xs.map((x) => (x - m) / s);
  return answer(c, {
    expression: `${st ? 'Stanines' : 'T-scores'} of ${xs.length} scores · mean ${fmt(m)}, SD ${fmt(s)}${mu.v === null ? ' (sample)' : ''}`,
    display: list(zs.map((z) => (st ? stan(z) : 50 + 10 * z)), 5),
    table: { columns: ['Score', 'z', 'T', 'Stanine'], rows: xs.map((x, i) => [fmt(x), fmt(zs[i]!, 5), fmt(50 + 10 * zs[i]!, 5), String(stan(zs[i]!))]) },
    notes: ['T = 50 + 10z; stanine = round(2z + 5) clipped to 1–9'],
  });
};

// ---------- meta-analysis ----------

const meta: PHandler = (c) => {
  if (!/\bmeta[- ]?analy\w*\b|\bpooled effect\b|\binverse[- ]variance\b|\bdersimonian\b/.test(c.s)) return null;
  const s = c.s;
  const eIdx = s.search(/\b(?:effects?|effect sizes?|estimates?|yi|smds?|log ?ors?|log odds ratios?|d values?)\b/);
  const seM = /\b(?:se|ses|standard errors?|sei)\b/.exec(s);
  const vM = /\b(?:variances?|vars?|vi)\b/.exec(s);
  const sIdx = seM ? seM.index : vM ? vM.index : -1;
  if (eIdx < 0 || sIdx < 0) return needErr(c, 'Give the study effects and their standard errors, e.g. "meta-analysis effects 0.2 0.5 0.3 se 0.1 0.2 0.15"');
  const seg = (from: number, to: number) => rawNums(s.slice(from, to > from ? to : undefined));
  const eff = eIdx < sIdx ? seg(eIdx, sIdx) : seg(eIdx, s.length);
  const sv = sIdx < eIdx ? seg(sIdx, eIdx) : seg(sIdx, s.length);
  if (eff.length < 2) bad('A meta-analysis needs at least 2 studies');
  if (eff.length !== sv.length) bad(`There are ${eff.length} effects but ${sv.length} ${seM ? 'standard errors' : 'variances'}`);
  const v = seM ? sv.map(sq) : sv;
  if (v.some((x) => !(x > 0))) bad('Standard errors (variances) must be positive');
  const w = v.map((x) => 1 / x);
  const W = sum(w);
  const fe = sum(w.map((wi, i) => wi * eff[i]!)) / W;
  const seFe = Math.sqrt(1 / W);
  const k = eff.length;
  const Q = sum(w.map((wi, i) => wi * sq(eff[i]! - fe)));
  const df = k - 1;
  const C = W - sum(w.map(sq)) / W;
  const tau2 = Math.max(0, (Q - df) / C);
  const wr = v.map((x) => 1 / (x + tau2));
  const re = sum(wr.map((wi, i) => wi * eff[i]!)) / sum(wr);
  const seRe = Math.sqrt(1 / sum(wr));
  const I2 = Q > df ? (Q - df) / Q : 0;
  const fixed = /\bfixed\b|\bcommon[- ]effect\b/.test(s);
  const a = alphaOf(c);
  const z = normInv(1 - a.a / 2);
  const est = fixed ? fe : re;
  const se = fixed ? seFe : seRe;
  const ci = (m: number, e: number) => `${fmt(m - z * e)} to ${fmt(m + z * e)}`;
  return answer(c, {
    expression: `${fixed ? 'Fixed-effect (inverse-variance)' : 'Random-effects (DerSimonian–Laird)'} pooled effect · ${k} studies`,
    value: est,
    lines: [
      { label: `${fmt((1 - a.a) * 100)}% CI`, display: ci(est, se) },
      { label: 'Standard error', display: fmt(se) },
      { label: 'z', display: fmt(est / se) },
      { label: 'p (effect = 0)', display: fmtP(2 * normSf(Math.abs(est / se))) },
      { label: 'Fixed-effect estimate', display: fmt(fe) },
      { label: 'Random-effects estimate', display: fmt(re) },
      { label: 'Q', display: fmt(Q) },
      { label: 'p (heterogeneity)', display: fmtP(chiSf(Q, df)) },
      { label: 'τ²', display: fmt(tau2) },
      { label: 'I²', display: `${fmt(I2 * 100, 4)}%` },
    ],
    table: { columns: ['Study', 'Effect', 'Variance', 'Weight (FE)', 'Weight (RE)'], rows: eff.map((e, i) => [String(i + 1), fmt(e), fmt(v[i]!), `${fmt((w[i]! / W) * 100, 4)}%`, `${fmt((wr[i]! / sum(wr)) * 100, 4)}%`]) },
    notes: [
      `Q = ${fmt(Q)} on ${df} df; I² = ${fmt(I2 * 100, 4)}% of the variation is between-study heterogeneity`,
      ...(I2 > 0.5 ? ['Substantial heterogeneity: interpret the pooled effect with care'] : []),
      ...(k < 5 ? ['With fewer than 5 studies τ² is estimated imprecisely'] : []),
    ],
  });
};

// ---------- resampling ----------

type Stat = { name: string; f: (xs: number[]) => number };
function statOf(s: string): Stat {
  if (/\bpopulation variance\b|\bplug-?in variance\b/.test(s)) return { name: 'population variance', f: (xs) => variance(xs, false) };
  if (/\bvariance\b/.test(s)) return { name: 'variance', f: (xs) => variance(xs) };
  if (/\bmedian\b/.test(s)) return { name: 'median', f: median };
  if (/\bstandard deviation\b|\bsd\b/.test(s)) return { name: 'standard deviation', f: (xs) => Math.sqrt(variance(xs)) };
  return { name: 'mean', f: mean };
}

function resampleData(s: string): { xs: number[]; seed: number | null; B: number | null; level: number | null } {
  const seed = param(s, 'seed');
  const B = param(s, 'b|resamples|replicates|bootstrap samples|iterations|reps');
  const lv = /(\d+(?:\.\d+)?)\s*%/.exec(s);
  const t = s
    .replace(/\bseed\s*(?:=|:)?\s*\d+/g, ' ')
    .replace(/\b(?:b|resamples|replicates|bootstrap samples|iterations|reps)\s*(?:=|:)?\s*\d+/g, ' ')
    .replace(/\d+\s*(?:resamples|replicates|bootstrap samples|iterations|reps)\b/g, ' ')
    .replace(/\d+(?:\.\d+)?\s*%/g, ' ');
  return { xs: nums(t), seed, B, level: lv ? Number(lv[1]) / 100 : null };
}

const bootstrap: PHandler = (c) => {
  if (!/\bbootstrap\w*\b/.test(c.s)) return null;
  const st = statOf(c.s);
  const { xs, seed, B: Bp, level } = resampleData(c.s);
  if (xs.length < 2) return needErr(c, 'Give the data, e.g. "bootstrap 95% ci for the mean of 1 2 3 4 5 seed 42"');
  const B = Math.round(Bp ?? 2000);
  if (B < 100 || B > 100000) bad('Use between 100 and 100,000 resamples');
  const lvl = level ?? 0.95;
  if (!(lvl > 0 && lvl < 1)) bad('The confidence level must be between 0% and 100%');
  const sd0 = seed ?? hashSeed(xs.join(','));
  const r = rng(sd0);
  const n = xs.length;
  const stats: number[] = [];
  const buf = new Array<number>(n);
  for (let b = 0; b < B; b++) {
    for (let i = 0; i < n; i++) buf[i] = xs[Math.floor(r() * n)]!;
    stats.push(st.f(buf));
  }
  stats.sort((p, q) => p - q);
  const q = (p: number) => {
    const h = (B - 1) * p;
    const lo = Math.floor(h);
    return stats[lo]! + (h - lo) * ((stats[Math.min(lo + 1, B - 1)] ?? stats[lo]!) - stats[lo]!);
  };
  const lo = q((1 - lvl) / 2);
  const hi = q(1 - (1 - lvl) / 2);
  const est = st.f(xs);
  const plain = (x: number) => String(Number(x.toPrecision(10)));
  return {
    ok: true,
    kind: 'stats',
    input: c.input,
    expression: `Bootstrap ${fmt(lvl * 100)}% percentile interval for the ${st.name} · ${n} values, ${B.toLocaleString('en-US')} resamples`,
    primary: { display: `${fmt(lo)} to ${fmt(hi)}`, plain: `${plain(lo)}, ${plain(hi)}`, spoken: `from ${fmt(lo, 4)} to ${fmt(hi, 4)}` },
    lines: [
      { label: `Sample ${st.name}`, display: fmt(est) },
      { label: 'Bootstrap SE', display: fmt(Math.sqrt(variance(stats))) },
      { label: 'Resamples', display: B.toLocaleString('en-US') },
      { label: 'Seed', display: String(sd0) },
    ],
    notes: [`Seed ${sd0}${seed === null ? ' (derived from the data, so the answer is reproducible; add “seed N” to change it)' : ''}`, 'Percentile method; resampling with replacement'],
  };
};

const jackknife: PHandler = (c) => {
  if (!/\bjackknife\b/.test(c.s)) return null;
  const st = statOf(c.s);
  const xs = resampleData(c.s).xs;
  const n = xs.length;
  if (n < 3) return needErr(c, 'Give at least 3 data values');
  const est = st.f(xs);
  const loo = xs.map((_x, i) => st.f(xs.filter((_y, j) => j !== i)));
  const lm = mean(loo);
  let bias = (n - 1) * (lm - est);
  if (Math.abs(bias) < 1e-12 * (Math.abs(est) + 1)) bias = 0;
  const se = Math.sqrt(((n - 1) / n) * sum(loo.map((v) => sq(v - lm))));
  const wantBias = /\bbias\b/.test(c.s);
  return answer(c, {
    expression: `Jackknife ${wantBias ? 'bias' : 'standard error'} of the ${st.name} · ${n} values`,
    value: wantBias ? bias : se,
    lines: [
      { label: `Sample ${st.name}`, display: fmt(est) },
      { label: 'Jackknife SE', display: fmt(se) },
      { label: 'Bias', display: fmt(bias) },
      { label: 'Bias-corrected estimate', display: fmt(est - bias) },
    ],
    notes: ['Leave-one-out: SE = √((n − 1)/n · Σ(θ₍ᵢ₎ − θ̄)²), bias = (n − 1)(θ̄ − θ̂)'],
  });
};

// ---------- survival ----------

interface Obs { t: number; e: 0 | 1 }

/** "times 6 6 7 status 1 0 1", "times … censored 0 1 0", or "6, 6+, 7" (+ = censored). */
function survivalData(text: string): Obs[] | null {
  const ts = /\b(?:times?|durations?|t)\s*(?:=|:)?\s*(.*?)\b(status|events?|event indicators?|died|deaths?|delta|censor(?:ed|ing)?(?: indicators?| flags?)?)\s*(?:=|:)?\s*(.*)$/.exec(text);
  if (ts) {
    const t = rawNums(ts[1]!);
    const f = rawNums(ts[3]!);
    if (t.length !== f.length) bad(`Times and status need the same number of values (${t.length} and ${f.length})`);
    if (f.some((x) => x !== 0 && x !== 1)) bad('Status values must be 0 or 1');
    const censorFlags = /^censor/.test(ts[2]!);
    return t.map((v, i) => ({ t: v, e: (censorFlags ? 1 - f[i]! : f[i]!) as 0 | 1 }));
  }
  const toks = [...text.matchAll(/(-?\d+(?:\.\d+)?)(\s*\+)?/g)].map((m) => ({ t: Number(m[1]), e: (m[2] ? 0 : 1) as 0 | 1 }));
  return toks.length ? toks : null;
}

function km(obs: Obs[]) {
  const times = [...new Set(obs.filter((o) => o.e).map((o) => o.t))].sort((a, b) => a - b);
  let S = 1;
  let g = 0;
  const rows: { t: number; n: number; d: number; cens: number; S: number; se: number }[] = [];
  for (const t of times) {
    const n = obs.filter((o) => o.t >= t).length;
    const d = obs.filter((o) => o.t === t && o.e).length;
    const cens = obs.filter((o) => o.t === t && !o.e).length;
    S *= 1 - d / n;
    if (n > d) g += d / (n * (n - d));
    rows.push({ t, n, d, cens, S, se: S * Math.sqrt(g) });
  }
  return rows;
}

const kaplanMeier: PHandler = (c) => {
  if (!/\bkaplan\b|\bkm (?:estimate|curve)\b|\bproduct[- ]limit\b|\bsurvival curve\b/.test(c.s) || /\blog[- ]?rank\b/.test(c.s)) return null;
  let text = c.s.replace(/\bkaplan[- ]meier\b|\bkaplan\b|\bmeier\b/g, ' ');
  const at = /\b(?:survival|s)\s*(?:at|\()\s*(?:t\s*=\s*)?(\d+(?:\.\d+)?)\s*\)?/.exec(text);
  if (at) text = text.slice(0, at.index) + ' ' + text.slice(at.index + at[0].length);
  const obs = survivalData(text);
  if (!obs || obs.length < 2) return needErr(c, 'Give survival times with censoring, e.g. "times 6 6 6 7 10 status 1 1 0 1 0" or "6, 6, 6+, 7, 10+" (+ = censored)');
  if (obs.some((o) => o.t < 0)) bad('Survival times cannot be negative');
  if (!obs.some((o) => o.e)) bad('There are no events (every time is censored)');
  const rows = km(obs);
  const med = rows.find((r) => r.S <= 0.5 + 1e-12);
  const lines: Line[] = rows.map((r) => ({ label: `S(${fmt(r.t)})`, display: fmt(r.S) }));
  const table = {
    columns: ['Time', 'At risk', 'Events', 'Censored', 'S(t)', 'SE (Greenwood)'],
    rows: rows.map((r) => [fmt(r.t), String(r.n), String(r.d), String(r.cens), fmt(r.S), fmt(r.se)]),
  };
  const notes = [`${obs.filter((o) => o.e).length} events, ${obs.filter((o) => !o.e).length} censored`, 'Median survival: first time S(t) ≤ 0.5'];
  if (at) {
    const t = Number(at[1]);
    const last = [...rows].reverse().find((r) => r.t <= t);
    const S = last ? last.S : 1;
    return answer(c, { expression: `Kaplan–Meier survival at t = ${fmt(t)} · ${obs.length} subjects`, value: S, lines: [{ label: 'Median survival', display: med ? fmt(med.t) : 'not reached' }, ...lines], table, notes });
  }
  return answer(c, {
    expression: `Kaplan–Meier estimate · ${obs.length} subjects`,
    ...(med ? { value: med.t, display: `median survival ${fmt(med.t)}` } : { display: 'median survival not reached' }),
    lines: [{ label: 'Median survival', display: med ? fmt(med.t) : 'not reached' }, ...lines],
    table,
    notes,
  });
};

const logRank: PHandler = (c) => {
  if (!/\blog[- ]?rank\b|\bmantel[- ]cox\b/.test(c.s)) return null;
  const text = c.s.replace(/\blog[- ]?rank(?: test)?\b|\bmantel[- ]cox(?: test)?\b|\btest\b/g, ' ');
  let parts = text.split(/\s*[;|]\s*|\s+(?:vs\.?|versus)\s+|\n/).filter((p) => /\d/.test(p));
  if (parts.length !== 2) {
    const byLabel = text.split(/\bgroup\s*\w+\s*:/).filter((p) => /\d/.test(p));
    if (byLabel.length === 2) parts = byLabel;
  }
  if (parts.length !== 2) return needErr(c, 'Give two groups separated by ";" or "vs", e.g. "log-rank test 6, 7, 10+ vs 1, 2, 3"');
  const strip = (p: string) => p.replace(/^\s*(?:group\s*\w+|[a-z]+)\s*:/, ' ');
  const g = parts.map((p) => survivalData(strip(p)));
  if (!g[0] || !g[1] || g[0].length < 1 || g[1].length < 1) bad('Each group needs survival times');
  const [A, B] = g as [Obs[], Obs[]];
  const all = [...A, ...B];
  const times = [...new Set(all.filter((o) => o.e).map((o) => o.t))].sort((a, b) => a - b);
  if (!times.length) bad('There are no events in either group');
  let O = 0;
  let E = 0;
  let V = 0;
  for (const t of times) {
    const n1 = A.filter((o) => o.t >= t).length;
    const n2 = B.filter((o) => o.t >= t).length;
    const d1 = A.filter((o) => o.t === t && o.e).length;
    const d = d1 + B.filter((o) => o.t === t && o.e).length;
    const n = n1 + n2;
    O += d1;
    E += (d * n1) / n;
    if (n > 1) V += (d * (n1 / n) * (1 - n1 / n) * (n - d)) / (n - 1);
  }
  const x2 = V > 0 ? sq(O - E) / V : 0;
  const O2 = all.filter((o) => o.e).length - O;
  const E2 = all.filter((o) => o.e).length - E;
  return testAnswer(c, {
    test: `Log-rank test · groups of ${A.length} and ${B.length}`,
    statName: 'χ²',
    stat: x2,
    df: 1,
    p: V > 0 ? chiSf(x2, 1) : 1,
    alpha: alphaOf(c),
    h0: 'the two survival curves are the same',
    h1: 'they differ',
    reject: 'The survival curves differ between the groups.',
    retain: 'No evidence that the survival curves differ.',
    lines: [
      { label: 'Group 1 observed / expected', display: `${fmt(O)} / ${fmt(E)}` },
      { label: 'Group 2 observed / expected', display: `${fmt(O2)} / ${fmt(E2)}` },
    ],
    assumptions: ['censoring unrelated to prognosis', 'proportional hazards for best power'],
  });
};

export const HANDLERS: PHandler[] = [
  fCritical,
  fPvalue,
  equalVariance,
  anova,
  fTestVariances,
  fisher,
  mcnemar,
  chiIndependence,
  abSampleSize,
  twoProportions,
  rejectionRule,
  power,
  mannWhitney,
  wilcoxonSigned,
  signTest,
  kruskal,
  rankCorrelation,
  marginOfError,
  cohenD,
  cronbach,
  tScore,
  meta,
  bootstrap,
  jackknife,
  logRank,
  kaplanMeier,
];
