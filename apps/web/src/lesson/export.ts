// Canvas renderer + MediaRecorder export. Draws the exact timeline the DOM player uses (timeline.ts).
import { renderInlineMath } from '../math-render';
import {
  answerHighlight,
  buildTimeline,
  sceneVisual,
  SIZES,
  texToPlain,
  visualAt,
  type Block,
  type Lesson,
  type Scene,
  type Timeline,
} from './timeline';

export interface ExportOptions {
  width?: number;
  height?: number;
  fps?: number;
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
}

export interface ExportedVideo {
  blob: Blob;
  mime: string;
  ext: string;
}

interface Theme {
  bg: string;
  surface: string;
  ink: string;
  muted: string;
  line: string;
  accent: string;
  sans: string;
  radius: number;
}

function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: v('--bg', '#f4f3ee'),
    surface: v('--surface', '#ffffff'),
    ink: v('--ink', '#141416'),
    muted: v('--muted', '#6c6c72'),
    line: v('--line', '#dcdbd4'),
    accent: v('--accent', '#4d6b00'),
    sans: v('--sans', 'system-ui, sans-serif'),
    radius: parseFloat(v('--radius', '18')) || 18,
  };
}

// ---------- Math -> image (KaTeX HTML inside SVG foreignObject) ----------

export interface MathImage {
  /** null when the SVG route failed (e.g. canvas tainting); draw `plain` as text instead. */
  img: HTMLImageElement | null;
  /** Logical size in canvas pixels (without padding). */
  w: number;
  h: number;
  pad: number;
  plain: string;
}

let katexCssPromise: Promise<string> | null = null;

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(blob);
  });
}

/** KaTeX CSS with its woff2 fonts embedded as data URLs (an SVG image can't load external resources). */
function katexCssInlined(): Promise<string> {
  katexCssPromise ??= (async () => {
    const mod = (await import('katex/dist/katex.min.css?inline')) as { default: string };
    const css = mod.default;
    const faces = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
    const embedded = await Promise.all(
      faces.map(async (face) => {
        const woff2 = /url\(\s*["']?([^"')]+\.woff2[^"')]*)["']?\s*\)/.exec(face)?.[1];
        if (!woff2) return '';
        try {
          const data = woff2.startsWith('data:')
            ? woff2
            : await fetch(new URL(woff2, location.href).href)
                .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
                .then(toDataUrl);
          return face.replace(/src\s*:[^;}]+/, `src:url(${data}) format("woff2")`);
        } catch {
          return '';
        }
      }),
    );
    return css.replace(/@font-face\s*\{[^}]*\}/g, '') + embedded.join('');
  })().catch((e) => {
    katexCssPromise = null;
    throw e;
  });
  return katexCssPromise;
}

const mathCache = new Map<string, Promise<MathImage>>();

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('math image failed to load'));
    img.src = src;
  });
}

function isTainting(img: HTMLImageElement): boolean {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    const ctx = c.getContext('2d');
    if (!ctx) return true;
    ctx.drawImage(img, 0, 0, 2, 2);
    ctx.getImageData(0, 0, 1, 1);
    return false;
  } catch {
    return true;
  }
}

/**
 * Each cached image is an SVG document carrying every KaTeX font (hundreds of KB), keyed by size and colour as
 * well as formula, so an unbounded cache grows with every lesson played in a long session. Keep the most
 * recently used ones: a lesson needs a few dozen.
 */
export const MATH_CACHE_LIMIT = 48;

/** Renders LaTeX at `fontPx` (canvas pixels) in `color`. Cached per (tex, size, color), least recently used out. */
export function renderMathImage(tex: string, fontPx: number, color: string): Promise<MathImage> {
  const key = `${fontPx.toFixed(2)}|${color}|${tex}`;
  let p = mathCache.get(key);
  if (p) mathCache.delete(key);
  else p = buildMathImage(tex, fontPx, color);
  mathCache.set(key, p);
  while (mathCache.size > MATH_CACHE_LIMIT) mathCache.delete(mathCache.keys().next().value!);
  return p;
}

