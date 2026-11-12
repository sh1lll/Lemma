import { runSimulation, type SimRequest, type SimulationSummary } from '@lemma/notebook-engine';
import type { SimWorkerIn, SimWorkerOut } from './sim-worker';

/**
 * Runs notebook simulations in a Worker (inline when Workers are unavailable). Results are cached by request:
 * the notebook re-evaluates on every edit, and a seeded simulation's result never changes, so unchanged
 * `simulate` lines cost nothing. A newer evaluation cancels the running one by restarting the worker.
 */
const CACHE_MAX = 64;
/** Small runs are faster inline than the worker round trip. */
const INLINE_TRIALS = 5_000;

export class SimulationClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: SimulationSummary) => void; reject: (e: Error) => void }>();
  private cache = new Map<string, SimulationSummary>();

  run = (req: SimRequest, signal?: AbortSignal): Promise<SimulationSummary> => {
    const key = JSON.stringify(req);
    const hit = this.cache.get(key);
    if (hit) return Promise.resolve(hit);
    const done = (r: SimulationSummary) => {
      if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, r);
      return r;
    };
    if (req.trials <= INLINE_TRIALS || typeof Worker === 'undefined') {
      try {
        return Promise.resolve(done(runSimulation(req)));
      } catch (e) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)));
      }
    }
    return new Promise<SimulationSummary>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve: (r) => resolve(done(r)), reject });
      signal?.addEventListener('abort', () => this.cancel(), { once: true });
      this.ensure().postMessage({ id, req } satisfies SimWorkerIn);
    });
  };

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./sim-worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<SimWorkerOut>) => {
      const m = e.data;
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.ok) p.resolve(m.result);
      else p.reject(new Error(m.error));
    };
    w.onerror = () => this.fail('The simulation worker stopped unexpectedly');
    this.worker = w;
    return w;
  }

  /** Stops whatever is running (a newer edit superseded it). */
  private cancel(): void {
    if (!this.pending.size) return;
    this.fail('Cancelled');
  }

  private fail(message: string): void {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.reject(new Error(message));
    this.pending.clear();
  }
}
