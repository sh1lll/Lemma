import { calculate, createSession, D, formatNumber, MathError, type Answer, type AnswerResult } from '@lemma/math-core';
import type { FormulaManifest, PluginManifest } from './manifest';
import type { MatchResult } from './match';

/** Runs a formula plugin: inputs bound as variables, formula evaluated by Lemma's exact engine. No plugin code runs. */
export function runFormula(m: FormulaManifest, match: MatchResult, input: string): AnswerResult {
  const fail = (msg: string): AnswerResult => ({ ok: false, kind: `plugin:${m.id}`, input, error: new MathError('domain', msg) });
  const s = createSession();
  for (const def of m.inputs) {
    if (def.type === 'text') continue;
    const raw = match.values[def.name];
    let v: InstanceType<typeof D>;
    if (raw !== undefined) {
      try {
        v = new D(raw);
      } catch {
        return fail(`“${raw}” isn’t a number for ${def.label ?? def.name}`);
      }
    } else if (def.default !== undefined) v = new D(def.default);
    else return { ok: false, kind: `plugin:${m.id}`, input, error: new MathError('ambiguous-reference', `What is the ${def.label ?? def.name}?`) };
    if (def.min !== undefined && v.lt(def.min)) return fail(`${def.label ?? def.name} must be at least ${def.min}${def.unit ? ` ${def.unit}` : ''}`);
    if (def.max !== undefined && v.gt(def.max)) return fail(`${def.label ?? def.name} must be at most ${def.max}${def.unit ? ` ${def.unit}` : ''}`);
    s.vars.set(def.name, v);
  }
  const r = calculate(m.formula, s);
  if (!r.ok) return fail(r.error.message);
  const show = (value: InstanceType<typeof D>, decimals?: number) => formatNumber(value, decimals === undefined ? {} : { fixedPlaces: decimals }).display;
  const band = m.output.bands?.find((b) => r.value.lte(b.max));
  const lines: NonNullable<Answer['lines']> = [];
  if (band) lines.push({ label: 'Category', display: band.label });
  for (const l of m.lines ?? []) {
    const x = calculate(l.formula, s);
    lines.push({ label: l.label, display: x.ok ? `${show(x.value, l.decimals)}${l.unit ? ` ${l.unit}` : ''}` : '—' });
  }
  const shown = m.inputs
    .filter((i) => match.values[i.name] !== undefined || i.default !== undefined)
    .map((i) => `${i.label ?? i.name} ${match.values[i.name] ?? i.default}${i.unit ? ` ${i.unit}` : ''}`)
    .join(', ');
  const display = show(r.value, m.output.decimals);
  return {
    ok: true,
    kind: `plugin:${m.id}`,
    input,
    expression: `${m.name} · ${shown}`,
    primary: { display, plain: r.value.toString(), spoken: `${m.output.label ?? m.name} ${display}${m.output.unit ? ` ${m.output.unit}` : ''}`, unit: m.output.unit },
    value: r.value,
    lines,
    notes: [`From the “${m.name}” extension${m.author ? ` by ${m.author}` : ''}: ${m.formula}`],
    exactness: r.approximate ? 'approximate' : 'exact',
  };
}

/** What a sandboxed script plugin may return; anything else is rejected. */
export interface ScriptResult {
  display: string;
  value?: string | number;
  unit?: string;
  lines?: { label: string; display: string }[];
  notes?: string[];
}

const str = (x: unknown, max: number) => typeof x === 'string' && x.length <= max;

/** Validates and converts a sandbox result. Plain text only: nothing a plugin returns is ever treated as HTML. */
export function scriptResultToAnswer(m: PluginManifest, input: string, raw: unknown): AnswerResult {
  const r = raw as ScriptResult;
  const bad = (why: string): AnswerResult => ({ ok: false, kind: `plugin:${m.id}`, input, error: new MathError('domain', `The “${m.name}” extension returned an invalid result (${why})`) });
  if (!r || typeof r !== 'object') return bad('not an object');
  if (!str(r.display, 200)) return bad('display must be text ≤ 200 characters');
  if (r.unit !== undefined && !str(r.unit, 30)) return bad('unit');
  if (r.lines !== undefined && (!Array.isArray(r.lines) || r.lines.length > 20 || !r.lines.every((l) => str(l?.label, 60) && str(l?.display, 200)))) return bad('lines');
  if (r.notes !== undefined && (!Array.isArray(r.notes) || r.notes.length > 10 || !r.notes.every((n) => str(n, 300)))) return bad('notes');
  let value: Answer['value'];
  if (r.value !== undefined) {
    try {
      value = new D(String(r.value));
    } catch {
      return bad('value must be numeric');
    }
  }
  return {
    ok: true,
    kind: `plugin:${m.id}`,
    input,
    expression: m.name,
    primary: { display: r.display, plain: value?.toString() ?? r.display, spoken: r.display, unit: r.unit },
    value,
    lines: r.lines?.map((l) => ({ label: l.label, display: l.display })),
    notes: [...(r.notes ?? []), `From the “${m.name}” extension (sandboxed script)`],
    exactness: 'numeric',
  };
}
