// Canvas drawing for every whiteboard object. Pure functions of (object, theme, caches); the board owns state.
import { createSession } from '@lemma/math-core';
import { texToPlain } from '../lesson/timeline';
import { marchImplicit, niceStep, parseGraph, sampleExplicit, sampleParametric, samplePolar, sampleXofY, type Polyline } from '@lemma/graph-engine';
import {
  rng,
  resolveColor,
  strokeLocalBox,
  strokePath,
  strokePathLod,
  type GraphObj,
  type MarkObj,
  type MathObj,
  type Obj,
  type Rect,
  type ShapeObj,
  type StrokeObj,
  type TextObj,
  type Theme,
} from './model';

export interface MathImg {
  img: HTMLImageElement | null;
  /** Logical size at fontPx (without padding). */
  w: number;
  h: number;
  pad: number;
  plain: string;
  fontPx: number;
}

export interface DrawEnv {
  ctx: CanvasRenderingContext2D;
  theme: Theme;
  /** Device pixels per world unit (for level of detail). */
  px: number;
  boundsOf(id: string): Rect | null;
  /** Ready math image for this object at the current resolution, or undefined while it renders. */
  math(o: MathObj): MathImg | undefined;
}

export const TEXT_LINE = 1.3;
export const textFont = (size: number, t: Theme) => `${size}px ${t.sans}`;

let measureCtx: CanvasRenderingContext2D | null = null;
function mctx(): CanvasRenderingContext2D {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')!;
  return measureCtx;
}

export function measureText(o: Pick<TextObj, 'text' | 'size'>, t: Theme): { w: number; h: number } {
  const c = mctx();
  c.font = textFont(o.size, t);
  const lines = o.text.split('\n');
  let w = 0;
  for (const l of lines) w = Math.max(w, c.measureText(l).width);
  return { w: Math.max(w, o.size * 0.5), h: lines.length * o.size * TEXT_LINE };
}

// ---------- marks ----------

export function markPad(target: Rect): number {
  return Math.max(8, Math.min(28, Math.min(target.w, target.h) * 0.14));
}
export function markWidth(target: Rect): number {
  return Math.max(2.5, Math.min(6, Math.min(target.w, target.h) * 0.045));
}
export function markBounds(style: MarkObj['style'], t: Rect): Rect {
  const pad = markPad(t);
  const lw = markWidth(t);
  if (style === 'check') {
    const s = checkSize(t);
    return { x: t.x, y: Math.min(t.y, t.y + t.h / 2 - s * 0.6) - lw, w: t.w + pad + s + lw * 2, h: Math.max(t.h, s * 1.1) + lw * 2 };
  }
  if (style === 'underline') return { x: t.x - pad / 2 - lw, y: t.y + t.h, w: t.w + pad + lw * 2, h: pad + lw * 2 };
  if (style === 'circle') {
    // Ellipse through the box corners, plus wobble.
    const rx = (t.w / 2) * Math.SQRT2 + pad * 0.4;
    const ry = (t.h / 2) * Math.SQRT2 + pad * 0.4;
    return { x: t.x + t.w / 2 - rx - lw * 2, y: t.y + t.h / 2 - ry - lw * 2, w: rx * 2 + lw * 4, h: ry * 2 + lw * 4 };
  }
  return { x: t.x - pad - lw, y: t.y - pad - lw, w: t.w + 2 * pad + 2 * lw, h: t.h + 2 * pad + 2 * lw };
}
const checkSize = (t: Rect) => Math.max(22, Math.min(80, t.h * 0.9));

