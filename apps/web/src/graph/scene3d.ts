import {
  curve3d,
  extrudeMesh,
  marchImplicit,
  marchingCubesSteps,
  niceStep,
  paramSurfaceMesh,
  sampleExplicit,
  sampleParametric,
  samplePolar,
  sampleXofY,
  surfaceMesh,
  type Box3,
  type GraphItem,
  type Mesh3,
} from '@lemma/graph-engine';
import { rgb } from './surface';
import type { ViewSettings } from './view';

/**
 * The graphing workspace's 3D view: several items at once in one box — surfaces z = f(x, y), implicit surfaces
 * F(x, y, z) = 0 (marching cubes, spread over frames so typing stays smooth), parametric surfaces and curves, points,
 * vectors, planes, and 2D rows drawn on the floor plane or extended up through the box. WebGL2 for the surfaces
 * (lit, per-row colour and opacity, clipped to the box), a 2D canvas on top for curves, points, axes and labels;
 * without WebGL2 everything is painted on the 2D canvas, far to near. Drag to rotate, Shift-drag or two fingers to
 * pan, wheel or pinch to zoom; hover or tap shows coordinates. Loaded on first use of 3D.
 */

export interface Scene3DItem {
  item: GraphItem;
  color: string;
  opacity: number;
  extend: boolean;
  width: number;
}

const DIST = 4.6;
const NEAR = DIST - 2.8;
const FAR = DIST + 2.8;
const HOME = { yaw: -0.7, pitch: 0.45, zoom: 1 };
const L = [-0.35, -0.55, 0.76];

function fmt(v: number): string {
  if (v === 0 || !Number.isFinite(v)) return String(v === 0 ? 0 : v);
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) return v.toExponential(2).replace(/\.?0+e/, 'e');
  return String(Number(v.toPrecision(4)));
}

interface Built {
  key: string;
  mesh?: Mesh3;
  /** In progress: marching cubes resumes here on the next frame. */
  pending?: Generator<number, Mesh3, void>;
  lines?: Float64Array[]; // x, y, z triples
  points?: number[]; // x, y, z triples
  arrows?: number[][]; // [x0, y0, z0, x1, y1, z1]
  gl?: { vao: WebGLVertexArrayObject; n: number; bufs: WebGLBuffer[] };
}

const VERT = `#version 300 es
in vec3 a_pos;
in vec3 a_nrm;
uniform vec4 u_rot;
uniform vec4 u_proj;
uniform float u_dist;
out vec3 v_box;
out vec3 v_nrm;
void main() {
  float x1 = a_pos.x * u_rot.x - a_pos.y * u_rot.y;
  float y1 = a_pos.x * u_rot.y + a_pos.y * u_rot.x;
  float up = y1 * u_rot.w + a_pos.z * u_rot.z;
  float d = u_dist + y1 * u_rot.z - a_pos.z * u_rot.w;
  gl_Position = vec4(x1 * u_proj.x, up * u_proj.y, u_proj.z * d + u_proj.w, d);
  v_box = a_pos;
  v_nrm = a_nrm;
}`;
const FRAG = `#version 300 es
precision mediump float;
in vec3 v_box;
in vec3 v_nrm;
uniform vec4 u_color;
uniform bool u_lit;
uniform vec3 u_light;
out vec4 o;
void main() {
  if (any(greaterThan(abs(v_box), vec3(1.002)))) discard;
  if (!u_lit) { o = u_color; return; }
  float l = abs(dot(normalize(v_nrm), u_light));
  o = vec4(u_color.rgb * (0.42 + 0.58 * l), u_color.a);
}`;

