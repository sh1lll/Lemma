import { D, MathError, type Answer, type AnswerResult } from '@lemma/math-core';

/** One question as the handlers see it: the original text, a normalised lowercase copy, and the currency symbol. */
export interface Q {
  input: string;
  s: string;
  cur: string;
}
export type Handler = (q: Q) => AnswerResult | null;
export type Lines = { label: string; display: string }[];
export type Table = NonNullable<Answer['table']>;

// ---------- normalisation ----------

export function normalise(input: string): string {
  return input
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[−–—](?=\s?[\d.$€£¥₹])/g, '-')
    .replace(/[−–—]/g, ' - ')
    .replace(/σ/g, ' sigma ')
    .replace(/μ/g, ' mu ')
    .replace(/×/g, 'x')
    .replace(/\bper ?cent\b|\bpercent\b|\bpct\b/g, '%')
    .replace(/\s+%/g, '%')
    .replace(/[?!]+\s*$/, '')
    .replace(/\.\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- numbers ----------

/** A number as typed: 1,000.5 / -3 / .25 / 1e-4. */
export const NUM = String.raw`(?:[-+]?(?:\d{1,3}(?:,\d{3})+(?!\d)|\d+)(?:\.\d+)?(?:e[-+]?\d+)?|[-+]?\.\d+)`;
const SFX = String.raw`(?:\s?(thousand|million|billion|mm|bn|mn)\b|(k|m|b)\b)?`;
const SCALE: Record<string, number> = { thousand: 1e3, k: 1e3, million: 1e6, m: 1e6, mm: 1e6, mn: 1e6, billion: 1e9, bn: 1e9, b: 1e9 };

export function toNum(raw: string, sfx?: string): number {
  const v = Number(raw.replace(/,/g, '').replace(/^\+/, ''));
  return sfx ? v * (SCALE[sfx] ?? 1) : v;
}

export interface P {
  v: number;
  /** Written with %, bps or "percent". */
  pct: boolean;
  bps: boolean;
  index: number;
}

/**
 * The value written after one of `names`: "S=100", "strike 105", "vol: 20%", "risk-free rate of 3%".
 * `names` is a regex alternation; the match must start at a word boundary.
 */
export function param(s: string, names: string, after = String.raw`(?:=|:|of|is|at|equals|was|to|about|around|~)?`): P | undefined {
  const re = new RegExp(String.raw`(?:^|[^a-z0-9_])(?:${names})(?![a-z])\s*${after}\s*(?:\$|€|£|¥|₹)?\s*(${NUM})(?![\d.])${SFX}(?!\s*(?:years?|yrs?|months?|mos?|days?|weeks?|steps?|periods?)\b)\s*(%|bps|bp|basis points)?`, 'i');
  const m = re.exec(s);
  if (!m) return undefined;
  return { v: toNum(m[1]!, m[2] ?? m[3]), pct: m[4] === '%', bps: !!m[4] && m[4] !== '%', index: m.index };
}

/** Like param but also "105 strike" (number first). */
export function paramEither(s: string, names: string): P | undefined {
  const a = param(s, names);
  if (a) return a;
  const re = new RegExp(String.raw`(?:\$|€|£|¥|₹)?(${NUM})${SFX}\s*(%|bps|bp)?\s+(?:${names})(?![a-z])`, 'i');
  const m = re.exec(s);
  return m ? { v: toNum(m[1]!, m[2] ?? m[3]), pct: m[4] === '%', bps: !!m[4] && m[4] !== '%', index: m.index } : undefined;
}

/** A rate from a parameter: 5% → 0.05, 50 bps → 0.005, 0.05 → 0.05, and a bare 5 → 0.05 (noted). */
export function rateOf(p: P | undefined, notes?: string[], label = 'rate'): number | undefined {
  if (!p) return undefined;
  if (p.bps) return p.v / 10000;
  if (p.pct) return p.v / 100;
  if (Math.abs(p.v) >= 1) {
    notes?.push(`Read ${label} ${p.v} as ${p.v}%`);
    return p.v / 100;
  }
  return p.v;
}

export interface Tok {
  v: number;
  pct: boolean;
}

/**
 * Numbers in a list such as "-1000, 300, 400" or "1,000 2,000" or "1,2,3" or "2%, -1%, 3%". Commas directly
 * between digits are thousands separators unless the list itself is comma-separated without spaces.
 */
export function list(text: string): Tok[] {
  let t = text.replace(/[−–—]/g, '-').replace(/\(\s*(\d[\d,.]*)\s*\)/g, '-$1');
  const commaSeparated = /,(?!\d{3}(?!\d))\S/.test(t) && !/,\s/.test(t);
  t = commaSeparated ? t.replace(/,/g, ' , ') : t.replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  const out: Tok[] = [];
  for (const m of t.matchAll(/(?:^|[^a-z0-9.])([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(?:\s*(%)|([km])\b)?/gi)) {
    const sfx = (m[2] ?? m[3])?.toLowerCase();
    out.push({ v: toNum(m[1]!) * (sfx === 'k' ? 1e3 : sfx === 'm' ? 1e6 : 1), pct: sfx === '%' });
  }
  return out;
}

/** List values, with % entries (or all entries, when any has %) as fractions. */
export function fractions(toks: Tok[]): number[] {
  const anyPct = toks.some((t) => t.pct);
  return toks.map((t) => (anyPct ? t.v / 100 : t.v));
}

/** Returns as fractions: with % → /100; without %, values all within ±1 are fractions already, else percents. */
export function returnsOf(toks: Tok[], notes?: string[]): number[] {
  if (toks.some((t) => t.pct)) return toks.map((t) => t.v / 100);
  if (toks.every((t) => Math.abs(t.v) <= 1)) return toks.map((t) => t.v);
  notes?.push('Read the returns as percentages');
  return toks.map((t) => t.v / 100);
}

/** The text after a keyword up to the next keyword-ish word (for lists). */
export function after(s: string, re: RegExp, stop = /\b(?:at|with|and (?:a |the )?[a-z]|using|rate|risk|rf|discount|vs|versus|against|benchmark|market|confidence|target|mar|horizon|for|seed)\b|$/): string {
  const m = re.exec(s);
  if (!m) return '';
  const rest = s.slice(m.index + m[0].length);
  const st = stop.exec(rest);
  return st ? rest.slice(0, st.index) : rest;
}

// ---------- matrices ----------

export type Nested = number | Nested[];

/** Parses "[[1,2],[3,4]]", "[1,2;3,4]", "[[3,3],[0,5];[5,0],[1,1]]" and "(3,3) (0,5); (5,0) (1,1)". A ';' adds a row level. */
export function parseNested(text: string): Nested | null {
  let src = text.trim();
  if (/^\(/.test(src)) src = `[${src}]`;
  src = src.replace(/\(/g, '[').replace(/\)/g, ']');
  let i = 0;
  const ws = () => {
    while (i < src.length && /[\s]/.test(src[i]!)) i++;
  };
  const parseList = (): Nested[] | null => {
    if (src[i] !== '[') return null;
    i++;
    const rows: Nested[][] = [[]];
    for (;;) {
      ws();
      if (i >= src.length) return null;
      const ch = src[i]!;
      if (ch === ']') {
        i++;
        break;
      }
      if (ch === ',') {
        i++;
        continue;
      }
      if (ch === ';') {
        i++;
        rows.push([]);
        continue;
      }
      if (ch === '[') {
        const l = parseList();
        if (!l) return null;
        rows[rows.length - 1]!.push(l);
        continue;
      }
      const m = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/i.exec(src.slice(i));
      if (!m) return null;
      rows[rows.length - 1]!.push(Number(m[0]));
      i += m[0].length;
    }
    const nonEmpty = rows.filter((r) => r.length);
    return rows.length > 1 ? nonEmpty : nonEmpty[0] ?? [];
  };
  ws();
  const out = parseList();
  return out;
}

/** The first bracketed block in the text (balanced), e.g. the matrix in "nash equilibrium [[..]]". */
export function bracketBlocks(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '[') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === ']') {
      depth--;
      if (depth === 0 && start >= 0) out.push(s.slice(start, i + 1));
      if (depth < 0) depth = 0;
    }
  }
  return out;
}

/** A numeric matrix from nested arrays (rows of numbers), or null. */
export function asMatrix(n: Nested | null): number[][] | null {
  if (!Array.isArray(n) || !n.length) return null;
  if (n.every((r) => Array.isArray(r) && r.length && r.every((x) => typeof x === 'number'))) {
    const rows = n as number[][];
    return rows.every((r) => r.length === rows[0]!.length) ? rows : null;
  }
  return null;
}

// ---------- linear algebra (small dense) ----------

export function solve(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const M = A.map((r, i) => [...r, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    if (Math.abs(M[p]![c]!) < 1e-14) return null;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((r, i) => r[n]! / r[i]!);
}

export const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);
export const matVec = (A: number[][], x: number[]) => A.map((r) => dot(r, x));
export const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
export const mean = (a: number[]) => sum(a) / a.length;
export function sampleVar(a: number[]): number {
  const m = mean(a);
  return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1);
}
export function sampleCov(a: number[], b: number[]): number {
  const ma = mean(a);
  const mb = mean(b);
  return a.reduce((s, x, i) => s + (x - ma) * (b[i]! - mb), 0) / (a.length - 1);
}

// ---------- normal distribution ----------

/** Standard normal CDF (Hart 1968 / West 2005 double-precision algorithm, |error| < 1e-14). */
export function N(x: number): number {
  const a = Math.abs(x);
  let c: number;
  if (a > 37) c = 0;
  else {
    const e = Math.exp((-a * a) / 2);
    if (a < 7.07106781186547) {
      let b = 3.52624965998911e-2 * a + 0.700383064443688;
      b = b * a + 6.37396220353165;
      b = b * a + 33.912866078383;
      b = b * a + 112.079291497871;
      b = b * a + 221.213596169931;
      b = b * a + 220.206867912376;
      c = e * b;
      b = 8.83883476483184e-2 * a + 1.75566716318264;
      b = b * a + 16.064177579207;
      b = b * a + 86.7807322029461;
      b = b * a + 296.564248779674;
      b = b * a + 637.333633378831;
      b = b * a + 793.826512519948;
      b = b * a + 440.413735824752;
      c /= b;
    } else {
      let b = a + 0.65;
      b = a + 4 / b;
      b = a + 3 / b;
      b = a + 2 / b;
      b = a + 1 / b;
      c = e / b / 2.506628274631;
    }
  }
  return x > 0 ? 1 - c : c;
}
export const pdf = (x: number) => Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);

