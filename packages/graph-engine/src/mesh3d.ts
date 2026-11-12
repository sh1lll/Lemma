import type { FloatEnv, FloatFn } from '@lemma/math-core';

/**
 * Geometry for the workspace's 3D view, in graph coordinates (no DOM, no GPU): triangle meshes with per-vertex
 * normals for z = f(x, y), parametric surfaces, implicit surfaces F(x, y, z) = 0 and 2D curves extruded along z,
 * plus polylines for 3D curves. The implicit polygoniser is marching cubes in its tetrahedral form (each cube split
 * into six tetrahedra): no 256-case table, no ambiguous faces, and it runs in slices so the caller can spread the
 * work over frames.
 */

export interface Box3 {
  x: [number, number];
  y: [number, number];
  z: [number, number];
}

export interface Mesh3 {
  /** x, y, z per vertex. */
  pos: Float32Array;
  /** Unit normal per vertex (lighting is two-sided, so orientation doesn't matter). */
  nrm: Float32Array;
  /** Triangles, three vertex indices each. */
  idx: Uint32Array;
}

const EMPTY: Mesh3 = { pos: new Float32Array(0), nrm: new Float32Array(0), idx: new Uint32Array(0) };

/** Per-vertex normals from the triangles (area-weighted), for meshes built on a grid. */
function gridNormals(pos: Float32Array, idx: Uint32Array): Float32Array {
  const nrm = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]! * 3;
    const b = idx[t + 1]! * 3;
    const c = idx[t + 2]! * 3;
    const ux = pos[b]! - pos[a]!;
    const uy = pos[b + 1]! - pos[a + 1]!;
    const uz = pos[b + 2]! - pos[a + 2]!;
    const vx = pos[c]! - pos[a]!;
    const vy = pos[c + 1]! - pos[a + 1]!;
    const vz = pos[c + 2]! - pos[a + 2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) {
      nrm[k]! += nx;
      nrm[k + 1]! += ny;
      nrm[k + 2]! += nz;
    }
  }
  for (let k = 0; k < nrm.length; k += 3) {
    const l = Math.hypot(nrm[k]!, nrm[k + 1]!, nrm[k + 2]!) || 1;
    nrm[k]! /= l;
    nrm[k + 1]! /= l;
    nrm[k + 2]! /= l;
  }
  return nrm;
}

/** A grid surface from a point function over (s, t) ∈ [0, 1]²; cells with an undefined corner are left out. */
function gridMesh(at: (s: number, t: number, out: number[]) => boolean, n: number, m = n): Mesh3 {
  const side = n + 1;
  const pos = new Float32Array(side * (m + 1) * 3);
  const ok = new Uint8Array(side * (m + 1));
  const p = [0, 0, 0];
  for (let j = 0; j <= m; j++) {
    for (let i = 0; i <= n; i++) {
      const k = j * side + i;
      if (at(i / n, j / m, p) && p.every(Number.isFinite)) {
        pos[k * 3] = p[0]!;
        pos[k * 3 + 1] = p[1]!;
        pos[k * 3 + 2] = p[2]!;
        ok[k] = 1;
      }
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * side + i;
      const b = a + 1;
      const c = a + side + 1;
      const d = a + side;
      if (ok[a] && ok[b] && ok[c]) idx.push(a, b, c);
      if (ok[a] && ok[c] && ok[d]) idx.push(a, c, d);
    }
  }
  const I = Uint32Array.from(idx);
  return { pos, nrm: gridNormals(pos, I), idx: I };
}

/** z = f(x, y) over the box's x and y; values far outside the box's z range are dropped (they'd only be clipped). */
export function surfaceMesh(f: FloatFn, env: FloatEnv, box: Box3, n = 64): Mesh3 {
  const e = { ...env };
  const zr = box.z[1] - box.z[0];
  return gridMesh((s, t, out) => {
    e.x = box.x[0] + s * (box.x[1] - box.x[0]);
    e.y = box.y[0] + t * (box.y[1] - box.y[0]);
    const z = f(e);
    out[0] = e.x;
    out[1] = e.y;
    out[2] = Math.max(box.z[0] - zr, Math.min(box.z[1] + zr, z));
    return Number.isFinite(z);
  }, n);
}

