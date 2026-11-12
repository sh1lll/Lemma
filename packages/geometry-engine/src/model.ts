/**
 * A dynamic-geometry construction: free points plus objects defined from other objects. Objects are kept in
 * construction order, so every object's inputs come before it and one pass evaluates the whole figure. Moving a
 * free point and re-evaluating updates everything that depends on it.
 */

export type Id = string;
export interface Vec {
  x: number;
  y: number;
}

/** A number, or the name of something that has one (a slider, a length, an angle in degrees). */
export type NumRef = number | Id;

export type Def =
  | { kind: 'point'; x: number; y: number }
  | { kind: 'midpoint'; a: Id; b: Id }
  /** The `which`-th (0 or 1) common point of two curves (lines, segments, circles). */
  | { kind: 'intersection'; a: Id; b: Id; which: 0 | 1 }
  | { kind: 'segment'; a: Id; b: Id }
  | { kind: 'line'; a: Id; b: Id }
  | { kind: 'circle'; center: Id; through: Id }
  | { kind: 'circleRadius'; center: Id; r: NumRef }
  /** Compass: a circle about `center` whose radius is the distance from `a` to `b`. */
  | { kind: 'compass'; center: Id; a: Id; b: Id }
  | { kind: 'polygon'; pts: Id[] }
  /** A regular polygon with `n` sides, built counterclockwise on the side from `a` to `b`. */
  | { kind: 'regularPolygon'; a: Id; b: Id; n: NumRef }
  | { kind: 'perpendicular'; line: Id; through: Id }
  | { kind: 'parallel'; line: Id; through: Id }
  | { kind: 'perpBisector'; a: Id; b: Id }
  /** Bisects the angle ABC (through B). */
  | { kind: 'angleBisector'; a: Id; b: Id; c: Id }
  /** The `which`-th tangent line from a point to a circle (none inside, one on it, two outside). */
  | { kind: 'tangent'; point: Id; circle: Id; which: 0 | 1 }
  /** The angle ABC, at B, measured from BA to BC (0–180°). */
  | { kind: 'angle'; a: Id; b: Id; c: Id }
  | { kind: 'distance'; a: Id; b: Id }
  /** A number you set by hand, between `min` and `max`. */
  | { kind: 'slider'; min: number; max: number; value: number; step?: number }
  // Transformations: the image follows its source and the transformation's inputs.
  | { kind: 'reflect'; src: Id; line: Id }
  /** Counterclockwise by `angle` degrees (clockwise when `cw`). */
  | { kind: 'rotate'; src: Id; center: Id; angle: NumRef; cw?: boolean }
  /** By the vector from `a` to `b`. */
  | { kind: 'translate'; src: Id; a: Id; b: Id }
  | { kind: 'dilate'; src: Id; center: Id; factor: NumRef };

export type Kind = Def['kind'];
export const TRANSFORM_KINDS = ['reflect', 'rotate', 'translate', 'dilate'] as const;
export type TransformDef = Extract<Def, { kind: (typeof TRANSFORM_KINDS)[number] }>;
export const isTransform = (d: Def): d is TransformDef => (TRANSFORM_KINDS as readonly string[]).includes(d.kind);

export interface GObj {
  id: Id;
  def: Def;
  hidden?: boolean;
  /** Leave a trail as the point moves (locus). */
  trace?: boolean;
}

/** What sort of thing an object is, whatever it's built from. */
export type Shape = 'point' | 'segment' | 'line' | 'circle' | 'polygon' | 'angle' | 'distance' | 'number';

export function shapeOf(def: Def, get: (id: Id) => Def | undefined, depth = 0): Shape | undefined {
  switch (def.kind) {
    case 'point':
    case 'midpoint':
    case 'intersection':
      return 'point';
    case 'segment':
      return 'segment';
    case 'line':
    case 'perpendicular':
    case 'parallel':
    case 'perpBisector':
    case 'angleBisector':
    case 'tangent':
      return 'line';
    case 'circle':
    case 'circleRadius':
    case 'compass':
      return 'circle';
    case 'polygon':
    case 'regularPolygon':
      return 'polygon';
    case 'angle':
      return 'angle';
    case 'distance':
      return 'distance';
    case 'slider':
      return 'number';
    default: {
      const src = get(def.src);
      return src && depth < 500 ? shapeOf(src, get, depth + 1) : undefined;
    }
  }
}

