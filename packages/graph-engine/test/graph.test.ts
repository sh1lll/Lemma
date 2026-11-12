import { commit, calculate, createSession, compileFloat, parseInput, type CalcSuccess } from '@lemma/math-core';
import { describe, expect, it } from 'vitest';
import { analyze, isGraphRequest, marchImplicit, niceStep, parseGraph, sampleExplicit } from '../src';

const vp = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 };

describe('float compiler', () => {
  it('matches the exact evaluator on a range of inputs', () => {
    const s = createSession();
    s.angle = 'rad';
    for (const e of ['2^10', '-2^2', '7 mod 3', '-7 mod 3', '5!', 'sqrt(2)', 'sin(pi/6)', '20% of 450 + 30', '100 + 10%', 'cbrt(-27)', '(-8)^(1/3)', 'log(1000)', 'ncr(10, 3)', 'logb2 8']) {
      const exact = (calculate(e, s) as CalcSuccess).value.toNumber();
      const f = compileFloat(parseInput(e, s), { angle: 'rad', free: new Set() });
      expect(f({}), e).toBeCloseTo(exact, 10);
    }
  });
});

describe('graph requests', () => {
  it('recognises graph intents without capturing plain math', () => {
    for (const q of ['graph x^2 + 3x', 'plot sin(x) and cos(x)', 'y = 2x + 1', 'x^2 + y^2 = 25', 'y > x^2', 'r = 1 + cos(theta)', 'draw (cos t, sin t)']) expect(isGraphRequest(q), q).toBe(true);
    for (const q of ['2 + 2', 'x = 5', 'y = 5', '20% of 450', 'sqrt 2', 'days until christmas']) expect(isGraphRequest(q), q).toBe(false);
  });

  it('parses kinds, sliders and domains', () => {
    const s = createSession();
    const spec = parseGraph('graph a*x^2 + b, y = 2x + 1, x^2 + y^2 = 25, r = 1 + cos θ, (cos t, sin t), (1, 2)', s);
    expect(spec.items.map((i) => i.kind)).toEqual(['explicit', 'explicit', 'implicit', 'polar', 'parametric', 'point']);
    expect(spec.sliders.map((x) => x.name)).toEqual(['a', 'b']);
    const d = parseGraph('graph x^2 from 0 to 3', s);
    expect(d.items[0]!.kind === 'explicit' && d.items[0]!.domain).toEqual([0, 3]);
  });

  it('uses saved formulas', () => {
    const s = createSession();
    commit(s, calculate('f(x) = x^2 - 4', s) as CalcSuccess);
    const spec = parseGraph('graph f(x)', s);
    const it0 = spec.items[0]!;
    expect(it0.kind === 'explicit' && it0.f({ x: 3 })).toBe(5);
  });
});

describe('analysis', () => {
  it('finds roots, extrema, intercepts and intersections', () => {
    const s = createSession();
    const spec = parseGraph('graph x^2 + 3x and 2x + 3', s);
    const pois = analyze(spec.items, {}, -10, 10);
    const roots = pois.filter((p) => p.kind === 'root' && p.items[0] === 0).map((p) => p.x);
    expect(roots).toEqual([-3, 0]);
    const min = pois.find((p) => p.kind === 'min')!;
    expect(min.x).toBeCloseTo(-1.5, 6);
    expect(min.y).toBeCloseTo(-2.25, 6);
    const inter = pois.filter((p) => p.kind === 'intersection').map((p) => [p.x, p.y]);
    // x² + 3x = 2x + 3 → x² + x − 3 = 0 → x = (−1 ± √13)/2
    expect(inter[0]![0]).toBeCloseTo((-1 - Math.sqrt(13)) / 2, 6);
    expect(inter[1]![0]).toBeCloseTo((-1 + Math.sqrt(13)) / 2, 6);
  });

  it('does not report poles as roots', () => {
    const spec = parseGraph('graph 1/x', createSession());
    expect(analyze(spec.items, {}, -10, 10).filter((p) => p.kind === 'root')).toEqual([]);
  });

  it('numeric derivative curve', () => {
    const spec = parseGraph('graph x^3 and its derivative', createSession());
    const d = spec.items[1]!;
    expect(d.kind === 'explicit' && d.f({ x: 2 })).toBeCloseTo(12, 5);
  });
});

describe('sampling', () => {
  it('breaks at asymptotes', () => {
    const spec = parseGraph('graph tan(x)', createSession());
    const it0 = spec.items[0]!;
    if (it0.kind !== 'explicit') throw new Error();
    expect(sampleExplicit(it0.f, {}, vp, 800).length).toBeGreaterThanOrEqual(7);
  });

  it('marches a circle', () => {
    const spec = parseGraph('x^2 + y^2 = 25', createSession());
    const it0 = spec.items[0]!;
    if (it0.kind !== 'implicit') throw new Error();
    const { segments } = marchImplicit(it0.F, {}, vp, 100, 100);
    for (let i = 0; i < segments.length; i += 2) expect(Math.hypot(segments[i]!, segments[i + 1]!)).toBeCloseTo(5, 1);
    expect(segments.length).toBeGreaterThan(100);
  });

  it('picks nice grid steps', () => {
    expect(niceStep(20, 10)).toBe(2);
    expect(niceStep(1, 10)).toBe(0.1);
    expect(niceStep(700, 8)).toBe(100);
  });
});
