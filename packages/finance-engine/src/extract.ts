import { D, type Dec } from '@lemma/math-core';

/** Pulls money amounts, percentages and durations out of a sentence, each with its position and context. */

const SYM = '[$€£¥₹]';
const SCALE = '(?:k|m|mm|bn|thousand|grand|million|billion)';
const WORD_CUR = '(?:dollars?|bucks|usd|euros?|eur|pounds?|gbp|rupees?|yen)';
export const NUM_SRC = `(?:${SYM}\\s?)?\\d[\\d,]*(?:\\.\\d+)?(?:\\s?${SCALE}\\b)?(?:\\s?${WORD_CUR}\\b)?`;

export interface Found {
  value: Dec;
  index: number;
  end: number;
  raw: string;
  /** Up to two words after the number, lowercased: "down", "tip", "years". */
  after: string;
  /** Up to two words before it. */
  before: string;
}

export interface Extracted {
  amounts: Found[];
  percents: Found[];
  /** Durations normalised to years. */
  durations: (Found & { years: Dec; months: Dec })[];
  currency: string;
}

const SCALES: Record<string, number> = { k: 1e3, thousand: 1e3, grand: 1e3, m: 1e6, mm: 1e6, million: 1e6, bn: 1e9, billion: 1e9 };

export function parseNumber(raw: string): Dec {
  const m = /(\d[\d,]*(?:\.\d+)?)\s?(k|m|mm|bn|thousand|grand|million|billion)?/i.exec(raw)!;
  let v = new D(m[1]!.replace(/,/g, ''));
  if (m[2]) v = v.mul(SCALES[m[2].toLowerCase()]!);
  return v;
}

const CURRENCY_WORDS: [RegExp, string][] = [
  [/\$|\b(?:dollars?|bucks|usd)\b/, '$'],
  [/€|\b(?:euros?|eur)\b/, '€'],
  [/£|\b(?:pounds? sterling|gbp|quid)\b|\d\s?pounds?\b/, '£'],
  [/¥|\byen\b/, '¥'],
  [/₹|\brupees?\b/, '₹'],
];

export function extract(text: string, defaultCurrency = '$'): Extracted {
  const s = text.toLowerCase();
  const amounts: Found[] = [];
  const percents: Found[] = [];
  const durations: Extracted['durations'] = [];
  const re = new RegExp(`${NUM_SRC}(\\s?(?:%|percent|per cent|pct))?`, 'g');
  for (const m of s.matchAll(re)) {
    const raw = m[0];
    const index = m.index!;
    const end = index + raw.length;
    // Only a small window around the number: splitting the whole remainder each time is quadratic on long lists.
    const after = s.slice(end, end + 48).trim().split(/\s+/).slice(0, 2).join(' ');
    const before = s.slice(Math.max(0, index - 48), index).trim().split(/\s+/).slice(-2).join(' ');
    const value = parseNumber(raw);
    const f: Found = { value, index, end, raw, after, before };
    if (m[1]) {
      percents.push(f);
      continue;
    }
    const dur = /^(years?|yrs?|yr|months?|mos?|mo)\b/.exec(after);
    if (dur && !/[$€£¥₹]/.test(raw)) {
      const isYears = dur[1]!.startsWith('y');
      durations.push({ ...f, years: isYears ? value : value.div(12), months: isYears ? value.mul(12) : value });
      continue;
    }
    amounts.push(f);
  }
  const cur = CURRENCY_WORDS.find(([r]) => r.test(s));
  return { amounts, percents, durations, currency: cur ? cur[1] : defaultCurrency };
}

export function money(x: Dec, sym: string, places = 2): string {
  const neg = x.isNegative();
  const [i = '0', f] = x.abs().toFixed(places, D.ROUND_HALF_UP).split('.');
  const body = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? `.${f}` : '');
  return `${neg ? '−' : ''}${sym}${body}`;
}

export function pct(x: Dec, places = 2): string {
  return `${x.mul(100).toDecimalPlaces(places).toString()}%`;
}

export const FREQUENCIES: [RegExp, number, string][] = [
  [/continuous(?:ly)?/, Infinity, 'continuously'],
  [/daily|every day|per day|a day/, 365, 'daily'],
  [/weekly|every week|per week|a week/, 52, 'weekly'],
  [/bi-?weekly|fortnightly|every two weeks/, 26, 'every two weeks'],
  [/monthly|every month|per month|a month/, 12, 'monthly'],
  [/quarterly|every quarter/, 4, 'quarterly'],
  [/semi-?annual(?:ly)?|twice a year|half-?yearly/, 2, 'semiannually'],
  [/annual(?:ly)?|yearly|every year|per year|a year/, 1, 'annually'],
];

export function frequency(s: string, fallback: number): { n: number; label: string; explicit: boolean } {
  const m = /compound(?:ed|ing)? (\w+(?: \w+)?)/.exec(s);
  const target = m ? m[1]! : s;
  for (const [re, n, label] of FREQUENCIES) if (re.test(target)) return { n, label, explicit: true };
  const label = FREQUENCIES.find(([, n]) => n === fallback)?.[2] ?? `${fallback}× a year`;
  return { n: fallback, label, explicit: false };
}
