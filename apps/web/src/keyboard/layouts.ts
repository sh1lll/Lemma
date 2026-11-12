import type { Key, Pane } from './types';

/** Shared keys used by several tabs. */
export const K = {
  left: { l: '←', act: 'left', aria: 'Move left', c: 'op', k: 'ArrowLeft' } as Key,
  right: { l: '→', act: 'right', aria: 'Move right', c: 'op', k: 'ArrowRight' } as Key,
  back: { l: '⌫', act: 'back', aria: 'Delete', c: 'op', k: 'Backspace' } as Key,
  enter: { l: '↵', act: 'enter', aria: 'Enter', c: 'enter', k: 'Enter' } as Key,
  frac: { l: 'a/b', ins: { t: '(§)/()', w: '(@)/(§)', frac: true }, aria: 'Fraction', c: 'fn' } as Key,
  pow: { l: 'aᵇ', ins: '^(§)', aria: 'Power', c: 'fn', k: '^' } as Key,
  sq: { l: 'a²', ins: '^2', aria: 'Square', c: 'fn' } as Key,
  sqrt: { l: '√', ins: 'sqrt(§)', aria: 'Square root', c: 'fn' } as Key,
  nroot: { l: 'ⁿ√', ins: { t: 'root(§, )', w: 'root(@, §)' }, aria: 'Root: root(x, n)', c: 'fn' } as Key,
  abs: { l: '|a|', ins: 'abs(§)', aria: 'Absolute value', c: 'fn', k: '|' } as Key,
  pi: { l: 'π', ins: 'π', aria: 'Pi', c: 'fn' } as Key,
};

const fn = (name: string, aria?: string, label = name): Key => ({ l: label, ins: `${name}(§)`, aria: aria ?? label, c: 'fn' });
const digit = (d: string): Key => ({ l: d, ins: d, c: 'num', k: d });

/** Row four of the left block: memory and S⇔D in Scientific, variables elsewhere. */
export const ROW4 = {
  sci: [
    { l: '½⇔.5', act: 'sd', aria: 'Fraction or decimal', c: 'fn' },
    { l: 'M+', act: 'm+', aria: 'Add to memory', c: 'fn mem' },
    { l: 'M−', act: 'm-', aria: 'Subtract from memory', c: 'fn mem' },
    { l: 'MR', act: 'mr', aria: 'Recall memory', c: 'fn mem' },
  ] as Key[],
  vars: [
    { l: 'x', ins: 'x', c: 'fn it', k: 'x' },
    { l: 'y', ins: 'y', c: 'fn it', k: 'y' },
    { l: '=', ins: '=', c: 'fn', k: '=', aria: 'Equals sign' },
    { l: '<', ins: '<', c: 'fn', k: '<', aria: 'Less than' },
  ] as Key[],
};

export function mainPane(row4: Key[] = ROW4.vars): Pane {
  return {
    blocks: [
      {
        cols: 4,
        cls: 'fns',
        keys: [
          K.sq, K.pow, K.abs, K.sqrt,
          K.nroot, K.pi, fn('sin', 'sine'), fn('cos', 'cosine'),
          fn('tan', 'tangent'), { l: '(', ins: '(', c: 'fn', k: '(' }, { l: ')', ins: ')', c: 'fn', k: ')' }, { l: ',', ins: ', ', c: 'fn', k: ',', aria: 'Comma' },
          ...row4,
        ],
      },
      {
        cols: 4,
        cls: 'digits',
        keys: [
          digit('7'), digit('8'), digit('9'), { l: '÷', ins: '/', aria: 'Divide', c: 'op', k: '/' },
          digit('4'), digit('5'), digit('6'), { l: '×', ins: '*', aria: 'Times', c: 'op', k: '*' },
          digit('1'), digit('2'), digit('3'), { l: '−', ins: '-', aria: 'Minus', c: 'op', k: '-' },
          digit('0'), { l: '.', ins: '.', aria: 'Point', c: 'num', k: '.' }, { l: 'ans', ins: 'ans', aria: 'Previous answer', c: 'op' }, { l: '+', ins: '+', aria: 'Plus', c: 'op', k: '+' },
        ],
      },
      {
        cols: 2,
        cls: 'side',
        keys: [{ l: '%', ins: '%', aria: 'Percent', c: 'op', k: '%' }, K.frac, K.left, K.right, { ...K.back, s: 2 }, { ...K.enter, s: 2 }],
      },
    ],
  };
}
