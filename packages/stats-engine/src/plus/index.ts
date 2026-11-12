import { MathError, type AnswerResult } from '@lemma/math-core';
import { HANDLERS as DISTS } from './dists';
import { GATE_STATS_PLUS } from './gate';
import { HANDLERS as ML } from './ml';
import { HANDLERS as MODELS } from './models';
import { HANDLERS as TESTS } from './tests';
import { KIND, prepare, type PHandler } from './util';

// Order matters: the most specific vocabularies first (ML metrics, then models, then tests, then distributions).
const HANDLERS: PHandler[] = [...ML, ...MODELS, ...TESTS, ...DISTS];

export { GATE_STATS_PLUS };

/**
 * Advanced statistics, probability, econometrics and ML math. Returns null when the input is not one of these
 * questions, so the caller can fall through to the basic statistics engine and the calculator.
 */
export function answerStatsPlus(input: string): AnswerResult | null {
  if (!GATE_STATS_PLUS(input)) return null;
  const c = prepare(input);
  for (const h of HANDLERS) {
    c.rest = c.s;
    try {
      const r = h(c);
      if (r) return r;
    } catch (e) {
      return { ok: false, kind: KIND, input, error: e instanceof MathError ? e : new MathError('domain', e instanceof Error ? e.message : String(e)) };
    }
  }
  return null;
}
