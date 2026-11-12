import { compileFloat, type Session } from '@lemma/math-core';
import { buildRows, columnName, fmtValue, infer, inferItems, type BuildResult, type GraphItem, type InferInput, type Poi, type RowOut, type Slider } from '@lemma/graph-engine';
import { GraphView, type ViewSettings } from '../graph/view';
import { D2, glide, play, snapshot } from '../motion';
import { getImage, pruneImages, putImage, decode } from './images';
import { emptyState, load, order, sanitize, save, type ExprRow, type FolderRow, type ImageRow, type InferRow, type RowState, type RowStyle, type RowType, type SliderOpts, type State, type TableRow } from './model';
import { decodeState, download, shareLink } from './share';
import { btn, check, dismissable, field, h, ICON, segmented } from './ui';
import './graphing.css';

/**
 * Graphing mode: a list of rows beside one graph that stays on screen the whole time. Rows are expressions (curves,
 * equations, inequalities, points, sliders, definitions, regressions), notes, tables, inference tests, folders and
 * pictures. A row that doesn't parse while it's being edited keeps its last good drawing (faded) with a short hint;
 * the rest of the graph is untouched. Re-plots are lightly debounced. The workspace has its own undo history,
 * share links, graph settings and a 3D view.
 */

interface Host {
  session: Session;
  openSymbols(field: HTMLInputElement): void;
}

interface RowView {
  el: HTMLLIElement;
  input: HTMLInputElement | HTMLTextAreaElement | null;
  dot: HTMLButtonElement | null;
  hint: HTMLElement;
  value: HTMLElement;
  desc: HTMLElement;
  body: HTMLElement;
  /** Slider controls (expression rows that are "a = 2"). */
  slider: HTMLElement | null;
  range: HTMLInputElement | null;
  pop: HTMLElement | null;
  /** Last version that drew something, kept while the row is mid-edit. */
  good: GraphItem[] | null;
  error: string | null;
  sliderName: string | null;
  sliderValue: number;
  sliderStale: boolean;
  playing: number;
  closePop?: () => void;
}

const PALETTE = 6;
const PLACEHOLDERS = ['y = x²', 'x² + y² = 9', 'y > sin(x)', '(1, 2)', 'a = 3', 'r = 1 + cos(θ)'];
const TYPE_NAME: Record<RowType, string> = { expr: 'Expression', note: 'Note', table: 'Table', infer: 'Inference', folder: 'Folder', image: 'Image' };
const TEST_NAME: Record<InferRow['test'], string> = { t1: 'One-sample t', z1: 'One-sample z', t2: 'Two-sample t', p1: 'One proportion' };
const D3_KINDS = new Set<GraphItem['kind']>(['surface', 'implicit3d', 'curve3d', 'psurface', 'point3d', 'vector3d']);

const num = (s: string | undefined): number | undefined => {
  if (s === undefined || s.trim() === '') return undefined;
  const v = Number(s.replace(/−/g, '-'));
  return Number.isFinite(v) ? v : undefined;
};
const tidyNum = (v: number) => Number(v.toPrecision(10));

export class GraphingWorkspace {
  readonly root: HTMLElement;
  private list: HTMLOListElement;
  private view: GraphView;
  private graph: HTMLElement;
  private state: State;
  private views = new Map<number, RowView>();
  private nextId = 1;
  private timer = 0;
  private hintTimer = 0;
  private saveTimer = 0;
  private fitTimer = 0;
  private commitTimer = 0;
  private committed: string;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private lastText = new Map<number, string>();
  private lastFocused: RowView | null = null;
  private result: BuildResult | null = null;
  private images = new Map<string, HTMLImageElement | null>();
  private scene: import('../graph/scene3d').Scene3D | null = null;
  private sceneLoading: Promise<void> | null = null;
  private panel: HTMLElement | null = null;
  private closePanel: (() => void) | null = null;
  private undoBtn: HTMLButtonElement;
  private redoBtn: HTMLButtonElement;
  private dimSeg!: HTMLElement;
  private inferView = new Map<number, string>();

  constructor(private host: Host) {
    this.root = h('section', 'gw', { 'aria-label': 'Graphing' });
    const side = h('div', 'gw-side');
    this.list = h('ol', 'gw-rows', { 'aria-label': 'Expressions' });
    const foot = h('div', 'gw-foot');
    const add = btn(`${ICON.plus}<span>Add</span>`, 'nb-btn gw-add', () => this.toggleAddMenu(add), 'Add a row');
    add.setAttribute('aria-haspopup', 'menu');
    add.setAttribute('aria-expanded', 'false');
    this.undoBtn = btn(ICON.undo, 'icon-btn gw-undo', () => this.undo(), 'Undo');
    this.redoBtn = btn(ICON.redo, 'icon-btn gw-redo', () => this.redo(), 'Redo');
    const sym = btn('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg><span>Symbols</span>', 'sym-open', () => {
      const f = (this.lastFocused?.input ?? [...this.views.values()].find((v) => v.input instanceof HTMLInputElement)?.input) as HTMLInputElement | undefined;
      if (f) this.host.openSymbols(f);
    }, 'Symbols');
    sym.addEventListener('pointerdown', (e) => e.preventDefault());
    const share = btn(ICON.share, 'icon-btn gw-share-btn', () => this.togglePanel('share', share), 'Share or export');
    foot.append(add, h('span', 'gw-foot-gap'), this.undoBtn, this.redoBtn, share, sym);
    side.append(this.list, foot);

    this.view = new GraphView({ items: [], sliders: [], notes: [] });
    this.view.lockView = true;
    this.view.autoFit = true;
    this.view.colorOf = (id) => this.rowOf(id)?.color ?? id;
    this.view.styleOf = (id) => this.rowOf(id)?.style;
    this.view.onPointDrag = (it, x, y, done) => this.dragPoint(it, x, y, done);
    this.view.onView = (vp) => {
      this.state.view = this.view.moved ? vp : undefined;
      this.syncRangeInputs();
      this.save();
    };
    this.view.onPois = (pois) => this.describe(pois);
    const wrench = btn(ICON.wrench, 'gw-tool', () => this.togglePanel('settings', wrench), 'Graph settings');
    const fit = btn(ICON.fit, 'gw-tool', () => this.view.zoomFit(), 'Zoom to fit');
    this.view.tools.prepend(wrench);
    this.view.tools.append(fit);
    this.graph = h('div', 'gw-graph');
    this.dimSeg = segmented('Dimensions', [['2d', '2D'], ['3d', '3D']], '2d', (v) => this.setDim(v));
    this.dimSeg.classList.add('gw-dim');
    this.graph.append(this.view.root, this.dimSeg);
    this.root.append(this.graph, side);

    this.root.addEventListener('keydown', (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        this.undo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        this.redo();
      }
    });

