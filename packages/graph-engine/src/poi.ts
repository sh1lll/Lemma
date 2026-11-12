import type { FloatEnv, FloatFn } from '@lemma/math-core';
import { analyze, zeros, type Poi } from './analyze';
import { marchImplicit, sampleParametric, samplePolar, type Polyline, type Viewport } from './sample';
import type { GraphItem } from './spec';

/**
 * Points of interest beyond explicit curves (which analyze() covers): intersections between any two curves —
 * implicit, x = f(y), polar, parametric and explicit — found on their sampled geometry and then refined
 * (bisection along an explicit curve, Newton for two implicit curves), and the axis intercepts of implicit curves.
 * Plus the automatic window that frames all of these.
 */

/** Line segments [x0, y0, x1, y1, …] in graph coordinates. */
export type Segments = Float64Array;

export function toSegments(lines: Polyline[] | Segments, isSegments = false): Segments {
  if (isSegments) return lines as Segments;
  let n = 0;
  for (const p of lines as Polyline[]) n += Math.max(0, p.length / 2 - 1);
  const out = new Float64Array(n * 4);
  let o = 0;
  for (const p of lines as Polyline[]) {
    for (let i = 0; i + 3 < p.length; i += 2) {
      out[o++] = p[i]!;
      out[o++] = p[i + 1]!;
      out[o++] = p[i + 2]!;
      out[o++] = p[i + 3]!;
    }
  }
  return out;
}

export interface Curve {
  item: GraphItem;
  segs: Segments;
}

const traceable = (k: GraphItem['kind']) => k === 'explicit' || k === 'implicit' || k === 'xOfY' || k === 'polar' || k === 'parametric';

