/**
 * One worked problem in a common shape (from `worked()` or `generate()`), plus the two things the
 * scripts compute for it with math-core: an independent check line and a picture.
 */
import { calculate, createSession } from '@lemma/math-core';
import { classify, type Question, type Step, type Topic, type Worked } from '@lemma/practice-engine';
import { fmt, speak } from './speak';

export interface Item {
  topic: Topic;
  title: string;
  /** The problem statement, e.g. "Solve 2x + 3 = 11." */
  text: string;
  tex?: string;
  steps: Step[];
  answer: { display: string; tex?: string };
  difficulty?: number;
}

/** A check is a set of comparisons any reader can recompute with math-core. */
export interface CheckPair {
  lhs: string;
  rhs: string;
  /** '=' within `tol` (absolute), or '>=' for an inequality. */
  op?: '=' | '>=';
  tol?: number;
}

export interface CheckLine {
  text: string;
  tex: string;
  say: string;
  pairs: CheckPair[];
}

export interface Picture {
  exprs: string[];
  caption: string;
  xRange?: [number, number];
  yRange?: [number, number];
  mark?: { x: number; y: number; label?: string }[];
  say: string;
}

// ---------- numbers ----------

const session = (() => {
  const s = createSession();
  s.angle = 'rad';
  return s;
})();

