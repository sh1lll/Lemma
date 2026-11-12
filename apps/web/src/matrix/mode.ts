import './matrix.css';
import { calculate, createSession } from '@lemma/math-core';
import { MathKeyboard, type Field } from '../keyboard/keyboard';
import { K } from '../keyboard/layouts';
import type { Key, Pane } from '../keyboard/types';
import { evaluate, parseEntry, type Value } from './expr';
import { fmt, MatrixError, type Matrix, type Num, type NumStyle } from './linalg';
import { loadMatrices, MAX_SIZE, nextName, parseGrid, resize, saveMatrices, type StoredMatrix } from './store';
import { D2, play } from '../motion';

/**
 * Matrix mode: named matrices A, B, C… with editable grids, an expression line (A·B, A⁻¹, det(A), eigen(A)…)
 * and its own keyboard. Everything is computed on the device, exactly where the entries are fractions.
 */

export interface MatrixHost {
  angle: { get(): 'deg' | 'rad'; toggle(): void; watch?: HTMLElement };
  openSymbols(f: Field | null): void;
  toast(msg: string): void;
}

const uid = () => Math.random().toString(36).slice(2, 10);

const fnKey = (l: string, name: string, aria: string): Key => ({ l, ins: `${name}(§)`, aria, c: 'fn' });
const letter = (n: string): Key => ({ l: n, ins: n, c: 'fn it mx-name', k: n.toLowerCase(), aria: `Matrix ${n}` });

function matrixPane(): Pane {
  return {
    strip: [
      fnKey('det', 'det', 'Determinant'),
      fnKey('rref', 'rref', 'Reduced row echelon form'),
      fnKey('trace', 'trace', 'Trace'),
      fnKey('rank', 'rank', 'Rank'),
      fnKey('eigenvalues', 'eigenvalues', 'Eigenvalues'),
      fnKey('eigenvectors', 'eigenvectors', 'Eigenvectors'),
      fnKey('null space', 'nullspace', 'Null space'),
      fnKey('LU', 'lu', 'LU decomposition'),
      fnKey('QR', 'qr', 'QR decomposition'),
      fnKey('inverse', 'inv', 'Inverse of a matrix'),
      fnKey('transpose', 'transpose', 'Transpose of a matrix'),
      fnKey('identity', 'identity', 'Identity matrix of size n'),
    ],
    blocks: [
      {
        cols: 4,
        cls: 'fns',
        keys: [
          ...'ABCDEFGH'.split('').map(letter),
          { l: 'A²', ins: '^2', aria: 'Square', c: 'fn' },
          { l: 'A⁻¹', ins: '^-1', aria: 'Inverse', c: 'fn' },
          { l: 'Aᵀ', ins: '^T', aria: 'Transpose', c: 'fn' },
          { l: 'Aⁿ', ins: '^(§)', aria: 'Power', c: 'fn' },
          K.sqrt,
          { l: ',', ins: ', ', aria: 'Comma', c: 'fn', k: ',' },
          { l: '[', ins: '[', aria: 'Open bracket', c: 'fn', k: '[' },
          { l: ']', ins: ']', aria: 'Close bracket', c: 'fn', k: ']' },
        ],
      },
      {
        cols: 4,
        cls: 'digits',
        keys: [
          ...'789'.split('').map((d) => ({ l: d, ins: d, c: 'num', k: d })),
          { l: '÷', ins: '/', aria: 'Divide', c: 'op', k: '/' },
          ...'456'.split('').map((d) => ({ l: d, ins: d, c: 'num', k: d })),
          { l: '×', ins: '·', aria: 'Times', c: 'op', k: '*' },
          ...'123'.split('').map((d) => ({ l: d, ins: d, c: 'num', k: d })),
          { l: '−', ins: '-', aria: 'Minus', c: 'op', k: '-' },
          { l: '0', ins: '0', c: 'num', k: '0' },
          { l: '.', ins: '.', aria: 'Point', c: 'num', k: '.' },
          { l: 'ans', ins: 'ans', aria: 'Previous answer', c: 'op' },
          { l: '+', ins: '+', aria: 'Plus', c: 'op', k: '+' },
        ],
      },
      {
        cols: 2,
        cls: 'side',
        keys: [{ l: '(', ins: '(', c: 'op', k: '(' }, { l: ')', ins: ')', c: 'op', k: ')' }, K.left, K.right, { ...K.back, s: 2 }, { ...K.enter, s: 2 }],
      },
    ],
  };
}

