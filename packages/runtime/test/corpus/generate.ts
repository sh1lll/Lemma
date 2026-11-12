/**
 * Lemma correctness corpus: thousands of problems whose answers are computed here, independently of the engines
 * (exact BigInt rationals, reference conversion factors, plain-JS date and finance formulas), from a fixed seed.
 *
 * Nothing in this file imports an engine. Expected values must never be produced by the code under test.
 */

// ---------------------------------------------------------------- deterministic randomness

/** mulberry32: tiny, fast, good enough for test generation, and identical on every machine. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!;
  return { next, int, pick, chance: (p: number) => next() < p };
}
type Rng = ReturnType<typeof rng>;

// ---------------------------------------------------------------- exact rationals

const babs = (x: bigint) => (x < 0n ? -x : x);
function bgcd(a: bigint, b: bigint): bigint {
  a = babs(a);
  b = babs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

export class Q {
  readonly n: bigint;
  readonly d: bigint;
  constructor(n: bigint | number, d: bigint | number = 1n) {
    let nn = BigInt(n);
    let dd = BigInt(d);
    if (dd === 0n) throw new Error('Q: zero denominator');
    if (dd < 0n) [nn, dd] = [-nn, -dd];
    const g = bgcd(nn, dd) || 1n;
    this.n = nn / g;
    this.d = dd / g;
  }
  /** "12.375" → 12375/1000, exactly. */
  static dec(s: string): Q {
    const neg = s.startsWith('-');
    const [i, f = ''] = s.replace('-', '').split('.');
    return new Q(BigInt((neg ? '-' : '') + i + f), 10n ** BigInt(f.length));
  }
  add(o: Q) { return new Q(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o: Q) { return new Q(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o: Q) { return new Q(this.n * o.n, this.d * o.d); }
  div(o: Q) { return new Q(this.n * o.d, this.d * o.n); }
  pow(k: number): Q {
    if (k < 0) return new Q(1).div(this.pow(-k));
    return new Q(this.n ** BigInt(k), this.d ** BigInt(k));
  }
  isInt() { return this.d === 1n; }
  isZero() { return this.n === 0n; }
  /** Via the exact decimal expansion, so huge numerators and denominators don't overflow to NaN. */
  toNumber() { return Number(this.toDecString()); }
  /** Exact decimal string when it terminates; otherwise 40 significant digits (only used for tolerance compares). */
  toDecString(): string {
    let d = this.d;
    let twos = 0, fives = 0;
    while (d % 2n === 0n) { d /= 2n; twos++; }
    while (d % 5n === 0n) { d /= 5n; fives++; }
    const places = d === 1n ? Math.max(twos, fives) : 40;
    const scaled = (babs(this.n) * 10n ** BigInt(places)) / this.d;
    const s = scaled.toString().padStart(places + 1, '0');
    const int = s.slice(0, s.length - places);
    const frac = s.slice(s.length - places).replace(/0+$/, '');
    return (this.n < 0n ? '-' : '') + int + (frac ? '.' + frac : '');
  }
  /** Rounded to `places` decimals, half away from zero (money). */
  roundHalfUp(places: number): Q {
    const s = 10n ** BigInt(places);
    const x = babs(this.n) * s * 2n + this.d; // (|n|·s + d/2) / d, done in integers
    const r = x / (2n * this.d);
    return new Q(this.n < 0n ? -r : r, s);
  }
  fracString() { return `${this.n}/${this.d}`; }
}
const q = (n: number | bigint, d: number | bigint = 1) => new Q(n, d);

// ---------------------------------------------------------------- formatting the app's way (written independently)

/** "1,234,567" / "−42": en-US grouping and the typographic minus the app displays. */
export function groupInt(n: bigint | number): string {
  const b = BigInt(n);
  const s = babs(b).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (b < 0n ? '−' : '') + s;
}
function groupDec(s: string): string {
  const neg = s.startsWith('-');
  const [i, f] = s.replace('-', '').split('.');
  return (neg ? '−' : '') + i!.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? '.' + f : '');
}
export const moneyStr = (x: Q) => {
  const r = x.roundHalfUp(2);
  const [i, f = ''] = r.toDecString().replace('-', '').split('.');
  return (r.n < 0n ? '−' : '') + '$' + i!.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + f.padEnd(2, '0');
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ---------------------------------------------------------------- the case shape

export interface Case {
  /** Category, one test per category. */
  cat: string;
  /** The input exactly as a person would type it. */
  q: string;
  /** Expected numeric value. A string is an exact decimal (compared exactly); a number is compared with tolerance. */
  num?: number | string;
  /** Relative tolerance for numeric compares (default 1e-9). */
  rel?: number;
  /** Absolute tolerance (default 1e-12). */
  abs?: number;
  /** The primary display must equal this exactly. */
  display?: string;
  /** The exact fraction the calculator reports alongside a non-integer rational result. */
  fraction?: string;
  /** The input must be refused (an error, never a number). A RegExp also checks the message. */
  error?: true | RegExp;
}

// ---------------------------------------------------------------- generators

const SPACES = ['', ' '];

/** Random arithmetic expressions with + − × ÷ and minimal parentheses, so precedence and associativity matter. */
function arithmetic(r: Rng, out: Case[], count: number) {
  type E = { v: Q; s: string; p: number }; // p: 3 atom, 2 product, 1 sum
  const ops = [
    { o: '+', p: 1, f: (a: Q, b: Q) => a.add(b) },
    { o: '-', p: 1, f: (a: Q, b: Q) => a.sub(b) },
    { o: '*', p: 2, f: (a: Q, b: Q) => a.mul(b) },
    { o: '/', p: 2, f: (a: Q, b: Q) => a.div(b) },
  ];
  const sym = (o: string) => (o === '*' ? r.pick(['*', '*', '×', ' x ']) : o === '/' ? r.pick(['/', '/', '÷']) : o === '-' ? r.pick(['-', '-', '−']) : o);
  const leaf = (): E => {
    const n = r.int(1, r.chance(0.2) ? 999 : 30);
    if (r.chance(0.1)) return { v: q(-n), s: `(-${n})`, p: 3 };
    return { v: q(n), s: String(n), p: 3 };
  };
  const build = (depth: number): E => {
    if (depth === 0 || r.chance(0.25)) return leaf();
    const op = r.pick(ops);
    const a = build(depth - 1);
    let b = build(depth - 1);
    while (op.o === '/' && b.v.isZero()) b = leaf();
    const sp = r.pick(SPACES);
    const wrap = (e: E, right: boolean) => {
      const need = e.p < op.p || (right && e.p === op.p && (op.o === '-' || op.o === '/'));
      return need || (e.p < 3 && r.chance(0.15)) ? `(${e.s})` : e.s;
    };
    return { v: op.f(a.v, b.v), s: `${wrap(a, false)}${sp}${sym(op.o)}${sp}${wrap(b, true)}`, p: op.p };
  };
  let made = 0;
  while (made < count) {
    const e = build(r.int(1, 3));
    if (e.p === 3) continue;
    if (babs(e.v.n) > 10n ** 15n || e.v.d > 10n ** 9n) continue;
    out.push(exactCase('arithmetic', e.s, e.v));
    made++;
  }
}

/** A case for an exact rational answer: value exactly; display for integers; the fraction for non-integers. */
function exactCase(cat: string, input: string, v: Q, opts: { display?: boolean } = {}): Case {
  const c: Case = { cat, q: input, num: v.isInt() ? v.n.toString() : v.toNumber() };
  if (!v.isInt()) {
    c.rel = 1e-12;
    // The app reports the exact fraction for denominators up to a million (beyond that it would not help a reader).
    if (v.d <= 1_000_000n) c.fraction = v.fracString();
  } else if (opts.display !== false && babs(v.n) < 10n ** 15n) c.display = groupInt(v.n);
  return c;
}

function decimals(r: Rng, out: Case[], count: number) {
  const dec = () => {
    const places = r.int(1, 3);
    const n = r.int(1, 99999);
    const s = (n / 10 ** places).toFixed(places);
    return s;
  };
  for (let i = 0; i < count; i++) {
    const a = dec(), b = dec();
    const op = r.pick(['+', '-', '*', '/']);
    const A = Q.dec(a), B = Q.dec(b);
    const v = op === '+' ? A.add(B) : op === '-' ? A.sub(B) : op === '*' ? A.mul(B) : A.div(B);
    const c = exactCase('decimals', `${a} ${op} ${b}`, v);
    // A terminating result with few digits must also *display* exactly ("0.1 + 0.2" shows 0.3, never 0.30000000000000004).
    const ds = v.toDecString();
    if (!v.isInt() && ds.length < 30 && ds.replace(/[-.]/g, '').replace(/^0+/, '').length <= 11) c.display = groupDec(ds);
    out.push(c);
  }
}

function powersAndRoots(r: Rng, out: Case[]) {
  const cat = 'powers & roots';
  for (let a = -9; a <= 12; a++) {
    for (const b of [0, 1, 2, 3, 4, 5, 7, 10, 13]) {
      if (a === 0 && b === 0) continue; // 0^0 lives in the tricky set
      const base = a < 0 ? `(${a})` : String(a);
      const v = q(a).pow(b);
      out.push(exactCase(cat, r.pick([`${base}^${b}`, `${base} ^ ${b}`, `${base}**${b}`]), v));
    }
  }
  for (let i = 0; i < 40; i++) {
    const a = r.int(2, 12), b = r.int(1, 6);
    out.push(exactCase(cat, `${a}^-${b}`, q(a).pow(-b)));
    out.push(exactCase(cat, `${a}^(-${b})`, q(a).pow(-b)));
  }
  // Word forms.
  for (let i = 0; i < 30; i++) {
    const a = r.int(2, 40);
    out.push(exactCase(cat, r.pick([`${a} squared`, `${a}²`, `what is ${a} squared`]), q(a * a)));
    out.push(exactCase(cat, r.pick([`${a} cubed`, `${a}³`]), q(a).pow(3)));
    const b = r.int(2, 9);
    out.push(exactCase(cat, r.pick([`${a} to the power of ${b}`, `${a} raised to the power of ${b}`, `${a} to the power ${b}`]), q(a).pow(b)));
  }
  // Perfect roots (exact) and others (tolerance).
  for (let n = 0; n <= 60; n++) {
    out.push(exactCase(cat, r.pick([`sqrt(${n * n})`, `√${n * n}`, `square root of ${n * n}`, `the square root of ${n * n}`, `√(${n * n})`]), q(n)));
  }
  for (let n = -12; n <= 12; n++) {
    const c3 = n * n * n;
    out.push(exactCase(cat, n < 0 ? `cbrt(${c3})` : r.pick([`cbrt(${c3})`, `∛${c3}`, `cube root of ${c3}`]), q(n)));
  }
  for (let i = 0; i < 40; i++) {
    const n = r.int(2, 5000);
    if (Number.isInteger(Math.sqrt(n))) continue;
    out.push({ cat, q: r.pick([`sqrt(${n})`, `√${n}`, `square root of ${n}`]), num: Math.sqrt(n), rel: 1e-12 });
  }
  for (const [k, word] of [[4, '4th'], [5, '5th'], [6, '6th']] as const) {
    for (let b = 2; b <= 6; b++) out.push(exactCase(cat, `${word} root of ${b ** k}`, q(b)));
  }
}

function percentages(r: Rng, out: Case[], count: number) {
  const cat = 'percentages';
  const pcts = [1, 2, 2.5, 5, 7.5, 8, 10, 12, 12.5, 15, 17.5, 20, 25, 30, 33, 40, 50, 60, 65, 75, 80, 90, 100, 110, 150, 200];
  for (let i = 0; i < count; i++) {
    const p = r.pick(pcts);
    const P = Q.dec(String(p)).div(q(100));
    const n = r.chance(0.8) ? r.int(1, 2000) : r.int(1, 99999) / 100;
    const N = Q.dec(String(n));
    const t = r.int(0, 10);
    if (t === 0) out.push(exactCase(cat, r.pick([`${p}% of ${n}`, `what is ${p}% of ${n}`, `${p} percent of ${n}`, `find ${p}% of ${n}`, `calculate ${p}% of ${n}`, `what's ${p}% of ${n}?`]), P.mul(N)));
    else if (t === 1 && p <= 100) out.push(exactCase(cat, r.pick([`${p}% off ${n}`, `${n} - ${p}%`, `${n} minus ${p}%`, `decrease ${n} by ${p}%`, `reduce ${n} by ${p}%`]), N.sub(P.mul(N))));
    else if (t === 2) out.push(exactCase(cat, r.pick([`${n} + ${p}%`, `${n} plus ${p}%`, `increase ${n} by ${p}%`, `${n} plus ${p} percent`]), N.add(P.mul(N))));
    else if (t === 3) {
      // "X is P% of what": X = P·N, so the answer is N.
      const X = P.mul(N);
      if (X.d > 1000n) continue;
      const xs = X.toDecString();
      out.push({ cat, q: r.pick([`${xs} is ${p}% of what`, `${xs} is ${p}% of what number`, `${xs} is ${p} percent of what`]), num: N.toNumber(), rel: 1e-12 });
    } else if (t === 4) {
      const a = r.int(1, 500), b = r.int(1, 1000);
      const v = q(a, b).mul(q(100));
      out.push({ cat, q: r.pick([`what percent is ${a} of ${b}`, `${a} is what percent of ${b}`, `${a} as a percent of ${b}`, `what percentage is ${a} of ${b}`]), num: v.toNumber(), rel: 1e-9 });
    } else if (t === 5) {
      const a = r.int(1, 500), b = r.int(1, 1000);
      if (a === b) continue;
      const v = q(b - a, a).mul(q(100));
      out.push({ cat, q: r.pick([`percent change from ${a} to ${b}`, `percentage change from ${a} to ${b}`]), num: v.toNumber(), rel: 1e-9 });
    } else if (t === 6 && p <= 100) {
      // Money: the currency must survive ("20% off $80" is $64.00, not a bare 64).
      const m = r.int(1, 500);
      const v = q(m).sub(P.mul(q(m)));
      out.push({ cat: 'percentages (money)', q: `${p}% off $${m}`, num: v.toNumber(), rel: 1e-12, display: moneyStr(v) });
    } else {
      out.push(exactCase(cat, `${p}% of ${n}`, P.mul(N)));
    }
  }
}

// Reference conversion factors to SI (NIST SP 811 / exact definitions). Every entry lists spellings people use.
const UNITS: Record<string, [factor: string, names: string[]][]> = {
  length: [
    ['1', ['m', 'meters', 'metres', 'meter']],
    ['1000', ['km', 'kilometers', 'kilometres']],
    ['0.01', ['cm', 'centimeters', 'centimetres']],
    ['0.001', ['mm', 'millimeters']],
    ['1609.344', ['mi', 'miles', 'mile']],
    ['0.9144', ['yd', 'yards', 'yard']],
    ['0.3048', ['ft', 'feet', 'foot']],
    ['0.0254', ['inches', 'inch']],
    ['1852', ['nautical miles']],
  ],
  mass: [
    ['1', ['kg', 'kilograms', 'kilos']],
    ['0.001', ['g', 'grams']],
    ['0.000001', ['mg', 'milligrams']],
    ['0.45359237', ['lb', 'lbs', 'pounds']],
    ['0.028349523125', ['oz', 'ounces']],
    ['6.35029318', ['stone']],
    ['1000', ['tonnes', 'metric tons']],
  ],
  volume: [
    ['0.001', ['L', 'liters', 'litres']],
    ['0.000001', ['mL', 'milliliters', 'ml']],
    ['0.003785411784', ['gallons', 'gal']],
    ['0.000946352946', ['quarts']],
    ['0.0000295735295625', ['fl oz', 'fluid ounces']],
    ['1', ['m^3', 'cubic meters']],
  ],
  time: [
    ['1', ['s', 'seconds', 'secs']],
    ['60', ['min', 'minutes']],
    ['3600', ['h', 'hours', 'hrs']],
    ['86400', ['days']],
    ['604800', ['weeks']],
  ],
  speed: [
    ['1', ['m/s', 'meters per second']],
    ['0.2777777777777777777777777777777777777778', ['km/h', 'kph', 'kilometers per hour']],
    ['0.44704', ['mph', 'miles per hour']],
    ['0.5144444444444444444444444444444444444444', ['knots']],
  ],
  area: [
    ['1', ['m^2', 'square meters', 'm²']],
    ['10000', ['hectares', 'ha']],
    ['4046.8564224', ['acres']],
    ['0.09290304', ['square feet', 'sq ft', 'ft^2']],
    ['1000000', ['km^2', 'square kilometers']],
  ],
  data: [
    ['1', ['bytes', 'B']],
    ['1000', ['kB', 'kilobytes']],
    ['1000000', ['MB', 'megabytes']],
    ['1000000000', ['GB', 'gigabytes']],
    ['1024', ['KiB']],
    ['1048576', ['MiB']],
    ['1073741824', ['GiB']],
  ],
  energy: [
    ['1', ['J', 'joules']],
    ['1000', ['kJ', 'kilojoules']],
    ['4.184', ['cal', 'calories']],
    ['4184', ['kcal']],
    ['3600000', ['kWh']],
  ],
  pressure: [
    ['1', ['Pa', 'pascals']],
    ['1000', ['kPa']],
    ['101325', ['atm', 'atmospheres']],
    ['100000', ['bar']],
  ],
};

function units(r: Rng, out: Case[], count: number) {
  const dims = Object.keys(UNITS);
  for (let i = 0; i < count; i++) {
    const dim = r.pick(dims);
    const list = UNITS[dim]!;
    const [fa, na] = r.pick(list);
    let [fb, nb] = r.pick(list);
    if (fa === fb) [fb, nb] = list[(list.findIndex((u) => u[0] === fa) + 1) % list.length]!;
    const a = r.pick(na), b = r.pick(nb);
    const vs = r.chance(0.6) ? String(r.int(1, 500)) : (r.int(1, 99999) / 100).toFixed(2).replace(/\.?0+$/, '');
    const expected = Q.dec(vs).mul(Q.dec(fa)).div(Q.dec(fb));
    const phr = r.int(0, 4);
    const input =
      phr === 0 ? `${vs} ${a} to ${b}` : phr === 1 ? `${vs} ${a} in ${b}` : phr === 2 ? `convert ${vs} ${a} to ${b}` : phr === 3 ? `how many ${b} in ${vs} ${a}` : `${vs} ${a} into ${b}`;
    out.push({ cat: `units: ${dim}`, q: input, num: expected.toNumber(), rel: 1e-9 });
  }
  // Temperature (affine): C = (F − 32)·5/9, K = C + 273.15.
  const T = [
    ['C', ['C', '°C', 'celsius', 'degrees celsius']],
    ['F', ['F', '°F', 'fahrenheit', 'degrees fahrenheit']],
    ['K', ['K', 'kelvin']],
  ] as const;
  const toC = (u: string, v: Q) => (u === 'C' ? v : u === 'F' ? v.sub(q(32)).mul(q(5, 9)) : v.sub(Q.dec('273.15')));
  const fromC = (u: string, c: Q) => (u === 'C' ? c : u === 'F' ? c.mul(q(9, 5)).add(q(32)) : c.add(Q.dec('273.15')));
  for (let i = 0; i < 80; i++) {
    const [ua, na] = r.pick(T);
    let [ub, nb] = r.pick(T);
    if (ua === ub) [ub, nb] = T[(T.findIndex((t) => t[0] === ua) + 1) % 3]!;
    const v = ua === 'K' ? r.int(0, 600) : r.int(-60, 250);
    const exp = fromC(ub, toC(ua, q(v)));
    out.push({ cat: 'units: temperature', q: `${v} ${r.pick(na)} to ${r.pick(nb)}`, num: exp.toNumber(), rel: 1e-9, abs: 1e-9 });
  }
  // Fixed points everyone knows, with the display checked.
  out.push({ cat: 'units: temperature', q: '100 C to F', num: 212, display: '212' });
  out.push({ cat: 'units: temperature', q: '-40 F to C', num: -40, display: '−40' });
  out.push({ cat: 'units: temperature', q: '0 K to C', num: -273.15, display: '−273.15' });
  out.push({ cat: 'units: temperature', q: '98.6 F to C', num: 37, display: '37' });
}

// Plain JS day arithmetic (UTC, proleptic Gregorian): independent of the date engine's Temporal code.
const DAY = 86_400_000;
function dateStrs(t: number) {
  const d = new Date(t);
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  const mm = String(m + 1).padStart(2, '0'), dd = String(day).padStart(2, '0');
  return {
    iso: `${y}-${mm}-${dd}`,
    long: `${MONTHS[m]} ${day}, ${y}`,
    dmy: `${day} ${MONTHS[m]} ${y}`,
    short: `${MONTHS[m]!.slice(0, 3)} ${day} ${y}`,
    full: `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[m]} ${day}, ${y}`,
    weekday: WEEKDAYS[d.getUTCDay()]!,
  };
}

function dates(r: Rng, out: Case[], count: number) {
  const start = Date.UTC(1980, 0, 1);
  const anyDate = () => start + r.int(0, 60 * 365) * DAY;
  const fmt = (t: number) => {
    const s = dateStrs(t);
    return r.pick([s.iso, s.iso, s.long, s.dmy, s.short]);
  };
  for (let i = 0; i < count; i++) {
    const a = anyDate();
    if (r.chance(0.5)) {
      const b = a + r.int(1, 3000) * DAY;
      const n = Math.round((b - a) / DAY);
      const A = fmt(a), B = fmt(b);
      const input = r.pick([`days between ${A} and ${B}`, `how many days between ${A} and ${B}`, `how many days from ${A} to ${B}`, `number of days between ${A} and ${B}`, `days from ${A} to ${B}`]);
      out.push({ cat: 'dates: days between', q: input, num: n, display: `${groupInt(n)} ${n === 1 ? 'day' : 'days'}` });
    } else {
      const n = r.int(1, 1500);
      const back = r.chance(0.3);
      const t = a + (back ? -n : n) * DAY;
      const A = fmt(a);
      const input = back
        ? r.pick([`${A} minus ${n} days`, `${A} - ${n} days`, `${n} days before ${A}`])
        : r.pick([`${A} + ${n} days`, `${A} plus ${n} days`, `${n} days after ${A}`, `${n} days from ${A}`, `what date is ${n} days after ${A}`]);
      out.push({ cat: 'dates: add days', q: input, display: dateStrs(t).full });
    }
  }
  for (let i = 0; i < 40; i++) {
    const t = anyDate();
    const s = dateStrs(t);
    out.push({ cat: 'dates: weekday', q: r.pick([`what day of the week was ${s.iso}`, `what day of the week is ${s.long}`, `day of week ${s.iso}`]), display: s.weekday });
  }
}

function finance(r: Rng, out: Case[], count: number) {
  const rates = ['2', '2.5', '3', '3.25', '3.5', '4', '4.5', '5', '5.75', '6', '6.5', '7', '8', '9.9', '12'];
  for (let i = 0; i < count; i++) {
    const R = r.pick(rates);
    const rate = Q.dec(R).div(q(100));
    const P = r.pick([500, 1000, 1500, 2000, 2500, 5000, 7500, 10000, 12000, 25000, 50000]);
    const t = r.int(0, 3);
    if (t === 0) {
      const T = r.int(1, 15);
      const I = q(P).mul(rate).mul(q(T));
      const input = r.pick([`simple interest on $${P} at ${R}% for ${T} years`, `simple interest on ${P} at ${R}% for ${T} years`, `simple interest ${P} at ${R}% for ${T} years`]);
      out.push({ cat: 'finance: simple interest', q: input, num: I.roundHalfUp(2).toNumber(), abs: 1e-9, display: moneyStr(I) });
    } else if (t === 1) {
      const T = r.int(1, 25);
      const [freqWord, n] = r.pick([['annually', 1], ['semiannually', 2], ['quarterly', 4], ['monthly', 12]] as const);
      const A = q(P).mul(q(1).add(rate.div(q(n))).pow(n * T));
      const input = r.pick([`$${P} at ${R}% compounded ${freqWord} for ${T} years`, `${P} invested at ${R}% compounded ${freqWord} for ${T} years`, `${P} at ${R}% compounded ${freqWord} for ${T} years`]);
      out.push({ cat: 'finance: compound', q: input, num: A.roundHalfUp(2).toNumber(), abs: 1e-9, display: moneyStr(A) });
    } else {
      const T = r.pick([1, 2, 3, 5, 10, 15, 20, 25, 30]);
      const L = r.pick([5000, 10000, 20000, 35000, 150000, 200000, 250000, 300000, 450000]);
      const rm = rate.div(q(12));
      const nP = 12 * T;
      // M = L·r / (1 − (1 + r)^−n), exactly.
      const M = q(L).mul(rm).div(q(1).sub(q(1).add(rm).pow(-nP)));
      const input = r.pick([
        `monthly payment on a $${L} loan at ${R}% for ${T} years`,
        `loan payment ${L} at ${R}% for ${T} years`,
        `mortgage of $${L} at ${R}% over ${T} years`,
        `payment on ${L} loan ${R}% ${T} years`,
      ]);
      out.push({ cat: 'finance: loan payment', q: input, num: M.roundHalfUp(2).toNumber(), abs: 1e-9, display: moneyStr(M) });
    }
  }
}

function stats(r: Rng, out: Case[], count: number) {
  for (let i = 0; i < count; i++) {
    const len = r.int(2, 12);
    const decimalsToo = r.chance(0.2);
    const xs = Array.from({ length: len }, () => (decimalsToo ? r.int(0, 10000) / 10 : r.int(0, 100)));
    const n = xs.length;
    const mean = xs.reduce((a, b) => a + b, 0) / n;
    const sorted = [...xs].sort((a, b) => a - b);
    const median = n % 2 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
    const ss = xs.reduce((a, b) => a + (b - mean) ** 2, 0);
    const list = r.pick([xs.join(', '), xs.join(','), xs.join(' ')]);
    const t = r.int(0, 6);
    if (t === 0) out.push({ cat: 'stats', q: r.pick([`mean of ${list}`, `average of ${list}`, `the mean of ${list}`, `find the mean of ${list}`]), num: mean, rel: 1e-9, abs: 1e-9 });
    else if (t === 1) out.push({ cat: 'stats', q: r.pick([`median of ${list}`, `the median of ${list}`, `find the median of ${list}`]), num: median, rel: 1e-12, abs: 1e-12 });
    else if (t === 2 && n > 1) out.push({ cat: 'stats', q: r.pick([`standard deviation of ${list}`, `sample standard deviation of ${list}`, `sd of ${list}`, `stdev of ${list}`]), num: Math.sqrt(ss / (n - 1)), rel: 1e-9, abs: 1e-9 });
    else if (t === 3) out.push({ cat: 'stats', q: `population standard deviation of ${list}`, num: Math.sqrt(ss / n), rel: 1e-9, abs: 1e-9 });
    else if (t === 4 && n > 1) out.push({ cat: 'stats', q: r.pick([`variance of ${list}`, `sample variance of ${list}`]), num: ss / (n - 1), rel: 1e-9, abs: 1e-9 });
    else if (t === 5) out.push({ cat: 'stats', q: `population variance of ${list}`, num: ss / n, rel: 1e-9, abs: 1e-9 });
    else out.push({ cat: 'stats', q: `range of ${list}`, num: sorted[n - 1]! - sorted[0]!, rel: 1e-12, abs: 1e-9 });
  }
}

function numberTheory(r: Rng, out: Case[]) {
  const cat = 'number theory';
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  for (let i = 0; i < 120; i++) {
    const k = r.int(1, 30);
    const a = k * r.int(1, 60), b = k * r.int(1, 60);
    const two = r.chance(0.7);
    const c = k * r.int(1, 40);
    const g = two ? gcd(a, b) : gcd(gcd(a, b), c);
    const l = two ? (a * b) / gcd(a, b) : [a, b, c].reduce((x, y) => (x * y) / gcd(x, y));
    const args = two ? `${a}, ${b}` : `${a}, ${b}, ${c}`;
    const argsAnd = two ? `${a} and ${b}` : `${a}, ${b} and ${c}`;
    out.push({ cat, q: r.pick([`gcd(${args})`, `gcd of ${argsAnd}`, `hcf of ${argsAnd}`, `gcf of ${argsAnd}`, `greatest common divisor of ${argsAnd}`]), num: String(g), display: groupInt(g) });
    out.push({ cat, q: r.pick([`lcm(${args})`, `lcm of ${argsAnd}`, `least common multiple of ${argsAnd}`]), num: String(l), display: groupInt(l) });
  }
  // Primality against a sieve.
  const LIMIT = 20000;
  const comp = new Uint8Array(LIMIT + 1);
  comp[0] = comp[1] = 1;
  for (let i = 2; i * i <= LIMIT; i++) if (!comp[i]) for (let j = i * i; j <= LIMIT; j += i) comp[j] = 1;
  for (let i = 0; i < 120; i++) {
    const n = i < 10 ? i + 1 : r.int(2, LIMIT);
    out.push({ cat: 'number theory: primes', q: r.pick([`is ${n} prime`, `is ${n} a prime number`, `is ${n} prime?`]), display: comp[n] ? 'No' : 'Yes, prime' });
  }
  const primes: number[] = [];
  for (let i = 2; i <= LIMIT; i++) if (!comp[i]) primes.push(i);
  for (let i = 0; i < 30; i++) {
    const k = r.int(1, 1000);
    const suf = k % 100 >= 11 && k % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][k % 10] ?? 'th';
    out.push({ cat: 'number theory: primes', q: `${k}${suf} prime`, num: String(primes[k - 1]) });
  }
  // Prime factorisation, written the app's way: 2³ × 3² × 5.
  const sup = (e: number) => (e === 1 ? '' : String(e).replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]!));
  for (let i = 0; i < 40; i++) {
    let n = r.int(2, 100000);
    if (!comp[n] && n <= LIMIT) continue;
    const orig = n;
    const parts: string[] = [];
    for (let p = 2; p * p <= n; p++) {
      let e = 0;
      while (n % p === 0) { n /= p; e++; }
      if (e) parts.push(`${p}${sup(e)}`);
    }
    if (n > 1) parts.push(String(n));
    if (parts.length < 2) continue;
    out.push({ cat: 'number theory: factorisation', q: r.pick([`prime factorization of ${orig}`, `prime factors of ${orig}`, `prime factorisation of ${orig}`]), display: parts.join(' × ') });
  }
  // Factorials and double factorials, exactly.
  let f = 1n;
  for (let n = 0; n <= 40; n++) {
    if (n) f *= BigInt(n);
    out.push({ cat: 'number theory: factorials', q: r.pick([`${n}!`, `${n} factorial`, `factorial(${n})`]), num: f.toString(), ...(f < 10n ** 15n ? { display: groupInt(f) } : {}) });
  }
  for (let n = 0; n <= 30; n++) {
    let d = 1n;
    for (let k = n; k > 1; k -= 2) d *= BigInt(k);
    out.push({ cat: 'number theory: factorials', q: `${n}!!`, num: d.toString() });
  }
  // Combinations and permutations.
  const C = (n: number, k: number) => { let x = 1n; for (let i = 1; i <= k; i++) x = (x * BigInt(n - k + i)) / BigInt(i); return x; };
  const Pm = (n: number, k: number) => { let x = 1n; for (let i = 0; i < k; i++) x *= BigInt(n - i); return x; };
  for (let i = 0; i < 40; i++) {
    const n = r.int(1, 30), k = r.int(0, n);
    out.push({ cat: 'number theory: combinatorics', q: r.pick([`${n} choose ${k}`, `nCr(${n},${k})`, `C(${n}, ${k})`]), num: C(n, k).toString() });
    out.push({ cat: 'number theory: combinatorics', q: r.pick([`nPr(${n},${k})`, `${n}P${k}`]), num: Pm(n, k).toString() });
  }
}

