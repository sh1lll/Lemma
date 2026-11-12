import { MathError, type AnswerResult } from '@lemma/math-core';
import { chemistry } from './chemistry';
import { computing } from './computing';
import { engineering } from './engineering';
import { medical } from './medical';
import { ml } from './ml';
import { physicsB } from './modern';
import { physicsA } from './physics';
import { social } from './social';
import { makeCtx, type Handler } from './util';

export { MAYBE_APPLIED } from './check';
export { parsePoly, roots } from './engineering';
export { reaction } from './chemistry';

// Order: unmistakable syntax first (CIDR, two's complement, IEEE), then domains whose triggers are specific
// (clinical, ML), chemistry (reactions, Ka), engineering, physics, and social-science counts last.
const HANDLERS: Handler[] = [...computing, ...medical, ...ml, ...chemistry, ...engineering, ...physicsB, ...physicsA, ...social];

/**
 * Applied sciences: physics, chemistry, engineering, computing, AI/ML arithmetic, biology/medicine and social
 * science. Null when the input isn't one of these, so other engines get it.
 */
export function answerApplied(input: string): AnswerResult | null {
  if (input.length > 2000) return null;
  const c = makeCtx(input);
  if (!c.t) return null;
  for (const h of HANDLERS) {
    try {
      const r = h(c);
      if (r) return r;
    } catch (e) {
      return { ok: false, kind: 'applied', input, error: new MathError('domain', e instanceof Error ? e.message : String(e)) };
    }
  }
  return null;
}
