import type { AnswerResult, CalcResult } from '@lemma/math-core';
import type { ToolSpec } from './types';

/**
 * What a tool hands back to the model and the UI: compact, JSON-able, and carrying the engine's own
 * provenance (verification, exactness, data source) so the model can repeat it honestly.
 */
export interface ToolResult {
  ok: boolean;
  /** Human display, e.g. "$1,520.06" or "x = 2, x = 3". */
  display: string;
  /** Machine-readable value to quote or reuse in a later query, e.g. "1520.06". */
  plain: string;
  /** What the engine understood, stated explicitly. */
  expression: string;
  notes: string[];
  /** Labelled detail rows ("Total interest  $247,220.13"). */
  lines?: { label: string; display: string }[];
  verified?: { ok: boolean; how: string };
  exactness?: 'exact' | 'approximate' | 'numeric';
  source?: { name: string; url: string; asOf: string; stale?: boolean };
  /** Present when ok is false: why the engine could not answer (often a request for missing input). */
  error?: string;
  /** Engine id ("calc", "loan", "date", "graph", …). */
  kind?: string;
}

/** Runs a tool call on the host. Must not throw for ordinary failures: return `{ ok: false, error }`. */
export type ToolExecutor = (name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolResult>;

export const COMPUTE_TOOL: ToolSpec = {
  name: 'compute',
  description: [
    "Run ONE calculation through Lemma's deterministic engines and get the exact result. This is the only way to obtain any number: never calculate, estimate, round or convert in your head.",
    'Write `query` the way a person types into a calculator, in plain English or math notation. One calculation per call. To chain steps, copy the previous result\'s `plain` value into the next query literally (e.g. "1520.06 * 360"). Several independent calls may be made in parallel.',
    'If a result has ok:false, read `error`: rephrase the query using the examples below, or ask the user for the missing input. Do not substitute your own arithmetic.',
    'Accepted phrasings, by domain:',
    '- Arithmetic: "12000 + 450", "20% of 450", "15% off 80", "80 plus 15 percent", "2 to the power of 8", "sqrt 2", "sin(30)" (degrees by default), "log(1000)", "7 mod 3", "1/3 + 1/6", "6/2(1+2)", "5 squared plus 3 cubed". Define and reuse: "f(x) = x^2 + 1" then "2f(2) + 1".',
    '- Units: "50 miles to km", "100 c to f", "10 kg to lb, oz", "60 mph to km/h", "2500 sq ft to m2", "3 cups to ml", "1 gib in mib", "180 degrees to radians".',
    '- Dates and time zones: "90 days from today", "days between 2024-02-01 and 2024-03-01", "10 business days from today", "how long from 9:15am to 5:40pm", "3pm new york to london", "what time is it in sydney", "how old is someone born on may 14 1990", "is 2028 a leap year", "days until christmas", "jan 31 2027 + 1 month".',
    '- Finance and shopping: "monthly payment on a $300,000 loan at 4.5% over 30 years", "mortgage on $400k house with 20% down at 6.5% for 30 years", "$10,000 at 5% compounded monthly for 10 years", "invest 1000 at 7% for 30 years adding 200 a month compounded monthly", "18% tip on $64.50", "tip 20% on 120 split 4 ways", "8.25% tax on $49.99", "cagr from 1000 to 2500 over 5 years", "irr of -1000, 300, 400, 500", "apy of 5% compounded daily", "margin if cost is 40 and price is 60", "which is cheaper: 12 eggs for $3.99 or 18 eggs for $5.49".',
    '- Currency (live rates with source and date): "100 dollars to eur", "100 usd to eur, gbp and jpy". Never supply an exchange rate yourself.',
    '- Statistics and probability: "mean of 3, 5, 7, 10", "median of 5, 1, 9, 3", "std dev of 2 4 4 4 5 5 7 9", "summary of 2 4 4 4 5 5 7 9", "quartiles of 6, 7, 15, 36, 39", "30th percentile of 1, 3, 2, 4", "line of best fit (1,3), (2,5), (3,7), (4,9)", "probability of exactly 3 heads in 10 flips", "binomial n=10 p=0.5 k=3", "P(Z < 1.96)", "at least 7 successes in 10 trials with p=0.6".',
    '- Science: "molar mass of H2O", "balance Fe + O2 -> Fe2O3", "pH of 0.001 M HCl", "volume of 2 mol gas at 25 °C and 1 atm", "speed of light", "value of G", "kinetic energy of 2 kg at 3 m/s", "weight of 70 kg", "area of circle radius 5 cm", "volume of cube side 3 m", "triangle a=7 b=10 A=30", "255 in hex", "0xff in decimal", "42 in binary".',
    '- Symbolic (exact, via SymPy): "solve x^2 - 5x + 6 = 0", "solve x + y = 3, x - y = 1", "solve x^2 < 4", "derivative of x^2 + 3x", "d/dx x^3", "integrate x^2*e^x", "integrate x^2 from 0 to 3", "limit of sin(x)/x as x -> 0", "maclaurin series of sin(x)", "expand (x+1)^3", "factor x^2 - 5x + 6", "partial fractions of 1/(x^2-1)", "determinant of [[1,2],[3,4]]", "inverse of [[1,2],[3,4]]", "eigenvalues of [[2,0],[0,3]]", "laplace transform of t^2", "(2+3i)*(1-i)".',
    '- Number theory: "is 97 prime", "prime factorization of 360", "factor 1001", "divisors of 28", "next prime after 100", "100th prime", "primes between 10 and 30".',
    'Results may include `verified` (independently checked), `exactness` (exact / approximate / numeric), `source` (data provider and as-of time) and `notes` (assumptions the engine made). Pass these on to the user.',
  ].join('\n'),
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'One calculation in Lemma phrasing, e.g. "20% of 450" or "solve x^2 - 5x + 6 = 0".' },
    },
    required: ['query'],
    additionalProperties: false,
  },
};

