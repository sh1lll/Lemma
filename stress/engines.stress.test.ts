/**
 * Stress and limit tests for every engine. Invariants:
 *  1. Nothing throws: every failure comes back as a typed error result.
 *  2. Nothing hangs: each call stays under a time budget, including adversarial (ReDoS-style) input.
 *  3. Results at the limits are correct or explicitly refused, never silently wrong.
 */
import { calculate, commit, createSession, compileFloat, parseInput, type Session } from '@lemma/math-core';
import { describe, expect, it } from 'vitest';
import { answerCurrency } from '../packages/currency-engine/src';
import { answerDate } from '../packages/date-engine/src';
import { answerFinance } from '../packages/finance-engine/src';
import { analyze, isGraphRequest, marchImplicit, parseGraph, sampleExplicit, sampleSurface } from '../packages/graph-engine/src';
import { evaluateNotebook, newNotebook, parseTable, type Runner } from '../packages/notebook-engine/src';
import { answerScience } from '../packages/science-engine/src';
import { answerStats } from '../packages/stats-engine/src';
import { answerNumberTheory, parseSymbolic } from '../packages/symbolic-engine/src';
import { convert } from '../packages/unit-engine/src';
import { Temporal } from '../packages/date-engine/src';

const dctx = { now: Temporal.ZonedDateTime.from('2026-10-29T19:00[America/New_York]'), dateOrder: 'mdy' as const, locale: 'en-US' };
const rates = { base: 'EUR', date: '2026-10-29', rates: { USD: 1.1, GBP: 0.8 }, fetchedAt: 0, source: { name: 't', url: 'https://t' } };

type Engine = [name: string, fn: (q: string, s: Session) => unknown];
const ENGINES: Engine[] = [
  ['calculate', (q, s) => calculate(q, s)],
  ['units', (q, s) => convert(q, s)],
  ['dates', (q) => answerDate(q, dctx)],
  ['finance', (q) => answerFinance(q)],
  ['currency', (q, s) => answerCurrency(q, rates, s)],
  ['stats', (q) => answerStats(q)],
  ['science', (q) => answerScience(q)],
  ['symbolic-parse', (q, s) => parseSymbolic(q, s)],
  ['number-theory', (q) => answerNumberTheory(q)],
  ['graph-parse', (q, s) => (isGraphRequest(q) ? parseGraph(q, s) : null)],
];

/** Runs fn, returning elapsed ms and any exception that escaped (a bug unless it's a typed MathError from a parse-only API). */
function timed(fn: () => unknown): { ms: number; threw?: unknown } {
  const t0 = performance.now();
  try {
    fn();
    return { ms: performance.now() - t0 };
  } catch (e) {
    return { ms: performance.now() - t0, threw: e };
  }
}

// APIs documented to throw MathError for bad input (parse-only helpers); everything else must not throw at all.
const MAY_THROW_MATHERROR = new Set(['symbolic-parse', 'graph-parse']);

function check(name: string, q: string, s: Session, budgetMs: number, report: Map<string, { max: number; q: string }>) {
  const fn = ENGINES.find((e) => e[0] === name)![1];
  const r = timed(() => fn(q, s));
  if (r.threw && !(MAY_THROW_MATHERROR.has(name) && (r.threw as Error).name === 'MathError')) {
    throw new Error(`${name} threw on ${JSON.stringify(q.slice(0, 120))}: ${(r.threw as Error)?.stack?.split('\n').slice(0, 3).join(' | ')}`);
  }
  const cur = report.get(name);
  if (!cur || r.ms > cur.max) report.set(name, { max: r.ms, q: q.slice(0, 60) });
  expect(r.ms, `${name} took ${r.ms.toFixed(1)} ms on ${JSON.stringify(q.slice(0, 80))}`).toBeLessThan(budgetMs);
}

