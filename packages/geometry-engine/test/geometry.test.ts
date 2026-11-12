import { describe, expect, it } from 'vitest';
import { Construction, GeometryCommands, describe as describeObj, distanceTo, intersect, snap, type Value, type Vec } from '../src/index';

const pt = (c: Construction, id: string): Vec => {
  const v = c.value(id);
  if (v?.type !== 'point') throw new Error(`${id} is not a point`);
  return v.p;
};
const close = (a: Vec, b: Vec, eps = 1e-9) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
  expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(eps * 10);
};
function setup(...cmds: string[]) {
  const c = new Construction();
  const g = new GeometryCommands(c);
  for (const s of cmds) {
    const r = g.run(s);
    if (!r.ok) throw new Error(`${s}: ${r.message}`);
  }
  return { c, g };
}

describe('constructions', () => {
  it('points, midpoints and lengths', () => {
    const { c } = setup('point A at (1,2)', 'point B at (5, 6)', 'midpoint of AB', 'measure AB');
    close(pt(c, 'C'), { x: 3, y: 4 });
    const d = c.value('d1');
    expect(d?.type === 'distance' && d.length).toBeCloseTo(Math.hypot(4, 4), 12);
  });

  it('dragging a free point updates every dependent object (dependency graph)', () => {
    const { c } = setup('A = (0,0)', 'B = (4,0)', 'C = (0,3)', 'triangle ABC', 'midpoint M of BC', 'measure angle BAC', 'segment AM', 'measure AM');
    expect((c.value('ang1') as Extract<Value, { type: 'angle' }>).deg).toBeCloseTo(90, 9);
    expect((c.value('poly1') as Extract<Value, { type: 'polygon' }>).area).toBeCloseTo(6, 12);
    expect((c.value('d1') as Extract<Value, { type: 'distance' }>).length).toBeCloseTo(2.5, 12); // median to the hypotenuse
    expect([...c.dependents('B')].sort()).toEqual(['M', 'ang1', 'd1', 'poly1', 's1'].sort());
    c.move('B', 3, 3);
    close(pt(c, 'M'), { x: 1.5, y: 3 });
    expect((c.value('ang1') as Extract<Value, { type: 'angle' }>).deg).toBeCloseTo(45, 9);
    expect((c.value('poly1') as Extract<Value, { type: 'polygon' }>).area).toBeCloseTo(4.5, 12);
  });

  it('dependent points cannot be moved directly', () => {
    const { c, g } = setup('A = (0,0)', 'B = (2,0)', 'midpoint of AB');
    expect(c.move('C', 5, 5)).toBe(false);
    expect(g.run('move C to (5,5)').ok).toBe(false);
    expect(g.run('move A to (2, 2)').ok).toBe(true);
    close(pt(c, 'C'), { x: 2, y: 1 });
  });

  it('circle through a point, circle with a radius', () => {
    const { c } = setup('A = (1,1)', 'B = (4,5)', 'circle centered A through B', 'circle at B radius 2');
    expect(c.value('c1')).toMatchObject({ type: 'circle', r: 5 });
    expect(c.value('c2')).toMatchObject({ type: 'circle', r: 2 });
  });

  it('perpendicular and parallel lines', () => {
    const { c } = setup('A = (0,0)', 'B = (4,2)', 'C = (1,3)', 'segment AB', 'perpendicular to AB through C', 'parallel to AB through C', 'intersect l1 and AB');
    const perp = c.value('l1') as Extract<Value, { type: 'line' }>;
    const par = c.value('l2') as Extract<Value, { type: 'line' }>;
    const ab = c.value('s1') as Extract<Value, { type: 'line' }>;
    expect(perp.d.x * ab.d.x + perp.d.y * ab.d.y).toBeCloseTo(0, 12);
    expect(Math.abs(par.d.x * ab.d.y - par.d.y * ab.d.x)).toBeLessThan(1e-12);
    // The foot of the perpendicular from C to AB: projection of (1,3) on (4,2) = (10/20)·(4,2) = (2,1).
    close(pt(c, 'D'), { x: 2, y: 1 });
    // Parallel through C stays parallel after AB moves.
    c.move('B', 0, 5);
    const par2 = c.value('l2') as Extract<Value, { type: 'line' }>;
    expect(Math.abs(par2.d.x)).toBeLessThan(1e-12);
  });

  it('perpendicular to two named points makes a hidden helper line', () => {
    const { c } = setup('A = (0,0)', 'B = (2,0)', 'C = (1,5)', 'perpendicular from C to AB');
    const helper = c.objects.find((o) => o.hidden);
    expect(helper?.def).toEqual({ kind: 'line', a: 'A', b: 'B' });
    expect(helper?.id).toBe('h1');
    const v = c.value('l1') as Extract<Value, { type: 'line' }>;
    expect(Math.abs(v.d.x)).toBeLessThan(1e-12);
    // "AB" now names the helper, so a second construction on AB reuses it.
    expect(new GeometryCommands(c).run('parallel to AB through C').ok).toBe(true);
    expect(c.objects.filter((o) => o.hidden)).toHaveLength(1);
  });

  it('intersections: line–line, line–circle, circle–circle, and segments that miss', () => {
    const { c, g } = setup('A = (0,0)', 'B = (2,0)', 'circle centered A through B', 'circle centered B through A', 'intersect c1 and c2');
    const h = Math.sqrt(3);
    const pts = [pt(c, 'C'), pt(c, 'D')].sort((p, q) => q.y - p.y);
    close(pts[0]!, { x: 1, y: h });
    close(pts[1]!, { x: 1, y: -h });
    // Equilateral triangle from the classic construction.
    expect(g.run('measure angle ACB').ok).toBe(true);
    expect((c.value('ang1') as Extract<Value, { type: 'angle' }>).deg).toBeCloseTo(60, 9);
    // A line through the centre meets the circle twice.
    expect(g.run('line AB').ok).toBe(true);
    expect(g.run('intersect c1 and AB').ok).toBe(true);
    const xs = [pt(c, 'E'), pt(c, 'F')].map((p) => p.x).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(-2, 12);
    expect(xs[1]).toBeCloseTo(2, 12);
    // Segments only meet within their ends.
    expect(g.run('G = (10, 10)').ok).toBe(true);
    expect(g.run('H = (11, 12)').ok).toBe(true);
    expect(g.run('segment GH').ok).toBe(true);
    expect(g.run('intersect GH and c1').message).toMatch(/don’t meet/);
  });

  it('an intersection becomes undefined when the curves separate, and comes back', () => {
    const { c } = setup('A = (0,0)', 'B = (2,0)', 'circle centered A through B', 'circle at B radius 1', 'intersect c1 and c2');
    expect(c.value('C')?.type).toBe('point');
    c.move('B', 10, 0); // c1 grows with B: radius 10, c2 radius 1 at (10,0) still meets
    expect(c.value('C')?.type).toBe('point');
    const r = intersect({ type: 'circle', c: { x: 0, y: 0 }, r: 1 }, { type: 'circle', c: { x: 5, y: 0 }, r: 1 });
    expect(r).toEqual([]);
    expect(intersect({ type: 'line', p: { x: 0, y: 0 }, d: { x: 1, y: 0 } }, { type: 'line', p: { x: 0, y: 1 }, d: { x: 1, y: 0 } })).toEqual([]);
  });

  it('angles are 0–180° regardless of orientation', () => {
    const { c, g } = setup('A = (1,0)', 'B = (0,0)', 'C = (-1, 1)', 'angle ABC');
    expect((c.value('ang1') as Extract<Value, { type: 'angle' }>).deg).toBeCloseTo(135, 9);
    g.run('angle CBA');
    expect((c.value('ang2') as Extract<Value, { type: 'angle' }>).deg).toBeCloseTo(135, 9);
  });
});

