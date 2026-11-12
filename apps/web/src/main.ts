// First: data saved before the rename is moved to its new names before anything reads it.
import './legacy';
import './style.css';
import { commit as commitCalc, createSession, D, defineFromSource, formatNumber, splitChain, type Answer } from '@lemma/math-core';
import { loadAdvanced, loadEveryday, loadUnits, route, runtime, symbolicClient, unitLabel, type Outcome, type RouteOptions } from './engine';
import { lastWarmed, loadEverything, LOOKS_SYMBOLIC, STEPS, type StepId, type StepState, type WarmHost } from './preload';
import type { GraphView } from './graph/view';
import type { Assistant } from './assistant/controller';
import type { NotebookView } from './notebook/view';
import { StudyNotes } from './notes';
import { applyLook, LOOKS, LOOK_OPTIONS, swatch, watchSystemTheme, type LookId } from './look';
import type { ToolId } from './study';
import { reloadCustom, withCustomValues } from './symbols/store';
import { animateDialog, confirmPop, D1, D2, D3, fold, glide, leave, moves, play, snapshot, viewTransition } from './motion';

// Created at boot (after timers exist); used by the action dispatcher.
let notes: StudyNotes;
/** Notes render here; the Notes tool moves it into its sheet. */
const notesRoot = document.createElement('section');
notesRoot.className = 'notes';
import { clock, type RatesSnapshot } from '@lemma/runtime';
import { BrowserSynth, WebSpeechRecognizer, type SpeechRecognizer } from './speech';
import { WhisperRecognizer } from './whisper/recognizer';
import { patienceMs, PhraseGate } from './patience';
import {
  loadAiKey,
  loadFormulas,
  loadHistory,
  loadRates,
  loadSettings,
  loadTimers,
  loadVars,
  saveFormulas,
  saveHistory,
  saveRates,
  saveSettings,
  saveTimers,
  saveVars,
  type HistoryEntry,
  type Settings,
  type StoredTimer,
} from './storage';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const el = {
  input: $<HTMLInputElement>('input'),
  form: $<HTMLFormElement>('ask'),
  mic: $<HTMLButtonElement>('mic'),
  expr: $('expr'),
  value: $('value'),
  lines: $('lines'),
  detail: $('detail'),
  timers: $('timers'),
  pinned: $<HTMLOListElement>('pinned'),
  pinnedSection: $('pinned-section'),
  formulas: $('formulas'),
  meta: $('meta'),
  alts: $('alts'),
  copy: $<HTMLButtonElement>('copy'),
  result: document.querySelector<HTMLElement>('.result')!,
  graphSlot: $('graph-slot'),
  modes: $('modes'),
  openSymbols: $<HTMLButtonElement>('open-symbols'),
  angle: $<HTMLButtonElement>('angle'),
  history: $<HTMLOListElement>('history'),
  examples: $('examples'),
  clearHistory: $<HTMLButtonElement>('clear-history'),
  keypad: $('keypad'),
  toggleKeypad: $<HTMLButtonElement>('toggle-keypad'),
  settings: $<HTMLDialogElement>('settings'),
  openSettings: $<HTMLButtonElement>('open-settings'),
  voiceNote: $('voice-note'),
  toast: $('toast'),
  attach: $<HTMLButtonElement>('attach'),
  assistantToggle: $<HTMLButtonElement>('assistant-toggle'),
  imageFile: $<HTMLInputElement>('image-file'),
  convo: $('convo'),
  convoLog: $('convo-log'),
  convoClear: $<HTMLButtonElement>('convo-clear'),
  loop: $<HTMLButtonElement>('loop'),
  tape: $('tape'),
  tapeSteps: $<HTMLOListElement>('tape-steps'),
  tapeStatus: $('tape-status'),
  tapeClear: $<HTMLButtonElement>('tape-clear'),
  openStudy: $<HTMLButtonElement>('open-study'),
};

// ---------- state ----------
const settings: Settings = loadSettings();
let history: HistoryEntry[] = settings.keepHistory ? loadHistory() : [];
const session = createSession();
session.angle = settings.angle;
for (const [k, v] of Object.entries(loadVars())) {
  try {
    session.vars.set(k, new D(v));
  } catch {
    // Ignore corrupted stored values.
  }
}
try {
  if (history[0]) session.ans = new D(history[0].plain);
} catch {
  // A malformed stored entry (e.g. a date) just means no previous answer.
}
for (const src of loadFormulas()) defineFromSource(session, src);

// ---------- exchange rates ----------
let rates: RatesSnapshot | null = loadRates<RatesSnapshot>();
let ratesFetch: Promise<RatesSnapshot> | null = null;
const RATES_REFRESH_MS = 6 * 3600_000;

function requestRates(): Promise<RatesSnapshot> {
  ratesFetch ??= import('@lemma/currency-engine')
    .then((e) => e.fetchRates())
    .then((r) => {
      rates = r;
      saveRates(r);
      return r;
    })
    .catch((err) => {
      if (rates) return rates; // Keep using cached rates; the answer marks them stale by date.
      throw new Error(navigator.onLine ? `Couldn't load exchange rates (${err instanceof Error ? err.message : err})` : 'Exchange rates need one connection first; you appear to be offline');
    })
    .finally(() => (ratesFetch = null));
  return ratesFetch;
}

interface DesktopBridge {
  isOverlay: boolean;
  platform: string;
  hideOverlay(): void;
  resizeOverlay(height: number): void;
  openMain(): void;
  onOverlayShown(cb: (d: { listen: boolean }) => void): () => void;
  sync?: import('./sync-ui').SyncBridge;
  /** First launch only: the shortcuts as written on this system (then false forever). */
  firstRun?: () => Promise<false | { overlay: string; listen: string; openAtLogin: boolean }>;
  openAtLogin?: () => Promise<boolean>;
}
/** Present only inside the desktop shell (apps/desktop). */
const desktop = (window as unknown as { lemmaDesktop?: DesktopBridge }).lemmaDesktop;
const overlayMode = !!desktop?.isOverlay;

const webSpeech = new WebSpeechRecognizer();
const whisper = new WhisperRecognizer();
/** Electron exposes webkitSpeechRecognition but it cannot reach Google's service, so the desktop app always uses Whisper. */
function recognizerFor(): SpeechRecognizer {
  if (settings.voiceEngine === 'whisper' || desktop) return whisper;
  if (settings.voiceEngine === 'browser') return webSpeech;
  return webSpeech.supported ? webSpeech : whisper;
}
const synth = new BrowserSynth();
let listening = false;
let wantListening = false;
let lastCommitted: { outcome: Outcome; ms: number; expr: string; input?: string } | null = null;
let recallIndex = -1;

const routeOptions = (): RouteOptions => ({
  format: { digits: settings.digits, grouping: settings.grouping },
  currency: settings.currency,
  liveRates: settings.liveRates,
  rates: () => {
    // Refresh quietly in the background when the cached rates are old; this answer uses what we have.
    if (rates && settings.liveRates && Date.now() - rates.fetchedAt > RATES_REFRESH_MS && !ratesFetch) void requestRates().catch(() => {});
    return rates;
  },
  requestRates,
});

// ---------- rendering ----------
function clear(node: HTMLElement) {
  node.replaceChildren();
}

function tag(text: string, cls = '') {
  const s = document.createElement('span');
  s.className = `tag ${cls}`.trim();
  s.textContent = text;
  return s;
}

function note(text: string) {
  const s = document.createElement('span');
  // Which engine did the work is fine print, shown with "Extra details".
  if (/^Computed by /.test(text)) s.className = 'note';
  s.textContent = text;
  return s;
}

type Mode = 'committed' | 'preview';

let previewErrorTimer = 0;
/** "Start over" zeroed the display: an empty input shows 0, not the last history entry, until the next result. */
let screenCleared = false;
/** Inputs whose commit (Enter) is waiting on a lazy engine, so a second Enter doesn't commit them twice. */
const pendingCommits = new Set<string>();
/** Bumped by every new answer or preview, so extras still loading for an older answer drop out. */
let solveGen = 0;
let lastSolve: { input: string; outcome: Outcome } | null = null;

/** "ans − 5" reads as "60 − 5": the previous result in place of the internal name (before this result is committed). */
function readable(expression: string): string {
  const show = (v: typeof session.ans) => (v ? formatNumber(v, { digits: settings.digits, grouping: settings.grouping }).display : null);
  const ans = show(session.ans);
  const base = show(session.base);
  return expression.replace(/\bans\b/g, (m) => ans ?? m).replace(/\bbase\b/g, (m) => base ?? m);
}

/**
 * While typing, a half-typed input or a graph request leaves the screen as it is, faded: the result area never
 * flips between a graph and a number from one keystroke to the next. A graph is drawn only on Enter (an explicit
 * "graph …" / "plot …"), in its own slot, and stays there until the next commit.
 */
function renderQuiet(outcome: Extract<Outcome, { kind: 'graph' | 'error' }>) {
  clearTimeout(previewErrorTimer);
  el.value.classList.add('quiet');
  el.result.classList.add('stale');
  clear(el.alts);
  clear(el.meta);
  if (outcome.kind === 'graph') {
    el.meta.append(note(matchMedia('(pointer: coarse)').matches ? 'Press go to draw the graph' : 'Press Enter to draw the graph'));
    return;
  }
  // Half-typed words ("graph ", "deriv") look like unknown names: say nothing about them while typing.
  // Other problems appear only once typing pauses, so the screen doesn't flicker with errors.
  const code = outcome.error.code;
  // Only while the word is still being typed ("graph ", "deriv"): "foo + 2" gets its message after the pause.
  const typingWord = /[a-z]{2,}/i.test(el.input.value) && /[a-z_]\w*\s*$/i.test(el.input.value);
  if (code === 'incomplete' || code === 'empty' || (code === 'unknown-name' && typingWord)) return;
  const message = outcome.error.message;
  const typed = el.input.value;
  previewErrorTimer = window.setTimeout(() => {
    if (el.input.value === typed && el.value.classList.contains('quiet')) el.meta.replaceChildren(note(message));
  }, 900);
}

function render(outcome: Outcome, mode: Mode, ms?: number) {
  if (mode === 'preview') solveGen++; // extras still loading for the last answer stop here
  if (mode === 'preview' && (outcome.kind === 'graph' || outcome.kind === 'error')) return renderQuiet(outcome);
  clearTimeout(previewErrorTimer);
  lastCalc = null;
  el.result.classList.remove('stale');
  el.value.className = 'value';
  el.lines.className = 'lines';
  // Copy only when there's something to copy.
  el.copy.hidden = outcome.kind === 'graph' || outcome.kind === 'error' || outcome.kind === 'empty' || outcome.kind === 'pending';
  clear(el.lines);
  clear(el.detail);
  if (mode === 'committed' && outcome.kind !== 'graph') dropGraph();
  clear(el.meta);
  clear(el.alts);

  switch (outcome.kind) {
    case 'empty':
    case 'pending':
      if (outcome.kind === 'empty' && lastCommitted) {
        render(lastCommitted.outcome, 'committed', lastCommitted.ms);
        // The expression was worded against the session as it was then ("210 ÷ 3"), not as it is now.
        el.expr.textContent = lastCommitted.expr;
        if (lastSolve) solveExtras(lastSolve.input, lastSolve.outcome, true);
        return;
      }
      if (outcome.kind === 'empty' && screenCleared) {
        el.expr.textContent = '\u00a0';
        el.value.textContent = '0';
        el.value.classList.add('quiet');
        return;
      }
      if (outcome.kind === 'empty') {
        const last = history[0];
        el.expr.textContent = last ? (looksLikeFormula(last.expression) ? `${last.expression} =` : last.expression) : '\u00a0';
        el.value.textContent = last ? last.display : '0';
        if (!last) el.value.classList.add('quiet');
        el.copy.hidden = !last;
      }
      return;

    case 'error': {
      el.expr.textContent = el.input.value || ' ';
      el.value.textContent = outcome.error.message;
      el.value.classList.add('error');
      return;
    }

    case 'calc': {
      const r = outcome.result;
      el.expr.textContent = mode === 'committed' && !r.definition && !r.assignment && !r.assignments ? `${readable(r.expression)} =` : readable(r.expression);
      el.value.textContent = r.formatted.display;
      lastCalc = r;
      forms?.hook(r); // S⇔D: fraction, mixed number and exact forms (keyboard/forms.ts)
      if (r.fraction) el.meta.append(tag(`= ${r.fraction}`, 'exact'));
      // A whole number too long for the display ("2^64") is still known exactly: show every digit.
      else if (r.approximate && r.value.isInteger() && r.value.abs().lt('1e40')) {
        const digits = r.value.abs().toFixed(0);
        const grouped = settings.grouping ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : digits;
        el.meta.append(tag(`= ${r.value.isNegative() ? '−' : ''}${grouped}`, 'exact'));
      }
      if (r.approximate) el.meta.append(tag(`≈ ${settings.digits} significant digits`, 'approx'));
      // On a running total, "minus 5" obviously continues it: skip the "or a negative number?" offer and its note.
      const continuing = !el.tape.hidden && /\bans\b/.test(r.expression);
      if (!continuing) r.notes.forEach((n) => el.meta.append(note(n)));
      (continuing ? [] : r.alternatives).forEach((a) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'alt';
        b.title = 'Use this reading instead';
        b.append(`Or, ${a.label}: ${a.expression} = `);
        const v = document.createElement('b');
        v.textContent = a.formatted.display;
        b.append(v);
        b.addEventListener('click', () => {
          el.input.value = a.expression;
          submit();
        });
        el.alts.append(b);
      });
      break;
    }

    case 'answer':
      renderAnswer(outcome.result, mode);
      break;

    case 'graph':
      el.expr.textContent = 'Graph';
      el.value.classList.add('graphing');
      outcome.spec.notes.forEach((n) => el.meta.append(note(n)));
      void showGraph(outcome.spec);
      break;

    case 'convert': {
      const r = outcome.result;
      el.expr.textContent = r.expression;
      const [first, ...rest] = r.results;
      el.value.textContent = first!.formatted.display;
      const u = document.createElement('span');
      u.className = 'unit';
      u.textContent = unitLabel(first!.unit, first!.value);
      el.value.append(u);
      for (const line of rest) {
        const d = document.createElement('div');
        d.textContent = `${line.formatted.display} `;
        const s = document.createElement('span');
        s.className = 'unit';
        s.textContent = unitLabel(line.unit, line.value);
        d.append(s);
        el.lines.append(d);
      }
      if (r.results.some((x) => x.formatted.rounded)) el.meta.append(tag(`≈ ${settings.digits} significant digits`, 'approx'));
      r.notes.forEach((n) => el.meta.append(note(n)));
      break;
    }
  }
  // Symbolic answers are computed asynchronously in the CAS worker; the routing time would mislead.
  const asyncAnswer = outcome.kind === 'answer' && outcome.result.kind === 'symbolic';
  if (ms !== undefined && !asyncAnswer) el.meta.append(tag(ms < 1 ? `${ms.toFixed(2)} ms` : `${ms.toFixed(1)} ms`, 'time'));
}

