// The built-in assistant model, in its own utility process (ONNX Runtime for Node, CPU; no GPU needed).
// A model that is too big for this computer can abort the process that loads it; here that ends only this
// process, and llm.mjs reports it, instead of taking the whole app down.
// Mirrors packages/ai-engine/src/providers/transformers-runtime.ts (that file is TypeScript; this is plain JS).
import { MAX_NEW_TOKENS } from './security.mjs';

const port = process.parentPort;
const cacheDir = process.argv[2];
let tf = null;
let loaded = null; // { id, tokenizer, model }
let loading = null;
const stoppers = new Map();

async function lib() {
  if (tf) return tf;
  tf = await import('@huggingface/transformers');
  // Inside the packaged app the module directory is read-only; keep models in the user's data folder.
  tf.env.cacheDir = cacheDir;
  tf.env.allowLocalModels = false;
  return tf;
}

function load(id, onProgress) {
  if (loaded?.id === id) return Promise.resolve(loaded);
  if (loading?.id === id) return loading.promise;
  const files = new Map();
  const progress_callback = (p) => {
    if (p.status !== 'progress' || !p.file || !p.total) return;
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
    let l = 0;
    let t = 0;
    for (const f of files.values()) {
      l += f.loaded;
      t += f.total;
    }
    onProgress(Math.round((l / t) * 100));
  };
  const promise = (async () => {
    const t = await lib();
    const tokenizer = await t.AutoTokenizer.from_pretrained(id, { progress_callback });
    const model = await t.AutoModelForCausalLM.from_pretrained(id, { dtype: 'q4f16', device: 'cpu', progress_callback });
    // Switching models: free the previous one (a model is hundreds of MB to GBs of native memory).
    const previous = loaded;
    loaded = { id, tokenizer, model };
    if (previous && previous.model !== model) Promise.resolve(previous.model.dispose?.()).catch(() => {});
    return loaded;
  })();
  loading = { id, promise };
  promise.catch(() => (loading = null));
  return promise;
}

async function generate(rid, id, modelId, req) {
  const t = await lib();
  const { tokenizer, model } = await load(modelId, (percent) => port.postMessage({ type: 'progress', rid, percent }));
  const prompt =
    tokenizer.apply_chat_template(req.messages, { tools: req.tools?.length ? req.tools : undefined, add_generation_prompt: true, tokenize: false, enable_thinking: false }) +
    (req.prefill ?? '');
  const inputs = tokenizer(prompt, { add_special_tokens: false, return_dict: true });
  let text = '';
  const streamer = new t.TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: false,
    callback_function: (s) => {
      text += s;
      port.postMessage({ type: 'token', id, text: s });
    },
  });
  const entry = stoppers.get(id);
  if (!entry || entry.interrupted) return '';
  entry.stopper = new t.InterruptableStoppingCriteria();
  const maxTokens = Math.max(1, Math.min(MAX_NEW_TOKENS, Math.floor(Number(req.maxTokens) || 1024)));
  await model.generate({ ...inputs, max_new_tokens: maxTokens, do_sample: false, streamer, stopping_criteria: entry.stopper });
  return text;
}

port.on('message', async ({ data: m }) => {
  if (m.type === 'abort') {
    const s = stoppers.get(m.id);
    if (s) {
      s.interrupted = true;
      s.stopper?.interrupt();
    }
    return;
  }
  try {
    if (m.type === 'load') {
      await load(m.id, (percent) => port.postMessage({ type: 'progress', rid: m.rid, percent }));
      port.postMessage({ type: 'done', rid: m.rid, result: null });
    } else if (m.type === 'generate') {
      // Registered before the first await: an abort that arrives while the model loads must not be lost.
      stoppers.set(m.id, { interrupted: false, stopper: null });
      try {
        port.postMessage({ type: 'done', rid: m.rid, result: await generate(m.rid, m.id, m.model, m.req) });
      } finally {
        stoppers.delete(m.id);
      }
    }
  } catch (e) {
    port.postMessage({ type: 'error', rid: m.rid, message: e instanceof Error ? e.message : String(e) });
  }
});
