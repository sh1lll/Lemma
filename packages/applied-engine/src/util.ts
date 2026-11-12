import { D, MathError, formatNumber, type Answer, type AnswerResult } from '@lemma/math-core';

/** Answer kinds produced here. */
export type Kind = 'physics' | 'chemistry' | 'engineering' | 'computing' | 'ml' | 'medical' | 'biology' | 'social';

export interface Ctx {
  /** The user's text, untouched. */
  input: string;
  /** Normalised, case preserved (units like mA vs MA and formulas are case-sensitive). */
  t: string;
  /** Lowercase of {@link t}, same length. */
  s: string;
}

export type Handler = (c: Ctx) => AnswerResult | null;

/** Clinical calculators always carry this. */
export const MEDICAL_NOTE = 'For education, not medical advice: check doses and clinical decisions against local protocols and a clinician.';

// CODATA 2018 (exact SI values where defined).
export const K = {
  c: 299792458,
  h: 6.62607015e-34,
  hbar: 6.62607015e-34 / (2 * Math.PI),
  e: 1.602176634e-19,
  NA: 6.02214076e23,
  kB: 1.380649e-23,
  R: 8.314462618,
  G: 6.6743e-11,
  me: 9.1093837015e-31,
  mp: 1.67262192369e-27,
  mn: 1.67492749804e-27,
  u: 1.6605390666e-27,
  eps0: 8.8541878128e-12,
  mu0: 1.25663706212e-6,
  ke: 8.9875517923e9,
  sigma: 5.670374419e-8,
  F: 96485.33212,
  atm: 101325,
  RydE: 13.605693122994, // eV
  wien: 2.897771955e-3,
  /** MeV per atomic mass unit. */
  uMeV: 931.49410242,
};

