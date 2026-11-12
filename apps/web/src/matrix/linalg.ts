/**
 * Linear algebra for the Matrix mode, with no dependencies: exact fractions (BigInt) wherever the entries are
 * rational, plain floats otherwise (√2, π, and the QR / numeric eigenvalue paths). Instant and offline, so the
 * mode never waits on the CAS.
 */

const babs = (x: bigint) => (x < 0n ? -x : x);
function bgcd(a: bigint, b: bigint): bigint {
  a = babs(a);
  b = babs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

/** An exact fraction n/d, always reduced, d > 0. */
export class Q {
  readonly n: bigint;
  readonly d: bigint;
  constructor(n: bigint, d: bigint = 1n) {
    if (d === 0n) throw new MatrixError('Division by zero');
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = bgcd(n, d) || 1n;
    this.n = n / g;
    this.d = d / g;
  }
  static int(k: number | bigint): Q {
    return new Q(BigInt(k));
  }
  toNumber(): number {
    // Big numerators and denominators: divide in steps so neither overflows to Infinity alone.
    const n = Number(this.n);
    const d = Number(this.d);
    if (Number.isFinite(n) && Number.isFinite(d)) return n / d;
    const shift = BigInt(Math.max(this.n.toString().length, this.d.toString().length) - 300);
    const s = 10n ** (shift > 0n ? shift : 0n);
    return Number(this.n / s) / Number(this.d / s);
  }
}

export class MatrixError extends Error {}

/** An entry or a scalar: exact when it can be. */
export type Num = Q | number;
export type Matrix = Num[][];

export const ZERO = Q.int(0);
export const ONE = Q.int(1);
const EPS = 1e-10;

export const isQ = (a: Num): a is Q => a instanceof Q;
export const toF = (a: Num): number => (isQ(a) ? a.toNumber() : a);

export function add(a: Num, b: Num): Num {
  return isQ(a) && isQ(b) ? new Q(a.n * b.d + b.n * a.d, a.d * b.d) : toF(a) + toF(b);
}
export function sub(a: Num, b: Num): Num {
  return isQ(a) && isQ(b) ? new Q(a.n * b.d - b.n * a.d, a.d * b.d) : toF(a) - toF(b);
}
export function mul(a: Num, b: Num): Num {
  return isQ(a) && isQ(b) ? new Q(a.n * b.n, a.d * b.d) : toF(a) * toF(b);
}
export function div(a: Num, b: Num): Num {
  if (isZero(b)) throw new MatrixError('Division by zero');
  return isQ(a) && isQ(b) ? new Q(a.n * b.d, a.d * b.n) : toF(a) / toF(b);
}
export const neg = (a: Num): Num => (isQ(a) ? new Q(-a.n, a.d) : -a);
export const isZero = (a: Num): boolean => (isQ(a) ? a.n === 0n : Math.abs(a) < EPS);
export const isOne = (a: Num): boolean => (isQ(a) ? a.n === 1n && a.d === 1n : Math.abs(a - 1) < EPS);
const absF = (a: Num) => Math.abs(toF(a));

/** Integer power of a scalar (exact for fractions). */
export function powNum(a: Num, k: number): Num {
  if (!Number.isInteger(k)) return Math.pow(toF(a), k);
  if (k < 0) return div(ONE, powNum(a, -k));
  if (isQ(a)) return new Q(a.n ** BigInt(k), a.d ** BigInt(k));
  return Math.pow(a, k);
}

/** "3", "-2.5", "1/3", "2e3", "-0.125" → an exact fraction; anything else → null (the caller may evaluate it). */
export function parseExact(text: string): Q | null {
  const t = text.trim().replace(/[−–]/g, '-');
  let m = /^([+-]?\d+)\s*\/\s*([+-]?\d+)$/.exec(t);
  if (m) return BigInt(m[2]!) === 0n ? null : new Q(BigInt(m[1]!), BigInt(m[2]!));
  m = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(t);
  if (!m || (!m[2] && !m[3])) return null;
  const frac = m[3] ?? '';
  let n = BigInt((m[2] || '0') + frac);
  let d = 10n ** BigInt(frac.length);
  const e = Number(m[4] ?? 0);
  if (Math.abs(e) > 400) return null;
  if (e > 0) n *= 10n ** BigInt(e);
  else if (e < 0) d *= 10n ** BigInt(-e);
  return new Q(m[1] === '-' ? -n : n, d);
}

/** A float that is really a short fraction (0.5, -0.75) comes back exact; others stay floats. */
export function tidy(x: number): Num {
  if (!Number.isFinite(x)) return x;
  if (Math.abs(x - Math.round(x)) < 1e-12) return Q.int(Math.round(x));
  return x;
}

// ---------- formatting ----------
export type NumStyle = 'fraction' | 'decimal';

function decimalString(x: number, digits = 6): string {
  if (Math.abs(x) < 1e-12) return '0';
  const s = Number(x.toPrecision(digits));
  const abs = Math.abs(s);
  if (abs !== 0 && (abs >= 1e9 || abs < 1e-6)) return s.toExponential(digits - 1).replace(/\.?0+e/, 'e');
  return String(s);
}

export function fmt(a: Num, style: NumStyle = 'fraction'): string {
  let s: string;
  if (isQ(a)) {
    if (a.d === 1n) s = a.n.toString();
    else if (style === 'decimal') s = decimalString(a.toNumber(), 10);
    else s = `${a.n}/${a.d}`;
  } else s = decimalString(a);
  return s.replace(/^-/, '−');
}

// ---------- shapes ----------
export const rows = (m: Matrix) => m.length;
export const cols = (m: Matrix) => m[0]?.length ?? 0;
const clone = (m: Matrix): Matrix => m.map((r) => [...r]);
export const size = (m: Matrix) => `${rows(m)}×${cols(m)}`;

export function identity(n: number): Matrix {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? ONE : ZERO)));
}

