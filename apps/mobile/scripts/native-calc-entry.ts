// Entry point for the JavaScriptCore calculator bundled into the iOS app (Siri / Shortcuts / share sheet).
// Built by scripts/build-native-calc.mjs into ios/App/App/Calc/lemma-calc.js as an IIFE that sets
// `globalThis.Lemma`. Swift calls `Lemma.answer(text)` and gets a JSON string back.
import { calculate, createSession } from '@lemma/math-core';
import { convert, unitLabel } from '@lemma/unit-engine';
import { answerFinance, LOOKS_LIKE_FINANCE } from '@lemma/finance-engine';

export interface NativeAnswer {
  ok: boolean;
  kind?: string;
  /** What to show: "11.52", "3.10686 mi". */
  display?: string;
  /** What was understood: "18% × 64", "5 km → mi". */
  expression?: string;
  /** Text for Siri to speak. */
  spoken?: string;
  approximate?: boolean;
  fraction?: string;
  error?: string;
}

const MAX = 500;

export function answer(raw: string): string {
  return JSON.stringify(solve(String(raw ?? '')));
}

function solve(raw: string): NativeAnswer {
  const input = raw.trim().replace(/[?？]+$/, '').slice(0, MAX);
  if (!input) return { ok: false, error: 'empty' };
  try {
    const session = createSession();
    // Same order as the app's router (packages/runtime/src/router.ts): finance phrasing ("18% tip on 64",
    // "split 120 between 4"), then unit conversion, then the core calculator.
    if (LOOKS_LIKE_FINANCE.test(input)) {
      const f = answerFinance(input, { currency: '$' });
      if (f) {
        if (!f.ok) return { ok: false, error: f.error.message };
        // Tables, schedules and comparisons read better in the app.
        if (f.table) return { ok: false, error: 'needs-app' };
        return { ok: true, kind: f.kind, display: f.primary.display, expression: f.expression, spoken: f.primary.spoken, approximate: f.exactness === 'approximate' };
      }
    }
    const conv = convert(input, session);
    if (conv) {
      if (!conv.ok) return { ok: false, error: conv.error.message };
      const lines = conv.results.map((r) => `${r.formatted.display} ${unitLabel(r.unit, r.value)}`);
      const spoken = conv.results.map((r) => `${r.formatted.spoken} ${r.value.abs().eq(1) ? r.unit.singular : r.unit.plural}`).join(', ');
      return { ok: true, kind: 'convert', display: lines.join(', '), expression: conv.expression, spoken, approximate: conv.results.some((r) => r.formatted.rounded) };
    }
    const r = calculate(input, session);
    if (!r.ok) return { ok: false, error: r.error.message };
    // Saved formulas and variable assignments only make sense inside the app's session.
    if (r.definition || r.assignment || r.assignments) return { ok: false, error: 'needs-app' };
    return {
      ok: true,
      kind: 'calc',
      display: r.formatted.display,
      expression: r.expression,
      spoken: r.formatted.spoken,
      approximate: r.approximate,
      fraction: r.fraction,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