/** What an object works out to for the current positions. `undefined` when it doesn't exist (parallel lines don't meet). */
export type Value =
  | { type: 'point'; p: Vec; free: boolean }
  /** An infinite line through `p` with unit direction `d`; segments carry their two ends. */
  | { type: 'line'; p: Vec; d: Vec; seg?: [Vec, Vec] }
  | { type: 'circle'; c: Vec; r: number }
  | { type: 'polygon'; pts: Vec[]; area: number; perimeter: number }
  | { type: 'angle'; at: Vec; from: number; sweep: number; deg: number }
  | { type: 'distance'; a: Vec; b: Vec; length: number }
  | { type: 'number'; value: number; min: number; max: number; step: number };

export type Values = Map<Id, Value | undefined>;

export const EPS = 1e-9;

export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x;
const unit = (a: Vec): Vec | undefined => {
  const n = Math.hypot(a.x, a.y);
  return n < EPS ? undefined : { x: a.x / n, y: a.y / n };
};

const refs = (...n: NumRef[]): Id[] => n.filter((x): x is Id => typeof x === 'string');

/** The ids an object is built from. */
export function inputs(def: Def): Id[] {
  switch (def.kind) {
    case 'point':
    case 'slider':
      return [];
    case 'midpoint':
    case 'intersection':
    case 'segment':
    case 'line':
    case 'distance':
    case 'perpBisector':
      return [def.a, def.b];
    case 'circle':
      return [def.center, def.through];
    case 'circleRadius':
      return [def.center, ...refs(def.r)];
    case 'compass':
      return [def.center, def.a, def.b];
    case 'polygon':
      return [...def.pts];
    case 'regularPolygon':
      return [def.a, def.b, ...refs(def.n)];
    case 'perpendicular':
    case 'parallel':
      return [def.line, def.through];
    case 'angle':
    case 'angleBisector':
      return [def.a, def.b, def.c];
    case 'tangent':
      return [def.point, def.circle];
    case 'reflect':
      return [def.src, def.line];
    case 'rotate':
      return [def.src, def.center, ...refs(def.angle)];
    case 'translate':
      return [def.src, def.a, def.b];
    case 'dilate':
      return [def.src, def.center, ...refs(def.factor)];
  }
}

/** The number a `NumRef` stands for right now: a slider's value, a length, or an angle in degrees. */
export function numberOf(n: NumRef, vals: Values): number | undefined {
  if (typeof n === 'number') return Number.isFinite(n) ? n : undefined;
  const v = vals.get(n);
  if (v?.type === 'number') return v.value;
  if (v?.type === 'distance') return v.length;
  if (v?.type === 'angle') return v.deg;
  return undefined;
}

/** A tidy slider step: about a hundredth of the range, rounded to 1, 2 or 5 × 10ⁿ. */
export function niceStep(min: number, max: number): number {
  const raw = Math.abs(max - min) / 100;
  if (!(raw > 0)) return 0.1;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [5, 2, 1].map((k) => k * p).find((s) => s <= raw * 1.0001) ?? p;
}

type Map2 = (q: Vec) => Vec;
/** A transformation as a point map plus its scale factor (for radii and areas). */
function transformOf(def: TransformDef, vals: Values): { f: Map2; k: number } | undefined {
  const P = (id: Id) => pointOf(vals.get(id));
  switch (def.kind) {
    case 'reflect': {
      const l = vals.get(def.line);
      if (l?.type !== 'line') return undefined;
      return { f: (q) => sub(mul(add(l.p, mul(l.d, dot(sub(q, l.p), l.d))), 2), q), k: 1 };
    }
    case 'rotate': {
      const c = P(def.center);
      const deg = numberOf(def.angle, vals);
      if (!c || deg === undefined) return undefined;
      const t = ((def.cw ? -deg : deg) * Math.PI) / 180;
      const [cs, sn] = [Math.cos(t), Math.sin(t)];
      return { f: (q) => ({ x: c.x + (q.x - c.x) * cs - (q.y - c.y) * sn, y: c.y + (q.x - c.x) * sn + (q.y - c.y) * cs }), k: 1 };
    }
    case 'translate': {
      const a = P(def.a);
      const b = P(def.b);
      if (!a || !b) return undefined;
      const v = sub(b, a);
      return { f: (q) => add(q, v), k: 1 };
    }
    case 'dilate': {
      const c = P(def.center);
      const k = numberOf(def.factor, vals);
      if (!c || k === undefined) return undefined;
      return { f: (q) => add(c, mul(sub(q, c), k)), k };
    }
  }
}

