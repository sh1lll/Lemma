import { describe, expect, it } from 'vitest';
import { analyzeCurves, autoWindow, buildRows, compile, infer, marchImplicit, marchingCubes, parseExpr, sampleExplicit, toSegments, values, type GraphItem } from '../src';

const ev = (src: string, env: Record<string, number> = {}) => compile(parseExpr(src), { angle: 'rad', free: new Set(['x', 'y', 't']) }).f({ ...env });
const one = (text: string, extra: { id: number; text: string }[] = []) => buildRows([{ id: 1, text }, ...extra]).rows.get(1)!;
const item = <K extends GraphItem['kind']>(text: string, kind: K) => {
  const r = one(text);
  expect(r.error, text).toBeUndefined();
  const it = r.items.find((i) => i.kind === kind);
  expect(it, `${text} → ${kind}`).toBeTruthy();
  return it as Extract<GraphItem, { kind: K }>;
};

describe('expression language', () => {
  it('reads ordinary notation', () => {
    expect(ev('2x + 1', { x: 3 })).toBe(7);
    expect(ev('-x^2', { x: 3 })).toBe(-9);
    expect(ev('sin x cos x', { x: 0.3 })).toBeCloseTo(Math.sin(0.3) * Math.cos(0.3));
    expect(ev('sin^2 x + cos^2 x', { x: 1.1 })).toBeCloseTo(1);
    expect(ev('x²', { x: 4 })).toBe(16);
    expect(ev('√(x)', { x: 9 })).toBe(3);
    expect(ev('|x - 5|', { x: 2 })).toBe(3);
    expect(ev('2π')).toBeCloseTo(2 * Math.PI);
    expect(ev('log_2(8)')).toBeCloseTo(3);
    expect(ev('5!')).toBe(120);
    expect(ev('x₁ + 1', { x_1: 2 })).toBe(3); // subscripts: x₁ is x_1, read from the env like a slider
  });

  it('domain restrictions and piecewise definitions', () => {
    expect(ev('x^2 {x > 0}', { x: 2 })).toBe(4);
    expect(ev('x^2 {x > 0}', { x: -2 })).toBeNaN();
    expect(ev('x {0 < x < 2}', { x: 1 })).toBe(1);
    expect(ev('x {0 < x < 2}', { x: 3 })).toBeNaN();
    expect(ev('{x < 0: -x, x}', { x: -3 })).toBe(3);
    expect(ev('{x < 0: -x, x}', { x: 4 })).toBe(4);
    expect(ev('{x < 0: 1}', { x: 4 })).toBeNaN();
    const r = item('y = x^2 {x > 0}', 'explicit');
    expect(r.f({ x: 3 })).toBe(9);
    expect(r.f({ x: -3 })).toBeNaN();
    const d = item('y = x {0 < x < 2}', 'explicit');
    expect(d.domain).toEqual([0, 2]);
  });

  it('lists, ranges, list arithmetic and aggregates', () => {
    const c = compile(parseExpr('[1, 2, 3] * 2 + [10, 20, 30]'), { angle: 'rad', free: new Set() });
    expect(c.n).toBe(3);
    expect(values(c)).toEqual([12, 24, 36]);
    expect(values(compile(parseExpr('[1...5]'), { angle: 'rad', free: new Set() }))).toEqual([1, 2, 3, 4, 5]);
    expect(values(compile(parseExpr('[0, 0.5 ... 2]'), { angle: 'rad', free: new Set() }))).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(ev('mean([2, 4, 9])')).toBe(5);
    expect(ev('total([1, 2, 3])')).toBe(6);
    expect(ev('length([1, 2, 3, 4])')).toBe(4);
    expect(ev('[5, 6, 7][2]')).toBe(6);
    // y = [1, 2, 3]x draws a family of three lines.
    const fam = one('y = [1, 2, 3]x');
    expect(fam.items).toHaveLength(3);
    expect(fam.items.map((i) => (i.kind === 'explicit' ? i.f({ x: 2 }) : NaN))).toEqual([2, 4, 6]);
    // Named lists from other rows.
    const b = buildRows([{ id: 1, text: 'L = [1, 2, 3]' }, { id: 2, text: 'mean(L)' }, { id: 3, text: 'L^2' }]);
    expect(b.rows.get(1)!.kind).toBe('list');
    expect(b.rows.get(2)!.value).toBe('= 2');
    expect(b.rows.get(3)!.value).toBe('= [1, 4, 9]');
  });

  it('derivatives, sums, products, integrals and distributions', () => {
    const b = buildRows([{ id: 1, text: 'f(x) = x^3' }, { id: 2, text: "y = f'(x)" }, { id: 3, text: "y = f''(x)" }, { id: 4, text: 'y = d/dx(sin(x))' }]);
    const d1 = b.rows.get(2)!.items[0] as Extract<GraphItem, { kind: 'explicit' }>;
    const d2 = b.rows.get(3)!.items[0] as Extract<GraphItem, { kind: 'explicit' }>;
    const d3 = b.rows.get(4)!.items[0] as Extract<GraphItem, { kind: 'explicit' }>;
    expect(d1.f({ x: 2 })).toBeCloseTo(12, 5);
    expect(d2.f({ x: 2 })).toBeCloseTo(12, 3);
    expect(d3.f({ x: 0.5 })).toBeCloseTo(Math.cos(0.5), 6);
    expect(ev('sum(n=1, 10, n^2)')).toBe(385);
    expect(ev('∑_{n=1}^{4} n')).toBe(10);
    expect(ev('prod(k=1, 5, k)')).toBe(120);
    expect(ev('∫_0^2 x^2 dx')).toBeCloseTo(8 / 3, 8);
    expect(ev('∫_0^π sin(t) dt')).toBeCloseTo(2, 8);
    expect(ev('normalpdf(0)')).toBeCloseTo(0.3989422804, 9);
    expect(ev('normalcdf(-1.96, 1.96)')).toBeCloseTo(0.95, 3);
    expect(ev('invnorm(0.975)')).toBeCloseTo(1.959964, 5);
    expect(ev('binompdf(10, 0.5, 5)')).toBeCloseTo(0.24609375, 9);
    expect(ev('tcdf(-2, 2, 10)')).toBeCloseTo(0.92661, 4);
    // An integral row shows its value and shades the area.
    const area = one('∫_0^2 x^2 dx');
    expect(area.value).toMatch(/^≈ 2\.6666/);
    expect(area.items.some((i) => i.kind === 'shade')).toBe(true);
  });

  it('classifies rows: sliders, polar, parametric with a t range, points, inequalities, 3D', () => {
    const b = buildRows([{ id: 1, text: 'a = 2' }, { id: 2, text: 'y = a x' }, { id: 3, text: '(a, 3)' }, { id: 4, text: '(1, 2)' }]);
    expect(b.rows.get(1)!.slider).toEqual({ name: 'a', value: 2 });
    const pt = b.rows.get(3)!.items[0] as Extract<GraphItem, { kind: 'point' }>;
    expect(pt.drag).toEqual({ x: 'a', y: undefined });
    expect((b.rows.get(4)!.items[0] as Extract<GraphItem, { kind: 'point' }>).drag).toEqual({ literal: true });
    expect(item('r = 1 + cos(θ)', 'polar').range).toEqual([0, 2 * Math.PI]);
    expect(item('(cos t, sin t) {0 ≤ t ≤ π}', 'parametric').range).toEqual([0, Math.PI]);
    const region = item('0 < y < x', 'implicit');
    expect(region.op).toBe('<');
    expect(region.extra).toHaveLength(1);
    expect(one('z = x^2 + y^2').dims).toBe(3);
    expect(item('x^2 + y^2 + z^2 = 4', 'implicit3d').F({ x: 2, y: 0, z: 0 })).toBe(0);
    expect(item('(cos t, sin t, t)', 'curve3d')).toBeTruthy();
    expect(item('(u, v, u v)', 'psurface')).toBeTruthy();
    expect(item('(1, 2, 3)', 'point3d').z({})).toBe(3);
    expect(one('y = q x').missing).toEqual(['q']);
    expect(one('2 + 3').value).toBe('= 5');
  });
});

