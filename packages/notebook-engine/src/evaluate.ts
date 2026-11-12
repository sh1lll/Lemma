import { calculate, createSession, D, defineFromSource, freeNames, type CalcResult, type Session } from '@lemma/math-core';
import { parseTable, type DataTable } from './data';
import { isSimulateLine, parseSimulateLine, runSimulation, SimError, type SimRequest, type SimulationSummary } from './simulate';
import type { CellOutput, Notebook, Runner } from './types';

/**
 * Evaluates a notebook top to bottom in one shared session, so names defined in a cell are visible below it.
 * Re-running from scratch on every change keeps results consistent with what's on the page (no stale state),
 * and is cheap: the engines are fast and symbolic results are cached by the host.
 *
 * Cross-engine bindings: `name = <any query>` and `name(x) = <any query>` bind the *result* of any engine,
 * e.g. `area = integrate x^2 from 0 to 1` or `df(x) = derivative of f(x)`.
 */

export interface NotebookResult {
  outputs: Map<string, CellOutput[]>;
  session: Session;
  data: Map<string, number[]>;
  /** Everything defined, in order, for a variables panel. */
  bindings: NonNullable<CellOutput['binding']>[];
}

const BINDING = /^\s*([a-z][a-z0-9_]*)\s*(?:\(\s*([a-z](?:\s*,\s*[a-z])*)\s*\))?\s*(?::=|=)\s*(.+)$/i;
const RESERVED = new Set(['ans', 'base', 'pi', 'e', 'tau', 'phi', 'y', 'r']);

/**
 * Replaces data-column names with their values so any engine can use them: "mean of height". A column named
 * like a function ("max", "sum", "count" are common CSV headers) is still the function where it is used as one,
 * "max of max" or "sum(price)", and the name being defined on the left of "name = …" is left alone.
 */