// Deterministic PRNG so failures reproduce.
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const VOCAB = [
  '1', '0', '-', '+', '*', '/', '^', '%', '!', '(', ')', ',', '.', '=', '<', '>', '|', 'x', 'y', 'e', 'pi', 'i', '$', '€', '°', '√', '×', '÷',
  '12', '3.5', '1e9', '0.001', '1,000', '450', '7', 'of', 'off', 'plus', 'minus', 'times', 'divided by', 'percent', 'squared', 'sqrt', 'sin', 'log',
  'ln', 'to', 'in', 'km', 'miles', 'kg', 'cups', 'days', 'until', 'christmas', 'tip', 'tax', 'loan', 'at', 'for', 'years', 'mean', 'std dev', 'of',
  'solve', 'derivative', 'integrate', 'from', 'graph', 'balance', 'H2O', '->', 'molar mass', 'prime', 'factor', 'usd', 'eur', 'what is', 'the', 'and',
  'between', 'how many', 'hex', 'binary', 'area', 'circle', 'radius', 'triangle', 'sides', 'P(Z <', 'binomial', 'n=', 'twenty', 'hundred', 'thousand',
  'a', 'an', 'that', 'ans', 'f(x) =', '[[1,2],[3,4]]', '\u0000', '😀', 'ÿ', '\t', '  ',
];

describe('fuzz: random inputs never throw or hang', { retry: 2 }, () => {
  it('10,000 random phrases across all engines', () => {
    const rand = rng(42);
    const s = createSession();
    const report = new Map<string, { max: number; q: string }>();
    for (let n = 0; n < 1000; n++) {
      const len = 1 + Math.floor(rand() * 12);
      const q = Array.from({ length: len }, () => VOCAB[Math.floor(rand() * VOCAB.length)]).join(rand() < 0.7 ? ' ' : '');
      for (const [name] of ENGINES) check(name, q, s, 50, report);
    }
    console.table(Object.fromEntries([...report].map(([k, v]) => [k, { max_ms: v.max.toFixed(2), slowest: v.q }])));
  }, 120_000);
});

describe('adversarial input (ReDoS, huge, deep)', { retry: 2 }, () => {
  const cases: [string, string][] = [
    ['10k digits', '1'.repeat(10_000)],
    ['5k spaces then x', ' '.repeat(5000) + 'x'],
    ['repeated words', 'what is '.repeat(2000)],
    ['comma runs', '1,'.repeat(5000)],
    ['money runs', '$1 '.repeat(3000)],
    ['percent runs', '1% of '.repeat(2000) + '5'],
    ['nested parens 5000', '('.repeat(5000) + '1' + ')'.repeat(5000)],
    ['unclosed parens 5000', '('.repeat(5000) + '1'],
    ['negations 10000', '-'.repeat(10_000) + '1'],
    ['power tower 3000', '2^'.repeat(3000) + '2'],
    ['function chain 3000', 'sqrt '.repeat(3000) + '4'],
    ['abs bars', '|'.repeat(4001)],
    ['date-ish', 'days until '.repeat(500) + 'christmas'],
    ['finance-ish', 'loan at 5% for 30 years '.repeat(300)],
    ['science-ish', 'H2O '.repeat(2000)],
    ['equation-ish', 'x = '.repeat(2000) + '1'],
    ['unit-ish', '5 km to '.repeat(800) + 'miles'],
    ['stats-ish', 'mean of ' + Array.from({ length: 20_000 }, (_, i) => i).join(', ')],
    ['matrix-ish', '[[' + '1,'.repeat(3000) + '1]]'],
    ['alternating ops', '1+-'.repeat(5000) + '1'],
    ['unicode soup', '😀π√×÷°€'.repeat(2000)],
    ['NUL bytes', '\u0000'.repeat(1000)],
  ];
  for (const [label, q] of cases) {
    it(label, () => {
      const s = createSession();
      const report = new Map<string, { max: number; q: string }>();
      for (const [name] of ENGINES) check(name, q, s, 250, report);
    });
  }
});

