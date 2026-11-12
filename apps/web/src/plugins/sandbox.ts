import type { ScriptManifest } from '@lemma/plugin-engine';

/**
 * Runs a script extension inside a sandboxed iframe:
 *  - `sandbox="allow-scripts"` gives it a unique opaque origin: no cookies, storage, or access to this page.
 *  - A Content-Security-Policy blocks all network access except hosts the user approved (`network:host`).
 *  - One iframe per extension, so extensions can't see each other; a run that exceeds TIME_LIMIT_MS gets the
 *    iframe torn down and rebuilt.
 * The only channel is postMessage: the host sends inputs, the extension returns plain data, and it may ask
 * the host to compute something with Lemma's own engines (`api.compute(query)`).
 */

const TIME_LIMIT_MS = 2000;

export type ComputeFn = (query: string) => Promise<unknown>;

// Runs inside the extension's Web Worker (its own thread, so an infinite loop can't freeze Lemma).
const WORKER_HARNESS = `
const api = {
  compute(query) {
    return new Promise((resolve) => {
      const cid = Math.random().toString(36).slice(2);
      const on = (e) => {
        if (!e.data || e.data.type !== 'computeResult' || e.data.cid !== cid) return;
        removeEventListener('message', on);
        resolve(e.data.result);
      };
      addEventListener('message', on);
      postMessage({ type: 'compute', cid, query: String(query).slice(0, 500) });
    });
  },
};
addEventListener('message', async (e) => {
  if (!e.data || e.data.type !== 'run') return;
  const { id, inputs } = e.data;
  try {
    if (typeof run !== 'function') throw new Error('The extension defines no run(inputs, api) function');
    const result = await run(inputs, api);
    postMessage({ type: 'result', id, result: JSON.parse(JSON.stringify(result ?? null)) });
  } catch (err) {
    postMessage({ type: 'error', id, message: String((err && err.message) || err).slice(0, 300) });
  }
});
`;

// Runs in the sandboxed iframe: starts the worker and relays messages; kills the worker on a timeout.
const FRAME_HARNESS = `
const worker = (() => {
  const url = URL.createObjectURL(new Blob([CODE + '\\n' + WORKER_HARNESS], { type: 'text/javascript' }));
  return new Worker(url);
})();
const timers = new Map();
worker.onmessage = (e) => {
  const d = e.data || {};
  if (d.type === 'result' || d.type === 'error') { clearTimeout(timers.get(d.id)); timers.delete(d.id); }
  parent.postMessage(d, '*');
};
worker.onerror = (e) => parent.postMessage({ type: 'fatal', message: String(e.message || 'The extension failed to start') }, '*');
addEventListener('message', (e) => {
  if (e.source !== parent || !e.data) return;
  if (e.data.type === 'run') {
    timers.set(e.data.id, setTimeout(() => {
      worker.terminate();
      parent.postMessage({ type: 'error', id: e.data.id, message: 'timeout' }, '*');
    }, LIMIT));
  }
  worker.postMessage(e.data);
});
parent.postMessage({ type: 'ready' }, '*');
`;

function srcdoc(m: ScriptManifest, allowedHosts: string[]): string {
  const connect = allowedHosts.length ? allowedHosts.map((h) => `https://${h}`).join(' ') : "'none'";
  // Workers created from blob: URLs inherit this policy, so the network rules apply to extension code too.
  const csp = `default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; connect-src ${connect}; img-src 'none'; style-src 'none'; form-action 'none'`;
  // Inline as JSON string literals; \u003c keeps "</script" from ending the element.
  const lit = (x: string) => JSON.stringify(x).replace(/</g, '\\u003c');
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><script>"use strict";const CODE=${lit(`"use strict";\n${m.script}`)};const WORKER_HARNESS=${lit(WORKER_HARNESS)};const LIMIT=${TIME_LIMIT_MS};${FRAME_HARNESS}</script>`;
}

export class Sandbox {
  private frame: HTMLIFrameElement | null = null;
  private ready: Promise<void> | null = null;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: number }>();
  private onMessage = (e: MessageEvent) => this.handle(e);

  constructor(
    private manifest: ScriptManifest,
    private allowedHosts: string[],
    private compute: ComputeFn,
  ) {}

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts');
    f.setAttribute('aria-hidden', 'true');
    f.tabIndex = -1;
    f.style.display = 'none';
    f.srcdoc = srcdoc(this.manifest, this.allowedHosts);
    this.frame = f;
    window.addEventListener('message', this.onMessage);
    this.ready = new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(() => reject(new Error(`The “${this.manifest.name}” extension didn’t start`)), TIME_LIMIT_MS * 2);
      this.readyResolve = () => {
        clearTimeout(t);
        resolve();
      };
    });
    document.body.append(f);
    return this.ready;
  }

  private readyResolve: () => void = () => {};

  private handle(e: MessageEvent): void {
    if (!this.frame || e.source !== this.frame.contentWindow) return; // only our own iframe
    const d = e.data as { type?: string; id?: string; cid?: string; query?: unknown; result?: unknown; message?: unknown };
    if (d?.type === 'ready') return this.readyResolve();
    if (d?.type === 'fatal') {
      for (const p of this.pending.values()) p.reject(new Error(`The “${this.manifest.name}” extension failed to start: ${String(d.message ?? '')}`));
      this.destroy();
      return;
    }
    if (d?.type === 'compute' && typeof d.cid === 'string') {
      void this.compute(String(d.query ?? '')).then((result) => this.frame?.contentWindow?.postMessage({ type: 'computeResult', cid: d.cid, result }, '*'));
      return;
    }
    const p = typeof d?.id === 'string' ? this.pending.get(d.id) : undefined;
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(d.id!);
    if (d.type === 'result') p.resolve(d.result);
    else if (d.message === 'timeout') {
      this.destroy(); // the worker was terminated; start fresh next time
      p.reject(new Error(`The “${this.manifest.name}” extension took longer than ${TIME_LIMIT_MS / 1000} s and was stopped`));
    } else p.reject(new Error(String(d.message ?? 'The extension failed')));
  }

  async run(inputs: Record<string, string>): Promise<unknown> {
    await this.start();
    const id = Math.random().toString(36).slice(2);
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        // Backstop only: the iframe normally reports the timeout itself after terminating the worker.
        this.pending.delete(id);
        this.destroy(); // a hung extension is torn down; the next run starts fresh
        reject(new Error(`The “${this.manifest.name}” extension took longer than ${TIME_LIMIT_MS / 1000} s`));
      }, TIME_LIMIT_MS + 1500);
      this.pending.set(id, { resolve, reject, timer });
      this.frame!.contentWindow!.postMessage({ type: 'run', id, inputs }, '*');
    });
  }

  destroy(): void {
    window.removeEventListener('message', this.onMessage);
    this.frame?.remove();
    this.frame = null;
    this.ready = null;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Extension stopped'));
    }
    this.pending.clear();
  }
}
