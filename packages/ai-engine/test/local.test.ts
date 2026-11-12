import { describe, expect, it } from 'vitest';
import { LocalProvider, listModels, parseLocalReply, presetById, toHFMessages, type LocalRuntime } from '../src';
import { LEMMA_TOOLS } from '../src/tools';

/** A scripted on-device runtime. */
function runtime(replies: ((prefill?: string) => string)[]): LocalRuntime & { calls: { prefill?: string }[] } {
  const calls: { prefill?: string }[] = [];
  return {
    model: 'test/tiny',
    calls,
    async generate(req, onToken) {
      calls.push({ prefill: req.prefill });
      const text = replies[calls.length - 1]!(req.prefill);
      for (const ch of text.match(/.{1,4}/gs) ?? []) onToken(ch);
      return text;
    },
  };
}

describe('local provider', () => {
  it('parses Qwen/Hermes tool calls and strips thinking', () => {
    const r = parseLocalReply('<think>hmm</think><tool_call>\n{"name": "compute", "arguments": {"query": "18% of 64.50"}}\n</tool_call><|im_end|>');
    expect(r.text).toBe('');
    expect(r.calls).toMatchObject([{ name: 'compute', args: { query: '18% of 64.50' } }]);
    expect(parseLocalReply('<tool_call>{bad json</tool_call>').calls[0]!.argsError).toMatch(/Malformed/);
  });

  it('converts history including tool calls and results', () => {
    const hf = toHFMessages('SYS', [
      { role: 'user', content: 'tip?' },
      { role: 'assistant', content: [{ type: 'tool_call', id: 'a', name: 'compute', args: { query: 'q' } }] },
      { role: 'user', content: [{ type: 'tool_result', callId: 'a', content: '{"display":"11.61"}' }] },
    ]);
    expect(hf.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(hf[2]!.tool_calls![0]!.function).toEqual({ name: 'compute', arguments: { query: 'q' } });
  });

  it('grounding guard: re-asks with a forced tool call when a small model answers with numbers', async () => {
    const rt = runtime([() => 'The tip is $11.61.', () => '18% of 64.50"}}\n</tool_call>']);
    const p = new LocalProvider(rt);
    const res = await p.complete({ messages: [{ role: 'user', content: 'Tip on $64.50 at 18%?' }], tools: LEMMA_TOOLS });
    expect(rt.calls[1]!.prefill).toContain('<tool_call>');
    expect(res.toolCalls[0]!.args).toEqual({ query: '18% of 64.50' });
    expect(res.text).toBe('');
  });

  it('guard also catches long invented answers (which would otherwise have started streaming)', async () => {
    const rt = runtime([() => 'The number of days until Christmas is approximately 252 days.', () => 'days until christmas"}}\n</tool_call>']);
    let streamed = '';
    const res = await new LocalProvider(rt).complete({ messages: [{ role: 'user', content: 'How many days until christmas?' }], tools: LEMMA_TOOLS }, undefined, (d) => (streamed += d));
    expect(streamed).toBe('');
    expect(res.toolCalls[0]!.args).toEqual({ query: 'days until christmas' });
  });

  it('treats a graph call nobody asked for as a misfire', async () => {
    const rt = runtime([() => '<tool_call>{"name": "graph", "arguments": {"expressions": ["x^2"]}}</tool_call>', () => 'days until christmas"}}\n</tool_call>']);
    const res = await new LocalProvider(rt).complete({ messages: [{ role: 'user', content: 'How many days until christmas?' }], tools: LEMMA_TOOLS });
    expect(res.toolCalls[0]).toMatchObject({ name: 'compute', args: { query: 'days until christmas' } });
    const rt2 = runtime([() => '<tool_call>{"name": "graph", "arguments": {"expressions": ["x^2"]}}</tool_call>']);
    const ok = await new LocalProvider(rt2).complete({ messages: [{ role: 'user', content: 'plot x squared' }], tools: LEMMA_TOOLS });
    expect(ok.toolCalls[0]!.name).toBe('graph');
  });

  it('streams plain answers and does not re-ask after tool results', async () => {
    const rt = runtime([() => 'The tip is $11.61, computed by Lemma.']);
    const p = new LocalProvider(rt);
    let streamed = '';
    const res = await p.complete(
      {
        messages: [
          { role: 'user', content: 'tip?' },
          { role: 'assistant', content: [{ type: 'tool_call', id: 'a', name: 'compute', args: { query: 'q' } }] },
          { role: 'user', content: [{ type: 'tool_result', callId: 'a', content: '{"display":"$11.61"}' }] },
        ],
        tools: LEMMA_TOOLS,
      },
      undefined,
      (d) => (streamed += d),
    );
    expect(rt.calls).toHaveLength(1);
    expect(streamed).toBe('The tip is $11.61, computed by Lemma.');
    expect(res.stopReason).toBe('end');
  });
});

describe('presets and model listing', () => {
  const fake = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

  it('lists OpenAI-compatible and Ollama models', async () => {
    expect(await listModels(presetById('ollama'), { fetch: fake(200, { data: [{ id: 'qwen3:8b' }, { id: 'llama3.2' }] }) })).toEqual(['llama3.2', 'qwen3:8b']);
  });

  it('explains unreachable local servers and bad keys', async () => {
    const down = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    await expect(listModels(presetById('ollama'), { fetch: down })).rejects.toThrow(/OLLAMA_ORIGINS/);
    await expect(listModels(presetById('openai'), { apiKey: 'x', fetch: fake(401, {}) })).rejects.toThrow(/rejected/);
  });

  it('sends the Anthropic browser-access header when listing Claude models', async () => {
    let headers: Record<string, string> = {};
    const spy = (async (_u: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return new Response(JSON.stringify({ data: [{ id: 'claude-sonnet-5-5' }] }));
    }) as unknown as typeof fetch;
    expect(await listModels(presetById('anthropic'), { apiKey: 'k', fetch: spy })).toEqual(['claude-sonnet-5-5']);
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  });
});

describe('transformers runtime abort', () => {
  it('a signal that is already aborted never starts generation', async () => {
    const { createTransformersRuntime } = await import('../src');
    let generated = 0;
    const tokenizer = Object.assign(() => ({ input_ids: { dims: [1], slice: () => null } }), { apply_chat_template: () => 'p', batch_decode: () => [''] });
    const tf = {
      AutoTokenizer: { from_pretrained: async () => tokenizer },
      AutoModelForCausalLM: { from_pretrained: async () => ({ generate: async () => (generated++, { dims: [1], slice: () => null }) }) },
      TextStreamer: class {},
      InterruptableStoppingCriteria: class { interrupt() {} reset() {} },
    } as unknown as import('../src').TransformersLib;
    const rt = await createTransformersRuntime(tf, 'm');
    const ac = new AbortController();
    ac.abort();
    await expect(rt.generate({ messages: [], maxTokens: 5 }, () => {}, ac.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(generated).toBe(0);
  });
});
