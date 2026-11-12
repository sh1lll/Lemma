import type { AnswerResult } from '@lemma/math-core';
import { acosDeg, atan2Deg, atanDeg, cosDeg, ex, snapDeg, sinDeg, V } from './exact';
import { Drawing, polygonFigure, short, type Figure, type Pt as FPt } from './figure';
import { answer, dec, exactText, fail, need, primaryOf, show, toDec } from './format';
import { coef, degree, findEquations, parseEquation, vars, type Poly } from './poly';
import { solveShape, type Known } from './solver';
import { numbers, points, type Pt, type Text } from './text';
import { triangleShape } from './triangle';

type L = { label: string; display: string };

// ---------- number / point text ----------

export function n(v: V): string {
  const e = exactText(v);
  if (e && e.length <= 18) return e;
  return dec(v.x).text;
}
const ptText = (p: { x: V; y: V; z?: V }) => `(${n(p.x)}, ${n(p.y)}${p.z ? `, ${n(p.z)}` : ''})`;
const sq = (v: V) => v.mul(v);
const dist2 = (a: Pt, b: Pt) => sq(b.x.sub(a.x)).add(sq(b.y.sub(a.y))).add(a.z && b.z ? sq(b.z.sub(a.z)) : V.rat(0));

/** "3x − 4y + 5" from coefficient/name pairs (skips zeros). */
export function linText(terms: [V, string][]): string {
  let out = '';
  for (const [c, name] of terms) {
    if (Math.abs(c.x) < 1e-14) continue;
    const neg = c.x < 0;
    const a = neg ? c.neg() : c;
    let body = n(a);
    if (name) body = body === '1' ? name : /[+−/ ]/.test(body) ? `(${body})${name}` : `${body}${name}`;
    out += out ? (neg ? ' − ' : ' + ') + body : (neg ? '−' : '') + body;
  }
  return out || '0';
}

// ---------- lines ----------

export interface Line {
  a: V;
  b: V;
  c: V;
} // ax + by + c = 0

function lcmDen(vs: V[]): V | null {
  // scale exact rationals to integers
  let L = 1n;
  for (const v of vs) {
    const r = v.e ? ex.rational(v.e) : null;
    if (!r) return null;
    const g = (a: bigint, b: bigint): bigint => (b ? g(b, a % b) : a < 0n ? -a : a);
    L = (L / g(L, r.d)) * r.d;
  }
  return V.rat(Number(L));
}
export function normLine(l: Line): Line {
  let { a, b, c } = l;
  const s = lcmDen([a, b, c]);
  if (s) {
    a = a.mul(s);
    b = b.mul(s);
    c = c.mul(s);
    const ints = [a, b, c].map((v) => Math.round(v.x)).filter((x) => x !== 0);
    const g = ints.reduce((p, q) => {
      let x = Math.abs(p);
      let y = Math.abs(q);
      while (y) [x, y] = [y, x % y];
      return x;
    }, 0);
    if (g > 1) {
      a = a.div(g);
      b = b.div(g);
      c = c.div(g);
    }
  }
  if (a.x < 0 || (a.x === 0 && b.x < 0)) {
    a = a.neg();
    b = b.neg();
    c = c.neg();
  }
  return { a, b, c };
}
export const lineThrough = (p: Pt, q: Pt): Line => {
  const a = q.y.sub(p.y);
  const b = p.x.sub(q.x);
  return normLine({ a, b, c: a.mul(p.x).add(b.mul(p.y)).neg() });
};
function lineFromPoly(p: Poly): Line | null {
  if (degree(p) !== 1 || vars(p).has('z')) return null;
  return normLine({ a: coef(p, 1, 0), b: coef(p, 0, 1), c: coef(p, 0, 0) });
}

function lineForms(l: Line, through?: Pt): L[] {
  const out: L[] = [];
  const { a, b, c } = l;
  if (Math.abs(b.x) > 1e-14) {
    const m = a.neg().div(b);
    const k = c.neg().div(b);
    out.push({ label: 'Slope-intercept form', display: `y = ${linText([[m, 'x'], [k, '']])}` });
    out.push({ label: 'Slope (m)', display: n(m) });
    out.push({ label: 'y-intercept', display: `(0, ${n(k)})` });
    if (through) out.push({ label: 'Point-slope form', display: `y ${through.y.x < 0 ? '+' : '−'} ${n(through.y.x < 0 ? through.y.neg() : through.y)} = ${n(m)}(x ${through.x.x < 0 ? '+' : '−'} ${n(through.x.x < 0 ? through.x.neg() : through.x)})`.replace(/ [−+] 0\b/g, '') });
  } else out.push({ label: 'Slope', display: 'undefined (vertical line)' }, { label: 'Equation', display: `x = ${n(c.neg().div(a))}` });
  if (Math.abs(a.x) > 1e-14) out.push({ label: 'x-intercept', display: `(${n(c.neg().div(a))}, 0)` });
  out.push({ label: 'Standard form', display: `${linText([[a, 'x'], [b, 'y']])} = ${n(c.neg())}` });
  out.push({ label: 'General form', display: `${linText([[a, 'x'], [b, 'y'], [c, '']])} = 0` });
  if (Math.abs(a.x) > 1e-14 && Math.abs(b.x) > 1e-14 && Math.abs(c.x) > 1e-14) out.push({ label: 'Intercept form', display: `x/${paren(c.neg().div(a))} + y/${paren(c.neg().div(b))} = 1` });
  const inc = atan2Deg(a.neg().x, b.x);
  const incl = inc.x < 0 ? inc.add(V.rat(180)) : inc.x >= 180 ? inc.sub(V.rat(180)) : inc;
  out.push({ label: 'Angle of inclination', display: show(Math.abs(b.x) < 1e-14 ? V.rat(90) : atanDeg(a.neg().div(b)).x < 0 ? atanDeg(a.neg().div(b)).add(V.rat(180)) : atanDeg(a.neg().div(b)), 'angle', '') });
  void incl;
  return out;
}
const paren = (v: V) => (v.x < 0 || /[/+ ]/.test(n(v)) ? `(${n(v)})` : n(v));
const lineEqText = (l: Line) => (Math.abs(l.b.x) > 1e-14 ? `y = ${linText([[l.a.neg().div(l.b), 'x'], [l.c.neg().div(l.b), '']])}` : `x = ${n(l.c.neg().div(l.a))}`);

// ---------- figures ----------

function coordFigure(pts: Pt[], o: { polygon?: boolean; lines?: Line[]; circle?: { c: Pt; r: number }; labels?: string[]; alt: string; extra?: FPt[] }): Figure | null {
  if (pts.some((p) => !Number.isFinite(p.x.x) || !Number.isFinite(p.y.x))) return null;
  const P: FPt[] = pts.map((p) => [p.x.x, p.y.x]);
  const all = [...P, ...(o.extra ?? [])];
  if (o.circle) all.push([o.circle.c.x.x - o.circle.r, o.circle.c.y.x - o.circle.r], [o.circle.c.x.x + o.circle.r, o.circle.c.y.x + o.circle.r]);
  let minX = Math.min(0, ...all.map((p) => p[0]));
  let maxX = Math.max(0, ...all.map((p) => p[0]));
  let minY = Math.min(0, ...all.map((p) => p[1]));
  let maxY = Math.max(0, ...all.map((p) => p[1]));
  const padX = (maxX - minX || 2) * 0.15;
  const padY = (maxY - minY || 2) * 0.15;
  minX -= padX;
  maxX += padX;
  minY -= padY;
  maxY += padY;
  const d = new Drawing();
  d.line([minX, 0], [maxX, 0], true).line([0, minY], [0, maxY], true);
  d.text([maxX, -(maxY - minY) * 0.06], 'x', 'end').text([(maxX - minX) * 0.03, maxY], 'y', 'start');
  if (o.circle) d.circle([o.circle.c.x.x, o.circle.c.y.x], o.circle.r);
  for (const l of o.lines ?? []) {
    const seg: FPt[] = [];
    if (Math.abs(l.b.x) > 1e-12) for (const x of [minX, maxX]) seg.push([x, -(l.a.x * x + l.c.x) / l.b.x]);
    else for (const y of [minY, maxY]) seg.push([-l.c.x / l.a.x, y]);
    // clip vertically
    const clipped = seg.map(([x, y]): FPt => {
      if (y > maxY && Math.abs(l.a.x) > 1e-12) return [-(l.b.x * maxY + l.c.x) / l.a.x, maxY];
      if (y < minY && Math.abs(l.a.x) > 1e-12) return [-(l.b.x * minY + l.c.x) / l.a.x, minY];
      return [x, y];
    });
    d.line(clipped[0]!, clipped[1]!);
  }
  if (o.polygon && P.length >= 3) d.poly(P);
  else if (o.polygon && P.length === 2) d.line(P[0]!, P[1]!);
  P.forEach((p, i) => {
    d.dot(p);
    d.text([p[0] + (maxX - minX) * 0.02, p[1] + (maxY - minY) * 0.05], o.labels?.[i] ?? '', 'start');
  });
  return d.render(o.alt);
}

// ---------- intents ----------

const RATIO = /(?:ratio|in the ratio)\s*(\d+(?:\.\d+)?)\s*(?::|to)\s*(\d+(?:\.\d+)?)/;

export function answerCoord(t: Text): AnswerResult | null {
  const s = t.s;
  const input = t.input;
  if (/\b(?:fit|regression|scatter|plot|graph|histogram|best fit|trend ?line|correlation|interpolat\w*|lagrange|spline)\b/.test(s)) return null;
  const pts = points(t.t);
  const eqs = findEquations(sanitizeForEq(s));

  // Specialised phrasings first
  const tr = transform(t, pts, eqs);
  if (tr) return tr;
  const lc = locus(t, pts, eqs);
  if (lc) return lc;

  const pts3 = pts.filter((p) => p.z);
  if (pts3.length && pts3.length === pts.length) return threeD(t, pts3, eqs);
  if (eqs.some((e) => vars(e.poly).has('z'))) return threeD(t, pts3, eqs);

  // Circles given by centre/radius in words
  const circ = circleWords(t, pts);
  if (circ) return circ;

  const conicEq = eqs.find((e) => degree(e.poly) === 2 && !vars(e.poly).has('z'));
  if (conicEq && /\b(?:centre|center|radius|foci|focus|vertex|vertices|directrix|eccentricity|asymptotes?|axis|axes|identify|classify|type|kind|what (?:conic|shape|curve)|describe|analy[sz]e|conic|latus|features?|properties|circle|ellipse|parabola|hyperbola|area|circumference|diameter)\b/.test(s))
    return conic(input, conicEq.poly, conicEq.src);

  const lines = eqs.map((e) => ({ e, l: lineFromPoly(e.poly) })).filter((x): x is { e: (typeof eqs)[0]; l: Line } => !!x.l);
  if (lines.length) {
    const r = lineQuestions(t, lines, pts);
    if (r) return r;
  }
  if (pts.length >= 2) return pointQuestions(t, pts);
  return null;
}

