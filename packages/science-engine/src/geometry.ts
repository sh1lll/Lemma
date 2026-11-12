import { D, formatNumber, type AnswerResult, type Dec } from '@lemma/math-core';
import { disp, fail, fracForm, need, NUM, num, ok, PI, piForm, radicalForm, show, SNUM, type Ctx } from './util';

type Kind2 = 'area' | 'perimeter' | 'volume' | 'surface' | 'diagonal' | 'lateral' | 'circumference';

interface Measure {
  key: Kind2 | string;
  label: string;
  value: Dec;
  /** Exact multiple of π, when the value is coef·π. */
  pi?: Dec;
  /** Exact radical text such as "5√2". */
  radical?: string;
  /** 1 = length, 2 = area, 3 = volume, 0 = dimensionless/angle. */
  power: 0 | 1 | 2 | 3;
  formula: string;
  approx?: boolean;
}

const LEN_UNITS: Record<string, string> = {
  mm: 'mm', millimeter: 'mm', millimeters: 'mm', millimetre: 'mm', millimetres: 'mm',
  cm: 'cm', centimeter: 'cm', centimeters: 'cm', centimetre: 'cm', centimetres: 'cm',
  m: 'm', meter: 'm', meters: 'm', metre: 'm', metres: 'm',
  km: 'km', kilometer: 'km', kilometers: 'km', kilometre: 'km', kilometres: 'km',
  inches: 'in', inch: 'in', ft: 'ft', feet: 'ft', foot: 'ft', yd: 'yd', yard: 'yd', yards: 'yd', mi: 'mi', mile: 'mi', miles: 'mi',
};
const UNIT_SRC = Object.keys(LEN_UNITS).sort((a, b) => b.length - a.length).join('|');
const VAL = String.raw`(${NUM})(?:\s*(${UNIT_SRC})\b)?`;

interface Dims {
  units: Set<string>;
  get(words: string, letters?: string): Dec | null;
  list(): Dec[];
}

/** Reads labelled dimensions: "radius 5", "r=5", "radius of 5 cm", plus bare numbers in order. */
function dims(c: Ctx): Dims {
  const s = c.s;
  const units = new Set<string>();
  const note = (u?: string) => u && units.add(LEN_UNITS[u]!);
  return {
    units,
    get(words: string, letters?: string) {
      const re = new RegExp(`(?:\\b(?:${words})\\b(?:\\s+(?:of|is|=|:|equal to|length))*\\s*|(?<![a-z])(?:${letters ?? '(?!)'})\\s*[=:]\\s*)${VAL}`);
      const m = re.exec(s);
      if (!m) return null;
      note(m[2]);
      return num(m[1]!);
    },
    list() {
      const out: Dec[] = [];
      for (const m of s.matchAll(new RegExp(`(?<![\\w.(,])${VAL}(?!\\s*,\\s*\\d+\\s*\\))`, 'g'))) {
        note(m[2]);
        out.push(num(m[1]!));
      }
      return out;
    },
  };
}

const sup = (p: number) => (p === 2 ? '²' : p === 3 ? '³' : '');

function render(m: Measure, unit: string) {
  const u = m.power ? (unit ? unit + sup(m.power) : '') : '';
  const f = show(m.value);
  const exact = m.pi ? piForm(m.pi) : m.radical && m.radical !== f.plain ? m.radical : null;
  const display = exact ? `${exact} ≈ ${formatNumber(m.value, { digits: 6 }).display}` : `${m.approx ? '≈ ' : ''}${f.display}`;
  return { display, plain: f.plain, spoken: `${exact ? `${exact.replace('π', ' pi ').replace('√', ' root ').replace(/\s+/g, ' ').trim()}, about ` : ''}${formatNumber(m.value, { digits: 6 }).spoken}${u ? ` ${spokenUnit(u)}` : ''}`, unit: u || undefined };
}

function spokenUnit(u: string): string {
  const base = u.replace(/[²³]/, '');
  const names: Record<string, string> = { mm: 'millimetres', cm: 'centimetres', m: 'metres', km: 'kilometres', in: 'inches', ft: 'feet', yd: 'yards', mi: 'miles' };
  const pre = u.endsWith('²') ? 'square ' : u.endsWith('³') ? 'cubic ' : '';
  return pre + (names[base] ?? base);
}

const MEASURE_WORDS: [Kind2, RegExp][] = [
  ['surface', /surface area|total area|\bsa\b/],
  ['lateral', /lateral (?:surface )?area|curved surface/],
  ['volume', /\bvolume|capacity|how much (?:water|liquid) .*hold/],
  ['circumference', /circumference/],
  ['perimeter', /perimeter|around the edge/],
  ['diagonal', /diagonal/],
  ['area', /\barea\b/],
];

function answer(c: Ctx, shape: string, ms: Measure[], unit: string, threeD: boolean, extraNotes: string[] = []): AnswerResult {
  const s = c.s;
  const hits = MEASURE_WORDS.map(([k, re]) => [k, re.exec(s)?.index ?? Infinity] as const).filter(([, i]) => i < Infinity);
  // "surface area" also contains "area"; prefer the longer phrase at the same place.
  hits.sort((a, b) => a[1] - b[1]);
  let want: string = hits[0]?.[0] ?? (threeD ? 'volume' : 'area');
  if (want === 'circumference' && !ms.some((m) => m.key === 'circumference')) want = 'perimeter';
  if (want === 'perimeter' && !ms.some((m) => m.key === 'perimeter') && ms.some((m) => m.key === 'circumference')) want = 'circumference';
  if (want === 'area' && threeD) want = 'surface';
  const main = ms.find((m) => m.key === want);
  if (!main) {
    if (want === 'perimeter') return need(c, 'geometry', `For the perimeter of the ${shape} I also need the slanted side lengths`);
    return fail(c, 'geometry', `A ${shape} has no ${want === 'surface' ? 'surface area' : want} in that sense`);
  }
  const p = render(main, unit);
  const notes = [...extraNotes];
  if (!unit) notes.push('No unit given; results are in the same unit (squared/cubed)');
  if (main.pi || ms.some((m) => m.pi)) notes.push('π ≈ 3.14159265358979');
  return ok(c, {
    kind: 'geometry',
    expression: `${main.label} of ${shape}`,
    primary: p,
    value: main.value,
    lines: [{ label: 'Formula', display: main.formula }, ...ms.filter((m) => m !== main).map((m) => ({ label: m.label, display: `${render(m, unit).display}${m.power && unit ? ` ${unit}${sup(m.power)}` : ''}` }))],
    notes,
  });
}

