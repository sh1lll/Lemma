/// <reference lib="webworker" />
// SymPy in Pyodide, off the main thread. Loaded on the first symbolic question; cached for offline use after that.
import { PYODIDE_INDEX, PYTHON_SOURCE } from '@lemma/symbolic-engine';

export type SymWorkerIn = { id: number; req: string } | { warm: true };
/** `stage`: [from, to] of the whole load (0–1) this step covers, for a progress bar. */
export type SymWorkerOut = { id: number; result: string } | { status: string; stage?: [number, number] } | { ready: true } | { fatal: string };

const post = (m: SymWorkerOut) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

type Handle = (req: string) => string;
let ready: Promise<Handle> | null = null;

function init(): Promise<Handle> {
  ready ??= (async () => {
    post({ status: 'Downloading the algebra engine (one time, about 12 MB)…', stage: [0.02, 0.5] });
    const mod = (await import(/* @vite-ignore */ `${PYODIDE_INDEX}pyodide.mjs`)) as { loadPyodide: (o: { indexURL: string }) => Promise<Py> };
    const py = await mod.loadPyodide({ indexURL: PYODIDE_INDEX });
    post({ status: 'Starting the algebra engine…', stage: [0.5, 0.88] });
    await py.loadPackage('sympy');
    py.runPython(PYTHON_SOURCE);
    const handle = py.globals.get('handle') as Handle;
    post({ status: 'Warming up…', stage: [0.88, 0.98] });
    handle(JSON.stringify({ op: 'diff', exprs: ["Symbol('x')**2"], vars: ['x'], label: '' }));
    post({ ready: true });
    return handle;
  })();
  ready.catch((e) => {
    ready = null;
    post({ fatal: e instanceof Error ? e.message : String(e) });
  });
  return ready;
}

interface Py {
  loadPackage(name: string): Promise<void>;
  runPython(src: string): unknown;
  globals: { get(name: string): unknown };
}

self.onmessage = async (e: MessageEvent<SymWorkerIn>) => {
  const m = e.data;
  if ('warm' in m) {
    init().catch(() => {});
    return;
  }
  try {
    const handle = await init();
    post({ id: m.id, result: handle(m.req) });
  } catch (err) {
    post({ id: m.id, result: JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }) });
  }
};
