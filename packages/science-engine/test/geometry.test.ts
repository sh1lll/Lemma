import { describe, expect, it } from 'vitest';
import { solveTriangle } from '../src';
import { ask, expectNeed, failure, line, show, val } from './helpers';

const PI = Math.PI;

describe('2D shapes', () => {
  it.each([
    ['area of circle radius 5', 25 * PI, '25π ≈ 78.5398'],
    ['area of a circle with r=5', 25 * PI, '25π ≈ 78.5398'],
    ['area of a circle with diameter 10', 25 * PI, '25π ≈ 78.5398'],
    ['circumference of circle diameter 10', 10 * PI, '10π ≈ 31.4159'],
    ['area of square side 4', 16, '16'],
    ['perimeter of a square with side 4', 16, '16'],
    ['area of rectangle 5 by 3', 15, '15'],
    ['perimeter of a 5 by 3 rectangle', 16, '16'],
    ['area of rectangle length 5 width 3', 15, '15'],
    ['area of triangle base 4 height 3', 6, '6'],
    ['area of trapezoid with bases 3 and 5 and height 4', 16, '16'],
    ['area of parallelogram base 5 height 3', 15, '15'],
    ['area of ellipse semi-axes 5 and 3', 15 * PI, '15π ≈ 47.1239'],
    // (3√3/2)s² for a hexagon
    ['area of regular hexagon side 2', (3 * Math.sqrt(3) / 2) * 4, '10.3923'],
    ['area of a regular polygon with 7 sides of length 3', (7 * 9) / (4 * Math.tan(PI / 7)), '32.7052'],
    ['perimeter of regular octagon with side 2', 16, '16'],
  ])('%s', (q, expected, display) => {
    expect(val(q)).toBeCloseTo(expected, 4);
    expect(show(q)).toBe(display);
    expect(ask(q).kind).toBe('geometry');
  });

  it('gives the formula and companion measures', () => {
    expect(line('area of circle radius 5', 'Formula')).toBe('A = πr²');
    expect(line('area of circle radius 5', 'Circumference')).toBe('10π ≈ 31.4159');
    expect(line('area of square side 4', 'Diagonal')).toBe('4√2 ≈ 5.65685');
  });

  it('carries units through', () => {
    expect(ask('area of circle radius 5 cm').primary.unit).toBe('cm²');
    expect(ask('volume of cube side 3 m').primary.unit).toBe('m³');
    expect(failure('area of rectangle 5 m by 3 cm').error.message).toMatch(/Mixed units/);
  });

  it('ellipse perimeter is flagged as an approximation', () => {
    expect(ask('perimeter of ellipse semi-axes 5 and 3').notes.join(' ')).toMatch(/Ramanujan/);
    expect(val('perimeter of ellipse semi-axes 5 and 3')).toBeCloseTo(25.527, 3);
  });

  it('asks for missing or ambiguous dimensions', () => {
    expectNeed('area of circle 5', /radius or the diameter/);
    expectNeed('area of a circle', /radius/);
    expectNeed('area of rectangle length 5', /width/);
    expectNeed('area of trapezoid with bases 3 and 5', /height/);
  });
});

describe('3D solids', () => {
  it.each([
    ['volume of sphere radius 5', (4 / 3) * PI * 125, '500π/3 ≈ 523.599'],
    ['surface area of sphere radius 5', 100 * PI, '100π ≈ 314.159'],
    ['volume of cylinder radius 3 height 5', 45 * PI, '45π ≈ 141.372'],
    ['surface area of cylinder radius 3 height 5', 48 * PI, '48π ≈ 150.796'],
    ['volume of cone radius 3 height 4', 12 * PI, '12π ≈ 37.6991'],
    ['surface area of cone radius 3 height 4', 24 * PI, '24π ≈ 75.3982'],
    ['volume of cube side 3', 27, '27'],
    ['surface area of cube side 3', 54, '54'],
    ['volume of box 2 by 3 by 4', 24, '24'],
    ['surface area of rectangular prism 2 by 3 by 4', 52, '52'],
    ['volume of pyramid base 4 height 6', 32, '32'],
  ])('%s', (q, expected, display) => {
    expect(val(q)).toBeCloseTo(expected, 3);
    expect(show(q)).toBe(display);
  });

  it('asks for missing dimensions', () => {
    expectNeed('volume of cylinder radius 3', /height/);
    expectNeed('volume of a sphere', /radius/);
  });
});

