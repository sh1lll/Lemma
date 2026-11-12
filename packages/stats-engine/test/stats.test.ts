import type { Answer } from '@lemma/math-core';
import { describe, expect, it } from 'vitest';
import { answerStats, LOOKS_LIKE_STATS } from '../src';
import {
  betaInc, binomCdf, binomPmf, chi2Cdf, chi2Inv, chi2Sf, erf, erfc, gamma, gammaP, gammaQ, lnGamma, normCdf, normInv, normSf,
  poissonCdf, poissonPmf, tCdf, tInv,
} from '../src/special';

// Every expected value below comes from an outside reference (closed forms, standard tables,
// Excel / R documentation examples, Python's math & statistics modules), never from this engine.

function ask(input: string): Answer {
  const r = answerStats(input);
  if (!r) throw new Error(`"${input}" not recognised`);
  if (!r.ok) throw new Error(`"${input}" failed: ${r.error.message}`);
  expect(r.kind).toBe('stats');
  return r;
}
const num = (input: string) => ask(input).value!.toNumber();
const line = (input: string, label: string) => ask(input).lines?.find((l) => l.label === label)?.display;
const lineNum = (input: string, label: string) => Number(line(input, label)!.replace(/,/g, '').replace('−', '-'));
function close(actual: number, expected: number, rel = 1e-6) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(expected)));
}
function asks(input: string, pattern: RegExp) {
  const r = answerStats(input);
  expect(r, input).not.toBeNull();
  expect(r!.ok, input).toBe(false);
  if (r && !r.ok) {
    expect(r.error.code).toBe('ambiguous-reference');
    expect(r.error.message).toMatch(pattern);
  }
}

describe('special functions', () => {
  it('gamma and lnGamma', () => {
    close(gamma(0.5), Math.sqrt(Math.PI), 1e-14);
    close(gamma(1.5), Math.sqrt(Math.PI) / 2, 1e-14);
    expect(gamma(5)).toBe(24);
    close(gamma(-0.5), -2 * Math.sqrt(Math.PI), 1e-13);
    close(lnGamma(100), 359.1342053695754, 1e-14); // ln(99!)
    close(lnGamma(0.5), Math.log(Math.PI) / 2, 1e-14);
  });

  it('erf and erfc', () => {
    close(erf(1), 0.8427007929497149, 1e-14);
    close(erf(0.5), 0.5204998778130465, 1e-14);
    close(erf(-1), -0.8427007929497149, 1e-14);
    close(erfc(3) / 2.2090496998585438e-5, 1, 1e-12);
    expect(erf(0)).toBe(0);
  });

  it('normal CDF and inverse', () => {
    close(normCdf(1.96), 0.9750021048517795, 1e-14);
    close(normCdf(-3), 0.0013498980316301, 1e-12);
    close(normSf(8) / 6.220960574271785e-16, 1, 1e-9);
    close(normInv(0.975), 1.959963984540054, 1e-13);
    close(normInv(0.995), 2.5758293035489, 1e-13);
    close(normInv(1e-8), -5.612001244174789, 1e-12);
    close(normInv(0.5), 0, 1e-15);
  });

  it('incomplete beta and gamma', () => {
    close(betaInc(0.5, 2, 3), 0.6875, 1e-14); // = P(Bin(4, 0.5) ≥ 2) = 11/16
    close(betaInc(0.4, 3, 1), 0.064, 1e-14); // I_x(a, 1) = x^a
    close(betaInc(0.3, 1, 1), 0.3, 1e-14);
    close(gammaP(1, 2), 1 - Math.exp(-2), 1e-14);
    close(gammaQ(1, 30) / Math.exp(-30), 1, 1e-12);
  });

  it('Student t (table values)', () => {
    close(tInv(0.975, 10), 2.228138851986, 1e-10);
    close(tInv(0.975, 1), 12.70620473617, 1e-10);
    close(tInv(0.95, 5), 2.015048373333, 1e-10); // closed-form t CDF for odd df
    close(tInv(0.975, 24), 2.063898561628, 1e-10);
    close(tInv(0.995, 30), 2.749995653, 1e-8);
    close(tInv(0.025, 10), -2.228138851986, 1e-10);
    close(tCdf(2.228138851986, 10), 0.975, 1e-11);
    close(tCdf(1, 1), 0.75, 1e-13); // Cauchy: 1/2 + atan(1)/π
  });

  it('chi-square (table values)', () => {
    close(chi2Inv(0.95, 1), 3.841458820694, 1e-10);
    close(chi2Inv(0.95, 10), 18.307038053275, 1e-10);
    close(chi2Sf(5, 2), Math.exp(-2.5), 1e-13); // df 2 is exponential
    close(chi2Cdf(3.841458820694, 1), 0.95, 1e-10);
  });

  it('discrete distributions', () => {
    expect(binomPmf(3, 10, 0.5)).toBe(0.1171875);
    close(1 - binomCdf(6, 10, 0.6), 0.3822806016, 1e-9);
    close(poissonPmf(2, 3), 4.5 * Math.exp(-3), 1e-13);
    close(poissonCdf(2, 3), 8.5 * Math.exp(-3), 1e-13);
  });
});

