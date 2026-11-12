import { atan2Deg, atanDeg, cosDeg, ex, sinDeg, tanDeg, V } from './exact';
import { F, finalize, M, S, type Shape, type VarDef } from './solver';

// ---------- variable helpers ----------

type Opt = Partial<Pick<VarDef, 'words' | 'letters' | 'post' | 'hidden' | 'int' | 'signed'>>;
const v = (key: string, sym: string, label: string, dim: VarDef['dim'], o: Opt = {}): VarDef => ({ key, sym, label, dim, ...o });

const R_ = (key = 'r', label = 'Radius') => v(key, key, label, 1, { words: ['radius', 'radii'], letters: ['r'] });
const D_ = (key = 'd') => v(key, key, 'Diameter', 1, { words: ['diameter'], letters: ['d'] });
const H_ = (label = 'Height', extra: string[] = []) => v('h', 'h', label, 1, { words: ['height', 'altitude', 'perpendicular height', 'vertical height', ...extra], letters: ['h'], post: ['tall', 'high'] });
const A_ = (label = 'Area') => v('A', 'A', label, 2, { words: ['area'], letters: ['A'] });
const P_ = () => v('P', 'P', 'Perimeter', 1, { words: ['perimeter'], letters: ['P'] });
const VOL = () => v('V', 'V', 'Volume', 3, { words: ['volume', 'capacity'], letters: ['V'] });
const SA = (label = 'Total surface area') => v('S', 'S', label, 2, { words: ['total surface area', 'surface area', 'total area', 'tsa', 'sa'], letters: ['S'] });
const LSA = (label = 'Lateral surface area') => v('L', 'L', label, 2, { words: ['lateral surface area', 'lateral area', 'curved surface area', 'curved area', 'curved surface', 'csa', 'lsa'] });
const BASE = (label = 'Base area') => v('B', 'B', label, 2, { words: ['base area', 'area of the base', 'area of base'] });

const deg = (x: V) => x; // angles are carried in degrees
const half = (x: V) => x.div(2);

// ---------- regular polygon constants (exact where clean) ----------

/** apothem / side = 1 / (2 tan(180°/n)) */
export function apothemK(n: number): V {
  if (n === 8) return V.rat(1).add(V.rat(2).sqrt()).div(2);
  const t = tanDeg(V.rat(180).div(n));
  return V.rat(1).div(t.mul(2));
}
/** circumradius / side = 1 / (2 sin(180°/n)) */
export function circK(n: number): V {
  if (n === 8) return new V(1 / (2 * Math.sin(Math.PI / 8)), null);
  return V.rat(1).div(sinDeg(V.rat(180).div(n)).mul(2));
}

function polyRels(nKey: string, sKey: string, aKey: string, rKey: string, pKey: string, areaKey: string) {
  const nOf = (g: (k: string) => V) => {
    const n = g(nKey).x;
    return Number.isInteger(n) && n >= 3 ? n : null;
  };
  return [
    M(`${pKey} = ${nKey} ${sKey}`),
    F(aKey, [nKey, sKey], (g) => {
      const n = nOf(g);
      return n ? g(sKey).mul(apothemK(n)) : null;
    }, `a = s/(2·tan(180°/n))`, { [sKey]: { f: (g) => (nOf(g) ? g(aKey).div(apothemK(nOf(g)!)) : null), text: 's = 2a·tan(180°/n)' } }, { noNumericInverse: true }),
    F(rKey, [nKey, sKey], (g) => {
      const n = nOf(g);
      return n ? g(sKey).mul(circK(n)) : null;
    }, `R = s/(2·sin(180°/n))`, { [sKey]: { f: (g) => (nOf(g) ? g(rKey).div(circK(nOf(g)!)) : null), text: 's = 2R·sin(180°/n)' } }, { noNumericInverse: true }),
    M(`${areaKey} = 1/2 ${pKey} ${aKey}`),
    F(areaKey, [nKey, sKey], (g) => {
      const n = nOf(g);
      return n ? g(sKey).pow(2).mul(n).mul(apothemK(n)).div(2) : null;
    }, `A = n s²/(4·tan(180°/n))`, { [sKey]: { f: (g) => (nOf(g) ? g(areaKey).mul(2).div(apothemK(nOf(g)!).mul(nOf(g)!)).sqrt() : null), text: 's = √(4A·tan(180°/n)/n)' } }, { noNumericInverse: true }),
  ];
}

// ---------- 2D ----------

const circle: Shape = finalize({
  id: 'circle',
  name: 'circle',
  vars: [
    R_(),
    D_(),
    v('C', 'C', 'Circumference', 1, { words: ['circumference', 'perimeter'], letters: ['C'] }),
    A_(),
    v('D', 'D', 'Distance from the centre to the outside point', 1, { words: ['distance from the centre', 'distance from the center', 'distance to the centre', 'distance to the center', 'from the centre', 'from the center'] }),
    v('t', 't', 'Tangent length', 1, { words: ['tangent length', 'length of the tangent', 'tangent segment', 'tangent'] }),
    v('θt', 'θ', 'Angle between the two tangents', 'angle', { words: ['angle between the tangents', 'angle between tangents'] }),
  ],
  rels: [
    S('d = 2 r'),
    M('C = 2 π r'),
    M('A = π r^2'),
    S('D^2 = r^2 + t^2'),
    F('θt', ['r', 'D'], (g) => new V((2 * Math.asin(g('r').x / g('D').x) * 180) / Math.PI), 'θ = 2·asin(r/D)'),
  ],
  basis: ['r'],
  main: 'A',
  positional: ['r'],
});

const sector: Shape = finalize({
  id: 'sector',
  name: 'circle sector',
  vars: [
    R_(),
    D_(),
    v('θ', 'θ', 'Central angle', 'angle', { words: ['central angle', 'angle at the centre', 'angle at the center', 'angle subtended', 'sector angle', 'angle'], letters: ['θ'] }),
    v('s', 's', 'Arc length', 1, { words: ['arc length', 'length of the arc', 'arc'], letters: ['s', 'l'] }),
    v('c', 'c', 'Chord length', 1, { words: ['chord length', 'length of the chord', 'chord'] }),
    v('As', 'Aₛ', 'Sector area', 2, { words: ['sector area', 'area of the sector', 'area of sector'] }),
    v('Ag', 'A_seg', 'Segment area', 2, { words: ['segment area', 'area of the segment', 'area of segment'] }),
    v('p', 'p', 'Distance from centre to chord', 1, { signed: true, words: ['distance from the centre to the chord', 'distance from the center to the chord', 'distance from centre', 'distance from center', 'distance from the centre', 'distance from the center'] }),
    v('hs', 'h', 'Segment height (sagitta)', 1, { signed: true, words: ['sagitta', 'segment height', 'height of the segment', 'rise'] }),
    v('Ps', 'Pₛ', 'Sector perimeter', 1, { words: ['sector perimeter', 'perimeter of the sector', 'perimeter'] }),
    v('ι', 'α', 'Inscribed angle on the same arc', 'angle', { words: ['inscribed angle'] }),
  ],
  rels: [
    S('d = 2 r'),
    M('s = $k r θ', { k: V.PI.div(180) }),
    M('As = $k r^2 θ', { k: V.PI.div(360) }),
    M('As = 1/2 r s'),
    F('c', ['r', 'θ'], (g) => g('r').mul(2).mul(sinDeg(half(g('θ')))), 'c = 2r·sin(θ/2)', {
      θ: { f: (g) => (g('c').x <= 2 * g('r').x ? new V((2 * Math.asin(g('c').x / (2 * g('r').x)) * 180) / Math.PI) : null), text: 'θ = 2·asin(c/(2r))' },
    }),
    S('r^2 = p^2 + 1/4 c^2'),
    S('hs = r - p'),
    F('Ag', ['As', 'r', 'θ'], (g) => g('As').sub(g('r').pow(2).mul(sinDeg(g('θ'))).div(2)), 'A_seg = Aₛ − ½r²·sin θ'),
    S('Ps = 2 r + s'),
    M('ι = 1/2 θ'),
  ],
  basis: ['r', 'θ'],
  main: 'As',
  notes: ['Chord, sagitta and segment use the minor arc (θ ≤ 180°) unless the angle given is larger'],
});

