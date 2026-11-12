import { clear, h } from './dom';
import type { ExamHost } from './types';

/**
 * The on-screen calculator in exam rooms is Lemma itself: every line goes to the app's engine through
 * the host's compute(). The graphing kind adds a plot area driven by the graph engine.
 */
export function mountCalculator(host: ExamHost, kind: 'basic' | 'scientific' | 'graphing'): { root: HTMLElement; focus(): void; destroy(): void } {
  const log = h('ol', { class: 'ex-calc-log', 'aria-live': 'polite', 'aria-label': 'Calculator history' });
  const input = h('input', { class: 'ex-calc-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Calculator input', placeholder: kind === 'basic' ? '12 × 7.5' : kind === 'graphing' ? '3x + 2 = 11, or y = x^2 − 4' : 'sqrt(2) * sin(30°)' });
  let ans = '';
  // Like a real exam calculator: a DEG/RAD switch, starting in the app's mode.
  let angle: 'deg' | 'rad' = host.angle?.() ?? 'deg';
  let graph: { setSpec(s: unknown): void; destroy(): void; root: HTMLElement } | null = null;
  const plot = h('div', { class: 'ex-calc-graph', hidden: true });

  async function run(q: string) {
    q = q.trim();
    if (!q) return;
    const row = h('li', null, h('span', { class: 'ex-calc-q', text: q }), h('span', { class: 'ex-calc-a', text: '…' }));
    log.append(row);
    log.scrollTop = log.scrollHeight;
    const out = row.lastElementChild as HTMLElement;
    if (kind === 'graphing' && (await maybeGraph(q))) {
      out.textContent = 'Graphed';
      return;
    }
    try {
      const r = await host.compute(q.replace(/\bans\b/gi, ans ? `(${ans})` : '0'), { angle });
      if (r.ok && r.display) {
        out.textContent = r.display;
        ans = r.display.replace(/^[^=]*=\s*/, '').replace(/[^\d.eE+\-−/()π√^ ]/g, '').trim() || ans;
      } else {
        out.textContent = r.message ?? 'Can’t compute that';
        out.classList.add('ex-calc-err');
      }
    } catch (e) {
      out.textContent = (e as Error).message || 'Error';
      out.classList.add('ex-calc-err');
    }
    log.scrollTop = log.scrollHeight;
  }

  async function maybeGraph(q: string): Promise<boolean> {
    const [{ isGraphRequest, parseGraph }, { createSession }] = await Promise.all([import('@lemma/graph-engine'), import('@lemma/math-core')]);
    if (!isGraphRequest(q)) return false;
    try {
      const spec = parseGraph(q, createSession());
      if (!spec.items.length) return false;
      const { GraphView } = await import('../graph/view');
      plot.hidden = false;
      if (graph) graph.setSpec(spec);
      else {
        graph = new GraphView(spec) as unknown as typeof graph;
        clear(plot);
        plot.append(graph!.root);
      }
      return true;
    } catch {
      return false;
    }
  }

  const insert = (s: string) => {
    const a = input.selectionStart ?? input.value.length;
    const b = input.selectionEnd ?? a;
    input.value = input.value.slice(0, a) + s + input.value.slice(b);
    input.setSelectionRange(a + s.length, a + s.length);
    input.focus();
  };
  const key = (label: string, act: string | (() => void), aria?: string, cls = '') =>
    h('button', { type: 'button', class: `ex-calc-key ${cls}`, 'aria-label': aria ?? label, onclick: () => (typeof act === 'string' ? insert(act) : act()) }, label);
  const submit = () => {
    const q = input.value;
    input.value = '';
    void run(q);
    input.focus();
  };
  const rows: HTMLElement[][] = [];
  const angleKey = key(angle.toUpperCase(), () => {
    angle = angle === 'deg' ? 'rad' : 'deg';
    angleKey.textContent = angle.toUpperCase();
    angleKey.setAttribute('aria-label', angleLabel());
    angleKey.setAttribute('aria-pressed', String(angle === 'rad'));
  }, '', 'op ex-calc-angle');
  const angleLabel = () => `Angle mode: ${angle === 'deg' ? 'degrees' : 'radians'}. Switch to ${angle === 'deg' ? 'radians' : 'degrees'}`;
  angleKey.setAttribute('aria-label', angleLabel());
  angleKey.setAttribute('aria-pressed', String(angle === 'rad'));
  if (kind !== 'basic') rows.push([angleKey, key('sin', 'sin('), key('cos', 'cos('), key('tan', 'tan('), key('ln', 'ln('), key('log', 'log(')], [key('√', 'sqrt(', 'square root'), key('xʸ', '^', 'power'), key('π', 'pi', 'pi'), key('(', '('), key(')', ')')]);
  rows.push(
    [key('7', '7'), key('8', '8'), key('9', '9'), key('÷', '/', 'divide', 'op'), key('⌫', () => insert(''), 'backspace', 'op')],
    [key('4', '4'), key('5', '5'), key('6', '6'), key('×', '*', 'times', 'op'), key('AC', () => ((input.value = ''), clear(log), (ans = '')), 'clear all', 'op')],
    [key('1', '1'), key('2', '2'), key('3', '3'), key('−', '-', 'minus', 'op'), key('ans', 'ans', 'previous answer', 'op')],
    [key('0', '0'), key('.', '.', 'decimal point'), key('±', '-', 'negative'), key('+', '+', 'plus', 'op'), key('=', submit, 'equals', 'eq')],
  );
  // ⌫ deletes one character.
  rows[rows.length - 4]![4]!.onclick = () => {
    const a = input.selectionStart ?? input.value.length;
    const b = input.selectionEnd ?? a;
    const from = a === b ? Math.max(0, a - 1) : a;
    input.value = input.value.slice(0, from) + input.value.slice(b);
    input.setSelectionRange(from, from);
    input.focus();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });
  const pad = h('div', { class: 'ex-calc-pad' }, rows.map((r) => h('div', { class: 'ex-calc-row' }, r)));
  const root = h('div', { class: `ex-calc ex-calc-${kind}` }, plot, log, h('div', { class: 'ex-calc-entry' }, input, h('button', { type: 'button', class: 'ex-calc-go', onclick: submit, 'aria-label': 'Calculate' }, '=')), pad);
  return {
    root,
    focus: () => input.focus(),
    destroy: () => graph?.destroy(),
  };
}

