import { V } from './exact';

/** Length units with their size in metres (exact rationals as decimal text). */
export const LENGTH: Record<string, { sym: string; m: string; name: string; plural: string }> = {
  mm: { sym: 'mm', m: '0.001', name: 'millimetre', plural: 'millimetres' },
  cm: { sym: 'cm', m: '0.01', name: 'centimetre', plural: 'centimetres' },
  dm: { sym: 'dm', m: '0.1', name: 'decimetre', plural: 'decimetres' },
  m: { sym: 'm', m: '1', name: 'metre', plural: 'metres' },
  km: { sym: 'km', m: '1000', name: 'kilometre', plural: 'kilometres' },
  in: { sym: 'in', m: '0.0254', name: 'inch', plural: 'inches' },
  ft: { sym: 'ft', m: '0.3048', name: 'foot', plural: 'feet' },
  yd: { sym: 'yd', m: '0.9144', name: 'yard', plural: 'yards' },
  mi: { sym: 'mi', m: '1609.344', name: 'mile', plural: 'miles' },
  nmi: { sym: 'nmi', m: '1852', name: 'nautical mile', plural: 'nautical miles' },
  units: { sym: 'units', m: '1', name: 'unit', plural: 'units' },
};

const LEN_WORDS: [string, string][] = [
  ['millimetres', 'mm'], ['millimeters', 'mm'], ['millimetre', 'mm'], ['millimeter', 'mm'], ['mm', 'mm'],
  ['centimetres', 'cm'], ['centimeters', 'cm'], ['centimetre', 'cm'], ['centimeter', 'cm'], ['cms', 'cm'], ['cm', 'cm'],
  ['decimetres', 'dm'], ['decimeters', 'dm'], ['dm', 'dm'],
  ['kilometres', 'km'], ['kilometers', 'km'], ['kilometre', 'km'], ['kilometer', 'km'], ['km', 'km'],
  ['metres', 'm'], ['meters', 'm'], ['metre', 'm'], ['meter', 'm'], ['m', 'm'],
  ['inches', 'in'], ['inch', 'in'], ['in', 'in'], ['"', 'in'],
  ['feet', 'ft'], ['foot', 'ft'], ['ft', 'ft'], ["'", 'ft'],
  ['yards', 'yd'], ['yard', 'yd'], ['yds', 'yd'], ['yd', 'yd'],
  ['nautical miles', 'nmi'], ['nautical mile', 'nmi'], ['nmi', 'nmi'],
  ['miles', 'mi'], ['mile', 'mi'], ['mi', 'mi'],
  ['units', 'units'], ['unit', 'units'],
];

/** Volume units that are not a cubed length: litres, gallons… (size in m³). */
const VOLUME_NAMED: [string, string, string][] = [
  ['millilitres', 'mL', '0.000001'], ['milliliters', 'mL', '0.000001'], ['ml', 'mL', '0.000001'], ['cc', 'mL', '0.000001'],
  ['litres', 'L', '0.001'], ['liters', 'L', '0.001'], ['litre', 'L', '0.001'], ['liter', 'L', '0.001'], ['l', 'L', '0.001'],
  ['us gallons', 'gal', '0.003785411784'], ['gallons', 'gal', '0.003785411784'], ['gallon', 'gal', '0.003785411784'], ['gal', 'gal', '0.003785411784'],
  ['cubic metres', 'm³', '1'],
];
const AREA_NAMED: [string, string, string][] = [
  ['hectares', 'ha', '10000'], ['hectare', 'ha', '10000'], ['ha', 'ha', '10000'],
  ['acres', 'acre', '4046.8564224'], ['acre', 'acre', '4046.8564224'],
];

export type UnitHit = { dim: 1 | 2 | 3 | 'angle'; unit: string; /** size in m, m², m³ (or degrees per unit for angles) */ factor: V; named?: string };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\"']/g, (c) => `\\${c}`);
const lenAlt = LEN_WORDS.map(([w]) => w).sort((a, b) => b.length - a.length).map(esc).join('|');

