import { D, MathError, type Answer, type AnswerResult } from '@lemma/math-core';

/** Number theory in TypeScript with BigInt: instant, no CAS needed. */

const SMALL_PRIMES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];
const LIMIT = 10n ** 30n;

function modpow(b: bigint, e: bigint, m: bigint): bigint {
  let r = 1n;
  b %= m;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
}

/** Deterministic Miller–Rabin for n < 3.3·10²⁴ with the first 12 prime bases. */
export function isPrime(n: bigint): boolean {
  if (n < 2n) return false;
  for (const p of SMALL_PRIMES) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }
  let d = n - 1n;
  let r = 0;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    r++;
  }
  outer: for (const a of SMALL_PRIMES) {
    let x = modpow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    for (let i = 1; i < r; i++) {
      x = (x * x) % n;
      if (x === n - 1n) continue outer;
    }
    return false;
  }
  return true;
}

const gcd = (a: bigint, b: bigint): bigint => {
  while (b) [a, b] = [b, a % b];
  return a < 0n ? -a : a;
};

function pollard(n: bigint): bigint {
  if (n % 2n === 0n) return 2n;
  for (let c = 1n; c < 50n; c++) {
    let x = 2n;
    let y = 2n;
    let d = 1n;
    const f = (v: bigint) => (v * v + c) % n;
    while (d === 1n) {
      x = f(x);
      y = f(f(y));
      d = gcd(x > y ? x - y : y - x, n);
    }
    if (d !== n) return d;
  }
  throw new MathError('overflow', 'Could not factor this number quickly');
}

