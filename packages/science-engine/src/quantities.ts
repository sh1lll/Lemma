import { D, type Dec } from '@lemma/math-core';
import { NUM, num, type Ctx } from './util';

export type Dim =
  | 'mass' | 'length' | 'time' | 'velocity' | 'accel' | 'force' | 'energy' | 'power' | 'voltage' | 'current'
  | 'resistance' | 'frequency' | 'density' | 'volume' | 'momentum' | 'angle';

export interface Qty {
  dim: Dim;
  /** Value in SI units (degrees for angles). */
  si: Dec;
  raw: string;
  index: number;
  end: number;
}

type U = [string, Dim, number | string];

// Case-sensitive symbols, matched against the original text.
const SYMBOLS: U[] = [
  ['m/s²', 'accel', 1], ['m/s^2', 'accel', 1], ['m/s2', 'accel', 1], ['m/s/s', 'accel', 1], ['m s^-2', 'accel', 1], ['ms^-2', 'accel', 1], ['m s-2', 'accel', 1], ['ms-2', 'accel', 1], ['ft/s²', 'accel', 0.3048], ['ft/s^2', 'accel', 0.3048],
  ['m/s', 'velocity', 1], ['km/h', 'velocity', '0.27777777777777777777777777777777777777777777777778'], ['km/hr', 'velocity', '0.27777777777777777777777777777777777777777777777778'], ['kmh', 'velocity', '0.27777777777777777777777777777777777777777777777778'], ['kph', 'velocity', '0.27777777777777777777777777777777777777777777777778'], ['mph', 'velocity', 0.44704], ['ft/s', 'velocity', 0.3048], ['m s^-1', 'velocity', 1], ['ms^-1', 'velocity', 1], ['m s-1', 'velocity', 1], ['knots', 'velocity', '0.51444444444444444444444444444444444444444444444444'],
  ['kg·m/s', 'momentum', 1], ['kg m/s', 'momentum', 1], ['kg*m/s', 'momentum', 1], ['kgm/s', 'momentum', 1], ['kg⋅m/s', 'momentum', 1], ['N·s', 'momentum', 1], ['N s', 'momentum', 1], ['Ns', 'momentum', 1],
  ['kg/m³', 'density', 1], ['kg/m^3', 'density', 1], ['kg/m3', 'density', 1], ['g/cm³', 'density', 1000], ['g/cm^3', 'density', 1000], ['g/cm3', 'density', 1000], ['g/mL', 'density', 1000], ['g/ml', 'density', 1000], ['kg/L', 'density', 1000], ['g/L', 'density', 1],
  ['m³', 'volume', 1], ['m^3', 'volume', 1], ['m3', 'volume', 1], ['cm³', 'volume', 1e-6], ['cm^3', 'volume', 1e-6], ['cm3', 'volume', 1e-6], ['mL', 'volume', 1e-6], ['ml', 'volume', 1e-6], ['L', 'volume', 1e-3],
  ['kN', 'force', 1000], ['MN', 'force', 1e6], ['N', 'force', 1],
  ['kWh', 'energy', 3.6e6], ['kJ', 'energy', 1000], ['MJ', 'energy', 1e6], ['GJ', 'energy', 1e9], ['mJ', 'energy', 1e-3], ['MeV', 'energy', '1.602176634e-13'], ['keV', 'energy', '1.602176634e-16'], ['eV', 'energy', '1.602176634e-19'], ['kcal', 'energy', 4184], ['cal', 'energy', 4.184], ['J', 'energy', 1],
  ['kW', 'power', 1000], ['MW', 'power', 1e6], ['GW', 'power', 1e9], ['mW', 'power', 1e-3], ['hp', 'power', 745.69987158227022], ['W', 'power', 1],
  ['kV', 'voltage', 1000], ['mV', 'voltage', 1e-3], ['V', 'voltage', 1],
  ['mA', 'current', 1e-3], ['µA', 'current', 1e-6], ['uA', 'current', 1e-6], ['kA', 'current', 1000], ['A', 'current', 1],
  ['kΩ', 'resistance', 1000], ['MΩ', 'resistance', 1e6], ['mΩ', 'resistance', 1e-3], ['Ω', 'resistance', 1],
  ['THz', 'frequency', 1e12], ['GHz', 'frequency', 1e9], ['MHz', 'frequency', 1e6], ['kHz', 'frequency', 1000], ['Hz', 'frequency', 1],
  ['kg', 'mass', 1], ['mg', 'mass', 1e-6], ['g', 'mass', 1e-3], ['lbs', 'mass', 0.45359237], ['lb', 'mass', 0.45359237],
  ['km', 'length', 1000], ['cm', 'length', 0.01], ['mm', 'length', 0.001], ['µm', 'length', 1e-6], ['um', 'length', 1e-6], ['nm', 'length', 1e-9], ['ft', 'length', 0.3048], ['mi', 'length', 1609.344], ['m', 'length', 1],
  ['ms', 'time', 0.001], ['min', 'time', 60], ['hrs', 'time', 3600], ['hr', 'time', 3600], ['h', 'time', 3600], ['s', 'time', 1],
  ['°', 'angle', 1], ['deg', 'angle', 1],
];

