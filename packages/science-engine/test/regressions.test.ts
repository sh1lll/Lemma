import { describe, expect, it } from 'vitest';
import { answerScience } from '../src';
import { ask, failure, line, show } from './helpers';

describe('science regressions', () => {
  it('leaves "square root" / "cube root" / "square 5" to the calculator', () => {
    for (const q of ['square root of 16', 'what is the square root of 81', 'the cube root of 27', 'square 5', 'the square of 5', 'what is 5 times the square root of 4']) {
      expect(answerScience(q), q).toBeNull();
    }
    expect(show('area of square side 4')).toBe('16');
    expect(show('volume of cube side 3')).toBe('27');
    expect(show('cube with edge 2')).toBe('8');
  });

  it('includes water autoionization for very dilute strong acids and bases', () => {
    expect(show('pH of 1e-8 M HCl')).toBe('6.9783'); // not 8: an acid can't make water basic
    expect(show('pH of 1e-9 M NaOH')).toBe('7.0022');
    expect(show('pH of 0.01 M HCl')).toBe('2');
    expect(line('pH of 0.1 M NaOH', 'pH')).toBe('13');
  });

  it('refuses division by zero instead of printing Infinity', () => {
    expect(failure('density mass 10 kg volume 0 m3').error.message).toMatch(/divide by zero/);
  });

  it('does not read "current time" as an Ohm\'s-law question', () => {
    expect(answerScience('current time')).toBeNull();
  });
});

describe('constants in other units', () => {
  it.each([
    ['speed of light in km/h', '1,079,252,848.8', 'km/h'],
    ['c in km/h', '1,079,252,848.8', 'km/h'],
    ['g in ft/s^2', '32.1740485564', 'ft/s²'],
    ['planck constant in eV s', '4.13566769692 × 10⁻¹⁵', 'eV·s'],
    ['h in eV s', '4.13566769692 × 10⁻¹⁵', 'eV·s'],
    ['boltzmann constant in eV/K', '0.0000861733326215', 'eV/K'],
    ['electron mass in g', '9.1093837015 × 10⁻²⁸', 'g'],
  ])('%s → %s %s', (q, display, unit) => {
    const a = ask(q);
    expect(a.primary.display).toBe(display);
    expect(a.primary.unit).toBe(unit);
  });

  it('refuses a named constant in a unit of the wrong kind', () => {
    expect(failure('speed of light in kg').error.message).toMatch(/can't be expressed in kg/);
  });

  it('leaves unit symbols that only look like constants to the unit converter', () => {
    for (const q of ['c to f', '100 c to f', 'g in kg', 'h in min', 'speed of light in vacuum']) {
      const r = answerScience(q);
      if (q === 'speed of light in vacuum') expect(r && r.ok && r.primary.display).toBe('299,792,458');
      else expect(r, q).toBeNull();
    }
  });
});
