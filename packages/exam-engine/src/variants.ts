/**
 * Variants of the student's own questions: keep the teacher's wording, change the numbers, recompute the
 * answer with Lemma. A question is only varied when Lemma can solve the ORIGINAL and agrees with
 * its key; otherwise the caller falls back to a generated question of the same topic and type.
 */
import type { Step } from '@lemma/practice-engine';
import type { ExamQuestion } from './types';
import { evalNumber, gradable, matches, solve, type Solved } from './math';
import { pretty } from './text';
import { Rng } from './util';

/** Lemma's solution of an imported question, if it agrees with the question's own key. */
export function solveImported(q: ExamQuestion): Solved | null {
  if (!q.prompt || q.parts?.length || /quantity a/i.test(q.prompt)) return null;
  const s = solve(q.prompt);
  if (!s) return null;
  if (q.answer === undefined) return s;
  const key = Array.isArray(q.answer) ? q.answer : [q.answer];
  if (q.choices) {
    if (q.type !== 'mc' || key.length !== 1) return null;
    const choice = q.choices.find((c) => c.id === key[0]);
    return choice && matches(s.answer, choice.text).correct && q.choices.filter((c) => matches(s.answer, c.text).correct).length === 1 ? s : null;
  }
  return matches(s.answer, key[0]!, q.prompt).correct ? s : null;
}

/** Shape of an answer, ignoring the numbers' values and signs: "x = n or x = n", "$n.n", "n/n". */
function shape(ans: string): string {
  return ans.replace(/,(?=\d{3})/g, '').replace(/[−-]/g, '').replace(/\d+/g, 'n').replace(/\s+/g, ' ').trim();
}

const NUMBER_RE = /(?<![\w^.,])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?![\d,]*\.\d)/g;

interface Slot {
  start: number;
  end: number;
  text: string;
  value: number;
}

function numberSlots(prompt: string): Slot[] {
  const out: Slot[] = [];
  for (const m of prompt.matchAll(NUMBER_RE)) {
    const text = m[1]!;
    const start = m.index!;
    const before = prompt.slice(Math.max(0, start - 16), start);
    if (/round(?:ed)? to(?: the nearest)?\s*$|decimal places?\s*$|\^\s*[-−]?\s*$/i.test(before)) continue;
    if (/^\s*decimal/i.test(prompt.slice(start + text.length, start + text.length + 9))) continue;
    const value = Number(text.replace(/,/g, ''));
    if (value === 0 || value === 1) continue; // structural numbers: keep
    out.push({ start, end: start + text.length, text, value });
  }
  return out;
}

function nudge(v: number, text: string, rng: Rng): number {
  const dec = /\.(\d+)/.exec(text)?.[1]?.length ?? 0;
  if (dec) {
    const step = 10 ** -dec * Math.max(1, Math.round(v * 10 ** dec * 0.1));
    let n = v + rng.pick([-3, -2, -1, 1, 2, 3]) * step;
    if (n <= 0) n = v + step;
    return Number(n.toFixed(dec));
  }
  const zeros = (/0*$/.exec(String(Math.round(v)))?.[0].length ?? 0);
  let unit = 10 ** zeros;
  if (v / unit < 4 && unit > 1) unit /= 10;
  let n = v + rng.pick([-3, -2, -1, 1, 2, 3]) * unit;
  if (n <= 1) n = v + unit * rng.int(1, 3);
  return n;
}

function format(n: number, like: string): string {
  if (/,/.test(like)) return n.toLocaleString('en-US');
  const dec = /\.(\d+)/.exec(like)?.[1]?.length ?? 0;
  return dec ? n.toFixed(dec) : String(n);
}

/** Rewrites "ax^2 + bx + c = 0" with new rational roots (keeps a), so variants factor as nicely as the original. */
function quadraticRewrite(prompt: string, rng: Rng): string | null {
  const re = /(\d*)\s*x\^2(?:\s*([+-])\s*(\d*)\s*x(?![\^\w]))?(?:\s*([+-])\s*(\d+))?\s*=\s*0/;
  const m = re.exec(prompt.replace(/−/g, '-'));
  if (!m) return null;
  const a = m[1] ? Number(m[1]) : 1;
  const hasB = !!m[2];
  // Roots: integer q and p/a; with no linear term use ±p (a must be 1).
  let A = a, B = 0, C = 0;
  if (!hasB) {
    if (a !== 1) return null;
    const p = rng.int(2, 9);
    C = -p * p;
  } else {
    let tries = 0;
    do {
      const p = rng.int(-9, 9) || 2;
      const q = rng.int(-9, 9) || -3;
      // (a x − p)(x − q) = a x² − (p + a q) x + p q
      B = -(p + a * q);
      C = p * q;
      tries++;
    } while ((B === 0 || C === 0) && tries < 20);
    A = a;
  }
  const term = (coef: number, v: string, first: boolean) => {
    if (coef === 0) return '';
    const sign = coef < 0 ? '-' : '+';
    const mag = Math.abs(coef) === 1 && v ? '' : String(Math.abs(coef));
    return first ? `${coef < 0 ? '-' : ''}${mag}${v}` : ` ${sign} ${mag}${v}`;
  };
  const eq = `${term(A, 'x^2', true)}${term(B, 'x', false)}${term(C, '', false)} = 0`;
  const lead = /^\s*/.exec(m[0])![0];
  return prompt.slice(0, m.index) + lead + eq + prompt.slice(m.index + m[0].length);
}

export interface Variant {
  prompt: string;
  answer: string;
  steps: Step[];
}

/** A re-numbered version of the question with a recomputed answer, or null when that can't be done safely. */
export function makeVariant(q: ExamQuestion, rng: Rng, attempts = 80): Variant | null {
  const original = solveImported(q);
  if (!original) return null;
  const origShape = shape(original.answer);
  const slots = numberSlots(q.prompt);
  for (let k = 0; k < attempts; k++) {
    let prompt: string | null = null;
    if (k % 2 === 0) prompt = quadraticRewrite(q.prompt, rng);
    if (!prompt) {
      if (!slots.length) return null;
      const pickAll = k % 3 === 0;
      let s = q.prompt;
      let changed = 0;
      for (const sl of [...slots].reverse()) {
        if (!pickAll && rng.next() < 0.4) continue;
        const n = nudge(sl.value, sl.text, rng);
        s = s.slice(0, sl.start) + format(n, sl.text) + s.slice(sl.end);
        changed++;
      }
      if (!changed) continue;
      prompt = s;
    }
    if (prompt === q.prompt) continue;
    const solved = solve(prompt);
    if (!solved || shape(solved.answer) !== origShape) continue;
    if (/√|π/.test(solved.answer) !== /√|π/.test(original.answer)) continue;
    if (matches(original.answer, solved.answer).correct) continue; // same answer: not a real variant
    if (!gradable(solved.answer)) continue;
    const v = evalNumber(solved.answer);
    if (v !== null && Math.abs(v) > 1e7) continue;
    return { prompt: pretty(prompt), answer: solved.answer, steps: solved.steps };
  }
  return null;
}
