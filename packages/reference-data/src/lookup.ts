import { D, type Answer, type Dec } from '@lemma/math-core';
import { BODIES, BODY_SOURCE, STAR_SOURCE, SUN_MASS, SUN_RADIUS_KM, type BodyInfo } from './data/bodies';
import { COMPOUNDS, COMPOUND_SOURCE, type CompoundInfo } from './data/compounds';
import { COUNTRIES, COUNTRY_SOURCE, type CountryInfo } from './data/countries';
import { ELEMENT_ALIASES, ELEMENT_SOURCE, ELEMENTS, type ElementInfo } from './data/elements';
import { FOOD_SOURCE, FOODS, type FoodInfo } from './data/foods';
import { dec, duration, fixed, large, num, places, spokenUnit } from './format';

export type Prop =
  | 'density' | 'melting' | 'boiling' | 'atomicMass' | 'molarMass' | 'en' | 'z' | 'config' | 'symbol' | 'group' | 'period'
  | 'block' | 'category' | 'state' | 'discovered' | 'formula'
  | 'mass' | 'radius' | 'diameter' | 'gravity' | 'distance' | 'sunDistance' | 'temperature' | 'orbital' | 'day' | 'rotation'
  | 'moons' | 'escape'
  | 'population' | 'popDensity' | 'capital' | 'area' | 'gdp' | 'gdpPerCapita'
  | 'calories' | 'protein' | 'fat' | 'carbs' | 'fibre' | 'sugar' | 'nutrition'
  | 'summary';

/** Property phrases, matched longest first. */
export const PROP_PHRASES: [string, Prop][] = (
  [
    ['density', 'density'], ['mean density', 'density'], ['average density', 'density'],
    ['melting point', 'melting'], ['melting temperature', 'melting'], ['melting temp', 'melting'], ['freezing point', 'melting'],
    ['boiling point', 'boiling'], ['boiling temperature', 'boiling'], ['boiling temp', 'boiling'],
    ['atomic mass', 'atomicMass'], ['atomic weight', 'atomicMass'], ['relative atomic mass', 'atomicMass'], ['standard atomic weight', 'atomicMass'],
    ['molar mass', 'molarMass'], ['molecular weight', 'molarMass'], ['molecular mass', 'molarMass'], ['formula weight', 'molarMass'], ['formula mass', 'molarMass'], ['molar weight', 'molarMass'],
    ['electronegativity', 'en'], ['pauling electronegativity', 'en'],
    ['atomic number', 'z'], ['proton number', 'z'], ['number of protons', 'z'],
    ['electron configuration', 'config'], ['electronic configuration', 'config'], ['electron config', 'config'],
    ['symbol', 'symbol'], ['chemical symbol', 'symbol'], ['element symbol', 'symbol'],
    ['group', 'group'], ['group number', 'group'], ['period', 'period'], ['block', 'block'],
    ['category', 'category'], ['element category', 'category'], ['classification', 'category'],
    ['state of matter', 'state'], ['state', 'state'], ['state at room temperature', 'state'], ['phase', 'state'],
    ['discovery year', 'discovered'], ['year discovered', 'discovered'], ['year of discovery', 'discovered'], ['discovery', 'discovered'],
    ['formula', 'formula'], ['chemical formula', 'formula'], ['molecular formula', 'formula'],
    ['mass', 'mass'], ['weight', 'mass'],
    ['radius', 'radius'], ['mean radius', 'radius'], ['diameter', 'diameter'],
    ['gravity', 'gravity'], ['surface gravity', 'gravity'], ['gravitational acceleration', 'gravity'], ['acceleration due to gravity', 'gravity'],
    ['distance', 'distance'], ['mean distance', 'distance'], ['average distance', 'distance'],
    ['temperature', 'temperature'], ['surface temperature', 'temperature'], ['mean temperature', 'temperature'], ['average temperature', 'temperature'], ['temp', 'temperature'],
    ['orbital period', 'orbital'], ['orbit period', 'orbital'], ['length of a year', 'orbital'], ['length of year', 'orbital'], ['year length', 'orbital'], ['year', 'orbital'], ['period of revolution', 'orbital'],
    ['length of a day', 'day'], ['length of day', 'day'], ['day length', 'day'], ['solar day', 'day'], ['day', 'day'],
    ['rotation period', 'rotation'], ['rotational period', 'rotation'], ['sidereal day', 'rotation'], ['rotation', 'rotation'],
    ['number of moons', 'moons'], ['moons', 'moons'], ['moon count', 'moons'],
    ['escape velocity', 'escape'], ['escape speed', 'escape'],
    ['population', 'population'], ['number of people', 'population'], ['inhabitants', 'population'],
    ['population density', 'popDensity'],
    ['capital', 'capital'], ['capital city', 'capital'],
    ['area', 'area'], ['land area', 'area'], ['total area', 'area'], ['size', 'area'],
    ['gdp', 'gdp'], ['nominal gdp', 'gdp'], ['gross domestic product', 'gdp'], ['economy', 'gdp'],
    ['gdp per capita', 'gdpPerCapita'], ['per capita gdp', 'gdpPerCapita'], ['gdp per person', 'gdpPerCapita'],
    ['calories', 'calories'], ['calorie', 'calories'], ['kcal', 'calories'], ['energy', 'calories'], ['kilocalories', 'calories'], ['calorie count', 'calories'],
    ['protein', 'protein'], ['fat', 'fat'], ['total fat', 'fat'],
    ['carbs', 'carbs'], ['carb', 'carbs'], ['carbohydrates', 'carbs'], ['carbohydrate', 'carbs'],
    ['fiber', 'fibre'], ['fibre', 'fibre'], ['dietary fiber', 'fibre'], ['dietary fibre', 'fibre'],
    ['sugar', 'sugar'], ['sugars', 'sugar'],
    ['nutrition', 'nutrition'], ['nutritional value', 'nutrition'], ['nutrition facts', 'nutrition'], ['nutritional information', 'nutrition'], ['nutrition info', 'nutrition'], ['macros', 'nutrition'], ['nutrients', 'nutrition'],
    ['properties', 'summary'], ['facts', 'summary'],
  ] as [string, Prop][]
).sort((a, b) => b[0].length - a[0].length);

