import { acosDeg, cosDeg, sinDeg, V } from './exact';
import { F, finalize, M, S, type Rel, type Shape, type VarDef } from './solver';

const v = (key: string, sym: string, label: string, dim: VarDef['dim'], o: Partial<VarDef> = {}): VarDef => ({ key, sym, label, dim, ...o });

function lawOfCosines(side: string, x: string, y: string, ang: string, A: string): Rel {
  return F(
    side,
    [x, y, ang],
    (g) => {
      const r = g(x).pow(2).add(g(y).pow(2)).sub(g(x).mul(g(y)).mul(2).mul(cosDeg(g(ang))));
      return r.x > 0 ? r.sqrt() : null;
    },
    `${side} = √(${x}² + ${y}² − 2${x}${y}·cos ${A})`,
    {
      [ang]: {
        f: (g) => {
          const c = g(x).pow(2).add(g(y).pow(2)).sub(g(side).pow(2)).div(g(x).mul(g(y)).mul(2));
          if (c.x < -1 - 1e-12 || c.x > 1 + 1e-12) return null;
          // exact rational cosines of the special angles
          const snapped = acosDeg(c);
          return snapped;
        },
        text: `${A} = acos((${x}² + ${y}² − ${side}²)/(2${x}${y}))`,
      },
    },
  );
}

function lawOfSines(side: string, ang: string, A: string): Rel {
  return F('R', [side, ang], (g) => g(side).div(sinDeg(g(ang)).mul(2)), `R = ${side}/(2·sin ${A})`, {
    [side]: { f: (g) => g('R').mul(2).mul(sinDeg(g(ang))), text: `${side} = 2R·sin ${A} (law of sines)` },
  });
}

function areaSAS(x: string, y: string, ang: string, A: string): Rel {
  return F('K', [x, y, ang], (g) => g(x).mul(g(y)).mul(sinDeg(g(ang))).div(2), `Area = ½${x}${y}·sin ${A}`);
}

function bisector(t: string, x: string, y: string, ang: string, A: string): Rel {
  const T = { ta: 'tₐ', tb: 't_b', tc: 't_c' }[t] ?? t;
  return F(t, [x, y, ang], (g) => g(x).mul(g(y)).mul(2).mul(cosDeg(g(ang).div(2))).div(g(x).add(g(y))), `${T} = 2${x}${y}·cos(${A}/2)/(${x} + ${y})`, undefined, { noNumericInverse: true });
}

const VARS: VarDef[] = [
  v('a', 'a', 'Side a', 1, { letters: ['a'], words: ['side a'] }),
  v('b', 'b', 'Side b', 1, { letters: ['b'], words: ['side b'] }),
  v('c', 'c', 'Side c', 1, { letters: ['c'], words: ['side c'] }),
  v('α', 'A', 'Angle A', 'angle', { letters: ['A', 'α'], words: ['angle a'] }),
  v('β', 'B', 'Angle B', 'angle', { letters: ['B', 'β'], words: ['angle b'] }),
  v('γ', 'C', 'Angle C', 'angle', { letters: ['C', 'γ'], words: ['angle c'] }),
  v('K', 'Area', 'Area', 2, { words: ['area'] }),
  v('P', 'P', 'Perimeter', 1, { words: ['perimeter'], letters: ['P'] }),
  v('s', 's', 'Semi-perimeter', 1, { words: ['semi-perimeter', 'semiperimeter', 'semi perimeter'] }),
  v('ha', 'hₐ', 'Height to side a', 1, { words: ['height to a', 'altitude to a', 'height to side a', 'altitude to side a'] }),
  v('hb', 'h_b', 'Height to side b', 1, { words: ['height to b', 'altitude to b', 'height to side b'] }),
  v('hc', 'h_c', 'Height to side c', 1, { words: ['height to c', 'altitude to c', 'height to side c', 'height', 'altitude'] }),
  v('ma', 'mₐ', 'Median to side a', 1, { words: ['median to a', 'median to side a'] }),
  v('mb', 'm_b', 'Median to side b', 1, { words: ['median to b', 'median to side b'] }),
  v('mc', 'm_c', 'Median to side c', 1, { words: ['median to c', 'median to side c', 'median'] }),
  v('ta', 'tₐ', 'Angle bisector from A', 1, { words: ['bisector from a', 'angle bisector from a'] }),
  v('tb', 't_b', 'Angle bisector from B', 1, { words: ['bisector from b'] }),
  v('tc', 't_c', 'Angle bisector from C', 1, { words: ['bisector from c', 'angle bisector'] }),
  v('R', 'R', 'Circumradius', 1, { words: ['circumradius', 'circumscribed circle radius', 'radius of the circumscribed circle', 'circumcircle radius', 'radius of the circumcircle'], letters: ['R'] }),
  v('r', 'r', 'Inradius', 1, { words: ['inradius', 'inscribed circle radius', 'radius of the inscribed circle', 'incircle radius', 'radius of the incircle'], letters: ['r'] }),
];

