import type { Node } from './ast';
import { CONSTANTS, DEG, factorial, resolveFunction, type AngleMode } from './builtins';
import { D, type Dec } from './decimal';
import { MathError } from './errors';
import * as Q from './exact';

export interface Scope {
  angle: AngleMode;
  ans: Dec | null;
  /** The "original number" of the previous calculation, e.g. 450 in "20% of 450". */
  base: Dec | null;
  vars: ReadonlyMap<string, Dec>;
  fns?: ReadonlyMap<string, UserFunction>;
}

export interface UserFunction {
  params: string[];
  body: Node;
  /** Original text, for display and persistence. */
  source: string;
}

const MAX_CALL_DEPTH = 200;

export interface EvalValue {
  value: Dec;
  /** Only rational operations were used, so the value may be shown as an exact fraction. */
  rational: boolean;
  /** Exact fraction behind `value`, kept through + − × ÷ mod and integer powers so 1/3·3 is exactly 1. */
  exact?: Q.Exact;
}

/** A result with its exact shadow (when there is one); the Decimal is re-derived from it so no rounding accumulates. */
function withExact(value: Dec, rational: boolean, exact: Q.Exact | undefined): EvalValue {
  return exact && rational ? { value: Q.toDec(exact), rational, exact } : { value, rational };
}
const both = (a: EvalValue, b: EvalValue, f: (x: Q.Exact, y: Q.Exact) => Q.Exact | undefined) => (a.exact && b.exact ? f(a.exact, b.exact) : undefined);

export interface EvalOutput extends EvalValue {
  notes: string[];
  /** The base this calculation establishes for "the original number" follow-ups. */
  base: Dec | null;
}

// Results of transcendental functions are snapped: tiny residue to 0, and rounded to 40 significant digits,
// so cos(90°) is 0 and sin(30°) is exactly 0.5 rather than 0.4999…
const SNAP_SIG = 40;
const SNAP_ZERO = new D('1e-40');

function snap(x: Dec): Dec {
  if (x.abs().lt(SNAP_ZERO)) return new D(0);
  return x.toSignificantDigits(SNAP_SIG);
}

function finite(x: Dec): Dec {
  if (x.isNaN()) throw new MathError('domain', 'No real result');
  if (!x.isFinite()) throw new MathError('overflow', 'Result is too large');
  return x;
}