/** For tests: how many formula images are cached. */
export const mathCacheSize = (): number => mathCache.size;

let fontsReady: Promise<unknown> | null = null;
/**
 * Typesetting measures the formula in the document; measured with fallback fonts, the box is too small and
 * clips the formula once the KaTeX fonts draw. Wait (briefly) for them before the first measurement.
 */
function katexFonts(): Promise<unknown> {
  fontsReady ??= Promise.race([
    Promise.all(
      ['20px KaTeX_Main', 'bold 20px KaTeX_Main', 'italic 20px KaTeX_Math', '20px KaTeX_AMS', '20px KaTeX_Size1', '20px KaTeX_Size2'].map((f) =>
        document.fonts.load(f, 'x=4').catch(() => []),
      ),
    ),
    new Promise((r) => setTimeout(r, 2500)),
  ]);
  return fontsReady;
}

async function buildMathImage(tex: string, fontPx: number, color: string): Promise<MathImage> {
  await katexFonts();
  const plain = texToPlain(tex);
  const pad = Math.ceil(fontPx * 0.15);
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;font-size:${fontPx}px;line-height:normal;color:${color};`;
  const inner = document.createElement('span');
  inner.style.display = 'inline-block';
  host.append(inner);
  document.body.append(host);
  try {
    renderInlineMath(inner, `\\displaystyle ${tex}`, false);
    const rect = inner.getBoundingClientRect();
    const w = Math.max(1, Math.ceil(rect.width));
    const h = Math.max(1, Math.ceil(rect.height));
    try {
      const css = await katexCssInlined();
      const html = new XMLSerializer().serializeToString(inner);
      const W = w + pad * 2;
      const H = h + pad * 2;
      const scale = 2;
      // Scale with a CSS transform rather than a viewBox: WebKit ignores viewBox scaling for foreignObject.
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${W * scale}" height="${H * scale}">` +
        `<foreignObject x="0" y="0" width="${W * scale}" height="${H * scale}">` +
        `<div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;align-items:flex-start;box-sizing:border-box;width:${W}px;height:${H}px;margin:0;padding:${pad}px;transform:scale(${scale});transform-origin:0 0;font-size:${fontPx}px;line-height:normal;color:${color};">` +
        `<style><![CDATA[${css.replace(/\]\]>/g, '')}]]></style>${html}</div></foreignObject></svg>`;
      const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      if (isTainting(img)) return { img: null, w, h, pad, plain };
      return { img, w, h, pad, plain };
    } catch {
      return { img: null, w, h, pad, plain };
    }
  } finally {
    host.remove();
  }
}

// ---------- Scene layout ----------

type Op =
  | { t: 'text'; text: string; x: number; y: number; font: string; color: string; align: CanvasTextAlign; spacing: number }
  | { t: 'math'; m: MathImage; x: number; y: number; w: number; h: number; font: string; color: string }
  | { t: 'box'; x: number; y: number; w: number; h: number; r: number; border: number; highlight: true };

