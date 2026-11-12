import type { BinaryOp, Node } from './ast';
import { MathError } from './errors';
import type { Op, Token } from './lexer';
import { isFunctionName } from './builtins';

export interface ParseOptions {
  /** Treat implicit multiplication as binding tighter than ÷, so 6/2(3) = 6/(2·3). */
  implicitBindsTighter?: boolean;
  /** Treat a leading minus as part of the base, so −2^2 = (−2)^2. */
  negationBindsTighter?: boolean;
  /** Names of user-defined formulas, parsed as calls. */
  userFunctions?: ReadonlySet<string>;
}

/** Notations whose meaning varies between calculators. The caller re-parses with the opposite option to offer an alternative. */
export interface ParseFlags {
  implicitAfterDivision: boolean;
  negatedPower: boolean;
  autoClosedParens: number;
}

export interface ParseOutput {
  ast: Node;
  flags: ParseFlags;
}

const RESERVED_ASSIGN = new Set(['ans', 'base', 'pi', 'e', 'tau', 'phi']);

export function parse(tokens: Token[], opts: ParseOptions = {}): ParseOutput {
  if (tokens.length === 0) throw new MathError('empty', 'Nothing to calculate');
  const p = new Parser(tokens, opts);
  const ast = p.statement();
  return { ast, flags: p.flags };
}

class Parser {
  i = 0;
  flags: ParseFlags = { implicitAfterDivision: false, negatedPower: false, autoClosedParens: 0 };
  /** Depth of open |…| groups, so a "|" inside one is read as its closing bar rather than a new group. */
  private absDepth = 0;

  constructor(
    private readonly toks: Token[],
    private opts: ParseOptions,
  ) {}

  private peek(): Token | undefined {
    return this.toks[this.i];
  }

  private isOp(v: Op, tok = this.peek()): boolean {
    return tok?.t === 'op' && tok.v === v;
  }

  private eofError(): never {
    throw new MathError('incomplete', 'Expression is incomplete');
  }

  statement(): Node {
    const def = this.definition();
    if (def) return def;
    const a = this.toks[0];
    if (a?.t === 'id' && this.isOp('=', this.toks[1])) {
      if (RESERVED_ASSIGN.has(a.v) || isFunctionName(a.v)) throw new MathError('syntax', `"${a.v}" is a reserved name`, a.pos);
      this.i = 2;
      const value = this.expr();
      this.expectEnd();
      return { type: 'assign', name: a.v, value };
    }
    const node = this.expr();
    this.expectEnd();
    return node;
  }

  /** name ( p1 , p2 ) = body */
  private definition(): Node | null {
    const t = this.toks;
    if (t[0]?.t !== 'id' || !this.isOp('(', t[1])) return null;
    const params: string[] = [];
    let i = 2;
    for (;;) {
      const p = t[i];
      if (p?.t !== 'id') return null;
      params.push(p.v);
      i++;
      if (this.isOp(',', t[i])) {
        i++;
        continue;
      }
      if (!this.isOp(')', t[i]) || !this.isOp('=', t[i + 1])) return null;
      i += 2;
      break;
    }
    const name = t[0].v;
    if (RESERVED_ASSIGN.has(name) || isFunctionName(name)) throw new MathError('syntax', `"${name}" is a built-in name`, t[0].pos);
    this.i = i;
    if (!this.peek()) this.eofError();
    const fns = new Set(this.opts.userFunctions ?? []);
    fns.add(name); // allow recursion
    const saved = this.opts;
    this.opts = { ...saved, userFunctions: fns };
    const body = this.expr();
    this.expectEnd();
    return { type: 'define', name, params, body };
  }

  private expectEnd(): void {
    const tok = this.peek();
    if (!tok) return;
    if (this.isOp(')')) throw new MathError('syntax', 'Unmatched closing parenthesis', tok.pos);
    throw new MathError('syntax', `Unexpected "${tok.v}"`, tok.pos);
  }

  expr(): Node {
    let left = this.term();
    for (;;) {
      const tok = this.peek();
      if (tok?.t !== 'op' || (tok.v !== '+' && tok.v !== '-')) return left;
      this.i++;
      if (!this.peek()) this.eofError();
      left = { type: 'binary', op: tok.v, left, right: this.term() };
    }
  }

  private term(): Node {
    const operand = () => (this.opts.implicitBindsTighter ? this.implicitChain() : this.unary());
    let left = operand();
    let lastExplicit: string | null = null;
    for (;;) {
      const tok = this.peek();
      if (tok?.t === 'op' && (tok.v === '*' || tok.v === '/' || tok.v === 'mod' || tok.v === 'of' || tok.v === 'off')) {
        this.i++;
        if (!this.peek()) this.eofError();
        const right = operand();
        left =
          tok.v === 'of' || tok.v === 'off'
            ? { type: tok.v, left, right }
            : { type: 'binary', op: tok.v as BinaryOp, left, right };
        lastExplicit = tok.v;
        continue;
      }
      if (tok?.t === 'num' && this.toks[this.i - 1]?.t === 'num') {
        throw new MathError('syntax', `Missing operator between ${this.toks[this.i - 1]!.v} and ${tok.v}`, tok.pos);
      }
      if (!this.opts.implicitBindsTighter && this.startsOperand(tok)) {
        if (lastExplicit === '/') this.flags.implicitAfterDivision = true;
        left = { type: 'binary', op: '*', left, right: this.unary(), implicit: true };
        continue;
      }
      return left;
    }
  }

