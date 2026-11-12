// Monte Carlo simulations from the main input ("simulate 10000: sum of 2 dice >= 10"), as one lazy chunk.
// The notebook runs the same engine in a Worker; here runs are capped so a typed line never stalls the page.
import { D, MathError, type Answer } from '@lemma/math-core';
import { asFraction, parseSimulateLine, runSimulation, SimError } from '@lemma/notebook-engine';

/** Above this the notebook (which runs simulations off the main thread) is the place for it. */
export const INPUT_MAX_TRIALS = 200_000;

const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toPrecision(4).replace(/\.?0+$/, ''));

export function answerSimulation(input: string): Answer | { ok: false; error: MathError } {
  // "simulate 5000 rolling…" without a colon reads the same as with one.
  const line = input.includes(':') ? input : input.replace(/^(\s*simulate(?:\s+\d[\d,_]*(?:\.\d+)?\s*[km]?)?(?:\s*(?:trials|times|runs|samples))?(?:\s*seed\s*=?\s*\d+)?)\s+/i, '$1: ');
  try {
    const req = parseSimulateLine(line);
    if (req.trials > INPUT_MAX_TRIALS)
      throw new SimError(`Up to ${INPUT_MAX_TRIALS.toLocaleString('en-US')} trials here. Bigger runs work in a notebook, where they run in the background.`);
    const s = runSimulation(req);
    const pct = s.mode === 'probability';
    const show = (x: number) => (pct ? `${fmt(x * 100)}%` : fmt(x));
    const lines = [
      { label: '95% interval', display: `${show(s.lo)} to ${show(s.hi)}` },
      { label: 'Trials', display: s.trials.toLocaleString('en-US') + (s.hits !== undefined ? ` (${s.hits.toLocaleString('en-US')} hits)` : '') },
    ];
    if (s.exact) lines.push({ label: 'Exact', display: `${s.exact.fraction ? `${s.exact.fraction} = ` : ''}${show(s.exact.value)}${s.exact.withinCI ? ' ✓ inside the interval' : ' (outside the interval)'}` });
    const notes = [`Seed ${s.seed}${req.seedGiven ? '' : ' (from the text, so this line always gives the same result; add “seed N” to change it)'}`];
    if (s.exact) notes.push(s.exact.how);
    else if (s.exactNote) notes.push(s.exactNote);
    const frac = pct ? asFraction(s.estimate, 1000) : undefined;
    return {
      ok: true,
      kind: 'simulation',
      input,
      expression: `${pct ? 'Probability' : 'Mean'} of ${s.program} · ${s.trials.toLocaleString('en-US')} trials`,
      primary: { display: show(s.estimate), plain: show(s.estimate), spoken: `about ${show(s.estimate)}${frac ? `, roughly ${frac}` : ''}` },
      value: new D(s.estimate),
      lines,
      notes,
      exactness: 'approximate',
    };
  } catch (e) {
    if (!(e instanceof SimError)) throw e;
    return { ok: false, error: new MathError('syntax', e.message) };
  }
}