    window.addEventListener('pagehide', () => this.saveTimer && this.saveNow());
    this.state = load();
    this.committed = this.snap();
    this.applyState(true);
    const hash = location.hash;
    if (hash.startsWith('#graph=')) void this.openLink(hash.slice(7));
    void pruneImages(new Set(this.state.rows.filter((r): r is ImageRow => r.type === 'image').map((r) => r.key)));
  }

  /** Focus the first empty row (or the last one) when the mode opens. */
  focus(): void {
    const empty = this.state.rows.find((r) => r.type === 'expr' && !r.text);
    const v = this.views.get(empty?.id ?? this.state.rows.at(-1)!.id);
    v?.input?.focus({ preventScroll: true });
  }

  // ---------- state ----------
  private snap(): string {
    const { view: _v, ...rest } = this.state;
    return JSON.stringify(rest);
  }

  private rowOf(id: number): RowState | undefined {
    return this.state.rows.find((r) => r.id === id);
  }

  /** Records a step for undo (call after a change; typing is grouped until a pause). */
  private commit(): void {
    clearTimeout(this.commitTimer);
    this.commitTimer = 0;
    const s = this.snap();
    if (s === this.committed) return;
    this.undoStack.push(this.committed);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.committed = s;
    this.redoStack = [];
    this.updateUndoButtons();
  }
  private commitSoon(): void {
    clearTimeout(this.commitTimer);
    this.commitTimer = window.setTimeout(() => this.commit(), 600);
  }

  private undo(): void {
    if (this.commitTimer) this.commit();
    const prev = this.undoStack.pop();
    if (prev === undefined) return;
    this.redoStack.push(this.committed);
    this.committed = prev;
    this.restore(prev);
  }
  private redo(): void {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(this.committed);
    this.committed = next;
    this.restore(next);
  }
  private restore(json: string): void {
    const focusId = this.lastFocused ? [...this.views.entries()].find(([, v]) => v === this.lastFocused)?.[0] : undefined;
    const s = sanitize(JSON.parse(json));
    if (!s) return;
    this.state = { ...s, view: this.state.view };
    this.applyState(false);
    this.updateUndoButtons();
    if (focusId !== undefined) {
      const v = this.views.get(focusId);
      if (v?.input) {
        v.input.focus({ preventScroll: true });
        const n = v.input.value.length;
        v.input.setSelectionRange(n, n);
      }
    }
    this.save();
  }
  private updateUndoButtons(): void {
    this.undoBtn.disabled = !this.undoStack.length && !this.commitTimer;
    this.redoBtn.disabled = !this.redoStack.length;
  }

  /** Rebuilds every row and the graph from `this.state`. */
  private applyState(initial: boolean): void {
    for (const v of this.views.values()) cancelAnimationFrame(v.playing);
    this.views.clear();
    this.list.replaceChildren();
    this.nextId = Math.max(0, ...this.state.rows.map((r) => r.id)) + 1;
    for (const r of this.state.rows) this.list.append(this.buildRow(r, false).el);
    this.label();
    this.view.setSettings(this.state.settings);
    this.loadImages();
    this.replot();
    if (initial && this.state.view) this.view.setView(this.state.view);
    else if (initial) this.view.zoomFit();
    this.setDim(this.state.dim, false);
    this.updateUndoButtons();
  }

  /** Saves soon (at most every 250 ms, never postponed indefinitely), and on leaving the page. */
  private save(): void {
    if (this.saveTimer) return;
    this.saveTimer = window.setTimeout(() => this.saveNow(), 250);
  }
  private saveNow(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    save(this.state);
  }

  /** Opens a shared link's workspace (the current one stays one Undo away). */
  private async openLink(code: string): Promise<void> {
    const s = await decodeState(code);
    history.replaceState(null, '', location.pathname + location.search);
    if (!s) return;
    if (this.commitTimer) this.commit();
    this.state = { ...s };
    this.applyState(false);
    if (s.view) this.view.setView(s.view);
    this.commit();
    this.save();
  }

  // ---------- rows ----------
  private newRow(type: RowType, at: number, init: Partial<RowState> = {}): RowState {
    const id = this.nextId++;
    const used = new Set(this.state.rows.map((r) => r.color));
    const color = [...Array(PALETTE).keys()].find((k) => !used.has(k)) ?? this.state.rows.length % PALETTE;
    const base = { id, color, hidden: false, folder: null };
    let row: RowState;
    switch (type) {
      case 'expr':
        row = { ...base, type, text: '' };
        break;
      case 'note':
        row = { ...base, type, text: '' };
        break;
      case 'table': {
        const taken = new Set<string>();
        for (const r of this.state.rows) if (r.type === 'table') for (const c of r.cols) taken.add(columnName(c.name) ?? '');
        let k = 1;
        while (taken.has(`x_${k}`) || taken.has(`y_${k}`)) k++;
        const sub = String(k).replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[Number(d)]!);
        row = { ...base, type, cols: [{ name: `x${sub}`, values: [null, null, null] }, { name: `y${sub}`, values: [null, null, null] }], connect: false };
        break;
      }
      case 'infer':
        row = { ...base, type, test: 't1', mode: 'test', input: 'stats', data: '', data2: '', stats: { mean: '52', sd: '8', n: '25' }, h0: '50', alt: 'ne', level: '0.95' };
        break;
      case 'folder':
        row = { ...base, type, title: 'Folder', collapsed: false };
        break;
      case 'image': {
        const v = this.view.getView();
        row = { ...base, type, name: '', key: '', x: (v.xMin + v.xMax) / 2, y: (v.yMin + v.yMax) / 2, w: (v.xMax - v.xMin) / 2, h: (v.xMax - v.xMin) / 2, opacity: 0.6 };
        break;
      }
    }
    Object.assign(row, init);
    this.state.rows.splice(at, 0, row);
    return row;
  }

  private addRow(type: RowType, at = this.state.rows.length, init: Partial<RowState> = {}): RowView {
    const row = this.newRow(type, at, init);
    const v = this.buildRow(row, true);
    this.list.insertBefore(v.el, this.list.children[at] ?? null);
    this.label();
    this.commit();
    this.schedule();
    return v;
  }

  private removeRow(row: RowState, focusNext: boolean): void {
    const i = this.state.rows.indexOf(row);
    const v = this.views.get(row.id);
    if (v) cancelAnimationFrame(v.playing);
    // Deleting a folder keeps its rows (they move out of it).
    if (row.type === 'folder') for (const r of this.state.rows) if (r.folder === row.id) r.folder = null;
    this.state.rows.splice(i, 1);
    v?.el.remove();
    this.views.delete(row.id);
    if (!this.state.rows.length) this.list.append(this.buildRow(this.newRow('expr', 0), false).el);
    this.relist();
    this.commit();
    this.replot();
    if (focusNext) this.views.get((this.state.rows[i] ?? this.state.rows[i - 1])!.id)?.input?.focus();
  }

  private duplicate(row: RowState): void {
    const copy = JSON.parse(JSON.stringify(row)) as RowState;
    const at = this.state.rows.indexOf(row) + 1;
    const { id: _id, color: _c, ...rest } = copy;
    const v = this.addRow(row.type, at, { ...rest, folder: row.type === 'folder' ? null : row.folder } as Partial<RowState>);
    v.input?.focus();
  }

  /** Puts the row elements in state order (after reorders and folder changes). */
  private relist(): void {
    this.state.rows = order(this.state.rows);
    for (const r of this.state.rows) {
      const v = this.views.get(r.id);
      if (v) this.list.append(v.el);
    }
    this.label();
  }

  /** Numbered labels for screen readers ("Expression 2"), refreshed when rows move. */
  private label(): void {
    const folders = new Map(this.state.rows.filter((r): r is FolderRow => r.type === 'folder').map((f) => [f.id, f]));
    this.state.rows.forEach((r, i) => {
      const v = this.views.get(r.id);
      if (!v) return;
      const n = i + 1;
      const name = `${TYPE_NAME[r.type].toLowerCase()} ${n}`;
      if (r.type === 'expr' && v.input) {
        v.input.setAttribute('aria-label', `Expression ${n}`);
        (v.input as HTMLInputElement).placeholder = i === 0 && !r.text ? `Type an expression, e.g. ${PLACEHOLDERS[0]}` : PLACEHOLDERS[i % PLACEHOLDERS.length]!;
      }
      v.dot?.setAttribute('aria-pressed', String(!r.hidden));
      v.dot?.setAttribute('aria-label', `${r.hidden ? 'Show' : 'Hide'} ${name}`);
      v.el.querySelector('.gw-del')?.setAttribute('aria-label', `Delete ${name}`);
      v.el.querySelector('.gw-more')?.setAttribute('aria-label', `Options for ${name}`);
      v.el.querySelector('.gw-grip')?.setAttribute('aria-label', `Move ${name} (arrow keys)`);
      v.el.classList.toggle('off', r.hidden);
      const folder = r.folder != null ? folders.get(r.folder) : undefined;
      v.el.classList.toggle('in-folder', !!folder);
      v.el.hidden = !!folder?.collapsed;
      v.el.style.setProperty('--c', r.style?.color || `var(--g${(r.color % PALETTE) + 1})`);
    });
  }

  private buildRow(row: RowState, animate: boolean): RowView {
    const el = h('li', `gw-row gw-${row.type}`, { 'data-id': String(row.id), 'data-type': row.type });
    const grip = btn(ICON.grip, 'gw-grip', () => undefined);
    this.bindGrip(grip, row);
    const body = h('div', 'gw-main');
    const hint = h('p', 'gw-hint');
    hint.hidden = true;
    const value = h('p', 'gw-value');
    value.hidden = true;
    const desc = h('p', 'gw-desc', { id: `gw-desc-${row.id}` });
    const more = btn(ICON.more, 'icon-btn gw-more', () => this.toggleStyle(row, more));
    more.setAttribute('aria-expanded', 'false');
    const del = btn(ICON.close, 'icon-btn gw-del', () => this.removeRow(row, true));
    let dot: HTMLButtonElement | null = null;
    if (row.type !== 'note') {
      dot = btn('', 'gw-dot', () => {
        if (row.type === 'folder') {
          const members = this.state.rows.filter((r) => r.folder === row.id);
          const hide = !(row.hidden || (members.length > 0 && members.every((m) => m.hidden)));
          row.hidden = hide;
          for (const m of members) m.hidden = hide;
        } else row.hidden = !row.hidden;
        this.label();
        this.commit();
        this.replot();
        this.save();
      });
      if (row.type === 'folder') dot.innerHTML = ICON.eye;
    } else dot = null;
    const v: RowView = { el, input: null, dot, hint, value, desc, body, slider: null, range: null, pop: null, good: null, error: null, sliderName: null, sliderValue: 0, sliderStale: false, playing: 0 };
    this.views.set(row.id, v);
    el.append(grip, dot ?? h('span', 'gw-dot-gap'), body, more, del);
    switch (row.type) {
      case 'expr':
        this.buildExpr(row, v);
        break;
      case 'note':
        this.buildNote(row, v);
        break;
      case 'table':
        this.buildTable(row, v);
        break;
      case 'infer':
        this.buildInfer(row, v);
        break;
      case 'folder':
        this.buildFolder(row, v);
        break;
      case 'image':
        this.buildImage(row, v);
        break;
    }
    body.append(value, hint, desc);
    if (v.input) v.input.setAttribute('aria-describedby', desc.id);
    if (animate) play(el, [{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], D2, 'answers');
    return v;
  }

  private focusRow(v: RowView): void {
    this.lastFocused = v;
  }

  private buildExpr(row: ExprRow, v: RowView): void {
    const input = h('input', 'gw-input', { type: 'text', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', enterkeyhint: 'next' });
    input.value = row.text;
    v.input = input;
    input.addEventListener('focus', () => this.focusRow(v));
    input.addEventListener('input', () => {
      row.text = input.value;
      this.commitSoon();
      this.updateUndoButtons();
      this.schedule();
      this.scheduleFit();
    });
    input.addEventListener('keydown', (e) => this.onKey(e, row));
    v.body.append(input);
  }

  private buildNote(row: RowState & { type: 'note' }, v: RowView): void {
    const ta = h('textarea', 'gw-note-input', { rows: '1', 'aria-label': 'Note', placeholder: 'Note' });
    ta.value = row.text;
    const fitH = () => {
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
    };
    ta.addEventListener('input', () => {
      row.text = ta.value;
      fitH();
      this.commitSoon();
      this.save();
    });
    ta.addEventListener('focus', () => this.focusRow(v));
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !ta.value && this.state.rows.length > 1) {
        e.preventDefault();
        this.removeRow(row, true);
      }
    });
    requestAnimationFrame(fitH);
    v.input = ta;
    v.body.append(ta);
  }

  private buildFolder(row: FolderRow, v: RowView): void {
    const caret = btn(ICON.caret, 'gw-caret', () => {
      row.collapsed = !row.collapsed;
      caret.setAttribute('aria-expanded', String(!row.collapsed));
      v.el.classList.toggle('collapsed', row.collapsed);
      this.label();
      this.commit();
      this.save();
    }, 'Collapse folder');
    caret.setAttribute('aria-expanded', String(!row.collapsed));
    v.el.classList.toggle('collapsed', row.collapsed);
    const title = h('input', 'gw-folder-title', { type: 'text', 'aria-label': 'Folder name', spellcheck: 'false' });
    title.value = row.title;
    title.addEventListener('input', () => {
      row.title = title.value;
      this.commitSoon();
      this.save();
    });
    title.addEventListener('focus', () => this.focusRow(v));
    v.input = title;
    v.body.append(h('div', 'gw-folder-head', {}, caret, title));
  }

  private buildTable(row: TableRow, v: RowView): void {
    const wrap = h('div', 'gw-table-wrap');
    const render = () => {
      const table = h('table', 'gw-tbl');
      const head = h('tr');
      row.cols.forEach((c, j) => {
        const inp = h('input', 'gw-th', { type: 'text', 'aria-label': `Column ${j + 1} name`, spellcheck: 'false' });
        inp.value = c.name;
        inp.addEventListener('input', () => {
          c.name = inp.value;
          this.commitSoon();
          this.schedule();
        });
        inp.addEventListener('focus', () => this.focusRow(v));
        head.append(h('th', '', {}, inp));
      });
      const addCol = btn(ICON.plus, 'gw-addcol', () => {
        const names = new Set(row.cols.map((c) => columnName(c.name)));
        const sub = /_(\d+)$/.exec(columnName(row.cols[0]!.name) ?? '')?.[1] ?? '1';
        let k = row.cols.length;
        let name = '';
        const letters = 'yzwuvabcdefgh';
        for (let i = 0; i < letters.length && !name; i++) if (!names.has(`${letters[i]}_${sub}`)) name = `${letters[i]}${sub.replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[Number(d)]!)}`;
        row.cols.push({ name: name || `c${k++}`, values: row.cols[0]!.values.map(() => null) });
        this.commit();
        render();
        this.schedule();
      }, 'Add a column');
      head.append(h('th', 'gw-th-add', {}, addCol));
      const thead = h('thead', '', {}, head);
      const tbody = h('tbody');
      const n = Math.max(...row.cols.map((c) => c.values.length), 0) + 1;
      for (let i = 0; i < n; i++) {
        const tr = h('tr');
        row.cols.forEach((c, j) => {
          const cell = h('input', 'gw-td', { type: 'text', inputmode: 'decimal', 'aria-label': `${c.name} row ${i + 1}`, spellcheck: 'false', autocomplete: 'off' });
          const val = c.values[i];
          cell.value = val === null || val === undefined ? '' : String(val);
          cell.addEventListener('input', () => {
            const parsed = num(cell.value);
            while (c.values.length <= i) c.values.push(null);
            c.values[i] = parsed ?? null;
            for (const o of row.cols) while (o.values.length < c.values.length) o.values.push(null);
            this.commitSoon();
            this.schedule();
            // Typing in the last (blank) row adds another below it.
            if (i === n - 1 && cell.value.trim()) {
              const focusAt = cell.selectionStart ?? cell.value.length;
              render();
              const again = wrap.querySelectorAll<HTMLInputElement>('tbody tr')[i]?.children[j]?.querySelector('input');
              again?.focus();
              again?.setSelectionRange(focusAt, focusAt);
            }
          });
          cell.addEventListener('focus', () => this.focusRow(v));
          cell.addEventListener('keydown', (e) => {
            const move = (di: number, dj: number) => {
              const target = wrap.querySelectorAll<HTMLTableRowElement>('tbody tr')[i + di]?.children[j + dj]?.querySelector('input');
              if (target) {
                e.preventDefault();
                target.focus();
                target.select();
              }
            };
            if (e.key === 'Enter' || (e.key === 'ArrowDown' && !e.altKey)) move(1, 0);
            else if (e.key === 'ArrowUp' && !e.altKey) move(-1, 0);
          });
          tr.append(h('td', '', {}, cell));
        });
        tr.append(h('td'));
        tbody.append(tr);
      }
      table.append(thead, tbody);
      const connect = check('Connect points', row.connect, (on) => {
        row.connect = on;
        this.commit();
        this.replot();
      });
      wrap.replaceChildren(h('div', 'gw-tbl-scroll', {}, table), connect);
      v.input = wrap.querySelector('input');
    };
    render();
    v.body.append(wrap);
  }

  private buildInfer(row: InferRow, v: RowView): void {
    const box = h('div', 'gw-infer-box');
    const out = h('dl', 'gw-infer-out', { 'aria-live': 'polite' });
    const render = () => {
      const test = h('select', 'gw-select', { 'aria-label': 'Test' });
      for (const [k, name] of Object.entries(TEST_NAME)) test.append(h('option', '', { value: k, text: name }));
      test.value = row.test;
      test.addEventListener('change', () => {
        row.test = test.value as InferRow['test'];
        row.stats = row.test === 'p1' ? { x: '60', n: '100' } : row.test === 't2' ? { mean: '52', sd: '8', n: '25', mean2: '49', sd2: '7', n2: '30' } : row.test === 'z1' ? { mean: '103', sigma: '15', n: '36' } : { mean: '52', sd: '8', n: '25' };
        row.h0 = row.test === 'p1' ? '0.5' : row.test === 't2' ? '0' : row.test === 'z1' ? '100' : '50';
        this.commit();
        render();
        this.replot(true);
      });
      const mode = segmented('Kind', [['test', 'Test'], ['interval', 'Interval']], row.mode, (m) => {
        row.mode = m;
        this.commit();
        render();
        this.replot(true);
      });
      const input = segmented('Input', [['stats', 'Summary'], ['data', 'Data']], row.input, (m) => {
        row.input = m;
        this.commit();
        render();
        this.replot(true);
      });
      const fields = h('div', 'gw-infer-fields');
      const set = (k: string) => (val: string) => {
        row.stats[k] = val;
        this.commitSoon();
        this.replot(true);
      };
      const f = (label: string, k: string) => field(label, row.stats[k] ?? '', set(k), { inputmode: 'decimal' });
      if (row.test === 'p1') fields.append(f('successes x', 'x'), f('n', 'n'));
      else if (row.input === 'data') {
        fields.append(field(row.test === 't2' ? 'sample 1' : 'data', row.data, (val) => {
          row.data = val;
          this.commitSoon();
          this.replot(true);
        }, { cls: 'wide', placeholder: '1, 2, 3 or a column like x₁' }));
        if (row.test === 't2') fields.append(field('sample 2', row.data2, (val) => {
          row.data2 = val;
          this.commitSoon();
          this.replot(true);
        }, { cls: 'wide', placeholder: '4, 5, 6 or y₁' }));
        if (row.test === 'z1') fields.append(f('σ', 'sigma'));
      } else if (row.test === 't2') fields.append(f('x̄₁', 'mean'), f('s₁', 'sd'), f('n₁', 'n'), f('x̄₂', 'mean2'), f('s₂', 'sd2'), f('n₂', 'n2'));
      else if (row.test === 'z1') fields.append(f('x̄', 'mean'), f('σ', 'sigma'), f('n', 'n'));
      else fields.append(f('x̄', 'mean'), f('s', 'sd'), f('n', 'n'));
      const hyp = h('div', 'gw-infer-fields');
      if (row.mode === 'test') {
        const sym = row.test === 'p1' ? 'p₀' : row.test === 't2' ? 'μ₁ − μ₂' : 'μ₀';
        hyp.append(field(sym, row.h0, (val) => {
          row.h0 = val;
          this.commitSoon();
          this.replot(true);
        }, { inputmode: 'decimal' }));
        const alt = h('select', 'gw-select', { 'aria-label': 'Alternative' });
        for (const [k, t] of [['ne', '≠'], ['lt', '<'], ['gt', '>']] as const) alt.append(h('option', '', { value: k, text: `${sym.replace('₀', '')} ${t} ${sym}` }));
        alt.value = row.alt;
        alt.addEventListener('change', () => {
          row.alt = alt.value as InferRow['alt'];
          this.commit();
          this.replot(true);
        });
        hyp.append(h('label', 'gw-field', {}, h('span', '', { text: 'alternative' }), alt));
      }
      hyp.append(field(row.mode === 'test' ? 'level' : 'confidence', row.level, (val) => {
        row.level = val;
        this.commitSoon();
        this.replot(true);
      }, { inputmode: 'decimal' }));
      box.replaceChildren(h('div', 'gw-infer-head', {}, test, mode, row.test === 'p1' ? '' : input), fields, hyp, out);
      v.input = test as unknown as HTMLInputElement;
    };
    render();
    v.body.append(box);
  }

  private buildImage(row: ImageRow, v: RowView): void {
    const box = h('div', 'gw-image-box');
    const file = h('input', 'gw-file', { type: 'file', accept: 'image/*', 'aria-label': 'Choose an image' });
    const pick = btn(row.key ? 'Replace image' : 'Choose image', 'nb-btn gw-pick', () => file.click());
    const name = h('span', 'gw-image-name', { text: row.name || 'No image yet' });
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      const key = `img-${Date.now().toString(36)}-${row.id}`;
      const img = await decode(f);
      if (!img) {
        v.hint.textContent = 'That file isn’t an image this browser can show';
        v.hint.hidden = false;
        return;
      }
      try {
        await putImage(key, f);
      } catch {
        v.hint.textContent = 'Couldn’t store the image on this device; it will last for this visit';
        v.hint.hidden = false;
      }
      this.images.set(key, img);
      row.key = key;
      row.name = f.name;
      row.h = row.w * (img.naturalHeight / Math.max(1, img.naturalWidth));
      name.textContent = f.name;
      pick.textContent = 'Replace image';
      this.commit();
      render();
      this.replot();
      this.save();
    });
    const nums = h('div', 'gw-infer-fields');
    const render = () => {
      const f = (label: string, k: 'x' | 'y' | 'w' | 'h') =>
        field(label, String(tidyNum(row[k])), (val) => {
          const n = num(val);
          if (n === undefined || ((k === 'w' || k === 'h') && n <= 0)) return;
          row[k] = n;
          this.commitSoon();
          this.replot();
        }, { inputmode: 'decimal' });
      const op = h('input', 'gw-opacity', { type: 'range', min: '0', max: '1', step: '0.05', 'aria-label': 'Image opacity' });
      op.value = String(row.opacity);
      op.addEventListener('input', () => {
        row.opacity = Number(op.value);
        this.commitSoon();
        this.replot();
      });
      nums.replaceChildren(f('centre x', 'x'), f('centre y', 'y'), f('width', 'w'), f('height', 'h'), h('label', 'gw-field wide', {}, h('span', '', { text: 'opacity' }), op));
    };
    render();
    box.append(h('div', 'gw-image-head', {}, pick, name, file), nums);
    v.input = pick as unknown as HTMLInputElement;
    v.body.append(box);
  }

  private loadImages(): void {
    for (const r of this.state.rows) {
      if (r.type !== 'image' || !r.key || this.images.has(r.key)) continue;
      this.images.set(r.key, null);
      void getImage(r.key).then((img) => {
        this.images.set(r.key, img);
        if (img) this.replot();
        else {
          const v = this.views.get(r.id);
          if (v) {
            v.hint.textContent = 'This picture isn’t stored on this device: choose it again';
            v.hint.hidden = false;
          }
        }
      });
    }
  }

  // ---------- keyboard and reordering ----------
  private onKey(e: KeyboardEvent, row: ExprRow): void {
    const i = this.state.rows.indexOf(row);
    const v = this.views.get(row.id)!;
    const input = v.input as HTMLInputElement;
    if (e.key === 'Enter') {
      e.preventDefault();
      this.flush();
      const next = this.addRow('expr', i + 1, { folder: row.folder ?? null });
      next.input?.focus();
    } else if (e.key === 'Backspace' && !input.value && this.state.rows.length > 1) {
      e.preventDefault();
      this.removeRow(row, false);
      const prev = this.views.get(this.state.rows[Math.max(0, i - 1)]!.id);
      if (prev?.input) {
        prev.input.focus();
        const n = prev.input.value.length;
        prev.input.setSelectionRange(n, n);
      }
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      if (e.altKey && v.range && !v.range.hidden) {
        // Alt + ↑/↓ nudges a slider by one step.
        e.preventDefault();
        v.range.value = String(Number(v.range.value) + dir * Number(v.range.step));
        v.range.dispatchEvent(new Event('input'));
        return;
      }
      for (let j = i + dir; j >= 0 && j < this.state.rows.length; j += dir) {
        const t = this.views.get(this.state.rows[j]!.id);
        if (t?.input && !t.el.hidden) {
          e.preventDefault();
          t.input.focus();
          return;
        }
      }
    }
  }

  private bindGrip(grip: HTMLButtonElement, row: RowState): void {
    grip.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const rows = this.state.rows;
      const i = rows.indexOf(row);
      const j = i + (e.key === 'ArrowUp' ? -1 : 1);
      if (j < 0 || j >= rows.length) return;
      const before = snapshot(this.list);
      const other = rows[j]!;
      if (row.type !== 'folder') row.folder = other.type === 'folder' && e.key === 'ArrowDown' ? other.id : other.folder ?? null;
      rows.splice(i, 1);
      rows.splice(j, 0, row);
      this.relist();
      glide(this.list, before);
      grip.focus();
      this.commit();
      this.save();
    });
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const li = this.views.get(row.id)!.el;
      try {
        grip.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic pointer.
      }
      li.classList.add('dragging');
      let lastY = e.clientY;
      let offset = 0;
      const move = (ev: PointerEvent) => {
        offset += ev.clientY - lastY;
        lastY = ev.clientY;
        li.style.transform = `translateY(${offset}px)`;
        const top = li.getBoundingClientRect().top;
        const mid = top + li.offsetHeight / 2;
        const prev = li.previousElementSibling as HTMLElement | null;
        const next = li.nextElementSibling as HTMLElement | null;
        if (next && mid > next.getBoundingClientRect().top + next.offsetHeight / 2) {
          const before = li.getBoundingClientRect().top;
          this.list.insertBefore(next, li);
          offset -= li.getBoundingClientRect().top - before;
          li.style.transform = `translateY(${offset}px)`;
        } else if (prev && mid < prev.getBoundingClientRect().top + prev.offsetHeight / 2) {
          const before = li.getBoundingClientRect().top;
          this.list.insertBefore(li, prev);
          offset -= li.getBoundingClientRect().top - before;
          li.style.transform = `translateY(${offset}px)`;
        }
      };
      const up = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
        li.classList.remove('dragging');
        li.style.transform = '';
        // The new order, and the folder the row was dropped into (the one above it, if any).
        const ids = [...this.list.children].map((c) => Number((c as HTMLElement).dataset.id));
        const prevEl = li.previousElementSibling as HTMLElement | null;
        if (row.type !== 'folder') {
          const above = prevEl ? this.rowOf(Number(prevEl.dataset.id)) : undefined;
          row.folder = above ? (above.type === 'folder' ? (above.collapsed ? null : above.id) : above.folder ?? null) : null;
        }
        this.state.rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        const before = snapshot(this.list);
        this.relist();
        glide(this.list, before);
        this.commit();
        this.save();
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    });
  }

  // ---------- popovers ----------
  private toggleAddMenu(opener: HTMLButtonElement): void {
    if (this.panel?.classList.contains('gw-addmenu')) return this.closePanelNow();
    this.closePanelNow();
    const menu = h('div', 'gw-addmenu gw-pop-panel', { role: 'menu', 'aria-label': 'Add' });
    const items: [RowType, string, string][] = [
      ['expr', 'Expression', 'y = x², points, sliders'],
      ['note', 'Note', 'Plain text'],
      ['table', 'Table', 'x₁, y₁ columns, plotted as points'],
      ['infer', 'Inference', 'Tests and intervals'],
      ['folder', 'Folder', 'Group rows'],
      ['image', 'Image', 'A picture on the graph'],
    ];
    for (const [type, name, sub] of items) {
      const b = h('button', 'gw-menuitem', { type: 'button', role: 'menuitem', 'data-type': type }, h('b', '', { text: name }), h('span', '', { text: sub }));
      b.addEventListener('click', () => {
        this.closePanelNow();
        const v = this.addRow(type);
        if (type === 'image') (v.el.querySelector('.gw-pick') as HTMLButtonElement | null)?.focus();
        else v.input?.focus();
        v.el.scrollIntoView({ block: 'nearest' });
      });
      b.addEventListener('keydown', (e) => {
        const all = [...menu.querySelectorAll<HTMLButtonElement>('.gw-menuitem')];
        const i = all.indexOf(b);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]!.focus();
        }
      });
      menu.append(b);
    }
    opener.parentElement!.append(menu);
    // Open upward when there isn't room below (a long row list puts the Add button near the bottom of the screen).
    const below = window.innerHeight - opener.getBoundingClientRect().bottom;
    if (below < menu.offsetHeight + 12 && opener.getBoundingClientRect().top > menu.offsetHeight + 12) menu.classList.add('gw-up');
    opener.setAttribute('aria-expanded', 'true');
    this.openPanel(menu, opener, () => opener.setAttribute('aria-expanded', 'false'));
    play(menu, [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], D2, 'panels');
    (menu.firstElementChild as HTMLElement).focus();
  }

  private openPanel(panel: HTMLElement, opener: HTMLElement, onClose?: () => void): void {
    this.panel = panel;
    const off = dismissable(panel, opener, () => this.closePanelNow());
    this.closePanel = () => {
      off();
      onClose?.();
    };
  }

  private closePanelNow(): void {
    this.closePanel?.();
    this.closePanel = null;
    this.panel?.remove();
    this.panel = null;
  }

  private togglePanel(kind: 'settings' | 'share', opener: HTMLButtonElement): void {
    const was = this.panel?.dataset.kind;
    this.closePanelNow();
    if (was === kind) return;
    const panel = kind === 'settings' ? this.settingsPanel() : this.sharePanel();
    panel.dataset.kind = kind;
    if (kind === 'settings') this.graph.append(panel);
    else opener.parentElement!.append(panel);
    opener.setAttribute('aria-expanded', 'true');
    this.openPanel(panel, opener, () => opener.setAttribute('aria-expanded', 'false'));
    play(panel, [{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], D2, 'panels');
    (panel.querySelector('input, button, select') as HTMLElement | null)?.focus();
  }

  private setSetting<K extends keyof ViewSettings>(k: K, value: ViewSettings[K]): void {
    this.state.settings = { ...this.state.settings, [k]: value };
    this.view.setSettings({ [k]: value } as Partial<ViewSettings>);
    if (k === 'degrees') this.replot();
    this.scene?.setSettings(this.state.settings);
    this.commit();
    this.save();
  }

  private settingsPanel(): HTMLElement {
    const s = this.state.settings;
    const p = h('div', 'gw-panel gw-pop-panel', { role: 'dialog', 'aria-label': 'Graph settings' });
    const c = (label: string, k: 'grid' | 'minor' | 'numbers' | 'polar' | 'logX' | 'logY' | 'square' | 'audio' | 'contrast') => check(label, s[k], (on) => this.setSetting(k, on), k);
    const range = h('div', 'gw-ranges');
    const vp = this.view.getView();
    const rf = (label: string, k: 'xMin' | 'xMax' | 'yMin' | 'yMax') => {
      const f = field(label, String(Number(vp[k].toPrecision(6))), () => undefined, { inputmode: 'decimal' });
      const input = f.querySelector('input')!;
      input.dataset.range = k;
      input.addEventListener('change', () => {
        const n = num(input.value);
        const cur = this.view.getView();
        if (n === undefined) return void (input.value = String(Number(cur[k].toPrecision(6))));
        const next = { ...cur, [k]: n };
        if (this.state.settings.square && (k === 'xMin' || k === 'xMax')) {
          const g = this.view.getView();
          const cy = (g.yMin + g.yMax) / 2;
          const half = ((next.xMax - next.xMin) * (g.yMax - g.yMin)) / (g.xMax - g.xMin) / 2;
          next.yMin = cy - half;
          next.yMax = cy + half;
        }
        this.view.setView(next);
      });
      return f;
    };
    range.append(rf('x from', 'xMin'), rf('to', 'xMax'), rf('y from', 'yMin'), rf('to', 'yMax'));
    const labels = h('div', 'gw-ranges');
    labels.append(
      field('x-axis label', s.xLabel, (v) => this.setSetting('xLabel', v)),
      field('y-axis label', s.yLabel, (v) => this.setSetting('yLabel', v)),
    );
    const bg = h('div', 'gw-bg', { role: 'group', 'aria-label': 'Background' });
    const swatches: [string, string][] = [['', 'Default'], ['#ffffff', 'White'], ['#fbf7ee', 'Paper'], ['#101114', 'Night']];
    for (const [val, name] of swatches) {
      const b = btn('', 'gw-swatch', () => {
        this.setSetting('bg', val);
        for (const o of bg.querySelectorAll('.gw-swatch')) o.setAttribute('aria-pressed', String(o === b));
      }, `${name} background`);
      b.style.setProperty('--sw', val || 'var(--surface)');
      b.setAttribute('aria-pressed', String(s.bg === val));
      bg.append(b);
    }
    const custom = h('input', 'gw-color', { type: 'color', 'aria-label': 'Custom background colour' });
    custom.value = /^#[0-9a-f]{6}$/i.test(s.bg) ? s.bg : '#ffffff';
    custom.addEventListener('input', () => this.setSetting('bg', custom.value));
    bg.append(custom);
    p.append(
      h('h3', '', { text: 'Graph' }),
      h('div', 'gw-checks', {}, c('Grid', 'grid'), c('Minor grid', 'minor'), c('Axis numbers', 'numbers'), c('Polar grid', 'polar')),
      labels,
      h('h3', '', { text: 'Angles' }),
      segmented('Angles', [['rad', 'Radians'], ['deg', 'Degrees']], s.degrees ? 'deg' : 'rad', (v) => this.setSetting('degrees', v === 'deg')),
      h('h3', '', { text: 'Scale' }),
      h('div', 'gw-checks', {}, c('Log x', 'logX'), c('Log y', 'logY'), c('Keep square', 'square')),
      range,
      h('div', 'gw-row-btns', {}, btn('Zoom square', 'nb-btn', () => this.view.zoomSquare()), btn('Zoom fit', 'nb-btn', () => this.view.zoomFit())),
      h('h3', '', { text: 'Background' }),
      bg,
      h('h3', '', { text: 'Accessibility' }),
      h('div', 'gw-checks', {}, c('Audio trace', 'audio'), c('High contrast', 'contrast')),
      h('div', 'gw-row-btns', {}, btn('Listen to the curve', 'nb-btn', () => this.view.playCurve())),
    );
    return p;
  }

  private syncRangeInputs(): void {
    if (this.panel?.dataset.kind !== 'settings') return;
    const vp = this.view.getView();
    for (const input of this.panel.querySelectorAll<HTMLInputElement>('input[data-range]')) {
      if (document.activeElement === input) continue;
      input.value = String(Number(vp[input.dataset.range as 'xMin'].toPrecision(6)));
    }
  }

  private sharePanel(): HTMLElement {
    const p = h('div', 'gw-sharebox gw-pop-panel', { role: 'dialog', 'aria-label': 'Share' });
    const link = h('input', 'gw-link', { type: 'text', readonly: '', 'aria-label': 'Link to this graph' });
    link.value = 'Making a link…';
    void shareLink(this.state).then((url) => {
      link.value = url;
      link.dataset.ready = '1';
    });
    const copy = btn('Copy link', 'nb-btn', async () => {
      try {
        await navigator.clipboard.writeText(link.value);
        copy.textContent = 'Copied';
      } catch {
        link.select();
        copy.textContent = 'Press ⌘/Ctrl C';
      }
    });
    const png = btn('Download PNG', 'nb-btn', () => (this.state.dim === '3d' ? this.scene?.exportPng() : this.view.exportPng()));
    const svg = btn('Download SVG', 'nb-btn', () => download('lemma-graph.svg', this.view.toSvg()));
    svg.disabled = this.state.dim === '3d';
    const note = this.state.rows.some((r) => r.type === 'image') ? h('p', 'gw-small', { text: 'Pictures stay on this device; the link has everything else.' }) : null;
    p.append(h('h3', '', { text: 'Share' }), link, h('div', 'gw-row-btns', {}, copy), h('h3', '', { text: 'Export' }), h('div', 'gw-row-btns', {}, png, svg), ...(note ? [note] : []));
    return p;
  }

  private toggleStyle(row: RowState, opener: HTMLButtonElement): void {
    const v = this.views.get(row.id)!;
    if (v.pop) {
      v.closePop?.();
      return;
    }
    const pop = h('div', 'gw-pop', { role: 'group', 'aria-label': 'Row options' });
    const st = (row.style ??= {});
    const set = (patch: Partial<RowStyle>) => {
      Object.assign(st, patch);
      this.label();
      this.commit();
      this.replot();
      this.save();
    };
    const sw = h('div', 'gw-swatches', { role: 'group', 'aria-label': 'Colour' });
    for (let k = 0; k < PALETTE; k++) {
      const b = btn('', 'gw-swatch', () => {
        row.color = k;
        delete st.color;
        set({});
        for (const o of sw.querySelectorAll('.gw-swatch')) o.setAttribute('aria-pressed', String(o === b));
      }, `Colour ${k + 1}`);
      b.style.setProperty('--sw', `var(--g${k + 1})`);
      b.setAttribute('aria-pressed', String(!st.color && row.color === k));
      sw.append(b);
    }
    const custom = h('input', 'gw-color', { type: 'color', 'aria-label': 'Custom colour' });
    custom.value = st.color && /^#[0-9a-f]{6}$/i.test(st.color) ? st.color : '#4d6b00';
    custom.addEventListener('input', () => set({ color: custom.value }));
    sw.append(custom);
    pop.append(sw);
    const drawable = row.type === 'expr' || row.type === 'table';
    if (drawable) {
      pop.append(
        h('div', 'gw-pop-line', {}, h('span', '', { text: 'Line' }), segmented('Line style', [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']], st.line ?? 'solid', (l) => set({ line: l }))),
        h('div', 'gw-pop-line', {}, h('span', '', { text: 'Points' }), segmented('Point style', [['dot', 'Dot'], ['open', 'Open'], ['cross', 'Cross']], st.point ?? 'dot', (pt) => set({ point: pt }))),
      );
      const slider = (label: string, k: 'width' | 'opacity', min: number, max: number, step: number, dflt: number) => {
        const r = h('input', '', { type: 'range', min: String(min), max: String(max), step: String(step), 'aria-label': label });
        r.value = String(st[k] ?? dflt);
        r.addEventListener('input', () => set({ [k]: Number(r.value) }));
        return h('label', 'gw-pop-line', {}, h('span', '', { text: label }), r);
      };
      pop.append(slider('Thickness', 'width', 1, 8, 0.5, 2.5), slider('Opacity', 'opacity', 0.1, 1, 0.05, 1));
      const lbl = h('input', 'gw-field-input', { type: 'text', placeholder: 'Label text (blank: coordinates)', 'aria-label': 'Label text' });
      lbl.value = st.label ?? '';
      lbl.addEventListener('input', () => set({ label: lbl.value }));
      pop.append(h('div', 'gw-pop-line', {}, check('Show label', st.showLabel !== false, (on) => set({ showLabel: on })), lbl));
      if (row.type === 'expr') pop.append(check('Extend to 3D', !!st.extend3d, (on) => set({ extend3d: on }), 'extend3d'));
    }
    if (row.type !== 'folder') {
      const folders = this.state.rows.filter((r): r is FolderRow => r.type === 'folder');
      if (folders.length) {
        const sel = h('select', 'gw-select', { 'aria-label': 'Folder' });
        sel.append(h('option', '', { value: '', text: 'No folder' }));
        for (const f of folders) sel.append(h('option', '', { value: String(f.id), text: f.title || 'Folder' }));
        sel.value = row.folder != null ? String(row.folder) : '';
        sel.addEventListener('change', () => {
          row.folder = sel.value ? Number(sel.value) : null;
          this.relist();
          this.commit();
          this.save();
        });
        pop.append(h('label', 'gw-pop-line', {}, h('span', '', { text: 'Folder' }), sel));
      }
    }
    pop.append(h('div', 'gw-row-btns', {}, btn('Duplicate', 'nb-btn', () => {
      v.closePop?.();
      this.duplicate(row);
    })));
    v.el.append(pop);
    v.pop = pop;
    opener.setAttribute('aria-expanded', 'true');
    const off = dismissable(pop, opener, () => v.closePop?.());
    v.closePop = () => {
      off();
      pop.remove();
      v.pop = null;
      v.closePop = undefined;
      opener.setAttribute('aria-expanded', 'false');
    };
    play(pop, [{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], D2, 'panels');
    (pop.querySelector('button') as HTMLElement | null)?.focus();
  }

  // ---------- sliders ----------
  private sliderOpts(row: ExprRow, value: number): SliderOpts {
    if (row.slider) return row.slider;
    const min = Math.min(-10, value, Math.floor(value - Math.abs(value)));
    const max = Math.max(10, value, Math.ceil(value + Math.abs(value)));
    return { min, max, step: Math.max(0.01, Number(((max - min) / 200).toPrecision(2))), speed: 1, mode: 'bounce' };
  }

  private showSlider(row: ExprRow, v: RowView, name: string, value: number): void {
    const o = this.sliderOpts(row, value);
    if (!v.slider) {
      const box = h('div', 'gw-slider');
      const playBtn = btn(ICON.play, 'gw-play', () => this.togglePlay(row), `Play ${name}`);
      const range = h('input', 'gw-range', { type: 'range' });
      const gear = btn(ICON.gear, 'gw-sopts-btn', () => {
        opts.hidden = !opts.hidden;
        gear.setAttribute('aria-expanded', String(!opts.hidden));
      }, `Slider settings for ${name}`);
      gear.setAttribute('aria-expanded', 'false');
      const opts = h('div', 'gw-sopts');
      opts.hidden = true;
      range.addEventListener('input', () => this.setSliderValue(row, Number(range.value), false));
      range.addEventListener('change', () => this.commit());
      box.append(h('div', 'gw-slider-line', {}, playBtn, range, gear), opts);
      v.slider = box;
      v.range = range;
      (v.input as HTMLInputElement).after(box);
    }
    const range = v.range!;
    range.min = String(o.min);
    range.max = String(o.max);
    range.step = String(o.step);
    range.value = String(value);
    range.setAttribute('aria-label', `Value of ${name}`);
    v.slider.hidden = false;
    v.sliderName = name;
    v.sliderValue = value;
    const opts = v.slider.querySelector<HTMLElement>('.gw-sopts')!;
    if (!opts.childElementCount || opts.dataset.for !== name) {
      opts.dataset.for = name;
      const edit = (label: string, k: 'min' | 'max' | 'step') =>
        field(label, String(this.sliderOpts(row, v.sliderValue)[k]), (val) => {
          const n = num(val);
          if (n === undefined || (k === 'step' && n <= 0)) return;
          row.slider = { ...this.sliderOpts(row, v.sliderValue), [k]: n };
          range.min = String(row.slider.min);
          range.max = String(row.slider.max);
          range.step = String(row.slider.step);
          this.commitSoon();
          this.save();
        }, { inputmode: 'decimal' });
      const speed = h('select', 'gw-select', { 'aria-label': 'Speed' });
      for (const s of [0.25, 0.5, 1, 2, 4]) speed.append(h('option', '', { value: String(s), text: `${s}×` }));
      speed.value = String(o.speed);
      speed.addEventListener('change', () => {
        row.slider = { ...this.sliderOpts(row, v.sliderValue), speed: Number(speed.value) };
        this.commit();
        this.save();
      });
      opts.replaceChildren(
        h('div', 'gw-infer-fields', {}, edit('min', 'min'), edit('max', 'max'), edit('step', 'step'), h('label', 'gw-field', {}, h('span', '', { text: 'speed' }), speed)),
        segmented('Animation', [['loop', 'Loop'], ['bounce', 'Back and forth'], ['once', 'Once']], o.mode, (m) => {
          row.slider = { ...this.sliderOpts(row, v.sliderValue), mode: m };
          this.commit();
          this.save();
        }),
      );
    }
  }

  private setSliderValue(row: ExprRow, value: number, fromPlay: boolean): void {
    const v = this.views.get(row.id);
    if (!v?.sliderName) return;
    const name = v.sliderName;
    v.sliderValue = value;
    row.text = `${name} = ${tidyNum(Number(value.toFixed(6)))}`;
    (v.input as HTMLInputElement).value = row.text;
    if (v.range && Number(v.range.value) !== value) v.range.value = String(value);
    this.view.setParams({ [name]: value });
    this.scene?.setParams({ ...this.view.params() });
    this.lastText.set(row.id, row.text);
    if (!fromPlay) this.commitSoon();
    this.save();
    this.scheduleValues();
  }

  private valuesTimer = 0;
  /** Values shown under rows ("b = 2a" → "= 4") follow a slider while it moves, a few times a second. */
  private scheduleValues(): void {
    if (this.valuesTimer) return;
    this.valuesTimer = window.setTimeout(() => {
      this.valuesTimer = 0;
      this.replot(false, true);
    }, 250);
  }

  private togglePlay(row: ExprRow): void {
    const v = this.views.get(row.id);
    if (!v) return;
    const btnEl = v.slider?.querySelector<HTMLButtonElement>('.gw-play');
    if (v.playing) {
      cancelAnimationFrame(v.playing);
      v.playing = 0;
      if (btnEl) {
        btnEl.innerHTML = ICON.play;
        btnEl.setAttribute('aria-label', `Play ${v.sliderName}`);
      }
      v.el.classList.remove('playing');
      this.commit();
      return;
    }
    if (btnEl) {
      btnEl.innerHTML = ICON.pause;
      btnEl.setAttribute('aria-label', `Pause ${v.sliderName}`);
    }
    v.el.classList.add('playing');
    let dir = 1;
    let last = performance.now();
    const tick = (now: number) => {
      const o = this.sliderOpts(row, v.sliderValue);
      const dt = Math.min(50, now - last) / 1000;
      last = now;
      let x = v.sliderValue + (dir * dt * (o.max - o.min) * o.speed) / 4;
      if (x > o.max) {
        if (o.mode === 'loop') x = o.min;
        else if (o.mode === 'bounce') [x, dir] = [o.max, -1];
        else {
          this.setSliderValue(row, o.max, true);
          return this.togglePlay(row);
        }
      }
      if (x < o.min) [x, dir] = [o.min, 1];
      this.setSliderValue(row, x, true);
      v.playing = requestAnimationFrame(tick);
    };
    v.playing = requestAnimationFrame(tick);
  }

  // ---------- points ----------
  private dragPoint(it: Extract<GraphItem, { kind: 'point' }>, x: number, y: number, done: boolean): void {
    const row = this.rowOf(it.id);
    if (!row || row.type !== 'expr' || !it.drag) return;
    if (it.drag.literal) {
      row.text = `(${x}, ${y})`;
      const v = this.views.get(row.id)!;
      (v.input as HTMLInputElement).value = row.text;
      this.lastText.set(row.id, row.text);
      this.replot(false, true);
    } else {
      for (const [name, val] of [[it.drag.x, x], [it.drag.y, y]] as const) {
        if (!name) continue;
        const sr = this.state.rows.find((r): r is ExprRow => r.type === 'expr' && this.views.get(r.id)?.sliderName === name);
        if (sr) {
          const o = this.sliderOpts(sr, val);
          if (val < o.min || val > o.max) sr.slider = { ...o, min: Math.min(o.min, val), max: Math.max(o.max, val) };
          this.showSlider(sr, this.views.get(sr.id)!, name, val);
          this.setSliderValue(sr, val, true);
        }
      }
    }
    if (done) {
      this.commit();
      this.save();
    }
  }

  // ---------- plotting ----------
  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.replot(), 120);
    this.save();
  }

  /** Refits the window to the features after typing pauses, until the person moves the graph themselves. */
  private scheduleFit(): void {
    clearTimeout(this.fitTimer);
    this.fitTimer = window.setTimeout(() => this.view.fitIfAuto(), 700);
  }

  private flush(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.replot();
  }

  private externals(): { consts: Map<string, number>; extFns: (name: string) => ((...a: number[]) => number) | null } {
    const consts = new Map<string, number>();
    for (const [k, v] of this.host.session.vars) {
      const n = Number(String(v));
      if (Number.isFinite(n) && /^[a-zA-Z](_\w+)?$/.test(k)) consts.set(k, n);
    }
    const cache = new Map<string, ((...a: number[]) => number) | null>();
    const extFns = (name: string) => {
      if (cache.has(name)) return cache.get(name)!;
      const fn = this.host.session.fns.get(name);
      let out: ((...a: number[]) => number) | null = null;
      if (fn) {
        try {
          const names = fn.params.map((_, i) => `__a${i}`);
          const f = compileFloat({ type: 'call', name, args: names.map((n) => ({ type: 'name', name: n })) }, { angle: this.state.settings.degrees ? 'deg' : 'rad', vars: this.host.session.vars, fns: this.host.session.fns, free: new Set(names) });
          out = (...a: number[]) => f(Object.fromEntries(names.map((n, i) => [n, a[i] ?? NaN])));
        } catch {
          out = null;
        }
      }
      cache.set(name, out);
      return out;
    };
    return { consts, extFns };
  }

  /** Re-parses every row and redraws. `quiet`: a slider or drag is moving, keep hints and the view as they are. */
  private replot(fromInfer = false, quiet = false): void {
    this.timer = 0;
    const rows = this.state.rows;
    const exprIn: { id: number; text: string }[] = [];
    for (const r of rows) {
      if (r.type !== 'expr') continue;
      const v = this.views.get(r.id);
      let text = r.text;
      // A slider row mid-edit ("a = ") keeps its last value.
      if (v?.sliderName && new RegExp(`^\\s*${v.sliderName.replace(/[_]/g, '\\_')}\\s*=\\s*$`).test(text)) {
        text = `${v.sliderName} = ${v.sliderValue}`;
        v.sliderStale = true;
      } else if (v) v.sliderStale = false;
      exprIn.push({ id: r.id, text });
    }
    const tables = rows.filter((r): r is TableRow => r.type === 'table').map((t) => ({ id: t.id, cols: t.cols, connect: t.connect }));
    const { consts, extFns } = this.externals();
    let res: BuildResult;
    try {
      res = buildRows(exprIn, tables, { angle: this.state.settings.degrees ? 'deg' : 'rad', params: this.view.params(), consts, extFns });
    } catch (err) {
      console.error(err);
      return;
    }
    this.result = res;
    const items: GraphItem[] = [];
    const items3: GraphItem[] = [];
    const in3d = this.state.dim === '3d';
    const changed: number[] = [];
    for (const r of rows) {
      const v = this.views.get(r.id);
      if (!v) continue;
      const text = r.type === 'expr' ? r.text : JSON.stringify(r);
      if (this.lastText.get(r.id) !== text) {
        if (this.lastText.has(r.id)) changed.push(r.id);
        this.lastText.set(r.id, text);
      }
      v.error = null;
      if (r.type === 'expr') {
        const out = res.rows.get(r.id)!;
        this.updateExpr(r, v, out);
        if (out.kind === 'error') {
          v.error = out.error ?? 'Can’t read that';
        } else v.good = out.items;
        for (const it of v.good ?? []) (D3_KINDS.has(it.kind) ? items3 : items).push(it);
      } else if (r.type === 'table') {
        const t = res.tables.get(r.id);
        v.error = t?.error ?? null;
        v.good = t?.items ?? [];
        items.push(...v.good);
        this.describeRowText(r.id, `Table with ${Math.max(0, ...r.cols.map((c) => c.values.filter((x) => x !== null).length))} values per column.`);
      } else if (r.type === 'infer') {
        const out = this.inferRow(r, v);
        if (out) {
          items.push(...out.items);
          const key = JSON.stringify(out.view);
          if (fromInfer && this.inferView.get(r.id) !== key) this.view.setView(out.view);
          this.inferView.set(r.id, key);
        }
      } else if (r.type === 'image') {
        const img = this.images.get(r.key);
        if (img) items.push({ kind: 'image', id: r.id, label: r.name || 'image', img, x: r.x, y: r.y, w: r.w, h: r.h, opacity: r.opacity });
        this.describeRowText(r.id, r.key ? `Image ${r.name} centred at (${tidyNum(r.x)}, ${tidyNum(r.y)}), ${tidyNum(r.w)} by ${tidyNum(r.h)}.` : 'No image chosen yet.');
      } else if (r.type === 'folder') {
        const n = rows.filter((m) => m.folder === r.id).length;
        this.describeRowText(r.id, `Folder with ${n} row${n === 1 ? '' : 's'}${r.collapsed ? ', collapsed' : ''}.`);
      }
    }
    if (changed.length) this.view.unpin(changed);
    // Automatic sliders under the graph for names nothing defines.
    const params = this.view.params();
    const sliders: Slider[] = res.missing.map((name) => ({ name, value: params[name] ?? 1, min: -10, max: 10, step: 0.1 }));
    this.view.dimmed.clear();
    for (const r of rows) {
      const v = this.views.get(r.id);
      if (!v) continue;
      if (v.error && v.good?.length) this.view.dimmed.add(r.id);
      v.el.classList.toggle('stale', !!v.error);
    }
    const hidden = rows.filter((r) => r.hidden).map((r) => r.id);
    const labels = rows.filter((r) => r.type === 'expr' && this.views.get(r.id)?.good?.length && !r.hidden).map((r) => (r as ExprRow).text.trim());
    this.view.setSpec({ items: in3d ? [] : items, sliders, notes: [], summary: labels.length ? `Graph of ${labels.join('; ')}` : 'Empty graph' });
    this.view.setParams(res.sliders);
    this.view.setHidden(hidden);
    if (in3d) this.update3d([...items, ...items3], hidden);
    if (!quiet) this.showHints();
    this.updateUndoButtons();
  }

  private updateExpr(r: ExprRow, v: RowView, out: RowOut): void {
    if (out.kind === 'slider' && out.slider) {
      this.showSlider(r, v, out.slider.name, out.slider.value);
      if (v.sliderStale) out.error = 'Keep typing a number';
    } else if (!v.sliderStale) {
      if (v.slider) v.slider.hidden = true;
      if (v.playing) this.togglePlay(r);
      v.sliderName = null;
    }
    if (v.sliderStale) {
      v.error = 'Keep typing a number';
      out.kind = 'error';
      out.error = v.error;
    }
    // Computed values, regression results, and "add slider" offers.
    v.value.replaceChildren();
    if (out.fit) {
      const p = out.fit.params.map(([k, val]) => `${k} = ${fmtValue(val)}`).join('   ');
      v.value.append(h('span', 'gw-fit', { text: p }), ' ', h('span', 'gw-r2', { text: `R² = ${fmtValue(Number(out.fit.r2.toFixed(6)))}` }));
    } else if (out.value) v.value.append(h('span', '', { text: out.value }));
    if (out.dims === 3 && this.state.dim === '2d' && out.kind !== 'error') {
      v.value.append(btn('Show in 3D', 'gw-chip', () => this.setDim('3d')));
    }
    if (out.missing.length && out.kind !== 'error') {
      for (const name of out.missing.slice(0, 4)) {
        v.value.append(btn(`+ slider ${name}`, 'gw-chip', () => {
          const i = this.state.rows.indexOf(r);
          this.addRow('expr', i + 1, { text: `${name} = 1`, folder: r.folder ?? null });
          this.replot();
        }, `Add a slider for ${name}`));
      }
    }
    v.value.hidden = !v.value.childElementCount;
    if (out.kind === 'empty') this.describeRowText(r.id, '');
    else if (out.kind === 'slider' && out.slider) this.describeRowText(r.id, `Slider ${out.slider.name} = ${fmtValue(out.slider.value)}.`);
    else if (out.fit) this.describeRowText(r.id, `Regression ${out.fit.model}: ${out.fit.params.map(([k, val]) => `${k} = ${fmtValue(val)}`).join(', ')}, R squared ${fmtValue(out.fit.r2)}.`);
    else if (out.value) this.describeRowText(r.id, `Value ${out.value.replace(/^= /, '')}.`);
  }

  private inferRow(r: InferRow, v: RowView): { items: GraphItem[]; view: { xMin: number; xMax: number; yMin: number; yMax: number } } | null {
    const outEl = v.el.querySelector('.gw-infer-out');
    const listOf = (text: string): number[] | undefined => {
      if (!text.trim()) return undefined;
      const col = columnName(text.trim());
      if (col) {
        for (const t of this.state.rows) if (t.type === 'table') for (const c of t.cols) if (columnName(c.name) === col) return c.values.filter((x): x is number => x !== null);
      }
      const xs = text.split(/[,\s;]+/).filter(Boolean).map((s) => Number(s.replace(/−/g, '-')));
      return xs.every(Number.isFinite) ? xs : undefined;
    };
    const s = r.stats;
    const inp: InferInput = {
      test: r.test,
      mode: r.mode,
      data: r.input === 'data' && r.test !== 'p1' ? listOf(r.data) : undefined,
      data2: r.input === 'data' && r.test === 't2' ? listOf(r.data2) : undefined,
      mean: num(s.mean),
      sd: num(s.sd),
      n: num(s.n),
      mean2: num(s.mean2),
      sd2: num(s.sd2),
      n2: num(s.n2),
      x: num(s.x),
      sigma: num(s.sigma),
      h0: num(r.h0) ?? 0,
      alt: r.alt,
      level: num(r.level) ?? 0.95,
    };
    try {
      if (r.input === 'data' && r.test !== 'p1' && !inp.data) throw new Error('Enter the data, e.g. 4, 5, 6, or a table column like x₁');
      const res = infer(inp);
      outEl?.replaceChildren(...res.lines.flatMap(([k, val]) => [h('dt', '', { text: k }), h('dd', '', { text: val })]));
      this.describeRowText(r.id, `${TEST_NAME[r.test]} ${r.mode}: ${res.summary}`);
      v.error = null;
      return inferItems(r.id, inp, res);
    } catch (err) {
      outEl?.replaceChildren();
      v.error = (err as Error).message;
      this.describeRowText(r.id, v.error);
      return null;
    }
  }

  /** Hints appear once typing pauses, so they don't flicker under every keystroke. */
  private showHints(): void {
    clearTimeout(this.hintTimer);
    for (const v of this.views.values()) if (!v.error) v.hint.hidden = true;
    this.hintTimer = window.setTimeout(() => {
      for (const v of this.views.values()) {
        if (!v.error) continue;
        v.hint.textContent = v.good?.length ? `${v.error} · showing the last version` : v.error;
        v.hint.hidden = false;
      }
    }, 450);
  }

  // ---------- descriptions (screen readers) ----------
  private describeRowText(id: number, text: string): void {
    const v = this.views.get(id);
    if (v && v.desc.dataset.base !== text) {
      v.desc.dataset.base = text;
      v.desc.textContent = text;
    }
  }

  /** Each curve row's features in words, from the graph's points of interest. */
  private describe(pois: Poi[]): void {
    const byRow = new Map<number, Poi[]>();
    for (const p of pois) for (const id of new Set(p.items)) (byRow.get(id) ?? byRow.set(id, []).get(id)!).push(p);
    const f = (v: number) => fmtValue(v);
    for (const r of this.state.rows) {
      if (r.type !== 'expr') continue;
      const v = this.views.get(r.id);
      const out = this.result?.rows.get(r.id);
      if (!v || !out || out.kind !== 'curve' && out.kind !== 'function' && out.kind !== 'point') continue;
      const ps = byRow.get(r.id) ?? [];
      const parts: string[] = [`${out.kind === 'point' ? 'Point' : 'Curve'} ${r.text.trim()}.`];
      const roots = ps.filter((p) => p.kind === 'root').map((p) => f(p.x));
      if (roots.length) parts.push(`${roots.length === 1 ? 'Root' : 'Roots'} at x = ${roots.slice(0, 6).join(', ')}${roots.length > 6 ? ' and more' : ''}.`);
      for (const k of ['min', 'max'] as const) {
        const e = ps.filter((p) => p.kind === k);
        if (e.length) parts.push(`${k === 'min' ? 'Minimum' : 'Maximum'}${e.length > 1 ? 's' : ''} at ${e.slice(0, 4).map((p) => `(${f(p.x)}, ${f(p.y)})`).join(', ')}.`);
      }
      const yi = ps.find((p) => p.kind === 'y-intercept');
      if (yi) parts.push(`y-intercept ${f(yi.y)}.`);
      const xs = ps.filter((p) => p.kind === 'intersection');
      if (xs.length) parts.push(`Crosses another curve at ${xs.slice(0, 4).map((p) => `(${f(p.x)}, ${f(p.y)})`).join(', ')}.`);
      if (out.kind === 'curve' && ps.length === 0) parts.push('No roots or turning points in view.');
      v.desc.textContent = parts.join(' ');
    }
  }

  // ---------- 3D ----------
  private setDim(dim: '2d' | '3d', record = true): void {
    const changed = this.state.dim !== dim;
    this.state.dim = dim;
    for (const b of this.dimSeg.querySelectorAll('button')) {
      const on = b.dataset.value === dim;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    this.root.dataset.dim = dim;
    if (dim === '3d') {
      this.view.root.hidden = true;
      void this.ensureScene().then(() => {
        if (this.state.dim === '3d' && this.scene) this.scene.root.hidden = false;
        this.replot();
      });
    } else {
      this.view.root.hidden = false;
      if (this.scene) this.scene.root.hidden = true;
      if (changed) this.replot();
    }
    if (changed && record) {
      this.commit();
      this.save();
    }
  }

  private ensureScene(): Promise<void> {
    if (this.scene) return Promise.resolve();
    this.sceneLoading ??= import('../graph/scene3d').then(({ Scene3D }) => {
      this.scene = new Scene3D();
      this.scene.setSettings(this.state.settings);
      this.scene.root.hidden = this.state.dim !== '3d';
      this.view.root.after(this.scene.root);
    });
    return this.sceneLoading;
  }

  private update3d(items: GraphItem[], hidden: number[]): void {
    if (!this.scene) return;
    const cs = getComputedStyle(document.documentElement);
    const color = (id: number) => {
      const r = this.rowOf(id);
      return r?.style?.color || cs.getPropertyValue(`--g${((r?.color ?? id) % PALETTE) + 1}`).trim() || '#2d70b3';
    };
    const hide = new Set(hidden);
    this.scene.set(
      items.filter((it) => !hide.has(it.id)).map((item) => {
        const st = this.rowOf(item.id)?.style;
        return { item, color: color(item.id), opacity: st?.opacity ?? (item.kind === 'surface' || item.kind === 'implicit3d' || item.kind === 'psurface' ? 0.92 : 1), extend: !!st?.extend3d, width: st?.width ?? 2.5 };
      }),
      { ...this.view.params() },
    );
  }

  /** For tests and the share link: the serialisable state. */
  get snapshotState(): State {
    return this.state;
  }
}

export { emptyState };