/** Applies a point map to any drawable value. */
export function mapValue(v: Value | undefined, f: Map2, k: number): Value | undefined {
  if (!v) return undefined;
  switch (v.type) {
    case 'point':
      return { type: 'point', p: f(v.p), free: false };
    case 'line': {
      if (Math.abs(k) < EPS) return undefined;
      const p = f(v.p);
      const d = unit(sub(f(add(v.p, v.d)), p));
      if (!d) return undefined;
      return v.seg ? { type: 'line', p, d, seg: [f(v.seg[0]), f(v.seg[1])] } : { type: 'line', p, d };
    }
    case 'circle':
      return Math.abs(k) < EPS ? undefined : { type: 'circle', c: f(v.c), r: v.r * Math.abs(k) };
    case 'polygon':
      return Math.abs(k) < EPS ? undefined : { type: 'polygon', pts: v.pts.map(f), area: v.area * k * k, perimeter: v.perimeter * Math.abs(k) };
    default:
      return undefined;
  }
}

/** Tangent lines from `p` to a circle: the touching points, in a stable order (left of C→P first). */
export function tangentPoints(p: Vec, c: Vec, r: number): Vec[] {
  const d = dist(p, c);
  const tol = 1e-9 * Math.max(1, r);
  if (d < r - tol) return [];
  if (d <= r + tol) return [p];
  const phi = Math.atan2(p.y - c.y, p.x - c.x);
  const a = Math.acos(r / d);
  return [phi + a, phi - a].map((t) => ({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) }));
}

/** Corners of a regular n-gon on the side a→b, going counterclockwise. */
export function regularPolygonPoints(a: Vec, b: Vec, n: number): Vec[] {
  const pts = [a, b];
  const ext = (2 * Math.PI) / n;
  let e = sub(b, a);
  for (let i = 2; i < n; i++) {
    e = { x: e.x * Math.cos(ext) - e.y * Math.sin(ext), y: e.x * Math.sin(ext) + e.y * Math.cos(ext) };
    pts.push(add(pts[i - 1]!, e));
  }
  return pts;
}

function polygonValue(ps: Vec[]): Value {
  let area = 0;
  let perimeter = 0;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i]!;
    const q = ps[(i + 1) % ps.length]!;
    area += cross(p, q);
    perimeter += dist(p, q);
  }
  return { type: 'polygon', pts: ps, area: Math.abs(area) / 2, perimeter };
}

const pointOf = (v: Value | undefined): Vec | undefined => (v?.type === 'point' ? v.p : undefined);
type Curve = Extract<Value, { type: 'line' } | { type: 'circle' }>;
const curveOf = (v: Value | undefined): Curve | undefined => (v?.type === 'line' || v?.type === 'circle' ? v : undefined);