export const PROP_BY_PHRASE = new Map(PROP_PHRASES);
export const PROP_SRC = PROP_PHRASES.map(([p]) => p).join('|');

export type Kind = 'element' | 'compound' | 'body' | 'country' | 'food';

export interface Line {
  label: string;
  display: string;
}

/** One answered property. `display` excludes the unit, which is in `unit` (as Answer.primary has it). */
export interface Fact {
  label: string;
  display: string;
  plain: string;
  spoken: string;
  unit?: string;
  value?: Dec;
  /** Unit of `value` for arithmetic ("g/cm³", "people", "US$"); empty for pure numbers. */
  calcUnit?: string;
  lines?: Line[];
  notes?: string[];
}

export interface Entity {
  kind: Kind;
  name: string;
  /** Which property keys this kind of entity knows about (a missing value then fails, not falls through). */
  supports: Set<Prop>;
  get(prop: Prop): Fact | undefined;
  /** Summary rows tagged with the property they show, so the asked one can be left out. */
  summary(): [Prop, Line][];
  notes: string[];
  /** When set, {@link notes} only apply to answers about these properties. */
  noteProps?: Set<Prop>;
  source: NonNullable<Answer['source']>;
}

const LABELS: Partial<Record<Prop, string>> = {
  density: 'density', melting: 'melting point', boiling: 'boiling point', atomicMass: 'atomic mass', molarMass: 'molar mass',
  en: 'electronegativity', z: 'atomic number', config: 'electron configuration', symbol: 'symbol', group: 'group', period: 'period',
  block: 'block', category: 'category', state: 'state at room temperature', discovered: 'year discovered', formula: 'formula',
  mass: 'mass', radius: 'radius', diameter: 'diameter', gravity: 'surface gravity', distance: 'distance', sunDistance: 'mean distance from the Sun',
  temperature: 'temperature', orbital: 'orbital period', day: 'length of day', rotation: 'rotation period', moons: 'number of moons',
  escape: 'escape velocity', population: 'population', popDensity: 'population density', capital: 'capital', area: 'area', gdp: 'GDP',
  gdpPerCapita: 'GDP per capita', calories: 'calories', protein: 'protein', fat: 'fat', carbs: 'carbohydrates', fibre: 'fibre',
  sugar: 'sugar', nutrition: 'nutrition', summary: 'overview',
};
export const propLabel = (p: Prop) => LABELS[p] ?? p;

/** A numeric fact with a unit. */
function numFact(label: string, value: Dec | number | string, unit: string, sig = 6, extra: Partial<Fact> = {}): Fact {
  const v = dec(value);
  const f = num(v, sig);
  return { label, display: f.display, plain: f.plain, spoken: `${f.spoken} ${spokenUnit(unit)}`.trim(), ...(unit ? { unit } : {}), value: v, calcUnit: unit, ...extra };
}

function textFact(label: string, text: string, extra: Partial<Fact> = {}): Fact {
  return { label, display: text, plain: text, spoken: text, ...extra };
}

const unitText = (f: Fact) => (f.unit ? `${f.display} ${f.unit}` : f.display);

// ---------------------------------------------------------------- temperatures

/** From a kelvin string: °C to the same decimal places, with the kelvin value as a line. */
function tempFromK(label: string, k: string, prefix = ''): Fact {
  const c = new D(k).minus('273.15').toDecimalPlaces(places(k), D.ROUND_HALF_UP);
  const fc = fixed(c, places(k));
  return {
    label,
    display: `${prefix}${fc.display}`,
    plain: fc.plain,
    spoken: `${prefix}${fc.spoken} degrees Celsius`,
    unit: '°C',
    value: c,
    calcUnit: '°C',
    lines: [{ label: 'In kelvin', display: `${num(k, 10).display} K` }],
  };
}

/** From a °C string, with kelvin as a line. */
function tempFromC(label: string, c: string, prefix = ''): Fact {
  const v = new D(c);
  const f = num(v, 10);
  const k = v.plus('273.15');
  return {
    label,
    display: `${prefix}${f.display}`,
    plain: f.plain,
    spoken: `${prefix}${f.spoken} degrees Celsius`,
    unit: '°C',
    value: v,
    calcUnit: '°C',
    lines: [{ label: 'In kelvin', display: `${num(k, 10).display} K` }],
  };
}

const sup = (s: string) => s.replace(/([spdf])(\d+)/g, (_m, l: string, d: string) => l + [...d].map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(c)]).join(''));

// ---------------------------------------------------------------- elements

