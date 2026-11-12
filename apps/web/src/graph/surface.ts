import { sampleSurface, type GraphItem, type SurfaceGrid } from '@lemma/graph-engine';

/**
 * 3D surface view for z = f(x, y), loaded as its own chunk the first time a surface is graphed. Plain WebGL2 with
 * a hand-written projection (no 3D library); when WebGL2 is missing or its context is lost, the same projection
 * drives a Canvas 2D painter's-algorithm renderer, and a note says so. Drag to rotate, wheel or pinch to zoom,
 * arrow keys to rotate, + − to zoom, Home to reset. Gliding after a flick is skipped under reduced motion.
 */

type SurfaceItem = Extract<GraphItem, { kind: 'surface' }>;

const N = 60; // grid cells per side
const ZS = 0.8; // half-height of the box, relative to its half-width
const DIST = 4.2; // camera distance, in box half-widths
const NEAR = DIST - 2.5;
const FAR = DIST + 2.5;
const HOME = { yaw: -0.65, pitch: 0.5, zoom: 1 };

// Height colours, low → high (a perceptually even blue–green–yellow ramp that reads on light and dark).
const RAMP: [number, number, number][] = [
  [0.27, 0.0, 0.33],
  [0.23, 0.32, 0.55],
  [0.13, 0.57, 0.55],
  [0.37, 0.79, 0.38],
  [0.99, 0.91, 0.14],
];
function ramp(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - i;
  const a = RAMP[i]!;
  const b = RAMP[i + 1]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
const RAMP_CSS = `linear-gradient(to right, ${RAMP.map((c, i) => `rgb(${c.map((v) => Math.round(v * 255)).join(' ')}) ${(i / (RAMP.length - 1)) * 100}%`).join(', ')})`;

function fmt(v: number): string {
  if (v === 0 || !Number.isFinite(v)) return String(v === 0 ? 0 : v);
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) return v.toExponential(2).replace(/\.?0+e/, 'e');
  return String(Number(v.toPrecision(4)));
}

/** Any CSS colour → [r, g, b] in 0–1, via the canvas's own colour parser. */
let probe: CanvasRenderingContext2D | null = null;
export function rgb(css: string): [number, number, number] {
  probe ??= document.createElement('canvas').getContext('2d');
  if (!probe) return [1, 1, 1];
  probe.fillStyle = '#000';
  probe.fillStyle = css;
  const v = String(probe.fillStyle);
  if (v.startsWith('#')) {
    const n = parseInt(v.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const m = v.match(/[\d.]+/g)?.map(Number) ?? [255, 255, 255];
  return [(m[0] ?? 255) / 255, (m[1] ?? 255) / 255, (m[2] ?? 255) / 255];
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'calm';

interface Mesh {
  grid: SurfaceGrid;
  /** Box coordinates per vertex: x, y in [−1, 1], z in [−ZS, ZS]; NaN where undefined. */
  pos: Float32Array;
  col: Float32Array;
  tris: Uint16Array;
  lines: Uint16Array;
}

function buildMesh(item: SurfaceItem, env: Record<string, number>): Mesh {
  const grid = sampleSurface(item.f, env, item.x, item.y, N);
  const side = N + 1;
  const pos = new Float32Array(side * side * 3);
  const col = new Float32Array(side * side * 3);
  const zr = grid.zMax - grid.zMin;
  const Z = (k: number) => {
    const z = grid.z[k]!;
    return Number.isNaN(z) ? NaN : ((Math.min(grid.zMax, Math.max(grid.zMin, z)) - grid.zMin) / zr) * 2 * ZS - ZS;
  };
  // A fixed light in world space, so shading is baked once and rotating costs nothing.
  const L = [-0.35, -0.55, 0.76];
  const ll = Math.hypot(L[0]!, L[1]!, L[2]!);
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const k = j * side + i;
      const z = Z(k);
      pos[k * 3] = (i / N) * 2 - 1;
      pos[k * 3 + 1] = (j / N) * 2 - 1;
      pos[k * 3 + 2] = Number.isNaN(z) ? 0 : z;
      const zl = Z(j * side + Math.max(0, i - 1));
      const zrr = Z(j * side + Math.min(N, i + 1));
      const zd = Z(Math.max(0, j - 1) * side + i);
      const zu = Z(Math.min(N, j + 1) * side + i);
      const h = 2 / N;
      const dx = (Number.isNaN(zrr) || Number.isNaN(zl) ? 0 : zrr - zl) / ((Math.min(N, i + 1) - Math.max(0, i - 1)) * h);
      const dy = (Number.isNaN(zu) || Number.isNaN(zd) ? 0 : zu - zd) / ((Math.min(N, j + 1) - Math.max(0, j - 1)) * h);
      const nl = Math.hypot(dx, dy, 1);
      const lambert = Math.abs((-dx * L[0]! - dy * L[1]! + L[2]!) / (nl * ll));
      const shade = 0.55 + 0.45 * lambert;
      const c = ramp(Number.isNaN(z) ? 0 : (z + ZS) / (2 * ZS));
      col[k * 3] = c[0] * shade;
      col[k * 3 + 1] = c[1] * shade;
      col[k * 3 + 2] = c[2] * shade;
      if (Number.isNaN(z)) pos[k * 3 + 2] = NaN;
    }
  }
  const ok = (k: number) => !Number.isNaN(pos[k * 3 + 2]!);
  const tris: number[] = [];
  const lines: number[] = [];
  const step = N / 12;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * side + i;
      const b = a + 1;
      const c = a + side + 1;
      const d = a + side;
      if (ok(a) && ok(b) && ok(c)) tris.push(a, b, c);
      if (ok(a) && ok(c) && ok(d)) tris.push(a, c, d);
    }
  }
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const a = j * side + i;
      if (j % step === 0 && i < N && ok(a) && ok(a + 1)) lines.push(a, a + 1);
      if (i % step === 0 && j < N && ok(a) && ok(a + side)) lines.push(a, a + side);
    }
  }
  // NaN positions would poison the GPU buffer; undefined vertices are never referenced, so park them at 0.
  for (let k = 0; k < side * side; k++) if (!ok(k)) pos[k * 3 + 2] = 0;
  return { grid, pos, col, tris: Uint16Array.from(tris), lines: Uint16Array.from(lines) };
}