describe('descriptive statistics', () => {
  it.each([
    ['mean of 3, 5, 7, 10', 6.25],
    ['average of three, five and seven', 5],
    ['average of twenty five and thirty five', 30],
    ['median of 5, 1, 9, 3', 4],
    ['range of 4, 9, 1', 8],
    ['sum of 0.1, 0.2', 0.3],
    ['count of 4, 5, 6', 3],
    ['min of 4, -2, 9', -2],
    ['max of 4, minus 2, 9', 9],
    ['population standard deviation of 2 4 4 4 5 5 7 9', 2], // Wikipedia "Standard deviation" example
    ['variance of 1,2,3,4', 5 / 3],
    ['population variance of 1, 2, 3, 4', 1.25],
    ['30th percentile of 1, 3, 2, 4', 1.9], // Excel PERCENTILE.INC doc example
    ['IQR of 1,2,3,4,5,6,7,8,9', 5],
    ['skewness of 3,4,5,2,3,4,5,6,4,7', 0.359543071407], // Excel SKEW doc example
    ['kurtosis of 3,4,5,2,3,4,5,6,4,7', -0.151799637208], // Excel KURT doc example
    ['geometric mean of 2, 8', 4],
    ['harmonic mean of 1, 2, 4', 12 / 7],
    ['weighted average of 80, 90, 70 with weights 0.2, 0.5, 0.3', 82],
    ['z-score of 85 with mean 80 and sd 5', 1],
    ['mean of 1,000, 2,000, 3,000', 2000],
    ['mean of 100,200,300', 200],
  ])('%s → %s', (q, expected) => {
    close(num(q), expected, 1e-9);
  });

  it('sample standard deviation is the default and says so', () => {
    const r = ask('std dev of 2 4 4 4 5 5 7 9');
    close(r.value!.toNumber(), Math.sqrt(32 / 7), 1e-12);
    expect(r.expression).toBe('Sample standard deviation of 8 values');
    expect(r.notes.join(' ')).toMatch(/n − 1/);
  });

  it('exact decimal display (no float noise)', () => {
    expect(ask('sum of 0.1, 0.2').primary.display).toBe('0.3');
    expect(ask('mean of 0.1, 0.2').primary.display).toBe('0.15');
  });

  it('quartiles use the median-of-halves method and say so', () => {
    // Wikipedia "Quartile", method 1: Q1 15, Q2 40, Q3 43
    const r = ask('quartiles of 6, 7, 15, 36, 39, 40, 41, 42, 43, 47, 49');
    expect(r.lines?.map((l) => l.display).slice(0, 3)).toEqual(['15', '40', '43']);
    expect(r.notes.join(' ')).toMatch(/median of each half/);
    expect(num('q1 of 1,2,3,4,5,6,7,8')).toBe(2.5);
    expect(num('third quartile of 1,2,3,4,5,6,7,8')).toBe(6.5);
  });

  it('mode: multimodal and none', () => {
    expect(ask('mode of 1, 2, 2, 3, 3').primary.display).toBe('2, 3');
    expect(ask('mode of 1, 2, 3').primary.display).toBe('No mode');
    expect(num('mode of 4, 1, 4, 2')).toBe(4);
  });

  it('z-score within a data set (sample SD)', () => {
    close(num('z-score of 85 in 70, 80, 90, 85, 75'), 5 / Math.sqrt(62.5), 1e-10);
  });

  it('summary table', () => {
    const r = ask('summary of 2 4 4 4 5 5 7 9');
    const row = (k: string) => r.table!.rows.find((x) => x[0] === k)?.[1];
    expect(r.table?.columns).toEqual(['Statistic', 'Value']);
    expect(row('Mean')).toBe('5');
    expect(row('Median')).toBe('4.5');
    expect(row('Mode')).toBe('4');
    expect(row('Population std dev')).toBe('2');
    expect(row('Count')).toBe('8');
    expect(row('Range')).toBe('7');
    expect(ask('stats for 1, 2, 3').table).toBeDefined();
  });

  it('asks for missing data and rejects impossible requests', () => {
    asks('mean', /Which numbers/);
    asks('weighted average of 80, 90, 70', /weights/);
    asks('90th percentile', /Which numbers/);
    const r = answerStats('standard deviation of 5');
    expect(r?.ok).toBe(false);
    const w = answerStats('weighted average of 1, 2 with weights 1');
    expect(w?.ok === false && w.error.message).toMatch(/2 values but 1 weights/);
  });
});

