import { PYTHON_SOURCE, type SymResult } from '@lemma/symbolic-engine';
import { cachingBackend, Runtime, type RuntimeOptions } from './router';

/**
 * Runtime for Node (SDK, CLI, servers): every engine loaded eagerly, SymPy run in-process via Pyodide when the
 * optional `pyodide` package is installed. Without it, symbolic questions return a clear error.
 */
export async function createNodeRuntime(opts: RuntimeOptions & { symbolic?: never } = {}): Promise<Runtime> {
  let handle: ((req: string) => string) | null = null;
  let loading: Promise<(req: string) => string> | null = null;
  const loadPy = () =>
    (loading ??= (async () => {
      const mod = (await import(/* @vite-ignore */ 'pyodide' as string).catch(() => null)) as { loadPyodide(o?: object): Promise<Py> } | null;
      if (!mod) throw new Error('Symbolic algebra needs the optional "pyodide" package (npm install pyodide)');
      opts.onStatus?.('Loading SymPy (first symbolic question only)…');
      // Keep Pyodide's own progress lines off stdout (it would corrupt --json and piped output).
      const quiet = () => {};
      const py = await mod.loadPyodide({ stdout: quiet, stderr: quiet });
      await py.loadPackage('sympy', { messageCallback: quiet, errorCallback: quiet });
      py.runPython(PYTHON_SOURCE);
      handle = py.globals.get('handle') as (req: string) => string;
      opts.onStatus?.('');
      return handle;
    })());
  const symbolic = cachingBackend(async (req) => {
    try {
      const h = handle ?? (await loadPy());
      return JSON.parse(h(JSON.stringify(req))) as SymResult;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  const rt = new Runtime({ ...opts, symbolic });
  await rt.loadAll();
  return rt;
}

interface Py {
  loadPackage(name: string, o?: object): Promise<void>;
  runPython(src: string): unknown;
  globals: { get(name: string): unknown };
}