// The 12 edges of the box, as corner indices (0–3 the floor, 4–7 the top, in the same order).
const BOX = new Float32Array([-1, -1, -ZS, 1, -1, -ZS, 1, 1, -ZS, -1, 1, -ZS, -1, -1, ZS, 1, -1, ZS, 1, 1, ZS, -1, 1, ZS]);
const BOX_EDGES = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];

/** The box edges behind the surface: all but those touching the top corner and the vertical edge nearest the viewer. */
function backEdges(nearest: number): Uint16Array {
  const out: number[] = [];
  for (let e = 0; e < BOX_EDGES.length; e += 2) {
    const a = BOX_EDGES[e]!;
    const b = BOX_EDGES[e + 1]!;
    if (a === nearest + 4 || b === nearest + 4) continue;
    out.push(a, b);
  }
  return Uint16Array.from(out);
}

const VERT = `#version 300 es
in vec3 a_pos;
in vec3 a_col;
uniform vec4 u_rot;   // cos yaw, sin yaw, cos pitch, sin pitch
uniform vec4 u_proj;  // x scale, y scale, depth A, depth B
uniform float u_dist;
out vec3 v_col;
void main() {
  float x1 = a_pos.x * u_rot.x - a_pos.y * u_rot.y;
  float y1 = a_pos.x * u_rot.y + a_pos.y * u_rot.x;
  float up = y1 * u_rot.w + a_pos.z * u_rot.z;
  float d = u_dist + y1 * u_rot.z - a_pos.z * u_rot.w;
  gl_Position = vec4(x1 * u_proj.x, up * u_proj.y, u_proj.z * d + u_proj.w, d);
  v_col = a_col;
}`;
const FRAG = `#version 300 es
precision mediump float;
in vec3 v_col;
uniform vec4 u_color;
uniform bool u_flat;
out vec4 o;
void main() { o = u_flat ? u_color : vec4(v_col, 1.0); }`;

class GlRenderer {
  private prog: WebGLProgram;
  private surf: WebGLVertexArrayObject;
  private box: WebGLVertexArrayObject;
  private posBuf: WebGLBuffer;
  private colBuf: WebGLBuffer;
  private triBuf: WebGLBuffer;
  private lineBuf: WebGLBuffer;
  private boxIdx: WebGLBuffer;
  private nTris = 0;
  private nLines = 0;
  private u: Record<'rot' | 'proj' | 'dist' | 'color' | 'flat', WebGLUniformLocation | null>;

