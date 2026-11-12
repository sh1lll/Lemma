import { betaInc, binomCdf, binomPmf, chi2Cdf, gamma as gammaFn, normCdf, normInv, normPdf, poissonCdf, poissonPmf, tCdf, tInv, tPdf } from '@lemma/stats-engine/src/special';

/**
 * The graphing workspace's own expression language: what people type into a row, in the notation graphing
 * calculators use. A tokenizer, a Pratt parser and a compiler to plain float closures (no `new Function`, so it
 * runs under a strict Content-Security-Policy). On top of ordinary arithmetic it reads:
 *
 *   restrictions   y = x² {x > 0}   {0 < x < 2}            piecewise   {x < 0: −x, x}
 *   lists          [1, 2, 3]  [1...10]  L[2]  mean(L)       derivatives f'(x)  f''(x)  d/dx(x²)
 *   sums/products  sum(n=1, 10, n²)  ∑_{n=1}^{10} n²        integrals   ∫_0^2 x² dx
 *   distributions  normalpdf, normalcdf, invnorm, tpdf, tcdf, invt, chisqpdf, binompdf, poissonpdf …
 *   chained comparisons 0 < y < x, |x|, sin²x, sin⁻¹x, superscripts, subscripts (x₁ is x_1).
 *
 * A list anywhere in a row makes the row a family: every list is indexed by the same env slot (`__k`), and the row
 * builder draws one item per element. No DOM here.
 */

export class ExprError extends Error {}

export type Expr =
  | { t: 'num'; v: number }
  | { t: 'name'; name: string }
  | { t: 'neg'; a: Expr }
  | { t: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Expr; b: Expr }
  | { t: 'fact'; a: Expr }
  | { t: 'call'; name: string; args: Expr[]; power?: Expr }
  | { t: 'deriv'; name: string; order: number; args: Expr[] }
  | { t: 'ddx'; v: string; a: Expr }
  | { t: 'tuple'; items: Expr[] }
  | { t: 'list'; items: Expr[] }
  | { t: 'range'; from: Expr; next?: Expr; to: Expr }
  | { t: 'index'; a: Expr; i: Expr }
  | { t: 'piece'; cases: { cond?: Expr; val?: Expr }[] }
  | { t: 'cmp'; ops: Cmp[]; args: Expr[] }
  | { t: 'abs'; a: Expr }
  | { t: 'big'; op: 'sum' | 'prod'; v: string; lo: Expr; hi: Expr; a: Expr }
  | { t: 'int'; v: string; lo: Expr; hi: Expr; a: Expr };

export type Cmp = '=' | '<' | '>' | '<=' | '>=';

// ---------- tokens ----------
type Tok = { k: 'num'; v: number } | { k: 'name'; v: string } | { k: 'op'; v: string };

/** Functions (and words) read as one token even when written without spaces: "sinx" is sin(x). */
const FUNCS = new Set([
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'asin', 'acos', 'atan', 'asec', 'acsc', 'acot', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh', 'arcsinh', 'arccosh', 'arctanh', 'sqrt', 'cbrt', 'abs', 'exp', 'ln', 'log',
  'floor', 'ceil', 'round', 'sign', 'sgn', 'mod', 'min', 'max', 'gcd', 'lcm', 'ncr', 'npr', 'nCr', 'nPr', 'mean', 'median', 'total',
  'length', 'stdev', 'stddev', 'stdevp', 'var', 'variance', 'normalpdf', 'normalcdf', 'invnorm', 'tpdf', 'tcdf', 'invt', 'chisqpdf',
  'chisqcdf', 'binompdf', 'binomcdf', 'poissonpdf', 'poissoncdf', 'sum', 'prod', 'product', 'integral', 'vector', 'atan2', 'arg',
  'fact', 'gammaf', 'erf', 'betainc', 'nthroot', 'root', 'count', 'sort', 'trunc',
]);
const WORDS = new Set(['pi', 'tau', 'theta', 'phi', 'alpha', 'beta', 'lambda', 'mu', 'sigma', 'rho', 'omega', 'delta', 'epsilon', 'inf', 'infinity']);
const ALIAS: Record<string, string> = {
  arcsin: 'asin', arccos: 'acos', arctan: 'atan', arcsinh: 'asinh', arccosh: 'acosh', arctanh: 'atanh', sgn: 'sign', nCr: 'ncr', nPr: 'npr',
  stddev: 'stdev', variance: 'var', product: 'prod', infinity: 'inf',
};

const SUPER: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+', 'ⁿ': 'n' };
const SUB: Record<string, string> = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };
const GREEK: Record<string, string> = { 'π': 'pi', 'θ': 'theta', 'τ': 'tau', 'φ': 'phi', 'ϕ': 'phi', 'α': 'alpha', 'β': 'beta', 'λ': 'lambda', 'μ': 'mu', 'σ': 'sigma', 'ρ': 'rho', 'ω': 'omega', 'δ': 'delta', 'ε': 'epsilon', '∞': 'inf' };

/** Unicode and calculator spellings to the plain forms the tokenizer reads. */
export function normalizeSource(src: string): string {
  let s = src
    .replace(/[−–—]/g, '-')
    .replace(/[×·⋅∙]/g, '*')
    .replace(/÷/g, '/')
    .replace(/≤|⩽/g, '<=')
    .replace(/≥|⩾/g, '>=')
    .replace(/…|⋯/g, '...')
    .replace(/[“”]/g, '"')
    .replace(/\\left|\\right/g, '')
    .replace(/\\cdot/g, '*')
    .replace(/\\(pi|theta|alpha|beta|lambda|mu|sigma|rho|omega|phi|tau)/g, '$1')
    .replace(/\\le\b/g, '<=')
    .replace(/\\ge\b/g, '>=')
    .replace(/\\sqrt/g, 'sqrt')
    .replace(/\\int/g, '∫')
    .replace(/\\sum/g, '∑')
    .replace(/\\prod/g, '∏');
  s = s.replace(/[πθτφϕαβλμσρωδε∞]/g, (c) => ` ${GREEK[c]} `);
  // Superscript runs: x²³ → x^(23), x⁻¹ → x^(-1).
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺ⁿ]+/g, (m) => `^(${[...m].map((c) => SUPER[c]).join('')})`);
  // Subscript digits: x₁ → x_1.
  s = s.replace(/[₀₁₂₃₄₅₆₇₈₉]+/g, (m) => `_${[...m].map((c) => SUB[c]).join('')}`);
  return s.replace(/√/g, 'sqrt').replace(/∛/g, 'cbrt');
}