// Words, matched case-insensitively against the lowercased text.
const WORDS: U[] = [
  ['meters per second squared', 'accel', 1], ['metres per second squared', 'accel', 1], ['meters per second per second', 'accel', 1],
  ['meters per second', 'velocity', 1], ['metres per second', 'velocity', 1], ['kilometers per hour', 'velocity', '0.27777777777777777777777777777777777777777777777778'], ['kilometres per hour', 'velocity', '0.27777777777777777777777777777777777777777777777778'], ['km per hour', 'velocity', '0.27777777777777777777777777777777777777777777777778'], ['miles per hour', 'velocity', 0.44704], ['feet per second', 'velocity', 0.3048],
  ['newton seconds', 'momentum', 1], ['newton-seconds', 'momentum', 1],
  ['kilograms per cubic meter', 'density', 1], ['kilograms per cubic metre', 'density', 1], ['grams per cubic centimeter', 'density', 1000], ['grams per cubic centimetre', 'density', 1000], ['grams per milliliter', 'density', 1000], ['grams per millilitre', 'density', 1000],
  ['cubic meters', 'volume', 1], ['cubic metres', 'volume', 1], ['cubic meter', 'volume', 1], ['cubic metre', 'volume', 1], ['cubic centimeters', 'volume', 1e-6], ['cubic centimetres', 'volume', 1e-6], ['liters', 'volume', 1e-3], ['litres', 'volume', 1e-3], ['liter', 'volume', 1e-3], ['litre', 'volume', 1e-3], ['milliliters', 'volume', 1e-6], ['millilitres', 'volume', 1e-6],
  ['kilonewtons', 'force', 1000], ['kilonewton', 'force', 1000], ['newtons', 'force', 1], ['newton', 'force', 1],
  ['kilowatt hours', 'energy', 3.6e6], ['kilowatt-hours', 'energy', 3.6e6], ['kilojoules', 'energy', 1000], ['kilojoule', 'energy', 1000], ['megajoules', 'energy', 1e6], ['joules', 'energy', 1], ['joule', 'energy', 1], ['electron volts', 'energy', '1.602176634e-19'], ['electronvolts', 'energy', '1.602176634e-19'], ['calories', 'energy', 4.184], ['kilocalories', 'energy', 4184],
  ['kilowatts', 'power', 1000], ['kilowatt', 'power', 1000], ['megawatts', 'power', 1e6], ['milliwatts', 'power', 1e-3], ['watts', 'power', 1], ['watt', 'power', 1], ['horsepower', 'power', 745.69987158227022],
  ['kilovolts', 'voltage', 1000], ['millivolts', 'voltage', 1e-3], ['volts', 'voltage', 1], ['volt', 'voltage', 1],
  ['milliamps', 'current', 1e-3], ['milliamperes', 'current', 1e-3], ['milliamp', 'current', 1e-3], ['amperes', 'current', 1], ['ampere', 'current', 1], ['amps', 'current', 1], ['amp', 'current', 1],
  ['kilohms', 'resistance', 1000], ['kiloohms', 'resistance', 1000], ['kilohm', 'resistance', 1000], ['megohms', 'resistance', 1e6], ['megaohms', 'resistance', 1e6], ['ohms', 'resistance', 1], ['ohm', 'resistance', 1],
  ['terahertz', 'frequency', 1e12], ['gigahertz', 'frequency', 1e9], ['megahertz', 'frequency', 1e6], ['kilohertz', 'frequency', 1000], ['hertz', 'frequency', 1],
  ['kilograms', 'mass', 1], ['kilogram', 'mass', 1], ['kilos', 'mass', 1], ['kilo', 'mass', 1], ['grams', 'mass', 1e-3], ['gram', 'mass', 1e-3], ['milligrams', 'mass', 1e-6], ['tonnes', 'mass', 1000], ['tonne', 'mass', 1000], ['pounds', 'mass', 0.45359237], ['pound', 'mass', 0.45359237],
  ['kilometers', 'length', 1000], ['kilometres', 'length', 1000], ['kilometer', 'length', 1000], ['kilometre', 'length', 1000], ['centimeters', 'length', 0.01], ['centimetres', 'length', 0.01], ['millimeters', 'length', 0.001], ['millimetres', 'length', 0.001], ['nanometers', 'length', 1e-9], ['nanometres', 'length', 1e-9], ['meters', 'length', 1], ['metres', 'length', 1], ['meter', 'length', 1], ['metre', 'length', 1], ['feet', 'length', 0.3048], ['foot', 'length', 0.3048], ['miles', 'length', 1609.344], ['mile', 'length', 1609.344],
  ['milliseconds', 'time', 0.001], ['seconds', 'time', 1], ['second', 'time', 1], ['secs', 'time', 1], ['sec', 'time', 1], ['minutes', 'time', 60], ['minute', 'time', 60], ['mins', 'time', 60], ['hours', 'time', 3600], ['hour', 'time', 3600],
  ['degrees', 'angle', 1], ['degree', 'angle', 1],
];