let graphView: GraphView | null = null;
type GraphSpec = Extract<Outcome, { kind: 'graph' }>['spec'];
/** The committed graph on screen (or on its way): it changes only on the next commit, never while typing. */
let graphShown: GraphSpec | null = null;
async function showGraph(spec: GraphSpec) {
  const same = graphShown === spec;
  graphShown = spec;
  if (graphView) {
    if (!same) graphView.setSpec(spec);
    if (!graphView.root.isConnected) el.graphSlot.append(graphView.root);
    return;
  }
  const { GraphView } = await import('./graph/view');
  if (graphShown !== spec) return; // replaced or dropped while the chunk loaded
  if (graphView) return showGraph(spec);
  graphView = new GraphView(spec);
  el.graphSlot.replaceChildren(graphView.root);
}
/** Statistical charts (histograms, box plots…) committed with Enter stay in the graph slot like graphs do. */
function showStatPlot(plot: NonNullable<Answer['plot']>) {
  el.graphSlot.querySelector('.plot-slot')?.remove();
  if (graphView) dropGraph();
  const slot = document.createElement('div');
  slot.className = 'plot-slot';
  el.graphSlot.append(slot);
  void import('./graph/plot').then((m) => slot.isConnected && m.showPlot(slot, plot));
}
function dropGraph() {
  graphShown = null;
  graphView?.destroy();
  graphView = null;
  el.graphSlot.querySelector('.plot-slot')?.remove();
}

async function typeset(a: Answer) {
  if (!a.math?.length) return;
  const box = document.createElement('div');
  box.className = 'math';
  el.detail.prepend(box);
  const { renderMath } = await import('./math-render');
  for (const m of a.math) {
    const d = document.createElement('div');
    renderMath(d, m.latex);
    // "2x − 8 = 0 ⇒ x = 4": the working in one line, or (the "Working: line by line" setting) one line per step.
    if (m.latex.includes('\\Rightarrow')) {
      d.className = 'derivation one-line';
      const lines = document.createElement('div');
      lines.className = 'derivation by-line';
      for (const part of m.latex.split('\\Rightarrow')) {
        const row = document.createElement('div');
        renderMath(row, part.trim());
        lines.append(row);
      }
      box.append(lines);
    }
    if (m.collapsed) {
      // Long exact forms (Cardano radicals…) stay folded behind their numeric value.
      const det = document.createElement('details');
      const sum = document.createElement('summary');
      sum.textContent = m.label ?? 'Exact form';
      det.append(sum, d);
      box.append(det);
    } else box.append(d);
  }
}

function renderAnswer(a: Answer, mode: Mode) {
  el.expr.textContent = a.expression;
  el.value.textContent = a.primary.display;
  if (a.kind === 'symbolic') el.value.classList.add('symbolic');
  // Phrases (dates, note text) at number size wrap mid-phrase ("9:00 / AM"); set them a size down.
  else if (/\s/.test(a.primary.display) && a.primary.display.length > 14) el.value.classList.add('wordy');
  if (a.primary.unit) {
    const u = document.createElement('span');
    u.className = 'unit';
    u.textContent = a.primary.unit;
    el.value.append(u);
  }
  // A single row that repeats the answer ("x  4" under "x = 4") adds nothing.
  const repeats = a.lines?.length === 1 && `${a.lines[0]!.label}=${a.lines[0]!.display}`.replace(/[\s:]/g, '') === a.primary.display.replace(/\s/g, '');
  if (a.lines?.length && !repeats) {
    el.lines.className = 'lines rows';
    for (const l of a.lines) {
      const dt = document.createElement('dt');
      dt.textContent = l.label;
      const dd = document.createElement('dd');
      dd.textContent = l.display;
      el.lines.append(dt, dd);
    }
  }
  if (a.table && (mode === 'committed' || a.table.rows.length <= 6)) {
    const t = a.table;
    const table = document.createElement('table');
    const head = table.createTHead().insertRow();
    t.columns.forEach((c) => {
      const th = document.createElement('th');
      th.textContent = c;
      head.append(th);
    });
    const body = table.createTBody();
    t.rows.forEach((r, i) => {
      const tr = body.insertRow();
      if (i === t.highlightRow) tr.className = 'best';
      r.forEach((cell) => (tr.insertCell().textContent = cell));
    });
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.append(table);
    // Long tables (amortisation schedules) stay folded until asked for.
    if (t.rows.length > 6) {
      const d = document.createElement('details');
      const sum = document.createElement('summary');
      sum.textContent = `${t.caption ?? 'Details'} · ${t.rows.length} rows`;
      d.append(sum, wrap);
      el.detail.append(d);
    } else {
      if (t.caption) {
        const cap = document.createElement('div');
        cap.className = 'source';
        cap.textContent = t.caption;
        el.detail.append(cap);
      }
      el.detail.append(wrap);
    }
  }
  // Regression curves and statistical plots: a slot now (above any table), the chart once its chunk loads.
  // Engine-drawn diagrams (shapes, triangles, graphs): parsed as SVG, never as HTML, and scripts are dropped.
  if (a.figure?.svg) {
    const doc = new DOMParser().parseFromString(a.figure.svg, 'image/svg+xml');
    const svg = doc.documentElement;
    if (svg.nodeName === 'svg' && !doc.querySelector('parsererror')) {
      svg.querySelectorAll('script, foreignObject').forEach((x) => x.remove());
      const fig = document.createElement('figure');
      fig.className = 'answer-figure';
      fig.style.cssText = 'margin:8px 0;max-width:100%;';
      svg.setAttribute('style', 'max-width:100%;height:auto;display:block');
      if (a.figure.alt) svg.setAttribute('aria-label', a.figure.alt);
      fig.append(document.importNode(svg, true));
      el.detail.prepend(fig);
    }
  }
  // Plots are drawn for answers that were committed; while typing the preview shows the numbers only.
  if (a.plot && mode === 'committed') showStatPlot(a.plot);
  void typeset(a);
  // "✓ verified" and "exact" are reassurance, shown with "Extra details"; "could not verify" always shows.
  if (a.verified) el.meta.append(tag(a.verified.ok ? '✓ verified' : '⚠ could not verify', a.verified.ok ? 'exact fine' : 'warn'));
  if (a.exactness === 'exact' && a.kind === 'symbolic') el.meta.append(tag('exact', 'fine'));
  if (a.exactness === 'numeric') el.meta.append(tag('numeric', 'warn'));
  if (a.verified) el.meta.lastElementChild?.setAttribute('title', a.verified.how);
  a.notes.forEach((n) => el.meta.append(note(n)));
  if (a.source) {
    const src = document.createElement('span');
    src.className = `source${a.source.stale ? ' stale' : ''}`;
    const link = document.createElement('a');
    link.href = a.source.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = a.source.name;
    src.append(a.source.stale ? 'Rates may be out of date · ' : a.kind === 'currency' ? 'Rates: ' : 'Data: ', link, ` · as of ${a.source.asOf}`);
    el.meta.append(src);
  }
}

function historyItem(h: HistoryEntry): HTMLLIElement {
  const li = document.createElement('li');
  li.dataset.id = h.id;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'h-item';
  b.title = 'Tap the answer to insert it · tap the expression (or Shift-click) to edit it again';
  const i = document.createElement('span');
  i.className = 'h-in';
  i.textContent = h.input;
  const o = document.createElement('span');
  o.className = 'h-out';
  o.textContent = (h.approximate ? '≈ ' : '') + h.display;
  b.append(i, o);
  h.extra?.forEach((x) => {
    const e = document.createElement('span');
    e.className = 'h-extra';
    e.textContent = x;
    b.append(e);
  });
  b.addEventListener('click', (ev) => {
    if (ev.shiftKey || (ev.target as Element).closest('.h-in')) setInput(h.input);
    else insertAtCursor(h.plain);
  });
  const pin = document.createElement('button');
  pin.type = 'button';
  pin.className = 'pin';
  pin.textContent = h.pinned ? '★' : '☆';
  pin.setAttribute('aria-pressed', String(!!h.pinned));
  pin.setAttribute('aria-label', h.pinned ? 'Unpin' : 'Pin');
  pin.title = h.pinned ? 'Unpin' : 'Pin to the top';
  pin.addEventListener('click', () => {
    const hadFocus = document.activeElement === pin;
    h.pinned = !h.pinned;
    if (settings.keepHistory) saveHistory(history);
    renderHistory();
    const moved = document.querySelector<HTMLElement>(`li[data-id="${h.id}"] .pin`);
    if (moved) confirmPop(moved);
    // The list was rebuilt: keep keyboard focus on the same star, now in its new place.
    if (moved && hadFocus) moved.focus({ preventScroll: true });
  });
  li.append(b, pin);
  return li;
}

/** The pinned entries as last drawn, to tell "one new answer" from other changes. */
let drawnPinned = '';

/**
 * The usual change, one new answer on top with everything else as it was: only that row is added (and the 51st
 * dropped), and the list slides down by its height. Nothing is measured while the answer is being handled: the one
 * reading happens in the next frame, when the browser lays the page out anyway.
 */
function prependOne(recent: HistoryEntry[]): boolean {
  const shown = [...el.history.children].map((li) => (li as HTMLElement).dataset.id);
  const pinned = history.filter((h) => h.pinned).map((h) => h.id).join();
  if (!shown.length || !recent.length || pinned !== drawnPinned || recent[0]!.id === shown[0]) return false;
  if (recent.length - 1 > shown.length || !recent.slice(1).every((h, i) => h.id === shown[i])) return false;
  const li = historyItem(recent[0]!);
  el.history.prepend(li);
  while (el.history.children.length > recent.length) el.history.lastElementChild!.remove();
  if (moves('answers'))
    requestAnimationFrame(() => {
      const gap = parseFloat(getComputedStyle(el.history).rowGap) || 0;
      const h = li.getBoundingClientRect().height + gap;
      play(el.history, [{ transform: `translateY(${-h}px)` }, { transform: 'none' }], D2, 'answers');
      play(li, [{ opacity: 0 }, { opacity: 1 }], D2, 'answers');
    });
  return true;
}

/** `moved`: entries glide to their new places and new ones slide in (off for the first paint). */
function renderHistory(moved = true) {
  if (moved && prependOne(history.filter((h) => !h.pinned).slice(0, 50))) {
    el.clearHistory.hidden = false;
    el.examples.hidden = true;
    return;
  }
  drawnPinned = history.filter((h) => h.pinned).map((h) => h.id).join();
  const was = moved ? [snapshot(el.history), snapshot(el.pinned)] : [null, null];
  clear(el.history);
  clear(el.pinned);
  const pinned = history.filter((h) => h.pinned);
  pinned.forEach((h) => el.pinned.append(historyItem(h)));
  el.pinnedSection.hidden = pinned.length === 0;
  history
    .filter((h) => !h.pinned)
    .slice(0, 50)
    .forEach((h) => el.history.append(historyItem(h)));
  el.clearHistory.hidden = !history.some((h) => !h.pinned);
  el.examples.hidden = history.length > 0;
  glide(el.history, was[0]!);
  glide(el.pinned, was[1]!);
}

function renderExamples() {
  const p = document.createElement('p');
  p.textContent = 'Try saying or typing';
  el.examples.append(p);
  for (const ex of [
    "What's 18% of 275?",
    '50 miles to km',
    'days until christmas',
    '18% tip on $64.50 split 3 ways',
    'monthly payment on $300k at 6.5% for 30 years',
    '100 usd to eur',
    'time in tokyo',
    '500 g for $3.49 vs 1 kg for $5.99',
    'sqrt 2',
    'f(x) = x^2 + 1',
  ]) {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'chip';
    c.textContent = ex;
    c.addEventListener('click', () => {
      el.input.value = ex;
      submit();
    });
    el.examples.append(c);
  }
}

// ---------- evaluation ----------
function evaluateNow(text = el.input.value, preview = false): { outcome: Outcome; ms: number } {
  const t0 = performance.now();
  const outcome = route(withCustomValues(text), session, { ...routeOptions(), preview });
  return { outcome, ms: performance.now() - t0 };
}

/**
 * Re-runs once a lazy engine or exchange rates arrive. A preview is dropped if the input changed meanwhile;
 * a commit (Enter) always completes, with the text that was submitted, even if the user has kept typing.
 */
function whenReady(outcome: Extract<Outcome, { kind: 'pending' }>, again: () => void, committing: boolean, text = el.input.value) {
  outcome.waitFor.then(
    () => (committing || el.input.value === text) && again(),
    (err: unknown) => {
      if (!committing && el.input.value !== text) return;
      const error = { code: 'domain', message: err instanceof Error ? err.message : String(err) } as never;
      render({ kind: 'error', error }, committing ? 'committed' : 'preview');
    },
  );
}

function preview() {
  if (assistantMode) return;
  const { outcome, ms } = evaluateNow(el.input.value, true);
  if (outcome.kind === 'pending') return whenReady(outcome, preview, false);
  // A lone letter ("x") while typing: quiet at first, then the hint softly once typing pauses (never an error).
  if (outcome.kind === 'answer' && outcome.result.kind === 'hint') return render({ kind: 'error', error: { code: 'unknown-name', message: outcome.result.notes[0] ?? '' } as never }, 'preview');
  const shown = el.value.textContent;
  render(outcome, 'preview', outcome.kind === 'empty' ? undefined : ms);
  moveValue('preview', shown);
}

let valueMotion: Animation | null = null;
/**
 * The number's motion, after it's already on screen: a commit rises in (a quick crossfade when only digits
 * changed), a preview crossfades softly without restarting per keystroke, an error shakes the input once.
 */
function moveValue(kind: 'preview' | 'committed' | 'error', shown: string | null) {
  const now = el.value.textContent ?? '';
  if (kind === 'error') {
    play(el.form, [{ transform: 'none' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'none' }], D3, 'feedback');
    play(el.value, [{ opacity: 0 }, { opacity: 1 }], D2, 'feedback');
    return;
  }
  if (kind === 'preview') {
    if (now !== shown && valueMotion?.playState !== 'running') valueMotion = play(el.value, [{ opacity: 0.55 }, { opacity: 1 }], D1, 'answers');
    return;
  }
  valueMotion?.cancel();
  const digitsOnly = !!shown && now !== shown && now.replace(/\d/g, '0') === shown.replace(/\d/g, '0');
  valueMotion = digitsOnly
    ? play(el.value, [{ opacity: 0.4 }, { opacity: 1 }], D1, 'answers')
    : play(el.value, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], 160, 'answers');
}

/** Each Enter is numbered; the screen shows the newest one even if an older one (waiting on an engine) finishes later. */
let submitSeq = 0;
let shownSeq = 0;