export function tokenize(src: string, extraWords: ReadonlySet<string> = new Set()): Tok[] {
  const s = normalizeSource(src);
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === ' ' || c === '\t' || c === '\n') {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c) && !s.startsWith('...', i) && !(c === '.' && !/[0-9]/.test(s[i + 1] ?? ''))) {
      let j = i;
      while (j < s.length && /[0-9]/.test(s[j]!)) j++;
      if (s[j] === '.' && s[j + 1] !== '.') {
        j++;
        while (j < s.length && /[0-9]/.test(s[j]!)) j++;
      }
      const v = Number(s.slice(i, j));
      if (!Number.isFinite(v)) throw new ExprError(`Can't read the number “${s.slice(i, j)}”`);
      out.push({ k: 'num', v });
      i = j;
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      let j = i;
      while (j < s.length && /[a-zA-Z]/.test(s[j]!)) j++;
      const run = s.slice(i, j);
      i = j;
      // Split the letter run into known words and single letters, longest word first.
      let p = 0;
      while (p < run.length) {
        let hit = '';
        for (let L = run.length - p; L >= 2; L--) {
          const w = run.slice(p, p + L);
          if (FUNCS.has(w) || WORDS.has(w) || extraWords.has(w) || FUNCS.has(w.toLowerCase())) {
            hit = w;
            break;
          }
        }
        let name = hit || run[p]!;
        p += name.length;
        if (FUNCS.has(name.toLowerCase()) && !FUNCS.has(name)) name = name.toLowerCase();
        // A subscript belongs to the last letter: x_1, a_{max}.
        if (p === run.length && s[i] === '_' && !hit) {
          let k = i + 1;
          let sub = '';
          if (s[k] === '{') {
            const end = s.indexOf('}', k);
            if (end < 0) throw new ExprError('A subscript is missing its closing }');
            sub = s.slice(k + 1, end).replace(/\s+/g, '');
            k = end + 1;
          } else {
            while (k < s.length && /[a-zA-Z0-9]/.test(s[k]!)) k++;
            sub = s.slice(i + 1, k);
          }
          if (sub && /^[a-zA-Z0-9]+$/.test(sub)) {
            name = `${name}_${sub}`;
            i = k;
          }
        }
        out.push({ k: 'name', v: ALIAS[name] ?? name });
      }
      continue;
    }
    const three = s.slice(i, i + 3);
    if (three === '...') {
      out.push({ k: 'op', v: '...' });
      i += 3;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '**' || two === '!=') {
      out.push({ k: 'op', v: two === '**' ? '^' : two });
      i += 2;
      continue;
    }
    if ('+-*/^()[]{},:=<>~\'!|_∫∑∏;'.includes(c)) {
      out.push({ k: 'op', v: c === ';' ? ',' : c });
      i++;
      continue;
    }
    if (c === '"') {
      // Labels in quotes are handled by the row builder; skip them here.
      const end = s.indexOf('"', i + 1);
      i = end < 0 ? s.length : end + 1;
      continue;
    }
    throw new ExprError(`Unexpected “${c}”`);
  }
  return out;
}

// ---------- parser ----------
const isOp = (t: Tok | undefined, v: string) => !!t && t.k === 'op' && t.v === v;
const CMP = new Set(['=', '<', '>', '<=', '>=']);

export function parseExpr(src: string, extraWords?: ReadonlySet<string>): Expr {
  const toks = tokenize(src, extraWords);
  if (!toks.length) throw new ExprError('Empty');
  const p = new Parser(toks);
  const e = p.top();
  if (p.i < toks.length) {
    const t = toks[p.i]!;
    throw new ExprError(`Unexpected “${t.k === 'num' ? t.v : t.v}”`);
  }
  return e;
}

class Parser {
  i = 0;
  /** Inside an integral body: stop the product at "d<var>". */
  private stopDiff = 0;
  /** Inside |…|: a bar closes rather than opens. */
  private absDepth = 0;
  constructor(private toks: Tok[]) {}

  private peek(o = 0) {
    return this.toks[this.i + o];
  }
  private eat(v: string): boolean {
    if (isOp(this.peek(), v)) {
      this.i++;
      return true;
    }
    return false;
  }
  private expect(v: string): void {
    if (!this.eat(v)) throw new ExprError(this.peek() ? `Expected “${v}”` : `Missing “${v}”`);
  }

  top(): Expr {
    return this.comparison();
  }

  private comparison(): Expr {
    const first = this.sum();
    const t = this.peek();
    if (!t || t.k !== 'op' || !CMP.has(t.v)) return first;
    const ops: Cmp[] = [];
    const args = [first];
    while (this.peek()?.k === 'op' && CMP.has((this.peek() as { v: string }).v)) {
      ops.push((this.toks[this.i++] as { v: string }).v as Cmp);
      args.push(this.sum());
    }
    return { t: 'cmp', ops, args };
  }

  private sum(): Expr {
    let a = this.product();
    for (;;) {
      if (this.eat('+')) a = { t: 'bin', op: '+', a, b: this.product() };
      else if (this.eat('-')) a = { t: 'bin', op: '-', a, b: this.product() };
      else return a;
    }
  }

  /** Starts a term that can follow another by juxtaposition (2x, x(y), (a)(b), 3sin x, x[1,2]). */
  private startsTerm(): boolean {
    const t = this.peek();
    if (!t) return false;
    if (t.k === 'num' || t.k === 'name') {
      if (this.stopDiff && t.k === 'name' && t.v === 'd' && this.peek(1)?.k === 'name') return false;
      return true;
    }
    if (t.v === '|') return this.absDepth === 0;
    return t.v === '(' || t.v === '[' || t.v === '{' || t.v === '∫' || t.v === '∑' || t.v === '∏';
  }

