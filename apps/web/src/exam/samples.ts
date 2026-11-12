import type { Exam, ExamProfile, ExamQuestion, Room } from './types';

/**
 * Hand-written sample exams, one per room, with short timings so every flow (warnings, breaks, adaptive
 * routing, time-up) can be exercised quickly. Used by the dev harness and the e2e tests.
 */

const mc = (id: string, number: number, prompt: string, choices: string[], answer: string, extra: Partial<ExamQuestion> = {}): ExamQuestion => ({
  id,
  number,
  type: 'mc',
  prompt,
  choices: choices.map((text, i) => ({ id: 'ABCDE'[i]!, text })),
  answer,
  points: 1,
  origin: 'generated',
  ...extra,
});

const num = (id: string, number: number, prompt: string, answer: string, extra: Partial<ExamQuestion> = {}): ExamQuestion => ({ id, number, type: 'numeric', prompt, answer, points: 1, origin: 'generated', ...extra });

const steps = (...s: [string, string?][]) => s.map(([text, tex]) => (tex ? { text, tex } : { text }));

function profile(room: Room, over: Partial<ExamProfile>): ExamProfile {
  return {
    id: `sample-${room}`,
    name: 'Sample exam',
    family: 'custom',
    room,
    sections: [],
    scoring: { kind: 'percent' },
    tools: { calculator: 'scientific', referenceSheet: 'math-reference', scratch: true, highlighter: true, eliminator: true, markForReview: true },
    rules: { fullscreen: true, warnAtMinutes: [5], allowPause: false, showTimer: 'toggle' },
    observations: ['Sample for testing the room.'],
    topics: [],
    mix: { mc: 0.75, numeric: 0.25 },
    ...over,
  };
}

const exam = (id: string, p: ExamProfile, questions: ExamQuestion[]): Exam => ({ id, profile: p, questions, createdAt: 0, seed: 1 });

export function sampleAdaptive(): Exam {
  const m1 = [
    mc('a1', 1, 'If 3x + 5 = 20, what is the value of x?', ['3', '5', '15', '25'], 'B', { topic: 'linear', steps: steps(['Subtract 5 from both sides.', '3x = 15'], ['Divide both sides by 3.', 'x = 5']) }),
    mc('a2', 2, 'A shirt that costs $40 is on sale for 25% off. What is the sale price?', ['$10', '$25', '$30', '$35'], 'C', { topic: 'percent' }),
    num('a3', 3, 'What is the positive solution to x² − 9 = 0?', '3', { topic: 'quadratic', tex: 'x^2 - 9 = 0' }),
    mc('a4', 4, 'The mean of 4, 8, and x is 7. What is x?', ['7', '8', '9', '10'], 'C', { topic: 'stats' }),
  ];
  const easy = [
    mc('e1', 1, 'What is 2(x + 3) when x = 4?', ['10', '11', '14', '20'], 'C', { topic: 'linear' }),
    mc('e2', 2, 'Which value of x satisfies x/4 = 3?', ['7', '12', '0.75', '1'], 'B', { topic: 'linear' }),
    num('e3', 3, 'A rectangle is 6 cm by 4 cm. What is its area, in square centimeters?', '24', { topic: 'geometry' }),
    mc('e4', 4, 'What is 10% of 250?', ['2.5', '25', '250', '0.25'], 'B', { topic: 'percent' }),
  ];
  const hard = [
    mc('h1', 1, 'The system 2x + y = 7 and x − y = 2 has solution (x, y). What is x?', ['1', '2', '3', '5'], 'C', { topic: 'system' }),
    mc('h2', 2, 'For what value of k does x² + kx + 9 = 0 have exactly one real solution with k > 0?', ['3', '6', '9', '18'], 'B', { topic: 'quadratic', tex: 'x^2 + kx + 9 = 0' }),
    num('h3', 3, 'A circle has area 49π. What is its radius?', '7', { topic: 'geometry' }),
    mc('h4', 4, 'If 2^(x+1) = 32, what is x?', ['3', '4', '5', '16'], 'B', { topic: 'exponents', tex: '2^{x+1} = 32' }),
  ];
  const p = profile('digital-adaptive', {
    name: 'Sample adaptive math',
    family: 'sat-style',
    tools: { calculator: 'graphing', referenceSheet: 'math-reference', scratch: true, highlighter: true, eliminator: true, markForReview: true },
    scoring: { kind: 'scaled', min: 200, max: 800 },
    sections: [
      { id: 'm1', title: 'Module 1: Math', minutes: 6, calculator: true, questionIds: m1.map((q) => q.id), canReturn: false, breakAfterMinutes: 1, instructions: 'Answer each question. A calculator is available. Your answers here decide which questions you see in Module 2.' },
      { id: 'm2', title: 'Module 2: Math', minutes: 6, calculator: true, questionIds: easy.map((q) => q.id), canReturn: false, adaptive: { after: 'm1', threshold: 0.5, easy: easy.map((q) => q.id), hard: hard.map((q) => q.id) }, instructions: 'Same rules as Module 1.' },
    ],
  });
  return exam('sample-adaptive', p, [...m1, ...easy, ...hard]);
}

