import './solve.css';
import { leave } from '../motion';
import { h, tex } from './dom';
import type { SolveHost } from './host';
import { bestGuess, doubtOf, mathFromOcr, prepare, recognizeLines, splitQuestions, warmOcr, type OcrLine } from './ocr';
import { cropCanvas, cropper, type Box } from './pick';
import { createSession, parseInput } from '@lemma/math-core';
import { toLatex } from '@lemma/steps-engine';
import { asked, display, download, notesMarkdown, solveOne, type Item } from './sheet';
import { renderSteps } from './steps-view';

/**
 * Photo solve: its own screen. A photo (or several, or a PDF) is read and every problem is solved straight away,
 * each as a card with the bit of the photo it came from, the answer and its steps. Then it carries on like a
 * conversation: another photo, a typed or spoken follow-up ("now factor it"), the assistant, or another tool.
 * Desktop and tablets get two panes (the photo beside the answers); phones stack them.
 * A line the reader isn't sure of is shown for checking, never answered on its own (doubtOf).
 */
export interface SnapOptions {
  files?: Blob[];
}

interface Photo {
  blob: Blob;
  name: string;
  bitmap?: ImageBitmap;
  state: 'waiting' | 'reading' | 'done' | 'failed';
  thumb: HTMLButtonElement;
  group: HTMLElement;
}

interface Problem {
  q: string;
  /** Where it is in its photo (pixels), when it came from one. */
  box?: Box;
  photo?: Photo;
  doubt: string | null;
  answer?: string;
  steps?: Item['steps'];
  /** The reader's confidence in the line, 0–100 (photos only). */
  conf?: number;
}

let current: { close(): void; add(files: Blob[]): void } | null = null;
/** The last screen, kept in memory (not storage) so closing and reopening in the same page session loses nothing. */
let last: ((files?: Blob[]) => void) | null = null;