  private product(): Expr {
    let a = this.unary();
    for (;;) {
      if (this.eat('*')) a = { t: 'bin', op: '*', a, b: this.unary() };
      else if (this.eat('/')) a = { t: 'bin', op: '/', a, b: this.unary() };
      else if (this.startsTerm()) {
        // "[…]" right after a value is indexing (L[2]); the compiler turns it back into a product when L isn't a list.
        if (isOp(this.peek(), '[') && (a.t === 'name' || a.t === 'list' || a.t === 'index')) {
          this.i++;
          const items = this.listItems(']');
          a = items.t === 'list' && items.items.length === 1 ? { t: 'index', a, i: items.items[0]! } : { t: 'index', a, i: items };
          continue;
        }
        a = { t: 'bin', op: '*', a, b: this.power() };
      } else return a;
    }
  }

  private unary(): Expr {
    if (this.eat('-')) return { t: 'neg', a: this.unary() };
    if (this.eat('+')) return this.unary();
    return this.power();
  }

  private power(): Expr {
    let base = this.postfix();
    if (this.eat('^')) {
      const exp = this.eat('-') ? ({ t: 'neg', a: this.power() } as Expr) : this.power();
      base = { t: 'bin', op: '^', a: base, b: exp };
    }
    return base;
  }

  private postfix(): Expr {
    let a = this.primary();
    while (this.eat('!')) a = { t: 'fact', a };
    return a;
  }

  private primary(): Expr {
    const t = this.peek();
    if (!t) throw new ExprError('Something is missing at the end');
    if (t.k === 'num') {
      this.i++;
      return { t: 'num', v: t.v };
    }
    if (t.k === 'name') return this.named();
    switch (t.v) {
      case '(': {
        this.i++;
        const first = this.top();
        if (this.eat(',')) {
          const items = [first, this.top()];
          while (this.eat(',')) items.push(this.top());
          this.expect(')');
          return { t: 'tuple', items };
        }
        this.expect(')');
        return first;
      }
      case '[':
        this.i++;
        return this.listItems(']');
      case '{':
        this.i++;
        return this.piecewise();
      case '|': {
        this.i++;
        this.absDepth++;
        const a = this.sum();
        this.absDepth--;
        this.expect('|');
        return { t: 'abs', a };
      }
      case '∫':
        this.i++;
        return this.integral();
      case '∑':
      case '∏':
        this.i++;
        return this.bigOp(t.v === '∑' ? 'sum' : 'prod');
    }
    throw new ExprError(`Unexpected “${t.v}”`);
  }

  private listItems(close: string): Expr {
    const items: Expr[] = [];
    if (this.eat(close)) return { t: 'list', items };
    for (;;) {
      if (this.eat('...')) {
        const to = this.top();
        this.expect(close);
        if (!items.length) throw new ExprError('A range needs a start: [1...10]');
        return { t: 'range', from: items[0]!, next: items[1], to };
      }
      items.push(this.top());
      if (this.eat(',')) continue;
      if (isOp(this.peek(), '...')) continue;
      this.expect(close);
      return { t: 'list', items };
    }
  }

  private piecewise(): Expr {
    const cases: { cond?: Expr; val?: Expr }[] = [];
    if (this.eat('}')) return { t: 'piece', cases: [] };
    for (;;) {
      const first = this.top();
      if (this.eat(':')) cases.push({ cond: first, val: this.top() });
      else if (first.t === 'cmp') cases.push({ cond: first });
      else cases.push({ val: first });
      if (this.eat(',')) continue;
      this.expect('}');
      return { t: 'piece', cases };
    }
  }

  /** `_lo^hi` (or `_{lo}^{hi}`) bounds after ∫ ∑ ∏. */
  private bound(): Expr {
    if (this.eat('{')) {
      const e = this.top();
      this.expect('}');
      return e;
    }
    if (this.eat('(')) {
      const e = this.top();
      this.expect(')');
      return e;
    }
    if (this.eat('-')) return { t: 'neg', a: this.postfix() };
    return this.postfix();
  }

  private integral(): Expr {
    let lo: Expr;
    let hi: Expr;
    if (this.eat('_')) {
      lo = this.bound();
      this.expect('^');
      hi = this.bound();
    } else if (isOp(this.peek(), '(')) {
      this.i++;
      lo = this.top();
      this.expect(',');
      hi = this.top();
      this.expect(')');
    } else throw new ExprError('Give the integral bounds: ∫_0^2 x² dx');
    this.stopDiff++;
    const body = this.sum();
    this.stopDiff--;
    let v = 'x';
    const d = this.peek();
    const n = this.peek(1);
    if (d?.k === 'name' && d.v === 'd' && n?.k === 'name') {
      v = n.v;
      this.i += 2;
    }
    return { t: 'int', v, lo, hi, a: body };
  }

  private bigOp(op: 'sum' | 'prod'): Expr {
    this.expect('_');
    let v = 'n';
    let lo: Expr;
    const open = this.eat('{') ? '}' : this.eat('(') ? ')' : '';
    if (open) {
      const e = this.top();
      this.expect(open);
      if (e.t === 'cmp' && e.ops.length === 1 && e.ops[0] === '=' && e.args[0]!.t === 'name') {
        v = (e.args[0] as { name: string }).name;
        lo = e.args[1]!;
      } else lo = e;
    } else {
      const name = this.peek();
      if (name?.k === 'name' && isOp(this.peek(1), '=')) {
        v = name.v;
        this.i += 2;
      }
      lo = this.bound();
    }
    this.expect('^');
    const hi = this.bound();
    const a = this.product();
    return { t: 'big', op, v, lo, hi, a };
  }