export function sampleLinear(): Exam {
  const s1 = [
    mc('l1', 1, 'Simplify: 3(2x − 4) + 6', ['6x − 6', '6x − 12', '6x + 2', '5x − 6'], 'A', { topic: 'linear' }),
    mc('l2', 2, 'What is 3/4 + 1/8?', ['4/12', '7/8', '1', '5/8'], 'B', { topic: 'fractions' }),
    mc('l3', 3, 'The median of 3, 9, 4, 12, 7 is:', ['4', '7', '7.5', '9'], 'B', { topic: 'stats' }),
    mc('l4', 4, 'Which is equivalent to x³ · x⁵?', ['x⁸', 'x¹⁵', '2x⁸', 'x²'], 'A', { topic: 'exponents' }),
  ];
  const s2 = [
    mc('l5', 1, 'A car travels 150 miles in 2.5 hours. What is its average speed in miles per hour?', ['50', '60', '62.5', '75'], 'B', { topic: 'units' }),
    mc('l6', 2, 'The hypotenuse of a right triangle with legs 5 and 12 is:', ['13', '15', '17', '√119'], 'A', { topic: 'geometry' }),
    num('l7', 3, 'Solve for x: 0.4x = 18', '45', { topic: 'linear' }),
    mc('l8', 4, 'What is 15% of 80?', ['8', '12', '15', '18'], 'B', { topic: 'percent' }),
  ];
  const p = profile('digital-linear', {
    name: 'Sample linear math',
    family: 'act-style',
    tools: { calculator: 'scientific', scratch: true, highlighter: true, eliminator: true, markForReview: true },
    sections: [
      { id: 'p1', title: 'Part 1: No calculator', minutes: 8, calculator: false, questionIds: s1.map((q) => q.id), canReturn: false },
      { id: 'p2', title: 'Part 2: Calculator', minutes: 8, calculator: true, questionIds: s2.map((q) => q.id), canReturn: false },
    ],
    scoring: { kind: 'scaled', min: 1, max: 36 },
  });
  return exam('sample-linear', p, [...s1, ...s2]);
}

export function samplePaper(): Exam {
  const qs: ExamQuestion[] = [
    mc('p1', 1, 'Solve for x: 4x − 7 = 13', ['x = 1.5', 'x = 5', 'x = 6', 'x = 20'], 'B', { topic: 'linear', points: 2, steps: steps(['Add 7 to both sides.', '4x = 20'], ['Divide by 4.', 'x = 5']) }),
    mc('p2', 2, 'Which ordered pair is the solution of y = 2x and x + y = 9?', ['(2, 4)', '(3, 6)', '(4, 5)', '(6, 3)'], 'B', { topic: 'system', points: 2 }),
    num('p3', 3, 'A jacket costs $64. It is marked down 15%. What is the sale price, in dollars?', '54.40', { topic: 'percent', points: 3 }),
    mc('p4', 4, 'What is the slope of the line through (1, 2) and (5, 10)?', ['1/2', '2', '4', '8'], 'B', { topic: 'linear', points: 2 }),
    num('p5', 5, 'Solve the system 2x + 3y = 12 and x − y = 1. What is the value of y?', '2', { topic: 'system', points: 3 }),
    {
      id: 'p6',
      number: 6,
      type: 'free',
      prompt: 'A phone plan costs $20 per month plus $0.10 per text message.',
      parts: [
        { label: 'a', prompt: 'Write an equation for the monthly cost C after t texts.', points: 2, answer: '20 + 0.1t', type: 'expression' },
        { label: 'b', prompt: 'How much does a month with 150 texts cost?', points: 2, answer: '35', type: 'numeric' },
      ],
      points: 4,
      topic: 'linear',
      origin: 'generated',
    },
  ];
  const p = profile('paper', {
    name: 'Algebra 1 — Unit 5 Test',
    family: 'class',
    tools: { calculator: 'scientific', scratch: true, highlighter: false, eliminator: true, markForReview: true },
    rules: { fullscreen: false, warnAtMinutes: [5], allowPause: true, showTimer: 'toggle' },
    observations: ['Point values are printed next to each question.', 'Work must be shown.'],
    sections: [{ id: 't1', title: 'Unit 5 Test: Linear Equations and Systems', minutes: 10, calculator: true, questionIds: qs.map((q) => q.id), canReturn: true, instructions: 'Show all work for full credit. Circle or fill in your final answer. Calculators are allowed.' }],
    scoring: { kind: 'band', bands: [{ minPercent: 90, label: 'A' }, { minPercent: 80, label: 'B' }, { minPercent: 70, label: 'C' }, { minPercent: 60, label: 'D' }, { minPercent: 0, label: 'F' }] },
  });
  return exam('sample-paper', p, qs);
}