export const GRAPH_TOOL: ToolSpec = {
  name: 'graph',
  description: [
    'Show the user an interactive graph. The app plots it and reports roots, extrema and intersections it found.',
    'Each expression is one curve or relation: "x^2 - 4", "sin(x)", "y = 2x + 1", "x^2 + y^2 = 25", "y > x^2", "r = 1 + cos θ". Use only when a picture helps or the user asks for one.',
  ].join('\n'),
  parameters: {
    type: 'object',
    properties: {
      expressions: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 6, description: 'Curves to plot together.' },
    },
    required: ['expressions'],
    additionalProperties: false,
  },
};

export const LEMMA_TOOLS: ToolSpec[] = [COMPUTE_TOOL, GRAPH_TOOL];

/** Checks arguments against the tool schemas. Returns an error message, or null when valid. */
export function validateToolArgs(name: string, args: Record<string, unknown>): string | null {
  if (name === 'compute') {
    if (typeof args.query !== 'string' || !args.query.trim()) return 'compute needs a non-empty string "query".';
    return null;
  }
  if (name === 'graph') {
    const e = args.expressions;
    if (!Array.isArray(e) || !e.length || !e.every((x) => typeof x === 'string' && x.trim())) return 'graph needs "expressions": a non-empty array of strings.';
    return null;
  }
  if (name === 'read_notebook' || name === 'propose_cell') return validateNotebookArgs(name, args);
  return `Unknown tool "${name}". Available tools: compute, graph.`;
}

/** Longest cell the assistant may propose. */
export const MAX_PROPOSAL = 4000;

/** Checks propose_cell / read_notebook arguments. Null when valid. */
function validateNotebookArgs(name: string, args: Record<string, unknown>): string | null {
  if (name === 'read_notebook') {
    if (args.cell !== undefined && !(Number.isInteger(args.cell) && (args.cell as number) >= 1)) return 'read_notebook: "cell" must be a 1-based integer.';
    return null;
  }
  if (name === 'propose_cell') {
    if (args.type !== 'math' && args.type !== 'text') return 'propose_cell: "type" must be "math" or "text".';
    if (typeof args.source !== 'string' || !args.source.trim()) return 'propose_cell needs a non-empty "source".';
    if (args.source.length > MAX_PROPOSAL) return `propose_cell: "source" is limited to ${MAX_PROPOSAL} characters.`;
    if (args.after !== undefined && !(Number.isInteger(args.after) && (args.after as number) >= 0)) return 'propose_cell: "after" must be a cell number.';
    if (args.reason !== undefined && typeof args.reason !== 'string') return 'propose_cell: "reason" must be text.';
    return null;
  }
  return `Unknown tool "${name}".`;
}


/** Serialises a ToolResult for the model (compact JSON, no undefined fields). */
export function toolResultToModelText(r: ToolResult): string {
  return JSON.stringify(r);
}

export function failureResult(error: string, expression = '', kind?: string): ToolResult {
  return { ok: false, display: '', plain: '', expression, notes: [], error, ...(kind ? { kind } : {}) };
}

