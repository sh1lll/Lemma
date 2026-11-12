import type { FloatEnv, FloatFn } from '@lemma/math-core';

export interface Viewport {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** Polylines in world coordinates; a curve is split wherever it is undefined or jumps (asymptotes). */
export type Polyline = Float64Array; // [x0, y0, x1, y1, …]

/**
 * Samples y = f(x) across the viewport at roughly two points per pixel, then bisects any interval whose
 * midpoint deviates from the chord, so sharp features stay sharp without oversampling smooth regions.
 */
export function sampleExplicit(f: FloatFn, env: FloatEnv, vp: Viewport, pixels: number, domain?: [number, number]): Polyline[] {
  const lo = Math.max(vp.xMin, domain?.[0] ?? -Infinity);
  const hi = Math.min(vp.xMax, domain?.[1] ?? Infinity);
  if (!(hi > lo)) return [];
  const n = Math.max(64, Math.min(4000, Math.round(pixels * 2)));
  const dx = (hi - lo) / n;
  const yRange = vp.yMax - vp.yMin;
  const e = { ...env };
  const at = (x: number) => {
    e.x = x;
    return f(e);
  };
  const lines: Polyline[] = [];
  let cur: number[] = [];
  const flush = () => {
    if (cur.length >= 4) lines.push(Float64Array.from(cur));
    cur = [];
  };
  let px = lo;
  let py = at(px);
  if (Number.isFinite(py)) cur.push(px, py);
  for (let i = 1; i <= n; i++) {
    const x = i === n ? hi : lo + i * dx;
    const y = at(x);
    if (!Number.isFinite(y)) {
      flush();
    } else if (!Number.isFinite(py)) {
      cur.push(x, y);
    } else {
      // Asymptote check: a big jump whose midpoint is not between the ends.
      const jump = Math.abs(y - py);
      if (jump > yRange * 0.5) {
        const ym = at((x + px) / 2);
        const between = Number.isFinite(ym) && (ym - py) * (y - ym) >= 0 && Math.abs(ym - (py + y) / 2) < jump;
        if (!between) {
          flush();
          cur.push(x, y);
          px = x;
          py = y;
          continue;
        }
      }
      const tol = yRange / 400;
      // Step functions (floor, ceil, round, sign…): end the piece at the jump instead of drawing a vertical riser.
      const edge = jump > tol ? findJump(at, px, py, x, y, tol) : null;
      if (edge) {
        refine(at, px, py, edge.xa, edge.ya, tol, 4, cur);
        cur.push(edge.xa, edge.ya);
        flush();
        cur.push(edge.xb, edge.yb);
        refine(at, edge.xb, edge.yb, x, y, tol, 4, cur);
        cur.push(x, y);
        px = x;
        py = y;
        continue;
      }
      refine(at, px, py, x, y, tol, 4, cur);
      cur.push(x, y);
    }
    px = x;
    py = y;
  }
  flush();
  return lines;
}

/**
 * Finds a jump discontinuity inside [x0, x1], or null when the change is continuous. Screened cheaply first:
 * across a step nearly all of the change is in one half, which a smooth curve sampled this finely rarely does. Then bisects
 * toward the change; a continuous function's change shrinks with the interval, a jump's doesn't.
 */
function findJump(at: (x: number) => number, x0: number, y0: number, x1: number, y1: number, tol: number): { xa: number; ya: number; xb: number; yb: number } | null {
  const total = Math.abs(y1 - y0);
  const ym = at((x0 + x1) / 2);
  if (!Number.isFinite(ym)) return null;
  if (Math.min(Math.abs(ym - y0), Math.abs(y1 - ym)) > total * 0.1) return null;
  let xa = x0;
  let ya = y0;
  let xb = x1;
  let yb = y1;
  for (let i = 0; i < 60 && xb - xa > Math.abs(xa) * 1e-15 + 1e-300; i++) {
    const xm = (xa + xb) / 2;
    if (xm <= xa || xm >= xb) break;
    const v = at(xm);
    if (!Number.isFinite(v)) return null;
    if (Math.abs(v - ya) >= Math.abs(yb - v)) {
      xb = xm;
      yb = v;
    } else {
      xa = xm;
      ya = v;
    }
  }
  const gap = Math.abs(yb - ya);
  return gap > tol && gap > total * 0.25 ? { xa, ya, xb, yb } : null;
}

function refine(at: (x: number) => number, x0: number, y0: number, x1: number, y1: number, tol: number, depth: number, out: number[]): void {
  if (depth === 0) return;
  const xm = (x0 + x1) / 2;
  const ym = at(xm);
  if (!Number.isFinite(ym)) return;
  if (Math.abs(ym - (y0 + y1) / 2) <= tol) return;
  refine(at, x0, y0, xm, ym, tol, depth - 1, out);
  out.push(xm, ym);
  refine(at, xm, ym, x1, y1, tol, depth - 1, out);
}

/** x = g(y): sample along y and swap. */
export function sampleXofY(g: FloatFn, env: FloatEnv, vp: Viewport, pixels: number): Polyline[] {
  const swapped = sampleExplicit((e) => g({ ...e, y: e.x ?? NaN }), env, { xMin: vp.yMin, xMax: vp.yMax, yMin: vp.xMin, yMax: vp.xMax }, pixels);
  return swapped.map((p) => {
    const q = new Float64Array(p.length);
    for (let i = 0; i < p.length; i += 2) {
      q[i] = p[i + 1]!;
      q[i + 1] = p[i]!;
    }
    return q;
  });
}

export function sampleParametric(fx: FloatFn, fy: FloatFn, env: FloatEnv, range: [number, number], vp: Viewport, varName: 't' | 'theta' = 't'): Polyline[] {
  const n = 1500;
  const e = { ...env };
  const lines: Polyline[] = [];
  let cur: number[] = [];
  const span = Math.max(vp.xMax - vp.xMin, vp.yMax - vp.yMin);
  let lx = NaN;
  let ly = NaN;
  for (let i = 0; i <= n; i++) {
    e[varName] = range[0] + ((range[1] - range[0]) * i) / n;
    const x = fx(e);
    const y = fy(e);
    if (!Number.isFinite(x) || !Number.isFinite(y) || (Number.isFinite(lx) && Math.hypot(x - lx, y - ly) > span * 0.5)) {
      if (cur.length >= 4) lines.push(Float64Array.from(cur));
      cur = [];
    }
    if (Number.isFinite(x) && Number.isFinite(y)) cur.push(x, y);
    lx = x;
    ly = y;
  }
  if (cur.length >= 4) lines.push(Float64Array.from(cur));
  return lines;
}

export function samplePolar(r: FloatFn, env: FloatEnv, range: [number, number], vp: Viewport): Polyline[] {
  return sampleParametric(
    (e) => r(e) * Math.cos(e.theta ?? 0),
    (e) => r(e) * Math.sin(e.theta ?? 0),
    env,
    range,
    vp,
    'theta',
  );
}

/**
 * Marching squares for F(x, y) = 0. Returns line segments [x0,y0,x1,y1,…] and, for inequalities,
 * the grid of signs so a renderer can shade the region.
 */
export function marchImplicit(F: FloatFn, env: FloatEnv, vp: Viewport, cols: number, rows: number): { segments: Float64Array; values: Float64Array } {
  const e = { ...env };
  const values = new Float64Array((cols + 1) * (rows + 1));
  const dx = (vp.xMax - vp.xMin) / cols;
  const dy = (vp.yMax - vp.yMin) / rows;
  for (let j = 0; j <= rows; j++) {
    e.y = vp.yMin + j * dy;
    for (let i = 0; i <= cols; i++) {
      e.x = vp.xMin + i * dx;
      values[j * (cols + 1) + i] = F(e);
    }
  }
  const seg: number[] = [];
  const v = (i: number, j: number) => values[j * (cols + 1) + i]!;
  const lerp = (a: number, b: number) => (Math.abs(a - b) < 1e-300 ? 0.5 : a / (a - b));
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = v(i, j); // bottom-left
      const b = v(i + 1, j); // bottom-right
      const c = v(i + 1, j + 1); // top-right
      const d = v(i, j + 1); // top-left
      if (![a, b, c, d].every(Number.isFinite)) continue;
      const x0 = vp.xMin + i * dx;
      const y0 = vp.yMin + j * dy;
      const pts: number[] = [];
      // Edge crossings, in order: bottom, right, top, left.
      if (a > 0 !== b > 0) pts.push(x0 + lerp(a, b) * dx, y0);
      if (b > 0 !== c > 0) pts.push(x0 + dx, y0 + lerp(b, c) * dy);
      if (d > 0 !== c > 0) pts.push(x0 + lerp(d, c) * dx, y0 + dy);
      if (a > 0 !== d > 0) pts.push(x0, y0 + lerp(a, d) * dy);
      if (pts.length === 4) {
        // Reject sign flips across a pole (e.g. 1/x = y): a real zero keeps |F| small near the crossing.
        const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
        if (scale > 1e6) continue;
        seg.push(...pts);
      } else if (pts.length === 8) {
        // Saddle: disambiguate with the centre value.
        const centre = (a + b + c + d) / 4;
        if (centre > 0 === a > 0) seg.push(pts[0]!, pts[1]!, pts[2]!, pts[3]!, pts[4]!, pts[5]!, pts[6]!, pts[7]!);
        else seg.push(pts[0]!, pts[1]!, pts[6]!, pts[7]!, pts[2]!, pts[3]!, pts[4]!, pts[5]!);
      }
    }
  }
  return { segments: Float64Array.from(seg), values };
}