const annulus: Shape = finalize({
  id: 'annulus',
  name: 'annulus (ring)',
  vars: [
    v('R', 'R', 'Outer radius', 1, { words: ['outer radius', 'external radius', 'big radius', 'larger radius'], letters: ['R'] }),
    v('r', 'r', 'Inner radius', 1, { words: ['inner radius', 'internal radius', 'small radius', 'smaller radius', 'hole radius'], letters: ['r'] }),
    v('w', 'w', 'Width of the ring', 1, { words: ['width', 'thickness'] }),
    v('Do', 'D', 'Outer diameter', 1, { words: ['outer diameter', 'external diameter'] }),
    v('di', 'd', 'Inner diameter', 1, { words: ['inner diameter', 'internal diameter'] }),
    A_(),
    v('Co', 'C', 'Outer circumference', 1, { words: ['outer circumference'] }),
    v('ci', 'c', 'Inner circumference', 1, { words: ['inner circumference'] }),
  ],
  rels: [S('w = R - r'), S('Do = 2 R'), S('di = 2 r'), S('A = π R^2 - π r^2'), M('Co = 2 π R'), M('ci = 2 π r')],
  basis: ['R', 'r'],
  main: 'A',
  positional: ['R', 'r'],
});

/** Perimeter of an ellipse: 2π·AGM-based complete elliptic integral (exact to double precision). */
function ellipsePerimeter(a: number, b: number): number {
  const A = Math.max(a, b);
  let x = A;
  let y = Math.min(a, b);
  let sum = 0.5 * (x * x - y * y);
  let p = 1;
  for (let i = 0; i < 40; i++) {
    const c = (x - y) / 2;
    if (Math.abs(c) < 1e-16 * A) break;
    const xn = (x + y) / 2;
    y = Math.sqrt(x * y);
    x = xn;
    sum += p * c * c;
    p *= 2;
  }
  return (2 * Math.PI * (A * A - sum)) / x;
}

const ellipse: Shape = finalize({
  id: 'ellipse',
  name: 'ellipse',
  vars: [
    v('a', 'a', 'Semi-major axis', 1, { words: ['semi-major axis', 'semi major axis', 'semimajor axis', 'semi-major', 'semimajor'], letters: ['a'] }),
    v('b', 'b', 'Semi-minor axis', 1, { words: ['semi-minor axis', 'semi minor axis', 'semiminor axis', 'semi-minor', 'semiminor'], letters: ['b'] }),
    v('Ma', '2a', 'Major axis', 1, { words: ['major axis'] }),
    v('mi', '2b', 'Minor axis', 1, { words: ['minor axis'] }),
    v('c', 'c', 'Centre-to-focus distance', 1, { words: ['focal distance', 'distance from the centre to a focus', 'distance from center to focus', 'linear eccentricity'], letters: ['c'] }),
    v('fd', '2c', 'Distance between the foci', 1, { words: ['distance between the foci', 'distance between foci'] }),
    v('e', 'e', 'Eccentricity', 0, { words: ['eccentricity'], letters: ['e'] }),
    A_(),
    v('P', 'P', 'Perimeter (circumference)', 1, { words: ['perimeter', 'circumference'], letters: ['P'] }),
    v('lr', 'ℓ', 'Latus rectum', 1, { words: ['latus rectum'] }),
  ],
  rels: [
    S('Ma = 2 a'),
    S('mi = 2 b'),
    S('c^2 = a^2 - b^2'),
    S('fd = 2 c'),
    M('e = c a^-1'),
    M('A = π a b'),
    M('lr = 2 b^2 a^-1'),
    F('P', ['a', 'b'], (g) => new V(ellipsePerimeter(g('a').x, g('b').x)), 'P = 4a·E(e) (complete elliptic integral)'),
  ],
  basis: ['a', 'b'],
  canon: (x) => (x.a! >= x.b! ? x : { ...x, a: x.b!, b: x.a! }),
  main: 'A',
  positional: ['a', 'b'],
});

const square: Shape = finalize({
  id: 'square',
  name: 'square',
  vars: [
    v('s', 's', 'Side', 1, { words: ['side length', 'side', 'length', 'edge'], letters: ['s', 'a'] }),
    P_(),
    A_(),
    v('d', 'd', 'Diagonal', 1, { words: ['diagonal'], letters: ['d'] }),
    v('ρ', 'r', 'Inradius (inscribed circle)', 1, { words: ['inradius', 'inscribed circle radius', 'radius of the inscribed circle'] }),
    v('R', 'R', 'Circumradius (circumscribed circle)', 1, { words: ['circumradius', 'circumscribed circle radius', 'radius of the circumscribed circle'] }),
  ],
  rels: [S('P = 4 s'), M('A = s^2'), M('d = √2 s'), M('ρ = 1/2 s'), M('R = 1/2 d')],
  basis: ['s'],
  main: 'A',
  positional: ['s'],
});

const rectangle: Shape = finalize({
  id: 'rectangle',
  name: 'rectangle',
  vars: [
    v('l', 'l', 'Length', 1, { words: ['length', 'base', 'long side', 'longer side', 'side'], letters: ['l'], post: ['long'] }),
    v('w', 'w', 'Width', 1, { words: ['width', 'breadth', 'height', 'short side', 'shorter side'], letters: ['w', 'b'], post: ['wide'] }),
    P_(),
    A_(),
    v('d', 'd', 'Diagonal', 1, { words: ['diagonal'], letters: ['d'] }),
    v('R', 'R', 'Circumradius', 1, { words: ['circumradius'] }),
    v('θ', 'θ', 'Angle between diagonal and length', 'angle', { words: ['angle'] }),
  ],
  rels: [S('P = 2 l + 2 w'), M('A = l w'), S('d^2 = l^2 + w^2'), M('R = 1/2 d'), F('θ', ['l', 'w'], (g) => atanDeg(g('w').div(g('l'))), 'θ = atan(w/l)')],
  basis: ['l', 'w'],
  canon: (x) => (x.l! >= x.w! ? x : { ...x, l: x.w!, w: x.l! }),
  main: 'A',
  positional: ['l', 'w'],
});

const rhombus: Shape = finalize({
  id: 'rhombus',
  name: 'rhombus',
  vars: [
    v('s', 's', 'Side', 1, { words: ['side length', 'side', 'edge'], letters: ['s', 'a'] }),
    v('p', 'p', 'Diagonal 1', 1, { words: ['long diagonal', 'longer diagonal', 'first diagonal', 'diagonal'], letters: ['p'] }),
    v('q', 'q', 'Diagonal 2', 1, { words: ['short diagonal', 'shorter diagonal', 'second diagonal', 'other diagonal'], letters: ['q'] }),
    A_(),
    P_(),
    v('h', 'h', 'Height', 1, { words: ['height', 'altitude'], letters: ['h'] }),
    v('α', 'α', 'Angle (between sides, opposite diagonal 2)', 'angle', { words: ['acute angle', 'angle'] }),
    v('β', 'β', 'Other angle', 'angle', { words: ['obtuse angle'] }),
    v('ρ', 'r', 'Inradius', 1, { words: ['inradius'] }),
  ],
  rels: [
    S('s^2 = 1/4 p^2 + 1/4 q^2'),
    M('A = 1/2 p q'),
    S('P = 4 s'),
    M('A = s h'),
    F('α', ['p', 'q'], (g) => atanDeg(g('q').div(g('p'))).mul(2), 'α = 2·atan(q/p)'),
    S('β = 180 - α'),
    F('p', ['s', 'α'], (g) => g('s').mul(2).mul(cosDeg(half(g('α')))), 'p = 2s·cos(α/2)'),
    F('q', ['s', 'α'], (g) => g('s').mul(2).mul(sinDeg(half(g('α')))), 'q = 2s·sin(α/2)'),
    M('ρ = 1/2 h'),
  ],
  basis: ['p', 'q'],
  main: 'A',
  positional: ['p', 'q'],
});

