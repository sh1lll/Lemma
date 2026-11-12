/**
 * The Lemma extension format. A plugin is a JSON manifest:
 *  - `formula` plugins are declarative (inputs + a formula evaluated by Lemma itself), so they run no code.
 *    The no-code tool builder produces these.
 *  - `script` plugins carry JavaScript that the host runs in an isolated sandbox with declared permissions.
 * Intents are phrase templates ("bmi {weight} kg {height} m"), never raw regular expressions, so a plugin
 * cannot make input matching slow (no catastrophic backtracking).
 */

export interface PluginInput {
  name: string;
  label?: string;
  /** 'number' (default) captures a numeric value; 'text' captures words. */
  type?: 'number' | 'text';
  unit?: string;
  min?: number;
  max?: number;
  /** Used when a template doesn't mention the input. */
  default?: number;
}

export interface PluginOutput {
  label?: string;
  unit?: string;
  /** Fixed decimal places in the display. */
  decimals?: number;
  /** Optional verdict bands, e.g. BMI categories: first band whose `max` ≥ value wins. */
  bands?: { max: number; label: string }[];
}

interface ManifestBase {
  format: 'lemma-plugin';
  version: 1;
  id: string;
  name: string;
  description: string;
  author?: string;
  /** Plugin's own version, semver-ish. */
  release: string;
  templates: string[];
  inputs: PluginInput[];
  /** Shown as examples in the manager and used by tests. */
  examples?: { input: string; expect?: string }[];
}

export interface FormulaManifest extends ManifestBase {
  kind: 'formula';
  /** Lemma expression over the input names, e.g. "weight / height^2". */
  formula: string;
  output: PluginOutput;
  /** Extra derived lines: label + formula. */
  lines?: { label: string; formula: string; decimals?: number; unit?: string }[];
}

export interface ScriptManifest extends ManifestBase {
  kind: 'script';
  /** JavaScript source defining `run(inputs, api)`; executed only inside the host's sandbox. */
  script: string;
  /** e.g. ["network:api.example.com"]. Nothing is allowed unless listed and approved by the user. */
  permissions?: string[];
}

export type PluginManifest = FormulaManifest | ScriptManifest;

export class PluginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginError';
  }
}

const ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;
const NAME = /^[a-z][a-z0-9_]{0,31}$/;
const PERMISSION = /^network:[a-z0-9.-]+\.[a-z]{2,}$/;
const LIMITS = { templates: 12, inputs: 12, templateLength: 120, script: 64_000, text: 400 };

/** Validates untrusted JSON into a manifest, or throws PluginError with a precise reason. */
export function validateManifest(raw: unknown): PluginManifest {
  // Untrusted input: read it through a loose shape and check every field.
  const m = raw as {
    [k: string]: unknown;
    format?: unknown;
    version?: unknown;
    id?: unknown;
    kind?: unknown;
    formula?: unknown;
    output?: unknown;
    script?: unknown;
    permissions?: unknown[];
    templates?: unknown[];
    inputs?: { name?: unknown; type?: unknown }[];
  };
  const fail = (why: string): never => {
    throw new PluginError(`Invalid plugin: ${why}`);
  };
  if (!m || typeof m !== 'object') fail('not an object');
  if (m.format !== 'lemma-plugin' || m.version !== 1) fail('not an Lemma plugin (format/version)');
  if (typeof m.id !== 'string' || !ID.test(m.id)) fail('id must look like "com.example.name"');
  for (const k of ['name', 'description', 'release'] as const) if (typeof m[k] !== 'string' || !m[k] || (m[k] as string).length > LIMITS.text) fail(`${k} is required (≤ ${LIMITS.text} characters)`);
  if (!Array.isArray(m.inputs) || m.inputs.length > LIMITS.inputs) fail(`inputs must be a list (≤ ${LIMITS.inputs})`);
  const names = new Set<string>();
  for (const i of m.inputs!) {
    if (!i || typeof i.name !== 'string' || !NAME.test(i.name)) fail(`input names must be lowercase identifiers ("${String(i?.name)}")`);
    const n = i.name as string;
    if (names.has(n)) fail(`duplicate input "${n}"`);
    names.add(n);
    if (i.type && i.type !== 'number' && i.type !== 'text') fail(`input "${n}" has unknown type`);
  }
  if (!Array.isArray(m.templates) || !m.templates.length || m.templates.length > LIMITS.templates) fail(`templates must be a non-empty list (≤ ${LIMITS.templates})`);
  for (const raw of m.templates!) {
    if (typeof raw !== 'string' || raw.length > LIMITS.templateLength) fail('templates must be short strings');
    const t = raw as string;
    const used = [...t.matchAll(/\{([a-z][a-z0-9_]*)\}/g)].map((x) => x[1]!);
    for (const u of used) if (!names.has(u)) fail(`template "${t}" uses unknown input {${u}}`);
    if (!used.length) fail(`template "${t}" has no {inputs}`);
    // A template of only slots ("{q}", "{a} {b}") would capture every question.
    if (!/\p{L}/u.test(t.replace(/\{[^}]*\}/g, ''))) fail(`template "${t}" needs at least one fixed word`);
    if (/\{(?![a-z][a-z0-9_]*\})/.test(t)) fail(`template "${t}" has a malformed placeholder`);
  }
  if (m.kind === 'formula') {
    if (typeof m.formula !== 'string' || !m.formula.trim() || m.formula.length > LIMITS.text) fail('formula is required');
    if (!m.output || typeof m.output !== 'object') fail('output is required');
  } else if (m.kind === 'script') {
    if (typeof m.script !== 'string' || !m.script.trim() || m.script.length > LIMITS.script) fail(`script is required (≤ ${LIMITS.script} characters)`);
    for (const p of m.permissions ?? []) if (typeof p !== 'string' || !PERMISSION.test(p)) fail(`unknown permission "${p}" (only network:host is supported)`);
  } else fail('kind must be "formula" or "script"');
  return m as unknown as PluginManifest;
}