const ELEMENT_PROPS = new Set<Prop>(['density', 'melting', 'boiling', 'atomicMass', 'molarMass', 'mass', 'en', 'z', 'config', 'symbol', 'group', 'period', 'block', 'category', 'state', 'discovered', 'summary']);

function elementEntity(e: ElementInfo): Entity {
  const massLabel = (p: Prop) => (p === 'molarMass' ? 'molar mass' : 'atomic mass');
  const get = (p: Prop): Fact | undefined => {
    switch (p) {
      case 'atomicMass':
      case 'molarMass':
      case 'mass': {
        const unit = p === 'molarMass' ? 'g/mol' : 'u';
        const f = num(e.mass, 12);
        const notes = e.massNumber ? ['No stable isotope: this is the mass number of the longest-lived isotope'] : ['IUPAC standard atomic weight (abridged)'];
        return { label: massLabel(p), display: f.display, plain: f.plain, spoken: `${f.spoken} ${spokenUnit(unit)}`, unit, value: e.mass, calcUnit: unit, notes, lines: [{ label: p === 'molarMass' ? 'Atomic mass' : 'Molar mass', display: `${f.display} ${p === 'molarMass' ? 'u' : 'g/mol'}` }] };
      }
      case 'density':
        if (!e.density) return undefined;
        return e.state === 'gas'
          ? numFact('density', e.density, 'g/L', 10, { notes: ['Gas density at 0 °C and 1 atm'] })
          : numFact('density', e.density, 'g/cm³', 10, { notes: ['Near room temperature'] });
      case 'melting':
        if (e.mp) return tempFromK('melting point', e.mp);
        if (e.sub) return { ...tempFromK('melting point', e.sub, 'sublimes at '), notes: [`${e.name} has no liquid phase at normal pressure; it sublimes`] };
        return undefined;
      case 'boiling':
        if (e.bp) return tempFromK('boiling point', e.bp);
        if (e.sub) return { ...tempFromK('boiling point', e.sub, 'sublimes at '), notes: [`${e.name} has no liquid phase at normal pressure; it sublimes`] };
        return undefined;
      case 'en':
        return e.en ? numFact('electronegativity', e.en, '', 6, { notes: ['Pauling scale'], spoken: e.en }) : undefined;
      case 'z':
        return numFact('atomic number', e.z, '');
      case 'config':
        return textFact('electron configuration', sup(e.config), e.configPredicted ? { notes: ['Predicted configuration'] } : {});
      case 'symbol':
        return textFact('symbol', e.symbol);
      case 'group':
        return e.group === null ? textFact('group', 'none (f-block)') : numFact('group', e.group, '');
      case 'period':
        return numFact('period', e.period, '');
      case 'block':
        return textFact('block', `${e.block}-block`);
      case 'category':
        return textFact('category', e.category);
      case 'state':
        return e.state ? textFact('state at room temperature', e.state) : undefined;
      case 'discovered':
        return e.year ? textFact('year discovered', String(e.year), { value: new D(e.year) }) : undefined;
      case 'summary':
        return textFact('overview', `${e.name} (${e.symbol})`);
      default:
        return undefined;
    }
  };
  return {
    kind: 'element',
    name: e.name,
    supports: ELEMENT_PROPS,
    get,
    summary() {
      const rows: [Prop, Line][] = [
        ['z', { label: 'Atomic number', display: String(e.z) }],
        ['symbol', { label: 'Symbol', display: e.symbol }],
        ['atomicMass', { label: 'Atomic mass', display: `${e.massNumber ? `[${e.massText}]` : e.massText} u` }],
        ['category', { label: 'Category', display: e.category }],
      ];
      for (const p of ['density', 'melting', 'boiling', 'en', 'config'] as Prop[]) {
        const f = get(p);
        if (f) rows.push([p, { label: f.label[0]!.toUpperCase() + f.label.slice(1), display: unitText(f) }]);
      }
      return rows;
    },
    notes: e.note ? [e.note] : e.z >= 104 ? ['Superheavy element: most properties are predicted, not measured'] : [],
    ...(e.note ? { noteProps: new Set<Prop>(['density', 'melting', 'boiling', 'state', 'summary']) } : {}),
    source: ELEMENT_SOURCE,
  };
}

// ---------------------------------------------------------------- compounds

const COMPOUND_PROPS = new Set<Prop>(['density', 'melting', 'boiling', 'atomicMass', 'molarMass', 'mass', 'formula', 'state', 'summary']);
const SUBS = '₀₁₂₃₄₅₆₇₈₉';
const prettyFormula = (f: string) => f.replace(/(\d+)/g, (d) => [...d].map((c) => SUBS[Number(c)]).join(''));

