import { calculate, createSession } from '@lemma/math-core';
import { describe, expect, it } from 'vitest';
import { answerFinance } from '../../finance-engine/src';
import { answerToToolResult, calcToToolResult, createTransformersRuntime, LocalProvider, runAssistant, type ToolExecutor, type TransformersLib } from '../src';

// Real on-device model end to end: Qwen3 drives the agent loop, Lemma's engines compute.
// Heavy (downloads ~0.6–1.4 GB once): run with LEMMA_LOCAL_LLM=1 [LEMMA_LOCAL_MODEL=…].
describe.skipIf(process.env.LEMMA_LOCAL_LLM !== '1')('built-in model (real)', () => {
  it('answers with numbers that came from tool calls', async () => {
    const tf = (await import('@huggingface/transformers')) as unknown as TransformersLib;
    const model = process.env.LEMMA_LOCAL_MODEL ?? 'onnx-community/Qwen3-1.7B-ONNX';
    const rt = await createTransformersRuntime(tf, model, { device: 'cpu', dtype: 'q4f16' });
    const session = createSession();
    const tools: ToolExecutor = async (_name, args) => {
      const q = String(args.query);
      const f = answerFinance(q);
      return f ? answerToToolResult(f) : calcToToolResult(calculate(q, session));
    };
    for (const [question, expected] of [
      ["What's an 18% tip on a $64.50 bill?", '11.61'],
      ['I borrow $20,000 at 7% for 5 years. What is my monthly payment?', '396.02'],
    ] as const) {
      const r = await runAssistant({ provider: new LocalProvider(rt), tools, level: 'concise', messages: [{ role: 'user', content: question }], maxSteps: 4 });
      console.log(`${question}\n  tools: ${r.toolCalls.map((c) => `${c.args.query} → ${c.result.display}`).join(' | ')}\n  answer: ${r.text.slice(0, 200)}`);
      expect(r.toolCalls.length).toBeGreaterThan(0);
      expect(r.toolCalls.some((c) => c.result.ok && c.result.display.includes(expected))).toBe(true);
    }
  }, 600_000);
});