function sanitizeForEq(s: string): string {
  return s.replace(/[a-z]+/g, (w) => (/^[xyz]+$/.test(w) ? w : '|'.repeat(w.length)));
}

function pointQuestions(t: Text, pts: Pt[]): AnswerResult | null {
  const s = t.s;
  const input = t.input;
  const labels = pts.map((p, i) => p.label ?? String.fromCharCode(65 + i));
  if (/\bhyperbolic\b|poincar|half-?plane/.test(s)) return null; // handled in extras
  if (/\bgreat[- ]circle\b|\blat(?:itude)?\b|\blong(?:itude)?\b|haversine/.test(s)) return null;
  if (/\bconvex hull\b/.test(s)) return null;
  if (/\bcross[- ]ratio\b|\binver(?:t|sion)\b/.test(s)) return null;

  if (pts.length === 2) {
    const [A, B] = pts as [Pt, Pt];
    const ratio = RATIO.exec(s);
    if (ratio || /\b(?:divides?|section|partition|section formula)\b/.test(s)) {
      if (!ratio) return need(input, 'Give the ratio, e.g. “divides (1,2) and (7,8) in the ratio 1:2”');
      const m = V.dec(ratio[1]!)!;
      const k = V.dec(ratio[2]!)!;
      const external = /\bextern\w*/.test(s);
      const den = external ? m.sub(k) : m.add(k);
      if (den.x === 0) return fail(input, 'An external division in the ratio 1:1 has no finite point');
      const sign = external ? -1 : 1;
      const P: Pt = { x: m.mul(B.x).add(k.mul(A.x).mul(sign)).div(den), y: m.mul(B.y).add(k.mul(A.y).mul(sign)).div(den), start: 0, end: 0 };
      return answer(input, {
        expression: `Point dividing ${ptText(A)} and ${ptText(B)} ${external ? 'externally' : 'internally'} in the ratio ${ratio[1]}:${ratio[2]}`,
        primary: { display: ptText(P), plain: ptText(P), spoken: `the point ${ptText(P)}` },
        lines: [{ label: 'Formula', display: external ? 'P = (m·B − n·A)/(m − n)' : 'P = (m·B + n·A)/(m + n)' }],
        notes: [],
        figure: coordFigure([A, B, P], { polygon: true, labels: [labels[0]!, labels[1]!, 'P'], alt: 'segment with dividing point' }) ?? undefined,
      });
    }
    const d2 = dist2(A, B);
    const d = d2.sqrt();
    const M: Pt = { x: A.x.add(B.x).div(2), y: A.y.add(B.y).div(2), start: 0, end: 0 };
    const l = lineThrough(A, B);
    const dx = B.x.sub(A.x);
    const dy = B.y.sub(A.y);
    const slope = dx.x === 0 ? null : dy.div(dx);
    const pb = normLine({ a: dx, b: dy, c: dx.mul(M.x).add(dy.mul(M.y)).neg() });
    const lines: L[] = [
      { label: 'Distance', display: `√((${n(B.x)} − ${n(A.x)})² + (${n(B.y)} − ${n(A.y)})²) = ${show(d, 0, '')}` },
      { label: 'Midpoint', display: ptText(M) },
      { label: 'Slope', display: slope ? `(${n(B.y)} − ${n(A.y)})/(${n(B.x)} − ${n(A.x)}) = ${n(slope)}` : 'undefined (vertical)' },
      { label: 'Line through them', display: lineEqText(l) },
      ...lineForms(l, A).filter((x) => /Standard|General|Intercept form|inclination|Point-slope/.test(x.label)),
      { label: 'Perpendicular bisector', display: lineEqText(pb) },
      { label: 'Circle with this diameter', display: circleEq(M, d2.div(4)) },
    ];
    let want = 'Distance';
    if (/\bmid-?point\b/.test(s)) want = 'Midpoint';
    else if (/\b(?:slope|gradient)\b/.test(s) && !/\bequation\b/.test(s)) want = 'Slope';
    else if (/\bperpendicular bisector\b/.test(s)) want = 'Perpendicular bisector';
    else if (/\bcircle\b|\bdiameter\b/.test(s)) want = 'Circle with this diameter';
    else if (/\b(?:line|equation)\b/.test(s)) want = 'Line through them';
    else if (/\bdistance|how far|length\b/.test(s)) want = 'Distance';
    else if (!/\bpoints?\b|\bbetween\b|\band\b/.test(s)) return null;
    const pick = lines.find((x) => x.label === want)!;
    let primary;
    if (want === 'Distance') primary = primaryOf(d, 0, '');
    else if (want === 'Slope' && slope) primary = primaryOf(slope, 0, '');
    else {
      const text = want === 'Midpoint' ? ptText(M) : pick.display;
      primary = { display: text, plain: text, spoken: text };
    }
    const fig = coordFigure([A, B, ...(want === 'Midpoint' ? [M] : [])], { polygon: true, labels: [labels[0]! + ptText(A), labels[1]! + ptText(B), 'M'], alt: `points ${ptText(A)} and ${ptText(B)}`, lines: want.startsWith('Perp') ? [pb] : want.startsWith('Line') ? [l] : [], circle: want.startsWith('Circle') ? { c: M, r: d.x / 2 } : undefined });
    return answer(input, {
      expression: `${want} · ${ptText(A)} and ${ptText(B)}`,
      primary,
      value: want === 'Distance' ? toDec(d) : want === 'Slope' && slope ? toDec(slope) : undefined,
      lines: [pick, ...lines.filter((x) => x !== pick)],
      notes: [],
      exactness: 'exact',
      ...(fig ? { figure: fig } : {}),
    });
  }

  // three or more points
  if (/\bcircle\b|\bcircumcircle\b|\bconcyclic\b/.test(s) && pts.length === 3) return circleThrough3(input, pts as [Pt, Pt, Pt]);
  if (/\bcollinear\b/.test(s)) {
    const [A, B, ...rest] = pts as [Pt, Pt, ...Pt[]];
    const cross = (P: Pt) => B.x.sub(A.x).mul(P.y.sub(A.y)).sub(B.y.sub(A.y).mul(P.x.sub(A.x)));
    const ok = rest.every((P) => Math.abs(cross(P).x) < 1e-12);
    return answer(input, { expression: `Are ${pts.map(ptText).join(', ')} collinear?`, primary: { display: ok ? 'Yes, collinear' : 'No', plain: ok ? 'yes' : 'no', spoken: ok ? 'yes, they are collinear' : 'no, they are not collinear' }, lines: [{ label: 'Test', display: 'Area of the triangle they form is zero exactly when they are collinear' }, { label: 'Triangle area', display: show(cross(rest[0]!).div(2).x < 0 ? cross(rest[0]!).div(-2) : cross(rest[0]!).div(2), 0, '') }], notes: [] });
  }
  if (/\bangle\b/.test(s) && pts.length === 3 && !/\btriangle\b/.test(s)) {
    const [A, B, C] = pts as [Pt, Pt, Pt];
    const u = [A.x.sub(B.x), A.y.sub(B.y)];
    const w = [C.x.sub(B.x), C.y.sub(B.y)];
    const dot = u[0]!.mul(w[0]!).add(u[1]!.mul(w[1]!));
    const cos = dot.div(dist2(A, B).sqrt().mul(dist2(C, B).sqrt()));
    const ang = acosDeg(cos);
    return answer(input, { expression: `Angle at ${ptText(B)} between ${ptText(A)} and ${ptText(C)}`, primary: primaryOf(ang, 'angle', ''), value: toDec(ang), lines: [{ label: 'Formula', display: 'cos θ = (BA · BC)/(|BA||BC|)' }, { label: 'cos θ', display: n(cos) }], notes: [] });
  }
  if (pts.length === 3 && !/\bpolygon|quadrilateral|pentagon|hexagon\b/.test(s)) return triangleFromPoints(t, pts as [Pt, Pt, Pt], labels);
  return polygonFromPoints(t, pts, labels);
}

function circleEq(c: Pt, r2: V): string {
  const term = (name: string, v: V) => (v.x === 0 ? `${name}²` : `(${name} ${v.x < 0 ? '+' : '−'} ${n(v.x < 0 ? v.neg() : v)})²`);
  return `${term('x', c.x)} + ${term('y', c.y)} = ${n(r2)}`;
}
function circleGeneral(c: Pt, r2: V): string {
  const D = c.x.mul(-2);
  const E = c.y.mul(-2);
  const F = sq(c.x).add(sq(c.y)).sub(r2);
  return `x² + y² ${linText([[D, 'x'], [E, 'y'], [F, '']]).replace(/^(?!−)/, '+ ').replace(/^−/, '− ')} = 0`.replace('+ 0 = 0', '= 0');
}

function circleAnswer(input: string, c: Pt, r2: V, how: string, extra: L[] = [], fig?: Pt[]): AnswerResult {
  const r = r2.sqrt();
  const eq = circleEq(c, r2);
  const lines: L[] = [
    { label: 'Standard form', display: eq },
    { label: 'General form', display: circleGeneral(c, r2) },
    { label: 'Centre', display: ptText(c) },
    { label: 'Radius', display: show(r, 0, '') },
    { label: 'Diameter', display: show(r.mul(2), 0, '') },
    { label: 'Circumference', display: show(r.mul(2).mul(V.PI), 0, '') },
    { label: 'Area', display: show(r2.mul(V.PI), 0, '') },
    ...extra,
  ];
  const f = coordFigure([c, ...(fig ?? [])], { circle: { c, r: r.x }, labels: ['centre'], alt: `circle ${eq}` });
  return answer(input, { expression: `Circle · ${how}`, primary: { display: eq, plain: eq, spoken: eq }, lines, notes: [], exactness: 'exact', ...(f ? { figure: f } : {}) });
}

