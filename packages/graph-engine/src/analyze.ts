import type { FloatEnv, FloatFn } from '@lemma/math-core';
import type { GraphItem } from './spec';

export type PoiKind = 'root' | 'min' | 'max' | 'y-intercept' | 'intersection';

/** A point of interest on one curve (or two, for intersections). */
export interface Poi {
  kind: PoiKind;
  x: number;
  y: number;
  items: number[];
}

const SAMPLES = 800;

function bisect(g: (x: number) => number, a: number, b: number, ga: number): number {
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

/** Golden-section search for a local extremum of f on [a, b]. */
function golden(f: (x: number) => number, a: number, b: number, max: boolean): number {
  const r = (Math.sqrt(5) - 1) / 2;
  const sgn = max ? -1 : 1;
  let c = b - r * (b - a);
  let d = a + r * (b - a);
  for (let i = 0; i < 80; i++) {
    if (sgn * f(c) < sgn * f(d)) b = d;
    else a = c;
    c = b - r * (b - a);
    d = a + r * (b - a);
  }
  return (a + b) / 2;
}

const tidy = (v: number) => {
  // Snap values within float noise of a "nice" number (1e-9 relative) so 2.9999999997 shows as 3.
  const r = Math.round(v * 1e6) / 1e6;
  return Math.abs(r - v) < 1e-9 * Math.max(1, Math.abs(v)) ? r : v;
};

/** Sign changes of g where g really crosses zero (not a pole). */
export function zeros(g: (x: number) => number, lo: number, hi: number): number[] {
  const out: number[] = [];
  const dx = (hi - lo) / SAMPLES;
  let px = lo;
  let pg = g(px);
  for (let i = 1; i <= SAMPLES; i++) {
    const x = lo + i * dx;
    const gx = g(x);
    if (Number.isFinite(pg) && Number.isFinite(gx)) {
      // A run of exact zeros (floor(x) on [0, 1), the constant 0) is one root where it starts, not one per sample.
      if (gx === 0) {
        if (pg !== 0) out.push(x);
      }
      else if (pg !== 0 && pg > 0 !== gx > 0) {
        const z = bisect(g, px, x, pg);
        // A pole flips sign too; a true root has |g| shrinking towards it.
        if (Math.abs(g(z)) < 1e-6 * Math.max(1, Math.abs(pg), Math.abs(gx))) out.push(z);
      } else if (Math.abs(gx) < 1e-9 && Math.abs(pg) > 1e-9) {
        // Tangent roots (x² at 0) don't change sign: catch them via a tiny minimum of |g|.
        out.push(x);
      }
    }
    px = x;
    pg = gx;
  }
  return dedupe(out, dx);
}

function dedupe(xs: number[], tol: number): number[] {
  const out: number[] = [];
  for (const x of xs.sort((a, b) => a - b)) if (!out.length || Math.abs(x - out[out.length - 1]!) > tol) out.push(x);
  return out;
}

function extrema(f: (x: number) => number, lo: number, hi: number): { x: number; max: boolean }[] {
  const out: { x: number; max: boolean }[] = [];
  const dx = (hi - lo) / SAMPLES;
  let y0 = f(lo);
  let y1 = f(lo + dx);
  for (let i = 2; i <= SAMPLES; i++) {
    const y2 = f(lo + i * dx);
    if ([y0, y1, y2].every(Number.isFinite)) {
      const max = y1 > y0 && y1 > y2;
      if (max || (y1 < y0 && y1 < y2)) {
        const x = golden(f, lo + (i - 2) * dx, lo + i * dx, max);
        // Near a pole (tan x at π/2) the samples straddle the asymptote and golden search runs off towards it. A real
        // extremum of a smooth curve lies within a few sample steps' change of y1; anything far beyond is the pole.
        const fx = f(x);
        const spread = Math.abs(y1 - y0) + Math.abs(y2 - y1);
        if (Number.isFinite(fx) && Math.abs(fx - y1) <= 2 * spread + 1e-12 * Math.abs(y1)) out.push({ x, max });
      }
    }
    y0 = y1;
    y1 = y2;
  }
  return out;
}

/** Roots, extrema, y-intercepts and pairwise intersections of the explicit curves within [xMin, xMax]. */
export function analyze(items: GraphItem[], env: FloatEnv, xMin: number, xMax: number, limit = 60): Poi[] {
  const explicit = items.filter((i): i is Extract<GraphItem, { kind: 'explicit' }> => i.kind === 'explicit');
  const pois: Poi[] = [];
  const fOf = (f: FloatFn) => {
    const e = { ...env };
    return (x: number) => {
      e.x = x;
      return f(e);
    };
  };
  for (const it of explicit) {
    const lo = Math.max(xMin, it.domain?.[0] ?? -Infinity);
    const hi = Math.min(xMax, it.domain?.[1] ?? Infinity);
    if (!(hi > lo)) continue;
    const f = fOf(it.f);
    for (const x of zeros(f, lo, hi)) pois.push({ kind: 'root', x: tidy(x), y: 0, items: [it.id] });
    for (const e of extrema(f, lo, hi)) pois.push({ kind: e.max ? 'max' : 'min', x: tidy(e.x), y: tidy(f(e.x)), items: [it.id] });
    if (lo <= 0 && hi >= 0) {
      const y0 = f(0);
      if (Number.isFinite(y0)) pois.push({ kind: 'y-intercept', x: 0, y: tidy(y0), items: [it.id] });
    }
  }
  for (let i = 0; i < explicit.length; i++) {
    for (let j = i + 1; j < explicit.length; j++) {
      const a = explicit[i]!;
      const b = explicit[j]!;
      const fa = fOf(a.f);
      const fb = fOf(b.f);
      const lo = Math.max(xMin, a.domain?.[0] ?? -Infinity, b.domain?.[0] ?? -Infinity);
      const hi = Math.min(xMax, a.domain?.[1] ?? Infinity, b.domain?.[1] ?? Infinity);
      if (!(hi > lo)) continue;
      for (const x of zeros((x) => fa(x) - fb(x), lo, hi)) pois.push({ kind: 'intersection', x: tidy(x), y: tidy(fa(x)), items: [a.id, b.id] });
    }
  }
  return pois.slice(0, limit);
}
