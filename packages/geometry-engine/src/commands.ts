import { Construction, describe, formatNumber, POINT_NAME, SLIDER_NAME } from './construction';
import { intersect, tangentPoints, type Def, type GObj, type Id, type NumRef } from './model';

/**
 * Typed or spoken geometry commands, carried out on a construction. Deterministic and forgiving about wording:
 *
 *   "point A at (1, 2)", "A = (1, 2)", "point at 3, -1"     a free point (named for you if no name is given)
 *   "segment AB", "line through A and B"                    segments and lines
 *   "circle centered A through B", "circle at A radius 3"    circles
 *   "triangle ABC", "polygon A B C D"                       polygons
 *   "midpoint of AB", "midpoint M of A and B"               midpoints
 *   "perpendicular to AB through C", "parallel to l1 through D"
 *   "intersect c1 and AB", "intersection of AB and CD"      intersection points
 *   "measure angle ABC", "measure AB", "distance from A to B"
 *   "move A to (3, 4)", "delete C", "undo", "redo", "clear"
 *   "compass A radius BC", "perpendicular bisector of AB", "angle bisector of ABC", "tangents from P to c1"
 *   "regular polygon AB 6", "reflect P over AB", "rotate P about A by 90", "translate P by AB", "dilate P from A by 2"
 *   "slider k from 0 to 5", "set k to 2", "trace P", "trace P off", "clear trace", "show labels", "hide labels"
 *
 * Numbers in rotations, dilations, radii and side counts may be a slider's name ("rotate P about A by k").
 */

/** Things only the canvas can do (trails and labels live there); the command reports them back. */
export type CommandEffect = 'clearTrace' | 'labelsOn' | 'labelsOff';
export type CommandResult = { ok: true; message: string; select?: Id; effect?: CommandEffect } | { ok: false; message: string };

const NUM = String.raw`[-−]?(?:\d+(?:\.\d+)?|\.\d+)`;
const PAIR = String.raw`\(?\s*(${NUM})\s*(?:,|\s)\s*(${NUM})\s*\)?`;
const NAME = String.raw`[A-Za-z](?:\d+|')?`;
/** A number or the name of a slider/measurement. */
const NUMREF = String.raw`(?:${NUM}|[A-Za-z][A-Za-z0-9_']*)`;
const num = (s: string) => Number(s.replace('−', '-'));

