import { calculate, D, formatNumber, MathError, type CalcOptions, type Dec, type Formatted, type Session } from '@lemma/math-core';
import { asCompound, inverseDims, parseCompound, sameDims, type CompoundUnit } from './compound';
import { ALIASES, findUnit, findUnits, UNITS, type UnitDef } from './units';

export { UNITS, findUnit, findUnits, type UnitDef };
export { parseCompound, asCompound, sameDims, inverseDims, type CompoundUnit, type Dims } from './compound';

export interface ConversionLine {
  unit: UnitDef;
  value: Dec;
  formatted: Formatted;
}

export interface ConversionSuccess {
  ok: true;
  input: string;
  expression: string;
  source: { value: Dec; unit: UnitDef };
  results: ConversionLine[];
  notes: string[];
}

export interface ConversionFailure {
  ok: false;
  input: string;
  error: MathError;
}

export type ConversionResult = ConversionSuccess | ConversionFailure;

// The trailing space is a lookahead so adjacent connectors don't swallow each other's spaces ("5 in to cm").
const CONNECTORS = /\s+(?:in terms of|into|to|in|as)(?=\s)/g;

interface Parsed {
  quantity: string;
  unit: UnitDef;
  targets: UnitDef[];
  /** "5 feet 11 inches": each amount with its unit, summed before converting. `unit` is then the first part's. */
  parts?: { quantity: string; unit: UnitDef }[];
}

/** A derived unit ("ft/s²") as a registry-shaped entry, so results look like any other conversion. */
export function derivedUnit(c: CompoundUnit): UnitDef {
  return { id: c.symbol, dimension: 'derived', symbol: c.symbol, singular: c.symbol, plural: c.symbol, factor: c.factor, dims: c.dims, aliases: [] };
}

const AMOUNT = String.raw`[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:\s*\/\s*\d+)?`;
const PART = new RegExp(String.raw`(${AMOUNT})\s*([^\d,]*?)\s*(?:,|\band\b)?\s*(?=[-+]?[\d.]|$)`, 'y');
/** "5 foot 11", "1 hour 30": the unit the last bare number is in. */
const IMPLIED: Record<string, string> = { ft: 'in', h: 'min', min: 's', lb: 'oz', st: 'lb', m: 'cm', day: 'h', week: 'day', year: 'month' };

