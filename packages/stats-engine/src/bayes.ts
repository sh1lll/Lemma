import type { AnswerResult } from '@lemma/math-core';
import { asProb, f, fail, need, NUM, ok, primaryOf, probValue, take, type Ctx } from './common';

const NOT = "(?:not\\s*|!\\s*)";
const NEG_SUFFIX = "(?:'|c\\b|\\^c\\b|\\s*complement)";

interface Probs {
  prior: number | null; // P(A)
  like: number | null; // P(B|A)
  alt: number | null; // P(B|¬A)
  evidence: number | null; // P(B)
  joint: number | null; // P(A and B)
  a: string;
  b: string;
}

function val(raw: string, pct: string | undefined): number {
  return probValue(Number(raw), !!pct);
}

/** Reads P(·) assignments written in symbols. */
function symbolic(s: string): Probs {
  const out: Probs = { prior: null, like: null, alt: null, evidence: null, joint: null, a: 'a', b: 'b' };
  const assign = `\\s*(?:=|is|of|:)?\\s*(${NUM})\\s*(%)?`;
  // conditionals first: P(B|A), P(B|not A)
  const cond = new RegExp(`p\\s*\\(\\s*(${NOT})?([a-z+\\-]+)${NEG_SUFFIX}?\\s*\\|\\s*(${NOT})?([a-z+\\-]+)(${NEG_SUFFIX})?\\s*\\)${assign}`, 'g');
  const conds: { b: string; a: string; neg: boolean; v: number }[] = [];
  for (const m of s.matchAll(cond)) {
    if (m[1]) continue; // P(not B | A) is not used
    conds.push({ b: m[2]!, a: m[4]!, neg: !!(m[3] || m[5]), v: val(m[6]!, m[7]) });
  }
  const single = new RegExp(`p\\s*\\(\\s*(${NOT})?([a-z+\\-]+)(${NEG_SUFFIX})?\\s*\\)${assign}`, 'g');
  const singles = [...s.matchAll(single)].map((m) => ({ e: m[2]!, neg: !!(m[1] || m[3]), v: val(m[4]!, m[5]) }));
  const joint = new RegExp(`p\\s*\\(\\s*([a-z+\\-]+)\\s*(?:and|&|,|∩|\\^)\\s*([a-z+\\-]+)\\s*\\)${assign}`).exec(s);

  if (conds.length) {
    out.a = conds[0]!.a;
    out.b = conds[0]!.b;
  } else if (joint) {
    out.a = joint[1]!;
    out.b = joint[2]!;
  }
  for (const c of conds) {
    if (c.a !== out.a || c.b !== out.b) continue;
    if (c.neg) out.alt = c.v;
    else out.like = c.v;
  }
  for (const x of singles) {
    if (x.e === out.a) out.prior = x.neg ? 1 - x.v : x.v;
    else if (x.e === out.b && !x.neg) out.evidence = x.v;
  }
  if (joint) out.joint = val(joint[3]!, joint[4]);
  return out;
}

