// Checks that a small on-device model (transformers.js) emits usable tool calls for Lemma's compute tool.
// Usage: node scripts/local-llm-check.mjs [model-id] [dtype]
import { AutoTokenizer, AutoModelForCausalLM } from '@huggingface/transformers';
const id = process.argv[2] ?? 'onnx-community/Qwen3-0.6B-ONNX';
const dtype = process.argv[3] ?? 'q4f16';
const tools = [{ type: 'function', function: { name: 'compute', description: 'Run a calculation with Lemma. Accepts natural phrasing: "18% of 275", "monthly payment on $300000 at 6% for 30 years", "derivative of x^2".', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } }];
const t0 = performance.now();
const tok = await AutoTokenizer.from_pretrained(id);
const model = await AutoModelForCausalLM.from_pretrained(id, { dtype });
console.log('loaded in', ((performance.now() - t0) / 1000).toFixed(1), 's');
for (const q of ["What's the tip on a $64.50 bill at 18%?", 'I borrow $20,000 at 7% for 5 years. Monthly payment?']) {
  const messages = [
    { role: 'system', content: 'You are a calculator assistant. Never compute yourself: call the compute tool for every number.' },
    { role: 'user', content: q },
  ];
  const prefill = process.env.PREFILL ? '<tool_call>\n{"name": "compute", "arguments": {"query": "' : '';
  const prompt = tok.apply_chat_template(messages, { tools, add_generation_prompt: true, tokenize: false, enable_thinking: false }) + prefill;
  const inputs = tok(prompt, { add_special_tokens: false, return_dict: true });
  const t = performance.now();
  const out = await model.generate({ ...inputs, max_new_tokens: 120, do_sample: false });
  const text = tok.batch_decode(out.slice(null, [inputs.input_ids.dims.at(-1), null]), { skip_special_tokens: false })[0];
  console.log(`\n${prefill ? '[prefill] ' : ''}${q}\n  ${((performance.now() - t) / 1000).toFixed(1)}s →`, JSON.stringify(text.slice(0, 300)));
}