describe('paired data', () => {
  // Classic textbook example: x 1..5, y 2 4 5 4 5 → ŷ = 0.6x + 2.2, r² = 0.6
  const XY = 'x: 1,2,3,4,5 y: 2,4,5,4,5';
  it('correlation', () => {
    close(num(`correlation ${XY}`), Math.sqrt(0.6), 1e-9);
    close(num(`r squared ${XY}`), 0.6, 1e-12);
  });
  it('regression from x/y lists and from points', () => {
    const r = ask(`linear regression ${XY}`);
    expect(r.primary.display).toBe('y = 0.6x + 2.2');
    expect(line(`linear regression ${XY}`, 'Slope')).toBe('0.6');
    expect(line(`linear regression ${XY}`, 'Intercept')).toBe('2.2');
    expect(line(`linear regression ${XY}`, 'r²')).toBe('0.6');
    expect(ask('line of best fit (1,3), (2,5), (3,7), (4,9)').primary.display).toBe('y = 2x + 1');
  });
  it('prediction', () => {
    close(num(`regression ${XY} predict at x=6`), 5.8, 1e-12);
    close(num('regression (1,2), (2,4), (3,5), (4,4), (5,5) predict y when x is 3'), 4, 1e-12);
  });
  it('covariance (sample by default)', () => {
    close(num('covariance x: 1,2,3 y: 2,4,7'), 2.5, 1e-12);
    close(num('population covariance x: 1,2,3 y: 2,4,7'), 5 / 3, 1e-9);
  });
  it('missing or mismatched data', () => {
    asks('correlation', /paired data/);
    const r = answerStats('regression x: 1,2,3 y: 2,4');
    expect(r?.ok === false && r.error.message).toMatch(/3 values but y has 2/);
  });
});

describe('distributions', () => {
  it.each([
    ['P(Z < 1.96)', 0.9750021048517795],
    ['P(Z > 1.645)', 0.04998490553912138],
    ['probability z is less than -1', 0.15865525393145707],
    ['P(-1.96 < Z < 1.96)', 0.9500042097035591],
    ['normal mean 100 sd 15 P(X > 130)', 0.02275013194817921],
    ['probability between 85 and 115 with mean 100 and standard deviation 15', 0.6826894921370859],
    ['what is the probability that x is less than 130 if the mean is 100 and sd is 15', 0.9772498680518208],
    ['normalcdf(-1, 1)', 0.6826894921370859],
    ['probability of exactly 3 heads in 10 flips', 0.1171875],
    ['probability of exactly three heads in ten coin flips', 0.1171875],
    ['binomial n=10 p=0.5 k=3', 0.1171875],
    ['binompdf(10, 0.5, 3)', 0.1171875],
    ['at least 7 successes in 10 trials with p=0.6', 0.3822806016],
    ['probability of at least one six in four rolls of a die', 1 - (5 / 6) ** 4],
    ['binomial n 20 p 0.3 between 4 and 6', 0.5009230076971924],
    ['poisson lambda=3 P(X=2)', 4.5 * Math.exp(-3)],
    ['poisson with mean 3 probability of at most 2', 8.5 * Math.exp(-3)],
    ['geometric p=0.2 first success on trial 3', 0.128],
    ['geometric p 0.2 at most 3 trials', 1 - 0.8 ** 3],
    ['exponential rate 0.5 P(X<2)', 1 - Math.exp(-1)],
    ['exponential mean 10 probability greater than 5', Math.exp(-0.5)],
    ['uniform from 0 to 10 P(X<3)', 0.3],
    ['uniform a=2 b=8 P(3<X<5)', 1 / 3],
  ])('%s → %s', (q, expected) => {
    close(num(q), expected, 1e-8);
  });

  it('inverse normal', () => {
    close(num('inverse normal 0.975'), 1.959963984540054, 1e-7);
    close(num('90th percentile of normal with mean 100 and sd 15'), 119.22327348316901, 1e-7);
    close(num('invnorm(0.95, 100, 15)'), 100 + 15 * 1.6448536269514722, 1e-7);
    close(num('top 10% cutoff normal mean 500 sd 100'), 500 + 100 * 1.2815515655446004, 1e-7);
  });

  it('reports the distribution mean and variance', () => {
    expect(line('binomial n=10 p=0.5 k=3', 'Distribution mean')).toBe('5');
    expect(line('binomial n=10 p=0.5 k=3', 'Distribution variance')).toBe('2.5');
    expect(line('exponential rate 0.5 P(X<2)', 'Distribution variance')).toBe('4');
    expect(line('uniform from 0 to 10 P(X<3)', 'Distribution mean')).toBe('5');
    expect(ask('probability of exactly 3 heads in 10 flips').notes.join(' ')).toMatch(/Fair coin/);
  });

  it('asks for missing parameters instead of guessing', () => {
    asks('binomial n=10 k=3', /probability of success/);
    asks('binomial p=0.5 exactly 3', /How many trials/);
    asks('normal mean 100 P(X > 130)', /standard deviation/);
    asks('normal sd 15 P(X > 130)', /mean/);
    asks('poisson P(X=2)', /rate/);
    asks('P(X<3)', /Which distribution/);
  });
});

