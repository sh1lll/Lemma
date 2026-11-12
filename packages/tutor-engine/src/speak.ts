/**
 * Turns written math ("2x + 3 = 11", "x^2 − 5x + 6", "$84.50", "cm²") into words a tutor would say
 * ("two x plus three equals eleven"). Works on mixed sentences: ordinary words pass through unchanged.
 */

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES: [number, string][] = [
  [1e12, 'trillion'],
  [1e9, 'billion'],
  [1e6, 'million'],
  [1e3, 'thousand'],
];

function under1000(n: number): string {
  const out: string[] = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h) out.push(`${ONES[h]} hundred`);
  if (r) out.push(r < 20 ? ONES[r]! : TENS[Math.floor(r / 10)]! + (r % 10 ? `-${ONES[r % 10]}` : ''));
  return out.join(' ');
}

/** Whole numbers in words: 1234 → "one thousand two hundred thirty-four". */
export function intWords(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (n < 0) return `negative ${intWords(-n)}`;
  n = Math.round(n);
  if (n < 1000) return n === 0 ? 'zero' : under1000(n);
  if (n >= 1e15) return String(n);
  const out: string[] = [];
  let rest = n;
  for (const [size, name] of SCALES) {
    if (rest >= size) {
      out.push(`${under1000(Math.floor(rest / size))} ${name}`);
      rest %= size;
    }
  }
  if (rest) out.push(under1000(rest));
  return out.join(' ');
}

const ORD_SPECIAL: Record<string, string> = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };

/** 4 → "fourth", 28 → "twenty-eighth". */
export function ordinal(n: number): string {
  const w = intWords(n);
  const m = /^(.*?)([a-z]+)$/.exec(w);
  if (!m) return w;
  const last = m[2]!;
  let o: string;
  if (ORD_SPECIAL[last]) o = ORD_SPECIAL[last]!;
  else if (last.endsWith('y')) o = `${last.slice(0, -1)}ieth`;
  else o = `${last}th`;
  return m[1] + o;
}

/** "3/4" → "three fourths", "1/2" → "one half", "5/120" → "five over one hundred twenty". */
export function fractionWords(num: number, den: number): string {
  if (den === 1) return intWords(num);
  if (den <= 0 || den > 100 || !Number.isInteger(den) || !Number.isInteger(num)) return `${numberWords(String(num))} over ${numberWords(String(den))}`;
  const neg = num < 0;
  const a = Math.abs(num);
  let d: string;
  if (den === 2) d = a === 1 ? 'half' : 'halves';
  else d = ordinal(den) + (a === 1 ? '' : 's');
  return `${neg ? 'negative ' : ''}${intWords(a)} ${d}`;
}

/** Any written number ("1,609.344", "0.15", "70000.00") in words. */
export function numberWords(s: string): string {
  const t = s.replace(/,/g, '').replace(/^−/, '-');
  const neg = t.startsWith('-');
  const body = neg ? t.slice(1) : t;
  const [i = '0', f = ''] = body.split('.');
  const frac = f.replace(/0+$/, '');
  let w = intWords(Number(i || '0'));
  if (frac) w += ' point ' + [...frac].map((d) => ONES[Number(d)]).join(' ');
  return (neg ? 'negative ' : '') + w;
}

/** "$12.68" → "twelve dollars and sixty-eight cents". */
export function moneyWords(s: string): string {
  const t = s.replace(/,/g, '');
  const [d = '0', c = ''] = t.split('.');
  const dollars = Number(d);
  const cents = c ? Math.round(Number(`0.${c}`) * 100) : 0;
  const parts: string[] = [];
  if (dollars || !cents) parts.push(`${intWords(dollars)} dollar${dollars === 1 ? '' : 's'}`);
  if (cents) parts.push(`${intWords(cents)} cent${cents === 1 ? '' : 's'}`);
  return parts.join(' and ');
}

