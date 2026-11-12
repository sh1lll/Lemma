/**
 * The Study menu: a list of tools, each opening in one sheet. Tools load on demand, so none of this costs the
 * calculator anything until it's used.
 */
import { canTransition, skeleton, viewTransition } from './motion';

export type ToolId = 'agenda' | 'extension' | 'exam' | 'whiteboard' | 'notes' | 'notebooks' | 'practice' | 'test' | 'lecture' | 'videos' | 'video' | 'extensions' | 'geometry' | 'physics';
export interface LessonScript {
  title: string;
  question: string;
  questionTex?: string;
  steps: { text: string; tex?: string }[];
  answer: { display: string; tex?: string };
}
export interface ToolContext {
  query?: string;
  result?: string;
  /** A ready-made lesson (e.g. from a practice question) for Create video. */
  lesson?: LessonScript;
  /** Lecture topic for the lesson maker ("the chain rule"). */
  lecture?: string;
  /** Teaching style for the lesson maker. */
  style?: import('@lemma/tutor-engine').StyleId;
}
export interface NoteDraft {
  text: string;
  tags: string[];
  saved?: { question: string; result: string; steps?: { text: string; tex?: string }[] };
}
export interface StudyHost {
  notesRoot: HTMLElement;
  /** False when the note couldn't be stored (storage full); the host has told the user. */
  addNote: (n: NoteDraft) => boolean;
  openNotebook: () => void;
  openExtensions: () => void;
  openWhiteboard: () => void;
  openExam: () => void;
  toast: (msg: string) => void;
}

interface ToolDef {
  id: ToolId;
  label: string;
  hint: string;
  tint: string;
  icon: string;
  group: GroupId;
  /** Other words people search with. */
  words: string;
}

type GroupId = 'make' | 'practice' | 'learn' | 'mine' | 'more';
const GROUPS: { id: GroupId; label: string }[] = [
  { id: 'make', label: 'Draw and explore' },
  { id: 'practice', label: 'Practice and exams' },
  { id: 'learn', label: 'Learn' },
  { id: 'mine', label: 'Your work' },
  { id: 'more', label: 'Add-ons' },
];

