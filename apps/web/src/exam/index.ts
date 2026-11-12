import '@fontsource/kalam/400.css';
import './exam.css';
import { clock, fill, h, icon } from './dom';
import { FORMAT_LABELS, preset, engine, sectionCount, sectionIdOf, TRADEMARK_NOTE } from './engine';
import { openNewExam } from './import-ui';
import { renderHistory, renderResults } from './results';
import { mountDigitalRoom } from './room-digital';
import { mountFreeResponseRoom } from './room-free';
import type { RoomView } from './room-kit';
import { mountPaperRoom } from './room-paper';
import { ExamRun, exitFullscreen, type RunState } from './run';
import { history, runStore } from './store';
import type { Exam, ExamHost } from './types';

/**
 * Exam center: build a practice exam from uploads or a format, take it in a room that matches the real
 * environment, and review results. The app mounts it with openExamCenter(); startExam() runs one exam.
 */

export type { ExamHost } from './types';
export { engine } from './engine';

/** Everything renders into our own element inside the host's container, so the host's classes stay intact. */
function wrap(c: HTMLElement): HTMLElement {
  if (c.dataset.exView !== undefined) return c;
  const w = h('div', { 'data-ex-view': '' });
  c.replaceChildren(w);
  return w;
}

function mountRun(container: HTMLElement, run: ExamRun, host: ExamHost, done: { onExit(): void; onResults(): void }): () => void {
  const root = h('div', { class: 'ex-room', role: 'application' });
  const prevOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';
  container.replaceChildren(root);
  const onExit = () => {
    cleanup();
    done.onExit();
  };
  const room = run.profile.room;
  const view: RoomView =
    room === 'paper'
      ? mountPaperRoom(root, run, host, { onExit })
      : room === 'free-response'
        ? mountFreeResponseRoom(root, run, host, { onExit })
        : mountDigitalRoom(root, run, host, { variant: room === 'digital-adaptive' ? 'adaptive' : 'linear', onExit });
  let finished = false;
  run.ev = {
    render: () => view.render(),
    tick: () => view.tick(),
    warn: (m) => view.warn(m),
    notice: (m) => view.notice(m),
    finish: (result) => {
      finished = true;
      cleanup();
      exitFullscreen();
      const timedOut = run.st.timedOut.length > 0;
      renderResults(container, { exam: run.exam, attempt: run.attempt, result, host, timedOut, onDone: done.onResults, onRetake: () => startExam(container, engine.buildExam(run.exam.profile), host, done) });
    },
    elsewhere: (reason) => {
      finished = true;
      cleanup();
      exitFullscreen();
      const canTakeBack = reason === 'taken' && !!runStore.load();
      fill(container,
        h('section', { class: 'ex-card ex-elsewhere', role: 'alert' },
          h('h2', null, reason === 'taken' ? 'This exam is open in another tab' : 'This exam was closed in another tab'),
          h('p', { class: 'ex-muted' }, reason === 'taken'
            ? 'Only one tab can run an exam, so this one stopped. Your answers so far are saved there.'
            : 'It was turned in, discarded, or replaced by a new exam in another tab, so this tab stopped.'),
          h('div', { class: 'ex-actions' },
            canTakeBack ? h('button', { type: 'button', class: 'ex-btn ex-btn-primary', onclick: () => resumeExam(container, host, done) }, 'Continue here instead') : null,
            h('button', { type: 'button', class: canTakeBack ? 'ex-btn' : 'ex-btn ex-btn-primary', onclick: done.onExit }, 'Exam center'),
          )));
      container.className = 'ex-center';
    },
  };
  view.render();
  run.start();
  let cleaned = false;
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    run.destroy();
    view.destroy();
    document.documentElement.style.overflow = prevOverflow;
  }
  return () => {
    if (!finished) cleanup();
    exitFullscreen();
  };
}

/** Starts an exam in `container` (full-window room). Returns a cleanup function that saves progress. */
export function startExam(container: HTMLElement, exam: Exam, host: ExamHost, done: { onExit?(): void; onResults?(): void } = {}): () => void {
  container = wrap(container);
  const run = ExamRun.create(exam);
  run.save();
  return mountRun(container, run, host, { onExit: done.onExit ?? (() => openExamCenter(container, host)), onResults: done.onResults ?? (() => openExamCenter(container, host)) });
}

/** Continues the saved exam, if any. */
export function resumeExam(container: HTMLElement, host: ExamHost, done: { onExit?(): void; onResults?(): void } = {}): (() => void) | null {
  const saved = runStore.load<RunState>();
  if (!saved) return null;
  container = wrap(container);
  const run = ExamRun.fromSaved(saved);
  return mountRun(container, run, host, { onExit: done.onExit ?? (() => openExamCenter(container, host)), onResults: done.onResults ?? (() => openExamCenter(container, host)) });
}

