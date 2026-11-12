/**
 * A small exact-number system for geometry: sums of terms c·√r·π^(p/2) with rational c (BigInt), square-free
 * integer r and integer p. It covers what school geometry produces: 25√3/4, 500π/3, 125/(4π), (√6 + √2)/4,
 * √(50/π). Anything outside it (cube roots, sin 40°) drops to a plain float; every value always carries a float.
 */

export interface Q {
  n: bigint;
  d: bigint;
}
export interface Term {
  c: Q;
  r: bigint;
  p: number;
}
export type Ex = Term[];

const MAX_DIGITS = 40;
const big = (q: Q) => q.n.toString().length > MAX_DIGITS || q.d.toString().length > MAX_DIGITS;

function gcd(a: bigint, b: bigint): bigint {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b) [a, b] = [b, a % b];
  return a;
}

export function q(n: bigint | number, d: bigint | number = 1n): Q {
  let N = BigInt(n);
  let Dd = BigInt(d);
  if (Dd === 0n) throw new RangeError('zero denominator');
  if (Dd < 0n) {
    N = -N;
    Dd = -Dd;
  }
  const g = gcd(N, Dd) || 1n;
  return { n: N / g, d: Dd / g };
}
const qadd = (a: Q, b: Q) => q(a.n * b.d + b.n * a.d, a.d * b.d);
const qmul = (a: Q, b: Q) => q(a.n * b.n, a.d * b.d);
const qnum = (a: Q) => Number(a.n) / Number(a.d);

/** Decimal text ("2.5", "1,200", "3e2") → exact rational, or null. */
export function parseRational(s: string): Q | null {
  const m = /^([-+]?)(\d*)(?:\.(\d*))?(?:e([-+]?\d+))?$/i.exec(s.replace(/,/g, ''));
  if (!m || (!m[2] && !m[3])) return null;
  const frac = m[3] ?? '';
  let n = BigInt((m[2] || '0') + frac);
  let d = 10n ** BigInt(frac.length);
  const e = Number(m[4] ?? 0);
  if (Math.abs(e) > 30) return null;
  if (e > 0) n *= 10n ** BigInt(e);
  else if (e < 0) d *= 10n ** BigInt(-e);
  return q(m[1] === '-' ? -n : n, d);
}

/** n = s²·k with k square-free (trial division; null for huge radicands). */
function splitSquare(n: bigint): [bigint, bigint] | null {
  if (n <= 0n) return n === 0n ? [0n, 1n] : null;
  if (n > 10n ** 14n) return null;
  let k = n;
  let s = 1n;
  for (let f = 2n; f * f <= k; f++) {
    while (k % (f * f) === 0n) {
      k /= f * f;
      s *= f;
    }
    if (f > 100000n) return null;
  }
  return [s, k];
}

function norm(ts: Term[]): Ex {
  const out: Term[] = [];
  for (const t of ts) {
    if (t.c.n === 0n) continue;
    const same = out.find((o) => o.r === t.r && o.p === t.p);
    if (same) same.c = qadd(same.c, t.c);
    else out.push({ ...t });
  }
  return out.filter((t) => t.c.n !== 0n).sort((a, b) => a.p - b.p || Number(a.r - b.r));
}

const ok = (e: Ex | null): Ex | null => (e && e.every((t) => !big(t.c)) && e.length <= 6 ? e : null);

