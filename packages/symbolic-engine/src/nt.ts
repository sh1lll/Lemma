import { D, MathError, type Answer, type AnswerResult, type Dec } from "@lemma/math-core";
import { factorize, isPrime } from './numtheory';

/**
 * Native (BigInt) number theory, counting, sets and small finite groups: modular inverses, the Chinese remainder
 * theorem, linear congruences and Diophantine equations, Pell equations, orders and primitive roots, Legendre
 * symbols, continued fractions, famous sequences, Collatz, digit sums, prime counting, permutations and cycles,
 * Z_n / U(n) / S_n / D_n, set operations and Venn counts, plus short honest explanations of conceptual questions.
 */

type Out = Omit<Answer, 'ok' | 'input' | 'kind' | 'notes'> & { notes?: string[] };
const ok = (input: string, a: Out): Answer => ({ ok: true, kind: 'number-theory', input, notes: [], ...a });
const fail = (input: string, msg: string): AnswerResult => ({ ok: false, kind: 'number-theory', input, error: new MathError('domain', msg) });
const P = (display: string, value?: bigint | number | string) => ({ display: display.replace(/(^|[\s(,])-/g, '$1−'), plain: value !== undefined ? String(value) : display, spoken: display });
const val = (v: bigint | number) => new D(v.toString());

const abs = (a: bigint) => (a < 0n ? -a : a);
const mod = (a: bigint, m: bigint) => ((a % m) + m) % m;
function gcd(a: bigint, b: bigint): bigint {
  a = abs(a);
  b = abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}
const lcm = (a: bigint, b: bigint) => (a && b ? abs(a * b) / gcd(a, b) : 0n);

/** Extended Euclid: [g, x, y] with a·x + b·y = g, plus the division steps. */
function egcd(a: bigint, b: bigint): { g: bigint; x: bigint; y: bigint; steps: string[] } {
  const steps: string[] = [];
  let [r0, r1, s0, s1, t0, t1] = [a, b, 1n, 0n, 0n, 1n];
  while (r1) {
    const q = r0 / r1;
    steps.push(`${r0} = ${q}·${r1} + ${r0 - q * r1}`);
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
    [t0, t1] = [t1, t0 - q * t1];
  }
  return { g: r0, x: s0, y: t0, steps };
}

function modpow(b: bigint, e: bigint, m: bigint): bigint {
  let r = 1n;
  b = mod(b, m);
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
}

function totient(n: bigint): bigint {
  let r = n;
  for (const p of factorize(n).keys()) r = (r / p) * (p - 1n);
  return r;
}

function order(a: bigint, n: bigint): bigint | null {
  if (gcd(a, n) !== 1n) return null;
  const phi = totient(n);
  let best = phi;
  for (const p of factorize(phi).keys()) while (best % p === 0n && modpow(a, best / p, n) === 1n) best /= p;
  return best;
}

function legendre(a: bigint, p: bigint): number {
  const r = modpow(a, (p - 1n) / 2n, p);
  return r === 0n ? 0 : r === 1n ? 1 : -1;
}

function jacobi(a: bigint, n: bigint): number {
  a = mod(a, n);
  let t = 1;
  while (a) {
    while (a % 2n === 0n) {
      a /= 2n;
      const r = n % 8n;
      if (r === 3n || r === 5n) t = -t;
    }
    [a, n] = [n, a];
    if (a % 4n === 3n && n % 4n === 3n) t = -t;
    a %= n;
  }
  return n === 1n ? t : 0;
}

const SUB = (n: number | bigint) => String(n).replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[Number(d)]!);

function sqrtFloor(n: bigint): bigint {
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x * x > n) x--;
  while ((x + 1n) * (x + 1n) <= n) x++;
  return x;
}

/** Continued fraction of √n: [a0; period]. */
function cfSqrt(n: bigint): { a0: bigint; period: bigint[] } | null {
  const a0 = sqrtFloor(n);
  if (a0 * a0 === n) return null;
  let [m, d, a] = [0n, 1n, a0];
  const period: bigint[] = [];
  do {
    m = d * a - m;
    d = (n - m * m) / d;
    a = (a0 + m) / d;
    period.push(a);
  } while (a !== 2n * a0 && period.length < 500);
  return { a0, period };
}

function cfRational(p: bigint, q: bigint): bigint[] {
  const out: bigint[] = [];
  while (q) {
    let a = p / q;
    if (mod(p, q) !== 0n && p < 0n) a -= 1n;
    out.push(a);
    [p, q] = [q, p - a * q];
  }
  return out;
}

function convergents(terms: bigint[]): string[] {
  let [h0, h1, k0, k1] = [0n, 1n, 1n, 0n];
  const out: string[] = [];
  for (const a of terms) {
    [h0, h1] = [h1, a * h1 + h0];
    [k0, k1] = [k1, a * k1 + k0];
    out.push(k1 === 1n ? `${h1}` : `${h1}/${k1}`);
  }
  return out;
}

function fib(n: number): [bigint, bigint] {
  // [F(n), F(n+1)] by fast doubling
  if (n === 0) return [0n, 1n];
  const [a, b] = fib(Math.floor(n / 2));
  const c = a * (2n * b - a);
  const d = a * a + b * b;
  return n % 2 ? [d, c + d] : [c, d];
}

