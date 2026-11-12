/**
 * Mocked fetch that replays realistic SSE streams for the Anthropic Messages API and
 * OpenAI-compatible chat completions, and records every request.
 */

export interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export type MockReply =
  | { kind: 'sse'; chunks: string[]; status?: number }
  | { kind: 'error'; status: number; body: string; headers?: Record<string, string> }
  | { kind: 'network' }
  /** Streams `chunks`, then never finishes until the request is aborted. */
  | { kind: 'hang'; chunks: string[] };

export interface MockFetch {
  fetch: typeof fetch;
  requests: RecordedRequest[];
}

export function mockFetch(replies: (MockReply | ((req: RecordedRequest, i: number) => MockReply))[]): MockFetch {
  const requests: RecordedRequest[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const req: RecordedRequest = { url: String(input), headers, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> };
    // Deep-copy so later mutation by the caller can't change what was "sent".
    requests.push(JSON.parse(JSON.stringify(req)) as RecordedRequest);
    const i = requests.length - 1;
    const r = replies[Math.min(i, replies.length - 1)];
    if (!r) throw new Error('no mock reply');
    const reply = typeof r === 'function' ? r(req, i) : r;
    const signal = init?.signal ?? undefined;
    if (signal?.aborted) throw abortErr();
    if (reply.kind === 'network') throw new TypeError('Failed to fetch');
    if (reply.kind === 'error') return new Response(reply.body, { status: reply.status, headers: reply.headers });
    return new Response(streamOf(reply.chunks, reply.kind === 'hang', signal), {
      status: reply.kind === 'sse' ? (reply.status ?? 200) : 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  return { fetch: fn as typeof fetch, requests };
}

function abortErr(): Error {
  const e = new Error('This operation was aborted');
  e.name = 'AbortError';
  return e;
}

function streamOf(chunks: string[], hang: boolean, signal?: AbortSignal): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(enc.encode(chunks[i++]!));
        return;
      }
      if (!hang) {
        controller.close();
        return;
      }
      return new Promise<void>((_, reject) => {
        const fail = () => {
          controller.error(abortErr());
          reject(abortErr());
        };
        if (signal?.aborted) fail();
        else signal?.addEventListener('abort', fail, { once: true });
      });
    },
  });
}

/** Splits a string into pieces of `n` characters, to exercise chunk boundaries mid-event. */
export function rechunk(s: string, n = 37): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out;
}

function ev(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export interface AnthropicTurn {
  text?: string;
  thinking?: { text: string; signature: string };
  toolUses?: { id: string; name: string; input: unknown }[];
  stop?: string;
  model?: string;
  /** Emit a `fallback` block after the first `n` blocks. */
  fallbackAfter?: number;
}

/** A realistic Messages API SSE stream for one assistant turn. */
export function anthropicSSE(turn: AnthropicTurn): string[] {
  const model = turn.model ?? 'claude-sonnet-5-5';
  let s = ev('message_start', {
    type: 'message_start',
    message: { id: 'msg_01Test', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 812, output_tokens: 1 } },
  });
  s += ev('ping', { type: 'ping' });
  let idx = 0;
  const blocks: string[] = [];
  if (turn.thinking) {
    let b = ev('content_block_start', { type: 'content_block_start', index: idx, content_block: { type: 'thinking', thinking: '', signature: '' } });
    if (turn.thinking.text) b += ev('content_block_delta', { type: 'content_block_delta', index: idx, delta: { type: 'thinking_delta', thinking: turn.thinking.text } });
    b += ev('content_block_delta', { type: 'content_block_delta', index: idx, delta: { type: 'signature_delta', signature: turn.thinking.signature } });
    b += ev('content_block_stop', { type: 'content_block_stop', index: idx });
    blocks.push(b);
    idx++;
  }
  if (turn.text) {
    let b = ev('content_block_start', { type: 'content_block_start', index: idx, content_block: { type: 'text', text: '' } });
    for (const piece of turn.text.match(/.{1,12}/gs) ?? []) b += ev('content_block_delta', { type: 'content_block_delta', index: idx, delta: { type: 'text_delta', text: piece } });
    b += ev('content_block_stop', { type: 'content_block_stop', index: idx });
    blocks.push(b);
    idx++;
  }
  for (const t of turn.toolUses ?? []) {
    let b = ev('content_block_start', { type: 'content_block_start', index: idx, content_block: { type: 'tool_use', id: t.id, name: t.name, input: {} } });
    const json = JSON.stringify(t.input);
    for (const piece of json.match(/.{1,7}/gs) ?? []) b += ev('content_block_delta', { type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: piece } });
    b += ev('content_block_stop', { type: 'content_block_stop', index: idx });
    blocks.push(b);
    idx++;
  }
  if (turn.fallbackAfter !== undefined) {
    // Re-index so the fallback marker sits at position n.
    const n = turn.fallbackAfter;
    const marker = ev('content_block_start', { type: 'content_block_start', index: 999, content_block: { type: 'fallback', from: { model }, to: { model: 'claude-opus-4-8' } } }) + ev('content_block_stop', { type: 'content_block_stop', index: 999 });
    blocks.splice(n, 0, marker);
    blocks.forEach((b, i) => (blocks[i] = b.replace(/"index":\d+/g, `"index":${i}`)));
  }
  s += blocks.join('');
  const stop = turn.stop ?? (turn.toolUses?.length ? 'tool_use' : 'end_turn');
  s += ev('message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 57 } });
  s += ev('message_stop', { type: 'message_stop' });
  return rechunk(s);
}

export interface OpenAITurn {
  text?: string;
  toolCalls?: { id: string; name: string; args: unknown }[];
  finish?: string;
  model?: string;
}

/** A realistic chat-completions SSE stream (OpenAI / OpenRouter / Ollama style). */
export function openaiSSE(turn: OpenAITurn): string[] {
  const model = turn.model ?? 'gpt-test';
  const base = { id: 'chatcmpl-1', object: 'chat.completion.chunk', created: 1761700000, model };
  const d = (delta: unknown, finish: string | null = null) => `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  let s = ': OPENROUTER PROCESSING\n\n';
  s += d({ role: 'assistant', content: '' });
  for (const piece of turn.text?.match(/.{1,10}/gs) ?? []) s += d({ content: piece });
  (turn.toolCalls ?? []).forEach((c, i) => {
    s += d({ tool_calls: [{ index: i, id: c.id, type: 'function', function: { name: c.name, arguments: '' } }] });
    for (const piece of JSON.stringify(c.args).match(/.{1,6}/gs) ?? []) s += d({ tool_calls: [{ index: i, function: { arguments: piece } }] });
  });
  s += d({}, turn.finish ?? (turn.toolCalls?.length ? 'tool_calls' : 'stop'));
  s += `data: ${JSON.stringify({ ...base, choices: [], usage: { prompt_tokens: 300, completion_tokens: 40, total_tokens: 340 } })}\n\n`;
  s += 'data: [DONE]\n\n';
  return rechunk(s.replace(/\n/g, '\r\n'), 41);
}

export const sse = (chunks: string[]): MockReply => ({ kind: 'sse', chunks });
