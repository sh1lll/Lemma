import { V } from './exact';
import { readUnit, type UnitHit } from './units';

// ---------- spoken numbers ----------

const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALE: Record<string, number> = { hundred: 100, thousand: 1000, million: 1e6 };
const DIGIT_WORD = /^(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)$/;

/** "twelve point five" → "12.5", "a hundred and twenty" → "120", "one and a half" → "1.5". */
export function wordsToNumbers(s: string): string {
  const words = s.split(/(\s+|-(?=[a-z]))/);
  const out: string[] = [];
  let i = 0;
  const isNumWord = (w: string | undefined) => !!w && (w.toLowerCase() in SMALL || w.toLowerCase() in SCALE);
  while (i < words.length) {
    const w = words[i]!;
    const lw = w.toLowerCase();
    const startsWithA = (lw === 'a' || lw === 'an') && SCALE[(words[i + 2] ?? '').toLowerCase()] !== undefined;
    // "one side", "one of the legs": a pronoun, not a measurement
    const pronoun = lw === 'one' && /^(?:side|leg|base|angle|of|end|face|edge|diagonal|other|another|pair|vertex|dimension|half|hemisphere|cone|cylinder|more|is|has|with|that|which|at|on|and)\b/i.test(words[i + 2] ?? '');
    if ((!isNumWord(w) && !startsWithA) || pronoun) {
      out.push(w);
      i++;
      continue;
    }
    let total = 0;
    let cur = startsWithA ? 1 : 0;
    let j = startsWithA ? i + 2 : i;
    let last = i;
    for (; j < words.length; j += 2) {
      const x = (words[j] ?? '').toLowerCase();
      if (x in SMALL) cur += SMALL[x]!;
      else if (x in SCALE) {
        cur = (cur || 1) * SCALE[x]!;
        if (SCALE[x]! >= 1000) {
          total += cur;
          cur = 0;
        }
      } else if (x === 'and' && isNumWord(words[j + 2]) && !/^(?:a|an)$/.test(words[j + 2] ?? '')) {
        // "a hundred and twenty"
      } else break;
      last = j;
    }
    let value = String(total + cur);
    let k = last + 2;
    // decimals: "point two five"
    if ((words[k] ?? '').toLowerCase() === 'point' && DIGIT_WORD.test((words[k + 2] ?? '').toLowerCase())) {
      let digits = '';
      k += 2;
      while (DIGIT_WORD.test((words[k] ?? '').toLowerCase())) {
        const d = (words[k] ?? '').toLowerCase();
        digits += d === 'oh' ? '0' : String(SMALL[d]);
        last = k;
        k += 2;
      }
      value += '.' + digits;
    }
    // "and a half", "and a quarter"
    const frac = /^\s+and\s+a\s+(half|quarter)\b/i.exec(words.slice(last + 1).join(''));
    if (frac) {
      value = String(Number(value) + (frac[1]!.toLowerCase() === 'half' ? 0.5 : 0.25));
      last += 6;
    }
    out.push(value);
    i = last + 1;
  }
  return out.join('');
}

// ---------- normalisation ----------

export interface Text {
  input: string;
  /** Normalised, case preserved. */
  t: string;
  /** Lowercase of t (same length). */
  s: string;
}