const TOOLS: ToolDef[] = [
  { id: 'agenda', label: 'Study agenda', hint: 'Due today, what to review, how you’re doing', tint: 'sage', icon: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 9h16M8 3v4M16 3v4M8 13l2 2 4-4"/>', group: 'practice', words: 'plan schedule calendar progress' },
  { id: 'exam', label: 'Exam simulator', hint: 'A timed exam in the format of your old tests', tint: 'rose', icon: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h4"/><circle cx="17" cy="17" r="3.5"/><path d="M17 15.5V17l1 .8"/>', group: 'practice', words: 'test simulator mock timed' },
  { id: 'whiteboard', label: 'Whiteboard', hint: 'Draw, or say what to put on it', tint: 'teal', icon: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21l4-4 4 4M7 12c1.5-2 3-2 4 0s2.5 2 4 0"/>', group: 'make', words: 'draw sketch canvas scratch board' },
  { id: 'geometry', label: 'Geometry', hint: 'Drag a point, the figure follows', tint: 'sky', icon: '<circle cx="12" cy="12" r="7"/><path d="M5 17L19 7M12 12h.01"/><circle cx="5" cy="17" r="1.5"/><circle cx="19" cy="7" r="1.5"/>', group: 'make', words: 'shapes construct triangle circle compass' },
  { id: 'physics', label: 'Physics lab', hint: 'Launch, swing and bounce things', tint: 'sand', icon: '<path d="M12 3v9"/><circle cx="12" cy="15" r="3"/><path d="M4 21c3-4 5-6 8-6s5 2 8 6"/>', group: 'make', words: 'simulate simulation lab motion force' },
  { id: 'practice', label: 'Practice', hint: 'One question at a time, with hints', tint: 'violet', icon: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14M12 17h.01"/>', group: 'practice', words: 'quiz drill questions' },
  { id: 'test', label: 'Practice tests', hint: 'A short test, scored by topic', tint: 'plum', icon: '<path d="M7 3h10v18H7z"/><path d="M10 8h4M10 12h4M10 16h2"/>', group: 'practice', words: 'quiz exam score' },
  { id: 'lecture', label: 'Lecture summarizer', hint: 'Key points and formulas from a recording', tint: 'rose', icon: '<path d="M4 12v0M7 9v6M10 6v12M13 9v6M16 7v10M19 11v2"/>', group: 'learn', words: 'audio record summary class' },
  { id: 'videos', label: 'Video lessons', hint: 'A lesson on any question or topic', tint: 'sky', icon: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 6l2 4M12 6l2 4M17 6l2 4"/>', group: 'learn', words: 'video lesson explain teach chalkboard' },
  { id: 'notes', label: 'Notes', hint: 'Formulas and answers you saved', tint: 'sand', icon: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h5"/>', group: 'mine', words: 'saved formulas' },
  { id: 'notebooks', label: 'Notebooks', hint: 'Longer work with live cells', tint: 'sage', icon: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v18M12 8h4M12 12h4"/>', group: 'mine', words: 'notebook cells document' },
  { id: 'extension', label: 'Add to browser', hint: 'Calculate and solve on any web page', tint: 'sky', icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01M12 13v4M10 15h4"/>', group: 'more', words: 'chrome browser extension' },
  { id: 'extensions', label: 'Extensions', hint: 'Add or build your own calculators', tint: 'slate', icon: '<path d="M9 4h6v4a2 2 0 1 0 0 4v4H9v-4a2 2 0 1 1 0-4z"/>', group: 'more', words: 'plugins add-ons custom' },
];

const TITLES: Record<ToolId, string> = { agenda: 'Study agenda', extension: 'Add to browser', exam: 'Exam simulator', whiteboard: 'Whiteboard', practice: 'Practice', test: 'Practice test', lecture: 'Lecture summarizer', videos: 'Video lessons', video: 'Video lesson', notes: 'Notes', notebooks: 'Notebooks', extensions: 'Extensions', geometry: 'Geometry', physics: 'Physics lab' };

let host: StudyHost | null = null;
let cleanup: (() => void) | void = undefined;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function svg(path: string): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = path;
  return s;
}

export function setHost(h: StudyHost): void {
  host = h;
}

const RECENT_KEY = 'lemma.recentTools';
function recentTools(): ToolId[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((id) => TOOLS.some((t) => t.id === id)).slice(0, 3) : [];
  } catch {
    return [];
  }
}
function rememberTool(id: ToolId): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recentTools().filter((t) => t !== id)].slice(0, 3)));
  } catch {
    /* private mode: nothing to remember */
  }
}

function toolButton(t: ToolDef, cls: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  // Pointing at (or tabbing to, or touching) a tool loads its code, so it opens instantly when chosen.
  const warm = () => void import('./preload').then((m) => m.prefetchTool(t.id));
  b.addEventListener('pointerenter', warm, { once: true });
  b.addEventListener('focus', warm, { once: true });
  b.addEventListener('touchstart', warm, { once: true, passive: true });
  const tile = document.createElement('span');
  tile.className = `tool-tile tint-${t.tint}`;
  tile.append(svg(t.icon));
  b.addEventListener('click', () => openTool(t.id, {}, b));
  b.append(tile);
  return b;
}

function toolRow(t: ToolDef, big: boolean): HTMLButtonElement {
  const b = toolButton(t, big ? 'tool-row big' : 'tool-row');
  b.dataset.tool = t.id;
  b.dataset.find = `${t.label} ${t.hint} ${t.words}`.toLowerCase();
  const text = document.createElement('span');
  text.className = 'tool-text';
  const name = document.createElement('span');
  name.className = 'tool-name';
  name.textContent = t.label;
  const hint = document.createElement('span');
  hint.className = 'tool-hint';
  hint.textContent = t.hint;
  text.append(name, hint);
  b.append(text);
  if (!big) b.append(svg('<path d="M9 5l7 7-7 7"/>'));
  return b;
}

export function openStudy(h: StudyHost, opts: { search?: boolean } = {}): void {
  host = h;
  const list = $('tool-list');
  const recent = recentTools();
  const parts: HTMLElement[] = [];
  if (recent.length) {
    const sec = document.createElement('section');
    sec.className = 'tool-recent';
    sec.dataset.group = 'recent';
    const head = document.createElement('h3');
    head.textContent = 'Recent';
    const row = document.createElement('div');
    row.className = 'tool-chips';
    for (const id of recent) {
      const t = TOOLS.find((x) => x.id === id)!;
      const b = toolButton(t, 'tool-chip-recent');
      b.dataset.recent = t.id;
      b.append(t.label);
      row.append(b);
    }
    sec.append(head, row);
    parts.push(sec);
  }
  for (const g of GROUPS) {
    const sec = document.createElement('section');
    sec.className = `tool-group group-${g.id}`;
    sec.dataset.group = g.id;
    const head = document.createElement('h3');
    head.textContent = g.label;
    const items = document.createElement('div');
    items.className = 'tool-items';
    items.append(...TOOLS.filter((t) => t.group === g.id).map((t) => toolRow(t, g.id === 'make')));
    sec.append(head, items);
    parts.push(sec);
  }
  const empty = document.createElement('p');
  empty.className = 'tool-empty';
  empty.hidden = true;
  parts.push(empty);
  list.replaceChildren(...parts);

  const search = $<HTMLInputElement>('tool-search');
  search.value = '';
  search.oninput = () => {
    const q = search.value.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const sec of list.querySelectorAll<HTMLElement>('section')) {
      if (sec.dataset.group === 'recent') {
        sec.hidden = !!q;
        continue;
      }
      let any = false;
      for (const row of sec.querySelectorAll<HTMLElement>('.tool-row')) {
        const hit = words.every((w) => row.dataset.find!.includes(w));
        row.hidden = !hit;
        if (hit) any = true, shown++;
      }
      sec.hidden = !any;
    }
    empty.hidden = shown > 0;
    empty.textContent = shown ? '' : `No tool called “${search.value.trim()}”. Press Enter to ask it in the calculator instead.`;
  };
  search.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    // Nothing typed: Enter has nothing to choose.
    if (!search.value.trim()) return;
    const first = list.querySelector<HTMLElement>('.tool-row:not([hidden])');
    if (first && !first.closest('[hidden]')) return first.click();
    const q = search.value.trim();
    if (!q) return;
    $<HTMLDialogElement>('study').close();
    const input = $<HTMLInputElement>('input');
    input.value = q;
    input.form?.requestSubmit();
  };
  // During its exit animation the drawer is still open: showModal keeps it.
  $<HTMLDialogElement>('study').showModal();
  if (opts.search || matchMedia('(pointer: fine)').matches) search.focus();
}