  private named(): Expr {
    const t = this.toks[this.i++] as { k: 'name'; v: string };
    const name = t.v;
    // d/dx …
    if (name === 'd' && isOp(this.peek(), '/') && this.peek(1)?.k === 'name' && (this.peek(1) as { v: string }).v === 'd' && this.peek(2)?.k === 'name') {
      const v = (this.peek(2) as { v: string }).v;
      this.i += 3;
      return { t: 'ddx', v, a: this.isCallOpen() ? this.paren() : this.power() };
    }
    // f'(x), f''(x)
    if (isOp(this.peek(), "'")) {
      let order = 0;
      while (this.eat("'")) order++;
      if (!isOp(this.peek(), '(')) throw new ExprError(`${name}${"'".repeat(order)} needs an argument, e.g. ${name}'(x)`);
      this.i++;
      const args = this.args();
      return { t: 'deriv', name, order, args };
    }
    if (FUNCS.has(name)) {
      if (name === 'sum' || name === 'prod') {
        if (isOp(this.peek(), '_')) return this.bigOp(name);
        return this.bigCall(name);
      }
      if (name === 'integral' && isOp(this.peek(), '(')) {
        this.i++;
        const args = this.args();
        if (args.length !== 3) throw new ExprError('integral(f(x), a, b) takes three parts');
        return { t: 'int', v: 'x', lo: args[1]!, hi: args[2]!, a: args[0]! };
      }
      // sin^2 x, sin^-1 x
      let power: Expr | undefined;
      if (isOp(this.peek(), '^') && name !== 'log') {
        this.i++;
        power = this.eat('-') ? { t: 'neg', a: this.postfix() } : this.postfix();
        if (power.t === 'neg' && power.a.t === 'num' && power.a.v === 1 && /^(sin|cos|tan|sec|csc|cot|sinh|cosh|tanh)$/.test(name)) {
          return { t: 'call', name: `a${name}`, args: [this.fnArg()] };
        }
      }
      // log_2(x), log_b x
      if (name === 'log' && isOp(this.peek(), '_')) {
        this.i++;
        const base = this.bound();
        return { t: 'call', name: 'log', args: [this.fnArg(), base] };
      }
      if (isOp(this.peek(), '(')) {
        this.i++;
        const args = this.args();
        return { t: 'call', name, args, power };
      }
      return { t: 'call', name, args: [this.fnArg()], power };
    }
    // A single-letter name followed by "(" may be a user function; the compiler decides (else it's a product).
    if (isOp(this.peek(), '(') && /^[a-zA-Z](_\w+)?$/.test(name) && !WORDS.has(name)) {
      const save = this.i;
      this.i++;
      const args = this.args();
      if (args.length === 1 || args.every((a) => a.t !== 'tuple')) return { t: 'call', name, args };
      this.i = save;
    }
    return { t: 'name', name };
  }

  private isCallOpen() {
    return isOp(this.peek(), '(');
  }
  private paren(): Expr {
    this.expect('(');
    const e = this.top();
    this.expect(')');
    return e;
  }

  /** "sin 2x" is sin(2x); "sin x cos x" is sin(x)·cos(x): the argument stops at the next function. */
  private fnArg(): Expr {
    let a = this.unaryNoFn();
    while (this.startsTerm() && !(this.peek()?.k === 'name' && FUNCS.has((this.peek() as { v: string }).v)) && !isOp(this.peek(), '(')) {
      a = { t: 'bin', op: '*', a, b: this.power() };
    }
    return a;
  }
  private unaryNoFn(): Expr {
    if (this.eat('-')) return { t: 'neg', a: this.unaryNoFn() };
    return this.power();
  }

  private args(): Expr[] {
    const args: Expr[] = [];
    if (this.eat(')')) return args;
    for (;;) {
      args.push(this.top());
      if (this.eat(',')) continue;
      this.expect(')');
      return args;
    }
  }

  /** sum(n=1, 10, n²) / prod(…). */
  private bigCall(op: 'sum' | 'prod'): Expr {
    if (!this.eat('(')) return { t: 'name', name: op };
    const args = this.args();
    if (args.length === 3) {
      const head = args[0]!;
      if (head.t === 'cmp' && head.ops[0] === '=' && head.args[0]!.t === 'name') {
        return { t: 'big', op, v: (head.args[0] as { name: string }).name, lo: head.args[1]!, hi: args[1]!, a: args[2]! };
      }
    }
    if (args.length === 4 && args[1]!.t === 'name') {
      // sum(n², n, 1, 10)
      return { t: 'big', op, v: (args[1] as { name: string }).name, lo: args[2]!, hi: args[3]!, a: args[0]! };
    }
    // sum(L) / sum(1, 2, 3): the total of a list.
    return { t: 'call', name: op === 'sum' ? 'total' : 'prodlist', args };
  }
}

// ---------- analysis ----------
/** Every name used as a variable (not functions), excluding names bound inside sums/integrals. */
export function namesIn(e: Expr, bound: ReadonlySet<string> = new Set()): Set<string> {
  const out = new Set<string>();
  const rec = (n: Expr, b: ReadonlySet<string>) => {
    switch (n.t) {
      case 'num':
        return;
      case 'name':
        if (!b.has(n.name)) out.add(n.name);
        return;
      case 'neg':
      case 'fact':
      case 'abs':
        return rec(n.a, b);
      case 'bin':
        rec(n.a, b);
        return rec(n.b, b);
      case 'call':
        n.args.forEach((a) => rec(a, b));
        if (n.power) rec(n.power, b);
        return;
      case 'deriv':
        return n.args.forEach((a) => rec(a, b));
      case 'ddx':
        out.add(n.v);
        return rec(n.a, b);
      case 'tuple':
      case 'list':
        return n.items.forEach((a) => rec(a, b));
      case 'range':
        rec(n.from, b);
        if (n.next) rec(n.next, b);
        return rec(n.to, b);
      case 'index':
        rec(n.a, b);
        return rec(n.i, b);
      case 'piece':
        return n.cases.forEach((c) => {
          if (c.cond) rec(c.cond, b);
          if (c.val) rec(c.val, b);
        });
      case 'cmp':
        return n.args.forEach((a) => rec(a, b));
      case 'big':
      case 'int': {
        rec(n.lo, b);
        rec(n.hi, b);
        const nb = new Set(b);
        nb.add(n.v);
        return rec(n.a, nb);
      }
    }
  };
  rec(e, bound);
  return out;
}

/** Names called as functions (f in f(x), f'(x)). */
export function callsIn(e: Expr): Set<string> {
  const out = new Set<string>();
  const rec = (n: Expr): void => {
    if (n.t === 'call' && !FUNCS.has(n.name) && n.name !== 'prodlist') out.add(n.name);
    if (n.t === 'deriv') out.add(n.name);
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach((x) => x && typeof x === 'object' && ('t' in x ? rec(x as Expr) : (x.cond && rec(x.cond), x.val && rec(x.val))));
      else if (v && typeof v === 'object' && 't' in v) rec(v as Expr);
    }
  };
  rec(e);
  return out;
}

