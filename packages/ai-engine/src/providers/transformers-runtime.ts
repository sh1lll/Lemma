import type { LocalGenerateRequest, LocalRuntime } from './local';

/**
 * A LocalRuntime backed by transformers.js. The library is passed in (not imported) so ai-engine has no
 * heavy dependency: the web app runs this inside a worker, tests run it in Node.
 */

interface Tensor {
  dims: number[];
  slice(...a: unknown[]): unknown;
}

export interface TransformersLib {
  AutoTokenizer: { from_pretrained(id: string, o?: object): Promise<Tokenizer> };
  AutoModelForCausalLM: { from_pretrained(id: string, o?: object): Promise<Model> };
  TextStreamer: new (tok: Tokenizer, o: { skip_prompt: boolean; skip_special_tokens: boolean; callback_function: (t: string) => void }) => unknown;
  InterruptableStoppingCriteria?: new () => { interrupt(): void; reset(): void };
}

interface Tokenizer {
  apply_chat_template(messages: unknown, o: object): string;
  (text: string, o: object): { input_ids: Tensor };
  batch_decode(t: unknown, o: object): string[];
}

interface Model {
  generate(o: object): Promise<Tensor>;
}

export interface TransformersRuntimeOptions {
  device?: 'webgpu' | 'wasm' | 'cpu';
  dtype?: string;
  onProgress?: (percent: number) => void;
}

export async function createTransformersRuntime(tf: TransformersLib, modelId: string, opts: TransformersRuntimeOptions = {}): Promise<LocalRuntime> {
  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status !== 'progress' || !p.file || !p.total) return;
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
    let l = 0;
    let t = 0;
    for (const f of files.values()) {
      l += f.loaded;
      t += f.total;
    }
    opts.onProgress?.(Math.round((l / t) * 100));
  };
  const tokenizer = await tf.AutoTokenizer.from_pretrained(modelId, { progress_callback });
  const model = await tf.AutoModelForCausalLM.from_pretrained(modelId, { dtype: opts.dtype ?? 'q4f16', device: opts.device, progress_callback });
  const stopper = tf.InterruptableStoppingCriteria ? new tf.InterruptableStoppingCriteria() : null;

  return {
    model: modelId,
    async generate(req: LocalGenerateRequest, onToken: (t: string) => void, signal?: AbortSignal): Promise<string> {
      // Stopped while the model was loading: the abort event has already fired, so the listener below would miss it.
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      // enable_thinking=false keeps Qwen3 replies short and direct (the tools do the reasoning-heavy work).
      const prompt = tokenizer.apply_chat_template(req.messages, { tools: req.tools?.length ? req.tools : undefined, add_generation_prompt: true, tokenize: false, enable_thinking: false }) + (req.prefill ?? '');
      const inputs = tokenizer(prompt, { add_special_tokens: false, return_dict: true });
      let text = '';
      const streamer = new tf.TextStreamer(tokenizer, {
        skip_prompt: true,
        skip_special_tokens: false,
        callback_function: (t: string) => {
          text += t;
          onToken(t);
        },
      });
      stopper?.reset();
      const onAbort = () => stopper?.interrupt();
      signal?.addEventListener('abort', onAbort);
      try {
        await model.generate({ ...inputs, max_new_tokens: req.maxTokens, do_sample: false, streamer, ...(stopper ? { stopping_criteria: stopper } : {}) });
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return text;
    },
  };
}
