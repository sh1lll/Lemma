/**
 * Natural-language normalisation: turns spoken or casually typed math ("what's twenty percent of 450 plus 30")
 * into the formal expression grammar ("20 % of 450 + 30"). It only rewrites vocabulary; precedence and
 * meaning are decided by the parser, so nothing here guesses at grouping.
 */

import { MathError } from './errors';

export interface NormalizeOptions {
  /** "," for locales that write 3,5 for three and a half. Default ".". */
  decimalSeparator?: '.' | ',';
  /**
   * Whether a previous result exists. When it is known to be missing, "+5" / "plus 5" is just 5 (with a note) and
   * "*2" / "times 2" says why it can't continue; left unset, leading operators always continue from `ans`.
   */
  hasPrevious?: boolean;
}

export interface Normalized {
  text: string;
  /** Other readings of the same words, offered to the user rather than chosen silently. */
  alternatives: { text: string; label: string }[];
  notes: string[];
}

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};
const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES: Record<string, number> = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };
const SCALE_ZEROS: Record<string, number> = { hundred: 2, thousand: 3, million: 6, billion: 9, trillion: 12, lakh: 5, crore: 7 };
const CJK_ZEROS: Record<string, number> = { 万: 4, 億: 8, 亿: 8, 兆: 12 };

const DENOMINATORS: Record<string, number> = {
  half: 2, halves: 2, third: 3, thirds: 3, quarter: 4, quarters: 4, fourth: 4, fourths: 4, fifth: 5, fifths: 5,
  sixth: 6, sixths: 6, seventh: 7, sevenths: 7, eighth: 8, eighths: 8, ninth: 9, ninths: 9, tenth: 10, tenths: 10,
  hundredth: 100, hundredths: 100, thousandth: 1000, thousandths: 1000,
};
const ORDINAL_ROOTS: Record<string, number> = { fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };

const NUMBER_WORD = new RegExp(
  `\\b(?:${[...Object.keys(UNITS), ...Object.keys(TEENS), ...Object.keys(TENS), 'hundred', ...Object.keys(SCALES)].join('|')})(?:(?:\\s+|-)(?:${[
    ...Object.keys(UNITS),
    ...Object.keys(TEENS),
    ...Object.keys(TENS),
    'hundred',
    ...Object.keys(SCALES),
    'and',
    'point',
  ].join('|')}))*\\b`,
  'g',
);

type Kind = 'unit' | 'teen' | 'tens' | 'hundred' | 'scale' | null;

/** Converts one run of number words ("one hundred and five point two five") to digits; unrelated numbers stay separate. */
function convertRun(run: string): string {
  const words = run.split(/[\s-]+/);
  const out: string[] = [];
  let total = 0;
  let current = 0;
  let last: Kind = null;
  let decimals: string | null = null;
  let started = false;

  const flush = () => {
    if (!started) return;
    out.push(String(total + current) + (decimals ? `.${decimals}` : ''));
    total = current = 0;
    last = null;
    decimals = null;
    started = false;
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (decimals !== null) {
      if (w in UNITS) {
        decimals += String(UNITS[w]);
        continue;
      }
      flush();
    }
    if (w === 'point') {
      if (!started) {
        started = true;
      }
      decimals = '';
      continue;
    }
    if (w === 'and') {
      const next = words[i + 1];
      // "one hundred and five" continues the number; "five and three" does not.
      if ((last === 'hundred' || last === 'scale') && next && !(next in SCALES) && next !== 'hundred') continue;
      flush();
      out.push('and');
      continue;
    }
    if (w in UNITS || w in TEENS || w in TENS) {
      const kind: Kind = w in UNITS ? 'unit' : w in TEENS ? 'teen' : 'tens';
      const v = UNITS[w] ?? TEENS[w] ?? TENS[w]!;
      const fits =
        last === null || last === 'hundred' || last === 'scale' || (last === 'tens' && kind === 'unit' && current % 10 === 0);
      if (!fits || (last === null && started)) flush();
      current += v;
      last = kind;
      started = true;
      continue;
    }
    if (w === 'hundred') {
      current = (current || 1) * 100;
      last = 'hundred';
      started = true;
      continue;
    }
    if (!started) {
      // Bare scale after digits ("2.5 million") is resolved later with exact decimal shifting.
      out.push(w);
      continue;
    }
    const scale = SCALES[w]!;
    total += (current || 1) * scale;
    current = 0;
    last = 'scale';
    started = true;
  }
  flush();
  return out.join(' ');
}