/** Plain-text form for labels and descriptions. */
export function show(e: Expr): string {
  const p = (n: Expr, prec: number): string => {
    switch (n.t) {
      case 'num':
        return String(Number(n.v.toPrecision(10)));
      case 'name':
        return n.name === 'theta' ? 'θ' : n.name === 'pi' ? 'π' : n.name;
      case 'neg':
        return wrap(`−${p(n.a, 3)}`, prec > 2);
      case 'bin': {
        const pr = n.op === '+' || n.op === '-' ? 1 : n.op === '^' ? 4 : 2;
        const op = n.op === '*' ? (n.a.t === 'num' && n.b.t !== 'num' ? '' : '·') : n.op === '-' ? ' − ' : n.op === '+' ? ' + ' : n.op;
        return wrap(`${p(n.a, pr)}${op}${p(n.b, pr + (n.op === '^' ? 0 : 1))}`, prec > pr);
      }
      case 'fact':
        return `${p(n.a, 5)}!`;
      case 'call':
        return `${n.name}${n.power ? `^${p(n.power, 5)}` : ''}(${n.args.map((a) => p(a, 0)).join(', ')})`;
      case 'deriv':
        return `${n.name}${"'".repeat(n.order)}(${n.args.map((a) => p(a, 0)).join(', ')})`;
      case 'ddx':
        return `d/d${n.v}(${p(n.a, 0)})`;
      case 'tuple':
        return `(${n.items.map((a) => p(a, 0)).join(', ')})`;
      case 'list':
        return `[${n.items.map((a) => p(a, 0)).join(', ')}]`;
      case 'range':
        return `[${p(n.from, 0)}${n.next ? `, ${p(n.next, 0)}` : ''}...${p(n.to, 0)}]`;
      case 'index':
        return `${p(n.a, 5)}[${p(n.i, 0)}]`;
      case 'piece':
        return `{${n.cases.map((c) => (c.cond && c.val ? `${p(c.cond, 0)}: ${p(c.val, 0)}` : p((c.cond ?? c.val)!, 0))).join(', ')}}`;
      case 'cmp':
        return n.args.map((a, i) => (i ? ` ${n.ops[i - 1]!.replace('<=', '≤').replace('>=', '≥')} ` : '') + p(a, 1)).join('');
      case 'abs':
        return `|${p(n.a, 0)}|`;
      case 'big':
        return `${n.op === 'sum' ? '∑' : '∏'}(${n.v}=${p(n.lo, 0)}…${p(n.hi, 0)}) ${p(n.a, 3)}`;
      case 'int':
        return `∫(${p(n.lo, 0)}…${p(n.hi, 0)}) ${p(n.a, 1)} d${n.v}`;
    }
  };
  const wrap = (s: string, yes: boolean) => (yes ? `(${s})` : s);
  return p(e, 0).replace(/\btheta\b/g, 'θ');
}

// ---------- compiler ----------
export type Env = Record<string, number>;
export type Fn = (e: Env) => number;
/** A compiled expression: `n` is the list length when the expression is a list (a family), else null. */
export interface C {
  f: Fn;
  n: number | null;
}

export interface Scope {
  angle: 'rad' | 'deg';
  /** Names read from the env at call time (x, y, t, θ, slider values…). */
  free: ReadonlySet<string>;
  /** Names defined by other rows as expressions ("b = 2a"); compiled on demand. */
  defs?: ReadonlyMap<string, Expr>;
  /** Lists defined by other rows or table columns. */
  lists?: ReadonlyMap<string, Expr | number[]>;
  /** User functions: f(x) = …, g(x, y) = …. */
  fns?: ReadonlyMap<string, { params: string[]; body: Expr }>;
  /** Fixed numbers (calculator variables). */
  consts?: ReadonlyMap<string, number>;
  /** Functions from outside (the calculator's own definitions). */
  extFns?: (name: string) => ((...a: number[]) => number) | null;
  /** Names that are neither defined nor free are collected here (they become sliders) and read from the env. */
  missing?: Set<string>;
  /** In implicit equations r and θ mean the polar coordinates of (x, y). */
  polarXY?: boolean;
  /** Parameter values for compile-time constants (list ranges with slider ends). */
  params?: Env;
}

const K = '__k';

const truthy = (v: number) => v !== 0 && !Number.isNaN(v);

function aggregate(name: string, xs: number[]): number {
  const n = xs.length;
  if (!n) return NaN;
  switch (name) {
    case 'total':
      return xs.reduce((a, b) => a + b, 0);
    case 'prodlist':
      return xs.reduce((a, b) => a * b, 1);
    case 'mean':
      return xs.reduce((a, b) => a + b, 0) / n;
    case 'length':
    case 'count':
      return n;
    case 'min':
      return Math.min(...xs);
    case 'max':
      return Math.max(...xs);
    case 'median': {
      const s = [...xs].sort((a, b) => a - b);
      return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
    }
    case 'var':
    case 'stdev':
    case 'stdevp': {
      const m = xs.reduce((a, b) => a + b, 0) / n;
      const ss = xs.reduce((a, b) => a + (b - m) ** 2, 0);
      const v = name === 'stdevp' ? ss / n : ss / (n - 1);
      return name === 'var' ? v : Math.sqrt(v);
    }
  }
  return NaN;
}
const AGG = new Set(['total', 'prodlist', 'mean', 'length', 'count', 'min', 'max', 'median', 'var', 'stdev', 'stdevp']);

function choose(n: number, k: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || n < 0) return NaN;
  if (k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}
const fact = (n: number) => {
  if (Number.isInteger(n)) {
    if (n < 0) return NaN;
    if (n > 170) return Infinity;
    let r = 1;
    for (let k = 2; k <= n; k++) r *= k;
    return r;
  }
  return gammaFn(n + 1);
};
const gcd = (a: number, b: number): number => {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) [a, b] = [b, a % b];
  return a;
};
const nthRoot = (x: number, n: number) => (x < 0 ? (Math.round(n) % 2 === 1 ? -((-x) ** (1 / n)) : NaN) : x ** (1 / n));

