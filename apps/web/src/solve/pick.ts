import './solve.css';
import { h } from './dom';
import type { SolveHost } from './host';
import { inkPad } from './ink';
import { mathFromOcr, misreadFixes, recognize, warmOcr } from './ocr';
import type { Outcome } from '../engine';
import { asked } from './sheet';

/**
 * The draw sheet: a pad for handwriting, read on this device and shown as editable lines before anything is
 * solved. Photos and worksheets go to the photo-solve screen (snap.ts); an image pasted here goes there too.
 */
export interface PickOptions {
  tab?: 'draw';
}

let dialog: HTMLDialogElement | null = null;

export function openPicker(host: SolveHost, _o: PickOptions = {}): void {
  dialog?.remove();
  // The reader (and its one-time data) starts loading now, while the problem is being written.
  warmOcr();
  const d = h('dialog', { class: 'pick', 'aria-label': 'Draw a problem', 'data-testid': 'picker' });
  dialog = d;
  const body = h('div', { class: 'pick-inner' });
  const close = h('button', { type: 'button', class: 'icon-btn ghost', 'aria-label': 'Close', onclick: () => d.close() }, '×');
  const panel = h('div', { class: 'pick-panel' });
  body.append(h('div', { class: 'pick-head' }, h('h2', {}, 'Draw a problem'), close), panel);
  d.append(body);
  d.addEventListener('close', () => {
    d.remove();
    if (dialog === d) dialog = null;
  });
  // A pasted image is a photo: solve it on the photo screen.
  d.addEventListener('paste', (e) => {
    const f = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))?.getAsFile();
    if (f) {
      e.preventDefault();
      d.close();
      void import('./snap').then((m) => m.openSnap(host, { files: [f] }));
    }
  });
  document.body.append(d);
  d.showModal();
  drawPanel(host, panel, d);
}

/** What an outcome shows as its answer, for the live preview under a line that was read. */
function answerOf(o: Outcome): string {
  if (o.kind === 'calc') return o.result.formatted.display;
  if (o.kind === 'convert') return `${o.result.results[0]!.formatted.display} ${o.result.results[0]!.unit.symbol}`;
  if (o.kind === 'answer' && o.result.kind !== 'hint') return o.result.primary.display + (o.result.primary.unit ? ` ${o.result.primary.unit}` : '');
  return '';
}

/**
 * Editable recognised lines, each with its answer worked out live (so a misread shows up as a wrong-looking
 * answer before anything is solved), one-tap fixes for the usual misreads, and Solve; plus Solve all.
 * Returns the line inputs, in order.
 */
export function showLines(host: SolveHost, box: HTMLElement, d: HTMLDialogElement, found: string[], status?: HTMLElement): HTMLInputElement[] {
  const inputs: HTMLInputElement[] = [];
  box.replaceChildren(
    ...found.map((q, i) => {
      const input = h('input', { value: q, 'aria-label': `Problem ${i + 1}`, 'data-testid': 'pick-line', spellcheck: 'false', autocomplete: 'off' });
      inputs.push(input);
      const go = h('button', { type: 'button', class: 'chip', 'data-testid': 'pick-solve' }, 'Solve');
      const answer = h('span', { class: 'pick-answer', 'data-testid': 'pick-answer', 'aria-live': 'polite' });
      const fixes = h('div', { class: 'pick-fixes', 'aria-label': 'Fix a misread' });
      let gen = 0;
      const update = () => {
        const text = input.value.trim();
        const mine = ++gen;
        answer.textContent = '';
        fixes.replaceChildren(
          ...misreadFixes(text).map(([label, fixed]) =>
            h('button', { type: 'button', class: 'chip fix', 'data-testid': 'pick-fix', title: `Change to “${fixed}”`, onclick: () => {
              input.value = fixed;
              update();
              input.focus();
            } }, label),
          ),
        );
        if (!text) return;
        const o = host.route(asked(text));
        if (o.kind !== 'pending') return void (answer.textContent = answerOf(o) ? `= ${answerOf(o)}` : '');
        // Engines still loading or algebra being worked out: fill it in when it's ready.
        void host.compute(asked(text)).then((r) => mine === gen && (answer.textContent = answerOf(r) ? `= ${answerOf(r)}` : ''), () => undefined);
      };
      let t = 0;
      input.addEventListener('input', () => {
        clearTimeout(t);
        t = window.setTimeout(update, 150);
      });
      go.addEventListener('click', () => {
        if (!input.value.trim()) return input.focus();
        d.close();
        host.submit(asked(input.value.trim()));
      });
      input.addEventListener('keydown', (e) => e.key === 'Enter' && go.click());
      update();
      return h('div', { class: 'pick-line-wrap' }, h('div', { class: 'pick-line' }, input, go), h('div', { class: 'pick-line-meta' }, answer, fixes));
    }),
  );
  if (found.length > 1) {
    const all = h('button', { type: 'button', class: 'chip primary' }, 'Solve all with steps');
    all.addEventListener('click', () => {
      const qs = inputs.map((x) => x.value.trim()).filter(Boolean);
      const panel = box.closest('.pick-panel') as HTMLElement;
      void import('./sheet').then((m) => m.solveList(host, panel, qs));
    });
    box.append(h('div', { class: 'pick-row' }, all));
  } else {
    // One problem: Solve is the obvious next step.
    box.querySelector('[data-testid="pick-solve"]')?.classList.add('primary');
  }
  if (status && !found.some(Boolean)) inputs[0]?.focus();
  return inputs;
}