function compoundEntity(c: CompoundInfo): Entity {
  const get = (p: Prop): Fact | undefined => {
    switch (p) {
      case 'atomicMass':
      case 'molarMass':
      case 'mass':
        return numFact('molar mass', c.molarMass.toDecimalPlaces(3, D.ROUND_HALF_UP), 'g/mol', 10, {
          value: c.molarMass,
          notes: ['Computed from IUPAC standard atomic weights'],
          lines: [{ label: 'Formula', display: prettyFormula(c.formula) }],
        });
      case 'formula':
        return textFact('formula', prettyFormula(c.formula), { plain: c.formula });
      case 'density':
        if (!c.density) return undefined;
        return numFact('density', c.density, c.gas ? 'g/L' : 'g/cm³', 10, c.densityNote ? { notes: [`Density ${c.densityNote}`] } : {});
      case 'melting':
        if (c.mp) return tempFromC('melting point', c.mp);
        if (c.sub) return tempFromC('melting point', c.sub, 'sublimes at ');
        return undefined;
      case 'boiling':
        if (c.bp) return tempFromC('boiling point', c.bp);
        if (c.sub) return tempFromC('boiling point', c.sub, 'sublimes at ');
        return undefined;
      case 'state': {
        if (c.gas) return textFact('state at room temperature', 'gas');
        if (c.mp === undefined) return undefined;
        return textFact('state at room temperature', Number(c.mp) > 25 ? 'solid' : c.bp !== undefined && Number(c.bp) < 20 ? 'gas' : 'liquid');
      }
      case 'summary':
        return textFact('overview', `${c.name} (${prettyFormula(c.formula)})`);
      default:
        return undefined;
    }
  };
  return {
    kind: 'compound',
    name: c.name,
    supports: COMPOUND_PROPS,
    get,
    summary() {
      const rows: [Prop, Line][] = [
        ['formula', { label: 'Formula', display: prettyFormula(c.formula) }],
        ['molarMass', { label: 'Molar mass', display: `${num(c.molarMass.toDecimalPlaces(3, D.ROUND_HALF_UP), 10).display} g/mol` }],
      ];
      for (const p of ['density', 'melting', 'boiling'] as Prop[]) {
        const f = get(p);
        if (f) rows.push([p, { label: f.label[0]!.toUpperCase() + f.label.slice(1), display: unitText(f) }]);
      }
      return rows;
    },
    notes: c.note ? [c.note] : [],
    noteProps: new Set<Prop>(['melting', 'boiling', 'state', 'summary']),
    source: COMPOUND_SOURCE,
  };
}

// ---------------------------------------------------------------- bodies

const BODY_PROPS = new Set<Prop>(['mass', 'radius', 'diameter', 'gravity', 'density', 'escape', 'distance', 'sunDistance', 'temperature', 'orbital', 'period', 'day', 'rotation', 'moons', 'summary']);
const EARTH_MASS = new D('5.9722e24');
const EARTH_RADIUS = 6371.0;
const G0 = 9.80665;
const C_KM_S = 299792.458;
const LY_KM = new D('9460730472580.8');
const PC_LY = 3.26156;

function millionKm(label: string, m: number, extra: Partial<Fact> = {}): Fact {
  const v = new D(m).mul(1e6);
  const l = large(v, 4);
  return { label, display: l.display, plain: v.toFixed(), spoken: `${l.spoken} kilometres`, unit: 'km', value: v, calcUnit: 'km', ...extra };
}

const mkm = (m: number) => `${large(new D(m).mul(1e6), 4).display} km`;

