import {
  analyze,
  analyzeCurves,
  autoWindow,
  marchImplicit,
  niceStep,
  sampleExplicit,
  sampleParametric,
  samplePolar,
  sampleXofY,
  toSegments,
  type Curve,
  type GraphItem,
  type GraphSpec,
  type Poi,
  type Polyline,
  type Viewport,
} from '@lemma/graph-engine';
import type { FloatEnv, FloatFn } from '@lemma/math-core';
import { moves } from '../motion';
import { SvgCtx } from './svg';

/**
 * Interactive 2D graph: pan (drag / arrows), zoom (wheel / pinch / + −), points of interest you can hover, tap and
 * pin, tracing along any curve (explicit, x = f(y), implicit, polar, parametric) by pointer, touch-and-hold or keyboard,
 * draggable points, sliders with animation, per-item styles, grid/axis/log/polar settings, PNG and SVG export.
 * Everything is drawn on one canvas per frame; points of interest are recomputed only once the view settles, so
 * panning stays smooth with many rows. Statistical marks (points, bars, box plots, shaded areas) draw here too;
 * a surface (z = f(x, y)) hands the stage to the 3D view, loaded on first use.
 */

const POI_LABEL: Record<Poi['kind'], string> = { root: 'Root', min: 'Minimum', max: 'Maximum', 'y-intercept': 'y-intercept', intersection: 'Intersection' };

export interface ItemStyle {
  color?: string;
  line?: 'solid' | 'dashed' | 'dotted';
  width?: number;
  opacity?: number;
  point?: 'dot' | 'open' | 'cross';
  label?: string;
  showLabel?: boolean;
}

export interface ViewSettings {
  grid: boolean;
  minor: boolean;
  numbers: boolean;
  xLabel: string;
  yLabel: string;
  polar: boolean;
  degrees: boolean;
  logX: boolean;
  logY: boolean;
  square: boolean;
  bg: string;
  audio: boolean;
  contrast: boolean;
}

export const DEFAULT_SETTINGS: ViewSettings = { grid: true, minor: true, numbers: true, xLabel: '', yLabel: '', polar: false, degrees: false, logX: false, logY: false, square: false, bg: '', audio: false, contrast: false };

interface Pin {
  kind: Poi['kind'] | 'trace';
  items: number[];
  x: number;
  y: number;
}

/** A point on a curve, in view coordinates (u, v: logarithms on log axes). */
interface Hit {
  item: GraphItem;
  u: number;
  v: number;
  d: number;
  line?: Float64Array;
  i?: number;
}

const TRACEABLE = new Set<GraphItem['kind']>(['explicit', 'xOfY', 'implicit', 'parametric', 'polar']);

let summaries = 0;

function fmt(v: number): string {
  if (v === 0 || !Number.isFinite(v)) return String(v === 0 ? 0 : v);
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-4) return v.toExponential(3).replace(/\.?0+e/, 'e');
  return String(Number(v.toPrecision(6)));
}