function trig(r: Rng, out: Case[]) {
  const cat = 'trig (degrees)';
  const S3 = Math.sqrt(3), S2 = Math.sqrt(2);
  // Exact values at the standard angles, by quadrant symmetry (written out, not computed by Math.sin).
  const base: Record<number, [sin: number, cos: number]> = { 0: [0, 1], 30: [0.5, S3 / 2], 45: [S2 / 2, S2 / 2], 60: [S3 / 2, 0.5], 90: [1, 0] };
  const exact = (deg: number): [number, number] => {
    const a = ((deg % 360) + 360) % 360;
    const quad = Math.floor(a / 90), ref = a % 90;
    const [s0, c0] = base[ref] ?? [NaN, NaN];
    if (quad === 0) return [s0, c0];
    if (quad === 1) return [c0, -s0];
    if (quad === 2) return [-s0, -c0];
    return [-c0, s0];
  };
  const pretty: Record<string, string> = { '0': '0', '1': '1', '-1': '−1', '0.5': '0.5', '-0.5': '−0.5' };
  const angles = [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330, 360, -30, -45, -90, 390, 720];
  for (const deg of angles) {
    const [s, c] = exact(deg);
    for (const [fn, v] of [['sin', s], ['cos', c], ['tan', c === 0 ? NaN : s / c]] as const) {
      const input = r.pick([`${fn}(${deg})`, `${fn}(${deg}°)`, `${fn} ${deg}°`, `${fn}(${deg} degrees)`, `${fn} of ${deg} degrees`]);
      if (Number.isNaN(v)) out.push({ cat, q: input, error: true });
      else {
        const key = String(Math.round(v * 1e12) / 1e12);
        out.push({ cat, q: input, num: v, abs: 1e-12, rel: 1e-12, ...(pretty[key] ? { display: pretty[key] } : {}) });
      }
    }
  }
  // Inverse trig answers in degrees.
  for (const [x, deg] of [['0.5', 30], ['1', 90], ['0', 0], ['-0.5', -30], ['-1', -90]] as const) out.push({ cat, q: `asin(${x})`, num: deg, abs: 1e-12, display: `${deg < 0 ? '−' : ''}${Math.abs(deg)}°` });
  for (const [x, deg] of [['0.5', 60], ['1', 0], ['0', 90], ['-0.5', 120], ['-1', 180]] as const) out.push({ cat, q: `acos(${x})`, num: deg, abs: 1e-12, display: `${deg}°` });
  for (const [x, deg] of [['1', 45], ['0', 0], ['-1', -45]] as const) out.push({ cat, q: `atan(${x})`, num: deg, abs: 1e-12, display: `${deg < 0 ? '−' : ''}${Math.abs(deg)}°` });
  // Non-standard angles against Math (tolerance).
  for (let i = 0; i < 40; i++) {
    const deg = r.int(-720, 720);
    if (deg % 15 === 0) continue;
    const fn = r.pick(['sin', 'cos', 'tan'] as const);
    const v = Math[fn]((deg * Math.PI) / 180);
    out.push({ cat, q: `${fn}(${deg})`, num: v, rel: 1e-9, abs: 1e-12 });
  }
  // π in the argument means radians.
  out.push({ cat, q: 'sin(pi/6)', num: 0.5, abs: 1e-12, display: '0.5' });
  out.push({ cat, q: 'cos(pi/3)', num: 0.5, abs: 1e-12, display: '0.5' });
  out.push({ cat, q: 'tan(pi/4)', num: 1, abs: 1e-12, display: '1' });
  out.push({ cat, q: 'cos(pi)', num: -1, abs: 1e-12, display: '−1' });
}