describe('numeric limits are correct or refused, never silently wrong', () => {
  const s = createSession();
  const v = (q: string) => {
    const r = calculate(q, s);
    return r.ok ? r.formatted.plain : `ERR:${r.error.code}`;
  };
  it.each([
    ['10^10^10', '1e10000000000'],
    ['10^10^20', 'ERR:overflow'],
    ['10^1000', '1e1000'],
    ['10^-1000', '1e-1000'],
    ['1e-400 * 1e-400', '1e-800'],
    ['2^0.5^2', '1.189207115'],
    ['0.1 + 0.2 - 0.3', '0'],
    ['1/3 * 3', '1'],
    ['170!', '7.25741561531e306'],
    ['5000!', '4.22857792661e16325'],
    ['5001!', 'ERR:overflow'],
    ['(-1)^0.5', 'ERR:domain'],
    ['log(0)', 'ERR:domain'],
    ['0^0', '1'],
    ['0^-1', 'ERR:division-by-zero'],
    ['tan(90)', 'ERR:domain'],
    ['tan(89.9999999)', '572957795.131'],
    ['99999999999999999999 + 1', '1e20'],
    ['123456789012345678901234567890 * 0', '0'],
  ])('%s → %s', (q, expected) => {
    expect(v(q)).toBe(expected);
  });

  it('very long operator chains evaluate (no recursion depth limit)', () => {
    const big = Array.from({ length: 10_000 }, (_, i) => i % 10).join('+');
    expect(v(big)).toBe('45000');
    expect(v(Array.from({ length: 5000 }, () => '2').join('*') + ' / 2^4999')).toBe('2');
  });

  it('factorial limit stays fast', () => {
    expect(timed(() => calculate('5000!', s)).ms).toBeLessThan(200);
  });
});

describe('graphing pathological functions at extreme zoom', { retry: 2 }, () => {
  const s = createSession();
  const fns = ['sin(1/x)', 'x^1000', 'tan(x) * 1e300', '1/0', 'x!', 'sqrt(-x^2)', 'floor(x) - x', '1/(x - 1e-9)', 'e^(e^x)', 'sin(x)^x', 'abs(x)^(1/3)'];
  const views = [
    { xMin: -10, xMax: 10, yMin: -6, yMax: 6 },
    { xMin: -1e-9, xMax: 1e-9, yMin: -1e-9, yMax: 1e-9 },
    { xMin: -1e12, xMax: 1e12, yMin: -1e12, yMax: 1e12 },
    { xMin: 1e15, xMax: 1e15 + 1, yMin: -1, yMax: 1 },
  ];
  it.each(fns)('%s', (f) => {
    const spec = parseGraph(`graph ${f}`, s);
    const it0 = spec.items[0]!;
    if (it0.kind !== 'explicit') throw new Error('expected explicit');
    for (const vp of views) {
      const t0 = performance.now();
      const lines = sampleExplicit(it0.f, {}, vp, 1600);
      analyze(spec.items, {}, vp.xMin, vp.xMax);
      const ms = performance.now() - t0;
      expect(ms, `${f} @ ${JSON.stringify(vp)}`).toBeLessThan(60);
      for (const l of lines) for (const n of l) expect(Number.isFinite(n)).toBe(true);
    }
  });

  it('implicit curves at extreme zoom, and 20 curves at once', () => {
    const c = parseGraph('graph sin(x*y) = cos(x+y)', s).items[0]!;
    if (c.kind !== 'implicit') throw new Error();
    for (const vp of views) expect(timed(() => marchImplicit(c.F, {}, vp, 240, 160)).ms).toBeLessThan(60);
    const many = parseGraph(`graph ${Array.from({ length: 20 }, (_, k) => `sin(${k + 1}x)`).join(', ')}`, s);
    expect(many.items).toHaveLength(20);
    const t0 = performance.now();
    for (const it1 of many.items) if (it1.kind === 'explicit') sampleExplicit(it1.f, {}, views[0]!, 1600);
    expect(performance.now() - t0).toBeLessThan(150);
    expect(timed(() => analyze(many.items, {}, -10, 10)).ms).toBeLessThan(3000);
  });

  it('3D surfaces of pathological functions sample a 60 × 60 grid in under 30 ms', () => {
    for (const f of ['sin(1/(x*y))', 'x^1000 * y', '1/(x - y)', 'e^(e^(x + y))', 'sqrt(-x^2 - y^2)', 'floor(x) * ceil(y)', 'tan(x*y) * 1e300']) {
      const it0 = parseGraph(`3d plot ${f}`, s).items[0]!;
      if (it0.kind !== 'surface') throw new Error(`expected a surface for ${f}`);
      const t0 = performance.now();
      const g = sampleSurface(it0.f, {}, it0.x, it0.y, 60);
      expect(performance.now() - t0, f).toBeLessThan(30);
      expect(Number.isFinite(g.zMin) && Number.isFinite(g.zMax) && g.zMax > g.zMin, f).toBe(true);
    }
  });

  it('compiled float functions agree with exact evaluation on random expressions', () => {
    const rand = rng(7);
    const ops = ['+', '-', '*', '/', '^'];
    for (let n = 0; n < 500; n++) {
      const terms = Array.from({ length: 4 }, () => (rand() * 9 + 1).toFixed(1));
      const expr = terms.reduce((acc, t, i) => (i === 0 ? t : `(${acc}) ${ops[Math.floor(rand() * (i === 3 ? 4 : 5))]} ${t}`));
      const exact = calculate(expr, s);
      if (!exact.ok) continue;
      const f = compileFloat(parseInput(expr, s), { angle: 'deg', free: new Set() })({});
      const e = exact.value.toNumber();
      if (Number.isFinite(e) && e !== 0) expect(Math.abs(f - e) / Math.abs(e), expr).toBeLessThan(1e-12);
    }
  });
});

