import { describe, expect, it } from 'vitest';
import { check } from '@lemma/practice-engine';
import { buildExam, buildProfile, importedQuestions, importText, PRESETS, sectionCount, sectionQuestionIds, verifyQuestion, type Exam, type ExamQuestion } from '../src';
import { evalNumber, keyQuestion, matches } from '../src/math';
import { distractors, monomialCandidates } from '../src/distractors';
import { makeVariant } from '../src/variants';
import { Rng } from '../src/util';
import { fixture } from './helpers';

const test = importText('algebra2-unit4-test.txt', fixture('algebra2-unit4-test.txt'));
const imported = importedQuestions([test]);
const profile = buildProfile([test]);

function allSlotsFilled(exam: Exam) {
  for (const s of exam.profile.sections) {
    const pools = s.adaptive ? [s.adaptive.easy, s.adaptive.hard] : [s.questionIds];
    for (const ids of pools) for (const id of ids) expect(exam.questions.find((q) => q.id === id), id).toBeTruthy();
  }
}

/** Every question's key is verified by Lemma's checker; MC choices are distinct with the key once. */
function expectVerified(q: ExamQuestion) {
  expect(verifyQuestion(q), `${q.id}: ${q.prompt}`).toEqual([]);
  if (q.type === 'mc' && q.choices && !/Quantity A/.test(q.prompt)) {
    const key = q.choices.find((c) => c.id === q.answer)!.text;
    const same = q.choices.filter((c) => matches(key, c.text).correct);
    expect(same.map((c) => c.id), q.prompt).toEqual([q.answer]);
    const texts = q.choices.map((c) => c.text.replace(/\s+/g, ''));
    expect(new Set(texts).size).toBe(texts.length);
  }
  const keys = q.parts?.length ? q.parts.filter((p) => p.answer).map((p) => p.answer!) : q.choices ? [] : [String(q.answer)];
  for (const k of keys) expect(check(keyQuestion(k, q.prompt), k).correct, `${q.id} key ${k}`).toBe(true);
}

describe('buildExam from the mirrored class test', () => {
  const exam = buildExam(profile, { imported }, { seed: 42, now: 0 });

  it('fills every section with the same count, types and points', () => {
    allSlotsFilled(exam);
    expect(exam.questions).toHaveLength(25);
    const byNumber = (n: number) => exam.questions.find((q) => q.number === n)!;
    for (const orig of imported) {
      const q = byNumber(orig.number);
      expect(q.type, `Q${orig.number}`).toBe(orig.type);
      expect(q.points).toBe(orig.points);
      if (orig.choices) expect(q.choices).toHaveLength(orig.choices.length);
    }
    expect(exam.questions.reduce((s, q) => s + q.points, 0)).toBe(100);
    expect(exam.questions.filter((q) => q.number <= 14).every((q) => q.calculator === false)).toBe(true);
  });

  it('has verified answers and plausible, distinct distractors', () => {
    for (const q of exam.questions) expectVerified(q);
  });

  it('prefers variants of the student’s questions and keeps their wording', () => {
    const variants = exam.questions.filter((q) => q.origin === 'variant');
    expect(variants.length).toBeGreaterThanOrEqual(10);
    for (const v of variants) {
      const orig = imported.find((o) => o.number === v.number)!;
      expect(v.prompt).not.toBe(orig.prompt);
      const words = (s: string) => (s.replace(/Show your work\.?/i, '').match(/[A-Za-z]{3,}/g) ?? []).join(' ');
      expect(words(v.prompt)).toBe(words(orig.prompt)); // the teacher's wording
      expect(v.type).toBe(orig.type);
      expect(v.steps?.length).toBeGreaterThan(0);
    }
  });

  it('falls back to generated questions of the same topic for non-computable ones', () => {
    const q9 = exam.questions.find((q) => q.number === 9)!; // figure question
    expect(q9.origin).toBe('generated');
    expect(q9.topic).toBe('quadratic');
    const q14 = exam.questions.find((q) => q.number === 14)!; // multi-part
    expect(q14.type).toBe('free');
    expect(q14.parts).toHaveLength(3);
    expect(q14.parts!.map((p) => p.points)).toEqual([3, 3, 2]);
  });

  it('is deterministic by seed', () => {
    const again = buildExam(profile, { imported }, { seed: 42, now: 0 });
    expect(again).toEqual(exam);
    const other = buildExam(profile, { imported }, { seed: 43, now: 0 });
    expect(other.questions.map((q) => q.prompt)).not.toEqual(exam.questions.map((q) => q.prompt));
  });

  it('can reuse the imported questions verbatim', () => {
    const reuse = buildExam(profile, { imported }, { seed: 1, reuseImported: true, now: 0 });
    const q1 = reuse.questions.find((q) => q.number === 1)!;
    expect(q1.origin).toBe('imported');
    expect(q1.prompt).toBe(imported[0]!.prompt);
    expect(q1.answer).toBe('B');
    expect(q1.steps?.length).toBeGreaterThan(0);
    const q25 = reuse.questions.find((q) => q.number === 25)!;
    expect(q25.parts?.[0]?.rubric).toHaveLength(3); // rubric-only: self-graded later
  });
});

