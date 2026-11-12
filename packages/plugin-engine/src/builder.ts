import { calculate, createSession, D } from '@lemma/math-core';
import { PluginError, validateManifest, type FormulaManifest } from './manifest';
import { matchPlugin } from './match';

/**
 * The no-code tool builder: a name, a formula and the inputs it uses become a validated formula plugin, with
 * phrase templates generated from the inputs ("tile cost {area} {price}") plus any the user writes.
 */
export interface ToolDraft {
  name: string;
  description?: string;
  formula: string;
  /** Inputs in phrase order; label and unit optional. */
  inputs: { name: string; label?: string; unit?: string }[];
  /** Extra phrases, e.g. "paint for {area} m2 at {coverage} m2 per litre". */
  phrases?: string[];
  resultLabel?: string;
  resultUnit?: string;
  decimals?: number;
  author?: string;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'tool';

export function buildFormulaPlugin(d: ToolDraft): FormulaManifest {
  const name = d.name.trim();
  if (!name) throw new PluginError('Give the tool a name');
  const inputs = d.inputs.map((i) => ({ ...i, name: i.name.trim().toLowerCase() })).filter((i) => i.name);
  if (!inputs.length) throw new PluginError('Add at least one input');
  // Every input must appear in the formula, and the formula may only use inputs and built-in constants/functions.
  const s = createSession();
  for (const i of inputs) s.vars.set(i.name, new D(1));
  const probe = calculate(d.formula, s);
  if (!probe.ok && probe.error.code === 'unknown-name') throw new PluginError(`The formula uses something that isn’t an input: ${probe.error.message.replace(/^Unknown name /, '')}`);
  if (!probe.ok && probe.error.code !== 'division-by-zero' && probe.error.code !== 'domain') throw new PluginError(`The formula doesn’t parse: ${probe.error.message}`);
  for (const i of inputs) if (!new RegExp(`(^|[^a-z0-9_])${i.name}([^a-z0-9_]|$)`, 'i').test(d.formula)) throw new PluginError(`The formula doesn’t use the input “${i.name}”`);

  const keyword = name.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim();
  const generated = [`${keyword} ${inputs.map((i) => `{${i.name}}${i.unit ? ` ${i.unit}` : ''}`).join(' ')}`, `${keyword} ${inputs.map((i) => `{${i.name}}`).join(' ')}`];
  const templates = [...new Set([...generated, ...(d.phrases ?? []).map((p) => p.trim()).filter(Boolean)])].slice(0, 12);

  const manifest = validateManifest({
    format: 'lemma-plugin',
    version: 1,
    id: `user.${slug(name)}`,
    name,
    description: d.description?.trim() || `${name}: ${d.formula}`,
    author: d.author,
    release: '1.0.0',
    kind: 'formula',
    templates,
    inputs,
    formula: d.formula.trim(),
    output: { label: d.resultLabel, unit: d.resultUnit, decimals: d.decimals },
    examples: [{ input: generated[1]!.replace(/\{[a-z0-9_]+\}/g, '2') }],
  }) as FormulaManifest;
  // The generated example must route to this tool.
  if (!matchPlugin(manifest, manifest.examples![0]!.input)) throw new PluginError('The generated phrase doesn’t match; try a simpler name');
  return manifest;
}