function builtin(name: string, angle: 'rad' | 'deg'): ((...a: number[]) => number) | null {
  const k = angle === 'deg' ? Math.PI / 180 : 1;
  const inv = (f: (x: number) => number) => (x: number) => f(x) / k;
  const T: Record<string, (...a: number[]) => number> = {
    sin: (x) => Math.sin(x * k),
    cos: (x) => Math.cos(x * k),
    tan: (x) => Math.tan(x * k),
    sec: (x) => 1 / Math.cos(x * k),
    csc: (x) => 1 / Math.sin(x * k),
    cot: (x) => 1 / Math.tan(x * k),
    asin: inv(Math.asin),
    acos: inv(Math.acos),
    atan: inv(Math.atan),
    asec: inv((x) => Math.acos(1 / x)),
    acsc: inv((x) => Math.asin(1 / x)),
    acot: inv((x) => Math.atan(1 / x)),
    atan2: (y, x) => Math.atan2(y, x) / k,
    arg: (x, y) => Math.atan2(y, x) / k,
    sinh: Math.sinh,
    cosh: Math.cosh,
    tanh: Math.tanh,
    asinh: Math.asinh,
    acosh: Math.acosh,
    atanh: Math.atanh,
    sqrt: Math.sqrt,
    cbrt: Math.cbrt,
    abs: Math.abs,
    exp: Math.exp,
    ln: Math.log,
    log: (x, b) => (b === undefined ? Math.log10(x) : Math.log(x) / Math.log(b)),
    floor: Math.floor,
    ceil: Math.ceil,
    trunc: Math.trunc,
    round: (x, p = 0) => Math.round(x * 10 ** p) / 10 ** p,
    sign: Math.sign,
    mod: (a, b) => a - b * Math.floor(a / b),
    gcd,
    lcm: (a, b) => (a && b ? Math.abs(Math.round(a) * Math.round(b)) / gcd(a, b) : 0),
    ncr: choose,
    npr: (n, r) => (r > n ? 0 : fact(n) / fact(n - r)),
    fact,
    gammaf: gammaFn,
    nthroot: (x, n) => nthRoot(x, n),
    root: (x, n) => nthRoot(x, n),
    erf: (x) => 2 * normCdf(x * Math.SQRT2) - 1,
    betainc: (x, a, b) => betaInc(x, a, b),
    normalpdf: (x, mu = 0, sd = 1) => normPdf((x - mu) / sd) / sd,
    normalcdf: (lo, hi, mu = 0, sd = 1) => normCdf((hi - mu) / sd) - normCdf((lo - mu) / sd),
    invnorm: (p, mu = 0, sd = 1) => (p > 0 && p < 1 ? mu + sd * normInv(p) : NaN),
    tpdf: (x, df) => (df > 0 ? tPdf(x, df) : NaN),
    tcdf: (lo, hi, df) => (df > 0 ? tCdf(hi, df) - tCdf(lo, df) : NaN),
    invt: (p, df) => (p > 0 && p < 1 && df > 0 ? tInv(p, df) : NaN),
    chisqpdf: (x, df) => (x < 0 || !(df > 0) ? 0 : Math.exp((df / 2 - 1) * Math.log(x) - x / 2 - (df / 2) * Math.LN2 - Math.log(gammaFn(df / 2)))),
    chisqcdf: (lo, hi, df) => chi2Cdf(Math.max(0, hi), df) - chi2Cdf(Math.max(0, lo), df),
    binompdf: (n, p, x) => (Number.isInteger(x) ? binomPmf(x, n, p) : 0),
    binomcdf: (n, p, x) => binomCdf(Math.floor(x), n, p),
    poissonpdf: (l, x) => (Number.isInteger(x) && x >= 0 ? poissonPmf(x, l) : 0),
    poissoncdf: (l, x) => poissonCdf(Math.floor(x), l),
  };
  return T[name] ?? null;
}

export function isBuiltin(name: string): boolean {
  return FUNCS.has(name) || name === 'prodlist';
}

const CONST: Record<string, number> = { pi: Math.PI, tau: 2 * Math.PI, e: Math.E, inf: Infinity };

/** Simpson's rule with 128 panels; NaN bounds or integrands give NaN. */
function simpson(g: (t: number) => number, a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  if (a === b) return 0;
  const n = 128;
  const h = (b - a) / n;
  let s = g(a) + g(b);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * g(a + i * h);
  return (s * h) / 3;
}