function circleThrough3(input: string, [A, B, C]: [Pt, Pt, Pt]): AnswerResult {
  // Solve x² + y² + Dx + Ey + F = 0 through the three points (Cramer's rule, exact).
  const rows = [A, B, C].map((p) => [p.x, p.y, V.rat(1), sq(p.x).add(sq(p.y)).neg()] as const);
  const det3 = (m: V[][]) => m[0]![0]!.mul(m[1]![1]!.mul(m[2]![2]!).sub(m[1]![2]!.mul(m[2]![1]!))).sub(m[0]![1]!.mul(m[1]![0]!.mul(m[2]![2]!).sub(m[1]![2]!.mul(m[2]![0]!)))).add(m[0]![2]!.mul(m[1]![0]!.mul(m[2]![1]!).sub(m[1]![1]!.mul(m[2]![0]!))));
  const M = rows.map((r) => [r[0], r[1], r[2]]);
  const det = det3(M);
  if (Math.abs(det.x) < 1e-12) return fail(input, 'The three points are collinear, so no circle passes through all of them');
  const col = (j: number) => rows.map((r, i) => M[i]!.map((v, k) => (k === j ? r[3] : v)));
  const D = det3(col(0)).div(det);
  const E = det3(col(1)).div(det);
  const F = det3(col(2)).div(det);
  const c: Pt = { x: D.div(-2), y: E.div(-2), start: 0, end: 0 };
  const r2 = sq(c.x).add(sq(c.y)).sub(F);
  return circleAnswer(input, c, r2, `through ${ptText(A)}, ${ptText(B)}, ${ptText(C)}`, [], [A, B, C]);
}

function circleWords(t: Text, pts: Pt[]): AnswerResult | null {
  const s = t.s;
  if (!/\bcircle\b/.test(s) || !pts.length) return null;
  if (findEquations(sanitizeForEq(s)).length) return null;
  const centreM = /\b(?:cent(?:er|re)d?)\s*(?:at|is|of|=|:)?\s*(?:[a-z]\s*)?\(/.exec(s);
  const nums = numbers(s).filter((x) => !pts.some((p) => x.start >= p.start && x.end <= p.end));
  const rad = /\bradius\s*(?:of|is|=|:)?\s*/.exec(s);
  const rNum = rad ? nums.find((x) => x.start >= rad.index + rad[0].length - 1 && x.start <= rad.index + rad[0].length + 1) : undefined;
  if (centreM) {
    const c = pts.find((p) => p.start >= centreM.index)!;
    if (rNum) return circleAnswer(t.input, c, sq(rNum.v), `centre ${ptText(c)}, radius ${n(rNum.v)}`);
    const other = pts.find((p) => p !== c);
    if (other && /\bthrough|passing|passes|contains|containing\b/.test(s)) return circleAnswer(t.input, c, dist2(c, other), `centre ${ptText(c)} through ${ptText(other)}`, [], [other]);
    const tangent = findEquations(sanitizeForEq(s));
    void tangent;
    return need(t.input, 'Give the radius or a point on the circle, e.g. “circle centre (2, −3) radius 4”');
  }
  if (/\bdiameter\b/.test(s) && pts.length === 2 && /\bend-?points?|ends\b/.test(s)) {
    const [A, B] = pts as [Pt, Pt];
    const c: Pt = { x: A.x.add(B.x).div(2), y: A.y.add(B.y).div(2), start: 0, end: 0 };
    return circleAnswer(t.input, c, dist2(A, B).div(4), `diameter from ${ptText(A)} to ${ptText(B)}`, [], [A, B]);
  }
  if (pts.length === 3 && /\bthrough|passing|passes|contains\b/.test(s)) return circleThrough3(t.input, pts as [Pt, Pt, Pt]);
  return null;
}

function triangleFromPoints(t: Text, [A, B, C]: [Pt, Pt, Pt], labels: string[]): AnswerResult {
  const input = t.input;
  const area2 = B.x.sub(A.x).mul(C.y.sub(A.y)).sub(C.x.sub(A.x).mul(B.y.sub(A.y)));
  if (Math.abs(area2.x) < 1e-12) return fail(input, 'These three points are collinear, so they don’t form a triangle');
  const a = dist2(B, C).sqrt();
  const b = dist2(A, C).sqrt();
  const c = dist2(A, B).sqrt();
  const shape = triangleShape('general');
  const st = solveShape(shape, new Map<string, Known>([['a', { v: a, how: 'given' }], ['b', { v: b, how: 'given' }], ['c', { v: c, how: 'given' }]]));
  const area = area2.x < 0 ? area2.div(-2) : area2.div(2);
  const g = (k: string) => st.known.get(k)?.v;
  const G: Pt = { x: A.x.add(B.x).add(C.x).div(3), y: A.y.add(B.y).add(C.y).div(3), start: 0, end: 0 };
  // circumcentre
  const D = A.x.mul(B.y.sub(C.y)).add(B.x.mul(C.y.sub(A.y))).add(C.x.mul(A.y.sub(B.y))).mul(2);
  const s2 = (p: Pt) => sq(p.x).add(sq(p.y));
  const O: Pt = { x: s2(A).mul(B.y.sub(C.y)).add(s2(B).mul(C.y.sub(A.y))).add(s2(C).mul(A.y.sub(B.y))).div(D), y: s2(A).mul(C.x.sub(B.x)).add(s2(B).mul(A.x.sub(C.x))).add(s2(C).mul(B.x.sub(A.x))).div(D), start: 0, end: 0 };
  const H: Pt = { x: A.x.add(B.x).add(C.x).sub(O.x.mul(2)), y: A.y.add(B.y).add(C.y).sub(O.y.mul(2)), start: 0, end: 0 };
  const per = a.add(b).add(c);
  const I: Pt = { x: a.mul(A.x).add(b.mul(B.x)).add(c.mul(C.x)).div(per), y: a.mul(A.y).add(b.mul(B.y)).add(c.mul(C.y)).div(per), start: 0, end: 0 };
  const lines: L[] = [
    { label: 'Area (shoelace)', display: `½|x₁(y₂ − y₃) + x₂(y₃ − y₁) + x₃(y₁ − y₂)| = ${show(area, 0, '')}` },
    { label: `Side ${labels[1]}${labels[2]} (a)`, display: show(a, 0, '') },
    { label: `Side ${labels[0]}${labels[2]} (b)`, display: show(b, 0, '') },
    { label: `Side ${labels[0]}${labels[1]} (c)`, display: show(c, 0, '') },
    { label: `Angle ${labels[0]}`, display: g('α') ? show(g('α')!, 'angle', '') : '' },
    { label: `Angle ${labels[1]}`, display: g('β') ? show(g('β')!, 'angle', '') : '' },
    { label: `Angle ${labels[2]}`, display: g('γ') ? show(g('γ')!, 'angle', '') : '' },
    { label: 'Perimeter', display: show(per, 0, '') },
    { label: 'Centroid', display: ptText(G) },
    { label: 'Circumcentre', display: ptText(O) },
    { label: 'Circumradius', display: show(dist2(O, A).sqrt(), 0, '') },
    { label: 'Incentre', display: I.x.e && I.y.e && n(I.x).length < 16 && n(I.y).length < 16 ? ptText(I) : `(${dec(I.x.x).text}, ${dec(I.y.x).text})` },
    { label: 'Inradius', display: show(area.mul(2).div(per), 0, '') },
    { label: 'Orthocentre', display: ptText(H) },
    ...(shape.extra?.(g) ?? []),
  ];
  let want = 0;
  if (/\bperimeter\b/.test(s0(t))) want = 7;
  else if (/\bcentroid\b/.test(s0(t))) want = 8;
  else if (/\bcircumcent(?:er|re)\b/.test(s0(t))) want = 9;
  else if (/\bincent(?:er|re)\b/.test(s0(t))) want = 11;
  else if (/\borthocent(?:er|re)\b/.test(s0(t))) want = 13;
  const pick = lines[want]!;
  const val = want === 0 ? area : want === 7 ? per : null;
  const fig = coordFigure([A, B, C], { polygon: true, labels: labels.map((L, i) => `${L}${ptText([A, B, C][i]!)}`), alt: `triangle ${ptText(A)}, ${ptText(B)}, ${ptText(C)}` });
  return answer(input, {
    expression: `Triangle ${labels.join('')} · ${ptText(A)}, ${ptText(B)}, ${ptText(C)}`,
    primary: val ? primaryOf(val, 0, '') : { display: pick.display, plain: pick.display, spoken: pick.display },
    value: val ? toDec(val) : undefined,
    lines: [pick, ...lines.filter((x) => x !== pick && x.display)],
    notes: [],
    exactness: 'exact',
    ...(fig ? { figure: fig } : {}),
  });
}
const s0 = (t: Text) => t.s;

/** Shoelace area, perimeter, centroid, angles, convexity and quadrilateral type. */
function polygonFromPoints(t: Text, pts: Pt[], labels: string[]): AnswerResult {
  const input = t.input;
  const k = pts.length;
  let a2 = V.rat(0);
  let cx = V.rat(0);
  let cy = V.rat(0);
  for (let i = 0; i < k; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % k]!;
    const cr = p.x.mul(q.y).sub(q.x.mul(p.y));
    a2 = a2.add(cr);
    cx = cx.add(p.x.add(q.x).mul(cr));
    cy = cy.add(p.y.add(q.y).mul(cr));
  }
  if (Math.abs(a2.x) < 1e-12) return fail(input, 'These points enclose no area (they are collinear or the outline cancels out)');
  const area = a2.x < 0 ? a2.div(-2) : a2.div(2);
  const C: Pt = { x: cx.div(a2.mul(3)), y: cy.div(a2.mul(3)), start: 0, end: 0 };
  const sides = pts.map((p, i) => dist2(p, pts[(i + 1) % k]!).sqrt());
  const per = sides.reduce((x, y) => x.add(y), V.rat(0));
  // angles and convexity
  const sign = Math.sign(a2.x);
  let convex = true;
  const angles: V[] = [];
  let selfX = false;
  for (let i = 0; i < k; i++) {
    const prev = pts[(i - 1 + k) % k]!;
    const p = pts[i]!;
    const next = pts[(i + 1) % k]!;
    const ux = prev.x.sub(p.x).x;
    const uy = prev.y.sub(p.y).x;
    const wx = next.x.sub(p.x).x;
    const wy = next.y.sub(p.y).x;
    const cross = (p.x.x - prev.x.x) * (next.y.x - p.y.x) - (p.y.x - prev.y.x) * (next.x.x - p.x.x);
    if (Math.sign(cross) !== sign && Math.abs(cross) > 1e-12) convex = false;
    let ang = (Math.acos(Math.max(-1, Math.min(1, (ux * wx + uy * wy) / (Math.hypot(ux, uy) * Math.hypot(wx, wy))))) * 180) / Math.PI;
    if (Math.sign(cross) !== sign && Math.abs(cross) > 1e-12) ang = 360 - ang;
    angles.push(snapDeg(ang));
  }
  for (let i = 0; i < k && !selfX; i++)
    for (let j = i + 2; j < k; j++) {
      if (i === 0 && j === k - 1) continue;
      if (segX(pts[i]!, pts[i + 1]!, pts[j]!, pts[(j + 1) % k]!)) selfX = true;
    }
  const lines: L[] = [
    { label: 'Area (shoelace)', display: `½|Σ(xᵢyᵢ₊₁ − xᵢ₊₁yᵢ)| = ${show(area, 0, '')}` },
    { label: 'Perimeter', display: show(per, 0, '') },
    ...sides.map((sd, i) => ({ label: `Side ${labels[i]}${labels[(i + 1) % k]}`, display: show(sd, 0, '') })),
    ...angles.map((a, i) => ({ label: `Angle ${labels[i]}`, display: show(a, 'angle', '') })),
    { label: 'Centroid (of the area)', display: n(C.x).length < 14 && n(C.y).length < 14 ? ptText(C) : `(${dec(C.x.x).text}, ${dec(C.y.x).text})` },
    { label: 'Convex', display: selfX ? 'no (the sides cross, so the area is the signed shoelace total)' : convex ? 'yes' : 'no' },
  ];
  if (k === 4) lines.push({ label: 'Type', display: quadType(pts, sides) });
  const notes = selfX ? ['The outline crosses itself; list the vertices in order around the shape'] : ['Vertices are taken in the order given'];
  const want = /\bperimeter\b/.test(t.s) ? 1 : /\bcentroid\b/.test(t.s) ? lines.length - (k === 4 ? 3 : 2) : 0;
  const pick = lines[want]!;
  const val = want === 0 ? area : want === 1 ? per : null;
  const fig = coordFigure(pts, { polygon: true, labels, alt: `polygon ${pts.map(ptText).join(' ')}` });
  return answer(input, {
    expression: `Polygon ${labels.join('')} · ${pts.map(ptText).join(', ')}`,
    primary: val ? primaryOf(val, 0, '') : { display: pick.display, plain: pick.display, spoken: pick.display },
    value: val ? toDec(val) : undefined,
    lines: [pick, ...lines.filter((x) => x !== pick)],
    notes,
    exactness: 'exact',
    ...(fig ? { figure: fig } : {}),
  });
}

