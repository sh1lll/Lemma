/// <reference lib="webworker" />
// Runs Whisper off the main thread. Loaded only when on-device voice is used, so it costs the core nothing.
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

export const MODEL = 'onnx-community/whisper-tiny.en';

export type WorkerIn = { type: 'load' } | { type: 'transcribe'; id: number; audio: Float32Array };
export type WorkerOut =
  | { type: 'progress'; percent: number }
  | { type: 'ready'; device: string }
  | { type: 'result'; id: number; text: string; ms: number }
  | { type: 'error'; id?: number; message: string };

env.allowLocalModels = false;

const post = (m: WorkerOut) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

let loading: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function hasWebGPU(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!(gpu && (await gpu.requestAdapter()));
  } catch {
    return false;
  }
}

function load(): Promise<AutomaticSpeechRecognitionPipeline> {
  loading ??= (async () => {
    const webgpu = await hasWebGPU();
    const files = new Map<string, { loaded: number; total: number }>();
    const asr = (await pipeline('automatic-speech-recognition', MODEL, {
      device: webgpu ? 'webgpu' : 'wasm',
      // fp32 encoder is required for accuracy on WebGPU; the decoder quantises well.
      dtype: webgpu ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
      progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status !== 'progress' || !p.file || !p.total) return;
        files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
        let loaded = 0;
        let total = 0;
        for (const f of files.values()) {
          loaded += f.loaded;
          total += f.total;
        }
        post({ type: 'progress', percent: Math.round((loaded / total) * 100) });
      },
    })) as AutomaticSpeechRecognitionPipeline;
    // Warm-up pass compiles kernels so the first real utterance is fast.
    await asr(new Float32Array(16000));
    post({ type: 'ready', device: webgpu ? 'webgpu' : 'wasm' });
    return asr;
  })();
  loading.catch((e) => {
    loading = null;
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  });
  return loading;
}

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  if (msg.type === 'load') {
    load().catch(() => {});
    return;
  }
  // Serialise inference: one utterance at a time.
  queue = queue.then(async () => {
    try {
      const asr = await load();
      const t0 = performance.now();
      const out = (await asr(msg.audio)) as { text: string };
      post({ type: 'result', id: msg.id, text: out.text, ms: performance.now() - t0 });
    } catch (err) {
      post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
    }
  });
};