describe('Pythagoras and coordinates', () => {
  it.each([
    ['hypotenuse of 3 and 4', 5, '5'],
    ['hypotenuse of 1 and 1', Math.SQRT2, '√2 ≈ 1.41421'],
    ['hypotenuse with legs 5 and 12', 13, '13'],
    ['leg of a right triangle with hypotenuse 13 and leg 5', 12, '12'],
    ['distance between (1,2) and (4,6)', 5, '5'],
    ['distance from (0, 0) to (1, 1)', Math.SQRT2, '√2 ≈ 1.41421'],
    ['slope of (1,2) and (3,6)', 2, '2'],
    ['slope between (0,0) and (2,1)', 0.5, '1/2'],
  ])('%s', (q, expected, display) => {
    expect(val(q)).toBeCloseTo(expected, 6);
    expect(show(q)).toBe(display);
  });

  it('midpoint and line equations', () => {
    expect(show('midpoint of (1,2) and (3,4)')).toBe('(2, 3)');
    expect(show('line through (1,2) and (3,6)')).toBe('y = 2x');
    expect(show('equation of the line through (0,1) and (2,2)')).toBe('y = (1/2)x + 1');
    expect(line('equation of the line through (0,1) and (2,2)', 'Standard form')).toBe('x − 2y = −2');
    expect(show('line through (2,1) and (2,5)')).toBe('x = 2');
    expect(failure('slope of (2,1) and (2,5)').error.message).toMatch(/vertical/);
  });

  it('rejects an impossible leg', () => {
    expect(failure('other leg with hypotenuse 5 and leg 7').error.message).toMatch(/longer/);
  });
});

describe('triangle solver', () => {
  it('SSS: 3-4-5 triangle angles are 36.87°, 53.13°, 90°', () => {
    const q = 'angles of a triangle with sides 3, 4, 5';
    expect(show(q)).toBe('A = 36.87°, B = 53.13°, C = 90°');
    expect(line(q, 'Angle A')).toBe('36.8699°');
    expect(val('area of triangle with sides 3, 4, 5')).toBe(6); // Heron, exact
    expect(val('perimeter of triangle with sides 3, 4, 5')).toBe(12);
  });

  it('SAS by notation and in words', () => {
    // c² = 5² + 7² − 2·5·7·cos60° = 39
    expect(line('solve triangle a=5 b=7 C=60', 'Side c')).toBe(String(Number(Math.sqrt(39).toPrecision(6))));
    expect(line('triangle with sides 5 and 7 and included angle 60', 'Side c')).toBe(String(Number(Math.sqrt(39).toPrecision(6))));
  });

  it('ASA / AAS', () => {
    // 30-60-90 with hypotenuse 10: legs 5 and 5√3
    expect(show('triangle A=30 B=60 c=10')).toBe(`a = 5, b = ${(5 * Math.sqrt(3)).toPrecision(6)}, C = 90°`);
    expect(show('triangle with angles 30 and 60 and included side 10')).toBe(`a = 5, b = ${(5 * Math.sqrt(3)).toPrecision(6)}, C = 90°`);
    expect(line('triangle A=40 B=60 a=10', 'Angle C')).toBe('80°');
  });

  it('SSA: reports the ambiguous case instead of guessing', () => {
    const a = ask('triangle a=7 b=10 A=30');
    expect(a.primary.display).toBe('Two triangles fit');
    expect(a.table!.rows).toHaveLength(2);
    // sin B = 10·sin30°/7 → B = 45.58° or 134.42°
    expect(a.table!.rows.map((r) => r[5])).toEqual(['45.58°', '134.42°']);
    expect(a.notes.join(' ')).toMatch(/Ambiguous case/);
    expect(line('triangle a=12 b=10 A=30', 'Angle B')).toBe('24.6243°');
    expect(failure('triangle a=3 b=10 A=30').error.message).toMatch(/No triangle/);
  });

  it('asks or refuses when the parts do not fix a triangle', () => {
    expectNeed('triangle with angles 30 and 60 and side 10', /between the two angles/);
    expect(failure('triangle A=30 B=60 C=90').error.message).toMatch(/at least one side/);
    expect(failure('triangle sides 1, 2, 5').error.message).toMatch(/triangle inequality/);
    expectNeed('area of a triangle', /base and height/);
  });

  it('solveTriangle is usable directly', () => {
    const r = solveTriangle({ a: 3, b: 4, c: 5 });
    expect(typeof r).not.toBe('string');
    if (typeof r !== 'string') expect(r[0]!.C).toBeCloseTo(90, 9);
  });
});