describe('regression from tables', () => {
  it('fits a line with y₁ ~ m x₁ + b and reports R²', () => {
    const xs = [1, 2, 3, 4, 5];
    const ys = xs.map((x) => 2 * x + 1 + (x % 2 ? 0.05 : -0.05));
    const b = buildRows([{ id: 1, text: 'y₁ ~ m x₁ + b' }], [{ id: 9, cols: [{ name: 'x₁', values: xs }, { name: 'y₁', values: ys }] }]);
    const r = b.rows.get(1)!;
    expect(r.error).toBeUndefined();
    const p = Object.fromEntries(r.fit!.params);
    expect(p.m).toBeCloseTo(2, 1);
    expect(p.b).toBeCloseTo(1, 1);
    expect(r.fit!.r2).toBeGreaterThan(0.99);
    const curve = r.items[0] as Extract<GraphItem, { kind: 'explicit' }>;
    expect(curve.f({ x: 10 })).toBeCloseTo(p.m! * 10 + p.b!, 8);
    // Table points are drawn.
    expect(b.tables.get(9)!.items[0]!.kind).toBe('scatter');
  });

  it('fits nonlinear models (exponential)', () => {
    const xs = [0, 1, 2, 3, 4];
    const ys = xs.map((x) => 3 * Math.exp(0.5 * x));
    const r = buildRows([{ id: 1, text: 'y_1 ~ a e^(k x_1)' }], [{ id: 2, cols: [{ name: 'x_1', values: xs }, { name: 'y_1', values: ys }] }]).rows.get(1)!;
    const p = Object.fromEntries(r.fit!.params);
    expect(p.a).toBeCloseTo(3, 4);
    expect(p.k).toBeCloseTo(0.5, 4);
    expect(r.fit!.r2).toBeCloseTo(1, 8);
  });
});

