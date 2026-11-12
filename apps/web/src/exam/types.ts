// The exam room speaks the shared contract only (packages/exam-engine/src/types.ts).
export type {
  Attempt,
  Choice,
  Exam,
  ExamProfile,
  ExamQuestion,
  ImportedDoc,
  Part,
  QuestionType,
  Result,
  Room,
  ScoringScale,
  Section,
} from '@lemma/exam-engine/src/types';
export type { Topic } from '@lemma/practice-engine';

import type { ExamQuestion } from '@lemma/exam-engine/src/types';

/** What the host app gives the exam center. */
export interface ExamHost {
  /** `angle` is the exam calculator's own DEG/RAD switch; without it the app's mode applies. */
  compute(q: string, opts?: { angle?: 'deg' | 'rad' }): Promise<{ ok: boolean; display?: string; message?: string }>;
  /** The app's angle mode, the exam calculator's starting setting. */
  angle?(): 'deg' | 'rad';
  openScratch?(): void;
  onPractice?(q: ExamQuestion): void;
  onLesson?(q: ExamQuestion): void;
  toast(m: string): void;
}