export const ex = {
  rat: (n: bigint | number, d: bigint | number = 1n): Ex => norm([{ c: q(n, d), r: 1n, p: 0 }]),
  fromQ: (c: Q): Ex => norm([{ c, r: 1n, p: 0 }]),
  pi: (): Ex => [{ c: q(1), r: 1n, p: 2 }],
  sqrtInt(n: number): Ex | null {
    return ex.sqrt(ex.rat(n));
  },
  add(a: Ex | null, b: Ex | null): Ex | null {
    return a && b ? ok(norm([...a, ...b])) : null;
  },
  neg(a: Ex | null): Ex | null {
    return a ? a.map((t) => ({ ...t, c: q(-t.c.n, t.c.d) })) : null;
  },
  mul(a: Ex | null, b: Ex | null): Ex | null {
    if (!a || !b) return null;
    const out: Term[] = [];
    for (const x of a)
      for (const y of b) {
        const sp = splitSquare(x.r * y.r);
        if (!sp) return null;
        out.push({ c: qmul(qmul(x.c, y.c), q(sp[0])), r: sp[1], p: x.p + y.p });
      }
    return ok(norm(out));
  },
  inv(a: Ex | null): Ex | null {
    if (!a || a.length === 0) return null;
    if (a.length === 1) {
      const t = a[0]!;
      // 1/(c√r π^k) = √r / (c r) · π^-k
      return ok([{ c: q(t.c.d, t.c.n * t.r), r: t.r, p: -t.p }]);
    }
    if (a.length === 2 && a[0]!.p === a[1]!.p) {
      // (t1 + t2)⁻¹ = (t1 − t2)/(t1² − t2²); t² is a single rational·π^p term.
      const [t1, t2] = [[a[0]!], [a[1]!]];
      const den = ex.add(ex.mul(t1, t1), ex.neg(ex.mul(t2, t2)));
      if (!den || den.length !== 1) return null;
      return ex.mul(ex.add(t1, ex.neg(t2)), ex.inv(den));
    }
    return null;
  },
  div(a: Ex | null, b: Ex | null): Ex | null {
    return ex.mul(a, ex.inv(b));
  },
  sqrt(a: Ex | null): Ex | null {
    if (!a) return null;
    if (a.length === 0) return [];
    if (a.length !== 1) return null;
    const t = a[0]!;
    if (t.r !== 1n || t.c.n < 0n || t.p % 2 !== 0) return null;
    const sp = splitSquare(t.c.n * t.c.d);
    if (!sp) return null;
    return ok([{ c: q(sp[0], t.c.d), r: sp[1], p: t.p / 2 }]);
  },
  pow(a: Ex | null, k: number): Ex | null {
    if (!a || !Number.isInteger(k)) return null;
    if (k < 0) return ex.inv(ex.pow(a, -k));
    let r: Ex | null = ex.rat(1);
    for (let i = 0; i < k; i++) r = ex.mul(r, a);
    return r;
  },
  num(a: Ex): number {
    let s = 0;
    for (const t of a) s += qnum(t.c) * Math.sqrt(Number(t.r)) * Math.PI ** (t.p / 2);
    return s;
  },
  isRational: (a: Ex) => a.every((t) => t.r === 1n && t.p === 0),
  rational(a: Ex): Q | null {
    if (a.length === 0) return q(0);
    return a.length === 1 && a[0]!.r === 1n && a[0]!.p === 0 ? a[0]!.c : null;
  },
};

// ---------- display ----------

function piText(k: number): string {
  return k === 0 ? '' : k === 1 ? 'π' : k === 2 ? 'π²' : k === 3 ? 'π³' : `π^${k}`;
}

/** One term's |value| as "num" and "den" text pieces. */
function termText(t: Term, absNum: bigint, den: bigint): string {
  let numer = '';
  let denom = den === 1n ? '' : den.toString();
  const half = t.p % 2 !== 0;
  const whole = Math.floor(t.p / 2); // π^whole outside the root, √π inside when p is odd
  const rad = t.r > 1n ? t.r.toString() : '';
  let root = '';
  if (half) root = rad ? `√(${rad}π)` : '√π';
  else if (rad) root = `√${rad}`;
  const coef = absNum === 1n && (root || whole > 0) ? '' : absNum.toString();
  numer = coef + (whole > 0 ? piText(whole) : '') + root;
  if (whole < 0) denom = denom + piText(-whole);
  if (!numer) numer = '1';
  if (!denom) return numer;
  return `${numer}/${/\d.*π|π.*\d|π\S/.test(denom) || (denom.length > 1 && /\D/.test(denom)) ? `(${denom})` : denom}`;
}

function lcm(a: bigint, b: bigint): bigint {
  return (a / gcd(a, b)) * b;
}