describe('points of interest beyond explicit curves', () => {
  const vp = { xMin: -5, xMax: 5, yMin: -5, yMax: 5 };
  const geom = (it: GraphItem) => {
    if (it.kind === 'explicit') return toSegments(sampleExplicit(it.f, {}, vp, 800));
    if (it.kind === 'implicit') return marchImplicit(it.F, {}, vp, 200, 200).segments;
    throw new Error(it.kind);
  };
  it('finds intersections between an implicit circle and an explicit line, exactly', () => {
    const circle = item('x^2 + y^2 = 4', 'implicit');
    const line = { ...item('y = x', 'explicit'), id: 2 };
    const pois = analyzeCurves([{ item: circle, segs: geom(circle) }, { item: line, segs: geom(line) }], {}, vp);
    const xs = pois.filter((p) => p.kind === 'intersection').map((p) => p.x).sort((a, b) => a - b);
    expect(xs).toHaveLength(2);
    expect(xs[0]).toBeCloseTo(-Math.SQRT2, 9);
    expect(xs[1]).toBeCloseTo(Math.SQRT2, 9);
    // Axis intercepts of the circle.
    expect(pois.filter((p) => p.kind === 'root' && p.items.includes(circle.id)).map((p) => p.x).sort((a, b) => a - b)).toEqual([-2, 2]);
  });
  it('finds intersections between two implicit curves', () => {
    const a = item('x^2 + y^2 = 4', 'implicit');
    const b = { ...item('(x - 2)^2 + y^2 = 4', 'implicit'), id: 2 };
    const pois = analyzeCurves([{ item: a, segs: geom(a) }, { item: b, segs: geom(b) }], {}, vp).filter((p) => p.kind === 'intersection');
    expect(pois).toHaveLength(2);
    for (const p of pois) {
      expect(p.x).toBeCloseTo(1, 9);
      expect(Math.abs(p.y)).toBeCloseTo(Math.sqrt(3), 9);
    }
  });
});

