import { calculate, freeNames, lex, MathError, normalize, parse, splitLetterProducts, type Node, type Session } from '@lemma/math-core';

/**
 * Turns natural-language symbolic questions into typed requests for the SymPy worker. Expressions are
 * parsed by Lemma's own parser and re-printed in SymPy syntax, so the worker never evaluates raw user text.
 */

export type SymOp =
  | 'diff'
  | 'idiff'
  | 'integrate'
  | 'integrate2'
  | 'limit'
  | 'solve'
  | 'identity'
  | 'simplify'
  | 'expand'
  | 'factor'
  | 'apart'
  | 'trigsimp'
  | 'expand_trig'
  | 'together'
  | 'rationalize'
  | 'complete_square'
  | 'polydiv'
  | 'pgcd'
  | 'plcm'
  | 'series'
  | 'binomial_series'
  | 'sum'
  | 'dsolve'
  | 'rsolve'
  | 'laplace'
  | 'ilaplace'
  | 'fourier'
  | 'ifourier'
  | 'matrix'
  | 'vector'
  | 'logic'
  | 'sequence'
  | 'extrema'
  | 'conic'
  | 'quadinfo'
  | 'coeff'
  | 'fninfo'
  | 'vcalc'
  | 'calcapp'
  | 'evaluate'
  /** Step-by-step solution for the request in `task` (see steps-python.ts). */
  | 'steps'
  /** One section of the full report (`what`) for an expression. */
  | 'report';

export interface SymRequest {
  op: SymOp;
  /** SymPy-syntax expressions (one, or several for systems). */
  exprs: string[];
  /** Relational operator per expression for solve: '=', '<', '>', '<=', '>=', '!='. */
  rels?: string[];
  vars?: string[];
  order?: number;
  lower?: string;
  upper?: string;
  point?: string;
  dir?: '+' | '-';
  matrixOp?: 'det' | 'inv' | 'eigenvals' | 'eigenvects' | 'rank' | 'nullspace' | 'rref' | 'transpose' | 'trace' | 'eval' | 'solve' | 'charpoly' | 'more';
  vectorOp?: 'dot' | 'cross' | 'magnitude' | 'unit' | 'angle' | 'projection' | 'add' | 'sub' | 'scale' | 'set';
  /** solve: restrict to an interval [lo, hi] (SymPy syntax); degrees: the interval and answers are in degrees. */
  interval?: [string, string];
  degrees?: boolean;
  /** solve/factor: 'real' or 'complex'. */
  domain?: 'real' | 'complex';
  /** complex numbers: the form to present. */
  form?: 'polar' | 'exp' | 'rect';
  /** polydiv: 'remainder' or 'synthetic'; sequences: 'nth' | 'term' | 'sum' | 'sum_inf' | 'next'; logic: 'simplify' | 'table'; extrema: what to find. */
  mode?: string;
  task?: string;
  what?: string;
  method?: string;
  n?: number;
  geometric?: boolean;
  scalar?: string;
  /** dsolve: [point, derivative order, value]; rsolve: [index, value]. */
  ics?: [string, number, string][] | [string, string][];
  limits?: [string, string, string][];
  /** Vector calculus: a point and a direction (SymPy expressions). */
  at?: string[];
  direction?: string[];
  /** Human restatement for the result header. */
  label: string;
}

const FN_MAP: Record<string, string> = {
  ln: 'log',
  abs: 'Abs',
  ceil: 'ceiling',
  fact: 'factorial',
  factorial: 'factorial',
  ncr: 'binomial',
  choose: 'binomial',
  comb: 'binomial',
  arcsin: 'asin',
  arccos: 'acos',
  arctan: 'atan',
  avg: 'mean',
  conj: 'conjugate',
  sign: 'sign',
};

/** Function names that only exist in symbolic requests (complex parts, special functions). */
const SYMBOLIC_FUNCTIONS = ['conj', 'conjugate', 're', 'im', 'arg', 'erf', 'erfc', 'gamma', 'beta', 'zeta', 'besselj', 'bessely', 'lambertw', 'acot', 'asec', 'acsc', 'acoth', 'sech', 'csch', 'coth', 'digamma', 'polygamma', 'loggamma'];
const SYM_FN_NAMES: Record<string, string> = { gamma: 'gamma', beta: 'beta', lambertw: 'LambertW', besselj: 'besselj', bessely: 'bessely' };

/** Prints an Lemma AST as SymPy source. User formulas are inlined; `ans` becomes its value. */
export function toSympy(n: Node, session: Session, params: Map<string, string> = new Map()): string {
  const p = (m: Node) => `(${toSympy(m, session, params)})`;
  switch (n.type) {
    case 'num': {
      // Exact rationals: 0.1 → Rational('0.1'), 1e-3 → Rational('1e-3').
      return /[.eE]/.test(n.value) ? `Rational('${n.value}')` : n.value;
    }
    case 'name': {
      const bound = params.get(n.name);
      if (bound) return bound;
      if (n.name === 'ans' || n.name === 'base') {
        const v = n.name === 'ans' ? session.ans : session.base;
        if (!v) throw new MathError('ambiguous-reference', 'There is no previous result to refer to yet');
        return `Rational('${v.toString()}')`;
      }
      const v = session.vars.get(n.name);
      if (v) return `Rational('${v.toString()}')`;
      if (n.name === 'pi') return 'pi';
      if (n.name === 'e') return 'E';
      if (n.name === 'i') return 'I';
      if (n.name === 'tau') return '(2*pi)';
      if (n.name === 'phi') return 'GoldenRatio';
      if (n.name === 'inf' || n.name === 'infinity') return 'oo';
      if (/^cap_[a-z]\d*$/.test(n.name)) return `Symbol('${n.name[4]!.toUpperCase()}${n.name.slice(5)}')`;
      if (!/^[a-z][a-z0-9_]*$/.test(n.name)) throw new MathError('syntax', `Unsupported name "${n.name}"`);
      return `Symbol('${n.name}')`;
    }
    case 'percent':
      return `${p(n.arg)}/100`;
    case 'degree':
      return `${p(n.arg)}*pi/180`;
    case 'factorial':
      return `factorial${p(n.arg)}`;
    case 'neg':
      return `-${p(n.arg)}`;
    case 'of':
      return `${p(n.left)}*${p(n.right)}`;
    case 'off':
      return `${p(n.right)}*(1-${p(n.left)})`;
    case 'binary': {
      if ((n.op === '+' || n.op === '-') && n.right.type === 'percent') return `${p(n.left)}*(1${n.op}${p(n.right)})`;
      const op = n.op === '^' ? '**' : n.op === 'mod' ? '%' : n.op;
      return `${p(n.left)}${op}${p(n.right)}`;
    }
    case 'call': {
      const user = session.fns.get(n.name);
      if (user) {
        const inner = new Map(params);
        user.params.forEach((name, i) => inner.set(name, `(${toSympy(n.args[i]!, session, params)})`));
        return `(${toSympy(user.body, session, inner)})`;
      }
      const args = n.args.map((a) => toSympy(a, session, params));
      const m = /^(root|logb)(\d+)$/.exec(n.name);
      if (m) return m[1] === 'root' ? `real_root(${args[0]}, ${m[2]})` : `log(${args[0]}, ${m[2]})`;
      if (n.name === 'log' && args.length === 1) return `log(${args[0]}, 10)`;
      if (n.name === 'log' && args.length === 2) return `log(${args[0]}, ${args[1]})`;
      if (n.name === 'cbrt') return `real_root(${args[0]}, 3)`;
      if (n.name === 'root') return `real_root(${args[0]}, ${args[1]})`;
      if (n.name === 'npr') return `ff(${args[0]}, ${args[1]})`;
      if (n.name === 'gcd' || n.name === 'lcm') return `${n.name}(${args.join(', ')})`;
      return `${FN_MAP[n.name] ?? SYM_FN_NAMES[n.name] ?? n.name}(${args.join(', ')})`;
    }
    case 'assign':
    case 'define':
      throw new MathError('syntax', 'Assignments are not expressions');
  }
}

/** Spoken relations to symbols: "x squared minus 4 equals 0" → "x squared minus 4 = 0". */
export function spokenRelations(s: string): string {
  return s
    .replace(/\s+(?:is\s+)?greater than or equal to\s+/gi, ' >= ')
    .replace(/\s+(?:is\s+)?less than or equal to\s+/gi, ' <= ')
    .replace(/\s+(?:is\s+)?(?:at least|no less than)\s+/gi, ' >= ')
    .replace(/\s+(?:is\s+)?(?:at most|no more than)\s+/gi, ' <= ')
    .replace(/\s+(?:is\s+)?(?:greater|more|bigger|larger) than\s+/gi, ' > ')
    .replace(/\s+(?:is\s+)?(?:less|smaller) than\s+/gi, ' < ')
    .replace(/\s+(?:is\s+)?not equal to\s+|\s+does not equal\s+/gi, ' != ')
    .replace(/\s+(?:is\s+equal\s+to|equals?(?:\s+to)?|is\s+equals?)\s+/gi, ' = ');
}

const WHOLE_WORDS = /^(?:theta|alpha|beta|gamma|delta|epsilon|lambda|sigma|omega|kappa|infinity|cap_[a-z]\d*|seq_[a-z0-9]+)$/;
const KNOWN_LOWER = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'log', 'ln', 'lg', 'exp', 'sqrt', 'cbrt', 'abs', 'pi', 'and', 'or', 'not', 'mod', 'of', 'for', 'to', 'from', 'with', 'respect', 'in', 'at', 'is', 'the', 'arcsin', 'arccos', 'arctan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'inf', 'infinity', 'e', 'i']);

/**
 * Keeps capital letters as their own symbols ("PV = nRT", "A = πr²", "solve for T"): each capital in a letter run
 * becomes the token cap_x, which toSympy prints back as Symbol('X'). Capitalised words ("Solve", "Sin") are left.
 */
export function preserveCase(t: string): string {
  return t.replace(/[A-Za-z]+\d*/g, (w) => {
    if (!/[A-Z]/.test(w)) return w;
    const lw = w.toLowerCase().replace(/\d+$/, '');
    if (KNOWN_LOWER.has(lw) && w !== 'E' && w !== 'I') return w;
    if (/^[A-Z][a-z]{2,}$/.test(w) || /^[A-Z]{3,}$/.test(w)) return w;
    return w.replace(/[A-Z](\d*)/g, (c) => ` cap_${c[0]!.toLowerCase()}${c.slice(1)} `);
  });
}