const sqrtR = (x: Dec): Pick<Measure, 'value' | 'radical'> => ({ value: x.sqrt(), radical: radicalForm(x) ?? undefined });

// ---------- shapes ----------
const POLY: Record<string, number> = { triangle: 3, 'equilateral triangle': 3, pentagon: 5, hexagon: 6, heptagon: 7, septagon: 7, octagon: 8, nonagon: 9, decagon: 10, hendecagon: 11, dodecagon: 12 };

export function shapes(c: Ctx): AnswerResult | null {
  const s = c.s;
  const shape = /\b(square pyramid|rectangular pyramid|pyramid|cone|cylinder|hemisphere|sphere|ball|cube|rectangular prism|rectangular box|rectangular solid|cuboid|box|circle|disc|disk|ellipse|oval|trapezoid|trapezium|parallelogram|regular polygon|polygon|pentagon|hexagon|heptagon|septagon|octagon|nonagon|decagon|hendecagon|dodecagon|equilateral triangle|rectangle|square)\b/.exec(s)?.[1];
  if (!shape) return null;
  // "square root of 16", "cube root of 27", "square 5", "the square of 5" are arithmetic, not shapes: a square or cube
  // is only a shape when a geometric quantity is named.
  if ((shape === 'square' || shape === 'cube') && (/\b(?:square|cube) roots?\b/.test(s) || !/\b(?:area|perimeter|volume|surface|diagonal|lateral|sides?|edges?|length|width)\b/.test(s))) return null;
  if (!/\b(?:area|perimeter|circumference|volume|surface|diagonal|lateral|of an?|with|radius|diameter|side|r\s*=|d\s*=|by|\d\s*x\s*\d)\b/.test(s) && !/\d/.test(s)) return null;
  const d = dims(c);
  const R = () => {
    const r = d.get('radius', 'r');
    if (r) return r;
    const dia = d.get('diameter', 'd');
    if (dia) return dia.div(2);
    return null;
  };
  const by = new RegExp(`${VAL}\\s*(?:by|x|×|\\*)\\s*${VAL}(?:\\s*(?:by|x|×|\\*)\\s*${VAL})?`).exec(s);
  if (by) for (const u of [by[2], by[4], by[6]]) if (u) d.units.add(LEN_UNITS[u]!);
  const byNums = by ? [by[1], by[3], by[5]].filter((x): x is string => !!x).map(num) : [];
  const unitOf = () => {
    if (d.units.size > 1) return null;
    return [...d.units][0] ?? '';
  };
  const H = () => d.get('height|tall|high|altitude|deep|depth', 'h');
  const result = (name: string, ms: Measure[], threeD: boolean, notes: string[] = []) => {
    const u = unitOf();
    if (u === null) return fail(c, 'geometry', `Mixed units (${[...d.units].join(', ')}); give every length in one unit`);
    return answer(c, name, ms, u, threeD, notes);
  };
  const lonely = () => {
    const l = d.list();
    return l.length === 1 ? l[0]! : null;
  };

  switch (shape) {
    case 'circle':
    case 'disc':
    case 'disk': {
      let r = R();
      const circ = d.get('circumference', 'c');
      if (!r && circ) r = circ.div(PI.mul(2));
      if (!r) {
        if (lonely()) return need(c, 'geometry', `Is ${disp(lonely()!)} the radius or the diameter?`);
        return need(c, 'geometry', 'What is the radius (or diameter) of the circle?');
      }
      return result('circle', [
        { key: 'area', label: 'Area', value: PI.mul(r.pow(2)), pi: circ ? undefined : r.pow(2), power: 2, formula: 'A = πr²' },
        { key: 'circumference', label: 'Circumference', value: PI.mul(r).mul(2), pi: circ ? undefined : r.mul(2), power: 1, formula: 'C = 2πr' },
        { key: 'radius', label: 'Radius', value: r, power: 1, formula: 'r' },
        { key: 'diameter', label: 'Diameter', value: r.mul(2), power: 1, formula: 'd = 2r' },
      ], false);
    }
    case 'square': {
      const a = d.get('side length|side|sides|edge|length', 's|a') ?? lonely();
      if (!a) return need(c, 'geometry', 'What is the side length of the square?');
      return result('square', [
        { key: 'area', label: 'Area', value: a.pow(2), power: 2, formula: 'A = s²' },
        { key: 'perimeter', label: 'Perimeter', value: a.mul(4), power: 1, formula: 'P = 4s' },
        { key: 'diagonal', label: 'Diagonal', ...sqrtR(a.pow(2).mul(2)), power: 1, formula: 'd = s√2' },
      ], false);
    }
    case 'rectangle': {
      const l = d.get('length|long', 'l') ?? byNums[0] ?? null;
      const w = d.get('width|wide|breadth', 'w|b') ?? byNums[1] ?? null;
      if (!l || !w) return need(c, 'geometry', `What is the ${l ? 'width' : 'length'} of the rectangle? (e.g. “5 by 3”)`);
      return result('rectangle', [
        { key: 'area', label: 'Area', value: l.mul(w), power: 2, formula: 'A = l × w' },
        { key: 'perimeter', label: 'Perimeter', value: l.plus(w).mul(2), power: 1, formula: 'P = 2(l + w)' },
        { key: 'diagonal', label: 'Diagonal', ...sqrtR(l.pow(2).plus(w.pow(2))), power: 1, formula: 'd = √(l² + w²)' },
      ], false);
    }
    case 'trapezoid':
    case 'trapezium': {
      const pair = new RegExp(`(?:bases|parallel sides)\\s*(?:of|are|=|:)?\\s*${VAL}\\s*(?:and|,|&)\\s*${VAL}`).exec(s);
      if (pair) for (const u of [pair[2], pair[4]]) if (u) d.units.add(LEN_UNITS[u]!);
      const a = pair ? num(pair[1]!) : d.get('base 1|top|first base', 'a|b1');
      const b = pair ? num(pair[3]!) : d.get('base 2|bottom|second base', 'b|b2');
      const h = H();
      if (!a || !b) return need(c, 'geometry', 'What are the two parallel sides (bases) of the trapezoid?');
      const legs = new RegExp(`(?:legs|slanted sides|other sides)\\s*(?:of|are|=|:)?\\s*${VAL}\\s*(?:and|,|&)\\s*${VAL}`).exec(s);
      const ms: Measure[] = [];
      if (h) ms.push({ key: 'area', label: 'Area', value: a.plus(b).mul(h).div(2), power: 2, formula: 'A = ½(a + b)h' });
      if (legs) ms.push({ key: 'perimeter', label: 'Perimeter', value: a.plus(b).plus(num(legs[1]!)).plus(num(legs[3]!)), power: 1, formula: 'P = a + b + c + d' });
      if (!h && !/perimeter/.test(s)) return need(c, 'geometry', 'What is the height of the trapezoid?');
      return result('trapezoid', ms, false);
    }
    case 'parallelogram': {
      const b = d.get('base', 'b') ?? byNums[0] ?? null;
      const h = H() ?? byNums[1] ?? null;
      const side = d.get('side|slanted side|other side', 'a|s');
      if (!b) return need(c, 'geometry', 'What is the base of the parallelogram?');
      const ms: Measure[] = [];
      if (h) ms.push({ key: 'area', label: 'Area', value: b.mul(h), power: 2, formula: 'A = b × h' });
      if (side) ms.push({ key: 'perimeter', label: 'Perimeter', value: b.plus(side).mul(2), power: 1, formula: 'P = 2(b + a)' });
      if (!h && !/perimeter/.test(s)) return need(c, 'geometry', 'What is the height of the parallelogram?');
      return result('parallelogram', ms, false);
    }
    case 'ellipse':
    case 'oval': {
      const pair = new RegExp(`(?:semi-?axes|semi axes|axes)\\s*(?:of|are|=|:)?\\s*${VAL}\\s*(?:and|,|&|by)\\s*${VAL}`).exec(s);
      let a = pair ? num(pair[1]!) : d.get('semi-?major axis|semimajor axis|major radius', 'a');
      let b = pair ? num(pair[3]!) : d.get('semi-?minor axis|semiminor axis|minor radius', 'b');
      const notes: string[] = [];
      if (pair && /\baxes/.test(pair[0]) && !/semi/.test(pair[0])) {
        a = a!.div(2);
        b = b!.div(2);
        notes.push('Full axis lengths halved to get the semi-axes');
      }
      if (!a || !b) return need(c, 'geometry', 'What are the two semi-axes of the ellipse? (e.g. “semi-axes 5 and 3”)');
      const h = a.minus(b).pow(2).div(a.plus(b).pow(2));
      const perim = PI.mul(a.plus(b)).mul(new D(1).plus(h.mul(3).div(new D(10).plus(new D(4).minus(h.mul(3)).sqrt()))));
      notes.push('Perimeter by Ramanujan’s second approximation (an ellipse’s perimeter has no closed form)');
      return result('ellipse', [
        { key: 'area', label: 'Area', value: PI.mul(a).mul(b), pi: a.mul(b), power: 2, formula: 'A = πab' },
        { key: 'perimeter', label: 'Perimeter', value: perim, power: 1, formula: 'P ≈ π(a + b)(1 + 3h / (10 + √(4 − 3h))), h = (a − b)²/(a + b)²', approx: true },
      ], false, notes);
    }
    case 'regular polygon':
    case 'polygon':
    case 'pentagon':
    case 'hexagon':
    case 'heptagon':
    case 'septagon':
    case 'octagon':
    case 'nonagon':
    case 'decagon':
    case 'hendecagon':
    case 'dodecagon': {
      const nm = /(\d+)\s*(?:sides|-sided|sided)|\bn\s*=\s*(\d+)/.exec(s);
      const n = POLY[shape] ?? (nm ? Number(nm[1] ?? nm[2]) : NaN);
      if (!n) return need(c, 'geometry', 'How many sides does the polygon have?');
      if (n < 3) return fail(c, 'geometry', 'A polygon needs at least 3 sides');
      const a = d.get('side length|side|sides of length|length|edge', 's|a') ?? (() => {
        const l = d.list().filter((x) => !x.eq(n));
        return l.length === 1 ? l[0]! : null;
      })();
      if (!a) return need(c, 'geometry', `What is the side length of the ${shape === 'polygon' || shape === 'regular polygon' ? `${n}-sided polygon` : shape}?`);
      const t = Math.tan(Math.PI / n);
      const area = a.pow(2).mul(n).div(new D(t).mul(4));
      const ms: Measure[] = [
        { key: 'area', label: 'Area', value: area, power: 2, formula: `A = n·s² / (4 tan(π/n)), n = ${n}` },
        { key: 'perimeter', label: 'Perimeter', value: a.mul(n), power: 1, formula: 'P = n·s' },
        { key: 'apothem', label: 'Apothem', value: a.div(new D(t).mul(2)), power: 1, formula: 'a = s / (2 tan(π/n))' },
        { key: 'angle', label: 'Interior angle', value: new D(n - 2).mul(180).div(n), power: 0, formula: '(n − 2)·180° / n' },
      ];
      if (n === 6) ms[0]!.radical = undefined;
      const name = shape === 'polygon' || shape === 'regular polygon' ? `regular ${n}-gon` : `regular ${shape}`;
      return result(name, ms, false, shape === 'polygon' || POLY[shape] ? ['Regular polygon assumed (all sides and angles equal)'] : []);
    }
    case 'sphere':
    case 'ball':
    case 'hemisphere': {
      const r = R() ?? (d.list().length === 1 ? null : null);
      if (!r) return need(c, 'geometry', `What is the radius (or diameter) of the ${shape}?`);
      if (shape === 'hemisphere') {
        return result('hemisphere', [
          { key: 'volume', label: 'Volume', value: PI.mul(r.pow(3)).mul(2).div(3), pi: r.pow(3).mul(2).div(3), power: 3, formula: 'V = ⅔πr³' },
          { key: 'surface', label: 'Surface area', value: PI.mul(r.pow(2)).mul(3), pi: r.pow(2).mul(3), power: 2, formula: 'A = 3πr² (curved + flat face)' },
        ], true);
      }
      return result('sphere', [
        { key: 'volume', label: 'Volume', value: PI.mul(r.pow(3)).mul(4).div(3), pi: r.pow(3).mul(4).div(3), power: 3, formula: 'V = ⁴⁄₃πr³' },
        { key: 'surface', label: 'Surface area', value: PI.mul(r.pow(2)).mul(4), pi: r.pow(2).mul(4), power: 2, formula: 'A = 4πr²' },
        { key: 'circumference', label: 'Great-circle circumference', value: PI.mul(r).mul(2), pi: r.mul(2), power: 1, formula: 'C = 2πr' },
      ], true);
    }
    case 'cylinder': {
      const r = R();
      const h = H();
      if (!r || !h) return need(c, 'geometry', `What is the ${r ? 'height' : 'radius (or diameter)'} of the cylinder?`);
      return result('cylinder', [
        { key: 'volume', label: 'Volume', value: PI.mul(r.pow(2)).mul(h), pi: r.pow(2).mul(h), power: 3, formula: 'V = πr²h' },
        { key: 'surface', label: 'Surface area', value: PI.mul(r).mul(2).mul(r.plus(h)), pi: r.mul(2).mul(r.plus(h)), power: 2, formula: 'A = 2πr(r + h)' },
        { key: 'lateral', label: 'Lateral area', value: PI.mul(r).mul(2).mul(h), pi: r.mul(2).mul(h), power: 2, formula: 'A = 2πrh' },
      ], true);
    }
    case 'cone': {
      const r = R();
      let h = H();
      let l = d.get('slant height|slant', 'l');
      if (!r || (!h && !l)) return need(c, 'geometry', `What is the ${r ? 'height' : 'radius (or diameter)'} of the cone?`);
      if (!l) l = r.pow(2).plus(h!.pow(2)).sqrt();
      if (!h) {
        if (l.lte(r)) return fail(c, 'geometry', 'The slant height must be longer than the radius');
        h = l.pow(2).minus(r.pow(2)).sqrt();
      }
      const clean = (x: Dec) => (x.sd() <= 20 ? x : undefined);
      return result('cone', [
        { key: 'volume', label: 'Volume', value: PI.mul(r.pow(2)).mul(h).div(3), pi: clean(r.pow(2).mul(h).div(3)), power: 3, formula: 'V = ⅓πr²h' },
        { key: 'surface', label: 'Surface area', value: PI.mul(r).mul(r.plus(l)), pi: clean(r.mul(r.plus(l))), power: 2, formula: 'A = πr(r + l), l = √(r² + h²)' },
        { key: 'lateral', label: 'Lateral area', value: PI.mul(r).mul(l), pi: clean(r.mul(l)), power: 2, formula: 'A = πrl' },
        { key: 'slant', label: 'Slant height', value: l, power: 1, formula: 'l = √(r² + h²)' },
      ], true);
    }
    case 'cube': {
      const a = d.get('side length|side|edge length|edge|length', 's|a') ?? lonely();
      if (!a) return need(c, 'geometry', 'What is the edge length of the cube?');
      return result('cube', [
        { key: 'volume', label: 'Volume', value: a.pow(3), power: 3, formula: 'V = s³' },
        { key: 'surface', label: 'Surface area', value: a.pow(2).mul(6), power: 2, formula: 'A = 6s²' },
        { key: 'diagonal', label: 'Space diagonal', ...sqrtR(a.pow(2).mul(3)), power: 1, formula: 'd = s√3' },
      ], true);
    }
    case 'rectangular prism':
    case 'rectangular box':
    case 'rectangular solid':
    case 'cuboid':
    case 'box': {
      const l = d.get('length|long', 'l') ?? byNums[0] ?? null;
      const w = d.get('width|wide|breadth', 'w|b') ?? byNums[1] ?? null;
      const h = H() ?? byNums[2] ?? null;
      if (!l || !w || !h) return need(c, 'geometry', 'Give the length, width and height (e.g. “2 by 3 by 4”)');
      return result('rectangular prism', [
        { key: 'volume', label: 'Volume', value: l.mul(w).mul(h), power: 3, formula: 'V = lwh' },
        { key: 'surface', label: 'Surface area', value: l.mul(w).plus(l.mul(h)).plus(w.mul(h)).mul(2), power: 2, formula: 'A = 2(lw + lh + wh)' },
        { key: 'diagonal', label: 'Space diagonal', ...sqrtR(l.pow(2).plus(w.pow(2)).plus(h.pow(2))), power: 1, formula: 'd = √(l² + w² + h²)' },
      ], true);
    }
    default: {
      // pyramids
      const h = H();
      let l = byNums.length >= 2 ? byNums[0]! : d.get('base side|base edge|base length|base|side', 's|b');
      let w = byNums.length >= 2 ? byNums[1]! : l;
      if (!l) {
        l = d.get('length', 'l');
        w = d.get('width', 'w') ?? l;
      }
      if (!l || !w || !h) return need(c, 'geometry', `What is the ${!h ? 'height' : 'base side'} of the pyramid?`);
      const slantL = w.div(2).pow(2).plus(h.pow(2)).sqrt();
      const slantW = l.div(2).pow(2).plus(h.pow(2)).sqrt();
      const surface = l.mul(w).plus(l.mul(slantL)).plus(w.mul(slantW));
      const notes = [l.eq(w) ? 'Square base, apex above the centre' : 'Rectangular base, apex above the centre'];
      return result(l.eq(w) ? 'square pyramid' : 'rectangular pyramid', [
        { key: 'volume', label: 'Volume', value: l.mul(w).mul(h).div(3), power: 3, formula: 'V = ⅓ × base area × h' },
        { key: 'surface', label: 'Surface area', value: surface, power: 2, formula: 'A = lw + l·√((w/2)² + h²) + w·√((l/2)² + h²)' },
        { key: 'slant', label: 'Slant height', value: slantL, power: 1, formula: 's = √((w/2)² + h²)' },
      ], true, notes);
    }
  }
}