/** Inverse standard normal (Acklam, refined with one Halley step). */
export function Ninv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let x: number;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  } else if (p <= 1 - pl) {
    const q = p - 0.5;
    const r = q * q;
    x = ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const e = N(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

// ---------- random numbers (seeded) ----------

export function rng(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function gaussian(u: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let x = 0;
    while (x === 0) x = u();
    const r = Math.sqrt(-2 * Math.log(x));
    const th = 2 * Math.PI * u();
    spare = r * Math.sin(th);
    return r * Math.cos(th);
  };
}

// ---------- root finding ----------

/** Bisection to a bracket then secant polish. Returns null when f(lo), f(hi) have the same sign. */
export function bisect(f: (x: number) => number, lo: number, hi: number, tol = 1e-12, iters = 300): number | null {
  let flo = f(lo);
  const fhi = f(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < iters && hi - lo > tol; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (fm === 0) return mid;
    if (flo * fm < 0) hi = mid;
    else {
      lo = mid;
      flo = fm;
    }
  }
  return (lo + hi) / 2;
}

// ---------- formatting ----------

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Fixed decimals with thousands separators and a real minus sign. */
export function fix(x: number, dp = 2): string {
  if (!Number.isFinite(x)) return x > 0 ? '∞' : x < 0 ? '−∞' : 'undefined';
  const r = Math.abs(x) < 0.5 * 10 ** -dp ? 0 : x;
  const [i = '0', f] = Math.abs(r).toFixed(dp).split('.');
  return `${r < 0 ? '−' : ''}${group(i)}${f ? `.${f}` : ''}`;
}

/** A readable number: 2 decimals above 1000, up to 4 below, 4 significant digits for small values; zeros trimmed. */
export function num(x: number, maxDp = 4): string {
  if (!Number.isFinite(x)) return fix(x);
  const a = Math.abs(x);
  if (a === 0) return '0';
  let dp = a >= 1000 ? 2 : a >= 1 ? maxDp : Math.min(10, Math.max(maxDp, 3 - Math.floor(Math.log10(a))));
  if (Number.isInteger(x) && a < 1e15) dp = 0;
  const s = fix(x, dp);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

export function pct(x: number, dp = 2): string {
  return `${fix(x * 100, dp)}%`;
}

export function money(x: number, cur: string, dp = 2): string {
  const s = fix(x, dp);
  return s.startsWith('−') ? `−${cur}${s.slice(1)}` : `${cur}${s}`;
}

/** The plain machine form of a number (no grouping). */
export function plain(x: number, sig = 12): string {
  if (!Number.isFinite(x)) return String(x);
  return Number(x.toPrecision(sig)).toString();
}

// ---------- answers ----------

export interface Out {
  kind: string;
  expression: string;
  display: string;
  value?: number;
  spoken?: string;
  unit?: string;
  lines?: Lines;
  table?: Table;
  notes?: string[];
  exactness?: Answer['exactness'];
}

export function answer(q: Q, o: Out): Answer {
  const v = o.value;
  return {
    ok: true,
    kind: o.kind,
    input: q.input,
    expression: o.expression,
    primary: { display: o.display, plain: v !== undefined && Number.isFinite(v) ? plain(v) : o.display, spoken: o.spoken ?? o.display.replace(/−/g, 'minus '), ...(o.unit ? { unit: o.unit } : {}) },
    ...(v !== undefined && Number.isFinite(v) ? { value: new D(plain(v)) } : {}),
    ...(o.lines?.length ? { lines: o.lines } : {}),
    ...(o.table ? { table: o.table } : {}),
    notes: o.notes ?? [],
    ...(o.exactness ? { exactness: o.exactness } : {}),
  };
}

/** A missing essential input is a question back to the user, never a guess. */
export function need(q: Q, kind: string, what: string): AnswerResult {
  return { ok: false, kind, input: q.input, error: new MathError('ambiguous-reference', what) };
}

export function bad(q: Q, kind: string, what: string): AnswerResult {
  return { ok: false, kind, input: q.input, error: new MathError('domain', what) };
}

/** Time in years from "T=0.5", "6 months", "90 days", "2 years", "expiry 3 months". */
export function years(s: string, names = 't|time|maturity|expiry|expiration|tenor|term|horizon'): { t: number; how: string } | undefined {
  const unitRe = String.raw`(${NUM})\s*-?\s*(years?|yrs?|y|months?|mos?|mths?|weeks?|wks?|days?|d)\b`;
  const named = new RegExp(String.raw`(?:^|[^a-z])(?:${names})(?![a-z])\s*(?:=|:|of|is|in|to)?\s*(?:${unitRe}|(${NUM})(?![\d.]*\s*%))`, 'i').exec(s);
  const m = named ?? new RegExp(String.raw`(?:^|[^a-z0-9.])${unitRe}`, 'i').exec(s);
  if (!m) return undefined;
  const numS = named ? (m[1] ?? m[3]) : m[1];
  const unit = named ? m[2] : m[2];
  if (!numS) return undefined;
  const v = toNum(numS);
  if (!unit) return { t: v, how: `${num(v)} years` };
  const u = unit.toLowerCase();
  if (u.startsWith('y')) return { t: v, how: `${num(v)} year${v === 1 ? '' : 's'}` };
  if (u.startsWith('mo') || u.startsWith('mt')) return { t: v / 12, how: `${num(v)} months` };
  if (u.startsWith('w')) return { t: v / 52, how: `${num(v)} weeks` };
  return { t: v / 365, how: `${num(v)} days (÷ 365)` };
}

export function currencyOf(input: string, fallback: string): string {
  const m = /[$€£¥₹]/.exec(input);
  if (m) return m[0];
  if (/\b(?:usd|dollars?)\b/i.test(input)) return '$';
  if (/\b(?:eur|euros?)\b/i.test(input)) return '€';
  if (/\b(?:gbp|pounds? sterling)\b/i.test(input)) return '£';
  return fallback;
}

/**
 * The run of numbers right after a keyword: "returns 8% and 4%", "vols: 15%, 5%", "weights 0.6/0.4",
 * "flows -1,000, 300, 400". Stops at the first word that is not a separator.
 */
export function listAfter(s: string, key: RegExp): Tok[] | undefined {
  const g = new RegExp(key.source, key.flags.includes('g') ? key.flags : key.flags + 'g');
  for (const m of s.matchAll(g)) {
    const r = listAt(s.slice(m.index + m[0].length));
    if (r) return r;
  }
  return undefined;
}

function listAt(text: string): Tok[] | undefined {
  let rest = text;
  const out: Tok[] = [];
  const head = /^\s*(?:of|are|is|=|:|were|was)?\s*/.exec(rest);
  rest = rest.slice(head![0].length);
  const item = /^\s*(?:,|;|\band\b|&|\/|\bvs\.?|\bthen\b)?\s*(?:\$|€|£)?([-+]?(?:\d{1,3}(?:,\d{3})+(?![\d])|\d+)(?:\.\d+)?|[-+]?\.\d+)(?:e[-+]?\d+)?\s*(%)?/i;
  for (;;) {
    const it = item.exec(rest);
    if (!it) break;
    // A comma-thousands group directly after a comma-separated list item ("300,400") is two items when no space.
    out.push({ v: toNum(it[1]!), pct: it[2] === '%' });
    rest = rest.slice(it[0].length);
  }
  return out.length ? out : undefined;
}
