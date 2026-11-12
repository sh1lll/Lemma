import { STYLES, explain, type StyleId } from '@lemma/tutor-engine';
import { createScriptPlayer, type ScriptPlayer } from '../../../web/src/lesson/script-player';
import { SESSION_KEYS, type PendingCapture, type PendingQuestion } from '../core/messages';
import { loadSettings, type Settings } from '../core/settings';
import { solve, type Action, type Solution } from '../core/solve';
import { mountCalculator } from '../ui/calculator';
import { $, h } from '../ui/dom';
import { recognize } from '../ui/ocr';
import { renderSteps } from '../ui/steps';
import { initTheme } from '../ui/theme';

let settings: Settings = await initTheme();
chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'sync') void loadSettings().then((s) => (settings = s));
});

// Lets the background know the panel is open (so a screen capture lands here instead of a new tab).
chrome.runtime.connect({ name: 'panel' });

const question = $('#question') as HTMLInputElement;
const stepsOut = $('#steps-out');
const lessonControls = $('#lesson-controls');
const lessonBox = $('#lesson');
const styleSel = $('#style') as HTMLSelectElement;
const calcSteps = $('#calc-steps');

for (const s of STYLES) styleSel.append(h('option', { value: s.id, title: s.blurb }, s.label));
styleSel.value = settings.tutorStyle;

let player: ScriptPlayer | null = null;
let current: Solution | null = null;

function stopLesson() {
  player?.destroy();
  player = null;
  lessonBox.replaceChildren();
}

async function ask(q: string, action: Action = 'solve') {
  question.value = q;
  stopLesson();
  stepsOut.replaceChildren(h('p', { class: 'muted', role: 'status' }, 'Working…'));
  const s = await solve(action === 'calculate' || action === 'average' ? 'solve' : action, q);
  current = s;
  renderSteps(stepsOut, s, settings.mode);
  lessonControls.hidden = !(s.ok && s.steps.length);
}

$('#ask').addEventListener('submit', (e) => {
  e.preventDefault();
  if (question.value.trim()) void ask(question.value.trim());
});

$('#watch').addEventListener('click', () => {
  if (!current) return;
  const script = explain(current.query, styleSel.value as StyleId);
  stopLesson();
  if (!script) {
    lessonBox.append(h('p', { class: 'notice' }, 'There is no lesson for this question yet.'));
    return;
  }
  player = createScriptPlayer(lessonBox, script, { autoplay: true });
});

let calcQuery = '';
mountCalculator($('#calc'), {
  onSolution: (s) => {
    calcQuery = s?.query ?? '';
    calcSteps.hidden = !(s?.ok && s.steps.length);
  },
});
calcSteps.addEventListener('click', () => void ask(calcQuery));

$('#options').addEventListener('click', () => void chrome.runtime.openOptionsPage());
// Opened as a tab (Safari, or a capture with no panel open): "the active tab" would be this page, so capture
// is started from the toolbar popup or Alt+Shift+S on the page instead.
void chrome.tabs.getCurrent().then((t) => {
  if (t) $('#screen').hidden = true;
});
$('#screen').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  showCapture('Drag over the problem on the page. Press Esc to cancel.');
  try {
    await chrome.runtime.sendMessage({ type: 'lemma:start-region', tabId: tab?.id });
  } catch (e) {
    showCapture(e instanceof Error ? e.message : 'This page cannot be captured.');
  }
});

// ---------- screen capture → OCR → editable text

const capture = $('#capture');
const capStatus = $('#capture-status');
const capImg = $('#capture-img') as HTMLImageElement;
const capEdit = $('#capture-edit');
const ocrText = $('#ocr-text') as HTMLTextAreaElement;

function showCapture(status: string) {
  capture.hidden = false;
  capStatus.textContent = status;
}

let lastCapture = 0;
async function handleCapture(c: PendingCapture) {
  if (c.at <= lastCapture) return;
  lastCapture = c.at;
  showCapture('Reading the text on this device…');
  capImg.src = c.dataUrl;
  capImg.hidden = false;
  capEdit.hidden = true;
  try {
    const text = await recognize(c.dataUrl, (status, p) => {
      const label = status.replace(/^recognizing text$/, 'Reading text').replace(/^loading (.*)$/, 'Loading $1').replace(/^initializ\w+ (.*)$/, 'Starting $1');
      capStatus.textContent = `${label[0]?.toUpperCase() ?? ''}${label.slice(1)}… ${Math.round(p * 100)}%`;
    });
    ocrText.value = text;
    capEdit.hidden = false;
    capStatus.textContent = text ? 'Done. Nothing has been solved yet: check the text first.' : 'No text found. Type the problem instead.';
    ocrText.focus();
  } catch (e) {
    capEdit.hidden = false;
    capStatus.textContent = `Could not read the image (${e instanceof Error ? e.message : String(e)}). You can type the problem instead.`;
  }
  await chrome.storage.session?.remove(SESSION_KEYS.capture);
}

$('#ocr-solve').addEventListener('click', () => {
  const lines = ocrText.value.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines[0]) void ask(lines[0]);
});
$('#ocr-close').addEventListener('click', () => {
  capture.hidden = true;
  capImg.hidden = true;
});

// ---------- hand-offs from the bubble, the popup and the background

let lastPending = 0;
async function checkSession() {
  const area = chrome.storage.session;
  if (!area) return;
  const got = await area.get([SESSION_KEYS.pending, SESSION_KEYS.capture, SESSION_KEYS.waiting]);
  const p = got[SESSION_KEYS.pending] as PendingQuestion | undefined;
  if (p && p.at > lastPending) {
    lastPending = p.at;
    await area.remove(SESSION_KEYS.pending);
    void ask(p.query, p.action);
  }
  if (got[SESSION_KEYS.waiting]) showCapture('Drag over the problem on the page. Press Esc to cancel.');
  else if (!got[SESSION_KEYS.capture] && capImg.hidden && capStatus.textContent?.startsWith('Drag')) capture.hidden = true;
  const c = got[SESSION_KEYS.capture] as PendingCapture | undefined;
  if (c) void handleCapture(c);
}
chrome.storage.onChanged.addListener((_c, area) => {
  if (area === 'session') void checkSession();
});
void checkSession();

// Test hook (Playwright drives the panel as a page).
Object.assign(globalThis, { lemmaPanel: { ask, handleCapture } });
