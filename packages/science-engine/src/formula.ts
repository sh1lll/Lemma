import { D, type Dec } from '@lemma/math-core';
import { BY_NAME, BY_SYMBOL } from './elements';

export type Counts = Map<string, bigint>;

/**
 * Parses a chemical formula into element counts: "H2O", "Ca(OH)2", "K4[Fe(CN)6]", "CuSO4·5H2O", "CuSO4*5H2O".
 * Case-sensitive (Co is cobalt, CO is carbon monoxide). Null when it isn't a formula.
 */
export function parseFormula(formula: string): Counts | null {
  const f = formula.replace(/\s+/g, '');
  if (!f || !/^[A-Z(\[\d]/.test(f)) return null;
  const total: Counts = new Map();
  for (const part of f.split(/[·•∙⋅*.]/)) {
    const m = /^(\d*)(.+)$/.exec(part);
    if (!m) return null;
    const coef = m[1] ? BigInt(m[1]) : 1n;
    if (coef === 0n) return null;
    const p = { s: m[2]!, i: 0 };
    const counts = group(p, null);
    if (!counts || p.i !== p.s.length) return null;
    for (const [el, n] of counts) total.set(el, (total.get(el) ?? 0n) + n * coef);
  }
  return total.size ? total : null;
}

function count(p: { s: string; i: number }): bigint {
  const m = /^\d+/.exec(p.s.slice(p.i));
  if (!m) return 1n;
  p.i += m[0].length;
  return BigInt(m[0]);
}

function group(p: { s: string; i: number }, close: string | null): Counts | null {
  const out: Counts = new Map();
  const add = (el: string, n: bigint) => out.set(el, (out.get(el) ?? 0n) + n);
  while (p.i < p.s.length) {
    const ch = p.s[p.i]!;
    if (ch === ')' || ch === ']') {
      if (ch !== close) return null;
      return out;
    }
    if (ch === '(' || ch === '[') {
      p.i++;
      const inner = group(p, ch === '(' ? ')' : ']');
      if (!inner || p.s[p.i] !== (ch === '(' ? ')' : ']')) return null;
      p.i++;
      const n = count(p);
      for (const [el, k] of inner) add(el, k * n);
      continue;
    }
    if (/[A-Z]/.test(ch)) {
      const two = p.s.slice(p.i, p.i + 2);
      const sym = /^[A-Z][a-z]$/.test(two) && BY_SYMBOL.has(two) ? two : BY_SYMBOL.has(ch) ? ch : null;
      if (!sym) return null;
      p.i += sym.length;
      add(sym, count(p));
      continue;
    }
    return null;
  }
  return close ? null : out;
}

export function molarMass(counts: Counts): Dec {
  let m = new D(0);
  for (const [el, n] of counts) m = m.plus(BY_SYMBOL.get(el)!.weight.mul(n.toString()));
  return m;
}

export interface Substance {
  formula: string;
  name?: string;
  counts: Counts;
  molarMass: Dec;
  /** Atoms per formula unit. */
  atoms: bigint;
  /** A single element given by name ("carbon"): particles are atoms. */
  element: boolean;
}

const COMMON: Record<string, string> = {
  water: 'H2O', ice: 'H2O', steam: 'H2O',
  salt: 'NaCl', 'table salt': 'NaCl', 'sodium chloride': 'NaCl',
  glucose: 'C6H12O6', dextrose: 'C6H12O6', fructose: 'C6H12O6', sucrose: 'C12H22O11', sugar: 'C12H22O11', 'table sugar': 'C12H22O11',
  'carbon dioxide': 'CO2', 'carbon monoxide': 'CO', methane: 'CH4', ethane: 'C2H6', propane: 'C3H8', butane: 'C4H10', octane: 'C8H18',
  ethanol: 'C2H5OH', alcohol: 'C2H5OH', methanol: 'CH3OH', ammonia: 'NH3', ozone: 'O3',
  'oxygen gas': 'O2', 'hydrogen gas': 'H2', 'nitrogen gas': 'N2', 'chlorine gas': 'Cl2',
  'hydrogen peroxide': 'H2O2', 'baking soda': 'NaHCO3', 'sodium bicarbonate': 'NaHCO3', 'sodium hydrogen carbonate': 'NaHCO3',
  'sulfuric acid': 'H2SO4', 'sulphuric acid': 'H2SO4', 'hydrochloric acid': 'HCl', 'nitric acid': 'HNO3', 'phosphoric acid': 'H3PO4',
  'acetic acid': 'CH3COOH', vinegar: 'CH3COOH', 'sodium hydroxide': 'NaOH', 'potassium hydroxide': 'KOH', 'calcium hydroxide': 'Ca(OH)2',
  'calcium carbonate': 'CaCO3', chalk: 'CaCO3', limestone: 'CaCO3', rust: 'Fe2O3', 'iron oxide': 'Fe2O3', 'iron(iii) oxide': 'Fe2O3',
  caffeine: 'C8H10N4O2', aspirin: 'C9H8O4', 'citric acid': 'C6H8O7', 'potassium chloride': 'KCl', 'calcium chloride': 'CaCl2',
  'copper sulfate': 'CuSO4', 'copper(ii) sulfate': 'CuSO4', 'silver nitrate': 'AgNO3', 'potassium permanganate': 'KMnO4', silica: 'SiO2', quartz: 'SiO2',
};
/** Lower-case formulas people type without capitals. */
const LOWER: Record<string, string> = {
  h2o: 'H2O', co2: 'CO2', nacl: 'NaCl', o2: 'O2', h2: 'H2', n2: 'N2', ch4: 'CH4', nh3: 'NH3', hcl: 'HCl', naoh: 'NaOH', koh: 'KOH',
  h2so4: 'H2SO4', hno3: 'HNO3', caco3: 'CaCO3', c6h12o6: 'C6H12O6', c2h5oh: 'C2H5OH', h2o2: 'H2O2', nahco3: 'NaHCO3', kcl: 'KCl',
  c3h8: 'C3H8', o3: 'O3', cl2: 'Cl2', so2: 'SO2', no2: 'NO2', fe2o3: 'Fe2O3', cuso4: 'CuSO4', mgo: 'MgO', cao: 'CaO',
};

export function resolveSubstance(text: string): Substance | null {
  let t = text.trim().replace(/^(?:of\s+)?(?:an?\s+|the\s+|pure\s+)*/i, '').replace(/\s+(?:solution|gas|molecules?|crystals?)$/i, '').trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  let formula = COMMON[lower] ?? LOWER[lower];
  let name: string | undefined = COMMON[lower] ? lower : undefined;
  let element = false;
  if (!formula && BY_NAME.has(lower)) {
    const el = BY_NAME.get(lower)!;
    formula = el.symbol;
    name = el.name.toLowerCase();
    element = true;
  }
  formula ??= t;
  const counts = parseFormula(formula);
  if (!counts) return null;
  if (!element && counts.size === 1 && [...counts.values()][0] === 1n) element = true;
  let atoms = 0n;
  for (const n of counts.values()) atoms += n;
  return { formula, name, counts, molarMass: molarMass(counts), atoms, element };
}