function factorial(n: number): bigint {
  let r = 1n;
  for (let k = 2n; k <= BigInt(n); k++) r *= k;
  return r;
}
const binom = (n: bigint, k: bigint): bigint => {
  if (k < 0n || k > n) return 0n;
  if (k > n - k) k = n - k;
  let r = 1n;
  for (let i = 1n; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
};

const big = (s: string) => BigInt(s.replace(/[,_\s]/g, ''));
const shortBig = (n: bigint) => {
  const s = n.toString();
  return s.length > 60 ? `${s.slice(0, 25)}…${s.slice(-25)} (${s.length} digits)` : s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

/** Elements of a set literal "{1, 2, a}" (numbers or short words), keeping first-seen order. */
function setOf(t: string): string[] | null {
  const m = /^\{\s*(.*?)\s*\}$/.exec(t.trim());
  if (!m) return null;
  if (!m[1]) return [];
  const items = m[1].split(/\s*,\s*/).map((x) => x.trim());
  if (items.some((x) => !/^-?[\w.]+$/.test(x))) return null;
  return [...new Set(items)];
}
const showSet = (xs: string[]) => (xs.length ? `{${xs.join(', ')}}` : '∅');
const sortSet = (xs: string[]) => [...xs].sort((a, b) => (Number.isFinite(Number(a)) && Number.isFinite(Number(b)) ? Number(a) - Number(b) : a < b ? -1 : 1));

const CONCEPTS: [RegExp, string, string[]][] = [
  [/g[öo]del'?s?(?: incompleteness)?(?: theorems?)?/i, 'Any consistent formal system strong enough for basic arithmetic has true statements it cannot prove (first theorem), and cannot prove its own consistency (second).', ['Example: the Gödel sentence “this statement is not provable in system S” is true but unprovable in S, if S is consistent.', 'A theorem about formal systems; there is nothing to compute.']],
  [/continuum hypothesis/i, 'The continuum hypothesis says there is no set whose size is strictly between the integers (ℵ₀) and the real numbers (2^ℵ₀).', ['Gödel (1940) and Cohen (1963) showed it can be neither proved nor disproved from the usual ZFC axioms.']],
  [/axiom of choice/i, 'The axiom of choice: from any collection of non-empty sets you can pick one element from each.', ['It is independent of ZF. It implies that every vector space has a basis, and also the Banach–Tarski paradox.']],
  [/halting problem/i, 'No algorithm can decide, for every program and input, whether the program eventually stops (Turing, 1936).', ['Proof idea: diagonalisation. A supposed decider could be used to build a program that halts exactly when the decider says it does not.']],
  [/riemann hypothesis/i, 'The Riemann hypothesis (open): every non-trivial zero of ζ(s) has real part 1/2.', ['It is unsolved, and one of the Millennium Prize Problems. Checked numerically for more than 10¹³ zeros.']],
  [/goldbach/i, 'Goldbach’s conjecture (open): every even number greater than 2 is the sum of two primes.', ['Verified up to 4×10¹⁸, but not proved. Example: 28 = 5 + 23 = 11 + 17.']],
  [/twin prime/i, 'Twin prime conjecture (open): there are infinitely many primes p with p + 2 also prime.', ['Zhang (2013) and later work proved there are infinitely many prime gaps of at most 246.']],
  [/collatz conjecture/i, 'Collatz conjecture (open): repeating n → n/2 (n even) or 3n + 1 (n odd) always reaches 1.', ['Try “collatz 27” to see the steps for one starting number.']],
  [/p\s*(?:vs\.?|versus|=)\s*np/i, 'P vs NP (open): can every problem whose solution can be checked quickly also be solved quickly?', ['Most researchers believe P ≠ NP. It is a Millennium Prize Problem.']],
  [/fermat'?s last theorem/i, 'Fermat’s Last Theorem: xⁿ + yⁿ = zⁿ has no positive integer solutions for n > 2. Andrew Wiles proved it in 1994.', ['For n = 2 there are infinitely many solutions (Pythagorean triples such as 3, 4, 5).']],
  [/(?:is |are )?(?:the )?rationals? countable|countab(?:le|ility) of (?:the )?rationals/i, 'Yes. The rational numbers are countable: list p/q by increasing |p| + q (Cantor’s zig-zag).', ['|ℚ| = ℵ₀, the same size as ℕ.']],
  [/(?:are |is )?(?:the )?reals? (?:numbers )?countable|cardinality of (?:the )?reals|uncountab/i, 'No. The real numbers are uncountable (Cantor’s diagonal argument): |ℝ| = 2^ℵ₀ > ℵ₀.', ['Any list of reals misses the number whose nth digit differs from the nth digit of the nth number.']],
  [/what is (?:a |the )?(?:proof by )?induction|mathematical induction/i, 'Proof by induction: show P(1) is true, and that P(k) implies P(k+1). Then P(n) holds for every n ≥ 1.', ['Example: 1 + 2 + … + n = n(n+1)/2. The step adds k + 1 to k(k+1)/2 to get (k+1)(k+2)/2. Type “sum of k for k = 1 to n” to check the formula.']],
  [/zfc|zermelo/i, 'ZFC: Zermelo–Fraenkel set theory with the axiom of choice, the standard foundation of mathematics.', ['Its axioms include extensionality, pairing, union, power set, infinity, separation, replacement, foundation and choice.']],
  [/banach[- ]tarski/i, 'Banach–Tarski: using the axiom of choice, a solid ball can be cut into finitely many pieces and reassembled into two balls of the same size.', ['The pieces are non-measurable, so “volume” isn’t defined for them.']],
];

export function answerNumberExtras(input: string): AnswerResult | null {
  const s = input
    .trim()
    .replace(/[?!.]+$/, '')
    .replace(/[−–]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^(?:(?:what(?:'s| is| are)|find|calculate|compute|determine|give me|show me|list|tell me|explain)\s+)+(?:the\s+)?/i, '');
  let m: RegExpExecArray | null;

  // Modular inverse
  m = /^(?:modular |multiplicative )?inverse of (-?\d+) (?:mod(?:ulo)?|\(mod) (\d+)\)?$/i.exec(s) ?? /^(-?\d+)\s*\^\s*\(?-1\)?\s*(?:mod|\(mod)\s*(\d+)\)?$/i.exec(s);
  if (m) {
    const a = big(m[1]!);
    const n = big(m[2]!);
    const e = egcd(mod(a, n), n);
    if (e.g !== 1n) return fail(input, `${a} has no inverse mod ${n}: gcd(${a}, ${n}) = ${e.g}`);
    const inv = mod(e.x, n);
    return ok(input, { expression: `${a}⁻¹ mod ${n}`, primary: P(`${inv}`, inv), value: val(inv), lines: [{ label: 'Check', display: `${a} × ${inv} = ${a * inv} ≡ 1 (mod ${n})` }, { label: 'Extended Euclid', display: e.steps.slice(0, 8).join('; ') }] });
  }

  // Chinese remainder theorem
  const congr = [...s.matchAll(/(?:x\s*(?:≡|=|==|is congruent to)\s*)?(-?\d+)\s*(?:\(?\s*mod(?:ulo)?\s*(\d+)\s*\)?)/gi)];
  if (/≡|chinese remainder|crt|congruen|(?:,| and ).*mod/i.test(s) && congr.length >= 2 && !/\^|inverse|\bx\s*\d/.test(s.replace(/x\s*(?:≡|=)/g, ''))) {
    let x = 0n;
    let M = 1n;
    const rows: string[] = [];
    for (const c of congr) {
      const a = big(c[1]!);
      const n = big(c[2]!);
      const g = gcd(M, n);
      if (mod(a - x, g) !== 0n) return fail(input, `No solution: x ≡ ${a} (mod ${n}) contradicts the earlier congruences`);
      const e = egcd(M / g, n / g);
      const k = mod(((a - x) / g) * e.x, n / g);
      x = mod(x + M * k, (M * n) / g);
      M = (M * n) / g;
      rows.push(`x ≡ ${mod(a, n)} (mod ${n})`);
    }
    return ok(input, { expression: `Solve ${rows.join(', ')}`, primary: P(`x ≡ ${x} (mod ${M})`, x), value: val(x), lines: [{ label: 'Smallest positive', display: `${x === 0n ? M : x}` }, { label: 'All solutions', display: `x = ${x} + ${M}k` }, { label: 'Check', display: congr.map((c) => `${x} mod ${c[2]} = ${mod(x, big(c[2]!))}`).join(', ') }], notes: ['Chinese remainder theorem'] });
  }

  // Linear congruence a·x ≡ b (mod n)
  m = /^(?:solve )?(-?\d*)\s*\*?\s*x\s*(?:≡|=|==)\s*(-?\d+)\s*\(?\s*mod(?:ulo)?\s*(\d+)\s*\)?$/i.exec(s);
  if (m) {
    const a = big(m[1] === '' ? '1' : m[1] === '-' ? '-1' : m[1]!);
    const b = big(m[2]!);
    const n = big(m[3]!);
    const g = gcd(a, n);
    if (mod(b, g) !== 0n) return ok(input, { expression: `${a}x ≡ ${b} (mod ${n})`, primary: P('No solution'), notes: [`gcd(${a}, ${n}) = ${g} does not divide ${b}`] });
    const e = egcd(mod(a / g, n / g), n / g);
    const x0 = mod((b / g) * e.x, n / g);
    const sols = Array.from({ length: Number(g < 20n ? g : 20n) }, (_, i) => x0 + BigInt(i) * (n / g));
    return ok(input, { expression: `${a}x ≡ ${b} (mod ${n})`, primary: P(g === 1n ? `x ≡ ${x0} (mod ${n})` : `x ≡ ${x0} (mod ${n / g})`, x0), value: val(x0), lines: [{ label: `Solutions mod ${n}`, display: sols.join(', ') }], notes: g > 1n ? [`${g} solutions modulo ${n}`] : [] });
  }

  // Linear Diophantine a·x + b·y = c in integers
  m = /^(?:solve |integer solutions? (?:of|to) |find integers? (?:x,? y )?(?:with |such that )?)?(-?\d*)\s*\*?\s*x\s*([+-])\s*(\d*)\s*\*?\s*y\s*=\s*(-?\d+)(?: (?:in|over) (?:the )?integers| for integers?(?: x,? y)?)?$/i.exec(s);
  if (m && /integer|diophant/i.test(input)) {
    const a = big(m[1] === '' ? '1' : m[1] === '-' ? '-1' : m[1]!);
    const b = big(m[3] === '' ? '1' : m[3]!) * (m[2] === '-' ? -1n : 1n);
    const c = big(m[4]!);
    const e = egcd(a, b);
    if (mod(c, abs(e.g)) !== 0n) return ok(input, { expression: `${a}x + ${b}y = ${c} in integers`, primary: P('No integer solutions'), notes: [`gcd(${a}, ${b}) = ${abs(e.g)} does not divide ${c}`] });
    const k = c / e.g;
    const [x0, y0] = [e.x * k, e.y * k];
    const g = e.g;
    return ok(input, { expression: `${a}x + ${b}y = ${c} in integers`, primary: P(`x = ${x0} + ${b / g}t, y = ${y0} − ${a / g}t (t ∈ ℤ)`.replace(/\+ -/g, '− ').replace(/− -/g, '+ ')), lines: [{ label: 'Particular solution', display: `x = ${x0}, y = ${y0}` }, { label: 'Check', display: `${a}·${x0} + ${b}·${y0} = ${a * x0 + b * y0}` }], notes: ['Extended Euclidean algorithm'] });
  }

  // Pell equations x² − n·y² = 1
  m = /^(?:solve |pell(?:'s)? equation )?x\s*\^?\s*2\s*-\s*(\d+)\s*\*?\s*y\s*\^?\s*2\s*=\s*1(?: in (?:positive )?integers)?$/i.exec(s.replace(/²/g, '^2'));
  if (m && (/pell|integer/i.test(input))) {
    const n = big(m[1]!);
    const cf = cfSqrt(n);
    if (!cf) return fail(input, `${n} is a perfect square, so x² − ${n}y² = 1 has only the trivial solutions`);
    const terms = [cf.a0, ...cf.period];
    const reps = cf.period.length % 2 ? 2 : 1;
    const full = [cf.a0, ...Array.from({ length: reps }, () => cf.period).flat()];
    let [h0, h1, k0, k1] = [1n, cf.a0, 0n, 1n];
    for (const a of full.slice(1)) {
      if (h1 * h1 - n * k1 * k1 === 1n) break;
      [h0, h1] = [h1, a * h1 + h0];
      [k0, k1] = [k1, a * k1 + k0];
    }
    void terms;
    return ok(input, { expression: `Pell equation x² − ${n}y² = 1`, primary: P(`x = ${h1}, y = ${k1}`), lines: [{ label: 'Continued fraction of √' + n, display: `[${cf.a0}; (${cf.period.join(', ')})]` }, { label: 'All solutions', display: `xₖ + yₖ√${n} = (${h1} + ${k1}√${n})ᵏ` }], notes: ['Fundamental solution from the continued fraction of √' + n] });
  }

  // Multiplicative order, primitive roots, quadratic residues, Legendre/Jacobi symbols
  m = /^(?:the )?(?:multiplicative )?order of (\d+) (?:mod(?:ulo)?|in \(?z\/(\d+)z\)?\*?|in u\((\d+)\)) ?(\d+)?$/i.exec(s);
  if (m) {
    const a = big(m[1]!);
    const n = big(m[2] ?? m[3] ?? m[4]!);
    const o = order(a, n);
    if (o === null) return fail(input, `${a} is not invertible mod ${n} (gcd ≠ 1), so it has no multiplicative order`);
    return ok(input, { expression: `Order of ${a} mod ${n}`, primary: P(`${o}`, o), value: val(o), lines: [{ label: 'Check', display: `${a}^${o} ≡ 1 (mod ${n})` }, { label: 'φ(' + n + ')', display: `${totient(n)}` }], notes: [o === totient(n) ? `${a} is a primitive root mod ${n}` : `The order divides φ(${n})`] });
  }
  m = /^(?:all |the )?primitive roots? (?:of|mod(?:ulo)?) (\d+)$/i.exec(s);
  if (m) {
    const n = big(m[1]!);
    const phi = totient(n);
    const roots: bigint[] = [];
    for (let g = 1n; g < n && roots.length < 30; g++) if (order(g, n) === phi) roots.push(g);
    if (!roots.length) return ok(input, { expression: `Primitive roots mod ${n}`, primary: P('None'), notes: ['Primitive roots exist only for n = 1, 2, 4, pᵏ and 2pᵏ (p an odd prime)'] });
    return ok(input, { expression: `Primitive roots mod ${n}`, primary: P(roots.join(', ')), lines: [{ label: 'Smallest', display: `${roots[0]}` }, { label: 'How many', display: `φ(φ(${n})) = ${totient(phi)}` }] });
  }
  m = /^(?:the )?quadratic residues (?:mod(?:ulo)?|of) (\d+)$/i.exec(s);
  if (m) {
    const n = big(m[1]!);
    const rs = [...new Set(Array.from({ length: Number(n) }, (_, i) => mod(BigInt(i) * BigInt(i), n)))].filter((x) => x !== 0n).sort((a, b) => Number(a - b));
    return ok(input, { expression: `Quadratic residues mod ${n}`, primary: P(rs.join(', ')), notes: ['Nonzero squares modulo n'] });
  }
  m = /^is (-?\d+) a quadratic residue (?:mod(?:ulo)?|of) (\d+)$/i.exec(s);
  if (m) {
    const a = big(m[1]!);
    const n = big(m[2]!);
    const yes = Array.from({ length: Number(n) }, (_, i) => mod(BigInt(i) * BigInt(i), n)).includes(mod(a, n));
    return ok(input, { expression: `Is ${a} a square mod ${n}?`, primary: P(yes ? 'Yes' : 'No'), lines: isPrime(n) && n > 2n ? [{ label: `Legendre (${a}/${n})`, display: `${legendre(a, n)}` }] : [] });
  }
  m = /^(?:the )?(legendre|jacobi)(?: symbol)? \(?\s*(-?\d+)\s*(?:\/|\|)\s*(\d+)\s*\)?$/i.exec(s);
  if (m) {
    const a = big(m[2]!);
    const n = big(m[3]!);
    if (n % 2n === 0n) return fail(input, 'The bottom number must be odd');
    const isL = /legendre/i.test(m[1]!);
    if (isL && !isPrime(n)) return fail(input, `${n} isn't prime; use the Jacobi symbol`);
    const v = isL ? legendre(a, n) : jacobi(a, n);
    return ok(input, { expression: `(${a}/${n})`, primary: P(`${v}`, v), value: val(v), notes: [isL ? (v === 1 ? `${a} is a quadratic residue mod ${n}` : v === -1 ? `${a} is a non-residue mod ${n}` : `${n} divides ${a}`) : 'Jacobi symbol (product of Legendre symbols over the prime factors)'] });
  }

  // Continued fractions
  m = /^(?:the )?(?:simple )?continued fraction (?:of|for|expansion of) (.+)$/i.exec(s);
  if (m) {
    const t = m[1]!.trim();
    let q: RegExpExecArray | null;
    if ((q = /^(-?\d+)\s*\/\s*(\d+)$/.exec(t)) || (q = /^(-?\d+(?:\.\d+)?)$/.exec(t))) {
      let p: bigint;
      let d: bigint;
      if (q[2]) [p, d] = [big(q[1]!), big(q[2])];
      else {
        const [n0, d0] = new D(q[1]!).toFraction() as [Dec, Dec];
        [p, d] = [big(n0.toFixed()), big(d0.toFixed())];
      }
      const cf = cfRational(p, d);
      return ok(input, { expression: `Continued fraction of ${t}`, primary: P(`[${cf[0]}; ${cf.slice(1).join(', ')}]`), lines: [{ label: 'Convergents', display: convergents(cf).join(', ') }] });
    }
    if ((q = /^(?:sqrt|√)\s*\(?\s*(\d+)\s*\)?$/.exec(t))) {
      const cf = cfSqrt(big(q[1]!));
      if (!cf) return ok(input, { expression: `Continued fraction of √${q[1]}`, primary: P(`[${sqrtFloor(big(q[1]!))}]`), notes: ['A perfect square'] });
      return ok(input, { expression: `Continued fraction of √${q[1]}`, primary: P(`[${cf.a0}; (${cf.period.join(', ')})]`), lines: [{ label: 'Period length', display: `${cf.period.length}` }, { label: 'Convergents', display: convergents([cf.a0, ...cf.period, ...cf.period].slice(0, 8)).join(', ') }], notes: ['The bracketed part repeats forever'] });
    }
    const consts: Record<string, string> = { pi: '3.14159265358979323846264338327950288419716939937510', π: '3.14159265358979323846264338327950288419716939937510', e: '2.71828182845904523536028747135266249775724709369995', phi: '1.61803398874989484820458683436563811772030917980576', 'golden ratio': '1.61803398874989484820458683436563811772030917980576' };
    const c = consts[t.toLowerCase()];
    if (c) {
      const [n0, d0] = new D(c).toFraction() as [Dec, Dec];
      const cf = cfRational(big(n0.toFixed()), big(d0.toFixed())).slice(0, 15);
      return ok(input, { expression: `Continued fraction of ${t}`, primary: P(`[${cf[0]}; ${cf.slice(1).join(', ')}, …]`), lines: [{ label: 'Convergents', display: convergents(cf.slice(0, 7)).join(', ') }], notes: ['From 50 correct digits; the expansion never ends'] });
    }
  }

  // Famous sequences
  m = /^(?:the )?(\d+)(?:st|nd|rd|th)? (fibonacci|lucas|catalan|triangular|tribonacci|pell|square|cube|pentagonal|bell) number$/i.exec(s) ?? /^(fibonacci|lucas|catalan|triangular|tribonacci|pell|pentagonal|bell)(?: number)?\s*\(?\s*(\d+)\s*\)?$/i.exec(s) ?? /^(F|[Ff]ib|[Cc]atalan)\s*\(\s*(\d+)\s*\)$/.exec(s); // capital F only: f(2) is usually the user's own function
  if (m) {
    const [kind0, ns] = /^\d/.test(m[1]!) ? [m[2]!, m[1]!] : [m[1]!, m[2]!];
    const kind = kind0.toLowerCase().replace(/^fib$|^f$/, 'fibonacci').replace(/^c$/, 'catalan');
    const n = Number(ns);
    if (n > 20000) return fail(input, 'That index is too large to compute exactly here');
    let v: bigint;
    let formula = '';
    switch (kind) {
      case 'fibonacci':
        v = fib(n)[0];
        formula = 'F₀ = 0, F₁ = 1, Fₙ = Fₙ₋₁ + Fₙ₋₂';
        break;
      case 'lucas': {
        const [a, b] = fib(n);
        v = 2n * b - a;
        formula = 'L₀ = 2, L₁ = 1, Lₙ = Lₙ₋₁ + Lₙ₋₂';
        break;
      }
      case 'catalan':
        v = binom(2n * BigInt(n), BigInt(n)) / BigInt(n + 1);
        formula = 'Cₙ = (2n choose n)/(n + 1)';
        break;
      case 'triangular':
        v = (BigInt(n) * BigInt(n + 1)) / 2n;
        formula = 'Tₙ = n(n + 1)/2';
        break;
      case 'pentagonal':
        v = (BigInt(n) * (3n * BigInt(n) - 1n)) / 2n;
        formula = 'Pₙ = n(3n − 1)/2';
        break;
      case 'square':
        v = BigInt(n) ** 2n;
        break;
      case 'cube':
        v = BigInt(n) ** 3n;
        break;
      case 'pell': {
        let [a, b] = [0n, 1n];
        for (let i = 0; i < n; i++) [a, b] = [b, 2n * b + a];
        v = a;
        formula = 'P₀ = 0, P₁ = 1, Pₙ = 2Pₙ₋₁ + Pₙ₋₂';
        break;
      }
      case 'tribonacci': {
        let [a, b, c] = [0n, 0n, 1n];
        for (let i = 0; i < n; i++) [a, b, c] = [b, c, a + b + c];
        v = a;
        formula = 'T₀ = T₁ = 0, T₂ = 1, Tₙ = Tₙ₋₁ + Tₙ₋₂ + Tₙ₋₃';
        break;
      }
      default: {
        // Bell numbers via the Bell triangle
        let row = [1n];
        for (let i = 0; i < n; i++) {
          const next = [row[row.length - 1]!];
          for (const x of row) next.push(next[next.length - 1]! + x);
          row = next;
        }
        v = row[0]!;
        formula = 'Bell triangle';
      }
    }
    return ok(input, { expression: `${kind[0]!.toUpperCase()}${kind.slice(1)} number ${n}`, primary: P(shortBig(v), v), value: val(v), lines: formula ? [{ label: 'Definition', display: formula }] : [] });
  }
  m = /^(?:the )?first (\d+) (fibonacci|lucas|catalan|triangular|prime|square|cube)(?: numbers)?s?$/i.exec(s);
  if (m) {
    const n = Math.min(Number(m[1]), 60);
    const k = m[2]!.toLowerCase();
    const list: bigint[] = [];
    if (k === 'prime') for (let p = 2n; list.length < n; p++) isPrime(p) && list.push(p);
    else for (let i = k === 'fibonacci' || k === 'catalan' ? 0 : 1; list.length < n; i++) list.push(k === 'fibonacci' ? fib(i)[0] : k === 'lucas' ? 2n * fib(i - 1)[1] - fib(i - 1)[0] : k === 'catalan' ? binom(2n * BigInt(i), BigInt(i)) / BigInt(i + 1) : k === 'triangular' ? (BigInt(i) * BigInt(i + 1)) / 2n : k === 'square' ? BigInt(i) ** 2n : BigInt(i) ** 3n);
    return ok(input, { expression: `First ${n} ${k} numbers`, primary: P(list.join(', ')) });
  }

  m = /^(?:the )?sum of (?:the )?first (\d+) (natural numbers|positive integers|integers|odd numbers|even numbers|squares|square numbers|cubes|cube numbers)$/i.exec(s);
  if (m) {
    const n = big(m[1]!);
    const k = m[2]!.toLowerCase();
    const [v, f] = /odd/.test(k) ? [n * n, 'n²'] : /even/.test(k) ? [n * (n + 1n), 'n(n + 1)'] : /square/.test(k) ? [(n * (n + 1n) * (2n * n + 1n)) / 6n, 'n(n + 1)(2n + 1)/6'] : /cube/.test(k) ? [((n * (n + 1n)) / 2n) ** 2n, '(n(n + 1)/2)²'] : [(n * (n + 1n)) / 2n, 'n(n + 1)/2'];
    return ok(input, { expression: `Sum of the first ${n} ${k}`, primary: P(shortBig(v), v), value: val(v), lines: [{ label: 'Formula', display: f }] });
  }

  // Collatz, digit sums, number classification
  m = /^(?:the )?collatz(?: sequence| steps)?(?: (?:of|for|starting (?:at|from)))? (\d+)$/i.exec(s) ?? /^(?:3n\+1|hailstone)(?: sequence)?(?: (?:of|for))? (\d+)$/i.exec(s);
  if (m) {
    let n = big(m[1]!);
    if (n < 1n) return fail(input, 'Start from a positive integer');
    const seq = [n];
    let peak = n;
    while (n !== 1n && seq.length < 100000) {
      n = n % 2n ? 3n * n + 1n : n / 2n;
      seq.push(n);
      if (n > peak) peak = n;
    }
    return ok(input, { expression: `Collatz sequence from ${m[1]}`, primary: P(`${seq.length - 1} steps to reach 1`, seq.length - 1), value: val(seq.length - 1), lines: [{ label: 'Sequence', display: seq.length <= 40 ? seq.join(' → ') : `${seq.slice(0, 20).join(' → ')} → … → 1` }, { label: 'Highest value', display: peak.toString() }], notes: ['Rule: halve if even, 3n + 1 if odd. That every start reaches 1 is still unproven (the Collatz conjecture).'] });
  }
  m = /^(?:the )?(digit sum|sum of (?:the )?digits|digital root|product of (?:the )?digits|reverse|number of digits)(?: of)? (\d+)$/i.exec(s);
  if (m) {
    const t = m[2]!;
    const w = m[1]!.toLowerCase();
    const sum = [...t].reduce((a, c) => a + Number(c), 0);
    if (/root/.test(w)) {
      const r = t === '0' ? 0 : 1 + ((sum - 1) % 9);
      return ok(input, { expression: `Digital root of ${t}`, primary: P(`${r}`, r), value: val(r), notes: ['Repeat the digit sum until one digit is left (equals n mod 9, with 9 for multiples of 9)'] });
    }
    if (/product/.test(w)) {
      const p = [...t].reduce((a, c) => a * BigInt(c), 1n);
      return ok(input, { expression: `Product of the digits of ${t}`, primary: P(p.toString(), p), value: val(p) });
    }
    if (/reverse/.test(w)) return ok(input, { expression: `Reverse of ${t}`, primary: P([...t].reverse().join('').replace(/^0+(?=\d)/, '')), notes: [t === [...t].reverse().join('') ? `${t} is a palindrome` : ''].filter(Boolean) });
    if (/number of digits/.test(w)) return ok(input, { expression: `Digits in ${t}`, primary: P(`${t.length}`, t.length), value: val(t.length) });
    return ok(input, { expression: `Digit sum of ${t}`, primary: P(`${sum}`, sum), value: val(sum) });
  }
  m = /^is (\d+) (?:an? )?(perfect|abundant|deficient|palindrome|palindromic|triangular|fibonacci|happy|armstrong|narcissistic|harshad|mersenne prime|square-free|squarefree)(?: number)?$/i.exec(s);
  if (m) {
    const n = big(m[1]!);
    const k = m[2]!.toLowerCase();
    const divSum = (x: bigint) => {
      let t = 1n;
      for (const [p, e] of factorize(x)) t *= (p ** BigInt(e + 1) - 1n) / (p - 1n);
      return t - x;
    };
    let yes = false;
    let why = '';
    if (/perfect|abundant|deficient/.test(k)) {
      const sd = n > 1n ? divSum(n) : 0n;
      const cls = sd === n ? 'perfect' : sd > n ? 'abundant' : 'deficient';
      yes = cls === k;
      why = `Sum of proper divisors = ${sd}, so ${n} is ${cls}`;
    } else if (/palindrom/.test(k)) {
      yes = m[1] === [...m[1]!].reverse().join('');
    } else if (k === 'triangular') {
      const r = sqrtFloor(8n * n + 1n);
      yes = r * r === 8n * n + 1n;
      why = yes ? `${n} = T${SUB((r - 1n) / 2n)}` : '';
    } else if (k === 'fibonacci') {
      const sq = (x: bigint) => sqrtFloor(x) ** 2n === x;
      yes = sq(5n * n * n + 4n) || sq(5n * n * n - 4n);
      why = '5n² ± 4 is a perfect square exactly for Fibonacci numbers';
    } else if (k === 'happy') {
      let x = n;
      const seen = new Set<bigint>();
      while (x !== 1n && !seen.has(x)) {
        seen.add(x);
        x = [...x.toString()].reduce((a, c) => a + BigInt(c) ** 2n, 0n);
      }
      yes = x === 1n;
    } else if (k === 'armstrong' || k === 'narcissistic') {
      const d = m[1]!.length;
      yes = [...m[1]!].reduce((a, c) => a + BigInt(c) ** BigInt(d), 0n) === n;
    } else if (k === 'harshad') {
      yes = n % [...m[1]!].reduce((a, c) => a + BigInt(c), 0n) === 0n;
    } else if (k === 'mersenne prime') {
      const p = (n + 1n).toString(2);
      yes = /^10*$/.test(p) && isPrime(n);
      why = yes ? `${n} = 2^${p.length - 1} − 1 and is prime` : '';
    } else {
      yes = [...factorize(n).values()].every((e) => e === 1);
    }
    return ok(input, { expression: `Is ${n} ${k}?`, primary: P(yes ? 'Yes' : 'No'), notes: why ? [why] : [] });
  }

  // Prime counting
  m = /^(?:the )?(?:number of primes|how many primes (?:are there )?)(?: (?:less than|below|up to|under|≤|<=|<)) (\d+)$/i.exec(s) ?? /^prime counting function (?:π|pi)?\s*\(?\s*(\d+)\s*\)?$/i.exec(s);
  if (m) {
    const x = Number(m[1]);
    if (x > 2e7) return fail(input, 'Counting primes is limited to x ≤ 20,000,000 here');
    const strict = /less than|below|under|<(?!=)/i.test(s);
    const lim = strict ? x - 1 : x;
    const sieve = new Uint8Array(lim + 1);
    let count = 0;
    for (let i = 2; i <= lim; i++) {
      if (sieve[i]) continue;
      count++;
      for (let j = i * i; j <= lim; j += i) sieve[j] = 1;
    }
    const est = x / Math.log(x);
    return ok(input, { expression: `π(${lim})`, primary: P(`${count}`, count), value: val(count), lines: [{ label: 'PNT estimate x/ln x', display: `≈ ${est.toFixed(1)}` }] });
  }

  // Exact factorials and binomials, big integers
  m = /^(?:the )?(?:exact(?: value)?(?: of)?|all digits of|digits of) (\d+)\s*!$/i.exec(s) ?? /^(\d+)\s*! exactly$/i.exec(s);
  if (m) {
    const n = Number(m[1]);
    if (n > 5000) return fail(input, 'Exact factorials are limited to n ≤ 5000');
    const f = factorial(n);
    const str = f.toString();
    const zeros = str.length - str.replace(/0+$/, '').length;
    return ok(input, { expression: `${n}!`, primary: P(shortBig(f)), lines: [{ label: 'Digits', display: `${str.length}` }, { label: 'Trailing zeros', display: `${zeros}` }, ...(str.length <= 400 ? [{ label: 'Exact', display: str }] : [])] });
  }
  m = /^(?:the )?(?:number of )?trailing zeros (?:in|of) (\d+)\s*!$/i.exec(s);
  if (m) {
    let n = Number(m[1]);
    let z = 0;
    while (n) {
      n = Math.floor(n / 5);
      z += n;
    }
    return ok(input, { expression: `Trailing zeros of ${m[1]}!`, primary: P(`${z}`, z), value: val(z), notes: ["Legendre's formula: ⌊n/5⌋ + ⌊n/25⌋ + ⌊n/125⌋ + …"] });
  }

  // Counting
  m = /^(?:the )?(?:number of )?(permutations|arrangements|combinations|selections) of (\d+)(?: (?:objects|things|items))?(?: taken| choose| chosen)? (\d+)(?: at a time)?$/i.exec(s);
  if (m) {
    const n = big(m[2]!);
    const k = big(m[3]!);
    const perm = /perm|arrange/i.test(m[1]!);
    const v = perm ? (k > n ? 0n : factorial(Number(n)) / factorial(Number(n - k))) : binom(n, k);
    return ok(input, { expression: `${perm ? `P(${n}, ${k}) = ${n}!/(${n}−${k})!` : `C(${n}, ${k}) = ${n}!/(${k}!(${n}−${k})!)`}`, primary: P(shortBig(v), v), value: val(v), notes: [perm ? 'Order matters' : 'Order does not matter'] });
  }
  m = /^(?:in )?how many (?:ways|different ways) (?:can (?:you )?|to |are there to )?(arrange|order|line up|seat|permute|choose|select|pick) (\d+)(?: (?:from|out of|of) (\d+))?(?: [a-z ]+?)?(?: (around a (?:round|circular) table|in a circle))?$/i.exec(s);
  if (m) {
    const verb = m[1]!.toLowerCase();
    const k = big(m[2]!);
    const n = m[3] ? big(m[3]) : k;
    if (m[4] || /round|circle|circular/i.test(s)) {
      const v = factorial(Number(k) - 1);
      return ok(input, { expression: `Circular arrangements of ${k}`, primary: P(shortBig(v), v), value: val(v), notes: ['(n − 1)!: rotations of the same seating count once'] });
    }
    const choose = /choose|select|pick/.test(verb);
    const v = choose ? binom(n, k) : factorial(Number(n)) / factorial(Number(n - k));
    return ok(input, { expression: choose ? `C(${n}, ${k})` : n === k ? `${n}!` : `P(${n}, ${k})`, primary: P(shortBig(v), v), value: val(v), notes: [choose ? 'Order does not matter' : 'Order matters'] });
  }
  m = /^(?:the )?(?:number of )?(?:distinct )?(?:arrangements|permutations|anagrams|ways to arrange)(?: of)?(?: the letters(?: of| in)?)? (?:the word )?"?([a-z]+)"?$/i.exec(s);
  if (m && m[1]!.length > 1 && m[1]!.length <= 30) {
    const w = m[1]!.toUpperCase();
    const counts = new Map<string, number>();
    for (const c of w) counts.set(c, (counts.get(c) ?? 0) + 1);
    let v = factorial(w.length);
    for (const c of counts.values()) v /= factorial(c);
    const rep = [...counts].filter(([, c]) => c > 1);
    return ok(input, { expression: `Arrangements of ${w}`, primary: P(shortBig(v), v), value: val(v), lines: [{ label: 'Formula', display: `${w.length}!${rep.map(([l, c]) => ` / ${c}! (${l})`).join('')}` }] });
  }
  m = /^(?:the )?(?:number of )?derangements of (\d+)$|^!(\d+)$|^subfactorial (\d+)$/i.exec(s);
  if (m) {
    const n = Number(m[1] ?? m[2] ?? m[3]);
    let d0 = 1n;
    let d1 = 0n;
    for (let i = 2; i <= n; i++) [d0, d1] = [d1, BigInt(i - 1) * (d0 + d1)];
    const der = n === 0 ? 1n : d1;
    return ok(input, { expression: `Derangements of ${n} (!${n})`, primary: P(shortBig(der), der), value: val(der), notes: ['Permutations with no element in its original place; !n ≈ n!/e'] });
  }
  m = /^(?:number of )?(?:subsets|elements in the power set) of (?:a set (?:with|of) )?(\d+)(?: elements)?$/i.exec(s);
  if (m) {
    const v = 2n ** big(m[1]!);
    return ok(input, { expression: `Subsets of a ${m[1]}-element set`, primary: P(shortBig(v), v), value: val(v), notes: ['2ⁿ (each element is in or out)'] });
  }
  m = /^(?:ways to (?:distribute|put|place)|distribute) (\d+) (?:identical|indistinguishable) (?:balls|objects|items|candies|sweets|coins)? ?(?:into|among) (\d+) (?:distinct |different )?(?:boxes|bins|children|people|kids)(?: ((?:with )?each (?:getting|gets|receiving|having) at least one|with none empty|none empty))?$/i.exec(s);
  if (m) {
    const n = big(m[1]!);
    const k = big(m[2]!);
    const atLeast = !!m[3];
    const v = atLeast ? binom(n - 1n, k - 1n) : binom(n + k - 1n, k - 1n);
    return ok(input, { expression: `${n} identical items into ${k} boxes`, primary: P(shortBig(v), v), value: val(v), notes: [atLeast ? `Stars and bars: C(n−1, k−1) = C(${n - 1n}, ${k - 1n})` : `Stars and bars: C(n+k−1, k−1) = C(${n + k - 1n}, ${k - 1n})`] });
  }

  // Groups: Z_n, U(n), S_n, D_n, permutations
  m = /^(?:the )?order of (?:the (?:group )?)?(z_?(\d+)|ℤ_?(\d+)|z\/(\d+)z|u\((\d+)\)|\(z\/(\d+)z\)\*|s_?(\d+)|d_?(\d+)|a_?(\d+))$/i.exec(s);
  if (m) {
    const g = m[1]!.toLowerCase();
    const n = big(m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6] ?? m[7] ?? m[8] ?? m[9]!);
    let v: bigint;
    let note = '';
    if (/^u|\*$/.test(g)) [v, note] = [totient(n), `|U(${n})| = φ(${n})`];
    else if (g.startsWith('s')) [v, note] = [factorial(Number(n)), `|S${SUB(n)}| = ${n}!`];
    else if (g.startsWith('a')) [v, note] = [factorial(Number(n)) / 2n, `|A${SUB(n)}| = ${n}!/2`];
    else if (g.startsWith('d')) [v, note] = [2n * n, `Dihedral group of the ${n}-gon has 2n elements (some books write it D${SUB(2n * n)})`];
    else [v, note] = [n, `ℤ${SUB(n)} = {0, 1, …, ${n - 1n}} under addition mod ${n}`];
    return ok(input, { expression: `Order of ${m[1]}`, primary: P(shortBig(v), v), value: val(v), notes: [note] });
  }
  m = /^(?:the )?(?:elements|units) of (?:u\((\d+)\)|\(z\/(\d+)z\)\*|z_?(\d+)\*)$/i.exec(s) ?? /^(?:the )?units (?:of|in|mod) z_?(\d+)$/i.exec(s);
  if (m) {
    const n = big(m[1] ?? m[2] ?? m[3]!);
    const us = Array.from({ length: Number(n) }, (_, i) => BigInt(i)).filter((x) => x > 0n && gcd(x, n) === 1n);
    return ok(input, { expression: `U(${n})`, primary: P(`{${us.join(', ')}}`), lines: [{ label: 'Order', display: `φ(${n}) = ${us.length}` }, { label: 'Cyclic?', display: us.some((u) => order(u, n) === BigInt(us.length)) ? 'yes' : 'no' }] });
  }
  m = /^(?:the )?order of (\d+) in z_?(\d+)$/i.exec(s);
  if (m) {
    const a = big(m[1]!);
    const n = big(m[2]!);
    const o = n / gcd(a, n);
    return ok(input, { expression: `Order of ${a} in ℤ${SUB(n)} (addition)`, primary: P(`${o}`, o), value: val(o), notes: [`n / gcd(a, n) = ${n}/${gcd(a, n)}`] });
  }
  m = /^(?:the )?subgroups of z_?(\d+)$/i.exec(s);
  if (m) {
    const n = big(m[1]!);
    const ds = Array.from({ length: Number(n) }, (_, i) => BigInt(i + 1)).filter((d) => n % d === 0n);
    return ok(input, { expression: `Subgroups of ℤ${SUB(n)}`, primary: P(`${ds.length} subgroups`, ds.length), lines: ds.map((d) => ({ label: `order ${d}`, display: `⟨${n / d}⟩ = {${Array.from({ length: Number(d) }, (_, i) => (BigInt(i) * (n / d)).toString()).slice(0, 12).join(', ')}${d > 12n ? ', …' : ''}}` })), notes: ['ℤₙ is cyclic: one subgroup for each divisor of n'] });
  }
  m = /^is z_?(\d+) a field$/i.exec(s);
  if (m) {
    const n = big(m[1]!);
    return ok(input, { expression: `Is ℤ${SUB(n)} a field?`, primary: P(isPrime(n) ? 'Yes' : 'No'), notes: [isPrime(n) ? `${n} is prime, so every nonzero element has an inverse` : `${n} is not prime, so ℤ${SUB(n)} has zero divisors`] });
  }
  // Permutations in cycle notation: "order of (1 2 3)(4 5)", "sign of (1 2 3)", "cycle notation of [2,3,1]"
  m = /^(?:the )?(order|sign|parity|cycle (?:notation|decomposition|type)|inverse)(?: of)?(?: the)?(?: permutation)? ((?:\(\s*\d+(?:[\s,]+\d+)*\s*\)\s*)+|\[\s*\d+(?:\s*,\s*\d+)*\s*\])$/i.exec(s);
  if (m) {
    const w = m[1]!.toLowerCase();
    let cycles: number[][];
    if (m[2]!.trim().startsWith('[')) {
      const img = m[2]!.replace(/[[\]\s]/g, '').split(',').map(Number);
      const seen = new Set<number>();
      cycles = [];
      for (let i = 1; i <= img.length; i++) {
        if (seen.has(i)) continue;
        const c: number[] = [];
        for (let j = i; !seen.has(j); j = img[j - 1]!) {
          seen.add(j);
          c.push(j);
        }
        cycles.push(c);
      }
    } else cycles = [...m[2]!.matchAll(/\(([^)]*)\)/g)].map((c) => c[1]!.trim().split(/[\s,]+/).map(Number));
    const nontrivial = cycles.filter((c) => c.length > 1);
    const ord = nontrivial.reduce((a, c) => lcm(a, BigInt(c.length)), 1n);
    const sign = nontrivial.reduce((a, c) => a * (c.length % 2 ? 1 : -1), 1);
    const notation = nontrivial.map((c) => `(${c.join(' ')})`).join('') || '()';
    const lines = [{ label: 'Cycles', display: notation }, { label: 'Order', display: ord.toString() }, { label: 'Sign', display: sign > 0 ? '+1 (even)' : '−1 (odd)' }];
    if (/inverse/.test(w)) return ok(input, { expression: `Inverse of ${notation}`, primary: P(nontrivial.map((c) => `(${[c[0], ...c.slice(1).reverse()].join(' ')})`).join('') || '()'), lines });
    if (/sign|parity/.test(w)) return ok(input, { expression: `Sign of ${notation}`, primary: P(sign > 0 ? '+1 (even)' : '−1 (odd)', sign), value: val(sign), lines });
    if (/cycle/.test(w)) return ok(input, { expression: `Cycle notation`, primary: P(notation), lines });
    return ok(input, { expression: `Order of ${notation}`, primary: P(ord.toString(), ord), value: val(ord), lines, notes: ['The order is the LCM of the cycle lengths'] });
  }

  // Sets
  const SET = String.raw`\{[^{}]*\}`;
  m = new RegExp(`^(${SET})\\s*(∪|∩|\\\\|−|-|△|Δ|union|intersect(?:ion)?(?: with)?|minus|difference|setminus|symmetric difference|xor|×|cartesian product|x)\\s*(${SET})$`, 'i').exec(s) ?? new RegExp(`^(?:the )?(union|intersection|difference|symmetric difference|cartesian product) of (${SET}) and (${SET})$`, 'i').exec(s);
  if (m) {
    const [A0, op0, B0] = m[1]!.startsWith('{') ? [m[1]!, m[2]!, m[3]!] : [m[2]!, m[1]!, m[3]!];
    const A = setOf(A0);
    const B = setOf(B0);
    if (A && B) {
      const op = op0.toLowerCase();
      let r: string[];
      let name: string;
      if (/∪|union/.test(op)) [r, name] = [[...new Set([...A, ...B])], '∪'];
      else if (/∩|intersect/.test(op)) [r, name] = [A.filter((x) => B.includes(x)), '∩'];
      else if (/△|Δ|symmetric|xor/.test(op)) [r, name] = [[...A.filter((x) => !B.includes(x)), ...B.filter((x) => !A.includes(x))], '△'];
      else if (/×|cartesian|^x$/.test(op)) {
        const pairs = A.flatMap((a) => B.map((b) => `(${a}, ${b})`));
        return ok(input, { expression: `${showSet(A)} × ${showSet(B)}`, primary: P(`{${pairs.join(', ')}}`), lines: [{ label: 'Size', display: `${A.length} × ${B.length} = ${pairs.length}` }] });
      } else [r, name] = [A.filter((x) => !B.includes(x)), '∖'];
      const out = sortSet(r);
      return ok(input, { expression: `${showSet(A)} ${name} ${showSet(B)}`, primary: P(showSet(out)), lines: [{ label: 'Number of elements', display: `${out.length}` }] });
    }
  }
  m = new RegExp(`^is (${SET}) (?:a )?(proper )?subset of (${SET})$`, 'i').exec(s) ?? new RegExp(`^(${SET})\\s*(⊂|⊆|⊊)\\s*(${SET})$`).exec(s);
  if (m) {
    const A = setOf(m[1]!);
    const B = setOf(m[3]!);
    if (A && B) {
      const sub = A.every((x) => B.includes(x));
      const proper = !!m[2] && m[2] !== '⊆' && m[2] !== '⊂' ? true : m[2] === '⊊';
      const yes = sub && (!proper || A.length < B.length);
      const missing = A.filter((x) => !B.includes(x));
      return ok(input, { expression: `Is ${showSet(A)} ${proper ? 'a proper' : 'a'} subset of ${showSet(B)}?`, primary: P(yes ? 'Yes' : 'No'), notes: missing.length ? [`${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} not in the second set`] : [] });
    }
  }
  m = new RegExp(`^(?:the )?power set of (${SET})$|^P\\((${SET})\\)$`, 'i').exec(s);
  if (m) {
    const A = setOf(m[1] ?? m[2]!);
    if (A && A.length <= 8) {
      const subsets: string[] = [];
      for (let mask = 0; mask < 1 << A.length; mask++) subsets.push(showSet(A.filter((_, i) => mask & (1 << i))));
      subsets.sort((a, b) => a.length - b.length);
      return ok(input, { expression: `Power set of ${showSet(A)}`, primary: P(`{${subsets.join(', ')}}`), lines: [{ label: 'Number of subsets', display: `2^${A.length} = ${subsets.length}` }] });
    }
  }
  m = new RegExp(`^(?:the )?(?:cardinality|size|number of elements) of (${SET})$|^\\|\\s*(${SET})\\s*\\|$|^n\\((${SET})\\)$`, 'i').exec(s);
  if (m) {
    const A = setOf(m[1] ?? m[2] ?? m[3]!);
    if (A) return ok(input, { expression: `|${showSet(A)}|`, primary: P(`${A.length}`, A.length), value: val(A.length), notes: ['Repeated elements count once'] });
  }
  m = new RegExp(`^(?:the )?complement of (${SET}) (?:in|relative to|with respect to|if the universal set is|where u ?=) (${SET})$`, 'i').exec(s);
  if (m) {
    const A = setOf(m[1]!);
    const U = setOf(m[2]!);
    if (A && U) return ok(input, { expression: `Complement of ${showSet(A)} in ${showSet(U)}`, primary: P(showSet(U.filter((x) => !A.includes(x)))) });
  }
  // Venn counts: n(A∪B) = n(A) + n(B) − n(A∩B)
  if (/n\s*\(\s*a\s*(?:∪|∩|u|n|and|or|union|intersect)/i.test(s) || /n\s*\(\s*a\s*\)\s*=/.test(s.toLowerCase())) {
    const t = s.toLowerCase().replace(/\s+/g, '').replace(/union|∪|or/g, 'u').replace(/intersect(?:ion)?|∩|and/g, 'n');
    const get = (k: string) => {
      const r = new RegExp(`n\\(${k.replace(/[()]/g, '\\$&')}\\)=(\\d+)`).exec(t);
      return r ? Number(r[1]) : undefined;
    };
    const a = get('a');
    const b = get('b');
    const ab = get('anb') ?? get('bna');
    const aub = get('aub') ?? get('bua');
    const known = [a, b, ab, aub].filter((x) => x !== undefined).length;
    if (known === 3) {
      if (aub === undefined) return ok(input, { expression: 'n(A ∪ B) = n(A) + n(B) − n(A ∩ B)', primary: P(`n(A ∪ B) = ${a! + b! - ab!}`, a! + b! - ab!), value: val(a! + b! - ab!), lines: [{ label: 'Only A', display: `${a! - ab!}` }, { label: 'Only B', display: `${b! - ab!}` }], notes: ['Inclusion–exclusion'] });
      if (ab === undefined) return ok(input, { expression: 'n(A ∩ B) = n(A) + n(B) − n(A ∪ B)', primary: P(`n(A ∩ B) = ${a! + b! - aub}`, a! + b! - aub), value: val(a! + b! - aub), notes: ['Inclusion–exclusion'] });
      if (b === undefined) return ok(input, { expression: 'n(B) = n(A ∪ B) − n(A) + n(A ∩ B)', primary: P(`n(B) = ${aub - a! + ab}`, aub - a! + ab), value: val(aub - a! + ab) });
      return ok(input, { expression: 'n(A) = n(A ∪ B) − n(B) + n(A ∩ B)', primary: P(`n(A) = ${aub - b! + ab}`, aub - b! + ab), value: val(aub - b! + ab) });
    }
  }

  // Transfinite arithmetic
  m = /^(ℵ₀|aleph[_ ]?(?:0|null|naught|zero)|ω|omega)\s*([+*×·^])\s*(\d+|ℵ₀|aleph[_ ]?0|ω|omega)$|^(\d+)\s*([+*×·])\s*(ω|omega|ℵ₀|aleph[_ ]?0)$/i.exec(s);
  if (m) {
    const isOmega = /ω|omega/i.test(s);
    const leftInf = !!m[1];
    const op = (m[2] ?? m[5])!;
    let r: string;
    let note: string;
    if (!isOmega) {
      r = op === '^' ? '2^ℵ₀ (the cardinality of ℝ, by Cantor’s theorem > ℵ₀)' : 'ℵ₀';
      note = 'Cardinal arithmetic: ℵ₀ + n = ℵ₀·n = ℵ₀ + ℵ₀ = ℵ₀ (a countable union of countable sets is countable).';
    } else if (op === '+') {
      r = leftInf ? `ω + ${m[3]}` : 'ω';
      note = leftInf ? 'Ordinal addition is not commutative: ω + 1 > ω (one more element after all the naturals), but 1 + ω = ω.' : 'Ordinal addition: 1 + ω = ω (the extra element is absorbed at the front), unlike ω + 1.';
    } else {
      r = leftInf ? `ω·${m[3]}` : 'ω';
      note = leftInf ? 'ω·2 = ω + ω (two copies of ℕ in a row), but 2·ω = ω.' : '2·ω = ω (ω copies of 2 elements), but ω·2 = ω + ω.';
    }
    return ok(input, { expression: s, primary: P(r), notes: [note] });
  }

  // Short explanations for conceptual questions
  if (/^(?:what (?:is|are)|explain|state|tell me about|is|are|who proved|has .* been proved)\b|\b(?:theorem|hypothesis|conjecture|axiom|paradox|problem)\b/i.test(input)) {
    for (const [re, text, notes] of CONCEPTS) {
      if (re.test(input)) return ok(input, { expression: 'Explanation', primary: P(text), notes: [...notes, 'This is a concept, not a calculation. Ask the assistant to discuss it further.'] });
    }
  }
  return null;
}

export const LOOKS_LIKE_NUMBER_EXTRAS =
  /\b(?:inverse of -?\d+ mod|mod(?:ulo)? \d+.*(?:,|and).*mod|chinese remainder|crt|congruen\w*|≡|integers?\b.*=|diophant\w*|pell|multiplicative order|order of|primitive roots?|quadratic residues?|legendre|jacobi|continued fraction|fibonacci|lucas|catalan|triangular|tribonacci|pentagonal|bell number|collatz|hailstone|3n\+1|digit sum|sum of (?:the )?digits|digital root|product of (?:the )?digits|number of digits|perfect|abundant|deficient|palindrom\w*|happy|armstrong|narcissistic|harshad|mersenne|square-?free|number of primes|how many primes|prime counting|trailing zeros|exact(?: value)? of|digits of|permutations|arrangements|combinations|selections|how many (?:different )?ways|anagrams|derangements?|subfactorial|subsets|power set|identical|units of|elements of|subgroups|a field|sign of|parity of|cycle (?:notation|decomposition|type)|union|intersect\w*|symmetric difference|cartesian product|subset|cardinality|complement of|aleph|omega|g[öo]del|continuum hypothesis|axiom of choice|halting problem|riemann hypothesis|goldbach|twin prime|p vs\.? np|fermat'?s last|countab\w*|uncountab\w*|induction|zfc|banach|sum of (?:the )?first \d+|bell)\b|reverse \d|=.*\bintegers?\b|aleph|inverse of \(\d|\^\s*\(?-1\)?\s*mod|[{}∪∩⊂⊆△ℵω]|^\s*!\d|^\s*(?:f|fib|c)\s*\(\s*\d+\s*\)\s*$|\bn\s*\(\s*a/i;
