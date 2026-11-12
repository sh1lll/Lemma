export type BinaryOp = '+' | '-' | '*' | '/' | '^' | 'mod';

export type Node =
  | { type: 'num'; value: string }
  | { type: 'name'; name: string }
  | { type: 'percent'; arg: Node }
  | { type: 'degree'; arg: Node }
  | { type: 'factorial'; arg: Node }
  | { type: 'neg'; arg: Node }
  | { type: 'binary'; op: BinaryOp; left: Node; right: Node; implicit?: boolean }
  /** "20% of 450": multiplication that also records 450 as the base of the calculation. */
  | { type: 'of'; left: Node; right: Node }
  /** "15% off 80": 80 · (1 − 15%). */
  | { type: 'off'; left: Node; right: Node }
  | { type: 'call'; name: string; args: Node[] }
  | { type: 'assign'; name: string; value: Node }
  /** User formula: f(x) = x^2 + 1, bmi(w, h) = w / h^2. */
  | { type: 'define'; name: string; params: string[]; body: Node };

const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, mod: 2, of: 2, off: 2, '^': 4 };

/** Renders an AST back to an unambiguous, fully explicit expression string. */
export function print(n: Node, parentPrec = 0): string {
  switch (n.type) {
    case 'num':
      return n.value;
    case 'name':
      return n.name === 'pi' ? 'π' : n.name;
    case 'percent':
      return `${print(n.arg, 5)}%`;
    case 'degree':
      return `${print(n.arg, 5)}°`;
    case 'factorial':
      // (5!)! keeps its brackets: "5!!" is the double factorial.
      return n.arg.type === 'factorial' || (n.arg.type === 'call' && n.arg.name === 'dfact') ? `(${print(n.arg)})!` : `${print(n.arg, 5)}!`;
    case 'neg': {
      const s = `−${print(n.arg, 3)}`;
      return parentPrec > 3 ? `(${s})` : s;
    }
    case 'binary':
    case 'of':
    case 'off': {
      const op = opOf(n);
      const p = PREC[op]!;
      if (op === '^') {
        // Right-associative power needs parens on the left side at equal precedence.
        const s = `${print(n.left, p + 1)}^${print(n.right, p)}`;
        return p < parentPrec ? `(${s})` : s;
      }
      // Left-associative chains (1 + 2 + 3 + …) are printed iteratively: a pasted 10,000-term sum must not
      // exhaust the call stack.
      const spine: Node[] = [];
      let cur: Node = n;
      while ((cur.type === 'binary' || cur.type === 'of' || cur.type === 'off') && opOf(cur) !== '^' && PREC[opOf(cur)] === p) {
        spine.push(cur);
        cur = cur.left;
      }
      let s = print(cur, p);
      for (let i = spine.length - 1; i >= 0; i--) {
        const m = spine[i] as Extract<Node, { type: 'binary' | 'of' | 'off' }>;
        s += symOf(opOf(m)) + print(m.right, p + 1);
      }
      return p < parentPrec ? `(${s})` : s;
    }
    case 'call':
      if (n.name === 'dfact' && n.args.length === 1) return `${print(n.args[0]!, 5)}!!`;
      {
        // logb2(8) reads as log₂(8); root3(x) as ∛x-style "root3" stays (it's how it was typed).
        const lb = /^logb(\d+)$/.exec(n.name);
        if (lb) return `log${[...lb[1]!].map((d) => '₀₁₂₃₄₅₆₇₈₉'[+d]).join('')}(${n.args.map((a) => print(a)).join(', ')})`;
      }
      return `${n.name === 'sqrt' ? '√' : n.name}(${n.args.map((a) => print(a)).join(', ')})`;
    case 'assign':
      return `${n.name} = ${print(n.value)}`;
    case 'define':
      return `${n.name}(${n.params.join(', ')}) = ${print(n.body)}`;
  }
}

const opOf = (n: Extract<Node, { type: 'binary' | 'of' | 'off' }> | Node): string => (n.type === 'binary' ? n.op : n.type);
const symOf = (op: string) => (op === '*' ? ' × ' : op === '/' ? ' ÷ ' : op === '-' ? ' − ' : ` ${op} `);

/** Pre-order traversal with an explicit stack (no recursion, so arbitrarily long expressions are safe). */
export function walk(root: Node, visit: (n: Node) => void): void {
  const stack: Node[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    visit(n);
    switch (n.type) {
      case 'percent':
      case 'degree':
      case 'factorial':
      case 'neg':
        stack.push(n.arg);
        break;
      case 'binary':
      case 'of':
      case 'off':
        stack.push(n.right, n.left);
        break;
      case 'call':
        for (let i = n.args.length - 1; i >= 0; i--) stack.push(n.args[i]!);
        break;
      case 'assign':
        stack.push(n.value);
        break;
      case 'define':
        stack.push(n.body);
        break;
    }
  }
}
