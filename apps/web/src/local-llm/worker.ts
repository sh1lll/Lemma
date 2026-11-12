/// <reference lib="webworker" />
// The built-in assistant model, running on this device. Loaded only when the user picks it.
import { createTransformersRuntime, type LocalGenerateRequest, type LocalRuntime, type TransformersLib } from '@lemma/ai-engine';

/**
 * transformers.js is loaded from its official, version-pinned build rather than bundled: the bundled copy's
 * ONNX Runtime fails on models this size ("memory access out of bounds"), the official one works in every
 * WebGPU browser tested. The service worker caches it, so it is a one-time download like the model itself.
 */
export const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2';
let lib: Promise<TransformersLib & { env: { allowLocalModels: boolean } }> | null = null;
const transformers = () => (lib ??= import(/* @vite-ignore */ TRANSFORMERS_URL));

export type LlmIn = { type: 'load'; model: string; device?: 'webgpu' | 'wasm'; dtype?: string } | { type: 'generate'; id: number; req: LocalGenerateRequest } | { type: 'abort'; id: number };
export type LlmOut =
  | { type: 'progress'; percent: number }
  | { type: 'ready'; model: string; device: string }
  | { type: 'token'; id: number; text: string }
  | { type: 'done'; id: number; text: string }
  | { type: 'error'; id?: number; message: string };

const post = (m: LlmOut) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

let loading: Promise<LocalRuntime> | null = null;
let loadedModel = '';
const aborts = new Map<number, AbortController>();

async function pickDevice(): Promise<{ device: 'webgpu' | 'wasm'; dtype: string }> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
    const adapter = gpu && (await gpu.requestAdapter());
    // q4f16 needs half-precision shaders; otherwise use the q4 (fp32-activation) build.
    if (adapter) return { device: 'webgpu', dtype: adapter.features.has('shader-f16') ? 'q4f16' : 'q4' };
  } catch {
    // Fall through to WASM.
  }
  return { device: 'wasm', dtype: 'q4' };
}

function load(model: string, override: { device?: 'webgpu' | 'wasm'; dtype?: string } = {}): Promise<LocalRuntime> {
  if (loading && loadedModel === model) return loading;
  loadedModel = model;
  loading = (async () => {
    const auto = await pickDevice();
    const device = override.device ?? auto.device;
    const dtype = override.dtype ?? (override.device === 'wasm' ? 'q4' : auto.dtype);
    const tf = await transformers();
    tf.env.allowLocalModels = false;
    const rt = await createTransformersRuntime(tf, model, { device, dtype, onProgress: (percent) => post({ type: 'progress', percent }) });
    post({ type: 'ready', model, device });
    return rt;
  })();
  loading.catch((e) => {
    loading = null;
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  });
  return loading;
}

self.onmessage = async (e: MessageEvent<LlmIn>) => {
  const m = e.data;
  if (m.type === 'load') return void load(m.model, { device: m.device, dtype: m.dtype }).catch(() => {});
  if (m.type === 'abort') return aborts.get(m.id)?.abort();
  const ac = new AbortController();
  aborts.set(m.id, ac);
  try {
    const rt = await load(loadedModel);
    const text = await rt.generate(m.req, (t) => post({ type: 'token', id: m.id, text: t }), ac.signal);
    post({ type: 'done', id: m.id, text });
  } catch (err) {
    post({ type: 'error', id: m.id, message: err instanceof Error ? err.message : String(err) });
  } finally {
    aborts.delete(m.id);
  }
};