describe('commands', () => {
  it('accepts spoken wording', () => {
    const { c } = setup('draw a point A at 1 comma minus 2', 'point b at (3, 4)', 'draw the segment from a to b', 'okay measure A B');
    close(pt(c, 'A'), { x: 1, y: -2 });
    expect(c.has('s1')).toBe(true);
    expect(c.has('d1')).toBe(true);
  });

  it('names points automatically', () => {
    const { c } = setup('point at (0,0)', 'point at 1, 1', 'A1 = (2,2)');
    expect(c.objects.map((o) => o.id)).toEqual(['A', 'B', 'A1']);
  });

  it('reports mistakes clearly', () => {
    const { g } = setup('A = (0,0)');
    expect(g.run('segment AB').message).toMatch(/no point B/);
    expect(g.run('A = (3,3)').message).toMatch(/already exists/);
    expect(g.run('triangle AB').ok).toBe(false);
    expect(g.run('fly to the moon').message).toMatch(/don’t know/);
    expect(g.run('circle at A radius 0').ok).toBe(false);
  });

  it('undo, redo, delete with dependents, clear', () => {
    const { c, g } = setup('A = (0,0)', 'B = (1,0)', 'segment AB', 'midpoint of AB');
    expect(g.run('delete A').message).toMatch(/Deleted A and 2 objects/);
    expect(c.objects.map((o) => o.id)).toEqual(['B']);
    g.run('undo');
    expect(c.objects.map((o) => o.id)).toEqual(['A', 'B', 's1', 'C']);
    g.run('redo');
    expect(c.objects.length).toBe(1);
    g.run('undo');
    // A drag is one undo step.
    c.beginChange();
    c.move('A', 0.5, 0);
    c.move('A', 0.7, 0);
    c.move('A', 0.9, 0);
    g.run('undo');
    close(pt(c, 'A'), { x: 0, y: 0 });
    g.run('clear');
    expect(c.objects.length).toBe(0);
    expect(g.run('undo').ok).toBe(true);
    expect(c.objects.length).toBe(4);
  });
});

describe('save and load', () => {
  it('round-trips through JSON and drops malformed entries', () => {
    const { c } = setup('A = (0,0)', 'B = (3,4)', 'circle centered A through B', 'measure AB');
    const json = JSON.parse(JSON.stringify(c.toJSON()));
    const back = Construction.fromJSON(json);
    expect(back.objects).toEqual(c.objects);
    expect(back.value('c1')).toMatchObject({ r: 5 });
    const bad = Construction.fromJSON({ objects: [{ id: 'A', def: { kind: 'point', x: 'nope', y: 1 } }, { id: 's1', def: { kind: 'segment', a: 'A', b: 'B' } }, null, { id: 'B', def: { kind: 'point', x: 1, y: 1 } }] });
    expect(bad.objects.map((o) => o.id)).toEqual(['B']);
    expect(Construction.fromJSON('garbage').objects).toEqual([]);
  });
});

describe('helpers', () => {
  it('snap, hit distance and descriptions', () => {
    expect(snap(1.26, 0.5)).toBe(1.5);
    expect(snap(-0.74, 1)).toBe(-1);
    expect(distanceTo({ type: 'circle', c: { x: 0, y: 0 }, r: 2 }, { x: 3, y: 0 })).toBeCloseTo(1);
    expect(distanceTo({ type: 'line', p: { x: 0, y: 0 }, d: { x: 1, y: 0 }, seg: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }, { x: 2, y: 0 })).toBeCloseTo(1);
    const { c } = setup('A = (1,2)');
    expect(describeObj(c.get('A')!, c.value('A'))).toBe('Point A at (1, 2)');
  });
});
