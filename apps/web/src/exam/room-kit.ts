import { asciiToTex, clear, clock, h, icon, mathSpan } from './dom';
import { renderInlineMath } from '../math-render';
import { enterFullscreen, type ExamRun, type Mark } from './run';
import { isNamedFormat, sectionCount, TRADEMARK_NOTE } from './engine';
import type { ExamQuestion, Part, Section } from './types';

/** Pieces every room shares: prompt with highlights, answer choices, typed answers, dialogs, banners, intro and break screens. */

// ---------------------------------------------------------------------------------------------------------
// Prompt with highlighter and notes

function textOffset(container: Node, node: Node, offset: number): number {
  const r = document.createRange();
  r.setStart(container, 0);
  r.setEnd(node, offset);
  return r.toString().length;
}

function merge(marks: Mark[]): Mark[] {
  const out: Mark[] = [];
  for (const m of [...marks].sort((a, b) => a.s - b.s)) {
    const last = out[out.length - 1];
    if (last && m.s <= last.e) {
      last.e = Math.max(last.e, m.e);
      if (m.note) last.note = last.note ? `${last.note}\n${m.note}` : m.note;
    } else out.push({ ...m });
  }
  return out;
}

function paintMarks(el: HTMLElement, text: string, marks: Mark[]): void {
  clear(el);
  let at = 0;
  marks.forEach((m, i) => {
    if (m.s > at) el.append(text.slice(at, m.s));
    const mk = h('mark', { class: m.note ? 'ex-hl ex-hl-note' : 'ex-hl', 'data-i': i, tabindex: '0', title: m.note ?? 'Highlighted' }, text.slice(m.s, m.e));
    if (m.note) mk.setAttribute('aria-description', `Note: ${m.note}`);
    el.append(mk);
    at = m.e;
  });
  if (at < text.length) el.append(text.slice(at));
}

