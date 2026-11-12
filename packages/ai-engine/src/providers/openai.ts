import { AIError, abortedError, isAbortError, streamError } from '../errors';
import { parseSSE } from '../sse';
import type { AIProvider, ChatMessage, ChatRequest, ChatResponse, ContentPart, StopReason, ToolCallPart, ToolSpec } from '../types';
import { partsOf } from '../types';
import { parseToolArgs, postJSON, type HttpContext } from './http';

/** Base URLs for common OpenAI-compatible servers. */
export const OPENAI_COMPATIBLE_PRESETS = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  ollama: 'http://localhost:11434/v1',
  lmstudio: 'http://localhost:1234/v1',
} as const;

export interface OpenAICompatibleOptions {
  /** e.g. https://api.openai.com/v1, http://localhost:11434/v1 — the path that `/chat/completions` is appended to. */
  baseUrl: string;
  /** Optional: local servers (Ollama, LM Studio) need none. */
  apiKey?: string;
  model: string;
  /** Sent as max_tokens only when set (local models often have small limits). */
  maxTokens?: number;
  /** Shown in error messages; derived from the base URL when omitted. */
  name?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  maxRetries?: number;
}

type WireContent = string | null | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];
export interface OpenAIWireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: WireContent;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

/** Converts neutral messages to chat-completions messages. Exported for tests and debugging. */
export function toOpenAIMessages(system: string | undefined, messages: ChatMessage[]): OpenAIWireMessage[] {
  const out: OpenAIWireMessage[] = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    const parts = partsOf(m);
    if (m.role === 'user') {
      for (const p of parts) if (p.type === 'tool_result') out.push({ role: 'tool', tool_call_id: p.callId, content: p.isError ? `ERROR: ${p.content}` : p.content });
      const rest = parts.filter((p) => p.type === 'text' || p.type === 'image');
      if (!rest.length) continue;
      if (rest.every((p) => p.type === 'text')) {
        out.push({ role: 'user', content: rest.map((p) => (p.type === 'text' ? p.text : '')).join('\n') });
      } else {
        out.push({
          role: 'user',
          content: rest.map((p) =>
            p.type === 'image' ? { type: 'image_url' as const, image_url: { url: `data:${p.mediaType};base64,${p.data}` } } : { type: 'text' as const, text: p.type === 'text' ? p.text : '' },
          ),
        });
      }
    } else {
      const text = parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
      const calls = parts.filter((p): p is ToolCallPart => p.type === 'tool_call');
      if (!text && !calls.length) continue;
      const msg: OpenAIWireMessage = { role: 'assistant', content: text || null };
      if (calls.length) msg.tool_calls = calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } }));
      out.push(msg);
    }
  }
  return out;
}