function segX(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const o = (a: Pt, b: Pt, c: Pt) => Math.sign((b.x.x - a.x.x) * (c.y.x - a.y.x) - (b.y.x - a.y.x) * (c.x.x - a.x.x));
  return o(p1, p2, p3) * o(p1, p2, p4) < 0 && o(p3, p4, p1) * o(p3, p4, p2) < 0;
}

function quadType(p: Pt[], sides: V[]): string {
  const vec = (a: Pt, b: Pt) => [b.x.x - a.x.x, b.y.x - a.y.x] as const;
  const par = (u: readonly [number, number], w: readonly [number, number]) => Math.abs(u[0] * w[1] - u[1] * w[0]) < 1e-9 * (Math.hypot(...u) * Math.hypot(...w));
  const perp = (u: readonly [number, number], w: readonly [number, number]) => Math.abs(u[0] * w[0] + u[1] * w[1]) < 1e-9 * (Math.hypot(...u) * Math.hypot(...w));
  const [A, B, C, D] = p as [Pt, Pt, Pt, Pt];
  const ab = vec(A, B);
  const bc = vec(B, C);
  const cd = vec(C, D);
  const da = vec(D, A);
  const eq = (i: number, j: number) => Math.abs(sides[i]!.x - sides[j]!.x) < 1e-9 * sides[i]!.x;
  const p1 = par(ab, cd);
  const p2 = par(bc, da);
  const right = perp(ab, bc);
  const allEq = eq(0, 1) && eq(1, 2) && eq(2, 3);
  if (p1 && p2) return allEq ? (right ? 'square' : 'rhombus') : right ? 'rectangle' : 'parallelogram';
  if (p1 || p2) {
    const legsEq = p1 ? eq(1, 3) : eq(0, 2);
    return legsEq ? 'isosceles trapezoid' : perp(p1 ? ab : bc, p1 ? bc : cd) || perp(p1 ? ab : bc, p1 ? da : ab) ? 'right trapezoid' : 'trapezoid (one pair of parallel sides)';
  }
  if ((eq(0, 1) && eq(2, 3)) || (eq(1, 2) && eq(3, 0))) return 'kite';
  return 'irregular quadrilateral';
}

// ---------- lines given by equations ----------

function lineQuestions(t: Text, lines: { e: { src: string }; l: Line }[], pts: Pt[]): AnswerResult | null {
  const s = t.s;
  const input = t.input;
  const L1 = lines[0]!.l;
  if (lines.length >= 2 && /\b(?:intersect\w*|meet|cross|solve|point of intersection)\b/.test(s)) {
    const L2 = lines[1]!.l;
    const det = L1.a.mul(L2.b).sub(L2.a.mul(L1.b));
    if (Math.abs(det.x) < 1e-14) {
      const same = Math.abs(L1.a.mul(L2.c).sub(L2.a.mul(L1.c)).x) < 1e-12 && Math.abs(L1.b.mul(L2.c).sub(L2.b.mul(L1.c)).x) < 1e-12;
      return answer(input, { expression: `Intersection of ${lines[0]!.e.src} and ${lines[1]!.e.src}`, primary: { display: same ? 'Same line (infinitely many points)' : 'No intersection (parallel lines)', plain: same ? 'same line' : 'parallel', spoken: same ? 'they are the same line' : 'they are parallel and never meet' }, notes: [] });
    }
    const x = L1.b.mul(L2.c).sub(L2.b.mul(L1.c)).div(det);
    const y = L2.a.mul(L1.c).sub(L1.a.mul(L2.c)).div(det);
    const P: Pt = { x, y, start: 0, end: 0 };
    const fig = coordFigure([P], { lines: [L1, L2], labels: [ptText(P)], alt: 'two lines meeting' });
    return answer(input, { expression: `Intersection of ${lines[0]!.e.src} and ${lines[1]!.e.src}`, primary: { display: ptText(P), plain: ptText(P), spoken: `the point ${ptText(P)}` }, lines: [{ label: 'Method', display: 'Solve both equations together (Cramer’s rule)' }, { label: 'Angle between the lines', display: show(angleBetween(L1, L2), 'angle', '') }], notes: [], exactness: 'exact', ...(fig ? { figure: fig } : {}) });
  }
  if (lines.length >= 2 && /\bangle\b/.test(s)) {
    const ang = angleBetween(L1, lines[1]!.l);
    return answer(input, { expression: `Angle between ${lines[0]!.e.src} and ${lines[1]!.e.src}`, primary: primaryOf(ang, 'angle', ''), value: toDec(ang), lines: [{ label: 'Formula', display: 'tan θ = |(m₁ − m₂)/(1 + m₁m₂)| (acute angle between the lines)' }, { label: 'Obtuse angle', display: show(V.rat(180).sub(ang), 'angle', '') }], notes: [] });
  }
  if (lines.length >= 2 && /\b(?:parallel|perpendicular)\b/.test(s) && /\bare\b|\bis\b|\bcheck\b|\bwhether\b/.test(s) && !pts.length) {
    const L2 = lines[1]!.l;
    const par = Math.abs(L1.a.mul(L2.b).sub(L2.a.mul(L1.b)).x) < 1e-12;
    const perp = Math.abs(L1.a.mul(L2.a).add(L1.b.mul(L2.b)).x) < 1e-12;
    const txt = par ? 'Parallel' : perp ? 'Perpendicular' : 'Neither parallel nor perpendicular';
    return answer(input, { expression: `${lines[0]!.e.src} and ${lines[1]!.e.src}`, primary: { display: txt, plain: txt.toLowerCase(), spoken: txt }, lines: [{ label: 'Rule', display: 'Parallel: equal slopes. Perpendicular: slopes multiply to −1' }, { label: 'Angle between', display: show(angleBetween(L1, L2), 'angle', '') }], notes: [] });
  }
  if (lines.length >= 2 && /\bdistance\b/.test(s)) {
    const L2 = lines[1]!.l;
    if (Math.abs(L1.a.mul(L2.b).sub(L2.a.mul(L1.b)).x) > 1e-12) return answer(input, { expression: 'Distance between two lines', primary: { display: '0', plain: '0', spoken: 'zero, they intersect' }, notes: ['The lines are not parallel, so they meet and the distance between them is 0'] });
    const k = Math.abs(L1.a.x) > 1e-14 ? L2.a.div(L1.a) : L2.b.div(L1.b);
    const c2 = L2.c.div(k);
    const d = abs(L1.c.sub(c2)).div(sq(L1.a).add(sq(L1.b)).sqrt());
    return answer(input, { expression: `Distance between parallel lines ${lines[0]!.e.src} and ${lines[1]!.e.src}`, primary: primaryOf(d, 0, ''), value: toDec(d), lines: [{ label: 'Formula', display: 'd = |c₁ − c₂|/√(a² + b²)' }], notes: [] });
  }
  if (pts.length >= 1) {
    const P = pts[0]!;
    if (/\bdistance\b|how far/.test(s)) {
      const num = L1.a.mul(P.x).add(L1.b.mul(P.y)).add(L1.c);
      const den = sq(L1.a).add(sq(L1.b)).sqrt();
      const d = abs(num).div(den);
      const foot: Pt = { x: P.x.sub(L1.a.mul(num).div(sq(den))), y: P.y.sub(L1.b.mul(num).div(sq(den))), start: 0, end: 0 };
      const fig = coordFigure([P, foot], { lines: [L1], polygon: true, labels: [ptText(P), 'foot'], alt: 'point and line' });
      return answer(input, { expression: `Distance from ${ptText(P)} to ${lines[0]!.e.src}`, primary: primaryOf(d, 0, ''), value: toDec(d), lines: [{ label: 'Formula', display: `|ax₀ + by₀ + c|/√(a² + b²) = |${n(num)}|/${n(den)}` }, { label: 'Line (general form)', display: `${linText([[L1.a, 'x'], [L1.b, 'y'], [L1.c, '']])} = 0` }, { label: 'Foot of the perpendicular', display: ptText(foot) }], notes: [], exactness: 'exact', ...(fig ? { figure: fig } : {}) });
    }
    const perp = /\bperpendicular|normal|orthogonal\b/.test(s);
    if (perp || /\bparallel\b/.test(s)) {
      const a = perp ? L1.b : L1.a;
      const b = perp ? L1.a.neg() : L1.b;
      const L = normLine({ a, b, c: a.mul(P.x).add(b.mul(P.y)).neg() });
      const eq = lineEqText(L);
      const fig = coordFigure([P], { lines: [L1, L], labels: [ptText(P)], alt: `${perp ? 'perpendicular' : 'parallel'} line` });
      return answer(input, { expression: `Line ${perp ? 'perpendicular' : 'parallel'} to ${lines[0]!.e.src} through ${ptText(P)}`, primary: { display: eq, plain: eq, spoken: eq }, lines: lineForms(L, P), notes: [perp ? 'Perpendicular slope is the negative reciprocal' : 'Parallel lines have equal slopes'], exactness: 'exact', ...(fig ? { figure: fig } : {}) });
    }
    if (/\bon the line|lies on|on line\b/.test(s)) {
      const v = L1.a.mul(P.x).add(L1.b.mul(P.y)).add(L1.c);
      const yes = Math.abs(v.x) < 1e-12;
      return answer(input, { expression: `Is ${ptText(P)} on ${lines[0]!.e.src}?`, primary: { display: yes ? 'Yes' : 'No', plain: yes ? 'yes' : 'no', spoken: yes ? 'yes' : 'no' }, lines: [{ label: 'Substituting', display: `${linText([[L1.a, 'x'], [L1.b, 'y'], [L1.c, '']])} = ${n(v)} at ${ptText(P)}` }], notes: [] });
    }
  }
  if (/\b(?:slope|gradient|intercepts?|form|convert|rewrite|write|equation|line|inclination)\b/.test(s)) {
    const forms = lineForms(L1);
    let want = forms[0]!;
    if (/\bslope\b|\bgradient\b/.test(s)) want = forms.find((f) => f.label.startsWith('Slope')) ? forms.find((f) => /^Slope( \(m\))?$/.test(f.label)) ?? forms[0]! : forms[0]!;
    if (/\bx-?intercept\b/.test(s)) want = forms.find((f) => f.label === 'x-intercept') ?? want;
    else if (/\by-?intercept\b/.test(s)) want = forms.find((f) => f.label === 'y-intercept') ?? want;
    else if (/\bstandard form\b/.test(s)) want = forms.find((f) => f.label === 'Standard form')!;
    else if (/\bgeneral form\b/.test(s)) want = forms.find((f) => f.label === 'General form')!;
    else if (/\bintercept form\b/.test(s)) want = forms.find((f) => f.label === 'Intercept form') ?? want;
    else if (/\binclination\b/.test(s)) want = forms.find((f) => f.label === 'Angle of inclination')!;
    else if (/\bslope-intercept\b/.test(s)) want = forms[0]!;
    const fig = coordFigure([], { lines: [L1], alt: `line ${lines[0]!.e.src}` });
    return answer(input, { expression: `Line ${lines[0]!.e.src}`, primary: { display: want.display, plain: want.display, spoken: want.display }, lines: forms.filter((f) => f !== want).length ? [want, ...forms.filter((f) => f !== want)] : forms, notes: [], exactness: 'exact', ...(fig ? { figure: fig } : {}) });
  }
  return null;
}

