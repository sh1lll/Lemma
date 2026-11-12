import type { Answer } from '@lemma/math-core';
import { describe, expect, it } from 'vitest';
import { answerShape } from '../src';

const PI = Math.PI;
const ask = (q: string): Answer => {
  const r = answerShape(q);
  if (!r) throw new Error(`null for "${q}"`);
  if (!r.ok) throw new Error(`error for "${q}": ${r.error.message}`);
  return r;
};
/** The decimal value shown in the primary display (after any exact form). */
const num = (a: Answer) => Number(a.primary.plain.replace(/,/g, ''));
const line = (a: Answer, re: RegExp) => a.lines?.find((l) => re.test(l.label))?.display ?? '';
const lineNum = (a: Answer, re: RegExp) => {
  const d = line(a, re);
  const m = /(?:≈|=)\s*(−?[\d,.]+)[^=≈]*$/.exec(d) ?? /^(−?[\d,.]+)/.exec(d);
  return m ? Number(m[1]!.replace(/,/g, '').replace('−', '-')) : NaN;
};

type Case = [q: string, expected: number, tol?: number];
const cases: Case[] = [];
const add = (q: string, e: number, tol?: number) => cases.push([q, e, tol]);

// --- circles and parts ---
for (const r of [1, 2.5, 3, 7, 10]) {
  add(`area of a circle radius ${r}`, PI * r * r);
  add(`circumference of a circle with radius ${r} cm`, 2 * PI * r);
  add(`circle diameter ${2 * r} area`, PI * r * r);
  add(`circle area ${(PI * r * r).toFixed(6)}, radius?`, r, 1e-6);
  add(`sector radius ${r} angle 60 degrees area`, (PI * r * r) / 6);
  add(`arc length radius ${r} central angle 90°`, (PI * r) / 2);
}
add('circle circumference 31.4 radius?', 31.4 / (2 * PI));
add('chord length radius 5 central angle 60', 5);
add('chord 8 in a circle radius 5, distance from the centre to the chord?', 3);
add('segment area radius 10 angle 90', 25 * PI - 50);
add('semicircle radius 4 area', 8 * PI);
add('semicircle radius 4 perimeter', 4 * PI + 8);
add('quarter circle radius 2 area', PI);
add('annulus outer radius 5 inner radius 3 area', 16 * PI);
add('ring area 16π outer radius 5 inner radius?', 3);
add('tangent length from a point 13 from the centre of a circle radius 5', 12);
add('ellipse semi-major axis 5 semi-minor axis 3 area', 15 * PI);
add('ellipse a=5 b=3 perimeter', 25.526998863398, 1e-9);
add('ellipse a=5 b=3 eccentricity', 0.8);
add('ellipse area 30 semi-minor 2 semi-major?', 15 / PI);