export function toOpenAITools(tools: ToolSpec[]): Record<string, unknown>[] {
  return tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

function mapStop(r: string | undefined, hasCalls: boolean): StopReason {
  if (r === 'length') return 'max_tokens';
  if (r === 'content_filter') return 'refusal';
  // Some local servers report "stop" even when the turn ends in tool calls.
  if (hasCalls) return 'tool_calls';
  if (r === 'stop' || r === 'end_turn') return 'end';
  return r === undefined ? 'end' : 'other';
}

function displayName(baseUrl: string): string {
  if (/openrouter\.ai/.test(baseUrl)) return 'OpenRouter';
  if (/api\.openai\.com/.test(baseUrl)) return 'OpenAI';
  if (/:11434\b/.test(baseUrl)) return 'Ollama';
  if (/:1234\b/.test(baseUrl)) return 'LM Studio';
  return 'The AI server';
}

function networkHint(baseUrl: string): string | undefined {
  if (/:11434\b/.test(baseUrl)) return 'Is Ollama running? For use from the app, start it with OLLAMA_ORIGINS set to allow this origin';
  if (/:1234\b/.test(baseUrl)) return 'Is the LM Studio server running with CORS enabled?';
  if (/localhost|127\.0\.0\.1/.test(baseUrl)) return 'Is the local server running, and does it allow requests from this app (CORS)?';
  return undefined;
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly id = 'openai-compatible';
  readonly model: string;
  private readonly baseUrl: string;
  private readonly ctx: HttpContext;

  constructor(private readonly opts: OpenAICompatibleOptions) {
    this.model = opts.model;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
    this.ctx = {
      provider: this.id,
      providerName: opts.name ?? displayName(this.baseUrl),
      model: this.model,
      baseUrl: this.baseUrl,
      networkHint: networkHint(this.baseUrl),
      fetch: opts.fetch,
      maxRetries: opts.maxRetries,
    };
  }

  buildBody(req: ChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = { model: this.model, stream: true, messages: toOpenAIMessages(req.system, req.messages) };
    if (req.tools?.length) body.tools = toOpenAITools(req.tools);
    const max = req.maxTokens ?? this.opts.maxTokens;
    if (max) body.max_tokens = max;
    return body;
  }

  async complete(req: ChatRequest, signal?: AbortSignal, onText?: (delta: string) => void): Promise<ChatResponse> {
    const headers: Record<string, string> = { ...this.opts.headers };
    if (this.opts.apiKey) headers.authorization = `Bearer ${this.opts.apiKey}`;
    const res = await postJSON(`${this.baseUrl}/chat/completions`, headers, this.buildBody(req), this.ctx, signal);

    let text = '';
    const calls: { id?: string; name: string; args: string }[] = [];
    let finish: string | undefined;
    let model: string | undefined;
    let usage: ChatResponse['usage'];
    let sawAny = false;
    try {
      for await (const ev of parseSSE(res.body!, signal)) {
        if (ev.data.trim() === '[DONE]') break;
        let d: Record<string, unknown>;
        try {
          d = JSON.parse(ev.data) as Record<string, unknown>;
        } catch {
          continue;
        }
        sawAny = true;
        if (d.error) {
          const err = d.error as { type?: string; code?: string | number; message?: string };
          throw streamError(err.type ?? (typeof err.code === 'string' ? err.code : undefined), err.message, this.ctx);
        }
        if (typeof d.model === 'string') model = d.model;
        const u = d.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined | null;
        if (u) usage = { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens };
        const choice = (d.choices as unknown[] | undefined)?.[0] as
          | { delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }
          | undefined;
        if (!choice) continue;
        const delta = choice.delta;
        if (delta?.content) {
          text += delta.content;
          onText?.(delta.content);
        }
        delta?.tool_calls?.forEach((tc, pos) => {
          const i = tc.index ?? pos;
          const c = (calls[i] ??= { name: '', args: '' });
          if (tc.id) c.id = tc.id;
          if (tc.function?.name) c.name += tc.function.name;
          if (tc.function?.arguments) c.args += tc.function.arguments;
        });
        if (choice.finish_reason) finish = choice.finish_reason;
      }
    } catch (e) {
      if (e instanceof AIError) throw e;
      if (isAbortError(e) || signal?.aborted) throw abortedError(this.id);
      throw new AIError('network', `The connection to ${this.ctx.providerName} dropped mid-answer. Try again.`, { provider: this.id, detail: String(e) });
    }
    if (signal?.aborted) throw abortedError(this.id);
    if (!sawAny) throw new AIError('bad_response', `${this.ctx.providerName} sent an empty or unreadable stream.`, { provider: this.id });

    const parts: ContentPart[] = [];
    if (text) parts.push({ type: 'text', text });
    const toolCalls: ToolCallPart[] = [];
    calls.forEach((c, i) => {
      if (!c || !c.name) return;
      const { args, error } = parseToolArgs(c.args);
      const call: ToolCallPart = { type: 'tool_call', id: c.id ?? `call_${Date.now().toString(36)}_${i}`, name: c.name, args };
      if (error) call.argsError = error;
      toolCalls.push(call);
      parts.push(call);
    });
    return {
      message: { role: 'assistant', content: parts },
      text,
      toolCalls,
      stopReason: mapStop(finish, toolCalls.length > 0),
      rawStopReason: finish,
      model,
      usage,
    };
  }
}
