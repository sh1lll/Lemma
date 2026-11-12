import { MathError, type Session } from '@lemma/math-core';
import { compileTemplate, matchPlugin, runFormula, scriptResultToAnswer, validateManifest, type CompiledTemplate, type PluginManifest } from '@lemma/plugin-engine';
import type { IntentHook, Outcome } from '@lemma/runtime';
import { Sandbox, type ComputeFn } from './sandbox';

/** Installed extensions, persisted locally. */
export interface InstalledPlugin {
  manifest: PluginManifest;
  enabled: boolean;
  installedAt: number;
  /** Network hosts the user approved at install time (subset of the manifest's permissions). */
  granted: string[];
}

const KEY = 'lemma.plugins.v1';

export function loadPlugins(): InstalledPlugin[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as InstalledPlugin[];
    // Re-validate on every load: storage is not trusted either.
    return raw.flatMap((p) => {
      try {
        return [{ ...p, manifest: validateManifest(p.manifest) }];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

export function savePlugins(list: InstalledPlugin[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Without storage, extensions last for this session.
  }
}

/**
 * Routes input to enabled extensions before the built-in engines. Formula extensions answer synchronously;
 * script extensions return `pending` while their sandbox runs, and the result is cached for the re-run.
 */
export class PluginHost implements IntentHook {
  private compiled = new Map<string, CompiledTemplate[]>();
  private sandboxes = new Map<string, Sandbox>();
  private results = new Map<string, Outcome>();
  constructor(
    public plugins: InstalledPlugin[],
    private compute: ComputeFn,
  ) {}

  update(plugins: InstalledPlugin[]): void {
    this.plugins = plugins;
    this.compiled.clear();
    this.results.clear();
    for (const [id, s] of this.sandboxes) {
      if (!plugins.some((p) => p.manifest.id === id && p.enabled)) {
        s.destroy();
        this.sandboxes.delete(id);
      }
    }
  }

  route(input: string, _session: Session): Outcome | null {
    for (const p of this.plugins) {
      if (!p.enabled) continue;
      const m = p.manifest;
      let compiled = this.compiled.get(m.id);
      if (!compiled) {
        const text = new Set(m.inputs.filter((i) => i.type === 'text').map((i) => i.name));
        compiled = m.templates.map((t) => compileTemplate(t, text));
        this.compiled.set(m.id, compiled);
      }
      const match = matchPlugin(m, input, compiled);
      if (!match) continue;
      if (m.kind === 'formula') {
        const r = runFormula(m, match, input);
        return r.ok ? { kind: 'answer', result: r } : { kind: 'error', error: r.error };
      }
      const key = `${m.id}\u0000${input}`;
      const done = this.results.get(key);
      if (done) return done;
      let box = this.sandboxes.get(m.id);
      if (!box) {
        box = new Sandbox(m, p.granted, this.compute);
        this.sandboxes.set(m.id, box);
      }
      const waitFor = box.run(match.values).then(
        (raw) => {
          const a = scriptResultToAnswer(m, input, raw);
          this.remember(key, a.ok ? { kind: 'answer', result: a } : { kind: 'error', error: a.error });
        },
        (e: unknown) => this.remember(key, { kind: 'error', error: new MathError('domain', e instanceof Error ? e.message : String(e)) }),
      );
      return { kind: 'pending', waitFor };
    }
    return null;
  }

  private remember(key: string, o: Outcome): void {
    if (this.results.size > 200) this.results.delete(this.results.keys().next().value!);
    this.results.set(key, o);
  }
}