const parallelogram: Shape = finalize({
  id: 'parallelogram',
  name: 'parallelogram',
  vars: [
    v('a', 'a', 'Base', 1, { words: ['base', 'length', 'long side', 'side a'], letters: ['a'] }),
    v('b', 'b', 'Side', 1, { words: ['side', 'slant side', 'other side', 'short side', 'side b', 'width'], letters: ['b'] }),
    v('θ', 'θ', 'Angle between the sides', 'angle', { words: ['acute angle', 'angle', 'included angle'], letters: ['θ'] }),
    v('φ', 'φ', 'Other angle', 'angle', { words: ['obtuse angle'] }),
    v('h', 'h', 'Height (to the base)', 1, { words: ['height', 'altitude', 'perpendicular height'], letters: ['h'] }),
    v('hb', 'h_b', 'Height to the side', 1, { words: ['height to the side', 'other height'] }),
    A_(),
    P_(),
    v('d1', 'd₁', 'Short diagonal', 1, { words: ['short diagonal', 'shorter diagonal', 'diagonal'] }),
    v('d2', 'd₂', 'Long diagonal', 1, { words: ['long diagonal', 'longer diagonal', 'other diagonal'] }),
  ],
  rels: [
    S('P = 2 a + 2 b'),
    M('A = a h'),
    M('A = b hb'),
    F('h', ['b', 'θ'], (g) => g('b').mul(sinDeg(g('θ'))), 'h = b·sin θ', { θ: { f: (g) => (g('h').x <= g('b').x ? new V((Math.asin(g('h').x / g('b').x) * 180) / Math.PI) : null), text: 'θ = asin(h/b) (acute)' } }),
    S('φ = 180 - θ'),
    F('d1', ['a', 'b', 'θ'], (g) => g('a').pow(2).add(g('b').pow(2)).sub(g('a').mul(g('b')).mul(2).mul(cosDeg(g('θ')))).sqrt(), 'd₁ = √(a² + b² − 2ab·cos θ)'),
    F('d2', ['a', 'b', 'θ'], (g) => g('a').pow(2).add(g('b').pow(2)).add(g('a').mul(g('b')).mul(2).mul(cosDeg(g('θ')))).sqrt(), 'd₂ = √(a² + b² + 2ab·cos θ)'),
  ],
  basis: ['a', 'b', 'θ'],
  main: 'A',
  positional: ['a', 'h'],
});

const trapezoid: Shape = finalize({
  id: 'trapezoid',
  name: 'trapezoid',
  vars: [
    v('a', 'a', 'Bottom base', 1, { words: ['bottom base', 'lower base', 'longer base', 'long base', 'base 1', 'first base', 'base'], letters: ['a'] }),
    v('b', 'b', 'Top base', 1, { words: ['top base', 'upper base', 'shorter base', 'short base', 'base 2', 'second base', 'other base'], letters: ['b'] }),
    H_(),
    v('c', 'c', 'Left leg', 1, { words: ['left leg', 'leg 1', 'first leg', 'leg', 'side'], letters: ['c'] }),
    v('d', 'd', 'Right leg', 1, { words: ['right leg', 'leg 2', 'second leg', 'other leg'], letters: ['d'] }),
    v('m', 'm', 'Midsegment (median)', 1, { words: ['midsegment', 'median', 'midline', 'mid-segment'] }),
    A_(),
    P_(),
    v('p', 'p', 'Diagonal 1', 1, { words: ['diagonal'] }),
    v('q', 'q', 'Diagonal 2', 1, { words: ['other diagonal'] }),
    v('α', 'α', 'Bottom-left angle', 'angle', {}),
    v('β', 'β', 'Bottom-right angle', 'angle', {}),
    v('x', 'x', 'left overhang', 1, { hidden: true, signed: true }),
    v('y', 'y', 'right overhang', 1, { hidden: true, signed: true }),
    v('u', 'u', 'u', 1, { hidden: true, signed: true }),
    v('vv', 'v', 'v', 1, { hidden: true, signed: true }),
  ],
  rels: [
    S('m = 1/2 a + 1/2 b'),
    M('A = m h'),
    S('P = a + b + c + d'),
    S('c^2 = h^2 + x^2'),
    S('y = a - b - x'),
    S('d^2 = h^2 + y^2'),
    S('u = a - x'),
    S('p^2 = u^2 + h^2'),
    S('vv = x + b'),
    S('q^2 = vv^2 + h^2'),
    F('α', ['h', 'x'], (g) => atan2Deg(g('h').x, g('x').x), 'α = atan2(h, x)'),
    F('β', ['h', 'y'], (g) => atan2Deg(g('h').x, g('y').x), 'β = atan2(h, y)'),
  ],
  basis: ['a', 'b', 'h', 'x'],
  main: 'A',
  positional: ['a', 'b', 'h'],
});

const isoTrapezoid: Shape = finalize({
  id: 'isosceles-trapezoid',
  name: 'isosceles trapezoid',
  vars: [
    v('a', 'a', 'Bottom base', 1, { words: ['bottom base', 'lower base', 'longer base', 'long base', 'base 1', 'base'], letters: ['a'] }),
    v('b', 'b', 'Top base', 1, { words: ['top base', 'upper base', 'shorter base', 'short base', 'base 2', 'other base'], letters: ['b'] }),
    H_(),
    v('l', 'l', 'Leg', 1, { words: ['legs', 'leg', 'slant side', 'side', 'equal sides'], letters: ['l', 'c'] }),
    v('m', 'm', 'Midsegment', 1, { words: ['midsegment', 'median', 'midline'] }),
    A_(),
    P_(),
    v('dg', 'd', 'Diagonal', 1, { words: ['diagonal'] }),
    v('α', 'α', 'Base angle (at the bottom base)', 'angle', { words: ['base angle', 'angle'] }),
    v('β', 'β', 'Top angle', 'angle', {}),
    v('x', 'x', 'overhang', 1, { hidden: true, signed: true }),
  ],
  rels: [
    S('x = 1/2 a - 1/2 b'),
    S('l^2 = h^2 + x^2'),
    S('m = 1/2 a + 1/2 b'),
    S('dg^2 = h^2 + m^2'),
    M('A = m h'),
    S('P = a + b + 2 l'),
    F('α', ['h', 'x'], (g) => atan2Deg(g('h').x, g('x').x), 'α = atan(h/x), x = (a − b)/2'),
    S('β = 180 - α'),
  ],
  basis: ['a', 'b', 'h'],
  main: 'A',
  positional: ['a', 'b', 'h'],
});

const rightTrapezoid: Shape = finalize({
  id: 'right-trapezoid',
  name: 'right trapezoid',
  vars: [
    v('a', 'a', 'Bottom base', 1, { words: ['bottom base', 'longer base', 'base'], letters: ['a'] }),
    v('b', 'b', 'Top base', 1, { words: ['top base', 'shorter base', 'other base'], letters: ['b'] }),
    v('h', 'h', 'Height (perpendicular leg)', 1, { words: ['height', 'perpendicular side', 'perpendicular leg'], letters: ['h'] }),
    v('c', 'c', 'Slant leg', 1, { words: ['slant side', 'slant leg', 'slanted side', 'leg'], letters: ['c'] }),
    v('m', 'm', 'Midsegment', 1, { words: ['midsegment', 'median'] }),
    A_(),
    P_(),
    v('p', 'p', 'Long diagonal', 1, { words: ['long diagonal', 'diagonal'] }),
    v('q', 'q', 'Short diagonal', 1, { words: ['short diagonal'] }),
    v('α', 'α', 'Acute angle', 'angle', { words: ['angle'] }),
    v('e', 'e', 'base difference', 1, { hidden: true, signed: true }),
  ],
  rels: [S('e = a - b'), S('c^2 = h^2 + e^2'), S('m = 1/2 a + 1/2 b'), M('A = m h'), S('P = a + b + h + c'), S('p^2 = a^2 + h^2'), S('q^2 = b^2 + h^2'), F('α', ['h', 'e'], (g) => atan2Deg(g('h').x, g('e').x), 'α = atan(h/(a − b))')],
  basis: ['a', 'b', 'h'],
  main: 'A',
  positional: ['a', 'b', 'h'],
});

