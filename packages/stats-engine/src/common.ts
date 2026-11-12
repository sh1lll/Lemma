import { D, MathError, formatNumber, type Answer, type AnswerResult, type Dec } from '@lemma/math-core';

export const KIND = 'stats';

export interface Ctx {
  input: string;
  /** Normalised text: lowercase, number words as digits, symbols spelled out. */
  s: string;
  /**
   * Working copy of `s`. Handlers blank out the parameters they consume (keeping offsets) so that the
   * numbers left over are the data.
   */
  rest: string;
}

export type Handler = (c: Ctx) => AnswerResult | null;

export function ok(c: Ctx, a: Omit<Answer, 'ok' | 'input' | 'notes' | 'kind'> & { notes?: string[] }): Answer {
  return { ok: true, input: c.input, kind: KIND, notes: [], ...a };
}

/** A missing input is a question back to the user, not a guess. */
export function need(c: Ctx, what: string): AnswerResult {
  return { ok: false, kind: KIND, input: c.input, error: new MathError('ambiguous-reference', what) };
}

export function fail(message: string): never {
  throw new MathError('domain', message);
}

// ---------- formatting ----------

/** Display string for a float, rounded to `digits` significant digits (kills 0.30000000000000004). */
export function f(x: number, digits = 6): string {
  if (Number.isNaN(x)) return 'undefined';
  if (!isFinite(x)) return x > 0 ? '∞' : '−∞';
  return formatNumber(new D(x), { digits }).display;
}

export function fd(x: Dec, digits = 12): string {
  return formatNumber(x, { digits }).display;
}

/** Rounds a float to a Decimal with `digits` significant digits. */
export function dec(x: number, digits = 12): Dec {
  if (!isFinite(x)) return new D(x);
  return new D(x).toSignificantDigits(digits, D.ROUND_HALF_UP);
}

export function primaryOf(x: number | Dec, digits = 10): { primary: Answer['primary']; value: Dec } {
  const v = typeof x === 'number' ? dec(x, digits) : x.toSignificantDigits(digits, D.ROUND_HALF_UP);
  if (!v.isFinite()) {
    const s = v.isNaN() ? 'undefined' : v.isPositive() ? '∞' : '−∞';
    return { primary: { display: s, plain: s, spoken: v.isNaN() ? 'undefined' : 'infinity' }, value: v };
  }
  const full = formatNumber(v, { digits });
  const spoken = formatNumber(v, { digits: Math.min(digits, 6) }).spoken;
  return { primary: { display: full.display, plain: full.plain, spoken }, value: v };
}

/** Probability as a decimal, plus a percentage for readability. */
export function prob(x: number, digits = 8): string {
  return f(x, digits);
}

export function pctOf(x: number, digits = 4): string {
  return `${f(x * 100, digits)}%`;
}

// ---------- number words & normalisation ----------

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const WORD = `(?:${[...Object.keys(UNITS), ...Object.keys(TENS), 'hundred', 'thousand'].join('|')})`;
const RUN = new RegExp(`\\b${WORD}(?:\\s+${WORD})*\\b`, 'g');

/** "three five seven" → "3 5 7", "twenty five" → "25", "one hundred five" → "105". */
function wordRun(run: string): string {
  const out: number[] = [];
  let total = 0;
  let cur = 0;
  let last: 'none' | 'unit' | 'teen' | 'tens' | 'hundred' | 'thousand' = 'none';
  const flush = () => {
    if (last !== 'none') out.push(total + cur);
    total = 0;
    cur = 0;
    last = 'none';
  };
  for (const w of run.split(/\s+/)) {
    if (w in UNITS) {
      const v = UNITS[w]!;
      const kind = v >= 10 ? 'teen' : 'unit';
      if (last === 'unit' || last === 'teen' || (kind === 'teen' && last === 'tens')) flush();
      cur += v;
      last = kind;
    } else if (w in TENS) {
      if (last === 'unit' || last === 'teen' || last === 'tens') flush();
      cur += TENS[w]!;
      last = 'tens';
    } else if (w === 'hundred') {
      if (last === 'hundred') flush();
      cur = (cur || 1) * 100;
      last = 'hundred';
    } else if (w === 'thousand') {
      total += (cur || 1) * 1000;
      cur = 0;
      last = 'thousand';
    }
  }
  flush();
  return out.join(' ');
}

export function normalize(input: string): string {
  let s = input
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[−–—]/g, '-')
    .replace(/≤|=</g, '<=')
    .replace(/≥|=>/g, '>=')
    .replace(/≠/g, '!=')
    .replace(/μ|µ/g, 'mu')
    .replace(/σ²/g, 'variance ')
    .replace(/σ/g, 'sigma')
    .replace(/λ/g, 'lambda')
    .replace(/χ\s*(?:²|2|\^2)?/g, 'chi-square ')
    .replace(/x̄|x-bar|\bxbar\b/g, 'xbar')
    .replace(/p̂|p-hat/g, 'phat')
    .replace(/[¬~]\s*/g, 'not ')
    .replace(/α/g, 'alpha')
    .replace(/∩/g, ' and ')
    .replace(/[?!]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(new RegExp(`\\b(${Object.keys(TENS).join('|')})-(${Object.keys(UNITS).slice(1, 10).join('|')})\\b`, 'g'), '$1 $2');
  s = s.replace(RUN, (run) => wordRun(run));
  s = s
    .replace(/\b(\d+) point ((?:\d ?)+)/g, (_, a: string, b: string) => `${a}.${b.replace(/ /g, '')} `)
    .replace(/(^|[\s,(])point ((?:\d ?)+)/g, (_, p: string, b: string) => `${p}0.${b.replace(/ /g, '')} `)
    .replace(/\b(?:minus|negative) (?=\d|\.\d)/g, '-')
    .replace(/\s*(?:percent|per cent|pct)\b/g, '%')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

// ---------- numbers ----------

export const NUM = '-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:e[-+]?\\d+)?';

export interface Num {
  v: number;
  index: number;
  end: number;
}

/**
 * All numbers in a string. Commas group thousands only when the list itself is written with ", ";
 * "1,2,3" is a list. A minus right after a letter, digit or ")" is not a sign. Numbers glued to a
 * preceding letter ("q1", "mu0", "n2") are names, not data.
 */
export function numbersIn(s: string): Num[] {
  const tight = /\d,\d/.test(s) && !/,\s/.test(s);
  const re = tight
    ? /-?(?:\d+(?:\.\d+)?|\.\d+)(?:e[-+]?\d+)?/g
    : /-?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)(?:e[-+]?\d+)?/g;
  const out: Num[] = [];
  for (const m of s.matchAll(re)) {
    let raw = m[0];
    let index = m.index;
    if (raw.startsWith('-') && index > 0 && /[\w)\]]/.test(s[index - 1]!)) {
      raw = raw.slice(1);
      index++;
    }
    const prev = index > 0 ? s[index - 1]! : '';
    if (/[a-z_]/.test(prev)) continue;
    const v = Number(raw.replace(/,/g, ''));
    if (Number.isFinite(v)) out.push({ v, index, end: index + raw.length });
  }
  return out;
}

