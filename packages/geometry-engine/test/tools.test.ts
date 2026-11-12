import { describe, expect, it } from 'vitest';
import { Construction, GeometryCommands, describe as describeObj, niceStep, regularPolygonPoints, tangentPoints, type Value, type Vec } from '../src/index';

const pt = (c: Construction, id: string): Vec => {
  const v = c.value(id);
  if (v?.type !== 'point') throw new Error(`${id} is not a point`);
  return v.p;
};
const near = (a: Vec, b: Vec, digits = 9) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};
type Line = Extract<Value, { type: 'line' }>;
type Circle = Extract<Value, { type: 'circle' }>;
type Poly = Extract<Value, { type: 'polygon' }>;
const line = (c: Construction, id: string) => c.value(id) as Line;
const circle = (c: Construction, id: string) => c.value(id) as Circle;
const poly = (c: Construction, id: string) => c.value(id) as Poly;
/** Distance from q to an infinite line. */
const off = (l: Line, q: Vec) => Math.abs(l.d.x * (q.y - l.p.y) - l.d.y * (q.x - l.p.x));

function setup(...cmds: string[]) {
  const c = new Construction();
  const g = new GeometryCommands(c);
  for (const s of cmds) {
    const r = g.run(s);
    if (!r.ok) throw new Error(`${s}: ${r.message}`);
  }
  return { c, g };
}

describe('compass', () => {
  it('radius from two points or a segment, live as they move', () => {
    const { c, g } = setup('A = (1, 1)', 'B = (0, 0)', 'C = (3, 4)', 'compass A radius BC');
    expect(circle(c, 'c1')).toMatchObject({ c: { x: 1, y: 1 }, r: 5 });
    c.move('C', 0, 2);
    expect(circle(c, 'c1').r).toBeCloseTo(2, 12);
    g.run('segment BC');
    expect(g.run('compass at B radius s1').ok).toBe(true);
    expect(circle(c, 'c2')).toMatchObject({ c: { x: 0, y: 0 }, r: 2 });
    expect(g.run('compass A radius 2.5').ok).toBe(true);
    expect(circle(c, 'c3').r).toBe(2.5);
    expect(g.run('compass A radius r').message).toMatch(/no slider r/);
    expect(g.run('compass A').ok).toBe(false);
  });

  it('radius from a slider', () => {
    const { c, g } = setup('A = (0, 0)', 'slider k from 0 to 5', 'compass A radius k');
    expect(circle(c, 'c1').r).toBe(1);
    g.run('set k to 3.5');
    expect(circle(c, 'c1').r).toBe(3.5);
    g.run('k = 0');
    expect(c.value('c1')).toBeUndefined(); // radius 0: no circle
    g.run('circle at A radius k');
    expect(c.objects.at(-1)!.def).toMatchObject({ kind: 'circleRadius', r: 'k' });
  });
});

describe('bisectors', () => {
  it('perpendicular bisector is equidistant from both ends', () => {
    const { c, g } = setup('A = (1, 2)', 'B = (5, -2)', 'perpendicular bisector of AB');
    const l = line(c, 'l1');
    near(l.p, { x: 3, y: 0 });
    expect(l.d.x * 4 + l.d.y * -4).toBeCloseTo(0, 12); // perpendicular to AB
    c.move('B', -3, 6);
    const q = { x: line(c, 'l1').p.x + 7 * line(c, 'l1').d.x, y: line(c, 'l1').p.y + 7 * line(c, 'l1').d.y };
    expect(Math.hypot(q.x - 1, q.y - 2)).toBeCloseTo(Math.hypot(q.x + 3, q.y - 6), 9);
    g.run('segment AB');
    expect(g.run('perp bisector of s1').ok).toBe(true);
  });

  it('angle bisector halves the angle, including a straight angle', () => {
    const { c, g } = setup('A = (4, 0)', 'B = (0, 0)', 'C = (0, 3)', 'angle bisector of ABC');
    const l = line(c, 'l1');
    expect(Math.abs(l.d.x)).toBeCloseTo(Math.SQRT1_2, 12);
    expect(Math.abs(l.d.y)).toBeCloseTo(Math.SQRT1_2, 12);
    c.move('C', -2, 0); // 180°
    const s = line(c, 'l1');
    expect(Math.abs(s.d.x)).toBeCloseTo(0, 12);
    expect(g.run('bisect angle CBA').ok).toBe(true);
    expect(g.run('angle bisector of AB').ok).toBe(false);
    // "measure angle" still works
    expect(g.run('measure angle ABC').ok).toBe(true);
  });
});