// ---------- Pythagoras ----------
export function hypotenuse(c: Ctx): AnswerResult | null {
  const s = c.s;
  if (!/hypotenuse|pythag|right(?:-angled)? triangle .*legs?|\blegs?\b.*right triangle/.test(s)) return null;
  const hyp = new RegExp(`hypotenuse\\s*(?:is|=|:|of length|length)?\\s*${VAL}`).exec(s);
  const legMode = hyp && /\b(?:leg|side|other|missing|cathetus)\b/.test(s);
  const nums = [...s.matchAll(new RegExp(`(?<![\\w.])${VAL}`, 'g'))].map((m) => num(m[1]!));
  const units = new Set([...s.matchAll(new RegExp(`(?<![\\w.])${VAL}`, 'g'))].map((m) => m[2]).filter(Boolean).map((u) => LEN_UNITS[u!]!));
  if (units.size > 1) return fail(c, 'geometry', 'Give both lengths in the same unit');
  const unit = [...units][0] ?? '';
  if (legMode) {
    const hv = num(hyp[1]!);
    const other = nums.find((x) => !x.eq(hv)) ?? (nums.filter((x) => x.eq(hv)).length > 1 ? hv : null);
    if (!other) return need(c, 'geometry', 'What is the length of the known leg?');
    if (other.gte(hv)) return fail(c, 'geometry', 'The hypotenuse must be longer than the leg');
    const sq = hv.pow(2).minus(other.pow(2));
    const m: Measure = { key: 'leg', label: 'Other leg', ...sqrtR(sq), power: 1, formula: 'b = √(c² − a²)' };
    const p = render(m, unit);
    return ok(c, { kind: 'geometry', expression: `Other leg · hypotenuse ${disp(hv)}, leg ${disp(other)}`, primary: p, value: m.value, lines: [{ label: 'Formula', display: m.formula }], notes: [] });
  }
  if (nums.length < 2) return need(c, 'geometry', 'What are the two legs of the right triangle?');
  const [a, b] = nums as [Dec, Dec];
  const m: Measure = { key: 'hyp', label: 'Hypotenuse', ...sqrtR(a.pow(2).plus(b.pow(2))), power: 1, formula: 'c = √(a² + b²)' };
  const p = render(m, unit);
  const A = (Math.atan2(a.toNumber(), b.toNumber()) * 180) / Math.PI;
  return ok(c, {
    kind: 'geometry',
    expression: `Hypotenuse · legs ${disp(a)} and ${disp(b)}`,
    primary: p,
    value: m.value,
    lines: [{ label: 'Formula', display: 'c = √(a² + b²)' }, { label: 'Area', display: disp(a.mul(b).div(2)) }, { label: 'Angles', display: `${disp(A)}°, ${disp(90 - A)}°, 90°` }],
    notes: [],
  });
}

