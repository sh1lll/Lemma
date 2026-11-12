import { K } from './layouts';
import type { Key, Pane } from './types';

/** The abc and func tabs: a separate chunk, loaded the first time one of them opens. */

const letter = (ch: string): Key => ({ l: ch, ins: ch, c: 'it letter', s: 2, k: ch });
const sym = (l: string, ins: string, aria?: string, s = 2): Key => ({ l, ins, c: 'op', s, aria: aria ?? l, k: ins.trim().length === 1 ? ins.trim() : undefined });

export function abcPane(): Pane {
  return {
    blocks: [
      {
        cols: 22,
        cls: 'abc',
        keys: [
          ...'qwertyuiop'.split('').map(letter), { ...K.back, s: 2 },
          { l: '', gap: true, s: 1 }, ...'asdfghjkl'.split('').map(letter), sym('=', '=', 'Equals sign', 3),
          { l: '⇧', act: 'shift', aria: 'Shift', c: 'op shift', s: 4 }, ...'zxcvbnm'.split('').map(letter), sym(',', ', ', 'Comma'), sym('!', '!', 'Factorial'),
          sym('(', '('), sym(')', ')'), sym('[', '['), sym(']', ']'), sym('′', "'", 'Prime'), sym('π', 'π', 'Pi'), { ...K.left, s: 2 }, { ...K.right, s: 2 }, { ...K.enter, s: 6 },
        ],
      },
    ],
  };
}

const f = (l: string, ins: string | Key['ins'], aria?: string): Key => ({ l, ins, aria: aria ?? l, c: 'fn' });
const two = (name: string) => ({ t: `${name}(§, )`, w: `${name}(@, §)` });

const side = (more: boolean): Key[] => [K.left, K.right, { ...K.back, s: 2 }, { l: more ? 'basic' : 'more', act: 'more', aria: more ? 'Basic functions' : 'More functions', c: 'op soft', s: 2 }, { ...K.enter, s: 2 }];

export function funcPane(): Pane {
  return {
    blocks: [
      {
        cols: 6,
        cls: 'func',
        keys: [
          f('sin', 'sin(§)', 'sine'), f('cos', 'cos(§)', 'cosine'), f('tan', 'tan(§)', 'tangent'), f('mean', 'mean([§])', 'Mean of a list'), f('stdev', 'stdev([§])', 'Sample standard deviation'), f('stdevp', 'stdevp([§])', 'Population standard deviation'),
          f('sin⁻¹', 'asin(§)', 'Inverse sine'), f('cos⁻¹', 'acos(§)', 'Inverse cosine'), f('tan⁻¹', 'atan(§)', 'Inverse tangent'), f('nPr', two('nPr'), 'Permutations'), f('nCr', two('nCr'), 'Combinations'), f('!', '!', 'Factorial'),
          K.pow, K.sqrt, K.nroot, f('eˣ', 'e^(§)', 'e to the power'), f('abs', 'abs(§)', 'Absolute value'), f('round', 'round(§)', 'Round'),
          f('ln', 'ln(§)', 'Natural log'), f('log', 'log(§)', 'Log base 10'), f('e', 'e', 'e'), K.pi, f('[', '[', 'Open list'), f(']', ']', 'Close list'),
        ],
      },
      { cols: 2, cls: 'side', keys: side(false) },
    ],
  };
}

export function funcMorePane(memory: boolean): Pane {
  return {
    blocks: [
      {
        cols: 6,
        cls: 'func',
        keys: [
          f('sinh', 'sinh(§)', 'Hyperbolic sine'), f('cosh', 'cosh(§)', 'Hyperbolic cosine'), f('tanh', 'tanh(§)', 'Hyperbolic tangent'), f('floor', 'floor(§)', 'Floor'), f('ceil', 'ceil(§)', 'Ceiling'), f('mod', ' mod ', 'Modulo'),
          f('sec', 'sec(§)', 'Secant'), f('csc', 'csc(§)', 'Cosecant'), f('cot', 'cot(§)', 'Cotangent'), f('gcd', two('gcd'), 'Greatest common divisor'), f('lcm', two('lcm'), 'Least common multiple'), f('median', 'median([§])', 'Median of a list'),
          f('min', 'min(§)', 'Minimum'), f('max', 'max(§)', 'Maximum'), f('var', 'var([§])', 'Sample variance'), f('logₙ', two('log'), 'Log base n: log(x, n)'), f('d/dx', 'd/dx §', 'Derivative'), f('∫', '∫ § dx', 'Integral'),
          f('Σ', 'Σ § for k = 1 to 10', 'Sum'), f('lim', 'lim § as x → 0', 'Limit'), f('sinh⁻¹', 'asinh(§)', 'Inverse hyperbolic sine'), f('cosh⁻¹', 'acosh(§)', 'Inverse hyperbolic cosine'), f('tanh⁻¹', 'atanh(§)', 'Inverse hyperbolic tangent'),
          memory ? { l: 'MC', act: 'mc', aria: 'Clear memory', c: 'fn mem' } : f('°', '°', 'Degrees'),
        ],
      },
      { cols: 2, cls: 'side', keys: side(true) },
    ],
  };
}
