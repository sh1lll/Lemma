import './keyboard.css';
import { backspace, EditHistory, insert, move, type EditState, type Template } from './edit';
import { mainPane, ROW4 } from './layouts';
import type { Key, Pane, TabDef } from './types';

/**
 * The math keyboard: tabs (main / abc / func, plus symbols), undo and redo per input, clear all, RAD|DEG and a
 * small settings panel. It types into whichever text field was focused last (within its scope), so the same
 * component serves Scientific mode, graph rows, notebook cells and the matrix mode. Tabs beyond "main" load
 * lazily. On phones it can stand in for the system keyboard (inputmode="none" while it's shown).
 */

export type Field = HTMLInputElement | HTMLTextAreaElement;

export interface KeyboardPrefs {
  /** On touch screens, keep the phone's own keyboard down while this one is shown. */
  replaceSystem: boolean;
  mixed: boolean;
  exactFirst: boolean;
  haptics: boolean;
  big: boolean;
}

const PREFS_KEY = 'lemma.keyboard.v1';
const DEFAULT_PREFS: KeyboardPrefs = { replaceSystem: true, mixed: false, exactFirst: false, haptics: true, big: false };
const listeners = new Set<() => void>();

export function loadPrefs(): KeyboardPrefs {
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<KeyboardPrefs>) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}
let prefs = loadPrefs();
export const getPrefs = () => prefs;
export function setPref<K extends keyof KeyboardPrefs>(key: K, value: KeyboardPrefs[K]): void {
  prefs = { ...prefs, [key]: value };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Kept for this visit only.
  }
  listeners.forEach((l) => l());
}
export const onPrefs = (l: () => void) => listeners.add(l);

// ---------- fields, history ----------
const histories = new WeakMap<Field, EditHistory>();
export function historyOf(f: Field): EditHistory {
  let h = histories.get(f);
  if (!h) histories.set(f, (h = new EditHistory()));
  return h;
}

export const isField = (t: unknown): t is Field =>
  t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && ['text', 'search', ''].includes(t.type) && !t.readOnly);

const stateOf = (f: Field): EditState => ({ value: f.value, start: f.selectionStart ?? f.value.length, end: f.selectionEnd ?? f.value.length });

function apply(f: Field, s: EditState): void {
  const changed = f.value !== s.value;
  if (changed) f.value = s.value;
  try {
    f.setSelectionRange(s.start, s.end);
  } catch {
    // Some input types refuse selections; the caret just stays at the end.
  }
  if (changed) f.dispatchEvent(new Event('input', { bubbles: true }));
}

const coarse = () => matchMedia('(pointer: coarse)').matches;

let lastField: Field | null = null;
const live = new Set<MathKeyboard>();

document.addEventListener('focusin', (e) => {
  if (!isField(e.target) || e.target.closest('.mkb, #symbols, #settings, dialog.sym-dialog')) return;
  lastField = e.target;
  for (const kb of live) kb.onFocus(e.target);
});
// Native typing joins the field's undo history (a burst of typing is one step).
document.addEventListener(
  'beforeinput',
  (e) => {
    if (isField(e.target)) historyOf(e.target).record(stateOf(e.target), true);
  },
  true,
);
document.addEventListener(
  'keydown',
  (e) => {
    const t = e.target;
    if (!isField(t)) return;
    const owner = [...live].find((kb) => kb.visible && kb.accepts(t));
    if (!owner) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
      const redo = e.key.toLowerCase() === 'y' || e.shiftKey;
      if (owner.undo(redo, t)) e.preventDefault();
      return;
    }
    if (!mod && !e.altKey) owner.flash(e.key);
  },
  true,
);

// ---------- the keyboard ----------
export interface KeyboardOptions {
  /** Accessible name, e.g. "Math keyboard". */
  label: string;
  accepts(f: Field): boolean;
  /** Where to type when no accepted field has been focused yet. */
  fallback(): Field | null;
  tabs?: TabDef[];
  /** Left block row four on the main tab (memory keys in Scientific, x y = < elsewhere). */
  row4?: Key[];
  /** Offer MC in the func tab (Scientific). */
  memory?: boolean;
  enter?(f: Field): void;
  action?(act: string, f: Field | null): void;
  openSymbols?(f: Field | null): void;
  angle?: { get(): 'deg' | 'rad'; toggle(): void; watch?: HTMLElement };
  /** "rows": ask whether to clear every row (Graphing); otherwise the field is cleared. */
  clearScope?(f: Field): 'rows' | 'field';
  clearRows?(): void;
  /** Shows a close button. */
  onHide?(): void;
}