function submit(fromVoice = false, submitted = el.input.value, seq = ++submitSeq, at = Date.now()) {
  if (assistantMode && el.input.value.trim()) {
    const text = el.input.value.trim();
    el.input.value = '';
    void getAssistant().then((a) => a.ask(text));
    return;
  }
  const { outcome, ms } = evaluateNow(submitted);
  if (outcome.kind === 'pending') {
    if (pendingCommits.has(submitted)) return;
    pendingCommits.add(submitted);
    const settled = () => pendingCommits.delete(submitted);
    outcome.waitFor.then(settled, settled);
    return whenReady(outcome, () => submit(fromVoice, submitted, seq, at), true, submitted);
  }
  if (outcome.kind === 'empty') return;
  // Overtaken by a newer answer while it waited: it goes into history in its place, and leaves the screen alone.
  if (seq < shownSeq) return outcome.kind === 'error' ? undefined : fileLate(submitted.trim(), outcome, at);
  // A spoken phrase that couldn't be understood: show what was heard, gently (never a raw error, never read aloud).
  if (fromVoice && outcome.kind === 'error' && MISHEARD.includes(outcome.error.code)) return heardTryAgain(submitted);
  const shown = el.value.textContent;
  render(outcome, 'committed', ms);
  moveValue(outcome.kind === 'error' ? 'error' : 'committed', shown);
  if (outcome.kind === 'error') {
    // Errors are never read aloud.
    // The calculator didn't understand: offer (never auto-send) the assistant.
    if (aiReady() && settings.aiFallback && ['syntax', 'unknown-name', 'ambiguous-reference'].includes(outcome.error.code)) {
      const text = submitted.trim();
      aiButton('Ask the assistant', () => {
        el.input.value = '';
        void getAssistant().then((a) => a.ask(text));
      });
    }
    return;
  }
  // "x has no value yet": shown, but not kept in history, and the input stays for adding "= …".
  if (outcome.kind === 'answer' && outcome.result.kind === 'hint') return;
  resultChips(submitted.trim(), outcome);
  if (outcome.kind !== 'graph') solveExtras(withCustomValues(submitted.trim()), outcome);
  if (aiReady() && outcome.kind !== 'graph') {
    const asAnswer = outcomeAsAnswer(outcome, submitted.trim());
    if (asAnswer) aiButton('Explain', () => void getAssistant().then((a) => a.explain(asAnswer, asAnswer.input)));
  }

  const input = submitted.trim();
  const before = { ans: session.ans, base: session.base };
  let entry: HistoryEntry;
  if (outcome.kind === 'graph') {
    entry = { id: id(), input, expression: 'Graph', display: outcome.spec.items.map((i) => i.label).join(', '), plain: input, at: Date.now() };
  } else if (outcome.kind === 'answer') {
    const a = outcome.result;
    if (a.value) {
      session.ans = a.value;
      session.base = a.value;
    }
    if (a.action?.type === 'show') showAction((a.action as { what?: string }).what);
    else if (a.action) notes.handle(a.action);
    entry = {
      id: id(),
      input,
      expression: a.expression,
      display: a.primary.display + (a.primary.unit ? ` ${a.primary.unit}` : ''),
      plain: a.primary.plain,
      extra: a.lines?.slice(0, 2).map((l) => `${l.label}: ${l.display}`),
      at: Date.now(),
    };
    if (fromVoice && settings.speakResults) speak(a.primary.spoken);
  } else if (outcome.kind === 'calc') {
    const r = outcome.result;
    const expression = readable(r.expression);
    commitCalc(session, r);
    // Any form of assignment ("x = 5", "a = 3, b = 4", "r := 2", "store 7 in m") is saved and shown.
    persistVars();
    if (r.definition) persistFormulas();
    entry = { id: id(), input, expression, display: r.formatted.display, plain: r.formatted.plain, approximate: r.approximate, at: Date.now() };
    if (fromVoice && settings.speakResults) speak(r.formatted.spoken);
  } else {
    const r = outcome.result;
    const first = r.results[0]!;
    session.ans = first.value;
    session.base = r.source.value;
    const label = (x: typeof first) => `${x.formatted.display} ${unitLabel(x.unit, x.value)}`;
    entry = {
      id: id(),
      input,
      expression: r.expression,
      display: label(first),
      plain: first.formatted.plain,
      extra: r.results.slice(1).map(label),
      approximate: first.formatted.rounded,
      at: Date.now(),
    };
    if (fromVoice && settings.speakResults) speak(r.results.map((x) => `${x.formatted.spoken} ${x.value.abs().eq(1) ? x.unit.singular : x.unit.plural}`).join(', '));
  }

  lastCommitted = { outcome, ms, expr: el.expr.textContent ?? '', input };
  shownSeq = seq;
  screenCleared = false;
  history.unshift(entry);
  if (settings.keepHistory) saveHistory(history);
  renderHistory();
  if (tapeOn()) addTapeStep(entry, before);
  // Calculations count toward agenda tasks on their topic (loaded on demand; never blocks the answer).
  // After the answer is on screen, when the page is idle: the bookkeeping never costs the answer a frame.
  if (outcome.kind !== 'graph') idleSoon(() => quietly(import('./agenda').then((m) => m.recordActivity({ kind: 'calc', topic: input }))));
  recallIndex = -1;
  // Clear the field only if it still holds what was submitted; if the user kept typing, keep their new text.
  if (el.input.value === submitted) el.input.value = '';
  else if (el.input.value) preview();
}

/** Esc or AC on an empty input: the screen goes back to 0 (history keeps everything). */
function clearScreen() {
  if (screenCleared && !lastCommitted) return;
  lastCommitted = null;
  lastSolve = null;
  screenCleared = true;
  dropGraph();
  render({ kind: 'empty' }, 'preview');
}

/** Runs work that can wait until the page is idle (within a second at most). */
function idleSoon(cb: () => void) {
  if ('requestIdleCallback' in window) requestIdleCallback(cb, { timeout: 1000 });
  else setTimeout(cb, 50);
}

/** A late answer's history entry, slotted in by when it was asked. The screen and "ans" stay on the newer answer. */
function fileLate(input: string, outcome: Exclude<Outcome, { kind: 'empty' | 'pending' | 'error' }>, at: number) {
  let expression = input;
  let display = '';
  let plain = '';
  if (outcome.kind === 'graph') {
    expression = 'Graph';
    display = plain = outcome.spec.items.map((i) => i.label).join(', ');
  } else if (outcome.kind === 'answer') {
    if (outcome.result.kind === 'hint') return;
    // Its timer or note still happens; only "show …" is skipped, so the screen stays on the newer answer.
    if (outcome.result.action && outcome.result.action.type !== 'show') notes.handle(outcome.result.action);
    expression = outcome.result.expression;
    display = outcome.result.primary.display + (outcome.result.primary.unit ? ` ${outcome.result.primary.unit}` : '');
    plain = outcome.result.primary.plain;
  } else if (outcome.kind === 'calc') {
    commitCalc(session, outcome.result);
    persistVars();
    expression = readable(outcome.result.expression);
    display = outcome.result.formatted.display;
    plain = outcome.result.formatted.plain;
  } else {
    const first = outcome.result.results[0]!;
    expression = outcome.result.expression;
    display = `${first.formatted.display} ${unitLabel(first.unit, first.value)}`;
    plain = first.formatted.plain;
  }
  const entry: HistoryEntry = { id: id(), input, expression, display, plain, at };
  const i = history.findIndex((h) => h.at <= at);
  history.splice(i < 0 ? history.length : i, 0, entry);
  if (settings.keepHistory) saveHistory(history);
  renderHistory();
}

/**
 * Angle, digits, grouping and currency change how an answer reads: the one on screen is worked out again in place
 * (it keeps its buttons; history keeps what was shown at the time). One built on an earlier answer ("ans × 2") or
 * one that set something ("x = 5") is left as it was.
 */
function refreshShown() {
  if (el.input.value.trim()) return preview();
  const input = lastCommitted?.input ?? (screenCleared ? undefined : history[0]?.input);
  if (!input || /\b(?:ans|base)\b/.test(input)) return;
  const { outcome, ms } = evaluateNow(input);
  if (outcome.kind === 'pending') return void outcome.waitFor.then(() => !el.input.value.trim() && refreshShown(), () => undefined);
  if (outcome.kind === 'empty' || outcome.kind === 'error' || outcome.kind === 'graph') return;
  if (outcome.kind === 'calc' && (outcome.result.assignment || outcome.result.assignments || outcome.result.definition)) return;
  if (outcome.kind === 'answer' && outcome.result.kind === 'hint') return;
  render(outcome, 'committed', ms);
  lastCommitted = { outcome, ms, expr: el.expr.textContent ?? '', input };
  screenCleared = false;
  resultChips(input, outcome);
  solveExtras(withCustomValues(input), outcome);
}

/** "show my notes" opens Study → Notes; "show timers" brings the running timers into view. */
function showAction(what?: string) {
  if (what === 'timers') {
    if (timers.length) el.timers.scrollIntoView({ block: 'nearest', behavior: settings.motion === 'calm' ? 'auto' : 'smooth' });
    else toast('No timers running');
    return;
  }
  openTool('notes');
}

// ---------- assistant (optional AI layer) ----------
let assistantMode = false;
let assistant: Promise<Assistant> | null = null;

// Providers that need a key before they can answer (see ai-engine PROVIDER_PRESETS).
const KEYED = new Set(['anthropic', 'openai', 'gemini', 'openrouter', 'groq', 'mistral', 'deepseek']);
function aiReady(): boolean {
  if (!settings.aiEnabled) return false;
  if (KEYED.has(settings.aiProvider)) return loadAiKey(settings.aiProvider).length > 8;
  if (settings.aiProvider === 'custom') return !!settings.aiBaseUrls.custom;
  return true; // built-in model, Ollama, LM Studio
}

function getAssistant(): Promise<Assistant> {
  assistant ??= import('./assistant/controller').then(
    ({ Assistant }) =>
      new Assistant({
        settings,
        apiKey: loadAiKey,
        status: setStatus,
        route: (q) => route(q, session, routeOptions()),
        showGraph: (exprs) =>
          void loadAdvanced().then((a) => {
            try {
              const spec = a.parseGraph(`graph ${exprs.join(', ')}`, session);
              render({ kind: 'graph', spec, input: exprs.join(', ') }, 'committed');
            } catch {
              // The tool result already reports parse failures to the model.
            }
          }),
        useQuery: (q) => {
          setAssistantMode(false);
          el.input.value = q;
          submit();
        },
        log: el.convoLog,
        section: el.convo,
        setBusy: (busy) => el.form.classList.toggle('busy', busy),
      }),
  );
  return assistant;
}

// ---------- notebook (Phase 5) ----------
let notebook: Promise<NotebookView> | null = null;
const mainEl = document.querySelector('main')!;

function getNotebook(): Promise<NotebookView> {
  notebook ??= Promise.all([import('./notebook/view'), import('./notebook/runtime')]).then(([{ NotebookView }, { makeRunner }]) => {
    const v: NotebookView = new NotebookView({
      runner: makeRunner(
        (q, s) => route(q, s, routeOptions()),
        (p) => void p.then(() => v.refresh(), () => v.refresh()),
      ),
      parseGraph: (text, s) => loadAdvanced().then((a) => a.parseGraph(text, s)),
      toast,
      close: () => showNotebook(false),
    });
    v.root.hidden = true;
    $('app').append(v.root);
    return v;
  });
  notebook.catch(() => (notebook = null));
  return notebook;
}

async function showNotebook(on: boolean, push = true) {
  if (on) {
    const v = await getNotebook();
    mainEl.hidden = true;
    v.root.hidden = false;
    document.documentElement.classList.add('notebook-open');
    syncDock();
    if (push && location.hash !== '#notebook') window.history.pushState(null, '', '#notebook');
    v.focusFirst();
  } else {
    mainEl.hidden = false;
    void notebook?.then((v) => (v.root.hidden = true));
    document.documentElement.classList.remove('notebook-open');
    syncDock();
    if (push && location.hash === '#notebook') window.history.pushState(null, '', location.pathname + location.search);
    el.input.focus();
  }
}

$('open-extensions').addEventListener('click', () =>
  void Promise.all([import('./plugins/manager'), import('./engine')]).then(([{ openExtensions }, { plugins }]) =>
    openExtensions($<HTMLDialogElement>('extensions'), (list) => plugins.update(list), toast),
  ),
);

if (!overlayMode) void import('./sync-ui').then(({ initSync }) => initSync(toast, desktop?.sync));

$('open-notebook').addEventListener('click', () => void showNotebook(mainEl.hidden === false));
window.addEventListener('popstate', () => void showNotebook(location.hash === '#notebook', false));

function aiButton(label: string, on: () => void) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'alt chip explain';
  b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v10H10l-4 4v-4H5z"/></svg>';
  b.append(label);
  b.addEventListener('click', on);
  // "Explain" joins the collapsible actions; "Ask the assistant" (after an error) stays in view.
  if (label === 'Explain') chipGroup().append(b);
  else el.alts.append(b);
}

function outcomeAsAnswer(o: Outcome, input: string): Answer | null {
  const base = { ok: true as const, input, notes: [] as string[] };
  if (o.kind === 'answer') return o.result;
  if (o.kind === 'calc') {
    const r = o.result;
    return { ...base, kind: 'calc', expression: r.expression, primary: { display: r.formatted.display, plain: r.formatted.plain, spoken: r.formatted.spoken }, value: r.value, notes: r.notes, exactness: r.approximate ? 'approximate' : 'exact' };
  }
  if (o.kind === 'convert') {
    const f = o.result.results[0]!;
    return { ...base, kind: 'convert', expression: o.result.expression, primary: { display: f.formatted.display, plain: f.formatted.plain, spoken: f.formatted.spoken, unit: f.unit.symbol }, notes: o.result.notes };
  }
  return null;
}

/** The empty box suggests one thing to try, so what Lemma can do shows without opening anything. */
const EXAMPLES: Record<'basic' | 'scientific', string[]> = {
  basic: ['15% tip on 84.50', '3 cups in ml', 'open the whiteboard', 'days until Dec 25', 'what is 2^10', 'open geometry', '20% off 59.99'],
  scientific: ['solve x^2 - 5x + 6 = 0', 'derivative of sin(x) x^2', 'integrate e^x from 0 to 1', 'sin(30) + cos(60)', 'factor x^3 - 8', 'mean of 4, 8, 15, 16'],
};
function idlePlaceholder(): string {
  if (!settings.inputHints) return '';
  const phone = matchMedia('(max-width: 480px)').matches;
  const all = EXAMPLES[calcMode === 'scientific' ? 'scientific' : 'basic'];
  // A phone's input fits about 20 characters: only examples short enough to read whole.
  const list = phone ? all.filter((x) => x.length <= 16) : all;
  const pick = (list.length ? list : all)[Math.floor(Math.random() * (list.length || all.length))];
  return phone ? `Try “${pick}”` : `Ask anything… try “${pick}”`;
}

function setAssistantMode(on: boolean) {
  assistantMode = on && aiReady();
  el.assistantToggle.setAttribute('aria-pressed', String(assistantMode));
  el.form.classList.toggle('assistant', assistantMode);
  el.input.placeholder = assistantMode ? 'Ask the assistant…' : idlePlaceholder();
  document.documentElement.classList.toggle('assistant-mode', assistantMode);
  setStatus(assistantMode ? 'Ask in plain language, add a photo of a problem, or speak. Every number is computed by Lemma.' : '');
  if (assistantMode) el.convo.hidden = false;
}

function applyAi() {
  const ready = aiReady();
  // Photos, drawings and worksheets are read on the device; a vision-capable AI provider is offered as a better reader.
  el.attach.hidden = overlayMode;
  el.assistantToggle.hidden = !ready;
  if (!ready) setAssistantMode(false);
}

/** Downscales large photos (phone cameras) to ≤1600 px so uploads stay small and fast. */
async function readImage(file: Blob): Promise<{ dataUrl: string; mediaType: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.88), mediaType: 'image/jpeg' };
}

/** Reads a problem from a photo with the AI provider (the "better reader" offered in the photo sheet). */
async function readWithAi(file: Blob) {
  try {
    const img = await readImage(file);
    const a = await getAssistant();
    await a.readImage(img.dataUrl, img.mediaType);
  } catch {
    toast('Couldn’t read that image');
  }
}
function handleImage(file?: Blob | Blob[], tab?: 'photo' | 'draw' | 'sheet') {
  const files = file ? (Array.isArray(file) ? file : [file]) : [];
  // With a vision-capable AI provider set up, one photo goes straight to it (as before); otherwise it's read on the device.
  if (files.length === 1 && tab !== 'sheet' && files[0]!.type.startsWith('image/') && aiReady() && settings.aiProvider !== 'builtin') return void readWithAi(files[0]!);
  if (tab === 'draw') return void import('./solve/pick').then((m) => m.openPicker(solveHost(), { tab }));
  // Photos and PDFs: the photo-solve screen, which reads and solves everything in them.
  void import('./solve/snap').then((m) => m.openSnap(solveHost(), { files }));
}

/**
 * The camera button. On a phone it goes straight to the camera (opened inside the tap, as browsers require), and the
 * photo-solve screen opens with the picture; on a computer it opens that screen (drop, paste, webcam or files).
 */
function openCamera() {
  if (!matchMedia('(pointer: coarse)').matches) return handleImage();
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.setAttribute('capture', 'environment');
  input.addEventListener('change', () => {
    const fs = [...(input.files ?? [])];
    if (fs.length) handleImage(fs);
  });
  input.click();
  // Fetched while the camera is up, so the screen is ready when the photo comes back.
  void import('./solve/snap').then((m) => m.warmSnap());
}

