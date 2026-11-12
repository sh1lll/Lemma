import { animateDialog, play, D2 } from '../motion';
import { categories, describe, search, unicodeBlocks, UNICODE_COUNT, type Sym } from './catalog';
import { loadCustom, loadRecent, noteRecent, saveCustom, type CustomSymbol } from './store';

/**
 * The symbol menu: search by name, alias or LaTeX command, browse by group, insert at the cursor of whichever
 * field was being typed in, and keep your own symbols (with an optional value for calculations).
 */

type Field = HTMLInputElement | HTMLTextAreaElement;

let dialog: HTMLDialogElement | null = null;
let target: Field | null = null;
let changed: (() => void) | null = null;
let body: HTMLElement;
let searchBox: HTMLInputElement;
let cats: HTMLElement;

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const icon = (d: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;

const asSym = (c: CustomSymbol): Sym => ({ text: c.text, name: c.name || c.text, aliases: c.value ? [c.value] : [], tex: [] });

/** Opens the menu; a tap inserts into `field` (at its cursor). `onChange` hears about edits to your own symbols. */
export function openSymbols(field: Field | null, onChange?: () => void): void {
  target = field;
  changed = onChange ?? null;
  if (!dialog) build();
  searchBox.value = '';
  renderBrowse();
  dialog!.showModal();
  body.scrollTop = 0;
  searchBox.focus();
}

function build(): void {
  const d = (dialog = h('dialog', 'drawer sym-dialog'));
  d.id = 'symbols';
  d.setAttribute('aria-labelledby', 'sym-title');
  const sheet = h('div', 'sheet sym-sheet');
  const head = h('div', 'sheet-head');
  const title = h('h2', '', 'Symbols');
  title.id = 'sym-title';
  const close = h('button', 'icon-btn');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close symbols');
  close.innerHTML = icon('M6 6l12 12M18 6L6 18');
  close.addEventListener('click', () => d.close());
  head.append(title, close);

  const find = h('div', 'sym-find');
  searchBox = h('input');
  searchBox.type = 'search';
  searchBox.placeholder = 'Search: alpha, \\leq, not equal…';
  searchBox.setAttribute('aria-label', 'Search symbols');
  searchBox.autocomplete = 'off';
  searchBox.spellcheck = false;
  searchBox.setAttribute('autocapitalize', 'off');
  searchBox.addEventListener('input', () => (searchBox.value.trim() ? renderSearch() : renderBrowse()));
  searchBox.addEventListener('keydown', (e) => {
    const first = body.querySelector<HTMLButtonElement>('.sym');
    // A search field would clear itself on Escape; here Escape always closes the menu.
    if (e.key === 'Escape') {
      e.preventDefault();
      dialog!.close();
    } else if (e.key === 'ArrowDown' && first) {
      e.preventDefault();
      focusSym(first);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (first && searchBox.value.trim()) insert(first.dataset.text!);
    }
  });
  find.append(searchBox);

  cats = h('nav', 'set-index sym-cats');
  cats.setAttribute('aria-label', 'Symbol groups');
  cats.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('button');
    if (!b?.dataset.to) return;
    if (searchBox.value) {
      searchBox.value = '';
      renderBrowse();
    }
    if (b.dataset.to === 'sym-all') showAll();
    document.getElementById(b.dataset.to)?.scrollIntoView({ block: 'start' });
  });

  body = h('div', 'sym-body');
  body.addEventListener('keydown', onGridKey);
  body.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button.sym');
    if (b?.dataset.text) insert(b.dataset.text);
  });
  body.addEventListener('focusin', (e) => {
    const b = e.target as HTMLElement;
    if (!b.classList.contains('sym')) return;
    body.querySelectorAll('.sym[tabindex="0"]').forEach((x) => x !== b && x.setAttribute('tabindex', '-1'));
    b.setAttribute('tabindex', '0');
  });

  sheet.append(head, find, cats, body);
  d.append(sheet);
  d.addEventListener('click', (e) => e.target === d && d.close());
  document.body.append(d);
  animateDialog(d);
}

function symButton(s: Sym): HTMLButtonElement {
  const b = h('button', 'sym', s.show ?? s.text);
  b.type = 'button';
  b.tabIndex = -1;
  b.dataset.text = s.text;
  b.title = s.tex.length ? `${s.name} · ${s.tex[0]}` : s.name;
  b.setAttribute('aria-label', s.name);
  if ([...(s.show ?? s.text)].length > 2) b.classList.add('wide');
  return b;
}

