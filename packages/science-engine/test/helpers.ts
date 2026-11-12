import type { Answer, AnswerFailure } from '@lemma/math-core';
import { expect } from 'vitest';
import { answerScience } from '../src';

export function ask(input: string): Answer {
  const r = answerScience(input);
  if (!r) throw new Error(`"${input}" not recognised`);
  if (!r.ok) throw new Error(`"${input}" failed: ${r.error.message}`);
  return r;
}
export function failure(input: string): AnswerFailure {
  const r = answerScience(input);
  if (!r) throw new Error(`"${input}" not recognised`);
  if (r.ok) throw new Error(`"${input}" unexpectedly answered ${r.primary.display}`);
  return r;
}
/** A missing input must come back as a question, never a guess. */
export function expectNeed(input: string, pattern: RegExp) {
  const f = failure(input);
  expect(f.error.code).toBe('ambiguous-reference');
  expect(f.error.message).toMatch(pattern);
}
export const show = (input: string) => ask(input).primary.display;
export const val = (input: string) => {
  const v = ask(input).value;
  if (!v) throw new Error(`"${input}" has no value`);
  return v.toNumber();
};
export const line = (input: string, label: string) => ask(input).lines?.find((l) => l.label === label)?.display;
