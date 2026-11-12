import type { Answer } from '@lemma/math-core';
import { describe, expect, it } from 'vitest';
import { answerStats, boxStats, evalModel, fitModel, histogramBins, LOOKS_LIKE_STATS, lstsq, type StatPlot } from '../src';

// Expected values are worked by hand or built into the data (exact curves, and noise orthogonal to the model),
// never read back from this engine.

function ask(input: string): Answer {
  const r = answerStats(input);
  if (!r) throw new Error(`"${input}" not recognised`);
  if (!r.ok) throw new Error(`"${input}" failed: ${r.error.message}`);
  return r;
}
const line = (a: Answer, label: string) => a.lines?.find((l) => l.label === label)?.display;
const plotOf = (a: Answer) => a.plot as StatPlot;
function refuses(input: string, pattern: RegExp) {
  const r = answerStats(input);
  expect(r, input).not.toBeNull();
  expect(r!.ok, input).toBe(false);
  if (r && !r.ok) expect(r.error.message).toMatch(pattern);
}
const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));

describe('least squares', () => {
  it('solves an overdetermined system exactly (QR)', () => {
    // y = 1 + 2t at t = 0, 1, 2 with no noise.
    const c = lstsq([[1, 1, 1], [0, 1, 2]], [1, 3, 5])!;
    close(c[0]!, 1);
    close(c[1]!, 2);
    expect(lstsq([[1, 1], [2, 2]], [1, 2])).toBeNull(); // dependent columns
  });

  it('linear: fit a line to (1,2) (2,4.1) (3,5.9)', () => {
    // Sxx = 2, Sxy = 3.9 → slope 1.95, intercept 0.1; residuals −0.05, 0.1, −0.05 → SSres 0.015, SStot 7.62.
    const a = ask('fit a line to (1,2) (2,4.1) (3,5.9)');
    expect(a.primary.display).toBe('y = 1.95x + 0.1');
    close(Number(line(a, 'r²')), 1 - 0.015 / 7.62, 1e-9);
    expect(line(a, 'Residual std error')).toBe('0.122474');
    expect(line(a, 'Largest residual')).toBe('0.1 at x = 2');
    const p = plotOf(a);
    expect(p.type).toBe('regression');
    if (p.type === 'regression') {
      expect(p.points).toEqual([1, 2, 2, 4.1, 3, 5.9]);
      close(evalModel(p.model, 10), 19.6);
    }
    expect(p.summary).toMatch(/3 points.*linear.*R² = 0\.998/);
  });

  it('linear: best fit for x=… y=… (the list is data, not a prediction point)', () => {
    const a = ask('best fit for x=1,2,3,4 y=3,5,7,9');
    expect(a.primary.display).toBe('y = 2x + 1');
    expect(a.notes.join(' ')).toMatch(/exactly/);
  });

  it('quadratic: noise orthogonal to the parabola leaves y = x² exactly', () => {
    // A 4th difference [1, −4, 6, −4, 1] is orthogonal to 1, x, x² on equally spaced x.
    const a = ask('quadratic regression of (-2,4.01) (-1,0.96) (0,0.06) (1,0.96) (2,4.01)');
    const fit = fitModel('quadratic', [-2, -1, 0, 1, 2], [4.01, 0.96, 0.06, 0.96, 4.01]);
    close(fit.coef[0]!, 1);
    close(fit.coef[1]!, 0, 1e-12);
    close(fit.coef[2]!, 0, 1e-12);
    close(fit.r2, 1 - 0.007 / 14.007);
    expect(a.primary.display).toMatch(/^y = x²/);
    expect(a.notes.join(' ')).toMatch(/no clear pattern/);
  });

  it('cubic on years stays well conditioned', () => {
    const a = ask('cubic regression x: 2000, 2001, 2002, 2003, 2004 y: 0, 1, 8, 27, 64 predict at x = 2005');
    close(a.value!.toNumber(), 125, 1e-8);
    expect(a.notes.join(' ')).toMatch(/outside the data range/);
  });

  it('exponential, power and logarithmic recover exact curves', () => {
    const e = fitModel('exponential', [0, 1, 2, 3], [3, 6, 12, 24]);
    close(e.coef[0]!, 3);
    close(e.coef[1]!, Math.LN2);
    close(e.r2, 1);
    const ea = ask('exponential regression of (0,3) (1,6) (2,12) (3,24)');
    expect(ea.primary.display).toBe('y = 3·e^(0.693147x)');
    expect(line(ea, 'As a·bˣ')).toBe('y = 3·2^x');
    const p = fitModel('power', [1, 4, 9], [2, 16, 54]);
    close(p.coef[0]!, 2);
    close(p.coef[1]!, 1.5);
    const l = fitModel('logarithmic', [1, Math.E, Math.E ** 2], [1, 3, 5]);
    close(l.coef[0]!, 1);
    close(l.coef[1]!, 2);
    expect(ask('log regression of (1,1) (2.718281828459045,3) (7.38905609893065,5)').primary.display).toBe('y = 1 + 2·ln(x)');
    expect(ask('power regression of (1,2) (4,16) (9,54)').primary.display).toBe('y = 2·x^1.5');
  });

  it('notes a curved residual pattern when a line is the wrong model', () => {
    const a = ask('fit a line to x: 1,2,3,4,5,6,7,8 y: 1,4,9,16,25,36,49,64');
    expect(a.notes.join(' ')).toMatch(/runs of one sign.*quadratic/);
  });

  it('refuses with a reason when the model cannot apply', () => {
    refuses('quadratic regression of (1,2) (2,3)', /at least 3 points.*you gave 2/);
    refuses('cubic fit x: 1,1,2,2,3 y: 1,2,3,4,5', /at least 4 points.*3 different x values/);
    refuses('exponential regression of (1,2) (2,-1) (3,5)', /every y above 0.*y = −1 at x = 2/);
    refuses('power regression of (0,1) (1,2) (2,4)', /every x above 0/);
    refuses('logarithmic regression of (-1,1) (1,2) (2,4)', /every x above 0/);
    refuses('fit a line to x: 1 y: 2', /at least 2/);
    const which = answerStats('polynomial regression of (1,2) (2,3) (3,5)');
    expect(which?.ok === false && which.error.message).toMatch(/Which degree/);
  });
});

