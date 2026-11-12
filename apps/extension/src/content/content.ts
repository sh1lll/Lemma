/**
 * Injected on demand (activeTab + scripting) when the user invokes Lemma on a page; never declared as a
 * content script, so the extension has no access to pages the user hasn't invoked it on.
 *
 * - Reads the selection (page-math.ts) when the background asks.
 * - Shows the result in a small shadow-DOM bubble next to the selection.
 * - "Fill": writes the answer into the one field the user clicked, with a check badge. Never submits.
 * - Draws the region overlay for "Solve what's on screen".
 */
import { ACTION_LABELS, type Action } from '../core/actions';
import type { SelectionInfo, ToBackground, ToContent } from '../core/messages';
import { isAssessmentHost, loadSettings } from '../core/settings';
import type { Solution } from '../core/solve';
import { h } from '../ui/dom';
import { BADGE_CSS, BUBBLE_CSS, OVERLAY_CSS } from './bubble-css';
import { readSelection } from './page-math';

declare global {
  interface Window {
    __lemmaContent?: boolean;
  }
}

const send = (m: ToBackground) => chrome.runtime.sendMessage(m);

function shadowHost(css: string, id: string): { host: HTMLElement; root: ShadowRoot } {
  document.getElementById(id)?.remove();
  const host = document.createElement('lemma-ui');
  host.id = id;
  host.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;z-index:2147483646;';
  const root = host.attachShadow({ mode: 'open' });
  root.append(h('style', {}, css));
  (document.body ?? document.documentElement).append(host);
  return { host, root };
}

const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Our own KaTeX MathML (rendered in the background); falls back to text if the page forbids parsing HTML. */
function mathNode(mathml: string | undefined, fallback: string): Node {
  if (!mathml) return document.createTextNode(fallback);
  try {
    const doc = new DOMParser().parseFromString(mathml, 'text/html');
    const m = doc.querySelector('math');
    if (m) {
      const span = h('span', { 'aria-label': fallback });
      span.append(document.importNode(m, true));
      return span;
    }
  } catch {
    /* Trusted Types or parsing blocked */
  }
  return document.createTextNode(fallback);
}

// ---------- fillable fields

type Fillable = HTMLInputElement | HTMLTextAreaElement | HTMLElement;
const TEXTISH = new Set(['text', 'number', 'search', 'tel', 'url', 'email', '']);

function fillable(el: EventTarget | null): Fillable | null {
  if (!(el instanceof HTMLElement) || el.closest('lemma-ui')) return null;
  if (el instanceof HTMLInputElement) return TEXTISH.has(el.type) && !el.readOnly && !el.disabled ? el : null;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled ? el : null;
  if (el.isContentEditable) return el;
  return null;
}

function fieldLabel(el: Fillable): string {
  const byFor = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent : null;
  const t = el.getAttribute('aria-label') ?? byFor ?? el.closest('label')?.textContent ?? el.getAttribute('placeholder') ?? el.getAttribute('name') ?? 'the field';
  const s = t.replace(/\s+/g, ' ').trim();
  return s.length > 40 ? `${s.slice(0, 39)}…` : s;
}

/** Sets the value the way a user's typing would, so React/Vue/Angular see it. Does not press Enter or submit. */
function writeValue(el: Fillable, value: string): void {
  el.focus({ preventScroll: true });
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  } else {
    el.textContent = value;
  }
  el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertReplacementText', data: value }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