const abs = (v: V) => (v.x < 0 ? v.neg() : v);
function angleBetween(L1: Line, L2: Line): V {
  const dot = abs(L1.a.mul(L2.a).add(L1.b.mul(L2.b)));
  return acosDeg(dot.div(sq(L1.a).add(sq(L1.b)).sqrt().mul(sq(L2.a).add(sq(L2.b)).sqrt())));
}

// ---------- conics ----------

export function conic(input: string, p: Poly, src: string): AnswerResult {
  const A = coef(p, 2, 0);
  const B = coef(p, 1, 1);
  const C = coef(p, 0, 2);
  const D = coef(p, 1, 0);
  const E = coef(p, 0, 1);
  const F = coef(p, 0, 0);
  if (vars(p).has('z') || degree(p) !== 2) return fail(input, 'That isn’t a second-degree equation in x and y');
  const disc = B.mul(B).sub(A.mul(C).mul(4));
  const lines: L[] = [{ label: 'General form', display: `${linText([[A, 'x²'], [B, 'xy'], [C, 'y²'], [D, 'x'], [E, 'y'], [F, '']])} = 0` }, { label: 'Discriminant B² − 4AC', display: `${n(disc)} (${disc.x < 0 ? '< 0: ellipse family' : disc.x === 0 ? '= 0: parabola family' : '> 0: hyperbola family'})` }];
  const notes: string[] = [];
  if (Math.abs(B.x) > 1e-14) return rotatedConic(input, src, { A: A.x, B: B.x, C: C.x, D: D.x, E: E.x, F: F.x }, lines);
  const pt = (x: V, y: V) => ptText({ x, y });
  let kind = '';
  let fig: Figure | null = null;
  if (Math.abs(A.x) > 1e-14 && Math.abs(C.x) > 1e-14) {
    const h = D.div(A.mul(-2));
    const k = E.div(C.mul(-2));
    const G = F.neg().add(D.mul(D).div(A.mul(4))).add(E.mul(E).div(C.mul(4)));
    const px = G.div(A);
    const py = G.div(C);
    if (Math.abs(G.x) < 1e-14) return answer(input, { expression: `Conic ${src}`, primary: { display: disc.x < 0 ? `Degenerate: the single point ${pt(h, k)}` : 'Degenerate: a pair of crossing lines', plain: 'degenerate', spoken: 'a degenerate conic' }, lines, notes });
    if (disc.x < 0) {
      if (px.x < 0 && py.x < 0) return answer(input, { expression: `Conic ${src}`, primary: { display: 'No real points (imaginary ellipse)', plain: 'empty', spoken: 'no real points' }, lines, notes });
      if (Math.abs(A.x - C.x) < 1e-14) {
        kind = 'Circle';
        const r = px.sqrt();
        lines.push({ label: 'Standard form', display: circleEq({ x: h, y: k } as Pt, px) }, { label: 'Centre', display: pt(h, k) }, { label: 'Radius', display: show(r, 0, '') }, { label: 'Diameter', display: show(r.mul(2), 0, '') }, { label: 'Circumference', display: show(r.mul(V.PI).mul(2), 0, '') }, { label: 'Area', display: show(px.mul(V.PI), 0, '') });
        fig = coordFigure([{ x: h, y: k } as Pt], { circle: { c: { x: h, y: k } as Pt, r: r.x }, labels: ['centre'], alt: `circle centre ${pt(h, k)}` });
      } else {
        kind = 'Ellipse';
        const horiz = px.x > py.x;
        const a2 = horiz ? px : py;
        const b2 = horiz ? py : px;
        const a = a2.sqrt();
        const b = b2.sqrt();
        const c = a2.sub(b2).sqrt();
        const e = c.div(a);
        const hx = (dx: V) => (horiz ? pt(h.add(dx), k) : pt(h, k.add(dx)));
        lines.push(
          { label: 'Standard form', display: `${sqTerm('x', h)}/${n(px)} + ${sqTerm('y', k)}/${n(py)} = 1` },
          { label: 'Centre', display: pt(h, k) },
          { label: 'Major axis', display: `${horiz ? 'horizontal' : 'vertical'}, length 2a = ${show(a.mul(2), 0, '')}` },
          { label: 'Minor axis', display: `length 2b = ${show(b.mul(2), 0, '')}` },
          { label: 'Vertices', display: `${hx(a.neg())}, ${hx(a)}` },
          { label: 'Co-vertices', display: horiz ? `${pt(h, k.sub(b))}, ${pt(h, k.add(b))}` : `${pt(h.sub(b), k)}, ${pt(h.add(b), k)}` },
          { label: 'Foci', display: `${hx(c.neg())}, ${hx(c)}` },
          { label: 'Eccentricity', display: show(e, 0, '') },
          { label: 'Directrices', display: `${horiz ? 'x' : 'y'} = ${n((horiz ? h : k).sub(a2.div(c)))} and ${n((horiz ? h : k).add(a2.div(c)))}` },
          { label: 'Latus rectum', display: show(b2.mul(2).div(a), 0, '') },
          { label: 'Area', display: show(a.mul(b).mul(V.PI), 0, '') },
        );
        const ctr: Pt = { x: h, y: k } as Pt;
        const d = new Drawing();
        d.ellipse([h.x, k.x], px.sqrt().x, py.sqrt().x, { fill: true }).dot([h.x, k.x]);
        d.dot(horiz ? [h.x - c.x, k.x] : [h.x, k.x - c.x]).dot(horiz ? [h.x + c.x, k.x] : [h.x, k.x + c.x]).text([h.x, k.x + py.sqrt().x * 0.15], 'centre');
        fig = d.render(`ellipse centre ${ptText(ctr)}`);
      }
    } else {
      kind = 'Hyperbola';
      const horiz = px.x > 0;
      const a2 = horiz ? px : py;
      const b2 = horiz ? py.neg() : px.neg();
      const a = a2.sqrt();
      const b = b2.sqrt();
      const c = a2.add(b2).sqrt();
      const hx = (dx: V) => (horiz ? pt(h.add(dx), k) : pt(h, k.add(dx)));
      const slope = horiz ? b.div(a) : a.div(b);
      lines.push(
        { label: 'Standard form', display: horiz ? `${sqTerm('x', h)}/${n(a2)} − ${sqTerm('y', k)}/${n(b2)} = 1` : `${sqTerm('y', k)}/${n(a2)} − ${sqTerm('x', h)}/${n(b2)} = 1` },
        { label: 'Centre', display: pt(h, k) },
        { label: 'Transverse axis', display: `${horiz ? 'horizontal' : 'vertical'}, 2a = ${show(a.mul(2), 0, '')}` },
        { label: 'Conjugate axis', display: `2b = ${show(b.mul(2), 0, '')}` },
        { label: 'Vertices', display: `${hx(a.neg())}, ${hx(a)}` },
        { label: 'Foci', display: `${hx(c.neg())}, ${hx(c)}` },
        { label: 'Asymptotes', display: `y ${k.x < 0 ? '+' : '−'} ${n(abs(k))} = ±${n(slope)}(x ${h.x < 0 ? '+' : '−'} ${n(abs(h))})`.replace(/ [−+] 0(?=\D|$)/g, '') },
        { label: 'Eccentricity', display: show(c.div(a), 0, '') },
        { label: 'Directrices', display: `${horiz ? 'x' : 'y'} = ${n((horiz ? h : k).sub(a2.div(c)))} and ${n((horiz ? h : k).add(a2.div(c)))}` },
        { label: 'Latus rectum', display: show(b2.mul(2).div(a), 0, '') },
      );
    }
  } else {
    kind = 'Parabola';
    const xAxis = Math.abs(C.x) > 1e-14; // y² term: opens left/right
    if (xAxis) {
      if (Math.abs(D.x) < 1e-14) return answer(input, { expression: `Conic ${src}`, primary: { display: 'Degenerate: parallel lines (or none)', plain: 'degenerate', spoken: 'degenerate' }, lines, notes });
      const k = E.div(C.mul(-2));
      const h = C.mul(k).mul(k).sub(F).div(D);
      const p4 = D.neg().div(C);
      const pp = p4.div(4);
      lines.push({ label: 'Standard form', display: `${sqTerm('y', k)} = ${n(p4)}(x ${h.x < 0 ? '+' : '−'} ${n(abs(h))})`.replace(/\(x − 0\)/, 'x') }, { label: 'Vertex', display: pt(h, k) }, { label: 'Opens', display: pp.x > 0 ? 'right' : 'left' }, { label: 'Focus', display: pt(h.add(pp), k) }, { label: 'Directrix', display: `x = ${n(h.sub(pp))}` }, { label: 'Axis of symmetry', display: `y = ${n(k)}` }, { label: 'Focal length p', display: show(abs(pp), 0, '') }, { label: 'Latus rectum', display: show(abs(p4), 0, '') }, { label: 'Eccentricity', display: '1' });
    } else {
      if (Math.abs(E.x) < 1e-14) return answer(input, { expression: `Conic ${src}`, primary: { display: 'Degenerate: parallel lines (or none)', plain: 'degenerate', spoken: 'degenerate' }, lines, notes });
      const h = D.div(A.mul(-2));
      const k = A.mul(h).mul(h).sub(F).div(E);
      const p4 = E.neg().div(A);
      const pp = p4.div(4);
      lines.push({ label: 'Standard form', display: `${sqTerm('x', h)} = ${n(p4)}(y ${k.x < 0 ? '+' : '−'} ${n(abs(k))})`.replace(/\(y − 0\)/, 'y') }, { label: 'Vertex', display: pt(h, k) }, { label: 'Opens', display: pp.x > 0 ? 'up' : 'down' }, { label: 'Focus', display: pt(h, k.add(pp)) }, { label: 'Directrix', display: `y = ${n(k.sub(pp))}` }, { label: 'Axis of symmetry', display: `x = ${n(h)}` }, { label: 'Focal length p', display: show(abs(pp), 0, '') }, { label: 'Latus rectum', display: show(abs(p4), 0, '') }, { label: 'Eccentricity', display: '1' });
    }
  }
  return answer(input, { expression: `Conic ${src}`, primary: { display: kind, plain: kind.toLowerCase(), spoken: `a ${kind.toLowerCase()}` }, lines, notes, exactness: 'exact', ...(fig ? { figure: fig } : {}) });
}
const sqTerm = (name: string, c: V) => (Math.abs(c.x) < 1e-14 ? `${name}²` : `(${name} ${c.x < 0 ? '+' : '−'} ${n(abs(c))})²`);

