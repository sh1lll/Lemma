import { createSession } from '@lemma/math-core';
import { answerStats, type StatPlot } from '@lemma/stats-engine';
import { describe, expect, it } from 'vitest';
import { analyze, isGraphRequest, parseGraph, sampleSurface, statPlotSpec } from '../src';

const plotFor = (q: string) => {
  const r = answerStats(q);
  if (!r?.ok || !r.plot) throw new Error(`no plot for ${q}`);
  return r.plot as StatPlot;
};

describe('3D surfaces', () => {
  it('recognises 3D requests, and leaves statistical plots to the statistics engine', () => {
    for (const q of ['graph z = sin(x)*cos(y)', '3d plot x^2 - y^2', 'plot 3d x*y', 'graph the surface x^2 + y^2', 'z = x^2 - y^2', 'draw a 3D graph of sin(x+y)']) {
      expect(isGraphRequest(q), q).toBe(true);
    }
    for (const q of ['plot a histogram of 1 2 3', 'draw a box plot of 1 2 3', 'graph the normal curve mean 100 sd 15', 'plot (1,2) (2,4) with a line of best fit', 'graph the regression of (1,2) (2,3)']) {
      expect(isGraphRequest(q), q).toBe(false);
    }
    // Ordinary graphs are unaffected.
    expect(isGraphRequest('graph sin(x)')).toBe(true);
    expect(isGraphRequest('y = 2x + 1')).toBe(true);
  });

  it('parses z = f(x, y) into one surface with sliders for other letters', () => {
    const s = createSession();
    const g = parseGraph('graph z = sin(x)*cos(y)', s);
    expect(g.items).toHaveLength(1);
    const it0 = g.items[0]!;
    expect(it0.kind).toBe('surface');
    if (it0.kind !== 'surface') return;
    expect(it0.label).toBe('z = sin(x) × cos(y)');
    expect(it0.x).toEqual([-5, 5]);
    expect(it0.f({ x: Math.PI / 2, y: 0 })).toBeCloseTo(1, 12);
    const h = parseGraph('3d plot x^2 - y^2', s).items[0]!;
    expect(h.kind === 'surface' && h.f({ x: 3, y: 2 })).toBe(5);
    const a = parseGraph('3d plot a*x*y from -2 to 2', s);
    expect(a.sliders.map((x) => x.name)).toEqual(['a']);
    expect(a.items[0]!.kind === 'surface' && a.items[0]!.x).toEqual([-2, 2]);
    expect(() => parseGraph('3d plot x^2 + y^2 = 1', s)).toThrow(/z = f\(x, y\)/);
    // analyze() ignores surfaces (no 2D points of interest).
    expect(analyze(g.items, {}, -5, 5)).toEqual([]);
  });

  it('samples a 60 × 60 grid well under 30 ms', { retry: 2 }, () => {
    const it0 = parseGraph('graph z = sin(x)*cos(y) + x^2/10 - sqrt(abs(y))', createSession()).items[0]!;
    if (it0.kind !== 'surface') throw new Error('expected surface');
    sampleSurface(it0.f, {}, it0.x, it0.y, 60); // warm up
    const t0 = performance.now();
    const grid = sampleSurface(it0.f, {}, it0.x, it0.y, 60);
    expect(performance.now() - t0).toBeLessThan(30);
    expect(grid.z).toHaveLength(61 * 61);
    expect(grid.zMax).toBeGreaterThan(grid.zMin);
  });

  it('keeps poles from flattening the surface, and survives undefined and flat surfaces', () => {
    const pole = parseGraph('graph z = 1/(x*y)', createSession()).items[0]!;
    if (pole.kind !== 'surface') throw new Error();
    const g = sampleSurface(pole.f, {}, pole.x, pole.y, 60);
    expect(g.clipped).toBe(true);
    expect(g.zMax - g.zMin).toBeLessThan(50);
    expect([...g.z].some(Number.isNaN)).toBe(true); // x = 0 and y = 0 lie on the grid
    const none = sampleSurface(() => NaN, {}, [-1, 1], [-1, 1], 10);
    expect([none.zMin, none.zMax]).toEqual([-1, 1]);
    const flat = sampleSurface(() => 3, {}, [-1, 1], [-1, 1], 10);
    expect([flat.zMin, flat.zMax]).toEqual([2, 4]);
  });
});

describe('statistical plots as graphs', () => {
  it('regression: data points plus the fitted curve, viewed around the data', () => {
    const spec = statPlotSpec(plotFor('fit a line to (1,2) (2,4.1) (3,5.9)'));
    expect(spec.items.map((i) => i.kind)).toEqual(['scatter', 'explicit']);
    const fit = spec.items[1]!;
    expect(fit.kind === 'explicit' && fit.f({ x: 4 })).toBeCloseTo(7.9, 12);
    expect(fit.label).toBe('y = 1.95x + 0.1');
    expect(spec.view!.xMin).toBeLessThan(1);
    expect(spec.view!.xMax).toBeGreaterThan(3);
    expect(spec.view!.yMin).toBeLessThan(2);
    expect(spec.view!.yMax).toBeGreaterThan(5.9);
    expect(spec.summary).toMatch(/R²/);
  });

  it('an exponential fit does not blow the view up', () => {
    const spec = statPlotSpec(plotFor('exponential regression of (0,1) (1,3) (2,9) (3,27) (4,81)'));
    expect(spec.view!.yMax).toBeLessThan(81 * 3);
  });

  it('histogram, dot plot, box plot and normal curve', () => {
    const h = statPlotSpec(plotFor('histogram of 1 2 2 3 3 3 4'));
    expect(h.items[0]).toMatchObject({ kind: 'bars', edges: [0.5, 1.5, 2.5, 3.5, 4.5], heights: [1, 2, 3, 1] });
    expect(h.view!.yMax).toBeCloseTo(3.45, 10);
    expect(h.axes).toMatchObject({ x: 'value', y: 'count' });

    const d = statPlotSpec(plotFor('dot plot of 1 2 2 3'));
    expect(d.items[0]).toMatchObject({ kind: 'scatter', points: [1, 1, 2, 1, 2, 2, 3, 1] });

    const b = statPlotSpec(plotFor('box plot of 1 2 3 4 5 6 7 8 9 100'));
    expect(b.items[0]).toMatchObject({ kind: 'box', q: [1, 3, 5.5, 8, 9], outliers: [100], y: 1 });
    expect(b.axes?.yTicks).toBe(false);

    const n = statPlotSpec(plotFor('normal curve mean 100 sd 15 shade above 130'));
    const shade = n.items.find((i) => i.kind === 'shade')!;
    expect(shade).toMatchObject({ from: 130, to: Infinity });
    if (shade.kind === 'shade') expect(shade.f({ x: 100 })).toBeCloseTo(1 / (15 * Math.sqrt(2 * Math.PI)), 12);
    expect(n.view).toMatchObject({ xMin: 40, xMax: 160 });
    expect(statPlotSpec(plotFor('normal curve mean 0 sd 1')).items.map((i) => i.kind)).toEqual(['explicit']);
  });
});