export const values = (s: string): number[] => numbersIn(s).map((n) => n.v);

/** Replace a span with spaces, keeping offsets. */
export function blank(s: string, index: number, end: number): string {
  return s.slice(0, index) + ' '.repeat(end - index) + s.slice(end);
}

export interface Param {
  v: number;
  /** Written with a % sign. */
  pct: boolean;
}

/**
 * Finds "name = 3", "name 3", "name is 3", "name of 3" in c.rest, consumes it and returns the number.
 * `names` is a regex alternation.
 */
export function take(c: Ctx, names: string, opts: { sep?: string } = {}): Param | null {
  const sep = opts.sep ?? '(?:\\s*(?:=|:|equals|equal to|is|of|was|at|being)\\s*|\\s+)?';
  const re = new RegExp(`(?:^|[^a-z0-9_])(?:${names})(?![a-z0-9_])${sep}\\s*(${NUM})(\\s*%)?`);
  const m = re.exec(c.rest);
  if (!m) return null;
  const start = m.index + (/^[^a-z0-9_]/.test(m[0]) ? 1 : 0);
  c.rest = blank(c.rest, start, m.index + m[0].length);
  return { v: Number(m[1]), pct: !!m[2] };
}

/**
 * A probability written as a decimal ("0.3") or a percentage ("30%", "30 percent"). A bare number above 1 is
 * refused rather than guessed: "p = 1.5" may be 1.5% or a typo for 0.15, and the answers differ wildly.
 */
export function probValue(v: number, pct: boolean, what = 'A probability'): number {
  if (pct) return v / 100;
  if (v > 1) fail(`${what} must be between 0 and 1, and ${f(v)} isn't. If you meant ${f(v)}%, write "${f(v)}%" or "${f(v)} percent".`);
  return v;
}

/** A probability parameter: "0.3", "30%" or "30 percent" all mean 0.3; a bare "30" is refused (see {@link probValue}). */
export function asProb(p: Param | null, what?: string): number | null {
  if (!p) return null;
  return probValue(p.v, p.pct, what);
}

/** Removes every match of a regex from c.rest (keeping offsets). */
export function strip(c: Ctx, re: RegExp): void {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  c.rest = c.rest.replace(g, (m) => ' '.repeat(m.length));
}

// ---------- confidence & significance ----------

export function confidence(c: Ctx): { level: number; stated: boolean } {
  const pats = [
    new RegExp(`(${NUM})\\s*%\\s*(?:confidence|conf\\b|ci\\b|c\\.i\\.|interval|level|two|sure|certain)`),
    new RegExp(`(?:confidence|conf)(?: level)?(?:\\s*(?:=|:|of|is|at))?\\s*(${NUM})\\s*%?`),
    new RegExp(`\\bat\\s*(${NUM})\\s*%`),
  ];
  for (const re of pats) {
    const m = re.exec(c.rest);
    if (m) {
      let v = Number(m[1]);
      if (v > 1) v /= 100;
      if (v > 0 && v < 1) {
        c.rest = blank(c.rest, m.index, m.index + m[0].length);
        return { level: v, stated: true };
      }
    }
  }
  return { level: 0.95, stated: false };
}

export function alpha(c: Ctx): { a: number; stated: boolean } {
  const m =
    new RegExp(`(?:alpha|significance(?: level)?|level of significance)\\s*(?:=|:|of|is|at)?\\s*(${NUM})\\s*(%)?`).exec(c.rest) ??
    new RegExp(`(?:at|with) (?:the |a )?(${NUM})\\s*(%)?\\s*(?:significance|level)`).exec(c.rest);
  if (m) {
    let v = Number(m[1]);
    if (m[2]) v /= 100;
    else if (v >= 1) fail(`A significance level must be between 0 and 1, and ${f(v)} isn't. If you meant ${f(v)}%, write "${f(v)}%" or "${f(v)} percent".`);
    c.rest = blank(c.rest, m.index, m.index + m[0].length);
    if (v > 0 && v < 1) return { a: v, stated: true };
  }
  return { a: 0.05, stated: false };
}

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const meanOf = (xs: number[]) => sum(xs) / xs.length;
export function varianceOf(xs: number[], sample = true): number {
  const m = meanOf(xs);
  let ss = 0;
  for (const x of xs) ss += (x - m) * (x - m);
  return ss / (xs.length - (sample ? 1 : 0));
}
