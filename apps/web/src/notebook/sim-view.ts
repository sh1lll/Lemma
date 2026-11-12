import type { CellOutput, SimulationSummary } from '@lemma/notebook-engine';

/**
 * Rendering for simulation results (estimate ± CI, exact comparison, histogram, re-run) and the notebook
 * assistant panel. Styles are injected once from here and use the app's theme tokens (--accent, --line,
 * --muted, --surface), so both light and dark themes work without touching the global stylesheet.
 */

const STYLE_ID = 'lemma-nb-ext-style';
const CSS = `
.nb-sim .nb-sim-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 12px; }
.nb-sim .nb-sim-ci { font-size: 14px; color: var(--muted); font-variant-numeric: tabular-nums; }
.nb-sim .nb-sim-exact { font-size: 13.5px; font-variant-numeric: tabular-nums; }
.nb-sim .nb-sim-exact.ok { color: var(--accent); }
.nb-sim .nb-sim-exact.off { color: var(--warn); }
.nb-sim .nb-sim-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: 12.5px; color: var(--muted); }
.nb-sim svg.nb-hist { width: 100%; max-width: 520px; height: auto; display: block; color: var(--muted); }
.nb-hist .nb-hist-bar { fill: color-mix(in srgb, var(--muted) 35%, transparent); }
.nb-hist .nb-hist-hit { fill: var(--accent); }
.nb-hist .nb-hist-axis { stroke: var(--line); stroke-width: 1; }
.nb-hist .nb-hist-est { stroke: var(--accent); stroke-width: 2; }
.nb-hist .nb-hist-exact { stroke: var(--ink, currentColor); stroke-width: 1.5; stroke-dasharray: 4 3; }
.nb-hist text { fill: currentColor; font: 10px var(--sans); }
.nb-ai { border: 1px solid var(--line); border-radius: var(--radius-sm, 14px); background: var(--surface); padding: 12px 14px; margin: 0 0 12px; display: grid; gap: 10px; }
.nb-ai[hidden] { display: none; }
.nb-ai-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.nb-ai-head h2 { font-size: 14px; margin: 0; font-weight: 600; }
.nb-ai-form { display: flex; gap: 8px; }
.nb-ai-form input { flex: 1; min-width: 0; font: inherit; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: var(--ink); }
.nb-ai-log { display: grid; gap: 8px; max-height: 50vh; overflow: auto; }
.nb-ai-log:empty { display: none; }
.nb-ai-note { font-size: 12px; color: var(--muted); margin: 0; }
.nb-ai-note:empty { display: none; }
.nb-proposal { border: 1px dashed var(--accent); border-radius: 10px; padding: 8px 10px; display: grid; gap: 6px; margin-top: 6px; }
.nb-proposal pre { margin: 0; white-space: pre-wrap; font: 13px var(--mono); max-height: 240px; overflow: auto; }
.nb-proposal .why { font-size: 12.5px; color: var(--muted); }
.nb-proposal .acts { display: flex; gap: 6px; }
.nb-proposal.done { opacity: 0.7; }
`;

export function ensureNotebookStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.append(s);
}

const SVG = 'http://www.w3.org/2000/svg';
function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

const num = (x: number, d = 4) => (Math.abs(x) >= 1e6 || (x !== 0 && Math.abs(x) < 1e-4) ? x.toExponential(2) : Number(x.toFixed(d)).toLocaleString('en-US', { maximumFractionDigits: d }));

