// Whiteboard object model: plain, serialisable, immutable-by-convention records in world coordinates.
// Every edit replaces an object with a new one (spread), so undo steps can hold shallow copies cheaply and
// caches keyed by object or point-array identity stay valid.

export type ObjId = string;
export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'arrow' | 'triangle' | 'numberline' | 'axes';
export type MarkStyle = 'circle' | 'box' | 'underline' | 'highlight' | 'check' | 'strike';

interface Base {
  id: ObjId;
  /** Paint order; higher draws on top. */
  z: number;
  /** Colour token (ink, accent, warn, blue, plum, ochre) or any CSS colour. */
  color: string;
  /** Group this object belongs to, if any. */
  parent?: ObjId;
}

export interface StrokeObj extends Base {
  kind: 'stroke';
  /** Origin; `pts` are relative to it so moving never touches the points. */
  x: number;
  y: number;
  /** Flat [x, y, pressure, …] relative to (x, y). Pressure 0..1, or -1 when the device has none. */
  pts: number[];
  size: number;
  highlighter?: boolean;
}

export interface TextObj extends Base {
  kind: 'text';
  x: number;
  y: number;
  text: string;
  size: number;
}

export interface MathObj extends Base {
  kind: 'math';
  x: number;
  y: number;
  tex: string;
  size: number;
}

export interface GraphObj extends Base {
  kind: 'graph';
  x: number;
  y: number;
  w: number;
  h: number;
  exprs: string[];
  xRange: [number, number];
  yRange: [number, number];
}

export interface ShapeObj extends Base {
  kind: 'shape';
  shape: ShapeKind;
  x: number;
  y: number;
  /** For line/arrow: signed delta to the end point. Otherwise the (positive) box size. */
  w: number;
  h: number;
  size: number;
  from?: number;
  until?: number;
  label?: string;
  /** Triangle only: right-angled at the bottom-left corner, with the right-angle marker drawn. */
  right?: boolean;
}

export interface MarkObj extends Base {
  kind: 'mark';
  target: ObjId;
  style: MarkStyle;
  seed: number;
}

export interface GroupObj extends Base {
  kind: 'group';
  children: ObjId[];
}

export type Obj = StrokeObj | TextObj | MathObj | GraphObj | ShapeObj | MarkObj | GroupObj;

// ---------- colours ----------

export interface Theme {
  bg: string;
  surface: string;
  surface2: string;
  ink: string;
  muted: string;
  faint: string;
  line: string;
  accent: string;
  accentInk: string;
  warn: string;
  sans: string;
  mono: string;
  dark: boolean;
}

/** Muted extra hues that read on both light and dark backgrounds (light value, dark value). */
const HUES: Record<string, [string, string]> = {
  blue: ['#3d68a8', '#8fb2e6'],
  plum: ['#8a4f86', '#d6a3d2'],
  ochre: ['#8c6d12', '#dcc06a'],
};

export const COLOR_TOKENS = ['ink', 'accent', 'warn', 'blue', 'plum', 'ochre'] as const;

export function resolveColor(c: string | undefined, t: Theme): string {
  switch (c ?? 'ink') {
    case 'ink':
      return t.ink;
    case 'accent':
      return t.accent;
    case 'warn':
      return t.warn;
    case 'muted':
      return t.muted;
    default: {
      const hue = HUES[c!];
      if (hue) return t.dark ? hue[1] : hue[0];
      return c!;
    }
  }
}

