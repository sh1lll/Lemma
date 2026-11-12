import type { Session } from '@lemma/math-core';
import {
  evaluateNotebook,
  newCellId,
  notebookToMarkdown,
  parseNotebook,
  serializeNotebook,
  type Cell,
  type CellOutput,
  type CellType,
  type Notebook,
  type NotebookResult,
  type Runner,
  withSeed,
} from '@lemma/notebook-engine';
import type { NotebookSnapshotInput } from '@lemma/ai-engine';
import { renderMarkdown } from '../assistant/markdown';
import { aiReady } from '../assistant/ready';
import type { NotebookAssistantPanel } from '../assistant/notebook-panel';
import type { GraphView } from '../graph/view';
import { loadSettings } from '../storage';
import { SimulationClient } from './sim';
import { ensureNotebookStyles, simulationEl } from './sim-view';
import { blankNotebook, deleteNotebook, listNotebooks, loadNotebook, openLatest, saveNotebook } from './store';

/**
 * The notebook workspace: cells that share one computational context. Every edit re-evaluates the
 * notebook top to bottom (debounced while typing), so what's on the page is always consistent.
 */

export interface NotebookHost {
  runner: Runner;
  parseGraph: (text: string, session: Session) => Promise<import('@lemma/graph-engine').GraphSpec>;
  toast: (msg: string) => void;
  close: () => void;
}

const TYPE_LABEL: Record<CellType, string> = { math: 'Math', text: 'Note', data: 'Data' };

export class NotebookView {
  readonly root = document.createElement('section');
  private nb: Notebook;
  private result: NotebookResult | null = null;
  private cellsEl = document.createElement('div');
  private varsEl = document.createElement('div');
  private titleEl = document.createElement('input');
  private listEl = document.createElement('select');
  private angleEl = document.createElement('button');
  private graphs = new Map<string, GraphView>();
  private graphsCreating = new Map<string, Promise<GraphView>>();
  private timer = 0;
  private abort: AbortController | null = null;
  private run = 0;
  private sims = new SimulationClient();
  private askBtn: HTMLButtonElement | null = null;
  private aiPanel: Promise<NotebookAssistantPanel> | null = null;
  private aiSlot = document.createElement('div');

  constructor(private host: NotebookHost) {
    this.nb = openLatest();
    ensureNotebookStyles();
    this.root.className = 'notebook';
    this.root.setAttribute('aria-label', 'Notebook');
    this.buildToolbar();
    this.syncAsk();
    this.varsEl.className = 'nb-vars';
    this.cellsEl.className = 'nb-cells';
    const foot = document.createElement('div');
    foot.className = 'nb-add';
    for (const t of ['math', 'text', 'data'] as CellType[]) foot.append(this.button(`+ ${TYPE_LABEL[t]}`, `Add a ${TYPE_LABEL[t].toLowerCase()} cell`, () => this.addCell(t, this.nb.cells.length)));
    this.root.append(this.aiSlot, this.varsEl, this.cellsEl, foot);
    this.renderCells();
    void this.evaluate();
  }

  /** Appends a calculator result (the query that produced it) as a new cell. */
  appendQuery(query: string): void {
    const last = this.nb.cells[this.nb.cells.length - 1];
    if (last && last.type === 'math' && !last.source.trim()) last.source = query;
    else this.nb.cells.push({ id: newCellId(), type: 'math', source: query });
    this.changed(true);
    this.renderCells();
  }