// ---------- two points ----------
export function points(c: Ctx): AnswerResult | null {
  const pts = [...c.s.matchAll(new RegExp(`\\(\\s*(${SNUM})\\s*,\\s*(${SNUM})\\s*\\)`, 'g'))].map((m) => [num(m[1]!), num(m[2]!)] as const);
  if (pts.length !== 2) return null;
  const s = c.s;
  const which = /midpoint|middle|halfway/.test(s) ? 'mid' : /equation|\bline\b/.test(s) ? 'line' : /slope|gradient/.test(s) ? 'slope' : /distance|length|how far|between/.test(s) ? 'dist' : null;
  if (!which) return null;
  const [[x1, y1], [x2, y2]] = pts as [readonly [Dec, Dec], readonly [Dec, Dec]];
  const dx = x2.minus(x1);
  const dy = y2.minus(y1);
  const P = (x: Dec, y: Dec) => `(${disp(x)}, ${disp(y)})`;
  const expr = `${P(x1, y1)} and ${P(x2, y2)}`;
  const d2 = dx.pow(2).plus(dy.pow(2));
  const dist: Measure = { key: 'd', label: 'Distance', ...sqrtR(d2), power: 0, formula: 'd = √((x₂ − x₁)² + (y₂ − y₁)²)' };
  const vertical = dx.isZero();
  const m = vertical ? null : dy.div(dx);
  const b = m ? y1.minus(m.mul(x1)) : null;
  const lineText = () => {
    if (vertical) return `x = ${fracForm(x1)}`;
    if (m!.isZero()) return `y = ${fracForm(b!)}`;
    const mt = m!.eq(1) ? '' : m!.eq(-1) ? '−' : m!.isInteger() ? fracForm(m!).replace('-', '−') : `(${fracForm(m!).replace('-', '−')})`;
    const bt = b!.isZero() ? '' : ` ${b!.isNegative() ? '−' : '+'} ${fracForm(b!.abs())}`;
    return `y = ${mt}x${bt}`;
  };
  const lines = [
    { label: 'Distance', display: render(dist, '').display },
    { label: 'Midpoint', display: P(x1.plus(x2).div(2), y1.plus(y2).div(2)) },
    { label: 'Slope', display: vertical ? 'undefined (vertical line)' : fracForm(m!).replace('-', '−') },
    { label: 'Line', display: lineText() },
  ];
  if (pts[0]![0].eq(pts[1]![0]) && pts[0]![1].eq(pts[1]![1]) && which !== 'dist' && which !== 'mid') return fail(c, 'geometry', 'The two points are the same, so they don’t define a line');
  switch (which) {
    case 'dist': {
      const p = render(dist, '');
      return ok(c, { kind: 'geometry', expression: `Distance between ${expr}`, primary: p, value: dist.value, lines: [{ label: 'Formula', display: dist.formula }, ...lines.slice(1)], notes: [] });
    }
    case 'mid': {
      const mx = x1.plus(x2).div(2);
      const my = y1.plus(y2).div(2);
      const t = P(mx, my);
      return ok(c, { kind: 'geometry', expression: `Midpoint of ${expr}`, primary: { display: t, plain: t, spoken: `${disp(mx)} comma ${disp(my)}` }, lines: [{ label: 'Formula', display: 'M = ((x₁ + x₂)/2, (y₁ + y₂)/2)' }, lines[0]!, ...lines.slice(2)], notes: [] });
    }
    case 'slope': {
      if (vertical) return fail(c, 'geometry', 'The line through those points is vertical, so its slope is undefined');
      const t = fracForm(m!).replace('-', '−');
      return ok(c, { kind: 'geometry', expression: `Slope through ${expr}`, primary: { display: t, plain: show(m!).plain, spoken: `slope ${show(m!).spoken}` }, value: m!, lines: [{ label: 'Formula', display: 'm = (y₂ − y₁) / (x₂ − x₁)' }, { label: 'Decimal', display: disp(m!) }, lines[3]!], notes: [] });
    }
    default: {
      const t = lineText();
      const extra: { label: string; display: string }[] = [{ label: 'Slope', display: lines[2]!.display }];
      if (!vertical) extra.push({ label: 'y-intercept', display: fracForm(b!).replace('-', '−') });
      if ([x1, y1, x2, y2].every((x) => x.isInteger())) {
        // Standard form Ax + By = C with integers.
        let A = dy.toNumber();
        let B = -dx.toNumber();
        let C = A * x1.toNumber() + B * y1.toNumber();
        const g = gcd3(A, B, C);
        [A, B, C] = [A / g, B / g, C / g];
        if (A < 0 || (A === 0 && B < 0)) [A, B, C] = [-A, -B, -C];
        extra.push({ label: 'Standard form', display: `${A ? `${A === 1 ? '' : A === -1 ? '−' : A}x` : ''}${B ? `${A ? (B < 0 ? ' − ' : ' + ') : B < 0 ? '−' : ''}${Math.abs(B) === 1 ? '' : Math.abs(B)}y` : ''} = ${C < 0 ? '−' : ''}${Math.abs(C)}` });
      }
      return ok(c, { kind: 'geometry', expression: `Line through ${expr}`, primary: { display: t, plain: t.replace(/−/g, '-'), spoken: t.replace(/−/g, 'minus').replace('=', 'equals') }, ...(m ? { value: m } : {}), lines: [{ label: 'Formula', display: 'y − y₁ = m(x − x₁)' }, ...extra], notes: [] });
    }
  }
}

