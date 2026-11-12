export interface MathConstant {
  key: string;
  name: string;
  symbol: string;
  /** Truncated (not rounded) decimal expansion. */
  value: string;
  /** Names that work on their own ("golden ratio"). */
  names: string[];
  /** Names that only count after "value of" / "digits of" ("pi", "e"), since the calculator owns them bare. */
  bare: string[];
  note?: string;
}

export const MATH_CONSTANTS: MathConstant[] = [
  { key: 'pi', name: 'Pi', symbol: 'π', value: '3.14159265358979323846264338327950288', names: ["archimedes' constant", 'archimedes constant'], bare: ['pi', 'π'], note: 'Ratio of a circle’s circumference to its diameter' },
  { key: 'tau', name: 'Tau', symbol: 'τ', value: '6.28318530717958647692528676655900576', names: [], bare: ['tau', 'τ'], note: 'Equal to 2π' },
  { key: 'e', name: "Euler's number", symbol: 'e', value: '2.71828182845904523536028747135266249', names: ["euler's number", 'eulers number', 'euler number', "napier's constant", 'napiers constant', 'napier constant'], bare: ['e'], note: 'Base of the natural logarithm' },
  { key: 'phi', name: 'Golden ratio', symbol: 'φ', value: '1.61803398874989484820458683436563811', names: ['golden ratio', 'golden mean', 'golden section', 'divine proportion'], bare: ['phi', 'φ'], note: 'Equal to (1 + √5)/2' },
  { key: 'sqrt2', name: 'Square root of 2', symbol: '√2', value: '1.41421356237309504880168872420969807', names: ["pythagoras' constant", 'pythagoras constant', "pythagoras's constant"], bare: ['square root of 2', 'sqrt 2', 'sqrt(2)', '√2', 'root 2'] },
  { key: 'sqrt3', name: 'Square root of 3', symbol: '√3', value: '1.73205080756887729352744634150587236', names: ["theodorus' constant", 'theodorus constant'], bare: ['square root of 3', 'sqrt 3', 'sqrt(3)', '√3', 'root 3'] },
  { key: 'ln2', name: 'Natural logarithm of 2', symbol: 'ln 2', value: '0.69314718055994530941723212145817656', names: [], bare: ['ln 2', 'ln(2)', 'natural log of 2', 'natural logarithm of 2', 'log 2'] },
  {
    key: 'gamma', name: 'Euler–Mascheroni constant', symbol: 'γ', value: '0.57721566490153286060651209008240243',
    names: ["euler's constant", 'eulers constant', 'euler constant', 'euler-mascheroni constant', 'euler mascheroni constant', 'euler–mascheroni constant', 'euler-mascheroni', 'euler mascheroni', 'euler–mascheroni', "euler's gamma", 'euler gamma'],
    bare: ['gamma', 'γ'],
    note: 'Limit of the harmonic series minus ln n. For e (2.71828…), ask for Euler’s number',
  },
  { key: 'catalan', name: "Catalan's constant", symbol: 'G', value: '0.91596559417721901505460351493238411', names: ["catalan's constant", 'catalans constant', 'catalan constant'], bare: [] },
  { key: 'apery', name: "Apéry's constant", symbol: 'ζ(3)', value: '1.20205690315959428539973816151144999', names: ["apéry's constant", "apery's constant", 'aperys constant', 'apery constant', 'apéry constant', 'zeta of 3', 'zeta 3'], bare: ['ζ(3)', 'zeta(3)'] },
  { key: 'feigenbaum', name: 'Feigenbaum constant δ', symbol: 'δ', value: '4.66920160910299067185320382046620161', names: ['feigenbaum constant', "feigenbaum's constant", 'feigenbaum delta', 'feigenbaum δ', 'first feigenbaum constant', 'feigenbaum number'], bare: [] },
  { key: 'feigenbaumAlpha', name: 'Feigenbaum constant α', symbol: 'α', value: '2.50290787509589282228390287321821578', names: ['second feigenbaum constant', 'feigenbaum alpha', 'feigenbaum α'], bare: [] },
];

export interface Sequence {
  key: string;
  name: string;
  /** Phrases, singular and plural ("prime", "primes", "prime numbers"). */
  names: string[];
  /** Whether "the first N" starts at index 0 (F₀ = 0) — affects the note only. */
  startNote?: string;
  /** First n terms. */
  terms(n: number): bigint[];
  /** The nth term, 1-based (the 10th prime is 29, the 10th Fibonacci number is 55). */
  nth(n: number): bigint;
  oeis: string;
}

function primes(n: number): bigint[] {
  const out: bigint[] = [];
  if (n <= 0) return out;
  // Upper bound for the nth prime (Rosser): n (ln n + ln ln n) for n ≥ 6.
  const limit = n < 6 ? 15 : Math.ceil(n * (Math.log(n) + Math.log(Math.log(n))));
  const sieve = new Uint8Array(limit + 1);
  for (let i = 2; i <= limit && out.length < n; i++) {
    if (sieve[i]) continue;
    out.push(BigInt(i));
    for (let j = i * i; j <= limit; j += i) sieve[j] = 1;
  }
  return out;
}

