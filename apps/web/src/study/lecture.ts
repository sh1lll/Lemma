import { summarize, toMarkdown, type LectureSummary } from '@lemma/lecture-engine';
import type { NoteDraft, ToolContext } from '../study';
import { button, el, typeset } from './ui';

/**
 * Lecture summarizer: record, upload or paste a lecture; transcription runs on this device (Whisper), and the
 * summary is extracted from the transcript (key points, formulas, definitions, outline, examples). Audio is
 * kept in memory only and never saved.
 */
export function mountLecture(body: HTMLElement, _ctx: ToolContext, host: { toast: (m: string) => void; addNote: (n: NoteDraft) => boolean }): () => void {
  let aborter: AbortController | null = null;
  let recorder: { stop(): Promise<Float32Array>; level(): number; elapsed(): number; ready: Promise<void> } | null = null;
  let tick = 0;

  const status = el('p', { className: 'fine' });
  const bar = el('div', { className: 'progress' }, el('i'));
  bar.hidden = true;
  const out = el('div', { className: 'lecture-out' });

  const recordBtn = button('Record', () => void toggleRecord(), 'btn primary');
  const file = el('input', { type: 'file', accept: 'audio/*,video/*' });
  file.hidden = true;
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    file.value = '';
    if (f) void fromFile(f);
  });
  const paste = el('textarea', { placeholder: 'Or paste a transcript here', rows: 5, className: 'transcript-input' });
  paste.setAttribute('aria-label', 'Transcript');

  body.append(
    el(
      'div',
      { className: 'card' },
      el('h3', {}, 'Lecture'),
      el('div', { className: 'btn-row' }, recordBtn, button('Upload audio', () => file.click()), file),
      el('p', { className: 'fine' }, 'Transcribed on this device. The recording is never saved.'),
    ),
    paste,
    el(
      'div',
      { className: 'btn-row' },
      button('Summarize text', () => show(paste.value, [])),
      button('Try a sample lecture', () =>
        void import('@lemma/lecture-engine').then(({ SAMPLE_LECTURE }) => {
          paste.value = SAMPLE_LECTURE;
          show(SAMPLE_LECTURE, []);
        }),
      ),
    ),
    bar,
    status,
    out,
  );

  async function toggleRecord() {
    const lecture = await import('../lecture');
    if (recorder) {
      clearInterval(tick);
      recordBtn.textContent = 'Record';
      const r = recorder;
      recorder = null;
      let audio: Float32Array;
      try {
        audio = await r.stop();
      } catch {
        return; // The microphone never opened; ready's handler already said why.
      }
      return transcribe(audio);
    }
    try {
      recorder = lecture.recordLecture();
    } catch (e) {
      return host.toast(e instanceof Error ? e.message : 'Couldn’t start recording');
    }
    recorder.ready.catch((e: unknown) => {
      clearInterval(tick);
      recorder = null;
      recordBtn.textContent = 'Record';
      status.textContent = e instanceof Error ? e.message : 'Couldn’t use the microphone';
    });
    recordBtn.textContent = 'Stop';
    tick = window.setInterval(() => {
      if (!recorder) return;
      const s = Math.floor(recorder.elapsed());
      status.textContent = `Recording ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }, 500);
  }

  async function fromFile(f: File) {
    status.textContent = `Reading ${f.name}…`;
    try {
      // Streams long WAV/MP3 files window by window instead of decoding hours of audio at once.
      const { openAudioFile } = await import('../lecture');
      await transcribe(await openAudioFile(f));
    } catch (e) {
      status.textContent = e instanceof Error ? e.message : 'Couldn’t read that file';
    }
  }

  async function transcribe(audio: Float32Array | import('../lecture').AudioSource) {
    const { transcribeLong } = await import('../lecture');
    aborter = new AbortController();
    bar.hidden = false;
    status.textContent = 'Transcribing on this device…';
    try {
      const segments = await transcribeLong(audio, {
        signal: aborter.signal,
        onProgress: (done, total) => {
          (bar.firstElementChild as HTMLElement).style.width = `${Math.round((done / Math.max(1, total)) * 100)}%`;
          status.textContent = `Transcribing… ${done} of ${total}`;
        },
      });
      paste.value = segments.map((s) => s.text).join(' ');
      show(paste.value, segments);
    } catch (e) {
      if (!aborter.signal.aborted) status.textContent = e instanceof Error ? e.message : String(e);
    } finally {
      bar.hidden = true;
      aborter = null;
    }
  }

  function show(text: string, segments: { text: string; start: number; end: number }[]) {
    if (!text.trim()) return host.toast('Nothing to summarize yet');
    const s = summarize(segments.length ? segments : text);
    status.textContent = '';
    out.replaceChildren(...renderSummary(s));
    // Saved once: the button says so, rather than making a copy on every press.
    const saveBtn = button(
      'Save to notes',
      () => {
        if (!saveNote(s)) return;
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saved to notes';
      },
      'btn primary',
    );
    out.append(
      el(
        'div',
        { className: 'btn-row' },
        saveBtn,
        button('Add to notebook', () => void toNotebook(s)),
        button('Copy', () => void navigator.clipboard?.writeText(toMarkdown(s)).then(() => host.toast('Copied'), () => host.toast('Clipboard is unavailable here'))),
      ),
    );
  }

  function saveNote(s: LectureSummary): boolean {
    const saved = host.addNote({
      text: `${s.title}: ${s.keyPoints.slice(0, 2).join(' ')}`,
      tags: ['lecture'],
      saved: { question: s.title, result: `${s.keyPoints.length} key points, ${s.formulas.length} formulas`, steps: [...s.keyPoints.map((k) => ({ text: k })), ...s.formulas.map((f) => ({ text: f.spoken, tex: f.tex }))] },
    });
    if (saved) host.toast('Saved to notes');
    return !!saved;
  }

  async function toNotebook(s: LectureSummary) {
    const { listNotebooks, loadNotebook, saveNotebook, openLatest } = await import('../notebook/store');
    const latest = listNotebooks()[0];
    const nb = (latest && loadNotebook(latest.id)) ?? openLatest();
    nb.cells.push({ id: Math.random().toString(36).slice(2, 10), type: 'text', source: toMarkdown(s) });
    for (const f of s.formulas) nb.cells.push({ id: Math.random().toString(36).slice(2, 10), type: 'math', source: f.expression });
    nb.updated = Date.now();
    host.toast(saveNotebook(nb) ? `Added to “${nb.title}”` : 'Couldn’t save the notebook: storage is full');
  }

  return () => {
    aborter?.abort();
    clearInterval(tick);
    recorder?.stop().catch(() => undefined);
  };
}

function renderSummary(s: LectureSummary): HTMLElement[] {
  const section = (title: string, ...kids: (Node | string)[]) => el('div', { className: 'card' }, el('h3', {}, title), ...kids);
  const parts: HTMLElement[] = [el('h3', { className: 'lecture-title' }, s.title)];
  if (s.keyPoints.length) parts.push(section('Key points', el('ul', {}, ...s.keyPoints.map((k) => el('li', {}, k)))));
  if (s.formulas.length)
    parts.push(
      section(
        'Formulas',
        el(
          'ul',
          { className: 'formulas-list' },
          ...s.formulas.map((f) => {
            const m = el('span');
            if (f.tex) typeset(m, f.tex);
            else m.textContent = f.expression;
            return el('li', {}, m, el('span', { className: 'fine' }, ` “${f.spoken}”`));
          }),
        ),
      ),
    );
  if (s.definitions.length) parts.push(section('Definitions', el('dl', {}, ...s.definitions.flatMap((d) => [el('dt', {}, d.term), el('dd', {}, d.meaning)]))));
  if (s.examples.length) parts.push(section('Examples', el('ul', {}, ...s.examples.map((x) => el('li', {}, x)))));
  if (s.outline.length)
    parts.push(
      section(
        'Outline',
        el(
          'ol',
          {},
          ...s.outline.map((o) => el('li', {}, o.at !== undefined ? `${Math.floor(o.at / 60)}:${String(Math.floor(o.at % 60)).padStart(2, '0')}  ` : '', o.heading)),
        ),
      ),
    );
  return parts;
}
