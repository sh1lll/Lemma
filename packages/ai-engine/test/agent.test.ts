import { describe, expect, it, vi } from 'vitest';
import {
  AIError,
  AnthropicProvider,
  GROUNDING_RULES,
  MAX_STEPS_MESSAGE,
  MAX_TOOL_CALLS_PER_STEP,
  OpenAICompatibleProvider,
  runAssistant,
  type ToolExecutor,
  type ToolResult,
} from '../src';
import { anthropicSSE, mockFetch, openaiSSE, sse } from './helpers';

const RESULT_90: ToolResult = { ok: true, kind: 'calc', display: '90', plain: '90', expression: '20% of 450', notes: [], exactness: 'exact' };

const executor = (results: Record<string, ToolResult>): ToolExecutor & { calls: [string, Record<string, unknown>][] } => {
  const calls: [string, Record<string, unknown>][] = [];
  const fn = (async (name: string, args: Record<string, unknown>) => {
    calls.push([name, args]);
    const q = String(args.query ?? '');
    return results[q] ?? { ok: false, display: '', plain: '', expression: q, notes: [], error: 'unknown' };
  }) as ToolExecutor & { calls: typeof calls };
  fn.calls = calls;
  return fn;
};

describe('runAssistant (Anthropic)', () => {
  it('executes tools, feeds results back, and records a transcript', async () => {
    const m = mockFetch([
      sse(anthropicSSE({ thinking: { text: '', signature: 'sig-A' }, text: 'Let me compute.', toolUses: [{ id: 'toolu_1', name: 'compute', input: { query: '20% of 450' } }] })),
      sse(anthropicSSE({ text: '20% of 450 is 90.' })),
    ]);
    const provider = new AnthropicProvider({ apiKey: 'k', fetch: m.fetch });
    const tools = executor({ '20% of 450': RESULT_90 });
    const onToolCall = vi.fn();
    const onToolResult = vi.fn();
    let streamed = '';

    const r = await runAssistant({
      provider,
      tools,
      level: 'concise',
      messages: [{ role: 'user', content: 'What is 20% of 450?' }],
      onText: (d) => (streamed += d),
      onToolCall,
      onToolResult,
    });

    expect(r.text).toBe('20% of 450 is 90.');
    expect(r.status).toBe('done');
    expect(r.steps).toBe(2);
    expect(streamed).toBe('Let me compute.20% of 450 is 90.');
    expect(tools.calls).toEqual([['compute', { query: '20% of 450' }]]);
    expect(onToolCall).toHaveBeenCalledWith({ id: 'toolu_1', name: 'compute', args: { query: '20% of 450' }, step: 1 });
    expect(onToolResult).toHaveBeenCalledTimes(1);
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]).toMatchObject({ id: 'toolu_1', name: 'compute', result: RESULT_90, step: 1 });

    // Second request: the assistant tool_use turn (thinking block echoed unchanged) + the tool_result.
    const second = m.requests[1]!.body.messages as { role: string; content: Record<string, unknown>[] }[];
    expect(second).toHaveLength(3);
    expect(second[1]!.content[0]).toEqual({ type: 'thinking', thinking: '', signature: 'sig-A' });
    expect(second[1]!.content[2]).toEqual({ type: 'tool_use', id: 'toolu_1', name: 'compute', input: { query: '20% of 450' } });
    expect(second[2]!.content).toEqual([{ type: 'tool_result', tool_use_id: 'toolu_1', content: JSON.stringify(RESULT_90) }]);
    expect(m.requests[1]!.body.system).toBe(m.requests[0]!.body.system);
    expect(String(m.requests[0]!.body.system)).toContain(GROUNDING_RULES);

    // Stored history keeps tool calls/results but drops provider reasoning blocks.
    expect(r.messages).toHaveLength(4);
    expect(JSON.stringify(r.messages)).not.toContain('sig-A');
    expect(r.newMessages).toHaveLength(4);
    expect(r.usage).toEqual({ inputTokens: 1624, outputTokens: 114 });
  });

  it('continues a conversation: earlier tool results are sent as context', async () => {
    const m = mockFetch([
      sse(anthropicSSE({ toolUses: [{ id: 'toolu_1', name: 'compute', input: { query: '20% of 450' } }] })),
      sse(anthropicSSE({ text: '90.' })),
      sse(anthropicSSE({ text: 'That was 20% of 450, which Lemma computed as 90.' })),
    ]);
    const provider = new AnthropicProvider({ apiKey: 'k', fetch: m.fetch });
    const tools = executor({ '20% of 450': RESULT_90 });
    const first = await runAssistant({ provider, tools, messages: [{ role: 'user', content: 'What is 20% of 450?' }] });
    const second = await runAssistant({
      provider,
      tools,
      level: 'beginner',
      messages: [...first.messages, { role: 'user', content: 'What did you calculate before?' }],
      context: [{ input: '15% off 80', result: { ok: true, display: '68', plain: '68', expression: '80 − 15% of 80', notes: [] } }],
    });
    expect(second.newMessages).toHaveLength(2);
    const sent = m.requests[2]!.body.messages as { role: string; content: Record<string, unknown>[] }[];
    expect(sent.map((x) => x.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(sent[2]!.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1' });
    const last = sent[4]!.content;
    expect(last[0]).toEqual({ type: 'text', text: 'What did you calculate before?' });
    expect(String(last[1]!.text)).toContain('"15% off 80"');
    expect(String(last[1]!.text)).toContain('"display":"68"');
    expect(String(m.requests[2]!.body.system)).toMatch(/Style: beginner/);
  });

  it('enforces maxSteps with a clear message and a valid history', async () => {
    const m = mockFetch([(_req, i) => sse(anthropicSSE({ toolUses: [{ id: `toolu_${i}`, name: 'compute', input: { query: '20% of 450' } }] }))]);
    const provider = new AnthropicProvider({ apiKey: 'k', fetch: m.fetch });
    const r = await runAssistant({ provider, tools: executor({ '20% of 450': RESULT_90 }), messages: [{ role: 'user', content: 'loop' }], maxSteps: 3 });
    expect(m.requests).toHaveLength(3);
    expect(r.status).toBe('max_steps');
    expect(r.text).toBe(MAX_STEPS_MESSAGE);
    expect(r.toolCalls).toHaveLength(3);
    expect(r.messages.at(-1)).toEqual({ role: 'assistant', content: [{ type: 'text', text: MAX_STEPS_MESSAGE }] });
  });

  it('aborts mid-stream', async () => {
    const m = mockFetch([{ kind: 'hang', chunks: anthropicSSE({ text: 'Thinking about it' }).slice(0, 3) }]);
    const provider = new AnthropicProvider({ apiKey: 'k', fetch: m.fetch });
    const ac = new AbortController();
    const p = runAssistant({ provider, tools: executor({}), messages: [{ role: 'user', content: 'q' }], signal: ac.signal });
    setTimeout(() => ac.abort(), 10);
    const e = (await p.catch((x) => x)) as AIError;
    expect(e).toBeInstanceOf(AIError);
    expect(e.code).toBe('aborted');
  });

  it('aborts during tool execution and does not call the model again', async () => {
    const m = mockFetch([sse(anthropicSSE({ toolUses: [{ id: 't', name: 'compute', input: { query: 'slow' } }] })), sse(anthropicSSE({ text: 'never' }))]);
    const provider = new AnthropicProvider({ apiKey: 'k', fetch: m.fetch });
    const ac = new AbortController();
    const tools: ToolExecutor = async () => {
      ac.abort();
      return RESULT_90;
    };
    const e = (await runAssistant({ provider, tools, messages: [{ role: 'user', content: 'q' }], signal: ac.signal }).catch((x) => x)) as AIError;
    expect(e.code).toBe('aborted');
    expect(m.requests).toHaveLength(1);
  });

  it('an already-aborted signal makes no request', async () => {
    const m = mockFetch([sse(anthropicSSE({ text: 'x' }))]);
    const ac = new AbortController();
    ac.abort();
    const e = (await runAssistant({ provider: new AnthropicProvider({ apiKey: 'k', fetch: m.fetch }), tools: executor({}), messages: [{ role: 'user', content: 'q' }], signal: ac.signal }).catch((x) => x)) as AIError;
    expect(e.code).toBe('aborted');
    expect(m.requests).toHaveLength(0);
  });

  it('never executes invalid or unknown tool calls, and survives executor exceptions', async () => {
    const m = mockFetch([
      sse(
        anthropicSSE({
          toolUses: [
            { id: 'a', name: 'compute', input: { q: 'wrong field' } },
            { id: 'b', name: 'calculator', input: { query: '1+1' } },
            { id: 'c', name: 'compute', input: { query: 'boom' } },
          ],
        }),
      ),
      sse(anthropicSSE({ text: 'Sorry.' })),
    ]);
    const calls: string[] = [];
    const tools: ToolExecutor = async (_n, args) => {
      calls.push(String(args.query));
      throw new Error('engine crashed');
    };
    const r = await runAssistant({ provider: new AnthropicProvider({ apiKey: 'k', fetch: m.fetch }), tools, messages: [{ role: 'user', content: 'q' }] });
    expect(calls).toEqual(['boom']);
    expect(r.toolCalls.map((t) => t.result.ok)).toEqual([false, false, false]);
    expect(r.toolCalls[0]!.result.error).toMatch(/non-empty string "query"/);
    expect(r.toolCalls[1]!.result.error).toMatch(/Unknown tool/);
    expect(r.toolCalls[2]!.result.error).toBe('engine crashed');
    const results = (m.requests[1]!.body.messages as { content: Record<string, unknown>[] }[])[2]!.content;
    expect(results.every((b) => b.type === 'tool_result' && b.is_error === true)).toBe(true);
  });

  it('does not run tools on a refusal', async () => {
    const m = mockFetch([sse(anthropicSSE({ toolUses: [{ id: 't', name: 'compute', input: { query: '1+1' } }], stop: 'refusal' }))]);
    const tools = executor({});
    const r = await runAssistant({ provider: new AnthropicProvider({ apiKey: 'k', fetch: m.fetch }), tools, messages: [{ role: 'user', content: 'q' }] });
    expect(r.status).toBe('refusal');
    expect(tools.calls).toEqual([]);
    expect(JSON.stringify(r.messages)).not.toContain('tool_call');
  });

  it('propagates provider errors (e.g. invalid key)', async () => {
    const m = mockFetch([{ kind: 'error', status: 401, body: '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}' }]);
    const e = (await runAssistant({ provider: new AnthropicProvider({ apiKey: 'k', fetch: m.fetch }), tools: executor({}), messages: [{ role: 'user', content: 'q' }] }).catch((x) => x)) as AIError;
    expect(e.code).toBe('auth');
  });
});

describe('runAssistant (OpenAI-compatible)', () => {
  it('runs parallel tool calls and sends results as role "tool" messages', async () => {
    const m = mockFetch([
      sse(
        openaiSSE({
          toolCalls: [
            { id: 'call_1', name: 'compute', args: { query: '50 miles to km' } },
            { id: 'call_2', name: 'graph', args: { expressions: ['x^2 - 4'] } },
          ],
        }),
      ),
      sse(openaiSSE({ text: '50 miles is 80.4672 km. The graph is shown.' })),
    ]);
    const provider = new OpenAICompatibleProvider({ baseUrl: 'http://localhost:11434/v1', model: 'qwen3', fetch: m.fetch });
    const tools: ToolExecutor = async (name, args) =>
      name === 'graph'
        ? { ok: true, kind: 'graph', display: 'Graph shown to the user.', plain: '', expression: (args.expressions as string[]).join(', '), notes: [] }
        : { ok: true, kind: 'convert', display: '80.4672 km', plain: '80.4672 km', expression: '50 mi → km', notes: [], exactness: 'exact' };
    const r = await runAssistant({ provider, tools, messages: [{ role: 'user', content: '50 miles in km, and graph x^2-4' }], level: 'answer-only' });
    expect(r.text).toBe('50 miles is 80.4672 km. The graph is shown.');
    expect(r.toolCalls.map((t) => t.name)).toEqual(['compute', 'graph']);
    const sent = m.requests[1]!.body.messages as { role: string; tool_call_id?: string; content: string | null; tool_calls?: unknown[] }[];
    expect(sent.map((x) => x.role)).toEqual(['system', 'user', 'assistant', 'tool', 'tool']);
    expect(sent[2]!.tool_calls).toHaveLength(2);
    expect(sent[3]).toMatchObject({ tool_call_id: 'call_1' });
    expect(JSON.parse(sent[3]!.content!)).toMatchObject({ display: '80.4672 km' });
    expect(sent[0]!.content).toMatch(/Style: answer only/);
  });
});

describe('runAssistant limits', () => {
  it('executes at most MAX_TOOL_CALLS_PER_STEP calls per model turn, and answers every call id', async () => {
    const calls = Array.from({ length: 500 }, (_, i) => ({ type: 'tool_call' as const, id: `c${i}`, name: 'compute', args: { query: `${i} + 1` } }));
    let turn = 0;
    const provider = {
      id: 'scripted',
      model: 'm',
      complete: async () =>
        turn++ === 0
          ? { message: { role: 'assistant' as const, content: calls }, text: '', toolCalls: calls, stopReason: 'tool_calls' as const }
          : { message: { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'done' }] }, text: 'done', toolCalls: [], stopReason: 'end' as const },
    };
    const tools = vi.fn(async () => ({ ok: true, display: '1', plain: '1', expression: '', notes: [] }));
    const r = await runAssistant({ provider, tools, messages: [{ role: 'user', content: 'go' }] });
    expect(tools).toHaveBeenCalledTimes(MAX_TOOL_CALLS_PER_STEP);
    const results = r.messages.flatMap((m) => (typeof m.content === 'string' ? [] : m.content)).filter((p) => p.type === 'tool_result');
    expect(results).toHaveLength(500);
    expect(results.filter((p) => p.type === 'tool_result' && p.isError)).toHaveLength(500 - MAX_TOOL_CALLS_PER_STEP);
  });
});