const UNIT_WORDS: Record<string, [string, string]> = {
  km: ['kilometer', 'kilometers'],
  m: ['meter', 'meters'],
  cm: ['centimeter', 'centimeters'],
  mm: ['millimeter', 'millimeters'],
  mi: ['mile', 'miles'],
  ft: ['foot', 'feet'],
  in: ['inch', 'inches'],
  yd: ['yard', 'yards'],
  kg: ['kilogram', 'kilograms'],
  g: ['gram', 'grams'],
  mg: ['milligram', 'milligrams'],
  lb: ['pound', 'pounds'],
  lbs: ['pound', 'pounds'],
  oz: ['ounce', 'ounces'],
  L: ['liter', 'liters'],
  mL: ['milliliter', 'milliliters'],
  gal: ['gallon', 'gallons'],
  qt: ['quart', 'quarts'],
  h: ['hour', 'hours'],
  s: ['second', 'seconds'],
  min: ['minute', 'minutes'],
};
const UNIT_RE = /^(km\/h|m\/s|mph|cm³|cm\^3|m³|m\^3|ft³|m²|m\^2|cm²|cm\^2|ft²|ft\^2|in²|in³|km|cm|mm|mi|ft|in|yd|kg|mg|lbs|lb|oz|mL|ml|gal|qt|min|m|g|L|h|s)(?![A-Za-z])/;

function unitWords(u: string, one: boolean): string {
  const special: Record<string, [string, string]> = {
    'km/h': ['kilometer per hour', 'kilometers per hour'],
    'm/s': ['meter per second', 'meters per second'],
    mph: ['mile per hour', 'miles per hour'],
  };
  if (special[u]) return special[u]![one ? 0 : 1];
  const sq = /^(.+?)(?:²|\^2)$/.exec(u);
  if (sq) return `square ${unitWords(sq[1]!, one)}`;
  const cu = /^(.+?)(?:³|\^3)$/.exec(u);
  if (cu) return `cubic ${unitWords(cu[1]!, one)}`;
  const k = u === 'ml' ? 'mL' : u;
  const w = UNIT_WORDS[k];
  return w ? w[one ? 0 : 1] : u;
}

const FUNCS: Record<string, string> = { sin: 'sine of', cos: 'cosine of', tan: 'tangent of', ln: 'the natural log of', log: 'log of', sqrt: 'the square root of', exp: 'e to the' };
const GREEK: Record<string, string> = { π: 'pi', σ: 'sigma', μ: 'mu', θ: 'theta', Δ: 'delta', α: 'alpha', β: 'beta' };
const ALGEBRA_WORDS = new Set(['xy', 'lw', 'bh', 'nt', 'kx', 'ac', 'ab', 'xyz', 'dx', 'du', 'dv', 'rt', 'pr', 'uv']);
const VULGAR: Record<string, string> = { '½': 'one half', '⅓': 'one third', '¼': 'one fourth', '¾': 'three fourths', '⅔': 'two thirds' };

type Tok = { t: 'num' | 'word' | 'sym' | 'space'; v: string };