  private implicitChain(): Node {
    let left = this.unary();
    while (this.startsOperand(this.peek())) {
      const tok = this.peek()!;
      if (tok.t === 'num' && this.toks[this.i - 1]?.t === 'num') throw new MathError('syntax', `Missing operator between ${this.toks[this.i - 1]!.v} and ${tok.v}`, tok.pos);
      left = { type: 'binary', op: '*', left, right: this.unary(), implicit: true };
    }
    return left;
  }

  private startsOperand(tok: Token | undefined): boolean {
    if (!tok) return false;
    if (tok.t === 'num' || tok.t === 'id') return true;
    return tok.t === 'op' && (tok.v === '(' || (tok.v === '|' && this.absDepth === 0));
  }

  private unary(): Node {
    if (this.isOp('+')) {
      this.i++;
      return this.unary();
    }
    if (this.isOp('-')) {
      this.i++;
      if (!this.peek()) this.eofError();
      if (this.opts.negationBindsTighter) {
        const base: Node = { type: 'neg', arg: this.postfix() };
        return this.powerTail(base);
      }
      const arg = this.unary();
      if (arg.type === 'binary' && arg.op === '^' && !arg.implicit) this.flags.negatedPower = true;
      return { type: 'neg', arg };
    }
    return this.powerTail(this.postfix());
  }

  private powerTail(base: Node): Node {
    if (!this.isOp('^')) return base;
    this.i++;
    if (!this.peek()) this.eofError();
    // Right-associative, and the exponent may carry its own sign: 2^-1.
    return { type: 'binary', op: '^', left: base, right: this.unary() };
  }

  private postfix(): Node {
    let node = this.primary();
    for (;;) {
      // "5!!" written together is the double factorial (5·3·1); "(5!)!" is a factorial of a factorial.
      const after = this.toks[this.i + 1];
      if (this.isOp('!') && after?.t === 'op' && after.v === '!' && after.pos === this.peek()!.pos + 1) {
        node = { type: 'call', name: 'dfact', args: [node] };
        this.i++;
      } else if (this.isOp('!')) node = { type: 'factorial', arg: node };
      else if (this.isOp('%')) node = { type: 'percent', arg: node };
      else if (this.isOp('°')) node = { type: 'degree', arg: node };
      else return node;
      this.i++;
    }
  }

  private primary(): Node {
    const tok = this.peek();
    if (!tok) this.eofError();
    this.i++;
    if (tok.t === 'num') return { type: 'num', value: tok.v };
    if (tok.t === 'id') {
      if (!isFunctionName(tok.v) && !this.opts.userFunctions?.has(tok.v)) return { type: 'name', name: tok.v };
      if (this.isOp('(')) {
        this.i++;
        const args: Node[] = [];
        if (!this.isOp(')')) {
          this.argument(args);
          while (this.isOp(',')) {
            this.i++;
            this.argument(args);
          }
        }
        this.closeParen();
        return { type: 'call', name: tok.v, args };
      }
      if (!this.peek()) this.eofError();
      // Spoken style without parentheses: "sqrt 16", "sin 30". The argument is one power-level operand.
      return { type: 'call', name: tok.v, args: [this.unary()] };
    }
    if (tok.v === '(') {
      const inner = this.expr();
      this.closeParen();
      return inner;
    }
    if (tok.v === '|') {
      this.absDepth++;
      const inner = this.expr();
      this.absDepth--;
      if (!this.isOp('|')) {
        if (!this.peek()) this.eofError();
        throw new MathError('syntax', 'Missing closing "|"', this.peek()?.pos);
      }
      this.i++;
      return { type: 'call', name: 'abs', args: [inner] };
    }
    throw new MathError('syntax', `Unexpected "${tok.v}"`, tok.pos);
  }

  /** One call argument, or a list "[1, 2, 3]" whose items become arguments: mean([1, 2, 3]) = mean(1, 2, 3). */
  private argument(args: Node[]): void {
    if (!this.isOp('[')) {
      args.push(this.expr());
      return;
    }
    this.i++;
    if (!this.isOp(']')) {
      args.push(this.expr());
      while (this.isOp(',')) {
        this.i++;
        args.push(this.expr());
      }
    }
    if (this.isOp(']')) this.i++;
    else if (this.peek()) throw new MathError('syntax', 'Missing closing "]"', this.peek()?.pos);
    else this.flags.autoClosedParens++;
  }

  /** Missing ")" at the very end is closed automatically (common when speaking or typing quickly); the caller is told. */
  private closeParen(): void {
    if (this.isOp(')')) {
      this.i++;
      return;
    }
    if (!this.peek()) {
      this.flags.autoClosedParens++;
      return;
    }
    throw new MathError('syntax', 'Missing closing parenthesis', this.peek()?.pos);
  }
}