describe('automatic window', () => {
  it('frames y = x² − 4 around its roots and vertex instead of stretching to the curve’s top', () => {
    const f = item('y = x^2 - 4', 'explicit');
    const w = autoWindow([f], {}, 0.62);
    expect(w.xMin).toBeLessThan(-2.5);
    expect(w.xMax).toBeGreaterThan(2.5);
    expect(w.yMin).toBeLessThan(-4.2);
    expect(w.yMin).toBeGreaterThan(-8);
    expect(w.yMax).toBeLessThan(15);
    expect(w.yMax).toBeGreaterThan(0.5);
  });
  it('frames a circle by its extent', () => {
    const w = autoWindow([item('(x - 20)^2 + y^2 = 1', 'implicit')], {}, 1);
    expect(w.xMin).toBeLessThan(19);
    expect(w.xMax).toBeGreaterThan(21);
    expect(w.xMax - w.xMin).toBeLessThan(15);
  });
});

describe('marching cubes', () => {
  it('polygonises a sphere with vertices on its surface and outward normals', () => {
    const F = (e: Record<string, number>) => e.x! ** 2 + e.y! ** 2 + e.z! ** 2 - 4;
    const m = marchingCubes(F, {}, { x: [-3, 3], y: [-3, 3], z: [-3, 3] }, 20);
    expect(m.idx.length).toBeGreaterThan(300);
    expect(m.idx.length % 3).toBe(0);
    for (let i = 0; i < m.pos.length; i += 3 * 17) {
      const r = Math.hypot(m.pos[i]!, m.pos[i + 1]!, m.pos[i + 2]!);
      expect(r).toBeCloseTo(2, 1);
      const dot = (m.pos[i]! * m.nrm[i]! + m.pos[i + 1]! * m.nrm[i + 1]! + m.pos[i + 2]! * m.nrm[i + 2]!) / r;
      expect(dot).toBeGreaterThan(0.95);
    }
  });
  it('reproduces a plane exactly', () => {
    const m = marchingCubes((e) => e.x! + e.y! + e.z! - 1, {}, { x: [-2, 2], y: [-2, 2], z: [-2, 2] }, 8);
    for (let i = 0; i < m.pos.length; i += 3) expect(m.pos[i]! + m.pos[i + 1]! + m.pos[i + 2]!).toBeCloseTo(1, 5);
  });
});

describe('inference', () => {
  it('one-sample t test and interval match textbook values', () => {
    const t = infer({ test: 't1', mode: 'test', mean: 52, sd: 8, n: 25, h0: 50, alt: 'ne', level: 0.95 });
    expect(t.stat).toBeCloseTo(1.25, 10);
    expect(t.df).toBe(24);
    expect(t.p).toBeCloseTo(0.2234, 3);
    const ci = infer({ test: 't1', mode: 'interval', data: [4, 5, 6, 5, 4, 6], h0: 0, alt: 'ne', level: 0.95 });
    expect(ci.ci![0]).toBeCloseTo(5 - 2.570582 * Math.sqrt(0.8 / 6), 4);
  });
  it('z and proportion tests', () => {
    const z = infer({ test: 'z1', mode: 'test', mean: 103, sigma: 15, n: 36, h0: 100, alt: 'gt', level: 0.95 });
    expect(z.stat).toBeCloseTo(1.2, 10);
    expect(z.p).toBeCloseTo(0.11507, 4);
    const p = infer({ test: 'p1', mode: 'test', x: 60, n: 100, h0: 0.5, alt: 'ne', level: 0.95 });
    expect(p.stat).toBeCloseTo(2, 10);
    expect(p.p).toBeCloseTo(0.0455, 3);
  });
});