function square(m: Matrix, what: string): number {
  if (rows(m) !== cols(m)) throw new MatrixError(`${what} needs a square matrix (this one is ${size(m)})`);
  return rows(m);
}

// ---------- arithmetic ----------
export function addM(a: Matrix, b: Matrix, minus = false): Matrix {
  if (rows(a) !== rows(b) || cols(a) !== cols(b)) throw new MatrixError(`Can't ${minus ? 'subtract' : 'add'} a ${size(b)} matrix ${minus ? 'from' : 'to'} a ${size(a)} one`);
  return a.map((r, i) => r.map((x, j) => (minus ? sub(x, b[i]![j]!) : add(x, b[i]![j]!))));
}

export function mulM(a: Matrix, b: Matrix): Matrix {
  if (cols(a) !== rows(b)) throw new MatrixError(`Can't multiply ${size(a)} by ${size(b)}: the columns of the first must match the rows of the second`);
  return a.map((r) => b[0]!.map((_, j) => r.reduce<Num>((s, x, k) => add(s, mul(x, b[k]![j]!)), ZERO)));
}

export const scale = (m: Matrix, k: Num): Matrix => m.map((r) => r.map((x) => mul(x, k)));
export const transpose = (m: Matrix): Matrix => (m[0] ?? []).map((_, j) => m.map((r) => r[j]!));

export function trace(m: Matrix): Num {
  const n = square(m, 'Trace');
  let s: Num = ZERO;
  for (let i = 0; i < n; i++) s = add(s, m[i]![i]!);
  return s;
}

/** Row-echelon elimination; floats pivot on the largest entry, fractions on the first non-zero. */
function pivotRow(m: Matrix, col: number, from: number): number {
  let best = -1;
  for (let r = from; r < m.length; r++) {
    const x = m[r]![col]!;
    if (isZero(x)) continue;
    if (isQ(x)) return best === -1 ? r : best;
    if (best === -1 || absF(x) > absF(m[best]![col]!)) best = r;
  }
  return best;
}

export function det(m: Matrix): Num {
  const n = square(m, 'The determinant');
  const a = clone(m);
  let d: Num = ONE;
  for (let c = 0; c < n; c++) {
    const p = pivotRow(a, c, c);
    if (p === -1) return ZERO;
    if (p !== c) {
      [a[p], a[c]] = [a[c]!, a[p]!];
      d = neg(d);
    }
    const pv = a[c]![c]!;
    d = mul(d, pv);
    for (let r = c + 1; r < n; r++) {
      const f = div(a[r]![c]!, pv);
      if (isZero(f)) continue;
      for (let k = c; k < n; k++) a[r]![k] = sub(a[r]![k]!, mul(f, a[c]![k]!));
    }
  }
  return isQ(d) ? d : tidy(d);
}

export function rref(m: Matrix): { matrix: Matrix; pivots: number[] } {
  const a = clone(m);
  const pivots: number[] = [];
  let r = 0;
  for (let c = 0; c < cols(a) && r < rows(a); c++) {
    const p = pivotRow(a, c, r);
    if (p === -1) continue;
    [a[p], a[r]] = [a[r]!, a[p]!];
    const pv = a[r]![c]!;
    a[r] = a[r]!.map((x) => div(x, pv));
    for (let i = 0; i < rows(a); i++) {
      if (i === r) continue;
      const f = a[i]![c]!;
      if (isZero(f)) continue;
      a[i] = a[i]!.map((x, k) => sub(x, mul(f, a[r]![k]!)));
    }
    pivots.push(c);
    r++;
  }
  // Floats that cancelled to ~0 or ~1 read as exact.
  return { matrix: a.map((row) => row.map((x) => (isQ(x) ? x : isZero(x) ? ZERO : tidy(x)))), pivots };
}

