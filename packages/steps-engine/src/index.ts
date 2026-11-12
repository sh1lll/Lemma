import { calculate, createSession, D, type Answer, type Dec } from '@lemma/math-core';
import { worked, type Worked } from '@lemma/practice-engine';
import type { SymRequest, SymResult } from '@lemma/symbolic-engine';
import { arithmeticSteps } from './arith';
import type { Step, StepList } from './types';

export { arithmeticSteps } from './arith';
export { toLatex } from './latex';
export type { Step, StepList } from './types';

/**
 * Worked solutions for every kind of answer. Symbolic problems (equations, calculus, factoring, matrices…)
 * are worked on the SymPy side (op 'steps'); this module turns that into a StepList, and generates the
 * non-symbolic kinds itself: order of operations, fractions, percentages, unit conversions and shapes.
 * Nothing here invents a step: each one is computed, and checked where a check is possible.
 */

/** The SymPy operations that have step-by-step support. */
const STEP_OPS = new Set(['solve', 'diff', 'integrate', 'limit', 'factor', 'simplify', 'expand', 'matrix']);
const MATRIX_STEPS = new Set(['rref', 'rank', 'det', 'inv']);

/** The 'steps' request for a symbolic request, or null when that kind has no worked solution. */
export function stepsRequest(req: SymRequest): SymRequest | null {
  if (!STEP_OPS.has(req.op)) return null;
  if (req.op === 'matrix' && !MATRIX_STEPS.has(req.matrixOp ?? '')) return null;
  if (req.op === 'diff' && (req.vars?.length ?? 1) > 1) return null;
  if (req.op === 'solve' && req.interval) return null;
  const { label: _label, op, mode, ...rest } = req;
  return { ...rest, op: 'steps', task: op === 'simplify' && mode === 'bare' ? 'simplify' : op, label: req.label };
}

/** Converts the worker's steps result. Null when there are none. */
export function fromSym(r: SymResult): StepList | null {
  if (!r.ok || !r.steps?.length || r.none) return null;
  const conv = (s: NonNullable<SymResult['steps']>[number]): Step => ({ reason: s.r, latex: s.l, verified: s.v, detail: s.d, table: s.t });
  const steps = r.steps.map(conv);
  const v = r.verified;
  return {
    method: r.method ?? 'Steps',
    steps,
    alt: r.alt?.map((a) => ({ method: a.method, steps: a.steps.map(conv) })),
    verified: v ? v.ok : steps.every((s) => s.verified === true) ? true : null,
    how: v?.how,
    intervals: r.intervals,
  };
}

/** practice-engine's worked solutions check themselves by recomputation, so the list is marked checked. */
function fromWorked(w: Worked, method: string): StepList {
  const steps: Step[] = [];
  if (w.questionTex) steps.push({ reason: 'Start with the problem', latex: w.questionTex, verified: true });
  for (const s of w.steps) steps.push({ reason: s.text, latex: s.tex, verified: null });
  steps.push({ reason: 'Answer', latex: w.answer.tex ?? texText(w.answer.display), verified: null });
  return { method, steps, verified: true, how: 'Checked by recomputing the answer' };
}

const texText = (s: string) => `\\text{${s.replace(/[\\{}]/g, '').replace(/[%$#&_]/g, (c) => `\\${c}`)}}`;

const looksPercent = /%|\bpercent\b/i;
const looksFraction = /^\s*-?\d+(?:\s+\d+\/\d+|\/\d+)?\s*[+\-*/×÷]\s*-?\d+(?:\s+\d+\/\d+|\/\d+)?\s*$/;