// --- triangles ---
add('triangle sides 3, 4, 5 area', 6);
add('triangle sides 13, 14, 15 area', 84);
add('triangle with sides 7, 8, 9 perimeter', 24);
add('triangle a=7 b=9 C=40°', 0.5 * 7 * 9 * Math.sin((40 * PI) / 180));
add('triangle a=5 b=7 C=60 side c', Math.sqrt(39));
add('triangle A=30 B=60 c=10 side a', 5);
add('triangle A=40 B=60 a=10 side b', (10 * Math.sin((60 * PI) / 180)) / Math.sin((40 * PI) / 180));
add('triangle base 4 height 3 area', 6);
add('triangle sides 5, 5, 6 inradius', 1.5);
add('triangle sides 5, 5, 6 circumradius', 25 / 8);
add('triangle with sides 6, 8, 10, angle C', 90);
add('right triangle legs 3 and 4 hypotenuse', 5);
add('right triangle hypotenuse 13 leg 5, other leg?', 12);
add('right triangle with hypotenuse 10 and angle 30, side a', 5);
add('right triangle hypotenuse 10 angle 30 side b', 5 * Math.sqrt(3));
add('right triangle legs 6 and 8 area', 24);
add('right triangle opposite 5 adjacent 12 hypotenuse', 13);
add('hypotenuse of a right triangle with legs 5 and 12', 13);
add('right triangle area 24 leg 6 other leg?', 8);
add('equilateral triangle side 5 area', (25 * Math.sqrt(3)) / 4);
add('equilateral triangle side 6 height', 3 * Math.sqrt(3));
add('equilateral triangle area 9√3 side?', 6);
add('equilateral triangle perimeter 30 area', 25 * Math.sqrt(3));
add('isosceles triangle base 10 height 12 area', 60);
add('isosceles triangle base 10 height 12 side a', 13);
add('isosceles triangle equal sides 13 base 10 area', 60);
add('45-45-90 triangle hypotenuse 10 leg a', 5 * Math.SQRT2);
add('30-60-90 triangle short leg 4 hypotenuse', 8);
add('triangle sides 4, 5, 6 angle A', (Math.acos((25 + 36 - 16) / 60) * 180) / PI);
add('triangle a=8 b=6 c=7 median to c', 0.5 * Math.sqrt(2 * 64 + 2 * 36 - 49));
for (const [a, b, c] of [[3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25], [6, 7, 8], [10, 10, 12], [9, 10, 17]] as const) {
  const s = (a + b + c) / 2;
  add(`triangle with sides ${a}, ${b}, ${c}`, Math.sqrt(s * (s - a) * (s - b) * (s - c)));
}
for (const [a, b, C] of [[3, 4, 90], [5, 6, 45], [10, 12, 120], [2, 2, 60]] as const) add(`triangle a=${a} b=${b} C=${C} side c`, Math.sqrt(a * a + b * b - 2 * a * b * Math.cos((C * PI) / 180)));

// --- quadrilaterals ---
for (const s of [2, 5, 9]) {
  add(`square side ${s} area`, s * s);
  add(`square side ${s} diagonal`, s * Math.SQRT2);
  add(`square with perimeter ${4 * s} area`, s * s);
  add(`square diagonal ${s} side?`, s / Math.SQRT2);
}
add('square area 50 side?', Math.sqrt(50));
for (const [l, w] of [[8, 6], [5, 3], [12, 5], [2.5, 4]] as const) {
  add(`rectangle length ${l} width ${w} area`, l * w);
  add(`rectangle ${l} by ${w} perimeter`, 2 * (l + w));
  add(`rectangle length ${l} width ${w} diagonal`, Math.hypot(l, w));
  add(`rectangle area ${l * w} length ${l} width?`, w);
}
add('rectangle diagonal 10 and one side 6 area', 48);
add('rectangle area 12 perimeter 14 length', 4);
add('rectangle area 12 perimeter 14 width', 3);
add('rhombus diagonals 6 and 8 area', 24);
add('rhombus diagonals 6 and 8 side', 5);
add('rhombus side 5 angle 60 area', 12.5 * Math.sqrt(3));
add('rhombus side 10 diagonal 12 other diagonal', 16);
add('parallelogram base 8 height 5 area', 40);
add('parallelogram sides 6 and 4 angle 30 area', 12);
add('parallelogram a=6 b=4 θ=60 long diagonal', Math.sqrt(36 + 16 + 24));
add('trapezoid bases 10 and 6 height 4 area', 32);
add('trapezium parallel sides 7 and 3 height 5 area', 25);
add('trapezoid area 40 bases 6 and 10 height?', 5);
add('isosceles trapezoid bases 10 and 4 legs 5 height', 4);
add('isosceles trapezoid bases 10 and 4 height 4 area', 28);
add('isosceles trapezoid bases 10 and 4 height 4 diagonal', Math.hypot(4, 7));
add('right trapezoid bases 9 and 5 height 3 slant side', 5);
add('trapezoid bases 10 and 4 legs 5 and 5 area', 28);
add('kite diagonals 6 and 10 area', 30);
add('kite sides 5 and 5 diagonal 8 perimeter', 20);

