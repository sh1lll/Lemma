import { describe, expect, it } from 'vitest';
import {
  AIError,
  AnthropicProvider,
  OpenAICompatibleProvider,
  LEMMA_TOOLS,
  parseSSE,
  toAnthropicMessages,
  toOpenAIMessages,
  type ChatMessage,
} from '../src';
import { anthropicSSE, mockFetch, openaiSSE, sse } from './helpers';

const history: ChatMessage[] = [
  {
    role: 'user',
    content: [
      { type: 'text', text: 'What is 20% of 450?' },
      { type: 'image', mediaType: 'image/png', data: 'iVBORw0KGgo=' },
    ],
  },
  {
    role: 'assistant',
    content: [
      { type: 'opaque', provider: 'anthropic', raw: { type: 'thinking', thinking: '', signature: 'sig-1' } },
      { type: 'text', text: 'Computing.' },
      { type: 'tool_call', id: 'toolu_1', name: 'compute', args: { query: '20% of 450' } },
    ],
  },
  {
    role: 'user',
    content: [{ type: 'tool_result', callId: 'toolu_1', name: 'compute', content: '{"ok":true,"display":"90"}' }],
  },
  { role: 'assistant', content: '20% of 450 is 90.' },
  { role: 'user', content: 'and 30%?' },
];

describe('message format conversion', () => {
  it('Anthropic: images, tool_use, tool_result first, opaque blocks passed through unchanged', () => {
    const wire = toAnthropicMessages(history);
    expect(wire).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is 20% of 450?' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '', signature: 'sig-1' },
          { type: 'text', text: 'Computing.' },
          { type: 'tool_use', id: 'toolu_1', name: 'compute', input: { query: '20% of 450' } },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"ok":true,"display":"90"}' }] },
      { role: 'assistant', content: [{ type: 'text', text: '20% of 450 is 90.' }] },
      { role: 'user', content: [{ type: 'text', text: 'and 30%?' }] },
    ]);
  });

  it('Anthropic: tool results precede text in the same user turn and errors are flagged', () => {
    const wire = toAnthropicMessages([
      { role: 'user', content: [{ type: 'text', text: 'note' }, { type: 'tool_result', callId: 't', content: 'bad', isError: true }] },
    ]);
    expect(wire[0]!.content).toEqual([
      { type: 'tool_result', tool_use_id: 't', content: 'bad', is_error: true },
      { type: 'text', text: 'note' },
    ]);
  });

  it('OpenAI: system first, image data URLs, tool_calls with string arguments, role "tool" results, opaque dropped', () => {
    const wire = toOpenAIMessages('SYS', history);
    expect(wire).toEqual([
      { role: 'system', content: 'SYS' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is 20% of 450?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
        ],
      },
      {
        role: 'assistant',
        content: 'Computing.',
        tool_calls: [{ id: 'toolu_1', type: 'function', function: { name: 'compute', arguments: '{"query":"20% of 450"}' } }],
      },
      { role: 'tool', tool_call_id: 'toolu_1', content: '{"ok":true,"display":"90"}' },
      { role: 'assistant', content: '20% of 450 is 90.' },
      { role: 'user', content: 'and 30%?' },
    ]);
  });

  it('OpenAI: an assistant turn with only tool calls has null content', () => {
    const wire = toOpenAIMessages(undefined, [{ role: 'assistant', content: [{ type: 'tool_call', id: 'c', name: 'graph', args: { expressions: ['x^2'] } }] }]);
    expect(wire[0]).toMatchObject({ role: 'assistant', content: null });
  });
});

describe('SSE parsing', () => {
  it('handles CRLF, comments, multi-line data and events split across chunks', async () => {
    const chunks = [': keep-alive\r\n\r\nevent: a\r\nda', 'ta: {"x":1}\r', '\n\r\ndata: line1\ndata: line2\n\n', 'data: tail'];
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    });
    const out = [];
    for await (const e of parseSSE(body)) out.push(e);
    expect(out).toEqual([{ event: 'a', data: '{"x":1}' }, { event: undefined, data: 'line1\nline2' }, { event: undefined, data: 'tail' }]);
  });
});

