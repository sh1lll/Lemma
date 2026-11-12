/**
 * The extension's one entry point into the Lemma engines. DOM-free: it runs in the background service
 * worker (selection actions), in the popup and in the side panel. Everything is computed locally.
 *
 * The extension has no SymPy backend (Pyodide is too large to ship and loads Python packages at run time),
 * so symbolic requests fall back to practice-engine's exact, self-checking solvers, which cover linear and
 * quadratic equations, systems, derivatives, integrals of polynomials, percent and fractions.
 */
import { createSession, type Session } from '@lemma/math-core';
import { worked, type Worked } from '@lemma/practice-engine';
import { outcomeToJSON, Runtime, type OutcomeJSON } from '@lemma/runtime';
import { sampleExplicit } from '@lemma/graph-engine';

import type { Action } from './actions';
export { ACTION_LABELS, type Action } from './actions';

export interface Step {
  text: string;
  tex?: string;
}

export interface GraphData {
  /** SVG path data in a 0..W × 0..H box (y down). */
  paths: string[];
  labels: string[];
  width: number;
  height: number;
  xRange: [number, number];
  yRange: [number, number];
  /** Pixel positions of the axes when they are inside the box. */
  axisX: number | null;
  axisY: number | null;
}

export interface Solution {
  action: Action;
  query: string;
  ok: boolean;
  /** What the engines understood, e.g. "3 × 4 + 2". */
  expression?: string;
  answer?: { display: string; tex?: string; /** What "Fill" writes into a field. */ fill: string };
  /** A first nudge (tutor mode shows it before any working). */
  hint?: string;
  steps: Step[];
  title?: string;
  questionTex?: string;
  notes: string[];
  graph?: GraphData;
  error?: string;
}

let runtime: Runtime | null = null;
const rt = () => (runtime ??= new Runtime());
let session: Session = createSession();

/** Separate session per surface; the calculator keeps `ans` between lines, selection actions start clean. */
export function resetSession(): void {
  session = createSession();
}

/** Strips "x = " from "x = 4" so a numeric field gets just the value. "x = 2 or x = 3" → "2, 3". */
export function fillValue(display: string): string {
  const d = display.trim();
  const parts = d.split(/\s*(?:,|\bor\b|\band\b)\s*/i).filter(Boolean);
  if (parts.length > 1 && parts.every((p) => /^[a-zA-Z]\w*\s*=/.test(p))) return parts.map((p) => p.replace(/^[a-zA-Z]\w*\s*=\s*/, '')).join(', ');
  return d.replace(/^[a-zA-Z]\w*\s*=\s*/, '').replace(/\s*\(.*\)\s*$/, '').trim();
}

function fromJSON(j: OutcomeJSON): Pick<Solution, 'ok' | 'expression' | 'answer' | 'notes' | 'error'> {
  if (!j.ok || !j.display) return { ok: false, notes: [], error: j.error?.message ?? 'Lemma could not read that.' };
  const display = j.unit && !j.display.includes(j.unit) ? `${j.display} ${j.unit}` : j.display;
  return {
    ok: true,
    expression: j.expression,
    answer: { display, fill: j.plain && /^-?[\d.e+-]+$/i.test(j.plain) ? j.plain : fillValue(display) },
    notes: [...(j.notes ?? []), ...(j.lines ?? []).map((l) => `${l.label}: ${l.display}`)],
  };
}

export function hintFrom(text: string): string {
  const cut = text.replace(/\s*[:：]\s.*$/, '').trim();
  const h = cut.length >= 12 ? cut : text;
  return /[.?!]$/.test(h) ? h : `${h}.`;
}

function fromWorked(w: Worked): Pick<Solution, 'ok' | 'answer' | 'steps' | 'hint' | 'title' | 'questionTex'> {
  const first = w.steps[0];
  return {
    ok: true,
    title: w.title,
    questionTex: w.questionTex,
    steps: w.steps.map((s) => (s.tex === undefined ? { text: s.text } : { text: s.text, tex: s.tex })),
    // The hint is the first move without its result ("Find two numbers that multiply to 6 and add to −5").
    hint: first ? hintFrom(first.text) : undefined,
    answer: { display: w.answer.display, tex: w.answer.tex, fill: fillValue(w.answer.display) },
  };
}