/** Parses one side of a math phrase to SymPy. "i" is the imaginary unit here. */
export function sym(text: string, session: Session): string {
  // "n!" with a letter: the calculator's normaliser treats a trailing "!" as punctuation, so make it explicit.
  const t = preserveCase(text.trim()).replace(/(^|[^a-zA-Z])([a-zA-Z])\s*!(?!=)/g, '$1fact($2)');
  if (/^\[\[[\d\s,.\-+/\][a-z*^()_]*\]\]$/i.test(t)) return matrix(t, session);
  const norm = normalize(t);
  const fns = new Set([...session.fns.keys(), ...SYMBOLIC_FUNCTIONS]);
  const { ast } = parse(lex(norm.text), { userFunctions: fns });
  // A leftover English word ("equals", "zero"…) must never become a symbol (or a product of letters) silently.
  for (const name of freeNames(ast, session.vars)) {
    if (name.length >= 4 && !WHOLE_WORDS.test(name) && !session.fns.has(name)) {
      throw new MathError('syntax', `I don't understand "${name}" here`);
    }
  }
  // "ax^2" is a·x² and "xy" is x·y: a multi-letter symbol would make d/dx(ax²) come out as 0.
  return toSympy(splitLetterProducts(ast, (n) => session.vars.has(n) || session.fns.has(n) || WHOLE_WORDS.test(n)), session);
}

/** "[[1,2],[3,4]]" → Matrix([[1, 2], [3, 4]]) with each entry parsed safely. */
function matrix(t: string, session: Session): string {
  const rows = t.trim().slice(2, -2).split(/\]\s*,\s*\[/);
  const body = rows.map((r) => `[${r.split(',').map((c) => sym(c, session)).join(', ')}]`).join(', ');
  return `Matrix([${body}])`;
}

/** "[5,10]" / "(1,2,3)" / "<1,2,2>" → Matrix([5, 10]) */
function vectorSrc(t: string, session: Session): string {
  const inner = t.trim().replace(/^[[(<⟨]\s*|\s*[\])>⟩]$/g, '');
  return `Matrix([${splitCommas(inner).map((c) => sym(c, session)).join(', ')}])`;
}

function splitCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of s) {
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

const REL_OPS = ['<=', '>=', '==', '!=', '≤', '≥', '≠', '=', '<', '>'] as const;
const REL_NORM: Record<string, string> = { '<=': '<=', '>=': '>=', '==': '=', '!=': '!=', '≤': '<=', '≥': '>=', '≠': '!=', '=': '=', '<': '<', '>': '>' };

/** Splits at every top-level relational operator: "-3 < 2x+1 < 7" → parts [-3, 2x+1, 7], ops [<, <]. */
function relationChain(s: string): { parts: string[]; ops: string[] } | null {
  let depth = 0;
  const parts: string[] = [];
  const ops: string[] = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    if (depth) continue;
    const op = REL_OPS.find((o) => s.startsWith(o, i));
    if (!op) continue;
    parts.push(s.slice(start, i));
    ops.push(REL_NORM[op]!);
    i += op.length - 1;
    start = i + 1;
  }
  if (!ops.length) return null;
  parts.push(s.slice(start));
  if (parts.some((p) => !p.trim())) return null;
  return { parts, ops };
}

