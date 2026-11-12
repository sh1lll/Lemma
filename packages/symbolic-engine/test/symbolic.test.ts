import { calculate, commit, createSession, type Answer, type CalcSuccess } from '@lemma/math-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { answerNumberTheory, complexRequest, isPrime, LOOKS_LIKE_SYMBOLIC, parseSymbolic, PYTHON_SOURCE, toAnswer, type SymRequest, type SymResult } from '../src';

const s = createSession();

describe('request parsing', () => {
  it.each([
    ['derivative of sin(x)', 'diff'],
    ['d/dx x^3', 'diff'],
    ['second derivative of x^4', 'diff'],
    ['integrate x^2 from 0 to 1', 'integrate'],
    ['integral of sin x dx', 'integrate'],
    ['limit of sin(x)/x as x -> 0', 'limit'],
    ['lim x->0 sin(x)/x', 'limit'],
    ['solve x^2 - 4 = 0', 'solve'],
    ['2x + 3 = 7', 'solve'],
    ['solve x + y = 3, x - y = 1', 'solve'],
    ['factor x^2 - 5x + 6', 'factor'],
    ['expand (x+1)^3', 'expand'],
    ['simplify (x^2-1)/(x-1)', 'simplify'],
    ['partial fractions of 1/(x^2-1)', 'apart'],
    ['taylor series of e^x', 'series'],
    ["solve y'' + y = 0", 'dsolve'],
    ['laplace transform of t^2', 'laplace'],
    ['determinant of [[1,2],[3,4]]', 'matrix'],
    ['[[1,2],[3,4]] * [[5],[6]]', 'matrix'],
  ])('%s → %s', (q, op) => {
    expect(parseSymbolic(q, s)?.op).toBe(op);
  });

  it('pre-check admits every equation form the parser accepts', () => {
    for (const q of ['2x + 3 = 11', 'x^2 = 2', '3 = 2x - 1', 'x^2 < 4', 'solve 5 = x']) expect(LOOKS_LIKE_SYMBOLIC.test(q), q).toBe(true);
  });

  it('leaves calculator input alone', () => {
    for (const q of ['2 + 2', 'x = 5', 'y = 2x + 1', '20% of 450', 'factor 360', 'sqrt 2', 'days until christmas']) expect(parseSymbolic(q, s), q).toBeNull();
  });

  it('prints exact SymPy and inlines user formulas', () => {
    const t = createSession();
    commit(t, calculate('f(x) = x^2 + 1', t) as CalcSuccess);
    expect(parseSymbolic('derivative of f(x)', t)?.exprs[0]).toMatch(/^\(+Symbol\('x'\)\)+\*\*\(2\)\)\+\(1\)\)$/);
    expect(parseSymbolic('integrate 0.5x', t)?.exprs[0]).toBe("(Rational('0.5'))*(Symbol('x'))");
  });
});

describe('number theory (native)', () => {
  const show = (q: string) => (answerNumberTheory(q) as Answer).primary.display;
  it.each([
    ['is 97 prime', 'Yes, prime'],
    ['is 91 prime', 'No'],
    ['prime factorization of 360', '2³ × 3² × 5'],
    ['factor 1001', '7 × 11 × 13'],
    ['divisors of 28', '1, 2, 4, 7, 14, 28'],
    ['next prime after 100', '101'],
    ['100th prime', '541'],
    ['primes between 10 and 30', '11, 13, 17, 19, 23, 29'],
    ['totient of 36', '12'],
  ])('%s → %s', (q, expected) => expect(show(q)).toBe(expected));

  it('handles big numbers', () => {
    expect(isPrime(2n ** 61n - 1n)).toBe(true); // Mersenne prime M61
    expect(show('factor 600851475143')).toBe('71 × 839 × 1471 × 6857');
  });
});

