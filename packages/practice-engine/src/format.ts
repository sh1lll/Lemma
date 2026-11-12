/** Shared number/fraction formatting. Display strings use the true minus sign so they read well and still parse. */

export const MINUS = '−';

export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

export function lcm(a: number, b: number): number {
  return Math.abs(a * b) / gcd(a, b);
}

/** Integer with a true minus sign. */
export function num(n: number): string {
  return n < 0 ? MINUS + String(-n) : String(n);
}

/** Exact rational p/q. Always reduced with a positive denominator. */
export class Q {
  readonly n: number;
  readonly d: number;
  constructor(n: number, d = 1) {
    if (d === 0) throw new Error('zero denominator');
    const g = gcd(n, d) || 1;
    const s = d < 0 ? -1 : 1;
    this.n = (s * n) / g;
    this.d = (s * d) / g;
  }
  static of(n: number, d = 1): Q {
    return new Q(n, d);
  }
  add(o: Q): Q {
    return new Q(this.n * o.d + o.n * this.d, this.d * o.d);
  }
  sub(o: Q): Q {
    return new Q(this.n * o.d - o.n * this.d, this.d * o.d);
  }
  mul(o: Q): Q {
    return new Q(this.n * o.n, this.d * o.d);
  }
  div(o: Q): Q {
    return new Q(this.n * o.d, this.d * o.n);
  }
  neg(): Q {
    return new Q(-this.n, this.d);
  }
  isInt(): boolean {
    return this.d === 1;
  }
  value(): number {
    return this.n / this.d;
  }
  /** "7/3", "−2", "4". */
  toString(): string {
    return this.d === 1 ? num(this.n) : `${num(this.n)}/${this.d}`;
  }
  tex(): string {
    if (this.d === 1) return String(this.n);
    return `${this.n < 0 ? '-' : ''}\\frac{${Math.abs(this.n)}}{${this.d}}`;
  }
}

/** Fixed decimal places with HALF_UP rounding done on the decimal string, not binary floats. */
export function round(x: number, places: number): number {
  const f = 10 ** places;
  return Math.round((x + Math.sign(x) * Number.EPSILON * Math.abs(x)) * f) / f;
}

export function fixed(x: number, places: number): string {
  const s = round(x, places).toFixed(places);
  return s.startsWith('-') ? MINUS + s.slice(1) : s;
}

/** Drops trailing zeros: 12.50 → 12.5, 3.00 → 3. */
export function trim(x: number, maxPlaces = 6): string {
  const s = fixed(x, maxPlaces);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

export function money(x: number): string {
  const s = round(Math.abs(x), 2).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (x < 0 ? MINUS : '') + '$' + s;
}

/** Signed term joiner: [ '3x', '−2', '5x' ] reads "3x − 2 + 5x" when terms carry their own sign. */
export function joinSigned(terms: string[]): string {
  let out = '';
  for (const t of terms) {
    if (!out) out = t;
    else if (t.startsWith(MINUS) || t.startsWith('-')) out += ` ${MINUS} ${t.slice(1)}`;
    else out += ` + ${t}`;
  }
  return out || '0';
}

/** Coefficient times variable: (1,'x') → 'x', (−1,'x') → '−x', (3,'x') → '3x'. */
export function coefVar(c: number, v: string): string {
  if (c === 1) return v;
  if (c === -1) return MINUS + v;
  return num(c) + v;
}

/** TeX variant of a display string: true minus to hyphen, × to \times, ÷ to \div. */
export function toTex(s: string): string {
  return s
    .replace(/−/g, '-')
    .replace(/×/g, '\\times ')
    .replace(/÷/g, '\\div ')
    .replace(/·/g, '\\cdot ')
    .replace(/π/g, '\\pi ')
    .replace(/√(\d+)/g, '\\sqrt{$1}')
    .replace(/\^(-?\d+)/g, '^{$1}')
    .replace(/\$/g, '\\$')
    .replace(/%/g, '\\%');
}