  /** Re-evaluate, e.g. once a slow engine has finished loading. */
  refresh(): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.evaluate(), 50);
  }

  focusFirst(): void {
    this.syncAsk();
    this.cellsEl.querySelector<HTMLTextAreaElement>('textarea')?.focus();
  }

  /** Inserts a cell after the 1-based cell `after` (0 = top, default the end); returns its 1-based number. */
  insertCell(type: 'math' | 'text', source: string, after?: number): number {
    const at = after === undefined ? this.nb.cells.length : Math.max(0, Math.min(this.nb.cells.length, Math.floor(after)));
    const cell: Cell = { id: newCellId(), type, source };
    this.nb.cells.splice(at, 0, cell);
    this.changed(true);
    this.renderCells();
    this.cellsEl.querySelector(`[data-cell="${cell.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    this.host.toast(`Added cell ${at + 1}`);
    return at + 1;
  }

  /** What the notebook assistant may read: cells, their results and the names defined. */
  snapshot(): NotebookSnapshotInput {
    const r = this.result;
    const seen = new Map<string, { name: string; kind: string; value: string }>();
    for (const b of r?.bindings ?? []) seen.set(b.name, b);
    return {
      title: this.nb.title,
      cells: this.nb.cells.map((c) => ({ type: c.type, source: c.source })),
      outputs: this.nb.cells.map((c) => r?.outputs.get(c.id)),
      variables: [...seen.values()],
    };
  }

  // ---------- assistant ----------
  /** The Ask button shows only when the optional AI assistant is on and configured. */
  private syncAsk(): void {
    if (this.askBtn) this.askBtn.hidden = !aiReady(loadSettings());
  }

  private openAssistant(): void {
    this.aiPanel ??= import('../assistant/notebook-panel').then(({ NotebookAssistantPanel }) => {
      const p = new NotebookAssistantPanel({
        snapshot: () => this.snapshot(),
        session: () => this.result?.session ?? null,
        runner: this.host.runner,
        insertCell: (type, source, after) => this.insertCell(type, source, after),
      });
      this.aiSlot.append(p.root);
      return p;
    });
    this.aiPanel.then(
      (p) => (p.root.hidden ? p.open() : p.close()),
      () => {
        this.aiPanel = null;
        this.host.toast('Couldn’t load the assistant');
      },
    );
  }

  // ---------- toolbar ----------
  private button(label: string, title: string, on: () => void, cls = 'nb-btn'): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', on);
    return b;
  }

  private buildToolbar(): void {
    const bar = document.createElement('div');
    bar.className = 'nb-bar';
    bar.append(this.button('←', 'Back to the calculator', () => this.host.close(), 'nb-btn nb-back'));
    this.titleEl.className = 'nb-title';
    this.titleEl.setAttribute('aria-label', 'Notebook title');
    this.titleEl.addEventListener('input', () => {
      this.nb.title = this.titleEl.value.trim() || 'Untitled notebook';
      this.changed(false);
      this.refreshList();
    });
    this.listEl.className = 'nb-list';
    this.listEl.setAttribute('aria-label', 'Open notebook');
    this.listEl.addEventListener('change', () => {
      const v = this.listEl.value;
      if (v === '__new') this.open(blankNotebook());
      else {
        const nb = loadNotebook(v);
        if (nb) this.open(nb);
      }
    });
    this.angleEl.className = 'pill';
    this.angleEl.title = 'Angle mode for this notebook';
    this.angleEl.addEventListener('click', () => {
      this.nb.angle = this.nb.angle === 'deg' ? 'rad' : 'deg';
      this.changed(true);
    });
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = '.json,.lemma,application/json,.csv,.tsv,text/csv,text/plain';
    file.hidden = true;
    file.addEventListener('change', () => void this.importFile(file));
    const more = document.createElement('div');
    more.className = 'nb-more';
    more.append(
      this.button('Import', 'Import a notebook (.json) or data (.csv)', () => file.click()),
      this.button('Export', 'Download this notebook (.json)', () => this.download(`${this.slug()}.lemma.json`, serializeNotebook(this.nb), 'application/json')),
      this.button('Markdown', 'Download as Markdown with results', () => this.download(`${this.slug()}.md`, notebookToMarkdown(this.nb, this.result?.outputs ?? new Map()), 'text/markdown')),
      this.button('Print', 'Print or save as PDF', () => window.print()),
      this.button('Delete', 'Delete this notebook', () => this.remove()),
      file,
    );
    this.askBtn = this.button('Ask', 'Ask about this notebook', () => this.openAssistant(), 'nb-btn nb-ask');
    bar.append(this.titleEl, this.listEl, this.angleEl, this.askBtn, more);
    this.root.append(bar);
    this.syncToolbar();
  }

  private syncToolbar(): void {
    this.titleEl.value = this.nb.title;
    this.angleEl.textContent = this.nb.angle.toUpperCase();
    this.refreshList();
  }

  private refreshList(): void {
    this.listEl.replaceChildren();
    const metas = listNotebooks();
    if (!metas.some((m) => m.id === this.nb.id)) metas.unshift({ id: this.nb.id, title: this.nb.title, updated: this.nb.updated });
    for (const m of metas) {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = m.id === this.nb.id ? this.nb.title : m.title;
      this.listEl.append(o);
    }
    const n = document.createElement('option');
    n.value = '__new';
    n.textContent = '+ New notebook';
    this.listEl.append(n);
    this.listEl.value = this.nb.id;
  }

  private open(nb: Notebook): void {
    this.nb = nb;
    this.graphs.forEach((g) => g.destroy());
    this.graphs.clear();
    this.result = null;
    saveNotebook(nb);
    this.syncToolbar();
    this.renderCells();
    void this.evaluate();
  }

  private remove(): void {
    if (!confirm(`Delete “${this.nb.title}”? This can’t be undone.`)) return;
    deleteNotebook(this.nb.id);
    this.open(openLatest());
    this.host.toast('Notebook deleted');
  }

  private slug(): string {
    return this.nb.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'notebook';
  }

  private download(name: string, text: string, type: string): void {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  private async importFile(input: HTMLInputElement): Promise<void> {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    if (f.size > 5_000_000) return this.host.toast('That file is too large (max 5 MB)');
    const text = await f.text();
    if (/\.(csv|tsv|txt)$/i.test(f.name) || f.type.startsWith('text/')) {
      // Data file: add as a data cell to this notebook.
      this.nb.cells.push({ id: newCellId(), type: 'data', source: text });
      this.changed(true);
      this.renderCells();
      return this.host.toast(`Imported ${f.name} as a data cell`);
    }
    try {
      this.open(parseNotebook(text));
      this.host.toast(`Opened “${this.nb.title}”`);
    } catch (e) {
      this.host.toast(e instanceof Error ? e.message : 'Couldn’t import that file');
    }
  }

  // ---------- cells ----------
  private addCell(type: CellType, at: number): void {
    const cell: Cell = { id: newCellId(), type, source: '' };
    this.nb.cells.splice(at, 0, cell);
    this.changed(false);
    this.renderCells();
    this.cellsEl.querySelector<HTMLTextAreaElement>(`[data-cell="${cell.id}"] textarea`)?.focus();
  }

  private move(i: number, d: number): void {
    const j = i + d;
    if (j < 0 || j >= this.nb.cells.length) return;
    [this.nb.cells[i], this.nb.cells[j]] = [this.nb.cells[j]!, this.nb.cells[i]!];
    this.changed(true);
    this.renderCells();
  }

  private renderCells(): void {
    this.cellsEl.replaceChildren();
    this.nb.cells.forEach((cell, i) => this.cellsEl.append(this.cellEl(cell, i)));
    this.paintOutputs();
  }

  private cellEl(cell: Cell, i: number): HTMLElement {
    const box = document.createElement('div');
    box.className = `nb-cell nb-${cell.type}`;
    box.dataset.cell = cell.id;
    const gutter = document.createElement('div');
    gutter.className = 'nb-gutter';
    const type = document.createElement('select');
    type.setAttribute('aria-label', 'Cell type');
    for (const t of ['math', 'text', 'data'] as CellType[]) {
      const o = document.createElement('option');
      o.value = t;
      o.textContent = TYPE_LABEL[t];
      type.append(o);
    }
    type.value = cell.type;
    type.addEventListener('change', () => {
      cell.type = type.value as CellType;
      this.changed(true);
      this.renderCells();
    });
    const tools = document.createElement('div');
    tools.className = 'nb-tools';
    tools.append(
      this.button('↑', 'Move up', () => this.move(i, -1)),
      this.button('↓', 'Move down', () => this.move(i, 1)),
      this.button('+', 'Insert a cell below', () => this.addCell('math', i + 1)),
      this.button('✕', 'Delete cell', () => {
        this.graphs.get(cell.id)?.destroy();
        this.graphs.delete(cell.id);
        this.nb.cells.splice(i, 1);
        if (!this.nb.cells.length) this.nb.cells.push({ id: newCellId(), type: 'math', source: '' });
        this.changed(true);
        this.renderCells();
      }),
    );
    gutter.append(type, tools);

    const body = document.createElement('div');
    body.className = 'nb-body';
    const ta = document.createElement('textarea');
    ta.value = cell.source;
    ta.rows = 1;
    ta.spellcheck = cell.type === 'text';
    ta.setAttribute('aria-label', `${TYPE_LABEL[cell.type]} cell ${i + 1}`);
    ta.placeholder = cell.type === 'math' ? 'x = 5 · f(x) = x^2 · area = integrate f(x) from 0 to 2 · graph f(x) · simulate 10000: sum of 2 dice >= 10' : cell.type === 'data' ? 'Paste CSV or tab-separated data (first row = column names)' : 'Write notes (Markdown and $math$ supported)';
    const grow = () => {
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight + 2}px`;
    };
    ta.addEventListener('input', () => {
      cell.source = ta.value;
      grow();
      this.changed(true);
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.shiftKey || e.metaKey || e.ctrlKey)) {
        // Shift/⌘+Enter: run now and move to the next cell (creating one at the end).
        e.preventDefault();
        void this.evaluate();
        if (i === this.nb.cells.length - 1) this.addCell('math', i + 1);
        else this.cellsEl.querySelectorAll<HTMLTextAreaElement>('textarea')[i + 1]?.focus();
      }
    });
    requestAnimationFrame(grow);
    const out = document.createElement('div');
    out.className = 'nb-out';
    if (cell.type === 'text') {
      // Notes show rendered until focused.
      const view = document.createElement('div');
      view.className = 'nb-note';
      view.tabIndex = 0;
      const show = () => {
        renderMarkdown(view, cell.source || '_Empty note: click to write_');
        view.hidden = false;
        ta.hidden = true;
      };
      view.addEventListener('click', () => {
        view.hidden = true;
        ta.hidden = false;
        ta.focus();
        grow();
      });
      view.addEventListener('keydown', (e) => e.key === 'Enter' && view.click());
      ta.addEventListener('blur', show);
      body.append(view, ta);
      if (cell.source) show();
      else view.hidden = true;
    } else body.append(ta);
    body.append(out);
    box.append(gutter, body);
    return box;
  }

  // ---------- evaluation ----------
  private changed(reevaluate: boolean): void {
    this.nb.updated = Date.now();
    if (!saveNotebook(this.nb)) this.host.toast('Storage is full: export this notebook to keep it');
    if (!reevaluate) return;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.evaluate(), 350);
  }

  private async evaluate(): Promise<void> {
    clearTimeout(this.timer);
    this.abort?.abort();
    const abort = (this.abort = new AbortController());
    const run = ++this.run;
    this.root.classList.add('running');
    const live = () => run === this.run;
    const r = await evaluateNotebook(this.nb, this.host.runner, abort.signal, {
      simulate: this.sims.run,
      onCellStart: (id) => live() && this.cellsEl.querySelector(`[data-cell="${id}"]`)?.classList.add('computing'),
      onCellDone: (id, _outs, soFar) => {
        if (!live()) return;
        this.cellsEl.querySelector(`[data-cell="${id}"]`)?.classList.remove('computing');
        this.result = soFar;
        this.paintCell(id);
      },
    });
    if (!live()) return; // superseded by a newer edit
    this.result = r;
    this.root.classList.remove('running');
    this.angleEl.textContent = this.nb.angle.toUpperCase();
    this.paintOutputs();
  }

  private paintOutputs(): void {
    const r = this.result;
    if (!r) return;
    this.varsEl.replaceChildren();
    if (r.bindings.length) {
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = 'Defined';
      this.varsEl.append(label);
      const seen = new Map<string, (typeof r.bindings)[number]>();
      for (const b of r.bindings) seen.set(b.name, b);
      for (const b of seen.values()) {
        const chip = document.createElement('span');
        chip.className = `nb-var ${b.kind}`;
        chip.textContent = b.kind === 'function' ? b.value.split(' = ')[0]! : b.kind === 'data' ? `${b.name} [${b.value}]` : `${b.name} = ${b.value}`;
        chip.title = b.value;
        this.varsEl.append(chip);
      }
    }
    for (const cell of this.nb.cells) this.paintCell(cell.id);
  }

  private paintCell(id: string): void {
    const r = this.result;
    if (!r) return;
    {
      const cell = { id };
      const el = this.cellsEl.querySelector<HTMLElement>(`[data-cell="${cell.id}"] .nb-out`);
      if (!el) return;
      const outs = r.outputs.get(cell.id) ?? [];
      const keepGraph = this.graphs.get(cell.id);
      el.replaceChildren();
      let graphUsed = false;
      for (const o of outs) {
        if (o.kind === 'graph' && o.graph) {
          graphUsed = true;
          void this.paintGraph(cell.id, el, o.graph, r.session);
          continue;
        }
        if (o.simulation) {
          const input = o.input;
          el.append(simulationEl(o, outs.length > 1, () => this.rerun(cell.id, input)));
          continue;
        }
        el.append(this.outputEl(o, outs.length > 1));
      }
      if (!graphUsed && keepGraph) {
        keepGraph.destroy();
        this.graphs.delete(cell.id);
      }
    }
  }

  /** Re-runs a simulation line with a new random seed, written into the line so the result stays reproducible. */
  private rerun(cellId: string, input: string): void {
    const cell = this.nb.cells.find((c) => c.id === cellId);
    if (!cell) return;
    const seed = Math.floor(Math.random() * 1_000_000);
    let replaced = false;
    cell.source = cell.source
      .split('\n')
      .map((raw) => {
        if (replaced || raw.trim() !== input) return raw;
        const m = /^(\s*(?:[a-z][a-z0-9_]*\s*=\s*)?)(simulate\b.*)$/i.exec(raw);
        if (!m) return raw;
        replaced = true;
        return m[1] + withSeed(m[2]!, seed);
      })
      .join('\n');
    if (!replaced) return;
    const ta = this.cellsEl.querySelector<HTMLTextAreaElement>(`[data-cell="${cellId}"] textarea`);
    if (ta) ta.value = cell.source;
    this.changed(true);
  }

  /** One GraphView per cell, created once even when paints overlap (progressive + final paint). */
  private graphFor(cellId: string, spec: import('@lemma/graph-engine').GraphSpec): Promise<GraphView> {
    const existing = this.graphs.get(cellId);
    if (existing) {
      existing.setSpec(spec);
      return Promise.resolve(existing);
    }
    let creating = this.graphsCreating.get(cellId);
    if (!creating) {
      creating = import('../graph/view').then(({ GraphView }) => {
        const g = new GraphView(spec);
        this.graphs.set(cellId, g);
        this.graphsCreating.delete(cellId);
        return g;
      });
      this.graphsCreating.set(cellId, creating);
      return creating;
    }
    return creating.then((g) => {
      g.setSpec(spec);
      return g;
    });
  }

  private async paintGraph(cellId: string, el: HTMLElement, text: string, session: Session): Promise<void> {
    try {
      const spec = await this.host.parseGraph(text, session);
      const g = await this.graphFor(cellId, spec);
      if (el.isConnected) el.append(g.root);
    } catch (e) {
      el.append(this.outputEl({ kind: 'error', input: text, error: e instanceof Error ? e.message : String(e) }, false));
    }
  }

  private outputEl(o: CellOutput, showInput: boolean): HTMLElement {
    const row = document.createElement('div');
    row.className = `nb-result ${o.kind}`;
    if (o.kind === 'error') {
      row.textContent = (showInput ? `${o.input} → ` : '') + (o.error ?? 'Error');
      return row;
    }
    const head = document.createElement('div');
    head.className = 'nb-value';
    if (showInput && o.kind !== 'data') {
      const q = document.createElement('span');
      q.className = 'nb-q';
      // A definition has no value of its own: its line reads "f(x) = …  → f(x)", one arrow, not two.
      q.textContent = o.binding && !o.display ? `${o.input}  ` : `${o.input}  →  `;
      head.append(q);
    }
    const v = document.createElement('span');
    v.textContent = o.display ?? '';
    head.append(v);
    if (o.unit) {
      const u = document.createElement('span');
      u.className = 'unit';
      u.textContent = ` ${o.unit}`;
      head.append(u);
    }
    if (o.binding) {
      const b = document.createElement('span');
      b.className = 'nb-bound';
      b.textContent = `→ ${o.binding.kind === 'function' ? o.binding.value.split(' = ')[0] : o.binding.name}`;
      b.title = 'Defined for the cells below';
      head.append(b);
    }
    if (o.verified?.ok) {
      const ok = document.createElement('span');
      ok.className = 'tag exact';
      ok.textContent = ' ✓ verified';
      ok.title = o.verified.how;
      head.append(ok);
    }
    row.append(head);
    if (o.latex?.length) {
      const m = document.createElement('div');
      m.className = 'math';
      row.append(m);
      void import('../math-render').then(({ renderMath }) => o.latex!.forEach((l) => {
        const d = document.createElement('div');
        renderMath(d, l);
        m.append(d);
      }));
    }
    if (o.lines?.length) {
      const dl = document.createElement('div');
      dl.className = 'lines rows';
      for (const l of o.lines) {
        const dt = document.createElement('dt');
        dt.textContent = l.label;
        const dd = document.createElement('dd');
        dd.textContent = l.display;
        dl.append(dt, dd);
      }
      row.append(dl);
    }
    if (o.table) {
      const wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      const t = document.createElement('table');
      const h = t.createTHead().insertRow();
      o.table.columns.forEach((c) => {
        const th = document.createElement('th');
        th.textContent = c;
        h.append(th);
      });
      const b = t.createTBody();
      o.table.rows.forEach((r, i) => {
        const tr = b.insertRow();
        if (i === o.table!.highlightRow) tr.className = 'best';
        r.forEach((c) => (tr.insertCell().textContent = c));
      });
      wrap.append(t);
      const d = document.createElement('div');
      d.className = 'detail';
      d.append(wrap);
      row.append(d);
    }
    if (o.notes?.length) {
      const n = document.createElement('div');
      n.className = 'nb-notes';
      n.textContent = o.notes.join(' · ');
      row.append(n);
    }
    return row;
  }
}
