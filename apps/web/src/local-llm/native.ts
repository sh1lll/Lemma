import type { LocalGenerateRequest, LocalRuntime } from '@lemma/ai-engine';

/** Bridge to the desktop app's native model (Electron main process). Same surface as LocalModelClient. */
interface NativeBridge {
  load(model: string): Promise<{ model: string; device: string }>;
  generate(id: number, model: string, req: LocalGenerateRequest): Promise<string>;
  abort(id: number): void;
  onToken(cb: (d: { id: number; text: string }) => void): () => void;
  onProgress(cb: (percent: number) => void): () => void;
}

export function nativeBridge(): NativeBridge | null {
  return (window as unknown as { lemmaDesktop?: { llm?: NativeBridge } }).lemmaDesktop?.llm ?? null;
}

export class NativeModelClient implements LocalRuntime {
  private readyFor = '';
  private loading: Promise<void> | null = null;
  private nextId = 1;
  private sinks = new Map<number, (t: string) => void>();
  device = 'native';
  onStatus: (s: string) => void = () => {};

  constructor(
    public model: string,
    private bridge: NativeBridge,
  ) {
    bridge.onToken((d) => this.sinks.get(d.id)?.(d.text));
    bridge.onProgress((p) => this.onStatus(p < 100 ? `Downloading the on-device model… ${p}%` : 'Loading the model…'));
  }

  get ready(): boolean {
    return this.readyFor === this.model;
  }

  load(model = this.model): void {
    this.model = model;
    void this.whenReady().catch(() => {});
  }

  whenReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    const model = this.model;
    this.loading ??= this.bridge.load(model).then(
      () => {
        this.readyFor = model;
        this.loading = null;
        this.onStatus('');
      },
      (e: unknown) => {
        this.loading = null;
        this.onStatus('');
        throw e;
      },
    );
    return this.loading;
  }

  async generate(req: LocalGenerateRequest, onToken: (t: string) => void, signal?: AbortSignal): Promise<string> {
    await this.whenReady();
    // Stopped during the (possibly long) model download: don't start a generation nobody will read.
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const id = this.nextId++;
    this.sinks.set(id, onToken);
    const onAbort = () => this.bridge.abort(id);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const text = await this.bridge.generate(id, this.model, req);
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return text;
    } finally {
      this.sinks.delete(id);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}