const kite: Shape = finalize({
  id: 'kite',
  name: 'kite',
  vars: [
    v('a', 'a', 'Short sides (pair)', 1, { words: ['short side', 'shorter side', 'side a'], letters: ['a'] }),
    v('b', 'b', 'Long sides (pair)', 1, { words: ['long side', 'longer side', 'side b'], letters: ['b'] }),
    v('p', 'p', 'Symmetry diagonal', 1, { words: ['main diagonal', 'long diagonal', 'symmetry diagonal', 'longer diagonal'], letters: ['p'] }),
    v('q', 'q', 'Cross diagonal', 1, { words: ['cross diagonal', 'short diagonal', 'shorter diagonal', 'other diagonal', 'diagonal'], letters: ['q'] }),
    A_(),
    P_(),
    v('α', 'α', 'Angle between the short sides', 'angle', {}),
    v('γ', 'γ', 'Angle between the long sides', 'angle', {}),
    v('β', 'β', 'Each of the two equal angles', 'angle', {}),
    v('p1', 'p₁', 'p₁', 1, { hidden: true }),
    v('p2', 'p₂', 'p₂', 1, { hidden: true }),
  ],
  rels: [
    S('p = p1 + p2'),
    S('a^2 = p1^2 + 1/4 q^2'),
    S('b^2 = p2^2 + 1/4 q^2'),
    M('A = 1/2 p q'),
    S('P = 2 a + 2 b'),
    F('α', ['q', 'p1'], (g) => atanDeg(g('q').div(g('p1').mul(2))).mul(2), 'α = 2·atan(q/(2p₁))'),
    F('γ', ['q', 'p2'], (g) => atanDeg(g('q').div(g('p2').mul(2))).mul(2), 'γ = 2·atan(q/(2p₂))'),
    S('β = 180 - 1/2 α - 1/2 γ'),
  ],
  basis: ['q', 'p1', 'p2'],
  main: 'A',
  positional: ['p', 'q'],
  notes: ['A kite has two pairs of equal adjacent sides: a, a and b, b'],
});

const POLY_N: Record<string, number> = {
  triangle: 3, square: 4, pentagon: 5, hexagon: 6, heptagon: 7, septagon: 7, octagon: 8, nonagon: 9, enneagon: 9, decagon: 10,
  hendecagon: 11, undecagon: 11, dodecagon: 12, tridecagon: 13, tetradecagon: 14, pentadecagon: 15, hexadecagon: 16, heptadecagon: 17,
  octadecagon: 18, enneadecagon: 19, icosagon: 20,
};
export { POLY_N };

function regularPolygon(n: number | null): Shape {
  return finalize({
    id: 'regular-polygon',
    name: n ? `regular ${n}-gon` : 'regular polygon',
    vars: [
      v('n', 'n', 'Number of sides', 'count', { words: ['number of sides', 'sides'], letters: ['n'], int: true }),
      v('s', 's', 'Side', 1, { words: ['side length', 'side', 'edge', 'length'], letters: ['s'] }),
      P_(),
      v('a', 'a', 'Apothem (inradius)', 1, { words: ['apothem', 'inradius', 'inscribed circle radius', 'radius of the inscribed circle'], letters: ['a'] }),
      v('R', 'R', 'Circumradius', 1, { words: ['circumradius', 'circumscribed radius', 'radius of the circumscribed circle', 'circumscribed circle radius', 'radius'], letters: ['R'] }),
      A_(),
      v('I', 'I', 'Interior angle', 'angle', { words: ['interior angle', 'internal angle', 'each angle', 'angle'] }),
      v('E', 'E', 'Exterior (central) angle', 'angle', { words: ['exterior angle', 'external angle', 'central angle'] }),
      v('Σ', 'ΣI', 'Sum of interior angles', 'angle', { words: ['sum of interior angles', 'sum of the interior angles', 'angle sum', 'interior angle sum', 'sum of angles', 'sum of the angles'] }),
      v('nd', 'N_d', 'Number of diagonals', 'count', { words: ['number of diagonals', 'how many diagonals', 'diagonals'] }),
    ],
    rels: [
      ...polyRels('n', 's', 'a', 'R', 'P', 'A'),
      M('E = 360 n^-1'),
      S('I = 180 - E'),
      S('Σ = 180 n - 360'),
      F('nd', ['n'], (g) => g('n').mul(g('n').sub(V.rat(3))).div(2), 'N_d = n(n − 3)/2', undefined, { noNumericInverse: true }),
    ],
    basis: ['n', 's'],
    fixed: n ? { n: V.rat(n) } : undefined,
    main: 'A',
    positional: ['s'],
    extra: (g) => {
      const nn = g('n')?.x;
      const s = g('s');
      if (!nn || !s || nn > 24 || !Number.isInteger(nn)) return [];
      const out: { label: string; display: string }[] = [];
      const lens: string[] = [];
      for (let k = 2; k <= Math.floor(nn / 2); k++) lens.push(((s.x * Math.sin((k * Math.PI) / nn)) / Math.sin(Math.PI / nn)).toPrecision(6).replace(/\.?0+$/, ''));
      if (lens.length) out.push({ label: 'Diagonal lengths', display: lens.join(', ') + ' (shortest to longest)' });
      return out;
    },
  });
}
export { regularPolygon };

// ---------- 3D ----------

const cube: Shape = finalize({
  id: 'cube',
  name: 'cube',
  threeD: true,
  vars: [
    v('s', 's', 'Edge', 1, { words: ['edge length', 'side length', 'edge', 'side', 'length'], letters: ['s', 'a'] }),
    VOL(),
    SA(),
    v('F', 'F', 'Face area', 2, { words: ['face area', 'area of a face', 'area of one face', 'area'] }),
    v('d', 'd', 'Face diagonal', 1, { words: ['face diagonal'] }),
    v('D', 'D', 'Space diagonal', 1, { words: ['space diagonal', 'body diagonal', 'main diagonal', 'diagonal', 'longest diagonal'] }),
    v('ρ', 'r', 'Inradius (inscribed sphere)', 1, { words: ['inradius', 'inscribed sphere radius'] }),
    v('R', 'R', 'Circumradius (circumscribed sphere)', 1, { words: ['circumradius', 'circumscribed sphere radius'] }),
    v('E', 'Σe', 'Total edge length', 1, { words: ['total edge length', 'sum of the edges', 'total length of the edges'] }),
  ],
  rels: [M('V = s^3'), M('S = 6 s^2'), M('F = s^2'), M('d = √2 s'), M('D = √3 s'), M('ρ = 1/2 s'), M('R = 1/2 D'), M('E = 12 s')],
  basis: ['s'],
  main: 'V',
  positional: ['s'],
  extra: () => [{ label: 'Vertices, edges, faces', display: '8, 12, 6 (V − E + F = 2)' }],
});