export function prep(input: string): Text {
  let t = input
    .replace(/[’‘`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[−–—]/g, '-')
    .replace(/×/g, ' x ')
    .replace(/÷/g, '/')
    .replace(/\bpi\b/gi, 'π')
    .replace(/\bsqrt\s*\(?\s*(\d+(?:\.\d+)?)\s*\)?/gi, '√$1')
    .replace(/\bdeg\b\.?/gi, '°')
    .replace(/(\d)\s*º/g, '$1°')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[?!.]+$/, '')
    .trim();
  t = wordsToNumbers(t);
  // spoken "squared/cubed" after a spelled unit, "per cent" not relevant here
  t = t.replace(/\b(\d+(?:\.\d+)?) degrees? (\d+(?:\.\d+)?) minutes?\b/gi, (_m, d: string, mm: string) => String(Number(d) + Number(mm) / 60) + '°');
  return { input, t, s: t.toLowerCase() };
}

// ---------- numbers with units ----------

export interface Num {
  v: V;
  raw: string;
  start: number;
  end: number;
  unit?: UnitHit;
  /** True for "π/3"-style values, which are radians when used as angles. */
  piForm?: boolean;
  used?: boolean;
}

const NUM_SRC = String.raw`(-?)(?:(\d+(?:\.\d+)?|\.\d+)\s*√\s*(\d+(?:\.\d+)?)|√\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?|\.\d+)?\s*π(?:\s*\/\s*(\d+))?|(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?(?:e[-+]?\d+)?|\.\d+)(?:\s*\/\s*(\d+(?:\.\d+)?)(?![\d.]))?)`;
export const NUM_RE = new RegExp(NUM_SRC, 'gi');

/** Every number in the text (with any unit right after it), left to right. Coordinates are skipped by callers. */
export function numbers(s: string): Num[] {
  const out: Num[] = [];
  for (const m of s.matchAll(NUM_RE)) {
    const start = m.index!;
    // A letter right before a digit ("x2", "a1") is not a standalone number; "-" counts only when not between words.
    const before = s[start - 1] ?? ' ';
    if (/[a-z_]/i.test(before) && !/π|√/.test(m[0])) continue;
    let neg = m[1] === '-';
    if (neg && /[\w)]/.test(s[start - 1] ?? ' ')) neg = false;
    let v: V | null = null;
    let piForm = false;
    if (m[3] !== undefined) v = V.dec(m[2]!)!.mul(V.dec(m[3])!.sqrt());
    else if (m[4] !== undefined) v = V.dec(m[4])!.sqrt();
    else if (/π/.test(m[0])) {
      v = (m[5] ? V.dec(m[5])! : V.rat(1)).mul(V.PI);
      if (m[6]) v = v.div(V.dec(m[6])!);
      piForm = true;
    } else if (m[7] !== undefined) {
      v = V.dec(m[7]);
      if (v && m[8]) {
        const d = V.dec(m[8])!;
        if (d.x === 0) continue;
        v = v.div(d);
      }
    }
    if (!v) continue;
    if (neg) v = v.neg();
    const numStart = neg ? start : m[1] === '-' ? start + 1 : start;
    let end = start + m[0].length;
    const raw = s.slice(numStart, end);
    const u = readUnit(s.slice(end));
    let unit: UnitHit | undefined;
    if (u) {
      const after = s.slice(end + u.len);
      // "4 in a circle" / "5 m and" fine; reject "in" when it is clearly the preposition.
      const isIn = /^\s*in$/i.test(s.slice(end, end + u.len));
      if (!(isIn && /^\s+(?:a|an|the|terms|which|its|this|that|degrees?|radians?)\b/i.test(after))) {
        unit = u.hit;
        end += u.len;
      }
    }
    if (piForm && !unit) unit = { dim: 'angle', unit: 'rad', factor: V.rat(180).div(V.PI) };
    out.push({ v, raw, start: numStart, end, unit, piForm });
  }
  return out;
}

// ---------- points ----------

export interface Pt {
  x: V;
  y: V;
  z?: V;
  label?: string;
  start: number;
  end: number;
}

const COORD = String.raw`\s*(-?\s*(?:\d+(?:\.\d+)?|\.\d+)(?:\s*\/\s*\d+)?|-?\s*√\s*\d+)\s*`;
const PT_RE = new RegExp(String.raw`(?:\b([a-z]'?)\s*)?\(${COORD},${COORD}(?:,${COORD})?\)`, 'gi');

const coordV = (raw: string): V => {
  const r = raw.replace(/\s+/g, '');
  const neg = r.startsWith('-');
  const body = neg ? r.slice(1) : r;
  let v: V;
  if (body.startsWith('√')) v = V.dec(body.slice(1))!.sqrt();
  else if (body.includes('/')) {
    const [a, b] = body.split('/');
    v = V.dec(a!)!.div(V.dec(b!)!);
  } else v = V.dec(body)!;
  return neg ? v.neg() : v;
};

/** "(1, 2)", "A(0,0)", "(1,2,3)". */
export function points(t: string): Pt[] {
  const out: Pt[] = [];
  for (const m of t.matchAll(PT_RE)) {
    const label = m[1] && /^[A-Z]'?$/.test(m[1]) ? m[1] : undefined;
    out.push({ x: coordV(m[2]!), y: coordV(m[3]!), z: m[4] !== undefined ? coordV(m[4]) : undefined, label, start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

export const has = (s: string, re: RegExp) => re.test(s);
