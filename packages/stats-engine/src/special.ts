/**
 * Special functions in plain IEEE doubles. Each targets ~1e-14 relative accuracy over the ranges a
 * calculator user can reach; the inverses are refined against the forward functions.
 */

const EPS = 1e-16;
const FPMIN = 1e-300;
const LN_SQRT_2PI = 0.9189385332046728;
const SQRT2 = Math.SQRT2;

// ---------- gamma ----------
// Lanczos approximation, g = 7, n = 9 (Godfrey's coefficients).
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

export function lnGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lnGamma(1 - x);
  x -= 1;
  let a = LANCZOS[0]!;
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i]! / (x + i);
  return LN_SQRT_2PI + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

const FACT: number[] = [1];
for (let i = 1; i <= 170; i++) FACT[i] = FACT[i - 1]! * i;

export function gamma(x: number): number {
  if (Number.isInteger(x)) {
    if (x <= 0) return NaN;
    return x <= 171 ? FACT[x - 1]! : Infinity;
  }
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
  if (x > 171.6) return Infinity;
  x -= 1;
  let a = LANCZOS[0]!;
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i]! / (x + i);
  return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
}

/** ln C(n, k). */
export function lnChoose(n: number, k: number): number {
  return lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1);
}

/** C(n, k), exact while it fits in 2^53. */
export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= k; i++) {
    r = (r * (n - k + i)) / i;
    if (r > 9e15) return Math.exp(lnChoose(n, k));
  }
  return Math.round(r);
}

// ---------- regularized incomplete gamma ----------
function gammaSeries(a: number, x: number): number {
  let ap = a;
  let del = 1 / a;
  let sum = del;
  for (let n = 0; n < 10000; n++) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * EPS) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
}

function gammaContinuedFraction(a: number, x: number): number {
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 10000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

/** Lower regularized incomplete gamma P(a, x). */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x === Infinity) return 1;
  return x < a + 1 ? gammaSeries(a, x) : 1 - gammaContinuedFraction(a, x);
}

/** Upper regularized incomplete gamma Q(a, x) = 1 − P(a, x), computed without cancellation. */
export function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x === Infinity) return 0;
  return x < a + 1 ? 1 - gammaSeries(a, x) : gammaContinuedFraction(a, x);
}

// ---------- error function ----------
export function erf(x: number): number {
  if (x === 0) return 0;
  const v = gammaP(0.5, x * x);
  return x < 0 ? -v : v;
}

export function erfc(x: number): number {
  if (x < 0) return 2 - erfc(-x);
  if (x === 0) return 1;
  return gammaQ(0.5, x * x);
}

// ---------- normal ----------
export function normCdf(z: number): number {
  return 0.5 * erfc(-z / SQRT2);
}

/** Upper tail 1 − Φ(z) without cancellation. */
export function normSf(z: number): number {
  return 0.5 * erfc(z / SQRT2);
}

export function normPdf(z: number): number {
  return Math.exp(-0.5 * z * z - LN_SQRT_2PI);
}

// Acklam's rational approximation (relative error 1.15e-9), then one Halley step.
const AA = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
const BB = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
const CC = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
const DD = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

export function normInv(p: number): number {
  if (!(p > 0 && p < 1)) {
    if (p === 0) return -Infinity;
    if (p === 1) return Infinity;
    return NaN;
  }
  const [a0, a1, a2, a3, a4, a5] = AA as [number, number, number, number, number, number];
  const [b0, b1, b2, b3, b4] = BB as [number, number, number, number, number];
  const [c0, c1, c2, c3, c4, c5] = CC as [number, number, number, number, number, number];
  const [d0, d1, d2, d3] = DD as [number, number, number, number];
  const pLow = 0.02425;
  let x: number;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c0 * q + c1) * q + c2) * q + c3) * q + c4) * q + c5) / ((((d0 * q + d1) * q + d2) * q + d3) * q + 1);
  } else if (p <= 1 - pLow) {
    const q = p - 0.5;
    const r = q * q;
    x = ((((((a0 * r + a1) * r + a2) * r + a3) * r + a4) * r + a5) * q) / (((((b0 * r + b1) * r + b2) * r + b3) * r + b4) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log1p(-p));
    x = -(((((c0 * q + c1) * q + c2) * q + c3) * q + c4) * q + c5) / ((((d0 * q + d1) * q + d2) * q + d3) * q + 1);
  }
  // Halley refinement; work in whichever tail keeps the residual accurate.
  const e = p < 0.5 ? normCdf(x) - p : (1 - p) - normSf(x) ;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  x = x - u / (1 + (x * u) / 2);
  return x;
}