/** "25√3/4", "500π/3", "(√6 + √2)/4", "125/(4π)". */
export function exText(a: Ex): string {
  if (a.length === 0) return '0';
  // Odd negative π powers read better folded: c·√r·π^(-1/2) = c·√(r/π)
  const ts = [...a].sort((x, y) => (x.r === 1n ? -1 : 0) - (y.r === 1n ? -1 : 0) || y.p - x.p);
  if (ts.length === 1) {
    const t = ts[0]!;
    if (t.p < 0 && t.p % 2 !== 0) {
      // c·√r / √π^(…): write as c·√(r/π) / π^m
      const m = (-t.p - 1) / 2;
      const absN = t.c.n < 0n ? -t.c.n : t.c.n;
      const inner = `√(${t.r > 1n ? t.r : 1}/π)`;
      const numer = (absN === 1n ? '' : absN.toString()) + inner;
      const den = (t.c.d === 1n ? '' : t.c.d.toString()) + piText(m);
      return (t.c.n < 0n ? '−' : '') + (den ? `${numer}/${den.length > 1 && /π/.test(den) ? `(${den})` : den}` : numer);
    }
    return (t.c.n < 0n ? '−' : '') + termText(t, t.c.n < 0n ? -t.c.n : t.c.n, t.c.d);
  }
  let L = 1n;
  for (const t of ts) L = lcm(L, t.c.d);
  const parts = ts.map((t, i) => {
    const n = (t.c.n * L) / t.c.d;
    const absN = n < 0n ? -n : n;
    const s = termText({ ...t, p: t.p < 0 ? t.p : t.p }, absN, 1n);
    return (i === 0 ? (n < 0n ? '−' : '') : n < 0n ? ' − ' : ' + ') + s;
  });
  const body = parts.join('');
  return L === 1n ? body : `(${body})/${L}`;
}

// ---------- values: a float plus an optional exact form ----------

export class V {
  constructor(
    readonly x: number,
    readonly e: Ex | null = null,
  ) {}
  static rat(n: number, d = 1): V {
    return new V(n / d, Number.isInteger(n) && Number.isInteger(d) ? ex.rat(n, d) : null);
  }
  static of(x: number): V {
    return new V(x, null);
  }
  /** A float that is exactly a short decimal (inputs like 2.5) keeps an exact rational. */
  static dec(text: string): V | null {
    const r = parseRational(text);
    return r ? new V(qnum(r), ex.fromQ(r)) : null;
  }
  static fromEx(e: Ex): V {
    return new V(ex.num(e), e);
  }
  static readonly PI = new V(Math.PI, ex.pi());
  get exact(): boolean {
    return this.e !== null;
  }
  add(o: V): V {
    return new V(this.x + o.x, ex.add(this.e, o.e));
  }
  sub(o: V): V {
    return new V(this.x - o.x, ex.add(this.e, ex.neg(o.e)));
  }
  mul(o: V | number): V {
    const b = typeof o === 'number' ? V.rat(o) : o;
    return new V(this.x * b.x, ex.mul(this.e, b.e));
  }
  div(o: V | number): V {
    const b = typeof o === 'number' ? V.rat(o) : o;
    return new V(this.x / b.x, b.x === 0 ? null : ex.div(this.e, b.e));
  }
  neg(): V {
    return new V(-this.x, ex.neg(this.e));
  }
  sqrt(): V {
    return new V(Math.sqrt(this.x), this.x >= 0 ? ex.sqrt(this.e) : null);
  }
  pow(k: number): V {
    if (Number.isInteger(k)) return new V(this.x ** k, ex.pow(this.e, k));
    if (k === 0.5) return this.sqrt();
    if (k === -0.5) return V.rat(1).div(this.sqrt());
    // Cube roots of exact rationals that are perfect cubes stay exact.
    const x = this.x ** k;
    if (this.e && ex.isRational(this.e) && Number.isInteger(1 / k)) {
      const r = Math.round(x * 1e6) / 1e6;
      const back = V.dec(String(r));
      if (back && back.e && Math.abs(r ** (1 / k) - this.x) < 1e-12 * Math.max(1, Math.abs(this.x))) {
        const chk = ex.pow(back.e, Math.round(1 / k));
        if (chk && this.e && ex.add(chk, ex.neg(this.e))?.length === 0) return back;
      }
    }
    return new V(x, null);
  }
  /** Float only (drops the exact form). */
  float(): V {
    return new V(this.x, null);
  }
}

// ---------- trigonometry in degrees, exact at the special angles ----------

