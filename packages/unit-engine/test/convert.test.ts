import { createSession, D } from '@lemma/math-core';
import { describe, expect, it } from 'vitest';
import { convert } from '../src';

const run = (input: string) => {
  const r = convert(input, createSession());
  if (!r) throw new Error(`"${input}" not recognised as a conversion`);
  if (!r.ok) throw new Error(`"${input}" failed: ${r.error.message}`);
  return r.results.map((x) => `${x.formatted.plain} ${x.unit.id}`).join(', ');
};

describe('unit conversion', () => {
  it.each([
    ['Convert 50 miles to kilometers', '80.4672 km'],
    ['8.5 miles in km', '13.679424 km'],
    ['100 c to f', '212 f'],
    ['98.6 °F to celsius', '37 c'],
    ['0 kelvin in celsius', '-273.15 c'],
    ['how many feet in a mile', '5280 ft'],
    ['how many cups are in a gallon?', '16 cup'],
    ['3 cups to ml', '709.7647095 ml'],
    ['5 ft in in', '60 in'],
    ['60 mph to km/h', '96.56064 kph'],
    ['1 gb to mb', '1000 mb'],
    ['1 gib in mib', '1024 mib'],
    ['2500 sq ft to m2', '232.2576 m2'],
    ['180 degrees to radians', '3.14159265359 rad'],
    ['1 kwh to kj', '3600 kj'],
    ['10 kg to lb, oz', '22.0462262185 lb, 352.739619496 oz'],
    ['half a kilometer to m', '500 m'],
    ['50km to mi', '31.0685596119 mi'],
  ])('%s → %s', (input, expected) => {
    expect(run(input)).toBe(expected);
  });

  it('ignores ordinary math', () => {
    expect(convert('5 + 5', createSession())).toBeNull();
    expect(convert('20% of 450', createSession())).toBeNull();
  });

  it('rejects incompatible dimensions explicitly', () => {
    const r = convert('5 kg to meters', createSession());
    expect(r?.ok).toBe(false);
  });

  it('uses the previous answer', () => {
    const s = createSession();
    s.ans = new D(2);
    const r = convert('that many miles to km', s);
    expect(r && r.ok && r.results[0]!.formatted.plain).toBe('3.218688');
  });
});