/** Evaluates one definition given the values of everything before it. */
export function evaluateDef(def: Def, vals: Values): Value | undefined {
  const P = (id: Id) => pointOf(vals.get(id));
  switch (def.kind) {
    case 'point':
      return Number.isFinite(def.x) && Number.isFinite(def.y) ? { type: 'point', p: { x: def.x, y: def.y }, free: true } : undefined;
    case 'midpoint': {
      const a = P(def.a);
      const b = P(def.b);
      return a && b ? { type: 'point', p: mul(add(a, b), 0.5), free: false } : undefined;
    }
    case 'segment':
    case 'line': {
      const a = P(def.a);
      const b = P(def.b);
      const d = a && b ? unit(sub(b, a)) : undefined;
      if (!a || !b || !d) return undefined;
      return def.kind === 'segment' ? { type: 'line', p: a, d, seg: [a, b] } : { type: 'line', p: a, d };
    }
    case 'circle': {
      const c = P(def.center);
      const t = P(def.through);
      return c && t ? { type: 'circle', c, r: dist(c, t) } : undefined;
    }
    case 'circleRadius': {
      const c = P(def.center);
      const r = numberOf(def.r, vals);
      return c && r !== undefined && r > 0 ? { type: 'circle', c, r } : undefined;
    }
    case 'compass': {
      const c = P(def.center);
      const a = P(def.a);
      const b = P(def.b);
      const r = a && b ? dist(a, b) : 0;
      return c && r > EPS ? { type: 'circle', c, r } : undefined;
    }
    case 'polygon': {
      const pts = def.pts.map(P);
      if (pts.length < 3 || pts.some((p) => !p)) return undefined;
      return polygonValue(pts as Vec[]);
    }
    case 'regularPolygon': {
      const a = P(def.a);
      const b = P(def.b);
      const raw = numberOf(def.n, vals);
      if (!a || !b || raw === undefined || dist(a, b) < EPS) return undefined;
      const n = Math.round(raw);
      if (n < 3 || n > 100) return undefined;
      return polygonValue(regularPolygonPoints(a, b, n));
    }
    case 'perpBisector': {
      const a = P(def.a);
      const b = P(def.b);
      const d = a && b ? unit(sub(b, a)) : undefined;
      return a && b && d ? { type: 'line', p: mul(add(a, b), 0.5), d: { x: -d.y, y: d.x } } : undefined;
    }
    case 'angleBisector': {
      const a = P(def.a);
      const b = P(def.b);
      const c = P(def.c);
      const u = a && b ? unit(sub(a, b)) : undefined;
      const w = c && b ? unit(sub(c, b)) : undefined;
      if (!b || !u || !w) return undefined;
      // A straight angle has no sum of directions; its bisector is perpendicular to the arms.
      const d = unit(add(u, w)) ?? { x: -u.y, y: u.x };
      return { type: 'line', p: b, d };
    }
    case 'tangent': {
      const p = P(def.point);
      const c = vals.get(def.circle);
      if (!p || c?.type !== 'circle') return undefined;
      const ts = tangentPoints(p, c.c, c.r);
      const t = ts[def.which];
      if (!t) return undefined;
      // On the circle the tangent is perpendicular to the radius.
      const d = ts.length === 1 ? unit({ x: -(p.y - c.c.y), y: p.x - c.c.x }) : unit(sub(t, p));
      return d ? { type: 'line', p, d } : undefined;
    }
    case 'slider': {
      const { min, max } = def;
      if (![min, max, def.value].every(Number.isFinite) || !(max > min)) return undefined;
      return { type: 'number', value: Math.min(max, Math.max(min, def.value)), min, max, step: def.step && def.step > 0 ? def.step : niceStep(min, max) };
    }
    case 'reflect':
    case 'rotate':
    case 'translate':
    case 'dilate': {
      const t = transformOf(def, vals);
      return t ? mapValue(vals.get(def.src), t.f, t.k) : undefined;
    }
    case 'perpendicular':
    case 'parallel': {
      const l = vals.get(def.line);
      const t = P(def.through);
      if (l?.type !== 'line' || !t) return undefined;
      const d = def.kind === 'parallel' ? l.d : { x: -l.d.y, y: l.d.x };
      return { type: 'line', p: t, d };
    }
    case 'intersection': {
      const a = curveOf(vals.get(def.a));
      const b = curveOf(vals.get(def.b));
      if (!a || !b) return undefined;
      const pts = intersect(a, b);
      const p = pts[def.which];
      return p ? { type: 'point', p, free: false } : undefined;
    }
    case 'angle': {
      const a = P(def.a);
      const b = P(def.b);
      const c = P(def.c);
      if (!a || !b || !c) return undefined;
      const u = sub(a, b);
      const w = sub(c, b);
      if (Math.hypot(u.x, u.y) < EPS || Math.hypot(w.x, w.y) < EPS) return undefined;
      const from = Math.atan2(u.y, u.x);
      // Signed sweep from BA to BC, in (-π, π]; its size is the angle.
      const sweep = Math.atan2(cross(u, w), dot(u, w));
      return { type: 'angle', at: b, from, sweep, deg: (Math.abs(sweep) * 180) / Math.PI };
    }
    case 'distance': {
      const a = P(def.a);
      const b = P(def.b);
      return a && b ? { type: 'distance', a, b, length: dist(a, b) } : undefined;
    }
  }
}

/**
 * Common points of two curves, in a stable order so an intersection keeps following the same point as the
 * figure moves: along the first line's direction, or (for two circles) left then right of the line of centres.
 * Points off a segment's ends don't count.
 */