function button(cls: string, label: string, aria = label, title = aria): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  b.setAttribute('aria-label', aria);
  b.title = title;
  return b;
}

const ICONS: Record<string, string> = {
  undo: '<path d="M9 7H5V3"/><path d="M5.5 7A8 8 0 1 1 4 13"/>',
  redo: '<path d="M15 7h4V3"/><path d="M18.5 7A8 8 0 1 0 20 13"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.5-7.5a4 4 0 0 0-2-2z"/>',
  close: '<path d="M6 9l6 6 6-6"/>',
  phone: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8"/>',
};
function iconButton(name: string, aria: string): HTMLButtonElement {
  const b = button(`mkb-icon mkb-${name}`, '', aria);
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  return b;
}

const DEFAULT_TABS = (o: KeyboardOptions): TabDef[] => [
  { id: 'main', label: 'main', pane: () => mainPane(o.row4 ?? ROW4.vars) },
  { id: 'abc', label: 'abc', pane: () => import('./layouts-more').then((m) => m.abcPane()) },
  { id: 'func', label: 'func', pane: () => import('./layouts-more').then((m) => m.funcPane()) },
];

export class MathKeyboard {
  readonly root: HTMLElement;
  private readonly tabs: TabDef[];
  private readonly tabBar: HTMLElement;
  private readonly body: HTMLElement;
  private readonly panes = new Map<string, HTMLElement>();
  private readonly keyOf = new WeakMap<Element, Key>();
  private current = '';
  private shift = false;
  private angleBtn: HTMLButtonElement | null = null;
  private undoBtn: HTMLButtonElement;
  private redoBtn: HTMLButtonElement;
  private panel: HTMLElement | null = null;
  private confirmBar: HTMLElement | null = null;
  private repeat = 0;
  private repeated = false;
  /** A key already pressed on touch-down, so its click on lift is skipped. */
  private pressedOnDown: HTMLButtonElement | null = null;
  private shown = true;

  constructor(private o: KeyboardOptions) {
    this.tabs = o.tabs ?? DEFAULT_TABS(o);
    this.root = document.createElement('div');
    this.root.className = 'mkb';
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', o.label);

    const bar = document.createElement('div');
    bar.className = 'mkb-bar';
    this.tabBar = document.createElement('div');
    this.tabBar.className = 'mkb-tabs';
    this.tabBar.setAttribute('role', 'tablist');
    for (const t of this.tabs) {
      const b = button('mkb-tab', t.label, `${t.label} keys`, t.label);
      b.setAttribute('role', 'tab');
      b.dataset.tab = t.id;
      b.addEventListener('click', () => void this.show(t.id));
      this.tabBar.append(b);
    }
    if (o.openSymbols) {
      const sym = button('mkb-tab mkb-sym', 'Σ+', 'Symbols', 'Symbols: Greek letters, operators, arrows…');
      sym.addEventListener('click', () => o.openSymbols!(this.target()));
      this.tabBar.append(sym);
    }
    const tools = document.createElement('div');
    tools.className = 'mkb-tools';
    if (o.angle) {
      this.angleBtn = button('mkb-angle', '', 'Angle mode', 'Radians or degrees');
      this.angleBtn.innerHTML = '<span data-a="rad">RAD</span><span data-a="deg">DEG</span>';
      this.angleBtn.addEventListener('click', () => {
        o.angle!.toggle();
        this.syncAngle();
      });
      if (o.angle.watch) new MutationObserver(() => this.syncAngle()).observe(o.angle.watch, { childList: true, characterData: true, subtree: true });
      tools.append(this.angleBtn);
    }
    this.undoBtn = iconButton('undo', 'Undo');
    this.redoBtn = iconButton('redo', 'Redo');
    this.undoBtn.addEventListener('click', () => this.undo(false));
    this.redoBtn.addEventListener('click', () => this.undo(true));
    const clear = button('mkb-clear', 'clear all', 'Clear all');
    clear.addEventListener('click', () => this.clearAll());
    const wrench = iconButton('wrench', 'Keyboard settings');
    wrench.setAttribute('aria-expanded', 'false');
    wrench.addEventListener('click', () => this.togglePanel(wrench));
    tools.append(this.undoBtn, this.redoBtn, clear, wrench);
    if (o.onHide) {
      const hide = iconButton('close', 'Hide keyboard');
      hide.addEventListener('click', () => o.onHide!());
      tools.append(hide);
    }
    bar.append(this.tabBar, tools);
    this.body = document.createElement('div');
    this.body.className = 'mkb-body';
    this.root.append(bar, this.body);
    this.bindKeys();
    this.syncAngle();
    this.applyPrefs();
    onPrefs(() => this.applyPrefs());
    live.add(this);
    void this.show(this.tabs[0]!.id);
  }

