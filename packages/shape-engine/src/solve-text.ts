import type { AnswerResult } from '@lemma/math-core';
import { V } from './exact';
import { shapeFigure } from './figure';
import { answer, fail, need, primaryOf, show, toDec, type Dimension } from './format';
import { POLY_N, POLYHEDRA, polyhedron, prism, pyramid, regularPolygon, SHAPES } from './shapes';
import { solveShape, type Known, type Shape, type SolveState } from './solver';
import { numbers, type Num, type Text } from './text';
import { triangleShape } from './triangle';
import { LENGTH, namedFactor, readUnit, unitText } from './units';

export interface Detected {
  shape: Shape;
  main?: string;
  notes: string[];
  /** Number tokens that were part of the shape's name ("9-gon"). */
  consumed?: [number, number][];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Words that make "square"/"cube" mean something other than the shape. */
export const NOT_SQUARE = /\bsquare\s+(?:roots?|of|units?|feet|foot|ft|metres?|meters?|m|cm|mm|km|inch(?:es)?|in|yards?|yd|miles?|mi|centimet\w*|millimet\w*|kilomet\w*|numbers?|matrix|wave|brackets?|free|deal)\b|\bsquared\b|\b(?:perfect|completing the|complete the|least|chi|mean) squares?\b/;
const NOT_CUBE = /\bcube\s+(?:roots?|of)\b|\bcubed\b|\bcubic\s+(?:equation|function|polynomial|spline|regression|root)/;

/** Picks the shape the question is about. Order matters: longer, more specific names first. */
export function detectShape(s: string): Detected | null {
  const notes: string[] = [];
  const m = (re: RegExp) => re.test(s);
  const nFromText = (): number | null => {
    const g = /\b(\d{1,3})\s*-?\s*(?:gon|sided|sides?)\b(?!\s*(?:of|are|is|=|:|\d))/.exec(s) ?? /\bn\s*=\s*(\d{1,3})\b/.exec(s) ?? /\bwith\s+(\d{1,3})\s+(?:equal\s+)?sides\b/.exec(s);
    const n = g ? Number(g[1]) : null;
    return n && n >= 3 && n <= 1000 ? n : null;
  };
  const named = Object.keys(POLY_N).sort((a, b) => b.length - a.length).find((w) => new RegExp(`\\b${w}s?\\b`).test(s) && w !== 'triangle' && w !== 'square');
  const nRe = (w: string) => new RegExp(`\\b(${Object.keys(POLY_N).map((k) => k.replace(/on$/, 'onal').replace(/le$/, 'ular').replace(/^square$/, 'square')).join('|')}|triangular|square|rectangular)\\s+${w}`);
  const adjN = (w: string): number | null => {
    const g = nRe(w).exec(s);
    if (!g) return null;
    const a = g[1]!;
    if (a === 'triangular') return 3;
    if (a === 'square') return 4;
    if (a === 'rectangular') return -1;
    const base = Object.keys(POLY_N).find((k) => k.replace(/on$/, 'onal').replace(/le$/, 'ular') === a);
    return base ? POLY_N[base]! : null;
  };

  // --- solids ---
  if (m(/\b(?:hollow cylinder|cylindrical shell|hollow pipe|pipe|tube|hollow tube)\b/)) return { shape: SHAPES.hollowCylinder, notes };
  if (m(/\bspherical cap\b|\bcap of a sphere\b|\bdome\b/)) return { shape: SHAPES.cap, notes };
  if (m(/\bspherical sector\b/)) return { shape: SHAPES.sphericalSector, notes };
  if (m(/\bspherical (?:segment|zone)\b|\bzone of a sphere\b/)) return { shape: SHAPES.zone, notes };
  if (m(/\bhemi-?spher\w*|\bhalf(?:\s+a|-)?\s*sphere\b|\bbowl\b/)) return { shape: SHAPES.hemisphere, notes };
  if (m(/\bellipsoid|\bspheroid|\bprolate\b|\boblate\b/)) return { shape: SHAPES.ellipsoid, notes };
  if (m(/\bspheres?\b|\bballs?\b|\bglobe\b|\bspherical\b(?!\s+(?:triangle|law|excess|trig))/)) return { shape: SHAPES.sphere, notes };
  if (m(/\btorus\b|\bdonut\b|\bdoughnut\b/)) return { shape: SHAPES.torus, notes };
  if (m(/\bcapsule\b|\bspherocylinder\b|\bpill shape\b/)) return { shape: SHAPES.capsule, notes };
  if (m(/\bwedge\b|\bramp\b/)) return { shape: SHAPES.wedge, notes };
  if (m(/\bfrustum\b|\btruncated (?:cone|pyramid)\b/)) {
    if (m(/pyramid|square/)) return { shape: SHAPES.pyramidFrustum, notes };
    return { shape: SHAPES.frustum, notes };
  }
  for (const p of POLYHEDRA) if (p.words.some((w) => new RegExp(`\\b${esc(w)}\\b`).test(s))) return { shape: polyhedron(p), notes };
  if (m(/\bpyramid\b/)) {
    const n = adjN('pyramid') ?? nFromText();
    if (n === -1) return { shape: SHAPES.rectPyramid, notes };
    if (!n) notes.push('No base shape given; taking a square base');
    return { shape: pyramid(n ?? 4, `${n === 3 ? 'triangular' : n === 4 || !n ? 'square' : `regular ${n}-gon`} pyramid`), notes };
  }
  if (m(/\bcones?\b|\bconical\b/)) return { shape: SHAPES.cone, notes };
  if (m(/\bcylinders?\b|\bcylindrical\b|\bcans?\b(?!\s*(?:i|you|we|it|this|that)\b)/)) return { shape: SHAPES.cylinder, notes };
  if (m(/\bcubes?\b/) && !m(NOT_CUBE)) return { shape: SHAPES.cube, notes };
  if (m(/\b(?:cuboid|rectangular (?:prism|box|solid|block|tank|container)|box|brick|shoebox|rectangular parallelepiped)\b/)) return { shape: SHAPES.cuboid, notes };
  if (m(/\bprism\b/)) {
    const n = adjN('prism') ?? nFromText();
    if (n === -1) return { shape: SHAPES.cuboid, notes };
    if (n === 3 && !m(/\b(?:regular|equilateral)\b/)) return { shape: SHAPES.triPrism, notes };
    if (!n) return { shape: prism(null, 'prism'), notes };
    return { shape: prism(n, `${n === 3 ? 'triangular' : n === 4 ? 'square' : `regular ${n}-gon`} prism`), notes };
  }

  // --- plane figures ---
  if (m(/\bannulus\b|\bring\b|\bwasher\b/)) return { shape: SHAPES.annulus, notes };
  if (m(/\bsemi-?circle\b|\bhalf(?:\s+a|-)?\s*circle\b/)) return { shape: { ...SHAPES.sector, name: 'semicircle', fixed: { θ: V.rat(180) } }, notes, main: m(/perimeter/) ? 'Ps' : 'As' };
  if (m(/\bquarter(?:\s+of\s+a|-)?\s*circle\b|\bquadrant\b/)) return { shape: { ...SHAPES.sector, name: 'quarter circle', fixed: { θ: V.rat(90) } }, notes, main: m(/perimeter/) ? 'Ps' : 'As' };
  if (m(/\bsectors?\b|\barcs?\b|\bchords?\b|\bsegments?\b|\bsegment of a circle\b|\bcircular segment\b|\bsagitta\b|\bcentral angle\b/) && !m(/\bline segment\b/)) {
    const main = m(/\barc\b/) && !m(/sector area|area of the sector/) ? 's' : m(/\bchord\b/) && !m(/\bsector\b/) ? (m(/segment/) ? 'Ag' : 'c') : m(/\bsegment\b/) ? 'Ag' : 'As';
    return { shape: SHAPES.sector, notes, main };
  }
  if (m(/\bcircles?\b|\bdiscs?\b|\bdisks?\b|\bcircular\b/)) return { shape: SHAPES.circle, notes };
  if (m(/\bellipses?\b|\bovals?\b|\belliptical\b/)) return { shape: SHAPES.ellipse, notes };
  if (m(/\bequilateral triangle\b/)) return { shape: triangleShape('equilateral'), notes };
  if (m(/\bisosceles right(?:-angled)? triangle\b|\b45-45-90\b/)) return { shape: { ...triangleShape('right'), name: 'isosceles right triangle', fixed: { γ: V.rat(90), α: V.rat(45), β: V.rat(45) } }, notes };
  if (m(/\b30-60-90\b/)) return { shape: { ...triangleShape('right'), name: '30-60-90 triangle', fixed: { γ: V.rat(90), α: V.rat(30), β: V.rat(60) } }, notes: ['Angle A = 30° is opposite the short leg a'] };
  if (m(/\bright(?:[- ]angled?)? triangle\b|\bright triangle\b|\bhypotenuse\b|\bpythag\w*/) || (m(/\btriangle\b/) && m(/\blegs?\b/) && !m(/isosceles/))) return { shape: triangleShape('right'), notes };
  if (m(/\bisosceles triangle\b/)) return { shape: triangleShape('isosceles'), notes };
  if (m(/\btriangles?\b/) && !m(/\bpascal/)) return { shape: triangleShape('general'), notes };
  if (m(/\bisosceles trapez\w+/)) return { shape: SHAPES.isoTrapezoid, notes: trapNote(s) };
  if (m(/\bright(?:-angled)? trapez\w+/)) return { shape: SHAPES.rightTrapezoid, notes: trapNote(s) };
  if (m(/\btrapez(?:oid|ium)s?\b/)) return { shape: SHAPES.trapezoid, notes: trapNote(s) };
  if (m(/\bkites?\b|\bdeltoid\b/)) return { shape: SHAPES.kite, notes };
  if (m(/\brhombus|\brhombi\b|\brhomb\b|\bdiamond\b/)) return { shape: SHAPES.rhombus, notes };
  if (m(/\brhomboid\b/)) return { shape: SHAPES.parallelogram, notes: ['A rhomboid is a parallelogram whose adjacent sides differ and angles are not right; solved as a parallelogram'] };
  if (m(/\bparallelograms?\b/)) return { shape: SHAPES.parallelogram, notes };
  if (named) return { shape: regularPolygon(POLY_N[named]!), notes: m(/\bregular\b/) ? notes : [...notes, `Taken as a regular ${named} (all sides and angles equal)`] };
  const sq = s.replace(/\b(?:square|sq\.?)\s+(?:feet|foot|ft|metres?|meters?|m|cm|mm|km|inch(?:es)?|in|yards?|yd|miles?|mi|units?|centimet\w*|millimet\w*|kilomet\w*)\b/g, '');
  if (/\bsquares?\b/.test(sq) && !NOT_SQUARE.test(sq)) return { shape: SHAPES.square, notes };
  if (m(/\brectangles?\b|\brectangular\b|\boblong\b/)) return { shape: SHAPES.rectangle, notes };
  if (m(/\b(?:regular )?polygon\b|\b\d+-?gon\b|\bn-?gon\b/)) {
    const n = nFromText();
    if (!m(/\bregular\b/) && !n) notes.push('Taken as a regular polygon; for an irregular one, give its vertices as coordinates');
    return { shape: regularPolygon(n), notes };
  }
  return null;
}

function trapNote(s: string): string[] {
  return /trapezium/.test(s)
    ? ['“Trapezium” here means one pair of parallel sides (UK/Commonwealth usage; in US usage a trapezium has no parallel sides, and this is a trapezoid)']
    : [];
}

// ---------- plural names ----------

function plurals(shape: Shape): [string[], string[]][] {
  const id = shape.id;
  const P: [string[], string[]][] = [];
  if (id === 'triangle') {
    if (shape.name.startsWith('right')) P.push([['legs', 'two legs', 'shorter sides', 'perpendicular sides'], ['a', 'b']]);
    if (shape.name.startsWith('isosceles')) P.push([['equal sides', 'legs'], ['a']]);
    P.push([['sides', 'side lengths', 'three sides', 'two sides'], ['a', 'b', 'c']]);
    P.push([['angles', 'two angles', 'three angles'], ['α', 'β', 'γ']]);
  }
  if (id.includes('trapezoid')) P.push([['bases', 'parallel sides', 'two bases'], ['a', 'b']]);
  if (id === 'trapezoid') P.push([['legs', 'non-parallel sides'], ['c', 'd']]);
  if (id === 'rhombus' || id === 'kite') P.push([['diagonals', 'two diagonals'], ['p', 'q']]);
  if (id === 'kite') P.push([['sides', 'side lengths'], ['a', 'b']]);
  if (id === 'parallelogram') {
    P.push([['diagonals'], ['d1', 'd2']]);
    P.push([['sides', 'side lengths', 'adjacent sides'], ['a', 'b']]);
  }
  if (id === 'rectangle') P.push([['sides', 'dimensions', 'side lengths'], ['l', 'w']]);
  if (id === 'cuboid' || id === 'wedge') P.push([['dimensions', 'sides', 'edges', 'edge lengths'], ['l', 'w', 'h']]);
  if (id === 'annulus' || id === 'frustum' || id === 'torus' || id === 'hollow-cylinder') P.push([['radii', 'two radii'], ['R', 'r']]);
  if (id === 'hollow-cylinder' || id === 'annulus') P.push([['diameters'], ['Do', 'di']]);
  if (id === 'ellipse') P.push([['semi-axes', 'semi axes', 'semiaxes', 'axes lengths'], ['a', 'b']]);
  if (id === 'ellipse') P.push([['axes'], ['Ma', 'mi']]);
  if (id === 'ellipsoid') P.push([['semi-axes', 'semi axes', 'semiaxes', 'axes', 'radii'], ['a', 'b', 'c']]);
  if (id === 'pyramid-frustum') P.push([['edges', 'sides', 'base edges', 'bases'], ['a', 'b']]);
  if (id === 'spherical-segment') P.push([['radii'], ['a', 'b']]);
  return P;
}

// ---------- reading the measurements ----------

const CONNECT = String.raw`^(?:\s*(?:of|is|are|was|=|:|equals?|equal to|measuring|measures?|length|lengths|being|at|about|approximately|approx|exactly|roughly|around|the|its|a|an|value|given as|set to|≈|~|has|which is|that is|base|circle|each)(?![a-z]))*\s*`;
const CONNECT_RE = new RegExp(CONNECT);
const SEP_RE = /^\s*(?:,\s*(?:and\s+)?|and\s+|&\s*|by\s+|x\s*|×\s*|\s+)/;

interface Occ {
  start: number;
  end: number;
  keys: string[];
  post?: boolean;
}

export interface Extracted {
  assigned: Map<string, Num>;
  requested: string[];
  notes: string[];
}

export function extract(t: Text, shape: Shape, skip: [number, number][] = []): Extracted {
  const s = t.s;
  const skips: [number, number][] = [...skip, ...[...s.matchAll(/\b\d+-\d+-\d+\b|\b\d+\s*-?\s*(?:gon|sided)\b/g)].map((m) => [m.index!, m.index! + m[0].length] as [number, number])];
  const nums = numbers(s).filter((n) => !skips.some(([a, b]) => n.start < b && n.end > a));
  const notes: string[] = [];
  const assigned = new Map<string, Num>();
  const requested: string[] = [];
  const visible = shape.vars.filter((v) => !v.hidden && !(shape.fixed && v.key in shape.fixed));

  // alias → keys
  const words: [string, string[], boolean][] = [];
  for (const [ws, keys] of plurals(shape)) for (const w of ws) words.push([w, keys.filter((k) => !(shape.fixed && k in shape.fixed)), false]);
  for (const v of visible) {
    for (const w of v.words ?? []) words.push([w, [v.key], false]);
    for (const w of v.post ?? []) words.push([w, [v.key], true]);
  }
  words.sort((a, b) => b[0].length - a[0].length);
  const occs: Occ[] = [];
  const taken = (a: number, b: number) => occs.some((o) => a < o.end && b > o.start);
  for (const [w, keys, post] of words) {
    const re = new RegExp(`(?:^|[^a-z0-9])(${esc(w)})(?![a-z])`, 'g');
    for (const mm of s.matchAll(re)) {
      const start = mm.index! + mm[0].length - mm[1]!.length;
      const end = start + mm[1]!.length;
      if (!taken(start, end)) occs.push({ start, end, keys, post });
    }
  }
  const lets = new Set(visible.flatMap((v) => v.letters ?? []));
  const caseSensitive = shape.id === 'triangle' || (lets.has('R') && lets.has('r')) || (lets.has('a') && lets.has('A'));
  for (const v of visible) {
    for (const L of v.letters ?? []) {
      const re = new RegExp(`(?:^|[^A-Za-z0-9_'])(?:angle\\s+|∠\\s*)?(${esc(L)})\\s*(?:=|:)`, caseSensitive ? 'g' : 'gi');
      for (const mm of t.t.matchAll(re)) {
        const end = mm.index! + mm[0].length;
        const start = end - mm[0].replace(/^[^A-Za-z∠]/, '').length;
        if (!taken(start, end)) occs.push({ start, end, keys: [v.key] });
      }
    }
  }
  occs.sort((a, b) => a.start - b.start);
  const numAt = (pos: number) => nums.find((n) => n.start === pos && !n.used);
  for (const o of occs) {
    const keys = o.keys.filter((k) => !assigned.has(k));
    if (!keys.length) continue;
    let got = false;
    if (!o.post) {
      const c = CONNECT_RE.exec(s.slice(o.end))!;
      let pos = o.end + c[0].length;
      let n = numAt(pos);
      if (n) {
        let i = 0;
        while (n && i < keys.length) {
          assigned.set(keys[i]!, n);
          n.used = true;
          i++;
          const sep = SEP_RE.exec(s.slice(n.end));
          if (!sep || i >= keys.length) break;
          pos = n.end + sep[0].length;
          n = numAt(pos);
        }
        // a plural with fewer numbers than names: "sides 5 and 7" for a triangle fills a, b
        got = true;
      }
    }
    if (!got) {
      // "4 cm radius", "10 m tall"
      const before = [...nums].reverse().find((n) => !n.used && n.end <= o.start && (o.post || s.slice(o.start, o.end).startsWith('from') || (n.unit && n.unit.dim === shape.vars.find((v) => v.key === keys[0])?.dim)) && /^\s*(?:-|of|a|an)?\s*$/.test(s.slice(n.end, o.start)));
      if (before && keys.length === 1) {
        assigned.set(keys[0]!, before);
        before.used = true;
        got = true;
      }
    }
    if (!got && !o.post) for (const k of keys) if (!requested.includes(k)) requested.push(k);
  }
  // Cues without a measurement name
  const cue: [RegExp, string[]][] = [
    [/how (?:tall|high|deep)/, ['h', 'th']],
    [/how long|how far/, ['l', 'h', 's', 'a']],
    [/how wide/, ['w']],
    [/how much (?:\w+ )*(?:hold|fit|contain)|how much (?:water|liquid|space|air|sand|soil|concrete|paint)/, ['V']],
    [/how many sides/, ['n']],
    [/how big/, [shape.main]],
  ];
  for (const [re, ks] of cue) if (re.test(s)) for (const k of ks) if (visible.some((v) => v.key === k) && !requested.includes(k)) requested.unshift(k);

  // Unlabelled numbers with telling units (cm² is an area, cm³ a volume, ° an angle)
  for (const n of nums) {
    if (n.used || !n.unit) continue;
    const d = n.unit.dim;
    const target =
      d === 2 ? visible.find((v) => v.dim === 2 && !assigned.has(v.key) && ['A', 'K', 'S', 'As'].includes(v.key)) :
      d === 3 ? visible.find((v) => v.dim === 3 && !assigned.has(v.key)) :
      d === 'angle' ? visible.find((v) => v.dim === 'angle' && !assigned.has(v.key)) : undefined;
    if (target) {
      assigned.set(target.key, n);
      n.used = true;
    }
  }
  // Remaining bare numbers fill the shape's natural parameters in order.
  const rest = nums.filter((n) => !n.used && !(n.unit && n.unit.dim === 'angle'));
  if (rest.length && shape.positional) {
    const slots = shape.positional.filter((k) => !assigned.has(k));
    const used: string[] = [];
    for (const n of rest) {
      const k = slots.shift();
      if (!k) break;
      assigned.set(k, n);
      n.used = true;
      const def = shape.vars.find((v) => v.key === k)!;
      used.push(`${def.label.toLowerCase()} ${n.raw}`);
    }
    if (used.length) notes.push(`Read the unlabelled number${used.length > 1 ? 's' : ''} as ${used.join(', ')}`);
  }
  return { assigned, requested, notes };
}

// ---------- units ----------

export function chooseBase(nums: Num[]): { base: string; named?: string } {
  for (const n of nums) if (n.unit && typeof n.unit.dim === 'number' && !n.unit.named) return { base: n.unit.unit };
  for (const n of nums)
    if (n.unit?.named) {
      const named = n.unit.named;
      return { base: named === 'gal' ? 'in' : named === 'ha' || named === 'acre' ? 'm' : 'cm', named };
    }
  return { base: '' };
}

export function toBase(n: Num, dim: Dimension, base: string, notes: string[]): V {
  const u = n.unit;
  if (dim === 'angle') {
    if (u && u.dim === 'angle') return n.v.mul(u.factor);
    return n.v;
  }
  if (typeof dim !== 'number' || dim === 0 || !u || u.dim === 'angle' || !base) return n.v;
  const baseM = V.dec(LENGTH[base]!.m)!;
  let factor = u.factor;
  if (u.dim !== dim) {
    if (u.dim === 1) {
      factor = u.factor.pow(dim);
      notes.push(`Read “${n.raw} ${u.unit}” as ${unitText(u.unit, dim)}`);
    } else return n.v;
  }
  return n.v.mul(factor).div(baseM.pow(dim));
}

// ---------- the answer ----------

export function solveShapeText(t: Text, det: Detected): AnswerResult | null {
  const shape = det.shape;
  const ex = extract(t, shape, det.consumed);
  if (ex.assigned.size === 0 && !(shape.fixed && Object.keys(shape.fixed).length && ex.requested.length)) {
    if (!ex.requested.length && !/\b(?:area|volume|perimeter|surface|find|solve|calculate|what|how)\b/.test(t.s)) return null;
    const basis = shape.basis.filter((b) => !(shape.fixed && b in shape.fixed)).map((b) => shape.vars.find((v) => v.key === b)!.label.toLowerCase());
    return need(t.input, `Give the ${shape.name}’s measurements, e.g. its ${basis.join(' and ')}`);
  }
  const notes = [...det.notes, ...ex.notes];
  const { base, named } = chooseBase([...ex.assigned.values()]);
  const given = new Map<string, Known>();
  for (const [k, n] of ex.assigned) {
    const def = shape.vars.find((v) => v.key === k)!;
    let val = toBase(n, def.dim, base, notes);
    if (def.dim === 'angle' && !n.unit && n.piForm) val = n.v.mul(V.rat(180).div(V.PI));
    given.set(k, { v: val, how: 'given' });
  }
  for (const [k] of given) {
    const def = shape.vars.find((v) => v.key === k)!;
    const x = given.get(k)!.v.x;
    if (!(x > 0) && !def.signed) return fail(t.input, `${def.label} must be positive`);
  }
  const st = solveShape(shape, given);
  if (st.invalid.length) return fail(t.input, st.invalid[0]!);
  if (st.conflicts.length) return fail(t.input, `These measurements don't fit one ${shape.name}: ${st.conflicts[0]}`);
  const states = [st.known, ...(st.alternatives ?? [])];
  const get = (m: Map<string, Known>) => (k: string) => m.get(k)?.v;
  const problems = states.map((m) => shape.check?.(get(m)) ?? null);
  if (problems.every((p) => p) && problems[0]) return fail(t.input, problems[0]);
  const good = states.filter((_, i) => !problems[i]);

  // What to report
  let want = ex.requested.find((k) => !given.has(k)) ?? det.main ?? shape.main;
  if (given.has(want)) want = shape.basis.find((b) => !given.has(b) && !(shape.fixed && b in shape.fixed)) ?? shape.vars.find((v) => !v.hidden && !given.has(v.key) && st.known.has(v.key))?.key ?? want;
  const wantDef = shape.vars.find((v) => v.key === want)!;
  const first = good[0]!;
  if (!first.has(want)) {
    const missing = shape.basis.filter((b) => !first.has(b));
    const labels = missing.map((b) => shape.vars.find((v) => v.key === b)!.label.toLowerCase());
    const knownNow = [...first.entries()].filter(([k, kv]) => kv.how !== 'given' && kv.how !== 'fixed' && !shape.vars.find((v) => v.key === k)?.hidden).map(([k, kv]) => {
      const d = shape.vars.find((v) => v.key === k)!;
      return `${d.sym} = ${show(kv.v, d.dim, base)}`;
    });
    return need(t.input, `To find the ${wantDef.label.toLowerCase()} of the ${shape.name} I need one more measurement${labels.length ? ` (for example the ${labels.join(' or ')})` : ''}${knownNow.length ? `. So far: ${knownNow.slice(0, 4).join(', ')}` : ''}`);
  }

  const lineFor = (m: Map<string, Known>) => (k: string) => {
    const d = shape.vars.find((v) => v.key === k)!;
    const kv = m.get(k)!;
    const val = show(kv.v, d.dim, base);
    const eqv = val.startsWith('≈') ? val : `= ${val}`;
    const how = kv.how === 'given' ? `${val} (given)` : kv.how === 'fixed' ? `${val}` : kv.how === 'numeric' ? `${val} (solved numerically)` : `${kv.how.replace(/ \(solved numerically\)$/, '')} ${eqv}`;
    return { label: `${d.label} (${d.sym})`, display: how };
  };
  const order = shape.vars.filter((v) => !v.hidden).map((v) => v.key);
  const lines: { label: string; display: string }[] = [];
  const shown = order.filter((k) => first.has(k) && k !== want);
  lines.push(lineFor(first)(want));
  for (const k of shown) lines.push(lineFor(first)(k));
  if (named) {
    const f = namedFactor(named);
    if (f && wantDef.dim === f.dim && base) {
      const inNamed = first.get(want)!.v.mul(V.dec(LENGTH[base]!.m)!.pow(f.dim)).div(f.m);
      lines.splice(1, 0, { label: `${wantDef.label} in ${named}`, display: show(inNamed.float(), 0, '') + ` ${named}` });
    }
  }
  // "… in m²" conversions
  const target = /\b(?:in|into|to)\s+((?:sq\.?|square|cu\.?|cubic)\s+\w+|\w+\s*(?:\^\s*[23]|[²³]|squared|cubed)|litres?|liters?|ml|millilit\w+|gallons?|hectares?|acres?|cm|mm|m|km|in|inch(?:es)?|ft|feet|foot|yd|yards?|mi|miles?|metres?|meters?|centimet\w+|millimet\w+|kilomet\w+)\s*$/.exec(t.s);
  let primary = primaryOf(first.get(want)!.v, wantDef.dim, base);
  if (target && base && typeof wantDef.dim === 'number' && wantDef.dim > 0) {
    const u = readUnit(target[1]!);
    if (u && u.hit.dim !== 'angle') {
      const tdim = u.hit.dim === 1 ? wantDef.dim : u.hit.dim;
      if (tdim === wantDef.dim) {
        const tf = u.hit.dim === 1 ? u.hit.factor.pow(wantDef.dim) : u.hit.factor;
        const conv = first.get(want)!.v.mul(V.dec(LENGTH[base]!.m)!.pow(wantDef.dim)).div(tf);
        const uName = u.hit.named ?? unitText(u.hit.unit, wantDef.dim);
        const p = primaryOf(conv.e && conv.e.length <= 2 ? conv : conv.float(), 0, '');
        lines.splice(1, 0, { label: `${wantDef.label} in ${unitText(base, wantDef.dim)}`, display: show(first.get(want)!.v, wantDef.dim, base) });
        primary = { ...p, unit: uName, spoken: `${p.spoken} ${uName}` };
      }
    }
  }
  if (!base) notes.push('No units given: lengths, areas and volumes are in the same (unstated) unit');
  if (st.numeric) notes.push('Some measurements were found numerically from the ones given, then checked against them');
  notes.push(...(shape.notes ?? []));
  const extra = shape.extra?.(get(first)) ?? [];
  lines.push(...extra);

  let table: { columns: string[]; rows: string[][]; caption?: string } | undefined;
  if (good.length > 1) {
    const valOf = (m: Map<string, Known>, k: string) => {
      const d = shape.vars.find((v) => v.key === k)!;
      const kv = m.get(k);
      return kv ? show(kv.v, d.dim, base) : '—';
    };
    const keys = order.filter((k) => good.some((m) => m.has(k)));
    table = { columns: ['', ...good.map((_, i) => `${shape.id === 'triangle' ? 'Triangle' : 'Solution'} ${i + 1}`)], rows: keys.map((k) => [shape.vars.find((v) => v.key === k)!.label, ...good.map((m) => valOf(m, k))]) };
    const vals = good.map((m) => primaryOf(m.get(want)!.v, wantDef.dim, base).display);
    primary = { ...primary, display: vals.join(' or '), spoken: `${good.length} answers: ${vals.join(' or ')}` };
    notes.unshift(shape.id === 'triangle' ? `Two different triangles fit these measurements (the ambiguous SSA case)` : `${good.length} different ${shape.name}s fit these measurements`);
  }

  const givenText = [...given.entries()].map(([k, kv]) => {
    const d = shape.vars.find((v) => v.key === k)!;
    return `${d.sym} = ${show(kv.v, d.dim, base).replace(/ \(given\)/, '')}`;
  });
  const fig = shapeFigure(shape, get(first), base);
  const exact = first.get(want)!.v.e !== null;
  return answer(t.input, {
    expression: `${cap(shape.name)} · ${givenText.join(', ')} → ${wantDef.label.toLowerCase()}`,
    primary,
    value: good.length === 1 ? toDec(first.get(want)!.v) : undefined,
    lines,
    table,
    notes,
    exactness: exact ? 'exact' : 'approximate',
    ...(fig ? { figure: fig } : {}),
  });
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type { SolveState };
