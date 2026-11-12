import { D, MathError, type Answer, type AnswerResult } from '@lemma/math-core';
import type { SymRequest } from './request';

export { complexRequest, expressionRequest, LOOKS_LIKE_SYMBOLIC, parseSymbolic, preserveCase, toSympy, type SymOp, type SymRequest } from './request';
export { answerNumberTheory, factorize, isPrime, LOOKS_LIKE_NUMBER_THEORY } from './numtheory';
export { answerArithmetic, commaDecimal, LOOKS_LIKE_ARITH } from './arith';
export { answerNumberExtras, LOOKS_LIKE_NUMBER_EXTRAS } from './nt';
export { PYTHON_SOURCE } from './python';

/** What the SymPy worker returns (see python.ts). */
export interface SymResult {
  ok: boolean;
  error?: string;
  latex_in?: string;
  latex_out?: string;
  text?: string;
  numeric?: string | null;
  verified?: { ok: boolean; how: string } | null;
  notes?: string[];
  lines?: [string, string][];
  /** Machine-readable result in Lemma syntax (for formulas, notebooks). */
  plain?: string;
  /** Long exact forms shown folded: [label, LaTeX]. */
  extra?: [string, string][];
  table?: { columns: string[]; rows: string[][] };
  exact?: boolean;
  count?: number;
  /** Overrides the operation name shown with the result ("Factored", "Expression"). */
  label?: string;
  /** op 'steps': the worked solution. Each step: reason, LaTeX, verified (true/false/null), optional detail and table. */
  steps?: SymStep[];
  method?: string | null;
  alt?: { method: string; steps: SymStep[] }[];
  /** Solution sets as intervals for number lines: [lo, hi, loClosed, hiClosed, loTex, hiTex] (null = infinite). */
  intervals?: [number | null, number | null, boolean, boolean, string, string][];
  /** op 'report': labelled items [label, LaTeX, text]. */
  items?: [string, string, string][];
  none?: boolean;
  note?: string;
}

export interface SymStep {
  r: string;
  l: string;
  v: boolean | null;
  d?: string;
  t?: { columns: string[]; rows: string[][] };
}

/** Pyodide + SymPy versions loaded by the worker; pinned so cached files stay valid. */
export const PYODIDE_VERSION = '0.29.0';
export const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

const OP_KIND: Record<SymRequest['op'], string> = {
  diff: 'Derivative',
  idiff: 'Implicit derivative',
  integrate: 'Integral',
  integrate2: 'Double integral',
  limit: 'Limit',
  solve: 'Solution',
  identity: 'Check',
  simplify: 'Simplified',
  expand: 'Expanded',
  factor: 'Factored',
  apart: 'Partial fractions',
  trigsimp: 'Simplified',
  expand_trig: 'Expanded',
  together: 'Combined',
  rationalize: 'Rationalised',
  complete_square: 'Completed square',
  polydiv: 'Polynomial division',
  pgcd: 'GCD',
  plcm: 'LCM',
  series: 'Series',
  binomial_series: 'Binomial expansion',
  sum: 'Sum',
  dsolve: 'ODE solution',
  rsolve: 'Recurrence solution',
  laplace: 'Laplace transform',
  ilaplace: 'Inverse Laplace transform',
  fourier: 'Fourier transform',
  ifourier: 'Inverse Fourier transform',
  matrix: 'Matrix',
  vector: 'Vector',
  logic: 'Logic',
  sequence: 'Sequence',
  extrema: 'Function analysis',
  conic: 'Conic',
  quadinfo: 'Polynomial roots',
  coeff: 'Coefficient',
  fninfo: 'Function',
  vcalc: 'Vector calculus',
  calcapp: 'Integral application',
  evaluate: 'Result',
  steps: 'Steps',
  report: 'Report',
};

/** A relation outside every {…} group (so \\sum_{n=1} doesn't count). */
function topRelation(t: string): boolean {
  let s = t;
  for (let i = 0; i < 8 && /\{[^{}]*\}/.test(s); i++) s = s.replace(/\{[^{}]*\}/g, '');
  return /=|<|>|\\[lg]eq?\b|\\ne\b|\\in\b/.test(s);
}

/** Converts a worker result into the shared Answer schema. */
export function toAnswer(input: string, req: SymRequest, r: SymResult): AnswerResult {
  if (!r.ok) {
    const msg = (r.error ?? 'Unknown error').replace(/^\w+Error: /, '');
    return { ok: false, kind: 'symbolic', input, error: new MathError('domain', msg) };
  }
  const text = r.text ?? '';
  let value: Answer['value'];
  if (r.numeric && /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(r.numeric)) {
    try {
      value = new D(r.numeric);
    } catch {
      value = undefined;
    }
  }
  const numericDiffers = r.numeric && r.numeric !== text.replace(/−/g, '-') && !/^[-−]?\d+$/.test(text) && !/≈/.test(text);
  const lines: Answer['lines'] = (r.lines ?? []).map(([label, display]) => ({ label, display }));
  if (numericDiffers && !lines.length && value) lines.unshift({ label: 'Decimal', display: `≈ ${Number(r.numeric).toPrecision(12).replace(/\.?0+(?=e|$)/, '').replace(/^-/, '−')}` });
  // "2x − 8 = 0 ⇒ x = 4": a relation on either side can't be chained with "=".
  const join = r.latex_in && r.latex_out && (topRelation(r.latex_in) || topRelation(r.latex_out)) ? ' \\;\\Rightarrow\\; ' : ' = ';
  const math: NonNullable<Answer['math']> = r.latex_in && r.latex_out ? [{ latex: `${r.latex_in}${join}${r.latex_out}` }] : r.latex_out ? [{ latex: r.latex_out }] : [];
  for (const [label, latex] of r.extra ?? []) math.push({ latex, label, collapsed: true });
  return {
    ok: true,
    kind: 'symbolic',
    input,
    expression: `${r.label ?? OP_KIND[req.op]} · ${req.label}`,
    primary: { display: text.length > 160 ? `${text.slice(0, 157)}…` : text, plain: r.numeric ?? r.plain ?? text, spoken: text.replace(/−/g, 'minus ').replace(/√/g, 'root ').replace(/π/g, 'pi') },
    symbolic: r.plain,
    value,
    lines,
    math: math.length ? math : undefined,
    table: r.table,
    verified: r.verified ?? undefined,
    exactness: r.exact === false ? 'numeric' : 'exact',
    notes: [...(r.notes ?? []), 'Computed by the algebra engine'],
  };
}