el.assistantToggle.addEventListener('click', () => {
  setAssistantMode(!assistantMode);
  el.input.focus();
});
el.attach.addEventListener('click', openCamera);
// Pointing at it (or touching it) starts the photo reader's one-time download early.
for (const ev of ['pointerenter', 'focus', 'touchstart'] as const) el.attach.addEventListener(ev, () => void import('./solve/snap').then((m) => m.warmSnap()), { once: true, passive: true });
// Images and PDFs dropped anywhere on the calculator open the picker with that file.
mainEl.addEventListener('dragover', (e) => {
  if ([...(e.dataTransfer?.items ?? [])].some((i) => i.kind === 'file')) e.preventDefault();
});
mainEl.addEventListener('drop', (e) => {
  const fs = [...(e.dataTransfer?.files ?? [])].filter((x) => x.type.startsWith('image/') || x.type === 'application/pdf');
  if (!fs.length) return;
  e.preventDefault();
  handleImage(fs);
});
el.imageFile.addEventListener('change', () => {
  const f = el.imageFile.files?.[0];
  if (f) void handleImage(f);
  el.imageFile.value = '';
});
el.input.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
  const f = item?.getAsFile();
  if (f) {
    e.preventDefault();
    void handleImage(f);
  }
});
el.convoClear.addEventListener('click', () => void getAssistant().then((a) => a.reset()));

function speak(text: string) {
  synth.speak(text.replace(/−/g, '-'), { lang: settings.voiceLang, rate: settings.speechRate });
}

function persistFormulas() {
  saveFormulas([...session.fns.values()].map((f) => f.source));
  renderFormulas();
}

/** The chips were rebuilt under the keyboard: focus moves to the next one (or back to the input), not the page. */
function afterChipDelete() {
  (el.formulas.querySelector<HTMLElement>('.formula button[aria-label]') ?? el.input).focus({ preventScroll: true });
}

function renderFormulas() {
  clear(el.formulas);
  el.formulas.hidden = session.fns.size === 0 && session.vars.size === 0;
  // Variables: click inserts the name, × forgets it.
  for (const [name, v] of session.vars) {
    const chip = document.createElement('span');
    chip.className = 'formula';
    const use = document.createElement('button');
    use.type = 'button';
    use.textContent = `${name} = ${v.toSignificantDigits(8).toString()}`;
    use.title = `Insert ${name}`;
    use.addEventListener('click', () => insertAtCursor(name));
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '×';
    del.setAttribute('aria-label', `Delete variable ${name}`);
    del.addEventListener('click', () => {
      session.vars.delete(name);
      persistVars();
      afterChipDelete();
      toast(`Deleted ${name}`, {
        label: 'Undo',
        run: () => {
          session.vars.set(name, v);
          persistVars();
        },
      });
    });
    chip.append(use, del);
    el.formulas.append(chip);
  }
  if (!session.fns.size) return;
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = 'Formulas';
  el.formulas.append(label);
  for (const [name, f] of session.fns) {
    const chip = document.createElement('span');
    chip.className = 'formula';
    const use = document.createElement('button');
    use.type = 'button';
    use.textContent = `${name}(${f.params.join(', ')})`;
    use.title = f.source;
    use.addEventListener('click', () => insertAtCursor(`${name}(`));
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '×';
    del.setAttribute('aria-label', `Delete formula ${name}`);
    del.addEventListener('click', () => {
      session.fns.delete(name);
      persistFormulas();
      afterChipDelete();
      toast(`Deleted ${name}`, {
        label: 'Undo',
        run: () => {
          session.fns.set(name, f);
          persistFormulas();
        },
      });
    });
    chip.append(use, del);
    el.formulas.append(chip);
  }
}

// ---------- timers ----------
let timers: StoredTimer[] = loadTimers();
let timerTick = 0;

function startTimer(seconds: number, label: string) {
  timers.push({ id: id(), label, seconds, endsAt: Date.now() + seconds * 1000 });
  saveTimers(timers);
  // Ask once, in response to the user's own action, so the finished timer can notify in the background.
  if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
  renderTimers();
}

/** Cancels timers whose label contains `match` (or all, or the latest); returns how many. */
function cancelTimers(match?: string, all?: boolean): number {
  const doomed = all ? timers : match ? timers.filter((t) => t.label.toLowerCase().includes(match)) : timers.slice(-1);
  timers = timers.filter((t) => !doomed.includes(t));
  saveTimers(timers);
  renderTimers();
  return doomed.length;
}

function chime() {
  try {
    const ctx = new AudioContext();
    [0, 0.25, 0.5].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.22);
    });
    setTimeout(() => void ctx.close(), 1000);
  } catch {
    // Audio may be blocked; the visual and notification still fire.
  }
}

const notified = new Set<string>();
function renderTimers() {
  clear(el.timers);
  el.timers.hidden = timers.length === 0;
  const now = Date.now();
  for (const t of timers) {
    const left = t.endsAt - now;
    const done = left <= 0;
    if (done && !notified.has(t.id)) {
      notified.add(t.id);
      chime();
      toast(`Timer done: ${t.label}`);
      if (settings.speakResults) speak(`Timer done. ${t.label}`);
      if ('Notification' in window && Notification.permission === 'granted' && document.hidden) new Notification('Lemma timer', { body: t.label });
    }
    const box = document.createElement('div');
    box.className = `timer${done ? ' done' : ''}`;
    const c = document.createElement('span');
    c.className = 't-clock';
    c.textContent = done ? '0:00' : clock(left);
    const l = document.createElement('span');
    l.className = 't-label';
    l.textContent = done ? `${t.label} · done` : t.label;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'icon-btn';
    x.textContent = '×';
    x.setAttribute('aria-label', done ? 'Dismiss timer' : 'Cancel timer');
    x.addEventListener('click', () => {
      timers = timers.filter((y) => y !== t);
      saveTimers(timers);
      renderTimers();
    });
    box.append(c, l, x);
    el.timers.append(box);
  }
  clearTimeout(timerTick);
  if (timers.length) timerTick = window.setTimeout(renderTimers, 1000 - (Date.now() % 1000) + 5);
}

function persistVars() {
  saveVars(Object.fromEntries([...session.vars].map(([k, v]) => [k, v.toString()])));
  renderFormulas();
}

const id = () => Math.random().toString(36).slice(2, 10);

// ---------- input helpers ----------
function setInput(text: string) {
  el.input.value = text;
  el.input.focus();
  el.input.setSelectionRange(text.length, text.length);
  preview();
}

function insertAtCursor(text: string) {
  const i = el.input;
  const start = i.selectionStart ?? i.value.length;
  const end = i.selectionEnd ?? i.value.length;
  i.setRangeText(text, start, end, 'end');
  i.focus();
  preview();
}

/** Persistent status under the input (e.g. a model download); hidden when there's nothing to say. */
/**
 * The status line under the input. With a `stage` (a share of a long one-time load, like the algebra engine) it
 * carries a thin progress bar: it jumps to where the stage starts and eases most of the way to where it ends, so
 * it keeps moving through a long step without claiming to be done.
 */
function setStatus(message: string, stage?: [number, number]) {
  const hint = $('hint');
  hint.textContent = message;
  hint.hidden = !message;
  if (!stage || !message) return;
  const bar = document.createElement('span');
  bar.className = 'hint-bar';
  bar.setAttribute('aria-hidden', 'true');
  const fill = document.createElement('i');
  bar.append(fill);
  hint.append(bar);
  const [from, to] = stage;
  fill.style.transform = `scaleX(${from})`;
  // Two frames later (so the start is painted), glide toward 90% of this stage's end over a few seconds.
  requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.transform = `scaleX(${from + (to - from) * 0.9})`)));
}

let toastTimer = 0;
/** "10 × 2 × 5" gets a trailing "=" when shown as the last result; "Note" or "15% tip on $84.50" doesn't. */
function looksLikeFormula(expression: string): boolean {
  const words = expression.replace(/\b(?:sqrt|cbrt|sin|cos|tan|asin|acos|atan|sinh|cosh|tanh|log|ln|abs|floor|ceil|round|mod|ans)\b/gi, '');
  return /[\d)]\s*[×÷+\-*/^%!]/.test(expression) && !/[a-z]{3,}/i.test(words);
}

/**
 * Shows or hides the notice. It lives in the top layer (a popover) where the browser has one, so it shows above an
 * open sheet or dialog instead of under its backdrop; re-showing it puts it above whatever opened since.
 */
function showToastEl(on: boolean) {
  el.toast.hidden = !on;
  const t = el.toast as HTMLElement & { showPopover?: () => void; hidePopover?: () => void };
  if (!t.showPopover) return;
  try {
    if (t.matches(':popover-open')) t.hidePopover!();
    if (on) t.showPopover();
  } catch {
    /* not a popover in this browser */
  }
}

function toast(msg: string, action?: { label: string; run: () => void }, ms?: number) {
  for (const a of el.toast.getAnimations()) a.cancel();
  el.toast.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-action';
    b.textContent = action.label;
    b.addEventListener('click', () => {
      action.run();
      showToastEl(false);
    });
    el.toast.append(b);
  }
  showToastEl(true);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    const a = play(el.toast, [{ opacity: 1 }, { opacity: 0, translate: '0 6px' }], D2, 'panels', { fill: 'forwards' });
    if (!a) return showToastEl(false);
    a.onfinish = () => {
      showToastEl(false);
      a.cancel();
    };
  }, ms ?? (action ? 5000 : 2600));
}

// ---------- voice ----------
function setListening(on: boolean) {
  listening = on;
  if (on && settings.continuousListening) showTape();
  if (!on) el.tapeStatus.textContent = 'Running total';
  else el.tapeStatus.textContent = 'Listening';
  el.tape.classList.toggle('live', on);
  el.mic.setAttribute('aria-pressed', String(on));
  el.mic.setAttribute('aria-label', on ? 'Stop voice input' : 'Start voice input');
  el.form.classList.toggle('listening', on);
  if (!on) el.mic.style.removeProperty('--level');
}

/** The mic ring follows the voice level (when the recognizer reports one), once per frame at most. */
let level = 0;
let levelFrame = 0;
function setLevel(v: number) {
  level = v;
  if (levelFrame || !listening || !moves('mic')) return;
  levelFrame = requestAnimationFrame(() => {
    levelFrame = 0;
    if (listening) el.mic.style.setProperty('--level', level.toFixed(2));
  });
}

/** Error kinds that mean "didn't understand the words", as opposed to a real maths problem like dividing by zero. */
const MISHEARD = ['syntax', 'unknown-name', 'incomplete', 'empty', 'ambiguous-reference'];

/** A committed spoken phrase that made no sense: what was heard, and a nudge to say it again. Nothing is spoken. */
function heardTryAgain(text: string) {
  render({ kind: 'pending', waitFor: Promise.resolve() }, 'committed');
  el.expr.textContent = `Heard: “${text.trim()}”`;
  el.value.classList.add('quiet', 'heard');
  el.value.textContent = 'Try again';
  if (el.input.value === text) el.input.value = '';
}

/** The words being heard, with no result yet: never an error while someone is still talking. */
function showHeard(text: string) {
  render({ kind: 'pending', waitFor: Promise.resolve() }, 'preview');
  el.expr.textContent = text;
  el.value.classList.add('quiet');
  el.value.textContent = '…';
}

/** Recognizers that end phrases on their own (on-device) already waited out the pause; the gate then adds only a little. */
const voiceWait = () => patienceMs(settings.voicePatience);
const gateWait = (rec: SpeechRecognizer) => ({
  wait: () => (rec === whisper ? 250 : voiceWait()),
  longWait: () => (rec === whisper ? voiceWait() : Math.round(voiceWait() * 1.8)),
});

const STOP_WORDS = /^(?:stop(?: listening)?|that'?s all|i'?m done|done|finish(?:ed)?|pause)$/;
const CLEAR_WORDS = /^(?:clear(?: (?:it|all|that))?|start over|reset|new (?:calculation|one|sum)|scratch everything)$/;
const UNDO_WORDS = /^(?:undo|scratch that|go back|never ?mind|take that back)$/;
const commandWords = (text: string) => text.trim().toLowerCase().replace(/[.!?,]+$/g, '');

/**
 * Holds each spoken phrase until the speaker has finished (see patience.ts), then runs it once. Stop, undo and
 * start over don't wait: stop and undo first finish the phrase being held (its live result is already on screen,
 * so "undo" undoes its last step); start over drops it.
 */
let voiceRec: SpeechRecognizer = webSpeech;
const voiceGate = new PhraseGate({
  wait: () => gateWait(voiceRec).wait(),
  longWait: () => gateWait(voiceRec).longWait(),
  show(text) {
    el.input.value = text;
    previewChain(text);
  },
  instant(text) {
    const t = commandWords(text);
    if (STOP_WORDS.test(t)) {
      voiceGate.flush();
      stopListening();
    } else if (UNDO_WORDS.test(t)) {
      voiceGate.flush();
      voiceCommand(text);
    } else if (CLEAR_WORDS.test(t)) {
      voiceGate.cancel();
      el.input.value = '';
      voiceCommand(text);
    } else return false;
    return true;
  },
  commit(text) {
    el.input.value = text;
    if (voiceCommand(text)) el.input.value = '';
    else void runChain(text, true);
    // Without "keep listening", one phrase per tap of the mic.
    if (listening && !settings.continuousListening) stopListening();
  },
});

function startListening() {
  synth.cancel();
  wantListening = true;
  setListening(true);
  const recognizer = recognizerFor();
  voiceRec = recognizer;
  recognizer.start(
    {
      lang: settings.voiceLang,
      // Browser recognition always listens continuously so the app, not the browser, decides when a phrase is over
      // (browsers cut people off mid-sentence); without "keep listening" the mic stops after the first phrase.
      continuous: settings.continuousListening || recognizer === webSpeech,
      preferOnDevice: settings.preferOnDevice,
      patienceMs: voiceWait(),
    },
    {
      onPartial: (text) => voiceGate.partial(text),
      onFinal: (text) => voiceGate.final(text),
      onEnd() {
        // Browsers end continuous sessions after a pause; resume if the user still wants hands-free mode.
        if (wantListening && settings.continuousListening) return startListening();
        voiceGate.flush();
        wantListening = false;
        setListening(false);
      },
      onError(message) {
        wantListening = false;
        setListening(false);
        toast(message);
      },
      onStatus: setStatus,
      onLevel: setLevel,
    },
  );
}

function stopListening() {
  wantListening = false;
  voiceGate.flush();
  webSpeech.stop();
  whisper.stop();
  setListening(false);
}

function toggleListening() {
  if (!recognizerFor().supported) return toast('Voice input isn’t supported in this browser. Try Chrome, Edge or Safari.');
  if (listening) stopListening();
  else startListening();
}

// ---------- keypad ----------
/** Basic: a four-function keypad. Scientific uses the math keyboard (apps/web/src/keyboard, a lazy chunk). */
const KEYS: [label: string, insert: string, cls?: string, aria?: string][] = [
  ['AC', 'act:clear', 'op', 'Clear'], ['(', '(', 'op'], [')', ')', 'op'], ['%', '%', 'op', 'Percent'], ['⌫', 'act:back', 'op', 'Delete'],
  ['7', '7'], ['8', '8'], ['9', '9'], ['÷', '/', 'op', 'Divide'], ['√', 'sqrt(', 'op', 'Square root'],
  ['4', '4'], ['5', '5'], ['6', '6'], ['×', '*', 'op', 'Times'], ['½⇔.5', 'act:sd', 'op', 'Fraction or decimal'],
  ['1', '1'], ['2', '2'], ['3', '3'], ['−', '-', 'op', 'Minus'], ['=', 'act:eq', 'eq tall2', 'Equals'],
  ['±', 'act:neg', 'op', 'Change sign'], ['0', '0'], ['.', '.', '', 'Point'], ['+', '+', 'op', 'Plus'],
];

