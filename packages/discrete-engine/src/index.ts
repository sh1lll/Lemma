// Lemma discrete & applied mathematics engine: optimization/OR, graph theory, numerical methods, modeling,
// information & coding theory, cryptography, signal processing, quantum, chaos and assorted small topics.
// Pure TypeScript, deterministic, no DOM. Loaded lazily by the runtime router.
import { MathError, type AnswerResult } from '@lemma/math-core';
import { conceptHandlers } from './concepts';
import { cryptoHandlers } from './crypto';
import { graphTheory } from './graph';
import { infoHandlers } from './info';
import { miscHandlers } from './misc';
import { modelHandlers } from './models';
import { numericHandlers } from './numeric';
import { optHandlers, optimization } from './opt';
import { quantumHandlers } from './quantum';
import { signalHandlers } from './signal';
import { fail, Refusal, type Result } from './util';

export { LOOKS_LIKE_DISCRETE } from './detect';
export { graphSvg, parseGraph, type Graph } from './graph';
export { simplex, type LP } from './lp';

type Handler = (input: string) => Result;

const HANDLERS: Handler[] = [
  ...conceptHandlers,
  ...cryptoHandlers,
  ...infoHandlers,
  ...quantumHandlers,
  ...modelHandlers,
  ...miscHandlers,
  ...optHandlers,
  ...numericHandlers,
  ...signalHandlers,
  graphTheory,
  optimization,
];

/** Answers the input, or null when no handler recognises it. */
export function answerDiscrete(input: string): AnswerResult | null {
  const text = input.trim().replace(/[’‘]/g, "'");
  if (!text || text.length > 4000) return null;
  for (const h of HANDLERS) {
    try {
      const r = h(text);
      if (r) return r.ok ? { ...r, input } : { ...r, input };
    } catch (e) {
      if (e instanceof Refusal) return fail(input, 'discrete', e.message);
      if (e instanceof MathError) return fail(input, 'discrete', e.message);
      throw e;
    }
  }
  return null;
}
