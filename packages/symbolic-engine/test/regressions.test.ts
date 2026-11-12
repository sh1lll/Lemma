import { createSession, D } from '@lemma/math-core';
import { describe, expect, it } from 'vitest';
import { parseSymbolic } from '../src';

describe('symbolic request regressions', () => {
  it('reads letter runs as products (d/dx of ax² is not 0)', () => {
    expect(parseSymbolic('derivative of ax^2', createSession())?.exprs).toEqual(["(Symbol('a'))*((Symbol('x'))**(2))"]);
    expect(parseSymbolic('derivative of xy with respect to x', createSession())?.exprs).toEqual(["(Symbol('x'))*(Symbol('y'))"]);
  });
  it('keeps session variables whole', () => {
    const s = createSession();
    s.vars.set('rate', new D('0.5'));
    expect(parseSymbolic('derivative of rate*x^2', s)?.exprs).toEqual(["(Rational('0.5'))*((Symbol('x'))**(2))"]);
  });

  it('reads spoken relations and never turns a leftover word into symbols', () => {
    const s = createSession();
    expect(parseSymbolic('solve x squared minus 4 equals 0', s)).toMatchObject({ op: 'solve', exprs: ["(((Symbol('x'))**(2))-(4)) - (0)"], rels: ['='] });
    expect(parseSymbolic('x squared minus 4 equals 0', s)?.op).toBe('solve');
    expect(parseSymbolic('solve x squared is greater than 4', s)?.rels).toEqual(['>']);
    expect(parseSymbolic('solve x is equal to 3', s)?.exprs).toEqual(["(Symbol('x')) - (3)"]);
    expect(() => parseSymbolic('solve x squared plus banana = 1', s)).toThrow(/banana/);
    expect(parseSymbolic('x equals 5', s)).toBeNull(); // an assignment, not an equation
  });
});
