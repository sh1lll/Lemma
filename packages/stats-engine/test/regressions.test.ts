import { describe, expect, it } from 'vitest';
import { answerStats } from '../src';

describe('stats regressions', () => {
  it.each(['invt(0.975, 0)', 'invt(1.5, 10)', 'tcdf(-2, 2, 0)'])('%s is refused', (q) => {
    expect(answerStats(q)?.ok).toBe(false);
  });
  it('names the variance in its own error', () => {
    const r = answerStats('variance of 5');
    expect(r && !r.ok && r.error.message).toMatch(/sample variance/);
  });

  describe('a bare number above 1 is never silently read as a percentage', () => {
    it.each([
      ['binomial n=10 p=1.5 k=3', /1\.5 isn't.*"1\.5%"/],
      ['invnorm(1.5)', /between 0 and 1/],
      ['inverse normal 1.5', /between 0 and 1/],
      ['bayes P(A)=30 P(B|A)=0.9 P(B|not A)=0.1', /30 isn't/],
      ['prevalence 2 sensitivity 0.9 specificity 0.95', /prevalence must be between 0 and 1/],
      ['sample size margin of error 3 proportion', /margin of error must be between 0 and 1/],
      ['one sample t test 5,6,7,8 mu0 4 alpha 5', /significance level/],
    ])('%s is refused', (q, msg) => {
      const r = answerStats(q);
      expect(r && !r.ok && r.error.message, q).toMatch(msg);
    });

    it.each([
      ['binomial n=10 p=15% k=3', '0.12983372'],
      ['binomial n=10 p=15 percent k=3', '0.12983372'],
      ['binomial n=10 p=0.15 k=3', '0.12983372'],
      ['invnorm(0.95)', '1.6448536'],
      ['inverse normal 95%', '1.6448536'],
      ['percentile 90 standard normal', '1.2815516'], // a percentile is a percentage by definition
      ['sample size margin of error 3 percent', '1,068'],
    ])('%s is accepted', (q, want) => {
      const r = answerStats(q);
      expect(r && r.ok && r.primary.display, q).toBe(want);
    });
  });
});
