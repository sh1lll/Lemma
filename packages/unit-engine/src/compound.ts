import { D, type Dec } from '@lemma/math-core';
import { ALIASES, findUnits, type Dimension, type Dims, type UnitDef } from './units';

export type { Dims };

/**
 * Derived units built from registered ones: "km/h", "ft/s^2", "eV s", "J/(mol·K)", "L/100 km", "mpg".
 * Each is reduced to an SI factor and a dimension vector so any two can be compared, including inverse pairs
 * such as fuel economy (distance per volume) and fuel consumption (volume per distance).
 */


export interface CompoundUnit {
  factor: Dec;
  dims: Dims;
  symbol: string;
}

const DIMS: Partial<Record<Dimension, Dims>> = {
  length: [1, 0, 0, 0, 0],
  mass: [0, 1, 0, 0, 0],
  time: [0, 0, 1, 0, 0],
  volume: [3, 0, 0, 0, 0],
  area: [2, 0, 0, 0, 0],
  speed: [1, 0, -1, 0, 0],
  energy: [2, 1, -2, 0, 0],
  power: [2, 1, -3, 0, 0],
  pressure: [-1, 1, -2, 0, 0],
  frequency: [0, 0, -1, 0, 0],
};

/** Units that only make sense inside a derived unit (or as SI symbols of constants). */
const EXTRA: { aliases: string[]; symbol: string; factor: Dec; dims: Dims }[] = [
  { aliases: ['k', 'kelvin', 'kelvins'], symbol: 'K', factor: new D(1), dims: [0, 0, 0, 1, 0] },
  { aliases: ['mol', 'mole', 'moles', 'mols'], symbol: 'mol', factor: new D(1), dims: [0, 0, 0, 0, 1] },
  { aliases: ['n', 'newton', 'newtons'], symbol: 'N', factor: new D(1), dims: [1, 1, -2, 0, 0] },
];

/** Whole names that stand for a derived unit. */
const NAMED: [RegExp, string, string][] = [
  [/^(?:mpg|mpg us|us mpg|miles? per (?:us )?gallon)$/, 'mi/gal', 'mpg'],
  [/^(?:mpg imp|imperial mpg|uk mpg|mpg \(?(?:imperial|uk)\)?|miles? per (?:imperial|uk) gallon)$/, 'mi/impgal', 'mpg (imp)'],
  [/^(?:l\/100 ?km|liters? per 100 ?km|litres? per 100 ?km|liters? per 100 kilometers?|litres? per 100 kilometres?)$/, 'l/100km', 'L/100 km'],
  [/^(?:kpl|km\/l|kilometers? per lit(?:er|re)|kilometres? per lit(?:er|re))$/, 'km/l', 'km/L'],
];

const SUP: Record<string, string> = { '⁻': '-', '¹': '1', '²': '2', '³': '3', '⁴': '4' };
const SUP_OUT = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶'];

interface Factor {
  factor: Dec;
  dims: Dims;
  symbol: string;
}

function lookup(alias: string): Factor | null {
  const extra = EXTRA.find((x) => x.aliases.includes(alias));
  if (extra) return { factor: extra.factor, dims: extra.dims, symbol: extra.symbol };
  for (const u of findUnits(alias)) {
    const dims = DIMS[u.dimension];
    if (dims && u.factor) return { factor: u.factor, dims, symbol: u.symbol };
  }
  return null;
}

