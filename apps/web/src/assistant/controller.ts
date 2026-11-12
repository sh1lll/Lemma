import {
  AIError,
  createProvider,
  LocalProvider,
  NOTEBOOK_PROMPT,
  NOTEBOOK_TOOLS,
  presetById,
  explainResult,
  extractFromImage,
  resolveOutcome,
  runAssistant,
  type AIProvider,
  type ChatMessage,
  type ImageMediaType,
  type ToolCallRecord,
  type ToolExecutor,
  type ToolResult,
} from '@lemma/ai-engine';
import type { Answer } from '@lemma/math-core';
import type { Outcome } from '../engine';
import type { Settings } from '../storage';
import { renderMarkdown } from './markdown';

/**
 * The assistant (Phase 4). The AI interprets and explains; every number comes from Lemma's deterministic
 * router through the `compute` tool, and each call is shown to the user as a chip they can open.
 */

export interface AssistantHost {
  settings: Settings;
  apiKey: (provider: string) => string;
  /** Status line for long waits (e.g. the one-time on-device model download). */
  status: (s: string) => void;
  /** Runs a query through the deterministic router (same as typing it). */
  route: (query: string) => Outcome;
  /** Shows a graph for the given expressions in the result area. */
  showGraph: (expressions: string[]) => void;
  /** Puts a query into the calculator input and computes it. */
  useQuery: (query: string) => void;
  /** What clicking a tool chip does, for its tooltip (default "open in the calculator"). */
  useQueryLabel?: string;
  log: HTMLElement;
  section: HTMLElement;
  setBusy: (busy: boolean) => void;
  /** Present when asking about an open notebook: read-only access, cell proposals, and compute in its context. */
  notebook?: NotebookTools;
}

export interface CellProposal {
  type: 'math' | 'text';
  source: string;
  /** 1-based cell to insert after (0 = top); default: the end. */
  after?: number;
  reason?: string;
}

export interface NotebookTools {
  /** Bounded JSON snapshot (see ai-engine notebookSnapshot). */
  read: (cell?: number) => string;
  /** Shows a proposal in the reply; nothing changes unless the user accepts it. */
  propose: (p: CellProposal, into: HTMLElement) => void;
  /** Computes with the notebook's variables and functions defined (on a copy; the notebook is not changed). */
  compute: (query: string, signal?: AbortSignal) => Promise<ToolResult>;
}

const MAX_HISTORY = 24;

export class Assistant {
  private history: ChatMessage[] = [];
  private abort: AbortController | null = null;
  /** The reply being written (proposals are attached to it). */
  private bubble: HTMLElement | null = null;

  constructor(private host: AssistantHost) {}

  private async provider(): Promise<AIProvider> {
    const s = this.host.settings;
    const p = presetById(s.aiProvider);
    if (p.kind === 'builtin') {
      const { localModel, runsNatively } = await import('./local');
      const { defaultLocalModel } = await import('@lemma/ai-engine');
      const model = s.aiModels[p.id] || defaultLocalModel(runsNatively());
      const m = localModel(model);
      if (!m.ready) {
        m.onStatus = this.host.status;
        m.load(model);
        await m.whenReady();
      }
      return new LocalProvider(m);
    }
    const model = s.aiModels[p.id] || p.defaultModel;
    if (p.kind === 'anthropic') return createProvider({ kind: 'anthropic', apiKey: this.host.apiKey(p.id), model, effort: 'low' });
    return createProvider({ kind: 'openai-compatible', baseUrl: s.aiBaseUrls[p.id] || p.baseUrl || '', apiKey: this.host.apiKey(p.id) || undefined, model, name: p.label });
  }