  get visible(): boolean {
    return this.shown && this.root.isConnected && this.root.offsetParent !== null;
  }

  accepts(f: Field): boolean {
    return f.isConnected && this.o.accepts(f);
  }

  /** The field keys go to: the last focused one in scope, else the fallback. */
  target(): Field | null {
    if (lastField && this.accepts(lastField) && lastField.offsetParent !== null) return lastField;
    return this.o.fallback();
  }

  /** Shown or hidden by its host: inputmode follows (phones keep their own keyboard down while this one is up). */
  setShown(on: boolean): void {
    this.shown = on;
    const f = this.target();
    if (f) this.syncInputMode(f);
  }

  onFocus(f: Field): void {
    if (this.accepts(f)) this.syncInputMode(f);
    this.syncHistory();
  }

  private syncInputMode(f: Field): void {
    if (!this.accepts(f)) return;
    const none = this.shown && this.root.isConnected && prefs.replaceSystem && coarse();
    if (none) {
      if (f.inputMode !== 'none') f.dataset.mkbIm = f.inputMode || 'text';
      f.inputMode = 'none';
    } else if (f.inputMode === 'none') f.inputMode = f.dataset.mkbIm || 'text';
  }

  /** Lets the phone's own keyboard come back for this field (the toggle in settings, or "abc" on the phone). */
  useSystemKeyboard(): void {
    setPref('replaceSystem', false);
    const f = this.target();
    if (f) {
      this.syncInputMode(f);
      f.blur();
      f.focus();
    }
  }