const NUMBER_WORDS = new Set([...Object.keys(UNITS), ...Object.keys(TEENS), ...Object.keys(TENS), 'hundred', ...Object.keys(SCALES)]);
/** "point" followed by a digit word, with the word before it (if any) so a whole part can be detected. */
// The preceding word is bounded so the scan stays linear on long inputs without spaces.
const LEADING_POINT = new RegExp(`(?:^|([a-z0-9.]{1,12})(\\s+))point(?=\\s+(?:${Object.keys(UNITS).join('|')})\\b)`, 'g');

const LEAD_FILLER = /^(?:(?:hey|ok|okay|so|um|uh|and|then|now|please|alright|right)\b[\s,]*)+/;
const LEAD_QUESTION =
  /^(?:(?:what(?:'s| is| are)?|whats|how much (?:is|are)|calculate|compute|evaluate|work out|figure out|tell me|find|solve|give me|do)\b\s*)+/;

interface Rule {
  re: RegExp;
  to: string | ((...m: string[]) => string);
}

const PHRASES: Rule[] = [
  { re: /\bpie\b/g, to: 'pi' },
  { re: /\b(\d+) point (\d+)\b/g, to: '$1.$2' },
  { re: /\b(\d+)\s+choose\s+(\d+)\b/g, to: 'ncr($1,$2)' },
  { re: /\bmultiplied by\b/g, to: '*' },
  { re: /\btimes\b/g, to: '*' },
  { re: /\bdivided by\b|\bdivide by\b|\bover\b/g, to: '/' },
  { re: /\bplus\b/g, to: '+' },
  { re: /\bminus\b|\bnegative\b/g, to: '-' },
  // The function form, mod(a, b) / modulo(a, b), is a mod b (not "previous result mod …").
  { re: /\bmod(?:ulo)?\s*\(\s*([^(),]+?)\s*,\s*([^(),]+?)\s*\)/g, to: '(($1) mod ($2))' },
  { re: /\bmodulo\b|\bmodulus\b/g, to: ' mod ' },
  { re: /\bper ?cent(?:age)?\b|\bpercentage\b/g, to: '%' },
  { re: /\b(?:raised )?to the power(?: of)?\b|\braised to\b/g, to: '^' },
  { re: /\bto the (\d+)(?:st|nd|rd|th)(?: power)?\b/g, to: '^$1' },
  { re: /\bsquared\b/g, to: '^2' },
  { re: /\bcubed\b/g, to: '^3' },
  { re: /\b(?:the )?square root(?: of)?\b/g, to: ' sqrt ' },
  { re: /\b(?:the )?cube root(?: of)?\b/g, to: ' cbrt ' },
  { re: /\b(?:the )?(\d+)(?:st|nd|rd|th) root(?: of)?\b/g, to: ' root$1 ' },
  {
    re: /\b(?:the )?(fourth|fifth|sixth|seventh|eighth|ninth|tenth) root(?: of)?\b/g,
    to: (_m, w) => ` root${ORDINAL_ROOTS[w!]} `,
  },
  { re: /\b(\d+) factorial\b/g, to: '$1!' },
  { re: /\bfactorial(?: of)?\b/g, to: ' fact ' },
  { re: /\b(?:the )?absolute value(?: of)?\b/g, to: ' abs ' },
  { re: /\b(sqrt|cbrt|abs|exp) of\b/g, to: ' $1 ' },
  { re: /\bnatural log(?:arithm)?(?: of)?\b|\bln of\b/g, to: ' ln ' },
  { re: /\blog(?:arithm)? (?:base|of base) (\d+)(?: of)?\b/g, to: ' logb$1 ' },
  { re: /\blog(?:arithm)? of\b/g, to: ' log ' },
  { re: /\b(?:the )?(?:sine|sin) of\b|\bsine\b/g, to: ' sin ' },
  { re: /\b(?:the )?(?:cosine|cos) of\b|\bcosine\b/g, to: ' cos ' },
  { re: /\b(?:the )?(?:tangent|tan) of\b|\btangent\b/g, to: ' tan ' },
  { re: /\b(?:open|left) (?:paren(?:thesis)?|bracket)\b/g, to: '(' },
  { re: /\b(?:close|right) (?:paren(?:thesis)?|bracket)\b/g, to: ')' },
  { re: /\bdegrees?\b/g, to: '°' },
  { re: /\bhalf of\b/g, to: '0.5 of' },
  { re: /\b(?:a )?half\b/g, to: '0.5' },
  { re: /\b(?:twice|double)\b/g, to: '2 *' },
  { re: /\btriple\b/g, to: '3 *' },
  { re: /\bpercent\b/g, to: '%' },
];

const OPERAND = String.raw`(.+?)`;

/** Commands that continue from the previous result, or name both operands in verb form. */
const COMMANDS: { re: RegExp; to: string; note?: string; alt?: { to: string; label: string } }[] = [
  { re: new RegExp(`^(?:add|plus) ${OPERAND} to (.+)$`), to: '($2) + ($1)' },
  { re: /^add (.+)$/, to: 'ans + ($1)' },
  { re: new RegExp(`^(?:subtract|take away|take|deduct) ${OPERAND} from (.+)$`), to: '($2) - ($1)' },
  { re: /^(?:subtract|take away|deduct) (.+)$/, to: 'ans - ($1)' },
  {
    re: /^minus (.+)$/,
    to: 'ans - ($1)',
    note: 'Read "minus …" as continuing from the previous result',
    alt: { to: '-($1)', label: 'negative number instead' },
  },
  { re: new RegExp(`^multiply ${OPERAND} by (.+)$`), to: '($1) * ($2)' },
  { re: /^(?:multiply (?:it |that )?by|times) (.+)$/, to: 'ans * ($1)' },
  { re: new RegExp(`^divide ${OPERAND} by (.+)$`), to: '($1) / ($2)' },
  { re: /^(?:divide (?:it |that )?by|divided by) (.+)$/, to: 'ans / ($1)' },
  { re: new RegExp(`^(?:increase|raise|grow) ${OPERAND} by (.+)$`), to: '($1) + ($2)' },
  { re: new RegExp(`^(?:decrease|reduce|lower|discount) ${OPERAND} by (.+)$`), to: '($1) - ($2)' },
  // "the square of 5", "the cube of 3" (but not "the square root of …", handled by the phrase rules)
  { re: /^(?:the )?square of (.+)$/, to: '($1)^2' },
  { re: /^(?:the )?cube of (.+)$/, to: '($1)^3' },
  { re: /^square (?!root\b)(.+)$/, to: '($1)^2' },
  { re: /^cube (?!root\b)(.+)$/, to: '($1)^3' },
  { re: new RegExp(`^(?:the )?sum of ${OPERAND} and (.+)$`), to: '($1) + ($2)' },
  { re: new RegExp(`^(?:the )?product of ${OPERAND} and (.+)$`), to: '($1) * ($2)' },
  { re: new RegExp(`^(?:the )?difference (?:between|of) ${OPERAND} and (.+)$`), to: '($1) - ($2)' },
  { re: new RegExp(`^(?:the )?quotient of ${OPERAND} and (.+)$`), to: '($1) / ($2)' },
  { re: /^(?:the )?(?:average|mean) of (.+)$/, to: 'avg($1)' },
  { re: /^let ([a-z]\w*) (?:be|equal|equals|=) (.+)$/, to: '$1 = $2' },
  { re: /^set ([a-z]\w*) (?:to|=) (.+)$/, to: '$1 = $2' },
  { re: /^([a-z]\w*) (?:is|equals) (.+)$/, to: '$1 = $2' },
  { re: /^define ([a-z]\w*) (?:as|to be|=) (.+)$/, to: '$1 = $2' },
  { re: /^(?:store|save|put) (.+) (?:in|into|as) ([a-z]\w*)$/, to: '$2 = $1' },
];

export function normalize(input: string, opts: NormalizeOptions = {}): Normalized {
  const notes: string[] = [];
  const alternatives: Normalized['alternatives'] = [];
  let s = input.toLowerCase().trim();
  if (/[⁰¹⁴-⁹⁻½⅓⅔¼¾⅕⅛₀-₉]/.test(s)) s = unicodeNumbers(s);

  s = s
    .replace(/[×✕✖∙·⋅]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/√/g, ' sqrt ')
    .replace(/∛/g, ' cbrt ')
    // Symbols from the symbol menu: ∜16 is root(16, 4); φ the golden ratio; ℯ Euler's number; ∞, ∑ and ∏ as words.
    .replace(/∜\s*(\([^()]*\)|[\d.]+|[a-z]\w*)/g, ' root($1, 4) ')
    .replace(/[φϕ]/g, ' phi ')
    .replace(/ℯ/g, ' e ')
    .replace(/∞/g, ' infinity ')
    .replace(/∑/g, ' sum ')
    .replace(/∏/g, ' product ')
    .replace(/π/g, ' pi ')
    .replace(/τ/g, ' tau ')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/\*\*/g, '^')
    .replace(/:=|←/g, '=')
    .replace(/’/g, "'");
  // Regional and textbook function names: tg/ctg/arctg (Europe, Russia), sen (Spanish/Portuguese), cosec, lg = log₁₀.
  if (/\b(?:a?r?c?c?tg|cotg|cosec|sen|lg)\b/.test(s)) s = s.replace(/\b(arcctg|arctg|ctg|cotg|tg|cosec|sen|lg)\b/g, (w) => REGIONAL_FN[w]!);
  // "log2(x)" / "log_2 x" is log base 2; "sin^2 x" is (sin x)².
  if (/log_?\d/.test(s)) s = s.replace(/\blog_?(\d+)\s*(?=[(a-z\d])/g, 'logb$1 ');
  if (/[a-z]\^\d/.test(s)) s = s.replace(/(^|[^a-z])(sin|cos|tan|sec|csc|cot|sinh|cosh|tanh)\s*\^\s*(\d+)\s*(\([^()]*\)|[a-z0-9.]+(?:\^\d+)?)/g, '$1($2($4))^$3');

  // Money in arithmetic: "18% of $64.50", "€12 * 3", "15% off a $80 …". The symbol is dropped; amounts are plain numbers here.
  s = s.replace(/\ban? (?=[$€£¥₹]\s?\d)/g, '');
  s = s.replace(/[$€£¥₹](?=\s?[\d.])/g, '').replace(/(\d)\s?(?:usd|dollars?|bucks|eur|euros?)\b(?!\s+(?:to|in|into)\b)/g, '$1');

  if (opts.decimalSeparator === ',') {
    // 1.234,5 → 1234.5 ; function arguments use ";" in these locales.
    s = s.replace(/(\d)\.(?=\d{3}\b)/g, '$1').replace(/(\d),(\d)/g, '$1.$2').replace(/;/g, ',');
  } else {
    // No lookbehind (Safari < 16.4): capture the preceding character and put it back.
    if (/\d,\d\d,\d/.test(s)) s = s.replace(/(^|[^\d(,.])(\d{1,2}(?:,\d\d)+,\d{3})(?![\d,])/g, (_m, pre: string, n: string) => pre + n.replace(/,/g, ''));
    s = s.replace(/(^|[^\d(,.])(\d{1,3})((?:,\d{3})+)(?![\d,])/g, (_m, pre: string, a: string, b: string) => pre + a + b.replace(/,/g, ''));
  }

  s = s.replace(/[?.]+$/, '').replace(/([^\d)\s!])!+$/, '$1').trim();
  s = s.replace(/\s*=\s*$/, '').replace(/\s+equals?$/, '');
  s = s.replace(LEAD_FILLER, '').replace(LEAD_QUESTION, '').replace(/\bplease\b/g, '').trim();

  s = s.replace(/\ban? (hundred|thousand|million|billion|trillion)\b/g, 'one $1');
  // "point five" with no whole part is 0.5 ("five point five" keeps its 5).
  if (s.includes('point')) s = s.replace(LEADING_POINT, (m, prev: string | undefined, gap: string | undefined) =>
    prev !== undefined && (NUMBER_WORDS.has(prev) || /\d$/.test(prev)) ? m : `${prev ?? ''}${gap ?? ''}zero point`,
  );
  s = s.replace(NUMBER_WORD, (run) => convertRun(run));
  if (s.includes('point')) s = s.replace(/(^|[^\d\s.])(\s*)point (\d+)\b/g, '$1$20.$3');
  // Digit + scale word: "2.5 million", "3 hundred".
  // Patterns that begin with a digit run are anchored with \b: unanchored, a long run of digits makes them quadratic.
  s = s.replace(/\b(\d+(?:\.\d+)?)\s*(hundred|thousand|million|billion|trillion|lakhs?|crores?)\b/g, (_m, n: string, w: string) => shift(n, SCALE_ZEROS[w.replace(/s$/, '')]!));
  if (/[万億亿兆‰]|basis point|bps/.test(s)) s = s.replace(/(\d+(?:\.\d+)?)\s*(万|億|亿|兆)/g, (_m, n: string, w: string) => shift(n, CJK_ZEROS[w]!)).replace(/(\d+(?:\.\d+)?)\s*‰/g, '($1/1000)').replace(/\b(\d+(?:\.\d+)?)\s*(?:basis points?|bps)\b/g, '($1/100)%');
  // nCr notations: C(5,2), A(5,2) / P(5,2) (permutations), 5C2, ⁵C₂ (superscripts already read as ^5).
  if (/\b[cap]\s*\(\s*\d|\d\s*[cp]\s*\d/.test(s)) s = s.replace(/\b([cap])\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/g, (_m, f: string, n: string, k: string) => `${f === 'c' ? 'ncr' : 'npr'}(${n},${k})`).replace(/\b(\d+)\s*([cp])\s*(\d+)\b/g, (_m, n: string, f: string, k: string) => `${f === 'c' ? 'ncr' : 'npr'}(${n},${k})`);
  // Money words after spoken numbers ("twelve dollars times 3"), now that the number is digits.
  s = s.replace(/(\d)\s?(?:usd|dollars?|bucks|eur|euros?)\b(?!\s+(?:to|in|into)\b)/g, '$1');
  s = s.replace(/\b(\d+) and (?:a|one) half\b/g, '($1 + 1/2)');
  s = s.replace(/\b(\d+) and (?:a|one) quarter\b/g, '($1 + 1/4)');
  s = s.replace(/\b(\d+) and (\d+) (halves|thirds|quarters|fourths|fifths|sixths|sevenths|eighths|ninths|tenths)\b/g, (_m, w, n, d) => `(${w} + ${n}/${DENOMINATORS[d!]})`);
  s = s.replace(
    /\b(\d+|an?) (halves|half|thirds?|quarters?|fourths?|fifths?|sixths?|sevenths?|eighths?|ninths?|tenths?|hundredths?|thousandths?)\b(?! root)/g,
    (_m, n: string, d: string) => `(${n === 'a' || n === 'an' ? 1 : n}/${DENOMINATORS[d]})`,
  );

  s = s.replace(/\b(?:the )?original (?:number|value|amount|price|total)\b|\bthe original\b/g, 'base');
  s = s.replace(/\b(?:the )?(?:previous|last) (?:result|answer|number|value)\b|\bthe (?:result|answer|total)\b|\b(?:that|it|this)\b/g, 'ans');
  s = s.replace(/\s+/g, ' ').trim();

  for (const c of COMMANDS) {
    const m = c.re.exec(s);
    if (!m) continue;
    const sub = (tpl: string) => tpl.replace(/\$(\d)/g, (_x, k: string) => m[Number(k)] ?? '');
    if (c.alt) alternatives.push({ text: finish(sub(c.alt.to)), label: c.alt.label });
    if (c.note) notes.push(c.note);
    s = sub(c.to);
    if (s.startsWith('avg(')) s = s.replace(/\s+and\s+/g, ', ');
    break;
  }

  // Spoken "x 3" at the start continues the previous result ("times 3"); "x" alone stays a variable.
  s = s.replace(/^x\s+(?=\d)/, '* ');
  s = finish(s);
  if (opts.hasPrevious === false) {
    // Nothing to continue from: "+5" / "plus 5" is simply 5, "minus 5" is −5; "*2" can't mean anything yet.
    if (/^\+/.test(s)) {
      notes.push('No previous result yet, so the leading + is just a sign');
      return { text: s.replace(/^\+\s*/, ''), alternatives: [], notes };
    }
    if (/^ans - \(/.test(s) && alternatives.length) {
      const neg = alternatives.pop()!;
      notes.pop();
      notes.push('No previous result yet, so this is a negative number');
      return { text: neg.text, alternatives, notes };
    }
    const op = /^(?:([*/^])|(mod)\b)/.exec(s) ?? /^ans ([*/^]|mod)\s/.exec(s);
    if (op) {
      const typed = input.trim();
      throw new MathError(
        'ambiguous-reference',
        `“${typed}” continues from the previous result, and there isn't one yet. Start with a number, e.g. “3 ${op[1] ?? op[2]} ${typed.replace(/^\D*/, '') || '2'}”.`,
      );
    }
  }
  if (/^(?:[+*/^]|mod\b)/.test(s)) s = `ans ${s}`;
  return { text: s, alternatives, notes };
}

const REGIONAL_FN: Record<string, string> = { arcctg: 'acot', arctg: 'atan', ctg: 'cot', cotg: 'cot', tg: 'tan', cosec: 'csc', sen: 'sin', lg: 'log' };
const VULGAR: Record<string, string> = { '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4', '⅕': '1/5', '⅛': '1/8' };
const SUPERS = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/** "x⁴" → x^4, "10⁻³" → 10^-3, "1½" → (1 + 1/2), "¾" → (3/4). */
function unicodeNumbers(s: string): string {
  return s
    .replace(/([⁰¹²³⁴⁵⁶⁷⁸⁹]+)\s*([cp])\s*([₀-₉]+)/g, (_m, n: string, f: string, k: string) => `${f === 'c' ? 'ncr' : 'npr'}(${[...n].map((c) => SUPERS.indexOf(c)).join('')},${[...k].map((c) => c.charCodeAt(0) - 0x2080).join('')})`)
    .replace(/[₀-₉]/g, (c) => String(c.charCodeAt(0) - 0x2080))
    .replace(/(\d)\s?([½⅓⅔¼¾⅕⅛])/g, (_m, d: string, f: string) => `(${d} + ${VULGAR[f]})`)
    .replace(/[½⅓⅔¼¾⅕⅛]/g, (f) => `(${VULGAR[f]})`)
    .replace(/⁻?[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => `^${m.startsWith('⁻') ? '-' : ''}${[...m.replace('⁻', '')].map((c) => SUPERS.indexOf(c)).join('')}`);
}

function finish(s: string): string {
  for (const r of PHRASES) s = s.replace(r.re, r.to as never);
  // "x" means times when it stands alone between operands ("3 x 4", "(2+1) x (3)") or sits between two digits
  // ("3x4"). Attached to a number before a bracket ("2x(x+1)", "24x (3x^2+2)^3") it is the variable.
  s = s.replace(/([\d)])\s+x\s+(?=[\d(.])/g, '$1 * ').replace(/(\d)x(?=\d)/g, '$1 * ');
  s = s.replace(/\bthe\b/g, '');
  return s.replace(/\s+/g, ' ').trim();
}

/** Multiplies a decimal string by 10^k without float error. */
function shift(n: string, k: number): string {
  const [ip = '0', fp = ''] = n.split('.');
  const digits = ip + fp.padEnd(k, '0');
  const intLen = ip.length + k;
  const res = digits.slice(0, intLen) + (digits.length > intLen ? `.${digits.slice(intLen)}` : '');
  return res.replace(/^0+(?=\d)/, '');
}

/**
 * Splits one spoken run of steps into sequential calculations: "5 plus 3 then times 2 then minus 4" →
 * ["5 plus 3", "times 2", "minus 4"]. Each later step continues from the previous result, so the order of
 * operations follows what was said, not operator precedence. A single step comes back unchanged.
 */
export function splitChain(input: string): string[] {
  const parts = input
    .split(/\s*[,;]?\s*\b(?:and then|then|after that|and finally|next)\b\s*[,:]?\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts : [input.trim()];
}

/** Reads a {…} group starting at s[i] === '{'; returns [content, index after the group]. */
function group(s: string, i: number): [string, number] {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}' && --depth === 0) return [s.slice(i + 1, j), j + 1];
  }
  return [s.slice(i + 1), s.length];
}

/** A sub/superscript argument: "{…}" or a single character. */
function script(s: string, i: number): [string, number] {
  while (s[i] === ' ') i++;
  if (s[i] === '{') return group(s, i);
  if (s[i] === '\\') {
    const m = /^\\[a-z]+/i.exec(s.slice(i));
    if (m) return [m[0], i + m[0].length];
  }
  return [s[i] ?? '', i + 1];
}

const LATEX_WORDS: Record<string, string> = {
  cdot: '*', times: '*', div: '/', pi: 'π', infty: 'infinity', le: '≤', leq: '≤', ge: '≥', geq: '≥', neq: '≠', ne: '≠', to: '->', rightarrow: '->',
  pm: '±', lt: '<', gt: '>', degree: '°', circ: '°', approx: '≈', cdots: '...', ldots: '...', dots: '...', in: 'in', land: 'and', lor: 'or', lnot: 'not', neg: 'not', wedge: 'and', vee: 'or',
  cup: 'union', cap: 'intersect', setminus: 'minus', subseteq: 'subset of', subset: 'subset of', mid: '|', equiv: '≡', implies: 'implies', iff: 'iff',
};

/**
 * LaTeX input ("\frac{1}{2}", "\sqrt[3]{27}", "x^{2}", "\int_0^1 x^2 dx", "\lim_{x \to 0} …", "\sum_{k=1}^{n} k") to
 * Lemma's plain syntax. Only called when the input contains a backslash or "^{"/"_{".
 */
export function delatex(input: string): string {
  let s = input.replace(/\\(?:left|right|big|Big|bigg|Bigg)\b\s*/g, '').replace(/\\[,;:! ]/g, ' ').replace(/\\(?:mathrm|text|mathit|operatorname|mathbf|displaystyle)\b\s*/g, '').replace(/\$/g, '');
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === '\\') {
      const m = /^\\([a-z]+)/i.exec(s.slice(i));
      if (!m) {
        out += s[i + 1] ?? '';
        i += 2;
        continue;
      }
      const w = m[1]!;
      i += m[0].length;
      if (w === 'frac' || w === 'dfrac' || w === 'tfrac') {
        const [a, j] = script(s, i);
        const [b, k] = script(s, j);
        i = k;
        if (a === 'd' && /^d[a-z]$/.test(b)) out += ` d/${b} `;
        else out += `((${delatex(a)})/(${delatex(b)}))`;
      } else if (w === 'sqrt') {
        let n = '';
        if (s[i] === '[') {
          const e = s.indexOf(']', i);
          n = s.slice(i + 1, e);
          i = e + 1;
        }
        const [a, j] = script(s, i);
        i = j;
        out += n ? `root(${delatex(a)}, ${n})` : `sqrt(${delatex(a)})`;
      } else if (w === 'binom') {
        const [a, j] = script(s, i);
        const [b, k] = script(s, j);
        i = k;
        out += `ncr(${delatex(a)}, ${delatex(b)})`;
      } else if (w === 'int' || w === 'iint' || w === 'sum' || w === 'prod' || w === 'lim') {
        let lo = '';
        let hi = '';
        for (let t = 0; t < 2; t++) {
          while (s[i] === ' ') i++;
          if (s[i] === '_') [lo, i] = script(s, i + 1);
          else if (s[i] === '^') [hi, i] = script(s, i + 1);
        }
        const rest = delatex(s.slice(i)).trim();
        i = s.length;
        lo = delatex(lo);
        hi = delatex(hi);
        if (w === 'lim') {
          const lm = /^([a-z])\s*->\s*(.+)$/i.exec(lo.trim());
          out += lm ? `limit of ${rest} as ${lm[1]} -> ${lm[2]!.replace(/\^\(?([+-])\)?$/, '$1')}` : `limit of ${rest}`;
        } else if (w === 'sum' || w === 'prod') {
          const sm = /^([a-z])\s*=\s*(.+)$/i.exec(lo.trim());
          out += sm ? `${w === 'sum' ? 'sum' : 'product'} of ${rest} for ${sm[1]} = ${sm[2]} to ${hi || 'infinity'}` : `${w} of ${rest}`;
        } else {
          out += `${w === 'iint' ? 'double integral of' : 'integrate'} ${rest}${lo || hi ? ` from ${lo} to ${hi}` : ''}`;
        }
      } else out += LATEX_WORDS[w] !== undefined ? ` ${LATEX_WORDS[w]} ` : ` ${w} `;
      continue;
    }
    if ((c === '^' || c === '_') && s[i + 1] === '{') {
      const [a, j] = group(s, i + 1);
      out += c === '^' ? `^(${delatex(a)})` : `_${a}`;
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  // Integrals: "integrate x^2 dx from 0 to 1" reads better with the bounds after the differential.
  return out.replace(/\s+/g, ' ').replace(/^integrate (.+?) from (\S+) to (\S+?) (.+)$/, 'integrate $4 from $2 to $3').trim();
}
