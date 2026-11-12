import { createSession, type Answer } from '@lemma/math-core';
import { describe, expect, it } from 'vitest';
import { Runtime } from '../../runtime/src';

// Battery for the stats-plus TESTS area: ANOVA, F, contingency tables, nonparametric tests, power and sample size,
// A/B tests, margin of error, effect sizes, psychometrics, meta-analysis, resampling and survival.
// Every expected value comes from an outside reference: R documentation examples (chisq.test, kruskal.test,
// wilcox.test, fisher.test, bartlett.test, power.t.test, power.prop.test, prop.test), published textbook examples
// (Kleinbaum & Klein's leukemia data, Hollander & Wolfe), standard F tables, or closed forms evaluated independently
// (F with 2 numerator df: P(F > f) = (1 + 2f/d2)^(−d2/2); χ² with 2 df: P = e^(−x/2); exact binomial/permutation counts).

const rt = new Runtime();
const run = (q: string) => rt.compute(q, createSession(), { liveRates: false });

type Check = {
  /** Expected primary value. */
  v?: number;
  /** Relative tolerance (default 1e-4). */
  tol?: number;
  /** Expected numeric line values: [label, value]. */
  lines?: [string, number][];
  /** Regexes the expression / primary / lines text must match. */
  text?: RegExp[];
};

function numOf(s: string): number {
  const t = s.replace(/[,±\s]/g, '').replace('−', '-').replace(/%$/, '');
  const m = /^(-?[\d.]+)(?:×10\^(-?\d+))?/.exec(t);
  if (!m) return NaN;
  return Number(m[1]) * (m[2] ? 10 ** Number(m[2]) : 1);
}

function near(actual: number, expected: number, tol: number, what: string) {
  const err = Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-12);
  expect(err <= tol || Math.abs(actual - expected) < 1e-12, `${what}: got ${actual}, expected ${expected}`).toBe(true);
}

async function check(q: string, c: Check) {
  const o = await run(q);
  if (o.kind !== 'answer') throw new Error(`"${q}" → ${o.kind}${o.kind === 'error' ? `: ${o.error.message}` : ''}`);
  const a: Answer = o.result;
  const tol = c.tol ?? 1e-4;
  if (c.v !== undefined) near(a.value!.toNumber(), c.v, tol, `${q} value`);
  for (const [label, v] of c.lines ?? []) {
    const l = a.lines?.find((x) => x.label === label);
    expect(l, `${q}: line "${label}" in ${JSON.stringify(a.lines?.map((x) => x.label))}`).toBeTruthy();
    near(numOf(l!.display), v, Math.max(tol, 1e-5), `${q} line ${label}`);
  }
  const all = [a.expression, a.primary.display, ...(a.lines ?? []).map((l) => `${l.label}: ${l.display}`), ...a.notes].join('\n');
  for (const re of c.text ?? []) expect(all, q).toMatch(re);
}

const IS_A = '10 7 20 14 14 12 10 23 17 20 14 13';
const IS_B = '11 17 21 11 16 14 17 17 19 21 7 13';
const IS_C = '0 1 7 2 3 1 2 1 3 0 1 4';
const IS_D = '3 5 12 6 4 3 5 5 5 5 2 4';
const IS_E = '3 5 3 5 3 6 1 1 3 2 6 4';
const IS_F = '11 9 15 22 15 16 13 10 26 26 24 13';
const INSECTS = `A: ${IS_A}; B: ${IS_B}; C: ${IS_C}; D: ${IS_D}; E: ${IS_E}; F: ${IS_F}`; // R datasets::InsectSprays

const MP = '6, 6, 6, 7, 10, 13, 16, 22, 23, 6+, 9+, 10+, 11+, 17+, 19+, 20+, 25+, 32+, 32+, 34+, 35+'; // Freireich 6-MP arm
const PLACEBO = '1, 1, 2, 2, 3, 4, 4, 5, 5, 8, 8, 8, 8, 11, 11, 12, 12, 15, 17, 22, 23';

