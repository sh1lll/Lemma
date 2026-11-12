export type Topic =
  | 'arithmetic'
  | 'fractions'
  | 'percent'
  | 'linear'
  | 'quadratic'
  | 'system'
  | 'exponents'
  | 'derivative'
  | 'integral'
  | 'units'
  | 'stats'
  | 'geometry'
  | 'money';

export type Difficulty = 1 | 2 | 3;

/** One tutor step: a plain-language instruction and, optionally, the resulting line in LaTeX. */
export interface Step {
  text: string;
  tex?: string;
}

export type AnswerKind = 'number' | 'expression' | 'set' | 'pair';

export interface Question {
  id: string;
  topic: Topic;
  difficulty: Difficulty;
  prompt: string;
  promptTex?: string;
  answer: { display: string; tex?: string; kind: AnswerKind };
  steps: Step[];
  hint: string;
  seed: number;
}

export interface GenerateOptions {
  difficulty?: Difficulty;
  seed?: number;
}

export interface CheckResult {
  correct: boolean;
  close?: boolean;
  expected: string;
  feedback: string;
}

export interface TestResult {
  score: number;
  total: number;
  byTopic: Record<string, { right: number; total: number }>;
}

/** What a topic generator returns; `generate` adds id, topic, difficulty and seed. */
export type Draft = Omit<Question, 'id' | 'topic' | 'difficulty' | 'seed'>;

export const TOPICS: { id: Topic; label: string }[] = [
  { id: 'arithmetic', label: 'Order of operations' },
  { id: 'fractions', label: 'Fractions' },
  { id: 'percent', label: 'Percentages' },
  { id: 'linear', label: 'Linear equations' },
  { id: 'quadratic', label: 'Quadratic equations' },
  { id: 'system', label: 'Systems of equations' },
  { id: 'exponents', label: 'Exponent rules' },
  { id: 'derivative', label: 'Derivatives' },
  { id: 'integral', label: 'Integrals' },
  { id: 'units', label: 'Unit conversion' },
  { id: 'stats', label: 'Statistics' },
  { id: 'geometry', label: 'Geometry' },
  { id: 'money', label: 'Money and tips' },
];