const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const alt = (list: U[]) => [...list].sort((a, b) => b[0].length - a[0].length).map((u) => esc(u[0])).join('|');
const SYM_RE = new RegExp(String.raw`(?<![\w.])([-+]?${NUM})\s*(${alt(SYMBOLS)})(?![A-Za-z0-9²³^])(?!\s*=)`, 'g');
const WORD_RE = new RegExp(String.raw`(?<![\w.])([-+]?${NUM})\s*(${alt(WORDS)})(?![a-z])(?!\s*=)`, 'g');
const SYM_MAP = new Map(SYMBOLS.map((u) => [u[0], u]));
const WORD_MAP = new Map(WORDS.map((u) => [u[0], u]));

/** Every "number + unit" in the sentence, converted to SI. Overlaps resolve to the longest match. */
export function quantities(c: Ctx): Qty[] {
  const found: Qty[] = [];
  const add = (m: RegExpMatchArray, u: U | undefined) => {
    if (!u) return;
    found.push({ dim: u[1], si: num(m[1]!).mul(new D(u[2])), raw: m[0], index: m.index!, end: m.index! + m[0].length });
  };
  for (const m of c.t.matchAll(SYM_RE)) add(m, SYM_MAP.get(m[2]!));
  for (const m of c.s.matchAll(WORD_RE)) add(m, WORD_MAP.get(m[2]!));
  found.sort((a, b) => a.index - b.index || b.end - a.end);
  const out: Qty[] = [];
  for (const q of found) if (!out.some((o) => q.index < o.end && o.index < q.end)) out.push(q);
  return out;
}

/** Unit used in answers, per dimension. */
export const SI: Record<Dim, [string, string]> = {
  mass: ['kg', 'kilograms'], length: ['m', 'metres'], time: ['s', 'seconds'], velocity: ['m/s', 'metres per second'], accel: ['m/s²', 'metres per second squared'],
  force: ['N', 'newtons'], energy: ['J', 'joules'], power: ['W', 'watts'], voltage: ['V', 'volts'], current: ['A', 'amps'], resistance: ['Ω', 'ohms'],
  frequency: ['Hz', 'hertz'], density: ['kg/m³', 'kilograms per cubic metre'], volume: ['m³', 'cubic metres'], momentum: ['kg·m/s', 'kilogram metres per second'], angle: ['°', 'degrees'],
};

/** Finds the unit dimension of a bare unit word/symbol (used to validate "m = 5 kg"). */
export function unitDim(u: string): [Dim, Dec] | null {
  const hit = SYM_MAP.get(u) ?? WORD_MAP.get(u.toLowerCase());
  return hit ? [hit[1], new D(hit[2])] : null;
}