  // ---------- tabs ----------
  async show(id: string): Promise<void> {
    const tabId = id === 'func2' ? 'func' : id;
    this.tabBar.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => {
      const on = b.dataset.tab === tabId;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    this.current = id;
    this.root.dataset.tab = tabId;
    let pane = this.panes.get(id);
    if (!pane) {
      const def = id === 'func2' ? { pane: () => import('./layouts-more').then((m) => m.funcMorePane(!!this.o.memory)) } : this.tabs.find((t) => t.id === id);
      if (!def) return;
      const layout = await def.pane();
      pane = this.renderPane(layout);
      pane.dataset.pane = id;
      this.panes.set(id, pane);
      this.body.append(pane);
    }
    if (this.current !== id) return;
    for (const [k, p] of this.panes) p.hidden = k !== id;
  }

  private renderPane(p: Pane): HTMLElement {
    const pane = document.createElement('div');
    pane.className = 'mkb-pane';
    pane.setAttribute('role', 'tabpanel');
    let first = true;
    const make = (k: Key): HTMLElement => {
      if (k.gap) {
        const g = document.createElement('span');
        g.className = 'mkb-gap';
        g.style.gridColumn = `span ${k.s ?? 1}`;
        return g;
      }
      const b = button(`mkb-key ${k.c ?? ''}`.trim(), k.l, k.aria ?? k.l, k.aria ?? k.l);
      if (k.s && k.s > 1) b.style.gridColumn = `span ${k.s}`;
      if (k.act) b.dataset.act = k.act;
      if (k.k) b.dataset.k = k.k.toLowerCase();
      if (k.act === 'shift') b.setAttribute('aria-pressed', 'false');
      b.tabIndex = first ? 0 : -1;
      first = false;
      this.keyOf.set(b, k);
      return b;
    };
    if (p.strip) {
      const strip = document.createElement('div');
      strip.className = 'mkb-strip';
      strip.append(...p.strip.map(make));
      pane.append(strip);
    }
    const grid = document.createElement('div');
    grid.className = 'mkb-grid';
    for (const block of p.blocks) {
      const b = document.createElement('div');
      b.className = `mkb-block ${block.cls ?? ''}`.trim();
      b.style.gridTemplateColumns = `repeat(${block.cols}, minmax(0, 1fr))`;
      b.style.flexGrow = String(block.cols);
      b.append(...block.keys.map(make));
      grid.append(b);
    }
    pane.append(grid);
    return pane;
  }

  // ---------- pressing keys ----------
  private bindKeys(): void {
    const keyEl = (e: Event) => (e.target as Element).closest<HTMLButtonElement>('.mkb-key');
    const stop = () => {
      clearTimeout(this.repeat);
      clearInterval(this.repeat);
      this.root.querySelectorAll('.mkb-key.down').forEach((k) => k.classList.remove('down'));
    };
    this.root.addEventListener('pointerdown', (e) => {
      // Keys never take focus from the field (and never pop the phone's keyboard).
      if ((e.target as Element).closest('button')) e.preventDefault();
      const b = keyEl(e);
      if (!b) return;
      b.classList.add('down');
      if (prefs.haptics && coarse()) navigator.vibrate?.(6);
      this.repeated = false;
      // Fingers: the key acts on touch-down, like a real calculator, not on lift. (Not in the scrolling chip row,
      // where a touch may be the start of a swipe; a mouse keeps the usual click.)
      if (e.pointerType !== 'mouse' && !b.closest('.mkb-strip')) {
        const k = this.keyOf.get(b);
        if (k) {
          this.pressedOnDown = b;
          this.press(k);
        }
      }
      if (b.dataset.act === 'back' || b.dataset.act === 'left' || b.dataset.act === 'right') {
        const k = this.keyOf.get(b)!;
        this.repeat = window.setTimeout(() => {
          this.repeat = window.setInterval(() => {
            this.repeated = true;
            this.press(k);
          }, 70);
        }, 420);
      }
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) this.root.addEventListener(ev, stop);
    this.root.addEventListener('click', (e) => {
      const b = keyEl(e);
      if (!b) return;
      if (this.repeated) {
        this.repeated = false;
        return;
      }
      if (this.pressedOnDown === b) {
        this.pressedOnDown = null;
        // Already pressed on touch-down. Some phones move focus when the touch ends: put it back in the field.
        const f = this.target();
        if (f && document.activeElement !== f) f.focus({ preventScroll: true });
        return;
      }
      this.pressedOnDown = null;
      const k = this.keyOf.get(b);
      if (k) this.press(k);
    });
    // Arrow keys move between keys (one tab stop per pane).
    this.root.addEventListener('keydown', (e) => {
      const b = keyEl(e);
      if (!b || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      const keys = [...(b.closest('.mkb-pane')?.querySelectorAll<HTMLButtonElement>('.mkb-key') ?? [])];
      const r = b.getBoundingClientRect();
      let next: HTMLButtonElement | undefined;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') next = keys[keys.indexOf(b) + (e.key === 'ArrowLeft' ? -1 : 1)];
      else {
        const down = e.key === 'ArrowDown';
        const cx = r.left + r.width / 2;
        next = keys
          .filter((k) => {
            const kr = k.getBoundingClientRect();
            return down ? kr.top > r.bottom - 2 : kr.bottom < r.top + 2;
          })
          .sort((a, c) => {
            const ar = a.getBoundingClientRect();
            const cr = c.getBoundingClientRect();
            const dy = down ? ar.top - cr.top : cr.bottom - ar.bottom;
            return dy || Math.abs(ar.left + ar.width / 2 - cx) - Math.abs(cr.left + cr.width / 2 - cx);
          })[0];
      }
      if (next) {
        b.tabIndex = -1;
        next.tabIndex = 0;
        next.focus();
      }
    });
  }

  /** Lights up the on-screen key for a physical key press. */
  flash(key: string): void {
    const pane = this.panes.get(this.current);
    const b = pane?.querySelector<HTMLElement>(`[data-k="${CSS.escape(key.toLowerCase())}"]`);
    if (!b) return;
    b.classList.add('lit');
    setTimeout(() => b.classList.remove('lit'), 140);
  }

  press(k: Key): void {
    if (k.ins !== undefined) {
      let tpl: Template | string = k.ins;
      if (this.shift && typeof tpl === 'string' && /^[a-z]$/.test(tpl)) {
        tpl = tpl.toUpperCase();
        this.setShift(false);
      }
      return this.edit((s) => insert(s, tpl));
    }
    const f = this.target();
    switch (k.act) {
      case 'left':
      case 'right':
        return this.edit((s) => move(s, k.act === 'left' ? -1 : 1), false);
      case 'back':
        return this.edit(backspace);
      case 'enter':
        if (!f) return;
        if (this.o.enter) return this.o.enter(f);
        f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, shiftKey: f instanceof HTMLTextAreaElement }));
        return;
      case 'shift':
        return this.setShift(!this.shift);
      case 'more':
        return void this.show(this.current === 'func2' ? 'func' : 'func2');
      case 'symbols':
        return this.o.openSymbols?.(f);
      case 'angle':
        this.o.angle?.toggle();
        return this.syncAngle();
      default:
        if (k.act) this.o.action?.(k.act, f);
    }
  }

