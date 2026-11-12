import type { LessonScript, StyleId } from '@lemma/tutor-engine';
import { canExportVideo, createLessonPlayer, createScriptPlayer, exportLessonVideo, exportScriptVideo, gallery, openVideoGallery, type Lesson } from '../lesson';
import type { ToolContext } from '../study';
import { skeleton } from '../motion';
import { button, el, segmented } from './ui';

/**
 * Video lessons. Two ways in: explain a question (from any answer, or typed here) or lecture on a topic. Either
 * way the tutor engine writes the script in the chosen teaching style and the renderer teaches it: written out
 * as it's spoken, with captions, saved to the gallery as a video file.
 */

const STYLE_KEY = 'lemma.lesson-style';
const lastStyle = (): StyleId => {
  try {
    return (localStorage.getItem(STYLE_KEY) as StyleId) || 'chalkboard';
  } catch {
    return 'chalkboard';
  }
};
const rememberStyle = (s: StyleId) => {
  try {
    localStorage.setItem(STYLE_KEY, s);
  } catch {
    // Only a convenience.
  }
};

export function mountVideos(body: HTMLElement, ctx: ToolContext, host: { toast: (m: string) => void }): () => void {
  const disposers: (() => void)[] = [];
  const status = el('p', { className: 'fine' });
  const bar = el('div', { className: 'progress' }, el('i'));
  bar.hidden = true;
  const cleanup = () => {
    while (disposers.length) disposers.pop()!();
  };

  // A ready-made lesson (from a practice question) plays as it is, in the chosen style when a script can be made.
  if (ctx.lesson && !ctx.query) {
    showLegacy(ctx.lesson);
    return cleanup;
  }

  void (async () => {
    const wait = skeleton(4);
    body.append(wait);
    const tutor = await import('@lemma/tutor-engine').finally(() => wait.remove());
    let style: StyleId = ctx.style ?? lastStyle();
    let mode: 'explain' | 'lecture' = ctx.lecture ? 'lecture' : 'explain';

    const input = el('input', { autocomplete: 'off', spellcheck: false });
    input.setAttribute('aria-label', 'Question or topic');
    const setPlaceholder = () => (input.placeholder = mode === 'explain' ? 'A question, e.g. solve 3x - 7 = 11' : 'A topic, e.g. the chain rule');
    input.value = ctx.lecture ?? ctx.query ?? '';
    setPlaceholder();

    const modes = segmented(
      [
        { id: 'explain', label: 'Explain a question' },
        { id: 'lecture', label: 'Lecture on a topic' },
      ],
      mode,
      (id) => {
        mode = id as typeof mode;
        setPlaceholder();
        examples.replaceChildren(...exampleButtons());
      },
    );

    const styles = el('div', { className: 'style-picker', role: 'radiogroup' } as never);
    styles.setAttribute('aria-label', 'Teaching style');
    const drawStyles = () =>
      styles.replaceChildren(
        ...tutor.STYLES.map((s) => {
          const b = el('button', { type: 'button', className: 'style-card' }, el('span', { className: 'style-name' }, s.label), el('span', { className: 'style-blurb' }, s.blurb));
          b.dataset.style = s.id;
          b.setAttribute('role', 'radio');
          b.setAttribute('aria-checked', String(s.id === style));
          b.addEventListener('click', () => {
            style = s.id;
            rememberStyle(style);
            drawStyles();
          });
          return b;
        }),
      );
    drawStyles();

    const exampleButtons = () =>
      (mode === 'explain' ? ['solve 3x - 7 = 11', 'derivative of x^3 sin(x)', 'x^2 - 5x + 6 = 0', '15% tip on 84.50', 'mean of 4 8 15 16 23 42'] : ['the chain rule', 'solving linear equations', 'percentages', 'the Pythagorean theorem', 'integrals']).map((q) =>
        button(q, () => {
          input.value = q;
          void make();
        }, 'example-btn'),
      );
    const examples = el('div', { className: 'seg' }, ...exampleButtons());

    const form = el('form', { className: 'answer-field' }, input, el('button', { type: 'submit', className: 'btn primary', textContent: 'Make lesson' }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void make();
    });

    const stage = el('div', { className: 'video-stage' });
    const actions = el('div', { className: 'btn-row' });
    const list = el('div', { className: 'gallery-list' });

    body.append(
      el('div', { className: 'card maker' }, el('h3', {}, 'New lesson'), modes, form, examples, el('h3', { className: 'style-title' }, 'Teaching style'), styles),
      stage,
      status,
      actions,
      bar,
      el('h3', { className: 'gallery-title' }, 'Your lessons'),
      list,
    );
    disposers.push(openVideoGallery(list, { onPlay: (id) => void play(id) }));
    if (input.value) void make();

    async function make() {
      const q = input.value.trim();
      if (!q) return input.focus();
      cleanup();
      disposers.push(openVideoGallery(list, { onPlay: (id) => void play(id) }));
      stage.replaceChildren();
      actions.replaceChildren();
      status.textContent = '';
      const script: LessonScript | null = mode === 'lecture' ? tutor.lecture(q, style) : tutor.explain(q, style);
      void import('../agenda').then((m) => m.recordActivity({ kind: 'lesson', topic: q }));
      if (!script) {
        if (mode === 'lecture') {
          status.textContent = `There's no lecture for “${q}” yet. Try a topic like the chain rule, fractions, percentages, quadratics or statistics.`;
          return;
        }
        // A practice question brings its own verified steps.
        if (ctx.lesson && q === ctx.query) return showLegacy(ctx.lesson);
        // No worked steps for this one: the question → answer card, so it still gets a video.
        status.textContent = 'Lemma can’t teach this one step by step yet, so this video shows the question and the answer.';
        return showLegacy(await lessonFor(q, ctx.query === q ? (ctx.result ?? '') : ''));
      }
      const player = createScriptPlayer(stage, script, { narrate: true, captions: true, autoplay: true });
      disposers.push(() => player.destroy());
      const mins = Math.max(1, Math.round(tutor.estimateSeconds(script) / 60));
      status.textContent = `${tutor.STYLES.find((s) => s.id === style)?.label ?? ''} · about ${mins} min`;
      actions.append(saveButton(() => exportScriptVideo(script, progressOpts()), script.title, script, player.duration));
      stage.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  })();

  function progressOpts() {
    const aborter = new AbortController();
    disposers.push(() => aborter.abort());
    return {
      signal: aborter.signal,
      onProgress: (p: number) => ((bar.firstElementChild as HTMLElement | null)?.style.setProperty('width', `${Math.round(p * 100)}%`)),
    };
  }

  function saveButton(record: () => Promise<{ blob: Blob; mime: string; vtt?: string }>, title: string, lesson: LessonScript | Lesson, duration: number): HTMLButtonElement {
    const save = button(
      'Save to gallery',
      async () => {
        if (!canExportVideo()) return host.toast('This browser can’t record video');
        save.disabled = true;
        bar.hidden = false;
        const before = status.textContent;
        status.textContent = 'Recording… this takes as long as the lesson.';
        try {
          const { blob, mime, vtt } = await record();
          await gallery.save({ lesson: lesson as never, blob, mime, duration, vtt });
          status.textContent = before;
          host.toast(`Saved “${title}” to your lessons`);
        } catch (e) {
          status.textContent = e instanceof Error ? e.message : String(e);
        } finally {
          save.disabled = false;
          bar.hidden = true;
        }
      },
      'btn primary',
    );
    return save;
  }

  function showLegacy(lesson: Lesson) {
    let stage = body.querySelector<HTMLElement>('.video-stage');
    if (!stage) {
      stage = el('div', { className: 'video-stage' });
      body.append(stage, status, bar);
    }
    stage.replaceChildren();
    const player = createLessonPlayer(stage, lesson);
    disposers.push(() => player.destroy());
    const actions = body.querySelector<HTMLElement>('.btn-row') ?? el('div', { className: 'btn-row' });
    actions.replaceChildren(saveButton(() => exportLessonVideo(lesson, progressOpts()), lesson.title, lesson, player.duration));
    if (!actions.isConnected) stage.after(actions);
    player.play();
  }

  async function play(id: string) {
    const rec = await gallery.get(id);
    if (!rec) return;
    cleanup();
    body.replaceChildren();
    const v = el('video', { controls: true, src: URL.createObjectURL(rec.blob), className: 'gallery-video' });
    body.append(v, button('Back to lessons', () => void import('../study').then((m) => m.openTool('videos'))));
    void v.play().catch(() => undefined);
    disposers.push(() => URL.revokeObjectURL(v.src));
  }

  return cleanup;
}

async function lessonFor(query: string, result: string): Promise<Lesson> {
  if (!result) {
    try {
      const { runtime } = await import('../engine');
      const { createSession } = await import('@lemma/math-core');
      const { outcomeToJSON } = await import('@lemma/runtime');
      // The answer card must match the calculator's angle mode ("sin(pi/2)" is 1 in RAD).
      const session = createSession();
      session.angle = (await import('../storage')).loadSettings().angle;
      const o = outcomeToJSON(await runtime.compute(query, session), query);
      if (o.ok && o.display) result = o.display + (o.unit ? ` ${o.unit}` : '');
    } catch {
      // Leave the answer blank below.
    }
  }
  return { title: 'Worked answer', question: query, steps: [], answer: { display: result || '—' } };
}
