import { calculate, commit, createSession, type Answer, type CalcSuccess } from '@lemma/math-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { Runtime, type Outcome } from '../src';
import { createNodeRuntime } from '../src/node';

/** Typed expressions with letters and no "=": a useful answer, never "Unknown name". */

const answer = (o: Outcome): Answer => {
  if (o.kind !== 'answer') throw new Error(`expected an answer, got ${o.kind}${o.kind === 'error' ? `: ${o.error.message}` : ''}`);
  return o.result;
};

describe('a lone letter (no algebra engine needed)', () => {
  const rt = new Runtime();
  it.each([
    ['x', 'x'],
    ['2x', '2x'],
    ['-y', '−y'],
    ['3 * t', '3t'],
  ])('%s → a hint, not an error', async (q, shown) => {
    const a = answer(await rt.compute(q, createSession()));
    expect(a.kind).toBe('hint');
    expect(a.primary.display).toBe(shown);
    expect(a.notes[0]).toMatch(/no value yet.*Add “= …” to solve, or give \w a value/);
  });

  it('uses a stored value instead', async () => {
    const s = createSession();
    commit(s, calculate('x = 4', s) as CalcSuccess);
    const o = await rt.compute('2x + 1', s);
    expect(o.kind).toBe('calc');
    expect(o.kind === 'calc' && o.result.formatted.display).toBe('9');
    expect((await rt.compute('x', s)).kind).toBe('calc');
  });

  it('leaves "5 m" (units) and multi-letter words alone', async () => {
    expect((await rt.compute('5 m', createSession())).kind).not.toBe('answer');
    expect((await rt.compute('foo', createSession())).kind).toBe('error');
  });

  it('waits for the algebra engine instead of reporting an unknown name', () => {
    const fresh = new Runtime();
    expect(fresh.route('x^2 + 2x + 1', createSession()).kind).toBe('pending');
  });
});

describe.skipIf(process.env.LEMMA_OFFLINE === '1')('bare expressions through SymPy', () => {
  let rt: Runtime;
  beforeAll(async () => {
    rt = await createNodeRuntime();
  }, 180_000);
  const ask = async (q: string, s = createSession()) => answer(await rt.compute(q, s));

  it('factors a perfect square and shows the expanded form', async () => {
    const a = await ask('x^2 + 2x + 1');
    expect(a.expression).toBe('Factored · x^2 + 2x + 1');
    expect(a.primary.display).toBe('(x + 1)²');
    expect(a.lines).toEqual([{ label: 'Expanded', display: 'x² + 2x + 1' }]);
    expect(a.verified?.ok).toBe(true);
  }, 120_000);

  it('expands a factored form, simplifies like terms', async () => {
    const e = await ask('(x+1)^2');
    expect(e.primary.display).toBe('x² + 2x + 1');
    expect(e.lines?.[0]).toEqual({ label: 'Factored', display: '(x + 1)²' });
    expect((await ask('3x - 2x')).primary.display).toBe('x');
    expect((await ask('x^2 - 1')).primary.display).toBe('(x − 1)(x + 1)');
  }, 120_000);

  it('an expression that is already simplest gets a hint', async () => {
    for (const [q, who] of [
      ['2x + 1', 'x a value'],
      ['a + b', 'a and b values'],
    ] as const) {
      const a = await ask(q);
      expect(a.expression).toBe(`Expression · ${q}`);
      expect(a.primary.display).toBe(q);
      expect(a.notes[0]).toBe(`Add “= …” to solve, or give ${who} (${q[0] === 'a' ? 'a' : 'x'} = 3)`);
    }
  }, 120_000);

  it('substitutes stored values for the letters that have them', async () => {
    const s = createSession();
    commit(s, calculate('x = 3', s) as CalcSuccess);
    const a = await ask('x + y', s);
    expect(a.primary.display).toBe('y + 3');
    expect(a.notes[0]).toMatch(/give y a value/);
  }, 120_000);
});
