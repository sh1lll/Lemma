import { readFileSync } from 'node:fs';
import type { Attempt, Exam, ExamQuestion } from '../src';
import { adaptiveNext, sectionQuestionIds } from '../src';

export const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

/** The key as a student would enter it. */
export function keyAnswer(q: ExamQuestion): Attempt['answers'][string] | undefined {
  if (q.parts?.length) {
    const rec: Record<string, string> = {};
    for (const p of q.parts) if (p.answer !== undefined) rec[p.label] = p.answer;
    return rec;
  }
  return q.answer;
}

/** A perfect attempt that follows the adaptive route the answers earn. */
export function perfectAttempt(exam: Exam): Attempt {
  const attempt: Attempt = { examId: exam.id, startedAt: 0, finishedAt: 1, answers: {}, flagged: [], eliminated: {}, timeSpent: {}, sectionOrder: [] };
  for (const s of exam.profile.sections) {
    let ids = s.questionIds;
    if (s.adaptive) {
      const route = adaptiveNext(exam, attempt, s.id);
      attempt.sectionOrder.push(`${s.id}:${route}`);
      ids = sectionQuestionIds(s, route);
    } else attempt.sectionOrder.push(s.id);
    for (const id of ids) {
      const q = exam.questions.find((x) => x.id === id)!;
      const a = keyAnswer(q);
      if (a !== undefined) attempt.answers[id] = a;
      attempt.timeSpent[id] = 30_000;
    }
  }
  return attempt;
}

export function emptyAttempt(exam: Exam): Attempt {
  return { examId: exam.id, startedAt: 0, answers: {}, flagged: [], eliminated: {}, timeSpent: {}, sectionOrder: [] };
}
