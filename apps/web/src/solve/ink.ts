import { smoothPoints, strokeLocalBox, strokePath, type StrokeObj } from '../whiteboard/model';
import { h } from './dom';

/**
 * A small handwriting pad built on the whiteboard's ink (same stroke model, smoothing and pressure outlines).
 * `render()` redraws the strokes black on white, cropped and scaled for the text reader.
 */
export interface InkPad {
  root: HTMLElement;
  render(): HTMLCanvasElement | null;
  undo(): void;
  clear(): void;
  /** For tests: draw strokes given as point lists in pad coordinates. */
  strokes: StrokeObj[];
}

export function inkPad(): InkPad {
  const canvas = document.createElement('canvas');
  const hint = h('div', { class: 'ink-hint' }, 'Write here');
  const root = h('div', { class: 'ink-pad', 'data-testid': 'ink-pad' }, canvas, hint);
  const strokes: StrokeObj[] = [];
  let live: number[] | null = null;
  let dpr = 1;
  const size = 3.2;
  const color = () => getComputedStyle(root).color || '#141416';

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    // Only when the size really changed: resizing the bitmap from inside the observer re-triggers it otherwise
    // (Safari reports that as a "ResizeObserver loop" error).
    if (w === canvas.width && h === canvas.height) return;
    canvas.width = w;
    canvas.height = h;
    draw();
  };
  const draw = () => {
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const col = color();
    for (const s of strokes) paint(ctx, s, col);
    if (live && live.length >= 3) paint(ctx, { id: 'live', z: 0, color: 'ink', kind: 'stroke', x: 0, y: 0, pts: live, size }, col);
    hint.hidden = strokes.length > 0 || !!live;
  };
  new ResizeObserver(() => requestAnimationFrame(resize)).observe(canvas);

  const at = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top, e.pointerType === 'pen' ? e.pressure : -1];
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    live = at(e);
    draw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!live) return;
    for (const ev of e.getCoalescedEvents?.() ?? [e]) live.push(...at(ev));
    draw();
  });
  const end = () => {
    if (!live) return;
    if (live.length >= 3) strokes.push({ id: String(strokes.length), z: strokes.length, color: 'ink', kind: 'stroke', x: 0, y: 0, pts: smoothPoints(live, 1.2), size });
    live = null;
    draw();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  return {
    root,
    strokes,
    undo() {
      strokes.pop();
      draw();
    },
    clear() {
      strokes.length = 0;
      draw();
    },
    render() {
      if (!strokes.length) return null;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const s of strokes) {
        const b = strokeLocalBox(s.pts);
        x0 = Math.min(x0, s.x + b.x);
        y0 = Math.min(y0, s.y + b.y);
        x1 = Math.max(x1, s.x + b.x + b.w);
        y1 = Math.max(y1, s.y + b.y + b.h);
      }
      // Writing about 90 px tall reads best; thicker ink at that size.
      const k = Math.min(6, Math.max(0.5, 90 / Math.max(20, y1 - y0)));
      const pad = 40;
      const out = document.createElement('canvas');
      out.width = Math.ceil((x1 - x0) * k + pad * 2);
      out.height = Math.ceil((y1 - y0) * k + pad * 2);
      const ctx = out.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.setTransform(k, 0, 0, k, pad - x0 * k, pad - y0 * k);
      for (const s of strokes) paint(ctx, { ...s, size: Math.max(s.size, 7 / k) }, '#000');
      return out;
    },
  };
}

function paint(ctx: CanvasRenderingContext2D, s: StrokeObj, col: string) {
  ctx.save();
  ctx.translate(s.x, s.y);
  const sp = strokePath(s);
  if (sp.filled) {
    ctx.fillStyle = col;
    ctx.fill(sp.path);
  } else {
    ctx.strokeStyle = col;
    ctx.lineWidth = s.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(sp.path);
  }
  ctx.restore();
}