const cuboid: Shape = finalize({
  id: 'cuboid',
  name: 'rectangular prism (cuboid)',
  threeD: true,
  vars: [
    v('l', 'l', 'Length', 1, { words: ['length'], letters: ['l'], post: ['long'] }),
    v('w', 'w', 'Width', 1, { words: ['width', 'breadth'], letters: ['w', 'b'], post: ['wide'] }),
    v('h', 'h', 'Height', 1, { words: ['height', 'depth'], letters: ['h'], post: ['high', 'tall', 'deep'] }),
    VOL(),
    SA(),
    v('D', 'D', 'Space diagonal', 1, { words: ['space diagonal', 'body diagonal', 'diagonal', 'longest diagonal'] }),
    v('F1', 'lw', 'Base (top) face area', 2, { words: ['base area', 'area of the base'] }),
    v('F2', 'lh', 'Front face area', 2, {}),
    v('F3', 'wh', 'Side face area', 2, {}),
    v('L', 'L', 'Lateral surface area', 2, { words: ['lateral surface area', 'lateral area'] }),
    v('E', 'Σe', 'Total edge length', 1, { words: ['total edge length', 'sum of the edges'] }),
  ],
  rels: [M('V = l w h'), M('F1 = l w'), M('F2 = l h'), M('F3 = w h'), S('S = 2 F1 + 2 F2 + 2 F3'), S('L = 2 F2 + 2 F3'), S('D^2 = l^2 + w^2 + h^2'), S('E = 4 l + 4 w + 4 h'), M('V = F1 h')],
  basis: ['l', 'w', 'h'],
  main: 'V',
  positional: ['l', 'w', 'h'],
  extra: () => [{ label: 'Vertices, edges, faces', display: '8, 12, 6' }],
});

const cylinder: Shape = finalize({
  id: 'cylinder',
  name: 'cylinder',
  threeD: true,
  vars: [
    R_(),
    D_(),
    H_('Height', ['length', 'depth']),
    VOL(),
    SA(),
    LSA(),
    BASE(),
    v('C', 'C', 'Base circumference', 1, { words: ['circumference'], letters: ['C'] }),
    v('Dg', 'D', 'Diagonal of the axial section', 1, { words: ['diagonal'] }),
  ],
  rels: [S('d = 2 r'), M('C = 2 π r'), M('B = π r^2'), M('V = π r^2 h'), M('V = B h'), M('L = 2 π r h'), M('L = C h'), S('S = L + 2 B'), S('Dg^2 = d^2 + h^2')],
  basis: ['r', 'h'],
  main: 'V',
  positional: ['r', 'h'],
});

const hollowCylinder: Shape = finalize({
  id: 'hollow-cylinder',
  name: 'hollow cylinder (tube)',
  threeD: true,
  vars: [
    v('R', 'R', 'Outer radius', 1, { words: ['outer radius', 'external radius', 'outside radius'], letters: ['R'] }),
    v('r', 'r', 'Inner radius', 1, { words: ['inner radius', 'internal radius', 'inside radius'], letters: ['r'] }),
    v('t', 't', 'Wall thickness', 1, { words: ['thickness', 'wall thickness', 'wall'], letters: ['t'], post: ['thick'] }),
    v('Do', 'D', 'Outer diameter', 1, { words: ['outer diameter', 'external diameter', 'outside diameter'] }),
    v('di', 'd', 'Inner diameter', 1, { words: ['inner diameter', 'internal diameter', 'inside diameter', 'bore'] }),
    H_('Height (length)', ['length']),
    VOL(),
    v('Ar', 'Aᵣ', 'Ring (end) area', 2, { words: ['cross-sectional area', 'cross section area', 'ring area', 'end area'] }),
    v('Lo', 'Lₒ', 'Outer curved surface', 2, { words: ['outer surface area', 'outer curved surface area', 'external surface area'] }),
    v('Li', 'Lᵢ', 'Inner curved surface', 2, { words: ['inner surface area', 'inner curved surface area', 'internal surface area'] }),
    SA(),
  ],
  rels: [S('t = R - r'), S('Do = 2 R'), S('di = 2 r'), S('Ar = π R^2 - π r^2'), M('V = Ar h'), M('Lo = 2 π R h'), M('Li = 2 π r h'), S('S = Lo + Li + 2 Ar')],
  basis: ['R', 'r', 'h'],
  main: 'V',
  positional: ['R', 'r', 'h'],
});

const cone: Shape = finalize({
  id: 'cone',
  name: 'cone',
  threeD: true,
  vars: [
    R_(),
    D_(),
    H_(),
    v('l', 'l', 'Slant height', 1, { words: ['slant height', 'slant length', 'slant'], letters: ['l', 's'] }),
    VOL(),
    SA(),
    LSA(),
    BASE(),
    v('α', 'α', 'Apex angle', 'angle', { words: ['apex angle', 'vertex angle', 'opening angle'] }),
    v('φ', 'φ', 'Net sector angle', 'angle', { words: ['sector angle', 'net angle'] }),
  ],
  rels: [S('d = 2 r'), S('l^2 = r^2 + h^2'), M('B = π r^2'), M('L = π r l'), S('S = L + B'), M('V = 1/3 π r^2 h'), M('V = 1/3 B h'), F('α', ['r', 'h'], (g) => atanDeg(g('r').div(g('h'))).mul(2), 'α = 2·atan(r/h)'), M('φ = 360 r l^-1')],
  basis: ['r', 'h'],
  main: 'V',
  positional: ['r', 'h'],
});

const frustum: Shape = finalize({
  id: 'frustum',
  name: 'conical frustum',
  threeD: true,
  vars: [
    v('R', 'R', 'Bottom radius', 1, { words: ['bottom radius', 'base radius', 'larger radius', 'big radius', 'lower radius', 'radius 1'], letters: ['R'] }),
    v('r', 'r', 'Top radius', 1, { words: ['top radius', 'smaller radius', 'small radius', 'upper radius', 'radius 2'], letters: ['r'] }),
    H_(),
    v('l', 'l', 'Slant height', 1, { words: ['slant height', 'slant'], letters: ['l'] }),
    VOL(),
    SA(),
    LSA(),
    v('B1', 'B₁', 'Bottom area', 2, { words: ['bottom area'] }),
    v('B2', 'B₂', 'Top area', 2, { words: ['top area'] }),
    v('x', 'x', 'x', 1, { hidden: true, signed: true }),
    v('q', 'q', 'q', 1, { hidden: true }),
  ],
  rels: [
    S('x = R - r'),
    S('l^2 = h^2 + x^2'),
    M('B1 = π R^2'),
    M('B2 = π r^2'),
    S('q = R + r'),
    M('L = π q l'),
    S('S = L + B1 + B2'),
    F('V', ['h', 'R', 'r'], (g) => V.PI.mul(g('h')).div(3).mul(g('R').pow(2).add(g('R').mul(g('r'))).add(g('r').pow(2))), 'V = (π h/3)(R² + Rr + r²)'),
  ],
  basis: ['R', 'r', 'h'],
  main: 'V',
  positional: ['R', 'r', 'h'],
});

function pyramid(n: number | null, label: string): Shape {
  return finalize({
    id: 'pyramid',
    name: label,
    threeD: true,
    vars: [
      v('n', 'n', 'Number of base sides', 'count', { words: ['number of sides'], letters: ['n'], int: true }),
      v('s', 's', 'Base edge', 1, { words: ['base edge', 'base side', 'base length', 'side of the base', 'side length', 'side', 'base', 'edge of the base'], letters: ['s', 'a'] }),
      H_(),
      v('l', 'l', 'Slant height', 1, { words: ['slant height', 'slant'], letters: ['l'] }),
      v('e', 'e', 'Lateral edge', 1, { words: ['lateral edge', 'side edge', 'edge'] }),
      VOL(),
      SA(),
      LSA(),
      BASE(),
      v('ab', 'a', 'Base apothem', 1, { words: ['base apothem', 'apothem'] }),
      v('Rb', 'R', 'Base circumradius', 1, { words: ['base circumradius'] }),
      v('Pb', 'p', 'Base perimeter', 1, { words: ['base perimeter', 'perimeter of the base'] }),
    ],
    rels: [...polyRels('n', 's', 'ab', 'Rb', 'Pb', 'B'), S('l^2 = h^2 + ab^2'), S('e^2 = h^2 + Rb^2'), M('L = 1/2 Pb l'), S('S = L + B'), M('V = 1/3 B h')],
    basis: ['n', 's', 'h'],
    fixed: n ? { n: V.rat(n) } : undefined,
    main: 'V',
    positional: ['s', 'h'],
    extra: (g) => {
      const nn = g('n')?.x;
      return nn ? [{ label: 'Vertices, edges, faces', display: `${nn + 1}, ${2 * nn}, ${nn + 1}` }] : [];
    },
  });
}
export { pyramid };