export function intersect(a: Curve, b: Curve): Vec[] {
  let pts: Vec[];
  if (a.type === 'line' && b.type === 'line') {
    const den = cross(a.d, b.d);
    if (Math.abs(den) < EPS) return [];
    const t = cross(sub(b.p, a.p), b.d) / den;
    pts = [add(a.p, mul(a.d, t))];
  } else if (a.type === 'line' || b.type === 'line') {
    const l = (a.type === 'line' ? a : b) as Extract<Curve, { type: 'line' }>;
    const c = (a.type === 'circle' ? a : b) as Extract<Curve, { type: 'circle' }>;
    // |p + t d − c|² = r², with |d| = 1.
    const f = sub(l.p, c.c);
    const B = dot(f, l.d);
    const C = dot(f, f) - c.r * c.r;
    const disc = B * B - C;
    if (disc < -EPS) return [];
    const s = Math.sqrt(Math.max(0, disc));
    const ts = s < EPS ? [-B] : [-B - s, -B + s];
    pts = ts.map((t) => add(l.p, mul(l.d, t)));
  } else {
    const A = a as Extract<Curve, { type: 'circle' }>;
    const B = b as Extract<Curve, { type: 'circle' }>;
    const d = dist(A.c, B.c);
    if (d < EPS || d > A.r + B.r + EPS || d < Math.abs(A.r - B.r) - EPS) return [];
    const x = (d * d + A.r * A.r - B.r * B.r) / (2 * d);
    const h = Math.sqrt(Math.max(0, A.r * A.r - x * x));
    const e = mul(sub(B.c, A.c), 1 / d);
    const m = add(A.c, mul(e, x));
    const n = { x: -e.y, y: e.x };
    pts = h < EPS ? [m] : [add(m, mul(n, h)), sub(m, mul(n, h))];
  }
  return pts.filter((p) => onSegment(a, p) && onSegment(b, p));
}

function onSegment(c: Curve, p: Vec): boolean {
  if (c.type !== 'line' || !c.seg) return true;
  const [s, e] = c.seg;
  const len = dist(s, e);
  const t = dot(sub(p, s), c.d);
  return t >= -1e-7 * Math.max(1, len) && t <= len * (1 + 1e-7) + 1e-9;
}

/** Shortest distance from a point to a drawn object (for picking it with a pointer). */
export function distanceTo(v: Value, q: Vec): number {
  switch (v.type) {
    case 'point':
      return dist(v.p, q);
    case 'line': {
      if (v.seg) {
        const [s, e] = v.seg;
        const len = dist(s, e);
        const t = Math.max(0, Math.min(len, dot(sub(q, s), v.d)));
        return dist(q, add(s, mul(v.d, t)));
      }
      return Math.abs(cross(v.d, sub(q, v.p)));
    }
    case 'circle':
      return Math.abs(dist(v.c, q) - v.r);
    case 'polygon': {
      let best = Infinity;
      for (let i = 0; i < v.pts.length; i++) {
        const s = v.pts[i]!;
        const e = v.pts[(i + 1) % v.pts.length]!;
        const d = unit(sub(e, s));
        if (!d) continue;
        best = Math.min(best, distanceTo({ type: 'line', p: s, d, seg: [s, e] }, q));
      }
      return insidePolygon(v.pts, q) ? Math.min(best, 0) : best;
    }
    case 'angle':
      return dist(v.at, q);
    case 'distance':
      return distanceTo({ type: 'line', p: v.a, d: unit(sub(v.b, v.a)) ?? { x: 1, y: 0 }, seg: [v.a, v.b] }, q);
    case 'number':
      return Infinity;
  }
}

/** The nearest point on a drawn line, segment or circle (for snapping onto objects). */
export function nearestOn(v: Value, q: Vec): Vec | undefined {
  if (v.type === 'line') {
    if (v.seg) {
      const [s, e] = v.seg;
      const t = Math.max(0, Math.min(dist(s, e), dot(sub(q, s), v.d)));
      return add(s, mul(v.d, t));
    }
    return add(v.p, mul(v.d, dot(sub(q, v.p), v.d)));
  }
  if (v.type === 'circle') {
    const u = unit(sub(q, v.c));
    return u ? add(v.c, mul(u, v.r)) : undefined;
  }
  if (v.type === 'point') return v.p;
  if (v.type === 'polygon') {
    let best: Vec | undefined;
    for (let i = 0; i < v.pts.length; i++) {
      const s = v.pts[i]!;
      const e = v.pts[(i + 1) % v.pts.length]!;
      const d = unit(sub(e, s));
      const p = d ? nearestOn({ type: 'line', p: s, d, seg: [s, e] }, q) : s;
      if (p && (!best || dist(p, q) < dist(best, q))) best = p;
    }
    return best;
  }
  return undefined;
}

function insidePolygon(pts: Vec[], q: Vec): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Rounds to the nearest multiple of `step` (the grid). */
export const snap = (v: number, step: number) => (step > 0 ? Math.round(v / step) * step : v);