function markPath(o: MarkObj, t: Rect): { path: Path2D; len: number; fill?: boolean } {
  const r = rng(o.seed);
  const pad = markPad(t);
  const path = new Path2D();
  let len = 0;
  const pts: [number, number][] = [];
  if (o.style === 'circle') {
    const cx = t.x + t.w / 2;
    const cy = t.y + t.h / 2;
    const rx = (t.w / 2) * Math.SQRT2 + pad * 0.4;
    const ry = (t.h / 2) * Math.SQRT2 + pad * 0.4;
    const a0 = -Math.PI * (0.55 + r() * 0.2);
    const sweep = Math.PI * 2 + 0.3 + r() * 0.25;
    const f1 = 0.035 + r() * 0.03;
    const ph = r() * 6;
    const N = 72;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const a = a0 + sweep * u;
      const k = 1 + f1 * Math.sin(a * 2 + ph) + (u - 0.5) * 0.05;
      pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
    }
  } else if (o.style === 'box') {
    const x0 = t.x - pad;
    const y0 = t.y - pad;
    const x1 = t.x + t.w + pad;
    const y1 = t.y + t.h + pad;
    const j = () => (r() - 0.5) * pad * 0.35;
    const corners: [number, number][] = [
      [x0 + j(), y0 + j()],
      [x1 + j(), y0 + j()],
      [x1 + j(), y1 + j()],
      [x0 + j(), y1 + j()],
      [x0 + j() + pad * 0.3, y0 + j()],
    ];
    for (let s = 0; s < 4; s++) {
      const [ax, ay] = corners[s]!;
      const [bx, by] = corners[s + 1]!;
      for (let i = 0; i <= 8; i++) {
        const u = i / 8;
        const bow = Math.sin(u * Math.PI) * (r() - 0.5) * 1.5;
        pts.push([ax + (bx - ax) * u + bow, ay + (by - ay) * u + bow]);
      }
    }
  } else if (o.style === 'underline') {
    const y = t.y + t.h + pad * 0.55;
    const x0 = t.x - pad / 2;
    const x1 = t.x + t.w + pad / 2;
    const dip = (r() - 0.3) * pad * 0.4;
    for (let i = 0; i <= 24; i++) {
      const u = i / 24;
      pts.push([x0 + (x1 - x0) * u, y + Math.sin(u * Math.PI) * dip + (u - 0.5) * pad * 0.15]);
    }
  } else if (o.style === 'strike') {
    // Crossed out: one stroke through a line of text, an X through anything taller.
    const x0 = t.x - pad * 0.4;
    const x1 = t.x + t.w + pad * 0.4;
    const j = () => (r() - 0.5) * pad * 0.3;
    const segs: [number, number, number, number][] =
      t.h > t.w * 0.45
        ? [
            [x0 + j(), t.y - pad * 0.3 + j(), x1 + j(), t.y + t.h + pad * 0.3 + j()],
            [x1 + j(), t.y - pad * 0.3 + j(), x0 + j(), t.y + t.h + pad * 0.3 + j()],
          ]
        : [[x0 + j(), t.y + t.h * 0.6 + j(), x1 + j(), t.y + t.h * 0.45 + j()]];
    for (const [ax, ay, bx, by] of segs) {
      path.moveTo(ax, ay);
      path.lineTo(bx, by);
      len += Math.hypot(bx - ax, by - ay);
    }
    return { path, len };
  } else if (o.style === 'check') {
    const s = checkSize(t);
    const x = t.x + t.w + pad;
    const cy = t.y + t.h / 2;
    pts.push([x, cy - s * 0.05], [x + s * 0.35, cy + s * 0.32], [x + s, cy - s * 0.55 + (r() - 0.5) * s * 0.1]);
  } else {
    const x0 = t.x - pad * 0.5;
    const y0 = t.y - pad * 0.3;
    const w = t.w + pad;
    const h = t.h + pad * 0.6;
    const rr = Math.min(h / 2, pad);
    path.roundRect(x0, y0, w, h, rr);
    return { path, len: 0, fill: true };
  }
  path.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) {
    path.lineTo(pts[i]![0], pts[i]![1]);
    len += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  }
  return { path, len };
}

// ---------- graphs ----------

interface GraphCurve {
  expr: string;
  path: Path2D | null;
  dots: [number, number][];
  error?: string;
}
const graphCache = new Map<string, GraphCurve[]>();
let session: ReturnType<typeof createSession> | null = null;

export const GRAPH_HUES = ['accent', 'blue', 'warn', 'plum', 'ochre', 'ink'];

