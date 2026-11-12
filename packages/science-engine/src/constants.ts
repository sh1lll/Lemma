import { D, formatNumber, MathError, type Dec } from '@lemma/math-core';
import { asCompound, findUnits, inverseDims, parseCompound, sameDims, type CompoundUnit } from '@lemma/unit-engine';
import { ok, PI, type Ctx } from './util';

export interface PhysConst {
  key: string;
  symbol: string;
  name: string;
  value: Dec;
  unit: string;
  spokenUnit: string;
  /** Standard uncertainty in the same unit; null when the value is exact by SI definition. */
  uncertainty: string | null;
  /** True for exact values that are shown truncated (derived from exact constants, irrational/long). */
  truncated?: boolean;
  /** Whole-phrase aliases (lowercase) … */
  names: string[];
  /** … and case-sensitive symbols accepted after "what is" / "value of". */
  symbols: string[];
}

const h = new D('6.62607015e-34');
const e = new D('1.602176634e-19');
const NA = new D('6.02214076e23');
const k = new D('1.380649e-23');
const c = new D('299792458');

// CODATA 2018 recommended values. Exact constants are those fixed by the 2019 SI redefinition (or derived only from them).
export const CONSTANTS: PhysConst[] = [
  { key: 'c', symbol: 'c', name: 'Speed of light in vacuum', value: c, unit: 'm/s', spokenUnit: 'metres per second', uncertainty: null, names: ['speed of light', 'speed of light in vacuum', 'speed of light in a vacuum', 'light speed', 'velocity of light'], symbols: ['c'] },
  { key: 'h', symbol: 'h', name: 'Planck constant', value: h, unit: 'J·s', spokenUnit: 'joule seconds', uncertainty: null, names: ['planck constant', "planck's constant", 'plancks constant', 'planck'], symbols: ['h'] },
  { key: 'hbar', symbol: 'ħ', name: 'Reduced Planck constant', value: h.div(PI.mul(2)), unit: 'J·s', spokenUnit: 'joule seconds', uncertainty: null, truncated: true, names: ['reduced planck constant', "reduced planck's constant", 'h bar', 'hbar', 'dirac constant'], symbols: ['ħ', 'hbar'] },
  { key: 'e', symbol: 'e', name: 'Elementary charge', value: e, unit: 'C', spokenUnit: 'coulombs', uncertainty: null, names: ['elementary charge', 'charge of an electron', 'charge of electron', 'electron charge', 'charge on an electron', 'charge of a proton', 'proton charge'], symbols: [] },
  { key: 'NA', symbol: 'N_A', name: 'Avogadro constant', value: NA, unit: 'mol⁻¹', spokenUnit: 'per mole', uncertainty: null, names: ['avogadro constant', "avogadro's constant", 'avogadros constant', "avogadro's number", 'avogadro number', 'avogadros number', 'avogadro'], symbols: ['N_A', 'NA'] },
  { key: 'kB', symbol: 'k_B', name: 'Boltzmann constant', value: k, unit: 'J/K', spokenUnit: 'joules per kelvin', uncertainty: null, names: ['boltzmann constant', "boltzmann's constant", 'boltzmann'], symbols: ['k_B', 'kB', 'k'] },
  { key: 'R', symbol: 'R', name: 'Molar gas constant', value: NA.mul(k), unit: 'J/(mol·K)', spokenUnit: 'joules per mole kelvin', uncertainty: null, names: ['gas constant', 'ideal gas constant', 'molar gas constant', 'universal gas constant'], symbols: ['R'] },
  { key: 'G', symbol: 'G', name: 'Newtonian constant of gravitation', value: new D('6.67430e-11'), unit: 'm³/(kg·s²)', spokenUnit: 'cubic metres per kilogram second squared', uncertainty: '0.00015e-11', names: ['gravitational constant', 'newtonian constant of gravitation', 'universal gravitational constant', 'newton gravitational constant', 'constant of gravitation', 'big g'], symbols: ['G'] },
  { key: 'g0', symbol: 'g₀', name: 'Standard acceleration of gravity', value: new D('9.80665'), unit: 'm/s²', spokenUnit: 'metres per second squared', uncertainty: null, names: ['standard gravity', 'standard acceleration of gravity', 'acceleration due to gravity', 'acceleration of gravity', 'gravitational acceleration', 'gravity', 'little g'], symbols: ['g', 'g0', 'g₀'] },
  { key: 'me', symbol: 'mₑ', name: 'Electron mass', value: new D('9.1093837015e-31'), unit: 'kg', spokenUnit: 'kilograms', uncertainty: '0.0000000028e-31', names: ['electron mass', 'mass of an electron', 'mass of electron', 'mass of the electron', 'electron rest mass'], symbols: ['m_e', 'me'] },
  { key: 'mp', symbol: 'mₚ', name: 'Proton mass', value: new D('1.67262192369e-27'), unit: 'kg', spokenUnit: 'kilograms', uncertainty: '0.00000000051e-27', names: ['proton mass', 'mass of a proton', 'mass of proton', 'mass of the proton', 'proton rest mass'], symbols: ['m_p', 'mp'] },
  { key: 'mn', symbol: 'mₙ', name: 'Neutron mass', value: new D('1.67492749804e-27'), unit: 'kg', spokenUnit: 'kilograms', uncertainty: '0.00000000095e-27', names: ['neutron mass', 'mass of a neutron', 'mass of neutron', 'mass of the neutron', 'neutron rest mass'], symbols: ['m_n', 'mn'] },
  { key: 'eps0', symbol: 'ε₀', name: 'Vacuum electric permittivity', value: new D('8.8541878128e-12'), unit: 'F/m', spokenUnit: 'farads per metre', uncertainty: '0.0000000013e-12', names: ['vacuum permittivity', 'vacuum electric permittivity', 'permittivity of free space', 'permittivity of vacuum', 'electric constant', 'epsilon naught', 'epsilon zero', 'epsilon 0'], symbols: ['ε₀', 'ε0', 'eps0', 'epsilon0'] },
  { key: 'mu0', symbol: 'μ₀', name: 'Vacuum magnetic permeability', value: new D('1.25663706212e-6'), unit: 'N/A²', spokenUnit: 'newtons per ampere squared', uncertainty: '0.00000000019e-6', names: ['vacuum permeability', 'vacuum magnetic permeability', 'permeability of free space', 'permeability of vacuum', 'magnetic constant', 'mu naught', 'mu zero', 'mu 0'], symbols: ['μ₀', 'μ0', 'µ0', 'mu0'] },
  { key: 'sigma', symbol: 'σ', name: 'Stefan–Boltzmann constant', value: new D('5.670374419e-8'), unit: 'W/(m²·K⁴)', spokenUnit: 'watts per square metre kelvin to the fourth', uncertainty: null, truncated: true, names: ['stefan-boltzmann constant', 'stefan boltzmann constant', 'stefan–boltzmann constant', 'stefan constant'], symbols: ['σ'] },
  { key: 'atm', symbol: 'atm', name: 'Standard atmosphere', value: new D(101325), unit: 'Pa', spokenUnit: 'pascals', uncertainty: null, names: ['standard atmosphere', 'standard atmospheric pressure', 'atmospheric pressure', 'one atmosphere', 'standard pressure'], symbols: [] },
  { key: 'F', symbol: 'F', name: 'Faraday constant', value: NA.mul(e), unit: 'C/mol', spokenUnit: 'coulombs per mole', uncertainty: null, truncated: true, names: ['faraday constant', "faraday's constant", 'faradays constant', 'faraday'], symbols: [] },
  { key: 'Rinf', symbol: 'R∞', name: 'Rydberg constant', value: new D('10973731.568160'), unit: 'm⁻¹', spokenUnit: 'per metre', uncertainty: '0.000021', names: ['rydberg constant', "rydberg's constant", 'rydberg'], symbols: ['R∞', 'R_inf'] },
];