export const rank = (m: Matrix): number => rref(m).pivots.length;

export function inverse(m: Matrix): Matrix {
  const n = square(m, 'The inverse');
  const aug = m.map((r, i) => [...r, ...identity(n)[i]!]);
  const { matrix, pivots } = rref(aug);
  if (pivots.length < n || pivots[n - 1] !== n - 1) throw new MatrixError('This matrix has no inverse (its determinant is 0)');
  return matrix.map((r) => r.slice(n));
}

export function power(m: Matrix, k: number): Matrix {
  const n = square(m, 'A power');
  if (!Number.isInteger(k)) throw new MatrixError('Matrix powers need a whole number');
  if (Math.abs(k) > 10_000) throw new MatrixError('That power is too large');
  let base = k < 0 ? inverse(m) : m;
  let e = Math.abs(k);
  let out = identity(n);
  while (e > 0) {
    if (e & 1) out = mulM(out, base);
    base = mulM(base, base);
    e >>= 1;
  }
  return out;
}

/** A basis of the null space, one column vector per free variable (empty when only the zero vector). */
export function nullspace(m: Matrix): Matrix[] {
  const { matrix, pivots } = rref(m);
  const n = cols(m);
  const free = [...Array(n).keys()].filter((c) => !pivots.includes(c));
  return free.map((f) => {
    const v: Num[] = Array.from({ length: n }, (_, c) => (c === f ? ONE : ZERO));
    pivots.forEach((p, r) => (v[p] = neg(matrix[r]![f]!)));
    return v.map((x) => [x]);
  });
}

/** PA = LU with row pivoting (Doolittle). */
export function lu(m: Matrix): { P: Matrix; L: Matrix; U: Matrix } {
  const n = square(m, 'LU');
  const U = clone(m);
  const L = identity(n);
  const perm = [...Array(n).keys()];
  for (let c = 0; c < n; c++) {
    const p = pivotRow(U, c, c);
    if (p === -1) continue;
    if (p !== c) {
      [U[p], U[c]] = [U[c]!, U[p]!];
      [perm[p], perm[c]] = [perm[c]!, perm[p]!];
      for (let k = 0; k < c; k++) [L[p]![k], L[c]![k]] = [L[c]![k]!, L[p]![k]!];
    }
    for (let r = c + 1; r < n; r++) {
      const f = div(U[r]![c]!, U[c]![c]!);
      L[r]![c] = f;
      for (let k = c; k < n; k++) U[r]![k] = sub(U[r]![k]!, mul(f, U[c]![k]!));
    }
  }
  const P = perm.map((pi) => identity(n)[pi]!);
  return { P, L, U };
}

/** A = QR (modified Gram–Schmidt, floats): Q has orthonormal columns, R is upper triangular. */
export function qr(m: Matrix): { Q: Matrix; R: Matrix } {
  const r = rows(m);
  const c = cols(m);
  if (r < c) throw new MatrixError('QR needs at least as many rows as columns');
  const A = m.map((row) => row.map(toF));
  const Qc: number[][] = [];
  const R: number[][] = Array.from({ length: c }, () => Array<number>(c).fill(0));
  for (let j = 0; j < c; j++) {
    const v = A.map((row) => row[j]!);
    for (let i = 0; i < Qc.length; i++) {
      const q = Qc[i]!;
      const d = q.reduce((s, x, k) => s + x * v[k]!, 0);
      R[i]![j] = d;
      for (let k = 0; k < r; k++) v[k]! -= d * q[k]!;
    }
    const norm = Math.hypot(...v);
    if (norm < EPS) throw new MatrixError('QR needs linearly independent columns');
    R[j]![j] = norm;
    Qc.push(v.map((x) => x / norm));
  }
  return { Q: transpose(Qc.map((col) => col.map(tidy))), R: R.map((row) => row.map(tidy)) };
}

