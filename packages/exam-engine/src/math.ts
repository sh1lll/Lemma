/**
 * Thin layer over Lemma's engines: evaluate numbers (math-core), solve a question (practice-engine
 * `worked` plus a few exam-specific forms computed with math-core), and describe/compare answers.
 */
import { calculate, compileFloat, createSession, freeNames, parseInput, type Session } from '@lemma/math-core';
import { check, worked, type AnswerKind, type Question, type Step, type Topic } from '@lemma/practice-engine';
import { pretty, toCalc } from './text';

const session: Session = (() => {
  const s = createSession();
  s.angle = 'rad';
  return s;
})();

/**
 * A trailing single letter is a unit only when it is one ("5 m", "12 g", "3 s", "4m^2"); "3x", "6x^2", "7n" are
 * algebra, so "6" must not equal "6x". Glued to the number only m, g and L count as units.
 */
function variableNotUnit(tail: string): boolean {
  const m = /^(\s*)([a-zA-Z])(?:\^?[0-9²³]+)?\.?\s*$/.exec(tail);
  if (!m) return false;
  return m[1] ? !/[mgsLhdKNJWVA]/.test(m[2]!) : !/[mgL]/.test(m[2]!);
}

/** Exact numeric value of a plain number/arithmetic string ("5/8", "2^-3", "$2,315.25", "4π", "1 1/2"), or null. */
export function evalNumber(raw: string): number | null {
  let s = toCalc(raw)
    .trim()
    .replace(/^(?:[a-zA-Z]\s*(?:\(\s*[a-z0-9]+\s*\))?\s*=\s*)/, '')
    .replace(/\$/g, '')
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/\s*(?:[a-zA-Z°µ][a-zA-Z°²³^0-9/]*)\.?\s*$/, (m) => (/^\s*(?:pi|e)\s*$/i.test(m) || variableNotUnit(m) ? m : ''))
    .replace(/[.]\s*$/, '')
    .trim();
  if (!s) return null;
  const mixed = /^(-)?(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (mixed) {
    const v = Number(mixed[2]) + Number(mixed[3]) / Number(mixed[4]);
    return mixed[1] ? -v : v;
  }
  if (!/^[\d\s.+\-*/^()pie√sqrt]+$/i.test(s)) return null;
  s = s.replace(/√\s*(\d+(?:\.\d+)?)/g, 'sqrt($1)');
  const r = calculate(s, session);
  if (!r.ok || r.definition || r.assignment) return null;
  const v = r.value.toNumber();
  return Number.isFinite(v) ? v : null;
}

export const near = (a: number, b: number, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));
const isInt = (v: number) => Math.abs(v - Math.round(v)) < 1e-9;

/** Best small fraction for v (denominator ≤ maxDen), or null. */
export function fractionOf(v: number, maxDen = 100): { n: number; d: number } | null {
  for (let d = 1; d <= maxDen; d++) {
    const n = Math.round(v * d);
    if (Math.abs(n / d - v) < 1e-9) return { n, d };
  }
  return null;
}

/** Formats a number in the style of a reference display ("5/8", "2.50", "$1,200.00", "−3"). */
export function formatLike(v: number, like: string): string {
  const ref = like.replace(/^[^\d−\-.$]*/, '');
  const neg = v < 0;
  const a = Math.abs(v);
  let body: string;
  const money = /\$/.test(like);
  const dec = /\.(\d+)/.exec(ref)?.[1]?.length ?? 0;
  if (money) body = a.toLocaleString('en-US', { minimumFractionDigits: dec || (isInt(a) ? 0 : 2), maximumFractionDigits: 2 });
  else if (/^\s*[−-]?\d+\s*\/\s*\d+/.test(ref) && !isInt(a)) {
    const f = fractionOf(a, 1000);
    body = f ? `${f.n}/${f.d}` : trimNum(a);
  } else if (dec > 0) body = a.toFixed(dec);
  else body = isInt(a) ? String(Math.round(a)) : String(Number(a.toFixed(4)));
  if (/,/.test(like) && !money && isInt(a)) body = Math.round(a).toLocaleString('en-US');
  return `${neg ? '−' : ''}${money ? '$' : ''}${body}`;
}

export function trimNum(v: number): string {
  if (isInt(v)) return String(Math.round(v));
  const f = fractionOf(v, 12);
  if (f) return `${f.n}/${f.d}`;
  return String(Number(v.toFixed(4)));
}

/** Kind of a key as practice-engine's checker understands it. */
export function answerKind(display: string): AnswerKind {
  const d = display.trim();
  if (/\bor\b/i.test(d) && /\d/.test(d) && !/[a-wz]\s*\^/i.test(d.replace(/\bor\b/gi, ''))) return 'set';
  if (/\bx\s*=.*,\s*y\s*=|^\(\s*[−\-\d./]+\s*,\s*[−\-\d./]+\s*\)$/.test(d)) return 'pair';
  if (evalNumber(d) !== null) return 'number';
  return 'expression';
}