export function cropCanvas(bitmap: ImageBitmap, r: { x: number; y: number; w: number; h: number }): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = r.w;
  c.height = r.h;
  c.getContext('2d')!.drawImage(bitmap, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  return c;
}

export type Box = { x: number; y: number; w: number; h: number };

/**
 * The picture with a draggable selection (in image pixels; all of it by default). `onSelect` runs when a drag ends
 * on a real region. `mark` outlines found problems; tapping one selects it.
 */
export function cropper(bitmap: ImageBitmap, onSelect: () => void = () => {}): { wrap: HTMLElement; region: () => Box; mark: (items: { box: Box; pick: () => void }[]) => void } {
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 1200 / bitmap.width);
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const box = h('div', { class: 'crop-box', hidden: true });
  const marks = h('div', { class: 'crop-marks' });
  // The picture, its outlines and the selection share one box the exact size of the picture (so percentages line up).
  const inner = h('div', { class: 'crop-inner' }, canvas, marks, box);
  const wrap = h('div', { class: 'crop-wrap', 'data-testid': 'crop' }, inner);
  let sel: { x0: number; y0: number; x1: number; y1: number } | null = null;
  let start: { x: number; y: number } | null = null;
  const pos = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const draw = () => {
    if (!sel) return (box.hidden = true);
    box.hidden = false;
    // Percent of the picture, so it stays put when the sheet resizes (and needs no measuring).
    box.style.left = `${Math.min(sel.x0, sel.x1) * 100}%`;
    box.style.top = `${Math.min(sel.y0, sel.y1) * 100}%`;
    box.style.width = `${Math.abs(sel.x1 - sel.x0) * 100}%`;
    box.style.height = `${Math.abs(sel.y1 - sel.y0) * 100}%`;
  };
  wrap.addEventListener('pointerdown', (e) => {
    if ((e.target as Element).closest('.crop-mark')) return;
    start = pos(e);
    sel = null;
    wrap.setPointerCapture(e.pointerId);
    draw();
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!start) return;
    const p = pos(e);
    sel = { x0: start.x, y0: start.y, x1: p.x, y1: p.y };
    draw();
  });
  wrap.addEventListener('pointerup', () => {
    if (!start) return;
    start = null;
    if (sel && (Math.abs(sel.x1 - sel.x0) < 0.02 || Math.abs(sel.y1 - sel.y0) < 0.02)) sel = null;
    draw();
    if (sel) onSelect();
  });
  const region = (): Box => {
    if (!sel) return { x: 0, y: 0, w: bitmap.width, h: bitmap.height };
    const x = Math.round(Math.min(sel.x0, sel.x1) * bitmap.width);
    const y = Math.round(Math.min(sel.y0, sel.y1) * bitmap.height);
    return { x, y, w: Math.max(8, Math.round(Math.abs(sel.x1 - sel.x0) * bitmap.width)), h: Math.max(8, Math.round(Math.abs(sel.y1 - sel.y0) * bitmap.height)) };
  };
  const mark = (items: { box: Box; pick: () => void }[]) => {
    marks.replaceChildren(
      ...items.map((it, i) => {
        const pad = 6;
        const m = h('button', { type: 'button', class: 'crop-mark', 'data-testid': 'crop-mark', 'aria-label': `Problem ${i + 1}` });
        m.style.left = `${(Math.max(0, it.box.x - pad) / bitmap.width) * 100}%`;
        m.style.top = `${(Math.max(0, it.box.y - pad) / bitmap.height) * 100}%`;
        m.style.width = `${((it.box.w + pad * 2) / bitmap.width) * 100}%`;
        m.style.height = `${((it.box.h + pad * 2) / bitmap.height) * 100}%`;
        m.addEventListener('click', () => {
          marks.querySelectorAll('.crop-mark').forEach((x) => x.classList.toggle('on', x === m));
          it.pick();
        });
        return m;
      }),
    );
  };
  return { wrap, region, mark };
}

// ---------- draw ----------
function drawPanel(host: SolveHost, panel: HTMLElement, d: HTMLDialogElement) {
  const pad = inkPad();
  const status = h('p', { class: 'pick-status', role: 'status', 'data-testid': 'ink-status' });
  const lines = h('div', { class: 'pick-lines' });
  const read = h('button', { type: 'button', class: 'chip primary', 'data-testid': 'ink-read' }, 'Read my writing');
  read.addEventListener('click', async () => {
    const img = pad.render();
    if (!img) {
      status.textContent = 'Write a problem first.';
      return;
    }
    read.disabled = true;
    try {
      const text = await recognize(img, (s, p) => (status.textContent = p > 0 && p < 1 ? `${s} ${Math.round(p * 100)}%` : s), 'line');
      const found = mathFromOcr(text);
      status.textContent = found.length ? 'Check what was read (handwriting is often misread), then solve.' : 'Couldn’t read that. Try writing larger and more spaced out, or type it.';
      showLines(host, lines, d, found.length ? found.slice(0, 1) : [''], status);
    } catch {
      status.textContent = 'The text reader couldn’t load (it needs one online visit to download its data).';
    } finally {
      read.disabled = false;
    }
  });
  panel.replaceChildren(
    pad.root,
    h('div', { class: 'pick-row' }, read, h('button', { type: 'button', class: 'chip', onclick: () => pad.undo() }, 'Undo'), h('button', { type: 'button', class: 'chip', onclick: () => pad.clear() }, 'Clear')),
    h('p', { class: 'pick-note' }, 'Write one line, large and clearly spaced. Reading is on this device and works best with digits, letters and + − = ( ); fractions and exponents are often misread.'),
    status,
    lines,
  );
}
