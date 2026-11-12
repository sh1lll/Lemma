import { calculate, createSession, D, parseInput, print, type Node } from '@lemma/math-core';
import { toLatex } from './latex';
import type { Step, StepList } from './types';

/**
 * Order of operations, one operation at a time, in exact rational arithmetic. Brackets first, then powers,
 * then × and ÷, then + and −, each left to right. Every intermediate expression is re-evaluated by the
 * calculator itself (a separate evaluator) and must equal the original value, or no steps are shown.
 */
interface Q {
  n: bigint;
  d: bigint;
}
const babs = (a: bigint) => (a < 0n ? -a : a);
const bgcd = (a: bigint, b: bigint): bigint => {
  a = babs(a);
  b = babs(b);
  while (b) [a, b] = [b, a % b];
  return a;
};
function q(n: bigint, d: bigint = 1n): Q {
  if (d === 0n) throw new Error('division by zero');
  if (d < 0n) [n, d] = [-n, -d];
  const g = bgcd(n, d) || 1n;
  return { n: n / g, d: d / g };
}
function fromDecimal(s: string): Q | null {
  const m = /^(\d*)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const frac = m[2] ?? '';
  return q(BigInt((m[1] || '0') + frac), 10n ** BigInt(frac.length));
}
/** Decimal text when it terminates (and isn't long), else a fraction. */
function qText(v: Q): string {
  const neg = v.n < 0n;
  let d = v.d;
  let k = 0;
  while (d % 2n === 0n) (d /= 2n), k++;
  let j = 0;
  while (d % 5n === 0n) (d /= 5n), j++;
  if (d === 1n && Math.max(k, j) <= 8) {
    const places = Math.max(k, j);
    const scaled = babs(v.n) * 10n ** BigInt(places) / v.d;
    let s = scaled.toString().padStart(places + 1, '0');
    if (places) s = `${s.slice(0, -places)}.${s.slice(-places)}`.replace(/\.?0+$/, '');
    return (neg ? '-' : '') + s;
  }
  return `${v.n}/${v.d}`;
}
function qNode(v: Q): Node {
  const t = qText(v);
  const neg = t.startsWith('-');
  const body = neg ? t.slice(1) : t;
  let node: Node;
  if (body.includes('/')) {
    const [a, b] = body.split('/');
    node = { type: 'binary', op: '/', left: { type: 'num', value: a! }, right: { type: 'num', value: b! } };
  } else node = { type: 'num', value: body };
  return neg ? { type: 'neg', arg: node } : node;
}
const marked = (n: Node): boolean => (n as { done?: true }).done === true;
/** A number already worked out: a literal, a negative literal, or a value produced by an earlier step. */
const isVal = (n: Node): boolean => n.type === 'num' || marked(n) || (n.type === 'neg' && (n.arg.type === 'num' || marked(n.arg)));

function valueOf(n: Node): Q | null {
  if (n.type === 'num') return fromDecimal(n.value);
  if (n.type === 'neg') {
    const v = valueOf(n.arg);
    return v && q(-v.n, v.d);
  }
  if (marked(n) && n.type === 'binary' && n.op === '/') {
    const a = valueOf(n.left);
    const b = valueOf(n.right);
    return a && b ? q(a.n * b.d, a.d * b.n) : null;
  }
  return null;
}

/** A reduced value, marked so it isn't mistaken for a division still to do. */
function mark(v: Q): Node {
  const node = qNode(v);
  const tag = (m: Node) => Object.assign(m, { done: true as const });
  if (node.type === 'neg') tag(node.arg);
  return tag(node);
}

const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4 };

interface Candidate {
  path: ('left' | 'right' | 'arg')[];
  node: Node;
  bracket: number;
  prec: number;
  order: number;
}

function supported(n: Node): boolean {
  switch (n.type) {
    case 'num':
      return true;
    case 'neg':
    case 'percent':
      return supported(n.arg);
    case 'binary':
      return n.op in PREC && supported(n.left) && supported(n.right);
    default:
      return false;
  }
}

/** "1/2 + 1/3": a whole-number fraction added or subtracted is a value (a fraction), not a division to do. */
function fractionLiteral(n: Node, additive: boolean): boolean {
  return n.type === 'binary' && n.op === '/' && additive && n.left.type === 'num' && n.right.type === 'num' && /^\d+$/.test(n.left.value) && /^\d+$/.test(n.right.value) && n.right.value !== '1';
}