const badges: { el: Fillable; badge: HTMLElement }[] = [];
function placeBadges() {
  for (const { el, badge } of badges) {
    const r = el.getBoundingClientRect();
    badge.style.left = `${r.right + scrollX - 22}px`;
    badge.style.top = `${r.top + scrollY + (r.height - 18) / 2}px`;
    badge.hidden = !el.isConnected || r.width === 0;
  }
}
function addBadge(el: Fillable, answer: string) {
  let host = document.getElementById('lemma-badges');
  if (!host) {
    host = shadowHost(BADGE_CSS, 'lemma-badges').host;
    addEventListener('resize', placeBadges);
    addEventListener('scroll', placeBadges, { passive: true, capture: true });
  }
  const root = host.shadowRoot!;
  const existing = badges.find((b) => b.el === el);
  const badge = existing?.badge ?? h('div', { class: 'badge', role: 'img', 'data-testid': 'fill-badge' });
  badge.setAttribute('aria-label', `Filled by Lemma: ${answer} (verified by the engine)`);
  badge.title = `Filled by Lemma: ${answer}`;
  badge.innerHTML = CHECK;
  if (!existing) {
    root.append(badge);
    badges.push({ el, badge });
  }
  placeBadges();
  // Typing over the answer removes the mark: it no longer shows what Lemma computed.
  el.addEventListener(
    'input',
    function off(e) {
      if ((e as InputEvent).inputType === 'insertReplacementText') return;
      badge.remove();
      badges.splice(badges.findIndex((b) => b.el === el), 1);
      el.removeEventListener('input', off);
    },
  );
}

// ---------- the bubble

let closeBubble: (() => void) | null = null;
/** Set while the user is choosing a field to fill (the bubble steps aside so it can't cover the field). */
let stopPicking: (() => void) | null = null;
let anchorRect: DOMRect | null = null;
let restoreFocus: Element | null = null;

function selectionRect(): DOMRect | null {
  const sel = getSelection();
  if (!sel?.rangeCount) return null;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  return r.width || r.height ? r : null;
}