describe.each(Object.keys(PRESETS) as (keyof typeof PRESETS)[])('buildExam with the %s preset', (id) => {
  const p = PRESETS[id];
  const exam = buildExam(p, { imported }, { seed: 7, now: 0 });
  it('fills the structure with verified questions', () => {
    allSlotsFilled(exam);
    const expected = p.sections.reduce((s, x) => s + (x.adaptive ? x.adaptive.easy.length + x.adaptive.hard.length : x.questionIds.length), 0);
    expect(exam.questions).toHaveLength(expected);
    for (const q of exam.questions) expectVerified(q);
    for (const s of exam.profile.sections) for (const id of sectionQuestionIds(s, 'hard')) expect(exam.questions.find((q) => q.id === id)!.calculator).toBe(s.calculator);
  });
  it('keeps the slot types and points', () => {
    for (const [i, s] of p.sections.entries()) {
      const slots = s.adaptive ? s.adaptive.hard : s.questionIds;
      const built = sectionQuestionIds(exam.profile.sections[i]!, 'hard');
      expect(built).toHaveLength(sectionCount(s));
      slots.forEach((slot, k) => {
        const [, type, pts] = slot.split(':');
        const q = exam.questions.find((x) => x.id === built[k])!;
        expect(q.type).toBe(type === 'qc' ? 'mc' : type);
        expect(q.points).toBeCloseTo(Number(pts));
      });
    }
  });
});

describe('adaptive pools', () => {
  const exam = buildExam(PRESETS['sat-style'], { imported: [] }, { seed: 3, now: 0 });
  it('make module 2 hard pool harder than the easy pool', () => {
    const m2 = exam.profile.sections[1]!.adaptive!;
    const avg = (ids: string[]) => ids.reduce((s, id) => s + (exam.questions.find((q) => q.id === id)!.difficulty ?? 0), 0) / ids.length;
    expect(avg(m2.hard)).toBeGreaterThan(avg(m2.easy));
    const m1 = exam.profile.sections[0]!.questionIds.map((id) => exam.questions.find((q) => q.id === id)!.difficulty!);
    expect(m1[0]).toBeLessThanOrEqual(m1[m1.length - 1]!); // easy → hard within the module
  });
  it('mix about 75% MC with 4 choices and 25% numeric entry', () => {
    const ids = exam.profile.sections[0]!.questionIds;
    const qs = ids.map((id) => exam.questions.find((q) => q.id === id)!);
    expect(qs.filter((q) => q.type === 'mc' && q.choices?.length === 4)).toHaveLength(17);
    expect(qs.filter((q) => q.type === 'numeric')).toHaveLength(5);
    expect(qs.filter((q) => q.type === 'numeric').every((q) => evalNumber(String(q.answer)) !== null)).toBe(true);
  });
});

describe('variants', () => {
  const rng = () => new Rng(5);
  const q = (prompt: string, answer: string, type: ExamQuestion['type'] = 'numeric'): ExamQuestion => ({ id: 'x', number: 1, type, prompt, answer, points: 1, origin: 'imported' });
  it('re-number and recompute', () => {
    for (const [prompt, ans] of [
      ['Solve for x: 3x + 7 = 22.', 'x = 5'],
      ['Solve x^2 - 5x + 6 = 0.', 'x = 2 or x = 3'],
      ['What is 18% of 250?', '45'],
      ['Find the mean of 12, 15, 9, 20, 14.', '14'],
      ['Solve the system 2x + y = 11 and x - y = 1.', 'x = 4, y = 3'],
      ['$2,000 is invested at 5% per year, compounded annually. What is it worth after 3 years? Round to the nearest cent.', '$2,315.25'],
      ['Find the derivative of f(x) = 4x^3 - 2x + 7.', '12x^2 - 2'],
    ] as const) {
      const v = makeVariant(q(prompt, ans), rng());
      expect(v, prompt).not.toBeNull();
      expect(v!.prompt).not.toBe(prompt);
      expect(matches(ans, v!.answer).correct).toBe(false);
      expect(v!.steps.length).toBeGreaterThan(0);
    }
  });
  it('refuse when Lemma disagrees with the key or cannot solve it', () => {
    expect(makeVariant(q('Solve for x: 3x + 7 = 22.', 'x = 6'), rng())).toBeNull();
    expect(makeVariant(q('What is the vertex of y = (x - 4)^2 + 1?', '(4, 1)'), rng())).toBeNull();
  });
});

describe('distractors', () => {
  it('model real mistakes and never equal the key', () => {
    const d = distractors('x = 5', 3, { prompt: 'Solve 3x + 7 = 22.', topic: 'linear', rng: new Rng(1) });
    expect(d).toEqual(expect.arrayContaining(['x = 15'])); // forgot to divide by 3
    expect(d).toHaveLength(3);
    expect(d).not.toContain('x = 5');
    const money = distractors('$2,315.25', 3, { prompt: '$2,000 is invested at 5% per year, compounded annually. What is it worth after 3 years?', topic: 'money', rng: new Rng(1) });
    expect(money).toContain('$2,300.00'); // simple interest
    const ooo = distractors('29', 3, { prompt: 'Evaluate 11 + 2 × 9.', topic: 'arithmetic', rng: new Rng(1) });
    expect(ooo).toContain('117'); // left to right
    expect(monomialCandidates('x', 'Simplify (x^4)^2 / x^7.')).toContain('x^15'); // multiplied then added
    const roots = distractors('x = 2 or x = 3', 3, { prompt: 'Solve x^2 - 5x + 6 = 0.', topic: 'quadratic', rng: new Rng(1) });
    expect(roots[0]).toBe('x = −3 or x = −2'); // sign error from the factors
  });
});