/** Unit conversion: the factor between the units, then the multiplication; recomputed from the unit table. */
export function conversionSteps(c: { source: { value: Dec | string; unit: Unit }; results: { value: Dec | string; unit: Unit }[] }, input = ''): StepList | null {
  const from = c.source.unit;
  const to = c.results[0]?.unit;
  if (!to) return null;
  if (from.dimension === 'temperature' || !from.factor || !to.factor) {
    const w = worked(input);
    return w ? fromWorked(w, 'Temperature conversion') : null;
  }
  const v = new D(c.source.value.toString());
  const factor = new D(from.factor).div(to.factor);
  const got = new D(c.results[0]!.value.toString());
  const ok = v.mul(factor).minus(got).abs().lte(got.abs().mul(1e-12).plus(1e-30));
  const f = (x: Dec) => fmt(x);
  const base = baseUnit(from.dimension);
  const steps: Step[] = [
    { reason: 'Start with the quantity', latex: `${f(v)}\\ \\text{${esc(from.symbol)}}`, verified: true },
    {
      reason: base && from.symbol !== base && to.symbol !== base ? `Both units in ${base}: 1 ${from.symbol} = ${f(new D(from.factor))} ${base} and 1 ${to.symbol} = ${f(new D(to.factor))} ${base}` : `Conversion factor between the units`,
      latex: `1\\ \\text{${esc(from.symbol)}} = ${f(factor)}\\ \\text{${esc(to.symbol)}}`,
      verified: true,
      detail: 'A conversion factor is a ratio equal to 1, so multiplying by it changes the units without changing the amount.',
    },
    { reason: 'Multiply by the conversion factor', latex: `${f(v)} \\times ${f(factor)} = ${f(got)}\\ \\text{${esc(to.symbol)}}`, verified: ok },
  ];
  return { method: 'Unit conversion', steps, verified: ok, how: 'Recomputed from the unit table' };
}
interface Unit {
  dimension: string;
  symbol: string;
  factor?: string;
}
const esc = (s: string) => s.replace(/[\\{}]/g, '').replace(/[%$#&_]/g, (c) => `\\${c}`).replace(/°/g, '^{\\circ}');
const BASE: Record<string, string> = { length: 'm', mass: 'kg', time: 's', volume: 'L', area: 'm²', speed: 'm/s', energy: 'J', pressure: 'Pa', power: 'W', data: 'B' };
const baseUnit = (d: string) => BASE[d] ?? '';
function fmt(x: Dec): string {
  const s = x.toSignificantDigits(10).toString();
  return /e/.test(s) ? x.toSignificantDigits(6).toExponential().replace(/e\+?(-?\d+)/, '\\times 10^{$1}') : s;
}

/** Shapes: formula, then the given values substituted, then the decimal; each formula is re-evaluated when it can be. */
export function shapeSteps(a: Answer): StepList | null {
  if (a.kind !== 'shape' || !a.lines?.length) return null;
  const target = a.lines.find((l) => l.display.includes(' = ') && a.primary.display && l.display.endsWith(a.primary.display.replace(/^.*?=\s*/, ''))) ?? a.lines.find((l) => l.display.includes(' = '));
  if (!target) return null;
  const given = a.lines.filter((l) => /\(given\)/.test(l.display));
  const parts = target.display.split(' = ');
  if (parts.length < 2) return null;
  const sym = parts[0]!.trim();
  const formula = parts[1]!.trim();
  const rest = parts.slice(2).join(' = ');
  const vals = given.map((g) => {
    const m = /\(([^)]+)\)\s*$/.exec(g.label);
    return { name: m?.[1] ?? g.label, value: g.display.replace(/\s*\(given\).*/, '').trim() };
  });
  // Re-evaluate the formula with the given values in the calculator, when it reads as math.
  let ok: boolean | null = null;
  try {
    const s = createSession();
    s.angle = 'deg';
    for (const v of vals) if (/^[a-zA-Z]$/.test(v.name) && /^-?[\d.]+$/.test(v.value)) s.vars.set(v.name, new D(v.value));
    const expr = formula
      .replace(/²/g, '^2')
      .replace(/³/g, '^3')
      .replace(/√\(?([^)\s]+)\)?/g, 'sqrt($1)')
      .replace(/·|×/g, '*')
      .replace(/([a-zA-Z])(?=[a-zA-Z(])/g, '$1 ')
      .replace(/(\d)(?=[a-zA-Zπ(])/g, '$1 ')
      .replace(/π/g, ' pi ');
    const r = calculate(expr, s);
    if (r.ok && a.value) ok = r.value.minus(a.value).abs().lte(a.value.abs().mul(1e-9).plus(1e-12));
  } catch {
    ok = null;
  }
  const t = (s: string) => texText(s);
  const steps: Step[] = [
    { reason: `Write the formula for ${target.label.replace(/\s*\([^)]*\)\s*$/, '').toLowerCase()}`, latex: t(`${sym} = ${formula}`), verified: true },
  ];
  if (vals.length) steps.push({ reason: 'Put in the given values: ' + vals.map((v) => `${v.name} = ${v.value}`).join(', '), latex: t(`${sym} = ${rest || a.primary.display}`), verified: ok });
  if (/≈/.test(rest)) steps.push({ reason: 'As a decimal', latex: t(`${sym} ≈ ${rest.split('≈').pop()!.trim()}`), verified: ok });
  return { method: 'Formula, then substitution', steps, verified: ok, how: ok ? 'Formula re-evaluated with the given values' : undefined };
}

/** Steps for answers that don't come from SymPy. Null when there's nothing worth showing. */
export function plainSteps(input: string, opts: { answer?: Answer | null; conversion?: Parameters<typeof conversionSteps>[0] | null } = {}): StepList | null {
  const q = input.trim();
  if (opts.conversion) return conversionSteps(opts.conversion, q);
  if (opts.answer?.kind === 'shape') {
    const s = shapeSteps(opts.answer);
    if (s) return s;
  }
  if (looksFraction.test(q) && /\//.test(q)) {
    const w = worked(q);
    if (w) return fromWorked(w, 'Fractions');
  }
  if (looksPercent.test(q)) {
    const w = worked(q);
    if (w) return fromWorked(w, 'Percentages');
    if (opts.answer?.kind === 'arith' && opts.answer.notes.length) {
      const formula = opts.answer.notes.find((n) => /[÷×]/.test(n));
      if (formula) {
        return {
          method: 'Percentages',
          steps: [
            { reason: 'Use the rule', latex: texText(formula), verified: true },
            { reason: 'Work it out', latex: texText(`${opts.answer.expression} = ${opts.answer.primary.display}`), verified: null },
          ],
          verified: null,
        };
      }
    }
  }
  const a = arithmeticSteps(q);
  if (a) return a;
  const w = worked(q);
  if (w && !/derivative|integra|solve|=/.test(q)) return fromWorked(w, w.title);
  return null;
}
