import type { Step, StepList } from '@lemma/steps-engine';
import { h, tex } from './dom';

/** A worked solution: method, numbered steps (reason + typeset math), and how it was checked. */
export function renderSteps(list: StepList, opts: { onAsk?: (step: Step, i: number) => void } = {}): HTMLElement {
  const box = h('div', { class: 'steps-box', 'data-testid': 'steps' });
  const head = h('div', { class: 'steps-head' }, h('span', { class: 'steps-method' }, list.method));
  if (list.verified === true) head.append(h('span', { class: 'steps-check', title: list.how ?? 'Checked' }, '✓ checked'));
  box.append(head);
  const methods = [{ method: list.method, steps: list.steps }, ...(list.alt ?? [])];
  const ol = h('ol', { class: 'steps-list' });
  const draw = (steps: Step[]) => {
    // "Solution: x = 4" straight after "Divide both sides by 2: x = 4" says the same thing twice.
    const shown = steps.filter((s, i) => !(i > 0 && s.latex && s.latex === steps[i - 1]!.latex && /^(?:solution|answer|so|therefore|result)\b/i.test(s.reason)));
    ol.replaceChildren(
      ...shown.map((s, i) => {
        const li = h('li', { class: 'step' });
        const reason = h('div', { class: 'step-reason' }, s.reason);
        if (s.verified === false) reason.append(h('span', { class: 'step-warn', title: 'This step could not be checked' }, ' (unchecked)'));
        li.append(reason);
        if (s.latex) li.append(tex(s.latex, true, 'step-math'));
        if (s.table) li.append(table(s.table));
        if (opts.onAsk && (s.detail || i > 0)) {
          li.append(h('button', { type: 'button', class: 'link step-ask', onclick: () => opts.onAsk!(s, i) }, 'Why?'));
        }
        return li;
      }),
    );
  };
  if (methods.length > 1) {
    const tabs = h('div', { class: 'steps-tabs', role: 'tablist', 'aria-label': 'Method' });
    methods.forEach((m, i) => {
      const b = h('button', { type: 'button', role: 'tab', class: 'steps-tab', 'aria-selected': String(i === 0) }, m.method);
      b.addEventListener('click', () => {
        tabs.querySelectorAll('button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
        draw(m.steps);
      });
      tabs.append(b);
    });
    box.append(tabs);
  }
  draw(list.steps);
  box.append(ol);
  if (list.intervals?.length) box.append(numberLine(list.intervals));
  return box;
}

export function table(t: { columns: string[]; rows: string[][] }): HTMLElement {
  const tb = h('table', { class: 'steps-table' });
  const hr = tb.createTHead().insertRow();
  for (const c of t.columns) hr.append(h('th', {}, c));
  const body = tb.createTBody();
  for (const r of t.rows) {
    const tr = body.insertRow();
    for (const c of r) tr.insertCell().textContent = c;
  }
  return h('div', { class: 'table-wrap' }, tb);
}

/** A solution set on a number line: filled dots for included ends, open circles for excluded, shaded runs. */
export function numberLine(iv: NonNullable<StepList['intervals']>): HTMLElement {
  const pts = iv.flatMap(([a, b]) => [a, b]).filter((x): x is number => x !== null && Number.isFinite(x));
  let lo = pts.length ? Math.min(...pts) : -5;
  let hi = pts.length ? Math.max(...pts) : 5;
  if (hi - lo < 1e-9) {
    lo -= 3;
    hi += 3;
  }
  const pad = (hi - lo) * 0.35 || 2;
  lo -= pad;
  hi += pad;
  const W = 320;
  const H = 54;
  const X = (v: number) => 16 + ((v - lo) / (hi - lo)) * (W - 32);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'number-line');
  svg.setAttribute('role', 'img');
  const label = iv.map(([a, b, ac, bc, at, bt]) => (a === b && a !== null ? `the point ${at}` : `${a === null ? 'from minus infinity' : `from ${at} (${ac ? 'included' : 'excluded'})`} ${b === null ? 'to infinity' : `to ${bt} (${bc ? 'included' : 'excluded'})`}`)).join(', and ');
  svg.setAttribute('aria-label', `Number line: ${label}`);
  const el = (tag: string, a: Record<string, string | number>) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(a)) e.setAttribute(k, String(v));
    svg.append(e);
    return e;
  };
  const y = 22;
  el('line', { x1: 6, y1: y, x2: W - 6, y2: y, class: 'nl-axis' });
  el('path', { d: `M${W - 12} ${y - 5} L${W - 5} ${y} L${W - 12} ${y + 5}`, class: 'nl-axis', fill: 'none' });
  el('path', { d: `M12 ${y - 5} L5 ${y} L12 ${y + 5}`, class: 'nl-axis', fill: 'none' });
  for (const [a, b, ac, bc, at, bt] of iv) {
    const xa = a === null ? 6 : X(a);
    const xb = b === null ? W - 6 : X(b);
    if (xb > xa) el('line', { x1: xa, y1: y, x2: xb, y2: y, class: 'nl-run' });
    const dot = (x: number, closed: boolean, t: string) => {
      el('circle', { cx: x, cy: y, r: 5, class: closed ? 'nl-dot' : 'nl-open' });
      const tt = el('text', { x, y: y + 22, 'text-anchor': 'middle', class: 'nl-label' });
      tt.textContent = t.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '$1/$2').replace(/\\sqrt\{([^}]*)\}/g, '√$1').replace(/\\pi/g, 'π').replace(/[\\{}]/g, '').replace(/^-/, '−');
    };
    if (a !== null) dot(xa, ac, at);
    if (b !== null && b !== a) dot(xb, bc, bt);
  }
  return h('figure', { class: 'nl-wrap' }, svg as unknown as Node);
}
