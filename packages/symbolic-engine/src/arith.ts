import { calculate, createSession, D, formatNumber, type Answer, type AnswerResult, type Dec, type Session, MathError } from '@lemma/math-core';

/**
 * Everyday number work, native and instant: rounding (dp, nearest, significant figures, half-to-even), fractions and
 * mixed numbers, decimal ↔ fraction ↔ percent (incl. repeating decimals), ratios, percent change and reverse percent,
 * unit rates, divisibility, multiples, HCF/LCM, estimation, scientific/engineering notation, time arithmetic,
 * division with remainder, Roman numerals, number words, comma decimals and ':' division.
 */

type Out = Omit<Answer, 'ok' | 'input' | 'kind' | 'notes'> & { notes?: string[] };
const ok = (input: string, a: Out): Answer => ({ ok: true, kind: 'arith', input, notes: [], ...a });
const fail = (input: string, msg: string): AnswerResult => ({ ok: false, kind: 'arith', input, error: new MathError('domain', msg) });
const fmt = (x: Dec) => formatNumber(x).display;
const num = (display: string, value?: Dec) => ({ display, plain: value ? value.toString() : display, spoken: display });

function bgcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Exact fraction of a decimal string or value. */
function frac(x: Dec): [bigint, bigint] {
  const [n, d] = x.toFraction(1e12) as [Dec, Dec];
  return [BigInt(n.toFixed()), BigInt(d.toFixed())];
}

const fracStr = (n: bigint, d: bigint) => (d === 1n ? `${n}` : `${n}/${d}`).replace('-', '−');

function mixed(n: bigint, d: bigint): string {
  if (d === 1n) return `${n}`.replace('-', '−');
  const neg = n < 0n;
  const a = neg ? -n : n;
  const w = a / d;
  const r = a % d;
  return `${neg ? '−' : ''}${w ? `${w} ` : ''}${r}/${d}`;
}

/** Evaluates a plain arithmetic expression exactly with the calculator. */
function val(t: string, s: Session = createSession()): Dec | null {
  const r = calculate(t, s);
  return r.ok ? r.value : null;
}

/** "1 3/4" → "(1 + 3/4)" (mixed numbers inside expressions). */
const MIXED = /(^|[^\d./])(\d+)\s+(\d+)\/(\d+)(?![\d.])/g;
const withMixed = (t: string) => t.replace(MIXED, (_m, pre: string, w: string, n: string, d: string) => `${pre}(${w} + ${n}/${d})`);

function parseDecimalRepeating(t: string): [bigint, bigint] | null {
  // 0.(3), 0.1(6), 0.\overline{3}, 0.333..., 0.1666…, 0.142857142857...
  let m = /^(-?)(\d*)\.(\d*)\((\d+)\)$/.exec(t) ?? /^(-?)(\d*)\.(\d*)\\overline\{(\d+)\}$/.exec(t);
  let sign = '';
  let ip = '';
  let pre = '';
  let rep = '';
  if (m) {
    sign = m[1] ?? '';
    ip = m[2] ?? '';
    pre = m[3] ?? '';
    rep = m[4] ?? '';
  }
  else {
    m = /^(-?)(\d*)\.(\d+)(?:\.\.\.|…)$/.exec(t);
    if (!m) return null;
    sign = m[1] ?? '';
    ip = m[2] ?? '';
    const digits = m[3]!;
    // the shortest block that repeats at the end (at least twice, or a single digit repeated)
    let found: [string, string] | null = null;
    for (let len = 1; len <= Math.floor(digits.length / 2) && !found; len++) {
      for (let start = 0; start + 2 * len <= digits.length; start++) {
        const block = digits.slice(start, start + len);
        const tail = digits.slice(start);
        if (tail === block.repeat(Math.ceil(tail.length / len)).slice(0, tail.length)) {
          found = [digits.slice(0, start), block];
          break;
        }
      }
    }
    if (!found) {
      const last = digits.slice(-1);
      found = [digits.slice(0, -1), last];
    }
    [pre, rep] = found;
  }
  const P = BigInt(`${ip || '0'}${pre}${rep}`) - BigInt(`${ip || '0'}${pre}`);
  const Dn = BigInt('9'.repeat(rep!.length) + '0'.repeat(pre!.length));
  const g = bgcd(P, Dn);
  return [(sign === '-' ? -1n : 1n) * (P / g), Dn / g];
}

const NEAREST: Record<string, number> = { one: 0, unit: 0, units: 0, integer: 0, 'whole number': 0, whole: 0, ten: 1, tens: 1, hundred: 2, hundreds: 2, thousand: 3, thousands: 3, million: 6, tenth: -1, tenths: -1, hundredth: -2, hundredths: -2, thousandth: -3, thousandths: -3 };