function collect(n: Node, path: Candidate['path'], bracket: number, out: Candidate[], parentPrec: number, additive = true) {
  if (isVal(n)) return;
  if (fractionLiteral(n, additive)) {
    Object.assign(n, { done: true as const });
    return;
  }
  if (n.type === 'percent') {
    if (isVal(n.arg)) out.push({ path, node: n, bracket, prec: 5, order: out.length });
    else collect(n.arg, [...path, 'arg'], bracket, out, 5, false);
    return;
  }
  if (n.type === 'neg') {
    if (isVal(n.arg)) out.push({ path, node: n, bracket, prec: 3, order: out.length });
    else collect(n.arg, [...path, 'arg'], bracket, out, 3, false);
    return;
  }
  if (n.type !== 'binary') return;
  const p = PREC[n.op]!;
  // A sub-expression with lower precedence than its parent was written in brackets.
  const b = bracket + (p < parentPrec ? 1 : 0);
  if (isVal(n.left) && isVal(n.right)) out.push({ path, node: n, bracket: b, prec: p, order: out.length });
  collect(n.left, [...path, 'left'], b, out, p, p === 1);
  collect(n.right, [...path, 'right'], b, out, p + (n.op === '^' ? 0 : 1), p === 1);
}

function replace(root: Node, path: Candidate['path'], v: Node): Node {
  if (!path.length) return v;
  const [k, ...rest] = path;
  const copy = { ...root } as Record<string, unknown>;
  copy[k!] = replace((root as unknown as Record<string, Node>)[k!]!, rest, v);
  return copy as unknown as Node;
}

function apply(n: Node): { v: Q; text: string; reason: string } | null {
  if (n.type === 'neg') {
    const a = valueOf(n.arg)!;
    return { v: q(-a.n, a.d), text: '', reason: 'Apply the minus sign' };
  }
  if (n.type === 'percent') {
    const a = valueOf(n.arg)!;
    return { v: q(a.n, a.d * 100n), text: '', reason: 'A percent is a number out of 100' };
  }
  if (n.type !== 'binary') return null;
  const a = valueOf(n.left)!;
  const b = valueOf(n.right)!;
  switch (n.op) {
    case '+':
      return { v: q(a.n * b.d + b.n * a.d, a.d * b.d), text: '', reason: 'Add' };
    case '-':
      return { v: q(a.n * b.d - b.n * a.d, a.d * b.d), text: '', reason: 'Subtract' };
    case '*':
      return { v: q(a.n * b.n, a.d * b.d), text: '', reason: 'Multiply' };
    case '/':
      if (b.n === 0n) return null;
      return { v: q(a.n * b.d, a.d * b.n), text: '', reason: 'Divide' };
    case '^': {
      if (b.d !== 1n || babs(b.n) > 64n) return null;
      const e = b.n;
      const pn = a.n ** babs(e);
      const pd = a.d ** babs(e);
      if (e < 0n && pn === 0n) return null;
      return { v: e < 0n ? q(pd, pn) : q(pn, pd), text: '', reason: 'Work out the power' };
    }
  }
  return null;
}

const MAX = 14;

export function arithmeticSteps(input: string): StepList | null {
  const session = createSession();
  let ast: Node;
  try {
    ast = parseInput(input, session);
  } catch {
    return null;
  }
  if (!supported(ast) || ast.type === 'num') return null;
  const want = calculate(input, session);
  if (!want.ok) return null;
  const steps: Step[] = [{ reason: 'Start with the expression', latex: toLatex(ast), verified: true }];
  let cur: Node = ast;
  let ops = 0;
  for (let i = 0; i < 60; i++) {
    const cands: Candidate[] = [];
    collect(cur, [], 0, cands, 0);
    if (!cands.length) break;
    // Brackets (deepest first), then powers, then × ÷, then + −; ties left to right.
    cands.sort((x, y) => y.bracket - x.bracket || y.prec - x.prec || x.order - y.order);
    const c = cands[0]!;
    const r = apply(c.node);
    if (!r) return null;
    const before = toLatex(c.node);
    cur = replace(cur, c.path, mark(r.v));
    ops++;
    const where = c.bracket > 0 ? 'Brackets first: ' : c.prec === 4 ? 'Powers next: ' : c.prec === 2 ? 'Then × and ÷, left to right: ' : '';
    const check = calculate(print(cur), session);
    const ok = check.ok && check.value.eq(want.value);
    const plain = (t: string) => t.replace(/\\left|\\right/g, '').replace(/\\times/g, '×').replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '$1/$2').replace(/\^\{([^}]*)\}/g, '^$1').replace(/\\%/g, '%').replace(/(^|[\s(])-/g, '$1−');
    steps.push({ reason: `${where ? where + r.reason.toLowerCase() : r.reason + ':'} ${plain(before)} = ${plain(qText(r.v))}`, latex: toLatex(cur), verified: ok });
    if (!ok) return null;
  }
  if (ops < 2 || ops > MAX) return null;
  const final = valueOf(cur);
  if (final && final.d !== 1n) {
    const dec = new D(final.n.toString()).div(final.d.toString());
    if (!qText(final).includes('/')) return done(steps);
    steps.push({ reason: 'As a decimal', latex: `\\approx ${dec.toSignificantDigits(10).toString()}`, verified: true });
  }
  return done(steps);
}

function done(steps: Step[]): StepList {
  return { method: 'Order of operations', steps, verified: steps.every((s) => s.verified !== false), how: 'Each line re-evaluated by the calculator' };
}
