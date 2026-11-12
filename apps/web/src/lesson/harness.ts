// Dev-only harness, loaded by apps/web/lesson-harness.html (`npx vite apps/web`). Not imported by the app.
// Default: the step-card Lesson player. With ?script=equation|graph|lecture[&style=…]: the lesson-script player.
import '../style.css';
import { SAMPLE_SCRIPTS } from './harness-scripts';
import * as lessonApi from './index';
import { createLessonPlayer, createScriptPlayer, exportLessonVideo, exportScriptVideo, gallery, openVideoGallery, STYLE_LOOKS, type Lesson } from './index';
import type { StyleId } from './script-timeline';

export const sampleLesson: Lesson = {
  title: 'Solving a quadratic by factoring',
  question: 'Solve x² − 5x + 6 = 0',
  questionTex: 'x^2 - 5x + 6 = 0',
  steps: [
    { text: 'Look for two numbers that multiply to 6 and add to −5.', tex: '(-2)\\cdot(-3) = 6,\\quad (-2)+(-3) = -5' },
    { text: 'Use them to factor the left side.', tex: 'x^2 - 5x + 6 = (x-2)(x-3)' },
    { text: 'A product is zero when one of its factors is zero.', tex: '(x-2)(x-3) = 0' },
    { text: 'Set each factor equal to zero.', tex: 'x - 2 = 0 \\quad\\text{or}\\quad x - 3 = 0' },
    { text: 'Solve each equation.', tex: 'x = 2 \\quad\\text{or}\\quad x = 3' },
  ],
  answer: { display: 'x = 2 or x = 3', tex: 'x = 2 \;\\text{or}\; x = 3' },
};

const $ = (id: string) => document.getElementById(id)!;
const params = new URLSearchParams(location.search);
const scriptId = params.get('script');
const status = $('status');

$('theme').addEventListener('click', () => {
  const r = document.documentElement;
  r.dataset.theme = r.dataset.theme === 'dark' ? 'light' : 'dark';
});

if (scriptId && SAMPLE_SCRIPTS[scriptId]) {
  const base = SAMPLE_SCRIPTS[scriptId]!;
  const styleParam = params.get('style');
  const script = { ...base, style: (styleParam && styleParam in STYLE_LOOKS ? styleParam : base.style) as StyleId };
  const ui = $('script-ui');
  ui.hidden = false;
  ui.style.display = 'flex';
  const pick = (id: string, options: [string, string][], value: string, onChange: (v: string) => void) => {
    const sel = $(id) as HTMLSelectElement;
    sel.replaceChildren(...options.map(([v, label]) => new Option(label, v, v === value, v === value)));
    sel.addEventListener('change', () => onChange(sel.value));
  };
  pick('script-pick', Object.keys(SAMPLE_SCRIPTS).map((k) => [k, SAMPLE_SCRIPTS[k]!.title]), scriptId, (v) => {
    params.set('script', v);
    params.delete('style');
    location.search = params.toString();
  });
  const narrate = params.get('narrate') !== '0';
  const player = createScriptPlayer($('player'), script, { narrate, captions: true, autoplay: params.get('autoplay') === '1' });
  pick('style-pick', Object.entries(STYLE_LOOKS).map(([k, v]) => [k, v.label]), script.style, (v) => {
    script.style = v as StyleId;
    player.setStyle(v as StyleId);
  });
  openVideoGallery($('gallery'));
  $('export').addEventListener('click', async () => {
    try {
      const v = await exportScriptVideo(script, { onProgress: (p) => (status.textContent = `Recording ${Math.round(p * 100)}%`) });
      await gallery.save({ lesson: script, blob: v.blob, mime: v.mime, vtt: v.vtt });
      status.textContent = `Saved ${v.mime}, ${v.blob.size} bytes, ${v.vtt.split('-->').length - 1} captions`;
    } catch (e) {
      status.textContent = (e as Error).message;
    }
  });
  Object.assign(window, { lessonApi, lessonHarness: { player, script, scripts: SAMPLE_SCRIPTS, sampleLesson } });
} else {
  const player = createLessonPlayer($('player'), sampleLesson);
  openVideoGallery($('gallery'));
  $('export').addEventListener('click', async () => {
    try {
      const v = await exportLessonVideo(sampleLesson, { onProgress: (p) => (status.textContent = `Recording ${Math.round(p * 100)}%`) });
      await gallery.save({ lesson: sampleLesson, blob: v.blob, mime: v.mime });
      status.textContent = `Saved ${v.mime}, ${v.blob.size} bytes`;
    } catch (e) {
      status.textContent = (e as Error).message;
    }
  });
  // Exposed for e2e tests.
  Object.assign(window, { lessonApi, lessonHarness: { player, sampleLesson, scripts: SAMPLE_SCRIPTS } });
}