function rotatedConic(input: string, src: string, k: { A: number; B: number; C: number; D: number; E: number; F: number }, lines: L[]): AnswerResult {
  const th = 0.5 * Math.atan2(k.B, k.A - k.C);
  const c = Math.cos(th);
  const s = Math.sin(th);
  const A2 = k.A * c * c + k.B * c * s + k.C * s * s;
  const C2 = k.A * s * s - k.B * c * s + k.C * c * c;
  const D2 = k.D * c + k.E * s;
  const E2 = -k.D * s + k.E * c;
  const disc = k.B * k.B - 4 * k.A * k.C;
  const kind = Math.abs(disc) < 1e-12 ? 'Parabola' : disc < 0 ? (Math.abs(A2 - C2) < 1e-12 ? 'Circle' : 'Ellipse') : 'Hyperbola';
  lines.push({ label: 'Rotation removing the xy term', display: `θ = ½·atan(B/(A − C)) ≈ ${dec((th * 180) / Math.PI).text}°` });
  lines.push({ label: 'Rotated equation (x′, y′)', display: `${dec(A2).text}x′² + ${dec(C2).text}y′² + ${dec(D2).text}x′ + ${dec(E2).text}y′ + ${dec(k.F).text} = 0` });
  if (kind !== 'Parabola' && Math.abs(A2) > 1e-12 && Math.abs(C2) > 1e-12) {
    const h2 = -D2 / (2 * A2);
    const k2 = -E2 / (2 * C2);
    const G = -k.F + (D2 * D2) / (4 * A2) + (E2 * E2) / (4 * C2);
    const X = h2 * c - k2 * s;
    const Y = h2 * s + k2 * c;
    lines.push({ label: 'Centre', display: `(${dec(X).text}, ${dec(Y).text})` });
    const ax = G / A2;
    const ay = G / C2;
    if (kind === 'Ellipse' || kind === 'Circle') {
      const a = Math.sqrt(Math.max(ax, ay));
      const b = Math.sqrt(Math.min(ax, ay));
      lines.push({ label: 'Semi-axes', display: `${dec(a).text} and ${dec(b).text}` }, { label: 'Eccentricity', display: dec(Math.sqrt(1 - (b * b) / (a * a))).text }, { label: 'Area', display: dec(Math.PI * a * b).text });
    } else {
      const a = Math.sqrt(Math.abs(ax > 0 ? ax : ay));
      const b = Math.sqrt(Math.abs(ax > 0 ? ay : ax));
      lines.push({ label: 'Semi-axes a, b', display: `${dec(a).text}, ${dec(b).text}` }, { label: 'Eccentricity', display: dec(Math.sqrt(1 + (b * b) / (a * a))).text });
    }
  }
  return answer(input, { expression: `Conic ${src}`, primary: { display: `${kind} (rotated)`, plain: kind.toLowerCase(), spoken: `a rotated ${kind.toLowerCase()}` }, lines, notes: ['Features after rotating the axes are numerical'], exactness: 'approximate' });
}

// ---------- transformations ----------

function transform(t: Text, pts: Pt[], eqs: { poly: Poly; src: string }[]): AnswerResult | null {
  const s = t.s;
  const input = t.input;
  const verb = /\b(translat\w*|shift\w*|mov\w*|rotat\w*|turn\w*|reflect\w*|flip\w*|mirror\w*|dilat\w*|enlarg\w*|scal\w*|stretch\w*)\b/.exec(s);
  if (!verb || !pts.length) return null;
  const v = verb[1]!;
  let map: ((p: Pt) => Pt) | null = null;
  let rule = '';
  let desc = '';
  const after = s.slice(verb.index);
  const idxOf = (re: RegExp) => {
    const m = re.exec(after);
    return m ? verb.index + m.index : -1;
  };
  const pointsAfter = (i: number) => pts.filter((p) => p.start >= i);
  if (/^(?:translat|shift|mov)/.test(v)) {
    const byI = idxOf(/\b(?:by|through|along)\b/);
    let dx = V.rat(0);
    let dy = V.rat(0);
    const vecPt = byI >= 0 ? pointsAfter(byI)[0] : undefined;
    if (vecPt) {
      dx = vecPt.x;
      dy = vecPt.y;
    } else {
      for (const m of s.matchAll(/(-?\d+(?:\.\d+)?)\s*(?:units?\s*)?(?:to the\s+)?(right|left|up|down)\b/g)) {
        const val = V.dec(m[1]!)!;
        if (m[2] === 'right') dx = dx.add(val);
        if (m[2] === 'left') dx = dx.sub(val);
        if (m[2] === 'up') dy = dy.add(val);
        if (m[2] === 'down') dy = dy.sub(val);
      }
      const hv = /\bh\s*=\s*(-?\d+(?:\.\d+)?)\b.*?\bk\s*=\s*(-?\d+(?:\.\d+)?)/.exec(s);
      if (hv) {
        dx = V.dec(hv[1]!)!;
        dy = V.dec(hv[2]!)!;
      }
    }
    if (dx.x === 0 && dy.x === 0 && !vecPt) return need(input, 'Say how far to move it, e.g. “translate (2, 3) by (4, −1)” or “3 units left and 2 up”');
    map = (p) => ({ ...p, x: p.x.add(dx), y: p.y.add(dy) });
    rule = `(x, y) → (x ${dx.x < 0 ? '−' : '+'} ${n(abs(dx))}, y ${dy.x < 0 ? '−' : '+'} ${n(abs(dy))})`;
    desc = `Translation by (${n(dx)}, ${n(dy)})`;
    if (vecPt) pts = pts.filter((p) => p !== vecPt);
  } else if (/^(?:rotat|turn)/.test(v)) {
    const am = /(-?\d+(?:\.\d+)?)\s*(?:°|degrees?)?\s*(clockwise|cw|counter-?clockwise|anti-?clockwise|ccw)?/.exec(after.replace(/\([^)]*\)/g, (m) => ' '.repeat(m.length)));
    if (!am) return need(input, 'Give the angle, e.g. “rotate (1, 2) 90° counterclockwise about the origin”');
    let ang = V.dec(am[1]!)!;
    if (/\bclockwise\b|\bcw\b/.test(s) && !/counter|anti|ccw/.test(s)) ang = ang.neg();
    const aboutI = idxOf(/\b(?:about|around|centre|center)\b/);
    const centre = aboutI >= 0 ? pointsAfter(aboutI)[0] : undefined;
    const cx = centre?.x ?? V.rat(0);
    const cy = centre?.y ?? V.rat(0);
    const c = cosDeg(ang);
    const sn = sinDeg(ang);
    map = (p) => {
      const x = p.x.sub(cx);
      const y = p.y.sub(cy);
      return { ...p, x: cx.add(x.mul(c).sub(y.mul(sn))), y: cy.add(x.mul(sn).add(y.mul(c))) };
    };
    const a = ((ang.x % 360) + 360) % 360;
    rule = a === 90 ? '(x, y) → (−y, x)' : a === 180 ? '(x, y) → (−x, −y)' : a === 270 ? '(x, y) → (y, −x)' : `(x, y) → (x·cos θ − y·sin θ, x·sin θ + y·cos θ)`;
    if (centre) rule += ` about ${ptText(centre)} (shift it to the origin first)`;
    desc = `Rotation by ${n(abs(ang))}° ${ang.x < 0 ? 'clockwise' : 'counterclockwise'} about ${centre ? ptText(centre) : 'the origin'}`;
    if (centre) pts = pts.filter((p) => p !== centre);
  } else if (/^(?:reflect|flip|mirror)/.test(v)) {
    const ln = eqs.map((e) => lineFromPoly(e.poly)).find((l) => l);
    let L: Line | null = null;
    if (/\bx-?axis\b/.test(s)) L = { a: V.rat(0), b: V.rat(1), c: V.rat(0) };
    else if (/\by-?axis\b/.test(s)) L = { a: V.rat(1), b: V.rat(0), c: V.rat(0) };
    else if (ln) L = ln;
    else if (/\borigin\b/.test(s)) {
      map = (p) => ({ ...p, x: p.x.neg(), y: p.y.neg() });
      rule = '(x, y) → (−x, −y)';
      desc = 'Reflection through the origin';
    } else {
      const ab = /\b(?:in|over|across|about|through)\s+(?:the\s+)?(?:point\s+)?\(/.exec(s);
      const P = ab ? pts.find((p) => p.start >= ab.index) : undefined;
      if (P) {
        map = (p) => ({ ...p, x: P.x.mul(2).sub(p.x), y: P.y.mul(2).sub(p.y) });
        rule = `(x, y) → (2·${n(P.x)} − x, 2·${n(P.y)} − y)`;
        desc = `Reflection through ${ptText(P)}`;
        pts = pts.filter((p) => p !== P);
      } else return need(input, 'Say what to reflect in: the x-axis, the y-axis, the origin, or a line such as y = x');
    }
    if (L) {
      const den = sq(L.a).add(sq(L.b));
      const LL = L;
      map = (p) => {
        const d = LL.a.mul(p.x).add(LL.b.mul(p.y)).add(LL.c).mul(2).div(den);
        return { ...p, x: p.x.sub(LL.a.mul(d)), y: p.y.sub(LL.b.mul(d)) };
      };
      const isX = L.a.x === 0 && L.c.x === 0;
      const isY = L.b.x === 0 && L.c.x === 0;
      const yx = L.c.x === 0 && L.a.x === -L.b.x;
      const ynx = L.c.x === 0 && L.a.x === L.b.x;
      rule = isX ? '(x, y) → (x, −y)' : isY ? '(x, y) → (−x, y)' : yx ? '(x, y) → (y, x)' : ynx ? '(x, y) → (−y, −x)' : 'P′ = P − 2·(ax + by + c)/(a² + b²)·(a, b)';
      desc = `Reflection in ${isX ? 'the x-axis' : isY ? 'the y-axis' : lineEqText(L)}`;
    }
  } else {
    const km = /(?:factor|scale factor|by|of)\s*(-?\d+(?:\.\d+)?(?:\/\d+)?)/.exec(after);
    if (!km) return need(input, 'Give the scale factor, e.g. “dilate (2, 4) by a factor of 3”');
    const [a, b] = km[1]!.split('/');
    const kf = V.dec(a!)!.div(b ? V.dec(b)! : V.rat(1));
    const aboutI = idxOf(/\b(?:about|around|centre|center|from)\b/);
    const centre = aboutI >= 0 ? pointsAfter(aboutI)[0] : undefined;
    const cx = centre?.x ?? V.rat(0);
    const cy = centre?.y ?? V.rat(0);
    map = (p) => ({ ...p, x: cx.add(p.x.sub(cx).mul(kf)), y: cy.add(p.y.sub(cy).mul(kf)) });
    rule = centre ? `P′ = C + k(P − C), k = ${n(kf)}` : `(x, y) → (${n(kf)}x, ${n(kf)}y)`;
    desc = `Dilation by ${n(kf)} about ${centre ? ptText(centre) : 'the origin'}`;
    if (centre) pts = pts.filter((p) => p !== centre);
  }
  if (!map || !pts.length) return null;
  const img = pts.map(map);
  const labels = pts.map((p, i) => p.label ?? (pts.length > 1 ? String.fromCharCode(65 + i) : 'P'));
  const lines: L[] = [{ label: 'Rule', display: rule }, ...pts.map((p, i) => ({ label: `${labels[i]} → ${labels[i]}′`, display: `${ptText(p)} → ${ptText(img[i]!)}` }))];
  const disp = img.map(ptText).join(', ');
  const d = new Drawing();
  if (pts.length >= 3) d.poly(pts.map((p) => [p.x.x, p.y.x] as FPt), { dashed: true, fill: false }).poly(img.map((p) => [p.x.x, p.y.x] as FPt));
  pts.forEach((p, i) => d.dot([p.x.x, p.y.x]).dot([img[i]!.x.x, img[i]!.y.x]).text([img[i]!.x.x, img[i]!.y.x], `${labels[i]}′`, 'start'));
  d.dot([0, 0]);
  return answer(input, { expression: `${desc} of ${pts.map(ptText).join(', ')}`, primary: { display: disp, plain: disp, spoken: `the image is ${disp}` }, lines, notes: [], exactness: 'exact', figure: d.render(desc) });
}