export function compile(node: Expr, scope: Scope): C {
  const stack: string[] = [];
  const angle = scope.angle;

  const rec = (n: Expr, bind: ReadonlyMap<string, C>): C => {
    switch (n.t) {
      case 'num': {
        const v = n.v;
        return { f: () => v, n: null };
      }
      case 'name':
        return nameRef(n.name, bind);
      case 'neg': {
        const a = rec(n.a, bind);
        return { f: (e) => -a.f(e), n: a.n };
      }
      case 'fact': {
        const a = rec(n.a, bind);
        return { f: (e) => fact(a.f(e)), n: a.n };
      }
      case 'abs': {
        const a = rec(n.a, bind);
        return { f: (e) => Math.abs(a.f(e)), n: a.n };
      }
      case 'bin': {
        const a = rec(n.a, bind);
        const b = rec(n.b, bind);
        const len = joinLen(a.n, b.n);
        const af = a.f;
        const bf = b.f;
        switch (n.op) {
          case '+':
            return { f: (e) => af(e) + bf(e), n: len };
          case '-':
            return { f: (e) => af(e) - bf(e), n: len };
          case '*':
            return { f: (e) => af(e) * bf(e), n: len };
          case '/':
            return { f: (e) => af(e) / bf(e), n: len };
          case '^':
            return {
              f: (e) => {
                const x = af(e);
                const p = bf(e);
                if (x < 0 && !Number.isInteger(p)) {
                  const inv = 1 / p;
                  const ri = Math.round(inv);
                  if (Math.abs(inv - ri) < 1e-9 && ri % 2 !== 0) return -((-x) ** p);
                }
                return x ** p;
              },
              n: len,
            };
        }
        break;
      }
      case 'cmp': {
        const args = n.args.map((a) => rec(a, bind));
        const ops = n.ops;
        let len: number | null = null;
        for (const a of args) len = joinLen(len, a.n);
        return {
          f: (e) => {
            let prev = args[0]!.f(e);
            for (let i = 0; i < ops.length; i++) {
              const cur = args[i + 1]!.f(e);
              const op = ops[i]!;
              const ok = op === '<' ? prev < cur : op === '>' ? prev > cur : op === '<=' ? prev <= cur : op === '>=' ? prev >= cur : Math.abs(prev - cur) < 1e-9 * Math.max(1, Math.abs(prev));
              if (!ok) return 0;
              prev = cur;
            }
            return 1;
          },
          n: len,
        };
      }
      case 'piece': {
        const cases = n.cases.map((c) => ({ cond: c.cond ? rec(c.cond, bind) : null, val: c.val ? rec(c.val, bind) : null }));
        let len: number | null = null;
        for (const c of cases) len = joinLen(joinLen(len, c.cond?.n ?? null), c.val?.n ?? null);
        return {
          f: (e) => {
            for (const c of cases) {
              if (!c.cond) return c.val ? c.val.f(e) : 1;
              if (truthy(c.cond.f(e))) return c.val ? c.val.f(e) : 1;
            }
            return NaN;
          },
          n: len,
        };
      }
      case 'list': {
        if (!n.items.length) return { f: () => NaN, n: 0 };
        const items = n.items.map((a) => rec(a, bind));
        if (items.some((i) => i.n !== null)) throw new ExprError('Lists inside lists aren’t supported');
        const fs = items.map((i) => i.f);
        const N = fs.length;
        return { f: (e) => fs[(e[K] ?? 0) | 0]?.(e) ?? NaN, n: N };
      }
      case 'range': {
        const env = { ...(scope.params ?? {}) };
        const from = rec(n.from, bind).f(env);
        const to = rec(n.to, bind).f(env);
        const step = n.next ? rec(n.next, bind).f(env) - from : to >= from ? 1 : -1;
        if (![from, to, step].every(Number.isFinite) || step === 0 || (to - from) / step < 0) throw new ExprError('That range is empty');
        const N = Math.floor((to - from) / step + 1e-9) + 1;
        if (N > 10000) throw new ExprError('Ranges can have up to 10,000 values');
        return { f: (e) => { const k = (e[K] ?? 0) | 0; return k < N ? from + k * step : NaN; }, n: N };
      }
      case 'index': {
        const a = rec(n.a, bind);
        if (a.n === null) {
          // Not a list: "x[1, 2]" is x times a list.
          const b = rec(n.i.t === 'list' ? n.i : { t: 'list', items: [n.i] }, bind);
          return { f: (e) => a.f(e) * b.f(e), n: b.n };
        }
        const i = rec(n.i, bind);
        const af = a.f;
        if (i.n !== null) {
          // L[[1, 3]]: a sub-list.
          const fi = i.f;
          return { f: (e) => { const save = e[K]; const idx = Math.round(fi(e)) - 1; e[K] = idx; const v = idx >= 0 && idx < a.n! ? af(e) : NaN; e[K] = save!; return v; }, n: i.n };
        }
        const N = a.n;
        return {
          f: (e) => {
            const idx = Math.round(i.f(e)) - 1;
            if (!(idx >= 0 && idx < N)) return NaN;
            const save = e[K];
            e[K] = idx;
            const v = af(e);
            e[K] = save!;
            return v;
          },
          n: null,
        };
      }
      case 'tuple':
        throw new ExprError('A point can’t be used inside a calculation here');
      case 'call':
        return call(n, bind);
      case 'deriv': {
        const fn = scope.fns?.get(n.name);
        if (!fn) throw new ExprError(`${n.name} isn’t defined: add a row like ${n.name}(x) = x²`);
        if (n.args.length !== fn.params.length) throw new ExprError(`${n.name} takes ${fn.params.length} input${fn.params.length > 1 ? 's' : ''}`);
        const args = n.args.map((a) => rec(a, bind));
        const slot = `__d${uid++}`;
        const inner = new Map(bind);
        fn.params.forEach((p, i) => inner.set(p, i === 0 ? { f: (e) => e[slot]!, n: null } : args[i]!));
        stack.push(n.name);
        if (stack.filter((s) => s === n.name).length > 1) throw new ExprError(`${n.name} refers to itself`);
        const body = rec(fn.body, inner);
        stack.pop();
        const x0 = args[0]!;
        const g = (e: Env, x: number) => {
          const save = e[slot];
          e[slot] = x;
          const v = body.f(e);
          e[slot] = save!;
          return v;
        };
        return { f: derivative(g, x0.f, n.order), n: joinLen(x0.n, body.n) };
      }
      case 'ddx': {
        const body = rec(n.a, bind);
        const v = n.v === 'θ' ? 'theta' : n.v;
        const g = (e: Env, x: number) => {
          const save = e[v];
          e[v] = x;
          const r = body.f(e);
          e[v] = save!;
          return r;
        };
        return { f: derivative(g, (e) => e[v] ?? NaN, 1), n: body.n };
      }
      case 'big': {
        const lo = rec(n.lo, bind);
        const hi = rec(n.hi, bind);
        const slot = `__b${uid++}`;
        const inner = new Map(bind);
        inner.set(n.v, { f: (e) => e[slot]!, n: null });
        const body = rec(n.a, inner);
        const isSum = n.op === 'sum';
        return {
          f: (e) => {
            const a = Math.round(lo.f(e));
            const b = Math.round(hi.f(e));
            if (!Number.isFinite(a) || !Number.isFinite(b) || b - a > 100000) return NaN;
            const save = e[slot];
            let s = isSum ? 0 : 1;
            for (let i = a; i <= b; i++) {
              e[slot] = i;
              const v = body.f(e);
              s = isSum ? s + v : s * v;
            }
            e[slot] = save!;
            return s;
          },
          n: joinLen(joinLen(lo.n, hi.n), body.n),
        };
      }
      case 'int': {
        const lo = rec(n.lo, bind);
        const hi = rec(n.hi, bind);
        const slot = `__i${uid++}`;
        const inner = new Map(bind);
        inner.set(n.v === 'θ' ? 'theta' : n.v, { f: (e) => e[slot]!, n: null });
        const body = rec(n.a, inner);
        return {
          f: (e) => {
            const save = e[slot];
            const v = simpson((t) => {
              e[slot] = t;
              return body.f(e);
            }, lo.f(e), hi.f(e));
            e[slot] = save!;
            return v;
          },
          n: joinLen(joinLen(lo.n, hi.n), body.n),
        };
      }
    }
    throw new ExprError('Can’t read that');
  };

  const nameRef = (name: string, bind: ReadonlyMap<string, C>): C => {
    const b = bind.get(name);
    if (b) return b;
    if (scope.polarXY && (name === 'r' || name === 'theta') && !scope.defs?.has(name)) {
      return name === 'r' ? { f: (e) => Math.hypot(e.x ?? NaN, e.y ?? NaN), n: null } : { f: (e) => Math.atan2(e.y ?? NaN, e.x ?? NaN), n: null };
    }
    if (scope.free.has(name)) return { f: (e) => e[name] ?? NaN, n: null };
    const list = scope.lists?.get(name);
    if (list !== undefined) {
      if (Array.isArray(list)) {
        const xs = list;
        return { f: (e) => xs[(e[K] ?? 0) | 0] ?? NaN, n: xs.length };
      }
      return guarded(name, () => rec(list as Expr, new Map()));
    }
    const def = scope.defs?.get(name);
    if (def) return guarded(name, () => rec(def, new Map()));
    if (name in CONST) {
      const v = CONST[name]!;
      return { f: () => v, n: null };
    }
    const c = scope.consts?.get(name);
    if (c !== undefined) return { f: () => c, n: null };
    if (FUNCS.has(name)) throw new ExprError(`${name} needs an input, e.g. ${name}(x)`);
    scope.missing?.add(name);
    return { f: (e) => e[name] ?? NaN, n: null };
  };

  const guarded = (name: string, build: () => C): C => {
    if (stack.includes(name)) throw new ExprError(`${name} is defined in terms of itself`);
    stack.push(name);
    try {
      return build();
    } finally {
      stack.pop();
    }
  };

  const call = (n: Extract<Expr, { t: 'call' }>, bind: ReadonlyMap<string, C>): C => {
    const name = n.name;
    const user = scope.fns?.get(name);
    let out: C;
    if (user && !bind.has(name)) {
      if (n.args.length !== user.params.length) throw new ExprError(`${name} takes ${user.params.length} input${user.params.length > 1 ? 's' : ''}`);
      const args = n.args.map((a) => rec(a, bind));
      const inner = new Map<string, C>();
      user.params.forEach((p, i) => inner.set(p, args[i]!));
      out = guarded(name, () => rec(user.body, inner));
      let len = out.n;
      for (const a of args) len = joinLen(len, a.n);
      out = { f: out.f, n: len };
    } else if (AGG.has(name) && (n.args.length !== 1 || true) && (name !== 'min' && name !== 'max' ? true : n.args.length === 1)) {
      // A list aggregate: mean(L), total(L), or mean(1, 2, 3).
      const list = n.args.length === 1 ? rec(n.args[0]!, bind) : rec({ t: 'list', items: n.args }, bind);
      if (list.n === null) {
        const a = list.f;
        out = name === 'length' || name === 'count' ? { f: () => 1, n: null } : { f: (e) => (name === 'var' || name === 'stdev' ? NaN : a(e)), n: null };
      } else {
        const N = list.n;
        const lf = list.f;
        out = {
          f: (e) => {
            const save = e[K];
            const xs: number[] = [];
            for (let k = 0; k < N; k++) {
              e[K] = k;
              xs.push(lf(e));
            }
            e[K] = save!;
            return aggregate(name, xs);
          },
          n: null,
        };
      }
    } else {
      const fn = builtin(name, angle) ?? scope.extFns?.(name) ?? null;
      if (!fn) {
        // Not a function: "a(x + 1)" is a·(x + 1).
        if (/^[a-zA-Z](_\w+)?$/.test(name) && n.args.length === 1) {
          const a = nameRef(name, bind);
          const b = rec(n.args[0]!, bind);
          return { f: (e) => a.f(e) * b.f(e), n: joinLen(a.n, b.n) };
        }
        throw new ExprError(`Unknown function “${name}”`);
      }
      const args = n.args.map((a) => rec(a, bind));
      let len: number | null = null;
      for (const a of args) len = joinLen(len, a.n);
      const fs = args.map((a) => a.f);
      if (fs.length === 1) {
        const a = fs[0]!;
        out = { f: (e) => fn(a(e)), n: len };
      } else if (fs.length === 2) {
        const [a, b] = fs as [Fn, Fn];
        out = { f: (e) => fn(a(e), b(e)), n: len };
      } else out = { f: (e) => fn(...fs.map((g) => g(e))), n: len };
    }
    if (n.power) {
      const p = rec(n.power, bind);
      const base = out.f;
      return { f: (e) => base(e) ** p.f(e), n: joinLen(out.n, p.n) };
    }
    return out;
  };

  return rec(node, new Map());
}