function luminance(color: string): number {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  let r = 255,
    g = 255,
    b = 255;
  if (m) {
    let hex = m[1]!;
    if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
    const n = parseInt(hex, 16);
    r = (n >> 16) & 255;
    g = (n >> 8) & 255;
    b = n & 255;
  } else {
    const rgb = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(color);
    if (rgb) [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function readTheme(el: Element): Theme {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const bg = v('--bg', '#f4f3ee');
  return {
    bg,
    surface: v('--surface', '#ffffff'),
    surface2: v('--surface-2', '#ebeae4'),
    ink: v('--ink', '#141416'),
    muted: v('--muted', '#6c6c72'),
    faint: v('--faint', '#a4a4a8'),
    line: v('--line', '#dcdbd4'),
    accent: v('--accent', '#4d6b00'),
    accentInk: v('--accent-ink', '#ffffff'),
    warn: v('--warn', '#a14a00'),
    sans: v('--sans', 'system-ui, sans-serif'),
    mono: v('--mono', 'ui-monospace, monospace'),
    dark: luminance(bg) < 0.45,
  };
}

// ---------- geometry ----------

export const rectsIntersect = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
export const inflate = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });
export function union(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
export const normRect = (x: number, y: number, w: number, h: number): Rect => ({ x: Math.min(x, x + w), y: Math.min(y, y + h), w: Math.abs(w), h: Math.abs(h) });

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Local bounding box of a stroke's points (cached per point array). */
const strokeBoxCache = new WeakMap<number[], Rect>();
export function strokeLocalBox(pts: number[]): Rect {
  let r = strokeBoxCache.get(pts);
  if (r) return r;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i]!;
    const y = pts[i + 1]!;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (!Number.isFinite(x0)) x0 = y0 = x1 = y1 = 0;
  r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  strokeBoxCache.set(pts, r);
  return r;
}

export function strokeHit(o: StrokeObj, px: number, py: number, radius: number): boolean {
  const lx = px - o.x;
  const ly = py - o.y;
  const r = radius + o.size / 2;
  const p = o.pts;
  if (p.length < 6) return p.length >= 2 && Math.hypot(lx - p[0]!, ly - p[1]!) <= r;
  for (let i = 3; i < p.length; i += 3) {
    if (distToSegment(lx, ly, p[i - 3]!, p[i - 2]!, p[i]!, p[i + 1]!) <= r) return true;
  }
  return false;
}

/** Light smoothing for a finished freehand stroke: drop near-duplicates, one 1-2-1 pass, keep the ends. */
export function smoothPoints(raw: number[], minDist: number): number[] {
  const kept: number[] = [];
  for (let i = 0; i < raw.length; i += 3) {
    const n = kept.length;
    if (n >= 3 && Math.hypot(raw[i]! - kept[n - 3]!, raw[i + 1]! - kept[n - 2]!) < minDist && i < raw.length - 3) continue;
    kept.push(raw[i]!, raw[i + 1]!, raw[i + 2]!);
  }
  if (kept.length < 9) return kept.map(round1);
  const out = kept.slice();
  for (let i = 3; i < kept.length - 3; i += 3) {
    out[i] = (kept[i - 3]! + 2 * kept[i]! + kept[i + 3]!) / 4;
    out[i + 1] = (kept[i - 2]! + 2 * kept[i + 1]! + kept[i + 4]!) / 4;
  }
  return out.map(round1);
}
const round1 = (n: number) => Math.round(n * 100) / 100;

/** Cached Path2D for a stroke, in its local coordinates. Constant width: a centre line; with pressure: an outline. */
const pathCache = new WeakMap<number[], { path: Path2D; filled: boolean; len: number; size: number }>();
export function strokePath(o: StrokeObj): { path: Path2D; filled: boolean; len: number } {
  const hit = pathCache.get(o.pts);
  if (hit && hit.size === o.size) return hit;
  const p = o.pts;
  const n = p.length / 3;
  let len = 0;
  for (let i = 3; i < p.length; i += 3) len += Math.hypot(p[i]! - p[i - 3]!, p[i + 1]! - p[i - 2]!);
  let hasPressure = !o.highlighter && n > 2;
  if (hasPressure) {
    let lo = Infinity,
      hi = -Infinity;
    for (let i = 2; i < p.length; i += 3) {
      lo = Math.min(lo, p[i]!);
      hi = Math.max(hi, p[i]!);
    }
    hasPressure = lo >= 0 && hi - lo > 0.02;
  }
  const path = new Path2D();
  if (!hasPressure) {
    path.moveTo(p[0] ?? 0, p[1] ?? 0);
    if (n === 1) path.lineTo((p[0] ?? 0) + 0.01, p[1] ?? 0);
    else if (n === 2) path.lineTo(p[3]!, p[4]!);
    else {
      for (let i = 3; i < p.length - 3; i += 3) path.quadraticCurveTo(p[i]!, p[i + 1]!, (p[i]! + p[i + 3]!) / 2, (p[i + 1]! + p[i + 4]!) / 2);
      path.lineTo(p[p.length - 3]!, p[p.length - 2]!);
    }
    const r = { path, filled: false, len, size: o.size };
    pathCache.set(p, r);
    return r;
  }
  // Variable width outline.
  const L: number[] = [];
  const R: number[] = [];
  const width = (pr: number) => o.size * (0.3 + 0.95 * pr);
  for (let k = 0; k < n; k++) {
    const i = k * 3;
    const a = Math.max(0, k - 1) * 3;
    const b = Math.min(n - 1, k + 1) * 3;
    let dx = p[b]! - p[a]!;
    let dy = p[b + 1]! - p[a + 1]!;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d;
    dy /= d;
    const hw = width(p[i + 2]!) / 2;
    L.push(p[i]! - dy * hw, p[i + 1]! + dx * hw);
    R.push(p[i]! + dy * hw, p[i + 1]! - dx * hw);
  }
  const curve = (pts: number[], first: boolean) => {
    if (first) path.moveTo(pts[0]!, pts[1]!);
    else path.lineTo(pts[0]!, pts[1]!);
    for (let i = 2; i < pts.length - 2; i += 2) path.quadraticCurveTo(pts[i]!, pts[i + 1]!, (pts[i]! + pts[i + 2]!) / 2, (pts[i + 1]! + pts[i + 3]!) / 2);
    path.lineTo(pts[pts.length - 2]!, pts[pts.length - 1]!);
  };
  curve(L, true);
  const endR = width(p[p.length - 1]!) / 2;
  const ex = p[p.length - 3]!;
  const ey = p[p.length - 2]!;
  const ea = Math.atan2(L[L.length - 1]! - ey, L[L.length - 2]! - ex);
  path.arc(ex, ey, endR, ea, ea + Math.PI, true);
  const Rrev: number[] = [];
  for (let i = R.length - 2; i >= 0; i -= 2) Rrev.push(R[i]!, R[i + 1]!);
  curve(Rrev, false);
  const sr = width(p[2]!) / 2;
  const sa = Math.atan2(R[1]! - p[1]!, R[0]! - p[0]!);
  path.arc(p[0]!, p[1]!, sr, sa, sa + Math.PI, true);
  path.closePath();
  const r = { path, filled: true, len, size: o.size };
  pathCache.set(p, r);
  return r;
}

/** Deterministic PRNG for the hand-drawn wobble of marks. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID().slice(0, 13);
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Simplified centre line for drawing a stroke small on screen: points closer than ~1 device pixel are
 * dropped. Cached per point array and power-of-two scale. Returns the average width for pressure strokes.
 */
const lodCache = new WeakMap<number[], Map<number, Path2D>>();
export function strokePathLod(o: StrokeObj, px: number): { path: Path2D; width: number } {
  const k = Math.floor(Math.log2(px));
  let m = lodCache.get(o.pts);
  if (!m) lodCache.set(o.pts, (m = new Map()));
  let path = m.get(k);
  const p = o.pts;
  if (!path) {
    path = new Path2D();
    const tol = 1.2 / 2 ** k;
    let lx = p[0] ?? 0;
    let ly = p[1] ?? 0;
    path.moveTo(lx, ly);
    let n = 0;
    for (let i = 3; i < p.length; i += 3) {
      const x = p[i]!;
      const y = p[i + 1]!;
      if (i < p.length - 3 && Math.abs(x - lx) + Math.abs(y - ly) < tol) continue;
      path.lineTo(x, y);
      lx = x;
      ly = y;
      n++;
    }
    if (!n) path.lineTo(lx + 0.01, ly);
    m.set(k, path);
  }
  let width = o.size;
  if (!o.highlighter && p.length > 3 && (p[2] ?? -1) >= 0) {
    let sum = 0;
    for (let i = 2; i < p.length; i += 3) sum += p[i]!;
    width = o.size * (0.3 + (0.95 * sum) / (p.length / 3));
  }
  return { path, width };
}
