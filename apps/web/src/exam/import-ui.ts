import { TOPICS } from '@lemma/practice-engine';
import { add, clear, fill, h, icon } from './dom';
import { engine, FORMAT_LABELS, preset, sectionCount, TRADEMARK_NOTE } from './engine';
import { extractFile, toDoc } from './import';
import type { Exam, ExamProfile, ImportedDoc, Room, Section, Topic } from './types';

/** "New exam": upload tests/notes (optional), pick a format, review the profile, build. */

interface DocEntry {
  id: string;
  doc: ImportedDoc | null;
  name: string;
  status: string;
  progress: number;
  error?: string;
}

const KIND_LABEL: Record<ImportedDoc['kind'], string> = { test: 'Test or quiz', 'study-guide': 'Study guide', notes: 'Notes', 'answer-key': 'Answer key', unknown: 'Not sure' };
const ROOM_LABEL: Record<Room, string> = {
  'digital-adaptive': 'On screen, adaptive modules',
  'digital-linear': 'On screen, one question at a time',
  paper: 'Printed paper test',
  'free-response': 'Free response (written parts)',
};
const topicLabel = (t: Topic) => TOPICS.find((x) => x.id === t)?.label ?? t;

/** "1 B, 2 C, 3) 12" → {1: "B", 2: "C", 3: "12"} */
export function parseKeyText(s: string): Record<number, string> {
  const out: Record<number, string> = {};
  for (const m of s.matchAll(/(\d{1,3})\s*[.):\-=]?\s*([A-Ea-e](?![a-z])|[-−]?\d+(?:[./]\d+)?|[^,;\n\d][^,;\n]*)/g)) out[Number(m[1])] = m[2]!.trim().replace(/−/g, '-');
  return out;
}

function keyText(doc: ImportedDoc): string {
  return doc.questions.filter((q) => q.answer !== undefined).map((q) => `${q.number} ${Array.isArray(q.answer) ? q.answer.join('') : q.answer}`).join(', ');
}