function bodyEntity(b: BodyInfo): Entity {
  const isStar = b.type === 'star' && b.name !== 'Sun';
  const get = (p: Prop): Fact | undefined => {
    switch (p) {
      case 'mass': {
        if (b.mass) {
          const lines: Line[] = [];
          if (b.name === 'Sun') lines.push({ label: 'Relative to Earth', display: `${num(new D(b.mass).div(EARTH_MASS), 6).display} Earth masses` });
          else if (b.name !== 'Earth') lines.push({ label: 'Relative to Earth', display: `${num(new D(b.mass).div(EARTH_MASS), 3).display} Earth masses` });
          return numFact('mass', b.mass, 'kg', 6, { lines });
        }
        if (b.massSun !== undefined) {
          return numFact('mass', b.massSun, 'solar masses', 4, { lines: [{ label: 'In kilograms', display: `${num(new D(SUN_MASS).mul(b.massSun), 3).display} kg` }], notes: ['Approximate'] });
        }
        return undefined;
      }
      case 'radius': {
        if (b.radius !== undefined) {
          const lines: Line[] = [{ label: 'Diameter', display: `${num(b.radius * 2, 6).display} km` }];
          if (b.name !== 'Earth') lines.push({ label: 'Relative to Earth', display: `${num(b.radius / EARTH_RADIUS, 3).display} × Earth` });
          return numFact('mean radius', b.radius, 'km', 6, { lines });
        }
        if (b.radiusSun !== undefined) {
          return numFact('radius', b.radiusSun, 'solar radii', 4, { lines: [{ label: 'In kilometres', display: `${num(b.radiusSun * SUN_RADIUS_KM, 3).display} km` }], notes: ['Approximate'] });
        }
        return undefined;
      }
      case 'diameter': {
        if (b.radius !== undefined) return numFact('mean diameter', b.radius * 2, 'km', 6, { lines: [{ label: 'Radius', display: `${num(b.radius, 6).display} km` }] });
        if (b.radiusSun !== undefined) return numFact('diameter', b.radiusSun * 2, 'solar diameters', 4, { notes: ['Approximate'] });
        return undefined;
      }
      case 'gravity':
        if (b.gravity === undefined) return undefined;
        return numFact('surface gravity', b.gravity, 'm/s²', 6, {
          lines: b.name === 'Earth' ? [] : [{ label: 'Relative to Earth', display: `${num(b.gravity / G0, b.gravity / G0 < 0.1 ? 2 : 3).display} g` }],
          notes: b.type === 'planet' && b.radius !== undefined && b.radius > 20000 ? ['Measured at the 1 bar pressure level (no solid surface)'] : [],
        });
      case 'density':
        if (b.density === undefined) return undefined;
        return numFact('mean density', b.density / 1000, 'g/cm³', 6, { lines: [{ label: 'In kg/m³', display: `${num(b.density).display} kg/m³` }] });
      case 'escape':
        return b.escape === undefined ? undefined : numFact('escape velocity', b.escape, 'km/s');
      case 'distance':
      case 'sunDistance':
        return distance(b, p === 'sunDistance');
      case 'temperature':
        if (b.tempK !== undefined) {
          const lines: Line[] = [{ label: 'In Celsius', display: `${num(Math.round(b.tempK - 273.15), 6).display} °C` }];
          if (b.name === 'Sun') lines.push({ label: 'Core', display: 'about 15 million K' });
          return numFact(b.name === 'Sun' ? 'surface temperature' : 'effective temperature', b.tempK, 'K', 6, { lines, ...(isStar ? { notes: ['Approximate'] } : {}) });
        }
        if (b.temp !== undefined) {
          return numFact('mean temperature', b.temp, '°C', 6, { lines: [{ label: 'In kelvin', display: `${num(b.temp + 273.15, 6).display} K` }] });
        }
        return undefined;
      case 'orbital':
      case 'period': {
        if (b.period === undefined) return undefined;
        const lines: Line[] = [];
        if (b.period > 300) lines.push({ label: 'In Earth years', display: num(b.period / 365.25, 3).display });
        else if (b.period < 2) lines.push({ label: 'In hours', display: num(b.period * 24, 3).display });
        const label = b.parent ? `orbital period around ${b.parent}` : 'orbital period';
        return numFact(label, b.period, 'days', 6, { lines });
      }
      case 'day':
        if (b.day === undefined) return undefined;
        return numFact('length of day', b.day, 'hours', 6, {
          lines: b.day > 48 ? [{ label: 'In Earth days', display: num(b.day / 24, 3).display }] : [],
          notes: ['Solar day: sunrise to sunrise'],
        });
      case 'rotation': {
        if (b.rotation === undefined) return undefined;
        const r = Math.abs(b.rotation);
        return numFact('rotation period', r, 'hours', 6, {
          lines: r > 48 ? [{ label: 'In Earth days', display: num(r / 24, 3).display }] : [],
          notes: b.rotation < 0 ? ['Rotates backwards (retrograde)'] : ['Sidereal rotation, relative to the stars'],
        });
      }
      case 'moons':
        if (!b.moons) return undefined;
        return numFact('number of moons', b.moons[0], '', 6, {
          notes: b.moons[0] > 2 ? [`Confirmed moons as of ${b.moons[1]}; the count grows as new moons are confirmed`] : [],
        });
      case 'summary':
        return textFact('overview', `${b.name} (${b.type}${b.parent ? ` of ${b.parent}` : ''})`);
      default:
        return undefined;
    }
  };
  return {
    kind: 'body',
    name: b.name,
    supports: BODY_PROPS,
    get,
    summary() {
      const rows: [Prop, Line][] = [];
      const add = (p: Prop, label: string) => {
        const f = get(p);
        if (f) rows.push([p, { label, display: unitText(f) }]);
      };
      if (isStar) {
        add('distance', 'Distance from Earth');
        if (b.spectral) rows.push(['summary', { label: 'Spectral type', display: b.spectral }]);
        add('mass', 'Mass');
        add('radius', 'Radius');
        add('temperature', 'Temperature');
        if (b.constellation) rows.push(['summary', { label: 'Constellation', display: b.constellation }]);
        return rows;
      }
      add('mass', 'Mass');
      add('radius', 'Mean radius');
      add('gravity', 'Surface gravity');
      if (b.parent) add('distance', `Distance from ${b.parent}`);
      else if (b.sunDist !== undefined) rows.push(['sunDistance', { label: 'Mean distance from the Sun', display: mkm(b.sunDist) }]);
      add('orbital', 'Orbital period');
      add('temperature', 'Temperature');
      add('moons', 'Moons');
      return rows;
    },
    notes: b.note ? [b.note] : [],
    noteProps: new Set<Prop>(b.note && /temperature/i.test(b.note) ? ['temperature', 'summary'] : ['summary', 'distance', 'radius', 'mass']),
    source: isStar ? STAR_SOURCE : BODY_SOURCE,
  };
}