describe('Bayes and conditional probability', () => {
  it('symbolic form, with working', () => {
    const q = 'bayes P(A)=0.01 P(B|A)=0.9 P(B|not A)=0.05';
    close(num(q), 0.009 / 0.0585, 1e-10);
    expect(line(q, 'P(B)')).toMatch(/= 0\.0585$/);
    close(num("P(A)=0.01 P(B|A)=0.9 P(B|A')=0.05"), 0.009 / 0.0585, 1e-10);
    close(num('P(B|A)=0.9, P(A)=0.01, P(B)=0.0585, bayes'), 0.009 / 0.0585, 1e-10);
  });
  it('medical-test wording', () => {
    close(num('prevalence 1%, sensitivity 90%, false positive rate 5%'), 0.009 / 0.0585, 1e-10);
    close(num('test sensitivity 99% specificity 95% prevalence 0.1%'), 0.00099 / (0.00099 + 0.05 * 0.999), 1e-10);
  });
  it('P(A|B) from the joint probability', () => {
    close(num('P(A and B) = 0.2, P(B) = 0.5, find P(A|B)'), 0.4, 1e-12);
  });
  it('asks for what is missing', () => {
    asks('bayes P(A)=0.01', /P\(B\|A\)/);
    asks('bayes P(A)=0.01 P(B|A)=0.9', /P\(B\|not A\)/);
  });
});