type CalcMode = Settings['calcMode'];
let calcMode: CalcMode = settings.calcMode;
el.input.placeholder = idlePlaceholder();
/** Scientific keypad hidden by "Hide keypad" for this visit (the mode is the keypad, so it isn't a setting). */
let sciKeypadHidden = false;
const MEMORY_KEY = 'lemma.memory.v1';
let memory = (() => {
  try {
    return localStorage.getItem(MEMORY_KEY) ?? '';
  } catch {
    return '';
  }
})();

// The math keyboard and answer forms (fraction ⇄ decimal, mixed, exact) load on first use.
type KbModule = typeof import('./keyboard');
let kbModule: Promise<KbModule> | null = null;
let forms: import('./keyboard').Forms | null = null;
let sciKb: import('./keyboard').MathKeyboard | null = null;
let dock: import('./keyboard').Dock | null = null;
/** The calculation on screen, so S⇔D can switch it even before the forms module has loaded. */
let lastCalc: import('@lemma/math-core').CalcSuccess | null = null;
function loadKeyboard(): Promise<KbModule> {
  kbModule ??= import('./keyboard').then((m) => {
    forms ??= m.formsController(el.value);
    if (lastCalc && !el.value.classList.contains('switchable')) forms.hook(lastCalc);
    return m;
  });
  kbModule.catch(() => (kbModule = null));
  return kbModule;
}
const kbAngle = { get: () => settings.angle, toggle: () => el.angle.click(), watch: el.angle };
/** Graph rows and notebook cells get the keyboard as a dock with a small button to open it. */
function syncDock() {
  const want = calcMode === 'graphing' || document.documentElement.classList.contains('notebook-open');
  if (!want && !dock) return;
  void loadKeyboard().then((m) => {
    dock ??= m.createDock({
      accepts: (f) => !!f.closest('.gw, .nb, .notebook') && !f.closest('.mx'),
      fallback: () => null,
      openSymbols: (f) => openSymbolMenu(f ?? undefined),
      angle: kbAngle,
      clearScope: (f) => (f.closest('.gw') ? 'rows' : 'field'),
      clearRows: () => {
        // Through the rows' own delete buttons, so the workspace stays in charge of its rows.
        const dels = [...document.querySelectorAll<HTMLButtonElement>('.gw .gw-del')];
        dels.reverse().forEach((d) => d.click());
        const left = document.querySelector<HTMLInputElement>('.gw .gw-input');
        if (left && left.value) {
          left.value = '';
          left.dispatchEvent(new Event('input', { bubbles: true }));
        }
        left?.focus();
      },
    });
    dock.setAvailable(calcMode === 'graphing' || document.documentElement.classList.contains('notebook-open'));
  });
}

function deleteBack() {
  const i = el.input;
  const s = i.selectionStart ?? i.value.length;
  const e = i.selectionEnd ?? s;
  if (s !== e) i.setRangeText('', s, e, 'end');
  else if (s > 0) i.setRangeText('', s - 1, s, 'end');
  preview();
}

/** The value on screen for memory keys: what's typed if it calculates, else the last answer. */
function currentValue(): InstanceType<typeof D> | null {
  if (el.input.value.trim()) {
    const { outcome } = evaluateNow();
    if (outcome.kind === 'calc') return outcome.result.value;
    if (outcome.kind === 'answer' && outcome.result.value) return outcome.result.value;
  }
  return session.ans;
}

function setMemory(v: string) {
  memory = v;
  try {
    if (v) localStorage.setItem(MEMORY_KEY, v);
    else localStorage.removeItem(MEMORY_KEY);
  } catch {
    // Memory lasts for this visit only.
  }
  el.keypad.querySelectorAll('.mem').forEach((k) => k.classList.toggle('has', !!memory));
}

function keyAction(action: string) {
  switch (action) {
    case 'eq':
      return submit();
    case 'back':
      return deleteBack();
    case 'clear':
      if (!el.input.value) return clearScreen();
      el.input.value = '';
      return preview();
    case 'angle':
      return el.angle.click();
    case 'neg': {
      const v = el.input.value.trim();
      // ± toggles: nothing → "-", "-" → nothing, "-(…)" → "…", "-7" → "7", anything else → "-(…)".
      el.input.value = !v ? '-' : v === '-' ? '' : /^-\(.*\)$/.test(v) ? v.slice(2, -1) : /^-[\d.]+$/.test(v) ? v.slice(1) : /^[\d.]+$/.test(v) ? `-${v}` : `-(${v})`;
      el.input.setSelectionRange(el.input.value.length, el.input.value.length);
      return preview();
    }
    case 'sd':
      return void loadKeyboard().then(() => forms!.cycle() || toast('This answer has no other form'));
    case 'm+':
    case 'm-': {
      const v = currentValue();
      if (!v) return toast('Nothing to add to memory yet');
      const m = memory ? new D(memory) : new D(0);
      setMemory((action === 'm+' ? m.plus(v) : m.minus(v)).toString());
      return toast(`Memory: ${formatNumber(new D(memory), { digits: settings.digits, grouping: settings.grouping }).display}`);
    }
    case 'mr':
      return memory ? insertAtCursor(memory.startsWith('-') ? `(${memory})` : memory) : toast('Memory is empty');
    case 'mc':
      setMemory('');
      return toast('Memory cleared');
  }
}

function buildKeypad() {
  const sci = calcMode === 'scientific';
  el.keypad.classList.toggle('sci', sci);
  el.keypad.setAttribute('aria-label', sci ? 'Scientific keyboard' : 'Keypad');
  if (sci) {
    if (!sciKb || sciKb.root.parentElement !== el.keypad) el.keypad.replaceChildren();
    void loadKeyboard().then((m) => {
      if (calcMode !== 'scientific') return;
      sciKb = m.scientific(el.keypad, {
        input: el.input,
        enter: () => el.form.requestSubmit(),
        action: keyAction,
        openSymbols: (f) => openSymbolMenu(f ?? el.input),
        angle: kbAngle,
      });
      sciKb.setShown(!el.keypad.hidden);
      setMemory(memory);
    });
    return;
  }
  el.keypad.replaceChildren(
    ...KEYS.map(([label, insert, cls, aria]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `key ${cls ?? ''}`.trim();
      b.textContent = label;
      b.setAttribute('aria-label', aria ?? label);
      if (insert.startsWith('act:')) b.dataset.act = insert.slice(4);
      else b.dataset.insert = insert;
      return b;
    }),
  );
}

// One listener for every key. pointerdown keeps focus (and the mobile keyboard state) on the input.
const pressKey = (b: HTMLButtonElement) => {
  if (b.dataset.act) return keyAction(b.dataset.act);
  if (b.dataset.insert) insertAtCursor(b.dataset.insert);
};
/** A key a finger already pressed on touch-down: its click (on lift) mustn't press it again. */
let pressedOnDown: HTMLButtonElement | null = null;
el.keypad.addEventListener('pointerdown', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('.key');
  if (!b) return;
  e.preventDefault();
  // Fingers: the key acts the moment it's touched, like a real calculator (a tap's click only comes on lift,
  // 50–100 ms later). A mouse keeps the usual click.
  if (e.pointerType !== 'mouse' && !b.disabled) {
    pressedOnDown = b;
    pressKey(b);
  }
});
el.keypad.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('.key');
  if (!b) return;
  if (pressedOnDown === b) {
    pressedOnDown = null;
    // Already pressed on touch-down; keep the cursor in the input if the phone moved it when the touch ended.
    if (document.activeElement !== el.input) el.input.focus({ preventScroll: true });
    return;
  }
  pressedOnDown = null;
  pressKey(b);
});

function applyKeypad() {
  const sci = calcMode === 'scientific';
  const shown = calcMode !== 'graphing' && calcMode !== 'matrix' && (sci ? !sciKeypadHidden : settings.showKeypad);
  el.keypad.hidden = !shown;
  el.toggleKeypad.textContent = shown ? 'Hide keypad' : 'Keypad';
  // On touch devices the keypad replaces the system keyboard for quick entry (the Scientific keyboard decides itself).
  if (sci) sciKb?.setShown(shown);
  else el.input.inputMode = shown && matchMedia('(pointer: coarse)').matches ? 'none' : 'text';
}

// ---------- calculator modes ----------
/** What each calculator mode was showing: its own input and last result. */
const modeState: Record<'basic' | 'scientific', { input: string; last: { outcome: Outcome; ms: number; expr: string } | null }> = {
  basic: { input: '', last: null },
  scientific: { input: '', last: null },
};
let workspace: Promise<import('./graphing/workspace').GraphingWorkspace> | null = null;

function getWorkspace() {
  return (workspace ??= import('./graphing/workspace').then(({ GraphingWorkspace }) => {
    const ws = new GraphingWorkspace({ session, openSymbols: (f) => openSymbolMenu(f) });
    el.modes.after(ws.root);
    ws.root.hidden = calcMode !== 'graphing';
    return ws;
  }));
}

let matrixMode: Promise<import('./matrix/mode').MatrixMode> | null = null;
function getMatrixMode() {
  matrixMode ??= import('./matrix/mode').then(({ MatrixMode }) => {
    const mm = new MatrixMode({ angle: kbAngle, openSymbols: (f) => openSymbolMenu(f ?? undefined), toast });
    el.modes.after(mm.root);
    mm.root.hidden = calcMode !== 'matrix';
    return mm;
  });
  matrixMode.catch(() => (matrixMode = null));
  return matrixMode;
}

function setMode(next: CalcMode, focus = true) {
  const prev = calcMode;
  if (next === prev && document.getElementById('app')!.dataset.mode === next) return;
  if ((prev === 'basic' || prev === 'scientific') && prev !== next) modeState[prev] = { input: el.input.value, last: lastCommitted as (typeof modeState)['basic']['last'] };
  calcMode = next;
  if (settings.calcMode !== next) {
    settings.calcMode = next;
    saveSettings(settings);
  }
  const app = document.getElementById('app')!;
  app.dataset.mode = next;
  el.modes.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
    const on = b.dataset.mode === next;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  if (next !== 'graphing') void workspace?.then((ws) => (ws.root.hidden = true));
  if (next !== 'matrix') void matrixMode?.then((mm) => (mm.root.hidden = true));
  syncDock();
  if (!assistantMode) el.input.placeholder = idlePlaceholder();
  if (next === 'graphing') {
    void getWorkspace().then((ws) => {
      if (calcMode !== 'graphing') return;
      ws.root.hidden = false;
      if (focus) ws.focus();
    });
  } else if (next === 'matrix') {
    applyKeypad();
    void getMatrixMode().then((mm) => {
      if (calcMode !== 'matrix') return;
      mm.root.hidden = false;
      if (focus) mm.focus();
    });
  } else {
    if (prev !== next) {
      const st = modeState[next];
      dropGraph();
      el.input.value = st.input;
      lastCommitted = st.last;
      recallIndex = -1;
    }
    buildKeypad();
    applyKeypad();
    // This mode's own last answer goes up first, so a half-typed input fades over it, not over the other mode's.
    if (prev !== next) {
      const typed = el.input.value;
      el.input.value = '';
      render({ kind: 'empty' }, 'preview');
      el.input.value = typed;
    }
    if (el.input.value) preview();
    else render({ kind: 'empty' }, 'preview');
    if (focus) el.input.focus({ preventScroll: true });
  }
  if (prev !== next) play(mainEl, [{ opacity: 0.6 }, { opacity: 1 }], D2, 'panels');
}

el.modes.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('[data-mode]');
  if (b) setMode(b.dataset.mode as CalcMode);
});
el.modes.addEventListener('keydown', (e) => {
  const order: CalcMode[] = ['basic', 'scientific', 'graphing', 'matrix'];
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
  if (!step) return;
  e.preventDefault();
  const next = order[(order.indexOf(calcMode) + step + order.length) % order.length]!;
  setMode(next, false);
  el.modes.querySelector<HTMLButtonElement>(`[data-mode="${next}"]`)?.focus();
});

// ---------- symbols ----------
/** The text field the person was last typing in (calculator, a graph row, a notebook cell…): symbols go there. */
let lastField: HTMLInputElement | HTMLTextAreaElement = el.input;
document.addEventListener('focusin', (e) => {
  const t = e.target;
  if (!(t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && t.type === 'text'))) return;
  if (t.closest('#symbols, #settings, .sym-form')) return;
  lastField = t;
});

function openSymbolMenu(field?: HTMLInputElement | HTMLTextAreaElement) {
  const visible = (f: HTMLElement) => f.isConnected && f.offsetParent !== null;
  const target = field ?? (visible(lastField) ? lastField : el.input);
  void import('./symbols/menu').then(
    (m) => m.openSymbols(target, () => target === el.input && preview()),
    () => toast('Symbols couldn’t load. Check your connection'),
  );
}
el.openSymbols.addEventListener('pointerdown', (e) => e.preventDefault());
el.openSymbols.addEventListener('click', () => openSymbolMenu(el.input));

// ---------- settings ----------
function applyTheme() {
  applyLook(settings);
  $('motion-more').hidden = settings.motion === 'calm';
  document.documentElement.dataset.working = settings.working;
  if (settings.showDetails) document.documentElement.dataset.details = 'on';
  else delete document.documentElement.dataset.details;
  renderLooks();
}

/** Theme cards in Settings → Look: one per look, drawn with its own colours. */
function renderLooks() {
  const box = document.getElementById('looks');
  if (!box) return;
  box.replaceChildren(
    ...LOOK_OPTIONS.map(({ id, label }) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'look';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(settings.look === id));
      const [bg, surface, accent] = swatch(id, settings);
      b.style.setProperty('--sw-bg', bg);
      b.style.setProperty('--sw-surface', surface);
      b.style.setProperty('--sw-accent', accent);
      const art = document.createElement('span');
      art.className = 'look-art';
      art.setAttribute('aria-hidden', 'true');
      art.append(document.createElement('i'), document.createElement('b'));
      const name = document.createElement('span');
      name.textContent = label;
      b.append(art, name);
      b.addEventListener('click', () => {
        settings.look = id as LookId;
        settings.accent = '';
        saveSettings(settings);
        void viewTransition(() => {
          applyTheme();
          syncAccent();
        }, 'panels');
      });
      return b;
    }),
  );
}

function syncAccent() {
  const input = document.getElementById('accent') as HTMLInputElement | null;
  if (input) input.value = settings.accent || getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || LOOKS.comfy.light.accent;
}

function applyAngle() {
  session.angle = settings.angle;
  el.angle.textContent = settings.angle.toUpperCase();
  const key = el.keypad.querySelector('[data-act="angle"]');
  if (key) key.textContent = el.angle.textContent;
}

