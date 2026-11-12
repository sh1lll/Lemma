// Numerical methods: root finding, interpolation, differentiation, quadrature, ODE steppers, iterative linear
// solvers, the power method, IEEE-754 and conditioning. Every method shows its iterations or nodes.
import { answer, compile, fmt, numbers, param, parseMatrix, refuse, type Line, type Result } from './util';

const ROOT_CUT =
  /\s*(?:,\s*)?(?:\b(?:starting|start|beginning|from|with|using|initial|guess|x0|x_0|x₀|x1|x_1|p0|on|in|over|between|interval|tol\w*|eps\w*|to\s+\d+\s+(?:decimal|d\.?p|sig)|until|for\s+\d+\s+iter\w*|max)\b|\[|$)/i;

/** "x^3 - 2x - 5", "f(x) = cos x - x", "x^3 = 2x + 5" → function of x. */
function fnText(raw: string): string {
  let t = raw.replace(/^[\s:,]*(?:(?:to\s+)?(?:find\s+)?(?:the\s+)?(?:a\s+)?(?:root|zero)s?\s+(?:of\s+)?|on\s+|for\s+|of\s+|to\s+|solve\s+)*/i, '').trim();
  t = t.replace(/^(?:f|g)\s*\(\s*x\s*\)\s*=\s*/i, '').replace(/\s*=\s*0\s*$/, '').replace(/[,.;:]\s*$/, '').trim();
  const eq = t.split('=');
  if (eq.length === 2 && eq[0]!.trim() && eq[1]!.trim()) t = `(${eq[0]}) - (${eq[1]})`;
  return t;
}

function afterKeyword(input: string, kw: RegExp): string {
  const m = kw.exec(input);
  if (!m) return '';
  const rest = input.slice(m.index + m[0].length);
  const cut = ROOT_CUT.exec(rest.replace(/^\s*(?:for|of|on|to)\b/i, (s) => ' '.repeat(s.length)));
  return rest.slice(0, cut ? cut.index : rest.length);
}

/** Derivative by Richardson-extrapolated central differences (≈1e-10 accurate for smooth f). */
export function deriv(f: (x: number) => number, x: number): number {
  const h = 1e-3 * Math.max(1, Math.abs(x));
  const d = (k: number) => (f(x + k) - f(x - k)) / (2 * k);
  return (4 * d(h / 2) - d(h)) / 3; // one Richardson step
}
function deriv2(f: (x: number) => number, x: number, h = 1e-3): number {
  return (f(x + h) - 2 * f(x) + f(x - h)) / (h * h);
}
function deriv4(f: (x: number) => number, x: number, h = 1e-2): number {
  return (f(x + 2 * h) - 4 * f(x + h) + 6 * f(x) - 4 * f(x - h) + f(x - 2 * h)) / h ** 4;
}

function tolerance(s: string, dflt: number): { tol: number; label: string } {
  const dp = /\b(\d+)\s*(?:decimal places|d\.?p\.?|decimals)\b/i.exec(s);
  if (dp) {
    const k = Number(dp[1]);
    return { tol: 0.5 * 10 ** -k, label: `${k} decimal places (|Δx| < ${fmt(0.5 * 10 ** -k)})` };
  }
  const t = /\b(?:tol(?:erance)?|eps(?:ilon)?|error)\s*(?:=|of|<|is)?\s*([\d.]+(?:e-?\d+)?)/i.exec(s);
  if (t) return { tol: Number(t[1]), label: `|Δx| < ${t[1]}` };
  return { tol: dflt, label: `|Δx| < ${fmt(dflt)}` };
}

function interval(s: string): [number, number] | null {
  const m = /\[\s*([-−\d.e]+(?:\s*\*?\s*pi)?)\s*,\s*([-−\d.e]+(?:\s*\*?\s*pi)?)\s*\]/i.exec(s) ?? /\bbetween\s+([-−\d.]+)\s+and\s+([-−\d.]+)/i.exec(s) ?? /\b(?:from|a\s*=)\s*([-−\d.]+)\s*(?:to|,|and|b\s*=)\s*([-−\d.]+)/i.exec(s);
  if (!m) {
    const a = param(s, ['a']);
    const b = param(s, ['b']);
    return a !== undefined && b !== undefined ? [a, b] : null;
  }
  return [numOrPi(m[1]!), numOrPi(m[2]!)];
}
function numOrPi(t: string): number {
  const c = t.replace(/−/g, '-').replace(/\s|\*/g, '');
  if (/pi$/i.test(c)) {
    const k = c.replace(/pi$/i, '');
    return (k === '' ? 1 : k === '-' ? -1 : Number(k)) * Math.PI;
  }
  return Number(c);
}

function startValue(s: string): number | undefined {
  const m = /\b(?:starting|start|beginning|initial(?:\s+guess)?|guess|from|with|x0|x_0|x₀|p0)\b(?:\s+(?:at|of|value|from|x0|x\s*=))*\s*(?:=|:)?\s*([-−]?[\d.]+(?:e-?\d+)?)/i.exec(s);
  return m ? Number(m[1]!.replace('−', '-')) : undefined;
}

function rootTable(columns: string[], rows: (number | string)[][], caption: string) {
  return { columns, rows: rows.map((r) => r.map((c) => (typeof c === 'number' ? fmt(c, 10) : c))), caption };
}

function rootFinding(input: string): Result {
  const lc = input.toLowerCase();
  const method = /\bbisection\b|\binterval halving\b/.test(lc)
    ? 'bisection'
    : /\b(?:regula falsi|false position)\b/.test(lc)
      ? 'falsi'
      : /\bsecant\b/.test(lc)
        ? 'secant'
        : /\bfixed[- ]point\b/.test(lc)
          ? 'fixed'
          : /\bnewton(?:'?s)?(?:[- ]raphson)?\b/.test(lc) && !/\b(?:interpol|divided|forward diff|backward diff|optimi|minimi|maximi|law|cooling|cotes|polynomial)\w*/.test(lc)
            ? 'newton'
            : null;
  if (!method) return null;
  const kw = {
    bisection: /\b(?:bisection|interval halving)(?:\s+method)?(?:\s+(?:on|for|of|to))?/i,
    falsi: /\b(?:regula falsi|false position)(?:\s+method)?(?:\s+(?:on|for|of))?/i,
    secant: /\bsecant(?:\s+method)?(?:\s+(?:on|for|of))?/i,
    fixed: /\bfixed[- ]point(?:\s+iteration)?(?:\s+method)?(?:\s+(?:on|for|of))?/i,
    newton: /\bnewton(?:'?s)?(?:[- ]raphson)?(?:\s+method)?(?:\s+(?:on|for|of|to))?/i,
  }[method];
  const text = fnText(afterKeyword(input, kw));
  if (!text) refuse('Give the function, e.g. “newton’s method x^3 - 2x - 5 starting at 2”');
  const f = compile(text, ['x']);
  const { tol, label } = tolerance(input, method === 'bisection' || method === 'falsi' ? 1e-6 : 1e-10);
  const maxIt = Math.min(200, param(input, ['max iterations', 'iterations', 'max'], 0) || 100);
  const rows: (number | string)[][] = [];
  let root = NaN;
  let iters = 0;
  let converged = false;
  const notes: string[] = [];
  let columns: string[] = [];

  if (method === 'bisection' || method === 'falsi') {
    const iv = interval(input.slice(kw.exec(input)!.index));
    if (!iv) refuse('Give an interval, e.g. “on [1, 2]” or “between 1 and 2”');
    let [a, b] = iv!;
    let fa = f(a);
    let fb = f(b);
    if (fa === 0 || fb === 0) root = fa === 0 ? a : b;
    else if (Math.sign(fa) === Math.sign(fb)) refuse(`f(${fmt(a)}) = ${fmt(fa)} and f(${fmt(b)}) = ${fmt(fb)} have the same sign, so the interval doesn’t bracket a root`);
    columns = ['n', 'a', 'b', method === 'bisection' ? 'midpoint c' : 'c', 'f(c)', method === 'bisection' ? '(b−a)/2' : '|Δc|'];
    let prev = NaN;
    for (let n = 1; n <= maxIt && Number.isNaN(root); n++) {
      const c = method === 'bisection' ? (a + b) / 2 : (a * fb - b * fa) / (fb - fa);
      const fc = f(c);
      const width = method === 'bisection' ? (b - a) / 2 : Math.abs(c - prev);
      rows.push([n, a, b, c, fc, method === 'bisection' ? width : Number.isNaN(prev) ? '—' : width]);
      iters = n;
      if (fc === 0 || width < tol) {
        root = c;
        converged = true;
        break;
      }
      if (Math.sign(fc) === Math.sign(fa)) [a, fa] = [c, fc];
      else [b, fb] = [c, fc];
      prev = c;
    }
    if (method === 'bisection') notes.push(`Bisection halves the bracket each step, so reaching (b − a)/2 < tol takes ⌈log₂((b₀ − a₀)/tol)⌉ − 1 steps. It always converges, linearly (one binary digit per step).`);
    else notes.push('False position keeps a sign-changing bracket but uses the secant through the endpoints instead of the midpoint.');
  } else if (method === 'newton') {
    let x = startValue(input.slice(kw.exec(input)!.index + 6));
    if (x === undefined) refuse('Give a starting value, e.g. “starting at 2”');
    columns = ['n', 'xₙ', 'f(xₙ)', "f′(xₙ)", 'xₙ₊₁', '|xₙ₊₁ − xₙ|'];
    for (let n = 0; n < maxIt; n++) {
      const fx = f(x!);
      const d = deriv(f, x!);
      if (!Number.isFinite(fx) || !Number.isFinite(d)) refuse(`f is undefined near x = ${fmt(x!)}`);
      if (d === 0) refuse(`f′(${fmt(x!)}) = 0: Newton’s method can’t continue from here (try another start)`);
      const nx = x! - fx / d;
      const dx = Math.abs(nx - x!);
      rows.push([n, x!, fx, d, nx, dx]);
      iters = n + 1;
      x = nx;
      if (dx < tol || fx === 0) {
        converged = true;
        break;
      }
    }
    root = x!;
    notes.push('xₙ₊₁ = xₙ − f(xₙ)/f′(xₙ). f′ is computed numerically (Richardson-extrapolated central differences). Near a simple root the number of correct digits roughly doubles each step (quadratic convergence).');
  } else if (method === 'secant') {
    const vals = startPair(input);
    if (!vals) refuse('Give two starting values, e.g. “x0 = 1, x1 = 2”');
    let [x0, x1] = vals!;
    columns = ['n', 'xₙ₋₁', 'xₙ', 'f(xₙ)', 'xₙ₊₁', '|Δx|'];
    for (let n = 1; n <= maxIt; n++) {
      const f0 = f(x0);
      const f1 = f(x1);
      if (f1 === f0) {
        if (f1 === 0) break;
        refuse('f(xₙ) = f(xₙ₋₁): the secant line is horizontal');
      }
      const x2 = x1 - (f1 * (x1 - x0)) / (f1 - f0);
      const dx = Math.abs(x2 - x1);
      rows.push([n, x0, x1, f1, x2, dx]);
      iters = n;
      [x0, x1] = [x1, x2];
      if (dx < tol) {
        converged = true;
        break;
      }
    }
    root = x1;
    notes.push('xₙ₊₁ = xₙ − f(xₙ)(xₙ − xₙ₋₁)/(f(xₙ) − f(xₙ₋₁)). No derivative needed; convergence order ≈ 1.618 (the golden ratio).');
  } else {
    let x = startValue(input.slice(kw.exec(input)!.index + 5));
    if (x === undefined) refuse('Give a starting value, e.g. “starting at 1”');
    columns = ['n', 'xₙ', 'g(xₙ)', '|xₙ₊₁ − xₙ|'];
    for (let n = 0; n < maxIt; n++) {
      const g = f(x!);
      if (!Number.isFinite(g) || Math.abs(g) > 1e12) refuse(`The iteration diverges (g(x) = ${fmt(g)} at step ${n}); |g′| > 1 near the fixed point, or the start is too far`);
      const dx = Math.abs(g - x!);
      rows.push([n, x!, g, dx]);
      iters = n + 1;
      x = g;
      if (dx < tol) {
        converged = true;
        break;
      }
    }
    root = x!;
    const gp = deriv(f, root);
    notes.push(`xₙ₊₁ = g(xₙ). It converges when |g′(x*)| < 1 near the fixed point x*; here g′(x*) ≈ ${fmt(gp, 4)}.`);
  }
  if (!converged && method !== 'bisection' && method !== 'falsi') notes.unshift(`Stopped after ${iters} iterations without meeting the tolerance.`);
  const isFixed = method === 'fixed';
  const name = { bisection: 'Bisection', falsi: 'False position', secant: 'Secant method', fixed: 'Fixed-point iteration', newton: 'Newton’s method' }[method];
  const lines: Line[] = [
    { label: isFixed ? 'Fixed point' : 'Root', display: fmt(root, 12) },
    { label: isFixed ? 'g(x*) − x*' : 'f(root)', display: fmt(isFixed ? f(root) - root : f(root), 4) },
    { label: 'Iterations', display: String(iters) },
    { label: 'Stopping rule', display: method === 'bisection' ? label.replace('|Δx|', '(b−a)/2') : label },
  ];
  return answer(input, 'numeric', `${name} · ${isFixed ? 'x = ' : 'f(x) = '}${isFixed ? `g(x) = ${text}` : text}`, `x ≈ ${fmt(root, 10)}`, {
    value: root,
    lines,
    table: rootTable(columns, rows, `${name} iterations`),
    notes,
    exactness: 'numeric',
  });
}

function startPair(s: string): [number, number] | null {
  const a = param(s, ['x0', 'x_0', 'x₀', 'p0']);
  const b = param(s, ['x1', 'x_1', 'x₁', 'p1']);
  if (a !== undefined && b !== undefined) return [a, b];
  const iv = interval(s);
  if (iv) return iv;
  const m = /\b(?:starting|start|initial(?:\s+guesses)?|guesses|from|with)\b(?:\s+(?:at|values?))?\s*([-−]?[\d.]+)\s*(?:,|and)\s*([-−]?[\d.]+)/i.exec(s);
  return m ? [Number(m[1]!.replace('−', '-')), Number(m[2]!.replace('−', '-'))] : null;
}

// ─── Interpolation ───

export function parsePoints(s: string): [number, number][] {
  const pts = [...s.matchAll(/\(\s*([-−]?[\d.]+(?:e-?\d+)?)\s*,\s*([-−]?[\d.]+(?:e-?\d+)?)\s*\)/g)].map((m) => [Number(m[1]!.replace('−', '-')), Number(m[2]!.replace('−', '-'))] as [number, number]);
  if (pts.length) return pts;
  const xs = /\bx\s*(?:values?|s)?\s*[:=]\s*([-−\d.,\s]+?)(?=\by\b|;|$)/i.exec(s);
  const ys = /\by\s*(?:values?|s)?\s*[:=]\s*([-−\d.,\s]+?)(?=\bat\b|;|$)/i.exec(s);
  if (xs && ys) {
    const X = numbers(xs[1]!);
    const Y = numbers(ys[1]!);
    if (X.length === Y.length) return X.map((x, i) => [x, Y[i]!]);
  }
  return [];
}

/** Coefficients (constant first) of the interpolating polynomial, via Newton's divided differences. */
function dividedDifferences(pts: [number, number][]): number[][] {
  const n = pts.length;
  const t: number[][] = [pts.map((p) => p[1])];
  for (let k = 1; k < n; k++) {
    const prev = t[k - 1]!;
    const col: number[] = [];
    for (let i = 0; i < n - k; i++) col.push((prev[i + 1]! - prev[i]!) / (pts[i + k]![0] - pts[i]![0]));
    t.push(col);
  }
  return t;
}

function newtonToPower(pts: [number, number][], dd: number[][]): number[] {
  let poly = [0];
  let basis = [1];
  for (let k = 0; k < pts.length; k++) {
    const c = dd[k]![0]!;
    poly = addPoly(poly, basis.map((b) => b * c));
    basis = mulPoly(basis, [-pts[k]![0], 1]);
  }
  return poly;
}
const addPoly = (a: number[], b: number[]) => Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[i] ?? 0) + (b[i] ?? 0));
const mulPoly = (a: number[], b: number[]) => {
  const r = new Array(a.length + b.length - 1).fill(0) as number[];
  a.forEach((x, i) => b.forEach((y, j) => (r[i + j]! += x * y)));
  return r;
};

export function polyString(c: number[], v = 'x'): string {
  const terms: string[] = [];
  for (let i = c.length - 1; i >= 0; i--) {
    const a = Math.abs(c[i]!) < 1e-12 ? 0 : c[i]!;
    if (a === 0) continue;
    const mag = fmt(Math.abs(a), 6);
    const coef = i > 0 && mag === '1' ? '' : mag;
    const pow = i === 0 ? '' : i === 1 ? v : `${v}^${i}`;
    const sign = a < 0 ? '−' : '+';
    terms.push(`${terms.length ? ` ${sign} ` : a < 0 ? '−' : ''}${coef}${pow}`);
  }
  return terms.join('') || '0';
}
const evalPoly = (c: number[], x: number) => c.reduceRight((s, a) => s * x + a, 0);

function interpolation(input: string): Result {
  const lc = input.toLowerCase();
  if (!/\binterpolat|\bdivided differences?\b|\bspline\b|\blagrange polynomial\b/.test(lc)) return null;
  const pts = parsePoints(input);
  if (pts.length < 2) refuse('Give at least two points, e.g. “(1, 1), (2, 4), (3, 9)”');
  if (new Set(pts.map((p) => p[0])).size !== pts.length) refuse('Two points share an x value');
  const at = /\b(?:at|for|evaluate at)\s+x\s*=\s*([-−]?[\d.]+)|\bat\s+([-−]?[\d.]+)\s*$|\bx\s*=\s*([-−]?[\d.]+)\s*$/i.exec(input);
  const x = at ? Number((at[1] ?? at[2] ?? at[3])!.replace('−', '-')) : undefined;
  if (/\bspline\b/.test(lc)) return spline(input, pts, x, /\bclamped\b/.test(lc));
  if (/\blinear\b/.test(lc) && x !== undefined) {
    const s = [...pts].sort((a, b) => a[0] - b[0]);
    let i = s.findIndex((p, k) => k < s.length - 1 && x >= p[0] && x <= s[k + 1]![0]);
    if (i < 0) i = x < s[0]![0] ? 0 : s.length - 2;
    const [x0, y0] = s[i]!;
    const [x1, y1] = s[i + 1]!;
    const y = y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    return answer(input, 'numeric', `Linear interpolation at x = ${fmt(x)}`, fmt(y, 10), { value: y, lines: [{ label: 'Between', display: `(${fmt(x0)}, ${fmt(y0)}) and (${fmt(x1)}, ${fmt(y1)})` }, { label: 'Formula', display: 'y = y₀ + (y₁ − y₀)(x − x₀)/(x₁ − x₀)' }] });
  }
  const dd = dividedDifferences(pts);
  const coeffs = newtonToPower(pts, dd);
  const newtonForm = dd.map((col, k) => (k === 0 ? fmt(col[0]!) : `${fmt(col[0]!)}${pts.slice(0, k).map((p) => `(x ${p[0] < 0 ? '+' : '−'} ${fmt(Math.abs(p[0]))})`).join('')}`)).filter((t, k) => k === 0 || !t.startsWith('0(')).join(' + ');
  const lines: Line[] = [
    { label: 'Polynomial', display: `P(x) = ${polyString(coeffs)}` },
    { label: 'Newton form', display: newtonForm },
    { label: 'Degree', display: `≤ ${pts.length - 1}` },
  ];
  const isLagrange = /\blagrange\b/.test(lc);
  if (isLagrange) {
    lines.splice(1, 1, {
      label: 'Lagrange form',
      display: pts.map((p, i) => `${fmt(p[1])}·L${i}(x)`).join(' + '),
    });
  }
  const table = {
    columns: ['xᵢ', 'f[xᵢ]', ...dd.slice(1).map((_, k) => `order ${k + 1}`)],
    rows: pts.map((p, i) => [fmt(p[0]), ...dd.map((col) => (col[i] === undefined ? '' : fmt(col[i]!, 8)))]),
    caption: 'Divided differences (top row gives the Newton coefficients)',
  };
  const value = x !== undefined ? evalPoly(coeffs, x) : undefined;
  if (value !== undefined && isLagrange) {
    pts.forEach((p, i) => {
      const L = pts.reduce((s, q, j) => (j === i ? s : (s * (x! - q[0])) / (p[0] - q[0])), 1);
      lines.push({ label: `L${i}(${fmt(x!)})`, display: fmt(L, 8) });
    });
  }
  return answer(input, 'numeric', `${isLagrange ? 'Lagrange' : 'Newton divided-difference'} interpolation through ${pts.length} points${x !== undefined ? ` at x = ${fmt(x)}` : ''}`, value !== undefined ? fmt(value, 10) : `P(x) = ${polyString(coeffs)}`, {
    value,
    lines,
    table,
    notes: ['The interpolating polynomial through n points is unique, so the Lagrange and Newton forms give the same P(x).'],
  });
}

function spline(input: string, raw: [number, number][], x: number | undefined, clamped: boolean): Result {
  const pts = [...raw].sort((a, b) => a[0] - b[0]);
  const n = pts.length - 1;
  const h = pts.slice(0, n).map((p, i) => pts[i + 1]![0] - p[0]);
  // Natural cubic spline: M₀ = Mₙ = 0, tridiagonal for the interior second derivatives.
  const M = new Array(n + 1).fill(0) as number[];
  if (n >= 2) {
    const a: number[] = [];
    const b: number[] = [];
    const c: number[] = [];
    const d: number[] = [];
    for (let i = 1; i < n; i++) {
      a.push(h[i - 1]!);
      b.push(2 * (h[i - 1]! + h[i]!));
      c.push(h[i]!);
      d.push(6 * ((pts[i + 1]![1] - pts[i]![1]) / h[i]! - (pts[i]![1] - pts[i - 1]![1]) / h[i - 1]!));
    }
    const sol = thomas(a, b, c, d);
    sol.forEach((v, i) => (M[i + 1] = v));
  }
  const pieces = pts.slice(0, n).map((p, i) => {
    const [x0, y0] = p;
    const y1 = pts[i + 1]![1];
    const hi = h[i]!;
    const A = (M[i + 1]! - M[i]!) / (6 * hi);
    const B = M[i]! / 2;
    const C = (y1 - y0) / hi - (hi * (2 * M[i]! + M[i + 1]!)) / 6;
    return { x0, x1: pts[i + 1]![0], a: y0, b: C, c: B, d: A };
  });
  const S = (t: number) => {
    const p = pieces.find((q) => t >= q.x0 && t <= q.x1) ?? (t < pieces[0]!.x0 ? pieces[0]! : pieces[pieces.length - 1]!);
    const u = t - p.x0;
    return p.a + p.b * u + p.c * u * u + p.d * u * u * u;
  };
  const table = {
    columns: ['Interval', 'Sᵢ(x) with u = x − xᵢ'],
    rows: pieces.map((p) => [`[${fmt(p.x0)}, ${fmt(p.x1)}]`, `${fmt(p.a, 6)} + ${fmt(p.b, 6)}u + ${fmt(p.c, 6)}u² + ${fmt(p.d, 6)}u³`.replace(/\+ -/g, '− ')]),
    caption: 'Natural cubic spline pieces',
  };
  const notes = ['Natural spline: S″ = 0 at both ends; S, S′ and S″ are continuous at every interior knot.'];
  if (clamped) notes.unshift('Clamped end slopes weren’t given, so this is the natural spline.');
  const value = x !== undefined ? S(x) : undefined;
  return answer(input, 'numeric', `Natural cubic spline through ${pts.length} points${x !== undefined ? ` at x = ${fmt(x)}` : ''}`, value !== undefined ? fmt(value, 10) : `${n} cubic pieces`, {
    value,
    lines: [{ label: 'Knot second derivatives M', display: M.map((m) => fmt(m, 6)).join(', ') }],
    table,
    notes,
  });
}

function thomas(a: number[], b: number[], c: number[], d: number[]): number[] {
  const n = b.length;
  const cp: number[] = [];
  const dp: number[] = [];
  for (let i = 0; i < n; i++) {
    const m = b[i]! - (i ? a[i]! * cp[i - 1]! : 0);
    cp.push(c[i]! / m);
    dp.push((d[i]! - (i ? a[i]! * dp[i - 1]! : 0)) / m);
  }
  const x = new Array(n).fill(0) as number[];
  for (let i = n - 1; i >= 0; i--) x[i] = dp[i]! - (i < n - 1 ? cp[i]! * x[i + 1]! : 0);
  return x;
}

// ─── Numerical differentiation ───

function numDiff(input: string): Result {
  const lc = input.toLowerCase();
  if (!/\b(?:numerical(?:ly)?\s+(?:derivative|differentiat\w*)|finite differences?|(?:forward|backward|central|centered)\s+differences?|differentiate numerically)\b/.test(lc)) return null;
  const m = /(?:derivative|differentiat\w*|differences?)\s+(?:of\s+|for\s+)?(?:f\(x\)\s*=\s*)?(.+?)\s+at\s+(?:x\s*=\s*)?([-−]?[\d.]+(?:\s*\*?\s*pi)?)/i.exec(input);
  if (!m) refuse('Try “numerical derivative of sin x at 1 with h = 0.1”');
  const text = m![1]!.trim();
  const f = compile(text);
  const x = numOrPi(m![2]!);
  const h = param(input, ['h', 'step', 'step size'], 0.1)!;
  const fwd = (f(x + h) - f(x)) / h;
  const bwd = (f(x) - f(x - h)) / h;
  const ctr = (f(x + h) - f(x - h)) / (2 * h);
  const ctr2 = (f(x + h / 2) - f(x - h / 2)) / h;
  const rich = (4 * ctr2 - ctr) / 3;
  const sec = (f(x + h) - 2 * f(x) + f(x - h)) / (h * h);
  const ref = deriv(f, x);
  const rows = [
    ['Forward', '(f(x+h) − f(x))/h', fmt(fwd, 10), fmt(Math.abs(fwd - ref), 3), 'O(h)'],
    ['Backward', '(f(x) − f(x−h))/h', fmt(bwd, 10), fmt(Math.abs(bwd - ref), 3), 'O(h)'],
    ['Central', '(f(x+h) − f(x−h))/2h', fmt(ctr, 10), fmt(Math.abs(ctr - ref), 3), 'O(h²)'],
    ['Richardson', '(4D(h/2) − D(h))/3', fmt(rich, 10), fmt(Math.abs(rich - ref), 3), 'O(h⁴)'],
  ];
  return answer(input, 'numeric', `Finite differences · f(x) = ${text} at x = ${fmt(x)}, h = ${fmt(h)}`, `f′(${fmt(x)}) ≈ ${fmt(ctr, 10)}`, {
    value: ctr,
    lines: [
      { label: 'Central difference', display: fmt(ctr, 10) },
      { label: 'Second derivative (central)', display: fmt(sec, 8) },
      { label: 'Reference f′', display: fmt(ref, 12) },
    ],
    table: { columns: ['Scheme', 'Formula', 'Estimate', 'Error', 'Order'], rows },
    notes: ['Truncation error shrinks with h, but too small an h amplifies rounding error (≈ ε/h); h near ε^(1/3) ≈ 6e-6 is optimal for central differences.'],
    exactness: 'numeric',
  });
}

// ─── Quadrature ───

export function adaptiveSimpson(f: (x: number) => number, a: number, b: number, eps = 1e-12): number {
  const simp = (a: number, b: number, fa: number, fm: number, fb: number) => ((b - a) / 6) * (fa + 4 * fm + fb);
  const rec = (a: number, b: number, fa: number, fm: number, fb: number, whole: number, eps: number, depth: number): number => {
    const m = (a + b) / 2;
    const lm = (a + m) / 2;
    const rm = (m + b) / 2;
    const flm = f(lm);
    const frm = f(rm);
    const left = simp(a, m, fa, flm, fm);
    const right = simp(m, b, fm, frm, fb);
    if (depth <= 0 || Math.abs(left + right - whole) <= 15 * eps) return left + right + (left + right - whole) / 15;
    return rec(a, m, fa, flm, fm, left, eps / 2, depth - 1) + rec(m, b, fm, frm, fb, right, eps / 2, depth - 1);
  };
  const fa = f(a);
  const fb = f(b);
  const fm = f((a + b) / 2);
  return rec(a, b, fa, fm, fb, simp(a, b, fa, fm, fb), eps, 40);
}

/** Gauss–Legendre nodes and weights on [−1, 1] (Newton on Pₙ). */
export function gaussLegendre(n: number): { x: number[]; w: number[] } {
  const x: number[] = [];
  const w: number[] = [];
  for (let i = 1; i <= n; i++) {
    let z = Math.cos((Math.PI * (i - 0.25)) / (n + 0.5));
    let pp = 0;
    for (let it = 0; it < 100; it++) {
      let p1 = 1;
      let p2 = 0;
      for (let j = 1; j <= n; j++) {
        const p3 = p2;
        p2 = p1;
        p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j;
      }
      pp = (n * (z * p1 - p2)) / (z * z - 1);
      const z1 = z;
      z = z1 - p1 / pp;
      if (Math.abs(z - z1) < 1e-15) break;
    }
    x.push(-z);
    w.push(2 / ((1 - z * z) * pp * pp));
  }
  return { x, w };
}

function quadrature(input: string): Result {
  const lc = input.toLowerCase();
  const rule = /\bsimpson'?s?\s*3\/8\b|\b3\/8\s+rule\b/.test(lc)
    ? 'simpson38'
    : /\bsimpson/.test(lc)
      ? 'simpson'
      : /\btrapez\w*/.test(lc)
        ? 'trapezoid'
        : /\bmidpoint (?:rule|sum|approx)/.test(lc)
          ? 'midpoint'
          : /\b(?:gauss(?:ian)?(?:[- ]legendre)? quadrature|gauss[- ]legendre)\b/.test(lc)
            ? 'gauss'
            : /\bromberg\b/.test(lc)
              ? 'romberg'
              : /\b(?:left|right)(?:[- ]hand)?\s+(?:riemann|endpoint|rectangle)|\briemann sum\b/.test(lc)
                ? 'riemann'
                : null;
  if (!rule) return null;
  const m = /(?:integrat\w*|integral|of|for|approximat\w*|estimat\w*|rule|quadrature)\s+(?:of\s+)?(?:∫\s*)?(.+?)\s*(?:dx\s*)?(?:,\s*)?(?:from|between|over|on)\s+(?:x\s*=\s*)?([-−]?[\d.]*\s*\*?\s*(?:pi|π)?)\s*(?:to|and|,)\s*([-−]?[\d.]*\s*\*?\s*(?:pi|π)?)(?=\s|,|$|\])/i.exec(input.replace(/π/g, 'pi'));
  if (!m) refuse('Try “simpson’s rule integrate sin x from 0 to pi n=6”');
  let text = m![1]!.replace(/^(?:the\s+)?(?:integral\s+of\s+|integrate\s+)/i, '').replace(/\s*d[xt]\s*$/i, '').trim();
  text = text.replace(/^(?:rule|quadrature)\s+/i, '');
  const f = compile(text);
  const a = numOrPi(m![2]!.trim() || '0');
  const b = numOrPi(m![3]!.trim());
  if (!Number.isFinite(a) || !Number.isFinite(b)) refuse('Couldn’t read the limits');
  let n = param(input, ['n', 'intervals', 'subintervals', 'strips', 'panels', 'points', 'nodes'], undefined) ?? (/\b(\d+)\s+(?:sub)?intervals|\b(\d+)\s+(?:strips|panels|points|nodes|trapezoids|rectangles)/i.exec(input) ? Number(/\b(\d+)\s+/.exec(/\b(\d+)\s+(?:sub)?(?:intervals|strips|panels|points|nodes|trapezoids|rectangles)/i.exec(input)![0])![1]) : undefined);
  if (n === undefined) n = rule === 'gauss' ? 3 : rule === 'simpson38' ? 6 : rule === 'romberg' ? 4 : 4;
  if (!Number.isInteger(n) || n < 1 || n > 10000) refuse('n should be a whole number from 1 to 10,000');
  if (rule === 'simpson' && n % 2) refuse('Simpson’s 1/3 rule needs an even number of subintervals');
  if (rule === 'simpson38' && n % 3) refuse('Simpson’s 3/8 rule needs n divisible by 3');
  if (rule === 'gauss' && n > 64) refuse('Up to 64 Gauss points');
  const exact = adaptiveSimpson(f, a, b);
  const h = (b - a) / n;
  const rows: string[][] = [];
  let approx = 0;
  let bound: string | undefined;
  const maxAbs = (g: (x: number) => number) => {
    let mx = 0;
    for (let i = 0; i <= 200; i++) mx = Math.max(mx, Math.abs(g(a + ((b - a) * i) / 200)));
    return mx;
  };
  let label = '';
  if (rule === 'trapezoid' || rule === 'simpson' || rule === 'simpson38' || rule === 'riemann') {
    const right = /\bright/.test(lc);
    let s = 0;
    for (let i = 0; i <= n; i++) {
      const xi = a + i * h;
      const fx = f(xi);
      const w =
        rule === 'trapezoid'
          ? i === 0 || i === n ? 1 : 2
          : rule === 'simpson'
            ? i === 0 || i === n ? 1 : i % 2 ? 4 : 2
            : rule === 'simpson38'
              ? i === 0 || i === n ? 1 : i % 3 ? 3 : 2
              : right ? (i === 0 ? 0 : 1) : i === n ? 0 : 1;
      s += w * fx;
      rows.push([String(i), fmt(xi, 8), fmt(fx, 10), String(w)]);
    }
    const k = rule === 'trapezoid' ? h / 2 : rule === 'simpson' ? h / 3 : rule === 'simpson38' ? (3 * h) / 8 : h;
    approx = k * s;
    label = rule === 'trapezoid' ? `T = (h/2)·Σ wᵢ f(xᵢ)` : rule === 'simpson' ? `S = (h/3)·Σ wᵢ f(xᵢ)` : rule === 'simpson38' ? 'S = (3h/8)·Σ wᵢ f(xᵢ)' : `${right ? 'R' : 'L'} = h·Σ f(xᵢ)`;
    const f2 = (x: number) => deriv2(f, x);
    const f4 = (x: number) => deriv4(f, x);
    if (rule === 'trapezoid') bound = `|E| ≤ (b−a)h²/12 · max|f″| ≈ ${fmt((Math.abs(b - a) * h * h * maxAbs(f2)) / 12, 4)}`;
    if (rule === 'simpson') bound = `|E| ≤ (b−a)h⁴/180 · max|f⁽⁴⁾| ≈ ${fmt((Math.abs(b - a) * h ** 4 * maxAbs(f4)) / 180, 4)}`;
    if (rule === 'simpson38') bound = `|E| ≤ (b−a)h⁴/80 · max|f⁽⁴⁾| ≈ ${fmt((Math.abs(b - a) * h ** 4 * maxAbs(f4)) / 80, 4)}`;
    if (rule === 'riemann') bound = `|E| ≤ (b−a)h/2 · max|f′| ≈ ${fmt((Math.abs(b - a) * h * maxAbs((x) => deriv(f, x))) / 2, 4)}`;
  } else if (rule === 'midpoint') {
    for (let i = 0; i < n; i++) {
      const xi = a + (i + 0.5) * h;
      const fx = f(xi);
      approx += h * fx;
      rows.push([String(i + 1), fmt(xi, 8), fmt(fx, 10), '1']);
    }
    label = 'M = h·Σ f(midpoints)';
    bound = `|E| ≤ (b−a)h²/24 · max|f″| ≈ ${fmt((Math.abs(b - a) * h * h * maxAbs((x) => deriv2(f, x))) / 24, 4)}`;
  } else if (rule === 'gauss') {
    const { x, w } = gaussLegendre(n);
    const half = (b - a) / 2;
    const mid = (a + b) / 2;
    x.forEach((t, i) => {
      const xi = mid + half * t;
      const fx = f(xi);
      approx += half * w[i]! * fx;
      rows.push([String(i + 1), fmt(t, 12), fmt(w[i]!, 12), fmt(xi, 8), fmt(fx, 10)]);
    });
    label = `${n}-point Gauss–Legendre: ((b−a)/2)·Σ wᵢ f(xᵢ); exact for polynomials of degree ≤ ${2 * n - 1}`;
  } else {
    const R: number[][] = [];
    for (let i = 0; i < n; i++) {
      const m = 2 ** i;
      const hh = (b - a) / m;
      let t = 0;
      for (let j = 0; j <= m; j++) t += (j === 0 || j === m ? 0.5 : 1) * f(a + j * hh);
      const row = [t * hh];
      for (let k = 1; k <= i; k++) row.push(row[k - 1]! + (row[k - 1]! - R[i - 1]![k - 1]!) / (4 ** k - 1));
      R.push(row);
      rows.push([String(i), ...row.map((v) => fmt(v, 10))]);
    }
    approx = R[n - 1]![n - 1]!;
    label = `Romberg R(${n - 1},${n - 1}) by Richardson extrapolation of trapezoid sums`;
  }
  const err = Math.abs(approx - exact);
  const name = { trapezoid: 'Trapezoidal rule', simpson: 'Simpson’s 1/3 rule', simpson38: 'Simpson’s 3/8 rule', midpoint: 'Midpoint rule', gauss: 'Gauss–Legendre quadrature', romberg: 'Romberg integration', riemann: /\bright/.test(lc) ? 'Right Riemann sum' : 'Left Riemann sum' }[rule];
  const lines: Line[] = [
    { label: 'Approximation', display: fmt(approx, 10) },
    { label: 'Reference value', display: fmt(exact, 12) },
    { label: 'Actual error', display: fmt(err, 4) },
  ];
  if (rule !== 'gauss' && rule !== 'romberg') lines.splice(1, 0, { label: 'h', display: fmt(h, 8) });
  if (bound) lines.push({ label: 'Error bound', display: bound });
  const columns = rule === 'gauss' ? ['i', 'node tᵢ', 'weight wᵢ', 'xᵢ', 'f(xᵢ)'] : rule === 'romberg' ? ['k', ...Array.from({ length: n }, (_, k) => `R(k,${k})`)] : ['i', 'xᵢ', 'f(xᵢ)', 'weight'];
  return answer(input, 'numeric', `${name} · ∫ ${text} dx from ${fmt(a, 6)} to ${fmt(b, 6)}${rule === 'romberg' ? '' : `, n = ${n}`}`, `≈ ${fmt(approx, 10)}`, {
    value: approx,
    lines,
    table: { columns, rows, caption: rule === 'romberg' ? 'Romberg table' : rule === 'gauss' ? 'Gauss nodes and weights' : 'Nodes and weights' },
    notes: [label, 'Reference value from adaptive Simpson to ~1e-12.'],
    exactness: 'numeric',
  });
}