export function openSnap(host: SolveHost, o: SnapOptions = {}): void {
  if (current) {
    if (o.files?.length) current.add(o.files);
    return;
  }
  if (last) return last(o.files);
  warmOcr();
  const coarse = matchMedia('(pointer: coarse)').matches;
  let opener: HTMLElement | null = null;

  const photos: Photo[] = [];
  const problems: Problem[] = [];
  let shown: Photo | null = null;
  let crop: ReturnType<typeof cropper> | null = null;
  let mode: 'all' | 'one' = 'all';
  let queue: Promise<void> = Promise.resolve();

  // ---------- frame ----------
  const fileInput = h('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, hidden: true, 'data-testid': 'snap-file' });
  const cameraInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
  const back = h('button', { type: 'button', class: 'snap-back', 'aria-label': 'Back to the calculator', 'data-testid': 'snap-back' }, '←');
  const addBtn = h('button', { type: 'button', class: 'chip', 'data-testid': 'snap-add' }, 'Add photos');
  const camBtn = h('button', { type: 'button', class: 'chip primary', 'data-testid': 'snap-camera' }, coarse ? 'Take photo' : 'Camera');
  const drawBtn = h('button', { type: 'button', class: 'chip', 'data-testid': 'snap-draw' }, 'Draw');
  // Handwriting on a pad: the existing draw sheet, over this screen.
  // What's read from the pad is solved here, in this list, not in the calculator behind.
  drawBtn.addEventListener('click', () => void import('./pick').then((m) => m.openPicker({ ...host, submit: (q) => ask(q) }, { tab: 'draw' })));
  const head = h('header', { class: 'snap-head' }, back, h('h2', {}, 'Photo solve'), h('span', { class: 'snap-spacer' }), drawBtn, addBtn, camBtn, fileInput, cameraInput);

  const stage = h('div', { class: 'snap-stage', 'data-testid': 'snap-stage' });
  const thumbs = h('div', { class: 'snap-thumbs', role: 'list', 'aria-label': 'Photos' });
  const stageNote = h('p', { class: 'snap-note' });
  const source = h('aside', { class: 'snap-source' }, stage, stageNote, thumbs);

  const cards = h('div', { class: 'snap-cards', 'aria-live': 'polite', 'data-testid': 'snap-cards' });
  const text = h('input', { type: 'text', class: 'snap-text', placeholder: coarse ? 'Follow up, or a new problem' : 'Follow up: “now factor it”, or type a problem', 'aria-label': 'Follow-up', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'send', 'data-testid': 'snap-text' });
  const mic = h('button', { type: 'button', class: 'icon-btn snap-mic', 'aria-label': 'Speak a follow-up', 'aria-pressed': 'false', hidden: !host.listen }, micIcon());
  const shoot = h('button', { type: 'button', class: 'icon-btn', 'aria-label': coarse ? 'Take another photo' : 'Add a photo' }, cameraIcon());
  const ai = h('button', { type: 'button', class: 'chip', hidden: !(host.askAi && host.aiReady()), 'data-testid': 'snap-ai' }, 'Ask AI');
  const composer = h('form', { class: 'snap-composer', 'data-testid': 'snap-composer' }, shoot, text, mic, ai);
  const thread = h('section', { class: 'snap-thread', 'aria-label': 'Problems and answers' }, cards, composer);

  const body = h('div', { class: 'snap-body' }, source, thread);
  let view!: HTMLElement;
  let behind: HTMLElement[] = [];
  // A fresh frame each time it opens (the last one may still be fading out); what's inside is kept.
  const mount = () => {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    view = h('div', { class: 'snap-view', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Photo solve', 'data-testid': 'snap' }, head, body);
    view.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !document.querySelector('dialog[open]:not(.closing)')) {
        e.preventDefault();
        if (webcam) return stopWebcam(true);
        // A follow-up being typed isn't thrown away by Esc.
        if (text.value.trim()) return;
        close();
      }
    });
    view.addEventListener('paste', (e) => {
      const fs = [...(e.clipboardData?.items ?? [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile()!).filter(Boolean);
      if (fs.length) {
        e.preventDefault();
        add(fs);
      }
    });
    view.addEventListener('dragover', (e) => {
      e.preventDefault();
      view.classList.add('over');
    });
    view.addEventListener('dragleave', (e) => e.relatedTarget === null && view.classList.remove('over'));
    view.addEventListener('drop', (e) => {
      e.preventDefault();
      view.classList.remove('over');
      const fs = [...(e.dataTransfer?.files ?? [])];
      if (fs.length) add(fs);
    });
    document.body.append(view);
    document.documentElement.classList.add('snap-open');
    behind = [...document.body.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c !== view && !c.inert && c.tagName !== 'DIALOG' && c.id !== 'toast');
    behind.forEach((c) => (c.inert = true));
    current = { close, add: (fs) => add(fs) };
  };

  let stopVoice: (() => void) | null = null;
  const close = () => {
    stopVoice?.();
    stopWebcam();
    behind.forEach((c) => (c.inert = false));
    document.documentElement.classList.remove('snap-open');
    // The frame fading out is no longer the screen: it can open again over it at once (mount).
    view.removeAttribute('data-testid');
    view.setAttribute('aria-hidden', 'true');
    leave(view);
    current = null;
    if (opener?.isConnected && !opener.closest('[inert]')) opener.focus({ preventScroll: true });
  };
  back.addEventListener('click', close);

  // ---------- adding photos ----------
  const pick = (input: HTMLInputElement) => {
    const fs = [...(input.files ?? [])];
    input.value = '';
    if (fs.length) add(fs);
  };
  fileInput.addEventListener('change', () => pick(fileInput));
  cameraInput.addEventListener('change', () => pick(cameraInput));
  addBtn.addEventListener('click', () => fileInput.click());
  const takePhoto = () => (coarse || !navigator.mediaDevices?.getUserMedia ? cameraInput.click() : void startWebcam());
  camBtn.addEventListener('click', takePhoto);
  shoot.addEventListener('click', takePhoto);

  function add(files: Blob[]) {
    const usable = files.filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf' || (f instanceof File && /\.pdf$/i.test(f.name)));
    if (!usable.length) return host.toast('Those aren’t photos or PDFs');
    const fresh = usable.map((blob, i) => {
      const n = photos.length + i + 1;
      const name = blob instanceof File && blob.name ? blob.name : `Photo ${n}`;
      const thumb = h('button', { type: 'button', class: 'snap-thumb', role: 'listitem', 'aria-label': name, 'data-state': 'waiting' });
      const group = h('div', { class: 'snap-group', 'data-testid': 'snap-group' });
      const p: Photo = { blob, name, state: 'waiting', thumb, group };
      thumb.addEventListener('click', () => {
        void showPhoto(p);
        if (mode === 'one') void readPhoto(p);
        group.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
      void createImageBitmap(blob).then(
        (b) => {
          p.bitmap = b;
          const c = cropCanvas(b, { x: 0, y: 0, w: b.width, h: b.height });
          thumb.style.backgroundImage = `url(${c.toDataURL('image/jpeg', 0.6)})`;
        },
        () => (thumb.textContent = 'PDF'),
      );
      return p;
    });
    photos.push(...fresh);
    thumbs.replaceChildren(...photos.map((p) => p.thumb));
    thumbs.hidden = photos.length < 2;
    // "Photo 1 of 3": headings appear (and renumber) once there's more than one.
    for (const x of photos) x.group.querySelector('.snap-group-head')?.replaceWith(groupHead(x));
    // Several at once: the user decides between one at a time and all together.
    if (fresh.length > 1) return askMode(fresh);
    void showPhoto(fresh[0]!);
    void readPhoto(fresh[0]!);
  }

  function askMode(fresh: Photo[]) {
    const one = h('button', { type: 'button', class: 'chip', 'data-testid': 'snap-one' }, 'One at a time');
    const all = h('button', { type: 'button', class: 'chip primary', 'data-testid': 'snap-all' }, 'All at once');
    const card = h('div', { class: 'snap-card snap-choose', 'data-testid': 'snap-choose' }, h('p', {}, `${fresh.length} photos. Solve them one at a time, or all at once?`), h('div', { class: 'pick-row' }, all, one));
    cards.append(card);
    void showPhoto(fresh[0]!);
    const go = (m: 'all' | 'one') => {
      mode = m;
      card.remove();
      if (m === 'all') fresh.forEach((p) => void readPhoto(p));
      else void readPhoto(fresh[0]!);
    };
    one.addEventListener('click', () => go('one'));
    all.addEventListener('click', () => go('all'));
    all.focus({ preventScroll: true });
  }

  // ---------- the photo on the left (or top) ----------
  async function showPhoto(p: Photo) {
    shown = p;
    photos.forEach((x) => x.thumb.classList.toggle('on', x === p));
    if (!p.bitmap) {
      try {
        p.bitmap = await createImageBitmap(p.blob);
      } catch {
        // A PDF: its text is read, there's no picture to show.
        stage.replaceChildren(h('div', { class: 'snap-doc' }, '📄', h('span', {}, p.name)));
        crop = null;
        return;
      }
    }
    if (shown !== p) return;
    crop = cropper(p.bitmap, () => void readRegion(p));
    stage.replaceChildren(crop.wrap);
    markProblems(p);
    stageNote.textContent = coarse ? 'Tap a problem to jump to it, or drag over one part to read just that.' : 'Click a problem to jump to it, or drag over one part to read just that.';
  }

  function markProblems(p: Photo) {
    if (!crop || shown !== p) return;
    const mine = problems.filter((x) => x.photo === p && x.box);
    crop.mark(mine.map((x) => ({ box: x.box!, pick: () => cardOf.get(x)?.scrollIntoView({ block: 'center', behavior: 'smooth' }) })));
  }

  // ---------- reading ----------
  function readPhoto(p: Photo): Promise<void> {
    if (p.state !== 'waiting') return queue;
    p.state = 'reading';
    p.thumb.dataset.state = 'reading';
    p.group.replaceChildren(groupHead(p), h('p', { class: 'snap-reading', 'data-testid': 'snap-reading' }, 'Reading…'));
    cards.append(p.group);
    // One reader, one photo at a time, in the order they were added.
    return (queue = queue.then(() => readNow(p)));
  }

  function groupHead(p: Photo): HTMLElement {
    const i = photos.indexOf(p);
    return h('h3', { class: 'snap-group-head', hidden: photos.length < 2 }, `Photo ${i + 1} of ${photos.length}`);
  }

  async function readNow(p: Photo, region?: Box) {
    const status = p.group.querySelector<HTMLElement>('.snap-reading');
    const progress = (s: string, f = 0) => void (status && (status.textContent = f > 0 && f < 1 ? `${s} ${Math.round(f * 100)}%` : s));
    let found: Problem[] = [];
    try {
      const isPdf = p.blob.type === 'application/pdf' || (p.blob instanceof File && /\.pdf$/i.test(p.blob.name));
      if (isPdf) {
        const { extractPdf } = await import('../exam/import');
        const x = await extractPdf(p.blob, p.name, progress);
        found = splitQuestions(x.text).map((q) => ({ q, photo: p, doubt: null }));
      } else {
        const bitmap = p.bitmap ?? (p.bitmap = await createImageBitmap(p.blob));
        const r = region ?? { x: 0, y: 0, w: bitmap.width, h: bitmap.height };
        const canvas = prepare(bitmap, r);
        const scale = canvas.width / r.w;
        const res = await recognizeLines(canvas, progress);
        const lines = res.lines.filter((l) => mathFromOcr(l.text).length);
        const merged = stackedTogether(lines);
        for (const l of merged) {
          const q = mathFromOcr(l.text)[0] ?? l.text.trim();
          const box = { x: r.x + l.box.x0 / scale, y: r.y + l.box.y0 / scale, w: (l.box.x1 - l.box.x0) / scale, h: (l.box.y1 - l.box.y0) / scale };
          found.push({ q, box, photo: p, doubt: doubtOf(q, l, merged), conf: Math.round(l.confidence) });
        }
        if (!found.length) found = mathFromOcr(res.text).map((q) => ({ q, photo: p, doubt: null }));
      }
    } catch {
      p.state = 'failed';
      p.thumb.dataset.state = 'failed';
      status && (status.textContent = 'The reader couldn’t load (it needs one online visit to download its data), or the file couldn’t be opened.');
      return;
    }
    for (const x of problems.filter((x) => x.photo === p)) cardOf.get(x)?.remove();
    problems.splice(0, problems.length, ...problems.filter((x) => x.photo !== p), ...found);
    p.state = 'done';
    p.thumb.dataset.state = 'done';
    p.group.replaceChildren(groupHead(p));
    if (!found.length) p.group.append(h('p', { class: 'snap-reading' }, 'No maths found in this one. Drag over the problem on the photo, or type it below.'));
    for (const x of found) p.group.append(card(x));
    markProblems(p);
    // A worksheet's worth: all of it to the notebook, or as notes to keep.
    if (found.length > 1) {
      p.group.append(
        h('div', { class: 'snap-actions snap-group-actions' },
          h('button', { type: 'button', class: 'chip', 'data-testid': 'snap-all-notebook', onclick: () => void host.notebook().then((nb) => {
            for (const x of found) nb.appendQuery(x.q);
            host.toast('Added to your notebook');
          }) }, 'All to notebook'),
          h('button', { type: 'button', class: 'chip', 'data-testid': 'snap-notes', onclick: () => download(notesMarkdown(found.map((x) => ({ q: x.q, answer: x.answer ?? 'Not solved', steps: x.steps ?? null })))) }, 'Download notes'),
        ),
      );
    }
    // One at a time: offer the next photo once this one is done.
    const next = photos.find((x) => x.state === 'waiting');
    if (mode === 'one' && next) {
      const b = h('button', { type: 'button', class: 'chip primary snap-next', 'data-testid': 'snap-next' }, `Next photo (${photos.indexOf(next) + 1} of ${photos.length}) →`);
      b.addEventListener('click', () => {
        b.remove();
        void showPhoto(next);
        void readPhoto(next);
      });
      p.group.append(b);
    }
  }

  function readRegion(p: Photo) {
    if (!crop || p.state === 'reading') return;
    const r = crop.region();
    p.state = 'reading';
    p.group.querySelectorAll('.snap-next').forEach((n) => n.remove());
    p.group.append(h('p', { class: 'snap-reading' }, 'Reading that part…'));
    queue = queue.then(() => readNow(p, r));
  }

  // ---------- one problem ----------
  const cardOf = new Map<Problem, HTMLElement>();

  function card(x: Problem): HTMLElement {
    const read = h('input', { class: 'snap-read', value: x.q, 'aria-label': 'What was read', spellcheck: 'false', autocomplete: 'off', 'data-testid': 'snap-read' });
    const answer = h('div', { class: 'snap-answer', 'data-testid': 'snap-answer' });
    const flag = h('div', { class: 'snap-flag', 'data-testid': 'snap-flag', hidden: true });
    const steps = h('details', { class: 'snap-steps', hidden: true }, h('summary', {}, 'Steps'));
    const actions = h('div', { class: 'snap-actions', hidden: true });
    const top = h('div', { class: 'snap-card-top' });
    if (x.box && x.photo?.bitmap) {
      // The bit of the photo it came from, so a misread is easy to spot.
      const pad = 8;
      const b = x.photo.bitmap;
      const c = cropCanvas(b, { x: Math.max(0, x.box.x - pad), y: Math.max(0, x.box.y - pad), w: Math.min(b.width, x.box.w + pad * 2), h: Math.min(b.height, x.box.h + pad * 2) });
      c.className = 'snap-crop';
      c.setAttribute('aria-hidden', 'true');
      top.append(c);
    }
    top.append(read);
    const el = h('article', { class: 'snap-card', 'data-testid': 'snap-card', 'data-conf': x.conf === undefined ? undefined : String(x.conf) }, top, flag, answer, steps, actions);
    cardOf.set(x, el);

    const solve = async () => {
      x.q = read.value.trim();
      if (!x.q) return;
      el.dataset.state = 'solving';
      flag.hidden = true;
      answer.textContent = 'Solving…';
      steps.hidden = true;
      actions.hidden = true;
      const it: Item = { q: x.q, answer: '', ok: false, steps: null };
      await solveOne(host, it);
      x.answer = it.ok ? it.answer : undefined;
      x.steps = it.steps;
      el.dataset.state = it.ok ? 'done' : 'error';
      answer.textContent = it.ok ? it.answer : it.answer.replace(/^Not solved: /, 'Couldn’t solve this: ');
      steps.replaceChildren(h('summary', {}, 'Steps'));
      if (it.steps) {
        steps.append(renderSteps(it.steps));
        steps.hidden = false;
        // One problem: its working is open, like an answer in the calculator; several: folded to keep the list short.
        steps.open = problems.length <= 1;
      }
      actions.replaceChildren(...tools(x));
      actions.hidden = false;
    };
    /**
     * Not sure of the reading: show the best guess, typeset, beside the photo it came from, with what it would
     * come to. Editing the line updates both; Solve takes it as it stands. Nothing to fill in, no menu of fixes.
     */
    const check = (why: string) => {
      el.dataset.state = 'check';
      answer.textContent = '';
      flag.hidden = false;
      read.value = bestGuess(read.value.trim(), why);
      const shown = h('div', { class: 'snap-guess', 'data-testid': 'snap-guess' });
      const preview = h('span', { class: 'snap-preview', 'data-testid': 'snap-preview' });
      const go = h('button', { type: 'button', class: 'chip primary', 'data-testid': 'snap-solve' }, 'Solve');
      const edit = h('button', { type: 'button', class: 'chip', 'data-testid': 'snap-edit' }, 'Edit');
      go.addEventListener('click', () => {
        x.doubt = null;
        read.removeEventListener('input', typed);
        clearTimeout(wait);
        void solve();
      });
      edit.addEventListener('click', () => {
        read.focus();
        read.setSelectionRange(read.value.length, read.value.length);
      });
      let gen = 0;
      let wait = 0;
      function update(delay = 0) {
        const q = read.value.trim();
        const mine = ++gen;
        shown.replaceChildren(typeset(q));
        preview.textContent = '';
        clearTimeout(wait);
        // While typing, work out the preview only once typing stops (not an algebra job per keystroke).
        wait = window.setTimeout(() => void host.compute(asked(q)).then((o) => {
          const v = mine === gen && o.kind !== 'error' && o.kind !== 'pending' && o.kind !== 'empty' ? display(o) : '';
          if (mine === gen) preview.textContent = v ? `= ${v}` : '';
        }, () => undefined), delay);
      }
      const typed = () => update(300);
      read.addEventListener('input', typed);
      flag.replaceChildren(h('p', {}, `Best guess, ${why.charAt(0).toLowerCase()}${why.slice(1)}. Edit it if it doesn’t match the photo.`), shown, h('div', { class: 'pick-row' }, go, edit, preview));
      update();
    };
    read.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      x.doubt = null;
      void solve();
    });
    if (x.doubt) check(x.doubt);
    else void solve();
    return el;
  }

  function tools(x: Problem): HTMLElement[] {
    const chip = (label: string, on: () => void, testid?: string) => h('button', { type: 'button', class: 'chip', 'data-testid': testid, onclick: on }, label);
    const out = [
      chip('Open in calculator', () => {
        close();
        host.submit(x.q);
      }, 'snap-open-calc'),
      chip('Practice similar', () => host.openTool('practice', { query: x.q })),
      chip('Video lesson', () => host.openTool('video', { query: x.q, result: x.answer })),
      chip('Notebook', () => void host.notebook().then((nb) => {
        nb.appendQuery(x.q);
        host.toast('Added to your notebook');
      })),
    ];
    if (host.askAi && host.aiReady()) out.splice(1, 0, chip('Ask AI', () => {
      close();
      host.askAi!(`Help me understand this problem: ${x.q}${x.answer ? ` (Lemma's answer: ${x.answer})` : ''}`);
    }));
    return out;
  }

  // ---------- follow-ups ----------
  /** "now factor it", "what if x = 3", "+ 5": about the last problem; anything else is a new one. */
  function followUp(t: string): string {
    const last = [...problems].reverse().find((x) => x.answer !== undefined) ?? problems.at(-1);
    if (!last) return t;
    // The last problem as an expression: "x^2 - 5x + 6 = 0" → x^2 - 5x + 6; "3x + 5 = 20" → (3x + 5) - (20);
    // an inequality the same way ("x^2 - 4 >= 0" → x^2 - 4), so "factor it" factors its polynomial side.
    const [lhs, rhs] = last.q.replace(/^\s*(?:solve|simplify|factor|expand|evaluate)\s+/i, '').split(/(?:<=|>=|[=<>≤≥])(.*)/s);
    const expr = rhs === undefined ? lhs!.trim() : /^\s*0\s*$/.test(rhs) ? lhs!.trim() : `(${lhs!.trim()}) - (${rhs.trim()})`;
    if (/^\s*[+\-*/^×÷]/.test(t) && last.answer && /^[−\-\d.,\s/]+$/.test(last.answer)) return `(${last.answer.replace(/−/g, '-').replace(/,/g, '')}) ${t}`;
    if (/\b(?:it|that|this|the (?:answer|equation|expression|problem))\b/i.test(t)) return t.replace(/\b(?:it|that|this|the (?:answer|equation|expression|problem))\b/i, `(${expr})`);
    const at = /^\s*(?:what if|when|at|with|if)\s+([a-z])\s*=\s*(.+)$/i.exec(t);
    if (at) return `${expr} where ${at[1]} = ${at[2]}`;
    return t;
  }

  const ask = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    const x: Problem = { q: followUp(t), doubt: null };
    problems.push(x);
    const c = card(x);
    cards.append(c);
    c.scrollIntoView({ block: 'end', behavior: 'smooth' });
  };
  composer.addEventListener('submit', (e) => {
    e.preventDefault();
    ask(text.value);
    text.value = '';
  });
  ai.addEventListener('click', () => {
    const last = problems.at(-1);
    const t = text.value.trim();
    close();
    host.askAi?.(t ? (last ? `${t} (about: ${last.q})` : t) : last ? `Help me understand this problem: ${last.q}` : 'Help me with a maths problem');
  });
  mic.addEventListener('click', () => {
    if (stopVoice) {
      stopVoice();
      return;
    }
    mic.setAttribute('aria-pressed', 'true');
    text.placeholder = 'Listening…';
    stopVoice = host.listen!({
      onPartial: (t) => (text.value = t),
      onFinal: (t) => {
        text.value = '';
        ask(t);
      },
      onEnd: () => {
        stopVoice = null;
        mic.setAttribute('aria-pressed', 'false');
        text.placeholder = coarse ? 'Follow up, or a new problem' : 'Follow up: “now factor it”, or type a problem';
      },
      onError: (m) => host.toast(m),
    });
  });

  // ---------- webcam (desktop) ----------
  let webcam: { stream: MediaStream; restore: Node[] } | null = null;
  async function startWebcam() {
    if (webcam) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } });
    } catch {
      host.toast('No camera available. Choose a photo instead.');
      return fileInput.click();
    }
    const video = h('video', { class: 'snap-video', autoplay: true, playsinline: true, muted: true, 'data-testid': 'snap-video' });
    video.srcObject = stream;
    const snapBtn = h('button', { type: 'button', class: 'chip primary', 'data-testid': 'snap-capture' }, 'Capture');
    const cancel = h('button', { type: 'button', class: 'chip' }, 'Cancel');
    webcam = { stream, restore: [...stage.childNodes] };
    stage.replaceChildren(h('div', { class: 'snap-live' }, video, h('div', { class: 'pick-row snap-live-row' }, snapBtn, cancel)));
    stageNote.textContent = 'Hold the problem up to the camera, then capture.';
    cancel.addEventListener('click', () => stopWebcam(true));
    snapBtn.addEventListener('click', () => {
      const c = document.createElement('canvas');
      c.width = video.videoWidth || 1280;
      c.height = video.videoHeight || 720;
      c.getContext('2d')!.drawImage(video, 0, 0, c.width, c.height);
      stopWebcam(false);
      c.toBlob((b) => b && add([b]), 'image/png');
    });
    snapBtn.focus();
  }
  function stopWebcam(restore = false) {
    if (!webcam) return;
    webcam.stream.getTracks().forEach((t) => t.stop());
    if (restore) stage.replaceChildren(...webcam.restore);
    webcam = null;
  }

  // ---------- start ----------
  const empty = () => {
    if (photos.length) return;
    stage.replaceChildren(
      h('div', { class: 'snap-empty' }, h('p', {}, coarse ? 'Take a photo of a problem, or choose some from your photos.' : 'Drop photos or a PDF here, paste a screenshot, or use the camera.'), h('div', { class: 'pick-row' }, camBtn.cloneNode(true) as HTMLElement, addBtn.cloneNode(true) as HTMLElement)),
    );
    stage.querySelectorAll<HTMLButtonElement>('.snap-empty .chip').forEach((b, i) => {
      b.removeAttribute('data-testid');
      b.addEventListener('click', i === 0 ? takePhoto : () => fileInput.click());
    });
    cards.replaceChildren(h('p', { class: 'snap-hint' }, 'Every problem in the photo is solved here, with its steps. Then ask a follow-up, add another photo, or open it in a tool.'));
  };
  empty();
  const start = (files?: Blob[]) => {
    mount();
    if (files?.length) {
      cards.querySelector('.snap-hint')?.remove();
      add(files);
    }
    (files?.length || problems.length ? text : camBtn).focus({ preventScroll: true });
  };
  last = start;
  start(o.files);
}

