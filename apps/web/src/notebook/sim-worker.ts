import { runSimulation, type SimRequest, type SimulationSummary } from '@lemma/notebook-engine';

/** Runs Monte Carlo simulations off the main thread so a million trials never freezes typing. */
export type SimWorkerIn = { id: number; req: SimRequest };
export type SimWorkerOut = { id: number; ok: true; result: SimulationSummary } | { id: number; ok: false; error: string };

self.onmessage = (e: MessageEvent<SimWorkerIn>) => {
  const { id, req } = e.data;
  let out: SimWorkerOut;
  try {
    out = { id, ok: true, result: runSimulation(req) };
  } catch (err) {
    out = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  (self as unknown as Worker).postMessage(out);
};