function fib(n: number): bigint[] {
  const out: bigint[] = [];
  let a = 0n;
  let b = 1n;
  for (let i = 0; i < n; i++) {
    out.push(a);
    [a, b] = [b, a + b];
  }
  return out;
}

function catalan(n: number): bigint[] {
  const out: bigint[] = [];
  let c = 1n;
  for (let i = 0; i < n; i++) {
    out.push(c);
    c = (c * 2n * (2n * BigInt(i) + 1n)) / (BigInt(i) + 2n);
  }
  return out;
}

function factorials(n: number): bigint[] {
  const out: bigint[] = [];
  let f = 1n;
  for (let i = 0; i < n; i++) {
    out.push(f);
    f *= BigInt(i + 1);
  }
  return out;
}

const range = (n: number, f: (i: bigint) => bigint) => Array.from({ length: Math.max(0, n) }, (_, i) => f(BigInt(i + 1)));

export const SEQUENCES: Sequence[] = [
  { key: 'primes', name: 'Prime numbers', names: ['prime numbers', 'prime number', 'primes', 'prime'], terms: primes, nth: (n) => primes(n)[n - 1]!, oeis: 'A000040' },
  { key: 'fibonacci', name: 'Fibonacci numbers', names: ['fibonacci numbers', 'fibonacci number', 'fibonacci sequence', 'fibonacci series', 'fibonacci'], startNote: 'Starting from F₀ = 0', terms: fib, nth: (n) => fib(n + 1)[n]!, oeis: 'A000045' },
  { key: 'squares', name: 'Square numbers', names: ['perfect squares', 'square numbers', 'perfect square', 'square number', 'squares'], terms: (n) => range(n, (i) => i * i), nth: (n) => BigInt(n) ** 2n, oeis: 'A000290' },
  { key: 'cubes', name: 'Cube numbers', names: ['perfect cubes', 'cube numbers', 'cube number', 'cubes'], terms: (n) => range(n, (i) => i * i * i), nth: (n) => BigInt(n) ** 3n, oeis: 'A000578' },
  { key: 'triangular', name: 'Triangular numbers', names: ['triangular numbers', 'triangular number', 'triangle numbers', 'triangle number'], terms: (n) => range(n, (i) => (i * (i + 1n)) / 2n), nth: (n) => (BigInt(n) * BigInt(n + 1)) / 2n, oeis: 'A000217' },
  { key: 'catalan', name: 'Catalan numbers', names: ['catalan numbers', 'catalan number', 'catalan sequence'], startNote: 'Starting from C₀ = 1', terms: catalan, nth: (n) => catalan(n + 1)[n]!, oeis: 'A000108' },
  { key: 'factorials', name: 'Factorials', names: ['factorials', 'factorial numbers'], startNote: 'Starting from 0! = 1', terms: factorials, nth: (n) => factorials(n + 1)[n]!, oeis: 'A000142' },
  { key: 'powers2', name: 'Powers of 2', names: ['powers of 2', 'powers of two'], startNote: 'Starting from 2⁰ = 1', terms: (n) => range(n, (i) => 2n ** (i - 1n)), nth: (n) => 2n ** BigInt(n), oeis: 'A000079' },
];

/** CODATA 2018 values not already in science-engine's list. */
export interface ExtraConstant {
  key: string;
  name: string;
  symbol: string;
  value: string;
  unit: string;
  spokenUnit: string;
  /** Standard uncertainty in the same unit; null when exact. */
  uncertainty: string | null;
  names: string[];
}

export const EXTRA_CONSTANTS: ExtraConstant[] = [
  { key: 'alpha', name: 'Fine-structure constant', symbol: 'α', value: '7.2973525693e-3', unit: '', spokenUnit: '', uncertainty: '0.0000000011e-3', names: ['fine-structure constant', 'fine structure constant', 'fine-structure', 'fine structure'] },
  { key: 'a0', name: 'Bohr radius', symbol: 'a₀', value: '5.29177210903e-11', unit: 'm', spokenUnit: 'metres', uncertainty: '0.00000000080e-11', names: ['bohr radius', 'radius of a hydrogen atom', 'radius of hydrogen atom'] },
  { key: 'u', name: 'Atomic mass constant', symbol: 'u', value: '1.66053906660e-27', unit: 'kg', spokenUnit: 'kilograms', uncertainty: '0.00000000050e-27', names: ['atomic mass constant', 'atomic mass unit', 'unified atomic mass unit', 'dalton', 'one dalton'] },
  { key: 'b', name: 'Wien wavelength displacement constant', symbol: 'b', value: '2.897771955e-3', unit: 'm·K', spokenUnit: 'metre kelvins', uncertainty: null, names: ["wien's displacement constant", 'wiens displacement constant', 'wien displacement constant', "wien's constant", 'wien constant'] },
];