let uid = 0;

function joinLen(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/** Numeric derivative of g(e, ·) at x(e): central differences, step scaled to |x|. */
function derivative(g: (e: Env, x: number) => number, x: Fn, order: number): Fn {
  if (order <= 1) {
    return (e) => {
      const x0 = x(e);
      const h = 1e-5 * Math.max(1, Math.abs(x0));
      return (g(e, x0 + h) - g(e, x0 - h)) / (2 * h);
    };
  }
  if (order === 2) {
    return (e) => {
      const x0 = x(e);
      const h = 1e-3 * Math.max(1, Math.abs(x0));
      return (g(e, x0 + h) - 2 * g(e, x0) + g(e, x0 - h)) / (h * h);
    };
  }
  // Higher orders: differentiate the (order − 1)th derivative.
  const lower = (e: Env, at: number) => {
    const save = e.__dd;
    e.__dd = at;
    const v = derivative(g, (en) => en.__dd!, order - 1)(e);
    e.__dd = save!;
    return v;
  };
  return (e) => {
    const x0 = x(e);
    const h = 1e-2 * Math.max(1, Math.abs(x0));
    return (lower(e, x0 + h) - lower(e, x0 - h)) / (2 * h);
  };
}

/** Evaluates a compiled list (or scalar) to an array of values. */
export function values(c: C, env: Env = {}): number[] {
  if (c.n === null) return [c.f({ ...env })];
  const e = { ...env };
  const out: number[] = [];
  for (let k = 0; k < c.n; k++) {
    e[K] = k;
    out.push(c.f(e));
  }
  return out;
}

/** The same function with the family index fixed to k. */
export function at(f: Fn, k: number): Fn {
  return (e) => {
    const save = e[K];
    e[K] = k;
    const v = f(e);
    e[K] = save!;
    return v;
  };
}
