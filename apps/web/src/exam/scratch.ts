import { h, icon } from './dom';

/**
 * A small drawing surface for show-work space: pen, eraser, clear. Pointer events (mouse, pen, touch);
 * the drawing is kept as a PNG data URL so it survives autosave and reload.
 */
export function scratchPad(opts: { label: string; height?: number; initial?: string; ink?: string; onChange(dataUrl: string | null): void }): HTMLElement {
  const height = opts.height ?? 200;
  const canvas = h('canvas', { class: 'ex-scratch-canvas', 'aria-label': opts.label, role: 'img', tabindex: '0' });
  canvas.style.height = `${height}px`;
  let mode: 'pen' | 'erase' = 'pen';
  let empty = !opts.initial;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let img: HTMLImageElement | null = null;

  const fit = () => {
    const w = canvas.clientWidth;
    if (!w || !ctx) return;
    const snapshot = !empty && canvas.width ? canvas.toDataURL() : opts.initial;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (snapshot) {
      img = new Image();
      img.onload = () => ctx.drawImage(img!, 0, 0, w, height);
      img.src = snapshot;
    }
  };
  // Fires on removal too (size goes to zero), which is when it lets go.
  const ro = new ResizeObserver(() => (canvas.isConnected ? fit() : ro.disconnect()));
  ro.observe(canvas);

  let drawing = false;
  let lx = 0;
  let ly = 0;
  const pos = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (!ctx) return;
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    [lx, ly] = pos(e);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing || !ctx) return;
    const [x, y] = pos(e);
    ctx.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = opts.ink ?? '#2b2b2b';
    ctx.lineWidth = mode === 'erase' ? 16 : 1.8 + (e.pressure && e.pointerType === 'pen' ? e.pressure * 1.5 : 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(x, y);
    ctx.stroke();
    lx = x;
    ly = y;
    empty = false;
  });
  const end = () => {
    if (!drawing) return;
    drawing = false;
    opts.onChange(empty ? null : canvas.toDataURL('image/png'));
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  const tool = (name: 'pen' | 'erase', label: string, ico: string) =>
    h('button', {
      type: 'button',
      class: 'ex-scratch-tool',
      'aria-pressed': String(mode === name),
      'aria-label': label,
      title: label,
      onclick: (e: Event) => {
        mode = name;
        bar.querySelectorAll('[aria-pressed]').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
      },
    }, icon(ico));
  const bar = h('div', { class: 'ex-scratch-bar', role: 'toolbar', 'aria-label': `${opts.label} tools` },
    tool('pen', 'Pen', 'pencil'),
    tool('erase', 'Eraser', 'scratch'),
    h('button', {
      type: 'button',
      class: 'ex-scratch-tool',
      'aria-label': 'Clear drawing',
      title: 'Clear drawing',
      onclick: () => {
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
        empty = true;
        opts.onChange(null);
      },
    }, icon('trash')),
  );
  const root = h('div', { class: 'ex-scratch' }, bar, canvas);
  return root;
}