function graphCurves(o: GraphObj): GraphCurve[] {
  const key = `${o.exprs.join('\u0001')}|${o.xRange.join(',')}|${o.yRange.join(',')}|${Math.round(o.w)}x${Math.round(o.h)}`;
  const hit = graphCache.get(key);
  if (hit) return hit;
  session ??= createSession();
  const [x0, x1] = o.xRange;
  const [y0, y1] = o.yRange;
  const W = o.w;
  const H = o.h;
  const vp = { xMin: x0, xMax: x1, yMin: y0, yMax: y1 };
  const clampC = (v: number) => (v > 1e5 ? 1e5 : v < -1e5 ? -1e5 : v);
  const X = (mx: number) => clampC(((mx - x0) / (x1 - x0)) * W);
  const Y = (my: number) => clampC(H - ((my - y0) / (y1 - y0)) * H);
  const out: GraphCurve[] = [];
  for (const expr of o.exprs) {
    const curve: GraphCurve = { expr, path: new Path2D(), dots: [] };
    try {
      const spec = parseGraph(expr, session);
      const env: Record<string, number> = {};
      for (const s of spec.sliders) env[s.name] = s.value;
      const addLines = (lines: Polyline[]) => {
        for (const l of lines) {
          curve.path!.moveTo(X(l[0]!), Y(l[1]!));
          for (let i = 2; i < l.length; i += 2) curve.path!.lineTo(X(l[i]!), Y(l[i + 1]!));
        }
      };
      for (const it of spec.items) {
        if (it.kind === 'explicit') addLines(sampleExplicit(it.f, env, vp, W, it.domain));
        else if (it.kind === 'xOfY') addLines(sampleXofY(it.f, env, vp, H));
        else if (it.kind === 'parametric') addLines(sampleParametric(it.fx, it.fy, env, it.range, vp));
        else if (it.kind === 'polar') addLines(samplePolar(it.r, env, it.range, vp));
        else if (it.kind === 'point') {
          const px = it.x(env);
          const py = it.y(env);
          if (Number.isFinite(px) && Number.isFinite(py)) curve.dots.push([X(px), Y(py)]);
        } else if (it.kind === 'implicit') {
          const { segments } = marchImplicit(it.F, env, vp, Math.max(40, Math.round(W / 4)), Math.max(40, Math.round(H / 4)));
          for (let i = 0; i < segments.length; i += 4) {
            curve.path!.moveTo(X(segments[i]!), Y(segments[i + 1]!));
            curve.path!.lineTo(X(segments[i + 2]!), Y(segments[i + 3]!));
          }
        }
      }
    } catch (e) {
      curve.path = null;
      curve.error = (e as Error).message || "can't plot";
    }
    out.push(curve);
  }
  if (graphCache.size > 60) graphCache.delete(graphCache.keys().next().value!);
  graphCache.set(key, out);
  return out;
}

function fmtTick(v: number, step: number): string {
  if (Math.abs(v) < step * 1e-6) return '0';
  const digits = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return v.toFixed(Math.min(6, digits)).replace('-', '−');
}