// --- regular polygons ---
const regArea = (n: number, s: number) => (n * s * s) / (4 * Math.tan(PI / n));
for (const [name, n] of [['pentagon', 5], ['hexagon', 6], ['heptagon', 7], ['octagon', 8], ['nonagon', 9], ['decagon', 10], ['dodecagon', 12]] as const) {
  add(`regular ${name} side 4 area`, regArea(n, 4));
  add(`regular ${name} side 3 perimeter`, 3 * n);
  add(`${name} interior angle`, 180 - 360 / n);
  add(`regular ${name} area ${regArea(n, 5).toFixed(8)} side?`, 5, 1e-6);
}
add('regular hexagon side 6 apothem', 3 * Math.sqrt(3));
add('regular hexagon area 100, side?', Math.sqrt((400 * Math.tan(PI / 6)) / 6));
add('regular polygon with 20 sides side 2 area', regArea(20, 2));
add('regular 15-gon side 1 area', regArea(15, 1));
add('regular polygon interior angle 140 how many sides', 9);
add('regular polygon exterior angle 30 how many sides', 12);
add('number of diagonals of a decagon', 35);
add('sum of interior angles of an octagon', 1080);

// --- solids ---
for (const s of [2, 3, 5]) {
  add(`volume of a cube side ${s}`, s ** 3);
  add(`cube edge ${s} surface area`, 6 * s * s);
  add(`cube edge ${s} space diagonal`, s * Math.sqrt(3));
  add(`cube volume ${s ** 3} edge?`, s);
}
add('cube surface area 150 volume', 125);
for (const [l, w, h] of [[3, 4, 5], [2, 2, 10], [1.5, 2, 3]] as const) {
  add(`cuboid length ${l} width ${w} height ${h} volume`, l * w * h);
  add(`rectangular prism ${l} x ${w} x ${h} surface area`, 2 * (l * w + l * h + w * h));
  add(`box ${l} by ${w} by ${h} diagonal`, Math.hypot(l, w, h));
}
add('box volume 60 length 5 width 4 height?', 3);
for (const [r, h] of [[3, 5], [4, 10], [1, 1], [2.5, 8]] as const) {
  add(`volume of a cylinder radius ${r} height ${h}`, PI * r * r * h);
  add(`cylinder radius ${r} height ${h} surface area`, 2 * PI * r * (r + h));
  add(`cylinder radius ${r} height ${h} curved surface area`, 2 * PI * r * h);
  add(`cone radius ${r} height ${h} volume`, (PI * r * r * h) / 3);
  add(`cone radius ${r} height ${h} slant height`, Math.hypot(r, h));
  add(`cone radius ${r} height ${h} total surface area`, PI * r * (r + Math.hypot(r, h)));
}
add('cylinder volume 500 cm³ radius 4, height?', 500 / (16 * PI));
add('cylinder volume 1000 height 10 radius?', Math.sqrt(100 / PI));
add('cylinder diameter 10 height 4 volume', 100 * PI);
add('cylinder holds 2 litres radius 5 cm, height?', 2000 / (25 * PI));
add('cone slant 13 radius 5 volume', 100 * PI);
add('cone slant 13 radius 5 height', 12);
add('cone volume 100π height 12 radius?', 5);
add('frustum R=5 r=3 h=4 volume', ((PI * 4) / 3) * (25 + 15 + 9));
add('frustum bottom radius 5 top radius 2 height 4 slant height', 5);
add('square pyramid base 6 height 4 volume', 48);
add('square pyramid base 6 height 4 slant height', 5);
add('square pyramid base 6 height 4 surface area', 36 + 60);
add('triangular pyramid side 6 height 5 volume', ((Math.sqrt(3) / 4) * 36 * 5) / 3);
add('hexagonal pyramid side 2 height 3 volume', (regArea(6, 2) * 3) / 3);
add('rectangular pyramid length 6 width 4 height 5 volume', 40);
add('square pyramid volume 48 base 6 height?', 4);
add('pyramid frustum bottom edge 6 top edge 3 height 4 volume', (4 / 3) * (36 + 9 + 18));
add('hexagonal prism side 4 height 10 volume', regArea(6, 4) * 10);
add('triangular prism base 6 height 4 length 10 volume', 120);
add('pentagonal prism side 2 length 5 lateral surface area', 50);
for (const r of [1, 3, 5, 6]) {
  add(`volume of a sphere radius ${r}`, (4 / 3) * PI * r ** 3);
  add(`sphere radius ${r} surface area`, 4 * PI * r * r);
  add(`hemisphere radius ${r} volume`, (2 / 3) * PI * r ** 3);
  add(`hemisphere radius ${r} total surface area`, 3 * PI * r * r);
}
add('sphere surface area 200 radius', Math.sqrt(200 / (4 * PI)));
add('sphere volume 36π radius?', 3);
add('sphere diameter 10 volume', (500 / 3) * PI);
add('spherical cap sphere radius 5 cap height 2 volume', (PI * 4 * (15 - 2)) / 3);
add('spherical cap height 2 base radius 4 sphere radius?', 5);
add('torus major radius 5 minor radius 2 volume', 2 * PI * PI * 5 * 4);
add('torus R=5 r=2 surface area', 4 * PI * PI * 10);
add('hollow cylinder outer radius 5 inner radius 4 height 10 volume', PI * 90);
add('pipe outer diameter 10 inner diameter 8 length 100 volume', PI * 9 * 100);
add('ellipsoid semi-axes 3, 4, 5 volume', 80 * PI);
add('capsule radius 2 cylinder length 5 volume', PI * 4 * 5 + (32 / 3) * PI);
add('wedge length 4 width 3 height 2 volume', 12);
add('regular tetrahedron edge 2 volume', (2 * Math.SQRT2) / 3);
add('octahedron edge 3 surface area', 18 * Math.sqrt(3));
add('icosahedron edge 1 volume', (5 * (3 + Math.sqrt(5))) / 12);
add('dodecahedron edge 1 volume', (15 + 7 * Math.sqrt(5)) / 4);