export const CONST = Object.fromEntries(CONSTANTS.map((k) => [k.key, k.value])) as Record<'c' | 'h' | 'hbar' | 'e' | 'NA' | 'kB' | 'R' | 'G' | 'g0' | 'me' | 'mp' | 'mn' | 'eps0' | 'mu0' | 'sigma' | 'atm' | 'F' | 'Rinf', Dec>;

export const CONSTANT_NAMES_SRC = CONSTANTS.flatMap((k) => k.names)
  .sort((a, b) => b.length - a.length)
  .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

/** "speed of light", "what is the planck constant", "value of G". */
export function constantLookup(c: Ctx) {
  const prefix = /^(?:(?:what(?:'s| is| are)|whats|tell me|give me|show|show me|value of|the value of|define)\s+)*(?:the\s+)?(?:value of\s+)?(?:the\s+)?/;
  const sp = prefix.exec(c.s)![0].length;
  const restLower = c.s.slice(sp).replace(/\s+(?:value|constant value)$/, '').trim();
  const restExact = c.t.slice(sp).trim();
  let k = CONSTANTS.find((x) => x.names.includes(restLower));
  // Bare symbols only count when asked for ("what is c", "value of G"); "e" alone is Euler's number.
  if (!k && sp > 0) k = CONSTANTS.find((x) => x.symbols.includes(restExact));
  if (!k) return inOtherUnits(c, sp);
  // Exact-but-endless values are truncated (not rounded) to 10 digits, as CODATA prints them.
  const f = formatNumber(k.truncated ? k.value.toSignificantDigits(10, D.ROUND_DOWN) : k.value, { digits: 15 });
  if (k.truncated) f.display = f.display.includes(' × ') ? f.display.replace(' × ', '… × ') : `${f.display}…`;
  const notes = ['CODATA 2018 recommended value'];
  if (k.uncertainty === null) notes.push(k.truncated ? 'Exact (derived from SI-defined constants); shown to 10 significant digits' : 'Exact by definition of the SI (no uncertainty)');
  else notes.push(`Standard uncertainty ${formatNumber(new D(k.uncertainty)).display} ${k.unit} (relative ${formatNumber(new D(k.uncertainty).div(k.value), { digits: 2 }).display})`);
  return ok(c, {
    kind: 'physics',
    expression: `${k.name} (${k.symbol})`,
    primary: { display: f.display, plain: f.plain, spoken: `${f.spoken} ${k.spokenUnit}`, unit: k.unit },
    value: k.value,
    lines: [
      { label: 'Symbol', display: k.symbol },
      { label: 'Unit', display: k.unit },
      { label: 'Uncertainty', display: k.uncertainty === null ? 'exact' : `${formatNumber(new D(k.uncertainty)).display} ${k.unit}` },
    ],
    notes,
  });
}

/** The unit to convert a constant into: a registry unit ("km/h", "electronvolts") or a derived one ("ft/s^2", "eV s"). */
function targetUnit(text: string): CompoundUnit | null {
  const t = text.trim().replace(/^(?:an?|the)\s+/, '');
  for (const u of findUnits(t)) {
    const cu = asCompound(u);
    if (cu) return cu;
  }
  return parseCompound(t);
}

/** Splits on the last connector first, so names containing "in" ("speed of light in vacuum") stay whole. */
const CONNECTOR = /\s(?:in terms of|into|in|to|as)\s/g;

/** "speed of light in km/h", "g in ft/s^2", "planck constant in eV s". */
function inOtherUnits(c: Ctx, sp: number) {
  const lower = c.s.slice(sp);
  const exact = c.t.slice(sp);
  for (const m of [...lower.matchAll(CONNECTOR)].reverse()) {
    const leftLower = lower.slice(0, m.index).trim().replace(/\s+(?:value|constant value)$/, '');
    const leftExact = exact.slice(0, m.index).trim();
    // A bare symbol ("c", "g", "h") is only a constant when the target unit fits it; otherwise it's a unit ("c to f").
    const k = CONSTANTS.find((x) => x.names.includes(leftLower)) ?? CONSTANTS.find((x) => x.symbols.includes(leftExact));
    if (!k) continue;
    const from = parseCompound(k.unit);
    const to = targetUnit(lower.slice(m.index! + m[0].length));
    if (!from || !to) continue;
    const inverse = inverseDims(from.dims, to.dims);
    if (!sameDims(from.dims, to.dims) && !inverse) {
      // Only a named constant is worth explaining; a bare symbol may be something else entirely.
      if (k.names.includes(leftLower)) {
        return { ok: false as const, kind: 'physics' as const, input: c.input, error: new MathError('domain', `${k.name} is in ${k.unit}, which can't be expressed in ${to.symbol}`) };
      }
      continue;
    }
    if (inverse) continue; // no constant is usefully read as its reciprocal
    const exactResult = k.uncertainty === null && !k.truncated;
    let value = k.value.mul(from.factor).div(to.factor);
    const terminates = value.toSignificantDigits(15).eq(value);
    if (!terminates) value = value.toSignificantDigits(12);
    const f = formatNumber(value, { digits: 15 });
    const si = formatNumber(k.truncated ? k.value.toSignificantDigits(10, D.ROUND_DOWN) : k.value, { digits: 15 }).display;
    const notes = [`Converted from the CODATA 2018 value ${si} ${k.unit}`];
    if (exactResult && terminates) notes.push('Exact: both the constant and the unit conversion are exact');
    else if (exactResult || k.truncated) notes.push('Rounded to 12 significant digits');
    else notes.push(`Carries the constant's uncertainty (${formatNumber(new D(k.uncertainty!)).display} ${k.unit})`);
    return ok(c, {
      kind: 'physics',
      expression: `${k.name} (${k.symbol}) in ${to.symbol}`,
      primary: { display: f.display, plain: f.plain, spoken: `${f.spoken} ${to.symbol}`, unit: to.symbol },
      value,
      lines: [
        { label: 'Symbol', display: k.symbol },
        { label: 'SI value', display: `${si} ${k.unit}` },
      ],
      notes,
    });
  }
  return null;
}

/** Symbols a conversion can start with ("g in ft/s^2"); the cheap pre-check in index.ts uses it. */
export const CONSTANT_SYMBOLS_SRC = [...new Set(CONSTANTS.flatMap((k) => k.symbols))]
  .sort((a, b) => b.length - a.length)
  .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
