import type { Outcome } from '@lemma/runtime';
import type { StepList } from '@lemma/steps-engine';
import { h } from './dom';
import type { SolveHost } from './host';
import { analyse, stepSource } from './index';
import { renderSteps } from './steps-view';

export interface Item {
  q: string;
  answer: string;
  ok: boolean;
  steps: StepList | null;
}

/** Question → answer → steps for every line, solved one after another. */
export function solveList(host: SolveHost, panel: HTMLElement, qs: string[]) {
  const status = h('p', { class: 'pick-status', role: 'status', 'data-testid': 'sheet-status' }, `Solving ${qs.length} question${qs.length > 1 ? 's' : ''}…`);
  const list = h('div', { class: 'sheet-list', 'data-testid': 'sheet-list' });
  const items: Item[] = qs.map((q) => ({ q, answer: '', ok: false, steps: null }));
  const exportRow = h('div', { class: 'pick-row', hidden: true });
  panel.replaceChildren(status, list, exportRow);
  const cards = items.map((it, i) => {
    const input = h('input', { value: it.q, 'aria-label': `Question ${i + 1}`, spellcheck: 'false', autocomplete: 'off' });
    const answer = h('div', { class: 'sheet-answer', 'data-testid': 'sheet-answer' }, '…');
    const steps = h('details', { class: 'sheet-steps' }, h('summary', {}, 'Steps'));
    steps.hidden = true;
    const redo = h('button', { type: 'button', class: 'chip' }, 'Solve');
    const card = h('div', { class: 'sheet-q', 'data-testid': 'sheet-q' }, h('div', { class: 'sheet-q-head' }, h('span', { class: 'sheet-num' }, `${i + 1}.`), input, redo), answer, steps);
    const run = async () => {
      it.q = input.value.trim();
      answer.textContent = '…';
      answer.classList.remove('err');
      await solveOne(host, it);
      answer.textContent = it.answer;
      answer.classList.toggle('err', !it.ok);
      steps.replaceChildren(h('summary', {}, 'Steps'));
      steps.hidden = !it.steps;
      if (it.steps) steps.append(renderSteps(it.steps));
    };
    redo.addEventListener('click', () => void run());
    list.append(card);
    return run;
  });
  void (async () => {
    for (const run of cards) await run();
    const solved = items.filter((x) => x.ok).length;
    status.textContent = `${solved} of ${items.length} solved. Check each question against the original.`;
    exportRow.hidden = false;
    exportRow.replaceChildren(
      h('button', { type: 'button', class: 'chip', 'data-testid': 'sheet-notebook', onclick: () => void host.notebook().then((nb) => {
        for (const it of items) nb.appendQuery(it.q);
        host.toast('Added to your notebook');
      }) }, 'Add to notebook'),
      h('button', { type: 'button', class: 'chip', 'data-testid': 'sheet-notes', onclick: () => download(notesMarkdown(items)) }, 'Download notes'),
    );
  })();
}

/** An equation or inequality on its own ("3x + 5 = 20", read off a photo) is something to solve. */
export function asked(q: string): string {
  return /[=<>≤≥]/.test(q) && /[a-z]/i.test(q) && !/^\s*(?:solve|find|simplify|factor|expand|evaluate|graph|plot|differentiate|integrate|derivative)\b/i.test(q) && !/^\s*[a-z]\w*\s*\([a-z, ]+\)\s*=/i.test(q) ? `solve ${q}` : q;
}

export async function solveOne(host: SolveHost, it: Item) {
  const tryQ = async (q: string): Promise<Outcome> => host.compute(q);
  let q = asked(it.q);
  let o = await tryQ(q);
  // "Solve: 2x + 3 = 11", "Simplify the following: …": drop an instruction the engines didn't take.
  if (o.kind === 'error' && /:/.test(q)) {
    const rest = q.slice(q.indexOf(':') + 1).trim();
    const verb = /^(solve|simplify|factor|expand|differentiate|integrate|evaluate)\b/i.exec(q)?.[1];
    // Keep the instruction ("Differentiate: x^2" → "Differentiate x^2"); "Evaluate:" just means work it out.
    q = verb && !/^evaluate$/i.test(verb) ? `${verb} ${rest}` : asked(rest);
    o = await tryQ(q);
  }
  it.ok = o.kind !== 'error' && o.kind !== 'pending' && o.kind !== 'empty';
  it.answer = display(o);
  it.steps = null;
  if (it.ok) {
    try {
      const src = stepSource(host, analyse(host, q, o));
      it.steps = src ? await src() : null;
    } catch {
      it.steps = null;
    }
  }
}

export function display(o: Outcome): string {
  switch (o.kind) {
    case 'calc':
      return o.result.formatted.display;
    case 'answer':
      return o.result.primary.display + (o.result.primary.unit ? ` ${o.result.primary.unit}` : '');
    case 'convert':
      return `${o.result.results[0]!.formatted.display} ${o.result.results[0]!.unit.symbol}`;
    case 'graph':
      return 'Graph';
    case 'error':
      return `Not solved: ${o.error.message}`;
    default:
      return 'Not solved';
  }
}

export function notesMarkdown(items: { q: string; answer: string; steps: StepList | null }[]): string {
  const out = ['# Worksheet', ''];
  items.forEach((it, i) => {
    out.push(`## ${i + 1}. ${it.q}`, '', `**Answer:** ${it.answer}`, '');
    if (it.steps) {
      out.push(`*${it.steps.method}*`, '');
      it.steps.steps.forEach((s, k) => out.push(`${k + 1}. ${s.reason}${s.latex ? `  \n   $${s.latex}$` : ''}`));
      out.push('');
    }
  });
  out.push('_Solved with Lemma. Every answer comes from its engines; check the questions were read correctly._', '');
  return out.join('\n');
}

export function download(md: string) {
  const a = h('a', { href: URL.createObjectURL(new Blob([md], { type: 'text/markdown' })), download: 'worksheet-notes.md' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
