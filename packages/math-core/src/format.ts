import { D, type Dec } from './decimal';

export interface FormatOptions {
  /** Significant digits shown. Default 12. */
  digits?: number;
  /** Thousands grouping in the display string. Default true. */
  grouping?: boolean;
  /** Fixed decimal places instead of significant digits. */
  fixedPlaces?: number;
}

export interface Formatted {
  /** Human display: "12,450", "1.5 × 10¹⁵". */
  display: string;
  /** Copy/paste and re-entry form: "12450", "1.5e15". */
  plain: string;
  /** Words for text-to-speech: "negative 1.5 times ten to the 15". */
  spoken: string;
  /** The display rounds away part of the value. */
  rounded: boolean;
}

const SUP: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
const SCI_HIGH = new D('1e15');
const SCI_LOW = new D('1e-7');

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

export function formatNumber(x: Dec, opts: FormatOptions = {}): Formatted {
  const digits = opts.digits ?? 12;
  const grouping = opts.grouping ?? true;
  if (x.isZero()) return { display: '0', plain: '0', spoken: '0', rounded: false };

  const abs = x.abs();
  if (opts.fixedPlaces === undefined && (abs.gte(SCI_HIGH) || abs.lt(SCI_LOW))) {
    const r = x.toSignificantDigits(digits, D.ROUND_HALF_UP);
    const [mant = '', expRaw = '0'] = r.toExponential().split('e');
    const m = trimZeros(mant);
    const exp = String(Number(expRaw));
    return {
      display: `${m} × 10${[...exp].map((c) => SUP[c] ?? c).join('')}`,
      plain: `${m}e${exp}`,
      spoken: `${speakSign(m)} times ten to the ${exp.startsWith('-') ? 'negative ' + exp.slice(1) : exp}`,
      rounded: !r.eq(x),
    };
  }

  // Below 10¹⁵ the whole-number part is always shown in full: rounding 1234567890123 to 12 significant digits
  // would print 1,234,567,890,120, a different integer that looks exact.
  const r =
    opts.fixedPlaces !== undefined ? x.toDecimalPlaces(opts.fixedPlaces, D.ROUND_HALF_UP)
    : abs.gte(new D(10).pow(digits)) ? x.toDecimalPlaces(0, D.ROUND_HALF_UP)
    : x.toSignificantDigits(digits, D.ROUND_HALF_UP);
  const fixed = opts.fixedPlaces !== undefined ? r.toFixed(opts.fixedPlaces) : trimZeros(r.toFixed());
  const neg = fixed.startsWith('-');
  const [ip = '0', fp] = (neg ? fixed.slice(1) : fixed).split('.');
  const body = (grouping ? group(ip) : ip) + (fp ? `.${fp}` : '');
  return {
    display: (neg ? '−' : '') + body,
    plain: fixed,
    spoken: speakSign(fixed),
    rounded: !r.eq(x),
  };
}

function speakSign(s: string): string {
  return s.startsWith('-') ? `negative ${s.slice(1)}` : s;
}

/** Exact fraction for a rational value, e.g. 1/3. Undefined when the value is an integer or the denominator is impractically large. */
export function toFraction(x: Dec, maxDenominator = 1_000_000): string | undefined {
  if (x.isInteger()) return undefined;
  const [n, d] = x.toFraction(maxDenominator) as [Dec, Dec];
  // A tiny value (1e-50) is within 1e-40 of 0/1, which is not a fraction of it.
  if (n.isZero() || n.div(d).minus(x).abs().gt(x.abs().mul('1e-30'))) return undefined;
  return `${n.toString()}/${d.toString()}`;
}