const RELS: Rel[] = [
  S('P = a + b + c'),
  M('s = 1/2 P'),
  S('α + β + γ = 180'),
  lawOfCosines('a', 'b', 'c', 'α', 'A'),
  lawOfCosines('b', 'a', 'c', 'β', 'B'),
  lawOfCosines('c', 'a', 'b', 'γ', 'C'),
  lawOfSines('a', 'α', 'A'),
  lawOfSines('b', 'β', 'B'),
  lawOfSines('c', 'γ', 'C'),
  areaSAS('a', 'b', 'γ', 'C'),
  areaSAS('b', 'c', 'α', 'A'),
  areaSAS('a', 'c', 'β', 'B'),
  F('K', ['a', 'b', 'c', 's'], (g) => {
    const s = g('s');
    const q = s.mul(s.sub(g('a'))).mul(s.sub(g('b'))).mul(s.sub(g('c')));
    return q.x > 0 ? q.sqrt() : null;
  }, 'Area = √(s(s − a)(s − b)(s − c)) (Heron)', undefined, { noNumericInverse: true }),
  M('K = 1/2 a ha'),
  M('K = 1/2 b hb'),
  M('K = 1/2 c hc'),
  S('ma^2 = 1/2 b^2 + 1/2 c^2 - 1/4 a^2'),
  S('mb^2 = 1/2 a^2 + 1/2 c^2 - 1/4 b^2'),
  S('mc^2 = 1/2 a^2 + 1/2 b^2 - 1/4 c^2'),
  bisector('ta', 'b', 'c', 'α', 'A'),
  bisector('tb', 'a', 'c', 'β', 'B'),
  bisector('tc', 'a', 'b', 'γ', 'C'),
  M('K = r s'),
];

function extra(g: (k: string) => V | undefined) {
  const [a, b, c] = [g('a')?.x, g('b')?.x, g('c')?.x];
  if (!a || !b || !c) return [];
  const sides = [a, b, c].sort((x, y) => x - y);
  const eq = (x: number, y: number) => Math.abs(x - y) < 1e-9 * Math.max(x, y);
  const kind = eq(a, b) && eq(b, c) ? 'equilateral' : eq(a, b) || eq(b, c) || eq(a, c) ? 'isosceles' : 'scalene';
  const big = sides[2]! ** 2;
  const rest = sides[0]! ** 2 + sides[1]! ** 2;
  const ang = eq(big, rest) ? 'right' : big > rest ? 'obtuse' : 'acute';
  return [{ label: 'Type', display: `${kind}, ${ang}` }];
}

function check(g: (k: string) => V | undefined): string | null {
  const [a, b, c] = [g('a')?.x, g('b')?.x, g('c')?.x];
  if (!a || !b || !c) return null;
  const s = [a, b, c].sort((x, y) => x - y);
  if (s[0]! + s[1]! <= s[2]! * (1 + 1e-12)) return `Sides ${s.map((x) => +x.toPrecision(6)).join(', ')} can't form a triangle: ${+s[0]!.toPrecision(6)} + ${+s[1]!.toPrecision(6)} ${s[0]! + s[1]! === s[2]! ? '=' : '<'} ${+s[2]!.toPrecision(6)} (triangle inequality)`;
  return null;
}

export type TriKind = 'general' | 'right' | 'isosceles' | 'equilateral';

export function triangleShape(kind: TriKind): Shape {
  const rels: Rel[] = [];
  const fixed: Record<string, V> = {};
  let basis = ['a', 'b', 'c'];
  let positional = ['a', 'b', 'c'];
  let name = 'triangle';
  const notes: string[] = ['Side a is opposite angle A, b opposite B, c opposite C'];
  if (kind === 'right') {
    fixed['γ'] = V.rat(90);
    rels.push(S('c^2 = a^2 + b^2'));
    basis = ['a', 'b'];
    positional = ['a', 'b'];
    name = 'right triangle';
    notes[0] = 'Right angle at C: legs a and b, hypotenuse c; angle A is opposite leg a';
  } else if (kind === 'isosceles') {
    rels.push(S('b = a'), S('a^2 = hc^2 + 1/4 c^2'), S('α = β'));
    basis = ['a', 'c'];
    positional = ['a', 'c'];
    name = 'isosceles triangle';
    notes[0] = 'Equal sides a = b, base c; base angles A = B';
  } else if (kind === 'equilateral') {
    rels.push(S('b = a'), S('c = a'));
    fixed['α'] = V.rat(60);
    fixed['β'] = V.rat(60);
    fixed['γ'] = V.rat(60);
    basis = ['a'];
    positional = ['a'];
    name = 'equilateral triangle';
    notes[0] = 'All sides equal (a = b = c), all angles 60°';
  }
  rels.push(...RELS);
  const vars = VARS.map((x) => ({ ...x }));
  if (kind === 'right') {
    vars.find((x) => x.key === 'a')!.words = ['side a', 'leg a', 'first leg', 'leg', 'opposite side', 'opposite', 'height', 'vertical leg'];
    vars.find((x) => x.key === 'b')!.words = ['side b', 'leg b', 'second leg', 'other leg', 'adjacent side', 'adjacent', 'base', 'horizontal leg'];
    vars.find((x) => x.key === 'c')!.words = ['hypotenuse', 'hyp', 'side c'];
    vars.find((x) => x.key === 'α')!.words = ['angle a', 'angle', 'acute angle', 'angle of elevation', 'angle of depression'];
    vars.find((x) => x.key === 'hc')!.words = ['altitude to the hypotenuse', 'height to the hypotenuse'];
  }
  if (kind === 'isosceles') {
    vars.find((x) => x.key === 'a')!.words = ['equal sides', 'equal side', 'legs', 'leg', 'side', 'sides'];
    vars.find((x) => x.key === 'c')!.words = ['base'];
    vars.find((x) => x.key === 'γ')!.words = ['apex angle', 'vertex angle', 'top angle'];
    vars.find((x) => x.key === 'α')!.words = ['base angle', 'base angles'];
  }
  if (kind === 'equilateral') vars.find((x) => x.key === 'a')!.words = ['side length', 'side', 'sides', 'edge', 'length'];
  if (kind === 'general') vars.find((x) => x.key === 'c')!.words = ['side c', 'base'];
  return finalize({
    id: 'triangle',
    name,
    vars,
    rels,
    basis,
    fixed,
    main: 'K',
    positional,
    notes,
    extra,
    check,
  });
}