function bindSettings() {
  const form = el.settings.querySelector('form')!;
  const fields = form.elements;
  const sync = () => {
    for (const [key, value] of Object.entries(settings)) {
      const f = fields.namedItem(key) as HTMLInputElement | HTMLSelectElement | null;
      if (!f || key === 'accent') continue;
      if (f instanceof HTMLInputElement && f.type === 'checkbox') f.checked = Boolean(value);
      else f.value = String(value);
    }
  };
  form.addEventListener('input', (e) => {
    const f = e.target as HTMLInputElement | HTMLSelectElement;
    // Provider, model, URL and key are handled by the AI settings module.
    if (['aiKey', 'aiProvider', 'aiModel', 'aiBaseUrl'].includes(f.name)) return;
    const key = f.name as keyof Settings;
    if (!(key in settings)) return;
    const current = settings[key];
    const next = f instanceof HTMLInputElement && f.type === 'checkbox' ? f.checked : typeof current === 'number' ? Number(f.value) : f.value;
    (settings as unknown as Record<string, unknown>)[key] = next;
    saveSettings(settings);
    // Light ↔ dark crossfades; the rest of the look applies at once.
    if (key === 'theme') void viewTransition(applyTheme, 'panels');
    else if (['accent', 'font', 'textSize', 'density', 'corners', 'showDetails', 'working'].includes(key) || key.startsWith('motion')) applyTheme();
    if (key === 'showKeypad') {
      // In Scientific the keypad is part of the mode; the setting shows or hides it there too.
      if (calcMode === 'scientific') sciKeypadHidden = !next;
      applyKeypad();
    }
    if (key === 'inputHints' && !assistantMode) el.input.placeholder = idlePlaceholder();
    if (key === 'calcMode') setMode(next as CalcMode, false);
    if (key === 'aiEnabled') syncAiFields();
    if (key === 'continuousListening') applyLoop();
    if (key.startsWith('ai')) applyAi();
    if (key === 'voiceEngine') {
      el.voiceNote.textContent = recognizerFor().privacyNote;
      el.mic.disabled = !recognizerFor().supported;
    }
    if (key === 'angle') applyAngle();
    if (key === 'keepHistory' && !next) {
      saveHistory([]);
    }
    if (key === 'digits' || key === 'grouping' || key === 'angle' || key === 'currency') refreshShown();
  });
  let aiSync: (() => void) | null = null;
  bindSettingsIndex();
  el.openSettings.addEventListener('click', () => {
    sync();
    syncAiFields();
    if (aiSync) aiSync();
    else
      void import('./assistant/settings-ui').then(({ bindAiSettings }) => {
        aiSync = bindAiSettings(form, settings, applyAi);
      });
    el.voiceNote.textContent = recognizerFor().privacyNote;
    renderLooks();
    syncAccent();
    el.settings.showModal();
    $('set-body').dispatchEvent(new Event('scroll'));
  });
  el.settings.addEventListener('click', (e) => {
    if (e.target === el.settings) el.settings.close();
  });
}

// Tips: everything you can say or type that has no button of its own. Tapping one puts it in the input.
{
  const tips = $<HTMLDialogElement>('tips');
  $('open-tips').addEventListener('click', () => tips.showModal());
  tips.addEventListener('click', (e) => {
    if (e.target === tips) return tips.close();
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-try]');
    if (!b) return;
    tips.close();
    el.input.value = b.dataset.try!;
    el.input.focus();
    el.input.dispatchEvent(new Event('input'));
  });
  if (!desktop) tips.querySelectorAll('.desktop-only').forEach((n) => n.remove());
}

const syncAiFields = () => ($('ai-fields').hidden = !settings.aiEnabled);

/** The section index at the top of Settings: jumps to a section and follows the scroll. */
function bindSettingsIndex() {
  const index = $('set-index');
  const body = $('set-body');
  const mark = (id: string) => index.querySelectorAll<HTMLElement>('button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.to === id)));
  // While a jump scrolls, the chosen section stays marked.
  let jumped = 0;
  index.addEventListener('click', (e) => {
    const to = (e.target as Element).closest<HTMLElement>('button')?.dataset.to;
    if (!to) return;
    jumped = performance.now();
    $(to).scrollIntoView({ block: 'start', behavior: moves('panels') ? 'smooth' : 'auto' });
    mark(to);
  });
  body.addEventListener(
    'scroll',
    () => {
      if (performance.now() - jumped < 600) return;
      const sets = [...body.querySelectorAll<HTMLElement>('.set')];
      const top = body.getBoundingClientRect().top + 48;
      let current = sets[0]!.id;
      for (const s of sets) if (s.getBoundingClientRect().top <= top) current = s.id;
      if (body.scrollTop > 0 && body.scrollTop + body.clientHeight >= body.scrollHeight - 2) current = sets.at(-1)!.id;
      mark(current);
    },
    { passive: true },
  );
}

// ---------- wiring ----------
el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = el.input.value;
  if (/^\s*(?:open (?:the |a |my )?)?(?:white ?board|canvas)\s*$/i.test(text)) {
    el.input.value = '';
    return openWhiteboard();
  }
  if (!assistantMode && labRequest(text)) {
    el.input.value = '';
    return;
  }
  if (!assistantMode && lessonRequest(text)) {
    el.input.value = '';
    return;
  }
  if (!assistantMode && agendaRequest(text)) {
    el.input.value = '';
    return;
  }
  if (!assistantMode && /^\s*(?:load|preload|download|get ready|warm up)\s+(?:everything|it all|all(?: of it)?)(?: now)?\s*$/i.test(text)) {
    el.input.value = '';
    toast('Loading everything in the background…');
    void warmUp().then((r) => toast(Object.values(r).includes('failed') ? 'Some parts couldn’t load. See Settings → Data' : 'Everything is loaded: no first-time waits'));
    return;
  }
  if (!assistantMode && splitChain(text).length > 1) void runChain(text, false);
  else submit();
});

el.input.addEventListener('input', () => {
  recallIndex = -1;
  preview();
  // Something symbolic is being typed: start the algebra engine now, so it's ready by the time Enter is pressed.
  if (!symbolicClient().ready && LOOKS_SYMBOLIC.test(el.input.value)) void loadAdvanced().then(() => symbolicClient().warm(), () => {});
});

el.input.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (el.form.classList.contains('busy')) {
      void assistant?.then((a) => a.stop());
      return;
    }
    if (el.input.value) {
      el.input.value = '';
      preview();
    } else if (listening) stopListening();
    else clearScreen();
    return;
  }
  // Recall earlier inputs, shell-style.
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && history.length) {
    if (e.key === 'ArrowUp' && (el.input.value === '' || recallIndex >= 0)) recallIndex = Math.min(recallIndex + 1, history.length - 1);
    else if (e.key === 'ArrowDown' && recallIndex >= 0) recallIndex--;
    else return;
    e.preventDefault();
    const text = recallIndex >= 0 ? history[recallIndex]!.input : '';
    el.input.value = text;
    el.input.setSelectionRange(text.length, text.length);
    preview();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.altKey && e.code === 'KeyM') {
    e.preventDefault();
    toggleListening();
  } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyN') {
    e.preventDefault();
    void showNotebook(mainEl.hidden === false);
  } else if (e.altKey && !e.metaKey && !e.ctrlKey && /^Digit[1234]$/.test(e.code) && calculatorInFront()) {
    e.preventDefault();
    setMode((['basic', 'scientific', 'graphing', 'matrix'] as const)[Number(e.code.slice(5)) - 1]!);
  } else if (e.altKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyS' && !document.querySelector('#symbols[open]:not(.closing), dialog.drawer[open]:not(.closing)')) {
    e.preventDefault();
    openSymbolMenu();
  } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === 'KeyK' && !document.documentElement.matches('.wb-open, .ex-open') && !document.querySelector('dialog[open]:not(.closing)')) {
    // Anywhere but over the whiteboard or a running exam (which have their own Done / exit), notebook included.
    e.preventDefault();
    void import('./study').then((m) => m.openStudy(studyHost(), { search: true }));
  } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyC') {
    e.preventDefault();
    copyResult();
  } else if (padKey(e)) {
    e.preventDefault();
  } else if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && document.activeElement !== el.input && !typingElsewhere(e.target) && calculatorInFront()) {
    e.preventDefault();
    el.input.focus();
  }
});

/** Characters a calculator key can type. The number pad's / types a division; the main / still jumps to the input. */
const PAD_CHARS = /^[0-9+\-*.,()^%=!]$/;

/**
 * Typing on the calculator without clicking the input first: digits, operators and the number pad type into it,
 * Enter (on the pad, or with nothing focused) works it out, Backspace deletes, and Clear (Num Lock) empties it.
 * Returns true when it handled the key.
 */