  private setShift(on: boolean): void {
    this.shift = on;
    this.root.classList.toggle('shift', on);
    this.root.querySelectorAll('[data-act="shift"]').forEach((b) => b.setAttribute('aria-pressed', String(on)));
  }

  /** Applies an edit to the target field, recording it for undo. */
  edit(fn: (s: EditState) => EditState, record = true): void {
    const f = this.target();
    if (!f) return;
    if (document.activeElement !== f) {
      this.syncInputMode(f);
      f.focus({ preventScroll: true });
    }
    const s = stateOf(f);
    if (record) historyOf(f).record(s);
    apply(f, fn(s));
    this.syncHistory();
  }

  undo(redo: boolean, field?: Field): boolean {
    const f = field ?? this.target();
    if (!f) return false;
    const h = historyOf(f);
    const s = redo ? h.redo(stateOf(f)) : h.undo(stateOf(f));
    if (!s) return false;
    if (document.activeElement !== f) f.focus({ preventScroll: true });
    apply(f, s);
    this.syncHistory();
    return true;
  }

  private syncHistory(): void {
    const f = this.target();
    const h = f ? historyOf(f) : null;
    this.undoBtn.disabled = !h?.canUndo;
    this.redoBtn.disabled = !h?.canRedo;
  }

  clearAll(): void {
    const f = this.target();
    if (!f) return;
    if (this.o.clearScope?.(f) === 'rows') return this.askClearRows(f);
    this.edit(() => ({ value: '', start: 0, end: 0 }));
  }

  private askClearRows(f: Field): void {
    this.confirmBar?.remove();
    const bar = document.createElement('div');
    bar.className = 'mkb-confirm';
    bar.setAttribute('role', 'alertdialog');
    bar.setAttribute('aria-label', 'Clear all rows?');
    const q = document.createElement('span');
    q.textContent = 'Clear all rows?';
    const all = button('mkb-pill danger', 'Clear all rows');
    const one = button('mkb-pill', 'Just this one');
    const cancel = button('mkb-pill', 'Cancel');
    const close = () => {
      bar.remove();
      this.confirmBar = null;
    };
    all.addEventListener('click', () => {
      close();
      this.o.clearRows?.();
    });
    one.addEventListener('click', () => {
      close();
      if (f.isConnected) {
        lastField = f;
        this.edit(() => ({ value: '', start: 0, end: 0 }));
      }
    });
    cancel.addEventListener('click', close);
    bar.append(q, all, one, cancel);
    this.confirmBar = bar;
    this.root.prepend(bar);
    all.focus({ preventScroll: true });
  }

