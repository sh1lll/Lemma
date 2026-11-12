import * as L from './linalg';
import { MatrixError, Q, type Matrix, type Num } from './linalg';

/**
 * Matrix expressions: "A·B", "2A − B", "A^-1", "Aᵀ", "A^3", "det(A)", "rref(A)", "eigen(A)", "lu(A)",
 * "[[1, 2], [3, 4]]". Capital letters name stored matrices ("AB" is A·B); "ans" is the last result.
 */

export type Value =
  | { t: 'scalar'; v: Num }
  | { t: 'matrix'; v: Matrix }
  /** A result made of labelled parts (eigenvalues, LU, QR, null space): shown, not computed with further. */
  | { t: 'parts'; title: string; parts: { label: string; value: Matrix | Num | string }[] };

export interface Env {
  matrix(name: string): Matrix | undefined;
  ans?: Value;
  /** Evaluates an entry or a scalar the fraction parser doesn't read ("sqrt(2)", "pi/3"). */
  scalar?(text: string): number | null;
}

type Tok = { k: 'num'; v: Num } | { k: 'id'; v: string } | { k: 'op'; v: string };

const FUNCS: Record<string, string> = {
  det: 'det',
  determinant: 'det',
  inv: 'inv',
  inverse: 'inv',
  transpose: 'transpose',
  trans: 'transpose',
  trace: 'trace',
  tr: 'trace',
  rref: 'rref',
  rank: 'rank',
  nullspace: 'null',
  null: 'null',
  kernel: 'null',
  eigenvalues: 'eigvals',
  eigvals: 'eigvals',
  eigenvectors: 'eigvecs',
  eigvecs: 'eigvecs',
  eigen: 'eigvecs',
  eig: 'eigvals',
  lu: 'lu',
  qr: 'qr',
  sqrt: 'sqrt',
  abs: 'abs',
  identity: 'identity',
  eye: 'identity',
};

