import type { PluginManifest } from './manifest';

/**
 * Compiles phrase templates into a sequence of tokens and matches them with a memoised backtracking search:
 *   "bmi {weight} kg {height} m"  →  bmi · NUMBER · kg · NUMBER · m   (case-insensitive, whitespace flexible)
 * Literal words must appear; whitespace is flexible; numbers accept "1,200", "1.75", "-3"; text inputs take
 * the shortest run of words before the next literal. Nothing a plugin author writes becomes regex syntax.
 *
 * A plain regular expression is not used for the whole template: adjacent text or comma-separated number slots
 * make it backtrack exponentially (five text inputs froze the page for >10 s on a 300-character input). Here
 * every (token, position) pair is tried at most once, so the work is bounded by tokens × input length × slot width.
 */

type Token = { k: 'ws'; min: 0 | 1 } | { k: 'word'; re: RegExp } | { k: 'num'; slot: number } | { k: 'text'; slot: number };

export interface CompiledTemplate {
  template: string;
  tokens: Token[];
  slots: string[];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Text inputs: a non-space character followed by at most 80 more (no line breaks), shortest first. */
const TEXT_MAX = 81;
const LINE_BREAK = /[\n\r\u2028\u2029]/;
const WS = /\s/;
const TAIL = /^\s*[?.!]?\s*$/;

export function compileTemplate(template: string, textInputs: ReadonlySet<string>): CompiledTemplate {
  const slots: string[] = [];
  const tokens: Token[] = [{ k: 'ws', min: 0 }];
  let last = 0;
  for (const m of template.matchAll(/\{([a-z][a-z0-9_]*)\}/g)) {
    const between = template.slice(last, m.index);
    // Adjacent placeholders ("{a} {b}") need at least one space between them.
    if (slots.length && !between.trim()) tokens.push({ k: 'ws', min: 1 });
    else literal(between, tokens);
    tokens.push({ k: textInputs.has(m[1]!) ? 'text' : 'num', slot: slots.length });
    slots.push(m[1]!);
    last = m.index! + m[0].length;
  }
  literal(template.slice(last), tokens);
  return { template, tokens, slots };
}

function literal(s: string, tokens: Token[]): void {
  // Words separated by any whitespace; spaces around placeholders optional ("70kg" and "70 kg" both match).
  const words = s.trim().split(/\s+/).filter(Boolean);
  for (const w of words) tokens.push({ k: 'ws', min: 0 }, { k: 'word', re: new RegExp(esc(w), 'iy') });
  if (words.length) tokens.push({ k: 'ws', min: 0 });
}

const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';

/**
 * End positions of every number starting at `i`, longest first:
 * [-+]? ( \d{1,3}(,\d{3})+ | \d+ ) (\.\d+)?  |  [-+]? \.\d+
 */
function numberEnds(s: string, i: number): number[] {
  let p = i;
  if (s[p] === '-' || s[p] === '+') p++;
  const ends = new Set<number>();
  const withFraction = (k: number) => {
    ends.add(k);
    if (s[k] === '.' && isDigit(s[k + 1])) for (let j = k + 1; isDigit(s[j]); j++) ends.add(j + 1);
  };
  let d = p;
  while (isDigit(s[d])) d++;
  if (d > p) {
    for (let k = p + 1; k <= d; k++) withFraction(k);
    // Thousands separators: 1-3 leading digits, then ",ddd" groups.
    if (d - p <= 3) {
      for (let k = d; s[k] === ',' && isDigit(s[k + 1]) && isDigit(s[k + 2]) && isDigit(s[k + 3]); k += 4) withFraction(k + 4);
    }
  } else if (s[p] === '.' && isDigit(s[p + 1])) {
    for (let j = p + 1; isDigit(s[j]); j++) ends.add(j + 1);
  }
  return [...ends].sort((a, b) => b - a);
}

function candidates(t: Token, s: string, i: number): number[] {
  switch (t.k) {
    case 'ws': {
      let j = i;
      while (j < s.length && WS.test(s[j]!)) j++;
      const out: number[] = [];
      for (let k = j; k >= i + t.min; k--) out.push(k); // greedy
      return out;
    }
    case 'word':
      t.re.lastIndex = i;
      return t.re.test(s) ? [t.re.lastIndex] : [];
    case 'num':
      return numberEnds(s, i);
    case 'text': {
      if (i >= s.length || WS.test(s[i]!) || LINE_BREAK.test(s[i]!)) return [];
      const out: number[] = [];
      for (let k = i + 1; k <= Math.min(s.length, i + TEXT_MAX); k++) {
        out.push(k); // lazy: shortest first
        if (LINE_BREAK.test(s[k] ?? '')) break;
      }
      return out;
    }
  }
}

function run(c: CompiledTemplate, s: string): Record<string, string> | null {
  const failed = new Set<number>();
  const width = s.length + 1;
  const caps: [number, number][] = [];
  const go = (ti: number, i: number): boolean => {
    if (ti === c.tokens.length) return TAIL.test(s.slice(i));
    const key = ti * width + i;
    if (failed.has(key)) return false;
    const t = c.tokens[ti]!;
    for (const end of candidates(t, s, i)) {
      if (t.k === 'num' || t.k === 'text') caps[t.slot] = [i, end];
      if (go(ti + 1, end)) return true;
    }
    failed.add(key);
    return false;
  };
  if (!go(0, 0)) return null;
  const values: Record<string, string> = {};
  c.slots.forEach((name, i) => (values[name] = s.slice(caps[i]![0], caps[i]![1]).replace(/,(?=\d{3})/g, '').trim()));
  return values;
}

export interface MatchResult {
  values: Record<string, string>;
  template: string;
}

const MAX_INPUT = 300;

export function matchPlugin(manifest: PluginManifest, input: string, compiled?: CompiledTemplate[]): MatchResult | null {
  if (input.length > MAX_INPUT) return null;
  const textInputs = new Set(manifest.inputs.filter((i) => i.type === 'text').map((i) => i.name));
  for (const c of compiled ?? manifest.templates.map((t) => compileTemplate(t, textInputs))) {
    const values = run(c, input);
    if (values) return { values, template: c.template };
  }
  return null;
}
