import { AIError, abortedError, isAbortError, streamError } from '../errors';
import { parseSSE } from '../sse';
import type { AIProvider, ChatMessage, ChatRequest, ChatResponse, ContentPart, StopReason, ToolCallPart, ToolSpec } from '../types';
import { partsOf } from '../types';
import { parseToolArgs, postJSON, type HttpContext } from './http';

export const ANTHROPIC_MODELS = {
  /** Default: fast and capable for everyday tool use. */
  default: 'claude-sonnet-5-5',
  /** Cheapest and lowest latency. */
  fast: 'claude-haiku-5-5',
  /** Most capable Opus. */
  capable: 'claude-opus-5-5',
} as const;

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
export const ANTHROPIC_VERSION = '2026-10-21';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/** Models that accept `fallbacks: "default"` on the Claude API. */
const FALLBACK_MODELS = new Set(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1']);

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AnthropicOptions {
  apiKey: string;
  /** Defaults to claude-sonnet-5-5. */
  model?: string;
  /** Defaults to https://api.anthropic.com. A proxy URL also works (no trailing /v1). */
  baseUrl?: string;
  /** Default 16000. */
  maxTokens?: number;
  /** output_config.effort. Omitted = the model's default. `low` suits quick calculator chat. */
  effort?: Effort;
  /**
   * Server-side refusal fallback (`fallbacks: "default"`, beta header server-side-fallback-2026-07-01).
   * Default: on for models that support it when talking to api.anthropic.com directly; off for proxies.
   */
  fallbacks?: boolean;
  /** Stream tool arguments without server-side buffering. Default: on for api.anthropic.com, off for proxies. */
  eagerInputStreaming?: boolean;
  /** Extra headers (e.g. for a proxy). */
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  /** Automatic retries for 429/529/5xx. Default 2. */
  maxRetries?: number;
}

interface WireBlock {
  type: string;
  [k: string]: unknown;
}
interface WireMessage {
  role: 'user' | 'assistant';
  content: WireBlock[];
}

/** Converts neutral messages to Messages API messages. Exported for tests and debugging. */
export function toAnthropicMessages(messages: ChatMessage[]): WireMessage[] {
  const out: WireMessage[] = [];
  for (const m of messages) {
    const parts = partsOf(m);
    const blocks: WireBlock[] = [];
    if (m.role === 'user') {
      // tool_result blocks must come first in the user turn that answers a tool_use turn.
      for (const p of parts) if (p.type === 'tool_result') blocks.push(toolResultBlock(p.callId, p.content, p.isError));
      for (const p of parts) {
        if (p.type === 'text' && p.text) blocks.push({ type: 'text', text: p.text });
        else if (p.type === 'image') blocks.push({ type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.data } });
      }
    } else {
      for (const p of parts) {
        if (p.type === 'opaque' && p.provider === 'anthropic') blocks.push(p.raw as WireBlock);
        else if (p.type === 'text' && p.text) blocks.push({ type: 'text', text: p.text });
        else if (p.type === 'tool_call') blocks.push({ type: 'tool_use', id: p.id, name: p.name, input: p.args });
      }
    }
    if (blocks.length) out.push({ role: m.role, content: blocks });
  }
  return out;
}

function toolResultBlock(id: string, content: string, isError?: boolean): WireBlock {
  return isError ? { type: 'tool_result', tool_use_id: id, content, is_error: true } : { type: 'tool_result', tool_use_id: id, content };
}

export function toAnthropicTools(tools: ToolSpec[], eager: boolean): Record<string, unknown>[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
    ...(eager ? { eager_input_streaming: true } : {}),
  }));
}

function mapStop(r: string | undefined): StopReason {
  switch (r) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end';
    case 'tool_use':
      return 'tool_calls';
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'other';
  }
}

interface Building {
  type: string;
  text: string;
  json: string;
  thinking: string;
  signature: string;
  start: WireBlock;
}