function grid(items: Sym[], label: string): HTMLElement {
  const g = h('div', 'sym-grid');
  g.setAttribute('role', 'group');
  g.setAttribute('aria-label', label);
  for (const s of items) g.append(symButton(s));
  return g;
}

function section(id: string, label: string, ...content: HTMLElement[]): HTMLElement {
  const s = h('section', 'sym-sec');
  s.id = id;
  const t = h('h3', '', label);
  s.append(t, ...content);
  return s;
}

function renderBrowse(): void {
  const groups = categories();
  const recent = loadRecent();
  const parts: HTMLElement[] = [];
  const chips: [string, string][] = [];
  if (recent.length) {
    const own = loadCustom();
    parts.push(section('sym-recent', 'Recent', grid(recent.map((t) => own.find((c) => c.text === t) ? asSym(own.find((c) => c.text === t)!) : describe(t)), 'Recent')));
    chips.push(['sym-recent', 'Recent']);
  }
  parts.push(mine());
  chips.push(['sym-mine', 'Yours']);
  for (const c of groups) {
    parts.push(section(`sym-${c.id}`, c.label, grid(c.items, c.label)));
    chips.push([`sym-${c.id}`, c.label]);
  }
  const all = section('sym-all', 'Every symbol');
  const more = h('button', 'nb-btn sym-more', `Show all ${UNICODE_COUNT.toLocaleString()}`);
  more.type = 'button';
  more.addEventListener('click', showAll);
  all.append(more);
  parts.push(all);
  chips.push(['sym-all', 'Every symbol']);
  body.replaceChildren(...parts);
  cats.replaceChildren(
    ...chips.map(([to, label]) => {
      const b = h('button', '', label);
      b.type = 'button';
      b.dataset.to = to;
      return b;
    }),
  );
  cats.hidden = false;
  body.querySelector('.sym')?.setAttribute('tabindex', '0');
}

/** Every Unicode math symbol, block by block (built on request: a couple of thousand keys). */
function showAll(): void {
  const all = document.getElementById('sym-all');
  if (!all || all.dataset.full) return;
  all.dataset.full = '1';
  const parts: HTMLElement[] = [];
  for (const b of unicodeBlocks()) {
    const sub = h('div', 'sym-block');
    sub.append(h('h4', '', b.label), grid(b.items, b.label));
    parts.push(sub);
  }
  all.replaceChildren(all.firstElementChild!, ...parts);
}

function renderSearch(): void {
  const q = searchBox.value;
  const found = search(q, loadCustom().map(asSym));
  cats.hidden = true;
  const head = h('p', 'sym-count', found.length ? `${found.length === 150 ? '150+' : found.length} ${found.length === 1 ? 'match' : 'matches'}` : 'No symbols match. Try another word, or add your own.');
  head.setAttribute('role', 'status');
  body.replaceChildren(head, ...(found.length ? [grid(found, 'Matches')] : [mine()]));
  body.querySelector('.sym')?.setAttribute('tabindex', '0');
}

// ---------- your own symbols ----------
function mine(): HTMLElement {
  const own = loadCustom();
  const sec = section('sym-mine', 'Yours');
  const list = h('div', 'sym-mine');
  for (const c of own) {
    const row = h('div', 'sym-mine-row');
    const b = symButton(asSym(c));
    const what = h('span', 'sym-mine-name', c.name || c.text);
    if (c.value) what.append(h('small', '', ` = ${c.value}`));
    const edit = h('button', 'icon-btn');
    edit.type = 'button';
    edit.setAttribute('aria-label', `Edit ${c.name || c.text}`);
    edit.innerHTML = icon('M4 20h4L19 9l-4-4L4 16zM14 6l4 4');
    edit.addEventListener('click', () => row.replaceWith(form(sec, c)));
    const del = h('button', 'icon-btn');
    del.type = 'button';
    del.setAttribute('aria-label', `Delete ${c.name || c.text}`);
    del.innerHTML = icon('M6 6l12 12M18 6L6 18');
    del.addEventListener('click', () => {
      saveCustom(loadCustom().filter((x) => x.id !== c.id));
      changed?.();
      refresh();
    });
    row.append(b, what, edit, del);
    list.append(row);
  }
  const add = h('button', 'nb-btn sym-add', '+ Add your own');
  add.type = 'button';
  add.addEventListener('click', () => {
    add.replaceWith(form(sec, null));
  });
  if (!own.length) list.append(h('p', 'hint1', 'Save any symbol or snippet you use often.'));
  sec.append(list, add);
  return sec;
}

