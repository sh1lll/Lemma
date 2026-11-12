import { D } from '@lemma/math-core';
import { fail, need, ok, type Ctx } from './util';

const BASE_WORD = String.raw`(?:hexadecimal|hex|binary|bin|octal|oct|decimal|dec|base[\s-]?\d{1,2})`;
const NAMED: Record<string, number> = { hexadecimal: 16, hex: 16, binary: 2, bin: 2, octal: 8, oct: 8, decimal: 10, dec: 10 };
const LIT = String.raw`-?(?:0x[0-9a-f_]+(?:\.[0-9a-f]+)?|0b[01_]+(?:\.[01]+)?|0o[0-7_]+(?:\.[0-7]+)?|[0-9a-z]*\.?[0-9a-z]+)`;

function baseOf(word: string): number {
  const m = /base[\s-]?(\d+)/.exec(word);
  return m ? Number(m[1]) : NAMED[word]!;
}

const BASE_NAME: Record<number, string> = { 2: 'binary', 8: 'octal', 10: 'decimal', 16: 'hexadecimal' };
const baseName = (b: number) => BASE_NAME[b] ?? `base ${b}`;

interface Rational {
  neg: boolean;
  /** Numerator and denominator, reduced, denominator > 0. */
  n: bigint;
  d: bigint;
}

const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
};

function parseIn(digits: string, base: number): Rational | null {
  const neg = digits.startsWith('-');
  const body = (neg ? digits.slice(1) : digits).replace(/_/g, '');
  const [ip = '', fp = ''] = body.split('.');
  const B = BigInt(base);
  let n = 0n;
  for (const ch of ip + fp) {
    const v = parseInt(ch, 36);
    if (Number.isNaN(v) || v >= base) return null;
    n = n * B + BigInt(v);
  }
  let d = B ** BigInt(fp.length);
  const g = gcd(n, d) || 1n;
  n /= g;
  d /= g;
  return { neg: neg && n !== 0n, n, d };
}

/** Digits of r in `base`, or null when the fraction doesn't terminate (within 64 digits). */
function toBase(r: Rational, base: number): string | null {
  const B = BigInt(base);
  const ip = r.n / r.d;
  let rem = r.n % r.d;
  let out = ip.toString(base).toUpperCase();
  if (rem) {
    let frac = '';
    for (let i = 0; i < 64 && rem; i++) {
      rem *= B;
      frac += (rem / r.d).toString(base).toUpperCase();
      rem %= r.d;
    }
    if (rem) return null;
    out += '.' + frac;
  }
  return (r.neg ? '-' : '') + out;
}

function decorate(digits: string, base: number): string {
  const neg = digits.startsWith('-');
  const body = neg ? digits.slice(1) : digits;
  const pre = base === 16 ? '0x' : base === 2 ? '0b' : base === 8 ? '0o' : '';
  const sub = pre || base === 10 ? '' : [...String(base)].map((d) => '₀₁₂₃₄₅₆₇₈₉'[Number(d)]).join('');
  let shown = body;
  if (base === 10) shown = body.replace(/^(\d+)/, (i) => i.replace(/\B(?=(\d{3})+(?!\d))/g, ','));
  return `${neg ? '−' : ''}${pre}${shown}${sub}`;
}

/** Binary grouped in nibbles for readability. */
const nibbles = (bin: string) => bin.replace(/^(-?)([01]+)/, (_m, s: string, b: string) => s + b.replace(/\B(?=([01]{4})+(?![01]))/g, ' '));

function speakDigits(digits: string, base: number): string {
  const body = digits.replace(/^-/, '');
  const words = base === 10 ? body : [...body].map((ch) => (ch === '.' ? 'point' : ch)).join(' ');
  return `${digits.startsWith('-') ? 'negative ' : ''}${words}${base === 10 ? '' : ` in ${baseName(base)}`}`;
}