export const SUP: Record<string, string> = { '-': '⁻', '+': '⁺', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
const SUP_BACK: Record<string, string> = Object.fromEntries(Object.entries(SUP).map(([a, b]) => [b, a]));

/** Whitespace, dashes, "× 10^-3" scientific notation and "²"→"^2", preserving case. */
export function normalise(input: string): string {
  let t = input
    .replace(/[’‘]/g, "'")
    .replace(/[−–—]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[?!.]+$/, '')
    .trim();
  t = t.replace(/(\d(?:[\d.]*\d)?)\s*(?:x|×|\*|·)\s*10\s*(?:\^\s*\(?\s*([-+]?\d+)\s*\)?|([⁻⁺]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+))/g, (_m, a: string, e1?: string, e2?: string) => `${a}e${e1 ?? toAscii(e2 ?? '')}`);
  t = t.replace(/(^|[^\d.\w])10\s*(?:\^\s*\(?\s*([-+]?\d+)\s*\)?|([⁻⁺][⁰¹²³⁴⁵⁶⁷⁸⁹]+))/g, (_m, pre: string, e1?: string, e2?: string) => `${pre}1e${e1 ?? toAscii(e2 ?? '')}`);
  return t;
}
const toAscii = (s: string) => [...s].map((ch) => SUP_BACK[ch] ?? ch).join('');

export function makeCtx(input: string): Ctx {
  const t = normalise(input);
  let s = t.toLowerCase();
  if (s.length !== t.length) s = t.replace(/[A-Z]/g, (ch) => ch.toLowerCase());
  return { input, t, s };
}

/** A plain number: "12", "1,500", "0.25", ".5", "1.5e-3". */
export const NUM = String.raw`(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)(?:e[-+]?\d+)?`;
export const SNUM = String.raw`[-+]?${NUM}`;
export const num = (raw: string): number => Number(raw.replace(/,/g, ''));

export interface Shown {
  display: string;
  plain: string;
  spoken: string;
}

/** Significant-figure display; scientific notation outside 0.001 … 10⁹. */
export function fmt(x: number, sig = 4): Shown {
  if (!Number.isFinite(x)) return { display: String(x), plain: String(x), spoken: String(x) };
  if (x === 0) return { display: '0', plain: '0', spoken: '0' };
  const a = Math.abs(x);
  if (a >= 1e9 || a < 1e-3) {
    const [m = '', e = '0'] = x.toExponential(sig - 1).split('e');
    const mant = m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m;
    const exp = String(Number(e));
    const disp = mant === '1' ? `10${[...exp].map((ch) => SUP[ch] ?? ch).join('')}` : `${mant.replace('-', '−')} × 10${[...exp].map((ch) => SUP[ch] ?? ch).join('')}`;
    return { display: disp, plain: `${mant}e${exp}`, spoken: `${mant} times ten to the ${exp.startsWith('-') ? 'negative ' + exp.slice(1) : exp}` };
  }
  const f = formatNumber(new D(x.toPrecision(15)), { digits: sig });
  return { display: f.display, plain: f.plain, spoken: f.spoken };
}
export const show = (x: number, sig = 4) => fmt(x, sig).display;
/** "12.5 m/s" */
export const withUnit = (x: number, unit: string, sig = 4) => (unit ? `${show(x, sig)} ${unit}` : show(x, sig));
export const pct = (x: number, sig = 4) => `${show(x * 100, sig)}%`;

export interface Res {
  kind: Kind;
  /** What was understood. */
  expression: string;
  value?: number;
  unit?: string;
  /** Words for the unit, for speech. */
  unitWords?: string;
  sig?: number;
  /** Overrides the formatted value. */
  display?: string;
  /** Formula used, shown as the first line. */
  formula?: string;
  lines?: [string, string][];
  notes?: string[];
  table?: Answer['table'];
}

export function res(c: Ctx, r: Res): Answer {
  const sig = r.sig ?? 4;
  const f = r.value !== undefined ? fmt(r.value, sig) : null;
  const display = r.display ?? (f ? (r.unit ? `${f.display} ${r.unit}` : f.display) : '');
  const plain = r.display ?? (f ? (r.unit ? `${f.plain} ${r.unit}` : f.plain) : '');
  const spoken = r.display ?? (f ? `${f.spoken}${r.unitWords ?? r.unit ? ` ${r.unitWords ?? r.unit}` : ''}` : '');
  const lines: { label: string; display: string }[] = [];
  if (r.formula) lines.push({ label: 'Formula', display: r.formula });
  for (const [label, d] of r.lines ?? []) lines.push({ label, display: d });
  const a: Answer = {
    ok: true,
    kind: r.kind,
    input: c.input,
    expression: r.expression,
    primary: { display, plain, spoken, ...(r.unit ? { unit: r.unit } : {}) },
    notes: r.notes ?? [],
    exactness: 'numeric',
  };
  if (r.value !== undefined && Number.isFinite(r.value)) a.value = new D(r.value.toPrecision(15));
  if (lines.length) a.lines = lines;
  if (r.table) a.table = r.table;
  return a;
}

/** A missing input is a question back, never a guess. */
export function need(c: Ctx, kind: Kind, what: string): AnswerResult {
  return { ok: false, kind, input: c.input, error: new MathError('ambiguous-reference', what) };
}
export function fail(c: Ctx, kind: Kind, message: string): AnswerResult {
  return { ok: false, kind, input: c.input, error: new MathError('domain', message) };
}

// ───────────────────────────── quantities with units ─────────────────────────────

export type Dim =
  | 'length' | 'time' | 'mass' | 'velocity' | 'accel' | 'force' | 'energy' | 'power' | 'pressure' | 'charge' | 'voltage'
  | 'current' | 'resistance' | 'capacitance' | 'inductance' | 'frequency' | 'volume' | 'area' | 'density' | 'angle'
  | 'angvel' | 'amount' | 'field' | 'flux' | 'data' | 'rate' | 'stiffness' | 'torque' | 'inertia' | 'molarenergy'
  | 'conc' | 'massconc' | 'dose' | 'flow' | 'viscosity' | 'kinvisc' | 'linear' | 'intensity' | 'inertia4' | 'apparent' | 'reactive';

export interface Qty {
  dim: Dim;
  /** SI value (degrees for angles, bits for data, bit/s for rates, mol/L for conc, mg/kg for doses). */
  v: number;
  raw: string;
  unit: string;
  index: number;
  end: number;
}

type U = [string, Dim, number];
const kmh = 1 / 3.6;
// Case-sensitive symbols.
const SYMBOLS: U[] = [
  ['m/s²', 'accel', 1], ['m/s^2', 'accel', 1], ['m/s2', 'accel', 1], ['ft/s²', 'accel', 0.3048], ['ft/s^2', 'accel', 0.3048],
  ['m/s', 'velocity', 1], ['km/s', 'velocity', 1000], ['km/h', 'velocity', kmh], ['km/hr', 'velocity', kmh], ['kph', 'velocity', kmh], ['kmh', 'velocity', kmh], ['mph', 'velocity', 0.44704], ['ft/s', 'velocity', 0.3048], ['cm/s', 'velocity', 0.01],
  ['rad/s', 'angvel', 1], ['rpm', 'angvel', (2 * Math.PI) / 60], ['RPM', 'angvel', (2 * Math.PI) / 60],
  ['kg·m²', 'inertia', 1], ['kg m^2', 'inertia', 1], ['kg m²', 'inertia', 1], ['kg*m^2', 'inertia', 1], ['kgm^2', 'inertia', 1], ['kg·m^2', 'inertia', 1],
  ['m^4', 'inertia4', 1], ['m⁴', 'inertia4', 1], ['mm^4', 'inertia4', 1e-12], ['mm⁴', 'inertia4', 1e-12], ['cm^4', 'inertia4', 1e-8], ['cm⁴', 'inertia4', 1e-8], ['in^4', 'inertia4', 4.162314256e-7],
  ['N·m', 'torque', 1], ['N m', 'torque', 1], ['Nm', 'torque', 1], ['N*m', 'torque', 1], ['kN·m', 'torque', 1000], ['kNm', 'torque', 1000], ['kN m', 'torque', 1000],
  ['N/m', 'stiffness', 1], ['kN/m', 'stiffness', 1000], ['N/cm', 'stiffness', 100], ['N/mm', 'stiffness', 1000],
  ['kg/m³', 'density', 1], ['kg/m^3', 'density', 1], ['kg/m3', 'density', 1], ['g/cm³', 'density', 1000], ['g/cm^3', 'density', 1000], ['g/cm3', 'density', 1000], ['g/mL', 'density', 1000], ['g/ml', 'density', 1000], ['kg/L', 'density', 1000],
  ['kg/m', 'linear', 1], ['g/m', 'linear', 1e-3],
  ['mg/kg', 'dose', 1], ['mcg/kg', 'dose', 1e-3], ['µg/kg', 'dose', 1e-3], ['g/kg', 'dose', 1000],
  ['mg/L', 'massconc', 1], ['mg/l', 'massconc', 1], ['mg/mL', 'massconc', 1000], ['mg/ml', 'massconc', 1000], ['g/L', 'massconc', 1000], ['µg/mL', 'massconc', 1], ['mcg/mL', 'massconc', 1], ['ng/mL', 'massconc', 1e-3],
  ['mol/L', 'conc', 1], ['mol/l', 'conc', 1], ['mol/dm3', 'conc', 1], ['mM', 'conc', 1e-3], ['µM', 'conc', 1e-6], ['uM', 'conc', 1e-6], ['nM', 'conc', 1e-9], ['M', 'conc', 1],
  ['kJ/mol', 'molarenergy', 1000], ['J/mol', 'molarenergy', 1], ['kcal/mol', 'molarenergy', 4184], ['eV', 'energy', K.e],
  ['W/m²', 'intensity', 1], ['W/m^2', 'intensity', 1], ['W/m2', 'intensity', 1],
  ['m³/s', 'flow', 1], ['m^3/s', 'flow', 1], ['L/s', 'flow', 1e-3], ['L/min', 'flow', 1e-3 / 60], ['mL/h', 'flow', 1e-6 / 3600], ['mL/hr', 'flow', 1e-6 / 3600], ['mL/min', 'flow', 1e-6 / 60],
  ['Pa·s', 'viscosity', 1], ['Pa s', 'viscosity', 1], ['mPa·s', 'viscosity', 1e-3], ['mPa s', 'viscosity', 1e-3], ['cP', 'viscosity', 1e-3], ['m²/s', 'kinvisc', 1], ['m^2/s', 'kinvisc', 1], ['cSt', 'kinvisc', 1e-6],
  ['m³', 'volume', 1], ['m^3', 'volume', 1], ['cm³', 'volume', 1e-6], ['cm^3', 'volume', 1e-6], ['cm3', 'volume', 1e-6], ['mL', 'volume', 1e-6], ['ml', 'volume', 1e-6], ['dL', 'volume', 1e-4], ['µL', 'volume', 1e-9], ['uL', 'volume', 1e-9], ['cc', 'volume', 1e-6], ['L', 'volume', 1e-3], ['l', 'volume', 1e-3],
  ['m²', 'area', 1], ['m^2', 'area', 1], ['cm²', 'area', 1e-4], ['cm^2', 'area', 1e-4], ['mm²', 'area', 1e-6], ['mm^2', 'area', 1e-6], ['km²', 'area', 1e6], ['km^2', 'area', 1e6], ['ft²', 'area', 0.09290304], ['ft^2', 'area', 0.09290304], ['in²', 'area', 6.4516e-4], ['in^2', 'area', 6.4516e-4],
  ['kN', 'force', 1000], ['MN', 'force', 1e6], ['mN', 'force', 1e-3], ['lbf', 'force', 4.4482216152605], ['N', 'force', 1],
  ['kWh', 'energy', 3.6e6], ['Wh', 'energy', 3600], ['kJ', 'energy', 1000], ['MJ', 'energy', 1e6], ['GJ', 'energy', 1e9], ['mJ', 'energy', 1e-3], ['GeV', 'energy', 1e9 * K.e], ['MeV', 'energy', 1e6 * K.e], ['keV', 'energy', 1e3 * K.e], ['kcal', 'energy', 4184], ['Cal', 'energy', 4184], ['cal', 'energy', 4.184], ['BTU', 'energy', 1055.05585], ['J', 'energy', 1],
  ['kVA', 'apparent', 1000], ['VA', 'apparent', 1], ['kvar', 'reactive', 1000], ['var', 'reactive', 1], ['VAR', 'reactive', 1],
  ['kW', 'power', 1000], ['MW', 'power', 1e6], ['GW', 'power', 1e9], ['mW', 'power', 1e-3], ['µW', 'power', 1e-6], ['uW', 'power', 1e-6], ['nW', 'power', 1e-9], ['hp', 'power', 745.69987158227], ['W', 'power', 1],
  ['GPa', 'pressure', 1e9], ['MPa', 'pressure', 1e6], ['kPa', 'pressure', 1000], ['hPa', 'pressure', 100], ['Pa', 'pressure', 1], ['mbar', 'pressure', 100], ['bar', 'pressure', 1e5], ['atm', 'pressure', K.atm], ['mmHg', 'pressure', 133.322387415], ['torr', 'pressure', 133.322368421], ['Torr', 'pressure', 133.322368421], ['psi', 'pressure', 6894.75729316836], ['ksi', 'pressure', 6894757.29316836],
  ['mC', 'charge', 1e-3], ['µC', 'charge', 1e-6], ['uC', 'charge', 1e-6], ['μC', 'charge', 1e-6], ['nC', 'charge', 1e-9], ['pC', 'charge', 1e-12], ['C', 'charge', 1],
  ['kV', 'voltage', 1000], ['mV', 'voltage', 1e-3], ['µV', 'voltage', 1e-6], ['V', 'voltage', 1],
  ['mA', 'current', 1e-3], ['µA', 'current', 1e-6], ['μA', 'current', 1e-6], ['uA', 'current', 1e-6], ['kA', 'current', 1000], ['A', 'current', 1],
  ['kΩ', 'resistance', 1000], ['MΩ', 'resistance', 1e6], ['mΩ', 'resistance', 1e-3], ['Ω', 'resistance', 1], ['Ω', 'resistance', 1], ['kohm', 'resistance', 1000], ['k ohm', 'resistance', 1000],
  ['mF', 'capacitance', 1e-3], ['µF', 'capacitance', 1e-6], ['μF', 'capacitance', 1e-6], ['uF', 'capacitance', 1e-6], ['nF', 'capacitance', 1e-9], ['pF', 'capacitance', 1e-12], ['F', 'capacitance', 1],
  ['mH', 'inductance', 1e-3], ['µH', 'inductance', 1e-6], ['μH', 'inductance', 1e-6], ['uH', 'inductance', 1e-6], ['H', 'inductance', 1],
  ['mT', 'field', 1e-3], ['µT', 'field', 1e-6], ['μT', 'field', 1e-6], ['uT', 'field', 1e-6], ['T', 'field', 1], ['G', 'field', 1e-4], ['Wb', 'flux', 1], ['mWb', 'flux', 1e-3],
  ['THz', 'frequency', 1e12], ['GHz', 'frequency', 1e9], ['MHz', 'frequency', 1e6], ['kHz', 'frequency', 1000], ['Hz', 'frequency', 1],
  ['mol', 'amount', 1], ['mmol', 'amount', 1e-3], ['kmol', 'amount', 1000],
  ['Tbps', 'rate', 1e12], ['Gbps', 'rate', 1e9], ['Mbps', 'rate', 1e6], ['kbps', 'rate', 1e3], ['Kbps', 'rate', 1e3], ['bps', 'rate', 1], ['Gbit/s', 'rate', 1e9], ['Mbit/s', 'rate', 1e6], ['kbit/s', 'rate', 1e3], ['Gb/s', 'rate', 1e9], ['Mb/s', 'rate', 1e6], ['kb/s', 'rate', 1e3],
  ['GB/s', 'rate', 8e9], ['MB/s', 'rate', 8e6], ['KB/s', 'rate', 8e3], ['kB/s', 'rate', 8e3], ['TB/s', 'rate', 8e12], ['GiB/s', 'rate', 8 * 2 ** 30], ['MiB/s', 'rate', 8 * 2 ** 20], ['KiB/s', 'rate', 8 * 2 ** 10],
  ['PB', 'data', 8e15], ['TB', 'data', 8e12], ['GB', 'data', 8e9], ['MB', 'data', 8e6], ['KB', 'data', 8e3], ['kB', 'data', 8e3], ['B', 'data', 8],
  ['PiB', 'data', 8 * 2 ** 50], ['TiB', 'data', 8 * 2 ** 40], ['GiB', 'data', 8 * 2 ** 30], ['MiB', 'data', 8 * 2 ** 20], ['KiB', 'data', 8 * 2 ** 10],
  ['Tb', 'data', 1e12], ['Gb', 'data', 1e9], ['Mb', 'data', 1e6], ['kb', 'data', 1e3], ['Kb', 'data', 1e3], ['Gbit', 'data', 1e9], ['Mbit', 'data', 1e6],
  ['km', 'length', 1000], ['cm', 'length', 0.01], ['mm', 'length', 1e-3], ['µm', 'length', 1e-6], ['μm', 'length', 1e-6], ['um', 'length', 1e-6], ['nm', 'length', 1e-9], ['pm', 'length', 1e-12], ['fm', 'length', 1e-15], ['Å', 'length', 1e-10], ['ft', 'length', 0.3048], ['mi', 'length', 1609.344], ['yd', 'length', 0.9144], ['AU', 'length', 1.495978707e11], ['au', 'length', 1.495978707e11], ['ly', 'length', 9.4607304725808e15], ['pc', 'length', 3.0856775814913673e16], ['kpc', 'length', 3.0856775814913673e19], ['Mpc', 'length', 3.0856775814913673e22], ['m', 'length', 1],
  ['ms', 'time', 1e-3], ['µs', 'time', 1e-6], ['μs', 'time', 1e-6], ['us', 'time', 1e-6], ['ns', 'time', 1e-9], ['min', 'time', 60], ['hrs', 'time', 3600], ['hr', 'time', 3600], ['h', 'time', 3600], ['yr', 'time', 31557600], ['yrs', 'time', 31557600], ['s', 'time', 1],
  ['kg', 'mass', 1], ['mg', 'mass', 1e-6], ['mcg', 'mass', 1e-9], ['µg', 'mass', 1e-9], ['μg', 'mass', 1e-9], ['ug', 'mass', 1e-9], ['g', 'mass', 1e-3], ['lbs', 'mass', 0.45359237], ['lb', 'mass', 0.45359237], ['oz', 'mass', 0.028349523125], ['u', 'mass', K.u], ['amu', 'mass', K.u], ['Da', 'mass', K.u],
  ['°', 'angle', 1], ['deg', 'angle', 1], ['rad', 'angle', 180 / Math.PI],
];

// Words, matched against the lowercased text.
const WORDS: U[] = [
  ['meters per second squared', 'accel', 1], ['metres per second squared', 'accel', 1],
  ['meters per second', 'velocity', 1], ['metres per second', 'velocity', 1], ['kilometers per hour', 'velocity', kmh], ['kilometres per hour', 'velocity', kmh], ['miles per hour', 'velocity', 0.44704], ['feet per second', 'velocity', 0.3048], ['knots', 'velocity', 1852 / 3600],
  ['radians per second', 'angvel', 1], ['revolutions per minute', 'angvel', (2 * Math.PI) / 60],
  ['newton meters', 'torque', 1], ['newton metres', 'torque', 1], ['newton-meters', 'torque', 1], ['newton-metres', 'torque', 1],
  ['newtons per meter', 'stiffness', 1], ['newtons per metre', 'stiffness', 1],
  ['cubic meters', 'volume', 1], ['cubic metres', 'volume', 1], ['liters', 'volume', 1e-3], ['litres', 'volume', 1e-3], ['liter', 'volume', 1e-3], ['litre', 'volume', 1e-3], ['milliliters', 'volume', 1e-6], ['millilitres', 'volume', 1e-6],
  ['square meters', 'area', 1], ['square metres', 'area', 1],
  ['kilonewtons', 'force', 1000], ['newtons', 'force', 1], ['newton', 'force', 1],
  ['kilojoules', 'energy', 1000], ['joules', 'energy', 1], ['joule', 'energy', 1], ['electron volts', 'energy', K.e], ['electronvolts', 'energy', K.e], ['calories', 'energy', 4.184], ['kilocalories', 'energy', 4184],
  ['kilowatts', 'power', 1000], ['megawatts', 'power', 1e6], ['watts', 'power', 1], ['watt', 'power', 1], ['horsepower', 'power', 745.69987158227],
  ['kilopascals', 'pressure', 1000], ['pascals', 'pressure', 1], ['atmospheres', 'pressure', K.atm], ['atmosphere', 'pressure', K.atm],
  ['coulombs', 'charge', 1], ['coulomb', 'charge', 1], ['microcoulombs', 'charge', 1e-6], ['nanocoulombs', 'charge', 1e-9],
  ['kilovolts', 'voltage', 1000], ['volts', 'voltage', 1], ['volt', 'voltage', 1],
  ['milliamps', 'current', 1e-3], ['milliamperes', 'current', 1e-3], ['amperes', 'current', 1], ['ampere', 'current', 1], ['amps', 'current', 1], ['amp', 'current', 1],
  ['kilohms', 'resistance', 1000], ['kiloohms', 'resistance', 1000], ['megohms', 'resistance', 1e6], ['ohms', 'resistance', 1], ['ohm', 'resistance', 1],
  ['microfarads', 'capacitance', 1e-6], ['microfarad', 'capacitance', 1e-6], ['nanofarads', 'capacitance', 1e-9], ['picofarads', 'capacitance', 1e-12], ['farads', 'capacitance', 1], ['farad', 'capacitance', 1],
  ['millihenries', 'inductance', 1e-3], ['millihenry', 'inductance', 1e-3], ['henries', 'inductance', 1], ['henrys', 'inductance', 1], ['henry', 'inductance', 1],
  ['tesla', 'field', 1], ['teslas', 'field', 1], ['gauss', 'field', 1e-4], ['webers', 'flux', 1], ['weber', 'flux', 1],
  ['megahertz', 'frequency', 1e6], ['kilohertz', 'frequency', 1000], ['hertz', 'frequency', 1],
  ['moles', 'amount', 1], ['mole', 'amount', 1], ['mols', 'amount', 1],
  ['terabytes', 'data', 8e12], ['gigabytes', 'data', 8e9], ['megabytes', 'data', 8e6], ['kilobytes', 'data', 8e3], ['bytes', 'data', 8], ['byte', 'data', 8], ['bits', 'data', 1], ['bit', 'data', 1],
  ['gibibytes', 'data', 8 * 2 ** 30], ['mebibytes', 'data', 8 * 2 ** 20], ['kibibytes', 'data', 8 * 2 ** 10], ['tebibytes', 'data', 8 * 2 ** 40],
  ['kilometers', 'length', 1000], ['kilometres', 'length', 1000], ['centimeters', 'length', 0.01], ['centimetres', 'length', 0.01], ['millimeters', 'length', 1e-3], ['millimetres', 'length', 1e-3], ['nanometers', 'length', 1e-9], ['nanometres', 'length', 1e-9], ['meters', 'length', 1], ['metres', 'length', 1], ['meter', 'length', 1], ['metre', 'length', 1], ['feet', 'length', 0.3048], ['foot', 'length', 0.3048], ['inches', 'length', 0.0254], ['inch', 'length', 0.0254], ['miles', 'length', 1609.344], ['mile', 'length', 1609.344], ['light years', 'length', 9.4607304725808e15], ['light-years', 'length', 9.4607304725808e15], ['parsecs', 'length', 3.0856775814913673e16], ['megaparsecs', 'length', 3.0856775814913673e22],
  ['milliseconds', 'time', 1e-3], ['seconds', 'time', 1], ['second', 'time', 1], ['secs', 'time', 1], ['sec', 'time', 1], ['minutes', 'time', 60], ['minute', 'time', 60], ['mins', 'time', 60], ['hours', 'time', 3600], ['hour', 'time', 3600], ['days', 'time', 86400], ['day', 'time', 86400], ['weeks', 'time', 604800], ['years', 'time', 31557600], ['year', 'time', 31557600],
  ['kilograms', 'mass', 1], ['kilogram', 'mass', 1], ['kilos', 'mass', 1], ['grams', 'mass', 1e-3], ['gram', 'mass', 1e-3], ['milligrams', 'mass', 1e-6], ['micrograms', 'mass', 1e-9], ['tonnes', 'mass', 1000], ['tonne', 'mass', 1000], ['pounds', 'mass', 0.45359237], ['pound', 'mass', 0.45359237],
  ['degrees', 'angle', 1], ['degree', 'angle', 1], ['radians', 'angle', 180 / Math.PI],
];

const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const alt = (list: U[]) => [...list].sort((a, b) => b[0].length - a[0].length).map((u) => esc(u[0])).join('|');
const SYM_RE = new RegExp(String.raw`(?<![\w.])(${SNUM})\s*(${alt(SYMBOLS)})(?![A-Za-z0-9²³⁴^_])`, 'g');
const WORD_RE = new RegExp(String.raw`(?<![\w.])(${SNUM})\s*(${alt(WORDS)})(?![a-z])`, 'g');
const SYM_MAP = new Map(SYMBOLS.map((u) => [u[0], u]));
const WORD_MAP = new Map(WORDS.map((u) => [u[0], u]));

const qCache = new WeakMap<Ctx, Qty[]>();
/** Every "number + unit" in the sentence, in SI. Overlaps resolve to the earliest, longest match. */
export function quantities(c: Ctx): Qty[] {
  const hit = qCache.get(c);
  if (hit) return hit;
  const found: Qty[] = [];
  const add = (m: RegExpMatchArray, u: U | undefined) => {
    if (!u) return;
    found.push({ dim: u[1], v: num(m[1]!) * u[2], raw: m[0], unit: m[2]!, index: m.index!, end: m.index! + m[0].length });
  };
  for (const m of c.t.matchAll(SYM_RE)) add(m, SYM_MAP.get(m[2]!));
  for (const m of c.s.matchAll(WORD_RE)) add(m, WORD_MAP.get(m[2]!));
  found.sort((a, b) => a.index - b.index || b.end - a.end);
  const out: Qty[] = [];
  for (const q of found) if (!out.some((o) => q.index < o.end && o.index < q.end)) out.push(q);
  qCache.set(c, out);
  return out;
}

export const ofDim = (c: Ctx, ...dims: Dim[]) => quantities(c).filter((q) => dims.includes(q.dim));

/** Temperatures in kelvin: "300 K", "25 °C", "25 C", "77 F". */
export function temperatures(c: Ctx): { k: number; raw: string; index: number; delta: boolean }[] {
  const re = new RegExp(String.raw`(?<![\w.])(${SNUM})\s*(°\s?c|º\s?c|degrees? c(?:elsius)?|celsius|c|°\s?f|degrees? f(?:ahrenheit)?|fahrenheit|f|k|kelvin)(?![a-z])`, 'g');
  const out: { k: number; raw: string; index: number; delta: boolean }[] = [];
  for (const m of c.s.matchAll(re)) {
    const x = num(m[1]!);
    const u = m[2]!;
    const k = /f/.test(u) ? ((x - 32) * 5) / 9 + 273.15 : /c/.test(u) ? x + 273.15 : x;
    const before = c.s.slice(Math.max(0, m.index! - 14), m.index!);
    out.push({ k, raw: m[0], index: m.index!, delta: /(?:Δt|delta t|by|change(?: of)?|rise(?: of)?|increase(?: of)?|raise[sd]?|warm(?:ed)?|heat(?:ed)?|cool(?:ed)?)\s*(?:=|of)?\s*$/.test(before) });
  }
  return out;
}

/**
 * A value labelled by name: "Ka 1.8e-5", "u = 0", "mass of 2 kg", "R1: 1k". Units, when present, are converted
 * (and must match `dim`); a bare number is taken as already in SI units (or multiplied by `bare`).
 */
export function named(c: Ctx, names: string, dim?: Dim | Dim[], bare = 1): number | null {
  const re = new RegExp(String.raw`(?<![\w])(?:${names})(?![\w])\s*(?:\([^)]{0,12}\)\s*)?(?:=|:|is|of|was|at|to)?\s*(?:about\s+|approximately\s+|~\s*)?(${SNUM})`, 'gi');
  for (const m of c.t.matchAll(re)) {
    const start = m.index! + m[0].length - m[1]!.length;
    const q = quantities(c).find((x) => x.index === start);
    const dims = dim === undefined ? [] : Array.isArray(dim) ? dim : [dim];
    if (q) {
      if (!dims.length || dims.includes(q.dim)) return q.v;
      continue;
    }
    return num(m[1]!) * bare;
  }
  return null;
}

/** All plain numbers in a string (no unit handling). */
export function numbers(text: string): number[] {
  return [...text.matchAll(new RegExp(String.raw`(?<![\w.])${SNUM}(?![\w])`, 'g'))].map((m) => num(m[0]));
}

/** A percentage or fraction: "90%" → 0.9, "0.9" → 0.9. */
export function frac(raw: string): number {
  const t = raw.trim();
  return t.endsWith('%') ? num(t.slice(0, -1)) / 100 : num(t);
}
/** "sensitivity 90%" / "sensitivity = 0.9" → 0.9. */
export function namedFrac(c: Ctx, names: string): number | null {
  const re = new RegExp(String.raw`(?<![\w])(?:${names})(?![\w])\s*(?:\([^)]{0,12}\)\s*)?(?:=|:|is|of|was)?\s*(${NUM})\s*(%|percent)?`, 'i');
  const m = re.exec(c.t);
  if (!m) return null;
  const x = num(m[1]!);
  return m[2] || x > 1 ? x / 100 : x;
}

export const has = (c: Ctx, re: RegExp) => re.test(c.s);
export const deg = (x: number) => (x * Math.PI) / 180;
export const todeg = (x: number) => (x * 180) / Math.PI;

/** Pretty duration for seconds: "2 min 40 s", "7.79 days". */
export function duration(s: number): string {
  if (!Number.isFinite(s)) return String(s);
  if (s < 60) return `${show(s)} s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    return r < 0.05 ? `${m} min` : `${m} min ${show(r, 3)} s`;
  }
  if (s < 86400) return `${show(s / 3600)} h`;
  if (s < 86400 * 365.25 * 2) return `${show(s / 86400)} days`;
  return `${show(s / 31557600)} years`;
}

/** Bytes in decimal and binary units. */
export function bytesText(bytes: number): string {
  const dec = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
  const bin = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB'];
  let i = 0;
  while (i < dec.length - 1 && Math.abs(bytes) >= 1000 ** (i + 1)) i++;
  let j = 0;
  while (j < bin.length - 1 && Math.abs(bytes) >= 1024 ** (j + 1)) j++;
  return `${show(bytes / 1000 ** i)} ${dec[i]} (${show(bytes / 1024 ** j)} ${bin[j]})`;
}

/** The quantity of one of `dims` whose preceding words (since the previous quantity) match `label`. */
export function lab(c: Ctx, dims: Dim | Dim[], label: RegExp, exclude: Qty[] = []): Qty | undefined {
  const ds = Array.isArray(dims) ? dims : [dims];
  const qs = quantities(c);
  for (let i = 0; i < qs.length; i++) {
    const q = qs[i]!;
    if (!ds.includes(q.dim) || exclude.includes(q)) continue;
    const prevEnd = i > 0 ? qs[i - 1]!.end : 0;
    const win = c.s.slice(Math.max(prevEnd, q.index - 48), q.index);
    if (label.test(win)) return q;
  }
  return undefined;
}

/** g: the user's value if given ("g = 9.8"), else 9.81 m/s² with a note. */
export function gravity(c: Ctx, notes: string[]): number {
  const g = named(c, 'g', 'accel');
  if (g !== null && g > 0 && g < 100) return g;
  notes.push('g = 9.81 m/s² (assumed; say "g = 9.8" to change it)');
  return 9.81;
}
