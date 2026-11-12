import { MathError, type AnswerResult, type Dec } from '@lemma/math-core';
import { extract } from './extract';
import { apy, cagr, compound, irr, loan, npv, presentValue, roi, type Ctx } from './finance';
import { breakEven, compare, margin, split, tax, tip } from './shopping';

// Order matters: specific intents before broad ones ("interest" appears in loan questions too).
const HANDLERS = [compare, tip, split, breakEven, margin, tax, npv, irr, cagr, apy, roi, presentValue, loan, compound];

export interface FinanceOptions {
  /** Symbol used when the question names no currency. */
  currency?: string;
  /** The previous answer, used when the question says "that", "it" or "the bill" instead of an amount. */
  ans?: Dec | null;
}

/** Finance, business and shopping maths. Returns null when the input is not one of these questions. */
export function answerFinance(input: string, opts: FinanceOptions = {}): AnswerResult | null {
  const s = input.toLowerCase().replace(/[’]/g, "'").replace(/[?!]+$/, '').replace(/\s+/g, ' ').trim();
  const c: Ctx = { input, s, x: extract(s, opts.currency ?? '$'), ans: opts.ans };
  for (const h of HANDLERS) {
    try {
      const r = h(c);
      if (r) return r;
    } catch (e) {
      return { ok: false, kind: 'finance', input, error: new MathError('domain', e instanceof Error ? e.message : String(e)) };
    }
  }
  return null;
}

export const LOOKS_LIKE_FINANCE =
  /\b(?:loan|mortgage|borrow|payment|amortiz\w*|interest|compound\w*|invest\w*|savings?|deposit|apy|apr|npv|irr|roi|cagr|growth rate|present value|future value|tip|gratuity|split|share|divvy|tax|vat|gst|margin|markup|mark.?up|profit|break.?even|compare|cheaper|cheapest|better (?:deal|value)|best (?:deal|value)|unit price|price per|cost per|vs|versus|return)\b/i;