  private syncAngle(): void {
    if (!this.angleBtn || !this.o.angle) return;
    const a = this.o.angle.get();
    this.angleBtn.dataset.angle = a;
    this.angleBtn.setAttribute('aria-label', `Angle mode: ${a === 'deg' ? 'degrees' : 'radians'}`);
  }

  // ---------- settings ----------
  private togglePanel(anchor: HTMLButtonElement): void {
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
      anchor.setAttribute('aria-expanded', 'false');
      return;
    }
    const panel = document.createElement('div');
    panel.className = 'mkb-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Keyboard settings');
    const row = (key: keyof KeyboardPrefs, text: string) => {
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = prefs[key];
      box.dataset.pref = key;
      box.addEventListener('change', () => {
        setPref(key, box.checked);
        if (key === 'replaceSystem') {
          const f = this.target();
          if (f) this.syncInputMode(f);
        }
      });
      label.append(box, ` ${text}`);
      return label;
    };
    const title = document.createElement('p');
    title.className = 'mkb-panel-title';
    title.textContent = 'Keyboard';
    panel.append(
      title,
      row('replaceSystem', 'Use instead of the phone keyboard'),
      row('mixed', 'Mixed numbers (3 1/2)'),
      row('exactFirst', 'Exact answers first (fractions, √, π)'),
      row('big', 'Bigger keys'),
    );
    if ('vibrate' in navigator) panel.append(row('haptics', 'Vibrate on key press'));
    const done = button('mkb-pill', 'Done');
    done.addEventListener('click', () => this.togglePanel(anchor));
    panel.append(done);
    panel.addEventListener('keydown', (e) => e.key === 'Escape' && this.togglePanel(anchor));
    this.panel = panel;
    anchor.setAttribute('aria-expanded', 'true');
    this.root.append(panel);
    panel.querySelector('input')?.focus({ preventScroll: true });
  }

  private applyPrefs(): void {
    this.root.classList.toggle('big', prefs.big);
  }
}

// ---------- a docked keyboard (Graphing rows, notebook cells) ----------
export interface Dock {
  /** Whether the dock may appear (its button is shown when it's hidden). */
  setAvailable(on: boolean): void;
  open(): void;
  close(): void;
}

export function createDock(o: Omit<KeyboardOptions, 'onHide' | 'label'>): Dock {
  const DOCK_KEY = 'lemma.keyboard.dock';
  const wrap = document.createElement('div');
  wrap.className = 'mkb-dock';
  wrap.hidden = true;
  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'mkb-fab';
  fab.hidden = true;
  fab.setAttribute('aria-label', 'Show math keyboard');
  fab.title = 'Math keyboard';
  fab.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.phone}</svg>`;
  let available = false;
  let wanted = (() => {
    try {
      return localStorage.getItem(DOCK_KEY) === 'open';
    } catch {
      return false;
    }
  })();
  const kb = new MathKeyboard({ ...o, label: 'Math keyboard', onHide: () => dock.close() });
  wrap.append(kb.root);
  document.body.append(wrap, fab);
  const sync = () => {
    const open = available && wanted;
    wrap.hidden = !open;
    fab.hidden = !available || open;
    kb.setShown(open);
    document.documentElement.classList.toggle('mkb-docked', open);
    document.documentElement.style.setProperty('--mkb-dock-h', open ? `${wrap.offsetHeight}px` : '0px');
  };
  const remember = () => {
    try {
      localStorage.setItem(DOCK_KEY, wanted ? 'open' : 'closed');
    } catch {
      // Only for this visit.
    }
  };
  fab.addEventListener('pointerdown', (e) => e.preventDefault());
  fab.addEventListener('click', () => dock.open());
  new ResizeObserver(() => !wrap.hidden && document.documentElement.style.setProperty('--mkb-dock-h', `${wrap.offsetHeight}px`)).observe(wrap);
  const dock: Dock = {
    setAvailable(on) {
      available = on;
      sync();
    },
    open() {
      wanted = true;
      remember();
      sync();
    },
    close() {
      wanted = false;
      remember();
      sync();
    },
  };
  return dock;
}

export { ROW4 };
