import { AIError } from '../errors';
import { partsOf, textOf, type AIProvider, type ChatMessage, type ChatRequest, type ChatResponse, type ContentPart, type ToolCallPart, type ToolSpec } from '../types';

/**
 * A model running on the user's own device (transformers.js in a worker, WebGPU or WASM). The runtime is
 * injected so this file stays environment-agnostic; it handles the chat format, tool-call parsing, and a
 * grounding guard for small models.
 */

/** Messages in the Hugging Face chat-template format (Qwen, SmolLM, Phi…). */
export interface HFMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: { type: 'function'; function: { name: string; arguments: Record<string, unknown> } }[];
}

export interface LocalGenerateRequest {
  messages: HFMessage[];
  tools?: { type: 'function'; function: { name: string; description: string; parameters: unknown } }[];
  /** Text the reply is forced to start with (used to require a tool call). */
  prefill?: string;
  maxTokens: number;
}

export interface LocalRuntime {
  /** Model id, for display. */
  readonly model: string;
  generate(req: LocalGenerateRequest, onToken: (t: string) => void, signal?: AbortSignal): Promise<string>;
}

/**
 * Built-in models: small, permissively licensed (Apache-2.0), with native tool calling.
 *
 * Size ceiling (measured): Qwen3 1.7B (1.4 GB) is the smarter model and runs well under Node, but it fails to
 * load both in browsers (WebAssembly's 4 GB address space: "std::bad_alloc") and in Electron's main process
 * (V8 sandbox buffer limits: the process aborts). Larger local models are supported through Ollama / LM Studio.
 */
export const LOCAL_MODELS = [{ id: 'onnx-community/Qwen3-0.6B-ONNX', label: 'Qwen3 0.6B: light, best for direct calculations', sizeMB: 570, license: 'Apache-2.0', browser: true }] as const;

/** The built-in model for where the app is running (the same everywhere today; see the size ceiling above). */
export const defaultLocalModel = (_native: boolean): string => LOCAL_MODELS[0].id;

const TOOL_PREFILL = (name: string) => `<tool_call>\n{"name": "${name}", "arguments": {"query": "`;

let callSeq = 0;

/** Parses Qwen/Hermes-style `<tool_call>{json}</tool_call>` blocks; the rest is visible text. */
export function parseLocalReply(raw: string): { text: string; calls: ToolCallPart[] } {
  const calls: ToolCallPart[] = [];
  let text = raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\|im_end\|>|<\|endoftext\|>|<\/s>/g, '');
  text = text.replace(/<tool_call>\s*([\s\S]*?)\s*(?:<\/tool_call>|$)/g, (_m, body: string) => {
    const id = `local_${++callSeq}`;
    try {
      const j = JSON.parse(body) as { name?: string; arguments?: unknown };
      const args = typeof j.arguments === 'string' ? JSON.parse(j.arguments) : j.arguments;
      calls.push({ type: 'tool_call', id, name: String(j.name ?? ''), args: (args ?? {}) as Record<string, unknown> });
    } catch (e) {
      calls.push({ type: 'tool_call', id, name: 'compute', args: {}, argsError: `Malformed tool call: ${e instanceof Error ? e.message : e}` });
    }
    return '';
  });
  return { text: text.trim(), calls };
}

/** Converts the neutral history into the HF chat-template shape. Images are dropped (text-only models). */
export function toHFMessages(system: string | undefined, messages: ChatMessage[]): HFMessage[] {
  const out: HFMessage[] = system ? [{ role: 'system', content: system }] : [];
  for (const m of messages) {
    const parts = partsOf(m);
    if (m.role === 'assistant') {
      const calls = parts.filter((p): p is ToolCallPart => p.type === 'tool_call');
      out.push({
        role: 'assistant',
        content: textOf(m),
        ...(calls.length ? { tool_calls: calls.map((c) => ({ type: 'function' as const, function: { name: c.name, arguments: c.args } })) } : {}),
      });
      continue;
    }
    const results = parts.filter((p) => p.type === 'tool_result');
    for (const r of results) if (r.type === 'tool_result') out.push({ role: 'tool', content: r.content });
    const text = parts
      .filter((p) => p.type === 'text')
      .map((p) => (p.type === 'text' ? p.text : ''))
      .join('\n');
    const hadImage = parts.some((p) => p.type === 'image');
    if (text || hadImage) out.push({ role: 'user', content: text + (hadImage ? '\n[An image was attached, but this on-device model cannot see images.]' : '') });
  }
  return out;
}

/**
 * Small on-device models get a short prompt: long prompts are slow to prefill on consumer GPUs (and failed outright
 * past ~2k tokens in WebGPU testing), and small models follow brief, concrete rules better. The grounding rules
 * are kept in full: compute only through the tool, quote results, ask when unsure.
 */