export class Scene3D {
  readonly root: HTMLElement;
  private stage: HTMLElement;
  private glCanvas: HTMLCanvasElement | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private prog: WebGLProgram | null = null;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private lineVao: WebGLVertexArrayObject | null = null;
  private lineBuf: WebGLBuffer | null = null;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private tip: HTMLElement;
  private note: HTMLElement;
  private summary: HTMLElement;
  private items: Scene3DItem[] = [];
  private built = new Map<Scene3DItem, Built>();
  private cache = new Map<string, Built>();
  private env: Record<string, number> = {};
  private center = [0, 0, 0];
  private R = 8;
  private cam = { ...HOME };
  private w = 0;
  private h = 0;
  private frame = 0;
  private work = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private hover: { x: number; y: number; r: number } | null = null;
  private pick: { x: number; y: number; z: number } | null = null;
  private settings: Partial<ViewSettings> = {};
  private observer: ResizeObserver;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'surface3d scene3d';
    this.stage = document.createElement('div');
    this.stage.className = 'graph-stage';
    this.canvas = document.createElement('canvas');
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', '3D graph. Drag or use the arrow keys to rotate; Shift moves; + and − zoom.');
    this.tip = document.createElement('div');
    this.tip.className = 'graph-tip';
    this.tip.hidden = true;
    this.note = document.createElement('p');
    this.note.className = 'surface-note';
    this.note.hidden = true;
    this.summary = document.createElement('p');
    this.summary.className = 'graph-summary';
    this.summary.id = `scene-summary-${Math.random().toString(36).slice(2, 8)}`;
    this.canvas.setAttribute('aria-describedby', this.summary.id);
    const glc = document.createElement('canvas');
    glc.setAttribute('aria-hidden', 'true');
    try {
      const gl = glc.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true });
      if (gl) this.initGl(gl);
    } catch {
      this.gl = null;
    }
    if (this.gl) {
      this.glCanvas = glc;
      glc.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        this.fallback('The graphics context was lost, so 3D is now drawn with a simpler renderer.');
      });
      this.stage.append(glc);
    }
    this.ctx = this.canvas.getContext('2d');
    this.stage.append(this.canvas, this.tip);
    const tools = document.createElement('div');
    tools.className = 'graph-tools';
    const btn = (label: string, title: string, on: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.addEventListener('click', on);
      tools.append(b);
    };
    btn('+', 'Zoom in', () => this.zoom(0.8));
    btn('−', 'Zoom out', () => this.zoom(1.25));
    btn('⌂', 'Reset view', () => {
      this.cam = { ...HOME };
      this.center = [0, 0, 0];
      this.R = 8;
      this.rebuild();
    });
    this.stage.append(tools);
    this.root.append(this.stage, this.note, this.summary);
    if (!this.gl) this.fallback('WebGL isn’t available here, so 3D is drawn with a simpler renderer.');
    this.root.dataset.renderer = this.gl ? 'webgl2' : 'canvas';
    this.bind();
    let pending = 0;
    this.observer = new ResizeObserver(() => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => this.resize());
    });
    this.observer.observe(this.stage);
  }

  private initGl(gl: WebGL2RenderingContext): void {
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(prog, 0, 'a_pos');
    gl.bindAttribLocation(prog, 1, 'a_nrm');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
    for (const k of ['rot', 'proj', 'dist', 'color', 'lit', 'light']) this.u[k] = gl.getUniformLocation(prog, `u_${k}`);
    this.lineVao = gl.createVertexArray();
    this.lineBuf = gl.createBuffer();
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.vertexAttrib3f(1, 0, 0, 1);
    gl.bindVertexArray(null);
    this.gl = gl;
    this.prog = prog;
  }

  private fallback(message: string): void {
    this.gl = null;
    this.glCanvas?.remove();
    this.glCanvas = null;
    for (const b of this.built.values()) b.gl = undefined;
    this.note.textContent = message;
    this.note.hidden = false;
    this.root.dataset.renderer = 'canvas';
    this.request();
  }

  setSettings(s: Partial<ViewSettings>): void {
    this.settings = { ...s };
    this.request();
  }

  /** Replaces what is drawn. Geometry is reused for items that haven't changed. */
  set(items: Scene3DItem[], env: Record<string, number>): void {
    this.items = items;
    this.env = { ...env };
    this.rebuild();
  }

  /** Slider values changed: resample what depends on them. */
  setParams(env: Record<string, number>): void {
    this.env = { ...env };
    this.rebuild();
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.work);
    this.observer.disconnect();
    this.root.remove();
  }

  private get box(): Box3 {
    const [cx, cy, cz] = this.center as [number, number, number];
    const R = this.R;
    return { x: [cx - R, cx + R], y: [cy - R, cy + R], z: [cz - R, cz + R] };
  }

  private rebuild(): void {
    const envKey = JSON.stringify(this.env);
    const boxKey = `${this.center.join(',')}|${this.R}`;
    const next = new Map<Scene3DItem, Built>();
    const nextCache = new Map<string, Built>();
    this.items.forEach((s, i) => {
      // Items are rebuilt whenever rows re-parse (new closures), so key on label, kind, index, env and box.
      const key = `${i}|${s.item.kind}|${s.item.id}|${s.item.label}|${s.extend}|${envKey}|${boxKey}`;
      let b = this.cache.get(key);
      if (!b) b = this.build(s, key);
      next.set(s, b);
      nextCache.set(key, b);
    });
    // Free GPU buffers no longer used.
    for (const [k, b] of this.cache) if (!nextCache.has(k)) this.freeGl(b);
    this.cache = nextCache;
    this.built = next;
    this.root.dataset.items = String(this.items.length);
    this.describe();
    this.schedule();
    this.request();
  }

  private freeGl(b: Built): void {
    if (!b.gl || !this.gl) return;
    this.gl.deleteVertexArray(b.gl.vao);
    for (const buf of b.gl.bufs) this.gl.deleteBuffer(buf);
    b.gl = undefined;
  }

  private build(s: Scene3DItem, key: string): Built {
    const it = s.item;
    const env = this.env;
    const box = this.box;
    const b: Built = { key };
    const vp = { xMin: box.x[0], xMax: box.x[1], yMin: box.y[0], yMax: box.y[1] };
    const flat = (lines: Float64Array[]) => lines.map((p) => {
      const q = new Float64Array((p.length / 2) * 3);
      for (let i = 0, j = 0; i < p.length; i += 2, j += 3) {
        q[j] = p[i]!;
        q[j + 1] = p[i + 1]!;
        q[j + 2] = 0;
      }
      return q;
    });
    const flatCurve = (lines: Float64Array[]) => {
      if (s.extend) b.mesh = extrudeMesh(lines, box.z[0], box.z[1]);
      else b.lines = flat(lines);
    };
    try {
      switch (it.kind) {
        case 'surface':
          b.mesh = surfaceMesh(it.f, env, box, this.gl ? 64 : 36);
          break;
        case 'psurface':
          b.mesh = paramSurfaceMesh(it.fx, it.fy, it.fz, env, it.u, it.v, this.gl ? 64 : 36);
          break;
        case 'implicit3d':
          b.pending = marchingCubesSteps(it.F, env, box, this.gl ? 40 : 24);
          break;
        case 'curve3d':
          b.lines = curve3d(it.fx, it.fy, it.fz, env, it.range);
          break;
        case 'point3d':
          b.points = [it.x(env), it.y(env), it.z(env)];
          break;
        case 'vector3d':
          b.arrows = [[...it.from.map((f) => f(env)), ...it.to.map((f) => f(env))]];
          break;
        case 'explicit':
          flatCurve(sampleExplicit(it.f, env, vp, 600, it.domain));
          break;
        case 'xOfY':
          flatCurve(sampleXofY(it.f, env, vp, 600));
          break;
        case 'parametric':
          flatCurve(sampleParametric(it.fx, it.fy, env, it.range, vp));
          break;
        case 'polar':
          flatCurve(samplePolar(it.r, env, it.range, vp));
          break;
        case 'implicit': {
          if (it.op !== '=') break;
          const seg = marchImplicit(it.F, env, vp, 120, 120).segments;
          const lines: Float64Array[] = [];
          for (let i = 0; i < seg.length; i += 4) lines.push(seg.subarray(i, i + 4));
          flatCurve(lines);
          break;
        }
        case 'point':
          b.points = [it.x(env), it.y(env), 0];
          break;
        case 'scatter': {
          const p: number[] = [];
          for (let i = 0; i < it.points.length; i += 2) p.push(it.points[i]!, it.points[i + 1]!, 0);
          b.points = p;
          break;
        }
        case 'vector':
          b.arrows = [[it.x0(env), it.y0(env), 0, it.x1(env), it.y1(env), 0]];
          break;
      }
    } catch {
      // A row that can't be sampled draws nothing.
    }
    if (b.mesh) this.upload(b);
    return b;
  }

  /** Marching cubes for implicit surfaces runs a slab at a time, ~8 ms per frame, so the page never stalls. */
  private schedule(): void {
    cancelAnimationFrame(this.work);
    const pending = [...this.built.values()].filter((b) => b.pending);
    if (!pending.length) {
      delete this.root.dataset.working;
      return;
    }
    this.root.dataset.working = '1';
    this.work = requestAnimationFrame(() => {
      const t0 = performance.now();
      for (const b of pending) {
        while (b.pending && performance.now() - t0 < 8) {
          const r = b.pending.next();
          if (r.done) {
            b.pending = undefined;
            b.mesh = r.value;
            this.upload(b);
            this.request();
          }
        }
      }
      this.schedule();
    });
  }

  private upload(b: Built): void {
    const gl = this.gl;
    if (!gl || !b.mesh || !b.mesh.idx.length) return;
    this.freeGl(b);
    const [cx, cy, cz] = this.center as [number, number, number];
    const R = this.R;
    const pos = new Float32Array(b.mesh.pos.length);
    for (let i = 0; i < pos.length; i += 3) {
      pos[i] = (b.mesh.pos[i]! - cx) / R;
      pos[i + 1] = (b.mesh.pos[i + 1]! - cy) / R;
      pos[i + 2] = (b.mesh.pos[i + 2]! - cz) / R;
    }
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const pb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, pb);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const nb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, nb);
    gl.bufferData(gl.ARRAY_BUFFER, b.mesh.nrm, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, b.mesh.idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    b.gl = { vao, n: b.mesh.idx.length, bufs: [pb, nb, ib] };
  }

  private describe(): void {
    const names = this.items.map((s) => s.item.label);
    const [x0, x1] = this.box.x;
    this.summary.textContent = names.length ? `3D graph of ${names.join('; ')}, in a box from ${fmt(x0)} to ${fmt(x1)} on each axis.` : 'Empty 3D graph.';
  }

  // ---------- interaction ----------
  private zoom(f: number): void {
    this.R = Math.min(1e4, Math.max(0.05, this.R * f));
    this.rebuild();
  }

  private rotate(dyaw: number, dpitch: number): void {
    this.cam.yaw += dyaw;
    this.cam.pitch = Math.min(1.5, Math.max(-1.5, this.cam.pitch + dpitch));
    this.request();
  }

  private panPx(dx: number, dy: number): void {
    const k = this.R / this.scale;
    const cy = Math.cos(this.cam.yaw);
    const sy = Math.sin(this.cam.yaw);
    this.center[0]! -= dx * k * cy;
    this.center[1]! += dx * k * sy;
    this.center[2]! += dy * k * Math.cos(this.cam.pitch);
    this.rebuild();
  }

  private bind(): void {
    const c = this.canvas;
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom(Math.exp(e.deltaY * 0.0015));
    }, { passive: false });
    let shift = false;
    let moved = 0;
    c.addEventListener('pointerdown', (e) => {
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        // A synthetic or already-released pointer.
      }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      shift = e.shiftKey || e.button === 2;
      moved = 0;
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      const r = c.getBoundingClientRect();
      if (!prev) {
        if (e.pointerType === 'mouse') {
          this.hover = { x: e.clientX - r.left, y: e.clientY - r.top, r: 14 };
          this.request();
        }
        return;
      }
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const before = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        const mid0 = [(a!.x + b!.x) / 2, (a!.y + b!.y) / 2];
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a2, b2] = [...this.pointers.values()];
        const after = Math.hypot(a2!.x - b2!.x, a2!.y - b2!.y);
        const mid1 = [(a2!.x + b2!.x) / 2, (a2!.y + b2!.y) / 2];
        if (before > 0 && after > 0 && Math.abs(after - before) > 1) this.zoom(before / after);
        else this.panPx(mid1[0]! - mid0[0]!, mid1[1]! - mid0[1]!);
        return;
      }
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      moved += Math.abs(dx) + Math.abs(dy);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (shift) this.panPx(dx, dy);
      else this.rotate(-dx * 0.01, dy * 0.01);
      this.hover = null;
    });
    const up = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      if (this.pointers.has(e.pointerId) && moved < 6 && this.pointers.size === 1) {
        // A tap or click shows the coordinates of what's under it.
        this.pick = this.nearest(e.clientX - r.left, e.clientY - r.top, e.pointerType === 'mouse' ? 16 : 30);
        this.request();
      }
      this.pointers.delete(e.pointerId);
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', (e) => this.pointers.delete(e.pointerId));
    c.addEventListener('pointerleave', () => {
      this.hover = null;
      this.request();
    });
    c.addEventListener('keydown', (e) => {
      const s = e.shiftKey;
      const keys: Record<string, () => void> = {
        ArrowLeft: () => (s ? this.panPx(30, 0) : this.rotate(0.12, 0)),
        ArrowRight: () => (s ? this.panPx(-30, 0) : this.rotate(-0.12, 0)),
        ArrowUp: () => (s ? this.panPx(0, 30) : this.rotate(0, 0.08)),
        ArrowDown: () => (s ? this.panPx(0, -30) : this.rotate(0, -0.08)),
        '+': () => this.zoom(0.8),
        '=': () => this.zoom(0.8),
        '-': () => this.zoom(1.25),
        Home: () => {
          this.cam = { ...HOME };
          this.request();
        },
        Escape: () => {
          this.pick = null;
          this.request();
        },
      };
      const k = keys[e.key];
      if (k) {
        e.preventDefault();
        k();
      }
    });
  }

  // ---------- projection ----------
  private get scale(): number {
    return this.cam.zoom * Math.min(this.w, this.h) * 0.3;
  }

  /** World → [screen x, screen y, depth]. */
  private project(x: number, y: number, z: number): [number, number, number] {
    const [cx, cy0, cz] = this.center as [number, number, number];
    const bx = (x - cx) / this.R;
    const by = (y - cy0) / this.R;
    const bz = (z - cz) / this.R;
    const cy = Math.cos(this.cam.yaw);
    const sy = Math.sin(this.cam.yaw);
    const cp = Math.cos(this.cam.pitch);
    const sp = Math.sin(this.cam.pitch);
    const x1 = bx * cy - by * sy;
    const y1 = bx * sy + by * cy;
    const up = y1 * sp + bz * cp;
    const d = DIST + y1 * cp - bz * sp;
    const k = (this.scale * DIST) / d;
    return [this.w / 2 + x1 * k, this.h / 2 - up * k, d];
  }

  private inBox(x: number, y: number, z: number): boolean {
    const b = this.box;
    const e = this.R * 0.002;
    return x >= b.x[0] - e && x <= b.x[1] + e && y >= b.y[0] - e && y <= b.y[1] + e && z >= b.z[0] - e && z <= b.z[1] + e;
  }

  /** The front-most drawn point near a screen position: a mesh vertex, a curve sample or a point. */
  private nearest(px: number, py: number, radius: number): { x: number; y: number; z: number } | null {
    let best: { x: number; y: number; z: number; d: number } | null = null;
    const consider = (x: number, y: number, z: number) => {
      if (!this.inBox(x, y, z)) return;
      const [sx, sy, d] = this.project(x, y, z);
      if (Math.hypot(sx - px, sy - py) > radius) return;
      if (!best || d < best.d) best = { x, y, z, d };
    };
    for (const b of this.built.values()) {
      if (b.mesh) for (let i = 0; i < b.mesh.pos.length; i += 3) consider(b.mesh.pos[i]!, b.mesh.pos[i + 1]!, b.mesh.pos[i + 2]!);
      for (const l of b.lines ?? []) for (let i = 0; i < l.length; i += 3) consider(l[i]!, l[i + 1]!, l[i + 2]!);
      const p = b.points ?? [];
      for (let i = 0; i < p.length; i += 3) consider(p[i]!, p[i + 1]!, p[i + 2]!);
      for (const a of b.arrows ?? []) consider(a[3]!, a[4]!, a[5]!);
    }
    return best;
  }

  // ---------- drawing ----------
  private resize(): void {
    const r = this.stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    for (const cv of [this.canvas, this.glCanvas]) {
      if (!cv) continue;
      cv.width = Math.round(this.w * dpr);
      cv.height = Math.round(this.h * dpr);
      cv.style.width = `${this.w}px`;
      cv.style.height = `${this.h}px`;
    }
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.request();
  }

  private request(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.render());
  }

  private render(): void {
    if (!this.w || !this.h) return;
    const cs = getComputedStyle(document.documentElement);
    const bgCss = this.settings.bg || cs.getPropertyValue('--surface').trim() || '#fff';
    const lineCss = cs.getPropertyValue('--line').trim() || '#ccc';
    const muted = cs.getPropertyValue('--muted').trim() || '#666';
    const ink = cs.getPropertyValue('--ink').trim() || '#000';
    const ctx = this.ctx;
    if (this.gl) this.drawGl(rgb(bgCss), rgb(lineCss));
    if (!ctx) return;
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.gl) {
      ctx.fillStyle = bgCss;
      ctx.fillRect(0, 0, this.w, this.h);
      this.paintBox(ctx, lineCss);
      this.paintMeshes(ctx);
    }
    this.paintOverlay(ctx, muted, ink, bgCss);
    this.root.dataset.view = `${this.cam.yaw.toFixed(2)} ${this.cam.pitch.toFixed(2)} ${this.R.toFixed(2)}`;
  }

  private gridLines(): Float32Array {
    // Box edges, plus a floor grid.
    const v: number[] = [];
    const c = [-1, 1];
    for (const a of c) for (const b of c) {
      v.push(-1, a, b, 1, a, b);
      v.push(a, -1, b, a, 1, b);
      v.push(a, b, -1, a, b, 1);
    }
    if (this.settings.grid !== false) {
      const step = niceStep(2 * this.R, 8) / this.R;
      const [cx, cy] = this.center as [number, number, number];
      for (let t = Math.ceil((-1 + cx / this.R) / step) * step - cx / this.R; t <= 1; t += step) v.push(t, -1, -1, t, 1, -1);
      for (let t = Math.ceil((-1 + cy / this.R) / step) * step - cy / this.R; t <= 1; t += step) v.push(-1, t, -1, 1, t, -1);
    }
    return Float32Array.from(v);
  }

  private drawGl(bg: [number, number, number], line: [number, number, number]): void {
    const gl = this.gl!;
    const dpr = window.devicePixelRatio || 1;
    gl.viewport(0, 0, Math.round(this.w * dpr), Math.round(this.h * dpr));
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog);
    const u = this.u;
    gl.uniform4f(u.rot!, Math.cos(this.cam.yaw), Math.sin(this.cam.yaw), Math.cos(this.cam.pitch), Math.sin(this.cam.pitch));
    gl.uniform4f(u.proj!, (this.scale * DIST) / (this.w / 2), (this.scale * DIST) / (this.h / 2), (FAR + NEAR) / (FAR - NEAR), (-2 * FAR * NEAR) / (FAR - NEAR));
    gl.uniform1f(u.dist!, DIST);
    const ll = Math.hypot(L[0]!, L[1]!, L[2]!);
    gl.uniform3f(u.light!, L[0]! / ll, L[1]! / ll, L[2]! / ll);
    // Box and floor grid.
    const lines = this.gridLines();
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, lines, gl.DYNAMIC_DRAW);
    gl.uniform1i(u.lit!, 0);
    gl.uniform4f(u.color!, line[0], line[1], line[2], 1);
    gl.drawArrays(gl.LINES, 0, lines.length / 3);
    // Opaque meshes, then translucent ones without writing depth.
    const draw = (translucent: boolean) => {
      gl.depthMask(!translucent);
      gl.uniform1i(u.lit!, 1);
      for (const [s, b] of this.built) {
        if (!b.gl || (s.opacity < 0.999) !== translucent) continue;
        const c = rgb(s.color);
        gl.uniform4f(u.color!, c[0], c[1], c[2], s.opacity);
        gl.bindVertexArray(b.gl.vao);
        gl.drawElements(gl.TRIANGLES, b.gl.n, gl.UNSIGNED_INT, 0);
      }
      gl.depthMask(true);
    };
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);
    draw(false);
    draw(true);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindVertexArray(null);
  }

  private paintBox(ctx: CanvasRenderingContext2D, line: string): void {
    const g = this.gridLines();
    const [cx, cy, cz] = this.center as [number, number, number];
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < g.length; i += 6) {
      const a = this.project(g[i]! * this.R + cx, g[i + 1]! * this.R + cy, g[i + 2]! * this.R + cz);
      const b = this.project(g[i + 3]! * this.R + cx, g[i + 4]! * this.R + cy, g[i + 5]! * this.R + cz);
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke();
  }

  /** Canvas fallback: every triangle of every mesh, far to near, lit like the GPU path. */
  private paintMeshes(ctx: CanvasRenderingContext2D): void {
    const tris: { d: number; pts: number[]; fill: string; alpha: number }[] = [];
    const ll = Math.hypot(L[0]!, L[1]!, L[2]!);
    for (const [s, b] of this.built) {
      const m = b.mesh;
      if (!m) continue;
      const base = rgb(s.color);
      for (let t = 0; t < m.idx.length; t += 3) {
        const ia = m.idx[t]! * 3;
        const ib = m.idx[t + 1]! * 3;
        const ic = m.idx[t + 2]! * 3;
        const P = [ia, ib, ic].map((k) => [m.pos[k]!, m.pos[k + 1]!, m.pos[k + 2]!] as [number, number, number]);
        if (!P.every((p) => this.inBox(...p))) continue;
        const S = P.map((p) => this.project(...p));
        const nx = (m.nrm[ia]! + m.nrm[ib]! + m.nrm[ic]!) / 3;
        const ny = (m.nrm[ia + 1]! + m.nrm[ib + 1]! + m.nrm[ic + 1]!) / 3;
        const nz = (m.nrm[ia + 2]! + m.nrm[ib + 2]! + m.nrm[ic + 2]!) / 3;
        const l = Math.abs((nx * L[0]! + ny * L[1]! + nz * L[2]!) / ((Math.hypot(nx, ny, nz) || 1) * ll));
        const k = 0.42 + 0.58 * l;
        tris.push({ d: S[0]![2] + S[1]![2] + S[2]![2], pts: S.flatMap((p) => [p[0], p[1]]), fill: `rgb(${(base[0] * k * 255) | 0},${(base[1] * k * 255) | 0},${(base[2] * k * 255) | 0})`, alpha: s.opacity });
      }
    }
    tris.sort((a, b) => b.d - a.d);
    for (const t of tris) {
      ctx.globalAlpha = t.alpha;
      ctx.beginPath();
      ctx.moveTo(t.pts[0]!, t.pts[1]!);
      ctx.lineTo(t.pts[2]!, t.pts[3]!);
      ctx.lineTo(t.pts[4]!, t.pts[5]!);
      ctx.closePath();
      ctx.fillStyle = t.fill;
      ctx.strokeStyle = t.fill;
      ctx.lineWidth = 0.6;
      ctx.fill();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Curves, points, vectors, axis labels and the coordinate readout, on top. */
  private paintOverlay(ctx: CanvasRenderingContext2D, muted: string, ink: string, bg: string): void {
    for (const [s, b] of this.built) {
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.globalAlpha = s.opacity;
      ctx.beginPath();
      for (const l of b.lines ?? []) {
        let pen = false;
        for (let i = 0; i < l.length; i += 3) {
          if (!this.inBox(l[i]!, l[i + 1]!, l[i + 2]!)) {
            pen = false;
            continue;
          }
          const [x, y] = this.project(l[i]!, l[i + 1]!, l[i + 2]!);
          if (pen) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
          pen = true;
        }
      }
      ctx.stroke();
      const p = b.points ?? [];
      for (let i = 0; i < p.length; i += 3) {
        if (!this.inBox(p[i]!, p[i + 1]!, p[i + 2]!)) continue;
        const [x, y] = this.project(p[i]!, p[i + 1]!, p[i + 2]!);
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const a of b.arrows ?? []) {
        const [x0, y0] = this.project(a[0]!, a[1]!, a[2]!);
        const [x1, y1] = this.project(a[3]!, a[4]!, a[5]!);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        const ang = Math.atan2(y1 - y0, x1 - x0);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - 12 * Math.cos(ang - 0.4), y1 - 12 * Math.sin(ang - 0.4));
        ctx.lineTo(x1 - 12 * Math.cos(ang + 0.4), y1 - 12 * Math.sin(ang + 0.4));
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // Axis names at the box edges nearest the viewer, with their ranges.
    const b = this.box;
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = muted;
    ctx.textAlign = 'center';
    const lab = (t: string, x: number, y: number, z: number) => {
      const [sx, sy] = this.project(x, y, z);
      ctx.fillText(t, sx, sy);
    };
    const yNear = this.project(0, b.y[0], b.z[0])[2] < this.project(0, b.y[1], b.z[0])[2] ? b.y[0] : b.y[1];
    const xNear = this.project(b.x[0], 0, b.z[0])[2] < this.project(b.x[1], 0, b.z[0])[2] ? b.x[0] : b.x[1];
    const midX = (b.x[0] + b.x[1]) / 2;
    const midY = (b.y[0] + b.y[1]) / 2;
    const out = 1.12;
    lab(`x  ${fmt(b.x[0])} … ${fmt(b.x[1])}`, midX, midY + (yNear - midY) * out, b.z[0]);
    lab(`y  ${fmt(b.y[0])} … ${fmt(b.y[1])}`, midX + (xNear - midX) * out, midY, b.z[0]);
    lab(`z  ${fmt(b.z[0])} … ${fmt(b.z[1])}`, xNear, yNear, b.z[1] + this.R * 0.08);
    // Coordinates of the picked (or hovered) point.
    this.tip.hidden = true;
    const target = this.hover ? this.nearest(this.hover.x, this.hover.y, this.hover.r) : this.pick;
    if (target) {
      const [sx, sy] = this.project(target.x, target.y, target.z);
      ctx.beginPath();
      ctx.arc(sx, sy, 5, 0, Math.PI * 2);
      ctx.fillStyle = ink;
      ctx.fill();
      ctx.strokeStyle = bg;
      ctx.lineWidth = 2;
      ctx.stroke();
      this.tip.innerHTML = `<b>(${fmt(target.x)}, ${fmt(target.y)}, ${fmt(target.z)})</b>`;
      this.tip.hidden = false;
      const left = Math.min(Math.max(sx + 12, 4), this.w - 170);
      const top = sy < 60 ? sy + 14 : sy - 40;
      this.tip.style.transform = `translate(${left}px, ${top}px)`;
      this.root.dataset.trace = `${fmt(target.x)},${fmt(target.y)},${fmt(target.z)}`;
    } else delete this.root.dataset.trace;
  }

  exportPng(): void {
    const dpr = window.devicePixelRatio || 1;
    const out = document.createElement('canvas');
    out.width = Math.round(this.w * dpr);
    out.height = Math.round(this.h * dpr);
    const o = out.getContext('2d');
    if (!o) return;
    this.render();
    if (this.glCanvas) o.drawImage(this.glCanvas, 0, 0);
    o.drawImage(this.canvas, 0, 0);
    const a = document.createElement('a');
    a.download = 'lemma-graph-3d.png';
    a.href = out.toDataURL('image/png');
    a.click();
  }
}