const rectPyramid: Shape = finalize({
  id: 'rect-pyramid',
  name: 'rectangular pyramid',
  threeD: true,
  vars: [
    v('l', 'l', 'Base length', 1, { words: ['base length', 'length'], letters: ['l'] }),
    v('w', 'w', 'Base width', 1, { words: ['base width', 'width'], letters: ['w'] }),
    H_(),
    v('sl', 'sₗ', 'Slant height on the length faces', 1, {}),
    v('sw', 'sᵥᵥ', 'Slant height on the width faces', 1, {}),
    v('e', 'e', 'Lateral edge', 1, { words: ['lateral edge', 'edge'] }),
    VOL(),
    SA(),
    LSA(),
    BASE(),
  ],
  rels: [M('B = l w'), M('V = 1/3 B h'), S('sl^2 = h^2 + 1/4 w^2'), S('sw^2 = h^2 + 1/4 l^2'), S('e^2 = h^2 + 1/4 l^2 + 1/4 w^2'), F('L', ['l', 'sl', 'w', 'sw'], (g) => g('l').mul(g('sl')).add(g('w').mul(g('sw'))), 'L = l·sₗ + w·s_w'), S('S = L + B')],
  basis: ['l', 'w', 'h'],
  main: 'V',
  positional: ['l', 'w', 'h'],
});

const pyramidFrustum: Shape = finalize({
  id: 'pyramid-frustum',
  name: 'square pyramid frustum',
  threeD: true,
  vars: [
    v('a', 'a', 'Bottom edge', 1, { words: ['bottom edge', 'bottom side', 'base edge', 'lower edge', 'larger side'], letters: ['a'] }),
    v('b', 'b', 'Top edge', 1, { words: ['top edge', 'top side', 'upper edge', 'smaller side'], letters: ['b'] }),
    H_(),
    v('l', 'l', 'Slant height', 1, { words: ['slant height', 'slant'], letters: ['l'] }),
    VOL(),
    SA(),
    LSA(),
    v('B1', 'B₁', 'Bottom area', 2, {}),
    v('B2', 'B₂', 'Top area', 2, {}),
    v('x', 'x', 'x', 1, { hidden: true, signed: true }),
    v('q', 'q', 'q', 1, { hidden: true }),
  ],
  rels: [
    M('B1 = a^2'),
    M('B2 = b^2'),
    S('x = 1/2 a - 1/2 b'),
    S('l^2 = h^2 + x^2'),
    S('q = 2 a + 2 b'),
    M('L = q l'),
    S('S = L + B1 + B2'),
    F('V', ['h', 'B1', 'B2'], (g) => g('h').div(3).mul(g('B1').add(g('B2')).add(g('B1').mul(g('B2')).sqrt())), 'V = (h/3)(B₁ + B₂ + √(B₁B₂))'),
  ],
  basis: ['a', 'b', 'h'],
  main: 'V',
  positional: ['a', 'b', 'h'],
});

const sphere: Shape = finalize({
  id: 'sphere',
  name: 'sphere',
  threeD: true,
  vars: [R_(), D_(), VOL(), v('S', 'S', 'Surface area', 2, { words: ['surface area', 'total surface area', 'area', 'sa'], letters: ['S', 'A'] }), v('C', 'C', 'Great-circle circumference', 1, { words: ['circumference'], letters: ['C'] }), v('G', 'G', 'Great-circle area', 2, { words: ['cross-sectional area', 'cross section area', 'great circle area'] })],
  rels: [S('d = 2 r'), M('V = 4/3 π r^3'), M('S = 4 π r^2'), M('C = 2 π r'), M('G = π r^2')],
  basis: ['r'],
  main: 'V',
  positional: ['r'],
});

const hemisphere: Shape = finalize({
  id: 'hemisphere',
  name: 'hemisphere',
  threeD: true,
  vars: [R_(), D_(), VOL(), v('L', 'L', 'Curved surface area', 2, { words: ['curved surface area', 'curved area', 'curved surface', 'csa', 'lateral area'] }), BASE('Flat (base) area'), SA()],
  rels: [S('d = 2 r'), M('V = 2/3 π r^3'), M('L = 2 π r^2'), M('B = π r^2'), S('S = L + B')],
  basis: ['r'],
  main: 'V',
  positional: ['r'],
});

const cap: Shape = finalize({
  id: 'spherical-cap',
  name: 'spherical cap',
  threeD: true,
  vars: [
    v('R', 'R', 'Sphere radius', 1, { words: ['sphere radius', 'radius of the sphere', 'radius'], letters: ['R'] }),
    v('h', 'h', 'Cap height', 1, { words: ['cap height', 'height', 'depth'], letters: ['h'] }),
    v('a', 'a', 'Base radius of the cap', 1, { words: ['base radius', 'radius of the base', 'cap radius'], letters: ['a'] }),
    VOL(),
    v('L', 'L', 'Curved surface area', 2, { words: ['curved surface area', 'curved area', 'cap area', 'surface area of the cap'] }),
    BASE(),
    SA(),
  ],
  rels: [
    F('a', ['h', 'R'], (g) => g('h').mul(g('R').mul(2).sub(g('h'))).sqrt(), 'a = √(h(2R − h))', { R: { f: (g) => g('a').pow(2).add(g('h').pow(2)).div(g('h').mul(2)), text: 'R = (a² + h²)/(2h)' } }),
    F('V', ['h', 'R'], (g) => V.PI.mul(g('h').pow(2)).mul(g('R').mul(3).sub(g('h'))).div(3), 'V = πh²(3R − h)/3'),
    M('L = 2 π R h'),
    M('B = π a^2'),
    S('S = L + B'),
  ],
  basis: ['R', 'h'],
  main: 'V',
  positional: ['R', 'h'],
});

const sphericalSector: Shape = finalize({
  id: 'spherical-sector',
  name: 'spherical sector',
  threeD: true,
  vars: [
    v('R', 'R', 'Sphere radius', 1, { words: ['sphere radius', 'radius'], letters: ['R'] }),
    v('h', 'h', 'Cap height', 1, { words: ['cap height', 'height'], letters: ['h'] }),
    v('a', 'a', 'Cap base radius', 1, { words: ['base radius', 'cap radius'] }),
    VOL(),
    SA(),
  ],
  rels: [
    F('a', ['h', 'R'], (g) => g('h').mul(g('R').mul(2).sub(g('h'))).sqrt(), 'a = √(h(2R − h))', { R: { f: (g) => g('a').pow(2).add(g('h').pow(2)).div(g('h').mul(2)), text: 'R = (a² + h²)/(2h)' } }),
    M('V = 2/3 π R^2 h'),
    F('S', ['R', 'h', 'a'], (g) => V.PI.mul(g('R')).mul(g('h').mul(2).add(g('a'))), 'S = πR(2h + a)'),
  ],
  basis: ['R', 'h'],
  main: 'V',
  positional: ['R', 'h'],
});

