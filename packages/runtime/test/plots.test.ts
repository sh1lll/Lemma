import { createSession } from '@lemma/math-core';
import { describe, expect, it } from 'vitest';
import { Runtime } from '../src';

// Phase 3 graphs: curve fits and statistical plots answer in text with a chart attached; 3D requests are graphs.
const rt = new Runtime();
const run = (q: string) => rt.compute(q, createSession(), { liveRates: false });

describe('routing of fits, statistical plots and 3D graphs', () => {
  it.each([
    ['fit a line to (1,2) (2,4.1) (3,5.9)', 'regression', 'y = 1.95x + 0.1'],
    ['quadratic regression of (1,1) (2,4) (3,9) (4,16)', 'regression', 'y = x²'],
    ['exponential regression of (0,3) (1,6) (2,12)', 'regression', 'y = 3·e^(0.693147x)'],
    ['best fit for x=1,2,3 y=2,4,6', 'regression', 'y = 2x + 0'],
    ['histogram of 1 2 2 3 3 3 4', 'histogram', '4 bars'],
    ['draw a histogram of 4, 8, 15, 16, 23, 42', 'histogram', '5 bins'],
    ['box plot of 1 2 3 4 5 6 7 8 9 100', 'box', '5.5'],
    ['dot plot 1 2 2 3', 'dot', '4 dots'],
    ['scatter plot (1,2) (2,4) (3,6)', 'scatter', '1'],
    ['normal curve mean 100 sd 15 shade above 130', 'normal', '0.022750132'],
    ['shade P(-1<z<1)', 'normal', '0.68268949'],
  ])('%s → %s chart', async (q, type, display) => {
    const o = await run(q);
    expect(o.kind, q).toBe('answer');
    if (o.kind !== 'answer') return;
    expect(o.result.plot?.type).toBe(type);
    expect(o.result.primary.display).toBe(display);
  });

  it.each(['graph z = sin(x)*cos(y)', '3d plot x^2 - y^2', 'z = x*y'])('%s → 3D graph', async (q) => {
    const o = await run(q);
    expect(o.kind, q).toBe('graph');
    if (o.kind === 'graph') expect(o.spec.items[0]!.kind).toBe('surface');
  });

  it('refusals are errors with the reason', async () => {
    const o = await run('exponential regression of (1,2) (2,-1) (3,5)');
    expect(o.kind === 'error' && o.error.message).toMatch(/every y above 0/);
    const few = await run('quadratic regression of (1,2) (2,3)');
    expect(few.kind === 'error' && few.error.message).toMatch(/at least 3 points/);
  });

  it('ordinary graphs and statistics still route as before', async () => {
    expect((await run('graph sin(x)')).kind).toBe('graph');
    const m = await run('mean of 3, 5, 7');
    expect(m.kind === 'answer' && m.result.plot).toBeUndefined();
  });
});
