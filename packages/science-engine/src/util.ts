import { D, MathError, formatNumber, toFraction, type Answer, type AnswerResult, type Dec, type Formatted } from '@lemma/math-core';

export type Kind = 'bases' | 'chemistry' | 'physics' | 'geometry';

export interface Ctx {
  /** The user's text, untouched. */
  input: string;
  /** Normalised but case-preserving (formulas and symbols are case-sensitive). */
  t: string;
  /** Lowercase of {@link t}; same length, so indexes line up. */
  s: string;
}

export type Handler = (c: Ctx) => AnswerResult | null;

export function ok(c: Ctx, a: Omit<Answer, 'ok' | 'input' | 'notes' | 'kind'> & { kind: Kind; notes?: string[] }): Answer {
  return { ok: true, input: c.input, notes: [], ...a };
}

/** A missing input is a question back to the user, not a guess. */
export function need(c: Ctx, kind: Kind, what: string): AnswerResult {
  return { ok: false, kind, input: c.input, error: new MathError('ambiguous-reference', what) };
}

export function fail(c: Ctx, kind: Kind, message: string): AnswerResult {
  return { ok: false, kind, input: c.input, error: new MathError('domain', message) };
}

/** A plain number: "12", "1,500", "0.25", ".5", "1.5e-3". Sign handled by callers that allow it. */
export const NUM = String.raw`(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)(?:e[-+]?\d+)?`;
/** Signed number. */
export const SNUM = String.raw`[-+]?${NUM}`;

export function num(raw: string): Dec {
  return new D(raw.replace(/,/g, '').replace(/^\+/, ''));
}

const SUP_MAP: Record<string, string> = { '⁻': '-', '⁺': '+', '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };

/** Whitespace, dashes and "× 10^-3" style scientific notation, preserving case. */
export function normalise(input: string): string {
  let t = input
    .replace(/[’‘]/g, "'")
    .replace(/[−–]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[?!]+$/, '')
    .trim();
  // 1.5 x 10^-3, 1.5×10⁻³, 1.5*10^(-3) → 1.5e-3 ; bare 10^-3 → 1e-3
  t = t.replace(/(\d(?:[\d.]*\d)?)\s*(?:x|×|\*|·)\s*10\s*(?:\^\s*\(?\s*([-+]?\d+)\s*\)?|([⁻⁺]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+))/g, (_m, a: string, e1?: string, e2?: string) => `${a}e${e1 ?? toAscii(e2 ?? '')}`);
  t = t.replace(/(^|[^\d.])10\s*(?:\^\s*\(?\s*([-+]?\d+)\s*\)?|([⁻⁺][⁰¹²³⁴⁵⁶⁷⁸⁹]+))/g, (_m, pre: string, e1?: string, e2?: string) => `${pre}1e${e1 ?? toAscii(e2 ?? '')}`);
  return t;
}

function toAscii(sup: string): string {
  return [...sup].map((ch) => SUP_MAP[ch] ?? ch).join('');
}

/** Exact-looking values (≤ 10 significant digits) are shown in full; anything longer is rounded to `sig` digits. */
export function show(x: Dec | number, sig = 6): Formatted {
  if (typeof x === 'number') return formatNumber(new D(x), { digits: sig });
  return formatNumber(x, { digits: x.sd() <= 10 ? 12 : sig });
}

/** Number → display/plain/spoken with a unit. */
export function prim(x: Dec | number, unit?: string, spokenUnit?: string, sig = 6): Answer['primary'] {
  const f = show(x, sig);
  return { display: f.display, plain: f.plain, spoken: `${f.spoken}${spokenUnit ?? unit ? ` ${spokenUnit ?? unit}` : ''}`, ...(unit ? { unit } : {}) };
}

export const disp = (x: Dec | number, sig = 6) => show(x, sig).display;
export const dec = (x: Dec | number): Dec => (typeof x === 'number' ? new D(x) : x);

export const PI = D.acos(-1);

/** Text of an exact multiple of π, e.g. 25 → "25π", 500/3 → "500π/3". Null when the coefficient isn't a clean rational. */
export function piForm(coef: Dec): string | null {
  if (coef.isZero()) return null;
  if (coef.isInteger()) return coef.eq(1) ? 'π' : `${coef.toString()}π`;
  const fr = toFraction(coef, 10_000);
  if (!fr) return null;
  const [n = '', d = ''] = fr.split('/');
  return `${n === '1' ? '' : n}π/${d}`;
}

/** Simplified radical for an integer radicand, e.g. 50 → "5√2", 49 → "7". Null when not a smallish integer. */
export function radicalForm(k: Dec): string | null {
  if (!k.isInteger() || k.isNegative() || k.gt(1e12)) return null;
  let n = k.toNumber();
  let outside = 1;
  for (let f = 2; f * f <= n; f++) {
    while (n % (f * f) === 0) {
      n /= f * f;
      outside *= f;
    }
  }
  if (n === 1) return String(outside);
  return `${outside === 1 ? '' : outside}√${n}`;
}

export function fracForm(x: Dec): string {
  if (x.isInteger()) return x.toString();
  const fr = toFraction(x, 10_000);
  return fr ?? disp(x);
}

const SUB = '₀₁₂₃₄₅₆₇₈₉';
const SUPS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
export const subscript = (digits: string) => [...digits].map((d) => SUB[Number(d)] ?? d).join('');
export const superscript = (digits: string) => [...digits].map((d) => (d === '+' ? '⁺' : d === '-' ? '⁻' : SUPS[Number(d)] ?? d)).join('');

/** "CuSO4·5H2O" → "CuSO₄·5H₂O". */
export function prettyFormula(f: string): string {
  return f.replace(/[*•∙⋅]|\.(?=\d*[A-Z(])/g, '·').replace(/([A-Za-z)\]])(\d+)/g, (_m, a: string, d: string) => a + subscript(d));
}