function logs(r: Rng, out: Case[]) {
  const cat = 'logs';
  for (let k = -6; k <= 12; k++) {
    const x = Q.dec('1').mul(q(10).pow(k)).toDecString();
    out.push({ cat, q: r.pick([`log(${x})`, `log10(${x})`, `log ${x}`]), num: k, abs: 1e-12, display: groupInt(k) });
  }
  for (let k = 0; k <= 20; k++) out.push({ cat, q: r.pick([`log2(${2 ** k})`, `log base 2 of ${2 ** k}`, `log_2(${2 ** k})`]), num: k, abs: 1e-12, display: String(k) });
  for (let k = -3; k <= 6; k++) out.push({ cat, q: k === 1 ? 'ln(e)' : `ln(e^${k < 0 ? `(${k})` : k})`, num: k, abs: 1e-12, display: groupInt(k) });
  for (let i = 0; i < 40; i++) {
    const b = r.int(2, 9), k = r.int(1, 6);
    out.push({ cat, q: r.pick([`log base ${b} of ${b ** k}`, `log_${b}(${b ** k})`]), num: k, abs: 1e-12, display: String(k) });
  }
  for (let i = 0; i < 40; i++) {
    const x = r.int(2, 100000) / r.pick([1, 10, 100]);
    const fn = r.pick(['ln', 'log'] as const);
    out.push({ cat, q: `${fn}(${x})`, num: fn === 'ln' ? Math.log(x) : Math.log10(x), rel: 1e-12, abs: 1e-12 });
  }
  for (let i = 0; i < 20; i++) {
    const x = r.int(-20, 20) / 4;
    out.push({ cat, q: r.pick([`e^${x < 0 ? `(${x})` : x}`, `exp(${x})`]), num: Math.exp(x), rel: 1e-12 });
  }
  out.push({ cat, q: 'log(0)', error: true }, { cat, q: 'ln(0)', error: true });
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const words = (n: number) => (n < 20 ? ONES[n]! : TENS[Math.floor(n / 10)]! + (n % 10 ? `-${ONES[n % 10]}` : ''));

function naturalLanguage(r: Rng, out: Case[], count: number) {
  const cat = 'natural language';
  for (let i = 0; i < count; i++) {
    const a = r.int(1, 99), b = r.int(1, 99);
    const t = r.int(0, 9);
    const lead = r.pick(['', 'what is ', "what's ", 'whats ', 'calculate ', 'compute ', 'how much is ', 'work out ']);
    const tail = r.pick(['', '', '?']);
    if (t === 0) out.push(exactCase(cat, `${lead}${a} plus ${b}${tail}`, q(a + b)));
    else if (t === 1) out.push(exactCase(cat, `${lead}${a} minus ${b}${tail}`, q(a - b)));
    else if (t === 2) out.push(exactCase(cat, `${lead}${a} times ${b}${tail}`, q(a * b)));
    else if (t === 3) out.push(exactCase(cat, `${lead}${a} multiplied by ${b}${tail}`, q(a * b)));
    else if (t === 4) out.push(exactCase(cat, `${lead}${a} divided by ${b}${tail}`, q(a, b)));
    else if (t === 5) out.push(exactCase(cat, `${lead}${words(a)} plus ${words(b)}${tail}`, q(a + b)));
    else if (t === 6) out.push(exactCase(cat, `${lead}${words(a)} times ${words(b)}${tail}`, q(a * b)));
    else if (t === 7) out.push(exactCase(cat, `${lead}half of ${2 * a}${tail}`, q(a)));
    else if (t === 8) {
      const c = r.int(1, 9);
      out.push(exactCase(cat, `${lead}${a} + ${b} * ${c}`, q(a + b * c)));
    }
    else out.push(exactCase(cat, `${lead}${a} squared${tail}`, q(a * a)));
  }
}

function typos(r: Rng, out: Case[], count: number) {
  const cat = 'typos & variants';
  for (let i = 0; i < count; i++) {
    const n = r.int(1, 40);
    const a = r.int(1, 99), b = r.int(1, 99);
    const t = r.int(0, 7);
    if (t === 0) out.push(exactCase(cat, `${r.pick(['squareroot of', 'sqaure root of', 'sqroot', 'square root', 'sqare root of'])} ${n * n}`, q(n)));
    else if (t === 1) out.push(exactCase(cat, `${r.pick(['whats', 'wat is', 'what is', 'whta is'])} ${a}+${b}`, q(a + b)));
    else if (t === 2) out.push(exactCase(cat, `${a}+${b}=`, q(a + b)));
    else if (t === 3) out.push(exactCase(cat, `  ${a}   *  ${b}  `, q(a * b)));
    else if (t === 4) out.push(exactCase(cat, `${a} X ${b}`, q(a * b)));
    else if (t === 5) out.push(exactCase(cat, `${a}x${b}`, q(a * b)));
    else if (t === 6) out.push(exactCase(cat, `${a} − ${b}`, q(a - b)));
    else out.push(exactCase(cat, `${a}*(${b})`, q(a * b)));
  }
}

function moreArithmetic(r: Rng, out: Case[]) {
  // Big integers stay exact (the value, even when the display switches to scientific notation).
  for (let i = 0; i < 60; i++) {
    const a = BigInt(r.int(1, 999999)) * 10n ** BigInt(r.int(0, 9)) + BigInt(r.int(0, 999));
    const b = BigInt(r.int(1, 999999999));
    const op = r.pick(['*', '+', '-'] as const);
    const v = op === '*' ? a * b : op === '+' ? a + b : a - b;
    out.push({ cat: 'big integers', q: `${a} ${op} ${b}`, num: v.toString(), ...(babs(v) < 10n ** 15n ? { display: groupInt(v) } : {}) });
  }
  for (let k = 50; k <= 200; k += 10) out.push({ cat: 'big integers', q: `2^${k}`, num: (2n ** BigInt(k)).toString() });
  // Thousands separators in the input.
  for (let i = 0; i < 40; i++) {
    const a = r.int(1000, 9999999), b = r.int(1000, 9999999);
    out.push(exactCase('big integers', `${groupInt(a)} + ${groupInt(b)}`, q(a + b)));
  }
  // Scientific notation in the input.
  for (let i = 0; i < 40; i++) {
    const m1 = r.int(1, 99) / 10, e1 = r.int(-6, 9), m2 = r.int(1, 99) / 10, e2 = r.int(-6, 9);
    const A = Q.dec(String(m1)).mul(q(10).pow(e1)), B = Q.dec(String(m2)).mul(q(10).pow(e2));
    out.push({ cat: 'scientific notation', q: `${m1}e${e1} * ${m2}e${e2}`, num: A.mul(B).toNumber(), rel: 1e-12 });
  }
  // Modulo (the result takes the divisor's sign, as in mathematics), abs, floor, ceil, rounding.
  for (let i = 0; i < 60; i++) {
    const a = r.int(-500, 500), b = r.int(1, 40);
    out.push({ cat: 'integer functions', q: r.pick([`${a} mod ${b}`, `mod(${a}, ${b})`]), num: String(((a % b) + b) % b) });
    const x = r.int(-9999, 9999) / 100;
    out.push({ cat: 'integer functions', q: `abs(${x})`, num: Math.abs(x), rel: 1e-12 });
    out.push({ cat: 'integer functions', q: `floor(${x})`, num: String(Math.floor(x)) });
    out.push({ cat: 'integer functions', q: `ceil(${x})`, num: String(Math.ceil(x) === 0 ? 0 : Math.ceil(x)) });
  }
  // Rounding: half away from zero (school rounding), on exact decimals.
  for (let i = 0; i < 60; i++) {
    const places = r.int(0, 3);
    const raw = (r.int(-99999, 99999) / 10 ** (places + 1)).toFixed(places + 1);
    const v = Q.dec(raw).roundHalfUp(places);
    const input = places === 0 ? `round ${raw}` : `round ${raw} to ${places} decimal place${places > 1 ? 's' : ''}`;
    out.push({ cat: 'rounding', q: input, num: v.toNumber(), rel: 0, abs: 1e-12 });
  }
  // Fractions of amounts, and mixed numbers.
  const fracWords: [string, number, number][] = [['half', 1, 2], ['a third', 1, 3], ['two thirds', 2, 3], ['a quarter', 1, 4], ['three quarters', 3, 4], ['a fifth', 1, 5], ['three fifths', 3, 5]];
  for (let i = 0; i < 60; i++) {
    const n = r.int(1, 999);
    if (r.chance(0.5)) {
      const [w, a, b] = r.pick(fracWords);
      out.push(exactCase('fractions', `${w} of ${n}`, q(a * n, b)));
    } else {
      const a = r.int(1, 9), b = r.int(a + 1, 12);
      out.push(exactCase('fractions', `${a}/${b} of ${n}`, q(a * n, b)));
    }
  }
  for (let i = 0; i < 60; i++) {
    const a = r.int(1, 12), b = r.int(1, 12), c = r.int(2, 12);
    const d = r.int(1, 12), e = r.int(2, 12);
    const A = q(a).add(q(b % c || 1, c)), B = q(d % e || 1, e);
    const op = r.pick(['+', '-', '*', '/']);
    const v = op === '+' ? A.add(B) : op === '-' ? A.sub(B) : op === '*' ? A.mul(B) : A.div(B);
    out.push({ cat: 'fractions', q: `(${A.n}/${A.d}) ${op} (${B.n}/${B.d})`, num: v.isInt() ? v.n.toString() : v.toNumber(), rel: 1e-12, ...(v.isInt() ? {} : { fraction: v.fracString() }) });
  }
  // Money in plain arithmetic keeps its currency, to the cent.
  for (let i = 0; i < 60; i++) {
    const a = Q.dec((r.int(1, 99999) / 100).toFixed(2)), b = Q.dec((r.int(1, 9999) / 100).toFixed(2));
    const t = r.int(0, 3);
    const [input, v] =
      t === 0 ? [`$${a.toDecString()} + $${b.toDecString()}`, a.add(b)]
      : t === 1 ? [`$${a.toDecString()} * ${r.int(2, 9)}`, null]
      : t === 2 ? [`${r.pick([10, 15, 18, 20, 25])}% of $${a.toDecString()}`, null]
      : [`£${a.toDecString()} - £${b.toDecString()}`, a.sub(b)];
    let val = v;
    if (!val) {
      const m = /\* (\d+)$/.exec(input as string);
      const pm = /^(\d+)% of/.exec(input as string);
      val = m ? a.mul(q(+m[1]!)) : a.mul(q(+pm![1]!, 100));
    }
    const sym = (input as string).includes('£') ? '£' : '$';
    out.push({ cat: 'money arithmetic', q: input as string, num: val.toNumber(), rel: 1e-12, display: moneyStr(val).replace('$', sym) });
  }
}

function wordProblems(r: Rng, out: Case[]) {
  // Distance ÷ time, in the units the question used.
  for (let i = 0; i < 40; i++) {
    const [lu, tu] = r.pick([['km', 'hours'], ['miles', 'hours'], ['m', 'seconds']] as const);
    const t = r.pick([1, 2, 2.5, 3, 4, 5, 8, 10, 12.5, 20]);
    const v = r.int(2, 150);
    const d = v * t;
    const who = r.pick(['a train', 'a car', 'a cyclist', 'a bus', 'a runner']);
    const verb = r.pick(['travels', 'covers']);
    out.push({ cat: 'word problems: speed', q: `${who} ${verb} ${d} ${lu} in ${t} ${tu}. what is its ${r.pick(['speed', 'average speed'])}?`, num: v, rel: 1e-12, display: String(v) });
  }
  // Every one of n independent trials succeeds: p^n.
  for (let n = 2; n <= 6; n++) {
    const word = ['', '', 'twice', 'three times', '4 times', '5 times', '6 times'][n]!;
    out.push({ cat: 'word problems: probability', q: `probability of rolling a 6 ${word}`, num: 1 / 6 ** n, rel: 1e-6 });
    out.push({ cat: 'word problems: probability', q: `probability of getting heads ${n} times in a row`, num: 1 / 2 ** n, rel: 1e-6 });
  }
  out.push({ cat: 'word problems: probability', q: 'probability of rolling two sixes', num: 1 / 36, rel: 1e-6 });
  // Future value of a monthly deposit (ordinary annuity, compounded monthly as the payments are): FV = PMT·((1+i)^n − 1)/i.
  for (let i = 0; i < 30; i++) {
    const pmt = r.pick([50, 100, 200, 250, 500, 1000]);
    const R = r.pick(['3', '4', '5', '6', '7', '8']);
    const T = r.int(1, 30);
    const im = Q.dec(R).div(q(1200));
    const fv = q(pmt).mul(q(1).add(im).pow(12 * T).sub(q(1))).div(im);
    out.push({ cat: 'finance: annuity', q: `future value of ${pmt} per month at ${R}% for ${T} years`, num: fv.toNumber(), rel: 1e-9, display: moneyStr(fv) });
  }
  // Continuous compounding: A = P·e^(rt).
  for (let i = 0; i < 20; i++) {
    const P = r.pick([1000, 2500, 5000, 10000]), R = r.int(1, 12), T = r.int(1, 30);
    const A = P * Math.exp((R / 100) * T);
    out.push({ cat: 'finance: compound', q: `${P} at ${R}% compounded continuously for ${T} years`, num: Math.round(A * 100) / 100, abs: 0.006 });
  }
  // Adding weeks to a date.
  for (let i = 0; i < 30; i++) {
    const t0 = Date.UTC(1990, 0, 1) + r.int(0, 40 * 365) * DAY;
    const w = r.int(1, 120);
    out.push({ cat: 'dates: add days', q: `${dateStrs(t0).iso} + ${w} weeks`, display: dateStrs(t0 + w * 7 * DAY).full });
  }
}

/** The whole corpus. Same seed, same corpus, on every machine. */
export function generateCorpus(seed = 20261102): Case[] {
  const r = rng(seed);
  const out: Case[] = [];
  arithmetic(r, out, 1200);
  decimals(r, out, 300);
  powersAndRoots(r, out);
  percentages(r, out, 600);
  units(r, out, 600);
  dates(r, out, 400);
  finance(r, out, 300);
  stats(r, out, 400);
  numberTheory(r, out);
  trig(r, out);
  logs(r, out);
  naturalLanguage(r, out, 250);
  typos(r, out, 150);
  moreArithmetic(r, out);
  wordProblems(r, out);
  return out;
}
