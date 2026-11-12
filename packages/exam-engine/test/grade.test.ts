import { describe, expect, it } from 'vitest';
import { adaptiveNext, buildExam, buildProfile, familyRules, grade, gradeNumeric, gradeQuestion, importedQuestions, importText, PRESETS, type ExamQuestion } from '../src';
import { emptyAttempt, fixture, perfectAttempt } from './helpers';

const test = importText('algebra2-unit4-test.txt', fixture('algebra2-unit4-test.txt'));
const imported = importedQuestions([test]);
const profile = buildProfile([test]);
const exam = buildExam(profile, { imported }, { seed: 42, now: 0 });

describe('grade on the mirrored class test', () => {
  it('a perfect attempt scores 100% and an A', () => {
    const r = grade(exam, perfectAttempt(exam));
    expect(r.percent).toBe(100);
    expect(r.raw).toBe(100);
    expect(r.possible).toBe(100);
    expect(r.score).toBe('A (100%)');
    expect(r.estimate).toBe(false);
    expect(r.perQuestion.every((p) => p.correct === true)).toBe(true);
    expect(r.bySection.map((s) => s.raw)).toEqual(r.bySection.map((s) => s.possible));
    expect(r.byTopic.reduce((s, t) => s + t.total, 0)).toBe(25);
  });

  it('known wrong answers cost exactly their points', () => {
    const a = perfectAttempt(exam);
    // Every Part A multiple-choice question answered with a wrong letter: 12 × 3 = 36 points.
    const partA = exam.profile.sections[0]!.questionIds.map((id) => exam.questions.find((q) => q.id === id)!);
    for (const q of partA.filter((x) => x.type === 'mc')) a.answers[q.id] = q.choices!.find((c) => c.id !== q.answer)!.id;
    // One part of a free-response question wrong.
    const fr = exam.questions.find((q) => q.number === 14)!;
    const rec = { ...(a.answers[fr.id] as Record<string, string>) };
    rec[fr.parts![0]!.label] = '12345';
    a.answers[fr.id] = rec;
    const r = grade(exam, a);
    expect(r.raw).toBe(100 - 36 - fr.parts![0]!.points);
    expect(r.percent).toBe(61);
    expect(r.score).toBe('D- (61%)');
    expect(r.bySection[0]!.raw).toBe(50 - 36 - 3);
    const p14 = r.perQuestion.find((p) => p.id === fr.id)!;
    expect(p14.correct).toBe('partial');
    expect(p14.earned).toBe(5);
    const wrong = r.perQuestion.find((p) => p.id === partA[0]!.id)!;
    expect(wrong.correct).toBe(false);
    expect(wrong.feedback).toMatch(/The answer is/);
  });

  it('accepts equivalent forms for numeric and expression keys', () => {
    const a = perfectAttempt(exam);
    const q13 = exam.questions.find((q) => q.number === 13)!; // "x = … or x = …"
    const roots = String(q13.answer).match(/-?−?\d+(?:\/\d+)?/g)!.map((r) => r.replace('−', '-'));
    a.answers[q13.id] = roots.reverse().join(', ');
    expect(grade(exam, a).perQuestion.find((p) => p.id === q13.id)!.correct).toBe(true);
  });

  it('flags slow questions in pacing', () => {
    const a = perfectAttempt(exam);
    const slow = exam.profile.sections[1]!.questionIds[2]!;
    a.timeSpent[slow] = 600_000;
    const r = grade(exam, a);
    expect(r.pacing.slowest).toEqual([slow]);
    expect(r.pacing.onPaceAt).toContain(exam.profile.sections[0]!.questionIds[0]);
  });
});

describe('self-graded parts', () => {
  it('rubric-only parts are left to the student and excluded from the auto score', () => {
    const reuse = buildExam(profile, { imported }, { seed: 1, reuseImported: true, now: 0 });
    const r = grade(reuse, perfectAttempt(reuse));
    const q25 = reuse.questions.find((q) => q.number === 25)!;
    const p25 = r.perQuestion.find((p) => p.id === q25.id)!;
    expect(p25.feedback).toMatch(/Self-grade: 10 pts/);
    expect(p25.feedback).toMatch(/shift 2 units left/);
    expect(r.possible).toBe(90);
    expect(r.percent).toBe(100);
  });
});