/** A practice-engine Question shell so its checker can grade any key. */
export function keyQuestion(display: string, prompt = '', topic: Topic = 'arithmetic'): Question {
  const kind = answerKind(display);
  return {
    id: 'key',
    topic: /\+\s*C\b/.test(display) ? 'integral' : topic,
    difficulty: 1,
    prompt,
    answer: { display, kind },
    steps: [],
    hint: '',
    seed: 0,
  };
}

/** Does `user` match `key` under Lemma's checker (equivalent forms accepted)? Never throws. */
export function matches(key: string, user: string, prompt = ''): { correct: boolean; feedback: string } {
  try {
    const r = check(keyQuestion(key, prompt), user);
    return { correct: r.correct, feedback: r.feedback };
  } catch {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '').replace(/−/g, '-');
    const ok = norm(key) === norm(user);
    return { correct: ok, feedback: ok ? 'Correct.' : `The key says ${key}.` };
  }
}

/** True when the key can be graded by machine (it parses as a number/set/pair/expression). */
export function gradable(key: string): boolean {
  try {
    return check(keyQuestion(key), key).correct;
  } catch {
    return false;
  }
}

// ---------- expressions ----------

const SAMPLES = [0.7, 1.3, 1.9, 0.45, 2.6, 1.1];

/** Compiles an expression in x for numeric sampling, or null. */
export function compileX(raw: string): ((x: number) => number) | null {
  let s = toCalc(raw).replace(/\+\s*C\b/g, '').trim();
  const eq = s.split('=');
  if (eq.length === 2 && /^[\sa-zA-Z'′()]*$/.test(eq[0]!)) s = eq[1]!;
  s = s.replace(/(\d)\s*x\s*\(/g, '$1*x*(').replace(/x(?=(?:e\^|sin|cos|tan|ln|log|sqrt|exp))/g, 'x ');
  try {
    const ast = parseInput(s, session);
    if (freeNames(ast).some((n) => n !== 'x')) return null;
    const f = compileFloat(ast, { angle: 'rad', free: new Set(['x']) });
    return (x: number) => f({ x });
  } catch {
    return null;
  }
}

/** Values at the sample points (for equivalence tests). */
export function samples(raw: string): number[] | null {
  const f = compileX(raw);
  if (!f) return null;
  const v = SAMPLES.map((x) => f(x));
  return v.every(Number.isFinite) ? v : null;
}

/** Two expressions are equivalent (optionally up to an additive constant). */
export function sameExpression(a: string, b: string, upToConstant = false): boolean {
  const A = samples(a), B = samples(b);
  if (!A || !B) return false;
  const d = A.map((v, i) => v - B[i]!);
  const tol = 1e-7 * Math.max(1, ...A.map(Math.abs));
  return upToConstant ? d.every((x) => Math.abs(x - d[0]!) <= tol) : d.every((x) => Math.abs(x) <= tol);
}

// ---------- solving ----------

export interface Solved {
  answer: string;
  steps: Step[];
  tex?: string;
}

/** Pulls the math statements out of a prompt, most specific first, for `worked`. */
export function mathCandidates(prompt: string): string[] {
  const p = prompt.replace(/\s+/g, ' ').trim();
  const out: string[] = [p];
  const sentences = p.split(/(?<=[.?!])\s+(?=[A-Z$])/);
  // Instruction sentences that would confuse the solvers.
  const core = sentences.filter((s) => !/^(?:show|explain|justify|simplify your|give your|write your|box|circle|use the|leave your|express your|no calculator)/i.test(s.trim()));
  if (core.length && core.length < sentences.length) out.push(core.join(' '));
  for (const s of sentences) out.push(s);
  const afterColon = /:\s*(.+)$/.exec(p)?.[1];
  if (afterColon) out.push(afterColon);
  const eq = p.match(/[-−\d(a-z][\w\s^+\-−*/×÷().,]*=[\w\s^+\-−*/×÷().]*[\w)]/gi);
  if (eq) for (const e of eq) out.push(e.replace(/^(?:solve|for|of|that|if|when)\s+/gi, '').replace(/\s+by\s+\w+(?:\s+\w+)?$/i, ''));
  // Pure math spans: drop words (keeping function names), join the equations.
  const spans = p
    .replace(/\b(?!(?:sin|cos|tan|ln|log|sqrt|and)\b)[a-z]{2,}\b/gi, '|')
    .split(/\||[.?:;](?=\s|$)/)
    .map((x) => x.trim().replace(/^and\s+|\s+and$/g, ''))
    .filter((x) => /=/.test(x) && /\d/.test(x));
  if (spans.length) {
    out.push(spans.join(' and '));
    for (const sp of spans) out.push(sp);
  }
  const deriv = /(derivative of [^?]+?)(?:[.?]\s|[.?]?$)/i.exec(p)?.[1];
  if (deriv) out.push('Find the ' + deriv);
  return [...new Set(out.map((s) => s.trim()).filter(Boolean))];
}

/** Exam forms the general solver doesn't cover, computed with math-core. */
function extraForms(q: string): Solved | null {
  const s = toCalc(q).replace(/(\d),(?=\d{3}\b)/g, '$1');
  const calc = (e: string) => evalNumber(e);
  // Compound interest: $P invested at r% per year compounded annually, worth after t years.
  let m = /\$\s*([\d.]+)\s+(?:is\s+)?(?:invested|deposited)[^.]*?\bat\s+([\d.]+)\s*%[^.]*?compounded annually[^?]*?after\s+(\d+)\s+years?/i.exec(s);
  if (m) {
    const [P, r, t] = [m[1]!, m[2]!, m[3]!];
    const v = calc(`${P}*(1+${r}/100)^${t}`);
    if (v === null) return null;
    const ans = '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return { answer: ans, steps: [{ text: 'Use A = P(1 + r)^t.', tex: 'A = P(1 + r)^t' }, { text: `A = ${P}(1 + ${Number(r) / 100})^${t} ≈ ${ans}.` }] };
  }
  // Doubling / halving: N doubles every d units; after t units.
  m = /([\d.]+)\s+[a-z ]*?\b(doubles|triples|halves|is cut in half)\s+every\s+([\d.]+)\s+(\w+)[^?]*?after\s+([\d.]+)\s+\4/i.exec(s);
  if (m) {
    const [N, verb, d, , t] = [m[1]!, m[2]!.toLowerCase(), m[3]!, m[4]!, m[5]!];
    const base = verb === 'doubles' ? 2 : verb === 'triples' ? 3 : 0.5;
    const v = calc(`${N}*${base}^(${t}/${d})`);
    if (v === null || !isInt(v)) return null;
    return {
      answer: Math.round(v).toLocaleString('en-US'),
      steps: [{ text: `The amount is multiplied by ${base} every ${d}; ${t}/${d} = ${Number(t) / Number(d)} periods.` }, { text: `${N} × ${base}^${Number(t) / Number(d)} = ${Math.round(v).toLocaleString('en-US')}.` }],
    };
  }
  // Plain arithmetic: "Evaluate 2^-3", "What is (3 + 4)^2?"
  m = /^(?:evaluate|compute|calculate|simplify|find|what is)?\s*:?\s*([\d\s.+\-*/^()√]+?)\s*[?.]?\s*$/i.exec(s.trim());
  if (m && /\d/.test(m[1]!) && /[+\-*/^√]/.test(m[1]!.trim().replace(/^-/, ''))) {
    const v = calc(m[1]!);
    if (v === null) return null;
    const f = fractionOf(v, 1000);
    const ans = isInt(v) ? String(Math.round(v)) : f ? `${f.n}/${f.d}` : String(Number(v.toFixed(6)));
    return { answer: pretty(ans), steps: [{ text: `Evaluate ${pretty(m[1]!.trim())} using the order of operations.` }, { text: `= ${pretty(ans)}` }] };
  }
  // Function value: "f(x) = 2x + 1 ... f(3)" / "h(t) = ..., find h(2)"
  m = /\b([a-zA-Z])\(([a-z])\)\s*=\s*([^,;]+?)(?:[,;.]|\s+find|\s+what|\s+evaluate|$)[^]*?\b\1\(\s*([−\-]?\d+(?:\.\d+)?)\s*\)/.exec(s);
  if (m) {
    const [, fn, v, body, arg] = m as unknown as [string, string, string, string, string];
    const expr = body.replace(new RegExp(`(\\d)\\s*${v}`, 'g'), `$1*(${arg})`).replace(new RegExp(`\\b${v}\\b`, 'g'), `(${arg})`);
    const val = calc(expr);
    if (val === null) return null;
    const ans = trimNum(val);
    return { answer: pretty(ans), steps: [{ text: `Substitute ${v} = ${arg} into ${fn}(${v}).` }, { text: `${fn}(${arg}) = ${pretty(ans)}` }] };
  }
  return null;
}

/** Solves a question with Lemma, or null when it can't be done with confidence. */
export function solve(prompt: string): Solved | null {
  for (const c of mathCandidates(prompt)) {
    const w = worked(c);
    if (w) return { answer: w.answer.display, steps: w.steps, tex: w.answer.tex };
    const x = extraForms(c);
    if (x) return x;
  }
  return null;
}