export function evaluate(ast: Node, rootScope: Scope): EvalOutput {
  const notes: string[] = [];
  let scope = rootScope;
  let depth = 0;
  let base: Dec | null = null;

  const ev = (n: Node): EvalValue => {
    switch (n.type) {
      case 'num':
        return { value: new D(n.value), rational: true, exact: Q.exactLiteral(n.value) };
      case 'name': {
        if (n.name === 'ans') {
          if (!scope.ans) throw new MathError('ambiguous-reference', 'There is no previous result to refer to yet');
          return { value: scope.ans, rational: true };
        }
        if (n.name === 'base') {
          if (!scope.base) throw new MathError('ambiguous-reference', 'Which number is "the original"? There is no earlier calculation with one');
          return { value: scope.base, rational: true };
        }
        const v = scope.vars.get(n.name);
        if (v) return { value: v, rational: true };
        const c = CONSTANTS[n.name];
        if (c) return { value: c, rational: false };
        // "ax" with a and x both defined is a·x (only when every letter is a defined variable).
        if (/^[a-z]{2,4}$/.test(n.name) && [...n.name].every((ch) => scope.vars.has(ch))) {
          notes.push(`Read “${n.name}” as ${[...n.name].join('·')}`);
          return { value: [...n.name].reduce((acc, ch) => acc.mul(scope.vars.get(ch)!), new D(1)), rational: true };
        }
        throw new MathError('unknown-name', `Unknown name "${n.name}"`);
      }
      case 'percent': {
        const a = ev(n.arg);
        return withExact(a.value.div(100), a.rational, a.exact && Q.div(a.exact, Q.exactInt(100)));
      }
      case 'degree': {
        const a = ev(n.arg);
        // In degree mode "30°" is already degrees; in radian mode it converts.
        return scope.angle === 'deg' ? a : { value: a.value.mul(DEG), rational: false };
      }
      case 'factorial': {
        const a = ev(n.arg);
        return { value: factorial(a.value), rational: a.rational };
      }
      case 'neg': {
        const a = ev(n.arg);
        return { value: a.value.neg(), rational: a.rational, exact: a.exact && Q.neg(a.exact) };
      }
      case 'of': {
        const l = ev(n.left);
        const r = ev(n.right);
        base ??= r.value;
        return withExact(finite(l.value.mul(r.value)), l.rational && r.rational, both(l, r, Q.mul));
      }
      case 'off': {
        const l = ev(n.left);
        const r = ev(n.right);
        base ??= r.value;
        notes.push(`${fmt(r.value)} minus ${fmt(l.value.mul(100))}%`);
        const ex = both(l, r, (a, b) => {
          const keep = Q.sub(Q.exactInt(1), a);
          return keep && Q.mul(b, keep);
        });
        return withExact(finite(r.value.mul(new D(1).minus(l.value))), l.rational && r.rational, ex);
      }
      case 'binary':
        return binary(n);
      case 'call': {
        const user = scope.fns?.get(n.name);
        if (user) {
          if (n.args.length !== user.params.length) {
            throw new MathError('syntax', `${n.name} takes ${user.params.length} argument${user.params.length === 1 ? '' : 's'}`);
          }
          if (++depth > MAX_CALL_DEPTH) throw new MathError('overflow', `${n.name} recursed too deeply`);
          const args = n.args.map(ev);
          const outer = scope;
          const vars = new Map(outer.vars);
          user.params.forEach((p, i) => vars.set(p, args[i]!.value));
          scope = { ...outer, vars };
          try {
            return ev(user.body);
          } finally {
            scope = outer;
            depth--;
          }
        }
        const resolved = resolveFunction(n.name);
        if (!resolved) throw new MathError('unknown-name', `Unknown function "${n.name}"`);
        const { def } = resolved;
        if (n.args.length < def.min || n.args.length > def.max) {
          const want = def.min === def.max ? `${def.min}` : def.max === Infinity ? `at least ${def.min}` : `${def.min}–${def.max}`;
          throw new MathError('syntax', `${n.name} takes ${want} argument${want === '1' ? '' : 's'}`);
        }
        const args = n.args.map(ev);
        // sin(π/4) in degree mode: an angle written with π is in radians.
        let fnScope: typeof scope = scope;
        if (scope.angle === 'deg' && TRIG.has(n.name) && n.args.some(hasPi)) {
          fnScope = { ...scope, angle: 'rad' };
          notes.push('The angle contains π, so it was read in radians');
        }
        const value = finite(def.fn(args.map((a) => a.value), fnScope));
        const rational = !!def.rational && args.every((a) => a.rational);
        if (rational) return { value, rational };
        // sqrt(16) is still exactly 4; keep exact display when the snapped result is an integer.
        const s = snap(value);
        return { value: s, rational: s.isInteger() && args.every((a) => a.rational) };
      }
      case 'assign':
        return ev(n.value);
      case 'define':
        throw new MathError('syntax', 'A formula definition has no value by itself');
    }
  };

  // Left-associative chains are evaluated iteratively along their left spine, so a pasted sum of thousands of
  // terms doesn't exhaust the call stack (recursion depth would otherwise equal the number of operators).
  const binary = (n: Extract<Node, { type: 'binary' }>): EvalValue => {
    const spine: Extract<Node, { type: 'binary' }>[] = [];
    let cur: Node = n;
    while (cur.type === 'binary' && cur.op !== '^') {
      spine.push(cur);
      cur = cur.left;
    }
    if (!spine.length) return applyBinary(n, ev(n.left));
    let acc = ev(cur);
    for (let i = spine.length - 1; i >= 0; i--) acc = applyBinary(spine[i]!, acc);
    return acc;
  };

  const applyBinary = (n: Extract<Node, { type: 'binary' }>, l: EvalValue): EvalValue => {
    // Calculator convention: "a + b%" means a increased by b percent (100 + 10% = 110). Disclosed in notes.
    // Not when a is itself a percentage: "5% + 5%" is 10%, like terms added, not 5% increased by 5%.
    if ((n.op === '+' || n.op === '-') && n.right.type === 'percent' && n.left.type !== 'percent') {
      const pct = ev(n.right);
      base ??= l.value;
      const delta = l.value.mul(pct.value);
      notes.push(`${n.op === '+' ? 'Increased' : 'Decreased'} ${fmt(l.value)} by ${fmt(pct.value.mul(100))}% (${n.op === '+' ? '+' : '−'}${fmt(delta.abs())})`);
      const ex = both(l, pct, (a, p) => {
        const d = Q.mul(a, p);
        return d && (n.op === '+' ? Q.add(a, d) : Q.sub(a, d));
      });
      return withExact(n.op === '+' ? l.value.plus(delta) : l.value.minus(delta), l.rational && pct.rational, ex);
    }
    const r = ev(n.right);
    const rational = l.rational && r.rational;
    switch (n.op) {
      case '+':
        base ??= l.value;
        return withExact(finite(l.value.plus(r.value)), rational, both(l, r, Q.add));
      case '-':
        base ??= l.value;
        return withExact(finite(l.value.minus(r.value)), rational, both(l, r, Q.sub));
      case '*':
        base ??= l.value;
        return withExact(finite(l.value.mul(r.value)), rational, both(l, r, Q.mul));
      case '/':
        if (r.value.isZero()) throw new MathError('division-by-zero', 'Division by zero is undefined');
        base ??= l.value;
        return withExact(finite(l.value.div(r.value)), rational, both(l, r, Q.div));
      case 'mod':
        if (r.value.isZero()) throw new MathError('division-by-zero', 'Modulo by zero is undefined');
        // Mathematical (floored) modulo: −7 mod 3 = 2.
        return withExact(l.value.minus(r.value.mul(l.value.div(r.value).floor())), rational, both(l, r, Q.mod));
      case '^': {
        if (l.value.isZero() && r.value.isZero()) notes.push('0⁰ is taken as 1 by convention');
        if (l.value.isZero() && r.value.isNegative()) throw new MathError('division-by-zero', 'Zero to a negative power is undefined');
        if (l.value.isNegative() && !r.value.isInteger()) {
          // (−8)^(1/3): allow when the exponent is (numerically) 1/odd.
          const inv = new D(1).div(r.value);
          const invR = inv.round();
          if (inv.minus(invR).abs().lt('1e-30') && !invR.mod(2).isZero()) {
            return { value: snap(l.value.neg().pow(r.value).neg()), rational: false };
          }
          throw new MathError('domain', 'A negative number to a fractional power has no real result');
        }
        const value = finite(l.value.pow(r.value));
        const isIntPow = r.value.isInteger();
        return isIntPow ? withExact(value, rational, l.exact && r.rational ? Q.pow(l.exact, r.value) : undefined) : { value: snap(value), rational: false };
      }
    }
  };

  const out = ev(ast);
  return { value: out.value, rational: out.rational, exact: out.rational ? out.exact : undefined, notes, base };
}

function fmt(x: Dec): string {
  return x.toSignificantDigits(12).toString();
}

const TRIG = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot']);
function hasPi(n: Node): boolean {
  switch (n.type) {
    case 'name':
      return n.name === 'pi' || n.name === 'tau';
    case 'degree':
      return false;
    case 'num':
      return false;
    case 'binary':
    case 'of':
    case 'off':
      return hasPi(n.left) || hasPi(n.right);
    case 'call':
      return n.args.some(hasPi);
    case 'percent':
    case 'factorial':
    case 'neg':
      return hasPi(n.arg);
    default:
      return false;
  }
}