/** Splits at the first top-level relational operator. */
function relation(s: string): { lhs: string; rel: string; rhs: string } | null {
  const c = relationChain(s);
  if (!c) return null;
  return { lhs: c.parts[0]!, rel: c.ops[0]!, rhs: c.parts.slice(1).join(c.ops[1] ?? '') };
}

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '(' || c === '[' || c === '{') depth++;
    if (c === ')' || c === ']' || c === '}') depth--;
    if (depth === 0 && (c === ',' || c === ';' || s.startsWith(' and ', i))) {
      out.push(cur);
      cur = '';
      if (s.startsWith(' and ', i)) i += 4;
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

const LIMIT_POINT = (p: string, session: Session) => {
  const t = p.trim().toLowerCase();
  if (/^(?:\+?\s*)?(?:inf|infinity|∞|oo)$/.test(t)) return 'oo';
  if (/^-\s*(?:inf|infinity|∞|oo)$/.test(t)) return '-oo';
  return sym(p.trim(), session);
};

const ORDINAL: Record<string, number> = { second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, fifth: 5, '5th': 5, sixth: 6, '6th': 6 };
const varName = (v: string) => (/^[A-Z]$/.test(v.trim()) ? v.trim() : v.trim().toLowerCase());

/** Builds SymPy "lhs - rhs" pairs for every relation in an equation chain. */
function relExprs(eq: string, session: Session): { exprs: string[]; rels: string[] } {
  const c = relationChain(eq);
  if (!c) return { exprs: [sym(eq, session)], rels: ['='] };
  const exprs: string[] = [];
  const rels: string[] = [];
  const sides = c.parts.map((p) => sym(p, session));
  for (let i = 0; i < c.ops.length; i++) {
    exprs.push(`(${sides[i]}) - (${sides[i + 1]})`);
    rels.push(c.ops[i]!);
  }
  return { exprs, rels };
}

const symbolsIn = (srcs: string[]) => new Set(srcs.flatMap((s) => [...s.matchAll(/Symbol\('([^']+)'\)/g)].map((m) => m[1]!)));

/** Domain/interval words after an equation: "for 0 <= x <= 2pi", "in [0, 2π]", "between 0 and 360 degrees", "over C". */
function extractDomain(s: string, session: Session): { rest: string; interval?: [string, string]; degrees?: boolean; domain?: 'real' | 'complex' } {
  let rest = s;
  let domain: 'real' | 'complex' | undefined;
  const d = /\s*(?:,\s*)?\b(?:over|in|on)\s+(?:the\s+)?(complex(?: numbers)?|reals?|real numbers|ℂ|ℝ|c|r)\s*$/i.exec(rest);
  if (d) {
    domain = /^(?:complex|ℂ|c)/i.test(d[1]!) ? 'complex' : 'real';
    rest = rest.slice(0, d.index);
  }
  let interval: [string, string] | undefined;
  let degrees = false;
  const deg = (t: string) => /°|degrees?|deg\b/i.test(t);
  const clean = (t: string) => t.replace(/\s*(?:°|degrees?|deg)\s*$/i, '').trim();
  let m = /\s*(?:,\s*)?\b(?:for|where|with|on|in)\s+(-?[^<≤]+?)\s*(<=|≤|<)\s*[a-zθ]+\s*(<=|≤|<)\s*(.+)$/i.exec(rest);
  if (m) {
    interval = [sym(clean(m[1]!), session), sym(clean(m[4]!), session)];
    degrees = deg(m[1]!) || deg(m[4]!);
    rest = rest.slice(0, m.index);
  } else if ((m = /\s*(?:,\s*)?\b(?:for\s+[a-zθ]\s+)?(?:in|on|over)\s+(?:the\s+interval\s+)?[[(\]]\s*([^,;]+?)\s*[,;]\s*([^\])[]+?)\s*[\])[]\s*$/i.exec(rest))) {
    interval = [sym(clean(m[1]!), session), sym(clean(m[2]!), session)];
    degrees = deg(m[1]!) || deg(m[2]!);
    rest = rest.slice(0, m.index);
  } else if ((m = /\s*(?:,\s*)?\b(?:between|from)\s+(-?[\dπ.\w/]+°?)\s+(?:and|to)\s+(-?[\dπ.\w/]+°?)(\s*(?:°|degrees?))?\s*$/i.exec(rest))) {
    interval = [sym(clean(m[1]!), session), sym(clean(m[2]!), session)];
    degrees = deg(m[0]);
    rest = rest.slice(0, m.index);
  }
  return { rest: rest.trim(), interval, degrees: degrees || undefined, domain };
}

/** Assembles a solve request from equation text (one equation, a chain, or a list) and optional variables. */
function solveRequest(text: string, vars: string[] | undefined, session: Session, label: string): SymRequest {
  const dom = extractDomain(text, session);
  const eqs = splitTop(dom.rest);
  const exprs: string[] = [];
  const rels: string[] = [];
  for (const eq of eqs) {
    const r = relExprs(eq, session);
    exprs.push(...r.exprs);
    rels.push(...r.rels);
  }
  const req: SymRequest = { op: 'solve', exprs, rels, vars, label };
  if (dom.interval) req.interval = dom.interval;
  if (dom.degrees) req.degrees = true;
  if (dom.domain) req.domain = dom.domain;
  if (!vars && symbolsIn(exprs).has('z') && !symbolsIn(exprs).has('x')) req.domain ??= 'complex';
  return req;
}

/** "y(0) = 3", "y'(0) = 1" → [point, order, value]. */
function initialCondition(t: string, session: Session): [string, number, string] | null {
  const m = /^\s*y('*)\s*\(\s*([^)]+)\)\s*=\s*(.+)$/.exec(t);
  if (!m) return null;
  return [sym(m[2]!, session), m[1]!.length, sym(m[3]!, session)];
}

/** Word problems: "what number squared minus 5 is 20" → "x squared minus 5 = 20". */
function wordProblem(s: string): string | null {
  if (!/\bnumbers?\b/i.test(s)) return null;
  let t = s.toLowerCase();
  let m = /^(?:if )?the sum of two numbers is (.+?)(?:,| and) (?:their|the) difference is (.+)$/.exec(t);
  if (m) return `x + y = ${m[1]}, x - y = ${m[2]}`;
  m = /^(?:if )?the sum of two numbers is (.+?)(?:,| and) (?:their|the) product is (.+)$/.exec(t);
  if (m) return `x + y = ${m[1]}, x*y = ${m[2]}`;
  m = /^(?:if )?two numbers add (?:up )?to (.+?)(?:,| and) differ by (.+)$/.exec(t);
  if (m) return `x + y = ${m[1]}, x - y = ${m[2]}`;
  t = t
    .replace(/^(?:find |what is |which is )?(?:the )?/, '')
    .replace(/\b(?:what|which|a|the|some|an unknown|this) number\b|\bnumber\b/g, 'x')
    .replace(/\bits square\b/g, 'x^2')
    .replace(/\bthe square of (x)\b/g, '$1^2')
    .replace(/\bthe cube of (x)\b/g, '$1^3')
    .replace(/\bthe square root of (x)\b/g, 'sqrt($1)')
    .replace(/\b(\d+(?:\.\d+)?|twice|double|three times|half) (?:of )?x\b/g, (_m, k: string) => `${k === 'twice' || k === 'double' ? 2 : k === 'three times' ? 3 : k === 'half' ? '0.5' : k}*x`)
    .replace(/\b(?:the )?sum of (.+?) and (.+?)(?= is\b| equals\b|$)/g, '($1) + ($2)')
    .replace(/\b(?:the )?product of (.+?) and (.+?)(?= is\b| equals\b|$)/g, '($1) * ($2)')
    .replace(/\b(?:the )?difference (?:of|between) (.+?) and (.+?)(?= is\b| equals\b|$)/g, '($1) - ($2)')
    .replace(/\b(?:the )?quotient of (.+?) and (.+?)(?= is\b| equals\b|$)/g, '($1) / ($2)')
    .replace(/\b(\d+(?:\.\d+)?) (?:more than|added to) (x[^ ]*)/g, '$2 + $1')
    .replace(/\b(\d+(?:\.\d+)?) less than (x[^ ]*)/g, '$2 - $1')
    .replace(/\bincreased by\b|\badded to\b/g, '+')
    .replace(/\bdecreased by\b|\breduced by\b/g, '-')
    .replace(/\bdivided by\b/g, '/')
    .replace(/\bmultiplied by\b/g, '*')
    .replace(/\s+(?:is|gives|makes|results in|equals)\s+(?:the same as\s+)?/g, ' = ');
  if (!/=/.test(t) || /[a-wyz]{3,}/.test(t.replace(/\b(?:plus|minus|times|squared|cubed|sqrt|over)\b/g, ''))) return null;
  return t;
}

/** Boolean expressions: "A and (A or B)", "not (p and q)", "p implies q" → SymPy And/Or/Not/Implies. */
function logicSrc(text: string): string | null {
  const toks = text
    .replace(/∧|&&?/g, ' and ')
    .replace(/∨|\|\|?/g, ' or ')
    .replace(/¬|~|!/g, ' not ')
    .replace(/⊕/g, ' xor ')
    .replace(/<->|<=>|↔|⇔|\biff\b|\bif and only if\b/g, ' iff ')
    .replace(/->|=>|→|⇒/g, ' implies ')
    .replace(/([()])/g, ' $1 ')
    .trim()
    .split(/\s+/);
  let i = 0;
  const peek = () => toks[i]?.toLowerCase();
  const atom = (): string => {
    const t = toks[i++];
    if (!t) throw new Error('end');
    const l = t.toLowerCase();
    if (l === '(') {
      const e = iff();
      if (toks[i++] !== ')') throw new Error('paren');
      return e;
    }
    if (l === 'not') return `Not(${atom()})`;
    if (l === 'true' || l === 'false') return l === 'true' ? 'true' : 'false';
    if (!/^[a-z]\w{0,2}$/i.test(t)) throw new Error('word');
    return `Symbol('${t}')`;
  };
  const bin = (next: () => string, word: string, fn: string) => () => {
    let l = next();
    while (peek() === word) {
      i++;
      l = `${fn}(${l}, ${next()})`;
    }
    return l;
  };
  const and = bin(atom, 'and', 'And');
  const xor = bin(and, 'xor', 'Xor');
  const or = bin(xor, 'or', 'Or');
  const implies = (): string => {
    const l = or();
    if (peek() === 'implies') {
      i++;
      return `Implies(${l}, ${implies()})`;
    }
    return l;
  };
  const iff = bin(implies, 'iff', 'Equivalent');
  try {
    const out = iff();
    return i === toks.length ? out : null;
  } catch {
    return null;
  }
}

/** Recognises symbolic questions. Returns null for anything else (the calculator keeps those). */
export function parseSymbolic(input: string, session: Session): SymRequest | null {
  let s = input
    .trim()
    .replace(/[?!]+$/, '')
    .replace(/([^\d.])\.$/, '$1')
    .replace(/[’′]/g, "'")
    .replace(/″/g, "''")
    .replace(/:=|←/g, '=')
    .replace(/\s+/g, ' ')
    .replace(/^(?:(?:what(?:'s| is| are)|find|compute|calculate|evaluate|determine|work out|give me|show me|tell me|please|can you|could you|use|using|now)\s+)+(?:the\s+)?/i, '');
  // Word problems become equations (read before "more than" turns into ">").
  const wp = wordProblem(s);
  if (wp) return solveRequest(wp, undefined, session, `Solve ${wp}`);
  s = s.replace(/^(.+?) (?:and|then) simplify$/i, 'simplify $1').replace(/^(expand|factori[sz]e|factor|simplify) (?:and simplify |fully |completely )/i, '$1 ');
  s = s.replace(/^(?:solve )?for ([a-zA-Z](?:\s*(?:,|and)\s*[a-zA-Z])*)\s*:\s*(.+)$/i, 'solve $2 for $1');
  s = spokenRelations(s);
  const lower = s.toLowerCase();

  // Boolean logic
  let m = /^(?:simplify|reduce|minimi[sz]e)\s+(?:the\s+)?(?:boolean\s+|logical\s+)?(?:expression\s+)?(.+)$/i.exec(s);
  if (m && /\b(?:and|or|not|xor|implies|iff)\b|[∧∨¬⊕→↔]/i.test(m[1]!) && !/[=<>+\-*/^]/.test(m[1]!.replace(/->|=>|<->|<=>/g, ''))) {
    const src = logicSrc(m[1]!);
    if (src) return { op: 'logic', exprs: [src], task: 'simplify', label: `Simplify ${m[1]}` };
  }
  m = /^(?:make |draw |show )?(?:a |the )?truth table (?:of|for) (.+)$/i.exec(s);
  if (m) {
    const src = logicSrc(m[1]!);
    if (src) return { op: 'logic', exprs: [src], task: 'table', label: `Truth table of ${m[1]}` };
  }
  m = /^is (.+?) (?:a )?(tautology|contradiction|always true|always false)$/i.exec(s);
  if (m) {
    const src = logicSrc(m[1]!);
    if (src) return { op: 'logic', exprs: [src], task: 'simplify', label: `Is ${m[1]} a ${m[2]}?` };
  }


  // Recurrences: a(n) = a(n-1) + 2, a(1) = 1
  if (/\ba(?:\(n\)|_n|_\{n\}|n)\s*=/.test(s) && /a(?:\(n\s*-\s*\d\)|_\{?n-\d\}?)/.test(s)) return recurrence(s, session);

  // Implicit differentiation: "dy/dx of x^2 + y^2 = 25", "implicit derivative of …", "find dy/dx if …"
  m = /^(?:find |the )?(?:implicit(?:ly)? (?:derivative|differentiat\w*|differentiation)(?: of)?|differentiate implicitly|dy\/dx (?:of|if|for|given|when|where)|dy\/dx implicitly(?: of| for)?)\s*:?\s*(.+=.+)$/i.exec(s);
  if (m && !/y'/.test(m[1]!)) {
    const r = relation(m[1]!)!;
    return { op: 'idiff', exprs: [`(${sym(r.lhs, session)}) - (${sym(r.rhs, session)})`], vars: ['y', 'x'], label: `dy/dx for ${m[1]}` };
  }

  // ODEs: y', y'', dy/dx (with optional initial conditions after commas)
  if (/^(?:solve |dsolve |the ode |solve the ode )?.*(?:(?:^|[^a-z])y'+|dy\/dx|d2y\/dx2|d\^2y\/dx\^2)/i.test(lower) && /=/.test(lower)) {
    const body = s.replace(/^(?:solve (?:the ode )?|dsolve |the ode )/i, '');
    const parts = splitTop(body);
    const ode = parts.find((p) => /y'|dy\/dx|d2y|d\^2y/.test(p) && !/^\s*y'*\s*\(/.test(p)) ?? parts[0]!;
    const ics = parts.filter((p) => p !== ode).map((p) => initialCondition(p, session));
    if (ics.some((x) => x === null)) return null;
    return { op: 'dsolve', exprs: [odeToSympy(ode)], ics: ics as [string, number, string][], label: `Solve the ODE ${body}` };
  }

  m = /^(.+?)\s+(?:derivative|differentiated)$/i.exec(s);
  if (m && !/\b(?:derivative|of)\b/i.test(m[1]!)) s = `derivative of ${m[1]}`;
  m = /^(?:the )?(slope|gradient|equation) of (?:the )?(tangent|normal)(?: line)? (?:to|of|at)(?: the curve)? (?:y ?= ?|f\(x\) ?= ?)?(.+?) (?:at|where|when) (?:x ?= ?|the point )?(.+)$/i.exec(s);
  if (m) {
    const pt = m[4]!.replace(/^\(\s*([^,]+?)\s*,.*\)$/, '$1');
    return { op: 'diff', exprs: [sym(m[3]!, session)], vars: [guessVar(m[3]!)], order: 1, point: sym(pt, session), mode: m[1]!.toLowerCase() === 'equation' ? m[2]!.toLowerCase() : m[2]!.toLowerCase() === 'normal' ? 'normal_slope' : undefined, label: `${m[1]} of the ${m[2]} to ${m[3]} at x = ${pt}` };
  }

  // Derivatives: partial, higher order, at a point
  m =
    /^(?:the )?(?:(second|third|fourth|fifth|sixth|2nd|3rd|4th|5th|6th) )?(?:(partial) )?(?:derivative|differentiate|d\/d([a-z])|∂\/∂([a-z]))(?: of)? (.+?)(?: (?:with respect to|wrt|w\.r\.t\.?|by|in) ([a-zA-Z])(?:(?: and | then |, ?)([a-zA-Z]))?)?(?: (?:at|when|where) ([a-z]) ?= ?(.+))?$/i.exec(s);
  if (m) {
    const body = m[5]!.replace(/^f\s*\(\s*[a-z]\s*\)\s*=\s*/i, '');
    const v = varName(m[6] ?? m[3] ?? m[4] ?? m[8] ?? guessVar(body));
    const order = m[1] ? ORDINAL[m[1].toLowerCase()]! : 1;
    const vars = m[7] ? [v, varName(m[7])] : [v];
    const req: SymRequest = { op: 'diff', exprs: [sym(body, session)], vars, order, label: `${order > 1 ? `d${sup(order)}/d${v}${sup(order)}` : m[2] || m[4] ? `∂/∂${vars.join('∂')}` : `d/d${v}`} ${body}` };
    if (m[9]) req.point = sym(m[9], session);
    return req;
  }

  // Double integrals
  m = /^(?:the )?double integral (?:of )?(.+?) (?:from|over) (.+)$/i.exec(s);
  if (m) {
    const body = m[1]!.replace(/\s*d[a-z]\s*d[a-z]\s*$/i, '');
    const lim = m[2]!;
    const both = /^(-?[\w.π/]+) to (-?[\w.π/]+)$/i.exec(lim.replace(/^\[(.+),(.+)\]$/, '$1 to $2'));
    const each = [...lim.matchAll(/([a-z])\s*(?:from|=)\s*(-?[\w.π/]+)\s*(?:to|\.\.)\s*(-?[\w.π/]+)/gi)];
    let limits: [string, string, string][];
    if (each.length === 2) limits = each.map((x) => [varName(x[1]!), LIMIT_POINT(x[2]!, session), LIMIT_POINT(x[3]!, session)] as [string, string, string]);
    else if (both) {
      const vs = [...symbolsIn([sym(body, session)])].sort();
      const pair = vs.length >= 2 ? vs.slice(0, 2) : ['x', 'y'];
      limits = pair.map((v) => [v, LIMIT_POINT(both[1]!, session), LIMIT_POINT(both[2]!, session)] as [string, string, string]);
    } else return null;
    return { op: 'integrate2', exprs: [sym(body, session)], limits, label: `∬ ${body}` };
  }

  m = /^(?:the )?(?:definite |indefinite )?(?:integral|integrate|antiderivative|∫)(?: of)? (.+)$/i.exec(s);
  if (m) {
    let body = m[1]!.replace(/\s+(?:by parts|using (?:integration by )?parts|by substitution|using (?:u-)?substitution|using partial fractions|by partial fractions)\b/i, '');
    let lowerB: string | undefined;
    let upperB: string | undefined;
    const b = /\s+(?:from|between)\s+(.+?)\s+(?:to|and)\s+(.+)$/i.exec(body);
    if (b) {
      lowerB = LIMIT_POINT(b[1]!.replace(/^[a-z]\s*=\s*/i, ''), session);
      upperB = LIMIT_POINT(b[2]!.replace(/\s+d[a-z]$/i, ''), session);
      body = body.slice(0, b.index);
    }
    let v: string | undefined;
    const dv = /\s*(?:d([a-z])|(?:with respect to|wrt) ([a-z]))\s*$/i.exec(body);
    if (dv) {
      v = (dv[1] ?? dv[2])!.toLowerCase();
      body = body.slice(0, dv.index);
    }
    v ??= guessVar(body);
    return {
      op: 'integrate',
      exprs: [sym(body, session)],
      vars: [v],
      lower: lowerB,
      upper: upperB,
      label: lowerB ? `∫ ${body} d${v} from ${b![1]} to ${b![2]}` : `∫ ${body} d${v}`,
    };
  }

  m = /^(?:the )?(?:limit|lim)(?: of)? (.+?) as ([a-z]) ?(?:->|→|approaches|goes to|tends to|to) ?(.+?)(?: from (?:the )?(left|right|below|above))?$/i.exec(s) ?? null;
  if (!m) {
    const alt = /^lim(?:it)? ([a-z]) ?(?:->|→) ?(\S+?)(\+|-|⁺|⁻)? (.+)$/i.exec(s);
    if (alt) m = Object.assign([alt[0], alt[4], alt[1], alt[2], alt[3] === '-' || alt[3] === '⁻' ? 'left' : alt[3] ? 'right' : undefined], { index: 0, input: s }) as unknown as RegExpExecArray;
  }
  if (m) {
    let point = m[3]!;
    let dir = m[4] ? (/left|below/i.test(m[4]) ? '-' : '+') : undefined;
    const sign = /^(.+?)(\+|-|⁺|⁻)$/.exec(point);
    if (!dir && sign && !/^[+-]?\s*(?:inf|infinity|∞)$/i.test(point)) {
      point = sign[1]!;
      dir = sign[2] === '-' || sign[2] === '⁻' ? '-' : '+';
    }
    return { op: 'limit', exprs: [sym(m[1]!, session)], vars: [m[2]!.toLowerCase()], point: LIMIT_POINT(point, session), dir: dir as '+' | '-' | undefined, label: `lim ${m[2]}→${point}${dir ?? ''} ${m[1]}` };
  }

  // Binomial expansion as a series: "binomial expansion of (1+x)^(-1/2) up to x^3"
  m = /^(?:the )?binomial (?:expansion|series)(?: of| for)? (.+?)(?: (?:up to|to|as far as|including)(?: the)? (?:[a-z]\^?(\d+)|(\w+) terms?)(?: term)?)?$/i.exec(s);
  if (m) {
    const v = guessVar(m[1]!);
    const isPos = /\^\s*\(?\s*\d+\s*\)?\s*$/.test(m[1]!);
    if (isPos && !m[2]) return { op: 'expand', exprs: [sym(m[1]!, session)], label: `Expand ${m[1]}` };
    return { op: 'binomial_series', exprs: [sym(m[1]!, session)], vars: [v], order: Number(m[2] ?? 3), label: `Binomial expansion of ${m[1]}` };
  }

  m = /^(?:the )?(taylor|maclaurin|power)? ?series(?: expansion)? (?:of|for) (.+?)(?: (?:at|about|around|near|centered at) (?:[a-z] ?= ?)?(.+?))?(?: (?:to|up to|of) (?:order|degree) (\d+)| to (\d+) terms| up to [a-z]\^(\d+))?$/i.exec(s);
  if (m) {
    const v = guessVar(m[2]!);
    const order = m[6] ? Number(m[6]) + 1 : Number(m[4] ?? m[5] ?? 6);
    const point = m[3] && m[1]?.toLowerCase() !== 'maclaurin' ? LIMIT_POINT(m[3], session) : '0';
    return { op: 'series', exprs: [sym(m[2]!, session)], vars: [v], point, order, label: `Series of ${m[2]} about ${v} = ${m[3] ?? 0}` };
  }

  // Sums: "sum of 1/n^2 from n=1 to infinity", "sum of k^2 for k = 1 to n", "Σ k from 1 to 100"
  m = /^(?:the )?(?:sum|summation|Σ|∑)(?: of)? (.+?) (?:from|for) (?:([a-z]) ?= ?)?(-?[\w.]+) (?:to|\.\.) (.+)$/i.exec(s);
  if (m && !/\bterms?\b/i.test(m[1]!) && !/,/.test(m[1]!)) {
    const v = (m[2] ?? guessVar(m[1]!, ['n', 'k', 'i', 'j', 'x'])).toLowerCase();
    const body = sym(m[1]!.replace(/\bi\b/g, v === 'i' ? 'i' : 'i'), session).replace(/\bI\b/g, v === 'i' ? "Symbol('i')" : 'I');
    return { op: 'sum', exprs: [body], vars: [v], lower: LIMIT_POINT(m[3]!, session), upper: LIMIT_POINT(m[4]!, session), label: `Σ ${m[1]} for ${v} = ${m[3]} to ${m[4]}` };
  }

  // "sum 1 + 2 + 3 + ... + 100", "1 + 3 + 5 + … + 99"
  m = /^(?:the )?(?:sum(?: of)? )?((?:-?[\d./]+\s*\+\s*){2,})(?:\.\.\.|…)\s*\+\s*(-?[\d./]+)$/i.exec(s);
  if (m) {
    const t = m[1]!.split('+').map((x) => x.trim()).filter(Boolean);
    return { op: 'sequence', exprs: t.map((x) => sym(x, session)), task: 'sum_to', scalar: sym(m[2]!, session), label: `${t.join(' + ')} + … + ${m[2]}` };
  }

  // Sequences
  const seq = sequenceRequest(s, session);
  if (seq) return seq;

  m = /^(inverse )?laplace(?: transform)?(?: of)? (.+)$/i.exec(s);
  if (m) return { op: m[1] ? 'ilaplace' : 'laplace', exprs: [sym(m[2]!, session)], label: `${m[1] ? 'Inverse Laplace' : 'Laplace'} transform of ${m[2]}` };
  m = /^(inverse )?fourier(?: transform)?(?: of)? (.+)$/i.exec(s);
  if (m) return { op: m[1] ? 'ifourier' : 'fourier', exprs: [sym(m[2]!, session)], label: `${m[1] ? 'Inverse Fourier' : 'Fourier'} transform of ${m[2]}` };

  // Matrices
  m = /^(det(?:erminant)?|inverse|inv|eigen ?values?|eigen ?vectors?|rank|null ?space|kernel|rref|reduced row echelon form|row reduce|transpose|trace|characteristic polynomial|char poly|lu decomposition|lu factori[sz]ation|qr decomposition|qr factori[sz]ation|svd|singular values?|singular value decomposition|diagonali[sz]e|diagonali[sz]ation|cholesky|jordan form|is .*? (?:positive definite|symmetric|orthogonal|invertible|singular|diagonali[sz]able)|norm|frobenius norm|adjugate|adjoint|cofactors?|minors?|exponential)(?: of)?(?: the matrix)? (\[\[.+\]\])(?: (?:positive definite|symmetric|orthogonal|invertible|singular|diagonali[sz]able))?$/i.exec(s.replace(/^is (\[\[.+\]\]) (positive definite|symmetric|orthogonal|invertible|singular|diagonali[sz]able)$/i, 'is $2 $1'));
  if (m) {
    const w = m[1]!.toLowerCase().replace(/\s/g, '');
    const extra: Record<string, SymRequest['matrixOp']> = {};
    void extra;
    const special = /^lu/.test(w) ? 'lu' : /^qr/.test(w) ? 'qr' : /^svd|singular/.test(w) ? 'svd' : /diagonali[sz]e$|diagonali[sz]ation/.test(w) ? 'diag' : /cholesky/.test(w) ? 'cholesky' : /jordan/.test(w) ? 'jordan' : /^is/.test(w) ? 'is:' + w.replace(/^is/, '') : /frobenius|^norm/.test(w) ? 'norm' : /adj/.test(w) ? 'adj' : /cofactor/.test(w) ? 'cofactor' : /minor/.test(w) ? 'minors' : /exponential/.test(w) ? 'exp' : null;
    if (special) return { op: 'matrix', matrixOp: 'more', mode: special, exprs: [matrix(m[2]!, session)], label: `${m[1]} ${m[2]}` };
    const op = /^det/.test(w) ? 'det' : /^inv/.test(w) ? 'inv' : /eigenval/.test(w) ? 'eigenvals' : /eigenvec/.test(w) ? 'eigenvects' : w === 'rank' ? 'rank' : /null|kernel/.test(w) ? 'nullspace' : /rref|reduced|rowreduce/.test(w) ? 'rref' : w === 'trace' ? 'trace' : /char/.test(w) ? 'charpoly' : 'transpose';
    return { op: 'matrix', matrixOp: op, exprs: [matrix(m[2]!, session)], label: `${m[1]} of ${m[2]}` };
  }
  m = /^solve (\[\[.+?\]\]) ?\*? ?[a-z] ?= ?(\[\[.+\]\]|\[[^[\]]+\])$/i.exec(s) ?? /^solve [A-Z] ?[a-z] ?= ?[a-z] (?:where|with|for|if) [A-Z] ?= ?(\[\[.+?\]\]),? (?:and )?[a-z] ?= ?(\[\[.+\]\]|\[[^[\]]+\])$/.exec(s);
  if (m) {
    const b = m[2]!.startsWith('[[') ? matrix(m[2]!, session) : vectorSrc(m[2]!, session);
    return { op: 'matrix', matrixOp: 'solve', exprs: [matrix(m[1]!, session), b], label: `Solve A·x = b` };
  }
  if (/\[\[/.test(s)) {
    // Matrix arithmetic: tokens between matrices must be plain operators/scalars.
    const parts = s.split(/(\[\[[^\]]*(?:\],\s*\[[^\]]*)*\]\])/);
    const out = parts.map((p) => (p.startsWith('[[') ? matrix(p, session) : p.trim() ? (/^[\s\d+\-*/^().]*$/.test(p) ? p.replace(/\^/g, '**') : null) : ''));
    if (out.some((x) => x === null)) return null;
    return { op: 'matrix', matrixOp: 'eval', exprs: [out.join(' ')], label: s };
  }

  // Vectors
  const vec = vectorRequest(s, session);
  if (vec) return vec;

  // Complex-number phrasings
  const cx = complexPhrase(s, session);
  if (cx) return cx;

  // Curve sketching
  m = /^(?:all )?(?:the )?(turning points?|stationary points?|critical points?|extrema|extreme points?|local (?:max(?:ima|imum)?|min(?:ima|imum)?)(?: and (?:max(?:ima|imum)?|min(?:ima|imum)?))?|max(?:ima|imum)? and min(?:ima|imum)?|inflection points?|points? of inflection|wendepunkte|extrempunkte|nullstellen|asymptotes?|kurvendiskussion|curve sketch(?:ing)?|analy[sz]e|investigate|discuss|maximum|minimum|max|min|absolute (?:maximum|minimum|extrema))(?: and (?:their|its) nature)?(?: (?:of|for))? (?:the (?:function|curve) )?(?:y ?= ?|f\(x\) ?= ?)?(.+?)(?: and (?:their|its) nature| and determine their nature)?$/i.exec(s);
  if (m) {
    const w = m[1]!.toLowerCase();
    const what = /inflection|wende/.test(w) ? 'inflection' : /nullstellen/.test(w) ? 'zeros' : /^asymptote/.test(w) ? 'asymptotes' : /^(?:maximum|max|absolute maximum)$/.test(w) ? 'max' : /^(?:minimum|min|absolute minimum)$/.test(w) ? 'min' : /turning|stationary|critical|extrem|max|min/.test(w) ? 'extrema' : 'all';
    return { op: 'extrema', exprs: [sym(m[2]!, session)], what, label: `${m[1]} of ${m[2]}` };
  }

  // Conics
  m = /^(identify|classify|what (?:conic|curve|shape) is|which conic is|conic:?|type of conic(?: for)?|centre and radius of(?: the circle)?|center and radius of(?: the circle)?|foci of|focus of|vertex of(?: the parabola)?|directrix of|eccentricity of|asymptotes of the hyperbola|describe the conic)\s*:?\s*(.+=.+)$/i.exec(s);
  if (m) {
    const r = relation(m[2]!)!;
    const w = m[1]!.toLowerCase();
    const what = /centre|center/.test(w) ? 'centre' : /foc/.test(w) ? 'foci' : /vertex/.test(w) ? 'vertex' : /directrix/.test(w) ? 'directrix' : /eccentricity/.test(w) ? 'eccentricity' : /asymptote/.test(w) ? 'asymptotes' : undefined;
    return { op: 'conic', exprs: [`(${sym(r.lhs, session)}) - (${sym(r.rhs, session)})`], what, label: `Conic ${m[2]}` };
  }

  // Quadratics: discriminant, nature/sum/product of roots, the formula itself
  m = /^(?:the )?(discriminant|nature of (?:the )?roots|sum and product of (?:the )?roots|sum of (?:the )?roots|product of (?:the )?roots|quadratic formula)(?: of| for| in)? (.+?)(?: = 0)?$/i.exec(s);
  if (m) {
    const w = m[1]!.toLowerCase();
    const mode = /^disc/.test(w) ? 'discriminant' : /nature/.test(w) ? 'nature' : /sum and/.test(w) ? 'sumprod' : /^sum/.test(w) ? 'sum' : /^product/.test(w) ? 'product' : 'formula';
    return { op: 'quadinfo', mode, exprs: [eqToExpr(m[2]!, session)], label: `${m[1]} of ${m[2]}` };
  }
  m = /^(?:the )?coefficient of (.+?) in (?:the expansion of )?(.+)$/i.exec(s);
  if (m) return { op: 'coeff', exprs: [sym(m[2]!, session), sym(m[1]!, session)], label: `Coefficient of ${m[1]} in ${m[2]}` };
  m = /^is (.+?) a factor of (.+)$/i.exec(s);
  if (m && /[a-z]/i.test(m[1]!)) return { op: 'polydiv', mode: 'isfactor', exprs: [sym(m[2]!, session), sym(m[1]!, session)], label: `Is ${m[1]} a factor of ${m[2]}?` };

  // Functions: domain, range, inverse, parity, composition, period/amplitude
  m = /^(?:the )?(domain and range|domain|range)(?: of)? (?:the function )?(?:f\(x\) ?= ?|y ?= ?)?(.+)$/i.exec(s);
  if (m && /[a-z]/i.test(m[2]!.replace(/\b(?:sqrt|ln|log|sin|cos|tan|exp|abs)\b/g, '')) && !/,\s*-?\d/.test(m[2]!)) {
    return { op: 'fninfo', mode: m[1]!.toLowerCase(), exprs: [sym(m[2]!, session)], vars: [guessVar(m[2]!)], label: `${m[1]} of ${m[2]}` };
  }
  m = /^(?:the )?inverse(?: function)? of (?:f\(x\) ?= ?|y ?= ?|the function )?(.+)$/i.exec(s) ?? /^f\^-1\(x\) (?:if|for|when|given) f\(x\) ?= ?(.+)$/i.exec(s);
  if (m && !/\[\[|mod|^\(\s*\d/i.test(m[1]!) && /[a-z]/i.test(m[1]!.replace(/\b(?:sqrt|ln|log|sin|cos|tan|exp)\b/g, ''))) {
    return { op: 'fninfo', mode: 'inverse', exprs: [sym(m[1]!, session)], vars: [guessVar(m[1]!)], label: `Inverse of ${m[1]}` };
  }
  m = /^is (?:f\(x\) ?= ?|y ?= ?)?(.+?) (?:an? )?(odd or even|even or odd|even|odd)(?: function)?$/i.exec(s);
  if (m && /[a-z]/i.test(m[1]!)) return { op: 'fninfo', mode: 'parity', exprs: [sym(m[1]!, session)], vars: [guessVar(m[1]!)], label: `Is ${m[1]} even or odd?` };
  m = /^(?:(?:the )?(?:amplitude|period|phase shift|vertical shift|midline|frequency)(?:,? (?:and )?(?:amplitude|period|phase shift|vertical shift|midline|frequency))*)(?: of)? (?:y ?= ?|f\(x\) ?= ?)?(.+)$/i.exec(s);
  if (m && /sin|cos|tan|sec|csc|cot/i.test(m[1]!)) return { op: 'fninfo', mode: 'sinusoid', exprs: [sym(m[1]!, session)], vars: [guessVar(m[1]!)], label: `Sinusoid ${m[1]}` };
  m = /^(?:find |what is )?([a-z])\s*\(\s*([a-z])\s*\(\s*([a-z])\s*\)\s*\)\s*(?:if|when|where|given|for)\s+(.+)$/i.exec(s) ?? /^(?:compose|composition of)\s+(.+)$/i.exec(s);
  if (m) {
    const defsText = m.length > 4 ? m[4]! : m[1]!;
    const defs = [...defsText.matchAll(/([a-z])\s*\(\s*([a-z])\s*\)\s*=\s*(.+?)(?=\s*(?:,|;|\band\b)\s*[a-z]\s*\(\s*[a-z]\s*\)\s*=|$)/gi)];
    if (defs.length >= 2) {
      const local: Session = { ...session, fns: new Map(session.fns) };
      for (const d of defs) {
        const body = parse(lex(normalize(d[3]!.replace(/[,;]\s*$/, '')).text), { userFunctions: new Set(local.fns.keys()) }).ast;
        local.fns.set(d[1]!.toLowerCase(), { params: [d[2]!.toLowerCase()], body: splitLetterProducts(body), source: d[0]! });
      }
      const [f, g, x] = m.length > 4 ? [m[1]!, m[2]!, m[3]!] : [defs[0]![1]!, defs[1]![1]!, defs[1]![2]!];
      const fg = toSympy(parse(lex(`${f}(${g}(${x}))`), { userFunctions: new Set(local.fns.keys()) }).ast, local);
      const gf = toSympy(parse(lex(`${g}(${f}(${x}))`), { userFunctions: new Set(local.fns.keys()) }).ast, local);
      return { op: 'fninfo', mode: 'compose', exprs: [fg, gf], vars: [x], scalar: `${f}(${g}(${x}))|${g}(${f}(${x}))`, label: `${f}(${g}(${x}))` };
    }
  }

  // Applications of integration
  m = /^(?:find |the )?(area under|area between|average value of|mean value of|volume of revolution of|volume (?:of the solid )?(?:generated|formed) by (?:rotating|revolving)|arc length of|length of the curve|surface area of revolution of)(?: the curves?)? (.+)$/i.exec(s);
  if (m) {
    const r = calcApplication(m[1]!.toLowerCase(), m[2]!, session);
    if (r) return r;
  }

  // Vector calculus
  m = /^(?:the )?(gradient|grad|∇|hessian(?: matrix)?|jacobian(?: matrix)?|divergence|div|curl|laplacian|directional derivative|tangent plane)(?: of)?(?: f ?= ?| z ?= ?| to z ?= ?| to)? (.+)$/i.exec(s);
  if (m && !/\bthrough\b|line through|between \(/i.test(m[2]!)) {
    const r = vectorCalculus(m[1]!.toLowerCase(), m[2]!, session);
    if (r) return r;
  }

  // Linear algebra on vectors
  m = new RegExp(`^(?:the )?(gram[- ]schmidt|orthonormali[sz]e|span of|are|is)\\s*(?:of |on )?((?:${VEC}\\s*(?:,|and)?\\s*)+)(linearly (?:in)?dependent)?$`, 'i').exec(s);
  if (m) {
    const vs = [...m[2]!.matchAll(new RegExp(VEC, 'g'))].map((x) => vectorSrc(x[0], session));
    if (vs.length >= 2) {
      const w = m[1]!.toLowerCase();
      const mode = /gram|ortho/.test(w) ? 'gramschmidt' : /span/.test(w) ? 'span' : 'independence';
      return { op: 'vector', vectorOp: 'set', mode, exprs: vs, label: `${m[1]} ${m[2]}` };
    }
  }

  // Polynomial division / remainder / gcd
  m = /^(?:the )?remainder (?:when|of) (.+?) (?:is )?divided by (.+)$/i.exec(s);
  if (m) return { op: 'polydiv', mode: 'remainder', exprs: [sym(m[1]!, session), sym(m[2]!, session)], label: `Remainder of (${m[1]}) ÷ (${m[2]})` };
  m = /^(?:(long|synthetic|polynomial) division(?: of)?|divide) (.+?) (?:by|divided by|÷|\/) (.+)$/i.exec(s);
  if (m && /[a-z]/i.test(m[2]! + m[3]!)) {
    return { op: 'polydiv', mode: m[1]?.toLowerCase() === 'synthetic' ? 'synthetic' : undefined, exprs: [sym(m[2]!, session), sym(m[3]!, session)], label: `(${m[2]}) ÷ (${m[3]})` };
  }
  m = /^(gcd|hcf|gcf|greatest common (?:divisor|factor)|highest common factor|lcm|least common multiple|lowest common multiple)(?: of)? \(?(.+?)\)?$/i.exec(s);
  if (m && /[a-z]/i.test(m[2]!.replace(/\band\b/g, ''))) {
    const parts = splitTop(m[2]!);
    if (parts.length >= 2) {
      const isGcd = /^(?:g|h)/i.test(m[1]!);
      return { op: isGcd ? 'pgcd' : 'plcm', exprs: parts.map((p) => sym(p, session)), label: `${isGcd ? 'GCD' : 'LCM'} of ${parts.join(', ')}` };
    }
  }

  m = /^(?:complete the square|completing the square)(?: (?:for|of|on|in))? (.+?)(?: = 0)?$/i.exec(s);
  if (m) return { op: 'complete_square', exprs: [sym(m[1]!, session)], label: `Complete the square: ${m[1]}` };
  m = /^(?:rationali[sz]e)(?: the denominator)?(?: (?:of|in))? (.+)$/i.exec(s);
  if (m) return { op: 'rationalize', exprs: [sym(m[1]!, session)], label: `Rationalise ${m[1]}` };

  // Identities: "verify sin^2 x + cos^2 x = 1", "prove …", "is sin(2x) = 2 sin x cos x", "show that …"
  m = /^(?:verify|prove|check|show(?: that)?|is it true that|confirm|is)\s+(?:that\s+)?(.+?)(?: (?:is )?an identity| for all [a-z])?$/i.exec(s);
  if (m && relation(m[1]!) && !/\b(?:prime|even|odd|divisible|a factor|perfect)\b/i.test(m[1]!)) {
    const r = relExprs(m[1]!, session);
    return { op: 'identity', exprs: r.exprs.slice(0, 1), rels: r.rels.slice(0, 1), label: `Is ${m[1]}?` };
  }

  m = /^(simplify|expand|factor|factorise|factorize|factorization of|factorisation of|partial fractions? (?:of|for)|partial fraction decomposition of|decompose|apart|cancel|combine|write as a single fraction|reduce)\s+(.+)$/i.exec(s);
  if (m) {
    const w = m[1]!.toLowerCase();
    let body = m[2]!;
    let domain: 'real' | 'complex' | undefined;
    const d = /\s+(?:over|in)\s+(?:the\s+)?(complex(?: numbers)?|reals?|real numbers|ℂ|ℝ|c|r|integers|rationals)\s*$/i.exec(body);
    if (d) {
      domain = /^(?:complex|ℂ|c$)/i.test(d[1]!) ? 'complex' : /^(?:real|ℝ|r$)/i.test(d[1]!) ? 'real' : undefined;
      body = body.slice(0, d.index);
    }
    const op: SymOp = w === 'simplify' || w === 'cancel' || w === 'reduce' ? 'simplify' : w === 'combine' || w.startsWith('write') ? 'together' : w === 'expand' ? 'expand' : w.startsWith('factor') ? 'factor' : 'apart';
    if (op === 'factor' && /^\s*\d+\s*$/.test(body)) return null; // "factor 360" is integer factorisation (number theory)
    if ((op === 'simplify' || op === 'factor') && /^\s*-?\d+\s*\/\s*-?\d+\s*$/.test(body)) return null; // "simplify 12/18": the calculator's fraction
    const req: SymRequest = { op, exprs: [sym(body, session)], label: `${op === 'apart' ? 'Partial fractions of' : op === 'together' ? 'Combine' : capital(op)} ${body}` };
    if (domain) req.domain = domain;
    return req;
  }

  // "make r the subject of A = πr^2", "rearrange v^2 = u^2 + 2as for s", "express T in terms of …"
  m = /^make ([a-zA-Zθ]+) the subject(?: of(?: the formula)?)? (.+)$/i.exec(s) ?? /^(?:rearrange|transpose|change the subject of) (.+?) (?:for|to make) ([a-zA-Zθ]+)(?: the subject)?$/i.exec(s);
  if (m) {
    const [v, eq] = /^make/i.test(s) ? [m[1]!, m[2]!] : [m[2]!, m[1]!];
    return solveRequest(eq, [varName(v)], session, `Solve ${eq} for ${v}`);
  }
  m = /^(?:express|write) ([a-zA-Z]) in terms of [a-zA-Z, ]+?(?: if| given| when|,|:)\s*(.+=.+)$/i.exec(s);
  if (m) return solveRequest(m[2]!, [varName(m[1]!)], session, `Solve ${m[2]} for ${m[1]}`);
  m = /^(?:solve )?for ([a-zA-Z](?:\s*(?:,|and)\s*[a-zA-Z])*)\s*[:,]?\s+(.+=.+)$/i.exec(s);
  if (m && !/^\s*\d/.test(m[2]!)) return solveRequest(m[2]!, m[1]!.split(/\s*(?:,|and)\s*/).map(varName), session, `Solve ${m[2]} for ${m[1]}`);
  m = /^(?:what is |find )?([a-zA-Z]) (?:if|when|given(?: that)?|such that|where) (.+[=<>≤≥].+)$/i.exec(s);
  if (m && relation(m[2]!)) return solveRequest(m[2]!, [varName(m[1]!)], session, `Solve ${m[2]} for ${m[1]}`);

  // Roots of unity, square roots of i…
  m = /^(?:(?:all|the) )*(square|cube|fourth|fifth|sixth|eighth|\d+(?:st|nd|rd|th)|n-?th) roots (?:of )?(unity|.+)$/i.exec(s) ?? /^(?:the )?(square|cube|fourth|fifth|sixth|eighth|\d+(?:st|nd|rd|th)) roots? of (unity|-?\d*\s*[+-]?\s*\d*i)$/i.exec(s);
  if (m && (/unity|\bi\b|\di\b/i.test(m[2]!) || /roots/i.test(s))) {
    const k = { square: 2, cube: 3, fourth: 4, fifth: 5, sixth: 6, eighth: 8 }[m[1]!.toLowerCase()] ?? parseInt(m[1]!, 10);
    if (!k) return null;
    const w = /unity/i.test(m[2]!) ? '1' : m[2]!;
    return { op: 'solve', exprs: [`(Symbol('z'))**(${k}) - (${sym(w, session)})`], rels: ['='], vars: ['z'], domain: 'complex', label: `${m[1]} roots of ${m[2]}` };
  }

  m = /^(?:solve the (?:simultaneous )?(?:equations?|system(?: of equations)?|inequality|inequalities)|solve simultaneously|solve|(?:the )?general solution (?:of|to)|roots? of|zeros? of|(?:the )?solutions? (?:of|to)|find (?:the )?(?:roots?|zeros?|solutions?) of)\s*:?\s+(.+?)(?:\s+for\s+([a-zA-Zθ](?:\s*(?:,|and)\s*[a-zA-Zθ])*))?(?:\s+(?:over|in)\s+(?:the\s+)?(complex(?: numbers)?|reals?|real numbers|ℂ|ℝ))?$/i.exec(s);
  if (m) {
    const vars = m[2] ? m[2].split(/\s*(?:,|and)\s*/).map(varName) : undefined;
    let body = m[1]!;
    if (m[3]) body += ` over ${m[3]}`;
    // "solve x^2 - 4" (no relation) means = 0
    return solveRequest(body, vars, session, `Solve ${m[1]}${m[2] ? ` for ${m[2]}` : ''}`);
  }

  // Lists of equations ("x + y = 5, x - y = 1") are a system.
  const items = splitTop(s);
  // …unless every item just defines a variable from known values ("a = 3, b = 4"): that's for the calculator.
  const assigns = items.every((it) => {
    const r = /^\s*[a-z]\w*\s*=\s*(.+)$/i.exec(it);
    return r && calculate(r[1]!, session).ok;
  });
  if (items.length >= 2 && !assigns && items.every((it) => relation(it)) && !items.some((it) => DEFINITION.test(relation(it)!.lhs))) {
    const req = solveRequest(s, undefined, session, `Solve ${s}`);
    if (symbolsIn(req.exprs).size) return req;
  }

  // A bare equation or inequality ("2x + 3 = 7", "ax + bx = 2", "x^2 < 4"); "x = 5" stays an assignment,
  // "f(x) = …" a definition and "y = 2x + 1" a graph.
  const chain = relationChain(s);
  if (chain) {
    const lhs = chain.parts[0]!;
    const rhs = chain.parts.slice(1).join(' ');
    const single = chain.ops.length === 1 && chain.ops[0] === '=';
    if (single && DEFINITION.test(lhs)) return null;
    const isAssignment = single && /^\s*[a-z]\w*\s*$/i.test(lhs) && !new RegExp(`(?:^|[^a-z])${lhs.trim()}(?![a-z])`, 'i').test(rhs);
    if (isAssignment || (items.length >= 2 && assigns)) return null;
    if (/^\s*[yr]\s*(?:=|<|>)/i.test(s) && /\bx\b|\dx\b|θ|theta/i.test(rhs)) return null;
    const req = solveRequest(s, undefined, session, `Solve ${s}`);
    if (!symbolsIn(req.exprs).size) {
      // "2x = 6" after x = 2 was defined: still an equation in x, so solve with the stored values set aside.
      const shadowed = [...session.vars.keys()].filter((v) => new RegExp(`(?:^|[^a-z])${v}(?![a-z])|\\d${v}(?![a-z])`, 'i').test(s));
      if (shadowed.length && chain.ops.every((o) => o === '=')) {
        const bare: Session = { ...session, vars: new Map([...session.vars].filter(([k]) => !shadowed.includes(k))) };
        const r2 = solveRequest(s, undefined, bare, `Solve ${s}`);
        if (symbolsIn(r2.exprs).size) return r2;
      }
      return { op: 'identity', exprs: req.exprs.slice(0, 1), rels: req.rels!.slice(0, 1), label: `Is ${s}?` };
    }
    return req;
  }
  return null;
}

/** "y = x^2 from 0 to 2", "y = x and y = x^2", "x^2 on [0, 3] about the x-axis" → a calcapp request. */
function calcApplication(kind: string, rest: string, session: Session): SymRequest | null {
  let body = rest.trim();
  let axis: string | undefined;
  const ax = /\s*,?\s*(?:about|around)\s+(?:the\s+)?(x|y)[- ]?axis\s*$/i.exec(body);
  if (ax) {
    axis = ax[1]!.toLowerCase();
    body = body.slice(0, ax.index);
  }
  body = body.replace(/^(?:the )?(?:curve |graph of )?/i, '').replace(/\s*,?\s*(?:rotated|revolved)\s*$/i, '');
  let lo: string | undefined;
  let hi: string | undefined;
  const iv = /\s*,?\s*(?:from|between|for)\s+(?:x\s*=\s*)?(-?[^\s]+)\s+(?:to|and)\s+(?:x\s*=\s*)?(-?[^\s]+)\s*$/i.exec(body) ?? /\s*,?\s*(?:on|over|in)\s+(?:the interval\s+)?\[\s*([^,]+?)\s*,\s*([^\]]+?)\s*\]\s*$/i.exec(body);
  if (iv) {
    lo = LIMIT_POINT(iv[1]!, session);
    hi = LIMIT_POINT(iv[2]!, session);
    body = body.slice(0, iv.index);
  }
  const fns = body.split(/\s+and\s+|\s*,\s*/).map((f) => f.replace(/^\s*(?:y|f\(x\))\s*=\s*/i, '').trim()).filter(Boolean);
  if (!fns.length || fns.some((f) => /=/.test(f))) return null;
  const mode = /between/.test(kind) ? 'between' : /under/.test(kind) ? 'area' : /average|mean/.test(kind) ? 'average' : /volume/.test(kind) ? `volume_${axis ?? 'x'}` : /surface/.test(kind) ? 'surface' : 'arclength';
  if (mode === 'between' && fns.length < 2) return null;
  if (mode !== 'between' && (!lo || !hi)) return null;
  return { op: 'calcapp', mode, exprs: fns.map((f) => sym(f, session)), vars: [guessVar(fns.join(' '))], lower: lo, upper: hi, label: `${kind} ${rest}` };
}

/** Gradient, Hessian, Jacobian, divergence, curl, Laplacian, directional derivatives and tangent planes. */
function vectorCalculus(kind: string, rest: string, session: Session): SymRequest | null {
  let body = rest.trim();
  let point: string[] | undefined;
  let dir: string[] | undefined;
  const d = new RegExp(`\\s*,?\\s*(?:in the direction of|in direction|along|towards?)\\s+(?:the vector\\s+)?(${VEC})\\s*$`, 'i').exec(body);
  if (d) {
    dir = splitCommas(d[1]!.slice(1, -1)).map((c) => sym(c, session));
    body = body.slice(0, d.index);
  }
  const p = new RegExp(`\\s*,?\\s*(?:at|at the point)\\s+(${VEC})\\s*$`, 'i').exec(body);
  if (p) {
    point = splitCommas(p[1]!.slice(1, -1)).map((c) => sym(c, session));
    body = body.slice(0, p.index);
  }
  body = body.replace(/^(?:f|z|F)\s*=\s*/, '');
  const mode = /grad|∇/.test(kind) ? 'gradient' : /hess/.test(kind) ? 'hessian' : /jacob/.test(kind) ? 'jacobian' : /^div/.test(kind) ? 'divergence' : /curl/.test(kind) ? 'curl' : /laplac/.test(kind) ? 'laplacian' : /directional/.test(kind) ? 'directional' : 'tangentplane';
  const comps = /^[(<⟨[]/.test(body) && /[)>⟩\]]$/.test(body) ? splitCommas(body.slice(1, -1)) : [body];
  const exprs = comps.map((c) => sym(c, session));
  if (mode === 'directional' && (!dir || !point)) return null;
  if (mode === 'tangentplane' && !point) return null;
  return { op: 'vcalc', mode, exprs, at: point, direction: dir, label: `${kind} of ${rest}` };
}

const DEFINITION = /^\s*(?!(?:sin|cos|tan|sec|csc|cot|ln|log|lg|exp|sqrt|cbrt|abs|asin|acos|atan|arcsin|arccos|arctan|sinh|cosh|tanh|floor|ceil|round|tg|ctg|sen|logb?\d+|log_\d+|root\d*)\s*\()[a-z]\w*\s*\(\s*[a-z]\w*(?:\s*,\s*[a-z]\w*)*\s*\)\s*$/i;

/** "x^3 - 2x - 5" or "x^3 = 2x + 5" → one SymPy expression (lhs − rhs). */
function eqToExpr(t: string, session: Session): string {
  const r = relation(t);
  return r ? `(${sym(r.lhs, session)}) - (${sym(r.rhs, session)})` : sym(t, session);
}

/** Numbers listed as a sequence: "3, 7, 11, 15" or "1 + 1/2 + 1/4 + …". */
function terms(t: string, session: Session): string[] | null {
  const body = t.replace(/\s*[,+]?\s*(?:\.\.\.|…)\s*$/, '').trim();
  const parts = /,/.test(body) ? body.split(/\s*,\s*/) : body.split(/\s+\+\s+/);
  if (parts.length < 3) return null;
  if (!parts.every((p) => /^[-\d./\s()^]+$/.test(p))) return null;
  return parts.map((p) => sym(p, session));
}

function sequenceRequest(s: string, session: Session): SymRequest | null {
  const SEQ = String.raw`(?:(?:the )?(?:arithmetic|geometric|arithmetic progression|geometric progression|AP|GP)?\s*(?:sequence|series|progression)?\s*:?\s*)?`;
  let m = new RegExp(`^(?:the )?(?:nth|general|n-th) term(?: formula)? (?:of|for) ${SEQ}(.+)$`, 'i').exec(s) ?? new RegExp(`^${SEQ}(.+?),? (?:nth|general) term$`, 'i').exec(s);
  if (m) {
    const t = terms(m[1]!, session);
    if (t) return { op: 'sequence', exprs: t, task: 'nth', geometric: /geometric|GP/i.test(s), label: `nth term of ${m[1]}` };
  }
  m = new RegExp(`^(?:the )?(\\d+)(?:st|nd|rd|th) term (?:of|in) ${SEQ}(.+)$`, 'i').exec(s);
  if (m) {
    const t = terms(m[2]!, session);
    if (t) return { op: 'sequence', exprs: t, task: 'term', n: Number(m[1]), label: `Term ${m[1]} of ${m[2]}` };
  }
  m = new RegExp(`^(?:the )?sum of (?:the )?first (\\d+) terms (?:of|in) ${SEQ}(.+)$`, 'i').exec(s);
  if (m) {
    const t = terms(m[2]!, session);
    if (t) return { op: 'sequence', exprs: t, task: 'sum', n: Number(m[1]), label: `Sum of the first ${m[1]} terms of ${m[2]}` };
  }
  m = new RegExp(`^(?:the )?(?:sum to infinity|infinite sum|sum) (?:of )?${SEQ}(.+?)(?: to infinity)?$`, 'i').exec(s);
  if (m && (/infinity|\.\.\.|…/.test(s))) {
    const t = terms(m[1]!, session);
    if (t) return { op: 'sequence', exprs: t, task: 'sum_inf', label: `Sum to infinity of ${m[1]}` };
  }
  m = new RegExp(`^(?:the )?common (ratio|difference) (?:of|in|for) ${SEQ}(.+)$`, 'i').exec(s);
  if (m) {
    const t = terms(m[2]!, session);
    if (t) return { op: 'sequence', exprs: t, task: m[1]!.toLowerCase() === 'ratio' ? 'ratio' : 'difference', geometric: m[1]!.toLowerCase() === 'ratio', label: `Common ${m[1]} of ${m[2]}` };
  }
  m = /^(?:the )?(?:next (?:term|number)|what comes next|continue)(?: (?:of|in|after))?:? (.+)$/i.exec(s) ?? /^(.+?),? (?:what comes next|next term|\?)$/i.exec(s);
  if (m) {
    const t = terms(m[1]!, session);
    if (t) return { op: 'sequence', exprs: t, task: 'next', label: `Next term of ${m[1]}` };
  }
  // "arithmetic sequence a1 = 5, d = 3, find a10", "geometric sequence a = 2, r = 3, find the 6th term / sum of 6 terms"
  m = /^(arithmetic|geometric)(?: sequence| progression| series)?,? (?:with )?(?:a1?|first term) ?= ?(-?[\d./]+),? (?:and )?(?:d|r|common (?:difference|ratio)) ?= ?(-?[\d./]+),?\s*(?:find )?(?:(?:the )?a_?(\d+)|(?:the )?(\d+)(?:st|nd|rd|th) term|(?:the )?sum of (?:the )?(?:first )?(\d+) terms|S_?(\d+))?$/i.exec(s);
  if (m) {
    const geo = /geometric/i.test(m[1]!);
    const t = [m[2]!, geo ? `(${m[2]})*(${m[3]})` : `(${m[2]})+(${m[3]})`, geo ? `(${m[2]})*(${m[3]})^2` : `(${m[2]})+2*(${m[3]})`].map((x) => sym(x, session));
    const nTerm = m[4] ?? m[5];
    const nSum = m[6] ?? m[7];
    return { op: 'sequence', exprs: t, geometric: geo, task: nTerm ? 'term' : nSum ? 'sum' : 'nth', n: nTerm ? Number(nTerm) : nSum ? Number(nSum) : undefined, label: s };
  }
  return null;
}

function recurrence(s: string, session: Session): SymRequest | null {
  const parts = splitTop(s.replace(/^(?:solve (?:the recurrence )?)/i, ''));
  const rec = parts.find((p) => /a(?:\(n|_\{?n)/.test(p) && /a(?:\(n\s*-|_\{?n-)/.test(p));
  if (!rec) return null;
  const ics: [string, string][] = [];
  for (const p of parts) {
    if (p === rec) continue;
    const m = /^a(?:\((\d+)\)|_\{?(\d+)\}?)\s*=\s*(.+)$/.exec(p.trim());
    if (!m) return null;
    ics.push([m[1] ?? m[2]!, sym(m[3]!, session)]);
  }
  const prepared = rec
    .replace(/a(?:\(n\)|_\{n\}|_n)/g, ' seq_n0 ')
    .replace(/a(?:\(n\s*-\s*(\d)\)|_\{n-(\d)\})/g, (_m, a: string | undefined, b: string | undefined) => ` seq_m${a ?? b} `);
  const r = relation(prepared);
  if (!r) return null;
  const toFn = (src: string) => src.replace(/Symbol\('seq_n0'\)/g, "Function('a')(Symbol('n'))").replace(/Symbol\('seq_m(\d)'\)/g, "Function('a')(Symbol('n')-$1)");
  const expr = toFn(`(${sym(r.lhs, session)}) - (${sym(r.rhs, session)})`);
  return { op: 'rsolve', exprs: [expr], ics, label: `Recurrence ${s}` };
}

const VEC = String.raw`(?:\(\s*-?[^()]+?(?:,\s*-?[^()]+?)+\s*\)|<\s*[^<>]+?>|⟨[^⟨⟩]+⟩|\[\s*-?[^[\]]+?(?:,[^[\]]+?)+\])`;

function vectorRequest(s: string, session: Session): SymRequest | null {
  const V = (t: string) => vectorSrc(t, session);
  let m = new RegExp(`^(?:the )?(dot|scalar|inner|cross|vector) product (?:of )?(${VEC}) (?:and|with|·|x|×) (${VEC})$`, 'i').exec(s) ?? new RegExp(`^(${VEC}) ?(·|\\.|×|x) ?(${VEC})$`, 'i').exec(s);
  if (m) {
    const [w, a, b] = m[1]!.startsWith('(') || m[1]!.startsWith('<') || m[1]!.startsWith('[') || m[1]!.startsWith('⟨') ? [m[2]!, m[1]!, m[3]!] : [m[1]!, m[2]!, m[3]!];
    const cross = /cross|vector|×|^x$/i.test(w);
    return { op: 'vector', vectorOp: cross ? 'cross' : 'dot', exprs: [V(a), V(b)], label: `${cross ? 'Cross' : 'Dot'} product of ${a} and ${b}` };
  }
  m = new RegExp(`^(?:the )?(?:magnitude|length|norm|modulus|size) of (?:the )?(?:vector )?(${VEC})$`, 'i').exec(s) ?? new RegExp(`^\\|\\s*(${VEC})\\s*\\|$|^‖\\s*(${VEC})\\s*‖$`, 'i').exec(s);
  if (m) {
    const v = m[1] ?? m[2]!;
    return { op: 'vector', vectorOp: 'magnitude', exprs: [V(v)], label: `|${v}|` };
  }
  m = new RegExp(`^(?:the )?unit vector (?:of|in the direction of|along) (?:the vector )?(${VEC})$`, 'i').exec(s) ?? new RegExp(`^normali[sz]e (${VEC})$`, 'i').exec(s);
  if (m) return { op: 'vector', vectorOp: 'unit', exprs: [V(m[1]!)], label: `Unit vector of ${m[1]}` };
  m = new RegExp(`^(?:the )?angle between (?:the )?(?:vectors? )?(${VEC}) and (${VEC})$`, 'i').exec(s);
  if (m) return { op: 'vector', vectorOp: 'angle', exprs: [V(m[1]!), V(m[2]!)], label: `Angle between ${m[1]} and ${m[2]}` };
  m = new RegExp(`^(?:the )?(?:vector )?projection of (${VEC}) (?:onto|on) (${VEC})$`, 'i').exec(s);
  if (m) return { op: 'vector', vectorOp: 'projection', exprs: [V(m[1]!), V(m[2]!)], label: `Projection of ${m[1]} onto ${m[2]}` };
  m = new RegExp(`^(${VEC}) ?([+-]) ?(${VEC})$`, 'i').exec(s);
  if (m && splitCommas(m[1]!.slice(1, -1)).length === splitCommas(m[3]!.slice(1, -1)).length)
    return { op: 'vector', vectorOp: m[2] === '+' ? 'add' : 'sub', exprs: [V(m[1]!), V(m[3]!)], label: s };
  m = new RegExp(`^(-?[\\d./]+) ?[*·×]? ?(${VEC})$`, 'i').exec(s);
  if (m && /^\(|^</.test(m[2]!)) return { op: 'vector', vectorOp: 'scale', exprs: [V(m[2]!)], scalar: sym(m[1]!, session), label: s };
  return null;
}

function complexPhrase(s: string, session: Session): SymRequest | null {
  let m = /^(?:convert |write |express |put )?(.+?) (?:in|to|into) (polar|exponential|trigonometric|rectangular|cartesian|standard|a ?\+ ?bi) form$/i.exec(s) ??
    /^(?:the )?(polar|exponential|trigonometric|rectangular|cartesian|standard) form (?:of )?(.+)$/i.exec(s);
  if (m) {
    const [z, f] = /form$/i.test(s) ? [m[1]!, m[2]!] : [m[2]!, m[1]!];
    const form = /polar|trig/i.test(f) ? 'polar' : /exp/i.test(f) ? 'exp' : 'rect';
    return { op: 'evaluate', exprs: [sym(z, session)], form, label: `${z} in ${f} form` };
  }
  m = /^(?:the )?(conjugate|complex conjugate|modulus|absolute value|argument|arg|real part|imaginary part|amplitude|principal argument)(?: of)? (.+)$/i.exec(s);
  if (m && /\bi\b|\di\b|i\)/.test(m[2]!)) {
    const w = m[1]!.toLowerCase();
    const fn = /conj/.test(w) ? 'conjugate' : /modulus|absolute/.test(w) ? 'Abs' : /arg|amplitude/.test(w) ? 'arg' : /real/.test(w) ? 're' : 'im';
    return { op: 'evaluate', exprs: [`${fn}(${sym(m[2]!, session)})`], label: `${m[1]} of ${m[2]}` };
  }
  m = /^(.+?)\s+(?:using|by|with)\s+(?:de ?moivre'?s?(?: theorem)?|euler'?s? formula)$/i.exec(s);
  if (m) return { op: 'evaluate', exprs: [sym(m[1]!, session)], form: 'rect', label: m[1]! };
  return null;
}

/** For calculator failures that are really complex-number questions: "sqrt(-4)", "(2+3i)(1-i)". */
export function complexRequest(input: string, session: Session): SymRequest | null {
  try {
    return { op: 'evaluate', exprs: [sym(input, session)], label: input };
  } catch {
    return null;
  }
}

/**
 * For calculator failures on expressions in single-letter unknowns ("2x + 3x", "(x^3 - 1)/(x - 1)"): simplify
 * symbolically, or divide polynomials when the input is a quotient. Returns null for anything else.
 */
export function expressionRequest(input: string, session: Session): SymRequest | null {
  const t = input.trim();
  // "xy", "2xy", "-3abc": run-together letters with no operator are a product too.
  const runOnly = /^-?\s*(?:\d+(?:\.\d+)?\s*\*?\s*)?[a-z]{2,3}$/.test(t);
  if ((!/[+\-*/^()]/.test(t) && !runOnly) || /[=<>≤≥]/.test(t)) return null;
  const ids = (t.match(/[a-zA-Z_]+/g) ?? []).filter((w) => !KNOWN_LOWER.has(w.toLowerCase()) && !/^(?:sqrt|cbrt|abs|exp|ln|log|gcd|lcm|floor|ceil)$/i.test(w));
  if (!ids.length || ids.some((w) => w.length > 1 && !letterProduct(w, session))) return null;
  // "5 m/s * 3 s" is units, not algebra: a number, a space, then a lone letter.
  if (/\d\s+[a-zA-Z](?:\s*[/*^]|\s*$|\s+\d)/.test(t)) return null;
  try {
    const norm = normalize(t);
    const { ast } = parse(lex(norm.text), { userFunctions: new Set(session.fns.keys()) });
    if (ast.type === 'binary' && ast.op === '/') {
      const num = toSympy(ast.left, session);
      const den = toSympy(ast.right, session);
      if (/Symbol/.test(den) && !/(?:sin|cos|tan|log|exp|sqrt)\(/.test(num + den)) return { op: 'polydiv', exprs: [num, den], label: `(${print(ast.left)}) ÷ (${print(ast.right)})` };
    }
    // "bare": answered in its most useful form (factored or expanded), with a hint when nothing simplifies.
    return { op: 'simplify', exprs: [sym(t, session)], label: t, mode: 'bare' };
  } catch {
    return null;
  }
}

/** Words that are never a product of letters: units, common words, and names with a meaning. */
const NOT_PRODUCTS = new Set(
  'km cm mm nm um mi ft yd in lb lbs oz ml kg mg ug kw mw hz khz mhz ghz mph kph kmh sec min hr hrs day yr yrs kb mb gb tb pa kpa hpa atm mol cal kcal kj ev kev mev rad deg bar psi db am pm to of on or an as at be by do go he if is it me my no so up us we the and for are was not but its his her you all can how why who use set let get put add sum max min avg mod per off out new old one two six ten'.split(' '),
);

/**
 * "xy", "abc": a 2–3 letter run of distinct, unknown letters read as their product (the way algebra is written).
 * Defined variables keep their own (multi-letter) name, and each single letter that has a value is substituted.
 */
export function letterProduct(w: string, session: Session): boolean {
  return /^[a-z]{2,3}$/.test(w) && !NOT_PRODUCTS.has(w) && !WHOLE_WORDS.test(w) && !KNOWN_LOWER.has(w) && !session.vars.has(w) && !session.fns.has(w) && new Set(w).size === w.length;
}

function print(n: Node): string {
  return n.type === 'name' ? n.name : JSON.stringify(n).length < 0 ? '' : '…';
}

function odeToSympy(s: string): string {
  const r = relation(s);
  if (!r) throw new MathError('syntax', 'An ODE needs an "="');
  const conv = (t: string) => {
    // Only a small, safe alphabet goes to the worker for ODEs.
    if (!/^[\s\w+\-*/^().'=]*$/.test(t)) throw new MathError('syntax', 'Unsupported characters in the equation');
    return t
      .replace(/d\^?2y\/dx\^?2/g, "y''")
      .replace(/dy\/dx/g, "y'")
      .replace(/(\d)\s*([a-zA-Z(])/g, '$1*$2')
      .replace(/([)'])\s*([a-zA-Z(])/g, '$1*$2')
      .replace(/\by\s*\(/g, 'y*(')
      .replace(/\by'''/g, 'Derivative(f(x), x, 3)')
      .replace(/\by''/g, 'Derivative(f(x), x, 2)')
      .replace(/\by'/g, 'Derivative(f(x), x)')
      .replace(/\by\b/g, 'f(x)')
      .replace(/\be\^/g, 'E^')
      .replace(/\bln\(/g, 'log(')
      .replace(/\^/g, '**')
      .replace(/\b(x)\s*(?=f\(|[a-zA-Z(])/g, '$1*');
  };
  return `Eq(${conv(r.lhs)}, ${conv(r.rhs)})`;
}

function guessVar(text: string, prefs = ['x', 't', 'y', 'z', 's', 'n', 'u', 'θ']): string {
  const t = text.toLowerCase();
  const names = [...(t.match(/\b[a-z]\b/g) ?? []), ...[...t.matchAll(/\d([a-z])\b/g)].map((m) => m[1]!), ...[...t.matchAll(/(?:^|[^a-z])([a-z])(?=[a-z]*\^|\))/g)].map((m) => m[1]!)].filter(
    (x) => x !== 'e' && x !== 'i',
  );
  if (/θ|theta/.test(t)) names.push('theta');
  for (const pref of prefs) if (names.includes(pref)) return pref === 'θ' ? 'theta' : pref;
  return names[0] ?? 'x';
}

const sup = (n: number) => String(n).replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)]!);
const capital = (s: string) => s[0]!.toUpperCase() + s.slice(1);

export const LOOKS_LIKE_SYMBOLIC =
  /\b(?:derivative|differentiate|d\/d[a-z]|integra\w*|antiderivative|limit|lim|series|taylor|maclaurin|solve|roots? of|zeros? of|solutions?|simplify|expand|factor\w*|partial|apart|cancel|laplace|fourier|det\w*|inverse|eigen\w*|rank|null ?space|kernel|rref|transpose|trace|dsolve|implicit\w*|sum|summation|nth term|next term|terms? of|sequence|progression|recurrence|product|magnitude|unit vector|angle between|projection|conjugate|modulus|argument|polar|exponential form|real part|imaginary part|roots of unity|de ?moivre|truth table|tautology|contradiction|make \w+ the subject|rearrange|remainder|division|divide|gcd|lcm|hcf|gcf|complete the square|completing the square|rationali[sz]e|binomial expansion|binomial series|verify|prove|identity|turning points?|stationary|critical points?|extrem\w*|maxim\w*|minim\w*|inflection|wendepunkte|nullstellen|asymptotes?|kurvendiskussion|identify|conic|centre and radius|center and radius|foci|double integral|numbers?|combine|rectangular form|cartesian form|trigonometric form|discriminant|nature of|coefficient|a factor of|domain|range|odd|even|amplitude|period|phase shift|compose|composition|area under|area between|average value|mean value|volume|arc length|length of the curve|surface area|gradient|grad|hessian|jacobian|divergence|curl|laplacian|directional derivative|tangent|normal|gram[- ]schmidt|orthonormali[sz]e|span|linearly|lu|qr|svd|singular values?|diagonali[sz]\w*|cholesky|jordan|positive definite|symmetric|orthogonal|adjugate|cofactors?|minors?|curve|simultaneous|general solution|express|subject|vertex|directrix|eccentricity)\b|\+\s*(?:\.\.\.|…)\s*\+|^[a-z]\s*\(\s*[a-z]\s*\(|∫|Σ|∑|∂|\[\[|y'|dy\/dx|[∧∨¬]|^(?=.*[a-z]).*(?:[=<>≤≥≠]|\bequals?\b|\bequal to\b|\b(?:greater|less|more) than\b)|^\s*[([<⟨]\s*-?[\d.]+\s*,.*[)\]>⟩]\s*[+\-·×x]\s*[([<⟨]|^\s*[|‖]\s*[([<⟨]/i;