const CASES: [string, Check][] = [
  // ---------- F distribution: critical values and p-values ----------
  ['F critical value df 2 and 12', { v: 3.885294, tol: 1e-5 }], // closed form d2/2·(α^(−2/d2) − 1); table 3.89
  ['critical F alpha 0.01 df1 2 df2 12', { v: 6.926608, tol: 1e-5 }], // closed form; F table 6.93
  ['F critical value df 3 and 20', { v: 3.098391, tol: 1e-4 }], // F table (α = .05): 3.10
  ['F critical value alpha 0.05 df 1 and 10', { v: 4.964603, tol: 1e-4 }], // F(1,10) = t(10)² = 2.228139² ; table 4.96
  ['F critical value 99% df 5 and 10', { v: 5.636326, tol: 1e-4 }], // F table α = .01: 5.64
  ['F critical value df 4, 30', { v: 2.689628, tol: 1e-4 }], // F table α = .05: 2.69
  ['p-value for F = 4.2 with df 2 and 10', { v: 0.04741447, tol: 1e-5 }], // (1 + 2·4.2/10)^(−5)
  ['p-value for F = 1 with df 2 and 2', { v: 0.5, tol: 1e-6 }], // F(2,2) cdf = f/(1+f)
  ['p-value for F = 27 with df 2 and 6', { v: 0.001, tol: 1e-6 }], // (1 + 2·27/6)^(−3)

  // ---------- F test for two variances ----------
  ['f test for equal variances 1 2 3 vs 2 4 9', { v: 0.1428571, tol: 1e-5, lines: [['F', 0.07692308]] }], // F(2,2): two-sided 2·F/(1+F)
  ['f test s1 4 n1 3 s2 2 n2 3', { v: 0.4, tol: 1e-6, lines: [['F', 4]] }], // F = 16/4, two-sided 2·(1 − 4/5)
  ['f test variance1 16 n1 3 variance2 4 n2 3', { v: 0.4, tol: 1e-6, lines: [['F', 4]] }], // same in variances
  ['compare variances 10 12 9 14 15 11 13 vs 20 25 18 30 22 27 24 19', { lines: [['F', 0.2702516]] }], // F = s1²/s2²

  // ---------- one-way ANOVA ----------
  ['one way anova 1 2 3; 4 5 6; 7 8 9', { v: 0.001, tol: 1e-6, lines: [['F', 27]] }], // SSB 54, SSW 6; closed form p
  ['anova group a: 1, 2, 3 group b: 4, 5, 6 group c: 7, 8, 9', { v: 0.001, tol: 1e-6, lines: [['F', 27]] }],
  ['anova 1 2 3 | 4 5 6 | 7 8 9', { lines: [['F', 27], ['η²', 0.9]] }], // η² = 54/60
  ['anova\n1 2 3\n4 5 6\n7 8 9', { lines: [['F', 27]] }], // one group per line
  ['anova\nlow,mid,high\n1,4,7\n2,5,8\n3,6,9', { lines: [['F', 27]] }], // groups as columns with a header
  [`anova ${INSECTS}`, { lines: [['F', 34.70228]], text: [/5, 66/] }], // R: aov(count ~ spray, InsectSprays): F = 34.7 on 5 and 66 df
  ['analysis of variance 2 4 6; 3 5 7', { lines: [['F', 0.375]] }], // two groups: F = t² ; SSB 1.5, SSW 16 → F = 1.5/(16/4)
  ['anova 5 5 5; 5 5 6', { text: [/F/] }], // tiny within variance still answers
  ['one way anova at alpha 0.01: 1 2 3; 4 5 6; 7 8 9', { v: 0.001, tol: 1e-6, text: [/α = 0.01/] }],

  // ---------- two-way ANOVA ----------
  ['two way anova without replication [[4,6,8],[5,7,9],[7,8,12],[6,9,11]]', { lines: [['F (rows)', 18], ['F (columns)', 61]] }], // SSR 18, SSC 40.667, SSE 2 (hand computed)
  ['two-way anova 4 6 8; 5 7 9; 7 8 12; 6 9 11', { lines: [['F (rows)', 18], ['F (columns)', 61], ['p (columns)', 0.0001029968]] }], // F(2,6) closed form p
  ['two way anova with replication 4 5 | 6 7 | 8 10 ; 5 6 | 9 8 | 12 13', { lines: [['F (A)', 18.77778], ['F (B)', 44.33333], ['F (A×B)', 2.111111], ['p (B)', 0.0002546024], ['p (A×B)', 0.2022171]] }], // balanced 2×3×2, SSA 14.083, SSB 66.5, SSAB 3.1667, SSE 4.5; F(2,6) closed form
  ['two way anova\nA,B,y\na1,b1,4\na1,b1,5\na1,b2,6\na1,b2,7\na1,b3,8\na1,b3,10\na2,b1,5\na2,b1,6\na2,b2,9\na2,b2,8\na2,b3,12\na2,b3,13', { lines: [['F (A)', 18.77778], ['F (B)', 44.33333], ['F (A×B)', 2.111111]] }], // same data, long format

  // ---------- equal variances ----------
  [`bartlett test ${INSECTS}`, { v: 9.085e-5, tol: 1e-3, lines: [['K²', 25.95983]] }], // R bartlett.test(count ~ spray): K² = 25.96, p = 9.085e-05
  [`levene test ${INSECTS}`, { v: 0.004223, tol: 1e-3, lines: [['F', 3.821356]] }], // car::leveneTest (center = median): F = 3.8214, p = 0.004223
  [`levene test mean ${INSECTS}`, { lines: [['F', 6.455353]] }], // original Levene (center = mean), ANOVA on |x − mean|

  // ---------- chi-square test of independence ----------
  ['chi-square test of independence [[762, 327, 468], [484, 239, 477]]', { v: 2.954e-7, tol: 1e-3, lines: [['χ²', 30.07015]], text: [/Cramér/] }], // R chisq.test docs: X² = 30.07, df = 2, p = 2.954e-07
  ['contingency table 762 327 468; 484 239 477', { lines: [['χ²', 30.07015]] }],
  ['chi square test of homogeneity [[83,3],[90,3],[129,7],[70,12]]', { v: 0.005585, tol: 1e-3, lines: [['χ²', 12.60041]] }], // R prop.test(smokers, patients): X² = 12.6, df 3, p = 0.005585
  ['chi-square independence 10 20; 30 40', { v: 0.3729985, tol: 1e-4, lines: [['χ²', 0.7936508]] }], // closed form, df 1
  ['chi-square independence with yates correction 10 20; 30 40', { v: 0.5040359, tol: 1e-4, lines: [['χ²', 0.4464286]] }], // continuity-corrected
  ['test of independence\n10,20\n30,40', { lines: [['χ²', 0.7936508]] }],
  ['chi-square test [[10, 20], [30, 40]]', { lines: [['χ²', 0.7936508]] }], // a matrix is a contingency table, not 4 categories
  ['chi-square test of independence [[20, 30], [30, 20]]', { lines: [['χ²', 4]] }], // E = 25 everywhere: 4·25/25
  ['is there an association chi-square [[5,10],[10,5]] cramer', { lines: [['χ²', 3.333333], ["Cramér's V", 0.3333333]] }], // E = 7.5: 4·6.25/7.5 ; V = √(3.33/30)

  // ---------- Fisher's exact and McNemar ----------
  ["fisher's exact test [[3, 1], [1, 3]]", { v: 0.4857143, tol: 1e-6 }], // R fisher.test(TeaTasting): p = 0.4857 (= 34/70)
  ['fisher exact test [[1, 9], [11, 3]]', { v: 0.002759456, tol: 1e-4 }], // hypergeometric enumeration (two-sided, sum of tables no more likely): 0.0027595
  ['fisher exact test 3 1; 1 3 greater', { v: 0.2428571, tol: 1e-6 }], // R: alternative = "greater" p = 17/70
  ['mcnemar test [[794, 86], [150, 570]]', { v: 4.114562e-5, tol: 1e-3, lines: [['χ²', 16.8178]] }], // (|86 − 150| − 1)² / 236
  ['mcnemar test without correction [[794, 86], [150, 570]]', { lines: [['χ²', 17.35593]] }], // (86 − 150)² / 236

  // ---------- two proportions and A/B tests ----------
  ['two proportion z test 45 of 100 vs 30 of 90', { v: 0.1004395, tol: 1e-4, lines: [['z', 1.642727]] }], // pooled z, closed form
  ['A/B test A: 120 conversions of 2400, B: 150 of 2300', { v: 0.02501502, tol: 1e-4, lines: [['z', -2.241171]] }], // pooled two-proportion z
  ['ab test control 120/2400 variant 150/2300', { v: 0.02501502, tol: 1e-4 }],
  ['compare two proportions 50 out of 100 and 50 out of 100', { v: 1, tol: 1e-9, lines: [['z', 0]] }],
  ['two proportion z test 60 of 100 vs 40 of 100', { lines: [['z', 2.828427]] }], // p = .5 pooled: 0.2 / √(0.25·0.02)
  ['two proportion z test 60 of 100 vs 40 of 100 one-sided greater', { v: 0.002338867, tol: 1e-4 }], // 1 − Φ(2.8284)
  ['A/B test sample size baseline 10% target 12%', { v: 3841, tol: 0 }], // n = (z.975√(2p̄q̄) + z.8√(p1q1+p2q2))²/δ² = 3840.85
  ['ab test sample size baseline 10% mde 2 percentage points', { v: 3841, tol: 0 }],
  ['a/b test sample size baseline 5% mde 20% relative', { v: 8158, tol: 0 }], // 5% → 6%: 8157.73
  ['ab test how many users per variant baseline conversion 10% minimum detectable effect 2% power 80%', { v: 3841, tol: 0, text: [/absolute/] }],

  // ---------- power and sample size ----------
  ['power of t test n 20 delta 1 sd 1', { v: 0.8689528, tol: 1e-5 }], // R power.t.test(n = 20, delta = 1): 0.8689528
  ['sample size for two sample t test power 0.9 delta 1 sd 1', { v: 23, tol: 0, lines: [['Exact n', 22.0211]] }], // R power.t.test(power = .90, delta = 1): n = 22.02110
  ['sample size t test effect size d 0.5 power 80%', { v: 64, tol: 0, lines: [['Exact n', 63.76576]] }], // pwr.t.test(d = .5, power = .8): n = 63.76576
  ['power two proportions n 50 p1 0.5 p2 0.75', { v: 0.7401659, tol: 1e-5 }], // R power.prop.test(n = 50, p1 = .5, p2 = .75): 0.7401659
  ['sample size two proportions p1 0.5 p2 0.75 power 0.9', { v: 77, tol: 0, lines: [['Exact n', 76.70693]] }], // R power.prop.test(p1 = .5, p2 = .75, power = .9): n = 76.7
  ['power of z test mu0 100 mu1 105 sigma 15 n 36 one-sided', { v: 0.6387600, tol: 1e-5 }], // 1 − Φ(1.645 − 2)
  ['power of z test mu0 100 mu1 105 sigma 15 n 36', { v: 0.5160053, tol: 1e-5 }], // two-sided: both rejection tails
  ['type ii error z test mu0 100 mu1 105 sigma 15 n 36 one-sided', { v: 0.3612400, tol: 1e-5 }], // β = 1 − power
  ['type i error reject if xbar > 105 mu0 100 sigma 15 n 36', { v: 0.02275013, tol: 1e-5 }], // P(Z > 2)
  ['type ii error reject if xbar > 105 mu0 100 mu1 108 sigma 15 n 36', { v: 0.1150697, tol: 1e-5 }], // Φ(−1.2)
  ['sample size z test delta 5 sigma 10 power 0.8 one sample', { v: 32, tol: 0, lines: [['Exact n', 31.39552]] }], // ((1.959964 + 0.841621)·10/5)²
  ['power of one sample t test n 10 delta 1 sd 1', { v: 0.8030969, tol: 1e-4 }], // noncentral t (df 9, ncp √10): independent numerical integration 0.8030969

  // ---------- margin of error ----------
  ['margin of error n 1000 95%', { v: 0.03098975, tol: 1e-5 }], // 1.959964·√(.25/1000)
  ['margin of error n=400 p=0.3 99% confidence', { v: 0.05901966, tol: 1e-5 }], // 2.575829·√(.21/400)
  ['survey margin of error 1000 respondents population 5000', { v: 0.02772085, tol: 1e-5 }], // with finite population correction √((N−n)/(N−1))
  ['margin of error sample size 2500 90% confidence', { v: 0.01644854, tol: 1e-5 }], // 1.644854·√(.25/2500)

  // ---------- effect sizes ----------
  ["cohen's d mean1 105 sd1 15 n1 30 mean2 100 sd2 14 n2 25", { v: 0.3435084, tol: 1e-5 }], // pooled SD
  ["cohen's d 2 4 6 vs 4 6 8", { v: -1, tol: 1e-9 }], // diff −2, pooled SD 2
  ['effect size cohens d mean1 10 mean2 12 sd1 2 sd2 2', { v: -1, tol: 1e-9 }], // equal SDs, no n: pooled = 2

  // ---------- nonparametric tests ----------
  ['mann whitney x: 0.80 0.83 1.89 1.04 1.45 1.38 1.91 1.64 0.73 1.46 y: 1.15 0.88 0.90 0.74 1.21 alternative greater', { v: 0.1272061, tol: 1e-4, lines: [['W', 35]] }], // R wilcox.test docs: W = 35, p = 0.1272
  ['mann-whitney u test x: 0.80 0.83 1.89 1.04 1.45 1.38 1.91 1.64 0.73 1.46 y: 1.15 0.88 0.90 0.74 1.21', { v: 0.2544123, tol: 1e-4, lines: [['W', 35]] }], // two-sided = 2 × 0.1272
  ['mann whitney 1 2 2 3 4 5 vs 3 4 4 6 7 8 8', { v: 0.0304825, tol: 1e-4, lines: [['W', 5.5]], text: [/ties/i] }], // R normal approx with tie + continuity correction
  ['wilcoxon rank sum test 1 2 3 vs 4 5 6', { v: 0.1, tol: 1e-6, lines: [['W', 0]] }], // exact: 2/C(6,3) = 2/20
  ['mann whitney 1 2 3 4 vs 5 6 7 8 one-sided less', { v: 0.01428571, tol: 1e-6 }], // exact 1/C(8,4) = 1/70
  ['wilcoxon signed rank paired x: 1.83 0.50 1.62 2.48 1.68 1.88 1.55 3.06 1.30 y: 0.878 0.647 0.598 2.05 1.06 1.29 1.06 3.14 1.29 alternative greater', { v: 0.01953125, tol: 1e-5, lines: [['V', 40]] }], // R wilcox.test docs: V = 40, p = 0.01953
  ['wilcoxon signed rank test 1.83 0.50 1.62 2.48 1.68 1.88 1.55 3.06 1.30 vs 0.878 0.647 0.598 2.05 1.06 1.29 1.06 3.14 1.29 paired', { v: 0.0390625, tol: 1e-5, lines: [['V', 40]] }], // two-sided 2 × 10/512
  ['wilcoxon signed rank test 1 2 3 4 5 median 0', { v: 0.0625, tol: 1e-6, lines: [['V', 15]] }], // exact: 2·(1/32)
  ['wilcoxon signed-rank 2 -1 3 4 5 6 against 0', { v: 0.0625, tol: 1e-6, lines: [['V', 20]] }], // exact: P(V ≥ 20) = P(V⁻ ≤ 1) = 2/64, two-sided 4/64
  ['sign test 5 7 8 3 9 10 12 6 median 4', { v: 0.0703125, tol: 1e-6 }], // exact binomial: 7 above, 1 below → 2·9/256
  ['sign test 1 2 3 4 5 6 7 8 9 10 against median 0', { v: 0.001953125, tol: 1e-5 }], // 2·(1/1024)
  ['sign test before: 10 12 14 11 13 after: 12 15 16 13 15', { v: 0.0625, tol: 1e-6 }], // 5 of 5 increase: 2/32
  ['kruskal wallis 2.9 3.0 2.5 2.6 3.2; 3.8 2.7 4.0 2.4; 2.8 3.4 3.7 2.2 2.0', { v: 0.68, tol: 1e-3, lines: [['H', 0.7714286]] }], // R kruskal.test docs (Hollander & Wolfe): 0.77143, df 2, p = 0.68
  [`kruskal-wallis test ${INSECTS}`, { v: 1.511e-10, tol: 1e-3, lines: [['H', 54.69134]] }], // R kruskal.test(count ~ spray): 54.691, df 5, p = 1.511e-10
  ['kruskal wallis 1 2 3; 4 5 6; 7 8 9', { lines: [['H', 7.2]] }], // 12/(9·10)·(36+225+576)/3 − 30
  ['spearman correlation x: 1 2 3 4 5 y: 2 1 4 3 5', { v: 0.1333333, tol: 1e-5, lines: [['ρ', 0.8]] }], // exact permutation: 8/120 one side, doubled
  ['spearman x: 1 2 3 4 5 6 7 8 y: 2 1 4 3 6 5 8 7', { v: 0.004563492, tol: 1e-5, lines: [['ρ', 0.9047619]] }], // exact permutation count over 8!
  ['spearman rank correlation x: 1 2 3 4 5 y: 5 4 3 2 1', { lines: [['ρ', -1]] }],
  ["kendall's tau x: 1 2 3 4 5 6 7 8 y: 2 1 4 3 6 5 8 7", { lines: [['τ', 0.7142857]] }], // C = 24, D = 4: 20/28
  ['kendall tau x: 1 2 3 4 y: 1 3 2 4', { lines: [['τ', 0.6666667]] }], // 5 concordant, 1 discordant

  // ---------- psychometrics ----------
  ["cronbach's alpha [[3,4,3,4],[5,5,4,5],[2,3,2,2],[4,4,5,4],[3,2,3,3]]", { v: 0.9254902, tol: 1e-6 }], // k/(k−1)·(1 − Σs²ᵢ/s²ₜ)
  ['cronbach alpha\n3 4 3 4\n5 5 4 5\n2 3 2 2\n4 4 5 4\n3 2 3 3', { v: 0.9254902, tol: 1e-6 }],
  ['cronbach alpha [[1,1],[2,2],[3,3]]', { v: 1, tol: 1e-9 }], // identical items: α = 1
  ['t-score for 130 mean 100 sd 15', { v: 70, tol: 1e-9, lines: [['z', 2]] }], // T = 50 + 10z
  ['t score of 85 with mean 100 and sd 15', { v: 40, tol: 1e-9 }],
  ['stanine for 130 mean 100 sd 15', { v: 9, tol: 0 }], // 2z + 5 = 9
  ['stanine of 103 mean 100 sd 15', { v: 5, tol: 0 }], // z = 0.2 → round(5.4) = 5

  // ---------- meta-analysis ----------
  ['meta-analysis effects 0.2 0.5 0.3 se 0.1 0.2 0.15', { v: 0.2704918, tol: 1e-6, lines: [['Q', 1.852459], ['τ²', 0], ['I²', 0]] }], // inverse-variance; Q < df so τ² = 0
  ['meta analysis effects 0.1 0.9 0.4 -0.2 se 0.1 0.15 0.2 0.12', { v: 0.2901816, tol: 1e-5, lines: [['Q', 34.87726], ['τ²', 0.1920825], ['Fixed-effect estimate', 0.1930233]] }], // DerSimonian–Laird, closed form
  ['common-effect (fixed) meta-analysis effects 0.1 0.9 0.4 -0.2 se 0.1 0.15 0.2 0.12', { v: 0.1930233, tol: 1e-5 }],
  ['pooled effect estimates 0.5 0.5 variances 0.04 0.01', { v: 0.5, tol: 1e-9 }],

  // ---------- resampling ----------
  ['jackknife standard error of the mean of 2 4 4 4 5 5 7 9', { v: 0.7559289, tol: 1e-6 }], // = s/√n = 2.13809/√8
  ['jackknife bias of the population variance of 2 4 4 4 5 5 7 9', { v: -0.5714286, tol: 1e-6 }], // bias = −s²/n = −(32/7)/8
  ['jackknife variance of 2 4 4 4 5 5 7 9', { lines: [['Bias', 0]] }], // sample variance is unbiased: jackknife bias 0
  ['bootstrap 95% ci for the mean of 1 2 3 4 5 6 7 8 9 10 seed 42 b 2000', { text: [/seed 42/i, /2,?000/] }],
  ['bootstrap confidence interval for the median of 3 5 7 9 11 13 seed 7', { text: [/median/i] }],

  // ---------- survival ----------
  ['kaplan meier times 6 6 6 7 10 status 1 1 0 1 0', { v: 7, tol: 0, lines: [['S(6)', 0.6], ['S(7)', 0.3]] }], // hand product-limit
  ['kaplan-meier 6, 6, 6+, 7, 10+', { v: 7, tol: 0, lines: [['S(7)', 0.3]] }],
  [`kaplan meier ${MP}`, { v: 23, tol: 0, lines: [['S(10)', 0.7529412], ['S(23)', 0.4481793]] }], // Kleinbaum & Klein, 6-MP arm: median 23 weeks, S(10) = .753
  ['kaplan meier survival at 8 times 6 6 6 7 10 status 1 1 0 1 0', { v: 0.3, tol: 1e-9 }],
  [`log-rank test group 1: ${MP}; group 2: ${PLACEBO}`, { v: 4.1688e-5, tol: 1e-3, lines: [['χ²', 16.79294]] }], // Kleinbaum & Klein: log-rank 16.79; R survdiff Chisq = 16.8, p = 4e-05
  ['logrank test 1 2 3 4 5 vs 1 2 3 4 5', { lines: [['χ²', 0]] }], // identical groups
];