/** The question text. With `highlight`, selecting text offers Highlight / Add note, and clicking a highlight offers Remove / Edit note. */
export function promptView(run: ExamRun, q: ExamQuestion, opts: { highlight: boolean; root: HTMLElement }): HTMLElement {
  const text = h('p', { class: 'ex-prompt-text' });
  const marks = () => run.st.marks[q.id] ?? [];
  paintMarks(text, q.prompt, marks());
  const box = h('div', { class: 'ex-prompt' });
  if (q.figure) box.append(h('pre', { class: 'ex-figure', 'aria-label': 'Figure description' }, q.figure));
  box.append(text);
  if (q.tex) box.append(mathSpan(q.prompt, q.tex, true));
  if (!opts.highlight) return box;

  let tools: HTMLElement | null = null;
  const closeTools = () => {
    tools?.remove();
    tools = null;
  };
  const place = (rect: DOMRect, el: HTMLElement) => {
    const rr = opts.root.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(rr.width - 220, rect.left - rr.left + rect.width / 2 - 100))}px`;
    el.style.top = `${rect.bottom - rr.top + 8}px`;
  };
  const noteEditor = (rect: DOMRect, initial: string, save: (note: string) => void) => {
    closeTools();
    const ta = h('textarea', { class: 'ex-note-input', rows: '3', 'aria-label': 'Note', placeholder: 'Type a note' });
    ta.value = initial;
    tools = h('div', { class: 'ex-hl-tools ex-hl-editor', role: 'dialog', 'aria-label': 'Note' }, ta,
      h('div', { class: 'ex-hl-row' },
        h('button', { type: 'button', onclick: () => closeTools() }, 'Cancel'),
        h('button', { type: 'button', class: 'ex-hl-save', onclick: () => (save(ta.value.trim()), closeTools()) }, 'Save'),
      ));
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') closeTools();
    });
    opts.root.append(tools);
    place(rect, tools);
    ta.focus();
  };
  const apply = (m: Mark) => {
    const next = merge([...marks(), m]);
    run.setMarks(q.id, next);
    paintMarks(text, q.prompt, next);
  };

  const onSelect = () => {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    if (!text.contains(r.startContainer) || !text.contains(r.endContainer)) return;
    const s = textOffset(text, r.startContainer, r.startOffset);
    const e = textOffset(text, r.endContainer, r.endOffset);
    if (e - s < 1) return;
    const rect = r.getBoundingClientRect();
    closeTools();
    tools = h('div', { class: 'ex-hl-tools', role: 'toolbar', 'aria-label': 'Highlight tools' },
      h('button', { type: 'button', class: 'ex-hl-btn', onclick: () => (apply({ s, e }), sel.removeAllRanges(), closeTools()) }, icon('highlight'), 'Highlight'),
      h('button', { type: 'button', class: 'ex-hl-btn', onclick: () => noteEditor(rect, '', (note) => (apply(note ? { s, e, note } : { s, e }), sel.removeAllRanges())) }, icon('pencil'), 'Add note'),
    );
    opts.root.append(tools);
    place(rect, tools);
  };
  text.addEventListener('pointerup', () => setTimeout(onSelect, 0));
  text.addEventListener('keyup', (e) => e.shiftKey && onSelect());
  text.addEventListener('click', (e) => {
    const mk = (e.target as HTMLElement).closest('mark.ex-hl') as HTMLElement | null;
    if (!mk || !getSelection()?.isCollapsed) return;
    const i = Number(mk.dataset.i);
    const rect = mk.getBoundingClientRect();
    const cur = marks()[i];
    if (!cur) return;
    closeTools();
    tools = h('div', { class: 'ex-hl-tools', role: 'toolbar', 'aria-label': 'Highlight tools' },
      h('button', { type: 'button', class: 'ex-hl-btn', onclick: () => noteEditor(rect, cur.note ?? '', (note) => {
        const list = marks().map((m, j) => (j === i ? (note ? { ...m, note } : { s: m.s, e: m.e }) : m));
        run.setMarks(q.id, list);
        paintMarks(text, q.prompt, list);
      }) }, icon('pencil'), cur.note ? 'Edit note' : 'Add note'),
      h('button', { type: 'button', class: 'ex-hl-btn', onclick: () => {
        const list = marks().filter((_, j) => j !== i);
        run.setMarks(q.id, list);
        paintMarks(text, q.prompt, list);
        closeTools();
      } }, icon('trash'), 'Remove'),
    );
    opts.root.append(tools);
    place(rect, tools);
  });
  text.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && (e.target as HTMLElement).matches('mark.ex-hl')) {
      e.preventDefault();
      (e.target as HTMLElement).click();
    }
  });
  opts.root.addEventListener('pointerdown', (e) => {
    if (tools && !tools.contains(e.target as Node)) closeTools();
  });
  return box;
}

// ---------------------------------------------------------------------------------------------------------
// Answer choices with eliminator

export function choicesView(run: ExamRun, q: ExamQuestion, opts: { eliminate: boolean; onChange?(): void; variant?: 'digital' | 'booklet' }): HTMLElement {
  const multi = q.type === 'multi';
  const list = h('div', { class: `ex-ch-list ex-ch-${opts.variant ?? 'digital'}`, role: multi ? 'group' : 'radiogroup', 'aria-label': `Answer choices for question ${q.number}` });
  const paint = () => {
    clear(list);
    const ans = run.attempt.answers[q.id];
    const struck = run.eliminated(q.id);
    const choices = q.choices ?? [];
    choices.forEach((c, i) => {
      const selected = multi ? Array.isArray(ans) && ans.includes(c.id) : ans === c.id;
      const isStruck = struck.includes(c.id);
      const choose = () => {
        if (isStruck) run.toggleEliminate(q.id, c.id);
        if (multi) {
          const cur = Array.isArray(ans) ? ans : [];
          run.setAnswer(q.id, selected ? cur.filter((x) => x !== c.id) : [...cur, c.id].sort());
        } else run.setAnswer(q.id, c.id);
        paint();
        opts.onChange?.();
        (list.querySelector(`[data-choice="${c.id}"]`) as HTMLElement | null)?.focus();
      };
      const btn = h('button', {
        type: 'button',
        class: 'ex-ch',
        role: multi ? 'checkbox' : 'radio',
        'aria-checked': String(selected),
        'data-choice': c.id,
        tabindex: multi || selected || (!ans && i === 0) ? '0' : '-1',
        'aria-label': `${c.id}: ${c.text}${isStruck ? ' (crossed out)' : ''}`,
        onclick: choose,
      }, h('span', { class: 'ex-ch-letter', 'aria-hidden': 'true' }, c.id), h('span', { class: 'ex-ch-text' }, c.tex ? mathSpan(c.text, c.tex) : c.text));
      btn.addEventListener('keydown', (e) => {
        const k = (e as KeyboardEvent).key;
        if (multi || !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(k)) return;
        e.preventDefault();
        e.stopPropagation();
        const step = k === 'ArrowDown' || k === 'ArrowRight' ? 1 : -1;
        const nxt = choices[(i + step + choices.length) % choices.length]!;
        run.setAnswer(q.id, nxt.id);
        paint();
        opts.onChange?.();
        (list.querySelector(`[data-choice="${nxt.id}"]`) as HTMLElement | null)?.focus();
      });
      const row = h('div', { class: `ex-ch-row${isStruck ? ' is-struck' : ''}${selected ? ' is-selected' : ''}` }, btn);
      if (opts.eliminate) {
        row.append(isStruck
          ? h('button', { type: 'button', class: 'ex-ch-undo', 'aria-label': `Undo cross out of choice ${c.id}`, onclick: () => (run.toggleEliminate(q.id, c.id), paint(), opts.onChange?.()) }, 'Undo')
          : h('button', { type: 'button', class: 'ex-ch-x', 'aria-label': `Cross out choice ${c.id}`, title: `Cross out ${c.id}`, onclick: () => (run.toggleEliminate(q.id, c.id), paint(), opts.onChange?.()) }, h('span', null, c.id)));
      }
      list.append(row);
    });
  };
  paint();
  return list;
}

// ---------------------------------------------------------------------------------------------------------
// Typed answers with a live preview

export function mathInput(opts: { value: string; label: string; multiline?: boolean; placeholder?: string; preview?: 'Answer preview' | 'Preview'; onInput(v: string): void; className?: string }): HTMLElement {
  const field = opts.multiline
    ? h('textarea', { class: `ex-mi-field ${opts.className ?? ''}`, rows: '2', 'aria-label': opts.label, placeholder: opts.placeholder ?? '', spellcheck: 'false' })
    : h('input', { class: `ex-mi-field ${opts.className ?? ''}`, type: 'text', 'aria-label': opts.label, placeholder: opts.placeholder ?? '', autocomplete: 'off', spellcheck: 'false', inputmode: 'text' });
  field.value = opts.value;
  const out = h('span', { class: 'ex-mi-math' });
  const preview = h('div', { class: 'ex-mi-preview', 'aria-live': 'polite' }, h('span', { class: 'ex-mi-label' }, `${opts.preview ?? 'Answer preview'}:`), out);
  const paint = () => {
    const tex = asciiToTex(field.value);
    clear(out);
    if (tex) renderInlineMath(out, tex, false);
    preview.classList.toggle('is-empty', !tex);
  };
  field.addEventListener('input', () => {
    opts.onInput(field.value);
    paint();
  });
  field.addEventListener('keydown', (e) => e.stopPropagation());
  paint();
  return h('div', { class: 'ex-mi' }, field, preview);
}

export function responseView(run: ExamRun, q: ExamQuestion, onChange?: () => void): HTMLElement {
  const cur = run.attempt.answers[q.id];
  const value = typeof cur === 'string' ? cur : '';
  if (q.type === 'short') {
    return h('label', { class: 'ex-short' }, h('span', { class: 'ex-sr-only' }, `Answer to question ${q.number}`), mathInput({ value, label: `Answer to question ${q.number}`, multiline: true, preview: 'Preview', onInput: (v) => (run.setAnswer(q.id, v), onChange?.()) }));
  }
  return h('div', { class: 'ex-spr' }, mathInput({ value, label: `Answer to question ${q.number}`, placeholder: q.type === 'numeric' ? 'Type your answer' : 'Type an expression, like 3x^2 − 1', onInput: (v) => (run.setAnswer(q.id, v.trim() ? v : undefined), onChange?.()) }));
}

export function partsView(run: ExamRun, q: ExamQuestion, onChange?: () => void): HTMLElement {
  const ans = run.attempt.answers[q.id];
  const given = ans && typeof ans === 'object' && !Array.isArray(ans) ? ans : {};
  return h('ol', { class: 'ex-parts' }, (q.parts ?? []).map((p: Part) =>
    h('li', { class: 'ex-part' },
      h('div', { class: 'ex-part-head' }, h('span', { class: 'ex-part-label' }, `(${p.label})`), h('span', { class: 'ex-part-prompt' }, p.prompt), h('span', { class: 'ex-part-pts' }, `${p.points} pt${p.points === 1 ? '' : 's'}`)),
      p.tex ? mathSpan(p.prompt, p.tex, true) : null,
      mathInput({ value: given[p.label] ?? '', label: `Answer to part (${p.label})`, onInput: (v) => (run.setPart(q.id, p.label, v), onChange?.()) }),
    )));
}

// ---------------------------------------------------------------------------------------------------------
// Dialogs and banners (inside the room, so they show in full screen)

const openDialogs = new WeakMap<HTMLElement, Set<(label: string) => void>>();

/**
 * Closes every open dialog in the room as if cancelled (resolves ''). Called when the situation a dialog asked
 * about is gone, e.g. time ran out while "Finish this part?" was open, so a stale answer can't act on the next part.
 */
export function closeDialogs(root: HTMLElement): void {
  for (const close of [...(openDialogs.get(root) ?? [])]) close('');
}

export function dialog(root: HTMLElement, opts: { title: string; body: (string | Node)[]; actions: { label: string; primary?: boolean; run?(): void }[]; cancellable?: boolean }): Promise<string> {
  return new Promise((resolve) => {
    const prev = document.activeElement as HTMLElement | null;
    const open = openDialogs.get(root) ?? new Set<(label: string) => void>();
    openDialogs.set(root, open);
    let closed = false;
    const close = (label: string) => {
      if (closed) return;
      closed = true;
      open.delete(close);
      wrap.remove();
      if (prev?.isConnected) prev.focus?.();
      resolve(label);
    };
    open.add(close);
    const id = `ex-dlg-${Math.random().toString(36).slice(2, 7)}`;
    const box = h('div', { class: 'ex-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id },
      h('h2', { id, class: 'ex-dialog-title' }, opts.title),
      h('div', { class: 'ex-dialog-body' }, opts.body.map((b) => (typeof b === 'string' ? h('p', null, b) : b))),
      h('div', { class: 'ex-dialog-actions' }, opts.actions.map((a) => h('button', { type: 'button', class: a.primary ? 'ex-btn ex-btn-primary' : 'ex-btn', onclick: () => (a.run?.(), close(a.label)) }, a.label))),
    );
    const wrap = h('div', { class: 'ex-dialog-wrap' }, box);
    wrap.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' && opts.cancellable !== false) close('');
      if (e.key === 'Tab') {
        const f = [...box.querySelectorAll<HTMLElement>('button, [tabindex="0"], input, textarea')];
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last?.focus());
        else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first?.focus());
      }
    });
    root.append(wrap);
    (box.querySelector('.ex-btn-primary') as HTMLElement | null ?? box.querySelector('button'))?.focus();
  });
}

export function banner(root: HTMLElement): { show(msg: string, actions?: { label: string; run(): void }[]): void; hide(): void } {
  const el = h('div', { class: 'ex-banner', role: 'alert', hidden: true });
  root.append(el);
  let t: ReturnType<typeof setTimeout> | null = null;
  return {
    show(msg, actions = []) {
      clear(el);
      el.append(h('span', { class: 'ex-banner-msg' }, msg), ...actions.map((a) => h('button', { type: 'button', class: 'ex-banner-btn', onclick: () => (a.run(), (el.hidden = true)) }, a.label)), h('button', { type: 'button', class: 'ex-banner-x', 'aria-label': 'Dismiss', onclick: () => (el.hidden = true) }, icon('close')));
      el.hidden = false;
      if (t) clearTimeout(t);
      if (!actions.length) t = setTimeout(() => (el.hidden = true), 12_000);
    },
    hide() {
      el.hidden = true;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Intro, break, and pause screens

function minutes(s: Section): string {
  return s.minutes === null ? 'untimed' : `${s.minutes} min`;
}

export function introScreen(run: ExamRun, root: HTMLElement, onFullscreenRefused: () => void): HTMLElement {
  const p = run.profile;
  const total = p.sections.reduce((n, s) => n + (s.minutes ?? 0), 0);
  const calc = p.tools.calculator === 'none' ? 'No calculator' : `${p.tools.calculator[0]!.toUpperCase()}${p.tools.calculator.slice(1)} calculator where allowed`;
  const start = h('button', {
    type: 'button',
    class: 'ex-btn ex-btn-primary ex-intro-start',
    onclick: async () => {
      if (p.rules.fullscreen && !(await enterFullscreen(root))) onFullscreenRefused();
      run.begin();
    },
  }, 'Start');
  const el = h('div', { class: 'ex-intro' },
    h('div', { class: 'ex-intro-card' },
      h('p', { class: 'ex-intro-kicker' }, 'Practice exam'),
      h('h1', { class: 'ex-intro-title' }, p.name),
      h('p', { class: 'ex-intro-sub' }, `${p.sections.length} section${p.sections.length === 1 ? '' : 's'}${total ? ` · ${total} minutes` : ''}`),
      h('table', { class: 'ex-intro-table' },
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Section'), h('th', { scope: 'col' }, 'Questions'), h('th', { scope: 'col' }, 'Time'), h('th', { scope: 'col' }, 'Calculator'))),
        h('tbody', null, p.sections.map((s) => h('tr', null, h('td', null, s.title), h('td', null, String(sectionCount(s))), h('td', null, minutes(s)), h('td', null, s.calculator && p.tools.calculator !== 'none' ? 'Yes' : 'No')))),
      ),
      h('ul', { class: 'ex-intro-rules' },
        h('li', null, calc + '.'),
        p.rules.fullscreen ? h('li', null, 'The exam opens full screen. Leaving full screen is noted on your screen.') : null,
        p.sections.some((s) => !s.canReturn) && p.sections.length > 1 ? h('li', null, 'Once you move on from a section you cannot go back to it.') : null,
        p.sections.some((s) => s.adaptive) ? h('li', null, 'Later questions are chosen based on how you do earlier.') : null,
        p.sections.some((s) => s.breakAfterMinutes) ? h('li', null, `There is a ${p.sections.find((s) => s.breakAfterMinutes)!.breakAfterMinutes}-minute break between parts.`) : null,
        h('li', null, p.rules.allowPause ? 'You can pause the clock.' : 'The clock cannot be paused. Your progress saves automatically.'),
        p.rules.warnAtMinutes.length ? h('li', null, `You’ll get a reminder at ${p.rules.warnAtMinutes.join(' and ')} minutes left.`) : null,
      ),
      start,
      isNamedFormat(p.family) ? h('p', { class: 'ex-intro-tm' }, TRADEMARK_NOTE) : null,
    ),
  );
  queueMicrotask(() => start.focus());
  return el;
}

export function breakScreen(run: ExamRun): { el: HTMLElement; tick(): void } {
  const time = h('div', { class: 'ex-break-time', role: 'timer', 'aria-label': 'Remaining break time' }, clock(run.st.breakLeft));
  const nextTitle = run.profile.sections[run.sectionIndex + 1]?.title ?? 'the next part';
  const el = h('div', { class: 'ex-break' },
    h('div', { class: 'ex-break-card' },
      h('p', { class: 'ex-break-kicker' }, 'Remaining break time'),
      time,
      h('button', { type: 'button', class: 'ex-btn ex-btn-primary', onclick: () => run.endBreak() }, 'Resume testing'),
      h('div', { class: 'ex-break-rules' },
        h('h2', null, 'Practice test break'),
        h('p', null, `You can take a short break. ${nextTitle} starts automatically when the break time runs out.`),
        h('h3', null, 'During the break'),
        h('ul', null, h('li', null, 'Leave this page open; your progress is saved.'), h('li', null, 'Stretch, drink some water, rest your eyes.'), h('li', null, 'Don’t look at notes or other materials if you want a realistic score.')),
      ),
    ),
  );
  return { el, tick: () => (time.textContent = clock(run.st.breakLeft)) };
}

export function pauseScreen(run: ExamRun): HTMLElement {
  return h('div', { class: 'ex-pause', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Paused' },
    h('div', { class: 'ex-pause-card' }, h('h2', null, 'Paused'), h('p', null, 'The clock is stopped and the questions are hidden.'), h('button', { type: 'button', class: 'ex-btn ex-btn-primary', onclick: () => run.setPaused(false) }, 'Resume')));
}

export interface RoomView {
  render(): void;
  tick(): void;
  warn(message: string): void;
  notice(message: string): void;
  destroy(): void;
}

/** Shared keyboard rules: never steal keys from text fields. */
export function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

/** Announces to screen readers without moving focus. */
export function liveRegion(root: HTMLElement): (msg: string) => void {
  const el = h('div', { class: 'ex-sr-only', 'aria-live': 'polite' });
  root.append(el);
  return (msg) => {
    el.textContent = '';
    setTimeout(() => (el.textContent = msg), 30);
  };
}

/** Draggable floating panel (calculator, reference sheet). On narrow screens it becomes a bottom sheet. */
export function floatingPanel(root: HTMLElement, opts: { title: string; className: string; body: HTMLElement; onClose(): void; width?: number }): HTMLElement {
  const head = h('div', { class: 'ex-panel-head' },
    h('h2', { class: 'ex-panel-title' }, opts.title),
    h('button', { type: 'button', class: 'ex-panel-x', 'aria-label': `Close ${opts.title}`, onclick: () => opts.onClose() }, icon('close')),
  );
  const panel = h('section', { class: `ex-panel ${opts.className}`, role: 'dialog', 'aria-label': opts.title }, head, h('div', { class: 'ex-panel-body' }, opts.body));
  if (opts.width) panel.style.width = `${opts.width}px`;
  let sx = 0;
  let sy = 0;
  let ox = 0;
  let oy = 0;
  head.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button') || getComputedStyle(panel).position !== 'absolute') return;
    sx = e.clientX;
    sy = e.clientY;
    ox = panel.offsetLeft;
    oy = panel.offsetTop;
    head.setPointerCapture(e.pointerId);
    head.classList.add('is-dragging');
  });
  head.addEventListener('pointermove', (e) => {
    if (!head.classList.contains('is-dragging')) return;
    const rr = root.getBoundingClientRect();
    panel.style.left = `${Math.max(0, Math.min(rr.width - 120, ox + e.clientX - sx))}px`;
    panel.style.top = `${Math.max(0, Math.min(rr.height - 60, oy + e.clientY - sy))}px`;
    panel.style.right = 'auto';
  });
  head.addEventListener('pointerup', () => head.classList.remove('is-dragging'));
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      opts.onClose();
    }
  });
  return panel;
}

export function fullscreenWatch(run: ExamRun, root: HTMLElement, warn: ReturnType<typeof banner>): () => void {
  if (!run.profile.rules.fullscreen) return () => {};
  let was = !!document.fullscreenElement;
  const on = () => {
    const now = !!document.fullscreenElement;
    if (was && !now && (run.st.phase === 'section' || run.st.phase === 'review')) {
      warn.show('You left full screen. A real test would note this.', [{ label: 'Return to full screen', run: () => void enterFullscreen(root) }]);
    }
    was = now;
  };
  document.addEventListener('fullscreenchange', on);
  return () => document.removeEventListener('fullscreenchange', on);
}