export function sampleFree(): Exam {
  const mcq = [
    mc('f1', 1, 'If f(x) = x³ − 2x, what is f′(2)?', ['4', '8', '10', '12'], 'C', { topic: 'derivative', tex: "f(x) = x^3 - 2x" }),
    mc('f2', 2, 'What is the value of the integral of 2x from 0 to 3?', ['3', '6', '9', '18'], 'C', { topic: 'integral', tex: '\\int_0^3 2x\\,dx' }),
  ];
  const frq: ExamQuestion[] = [
    {
      id: 'f3',
      number: 1,
      type: 'free',
      prompt: 'Let f be the function given by f(x) = x² − 4x + 3.',
      tex: 'f(x) = x^2 - 4x + 3',
      parts: [
        { label: 'a', prompt: 'Find f′(x).', points: 2, answer: '2x - 4', type: 'expression' },
        { label: 'b', prompt: 'Find the x-coordinate where f has a minimum.', points: 2, answer: '2', type: 'numeric' },
        { label: 'c', prompt: 'Find the minimum value of f.', points: 2, answer: '-1', type: 'numeric' },
      ],
      points: 6,
      topic: 'derivative',
      steps: steps(['Differentiate term by term.', "f'(x) = 2x - 4"], ['Set the derivative to zero.', '2x - 4 = 0 \\Rightarrow x = 2'], ['Evaluate f at 2.', 'f(2) = 4 - 8 + 3 = -1']),
      origin: 'generated',
    },
    {
      id: 'f4',
      number: 2,
      type: 'free',
      prompt: 'A particle moves along a line with velocity v(t) = 3t² for t ≥ 0.',
      tex: 'v(t) = 3t^2',
      parts: [
        { label: 'a', prompt: 'Find the acceleration at t = 2.', points: 2, answer: '12', type: 'numeric' },
        { label: 'b', prompt: 'Find the distance traveled from t = 0 to t = 2.', points: 3, answer: '8', type: 'numeric' },
      ],
      points: 5,
      topic: 'integral',
      origin: 'generated',
    },
  ];
  const p = profile('free-response', {
    name: 'Sample calculus free response',
    family: 'ap-style',
    tools: { calculator: 'graphing', formulaSheet: 'math-reference', scratch: true, highlighter: false, eliminator: true, markForReview: true },
    rules: { fullscreen: true, warnAtMinutes: [5], allowPause: false, showTimer: 'toggle' },
    sections: [
      { id: 'mcA', title: 'Section I: Multiple Choice (no calculator)', minutes: 6, calculator: false, questionIds: mcq.map((q) => q.id), canReturn: false },
      { id: 'frB', title: 'Section II: Free Response', minutes: 12, calculator: true, questionIds: frq.map((q) => q.id), canReturn: false, instructions: 'Show all of your work. Answers without supporting work may not receive credit.' },
    ],
    scoring: { kind: 'band', bands: [{ minPercent: 70, label: '5' }, { minPercent: 55, label: '4' }, { minPercent: 40, label: '3' }, { minPercent: 25, label: '2' }, { minPercent: 0, label: '1' }] },
  });
  return exam('sample-free', p, [...mcq, ...frq]);
}

export const SAMPLES: Record<Room, () => Exam> = {
  'digital-adaptive': sampleAdaptive,
  'digital-linear': sampleLinear,
  paper: samplePaper,
  'free-response': sampleFree,
};
