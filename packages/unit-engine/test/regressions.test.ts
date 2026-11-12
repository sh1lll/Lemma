import { createSession } from '@lemma/math-core';
import { describe, expect, it } from 'vitest';
import { convert } from '../src';

const run = (input: string) => {
  const r = convert(input, createSession());
  if (!r) throw new Error(`"${input}" not recognised as a conversion`);
  if (!r.ok) throw new Error(`"${input}" failed: ${r.error.message}`);
  return r.results.map((x) => `${x.formatted.plain} ${x.unit.id}`).join(', ');
};

describe('unit conversion regressions', () => {
  it.each([
    ['5 in to cm', '12.7 cm'], // adjacent connectors "in to" used to swallow each other
    ['5 inches into cm', '12.7 cm'],
    ['0 k to c', '-273.15 c'], // "k" is kelvin next to a temperature
    ['300 k to f', '80.33 f'],
    ['100 c to f and k', '212 f, 373.15 k'],
    ['5k to miles', '3.10685596119 mi'], // …and kilometres next to a length
    ['10 m^2 to ft^2', '107.639104167 ft2'],
    ['10 m² to ft²', '107.639104167 ft2'],
    ['2^3 m to ft', '26.2467191601 ft'],
    ['100 km per hour in mph', '62.1371192237 mph'],
    ['60 miles an hour to km/h', '96.56064 kph'],
    ['1 cubic yard to m3', '0.764554857984 m3'],
    ['1 imperial gallon to liters', '4.54609 l'],
  ])('%s → %s', (q, want) => expect(run(q)).toBe(want));

  it('still refuses temperatures below absolute zero in kelvin', () => {
    expect(convert('-1 k to c', createSession())?.ok).toBe(false);
  });

  it.each([
    // compound amounts: each part is converted and summed
    ['5 feet 11 inches to cm', '180.34 cm'],
    ['5\'11" to cm', '180.34 cm'],
    ['5 foot 11 in cm', '180.34 cm'], // a trailing bare number after feet is inches
    ['3 hours 20 minutes to minutes', '200 min'],
    ['2 lb 3 oz in kg', '0.992233309375 kg'],
    ['1 hr 30 min in seconds', '5400 s'],
    ['1 hour and 30 minutes to hours', '1.5 h'],
    // astronomical lengths
    // 9,460,730,472,580.8 km, rounded to the nearest km (the whole-number part is never cut short).
    ['1 light year in km', '9460730472581 km'],
    ['1 parsec in light years', '3.26156377717 ly'],
    ['1 au in km', '149597870.7 km'],
    // derived units
    ['9.8 m/s^2 to ft/s^2', '32.1522309711 ft/s²'],
    ['1 eV s to J s', '1.602176634e-19 J·s'],
    ['100 km/h to m/s', '27.7777777778 mps'],
    ['30 miles per gallon to km/l', '12.7543112229 km/L'],
    // fuel economy ↔ consumption are reciprocal
    ['30 mpg to l/100km', '7.84048611111 L/100 km'],
    ['8 L/100 km to mpg', '29.4018229167 mpg'],
    // "days in a year" asks how many days a year has, like "how many days in a year"
    ['days in a year', '365.2425 day'],
    ['how many days in a month', '30.436875 day'],
    ['km in a mile', '1.609344 km'],
  ])('%s → %s', (q, want) => expect(run(q)).toBe(want));

  it('keeps "10 m2" as square metres rather than "10 m and 2 cm"', () => {
    expect(run('10 m2 to ft2')).toBe('107.639104167 ft2');
  });

  it('explains inverse units and refuses 0 mpg', () => {
    const r = convert('30 mpg to l/100km', createSession());
    expect(r?.ok && r.notes.join(' ')).toMatch(/inverse units/);
    const z = convert('0 mpg to l/100km', createSession());
    expect(z?.ok).toBe(false);
  });

  it('says calendar months and years vary', () => {
    const r = convert('how many days in a month', createSession());
    expect(r?.ok && r.notes.join(' ')).toMatch(/28–31 days/);
  });
});
