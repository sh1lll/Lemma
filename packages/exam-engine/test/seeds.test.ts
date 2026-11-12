import { describe, expect, it } from 'vitest';
import { buildExam, buildProfile, grade, importedQuestions, importText, PRESETS, verifyQuestion } from '../src';
import { fixture, perfectAttempt } from './helpers';

/** Many seeds × every format: every question verified, every perfect attempt scores 100%. */
describe('seed sweep', () => {
  const docs = [importText('test.txt', fixture('algebra2-unit4-test.txt')), importText('gre.txt', fixture('gre-quant-sample.txt')), importText('guide.txt', fixture('calculus-study-guide.txt'))];
  const imported = importedQuestions(docs);
  const profiles = [buildProfile([docs[0]!]), ...Object.values(PRESETS)];
  it.each(profiles.map((p) => [p.id, p] as const))('%s', (_id, p) => {
    for (let seed = 100; seed < 108; seed++) {
      const exam = buildExam(p, { imported }, { seed, now: 0 });
      for (const q of exam.questions) expect(verifyQuestion(q), `${p.id} seed ${seed} ${q.prompt}`).toEqual([]);
      expect(grade(exam, perfectAttempt(exam)).percent, `${p.id} seed ${seed}`).toBe(100);
    }
  });
});
