import { D, formatNumber, type Dec, type Formatted } from '@lemma/math-core';

export const dec = (x: number | string | Dec): Dec => (typeof x === 'object' ? x : new D(x));

/** Rounded to `sig` significant digits; Unicode minus, thousands grouping, × 10ⁿ for very large or small. */
export function num(x: number | string | Dec, sig = 6): Formatted {
  return formatNumber(dec(x), { digits: sig });
}

/** Number of decimal places written in a decimal string ("1357.77" → 2). */
export function places(s: string): number {
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

/** Fixed decimal places, keeping the Unicode minus and grouping. */
export function fixed(x: Dec, dp: number): Formatted {
  return formatNumber(x.toDecimalPlaces(dp, D.ROUND_HALF_UP), { digits: 30 });
}

const SCALES: [number, string][] = [
  [1e12, 'trillion'],
  [1e9, 'billion'],
  [1e6, 'million'],
];

/** "225 million", "1.411 billion"; smaller numbers grouped normally. */
export function large(x: number | Dec, sig = 4): { display: string; spoken: string } {
  const v = dec(x);
  for (const [scale, word] of SCALES) {
    if (v.abs().gte(scale)) {
      const f = num(v.div(scale), sig);
      return { display: `${f.display} ${word}`, spoken: `${f.spoken} ${word}` };
    }
  }
  const f = num(v, sig + 2);
  return { display: f.display, spoken: f.spoken };
}

/** Exact integer with thousands separators ("1,346,269"); scientific beyond 30 digits. */
export function bigInt(n: bigint): string {
  const s = n.toString();
  if (s.length > 30) return num(new D(s), 15).display;
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const SPOKEN: Record<string, string> = {
  'g/cm³': 'grams per cubic centimetre',
  'g/L': 'grams per litre',
  u: 'atomic mass units',
  'g/mol': 'grams per mole',
  '°C': 'degrees Celsius',
  K: 'kelvin',
  km: 'kilometres',
  kg: 'kilograms',
  'm/s²': 'metres per second squared',
  'km/s': 'kilometres per second',
  'km²': 'square kilometres',
  kcal: 'kilocalories',
  g: 'grams',
  m: 'metres',
  'm·K': 'metre kelvins',
  'people/km²': 'people per square kilometre',
};

export function spokenUnit(unit: string | undefined): string {
  if (!unit) return '';
  return SPOKEN[unit] ?? unit;
}

/** Seconds → "8 min 19 s", "1.3 s", "12.5 min", "4.2 hours". */
export function duration(seconds: number): string {
  if (seconds < 60) return `${num(seconds, 3).display} s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds - m * 60);
    return s === 60 ? `${m + 1} min` : `${m} min${s ? ` ${s} s` : ''}`;
  }
  return `${num(seconds / 3600, 3).display} hours`;
}
