import { evaluateDef, inputs, isTransform, shapeOf, type Def, type GObj, type Id, type Kind, type NumRef, type Shape, type Value, type Values } from './model';

/** Prefixes for generated names. Points take capital letters (A, B, …, Z, A1, …). */
const PREFIX: Record<Exclude<Shape, 'point'>, string> = {
  segment: 's',
  line: 'l',
  circle: 'c',
  polygon: 'poly',
  angle: 'ang',
  distance: 'd',
  number: 'k',
};
export const POINT_NAME = /^[A-Z](?:[0-9]+|')?$/;
/** Slider names: a lowercase word ("k", "t", "angle"). */
export const SLIDER_NAME = /^[a-z][a-z0-9_]{0,11}$/;

export interface Snapshot {
  version: 1;
  objects: GObj[];
}

/**
 * The figure, with undo/redo. Objects stay in construction order; removing one removes everything built on it.
 * A drag is one undo step: call `beginChange()` once, then `move()` as often as needed.
 */
export class Construction {
  private objs: GObj[] = [];
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private cache: Values | null = null;
  /** Called after every change (for autosave and redraw). */
  onChange: (() => void) | null = null;

  constructor(objects: GObj[] = []) {
    this.objs = objects.map(clone);
  }

  get objects(): readonly GObj[] {
    return this.objs;
  }

  get(id: Id): GObj | undefined {
    return this.objs.find((o) => o.id === id);
  }

  has(id: Id): boolean {
    return this.objs.some((o) => o.id === id);
  }

  /** Every object's current value, worked out in construction order. */
  values(): Values {
    if (this.cache) return this.cache;
    const vals: Values = new Map();
    for (const o of this.objs) vals.set(o.id, evaluateDef(o.def, vals));
    return (this.cache = vals);
  }

  value(id: Id): Value | undefined {
    return this.values().get(id);
  }

  /** Records the current state as one undo step. */
  beginChange(): void {
    this.undoStack.push(JSON.stringify(this.objs));
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }

  private changed(): void {
    this.cache = null;
    this.onChange?.();
  }

  /** Adds objects as one undo step. Throws when a name is taken or an input doesn't exist. */
  add(...objs: (Omit<GObj, 'id'> & { id?: Id })[]): GObj[] {
    const taken = new Set(this.objs.map((o) => o.id));
    const out: GObj[] = [];
    for (const o of objs) {
      const id = o.id ?? this.nameFor(o.def, taken, out);
      if (taken.has(id)) throw new Error(`${id} already exists`);
      for (const i of inputs(o.def)) if (!taken.has(i)) throw new Error(`There is no ${i}`);
      taken.add(id);
      out.push({ ...clone(o as GObj), id });
    }
    this.beginChange();
    this.objs.push(...out);
    this.changed();
    return out;
  }

  /** Moves a free point. Pass `record` to make it its own undo step (keyboard nudges, typed moves). */
  move(id: Id, x: number, y: number, record = false): boolean {
    const o = this.get(id);
    if (o?.def.kind !== 'point' || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (record) this.beginChange();
    o.def.x = x;
    o.def.y = y;
    this.changed();
    return true;
  }

  /** Sets a slider (clamped to its range). Pass `record` to make it its own undo step. */
  setSlider(id: Id, value: number, record = false): boolean {
    const o = this.get(id);
    if (o?.def.kind !== 'slider' || !Number.isFinite(value)) return false;
    if (record) this.beginChange();
    o.def.value = Math.min(o.def.max, Math.max(o.def.min, value));
    this.changed();
    return true;
  }

  /** Turns a point's trail on or off (one undo step). */
  setTrace(id: Id, on: boolean): boolean {
    const o = this.get(id);
    if (!o || shapeOf(o.def, (i) => this.get(i)?.def) !== 'point') return false;
    if (!!o.trace === on) return true;
    this.beginChange();
    if (on) o.trace = true;
    else delete o.trace;
    this.changed();
    return true;
  }

  /** What sort of thing an object is (point, line, circle…). */
  shape(id: Id): Shape | undefined {
    const o = this.get(id);
    return o ? shapeOf(o.def, (i) => this.get(i)?.def) : undefined;
  }

  /** Everything built (directly or not) on `id`. */
  dependents(id: Id): Set<Id> {
    const out = new Set<Id>();
    const hit = new Set([id]);
    for (const o of this.objs) {
      if (inputs(o.def).some((i) => hit.has(i))) {
        hit.add(o.id);
        out.add(o.id);
      }
    }
    return out;
  }

  /** Removes an object and everything built on it. Returns the removed ids. */
  remove(id: Id): Id[] {
    if (!this.has(id)) return [];
    const gone = this.dependents(id).add(id);
    this.beginChange();
    this.objs = this.objs.filter((o) => !gone.has(o.id));
    this.changed();
    return [...gone];
  }

  clear(): void {
    if (!this.objs.length) return;
    this.beginChange();
    this.objs = [];
    this.changed();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (prev === undefined) return false;
    this.redoStack.push(JSON.stringify(this.objs));
    this.objs = JSON.parse(prev) as GObj[];
    this.changed();
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (next === undefined) return false;
    this.undoStack.push(JSON.stringify(this.objs));
    this.objs = JSON.parse(next) as GObj[];
    this.changed();
    return true;
  }

  /** The next free name for an object of this kind (transformations: use `nameFor`). */
  nextName(kind: Kind, taken: Set<Id> = new Set(this.objs.map((o) => o.id))): Id {
    const shape = shapeOf({ kind } as Def, () => undefined) ?? 'line';
    return nextFree(shape, taken);
  }

  /** A name for a new object: A, B… for points (A′ for the image of A), s1, l1, c1… for the rest. */
  nameFor(def: Def, taken: Set<Id> = new Set(this.objs.map((o) => o.id)), pending: GObj[] = []): Id {
    const get = (i: Id) => this.get(i)?.def ?? pending.find((p) => p.id === i)?.def;
    const shape = shapeOf(def, get) ?? 'line';
    if (shape === 'point' && isTransform(def) && /^[A-Z]$/.test(def.src) && !taken.has(`${def.src}'`)) return `${def.src}'`;
    return nextFree(shape, taken);
  }

  toJSON(): Snapshot {
    return { version: 1, objects: this.objs.map(clone) };
  }

  /** Rebuilds a figure from saved JSON; anything malformed is dropped rather than trusted. */
  static fromJSON(data: unknown): Construction {
    const raw = (data as { objects?: unknown })?.objects;
    const out: GObj[] = [];
    const seen = new Set<Id>();
    if (Array.isArray(raw))
      for (const o of raw) {
        if (!o || typeof o !== 'object') continue;
        const { id, def, hidden, trace } = o as Partial<GObj>;
        if (typeof id !== 'string' || !id || id.length > 12 || seen.has(id) || !validDef(def)) continue;
        if (!inputs(def).every((i) => seen.has(i))) continue;
        seen.add(id);
        const g: GObj = { id, def };
        if (hidden) g.hidden = true;
        if (trace) g.trace = true;
        out.push(g);
      }
    return new Construction(out);
  }
}

function nextFree(shape: Shape, taken: Set<Id>): Id {
  if (shape === 'point') {
    for (let n = 0; ; n++)
      for (let c = 0; c < 26; c++) {
        const id = String.fromCharCode(65 + c) + (n ? String(n) : '');
        if (!taken.has(id)) return id;
      }
  }
  const p = PREFIX[shape];
  for (let n = 1; ; n++) if (!taken.has(`${p}${n}`)) return `${p}${n}`;
}

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNumRef = (v: unknown): v is NumRef => isNum(v) || isId(v);

function validDef(d: unknown): d is Def {
  if (!d || typeof d !== 'object') return false;
  const x = d as Record<string, unknown>;
  switch (x.kind) {
    case 'point':
      return isNum(x.x) && isNum(x.y);
    case 'midpoint':
    case 'segment':
    case 'line':
    case 'distance':
      return isId(x.a) && isId(x.b);
    case 'intersection':
      return isId(x.a) && isId(x.b) && (x.which === 0 || x.which === 1);
    case 'circle':
      return isId(x.center) && isId(x.through);
    case 'circleRadius':
      return isId(x.center) && ((isNum(x.r) && x.r > 0) || isId(x.r));
    case 'compass':
      return isId(x.center) && isId(x.a) && isId(x.b);
    case 'polygon':
      return Array.isArray(x.pts) && x.pts.length >= 3 && x.pts.every(isId);
    case 'regularPolygon':
      return isId(x.a) && isId(x.b) && isNumRef(x.n);
    case 'perpendicular':
    case 'parallel':
      return isId(x.line) && isId(x.through);
    case 'perpBisector':
      return isId(x.a) && isId(x.b);
    case 'angle':
    case 'angleBisector':
      return isId(x.a) && isId(x.b) && isId(x.c);
    case 'tangent':
      return isId(x.point) && isId(x.circle) && (x.which === 0 || x.which === 1);
    case 'slider':
      return isNum(x.min) && isNum(x.max) && isNum(x.value) && x.max > x.min && (x.step === undefined || (isNum(x.step) && x.step > 0));
    case 'reflect':
      return isId(x.src) && isId(x.line);
    case 'rotate':
      return isId(x.src) && isId(x.center) && isNumRef(x.angle) && (x.cw === undefined || typeof x.cw === 'boolean');
    case 'translate':
      return isId(x.src) && isId(x.a) && isId(x.b);
    case 'dilate':
      return isId(x.src) && isId(x.center) && isNumRef(x.factor);
    default:
      return false;
  }
}

const fmt = (n: number, dp = 2) => {
  const r = Number(n.toFixed(dp));
  return Object.is(r, -0) ? '0' : String(r);
};
export const formatNumber = fmt;

/** One line describing an object, for the object list and screen readers ("Point A at (1, 2)"). Pass the
 * construction to name hidden helper lines by their points ("AB" rather than "h1"). */
export function describe(o: GObj, v: Value | undefined, c?: { get(id: Id): GObj | undefined }): string {
  const d = o.def;
  const ln = (id: Id) => {
    const h = c?.get(id);
    return h?.hidden && h.def.kind === 'line' ? h.def.a + h.def.b : id;
  };
  const nr = (n: NumRef) => (typeof n === 'number' ? fmt(n) : n);
  const what = (() => {
    switch (d.kind) {
      case 'point':
        return `Point ${o.id}`;
      case 'midpoint':
        return `Midpoint ${o.id} of ${d.a}${d.b}`;
      case 'intersection':
        return `Intersection ${o.id} of ${ln(d.a)} and ${ln(d.b)}`;
      case 'segment':
        return `Segment ${d.a}${d.b}`;
      case 'line':
        return `Line ${d.a}${d.b}`;
      case 'circle':
        return `Circle ${o.id}, centre ${d.center} through ${d.through}`;
      case 'circleRadius':
        return `Circle ${o.id}, centre ${d.center}`;
      case 'polygon':
        return `Polygon ${d.pts.join('')}`;
      case 'perpendicular':
        return `Perpendicular ${o.id} to ${ln(d.line)} through ${d.through}`;
      case 'parallel':
        return `Parallel ${o.id} to ${ln(d.line)} through ${d.through}`;
      case 'compass':
        return `Circle ${o.id}, centre ${d.center}, radius ${d.a}${d.b}`;
      case 'regularPolygon':
        return `Regular polygon ${o.id} on ${d.a}${d.b}, ${typeof d.n === 'number' ? `${fmt(d.n, 0)} sides` : `${d.n} sides`}`;
      case 'perpBisector':
        return `Perpendicular bisector ${o.id} of ${d.a}${d.b}`;
      case 'angleBisector':
        return `Angle bisector ${o.id} of ${d.a}${d.b}${d.c}`;
      case 'tangent':
        return `Tangent ${o.id} from ${d.point} to ${d.circle}`;
      case 'slider':
        return `Slider ${o.id} (${fmt(d.min)} to ${fmt(d.max)})`;
      case 'reflect':
        return `Reflection ${o.id} of ${d.src} over ${ln(d.line)}`;
      case 'rotate':
        return `Rotation ${o.id} of ${d.src} about ${d.center} by ${nr(d.angle)}°${d.cw ? ' clockwise' : ''}`;
      case 'translate':
        return `Translation ${o.id} of ${d.src} by ${d.a}${d.b}`;
      case 'dilate':
        return `Dilation ${o.id} of ${d.src} from ${d.center} by ${nr(d.factor)}`;
      case 'angle':
        return `Angle ${d.a}${d.b}${d.c}`;
      case 'distance':
        return `Length ${d.a}${d.b}`;
    }
  })();
  if (!v) return d.kind === 'tangent' ? `${what} (none right now)` : `${what} (undefined)`;
  switch (v.type) {
    case 'point':
      return `${what} at (${fmt(v.p.x)}, ${fmt(v.p.y)})`;
    case 'line':
      return v.seg ? `${what}, length ${fmt(Math.hypot(v.seg[1].x - v.seg[0].x, v.seg[1].y - v.seg[0].y))}` : what;
    case 'circle':
      return `${what}, radius ${fmt(v.r)}`;
    case 'polygon':
      return `${what}, area ${fmt(v.area)}, perimeter ${fmt(v.perimeter)}`;
    case 'angle':
      return `${what} = ${fmt(v.deg, 1)}°`;
    case 'distance':
      return `${what} = ${fmt(v.length)}`;
    case 'number':
      return `${what} = ${fmt(v.value, 3)}`;
  }
}