function padKey(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing || !calculatorInFront()) return false;
  const inInput = document.activeElement === el.input;
  if (!inInput && typingElsewhere(e.target)) return false;
  const insert = (text: string) => {
    if (!inInput) el.input.focus();
    const [a, b] = inInput ? [el.input.selectionStart ?? el.input.value.length, el.input.selectionEnd ?? el.input.value.length] : [el.input.value.length, el.input.value.length];
    el.input.setRangeText(text, a, b, 'end');
    el.input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  // With Num Lock off the pad sends End, ArrowDown…; on a calculator it still means numbers.
  const padDigit = /^Numpad(\d)$/.exec(e.code)?.[1] ?? (e.code === 'NumpadDecimal' ? '.' : null);
  if (padDigit && e.key !== padDigit && e.key !== ',' && !e.shiftKey) return insert(padDigit), true;
  if (inInput) return false;
  const pad = e.code.startsWith('Numpad');
  const nothingFocused = !document.activeElement || document.activeElement === document.body;
  if (e.code === 'NumpadDivide') insert('/');
  else if (PAD_CHARS.test(e.key)) insert(e.key);
  else if (e.key === 'Enter' && (pad || nothingFocused)) {
    if (!el.input.value.trim()) return false;
    el.input.focus();
    el.form.requestSubmit();
  } else if (e.key === 'Backspace' && (pad || nothingFocused) && el.input.value) {
    el.input.value = el.input.value.slice(0, -1);
    el.input.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (e.key === 'Clear') {
    el.input.value = '';
    el.input.dispatchEvent(new Event('input', { bubbles: true }));
  } else return false;
  return true;
}

/** True when a key lands in some other text field (a practice answer, a note, a notebook cell…). */
function typingElsewhere(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  if (t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true;
  return t instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'range', 'color', 'submit', 'reset', 'file', 'image'].includes(t.type);
}
/** The calculator is the visible surface: no dialog, notebook, whiteboard or exam on top of it. */
const calculatorInFront = () => !mainEl.hidden && !el.input.closest('[inert]') && !document.querySelector('dialog[open]:not(.closing)');

el.mic.addEventListener('click', toggleListening);

el.angle.addEventListener('click', () => {
  settings.angle = settings.angle === 'deg' ? 'rad' : 'deg';
  saveSettings(settings);
  applyAngle();
  refreshShown();
  toast(settings.angle === 'deg' ? 'Angles in degrees' : 'Angles in radians');
});

async function copyResult() {
  const text = el.input.value.trim() ? textOf(evaluateNow().outcome) : lastCommitted ? textOf(lastCommitted.outcome) : screenCleared ? '' : (history[0]?.plain ?? '');
  if (!text) return toast('Nothing to copy yet');
  try {
    await navigator.clipboard.writeText(text);
    confirmPop(el.copy);
    toast(`Copied ${text}`);
  } catch {
    toast('Clipboard is unavailable here');
  }
}

function textOf(o: Outcome): string {
  if (o.kind === 'calc') return o.result.formatted.plain;
  if (o.kind === 'convert') return o.result.results[0]!.formatted.plain;
  if (o.kind === 'answer') return o.result.primary.plain;
  if (o.kind === 'graph') return o.input;
  return '';
}

el.copy.addEventListener('click', copyResult);

el.clearHistory.addEventListener('click', () => {
  // Clear is for Recent: pinned answers stay (unpin one to let it go).
  const gone = history.filter((h) => !h.pinned);
  if (!gone.length) return;
  history = history.filter((h) => h.pinned);
  if (settings.keepHistory) saveHistory(history);
  // The list fades out, then empties (the history itself is already gone).
  const fade = play(el.history, [{ opacity: 1 }, { opacity: 0 }], D2, 'answers', { fill: 'forwards' });
  const done = () => {
    renderHistory(false);
    fade?.cancel();
  };
  if (fade) fade.onfinish = done;
  else done();
  toast('History cleared', {
    label: 'Undo',
    run: () => {
      // Whatever was added since stays; the cleared answers come back in their places.
      const ids = new Set(history.map((h) => h.id));
      history = [...history, ...gone.filter((h) => !ids.has(h.id))].sort((x, y) => y.at - x.at);
      if (settings.keepHistory) saveHistory(history);
      renderHistory();
    },
  });
});

// Variables: a small "name = value" row; saving runs it like a typed assignment, so expressions and other variables work.
{
  const toggle = $<HTMLButtonElement>('toggle-vars');
  const form = $<HTMLFormElement>('var-editor');
  const nameIn = $<HTMLInputElement>('var-name');
  const valueIn = $<HTMLInputElement>('var-value');
  toggle.addEventListener('click', () => {
    form.hidden = !form.hidden;
    toggle.setAttribute('aria-expanded', String(!form.hidden));
    if (!form.hidden) nameIn.focus();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameIn.value.trim();
    const value = valueIn.value.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return toast('Use letters (and digits) for the name, like x or rate');
    if (!value) return valueIn.focus();
    // Worked out on its own: whatever is in the main input stays there, and a mistake stays here to fix.
    const { outcome } = evaluateNow(`${name} = ${value}`);
    // An engine still loading (first seconds after start-up): save once it's in.
    if (outcome.kind === 'pending') return void outcome.waitFor.then(() => form.requestSubmit(), () => toast('Couldn’t save that just now'));
    if (outcome.kind !== 'calc' || !(outcome.result.assignment || outcome.result.assignments)) {
      const why = outcome.kind === 'error' ? outcome.error.message : `${value} isn’t a number`;
      toast(why);
      return valueIn.focus();
    }
    commitCalc(session, outcome.result);
    persistVars();
    toast(`${name} = ${outcome.result.formatted.display}`);
    nameIn.value = '';
    valueIn.value = '';
    nameIn.focus();
  });
}

el.toggleKeypad.addEventListener('click', () => {
  if (calcMode === 'scientific') sciKeypadHidden = !sciKeypadHidden;
  else {
    settings.showKeypad = !settings.showKeypad;
    saveSettings(settings);
  }
  applyKeypad();
  el.input.focus();
});

// ---------- continuous voice: chained calculations ----------
interface TapeStep {
  entry: HistoryEntry;
  before: { ans: typeof session.ans; base: typeof session.base };
}
let tapeSteps: TapeStep[] = [];
const tapeOn = () => !el.tape.hidden;

function showTape() {
  el.tape.hidden = false;
  el.tapeStatus.textContent = listening ? 'Listening' : 'Running total';
}

function addTapeStep(entry: HistoryEntry, before: TapeStep['before']) {
  tapeSteps.push({ entry, before });
  const li = document.createElement('li');
  const q = document.createElement('span');
  q.className = 'tape-q';
  q.textContent = entry.input;
  const v = document.createElement('span');
  v.className = 'tape-v';
  v.textContent = entry.display;
  li.append(q, v);
  el.tapeSteps.append(li);
  li.scrollIntoView({ block: 'nearest', behavior: settings.motion === 'calm' ? 'auto' : 'smooth' });
}

function clearTape(fresh: boolean) {
  tapeSteps = [];
  el.tapeSteps.replaceChildren();
  if (fresh) {
    session.ans = null;
    session.base = null;
    lastCommitted = null;
    screenCleared = true;
    render({ kind: 'empty' }, 'preview');
    el.expr.textContent = ' ';
    el.value.textContent = '0';
    el.value.classList.add('quiet');
  }
  if (!listening) el.tape.hidden = true;
}

function undoTapeStep() {
  const last = tapeSteps.pop();
  if (!last) return toast('Nothing to undo');
  el.tapeSteps.lastElementChild?.remove();
  session.ans = last.before.ans;
  session.base = last.before.base;
  history = history.filter((h) => h !== last.entry);
  // The removed result must not come back as "the last result" when the input is next emptied.
  lastCommitted = null;
  if (!tapeSteps.length) screenCleared = true;
  if (settings.keepHistory) saveHistory(history);
  renderHistory();
  const prev = tapeSteps.at(-1)?.entry;
  el.expr.textContent = prev ? prev.input : ' ';
  el.value.textContent = prev ? prev.display : '0';
  toast(`Removed “${last.entry.input}”`);
}

/** Every way people name a teaching style ("real-world story", "test prep", "ELI5"…) → its id. */
const LESSON_STYLES: Record<string, import('@lemma/tutor-engine').StyleId> = {
  chalkboard: 'chalkboard', blackboard: 'chalkboard', chalk: 'chalkboard',
  marker: 'marker', 'marker notes': 'marker', whiteboard: 'marker', notes: 'marker',
  visual: 'visual', 'visual intuition': 'visual', picture: 'visual', pictures: 'visual', graphs: 'visual',
  lecture: 'lecture', professor: 'lecture', classroom: 'lecture', thorough: 'lecture',
  socratic: 'socratic', questions: 'socratic', 'question and answer': 'socratic',
  exam: 'exam', 'exam prep': 'exam', 'test prep': 'exam', 'test': 'exam',
  quick: 'quick', 'quick tip': 'quick', short: 'quick', fast: 'quick',
  beginner: 'beginner', 'beginner friendly': 'beginner', simple: 'beginner', easy: 'beginner', eli5: 'beginner', 'plain english': 'beginner',
  proof: 'proof', 'proof first': 'proof', rigorous: 'proof', advanced: 'proof',
  story: 'story', 'real world': 'story', 'real world story': 'story', storytelling: 'story',
};

/**
 * "make a lecture on the chain rule", "teach me percentages in exam style", "explain 2x + 3 = 11 in chalkboard style":
 * opens the lesson maker. Returns false when the text isn't a lesson request.
 */
function lessonRequest(text: string): boolean {
  const t = text.trim().replace(/[.!?]+$/, '');
  const sm = /\s+(?:in|with|as)\s+(?:a |an |the )?([a-z][a-z -]*?)(?:[- ](?:style|mode|version|format|way|lesson|video))?$/i.exec(t);
  const style = sm ? LESSON_STYLES[sm[1]!.toLowerCase().replace(/[- ]+/g, ' ').trim()] : undefined;
  // "in the morning" isn't a style: only strip the phrase when it names one.
  const rest = sm && style ? t.slice(0, sm.index) : t;
  const lec = /^(?:make|create|give me|show me|play)?\s*(?:a |an )?(?:lecture|lesson|video|class)\s+(?:on|about)\s+(.+)$|^teach me(?: about)?\s+(.+)$/i.exec(rest);
  if (lec) {
    openTool('video', { lecture: (lec[1] ?? lec[2])!.trim(), style });
    return true;
  }
  const exp = /^(?:explain|walk me through|make a video (?:of|for|explaining))\s+(.+)$/i.exec(rest);
  if (exp && style) {
    openTool('video', { query: exp[1]!.trim(), style });
    return true;
  }
  return false;
}

/**
 * "add a task: problem set 4 due Friday", "add chapter 5 reading to my agenda", "add essay due monday": a study
 * agenda task, not arithmetic. Needs a task word, the agenda, or a due date, so "add 5 and 3" stays math.
 */
function agendaRequest(text: string): boolean {
  const t = text.trim();
  const m =
    /^(?:add|new|create)\s+(?:a\s+|an\s+)?(?:task|assignment|to-?do)\s*:?\s+(.+)$/i.exec(t) ??
    /^(?:add|put)\s+(.+?)\s+(?:to|on|in)\s+(?:my\s+|the\s+)?(?:agenda|planner|study plan)$/i.exec(t) ??
    /^add\s+((?=.*[a-z]{3})(?!.*\d\s*(?:and|plus|\+)\s*\d).+\s+due\s+.+)$/i.exec(t);
  if (!m) return false;
  void import('./agenda').then((a) => {
    const r = a.addTaskFromText(m[1]!);
    if ('ask' in r) toast(r.ask);
    else toast(`Added to your agenda: ${r.task.title}`);
  });
  return true;
}

/**
 * "simulate a projectile at 20 m/s 45 degrees" opens the physics lab on that preset; "open geometry" opens the
 * geometry canvas. Kept to two regexes so the calculator bundle doesn't carry either tool.
 */
function labRequest(text: string): boolean {
  const t = text.trim();
  // "simulate 10000: …" / "simulate 5000 …" is a Monte Carlo run for the calculator, not the lab (same test as the router).
  if (/^\s*simulate\b(?:[^:]*:|\s+\d)/i.test(t)) return false;
  if (/^(?:(?:please\s+)?(?:simulate|simulation of)\b|(?:open|show)(?: the)? physics(?: lab)?$|physics lab$)/i.test(t)) {
    openTool('physics', { query: t });
    return true;
  }
  if (/^(?:open (?:the |a )?)?(?:geometry|geometry canvas|dynamic geometry)$/i.test(t)) {
    openTool('geometry');
    return true;
  }
  return false;
}

/** Spoken control words while listening. Returns true when the phrase was a command, not math. */
function voiceCommand(text: string): boolean {
  const t = commandWords(text);
  if (STOP_WORDS.test(t)) {
    stopListening();
    return true;
  }
  if (CLEAR_WORDS.test(t)) {
    // After any phrase still running (a step waiting on an engine), never before it.
    chainQueue = chainQueue.then(() => {
      clearTape(true);
      toast('Starting fresh');
    });
    return true;
  }
  if (lessonRequest(text) || labRequest(text)) {
    stopListening();
    return true;
  }
  if (agendaRequest(text)) return true;
  if (/^(?:open (?:the |a |my )?)?(?:white ?board|canvas)$/.test(t)) {
    // Asked by voice: the board listens too, and the calculator picks up again when it closes.
    openWhiteboard(true);
    return true;
  }
  if (UNDO_WORDS.test(t)) {
    chainQueue = chainQueue.then(() => undoTapeStep());
    return true;
  }
  return false;
}

/** Runs "5 plus 3 then times 2 then minus 4" as steps, each continuing from the last result. */
let chainQueue: Promise<void> = Promise.resolve();
/** Chains run one at a time, in the order they were spoken: a step waiting on a lazy engine holds back the next phrase. */
function runChain(text: string, fromVoice: boolean): Promise<void> {
  chainQueue = chainQueue.then(() => runChainNow(text, fromVoice)).catch(() => undefined);
  return chainQueue;
}

async function runChainNow(text: string, fromVoice: boolean) {
  const steps = splitChain(text);
  if (steps.length > 1 && el.tape.hidden) showTape();
  // Clear first so each step renders as a committed result rather than a preview of the whole chain.
  if (el.input.value === text) el.input.value = '';
  for (const step of steps) {
    let { outcome } = evaluateNow(step);
    for (let tries = 0; outcome.kind === 'pending' && tries < 8; tries++) {
      await outcome.waitFor.catch(() => undefined);
      outcome = evaluateNow(step).outcome;
    }
    submit(fromVoice, step);
    if (outcome.kind === 'error') break;
  }
  if (el.input.value === text || steps.includes(el.input.value)) el.input.value = '';
}

/** Live preview while speaking: for a chain, the running result of all its steps on a scratch copy of the session. */
/**
 * Half-heard words never show an error: a quiet result only when what's heard so far makes sense, otherwise just the
 * words. Nothing here is read aloud.
 */
function previewChain(text: string) {
  if (assistantMode) return;
  const steps = splitChain(text);
  const scratch = { ...session, vars: new Map(session.vars), fns: new Map(session.fns) };
  let last: Outcome | null = null;
  for (const step of steps) {
    const o = route(step, scratch, routeOptions());
    if (o.kind === 'pending') {
      // An engine is loading: show the words now, the result when it lands (if they're still the words heard).
      o.waitFor.then(
        () => el.input.value === text && listening && previewChain(text),
        () => undefined,
      );
      if (!last) return showHeard(text);
      break;
    }
    if (o.kind === 'calc') commitCalc(scratch, o.result);
    else if (o.kind === 'answer' && o.result.value) scratch.ans = scratch.base = o.result.value;
    else if (o.kind === 'convert') scratch.ans = o.result.results[0]!.value;
    else if (!(o.kind === 'answer' && o.result.kind !== 'hint' && steps.length === 1)) break;
    last = o;
  }
  if (last) render(last, 'preview');
  else showHeard(text);
}

function applyLoop() {
  el.loop.setAttribute('aria-pressed', String(settings.continuousListening));
  el.loop.classList.toggle('on', settings.continuousListening);
}

el.loop.addEventListener('click', () => {
  settings.continuousListening = !settings.continuousListening;
  saveSettings(settings);
  applyLoop();
  const box = el.settings.querySelector<HTMLInputElement>('input[name="continuousListening"]');
  if (box) box.checked = settings.continuousListening;
  if (settings.continuousListening) {
    toast('Keep listening is on: say “stop” when you’re done');
    if (!listening && recognizerFor().supported) startListening();
  } else if (listening) stopListening();
});
el.tapeClear.addEventListener('click', () => clearTape(true));

// ---------- result chips and study tools ----------
const studyHost = () => ({
  notesRoot,
  addNote: (n: Parameters<StudyNotes['add']>[0]) => !!notes.add(n),
  openNotebook: () => void showNotebook(true),
  openExtensions: () => $('open-extensions').click(),
  openWhiteboard,
  openExam,
  toast,
});

/** The exam simulator, full screen. Missed questions open Practice or a video lesson; scratch work opens the whiteboard. */
/**
 * Loads the simulator's code. Kept outside openExam: the chunk loader keeps its stylesheet listeners (and so the
 * scope they were created in) alive, which would otherwise hold the first closed simulator in memory.
 */
const loadExam = () => Promise.all([import('./exam'), import('./engine'), import('@lemma/runtime')]);

function openExam() {
  if (document.querySelector('.ex-view:not(.leaving)')) return;
  const view = document.createElement('div');
  view.className = 'ex-view';
  view.setAttribute('role', 'dialog');
  view.setAttribute('aria-label', 'Exam simulator');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'icon-btn ex-close';
  close.setAttribute('aria-label', 'Close the exam simulator');
  close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  // The simulator owns its own mount (it clears it); the close button stays outside it.
  const mount = document.createElement('div');
  view.append(mount, close);
  document.body.append(view);
  document.documentElement.classList.add('ex-open');
  // The app behind is covered: keep keyboard focus and screen readers in the simulator.
  $('app').inert = true;
  view.tabIndex = -1;
  view.focus();
  // Hands-free listening would keep working the hidden calculator (and keep the mic open) during the exam.
  if (listening) stopListening();
  let dispose: (() => void) | null = null;
  const shut = () => {
    dispose?.();
    leave(view);
    document.documentElement.classList.remove('ex-open');
    $('app').inert = false;
    el.input.focus();
  };
  close.addEventListener('click', shut);
  void loadExam().then(([exam, { runtime }, { outcomeToJSON }]) => {
    if (!view.isConnected) return;
    const examSession = createSession();
    dispose = exam.openExamCenter(mount, {
      compute: async (q, opts) => {
        examSession.angle = opts?.angle ?? settings.angle;
        const o = outcomeToJSON(await runtime.compute(q, examSession), q);
        return o.ok ? { ok: true, display: `${o.display ?? ''}${o.unit ? ` ${o.unit}` : ''}`.trim() } : { ok: false, message: o.error?.message };
      },
      angle: () => settings.angle,
      openScratch: openWhiteboard,
      onPractice: (q) => openTool('practice', { query: q.prompt }),
      onLesson: (q) => openTool('video', { query: q.prompt, result: Array.isArray(q.answer) ? q.answer.join(', ') : (q.answer ?? '') }),
      toast,
    });
  });
}

// ---------- getting everything ready ahead of time ----------
/** Data-saver or mobile data: the start-up warm-up waits for a better connection (the button still works). */
function metered(): boolean {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; type?: string; effectiveType?: string } }).connection;
  return !!c && (!!c.saveData || c.type === 'cellular' || /(?:^|-)2g$|^3g$/.test(c.effectiveType ?? ''));
}

const warmHost: WarmHost = {
  warmEngines: () => Promise.all([loadUnits(), loadEveryday(), loadAdvanced()]).then(() => undefined),
  warmAlgebra: () => loadAdvanced().then(() => symbolicClient().whenReady()),
  warmVoice: () => whisper.whenReady(),
  warmAi: async () => {
    const [{ localModel, runsNatively }, { defaultLocalModel }] = await Promise.all([import('./assistant/local'), import('@lemma/ai-engine/src/providers/local')]);
    await localModel(defaultLocalModel(runsNatively())).whenReady();
  },
  offlineReady: async () => {
    const unavailable = 'This browser isn’t keeping an offline copy';
    if (desktop) return 'Already on this device';
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return unavailable;
    if (navigator.serviceWorker.controller) return true;
    // No worker yet (blocked, or registration failed): don't wait on one that will never come.
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 5000))]);
    if (!reg) return unavailable;
    // A first visit: the worker takes over the page as it activates.
    return new Promise<true | string>((done) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => done(true), { once: true });
      setTimeout(() => done(navigator.serviceWorker.controller ? true : unavailable), 5000);
    });
  },
};

const STEP_MARK: Record<StepState, string> = { waiting: '', running: '…', done: '✓', failed: '!', skipped: '–' };
/** Runs "Load everything", keeping Settings → Data current while it goes. */
function warmUp(): Promise<Record<StepId, StepState>> {
  const list = $('warm-steps');
  const button = $<HTMLButtonElement>('warm-now');
  const chosen = STEPS.filter((st) => !st.optional || (st.id === 'voice' ? settings.warmVoice : settings.warmAi));
  list.replaceChildren(
    ...chosen.map((st) => {
      const li = document.createElement('li');
      li.dataset.step = st.id;
      li.dataset.state = 'waiting';
      li.innerHTML = '<span class="warm-mark" aria-hidden="true"></span><span class="warm-label"></span><span class="fine warm-note"></span>';
      li.querySelector('.warm-label')!.textContent = st.label;
      li.querySelector('.warm-note')!.textContent = st.detail;
      return li;
    }),
  );
  list.hidden = false;
  button.disabled = true;
  button.textContent = 'Loading…';
  // A thin bar under the button: the share of steps that have finished, one way or another.
  const bar = $('warm-bar');
  const finished = new Set<string>();
  bar.style.setProperty('--p', '0');
  bar.hidden = false;
  return loadEverything(warmHost, { voice: settings.warmVoice, ai: settings.warmAi }, (id, state, note) => {
    const li = list.querySelector<HTMLElement>(`[data-step="${id}"]`);
    if (!li) return;
    if (state === 'done' || state === 'failed' || state === 'skipped') finished.add(id);
    bar.style.setProperty('--p', String(finished.size / chosen.length));
    li.dataset.state = state;
    li.querySelector('.warm-mark')!.textContent = STEP_MARK[state];
    if (note) li.querySelector('.warm-note')!.textContent = note;
  }).finally(() => {
    button.disabled = false;
    button.textContent = 'Load everything';
    bar.style.setProperty('--p', '1');
    setTimeout(() => (bar.hidden = true), D3 + 300);
    showWarmed();
  });
}

/** The arrow on "Recent" folds the list away; the choice is remembered. */
function bindRecentToggle() {
  const KEY = 'lemma.recent-collapsed';
  const toggle = $<HTMLButtonElement>('recent-toggle');
  const body = $('recent-body');
  const apply = (collapsed: boolean, animate = false) => {
    if (animate) fold(body, !collapsed);
    else body.hidden = collapsed;
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.title = collapsed ? 'Show recent' : 'Hide recent';
  };
  let collapsed = false;
  try {
    collapsed = localStorage.getItem(KEY) === '1';
  } catch {
    // Remembering is a convenience.
  }
  apply(collapsed);
  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    apply(collapsed, true);
    try {
      localStorage.setItem(KEY, collapsed ? '1' : '0');
    } catch {
      // As above.
    }
  });
}

