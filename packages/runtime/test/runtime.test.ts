import { commit, createSession, MathError } from '@lemma/math-core';
import { describe, expect, it } from 'vitest';
import { outcomeToJSON, Runtime, type Outcome } from '../src';
import { createNodeRuntime } from '../src/node';

const json = async (rt: Runtime, q: string, s = createSession()) => outcomeToJSON(await rt.compute(q, s), q);

describe('runtime', () => {
  const rt = new Runtime();

  it('routes every engine family through one entry point, waiting out lazy loads', async () => {
    expect((await json(rt, '20% of 450 + 30')).display).toBe('120');
    expect((await json(rt, '50 miles to km')).display).toBe('80.4672');
    expect((await json(rt, 'is 2028 a leap year')).display).toBe('Yes');
    expect((await json(rt, '18% tip on $64.50')).display).toBe('$11.61');
    expect((await json(rt, 'std dev of 2 4 4 4 5 5 7 9')).display).toBe('2.1380899353');
    expect((await json(rt, 'molar mass of water')).display).toMatch(/^18\.015/);
    expect((await json(rt, 'graph x^2')).kind).toBe('graph');
    expect((await json(rt, 'timer 5 minutes')).display).toBe('5m');
  });

  it('serialises results without losing precision, with alternatives and errors', async () => {
    const r = await json(rt, '20 percent of 450 plus 30');
    expect(r).toMatchObject({ ok: true, kind: 'calc', value: '120', alternatives: [{ display: '96' }] });
    expect((await json(rt, '1/3')).value).toMatch(/^0\.3333333333333333333/);
    expect(await json(rt, '1/0')).toMatchObject({ ok: false, error: { code: 'division-by-zero' } });
  });

  it('reports symbolic as unavailable without a backend, and currency without rates', async () => {
    expect((await json(rt, 'derivative of x^2')).error?.message).toMatch(/not available/);
    expect((await json(rt, '100 usd to eur')).error?.message).toMatch(/not available/);
  });

  it('lets hooks (plugins) answer first', async () => {
    const hooked = new Runtime({
      hooks: [{ route: (q): Outcome | null => (/^ping$/.test(q) ? { kind: 'error', error: new MathError('domain', 'pong') } : null) }],
    });
    expect((await json(hooked, 'ping')).error?.message).toBe('pong');
    expect((await json(hooked, '2+2')).display).toBe('4');
  });

  it('keeps sessions separate and supports follow-ups', async () => {
    const s = createSession();
    await rt.compute("what's 20% of 450", s).then((o) => o.kind === 'calc' && (s.ans = o.result.value, s.base = o.result.base));
    expect((await json(rt, 'add that to the original number', s)).display).toBe('540');
  });
});

describe.skipIf(process.env.LEMMA_OFFLINE === '1')('node runtime with SymPy', () => {
  it('solves symbolically in-process', async () => {
    const rt = await createNodeRuntime();
    const d = await json(rt, 'derivative of x^3');
    expect(d.display).toBe('3x²');
    expect(d.plain).toBe('3*x^2');
  }, 180_000);
});

describe('simulate from the main input', () => {
  const rt = new Runtime();
  const ask = async (q: string) => {
    let o = rt.route(q, createSession());
    while (o.kind === 'pending') {
      await o.waitFor;
      o = rt.route(q, createSession());
    }
    return o;
  };
  it('estimates a probability with its interval and the exact value', async () => {
    const o = await ask('simulate 10000: sum of 2 dice >= 10');
    if (o.kind !== 'answer') throw new Error(o.kind);
    const p = Number(o.result.primary.plain.replace('%', '')) / 100;
    expect(Math.abs(p - 1 / 6)).toBeLessThan(0.02);
    expect(o.result.lines?.find((l) => l.label === 'Exact')?.display).toContain('1/6');
  });
  it('reads a line without the colon the same way, and is reproducible', async () => {
    const a = await ask('simulate 5000 seed 3: heads in 10 flips');
    const b = await ask('simulate 5000 seed 3 heads in 10 flips');
    if (a.kind !== 'answer' || b.kind !== 'answer') throw new Error('expected answers');
    expect(a.result.primary.plain).toBe(b.result.primary.plain);
  });
  it('refuses huge runs here and points at the notebook', async () => {
    const o = await ask('simulate 1000000: sum of 2 dice >= 10');
    expect(o.kind).toBe('error');
    if (o.kind === 'error') expect(o.error.message).toMatch(/notebook/);
  });
  it('leaves "simulate a projectile…" alone', () => {
    expect(rt.route('simulate a projectile at 20 m/s', createSession()).kind).not.toBe('answer');
  });
});

describe("the user's own formulas win over built-in shortcuts", () => {
  it('f(2) after f(x) = x^2 + 1 is 5, not a Fibonacci number', async () => {
    const rt = new Runtime();
    const s = createSession();
    const run = async (q: string) => {
      let o = rt.route(q, s);
      while (o.kind === 'pending') {
        await o.waitFor;
        o = rt.route(q, s);
      }
      return o;
    };
    const def = await run('f(x) = x^2 + 1');
    if (def.kind === 'calc') commit(s, def.result);
    const o = await run('f(2)');
    expect(o.kind).toBe('calc');
    if (o.kind === 'calc') expect(o.result.formatted.plain).toBe('5');
    // Without a saved f, the capital form still means Fibonacci.
    const fib = await run('F(10)');
    expect(fib.kind === 'answer' ? fib.result.primary.plain : '').toBe('55');
  });
});