describe('numeric tolerance', () => {
  const sat = familyRules('sat-style');
  const cls = familyRules('class');
  const gre = familyRules('gre-style');
  it('applies SAT-style grid-in rules', () => {
    for (const ok of ['2/3', '.6666', '.6667', '0.666', '0.667']) expect(gradeNumeric('2/3', ok, sat).correct, ok).toBe(true);
    for (const bad of ['.66', '.67', '0.67', '0.66']) expect(gradeNumeric('2/3', bad, sat).correct, bad).toBe(false);
    expect(gradeNumeric('-1/3', '-.3333', sat).correct).toBe(true);
  });
  it('accepts fractions as decimals and correct rounding where the family allows it', () => {
    expect(gradeNumeric('1/4', '0.25', gre).correct).toBe(true);
    expect(gradeNumeric('2/3', '0.67', cls).correct).toBe(true);
    expect(gradeNumeric('2/3', '0.7', cls).correct).toBe(false);
    expect(gradeNumeric('2/3', '0.67', gre).correct).toBe(false);
    expect(gradeNumeric('3.66', '3.66', gre, 'Round to 2 decimal places.').correct).toBe(true);
    expect(gradeNumeric('5', 'x = 5', gre).correct).toBe(true);
    expect(gradeNumeric('5', '-5', gre).feedback).toMatch(/sign/);
  });
  it('uses practice-engine equivalence for expressions', () => {
    const q: ExamQuestion = { id: 'e', number: 1, type: 'expression', prompt: 'Find the derivative of f(x) = 4x^3 - 2x + 7.', answer: '12x^2 − 2', points: 2, origin: 'generated' };
    expect(gradeQuestion(q, '2(6x^2 - 1)', cls).correct).toBe(true);
    expect(gradeQuestion(q, '12x^2 + 2', cls).correct).toBe(false);
  });
  it('gives select-all partial credit only where the family uses it', () => {
    const q: ExamQuestion = { id: 'm', number: 1, type: 'multi', prompt: 'Select all that apply.', choices: 'ABCDE'.split('').map((id) => ({ id, text: id })), answer: ['A', 'C', 'D'], points: 3, origin: 'imported' };
    expect(gradeQuestion(q, ['A', 'C', 'D'], gre).earned).toBe(3);
    expect(gradeQuestion(q, ['A', 'C'], gre).earned).toBe(0);
    const partial = gradeQuestion(q, ['A', 'C'], cls);
    expect(partial.correct).toBe('partial');
    expect(partial.earned).toBe(2);
    expect(gradeQuestion(q, ['A', 'B'], cls).earned).toBe(0);
  });
});

describe('adaptive routing and scaled scores', () => {
  const sat = buildExam(PRESETS['sat-style'], { imported }, { seed: 9, now: 0 });
  it('routes to the hard module after a strong module 1 and the easy one after a weak one', () => {
    const strong = perfectAttempt(sat);
    expect(adaptiveNext(sat, strong, 'm2')).toBe('hard');
    expect(adaptiveNext(sat, strong, 'm1')).toBe('hard');
    expect(adaptiveNext(sat, emptyAttempt(sat), 'm2')).toBe('easy');
    // 12 of 22 right (55%) is below the 0.6 threshold; 14 (64%) is above it.
    for (const [right, route] of [[12, 'easy'], [14, 'hard']] as const) {
      const a = emptyAttempt(sat);
      for (const id of sat.profile.sections[0]!.questionIds.slice(0, right)) a.answers[id] = perfectAttempt(sat).answers[id]!;
      expect(adaptiveNext(sat, a, 'm2')).toBe(route);
    }
    expect(() => adaptiveNext(sat, strong, 'nope')).toThrow();
  });

  it('labels scaled scores as estimates and caps the easy route', () => {
    const r = grade(sat, perfectAttempt(sat));
    expect(r.percent).toBe(100);
    expect(r.score).toBe('≈ 800 (estimate)');
    expect(r.estimate).toBe(true);
    expect(r.perQuestion).toHaveLength(44);
    const blank = grade(sat, emptyAttempt(sat));
    expect(blank.score).toBe('≈ 200 (estimate)');
    // Perfect module 1 but recorded on the easy route: the cap keeps the estimate below 800.
    const a = perfectAttempt(sat);
    a.sectionOrder = ['m1', 'm2:easy'];
    for (const id of sat.profile.sections[1]!.adaptive!.easy) a.answers[id] = (sat.questions.find((q) => q.id === id)!.answer ?? '') as string;
    const easy = grade(sat, a);
    expect(easy.percent).toBe(100);
    expect(easy.score).toBe('≈ 680 (estimate)');
  });

  it('scores other families on their scales', () => {
    const scoreOf = (id: keyof typeof PRESETS) => {
      const e = buildExam(PRESETS[id], { imported: [] }, { seed: 11, now: 0 });
      return grade(e, perfectAttempt(e)).score;
    };
    expect(scoreOf('act-style')).toBe('≈ 36 (estimate)');
    expect(scoreOf('gre-style')).toBe('≈ 170 (estimate)');
    expect(scoreOf('ap-style')).toBe('5 (estimate)');
    expect(scoreOf('ib-style')).toBe('7 (estimate)');
    expect(scoreOf('psat-style')).toBe('≈ 760 (estimate)');
    expect(scoreOf('class')).toBe('A (100%)');
  });
});