/** Plain unit → its usual counterpart, for "Convert" on a bare quantity like "5 miles". */
const DEFAULT_TARGETS: [RegExp, string][] = [
  [/\b(?:mi|miles?)\b/i, 'km'],
  [/\b(?:km|kilomet(?:er|re)s?)\b/i, 'miles'],
  [/\b(?:lbs?|pounds?)\b/i, 'kg'],
  [/\b(?:kg|kilograms?|kilos?)\b/i, 'lb'],
  [/°\s*F\b|\bfahrenheit\b|\bdeg(?:rees)?\s*F\b/i, '°C'],
  [/°\s*C\b|\bcelsius\b|\bdeg(?:rees)?\s*C\b/i, '°F'],
  [/\b(?:in|inch(?:es)?|")\s*$/i, 'cm'],
  [/\b(?:cm|centimet(?:er|re)s?)\b/i, 'inches'],
  [/\b(?:ft|feet|foot)\b/i, 'm'],
  [/\b(?:m|met(?:er|re)s?)\b/i, 'ft'],
  [/\b(?:gal|gallons?)\b/i, 'L'],
  [/\b(?:l|lit(?:er|re)s?)\b/i, 'gal'],
  [/\b(?:oz|ounces?)\b/i, 'g'],
  [/\b(?:g|grams?)\b/i, 'oz'],
  [/\b(?:mph)\b/i, 'km/h'],
  [/\b(?:km\/h|kph)\b/i, 'mph'],
];

export function conversionQuery(q: string): string {
  if (/\b(?:to|in|into|as)\s+\S+\s*$/i.test(q)) return q;
  for (const [re, target] of DEFAULT_TARGETS) if (re.test(q)) return `${q} to ${target}`;
  return q;
}

export function graphQuery(q: string): string {
  return /^\s*(?:graph|plot|draw|sketch)\b/i.test(q) ? q : `graph ${q}`;
}

async function compute(q: string, s: Session = createSession()): Promise<OutcomeJSON> {
  return outcomeToJSON(await rt().compute(q, s), q);
}

/** The calculator line: live answer for whatever was typed (keeps `ans` across lines). */
export async function calculateLine(q: string): Promise<Solution> {
  const j = await compute(q, session);
  const base = fromJSON(j);
  if (base.ok) return { action: 'calculate', query: q, steps: [], ...base };
  // Equations and calculus the runtime would hand to SymPy: answer them with the exact solvers instead.
  const w = worked(q);
  if (w) return { action: 'calculate', query: q, notes: [], ...fromWorked(w) };
  return { action: 'calculate', query: q, steps: [], ...base };
}

/** Commits a calculator line to the session so `ans` refers to it. */
export function keepLine(q: string): void {
  rt().route(q, session);
}

export async function solve(action: Action, query: string, column?: { label: string; values: number[] }): Promise<Solution> {
  const q = query.trim().replace(/\s+/g, ' ');
  if (action === 'average') return average(q, column);
  if (!q) return { action, query: q, ok: false, steps: [], notes: [], error: 'Nothing was selected.' };

  if (action === 'graph') return graph(q);

  if (action === 'convert') {
    const cq = conversionQuery(q);
    const r = fromJSON(await compute(cq));
    return { action, query: cq, steps: [], ...r, ...(r.ok ? {} : { error: r.error ?? 'No conversion found. Try "5 miles to km".' }) };
  }

  if (action === 'solve' || action === 'explain') {
    const w = worked(q);
    if (w) return { action, query: q, notes: [], ...fromWorked(w) };
    const r = fromJSON(await compute(q));
    return { action, query: q, steps: [], ...r, notes: [...r.notes, 'No worked steps for this one, so only the answer is shown.'] };
  }

  // calculate
  const r = fromJSON(await compute(q));
  if (r.ok) {
    // An equation that the runtime could evaluate numerically still benefits from steps.
    const w = /=/.test(q) ? worked(q) : null;
    return { action, query: q, steps: w ? fromWorked(w).steps : [], ...r };
  }
  const w = worked(q);
  if (w) return { action, query: q, notes: [], ...fromWorked(w) };
  return { action, query: q, steps: [], ...r };
}

async function average(q: string, column?: { label: string; values: number[] }): Promise<Solution> {
  const values = column?.values ?? [];
  if (values.length < 1) return { action: 'average', query: q, ok: false, steps: [], notes: [], error: 'No numbers found in that column.' };
  const list = values.join(', ');
  const mean = await compute(`mean of ${list}`);
  const sum = values.reduce((a, b) => a + b, 0);
  const r = fromJSON(mean);
  const label = column?.label ? `“${column.label}”` : 'this column';
  if (!r.ok) {
    const avg = sum / values.length;
    const display = String(Number(avg.toPrecision(12)));
    return { action: 'average', query: `mean of ${list}`, ok: true, expression: `average of ${label}`, steps: [], notes: [`${values.length} values, sum ${Number(sum.toPrecision(12))}`], answer: { display, fill: display } };
  }
  return {
    action: 'average',
    query: `mean of ${list}`,
    ok: true,
    expression: `average of ${label}`,
    answer: r.answer,
    steps: [
      { text: `Add the ${values.length} values: ${values.join(' + ')} = ${Number(sum.toPrecision(12))}` },
      { text: `Divide by ${values.length}: ${Number(sum.toPrecision(12))} ÷ ${values.length} = ${r.answer?.display ?? ''}` },
    ],
    notes: [`${values.length} values, sum ${Number(sum.toPrecision(12))}`],
  };
}

const GW = 260;
const GH = 170;

async function graph(q: string): Promise<Solution> {
  const gq = graphQuery(q);
  const o = await rt().compute(gq, createSession());
  if (o.kind !== 'graph') {
    const r = fromJSON(outcomeToJSON(o, gq));
    return { action: 'graph', query: gq, steps: [], ...r, ok: false, error: r.error ?? 'That is not something Lemma can graph.' };
  }
  const xr: [number, number] = o.spec.view ? [o.spec.view.xMin, o.spec.view.xMax] : [-10, 10];
  const fns = o.spec.items.filter((it) => it.kind === 'explicit');
  const notes = [...o.spec.notes];
  if (fns.length < o.spec.items.length) notes.push('Some parts of this graph (implicit, polar or parametric curves) are drawn only in the full app.');
  // Auto y-range from samples, clipped to a sensible window.
  const ys: number[] = [];
  for (const it of fns)
    for (let i = 0; i <= 200; i++) {
      const v = it.f({ x: xr[0] + ((xr[1] - xr[0]) * i) / 200 });
      if (Number.isFinite(v)) ys.push(v);
    }
  ys.sort((a, b) => a - b);
  let lo = ys.length ? ys[Math.floor(ys.length * 0.02)]! : -10;
  let hi = ys.length ? ys[Math.ceil(ys.length * 0.98) - 1]! : 10;
  if (hi - lo < 1e-9) [lo, hi] = [lo - 1, hi + 1];
  const pad = (hi - lo) * 0.1;
  const yr: [number, number] = [lo - pad, hi + pad];
  const vp = { xMin: xr[0], xMax: xr[1], yMin: yr[0], yMax: yr[1] };
  const px = (x: number) => ((x - xr[0]) / (xr[1] - xr[0])) * GW;
  const py = (y: number) => GH - ((y - yr[0]) / (yr[1] - yr[0])) * GH;
  const paths: string[] = [];
  for (const it of fns) {
    let d = '';
    for (const pl of sampleExplicit(it.f, {}, vp, GW, it.domain)) {
      let pen = false;
      for (let i = 0; i < pl.length; i += 2) {
        const X = px(pl[i]!);
        const Y = py(pl[i + 1]!);
        if (!Number.isFinite(Y) || Y < -GH || Y > 2 * GH) {
          pen = false;
          continue;
        }
        d += `${pen ? 'L' : 'M'}${X.toFixed(1)} ${Y.toFixed(1)}`;
        pen = true;
      }
    }
    paths.push(d);
  }
  const ax = yr[0] < 0 && yr[1] > 0 ? py(0) : null;
  const ay = xr[0] < 0 && xr[1] > 0 ? px(0) : null;
  return {
    action: 'graph',
    query: gq,
    ok: paths.some(Boolean),
    expression: fns.map((f) => f.label).join('; '),
    steps: [],
    notes,
    graph: { paths, labels: fns.map((f) => f.label), width: GW, height: GH, xRange: xr, yRange: yr, axisX: ax, axisY: ay },
    ...(paths.some(Boolean) ? {} : { error: 'Nothing to draw in view.' }),
  };
}