// ---------- loci ----------

function locus(t: Text, pts: Pt[], eqs: { poly: Poly; src: string }[]): AnswerResult | null {
  const s = t.s;
  if (!/\blocus\b|\bset of (?:all )?points\b|\ball points\b/.test(s)) return null;
  const input = t.input;
  if (/\bequidistant\b/.test(s) && pts.length === 2) {
    const [A, B] = pts as [Pt, Pt];
    const M: Pt = { x: A.x.add(B.x).div(2), y: A.y.add(B.y).div(2), start: 0, end: 0 };
    const dx = B.x.sub(A.x);
    const dy = B.y.sub(A.y);
    const L = normLine({ a: dx, b: dy, c: dx.mul(M.x).add(dy.mul(M.y)).neg() });
    const eq = lineEqText(L);
    return answer(input, { expression: `Locus of points equidistant from ${ptText(A)} and ${ptText(B)}`, primary: { display: eq, plain: eq, spoken: eq }, lines: [{ label: 'What it is', display: 'the perpendicular bisector of the segment' }, ...lineForms(L, M)], notes: [], exactness: 'exact' });
  }
  if (/\bequidistant\b/.test(s) && pts.length === 1) {
    const ln = eqs.map((e) => lineFromPoly(e.poly)).find((l) => l);
    if (ln) {
      const P = pts[0]!;
      // (x − px)² + (y − py)² = (ax + by + c)²/(a² + b²)
      const den = sq(ln.a).add(sq(ln.b));
      const A2 = V.rat(1).sub(sq(ln.a).div(den));
      const C2 = V.rat(1).sub(sq(ln.b).div(den));
      const B2 = ln.a.mul(ln.b).mul(-2).div(den);
      const D2 = P.x.mul(-2).sub(ln.a.mul(ln.c).mul(2).div(den));
      const E2 = P.y.mul(-2).sub(ln.b.mul(ln.c).mul(2).div(den));
      const F2 = sq(P.x).add(sq(P.y)).sub(sq(ln.c).div(den));
      const poly: Poly = new Map([['2,0,0', A2], ['1,1,0', B2], ['0,2,0', C2], ['1,0,0', D2], ['0,1,0', E2], ['0,0,0', F2]].filter(([, v]) => Math.abs((v as V).x) > 1e-14) as [string, V][]);
      const r = conic(input, poly, `points equidistant from ${ptText(P)} and the line`);
      if (r.ok) r.expression = `Locus: equidistant from the focus ${ptText(P)} and the directrix ${lineEqText(ln)} (a parabola)`;
      return r;
    }
  }
  const dm = /\bdistance\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*from\b|\b(\d+(?:\.\d+)?)\s*units?\s*from\b/.exec(s);
  if (dm && pts.length === 1) {
    const r = V.dec(dm[1] ?? dm[2]!)!;
    return circleAnswer(input, pts[0]!, sq(r), `all points ${n(r)} from ${ptText(pts[0]!)}`);
  }
  const sumM = /\b(sum|difference)\s+of\s+(?:the\s+)?distances\b.*?\bis\s*(\d+(?:\.\d+)?)/.exec(s);
  if (sumM && pts.length === 2) {
    const [F1, F2] = pts as [Pt, Pt];
    const k = V.dec(sumM[2]!)!;
    const c2 = dist2(F1, F2).div(4);
    const a = k.div(2);
    const isSum = sumM[1] === 'sum';
    if (F1.y.x !== F2.y.x && F1.x.x !== F2.x.x) return fail(input, 'Foci on a slanted line: give foci on a horizontal or vertical line');
    if (isSum && sq(a).x <= c2.x) return fail(input, 'The sum must be more than the distance between the points for an ellipse');
    if (!isSum && sq(a).x >= c2.x) return fail(input, 'The difference must be less than the distance between the points for a hyperbola');
    const b2 = isSum ? sq(a).sub(c2) : c2.sub(sq(a));
    const h = F1.x.add(F2.x).div(2);
    const kk = F1.y.add(F2.y).div(2);
    const horiz = F1.y.x === F2.y.x;
    const X = sqTerm(horiz ? 'x' : 'y', horiz ? h : kk);
    const Y = sqTerm(horiz ? 'y' : 'x', horiz ? kk : h);
    const eq = `${X}/${n(sq(a))} ${isSum ? '+' : '−'} ${Y}/${n(b2)} = 1`;
    const poly = parseEquation(eq.replace(/²/g, '^2').replace(/−/g, '-'));
    if (poly) {
      const r = conic(input, poly, eq);
      if (r.ok) r.expression = `Locus: ${sumM[1]} of distances to ${ptText(F1)} and ${ptText(F2)} is ${n(k)} (${isSum ? 'an ellipse' : 'a hyperbola'})`;
      return r;
    }
  }
  return null;
}

// ---------- 3D ----------

