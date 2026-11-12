import { createSession } from '@lemma/math-core';
import { describe, expect, it } from 'vitest';
import { analyze, parseGraph, sampleExplicit } from '../src';

describe('graph regressions', () => {
  it('splits letter runs into sliders, as in Desmos', () => {
    const g = parseGraph('y = mx + b', createSession());
    expect(g.sliders.map((s) => s.name)).toEqual(['b', 'm']);
    expect(g.items[0]!.kind === 'explicit' && g.items[0]!.f({ x: 2, m: 3, b: 1 })).toBe(7);
    const q = parseGraph('graph ax^2', createSession());
    expect(q.items[0]!.kind === 'explicit' && q.items[0]!.f({ x: 3, a: 2 })).toBe(18);
  });

  it('reports no extrema at poles', () => {
    const pois = analyze(parseGraph('graph tan(x)', createSession()).items, {}, -10, 10);
    expect(pois.filter((p) => p.kind === 'min' || p.kind === 'max')).toEqual([]);
    expect(pois.filter((p) => p.kind === 'root')).toHaveLength(7);
  });

  it('reports one root for a flat run of zeros', () => {
    const roots = analyze(parseGraph('graph floor(x)', createSession()).items, {}, -10, 10).filter((p) => p.kind === 'root');
    expect(roots.map((p) => p.x)).toEqual([0]);
  });

  describe('step functions are drawn without vertical risers', () => {
    const vp = { xMin: -5, xMax: 5, yMin: -6, yMax: 6 };
    const risers = (lines: Float64Array[]) => {
      let n = 0;
      for (const l of lines) for (let i = 2; i < l.length; i += 2) if (Math.abs(l[i + 1]! - l[i - 1]!) > 0.2 && Math.abs(l[i]! - l[i - 2]!) < 0.01) n++;
      return n;
    };
    const lines = (q: string) => {
      const it = parseGraph(q, createSession()).items[0]!;
      if (it.kind !== 'explicit') throw new Error(q);
      return sampleExplicit(it.f, {}, vp, 800);
    };

    it.each([
      ['graph floor(x)', 11],
      ['graph ceil(x)', 11],
      ['graph round(x)', 11],
      ['graph floor(x) + x', 11],
      ['graph floor(10x)/10', 101],
    ])('%s → %i separate flat pieces', (q, pieces) => {
      const l = lines(q);
      expect(l).toHaveLength(pieces);
      expect(risers(l)).toBe(0);
      // Each piece of floor(x) ends right at the next integer, not a sample short of it.
      if (q === 'graph floor(x)') {
        const ends = l.map((p) => p[p.length - 2]!).slice(0, -1);
        for (const e of ends) expect(Math.abs(e - Math.round(e))).toBeLessThan(1e-9);
      }
    });

    it.each(['graph x^3', 'graph cbrt(x)', 'graph sin(50x)', 'graph exp(x)', 'graph abs(x)'])('%s stays one continuous curve', (q) => {
      expect(lines(q)).toHaveLength(1);
    });
  });
});