function el<T extends keyof HTMLElementTagNameMap>(tag: T, cls = '', text = ''): HTMLElementTagNameMap[T] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
function btn(cls: string, text: string, aria = text): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  b.setAttribute('aria-label', aria);
  return b;
}

/** Shows a matrix between soft brackets. */
export function matrixView(m: Matrix, style: NumStyle): HTMLElement {
  const box = el('div', 'mx-mat');
  box.setAttribute('role', 'table');
  box.style.gridTemplateColumns = `repeat(${m[0]?.length ?? 1}, auto)`;
  m.forEach((r) => r.forEach((x) => box.append(el('span', 'mx-cell', fmt(x, style)))));
  box.setAttribute('aria-label', `${m.length} by ${m[0]?.length ?? 0} matrix: ${m.map((r) => r.map((x) => fmt(x, style)).join(', ')).join('; ')}`);
  return box;
}

function valueView(v: Value, style: NumStyle): HTMLElement {
  if (v.t === 'scalar') return el('span', 'mx-num', fmt(v.v, style));
  if (v.t === 'matrix') return matrixView(v.v, style);
  const box = el('div', 'mx-parts');
  for (const p of v.parts) {
    const row = el('div', 'mx-part');
    if (p.label) row.append(el('span', 'mx-part-label', p.label));
    if (typeof p.value === 'string') {
      if (p.value) row.append(el('span', 'mx-num', p.value.replace(/-/g, '−')));
    } else if (Array.isArray(p.value)) row.append(matrixView(p.value, style));
    else row.append(el('span', 'mx-num', fmt(p.value as Num, style)));
    box.append(row);
  }
  return box;
}

/** Text a stored matrix keeps for an entry: exact fractions stay exact. */
const entryText = (x: Num): string => (typeof x === 'number' ? String(Number(x.toPrecision(15))) : x.d === 1n ? x.n.toString() : `${x.n}/${x.d}`);

export class MatrixMode {
  readonly root: HTMLElement;
  private list: StoredMatrix[] = loadMatrices();
  private listEl: HTMLElement;
  private input: HTMLInputElement;
  private exprEl: HTMLElement;
  private resultEl: HTMLElement;
  private actionsEl: HTMLElement;
  private historyEl: HTMLOListElement;
  private style: NumStyle = 'fraction';
  private ans: Value | undefined;
  private shown: { expr: string; value: Value } | null = null;
  private saveTimer = 0;
  readonly keyboard: MathKeyboard;