  constructor(private gl: WebGL2RenderingContext) {
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const prog = (this.prog = gl.createProgram()!);
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(prog, 0, 'a_pos');
    gl.bindAttribLocation(prog, 1, 'a_col');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
    this.u = {
      rot: gl.getUniformLocation(prog, 'u_rot'),
      proj: gl.getUniformLocation(prog, 'u_proj'),
      dist: gl.getUniformLocation(prog, 'u_dist'),
      color: gl.getUniformLocation(prog, 'u_color'),
      flat: gl.getUniformLocation(prog, 'u_flat'),
    };
    this.posBuf = gl.createBuffer()!;
    this.colBuf = gl.createBuffer()!;
    this.triBuf = gl.createBuffer()!;
    this.lineBuf = gl.createBuffer()!;
    this.surf = gl.createVertexArray()!;
    gl.bindVertexArray(this.surf);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    this.box = gl.createVertexArray()!;
    gl.bindVertexArray(this.box);
    const boxBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, boxBuf);
    gl.bufferData(gl.ARRAY_BUFFER, BOX, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    this.boxIdx = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.boxIdx);
    gl.bindVertexArray(null);
  }

  upload(m: Mesh): void {
    const { gl } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, m.pos, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf);
    gl.bufferData(gl.ARRAY_BUFFER, m.col, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.triBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.tris, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.lineBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.lines, gl.DYNAMIC_DRAW);
    this.nTris = m.tris.length;
    this.nLines = m.lines.length;
  }

  draw(cam: { yaw: number; pitch: number }, edges: Uint16Array, s: number, w: number, h: number, dpr: number, theme: { bg: [number, number, number]; line: [number, number, number]; ink: [number, number, number] }): void {
    const { gl, u } = this;
    gl.viewport(0, 0, Math.round(w * dpr), Math.round(h * dpr));
    gl.clearColor(theme.bg[0], theme.bg[1], theme.bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog);
    gl.uniform4f(u.rot, Math.cos(cam.yaw), Math.sin(cam.yaw), Math.cos(cam.pitch), Math.sin(cam.pitch));
    gl.uniform4f(u.proj, (s * DIST) / (w / 2), (s * DIST) / (h / 2), (FAR + NEAR) / (FAR - NEAR), (-2 * FAR * NEAR) / (FAR - NEAR));
    gl.uniform1f(u.dist, DIST);
    // Box first (depth-tested, so the surface hides the edges behind it).
    gl.bindVertexArray(this.box);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.boxIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, edges, gl.DYNAMIC_DRAW);
    gl.uniform1i(u.flat, 1);
    gl.uniform4f(u.color, theme.line[0], theme.line[1], theme.line[2], 1);
    gl.drawElements(gl.LINES, edges.length, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(this.surf);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);
    gl.uniform1i(u.flat, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.triBuf);
    gl.drawElements(gl.TRIANGLES, this.nTris, gl.UNSIGNED_SHORT, 0);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.uniform1i(u.flat, 1);
    gl.uniform4f(u.color, theme.ink[0] * 0.15, theme.ink[1] * 0.15, theme.ink[2] * 0.15, 0.35);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.lineBuf);
    gl.drawElements(gl.LINES, this.nLines, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  }
}

export class SurfaceView {
  readonly root: HTMLElement;
  private stage: HTMLElement;
  private glCanvas: HTMLCanvasElement | null = null;
  private gl: GlRenderer | null = null;
  /** Labels and axes (WebGL mode), or everything (Canvas 2D mode). */
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private note: HTMLElement;
  private keyMin: HTMLElement;
  private keyMax: HTMLElement;
  private summary: HTMLElement;
  private item!: SurfaceItem;
  private mesh!: Mesh;
  private meshKey = '';
  private cam = { ...HOME };
  private spin = { yaw: 0, pitch: 0 };
  private w = 0;
  private h = 0;
  private frame = 0;
  private glide = 0;
  private pointers = new Map<number, { x: number; y: number; t: number }>();
  private observer: ResizeObserver;

