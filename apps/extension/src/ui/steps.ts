import type { Solution } from '../core/solve';
import { h } from './dom';
import { tex } from './math';

/**
 * Worked steps typeset with KaTeX. In tutor mode the method comes first: a hint, then the steps one at a
 * time, then the answer. In answer mode everything is shown at once.
 */
export function renderSteps(root: HTMLElement, s: Solution, mode: 'tutor' | 'answer'): void {
  root.replaceChildren();
  if (!s.ok) {
    root.append(h('p', { class: 'notice', role: 'status' }, s.error ?? 'Lemma could not solve that.'));
    return;
  }
  const head = h('div', { class: 'stack', style: 'gap:6px' });
  if (s.title) head.append(h('h3', {}, s.title));
  if (s.questionTex) head.append(tex(h('div', { class: 's-math', 'aria-label': s.query }), s.questionTex, true));
  else if (s.expression) head.append(h('div', { class: 'muted' }, s.expression));
  root.append(head);

  const hint = s.hint && s.steps.length ? h('p', { class: 'hint', 'data-testid': 'hint' }, h('strong', {}, 'Hint: '), s.hint) : null;
  const list = h('ol', { class: 'steps', 'aria-label': 'Steps', 'data-testid': 'steps' });
  const answer = s.answer ? h('div', { class: 'answer-box', 'data-testid': 'answer' }) : null;
  if (answer && s.answer) {
    answer.append(h('span', { class: 'muted', style: 'font-weight:500' }, 'Answer: '));
    if (s.answer.tex) answer.append(tex(h('span', { 'aria-label': s.answer.display }), s.answer.tex));
    else answer.append(s.answer.display);
  }
  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  const controls = h('div', { class: 'row' });
  root.append(...([hint, list, answer, controls, live] as (HTMLElement | null)[]).filter((x): x is HTMLElement => !!x));
  for (const n of s.notes) root.append(h('p', { class: 'muted', style: 'margin:0;font-size:12px' }, n));

  const stepEls = s.steps.map((st, i) => {
    const li = h('li', {}, h('div', { class: 's-text' }, h('span', { class: 'sr-only' }, `Step ${i + 1}: `), st.text));
    if (st.tex) li.append(tex(h('div', { class: 's-math' }), st.tex, true));
    return li;
  });

  let shown = mode === 'answer' ? stepEls.length : 0;
  let answerShown = mode === 'answer' || !s.steps.length;
  if (hint) hint.hidden = mode === 'answer';

  function draw() {
    list.replaceChildren(...stepEls.slice(0, shown));
    list.hidden = shown === 0;
    if (answer) answer.hidden = !answerShown;
    controls.replaceChildren();
    if (shown < stepEls.length) {
      controls.append(
        h('button', { class: 'btn primary', type: 'button', 'data-testid': 'next-step', onclick: () => step(1) }, shown === 0 ? 'Show the first step' : 'Next step'),
        h('button', { class: 'btn', type: 'button', onclick: () => step(stepEls.length) }, 'Show all steps'),
      );
    } else if (!answerShown) {
      controls.append(h('button', { class: 'btn primary', type: 'button', 'data-testid': 'show-answer', onclick: reveal }, 'Show the answer'));
    }
  }
  function step(n: number) {
    shown = Math.min(stepEls.length, shown + n);
    live.textContent = `${shown} of ${stepEls.length} steps shown`;
    draw();
  }
  function reveal() {
    answerShown = true;
    live.textContent = `Answer: ${s.answer?.display ?? ''}`;
    draw();
  }
  draw();
}