describe('inference', () => {
  it('t confidence interval from summary statistics', () => {
    // t(0.975, 24) = 2.063899 from tables; 50 ± 2.063899 × 10/5
    const q = '95% confidence interval mean 50 sd 10 n 25';
    close(lineNum(q, 'Lower bound'), 50 - 2.063898561628 * 2, 1e-7);
    close(lineNum(q, 'Upper bound'), 50 + 2.063898561628 * 2, 1e-7);
    expect(ask(q).primary.display).toBe('45.8722 to 54.1278');
  });
  it('z interval when σ is known', () => {
    const q = '99% CI mean 50 sigma 10 n 25';
    close(lineNum(q, 'Lower bound'), 50 - 2.5758293035489 * 2, 1e-7);
    expect(ask(q).notes.join(' ')).toMatch(/σ known/);
  });
  it('t interval from raw data, 95% by default', () => {
    // mean 13, s = √2.5, t(0.975, 4) = 2.776445
    const q = 'confidence interval for 12, 15, 11, 14, 13';
    close(lineNum(q, 'Upper bound'), 13 + (2.776445105198 * Math.sqrt(2.5)) / Math.sqrt(5), 1e-7);
    expect(ask(q).notes.join(' ')).toMatch(/95% confidence/);
  });
  it('proportion interval (Wald)', () => {
    const q = '95% confidence interval for proportion 45 out of 100';
    const me = 1.959963984540054 * Math.sqrt((0.45 * 0.55) / 100);
    close(lineNum(q, 'Lower bound'), 0.45 - me, 1e-7);
    close(lineNum(q, 'Upper bound'), 0.45 + me, 1e-7);
  });

  it('one-sample t-test (R: t.test of the sleep-data differences)', () => {
    // R: t = 4.0621, df = 9, p-value = 0.002833
    const q = 't test 1.2, 2.4, 1.3, 1.3, 0, 1.0, 1.8, 0.8, 4.6, 1.4 against 0';
    close(lineNum(q, 't'), 4.0621, 1e-4);
    expect(line(q, 'Degrees of freedom')).toBe('9');
    close(num(q), 0.002833, 1e-3);
    expect(line(q, 'Decision')).toBe('Reject H₀ at α = 0.05');
    expect(ask(q).notes.join(' ')).toMatch(/α = 0\.05/);
  });
  it('paired t-test equals the one-sample test on differences', () => {
    const q = 'paired t test before: 0.7, -1.6, -0.2, -1.2, -0.1, 3.4, 3.7, 0.8, 0.0, 2.0 after: 1.9, 0.8, 1.1, 0.1, -0.1, 4.4, 5.5, 1.6, 4.6, 3.4';
    close(lineNum(q, 't'), 4.0621, 1e-4);
  });
  it('one-sample t-test from summary statistics, one-sided', () => {
    // t = (52 − 50)/(8/√30) = 1.369306; one-sided p from t(29)
    const q = 'one sample t test mean 52 sd 8 n 30 mu0 50 alternative greater';
    close(lineNum(q, 't'), 2 / (8 / Math.sqrt(30)), 1e-5);
    expect(line(q, 'Hypotheses')).toMatch(/μ > 50/);
    close(2 * num(q), num('one sample t test mean 52 sd 8 n 30 mu0 50'), 1e-4);
  });
  it('z-test for a mean and for a proportion', () => {
    // z = 2 → two-sided p = 0.0455003 (standard normal table)
    close(num('z test mean 52 sigma 3 n 9 against 50'), 0.04550026389635842, 1e-5);
    close(num('z test 60 out of 100 against 0.5'), 0.04550026389635842, 1e-5);
    close(num('z test 60 out of 100 against 0.5 greater'), 0.02275013194817921, 1e-5);
  });
  it('Welch two-sample t-test (R: t.test(extra ~ group, data = sleep))', () => {
    // R: t = -1.8608, df = 17.776, p-value = 0.07939, 95% CI -3.3654832 0.2054832
    const q = 'two sample t test 0.7, -1.6, -0.2, -1.2, -0.1, 3.4, 3.7, 0.8, 0.0, 2.0 vs 1.9, 0.8, 1.1, 0.1, -0.1, 4.4, 5.5, 1.6, 4.6, 3.4';
    close(lineNum(q, 't'), -1.8608, 1e-4);
    close(lineNum(q, 'Degrees of freedom'), 17.776, 1e-4);
    close(num(q), 0.07939, 1e-4);
    expect(line(q, '95% CI for the difference')).toBe('−3.36548 to 0.205483');
    expect(line(q, 'Decision')).toBe('Fail to reject H₀ at α = 0.05');
  });
  it('Welch from summary statistics and labelled groups', () => {
    // hand-computed: se² = 25/30 + 36/35, t = −2/se
    const q = 'welch t test mean1 20 sd1 5 n1 30 mean2 22 sd2 6 n2 35';
    close(lineNum(q, 't'), -2 / Math.sqrt(25 / 30 + 36 / 35), 1e-5);
    // equal n and variances: Welch df = 2(n − 1) = 6, t = −2/√(5/6) … s² = 5/3 each
    const g = 'two sample t test group a: 1, 2, 3, 4 group b: 3, 4, 5, 6';
    close(lineNum(g, 't'), -2 / Math.sqrt(5 / 6), 1e-5);
    close(lineNum(g, 'Degrees of freedom'), 6, 1e-9);
  });
  it('chi-square goodness of fit', () => {
    // χ² = 100/40 + 100/40 + 0 = 5, df 2, p = e^(−2.5)
    const q = 'chi square goodness of fit observed 50, 30, 20 expected 40, 40, 20';
    expect(line(q, 'χ²')).toBe('5');
    expect(line(q, 'Degrees of freedom')).toBe('2');
    close(num(q), Math.exp(-2.5), 1e-5);
    // equal frequencies when no expected values: χ² = (100 + 0 + 100)/... = 14 for 20/30/50
    expect(line('chi square observed 20 30 50', 'χ²')).toBe('14');
    close(num('chi-square goodness of fit observed 50 30 20 expected 0.4 0.4 0.2'), Math.exp(-2.5), 1e-5);
  });
  it('sample size for a proportion and a mean', () => {
    // classic survey values: ±3% → 1068, ±5% → 385 at 95%
    expect(num('sample size for margin of error 3% at 95% confidence')).toBe(1068);
    expect(num('how many people should I survey for a margin of error of 5%')).toBe(385);
    // (2.5758293 × 10 / 2)² = 165.87 → 166
    expect(num('sample size margin of error 2 sigma 10 99% confidence')).toBe(166);
  });
  it('critical values', () => {
    close(num('critical t for 95% confidence df 10'), 2.228139, 1e-6);
    close(num('critical z 95%'), 1.959964, 1e-6);
    close(num('critical chi square df 10 alpha 0.05'), 18.30704, 1e-6);
    close(num('invT(0.975, 10)'), 2.228139, 1e-6);
  });
  it('alpha changes the decision', () => {
    const q = 't test 1.2, 2.4, 1.3, 1.3, 0, 1.0, 1.8, 0.8, 4.6, 1.4 against 0 alpha 0.001';
    expect(line(q, 'Decision')).toBe('Fail to reject H₀ at α = 0.001');
  });
  it('asks for missing inputs', () => {
    asks('hypothesis test mean 52 sd 8 n 30', /testing against/);
    asks('confidence interval mean 50 n 25', /standard deviation/);
    asks('confidence interval', /data or the mean/);
    asks('z test 5.1 4.9 5.6 against 5', /σ/);
    asks('two sample t test 1, 2, 3', /both samples/);
    asks('critical t 95%', /degrees of freedom/);
  });
});

