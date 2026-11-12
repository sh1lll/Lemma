/**
 * Least-squares fitting of any model with free parameters (the workspace's "y₁ ~ m x₁ + b" rows): Levenberg–Marquardt
 * with a forward-difference Jacobian, started from a few points so exponential and power models converge as well as
 * linear ones (a linear model converges in one or two steps from anywhere).
 */

export interface FitResult {
  params: number[];
  /** Sum of squared residuals. */
  sse: number;
  /** Coefficient of determination, 1 − SSE / SST. */
  r2: number;
  /** Points used (both sides finite). */
  n: number;
}

/** Solves A x = b (n × n, row-major) by Gaussian elimination with partial pivoting; null when singular. */
export function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    if (Math.abs(M[p]![c]!) < 1e-300) return null;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = c + 1; r < n; r++) {
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r]![n]!;
    for (let k = r + 1; k < n; k++) s -= M[r]![k]! * x[k]!;
    x[r] = s / M[r]![r]!;
  }
  return x.every(Number.isFinite) ? x : null;
}

/**
 * Fits model(p, k) ≈ ys[k] over the parameters p. `np` is the number of parameters.
 */
export function fitModel(model: (p: number[], k: number) => number, ys: number[], np: number): FitResult {
  const idx = ys.map((y, k) => (Number.isFinite(y) ? k : -1)).filter((k) => k >= 0);
  const sseOf = (p: number[]) => {
    let s = 0;
    let used = 0;
    for (const k of idx) {
      const r = model(p, k) - ys[k]!;
      if (!Number.isFinite(r)) return Infinity;
      s += r * r;
      used++;
    }
    return used ? s : Infinity;
  };
  const starts: number[][] = [new Array(np).fill(1), new Array(np).fill(0.5), new Array(np).fill(-1), new Array(np).fill(0.1), new Array(np).fill(2)];
  let best = { p: starts[0]!, sse: Infinity };
  for (const s of starts) {
    const r = lm(model, ys, idx, s, sseOf);
    if (r.sse < best.sse) best = r;
    if (best.sse < 1e-20) break;
  }
  const mean = idx.reduce((a, k) => a + ys[k]!, 0) / Math.max(1, idx.length);
  const sst = idx.reduce((a, k) => a + (ys[k]! - mean) ** 2, 0);
  return { params: best.p, sse: best.sse, r2: sst > 0 ? 1 - best.sse / sst : best.sse < 1e-12 ? 1 : 0, n: idx.length };
}

function lm(model: (p: number[], k: number) => number, ys: number[], idx: number[], p0: number[], sseOf: (p: number[]) => number): { p: number[]; sse: number } {
  let p = [...p0];
  let sse = sseOf(p);
  let lambda = 1e-3;
  const np = p.length;
  for (let iter = 0; iter < 200 && Number.isFinite(sse); iter++) {
    // Jacobian rows and residuals.
    const JtJ = Array.from({ length: np }, () => new Array<number>(np).fill(0));
    const Jtr = new Array<number>(np).fill(0);
    let bad = false;
    for (const k of idx) {
      const f0 = model(p, k);
      const r = f0 - ys[k]!;
      const row = new Array<number>(np);
      for (let j = 0; j < np; j++) {
        const h = 1e-7 * Math.max(1, Math.abs(p[j]!));
        const q = [...p];
        q[j]! += h;
        row[j] = (model(q, k) - f0) / h;
        if (!Number.isFinite(row[j]!)) bad = true;
      }
      if (bad) break;
      for (let a = 0; a < np; a++) {
        Jtr[a]! += row[a]! * r;
        for (let b = 0; b < np; b++) JtJ[a]![b]! += row[a]! * row[b]!;
      }
    }
    if (bad) break;
    let improved = false;
    for (let tries = 0; tries < 12; tries++) {
      const A = JtJ.map((row, a) => row.map((v, b) => (a === b ? v + lambda * (v || 1e-12) : v)));
      const d = solve(A, Jtr.map((v) => -v));
      if (!d) {
        lambda *= 10;
        continue;
      }
      const q = p.map((v, j) => v + d[j]!);
      const s = sseOf(q);
      if (s < sse) {
        const rel = (sse - s) / Math.max(sse, 1e-300);
        p = q;
        sse = s;
        lambda = Math.max(1e-12, lambda / 10);
        improved = true;
        if (rel < 1e-14) return { p, sse };
        break;
      }
      lambda *= 10;
    }
    if (!improved || sse < 1e-24) break;
  }
  return { p, sse };
}