function form(sec: HTMLElement, editing: CustomSymbol | null): HTMLElement {
  const f = h('form', 'sym-form');
  f.setAttribute('aria-label', editing ? 'Edit symbol' : 'Add a symbol');
  const field = (label: string, name: string, value: string, placeholder: string) => {
    const l = h('label', 'row', label);
    const i = h('input');
    i.name = name;
    i.value = value;
    i.placeholder = placeholder;
    i.autocomplete = 'off';
    i.spellcheck = false;
    l.append(i);
    f.append(l);
    return i;
  };
  const text = field('Symbol', 'text', editing?.text ?? '', 'ψ or any text');
  const name = field('Name', 'name', editing?.name ?? '', 'what you call it');
  const value = field('Value', 'value', editing?.value ?? '', 'optional, e.g. 1.618');
  text.required = true;
  const btns = h('div', 'row sym-form-btns');
  const cancel = h('button', 'nb-btn', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', refresh);
  const save = h('button', 'nb-btn primary', 'Save');
  save.type = 'submit';
  btns.append(h('span'), cancel, save);
  f.append(btns);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const t = text.value.trim();
    if (!t) return text.focus();
    const entry: CustomSymbol = { id: editing?.id ?? Math.random().toString(36).slice(2, 10), text: t, name: name.value.trim(), updated: Date.now() };
    const v = value.value.trim();
    if (v) entry.value = v;
    const list = loadCustom().filter((x) => x.id !== entry.id);
    saveCustom(editing ? loadCustom().map((x) => (x.id === entry.id ? entry : x)) : [...list, entry]);
    changed?.();
    refresh();
    sec.querySelector<HTMLElement>(`.sym[data-text="${CSS.escape(t)}"]`)?.focus();
  });
  queueMicrotask(() => text.focus());
  play(f, [{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], D2, 'panels');
  return f;
}

function refresh(): void {
  const old = document.getElementById('sym-mine');
  if (old && !searchBox.value.trim()) old.replaceWith(mine());
  else if (searchBox.value.trim()) renderSearch();
}

// ---------- inserting ----------
function insert(text: string): void {
  noteRecent(text);
  const f = target && target.isConnected && !target.disabled ? target : null;
  dialog!.close();
  if (!f) return;
  f.focus();
  const start = f.selectionStart ?? f.value.length;
  const end = f.selectionEnd ?? start;
  f.setRangeText(text, start, end, 'end');
  f.dispatchEvent(new Event('input', { bubbles: true }));
}

// ---------- keyboard ----------
function focusSym(b: HTMLElement): void {
  b.focus();
  b.scrollIntoView({ block: 'nearest' });
}

function onGridKey(e: KeyboardEvent): void {
  const cur = e.target as HTMLElement;
  if (!cur.classList?.contains('sym')) return;
  const all = [...body.querySelectorAll<HTMLElement>('.sym')].filter((b) => b.offsetParent !== null);
  const i = all.indexOf(cur);
  let next: HTMLElement | undefined;
  if (e.key === 'ArrowRight') next = all[i + 1];
  else if (e.key === 'ArrowLeft') next = all[i - 1];
  else if (e.key === 'Home') next = all[0];
  else if (e.key === 'End') next = all.at(-1);
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const r = cur.getBoundingClientRect();
    const down = e.key === 'ArrowDown';
    let bestRow = Infinity;
    let best: HTMLElement | undefined;
    let bestDx = Infinity;
    for (const b of all) {
      const q = b.getBoundingClientRect();
      const dy = down ? q.top - r.top : r.top - q.top;
      if (dy < 4) continue;
      const dx = Math.abs(q.left - r.left);
      if (dy < bestRow - 4 || (Math.abs(dy - bestRow) <= 4 && dx < bestDx)) {
        bestRow = dy;
        bestDx = dx;
        best = b;
      }
    }
    next = best;
    if (!next && !down) {
      e.preventDefault();
      return searchBox.focus();
    }
  } else return;
  e.preventDefault();
  if (next) focusSym(next);
}