describe('routing', () => {
  it.each(['5 + 5', '20% of 450', '50 miles to km', '5 min to seconds', 'max speed 5 mph', 'range of 300 miles', 'average speed 60 mph for 2 hours', 'probability of rain', ''])(
    '%s → null',
    (q) => {
      expect(answerStats(q)).toBeNull();
    },
  );

  it('LOOKS_LIKE_STATS accepts every supported phrasing', () => {
    for (const q of [
      'mean of 3, 5', 'std dev of 1 2', 'quartiles of 1,2,3', 'z-score of 85 in 1, 2', 'summary of 1, 2', 'correlation x: 1,2 y: 3,4', 'regression (1,2), (2,3)',
      'P(Z < 1.96)', 'probability of exactly 3 heads in 10 flips', 'poisson lambda=3 P(X=2)', 'bayes P(A)=0.01', 'prevalence 1%', '95% CI mean 50 sd 10 n 25',
      't test 1, 2 against 0', 'two sample t test 1,2 vs 3,4', 'chi square observed 1 2', 'sample size margin of error 3%', 'invnorm(0.9)', 'σ = 2', 'normalcdf(-1, 1)',
    ]) {
      expect(LOOKS_LIKE_STATS.test(q), q).toBe(true);
    }
    expect(LOOKS_LIKE_STATS.test('5 + 5')).toBe(false);
    expect(LOOKS_LIKE_STATS.test('50 miles to km')).toBe(false);
  });

  it('returns a Decimal value and spoken text', () => {
    const r = ask('mean of 3, 5, 7, 10');
    expect(r.value?.toString()).toBe('6.25');
    expect(r.primary.spoken).toBe('6.25');
    expect(r.expression).toBe('Mean of 4 values');
  });

  it('answers in well under 5 ms', { retry: 2 }, () => {
    const qs = [
      'summary of 2 4 4 4 5 5 7 9', 'P(Z < 1.96)', 'at least 7 successes in 10 trials with p=0.6', 'critical t for 95% confidence df 10',
      'two sample t test 0.7, -1.6, -0.2, -1.2 vs 1.9, 0.8, 1.1, 0.1', 'binomial n=100000 p=0.3 at most 30100', 'poisson lambda=5000 at most 5100',
      'regression x: 1,2,3,4,5 y: 2,4,5,4,5 predict at x=6', 'sample size for margin of error 3% at 95% confidence',
    ];
    for (const q of qs) answerStats(q); // warm up
    for (const q of qs) {
      const t0 = performance.now();
      const r = answerStats(q);
      const ms = performance.now() - t0;
      expect(r?.ok, q).toBe(true);
      expect(ms, q).toBeLessThan(5);
    }
  });
});