function round(input: string, s: string): AnswerResult | null {
  const m = /^round(?:ing)?\s+(-?[\d.,]+)\s*(?:(?:to|correct to)\s+(?:the\s+)?(?:nearest\s+)?(.+?))?(?:\s*,?\s*(?:using\s+)?(half (?:to )?even|banker'?s(?: rounding)?|round half (?:to )?even|half up|half down|down|up|toward zero))?$/i.exec(s);
  if (!m) return null;
  const x = new D(m[1]!.replace(/,/g, ''));
  const to = (m[2] ?? 'whole number').toLowerCase().trim();
  const even = /even|banker/i.test(m[3] ?? '') || /even|banker/.test(to);
  const mode = even ? D.ROUND_HALF_EVEN : /half down/i.test(m[3] ?? '') ? D.ROUND_HALF_DOWN : /^down|toward zero/i.test(m[3] ?? '') ? D.ROUND_DOWN : /^up/i.test(m[3] ?? '') ? D.ROUND_UP : D.ROUND_HALF_UP;
  const label = even ? 'round half to even (banker’s rounding)' : 'round half up';
  let r: Dec;
  let what: string;
  let k: RegExpExecArray | null;
  const cleaned = to.replace(/\s*(?:half (?:to )?even|banker'?s(?: rounding)?)\s*/g, '').trim() || 'whole number';
  if ((k = /^(\d+)\s*(?:decimal places?|dp|d\.p\.?|places?|decimals?)$/.exec(cleaned))) {
    r = x.toDecimalPlaces(Number(k[1]), mode);
    what = `${k[1]} decimal place${k[1] === '1' ? '' : 's'}`;
    return ok(input, { expression: `Round ${m[1]} to ${what}`, primary: num(r.toFixed(Number(k[1])).replace('-', '−'), r), value: r, notes: [`Rule: ${label}`] });
  }
  if ((k = /^(\d+)\s*(?:significant figures?|sig\.? ?figs?|s\.?f\.?|significant digits?)$/.exec(cleaned))) {
    const n = Number(k[1]);
    r = x.toSignificantDigits(n, mode);
    what = `${n} significant figure${n === 1 ? '' : 's'}`;
    const shown = r.isInteger() || r.abs().gte(1e15) || (r.abs().lt(1e-6) && !r.isZero()) ? fmt(r) : r.toFixed(Math.max(0, n - 1 - Math.floor(Math.log10(r.abs().toNumber() || 1))));
    return ok(input, { expression: `Round ${m[1]} to ${what}`, primary: num(shown.replace('-', '−'), r), value: r, notes: [`Rule: ${label}`, 'Leading zeros are not significant'] });
  }
  const p = NEAREST[cleaned] ?? (/^\d+$/.test(cleaned) && /^10*$/.test(cleaned) ? cleaned.length - 1 : undefined);
  if (p === undefined) {
    const step = /^(\d*\.?\d+)$/.exec(cleaned);
    if (!step) return null;
    const st = new D(step[1]!);
    r = x.div(st).toDecimalPlaces(0, mode).mul(st);
    return ok(input, { expression: `Round ${m[1]} to the nearest ${step[1]}`, primary: num(fmt(r), r), value: r, notes: [`Rule: ${label}`] });
  }
  r = p >= 0 ? x.div(10 ** p).toDecimalPlaces(0, mode).mul(10 ** p) : x.toDecimalPlaces(-p, mode);
  const notes = [`Rule: ${label}`];
  const tie = p >= 0 ? x.div(10 ** p).mod(1).abs().eq(0.5) : x.mul(10 ** -p).mod(1).abs().eq(0.5);
  if (tie && !even) {
    const alt = p >= 0 ? x.div(10 ** p).toDecimalPlaces(0, D.ROUND_HALF_EVEN).mul(10 ** p) : x.toDecimalPlaces(-p, D.ROUND_HALF_EVEN);
    if (!alt.eq(r)) notes.push(`Exactly halfway: round-half-to-even (banker’s rounding) would give ${fmt(alt)}`);
  }
  return ok(input, { expression: `Round ${m[1]} to the nearest ${cleaned}`, primary: num(fmt(r), r), value: r, notes });
}

function fractionAnswer(input: string, n: bigint, d: bigint, expression: string, notes: string[] = []): Answer {
  if (d < 0n) [n, d] = [-n, -d];
  const g = bgcd(n, d) || 1n;
  n /= g;
  d /= g;
  const value = new D(n.toString()).div(d.toString());
  const lines = [
    { label: 'Fraction', display: fracStr(n, d) },
    ...(d !== 1n && (n > d || -n > d) ? [{ label: 'Mixed number', display: mixed(n, d) }] : []),
    { label: 'Decimal', display: decimalWithRepeat(n, d) },
    { label: 'Percent', display: `${fmt(value.mul(100))}%` },
  ];
  return ok(input, { expression, primary: num(fracStr(n, d), value), value, lines, notes });
}

/** 1/3 → 0.(3) = 0.333…, 1/8 → 0.125. */
function decimalWithRepeat(n: bigint, d: bigint): string {
  const neg = n < 0n;
  let a = neg ? -n : n;
  const ip = a / d;
  a %= d;
  const seen = new Map<bigint, number>();
  let digits = '';
  while (a && !seen.has(a) && digits.length < 60) {
    seen.set(a, digits.length);
    a *= 10n;
    digits += (a / d).toString();
    a %= d;
  }
  const sign = neg ? '−' : '';
  if (!a) return `${sign}${ip}${digits ? `.${digits}` : ''}`;
  if (!seen.has(a)) return `${sign}${ip}.${digits}…`;
  const at = seen.get(a)!;
  const rep = digits.slice(at);
  return `${sign}${ip}.${digits.slice(0, at)}(${rep}) = ${sign}${ip}.${digits.slice(0, at)}${rep.repeat(Math.max(1, Math.ceil(6 / rep.length))).slice(0, Math.max(6, rep.length))}…`;
}

function toWords(n: bigint, indian = false): string {
  const ones = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  if (n < 0n) return `minus ${toWords(-n, indian)}`;
  const under1000 = (k: number): string => {
    const h = Math.floor(k / 100);
    const r = k % 100;
    const parts: string[] = [];
    if (h) parts.push(`${ones[h]} hundred`);
    if (r) parts.push(r < 20 ? ones[r]! : `${tens[Math.floor(r / 10)]}${r % 10 ? `-${ones[r % 10]}` : ''}`);
    return parts.join(' ');
  };
  if (n === 0n) return 'zero';
  const scales = indian ? [['crore', 10000000n], ['lakh', 100000n], ['thousand', 1000n]] as const : [['quintillion', 10n ** 18n], ['quadrillion', 10n ** 15n], ['trillion', 10n ** 12n], ['billion', 10n ** 9n], ['million', 10n ** 6n], ['thousand', 1000n]] as const;
  const out: string[] = [];
  let rest = n;
  for (const [w, v] of scales) {
    if (rest >= v) {
      const q = rest / v;
      out.push(`${q >= 1000n ? toWords(q, indian) : under1000(Number(q))} ${w}`);
      rest %= v;
    }
  }
  if (rest) out.push(under1000(Number(rest)));
  return out.join(' ');
}

const ROMAN: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
function toRoman(n: number): string {
  let out = '';
  for (const [v, s] of ROMAN) while (n >= v) {
    out += s;
    n -= v;
  }
  return out;
}
function fromRoman(s: string): number | null {
  const t = s.toUpperCase();
  if (!/^M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(t) || !t) return null;
  const v: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  for (let i = 0; i < t.length; i++) {
    const a = v[t[i]!]!;
    const b = v[t[i + 1] ?? ''] ?? 0;
    total += a < b ? -a : a;
  }
  return total;
}

const ORD_WORDS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30, fortieth: 40, fiftieth: 50, sixtieth: 60, seventieth: 70, eightieth: 80, ninetieth: 90, hundredth: 100, thousandth: 1000 };
const ordinalSuffix = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');

function divRules(n: bigint): string[][] {
  const s = n.toString();
  const digitSum = [...s].reduce((a, c) => a + Number(c), 0);
  const rules: [number, string][] = [
    [2, `last digit ${s.slice(-1)} is ${Number(s.slice(-1)) % 2 ? 'odd' : 'even'}`],
    [3, `digit sum ${digitSum}${digitSum % 3 ? ' is not' : ' is'} a multiple of 3`],
    [4, `last two digits ${s.slice(-2)}${Number(s.slice(-2)) % 4 ? ' are not' : ' are'} divisible by 4`],
    [5, `last digit is ${s.slice(-1)}`],
    [6, 'divisible by both 2 and 3?'],
    [8, `last three digits ${s.slice(-3)}`],
    [9, `digit sum ${digitSum}${digitSum % 9 ? ' is not' : ' is'} a multiple of 9`],
    [10, `last digit is ${s.slice(-1)}`],
    [11, 'alternating digit sum'],
    [12, 'divisible by 3 and 4?'],
  ];
  return rules.map(([k, why]) => [`÷ ${k}`, n % BigInt(k) === 0n ? 'yes' : 'no', why]);
}

const SCALE_WORD: Record<string, number> = { thousand: 1e3, million: 1e6, billion: 1e9, lakh: 1e5, crore: 1e7 };

export function answerArithmetic(input: string, session: Session = createSession()): AnswerResult | null {
  const s = input
    .trim()
    .replace(/[?!]+$/, '')
    .replace(/[×✕]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/^(?:(?:what(?:'s| is)|find|calculate|compute|work out|please|can you|give me|show me|write|express|convert|change)\s+)+(?:the\s+)?/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  let m: RegExpExecArray | null;

  const r = round(input, s);
  if (r) return r;

  // Substitution: "3x^2 + 2x when x = 4", "πr^2 where r = 2", "a^2 + b^2 with a = 3, b = 4"
  m = /^(?:evaluate |substitute )?(.+?)\s+(?:where|when|with|if|for|at|given)\s+([a-zA-Zθ]\w*\s*=\s*[^,;=]+(?:\s*(?:,|;|and)\s*[a-zA-Zθ]\w*\s*=\s*[^,;=]+)*)$/i.exec(s);
  if (m && !/[=<>≤≥]/.test(m[1]!)) {
    const sess: Session = { ...session, vars: new Map(session.vars) };
    const given: string[] = [];
    for (const a of m[2]!.split(/\s*(?:,|;|\band\b)\s*/)) {
      const kv = /^([a-zA-Zθ]\w*)\s*=\s*(.+)$/.exec(a.trim());
      if (!kv) return null;
      const v = val(kv[2]!, sess);
      if (!v) return null;
      sess.vars.set(kv[1]!.toLowerCase(), v);
      given.push(`${kv[1]} = ${fmt(v)}`);
    }
    const res = calculate(m[1]!, sess);
    if (res.ok) return ok(input, { expression: `${res.expression} with ${given.join(', ')}`, primary: num(res.formatted.display, res.value), value: res.value, lines: res.fraction ? [{ label: 'Fraction', display: res.fraction }] : [], notes: ['Substituted the given values'] });
  }

  // Opposites and reciprocals
  m = /^(?:the )?(opposite|additive inverse|negative|reciprocal|multiplicative inverse) of (-?[\d./ ]+)$/i.exec(s);
  if (m) {
    const v = val(withMixed(m[2]!), session);
    if (v) {
      const recip = /recip|multiplicative/i.test(m[1]!);
      if (recip && v.isZero()) return fail(input, '0 has no reciprocal');
      const r = recip ? new D(1).div(v) : v.neg();
      const [n, d] = frac(r);
      return ok(input, { expression: `${m[1]} of ${m[2]}`, primary: num(fracStr(n, d), r), value: r, notes: [recip ? 'Flip the fraction: x × (1/x) = 1' : 'Same distance from 0, other side: x + (−x) = 0'] });
    }
  }
  // "sin(pi/6) in radians", "cos(60) in degrees": the angle unit for this one question
  m = /^(.+?)\s+in\s+(radians?|rad|degrees?|deg)(?:\s+mode)?$/i.exec(s);
  if (m && /\b(?:sin|cos|tan|sec|csc|cot|asin|acos|atan|arcsin|arccos|arctan)\b/i.test(m[1]!)) {
    const res = calculate(m[1]!, { ...session, angle: /^rad/i.test(m[2]!) ? 'rad' : 'deg' });
    if (res.ok) return ok(input, { expression: `${res.expression} (${/^rad/i.test(m[2]!) ? 'radians' : 'degrees'})`, primary: num(res.formatted.display, res.value), value: res.value });
  }
  // Fractions divided by fractions: "3/4 ÷ 1/2" means (3/4) ÷ (1/2)
  m = /^\s*(-?\d+)\s*\/\s*(\d+)\s*(÷|\/|:)\s*(-?\d+)\s*\/\s*(\d+)\s*$/.exec(input.replace(/÷/g, '÷'));
  if (m && input.includes('÷') || (m && /\s(?:\/|÷)\s/.test(input))) {
    const [a, b, c, d] = [BigInt(m![1]!), BigInt(m![2]!), BigInt(m![4]!), BigInt(m![5]!)];
    if (c === 0n || b === 0n || d === 0n) return fail(input, 'Division by zero is undefined');
    const strict = new D(a.toString()).div(b.toString()).div(c.toString()).div(d.toString());
    const a2 = fractionAnswer(input, a * d, b * c, `(${a}/${b}) ÷ (${c}/${d}) = ${a}/${b} × ${d}/${c}`, [`Read as one fraction divided by another (multiply by the reciprocal). Strictly left to right, ${a}/${b}/${c}/${d} = ${fmt(strict)}`]);
    return a2;
  }

  // Repeating decimals and conversions between fractions, decimals, percents and mixed numbers.
  m = /^(-?\d*\.\d*(?:\(\d+\)|\\overline\{\d+\})|-?\d*\.\d+(?:\.\.\.|…))(?:\s+(?:as|to|in|into)\s+(?:a\s+)?(?:fraction|ratio|simplest form))?$/i.exec(s);
  if (m) {
    const f = parseDecimalRepeating(m[1]!.replace(/\s/g, ''));
    if (f) return fractionAnswer(input, f[0], f[1], `${m[1]} as a fraction`, ['Repeating decimal: multiply by a power of 10 and subtract to remove the repeating part']);
  }
  m = /^(-?[\d.]+)\s*%\s+(?:as|to|in|into)\s+(?:a\s+)?(fraction|decimal|ratio)$/i.exec(s);
  if (m) {
    const x = new D(m[1]!).div(100);
    if (/decimal/i.test(m[2]!)) return ok(input, { expression: `${m[1]}% as a decimal`, primary: num(fmt(x), x), value: x, notes: ['Divide by 100'] });
    const [n, d] = frac(x);
    return fractionAnswer(input, n, d, `${m[1]}% as a fraction`, [`${m[1]}% = ${m[1]}/100`]);
  }
  m = /^(.+?)\s+(?:as|to|in|into)\s+(?:a\s+|an\s+)?(fraction|decimal|percent(?:age)?|mixed number|improper fraction|simplest form|lowest terms)$/i.exec(s) ?? /^(mixed number|improper fraction|simplest form of|simplify|reduce)\s+(.+)$/i.exec(s);
  if (m) {
    const [expr, target] = /^(mixed number|improper fraction|simplest form of|simplify|reduce)$/i.test(m[1]!) ? [m[2]!, m[1]!] : [m[1]!, m[2]!];
    if (/^[-\d\s./()+]+$/.test(expr) && /\d/.test(expr)) {
      const v = val(withMixed(expr), session);
      if (v) {
        const [n, d] = frac(v);
        const t = target.toLowerCase();
        if (/^decimal/.test(t)) return ok(input, { expression: `${expr} as a decimal`, primary: num(decimalWithRepeat(n, d).split(' = ')[0]!, v), value: v, lines: [{ label: 'Decimal', display: decimalWithRepeat(n, d) }] });
        if (/^percent/.test(t)) return ok(input, { expression: `${expr} as a percent`, primary: num(`${fmt(v.mul(100))}%`, v.mul(100)), value: v.mul(100), notes: ['Multiply by 100'] });
        if (/mixed/.test(t)) return ok(input, { expression: `${expr} as a mixed number`, primary: num(mixed(n, d), v), value: v, lines: [{ label: 'Improper fraction', display: fracStr(n, d) }, { label: 'Decimal', display: decimalWithRepeat(n, d) }] });
        if (/improper/.test(t)) return ok(input, { expression: `${expr} as an improper fraction`, primary: num(fracStr(n, d), v), value: v, lines: [{ label: 'Mixed number', display: mixed(n, d) }] });
        const g = (() => {
          const fm = /^\s*(-?\d+)\s*\/\s*(\d+)\s*$/.exec(expr);
          return fm ? bgcd(BigInt(fm[1]!), BigInt(fm[2]!)) : 1n;
        })();
        return fractionAnswer(input, n, d, `${expr} in simplest form`, g > 1n ? [`Divide top and bottom by the GCD, ${g}`] : []);
      }
    }
  }

  // Mixed numbers in arithmetic: "1 3/4 + 2 1/2"
  if (/^[-\d\s./()+*^]+$/.test(s) && /\d\s+\d+\/\d+/.test(s)) {
    const v = val(withMixed(s), session);
    if (v) {
      const [n, d] = frac(v);
      const a = fractionAnswer(input, n, d, withMixed(s).replace(/\s+/g, ' '), ['Read “a b/c” as the mixed number a + b/c']);
      a.primary.display = mixed(n, d);
      return a;
    }
  }

  // Compare numbers/fractions
  m = /^(?:which is (?:bigger|larger|greater|smaller|less)[,:]?|compare|order|is)\s+(-?[\d./ ]+?)\s*(?:or|and|vs\.?|versus|bigger than|greater than|larger than|smaller than|less than|,)\s*(-?[\d./ ]+?)(?:\s*,\s*(-?[\d./ ]+))?$/i.exec(s);
  if (m) {
    const first = s.replace(/^(?:which is (?:bigger|larger|greater|smaller|less)[,:]?|compare|order|is)\s+/i, '').split(/\s*(?:\bor\b|\band\b|\bvs\.?|\bversus\b|bigger than|greater than|larger than|smaller than|less than|,)\s*/i);
    const nums = first.map((x) => x.trim()).filter(Boolean);
    const vs = nums.map((x) => val(withMixed(x), session));
    if (nums.length >= 2 && vs.every((v) => v)) {
      const sorted = nums.map((x, i) => ({ x, v: vs[i]! })).sort((a, b) => b.v.cmp(a.v));
      const desc = sorted.map((e, i) => (i ? (sorted[i - 1]!.v.eq(e.v) ? ' = ' : ' > ') : '') + e.x).join('');
      const dens = nums.map((x) => /\/(\d+)\s*$/.exec(x)?.[1]).filter((x): x is string => !!x).map(BigInt);
      const lines = sorted.map((e) => ({ label: e.x, display: `≈ ${formatNumber(e.v, { digits: 6 }).display}` }));
      if (dens.length === nums.length) {
        const L = dens.reduce((a, b) => (a * b) / bgcd(a, b));
        lines.push({ label: 'Common denominator', display: nums.map((x) => {
          const [a, b] = x.split('/').map((y) => BigInt(y.trim()));
          return `${x} = ${(a! * L) / b!}/${L}`;
        }).join(', ') });
      }
      return ok(input, { expression: `Compare ${nums.join(', ')}`, primary: num(desc), lines, notes: [`Largest: ${sorted[0]!.x}`] });
    }
  }

  // LCD
  m = /^(?:the )?(?:lcd|least common denominator|lowest common denominator)(?: of)? (.+)$/i.exec(s);
  if (m) {
    const fr = [...m[1]!.matchAll(/(-?\d+)\s*\/\s*(\d+)/g)].map((x) => [BigInt(x[1]!), BigInt(x[2]!)] as const);
    if (fr.length >= 2) {
      const L = fr.reduce((a, [, d]) => (a * d) / bgcd(a, d), 1n);
      return ok(input, { expression: `Least common denominator of ${m[1]}`, primary: num(L.toString(), new D(L.toString())), value: new D(L.toString()), lines: fr.map(([n, d]) => ({ label: `${n}/${d}`, display: `${(n * L) / d}/${L}` })), notes: ['The LCD is the LCM of the denominators'] });
    }
  }

  // Ratios
  m = /^(?:share|divide|split)\s+\$?([\d.,]+)\s+(?:in(?:to)?\s+)?(?:the\s+)?(?:ratio\s+)?((?:\d+(?:\.\d+)?\s*:\s*)+\d+(?:\.\d+)?)$/i.exec(s);
  if (m) {
    const total = new D(m[1]!.replace(/,/g, ''));
    const parts = m[2]!.split(':').map((x) => new D(x.trim()));
    const sum = parts.reduce((a, b) => a.plus(b), new D(0));
    const shares = parts.map((p) => total.mul(p).div(sum));
    return ok(input, { expression: `Share ${fmt(total)} in the ratio ${m[2]}`, primary: num(shares.map(fmt).join(' : ')), lines: shares.map((x, i) => ({ label: `Part ${i + 1} (${fmt(parts[i]!)}/${fmt(sum)})`, display: fmt(x) })), notes: [`${fmt(sum)} parts in total; one part = ${fmt(total.div(sum))}`] });
  }
  m = /^(?:simplify (?:the )?ratio|ratio|simplest form of(?: the ratio)?)\s+((?:\d+(?:\.\d+)?\s*:\s*)+\d+(?:\.\d+)?)(?:\s+(?:in )?simplest form)?$/i.exec(s) ?? /^((?:\d+(?:\.\d+)?\s*:\s*)+\d+(?:\.\d+)?)\s+(?:in )?simplest form$/i.exec(s);
  if (m) {
    const parts = m[1]!.split(':').map((x) => new D(x.trim()));
    const scale = 10 ** Math.max(...parts.map((p) => p.decimalPlaces()));
    const ints = parts.map((p) => BigInt(p.mul(scale).toFixed()));
    const g = ints.reduce((a, b) => bgcd(a, b));
    return ok(input, { expression: `Simplify ${m[1]}`, primary: num(ints.map((x) => (x / g).toString()).join(' : ')), notes: [`Divide every part by ${g}${scale > 1 ? ` (after scaling by ${scale})` : ''}`] });
  }
  m = /^(-?[\w.]+)\s*:\s*(-?[\w.]+)\s*=\s*(-?[\w.]+)\s*:\s*(-?[\w.]+)$/.exec(s);
  if (m) {
    const [a, b, c, d] = [m[1]!, m[2]!, m[3]!, m[4]!];
    const unknown = [a, b, c, d].filter((x) => /^[a-z]$/i.test(x));
    if (unknown.length === 1) {
      const V = (t: string) => new D(/^[a-z]$/i.test(t) ? 1 : t);
      const [A, B, C, Dd] = [V(a), V(b), V(c), V(d)];
      const x = /^[a-z]$/i.test(a) ? B.mul(C).div(Dd) : /^[a-z]$/i.test(b) ? A.mul(Dd).div(C) : /^[a-z]$/i.test(c) ? A.mul(Dd).div(B) : B.mul(C).div(A);
      return ok(input, { expression: `${a} : ${b} = ${c} : ${d}`, primary: num(`${unknown[0]} = ${fmt(x)}`, x), value: x, notes: ['Cross-multiply: a·d = b·c'] });
    }
  }

  // Percent change, "what percent", reverse percent
  m = /^(?:the )?(?:percent(?:age)?|%) (change|increase|decrease|difference|error) (?:from|between) \$?(-?[\d.,]+) (?:to|and) \$?(-?[\d.,]+)$/i.exec(s);
  if (m) {
    const a = new D(m[2]!.replace(/,/g, ''));
    const b = new D(m[3]!.replace(/,/g, ''));
    if (a.isZero()) return fail(input, 'Percent change from 0 is undefined');
    if (/difference/i.test(m[1]!)) {
      const pd = b.minus(a).abs().div(a.plus(b).div(2)).mul(100);
      return ok(input, { expression: `Percent difference between ${fmt(a)} and ${fmt(b)}`, primary: num(`${formatNumber(pd, { digits: 6 }).display}%`, pd), value: pd, notes: ['|a − b| ÷ average of a and b × 100'] });
    }
    const pc = b.minus(a).div(a.abs()).mul(100);
    const word = pc.isNegative() ? 'decrease' : 'increase';
    return ok(input, { expression: `Percent change from ${fmt(a)} to ${fmt(b)}`, primary: num(`${pc.isNegative() ? '−' : '+'}${formatNumber(pc.abs(), { digits: 6 }).display}%`, pc), value: pc, lines: [{ label: 'Change', display: fmt(b.minus(a)) }, { label: 'Type', display: `a ${formatNumber(pc.abs(), { digits: 6 }).display}% ${word}` }], notes: ['(new − old) ÷ old × 100'] });
  }
  // "30 is 20% of what", "20% of what (number) is 30": the whole, from a part and its percent.
  m = /^\$?([\d.,]+) is ([\d.]+)\s*(?:%|percent) of what(?: number)?$/i.exec(s) ?? /^([\d.]+)\s*(?:%|percent) of what(?: number)? is \$?([\d.,]+)$/i.exec(s);
  if (m) {
    const first = /^\$?[\d.,]+ is/i.test(s);
    const part = new D((first ? m[1]! : m[2]!).replace(/,/g, ''));
    const pct = new D(first ? m[2]! : m[1]!);
    if (pct.isZero()) return fail(input, 'Nothing is 0% of a number except 0');
    const whole = part.div(pct.div(100));
    return ok(input, { expression: `${fmt(part)} is ${fmt(pct)}% of what`, primary: num(fmt(whole), whole), value: whole, notes: [`part ÷ ${fmt(pct.div(100))} = the whole`] });
  }
  // "what percent is 45 of 60"
  m = /^(?:what|which) percent(?:age)? is \$?([\d.,]+) of \$?([\d.,]+)$/i.exec(s);
  if (m) {
    const part = new D(m[1]!.replace(/,/g, ''));
    const whole = new D(m[2]!.replace(/,/g, ''));
    if (whole.isZero()) return fail(input, 'A percent of 0 is undefined');
    const p = part.div(whole).mul(100);
    return ok(input, { expression: `${fmt(part)} as a percent of ${fmt(whole)}`, primary: num(`${formatNumber(p, { digits: 8 }).display}%`, p), value: p, notes: ['part ÷ whole × 100'] });
  }
  m = /^(?:what|which) percent(?:age)? of \$?([\d.,]+) is \$?([\d.,]+)$/i.exec(s) ?? /^\$?([\d.,]+) is what percent(?:age)? of \$?([\d.,]+)$/i.exec(s) ?? /^\$?([\d.,]+) as a percent(?:age)? of \$?([\d.,]+)$/i.exec(s);
  if (m) {
    const swap = /^what|^which/i.test(s);
    const whole = new D((swap ? m[1]! : m[2]!).replace(/,/g, ''));
    const part = new D((swap ? m[2]! : m[1]!).replace(/,/g, ''));
    const p = part.div(whole).mul(100);
    return ok(input, { expression: `${fmt(part)} as a percent of ${fmt(whole)}`, primary: num(`${formatNumber(p, { digits: 8 }).display}%`, p), value: p, notes: ['part ÷ whole × 100'] });
  }
  m = /(?:original|before|old) (?:price|value|amount|number)?.*?(?:if|when|after|is)?.*?\$?([\d.,]+) (?:after|following) (?:an? )?([\d.]+)% (discount|off|decrease|reduction|increase|rise|markup|tax|vat|tip)/i.exec(s) ??
    /after (?:an? )?([\d.]+)% (discount|off|decrease|reduction|increase|rise|markup|tax|vat)[^\d$]*\$?([\d.,]+)/i.exec(s);
  if (m && /original|before|was|old/i.test(s)) {
    const [amt, pct, kind] = /^after/i.test(m[0]) ? [m[3]!, m[1]!, m[2]!] : [m[1]!, m[2]!, m[3]!];
    const down = /discount|off|decrease|reduction/i.test(kind);
    const factor = new D(1).plus(new D(pct).div(100).mul(down ? -1 : 1));
    const orig = new D(amt.replace(/,/g, '')).div(factor);
    return ok(input, { expression: `Original value before a ${pct}% ${down ? 'decrease' : 'increase'}`, primary: num(fmt(orig), orig), value: orig, notes: [`Reverse percentage: divide by ${fmt(factor)} (not ${down ? 'add' : 'subtract'} ${pct}% back)`] });
  }

  m = /^(?:the )?(?:price|cost|value|amount)?\s*after (?:an? )?([\d.]+)% (discount|off|decrease|reduction|increase|rise|markup|tax|vat) (?:on|of|to|from) \$?([\d.,]+)$/i.exec(s);
  if (m) {
    const down = /discount|off|decrease|reduction/i.test(m[2]!);
    const base = new D(m[3]!.replace(/,/g, ''));
    const r = base.mul(new D(1).plus(new D(m[1]!).div(100).mul(down ? -1 : 1)));
    return ok(input, { expression: `${fmt(base)} after a ${m[1]}% ${down ? 'decrease' : 'increase'}`, primary: num(fmt(r), r), value: r, lines: [{ label: down ? 'Saving' : 'Increase', display: fmt(base.minus(r).abs()) }], notes: [`Multiply by ${fmt(new D(1).plus(new D(m[1]!).div(100).mul(down ? -1 : 1)))}`] });
  }
  m = /(?:before|original).*?(?:an? )?([\d.]+)% (discount|off|decrease|reduction|increase|rise|markup|tax).*?(?:costs?|is|now|=|was)\s*\$?([\d.,]+)/i.exec(s) ?? /^(?:reverse percentage\s+)?\$?([\d.,]+) after (?:an? )?([\d.]+)% (discount|off|decrease|reduction|increase|rise|markup|tax)/i.exec(s);
  if (m && /original|before|reverse|was/i.test(s)) {
    const first = /^(?:reverse percentage\s+)?\$?[\d.,]+ after/i.test(s);
    const [pct, kind, amt] = first ? [m[2]!, m[3]!, m[1]!] : [m[1]!, m[2]!, m[3]!];
    const down = /discount|off|decrease|reduction/i.test(kind);
    const factor = new D(1).plus(new D(pct).div(100).mul(down ? -1 : 1));
    const orig = new D(amt.replace(/,/g, '')).div(factor);
    return ok(input, { expression: `Original value before a ${pct}% ${down ? 'decrease' : 'increase'}`, primary: num(fmt(orig), orig), value: orig, notes: [`Reverse percentage: divide by ${fmt(factor)}`] });
  }
  // Proportion phrasing, unitary method, direct and inverse variation
  m = /^(-?[\d.]+|[a-z]) is to (-?[\d.]+|[a-z]) as (-?[\d.]+|[a-z]) is to (-?[\d.]+|[a-z])$/i.exec(s);
  if (m) return answerArithmetic(`${m[1]}:${m[2]} = ${m[3]}:${m[4]}`, session) ?? null;
  m = /^if (\d+(?:\.\d+)?) ([a-z ]+?) costs? \$?([\d.]+),? (?:how much (?:do|does|will|would)|what (?:do|does|will|would)) (\d+(?:\.\d+)?)(?: [a-z ]+?)? cost$/i.exec(s);
  if (m) {
    const each = new D(m[3]!).div(m[1]!);
    const r = each.mul(m[4]!);
    return ok(input, { expression: `${m[4]} ${m[2]} at ${fmt(each)} each`, primary: num(`${s.includes('$') ? '$' : ''}${fmt(r)}`, r), value: r, lines: [{ label: 'One costs', display: fmt(each) }], notes: ['Unitary method: find one, then multiply'] });
  }
  m = /^([a-z]) (?:varies (directly|inversely)(?: as| with)?|is (directly|inversely) proportional to) ([a-z])(?:\^(\d+))?,? (?:and |if )?\1 ?= ?(-?[\d.]+) (?:when|if) \4 ?= ?(-?[\d.]+),? (?:find|what is) \1 (?:when|if) \4 ?= ?(-?[\d.]+)$/i.exec(s);
  if (m) {
    const inverse = /inverse/i.test(m[2] ?? m[3] ?? '');
    const pw = Number(m[5] ?? 1);
    const [y0, x0, x1] = [new D(m[6]!), new D(m[7]!), new D(m[8]!)];
    const k = inverse ? y0.mul(x0.pow(pw)) : y0.div(x0.pow(pw));
    const y1 = inverse ? k.div(x1.pow(pw)) : k.mul(x1.pow(pw));
    return ok(input, { expression: `${m[1]} ${inverse ? '∝ 1/' : '∝ '}${m[4]}${pw > 1 ? `^${pw}` : ''}`, primary: num(`${m[1]} = ${fmt(y1)}`, y1), value: y1, lines: [{ label: 'Constant k', display: fmt(k) }, { label: 'Model', display: `${m[1]} = ${inverse ? `${fmt(k)}/${m[4]}${pw > 1 ? `^${pw}` : ''}` : `${fmt(k)}${m[4]}${pw > 1 ? `^${pw}` : ''}`}` }] });
  }
  m = /^(?:(two|three|four|five|\d+) )?consecutive (even |odd )?(?:integers|numbers|whole numbers)(?: that)? (?:sum to|add (?:up )?to|have a sum of|whose sum is|with sum) (-?\d+)$/i.exec(s);
  if (m) {
    const words: Record<string, number> = { two: 2, three: 3, four: 4, five: 5 };
    const k = m[1] ? words[m[1].toLowerCase()] ?? Number(m[1]) : 2;
    const step = m[2] ? 2 : 1;
    const S = Number(m[3]);
    const first = (S - (step * k * (k - 1)) / 2) / k;
    const okParity = Number.isInteger(first) && (!m[2] || (m[2].trim() === 'even' ? first % 2 === 0 : Math.abs(first % 2) === 1));
    if (!okParity) return ok(input, { expression: s, primary: num('No solution'), notes: [`${k} consecutive ${m[2] ?? ''}integers can't add up to ${S}`] });
    const list = Array.from({ length: k }, (_, i) => first + i * step);
    return ok(input, { expression: `${k} consecutive ${m[2] ?? ''}integers with sum ${S}`, primary: num(list.join(', ')), notes: m[1] ? [] : ['Assumed two numbers (say "three consecutive integers…" for more)'] });
  }

  // Unit rates: "$120 for 8 hours", "60 miles in 1.5 hours"
  m = /^\$?([\d.,]+)\s*([a-z$€£]*)\s+(?:for|in|per|every)\s+([\d.,]+)\s*([a-z]+)(?:\s*,?\s*(?:unit rate|how many .+ per .+|rate|per \w+))?$/i.exec(s);
  if (m && /unit rate|per|rate|in \d|for \d/i.test(s) && m[4] && !/^(?:to|in)$/i.test(m[4])) {
    const a = new D(m[1]!.replace(/,/g, ''));
    const b = new D(m[3]!.replace(/,/g, ''));
    const unitA = s.startsWith('$') ? '$' : m[2] || '';
    const unitB = m[4]!.replace(/s$/, '');
    const rate = a.div(b);
    return ok(input, { expression: `Unit rate: ${m[1]} ${unitA} per ${m[3]} ${m[4]}`, primary: num(`${unitA === '$' ? '$' : ''}${fmt(rate)}${unitA && unitA !== '$' ? ` ${unitA}` : ''} per ${unitB}`, rate), value: rate, notes: ['Divide to get the amount for one unit'] });
  }

  // Divisibility, parity, perfect powers
  m = /^is (\d+) (?:divisible by|a multiple of) (\d+)$/i.exec(s) ?? /^does (\d+) divide (\d+)$/i.exec(s);
  if (m) {
    const [a, b] = /^does/i.test(s) ? [BigInt(m[2]!), BigInt(m[1]!)] : [BigInt(m[1]!), BigInt(m[2]!)];
    if (b === 0n) return fail(input, 'Nothing is divisible by 0');
    const yes = a % b === 0n;
    const rule = divRules(a).find((r) => r[0] === `÷ ${b}`);
    return ok(input, { expression: `Is ${a} divisible by ${b}?`, primary: num(yes ? 'Yes' : 'No'), lines: [{ label: `${a} ÷ ${b}`, display: yes ? `${a / b} exactly` : `${a / b} remainder ${a % b}` }, ...(rule ? [{ label: 'Rule', display: rule[2]! }] : [])] });
  }
  m = /^(?:divisibility(?: rules?| tests?)?(?: of| for)?|test divisibility of) (\d+)$/i.exec(s);
  if (m) {
    const n = BigInt(m[1]!);
    return ok(input, { expression: `Divisibility of ${n}`, primary: num(`Divisible by ${divRules(n).filter((r) => r[1] === 'yes').map((r) => r[0]!.slice(2)).join(', ') || 'none of 2–12'}`), table: { columns: ['Test', 'Result', 'Why'], rows: divRules(n) } });
  }
  m = /^is (-?\d+) (even|odd)$/i.exec(s);
  if (m) {
    const even = BigInt(m[1]!) % 2n === 0n;
    return ok(input, { expression: `Is ${m[1]} ${m[2]}?`, primary: num((m[2]!.toLowerCase() === 'even') === even ? 'Yes' : 'No'), notes: [`${m[1]} is ${even ? 'even' : 'odd'}`] });
  }
  m = /^is (\d+) a perfect (square|cube|fourth power)$/i.exec(s);
  if (m) {
    const n = BigInt(m[1]!);
    const k = /square/i.test(m[2]!) ? 2 : /cube/i.test(m[2]!) ? 3 : 4;
    const root = BigInt(Math.round(Number(m[1]!) ** (1 / k)));
    const yes = [root - 1n, root, root + 1n].find((r) => r >= 0n && r ** BigInt(k) === n);
    return ok(input, { expression: `Is ${n} a perfect ${m[2]}?`, primary: num(yes !== undefined ? 'Yes' : 'No'), notes: [yes !== undefined ? `${n} = ${yes}${k === 2 ? '²' : k === 3 ? '³' : '⁴'}` : `It lies between ${root ** BigInt(k) <= n ? root : root - 1n}${k === 2 ? '²' : '³'} and ${root ** BigInt(k) <= n ? root + 1n : root}${k === 2 ? '²' : '³'}`] });
  }
  m = /^(?:the )?(?:first )?(\d+)?\s*multiples of (\d+)(?: up to (\d+))?$/i.exec(s);
  if (m) {
    const n = BigInt(m[2]!);
    const count = m[3] ? Number(BigInt(m[3]) / n) : Number(m[1] ?? 10);
    const list = Array.from({ length: Math.min(count, 100) }, (_, i) => (n * BigInt(i + 1)).toString());
    return ok(input, { expression: `Multiples of ${n}`, primary: num(`${list.join(', ')}${!m[1] && !m[3] ? ', …' : ''}`) });
  }

  // GCD / LCM of integers (any count) with Euclid's steps
  m = /^(?:the )?(gcd|gcf|hcf|greatest common (?:divisor|factor)|highest common factor|lcm|least common multiple|lowest common multiple)(?: of)?\s*\(?\s*((?:-?\d+\s*(?:,|and|&)\s*)+-?\d+)\s*\)?$/i.exec(s);
  if (m) {
    const ns = m[2]!.split(/\s*(?:,|and|&)\s*/).map((x) => BigInt(x));
    const isG = /^(?:g|h)/i.test(m[1]!);
    const g = ns.reduce((a, b) => bgcd(a, b));
    const l = ns.reduce((a, b) => (a === 0n || b === 0n ? 0n : (a * b < 0n ? -(a * b) : a * b) / bgcd(a, b)));
    const res = isG ? g : l;
    const lines: { label: string; display: string }[] = [];
    if (ns.length === 2) {
      let [a, b] = [ns[0]! < 0n ? -ns[0]! : ns[0]!, ns[1]! < 0n ? -ns[1]! : ns[1]!];
      if (a < b) [a, b] = [b, a];
      const steps: string[] = [];
      while (b) {
        steps.push(`${a} = ${a / b} × ${b} + ${a % b}`);
        [a, b] = [b, a % b];
      }
      lines.push({ label: 'Euclid', display: steps.slice(0, 8).join('; ') });
    }
    lines.push({ label: isG ? 'LCM' : 'GCD', display: (isG ? l : g).toString() });
    if (ns.length === 2 && !isG) lines.push({ label: 'Check', display: `LCM × GCD = ${ns[0]} × ${ns[1]}` });
    return ok(input, { expression: `${isG ? 'GCD' : 'LCM'} of ${ns.join(', ')}`, primary: num(res.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',').replace(/^-/, '−'), new D(res.toString())), value: new D(res.toString()), lines });
  }

  // Estimation: round each number to 1 significant figure
  m = /^(?:estimate|approximate|roughly)\s+(.+)$/i.exec(s);
  if (m && /^[\d\s.+\-*/()]+$/.test(m[1]!)) {
    const rounded = m[1]!.replace(/\d+(?:\.\d+)?/g, (x) => new D(x).toSignificantDigits(1, D.ROUND_HALF_UP).toString());
    const est = val(rounded, session);
    const exact = val(m[1]!, session);
    if (est && exact) return ok(input, { expression: `Estimate ${m[1]}`, primary: num(`≈ ${fmt(est)}`, est), value: est, lines: [{ label: 'Rounded', display: `${rounded} = ${fmt(est)}` }, { label: 'Exact', display: fmt(exact) }], notes: ['Each number rounded to 1 significant figure'] });
  }

  // Scientific / engineering notation and "standard form"
  m = /^(.+?)\s+(?:in|to|as)\s+(?:an?\s+)?(scientific notation|standard form|standard index form|engineering notation|decimal form|ordinary (?:form|number)|expanded form|e notation)$/i.exec(s);
  if (m) {
    const v = val(m[1]!.replace(/(\d)\s*[x*]\s*10\s*\^/g, '$1*10^'), session);
    if (v) {
      const t = m[2]!.toLowerCase();
      const [mant, ex] = v.toExponential().split('e') as [string, string];
      const sci = `${mant.replace(/\.?0+$/, '')} × 10${String(Number(ex)).replace(/-/g, '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)]!)}`;
      const plainNum = v.toFixed().replace(/\B(?=(\d{3})+(?!\d))/g, (x) => x);
      const ordinary = formatNumber(v, { digits: 30 }).display.includes('×') ? v.toFixed() : formatNumber(v, { digits: 30 }).display;
      if (/engineering/.test(t)) {
        const e = Math.floor(Number(ex) / 3) * 3;
        const mm = v.div(new D(10).pow(e));
        return ok(input, { expression: `${m[1]} in engineering notation`, primary: num(`${fmt(mm)} × 10${String(e).replace(/-/g, '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)]!)}`, v), value: v, notes: ['The exponent is a multiple of 3'] });
      }
      if (/expanded/.test(t)) {
        const digits = v.abs().toFixed().split('.')[0]!;
        const parts = [...digits].map((d, i) => (d === '0' ? '' : `${d}×${10 ** (digits.length - 1 - i)}`)).filter(Boolean);
        return ok(input, { expression: `${m[1]} in expanded form`, primary: num(parts.join(' + ')), notes: ['Place value: each digit times its place'] });
      }
      if (/standard form|standard index/.test(t)) {
        void plainNum;
        return ok(input, { expression: `${m[1]} in standard form`, primary: num(sci, v), value: v, lines: [{ label: 'UK “standard form”', display: sci }, { label: 'US “standard form”', display: ordinary }], notes: ['“Standard form” means a × 10ⁿ in the UK, but the ordinary written number in the US'] });
      }
      if (/decimal|ordinary/.test(t)) return ok(input, { expression: `${m[1]} as an ordinary number`, primary: num(ordinary, v), value: v });
      return ok(input, { expression: `${m[1]} in scientific notation`, primary: num(sci, v), value: v, lines: [{ label: 'E notation', display: `${mant.replace(/\.?0+$/, '')}e${Number(ex)}` }] });
    }
  }

  // Time arithmetic: "2h45m + 1h30m", "3:45 + 2:30", "2 hours 45 minutes + 1 hour 30 minutes"
  const DUR = String.raw`(?:\d+\s*(?:h|hr|hrs|hours?)\s*(?:\d+\s*(?:m|min|mins|minutes?))?(?:\s*\d+\s*(?:s|sec|secs|seconds?))?|\d+\s*(?:m|min|mins|minutes?)(?:\s*\d+\s*(?:s|sec|secs|seconds?))?|\d+:\d\d(?::\d\d)?)`;
  m = new RegExp(`^(${DUR})((?:\\s*[+-]\\s*${DUR})+)$`, 'i').exec(s);
  if (m) {
    const secs = (t: string) => {
      const c = /^(\d+):(\d\d)(?::(\d\d))?$/.exec(t.trim());
      if (c) return Number(c[1]) * 3600 + Number(c[2]) * 60 + Number(c[3] ?? 0);
      const h = /(\d+)\s*(?:h|hr|hrs|hours?)/i.exec(t);
      const mi = /(\d+)\s*(?:m|min|mins|minutes?)(?![a-z])/i.exec(t);
      const se = /(\d+)\s*(?:s|sec|secs|seconds?)\b/i.exec(t);
      return Number(h?.[1] ?? 0) * 3600 + Number(mi?.[1] ?? 0) * 60 + Number(se?.[1] ?? 0);
    };
    let total = secs(m[1]!);
    for (const t of m[2]!.matchAll(new RegExp(`([+-])\\s*(${DUR})`, 'gi'))) total += (t[1] === '-' ? -1 : 1) * secs(t[2]!);
    const neg = total < 0;
    const a = Math.abs(total);
    const h = Math.floor(a / 3600);
    const mi = Math.floor((a % 3600) / 60);
    const se = a % 60;
    const disp = `${neg ? '−' : ''}${h}h ${String(mi).padStart(2, '0')}m${se ? ` ${String(se).padStart(2, '0')}s` : ''}`;
    return ok(input, { expression: s, primary: num(disp, new D(total).div(3600)), value: new D(total).div(3600), lines: [{ label: 'Clock form', display: `${neg ? '−' : ''}${h}:${String(mi).padStart(2, '0')}${se ? `:${String(se).padStart(2, '0')}` : ''}` }, { label: 'Hours', display: fmt(new D(total).div(3600)) }, { label: 'Minutes', display: fmt(new D(total).div(60)) }], notes: ['60 minutes carry into an hour'] });
  }

  // Division with remainder
  m = /^(?:long division\s+)?(?:(?:the )?quotient and remainder (?:of|when)\s+)?(\d+)\s*(?:\/|divided by|div|÷)\s*(\d+)(?:\s+(?:with (?:a )?remainder|remainder|quotient and remainder|r))?$/i.exec(s);
  if (m && (/remainder|long division|quotient|\br$/i.test(s))) {
    const a = BigInt(m[1]!);
    const b = BigInt(m[2]!);
    if (b === 0n) return fail(input, 'Division by zero is undefined');
    const q = a / b;
    const rem = a % b;
    const rows: string[][] = [];
    if (/long division/i.test(s)) {
      let cur = 0n;
      for (const d of m[1]!) {
        cur = cur * 10n + BigInt(d);
        const qd = cur / b;
        rows.push([`bring down ${d} → ${cur}`, `${qd}`, `${qd * b}`, `${cur - qd * b}`]);
        cur -= qd * b;
      }
    }
    return ok(input, {
      expression: `${a} ÷ ${b}`,
      primary: num(`${q} r ${rem}`, new D(a.toString()).div(b.toString())),
      value: new D(a.toString()).div(b.toString()),
      lines: [{ label: 'Quotient', display: q.toString() }, { label: 'Remainder', display: rem.toString() }, { label: 'Check', display: `${b} × ${q} + ${rem} = ${a}` }, { label: 'As a mixed number', display: mixed(a, b) }, { label: 'Decimal', display: decimalWithRepeat(a, b) }],
      table: rows.length ? { columns: ['Step', 'Digit', 'Subtract', 'Remainder'], rows } : undefined,
    });
  }

  // Roman numerals
  m = /^(\d+)\s+(?:in|to|as|into)\s+roman(?: numerals?)?$/i.exec(s) ?? /^roman numerals? (?:for|of) (\d+)$/i.exec(s);
  if (m) {
    const n = Number(m[1]);
    if (n < 1 || n > 4999) return fail(input, 'Roman numerals cover 1 to 4999 (larger numbers need overlines)');
    return ok(input, { expression: `${n} in Roman numerals`, primary: num(toRoman(n)), notes: ['M=1000, D=500, C=100, L=50, X=10, V=5, I=1; a smaller numeral before a larger one subtracts'] });
  }
  m = /^([MDCLXVI]+)(?:\s+(?:to|in|as|into)\s+(?:a\s+)?(?:number|decimal|arabic(?: numerals?)?|digits))?$/i.exec(s);
  if (m && (s === s.toUpperCase() || /\b(?:to|in|as)\b/.test(s)) && m[1]!.length >= 1) {
    const v = fromRoman(m[1]!);
    if (v !== null && (m[1]!.length > 1 || /\b(?:to|in|as)\b/.test(s))) return ok(input, { expression: `${m[1]!.toUpperCase()} in ordinary numbers`, primary: num(String(v), new D(v)), value: new D(v) });
  }
  m = /^([MDCLXVI]+)\s*([+\-*/])\s*([MDCLXVI]+)$/.exec(s);
  if (m) {
    const a = fromRoman(m[1]!);
    const b = fromRoman(m[3]!);
    if (a !== null && b !== null) {
      const v = m[2] === '+' ? a + b : m[2] === '-' ? a - b : m[2] === '*' ? a * b : a / b;
      return ok(input, { expression: `${m[1]} ${m[2]} ${m[3]} = ${a} ${m[2]} ${b}`, primary: num(Number.isInteger(v) && v > 0 && v < 5000 ? `${toRoman(v)} (${v})` : String(v), new D(v)), value: new D(v) });
    }
  }

  // Number words and ordinals
  m = /^(?:spell(?: out)?|say)\s+(-?[\d,]+)$/i.exec(s) ?? /^(-?[\d,]+)\s+(?:in|to|as|into)\s+(?:english\s+)?words$/i.exec(s);
  if (m) {
    const raw = m[1]!;
    const indian = /^\d{1,2}(?:,\d\d)+,\d{3}$/.test(raw);
    const n = BigInt(raw.replace(/,/g, ''));
    const lines = indian ? [{ label: 'International', display: toWords(n) }] : n >= 100000n ? [{ label: 'Indian system', display: toWords(n, true) }] : [];
    return ok(input, { expression: `${raw} in words`, primary: num(toWords(n, indian)), lines });
  }
  m = /^(?:the )?ordinal (?:of|for) (\d+)$/i.exec(s) ?? /^(\d+) as an ordinal$/i.exec(s);
  if (m) {
    const n = Number(m[1]);
    return ok(input, { expression: `Ordinal of ${n}`, primary: num(`${n}${ordinalSuffix(n)}`) });
  }
  m = /^(?:(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[- ])?([a-z]+?(?:th|st|nd|rd|first|second|third))\s+(?:as a number|in digits|to a number)$/i.exec(s);
  if (m) {
    const tens: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
    const base = ORD_WORDS[m[2]!.toLowerCase()];
    if (base !== undefined) {
      const n = (m[1] ? tens[m[1].toLowerCase()]! : 0) + base;
      return ok(input, { expression: `${s}`, primary: num(`${n} (${n}${ordinalSuffix(n)})`, new D(n)), value: new D(n) });
    }
  }

  // Indian and East Asian scale words that the calculator didn't take: "2.5 crore in millions", "5 lakh"
  m = /^([\d.]+)\s*(lakh|lakhs|crore|crores|万|億|亿|兆)(?:\s+(?:in|to)\s+(thousands?|millions?|billions?|lakhs?|crores?))?$/i.exec(s);
  if (m) {
    const scale: Record<string, number> = { lakh: 1e5, lakhs: 1e5, crore: 1e7, crores: 1e7, 万: 1e4, 億: 1e8, 亿: 1e8, 兆: 1e12 };
    const v = new D(m[1]!).mul(scale[m[2]!.toLowerCase()]!);
    const lines = [{ label: 'Number', display: fmt(v) }];
    let primary = fmt(v);
    if (m[3]) {
      const t = m[3].toLowerCase().replace(/s$/, '');
      const div = SCALE_WORD[t]!;
      primary = `${fmt(v.div(div))} ${t}`;
    }
    return ok(input, { expression: `${m[1]} ${m[2]}`, primary: num(primary, v), value: v, lines, notes: ['1 lakh = 100,000; 1 crore = 10,000,000 (100 lakh); 万 = 10⁴; 億/亿 = 10⁸'] });
  }

  // Per mille and basis points
  m = /^([\d.]+)\s*(?:bps|basis points?)\s+(?:in|to|as)\s+(?:a\s+)?(percent|%|decimal)$/i.exec(s);
  if (m) {
    const v = new D(m[1]!).div(100);
    return ok(input, { expression: `${m[1]} basis points`, primary: num(/decimal/i.test(m[2]!) ? fmt(v.div(100)) : `${fmt(v)}%`, v), value: v, notes: ['1 basis point = 0.01% = 0.0001'] });
  }

  // Degrees–minutes–seconds
  m = /^(-?\d+(?:\.\d+)?)\s*°\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*)?(?:(\d+(?:\.\d+)?)\s*(?:["″]|''))?(?:\s+(?:to|in|as)\s+(?:decimal )?degrees)?$/i.exec(s);
  if (m && (m[2] || m[3])) {
    const v = new D(m[1]!).abs().plus(new D(m[2] ?? 0).div(60)).plus(new D(m[3] ?? 0).div(3600)).mul(m[1]!.startsWith('-') ? -1 : 1);
    return ok(input, { expression: `${s.replace(/\s+(?:to|in|as).*$/, '')} in decimal degrees`, primary: num(`${formatNumber(v, { digits: 10 }).display}°`, v), value: v, notes: ['1° = 60′, 1′ = 60″'] });
  }
  m = /^(-?\d+\.\d+)\s*(?:°|degrees?)\s+(?:to|in|as)\s+(?:dms|degrees,? minutes(?:,? and seconds)?)$/i.exec(s);
  if (m) {
    const v = new D(m[1]!).abs();
    const d = v.floor();
    const minutes = v.minus(d).mul(60);
    const mi = minutes.floor();
    const sec = minutes.minus(mi).mul(60);
    return ok(input, { expression: `${m[1]}° in degrees, minutes, seconds`, primary: num(`${m[1]!.startsWith('-') ? '−' : ''}${d}° ${mi}′ ${formatNumber(sec, { digits: 6 }).display}″`) });
  }

  // ':' as division inside a longer expression: "15:3 + 2"
  if (/^[\d\s.:+\-*/()^]+$/.test(s) && /\d\s*:\s*\d/.test(s) && /[+\-*/^()]/.test(s)) {
    const res = calculate(s.replace(/:/g, '/'), session);
    if (res.ok) return ok(input, { expression: res.expression, primary: num(res.formatted.display, res.value), value: res.value, notes: ['Read “:” as division (as in Germany, Russia and much of Europe)'] });
  }
  // ':' as division (Germany, Russia…) or a ratio, when nothing else read it
  m = /^(-?[\d.]+)\s*:\s*(-?[\d.]+)$/.exec(s);
  if (m) {
    const a = new D(m[1]!);
    const b = new D(m[2]!);
    if (b.isZero()) return fail(input, 'Division by zero is undefined');
    const q = a.div(b);
    const scale = 10 ** Math.max(a.decimalPlaces(), b.decimalPlaces());
    const A = BigInt(a.mul(scale).toFixed());
    const B = BigInt(b.mul(scale).toFixed());
    const g = bgcd(A, B);
    return ok(input, { expression: `${m[1]} : ${m[2]}`, primary: num(fmt(q), q), value: q, lines: [{ label: 'As a ratio', display: `${A / g} : ${B / g}` }], notes: ['Read “:” as division (the usual sign in Germany, Russia and much of Europe); as a ratio it simplifies as shown'] });
  }
  return null;
}

/** Comma decimal separators the calculator couldn't read ("3,5 + 1,25", "1.234,5 + 1"): re-read with "," as the decimal point. */
export function commaDecimal(input: string, session: Session): AnswerResult | null {
  if (!/\d,\d/.test(input) || /\d,\d{3}(?!\d)/.test(input.replace(/\d{1,3}(?:[. ]\d{3})+,\d+/g, ''))) {
    if (!/\d{1,3}(?:\.\d{3})+,\d+/.test(input)) return null;
  }
  const r = calculate(input.replace(/(\d) (?=\d{3}(?!\d))/g, '$1'), session, { decimalSeparator: ',' });
  if (!r.ok) return null;
  return ok(input, { expression: r.expression, primary: num(r.formatted.display.replace(/,/g, ' ').replace(/\./g, ','), r.value), value: r.value, lines: [{ label: 'With a decimal point', display: r.formatted.display }], notes: ['Read “,” as the decimal separator (as in most of Europe, Latin America and Russia)'] });
}

export const LOOKS_LIKE_ARITH =
  /^\s*(?:round|rounding)\b|\b(?:as|to|in|into) (?:a |an )?(?:fraction|decimal|percent(?:age)?|mixed number|improper fraction|simplest form|lowest terms|roman(?: numerals?)?|words|english words|scientific notation|standard form|standard index form|engineering notation|ordinary (?:form|number)|expanded form|e notation)\b|\b(?:mixed number|improper fraction|simplest form of|lcd|least common denominator|lowest common denominator|share|ratio|percent(?:age)? (?:change|increase|decrease|difference|error)|what percent(?:age)?|which percent(?:age)?|as a percent(?:age)? of|(?:%|percent) of what|original|unit rate|divisible|divisibility|multiples? of|perfect (?:square|cube)|gcd|gcf|hcf|lcm|greatest common|highest common|least common multiple|lowest common multiple|estimate|approximate|remainder|quotient|long division|roman|spell|ordinal|lakhs?|crores?|basis points?|bps|dms|which is (?:bigger|larger|greater|smaller|less))\b|(?:\.\.\.|…|\(\d+\))\s*(?:as|$)|^\s*(?:compare|reduce|simplify)\s+-?\d|^\s*is -?\d+ (?:even|odd)|^\s*-?[\d.]+\s*:\s*-?[\d.]+\s*$|^[MDCLXVI]+(?:\s*[+\-*/]\s*[MDCLXVI]+)?\s*$|^[MDCLXVI]+\s+(?:to|in|as)\b|\b(?:as a number|in digits)\b|\bper (?:hour|minute|second|day|week|unit|item|kg|pound|mile|km|litre|liter|gallon)\b|\bhow many .+ per\b|\w\s*:\s*\w+\s*=\s*\w+\s*:\s*\w|\d\s+\d+\/\d+|\d\s*(?:h|hr|hrs|hours?)\s*\d*\s*(?:m|min)?\s*[+-]|\d:\d\d\s*[+-]\s*\d+:\d\d|°\s*\d+\s*['′]|[万億亿兆]|\b(?:where|when|with|if|at|given) [a-zθ]\w* ?=|\b(?:bigger|larger|greater|smaller) than\b|\b(?:opposite|additive inverse|reciprocal|multiplicative inverse) of\b|\bin (?:radians?|rad|degrees?|deg)(?: mode)?$|^\s*-?\d+\s*\/\s*\d+\s*(?:÷|\s\/\s)\s*-?\d+\s*\/\s*\d+\s*$|\bafter (?:an? )?[\d.]+% |\bis to\b|\bif \d+(?:\.\d+)? [a-z ]+? costs?\b|\bvaries (?:directly|inversely)|\b(?:directly|inversely) proportional|\bconsecutive\b|^\$?[\d.,]+\s*[a-z]+\s+(?:in|for|per)\s+[\d.,]+\s*(?:hours?|hrs?|minutes?|mins?|seconds?|secs?|days?|weeks?)$|\d\s*(?:minutes?|mins?|hours?|hrs?|h|m)\s*[+-]\s*\d|^[\d\s.:+\-*/()^]*\d\s*:\s*\d[\d\s.:+\-*/()^]*$/i;