/** "255 in hex", "0xff in decimal", "1010 binary to decimal", "convert 100 to base 7", "0b1010". */
export function bases(c: Ctx) {
  const s = c.s.replace(/^(?:(?:please|convert|change|what(?:'s| is)|whats|show|write|express)\s+)+/, '').trim();
  let lit: string | undefined;
  let fromWord: string | undefined;
  let toWord: string | undefined;

  const m1 = new RegExp(`^(${LIT})(?:\\s+(?:from\\s+)?(?:in\\s+)?(${BASE_WORD}))?(?:\\s+(?:in|to|into|as)\\s+(${BASE_WORD}))?$`).exec(s);
  const m2 = new RegExp(`^(${BASE_WORD})\\s+(?:of|for)\\s+(${LIT})$`).exec(s);
  const m3 = new RegExp(`^(${LIT})\\s+(?:in|to|into|as)\\s+(${BASE_WORD})$`).exec(s);
  if (m3) {
    lit = m3[1];
    toWord = m3[2];
  } else if (m1) {
    lit = m1[1];
    fromWord = m1[2];
    toWord = m1[3];
  } else if (m2) {
    lit = m2[2];
    toWord = m2[1];
  } else return null;
  if (!lit) return null;

  const prefix = /^-?0([xbo])/.exec(lit);
  const prefBase = prefix ? { x: 16, b: 2, o: 8 }[prefix[1] as 'x' | 'b' | 'o'] : undefined;
  if (!prefix && !fromWord && !toWord) return null;
  // A prefixed literal written with "in binary" after it: "0b1010 in binary" names the source again.
  let from = prefBase ?? (fromWord ? baseOf(fromWord) : undefined);
  let to = toWord ? baseOf(toWord) : undefined;
  if (prefBase && fromWord && baseOf(fromWord) !== prefBase) return fail(c, 'bases', `${lit} is written in ${baseName(prefBase)}, not ${fromWord}`);
  if (from === undefined) {
    const body = lit.replace(/^-/, '');
    if (/[g-z]/.test(body)) return null;
    if (/[a-f]/.test(body)) return need(c, 'bases', `Which base is “${lit}” written in? (e.g. “${lit} hex to decimal”)`);
    from = 10;
  }
  if (to === undefined) to = from === 10 ? 16 : 10;
  for (const b of [from, to]) if (b < 2 || b > 36) return fail(c, 'bases', `Bases run from 2 to 36; base ${b} isn't supported`);
  // "1010 in binary" (no other base) reads as converting decimal 1010 to binary; that's what m3/m1 with toWord give.
  if (!prefBase && !fromWord && toWord && from === to) return null;

  const digits = prefix ? lit.replace(/^(-?)0[xbo]/, '$1') : lit;
  const r = parseIn(digits, from);
  if (!r) return fail(c, 'bases', `“${digits.replace(/^-/, '')}” isn't a valid ${baseName(from)} number`);
  const target = toBase(r, to);
  if (target === null) return fail(c, 'bases', `${lit} has no finite ${baseName(to)} expansion; only clean fractions are converted`);

  const decimal = toBase(r, 10);
  const value = decimal !== null ? new D(decimal) : new D(r.n.toString()).div(r.d.toString()).mul(r.neg ? -1 : 1);
  const lines: { label: string; display: string }[] = [];
  for (const b of [10, 16, 2, 8]) {
    const v = toBase(r, b);
    lines.push({ label: baseName(b)[0]!.toUpperCase() + baseName(b).slice(1), display: v === null ? 'non-terminating' : b === 2 ? decorate(nibbles(v), 2) : decorate(v, b) });
  }
  if (![10, 16, 2, 8].includes(to)) lines.push({ label: `Base ${to}`, display: decorate(target, to) });
  const notes: string[] = [];
  if (r.neg) {
    notes.push('Negative values are shown with a sign (sign–magnitude), not as a bit pattern');
    if (r.d === 1n) {
      const width = [8, 16, 32, 64].find((w) => r.n <= 1n << BigInt(w - 1));
      if (width) {
        const twos = ((1n << BigInt(width)) - r.n).toString(2);
        lines.push({ label: `Two's complement (${width}-bit)`, display: nibbles(twos) });
      }
    }
  }
  return ok(c, {
    kind: 'bases',
    expression: `${decorate(toBase(r, from) ?? digits, from)} (${baseName(from)}) → ${baseName(to)}`,
    primary: { display: decorate(target, to), plain: to === 16 || to === 2 || to === 8 ? decorate(target, to).replace('−', '-') : target, spoken: speakDigits(target, to), unit: to === 10 ? undefined : baseName(to) },
    value,
    lines,
    notes,
  });
}