const zone: Shape = finalize({
  id: 'spherical-segment',
  name: 'spherical segment (zone)',
  threeD: true,
  vars: [
    v('a', 'a', 'Radius of one base', 1, { words: ['bottom radius', 'radius 1', 'first radius', 'lower radius'], letters: ['a'] }),
    v('b', 'b', 'Radius of the other base', 1, { words: ['top radius', 'radius 2', 'second radius', 'upper radius'], letters: ['b'] }),
    v('h', 'h', 'Height', 1, { words: ['height', 'thickness'], letters: ['h'] }),
    VOL(),
  ],
  rels: [F('V', ['a', 'b', 'h'], (g) => V.PI.mul(g('h')).div(6).mul(g('a').pow(2).mul(3).add(g('b').pow(2).mul(3)).add(g('h').pow(2))), 'V = (πh/6)(3a² + 3b² + h²)')],
  basis: ['a', 'b', 'h'],
  main: 'V',
  positional: ['a', 'b', 'h'],
});

function thomsen(a: number, b: number, c: number): number {
  const p = 1.6075;
  return 4 * Math.PI * (((a * b) ** p + (a * c) ** p + (b * c) ** p) / 3) ** (1 / p);
}
function spheroidArea(a: number, c: number): number {
  // a = equatorial, c = polar
  if (Math.abs(a - c) < 1e-12 * a) return 4 * Math.PI * a * a;
  if (c < a) {
    const e = Math.sqrt(1 - (c * c) / (a * a));
    return 2 * Math.PI * a * a * (1 + ((1 - e * e) / e) * Math.atanh(e));
  }
  const e = Math.sqrt(1 - (a * a) / (c * c));
  return 2 * Math.PI * a * a * (1 + (c / (a * e)) * Math.asin(e));
}

const ellipsoid: Shape = finalize({
  id: 'ellipsoid',
  name: 'ellipsoid',
  threeD: true,
  vars: [
    v('a', 'a', 'Semi-axis a', 1, { letters: ['a'] }),
    v('b', 'b', 'Semi-axis b', 1, { letters: ['b'] }),
    v('c', 'c', 'Semi-axis c', 1, { letters: ['c'] }),
    VOL(),
    v('S', 'S', 'Surface area', 2, { words: ['surface area', 'area'] }),
  ],
  rels: [
    M('V = 4/3 π a b c'),
    F('S', ['a', 'b', 'c'], (g) => {
      const [a, b, c] = [g('a').x, g('b').x, g('c').x];
      if (Math.abs(a - b) < 1e-12 * a) return V.of(spheroidArea(a, c));
      if (Math.abs(b - c) < 1e-12 * b) return V.of(spheroidArea(b, a));
      if (Math.abs(a - c) < 1e-12 * a) return V.of(spheroidArea(a, b));
      return V.of(thomsen(a, b, c));
    }, 'S: exact spheroid formula when two semi-axes match; otherwise Knud Thomsen’s approximation (error < 1.1%)'),
  ],
  basis: ['a', 'b', 'c'],
  main: 'V',
  positional: ['a', 'b', 'c'],
});

const torus: Shape = finalize({
  id: 'torus',
  name: 'torus',
  threeD: true,
  vars: [
    v('R', 'R', 'Major radius (centre to tube centre)', 1, { words: ['major radius', 'big radius', 'distance from the centre to the tube', 'ring radius', 'large radius'], letters: ['R'] }),
    v('r', 'r', 'Minor radius (tube radius)', 1, { words: ['minor radius', 'tube radius', 'small radius', 'radius of the tube'], letters: ['r'] }),
    VOL(),
    v('S', 'S', 'Surface area', 2, { words: ['surface area', 'area'] }),
    v('ri', 'rᵢ', 'Inner radius (hole)', 1, { words: ['inner radius', 'hole radius'] }),
    v('ro', 'rₒ', 'Outer radius', 1, { words: ['outer radius'] }),
  ],
  rels: [M('V = 2 π^2 R r^2'), M('S = 4 π^2 R r'), S('ri = R - r'), S('ro = R + r')],
  basis: ['R', 'r'],
  main: 'V',
  positional: ['R', 'r'],
});

const capsule: Shape = finalize({
  id: 'capsule',
  name: 'capsule',
  threeD: true,
  vars: [
    R_(),
    v('a', 'a', 'Length of the cylindrical part', 1, { words: ['cylinder length', 'length of the cylinder', 'cylinder height', 'straight length', 'body length', 'height of the cylinder'], letters: ['a'] }),
    v('T', 'T', 'Total length', 1, { words: ['total length', 'overall length', 'length', 'height'] }),
    VOL(),
    SA('Surface area'),
  ],
  rels: [S('T = a + 2 r'), F('V', ['r', 'a'], (g) => V.PI.mul(g('r').pow(2)).mul(g('a')).add(V.PI.mul(g('r').pow(3)).mul(V.rat(4, 3))), 'V = πr²a + (4/3)πr³'), F('S', ['r', 'a'], (g) => V.PI.mul(g('r')).mul(g('a')).mul(2).add(V.PI.mul(g('r').pow(2)).mul(4)), 'S = 2πra + 4πr²')],
  basis: ['r', 'a'],
  main: 'V',
  positional: ['r', 'a'],
});

const wedge: Shape = finalize({
  id: 'wedge',
  name: 'wedge (right triangular prism / ramp)',
  threeD: true,
  vars: [
    v('l', 'l', 'Base length', 1, { words: ['length', 'base length', 'run'], letters: ['l'], post: ['long'] }),
    v('w', 'w', 'Width', 1, { words: ['width', 'breadth'], letters: ['w'], post: ['wide'] }),
    v('h', 'h', 'Height', 1, { words: ['height', 'rise'], letters: ['h'], post: ['high', 'tall'] }),
    v('s', 's', 'Slope length', 1, { words: ['slope length', 'slant', 'hypotenuse', 'slope'] }),
    v('θ', 'θ', 'Slope angle', 'angle', { words: ['angle', 'incline', 'slope angle'] }),
    VOL(),
    SA(),
  ],
  rels: [S('s^2 = l^2 + h^2'), M('V = 1/2 l w h'), F('S', ['l', 'w', 'h', 's'], (g) => g('l').mul(g('w')).add(g('h').mul(g('w'))).add(g('s').mul(g('w'))).add(g('l').mul(g('h'))), 'S = lw + hw + sw + lh'), F('θ', ['h', 'l'], (g) => atanDeg(g('h').div(g('l'))), 'θ = atan(h/l)')],
  basis: ['l', 'w', 'h'],
  main: 'V',
  positional: ['l', 'w', 'h'],
});

function prism(n: number | null, label: string): Shape {
  return finalize({
    id: 'prism',
    name: label,
    threeD: true,
    vars: [
      v('n', 'n', 'Number of base sides', 'count', { words: ['number of sides'], letters: ['n'], int: true }),
      v('s', 's', 'Base edge', 1, { words: ['base edge', 'base side', 'side length', 'side', 'edge'], letters: ['s', 'a'] }),
      v('h', 'h', 'Length (height of the prism)', 1, { words: ['length', 'height', 'depth'], letters: ['h', 'l'], post: ['long', 'tall', 'high'] }),
      VOL(),
      SA(),
      LSA(),
      BASE(),
      v('p', 'p', 'Base perimeter', 1, { words: ['base perimeter', 'perimeter of the base'] }),
      v('ab', 'a', 'Base apothem', 1, { words: ['apothem'] }),
      v('Rb', 'R', 'Base circumradius', 1, { words: ['circumradius'] }),
    ],
    rels: [...polyRels('n', 's', 'ab', 'Rb', 'p', 'B'), M('V = B h'), M('L = p h'), S('S = L + 2 B')],
    basis: ['n', 's', 'h'],
    fixed: n ? { n: V.rat(n) } : undefined,
    main: 'V',
    positional: ['s', 'h'],
    extra: (g) => {
      const nn = g('n')?.x;
      return nn ? [{ label: 'Vertices, edges, faces', display: `${2 * nn}, ${3 * nn}, ${nn + 2}` }] : [];
    },
  });
}
export { prism };

