import { createSession, type Session } from '@lemma/math-core';
import { outcomeToJSON, Runtime, type Outcome, type RouteOptions } from '@lemma/runtime';
import { loadPlugins, PluginHost } from './plugins/host';
import { SymbolicClient } from './symbolic/client';

/**
 * The web app's instance of the shared runtime (packages/runtime). The SymPy backend is a web worker here;
 * everything else (routing, lazy engine chunks) lives in the runtime package so every Lemma surface agrees.
 */
export type { Outcome, RouteOptions };

const symbolic = new SymbolicClient();
export const runtime = new Runtime({ symbolic });

// Installed extensions answer before the built-in engines. A sandboxed script may ask Lemma to compute
// something; it gets a fresh session each time, so it never sees the user's variables or history.
export const plugins = new PluginHost(loadPlugins(), async (query) => outcomeToJSON(await runtime.compute(query, createSession()), query));
runtime.hooks.push(plugins);

export const route = (input: string, session: Session, opts: RouteOptions): Outcome => runtime.route(input, session, opts);
export const loadUnits = () => runtime.loadUnits();
export const loadEveryday = () => runtime.loadEveryday();
export function loadAdvanced(onStatus?: (s: string, stage?: [number, number]) => void) {
  if (onStatus) symbolic.onStatus = onStatus;
  return runtime.loadAdvanced();
}
export const unitLabel = (...a: Parameters<Runtime['unitLabel']>) => runtime.unitLabel(...a);
export const symbolicClient = () => symbolic;
