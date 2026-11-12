/**
 * Exam simulator contract, shared by the engine (packages/exam-engine: import, profile detection, generation,
 * scoring) and the exam room UI (apps/web/src/exam). Change shapes only by agreement.
 */
import type { Topic } from '@lemma/practice-engine';

/** How the exam room looks and behaves. One per real-world environment; the profile picks one. */
export type Room =
  | 'digital-adaptive' // one question per screen, top timer bar, question navigator, mark for review, answer eliminator, annotate, reference sheet, built-in calculator, modules with breaks (SAT/PSAT-style)
  | 'digital-linear' // one question per screen, no adaptivity, navigator, flag, on-screen calculator (ACT online / GRE / many state & college tests)
  | 'paper' // printed pages: header with name/date/period, points, show-work space, scrolling page view (class tests, quizzes, many AP/IB paper sections)
  | 'free-response'; // long multi-part written/worked answers with a work area (AP/IB/A-level FRQs)

export type QuestionType =
  | 'mc' // single answer from choices
  | 'multi' // select all that apply
  | 'numeric' // student-produced response / grid-in / numeric entry
  | 'expression' // algebraic answer
  | 'short' // short written answer (graded by key/rubric)
  | 'free'; // multi-part worked response graded by rubric

export interface Choice {
  id: string; // "A", "B", …
  text: string;
  tex?: string;
}

export interface Part {
  label: string; // "a", "b", "(i)"
  prompt: string;
  tex?: string;
  points: number;
  answer?: string; // key, if known
  rubric?: string[]; // point-earning criteria
  type: Exclude<QuestionType, 'free'>;
}

export interface ExamQuestion {
  id: string;
  number: number; // as printed
  type: QuestionType;
  prompt: string;
  tex?: string;
  /** Plain text of a figure/table the question refers to, if one was detected (images are not reproduced). */
  figure?: string;
  choices?: Choice[];
  parts?: Part[];
  /** Answer key: choice id(s), a number/expression, or text; absent when unknown. */
  answer?: string | string[];
  points: number;
  topic?: Topic;
  difficulty?: 1 | 2 | 3;
  calculator?: boolean; // allowed for this question's section
  /** Worked steps (for review and video lessons), when Lemma can produce them. */
  steps?: { text: string; tex?: string }[];
  /** Where it came from. */
  origin: 'imported' | 'variant' | 'generated';
}

export interface Section {
  id: string;
  title: string; // "Module 1", "Section I, Part A", "Part 2 — No calculator"
  minutes: number | null; // null = untimed
  calculator: boolean;
  questionIds: string[];
  /** Digital adaptive: module 2 difficulty depends on module 1 performance. */
  adaptive?: { after: string; threshold: number; easy: string[]; hard: string[] };
  /** Can the student return to this section after leaving it? */
  canReturn: boolean;
  /**
   * While this section is in progress, the student may also go back to the questions of an earlier section that
   * was already handed in, on THIS section's clock — the AP rule "during Part B you may return to Part A
   * questions, without a calculator". `calculator` says whether the calculator may be used while back there
   * (never more than this section itself allows). Optional; absent means no return.
   */
  returnTo?: { section: string; calculator: boolean };
  breakAfterMinutes?: number;
  instructions?: string;
}

export interface ScoringScale {
  kind: 'percent' | 'points' | 'scaled' | 'band';
  /** For 'scaled': min/max (e.g. 200–800 per section); conversion is an ESTIMATE and labelled so. */
  min?: number;
  max?: number;
  /** For 'band': raw-percentage cutoffs to labels, e.g. AP 1–5 or letter grades. */
  bands?: { minPercent: number; label: string }[];
  guessingPenalty?: number; // fraction of a point lost per wrong answer (0 for most modern tests)
}

/** Everything that makes the simulation match a specific test environment. */
export interface ExamProfile {
  id: string;
  name: string; // "Algebra 2 — Unit 4 Test (Ms. R)", "Digital SAT-style Math", "AP Calculus-style"
  /** A known format this profile follows, or 'custom' when derived from the user's own tests. */
  family: 'sat-style' | 'psat-style' | 'act-style' | 'ap-style' | 'gre-style' | 'ib-style' | 'class' | 'custom';
  room: Room;
  sections: Section[];
  scoring: ScoringScale;
  tools: { calculator: 'none' | 'basic' | 'scientific' | 'graphing'; referenceSheet?: string; formulaSheet?: string; scratch: boolean; highlighter: boolean; eliminator: boolean; markForReview: boolean };
  rules: { fullscreen: boolean; warnAtMinutes: number[]; allowPause: boolean; showTimer: 'always' | 'toggle' | 'last5' };
  /** Things learned from the user's uploads ("teacher uses 4 choices", "points shown per question", "show work required"). */
  observations: string[];
  /** Topic weights from notes/study guides/tests, used for generation. */
  topics: { topic: Topic; weight: number; subtopics?: string[] }[];
  /** Typical question-type mix, e.g. { mc: 0.7, numeric: 0.3 }. */
  mix: Partial<Record<QuestionType, number>>;
}

/** What the importer extracted from one uploaded document. */
export interface ImportedDoc {
  name: string;
  kind: 'test' | 'study-guide' | 'notes' | 'answer-key' | 'unknown';
  text: string;
  questions: ExamQuestion[];
  /** Detected settings: "Time: 50 minutes", "Calculator allowed", "Show all work", point values, header fields. */
  hints: { timeMinutes?: number; calculator?: boolean; showWork?: boolean; choicesPerQuestion?: number; pointsShown?: boolean; header?: string[]; sections?: string[] };
  topics: { topic: Topic; weight: number; subtopics?: string[] }[];
  warnings: string[];
}

export interface Exam {
  id: string;
  profile: ExamProfile;
  questions: ExamQuestion[];
  createdAt: number;
  seed: number;
}

export interface Attempt {
  examId: string;
  startedAt: number;
  finishedAt?: number;
  answers: Record<string, string | string[] | Record<string, string>>; // question id → answer (parts keyed by label)
  flagged: string[];
  eliminated: Record<string, string[]>;
  timeSpent: Record<string, number>; // ms per question
  sectionOrder: string[]; // sections actually taken (adaptive path)
}

export interface Result {
  raw: number;
  possible: number;
  percent: number;
  /** Scaled/band score with its label, e.g. "≈ 640 (estimate)" or "B+" or "4 (estimate)". */
  score: string;
  estimate: boolean;
  bySection: { id: string; title: string; raw: number; possible: number }[];
  byTopic: { topic: Topic; right: number; total: number }[];
  perQuestion: { id: string; correct: boolean | 'partial'; earned: number; points: number; expected?: string; feedback: string; timeMs: number }[];
  pacing: { onPaceAt: string[]; slowest: string[] };
}
