import { createSession, type Session } from '@lemma/math-core';
import { outcomeToJSON, type OutcomeJSON, type RatesSnapshot, type Runtime } from '@lemma/runtime';
import { createNodeRuntime } from '@lemma/runtime/src/node';

/**
 * Lemma for developers. The same deterministic engines as the apps, as a library:
 *
 *   import { createLemma } from '@lemma/sdk';
 *   const om = await createLemma();
 *   (await om.compute('monthly payment on $300k at 6% for 30 years')).display  // "$1,798.65"
 *
 * Results are plain JSON (OutcomeJSON) with exact decimal values as strings. A client keeps a session, so
 * follow-ups ("add that to the original number"), variables and formulas work across calls.
 */
export type { OutcomeJSON };

export interface LemmaOptions {
  /** Fetch ECB exchange rates for currency questions (default true). Set false for fully offline use. */
  liveRates?: boolean;
  /** Significant digits in `display` (default 12). */
  digits?: number;
  angle?: 'deg' | 'rad';
  onStatus?: (s: string) => void;
}

export interface Lemma {
  compute(query: string): Promise<OutcomeJSON>;
  /** Start a fresh context (forget answers, variables and formulas). */
  reset(): void;
  readonly session: Session;
  readonly runtime: Runtime;
}

export async function createLemma(opts: LemmaOptions = {}): Promise<Lemma> {
  const runtime = await createNodeRuntime({ onStatus: opts.onStatus });
  let session = createSession();
  session.angle = opts.angle ?? 'deg';
  let rates: RatesSnapshot | null = null;
  let fetching: Promise<RatesSnapshot> | null = null;
  const routeOpts = {
    format: { digits: opts.digits ?? 12 },
    liveRates: opts.liveRates ?? true,
    rates: () => rates,
    requestRates: () =>
      (fetching ??= import('@lemma/currency-engine').then((c) => c.fetchRates()).then((r) => (rates = r)).finally(() => (fetching = null))),
  };
  const { commit } = await import('@lemma/math-core');
  return {
    runtime,
    get session() {
      return session;
    },
    reset() {
      session = createSession();
      session.angle = opts.angle ?? 'deg';
    },
    async compute(query: string) {
      const o = await runtime.compute(query, session, routeOpts);
      // Commit like the apps do, so follow-ups and variables work across calls.
      if (o.kind === 'calc') commit(session, o.result);
      else if (o.kind === 'convert') session.ans = o.result.results[0]!.value;
      else if (o.kind === 'answer' && o.result.value) session.ans = session.base = o.result.value;
      return outcomeToJSON(o, query);
    },
  };
}