interface SceneLayout {
  ops: Op[];
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxW) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo).trimEnd()}…`;
}

export interface LessonCanvasRenderer {
  canvas: HTMLCanvasElement;
  duration: number;
  timeline: Timeline;
  draw(t: number): void;
}

/** Prepares (fonts, math images, layout) and returns a synchronous frame drawer. */
export async function createLessonCanvasRenderer(
  lesson: Lesson,
  opts: { width?: number; height?: number; reducedMotion?: boolean } = {},
): Promise<LessonCanvasRenderer> {
  const W = Math.round(opts.width ?? 1280);
  const H = Math.round(opts.height ?? 720);
  const u = Math.min(W / 1280, H / 720);
  const theme = readTheme();
  const tl = buildTimeline(lesson);
  const reduced =
    opts.reducedMotion ?? (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D is not available.');

  if (document.fonts?.ready) await document.fonts.ready.catch(() => undefined);

  const font = (px: number, weight = 400) => `${weight} ${px * u}px ${theme.sans}`;
  const mathPx = (b: Block) => (b.kind === 'answer' ? SIZES.answer : b.kind === 'math' && b.size === 'md' ? SIZES.mathMd : SIZES.mathLg) * u;

  // Pre-render every math image before drawing starts so frames are synchronous.
  const mathFor = new Map<Block, MathImage>();
  for (const scene of tl.scenes) {
    for (const b of scene.blocks) {
      const tex = b.kind === 'math' ? b.tex : b.kind === 'answer' ? b.tex : undefined;
      if (tex) mathFor.set(b, await renderMathImage(tex, mathPx(b), theme.ink));
    }
  }

  const setSpacing = (px: number) => {
    const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
    if ('letterSpacing' in c) c.letterSpacing = `${px}px`;
  };

  function layout(scene: Scene): SceneLayout {
    const center = scene.align === 'center';
    const padX = SIZES.padX * u;
    const maxW = W - padX * 2;
    const top = (center ? SIZES.contentBottom : SIZES.contentTop) * u;
    const bottom = H - SIZES.contentBottom * u;
    const ops: Op[] = [];
    let y = 0;
    let prev: Block | null = null;
    const xFor = (w: number) => (center ? (W - w) / 2 : padX);

    for (const b of scene.blocks) {
      if (prev) y += (prev.kind === 'label' ? SIZES.labelGap : SIZES.gap) * u;
      prev = b;
      if (b.kind === 'label' || b.kind === 'heading' || b.kind === 'text') {
        const size = b.kind === 'label' ? SIZES.label : b.kind === 'heading' ? SIZES.heading : SIZES[b.size];
        const weight = b.kind === 'text' ? 400 : 600;
        const lh = (b.kind === 'heading' ? 1.15 : SIZES.lineHeight) * size * u;
        const color = b.kind === 'label' ? theme.accent : b.kind === 'text' && b.tone === 'muted' ? theme.muted : theme.ink;
        const text = b.kind === 'label' ? b.text.toUpperCase() : b.text;
        const spacing = b.kind === 'label' ? 0.08 * size * u : 0;
        ctx!.font = font(size, weight);
        setSpacing(spacing);
        for (const line of wrapLines(ctx!, text, maxW)) {
          ops.push({ t: 'text', text: line, x: center ? W / 2 : padX, y: y + lh / 2, font: font(size, weight), color, align: center ? 'center' : 'left', spacing });
          y += lh;
        }
        setSpacing(0);
      } else if (b.kind === 'math') {
        const m = mathFor.get(b)!;
        const k = Math.min(1, maxW / m.w);
        ops.push({ t: 'math', m, x: xFor(m.w * k), y, w: m.w * k, h: m.h * k, font: `${mathPx(b) * 0.8}px ${theme.sans}`, color: theme.ink });
        y += m.h * k;
      } else {
        const px = SIZES.answerPadX * u;
        const py = SIZES.answerPadY * u;
        const border = SIZES.answerBorder * u;
        let cw: number;
        let ch: number;
        const m = mathFor.get(b);
        if (m) {
          const k = Math.min(1, (maxW - px * 2) / m.w);
          cw = m.w * k;
          ch = m.h * k;
          const boxW = cw + px * 2 + border * 2;
          const bx = xFor(boxW);
          ops.push({ t: 'box', x: bx, y, w: boxW, h: ch + py * 2 + border * 2, r: theme.radius * u, border, highlight: true });
          ops.push({ t: 'math', m, x: bx + border + px, y: y + border + py, w: cw, h: ch, font: `600 ${SIZES.answer * 0.8 * u}px ${theme.sans}`, color: theme.ink });
        } else {
          const f = font(SIZES.answer, 600);
          ctx!.font = f;
          const line = truncate(ctx!, b.display, maxW - px * 2);
          cw = ctx!.measureText(line).width;
          ch = SIZES.answer * u * 1.2;
          const boxW = cw + px * 2 + border * 2;
          const bx = xFor(boxW);
          ops.push({ t: 'box', x: bx, y, w: boxW, h: ch + py * 2 + border * 2, r: theme.radius * u, border, highlight: true });
          ops.push({ t: 'text', text: line, x: bx + border + px, y: y + border + py + ch / 2, font: f, color: theme.ink, align: 'left', spacing: 0 });
        }
        y += ch + py * 2 + border * 2;
      }
    }
    // Vertically center the content block in its region.
    const offset = top + Math.max(0, (bottom - top - y) / 2);
    for (const op of ops) op.y += offset;
    return { ops };
  }

  const layouts = tl.scenes.map(layout);

  function roundRect(x: number, y: number, w: number, h: number, r: number) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx!.beginPath();
    ctx!.moveTo(x + rr, y);
    ctx!.arcTo(x + w, y, x + w, y + h, rr);
    ctx!.arcTo(x + w, y + h, x, y + h, rr);
    ctx!.arcTo(x, y + h, x, y, rr);
    ctx!.arcTo(x, y, x + w, y, rr);
    ctx!.closePath();
  }

  function drawOps(ops: Op[], alpha: number, highlight: number) {
    for (const op of ops) {
      if (op.t === 'text') {
        ctx!.globalAlpha = alpha;
        ctx!.font = op.font;
        setSpacing(op.spacing);
        ctx!.fillStyle = op.color;
        ctx!.textAlign = op.align;
        ctx!.textBaseline = 'middle';
        ctx!.fillText(op.text, op.x, op.y);
        setSpacing(0);
      } else if (op.t === 'math') {
        ctx!.globalAlpha = alpha;
        if (op.m.img) {
          const k = op.w / op.m.w;
          ctx!.drawImage(op.m.img, op.x - op.m.pad * k, op.y - op.m.pad * k, op.w + op.m.pad * 2 * k, op.h + op.m.pad * 2 * k);
        } else {
          ctx!.font = op.font;
          ctx!.fillStyle = op.color;
          ctx!.textAlign = 'left';
          ctx!.textBaseline = 'middle';
          ctx!.fillText(op.m.plain, op.x, op.y + op.h / 2, op.w);
        }
      } else {
        const inset = op.border / 2;
        roundRect(op.x + inset, op.y + inset, op.w - op.border, op.h - op.border, op.r);
        ctx!.globalAlpha = alpha;
        ctx!.fillStyle = theme.surface;
        ctx!.fill();
        ctx!.lineWidth = op.border;
        ctx!.strokeStyle = theme.line;
        ctx!.stroke();
        if (highlight > 0) {
          ctx!.globalAlpha = alpha * highlight;
          ctx!.strokeStyle = theme.accent;
          ctx!.stroke();
        }
      }
    }
    ctx!.globalAlpha = 1;
  }

  let headerText: string | null = null;
  function draw(t: number) {
    const c = ctx!;
    c.save();
    c.globalAlpha = 1;
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, W, H);
    if (tl.header) {
      const v = visualAt(tl.header.start, tl.header.end, t, reduced);
      if (v.opacity > 0.001) {
        const x = SIZES.padX * u;
        const y = (SIZES.headerTop + SIZES.header * SIZES.lineHeight * 0.5) * u;
        c.globalAlpha = v.opacity;
        c.fillStyle = theme.muted;
        c.textBaseline = 'middle';
        c.textAlign = 'left';
        c.font = font(15, 600);
        setSpacing(0.08 * 15 * u);
        c.fillText('QUESTION', x, y);
        const lw = c.measureText('QUESTION').width + 14 * u;
        setSpacing(0);
        c.font = font(SIZES.header);
        headerText ??= truncate(c, tl.header.text, W - SIZES.padX * u * 2 - lw);
        c.fillText(headerText, x + lw, y);
      }
    }
    tl.scenes.forEach((scene, i) => {
      const v = sceneVisual(scene, t, tl.duration, reduced);
      if (v.opacity <= 0.001) return;
      c.save();
      c.translate(0, v.dy * u);
      drawOps(layouts[i]!.ops, v.opacity, scene.segment.kind === 'answer' ? answerHighlight(scene, t, reduced) : 0);
      c.restore();
    });
    c.restore();
  }

  draw(0);
  return { canvas, duration: tl.duration, timeline: tl, draw };
}

// ---------- Recording ----------

// H.264 MP4 plays everywhere, so it comes first. A bare "video/mp4" is last: Chromium builds without H.264
// accept it and then write VP9 into an MP4 container, which QuickTime and many players can't open, while WebM
// with the same codec plays in every browser.
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=avc1',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
];

export function pickVideoMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

export function canExportVideo(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function'
  );
}

export async function exportLessonVideo(lesson: Lesson, opts: ExportOptions = {}): Promise<ExportedVideo> {
  if (!canExportVideo()) throw new Error('Saving video is not supported in this browser.');
  const r = await createLessonCanvasRenderer(lesson, { width: opts.width, height: opts.height });
  return recordCanvas(r, opts);
}

/** Records a canvas renderer in real time with MediaRecorder (video only). */
export async function recordCanvas(r: { canvas: HTMLCanvasElement; duration: number; draw(t: number): void }, opts: ExportOptions = {}): Promise<ExportedVideo> {
  if (!canExportVideo()) throw new Error('Saving video is not supported in this browser.');
  const fps = Math.max(1, Math.min(60, opts.fps ?? 30));
  const signal = opts.signal;
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');

  const stream = r.canvas.captureStream(fps);
  const mime = pickVideoMime();
  const pixels = r.canvas.width * r.canvas.height;
  const bitrate = Math.round(Math.min(8_000_000, Math.max(1_500_000, pixels * fps * 0.1)));
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: bitrate } : { videoBitsPerSecond: bitrate });
  } catch {
    rec = new MediaRecorder(stream);
  }
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve, reject) => {
    rec.onstop = () => resolve();
    rec.onerror = (e) => reject(new Error(`Recording failed: ${(e as Event & { error?: Error }).error?.message ?? 'unknown error'}`));
  });

  const track = stream.getVideoTracks()[0] as (MediaStreamTrack & { requestFrame?: () => void }) | undefined;
  const frameMs = 1000 / fps;
  try {
    r.draw(0);
    rec.start(1000);
    const t0 = performance.now();
    let lastProgress = -1;
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(new DOMException('Export cancelled', 'AbortError'));
      signal?.addEventListener('abort', onAbort, { once: true });
      const tick = () => {
        if (signal?.aborted) return;
        const t = (performance.now() - t0) / 1000;
        const done = t >= r.duration;
        r.draw(Math.min(t, r.duration));
        track?.requestFrame?.();
        const p = Math.min(1, t / r.duration);
        if (opts.onProgress && p - lastProgress >= 0.005) {
          lastProgress = p;
          opts.onProgress(p);
        }
        if (done) {
          signal?.removeEventListener('abort', onAbort);
          // Hold the final frame briefly so the encoder flushes it.
          setTimeout(resolve, Math.max(200, frameMs * 3));
          return;
        }
        if (document.hidden) setTimeout(tick, frameMs);
        else requestAnimationFrame(tick);
      };
      tick();
    });
    rec.stop();
    await stopped;
  } catch (e) {
    if (rec.state !== 'inactive') rec.stop();
    throw e;
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
  opts.onProgress?.(1);
  const type = (rec.mimeType || mime || 'video/webm').trim();
  const blob = new Blob(chunks, { type });
  if (blob.size === 0) throw new Error('Recording produced an empty video.');
  return { blob, mime: type, ext: type.includes('mp4') ? 'mp4' : 'webm' };
}