function substituteData(line: string, data: Map<string, number[]>): string {
  if (!data.size) return line;
  const def = BINDING.exec(line);
  const from = def ? line.length - def[3]!.length : 0;
  return (
    line.slice(0, from) +
    line.slice(from).replace(/[a-z][a-z0-9_]*/gi, (w, at: number, rest: string) => {
      const col = data.get(w.toLowerCase());
      if (!col || /^\s*(?:\(|of\b)/i.test(rest.slice(at + w.length))) return w;
      return col.join(', ');
    })
  );
}

/** Progress hooks so a host can paint each cell as soon as it's done (a slow cell shouldn't blank the page). */
export interface EvaluateHooks {
  onCellStart?: (cellId: string) => void;
  onCellDone?: (cellId: string, outputs: CellOutput[], soFar: NotebookResult) => void;
  /** Runs a simulation (e.g. in a Worker). Default: in-process {@link runSimulation}. */
  simulate?: (req: SimRequest, signal?: AbortSignal) => Promise<SimulationSummary>;
}

export async function evaluateNotebook(nb: Notebook, run: Runner, signal?: AbortSignal, hooks: EvaluateHooks = {}): Promise<NotebookResult> {
  const session = createSession();
  session.angle = nb.angle;
  const outputs = new Map<string, CellOutput[]>();
  const data = new Map<string, number[]>();
  const bindings: NotebookResult['bindings'] = [];

  // Names whose defining line is still waiting on an engine; lines that use them wait too, instead of running
  // with a wrong meaning (e.g. "df(x)" read as df × x).
  const waitingFor = new Set<string>();
  const done = (id: string) => hooks.onCellDone?.(id, outputs.get(id) ?? [], { outputs, session, data, bindings });
  for (const cell of nb.cells) {
    if (signal?.aborted) break;
    hooks.onCellStart?.(cell.id);
    if (cell.type === 'text') {
      outputs.set(cell.id, []);
      done(cell.id);
      continue;
    }
    if (cell.type === 'data') {
      const t: DataTable = parseTable(cell.source);
      for (const [name, values] of t.numeric) {
        data.set(name, values);
        bindings.push({ name, kind: 'data', value: `${values.length} values` });
      }
      const nonNumeric = t.columns.filter((c) => !t.numeric.has(c));
      outputs.set(cell.id, [
        {
          kind: 'data',
          input: '',
          display: `${t.rows.length} rows × ${t.columns.length} columns`,
          table: { columns: t.columns, rows: t.rows.slice(0, 50), caption: t.rows.length > 50 ? `First 50 of ${t.rows.length} rows` : undefined },
          notes: [
            t.numeric.size ? `Use the columns by name: ${[...t.numeric.keys()].map((k) => `“mean of ${k}”`).slice(0, 2).join(', ')}` : 'No numeric columns found',
            ...(nonNumeric.length ? [`Text columns (not usable in calculations): ${nonNumeric.join(', ')}`] : []),
          ],
        },
      ]);
      done(cell.id);
      continue;
    }

    const outs: CellOutput[] = [];
    for (const raw of cell.source.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const query = substituteData(line, data);
      const blocked = [...waitingFor].find((n) => new RegExp(`(^|[^a-z0-9_])${n}([^a-z0-9_]|$)`, 'i').test(query));
      if (blocked) {
        const def = BINDING.exec(query);
        if (def) waitingFor.add(def[1]!);
        outs.push({ kind: 'pending', input: line, display: `Waiting for ${blocked}…` });
        continue;
      }
      const sim = /^(?:([a-z][a-z0-9_]*)\s*=\s*)?(simulate\b.*)$/i.exec(line);
      if (sim && isSimulateLine(sim[2]!)) {
        outs.push(await evalSimulation(line, sim[1], sim[2]!, session, bindings, hooks, signal));
        continue;
      }
      const out = await evalLine(line, query, session, run, bindings, signal);
      if (out.kind === 'pending') {
        const def = BINDING.exec(query);
        if (def) waitingFor.add(def[1]!);
      }
      outs.push(out);
    }
    outputs.set(cell.id, outs);
    done(cell.id);
  }
  return { outputs, session, data, bindings };
}

/** A formula whose body uses unknown names ("derivative", "integrate") is really a query for another engine. */
function unresolved(r: Extract<CalcResult, { ok: true }>, session: Session): boolean {
  if (!r.definition) return false;
  const params = new Set(r.definition.params);
  return freeNames(r.definition.body, session.vars).some((n) => !params.has(n));
}

async function evalLine(line: string, query: string, session: Session, run: Runner, bindings: NotebookResult['bindings'], signal?: AbortSignal): Promise<CellOutput> {
  // Plain calculator assignments and formulas (x = 5, f(x) = x^2) are handled by the calculator itself.
  const direct = calculate(query, session);
  const m = BINDING.exec(query);
  if ((direct.ok && !unresolved(direct, session)) || !m || RESERVED.has(m[1]!.toLowerCase())) {
    const r = await run(query, session, signal);
    // Only lines the calculator itself handled define names (the router may have sent "solve df(x) = 0" elsewhere).
    if (r.kind === 'value' && direct.ok && (direct.assignment || direct.definition) && !unresolved(direct, session)) {
      const name = direct.assignment ?? direct.definition!.name;
      const b = { name, kind: direct.definition ? ('function' as const) : ('variable' as const), value: direct.definition ? direct.definition.source : direct.formatted.display };
      bindings.push(b);
      return { ...r, input: line, binding: b };
    }
    return { ...r, input: line };
  }

  // Cross-engine binding: compute the right-hand side with any engine, then bind its result.
  const [, name, params, rhs] = m;
  const r = await run(rhs!, session, signal);
  if (r.kind === 'error' || r.kind === 'pending') return { ...r, input: line };
  if (params) {
    const body = (r.symbolic ?? '').replace(/\s*\+\s*C$/, '');
    if (!body) return { kind: 'error', input: line, error: `“${rhs}” didn’t produce an expression, so ${name}(${params}) can’t be defined from it` };
    const source = `${name}(${params}) = ${body}`;
    if (!defineFromSource(session, source)) return { kind: 'error', input: line, error: `Couldn’t turn “${body}” into a formula` };
    const b = { name: name!, kind: 'function' as const, value: source };
    bindings.push(b);
    return { ...r, input: line, binding: b, expression: `${name}(${params}) = ${body}` };
  }
  if (r.value === undefined) return { kind: 'error', input: line, error: `“${rhs}” has no single numeric value to store in ${name}` };
  session.vars.set(name!, new D(r.value));
  const b = { name: name!, kind: 'variable' as const, value: r.display ?? r.value };
  bindings.push(b);
  return { ...r, input: line, binding: b, expression: `${name} = ${r.expression ?? rhs}` };
}

const fmt = (x: number, digits = 4) => (Math.abs(x) >= 1e6 || (x !== 0 && Math.abs(x) < 1e-4) ? x.toExponential(digits - 1) : Number(x.toFixed(digits)).toLocaleString('en-US', { maximumFractionDigits: digits }));

/** One-line summary: "P ≈ 0.1672 (95% CI 0.1599–0.1747)". */
export function describeSimulation(s: SimulationSummary): { display: string; lines: { label: string; display: string }[]; notes: string[] } {
  const d = 4;
  const lines = [
    { label: '95% CI', display: `${fmt(s.lo, d)} – ${fmt(s.hi, d)} (± ${fmt((s.hi - s.lo) / 2, d)})` },
    ...(s.exact
      ? [{ label: 'Exact', display: `${s.exact.fraction ? `${s.exact.fraction} ≈ ` : ''}${fmt(s.exact.value, 6)} · ${s.exact.withinCI ? 'inside the CI ✓' : 'outside the CI'}` }]
      : []),
    { label: 'Trials', display: `${s.trials.toLocaleString('en-US')} · seed ${s.seed}${s.hits !== undefined ? ` · ${s.hits.toLocaleString('en-US')} hits` : ''}${s.sd !== undefined ? ` · sd ${fmt(s.sd, 4)}` : ''}` },
  ];
  const notes = [
    s.mode === 'probability' ? 'Estimated probability with a Wilson 95% interval' : 'Estimated mean with a 95% interval (normal approximation)',
    ...(s.exact ? [`Exact value ${s.exact.how}`] : s.exactNote ? [s.exactNote] : []),
  ];
  return { display: `${s.mode === 'probability' ? 'P' : 'Mean'} ≈ ${fmt(s.estimate, d)}`, lines, notes };
}

async function evalSimulation(
  line: string,
  name: string | undefined,
  text: string,
  session: Session,
  bindings: NotebookResult['bindings'],
  hooks: EvaluateHooks,
  signal?: AbortSignal,
): Promise<CellOutput> {
  try {
    const spec = parseSimulateLine(text);
    const consts: Record<string, number> = {};
    for (const [k, v] of session.vars) consts[k] = v.toNumber();
    const req: SimRequest = { body: spec.body, trials: spec.trials, seed: spec.seed, consts };
    const s = hooks.simulate ? await hooks.simulate(req, signal) : runSimulation(req);
    const view = describeSimulation(s);
    const out: CellOutput = {
      kind: 'simulation',
      input: line,
      expression: `${s.mode === 'probability' ? 'P' : 'E'}[${s.program}]`,
      display: view.display,
      plain: String(s.estimate),
      lines: view.lines,
      notes: view.notes,
      exactness: 'approximate',
      simulation: { ...s, seedGiven: spec.seedGiven },
    };
    session.ans = new D(s.estimate);
    if (name) {
      if (RESERVED.has(name.toLowerCase())) return { kind: 'error', input: line, error: `“${name}” is reserved` };
      session.vars.set(name, new D(s.estimate));
      const b = { name, kind: 'variable' as const, value: fmt(s.estimate) };
      bindings.push(b);
      out.binding = b;
    }
    return out;
  } catch (e) {
    if (e instanceof SimError || e instanceof Error) return { kind: 'error', input: line, error: e.message };
    return { kind: 'error', input: line, error: String(e) };
  }
}