describe('stats-plus tests battery', () => {
  it.each(CASES)('%s', async (q, c) => {
    await check(q, c);
  });

  it('bootstrap is reproducible and brackets the estimate', async () => {
    const q = 'bootstrap 95% ci for the mean of 1 2 3 4 5 6 7 8 9 10 seed 42 b 2000';
    const a = await run(q);
    const b = await run(q);
    if (a.kind !== 'answer' || b.kind !== 'answer') throw new Error('bootstrap failed');
    expect(a.result.primary.display).toBe(b.result.primary.display);
    const [lo, hi] = a.result.primary.plain.split(',').map(Number) as [number, number];
    expect(lo).toBeLessThan(5.5);
    expect(hi).toBeGreaterThan(5.5);
    expect(lo).toBeGreaterThan(3); // CLT: 5.5 ± 1.96·0.91 ≈ 3.7 to 7.3
    expect(hi).toBeLessThan(8);
  });

  it.each([
    ['anova 1 2 3', /two groups|at least 2 groups/i], // one group only
    ['chi-square test of independence [[1, -2], [3, 4]]', /negative/i],
    ['fisher exact test [[1,2,3],[4,5,6]]', /2×2/],
    ['kaplan meier times 1 2 3 status 1 0', /same number/i],
    ['margin of error n 0', /positive|at least/i],
    ['mann whitney 1 vs 2', /at least/i],
  ])('refuses %s', async (q, re) => {
    const o = await run(q);
    expect(o.kind, q).toBe('error');
    if (o.kind === 'error') expect(o.error.message).toMatch(re);
  });

  it('leaves goodness-of-fit and plain inputs to the basic engine', async () => {
    const gof = await run('chi-square observed 50, 30, 20 expected 40, 40, 20');
    expect(gof.kind === 'answer' && gof.result.expression).toMatch(/goodness-of-fit/);
    const pw = await run('2 to the power of 10');
    expect(pw.kind).toBe('calc');
  });
});