function distance(b: BodyInfo, fromSun: boolean): Fact | undefined {
  if (b.ly !== undefined) {
    const km = LY_KM.mul(b.ly);
    return numFact('distance from Earth', b.ly, 'light years', 5, {
      lines: [
        { label: 'In kilometres', display: `${num(km, 4).display} km` },
        { label: 'In parsecs', display: num(b.ly / PC_LY, 4).display },
        { label: 'Light travel time', display: `${num(b.ly, 5).display} years` },
      ],
      notes: b.approxDistance ? ['Approximate; the distance carries a large measurement uncertainty'] : [],
    });
  }
  if (b.name === 'Sun') {
    const au = new D('149597870.7');
    const l = large(au, 4);
    return {
      label: 'mean distance from Earth',
      display: l.display,
      plain: au.toFixed(),
      spoken: `${l.spoken} kilometres`,
      unit: 'km',
      value: au,
      calcUnit: 'km',
      lines: [
        { label: 'Astronomical unit', display: '149,597,870.7 km' },
        { label: 'Closest (early January)', display: mkm(b.earthMin!) },
        { label: 'Farthest (early July)', display: mkm(b.earthMax!) },
        { label: 'Light travel time', display: duration(149597870.7 / C_KM_S) },
      ],
    };
  }
  if (b.parent && b.parentDist !== undefined && !fromSun) {
    const lines: Line[] = [];
    if (b.perigee !== undefined && b.apogee !== undefined) {
      lines.push({ label: 'Closest (perigee)', display: `${num(b.perigee).display} km` }, { label: 'Farthest (apogee)', display: `${num(b.apogee).display} km` });
    }
    if (b.parent === 'Earth') lines.push({ label: 'Light travel time', display: duration(b.parentDist / C_KM_S) });
    return numFact(`mean distance from ${b.parent}`, b.parentDist, 'km', 7, { lines });
  }
  if (b.sunDist === undefined) return undefined;
  const sunLines: Line[] = [];
  if (b.perihelion !== undefined) sunLines.push({ label: 'Closest to the Sun', display: mkm(b.perihelion) });
  if (b.aphelion !== undefined) sunLines.push({ label: 'Farthest from the Sun', display: mkm(b.aphelion) });
  if (!fromSun && b.earthAvg !== undefined) {
    return millionKm('average distance from Earth', b.earthAvg, {
      lines: [
        { label: 'Closest to Earth', display: mkm(b.earthMin!) },
        { label: 'Farthest from Earth', display: mkm(b.earthMax!) },
        { label: 'Mean distance from the Sun', display: mkm(b.sunDist) },
        { label: 'Light travel time (average)', display: duration((b.earthAvg * 1e6) / C_KM_S) },
      ],
      notes: ['The distance changes constantly as both planets orbit the Sun', 'Closest is the theoretical minimum; actual close approaches are usually farther'],
    });
  }
  if (!fromSun && b.earthMin !== undefined && b.earthMax !== undefined) {
    return millionKm('mean distance from the Sun', b.sunDist, {
      lines: [{ label: 'Closest to Earth', display: `about ${mkm(b.earthMin)}` }, { label: 'Farthest from Earth', display: `about ${mkm(b.earthMax)}` }, ...sunLines],
      notes: ['Distance from Earth changes constantly as both planets orbit the Sun'],
    });
  }
  return millionKm('mean distance from the Sun', b.sunDist, {
    lines: [...sunLines, { label: 'In astronomical units', display: num(b.sunDist / 149.598, 4).display }],
    notes: b.name === 'Earth' || fromSun ? [] : ['Measured from the Sun; the distance from Earth changes as both planets orbit'],
  });
}

// ---------------------------------------------------------------- countries

const COUNTRY_PROPS = new Set<Prop>(['population', 'popDensity', 'capital', 'area', 'gdp', 'gdpPerCapita', 'summary']);
const APPROX = 'Approximate; figures change yearly';

function money(x: number, sig = 3): { display: string; spoken: string } {
  const l = large(x, sig);
  return { display: `$${l.display}`, spoken: `${l.spoken} US dollars` };
}

/** GDP per person, rounded to the nearest $100 (the inputs are approximate). */
const perCapita = (c: CountryInfo) => Math.round(c.gdp! / c.population / 100) * 100;

function countryEntity(c: CountryInfo): Entity {
  const get = (p: Prop): Fact | undefined => {
    switch (p) {
      case 'population': {
        const l = large(c.population, 4);
        return { label: 'population', display: l.display, plain: String(c.population), spoken: `${l.spoken} people`, value: new D(c.population), calcUnit: 'people', notes: [`${c.populationYear} estimate`] };
      }
      case 'capital':
        return textFact('capital', c.capital, c.capitalNote ? { notes: [c.capitalNote] } : {});
      case 'area':
        if (c.area === undefined) return undefined;
        return numFact('area', c.area, 'km²', 8, { lines: [{ label: 'In square miles', display: `${num(c.area / 2.589988, 4).display} sq mi` }], notes: ['Total area, including inland water'] });
      case 'popDensity':
        if (c.area === undefined) return undefined;
        return numFact('population density', c.population / c.area, 'people/km²', 3);
      case 'gdp': {
        if (c.gdp === undefined) return undefined;
        const m = money(c.gdp);
        const lines: Line[] = [{ label: 'GDP per capita', display: `$${num(perCapita(c), 6).display}` }];
        return { label: 'GDP (nominal)', display: m.display, plain: String(c.gdp), spoken: m.spoken, value: new D(c.gdp), calcUnit: 'US$', lines, notes: [`${c.gdpSource} ${c.gdpYear}, current US dollars`] };
      }
      case 'gdpPerCapita': {
        if (c.gdp === undefined) return undefined;
        const f = num(perCapita(c), 6);
        return { label: 'GDP per capita', display: `$${f.display}`, plain: f.plain, spoken: `${f.spoken} US dollars`, value: new D(perCapita(c)), calcUnit: 'US$', notes: [`Computed from ${c.gdpSource} ${c.gdpYear} GDP and the ${c.populationYear} population`] };
      }
      case 'summary':
        return textFact('overview', c.name);
      default:
        return undefined;
    }
  };
  return {
    kind: 'country',
    name: c.name,
    supports: COUNTRY_PROPS,
    get,
    summary() {
      const rows: [Prop, Line][] = [
        ['capital', { label: 'Capital', display: c.capital }],
        ['population', { label: 'Population', display: large(c.population, 4).display }],
      ];
      if (c.area !== undefined) rows.push(['area', { label: 'Area', display: `${num(c.area, 8).display} km²` }]);
      if (c.gdp !== undefined) rows.push(['gdp', { label: 'GDP', display: money(c.gdp).display }]);
      if (c.area !== undefined) rows.push(['popDensity', { label: 'Population density', display: `${num(c.population / c.area, 3).display} per km²` }]);
      return rows;
    },
    notes: [APPROX, ...(c.note ? [c.note] : [])],
    source: COUNTRY_SOURCE,
  };
}