export function openNewExam(container: HTMLElement, o: { onBack(): void; onStart(exam: Exam): void; toast(m: string): void; docs?: ImportedDoc[] }): void {
  container.className = 'ex-center ex-new';
  const entries: DocEntry[] = (o.docs ?? []).map((d, i) => ({ id: `d${i}`, doc: d, name: d.name, status: 'Ready', progress: 1 }));
  const topics = new Set<Topic>();
  let seq = entries.length;

  const list = h('div', { class: 'ex-docs', 'aria-live': 'polite' });
  const fileInput = h('input', { type: 'file', multiple: true, accept: '.pdf,.txt,.md,.markdown,.text,image/*', class: 'ex-sr-only', id: 'ex-file', 'aria-label': 'Choose files' });
  const drop = h('label', { class: 'ex-drop', for: 'ex-file' },
    icon('upload', 'ex-ico ex-drop-ico'),
    h('span', { class: 'ex-drop-title' }, 'Drop tests, quizzes, study guides or notes'),
    h('span', { class: 'ex-muted' }, 'PDF, photos of tests, or text files. Everything is read on this device.'),
    h('span', { class: 'ex-btn ex-btn-outline' }, 'Choose files'),
  );
  const paste = h('textarea', { class: 'ex-paste', rows: '4', placeholder: 'Or paste a test or study guide here…', 'aria-label': 'Paste text' });
  const pasteBtn = h('button', { type: 'button', class: 'ex-btn', onclick: () => {
    if (!paste.value.trim()) return;
    const doc = engine.importText(paste.value, `Pasted text ${seq + 1}`);
    entries.push({ id: `d${seq++}`, doc, name: doc.name, status: 'Ready', progress: 1 });
    paste.value = '';
    paintDocs();
  } }, 'Add pasted text');
  const build = h('button', { type: 'button', class: 'ex-btn ex-btn-primary', disabled: true, onclick: () => goProfile(undefined) }, 'Use these to build my exam');

  async function addFiles(files: FileList | File[]) {
    for (const f of [...files]) {
      const e: DocEntry = { id: `d${seq++}`, doc: null, name: f.name, status: 'Waiting…', progress: 0 };
      entries.push(e);
      paintDocs();
      try {
        const x = await extractFile(f, (m, frac) => {
          e.status = m;
          if (frac !== undefined) e.progress = frac;
          paintDoc(e);
        });
        e.doc = toDoc(x);
        e.status = x.ocr ? 'Read with OCR' : x.pages ? `${x.pages} page${x.pages === 1 ? '' : 's'}` : 'Ready';
        e.progress = 1;
      } catch (err) {
        e.error = (err as Error).message || 'Could not read this file';
        e.status = 'Failed';
      }
      paintDocs();
    }
  }
  fileInput.addEventListener('change', () => fileInput.files && void addFiles(fileInput.files).then(() => (fileInput.value = '')));
  drop.addEventListener('dragover', (e) => (e.preventDefault(), drop.classList.add('is-over')));
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-over');
    if (e.dataTransfer?.files.length) void addFiles(e.dataTransfer.files);
  });

  function docCard(e: DocEntry): HTMLElement {
    const card = h('article', { class: 'ex-doc', 'data-doc': e.id, 'aria-label': e.name });
    const head = h('div', { class: 'ex-doc-head' },
      h('h3', { class: 'ex-doc-name' }, e.name),
      h('span', { class: 'ex-muted ex-doc-status' }, e.status),
      h('button', { type: 'button', class: 'ex-icon-btn', 'aria-label': `Remove ${e.name}`, onclick: () => (entries.splice(entries.indexOf(e), 1), paintDocs()) }, icon('trash')),
    );
    card.append(head);
    if (!e.doc) {
      card.append(e.error ? h('p', { class: 'ex-res-warn' }, e.error) : h('div', { class: 'ex-progress', role: 'progressbar', 'aria-label': `Reading ${e.name}`, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(e.progress * 100)) }, h('div', { class: 'ex-progress-fill', style: `width:${Math.round(e.progress * 100)}%` })));
      if (/language data|text reader/i.test(e.status)) card.append(h('p', { class: 'ex-muted ex-small' }, 'The first photo downloads English reading data (about 10 MB) from the tesseract.js CDN once. Reading itself happens on this device.'));
      return card;
    }
    const d = e.doc;
    const keyed = d.questions.filter((q) => q.answer !== undefined).length;
    const found = [
      `${d.questions.length} question${d.questions.length === 1 ? '' : 's'}`,
      d.hints.sections?.length ? `${d.hints.sections.length} sections` : null,
      d.hints.timeMinutes ? `${d.hints.timeMinutes} min` : 'no time limit found',
      d.hints.calculator === undefined ? null : d.hints.calculator ? 'calculator allowed' : 'no calculator',
      d.questions.length ? (keyed ? `key for ${keyed}` : 'no key') : null,
      d.topics.length ? `topics: ${d.topics.slice(0, 3).map((t) => topicLabel(t.topic)).join(', ')}` : null,
    ].filter(Boolean) as string[];
    const kind = h('select', { class: 'ex-input', 'aria-label': `Kind of document for ${e.name}`, onchange: (ev: Event) => ((d.kind = (ev.target as HTMLSelectElement).value as ImportedDoc['kind']), paintDocs()) },
      (Object.keys(KIND_LABEL) as ImportedDoc['kind'][]).map((k) => h('option', { value: k, selected: k === d.kind }, KIND_LABEL[k])));
    const time = h('input', { class: 'ex-input', type: 'number', min: '1', max: '400', inputmode: 'numeric', value: d.hints.timeMinutes ?? '', placeholder: 'none', 'aria-label': `Time limit in minutes for ${e.name}`, onchange: (ev: Event) => {
      const v = Number((ev.target as HTMLInputElement).value);
      if (v > 0) d.hints.timeMinutes = v;
      else delete d.hints.timeMinutes;
    } });
    const calc = h('select', { class: 'ex-input', 'aria-label': `Calculator rule for ${e.name}`, onchange: (ev: Event) => {
      const v = (ev.target as HTMLSelectElement).value;
      if (v === '') delete d.hints.calculator;
      else d.hints.calculator = v === 'yes';
    } }, h('option', { value: '', selected: d.hints.calculator === undefined }, 'Not stated'), h('option', { value: 'yes', selected: d.hints.calculator === true }, 'Allowed'), h('option', { value: 'no', selected: d.hints.calculator === false }, 'Not allowed'));
    const sections = h('input', { class: 'ex-input', type: 'text', value: (d.hints.sections ?? []).join('; '), placeholder: 'e.g. Part I; Part II', 'aria-label': `Sections for ${e.name}`, onchange: (ev: Event) => {
      const v = (ev.target as HTMLInputElement).value.split(/;|\n/).map((x) => x.trim()).filter(Boolean);
      if (v.length) d.hints.sections = v;
      else delete d.hints.sections;
    } });
    const key = h('textarea', { class: 'ex-input ex-key', rows: '2', placeholder: '1 B, 2 C, 3 12, …', 'aria-label': `Answer key for ${e.name}` });
    key.value = keyText(d);
    key.addEventListener('change', () => {
      const k = parseKeyText(key.value);
      for (const q of d.questions) {
        const a = k[q.number];
        if (a === undefined) continue;
        q.answer = q.type === 'mc' ? a.toUpperCase() : q.type === 'multi' ? a.toUpperCase().split(/[\s,]*/).filter(Boolean) : a;
      }
      d.warnings = d.warnings.filter((w) => !/answer key/i.test(w));
      paintDoc(e);
    });
    add(card,
      h('p', { class: 'ex-doc-found' }, h('span', { class: 'ex-doc-kind' }, KIND_LABEL[d.kind]), ...found.map((f) => h('span', { class: 'ex-chip ex-chip-static' }, f))),
      d.warnings.length ? h('ul', { class: 'ex-doc-warn' }, d.warnings.map((w) => h('li', null, w))) : null,
      h('div', { class: 'ex-doc-fix' },
        h('label', { class: 'ex-field' }, h('span', null, 'Kind'), kind),
        h('label', { class: 'ex-field' }, h('span', null, 'Time limit (min)'), time),
        h('label', { class: 'ex-field' }, h('span', null, 'Calculator'), calc),
        h('label', { class: 'ex-field ex-field-wide' }, h('span', null, 'Sections'), sections),
        d.questions.length || d.kind === 'answer-key' ? h('label', { class: 'ex-field ex-field-wide' }, h('span', null, 'Answer key'), key) : null,
      ),
      d.questions.length
        ? h('details', { class: 'ex-doc-qs' }, h('summary', null, `Questions found (${d.questions.length})`),
          h('ol', null, d.questions.slice(0, 60).map((q) => h('li', { value: String(q.number) },
            h('span', null, q.prompt.length > 140 ? `${q.prompt.slice(0, 140)}…` : q.prompt),
            q.choices?.length ? h('span', { class: 'ex-muted' }, ` · ${q.choices.length} choices`) : null,
            q.parts?.length ? h('span', { class: 'ex-muted' }, ` · parts ${q.parts.map((p) => p.label).join(', ')}`) : null,
            q.answer !== undefined ? h('span', { class: 'ex-muted' }, ` · key ${Array.isArray(q.answer) ? q.answer.join('') : q.answer}`) : null,
          ))))
        : null,
      h('details', { class: 'ex-doc-text' }, h('summary', null, 'Text that was read'), h('pre', null, d.text.slice(0, 6000))),
    );
    return card;
  }

  function paintDoc(e: DocEntry) {
    const old = list.querySelector(`[data-doc="${e.id}"]`);
    if (old) old.replaceWith(docCard(e));
  }
  function paintDocs() {
    clear(list);
    for (const e of entries) list.append(docCard(e));
    build.disabled = !entries.some((e) => e.doc) && !topics.size;
  }

  const topicChips = h('div', { class: 'ex-topic-chips', role: 'group', 'aria-label': 'Topics' }, TOPICS.map((t) => h('button', { type: 'button', class: 'ex-chip', 'aria-pressed': 'false', onclick: (ev: Event) => {
    const b = ev.currentTarget as HTMLElement;
    if (topics.has(t.id)) topics.delete(t.id);
    else topics.add(t.id);
    b.setAttribute('aria-pressed', String(topics.has(t.id)));
    build.disabled = !entries.some((x) => x.doc) && !topics.size;
  } }, t.label)));

  const formats = h('div', { class: 'ex-formats' }, FORMAT_LABELS.map((f) => h('button', { type: 'button', class: 'ex-format', 'data-family': f.family, onclick: () => goProfile(f.family) },
    h('span', { class: 'ex-format-name' }, f.label), h('span', { class: 'ex-muted' }, f.blurb))));

  function docs(): ImportedDoc[] {
    return entries.map((e) => e.doc).filter((d): d is ImportedDoc => !!d);
  }

  function goProfile(family: ExamProfile['family'] | undefined) {
    const ds = docs();
    let profile: ExamProfile;
    if (!ds.length && family) {
      profile = preset(family)!;
      if (topics.size) profile.topics = [...topics].map((t) => ({ topic: t, weight: 1 / topics.size }));
    } else profile = engine.buildProfile(ds, { ...(family ? { family } : {}), topics: [...topics] });
    openProfileReview(container, { profile, docs: ds, onBack: () => openNewExam(container, { ...o, docs: ds }), onStart: o.onStart });
  }

  fill(container,
    h('div', { class: 'ex-center-top' }, h('button', { type: 'button', class: 'ex-back', onclick: o.onBack }, '← Exam center')),
    h('header', { class: 'ex-res-head' }, h('p', { class: 'ex-kicker' }, 'New exam'), h('h1', null, 'Build a practice exam')),
    h('section', { class: 'ex-card', 'aria-labelledby': 'ex-up-h' },
      h('h2', { id: 'ex-up-h' }, 'From your own tests and notes'),
      h('p', { class: 'ex-muted' }, 'Upload old tests to copy their format, timing and style. Study guides and notes steer the topics. Optional: you can skip this and pick a format below.'),
      fileInput, drop,
      h('div', { class: 'ex-paste-row' }, paste, pasteBtn),
      list,
      h('div', { class: 'ex-topics' }, h('h3', null, 'Topics to include (optional)'), topicChips),
      h('div', { class: 'ex-actions' }, build),
    ),
    h('section', { class: 'ex-card', 'aria-labelledby': 'ex-fmt-h' },
      h('h2', { id: 'ex-fmt-h' }, 'Start from a format'),
      h('p', { class: 'ex-muted' }, 'Familiar test formats with original questions. Your uploads and topics are mixed in when present.'),
      formats,
      h('p', { class: 'ex-muted ex-tm-note' }, TRADEMARK_NOTE),
    ),
  );
  paintDocs();
}