function mountBubble(): { root: ShadowRoot; box: HTMLElement; body: HTMLElement } {
  closeBubble?.();
  restoreFocus = document.activeElement;
  anchorRect = selectionRect() ?? anchorRect;
  const { host, root } = shadowHost(BUBBLE_CSS, 'lemma-bubble');
  const titleId = 'lemma-title';
  const box = h('div', { class: 'bubble', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': titleId, 'data-testid': 'bubble' });
  const title = h('p', { class: 'title', id: titleId }, 'Lemma');
  const close = h('button', { class: 'close', type: 'button', 'aria-label': 'Close Lemma', title: 'Close (Esc)' }, '×');
  const body = h('div', {});
  box.append(h('div', { class: 'head' }, title, close), body);
  root.append(box);

  // Beside the selection when there is room (so the fields below it stay clickable), else below or above it.
  // The header is a drag handle, and the bubble stays where the user puts it.
  let moved = false;
  const place = () => {
    if (moved) return;
    const r = anchorRect;
    const w = box.offsetWidth || 360;
    const hgt = box.offsetHeight || 120;
    let left: number;
    let top: number;
    if (r && r.right + 12 + w <= innerWidth - 12) {
      left = r.right + 12;
      top = Math.max(12, Math.min(r.top - 10, innerHeight - hgt - 12));
    } else {
      left = r ? r.left : innerWidth / 2 - w / 2;
      left = Math.max(12, Math.min(left, innerWidth - w - 12));
      top = r ? r.bottom + 8 : 80;
      if (r && r.bottom + 8 + hgt > innerHeight && r.top - 8 - hgt > 0) top = r.top - 8 - hgt;
    }
    box.style.left = `${left + scrollX}px`;
    box.style.top = `${top + scrollY}px`;
  };
  place();
  new ResizeObserver(place).observe(box);
  const head = box.querySelector<HTMLElement>('.head')!;
  head.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const sx = e.clientX - box.offsetLeft;
    const sy = e.clientY - box.offsetTop;
    const move = (ev: PointerEvent) => {
      moved = true;
      box.style.left = `${ev.clientX - sx}px`;
      box.style.top = `${ev.clientY - sy}px`;
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (stopPicking) stopPicking();
      else closeBubble?.();
    }
  };
  const onDown = (e: MouseEvent) => {
    if (stopPicking) return;
    if (!e.composedPath().includes(host) && !fillable(e.target)) closeBubble?.();
  };
  addEventListener('keydown', onKey, true);
  addEventListener('mousedown', onDown, true);
  closeBubble = () => {
    removeEventListener('keydown', onKey, true);
    removeEventListener('mousedown', onDown, true);
    removeEventListener('focusin', onFocusIn, true);
    host.remove();
    closeBubble = null;
    stopPicking = null;
    if (restoreFocus instanceof HTMLElement && restoreFocus.isConnected && !restoreFocus.closest('lemma-ui')) restoreFocus.focus({ preventScroll: true });
  };
  close.addEventListener('click', () => closeBubble?.());
  (box as HTMLElement & { setTitle?: (t: string) => void }).setTitle = (t: string) => (title.textContent = `Lemma · ${t}`);
  return { root, box, body };
}

let onFocusIn: (e: FocusEvent) => void = () => {};

function showLoading(action: Action) {
  const { box, body } = mountBubble();
  (box as HTMLElement & { setTitle?: (t: string) => void }).setTitle?.(ACTION_LABELS[action]);
  body.append(h('p', { class: 'query', role: 'status' }, 'Working on this device…'));
}

async function showBubble(s: Solution, mathml: Record<string, string>, tutor: boolean) {
  const settings = await loadSettings();
  const { root, box, body } = mountBubble();
  (box as HTMLElement & { setTitle?: (t: string) => void }).setTitle?.(ACTION_LABELS[s.action]);
  const live = h('p', { class: 'sr', 'aria-live': 'polite' });

  body.append(h('p', { class: 'query', 'data-testid': 'bubble-query' }, s.expression ?? s.query));
  if (!s.ok) {
    body.append(h('p', { class: 'error', role: 'status', 'data-testid': 'bubble-error' }, s.error ?? 'Lemma could not work that out.'));
  }

  const answer = s.answer ? h('div', { class: 'answer', 'data-testid': 'bubble-answer', 'data-plain': s.answer.display }) : null;
  if (answer && s.answer) answer.append(s.answer.tex ? mathNode(mathml[s.answer.tex], s.answer.display) : document.createTextNode(s.answer.display));

  if (s.graph) {
    const g = s.graph;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'graph');
    svg.setAttribute('viewBox', `0 0 ${g.width} ${g.height}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Graph of ${g.labels.join(', ')} for x from ${g.xRange[0]} to ${g.xRange[1]}`);
    const line = (d: string, stroke: string, w: number) => {
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', stroke);
      p.setAttribute('stroke-width', String(w));
      p.setAttribute('stroke-linejoin', 'round');
      svg.append(p);
    };
    if (g.axisX !== null) line(`M0 ${g.axisX}H${g.width}`, 'var(--muted)', 1);
    if (g.axisY !== null) line(`M${g.axisY} 0V${g.height}`, 'var(--muted)', 1);
    const colors = ['var(--accent)', 'var(--warn)', 'var(--ink)'];
    g.paths.forEach((d, i) => d && line(d, colors[i % colors.length]!, 2));
    body.append(svg);
  }

  // Tutor mode: hint → steps one at a time → answer.
  const hasSteps = s.steps.length > 0;
  let shown = 0;
  let answerShown = !tutor || !hasSteps;
  let stepsViewed = !hasSteps;
  const hint = s.hint && hasSteps ? h('p', { class: 'hint', 'data-testid': 'bubble-hint' }, h('strong', {}, 'Hint: '), s.hint) : null;
  const list = h('ol', { class: 'steps', 'aria-label': 'Steps', 'data-testid': 'bubble-step-list' });
  const items = s.steps.map((st, i) => {
    const li = h('li', {}, h('span', { class: 'sr' }, `Step ${i + 1}: `), st.text);
    if (st.tex) li.append(h('div', { class: 'm' }, mathNode(mathml[st.tex], st.tex)));
    return li;
  });
  const controls = h('div', { class: 'row' });
  const notes = s.notes.length ? h('p', { class: 'notes' }, s.notes.join(' · ')) : null;
  if (hint && tutor) body.append(hint);
  body.append(list);
  if (answer) body.append(answer);
  if (notes) body.append(notes);
  body.append(controls, live);

  // Fill section
  const fillBox = h('div', { class: 'fill' });
  const fillStatus = h('p', { class: 'status', 'data-testid': 'fill-status', role: 'status' });
  const fillBtn = h('button', { class: 'b primary', type: 'button', 'data-testid': 'fill' }, 'Fill') as HTMLButtonElement;
  const pickBtn = h('button', { class: 'b', type: 'button', 'data-testid': 'fill-pick' }, 'Choose field') as HTMLButtonElement;
  fillBox.append(h('div', { class: 'row', style: 'margin-top:0' }, pickBtn, fillBtn), fillStatus);
  const toast = h('div', { class: 'toast', role: 'status' }, 'Click the field to fill. Esc cancels.');
  toast.hidden = true;
  root.append(toast);
  function startPick() {
    box.style.visibility = 'hidden';
    toast.hidden = false;
    stopPicking = () => {
      stopPicking = null;
      box.style.visibility = '';
      toast.hidden = true;
      updateFill();
      (fillBtn.disabled ? pickBtn : fillBtn).focus({ preventScroll: true });
    };
  }
  pickBtn.addEventListener('click', startPick);
  let target: Fillable | null = fillable(restoreFocus);
  const blockedSite = isAssessmentHost(location.hostname, settings.assessmentDomains);

  function updateFill() {
    pickBtn.hidden = true;
    if (!s.ok || !s.answer) {
      fillBox.hidden = true;
      return;
    }
    fillBox.hidden = false;
    if (blockedSite) {
      fillBtn.disabled = true;
      fillStatus.textContent = `Filling is off on ${location.hostname}: you marked it as an assessment site in settings.`;
      return;
    }
    if (settings.learningFirst && !stepsViewed) {
      fillBtn.disabled = true;
      fillStatus.textContent = 'Learning first is on: open the steps before filling in the answer.';
      return;
    }
    if (!answerShown) {
      fillBtn.disabled = true;
      fillStatus.textContent = 'Reveal the answer first.';
      return;
    }
    fillBtn.disabled = !target;
    pickBtn.hidden = false;
    pickBtn.textContent = target ? 'Change field' : 'Choose field';
    fillStatus.textContent = target
      ? `Fill “${s.answer.fill}” into ${fieldLabel(target)}. Nothing is submitted.`
      : 'Click the field you want to fill (or Choose field), then press Fill. Nothing is submitted.';
  }
  onFocusIn = (e: FocusEvent) => {
    const f = fillable(e.target);
    if (f) {
      target = f;
      if (stopPicking) stopPicking();
      else updateFill();
    }
  };
  addEventListener('focusin', onFocusIn, true);
  fillBtn.addEventListener('click', () => {
    if (!target || !s.answer || fillBtn.disabled) return;
    const value = s.answer.fill;
    if (target instanceof HTMLInputElement && target.type === 'number' && !/^-?\d*\.?\d+(?:e[-+]?\d+)?$/i.test(value)) {
      fillStatus.textContent = `This field only takes a number, and the answer is “${value}”. Copy it instead.`;
      return;
    }
    writeValue(target, value);
    addBadge(target, value);
    fillStatus.textContent = `Filled ${fieldLabel(target)}. Check it, then submit the form yourself.`;
    live.textContent = fillStatus.textContent;
  });

  function draw() {
    list.replaceChildren(...items.slice(0, shown));
    list.hidden = shown === 0;
    if (answer) answer.hidden = !answerShown;
    controls.replaceChildren();
    if (s.answer && answerShown) controls.append(btn('Copy', 'copy', copy));
    if (hasSteps && shown < items.length) {
      if (tutor) controls.append(btn(shown ? 'Next step' : 'First step', 'next-step', () => more(1), !answerShown), btn('All steps', 'all-steps', () => more(items.length)));
      else controls.append(btn('Steps', 'show-steps', () => more(items.length)));
    }
    if (s.answer && !answerShown) controls.append(btn('Show answer', 'show-answer', revealAnswer, shown >= items.length));
    controls.append(btn('Open in side panel', 'open-panel', openPanel));
    updateFill();
  }
  function btn(label: string, id: string, f: () => void, primary = false) {
    return h('button', { class: primary ? 'b primary' : 'b', type: 'button', 'data-testid': `bubble-${id}`, onclick: f }, label);
  }
  function more(n: number) {
    shown = Math.min(items.length, shown + n);
    if (shown >= items.length) stepsViewed = true;
    live.textContent = `${shown} of ${items.length} steps shown`;
    draw();
  }
  function revealAnswer() {
    answerShown = true;
    live.textContent = `Answer: ${s.answer?.display ?? ''}`;
    draw();
  }
  async function copy() {
    const text = s.answer?.display ?? '';
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = h('textarea', { style: 'position:fixed;opacity:0' }, text);
      box.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    live.textContent = 'Copied';
    fillStatus.textContent = `Copied “${text}”.`;
  }
  function openPanel() {
    void send({ type: 'lemma:open-panel', query: s.query, action: s.action });
  }

  body.append(fillBox);
  draw();
  (controls.querySelector('button') as HTMLButtonElement | null)?.focus({ preventScroll: true });
}

