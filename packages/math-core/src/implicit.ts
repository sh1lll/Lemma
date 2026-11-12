import type { Node } from './ast';
import { CONSTANTS, isFunctionName } from './builtins';

/** Multi-letter names that are one symbol, not a product of letters. */
const WHOLE_NAMES = new Set([
  'ans', 'base', 'theta', 'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi',
  'omicron', 'rho', 'sigma', 'upsilon', 'chi', 'psi', 'omega', 'inf', 'infinity',
]);

/**
 * Reads unknown multi-letter names as products of single letters, the way algebra is written and the way
 * Desmos and CAS tools read it: "mx + b" is m·x + b and "ax^2" is a·x². The calculator itself keeps
 * multi-letter variables ("rate", "x1"); this is for graphing and symbolic requests, where a name like "mx"
 * would otherwise become an unrelated slider or symbol (d/dx of "ax²" coming out as 0).
 *
 * `keep(name)` protects names that are defined (session variables, formulas, parameters).
 */
export function splitLetterProducts(n: Node, keep: (name: string) => boolean = () => false): Node {
  const splittable = (name: string) => /^[a-z]{2,}$/.test(name) && !WHOLE_NAMES.has(name) && !(name in CONSTANTS) && !keep(name);
  const rec = (m: Node): Node => {
    // "ax^2" is a·x², not (ax)²: the power belongs to the last letter only.
    if (m.type === 'binary' && m.op === '^' && m.left.type === 'name' && splittable(m.left.name)) {
      const fs = letters(m.left.name, keep);
      const last: Node = { type: 'binary', op: '^', left: fs.pop()!, right: rec(m.right) };
      return product([...fs, last]);
    }
    switch (m.type) {
      case 'name': {
        const name = m.name;
        return splittable(name) ? product(letters(name, keep)) : m;
      }
      case 'num':
        return m;
      case 'percent':
      case 'degree':
      case 'factorial':
      case 'neg':
        return { ...m, arg: rec(m.arg) };
      case 'binary':
      case 'of':
      case 'off':
        return { ...m, left: rec(m.left), right: rec(m.right) };
      case 'call':
        return { ...m, args: m.args.map(rec) };
      case 'assign':
        return { ...m, value: rec(m.value) };
      case 'define':
        return { ...m, body: rec(m.body) };
    }
  };
  return rec(n);
}

const MULTI = ['theta', 'pi', 'tau', 'phi'];

/** "mx" → m·x, "pix" → π·x, "sinx" → sin(x), "2ab" (as "ab") → a·b. */
const product = (fs: Node[]): Node => fs.reduce((l, r) => ({ type: 'binary', op: '*', left: l, right: r, implicit: true }));

function letters(name: string, keep: (name: string) => boolean): Node[] {
  const factors: Node[] = [];
  let i = 0;
  while (i < name.length) {
    const rest = name.slice(i);
    // A function name glued to its argument: "sinx", "lnx", "sqrtx".
    let fn = '';
    for (let k = rest.length - 1; k >= 2; k--) {
      if (isFunctionName(rest.slice(0, k)) && !/\d$/.test(rest.slice(0, k))) {
        fn = rest.slice(0, k);
        break;
      }
    }
    if (fn) {
      const arg = rest.slice(fn.length);
      factors.push({ type: 'call', name: fn, args: [arg.length > 1 && !keep(arg) ? product(letters(arg, keep)) : { type: 'name', name: arg }] });
      break;
    }
    const multi = MULTI.find((w) => rest.startsWith(w));
    const piece = multi ?? rest[0]!;
    factors.push({ type: 'name', name: piece });
    i += piece.length;
  }
  return factors;
}
