import { MathError, type AnswerResult } from '@lemma/math-core';
import { bayes } from './bayes';
import { KIND, need, normalize, type Ctx, type Handler } from './common';
import { descriptive } from './descriptive';
import { binomial, exponential, geometric, normal, poisson, tiFunctions, uniform } from './distributions';
import { chiSquare, confInterval, critical, oneSampleTest, sampleSize, twoSample } from './inference';
import { paired } from './paired';
import { plots } from './plots';
import { regression } from './regression';

/** A z-score of a value is descriptive, but must be claimed before the normal-distribution handler. */
const zScore: Handler = (c) =>
  /\bz[- ]?scores?\b|\bstandard score\b/.test(c.s) && !/\bprobab|\bpercentile\b|\bp\s*\(|\bchance\b|\barea\b/.test(c.s) ? descriptive(c) : null;

/** "P(X < 3)" with no distribution named: ask rather than guess. */
const unknownDistribution: Handler = (c) =>
  /\bp\s*\(\s*[^)|]*[<>=][^)]*\)/.test(c.s)
    ? need(c, 'Which distribution? (e.g. "normal mean 100 sd 15", "binomial n=10 p=0.5", "poisson lambda=3")')
    : null;

// Order matters: specific intents before broad ones ("mean" appears in tests, intervals and distributions).
// Plots and curve fits go first: "exponential regression" and "normal curve … shade" must not reach the distributions.
const HANDLERS: Handler[] = [
  regression,
  plots,
  tiFunctions,
  bayes,
  critical,
  sampleSize,
  chiSquare,
  twoSample,
  oneSampleTest,
  confInterval,
  zScore,
  geometric,
  poisson,
  exponential,
  uniform,
  binomial,
  normal,
  paired,
  descriptive,
  unknownDistribution,
];

export { evalModel, type Model, type ModelKind, type StatPlot } from './plot';
export { boxStats, histogramBins } from './plots';
export { fitModel, lstsq } from './regression';

/**
 * Statistics and probability: descriptive statistics, paired data, curve fits, plots, distributions, Bayes and inference.
 * Returns null when the input is not one of these questions.
 */
export function answerStats(input: string): AnswerResult | null {
  const s = normalize(input);
  if (!s || !LOOKS_LIKE_STATS.test(s)) return null;
  const c: Ctx = { input, s, rest: s };
  for (const h of HANDLERS) {
    c.rest = s;
    try {
      const r = h(c);
      if (r) return r;
    } catch (e) {
      return { ok: false, kind: KIND, input, error: e instanceof MathError ? e : new MathError('domain', e instanceof Error ? e.message : String(e)) };
    }
  }
  return null;
}

/** Cheap pre-check: true for every phrasing answerStats supports (and some it doesn't). */
export const LOOKS_LIKE_STATS =
  /\b(?:means?|average|avg|median|modes?|range|variance|var|std|stdev|stddev|sd|sigma|standard (?:dev|deviation|score|normal)|quartiles?|q[13]|iqr|inter-?quartile|percentile|quantile|sum|total|add up|count|how many|min|max|minimum|maximum|smallest|largest|lowest|highest|biggest|skew\w*|kurtosis|z[- ]?scores?|standardi[sz]e|weighted|summary|summari[sz]e|stats|statistics|describe|descriptive|five[- ]number|5[- ]number|geometric|harmonic|covariance|cov|correl\w*|pearson|r value|coefficient of determination|r[- ]?squared|regress\w*|best[- ]fit|least[- ]squares|trend ?line|linear (?:fit|model)|line of fit|predict\w*|slope|intercept|probabilit\w*|probable|chance|odds|likelihood|normal(?:ly)?|bell|gaussian|binom\w*|poisson|exponential(?:ly)?|uniform(?:ly)?|heads?|tails?|coins?|flips?|toss\w*|dice|die|rolls?|trials?|success\w*|bayes\w*|prevalence|sensitivity|specificity|false positive|prior|confidence|interval|ci|[tz][- ]?tests?|ttest|ztest|two[- ]sample|2[- ]sample|one[- ]sample|1[- ]sample|welch|hypothesis|significan\w*|chi|chi-square|goodness of fit|gof|sample size|margin of error|critical|[tz][- ]?star|invnorm|norminv|normalcdf|normcdf|binompdf|binomcdf|poissonpdf|poissoncdf|invt|tcdf|paired|unpaired|proportion|fit\w*|histograms?|box ?plots?|boxplots?|whiskers?|dot ?plots?|scatter\w*|shade|quadratic|cubic)\b|\bp\s*\(|[μσλχ]/i;