/** Segment–segment intersections between two sets, using a coarse bucket grid. */
function crossings(a: Segments, b: Segments, vp: Viewport): [number, number][] {
  const G = 48;
  const sx = G / (vp.xMax - vp.xMin);
  const sy = G / (vp.yMax - vp.yMin);
  const cell = (x: number, y: number) => [Math.floor((x - vp.xMin) * sx), Math.floor((y - vp.yMin) * sy)] as const;
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < a.length; i += 4) {
    const [c0, r0] = cell(Math.min(a[i]!, a[i + 2]!), Math.min(a[i + 1]!, a[i + 3]!));
    const [c1, r1] = cell(Math.max(a[i]!, a[i + 2]!), Math.max(a[i + 1]!, a[i + 3]!));
    if (c1 < 0 || r1 < 0 || c0 >= G || r0 >= G || c1 - c0 > 4 || r1 - r0 > 4) continue;
    for (let c = Math.max(0, c0); c <= Math.min(G - 1, c1); c++) for (let r = Math.max(0, r0); r <= Math.min(G - 1, r1); r++) {
      const k = r * G + c;
      let l = buckets.get(k);
      if (!l) buckets.set(k, (l = []));
      l.push(i);
    }
  }
  const out: [number, number][] = [];
  const seen = new Set<string>();
  for (let j = 0; j < b.length; j += 4) {
    const x1 = b[j]!;
    const y1 = b[j + 1]!;
    const x2 = b[j + 2]!;
    const y2 = b[j + 3]!;
    const [c0, r0] = cell(Math.min(x1, x2), Math.min(y1, y2));
    const [c1, r1] = cell(Math.max(x1, x2), Math.max(y1, y2));
    if (c1 < 0 || r1 < 0 || c0 >= G || r0 >= G || c1 - c0 > 4 || r1 - r0 > 4) continue;
    for (let c = Math.max(0, c0); c <= Math.min(G - 1, c1); c++) for (let r = Math.max(0, r0); r <= Math.min(G - 1, r1); r++) {
      for (const i of buckets.get(r * G + c) ?? []) {
        const key = `${i}:${j}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const x3 = a[i]!;
        const y3 = a[i + 1]!;
        const x4 = a[i + 2]!;
        const y4 = a[i + 3]!;
        const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
        if (Math.abs(d) < 1e-300) continue;
        const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
        const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) out.push([x1 + t * (x2 - x1), y1 + t * (y2 - y1)]);
      }
    }
  }
  return out;
}

function fnOf(f: FloatFn, env: FloatEnv, v: string): (x: number) => number {
  const e = { ...env };
  return (x) => {
    e[v] = x;
    return f(e);
  };
}

/** Refines an approximate crossing of two curves when their kinds allow an exact equation. */
function refine(a: GraphItem, b: GraphItem, p: [number, number], env: FloatEnv, tol: number): [number, number] {
  if (b.kind === 'explicit' && a.kind !== 'explicit') [a, b] = [b, a];
  if (a.kind === 'explicit' && b.kind === 'implicit') {
    const f = fnOf(a.f, env, 'x');
    const e = { ...env };
    const g = (x: number) => {
      e.x = x;
      e.y = f(x);
      return b.F(e);
    };
    const r = bisectNear(g, p[0], tol);
    if (r !== null) return [r, f(r)];
  }
  if (a.kind === 'explicit' && b.kind === 'xOfY') {
    const f = fnOf(a.f, env, 'x');
    const h = fnOf(b.f, env, 'y');
    const r = bisectNear((x) => h(f(x)) - x, p[0], tol);
    if (r !== null) return [r, f(r)];
  }
  if (a.kind === 'implicit' && b.kind === 'implicit') {
    let [x, y] = p;
    const e = { ...env };
    const F = (fn: FloatFn, xx: number, yy: number) => {
      e.x = xx;
      e.y = yy;
      return fn(e);
    };
    for (let i = 0; i < 12; i++) {
      const h = 1e-7 * Math.max(1, Math.abs(x), Math.abs(y));
      const f1 = F(a.F, x, y);
      const f2 = F(b.F, x, y);
      const a11 = (F(a.F, x + h, y) - f1) / h;
      const a12 = (F(a.F, x, y + h) - f1) / h;
      const a21 = (F(b.F, x + h, y) - f2) / h;
      const a22 = (F(b.F, x, y + h) - f2) / h;
      const det = a11 * a22 - a12 * a21;
      if (!Number.isFinite(det) || Math.abs(det) < 1e-300) break;
      const dx = (f1 * a22 - f2 * a12) / det;
      const dy = (a11 * f2 - a21 * f1) / det;
      x -= dx;
      y -= dy;
      if (Math.hypot(dx, dy) < 1e-13 * Math.max(1, Math.abs(x), Math.abs(y))) break;
    }
    if (Number.isFinite(x) && Number.isFinite(y) && Math.hypot(x - p[0], y - p[1]) < tol * 4) return [x, y];
  }
  return p;
}

function bisectNear(g: (x: number) => number, x0: number, tol: number): number | null {
  const lo = x0 - tol;
  const hi = x0 + tol;
  let a = lo;
  let b = hi;
  let ga = g(a);
  const gb = g(b);
  if (!Number.isFinite(ga) || !Number.isFinite(gb) || ga > 0 === gb > 0) return null;
  for (let i = 0; i < 80; i++) {
    const m = (a + b) / 2;
    const gm = g(m);
    if (gm === 0) return m;
    if (ga > 0 !== gm > 0) b = m;
    else {
      a = m;
      ga = gm;
    }
  }
  return (a + b) / 2;
}

const tidy = (v: number, span: number) => {
  const r = Math.round(v * 1e6) / 1e6;
  if (Math.abs(r - v) < 1e-9 * Math.max(1, Math.abs(v))) return r;
  return Math.abs(v) < span * 1e-12 ? 0 : v;
};

/**
 * Points of interest for every curve: explicit roots/extrema/intercepts/intersections (via analyze), intersections
 * involving any other curve kind, and axis intercepts of implicit, x = f(y), polar and parametric curves.
 */
export function analyzeCurves(curves: Curve[], env: FloatEnv, vp: Viewport, limit = 80): Poi[] {
  const pois = analyze(curves.map((c) => c.item), env, vp.xMin, vp.xMax, limit);
  const span = Math.max(vp.xMax - vp.xMin, vp.yMax - vp.yMin);
  const tol = span / 150;
  const add = (p: Poi) => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    if (pois.some((q) => q.kind === p.kind && Math.hypot(q.x - p.x, q.y - p.y) < span * 1e-5)) return;
    pois.push({ ...p, x: tidy(p.x, span), y: tidy(p.y, span) });
  };
  for (const c of curves) {
    const it = c.item;
    if (it.kind === 'implicit' && it.op === '=' && !it.extra?.length) {
      for (const x of zeros(fnOf((e) => it.F({ ...e, y: 0 }), env, 'x'), vp.xMin, vp.xMax)) add({ kind: 'root', x, y: 0, items: [it.id] });
      for (const y of zeros(fnOf((e) => it.F({ ...e, x: 0 }), env, 'y'), vp.yMin, vp.yMax)) add({ kind: 'y-intercept', x: 0, y, items: [it.id] });
    } else if (it.kind === 'xOfY') {
      const g = fnOf(it.f, env, 'y');
      add({ kind: 'root', x: g(0), y: 0, items: [it.id] });
      for (const y of zeros(g, vp.yMin, vp.yMax)) add({ kind: 'y-intercept', x: 0, y, items: [it.id] });
    } else if (it.kind === 'polar' || it.kind === 'parametric') {
      // Axis crossings of the sampled curve.
      const s = c.segs;
      for (let i = 0; i < s.length; i += 4) {
        const [x0, y0, x1, y1] = [s[i]!, s[i + 1]!, s[i + 2]!, s[i + 3]!];
        if (y0 === 0 || (y0 > 0) !== (y1 > 0)) {
          const t = y0 === y1 ? 0 : y0 / (y0 - y1);
          add({ kind: 'root', x: x0 + t * (x1 - x0), y: 0, items: [it.id] });
        }
        if (x0 === 0 || (x0 > 0) !== (x1 > 0)) {
          const t = x0 === x1 ? 0 : x0 / (x0 - x1);
          add({ kind: 'y-intercept', x: 0, y: y0 + t * (y1 - y0), items: [it.id] });
        }
      }
    }
  }
  for (let i = 0; i < curves.length; i++) {
    for (let j = i + 1; j < curves.length; j++) {
      const a = curves[i]!;
      const b = curves[j]!;
      if (!traceable(a.item.kind) || !traceable(b.item.kind)) continue;
      if (a.item.kind === 'explicit' && b.item.kind === 'explicit') continue; // analyze() has these, exactly
      for (const p of crossings(a.segs, b.segs, vp)) {
        const [x, y] = refine(a.item, b.item, p, env, tol);
        add({ kind: 'intersection', x, y, items: [a.item.id, b.item.id] });
        if (pois.length >= limit) return pois;
      }
    }
  }
  return pois;
}

/** Samples a curve's geometry for analysis without a renderer (used by the automatic window). */
export function geometryOf(it: GraphItem, env: FloatEnv, vp: Viewport): Segments | null {
  switch (it.kind) {
    case 'implicit':
      return marchImplicit(it.F, env, vp, 120, 120).segments;
    case 'polar':
      return toSegments(samplePolar(it.r, env, it.range, vp));
    case 'parametric':
      return toSegments(sampleParametric(it.fx, it.fy, env, it.range, vp));
  }
  return null;
}

/**
 * The window that frames the interesting features: roots, extrema, intercepts, intersections, points, closed curves
 * and data. Equal units on both axes unless that would hide the features (then x and y are fitted separately).
 * `aspect` is the canvas height ÷ width.
 */
export function autoWindow(items: GraphItem[], env: FloatEnv, aspect: number): Viewport {
  const xs: number[] = [];
  const ys: number[] = [];
  const addPt = (x: number, y: number) => {
    if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) < 1e7 && Math.abs(y) < 1e7) {
      xs.push(x);
      ys.push(y);
    }
  };
  const base: Viewport = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 };
  const explicit = items.filter((i) => i.kind === 'explicit');
  let found = analyze(explicit, env, -10, 10, 200);
  if (!found.length && explicit.length) found = analyze(explicit, env, -100, 100, 200);
  for (const p of found) addPt(p.x, p.y);
  const wide: Viewport = { xMin: -25, xMax: 25, yMin: -25, yMax: 25 };
  for (const it of items) {
    if (it.kind === 'point') addPt(it.x(env), it.y(env));
    else if (it.kind === 'scatter') for (let i = 0; i < it.points.length; i += 2) addPt(it.points[i]!, it.points[i + 1]!);
    else if (it.kind === 'bars') {
      addPt(it.edges[0]!, 0);
      addPt(it.edges.at(-1)!, Math.max(...it.heights));
    } else if (it.kind === 'shade') {
      if (Number.isFinite(it.from)) addPt(it.from, 0);
      if (Number.isFinite(it.to)) addPt(it.to, 0);
    } else if (it.kind === 'image') {
      addPt(it.x - it.w / 2, it.y - it.h / 2);
      addPt(it.x + it.w / 2, it.y + it.h / 2);
    } else if (it.kind === 'vector') {
      addPt(it.x0(env), it.y0(env));
      addPt(it.x1(env), it.y1(env));
    } else if (it.kind === 'implicit' || it.kind === 'polar' || it.kind === 'parametric') {
      const s = geometryOf(it, env, wide);
      if (!s || !s.length) continue;
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (let i = 0; i < s.length; i += 2) {
        x0 = Math.min(x0, s[i]!);
        x1 = Math.max(x1, s[i]!);
        y0 = Math.min(y0, s[i + 1]!);
        y1 = Math.max(y1, s[i + 1]!);
      }
      const edge = 25 * 0.98;
      // A bounded curve (a circle) frames by its extent; an unbounded one (a line) by where it crosses the axes.
      if (x0 > -edge && x1 < edge && y0 > -edge && y1 < edge) {
        addPt(x0, y0);
        addPt(x1, y1);
      } else {
        const c = analyzeCurves([{ item: it, segs: s }], env, base, 20);
        for (const p of c) addPt(p.x, p.y);
      }
    } else if (it.kind === 'xOfY') {
      addPt(it.f({ ...env, y: 0 }), 0);
    }
  }
  if (!xs.length) {
    const half = 10 * aspect;
    return { xMin: -10, xMax: 10, yMin: -half, yMax: half };
  }
  let bx0 = Math.min(...xs);
  let bx1 = Math.max(...xs);
  let by0 = Math.min(...ys);
  let by1 = Math.max(...ys);
  // Keep the origin (and so the axes) in view when the features are near it.
  const size = Math.max(bx1 - bx0, by1 - by0);
  if (Math.hypot(Math.max(0, bx0, -bx1), Math.max(0, by0, -by1)) < size * 1.5 + 3) {
    bx0 = Math.min(bx0, 0);
    bx1 = Math.max(bx1, 0);
    by0 = Math.min(by0, 0);
    by1 = Math.max(by1, 0);
  }
  const w = bx1 - bx0;
  const h = by1 - by0;
  let xNeed = Math.max(w * 1.3, 8);
  if (w > 12) xNeed = Math.max(20, w * 1.25);
  const yNeed = Math.max(h * 1.3, 1);
  const square = yNeed / aspect <= 3 * xNeed;
  const xSpan = square ? Math.max(xNeed, yNeed / aspect) : xNeed;
  let ySpan = square ? xSpan * aspect : yNeed;
  const cx = (bx0 + bx1) / 2;
  let target: [number, number] = [by0, by1];
  // Only for compact features: a window already spanning ±10 has room enough.
  if (square && explicit.length && xSpan <= 12) {
    // Lean towards where the curves go (a parabola opening upwards gets more room above its vertex), up to 2× the
    // square height.
    const vals: number[] = [];
    for (const it of explicit) {
      if (it.kind !== 'explicit') continue;
      for (let i = 0; i <= 80; i++) {
        const y = it.f({ ...env, x: cx - xSpan / 2 + (xSpan * i) / 80 });
        if (Number.isFinite(y)) vals.push(y);
      }
    }
    if (vals.length > 8) {
      vals.sort((p, q) => p - q);
      const q10 = vals[Math.floor(vals.length * 0.1)]!;
      const q90 = vals[Math.floor(vals.length * 0.9)]!;
      target = [Math.min(by0, q10), Math.max(by1, q90)];
      ySpan = Math.max(ySpan, Math.min((target[1] - target[0]) * 1.1, 2 * ySpan));
    }
  }
  // Equal units: a taller window widens x to match (circles stay round).
  const xOut = square ? Math.max(xSpan, ySpan / aspect) : xSpan;
  const m = ySpan * 0.08;
  const lo = by1 + m - ySpan / 2;
  const hi = by0 - m + ySpan / 2;
  const tc = (target[0] + target[1]) / 2;
  const cy = lo <= hi ? Math.min(hi, Math.max(lo, tc)) : (by0 + by1) / 2;
  return { xMin: cx - xOut / 2, xMax: cx + xOut / 2, yMin: cy - ySpan / 2, yMax: cy + ySpan / 2 };
}