const sameItems = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export class GraphView {
  readonly root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tip: HTMLElement;
  private live: HTMLElement;
  private legend: HTMLElement;
  private sliderBox: HTMLElement;
  private stage: HTMLElement;
  private summary: HTMLElement;
  readonly tools: HTMLElement;
  private surface: import('./surface').SurfaceView | null = null;
  private spec!: GraphSpec;
  private env: Record<string, number> = {};
  private hidden = new Set<number>();
  private vp: Viewport = { xMin: -10, xMax: 10, yMin: -7, yMax: 7 };
  private home: Viewport = this.vp;
  private w = 0;
  private h = 0;
  private pois: Poi[] = [];
  private poisDirty = true;
  private poiTimer = 0;
  private hover: { x: number; y: number; touch: boolean } | null = null;
  private pins: Pin[] = [];
  /** The traced point (pointer held on a curve, touch-and-hold, or the keyboard). */
  private trace: (Hit & { key?: number; dir?: [number, number] }) | null = null;
  /** A point picked by a click or tap on a curve; stays until a click elsewhere. */
  private sel: Hit | null = null;
  private frame = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private press: { id: number; x: number; y: number; t: number; mode: 'pending' | 'pan' | 'trace' | 'drag'; touch: boolean; drag?: GraphItem; hold?: number } | null = null;
  private playing = new Map<string, number>();
  private userMoved = false;
  /** Geometry drawn last frame, per traceable item: segments in view coordinates, and ordered polylines. */
  private geo = new Map<GraphItem, { segs: Float64Array; lines?: Polyline[] }>();
  /** The first drawing reveals the curves left to right: -1 until it starts, then its start time; 0 once done (or off). */
  private revealAt = moves('content') ? -1 : 0;
  /** Items drawn faded (the graphing workspace's rows that are being edited and don't parse yet). */
  readonly dimmed = new Set<number>();
  /** Which palette colour an item id gets (the graphing workspace gives each row its own). */
  colorOf: (id: number) => number = (id) => id;
  /** Per-item style (colour, line, width, opacity, point style, label). */
  styleOf: (id: number) => ItemStyle | undefined = () => undefined;
  /** Never refit the view when the plotted items change (a workspace whose rows change on every keystroke). */
  lockView = false;
  /** Fit the window to the interesting features (roots, extrema, intersections, points) until the user moves it. */
  autoFit = false;
  settings: ViewSettings = { ...DEFAULT_SETTINGS };
  /** A draggable point moved: x, y in graph coordinates. */
  onPointDrag: ((item: Extract<GraphItem, { kind: 'point' }>, x: number, y: number, done: boolean) => void) | null = null;
  /** The visible window changed (pan, zoom, fit). */
  onView: ((vp: Viewport) => void) | null = null;
  /** Points of interest were recomputed (the workspace describes each row's features from them). */
  onPois: ((pois: Poi[]) => void) | null = null;
  private alpha = 1;
  private viewTimer = 0;

  constructor(spec: GraphSpec) {
    this.root = document.createElement('div');
    this.root.className = 'graph';
    const stage = (this.stage = document.createElement('div'));
    stage.className = 'graph-stage';
    this.canvas = document.createElement('canvas');
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'img');
    this.ctx = this.canvas.getContext('2d')!;
    this.tip = document.createElement('div');
    this.tip.className = 'graph-tip';
    this.tip.hidden = true;
    this.live = document.createElement('p');
    this.live.className = 'graph-live';
    // Visually hidden, read by screen readers (inline so the plain graph view needs no extra CSS).
    this.live.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';
    this.live.setAttribute('aria-live', 'polite');
    const tools = (this.tools = document.createElement('div'));
    tools.className = 'graph-tools';
    const btn = (label: string, title: string, on: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.addEventListener('click', on);
      tools.append(b);
      return b;
    };
    btn('+', 'Zoom in', () => this.zoomAt(this.w / 2, this.h / 2, 0.6));
    btn('−', 'Zoom out', () => this.zoomAt(this.w / 2, this.h / 2, 1 / 0.6));
    btn('⌂', 'Reset view', () => {
      this.userMoved = false;
      this.fitView();
      this.changed();
    });
    btn('⤓', 'Download PNG', () => this.exportPng());
    stage.append(this.canvas, this.tip, tools);
    this.legend = document.createElement('div');
    this.legend.className = 'graph-legend';
    this.sliderBox = document.createElement('div');
    this.sliderBox.className = 'graph-sliders';
    this.summary = document.createElement('p');
    this.summary.className = 'graph-summary';
    this.summary.id = `graph-summary-${++summaries}`;
    this.canvas.setAttribute('aria-describedby', this.summary.id);
    this.root.append(stage, this.legend, this.sliderBox, this.summary, this.live);
    this.bind();
    this.setSpec(spec);
    // Resize on the next frame: resizing the canvas can toggle the page scrollbar, which would otherwise
    // re-trigger the observer within the same frame ("ResizeObserver loop" errors in WebKit).
    let pending = 0;
    new ResizeObserver(() => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => this.resize());
    }).observe(stage);
  }

  /** Replace what is plotted, keeping the user's view if they've moved it (live typing) unless `refit`. */
  setSpec(spec: GraphSpec, refit = false): void {
    const prevSliders = this.spec?.sliders ?? [];
    this.spec = spec;
    if (refit) this.userMoved = false;
    for (const s of spec.sliders) {
      const prev = prevSliders.find((p) => p.name === s.name);
      this.env[s.name] = prev ? (this.env[s.name] ?? s.value) : s.value;
    }
    this.renderLegend();
    this.renderSliders();
    if (!this.userMoved && !this.lockView) this.fitView();
    this.canvas.setAttribute('aria-label', `Graph of ${spec.items.map((i) => i.label).join('; ') || 'nothing yet'}`);
    this.summary.textContent = spec.summary ?? '';
    // Keep a trace or a picked point on its row when the row is re-parsed.
    const rebind = (h: Hit | null) => {
      if (!h) return null;
      const it = spec.items.find((i) => i.id === h.item.id && i.kind === h.item.kind);
      return it ? { ...h, item: it } : null;
    };
    this.trace = rebind(this.trace);
    this.sel = rebind(this.sel);
    this.poisDirty = true;
    const surface = spec.items.find((i) => i.kind === 'surface');
    this.stage.hidden = !!surface;
    this.legend.hidden = !!surface;
    if (surface) void this.showSurface();
    else if (this.surface) {
      this.surface.destroy();
      this.surface = null;
    }
    this.request();
  }

  /** Loads the 3D view (a separate chunk) on first use and mounts it in place of the 2D stage. */
  private async showSurface(): Promise<void> {
    if (!this.surface) {
      const { SurfaceView } = await import('./surface');
      const it = this.spec.items.find((i) => i.kind === 'surface');
      if (this.surface || !it || it.kind !== 'surface') return; // replaced while loading
      this.surface = new SurfaceView(it, this.env);
      this.stage.after(this.surface.root);
    }
    this.request();
  }

  /** Hides these item ids (the workspace's show/hide dots), shows the rest. */
  setHidden(ids: Iterable<number>): void {
    this.hidden = new Set(ids);
    this.poisDirty = true;
    this.request();
  }

  /** Sets parameter values directly (sliders defined by the workspace's own rows, e.g. "a = 2"). */
  setParams(values: Record<string, number>): void {
    Object.assign(this.env, values);
    this.poisDirty = true;
    this.request();
  }

  /** Current parameter values (the workspace's sliders and the automatic ones). */
  params(): Record<string, number> {
    return { ...this.env };
  }

  setSettings(s: Partial<ViewSettings>): void {
    const logChanged = (s.logX !== undefined && s.logX !== this.settings.logX) || (s.logY !== undefined && s.logY !== this.settings.logY);
    this.settings = { ...this.settings, ...s };
    if (logChanged) {
      this.userMoved = false;
      this.fitView();
    }
    if (s.square) this.zoomSquare();
    this.poisDirty = true;
    this.changed();
  }

  /** Drops the pinned labels that belong to these rows (their text changed). */
  unpin(ids: Iterable<number>): void {
    const set = new Set(ids);
    const before = this.pins.length;
    this.pins = this.pins.filter((p) => !p.items.some((i) => set.has(i)));
    if (this.sel && set.has(this.sel.item.id)) this.sel = null;
    if (this.pins.length !== before) {
      this.updatePinCount();
      this.request();
    }
  }

  /** True once the person has panned or zoomed (the window is theirs, not automatic). */
  get moved(): boolean {
    return this.userMoved;
  }

  getView(): Viewport {
    return { xMin: this.ix(this.vp.xMin), xMax: this.ix(this.vp.xMax), yMin: this.iy(this.vp.yMin), yMax: this.iy(this.vp.yMax) };
  }

  /** Sets the window in graph coordinates (positive bounds on log axes). */
  setView(v: Viewport): void {
    const nv = { xMin: this.tx(v.xMin), xMax: this.tx(v.xMax), yMin: this.ty(v.yMin), yMax: this.ty(v.yMax) };
    if (![nv.xMin, nv.xMax, nv.yMin, nv.yMax].every(Number.isFinite) || !(nv.xMax > nv.xMin) || !(nv.yMax > nv.yMin)) return;
    this.vp = nv;
    this.userMoved = true;
    this.changed();
  }

  /** Equal units on both axes, keeping the centre and the x range. */
  zoomSquare(): void {
    if (!this.w || !this.h) return;
    const cy = (this.vp.yMin + this.vp.yMax) / 2;
    const half = ((this.vp.xMax - this.vp.xMin) * this.h) / this.w / 2;
    this.vp = { ...this.vp, yMin: cy - half, yMax: cy + half };
    this.userMoved = true;
    this.changed();
  }

  /** Refits to the features unless the person has moved the window themselves. */
  fitIfAuto(): void {
    if (this.userMoved || !this.w) return;
    this.fitView();
    this.changed();
  }

  /** Back to the automatic window that frames the interesting features. */
  zoomFit(): void {
    this.userMoved = false;
    this.fitView(true);
    this.changed();
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    for (const id of this.playing.values()) cancelAnimationFrame(id);
    this.surface?.destroy();
    this.root.remove();
  }

  // ---------- coordinates ----------
  /** Graph → view coordinates (log10 on log axes). */
  private tx = (x: number) => (this.settings.logX ? (x > 0 ? Math.log10(x) : NaN) : x);
  private ty = (y: number) => (this.settings.logY ? (y > 0 ? Math.log10(y) : NaN) : y);
  private ix = (u: number) => (this.settings.logX ? 10 ** u : u);
  private iy = (v: number) => (this.settings.logY ? 10 ** v : v);
  private toX = (u: number) => ((u - this.vp.xMin) / (this.vp.xMax - this.vp.xMin)) * this.w;
  private toY = (v: number) => this.h - ((v - this.vp.yMin) / (this.vp.yMax - this.vp.yMin)) * this.h;
  private fromX = (px: number) => this.vp.xMin + (px / this.w) * (this.vp.xMax - this.vp.xMin);
  private fromY = (py: number) => this.vp.yMin + ((this.h - py) / this.h) * (this.vp.yMax - this.vp.yMin);
  private get logged() {
    return this.settings.logX || this.settings.logY;
  }

  // ---------- view ----------
  private fitView(force = false): void {
    const aspect = this.h && this.w ? this.h / this.w : 0.6;
    const { yMin, yMax } = this.spec.view ?? {};
    if (this.spec.view && yMin !== undefined && yMax !== undefined) {
      // Statistical plots know their y range (counts, a density); the aspect ratio is free.
      this.vp = { xMin: this.spec.view.xMin, xMax: this.spec.view.xMax, yMin, yMax };
    } else if (this.logged) {
      this.vp = { xMin: this.settings.logX ? -2 : -10, xMax: this.settings.logX ? 3 : 10, yMin: this.settings.logY ? -2 : -10 * aspect, yMax: this.settings.logY ? 3 : 10 * aspect };
    } else if (this.spec.view) {
      const { xMin, xMax } = this.spec.view;
      const half = ((xMax - xMin) * aspect) / 2;
      const w = autoWindow(this.spec.items.filter((i) => !this.hidden.has(i.id)), this.env, aspect);
      const cy = (w.yMin + w.yMax) / 2;
      this.vp = { xMin, xMax, yMin: cy - Math.max(half, (w.yMax - w.yMin) / 2), yMax: cy + Math.max(half, (w.yMax - w.yMin) / 2) };
    } else {
      const items = this.spec.items.filter((i) => !this.hidden.has(i.id));
      if (!items.length && !force && this.w) {
        // Nothing to frame: keep the current window (typing into an empty row shouldn't jump the view).
        if (this.vp.xMin === -10 && this.vp.xMax === 10) this.vp = { xMin: -10, xMax: 10, yMin: -10 * aspect, yMax: 10 * aspect };
      } else this.vp = autoWindow(items, this.env, aspect);
    }
    this.home = { ...this.vp };
    this.poisDirty = true;
  }

  private resize(): void {
    const rect = this.canvas.parentElement!.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const prevH = this.h;
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if ((!this.userMoved && (!this.lockView || this.autoFit)) || !prevH) this.fitView();
    else {
      // Keep the centre and the vertical scale (units per pixel); only the visible extent changes.
      const cy = (this.vp.yMin + this.vp.yMax) / 2;
      const half = ((this.vp.yMax - this.vp.yMin) / prevH) * this.h * 0.5;
      this.vp = { ...this.vp, yMin: cy - half, yMax: cy + half };
    }
    this.changed();
  }

  /** The window moved: redraw, recompute points of interest once it settles, tell the workspace. */
  private changed(): void {
    // Never keep an unusable window (e.g. a zoom that overflowed): fall back to the default.
    if (![this.vp.xMin, this.vp.xMax, this.vp.yMin, this.vp.yMax].every(Number.isFinite) || !(this.vp.xMax > this.vp.xMin) || !(this.vp.yMax > this.vp.yMin)) {
      this.vp = { xMin: -10, xMax: 10, yMin: -6, yMax: 6 };
    }
    this.poisDirty = true;
    const g = this.getView();
    this.canvas.dataset.view = [g.xMin, g.xMax, g.yMin, g.yMax].map((v) => Number(v.toPrecision(6))).join(',');
    this.request();
    clearTimeout(this.viewTimer);
    this.viewTimer = window.setTimeout(() => this.onView?.(this.getView()), 120);
  }

  private zoomAt(px: number, py: number, factor: number): void {
    const wx = this.fromX(px);
    const wy = this.fromY(py);
    this.vp = {
      xMin: wx - (wx - this.vp.xMin) * factor,
      xMax: wx + (this.vp.xMax - wx) * factor,
      yMin: wy - (wy - this.vp.yMin) * factor,
      yMax: wy + (this.vp.yMax - wy) * factor,
    };
    this.userMoved = true;
    this.revealAt = 0; // panning and zooming are always instant
    this.changed();
  }

  private pan(dxPx: number, dyPx: number): void {
    const sx = (this.vp.xMax - this.vp.xMin) / this.w;
    const sy = (this.vp.yMax - this.vp.yMin) / this.h;
    this.vp = { xMin: this.vp.xMin - dxPx * sx, xMax: this.vp.xMax - dxPx * sx, yMin: this.vp.yMin + dyPx * sy, yMax: this.vp.yMax + dyPx * sy };
    this.userMoved = true;
    this.revealAt = 0; // panning and zooming are always instant
    this.changed();
  }

  // ---------- interaction ----------
  private radius(touch: boolean) {
    return touch ? 30 : 16;
  }

  private bind(): void {
    const c = this.canvas;
    const local = (e: PointerEvent | MouseEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = local(e);
      this.zoomAt(p.x, p.y, Math.exp(e.deltaY * 0.0015));
    }, { passive: false });
    c.addEventListener('contextmenu', (e) => {
      if (this.press?.mode === 'trace' || this.press?.mode === 'pending') e.preventDefault();
    });
    c.addEventListener('pointerdown', (e) => {
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        // A synthetic or already-released pointer.
      }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size > 1) {
        this.endPress();
        return;
      }
      const p = local(e);
      const touch = e.pointerType !== 'mouse';
      const R = this.radius(touch);
      this.press = { id: e.pointerId, x: p.x, y: p.y, t: e.timeStamp, mode: 'pending', touch };
      const drag = this.draggableAt(p.x, p.y, R);
      if (drag) {
        this.press.mode = 'drag';
        this.press.drag = drag;
        return;
      }
      const onPoi = !!this.poiAt(p.x, p.y, R); // a tap/click pins it on release
      if (onPoi && !touch) return;
      if (!touch) {
        // Mouse: pressing on a curve traces it; elsewhere it pans.
        const hit = this.nearest(null, p.x, p.y, 10);
        if (hit) this.beginTrace(hit);
        else this.press.mode = 'pan';
      } else {
        // Touch: hold still to trace; move to pan.
        this.press.hold = window.setTimeout(() => {
          if (!this.press || this.press.mode !== 'pending') return;
          const hit = this.nearest(null, this.press.x, this.press.y, 56);
          if (hit) this.beginTrace(hit);
        }, 320);
      }
    });
    c.addEventListener('pointermove', (e) => {
      const p = local(e);
      const prev = this.pointers.get(e.pointerId);
      if (prev) {
        if (this.pointers.size === 2) {
          const [a, b] = [...this.pointers.values()];
          const before = Math.hypot(a!.x - b!.x, a!.y - b!.y);
          this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const [a2, b2] = [...this.pointers.values()];
          const after = Math.hypot(a2!.x - b2!.x, a2!.y - b2!.y);
          const r = c.getBoundingClientRect();
          if (before > 0 && after > 0) this.zoomAt((a2!.x + b2!.x) / 2 - r.left, (a2!.y + b2!.y) / 2 - r.top, before / after);
          return;
        }
        const press = this.press;
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (!press) return;
        const moved = Math.hypot(p.x - press.x, p.y - press.y);
        if (press.mode === 'pending' && moved > (press.touch ? 9 : 4)) {
          clearTimeout(press.hold);
          press.mode = 'pan';
        }
        if (press.mode === 'pan') this.pan(dx, dy);
        else if (press.mode === 'trace' && this.trace) {
          // Follow the same curve, wherever the pointer goes.
          const hit = this.nearest(this.trace.item, p.x, p.y, Infinity);
          if (hit) this.moveTrace(hit);
        } else if (press.mode === 'drag' && press.drag?.kind === 'point') this.dragPoint(press.drag, p.x, p.y, false);
        this.hover = null;
        return;
      }
      if (e.pointerType === 'mouse') {
        this.hover = { x: p.x, y: p.y, touch: false };
        this.request();
      }
    });
    const finish = (e: PointerEvent, cancelled: boolean) => {
      this.pointers.delete(e.pointerId);
      const press = this.press;
      if (!press || press.id !== e.pointerId) return;
      clearTimeout(press.hold);
      const p = local(e);
      const R = this.radius(press.touch);
      const still = Math.hypot(p.x - press.x, p.y - press.y) < (press.touch ? 9 : 4);
      if (!cancelled && (press.mode === 'pending' || (press.mode === 'pan' && still))) {
        // A click or tap: pin a point of interest, or pick a point on a curve, or clear the pick.
        const poi = this.poiAt(p.x, p.y, R);
        if (poi) this.togglePin(poi);
        else {
          const hit = this.nearest(null, p.x, p.y, R);
          this.sel = hit;
          if (hit) this.announce(this.readout(hit));
        }
      } else if (press.mode === 'trace' && this.trace) {
        // Leave the traced point showing.
        this.sel = { ...this.trace };
        this.trace = null;
      } else if (press.mode === 'drag' && press.drag?.kind === 'point') this.dragPoint(press.drag, p.x, p.y, true);
      this.press = null;
      this.request();
    };
    c.addEventListener('pointerup', (e) => finish(e, false));
    c.addEventListener('pointercancel', (e) => finish(e, true));
    c.addEventListener('pointerleave', () => {
      this.hover = null;
      this.request();
    });
    c.addEventListener('focus', () => {
      // Keyboard focus starts tracing the first curve (arrows then walk along it).
      let kb = false;
      try {
        kb = c.matches(':focus-visible');
      } catch {
        kb = false;
      }
      if (kb && !this.trace) this.startKeyboardTrace();
    });
    c.addEventListener('blur', () => {
      if (this.trace && !this.press) {
        this.sel = { ...this.trace };
        this.trace = null;
        this.request();
      }
    });
    c.addEventListener('keydown', (e) => {
      const step = 40;
      const tracing = !!this.trace && !e.shiftKey;
      const keys: Record<string, () => void> = tracing
        ? {
            ArrowLeft: () => this.stepTrace(-1),
            ArrowRight: () => this.stepTrace(1),
            ArrowUp: () => this.switchTrace(-1),
            ArrowDown: () => this.switchTrace(1),
            Enter: () => this.pinTrace(),
            ' ': () => this.pinTrace(),
            Escape: () => {
              this.trace = null;
              this.request();
            },
          }
        : {
            ArrowLeft: () => this.pan(step, 0),
            ArrowRight: () => this.pan(-step, 0),
            ArrowUp: () => this.pan(0, step),
            ArrowDown: () => this.pan(0, -step),
            Enter: () => this.startKeyboardTrace(),
            Escape: () => {
              this.sel = null;
              this.request();
            },
          };
      Object.assign(keys, {
        '+': () => this.zoomAt(this.w / 2, this.h / 2, 0.7),
        '=': () => this.zoomAt(this.w / 2, this.h / 2, 0.7),
        '-': () => this.zoomAt(this.w / 2, this.h / 2, 1 / 0.7),
      });
      const k = keys[e.key];
      if (k) {
        e.preventDefault();
        k();
      }
    });
  }

  private endPress(): void {
    if (this.press) clearTimeout(this.press.hold);
    if (this.trace) this.trace = null;
    this.press = null;
  }

  private beginTrace(hit: Hit): void {
    if (this.press) this.press.mode = 'trace';
    this.sel = null;
    this.moveTrace(hit);
  }

  private moveTrace(hit: Hit): void {
    this.trace = { ...hit, key: this.trace?.key, dir: this.trace?.dir };
    this.canvas.dataset.trace = `${fmt(this.ix(hit.u))},${fmt(this.iy(hit.v))}`;
    if (this.settings.audio) void import('./audio').then((a) => a.sonify((hit.v - this.vp.yMin) / (this.vp.yMax - this.vp.yMin)));
    this.request();
  }

  private readout(h: Hit): string {
    return `(${fmt(this.ix(h.u))}, ${fmt(this.iy(h.v))})`;
  }

  private announce(text: string): void {
    this.live.textContent = text;
  }

  private visibleTraceable(): GraphItem[] {
    return this.spec.items.filter((i) => TRACEABLE.has(i.kind) && !this.hidden.has(i.id) && this.geo.get(i)?.segs.length);
  }

  private startKeyboardTrace(): void {
    const items = this.visibleTraceable();
    if (!items.length) return;
    const hit = this.nearest(items[0]!, this.w / 2, this.h / 2, Infinity);
    if (!hit) return;
    this.moveTrace(hit);
    this.announce(`Tracing ${hit.item.label}: ${this.readout(hit)}. Left and right arrows move, up and down change curve, Enter pins, Escape stops.`);
  }

  private switchTrace(dir: number): void {
    const items = this.visibleTraceable();
    if (!this.trace || items.length < 2) return;
    const i = items.findIndex((it) => it === this.trace!.item);
    const next = items[(i + dir + items.length) % items.length]!;
    const hit = this.nearest(next, this.toX(this.trace.u), this.toY(this.trace.v), Infinity);
    if (!hit) return;
    this.trace = null;
    this.moveTrace(hit);
    this.announce(`${next.label}: ${this.readout(hit)}`);
  }

  /** Arrow keys walk along the traced curve, about 1% of the window per press. */
  private stepTrace(s: number): void {
    const t = this.trace;
    if (!t) return;
    const span = this.vp.xMax - this.vp.xMin;
    const it = t.item;
    let next: Hit | null = null;
    if (it.kind === 'explicit') {
      const u = t.u + s * span / 100;
      const v = this.evalExplicit(it, u);
      if (Number.isFinite(v)) next = { item: it, u, v, d: 0 };
    } else if (it.kind === 'implicit') {
      const F = this.wrapImplicit(it.F);
      const e = { ...this.env };
      const at = (u: number, v: number) => {
        e.x = u;
        e.y = v;
        return F(e);
      };
      const h = span * 1e-6;
      let u = t.u;
      let v = t.v;
      const gx = (at(u + h, v) - at(u - h, v)) / (2 * h);
      const gy = (at(u, v + h) - at(u, v - h)) / (2 * h);
      const gl = Math.hypot(gx, gy);
      if (gl > 0) {
        let tu = -gy / gl;
        let tv = gx / gl;
        if (t.key !== s || !t.dir) {
          if (tu * s < 0 || (Math.abs(tu) < 1e-9 && tv * s < 0)) [tu, tv] = [-tu, -tv];
        } else if (tu * t.dir[0] + tv * t.dir[1] < 0) [tu, tv] = [-tu, -tv];
        u += (tu * span) / 100;
        v += (tv * span) / 100;
        for (let k = 0; k < 6; k++) {
          const f = at(u, v);
          const ax = (at(u + h, v) - at(u - h, v)) / (2 * h);
          const ay = (at(u, v + h) - at(u, v - h)) / (2 * h);
          const g2 = ax * ax + ay * ay;
          if (!(g2 > 0) || !Number.isFinite(f)) break;
          u -= (f * ax) / g2;
          v -= (f * ay) / g2;
        }
        if (Number.isFinite(u) && Number.isFinite(v)) {
          next = { item: it, u, v, d: 0 };
          this.trace = { ...t, key: s, dir: [tu, tv] };
        }
      }
    } else {
      // Polylines in parameter order: walk the samples.
      const line = t.line;
      if (line && t.i !== undefined) {
        let i = t.i;
        let walked = 0;
        const n = line.length / 2;
        while (walked < span / 100) {
          const j = i + s;
          if (j < 0 || j >= n) break;
          walked += Math.hypot(line[j * 2]! - line[i * 2]!, line[j * 2 + 1]! - line[i * 2 + 1]!);
          i = j;
        }
        next = { item: it, u: line[i * 2]!, v: line[i * 2 + 1]!, d: 0, line, i };
      }
    }
    if (!next) return;
    const keep = this.trace;
    this.moveTrace(next);
    if (keep?.dir && it.kind === 'implicit') this.trace = { ...this.trace!, key: keep.key, dir: keep.dir };
    else if (this.trace) this.trace.key = s;
    // Keep the traced point on screen.
    const px = this.toX(next.u);
    const py = this.toY(next.v);
    if (px < 20 || px > this.w - 20 || py < 20 || py > this.h - 20) this.pan(this.w / 2 - px, this.h / 2 - py);
    this.announce(this.readout(next));
  }

  private pinTrace(): void {
    const t = this.trace;
    if (!t) return;
    const poi = this.poiAt(this.toX(t.u), this.toY(t.v), 8);
    if (poi) return this.togglePin(poi);
    this.pins.push({ kind: 'trace', items: [t.item.id], x: this.ix(t.u), y: this.iy(t.v) });
    this.updatePinCount();
    this.announce(`Pinned ${this.readout(t)}`);
    this.request();
  }

  private togglePin(p: Poi): void {
    const i = this.pins.findIndex((q) => q.kind === p.kind && sameItems(q.items, p.items) && q.x === p.x && q.y === p.y);
    if (i >= 0) {
      this.pins.splice(i, 1);
      this.announce(`Unpinned ${POI_LABEL[p.kind]}`);
    } else {
      this.pins.push({ kind: p.kind, items: [...p.items], x: p.x, y: p.y });
      this.announce(`${POI_LABEL[p.kind]} (${fmt(p.x)}, ${fmt(p.y)}) pinned`);
    }
    this.updatePinCount();
    this.request();
  }

  private updatePinCount(): void {
    this.canvas.dataset.pins = String(this.pins.length);
  }

  private draggableAt(px: number, py: number, R: number): GraphItem | null {
    let best: GraphItem | null = null;
    let bd = R;
    for (const it of this.spec.items) {
      if (it.kind !== 'point' || !it.drag || this.hidden.has(it.id) || !this.onPointDrag) continue;
      const d = Math.hypot(this.toX(this.tx(it.x(this.env))) - px, this.toY(this.ty(it.y(this.env))) - py);
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    return best;
  }

  private dragPoint(it: Extract<GraphItem, { kind: 'point' }>, px: number, py: number, done: boolean): void {
    const q = 10 ** Math.floor(Math.log10(((this.vp.xMax - this.vp.xMin) / this.w) * 3));
    const snap = (v: number) => Number((Math.round(v / q) * q).toFixed(Math.max(0, -Math.floor(Math.log10(q)))));
    const x = snap(this.ix(this.fromX(px)));
    const y = snap(this.iy(this.fromY(py)));
    this.onPointDrag?.(it, x, y, done);
  }

  private poiAt(px: number, py: number, R: number): Poi | null {
    let best: Poi | null = null;
    let bd = R;
    for (const p of this.pois) {
      if (p.items.some((i) => this.hidden.has(i))) continue;
      const d = Math.hypot(this.toX(this.tx(p.x)) - px, this.toY(this.ty(p.y)) - py);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  /** The nearest point on a curve (or on `only`) to a screen position, within `max` pixels. */
  private nearest(only: GraphItem | null, px: number, py: number, max: number): Hit | null {
    let best: Hit | null = null;
    let bd = max;
    for (const [it, g] of this.geo) {
      if (only ? it !== only : this.hidden.has(it.id)) continue;
      const s = g.segs;
      for (let i = 0; i < s.length; i += 4) {
        const ax = this.toX(s[i]!);
        const ay = this.toY(s[i + 1]!);
        const bx = this.toX(s[i + 2]!);
        const by = this.toY(s[i + 3]!);
        const dx = bx - ax;
        const dy = by - ay;
        const l2 = dx * dx + dy * dy;
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
        const d = Math.hypot(ax + t * dx - px, ay + t * dy - py);
        if (d < bd) {
          bd = d;
          best = { item: it, u: s[i]! + t * (s[i + 2]! - s[i]!), v: s[i + 1]! + t * (s[i + 3]! - s[i + 1]!), d };
        }
      }
    }
    if (!best) return null;
    const it = best.item;
    if (it.kind === 'explicit') {
      const v = this.evalExplicit(it, best.u);
      if (Number.isFinite(v)) best.v = v;
    }
    // Where on the ordered polyline the hit lies (for keyboard stepping along parametric and polar curves).
    const lines = this.geo.get(it)?.lines;
    if (lines && (it.kind === 'parametric' || it.kind === 'polar' || it.kind === 'xOfY')) {
      let bestD = Infinity;
      for (const line of lines) {
        for (let i = 0; i < line.length; i += 2) {
          const d = (line[i]! - best.u) ** 2 + (line[i + 1]! - best.v) ** 2;
          if (d < bestD) {
            bestD = d;
            best.line = line;
            best.i = i / 2;
          }
        }
      }
    }
    return best;
  }

  private evalExplicit(it: Extract<GraphItem, { kind: 'explicit' }>, u: number): number {
    const f = this.wrapExplicit(it.f);
    return f({ ...this.env, x: u });
  }

  // ---------- log-axis wrappers (identity on linear axes) ----------
  private wrapExplicit(f: FloatFn): FloatFn {
    if (!this.logged) return f;
    const { logX, logY } = this.settings;
    return (e: FloatEnv) => {
      const u = e.x!;
      if (logX) e.x = 10 ** u;
      const r = f(e);
      e.x = u;
      return logY ? (r > 0 ? Math.log10(r) : NaN) : r;
    };
  }
  private wrapXofY(g: FloatFn): FloatFn {
    if (!this.logged) return g;
    const { logX, logY } = this.settings;
    return (e: FloatEnv) => {
      const v = e.y!;
      if (logY) e.y = 10 ** v;
      const r = g(e);
      e.y = v;
      return logX ? (r > 0 ? Math.log10(r) : NaN) : r;
    };
  }
  private wrapImplicit(F: FloatFn): FloatFn {
    if (!this.logged) return F;
    const { logX, logY } = this.settings;
    return (e: FloatEnv) => {
      const u = e.x!;
      const v = e.y!;
      if (logX) e.x = 10 ** u;
      if (logY) e.y = 10 ** v;
      const r = F(e);
      e.x = u;
      e.y = v;
      return r;
    };
  }
  private mapLines(lines: Polyline[]): Polyline[] {
    if (!this.logged) return lines;
    const out: Polyline[] = [];
    for (const p of lines) {
      let cur: number[] = [];
      for (let i = 0; i < p.length; i += 2) {
        const u = this.tx(p[i]!);
        const v = this.ty(p[i + 1]!);
        if (Number.isFinite(u) && Number.isFinite(v)) cur.push(u, v);
        else if (cur.length) {
          if (cur.length >= 4) out.push(Float64Array.from(cur));
          cur = [];
        }
      }
      if (cur.length >= 4) out.push(Float64Array.from(cur));
    }
    return out;
  }

  // ---------- legend & sliders ----------
  private colors(): string[] {
    const cs = getComputedStyle(document.documentElement);
    return [1, 2, 3, 4, 5, 6].map((i) => cs.getPropertyValue(`--g${i}`).trim() || '#2d70b3');
  }

  private colorFor(id: number, colors: string[]): string {
    return this.styleOf(id)?.color || colors[this.colorOf(id) % colors.length]!;
  }

  private renderLegend(): void {
    this.legend.replaceChildren();
    const colors = this.colors();
    for (const it of this.spec.items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'graph-key';
      b.setAttribute('aria-pressed', String(!this.hidden.has(it.id)));
      b.title = 'Show / hide';
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = this.colorFor(it.id, colors);
      const l = document.createElement('span');
      l.textContent = it.label.replace(/\btheta\b/g, 'θ');
      b.append(sw, l);
      b.addEventListener('click', () => {
        if (this.hidden.has(it.id)) this.hidden.delete(it.id);
        else this.hidden.add(it.id);
        b.setAttribute('aria-pressed', String(!this.hidden.has(it.id)));
        this.request();
      });
      this.legend.append(b);
    }
  }

  private renderSliders(): void {
    this.sliderBox.replaceChildren();
    for (const s of this.spec.sliders) {
      const row = document.createElement('label');
      row.className = 'graph-slider';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = s.name;
      const range = document.createElement('input');
      range.type = 'range';
      range.min = String(s.min);
      range.max = String(s.max);
      range.step = String(s.step);
      range.value = String(this.env[s.name] ?? s.value);
      const val = document.createElement('output');
      val.textContent = fmt(this.env[s.name] ?? s.value);
      const play = document.createElement('button');
      play.type = 'button';
      play.className = 'play';
      play.textContent = '▶';
      play.setAttribute('aria-label', `Animate ${s.name}`);
      const set = (v: number) => {
        this.env[s.name] = v;
        range.value = String(v);
        val.textContent = fmt(v);
        this.poisDirty = true;
        this.request();
      };
      range.addEventListener('input', () => set(Number(range.value)));
      play.addEventListener('click', (e) => {
        e.preventDefault();
        const running = this.playing.get(s.name);
        if (running !== undefined) {
          cancelAnimationFrame(running);
          this.playing.delete(s.name);
          play.textContent = '▶';
          return;
        }
        play.textContent = '❚❚';
        let dir = 1;
        let last = performance.now();
        const tick = (now: number) => {
          const dt = Math.min(50, now - last) / 1000;
          last = now;
          let v = (this.env[s.name] ?? 0) + dir * dt * (s.max - s.min) * 0.15;
          if (v > s.max) [v, dir] = [s.max, -1];
          if (v < s.min) [v, dir] = [s.min, 1];
          set(Math.round(v / s.step) * s.step);
          this.playing.set(s.name, requestAnimationFrame(tick));
        };
        this.playing.set(s.name, requestAnimationFrame(tick));
      });
      row.append(name, range, val, play);
      this.sliderBox.append(row);
    }
    this.sliderBox.hidden = this.spec.sliders.length === 0;
  }

  // ---------- points of interest ----------
  /** Recomputed once the view and parameters have been still for a moment, never mid-pan. */
  private schedulePois(): void {
    clearTimeout(this.poiTimer);
    this.poiTimer = window.setTimeout(() => {
      if (this.pointers.size && this.press?.mode === 'pan') return this.schedulePois();
      const items = this.spec.items.filter((i) => !this.hidden.has(i.id));
      try {
        if (this.logged) this.pois = analyze(items, this.env, this.ix(this.vp.xMin), this.ix(this.vp.xMax));
        else {
          const curves: Curve[] = [];
          for (const it of items) {
            const g = this.geo.get(it);
            if (g) curves.push({ item: it, segs: g.segs });
            else if (it.kind === 'explicit') curves.push({ item: it, segs: new Float64Array(0) });
          }
          this.pois = analyzeCurves(curves, this.env, this.vp);
        }
      } catch {
        this.pois = [];
      }
      // Pins follow their point when it moves a little (a slider changed): rebind to the nearest match.
      const span = this.vp.xMax - this.vp.xMin;
      for (const pin of this.pins) {
        if (pin.kind === 'trace') continue;
        let best: Poi | null = null;
        let bd = span * 0.2;
        for (const p of this.pois) {
          if (p.kind !== pin.kind || !sameItems(p.items, pin.items)) continue;
          const d = Math.hypot(p.x - pin.x, p.y - pin.y);
          if (d < bd) {
            bd = d;
            best = p;
          }
        }
        if (best) {
          pin.x = best.x;
          pin.y = best.y;
        }
      }
      this.poisDirty = false;
      this.canvas.dataset.pois = String(this.pois.length);
      this.onPois?.(this.pois);
      this.request();
    }, 70);
  }

  // ---------- drawing ----------
  private request(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.draw());
  }

  private draw(): void {
    const surface = this.spec.items.find((i) => i.kind === 'surface');
    if (surface) {
      if (surface.kind === 'surface') this.surface?.update(surface, this.env);
      return;
    }
    if (!this.w || !this.h) return;
    const shown = this.revealed();
    this.paint(this.ctx, shown);
    if (shown < 1) return this.request(); // points of interest and the trace join once the curves are drawn
    if (this.poisDirty) {
      this.poisDirty = false;
      this.schedulePois();
    }
    this.overlay();
  }

  /** Everything but the hover/trace overlay: grid, axes, items, points of interest, pins. */
  private paint(ctx: CanvasRenderingContext2D, shown = 1, exporting = false): void {
    const { w, h } = this;
    const cs = getComputedStyle(document.documentElement);
    const ink = cs.getPropertyValue('--ink').trim();
    const line = cs.getPropertyValue('--line').trim();
    const muted = cs.getPropertyValue('--muted').trim();
    const bg = this.settings.bg || cs.getPropertyValue('--surface').trim();
    const colors = this.colors();
    const S = this.settings;
    const hc = S.contrast;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 1;
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';

    // Grid
    const xs = niceStep(this.vp.xMax - this.vp.xMin, Math.max(4, w / 90));
    const ys = niceStep(this.vp.yMax - this.vp.yMin, Math.max(3, h / 90));
    const gx = S.logX ? Math.max(1, Math.round(xs)) : xs;
    const gy = S.logY ? Math.max(1, Math.round(ys)) : ys;
    if (S.grid && S.polar && !this.logged) this.polarGrid(ctx, line, muted, S.minor);
    else if (S.grid) {
      const grid = (minor: boolean) => {
        ctx.strokeStyle = hc ? muted : line;
        ctx.globalAlpha = minor ? 0.45 : 1;
        ctx.beginPath();
        const vline = (u: number) => {
          const p = Math.round(this.toX(u)) + 0.5;
          ctx.moveTo(p, 0);
          ctx.lineTo(p, h);
        };
        const hline = (v: number) => {
          const p = Math.round(this.toY(v)) + 0.5;
          ctx.moveTo(0, p);
          ctx.lineTo(w, p);
        };
        const run = (lo: number, hi: number, step: number, log: boolean, f: (v: number) => void) => {
          if (log) {
            for (let d = Math.floor(lo); d <= hi; d++) {
              if (minor) for (let k = 2; k <= 9; k++) f(d + Math.log10(k));
              else if (d % step === 0) f(d);
            }
          } else {
            const st = minor ? step / 5 : step;
            for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) f(v);
          }
        };
        run(this.vp.xMin, this.vp.xMax, gx, S.logX, vline);
        run(this.vp.yMin, this.vp.yMax, gy, S.logY, hline);
        ctx.stroke();
        ctx.globalAlpha = 1;
      };
      if (S.minor) grid(true);
      grid(false);
    }

    // Axes
    const ax = Math.round(this.toX(S.logX ? 0 : 0)) + 0.5;
    const ay = Math.round(this.toY(0)) + 0.5;
    ctx.strokeStyle = hc ? ink : muted;
    ctx.lineWidth = hc ? 2 : 1.25;
    ctx.beginPath();
    if (ax >= 0 && ax <= w && !S.logX) {
      ctx.moveTo(ax, 0);
      ctx.lineTo(ax, h);
    }
    if (ay >= 0 && ay <= h && !S.logY) {
      ctx.moveTo(0, ay);
      ctx.lineTo(w, ay);
    }
    ctx.stroke();

    // Tick labels, pinned to the edge when the axis is off-screen.
    ctx.fillStyle = hc ? ink : muted;
    const yTicks = this.spec.axes?.yTicks !== false;
    if (S.numbers) {
      const labelY = S.logY ? h - 6 : Math.min(Math.max(ay + 14, 14), h - 4);
      ctx.textAlign = 'center';
      const xLabel = (u: number) => (S.logX ? fmt(10 ** u) : S.polar && S.degrees ? fmt(Number(u.toPrecision(12))) : fmt(Number(u.toPrecision(12))));
      for (let u = Math.ceil(this.vp.xMin / gx) * gx; u <= this.vp.xMax; u += gx) {
        if (!S.logX && Math.abs(u) < gx / 2) continue;
        const label = xLabel(u);
        const half = ctx.measureText(label).width / 2 + 2;
        const px = this.toX(u);
        if (px - half < 0 || px + half > w - 40) continue; // don't clip at the edges or under the tool buttons
        ctx.fillText(label, px, labelY);
      }
      ctx.textAlign = 'right';
      const labelX = S.logX ? 34 : Math.min(Math.max(ax - 6, 30), w - 4);
      for (let v = Math.ceil(this.vp.yMin / gy) * gy; yTicks && v <= this.vp.yMax; v += gy) {
        if (!S.logY && Math.abs(v) < gy / 2) continue;
        ctx.fillText(S.logY ? fmt(10 ** v) : fmt(Number(v.toPrecision(12))), labelX, this.toY(v) + 4);
      }
      if (!this.logged && ax >= 0 && ax <= w && ay >= 0 && ay <= h && yTicks) ctx.fillText('0', ax - 6, ay + 14);
    }
    // Axis titles: statistical plots' own, or the settings' labels.
    const axes = { x: S.xLabel || this.spec.axes?.x, y: S.yLabel || this.spec.axes?.y };
    if (axes.x || axes.y) {
      ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = hc ? ink : muted;
      if (axes.x) {
        ctx.textAlign = 'right';
        ctx.fillText(axes.x, w - 46, Math.min(h - 8, Math.max(ay - 8, 14)));
      }
      if (axes.y && yTicks) {
        ctx.textAlign = 'left';
        ctx.fillText(axes.y, Math.min(Math.max(ax + 8, 8), w - 80), 16);
      }
      ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    }

    // Curves
    if (shown < 1) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w * shown, h);
      ctx.clip();
    }
    if (!exporting) this.geo.clear();
    // Images first, under everything else.
    for (const it of this.spec.items) if (it.kind === 'image' && !this.hidden.has(it.id)) this.drawImageItem(ctx, it);
    for (const it of this.spec.items) {
      if (this.hidden.has(it.id) || it.kind === 'image') continue;
      const st = this.styleOf(it.id) ?? {};
      const color = this.colorFor(it.id, colors);
      this.alpha = ctx.globalAlpha = (this.dimmed.has(it.id) ? 0.35 : 1) * (st.opacity ?? 1);
      this.drawItem(ctx, it, color, st, bg);
      this.alpha = ctx.globalAlpha = 1;
      ctx.setLineDash([]);
    }
    if (shown < 1) {
      ctx.restore();
      return;
    }

    // Points of interest: small open dots; pinned ones carry their label.
    for (const p of this.pois) {
      if (p.items.some((i) => this.hidden.has(i))) continue;
      const px = this.toX(this.tx(p.x));
      const py = this.toY(this.ty(p.y));
      if (!(px > -5 && px < w + 5 && py > -5 && py < h + 5)) continue;
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = bg;
      ctx.strokeStyle = muted;
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
    }
    for (const pin of this.pins) {
      if (pin.items.some((i) => this.hidden.has(i))) continue;
      const px = this.toX(this.tx(pin.x));
      const py = this.toY(this.ty(pin.y));
      if (!(px > -5 && px < w + 5 && py > -5 && py < h + 5)) continue;
      ctx.beginPath();
      ctx.arc(px, py, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = pin.kind === 'trace' ? this.colorFor(pin.items[0]!, colors) : ink;
      ctx.fill();
      this.label(ctx, `(${fmt(pin.x)}, ${fmt(pin.y)})`, px, py, ink, bg, line);
    }
  }

  /** Hover tip, picked point and traced point: drawn on top, never exported. */
  private overlay(): void {
    const { ctx } = this;
    const cs = getComputedStyle(document.documentElement);
    const ink = cs.getPropertyValue('--ink').trim();
    const colors = this.colors();
    this.tip.hidden = true;
    const marker = (hit: Hit, filled: boolean) => {
      const px = this.toX(hit.u);
      const py = this.toY(hit.v);
      const color = this.colorFor(hit.item.id, colors);
      ctx.beginPath();
      ctx.arc(px, py, filled ? 6 : 5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = this.settings.bg || cs.getPropertyValue('--surface').trim();
      ctx.stroke();
    };
    const active = this.trace ?? this.sel;
    if (active) {
      marker(active, true);
      this.showTip(`<b>${this.readout(active)}</b>`, this.toX(active.u), this.toY(active.v));
      this.canvas.dataset.trace = `${fmt(this.ix(active.u))},${fmt(this.iy(active.v))}`;
    } else delete this.canvas.dataset.trace;
    if (this.trace || !this.hover) return;
    const R = this.radius(this.hover.touch);
    const poi = this.poiAt(this.hover.x, this.hover.y, R);
    if (poi) {
      const px = this.toX(this.tx(poi.x));
      const py = this.toY(this.ty(poi.y));
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fillStyle = ink;
      ctx.fill();
      this.showTip(`${POI_LABEL[poi.kind]}<br><b>(${fmt(poi.x)}, ${fmt(poi.y)})</b>`, px, py);
      this.canvas.style.cursor = 'pointer';
      return;
    }
    if (this.markTip(this.hover.x, this.hover.y)) return;
    const drag = this.draggableAt(this.hover.x, this.hover.y, R);
    this.canvas.style.cursor = drag ? 'grab' : '';
    if (drag) return;
    const hit = this.nearest(null, this.hover.x, this.hover.y, R);
    if (hit) {
      marker(hit, false);
      if (!this.sel) this.showTip(`<b>${this.readout(hit)}</b>`, this.toX(hit.u), this.toY(hit.v));
    }
  }

  private polarGrid(ctx: CanvasRenderingContext2D, line: string, muted: string, minor: boolean): void {
    const { w, h } = this;
    const cx = this.toX(0);
    const cy = this.toY(0);
    const corners = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => Math.hypot(this.fromX(x!), this.fromY(y!)));
    const rMax = Math.max(...corners);
    const step = niceStep(rMax, 6);
    const scale = w / (this.vp.xMax - this.vp.xMin);
    const scaleY = h / (this.vp.yMax - this.vp.yMin);
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let r = step; r <= rMax; r += step) {
      ctx.moveTo(cx + r * scale, cy);
      ctx.ellipse(cx, cy, r * scale, r * scaleY, 0, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.globalAlpha = minor ? 0.6 : 1;
    ctx.beginPath();
    const n = minor ? 24 : 12;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * rMax * scale, cy - Math.sin(a) * rMax * scaleY);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Angle labels around a ring.
    ctx.fillStyle = muted;
    ctx.textAlign = 'center';
    const ring = Math.min(w, h) * 0.42;
    for (let k = 0; k < 12; k++) {
      if (k % 3) continue;
      const a = (k / 12) * Math.PI * 2;
      const label = this.settings.degrees ? `${k * 30}°` : ['0', 'π/2', 'π', '3π/2'][k / 3]!;
      const x = cx + Math.cos(a) * ring;
      const y = cy - Math.sin(a) * ring;
      if (x > 8 && x < w - 40 && y > 12 && y < h - 4) ctx.fillText(label, x, y);
    }
  }

  /** How much of the first drawing is revealed, 0–1 (eased, 300 ms). */
  private revealed(): number {
    if (this.revealAt < 0) this.revealAt = performance.now();
    if (!this.revealAt) return 1;
    const p = Math.min(1, (performance.now() - this.revealAt) / 300);
    if (p === 1) this.revealAt = 0;
    return 1 - (1 - p) ** 3;
  }

  /** Tooltip for the data point, histogram bar or point under the pointer; false when there is none. */
  private markTip(px: number, py: number): boolean {
    for (const it of this.spec.items) {
      if (this.hidden.has(it.id)) continue;
      if (it.kind === 'scatter') {
        for (let i = 0; i < it.points.length; i += 2) {
          const x = it.points[i]!;
          const y = it.points[i + 1]!;
          if (Math.hypot(this.toX(this.tx(x)) - px, this.toY(this.ty(y)) - py) < 10) {
            this.showTip(this.spec.axes?.yTicks === false || this.spec.axes?.y === 'count' ? `<b>${fmt(x)}</b>` : `<b>(${fmt(x)}, ${fmt(y)})</b>`, this.toX(this.tx(x)), this.toY(this.ty(y)));
            return true;
          }
        }
      } else if (it.kind === 'point' && !it.drag) {
        const x = it.x(this.env);
        const y = it.y(this.env);
        if (Math.hypot(this.toX(this.tx(x)) - px, this.toY(this.ty(y)) - py) < 12) {
          this.showTip(`<b>(${fmt(x)}, ${fmt(y)})</b>`, this.toX(this.tx(x)), this.toY(this.ty(y)));
          return true;
        }
      } else if (it.kind === 'bars') {
        const wx = this.fromX(px);
        const wy = this.fromY(py);
        for (let i = 0; i < it.heights.length; i++) {
          if (wx >= it.edges[i]! && wx < it.edges[i + 1]! && wy >= 0 && wy <= it.heights[i]!) {
            this.showTip(`${fmt(it.edges[i]!)} to ${fmt(it.edges[i + 1]!)}<br><b>${it.heights[i]}</b>`, px, py);
            return true;
          }
        }
      }
    }
    return false;
  }

  private drawImageItem(ctx: CanvasRenderingContext2D, it: Extract<GraphItem, { kind: 'image' }>): void {
    const x0 = this.toX(this.tx(it.x - it.w / 2));
    const x1 = this.toX(this.tx(it.x + it.w / 2));
    const y0 = this.toY(this.ty(it.y + it.h / 2));
    const y1 = this.toY(this.ty(it.y - it.h / 2));
    if (![x0, x1, y0, y1].every(Number.isFinite)) return;
    ctx.globalAlpha = Math.max(0, Math.min(1, it.opacity)) * (this.dimmed.has(it.id) ? 0.35 : 1);
    try {
      ctx.drawImage(it.img, x0, y0, x1 - x0, y1 - y0);
    } catch {
      // Not decoded yet.
    }
    ctx.globalAlpha = 1;
  }

  private drawItem(ctx: CanvasRenderingContext2D, it: GraphItem, color: string, st: ItemStyle, bg: string): void {
    const width = (st.width ?? (it.kind === 'explicit' && it.derivativeOf !== undefined ? 2 : 2.5)) * (this.settings.contrast ? 1.5 : 1);
    const dash = st.line === 'dashed' ? [width * 4, width * 2.5] : st.line === 'dotted' ? [0.1, width * 2.4] : [];
    const stroke = (lines: Polyline[]) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.setLineDash(dash);
      ctx.beginPath();
      for (const p of lines) {
        ctx.moveTo(this.toX(p[0]!), this.toY(p[1]!));
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(this.toX(p[i]!), this.toY(p[i + 1]!));
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };
    const keep = (lines: Polyline[]) => {
      this.geo.set(it, { segs: toSegments(lines), lines });
      return lines;
    };
    const dot = (px: number, py: number, r: number) => {
      const style = st.point ?? 'dot';
      ctx.beginPath();
      if (style === 'cross') {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.moveTo(px - r, py - r);
        ctx.lineTo(px + r, py + r);
        ctx.moveTo(px + r, py - r);
        ctx.lineTo(px - r, py + r);
        ctx.stroke();
        return;
      }
      ctx.arc(px, py, r, 0, Math.PI * 2);
      if (style === 'open') {
        ctx.fillStyle = bg;
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.stroke();
      } else {
        ctx.fillStyle = color;
        ctx.fill();
      }
    };
    const vp = this.vp;
    switch (it.kind) {
      case 'surface':
      case 'image':
      case 'implicit3d':
      case 'curve3d':
      case 'psurface':
      case 'point3d':
      case 'vector3d':
        return; // drawn elsewhere (3D view, images first)
      case 'scatter': {
        const pts: number[] = [];
        for (let i = 0; i < it.points.length; i += 2) {
          const x = this.toX(this.tx(it.points[i]!));
          const y = this.toY(this.ty(it.points[i + 1]!));
          if (Number.isFinite(x) && Number.isFinite(y)) pts.push(x, y);
        }
        if (it.connect && pts.length >= 4) {
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.setLineDash(dash);
          ctx.beginPath();
          ctx.moveTo(pts[0]!, pts[1]!);
          for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (st.point && st.point !== 'dot') {
          for (let i = 0; i < pts.length; i += 2) dot(pts[i]!, pts[i + 1]!, 5);
          return;
        }
        ctx.fillStyle = color;
        ctx.strokeStyle = bg;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < pts.length; i += 2) {
          const x = pts[i]!;
          const y = pts[i + 1]!;
          if (x < -6 || x > this.w + 6 || y < -6 || y > this.h + 6) continue;
          ctx.moveTo(x + 5, y);
          ctx.arc(x, y, 5, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.stroke();
        return;
      }
      case 'bars': {
        const y0 = this.toY(0);
        for (let i = 0; i < it.heights.length; i++) {
          const x0 = this.toX(it.edges[i]!);
          const x1 = this.toX(it.edges[i + 1]!);
          const y1 = this.toY(it.heights[i]!);
          ctx.globalAlpha = 0.35 * this.alpha;
          ctx.fillStyle = color;
          ctx.fillRect(x0, y1, x1 - x0, y0 - y1);
          ctx.globalAlpha = this.alpha;
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y1) + 0.5, Math.round(x1 - x0), Math.round(y0 - y1));
        }
        return;
      }
      case 'box': {
        const [lo, q1, med, q3, hi] = it.q;
        const yc = this.toY(it.y);
        const half = Math.min(48, Math.abs(this.toY(it.y + 0.45) - yc));
        const X = (v: number) => Math.round(this.toX(v)) + 0.5;
        ctx.globalAlpha = 0.22 * this.alpha;
        ctx.fillStyle = color;
        ctx.fillRect(X(q1), yc - half, X(q3) - X(q1), half * 2);
        ctx.globalAlpha = this.alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(X(q1), yc - half, X(q3) - X(q1), half * 2);
        ctx.beginPath();
        ctx.moveTo(X(med), yc - half);
        ctx.lineTo(X(med), yc + half);
        // Whiskers with end caps.
        ctx.moveTo(X(lo), yc);
        ctx.lineTo(X(q1), yc);
        ctx.moveTo(X(q3), yc);
        ctx.lineTo(X(hi), yc);
        ctx.moveTo(X(lo), yc - half / 2);
        ctx.lineTo(X(lo), yc + half / 2);
        ctx.moveTo(X(hi), yc - half / 2);
        ctx.lineTo(X(hi), yc + half / 2);
        ctx.stroke();
        ctx.lineWidth = 1.5;
        for (const o of it.outliers) {
          ctx.beginPath();
          ctx.arc(this.toX(o), yc, 4.5, 0, Math.PI * 2);
          ctx.stroke();
        }
        // Five numbers under the box, skipping labels that would overlap.
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
        ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center';
        let last = -Infinity;
        for (const v of [lo, q1, med, q3, hi]) {
          const label = fmt(v);
          const x = this.toX(v);
          const tw = ctx.measureText(label).width;
          if (x - tw / 2 < last + 4) continue;
          ctx.fillText(label, x, yc + half + 16);
          last = x + tw / 2;
        }
        return;
      }
      case 'shade': {
        const fromV = it.lo ? it.lo(this.env) : it.from;
        const toV = it.hi ? it.hi(this.env) : it.to;
        const from = Math.max(fromV, this.ix(vp.xMin));
        const to = Math.min(toV, this.ix(vp.xMax));
        if (!(to > from)) return;
        const n = Math.max(16, Math.round(((this.tx(to) - this.tx(from)) / (vp.xMax - vp.xMin)) * this.w));
        const e = { ...this.env };
        const base = (x: number) => {
          if (!it.g) return this.toY(this.settings.logY ? vp.yMin : 0);
          e.x = x;
          return this.toY(this.ty(it.g(e)));
        };
        ctx.beginPath();
        ctx.moveTo(this.toX(this.tx(from)), base(from));
        for (let i = 0; i <= n; i++) {
          const x = this.ix(this.tx(from) + ((this.tx(to) - this.tx(from)) * i) / n);
          e.x = x;
          const v = it.f(e);
          ctx.lineTo(this.toX(this.tx(x)), Number.isFinite(v) ? this.toY(this.ty(v)) : base(x));
        }
        for (let i = n; i >= 0 && it.g; i--) {
          const x = this.ix(this.tx(from) + ((this.tx(to) - this.tx(from)) * i) / n);
          ctx.lineTo(this.toX(this.tx(x)), base(x));
        }
        if (!it.g) ctx.lineTo(this.toX(this.tx(to)), base(to));
        ctx.closePath();
        ctx.globalAlpha = 0.3 * this.alpha;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = this.alpha;
        // Boundary lines at finite edges.
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (const b of [fromV, toV]) {
          if (!Number.isFinite(b) || this.tx(b) < vp.xMin || this.tx(b) > vp.xMax) continue;
          e.x = b;
          ctx.moveTo(this.toX(this.tx(b)), base(b));
          ctx.lineTo(this.toX(this.tx(b)), this.toY(this.ty(it.f(e))));
        }
        ctx.stroke();
        return;
      }
      case 'explicit': {
        const domain = it.domain ? ([this.tx(it.domain[0]), this.tx(it.domain[1])] as [number, number]) : undefined;
        const d = domain && domain.map((v, i) => (Number.isFinite(v) ? v : i ? Infinity : -Infinity)) as [number, number] | undefined;
        stroke(keep(sampleExplicit(this.wrapExplicit(it.f), this.env, vp, this.w, d)));
        return;
      }
      case 'xOfY':
        stroke(keep(sampleXofY(this.wrapXofY(it.f), this.env, vp, this.h)));
        return;
      case 'parametric': {
        const big = { xMin: this.ix(vp.xMin), xMax: this.ix(vp.xMax), yMin: this.iy(vp.yMin), yMax: this.iy(vp.yMax) };
        stroke(keep(this.mapLines(sampleParametric(it.fx, it.fy, this.env, it.range, big))));
        return;
      }
      case 'polar': {
        const big = { xMin: this.ix(vp.xMin), xMax: this.ix(vp.xMax), yMin: this.iy(vp.yMin), yMax: this.iy(vp.yMax) };
        // In degrees, θ runs over 0–360 (the row's functions read degrees too).
        const lines = this.settings.degrees
          ? sampleParametric((e) => it.r(e) * Math.cos((e.theta! * Math.PI) / 180), (e) => it.r(e) * Math.sin((e.theta! * Math.PI) / 180), this.env, [(it.range[0] * 180) / Math.PI, (it.range[1] * 180) / Math.PI], big, 'theta')
          : samplePolar(it.r, this.env, it.range, big);
        stroke(keep(this.mapLines(lines)));
        return;
      }
      case 'vector': {
        const x0 = this.toX(this.tx(it.x0(this.env)));
        const y0 = this.toY(this.ty(it.y0(this.env)));
        const x1 = this.toX(this.tx(it.x1(this.env)));
        const y1 = this.toY(this.ty(it.y1(this.env)));
        if (![x0, y0, x1, y1].every(Number.isFinite)) return;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        const a = Math.atan2(y1 - y0, x1 - x0);
        const L = 12;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - L * Math.cos(a - 0.4), y1 - L * Math.sin(a - 0.4));
        ctx.lineTo(x1 - L * Math.cos(a + 0.4), y1 - L * Math.sin(a + 0.4));
        ctx.closePath();
        ctx.fill();
        return;
      }
      case 'point': {
        const x = it.x(this.env);
        const y = it.y(this.env);
        const px = this.toX(this.tx(x));
        const py = this.toY(this.ty(y));
        if (!Number.isFinite(px) || !Number.isFinite(py)) return;
        if (it.drag && this.onPointDrag) {
          // A movable point wears a soft halo.
          ctx.beginPath();
          ctx.arc(px, py, 11, 0, Math.PI * 2);
          ctx.globalAlpha = 0.22 * this.alpha;
          ctx.fillStyle = color;
          ctx.fill();
          ctx.globalAlpha = this.alpha;
        }
        dot(px, py, 5);
        if (st.showLabel !== false) {
          const text = st.label || `(${fmt(x)}, ${fmt(y)})`;
          const cs = getComputedStyle(document.documentElement);
          this.label(ctx, text, px, py, color, bg, cs.getPropertyValue('--line').trim());
        }
        return;
      }
      case 'implicit': {
        const cols = Math.min(240, Math.max(60, Math.round(this.w / 4)));
        const rows = Math.max(40, Math.round((cols * this.h) / this.w));
        const conds = [{ F: it.F, op: it.op }, ...(it.extra ?? [])];
        const marched = conds.map((c) => ({ ...c, ...marchImplicit(this.wrapImplicit(c.F), this.env, vp, cols, rows) }));
        if (conds.some((c) => c.op !== '=')) {
          // Shade where every inequality holds (lhs − rhs < 0 for "<").
          const cw = this.w / cols;
          const ch = this.h / rows;
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.16 * this.alpha;
          ctx.beginPath();
          for (let j = 0; j < rows; j++) {
            for (let i = 0; i < cols; i++) {
              let ok = true;
              for (const m of marched) {
                if (m.op === '=') continue;
                const v = m.values[j * (cols + 1) + i]!;
                const want = m.op === '<' || m.op === '<=' ? -1 : 1;
                if (!(Number.isFinite(v) && Math.sign(v) === want)) {
                  ok = false;
                  break;
                }
              }
              if (ok) ctx.rect(i * cw, this.h - (j + 1) * ch, cw + 0.5, ch + 0.5);
            }
          }
          ctx.fill();
          ctx.globalAlpha = this.alpha;
        }
        let all = 0;
        for (const m of marched) all += m.segments.length;
        const segs = new Float64Array(all);
        let o = 0;
        for (const m of marched) {
          segs.set(m.segments, o);
          o += m.segments.length;
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.lineCap = 'round';
          ctx.setLineDash(m.op === '<' || m.op === '>' ? [7, 5] : dash);
          ctx.beginPath();
          const s = m.segments;
          for (let i = 0; i < s.length; i += 4) {
            ctx.moveTo(this.toX(s[i]!), this.toY(s[i + 1]!));
            ctx.lineTo(this.toX(s[i + 2]!), this.toY(s[i + 3]!));
          }
          ctx.stroke();
          ctx.setLineDash([]);
        }
        this.geo.set(it, { segs });
        return;
      }
    }
  }

  /** A pinned or point label: a soft rounded chip beside the point. */
  private label(ctx: CanvasRenderingContext2D, text: string, px: number, py: number, ink: string, bg: string, border: string): void {
    ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
    const tw = ctx.measureText(text).width;
    const x = Math.min(Math.max(px + 10, 4), this.w - tw - 14);
    const y = Math.max(py - 12, 18);
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = bg;
    ctx.beginPath();
    const r = 6;
    const bx = x - 5;
    const by = y - 13;
    const bw = tw + 10;
    const bh = 18;
    ctx.moveTo(bx + r, by);
    ctx.lineTo(bx + bw - r, by);
    ctx.arc(bx + bw - r, by + r, r, -Math.PI / 2, 0);
    ctx.lineTo(bx + bw, by + bh - r);
    ctx.arc(bx + bw - r, by + bh - r, r, 0, Math.PI / 2);
    ctx.lineTo(bx + r, by + bh);
    ctx.arc(bx + r, by + bh - r, r, Math.PI / 2, Math.PI);
    ctx.lineTo(bx, by + r);
    ctx.arc(bx + r, by + r, r, Math.PI, Math.PI * 1.5);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.textAlign = 'left';
    ctx.fillText(text, x, y);
  }

  private showTip(html: string, px: number, py: number): void {
    this.tip.innerHTML = html;
    this.tip.hidden = false;
    const left = Math.min(Math.max(px + 12, 4), this.w - 150);
    const top = py < 60 ? py + 14 : py - 52;
    this.tip.style.transform = `translate(${left}px, ${top}px)`;
  }

  /** The graph as PNG (what's on screen, without the hover tip). */
  exportPng(): void {
    this.paint(this.ctx);
    const a = document.createElement('a');
    a.download = 'lemma-graph.png';
    a.href = this.canvas.toDataURL('image/png');
    a.click();
    this.request();
  }

  /** The graph as SVG text, drawn by the same code as the canvas. */
  toSvg(): string {
    const svg = new SvgCtx(this.w, this.h, this.ctx);
    this.paint(svg as unknown as CanvasRenderingContext2D, 1, true);
    return String(svg);
  }

  /** Sonifies the first visible curve across the window (an audio overview). */
  playCurve(): void {
    const it = this.visibleTraceable()[0];
    if (!it) return;
    const g = this.geo.get(it);
    if (!g) return;
    const fr: number[] = [];
    if (it.kind === 'explicit') {
      for (let i = 0; i <= 200; i++) {
        const v = this.evalExplicit(it, this.vp.xMin + ((this.vp.xMax - this.vp.xMin) * i) / 200);
        fr.push((v - this.vp.yMin) / (this.vp.yMax - this.vp.yMin));
      }
    } else for (let i = 1; i < g.segs.length; i += 4) fr.push((g.segs[i]! - this.vp.yMin) / (this.vp.yMax - this.vp.yMin));
    void import('./audio').then((a) => a.sweep(fr));
  }
}