/** The hub: New exam, Continue, Past attempts. */
export function openExamCenter(host_container: HTMLElement, host: ExamHost): () => void {
  const container = wrap(host_container);
  let cleanup: (() => void) | null = null;
  const go = (f: () => (() => void) | void) => {
    cleanup?.();
    cleanup = f() ?? null;
  };
  const hub = () => {
    container.className = 'ex-center ex-hub';
    const saved = runStore.load<RunState>();
    const past = history.list();
    const begin = (exam: Exam) => go(() => startExam(container, exam, host, { onExit: hub, onResults: hub }));
    const continueCard = saved
      ? (() => {
          const st = saved.st;
          const answered = Object.keys(saved.attempt.answers).length;
          const total = saved.exam.profile.sections.reduce((n, s) => n + sectionCount(s), 0);
          const entry = saved.attempt.sectionOrder[st.sec];
          const sid = entry !== undefined ? sectionIdOf(entry) : undefined;
          const left = sid !== undefined ? st.left[sid] : undefined;
          return h('section', { class: 'ex-card ex-continue', 'aria-labelledby': 'ex-cont-h' },
            h('h2', { id: 'ex-cont-h' }, 'Continue'),
            h('p', null, h('strong', null, saved.exam.profile.name)),
            h('p', { class: 'ex-muted' }, `${answered} of ${total} answered${left !== undefined ? ` · ${clock(left)} left in this part` : ''} · saved ${new Date(saved.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`),
            h('div', { class: 'ex-actions' },
              h('button', { type: 'button', class: 'ex-btn ex-btn-primary', onclick: () => go(() => resumeExam(container, host, { onExit: hub, onResults: hub }) ?? undefined) }, 'Continue exam'),
              h('button', { type: 'button', class: 'ex-btn', onclick: () => {
                if (confirm('Discard the exam in progress? Your answers will be lost.')) {
                  runStore.clear();
                  hub();
                }
              } }, 'Discard'),
            ));
        })()
      : null;
    fill(container,
      h('header', { class: 'ex-hub-head' },
        h('p', { class: 'ex-kicker' }, 'Exam room'),
        h('h1', null, 'Practice like it’s the real thing'),
        h('p', { class: 'ex-muted ex-lede' }, 'Real timing, real tools, a room that looks like the one you’ll sit in. Build it from your own tests, or start from a familiar format.'),
      ),
      continueCard,
      h('section', { class: 'ex-card ex-hub-new', 'aria-labelledby': 'ex-new-h' },
        h('div', { class: 'ex-hub-new-head' },
          h('h2', { id: 'ex-new-h' }, 'New exam'),
          h('button', { type: 'button', class: 'ex-btn ex-btn-primary', onclick: () => openNewExam(container, { onBack: hub, onStart: begin, toast: host.toast }) }, icon('upload'), 'Import my tests'),
        ),
        h('p', { class: 'ex-muted' }, 'Or start from a format:'),
        h('div', { class: 'ex-formats' }, FORMAT_LABELS.map((f) => h('button', { type: 'button', class: 'ex-format', 'data-family': f.family, onclick: () => {
          const p = preset(f.family);
          if (!p) return host.toast('That format isn’t available.');
          openNewExam(container, { onBack: hub, onStart: begin, toast: host.toast });
          (container.querySelector(`.ex-formats [data-family="${f.family}"]`) as HTMLElement | null)?.click();
        } }, h('span', { class: 'ex-format-name' }, f.label), h('span', { class: 'ex-muted' }, f.blurb)))),
        h('p', { class: 'ex-muted ex-tm-note' }, TRADEMARK_NOTE),
      ),
      h('section', { class: 'ex-card', 'aria-labelledby': 'ex-past-h' },
        h('div', { class: 'ex-hub-new-head' }, h('h2', { id: 'ex-past-h' }, 'Past attempts'), past.length ? h('button', { type: 'button', class: 'ex-btn', onclick: showHistory }, 'See all') : null),
        past.length
          ? h('ol', { class: 'ex-hist-list' }, past.slice(0, 4).map((e) => h('li', null, h('button', { type: 'button', class: 'ex-hist-item', onclick: () => openPast(e.id) },
            h('span', { class: 'ex-hist-name' }, e.name),
            h('span', { class: 'ex-muted' }, new Date(e.finishedAt).toLocaleDateString()),
            h('span', { class: 'ex-hist-score' }, e.score.replace(/\s*\(estimate\)/, ''), e.estimate ? h('small', null, ' est.') : null),
            h('span', { class: 'ex-muted' }, `${Math.round(e.percent)}%`)))))
          : h('p', { class: 'ex-muted' }, 'Your finished exams and score trend will show here.'),
      ),
    );
  };
  const openPast = (id: string) => {
    const e = history.list().find((x) => x.id === id);
    if (e) renderResults(container, { exam: e.exam, attempt: e.attempt, result: e.result, host, onDone: hub });
  };
  const showHistory = () => renderHistory(container, { onOpen: (e) => openPast(e.id), onBack: hub });
  hub();
  return () => {
    cleanup?.();
    container.remove();
  };
}
