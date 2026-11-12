import { formatDay, type ProgressStats } from '@lemma/agenda-engine';

/**
 * Small inline SVG charts. Colours come from the app's CSS variables (via classes in agenda.css), so they follow
 * every look and light/dark. Each chart has a text summary as its accessible name.
 */

const NS = 'http://www.w3.org/2000/svg';

function svg(tag: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

function frame(w: number, h: number, label: string, cls: string): SVGSVGElement {
  const s = svg('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': label, class: `ag-chart ${cls}`, preserveAspectRatio: 'xMidYMid meet' }) as SVGSVGElement;
  s.append(svg('title', {}, label));
  return s;
}

/** Problems per day as bars; days with only a lesson get a dot so the streak is visible. */
export function dailyBars(daily: ProgressStats['daily'], locale: string): SVGSVGElement {
  const W = 320;
  const H = 120;
  const top = 12;
  const base = 96;
  const max = Math.max(1, ...daily.map((d) => d.problems));
  const total = daily.reduce((s, d) => s + d.problems, 0);
  const best = daily.reduce((b, d) => (d.problems > b.problems ? d : b), daily[0] ?? { day: '', problems: 0, active: false });
  const label = `Problems per day, last ${daily.length} days: ${total} in total${best.problems ? `, most on ${formatDay(best.day, locale)} (${best.problems})` : ''}.`;
  const s = frame(W, H, label, 'ag-chart-bars');
  const slot = W / daily.length;
  const bw = Math.max(4, slot * 0.62);
  s.append(svg('line', { x1: 0, x2: W, y1: base + 0.5, y2: base + 0.5, class: 'ag-axis' }));
  daily.forEach((d, i) => {
    const x = i * slot + (slot - bw) / 2;
    if (d.problems > 0) {
      const h = Math.max(3, ((base - top) * d.problems) / max);
      const r = svg('rect', { x: x.toFixed(1), y: (base - h).toFixed(1), width: bw.toFixed(1), height: h.toFixed(1), rx: 3, class: 'ag-bar' });
      r.append(svg('title', {}, `${formatDay(d.day, locale)}: ${d.problems} problem${d.problems === 1 ? '' : 's'}`));
      s.append(r);
    } else if (d.active) {
      s.append(svg('circle', { cx: (x + bw / 2).toFixed(1), cy: base - 4, r: 2.5, class: 'ag-dot' }));
    }
    const first = i === 0;
    const last = i === daily.length - 1;
    const mid = i === Math.floor((daily.length - 1) / 2);
    if (first || last || mid) {
      s.append(
        svg('text', { x: (x + bw / 2).toFixed(1), y: H - 6, 'text-anchor': first ? 'start' : last ? 'end' : 'middle', class: 'ag-tick' }, last ? 'Today' : formatDay(d.day, locale, { month: 'short', day: 'numeric' })),
      );
    }
  });
  s.append(svg('text', { x: 0, y: top - 2, class: 'ag-tick' }, String(max)));
  return s;
}

/** Accuracy per 7-day window as a line; weeks without graded answers leave a gap. */
export function accuracyLine(trend: ProgressStats['trend'], locale: string): SVGSVGElement {
  const W = 320;
  const H = 120;
  const L = 30;
  const R = 8;
  const top = 10;
  const base = 92;
  const pts = trend.map((t, i) => ({ ...t, x: L + ((W - L - R) * i) / Math.max(1, trend.length - 1) }));
  const known = pts.filter((p) => p.accuracy !== null);
  const label = known.length
    ? `Accuracy by week, last ${trend.length} weeks: ${known.map((p) => `${Math.round(p.accuracy! * 100)}%`).join(', ')}; this week ${trend.at(-1)?.accuracy == null ? 'no graded answers' : `${Math.round(trend.at(-1)!.accuracy! * 100)}%`}.`
    : 'Accuracy by week: no graded answers yet.';
  const s = frame(W, H, label, 'ag-chart-line');
  const y = (a: number) => base - (base - top) * a;
  for (const g of [0, 0.5, 1]) {
    s.append(svg('line', { x1: L, x2: W - R, y1: y(g), y2: y(g), class: g === 0 ? 'ag-axis' : 'ag-grid' }));
    s.append(svg('text', { x: L - 6, y: y(g) + 4, 'text-anchor': 'end', class: 'ag-tick' }, `${g * 100}%`));
  }
  // Consecutive known points are joined; a week without data breaks the line.
  let seg: string[] = [];
  const flush = () => {
    if (seg.length > 1) s.append(svg('polyline', { points: seg.join(' '), class: 'ag-line' }));
    seg = [];
  };
  for (const p of pts) {
    if (p.accuracy === null) flush();
    else seg.push(`${p.x.toFixed(1)},${y(p.accuracy).toFixed(1)}`);
  }
  flush();
  for (const p of known) {
    const c = svg('circle', { cx: p.x.toFixed(1), cy: y(p.accuracy!).toFixed(1), r: 3.5, class: 'ag-point' });
    c.append(svg('title', {}, `${formatDay(p.start, locale, { month: 'short', day: 'numeric' })}–${formatDay(p.end, locale, { month: 'short', day: 'numeric' })}: ${Math.round(p.accuracy! * 100)}% of ${p.graded}`));
    s.append(c);
  }
  const first = pts[0];
  const last = pts.at(-1);
  if (first) s.append(svg('text', { x: first.x, y: H - 6, 'text-anchor': 'start', class: 'ag-tick' }, formatDay(first.end, locale, { month: 'short', day: 'numeric' })));
  if (last) s.append(svg('text', { x: last.x, y: H - 6, 'text-anchor': 'end', class: 'ag-tick' }, 'This week'));
  return s;
}