export function paramSurfaceMesh(fx: FloatFn, fy: FloatFn, fz: FloatFn, env: FloatEnv, u: [number, number], v: [number, number], n = 64): Mesh3 {
  const e = { ...env };
  return gridMesh((s, t, out) => {
    e.u = u[0] + s * (u[1] - u[0]);
    e.v = v[0] + t * (v[1] - v[0]);
    out[0] = fx(e);
    out[1] = fy(e);
    out[2] = fz(e);
    return true;
  }, n);
}

/** A flat curve (polylines in x, y) swept along z from z0 to z1: a ribbon wall. */
export function extrudeMesh(lines: Float64Array[], z0: number, z1: number): Mesh3 {
  let nv = 0;
  for (const p of lines) nv += (p.length / 2) * 2;
  const pos = new Float32Array(nv * 3);
  const nrm = new Float32Array(nv * 3);
  const idx: number[] = [];
  let v = 0;
  for (const p of lines) {
    const n = p.length / 2;
    for (let i = 0; i < n; i++) {
      const x = p[i * 2]!;
      const y = p[i * 2 + 1]!;
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      let nx = -(p[b * 2 + 1]! - p[a * 2 + 1]!);
      let ny = p[b * 2]! - p[a * 2]!;
      const l = Math.hypot(nx, ny) || 1;
      nx /= l;
      ny /= l;
      for (const [k, z] of [[0, z0], [1, z1]] as const) {
        const o = (v + i * 2 + k) * 3;
        pos[o] = x;
        pos[o + 1] = y;
        pos[o + 2] = z;
        nrm[o] = nx;
        nrm[o + 1] = ny;
      }
      if (i < n - 1) {
        const q = v + i * 2;
        idx.push(q, q + 1, q + 3, q, q + 3, q + 2);
      }
    }
    v += n * 2;
  }
  return { pos, nrm, idx: Uint32Array.from(idx) };
}

/** A 3D curve as polylines (x, y, z triples), split where it's undefined. */
export function curve3d(fx: FloatFn, fy: FloatFn, fz: FloatFn, env: FloatEnv, range: [number, number], n = 800): Float64Array[] {
  const e = { ...env };
  const out: Float64Array[] = [];
  let cur: number[] = [];
  for (let i = 0; i <= n; i++) {
    e.t = range[0] + ((range[1] - range[0]) * i) / n;
    const x = fx(e);
    const y = fy(e);
    const z = fz(e);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) cur.push(x, y, z);
    else if (cur.length) {
      if (cur.length >= 6) out.push(Float64Array.from(cur));
      cur = [];
    }
  }
  if (cur.length >= 6) out.push(Float64Array.from(cur));
  return out;
}

// The six tetrahedra of a cube (corner indices 0–7, bit 0 = x, bit 1 = y, bit 2 = z), all sharing the 0–7 diagonal.
const TETS = [
  [0, 1, 3, 7],
  [0, 3, 2, 7],
  [0, 2, 6, 7],
  [0, 6, 4, 7],
  [0, 4, 5, 7],
  [0, 5, 1, 7],
];

/**
 * F(x, y, z) = 0 inside the box on an n³ grid. A generator: each step polygonises one z-slab, so a caller can
 * stop after a time budget and resume on the next frame. The final value is the mesh.
 */
