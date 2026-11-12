import { describe, expect, it } from 'vitest';
import { answerScience, CONSTANTS } from '../src';
import { ask, expectNeed, failure, line, show, val } from './helpers';

describe('physical constants (CODATA 2018)', () => {
  it.each([
    ['speed of light', '299792458', 'm/s'],
    ['what is the planck constant', '6.62607015e-34', 'J·s'],
    ['elementary charge', '1.602176634e-19', 'C'],
    ["avogadro's number", '6.02214076e23', 'mol⁻¹'],
    ['boltzmann constant', '1.380649e-23', 'J/K'],
    ['gas constant', '8.31446261815324', 'J/(mol·K)'],
    ['gravitational constant', '6.6743e-11', 'm³/(kg·s²)'],
    ['standard gravity', '9.80665', 'm/s²'],
    ['electron mass', '9.1093837015e-31', 'kg'],
    ['proton mass', '1.67262192369e-27', 'kg'],
    ['neutron mass', '1.67492749804e-27', 'kg'],
    ['vacuum permittivity', '8.8541878128e-12', 'F/m'],
    ['permeability of free space', '0.00000125663706212', 'N/A²'],
    ['standard atmosphere', '101325', 'Pa'],
    ['rydberg constant', '10973731.56816', 'm⁻¹'],
  ])('%s = %s %s', (q, value, unit) => {
    const a = ask(q);
    expect(a.value!.eq(value)).toBe(true);
    expect(a.primary.unit).toBe(unit);
  });

  it('derived exact constants keep full precision and show truncated digits', () => {
    expect(ask('reduced planck constant').value!.toSignificantDigits(10, 1).eq('1.054571817e-34')).toBe(true);
    expect(show('reduced planck constant')).toBe('1.054571817… × 10⁻³⁴');
    expect(ask('faraday constant').value!.toSignificantDigits(10, 1).eq('96485.33212')).toBe(true);
    expect(ask('stefan-boltzmann constant').value!.eq('5.670374419e-8')).toBe(true);
  });

  it('notes exactness and uncertainty', () => {
    expect(ask('speed of light').notes.join(' ')).toMatch(/Exact/);
    expect(line('value of G', 'Uncertainty')).toBe('1.5 × 10⁻¹⁵ m³/(kg·s²)');
    expect(ask('electron mass').notes.join(' ')).toMatch(/uncertainty 2.8 × 10⁻⁴⁰/);
  });

  it('accepts symbols only when asked for, and not e (Euler’s number)', () => {
    expect(show('what is c')).toBe('299,792,458');
    expect(ask('value of G').expression).toMatch(/gravitation/);
    expect(answerScience('what is e')).toBeNull();
    expect(answerScience('c')).toBeNull();
  });

  it('registers all requested constants', () => {
    expect(CONSTANTS.map((k) => k.key).sort()).toEqual(['F', 'G', 'NA', 'R', 'Rinf', 'atm', 'c', 'e', 'eps0', 'g0', 'h', 'hbar', 'kB', 'me', 'mn', 'mp', 'mu0', 'sigma'].sort());
  });
});