const S6 = (): Ex => ex.sqrtInt(6)!;
const S2 = (): Ex => ex.sqrtInt(2)!;
const S3 = (): Ex => ex.sqrtInt(3)!;
const S5 = (): Ex => ex.sqrtInt(5)!;
const SIN_EXACT: Record<number, () => Ex | null> = {
  0: () => ex.rat(0),
  15: () => ex.mul(ex.add(S6(), ex.neg(S2())), ex.rat(1, 4)),
  18: () => ex.mul(ex.add(S5(), ex.rat(-1)), ex.rat(1, 4)),
  30: () => ex.rat(1, 2),
  45: () => ex.mul(S2(), ex.rat(1, 2)),
  54: () => ex.mul(ex.add(S5(), ex.rat(1)), ex.rat(1, 4)),
  60: () => ex.mul(S3(), ex.rat(1, 2)),
  75: () => ex.mul(ex.add(S6(), S2()), ex.rat(1, 4)),
  90: () => ex.rat(1),
};

function degOf(a: V): number | null {
  if (!a.e) return null;
  const r = ex.rational(a.e);
  if (!r || r.d !== 1n) return null;
  return Number(r.n);
}

export function sinDeg(a: V): V {
  const x = Math.sin((a.x * Math.PI) / 180);
  let d = degOf(a);
  if (d !== null) {
    d = ((d % 360) + 360) % 360;
    let sign = 1;
    if (d > 180) {
      d -= 180;
      sign = -1;
    }
    if (d > 90) d = 180 - d;
    const f = SIN_EXACT[d];
    const e = f?.();
    if (e) return new V(Math.abs(x) < 1e-15 ? 0 : x, sign < 0 ? ex.neg(e) : e);
  }
  return new V(Math.abs(x) < 1e-15 ? 0 : x, null);
}
export function cosDeg(a: V): V {
  if (degOf(a) !== null) return sinDeg(V.rat(90).sub(a));
  const x = Math.cos((a.x * Math.PI) / 180);
  return new V(Math.abs(x) < 1e-15 ? 0 : x, null);
}
export function tanDeg(a: V): V {
  return sinDeg(a).div(cosDeg(a));
}

/** Angle in degrees from a float, snapped to a whole or half degree when within 1e-9 (so 60° stays exact). */
export function snapDeg(x: number): V {
  for (const den of [1, 2, 4]) {
    const r = Math.round(x * den);
    if (Math.abs(x * den - r) < 1e-9 * Math.max(1, Math.abs(x))) return V.rat(r, den);
  }
  return V.of(x);
}
const R2D = 180 / Math.PI;
export const asinDeg = (v: V) => snapDeg(Math.asin(Math.max(-1, Math.min(1, v.x))) * R2D);
export const acosDeg = (v: V) => snapDeg(Math.acos(Math.max(-1, Math.min(1, v.x))) * R2D);
export const atanDeg = (v: V) => snapDeg(Math.atan(v.x) * R2D);
export const atan2Deg = (y: number, x: number) => snapDeg(Math.atan2(y, x) * R2D);

/**
 * Recognises a float as an exact form when it is (to 1e-11) a small rational, q·√n, or q·π. Used after
 * numerical solving so "rectangle area 12 perimeter 14" reports 4 and 3, not 3.9999999999.
 */
export function snap(x: number): V {
  if (!Number.isFinite(x)) return V.of(x);
  const tol = 1e-9 * Math.max(1, Math.abs(x));
  const tryRat = (y: number, maxDen: number): Q | null => {
    for (let d = 1; d <= maxDen; d++) {
      const n = Math.round(y * d);
      if (Math.abs(y * d - n) < 1e-9 * Math.max(1, Math.abs(y * d)) && Math.abs(n) < 1e12) return q(n, d);
    }
    return null;
  };
  const r = tryRat(x, 360);
  if (r) return V.fromEx(ex.fromQ(r));
  // q·√n: x² rational
  const r2 = tryRat(x * x, 360);
  if (r2 && x > 0) {
    const e = ex.sqrt(ex.fromQ(r2));
    if (e && Math.abs(ex.num(e) - x) < tol) return V.fromEx(e);
  }
  const rp = tryRat(x / Math.PI, 120);
  if (rp) return V.fromEx(ex.mul(ex.fromQ(rp), ex.pi())!);
  return V.of(x);
}