export function* marchingCubesSteps(F: FloatFn, env: FloatEnv, box: Box3, n = 40): Generator<number, Mesh3, void> {
  const e = { ...env };
  const dx = (box.x[1] - box.x[0]) / n;
  const dy = (box.y[1] - box.y[0]) / n;
  const dz = (box.z[1] - box.z[0]) / n;
  const side = n + 1;
  const slab = (k: number) => {
    const v = new Float64Array(side * side);
    e.z = box.z[0] + k * dz;
    for (let j = 0; j <= n; j++) {
      e.y = box.y[0] + j * dy;
      for (let i = 0; i <= n; i++) {
        e.x = box.x[0] + i * dx;
        v[j * side + i] = F(e);
      }
    }
    return v;
  };
  const pos: number[] = [];
  const nrm: number[] = [];
  const grad = (x: number, y: number, z: number) => {
    const h = Math.min(dx, dy, dz) * 0.5;
    const g = (xx: number, yy: number, zz: number) => {
      e.x = xx;
      e.y = yy;
      e.z = zz;
      return F(e);
    };
    let gx = g(x + h, y, z) - g(x - h, y, z);
    let gy = g(x, y + h, z) - g(x, y - h, z);
    let gz = g(x, y, z + h) - g(x, y, z - h);
    const l = Math.hypot(gx, gy, gz);
    if (!(l > 0) || !Number.isFinite(l)) return [0, 0, 1];
    gx /= l;
    gy /= l;
    gz /= l;
    return [gx, gy, gz];
  };
  const cx = new Float64Array(8);
  const cy = new Float64Array(8);
  const cz = new Float64Array(8);
  const cv = new Float64Array(8);
  const vert = (a: number, b: number) => {
    const va = cv[a]!;
    const vb = cv[b]!;
    const t = Math.abs(va - vb) < 1e-300 ? 0.5 : va / (va - vb);
    const x = cx[a]! + t * (cx[b]! - cx[a]!);
    const y = cy[a]! + t * (cy[b]! - cy[a]!);
    const z = cz[a]! + t * (cz[b]! - cz[a]!);
    pos.push(x, y, z);
    const g = grad(x, y, z);
    nrm.push(g[0]!, g[1]!, g[2]!);
  };
  let lo = slab(0);
  for (let k = 0; k < n; k++) {
    const hi = slab(k + 1);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        let any = 0;
        let pos0 = 0;
        for (let c = 0; c < 8; c++) {
          const ii = i + (c & 1);
          const jj = j + ((c >> 1) & 1);
          const v = (c & 4 ? hi : lo)[jj * side + ii]!;
          cv[c] = v;
          if (!Number.isFinite(v)) any = -1;
          if (v > 0) pos0++;
          cx[c] = box.x[0] + ii * dx;
          cy[c] = box.y[0] + jj * dy;
          cz[c] = box.z[0] + (k + (c >> 2)) * dz;
        }
        if (any < 0 || pos0 === 0 || pos0 === 8) continue;
        // Reject sign flips across a pole: a real surface keeps |F| moderate near the crossing.
        let scale = 0;
        for (let c = 0; c < 8; c++) scale = Math.max(scale, Math.abs(cv[c]!));
        if (scale > 1e6) continue;
        for (const t of TETS) {
          const inside = t.filter((c) => cv[c]! > 0);
          const outside = t.filter((c) => !(cv[c]! > 0));
          if (inside.length === 0 || inside.length === 4) continue;
          if (inside.length === 1 || inside.length === 3) {
            const [a, rest] = inside.length === 1 ? [inside[0]!, outside] : [outside[0]!, inside];
            vert(a, rest[0]!);
            vert(a, rest[1]!);
            vert(a, rest[2]!);
          } else {
            const [a, b] = inside as [number, number];
            const [c, d] = outside as [number, number];
            vert(a, c);
            vert(a, d);
            vert(b, d);
            vert(a, c);
            vert(b, d);
            vert(b, c);
          }
        }
      }
    }
    lo = hi;
    yield (k + 1) / n;
  }
  const P = Float32Array.from(pos);
  const idx = new Uint32Array(P.length / 3);
  for (let i = 0; i < idx.length; i++) idx[i] = i;
  return P.length ? { pos: P, nrm: Float32Array.from(nrm), idx } : EMPTY;
}

/** Runs marching cubes to completion. */
export function marchingCubes(F: FloatFn, env: FloatEnv, box: Box3, n = 40): Mesh3 {
  const g = marchingCubesSteps(F, env, box, n);
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
}
