/**
 * "Load everything": gets every part of Lemma ready ahead of time, so nothing waits on a first use.
 * Each step is independent and best-effort; one that fails (offline, say) is reported and the rest carry on.
 * Normal use stays lazy: this only runs when asked, or at start-up when "Get everything ready when Lemma
 * opens" is on.
 */

export type StepId = 'engines' | 'algebra' | 'graphs' | 'study' | 'notebooks' | 'offline' | 'voice' | 'ai';

export interface Step {
  id: StepId;
  label: string;
  /** Shown next to the label (a size, or what it covers). */
  detail: string;
  /** Large optional downloads: off unless chosen. */
  optional?: boolean;
}

export const STEPS: Step[] = [
  { id: 'engines', label: 'Calculator engines', detail: 'units, dates, money, statistics, science' },
  { id: 'algebra', label: 'Algebra and calculus', detail: 'about 12 MB the first time' },
  { id: 'graphs', label: 'Graphs and math typesetting', detail: '2D, 3D, statistical plots' },
  { id: 'study', label: 'Tools', detail: 'practice, exam simulator, whiteboard, geometry, physics, lessons' },
  { id: 'notebooks', label: 'Notebooks, notes and the assistant', detail: '' },
  { id: 'offline', label: 'Offline copy of every file', detail: '' },
  { id: 'voice', label: 'On-device voice model', detail: 'about 40 MB', optional: true },
  { id: 'ai', label: 'On-device AI model', detail: 'about 570 MB', optional: true },
];

export type StepState = 'waiting' | 'running' | 'done' | 'failed' | 'skipped';

export interface WarmHost {
  /** The algebra engine (SymPy in a worker); resolves once Python is up and SymPy imported. */
  warmAlgebra(): Promise<void>;
  warmEngines(): Promise<void>;
  warmVoice(): Promise<void>;
  warmAi(): Promise<void>;
  /**
   * Resolves true once a service worker controls the page, so fetched files are kept for offline use; otherwise the
   * reason there's nothing to do (the desktop app's files are already on the device; no service worker here).
   */
  offlineReady(): Promise<true | string>;
}

const quiet = <T>(p: Promise<T>) => p.then(() => undefined);

/** Every lazily loaded part of the interface. Kept in one place so a new tool is easy to add. */
const MODULES: Record<'graphs' | 'study' | 'notebooks', (() => Promise<unknown>)[]> = {
  graphs: [() => import('./graph/view'), () => import('./graph/plot'), () => import('./graph/surface'), () => import('./math-render')],
  study: [
    () => import('./study'),
    () => import('./study/practice'),
    () => import('./study/test'),
    () => import('./study/lecture'),
    () => import('./study/videos'),
    () => import('./exam'),
    () => import('./whiteboard/open'),
    () => import('./geometry/geometry'),
    () => import('./physics/lab'),
    () => import('./agenda'),
    () => import('./lesson'),
    () => import('@lemma/practice-engine'),
    () => import('@lemma/tutor-engine'),
    () => import('@lemma/exam-engine'),
  ],
  notebooks: [() => import('./notebook/view'), () => import('./notebook/runtime'), () => import('./notes'), () => import('./assistant/controller'), () => import('./plugins/manager')],
};

/** Fetches every build file so the service worker stores it; a few at a time, so the page stays responsive. */
async function cacheAll(onProgress: (done: number, total: number) => void): Promise<void> {
  const res = await fetch('/asset-manifest.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('No file list in this build');
  const { files } = (await res.json()) as { files: string[] };
  let done = 0;
  const queue = [...files];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      // Already kept from an earlier run: nothing to do. A file that fails is skipped; it's cached on first use.
      const have = typeof caches !== 'undefined' && (await caches.match(f).catch(() => undefined));
      if (!have) await fetch(f).then((r) => r.blob(), () => undefined);
      onProgress(++done, files.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}

const KEY = 'lemma.warmed.v1';
/** When everything was last loaded on this device (for the "ready" line in Settings). */
export function lastWarmed(): number | null {
  try {
    return Number(localStorage.getItem(KEY)) || null;
  } catch {
    return null;
  }
}

let running: Promise<Record<StepId, StepState>> | null = null;

/** Runs the chosen steps; `onStep` reports each change. Calling it again while it runs joins the same run. */
export function loadEverything(
  host: WarmHost,
  opts: { voice?: boolean; ai?: boolean },
  onStep: (id: StepId, state: StepState, note?: string) => void = () => {},
): Promise<Record<StepId, StepState>> {
  running ??= (async () => {
    const out = {} as Record<StepId, StepState>;
    const run = async (id: StepId, work: () => Promise<void>) => {
      onStep(id, 'running');
      try {
        await work();
        out[id] = 'done';
        onStep(id, 'done');
      } catch (e) {
        out[id] = 'failed';
        onStep(id, 'failed', e instanceof Error ? e.message : String(e));
      }
    };
    const modules = (k: keyof typeof MODULES) => () => Promise.all(MODULES[k].map((f) => f())).then(() => undefined);
    // Small, quick parts first and side by side; Python starts at the same time since it takes longest.
    await Promise.all([
      run('engines', host.warmEngines),
      run('algebra', host.warmAlgebra),
      run('graphs', modules('graphs')),
      run('study', modules('study')),
      run('notebooks', modules('notebooks')),
    ]);
    const offline = await host.offlineReady().catch(() => 'Not available here');
    if (offline === true) await run('offline', () => cacheAll((d, t) => onStep('offline', 'running', `${d} of ${t} files`)));
    else (out.offline = 'skipped'), onStep('offline', 'skipped', offline);
    if (opts.voice) await run('voice', host.warmVoice);
    else (out.voice = 'skipped'), onStep('voice', 'skipped');
    if (opts.ai) await run('ai', host.warmAi);
    else (out.ai = 'skipped'), onStep('ai', 'skipped');
    if (!Object.values(out).includes('failed')) {
      try {
        localStorage.setItem(KEY, String(Date.now()));
      } catch {
        // Only for the "ready" line.
      }
    }
    return out;
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Loads a single Study tool's code (when its row is pointed at or focused), so opening it is instant. */
const prefetched = new Set<string>();
export function prefetchTool(id: string): void {
  if (prefetched.has(id)) return;
  prefetched.add(id);
  const load: Record<string, () => Promise<unknown>> = {
    practice: () => import('./study/practice'),
    test: () => import('./study/test'),
    lecture: () => import('./study/lecture'),
    videos: () => import('./study/videos'),
    video: () => import('./study/videos'),
    exam: () => import('./exam'),
    whiteboard: () => import('./whiteboard/open'),
    geometry: () => import('./geometry/geometry'),
    physics: () => import('./physics/lab'),
    agenda: () => import('./agenda'),
    notebooks: () => import('./notebook/view'),
  };
  void quiet(load[id]?.() ?? Promise.resolve()).catch(() => prefetched.delete(id));
}

/**
 * Typing something symbolic ("derivative of…", "integrate", "solve x^2…") starts the algebra engine right away,
 * so it's usually ready by the time Enter is pressed.
 */
export const LOOKS_SYMBOLIC = /\b(?:deriv\w*|differentiat\w*|d\/d[a-z]|integra\w*|antideriv\w*|limit|lim\b|series|taylor|maclaurin|simplify|expand|factor\w*|solve|roots?\b|zeros?\b|partial frac|laplace|eigen\w*|det\w*|inverse|rref|ode|dsolve)/i;