  constructor(item: SurfaceItem, env: Record<string, number>) {
    this.root = document.createElement('div');
    this.root.className = 'surface3d';
    this.stage = document.createElement('div');
    this.stage.className = 'graph-stage';
    this.canvas = document.createElement('canvas');
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'img');
    this.note = document.createElement('p');
    this.note.className = 'surface-note';
    this.note.setAttribute('role', 'status');
    this.note.hidden = true;

    // WebGL2 when available; otherwise the Canvas 2D renderer below, with a note.
    const glc = document.createElement('canvas');
    glc.setAttribute('aria-hidden', 'true');
    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = glc.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true });
      if (gl) this.gl = new GlRenderer(gl);
    } catch {
      this.gl = null;
    }
    if (this.gl) {
      this.glCanvas = glc;
      glc.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        this.fallback('The graphics context was lost, so the surface is now drawn with a simpler 2D renderer.');
      });
      this.stage.append(glc);
    }
    this.ctx = this.canvas.getContext('2d');
    this.stage.append(this.canvas);
    if (!this.gl) this.fallback('WebGL isn’t available in this browser, so the surface is drawn with a simpler 2D renderer.');

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
    btn('+', 'Zoom in', () => this.zoomBy(1.25));
    btn('−', 'Zoom out', () => this.zoomBy(0.8));
    btn('⌂', 'Reset view', () => {
      this.stopGlide();
      this.cam = { ...HOME };
      this.request();
    });
    btn('⤓', 'Download PNG', () => this.exportPng());
    this.stage.append(tools);

    const key = document.createElement('div');
    key.className = 'surface-key';
    const zl = document.createElement('span');
    zl.className = 'surface-key-label';
    zl.textContent = 'z';
    this.keyMin = document.createElement('span');
    const bar = document.createElement('span');
    bar.className = 'surface-key-bar';
    bar.style.background = RAMP_CSS;
    this.keyMax = document.createElement('span');
    key.append(zl, this.keyMin, bar, this.keyMax);
    this.summary = document.createElement('p');
    this.summary.className = 'graph-summary';
    this.summary.id = `surface-summary-${Math.random().toString(36).slice(2, 8)}`;
    this.canvas.setAttribute('aria-describedby', this.summary.id);
    this.root.append(this.stage, this.note, key, this.summary);

    this.bind();
    this.update(item, env);
    let pending = 0;
    this.observer = new ResizeObserver(() => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => this.resize());
    });
    this.observer.observe(this.stage);
  }

  /** New function or slider values: re-sample (cheap) and redraw. */
  update(item: SurfaceItem, env: Record<string, number>): void {
    const key = `${item.label}|${item.x}|${item.y}|${JSON.stringify(env)}`;
    this.item = item;
    if (key !== this.meshKey) {
      this.meshKey = key;
      this.mesh = buildMesh(item, env);
      this.gl?.upload(this.mesh);
      this.describe();
    }
    this.request();
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.stopGlide();
    this.observer.disconnect();
    this.root.remove();
  }

  private fallback(message: string): void {
    this.gl = null;
    this.glCanvas?.remove();
    this.glCanvas = null;
    this.note.textContent = this.ctx ? message : 'This browser can’t draw 3D graphs.';
    this.note.hidden = false;
    this.root.dataset.renderer = this.ctx ? 'canvas' : 'none';
    this.request();
  }

  private describe(): void {
    const { grid } = this.mesh;
    const { label } = this.item;
    let lo = -1;
    let hi = -1;
    let gaps = 0;
    grid.z.forEach((z, k) => {
      if (Number.isNaN(z)) return gaps++;
      if (lo < 0 || z < grid.z[lo]!) lo = k;
      if (hi < 0 || z > grid.z[hi]!) hi = k;
    });
    const at = (k: number) => {
      const i = k % (N + 1);
      const j = Math.floor(k / (N + 1));
      return `x ≈ ${fmt(grid.x[0] + ((grid.x[1] - grid.x[0]) * i) / N)}, y ≈ ${fmt(grid.y[0] + ((grid.y[1] - grid.y[0]) * j) / N)}`;
    };
    const range = `x from ${fmt(grid.x[0])} to ${fmt(grid.x[1])} and y from ${fmt(grid.y[0])} to ${fmt(grid.y[1])}`;
    const parts = [`3D surface ${label} over ${range}.`];
    if (lo >= 0) parts.push(`Height ranges from ${fmt(grid.z[lo]!)} (at ${at(lo)}) to ${fmt(grid.z[hi]!)} (at ${at(hi)}).`);
    else parts.push('The function is undefined everywhere in this range.');
    if (gaps) parts.push(`It is undefined at ${gaps} of ${grid.z.length} sample points, shown as gaps.`);
    if (grid.clipped) parts.push(`Spikes beyond ${fmt(grid.zMin)} to ${fmt(grid.zMax)} are cut off.`);
    this.summary.textContent = parts.join(' ');
    this.canvas.setAttribute('aria-label', `3D surface ${label}. Drag or use the arrow keys to rotate; + and − zoom.`);
    this.keyMin.textContent = fmt(grid.zMin);
    this.keyMax.textContent = fmt(grid.zMax);
    this.root.dataset.renderer = this.gl ? 'webgl2' : this.ctx ? 'canvas' : 'none';
  }

  // ---------- interaction ----------
  private zoomBy(f: number): void {
    this.cam.zoom = Math.min(4, Math.max(0.35, this.cam.zoom * f));
    this.request();
  }

  private rotate(dyaw: number, dpitch: number): void {
    this.cam.yaw += dyaw;
    this.cam.pitch = Math.min(1.5, Math.max(-1.5, this.cam.pitch + dpitch));
    this.request();
  }

  private stopGlide(): void {
    cancelAnimationFrame(this.glide);
    this.glide = 0;
  }

  private bind(): void {
    const c = this.canvas;
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomBy(Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    c.addEventListener('pointerdown', (e) => {
      this.stopGlide();
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.timeStamp });
      this.spin = { yaw: 0, pitch: 0 };
    });
    c.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const before = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.timeStamp });
        const [a2, b2] = [...this.pointers.values()];
        const after = Math.hypot(a2!.x - b2!.x, a2!.y - b2!.y);
        if (before > 0 && after > 0) this.zoomBy(after / before);
        return;
      }
      const dyaw = -(e.clientX - prev.x) * 0.01;
      const dpitch = (e.clientY - prev.y) * 0.01;
      const dt = Math.max(1, e.timeStamp - prev.t);
      this.spin = { yaw: (dyaw / dt) * 16, pitch: (dpitch / dt) * 16 };
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.timeStamp });
      this.rotate(dyaw, dpitch);
    });
    const up = (e: PointerEvent) => {
      const was = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      // A flick keeps turning briefly, slowing to a stop; never under reduced motion, or after a pause.
      if (!was || this.pointers.size || reducedMotion() || e.timeStamp - was.t > 80) return;
      if (Math.hypot(this.spin.yaw, this.spin.pitch) < 0.004) return;
      const step = () => {
        this.spin.yaw *= 0.92;
        this.spin.pitch *= 0.92;
        this.rotate(this.spin.yaw, this.spin.pitch);
        this.glide = Math.hypot(this.spin.yaw, this.spin.pitch) > 0.001 ? requestAnimationFrame(step) : 0;
      };
      this.glide = requestAnimationFrame(step);
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('keydown', (e) => {
      const keys: Record<string, () => void> = {
        ArrowLeft: () => this.rotate(0.12, 0),
        ArrowRight: () => this.rotate(-0.12, 0),
        ArrowUp: () => this.rotate(0, 0.08),
        ArrowDown: () => this.rotate(0, -0.08),
        '+': () => this.zoomBy(1.2),
        '=': () => this.zoomBy(1.2),
        '-': () => this.zoomBy(1 / 1.2),
        Home: () => {
          this.cam = { ...HOME };
          this.request();
        },
      };
      const k = keys[e.key];
      if (k) {
        e.preventDefault();
        this.stopGlide();
        k();
      }
    });
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

  /** Index (0–3, as in BOX) of the floor corner nearest the viewer. */
  private nearestCorner(): number {
    let best = 0;
    let bd = Infinity;
    for (let k = 0; k < 4; k++) {
      const d = this.project(BOX[k * 3]!, BOX[k * 3 + 1]!, 0)[2];
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return best;
  }

  /** Scale (CSS px per box unit at the centre) for the current size and zoom. */
  private get scale(): number {
    return this.cam.zoom * Math.min(this.w, this.h) * 0.3;
  }

  /** The same projection as the vertex shader, in CSS pixels: [x, y, depth]. */
  private project(x: number, y: number, z: number): [number, number, number] {
    const cy = Math.cos(this.cam.yaw);
    const sy = Math.sin(this.cam.yaw);
    const cp = Math.cos(this.cam.pitch);
    const sp = Math.sin(this.cam.pitch);
    const x1 = x * cy - y * sy;
    const y1 = x * sy + y * cy;
    const up = y1 * sp + z * cp;
    const d = DIST + y1 * cp - z * sp;
    const k = (this.scale * DIST) / d;
    return [this.w / 2 + x1 * k, this.h / 2 - up * k, d];
  }

  private render(): void {
    if (!this.w || !this.h || !this.mesh) return;
    const cs = getComputedStyle(document.documentElement);
    const theme = { bg: rgb(cs.getPropertyValue('--surface').trim() || '#fff'), line: rgb(cs.getPropertyValue('--line').trim() || '#ccc'), ink: rgb(cs.getPropertyValue('--ink').trim() || '#000') };
    const ctx = this.ctx;
    if (ctx) ctx.clearRect(0, 0, this.w, this.h);
    const edges = backEdges(this.nearestCorner());
    if (this.gl) {
      this.gl.draw(this.cam, edges, this.scale, this.w, this.h, window.devicePixelRatio || 1, theme);
    } else if (ctx) {
      ctx.fillStyle = cs.getPropertyValue('--surface').trim() || '#fff';
      ctx.fillRect(0, 0, this.w, this.h);
      this.paint2d(ctx, edges, cs.getPropertyValue('--line').trim());
    }
    if (ctx) this.axes(ctx, cs.getPropertyValue('--muted').trim(), cs.getPropertyValue('--ink').trim());
    this.root.dataset.view = `${this.cam.yaw.toFixed(2)} ${this.cam.pitch.toFixed(2)} ${this.cam.zoom.toFixed(2)}`;
  }

  /** Canvas 2D: the box behind, then cells far to near (painter's algorithm), with the grid on top of each cell. */
  private paint2d(ctx: CanvasRenderingContext2D, edges: Uint16Array, line: string): void {
    const { pos, col, grid } = this.mesh;
    const side = N + 1;
    const n = side * side;
    const px = new Float32Array(n);
    const py = new Float32Array(n);
    const pd = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const [x, y, d] = this.project(pos[k * 3]!, pos[k * 3 + 1]!, pos[k * 3 + 2]!);
      px[k] = x;
      py[k] = y;
      pd[k] = d;
    }
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let e = 0; e < edges.length; e += 2) {
      const a = edges[e]! * 3;
      const b = edges[e + 1]! * 3;
      const [ax, ay] = this.project(BOX[a]!, BOX[a + 1]!, BOX[a + 2]!);
      const [bx, by] = this.project(BOX[b]!, BOX[b + 1]!, BOX[b + 2]!);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.stroke();
    const cells: number[] = [];
    const depth = new Float32Array(N * N);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = j * side + i;
        if ([a, a + 1, a + side, a + side + 1].some((k) => Number.isNaN(grid.z[k]!))) continue;
        depth[j * N + i] = pd[a]! + pd[a + 1]! + pd[a + side]! + pd[a + side + 1]!;
        cells.push(j * N + i);
      }
    }
    cells.sort((p, q) => depth[q]! - depth[p]!);
    const step = N / 12;
    ctx.lineJoin = 'round';
    for (const cell of cells) {
      const i = cell % N;
      const j = (cell - i) / N;
      const a = j * side + i;
      const b = a + 1;
      const c = a + side + 1;
      const d = a + side;
      const r = ((col[a * 3]! + col[c * 3]!) / 2) * 255;
      const g = ((col[a * 3 + 1]! + col[c * 3 + 1]!) / 2) * 255;
      const bl = ((col[a * 3 + 2]! + col[c * 3 + 2]!) / 2) * 255;
      const fill = `rgb(${r | 0},${g | 0},${bl | 0})`;
      ctx.beginPath();
      ctx.moveTo(px[a]!, py[a]!);
      ctx.lineTo(px[b]!, py[b]!);
      ctx.lineTo(px[c]!, py[c]!);
      ctx.lineTo(px[d]!, py[d]!);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.strokeStyle = fill; // hides hairline seams between cells
      ctx.lineWidth = 0.75;
      ctx.fill();
      ctx.stroke();
      if (j % step === 0 || i % step === 0 || i === N - 1 || j === N - 1) {
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        if (j % step === 0) {
          ctx.moveTo(px[a]!, py[a]!);
          ctx.lineTo(px[b]!, py[b]!);
        }
        if (i % step === 0) {
          ctx.moveTo(px[a]!, py[a]!);
          ctx.lineTo(px[d]!, py[d]!);
        }
        if (i === N - 1) {
          ctx.moveTo(px[b]!, py[b]!);
          ctx.lineTo(px[c]!, py[c]!);
        }
        if (j === N - 1) {
          ctx.moveTo(px[d]!, py[d]!);
          ctx.lineTo(px[c]!, py[c]!);
        }
        ctx.stroke();
      }
    }
  }

  /** Axis names and end values along the box edges nearest the viewer, drawn over the surface so they stay legible. */
  private axes(ctx: CanvasRenderingContext2D, muted: string, ink: string): void {
    const { grid } = this.mesh;
    const [cx, cy] = this.project(0, 0, 0);
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    // Labels are placed in priority order; one that would overlap an earlier label is skipped.
    const placed: [number, number, number, number][] = [];
    const text = (s: string, x: number, y: number, bold = false, align?: CanvasTextAlign) => {
      ctx.font = bold ? '600 13px ui-sans-serif, system-ui, sans-serif' : '11px ui-sans-serif, system-ui, sans-serif';
      const a = align ?? (x < cx - 4 ? 'right' : x > cx + 4 ? 'left' : 'center');
      const tw = ctx.measureText(s).width;
      const left = a === 'right' ? x - tw : a === 'center' ? x - tw / 2 : x;
      const box: [number, number, number, number] = [left - 2, y - 8, left + tw + 2, y + 8];
      if (placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) return;
      placed.push(box);
      ctx.fillStyle = bold ? ink : muted;
      ctx.textAlign = a;
      ctx.fillText(s, x, y);
    };
    // Push a label outward from the centre of the picture.
    const out = (x: number, y: number, by: number): [number, number] => {
      const dx = x - cx;
      const dy = y - cy;
      const l = Math.hypot(dx, dy) || 1;
      return [x + (dx / l) * by, y + (dy / l) * by];
    };
    // z labels beside the left-most vertical box edge that isn't the one nearest the viewer (the box itself is drawn
    // depth-tested, so no line here crosses the surface).
    const corners = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([x, y]) => ({ x, y, p: this.project(x, y, 0) }));
    const nearest = corners.reduce((a, b) => (b.p[2] < a.p[2] ? b : a));
    const edge = corners.filter((c) => c !== nearest).reduce((a, b) => (b.p[0] < a.p[0] ? b : a));
    const zb = this.project(edge.x, edge.y, -ZS);
    const zt = this.project(edge.x, edge.y, ZS);
    text('z', (zb[0] + zt[0]) / 2 - 12, (zb[1] + zt[1]) / 2, true, 'right');
    text(fmt(grid.zMax), zt[0] - 10, zt[1], false, 'right');
    text(fmt(grid.zMin), zb[0] - 10, zb[1] - 6, false, 'right');
    // x axis: the floor edge (y = ±1) closer to the viewer; same for y.
    const yEdge = this.project(0, -1, -ZS)[2] <= this.project(0, 1, -ZS)[2] ? -1 : 1;
    const xEdge = this.project(-1, 0, -ZS)[2] <= this.project(1, 0, -ZS)[2] ? -1 : 1;
    const xa = this.project(0, yEdge, -ZS);
    const ya = this.project(xEdge, 0, -ZS);
    // The two floor edges meet at the nearest corner, so their end values would collide: give each axis its range.
    text(`x ∈ [${fmt(grid.x[0])}, ${fmt(grid.x[1])}]`, ...out(xa[0], xa[1], 18), true);
    text(`y ∈ [${fmt(grid.y[0])}, ${fmt(grid.y[1])}]`, ...out(ya[0], ya[1], 18), true);
  }

  private exportPng(): void {
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
    a.download = 'lemma-surface.png';
    a.href = out.toDataURL('image/png');
    a.click();
  }
}