// ---------------------------------------------------------------- foods

const FOOD_PROPS = new Set<Prop>(['calories', 'protein', 'fat', 'carbs', 'fibre', 'sugar', 'nutrition', 'summary']);
const NUTRIENT: Partial<Record<Prop, [keyof FoodInfo, string]>> = {
  protein: ['protein', 'protein'],
  fat: ['fat', 'fat'],
  carbs: ['carbs', 'carbohydrates'],
  fibre: ['fibre', 'fibre'],
  sugar: ['sugar', 'sugar'],
};

function foodEntity(f: FoodInfo): Entity {
  const serving = f.serving;
  const perServing = (per100: number, unit: 'kcal' | 'g'): Line | undefined => {
    if (!serving) return undefined;
    const v = (per100 * serving[0]) / 100;
    const shown = unit === 'kcal' ? String(Math.round(v)) : num(Math.round(v * 10) / 10, 4).display;
    return { label: `Per ${serving[1]} (${num(serving[0]).display} g)`, display: `${shown} ${unit}` };
  };
  const macros = (skip?: Prop): Line[] => {
    const rows: Line[] = [];
    if (skip !== 'calories') rows.push({ label: 'Calories', display: `${f.kcal} kcal` });
    for (const p of ['protein', 'fat', 'carbs', 'fibre', 'sugar'] as Prop[]) {
      if (p === skip) continue;
      const [key, label] = NUTRIENT[p]!;
      const v = f[key] as number | undefined;
      if (v !== undefined) rows.push({ label: label[0]!.toUpperCase() + label.slice(1), display: `${num(v, 4).display} g` });
    }
    return rows;
  };
  const get = (p: Prop): Fact | undefined => {
    if (p === 'calories') {
      const s = perServing(f.kcal, 'kcal');
      return numFact('calories per 100 g', f.kcal, 'kcal', 6, { lines: [...(s ? [s] : []), ...macros('calories')] });
    }
    if (p === 'nutrition' || p === 'summary') {
      const s = perServing(f.kcal, 'kcal');
      return numFact('nutrition per 100 g', f.kcal, 'kcal', 6, { lines: [...macros('calories'), ...(s ? [s] : [])] });
    }
    const n = NUTRIENT[p];
    if (!n) return undefined;
    const v = f[n[0]] as number | undefined;
    if (v === undefined) return undefined;
    const s = perServing(v, 'g');
    return numFact(`${n[1]} per 100 g`, v, 'g', 6, { lines: [...(s ? [s] : []), ...macros(p)] });
  };
  return {
    kind: 'food',
    name: f.name,
    supports: FOOD_PROPS,
    get,
    summary: () => [],
    notes: [`${f.name}${f.form ? `, ${f.form}` : ''}`, 'Per 100 g; typical values, rounded'],
    source: FOOD_SOURCE,
  };
}

// ---------------------------------------------------------------- index

interface Ref {
  kind: Kind;
  i: number;
}

let index: Map<string, Ref[]> | null = null;
let symbols: Map<string, number> | null = null;
let formulas: Map<string, number> | null = null;

function add(map: Map<string, Ref[]>, key: string, ref: Ref) {
  const k = key.toLowerCase();
  const list = map.get(k);
  if (!list) map.set(k, [ref]);
  else if (!list.some((r) => r.kind === ref.kind && r.i === ref.i)) list.push(ref);
}

function getIndex(): Map<string, Ref[]> {
  if (index) return index;
  const m = new Map<string, Ref[]>();
  ELEMENTS.forEach((e, i) => add(m, e.name, { kind: 'element', i }));
  for (const [alias, sym] of Object.entries(ELEMENT_ALIASES)) add(m, alias, { kind: 'element', i: ELEMENTS.findIndex((e) => e.symbol === sym) });
  COMPOUNDS.forEach((c, i) => [c.name, ...c.aliases].forEach((n) => add(m, n, { kind: 'compound', i })));
  BODIES.forEach((b, i) => [b.name, ...b.aliases].forEach((n) => add(m, n, { kind: 'body', i })));
  COUNTRIES.forEach((c, i) => [c.name, ...c.aliases].forEach((n) => add(m, n, { kind: 'country', i })));
  FOODS.forEach((f, i) => [f.name, ...f.aliases].forEach((n) => add(m, n, { kind: 'food', i })));
  symbols = new Map(ELEMENTS.map((e, i) => [e.symbol, i]));
  formulas = new Map(COMPOUNDS.map((c, i) => [c.formula, i]));
  index = m;
  return m;
}

const cache = new Map<string, Entity>();
function entity(ref: Ref): Entity {
  const key = `${ref.kind}:${ref.i}`;
  let e = cache.get(key);
  if (!e) {
    if (ref.kind === 'element') e = elementEntity(ELEMENTS[ref.i]!);
    else if (ref.kind === 'compound') e = compoundEntity(COMPOUNDS[ref.i]!);
    else if (ref.kind === 'body') e = bodyEntity(BODIES[ref.i]!);
    else if (ref.kind === 'country') e = countryEntity(COUNTRIES[ref.i]!);
    else e = foodEntity(FOODS[ref.i]!);
    cache.set(key, e);
  }
  return e;
}