// ─── ODE steppers ───

function odeSolver(input: string): Result {
  const lc = input.toLowerCase();
  const method = /\b(?:rk4|runge[- ]kutta(?:\s+(?:4|4th|fourth)[- ]order)?|fourth[- ]order runge)\b/.test(lc) && !/\brk2\b|\bsecond[- ]order runge/.test(lc)
    ? 'rk4'
    : /\b(?:improved euler|heun'?s?|modified euler|rk2)\b/.test(lc)
      ? 'heun'
      : /\bmidpoint method\b/.test(lc)
        ? 'midpoint'
        : /\b(?:euler'?s?\s+method|forward euler|explicit euler|euler\s+step)/.test(lc)
          ? 'euler'
          : null;
  if (!method) return null;
  const eq = /\b(?:dy\/d([xt])|y'|y′|y_?prime)\s*=\s*(.+?)(?=,|;|\s+with\b|\s+y\s*\(|\s+y0\b|\s+from\b|\s+h\s*=|\s+step|\s+on\b|$)/i.exec(input);
  if (!eq) refuse('Write the equation as “y′ = …” or “dy/dx = …”, e.g. “euler’s method y′ = x + y, y(0) = 1, h = 0.1, to x = 0.5”');
  const tv = (eq![1] ?? (/\bt\b/.test(eq![2]!) && !/\bx\b/.test(eq![2]!) ? 't' : 'x')).toLowerCase();
  const text = eq![2]!.trim();
  const f = compile(text, [tv, 'y']);
  const ic = new RegExp(`\\by\\s*\\(\\s*([-−]?[\\d.]+)\\s*\\)\\s*=\\s*([-−]?[\\d.]+(?:e-?\\d+)?)`, 'i').exec(input);
  let x0 = ic ? Number(ic[1]!.replace('−', '-')) : param(input, [`${tv}0`, `${tv}_0`], 0)!;
  let y0 = ic ? Number(ic[2]!.replace('−', '-')) : param(input, ['y0', 'y_0', 'y₀']);
  if (y0 === undefined) refuse('Give an initial condition, e.g. “y(0) = 1”');
  const h0 = param(input, ['h', 'step size', 'step', 'dt', 'dx']);
  const end = new RegExp(`\\b(?:to|until|up to|at|find y\\s*\\(?|approximate y\\s*\\(?|estimate y\\s*\\(?)\\s*(?:${tv}\\s*=\\s*)?([-−]?[\\d.]+)`, 'i').exec(input.slice(ic ? ic.index + ic[0].length : 0));
  const nGiven = param(input, ['n', 'steps']) ?? (/\b(\d+)\s+steps\b/i.exec(input) ? Number(/\b(\d+)\s+steps\b/i.exec(input)![1]) : undefined);
  let h: number;
  let N: number;
  const xEnd = end ? Number(end[1]!.replace('−', '-')) : undefined;
  if (h0 !== undefined && xEnd !== undefined) {
    h = h0;
    N = Math.round((xEnd - x0) / h);
  } else if (h0 !== undefined) {
    h = h0;
    N = nGiven ?? 10;
  } else if (xEnd !== undefined) {
    N = nGiven ?? 10;
    h = (xEnd - x0) / N;
  } else refuse('Give a step size (h = 0.1) and an end point (to x = 1) or a number of steps');
  if (!(N! > 0) || N! > 10000) refuse('Between 1 and 10,000 steps');
  const rows: string[][] = [];
  let x = x0;
  let y = y0!;
  const header = method === 'rk4' ? ['n', tv, 'y', 'k₁', 'k₂', 'k₃', 'k₄'] : method === 'euler' ? ['n', tv, 'y', `f(${tv}, y)`] : ['n', tv, 'y', 'k₁', 'k₂'];
  for (let n = 0; n < N!; n++) {
    if (method === 'euler') {
      const k = f(x, y);
      rows.push([String(n), fmt(x, 8), fmt(y, 10), fmt(k, 8)]);
      y += h! * k;
    } else if (method === 'heun') {
      const k1 = f(x, y);
      const k2 = f(x + h!, y + h! * k1);
      rows.push([String(n), fmt(x, 8), fmt(y, 10), fmt(k1, 8), fmt(k2, 8)]);
      y += (h! / 2) * (k1 + k2);
    } else if (method === 'midpoint') {
      const k1 = f(x, y);
      const k2 = f(x + h! / 2, y + (h! / 2) * k1);
      rows.push([String(n), fmt(x, 8), fmt(y, 10), fmt(k1, 8), fmt(k2, 8)]);
      y += h! * k2;
    } else {
      const k1 = f(x, y);
      const k2 = f(x + h! / 2, y + (h! / 2) * k1);
      const k3 = f(x + h! / 2, y + (h! / 2) * k2);
      const k4 = f(x + h!, y + h! * k3);
      rows.push([String(n), fmt(x, 8), fmt(y, 10), fmt(k1, 8), fmt(k2, 8), fmt(k3, 8), fmt(k4, 8)]);
      y += (h! / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
    }
    x = x0 + (n + 1) * h!;
    if (!Number.isFinite(y)) refuse(`The solution blows up near ${tv} = ${fmt(x)}`);
  }
  rows.push([String(N!), fmt(x, 8), fmt(y, 10), ...header.slice(3).map(() => '')]);
  const name = { euler: 'Euler’s method', heun: 'Improved Euler (Heun)', midpoint: 'Midpoint method', rk4: 'Runge–Kutta 4' }[method];
  const formula = {
    euler: 'yₙ₊₁ = yₙ + h·f(xₙ, yₙ) — local error O(h²), global O(h)',
    heun: 'yₙ₊₁ = yₙ + (h/2)(k₁ + k₂), k₂ = f(xₙ + h, yₙ + hk₁) — global error O(h²)',
    midpoint: 'yₙ₊₁ = yₙ + h·f(xₙ + h/2, yₙ + (h/2)k₁) — global error O(h²)',
    rk4: 'yₙ₊₁ = yₙ + (h/6)(k₁ + 2k₂ + 2k₃ + k₄) — global error O(h⁴)',
  }[method].replace(/x/g, tv);
  return answer(input, 'numeric', `${name} · ${tv === 't' ? 'dy/dt' : 'y′'} = ${text}, y(${fmt(x0)}) = ${fmt(y0!)}, h = ${fmt(h!)}`, `y(${fmt(x, 8)}) ≈ ${fmt(y, 10)}`, {
    value: y,
    lines: [
      { label: 'Steps', display: String(N!) },
      { label: 'Step size h', display: fmt(h!) },
    ],
    table: { columns: header, rows, caption: `${name} steps` },
    notes: [formula],
    exactness: 'numeric',
  });
}

// ─── Iterative linear solvers ───

/** "4x - y + z = 7, 4x - 8y + z = -21, -2x + y + 5z = 15" → A, b, variable names. */
export function parseLinearSystem(s: string): { A: number[][]; b: number[]; vars: string[] } | null {
  const eqs = s.split(/[,;]|\band\b/).map((e) => e.trim()).filter((e) => e.includes('='));
  if (eqs.length < 2) return null;
  const names = new Set<string>();
  for (const e of eqs) for (const m of e.matchAll(/(?<![a-z])([a-z](?:_?\d+)?)(?![a-z(])/gi)) names.add(m[1]!.toLowerCase());
  const vars = [...names].filter((v) => !/^e$/.test(v)).sort((p, q) => (/^[xyzw]$/.test(p) && /^[xyzw]$/.test(q) ? 'xyzw'.indexOf(p) - 'xyzw'.indexOf(q) : p.localeCompare(q, 'en', { numeric: true })));
  if (vars.length !== eqs.length) return null;
  const A: number[][] = [];
  const b: number[] = [];
  for (const e of eqs) {
    const [l, r] = e.split('=');
    const g = compile(`(${l}) - (${r})`, vars);
    const zero = vars.map(() => 0);
    const c0 = g(...zero);
    const row = vars.map((_, i) => g(...zero.map((_, j) => (j === i ? 1 : 0))) - c0);
    // Check linearity at a second point.
    const probe = vars.map((_, i) => i + 2);
    if (Math.abs(g(...probe) - (c0 + row.reduce((s, a, i) => s + a * probe[i]!, 0))) > 1e-9) return null;
    A.push(row);
    b.push(-c0);
  }
  return { A, b, vars };
}

function iterativeSolver(input: string): Result {
  const lc = input.toLowerCase();
  const method = /\bgauss[- ]seidel\b/.test(lc) ? 'gs' : /\bjacobi\b/.test(lc) && !/\bjacobian\b|eigen/.test(lc) ? 'jacobi' : /\bsor\b|successive over[- ]?relaxation/.test(lc) ? 'sor' : null;
  if (!method) return null;
  const body = input.replace(/^.*?(?:gauss[- ]seidel|jacobi|sor|successive over[- ]?relaxation)(?:\s+(?:method|iteration))?(?:\s+(?:on|for|to solve|solve))?\s*:?\s*/i, '');
  let sys = parseLinearSystem(body.replace(/\b(?:starting|tol\w*|omega|w\s*=)\b.*$/i, ''));
  if (!sys) {
    const mm = parseMatrix(body.replace(/\bb\s*=.*$/i, ''));
    const bb = /\bb\s*=\s*\[?([^\]]+)\]?/i.exec(body);
    if (mm && bb) sys = { A: mm, b: numbers(bb[1]!), vars: mm.map((_, i) => `x${i + 1}`) };
  }
  if (!sys) refuse('Give the equations, e.g. “jacobi 4x − y = 3, −x + 4y = 3”, or a matrix and b');
  const { A, b, vars } = sys!;
  const n = A.length;
  if (A.some((r) => r.length !== n) || b.length !== n) refuse('The system must be square');
  if (A.some((r, i) => r[i] === 0)) refuse('A diagonal coefficient is 0; reorder the equations so every diagonal entry is nonzero');
  const omega = method === 'sor' ? param(input, ['omega', 'ω', 'w'], 1.25)! : 1;
  const tol = tolerance(input, 1e-6).tol;
  const dominant = A.every((r, i) => Math.abs(r[i]!) >= r.reduce((s, a, j) => (j === i ? s : s + Math.abs(a)), 0));
  let x = new Array(n).fill(0) as number[];
  const rows: string[][] = [['0', ...x.map((v) => fmt(v, 8)), '—']];
  let it = 0;
  let conv = false;
  for (; it < 200; ) {
    it++;
    const nx = [...x];
    for (let i = 0; i < n; i++) {
      const src = method === 'jacobi' ? x : nx;
      const s = A[i]!.reduce((acc, a, j) => (j === i ? acc : acc + a * src[j]!), 0);
      const gs = (b[i]! - s) / A[i]![i]!;
      nx[i] = method === 'sor' ? (1 - omega) * x[i]! + omega * gs : gs;
    }
    const d = Math.max(...nx.map((v, i) => Math.abs(v - x[i]!)));
    x = nx;
    rows.push([String(it), ...x.map((v) => fmt(v, 8)), fmt(d, 3)]);
    if (!x.every(Number.isFinite) || d > 1e12) break;
    if (d < tol) {
      conv = true;
      break;
    }
  }
  const name = { jacobi: 'Jacobi iteration', gs: 'Gauss–Seidel iteration', sor: `SOR (ω = ${fmt(omega)})` }[method];
  const notes = [dominant ? 'The matrix is diagonally dominant, so the iteration is guaranteed to converge.' : 'The matrix is not diagonally dominant, so convergence isn’t guaranteed.'];
  notes.push(method === 'jacobi' ? 'Jacobi uses only the previous iterate: xᵢ⁽ᵏ⁺¹⁾ = (bᵢ − Σⱼ≠ᵢ aᵢⱼxⱼ⁽ᵏ⁾)/aᵢᵢ.' : 'Gauss–Seidel uses each new value as soon as it is computed, usually converging about twice as fast as Jacobi.');
  if (!conv) notes.unshift(`Did not converge in ${it} iterations.`);
  return answer(input, 'numeric', `${name} · ${n} equations, start at 0, stop when max|Δx| < ${fmt(tol)}`, vars.map((v, i) => `${v} ≈ ${fmt(x[i]!, 8)}`).join(', '), {
    lines: [{ label: 'Iterations', display: String(it) }],
    table: { columns: ['k', ...vars, 'max|Δ|'], rows, caption: `${name} iterates` },
    notes,
    exactness: 'numeric',
  });
}

// ─── Power method ───

function powerMethod(input: string): Result {
  if (!/\b(?:power (?:method|iteration)|dominant eigen\w*|von mises iteration)\b/i.test(input)) return null;
  const A = parseMatrix(input.replace(/^[^[\d−-]*/, ''));
  if (!A || A.some((r) => r.length !== A.length)) refuse('Give a square matrix, e.g. “power method [[2, 1], [1, 3]]”');
  const n = A!.length;
  let v = new Array(n).fill(1) as number[];
  let lam = 0;
  const rows: string[][] = [];
  let it = 0;
  for (; it < 500; it++) {
    const w = A!.map((r) => r.reduce((s, a, j) => s + a * v[j]!, 0));
    const k = w.reduce((m, x) => (Math.abs(x) > Math.abs(m) ? x : m), 0);
    if (k === 0) refuse('A·v = 0; pick a different matrix');
    const nv = w.map((x) => x / k);
    rows.push([String(it + 1), w.map((x) => fmt(x, 6)).join(', '), fmt(k, 10), nv.map((x) => fmt(x, 6)).join(', ')]);
    const done = Math.abs(k - lam) < 1e-10 && nv.every((x, i) => Math.abs(x - v[i]!) < 1e-9);
    lam = k;
    v = nv;
    if (done) break;
  }
  const norm = Math.hypot(...v);
  return answer(input, 'numeric', `Power method on a ${n}×${n} matrix, starting from (1, …, 1)`, `λ ≈ ${fmt(lam, 10)}`, {
    value: lam,
    lines: [
      { label: 'Dominant eigenvalue', display: fmt(lam, 10) },
      { label: 'Eigenvector (max entry 1)', display: `(${v.map((x) => fmt(x, 8)).join(', ')})` },
      { label: 'Unit eigenvector', display: `(${v.map((x) => fmt(x / norm, 8)).join(', ')})` },
      { label: 'Iterations', display: String(rows.length) },
    ],
    table: { columns: ['k', 'A·v', 'scale', 'v (scaled)'], rows: rows.slice(0, 60), caption: 'Power iterations' },
    notes: ['Repeated multiplication by A amplifies the component along the eigenvector with the largest |λ|; convergence rate is |λ₂/λ₁| per step.'],
    exactness: 'numeric',
  });
}

// ─── Floating point ───

function floatingPoint(input: string): Result {
  const lc = input.toLowerCase();
  if (/\bmachine epsilon\b|\bunit roundoff\b|\bε_?mach\b/.test(lc)) {
    const prec = /\b(?:single|float32|32[- ]bit|binary32)\b/.test(lc) ? 'single' : /\b(?:half|float16|16[- ]bit|binary16)\b/.test(lc) ? 'half' : 'double';
    const p = { single: 23, half: 10, double: 52 }[prec];
    const eps = 2 ** -p;
    return answer(input, 'numeric', `Machine epsilon, IEEE-754 ${prec} precision`, `2^−${p} ≈ ${fmt(eps, 8)}`, {
      value: eps,
      lines: [
        { label: 'Significand bits', display: `${p} stored + 1 implicit` },
        { label: 'Unit roundoff u = ε/2', display: `2^−${p + 1} ≈ ${fmt(eps / 2, 8)}` },
        { label: 'Decimal digits', display: `≈ ${fmt(p * Math.log10(2) + Math.log10(2), 3)}` },
      ],
      notes: ['ε is the gap between 1 and the next representable number: 1 + ε is the smallest float above 1. Rounding to nearest makes relative error at most ε/2.'],
    });
  }
  const m = /\b(?:ieee[- ]?754|float(?:ing[- ]point)?\s+(?:representation|bits)|binary32|binary64|float32|float64|single precision|double precision)\b/.exec(lc);
  if (m) {
    const num = /([-−]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)(?![\d.]*[- ]?bit)/i.exec(input.replace(/\b(?:ieee[- ]?754|binary(?:32|64)|float(?:32|64))\b/gi, ''));
    if (!num) return null;
    const x = Number(num[1]!.replace('−', '-'));
    const single = /\b(?:single|float32|32[- ]bit|binary32)\b/.test(lc);
    const bits = single ? 32 : 64;
    const buf = new DataView(new ArrayBuffer(8));
    let bin = '';
    let stored: number;
    if (single) {
      buf.setFloat32(0, x);
      bin = buf.getUint32(0).toString(2).padStart(32, '0');
      stored = buf.getFloat32(0);
    } else {
      buf.setFloat64(0, x);
      bin = buf.getBigUint64(0).toString(2).padStart(64, '0');
      stored = x;
    }
    const eb = single ? 8 : 11;
    const bias = single ? 127 : 1023;
    const sign = bin[0]!;
    const exp = bin.slice(1, 1 + eb);
    const man = bin.slice(1 + eb);
    const e = parseInt(exp, 2);
    const hex = BigInt('0b' + bin).toString(16).toUpperCase().padStart(bits / 4, '0');
    const kind = e === 0 ? (/^0+$/.test(man) ? 'zero' : 'subnormal') : e === 2 ** eb - 1 ? (/^0+$/.test(man) ? 'infinity' : 'NaN') : 'normal';
    const exactStored = exactDecimal(stored);
    const lines: Line[] = [
      { label: 'Sign', display: `${sign} (${sign === '1' ? 'negative' : 'positive'})` },
      { label: 'Exponent', display: `${exp} = ${e}${kind === 'normal' ? ` → 2^(${e} − ${bias}) = 2^${e - bias}` : ` (${kind})`}` },
      { label: 'Mantissa', display: man },
      { label: 'Hex', display: `0x${hex}` },
      { label: 'Stored value', display: exactStored },
      { label: 'Rounding error', display: roundingError(exactStored, num[1]!.replace('−', '-'), stored - x) },
    ];
    return answer(input, 'numeric', `IEEE-754 ${single ? 'single (32-bit)' : 'double (64-bit)'} representation of ${num[1]}`, `${sign} ${exp} ${man.length > 30 ? man.slice(0, 23) + '…' : man}`, {
      lines,
      notes: [kind === 'normal' ? `Value = (−1)^s × 1.mantissa₂ × 2^(e − ${bias}).` : `This is a ${kind} encoding.`, ...(exactStored !== String(x) && !exactStored.startsWith(String(x)) ? [`${num[1]} has no exact binary representation, so the nearest ${single ? 'single' : 'double'} is stored.`] : [])],
      spoken: `sign ${sign}, exponent ${exp}`,
    });
  }
  if (/\bcondition number\b/.test(lc)) {
    const A = parseMatrix(input.replace(/^[^[]*?(?=\[|\d)/, ''));
    if (A && A.length === A[0]!.length && A.length <= 8) {
      const inf = (M: number[][]) => Math.max(...M.map((r) => r.reduce((s, x) => s + Math.abs(x), 0)));
      const one = (M: number[][]) => Math.max(...M[0]!.map((_, j) => M.reduce((s, r) => s + Math.abs(r[j]!), 0)));
      const inv = invert(A);
      if (!inv) return answer(input, 'numeric', 'Condition number', '∞', { notes: ['The matrix is singular, so its condition number is infinite.'] });
      const sv = singularValues(A);
      const k2 = sv[0]! / sv[sv.length - 1]!;
      return answer(input, 'numeric', `Condition number of a ${A.length}×${A.length} matrix`, `κ₂ ≈ ${fmt(k2, 8)}`, {
        value: k2,
        lines: [
          { label: 'κ₂ = σmax/σmin', display: fmt(k2, 8) },
          { label: 'κ₁', display: fmt(one(A) * one(inv), 8) },
          { label: 'κ∞', display: fmt(inf(A) * inf(inv), 8) },
          { label: 'Singular values', display: sv.map((s) => fmt(s, 8)).join(', ') },
        ],
        notes: [`Solving Ax = b can lose about log₁₀ κ ≈ ${fmt(Math.log10(k2), 3)} decimal digits of accuracy.`],
      });
    }
    const fm = /condition number of\s+(?:f\(x\)\s*=\s*)?(.+?)\s+at\s+(?:x\s*=\s*)?([-−]?[\d.]+)/i.exec(input);
    if (fm) {
      const f = compile(fm[1]!);
      const x = Number(fm[2]!.replace('−', '-'));
      const k = Math.abs((x * deriv(f, x)) / f(x));
      return answer(input, 'numeric', `Relative condition number of f(x) = ${fm[1]} at x = ${fmt(x)}`, `κ ≈ ${fmt(k, 8)}`, { value: k, lines: [{ label: 'Formula', display: '|x·f′(x)/f(x)|' }], notes: ['A relative error δ in x becomes roughly κ·δ in f(x).'] });
    }
    return null;
  }
  if (/\b(?:rounding|round-?off|floating[- ]point) error\b/.test(lc) || /\bin floating point\b/.test(lc)) {
    const expr = /(?:error(?:\s+(?:of|in|for))?|floating point)\s+(.+)$/i.exec(input.replace(/\bin floating point\b/i, ''))?.[1] ?? input.replace(/\bin floating point\b.*/i, '');
    const t = expr.replace(/[^\d.+\-*/() e]/gi, '').trim();
    if (!/^[\d.+\-*/() e]+$/.test(t) || !/\d/.test(t)) {
      return answer(input, 'numeric', 'Rounding error in floating point', '0.1 + 0.2 = 0.30000000000000004', { notes: ['0.1 and 0.2 have no exact binary form; each is rounded to the nearest double, and the rounded sum differs from 0.3 by 2^−54 ≈ 5.55e-17.'] });
    }
    const v = Function(`"use strict";return (${t})`)() as number;
    const exact = exactRational(t);
    return answer(input, 'numeric', `${t} in IEEE-754 double precision`, String(v), {
      lines: [
        { label: 'Double result', display: String(v) },
        { label: 'Exact decimal result', display: exact ?? '—' },
        { label: 'Stored exactly', display: exactDecimal(v) },
      ],
      notes: ['Every intermediate value is rounded to 53 significant bits, so decimal fractions like 0.1 pick up tiny errors.'],
    });
  }
  return null;
}

function roundingError(stored: string, given: string, fallback: number): string {
  if (/e/i.test(given)) return fmt(fallback, 4);
  const neg = given.startsWith('-');
  const d = exactRational(`${stored.replace(/^-/, '')} - ${given.replace(/^-/, '')}`);
  if (d === null) return fmt(fallback, 4);
  const v = Number(d) * (neg ? -1 : 1);
  return v === 0 ? '0 (exactly representable)' : fmt(v, 4);
}

function exactRational(t: string): string | null {
  // Only + and − of decimal literals: compute exactly with scaled BigInts.
  if (!/^[\d.+\-\s]+$/.test(t)) return null;
  const parts = t.match(/[+-]?\s*[\d.]+/g);
  if (!parts) return null;
  const scale = Math.max(...parts.map((p) => (p.split('.')[1] ?? '').length));
  let total = 0n;
  for (const p of parts) {
    const c = p.replace(/\s/g, '');
    const neg = c.startsWith('-');
    const [i, f = ''] = c.replace(/^[+-]/, '').split('.');
    const v = BigInt((i || '0') + f.padEnd(scale, '0'));
    total += neg ? -v : v;
  }
  const s = (total < 0n ? -total : total).toString().padStart(scale + 1, '0');
  const out = scale ? `${s.slice(0, -scale)}.${s.slice(-scale)}`.replace(/\.?0+$/, '') : s;
  return (total < 0n ? '-' : '') + out;
}

/** The exact decimal expansion of a double (every double is a dyadic rational). */
export function exactDecimal(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  if (Number.isInteger(x)) return BigInt(x).toString();
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const bits = buf.getBigUint64(0);
  const neg = bits >> 63n === 1n;
  const e = Number((bits >> 52n) & 0x7ffn);
  let m = bits & ((1n << 52n) - 1n);
  let exp: number;
  if (e === 0) exp = -1074;
  else {
    m |= 1n << 52n;
    exp = e - 1075;
  }
  // x = m × 2^exp, exp < 0 → m × 5^(−exp) / 10^(−exp)
  const k = -exp;
  const digits = (m * 5n ** BigInt(k)).toString().padStart(k + 1, '0');
  const s = `${digits.slice(0, -k)}.${digits.slice(-k)}`.replace(/0+$/, '');
  return (neg ? '-' : '') + s;
}

export function invert(A: number[][]): number[][] | null {
  const n = A.length;
  const M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    if (Math.abs(M[p]![c]!) < 1e-14) return null;
    [M[c], M[p]] = [M[p]!, M[c]!];
    const piv = M[c]![c]!;
    M[c] = M[c]!.map((x) => x / piv);
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]!;
      M[r] = M[r]!.map((x, j) => x - f * M[c]![j]!);
    }
  }
  return M.map((r) => r.slice(n));
}

/** Eigenvalues of a symmetric matrix (cyclic Jacobi), descending. */
export function symEigen(S: number[][]): { values: number[]; vectors: number[][] } {
  const n = S.length;
  const A = S.map((r) => [...r]);
  const V: number[][] = A.map((_, i) => A.map((_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i]![j]! ** 2;
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p]![q]!) < 1e-300) continue;
        const theta = (A[q]![q]! - A[p]![p]!) / (2 * A[p]![q]!);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k]![p]!;
          const akq = A[k]![q]!;
          A[k]![p] = c * akp - s * akq;
          A[k]![q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p]![k]!;
          const aqk = A[q]![k]!;
          A[p]![k] = c * apk - s * aqk;
          A[q]![k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k]![p]!;
          const vkq = V[k]![q]!;
          V[k]![p] = c * vkp - s * vkq;
          V[k]![q] = s * vkp + c * vkq;
        }
      }
  }
  const idx = A.map((_, i) => i).sort((a, b) => A[b]![b]! - A[a]![a]!);
  return { values: idx.map((i) => A[i]![i]!), vectors: idx.map((i) => V.map((r) => r[i]!)) };
}