// ---------- eigenvalues ----------
/** Characteristic polynomial det(λI − A) by Faddeev–LeVerrier: coefficients from λⁿ down to the constant. */
export function charpoly(m: Matrix): Num[] {
  const n = square(m, 'Eigenvalues');
  const c: Num[] = [ONE];
  let M = identity(n).map((r) => r.map(() => ZERO as Num));
  for (let k = 1; k <= n; k++) {
    // M_k = A·M_{k−1} + c_{k−1}·I ;  c_k = −tr(A·M_k)/k
    M = addM(mulM(m, M), scale(identity(n), c[k - 1]!));
    c.push(div(neg(trace(mulM(m, M))), Q.int(k)));
  }
  return c;
}

export interface Eigenvalue {
  /** Exact rational value when there is one. */
  exact?: Q;
  re: number;
  im: number;
  label: string;
  multiplicity: number;
}

function divisors(x: bigint): bigint[] {
  x = babs(x);
  if (x > 10n ** 12n) return [];
  const out: bigint[] = [];
  for (let i = 1n; i * i <= x; i++) {
    if (x % i) continue;
    out.push(i);
    if (i * i !== x) out.push(x / i);
  }
  return out;
}

function evalPoly(p: Num[], x: Num): Num {
  return p.reduce<Num>((s, c) => add(mul(s, x), c), ZERO);
}

/** Synthetic division by (λ − r). */
function deflate(p: Num[], r: Num): Num[] {
  const out: Num[] = [];
  let acc: Num = ZERO;
  for (let i = 0; i < p.length - 1; i++) {
    acc = add(mul(acc, r), p[i]!);
    out.push(acc);
  }
  return out;
}

function squareFree(x: bigint): [outside: bigint, inside: bigint] {
  let out = 1n;
  let inside = x;
  for (let f = 2n; f * f <= inside && f < 1_000_000n; f++) {
    while (inside % (f * f) === 0n) {
      inside /= f * f;
      out *= f;
    }
  }
  return [out, inside];
}

function complexLabel(re: number, im: number): string {
  const r = Math.abs(re) < 1e-10 ? '' : decimalString(re);
  const i = decimalString(Math.abs(im));
  return `${r}${r ? (im < 0 ? ' − ' : ' + ') : im < 0 ? '−' : ''}${i === '1' ? '' : i}i`;
}

/** Durand–Kerner on a monic float polynomial. */
function numericRoots(p: number[]): [number, number][] {
  const n = p.length - 1;
  const a = p.map((c) => c / p[0]!);
  let z: [number, number][] = Array.from({ length: n }, (_, k) => {
    const ang = (2 * Math.PI * k) / n + 0.4;
    const rad = 1 + Math.max(...a.slice(1).map(Math.abs));
    return [rad * Math.cos(ang), rad * Math.sin(ang)];
  });
  const cmul = (x: [number, number], y: [number, number]): [number, number] => [x[0] * y[0] - x[1] * y[1], x[0] * y[1] + x[1] * y[0]];
  const cdiv = (x: [number, number], y: [number, number]): [number, number] => {
    const d = y[0] * y[0] + y[1] * y[1] || 1e-300;
    return [(x[0] * y[0] + x[1] * y[1]) / d, (x[1] * y[0] - x[0] * y[1]) / d];
  };
  for (let it = 0; it < 500; it++) {
    let moved = 0;
    z = z.map((zi, i) => {
      let num: [number, number] = [1, 0];
      for (let k = 1; k <= n; k++) num = [num[0] * zi[0] - num[1] * zi[1] + a[k]!, num[0] * zi[1] + num[1] * zi[0]];
      let den: [number, number] = [1, 0];
      z.forEach((zj, j) => j !== i && (den = cmul(den, [zi[0] - zj[0], zi[1] - zj[1]])));
      const step = cdiv(num, den);
      moved = Math.max(moved, Math.hypot(...step));
      return [zi[0] - step[0], zi[1] - step[1]];
    });
    if (moved < 1e-14) break;
  }
  return z.map(([re, im]) => [Math.abs(re) < 1e-9 ? 0 : re, Math.abs(im) < 1e-9 ? 0 : im]);
}

