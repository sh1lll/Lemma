import type { LocalGenerateRequest, LocalRuntime } from '@lemma/ai-engine';
import type { LlmIn, LlmOut } from './worker';

/** Main-thread handle to the on-device model worker; implements LocalRuntime for the LocalProvider. */
export class LocalModelClient implements LocalRuntime {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, { onToken: (t: string) => void; resolve: (t: string) => void; reject: (e: Error) => void }>();
  private readyFor = '';
  private readyWaiters: { resolve: () => void; reject: (e: Error) => void }[] = [];
  device = '';
  onStatus: (s: string) => void = () => {};

  constructor(public model: string) {}

  get ready(): boolean {
    return this.readyFor === this.model;
  }

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<LlmOut>) => {
      const m = e.data;
      if (m.type === 'progress') this.onStatus(`Downloading the on-device model… ${m.percent}%`);
      else if (m.type === 'ready') {
        this.readyFor = m.model;
        this.device = m.device;
        this.onStatus('');
        this.readyWaiters.splice(0).forEach((w) => w.resolve());
      } else if (m.type === 'token') this.pending.get(m.id)?.onToken(m.text);
      else if (m.type === 'done') {
        this.pending.get(m.id)?.resolve(m.text);
        this.pending.delete(m.id);
      } else if (m.type === 'error') {
        if (m.id === undefined) {
          this.onStatus('');
          this.readyWaiters.splice(0).forEach((w) => w.reject(new Error(m.message)));
          for (const p of this.pending.values()) p.reject(new Error(m.message));
          this.pending.clear();
        } else {
          this.pending.get(m.id)?.reject(new Error(m.message));
          this.pending.delete(m.id);
        }
      }
    };
    this.worker = w;
    return w;
  }

  /** Starts the one-time download (or loads from cache). */
  load(model = this.model): void {
    this.model = model;
    // Diagnostics: localStorage 'lemma.llm-override' = '{"device":"wasm","dtype":"q4"}' forces a backend.
    let override: { device?: 'webgpu' | 'wasm'; dtype?: string } = {};
    try {
      override = JSON.parse(localStorage.getItem('lemma.llm-override') ?? '{}');
    } catch {
      override = {};
    }
    this.ensure().postMessage({ type: 'load', model, ...override } satisfies LlmIn);
  }

  /** Resolves once the current model has loaded (downloading it first if needed). */
  whenReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve, reject) => this.readyWaiters.push({ resolve, reject }));
  }

  generate(req: LocalGenerateRequest, onToken: (t: string) => void, signal?: AbortSignal): Promise<string> {
    if (!this.ready) this.load(this.model);
    const id = this.nextId++;
    const w = this.ensure();
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { onToken, resolve, reject });
      signal?.addEventListener('abort', () => w.postMessage({ type: 'abort', id } satisfies LlmIn), { once: true });
      w.postMessage({ type: 'generate', id, req } satisfies LlmIn);
    });
  }
}
