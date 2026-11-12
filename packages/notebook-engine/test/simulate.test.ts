import { calculate, commit, type Session } from '@lemma/math-core';
import { describe, expect, it } from 'vitest';
import { evaluateNotebook, newNotebook, parseSimulateLine, Rng, runSimulation, withSeed, type Runner } from '../src';

const sim = (line: string) => {
  const s = parseSimulateLine(line);
  return runSimulation({ body: s.body, trials: s.trials, seed: s.seed });
};

describe('simulation cells', () => {
  it('parses the header: trials, seed, default seed from the text', () => {
    expect(parseSimulateLine('simulate 10000: sum of 2 dice >= 10')).toMatchObject({ trials: 10000, seedGiven: false, body: 'sum of 2 dice >= 10' });
    expect(parseSimulateLine('simulate 5k seed 42: coin')).toMatchObject({ trials: 5000, seed: 42, seedGiven: true });
    expect(parseSimulateLine('simulate: coin').trials).toBe(10000);
    expect(parseSimulateLine('simulate 100: coin').seed).toBe(parseSimulateLine('simulate 100: coin').seed);
    expect(() => parseSimulateLine('simulate 5000000: coin')).toThrow(/At most/);
    expect(withSeed('simulate 10000: coin', 7)).toBe('simulate 10000 seed 7: coin');
    expect(withSeed('simulate 10000 seed 3: coin', 7)).toBe('simulate 10000 seed 7: coin');
  });

  it('is reproducible for a seed, and changes with it', () => {
    const a = sim('simulate 2000 seed 1: normal(0, 1) > 1');
    const b = sim('simulate 2000 seed 1: normal(0, 1) > 1');
    const c = sim('simulate 2000 seed 2: normal(0, 1) > 1');
    expect(a.estimate).toBe(b.estimate);
    expect(a.estimate).not.toBe(c.estimate);
    // xoshiro128** output is uniform-looking.
    const r = new Rng(123);
    let m = 0;
    for (let i = 0; i < 100_000; i++) m += r.next();
    expect(Math.abs(m / 100_000 - 0.5)).toBeLessThan(0.005);
  });

  // Estimates must land inside their 95% CI around the exact value; with fixed seeds this is deterministic.
  it.each([
    ['simulate 10000: sum of 2 dice >= 10', 1 / 6, '1/6'],
    ['simulate 10000: 3 dice == 10', 27 / 216, '1/8'],
    ['simulate 20000: heads in 10 flips >= 7', 176 / 1024, '11/64'],
    ['simulate 10000: coin flip', 0.5, '1/2'],
    ['simulate 5000: x = normal(100, 15); x > 130', 0.0227501319, undefined],
    ['simulate 10000: x = normal(0, 1); x > -1.96 and x < 1.96', 0.9500042097, undefined],
    ['simulate 10000: abs(walk(100)) >= 10', 0, undefined],
    ['simulate 10000: uniform(0, 1) < 0.3', 0.3, undefined],
    ['simulate 10000: exponential(2) > 1', Math.exp(-2), undefined],
    ['simulate 10000: poisson(3) == 0', Math.exp(-3), undefined],
    ['simulate 10000: randint(1, 10) <= 3', 0.3, '3/10'],
  ])('%s', (line, exact, fraction) => {
    const s = sim(line);
    expect(s.mode).toBe('probability');
    expect(s.exact).toBeDefined();
    if (exact) expect(s.exact!.value).toBeCloseTo(exact, 6);
    expect(s.exact!.fraction).toBe(fraction);
    expect(s.exact!.withinCI).toBe(true);
    expect(s.lo).toBeLessThanOrEqual(s.estimate);
    expect(s.hi).toBeGreaterThanOrEqual(s.estimate);
  });

  it('exact random-walk probability matches the binomial', () => {
    // P(|S_100| >= 10) = P(|2B - 100| >= 10) for B ~ Bin(100, 1/2) ≈ 0.3682.
    expect(sim('simulate 1000: abs(walk(100)) >= 10').exact!.value).toBeCloseTo(0.36820, 4);
  });

  it('estimates means with an interval and compares to the exact mean', () => {
    const s = sim('simulate 20000: sum of 2 dice');
    expect(s.mode).toBe('mean');
    expect(s.exact?.value).toBeCloseTo(7, 9);
    expect(s.exact?.withinCI).toBe(true);
    const n = sim('simulate 20000: normal(100, 15)');
    expect(n.exact?.value).toBeCloseTo(100, 6);
    expect(n.exact?.withinCI).toBe(true);
  });

  it('draws a histogram of the random quantity, highlighting hits', () => {
    const s = sim('simulate 10000: sum of 2 dice >= 10');
    expect(s.histogram.discrete).toBe(true);
    expect(s.histogram.bins.map((b) => b.x0)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(s.histogram.bins.filter((b) => b.hits).map((b) => b.x0)).toEqual([10, 11, 12]);
    expect(s.histogram.bins.reduce((a, b) => a + b.count, 0)).toBe(10000);
    expect(sim('simulate 5000: x = normal(100, 15); x > 130').histogram).toMatchObject({ discrete: false, label: 'x' });
    expect(sim('simulate 5000: 130 < normal(100, 15)').exact!.value).toBeCloseTo(0.02275, 4);
  });

  it('says when no exact value is available', () => {
    expect(sim('simulate 2000: dice(1) + dice(1) >= 10').exactNote).toMatch(/more than one random draw/);
  });

  it('runs 100k trials well under a second', () => {
    const t0 = performance.now();
    const s = sim('simulate 100000: x = normal(100, 15); x > 130');
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(s.exact!.withinCI).toBe(true);
  });

  it('reports mistakes clearly', () => {
    expect(() => sim('simulate 100: foo(3) > 1')).toThrow(/Unknown function/);
    expect(() => sim('simulate 100: y > 1')).toThrow(/isn’t defined/);
    expect(() => sim('simulate 100: dice(1,2,3)')).toThrow(/dice\(n, sides = 6\)/);
  });
});

describe('simulations inside a notebook', () => {
  const run: Runner = async (q: string, s: Session) => {
    const r = calculate(q, s);
    if (!r.ok) return { kind: 'error', input: q, error: r.error.message };
    commit(s, r);
    return { kind: 'value', input: q, display: r.formatted.display, value: r.value.toString() };
  };

  it('uses notebook variables, binds the estimate, and shows exact comparisons', async () => {
    const nb = { ...newNotebook('t'), cells: [
      { id: 'a', type: 'math' as const, source: 'mu = 100\nsigma = 15' },
      { id: 'b', type: 'math' as const, source: 'p = simulate 20000 seed 3: normal(mu, sigma) > 130' },
      { id: 'c', type: 'math' as const, source: 'p * 100' },
    ] };
    const r = await evaluateNotebook(nb, run);
    const out = r.outputs.get('b')![0]!;
    expect(out.kind).toBe('simulation');
    expect(out.display).toMatch(/^P ≈ 0\.0\d/);
    expect(out.lines?.find((l) => l.label === 'Exact')?.display).toMatch(/0\.02275.*inside the CI ✓/);
    expect(out.binding?.name).toBe('p');
    expect(out.simulation).toMatchObject({ seed: 3, seedGiven: true, trials: 20000 });
    expect(r.outputs.get('c')![0]!.display).toMatch(/^2\./);
  });

  it('can run simulations through a host hook (a Worker in the app)', async () => {
    const seen: number[] = [];
    const nb = { ...newNotebook('t'), cells: [{ id: 'a', type: 'math' as const, source: 'simulate 100 seed 9: coin' }] };
    const r = await evaluateNotebook(nb, run, undefined, {
      simulate: async (req) => {
        seen.push(req.seed);
        return runSimulation(req);
      },
    });
    expect(seen).toEqual([9]);
    expect(r.outputs.get('a')![0]!.kind).toBe('simulation');
  });
});