// Real SymPy via Pyodide in Node. Downloads the runtime once (cached by npm), so it is slow the first time.
describe.skipIf(process.env.LEMMA_OFFLINE === '1')('SymPy worker logic', () => {
  let run: (req: SymRequest) => SymResult;
  beforeAll(async () => {
    const { loadPyodide } = await import('pyodide');
    const py = await loadPyodide();
    await py.loadPackage('sympy');
    py.runPython(PYTHON_SOURCE);
    const handle = py.globals.get('handle');
    run = (req) => JSON.parse(handle(JSON.stringify(req))) as SymResult;
  }, 180_000);

  const ask = (q: string) => {
    const req = parseSymbolic(q, s) ?? complexRequest(q, s)!;
    const a = toAnswer(q, req, run(req));
    if (!a.ok) throw new Error(`${q}: ${a.error.message}`);
    return a;
  };

  it('differentiates and integrates, verifying antiderivatives', () => {
    expect(ask('derivative of x^2 + 3x').primary.display).toBe('2x + 3');
    expect(ask('derivative of sin(x)*x').primary.display).toBe('x·cos(x) + sin(x)');
    const i = ask('integrate x^2*e^x');
    expect(i.primary.display).toBe('(x² − 2x + 2)·e^x + C');
    expect(i.verified?.ok).toBe(true);
    const d = ask('integrate x^2 from 0 to 3');
    expect(d.primary.display).toBe('9');
    expect(d.verified?.ok).toBe(true);
    expect(ask('integral of e^(-x^2) from -inf to inf').primary.display).toBe('√π');
  }, 60_000);

  it('solves equations, systems and inequalities', () => {
    const q = ask('solve x^2 - 5x + 6 = 0');
    expect(q.primary.display).toBe('x = 2 or x = 3');
    expect(q.verified?.ok).toBe(true);
    expect(q.lines?.map((l) => l.display)).toEqual(['2', '3']);
    expect(ask('solve x^2 = 2').lines?.[1]?.display).toBe('√2  ≈ 1.41421356237');
    expect(ask('solve x^2 + 1 = 0').notes[0]).toMatch(/complex/);
    expect(ask('solve x + y = 3, x - y = 1').primary.display).toBe('x = 2, y = 1');
    expect(ask('solve x^2 < 4').primary.display).toBe('−2 < x < 2');
    expect(ask('2x + 3 = 7').primary.display).toBe('x = 2');
  }, 60_000);

  it('limits, series, algebra, ODEs, transforms, matrices, complex numbers', () => {
    expect(ask('limit of sin(x)/x as x -> 0').primary.display).toBe('1');
    expect(ask('limit of (1 + 1/x)^x as x -> infinity').primary.display).toBe('e');
    expect(ask('limit of 1/x as x -> 0').primary.display).toBe('Does not exist');
    expect(ask('factor x^2 - 5x + 6').primary.display).toBe('(x − 3)(x − 2)');
    expect(ask('expand (x+1)^3').primary.display).toBe('x³ + 3x² + 3x + 1');
    expect(ask('partial fractions of 1/(x^2-1)').primary.display).toBe('−1/(2(x + 1)) + 1/(2(x − 1))');
    expect(ask('maclaurin series of sin(x)').primary.display).toBe('x − x³/6 + x⁵/120 + …');
    const ode = ask("solve y'' + y = 0");
    expect(ode.primary.display).toBe('y = C₁sin(x) + C₂cos(x)');
    expect(ode.verified?.ok).toBe(true);
    expect(ask('laplace transform of t^2').primary.display).toBe('2/s³');
    expect(ask('determinant of [[1,2],[3,4]]').primary.display).toBe('−2');
    expect(ask('eigenvalues of [[2,0],[0,3]]').primary.display).toBe('λ = 2, 3');
    expect(ask('inverse of [[1,2],[3,4]]').verified?.ok).toBe(true);
    expect(ask('sqrt(-4)').primary.display).toBe('2i');
    expect(ask('(2+3i)*(1-i)').primary.display).toBe('5 + i');
  }, 90_000);
});