export function factorize(n: bigint): Map<bigint, number> {
  const out = new Map<bigint, number>();
  const add = (p: bigint) => out.set(p, (out.get(p) ?? 0) + 1);
  for (let p = 2n; p < 1000n && p * p <= n; p += p === 2n ? 1n : 2n) {
    while (n % p === 0n) {
      add(p);
      n /= p;
    }
  }
  const stack = n > 1n ? [n] : [];
  while (stack.length) {
    const m = stack.pop()!;
    if (isPrime(m)) add(m);
    else {
      const d = pollard(m);
      stack.push(d, m / d);
    }
  }
  return new Map([...out].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
}

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sup = (k: number) => (k === 1 ? '' : String(k).replace(/\d/g, (d) => SUP[Number(d)]!));
const fmtFactors = (f: Map<bigint, number>) => [...f].map(([p, k]) => `${p}${sup(k)}`).join(' × ');
const big = (s: string) => BigInt(s.replace(/[,_\s]/g, ''));

function ans(input: string, a: Omit<Answer, 'ok' | 'input' | 'kind' | 'notes'> & { notes?: string[] }): Answer {
  return { ok: true, kind: 'number-theory', input, notes: [], exactness: 'exact', ...a };
}

export function answerNumberTheory(input: string): AnswerResult | null {
  const s = input.toLowerCase().trim().replace(/[?.!]+$/, '').replace(/\s+/g, ' ');
  const N = String.raw`(\d[\d,_]*)`;
  const guard = (n: bigint) => {
    if (n > LIMIT) throw new MathError('overflow', 'Numbers up to 10³⁰ are supported here');
  };
  try {
    let m = new RegExp(`^is ${N} (?:a )?prime(?: number)?$|^${N} (?:is )?prime\\?*$|^primality of ${N}$`).exec(s);
    if (m) {
      const n = big(m[1] ?? m[2] ?? m[3]!);
      guard(n);
      const p = isPrime(n);
      const lines = p || n < 2n ? [] : [{ label: 'Factors', display: fmtFactors(factorize(n)) }];
      return ans(input, {
        expression: `Is ${n} prime?`,
        primary: { display: p ? 'Yes, prime' : 'No', plain: p ? 'true' : 'false', spoken: `${n} is ${p ? '' : 'not '}prime` },
        lines,
        notes: n < 2n ? ['Primes are integers greater than 1'] : [],
      });
    }
    m = new RegExp(`^(?:the )?(?:prime )?factori[sz]ation of ${N}$|^(?:the )?prime factors? of ${N}$|^factor(?:i[sz]e)? ${N}$`).exec(s);
    if (m) {
      const n = big(m[1] ?? m[2] ?? m[3]!);
      guard(n);
      if (n < 2n) return { ok: false, kind: 'number-theory', input, error: new MathError('domain', 'Prime factorization is for integers ≥ 2') };
      const f = factorize(n);
      return ans(input, {
        expression: `Prime factorization of ${n}`,
        primary: { display: fmtFactors(f), plain: [...f].map(([p, k]) => (k > 1 ? `${p}^${k}` : `${p}`)).join('*'), spoken: [...f].map(([p, k]) => (k > 1 ? `${p} to the ${k}` : `${p}`)).join(' times ') },
        lines: [
          { label: 'Distinct primes', display: String(f.size) },
          { label: 'Number of divisors', display: String([...f.values()].reduce((a, k) => a * (k + 1), 1)) },
        ],
      });
    }
    m = new RegExp(`^(?:the )?(?:divisors|factors) of ${N}$`).exec(s);
    if (m) {
      const n = big(m[1]!);
      if (n < 1n || n > 10n ** 15n) throw new MathError('domain', 'Divisors are listed for 1 ≤ n ≤ 10¹⁵');
      let divs: bigint[] = [1n];
      for (const [p, k] of factorize(n)) {
        const next: bigint[] = [];
        for (const d of divs) for (let i = 0, pk = 1n; i <= k; i++, pk *= p) next.push(d * pk);
        divs = next;
      }
      divs.sort((a, b) => (a < b ? -1 : 1));
      const sum = divs.reduce((a, b) => a + b, 0n);
      return ans(input, {
        expression: `Divisors of ${n}`,
        primary: { display: divs.length > 40 ? `${divs.slice(0, 40).join(', ')}, …` : divs.join(', '), plain: divs.join(','), spoken: `${divs.length} divisors` },
        value: new D(divs.length),
        lines: [
          { label: 'Count', display: String(divs.length) },
          { label: 'Sum', display: sum.toString() },
          { label: 'Perfect number?', display: sum - n === n ? 'Yes' : 'No' },
        ],
      });
    }
    m = new RegExp(`^(?:the )?next prime (?:after|above|from) ${N}$|^(?:the )?(?:previous|prev) prime (?:before|below) ${N}$`).exec(s);
    if (m) {
      const up = !!m[1];
      let n = big(m[1] ?? m[2]!);
      guard(n);
      do n += up ? 1n : -1n;
      while (n >= 2n && !isPrime(n));
      if (n < 2n) throw new MathError('domain', 'There is no prime below 2');
      return ans(input, { expression: `${up ? 'Next' : 'Previous'} prime ${up ? 'after' : 'before'} ${m[1] ?? m[2]}`, primary: { display: n.toString(), plain: n.toString(), spoken: n.toString() }, value: new D(n.toString()) });
    }
    m = /^(?:the )?(\d+)(?:st|nd|rd|th) prime(?: number)?$/.exec(s);
    if (m) {
      const k = Number(m[1]);
      if (k < 1 || k > 200000) throw new MathError('domain', 'Supported for the 1st to 200,000th prime');
      const limit = Math.max(30, Math.ceil(k * (Math.log(k) + Math.log(Math.log(k + 2)) + 2)));
      const sieve = new Uint8Array(limit + 1);
      let count = 0;
      for (let i = 2; i <= limit; i++) {
        if (sieve[i]) continue;
        if (++count === k) return ans(input, { expression: `The ${m[1]}th prime`, primary: { display: String(i), plain: String(i), spoken: String(i) }, value: new D(i) });
        for (let j = i * i; j <= limit; j += i) sieve[j] = 1;
      }
    }
    m = /^(?:list )?(?:the )?primes (?:between|from) (\d+) (?:and|to) (\d+)$|^(?:list )?(?:the )?primes (?:up to|below|under|less than) (\d+)$/.exec(s);
    if (m) {
      const lo = m[3] ? 2 : Number(m[1]);
      const hi = Number(m[3] ?? m[2]);
      if (hi - lo > 1e6) throw new MathError('domain', 'Range too large to list (max 1,000,000 wide)');
      const sieve = new Uint8Array(hi + 1);
      const primes: number[] = [];
      for (let i = 2; i <= hi; i++) {
        if (sieve[i]) continue;
        if (i >= lo) primes.push(i);
        for (let j = i * i; j <= hi; j += i) sieve[j] = 1;
      }
      return ans(input, {
        expression: `Primes from ${lo} to ${hi}`,
        primary: { display: primes.length > 60 ? `${primes.slice(0, 60).join(', ')}, …` : primes.join(', ') || 'None', plain: primes.join(','), spoken: `${primes.length} primes` },
        value: new D(primes.length),
        lines: [{ label: 'Count', display: String(primes.length) }],
      });
    }
    m = new RegExp(`^(?:euler'?s )?(?:totient|phi)(?: of|\\()? ?${N}\\)?$`).exec(s);
    if (m) {
      const n = big(m[1]!);
      guard(n);
      let phi = n;
      for (const p of factorize(n).keys()) phi = (phi / p) * (p - 1n);
      return ans(input, { expression: `Euler's totient φ(${n})`, primary: { display: phi.toString(), plain: phi.toString(), spoken: phi.toString() }, value: new D(phi.toString()) });
    }
  } catch (e) {
    if (e instanceof MathError) return { ok: false, kind: 'number-theory', input, error: e };
    throw e;
  }
  return null;
}

export const LOOKS_LIKE_NUMBER_THEORY = /\bprimes?\b|\bfactori[sz]\w*|\bfactor(?:i[sz]e)? \d|\bdivisors?\b|\bfactors of\b|\btotient\b|\bphi\b/i;