describe('AnthropicProvider', () => {
  it('sends the right headers and body, and streams text', async () => {
    const m = mockFetch([sse(anthropicSSE({ text: 'The answer is 90, computed by Lemma.' }))]);
    const p = new AnthropicProvider({ apiKey: 'sk-ant-test', fetch: m.fetch });
    const deltas: string[] = [];
    const r = await p.complete({ system: 'SYS', messages: [{ role: 'user', content: 'hi' }], tools: LEMMA_TOOLS }, undefined, (d) => deltas.push(d));

    expect(r.text).toBe('The answer is 90, computed by Lemma.');
    expect(deltas.join('')).toBe(r.text);
    expect(deltas.length).toBeGreaterThan(1);
    expect(r.stopReason).toBe('end');
    expect(r.model).toBe('claude-sonnet-5-5');
    expect(r.usage).toEqual({ inputTokens: 812, outputTokens: 57 });

    const req = m.requests[0]!;
    expect(req.url).toBe('https://api.anthropic.com/v1/messages');
    expect(req.headers['x-api-key']).toBe('sk-ant-test');
    expect(req.headers['anthropic-version']).toBe('2026-10-21');
    expect(req.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    // Server-side fallback is opt-in (its beta header is rejected for organisations without access).
    expect(req.headers['anthropic-beta']).toBeUndefined();
    expect(req.body).toMatchObject({ model: 'claude-sonnet-5-5', stream: true, system: 'SYS', max_tokens: 16000 });
    expect(req.body).not.toHaveProperty('fallbacks');
    expect(req.body).not.toHaveProperty('temperature');
    const tools = req.body.tools as { name: string; input_schema: unknown; eager_input_streaming?: boolean }[];
    expect(tools.map((t) => t.name)).toEqual(['compute', 'graph']);
    expect(tools[0]!.input_schema).toEqual(LEMMA_TOOLS[0]!.parameters);
    expect(tools[0]!.eager_input_streaming).toBe(true);
  });

  it('through a proxy: no fallbacks beta, no eager streaming; effort is passed through', async () => {
    const m = mockFetch([sse(anthropicSSE({ text: 'ok' }))]);
    const p = new AnthropicProvider({ apiKey: 'k', model: 'claude-haiku-5-5', baseUrl: 'https://proxy.example.com/v1/', effort: 'low', fetch: m.fetch });
    await p.complete({ messages: [{ role: 'user', content: 'hi' }], tools: LEMMA_TOOLS });
    const req = m.requests[0]!;
    expect(req.url).toBe('https://proxy.example.com/v1/messages');
    expect(req.headers['anthropic-beta']).toBeUndefined();
    expect(req.body).not.toHaveProperty('fallbacks');
    expect(req.body.output_config).toEqual({ effort: 'low' });
    expect((req.body.tools as Record<string, unknown>[])[0]).not.toHaveProperty('eager_input_streaming');
  });

  it('assembles tool_use input from input_json_delta fragments and keeps thinking blocks with their signature', async () => {
    const m = mockFetch([
      sse(
        anthropicSSE({
          thinking: { text: '', signature: 'EqQBCkYIBxgCKkB' },
          text: 'Let me compute that.',
          toolUses: [
            { id: 'toolu_01A', name: 'compute', input: { query: 'monthly payment on a $300,000 loan at 4.5% over 30 years' } },
            { id: 'toolu_01B', name: 'graph', input: { expressions: ['x^2 - 4', 'sin(x)'] } },
          ],
        }),
      ),
    ]);
    const p = new AnthropicProvider({ apiKey: 'k', fetch: m.fetch });
    const r = await p.complete({ messages: [{ role: 'user', content: 'q' }] });
    expect(r.stopReason).toBe('tool_calls');
    expect(r.toolCalls).toEqual([
      { type: 'tool_call', id: 'toolu_01A', name: 'compute', args: { query: 'monthly payment on a $300,000 loan at 4.5% over 30 years' } },
      { type: 'tool_call', id: 'toolu_01B', name: 'graph', args: { expressions: ['x^2 - 4', 'sin(x)'] } },
    ]);
    expect(r.message.content[0]).toEqual({ type: 'opaque', provider: 'anthropic', raw: { type: 'thinking', thinking: '', signature: 'EqQBCkYIBxgCKkB' } });
  });

  it('after a mid-output fallback, drops the declined model\'s tool calls and keeps its text', async () => {
    const m = mockFetch([
      sse(
        anthropicSSE({
          text: 'Partial ',
          toolUses: [{ id: 'toolu_x', name: 'compute', input: { query: '1+1' } }],
          fallbackAfter: 2,
        }),
      ),
    ]);
    const p = new AnthropicProvider({ apiKey: 'k', fetch: m.fetch });
    const r = await p.complete({ messages: [{ role: 'user', content: 'q' }] });
    expect(r.toolCalls).toEqual([]);
    expect(r.text).toBe('Partial ');
  });

  it('flags tool input that is not valid JSON instead of guessing', async () => {
    const chunks = anthropicSSE({ toolUses: [{ id: 't', name: 'compute', input: { query: 'x' } }] }).join('').replace('"partial_json":"{\\"query', '"partial_json":"{query');
    const m = mockFetch([sse([chunks])]);
    const r = await new AnthropicProvider({ apiKey: 'k', fetch: m.fetch }).complete({ messages: [{ role: 'user', content: 'q' }] });
    expect(r.toolCalls[0]!.argsError).toMatch(/not valid JSON/);
  });

  it('maps a refusal stop reason', async () => {
    const m = mockFetch([sse(anthropicSSE({ text: '', stop: 'refusal' }))]);
    const r = await new AnthropicProvider({ apiKey: 'k', fetch: m.fetch }).complete({ messages: [{ role: 'user', content: 'q' }] });
    expect(r.stopReason).toBe('refusal');
  });
});

describe('error mapping', () => {
  const anth = (reply: Parameters<typeof mockFetch>[0][number], maxRetries = 0) => {
    const m = mockFetch([reply]);
    return { m, p: new AnthropicProvider({ apiKey: 'bad', fetch: m.fetch, maxRetries }) };
  };
  const call = (p: { complete: AnthropicProvider['complete'] }) => p.complete({ messages: [{ role: 'user', content: 'q' }] });

  it('401 → invalid key', async () => {
    const { p } = anth({ kind: 'error', status: 401, body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }) });
    const e = (await call(p).catch((x) => x)) as AIError;
    expect(e).toBeInstanceOf(AIError);
    expect(e.code).toBe('auth');
    expect(e.message).toMatch(/rejected the API key/);
    expect(e.detail).toBe('invalid x-api-key');
    expect(e.status).toBe(401);
  });

  it('429 → rate limit with retry-after', async () => {
    const { p } = anth({ kind: 'error', status: 429, body: JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'Number of requests has exceeded your rate limit' } }), headers: { 'retry-after': '12' } });
    const e = (await call(p).catch((x) => x)) as AIError;
    expect(e.code).toBe('rate_limit');
    expect(e.retryAfterSeconds).toBe(12);
    expect(e.message).toMatch(/in 12 s/);
  });

  it('retries 429 then succeeds', async () => {
    const m = mockFetch([{ kind: 'error', status: 429, body: '{}', headers: { 'retry-after': '0' } }, sse(anthropicSSE({ text: 'fine' }))]);
    const r = await new AnthropicProvider({ apiKey: 'k', fetch: m.fetch, maxRetries: 1 }).complete({ messages: [{ role: 'user', content: 'q' }] });
    expect(r.text).toBe('fine');
    expect(m.requests).toHaveLength(2);
  });

  it('529 → overloaded; 404 → model not found; 500 → server', async () => {
    const e1 = (await call(anth({ kind: 'error', status: 529, body: JSON.stringify({ error: { type: 'overloaded_error', message: 'Overloaded' } }) }).p).catch((x) => x)) as AIError;
    expect(e1.code).toBe('overloaded');
    const e2 = (await call(anth({ kind: 'error', status: 404, body: JSON.stringify({ error: { type: 'not_found_error', message: 'model: claude-nope' } }) }).p).catch((x) => x)) as AIError;
    expect(e2.code).toBe('model_not_found');
    expect(e2.message).toContain('claude-sonnet-5-5');
    const e3 = (await call(anth({ kind: 'error', status: 500, body: '<html>oops</html>' }).p).catch((x) => x)) as AIError;
    expect(e3.code).toBe('server');
  });

  it('network failure / CORS → network', async () => {
    const e = (await call(anth({ kind: 'network' }).p).catch((x) => x)) as AIError;
    expect(e.code).toBe('network');
    expect(e.message).toMatch(/Couldn't reach Anthropic at api\.anthropic\.com/);
  });

  it('error event inside the stream → overloaded', async () => {
    const s = 'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-sonnet-5-5","usage":{"input_tokens":1}}}\n\nevent: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n';
    const e = (await call(anth(sse([s])).p).catch((x) => x)) as AIError;
    expect(e.code).toBe('overloaded');
  });

  it('OpenAI-compatible: 401, 429, 404 model, network with Ollama hint, in-stream error', async () => {
    const mk = (reply: Parameters<typeof mockFetch>[0][number], baseUrl = 'https://api.openai.com/v1') =>
      new OpenAICompatibleProvider({ baseUrl, model: 'gpt-test', apiKey: 'k', fetch: mockFetch([reply]).fetch, maxRetries: 0 }).complete({ messages: [{ role: "user", content: "q" }] }).then(() => { throw new Error("expected failure"); }, (x: unknown) => x as AIError);
    expect((await mk({ kind: 'error', status: 401, body: JSON.stringify({ error: { message: 'Incorrect API key provided', type: 'invalid_request_error', code: 'invalid_api_key' } }) })).code).toBe('auth');
    expect((await mk({ kind: 'error', status: 429, body: JSON.stringify({ error: { message: 'Rate limit reached', type: 'requests' } }) })).code).toBe('rate_limit');
    const nf = await mk({ kind: 'error', status: 404, body: JSON.stringify({ error: { message: 'model "llama9" not found, try pulling it first' } }) }, 'http://localhost:11434/v1');
    expect(nf.code).toBe('model_not_found');
    expect(nf.message).toMatch(/base URL/);
    const net = await mk({ kind: 'network' }, 'http://localhost:11434/v1');
    expect(net.code).toBe('network');
    expect(net.message).toMatch(/Ollama/);
    const mid = await mk(sse([`data: ${JSON.stringify({ error: { message: 'Provider overloaded', code: 'overloaded_error' } })}\n\n`]));
    expect(mid.code).toBe('overloaded');
  });
});

