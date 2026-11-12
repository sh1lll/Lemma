import type { FloatEnv, FloatFn } from '@lemma/math-core';

export interface SurfaceGrid {
  /** Samples per side minus one: the grid has (n + 1)² values, row by row (y outer, x inner). */
  n: number;
  x: [number, number];
  y: [number, number];
  /** z values; NaN where f is undefined. */
  z: Float64Array;
  /** The z range to draw: the data's, unless a few spikes (poles) would flatten everything else. */
  zMin: number;
  zMax: number;
  /** True when zMin/zMax were narrowed to ignore spikes (values outside are drawn clamped). */
  clipped: boolean;
}

/**
 * Samples z = f(x, y) on an (n + 1) × (n + 1) grid. A 60 × 60 grid is a few thousand compiled-closure calls,
 * well under a millisecond for ordinary expressions; the budget is 30 ms.
 */
export function sampleSurface(f: FloatFn, env: FloatEnv, x: [number, number], y: [number, number], n = 60): SurfaceGrid {
  const z = new Float64Array((n + 1) * (n + 1));
  const e = { ...env };
  const finite: number[] = [];
  for (let j = 0; j <= n; j++) {
    e.y = y[0] + ((y[1] - y[0]) * j) / n;
    for (let i = 0; i <= n; i++) {
      e.x = x[0] + ((x[1] - x[0]) * i) / n;
      const v = f(e);
      const ok = Number.isFinite(v);
      z[j * (n + 1) + i] = ok ? v : NaN;
      if (ok) finite.push(v);
    }
  }
  if (!finite.length) return { n, x, y, z, zMin: -1, zMax: 1, clipped: false };
  finite.sort((a, b) => a - b);
  let zMin = finite[0]!;
  let zMax = finite[finite.length - 1]!;
  let clipped = false;
  // Poles (1/(x·y)) produce a few huge values; keep the 2nd–98th percentile band (with margin) in that case.
  const lo = finite[Math.floor(finite.length * 0.02)]!;
  const hi = finite[Math.ceil(finite.length * 0.98) - 1]!;
  if (hi > lo && zMax - zMin > 8 * (hi - lo)) {
    const pad = (hi - lo) * 0.5;
    zMin = Math.max(zMin, lo - pad);
    zMax = Math.min(zMax, hi + pad);
    clipped = true;
  }
  if (zMax - zMin < 1e-12 * Math.max(1, Math.abs(zMax))) {
    // A flat surface: give it a unit-high box so it sits mid-height instead of dividing by zero.
    zMin -= 1;
    zMax += 1;
  }
  return { n, x, y, z, zMin, zMax, clipped };
}
