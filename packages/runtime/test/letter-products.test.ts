import { calculate, commit, createSession, type CalcSuccess } from '@lemma/math-core';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Outcome, Runtime } from '../src';
import { createNodeRuntime } from '../src/node';

/** Run-together single letters ("xy", "2xy", "abc") are products when the letters aren't known names. */
let rt: Runtime;
beforeAll(async () => {
  rt = await createNodeRuntime();
  await rt.compute('derivative of x^2', createSession()); // loads SymPy once
}, 120_000);

const shown = (o: Outcome): string => {
  if (o.kind === 'answer') return o.result.primary.display;
  if (o.kind === 'calc') return o.result.formatted.display;
  if (o.kind === 'error') return `error: ${o.error.message}`;
  return o.kind;
};
const set = (s: ReturnType<typeof createSession>, q: string) => commit(s, calculate(q, s) as CalcSuccess);

describe('implicit letter products', () => {
  it.each([
    ['xy', 'xy'],
    ['2xy', '2xy'],
    ['abc', 'abc'],
    ['3ab + 2ab', '5ab'],
    ['xy^2 + x', 'x(y² + 1)'],
  ])('%s → %s (a product, never "Unknown name")', async (q, want) => {
    expect(shown(await rt.compute(q, createSession()))).toBe(want);
  });

  it('substitutes the letters that have values', async () => {
    const s = createSession();
    set(s, 'x = 3');
    expect(shown(await rt.compute('2xy', s))).toBe('6y');
    expect(shown(await rt.compute('xy + 1 = 7', s))).toBe('y = 2');
    set(s, 'y = 4');
    expect(shown(await rt.compute('2xy', s))).toBe('24');
  });

  it('equations with run-together letters', async () => {
    expect(shown(await rt.compute('xy + 1 = 7', createSession()))).toMatch(/x = 6\/y/);
    expect(shown(await rt.compute('solve 2xy = 4 for y', createSession()))).toMatch(/y = 2\/x/);
  });

  it('leaves units, words and defined multi-letter names alone', async () => {
    expect(shown(await rt.compute('5km', createSession()))).toMatch(/^error|km/);
    expect(shown(await rt.compute('foo', createSession()))).toMatch(/^error/);
    const s = createSession();
    set(s, 'ab = 7');
    expect(shown(await rt.compute('ab + 1', s))).toBe('8');
  });
});