/** Theme-aware SVG histogram; trials satisfying the event are drawn in the accent colour. */
export function histogramSvg(s: SimulationSummary): SVGSVGElement {
  const W = 320;
  const H = 132;
  const left = 8;
  const right = W - 8;
  const top = 8;
  const base = 104;
  const h = s.histogram;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'nb-hist', role: 'img' });
  const hits = h.bins.reduce((a, b) => a + b.hits, 0);
  svg.setAttribute(
    'aria-label',
    `Histogram of ${h.label} over ${s.trials.toLocaleString('en-US')} trials${s.mode === 'probability' && h.label !== 'outcome' ? `; ${hits.toLocaleString('en-US')} trials satisfy the event` : ''}`,
  );
  const max = Math.max(1, ...h.bins.map((b) => b.count));
  const n = h.bins.length;
  const slot = (right - left) / n;
  const gap = n > 40 ? 0.5 : Math.min(4, slot * 0.18);
  h.bins.forEach((b, i) => {
    const x = left + i * slot + gap / 2;
    const w = Math.max(0.5, slot - gap);
    const bh = ((base - top) * b.count) / max;
    const hh = ((base - top) * b.hits) / max;
    const title = el('title', {});
    title.textContent = `${h.discrete ? num(b.x0) : `${num(b.x0)} – ${num(b.x1)}`}: ${b.count.toLocaleString('en-US')} trials${b.hits && b.hits !== b.count ? ` (${b.hits.toLocaleString('en-US')} in the event)` : ''}`;
    const g = el('g', {});
    g.append(title, el('rect', { x, y: base - bh, width: w, height: bh, class: 'nb-hist-bar' }));
    if (hh > 0) g.append(el('rect', { x, y: base - hh, width: w, height: hh, class: 'nb-hist-hit' }));
    svg.append(g);
  });
  svg.append(el('line', { x1: left, x2: right, y1: base + 0.5, y2: base + 0.5, class: 'nb-hist-axis' }));

  // Axis labels: every bar for a few discrete values, otherwise the ends and the middle.
  const label = (x: number, text: string, anchor = 'middle') => {
    const t = el('text', { x, y: base + 13, 'text-anchor': anchor });
    t.textContent = text;
    svg.append(t);
  };
  if (h.label === 'outcome') {
    label(left + slot / 2, 'false');
    label(left + slot * 1.5, 'true');
  } else if (h.discrete && n <= 16) {
    h.bins.forEach((b, i) => label(left + (i + 0.5) * slot, num(b.x0)));
  } else {
    const first = h.bins[0]!;
    const last = h.bins[n - 1]!;
    const short = (x: number) => (h.discrete ? num(x) : Number(x.toPrecision(3)).toLocaleString('en-US'));
    label(left, short(first.x0), 'start');
    label(right, short(h.discrete ? last.x0 : last.x1), 'end');
    const mid = h.bins[Math.floor(n / 2)]!;
    label(left + (Math.floor(n / 2) + 0.5) * slot, short(mid.x0));
  }
  const caption = el('text', { x: W / 2, y: H - 3, 'text-anchor': 'middle' });
  caption.textContent = h.label === 'outcome' ? 'outcome' : h.label;
  svg.append(caption);

  // Mean estimate (solid) and exact mean (dashed) on a numeric axis.
  if (s.mode === 'mean' && n > 0) {
    const lo = h.bins[0]!.x0;
    const hi = h.discrete ? h.bins[n - 1]!.x0 : h.bins[n - 1]!.x1;
    const xOf = (v: number) => (h.discrete ? left + ((v - lo) / Math.max(1, hi - lo)) * (right - left - slot) + slot / 2 : left + ((v - lo) / Math.max(1e-12, hi - lo)) * (right - left));
    const mark = (v: number, cls: string) => {
      if (!(v >= lo && v <= hi)) return;
      svg.append(el('line', { x1: xOf(v), x2: xOf(v), y1: top - 4, y2: base, class: cls }));
    };
    mark(s.estimate, 'nb-hist-est');
    if (s.exact) mark(s.exact.value, 'nb-hist-exact');
  }
  return svg;
}

/** The output row for a `simulate …` line. */
export function simulationEl(o: CellOutput, showInput: boolean, onRerun: () => void): HTMLElement {
  const s = o.simulation!;
  const row = document.createElement('div');
  row.className = 'nb-result simulation nb-sim';
  const head = document.createElement('div');
  head.className = 'nb-value nb-sim-head';
  if (showInput) {
    const q = document.createElement('span');
    q.className = 'nb-q';
    q.textContent = `${o.input}  →  `;
    head.append(q);
  }
  const v = document.createElement('span');
  v.className = 'nb-sim-est';
  v.textContent = o.display ?? '';
  const ci = document.createElement('span');
  ci.className = 'nb-sim-ci';
  ci.textContent = `± ${num((s.hi - s.lo) / 2)} · 95% CI ${num(s.lo)} – ${num(s.hi)}`;
  head.append(v, ci);
  if (o.binding) {
    const b = document.createElement('span');
    b.className = 'nb-bound';
    b.textContent = `→ ${o.binding.name}`;
    b.title = 'Defined for the cells below';
    head.append(b);
  }
  row.append(head);

  if (s.exact) {
    const x = document.createElement('div');
    x.className = `nb-sim-exact ${s.exact.withinCI ? 'ok' : 'off'}`;
    x.textContent = `Exact ${s.mode === 'probability' ? 'probability' : 'mean'}: ${s.exact.fraction ? `${s.exact.fraction} ≈ ` : ''}${num(s.exact.value, 6)} — ${s.exact.withinCI ? 'inside the 95% CI ✓' : 'outside the 95% CI (expected about 1 run in 20)'}`;
    x.title = `Exact value ${s.exact.how}`;
    row.append(x);
  }
  row.append(histogramSvg(s));

  const meta = document.createElement('div');
  meta.className = 'nb-sim-meta';
  const info = document.createElement('span');
  info.textContent = `${s.trials.toLocaleString('en-US')} trials · seed ${s.seed}${s.seedGiven ? '' : ' (from the line’s text)'} · ${s.ms} ms`;
  const rerun = document.createElement('button');
  rerun.type = 'button';
  rerun.className = 'nb-btn nb-sim-rerun';
  rerun.textContent = 'Re-run';
  rerun.title = 'Run again with a new random seed (the seed is written into the line, so results stay reproducible)';
  rerun.setAttribute('aria-label', 'Re-run this simulation with a new seed');
  rerun.addEventListener('click', onRerun);
  meta.append(info, rerun);
  row.append(meta);

  const notes = (o.notes ?? []).filter((n) => !/^Exact value /.test(n));
  if (notes.length || s.exactNote) {
    const n = document.createElement('div');
    n.className = 'nb-notes';
    n.textContent = notes.join(' · ');
    row.append(n);
  }
  return row;
}