/** "5 feet 11 inches", "2 lb 3 oz", "1 hr 30 min", "5'11\"": two or more amounts of one dimension. */
function splitCompoundQuantity(text: string): { quantity: string; units: UnitDef[] }[] | null {
  const t = text.trim();
  if (!/\d[^\d]*[a-z'"][^\d]*\d/.test(t)) return null;
  PART.lastIndex = 0;
  const out: { quantity: string; units: UnitDef[] }[] = [];
  while (PART.lastIndex < t.length) {
    const start = PART.lastIndex;
    const m = PART.exec(t);
    if (!m || m.index !== start || m[0] === '') return null;
    // "10 m2" is square metres, not 10 m and 2 more: amounts are separated by a space, comma, "and" or a ' / ".
    if (PART.lastIndex < t.length && !/[\s,'"]$/.test(m[0])) return null;
    const name = m[2]!.trim();
    let units = name ? findUnits(name) : [];
    if (!name) {
      const prev = out.at(-1)?.units[0];
      const implied = prev && IMPLIED[prev.id];
      if (!implied || PART.lastIndex < t.length) return null;
      units = findUnits(implied);
    }
    if (!units.length) return null;
    out.push({ quantity: m[1]!.replace(/\s+/g, ''), units });
  }
  return out.length >= 2 ? out : null;
}

function splitUnitSuffix(text: string): { quantity: string; units: UnitDef[] } | null {
  const t = text.trim();
  for (const [alias] of ALIASES) {
    if (!t.endsWith(alias)) continue;
    const rest = t.slice(0, t.length - alias.length);
    // The alias must stand on its own: "50 km", "50km", but not "5 mm" matching "m".
    if (rest !== '' && !/[\s\d.)]$/.test(rest)) continue;
    const quantity = rest.trim().replace(/\s+(?:many|much)$/, '').replace(/\s+(?:an?|of)$/, '').replace(/^(?:an?|one)$/, '1');
    return { quantity, units: findUnits(alias) };
  }
  return null;
}

function parseTargets(text: string): UnitDef[][] | null {
  const parts = text.trim().split(/\s*,\s*|\s+and\s+/).filter(Boolean);
  if (!parts.length) return null;
  const units = parts.map((p) => findUnits(p.replace(/^(?:an?|the)\s+/, '')));
  return units.every((u) => u.length) ? units : null;
}

/** True when two units can be converted into each other (same dimension, or inverse derived dimensions). */
function compatible(a: UnitDef, b: UnitDef): boolean {
  if (a.dimension === b.dimension && a.dimension !== 'derived') return true;
  const ca = asCompound(a);
  const cb = asCompound(b);
  return !!ca && !!cb && (sameDims(ca.dims, cb.dims) || inverseDims(ca.dims, cb.dims));
}

/** Picks the readings of ambiguous names ("k": km or kelvin) that make every side the same dimension. */
function resolve(quantity: string, sources: UnitDef[], targets: UnitDef[][]): Parsed {
  for (const unit of sources) {
    const picked = targets.map((cands) => cands.find((t) => compatible(unit, t)));
    if (picked.every(Boolean)) return { quantity: quantity || '1', unit, targets: picked as UnitDef[] };
  }
  return { quantity: quantity || '1', unit: sources[0]!, targets: targets.map((c) => c[0]!) };
}

function resolveParts(parts: { quantity: string; units: UnitDef[] }[], targets: UnitDef[][]): Parsed | null {
  for (const first of parts[0]!.units) {
    if (!first.factor) continue; // no "5 c 3 f"
    const picked = parts.map((p) => p.units.find((u) => u.dimension === first.dimension && u.factor));
    if (!picked.every(Boolean)) continue;
    const r = resolve('1', [first], targets);
    return { ...r, quantity: parts[0]!.quantity, parts: parts.map((p, i) => ({ quantity: p.quantity, unit: picked[i]! })) };
  }
  return null;
}

/** "30 mpg", "9.8 m/s^2", "g": an amount and a derived unit. */
function splitCompoundSuffix(text: string): { quantity: string; units: UnitDef[] } | null {
  const t = text.trim();
  // The unit is the longest tail that parses; it starts after a space, a digit or a ")".
  for (let i = 0; i < t.length; i++) {
    if (i > 0 && !/[\s\d.)]/.test(t[i - 1]!)) continue;
    // A unit starts with a letter (the 100 in "L/100 km" is inside it, never at its start).
    if (!/[a-zµμ]/.test(t[i]!)) continue;
    const c = parseCompound(t.slice(i));
    if (c) return { quantity: t.slice(0, i).trim().replace(/\s+(?:an?|of)$/, '').replace(/^(?:an?|one)$/, '1'), units: [derivedUnit(c)] };
  }
  return null;
}

function compoundTargets(text: string): UnitDef[][] | null {
  const parts = text.trim().split(/\s*,\s*|\s+and\s+/).filter(Boolean);
  if (!parts.length) return null;
  const out: UnitDef[][] = [];
  for (const p of parts) {
    const reg = findUnits(p.replace(/^(?:an?|the)\s+/, ''));
    if (reg.length) {
      out.push(reg);
      continue;
    }
    const c = parseCompound(p);
    if (!c) return null;
    out.push([derivedUnit(c)]);
  }
  return out;
}

/** Recognises "50 miles to km", "convert 3 cups into ml", "how many feet in a mile". Null when the input isn't a conversion. */
export function parseConversion(input: string): Parsed | null {
  // "B" is a byte and "b" a bit; the rest of the parse is case-insensitive, so spell the capital out first.
  let s = input.replace(/(^|[^A-Za-z])B(?![A-Za-z])/g, '$1bytes').toLowerCase().trim().replace(/[?.!]+$/, '').replace(/\s+/g, ' ');
  s = s.replace(/^(?:(?:what(?:'s| is)|whats|how much is|convert|change|please|tell me)\s+)+/, '');
  // "m^2", "ft²" → the registry's "m2", "ft2" (only right after a letter, so "2^3 m" keeps its exponent).
  s = s.replace(/([a-z])\s*\^\s*([23])\b/g, '$1$2').replace(/([a-z])²/g, '$12').replace(/([a-z])³/g, '$13');

  // "how many miles per hour in 100 knots": try every split, since the target unit may itself contain "per"/"in".
  if (/^how many /.test(s)) {
    const splits = [...s.matchAll(/ (?:are |is )?(?:in|per|make up|make|equal) /g)].sort((a, b) => Number(!/ in $/.test(a[0])) - Number(!/ in $/.test(b[0])));
    for (const m of splits) {
      const targets = parseTargets(s.slice('how many '.length, m.index));
      const src = targets && splitUnitSuffix(s.slice(m.index! + m[0].length));
      if (targets && src) return resolve(src.quantity, src.units, targets);
    }
  }

  // Try each connector from the right, so "5 in to cm" splits at "to" and "5 ft in in" at the last "in".
  const matches = [...s.matchAll(CONNECTORS)].reverse();
  for (const m of matches) {
    const left = s.slice(0, m.index);
    const right = s.slice(m.index! + m[0].length);
    // "days in a year", "km in a mile": a bare unit "in" an amount of another asks how many.
    if (/^\s+in$/.test(m[0]) && /^\s*(?:an?|one|every)\s/.test(right) && !/\d/.test(left)) {
      const targets = parseTargets(left.replace(/^how many\s+/, ''));
      const src = targets && splitUnitSuffix(right.trim().replace(/^every\s/, 'a '));
      if (targets && src) return resolve(src.quantity, src.units, targets);
    }
    const targets = parseTargets(right);
    const parts = targets && splitCompoundQuantity(left);
    if (targets && parts) {
      const r = resolveParts(parts, targets);
      if (r) return r;
    }
    const src = targets && splitUnitSuffix(left);
    if (targets && src) return resolve(src.quantity, src.units, targets);
  }
  // Derived units ("ft/s^2", "eV s", "mpg", "L/100 km") on either side.
  for (const m of matches) {
    const left = s.slice(0, m.index);
    const right = s.slice(m.index! + m[0].length);
    const targets = compoundTargets(right);
    if (!targets) continue;
    // Whichever reading takes the longer unit: "1 eV s" is eV·s, not "1 eV" seconds.
    const reg = splitUnitSuffix(left);
    const derived = splitCompoundSuffix(left);
    const src = derived && (!reg || derived.quantity.length < reg.quantity.length) ? derived : reg;
    if (src) return resolve(src.quantity, src.units, targets);
  }
  return null;
}

export function convert(input: string, session: Session, opts: CalcOptions = {}): ConversionResult | null {
  const parsed = parseConversion(input);
  if (!parsed) return null;
  const { unit, targets } = parsed;

  for (const t of targets) {
    if (!compatible(unit, t)) {
      const dim = (u: UnitDef) => (u.dimension === 'derived' ? 'derived unit' : u.dimension);
      return {
        ok: false,
        input,
        error: new MathError('domain', `Can't convert ${unit.plural} (${dim(unit)}) to ${t.plural} (${dim(t)})`),
      };
    }
  }

  // Each part of "5 ft 11 in" in base units, summed; a single amount is the one-part case.
  const parts = parsed.parts ?? [{ quantity: parsed.quantity, unit }];
  let base: Dec | null = null;
  let firstValue: Dec | null = null;
  const shown: string[] = [];
  for (const p of parts) {
    const q = calculate(p.quantity, session, opts);
    if (!q.ok) return { ok: false, input, error: q.error };
    firstValue ??= q.value;
    const b = p.unit.toBase ? p.unit.toBase(q.value) : q.value.mul(p.unit.factor!);
    base = base ? base.plus(b) : b;
    shown.push(`${formatNumber(q.value, opts.format).display} ${p.unit.symbol}`);
  }
  if (unit.dimension === 'temperature' && base!.isNegative()) {
    return { ok: false, input, error: new MathError('domain', 'That temperature is below absolute zero') };
  }
  const notes: string[] = [];
  const results: ConversionLine[] = [];
  for (const t of targets) {
    let raw: Dec;
    const cu = asCompound(unit);
    const ct = asCompound(t);
    if (cu && ct && inverseDims(cu.dims, ct.dims)) {
      // mpg ↔ L/100 km: one is the reciprocal of the other.
      if (base!.isZero()) return { ok: false, input, error: new MathError('domain', `0 ${unit.symbol} has no equivalent in ${t.symbol} (they are inverse units)`) };
      raw = new D(1).div(base!.mul(t.factor!));
      notes.push(`${unit.symbol} and ${t.symbol} are inverse units: a bigger ${unit.symbol} means a smaller ${t.symbol}`);
    } else {
      raw = t.fromBase ? t.fromBase(base!) : base!.div(t.factor!);
    }
    const value = raw.toSignificantDigits(40);
    results.push({ unit: t, value, formatted: formatNumber(value, opts.format) });
  }

  notes.push(...[unit, ...targets, ...parts.map((p) => p.unit)].filter((u) => u.note).map((u) => `${u.plural}: ${u.note}`));
  // A compound amount ("5 ft 11 in") is reported in its first unit.
  const sourceValue = parts.length > 1 ? (unit.toBase ? unit.fromBase!(base!) : base!.div(unit.factor!)).toSignificantDigits(40) : firstValue!;
  return {
    ok: true,
    input,
    expression: `${shown.join(' ')} → ${targets.map((t) => t.symbol).join(', ')}`,
    source: { value: sourceValue, unit },
    results,
    notes: [...new Set(notes)],
  };
}

export function unitLabel(u: UnitDef, value: Dec): string {
  // Symbols read better for compact units; full names for everyday ones like "cups" or "acres".
  if (u.symbol.length <= 4 && u.symbol !== u.singular) return u.symbol;
  return value.abs().eq(1) ? u.singular : u.plural;
}