// Area/volume spelled out: "cm²", "cm^2", "cm2", "sq cm", "square centimetres", "cm squared", "cubic feet", "ft³".
const UNIT_RE = new RegExp(
  String.raw`^\s*(?:` +
    String.raw`(sq\.?|square|cu\.?|cubic)\s+(${lenAlt})\b|` +
    String.raw`(${lenAlt})\s*(?:\^\s*([23])|([²³])|([23])\b|\s+(squared|cubed)\b)|` +
    `(${VOLUME_NAMED.map(([w]) => esc(w)).join('|')}|${AREA_NAMED.map(([w]) => esc(w)).join('|')})\\b|` +
    String.raw`(°|degrees?|degs?\b|radians?\b|rads?\b|gradians?\b|grads?\b)|` +
    `(${lenAlt})(?![a-z])` +
    String.raw`)`,
  'i',
);

const LEN_MAP = new Map(LEN_WORDS);

/** Reads a unit at the start of `s`; returns it and how many characters it used. */
export function readUnit(s: string): { hit: UnitHit; len: number } | null {
  const m = UNIT_RE.exec(s);
  if (!m) return null;
  const len = m[0].length;
  const lenUnit = (w: string) => LEN_MAP.get(w.toLowerCase()) ?? LEN_MAP.get(w)!;
  if (m[1] && m[2]) {
    const u = lenUnit(m[2]);
    const dim = /^c/i.test(m[1]) ? 3 : 2;
    return { hit: { dim, unit: u, factor: V.dec(LENGTH[u]!.m)!.pow(dim) }, len };
  }
  if (m[3]) {
    const u = lenUnit(m[3]);
    const p = m[4] ?? (m[5] === '²' ? '2' : m[5] === '³' ? '3' : undefined) ?? m[6] ?? (m[7] === 'squared' ? '2' : '3');
    const dim = p === '2' ? 2 : 3;
    if (u === 'in' && m[6]) return null; // "in 2" is not square inches
    return { hit: { dim, unit: u, factor: V.dec(LENGTH[u]!.m)!.pow(dim) }, len };
  }
  if (m[8]) {
    const w = m[8].toLowerCase();
    const v = VOLUME_NAMED.find(([x]) => x === w);
    if (v) return { hit: { dim: 3, unit: v[1] === 'm³' ? 'm' : 'm', factor: V.dec(v[2])!, named: v[1] === 'm³' ? undefined : v[1] }, len };
    const a = AREA_NAMED.find(([x]) => x === w)!;
    return { hit: { dim: 2, unit: 'm', factor: V.dec(a[2])!, named: a[1] }, len };
  }
  if (m[9]) {
    const w = m[9].toLowerCase();
    if (w.startsWith('rad')) return { hit: { dim: 'angle', unit: 'rad', factor: V.rat(180).div(V.PI) }, len };
    if (w.startsWith('grad')) return { hit: { dim: 'angle', unit: 'grad', factor: V.rat(9, 10) }, len };
    return { hit: { dim: 'angle', unit: '°', factor: V.rat(1) }, len };
  }
  if (m[10]) {
    const u = lenUnit(m[10]);
    return { hit: { dim: 1, unit: u, factor: V.dec(LENGTH[u]!.m)! }, len };
  }
  return null;
}

export const sup = (p: number) => (p === 2 ? '²' : p === 3 ? '³' : '');

export function unitText(base: string, dim: number): string {
  if (!base || dim === 0) return '';
  if (base === 'units') return dim === 1 ? 'units' : dim === 2 ? 'square units' : 'cubic units';
  return base + sup(dim);
}

export function spokenUnit(base: string, dim: number): string {
  const L = LENGTH[base];
  if (!L || dim === 0) return '';
  if (base === 'units') return unitText(base, dim);
  return (dim === 2 ? 'square ' : dim === 3 ? 'cubic ' : '') + L.plural;
}

/** Size of a named volume/area unit in base-length units (for "= 2.1 L" lines). */
export function namedFactor(named: string): { dim: 2 | 3; m: V } | null {
  const v = VOLUME_NAMED.find(([, s]) => s === named);
  if (v) return { dim: 3, m: V.dec(v[2])! };
  const a = AREA_NAMED.find(([, s]) => s === named);
  if (a) return { dim: 2, m: V.dec(a[2])! };
  return null;
}

export const LENGTH_WORDS_SRC = lenAlt;