  constructor(private host: MatrixHost) {
    this.root = el('section', 'mx');
    this.root.setAttribute('aria-label', 'Matrices');

    const head = el('div', 'mx-head');
    const title = el('h2', 'mx-title', 'Matrices');
    const add = btn('nb-btn mx-new', '+ New matrix');
    add.addEventListener('click', () => this.create());
    head.append(title, add);

    this.listEl = el('div', 'mx-list');

    const calc = el('div', 'mx-calc');
    this.exprEl = el('div', 'mx-expr');
    this.resultEl = el('div', 'mx-result');
    this.resultEl.setAttribute('aria-live', 'polite');
    this.resultEl.title = 'Tap to switch fractions and decimals';
    this.resultEl.addEventListener('click', () => this.toggleStyle());
    this.actionsEl = el('div', 'mx-actions');
    const form = el('form', 'mx-ask');
    form.autocomplete = 'off';
    this.input = el('input', 'mx-input');
    this.input.type = 'text';
    this.input.spellcheck = false;
    this.input.setAttribute('autocapitalize', 'characters');
    this.input.setAttribute('autocorrect', 'off');
    this.input.setAttribute('enterkeyhint', 'go');
    this.input.setAttribute('aria-label', 'Matrix expression');
    this.input.placeholder = 'A·B, A⁻¹, det(A), eigenvalues(A)…';
    form.append(this.input);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.commit();
    });
    this.input.addEventListener('input', () => this.preview());
    calc.append(this.exprEl, this.resultEl, this.actionsEl, form);

    this.keyboard = new MathKeyboard({
      label: 'Matrix keyboard',
      accepts: (f) => this.root.contains(f),
      fallback: () => this.input,
      tabs: [
        { id: 'matrix', label: 'matrix', pane: matrixPane },
        { id: 'main', label: 'main', pane: () => import('../keyboard/layouts').then((m) => m.mainPane()) },
        { id: 'func', label: 'func', pane: () => import('../keyboard/layouts-more').then((m) => m.funcPane()) },
      ],
      enter: (f) => (f === this.input ? this.commit() : this.nextCell(f as HTMLInputElement)),
      openSymbols: (f) => host.openSymbols(f),
      angle: host.angle,
    });
    const kbBox = el('div', 'mx-kb');
    kbBox.append(this.keyboard.root);

    const hist = el('section', 'mx-history');
    const hh = el('h3', '', 'Results');
    this.historyEl = el('ol');
    hist.append(hh, this.historyEl);

    this.root.append(head, this.listEl, calc, kbBox, hist);
    this.renderList();
    this.renderResult();
    window.addEventListener('storage', (e) => {
      if (e.key === 'lemma.matrices.v1') {
        this.list = loadMatrices();
        this.renderList();
      }
    });
  }

  focus(): void {
    this.input.focus({ preventScroll: true });
  }

  // ---------- matrices ----------
  private persist(now = false): void {
    clearTimeout(this.saveTimer);
    const run = () => {
      if (!saveMatrices(this.list)) this.host.toast('Couldn’t save matrices on this device (storage is full or blocked)');
    };
    if (now) run();
    else this.saveTimer = window.setTimeout(run, 250);
  }

  create(rows?: string[][]): StoredMatrix | null {
    const name = nextName(this.list);
    if (!name) {
      this.host.toast('Every letter is taken. Delete a matrix to make room');
      return null;
    }
    const m: StoredMatrix = { id: uid(), name, rows: rows ?? resize([], 2, 2), updated: Date.now() };
    this.list.push(m);
    this.list.sort((a, b) => a.name.localeCompare(b.name));
    this.persist(true);
    this.renderList();
    const card = this.listEl.querySelector<HTMLElement>(`[data-name="${name}"]`);
    if (card) play(card, [{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], D2, 'answers');
    if (!rows) card?.querySelector<HTMLInputElement>('.mx-in')?.focus();
    return m;
  }

  private matrixOf(name: string): Matrix | undefined {
    const m = this.list.find((x) => x.name === name);
    if (!m) return undefined;
    return m.rows.map((r, i) =>
      r.map((t, j) => {
        const v = parseEntry(t, { scalar: (s) => this.scalar(s) });
        if (v === null) throw new MatrixError(`${name}: row ${i + 1}, column ${j + 1} (“${t}”) isn’t a number`);
        return v;
      }),
    );
  }

  private scalar(text: string): number | null {
    const s = createSession();
    s.angle = this.host.angle.get();
    const r = calculate(text, s);
    return r.ok ? r.value.toNumber() : null;
  }

  private renderList(): void {
    this.listEl.replaceChildren(...this.list.map((m) => this.card(m)));
    if (!this.list.length) {
      const empty = el('p', 'mx-empty', 'No matrices yet. “New matrix” makes A, then B, C…');
      this.listEl.append(empty);
    }
  }

  private card(m: StoredMatrix): HTMLElement {
    const card = el('div', 'mx-card');
    card.dataset.name = m.name;
    const head = el('div', 'mx-card-head');
    const name = el('span', 'mx-badge', m.name);
    const sizeBox = el('div', 'mx-size');
    const select = (value: number, label: string) => {
      const s = el('select', 'mx-dim');
      s.setAttribute('aria-label', `${label} of ${m.name}`);
      for (let i = 1; i <= MAX_SIZE; i++) {
        const o = el('option', '', String(i));
        o.value = String(i);
        s.append(o);
      }
      s.value = String(value);
      return s;
    };
    const rs = select(m.rows.length, 'Rows');
    const cs = select(m.rows[0]?.length ?? 1, 'Columns');
    const onSize = () => {
      m.rows = resize(m.rows, Number(rs.value), Number(cs.value));
      m.updated = Date.now();
      this.persist();
      card.replaceWith(this.card(m));
      this.preview();
    };
    rs.addEventListener('change', onSize);
    cs.addEventListener('change', onSize);
    sizeBox.append(rs, el('span', 'mx-times', '×'), cs);
    const use = btn('link mx-use', 'Use', `Insert ${m.name} in the expression`);
    use.addEventListener('pointerdown', (e) => e.preventDefault());
    use.addEventListener('click', () => {
      const i = this.input;
      const at = i.selectionStart ?? i.value.length;
      i.setRangeText(m.name, at, i.selectionEnd ?? at, 'end');
      i.focus();
      this.preview();
    });
    const del = btn('icon-btn mx-del', '', `Delete matrix ${m.name}`);
    del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    del.addEventListener('click', () => {
      this.list = this.list.filter((x) => x !== m);
      this.persist(true);
      this.renderList();
      this.preview();
      this.host.toast(`Deleted ${m.name}`);
    });
    head.append(name, sizeBox, use, del);

    const grid = el('div', 'mx-grid');
    grid.style.gridTemplateColumns = `repeat(${m.rows[0]?.length ?? 1}, 54px)`;
    m.rows.forEach((row, i) =>
      row.forEach((t, j) => {
        const inp = el('input', 'mx-in');
        inp.type = 'text';
        inp.value = t;
        inp.placeholder = '0';
        inp.spellcheck = false;
        inp.autocomplete = 'off';
        inp.setAttribute('autocorrect', 'off');
        inp.setAttribute('enterkeyhint', 'next');
        inp.setAttribute('aria-label', `${m.name} row ${i + 1} column ${j + 1}`);
        inp.dataset.r = String(i);
        inp.dataset.c = String(j);
        inp.addEventListener('input', () => {
          m.rows[i]![j] = inp.value;
          m.updated = Date.now();
          const bad = inp.value.trim() !== '' && parseEntry(inp.value, { scalar: (s) => this.scalar(s) }) === null;
          inp.classList.toggle('bad', bad);
          inp.title = bad ? 'Not a number yet' : '';
          this.persist();
          this.preview();
        });
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.nextCell(inp);
          }
        });
        inp.addEventListener('paste', (e) => {
          const text = e.clipboardData?.getData('text/plain') ?? '';
          const data = parseGrid(text);
          if (!data) return;
          e.preventDefault();
          this.pasteInto(m, i, j, data);
        });
        grid.append(inp);
      }),
    );
    card.append(head, grid);
    return card;
  }

  /** Pasted rows land from the cell onwards, growing the matrix to fit (up to 10×10). */
  private pasteInto(m: StoredMatrix, r: number, c: number, data: string[][]): void {
    const rows = Math.min(MAX_SIZE, Math.max(m.rows.length, r + data.length));
    const cols = Math.min(MAX_SIZE, Math.max(m.rows[0]?.length ?? 1, c + Math.max(...data.map((d) => d.length))));
    m.rows = resize(m.rows, rows, cols);
    data.forEach((row, i) => row.forEach((t, j) => r + i < rows && c + j < cols && (m.rows[r + i]![c + j] = t)));
    m.updated = Date.now();
    this.persist(true);
    const card = this.listEl.querySelector(`[data-name="${m.name}"]`);
    card?.replaceWith(this.card(m));
    this.host.toast(`Pasted ${data.length}×${data[0]!.length} into ${m.name}`);
    this.preview();
  }

  private nextCell(inp: HTMLInputElement): void {
    const cells = [...this.root.querySelectorAll<HTMLInputElement>('.mx-in')];
    const i = cells.indexOf(inp);
    const card = inp.closest('.mx-card');
    const next = cells[i + 1];
    if (next && next.closest('.mx-card') === card) next.focus();
    else this.input.focus();
  }

  // ---------- expressions ----------
  private env() {
    return { matrix: (n: string) => this.matrixOf(n), ans: this.ans, scalar: (t: string) => this.scalar(t) };
  }

  private preview(): void {
    const text = this.input.value.trim();
    if (!text) {
      this.renderResult();
      return;
    }
    try {
      const value = evaluate(text, this.env());
      this.shown = { expr: text, value };
      this.renderResult(true);
    } catch {
      this.resultEl.classList.add('stale');
    }
  }

  commit(): void {
    const text = this.input.value.trim();
    if (!text) return;
    try {
      const value = evaluate(text, this.env());
      this.shown = { expr: text, value };
      if (value.t !== 'parts') this.ans = value;
      this.addHistory(text, value);
      this.input.value = '';
      this.renderResult();
      play(this.resultEl, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], 160, 'answers');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.exprEl.textContent = text;
      this.resultEl.className = 'mx-result error';
      this.resultEl.replaceChildren(el('span', 'mx-error', msg));
      this.actionsEl.replaceChildren();
      play(this.input, [{ transform: 'none' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], 240, 'feedback');
    }
  }

  private renderResult(preview = false): void {
    this.resultEl.className = `mx-result${preview ? ' preview' : ''}`;
    this.actionsEl.replaceChildren();
    if (!this.shown) {
      this.exprEl.textContent = ' ';
      this.resultEl.replaceChildren(el('span', 'mx-hint', this.list.length ? 'Type A·B, A⁻¹ or det(A), then Enter' : 'Start with “New matrix”'));
      return;
    }
    const { expr, value } = this.shown;
    this.exprEl.textContent = `${expr.replace(/\*/g, '·')}${preview ? '' : ' ='}`;
    this.resultEl.replaceChildren(valueView(value, this.style));
    if (preview) return;
    if (value.t === 'matrix') {
      const store = btn('chip mx-store', `Store as ${nextName(this.list) ?? '…'}`, 'Store the result as a new matrix');
      store.addEventListener('click', () => {
        const made = this.create(value.v.map((r) => r.map(entryText)));
        if (made) this.host.toast(`Stored as ${made.name}`);
        this.renderResult();
      });
      this.actionsEl.append(store);
    }
    const style = btn('chip mx-style', this.style === 'fraction' ? 'Decimals' : 'Fractions', 'Switch fractions and decimals');
    style.addEventListener('click', () => this.toggleStyle());
    this.actionsEl.append(style);
  }

  private toggleStyle(): void {
    this.style = this.style === 'fraction' ? 'decimal' : 'fraction';
    if (this.shown) this.renderResult(this.resultEl.classList.contains('preview'));
  }

  private addHistory(expr: string, value: Value): void {
    const li = el('li');
    const b = btn('mx-h', '', `Use ${expr} again`);
    b.append(el('span', 'mx-h-in', expr.replace(/\*/g, '·')));
    const out = el('span', 'mx-h-out');
    out.textContent = value.t === 'scalar' ? fmt(value.v) : value.t === 'matrix' ? `${value.v.length}×${value.v[0]?.length ?? 0} matrix` : value.title;
    b.append(out);
    b.addEventListener('click', () => {
      this.input.value = expr;
      this.input.focus();
      this.preview();
    });
    li.append(b);
    this.historyEl.prepend(li);
    while (this.historyEl.children.length > 30) this.historyEl.lastElementChild?.remove();
  }
}