  private tools: ToolExecutor = async (name, args, signal) => {
    const nb = this.host.notebook;
    if (nb && name === 'read_notebook') {
      return { ok: true, kind: 'notebook', display: 'Read the notebook', plain: nb.read(typeof args.cell === 'number' ? args.cell : undefined), expression: 'read notebook', notes: [] };
    }
    if (nb && name === 'propose_cell') {
      const p: CellProposal = { type: args.type === 'text' ? 'text' : 'math', source: String(args.source ?? ''), after: typeof args.after === 'number' ? args.after : undefined, reason: typeof args.reason === 'string' ? args.reason : undefined };
      if (this.bubble) nb.propose(p, this.bubble);
      return { ok: true, kind: 'proposal', display: 'Shown to the user as a proposal; it is added only if they accept it.', plain: '', expression: `propose ${p.type} cell`, notes: [] };
    }
    if (nb && name === 'compute') return nb.compute(String(args.query ?? ''), signal);
    if (name === 'graph') {
      const expressions = (args.expressions as string[]) ?? [];
      this.host.showGraph(expressions);
      return { ok: true, display: 'Graph shown to the user.', plain: '', expression: expressions.join(', '), notes: [] };
    }
    const query = String(args.query ?? '');
    return resolveOutcome(() => this.host.route(query) as never, query, { signal, maxWaits: 6 });
  };

  stop(): void {
    this.abort?.abort();
  }

  reset(): void {
    this.stop();
    this.history = [];
    this.host.log.replaceChildren();
    this.host.section.hidden = true;
  }

  /** Ask in plain language. `image` is a data URL from a photo or screenshot. */
  async ask(text: string, image?: { dataUrl: string; mediaType: string }): Promise<void> {
    const content: ChatMessage['content'] = image
      ? [{ type: 'image', mediaType: image.mediaType as ImageMediaType, data: image.dataUrl.replace(/^data:[^;]+;base64,/, '') }, { type: 'text', text: text || 'Solve the problem in this image.' }]
      : text;
    this.userBubble(text, image?.dataUrl);
    await this.run((p, signal, view) =>
      runAssistant({
        provider: p,
        tools: this.tools,
        level: this.host.settings.aiLevel,
        mode: /\b(?:check my (?:work|answer|working)|is this (?:right|correct))\b/i.test(text) ? 'check-work' : 'chat',
        ...(this.host.notebook ? { toolSpecs: NOTEBOOK_TOOLS, systemExtra: NOTEBOOK_PROMPT } : {}),
        messages: [...this.history, { role: 'user', content }],
        signal,
        onText: view.text,
        onToolResult: view.chip,
      }),
    );
  }

  /** Explain a result the calculator already produced. */
  async explain(answer: Answer, question: string): Promise<void> {
    this.userBubble(`Explain: ${question}`);
    await this.run((p, signal, view) =>
      explainResult(answer, this.host.settings.aiLevel === 'answer-only' ? 'concise' : this.host.settings.aiLevel, {
        provider: p,
        tools: this.tools,
        question,
        signal,
        onText: view.text,
        onToolResult: view.chip,
      }),
    );
  }

  /** Reads a photo/screenshot into editable queries; does not solve anything. */
  async readImage(dataUrl: string, mediaType: string): Promise<void> {
    this.userBubble('Read this problem', dataUrl);
    const bubble = this.assistantBubble();
    bubble.body.classList.add('typing');
    this.host.setBusy(true);
    this.abort = new AbortController();
    try {
      const x = await extractFromImage(await this.provider(), dataUrl, mediaType, { signal: this.abort.signal });
      bubble.body.classList.remove('typing');
      if (x.noMathFound || !x.problems.length) {
        bubble.body.textContent = x.note ?? 'I couldn’t find a maths problem in that image.';
        return;
      }
      bubble.body.textContent = `Found ${x.problems.length} problem${x.problems.length > 1 ? 's' : ''}. Check the wording, then calculate or ask me to solve it.`;
      const list = document.createElement('div');
      list.className = 'problems';
      for (const p of x.problems) {
        const row = document.createElement('div');
        row.className = 'problem';
        const input = document.createElement('input');
        input.value = p.query;
        input.title = p.description;
        input.setAttribute('aria-label', p.description || 'Recognised problem');
        const calc = document.createElement('button');
        calc.type = 'button';
        calc.className = 'chip';
        calc.textContent = 'Calculate';
        calc.addEventListener('click', () => this.host.useQuery(input.value));
        const solve = document.createElement('button');
        solve.type = 'button';
        solve.className = 'chip';
        solve.textContent = 'Solve with steps';
        solve.addEventListener('click', () => void this.ask(`Solve step by step: ${input.value}`));
        row.append(input, calc, solve);
        list.append(row);
      }
      bubble.root.append(list);
    } catch (e) {
      bubble.body.classList.remove('typing');
      bubble.body.textContent = errorText(e);
    } finally {
      this.host.setBusy(false);
      this.abort = null;
    }
  }