function singularValues(A: number[][]): number[] {
  const n = A.length;
  const AtA = A[0]!.map((_, i) => A[0]!.map((_, j) => A.reduce((s, r) => s + r[i]! * r[j]!, 0)));
  void n;
  return symEigen(AtA).values.map((v) => Math.sqrt(Math.max(0, v)));
}

function errorAnalysis(input: string): Result {
  const m = /\b(?:absolute and relative error|relative error|absolute error|percent(?:age)? error)\b/i.exec(input);
  if (!m) return null;
  const approx = param(input, ['approximation', 'approx', 'measured', 'estimate', 'approximate value', 'experimental']);
  const truth = param(input, ['true value', 'true', 'exact', 'actual', 'accepted', 'theoretical']);
  let a = approx;
  let t = truth;
  if (a === undefined || t === undefined) {
    const mm = /([-−]?[\d.]+)\s+(?:approximat\w*|as an approximation (?:of|to)|for|vs\.?|versus)\s+([-−]?[\d.]+|pi|π|e|sqrt\s*\(?\s*\d+\s*\)?)/i.exec(input);
    if (!mm) return null;
    a = Number(mm[1]!.replace('−', '-'));
    const tt = mm[2]!.toLowerCase();
    t = tt === 'pi' || tt === 'π' ? Math.PI : tt === 'e' ? Math.E : tt.startsWith('sqrt') ? Math.sqrt(numbers(tt)[0]!) : Number(tt.replace('−', '-'));
  }
  const abs = Math.abs(a - t);
  const rel = abs / Math.abs(t);
  const sig = rel > 0 ? Math.floor(-Math.log10(2 * rel)) : Infinity;
  return answer(input, 'numeric', `Error of ${fmt(a, 10)} approximating ${fmt(t, 12)}`, `relative error ≈ ${fmt(rel, 4)}`, {
    value: rel,
    lines: [
      { label: 'Absolute error', display: fmt(abs, 6) },
      { label: 'Relative error', display: fmt(rel, 6) },
      { label: 'Percent error', display: `${fmt(rel * 100, 4)}%` },
      { label: 'Correct significant digits', display: Number.isFinite(sig) ? `≈ ${Math.max(0, sig)}` : 'all' },
    ],
  });
}

export const numericHandlers = [rootFinding, quadrature, odeSolver, interpolation, numDiff, iterativeSolver, powerMethod, floatingPoint, errorAnalysis];