function gcd3(...xs: number[]): number {
  const g2 = (a: number, b: number): number => (b ? g2(b, a % b) : Math.abs(a));
  return xs.reduce((a, b) => g2(a, b)) || 1;
}

// ---------- triangle solver ----------
interface Tri {
  a: number;
  b: number;
  c: number;
  A: number;
  B: number;
  C: number;
}
const rad = (x: number) => (x * Math.PI) / 180;
const deg = (x: number) => (x * 180) / Math.PI;

type Partial6 = Partial<Record<keyof Tri, number>>;

/** Solves a triangle from three of its parts. Returns zero, one or two solutions, or an error string. */
export function solveTriangle(g: Partial6): Tri[] | string {
  const sides = (['a', 'b', 'c'] as const).filter((k) => g[k] !== undefined);
  const angles = (['A', 'B', 'C'] as const).filter((k) => g[k] !== undefined);
  for (const k of sides) if (g[k]! <= 0) return 'Side lengths must be positive';
  for (const k of angles) if (g[k]! <= 0 || g[k]! >= 180) return 'Angles must be between 0° and 180°';
  const sum = angles.reduce((t, k) => t + g[k]!, 0);
  if (angles.length >= 2) {
    if (angles.length === 3 && Math.abs(sum - 180) > 1e-9) return 'The three angles must add up to 180°';
    if (angles.length === 2 && sum >= 180) return 'The angles add up to 180° or more, so no triangle fits';
    if (!sides.length) return 'Angles alone fix only the shape; give at least one side';
    const t: Tri = { a: 0, b: 0, c: 0, A: g.A ?? 180 - sum, B: g.B ?? 180 - sum, C: g.C ?? 180 - sum };
    const k0 = sides[0]!;
    const ratio = g[k0]! / Math.sin(rad(t[k0.toUpperCase() as 'A' | 'B' | 'C']));
    t.a = g.a ?? ratio * Math.sin(rad(t.A));
    t.b = g.b ?? ratio * Math.sin(rad(t.B));
    t.c = g.c ?? ratio * Math.sin(rad(t.C));
    return [t];
  }
  if (sides.length === 3) {
    const { a, b, c } = g as Tri;
    if (a + b <= c || a + c <= b || b + c <= a) return 'Those sides break the triangle inequality (each side must be shorter than the other two combined)';
    const A = deg(Math.acos(clamp((b * b + c * c - a * a) / (2 * b * c))));
    const B = deg(Math.acos(clamp((a * a + c * c - b * b) / (2 * a * c))));
    return [{ a, b, c, A, B, C: 180 - A - B }];
  }
  if (sides.length === 2 && angles.length === 1) {
    const ang = angles[0]!;
    const opp = ang.toLowerCase() as 'a' | 'b' | 'c';
    if (!sides.includes(opp)) {
      // SAS: the angle is between the two known sides.
      const [p, q] = sides as ['a' | 'b' | 'c', 'a' | 'b' | 'c'];
      const third = Math.sqrt(g[p]! ** 2 + g[q]! ** 2 - 2 * g[p]! * g[q]! * Math.cos(rad(g[ang]!)));
      const r = solveTriangle({ [p]: g[p], [q]: g[q], [opp]: third } as Partial6);
      if (typeof r === 'string') return r;
      // Keep the given angle exact.
      return r.map((t) => ({ ...t, [ang]: g[ang]! }));
    }
    // SSA: angle opposite one known side.
    const other = sides.find((k) => k !== opp)!;
    const P = g[ang]!;
    const sinQ = (g[other]! * Math.sin(rad(P))) / g[opp]!;
    if (sinQ > 1 + 1e-12) return 'No triangle has those measurements (the side opposite the angle is too short)';
    const q1 = deg(Math.asin(Math.min(1, sinQ)));
    const cands = [q1, 180 - q1].filter((Q, i) => (i === 0 || Math.abs(Q - q1) > 1e-9) && P + Q < 180 - 1e-12);
    return cands.map((Q) => {
      const Okey = other.toUpperCase() as 'A' | 'B' | 'C';
      const third = (['A', 'B', 'C'] as const).find((k) => k !== ang && k !== Okey)!;
      const R = 180 - P - Q;
      const t: Tri = { a: 0, b: 0, c: 0, A: 0, B: 0, C: 0 };
      t[ang] = P;
      t[Okey] = Q;
      t[third] = R;
      const k = g[opp]! / Math.sin(rad(P));
      t[opp] = g[opp]!;
      t[other] = g[other]!;
      t[third.toLowerCase() as 'a' | 'b' | 'c'] = k * Math.sin(rad(R));
      return t;
    });
  }
  return 'Give three parts of the triangle, including at least one side (SSS, SAS, ASA, AAS or SSA)';
}

