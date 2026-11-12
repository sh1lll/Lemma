/** Runs one corpus case through the real router and says what (if anything) is wrong with the answer. */
import { createSession } from '@lemma/math-core';
import type { Outcome, Runtime } from '../../src/router';
import type { Case } from './generate';

export interface Got {
  kind: Outcome['kind'];
  display: string;
  value?: { toString(): string; eq(x: string): boolean };
  fraction?: string;
  message?: string;
}

export async function run(rt: Runtime, input: string): Promise<Got> {
  const o = await rt.compute(input, createSession(), { liveRates: false });
  switch (o.kind) {
    case 'calc':
      return { kind: o.kind, display: o.result.formatted.display, value: o.result.value, fraction: o.result.fraction };
    case 'answer':
      return { kind: o.kind, display: o.result.primary.display, value: o.result.value };
    case 'convert': {
      const line = o.result.results[0]!;
      return { kind: o.kind, display: line.formatted.display, value: line.value };
    }
    case 'error':
      return { kind: o.kind, display: '', message: o.error.message };
    default:
      return { kind: o.kind, display: '' };
  }
}

/** Null when the answer is right; otherwise a one-line description of the discrepancy. */
export function verdict(c: Case, g: Got): string | null {
  if (c.error) {
    if (g.kind !== 'error') return `expected a refusal, got ${g.kind} ${g.display || g.value?.toString()}`;
    if (c.error instanceof RegExp && !c.error.test(g.message ?? '')) return `refused with "${g.message}", expected ${c.error}`;
    return null;
  }
  if (g.kind === 'error') return `error: ${g.message}`;
  if (c.num !== undefined) {
    if (!g.value) return `no numeric value (display "${g.display}")`;
    if (typeof c.num === 'string') {
      if (!g.value.eq(c.num)) return `value ${g.value.toString()} ≠ ${c.num}`;
    } else {
      const v = Number(g.value.toString());
      const tol = Math.max(c.abs ?? 1e-12, (c.rel ?? 1e-9) * Math.abs(c.num));
      if (!(Math.abs(v - c.num) <= tol)) return `value ${g.value.toString()} ≠ ${c.num} (tol ${tol.toExponential(1)})`;
    }
  }
  if (c.display !== undefined && g.display !== c.display) return `display "${g.display}" ≠ "${c.display}"`;
  if (c.fraction !== undefined && g.fraction !== c.fraction) return `fraction ${g.fraction ?? '(none)'} ≠ ${c.fraction}`;
  return null;
}
