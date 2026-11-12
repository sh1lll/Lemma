import type { Node } from '@lemma/math-core';

/**
 * Lemma AST → LaTeX, for "Interpreted as …" and arithmetic steps. Mirrors math-core's `print` precedence
 * rules, so the typeset form reads exactly the way the calculator understood the input.
 */
const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, mod: 2, of: 2, off: 2, '^': 4 };
const GREEK = new Set(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega']);
const FN_TEX: Record<string, string> = {
  sin: '\\sin', cos: '\\cos', tan: '\\tan', sec: '\\sec', csc: '\\csc', cot: '\\cot', sinh: '\\sinh', cosh: '\\cosh', tanh: '\\tanh',
  asin: '\\arcsin', acos: '\\arccos', atan: '\\arctan', arcsin: '\\arcsin', arccos: '\\arccos', arctan: '\\arctan',
  ln: '\\ln', exp: '\\exp', log: '\\log_{10}', lg: '\\log_{10}', gcd: '\\gcd', max: '\\max', min: '\\min', det: '\\det',
};

function name(n: string): string {
  if (n === 'inf' || n === 'infinity') return '\\infty';
  if (GREEK.has(n)) return `\\${n}`;
  const cap = /^cap_([a-z])(\d*)$/.exec(n);
  if (cap) return cap[1]!.toUpperCase() + (cap[2] ? `_{${cap[2]}}` : '');
  const sub = /^([a-zA-Z])(\d+)$/.exec(n);
  if (sub) return `${sub[1]}_{${sub[2]}}`;
  return n.length === 1 ? n : `\\mathrm{${n}}`;
}

const opOf = (n: Node): string => (n.type === 'binary' ? n.op : n.type);

/** True when the node prints as a plain number or letter, so "2x" can be written without a dot. */
function atomLeft(n: Node): boolean {
  return n.type === 'num' || (n.type === 'binary' && n.op === '^' && n.left.type === 'num');
}
function letterish(n: Node): boolean {
  if (n.type === 'name' || n.type === 'call') return true;
  if (n.type === 'binary' && n.op === '^') return letterish(n.left);
  if (n.type === 'binary' && n.op === '*' && n.implicit) return letterish(n.left);
  return false;
}

export function toLatex(n: Node, parent = 0): string {
  switch (n.type) {
    case 'num':
      return n.value.replace(/e([+-]?\d+)$/i, '\\times 10^{$1}');
    case 'name':
      return name(n.name);
    case 'percent':
      return `${toLatex(n.arg, 5)}\\%`;
    case 'degree':
      return `${toLatex(n.arg, 5)}^{\\circ}`;
    case 'factorial':
      return `${toLatex(n.arg, 5)}!`;
    case 'neg': {
      const s = `-${toLatex(n.arg, 3)}`;
      return parent > 1 ? `\\left(${s}\\right)` : s;
    }
    case 'of':
      return wrap(`${toLatex(n.left, 2)} \\text{ of } ${toLatex(n.right, 3)}`, 2, parent);
    case 'off':
      return wrap(`${toLatex(n.left, 2)} \\text{ off } ${toLatex(n.right, 3)}`, 2, parent);
    case 'binary': {
      const op = opOf(n);
      const p = PREC[op]!;
      if (op === '^') return wrap(`${toLatex(n.left, p + 1)}^{${toLatex(n.right, 0)}}`, p, parent);
      if (op === '/') {
        // A fraction bar groups by itself, so its parts need no brackets.
        const s = `\\frac{${toLatex(n.left, 0)}}{${toLatex(n.right, 0)}}`;
        return parent >= 4 ? `\\left(${s}\\right)` : s;
      }
      if (op === '*') {
        const l = toLatex(n.left, p);
        const r = toLatex(n.right, p + 1);
        const juxt = (n.implicit || atomLeft(n.left)) && letterish(n.right);
        return wrap(juxt ? `${l}${r.startsWith('\\left(') || /^[a-zA-Z\\]/.test(r) ? '' : ' '}${r}` : `${l} \\times ${r}`, p, parent);
      }
      if (op === 'mod') return wrap(`${toLatex(n.left, p)} \\bmod ${toLatex(n.right, p + 1)}`, p, parent);
      return wrap(`${toLatex(n.left, p)} ${op === '-' ? '-' : '+'} ${toLatex(n.right, p + 1)}`, p, parent);
    }
    case 'call': {
      const args = n.args.map((a) => toLatex(a, 0));
      if (n.name === 'sqrt') return `\\sqrt{${args[0]}}`;
      if (n.name === 'cbrt') return `\\sqrt[3]{${args[0]}}`;
      const root = /^root(\d+)$/.exec(n.name);
      if (root) return `\\sqrt[${root[1]}]{${args[0]}}`;
      if (n.name === 'root' && args.length === 2) return `\\sqrt[${args[1]}]{${args[0]}}`;
      if (n.name === 'abs') return `\\left|${args[0]}\\right|`;
      if (n.name === 'floor') return `\\lfloor ${args[0]} \\rfloor`;
      if (n.name === 'ceil') return `\\lceil ${args[0]} \\rceil`;
      if (n.name === 'log' && args.length === 2) return `\\log_{${args[1]}}\\left(${args[0]}\\right)`;
      const lb = /^logb?(\d+)$/.exec(n.name);
      if (lb) return `\\log_{${lb[1]}}\\left(${args[0]}\\right)`;
      if (n.name === 'ncr' || n.name === 'choose') return `\\binom{${args[0]}}{${args[1]}}`;
      const f = FN_TEX[n.name] ?? `\\operatorname{${n.name}}`;
      return `${f}\\left(${args.join(', ')}\\right)`;
    }
    case 'assign':
      return `${name(n.name)} = ${toLatex(n.value)}`;
    case 'define':
      return `${name(n.name)}\\left(${n.params.map(name).join(', ')}\\right) = ${toLatex(n.body)}`;
  }
}

function wrap(s: string, p: number, parent: number): string {
  return p < parent ? `\\left(${s}\\right)` : s;
}