// Aliases that can start a term, longest first. Built lazily (the registry is static).
let TERM_ALIASES: string[] | null = null;
function termAliases(): string[] {
  if (!TERM_ALIASES) {
    const set = new Set<string>(EXTRA.flatMap((x) => x.aliases));
    for (const [a, u] of ALIASES) if (DIMS[u.dimension] && u.factor && !/["']/.test(a)) set.add(a);
    TERM_ALIASES = [...set].sort((a, b) => b.length - a.length);
  }
  return TERM_ALIASES;
}

const BOUNDARY = /^(?:$|[\s/·*⋅^()⁻¹²³⁴\d-])/;

/** One side ("ft s^-1", "mol·k", "100km") of a derived unit, as factors with exponents. */
function parseSide(text: string, sign: 1 | -1, out: { f: Factor; p: number }[]): boolean {
  let s = text.replace(/[()]/g, ' ').trim();
  while (s) {
    s = s.replace(/^[\s·*⋅-]+/, '');
    if (!s) break;
    let mult = new D(1);
    const num = /^(\d+(?:\.\d+)?)\s*/.exec(s);
    if (num) {
      mult = new D(num[1]!);
      s = s.slice(num[0].length);
    }
    const alias = termAliases().find((a) => s.startsWith(a) && BOUNDARY.test(s.slice(a.length)));
    if (!alias) {
      if (num && !s) {
        out.push({ f: { factor: mult, dims: [0, 0, 0, 0, 0], symbol: num[1]! }, p: sign });
        break;
      }
      return false;
    }
    const f = lookup(alias);
    if (!f) return false;
    s = s.slice(alias.length);
    let p = 1;
    const pow = /^\s*(?:\^\s*\(?\s*(-?\d)\s*\)?|([⁻]?[¹²³⁴])|(\d)(?![\d.])|\s+(squared|cubed))/.exec(s);
    if (pow) {
      const raw = pow[1] ?? (pow[2] ? [...pow[2]].map((ch) => SUP[ch]).join('') : undefined) ?? pow[3] ?? (pow[4] === 'squared' ? '2' : '3');
      p = Number(raw);
      s = s.slice(pow[0].length);
    }
    const symbol = mult.eq(1) ? f.symbol : `${num![1]} ${f.symbol}`;
    out.push({ f: { factor: f.factor.mul(mult), dims: f.dims, symbol }, p: p * sign });
  }
  return true;
}

function sup(p: number): string {
  const a = Math.abs(p);
  return a === 1 ? '' : (p < 0 ? '⁻' : '') + (SUP_OUT[a] ?? `^${a}`);
}

/**
 * Parses a derived unit. Returns null unless the text is made only of units (and an optional numeric multiplier
 * like the 100 in "L/100 km"). A single plain registered unit parses too; callers that prefer the registry try it first.
 */
export function parseCompound(raw: string): CompoundUnit | null {
  let text = raw.trim().toLowerCase().replace(/\s+/g, ' ').replace(/^(?:an?|the)\s+/, '');
  if (!text || text.length > 60) return null;
  let named: string | null = null;
  for (const [re, expr, label] of NAMED) {
    if (re.test(text)) {
      text = expr;
      named = label;
      break;
    }
  }
  text = text.replace(/\s+per\s+/g, '/');
  const [numer, ...denoms] = text.split('/');
  const parts: { f: Factor; p: number }[] = [];
  if (numer!.trim() && numer!.trim() !== '1' && !parseSide(numer!, 1, parts)) return null;
  for (const d of denoms) if (!d.trim() || !parseSide(d, -1, parts)) return null;
  if (!parts.length) return null;

  let factor = new D(1);
  const dims: Dims = [0, 0, 0, 0, 0];
  for (const { f, p } of parts) {
    factor = factor.mul(f.factor.pow(p));
    for (let i = 0; i < 5; i++) dims[i]! += f.dims[i]! * p;
  }
  const num = parts.filter((x) => x.p > 0).map((x) => x.f.symbol + sup(x.p));
  const den = parts.filter((x) => x.p < 0).map((x) => x.f.symbol + sup(-x.p));
  const symbol = named ?? ((num.length ? num.join('·') : '1') + (den.length ? '/' + (den.length > 1 ? `(${den.join('·')})` : den[0]) : ''));
  return { factor, dims, symbol };
}

export function sameDims(a: Dims, b: Dims): boolean {
  return a.every((x, i) => x === b[i]);
}

export function inverseDims(a: Dims, b: Dims): boolean {
  return a.some((x) => x !== 0) && a.every((x, i) => x === -b[i]!);
}

/** The derived-unit view of a registered unit, when it has one (not temperature scales, data, angles). */
export function asCompound(u: UnitDef): CompoundUnit | null {
  const dims = u.dims ?? DIMS[u.dimension];
  return dims && u.factor ? { factor: u.factor, dims, symbol: u.symbol } : null;
}