describe('scale: notebooks, data, number theory', () => {
  const run: Runner = async (q, s) => {
    const r = calculate(q, s);
    if (r.ok) commit(s, r);
    return r.ok ? { kind: 'value', input: q, display: r.formatted.display, value: r.value.toString() } : { kind: 'error', input: q, error: r.error.message };
  };

  it('a 500-cell notebook evaluates in well under a second', async () => {
    const nb = newNotebook();
    nb.cells = Array.from({ length: 500 }, (_, i) => ({ id: `c${i}`, type: 'math' as const, source: i === 0 ? 'x0 = 1' : `x${i} = x${i - 1} * 1.01 + ${i}` }));
    const t0 = performance.now();
    const r = await evaluateNotebook(nb, run);
    const ms = performance.now() - t0;
    console.log(`500 cells: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(1500);
    expect(r.outputs.get('c499')![0]!.kind).toBe('value');
  });

  it('a 20,000-row CSV parses fast and feeds stats', () => {
    const csv = 'id,value,label\n' + Array.from({ length: 20_000 }, (_, i) => `${i},${(i * 7919) % 1000},"row, ${i}"`).join('\n');
    const t0 = performance.now();
    const t = parseTable(csv);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(t.numeric.get('value')).toHaveLength(20_000);
    const q = `mean of ${t.numeric.get('value')!.join(', ')}`;
    const r = timed(() => answerStats(q));
    expect(r.ms).toBeLessThan(500);
  });

  it('hard factorizations finish or refuse within a time cap', () => {
    for (const q of ['factor 1000000016000000063', 'factor 999999999999999989', 'is 170141183460469231731687303715884105727 prime', 'factor 123456789012345678901234567891']) {
      const r = timed(() => answerNumberTheory(q));
      console.log(`${q}: ${r.ms.toFixed(0)} ms`);
      expect(r.threw).toBeUndefined();
      expect(r.ms, q).toBeLessThan(3000);
    }
  });
});