/** Converts an engine Answer (or AnswerFailure) to a ToolResult. */
export function answerToToolResult(a: AnswerResult): ToolResult {
  if (!a.ok) return failureResult(a.error.message, a.input, a.kind);
  const r: ToolResult = {
    ok: true,
    kind: a.kind,
    display: a.primary.unit && !a.primary.display.includes(a.primary.unit) ? `${a.primary.display} ${a.primary.unit}` : a.primary.display,
    plain: a.primary.plain,
    expression: a.expression,
    notes: a.notes,
  };
  if (a.lines?.length) r.lines = a.lines.slice(0, 12);
  if (a.table) {
    const t = a.table;
    const rows = t.rows.slice(0, 8).map((row) => ({ label: row[0] ?? '', display: row.slice(1).join(' · ') }));
    r.lines = [...(r.lines ?? []), { label: t.caption ?? t.columns.join(' · '), display: '' }, ...rows].slice(0, 20);
    if (t.rows.length > 8) r.notes = [...r.notes, `Table truncated: ${t.rows.length} rows, first 8 shown.`];
  }
  if (a.verified) r.verified = a.verified;
  if (a.exactness) r.exactness = a.exactness;
  if (a.source) r.source = a.source;
  return r;
}

/** Converts a core-calculator result to a ToolResult. */
export function calcToToolResult(c: CalcResult): ToolResult {
  if (!c.ok) return failureResult(c.error.message, c.input, 'calc');
  const notes = [...c.notes];
  if (c.fraction) notes.push(`Exact fraction: ${c.fraction}`);
  for (const alt of c.alternatives) notes.push(`Ambiguous: read as ${alt.label} (${alt.expression}) it would be ${alt.formatted.display}.`);
  return {
    ok: true,
    kind: 'calc',
    display: c.formatted.display,
    plain: c.formatted.plain,
    expression: c.expression,
    notes,
    exactness: c.approximate ? 'approximate' : 'exact',
  };
}

/**
 * Structural mirror of the app router's `Outcome` (apps/web/src/engine.ts) so this package does not
 * import from the app. Any object with these shapes works.
 */
export type OutcomeLike =
  | { kind: 'empty' }
  | { kind: 'calc'; result: CalcResult }
  | {
      kind: 'convert';
      result: { ok: true; input: string; expression: string; results: { unit: { symbol: string }; formatted: { display: string; plain: string; rounded?: boolean } }[]; notes: string[] };
    }
  | { kind: 'answer'; result: AnswerResult }
  | { kind: 'graph'; input: string; spec?: { notes?: string[] } }
  | { kind: 'error'; error: { message: string } }
  | { kind: 'pending'; waitFor: Promise<unknown> };

/** Converts a router Outcome to a ToolResult. `pending` becomes a failure; use {@link resolveOutcome} to wait instead. */
export function outcomeToToolResult(o: OutcomeLike, input = ''): ToolResult {
  switch (o.kind) {
    case 'empty':
      return failureResult('Empty query.', input);
    case 'calc':
      return calcToToolResult(o.result);
    case 'answer':
      return answerToToolResult(o.result);
    case 'convert': {
      const r = o.result;
      const shown = r.results.map((x) => `${x.formatted.display} ${x.unit.symbol}`);
      return {
        ok: true,
        kind: 'convert',
        display: shown.join(', '),
        plain: r.results.map((x) => `${x.formatted.plain} ${x.unit.symbol}`).join(', '),
        expression: r.expression,
        notes: r.notes,
        exactness: r.results.some((x) => x.formatted.rounded) ? 'approximate' : 'exact',
      };
    }
    case 'graph':
      return { ok: true, kind: 'graph', display: 'Graph shown to the user.', plain: '', expression: o.input, notes: o.spec?.notes ?? [] };
    case 'error':
      return failureResult(o.error.message, input);
    case 'pending':
      return failureResult('The engine for this query is still loading. Try the same query again.', input);
  }
}

/**
 * Runs a router call, waiting on `pending` outcomes (lazy-loaded engines, exchange-rate fetches, SymPy)
 * and re-running until a final outcome. Errors from the wait become ok:false results.
 */
export async function resolveOutcome(run: () => OutcomeLike, input = '', opts: { maxWaits?: number; signal?: AbortSignal } = {}): Promise<ToolResult> {
  const maxWaits = opts.maxWaits ?? 4;
  for (let i = 0; ; i++) {
    let o: OutcomeLike;
    try {
      o = run();
    } catch (e) {
      return failureResult(e instanceof Error ? e.message : String(e), input);
    }
    if (o.kind !== 'pending') return outcomeToToolResult(o, input);
    if (i >= maxWaits || opts.signal?.aborted) return outcomeToToolResult(o, input);
    try {
      const settled = await o.waitFor;
      // Some engines (SymPy) resolve the pending promise with the final AnswerResult itself.
      if (isAnswerResult(settled)) return answerToToolResult(settled);
    } catch (e) {
      return failureResult(e instanceof Error ? e.message : String(e), input);
    }
  }
}

function isAnswerResult(v: unknown): v is AnswerResult {
  return (
    typeof v === 'object' &&
    v !== null &&
    'ok' in v &&
    'kind' in v &&
    'input' in v &&
    ((v as { ok: unknown }).ok === false ? 'error' in v : 'primary' in v && 'expression' in v)
  );
}