// ---------------------------------------------------------------------------------------------------------

const countOf = sectionCount;

/** Preset ids may be typed slots ("sat-m1-03:mc:1"); extra ids copy an existing one's tail so they keep it. */
function resize(ids: string[], n: number, prefix: string): string[] {
  const src = ids.length ? ids : [`${prefix}-1`];
  return Array.from({ length: n }, (_, i) => ids[i] ?? `${prefix}-x${i + 1}~${src[i % src.length]!}`);
}

function setCount(s: Section, n: number) {
  n = Math.max(1, Math.min(120, Math.round(n) || 1));
  if (s.adaptive) {
    s.adaptive.easy = resize(s.adaptive.easy, n, `${s.id}e`);
    s.adaptive.hard = resize(s.adaptive.hard, n, `${s.id}h`);
    if (s.questionIds.length) s.questionIds = resize(s.questionIds, n, s.id);
  } else s.questionIds = resize(s.questionIds, n, s.id);
}

export function openProfileReview(container: HTMLElement, o: { profile: ExamProfile; docs: ImportedDoc[]; onBack(): void; onStart(exam: Exam): void }): void {
  container.className = 'ex-center ex-profile';
  const p = structuredClone(o.profile);
  const sectionsBox = h('div', { class: 'ex-sections' });

  const field = (label: string, control: HTMLElement, wide = false) => h('label', { class: `ex-field${wide ? ' ex-field-wide' : ''}` }, h('span', null, label), control);
  const check = (label: string, get: () => boolean, set: (v: boolean) => void) => h('label', { class: 'ex-check' }, h('input', { type: 'checkbox', checked: get(), onchange: (e: Event) => set((e.target as HTMLInputElement).checked) }), h('span', null, label));

  function paintSections() {
    clear(sectionsBox);
    sectionsBox.append(h('div', { class: 'ex-sec-row ex-sec-headrow', 'aria-hidden': 'true' }, h('span', null, 'Section'), h('span', null, 'Minutes'), h('span', null, 'Questions'), h('span', null, 'Calculator'), h('span', null, '')));
    p.sections.forEach((s, i) => {
      sectionsBox.append(h('div', { class: 'ex-sec-row', 'data-section': s.id },
        h('input', { class: 'ex-input', type: 'text', value: s.title, 'aria-label': `Section ${i + 1} title`, onchange: (e: Event) => (s.title = (e.target as HTMLInputElement).value || s.title) }),
        h('input', { class: 'ex-input', type: 'number', min: '1', max: '400', value: s.minutes ?? '', placeholder: 'untimed', 'aria-label': `Section ${i + 1} minutes`, onchange: (e: Event) => {
          const v = Number((e.target as HTMLInputElement).value);
          s.minutes = v > 0 ? v : null;
        } }),
        h('input', { class: 'ex-input', type: 'number', min: '1', max: '120', value: countOf(s), 'aria-label': `Section ${i + 1} question count`, onchange: (e: Event) => setCount(s, Number((e.target as HTMLInputElement).value)) }),
        h('label', { class: 'ex-check' }, h('input', { type: 'checkbox', checked: s.calculator, 'aria-label': `Section ${i + 1} calculator allowed`, onchange: (e: Event) => (s.calculator = (e.target as HTMLInputElement).checked) }), h('span', { class: 'ex-sec-calc-label' }, 'Allowed')),
        p.sections.length > 1 ? h('button', { type: 'button', class: 'ex-icon-btn', 'aria-label': `Remove section ${i + 1}`, onclick: () => (p.sections.splice(i, 1), paintSections()) }, icon('trash')) : h('span'),
        s.adaptive ? h('p', { class: 'ex-muted ex-small ex-sec-note' }, `Adapts to ${p.sections.find((x) => x.id === s.adaptive!.after)?.title ?? 'the previous section'}.`) : null,
      ));
    });
    sectionsBox.append(h('button', { type: 'button', class: 'ex-btn ex-btn-outline', onclick: () => {
      const id = `s${Date.now().toString(36)}`;
      p.sections.push({ id, title: `Part ${p.sections.length + 1}`, minutes: 20, calculator: true, questionIds: Array.from({ length: 10 }, (_, i) => `${id}-${i + 1}`), canReturn: p.sections[0]?.canReturn ?? true });
      paintSections();
    } }, '+ Add section'));
  }

  const scoringMin = h('input', { class: 'ex-input', type: 'number', value: p.scoring.min ?? 200, 'aria-label': 'Lowest scaled score', onchange: (e: Event) => (p.scoring.min = Number((e.target as HTMLInputElement).value)) });
  const scoringMax = h('input', { class: 'ex-input', type: 'number', value: p.scoring.max ?? 800, 'aria-label': 'Highest scaled score', onchange: (e: Event) => (p.scoring.max = Number((e.target as HTMLInputElement).value)) });
  const scaledBox = h('div', { class: 'ex-inline', hidden: p.scoring.kind !== 'scaled' }, field('Lowest', scoringMin), field('Highest', scoringMax));
  const scoring = h('select', { class: 'ex-input', 'aria-label': 'Scoring', onchange: (e: Event) => {
    const v = (e.target as HTMLSelectElement).value;
    if (v === 'letter') p.scoring = { kind: 'band', bands: [{ minPercent: 90, label: 'A' }, { minPercent: 80, label: 'B' }, { minPercent: 70, label: 'C' }, { minPercent: 60, label: 'D' }, { minPercent: 0, label: 'F' }] };
    else if (v === 'band') p.scoring = o.profile.scoring.kind === 'band' && !/^[A-F]$/.test(o.profile.scoring.bands?.[0]?.label ?? 'A') ? structuredClone(o.profile.scoring) : { kind: 'band', bands: [{ minPercent: 70, label: '5' }, { minPercent: 55, label: '4' }, { minPercent: 40, label: '3' }, { minPercent: 25, label: '2' }, { minPercent: 0, label: '1' }] };
    else if (v === 'scaled') p.scoring = { kind: 'scaled', min: Number(scoringMin.value) || 200, max: Number(scoringMax.value) || 800 };
    else p.scoring = { kind: v as 'percent' | 'points' };
    scaledBox.hidden = v !== 'scaled';
  } },
  h('option', { value: 'percent', selected: p.scoring.kind === 'percent' }, 'Percent'),
  h('option', { value: 'points', selected: p.scoring.kind === 'points' }, 'Points'),
  h('option', { value: 'letter', selected: p.scoring.kind === 'band' && /^[A-F]$/.test(p.scoring.bands?.[0]?.label ?? '') }, 'Letter grade'),
  h('option', { value: 'band', selected: p.scoring.kind === 'band' && !/^[A-F]$/.test(p.scoring.bands?.[0]?.label ?? 'A') }, 'Band (1–5 / 1–7, estimate)'),
  h('option', { value: 'scaled', selected: p.scoring.kind === 'scaled' }, 'Scaled score (estimate)'));

  const warnings = h('input', { class: 'ex-input', type: 'text', value: p.rules.warnAtMinutes.join(', '), 'aria-label': 'Time warnings (minutes left)', onchange: (e: Event) => (p.rules.warnAtMinutes = (e.target as HTMLInputElement).value.split(/[,\s]+/).map(Number).filter((n) => n > 0)) });
  const startBtn = h('button', { type: 'button', class: 'ex-btn ex-btn-primary', onclick: () => {
    startBtn.disabled = true;
    startBtn.textContent = 'Building…';
    setTimeout(() => {
      try {
        const exam = engine.buildExam(p, { docs: o.docs });
        o.onStart(exam);
      } catch (e) {
        startBtn.disabled = false;
        startBtn.textContent = 'Build exam and start';
        alertBox.textContent = `Couldn’t build the exam: ${(e as Error).message}`;
      }
    }, 10);
  } }, 'Build exam and start');
  const alertBox = h('p', { class: 'ex-res-warn', role: 'alert' });

  fill(container,
    h('div', { class: 'ex-center-top' }, h('button', { type: 'button', class: 'ex-back', onclick: o.onBack }, '← Back')),
    h('header', { class: 'ex-res-head' }, h('p', { class: 'ex-kicker' }, 'Review'), h('h1', null, 'What your exam will match')),
    h('section', { class: 'ex-card', 'aria-labelledby': 'ex-obs-h' },
      h('h2', { id: 'ex-obs-h' }, 'What Lemma noticed'),
      h('ul', { class: 'ex-obs' }, p.observations.map((x) => h('li', null, x))),
      p.topics.length ? h('p', { class: 'ex-topic-weights' }, p.topics.slice(0, 8).map((t) => h('span', { class: 'ex-chip ex-chip-static' }, `${topicLabel(t.topic)} ${Math.round(t.weight * 100)}%`))) : null,
    ),
    h('section', { class: 'ex-card', 'aria-labelledby': 'ex-set-h' },
      h('h2', { id: 'ex-set-h' }, 'Exam settings'),
      h('div', { class: 'ex-form' },
        field('Name', h('input', { class: 'ex-input', type: 'text', value: p.name, onchange: (e: Event) => (p.name = (e.target as HTMLInputElement).value || p.name) }), true),
        field('Room', h('select', { class: 'ex-input', onchange: (e: Event) => (p.room = (e.target as HTMLSelectElement).value as Room) }, (Object.keys(ROOM_LABEL) as Room[]).map((r) => h('option', { value: r, selected: r === p.room }, ROOM_LABEL[r]))), true),
      ),
      h('h3', null, 'Sections'),
      sectionsBox,
      h('h3', null, 'Tools'),
      h('div', { class: 'ex-form' },
        field('Calculator', h('select', { class: 'ex-input', onchange: (e: Event) => (p.tools.calculator = (e.target as HTMLSelectElement).value as ExamProfile['tools']['calculator']) }, (['none', 'basic', 'scientific', 'graphing'] as const).map((c) => h('option', { value: c, selected: c === p.tools.calculator }, c === 'none' ? 'None' : c[0]!.toUpperCase() + c.slice(1))))),
      ),
      h('div', { class: 'ex-checks' },
        check('Reference sheet', () => !!p.tools.referenceSheet, (v) => (v ? (p.tools.referenceSheet = 'math-reference') : delete p.tools.referenceSheet)),
        check('Highlighter and notes', () => p.tools.highlighter, (v) => (p.tools.highlighter = v)),
        check('Cross out answer choices', () => p.tools.eliminator, (v) => (p.tools.eliminator = v)),
        check('Mark for review', () => p.tools.markForReview, (v) => (p.tools.markForReview = v)),
        check('Show-work space', () => p.tools.scratch, (v) => (p.tools.scratch = v)),
      ),
      h('h3', null, 'Rules'),
      h('div', { class: 'ex-checks' },
        check('Full screen', () => p.rules.fullscreen, (v) => (p.rules.fullscreen = v)),
        check('Allow pausing', () => p.rules.allowPause, (v) => (p.rules.allowPause = v)),
      ),
      h('div', { class: 'ex-form' },
        field('Timer', h('select', { class: 'ex-input', onchange: (e: Event) => (p.rules.showTimer = (e.target as HTMLSelectElement).value as ExamProfile['rules']['showTimer']) },
          h('option', { value: 'toggle', selected: p.rules.showTimer === 'toggle' }, 'Shown, can hide'),
          h('option', { value: 'always', selected: p.rules.showTimer === 'always' }, 'Always shown'),
          h('option', { value: 'last5', selected: p.rules.showTimer === 'last5' }, 'Hidden until the last 5 minutes'))),
        field('Warnings (minutes left)', warnings),
      ),
      h('h3', null, 'Scoring'),
      h('div', { class: 'ex-form' }, field('Score as', scoring), scaledBox),
    ),
    alertBox,
    h('div', { class: 'ex-actions ex-actions-end' }, startBtn),
  );
  paintSections();
}