function singulars(s: string): string[] {
  const out: string[] = [];
  if (s.endsWith('ies')) out.push(`${s.slice(0, -3)}y`);
  if (s.endsWith('oes') || s.endsWith('ches') || s.endsWith('shes')) out.push(s.slice(0, -2));
  if (s.endsWith('s') && !s.endsWith('ss')) out.push(s.slice(0, -1));
  return out;
}

const FORCE: [RegExp, Kind][] = [
  [/^(?:the\s+)?(?:dwarf\s+)?planet\s+/, 'body'],
  [/^(?:the\s+)?star\s+/, 'body'],
  [/^(?:the\s+)?(?:chemical\s+)?element\s+/, 'element'],
  [/^(?:the\s+)?country\s+(?:of\s+)?/, 'country'],
];

/** Candidate entities for a phrase ("the planet Mercury", "eggs", "Fe", "H2O"), in no particular order. */
export function findEntities(text: string): { refs: Ref[]; force?: Kind } {
  const idx = getIndex();
  let t = text.trim().replace(/[?.!,;:]+$/, '').trim();
  let force: Kind | undefined;
  for (const [re, kind] of FORCE) {
    const m = re.exec(t.toLowerCase());
    if (m) {
      t = t.slice(m[0].length);
      force = kind;
      break;
    }
  }
  const exact = t.trim();
  let s = exact.toLowerCase();
  const direct = idx.get(s);
  const result = (refs: Ref[]) => ({ refs: force ? refs.filter((r) => r.kind === force) : refs, ...(force ? { force } : {}) });
  if (direct) return result(direct);
  // Exact-case symbols and formulas: "Fe", "Co" (cobalt) vs "CO" (carbon monoxide), "H2O".
  const sym = symbols!.get(exact);
  if (sym !== undefined) return result([{ kind: 'element', i: sym }]);
  const fm = formulas!.get(exact);
  if (fm !== undefined) return result([{ kind: 'compound', i: fm }]);
  s = s.replace(/^(?:(?:the|a|an|one|1|some|per)\s+)+/, '').replace(/^100 ?g(?:rams?)?(?: of)? /, '').replace(/ per 100 ?g(?:rams?)?$| per serving$/, '');
  const tries = [s];
  const noSize = s.replace(/^(?:small|medium|large|big|fresh|single|cup of|glass of|slice of|piece of)\s+/, '');
  if (noSize !== s) tries.push(noSize);
  for (const x of [...tries]) tries.push(...singulars(x));
  for (const x of tries) {
    const hit = idx.get(x);
    if (hit) return result(hit);
  }
  return { refs: [] };
}

const DEFAULT_ORDER: Kind[] = ['element', 'compound', 'body', 'country', 'food'];
const ORDER: Partial<Record<Prop, Kind[]>> = { mass: ['body', 'element', 'compound'], summary: ['element', 'compound', 'country', 'body', 'food'] };

export type Resolved = { ok: true; entity: Entity; prop: Prop; fact: Fact } | { ok: false; entity: Entity; prop: Prop; message: string };

/** Entity phrase + property → the fact, a "not listed" miss, or null when the entity is unknown. */
export function resolve(entityText: string, prop: Prop): Resolved | null {
  const { refs } = findEntities(entityText);
  if (!refs.length) return null;
  const ents = refs.map(entity);
  const order = ORDER[prop] ?? DEFAULT_ORDER;
  const ranked = [...ents].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  const chosen = ranked.find((e) => e.supports.has(prop)) ?? ranked[0]!;
  const fact = chosen.supports.has(prop) ? chosen.get(prop) : undefined;
  if (!fact) return { ok: false, entity: chosen, prop, message: `No ${propLabel(prop)} listed for ${chosen.name}` };
  // Another known entity shares the name (Mercury): say how to ask for it.
  const other = ents.find((e) => e !== chosen && e.supports.has(prop));
  if (other) {
    const how = other.kind === 'body' ? `the planet ${other.name.toLowerCase()}` : other.kind === 'element' ? `the element ${other.name.toLowerCase()}` : other.name.toLowerCase();
    fact.notes = [...(fact.notes ?? []), `For ${how}, ask "${propLabel(prop)} of ${how}"`];
  }
  return { ok: true, entity: chosen, prop, fact };
}

export interface LookupResult {
  entity: string;
  kind: Kind;
  property: string;
  display: string;
  unit?: string;
  value?: Dec;
}

/** Programmatic lookup for other modules: `lookup('gold', 'density')` → 19.3 g/cm³. Null when unknown or not listed. */
export function lookup(entityName: string, property: string): LookupResult | null {
  const prop = PROP_BY_PHRASE.get(property.trim().toLowerCase()) ?? (Object.keys(LABELS).includes(property) ? (property as Prop) : undefined);
  if (!prop) return null;
  const r = resolve(entityName, prop);
  if (!r || !r.ok) return null;
  return {
    entity: r.entity.name,
    kind: r.entity.kind,
    property: r.fact.label,
    display: r.fact.display,
    ...(r.fact.unit ? { unit: r.fact.unit } : {}),
    ...(r.fact.value ? { value: r.fact.value } : {}),
  };
}
