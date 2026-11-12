import { commit, type Session } from '@lemma/math-core';
import type { RunResult, Runner } from '@lemma/notebook-engine';
import type { Outcome } from '../engine';

const QUICK_WAIT_MS = 400;

/**
 * Adapts the calculator's router to the notebook engine. Quick lazy loads are awaited; a slow one (the first
 * SymPy download) doesn't hold up the cells below: the line reports `pending` and `later` is told what to wait
 * for, so the host can re-evaluate when it lands.
 */
export function makeRunner(route: (q: string, s: Session) => Outcome, later: (p: Promise<unknown>) => void): Runner {
  return async (query, session, signal) => {
    let o = route(query, session);
    for (let i = 0; o.kind === 'pending' && i < 8; i++) {
      if (signal?.aborted) return { kind: 'error', input: query, error: 'Cancelled' };
      const waiting = o.waitFor;
      const quick = await Promise.race([
        waiting.then(
          () => true,
          (e: unknown) => e,
        ),
        new Promise((r) => setTimeout(() => r(false), QUICK_WAIT_MS)),
      ]);
      if (quick === false) {
        later(waiting);
        return { kind: 'pending', input: query, display: 'Loading the engine for this line…' };
      }
      if (quick !== true) return { kind: 'error', input: query, error: quick instanceof Error ? quick.message : String(quick) };
      o = route(query, session);
    }
    return toRunResult(o, query, session);
  };
}

function toRunResult(o: Outcome, input: string, session: Session): RunResult {
  switch (o.kind) {
    case 'empty':
      return { kind: 'value', input, display: '' };
    case 'pending':
      return { kind: 'error', input, error: 'Still loading; try again in a moment' };
    case 'error':
      return { kind: 'error', input, error: o.error.message };
    case 'graph':
      return { kind: 'graph', input, graph: o.input, notes: o.spec.notes };
    case 'calc': {
      const r = o.result;
      commit(session, r);
      return {
        kind: 'value',
        input,
        expression: r.definition ? r.expression : `${r.expression} =`,
        // A definition's result is the name it defines, shown as the binding chip.
        display: r.definition ? '' : r.formatted.display,
        plain: r.formatted.plain,
        value: r.definition ? undefined : r.value.toString(),
        notes: r.definition ? [] : [...(r.fraction ? [`= ${r.fraction}`] : []), ...r.notes],
        exactness: r.approximate ? 'approximate' : 'exact',
      };
    }
    case 'convert': {
      const f = o.result.results[0]!;
      session.ans = f.value;
      return {
        kind: 'answer',
        input,
        expression: o.result.expression,
        display: f.formatted.display,
        plain: f.formatted.plain,
        unit: f.unit.symbol,
        value: f.value.toString(),
        lines: o.result.results.slice(1).map((x) => ({ label: x.unit.symbol, display: x.formatted.display })),
        notes: o.result.notes,
      };
    }
    case 'answer': {
      const a = o.result;
      if (a.value) session.ans = a.value;
      return {
        kind: 'answer',
        input,
        expression: a.expression,
        display: a.primary.display,
        plain: a.primary.plain,
        unit: a.primary.unit,
        value: a.value?.toString(),
        symbolic: a.kind === 'symbolic' ? (a.symbolic ?? a.primary.display) : undefined,
        lines: a.lines,
        table: a.table,
        latex: a.math?.map((m) => m.latex),
        notes: [...a.notes, ...(a.source ? [`Source: ${a.source.name}, ${a.source.asOf}${a.source.stale ? ' (may be out of date)' : ''}`] : [])],
        verified: a.verified,
        exactness: a.exactness,
      };
    }
  }
}