// --- units ---
add('area of a circle radius 2 m in cm²', 4 * PI * 1e4);
add('cube side 10 cm volume in litres', 1);
add('rectangle 2 m by 50 cm area', 1);
add('square side 3 ft area in square inches', 9 * 144);

// --- coordinate geometry ---
add('distance between (1,2) and (4,6)', 5);
add('distance between (-1,-1) and (2,3)', 5);
add('distance from (0,0) to (1,1)', Math.SQRT2);
add('slope of the line through (1,2) and (3,8)', 3);
add('slope between (0,0) and (4,-2)', -0.5);
add('distance from (1,2) to the line 3x + 4y - 5 = 0', 1.2);
add('distance from (0,0) to the line y = x + 2', Math.SQRT2);
add('polygon with vertices (0,0) (4,0) (5,3) (1,4)', 14.5);
add('area of triangle (0,0) (4,0) (0,3)', 6);
add('area of the polygon (0,0) (2,0) (2,2) (0,2)', 4);
add('area of pentagon with vertices (0,0) (4,0) (5,3) (2,5) (-1,3)', 0.5 * Math.abs(0 * 0 - 4 * 0 + (4 * 3 - 5 * 0) + (5 * 5 - 2 * 3) + (2 * 3 - -1 * 5) + (-1 * 0 - 0 * 3)));
add('perimeter of triangle (0,0) (3,0) (0,4)', 12);
add('distance between (1,2,3) and (4,6,15)', 13);

describe('shape battery', () => {
  it('has at least 250 inputs', () => expect(cases.length + TEXT_CASES.length).toBeGreaterThanOrEqual(250));
  for (const [q, e, tol] of cases)
    it(q, () => {
      const a = ask(q);
      expect(num(a), `${q} → ${a.primary.display}`).toBeCloseTo(e, tol ? Math.round(-Math.log10(tol)) - 1 : 6);
    });
});

