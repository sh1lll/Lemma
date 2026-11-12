/**
 * Finds spoken math in a sentence ("a squared plus b squared equals c squared") and turns it into an
 * expression Lemma's parser accepts. Vocabulary is handled by math-core's own natural-language
 * normaliser; this module only finds the span around a pivot ("equals", "is") and keeps spans that parse.
 */
import { calculate, createSession, lex, normalize, parse, type Node } from '@lemma/math-core';

export interface Formula {
  /** The words as spoken, e.g. "f of x equals three x plus two". */
  spoken: string;
  /** Parser-ready form, e.g. "f(x) = 3x + 2". Each side of "=" parses with math-core. */
  expression: string;
  /** LaTeX, when every part of the expression has a simple TeX rendering. */
  tex?: string;
}

const NUMBER_WORDS = new Set(
  (
    'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen ' +
    'twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion half halves third thirds quarter quarters'
  ).split(' '),
);
const GREEK = new Set(['alpha', 'beta', 'gamma', 'delta', 'theta', 'lambda', 'mu', 'sigma', 'rho', 'omega', 'epsilon', 'phi', 'pi', 'tau']);
/** Operator vocabulary that math-core's normaliser understands. */
const OP_WORDS = new Set([
  'plus', 'minus', 'times', 'over', 'divided', 'multiplied', 'squared', 'cubed', 'power', 'raised',
  'sqrt', 'sine', 'sin', 'cosine', 'cos', 'tangent', 'tan', 'log', 'ln', 'logarithm', 'negative', 'factorial',
  'mod', 'modulo', '+', '-', '*', '/', '^', '(', ')',
]);
const ORDINALS: Record<string, number> = { fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
/** Named quantities that read as variables when an operator is next to them: "one half times base times height". */
const QUANTITIES = new Set(['base', 'height', 'width', 'length', 'radius', 'diameter', 'area', 'perimeter', 'volume', 'rate', 'time', 'distance', 'speed', 'velocity', 'mass', 'force', 'acceleration', 'principal', 'side']);
/** Words that operate on what follows; "of" is math right after them. */
const OF_TAKERS = new Set(['root', 'sine', 'sin', 'cosine', 'cos', 'tangent', 'tan', 'log', 'logarithm', 'ln', 'value', 'power', 'factorial']);
const THE_BEFORE = new Set(['square', 'cube', 'power', 'sine', 'cosine', 'tangent', 'log', 'natural', 'quantity', 'absolute']);
const FN_LETTERS = new Set(['f', 'g', 'h', 'p']);
const ALL_OPS = new Set(['over', 'squared', 'divided', 'times', 'cubed']);
const BINARY_WORDS = new Set(['plus', 'minus', 'times', 'over', 'divided', 'multiplied', 'equals', 'is', 'squared', 'cubed', 'to', '=', '+', '-', '*', '/', '^']);
const NEXT_TO_OP = new Set(['plus', 'minus', 'times', 'over', '+', '-', '*', '/']);
const DETERMINERS = new Set(['the', 'a', 'an', 'our', 'its', 'their', 'your']);
const NOT_NAMES = new Set(['answer', 'result', 'thing', 'idea', 'point', 'reason', 'question', 'problem', 'trick', 'goal', 'rule', 'same', 'one', 'way', 'difference', 'number', 'value', 'inside', 'outside', 'mistake']);
const SUBSCRIPTS: Record<string, string> = { zero: '0', naught: '0', nought: '0', one: '1', two: '2', three: '3' };

const TOKEN_RE = /[a-z]+(?:'[a-z]+)?|\d+(?:\.\d+)?|[=+*/^(),-]/g;

function isNum(w: string | undefined): boolean {
  return w !== undefined && (/^\d/.test(w) || NUMBER_WORDS.has(w));
}

function isVar(t: string[], k: number): boolean {
  const w = t[k];
  if (w === undefined) return false;
  if (GREEK.has(w)) return true;
  if (QUANTITIES.has(w)) return NEXT_TO_OP.has(t[k + 1] ?? '') || NEXT_TO_OP.has(t[k - 1] ?? '');
  if (w.length !== 1 || !/[a-z]/.test(w) || w === 'i') return false;
  if (w !== 'a') return true;
  // "a" is the article unless it sits next to an operator ("a squared plus b squared")
  // or in a product of letters after a number ("one half a b").
  const next = t[k + 1] ?? '';
  if (next.length === 1 && /[b-hj-z]/.test(next) && (isNum(t[k - 1]) || NEXT_TO_OP.has(t[k - 1] ?? ''))) return true;
  return BINARY_WORDS.has(next) || NEXT_TO_OP.has(t[k - 1] ?? '');
}

function isMath(t: string[], k: number): boolean {
  const w = t[k];
  if (w === undefined) return false;
  if (isNum(w) || isVar(t, k) || OP_WORDS.has(w)) return true;
  const prev = t[k - 1] ?? '';
  const next = t[k + 1] ?? '';
  switch (w) {
    case ',':
      // A comma ends a spoken formula unless the next words regroup it: "x minus mu, all over sigma".
      return next === 'all' || NEXT_TO_OP.has(next);
    case 'by':
      return prev === 'divided' || prev === 'multiplied';
    case 'of':
      return OF_TAKERS.has(prev) || (FN_LETTERS.has(prev) && (isVar(t, k + 1) || isNum(next) || FN_LETTERS.has(next)));
    case 'the':
      return THE_BEFORE.has(next) || (prev === 'to' && (next === 'power' || isNum(next) || next in ORDINALS || /^\d+(?:st|nd|rd|th)$/.test(next) || isVar(t, k + 1)));
    case 'to':
      return next === 'the' || prev === 'raised' || prev === 'equal';
    case 'square':
    case 'cube':
      return next === 'root';
    case 'root':
      return prev === 'square' || prev === 'cube' || prev in ORDINALS;
    case 'natural':
      return next === 'log' || next === 'logarithm';
    case 'absolute':
      return next === 'value';
    case 'quantity':
      return prev === 'the';
    case 'point':
      return isNum(prev) && isNum(next);
    case 'all':
      return ALL_OPS.has(next);
    case 'value':
      return prev === 'absolute';
    case 'open':
    case 'close':
      return next === 'paren' || next === 'parenthesis' || next === 'bracket';
    case 'paren':
    case 'parenthesis':
    case 'bracket':
      return prev === 'open' || prev === 'close';
    default:
      if (w in ORDINALS) return prev === 'the' && t[k - 2] === 'to';
      return /^\d+(?:st|nd|rd|th)$/.test(w) && (prev === 'the' || next === 'power' || next === 'root');
  }
}

/** Pivots: [length in tokens] when tokens[k…] read as "equals". */
function pivotAt(t: string[], k: number): number {
  const w = t[k];
  if (w === 'equals' || w === '=' || w === 'equal') return 1;
  if (w === 'is' && t[k + 1] === 'equal' && t[k + 2] === 'to') return 3;
  if (w === 'is' || w === 'gives') return 1;
  return 0;
}

/**
 * Rewrites that math-core's normaliser does not do (or does differently) for lecture speech:
 * "f of x plus h" → f(x + h), "x minus mu, all over sigma" → (x − mu)/sigma, "x two" → x2 (subscripts),
 * a leading "square root of" covers the rest of the side, "to the n minus one" → ^(n − 1).
 */
function prepare(words0: string[]): string {
  const words = words0.filter((w) => w !== ',' && w !== 'quantity');
  // Subscripts only when a letter appears with numeric suffixes more than once ("x two minus x one").
  const subCount = new Map<string, number>();
  for (let k = 0; k + 1 < words.length; k++) {
    const w = words[k]!;
    if (w.length === 1 && /[a-z]/.test(w) && words[k + 1]! in SUBSCRIPTS) subCount.set(w, (subCount.get(w) ?? 0) + 1);
  }
  const out: string[] = [];
  let closers = 0;
  let groupStart = 0;
  for (let k = 0; k < words.length; k++) {
    const w = words[k]!;
    const next = words[k + 1];
    if (w === 'all' && next && ALL_OPS.has(next)) {
      if (out.length - groupStart >= 2) {
        out.splice(groupStart, 0, '(');
        out.push(')');
      }
      out.push(next);
      k++;
      // After "…, all squared plus …" the next group starts behind the following operator.
      groupStart = out.length + (next === 'squared' || next === 'cubed' ? 1 : 0);
      continue;
    }
    if ((w === 'square' || w === 'cube') && next === 'root') {
      const first = out.length === 0 || (out.length === 1 && out[0] === 'the');
      if (first) out.length = 0;
      out.push(w === 'square' ? 'sqrt' : 'cbrt');
      k += words[k + 2] === 'of' ? 2 : 1;
      if (first) {
        out.push('(');
        closers++;
        groupStart = out.length;
      }
      continue;
    }
    if (FN_LETTERS.has(w) && next === 'of' && words[k + 2]) {
      out.push(w, '(');
      closers++;
      k++;
      groupStart = out.length;
      continue;
    }
    if (w === 'to' && next === 'the' && words[k + 2]) {
      const e = words[k + 2]!;
      const ord = ORDINALS[e];
      if (ord !== undefined) {
        out.push('^', String(ord));
        k += 2;
        continue;
      }
      if (e.length === 1 && /[a-z]/.test(e) && (words[k + 3] === 'minus' || words[k + 3] === 'plus') && isNum(words[k + 4]) && words[k + 4] !== 'point') {
        out.push('^', '(', e, words[k + 3]!, words[k + 4]!, ')');
        k += 4;
        continue;
      }
      if ((e.length === 1 && /[a-z]/.test(e)) || /^\d+$/.test(e)) {
        out.push('^', e);
        k += 2;
        continue;
      }
    }
    if (w.length === 1 && (subCount.get(w) ?? 0) >= 2 && next && next in SUBSCRIPTS) {
      out.push(`${w}${SUBSCRIPTS[next]}`);
      k++;
      continue;
    }
    out.push(w);
  }
  for (let c = 0; c < closers; c++) out.push(')');
  let s = out.join(' ');
  s = s.replace(/^(?:minus|negative)\b/, '-').replace(/\s*\(\s*/g, ' ( ').replace(/\s*\)\s*/g, ' ) ');
  return s.replace(/\s+/g, ' ').trim();
}

/** Implicit products that came from "f of …" and should print as calls. */
const CALLS = new WeakSet<Node>();

function markCalls(root: Node, fns: Set<string>): void {
  if (!fns.size) return;
  const stack: Node[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.type === 'binary') {
      if (n.op === '*' && n.implicit && n.left.type === 'name' && fns.has(n.left.name)) CALLS.add(n);
      stack.push(n.left, n.right);
    } else if (n.type === 'neg' || n.type === 'factorial' || n.type === 'degree') stack.push(n.arg);
    else if (n.type === 'call') stack.push(...n.args);
  }
}

/** Parses one side; null when math-core rejects it or it contains readings we do not want here. */
function parseSide(words: string[]): Node | null {
  if (!words.length) return null;
  try {
    const norm = normalize(prepare(words));
    const { ast } = parse(lex(norm.text));
    if (!acceptable(ast)) return null;
    const fns = new Set<string>();
    for (let k = 0; k + 1 < words.length; k++) if (FN_LETTERS.has(words[k]!) && words[k + 1] === 'of') fns.add(words[k]!);
    markCalls(ast, fns);
    return ast;
  } catch {
    return null;
  }
}

/** Shrinks a run from its open end until it parses (Whisper runs often end on a dangling "plus"). */
function bestSide(words: string[], fromLeft: boolean): { node: Node; used: number } | null {
  for (let n = words.length; n > 0 && words.length - n <= 6; n--) {
    const part = fromLeft ? words.slice(words.length - n) : words.slice(0, n);
    const node = parseSide(part);
    if (node) return { node, used: n };
  }
  return null;
}

/** Rejects readings that only arise from ordinary words: "it" → ans, a stray "of" → percentage-of. */
function acceptable(root: Node): boolean {
  const stack: Node[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    switch (n.type) {
      case 'name':
        if (n.name === 'ans') return false;
        break;
      case 'percent':
      case 'of':
      case 'off':
      case 'assign':
      case 'define':
        return false;
      case 'neg':
      case 'degree':
      case 'factorial':
        stack.push(n.arg);
        break;
      case 'binary':
        stack.push(n.left, n.right);
        break;
      case 'call':
        if (!n.args.length) return false;
        stack.push(...n.args);
        break;
    }
  }
  return true;
}

function hasOperator(n: Node): boolean {
  return n.type !== 'num' && n.type !== 'name';
}

/** Extracts every formula in one sentence. */
export function findFormulas(sentence: string): Formula[] {
  const t = sentence.toLowerCase().replace(/[’']/g, "'").match(TOKEN_RE) ?? [];
  const out: Formula[] = [];
  let consumed = 0;
  for (let p = 0; p < t.length; p++) {
    const plen = pivotAt(t, p);
    if (!plen || p < consumed) continue;
    let a = p;
    while (a > consumed && isMath(t, a - 1)) a--;
    let b = p + plen;
    while (b < t.length && isMath(t, b) && !pivotAt(t, b)) b++;
    const rhsWords = t.slice(p + plen, b);
    const rhs = bestSide(rhsWords, false);
    if (!rhs) continue;
    const rhsEnd = p + plen + rhs.used;
    // "f prime of x" has no parser form; a run cut short by "prime" is only half a formula.
    if (t[rhsEnd] === 'prime' || t[a - 1] === 'prime') continue;

    let lhsWords = t.slice(a, p);
    let derivative = false;
    let named: string | null = null;
    // "the derivative of x squared is two x"
    if (t[a - 1] === 'of' && t[a - 2] === 'derivative') {
      derivative = true;
      a -= t[a - 3] === 'the' ? 3 : 2;
    }
    // "f of x equals …" defines a function.
    const fnDef = !derivative && lhsWords.length >= 3 ? fnHead(lhsWords.slice(-3)) : null;
    if (fnDef) {
      const expression = `${fnDef} = ${ascii(rhs.node)}`;
      if (!validates(expression)) continue;
      const r = tex(rhs.node);
      const spoken = sentenceSlice(t, p - 3, rhsEnd);
      out.push(r !== null ? { spoken, expression, tex: `${fnDef} = ${r}` } : { spoken, expression });
      consumed = rhsEnd;
      continue;
    }
    const lhs = lhsWords.length ? bestSide(lhsWords, true) : null;
    if (lhs) {
      if (!derivative) a = p - lhs.used;
    } else if (!derivative) {
      // "the z score equals …", "the area of a circle is …": a named quantity on the left.
      const q = quantityName(t, p);
      if (!q) continue;
      named = q.name;
      a = q.start;
    } else continue;
    if (lhs) lhsWords = lhsWords.slice(lhsWords.length - lhs.used);

    const lhsNode = lhs?.node ?? null;
    if (!derivative && !hasOperator(rhs.node) && (!lhsNode || !hasOperator(lhsNode))) continue;
    if (named && !hasOperator(rhs.node)) continue;

    const rhsA = ascii(rhs.node);
    const rhsT = tex(rhs.node);
    let expression: string;
    let texForm: string | null;
    if (derivative && lhsNode) {
      expression = `d/dx(${ascii(lhsNode)}) = ${rhsA}`;
      const l = tex(lhsNode);
      texForm = l !== null && rhsT !== null ? `\\frac{d}{dx}\\left(${l}\\right) = ${rhsT}` : null;
    } else if (lhsNode) {
      expression = `${ascii(lhsNode)} = ${rhsA}`;
      const l = tex(lhsNode);
      texForm = l !== null && rhsT !== null ? `${l} = ${rhsT}` : null;
    } else {
      expression = `${named} = ${rhsA}`;
      texForm = rhsT !== null ? `${texName(named!)} = ${rhsT}` : null;
    }
    if (!validates(expression)) continue;
    const spoken = sentenceSlice(t, Math.max(0, a), rhsEnd);
    out.push(texForm ? { spoken, expression, tex: texForm } : { spoken, expression });
    consumed = rhsEnd;
  }
  return out;
}

function fnHead(w: string[]): string | null {
  const [f, of, v] = w;
  if (!f || !v || of !== 'of' || !FN_LETTERS.has(f) || v.length !== 1 || !/[a-z]/.test(v) || v === 'i') return null;
  return `${f}(${v})`;
}

function quantityName(t: string[], p: number): { name: string; start: number } | null {
  const nouns: string[] = [];
  let k = p - 1;
  while (k >= 0 && nouns.length < 3 && !DETERMINERS.has(t[k]!) && /^[a-z]+$/.test(t[k]!)) nouns.unshift(t[k--]!);
  if (!nouns.length || !DETERMINERS.has(t[k] ?? '')) return null;
  // "the area of a circle" → area
  if (t[k - 1] === 'of') {
    const outer: string[] = [];
    let j = k - 2;
    while (j >= 0 && outer.length < 3 && !DETERMINERS.has(t[j]!) && /^[a-z]+$/.test(t[j]!)) outer.unshift(t[j--]!);
    if (outer.length && DETERMINERS.has(t[j] ?? '')) {
      const last = outer[outer.length - 1]!;
      if (NOT_NAMES.has(last)) return null;
      return { name: outer.join('_'), start: j };
    }
  }
  if (nouns.some((w) => NOT_NAMES.has(w) || ['this', 'that', 'it', 'which', 'there', 'what', 'here', 'so'].includes(w))) return null;
  return { name: nouns.join('_'), start: k };
}

function sentenceSlice(t: string[], a: number, b: number): string {
  return t.slice(a, b).join(' ').replace(/ ,/g, ',').replace(/\s+([)^])/g, '$1').replace(/([(^])\s+/g, '$1');
}

/** Every side of the expression must parse with math-core. */
function validates(expression: string): boolean {
  try {
    if (/^[a-z]\([a-z]\) = /.test(expression)) {
      parse(lex(expression));
      return true;
    }
    const sides = expression.split(' = ');
    for (const s of sides) parse(lex(s));
    // Pure arithmetic must be true. Unpunctuated speech glues a list onto a sum: "the mean of 2 4 and 9 is 15
    // divided by 3" is not "9 = 15 / 3".
    if (sides.length === 2 && !/[a-z]/i.test(sides.join(' ').replace(/\b(?:sqrt|pi)\b/g, ''))) {
      const l = calculate(sides[0]!, numericSession), r = calculate(sides[1]!, numericSession);
      if (!l.ok || !r.ok) return false;
      const x = l.value.toNumber(), y = r.value.toNumber();
      if (!(Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y)))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

const numericSession = createSession();

// ── Printers ────────────────────────────────────────────────────────────────

const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, mod: 2, '^': 4 };

/** ASCII form the lexer accepts (math-core's own printer emits × ÷ − √, which it does not lex). */
export function ascii(n: Node, parent = 0): string {
  switch (n.type) {
    case 'num':
      return n.value;
    case 'name':
      return n.name;
    case 'neg': {
      const s = `-${ascii(n.arg, 3)}`;
      return parent > 1 ? `(${s})` : s;
    }
    case 'percent':
      return `${ascii(n.arg, 5)}%`;
    case 'degree':
      return `${ascii(n.arg, 5)}°`;
    case 'factorial':
      return `${ascii(n.arg, 5)}!`;
    case 'of':
    case 'off':
      return `${ascii(n.left, 2)} ${n.type} ${ascii(n.right, 3)}`;
    case 'binary': {
      const p = PREC[n.op]!;
      let s: string;
      if (n.op === '^') s = `${ascii(n.left, 5)}^${ascii(n.right, 4)}`;
      else if (CALLS.has(n)) return `${ascii(n.left)}(${ascii(n.right)})`;
      else if (n.op === '*' && n.implicit) {
        const l = ascii(n.left, 2);
        const r = ascii(n.right, 3);
        s = /\d$/.test(l) && /^[a-z(]/i.test(r) ? `${l}${r}` : `${l} ${r}`;
      } else s = `${ascii(n.left, p)} ${n.op} ${ascii(n.right, p + 1)}`;
      return p < parent ? `(${s})` : s;
    }
    case 'call':
      return `${n.name}(${n.args.map((a) => ascii(a)).join(', ')})`;
    case 'assign':
      return `${n.name} = ${ascii(n.value)}`;
    case 'define':
      return `${n.name}(${n.params.join(', ')}) = ${ascii(n.body)}`;
  }
}

const TEX_FN: Record<string, string> = { sin: '\\sin', cos: '\\cos', tan: '\\tan', ln: '\\ln', log: '\\log', exp: '\\exp' };

function texName(name: string): string {
  if (GREEK.has(name)) return `\\${name}`;
  if (name.length === 1) return name;
  if (/^[a-z]\d+$/.test(name)) return `${name[0]}_{${name.slice(1)}}`;
  return `\\text{${name.replace(/_/g, ' ')}}`;
}

/** LaTeX for the common shapes; null when a node has no simple rendering. */
export function tex(n: Node, parent = 0): string | null {
  switch (n.type) {
    case 'num':
      return n.value;
    case 'name':
      return texName(n.name);
    case 'neg': {
      const a = tex(n.arg, 3);
      if (a === null) return null;
      return parent > 1 ? `\\left(-${a}\\right)` : `-${a}`;
    }
    case 'factorial': {
      const a = tex(n.arg, 5);
      return a === null ? null : `${a}!`;
    }
    case 'degree': {
      const a = tex(n.arg, 5);
      return a === null ? null : `${a}^{\\circ}`;
    }
    case 'binary': {
      if (CALLS.has(n)) {
        const arg = tex(n.right);
        return arg === null ? null : `${texName((n.left as { name: string }).name)}\\left(${arg}\\right)`;
      }
      const l0 = n.op === '/' ? tex(n.left) : n.op === '^' ? tex(n.left, 5) : tex(n.left, PREC[n.op]!);
      const r0 = n.op === '/' || n.op === '^' ? tex(n.right) : tex(n.right, PREC[n.op]! + 1);
      if (l0 === null || r0 === null) return null;
      const p = PREC[n.op]!;
      let s: string;
      if (n.op === '/') s = `\\frac{${l0}}{${r0}}`;
      else if (n.op === '^') s = `${l0}^{${r0}}`;
      else if (n.op === '*') s = n.implicit ? (/^[a-z\\]/i.test(r0) && /[a-z}]$/i.test(l0) ? `${l0} ${r0}` : `${l0}${r0}`) : `${l0} \\cdot ${r0}`;
      else if (n.op === 'mod') s = `${l0} \\bmod ${r0}`;
      else s = `${l0} ${n.op} ${r0}`;
      return p < parent && n.op !== '/' ? `\\left(${s}\\right)` : s;
    }
    case 'call': {
      const args = n.args.map((a) => tex(a));
      if (args.some((a) => a === null) || args.length !== 1) return null;
      const a = args[0]!;
      if (n.name === 'sqrt') return `\\sqrt{${a}}`;
      if (n.name === 'cbrt') return `\\sqrt[3]{${a}}`;
      const root = /^root(\d+)$/.exec(n.name);
      if (root) return `\\sqrt[${root[1]}]{${a}}`;
      if (n.name === 'abs') return `\\left|${a}\\right|`;
      const fn = TEX_FN[n.name];
      if (fn) return `${fn}\\left(${a}\\right)`;
      if (n.name.length === 1) return `${n.name}\\left(${a}\\right)`;
      return null;
    }
    default:
      return null;
  }
}