export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic';
  readonly model: string;
  private readonly baseUrl: string;
  private readonly ctx: HttpContext;

  constructor(private readonly opts: AnthropicOptions) {
    this.model = opts.model ?? ANTHROPIC_MODELS.default;
    this.baseUrl = (opts.baseUrl ?? ANTHROPIC_BASE_URL).replace(/\/+$/, '').replace(/\/v1$/, '');
    this.ctx = {
      provider: this.id,
      providerName: 'Anthropic',
      model: this.model,
      baseUrl: this.baseUrl,
      fetch: opts.fetch,
      maxRetries: opts.maxRetries,
    };
  }

  private get direct(): boolean {
    return this.baseUrl === ANTHROPIC_BASE_URL;
  }

  /** The exact request body sent for a ChatRequest (exported for tests). */
  buildBody(req: ChatRequest): Record<string, unknown> {
    const eager = this.opts.eagerInputStreaming ?? this.direct;
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: req.maxTokens ?? this.opts.maxTokens ?? 16000,
      stream: true,
      messages: toAnthropicMessages(req.messages),
    };
    if (req.system) body.system = req.system;
    if (req.tools?.length) body.tools = toAnthropicTools(req.tools, eager);
    if (this.opts.effort) body.output_config = { effort: this.opts.effort };
    if (this.useFallbacks) body.fallbacks = 'default';
    return body;
  }

  private get useFallbacks(): boolean {
    // Opt-in: the beta header is rejected (400) for organisations without access, which would break every request.
    return this.opts.fallbacks ?? false;
  }

  buildHeaders(): Record<string, string> {
    const h: Record<string, string> = {
      'x-api-key': this.opts.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      // Required for calls made directly from a browser / Electron renderer (CORS opt-in).
      'anthropic-dangerous-direct-browser-access': 'true',
      ...this.opts.headers,
    };
    if (this.useFallbacks) h['anthropic-beta'] = FALLBACK_BETA;
    return h;
  }

  async complete(req: ChatRequest, signal?: AbortSignal, onText?: (delta: string) => void): Promise<ChatResponse> {
    const res = await postJSON(`${this.baseUrl}/v1/messages`, this.buildHeaders(), this.buildBody(req), this.ctx, signal);
    const blocks = new Map<number, Building>();
    let stopRaw: string | undefined;
    let model: string | undefined;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let sawStop = false;
    try {
      for await (const ev of parseSSE(res.body!, signal)) {
        let d: Record<string, unknown>;
        try {
          d = JSON.parse(ev.data) as Record<string, unknown>;
        } catch {
          continue;
        }
        const type = (d.type as string | undefined) ?? ev.event;
        switch (type) {
          case 'message_start': {
            const msg = d.message as { model?: string; usage?: { input_tokens?: number } } | undefined;
            model = msg?.model;
            inputTokens = msg?.usage?.input_tokens;
            break;
          }
          case 'content_block_start': {
            const cb = d.content_block as WireBlock;
            blocks.set(d.index as number, {
              type: cb.type,
              text: typeof cb.text === 'string' ? cb.text : '',
              json: '',
              thinking: typeof cb.thinking === 'string' ? cb.thinking : '',
              signature: typeof cb.signature === 'string' ? cb.signature : '',
              start: cb,
            });
            if (cb.type === 'text' && typeof cb.text === 'string' && cb.text) onText?.(cb.text);
            break;
          }
          case 'content_block_delta': {
            const b = blocks.get(d.index as number);
            const delta = d.delta as { type: string; text?: string; partial_json?: string; thinking?: string; signature?: string };
            if (!b) break;
            if (delta.type === 'text_delta' && delta.text) {
              b.text += delta.text;
              onText?.(delta.text);
            } else if (delta.type === 'input_json_delta') b.json += delta.partial_json ?? '';
            else if (delta.type === 'thinking_delta') b.thinking += delta.thinking ?? '';
            else if (delta.type === 'signature_delta') b.signature += delta.signature ?? '';
            break;
          }
          case 'message_delta': {
            const delta = d.delta as { stop_reason?: string } | undefined;
            if (delta?.stop_reason) stopRaw = delta.stop_reason;
            const usage = d.usage as { output_tokens?: number; input_tokens?: number } | undefined;
            if (usage?.output_tokens !== undefined) outputTokens = usage.output_tokens;
            if (usage?.input_tokens !== undefined) inputTokens = usage.input_tokens;
            break;
          }
          case 'message_stop':
            sawStop = true;
            break;
          case 'error': {
            const err = d.error as { type?: string; message?: string } | undefined;
            throw streamError(err?.type, err?.message, this.ctx);
          }
          default:
            break; // ping and future event types
        }
      }
    } catch (e) {
      if (e instanceof AIError) throw e;
      if (isAbortError(e) || signal?.aborted) throw abortedError(this.id);
      throw new AIError('network', 'The connection to Anthropic dropped mid-answer. Try again.', { provider: this.id, detail: String(e) });
    }
    if (signal?.aborted) throw abortedError(this.id);
    if (!sawStop && !stopRaw) throw new AIError('bad_response', 'The connection to Anthropic closed before the answer finished. Try again.', { provider: this.id });

    const ordered = [...blocks.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b);
    return this.finish(ordered, stopRaw, model, inputTokens, outputTokens);
  }

  private finish(ordered: Building[], stopRaw: string | undefined, model?: string, inputTokens?: number, outputTokens?: number): ChatResponse {
    // After a mid-output fallback, only text from before the last `fallback` marker is echoed back;
    // thinking and tool_use blocks the declined model produced are dropped (and never executed).
    const lastFallback = ordered.map((b) => b.type).lastIndexOf('fallback');
    const parts: ContentPart[] = [];
    ordered.forEach((b, i) => {
      const beforeFallback = i < lastFallback;
      if (b.type === 'text') {
        if (b.text) parts.push({ type: 'text', text: b.text });
      } else if (beforeFallback) {
        return;
      } else if (b.type === 'tool_use') {
        const { args, error } = parseToolArgs(b.json);
        const call: ToolCallPart = { type: 'tool_call', id: String(b.start.id), name: String(b.start.name), args };
        if (error) call.argsError = error;
        parts.push(call);
      } else if (b.type === 'thinking') {
        parts.push({ type: 'opaque', provider: 'anthropic', raw: { type: 'thinking', thinking: b.thinking, signature: b.signature } });
      } else if (b.type === 'redacted_thinking') {
        parts.push({ type: 'opaque', provider: 'anthropic', raw: b.start });
      }
      // `fallback` markers and unknown block types are not echoed.
    });
    const toolCalls = parts.filter((p): p is ToolCallPart => p.type === 'tool_call');
    const text = parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
    return {
      message: { role: 'assistant', content: parts },
      text,
      toolCalls,
      stopReason: mapStop(stopRaw),
      rawStopReason: stopRaw,
      model,
      usage: { inputTokens, outputTokens },
    };
  }
}