describe('statistical plots', () => {
  it('histogram: one bar per value for small whole numbers', () => {
    const a = ask('histogram of 1 2 2 3 3 3 4');
    const p = plotOf(a);
    expect(p.type === 'histogram' && p.edges).toEqual([0.5, 1.5, 2.5, 3.5, 4.5]);
    expect(p.type === 'histogram' && p.counts).toEqual([1, 2, 3, 1]);
    expect(a.table?.rows[2]).toEqual(['3', '3', '42.9%']);
    expect(p.summary).toMatch(/tallest bar is 3 with 3 values/);
  });

  it('histogram: Sturges bins with a nice width, or the bins asked for', () => {
    const xs = [1.5, 2.7, 3.1, 4.8, 5.5, 6.2, 7.9, 9.4];
    // n = 8 → 4 bins by Sturges; 7.9 / 4 = 1.975 rounds up to width 2, starting at 0.
    expect(histogramBins(xs)).toEqual({ edges: [0, 2, 4, 6, 8, 10], counts: [1, 2, 2, 2, 1], discrete: false });
    expect(histogramBins(xs, { width: 5 }).counts).toEqual([4, 4]);
    // Width 7.9 / 3 from 1.5: edges 1.5, 4.13, 6.77, 9.4.
    expect(histogramBins(xs, { bins: 3 }).counts).toEqual([3, 3, 2]);
    expect(histogramBins([5, 5, 5]).counts).toEqual([3]);
    const a = ask('histogram of 1.5, 2.7, 3.1, 4.8, 5.5, 6.2, 7.9, 9.4 with bin width 5');
    expect(a.table?.rows.map((r) => r[0])).toEqual(['[0, 5)', '[5, 10]']);
    expect(ask('histogram of 1.5 2.7 3.1 4.8 5.5 6.2 7.9 9.4 with 3 bins').primary.display).toBe('3 bins');
  });

  it('box plot: quartiles, fences and outliers', () => {
    // Halves 1..5 and 6..9,100 → Q1 3, Q3 8, IQR 5, upper fence 15.5.
    expect(boxStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 100])).toEqual({ min: 1, q1: 3, median: 5.5, q3: 8, max: 100, lo: 1, hi: 9, outliers: [100] });
    const a = ask('box plot of 1 2 3 4 5 6 7 8 9 100');
    expect(a.primary.display).toBe('5.5');
    expect(line(a, 'Outliers')).toBe('100');
    expect(plotOf(a).summary).toMatch(/median 5\.5.*1 outlier: 100/);
    expect(line(ask('box and whisker plot 2, 4, 6, 8'), 'Outliers')).toBe('none');
  });

  it('dot plot and scatter plot', () => {
    const d = ask('dot plot of 3 1 2 2 3 3 5');
    const p = plotOf(d);
    expect(p.type === 'dot' && [p.values, p.counts]).toEqual([[1, 2, 3, 5], [1, 2, 3, 1]]);
    expect(line(d, 'Mode')).toBe('3');
    const s = ask('scatter plot (1,2) (2,4) (3,6)');
    expect(s.primary.display).toBe('1');
    expect(plotOf(s).type).toBe('scatter');
    expect(plotOf(s).summary).toMatch(/Strong positive linear association/);
    // With a fit requested, the regression answers (points plus the line).
    expect(plotOf(ask('scatter plot (1,2) (2,4) (3,6.5) with a line of best fit')).type).toBe('regression');
  });

  it('normal curve with a shaded area', () => {
    const a = ask('normal curve mean 100 sd 15 shade above 130');
    close(a.value!.toNumber(), 0.0227501319, 1e-8);
    const p = plotOf(a);
    expect(p.type === 'normal' && [p.mean, p.sd, p.lo, p.hi]).toEqual([100, 15, 130, null]);
    expect(p.summary).toMatch(/area above 130 shaded/);
    const z = ask('shade P(-1<z<1)');
    close(z.value!.toNumber(), 0.6826894921, 1e-8);
    expect(plotOf(z).type === 'normal' && (plotOf(z) as { label: string }).label).toBe('P(−1 < Z < 1) = 0.682689');
    const curve = ask('normal curve mean 100 sd 15');
    expect(curve.primary.display).toBe('μ = 100, σ = 15');
    expect(line(curve, '95% between')).toBe('70 and 130');
    expect(plotOf(ask('bell curve')).summary).toMatch(/Standard normal/);
    refuses('shade P(X > 3) binomial n=10 p=0.5', /normal curve/);
  });

  it('LOOKS_LIKE_STATS accepts the plot phrasings', () => {
    for (const q of ['fit a line to (1,2) (2,3)', 'histogram of 1 2', 'box plot 1 2', 'boxplot 1 2', 'dot plot 1 2', 'scatter plot (1,2) (2,3)', 'shade P(-1<z<1)', 'quadratic regression of (1,2)']) {
      expect(LOOKS_LIKE_STATS.test(q), q).toBe(true);
    }
  });
});