function lex(src: string): Tok[] {
  const s = src.replace(/[−–]/g, '-').replace(/[×·⋅∙]/g, '*').replace(/÷/g, '/').replace(/⁻¹/g, '^(-1)').replace(/ᵀ/g, '^T').replace(/²/g, '^2').replace(/³/g, '^3').replace(/π/g, ' pi ');
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
    if (num) {
      out.push({ k: 'num', v: L.parseExact(num[0]) ?? Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_]\w*/.exec(s.slice(i));
    if (id) {
      const w = id[0];
      const low = w.toLowerCase();
      if (FUNCS[low] || low === 'ans' || low === 'pi' || low === 'e') out.push({ k: 'id', v: low });
      else if (/^[A-Z]+$/.test(w)) for (const ch of w) out.push({ k: 'id', v: ch });
      else if (w === 'T') out.push({ k: 'id', v: 'T' });
      else throw new MatrixError(`Unknown name “${w}”. Matrices are capital letters (A, B, …)`);
      i += w.length;
      continue;
    }
    if ('+-*/^(),[]√!'.includes(c)) {
      out.push({ k: 'op', v: c });
      i++;
      continue;
    }
    throw new MatrixError(`Unexpected “${c}”`);
  }
  return out;
}

const scalar = (v: Num): Value => ({ t: 'scalar', v });
const matrix = (v: Matrix): Value => ({ t: 'matrix', v });

function asMatrix(v: Value, what: string): Matrix {
  if (v.t === 'matrix') return v.v;
  if (v.t === 'scalar') throw new MatrixError(`${what} needs a matrix`);
  throw new MatrixError(`${v.title} can't be used in a calculation`);
}
function asScalar(v: Value, what: string): Num {
  if (v.t === 'scalar') return v.v;
  if (v.t === 'matrix' && v.v.length === 1 && v.v[0]!.length === 1) return v.v[0]![0]!;
  throw new MatrixError(`${what} needs a number`);
}

class Parser {
  i = 0;
  constructor(
    private toks: Tok[],
    private env: Env,
  ) {}
  peek(): Tok | undefined {
    return this.toks[this.i];
  }
  isOp(v: string, t = this.peek()): boolean {
    return t?.k === 'op' && t.v === v;
  }
  expect(v: string) {
    if (this.isOp(v)) this.i++;
    else if (this.peek()) throw new MatrixError(`Expected “${v}”`);
    // A missing ")" at the end is closed for you.
  }

  parse(): Value {
    if (!this.toks.length) throw new MatrixError('Type an expression, like A·B or det(A)');
    const v = this.expr();
    if (this.peek()) throw new MatrixError(`Unexpected “${(this.peek() as { v: unknown }).v}”`);
    return v;
  }

  expr(): Value {
    let left = this.term();
    while (this.isOp('+') || this.isOp('-')) {
      const minus = (this.toks[this.i++] as { v: string }).v === '-';
      left = addValues(left, this.term(), minus);
    }
    return left;
  }

  startsOperand(t = this.peek()): boolean {
    return !!t && (t.k === 'num' || (t.k === 'id' && t.v !== 'T') || this.isOp('(', t) || this.isOp('[', t) || this.isOp('√', t));
  }

  term(): Value {
    let left = this.unary();
    for (;;) {
      if (this.isOp('*')) {
        this.i++;
        left = mulValues(left, this.unary());
      } else if (this.isOp('/')) {
        this.i++;
        const right = this.unary();
        if (right.t !== 'scalar') throw new MatrixError('Dividing by a matrix isn’t defined; multiply by its inverse (A⁻¹) instead');
        left = mulValues(left, scalar(L.div(L.ONE, right.v)));
      } else if (this.startsOperand()) left = mulValues(left, this.unary());
      else return left;
    }
  }

  unary(): Value {
    if (this.isOp('-')) {
      this.i++;
      return mulValues(scalar(L.Q.int(-1)), this.unary());
    }
    if (this.isOp('+')) {
      this.i++;
      return this.unary();
    }
    return this.power();
  }

  power(): Value {
    const base = this.postfix();
    if (!this.isOp('^')) return base;
    this.i++;
    const t = this.peek();
    if (t?.k === 'id' && t.v === 'T') {
      this.i++;
      return matrix(L.transpose(asMatrix(base, 'Transpose')));
    }
    const e = asScalar(this.unary(), 'A power');
    if (base.t === 'scalar') return scalar(L.isQ(e) && e.d === 1n ? L.powNum(base.v, Number(e.n)) : Math.pow(L.toF(base.v), L.toF(e)));
    const k = L.toF(e);
    return matrix(L.power(asMatrix(base, 'A power'), k));
  }

  postfix(): Value {
    let v = this.primary();
    while (this.isOp('!')) {
      this.i++;
      const n = L.toF(asScalar(v, 'Factorial'));
      if (!Number.isInteger(n) || n < 0 || n > 170) throw new MatrixError('Factorial needs a whole number from 0 to 170');
      let r = 1n;
      for (let k = 2n; k <= BigInt(n); k++) r *= k;
      v = scalar(new Q(r));
    }
    return v;
  }

  primary(): Value {
    const t = this.peek();
    if (!t) throw new MatrixError('The expression is incomplete');
    this.i++;
    if (t.k === 'num') return scalar(t.v);
    if (t.k === 'op' && t.v === '(') {
      const v = this.expr();
      this.expect(')');
      return v;
    }
    if (t.k === 'op' && t.v === '√') return this.call('sqrt', [this.postfix()]);
    if (t.k === 'op' && t.v === '[') return matrix(this.literal());
    if (t.k === 'id') {
      if (t.v === 'pi') return scalar(Math.PI);
      if (t.v === 'e') return scalar(Math.E);
      if (t.v === 'ans') {
        if (!this.env.ans) throw new MatrixError('There is no previous answer yet');
        return this.env.ans;
      }
      const fn = FUNCS[t.v];
      if (fn) {
        const args: Value[] = [];
        if (this.isOp('(')) {
          this.i++;
          if (!this.isOp(')')) {
            args.push(this.expr());
            while (this.isOp(',')) {
              this.i++;
              args.push(this.expr());
            }
          }
          this.expect(')');
        } else args.push(this.power());
        return this.call(fn, args);
      }
      const m = this.env.matrix(t.v);
      if (!m) throw new MatrixError(`There is no matrix ${t.v} yet`);
      return matrix(m);
    }
    throw new MatrixError(`Unexpected “${t.v}”`);
  }

  /** [[1, 2], [3, 4]] or [1, 2, 3] (a row). */
  literal(): Matrix {
    const rowsOut: Matrix = [];
    if (this.isOp('[')) {
      do {
        if (this.isOp(',')) this.i++;
        this.expect('[');
        rowsOut.push(this.row());
        this.expect(']');
      } while (this.isOp(','));
    } else rowsOut.push(this.row());
    this.expect(']');
    if (rowsOut.some((r) => r.length !== rowsOut[0]!.length)) throw new MatrixError('Every row needs the same number of entries');
    return rowsOut;
  }
  row(): Num[] {
    const r = [asScalar(this.expr(), 'A matrix entry')];
    while (this.isOp(',')) {
      this.i++;
      r.push(asScalar(this.expr(), 'A matrix entry'));
    }
    return r;
  }

  call(fn: string, args: Value[]): Value {
    const one = () => {
      if (args.length !== 1) throw new MatrixError(`${fn} takes one matrix`);
      return args[0]!;
    };
    switch (fn) {
      case 'det':
        return scalar(L.det(asMatrix(one(), 'det')));
      case 'inv':
        return matrix(L.inverse(asMatrix(one(), 'The inverse')));
      case 'transpose':
        return matrix(L.transpose(asMatrix(one(), 'Transpose')));
      case 'trace':
        return scalar(L.trace(asMatrix(one(), 'Trace')));
      case 'rref':
        return matrix(L.rref(asMatrix(one(), 'rref')).matrix);
      case 'rank':
        return scalar(Q.int(L.rank(asMatrix(one(), 'Rank'))));
      case 'identity': {
        const n = L.toF(asScalar(one(), 'identity'));
        if (!Number.isInteger(n) || n < 1 || n > 12) throw new MatrixError('identity(n) needs n from 1 to 12');
        return matrix(L.identity(n));
      }
      case 'sqrt': {
        const x = asScalar(one(), '√');
        const f = L.toF(x);
        if (f < 0) throw new MatrixError('Square root of a negative number has no real result');
        if (L.isQ(x)) {
          const rn = bigSqrt(x.n);
          const rd = bigSqrt(x.d);
          if (rn !== null && rd !== null) return scalar(new Q(rn, rd));
        }
        return scalar(Math.sqrt(f));
      }
      case 'abs': {
        const x = asScalar(one(), 'abs');
        return scalar(L.toF(x) < 0 ? L.neg(x) : x);
      }
      case 'null': {
        const basis = L.nullspace(asMatrix(one(), 'Null space'));
        return {
          t: 'parts',
          title: 'Null space',
          parts: basis.length ? basis.map((v, i) => ({ label: `v${sub(i + 1)}`, value: v })) : [{ label: 'Only the zero vector', value: '' }],
        };
      }
      case 'eigvals': {
        const ev = L.eigenvalues(asMatrix(one(), 'Eigenvalues'));
        return { t: 'parts', title: 'Eigenvalues', parts: ev.map((e, i) => ({ label: `λ${sub(i + 1)}${e.multiplicity > 1 ? ` (×${e.multiplicity})` : ''}`, value: e.label })) };
      }
      case 'eigvecs': {
        const m = asMatrix(one(), 'Eigenvectors');
        const vals = L.eigenvalues(m);
        const vecs = L.eigenvectors(m);
        const parts: { label: string; value: Matrix | Num | string }[] = [];
        vals.forEach((e, i) => {
          const label = `λ${sub(i + 1)} = ${e.label}${e.multiplicity > 1 ? ` (×${e.multiplicity})` : ''}`;
          const found = vecs.find((v) => v.value === e || (Math.abs(v.value.re - e.re) < 1e-9 && v.value.im === e.im));
          if (!found || !found.vectors.length) parts.push({ label, value: e.im ? 'complex: vectors not shown' : '' });
          else found.vectors.forEach((v, k) => parts.push({ label: k ? '' : label, value: v }));
        });
        return { t: 'parts', title: 'Eigenvalues and eigenvectors', parts };
      }
      case 'lu': {
        const { P, L: Lm, U } = L.lu(asMatrix(one(), 'LU'));
        return { t: 'parts', title: 'LU (PA = LU)', parts: [{ label: 'P', value: P }, { label: 'L', value: Lm }, { label: 'U', value: U }] };
      }
      case 'qr': {
        const { Q: Qm, R } = L.qr(asMatrix(one(), 'QR'));
        return { t: 'parts', title: 'QR (A = QR)', parts: [{ label: 'Q', value: Qm }, { label: 'R', value: R }] };
      }
    }
    throw new MatrixError(`Unknown function ${fn}`);
  }
}

const SUBS = '₀₁₂₃₄₅₆₇₈₉';
const sub = (n: number) => String(n).replace(/\d/g, (d) => SUBS[Number(d)]!);

function bigSqrt(x: bigint): bigint | null {
  if (x < 0n) return null;
  if (x < 2n) return x;
  let r = BigInt(Math.floor(Math.sqrt(Number(x))));
  while (r * r > x) r--;
  while ((r + 1n) * (r + 1n) <= x) r++;
  return r * r === x ? r : null;
}

function addValues(a: Value, b: Value, minus: boolean): Value {
  if (a.t === 'scalar' && b.t === 'scalar') return scalar(minus ? L.sub(a.v, b.v) : L.add(a.v, b.v));
  if (a.t === 'matrix' && b.t === 'matrix') return matrix(L.addM(a.v, b.v, minus));
  if (a.t === 'parts' || b.t === 'parts') throw new MatrixError(`${a.t === 'parts' ? a.title : (b as { title: string }).title} can't be used in a calculation`);
  throw new MatrixError(`Can't ${minus ? 'subtract' : 'add'} a number and a matrix`);
}

function mulValues(a: Value, b: Value): Value {
  if (a.t === 'parts' || b.t === 'parts') throw new MatrixError(`${a.t === 'parts' ? a.title : (b as { title: string }).title} can't be used in a calculation`);
  if (a.t === 'scalar' && b.t === 'scalar') return scalar(L.mul(a.v, b.v));
  if (a.t === 'scalar') return matrix(L.scale((b as { v: Matrix }).v, a.v));
  if (b.t === 'scalar') return matrix(L.scale(a.v, b.v));
  return matrix(L.mulM(a.v, b.v));
}

export function evaluate(src: string, env: Env): Value {
  return new Parser(lex(src), env).parse();
}

/** An entry typed in a grid cell: exact when it can be ("1/3", "-2.5"), else evaluated ("sqrt(2)", "pi/4"). */
export function parseEntry(text: string, env?: Pick<Env, 'scalar'>): Num | null {
  const t = text.trim();
  if (!t) return L.ZERO;
  const exact = L.parseExact(t);
  if (exact) return exact;
  try {
    const v = evaluate(t, { matrix: () => undefined });
    if (v.t === 'scalar') return v.v;
  } catch {
    // Fall through to the calculator.
  }
  const f = env?.scalar?.(t);
  return f === null || f === undefined || !Number.isFinite(f) ? null : L.tidy(f);
}