/** The tool sheet grows out of the row that was chosen (a view transition), replacing the drawer. */
function expandFrom(row: HTMLElement, sheet: HTMLDialogElement, study: HTMLDialogElement): Promise<void> {
  const box = sheet.querySelector<HTMLElement>('.sheet')!;
  row.style.viewTransitionName = 'tool-open';
  sheet.dataset.vt = '';
  return viewTransition(
    () => {
      row.style.viewTransitionName = '';
      box.style.viewTransitionName = 'tool-open';
      HTMLDialogElement.prototype.close.call(study); // no exit of its own: the row becomes the sheet
      sheet.showModal();
    },
    'panels',
    () => {
      box.style.viewTransitionName = '';
      // Keep the marker until the sheet closes: removing it now would start the sheet's ordinary pop-in a second
      // time, moving everything under the pointer just as the tool is being used.
      sheet.addEventListener('close', () => delete sheet.dataset.vt, { once: true });
    },
  );
}

/** Opens one tool in the tool sheet. `ctx.query` is the answer the user came from, if any; `from`, the Study row. */
export async function openTool(id: ToolId, ctx: ToolContext = {}, from?: HTMLElement): Promise<void> {
  const study = $<HTMLDialogElement>('study');
  if (TOOLS.some((t) => t.id === id)) rememberTool(id);
  if (id === 'notebooks') {
    study.close();
    return host?.openNotebook();
  }
  if (id === 'extensions') {
    study.close();
    return host?.openExtensions();
  }
  if (id === 'whiteboard') {
    study.close();
    return host?.openWhiteboard();
  }
  if (id === 'exam') {
    study.close();
    return host?.openExam();
  }
  const sheet = $<HTMLDialogElement>('tool');
  const body = $('tool-body');
  if (typeof cleanup === 'function') cleanup();
  cleanup = undefined;
  body.replaceChildren();
  body.dataset.tool = id;
  $('tool-title').textContent = TITLES[id];
  // Back leads to the Tools menu only when that's where the tool was opened from (directly or via another tool).
  $('tool-back').hidden = !(study.open || (sheet.open && !$('tool-back').hidden));
  if (from && study.open && !sheet.open && canTransition('panels')) await expandFrom(from, sheet, study);
  else {
    if (study.open) study.close();
    sheet.showModal();
  }

  const toast = host?.toast ?? (() => undefined);
  // A placeholder while the tool's code arrives the first time (it fades in only if that takes a moment).
  const wait = skeleton();
  body.append(wait);
  const mine = ++opening;
  try {
    // Fetch the tool's code first; if another tool was opened (or the sheet shut) meanwhile, this one stops here
    // instead of mounting into the other tool's sheet.
    await TOOL_CODE[id]?.();
    if (mine !== opening || !sheet.open) return;
    if (id === 'notes') {
      const root = host?.notesRoot;
      body.append(noteComposer());
      if (root) {
        const has = root.childElementCount > 0;
        root.hidden = !has;
        body.append(root);
        if (!has) body.append(empty('No notes yet. Write one above, say “note: …”, or tap Save note under any answer.'));
      }
    } else if (id === 'agenda') {
      const { mountAgenda } = await import('./agenda');
      cleanup = mountAgenda(body, {
        toast,
        openPractice: (topic) => void openTool('practice', topic ? { query: topic } : {}),
        openExam: () => {
          $<HTMLDialogElement>('tool').close();
          host?.openExam();
        },
        openLesson: (topic) => void openTool('video', { lecture: topic }),
      });
    } else if (id === 'extension') {
      const { renderInstall, detectBrowser } = await import('./extension-install');
      const intro = document.createElement('div');
      intro.className = 'card';
      intro.innerHTML =
        '<h3>Lemma in your browser</h3><ul class="ext-features"><li>Select math on any page, right-click, and get the answer right there</li><li>Step-by-step solutions and lessons in your teaching style</li><li>Solve what’s on the screen: drag over a problem to read it</li><li>Fill in an answer field you choose, one at a time (it never submits anything)</li></ul><p class="fine">It only reads a page when you ask it to, and everything is worked out on your device.</p>';
      const install = document.createElement('div');
      install.className = 'ext-install';
      install.setAttribute('aria-live', 'polite');
      body.append(intro, install);
      renderInstall(install, { toast, detected: detectBrowser() });
    } else if (id === 'practice') {
      cleanup = (await import('./study/practice')).mountPractice(body, ctx, { toast, openTool });
    } else if (id === 'test') {
      cleanup = (await import('./study/test')).mountTest(body, ctx, { toast, openTool });
    } else if (id === 'lecture') {
      cleanup = (await import('./study/lecture')).mountLecture(body, ctx, { toast, addNote: (n) => host?.addNote(n) ?? false });
    } else if (id === 'geometry') {
      cleanup = (await import('./geometry/geometry')).mountGeometry(body, { toast });
    } else if (id === 'physics') {
      cleanup = (await import('./physics/lab')).mountPhysics(body, ctx, { toast });
    } else if (id === 'videos' || id === 'video') {
      cleanup = (await import('./study/videos')).mountVideos(body, id === 'video' ? ctx : {}, { toast });
    }
  } catch (e) {
    body.append(empty(`Couldn’t open this tool: ${e instanceof Error ? e.message : String(e)}`));
  } finally {
    wait.remove();
  }
}

