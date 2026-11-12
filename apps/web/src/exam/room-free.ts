import { clear, h, mathSpan } from './dom';
import { mountDigitalRoom } from './room-digital';
import { choicesView, mathInput, responseView, type RoomView } from './room-kit';
import type { ExamRun } from './run';
import { scratchPad } from './scratch';
import type { ExamHost, ExamQuestion } from './types';

/**
 * Free-response room: the question (stem and parts with their points) on the left, a response booklet on the
 * right with an answer box per part (typed math with a live typeset preview) and a work area that can be
 * typed or drawn. Multiple-choice parts of the same exam use booklet-style choices. Shares the screen
 * chrome (timer, navigator, review, sections) with the digital rooms.
 */
export function mountFreeResponseRoom(root: HTMLElement, run: ExamRun, host: ExamHost, opts: { onExit(): void }): RoomView {
  return mountDigitalRoom(root, run, host, {
    variant: 'free',
    onExit: opts.onExit,
    renderQuestion: (q, ctx) => (q.type === 'free' && q.parts?.length ? freeCard(q, ctx.run, ctx.onChange) : q.choices?.length ? null : workedCard(q, ctx.run, ctx.onChange)),
  });
}

function workArea(run: ExamRun, key: string, label: string): HTMLElement {
  const body = h('div', { class: 'ex-fr-work-body' });
  const tabs = h('div', { class: 'ex-fr-work-tabs', role: 'tablist', 'aria-label': `${label} mode` });
  const typed = () => {
    clear(body);
    const ta = h('textarea', { class: 'ex-fr-work-text', rows: '6', 'aria-label': label, placeholder: 'Write your work here. Each line is one step.', spellcheck: 'false' });
    ta.value = run.st.work[key] ?? '';
    ta.addEventListener('input', () => run.setWork(key, ta.value));
    ta.addEventListener('keydown', (e) => e.stopPropagation());
    body.append(ta);
  };
  const drawn = () => {
    clear(body);
    body.append(scratchPad({ label, height: 220, ...(run.st.drawings[key] ? { initial: run.st.drawings[key]! } : {}), onChange: (d) => run.setDrawing(key, d) }));
  };
  const tab = (name: string, on: () => void, selected: boolean) => {
    const b = h('button', { type: 'button', role: 'tab', class: 'ex-fr-tab', 'aria-selected': String(selected), onclick: () => {
      tabs.querySelectorAll('[role="tab"]').forEach((t) => t.setAttribute('aria-selected', String(t === b)));
      on();
    } }, name);
    return b;
  };
  const drawFirst = !!run.st.drawings[key] && !run.st.work[key];
  tabs.append(tab('Type', typed, !drawFirst), tab('Draw', drawn, drawFirst));
  (drawFirst ? drawn : typed)();
  return h('div', { class: 'ex-fr-work' }, h('div', { class: 'ex-fr-work-head' }, h('span', { class: 'ex-fr-work-label' }, 'Work'), tabs), body);
}

function freeCard(q: ExamQuestion, run: ExamRun, onChange: () => void): HTMLElement {
  const parts = q.parts ?? [];
  const ans = run.attempt.answers[q.id];
  const given = ans && typeof ans === 'object' && !Array.isArray(ans) ? ans : {};
  const stem = h('section', { class: 'ex-fr-stem', 'aria-label': 'Question' },
    h('div', { class: 'ex-fr-stem-head' }, h('h2', null, `Question ${q.number}`), h('span', { class: 'ex-fr-total' }, `${q.points} points`)),
    q.figure ? h('pre', { class: 'ex-figure' }, q.figure) : null,
    h('p', { class: 'ex-fr-prompt' }, q.prompt),
    q.tex ? mathSpan(q.prompt, q.tex, true) : null,
    h('ol', { class: 'ex-fr-partlist' }, parts.map((p) => h('li', null,
      h('span', { class: 'ex-fr-plabel' }, `(${p.label})`),
      h('div', { class: 'ex-fr-ptext' }, h('p', null, p.prompt), p.tex ? mathSpan(p.prompt, p.tex, true) : null),
      h('span', { class: 'ex-fr-ppts' }, `${p.points} pt${p.points === 1 ? '' : 's'}`),
    ))),
  );
  const resp = h('section', { class: 'ex-fr-resp', 'aria-label': 'Response booklet' },
    parts.map((p) => h('div', { class: 'ex-fr-part', 'data-part': p.label },
      h('div', { class: 'ex-fr-part-head' }, h('h3', null, `Part (${p.label})`), h('span', { class: 'ex-fr-ppts' }, `${p.points} point${p.points === 1 ? '' : 's'}`)),
      workArea(run, `${q.id}#${p.label}`, `Work for part (${p.label})`),
      h('div', { class: 'ex-fr-final' }, h('span', { class: 'ex-fr-final-label' }, 'Answer'),
        mathInput({ value: given[p.label] ?? '', label: `Answer to part (${p.label})`, placeholder: 'Final answer, like 3x^2 − 1 or 12.5', onInput: (v) => (run.setPart(q.id, p.label, v), onChange()) })),
    )),
  );
  return h('div', { class: 'ex-fr-split' }, stem, resp);
}

function workedCard(q: ExamQuestion, run: ExamRun, onChange: () => void): HTMLElement {
  return h('div', { class: 'ex-fr-split' },
    h('section', { class: 'ex-fr-stem', 'aria-label': 'Question' },
      h('div', { class: 'ex-fr-stem-head' }, h('h2', null, `Question ${q.number}`), h('span', { class: 'ex-fr-total' }, `${q.points} point${q.points === 1 ? '' : 's'}`)),
      q.figure ? h('pre', { class: 'ex-figure' }, q.figure) : null,
      h('p', { class: 'ex-fr-prompt' }, q.prompt),
      q.tex ? mathSpan(q.prompt, q.tex, true) : null,
      q.choices?.length ? choicesView(run, q, { eliminate: false, variant: 'booklet', onChange }) : null,
    ),
    h('section', { class: 'ex-fr-resp', 'aria-label': 'Response booklet' },
      h('div', { class: 'ex-fr-part' }, workArea(run, q.id, `Work for question ${q.number}`), h('div', { class: 'ex-fr-final' }, h('span', { class: 'ex-fr-final-label' }, 'Answer'), responseView(run, q, onChange))),
    ),
  );
}