describe('answers in the form the question asks for', () => {
  const cls = familyRules('class');
  const q = (prompt: string, answer: string, type: ExamQuestion['type'] = 'expression'): ExamQuestion => ({ id: 'f', number: 1, type, prompt, answer, points: 1, origin: 'imported' });
  const ok = (qq: ExamQuestion, a: string) => gradeQuestion(qq, a, cls).correct;

  it('copying the expression from the question earns nothing', () => {
    expect(ok(q('Factor x^2 - 9.', '(x - 3)(x + 3)'), 'x^2 - 9')).toBe(false);
    expect(ok(q('Simplify 4(x + 2) - 3x.', 'x + 8'), '4(x+2)-3x')).toBe(false);
    expect(ok(q('Write f(x) = x^2 - 6x + 5 in vertex form.', 'f(x) = (x - 3)^2 - 4'), 'x^2 - 6x + 5')).toBe(false);
    expect(gradeQuestion(q('Factor x^2 - 9.', '(x - 3)(x + 3)'), 'x^2-9', cls).feedback).toMatch(/needs to be factored/);
  });

  it('equivalent answers in the asked form still count', () => {
    expect(ok(q('Factor x^2 - 9.', '(x - 3)(x + 3)'), '(x+3)(x-3)')).toBe(true);
    expect(ok(q('Simplify 4(x + 2) - 3x.', 'x + 8'), '8 + x')).toBe(true);
    expect(ok(q('Write f(x) = x^2 - 6x + 5 in vertex form.', 'f(x) = (x - 3)^2 - 4'), '(x-3)^2 - 4')).toBe(true);
    expect(ok(q('Expand (x + 2)^2.', 'x^2 + 4x + 4'), '4 + 4x + x^2')).toBe(true);
    expect(ok(q('Expand (x + 2)^2.', 'x^2 + 4x + 4'), '(x+2)(x+2)')).toBe(false);
  });

  it('"factor completely" refuses partial factoring and a common factor left inside a bracket', () => {
    const fc = (a: string) => gradeQuestion(q('Factor completely: 2x^2 + 4x - 6', '2(x + 3)(x - 1)'), a, cls);
    expect(fc('2(x^2+2x-3)').correct).toBe(false);
    expect(fc('2(x^2+2x-3)').feedback).toMatch(/not factored completely: x\^2\+2x-3 still factors/);
    expect(fc('(2x+6)(x-1)').correct).toBe(false);
    expect(fc('(2x+6)(x-1)').feedback).toMatch(/take the common factor 2 out/);
    expect(fc('(x-1)(2x+6)').correct).toBe(false);
    expect(fc('2(x-1)(x+3)').correct).toBe(true);
    expect(fc('2 * (x + 3) * (x - 1)').correct).toBe(true);
    const cube = (a: string) => gradeQuestion(q('Factor x^3 - x.', 'x(x - 1)(x + 1)'), a, cls);
    expect(cube('x(x^2-1)').correct).toBe(false);
    expect(cube('(x+1)(x^2-x)').feedback).toMatch(/x\^2-x still factors/);
    expect(cube('x(x+1)(x-1)').correct).toBe(true);
    // Repeated factors count with their exponent, either way round.
    expect(ok(q('Factor x^3 + 2x^2 + x.', 'x(x + 1)^2'), 'x(x+1)(x+1)')).toBe(true);
    expect(ok(q('Factor x^3 + 2x^2 + x.', 'x(x + 1)(x + 1)'), 'x(x+1)^2')).toBe(true);
    expect(ok(q('Factor 4x^2 - 9.', '(2x - 3)(2x + 3)'), '(2x+3)(2x-3)')).toBe(true);
  });

  it('"solve by factoring" grades the solutions, not their form', () => {
    expect(ok(q('Solve x^2 - x - 2 = 0 by factoring.', 'x = -1 or x = 2', 'numeric'), '2, -1')).toBe(true);
  });

  it('a monomial key is not its coefficient ("6" is not "6x")', () => {
    expect(ok(q('Simplify x + 5x.', '6x'), '6')).toBe(false);
    expect(ok(q('Simplify x + 5x.', '6x', 'numeric'), '6')).toBe(false);
    expect(ok(q('Simplify (2x^2)(3x^3).', '6x^5'), '6x^5')).toBe(true);
    expect(ok(q('Simplify (2x^2)(3x^3).', '6x^5'), '6')).toBe(false);
    // Units still drop: "12 cm" ≡ 12.
    expect(ok(q('How long is the side?', '12 cm', 'numeric'), '12')).toBe(true);
    expect(ok(q('How far?', '5 m', 'numeric'), '5')).toBe(true);
  });
});