export const LOCAL_SYSTEM_PROMPT = `You are Lemma's calculator assistant.
Rules:
- Never calculate in your head. For every number, call the compute tool and use its result exactly.
- Write one plain-English query per calculation, e.g. "18% of 64.50", "monthly payment on $20000 at 7% for 5 years", "derivative of x^2", "50 miles to km", "days until christmas", "mean of 3, 5, 7".
- Only call the graph tool when the user asks for a graph or plot.
- After the tool answers, reply in one or two short sentences with the result.
- If the question is unclear, ask a short question instead of guessing.`;

const LOCAL_TOOL_TEXT: Record<string, string> = {
  compute: 'Calculate anything with Lemma: arithmetic, percentages, units, dates, money and loans, statistics, algebra and calculus. Input: one plain-English query.',
  graph: 'Show an interactive graph, only when the user asks to graph or plot something. Input: the expressions to plot.',
};

const toHFTools = (tools: ToolSpec[] = []) =>
  tools.map((t) => ({ type: 'function' as const, function: { name: t.name, description: LOCAL_TOOL_TEXT[t.name] ?? t.description.slice(0, 300), parameters: t.parameters } }));

export class LocalProvider implements AIProvider {
  readonly id = 'local';
  constructor(
    private runtime: LocalRuntime,
    private opts: { maxTokens?: number } = {},
  ) {}

  get model(): string {
    return this.runtime.model;
  }

  async complete(req: ChatRequest, signal?: AbortSignal, onText?: (delta: string) => void): Promise<ChatResponse> {
    // The host's long system prompt is written for large hosted models; small local ones get the compact one.
    const messages = toHFMessages(LOCAL_SYSTEM_PROMPT, req.messages);
    const tools = toHFTools(req.tools);
    const maxTokens = req.maxTokens ?? this.opts.maxTokens ?? 1024;
    const last = req.messages[req.messages.length - 1];
    const startOfTurn = !!last && last.role === 'user' && !partsOf(last).some((p) => p.type === 'tool_result');

    // Stream visible text only once we know the reply isn't a tool call. At the start of a turn nothing is
    // streamed at all: the grounding guard below must be able to discard a reply that invents numbers.
    const compute = req.tools?.find((t) => t.name === 'compute');
    const guarded = !!compute && startOfTurn;
    let buffered = '';
    let streaming = false;
    const onToken = (t: string) => {
      buffered += t;
      if (!onText || guarded) return;
      if (streaming) return onText(t);
      const trimmed = buffered.trimStart();
      if (trimmed.length >= 12 && !trimmed.startsWith('<tool_call>') && !trimmed.startsWith('<think>')) {
        streaming = true;
        onText(buffered);
      }
    };
    let raw: string;
    try {
      raw = await this.runtime.generate({ messages, tools, maxTokens }, onToken, signal);
    } catch (e) {
      throw wrap(e);
    }
    let { text, calls } = parseLocalReply(raw);

    // Grounding guard: a small model that answers a fresh question with numbers but no tool call is
    // probably doing arithmetic itself. Ask again with the reply forced to start as a compute call.
    // A graph call for a question that never asked for a graph is a small model misfiring; treat it the same way.
    const askedForGraph = /\b(?:graph|plot|draw|sketch|visuali[sz]e|chart)\b/i.test(textOf(last!));
    const strayGraph = calls.length > 0 && calls.every((c) => c.name === 'graph') && !askedForGraph;
    if (guarded && compute && ((!calls.length && /\d/.test(text)) || strayGraph)) {
      try {
        const prefill = TOOL_PREFILL(compute.name);
        const forced = await this.runtime.generate({ messages, tools, maxTokens: 160, prefill }, () => {}, signal);
        const again = parseLocalReply(prefill + forced);
        if (again.calls.length && !again.calls[0]!.argsError) {
          text = '';
          calls = again.calls;
        }
      } catch (e) {
        throw wrap(e);
      }
    } else if (streaming && onText && !calls.length) {
      // Already streamed; nothing more to do.
    } else if (onText && text && !streaming) {
      onText(text);
    }

    const content: ContentPart[] = [...(text ? [{ type: 'text' as const, text }] : []), ...calls];
    return {
      message: { role: 'assistant', content },
      text,
      toolCalls: calls,
      stopReason: calls.length ? 'tool_calls' : 'end',
      model: this.runtime.model,
    };
  }
}

function wrap(e: unknown): AIError {
  if (e instanceof AIError) return e;
  if (e instanceof DOMException && e.name === 'AbortError') return new AIError('aborted', 'Stopped.');
  const msg = e instanceof Error ? e.message : String(e);
  return new AIError('server', `The on-device model failed: ${msg}`, { detail: msg });
}
