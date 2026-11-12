import type { Answer, AnswerFailure } from '@lemma/math-core';
import { describe, expect, it } from 'vitest';
import { answerReference, BODIES, COMPOUNDS, COUNTRIES, ELEMENTS, FOODS, lookup, MATH_CONSTANTS, MAYBE_REFERENCE, SEQUENCES } from '../src';
import { PHYSICAL_CONSTANTS } from '../src/physical';

function ask(input: string): Answer {
  const r = answerReference(input);
  if (!r) throw new Error(`"${input}" not recognised`);
  if (!r.ok) throw new Error(`"${input}" failed: ${r.error.message}`);
  return r;
}
function failure(input: string): AnswerFailure {
  const r = answerReference(input);
  if (!r) throw new Error(`"${input}" not recognised`);
  if (r.ok) throw new Error(`"${input}" unexpectedly answered ${r.primary.display}`);
  return r;
}
const show = (q: string) => {
  const a = ask(q);
  return a.primary.unit ? `${a.primary.display} ${a.primary.unit}` : a.primary.display;
};
const val = (q: string) => ask(q).value!.toNumber();
const line = (q: string, label: string) => ask(q).lines?.find((l) => l.label === label)?.display;

describe('elements and compounds', () => {
  it.each([
    ['density of gold', '19.3 g/cm³', 'Gold · density'],
    ['melting point of iron', '1,538 °C', 'Iron · melting point'],
    ['atomic mass of carbon', '12.011 u', 'Carbon · atomic mass'],
    ['electronegativity of oxygen', '3.44', 'Oxygen · electronegativity'],
    ['boiling point of water', '100 °C', 'Water · boiling point'],
    ['molar mass of caffeine', '194.194 g/mol', 'Caffeine · molar mass'],
    ["What's the density of gold?", '19.3 g/cm³', 'Gold · density'],
    ['gold density', '19.3 g/cm³', 'Gold · density'],
    ["gold's density", '19.3 g/cm³', 'Gold · density'],
    ['atomic number of uranium', '92', 'Uranium · atomic number'],
    ['density of Fe', '7.874 g/cm³', 'Iron · density'],
    ['density of CO', '1.25 g/L', 'Carbon monoxide · density'],
    ['density of Co', '8.9 g/cm³', 'Cobalt · density'],
    ['molar mass of H2O', '18.015 g/mol', 'Water · molar mass'],
    ['boiling point of nitrogen', '−195.795 °C', 'Nitrogen · boiling point'],
    ['when was oxygen discovered', '1774', 'Oxygen · year discovered'],
    ['symbol of gold', 'Au', 'Gold · symbol'],
    ['formula of table salt', 'NaCl', 'Sodium chloride · formula'],
    ['state of bromine', 'liquid', 'Bromine · state at room temperature'],
  ])('%s → %s', (q, display, expression) => {
    const a = ask(q);
    expect(a.kind).toBe('reference');
    expect(show(q)).toBe(display);
    expect(a.expression).toBe(expression);
    expect(a.source?.url).toMatch(/^https:\/\/pubchem\.ncbi\.nlm\.nih\.gov\//);
  });

  it('gives kelvin alongside celsius and a numeric value', () => {
    expect(line('melting point of iron', 'In kelvin')).toBe('1,811 K');
    expect(val('melting point of iron')).toBe(1538);
    expect(val('density of gold')).toBe(19.3);
    expect(ask('density of gold').primary.plain).toBe('19.3');
  });

  it('electron configuration uses superscripts', () => {
    expect(show('electron configuration of iron')).toBe('[Ar] 3d⁶ 4s²');
  });

  it('gas densities are in g/L with a note', () => {
    const a = ask('density of oxygen');
    expect(a.primary.unit).toBe('g/L');
    expect(a.notes.join(' ')).toMatch(/0 °C and 1 atm/);
  });

  it('sublimation instead of melting', () => {
    expect(show('melting point of carbon')).toBe('sublimes at 3,642 °C');
    expect(show('melting point of carbon dioxide')).toBe('sublimes at −78.5 °C');
  });

  it('known entity, missing property → failure', () => {
    expect(failure('boiling point of astatine').error.message).toBe('No boiling point listed for Astatine');
    expect(failure('electronegativity of neon').error.message).toMatch(/No electronegativity listed for Neon/);
    expect(failure('population of gold').error.message).toMatch(/No population listed for Gold/);
  });

  it('mercury: element for chemistry, planet for astronomy', () => {
    expect(ask('density of mercury').expression).toBe('Mercury · density');
    expect(show('density of mercury')).toBe('13.534 g/cm³');
    expect(ask('density of mercury').notes.join(' ')).toMatch(/planet mercury/);
    expect(show('mass of mercury')).toBe('3.301 × 10²³ kg');
    expect(show('density of the planet mercury')).toBe('5.429 g/cm³');
  });
});

describe('space', () => {
  it('distance to mars: average plus the range', () => {
    const a = ask('distance to mars');
    expect(a.primary.display).toBe('225 million');
    expect(a.primary.unit).toBe('km');
    expect(a.value!.toNumber()).toBe(225e6);
    expect(line('distance to mars', 'Closest to Earth')).toBe('54.6 million km');
    expect(line('distance to mars', 'Farthest from Earth')).toBe('401 million km');
    expect(a.source?.url).toBe('https://nssdc.gsfc.nasa.gov/planetary/factsheet/');
  });

  it.each([
    ['radius of jupiter', '69,911 km'],
    ['mass of the moon', '7.346 × 10²² kg'],
    ['gravity on mars', '3.71 m/s²'],
    ['how far is the sun', '149.6 million km'],
    ['distance to proxima centauri', '4.2465 light years'],
    ['temperature of the sun', '5,772 K'],
    ['how far away is the moon', '384,400 km'],
    ['how many moons does jupiter have', '95'],
    ['orbital period of mars', '687 days'],
    ['how far is mars from the sun', '228 million km'],
    ['distance from earth to mars', '225 million km'],
    ['how big is jupiter', '69,911 km'],
    ['how hot is venus', '464 °C'],
    ['mass of the sun', '1.9885 × 10³⁰ kg'],
    ['distance to sirius', '8.6 light years'],
  ])('%s → %s', (q, display) => {
    expect(show(q)).toBe(display);
  });

  it('notes stay relevant to the property asked', () => {
    expect(ask('how far is the moon from earth').notes.join(' ')).not.toMatch(/temperature/);
    expect(ask('temperature of the moon').notes.join(' ')).toMatch(/−173 °C/);
    expect(ask('density of water').notes.join(' ')).not.toMatch(/Boils/);
  });

  it('gravity relative to Earth and light travel time', () => {
    expect(line('gravity on mars', 'Relative to Earth')).toBe('0.378 g');
    expect(line('how far is the sun', 'Light travel time')).toBe('8 min 19 s');
    expect(line('temperature of the sun', 'In Celsius')).toBe('5,499 °C');
  });
});

describe('countries', () => {
  it.each([
    ['population of japan', '124.5 million', 'Japan · population'],
    ['capital of france', 'Paris', 'France · capital'],
    ['area of canada', '9,984,670 km²', 'Canada · area'],
    ['gdp of germany', '$4.46 trillion', 'Germany · GDP (nominal)'],
    ['what is the capital of the uk', 'London', 'United Kingdom · capital'],
    ['population of the usa', '334.9 million', 'United States · population'],
    ['how many people live in india', '1.429 billion', 'India · population'],
    ['japan population', '124.5 million', 'Japan · population'],
    ['how big is canada', '9,984,670 km²', 'Canada · area'],
  ])('%s → %s', (q, display, expression) => {
    const a = ask(q);
    expect(show(q)).toBe(display);
    expect(a.expression).toBe(expression);
    expect(a.notes).toContain('Approximate; figures change yearly');
    expect(a.source?.url).toBe('https://data.worldbank.org/');
  });

  it('population value is numeric', () => {
    expect(val('population of japan')).toBe(124_500_000);
    expect(ask('population of japan').primary.plain).toBe('124500000');
  });
});

describe('nutrition', () => {
  it('calories in an apple: per 100 g plus a medium apple', () => {
    const a = ask('calories in an apple');
    expect(show('calories in an apple')).toBe('52 kcal');
    expect(a.expression).toBe('Apple · calories per 100 g');
    expect(line('calories in an apple', 'Per medium apple (182 g)')).toBe('95 kcal');
    expect(a.source?.url).toBe('https://fdc.nal.usda.gov/');
  });
  it.each([
    ['protein in eggs', '12.56 g', 'Egg · protein per 100 g'],
    ['nutrition of banana', '89 kcal', 'Banana · nutrition per 100 g'],
    ['how many calories in a banana', '89 kcal', 'Banana · calories per 100 g'],
    ['banana nutrition', '89 kcal', 'Banana · nutrition per 100 g'],
    ['fiber in strawberries', '2 g', 'Strawberries · fibre per 100 g'],
    ['how much sugar is in an orange', '9.35 g', 'Orange · sugar per 100 g'],
    ['calories in 100g of banana', '89 kcal', 'Banana · calories per 100 g'],
  ])('%s → %s', (q, display, expression) => {
    expect(show(q)).toBe(display);
    expect(ask(q).expression).toBe(expression);
  });
  it('per-serving line for protein', () => {
    expect(line('protein in eggs', 'Per large egg (50 g)')).toBe('6.3 g');
  });
});

describe('math constants and sequences', () => {
  it.each([
    ['golden ratio', '1.61803398874989484820458683437'],
    ["euler's constant", '0.577215664901532860606512090082'],
    ['euler mascheroni', '0.577215664901532860606512090082'],
    ['euler-mascheroni constant', '0.577215664901532860606512090082'],
    ["catalan's constant", '0.915965594177219015054603514932'],
    ["apery's constant", '1.20205690315959428539973816151'],
    ['feigenbaum constant', '4.66920160910299067185320382047'],
    ['value of pi', '3.14159265358979323846264338328'],
    ['pi to 20 digits', '3.1415926535897932385'],
    ['e to 10 decimal places', '2.7182818285'],
    ['value of sqrt 2', '1.41421356237309504880168872421'],
  ])('%s → %s', (q, display) => {
    expect(show(q)).toBe(display);
  });

  it('bare pi and e are left to the calculator', () => {
    expect(answerReference('pi')).toBeNull();
    expect(answerReference('e')).toBeNull();
  });

  it.each([
    ['first 10 primes', '2, 3, 5, 7, 11, 13, 17, 19, 23, 29'],
    ['first 10 fibonacci numbers', '0, 1, 1, 2, 3, 5, 8, 13, 21, 34'],
    ['first 5 squares', '1, 4, 9, 16, 25'],
    ['first 6 triangular numbers', '1, 3, 6, 10, 15, 21'],
    ['first 8 catalan numbers', '1, 1, 2, 5, 14, 42, 132, 429'],
    ['first five cubes', '1, 8, 27, 64, 125'],
    ['fibonacci sequence', '0, 1, 1, 2, 3, 5, 8, 13, 21, 34'],
    ['10th prime', '29'],
    ['the 10th fibonacci number', '55'],
    ['primes up to 30', '2, 3, 5, 7, 11, 13, 17, 19, 23, 29'],
    ['primes below 29', '2, 3, 5, 7, 11, 13, 17, 19, 23'],
  ])('%s → %s', (q, display) => {
    expect(show(q)).toBe(display);
  });

  it('extra CODATA constants', () => {
    expect(show('fine structure constant')).toBe('0.0072973525693');
    expect(show('bohr radius')).toBe('5.29177210903 × 10⁻¹¹ m');
  });
});

describe('arithmetic with data', () => {
  it('atomic mass of carbon times 2', () => {
    const a = ask('atomic mass of carbon times 2');
    expect(show('atomic mass of carbon times 2')).toBe('24.022 u');
    expect(a.value!.toNumber()).toBeCloseTo(24.022, 10);
    expect(a.lines?.[0]).toEqual({ label: 'Carbon · atomic mass', display: '12.011 u' });
  });
  it('2 * density of gold keeps the unit', () => {
    expect(show('2 * density of gold')).toBe('38.6 g/cm³');
  });
  it('ratios of like quantities are plain numbers', () => {
    expect(val('population of japan / population of france')).toBeCloseTo(124.5 / 68.2, 10);
    expect(ask('population of japan / population of france').primary.unit).toBeUndefined();
    expect(val('mass of earth / mass of moon')).toBeCloseTo(5.9722e24 / 7.346e22, 8);
    expect(show('mass of earth / mass of moon')).toBe('81.2987');
    expect(ask('mass of earth / mass of moon').notes.join(' ')).toMatch(/units \(kg\) cancel/);
  });
  it('mixed units: number plus a note', () => {
    const a = ask('density of gold * radius of jupiter');
    expect(a.primary.unit).toBeUndefined();
    expect(a.notes.join(' ')).toMatch(/Units:/);
  });
  it('sums keep the unit', () => {
    expect(show('mass of earth + mass of moon')).toBe('6.04566 × 10²⁴ kg');
  });
  it('unknown phrase inside an expression → null', () => {
    expect(answerReference('density of unobtainium * 2')).toBeNull();
    expect(answerReference('2 + 2')).toBeNull();
  });
});

describe('strictness', () => {
  it.each([
    'area of a circle radius 3',
    'area of a circle with radius 3',
    'area of a triangle base 4 height 5',
    'population of atlantis',
    'density of unobtainium',
    'mass of an electron',
    'speed of light',
    'distance between (1,2) and (4,6)',
    '5 km in miles',
    'what is 2 + 2',
    'period of a pendulum of length 2 m',
    'surface area of a sphere radius 2',
    'radius of a circle with area 10',
    'temperature of 300 K in celsius',
  ])('%s → null', (q) => {
    expect(answerReference(q)).toBeNull();
  });
});

describe('gate', () => {
  const accepted = [
    'density of gold', 'melting point of iron', 'atomic mass of carbon', 'electronegativity of oxygen', 'boiling point of water', 'molar mass of caffeine',
    'distance to mars', 'radius of jupiter', 'mass of the moon', 'gravity on mars', 'how far is the sun', 'distance to proxima centauri', 'temperature of the sun',
    'population of japan', 'capital of france', 'area of canada', 'gdp of germany', 'calories in an apple', 'protein in eggs', 'nutrition of banana',
    'golden ratio', "euler's constant", 'euler mascheroni', 'first 10 primes', 'atomic mass of carbon times 2', '2 * density of gold',
    'population of japan / population of france', 'mass of earth / mass of moon', 'how many moons does jupiter have', 'how big is canada',
    'how hot is venus', 'when was oxygen discovered', 'symbol of gold', 'formula of table salt', 'pi to 20 digits', 'value of pi', '10th prime',
    'fine structure constant', 'bohr radius', 'how many people live in india', 'fiber in strawberries', 'first five cubes', "catalan's constant",
    "apery's constant", 'feigenbaum constant', 'electron configuration of iron', 'banana nutrition', 'japan population', 'how long is a day on mars',
  ];
  it.each(accepted)('matches "%s"', (q) => {
    expect(MAYBE_REFERENCE.test(q)).toBe(true);
    expect(answerReference(q)?.ok).toBe(true);
  });
  it('does not match plain arithmetic', () => {
    expect(MAYBE_REFERENCE.test('2 + 2')).toBe(false);
    expect(MAYBE_REFERENCE.test('sin(30) * 4')).toBe(false);
  });
});

describe('lookup helper', () => {
  it('returns values for other modules', () => {
    expect(lookup('gold', 'density')).toMatchObject({ entity: 'Gold', kind: 'element', unit: 'g/cm³' });
    expect(lookup('gold', 'density')!.value!.toNumber()).toBe(19.3);
    expect(lookup('japan', 'population')!.value!.toNumber()).toBe(124_500_000);
    expect(lookup('atlantis', 'population')).toBeNull();
    expect(lookup('astatine', 'boiling point')).toBeNull();
  });
});

describe('data sanity', () => {
  it('118 elements numbered 1..118 with unique symbols', () => {
    expect(ELEMENTS).toHaveLength(118);
    ELEMENTS.forEach((e, i) => expect(e.z).toBe(i + 1));
    expect(new Set(ELEMENTS.map((e) => e.symbol)).size).toBe(118);
  });
  it('atomic masses roughly increase', () => {
    // Known inversions (Ar/K, Co/Ni, Te/I, Th/Pa, U/Np…) are small; no mass falls more than 4 u below the previous one.
    for (let i = 1; i < ELEMENTS.length; i++) expect(ELEMENTS[i]!.mass.toNumber()).toBeGreaterThan(ELEMENTS[i - 1]!.mass.toNumber() - 4);
    expect(ELEMENTS[0]!.mass.toNumber()).toBeCloseTo(1.008, 3);
  });
  it('element values are in plausible ranges', () => {
    for (const e of ELEMENTS) {
      if (e.en) expect(Number(e.en)).toBeGreaterThan(0.6), expect(Number(e.en)).toBeLessThanOrEqual(3.98);
      if (e.mp && e.bp) expect(Number(e.bp)).toBeGreaterThan(Number(e.mp));
      if (e.density && e.state !== 'gas') expect(Number(e.density)).toBeGreaterThan(0.5), expect(Number(e.density)).toBeLessThan(23);
      expect(e.config).toMatch(/^(?:\[(?:He|Ne|Ar|Kr|Xe|Rn)\] )?(?:\d[spdf]\d+ ?)+$/);
    }
    expect(ELEMENTS.filter((e) => e.state === 'gas')).toHaveLength(11);
    expect(ELEMENTS.find((e) => e.symbol === 'Os')!.density).toBe('22.59');
  });
  it('electron counts in configurations match the atomic number', () => {
    const core: Record<string, number> = { He: 2, Ne: 10, Ar: 18, Kr: 36, Xe: 54, Rn: 86 };
    for (const e of ELEMENTS) {
      const m = /^\[(\w+)\]/.exec(e.config);
      let n = m ? core[m[1]!]! : 0;
      for (const [, k] of e.config.matchAll(/\d[spdf](\d+)/g)) n += Number(k);
      expect(n, e.name).toBe(e.z);
    }
  });
  it('compounds: molar masses computed, unique formulas', () => {
    expect(COMPOUNDS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(COMPOUNDS.map((c) => c.formula)).size).toBe(COMPOUNDS.length);
    expect(COMPOUNDS.find((c) => c.formula === 'H2O')!.molarMass.toNumber()).toBeCloseTo(18.015, 3);
    for (const c of COMPOUNDS) if (c.mp && c.bp) expect(Number(c.bp)).toBeGreaterThan(Number(c.mp));
  });
  it('bodies, countries, foods', () => {
    expect(BODIES.filter((b) => b.type === 'planet')).toHaveLength(8);
    expect(BODIES.filter((b) => b.type === 'moon').length).toBeGreaterThanOrEqual(11);
    expect(BODIES.filter((b) => b.type === 'star').length).toBeGreaterThanOrEqual(11);
    expect(COUNTRIES.length).toBeGreaterThanOrEqual(100);
    expect(new Set(COUNTRIES.map((c) => c.name)).size).toBe(COUNTRIES.length);
    for (const c of COUNTRIES) expect(c.population).toBeGreaterThan(100_000);
    expect(FOODS.length).toBeGreaterThanOrEqual(50);
    for (const f of FOODS.filter((x) => x.name !== 'Beer')) { // beer's energy is mostly alcohol (7 kcal/g)
      // Energy roughly matches 4/9/4 kcal per gram (within 25%, or 20 kcal for low values: USDA uses food-specific factors).
      const est = 4 * f.protein + 9 * f.fat + 4 * f.carbs;
      expect(Math.abs(est - f.kcal), f.name).toBeLessThanOrEqual(Math.max(20, 0.25 * f.kcal));
    }
  });
  it('no alias names two different entities of the same kind', () => {
    const seen = new Map<string, string>();
    const check = (kind: string, name: string, aliases: string[]) => {
      for (const a of [name, ...aliases].map((x) => x.toLowerCase())) {
        const k = `${kind}:${a}`;
        expect(seen.get(k) ?? name, `${a}`).toBe(name);
        seen.set(k, name);
      }
    };
    COMPOUNDS.forEach((c) => check('compound', c.name, c.aliases));
    BODIES.forEach((b) => check('body', b.name, b.aliases));
    COUNTRIES.forEach((c) => check('country', c.name, c.aliases));
    FOODS.forEach((f) => check('food', f.name, f.aliases));
  });
  it('math constants and sequences', () => {
    for (const c of MATH_CONSTANTS) expect(c.value.replace('.', '').length).toBeGreaterThanOrEqual(31);
    expect(SEQUENCES.find((s) => s.key === 'primes')!.terms(1000)[999]).toBe(7919n);
    expect(SEQUENCES.find((s) => s.key === 'catalan')!.nth(10)).toBe(16796n);
  });
  it('physical constants extend science-engine', () => {
    expect(PHYSICAL_CONSTANTS.find((c) => c.key === 'alpha')).toBeTruthy();
    expect(PHYSICAL_CONSTANTS.find((c) => c.key === 'c')).toBeTruthy();
    expect(new Set(PHYSICAL_CONSTANTS.map((c) => c.key)).size).toBe(PHYSICAL_CONSTANTS.length);
  });
});
