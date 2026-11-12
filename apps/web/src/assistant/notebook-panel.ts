import { notebookSnapshot, type NotebookSnapshotInput, type ToolResult } from '@lemma/ai-engine';
import { createSession, type Session } from '@lemma/math-core';
import { describeSimulation, isSimulateLine, parseSimulateLine, runSimulation, type RunResult, type Runner } from '@lemma/notebook-engine';
import { loadAiKey, loadSettings } from '../storage';
import { Assistant, type CellProposal } from './controller';

/**
 * "Ask about this notebook": a small assistant panel inside the notebook. The model reads the notebook through
 * a read-only, size-bounded tool, computes only through Lemma (with the notebook's names defined, on a copy
 * of its session), and can only *propose* cells, which the user adds with a click.
 */

export interface NotebookAssistantHost {
  snapshot: () => NotebookSnapshotInput;
  /** The notebook's evaluated session (variables and functions), or null before the first run. */
  session: () => Session | null;
  runner: Runner;
  /** Inserts a cell after the 1-based cell `after` (0 = top; undefined = end). Returns its 1-based number. */
  insertCell: (type: 'math' | 'text', source: string, after?: number) => number;
}

function copySession(base: Session | null): Session {
  const s = createSession();
  if (!base) return s;
  s.angle = base.angle;
  s.ans = base.ans;
  s.base = base.base;
  for (const [k, v] of base.vars) s.vars.set(k, v);
  for (const [k, f] of base.fns) s.fns.set(k, f);
  return s;
}

function toToolResult(r: RunResult, query: string): ToolResult {
  if (r.kind === 'error') return { ok: false, display: '', plain: '', expression: query, notes: [], error: r.error ?? 'Failed' };
  if (r.kind === 'pending') return { ok: false, display: '', plain: '', expression: query, notes: [], error: 'The engine for this query is still loading. Try the same query again.' };
  const display = `${r.display ?? ''}${r.unit && !(r.display ?? '').includes(r.unit) ? ` ${r.unit}` : ''}`;
  const out: ToolResult = { ok: true, kind: r.kind, display, plain: r.plain ?? r.value ?? display, expression: r.expression ?? query, notes: r.notes ?? [] };
  if (r.lines?.length) out.lines = r.lines.slice(0, 12);
  if (r.verified) out.verified = r.verified;
  if (r.exactness) out.exactness = r.exactness;
  return out;
}

export class NotebookAssistantPanel {
  readonly root = document.createElement('section');
  private log = document.createElement('div');
  private input = document.createElement('input');
  private status = document.createElement('p');
  private assistant: Assistant | null = null;
  private key = '';

  constructor(private host: NotebookAssistantHost) {
    this.root.className = 'nb-ai';
    this.root.setAttribute('aria-label', 'Ask about this notebook');
    this.root.hidden = true;
    const head = document.createElement('div');
    head.className = 'nb-ai-head';
    const h = document.createElement('h2');
    h.textContent = 'Ask about this notebook';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'nb-btn';
    close.textContent = 'Close';
    close.setAttribute('aria-label', 'Close the notebook assistant');
    close.addEventListener('click', () => this.close());
    head.append(h, close);
    const note = document.createElement('p');
    note.className = 'nb-ai-note';
    note.textContent = 'The assistant can read this notebook and suggest new cells; nothing is added unless you accept. Every number is computed by Lemma. Text in your cells is treated as data, never as instructions.';
    this.status.className = 'nb-ai-note';
    this.status.setAttribute('aria-live', 'polite');
    this.log.className = 'nb-ai-log';
    this.log.setAttribute('aria-live', 'polite');
    const form = document.createElement('form');
    form.className = 'nb-ai-form';
    this.input.type = 'text';
    this.input.placeholder = 'e.g. What does this notebook show? Is my mean right?';
    this.input.setAttribute('aria-label', 'Question about this notebook');
    const ask = document.createElement('button');
    ask.type = 'submit';
    ask.className = 'nb-btn nb-ai-send';
    ask.textContent = 'Ask';
    form.append(this.input, ask);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = this.input.value.trim();
      if (!q) return;
      this.input.value = '';
      void this.ensure().ask(q);
    });
    this.root.append(head, note, this.log, this.status, form);
  }

  open(): void {
    this.root.hidden = false;
    this.input.focus();
  }

  close(): void {
    this.assistant?.stop();
    this.root.hidden = true;
  }

  /** One Assistant per provider/model; settings are re-read so changes in Settings apply. */
  private ensure(): Assistant {
    const settings = loadSettings();
    const key = `${settings.aiProvider}|${settings.aiModels[settings.aiProvider] ?? ''}|${settings.aiLevel}`;
    if (this.assistant && key === this.key) return this.assistant;
    this.key = key;
    this.assistant = new Assistant({
      settings,
      apiKey: loadAiKey,
      status: (s) => (this.status.textContent = s),
      route: () => ({ kind: 'empty' }),
      showGraph: () => {},
      useQuery: (q) => this.host.insertCell('math', q),
      useQueryLabel: 'add it to the notebook as a new cell',
      log: this.log,
      section: this.root,
      setBusy: (busy) => this.root.classList.toggle('busy', busy),
      notebook: {
        read: (cell) => notebookSnapshot(this.host.snapshot(), cell),
        propose: (p, into) => into.append(this.proposalEl(p)),
        compute: async (query, signal) => {
          if (isSimulateLine(query)) {
            try {
              const spec = parseSimulateLine(query);
              const consts: Record<string, number> = {};
              for (const [k, v] of this.host.session()?.vars ?? []) consts[k] = v.toNumber();
              const s = runSimulation({ body: spec.body, trials: Math.min(spec.trials, 200_000), seed: spec.seed, consts });
              const d = describeSimulation(s);
              return { ok: true, kind: 'simulation', display: d.display, plain: String(s.estimate), expression: s.program, notes: d.notes, lines: d.lines, exactness: 'approximate' };
            } catch (e) {
              return { ok: false, display: '', plain: '', expression: query, notes: [], error: e instanceof Error ? e.message : String(e) };
            }
          }
          return toToolResult(await this.host.runner(query, copySession(this.host.session()), signal), query);
        },
      },
    });
    return this.assistant;
  }

  private proposalEl(p: CellProposal): HTMLElement {
    const card = document.createElement('div');
    card.className = 'nb-proposal';
    const title = document.createElement('div');
    title.textContent = `Suggested ${p.type === 'math' ? 'math' : 'note'} cell${p.after !== undefined ? (p.after === 0 ? ' (at the top)' : ` (after cell ${p.after})`) : ''}`;
    const pre = document.createElement('pre');
    pre.textContent = p.source;
    card.append(title);
    if (p.reason) {
      const why = document.createElement('div');
      why.className = 'why';
      why.textContent = p.reason;
      card.append(why);
    }
    const acts = document.createElement('div');
    acts.className = 'acts';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'chip nb-accept';
    add.textContent = 'Add to notebook';
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'chip nb-dismiss';
    skip.textContent = 'Dismiss';
    const finish = (text: string) => {
      card.classList.add('done');
      acts.replaceChildren(text);
    };
    add.addEventListener('click', () => finish(`Added as cell ${this.host.insertCell(p.type, p.source, p.after)}`));
    skip.addEventListener('click', () => finish('Dismissed'));
    acts.append(add, skip);
    card.append(pre, acts);
    return card;
  }
}