// ---------- regularized incomplete beta ----------
function betaContinuedFraction(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 10000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/**
 * Regularized incomplete beta I_x(a, b) and its complement, both accurate in their small tails.
 * Pass y = 1 − x computed directly by the caller when x is close to 1.
 */
export function betaIncBoth(x: number, a: number, b: number, y: number = 1 - x): [number, number] {
  if (x <= 0) return [0, 1];
  if (y <= 0) return [1, 0];
  const lnFront = lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(y);
  if (x < (a + 1) / (a + b + 2)) {
    const v = (Math.exp(lnFront) * betaContinuedFraction(a, b, x)) / a;
    return [v, 1 - v];
  }
  const w = (Math.exp(lnFront) * betaContinuedFraction(b, a, y)) / b;
  return [1 - w, w];
}

export function betaInc(x: number, a: number, b: number): number {
  return betaIncBoth(x, a, b)[0];
}

// ---------- Student t ----------
/** One tail: P(T > |t|). */
export function tTail(t: number, df: number): number {
  if (!isFinite(t)) return 0;
  const t2 = t * t;
  const x = df / (df + t2);
  const y = t2 / (df + t2);
  return 0.5 * betaIncBoth(x, df / 2, 0.5, y)[0];
}

export function tCdf(t: number, df: number): number {
  if (df === Infinity) return normCdf(t);
  const tail = tTail(t, df);
  return t > 0 ? 1 - tail : tail;
}

export function tPdf(t: number, df: number): number {
  return Math.exp(lnGamma((df + 1) / 2) - lnGamma(df / 2) - 0.5 * Math.log(df * Math.PI) - ((df + 1) / 2) * Math.log1p((t * t) / df));
}

/** Inverse t CDF, by safeguarded Newton inside an expanding bracket on the upper tail. */
export function tInv(p: number, df: number): number {
  if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN;
  if (p === 0.5) return 0;
  if (df === Infinity) return normInv(p);
  const q = Math.min(p, 1 - p); // target upper-tail area
  let lo = 0;
  let hi = 1;
  while (tTail(hi, df) > q) {
    lo = hi;
    hi *= 2;
    if (hi > 1e300) break;
  }
  // start from the normal quantile when it lies inside the bracket
  let t = -normInv(q);
  if (!(t > lo && t < hi)) t = (lo + hi) / 2;
  for (let i = 0; i < 200; i++) {
    const f = tTail(t, df) - q; // decreasing in t
    if (f > 0) lo = t;
    else hi = t;
    const step = f / tPdf(t, df); // Newton for g(t) = q − tail(t): t ← t + f / pdf
    let next = t + step;
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    if (Math.abs(next - t) <= 1e-15 * Math.max(1, Math.abs(t)) || hi - lo <= 1e-15 * hi) {
      t = next;
      break;
    }
    t = next;
  }
  return p > 0.5 ? t : -t;
}

// ---------- chi-square ----------
export function chi2Cdf(x: number, df: number): number {
  return gammaP(df / 2, x / 2);
}

export function chi2Sf(x: number, df: number): number {
  return gammaQ(df / 2, x / 2);
}

/** Inverse chi-square CDF by bisection on the appropriate tail. */
export function chi2Inv(p: number, df: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return Infinity;
  const upper = p > 0.5;
  const target = upper ? 1 - p : p;
  const f = (x: number) => (upper ? chi2Sf(x, df) : chi2Cdf(x, df));
  let lo = 0;
  let hi = Math.max(1, df);
  while (upper ? f(hi) > target : f(hi) < target) {
    lo = hi;
    hi *= 2;
  }
  for (let i = 0; i < 200 && hi - lo > 1e-14 * hi; i++) {
    const mid = (lo + hi) / 2;
    const v = f(mid);
    if (upper ? v > target : v < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---------- discrete distributions ----------
export function binomPmf(k: number, n: number, p: number): number {
  if (k < 0 || k > n || !Number.isInteger(k)) return 0;
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  if (n <= 1000) {
    const v = choose(n, k) * Math.pow(p, k) * Math.pow(1 - p, n - k);
    if (isFinite(v) && v > 1e-280) return v;
  }
  return Math.exp(lnChoose(n, k) + k * Math.log(p) + (n - k) * Math.log1p(-p));
}

/** P(X ≤ k). */
export function binomCdf(k: number, n: number, p: number): number {
  k = Math.floor(k);
  if (k < 0) return 0;
  if (k >= n) return 1;
  if (n <= 1000) {
    let s = 0;
    for (let i = 0; i <= k; i++) s += binomPmf(i, n, p);
    return Math.min(1, s);
  }
  return betaIncBoth(1 - p, n - k, k + 1, p)[0];
}

/** P(X > k). */
export function binomSf(k: number, n: number, p: number): number {
  k = Math.floor(k);
  if (k < 0) return 1;
  if (k >= n) return 0;
  if (n <= 1000) {
    let s = 0;
    for (let i = k + 1; i <= n; i++) s += binomPmf(i, n, p);
    return Math.min(1, s);
  }
  return betaIncBoth(1 - p, n - k, k + 1, p)[1];
}

export function poissonPmf(k: number, lambda: number): number {
  if (k < 0 || !Number.isInteger(k)) return 0;
  if (lambda === 0) return k === 0 ? 1 : 0;
  return Math.exp(k * Math.log(lambda) - lambda - lnGamma(k + 1));
}

export function poissonCdf(k: number, lambda: number): number {
  k = Math.floor(k);
  if (k < 0) return 0;
  return gammaQ(k + 1, lambda);
}

export function poissonSf(k: number, lambda: number): number {
  k = Math.floor(k);
  if (k < 0) return 1;
  return gammaP(k + 1, lambda);
}
