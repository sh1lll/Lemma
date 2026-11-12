// Parsing helpers shared by the ML handlers (ml.ts, ml-models.ts).
import { f, rawNums } from './util';

const N = '-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:e[-+]?\\d+)?';
/** A run of numbers separated by spaces / commas (fractions "2/9" allowed). */
const RUN = `((?:${N}(?:\\s*/\\s*${N})?\\s*[,;]?\\s*)+)`;

export const g = (x: number, d = 7) => f(x, d);

/** Parses "2/9" and decimals in a run. */
export function runValues(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(new RegExp(`(${N})(?:\\s*/\\s*(${N}))?`, 'g'))) {
    const a = Number(m[1]);
    out.push(m[2] !== undefined ? a / Number(m[2]) : a);
  }
  return out.filter(Number.isFinite);
}

/** The number list right after one of `names`: "labels 0 1 1", "y_pred = [0.2, 0.4]". */
export function listAfter(s: string, names: string): number[] | null {
  const re = new RegExp(`(?:^|[^a-z0-9_])(?:${names})(?![a-z0-9_])\\s*(?:[:=]|values|are|is|of)?\\s*[\\[(]?\\s*${RUN}`);
  const m = re.exec(s);
  if (!m) return null;
  const xs = runValues(m[1]!);
  return xs.length ? xs : null;
}

/** A single named number: "k = 3", "lambda 0.1", "learning rate 0.5". */
export function num(s: string, names: string): number | null {
  const m = new RegExp(`(?:^|[^a-z0-9_])(?:${names})(?![a-z0-9_])\\s*(?:[:=]|is|of|at)?\\s*(${N})`).exec(s);
  return m ? Number(m[1]) : null;
}

/** "(1, 2) (3, 4)" tuples of at least `dim` numbers. */
export function tuples(text: string, min = 1): number[][] {
  const out: number[][] = [];
  for (const m of text.matchAll(/\(\s*(-?[\d.][-\d.eE\s,]*)\)/g)) {
    const xs = rawNums(m[1]!);
    if (xs.length >= min) out.push(xs);
  }
  return out;
}

/** Contents of each [...] group (words allowed inside, numbers extracted). */
export function bracketGroups(text: string): number[][] {
  return [...text.matchAll(/\[([^[\]]*)\]/g)].map((m) => runValues(m[1]!)).filter((xs) => xs.length);
}

/** Nested matrix "[[1,2],[3,4]]" right after a keyword (or the first one if `after` is null). */
export function matrixAfter(s: string, after: string | null): number[][] | null {
  let from = 0;
  if (after) {
    const m = new RegExp(`(?:^|[^a-z0-9_])(?:${after})(?![a-z0-9_])`).exec(s);
    if (!m) return null;
    from = m.index + m[0].length;
  }
  const rest = s.slice(from);
  const m = /^\s*(?:[:=]\s*)?\[\s*\[([\s\S]*?)\]\s*\]/.exec(rest) ?? (after ? null : /\[\s*\[([\s\S]*?)\]\s*\]/.exec(rest));
  if (!m) return null;
  const rows = m[1]!.split(/\]\s*,?\s*\[/).map((r) => rawNums(r));
  if (!rows.length || rows.some((r) => r.length !== rows[0]!.length || !r.length)) return null;
  return rows;
}

export const ln = Math.log;
export const sigmoid = (z: number) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));
export const label = (x: number) => String(Number(x.toPrecision(12)));