describe('formula solvers', () => {
  it.each([
    ['kinetic energy of 2 kg at 3 m/s', 9, 'J'],
    ['kinetic energy of a 1000 kg car at 72 km/h', 200000, 'J'],
    ['speed of 2 kg object with kinetic energy 100 J', 10, 'm/s'],
    ['KE=50 v=5 find m', 4, 'kg'],
    ['potential energy of 5 kg at 10 m', 490.3325, 'J'],
    ['weight of 70 kg', 686.4655, 'N'],
    ['mass of an object weighing 686 N', 686 / 9.80665, 'kg'],
    ['force to accelerate 1000 kg at 2 m/s²', 2000, 'N'],
    ['acceleration of 10 kg pushed with 50 N', 5, 'm/s²'],
    ['F=ma with m=3 kg and a=4 m/s^2', 12, 'N'],
    ['momentum of 3 kg at 4 m/s', 12, 'kg·m/s'],
    ['wavelength of 500 Hz wave at 340 m/s', 0.68, 'm'],
    ['frequency of a wave with speed 340 m/s and wavelength 2 m', 170, 'Hz'],
    ['density of 10 kg in 2 m³', 5, 'kg/m³'],
    ['mass with density 1000 kg/m3 and volume 2 m3', 2000, 'kg'],
    ['volume of 500 g with density 2.5 g/cm3', 0.0002, 'm³'],
  ])('%s → %d %s', (q, expected, unit) => {
    expect(val(q)).toBeCloseTo(expected, 4);
    expect(ask(q).primary.unit).toBe(unit);
    expect(ask(q).kind).toBe('physics');
  });

  it('shows the formula used and states g', () => {
    expect(line('kinetic energy of 2 kg at 3 m/s', 'Formula')).toBe('KE = ½mv²');
    expect(line('speed of 2 kg object with kinetic energy 100 J', 'Formula')).toBe('v = √(2·KE / m)');
    expect(ask('weight of 70 kg').notes.join(' ')).toMatch(/9\.80665/);
  });

  it('uses c for light', () => {
    // f = c / λ = 299792458 / 500e-9
    expect(val('frequency of light with wavelength 500 nm')).toBeCloseTo(5.99584916e14, -6);
  });

  it('asks for a missing input instead of guessing', () => {
    expectNeed('kinetic energy of a 2 kg ball', /speed/);
    expectNeed('momentum of a 3 kg ball', /speed/);
    expectNeed('density of 10 kg', /volume/);
  });

  it('rejects a unit of the wrong kind', () => {
    expect(failure('kinetic energy with m = 5 m/s and v = 2 m/s').error.message).toMatch(/isn't a mass/);
  });
});

describe("Ohm's law and electrical power", () => {
  it.each([
    ['current through a 4 ohm resistor at 12 V', 3, 'A'],
    ['V=12 R=4', 3, 'A'],
    ['voltage across 220 Ω with 0.5 A', 110, 'V'],
    ['resistance for 9 V and 3 mA', 3000, 'Ω'],
    ['power at 12 V and 2 A', 24, 'W'],
    ['power with 2 A through 10 Ω', 40, 'W'],
    ['power of 12 V across 6 ohms', 24, 'W'],
    ['current drawn by a 60 W bulb at 120 V', 0.5, 'A'],
    ['voltage for 100 W through 4 ohm', 20, 'V'],
  ])('%s → %d %s', (q, expected, unit) => {
    expect(val(q)).toBeCloseTo(expected, 6);
    expect(ask(q).primary.unit).toBe(unit);
  });

  it('fills in the rest of the circuit', () => {
    expect(line('V=12 R=4', 'Power')).toBe('36 W');
    expect(line('power with 2 A through 10 Ω', 'Formula')).toMatch(/P = I²R/);
  });

  it('asks for a second value', () => {
    expectNeed('current at 12 V', /two of voltage, current, resistance and power/);
  });
});

describe('kinematics (SUVAT)', () => {
  it.each([
    ['car accelerates from rest at 3 m/s² for 5 s', 15, 'm/s'],
    ['how far does a car go accelerating from rest at 3 m/s² for 5 s', 37.5, 'm'],
    ['acceleration from 0 to 100 km/h in 5 s', 100 / 3.6 / 5, 'm/s²'],
    ['ball dropped from 20 m how long to hit the ground', Math.sqrt((2 * 20) / 9.80665), 's'],
    ['car at 20 m/s brakes to a stop in 4 s, how far', 40, 'm'],
    ['how far does a car go at 20 m/s in 10 s', 200, 'm'],
    ['u=0 a=2 t=3', 6, 'm/s'],
    ['object accelerates at 2 m/s² from 10 m/s over 50 m final velocity', Math.sqrt(300), 'm/s'],
    ['s=100 u=0 v=20 find time', 10, 's'],
    ['car decelerates at 5 m/s² from 30 m/s to a stop, how far', 90, 'm'],
  ])('%s', (q, expected, unit) => {
    expect(val(q)).toBeCloseTo(expected, 4);
    expect(ask(q).primary.unit).toBe(unit);
  });

  it('lists all five quantities', () => {
    const q = 'car accelerates from rest at 3 m/s² for 5 s';
    expect(line(q, 'displacement (s)')).toBe('37.5 m');
    expect(line(q, 'Formula')).toMatch(/v = u \+ at/);
  });

  it('asks which velocity is meant, or what is missing', () => {
    expectNeed('car accelerates at 2 m/s² at 10 m/s', /initial or the final velocity/);
    expectNeed('car accelerates from rest at 3 m/s²', /three of s, u, v, a, t/);
  });
});

describe('projectile motion', () => {
  // R = v² sin2θ / g, H = v² sin²θ / 2g, T = 2v sinθ / g with g = 9.80665
  const g = 9.80665;
  it('level ground', () => {
    const q = 'projectile at 20 m/s at 45°';
    expect(val(q)).toBeCloseTo(400 / g, 4);
    expect(ask(q).primary.unit).toBe('m');
    expect(line(q, 'Max height')).toBe(`${(400 * 0.5 / (2 * g)).toPrecision(6)} m`);
    expect(line(q, 'Time of flight')).toBe(`${((2 * 20 * Math.SQRT1_2) / g).toPrecision(6)} s`);
    expect(ask(q).notes.join(' ')).toMatch(/9\.80665/);
  });

  it('answers the quantity asked for', () => {
    expect(val('ball kicked at 20 m/s at 30 degrees max height')).toBeCloseTo((400 * 0.25) / (2 * g), 4);
    expect(val('time of flight of a projectile launched at 20 m/s at 30°')).toBeCloseTo((2 * 20 * 0.5) / g, 4);
    expect(val('ball thrown straight up at 20 m/s how high')).toBeCloseTo(400 / (2 * g), 4);
  });

  it('launch from a height', () => {
    const vy = 7.5;
    const T = (vy + Math.sqrt(vy * vy + 2 * g * 10)) / g;
    expect(val('ball thrown at 15 m/s at 30° from a height of 10 m')).toBeCloseTo(15 * Math.cos(Math.PI / 6) * T, 3);
  });

  it('needs the angle', () => {
    expectNeed('projectile at 20 m/s', /angle/);
  });
});