  // ---------- internals ----------
  private async run(
    go: (
      p: AIProvider,
      signal: AbortSignal,
      view: { text: (d: string) => void; chip: (r: ToolCallRecord) => void },
    ) => Promise<{ text: string; newMessages?: ChatMessage[]; messages?: ChatMessage[] }>,
  ): Promise<void> {
    this.stop();
    const bubble = this.assistantBubble();
    this.bubble = bubble.root;
    let streamed = '';
    let frame = 0;
    const paint = () => {
      frame = 0;
      renderMarkdown(bubble.body, streamed);
    };
    bubble.body.classList.add('typing');
    this.host.setBusy(true);
    this.abort = new AbortController();
    try {
      const r = await go(await this.provider(), this.abort.signal, {
        text: (d) => {
          streamed += d;
          // Re-render at most once per frame while streaming.
          frame ||= requestAnimationFrame(paint);
        },
        chip: (rec) => bubble.chips.append(toolChip(rec, this.host.useQuery, this.host.useQueryLabel)),
      });
      cancelAnimationFrame(frame);
      renderMarkdown(bubble.body, r.text || streamed);
      if (r.messages) this.history = r.messages.slice(-MAX_HISTORY);
    } catch (e) {
      cancelAnimationFrame(frame);
      const msg = errorText(e);
      if (streamed) renderMarkdown(bubble.body, `${streamed}\n\n_${msg}_`);
      else bubble.body.textContent = msg;
    } finally {
      bubble.body.classList.remove('typing');
      this.host.setBusy(false);
      this.abort = null;
    }
  }

  private userBubble(text: string, image?: string): void {
    this.host.section.hidden = false;
    const d = document.createElement('div');
    d.className = 'msg user';
    d.textContent = text;
    if (image) {
      const img = document.createElement('img');
      img.src = image;
      img.alt = 'Attached image';
      d.append(img);
    }
    this.host.log.append(d);
  }

  private assistantBubble() {
    const root = document.createElement('div');
    root.className = 'msg assistant';
    const chips = document.createElement('div');
    chips.className = 'tool-calls';
    const body = document.createElement('div');
    root.append(chips, body);
    this.host.log.append(root);
    root.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return { root, chips, body };
  }
}

function toolChip(rec: ToolCallRecord, use: (q: string) => void, useLabel = 'open in the calculator'): HTMLElement {
  const r: ToolResult = rec.result;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `tool-chip ${r.ok ? 'ok' : 'fail'}`;
  if (rec.name === 'read_notebook' || rec.name === 'propose_cell') {
    b.className = 'tool-chip ok';
    b.disabled = true;
    b.textContent = rec.name === 'read_notebook' ? 'Read the notebook' : r.ok ? 'Proposed a cell' : `Proposal rejected: ${r.error ?? 'invalid'}`;
    return b;
  }
  const q = rec.name === 'compute' ? String(rec.args.query ?? '') : `graph ${((rec.args.expressions as string[]) ?? []).join(', ')}`;
  b.title = `Computed by Lemma${r.verified ? (r.verified.ok ? ' · verified' : ' · not verified') : ''}. Click to ${useLabel}.`;
  b.append(`${q} → `);
  const v = document.createElement('b');
  v.textContent = r.ok ? r.display : `error: ${r.error ?? 'failed'}`;
  b.append(v);
  if (r.verified?.ok) b.append(' ✓');
  b.addEventListener('click', () => use(q));
  return b;
}

function errorText(e: unknown): string {
  if (e instanceof AIError) return e.code === 'aborted' ? 'Stopped.' : e.message;
  return e instanceof Error ? e.message : String(e);
}