// ---------- region overlay

function startRegion() {
  closeBubble?.();
  const { host, root } = shadowHost(OVERLAY_CSS, 'lemma-overlay');
  host.style.position = 'fixed';
  const overlay = h('div', { class: 'overlay', role: 'dialog', 'aria-label': 'Select a region to read', tabindex: '-1', 'data-testid': 'region-overlay' });
  const tip = h('div', { class: 'tip' }, 'Drag over the problem to read it. Enter reads the whole view, Esc cancels.');
  const rect = h('div', { class: 'rect' });
  overlay.append(rect, tip);
  root.append(overlay);
  overlay.focus();

  let start: { x: number; y: number } | null = null;
  const done = (r: { x: number; y: number; w: number; h: number } | null) => {
    removeEventListener('keydown', onKey, true);
    host.remove();
    if (!r) {
      void send({ type: 'lemma:region-cancel' });
      return;
    }
    // Wait for the overlay to disappear from the screen before the background captures it.
    requestAnimationFrame(() => requestAnimationFrame(() => void send({ type: 'lemma:region-done', rect: r, vw: innerWidth })));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      done(null);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      done({ x: 0, y: 0, w: innerWidth, h: innerHeight });
    }
  };
  addEventListener('keydown', onKey, true);
  overlay.addEventListener('mousedown', (e) => {
    e.preventDefault();
    start = { x: e.clientX, y: e.clientY };
    rect.style.display = 'block';
  });
  overlay.addEventListener('mousemove', (e) => {
    if (!start) return;
    const x = Math.min(start.x, e.clientX), y = Math.min(start.y, e.clientY);
    Object.assign(rect.style, { left: `${x}px`, top: `${y}px`, width: `${Math.abs(e.clientX - start.x)}px`, height: `${Math.abs(e.clientY - start.y)}px` });
  });
  overlay.addEventListener('mouseup', (e) => {
    if (!start) return;
    const r = { x: Math.min(start.x, e.clientX), y: Math.min(start.y, e.clientY), w: Math.abs(e.clientX - start.x), h: Math.abs(e.clientY - start.y) };
    start = null;
    if (r.w < 8 || r.h < 8) {
      rect.style.display = 'none';
      return;
    }
    done(r);
  });
}

// ---------- messages

if (!window.__lemmaContent) {
  window.__lemmaContent = true;
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    const m = msg as ToContent;
    switch (m.type) {
      case 'lemma:selection': {
        anchorRect = selectionRect();
        const info: SelectionInfo = readSelection();
        reply(info);
        return;
      }
      case 'lemma:bubble-loading':
        showLoading(m.action);
        reply(true);
        return;
      case 'lemma:bubble':
        void showBubble(m.solution, m.mathml, m.tutor).then(() => reply(true));
        return true;
      case 'lemma:region':
        startRegion();
        reply(true);
        return;
    }
  });
}