/** Display math → math-core syntax. */
export function toCalc(s: string): string {
  return s
    .replace(/−/g, '-')
    .replace(/×|·/g, '*')
    .replace(/÷/g, '/')
    .replace(/√\s*\(/g, 'sqrt(')
    .replace(/√\s*(\d+(?:\.\d+)?)/g, 'sqrt($1)')
    .replace(/π/g, 'pi')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/\|([^|]+)\|/g, 'abs($1)')
    .replace(/,(?=\d{3})/g, '')
    .replace(/(\d)\s*\(/g, '$1*(')
    .replace(/\)\s*(?=[\d(a-z])/g, ')*')
    .replace(/(\d)\s+(?=[a-z(])/g, '$1*')
    .replace(/\b(x|y)\s+(?=[a-z(\d])/g, '$1*')
    .replace(/(\d)\s*pi\b/g, '$1*pi')
    .trim();
}

/** Evaluates a math-core expression to a JS number, or null. */
export function evalNum(expr: string): number | null {
  try {
    const r = calculate(expr, session);
    if (!r.ok) return null;
    const v = r.value.toNumber();
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** Replaces the variables in an expression with bracketed values. */
export function sub(expr: string, vars: Record<string, string>): string {
  let out = expr;
  for (const [k, v] of Object.entries(vars)) out = out.replace(new RegExp(`(?<![a-z])${k}(?![a-z])`, 'g'), `(${v})`);
  return toCalc(out);
}

export const N = (s: string) => Number(s.replace(/,/g, '').replace(/−/g, '-'));

/** Numeric value of one answer part: "x = 9/5" → 1.8, "9π cm²" → 28.27…, "$12.68" → 12.68. */
export function valueOf(part: string): number | null {
  const s = part
    .replace(/^[a-zA-Z]\s*=\s*/, '')
    .replace(/[≈$%]/g, '')
    .replace(/\s*(?:°[CF]|K|[a-zA-Z]+[²³]?(?:\/[a-z]+)?)$/u, '')
    .trim();
  return evalNum(toCalc(s));
}

/** The math-core form of an answer part (exact when possible). */
function calcOf(part: string): string {
  return toCalc(
    part
      .replace(/^[a-zA-Z]\s*=\s*/, '')
      .replace(/[≈$%]/g, '')
      .replace(/\s*(?:°[CF]|[a-zA-Z]+[²³]?(?:\/[a-z]+)?)$/u, '')
      .trim(),
  );
}

const pretty = (s: string) => s.replace(/\*/g, '×').replace(/-/g, '−').replace(/\bpi\b/g, 'π');
const texOf = (s: string) =>
  s
    .replace(/−/g, '-')
    .replace(/×/g, '\\times ')
    .replace(/÷/g, '\\div ')
    .replace(/≈/g, '\\approx ')
    .replace(/π/g, '\\pi ')
    .replace(/√(\d+)/g, '\\sqrt{$1}')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/\^\(([^()]*)\)/g, '^{$1}')
    .replace(/\^(-?\d+)/g, '^{$1}')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/,\s/g, ',\\ ')
    .trim();

const close = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// ---------- building items ----------

const TITLE_TOPICS: [RegExp, Topic][] = [
  [/linear equation/i, 'linear'],
  [/quadratic/i, 'quadratic'],
  [/system/i, 'system'],
  [/derivative/i, 'derivative'],
  [/integral/i, 'integral'],
  [/tip|tax|discount/i, 'money'],
  [/percent/i, 'percent'],
  [/convert/i, 'units'],
  [/mean|median|mode|range|deviation|variance/i, 'stats'],
  [/area|volume|perimeter|circumference|hypotenuse/i, 'geometry'],
  [/fraction/i, 'fractions'],
];

export function fromWorked(w: Worked, query: string): Item {
  const topic = TITLE_TOPICS.find(([re]) => re.test(w.title))?.[1] ?? classify(query) ?? 'arithmetic';
  const item: Item = { topic, title: w.title, text: w.question, steps: w.steps, answer: w.answer };
  if (w.questionTex) item.tex = w.questionTex;
  return item;
}

export function fromQuestion(q: Question): Item {
  const item: Item = { topic: q.topic, title: q.prompt, text: q.prompt, steps: q.steps, answer: { display: q.answer.display }, difficulty: q.difficulty };
  if (q.promptTex) item.tex = q.promptTex;
  if (q.answer.tex) item.answer.tex = q.answer.tex;
  return item;
}

/** The problem with its instruction sentence trimmed ("Give the answer in simplest form."). */
const core = (text: string) => text.replace(/\s*(?:Give the answer in simplest form|Round to [^.]+|Leave your answer in terms of π|Use a negative number for a decrease)\.?/g, '').trim();

const equationOf = (text: string) => core(text).replace(/^Solve\s+/, '').replace(/\.$/, '');

// ---------- checks ----------

function line(text: string, tex: string, pairs: CheckPair[], say?: string): CheckLine {
  return { text, tex, say: say ?? speak(text), pairs };
}

/** Recomputes a check with math-core. Exported for tests and for a final safety net. */
export function verifyCheck(c: CheckLine): boolean {
  return c.pairs.every((p) => {
    const l = evalNum(p.lhs), r = evalNum(p.rhs);
    if (l === null || r === null) return false;
    if (p.op === '>=') return l >= r - 1e-12;
    return close(l, r, p.tol ?? 1e-9 * Math.max(1, Math.abs(r)));
  });
}

const show = (v: number | null, dp = 4) => (v === null ? '?' : fmt(v, dp));

function checkEquation(it: Item): CheckLine | null {
  const eq = equationOf(it.text);
  const [L, R] = eq.split('=').map((s) => s.trim());
  if (!L || !R) return null;
  const parts = it.answer.display.split(/\s+or\s+/);
  const lines: string[] = [];
  const texs: string[] = [];
  const pairs: CheckPair[] = [];
  for (const p of parts) {
    const exact = calcOf(p);
    const v = evalNum(exact);
    if (v === null) return null;
    const isNice = /^[-−]?\d+(?:\/\d+)?$/.test(p.replace(/^x\s*=\s*/, '').trim());
    const shown = isNice ? p.replace(/^x\s*=\s*/, '').trim() : fmt(v, 3);
    const lhs = sub(L, { x: exact }), rhs = sub(R, { x: exact });
    const lv = evalNum(lhs), rv = evalNum(rhs);
    if (lv === null || rv === null) return null;
    const scale = Math.max(1, Math.abs(lv), Math.abs(rv));
    pairs.push({ lhs, rhs, tol: 1e-7 * scale });
    const Ld = pretty(L.replace(/(?<![a-z])x(?![a-z])/g, `(${shown})`));
    const eqSign = isNice ? '=' : '≈';
    if (/^[-−]?\d+(?:\.\d+)?$/.test(R)) {
      lines.push(`x = ${shown}: ${Ld} ${eqSign} ${fmt(lv, 4)}, and the right side is ${R}.`);
      texs.push(`${texOf(Ld)} ${eqSign === '=' ? '=' : '\\approx'} ${texOf(fmt(lv, 4))}`);
    } else {
      const Rd = pretty(R.replace(/(?<![a-z])x(?![a-z])/g, `(${shown})`));
      lines.push(`x = ${shown}: left ${Ld} ${eqSign} ${fmt(lv, 4)}, right ${Rd} ${eqSign} ${fmt(rv, 4)}.`);
      texs.push(`${texOf(Ld)} ${eqSign === '=' ? '=' : '\\approx'} ${texOf(fmt(lv, 4))} ${eqSign === '=' ? '=' : '\\approx'} ${texOf(Rd)}`);
    }
  }
  const text = `Check by substituting back. ${lines.join(' ')} Both sides match.`;
  return line(text, texs.join(',\\quad '), pairs);
}

function checkSystem(it: Item): CheckLine | null {
  const m = /system:\s*(.+?)\s+and\s+(.+?)\.?$/.exec(it.text);
  const a = /x = ([^,]+), y = (.+)$/.exec(it.answer.display);
  if (!m || !a) return null;
  const xs = calcOf(a[1]!), ys = calcOf(a[2]!);
  const pairs: CheckPair[] = [];
  const shown: string[] = [];
  const texs: string[] = [];
  for (const e of [m[1]!, m[2]!]) {
    const [L, R] = e.split('=').map((s) => s.trim());
    if (!L || !R) return null;
    const lhs = sub(L, { x: xs, y: ys }), rhs = sub(R, { x: xs, y: ys });
    const lv = evalNum(lhs);
    if (lv === null) return null;
    pairs.push({ lhs, rhs, tol: 1e-9 * Math.max(1, Math.abs(lv)) });
    const Ld = pretty(L.replace(/(?<![a-z])x(?![a-z])/g, `(${a[1]})`).replace(/(?<![a-z])y(?![a-z])/g, `(${a[2]})`));
    shown.push(`${Ld} = ${fmt(lv)}`);
    texs.push(`${texOf(Ld)} = ${texOf(fmt(lv))}`);
  }
  return line(`Check in both equations: ${shown.join(' and ')}, matching the right-hand sides.`, texs.join(',\\quad '), pairs);
}

function checkExpression(it: Item, label: string): CheckLine | null {
  const m = /^(?:Calculate|Evaluate|Simplify)\s+(.+?)\.?$/.exec(core(it.text));
  if (!m) return null;
  const expr = m[1]!;
  const hasVars = /(?<![a-z])[xy](?![a-z])/.test(expr);
  const vars = { x: '2', y: '3' };
  const lhs = hasVars ? sub(expr, vars) : toCalc(expr);
  const rhs = hasVars ? sub(it.answer.display, vars) : calcOf(it.answer.display);
  const lv = evalNum(lhs), rv = evalNum(rhs);
  if (lv === null || rv === null || !close(lv, rv, 1e-9 * Math.max(1, Math.abs(rv)))) return null;
  const pairs: CheckPair[] = [{ lhs, rhs, tol: 1e-9 * Math.max(1, Math.abs(rv)) }];
  if (hasVars) {
    const usesY = /(?<![a-z])y(?![a-z])/.test(expr);
    const text = `Check by plugging in x = 2${usesY ? ' and y = 3' : ''}: the original gives ${fmt(lv, 4)} and ${it.answer.display} gives ${fmt(rv, 4)}.`;
    return line(text, `x = 2${usesY ? ',\\ y = 3' : ''}:\\ ${texOf(fmt(lv, 4))} = ${texOf(fmt(rv, 4))}`, pairs);
  }
  const approx = Math.abs(lv - Math.round(lv)) > 1e-9;
  const text = `${label}: ${expr} ${approx ? '≈' : '='} ${fmt(lv, 4)}, and ${it.answer.display} ${approx ? '≈' : '='} ${fmt(rv, 4)}.`;
  return line(text, `${texOf(pretty(toCalc(expr)).replace(/\*/g, '×'))} ${approx ? '\\approx' : '='} ${texOf(fmt(lv, 4))}`.replace(/×/g, '\\times '), pairs);
}

function checkPercent(it: Item): CheckLine | null {
  const t = it.text;
  const ans = valueOf(it.answer.display);
  if (ans === null) return null;
  let m: RegExpExecArray | null;
  if ((m = /What is (\d[\d,]*(?:\.\d+)?)% of \$?(\d[\d,]*(?:\.\d+)?)/.exec(t))) {
    const P = N(m[1]!), B = N(m[2]!);
    return line(`Check backwards: ${fmt(ans)} ÷ ${fmt(B)} × 100 = ${fmt((ans / B) * 100)}, so it really is ${fmt(P)}%.`, `\\frac{${fmt(ans)}}{${fmt(B)}} \\times 100 = ${fmt(P)}`, [{ lhs: `${ans}/${B}*100`, rhs: `${P}`, tol: 1e-6 }]);
  }
  if ((m = /(\d[\d,]*(?:\.\d+)?) is what percent of (\d[\d,]*(?:\.\d+)?)/.exec(t))) {
    const A = N(m[1]!), B = N(m[2]!);
    return line(`Check: ${fmt(ans)}% of ${fmt(B)} is ${fmt((ans / 100) * B)}, which matches the ${fmt(A)} we started with.`, `${texOf(fmt(ans))}\\% \\times ${fmt(B)} \\approx ${fmt(A)}`, [{ lhs: `${ans}/100*${B}`, rhs: `${A}`, tol: 0.006 * B / 100 + 1e-9 }]);
  }
  if ((m = /from \$(\d[\d,]*(?:\.\d+)?) to \$(\d[\d,]*(?:\.\d+)?).*percent (increase|decrease)/.exec(t))) {
    const o = N(m[1]!), n = N(m[2]!);
    const sign = m[3] === 'increase' ? '+' : '-';
    const mult = `(1 ${sign} ${ans}/100)`;
    const mv = evalNum(mult)!;
    return line(`Check: ${fmt(o)} × ${fmt(mv)} = ${fmt(o * mv)}, the new price.`, `${fmt(o)} \\times ${fmt(mv)} = ${fmt(n)}`, [{ lhs: `${o}*${mult}`, rhs: `${n}`, tol: 1e-6 }]);
  }
  if ((m = /After a (\d+(?:\.\d+)?)% discount, .* costs \$(\d[\d,]*(?:\.\d+)?)/.exec(t))) {
    const d = N(m[1]!), s = N(m[2]!);
    return line(`Check: ${fmt(d)}% off ${fmt(ans)} is ${fmt(ans)} × ${fmt(1 - d / 100)} = ${fmt(ans * (1 - d / 100))}, the sale price.`, `${fmt(ans)} \\times ${fmt(1 - d / 100)} = ${fmt(s)}`, [{ lhs: `${ans}*(1-${d}/100)`, rhs: `${s}`, tol: 0.006 }]);
  }
  if ((m = /rises (\d+(?:\.\d+)?)% and then falls (\d+(?:\.\d+)?)%/.exec(t))) {
    const a = N(m[1]!), b = N(m[2]!);
    const end = 100 * (1 + a / 100) * (1 - b / 100);
    return line(`Check with a price of 100: up ${fmt(a)}% gives ${fmt(100 + a)}, down ${fmt(b)}% gives ${fmt(end)}, which is ${fmt(end - 100)}% from the start.`, `100 \\times ${fmt(1 + a / 100)} \\times ${fmt(1 - b / 100)} = ${fmt(end)}`, [{ lhs: `100*(1+${a}/100)*(1-${b}/100)`, rhs: `100 + ${ans}`, tol: 1e-6 }]);
  }
  return null;
}

function checkMoney(it: Item): CheckLine | null {
  const t = it.text;
  const ans = valueOf(it.answer.display);
  if (ans === null) return null;
  let m: RegExpExecArray | null;
  if ((m = /total of (?:an? )?\$(\d[\d,]*(?:\.\d+)?)(?: bill)? with (?:an? )?(\d+(?:\.\d+)?)% (tip|tax)/.exec(t))) {
    const B = N(m[1]!), P = N(m[2]!);
    return line(`Check: ${fmt(ans, 2)} ÷ ${fmt(B, 2)} ≈ ${fmt(ans / B, 4)}, which is 1 plus the ${fmt(P)}% ${m[3]}.`, `\\frac{${fmt(ans, 2)}}{${fmt(B, 2)}} \\approx ${fmt(1 + P / 100, 4)}`, [{ lhs: `${ans}/${B}`, rhs: `1 + ${P}/100`, tol: 0.006 / B + 1e-9 }]);
  }
  if ((m = /(\d+(?:\.\d+)?)% (?:tip|tax|sales tax|gratuity) on \$?(\d[\d,]*(?:\.\d+)?)/.exec(t))) {
    const P = N(m[1]!), B = N(m[2]!);
    const ten = B / 10;
    const est = ten * (P / 10);
    return line(
      `Check with the ten percent trick: 10% of $${B.toFixed(2)} is $${ten.toFixed(2)}, and ${fmt(P)}% is ${fmt(P / 10)} of those: ${ten.toFixed(3).replace(/0$/, '')} × ${fmt(P / 10)} = ${fmt(est, 4)}, which rounds to $${ans.toFixed(2)}.`,
      `${fmt(P / 10)} \\times ${texOf(fmt(ten, 3))} \\approx ${ans.toFixed(2)}`,
      [{ lhs: `${B}/10*${P / 10}`, rhs: `${ans}`, tol: 0.006 }],
      `Check with the ten percent trick. Ten percent is easy: just move the decimal point. ${fmt(P)} percent is ${speak(fmt(P / 10))} of those, which comes to about ${speak('$' + ans.toFixed(2))}.`,
    );
  }
  if ((m = /(\d+(?:\.\d+)?)% off (?:of )?\$?(\d[\d,]*(?:\.\d+)?)/.exec(t))) {
    const P = N(m[1]!), B = N(m[2]!);
    const off = (P / 100) * B;
    return line(`Check: the discount is ${fmt(P)}% of ${fmt(B)} = ${fmt(off, 2)}, and ${fmt(ans, 2)} + ${fmt(off, 2)} = ${fmt(ans + off, 2)}, the original price.`, `${fmt(ans, 2)} + ${fmt(off, 2)} = ${fmt(B, 2)}`, [{ lhs: `${ans} + ${P}/100*${B}`, rhs: `${B}`, tol: 0.006 }]);
  }
  if ((m = /\$(\d[\d,]*(?:\.\d+)?) \w+ is (\d+(?:\.\d+)?)% off, and sales tax is (\d+(?:\.\d+)?)%/.exec(t))) {
    const B = N(m[1]!), d = N(m[2]!), tx = N(m[3]!);
    const back = ans / (1 + tx / 100) / (1 - d / 100);
    return line(`Check by undoing it: ${ans.toFixed(2)} ÷ ${fmt(1 + tx / 100)} ÷ ${fmt(1 - d / 100)} ≈ ${back.toFixed(2)}, the starting price.`, `${ans.toFixed(2)} \\div ${fmt(1 + tx / 100)} \\div ${fmt(1 - d / 100)} \\approx ${fmt(B)}`, [{ lhs: `${ans}/(1+${tx}/100)/(1-${d}/100)`, rhs: `${B}`, tol: 0.01 }]);
  }
  if ((m = /\$(\d[\d,]*(?:\.\d+)?) bill gets a (\d+(?:\.\d+)?)% tip and is split evenly among (\d+) people/.exec(t))) {
    const B = N(m[1]!), P = N(m[2]!), n = N(m[3]!);
    return line(`Check: ${n} × $${ans.toFixed(2)} = $${(ans * n).toFixed(2)}, and the bill with tip is ${fmt(B, 2)} × ${fmt(1 + P / 100)} = ${fmt(B * (1 + P / 100), 4)}; they agree to within rounding.`, `${n} \\times ${ans.toFixed(2)} \\approx ${fmt(B * (1 + P / 100), 2)}`, [{ lhs: `${ans}*${n}`, rhs: `${B}*(1+${P}/100)`, tol: 0.006 * n }]);
  }
  if ((m = /\$(\d[\d,]*(?:\.\d+)?) is invested at (\d+(?:\.\d+)?)% per year, compounded monthly.*?after (\d+) years/.exec(t))) {
    const P = N(m[1]!), r = N(m[2]!), y = N(m[3]!);
    const simple = P * (1 + (r / 100) * y);
    return line(
      `Check: simple interest would give ${fmt(P)} × (1 + ${fmt(r / 100)} × ${y}) = ${fmt(simple, 2)}; compounding should give a little more, and ${ans.toFixed(2)} ÷ ${fmt(P)} ≈ ${fmt(ans / P, 5)} is the growth factor.`,
      `${fmt(P)}(1 + ${fmt(r / 100)} \\times ${y}) = ${fmt(simple, 2)} < ${ans.toFixed(2)}`,
      [
        { lhs: `${ans}/${P}`, rhs: `(1+${r}/100/12)^(12*${y})`, tol: 0.006 / P + 1e-9 },
        { lhs: `${ans}`, rhs: `${P}*(1+${r}/100*${y})`, op: '>=' },
      ],
    );
  }
  return checkPercent(it);
}

const SI: [RegExp, number][] = [
  [/^(?:kg|kilograms?)$/, 1],
  [/^(?:g|grams?)$/, 0.001],
  [/^(?:mg|milligrams?)$/, 1e-6],
  [/^(?:lb|lbs|pounds?)$/, 0.45359237],
  [/^(?:oz|ounces?)$/, 0.028349523125],
  [/^(?:m|meters?|metres?)$/, 1],
  [/^(?:km|kilometers?|kilometres?)$/, 1000],
  [/^(?:cm|centimeters?|centimetres?)$/, 0.01],
  [/^(?:mm|millimeters?|millimetres?)$/, 0.001],
  [/^(?:in|inch|inches)$/, 0.0254],
  [/^(?:ft|foot|feet)$/, 0.3048],
  [/^(?:yd|yards?)$/, 0.9144],
  [/^(?:mi|miles?)$/, 1609.344],
  [/^(?:l|liters?|litres?)$/, 1],
  [/^(?:ml|milliliters?|millilitres?)$/, 0.001],
  [/^(?:cm³|cubic centimeters?)$/, 0.001],
  [/^(?:gal|gallons?|us gallons?)$/, 3.785411784],
  [/^(?:qt|quarts?)$/, 0.946352946],
  [/^(?:cups?)$/, 0.2365882365],
  [/^(?:m\/s|meters? per second)$/, 1],
  [/^(?:km\/h|kilometers? per hour)$/, 1000 / 3600],
  [/^(?:mph|miles? per hour)$/, 1609.344 / 3600],
  [/^(?:m²|square meters?)$/, 1],
  [/^(?:cm²|square centimeters?)$/, 0.0001],
  [/^(?:ft²|square feet|square foot)$/, 0.09290304],
];
const siOf = (u: string) => SI.find(([re]) => re.test(u.trim().toLowerCase()))?.[1] ?? null;

function parseConversion(t: string): { v: number; from: string; to: string } | null {
  const m = /^Convert\s+([-−\d.,]+)\s*(.+?)\s+to\s+(.+?)\.(?:\s|$)/.exec(t);
  return m ? { v: N(m[1]!), from: m[2]!, to: m[3]! } : null;
}

function checkUnits(it: Item): CheckLine | null {
  const c = parseConversion(it.text);
  const ans = valueOf(it.answer.display);
  if (!c || ans === null) return null;
  const fromT = /°\s*F|fahrenheit/i.test(c.from) ? 'F' : /°\s*C|celsius/i.test(c.from) ? 'C' : null;
  const toT = /°\s*F|fahrenheit/i.test(c.to) ? 'F' : /°\s*C|celsius/i.test(c.to) ? 'C' : null;
  if (fromT && toT) {
    const back = fromT === 'F' ? `${ans}*9/5+32` : `(${ans}-32)*5/9`;
    const bv = evalNum(back)!;
    return line(
      `Check by converting back: ${fromT === 'F' ? `${fmt(ans)} × 9/5 + 32` : `(${fmt(ans)} − 32) × 5/9`} ≈ ${fmt(bv, 2)}, which is where we started.`,
      `${fromT === 'F' ? `${texOf(fmt(ans))} \\times \\tfrac{9}{5} + 32` : `(${texOf(fmt(ans))} - 32) \\times \\tfrac{5}{9}`} \\approx ${texOf(fmt(bv, 2))}`,
      [{ lhs: back, rhs: `${c.v}`, tol: 0.001 }],
    );
  }
  const a = siOf(c.from), b = siOf(c.to);
  if (a === null || b === null) return null;
  const back = (ans * b) / a;
  const tol = Math.max(1e-9, Math.abs(c.v) * 1e-3, (0.006 * b) / a);
  const big = b > a;
  return line(
    `Check by converting back: ${fmt(ans)} ${c.to} is ${fmt(back, 4)} ${c.from}, which is ${fmt(c.v)} once you allow for rounding. And ${big ? 'a bigger unit means a smaller number' : 'a smaller unit means a bigger number'}, as it should.`,
    `${texOf(fmt(ans))} \\times \\frac{${fmt(b, 6)}}{${fmt(a, 6)}} \\approx ${texOf(fmt(back, 4))}`,
    [{ lhs: `${ans}*${b}/${a}`, rhs: `${c.v}`, tol }],
  );
}

function dataOf(t: string): number[] | null {
  const m = /of\s+([-−\d.,\s]+?)\.?(?:\s+Round|\s*$)/.exec(t);
  if (!m) return null;
  const xs = m[1]!.split(/[\s,]+/).filter(Boolean).map(N);
  return xs.length >= 2 && xs.every(Number.isFinite) ? xs : null;
}

function checkStats(it: Item): CheckLine | null {
  const xs = dataOf(it.text);
  const ans = valueOf(it.answer.display);
  if (!xs || ans === null) return null;
  const n = xs.length;
  const sumExpr = xs.map((x) => (x < 0 ? `(${x})` : `${x}`)).join('+');
  const sum = xs.reduce((a, b) => a + b, 0);
  if (/mean/.test(it.text)) {
    return line(`Check: ${fmt(ans)} × ${n} = ${fmt(ans * n)}, the total of the values. It also sits between the smallest, ${fmt(Math.min(...xs))}, and the largest, ${fmt(Math.max(...xs))}.`, `${texOf(fmt(ans))} \\times ${n} = ${texOf(fmt(sum))}`, [
      { lhs: `${ans}*${n}`, rhs: sumExpr, tol: 0.0001 * n },
    ]);
  }
  if (/median/.test(it.text)) {
    const le = xs.filter((x) => x <= ans).length, ge = xs.filter((x) => x >= ans).length;
    return line(`Check: ${le} of the ${n} values are at or below ${fmt(ans)} and ${ge} are at or above it, so it splits the data in half.`, `${le} \\ge \\tfrac{${n}}{2},\\quad ${ge} \\ge \\tfrac{${n}}{2}`, [
      { lhs: `${le}`, rhs: `${n}/2`, op: '>=' },
      { lhs: `${ge}`, rhs: `${n}/2`, op: '>=' },
    ]);
  }
  if (/mode/.test(it.text)) {
    const counts = new Map<number, number>();
    for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
    const top = counts.get(ans) ?? 0;
    const others = Math.max(0, ...[...counts].filter(([x]) => x !== ans).map(([, c]) => c));
    return line(`Check: ${fmt(ans)} appears ${top} times; no other value appears more than ${others} time${others === 1 ? '' : 's'}.`, `${top} > ${others}`, [{ lhs: `${top}`, rhs: `${others}+1`, op: '>=' }]);
  }
  if (/range/.test(it.text)) {
    const lo = Math.min(...xs), hi = Math.max(...xs);
    return line(`Check: smallest plus range, ${fmt(lo)} + ${fmt(ans)} = ${fmt(lo + ans)}, the largest value.`, `${texOf(fmt(lo))} + ${texOf(fmt(ans))} = ${texOf(fmt(hi))}`, [{ lhs: `${lo}+${ans}`, rhs: `${hi}` }]);
  }
  if (/standard deviation|variance/.test(it.text)) {
    const sample = /sample/.test(it.text);
    const d = sample ? n - 1 : n;
    const mean = `((${sumExpr})/${n})`;
    const varExpr = `(${xs.map((x) => `((${x})-${mean})^2`).join('+')})/${d}`;
    const variance = evalNum(varExpr);
    if (variance === null) return null;
    if (/variance/.test(it.text) && !/standard deviation/.test(it.text)) {
      return line(`Check: the variance should be roughly the typical squared distance from the mean; recomputed, it is ${fmt(variance, 4)}.`, `\\sigma^2 \\approx ${texOf(fmt(variance, 4))}`, [{ lhs: `${ans}`, rhs: varExpr, tol: 0.0001 + 0.001 * variance }]);
    }
    return line(`Check by squaring: ${fmt(ans)}² = ${fmt(ans * ans, 4)}, and the variance recomputed from the data is ${fmt(variance, 4)}; they agree to within rounding.`, `${texOf(fmt(ans))}^2 \\approx ${texOf(fmt(variance, 4))}`, [
      { lhs: `${ans}^2`, rhs: varExpr, tol: 2 * Math.abs(ans) * 0.006 + 1e-4 },
    ]);
  }
  return null;
}

function checkGeometry(it: Item): CheckLine | null {
  const t = it.text.toLowerCase();
  const ansC = calcOf(it.answer.display);
  const ans = evalNum(ansC);
  if (ans === null) return null;
  const num = (re: RegExp) => {
    const m = re.exec(t);
    return m ? N(m[1]!) : null;
  };
  const r = num(/radius (\d+(?:\.\d+)?)/);
  if (/circle/.test(t) && r !== null) {
    if (/area/.test(t)) {
      const box = 4 * r * r;
      return line(`Check: the circle fits inside a square ${fmt(2 * r)} wide, with area ${fmt(box)}. ${it.answer.display} ≈ ${fmt(ans, 2)} is about ${Math.round((ans / box) * 100)}% of that, and a circle always fills π/4 ≈ 79% of its square.`, `\\frac{${texOf(fmt(ans, 2))}}{${fmt(box)}} \\approx \\frac{\\pi}{4}`, [
        { lhs: `(${ansC})/(2*${r})^2`, rhs: 'pi/4', tol: 1e-9 },
      ]);
    }
    return line(`Check: circumference divided by diameter should be π. ${fmt(ans, 2)} ÷ ${fmt(2 * r)} ≈ ${fmt(ans / (2 * r), 4)}.`, `\\frac{${texOf(fmt(ans, 2))}}{${fmt(2 * r)}} \\approx \\pi`, [{ lhs: `(${ansC})/(2*${r})`, rhs: 'pi', tol: 1e-9 }]);
  }
  if (/sphere/.test(t) && r !== null) {
    const box = 8 * r ** 3;
    return line(`Check: a sphere fills a bit over half of the cube around it. That cube holds ${fmt(box)}, and ${fmt(ans, 2)} is ${Math.round((ans / box) * 100)}% of it, matching π/6 ≈ 52%.`, `\\frac{${texOf(fmt(ans, 2))}}{${fmt(box)}} \\approx \\frac{\\pi}{6}`, [{ lhs: `(${ansC})/(2*${r})^3`, rhs: 'pi/6', tol: 1e-9 }]);
  }
  const h = num(/height (\d+(?:\.\d+)?)/);
  if (/(cylinder|cone)/.test(t) && r !== null && h !== null) {
    const cone = /cone/.test(t);
    return line(`Check: ${cone ? 'three times the volume' : 'the volume'} divided by the base area πr² = ${fmt(Math.PI * r * r, 2)} should give the height: ${fmt(((cone ? 3 : 1) * ans) / (Math.PI * r * r), 4)}.`, `\\frac{${cone ? '3 \\times ' : ''}${texOf(fmt(ans, 2))}}{\\pi r^2} = ${fmt(h)}`, [
      { lhs: `${cone ? '3*' : ''}(${ansC})/(pi*${r}^2)`, rhs: `${h}`, tol: 1e-9 * h + 1e-9 },
    ]);
  }
  const approx = /≈/.test(it.answer.display);
  let m: RegExpExecArray | null;
  if ((m = /legs (\d+(?:\.\d+)?)(?: [a-z]+)? and (\d+(?:\.\d+)?)/.exec(t))) {
    const a = N(m[1]!), b = N(m[2]!);
    return line(`Check: ${fmt(ans)}² ${approx ? '≈' : '='} ${fmt(ans * ans, 2)}, and ${fmt(a)}² + ${fmt(b)}² = ${fmt(a * a + b * b)}. The hypotenuse is also longer than both legs, as it must be.`, `${texOf(fmt(ans))}^2 ${approx ? '\\approx' : '='} ${fmt(a)}^2 + ${fmt(b)}^2`, [
      { lhs: `${ans}^2`, rhs: `${a}^2+${b}^2`, tol: approx ? 2 * ans * 0.006 : 1e-9 * ans * ans },
      { lhs: `${ans}`, rhs: `${Math.max(a, b)}`, op: '>=' },
    ]);
  }
  if ((m = /hypotenuse (\d+(?:\.\d+)?)(?: [a-z]+)? and one leg (\d+(?:\.\d+)?)/.exec(t))) {
    const c = N(m[1]!), a = N(m[2]!);
    return line(`Check: ${fmt(a)}² + ${fmt(ans)}² = ${fmt(a * a + ans * ans)} = ${fmt(c)}².`, `${fmt(a)}^2 + ${texOf(fmt(ans))}^2 = ${fmt(c)}^2`, [{ lhs: `${a}^2+${ans}^2`, rhs: `${c}^2`, tol: 1e-6 * c * c }]);
  }
  const rect = /rectangle is (\d+(?:\.\d+)?) [a-z]+ long and (\d+(?:\.\d+)?)/.exec(t) ?? /(\d+(?:\.\d+)?)(?: [a-z]+)? by (\d+(?:\.\d+)?)(?: [a-z]+)? rectangle/.exec(t);
  const sq = /square with side (\d+(?:\.\d+)?)/.exec(t);
  if (rect || sq) {
    const l = N((rect ?? sq)![1]!), w = rect ? N(rect[2]!) : l;
    if (/area/.test(t)) return line(`Check: ${fmt(ans)} ÷ ${fmt(l)} = ${fmt(ans / l)}, the width.`, `${texOf(fmt(ans))} \\div ${fmt(l)} = ${fmt(w)}`, [{ lhs: `${ans}/${l}`, rhs: `${w}` }]);
    return line(`Check: half the perimeter is one length plus one width: ${fmt(ans)} ÷ 2 = ${fmt(ans / 2)} = ${fmt(l)} + ${fmt(w)}.`, `\\tfrac{${texOf(fmt(ans))}}{2} = ${fmt(l)} + ${fmt(w)}`, [{ lhs: `${ans}/2`, rhs: `${l}+${w}` }]);
  }
  if ((m = /base (\d+(?:\.\d+)?).*height (\d+(?:\.\d+)?)/.exec(t))) {
    const b = N(m[1]!), hh = N(m[2]!);
    return line(`Check: the triangle is half of a ${fmt(b)} by ${fmt(hh)} rectangle, which has area ${fmt(b * hh)}; half of that is ${fmt((b * hh) / 2)}.`, `\\tfrac12 \\times ${fmt(b * hh)} = ${texOf(fmt(ans))}`, [{ lhs: `2*${ans}`, rhs: `${b}*${hh}` }]);
  }
  return null;
}

/** The expression after "f(x) =" in a derivative problem, in display form. */
const derivFn = (t: string) => /f\(x\)\s*=\s*(.+?)\.?$/.exec(t)?.[1] ?? null;
const integralParts = (t: string) => {
  const d = /from ([-−\d.]+) to ([-−\d.]+) of \((.+)\) dx/.exec(t);
  if (d) return { lo: N(d[1]!), hi: N(d[2]!), f: d[3]! };
  const i = /∫ \((.+)\) dx/.exec(t);
  return i ? { f: i[1]! } : null;
};

function checkDerivative(it: Item): CheckLine | null {
  const f = derivFn(it.text);
  if (!f) return null;
  const x0 = 1, h = 0.0001;
  const fl = sub(f, { x: `${x0 - h}` }), fr = sub(f, { x: `${x0 + h}` });
  const lhs = `((${fr}) - (${fl}))/${2 * h}`;
  const rhs = sub(it.answer.display, { x: `${x0}` });
  const lv = evalNum(lhs), rv = evalNum(rhs);
  if (lv === null || rv === null) return null;
  const tol = 1e-5 * Math.max(1, Math.abs(rv));
  if (!close(lv, rv, tol)) return null;
  return line(
    `Check at x = 1: the slope of the curve between x = 0.9999 and x = 1.0001 is about ${fmt(lv, 4)}, and f′(1) = ${fmt(rv, 4)}.`,
    `\\frac{f(1.0001) - f(0.9999)}{0.0002} \\approx ${texOf(fmt(lv, 4))},\\quad f'(1) ${Math.abs(rv - Math.round(rv)) < 1e-9 ? '=' : '\\approx'} ${texOf(fmt(rv, 4))}`,
    [{ lhs, rhs, tol }],
    `Check it at x equals one. The slope of the curve between two points either side of one comes out at about ${speak(fmt(lv, 4))}, and f prime of one is ${speak(fmt(rv, 4))}. They agree.`,
  );
}

function checkIntegral(it: Item): CheckLine | null {
  const p = integralParts(it.text);
  if (!p) return null;
  if (p.lo !== undefined && p.hi !== undefined) {
    const n = 8;
    const step = (p.hi - p.lo) / n;
    const terms: string[] = [];
    for (let k = 0; k <= n; k++) {
      const w = k === 0 || k === n ? 1 : k % 2 ? 4 : 2;
      terms.push(`${w}*(${sub(p.f, { x: `${p.lo + k * step}` })})`);
    }
    const lhs = `${step}/3*(${terms.join('+')})`;
    const rhs = calcOf(it.answer.display);
    const lv = evalNum(lhs), rv = evalNum(rhs);
    if (lv === null || rv === null) return null;
    const tol = 1e-3 * Math.max(1, Math.abs(rv));
    if (!close(lv, rv, tol)) return null;
    return line(
      `Check with Simpson’s rule on 8 strips: the area estimate is ${fmt(lv, 4)}, and ${it.answer.display} ${Math.abs(rv - Math.round(rv)) < 1e-9 ? '=' : '≈'} ${fmt(rv, 4)}.`,
      `\\text{Simpson, } n = 8:\\ ${texOf(fmt(lv, 4))}`,
      [{ lhs, rhs, tol }],
    );
  }
  const F = it.answer.display.replace(/\s*\+\s*C$/, '');
  const x0 = 1.2, h = 0.0001;
  const lhs = `((${sub(F, { x: `${x0 + h}` })}) - (${sub(F, { x: `${x0 - h}` })}))/${2 * h}`;
  const rhs = sub(p.f, { x: `${x0}` });
  const lv = evalNum(lhs), rv = evalNum(rhs);
  if (lv === null || rv === null) return null;
  const tol = 1e-5 * Math.max(1, Math.abs(rv));
  if (!close(lv, rv, tol)) return null;
  return line(
    `Check by differentiating: at x = 1.2 the slope of ${F} is about ${fmt(lv, 4)}, and the integrand there is ${fmt(rv, 4)}.`,
    `F'(1.2) \\approx ${texOf(fmt(lv, 4))},\\quad f(1.2) \\approx ${texOf(fmt(rv, 4))}`,
    [{ lhs, rhs, tol }],
    `Check by differentiating the answer. At x equals one point two, its slope is about ${speak(fmt(lv, 4))}, and the original function there is ${speak(fmt(rv, 4))}. Same number, so the antiderivative is right.`,
  );
}

/** An independent, recomputable check for an item, or null when none applies. */
export function checkFor(it: Item): CheckLine | null {
  let c: CheckLine | null = null;
  try {
    switch (it.topic) {
      case 'linear':
      case 'quadratic':
        c = checkEquation(it);
        break;
      case 'system':
        c = checkSystem(it);
        break;
      case 'fractions':
        c = checkExpression(it, 'Check with decimals');
        break;
      case 'arithmetic':
        c = checkExpression(it, 'Check in one pass');
        break;
      case 'exponents':
        c = checkExpression(it, 'Check numerically');
        break;
      case 'percent':
        c = checkPercent(it);
        break;
      case 'money':
        c = checkMoney(it);
        break;
      case 'units':
        c = checkUnits(it);
        break;
      case 'stats':
        c = checkStats(it);
        break;
      case 'geometry':
        c = checkGeometry(it);
        break;
      case 'derivative':
        c = checkDerivative(it);
        break;
      case 'integral':
        c = checkIntegral(it);
        break;
    }
  } catch {
    c = null;
  }
  // Never show a check that does not hold.
  return c && verifyCheck(c) ? c : null;
}

// ---------- pictures ----------

const g = (s: string) => toCalc(s).replace(/\s+/g, ' ');

function sampleRange(expr: string, x0: number, x1: number): [number, number] | null {
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k <= 40; k++) {
    const v = evalNum(sub(expr, { x: `${x0 + ((x1 - x0) * k) / 40}` }));
    if (v === null) continue;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  if (!Number.isFinite(lo)) return null;
  const pad = Math.max(1, (hi - lo) * 0.15);
  return [round(lo - pad), round(hi + pad)];
}

const round = (v: number) => Math.round(v * 1000) / 1000;
const label = (s: string) => s.replace(/\s+/g, ' ');

function numberLine(values: { x: number; label?: string }[], caption: string, say: string): Picture {
  const xs = values.map((v) => v.x);
  const lo = Math.min(0, ...xs), hi = Math.max(0, ...xs);
  const pad = Math.max(0.5, (hi - lo) * 0.15);
  return {
    exprs: ['0'],
    caption,
    xRange: [round(lo - pad), round(hi + pad)],
    yRange: [-1, 1],
    mark: values.map((v) => (v.label ? { x: round(v.x), y: 0, label: v.label } : { x: round(v.x), y: 0 })),
    say,
  };
}

function lineThrough(slope: number, x: number, y: number, caption: string, labelText: string, say: string, intercept = 0): Picture {
  const xr: [number, number] = [0, round(Math.max(1, x) * 1.4)];
  const ys = [intercept, intercept + slope * xr[1]];
  const ylo = Math.min(0, ...ys), yhi = Math.max(...ys, y);
  return {
    exprs: [intercept ? `${round6(slope)}x + ${round6(intercept)}` : `${round6(slope)}x`],
    caption,
    xRange: xr,
    yRange: [round(ylo - 0.1 * (yhi - ylo)), round(yhi * 1.1 + 0.1)],
    mark: [{ x: round(x), y: round(y), label: labelText }],
    say,
  };
}

const round6 = (v: number) => String(Math.round(v * 1e6) / 1e6);
/** "mx + k" tidied for graphing: "x - 2", "-2x + 7", "3". */
function linear(m: number, k: number): string {
  const ms = Math.abs(m - 1) < 1e-12 ? 'x' : Math.abs(m + 1) < 1e-12 ? '-x' : `${round6(m)}x`;
  if (Math.abs(m) < 1e-12) return round6(k);
  if (Math.abs(k) < 1e-12) return ms;
  return `${ms} ${k < 0 ? '-' : '+'} ${round6(Math.abs(k))}`;
}

/** A picture of the problem: the equation's graph, a number line, or the shape itself. */
export function pictureFor(it: Item): Picture {
  try {
    const p = picture(it);
    if (p) return p;
  } catch {
    /* fall through */
  }
  const vals = it.answer.display.split(/\s+or\s+|,\s+/).map(valueOf).filter((v): v is number => v !== null);
  return numberLine(
    vals.map((v) => ({ x: v, label: fmt(v, 2) })),
    `The answer on a number line.`,
    'Here is where the answer sits on the number line. Keep that position in mind while we work.',
  );
}

function picture(it: Item): Picture | null {
  const t = it.text;
  switch (it.topic) {
    case 'linear': {
      const [L, R] = equationOf(t).split('=').map((s) => s.trim());
      const x = valueOf(it.answer.display);
      if (!L || !R || x === null) return null;
      const y = evalNum(sub(L, { x: `${x}` }));
      if (y === null) return null;
      const xr: [number, number] = [round(x - 6), round(x + 6)];
      const yr = sampleRange(`(${g(L)})`, xr[0], xr[1]);
      const yr2 = sampleRange(`(${g(R)})`, xr[0], xr[1]);
      return {
        exprs: [g(L), g(R)],
        caption: `y = ${L} and y = ${R} meet at x = ${fmt(x, 3)}.`,
        xRange: xr,
        yRange: yr && yr2 ? [Math.min(yr[0], yr2[0]), Math.max(yr[1], yr2[1])] : [round(y - 10), round(y + 10)],
        mark: [{ x: round(x), y: round(y), label: `x = ${fmt(x, 3)}` }],
        say: `Before any algebra, draw each side as a line. The left side, ${speak(L)}, is one line, and the right side, ${speak(R)}, is another. The answer is the x where they cross.`,
      };
    }
    case 'quadratic': {
      const [L, R] = equationOf(t).split('=').map((s) => s.trim());
      if (!L || !R) return null;
      const f = R === '0' ? g(L) : `(${g(L)}) - (${g(R)})`;
      const roots = it.answer.display.split(/\s+or\s+/).map(valueOf).filter((v): v is number => v !== null);
      if (!roots.length) return null;
      const lo = Math.min(...roots), hi = Math.max(...roots);
      const xr: [number, number] = [round(lo - 3), round(hi + 3)];
      return {
        exprs: [f],
        caption: `y = ${R === '0' ? L : `(${L}) − (${R})`} crosses the x-axis at the solutions.`,
        xRange: xr,
        yRange: sampleRange(f, xr[0], xr[1]) ?? [-10, 10],
        mark: roots.map((r) => ({ x: round(r), y: 0, label: `x = ${fmt(r, 3)}` })),
        say: 'Here is the curve. It is a parabola, a U shape. Solving the equation means finding where it crosses the x-axis, where the height is zero. Count the crossings: that is how many answers to expect.',
      };
    }
    case 'system': {
      const m = /system:\s*(.+?)\s+and\s+(.+?)\.?$/.exec(t);
      const a = /x = ([^,]+), y = (.+)$/.exec(it.answer.display);
      if (!m || !a) return null;
      const X = valueOf(a[1]!), Y = valueOf(a[2]!);
      if (X === null || Y === null) return null;
      const exprs: string[] = [];
      for (const e of [m[1]!, m[2]!]) {
        const [L, R] = e.split('=');
        const h = (x: number, y: number) => evalNum(`(${sub(L!, { x: `${x}`, y: `${y}` })}) - (${sub(R!, { x: `${x}`, y: `${y}` })})`);
        const c0 = h(0, 0), ax = h(1, 0), by = h(0, 1);
        if (c0 === null || ax === null || by === null) return null;
        const A = ax - c0, B = by - c0;
        if (Math.abs(B) < 1e-12) return null;
        exprs.push(linear(-A / B, -c0 / B));
      }
      return {
        exprs,
        caption: `${m[1]} and ${m[2]} as lines, crossing at (${fmt(X, 3)}, ${fmt(Y, 3)}).`,
        xRange: [round(X - 6), round(X + 6)],
        yRange: [round(Y - 8), round(Y + 8)],
        mark: [{ x: round(X), y: round(Y), label: `(${fmt(X, 2)}, ${fmt(Y, 2)})` }],
        say: 'Each equation is a straight line: every point on it makes that equation true. We need a point that makes both true, so look for where the two lines cross.',
      };
    }
    case 'derivative': {
      const f = derivFn(t);
      if (!f) return null;
      const y0 = evalNum(sub(f, { x: '1' })), m = evalNum(sub(it.answer.display, { x: '1' }));
      if (y0 === null || m === null) return null;
      return {
        exprs: [g(f), `${round6(m)}*(x - 1) + ${round6(y0)}`.replace('+ -', '- ')],
        caption: `y = ${f} and its tangent line at x = 1, slope ${fmt(m, 3)}.`,
        xRange: [-1, 3],
        yRange: sampleRange(g(f), -1, 3) ?? [-10, 10],
        mark: [{ x: 1, y: round(y0), label: `slope ${fmt(m, 2)}` }],
        say: 'Here is the curve, and a straight line that just touches it at x equals one. Zoom in close and the curve looks like that line. The derivative is a formula for that slope at every x.',
      };
    }
    case 'integral': {
      const p = integralParts(t);
      if (!p) return null;
      if (p.lo !== undefined && p.hi !== undefined) {
        const fa = evalNum(sub(p.f, { x: `${p.lo}` })), fb = evalNum(sub(p.f, { x: `${p.hi}` }));
        if (fa === null || fb === null) return null;
        const xr: [number, number] = [round(p.lo - 1), round(p.hi + 1)];
        return {
          exprs: [g(p.f)],
          caption: `y = ${p.f} between x = ${fmt(p.lo)} and x = ${fmt(p.hi)}.`,
          xRange: xr,
          yRange: sampleRange(g(p.f), xr[0], xr[1]) ?? [-10, 10],
          mark: [{ x: p.lo, y: round(fa), label: `x = ${fmt(p.lo)}` }, { x: p.hi, y: round(fb), label: `x = ${fmt(p.hi)}` }],
          say: 'Here is the curve between the two limits. The integral is the area trapped between the curve and the x-axis there, with any part below the axis counting as negative.',
        };
      }
      const F = it.answer.display.replace(/\s*\+\s*C$/, '');
      return {
        exprs: [g(p.f), g(F)],
        caption: `y = ${p.f} and an antiderivative y = ${F}.`,
        xRange: [-2, 2],
        yRange: sampleRange(g(p.f), -2, 2) ?? [-10, 10],
        say: 'Two curves. The first is the function we were given. The second is the answer we are after: its slope at every x matches the height of the first. Where the first is above the axis, the second is climbing.',
      };
    }
    case 'percent':
    case 'money': {
      const ans = valueOf(it.answer.display);
      if (ans === null) return null;
      let m: RegExpExecArray | null;
      if ((m = /What is (\d[\d,]*(?:\.\d+)?)% of \$?(\d[\d,]*(?:\.\d+)?)/.exec(t))) {
        const P = N(m[1]!), B = N(m[2]!);
        return lineThrough(P / 100, B, ans, `y = ${fmt(P / 100)}x: ${fmt(P)}% of any amount.`, `${fmt(P)}% of ${fmt(B)}`, `Picture ${speak(fmt(P) + '%')} of every possible amount: it is a straight line through zero with slope ${speak(fmt(P / 100))}. Our amount, ${speak(fmt(B))}, is one point on that line.`);
      }
      if ((m = /total of (?:an? )?\$(\d[\d,]*(?:\.\d+)?)(?: bill)? with (?:an? )?(\d+(?:\.\d+)?)% (tip|tax)/.exec(t))) {
        const B = N(m[1]!), P = N(m[2]!);
        return lineThrough(1 + P / 100, B, ans, `Total = ${fmt(1 + P / 100)} × bill.`, `$${fmt(B, 2)} bill`, `Plot the bill across and the total up. Adding ${speak(fmt(P) + '%')} is the same as multiplying by ${speak(fmt(1 + P / 100))}, so every bill sits on one straight line.`);
      }
      if ((m = /(\d+(?:\.\d+)?)% (?:tip|tax|sales tax|gratuity) on \$?(\d[\d,]*(?:\.\d+)?)/.exec(t))) {
        const P = N(m[1]!), B = N(m[2]!);
        return lineThrough(P / 100, B, ans, `${it.topic === 'money' ? 'Tip' : 'Amount'} = ${fmt(P / 100)} × bill.`, `$${fmt(B, 2)} bill`, `Plot the bill across and the ${/tax/.test(t) ? 'tax' : 'tip'} up. At ${speak(fmt(P) + '%')} it is a straight line through zero: double the bill, double the ${/tax/.test(t) ? 'tax' : 'tip'}. Our bill is one point on it.`);
      }
      if ((m = /(\d+(?:\.\d+)?)% off (?:of )?\$?(\d[\d,]*(?:\.\d+)?)/.exec(t))) {
        const P = N(m[1]!), B = N(m[2]!);
        return lineThrough(1 - P / 100, B, ans, `Sale price = ${fmt(1 - P / 100)} × price.`, `${fmt(B)}`, `Plot the original price across and the sale price up. ${speak(fmt(P) + '%')} off keeps ${speak(fmt(100 - P) + '%')}, a straight line with slope ${speak(fmt(1 - P / 100))}.`);
      }
      if ((m = /\$(\d[\d,]*(?:\.\d+)?) is invested at (\d+(?:\.\d+)?)% per year, compounded monthly.*?after (\d+) years/.exec(t))) {
        const P = N(m[1]!), r = N(m[2]!), y = N(m[3]!);
        return {
          exprs: [`${P}*(1 + ${r / 100}/12)^(12x)`],
          caption: `Balance after x years at ${fmt(r)}% compounded monthly.`,
          xRange: [0, y * 2],
          yRange: [0, round(P * (1 + r / 100 / 12) ** (24 * y) * 1.1)],
          mark: [{ x: y, y: round(ans), label: `${y} years` }],
          say: 'Here is the balance over time. It is not a straight line: it bends upward, because each month’s interest also earns interest.',
        };
      }
      const nums = [...core(t).matchAll(/\$?([\d,]+(?:\.\d+)?)(?!%)/g)].map((x) => N(x[1]!)).filter((v) => v > 0 && v < 1e7);
      const vals = [...new Set([...nums.slice(0, 2), ans])];
      return numberLine(vals.map((v) => ({ x: v, label: fmt(v, 2) })), 'The amounts on a number line.', 'Put the amounts on a number line first, so you can see roughly where the answer has to land.');
    }
    case 'units': {
      const c = parseConversion(t);
      const ans = valueOf(it.answer.display);
      if (!c || ans === null) return null;
      if (/°/.test(c.from)) {
        const toF = /F/.test(c.to);
        return {
          exprs: [toF ? '1.8x + 32' : '(x - 32)*5/9'],
          caption: toF ? '°F = 1.8 × °C + 32: a line that does not pass through zero.' : '°C = (°F − 32) × 5/9: a line that does not pass through zero.',
          xRange: [round(Math.min(0, c.v) - 20), round(Math.max(c.v, 0) + 20)],
          yRange: sampleRange(toF ? '1.8x + 32' : '(x - 32)*5/9', Math.min(0, c.v) - 20, Math.max(c.v, 0) + 20) ?? [-50, 250],
          mark: [{ x: c.v, y: round(ans), label: `${fmt(c.v)} → ${fmt(ans, 1)}` }],
          say: 'Temperature conversions are straight lines too, but they miss zero. The two scales disagree about where zero is, so you scale and shift.',
        };
      }
      const a = siOf(c.from), b = siOf(c.to);
      if (a === null || b === null) return null;
      return lineThrough(a / b, c.v, ans, `${c.to} = ${fmt(a / b, 6)} × ${c.from}.`, `${fmt(c.v)} ${c.from}`, `Plot ${c.from} across and ${c.to} up. Every conversion lands on one straight line through zero, and the slope is the conversion factor.`);
    }
    case 'stats': {
      const xs = dataOf(t);
      const ans = valueOf(it.answer.display);
      if (!xs || ans === null) return null;
      const kind = /mean/.test(t) ? 'mean' : /median/.test(t) ? 'median' : /mode/.test(t) ? 'mode' : /range/.test(t) ? 'range' : 'spread';
      const pic = numberLine(xs.map((x) => ({ x })), 'The data as dots on a number line.', '');
      const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
      if (kind === 'mean' || kind === 'median' || kind === 'mode') pic.mark!.push({ x: round(ans), y: 0.5, label: `${kind} ${fmt(ans, 2)}` });
      else if (kind === 'spread') pic.mark!.push({ x: round(mean), y: 0.5, label: `mean ${fmt(mean, 2)}` });
      pic.say =
        kind === 'mean'
          ? 'Put every value on a number line as a dot. The mean is the balance point: the dots on the left pull exactly as hard as the dots on the right.'
          : kind === 'median'
            ? 'Put every value on a number line. The median is the dot in the middle: as many values to its left as to its right.'
            : kind === 'spread'
              ? 'Put every value on a number line and mark the mean. Standard deviation measures how far, typically, the dots sit from that mark.'
              : 'Put every value on a number line. Stacked dots show which values repeat, and the two ends show the range.';
      return pic;
    }
    case 'geometry': {
      const s = t.toLowerCase();
      const r = /radius (\d+(?:\.\d+)?)/.exec(s);
      const ans = valueOf(it.answer.display);
      if (/circle/.test(s) && r) {
        const R = N(r[1]!);
        return {
          exprs: [`sqrt(${R}^2 - x^2)`, `-sqrt(${R}^2 - x^2)`],
          caption: `A circle of radius ${fmt(R)} centered at the origin.`,
          xRange: [round(-R * 1.5), round(R * 1.5)],
          yRange: [round(-R * 1.3), round(R * 1.3)],
          mark: [{ x: R, y: 0, label: `r = ${fmt(R)}` }],
          say: `Draw the circle first. Its radius, ${speak(fmt(R))}, runs from the center to the edge, and everything about the circle is set by that one length.`,
        };
      }
      if (/sphere|cylinder|cone/.test(s) && r && ans !== null) {
        const R = N(r[1]!);
        const h = /height (\d+(?:\.\d+)?)/.exec(s);
        const expr = /sphere/.test(s) ? '4/3*pi*x^3' : /cone/.test(s) && h ? `pi*x^2*${h[1]}/3` : h ? `pi*x^2*${h[1]}` : null;
        if (!expr) return null;
        return {
          exprs: [expr],
          caption: `Volume as the radius grows${h ? `, with height ${h[1]}` : ''}.`,
          xRange: [0, round(R * 1.5)],
          yRange: [0, round(ans * 2.2 + 1)],
          mark: [{ x: R, y: round(ans), label: `r = ${fmt(R)}` }],
          say: /sphere/.test(s) ? 'Here is how a sphere’s volume grows with its radius. It curves up steeply: double the radius and the volume grows eight times.' : 'Here is how the volume grows with the radius. Double the radius and the base area, and so the volume, grows four times.',
        };
      }
      let m: RegExpExecArray | null;
      if ((m = /legs (\d+(?:\.\d+)?)(?: [a-z]+)? and (\d+(?:\.\d+)?)/.exec(s)) || (m = /hypotenuse (\d+(?:\.\d+)?)(?: [a-z]+)? and one leg (\d+(?:\.\d+)?)/.exec(s))) {
        const leg = /legs/.test(s);
        const a = N(m[leg ? 1 : 2]!), b = leg ? N(m[2]!) : ans;
        if (b === null) return null;
        return {
          exprs: [`${round6(b)} - ${round6(b / a)}x`],
          caption: `A right triangle with legs along the axes; the slanted line is the hypotenuse.`,
          xRange: [round(-0.15 * a), round(a * 1.2)],
          yRange: [round(-0.15 * b), round(b * 1.2)],
          mark: [{ x: 0, y: 0, label: 'right angle' }, { x: a, y: 0, label: fmt(a, 2) }, { x: 0, y: round(b), label: fmt(b, 2) }],
          say: 'Put the right triangle on the axes, with the two legs lying along them and the right angle at the origin. The slanted line joining their ends is the hypotenuse, the longest side.',
        };
      }
      const rect = /rectangle is (\d+(?:\.\d+)?) [a-z]+ long and (\d+(?:\.\d+)?)/.exec(s) ?? /(\d+(?:\.\d+)?)(?: [a-z]+)? by (\d+(?:\.\d+)?)(?: [a-z]+)? rectangle/.exec(s);
      if (rect) {
        const l = N(rect[1]!), w = N(rect[2]!);
        return {
          exprs: [`${w}`],
          caption: `A ${fmt(l)} by ${fmt(w)} rectangle drawn from the origin.`,
          xRange: [round(-0.2 * l), round(l * 1.3)],
          yRange: [round(-0.2 * w), round(w * 1.5)],
          mark: [{ x: 0, y: 0 }, { x: l, y: 0 }, { x: l, y: w }, { x: 0, y: w }],
          say: `Sketch the rectangle: ${speak(fmt(l))} along the bottom, ${speak(fmt(w))} up the side.`,
        };
      }
      if ((m = /base (\d+(?:\.\d+)?).*height (\d+(?:\.\d+)?)/.exec(s))) {
        const b = N(m[1]!), h = N(m[2]!);
        return {
          exprs: [`${round6((2 * h) / b)}x`, `${round6((2 * h) / b)}*(${b} - x)`],
          caption: `A triangle with base ${fmt(b)} and height ${fmt(h)}.`,
          xRange: [0, b],
          yRange: [0, round(h * 1.3)],
          mark: [{ x: 0, y: 0 }, { x: b, y: 0 }, { x: b / 2, y: h, label: `height ${fmt(h)}` }],
          say: 'Sketch the triangle on its base. The height is measured straight up from the base to the top corner.',
        };
      }
      return null;
    }
    case 'exponents': {
      const m = /^(?:Simplify|Evaluate)\s+(.+?)\.?$/.exec(core(t));
      if (!m || !/x/.test(m[1]!)) return null;
      const usesY = /(?<![a-z])y(?![a-z])/.test(m[1]!);
      const left = usesY ? sub(m[1]!, { y: '2' }) : g(m[1]!);
      const right = usesY ? sub(it.answer.display, { y: '2' }) : g(it.answer.display);
      return {
        exprs: [left, right],
        caption: `${m[1]} and ${it.answer.display}${usesY ? ' (with y = 2)' : ''} draw the same curve.`,
        xRange: [0.2, 2],
        yRange: sampleRange(right, 0.2, 2) ?? [-10, 10],
        say: 'Here is the original expression drawn as a curve, and here is the simplified one on top of it. They land exactly on each other, because simplifying never changes the value.',
      };
    }
    case 'fractions': {
      const m = /^Calculate\s+(.+?)\.?$/.exec(core(t));
      const ans = valueOf(it.answer.display);
      if (!m || ans === null) return null;
      const fr = [...m[1]!.matchAll(/[-−]?\d+\/\d+/g)].map((x) => ({ x: valueOf(x[0])!, label: x[0] }));
      return numberLine([...fr, { x: ans, label: `= ${it.answer.display}` }], 'The fractions as points on a number line.', 'Start by placing each fraction on a number line, so you can see roughly where the answer has to land.');
    }
    case 'arithmetic': {
      const vals = it.steps
        .map((s) => /=\s*([-−]?\d+(?:\.\d+)?)\.?$/.exec(s.text)?.[1])
        .filter((v): v is string => !!v)
        .map((v) => ({ x: N(v), label: v }));
      if (!vals.length) return null;
      return numberLine(vals, 'Each operation moves the running total.', 'Picture a number line. Each operation picks up the running total and moves it. Doing them in a different order would send it somewhere else.');
    }
  }
  return null;
}

void label;