export function eigenvalues(m: Matrix): Eigenvalue[] {
  let p = charpoly(m);
  const found: Eigenvalue[] = [];
  const push = (e: Omit<Eigenvalue, 'multiplicity'>) => {
    const same = found.find((f) => Math.abs(f.re - e.re) < 1e-7 && Math.abs(f.im - e.im) < 1e-7);
    if (same) same.multiplicity++;
    else found.push({ ...e, multiplicity: 1 });
  };
  // Exact rational roots (rational root theorem), then a quadratic in surds, then numeric.
  if (p.every(isQ)) {
    for (;;) {
      if (p.length <= 1) break;
      if (isZero(p[p.length - 1]!)) {
        push({ exact: ZERO, re: 0, im: 0, label: '0' });
        p = p.slice(0, -1);
        continue;
      }
      const qs = p as Q[];
      const l = qs.reduce((acc, c) => (acc * c.d) / bgcd(acc, c.d), 1n);
      const ints = qs.map((c) => (c.n * l) / c.d);
      const cands = divisors(ints[ints.length - 1]!).flatMap((num) => divisors(ints[0]!).flatMap((den) => [new Q(num, den), new Q(-num, den)]));
      const root = cands.find((r) => isZero(evalPoly(p, r)));
      if (!root) break;
      push({ exact: root, re: root.toNumber(), im: 0, label: fmt(root) });
      p = deflate(p, root);
    }
    if (p.length === 3) {
      const [a, b, c] = p as Q[];
      const disc = sub(mul(b!, b!), mul(Q.int(4), mul(a!, c!))) as Q;
      const alpha = div(neg(b!), mul(Q.int(2), a!)) as Q;
      const base = alpha.toNumber();
      if (disc.n > 0n) {
        const [out, inside] = squareFree(disc.n * disc.d);
        const beta = new Q(out * a!.d, disc.d * 2n * babs(a!.n));
        const coef = beta.n === 1n ? '' : beta.n.toString();
        const surd = `${coef}√${inside}${beta.d === 1n ? '' : `/${beta.d}`}`;
        const spread = beta.toNumber() * Math.sqrt(Number(inside));
        const head = alpha.n === 0n ? '' : `${fmt(alpha)} `;
        push({ re: base + spread, im: 0, label: `${head}${alpha.n === 0n ? '' : '+ '}${surd}` });
        push({ re: base - spread, im: 0, label: `${head}${alpha.n === 0n ? '−' : '− '}${surd}` });
      } else {
        const im = Math.sqrt(-disc.toNumber()) / Math.abs(2 * a!.toNumber());
        push({ re: base, im, label: complexLabel(base, im) });
        push({ re: base, im: -im, label: complexLabel(base, -im) });
      }
      p = [ONE];
    } else if (p.length === 2) {
      const r = div(neg(p[1]!), p[0]!) as Q;
      push({ exact: r, re: r.toNumber(), im: 0, label: fmt(r) });
      p = [ONE];
    }
  }
  if (p.length > 1) for (const [re, im] of numericRoots(p.map(toF))) push({ re, im, label: im === 0 ? decimalString(re) : complexLabel(re, im) });
  return found.sort((x, y) => y.re - x.re || y.im - x.im);
}

/** Eigenvectors for each real eigenvalue: exact for rational ones, numeric otherwise. Complex ones are skipped. */
export function eigenvectors(m: Matrix): { value: Eigenvalue; vectors: Matrix[] }[] {
  const n = rows(m);
  return eigenvalues(m)
    .filter((e) => e.im === 0)
    .map((value) => {
      const lam: Num = value.exact ?? value.re;
      const shifted = m.map((r, i) => r.map((x, j) => (i === j ? sub(x, lam) : x)));
      let vectors = nullspace(value.exact ? shifted : shifted.map((r) => r.map((x) => roundTiny(toF(x)))));
      if (!vectors.length && !value.exact) vectors = numericNull(shifted.map((r) => r.map(toF)), n);
      return { value, vectors: vectors.map(normaliseSign) };
    });
}

const roundTiny = (x: number) => (Math.abs(x) < 1e-9 ? 0 : x);

/** Inverse iteration fallback for a numeric eigenvalue whose shifted matrix isn't exactly singular in floats. */
function numericNull(a: number[][], n: number): Matrix[] {
  const shifted = a.map((r, i) => r.map((x, j) => (i === j ? x + 1e-10 : x)));
  let v = Array<number>(n).fill(1);
  for (let it = 0; it < 30; it++) {
    try {
      const inv = inverse(shifted);
      v = inv.map((r) => r.reduce<number>((s, x, k) => s + toF(x) * v[k]!, 0));
      const norm = Math.hypot(...v) || 1;
      v = v.map((x) => x / norm);
    } catch {
      break;
    }
  }
  return [v.map((x) => [tidy(x)])];
}

/** Scale a vector so its first non-zero entry is positive (and floats to length 1). */
function normaliseSign(v: Matrix): Matrix {
  const first = v.find((r) => !isZero(r[0]!));
  const flip = first && toF(first[0]!) < 0;
  const floats = v.some((r) => !isQ(r[0]!));
  const len = floats ? Math.hypot(...v.map((r) => toF(r[0]!))) || 1 : 1;
  return v.map((r) => {
    const x = flip ? neg(r[0]!) : r[0]!;
    return [floats ? tidy(toF(x) / len) : x];
  });
}