/** The newest openTool call; an older one still loading gives way to it. */
let opening = 0;
const TOOL_CODE: Partial<Record<ToolId, () => Promise<unknown>>> = {
  agenda: () => import('./agenda'),
  extension: () => import('./extension-install'),
  practice: () => import('./study/practice'),
  test: () => import('./study/test'),
  lecture: () => import('./study/lecture'),
  geometry: () => import('./geometry/geometry'),
  physics: () => import('./physics/lab'),
  videos: () => import('./study/videos'),
  video: () => import('./study/videos'),
};

/** Write a note right here. Math in it is typeset; #words become tags. */
function noteComposer(): HTMLElement {
  const form = document.createElement('form');
  form.className = 'answer-field note-composer';
  const input = document.createElement('input');
  input.placeholder = 'Write a note, e.g. chain rule is f\'(g(x))·g\'(x) #calc';
  input.setAttribute('aria-label', 'New note');
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'btn primary';
  save.textContent = 'Save';
  form.append(input, save);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = input.value.trim();
    if (!raw) return input.focus();
    const tags = [...raw.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)].map((m) => m[1]!.toLowerCase());
    const text = raw.replace(/(?:^|\s)#[\p{L}\p{N}_-]+/gu, ' ').replace(/\s+/g, ' ').trim();
    host?.addNote({ text, tags });
    input.value = '';
    // The list is rebuilt; the cursor stays in the box for the next note.
    void openTool('notes').then(() => document.querySelector<HTMLInputElement>('#tool-body .note-composer input')?.focus());
  });
  return form;
}

function empty(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = text;
  return p;
}

function closeTool() {
  if (typeof cleanup === 'function') cleanup();
  cleanup = undefined;
  $<HTMLDialogElement>('tool').close();
}

$('tool-close').addEventListener('click', closeTool);
$('tool-back').addEventListener('click', () => {
  closeTool();
  if (host) openStudy(host);
});
$<HTMLDialogElement>('tool').addEventListener('close', () => {
  if (typeof cleanup === 'function') cleanup();
  cleanup = undefined;
});