/** Starts the reader's one-time download (the camera button calls this before a photo arrives). */
export function warmSnap(): void {
  warmOcr();
}

/**
 * Lines that sit on top of each other (a fraction's top and bottom, a power above its base) are one problem: they
 * become one line spanning both, its text joined (it will be flagged for checking, since it can't be trusted).
 */
function stackedTogether(lines: OcrLine[]): OcrLine[] {
  const out: OcrLine[] = [];
  for (const l of [...lines].sort((a, b) => a.box.y0 - b.box.y0)) {
    const h = l.box.y1 - l.box.y0;
    const into = out.find((o) => {
      const overlapX = Math.min(o.box.x1, l.box.x1) - Math.max(o.box.x0, l.box.x0);
      const gap = l.box.y0 - o.box.y1;
      return overlapX > 0.3 * Math.min(o.box.x1 - o.box.x0, l.box.x1 - l.box.x0) && gap < h * 0.45;
    });
    if (!into) out.push({ ...l, box: { ...l.box } });
    else {
      into.text = `${into.text.trim()} ${l.text.trim()}`;
      into.box = { x0: Math.min(into.box.x0, l.box.x0), y0: Math.min(into.box.y0, l.box.y0), x1: Math.max(into.box.x1, l.box.x1), y1: Math.max(into.box.y1, l.box.y1) };
      into.confidence = Math.min(into.confidence, l.confidence);
      into.stacked = true;
    }
  }
  return out;
}

/** A line typeset the way the engine reads it (so "sqrt(144) + 2^3" shows as √144 + 2³); plain text if it won't parse. */
function typeset(q: string): HTMLElement {
  if (!q) return h('span', {});
  const body = q.replace(/^\s*(?:solve|simplify|factor|expand|evaluate)\s+/i, '');
  try {
    const sides = body.split(/\s*(=|<=|>=|<|>)\s*/);
    const latex = sides.map((p, i) => (i % 2 ? ({ '<=': '\\le', '>=': '\\ge' } as Record<string, string>)[p] ?? p : toLatex(parseInput(p, createSession())))).join(' ');
    return tex(latex, true, 'snap-guess-math');
  } catch {
    return h('span', { class: 'snap-guess-math' }, q);
  }
}

const micIcon = () => svgIcon('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>');
const cameraIcon = () => svgIcon('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>');
function svgIcon(paths: string): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = paths;
  return s;
}

