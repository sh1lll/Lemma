import type { Outcome } from './router';

/**
 * A stable, JSON-friendly view of any Outcome: the public result format of the SDK, CLI and (later) the
 * extension and HTTP API. Decimal values become strings so no precision is lost.
 */
export interface OutcomeJSON {
  ok: boolean;
  kind: 'calc' | 'convert' | 'answer' | 'graph' | 'error' | 'empty' | 'pending';
  input: string;
  /** What was understood, e.g. "20% of 450 + 30". */
  expression?: string;
  /** Formatted result as shown to people. */
  display?: string;
  /** Machine form: "12450", "1.5e15", "2*x + 3". */
  plain?: string;
  /** Exact decimal value as a string, when the result is a number. */
  value?: string;
  unit?: string;
  exact?: boolean;
  verified?: { ok: boolean; how: string };
  lines?: { label: string; display: string }[];
  notes?: string[];
  alternatives?: { label: string; expression: string; display: string }[];
  source?: { name: string; url: string; asOf: string; stale?: boolean };
  error?: { code: string; message: string };
  /**
   * Something for the host app to do: start a timer, save a note, cancel. The runtime only
   * parses the request; carrying it out (and persisting it) is the host's job.
   */
  action?: { type: string; [k: string]: unknown };
}

export function outcomeToJSON(o: Outcome, input: string): OutcomeJSON {
  switch (o.kind) {
    case 'empty':
    case 'pending':
      return { ok: false, kind: o.kind, input };
    case 'error':
      return { ok: false, kind: 'error', input, error: { code: o.error.code, message: o.error.message } };
    case 'graph':
      return { ok: true, kind: 'graph', input, expression: o.spec.items.map((i) => i.label).join('; '), notes: o.spec.notes };
    case 'calc': {
      const r = o.result;
      return {
        ok: true,
        kind: 'calc',
        input,
        expression: r.expression,
        display: r.formatted.display,
        plain: r.formatted.plain,
        value: r.definition ? undefined : r.value.toString(),
        exact: !r.approximate,
        notes: [...(r.fraction ? [`= ${r.fraction}`] : []), ...r.notes],
        alternatives: r.alternatives.map((a) => ({ label: a.label, expression: a.expression, display: a.formatted.display })),
      };
    }
    case 'convert': {
      const f = o.result.results[0]!;
      return {
        ok: true,
        kind: 'convert',
        input,
        expression: o.result.expression,
        display: f.formatted.display,
        plain: f.formatted.plain,
        value: f.value.toString(),
        unit: f.unit.symbol,
        exact: !f.formatted.rounded,
        lines: o.result.results.slice(1).map((x) => ({ label: x.unit.symbol, display: x.formatted.display })),
        notes: o.result.notes,
      };
    }
    case 'answer': {
      const a = o.result;
      return {
        ok: true,
        kind: 'answer',
        input,
        expression: a.expression,
        display: a.primary.display,
        plain: a.primary.plain,
        value: a.value?.toString(),
        unit: a.primary.unit,
        exact: a.exactness ? a.exactness === 'exact' : undefined,
        verified: a.verified,
        lines: a.lines,
        notes: a.notes,
        source: a.source,
        action: a.action,
      };
    }
  }
}
