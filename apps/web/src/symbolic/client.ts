import type { SymRequest, SymResult } from '@lemma/symbolic-engine';
import type { SymWorkerIn, SymWorkerOut } from './worker';

/**
 * Talks to the SymPy worker. Results are cached by request, so the router can stay synchronous:
 * it asks `cached()` first and only waits (`run`) on a miss. A hung computation is cut off after
 * TIMEOUT_MS by restarting the worker; whatever else was waiting is sent again to the new one, and a cut-off is
 * never cached (asking again gets a fresh try). Report sections are background work: they wait until nothing the
 * user asked for is running, and get a shorter limit, so one stubborn section can't hold up the next question.
 * Live-preview work (while typing) is the lowest lane: it waits for a short pause in typing, only the newest one is
 * kept, it gets the shorter limit too (until Enter asks for it), and its answer is cached, so pressing Enter on what
 * was typed is usually answered at once.
 */
const PREVIEW_PAUSE_MS = 250;
const TIMEOUT_MS = 30_000;
const BACKGROUND_MS = 8_000;

interface Pending {
  key: string;
  resolve: (r: SymResult) => void;
  timer: number;
  background: boolean;
  preview: boolean;
}

export class SymbolicClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  /** Background requests not yet sent to the worker. */
  private queued: { id: number; key: string; resolve: (r: SymResult) => void }[] = [];
  /** The newest live-preview request, waiting for a pause in typing. */
  private previewNext: { id: number; key: string; resolve: (r: SymResult) => void } | null = null;
  private previewTimer = 0;
  private previewDue = 0;
  private cache = new Map<string, SymResult>();
  private inflight = new Map<string, Promise<SymResult>>();
  ready = false;
  /** Callers of whenReady() waiting for Python and SymPy to be up. */
  private waiters: { resolve: () => void; reject: (e: Error) => void }[] = [];
  onStatus: (s: string, stage?: [number, number]) => void = () => {};

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<SymWorkerOut>) => {
      const m = e.data;
      if ('status' in m) this.onStatus(m.status, m.stage);
      else if ('ready' in m) {
        this.ready = true;
        this.onStatus('');
        for (const w of this.waiters.splice(0)) w.resolve();
      } else if ('fatal' in m) {
        this.onStatus('');
        for (const w of this.waiters.splice(0)) w.reject(new Error(`The algebra engine couldn't load (${m.fatal})`));
        const failed = { ok: false, error: `The algebra engine couldn't load (${m.fatal}). It needs one online visit.` } as SymResult;
        for (const [id, p] of this.pending) {
          clearTimeout(p.timer);
          p.resolve(failed);
          this.pending.delete(id);
        }
        for (const q of this.queued.splice(0)) q.resolve(failed);
        this.previewNext?.resolve(failed);
        this.previewNext = null;
      } else {
        const p = this.pending.get(m.id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(m.id);
        p.resolve(JSON.parse(m.result) as SymResult);
        this.drain();
      }
    };
    this.worker = w;
    return w;
  }

  warm(): void {
    this.ensure().postMessage({ warm: true } satisfies SymWorkerIn);
  }

  /** Starts the engine if needed; resolves once Python is running and SymPy is imported. */
  whenReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this.warm();
    });
  }

  cached(req: SymRequest): SymResult | undefined {
    return this.cache.get(JSON.stringify(req));
  }

  run(req: SymRequest, opts: { preview?: boolean } = {}): Promise<SymResult> {
    const key = JSON.stringify(req);
    const hit = this.cache.get(key);
    if (hit) return Promise.resolve(hit);
    const existing = this.inflight.get(key);
    if (existing) {
      // Enter on what a preview is still waiting to work out: it's wanted now.
      if (!opts.preview && this.previewNext?.key === key) this.promotePreview();
      else if (!opts.preview) this.promoteSent(key);
      return existing;
    }
    const id = this.nextId++;
    const background = req.op === 'report';
    const p = new Promise<SymResult>((resolve) => {
      if (opts.preview) this.queuePreview({ id, key, resolve });
      else if (background) {
        this.queued.push({ id, key, resolve });
        this.drain();
      } else this.send(id, key, resolve, false);
    }).then((r) => {
      this.inflight.delete(key);
      // A cut-off, a failed load or a preview overtaken by more typing isn't the answer: the next ask tries afresh.
      if (!r.ok && /^Stopped after|couldn't load|^superseded$|^This part took too long/.test(r.error ?? '')) return r;
      if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, r);
      return r;
    });
    this.inflight.set(key, p);
    return p;
  }

  private send(id: number, key: string, resolve: (r: SymResult) => void, background: boolean, preview = false): void {
    // The first request includes the download, so allow it longer.
    const limit = !this.ready ? TIMEOUT_MS * 6 : background || preview ? BACKGROUND_MS : TIMEOUT_MS;
    const timer = window.setTimeout(() => this.cutOff(id, limit), limit);
    this.pending.set(id, { key, resolve, timer, background, preview });
    this.ensure().postMessage({ id, req: key } satisfies SymWorkerIn);
  }

  /** Enter on a preview the worker is already working out: it now gets the full limit. */
  private promoteSent(key: string): void {
    for (const [id, p] of this.pending) {
      if (p.key !== key || !p.preview) continue;
      clearTimeout(p.timer);
      p.preview = false;
      p.timer = window.setTimeout(() => this.cutOff(id, TIMEOUT_MS), TIMEOUT_MS);
    }
  }

  /** A newer preview replaces the one waiting (that one is answered "superseded"); it's sent after a pause. */
  private queuePreview(q: { id: number; key: string; resolve: (r: SymResult) => void }): void {
    this.previewNext?.resolve({ ok: false, error: 'superseded' } as SymResult);
    this.previewNext = q;
    clearTimeout(this.previewTimer);
    this.previewDue = performance.now() + PREVIEW_PAUSE_MS;
    this.previewTimer = window.setTimeout(() => this.drain(), PREVIEW_PAUSE_MS);
  }

  private promotePreview(): void {
    const q = this.previewNext!;
    this.previewNext = null;
    clearTimeout(this.previewTimer);
    this.previewDue = 0;
    this.send(q.id, q.key, q.resolve, false);
  }

  /**
   * Background work goes to the worker one piece at a time, and only while nothing else is waiting on it: report
   * sections first, then the latest preview once typing has paused.
   */
  private drain(): void {
    if (this.pending.size) return;
    const q = this.queued.shift();
    if (q) return this.send(q.id, q.key, q.resolve, true);
    if (this.previewNext && !this.previewTimerRunning()) {
      const p = this.previewNext;
      this.previewNext = null;
      this.send(p.id, p.key, p.resolve, false, true);
    }
  }

  private previewTimerRunning(): boolean {
    return this.previewDue > performance.now() + 2;
  }

  /** One request ran too long: restart the worker, answer that request, and send the others to the new one. */
  private cutOff(id: number, limit: number): void {
    const stuck = this.pending.get(id);
    if (!stuck) return;
    this.pending.delete(id);
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    const others = [...this.pending.entries()];
    this.pending.clear();
    for (const [, p] of others) clearTimeout(p.timer);
    stuck.resolve({
      ok: false,
      error: stuck.background ? 'This part took too long to work out' : `Stopped after ${limit / 1000} s without an answer. Try a simpler form, or a definite integral for a numeric value.`,
    } as SymResult);
    for (const [oid, p] of others) this.send(oid, p.key, p.resolve, p.background, p.preview);
    this.drain();
  }
}