function lexMath(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    const sp = /^\s+/.exec(rest);
    if (sp) {
      out.push({ t: 'space', v: sp[0] });
      i += sp[0].length;
      continue;
    }
    const n = /^(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)/.exec(rest);
    if (n) {
      out.push({ t: 'num', v: n[0] });
      i += n[0].length;
      continue;
    }
    const w = /^[A-Za-z]+(?:['’][a-z]+|-[A-Za-z]{2,})*/.exec(rest);
    if (w) {
      out.push({ t: 'word', v: w[0] });
      i += w[0].length;
      continue;
    }
    // Two-character symbols first.
    const two = rest.slice(0, 2);
    if (two === '⁴⁄' && rest[2] === '₃') {
      out.push({ t: 'sym', v: '⁴⁄₃' });
      i += 3;
      continue;
    }
    if (two === '°C' || two === '°F') {
      out.push({ t: 'sym', v: two });
      i += 2;
      continue;
    }
    out.push({ t: 'sym', v: s[i]! });
    i++;
  }
  return out;
}

const isOperand = (tok: Tok | undefined) => !!tok && (tok.t === 'num' || (tok.t === 'word' && tok.v.length <= 3 && /^[a-zA-Z]$|^(?:xy|lw|bh|nt|kx|ac|ab)$/.test(tok.v)) || (tok.t === 'sym' && /[)²³π′']/.test(tok.v)));

/**
 * Speaks a line of written math or a sentence containing math. Output is plain spoken English, with
 * ordinary punctuation kept so a voice pauses in the right places.
 */
export function speak(input: string): string {
  const s = input
    .replace(/ⁿ⁻¹/g, ' to the n minus one ')
    .replace(/ⁿ⁺¹/g, ' to the n plus one ')
    .replace(/ⁿ/g, ' to the n ')
    .replace(/\\,|\\;|\\ /g, ' ')
    .replace(/—|–/g, ', ')
    .replace(/“|”/g, '"');
  const toks = lexMath(s);
  const out: string[] = [];
  const sig = (i: number, dir: 1 | -1): Tok | undefined => {
    for (let j = i + dir; j >= 0 && j < toks.length; j += dir) if (toks[j]!.t !== 'space') return toks[j];
    return undefined;
  };
  const push = (w: string) => out.push(w);
  /** Units straight after a quantity ("5 km", "30 cm²", "9π cm²"): speaks them and returns the last token used. */
  const unitAfter = (i: number, one: boolean): number => {
    let j = i + 1;
    if (toks[j]?.t === 'space') j++;
    const after = toks.slice(j, j + 3).map((t) => t.v).join('');
    const um = UNIT_RE.exec(after);
    if (!um || !toks[j] || (toks[j]!.t !== 'word' && toks[j]!.v !== '°')) return i;
    // Only treat a lone letter as a unit when nothing algebraic follows it.
    const consumed = um[1]!;
    let len = 0, k = j;
    while (k < toks.length && len < consumed.length) len += toks[k++]!.v.length;
    const follow = toks[k];
    const algebraic = /^[a-z]$/.test(consumed) && follow?.t === 'sym' && /[\^(²³]/.test(follow.v);
    const isVar = consumed === 'm' || consumed === 's' || consumed === 'h' || consumed === 'g' ? !!(follow && follow.t === 'sym' && /[=+\-−×*]/.test(follow.v)) : false;
    // "5 in to cm" is inches; "5 in the box" is not.
    const inWord = consumed === 'in' && toks[k]?.t === 'space' && toks[k + 1]?.t === 'word' && !/^(?:and|or|by|long|wide|tall|high|to|into|as)$/.test(toks[k + 1]!.v);
    if (len !== consumed.length || algebraic || isVar || inWord) return i;
    push(unitWords(consumed, one));
    return k - 1;
  };
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i]!;
    const prev = sig(i, -1);
    const next = sig(i, 1);
    const prevRaw = toks[i - 1];
    if (tok.t === 'space') continue;
    if (tok.t === 'num') {
      // Money: "$12.68".
      if (prevRaw?.t === 'sym' && prevRaw.v === '$') {
        push(moneyWords(tok.v));
        continue;
      }
      // Fraction "3/4" (no spaces), not part of a longer chain like 1/2/3.
      const t1 = toks[i + 1], t2 = toks[i + 2], t3 = toks[i + 3];
      if (t1?.t === 'sym' && t1.v === '/' && t2?.t === 'num' && !/\./.test(tok.v + t2.v) && !(t3?.t === 'sym' && /[\^/]/.test(t3.v)) && !(t3?.t === 'word')) {
        const neg = out.length > 0 && out[out.length - 1] === 'negative';
        if (neg) out.pop();
        push(fractionWords((neg ? -1 : 1) * Number(tok.v.replace(/,/g, '')), Number(t2.v)));
        i += 2;
        continue;
      }
      push(numberWords(tok.v));
      i = unitAfter(i, Number(tok.v.replace(/,/g, '')) === 1);
      continue;
    }
    if (tok.t === 'word') {
      const w = tok.v;
      const nextRaw = toks[i + 1];
      if (FUNCS[w] && w !== 'exp') {
        const bare: Record<string, string> = { sin: 'sine', cos: 'cosine', tan: 'tangent', ln: 'natural log', log: 'log', sqrt: 'square root' };
        const takesArg = nextRaw?.v === '(' || (next && (next.t === 'num' || (next.t === 'word' && (next.v.length === 1 || ALGEBRA_WORDS.has(next.v)))));
        push(takesArg ? FUNCS[w]! : bare[w]!);
        continue;
      }
      if (w === 'd' && nextRaw?.v === '/' && toks[i + 2]?.v === 'dx') {
        push('the derivative with respect to x of');
        i += 2;
        continue;
      }
      if (w === 'dx' || w === 'du' || w === 'dv') {
        push(`d ${w[1]}`);
        continue;
      }
      // Function notation: f(x) → "f of x", F(2) → "F of 2".
      if (/^[fgFh]$/.test(w) && nextRaw?.v === '(') {
        push(`${w} of`);
        continue;
      }
      if (/^[fgFh]$/.test(w) && (nextRaw?.v === "'" || nextRaw?.v === '′')) {
        push(`${w} prime`);
        i++;
        if (toks[i + 1]?.v === '(') push('of');
        continue;
      }
      const glued = prevRaw?.t === 'num' || (prevRaw?.t === 'sym' && /[)²³]/.test(prevRaw.v));
      if (ALGEBRA_WORDS.has(w) || (glued && /^[a-z]{2,3}$/.test(w) && !/^(?:and|or|to|of|is|in|by|per)$/.test(w))) {
        push([...w].join(' '));
        continue;
      }
      // A unit named on its own: "to mi", "in cm²".
      if (w.length >= 2 && prev?.t === 'word' && /^(?:to|in|into|as)$/.test(prev.v)) {
        const um = UNIT_RE.exec(toks.slice(i, i + 2).map((t) => t.v).join(''));
        if (um && um[1]!.length >= w.length && um[1] !== 'in') {
          push(unitWords(um[1]!, false));
          if (um[1]!.length > w.length) i++;
          continue;
        }
      }
      push(w);
      continue;
    }
    // Symbols.
    const v = tok.v;
    switch (v) {
      case '+':
        push('plus');
        break;
      case '-':
      case '−': {
        const unary = !prev || !isOperand(prev) || (prev.t === 'word' && prev.v.length > 1 && !ALGEBRA_WORDS.has(prev.v));
        push(unary ? 'negative' : 'minus');
        break;
      }
      case '×':
      case '*':
      case '·':
        push('times');
        break;
      case '÷':
        push('divided by');
        break;
      case '/':
        push(toks[i - 1]?.t === 'space' ? 'divided by' : 'over');
        break;
      case '=':
        push('equals');
        break;
      case '≈': {
        let k = out.length - 1;
        let sawEquals = false;
        while (k >= 0 && !/[,:;.]$/.test(out[k]!)) {
          if (out[k] === 'equals') sawEquals = true;
          k--;
        }
        const last = out[out.length - 1];
        if (!last || /[,:;.]$/.test(last) || last === 'equals') push('about');
        else if (sawEquals) {
          out[out.length - 1] += ',';
          push('which is about');
        } else push('is about');
        break;
      }
      case '±':
        push('plus or minus');
        break;
      case '<':
        push('is less than');
        break;
      case '>':
        push('is greater than');
        break;
      case '≤':
        push('is at most');
        break;
      case '≥':
        push('is at least');
        break;
      case '%':
        push('percent');
        break;
      case '²':
        push('squared');
        break;
      case '³':
        push('cubed');
        break;
      case '√': {
        const glued = isOperand(prev) && toks[i - 1]?.t !== 'space';
        push(glued ? 'root' : 'the square root of');
        break;
      }
      case '∫':
        push(next?.t === 'word' && next.v === 'from' ? 'the integral' : 'the integral of');
        break;
      case '°C':
        push('degrees Celsius');
        break;
      case '°F':
        push('degrees Fahrenheit');
        break;
      case '°':
        push('degrees');
        break;
      case '′':
      case "'":
        if (prev?.t === 'word') push('prime');
        break;
      case '⁴⁄₃':
        push('four thirds');
        break;
      case '^': {
        const n1 = toks[i + 1], n2 = toks[i + 2];
        if (prevRaw?.t === 'sym' && prevRaw.v === ')') {
          // "(x + 1)^2" is "x plus one, all squared"; "(−7)^2" is just "negative seven squared".
          let depth = 0, k = i - 1, inner = 0;
          for (; k >= 0; k--) {
            const v = toks[k]!.v;
            if (v === ')') depth++;
            else if (v === '(' && --depth === 0) break;
            else if (toks[k]!.t !== 'space') inner++;
          }
          if (inner > 2) {
            if (out.length) out[out.length - 1] += ',';
            push('all');
          }
        }
        if (n1?.t === 'num') {
          const k = Number(n1.v);
          push(k === 2 ? 'squared' : k === 3 ? 'cubed' : `to the ${ordinal(k)}`);
          i++;
        } else if ((n1?.v === '-' || n1?.v === '−') && n2?.t === 'num') {
          push(`to the negative ${intWords(Number(n2.v))}`);
          i += 2;
        } else if (n1?.v === '(') {
          push('to the power of');
        } else push('to the');
        break;
      }
      case '(':
        // "3(x + 1)" and ")(" read as multiplication; between two brackets, a pause keeps the groups apart:
        // "(x − 2)(x − 3)" is "x minus two, times x minus three".
        if (prevRaw?.t === 'sym' && prevRaw.v === ')') {
          if (out.length && !/[,;:]$/.test(out[out.length - 1]!)) out[out.length - 1] += ',';
          push('times');
        } else if (prevRaw && (prevRaw.t === 'num' || (prevRaw.t === 'word' && /^[A-Za-z]$/.test(prevRaw.v) && !/^[fgFh]$/.test(prevRaw.v)))) push('times');
        break;
      case ')':
        if (toks[i + 1]?.v === '/' && toks[i + 2]?.t !== 'space') {
          if (out.length) out[out.length - 1] += ',';
          push('all over');
          i++;
        }
        break;
      case '$':
        break;
      case ',':
      case '.':
      case ':':
      case ';':
      case '?':
      case '!':
        if (out.length) out[out.length - 1] += v;
        else push(v);
        break;
      case '"':
      case '[':
      case ']':
      case '{':
      case '}':
      case '|':
        break;
      default:
        if (v === 'π') {
          push('pi');
          // "9π cm²" carries a unit; "2πh" is algebra, so the unit must be set off by a space.
          if (toks[i + 1]?.t === 'space') i = unitAfter(i, false);
        } else if (GREEK[v]) push(GREEK[v]!);
        else if (VULGAR[v]) push(VULGAR[v]!);
        else if (/\p{L}/u.test(v)) push(v);
        // Anything else (arrows, stray marks) is silent.
        break;
    }
    void next;
  }
  return out
    .join(' ')
    .replace(/\s+([,.:;?!])/g, '$1')
    .replace(/([,:;])(?=[^\s])/g, '$1 ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\bequals is about\b/g, 'is about')
    .trim();
}

/** Capitalises sentence starts in narration (not single letters like "x equals four"). */
export function sentenceCase(s: string): string {
  return s.replace(/(^|[.?!]\s+)([a-z])(?=[a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
}

/** Speaks a number value that came from a computation (finite JS number). */
export function speakNumber(x: number, dp = 4): string {
  return numberWords(fmt(x, dp));
}

/** Formats a computed number for display: integers stay whole, others are rounded and trimmed. */
export function fmt(x: number, dp = 4): string {
  if (!Number.isFinite(x)) return String(x);
  if (Math.abs(x - Math.round(x)) < 1e-9) return String(Math.round(x)).replace('-', '−');
  const s = x.toFixed(dp).replace(/0+$/, '').replace(/\.$/, '');
  return (s === '-0' ? '0' : s).replace('-', '−');
}