/** Built-in reference sheet (original wording and drawings). */
export function referenceSheet(source: string | undefined): HTMLElement {
  // Our drawn sheet covers the standard geometry reference; other text is shown as given.
  if (source && source !== 'math-reference' && !(/circle/i.test(source) && /pythag|c² = a² \+ b²/i.test(source))) {
    return h('div', { class: 'ex-ref' }, source.split('\n').filter(Boolean).map((l) => h('p', { text: l })));
  }
  const fig = (svg: string, caption: string, ...formulas: string[]) => {
    const f = h('figure', { class: 'ex-ref-fig' });
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 120 80');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = svg;
    f.append(s, h('figcaption', null, h('strong', { text: caption }), ...formulas.map((x) => h('span', { text: x }))));
    return f;
  };
  const S = 'fill="none" stroke="currentColor" stroke-width="1.6"';
  return h('div', { class: 'ex-ref' },
    h('div', { class: 'ex-ref-grid' },
      fig(`<circle cx="60" cy="40" r="28" ${S}/><path d="M60 40h28" ${S}/><text x="70" y="36" font-size="10" fill="currentColor">r</text>`, 'Circle', 'A = πr²', 'C = 2πr'),
      fig(`<rect x="22" y="18" width="76" height="44" ${S}/><text x="56" y="74" font-size="10" fill="currentColor">ℓ</text><text x="102" y="44" font-size="10" fill="currentColor">w</text>`, 'Rectangle', 'A = ℓw'),
      fig(`<path d="M15 64h90L48 16z" ${S}/><path d="M48 16v48" ${S} stroke-dasharray="3 3"/><text x="52" y="44" font-size="10" fill="currentColor">h</text><text x="58" y="76" font-size="10" fill="currentColor">b</text>`, 'Triangle', 'A = ½bh'),
      fig(`<path d="M25 64h70V18z" ${S}/><path d="M85 64v-10h10" ${S}/><text x="52" y="36" font-size="10" fill="currentColor">c</text><text x="98" y="44" font-size="10" fill="currentColor">a</text><text x="58" y="76" font-size="10" fill="currentColor">b</text>`, 'Right triangle', 'c² = a² + b²'),
      fig(`<path d="M20 64h60l20-14H40z M20 64V30h60v34 M80 30l20-14v34 M20 30l20-14h60" ${S}/>`, 'Box', 'V = ℓwh'),
      fig(`<ellipse cx="60" cy="18" rx="26" ry="7" ${S}/><path d="M34 18v44M86 18v44" ${S}/><path d="M34 62a26 7 0 0 0 52 0" ${S}/>`, 'Cylinder', 'V = πr²h'),
      fig(`<circle cx="60" cy="40" r="28" ${S}/><ellipse cx="60" cy="40" rx="28" ry="8" ${S} stroke-dasharray="3 3"/>`, 'Sphere', 'V = (4/3)πr³'),
      fig(`<path d="M34 64l26-50 26 50" ${S}/><ellipse cx="60" cy="64" rx="26" ry="7" ${S}/>`, 'Cone', 'V = (1/3)πr²h'),
      fig(`<path d="M20 64h60L60 20z M60 20l20 44 20-20z" ${S}/>`, 'Pyramid', 'V = (1/3)ℓwh'),
      fig(`<path d="M20 64h70L20 24z" ${S}/><path d="M28 64a10 10 0 0 0-2-7" ${S}/><text x="32" y="60" font-size="8" fill="currentColor">30°</text><text x="22" y="34" font-size="8" fill="currentColor">60°</text>`, 'Special right triangles', '30°-60°-90°: x, x√3, 2x', '45°-45°-90°: s, s, s√2'),
    ),
    h('ul', { class: 'ex-ref-facts' },
      h('li', { text: 'The number of degrees of arc in a circle is 360.' }),
      h('li', { text: 'The number of radians of arc in a circle is 2π.' }),
      h('li', { text: 'The sum of the measures in degrees of the angles of a triangle is 180.' }),
    ),
  );
}