describe('tangents', () => {
  it('two from outside, one on the circle, none inside — live', () => {
    const { c, g } = setup('O = (0, 0)', 'R = (1, 0)', 'circle centered O through R', 'P = (2, 0)', 'tangents from P to c1');
    expect(c.objects.filter((o) => o.def.kind === 'tangent').length).toBe(2);
    for (const id of ['l1', 'l2']) {
      const l = line(c, id);
      expect(off(l, { x: 0, y: 0 })).toBeCloseTo(1, 12); // distance from centre = radius
      near(l.p, { x: 2, y: 0 });
    }
    // Tangent points are at 60° from the line OP.
    expect(tangentPoints({ x: 2, y: 0 }, { x: 0, y: 0 }, 1).map((p) => p.x)).toEqual([expect.closeTo(0.5, 12), expect.closeTo(0.5, 12)]);
    c.move('P', 0, 1); // on the circle
    expect(line(c, 'l1').d.y).toBeCloseTo(0, 12);
    expect(c.value('l2')).toBeUndefined();
    c.move('P', 0.2, 0.2); // inside
    expect(c.value('l1')).toBeUndefined();
    expect(describeObj(c.get('l1')!, c.value('l1'))).toMatch(/none right now/);
    c.move('P', 0, -3);
    expect(off(line(c, 'l2'), { x: 0, y: 0 })).toBeCloseTo(1, 12);
    expect(g.run('tangents from O to c1').message).toMatch(/inside/);
    expect(g.run('tangent from P to O').message).toMatch(/isn’t a circle/);
  });
});

describe('regular polygons', () => {
  it('builds n equal sides counterclockwise, from a number or a slider', () => {
    const { c, g } = setup('A = (0, 0)', 'B = (1, 0)', 'regular polygon AB 6');
    const p = poly(c, 'poly1');
    expect(p.pts.length).toBe(6);
    expect(p.perimeter).toBeCloseTo(6, 12);
    expect(p.area).toBeCloseTo((3 * Math.sqrt(3)) / 2, 12);
    near(p.pts[2]!, { x: 1.5, y: Math.sqrt(3) / 2 });
    expect(g.run('regular square AB').ok).toBe(true);
    expect(poly(c, 'poly2').area).toBeCloseTo(1, 12);
    g.run('slider n from 3 to 12 step 1');
    g.run('set n to 4');
    expect(g.run('regular polygon AB n').ok).toBe(true);
    expect(poly(c, 'poly3').pts.length).toBe(4);
    g.run('n = 8');
    expect(poly(c, 'poly3').pts.length).toBe(8);
    expect(g.run('regular polygon AB 2').ok).toBe(false);
    expect(g.run('regular polygon AB').ok).toBe(false);
    expect(regularPolygonPoints({ x: 0, y: 0 }, { x: 2, y: 0 }, 4).at(-1)).toEqual({ x: expect.closeTo(0, 12), y: expect.closeTo(2, 12) });
  });
});

describe('transformations', () => {
  it('reflect a point and a circle over a line; images follow their sources', () => {
    const { c, g } = setup('A = (0, 0)', 'B = (1, 1)', 'P = (3, 0)', 'reflect P over AB');
    near(pt(c, "P'"), { x: 0, y: 3 });
    c.move('P', 5, 1);
    near(pt(c, "P'"), { x: 1, y: 5 });
    c.move('B', 1, 0); // mirror is the x-axis now
    near(pt(c, "P'"), { x: 5, y: -1 });
    g.run('circle at P radius 2');
    expect(g.run('reflect c1 across AB').ok).toBe(true);
    expect(circle(c, 'c2')).toMatchObject({ r: 2 });
    near(circle(c, 'c2').c, { x: 5, y: -1 });
    expect([...c.dependents('P')]).toContain('c2');
  });

  it('rotate by degrees or by a slider, counterclockwise unless told', () => {
    const { c, g } = setup('O = (1, 1)', 'P = (3, 1)', 'rotate P about O by 90');
    near(pt(c, "P'"), { x: 1, y: 3 });
    g.run('rotate P about O by 90 degrees clockwise');
    near(pt(c, 'A'), { x: 1, y: -1 });
    g.run('slider t from 0 to 360');
    g.run('rotate P about O by t');
    g.run('set t to 180');
    near(pt(c, 'B'), { x: -1, y: 1 });
    // A whole polygon turns, keeping its area.
    g.run('Q = (1, 2)');
    g.run('triangle OPQ');
    g.run('rotate poly1 about O by 45°');
    expect(poly(c, 'poly2').area).toBeCloseTo(poly(c, 'poly1').area, 12);
    near(poly(c, 'poly2').pts[1]!, { x: 1 + Math.SQRT2, y: 1 + Math.SQRT2 });
    expect(g.run('rotate P about O by z').message).toMatch(/no slider z/);
  });

  it('translate by a vector (two points) and dilate by a factor', () => {
    const { c, g } = setup('A = (0, 0)', 'B = (2, 1)', 'P = (1, 1)', 'translate P by AB', 'dilate P from A by 2');
    near(pt(c, "P'"), { x: 3, y: 2 });
    near(pt(c, 'C'), { x: 2, y: 2 });
    c.move('B', -1, 0);
    near(pt(c, "P'"), { x: 0, y: 1 });
    g.run('Q = (3, 1)');
    g.run('segment PQ');
    g.run('slider k from -2 to 3');
    g.run('dilate s1 from A by k');
    g.run('k = 3');
    const s = line(c, 's2');
    expect(s.seg).toBeDefined();
    expect(Math.hypot(s.seg![1].x - s.seg![0].x, s.seg![1].y - s.seg![0].y)).toBeCloseTo(6, 12);
    g.run('circle at P radius 1');
    g.run('dilate c1 from A by -0.5');
    expect(circle(c, 'c2').r).toBeCloseTo(0.5, 12);
    near(circle(c, 'c2').c, { x: -0.5, y: -0.5 });
    expect(g.run('translate P from A to B').ok).toBe(true);
    expect(g.run('measure AB').ok).toBe(true);
    expect(g.run('reflect d1 over AB').message).toMatch(/can’t be transformed/);
    // Transforms chain: the image of an image updates too.
    g.run("rotate P' about A by 90");
    c.move('P', 2, 0);
    near(pt(c, "P'"), { x: 1, y: 0 });
  });
});