function threeD(t: Text, pts: Pt[], eqs: { poly: Poly; src: string }[]): AnswerResult | null {
  const s = t.s;
  const input = t.input;
  const planes = eqs.filter((e) => degree(e.poly) === 1).map((e) => ({ src: e.src, a: coef(e.poly, 1, 0, 0), b: coef(e.poly, 0, 1, 0), c: coef(e.poly, 0, 0, 1), d: coef(e.poly, 0, 0, 0) }));
  const z = (p: Pt) => p.z ?? V.rat(0);
  const sub = (p: Pt, q: Pt) => [p.x.sub(q.x), p.y.sub(q.y), z(p).sub(z(q))] as const;
  const cross = (u: readonly [V, V, V], w: readonly [V, V, V]) => [u[1].mul(w[2]).sub(u[2].mul(w[1])), u[2].mul(w[0]).sub(u[0].mul(w[2])), u[0].mul(w[1]).sub(u[1].mul(w[0]))] as const;
  const dot = (u: readonly V[], w: readonly V[]) => u[0]!.mul(w[0]!).add(u[1]!.mul(w[1]!)).add(u[2]!.mul(w[2]!));
  const norm = (u: readonly V[]) => dot(u, u).sqrt();
  const vt = (u: readonly V[]) => `⟨${u.map(n).join(', ')}⟩`;
  const planeText = (a: V, b: V, c: V, d: V) => `${linText([[a, 'x'], [b, 'y'], [c, 'z']])} = ${n(d.neg())}`;

  if (planes.length && pts.length >= 1 && /\bdistance|how far\b/.test(s)) {
    const P = pts[0]!;
    const pl = planes[0]!;
    const num = pl.a.mul(P.x).add(pl.b.mul(P.y)).add(pl.c.mul(z(P))).add(pl.d);
    const d = abs(num).div(norm([pl.a, pl.b, pl.c]));
    return answer(input, { expression: `Distance from ${ptText(P)} to the plane ${pl.src}`, primary: primaryOf(d, 0, ''), value: toDec(d), lines: [{ label: 'Formula', display: '|ax₀ + by₀ + cz₀ + d|/√(a² + b² + c²)' }, { label: 'Normal vector', display: vt([pl.a, pl.b, pl.c]) }], notes: [], exactness: 'exact' });
  }
  if (planes.length >= 2 && /\bangle\b/.test(s)) {
    const [p1, p2] = planes as [(typeof planes)[0], (typeof planes)[0]];
    const n1 = [p1.a, p1.b, p1.c];
    const n2 = [p2.a, p2.b, p2.c];
    const ang = acosDeg(abs(dot(n1, n2)).div(norm(n1).mul(norm(n2))));
    return answer(input, { expression: `Angle between the planes ${p1.src} and ${p2.src}`, primary: primaryOf(ang, 'angle', ''), value: toDec(ang), lines: [{ label: 'Formula', display: 'cos θ = |n₁ · n₂|/(|n₁||n₂|)' }], notes: [] });
  }
  if (planes.length >= 2 && /\bintersect\w*|line of intersection|meet\b/.test(s)) {
    const [p1, p2] = planes as [(typeof planes)[0], (typeof planes)[0]];
    const dir = cross([p1.a, p1.b, p1.c], [p2.a, p2.b, p2.c]);
    if (dir.every((v) => Math.abs(v.x) < 1e-14)) return answer(input, { expression: 'Intersection of two planes', primary: { display: 'Parallel planes (no single line)', plain: 'parallel', spoken: 'the planes are parallel' }, notes: [] });
    // a point: set the coordinate with the largest direction component to 0 and solve the 2×2 system
    const i = [0, 1, 2].reduce((best, j) => (Math.abs(dir[j]!.x) > Math.abs(dir[best]!.x) ? j : best), 0);
    const cols = [[p1.a, p2.a], [p1.b, p2.b], [p1.c, p2.c]].filter((_, j) => j !== i);
    const [u, w] = cols as [[V, V], [V, V]];
    const det = u[0].mul(w[1]).sub(u[1].mul(w[0]));
    const r1 = p1.d.neg();
    const r2 = p2.d.neg();
    const s1 = r1.mul(w[1]).sub(r2.mul(w[0])).div(det);
    const s2 = u[0].mul(r2).sub(u[1].mul(r1)).div(det);
    const P = [V.rat(0), V.rat(0), V.rat(0)];
    const free = [0, 1, 2].filter((j) => j !== i);
    P[free[0]!] = s1;
    P[free[1]!] = s2;
    const disp = `(x, y, z) = (${P.map(n).join(', ')}) + t${vt(dir)}`;
    return answer(input, { expression: `Line of intersection of ${p1.src} and ${p2.src}`, primary: { display: disp, plain: disp, spoken: disp }, lines: [{ label: 'Direction (n₁ × n₂)', display: vt(dir) }, { label: 'A point on it', display: `(${P.map(n).join(', ')})` }], notes: [], exactness: 'exact' });
  }
  if (planes.length && pts.length === 2 && /\bintersect\w*|meet|cross|hit|pierce\b/.test(s)) {
    const pl = planes[0]!;
    const [A, B] = pts as [Pt, Pt];
    const dvec = sub(B, A);
    const nrm = [pl.a, pl.b, pl.c];
    const den = dot(nrm, dvec);
    if (Math.abs(den.x) < 1e-14) return answer(input, { expression: 'Line and plane', primary: { display: 'The line is parallel to the plane', plain: 'parallel', spoken: 'parallel' }, notes: [] });
    const tt = pl.a.mul(A.x).add(pl.b.mul(A.y)).add(pl.c.mul(z(A))).add(pl.d).neg().div(den);
    const P = [A.x.add(dvec[0].mul(tt)), A.y.add(dvec[1].mul(tt)), z(A).add(dvec[2].mul(tt))];
    const ang = V.rat(90).sub(acosDeg(abs(den).div(norm(nrm).mul(norm(dvec)))));
    return answer(input, { expression: `Line through ${ptText(A)} and ${ptText(B)} meets the plane ${pl.src}`, primary: { display: `(${P.map(n).join(', ')})`, plain: `(${P.map(n).join(', ')})`, spoken: `at (${P.map(n).join(', ')})` }, lines: [{ label: 'Parameter t', display: n(tt) }, { label: 'Angle between line and plane', display: show(ang, 'angle', '') }], notes: [], exactness: 'exact' });
  }
  if (pts.length === 1 && /\bnormal\b/.test(s)) {
    const nm = /\bnormal\s*(?:vector)?\s*(?:of|is|=|:)?\s*[(<⟨]\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/.exec(s);
    const all = points(t.t);
    const nv = all.find((p) => p.z && p !== pts[0]) ?? undefined;
    const vals = nm ? [V.dec(nm[1]!)!, V.dec(nm[2]!)!, V.dec(nm[3]!)!] : nv ? [nv.x, nv.y, nv.z!] : null;
    if (vals) {
      const P = all.find((p) => p.z && (!nv || p !== nv)) ?? pts[0]!;
      const d = dot(vals, [P.x, P.y, z(P)]).neg();
      const eq = planeText(vals[0]!, vals[1]!, vals[2]!, d);
      return answer(input, { expression: `Plane through ${ptText(P)} with normal ${vt(vals)}`, primary: { display: eq, plain: eq, spoken: eq }, lines: [{ label: 'Point-normal form', display: `${n(vals[0]!)}(x − ${n(P.x)}) + ${n(vals[1]!)}(y − ${n(P.y)}) + ${n(vals[2]!)}(z − ${n(z(P))}) = 0` }], notes: [], exactness: 'exact' });
    }
  }
  if (pts.length === 2 && pts[0]!.z) {
    const all = points(t.t).filter((p) => p.z);
    if (all.length >= 3 && /\bnormal\b/.test(s)) return null;
    const [A, B] = pts as [Pt, Pt];
    const dv = sub(B, A);
    const d = norm(dv);
    const M = `(${[A.x.add(B.x), A.y.add(B.y), z(A).add(z(B))].map((v) => n(v.div(2))).join(', ')})`;
    const param = `(x, y, z) = ${ptText(A)} + t${vt(dv)}`;
    const sym = dv.map((c, i) => (Math.abs(c.x) < 1e-14 ? `${'xyz'[i]} = ${n([A.x, A.y, z(A)][i]!)}` : `(${'xyz'[i]} − ${n([A.x, A.y, z(A)][i]!)})/${n(c)}`)).join(' = ').replace(/− −/g, '+ ');
    let want: 'd' | 'm' | 'l' = 'd';
    if (/\bmid-?point\b/.test(s)) want = 'm';
    else if (/\bline|equation|parametric|symmetric\b/.test(s)) want = 'l';
    const lines: L[] = [{ label: 'Distance', display: `√(Δx² + Δy² + Δz²) = ${show(d, 0, '')}` }, { label: 'Midpoint', display: M }, { label: 'Direction vector', display: vt(dv) }, { label: 'Parametric line', display: param }, { label: 'Symmetric form', display: sym }];
    const primary = want === 'd' ? primaryOf(d, 0, '') : { display: want === 'm' ? M : param, plain: want === 'm' ? M : param, spoken: want === 'm' ? M : param };
    return answer(input, { expression: `${want === 'd' ? 'Distance' : want === 'm' ? 'Midpoint' : 'Line'} · ${ptText(A)} and ${ptText(B)}`, primary, value: want === 'd' ? toDec(d) : undefined, lines, notes: [], exactness: 'exact' });
  }
  if (pts.length === 3 && pts.every((p) => p.z)) {
    const [A, B, C] = pts as [Pt, Pt, Pt];
    const nv = cross(sub(B, A), sub(C, A));
    if (nv.every((v) => Math.abs(v.x) < 1e-14)) return fail(input, 'The three points are collinear, so they don’t fix a single plane');
    const d = dot(nv, [A.x, A.y, z(A)]).neg();
    const g = gcdV([...nv, d]);
    const nn = nv.map((v) => v.div(g)) as unknown as [V, V, V];
    const dd = d.div(g);
    const eq = planeText(nn[0], nn[1], nn[2], dd);
    const area = norm(nv).div(2);
    const tri = /\barea\b|\btriangle\b/.test(s);
    return answer(input, { expression: `Plane through ${ptText(A)}, ${ptText(B)}, ${ptText(C)}`, primary: tri ? primaryOf(area, 0, '') : { display: eq, plain: eq, spoken: eq }, value: tri ? toDec(area) : undefined, lines: [{ label: 'Plane', display: eq }, { label: 'Normal (AB × AC)', display: vt(nn) }, { label: 'Triangle area ½|AB × AC|', display: show(area, 0, '') }, { label: 'Distance from the origin', display: show(abs(dd).div(norm(nn)), 0, '') }], notes: [], exactness: 'exact' });
  }
  if (pts.length === 4 && pts.every((p) => p.z)) {
    const [A, B, C, D] = pts as [Pt, Pt, Pt, Pt];
    const vol6 = dot(sub(B, A), cross(sub(C, A), sub(D, A)));
    const vol = abs(vol6).div(6);
    return answer(input, { expression: `Tetrahedron ${pts.map(ptText).join(', ')}`, primary: primaryOf(vol, 0, ''), value: toDec(vol), lines: [{ label: 'Formula', display: 'V = |AB · (AC × AD)|/6' }, { label: 'Coplanar', display: Math.abs(vol6.x) < 1e-14 ? 'yes' : 'no' }], notes: [], exactness: 'exact' });
  }
  return null;
}

function gcdV(vs: V[]): V {
  const ints = vs.map((v) => (v.e && ex.rational(v.e)?.d === 1n ? Math.round(v.x) : null));
  if (ints.some((x) => x === null)) return V.rat(1);
  let g = 0;
  for (const x of ints as number[]) {
    let a = Math.abs(g);
    let b = Math.abs(x);
    while (b) [a, b] = [b, a % b];
    g = a;
  }
  const lead = (ints as number[]).find((x) => x !== 0) ?? 1;
  return V.rat(g ? (lead < 0 ? -g : g) : 1);
}

export { short };