export function bayes(c: Ctx): AnswerResult | null {
  const symbolicCond = /p\s*\(\s*[^)|]+\|[^)]+\)/.test(c.s);
  const worded = /\b(?:prevalence|base rate|prior|sensitivity|specificity|false positive|true positive)\b/.test(c.s);
  if (!/\bbayes\b|\bbayesian\b/.test(c.s) && !symbolicCond && !worded) return null;
  if (!symbolicCond && !worded && !/\bp\s*\(/.test(c.s)) return need(c, 'Give P(A), P(B|A) and P(B|not A), e.g. "bayes P(A)=0.01 P(B|A)=0.9 P(B|not A)=0.05"');

  const p = symbolic(c.s);
  const notes: string[] = [];
  // Worded medical-test form.
  const prior = asProb(take(c, 'prevalence|base rate|prior(?: probability)?'), 'The prevalence');
  if (prior !== null) p.prior = prior;
  const sens = asProb(take(c, 'sensitivity|true positive rate|hit rate|detection rate'), 'The sensitivity');
  if (sens !== null) p.like = sens;
  const fpr = asProb(take(c, 'false positive rate|false positive|false alarm rate'), 'The false positive rate');
  if (fpr !== null) p.alt = fpr;
  const spec = asProb(take(c, 'specificity|true negative rate'), 'The specificity');
  if (spec !== null && p.alt === null) {
    p.alt = 1 - spec;
    notes.push(`False-positive rate = 1 − specificity = ${f(p.alt, 8)}`);
  }
  if (worded && !symbolicCond) {
    p.a = 'condition';
    p.b = 'positive';
  }
  const A = p.a.toUpperCase().length === 1 ? p.a.toUpperCase() : p.a;
  const B = p.b.toUpperCase().length === 1 ? p.b.toUpperCase() : p.b;

  for (const v of [p.prior, p.like, p.alt, p.evidence, p.joint]) if (v !== null && !(v >= 0 && v <= 1)) fail('Probabilities must be between 0 and 1');

  // P(A|B) = P(A and B) / P(B)
  if (p.joint !== null && p.like === null) {
    if (p.evidence === null) return need(c, `What is P(${B})?`);
    if (p.evidence === 0) fail(`P(${B}) is 0, so P(${A}|${B}) is undefined`);
    const post = p.joint / p.evidence;
    const { primary, value } = primaryOf(post, 10);
    return ok(c, {
      expression: `Conditional probability P(${A}|${B}) = P(${A} and ${B}) / P(${B})`,
      primary,
      value,
      lines: [{ label: `P(${A}|${B})`, display: `${f(p.joint, 8)} / ${f(p.evidence, 8)} = ${f(post, 8)}` }],
      notes,
    });
  }

  if (p.prior === null) return need(c, worded ? 'What is the prevalence (prior probability)?' : `What is P(${A})?`);
  if (p.like === null) return need(c, worded ? 'What is the test sensitivity (P(positive | condition))?' : `What is P(${B}|${A})?`);
  const lines: { label: string; display: string }[] = [{ label: `P(not ${A})`, display: `1 − ${f(p.prior, 8)} = ${f(1 - p.prior, 8)}` }];
  let pb: number;
  if (p.alt !== null) {
    pb = p.like * p.prior + p.alt * (1 - p.prior);
    lines.push({
      label: `P(${B})`,
      display: `${f(p.like, 8)} × ${f(p.prior, 8)} + ${f(p.alt, 8)} × ${f(1 - p.prior, 8)} = ${f(pb, 10)}`,
    });
  } else if (p.evidence !== null) {
    pb = p.evidence;
    lines.push({ label: `P(${B})`, display: f(pb, 10) });
  } else {
    return need(c, worded ? 'What is the false-positive rate (or the specificity)?' : `What is P(${B}|not ${A}) (or P(${B}))?`);
  }
  if (pb === 0) fail(`P(${B}) is 0, so P(${A}|${B}) is undefined`);
  const post = (p.like * p.prior) / pb;
  if (post > 1 + 1e-12) fail(`These numbers are inconsistent: P(${A}|${B}) would exceed 1`);
  lines.push({ label: `P(${A}|${B})`, display: `${f(p.like, 8)} × ${f(p.prior, 8)} / ${f(pb, 10)} = ${f(post, 10)}` });
  if (p.alt !== null) {
    const pnb = 1 - pb;
    if (pnb > 0) lines.push({ label: `P(${A}|not ${B})`, display: f(((1 - p.like) * p.prior) / pnb, 10) });
  }
  notes.push(`Bayes' theorem: P(${A}|${B}) = P(${B}|${A})·P(${A}) / P(${B})`);
  const { primary, value } = primaryOf(post, 10);
  return ok(c, {
    expression: worded ? 'Probability of the condition given a positive result (Bayes)' : `Bayes' theorem · P(${A}|${B})`,
    primary,
    value,
    lines,
    notes,
  });
}