function drawGraph(env: DrawEnv, o: GraphObj): void {
  const { ctx, theme: t } = env;
  const { x, y, w, h } = o;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 10);
  ctx.fillStyle = t.surface;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = t.line;
  ctx.stroke();
  ctx.clip();
  const [x0, x1] = o.xRange;
  const [y0, y1] = o.yRange;
  const X = (mx: number) => x + ((mx - x0) / (x1 - x0)) * w;
  const Y = (my: number) => y + h - ((my - y0) / (y1 - y0)) * h;
  const sx = niceStep(x1 - x0, Math.max(2, w / 70));
  const sy = niceStep(y1 - y0, Math.max(2, h / 70));
  // Grid
  ctx.beginPath();
  for (let v = Math.ceil(x0 / sx) * sx; v <= x1; v += sx) {
    ctx.moveTo(X(v), y);
    ctx.lineTo(X(v), y + h);
  }
  for (let v = Math.ceil(y0 / sy) * sy; v <= y1; v += sy) {
    ctx.moveTo(x, Y(v));
    ctx.lineTo(x + w, Y(v));
  }
  ctx.strokeStyle = t.line;
  ctx.lineWidth = 0.8;
  ctx.stroke();
  // Axes
  const ax = x0 <= 0 && x1 >= 0 ? X(0) : null;
  const ay = y0 <= 0 && y1 >= 0 ? Y(0) : null;
  ctx.beginPath();
  if (ax !== null) {
    ctx.moveTo(ax, y);
    ctx.lineTo(ax, y + h);
  }
  if (ay !== null) {
    ctx.moveTo(x, ay);
    ctx.lineTo(x + w, ay);
  }
  ctx.strokeStyle = t.muted;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // Tick labels
  const fs = Math.max(9, Math.min(13, Math.min(w, h) / 26));
  ctx.font = textFont(fs, t);
  ctx.fillStyle = t.muted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const lyX = Math.min(Math.max(ay ?? y + h - fs - 4, y + 2), y + h - fs - 4) + 3;
  for (let v = Math.ceil(x0 / sx) * sx; v <= x1; v += sx) {
    if (Math.abs(v) < sx * 1e-6) continue;
    const px = X(v);
    if (px < x + 10 || px > x + w - 10) continue;
    ctx.fillText(fmtTick(v, sx), px, lyX);
  }
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const lxY = Math.min(Math.max(ax ?? x + 30, x + 30), x + w - 4) - 4;
  for (let v = Math.ceil(y0 / sy) * sy; v <= y1; v += sy) {
    if (Math.abs(v) < sy * 1e-6) continue;
    const py = Y(v);
    if (py < y + 8 || py > y + h - 8) continue;
    ctx.fillText(fmtTick(v, sy), lxY, py);
  }
  // Curves
  const curves = graphCurves(o);
  ctx.save();
  ctx.translate(x, y);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = 2.5;
  curves.forEach((c, i) => {
    const col = resolveColor(i === 0 && o.color !== 'ink' ? o.color : GRAPH_HUES[i % GRAPH_HUES.length], t);
    if (c.path) {
      ctx.strokeStyle = col;
      ctx.stroke(c.path);
    }
    ctx.fillStyle = col;
    for (const [px, py] of c.dots) {
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  ctx.restore();
  // Legend
  const lf = Math.max(10, Math.min(15, Math.min(w, h) / 22));
  ctx.font = textFont(lf, t);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const rows = curves.map((c) => (c.error ? `${c.expr}  (can't plot)` : c.expr));
  const lw = Math.min(w - 16, Math.max(...rows.map((r) => ctx.measureText(r).width)) + lf * 2.4 + 12);
  const lh = rows.length * lf * 1.5 + 8;
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = t.surface;
  ctx.beginPath();
  ctx.roundRect(x + 8, y + 8, lw, lh, 6);
  ctx.fill();
  ctx.globalAlpha = 1;
  rows.forEach((r, i) => {
    const cy = y + 12 + lf * 0.75 + i * lf * 1.5;
    const col = resolveColor(i === 0 && o.color !== 'ink' ? o.color : GRAPH_HUES[i % GRAPH_HUES.length], t);
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x + 14, cy);
    ctx.lineTo(x + 14 + lf * 1.4, cy);
    ctx.stroke();
    ctx.fillStyle = curves[i]!.error ? t.warn : t.ink;
    ctx.fillText(r, x + 20 + lf * 1.4, cy, lw - lf * 1.4 - 18);
  });
  ctx.restore();
}

// ---------- shapes ----------

function arrowHead(ctx: CanvasRenderingContext2D, fx: number, fy: number, tx: number, ty: number, size: number): void {
  const a = Math.atan2(ty - fy, tx - fx);
  ctx.moveTo(tx - size * Math.cos(a - 0.45), ty - size * Math.sin(a - 0.45));
  ctx.lineTo(tx, ty);
  ctx.lineTo(tx - size * Math.cos(a + 0.45), ty - size * Math.sin(a + 0.45));
}

export function shapeLength(o: ShapeObj): number {
  const w = Math.abs(o.w);
  const h = Math.abs(o.h);
  if (o.shape === 'line' || o.shape === 'arrow') return Math.hypot(w, h) + 40;
  if (o.shape === 'ellipse') return Math.PI * (w + h) * 0.55;
  return 2 * (w + h) + 60;
}

function drawShape(env: DrawEnv, o: ShapeObj, col: string): void {
  const { ctx, theme: t } = env;
  const { x, y, w, h } = o;
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineWidth = o.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const head = Math.max(10, o.size * 3.5);
  const labelFs = Math.max(12, Math.min(22, Math.min(Math.abs(w), Math.abs(h) || 999) * 0.22));
  switch (o.shape) {
    case 'rect':
      ctx.roundRect(x, y, w, h, Math.min(6, w / 4, h / 4));
      break;
    case 'ellipse':
      ctx.ellipse(x + w / 2, y + h / 2, Math.max(0.5, w / 2), Math.max(0.5, h / 2), 0, 0, Math.PI * 2);
      break;
    case 'triangle':
      if (o.right) {
        // Right angle at the bottom-left, marked with the usual small square.
        ctx.moveTo(x, y);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x, y + h);
        ctx.closePath();
        const m = Math.max(8, Math.min(28, Math.min(w, h) * 0.12));
        ctx.moveTo(x + m, y + h);
        ctx.lineTo(x + m, y + h - m);
        ctx.lineTo(x, y + h - m);
      } else {
        ctx.moveTo(x + w / 2, y);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x, y + h);
        ctx.closePath();
      }
      break;
    case 'line':
    case 'arrow':
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y + h);
      if (o.shape === 'arrow') arrowHead(ctx, x, y, x + w, y + h, head);
      break;
    case 'numberline': {
      const cy = y + h / 2;
      ctx.moveTo(x, cy);
      ctx.lineTo(x + w, cy);
      arrowHead(ctx, x + w, cy, x, cy, head);
      arrowHead(ctx, x, cy, x + w, cy, head);
      const from = o.from ?? -5;
      const until = o.until ?? 5;
      const span = until - from || 1;
      const inner = 28;
      const step = Number.isInteger(from) && Number.isInteger(until) && Math.abs(span) <= 20 ? Math.sign(span) : niceStep(Math.abs(span), 10) * Math.sign(span);
      const X = (v: number) => x + inner + ((v - from) / span) * (w - inner * 2);
      const tick = Math.min(10, h * 0.18);
      const ticks: number[] = [];
      for (let v = from, i = 0; i < 200 && (step > 0 ? v <= until + 1e-9 : v >= until - 1e-9); v += step, i++) ticks.push(v);
      for (const v of ticks) {
        ctx.moveTo(X(v), cy - tick);
        ctx.lineTo(X(v), cy + tick);
      }
      ctx.stroke();
      ctx.font = textFont(labelFs, t);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (const v of ticks) ctx.fillText(fmtTick(v, Math.abs(step)), X(v), cy + tick + 4);
      ctx.beginPath();
      break;
    }
    case 'axes': {
      const cx = x + w / 2;
      const cy = y + h / 2;
      ctx.moveTo(x, cy);
      ctx.lineTo(x + w, cy);
      arrowHead(ctx, x, cy, x + w, cy, head);
      ctx.moveTo(cx, y + h);
      ctx.lineTo(cx, y);
      arrowHead(ctx, cx, y + h, cx, y, head);
      const from = o.from ?? -5;
      const until = o.until ?? 5;
      const n = Math.max(1, Math.round(until));
      const unitX = (w / 2 - head * 1.5) / n;
      const unitY = (h / 2 - head * 1.5) / n;
      const tick = 4;
      for (let i = -n; i <= n; i++) {
        if (!i || i < from) continue;
        ctx.moveTo(cx + i * unitX, cy - tick);
        ctx.lineTo(cx + i * unitX, cy + tick);
        ctx.moveTo(cx - tick, cy - i * unitY);
        ctx.lineTo(cx + tick, cy - i * unitY);
      }
      ctx.stroke();
      ctx.font = `italic ${textFont(labelFs, t)}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText('x', x + w, cy + 6);
      ctx.textAlign = 'left';
      ctx.fillText('y', cx + 8, y);
      ctx.beginPath();
      break;
    }
  }
  ctx.stroke();
  if (o.label) {
    ctx.font = textFont(labelFs, t);
    ctx.fillStyle = col;
    if (o.shape === 'numberline' || o.shape === 'axes' || o.shape === 'line' || o.shape === 'arrow') {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(o.label, Math.min(x, x + w), Math.min(y, y + h) - 4);
    } else {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(o.label, x + w / 2, y + h * (o.shape === 'triangle' ? 0.66 : 0.5), Math.max(10, w - 12));
    }
  }
}

// ---------- entry points ----------

/** Draws one object. `p` < 1 is the draw-in animation progress. */
export function drawObject(env: DrawEnv, o: Obj, p = 1): void {
  const { ctx, theme: t } = env;
  if (o.kind === 'group') return;
  const col = resolveColor(o.kind === 'mark' && !o.color ? 'accent' : o.color, t);
  ctx.save();
  const fade = p < 1 && o.kind !== 'mark' && o.kind !== 'shape' && o.kind !== 'stroke';
  if (fade) {
    const e = 1 - (1 - p) ** 3;
    ctx.globalAlpha = e;
    const b = env.boundsOf(o.id);
    if (b) {
      const s = 0.96 + 0.04 * e;
      ctx.translate(b.x + b.w / 2, b.y + b.h / 2 + (1 - e) * 6);
      ctx.scale(s, s);
      ctx.translate(-(b.x + b.w / 2), -(b.y + b.h / 2));
    }
  }
  switch (o.kind) {
    case 'stroke':
      drawStroke(env, o, col, p);
      break;
    case 'text': {
      ctx.font = textFont(o.size, t);
      ctx.fillStyle = col;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const lines = o.text.split('\n');
      lines.forEach((l, i) => ctx.fillText(l, o.x, o.y + i * o.size * TEXT_LINE + o.size * 0.12));
      break;
    }
    case 'math': {
      const m = env.math(o);
      if (m?.img) {
        const s = o.size / m.fontPx;
        ctx.drawImage(m.img, o.x - m.pad * s, o.y - m.pad * s, (m.w + m.pad * 2) * s, (m.h + m.pad * 2) * s);
      } else {
        ctx.font = textFont(o.size * 0.9, t);
        // Until it's typeset (a fraction of a second on first load), show it readably and faintly, never as raw TeX.
        ctx.fillStyle = t.faint;
        ctx.textBaseline = 'top';
        ctx.fillText(m?.plain ?? texToPlain(o.tex), o.x, o.y + o.size * 0.15);
      }
      break;
    }
    case 'graph':
      drawGraph(env, o);
      break;
    case 'shape':
      if (p < 1) {
        const len = shapeLength(o);
        ctx.setLineDash([len * p, len + 1]);
      }
      drawShape(env, o, col);
      break;
    case 'mark': {
      const tb = env.boundsOf(o.target);
      if (!tb) break;
      const m = markPath(o, tb);
      if (m.fill) {
        ctx.globalAlpha = (t.dark ? 0.22 : 0.26) * Math.min(1, p * 1.5);
        ctx.fillStyle = col;
        if (p < 1) {
          ctx.beginPath();
          ctx.rect(tb.x - 100, tb.y - 100, (tb.w + 200) * p, tb.h + 200);
          ctx.clip();
        }
        ctx.fill(m.path);
      } else {
        ctx.strokeStyle = col;
        ctx.lineWidth = markWidth(tb);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (p < 1) ctx.setLineDash([m.len * p, m.len + 1]);
        ctx.stroke(m.path);
      }
      break;
    }
  }
  ctx.restore();
}

function drawStroke(env: DrawEnv, o: StrokeObj, col: string, p: number): void {
  const { ctx } = env;
  const box = strokeLocalBox(o.pts);
  // Level of detail: a stroke smaller than ~1.5 device px is a dot.
  if ((box.w + o.size) * env.px < 1.5 && (box.h + o.size) * env.px < 1.5) {
    ctx.fillStyle = col;
    if (o.highlighter) ctx.globalAlpha = 0.35;
    ctx.fillRect(o.x + box.x, o.y + box.y, Math.max(box.w, 1 / env.px), Math.max(box.h, 1 / env.px));
    return;
  }
  ctx.translate(o.x, o.y);
  if (o.highlighter) {
    ctx.globalAlpha = env.theme.dark ? 0.32 : 0.38;
    ctx.globalCompositeOperation = env.theme.dark ? 'source-over' : 'multiply';
  }
  if (env.px < 0.75 && p >= 1) {
    // Zoomed out: a simplified constant-width centre line is indistinguishable and much cheaper.
    const lod = strokePathLod(o, env.px);
    ctx.strokeStyle = col;
    ctx.lineWidth = lod.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(lod.path);
    return;
  }
  const sp = strokePath(o);
  if (sp.filled) {
    ctx.fillStyle = col;
    ctx.fill(sp.path);
  } else {
    ctx.strokeStyle = col;
    ctx.lineWidth = o.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (p < 1) ctx.setLineDash([sp.len * p, sp.len + 1]);
    ctx.stroke(sp.path);
  }
}

/** Dotted background grid for the visible world rect. */
export function drawGrid(ctx: CanvasRenderingContext2D, t: Theme, view: Rect, zoom: number): void {
  let step = 24;
  while (step * zoom < 14) step *= 4;
  while (step * zoom > 80) step /= 2;
  const r = Math.max(0.9, Math.min(1.6, 1.2 * Math.sqrt(zoom))) / zoom;
  ctx.fillStyle = t.dark ? t.line : t.faint;
  ctx.globalAlpha = t.dark ? 0.9 : 0.45;
  ctx.beginPath();
  const x0 = Math.floor(view.x / step) * step;
  const y0 = Math.floor(view.y / step) * step;
  for (let y = y0; y <= view.y + view.h; y += step) for (let x = x0; x <= view.x + view.w; x += step) ctx.rect(x - r, y - r, r * 2, r * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}