describe('OpenAICompatibleProvider', () => {
  it('streams text and sends a chat-completions body (no auth header without a key)', async () => {
    const m = mockFetch([sse(openaiSSE({ text: 'Twenty percent of 450 is 90.' }))]);
    const p = new OpenAICompatibleProvider({ baseUrl: 'http://localhost:11434/v1/', model: 'qwen3', fetch: m.fetch });
    const deltas: string[] = [];
    const r = await p.complete({ system: 'SYS', messages: [{ role: 'user', content: 'hi' }], tools: LEMMA_TOOLS }, undefined, (d) => deltas.push(d));
    expect(r.text).toBe('Twenty percent of 450 is 90.');
    expect(deltas.join('')).toBe(r.text);
    expect(r.stopReason).toBe('end');
    expect(r.usage).toEqual({ inputTokens: 300, outputTokens: 40 });
    const req = m.requests[0]!;
    expect(req.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(req.headers.authorization).toBeUndefined();
    expect(req.body).toMatchObject({ model: 'qwen3', stream: true, messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'hi' }] });
    expect(req.body).not.toHaveProperty('max_tokens');
    expect((req.body.tools as unknown[])[0]).toEqual({ type: 'function', function: { name: 'compute', description: LEMMA_TOOLS[0]!.description, parameters: LEMMA_TOOLS[0]!.parameters } });
  });

  it('assembles streamed tool_calls fragments', async () => {
    const m = mockFetch([
      sse(
        openaiSSE({
          toolCalls: [
            { id: 'call_a', name: 'compute', args: { query: '50 miles to km' } },
            { id: 'call_b', name: 'compute', args: { query: 'mean of 3, 5, 7, 10' } },
          ],
        }),
      ),
    ]);
    const p = new OpenAICompatibleProvider({ baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'or-key', model: 'm', fetch: m.fetch });
    const r = await p.complete({ messages: [{ role: 'user', content: 'q' }] });
    expect(m.requests[0]!.headers.authorization).toBe('Bearer or-key');
    expect(r.stopReason).toBe('tool_calls');
    expect(r.toolCalls).toEqual([
      { type: 'tool_call', id: 'call_a', name: 'compute', args: { query: '50 miles to km' } },
      { type: 'tool_call', id: 'call_b', name: 'compute', args: { query: 'mean of 3, 5, 7, 10' } },
    ]);
  });

  it('treats tool calls with finish_reason "stop" (some local servers) as tool calls; length → max_tokens', async () => {
    const m = mockFetch([sse(openaiSSE({ toolCalls: [{ id: 'c', name: 'compute', args: { query: '1+1' } }], finish: 'stop' })), sse(openaiSSE({ text: 'cut', finish: 'length' }))]);
    const p = new OpenAICompatibleProvider({ baseUrl: 'http://localhost:1234/v1', model: 'm', fetch: m.fetch });
    expect((await p.complete({ messages: [{ role: 'user', content: 'q' }] })).stopReason).toBe('tool_calls');
    expect((await p.complete({ messages: [{ role: 'user', content: 'q' }] })).stopReason).toBe('max_tokens');
  });
});