const clamp = (x: number) => Math.max(-1, Math.min(1, x));
const angleText = (x: number) => `${new D(x).toDecimalPlaces(2).toString()}°`;

export function triangle(c: Ctx): AnswerResult | null {
  const s = c.s;
  const sym = [...c.t.matchAll(new RegExp(`(?<![A-Za-z])(?:angle\\s+)?([abcABC])\\s*=\\s*(${NUM})\\s*(°|deg(?:rees)?)?`, 'g'))];
  if (!/triangle/.test(s) && sym.length < 3) return null;
  const g: Partial6 = {};
  for (const m of sym) g[m[1] as keyof Tri] = Number(m[2]!.replace(/,/g, ''));
  let mode = '';
  const list = new RegExp(`sides?\\s*(?:of\\s+(?:length\\s+)?|are\\s+|=\\s*|:\\s*|lengths?\\s+)?${VAL}\\s*(?:,|and|,\\s*and)?\\s*${VAL}\\s*(?:,|and|,\\s*and)?\\s*${VAL}`).exec(s);
  const sas = new RegExp(`sides?\\s*(?:of\\s+)?${VAL}\\s*(?:,|and)\\s*${VAL}\\s*(?:,|and|with)?\\s*(?:an?\\s+)?(?:included\\s+)?angle\\s*(?:of|=|between them)?\\s*(${NUM})`).exec(s);
  const asa = new RegExp(`angles?\\s*(?:of\\s+)?(${NUM})\\s*°?\\s*(?:,|and)\\s*(${NUM})\\s*°?\\s*(?:,|and|with)?\\s*(?:an?\\s+)?(included\\s+)?side\\s*(?:of\\s+)?${VAL}\\s*(between them|between)?`).exec(s);
  if (!sym.length) {
    if (list && !sas) {
      g.a = num(list[1]!).toNumber();
      g.b = num(list[3]!).toNumber();
      g.c = num(list[5]!).toNumber();
      mode = 'SSS';
    } else if (sas) {
      g.a = num(sas[1]!).toNumber();
      g.b = num(sas[3]!).toNumber();
      g.C = num(sas[5]!).toNumber();
      mode = 'SAS';
    } else if (asa) {
      if (!asa[3] && !asa[6]) return need(c, 'geometry', 'Is that side between the two angles (ASA) or opposite one of them (AAS)? Say “included side”, or use A=, B=, a= notation');
      g.A = num(asa[1]!).toNumber();
      g.B = num(asa[2]!).toNumber();
      g.c = num(asa[4]!).toNumber();
      mode = 'ASA';
    }
  }
  const nGiven = Object.keys(g).length;
  if (nGiven === 0) {
    // "area of triangle with base 4 and height 3"
    const base = new RegExp(`base\\s*(?:of|is|=|:)?\\s*${VAL}`).exec(s);
    const height = new RegExp(`(?:height|altitude)\\s*(?:of|is|=|:)?\\s*${VAL}`).exec(s);
    if (base && height) {
      const b = num(base[1]!);
      const h = num(height[1]!);
      const units = new Set([base[2], height[2]].filter(Boolean).map((u) => LEN_UNITS[u!]!));
      if (units.size > 1) return fail(c, 'geometry', 'Give base and height in the same unit');
      return answer(c, 'triangle', [{ key: 'area', label: 'Area', value: b.mul(h).div(2), power: 2, formula: 'A = ½ × base × height' }], [...units][0] ?? '', false);
    }
    if (/equilateral/.test(s)) return null; // handled as a regular polygon
    if (/triangle/.test(s) && /area|perimeter|angle|solve/.test(s)) return need(c, 'geometry', 'Give the triangle’s base and height, or its three sides (e.g. “sides 3, 4, 5”)');
    return null;
  }
  if (nGiven < 3) return need(c, 'geometry', 'A triangle needs three parts (sides or angles), including at least one side');
  const sol = solveTriangle(g);
  if (typeof sol === 'string') return fail(c, 'geometry', sol);
  if (!mode) {
    const sides = ['a', 'b', 'c'].filter((k) => k in g).length;
    mode = sides === 3 ? 'SSS' : sides === 2 ? (sol.length !== 1 || ['A', 'B', 'C'].some((K) => K in g && K.toLowerCase() in g) ? 'SSA' : 'SAS') : 'ASA/AAS';
  }
  if (sol.length === 0) return fail(c, 'geometry', 'No triangle has those measurements');
  const area = (t: Tri) => 0.5 * t.a * t.b * Math.sin(rad(t.C));
  if (sol.length === 2) {
    const rows = sol.map((t, i) => [String(i + 1), disp(t.a), disp(t.b), disp(t.c), angleText(t.A), angleText(t.B), angleText(t.C), disp(area(t))]);
    return ok(c, {
      kind: 'geometry',
      expression: `Triangle (SSA, ambiguous case) · ${Object.entries(g).map(([k, v]) => `${k} = ${v}${k === k.toUpperCase() ? '°' : ''}`).join(', ')}`,
      primary: { display: 'Two triangles fit', plain: '2', spoken: 'two different triangles fit these measurements' },
      table: { caption: 'Both solutions', columns: ['#', 'a', 'b', 'c', 'A', 'B', 'C', 'Area'], rows },
      notes: ['Ambiguous case (SSA): two sides and a non-included angle allow two different triangles. Give another part to pick one'],
    });
  }
  const t = sol[0]!;
  // Snap near-integer angles (90.0000000001°).
  for (const k of ['A', 'B', 'C'] as const) if (Math.abs(t[k] - Math.round(t[k])) < 1e-9) t[k] = Math.round(t[k]);
  const A = area(t);
  const per = t.a + t.b + t.c;
  const heron = mode === 'SSS';
  const unknown = (Object.keys(t) as (keyof Tri)[]).filter((k) => !(k in g));
  const wantArea = /\barea\b/.test(s);
  const wantPer = /perimeter/.test(s);
  let primary;
  let value: Dec;
  let exprHead: string;
  if (wantArea || wantPer) {
    let exact: Dec | null = null;
    if (wantArea && heron) {
      const [a, b, cc] = [new D(String(g.a)), new D(String(g.b)), new D(String(g.c))];
      const sp = a.plus(b).plus(cc).div(2);
      exact = sp.mul(sp.minus(a)).mul(sp.minus(b)).mul(sp.minus(cc)).sqrt();
    }
    value = wantArea ? exact ?? new D(A) : new D(per);
    const f = show(value);
    primary = { display: f.display, plain: f.plain, spoken: f.spoken };
    exprHead = wantArea ? 'Area of triangle' : 'Perimeter of triangle';
  } else {
    const parts = unknown.map((k) => (k === k.toUpperCase() ? `${k} = ${angleText(t[k])}` : `${k} = ${disp(t[k])}`));
    const text = parts.join(', ');
    value = new D(t[unknown[0]!]);
    primary = { display: text, plain: text, spoken: text.replace(/°/g, ' degrees').replace(/=/g, 'equals') };
    exprHead = 'Solve triangle';
  }
  const lines = [
    { label: 'Method', display: heron ? 'Law of cosines (angles); Heron’s formula (area)' : mode === 'SAS' ? 'Law of cosines, then law of sines' : mode === 'SSA' ? 'Law of sines (single solution)' : 'Angle sum 180°, then law of sines' },
    ...(['a', 'b', 'c'] as const).map((k) => ({ label: `Side ${k}`, display: disp(t[k]) })),
    ...(['A', 'B', 'C'] as const).map((k) => ({ label: `Angle ${k}`, display: `${disp(t[k])}°` })),
    { label: 'Area', display: disp(A) },
    { label: 'Perimeter', display: disp(per) },
  ];
  if (heron) lines.push({ label: 'Heron', display: `A = √(s(s − a)(s − b)(s − c)), s = ${disp(per / 2)}` });
  return ok(c, {
    kind: 'geometry',
    expression: `${exprHead} (${mode}) · ${Object.entries(g).map(([k, v]) => `${k} = ${v}${k === k.toUpperCase() ? '°' : ''}`).join(', ')}`,
    primary,
    value,
    lines,
    notes: ['Angles in degrees; side a is opposite angle A, and so on'],
  });
}