function showWarmed() {
  const at = lastWarmed();
  $('warm-when').textContent = at ? `Everything was loaded ${new Date(at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : '';
}

/** Continuous recognition for the whiteboard: resumes after pauses until stopped. */
function boardListen(h: { onPartial(t: string): void; onFinal(t: string): void; onEnd(): void; onError(m: string): void }): () => void {
  if (listening) stopListening();
  synth.cancel();
  let want = true;
  const rec = recognizerFor();
  // Same patience as the calculator: a command is done once the speaker has finished it. Stop, close and undo act at
  // once, after the phrase before them.
  const gate: PhraseGate = new PhraseGate({
    ...gateWait(rec),
    show: h.onPartial,
    commit: h.onFinal,
    instant(text) {
      const t = commandWords(text);
      if (!/^(?:stop(?: listening)?|that'?s all|i'?m done|(?:close|exit|leave)(?: the)? (?:whiteboard|board))$/.test(t) && !UNDO_WORDS.test(t)) return false;
      gate.flush();
      h.onFinal(text);
      return true;
    },
  });
  const go = () =>
    rec.start(
      { lang: settings.voiceLang, continuous: true, preferOnDevice: settings.preferOnDevice, patienceMs: voiceWait() },
      {
        onPartial: (t) => gate.partial(t),
        onFinal: (t) => gate.final(t),
        onEnd: () => {
          if (want) return go();
          gate.flush();
          h.onEnd();
        },
        onError: (m) => {
          want = false;
          h.onError(m);
        },
        onStatus: setStatus,
      },
    );
  go();
  return () => {
    want = false;
    // Stopped by hand (or the board closed): a half-finished command is dropped, not run on a closing board.
    gate.cancel();
    rec.stop();
  };
}

/** Opens the whiteboard. With the mic on (or when asked by voice) the board keeps listening, and so does the app after. */
function openWhiteboard(handsFree = listening) {
  if (listening) stopListening();
  void import('./whiteboard/open').then(({ openWhiteboard: open }) =>
    open({
      listen: boardListen,
      voiceSupported: recognizerFor().supported,
      listening: handsFree && recognizerFor().supported,
      toast,
      angle: () => settings.angle,
      // The board puts focus back on what opened it (the exam's scratch button, say). Safari doesn't focus a
      // clicked button, so then focus goes to the exam still open behind, or else the calculator.
      onClosed: (wasListening) => {
        const exam = document.querySelector<HTMLElement>('.ex-view');
        if (document.activeElement === document.body || !document.activeElement) (exam && !exam.inert ? exam : el.input).focus();
        // Hands-free carries on in the calculator, never under an exam.
        if (wasListening && !exam) startListening();
      },
    }),
  );
}

function openTool(id: ToolId, ctx?: import('./study').ToolContext) {
  void import('./study').then((m) => {
    m.setHost(studyHost());
    void m.openTool(id, ctx);
  });
}

const CHIPS_KEY = 'lemma.chips-collapsed';
const chipsCollapsed = (): boolean => {
  try {
    return localStorage.getItem(CHIPS_KEY) === '1';
  } catch {
    return false;
  }
};

/** The actions under an answer, behind a small arrow that hides them (remembered across answers). */
function chipGroup(): HTMLElement {
  const existing = el.alts.querySelector<HTMLElement>('.chip-items');
  if (existing) return existing;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'chip-toggle';
  toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
  const items = document.createElement('div');
  items.className = 'chip-items';
  // The fold box around the chips is what hides (and animates).
  const box = document.createElement('div');
  box.className = 'fold';
  box.id = 'chip-items';
  box.append(items);
  toggle.setAttribute('aria-controls', box.id);
  const apply = (collapsed: boolean, animate = false) => {
    if (animate) fold(box, !collapsed);
    else box.hidden = collapsed;
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? 'Show actions' : 'Hide actions');
    toggle.title = collapsed ? 'Show actions' : 'Hide actions';
  };
  apply(chipsCollapsed());
  toggle.addEventListener('click', () => {
    const collapsed = toggle.getAttribute('aria-expanded') === 'true';
    apply(collapsed, true);
    try {
      localStorage.setItem(CHIPS_KEY, collapsed ? '1' : '0');
    } catch {
      // Remembering is a convenience.
    }
  });
  const group = document.createElement('div');
  group.className = 'chip-group';
  group.append(toggle, box);
  el.alts.append(group);
  return items;
}

function addChip(label: string, icon: string, on: (b: HTMLButtonElement) => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>`;
  b.append(label);
  b.addEventListener('click', () => on(b));
  const items = chipGroup();
  b.style.setProperty('--i', String(items.childElementCount)); // staggers their entrance
  items.append(b);
  return b;
}

// ---------- steps, choices, report, share, tutor (apps/web/src/solve, lazy) ----------
let solveHostCache: import('./solve').SolveHost | null = null;
function solveHost(): import('./solve').SolveHost {
  return (solveHostCache ??= {
    session,
    route: (q) => route(q, session, routeOptions()),
    compute: (q) => runtime.compute(q, session, routeOptions()),
    submit: (q) => {
      el.input.value = q;
      submit();
    },
    chip: addChip,
    toast,
    aiReady,
    assistant: getAssistant,
    openTool: (id, ctx) => openTool(id, ctx),
    notebook: getNotebook,
    symbolic: symbolicClient,
    angle: () => session.angle,
    toggleAngle: () => el.angle.click(),
    listen: recognizerFor().supported ? boardListen : undefined,
    askAi: (text) => {
      setAssistantMode(true);
      void getAssistant().then((a) => a.ask(text));
    },
  });
}
/** Adds the extras under a committed answer. They load after it is on screen and never hold it up. */
function solveExtras(input: string, outcome: Outcome, again = false) {
  if (overlayMode || outcome.kind === 'graph' || outcome.kind === 'error') return;
  const gen = again ? solveGen : ++solveGen;
  lastSolve = { input, outcome };
  const display = el.value.textContent ?? '';
  void import('./solve').then((m) => {
    if (gen !== solveGen) return;
    m.afterAnswer(solveHost(), { input, outcome, detail: el.detail, alts: el.alts, display, alive: () => gen === solveGen && el.detail.isConnected && !el.result.classList.contains('stale') });
  });
}

function resultChips(query: string, outcome: Outcome) {
  const display = el.value.textContent ?? '';
  const chip = addChip;
  chip('Save note', '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h5"/>', (b) => notes.saveAnswer(query, display) && confirmPop(b));
  chip('Notebook', '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v18M12 8h4"/>', (b) =>
    void getNotebook().then((v) => {
      v.appendQuery(query);
      confirmPop(b);
      toast('Added to your notebook');
    }),
  );
  if (outcome.kind === 'graph') return;
  chip('Practice question', '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14M12 17h.01"/>', () => openTool('practice', { query }));
  chip('Practice test', '<path d="M7 3h10v18H7z"/><path d="M10 8h4M10 12h4M10 16h2"/>', () => openTool('test', { query }));
  chip('Create video', '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 6l2 4M12 6l2 4M17 6l2 4"/>', () => openTool('video', { query, result: display }));
}

el.openStudy.addEventListener('click', () => void import('./study').then((m) => m.openStudy(studyHost())));

// ---------- boot ----------
if (!recognizerFor().supported) {
  el.mic.disabled = true;
  el.mic.title = 'Voice input isn’t supported in this browser';
}
for (const d of document.querySelectorAll('dialog')) animateDialog(d);
applyTheme();
applyAngle();
bindSettings();
$('warm-now').addEventListener('click', () => void warmUp());
bindRecentToggle();
showWarmed();
applyAi();
// A shared graph link (#graph=…) opens Graphing mode, which reads the link.
setMode(location.hash.startsWith('#graph=') ? 'graphing' : calcMode, false);
renderExamples();
renderHistory(false);
renderFormulas();
renderTimers();
notes = new StudyNotes({ root: notesRoot, toast, startTimer, cancelTimers });
watchSystemTheme(() => settings);
applyLoop();
syncAccent();
document.getElementById('accent-reset')?.addEventListener('click', () => {
  settings.accent = '';
  saveSettings(settings);
  applyTheme();
  syncAccent();
});
render({ kind: 'empty' }, 'preview');
el.input.focus();

// Prefetch the unit engine once the first frame is painted, so conversions are synchronous by the time anyone types one.
const idle = (cb: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(cb, { timeout: 800 }) : setTimeout(cb, 200));
/**
 * The first time a symbol the UI font lacks is drawn (the keypad's ⇔ ½ ← ⌫ …), the system searches for a font
 * that has it, once per font size: ~25 ms on macOS, dropped frames on the first switch to Scientific. Lay those
 * symbols out once, unseen, in the keypad's own styles, one style per idle moment.
 */
function warmGlyphs(): void {
  const text = '§°²¹½×÷ˣΣπᵇ…′⁻ⁿₙ←→↵⇄⇔⇧−√∫≤≥≠±∞θ⌫';
  const box = document.createElement('div');
  box.className = 'mkb';
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = 'position:fixed;left:-9999px;top:0;visibility:hidden;pointer-events:none';
  document.body.append(box);
  const styles = ['mkb-key', 'mkb-key fn', 'mkb-key op', 'mkb-key soft', 'mkb-key mem', 'mkb-key enter', 'mkb-sym', 'mkb-tab', 'mkb-clear'];
  const next = () => {
    const cls = styles.shift();
    if (!cls) return box.remove();
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    box.append(s);
    void s.offsetWidth;
    idle(next);
  };
  next();
}

// Prefetches are best-effort: a failure (offline, page unloading) is ignored and retried on real use.
const quietly = (p: Promise<unknown>) => void p.catch(() => {});
// Leaving or reloading the page cancels code still being fetched ahead of time; Safari reports each cancelled fetch
// as an error. While the page is going away, those aren't errors.
let unloading = false;
addEventListener('pagehide', () => (unloading = true));
addEventListener('beforeunload', () => (unloading = true));
addEventListener('pageshow', () => (unloading = false));
addEventListener('unhandledrejection', (e) => {
  const msg = String((e.reason as Error | undefined)?.message ?? e.reason ?? '');
  if (unloading && /Importing a module script failed|dynamically imported module|Unable to preload CSS|Load failed/i.test(msg)) e.preventDefault();
});
idle(() => {
  // Once the engine chunks are in, route a throwaway input so the router's large patterns are compiled now
  // rather than on the first keystroke (~40 ms on a laptop, several frames on a phone).
  void Promise.allSettled([loadUnits(), loadEveryday(), loadAdvanced(setStatus)]).then(() =>
    idle(() => {
      // A few typical inputs, twice each: the engine compiles a pattern on first use and again, faster, once it's
      // used often; both happen here rather than on the first keystrokes.
      const scratch = createSession();
      for (let i = 0; i < 2; i++)
        for (const q of ['7', '2+3', '12*3-4/2', '18% of 275', '5 km in miles', 'sqrt(2)']) {
          try {
            route(q, scratch, routeOptions());
          } catch {
            /* warming only */
          }
        }
      // The keypad's code and styles too, then its symbols in those styles.
      loadKeyboard().then(warmGlyphs, () => undefined);
      // The first answer's one-time costs: typesetting maths, and the agenda's dates and time zone.
      idle(() => {
        quietly(import('./math-render').then(({ renderMath }) => renderMath(document.createElement('div'), 'x = \\frac{1}{2}')));
        quietly(import('./agenda').then((m) => m.warmActivity()));
      });
    }),
  );
  // A few seconds in, every tool's code, one per idle moment, so each opens instantly the first time (not on a
  // metered connection, and not in the quick-calc overlay).
  if (!overlayMode && !metered())
    setTimeout(() => {
      const ids = ['study', 'whiteboard', 'geometry', 'physics', 'practice', 'test', 'agenda', 'notebooks', 'lecture', 'videos', 'exam'];
      const next = () => {
        const id = ids.shift();
        if (!id) return;
        if (id === 'study') quietly(import('./study'));
        else quietly(import('./preload').then((m) => m.prefetchTool(id)));
        idle(next);
      };
      idle(next);
    }, 3000);
  // UI chunks for graphs and typeset math, so the first graph or integral appears without a second round trip.
  quietly(import('./graph/view'));
  quietly(import('./math-render'));
  if (settings.warmOnStart && !overlayMode && !metered()) void warmUp();
});

if ('serviceWorker' in navigator && import.meta.env.PROD && !desktop) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// The PWA "Voice calculation" shortcut opens with ?listen=1.
if (new URLSearchParams(location.search).has('listen') && recognizerFor().supported) startListening();
// A shared answer link (?q=…, also the phone's lemma://calculate deep link) fills the input and previews it.
// Nothing is committed until Enter: a link must not run "delete all notes" or overwrite "x = 5" on its own.
{
  const shared = new URLSearchParams(location.search).get('q');
  if (shared && !overlayMode) setInput(shared.slice(0, 500));
}

// ---------- desktop overlay ----------
if (desktop && overlayMode) {
  document.documentElement.classList.add('overlay', `platform-${desktop.platform}`);
  const app = $('app');
  new ResizeObserver(() => desktop.resizeOverlay(app.getBoundingClientRect().height)).observe(app);
  desktop.onOverlayShown(({ listen }) => {
    el.input.focus();
    el.input.select();
    if (listen && !listening) startListening();
  });
  el.input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.input.value && !listening) desktop.hideOverlay();
    // ⌘/Ctrl+Enter: calculate, copy the result and get out of the way.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
      void copyResult().then(() => setTimeout(() => desktop.hideOverlay(), 350));
    }
  });
  $('open-main').addEventListener('click', () => desktop.openMain());
}
// Other windows (main ↔ overlay) share history through storage; keep this one current.
window.addEventListener('storage', (e) => {
  if (e.key === 'lemma.symbols.v1') reloadCustom();
  if (e.key === 'lemma.history.v1' && settings.keepHistory) {
    history = loadHistory();
    renderHistory();
  }
  // Each window saves its whole copy, so keep this one current or its next save erases the other's changes.
  if (e.key === 'lemma.vars.v1') {
    session.vars.clear();
    for (const [k, v] of Object.entries(loadVars())) {
      try {
        session.vars.set(k, new D(v));
      } catch {
        // Ignore corrupted stored values.
      }
    }
    renderFormulas();
  }
  if (e.key === 'lemma.formulas.v1') {
    session.fns.clear();
    for (const src of loadFormulas()) defineFromSource(session, src);
    renderFormulas();
  }
  if (e.key === 'lemma.timers.v1') {
    timers = loadTimers();
    renderTimers();
  }
  if (e.key === 'lemma.settings.v1') {
    Object.assign(settings, loadSettings());
    applyTheme();
    applyAngle();
    applyLoop();
  }
});
// Desktop app, first launch: say once where the quick calculator lives (the habit that makes it the one you reach
// for), and offer to keep it ready at login. Nothing is turned on unless the button is pressed.
if (desktop?.firstRun && !overlayMode)
  void desktop
    .firstRun()
    .then((w) => {
      if (!w) return;
      const msg = `Press ${w.overlay} anywhere for a quick calculation, ${w.listen} to say one`;
      toast(msg, w.openAtLogin || !desktop.openAtLogin ? undefined : { label: 'Open at login', run: () => void desktop.openAtLogin!().then((ok) => ok && toast('Lemma will be ready when you log in')) }, 10_000);
    })
    .catch(() => undefined);
// Desktop app: fetch the on-device model in the background so the first spoken calculation is instant.
if (desktop && !overlayMode) idle(() => whisper.preload(setStatus));

if (location.hash === '#notebook' && !overlayMode) void showNotebook(true, false);
// The desktop app and the extension's site link here to install the extension.
if (location.hash === '#add-to-browser' && !overlayMode) openTool('extension');
$('open-add-to-browser').addEventListener('click', () => {
  el.settings.close();
  openTool('extension');
});