/** Spoken forms become typed ones: "minus 2" → "-2", "1 comma 2" → "1, 2", "A B C" → "ABC". */
export function normalizeCommand(raw: string): string {
  return raw
    .trim()
    .replace(/[.!?]+$/, '')
    .replace(/^(?:(?:ok(?:ay)?|so|now|then|please|can you|could you|let'?s)[\s,]+)+/i, '')
    .replace(/^(?:draw|make|create|construct|add|place|put|plot|show|find|give me)\s+/i, '')
    .replace(/^(?:a|an|the)\s+(?=(?:point|segment|line|straight|circle|triangle|quad|square|rectangle|pentagon|hexagon|polygon|midpoint|perpendicular|parallel|intersection|angle|length|distance|compass|regular|tangents?|slider|bisector)\b)/i, '')
    .replace(/\b(?:minus|negative)\s+(?=\d|\.)/gi, '-')
    .replace(/\s+comma\s+/gi, ', ')
    .replace(/\bcentred\b|\bcentered\b|\bcentre\b/gi, 'center')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Point names in "ABC", "A B C", "A, B and C", "A1B1". */
function pointNames(s: string): Id[] | null {
  const t = s.replace(/\b(?:and|to|points?|segment|line)\b/gi, ' ').replace(/[,\s]+/g, '');
  if (!t) return null;
  const re = /[A-Za-z](?:\d+|')?/g;
  const out = t.match(re)?.map((n) => n[0]!.toUpperCase() + n.slice(1)) ?? [];
  return out.join('').length === t.length ? out : null;
}

export class GeometryCommands {
  constructor(private c: Construction) {}

  /** Finds an object by name, case-insensitively ("c1", "AB" for the line or segment through A and B). */
  private ref(token: string): Id | null {
    const t = token.trim().replace(/^(?:the\s+)?(?:segment|line|circle|polygon|point|slider)\s+/i, '');
    const exact = this.c.objects.find((o) => o.id === t) ?? this.c.objects.find((o) => o.id.toLowerCase() === t.toLowerCase());
    if (exact) return exact.id;
    const names = pointNames(t);
    if (names?.length === 2) {
      const [a, b] = names as [Id, Id];
      const hit = this.c.objects.find((o) => (o.def.kind === 'segment' || o.def.kind === 'line') && ((o.def.a === a && o.def.b === b) || (o.def.a === b && o.def.b === a)));
      if (hit) return hit.id;
    }
    return null;
  }

  /** A line-like object for "AB": an existing line or segment, or a new hidden line through A and B. */
  private lineRef(token: string, extra: (Omit<GObj, 'id'> & { id?: Id })[]): Id {
    const id = this.ref(token);
    if (id) {
      const v = this.c.value(id);
      const sh = this.c.shape(id);
      if ((sh !== 'line' && sh !== 'segment') || (v && v.type !== 'line')) throw new Error(`${id} isn’t a line`);
      return id;
    }
    const names = pointNames(token);
    if (names?.length !== 2) throw new Error(`There is no ${token.trim()}`);
    this.needPoints(names);
    // Helper lines are hidden and named h1, h2… so they never take a name the user will see (l1, l2…).
    const taken = new Set([...this.c.objects.map((o) => o.id), ...extra.map((e) => e.id!)]);
    let n = 1;
    while (taken.has(`h${n}`)) n++;
    const lid = `h${n}`;
    extra.push({ id: lid, def: { kind: 'line', a: names[0]!, b: names[1]! }, hidden: true });
    return lid;
  }

  private needPoints(names: Id[]): void {
    for (const n of names) {
      const o = this.c.get(n);
      if (!o) throw new Error(`There is no point ${n}`);
      if (this.c.value(n)?.type !== 'point') throw new Error(`${n} isn’t a point`);
    }
    if (new Set(names).size !== names.length) throw new Error('Use different points');
  }

  private addOne(def: Def, id?: string): CommandResult {
    if (id !== undefined) {
      if (def.kind !== 'slider') id = id[0]!.toUpperCase() + id.slice(1);
      if (this.c.has(id)) throw new Error(`${id} already exists`);
    }
    const [o] = this.c.add(id ? { id, def } : { def });
    return { ok: true, message: describe(o!, this.c.value(o!.id), this.c), select: o!.id };
  }

  /** Adds helper objects and then the main one; reports the last. */
  private addWith(extra: (Omit<GObj, 'id'> & { id?: Id })[], def: Def): CommandResult {
    const [o] = this.c.add(...extra, { def }).slice(-1);
    return { ok: true, message: describe(o!, this.c.value(o!.id), this.c), select: o!.id };
  }

  /** A number, or the name of a slider, length or angle that gives one. */
  private numRef(tok: string): NumRef {
    const t = tok.trim().replace(/°$/, '');
    if (new RegExp(`^${NUM}$`).test(t)) return num(t);
    const id = this.ref(t);
    const sh = id ? this.c.shape(id) : undefined;
    if (!id) throw new Error(`There is no slider ${t}. Make one with “slider ${t.toLowerCase()} from 0 to 5”`);
    if (sh !== 'number' && sh !== 'distance' && sh !== 'angle') throw new Error(`${id} isn’t a number`);
    return id;
  }

  /** Something a transformation can move: a point, line, segment, circle or polygon. */
  private shapeRef(tok: string): Id {
    const id = this.ref(tok);
    if (!id) throw new Error(`There is no ${tok.trim()}`);
    const sh = this.c.shape(id);
    if (sh === 'angle' || sh === 'distance' || sh === 'number') throw new Error(`${id} can’t be transformed; pick a point, line, circle or polygon`);
    return id;
  }

  private circleRef(tok: string): Id {
    const id = this.ref(tok);
    if (!id) throw new Error(`There is no ${tok.trim()}`);
    if (this.c.shape(id) !== 'circle') throw new Error(`${id} isn’t a circle`);
    return id;
  }

  /** "BC" or "s1" (two points, for a compass radius) — or a number or slider. */
  private radius(center: Id, tok: string): CommandResult {
    const t = tok.trim();
    const id = this.ref(t);
    const d = id ? this.c.get(id)?.def : undefined;
    if (d && (d.kind === 'segment' || d.kind === 'line')) return this.addOne({ kind: 'compass', center, a: d.a, b: d.b });
    if (!id && !new RegExp(`^${NUM}$`).test(t)) {
      const pts = pointNames(t);
      if (pts?.length === 2) {
        this.needPoints(pts);
        return this.addOne({ kind: 'compass', center, a: pts[0]!, b: pts[1]! });
      }
    }
    const r = this.numRef(t);
    if (typeof r === 'number' && !(r > 0)) throw new Error('The radius must be more than 0');
    return this.addOne({ kind: 'circleRadius', center, r });
  }

  run(raw: string): CommandResult {
    try {
      return this.runNow(normalizeCommand(raw));
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  private runNow(s: string): CommandResult {
    let m: RegExpExecArray | null;
    const t = s.toLowerCase();
    if (!t) return { ok: false, message: 'Say or type a construction, like “point A at (1, 2)”' };

    if (/^(?:undo|scratch that|go back|take that back)$/.test(t)) return this.c.undo() ? { ok: true, message: 'Undone' } : { ok: false, message: 'Nothing to undo' };
    if (/^redo$/.test(t)) return this.c.redo() ? { ok: true, message: 'Redone' } : { ok: false, message: 'Nothing to redo' };
    if (/^(?:clear|reset|start over|new figure|clear (?:it|all|everything|the (?:canvas|figure|board)))$/.test(t)) {
      this.c.clear();
      return { ok: true, message: 'Cleared' };
    }

    // Points
    if ((m = new RegExp(`^(?:point|pt)(?:\\s+(${NAME}))?\\s*(?:at|=)?\\s*${PAIR}$`, 'i').exec(s)) || (m = new RegExp(`^(${NAME})\\s*(?:=|at)\\s*${PAIR}$`, 'i').exec(s))) {
      const name = m[1] && !/^(?:at)$/i.test(m[1]) ? m[1] : undefined;
      if (name && !POINT_NAME.test(name[0]!.toUpperCase() + name.slice(1))) throw new Error(`${name} isn’t a point name`);
      return this.addOne({ kind: 'point', x: num(m[2]!), y: num(m[3]!) }, name);
    }
    if ((m = new RegExp(`^move\\s+(?:point\\s+)?(${NAME})\\s+to\\s+${PAIR}$`, 'i').exec(s))) {
      const id = this.ref(m[1]!);
      if (!id) throw new Error(`There is no ${m[1]}`);
      if (this.c.get(id)?.def.kind !== 'point') throw new Error(`${id} depends on other objects, so it can’t be moved`);
      this.c.move(id, num(m[2]!), num(m[3]!), true);
      return { ok: true, message: describe(this.c.get(id)!, this.c.value(id), this.c), select: id };
    }

    // Segments and lines
    if ((m = /^(?:line )?segment\s+(?:from\s+)?(.+)$/i.exec(s))) return this.twoPoints('segment', m[1]!);
    if ((m = /^(?:straight )?line\s+(?:through\s+)?(.+)$/i.exec(s)) && !/^(?:line\s+)?(?:perpendicular|parallel)/i.test(s)) return this.twoPoints('line', m[1]!);

    // Circles
    if ((m = new RegExp(`^circle\\s+(?:with\\s+)?(?:(?:center|middle)(?:\\s+(?:at|on))?|at|around|about)\\s+(?:point\\s+)?(${NAME})\\s*,?\\s+(?:and\\s+)?(?:passing\\s+)?through\\s+(?:point\\s+)?(${NAME})$`, 'i').exec(s))) {
      const [c, p] = [up(m[1]!), up(m[2]!)];
      this.needPoints([c, p]);
      return this.addOne({ kind: 'circle', center: c, through: p });
    }
    if ((m = new RegExp(`^circle\\s+(?:with\\s+)?(?:(?:center|middle)(?:\\s+(?:at|on))?|at|around|about)\\s+(?:point\\s+)?(${NAME})\\s*,?\\s+(?:and\\s+)?(?:with\\s+)?(?:a\\s+)?radius\\s*(?:of|=)?\\s*(.+)$`, 'i').exec(s))) {
      const c = up(m[1]!);
      this.needPoints([c]);
      return this.radius(c, m[2]!);
    }
    // Compass: "compass A radius BC", "compass at A radius 3", "compass A s1"
    if ((m = new RegExp(`^compass\\s+(?:(?:with\\s+)?center\\s+(?:at\\s+)?|at\\s+)?(?:point\\s+)?(${NAME})\\s*,?\\s+(?:(?:with\\s+)?(?:a\\s+)?radius\\s*(?:of|=)?\\s*)?(.+)$`, 'i').exec(s))) {
      const c = up(m[1]!);
      this.needPoints([c]);
      return this.radius(c, m[2]!);
    }
    if (/^compass\b/i.test(s)) throw new Error('Try “compass A radius BC”: centre A, radius the length BC');

    // Regular polygons: "regular polygon AB 6", "regular hexagon AB", "regular polygon AB n"
    if ((m = new RegExp(`^regular\\s+(polygon|triangle|square|pentagon|hexagon|heptagon|octagon|nonagon|decagon)\\s+(?:on\\s+|from\\s+)?(.+?)(?:\\s+(?:with\\s+)?(${NUMREF})(?:\\s+sides)?)?$`, 'i').exec(s))) {
      const named: Record<string, number> = { triangle: 3, square: 4, pentagon: 5, hexagon: 6, heptagon: 7, octagon: 8, nonagon: 9, decagon: 10 };
      const pts = this.pairOf(m[2]!);
      const fixed = named[m[1]!.toLowerCase()];
      if (fixed && m[3]) throw new Error(`A regular ${m[1]!.toLowerCase()} always has ${fixed} sides`);
      if (!fixed && !m[3]) throw new Error('Say how many sides, like “regular polygon AB 6”');
      const n = fixed ?? this.numRef(m[3]!);
      if (typeof n === 'number' && (!Number.isInteger(n) || n < 3 || n > 100)) throw new Error('Use a whole number of sides from 3 to 100');
      return this.addOne({ kind: 'regularPolygon', a: pts[0], b: pts[1], n });
    }

    // Polygons
    if ((m = /^(triangle|quadrilateral|quad|square|rectangle|pentagon|hexagon|polygon)\s+(.+)$/i.exec(s))) {
      const pts = pointNames(m[2]!);
      if (!pts || pts.length < 3) throw new Error('Name at least three points, like “polygon ABC”');
      const need: Record<string, number> = { triangle: 3, quadrilateral: 4, quad: 4, square: 4, rectangle: 4, pentagon: 5, hexagon: 6 };
      const n = need[m[1]!.toLowerCase()];
      if (n && pts.length !== n) throw new Error(`A ${m[1]!.toLowerCase()} needs ${n} points`);
      this.needPoints(pts);
      return this.addOne({ kind: 'polygon', pts });
    }

    // Midpoint
    if ((m = new RegExp(`^midpoint\\s+(?:(${NAME})\\s+)?(?:of|between)\\s+(.+)$`, 'i').exec(s))) {
      const pts = this.pairOf(m[2]!);
      return this.addOne({ kind: 'midpoint', a: pts[0], b: pts[1] }, m[1]);
    }

    // Bisectors
    if ((m = /^(?:perpendicular|perp)\s+bisector\s+(?:of\s+|for\s+|to\s+)?(.+)$/i.exec(s))) {
      const pts = this.pairOf(m[1]!);
      return this.addOne({ kind: 'perpBisector', a: pts[0], b: pts[1] });
    }
    if ((m = /^(?:angle\s+bisector|bisector\s+of(?:\s+the)?\s+angle|bisect(?:\s+the)?(?:\s+angle)?)\s+(?:of\s+)?(?:the\s+)?(?:angle\s+)?(.+)$/i.exec(s))) {
      const pts = pointNames(m[1]!);
      if (pts?.length !== 3) throw new Error('Name the angle by three points, like “angle bisector of ABC”');
      this.needPoints(pts);
      return this.addOne({ kind: 'angleBisector', a: pts[0]!, b: pts[1]!, c: pts[2]! });
    }

    // Tangents
    if ((m = new RegExp(`^tangents?(?:\\s+lines?)?\\s+(?:from|through|at)\\s+(?:point\\s+)?(${NAME})\\s+(?:to|on)\\s+(?:the\\s+)?(?:circle\\s+)?(\\S+)$`, 'i').exec(s))) {
      const p = up(m[1]!);
      this.needPoints([p]);
      const circ = this.circleRef(m[2]!);
      const pv = this.c.value(p);
      const cv = this.c.value(circ);
      const n = pv?.type === 'point' && cv?.type === 'circle' ? tangentPoints(pv.p, cv.c, cv.r).length : 0;
      if (!n) throw new Error(`${p} is inside ${circ}, so there are no tangents`);
      // Both are made, so a point dragged from on the circle to outside it gets its second tangent.
      const added = this.c.add({ def: { kind: 'tangent', point: p, circle: circ, which: 0 } }, { def: { kind: 'tangent', point: p, circle: circ, which: 1 } });
      return { ok: true, message: `${n === 1 ? `1 tangent (${p} is on ${circ})` : '2 tangents'}: ${added.map((o) => o.id).join(', ')}`, select: added[0]!.id };
    }

    // Transformations
    if ((m = /^(?:reflect|mirror|flip)\s+(.+?)\s+(?:over|across|in|about|through)\s+(?:the\s+)?(?:line\s+)?(.+)$/i.exec(s))) {
      const src = this.shapeRef(m[1]!);
      const extra: (Omit<GObj, 'id'> & { id?: Id })[] = [];
      const line = this.lineRef(m[2]!, extra);
      return this.addWith(extra, { kind: 'reflect', src, line });
    }
    if ((m = new RegExp(`^(?:rotate|turn|spin)\\s+(.+?)\\s+(?:about|around|round|on)\\s+(?:point\\s+)?(${NAME})\\s+(?:by\\s+)?(${NUMREF})\\s*(?:°|deg(?:rees?|s)?)?(?:\\s+(clockwise|cw|counterclockwise|anticlockwise|ccw))?$`, 'i').exec(s))) {
      const src = this.shapeRef(m[1]!);
      const center = up(m[2]!);
      this.needPoints([center]);
      const angle = this.numRef(m[3]!);
      const def: Def = { kind: 'rotate', src, center, angle };
      if (m[4] && /^(?:clockwise|cw)$/i.test(m[4])) def.cw = true;
      return this.addOne(def);
    }
    if ((m = new RegExp(`^(?:translate|shift|slide|move)\\s+(.+?)\\s+(?:(?:by|along)\\s+(?:the\\s+)?(?:vector\\s+)?(.+)|from\\s+(?:point\\s+)?(${NAME})\\s+to\\s+(?:point\\s+)?(${NAME}))$`, 'i').exec(s))) {
      const src = this.shapeRef(m[1]!);
      let a: Id, b: Id;
      if (m[2]) [a, b] = this.pairOf(m[2]);
      else {
        [a, b] = [up(m[3]!), up(m[4]!)];
        this.needPoints([a, b]);
      }
      return this.addOne({ kind: 'translate', src, a, b });
    }
    if ((m = new RegExp(`^(?:dilate|scale|enlarge|stretch)\\s+(.+?)\\s+(?:from|about|around|with center|center)\\s+(?:point\\s+)?(${NAME})\\s+(?:by\\s+)?(?:(?:a\\s+)?(?:scale\\s+)?factor\\s+(?:of\\s+)?)?(${NUMREF})$`, 'i').exec(s))) {
      const src = this.shapeRef(m[1]!);
      const center = up(m[2]!);
      this.needPoints([center]);
      return this.addOne({ kind: 'dilate', src, center, factor: this.numRef(m[3]!) });
    }

    // Sliders
    if ((m = new RegExp(`^slider(?:\\s+(?!from\\b)([A-Za-z][A-Za-z0-9_]*))?\\s+(?:from\\s+)?(${NUM})\\s*(?:to|\\.\\.|-|–)\\s*(${NUM})(?:\\s*,?\\s+(?:step|by)\\s+(${NUM}))?(?:\\s*,?\\s*(?:start(?:ing)?\\s+at|value|at|=)\\s*(${NUM}))?$`, 'i').exec(s))) {
      const name = m[1]?.toLowerCase();
      if (name && !SLIDER_NAME.test(name)) throw new Error(`${m[1]} isn’t a slider name; use a short lowercase word like k`);
      const [min, max] = [num(m[2]!), num(m[3]!)];
      if (!(max > min)) throw new Error('The end must be bigger than the start, like “slider k from 0 to 5”');
      const step = m[4] ? num(m[4]) : undefined;
      if (step !== undefined && !(step > 0)) throw new Error('The step must be more than 0');
      const value = m[5] ? num(m[5]) : Math.min(max, Math.max(min, 1));
      const def: Def = { kind: 'slider', min, max, value: Math.min(max, Math.max(min, value)) };
      if (step) def.step = step;
      return this.addOne(def, name);
    }
    if (/^slider\b/i.test(s)) throw new Error('Try “slider k from 0 to 5”');
    if ((m = new RegExp(`^(?:set\\s+(?:slider\\s+)?([A-Za-z][A-Za-z0-9_]*)\\s+(?:to\\s+|=\\s*)|([A-Za-z][A-Za-z0-9_]*)\\s*=\\s*)(${NUM})$`, 'i').exec(s))) {
      const id = this.ref(m[1] ?? m[2]!);
      if (id && this.c.get(id)?.def.kind === 'slider') {
        this.c.setSlider(id, num(m[3]!), true);
        const v = this.c.value(id);
        return { ok: true, message: describe(this.c.get(id)!, v, this.c), select: id };
      }
      if (m[1]) throw new Error(id ? `${id} isn’t a slider` : `There is no slider ${m[1]}`);
    }

    // Trace (locus)
    if ((m = new RegExp(`^(?:trace|track|follow)\\s+(?:point\\s+)?(${NAME})(?:\\s+(on|off))?$`, 'i').exec(s)) || (m = new RegExp(`^(?:stop\\s+trac(?:e|ing)|untrace|don'?t\\s+trace)\\s+(?:point\\s+)?(${NAME})()$`, 'i').exec(s))) {
      const id = this.ref(m[1]!);
      if (!id) throw new Error(`There is no point ${m[1]}`);
      if (this.c.shape(id) !== 'point') throw new Error(`Only points leave a trace; ${id} isn’t a point`);
      const on = m[2] === undefined ? true : m[2].toLowerCase() === 'on';
      this.c.setTrace(id, on);
      return { ok: true, message: on ? `Tracing ${id}: move what it depends on to draw its path` : `Stopped tracing ${id}`, select: id };
    }
    if (/^(?:clear|erase|remove|delete|reset)\s+(?:the\s+|all\s+)?(?:traces?|trails?|locus|loci|paths?)$/i.test(s)) return { ok: true, message: 'Trace cleared', effect: 'clearTrace' };

    // Labels
    if ((m = /^(?:(show|hide|turn\s+on|turn\s+off)\s+)?(?:the\s+|all\s+)?(?:measurement\s+|measure\s+)?(?:labels|measurements)(?:\s+(on|off))?$/i.exec(s))) {
      const off = /hide|off/i.test(`${m[1] ?? ''} ${m[2] ?? ''}`);
      return { ok: true, message: off ? 'Measurement labels hidden' : 'Measurement labels shown', effect: off ? 'labelsOff' : 'labelsOn' };
    }

    // Perpendicular and parallel
    if ((m = /^(perpendicular|parallel)(?:\s+line)?\s+(?:to|on)\s+(.+?)\s+(?:through|at|from|via)\s+(?:point\s+)?(\S+)$/i.exec(s)) || (m = /^(perpendicular|parallel)(?:\s+line)?\s+(?:from|through|at)\s+(?:point\s+)?(\S+)\s+(?:to|on)\s+(.+)$/i.exec(s))) {
      const kind = m[1]!.toLowerCase() as 'perpendicular' | 'parallel';
      const swapped = /^(?:perpendicular|parallel)(?:\s+line)?\s+(?:from|through|at)\s/i.test(s);
      const [lineTok, ptTok] = swapped ? [m[3]!, m[2]!] : [m[2]!, m[3]!];
      const through = up(ptTok);
      this.needPoints([through]);
      const extra: (Omit<GObj, 'id'> & { id?: Id })[] = [];
      const line = this.lineRef(lineTok, extra);
      return this.addWith(extra, { kind, line, through });
    }

    // Intersections
    if ((m = /^(?:intersect(?:ion)?|intersection points?|where)\s+(?:of\s+|between\s+)?(.+?)\s+(?:and|with|meets)\s+(.+?)(?:\s+meet)?$/i.exec(s))) {
      const extra: (Omit<GObj, 'id'> & { id?: Id })[] = [];
      const a = this.curveRef(m[1]!, extra);
      const b = this.curveRef(m[2]!, extra);
      if (a === b) throw new Error('Pick two different objects');
      // Work out how many points there are right now, with any helper lines included.
      const probe = new Construction([...this.c.objects, ...extra.map((e) => e as GObj)]);
      const va = probe.value(a);
      const vb = probe.value(b);
      const pts = va && vb && (va.type === 'line' || va.type === 'circle') && (vb.type === 'line' || vb.type === 'circle') ? intersect(va, vb) : [];
      if (!pts.length) throw new Error(`${label(m[1]!)} and ${label(m[2]!)} don’t meet`);
      const added = this.c.add(...extra, ...pts.map((_, i) => ({ def: { kind: 'intersection', a, b, which: i as 0 | 1 } as Def })));
      const ptsAdded = added.filter((o) => o.def.kind === 'intersection');
      return { ok: true, message: ptsAdded.map((o) => describe(o, this.c.value(o.id), this.c)).join('; '), select: ptsAdded[0]!.id };
    }

    // Measurements
    if ((m = /^(?:measure\s+)?(?:the\s+)?angle\s+(.+)$/i.exec(s))) {
      const pts = pointNames(m[1]!);
      if (pts?.length !== 3) throw new Error('Name an angle by three points, like “angle ABC”');
      this.needPoints(pts);
      return this.addOne({ kind: 'angle', a: pts[0]!, b: pts[1]!, c: pts[2]! });
    }
    if ((m = /^(?:measure|length(?:\s+of)?|distance(?:\s+(?:from|between))?|how long is)\s+(.+)$/i.exec(s))) {
      const pts = this.pairOf(m[1]!);
      return this.addOne({ kind: 'distance', a: pts[0], b: pts[1] });
    }

    // Removing
    if ((m = /^(?:delete|remove|erase)\s+(?:point\s+)?(.+)$/i.exec(s))) {
      const id = this.ref(m[1]!);
      if (!id) throw new Error(`There is no ${m[1]}`);
      const gone = this.c.remove(id);
      return { ok: true, message: gone.length > 1 ? `Deleted ${id} and ${gone.length - 1} object${gone.length > 2 ? 's' : ''} built on it` : `Deleted ${id}` };
    }

    return { ok: false, message: `I don’t know how to “${s}”. Try “point A at (1, 2)”, “circle centered A through B”, “rotate A about B by 90” or “slider k from 0 to 5”` };
  }

  private twoPoints(kind: 'segment' | 'line', rest: string): CommandResult {
    const pts = this.pairOf(rest);
    return this.addOne({ kind, a: pts[0], b: pts[1] });
  }

  /** Two points from "AB", "A and B", "A to B", or the ends of segment s1. */
  private pairOf(rest: string): [Id, Id] {
    const id = this.ref(rest);
    const d = id ? this.c.get(id)?.def : undefined;
    if (d && (d.kind === 'segment' || d.kind === 'line')) return [d.a, d.b];
    const pts = pointNames(rest);
    if (pts?.length !== 2) throw new Error(`Name two points, like “AB”`);
    this.needPoints(pts);
    return [pts[0]!, pts[1]!];
  }

  private curveRef(tok: string, extra: (Omit<GObj, 'id'> & { id?: Id })[]): Id {
    const id = this.ref(tok);
    if (id) {
      const sh = this.c.shape(id);
      if (sh !== 'line' && sh !== 'segment' && sh !== 'circle') throw new Error(`${id} isn’t a line or circle`);
      return id;
    }
    return this.lineRef(tok, extra);
  }
}

const up = (n: string) => n[0]!.toUpperCase() + n.slice(1);
const label = (s: string) => s.trim();

export { formatNumber };
