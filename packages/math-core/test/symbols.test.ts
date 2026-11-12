import { describe, expect, it } from 'vitest';
import { calculate, createSession } from '../src/index';

// Symbols inserted from the symbol menu are understood where they mean something to the calculator.
describe('symbols from the symbol menu', () => {
  it.each([
    ['6×7', '42'],
    ['84÷4', '21'],
    ['9−2', '7'],
    ['√16', '4'],
    ['∛27', '3'],
    ['∜16', '2'],
    ['∜(81)', '3'],
    ['2π', '6.28318530718'],
    ['5²', '25'],
    ['2³', '8'],
    ['sin(30°)', '0.5'],
    ['φ', '1.61803398875'],
    ['ℯ^2', '7.38905609893'],
    ['3·4', '12'],
  ])('%s = %s', (q, want) => {
    const r = calculate(q, createSession());
    expect(r.ok && r.formatted.display).toBe(want);
  });
});