describe('sliders', () => {
  it('make, set (clamped), name, step, undo and save', () => {
    const { c, g } = setup('slider k from 0 to 5');
    expect(c.value('k')).toMatchObject({ type: 'number', value: 1, min: 0, max: 5, step: 0.05 });
    expect(g.run('set k to 9').ok).toBe(true);
    expect(c.value('k')).toMatchObject({ value: 5 });
    g.run('undo');
    expect(c.value('k')).toMatchObject({ value: 1 });
    g.run('slider from -1 to 1 step 0.25 value 0.5');
    expect(c.value('k1')).toMatchObject({ value: 0.5, step: 0.25 });
    expect(g.run('slider q from 5 to 1').ok).toBe(false);
    expect(g.run('slider k from 0 to 2').message).toMatch(/already exists/);
    expect(g.run('set A to 2').message).toMatch(/no slider A/);
    expect(niceStep(0, 360)).toBe(2);
    expect(describeObj(c.get('k')!, c.value('k'))).toBe('Slider k (0 to 5) = 1');
    const back = Construction.fromJSON(JSON.parse(JSON.stringify(c.toJSON())));
    expect(back.objects).toEqual(c.objects);
    expect(c.setSlider('k', 2.5)).toBe(true);
    expect(c.value('k')).toMatchObject({ value: 2.5 });
  });
});

describe('trace, labels and more', () => {
  it('trace toggles a saved flag on points only; effects for the canvas', () => {
    const { c, g } = setup('A = (0, 0)', 'B = (1, 0)', 'segment AB', 'midpoint M of AB');
    expect(g.run('trace M').ok).toBe(true);
    expect(c.get('M')!.trace).toBe(true);
    expect(g.run('trace s1').message).toMatch(/Only points/);
    expect(Construction.fromJSON(c.toJSON()).get('M')!.trace).toBe(true);
    g.run('trace M off');
    expect(c.get('M')!.trace).toBeUndefined();
    g.run('undo');
    expect(c.get('M')!.trace).toBe(true);
    g.run('stop tracing M');
    expect(c.get('M')!.trace).toBeUndefined();
    expect(g.run('clear trace')).toMatchObject({ ok: true, effect: 'clearTrace' });
    expect(g.run('hide labels')).toMatchObject({ ok: true, effect: 'labelsOff' });
    expect(g.run('show labels')).toMatchObject({ ok: true, effect: 'labelsOn' });
    expect(g.run('labels off')).toMatchObject({ effect: 'labelsOff' });
  });

  it('saved figures with the new kinds round-trip, and bad ones are dropped', () => {
    const { c } = setup('A = (0,0)', 'B = (2,0)', 'P = (1, 3)', 'slider k from 0 to 4', 'compass A radius AB', 'regular polygon AB 5', 'perpendicular bisector of AB', 'angle bisector of APB', 'tangents from P to c1', 'reflect P over AB', 'rotate P about A by k', 'translate P by AB', 'dilate P from A by k');
    const back = Construction.fromJSON(JSON.parse(JSON.stringify(c.toJSON())));
    expect(back.objects).toEqual(c.objects);
    expect(back.objects.length).toBe(c.objects.length);
    const bad = Construction.fromJSON({ objects: [{ id: 'A', def: { kind: 'point', x: 0, y: 0 } }, { id: 'k', def: { kind: 'slider', min: 5, max: 1, value: 2 } }, { id: 'X', def: { kind: 'rotate', src: 'A', center: 'A', angle: null } }, { id: 'Y', def: { kind: 'dilate', src: 'A', center: 'A', factor: 'k' } }] });
    expect(bad.objects.map((o) => o.id)).toEqual(['A']);
  });

  it('names images with a prime and describes them', () => {
    const { c } = setup('A = (0, 0)', 'B = (1, 0)', 'P = (0, 1)', 'reflect P over AB', 'reflect P over AB');
    expect(c.objects.slice(-2).map((o) => o.id)).toEqual(["P'", 'C']);
    expect(describeObj(c.get("P'")!, c.value("P'"), c)).toBe("Reflection P' of P over AB at (0, -1)");
  });
});
