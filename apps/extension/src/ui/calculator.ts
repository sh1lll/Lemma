import { HISTORY_LIMIT } from '../config';
import { calculateLine, keepLine, type Solution } from '../core/solve';
import { h } from './dom';

export interface HistoryItem {
  q: string;
  a: string;
}

async function loadHistory(): Promise<HistoryItem[]> {
  try {
    const { history } = await chrome.storage.local.get('history');
    return Array.isArray(history) ? (history as HistoryItem[]).filter((x) => typeof x?.q === 'string' && typeof x?.a === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The compact Lemma calculator: type for a live answer, Enter keeps it in history (storage.local, shared by
 * the popup and the side panel). `onSolution` lets the side panel offer steps for what was typed.
 */
export function mountCalculator(root: HTMLElement, opts: { autofocus?: boolean; onSolution?: (s: Solution | null) => void } = {}) {
  const input = h('input', {
    class: 'field calc-input',
    type: 'text',
    placeholder: 'Type a calculation, e.g. 15% of 80',
    'aria-label': 'Calculation',
    autocomplete: 'off',
    spellcheck: 'false',
    'data-testid': 'calc-input',
  });
  const expr = h('div', { class: 'calc-expr', 'aria-hidden': 'true' });
  const answer = h('output', { class: 'calc-answer', 'aria-live': 'polite', 'data-testid': 'calc-answer', for: '' });
  const list = h('ul', { class: 'history', 'aria-label': 'History' });
  const clear = h('button', { class: 'btn', type: 'button', onclick: () => void setHistory([]) }, 'Clear history');
  const histHead = h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', {}, 'History'), clear);
  root.append(h('div', { class: 'stack' }, input, h('div', {}, answer, expr), histHead, list));

  let gen = 0;
  let last: Solution | null = null;
  let history: HistoryItem[] = [];

  function renderHistory() {
    list.replaceChildren(
      ...history.map((it) =>
        h(
          'li',
          {},
          h(
            'button',
            {
              type: 'button',
              title: 'Use again',
              onclick: () => {
                input.value = it.q;
                void update();
                input.focus();
              },
            },
            h('span', { class: 'h-q' }, it.q),
            h('span', { class: 'h-a' }, it.a),
          ),
        ),
      ),
    );
    if (!history.length) list.append(h('li', { class: 'muted' }, 'Results you keep with Enter appear here.'));
    clear.hidden = !history.length;
  }

  async function setHistory(items: HistoryItem[]) {
    history = items.slice(0, HISTORY_LIMIT);
    renderHistory();
    try {
      await chrome.storage.local.set({ history });
    } catch {
      /* storage unavailable: keep it in memory */
    }
  }

  async function update() {
    const q = input.value;
    const my = ++gen;
    if (!q.trim()) {
      answer.textContent = '';
      expr.textContent = '';
      delete answer.dataset.state;
      last = null;
      opts.onSolution?.(null);
      return;
    }
    const s = await calculateLine(q).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }) as Solution);
    if (my !== gen) return;
    last = s;
    if (s.ok && s.answer) {
      answer.textContent = s.answer.display;
      delete answer.dataset.state;
      expr.textContent = s.expression && s.expression !== q.trim() ? s.expression : '';
    } else {
      answer.textContent = s.error ?? '';
      answer.dataset.state = 'error';
      expr.textContent = '';
    }
    opts.onSolution?.(s);
  }

  input.addEventListener('input', () => void update());
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const s = last;
    if (!s?.ok || !s.answer) return;
    keepLine(input.value);
    void setHistory([{ q: input.value.trim(), a: s.answer.display }, ...history.filter((x) => x.q !== input.value.trim())]);
    input.select();
  });

  void loadHistory().then((items) => {
    history = items;
    renderHistory();
  });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && c.history && Array.isArray(c.history.newValue)) {
      history = c.history.newValue as HistoryItem[];
      renderHistory();
    }
  });
  if (opts.autofocus) setTimeout(() => input.focus(), 0);

  return {
    input,
    set(q: string) {
      input.value = q;
      void update();
    },
  };
}