// Answers checked by text: exact forms, equations, multiple solutions.
const TEXT_CASES: [string, RegExp][] = [
  ['equilateral triangle side 5 area', /^25√3\/4 ≈ 10\.8253$/],
  ['area of a circle radius 5', /^25π ≈ 78\.5398$/],
  ['volume of sphere radius 5', /^500π\/3 ≈ 523\.599$/],
  ['cylinder volume 500 cm³ radius 4, height?', /^125\/\(4π\) ≈ 9\.94718$/],
  ['sphere surface area 200 radius', /^5√\(2\/π\)/],
  ['triangle a=5 b=7 C=60 side c', /^√39 ≈ 6\.245/],
  ['right triangle hypotenuse 10 angle 30 side b', /^5√3 ≈ 8\.66025$/],
  ['triangle a=7, b=9, A=40', / or /],
  ['midpoint of (1,2) and (3,4)', /^\(2, 3\)$/],
  ['circle with center (2,-3) radius 4', /^\(x − 2\)² \+ \(y \+ 3\)² = 16$/],
  ['center and radius of x^2 + y^2 - 4x + 6y - 12 = 0', /^Circle$/],
  ['equation of the line through (1,2) and (3,8)', /^y = 3x − 1$/],
  ['line parallel to y = 2x + 3 through (1, 4)', /^y = 2x \+ 2$/],
  ['line perpendicular to y = 2x + 3 through (2, 1)', /^y = −0\.5x \+ 2$/],
  ['intersection of y = 2x + 1 and y = -x + 4', /^\(1, 3\)$/],
  ['circle through (0,0) (2,0) (0,2)', /^\(x − 1\)² \+ \(y − 1\)² = 2$/],
  ['foci of x^2/25 + y^2/9 = 1', /^Ellipse$/],
  ['vertex and focus of y^2 = 8x', /^Parabola$/],
  ['asymptotes of x^2/9 - y^2/16 = 1', /^Hyperbola$/],
  ['reflect (2,3) over the x-axis', /^\(2, −3\)$/],
  ['rotate (1,0) 90 degrees about the origin', /^\(0, 1\)$/],
  ['translate (2,3) by (4,-1)', /^\(6, 2\)$/],
  ['dilate (2,4) by a factor of 3', /^\(6, 12\)$/],
  ['polygon (0,0) (4,0) (4,3) (0,3) centroid', /^\(2, 1\.5\)$/],
];
describe('shape battery: exact text', () => {
  for (const [q, re] of TEXT_CASES) it(q, () => expect(ask(q).primary.display).toMatch(re));
});

describe('shape engine behaviour', () => {
  it('gives both triangles in the ambiguous SSA case', () => {
    const a = ask('triangle a=7, b=9, A=40');
    expect(a.table?.columns).toEqual(['', 'Triangle 1', 'Triangle 2']);
    expect(a.notes.join(' ')).toMatch(/ambiguous/);
  });
  it('lists every derived measurement with its formula', () => {
    const a = ask('cylinder radius 3 height 5');
    expect(line(a, /^Volume/)).toMatch(/V = πr²h = 45π ≈ 141\.372/);
    expect(line(a, /^Total surface/)).toMatch(/48π/);
    expect(lineNum(a, /^Diameter/)).toBe(6);
  });
  it('carries units through', () => {
    const a = ask('cylinder volume 500 cm³ radius 4, height?');
    expect(a.primary.unit).toBe('cm');
    expect(line(a, /^Total surface/)).toMatch(/cm²$/);
  });
  it('notes the trapezium regional difference', () => expect(ask('trapezium bases 10 and 6 height 4').notes.join(' ')).toMatch(/UK/));
  it('attaches a labelled SVG figure', () => {
    const a = ask('triangle sides 3, 4, 5');
    expect(a.figure?.svg).toMatch(/^<svg[^>]*role="img"/);
    expect(a.figure?.svg).not.toMatch(/<script/i);
  });
  it('rejects impossible triangles and contradictions', () => {
    const r = answerShape('triangle sides 3, 4, 8');
    expect(r && !r.ok && r.error.message).toMatch(/triangle inequality/);
    const c = answerShape('rectangle length 3 width 4 diagonal 6');
    expect(c && !c.ok && c.error.message).toMatch(/don't fit/);
  });
  it('asks for missing measurements instead of guessing', () => {
    const r = answerShape('volume of a cylinder radius 3');
    expect(r && !r.ok && r.error.message).toMatch(/height/);
  });
  it('leaves other engines’ inputs alone', () => {
    for (const q of ['square root of 144', '5 + 5', 'fit a line to (1,2) (2,4.1) (3,5.9)', 'box plot of 1 2 3', 'derivative of x^3', '3 cubed', 'cube root of 27', '10 square feet to m2', 'chi-square observed 50, 30, 20 expected 40, 40, 20']) expect(answerShape(q), q).toBeNull();
  });
  it('reads spoken numbers', () => expect(num(ask('volume of a cylinder with radius four and height ten'))).toBeCloseTo(160 * PI, 6));
});