/** Triangular prism from the triangle's base and height (or B and p given by a sub-solve). */
const triPrism: Shape = finalize({
  id: 'triangular-prism',
  name: 'triangular prism',
  threeD: true,
  vars: [
    v('tb', 'b', 'Triangle base', 1, { words: ['triangle base', 'base of the triangle', 'base'], letters: ['b'] }),
    v('th', 'hₜ', 'Triangle height', 1, { words: ['triangle height', 'height of the triangle', 'height'] }),
    v('h', 'l', 'Length of the prism', 1, { words: ['length', 'prism length', 'length of the prism', 'depth', 'prism height', 'height of the prism'], letters: ['l'], post: ['long'] }),
    BASE('Triangle (base) area'),
    v('p', 'p', 'Triangle perimeter', 1, { words: ['base perimeter', 'perimeter of the triangle'] }),
    VOL(),
    SA(),
    LSA(),
  ],
  rels: [M('B = 1/2 tb th'), M('V = B h'), M('L = p h'), S('S = L + 2 B')],
  basis: ['tb', 'th', 'h'],
  main: 'V',
  positional: ['tb', 'th', 'h'],
  extra: () => [{ label: 'Vertices, edges, faces', display: '6, 9, 5' }],
});

// ---------- polyhedra ----------

const s5 = V.rat(5).sqrt();
const s2 = V.rat(2).sqrt();
const s3 = V.rat(3).sqrt();
const s6 = V.rat(6).sqrt();

interface Poly {
  id: string;
  name: string;
  V: V;
  S: V;
  R?: V;
  r?: V;
  m?: V;
  vef: [number, number, number];
  faces: string;
  dihedral?: number;
  words: string[];
}

export const POLYHEDRA: Poly[] = [
  { id: 'tetrahedron', name: 'regular tetrahedron', V: s2.div(12), S: s3, R: s6.div(4), r: s6.div(12), m: s2.div(4), vef: [4, 6, 4], faces: '4 equilateral triangles', dihedral: (Math.acos(1 / 3) * 180) / Math.PI, words: ['regular tetrahedron', 'tetrahedron', 'triangular pyramid with equal edges'] },
  { id: 'octahedron', name: 'regular octahedron', V: s2.div(3), S: s3.mul(2), R: s2.div(2), r: s6.div(6), m: V.rat(1, 2), vef: [6, 12, 8], faces: '8 equilateral triangles', dihedral: (Math.acos(-1 / 3) * 180) / Math.PI, words: ['regular octahedron', 'octahedron'] },
  { id: 'dodecahedron', name: 'regular dodecahedron', V: V.rat(15).add(s5.mul(7)).div(4), S: V.of(3 * Math.sqrt(25 + 10 * Math.sqrt(5))), R: s3.add(V.rat(15).sqrt()).div(4), r: V.of(0.5 * Math.sqrt((25 + 11 * Math.sqrt(5)) / 10)), m: V.rat(3).add(s5).div(4), vef: [20, 30, 12], faces: '12 regular pentagons', dihedral: (Math.acos(-1 / Math.sqrt(5)) * 180) / Math.PI, words: ['regular dodecahedron', 'dodecahedron'] },
  { id: 'icosahedron', name: 'regular icosahedron', V: V.rat(3).add(s5).mul(5).div(12), S: s3.mul(5), R: V.of(Math.sqrt(10 + 2 * Math.sqrt(5)) / 4), r: s3.mul(3).add(V.rat(15).sqrt()).div(12), m: V.rat(1).add(s5).div(4), vef: [12, 30, 20], faces: '20 equilateral triangles', dihedral: (Math.acos(-Math.sqrt(5) / 3) * 180) / Math.PI, words: ['regular icosahedron', 'icosahedron'] },
  { id: 'cuboctahedron', name: 'cuboctahedron', V: s2.mul(5).div(3), S: V.rat(6).add(s3.mul(2)), R: V.rat(1), vef: [12, 24, 14], faces: '8 triangles and 6 squares', words: ['cuboctahedron'] },
  { id: 'truncated-tetrahedron', name: 'truncated tetrahedron', V: s2.mul(23).div(12), S: s3.mul(7), vef: [12, 18, 8], faces: '4 triangles and 4 hexagons', words: ['truncated tetrahedron'] },
  { id: 'truncated-octahedron', name: 'truncated octahedron', V: s2.mul(8), S: V.rat(6).add(s3.mul(12)), vef: [24, 36, 14], faces: '6 squares and 8 hexagons', words: ['truncated octahedron'] },
  { id: 'truncated-cube', name: 'truncated cube', V: V.rat(21).add(s2.mul(14)).div(3), S: V.rat(12).add(s2.mul(12)).add(s3.mul(2)), vef: [24, 36, 14], faces: '8 triangles and 6 octagons', words: ['truncated cube'] },
  { id: 'rhombicuboctahedron', name: 'rhombicuboctahedron', V: V.rat(12).add(s2.mul(10)).div(3), S: V.rat(18).add(s3.mul(2)), vef: [24, 48, 26], faces: '8 triangles and 18 squares', words: ['rhombicuboctahedron'] },
  { id: 'icosidodecahedron', name: 'icosidodecahedron', V: V.rat(45).add(s5.mul(17)).div(6), S: V.of(5 * Math.sqrt(3) + 3 * Math.sqrt(25 + 10 * Math.sqrt(5))), R: V.rat(1).add(s5).div(2), vef: [30, 60, 32], faces: '20 triangles and 12 pentagons', words: ['icosidodecahedron'] },
  { id: 'truncated-icosahedron', name: 'truncated icosahedron (soccer ball)', V: V.rat(125).add(s5.mul(43)).div(4), S: V.of(3 * (10 * Math.sqrt(3) + Math.sqrt(5) * Math.sqrt(5 + 2 * Math.sqrt(5)))), vef: [60, 90, 32], faces: '12 pentagons and 20 hexagons', words: ['truncated icosahedron', 'soccer ball', 'football shape', 'buckyball'] },
];

export function polyhedron(p: Poly): Shape {
  const vars: VarDef[] = [v('a', 'a', 'Edge', 1, { words: ['edge length', 'edge', 'side length', 'side', 'length'], letters: ['a', 's'] }), VOL(), v('S', 'S', 'Surface area', 2, { words: ['surface area', 'total surface area', 'area'], letters: ['S', 'A'] })];
  const rels = [M('V = $k a^3', { k: p.V }), M('S = $k a^2', { k: p.S })];
  if (p.R) {
    vars.push(v('R', 'R', 'Circumradius', 1, { words: ['circumradius', 'circumscribed sphere radius'] }));
    rels.push(M('R = $k a', { k: p.R }));
  }
  if (p.r) {
    vars.push(v('ρ', 'r', 'Inradius', 1, { words: ['inradius', 'inscribed sphere radius'] }));
    rels.push(M('ρ = $k a', { k: p.r }));
  }
  if (p.m) {
    vars.push(v('m', 'm', 'Midradius', 1, { words: ['midradius'] }));
    rels.push(M('m = $k a', { k: p.m }));
  }
  return finalize({
    id: p.id,
    name: p.name,
    threeD: true,
    vars,
    rels,
    basis: ['a'],
    main: 'V',
    positional: ['a'],
    extra: () => {
      const [Vv, E, Fc] = p.vef;
      const lines = [
        { label: 'Vertices, edges, faces', display: `${Vv}, ${E}, ${Fc} (Euler: ${Vv} − ${E} + ${Fc} = 2)` },
        { label: 'Faces', display: p.faces },
      ];
      if (p.dihedral) lines.push({ label: 'Dihedral angle', display: `${p.dihedral.toFixed(4)}°` });
      return lines;
    },
  });
}

export const SHAPES = {
  circle, sector, annulus, ellipse, square, rectangle, rhombus, parallelogram, trapezoid, isoTrapezoid, rightTrapezoid, kite,
  cube, cuboid, cylinder, hollowCylinder, cone, frustum, rectPyramid, pyramidFrustum, sphere, hemisphere, cap, sphericalSector, zone,
  ellipsoid, torus, capsule, wedge, triPrism,
};

void deg;
void ex;
