import { describe, expect, it } from 'vitest';
import { answerScience, LOOKS_LIKE_SCIENCE } from '../src';

const SUPPORTED = [
  '255 in hex', '0xff in decimal', '1010 binary to decimal', '0b1010', 'convert 100 to base 7', '42 in binary', '0o17 to decimal',
  'molar mass of Ca(OH)2', 'CuSO4*5H2O molar mass', 'moles in 10 g of NaCl', 'grams in 2 mol of H2O', 'molecules in 1 g of water',
  'balance Fe + O2 -> Fe2O3', 'C3H8 + O2 → CO2 + H2O', 'pH of 1e-3 M H+', '[H+] at pH 4.5', 'molarity of 0.5 mol in 2 L',
  'dilute 50 mL of 2 M to 0.5 M', 'how much 12 M HCl to make 1 L of 1 M', 'c1=2 v1=50 mL c2=0.5', 'volume of 1 mol of gas at STP',
  'atomic number of iron', 'what is Fe', 'Fe', 'gold', 'atomic mass of gold', 'element 26',
  'speed of light', 'planck constant', 'what is c', 'kinetic energy of 2 kg at 3 m/s', 'weight of 70 kg', 'V=12 R=4', 'u=0 a=2 t=3',
  'momentum of 3 kg at 4 m/s', 'wavelength of 500 Hz wave at 340 m/s', 'density of 10 kg in 2 m³', 'projectile at 20 m/s at 45°',
  'area of circle radius 5', 'volume of box 2 by 3 by 4', 'hypotenuse of 3 and 4', 'distance between (1,2) and (4,6)',
  'midpoint of (1,2) and (3,4)', 'triangle a=7 b=10 A=30', 'solve triangle a=5 b=7 C=60',
];

describe('routing', () => {
  it.each(['5 + 5', '20% of 450', '50 miles to km', 'sqrt 2', 'hello', '', '   ', 'what is e', '3 kg to lb', 'x = 5'])('“%s” is not a science question', (q) => {
    expect(answerScience(q)).toBeNull();
  });

  it.each(['5 + 5', '20% of 450', '50 miles to km', 'sqrt 2'])('pre-check skips “%s”', (q) => {
    expect(LOOKS_LIKE_SCIENCE.test(q)).toBe(false);
  });

  it.each(SUPPORTED)('pre-check and engine both accept “%s”', (q) => {
    expect(LOOKS_LIKE_SCIENCE.test(q)).toBe(true);
    const r = answerScience(q);
    expect(r?.ok).toBe(true);
  });

  it('uses the four kinds, restates the question and keeps the input', () => {
    const kinds = new Set(SUPPORTED.map((q) => answerScience(q)!.kind));
    expect([...kinds].sort()).toEqual(['bases', 'chemistry', 'geometry', 'physics']);
    const r = answerScience('molar mass of H2O ?');
    expect(r?.ok && r.input).toBe('molar mass of H2O ?');
    expect(r?.ok && r.expression).toMatch(/H₂O/);
  });

  it('answers each question well under 5 ms', { retry: 2 }, () => {
    for (const q of SUPPORTED) answerScience(q); // warm up
    for (const q of SUPPORTED) {
      const t0 = performance.now();
      for (let i = 0; i < 5; i++) answerScience(q);
      expect((performance.now() - t0) / 5, q).toBeLessThan(5);
    }
  });
});
