import { describe, expect, it } from 'vitest';
import { importText, importTextDetailed } from '../src';
import { cleanLines, fixLostExponents } from '../src/text';
import { parseCalculator, parseMinutes } from '../src/importer';
import { fixture } from './helpers';

const KEY = { 1: 'B', 2: 'A', 3: 'C', 4: 'D', 5: 'D', 6: 'B', 7: 'C', 8: 'D', 9: 'B', 10: 'B', 11: 'A', 12: 'C', 15: 'B', 16: 'B', 17: 'C', 18: 'B', 19: 'A', 20: 'D', 21: 'B', 22: 'D' } as Record<number, string>;

describe.each([
  ['clean PDF text', 'algebra2-unit4-test.txt'],
  ['messy OCR scan', 'algebra2-unit4-test-ocr.txt'],
])('teacher unit test (%s)', (_label, file) => {
  const a = importTextDetailed(file, fixture(file));
  const doc = a.doc;
  const qs = doc.questions;

  it('is a test, with reasons', () => {
    expect(doc.kind).toBe('test');
    expect(a.kindReasons.join(' ')).toMatch(/25 numbered questions/);
    expect(a.kindReasons.join(' ')).toMatch(/header fields/);
  });

  it('finds all 25 questions in order', () => {
    expect(qs.map((q) => q.number)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it('finds 20 four-choice MC and 5 free response', () => {
    const mc = qs.filter((q) => q.type === 'mc');
    expect(mc).toHaveLength(20);
    expect(mc.every((q) => q.choices?.length === 4 && q.choices.map((c) => c.id).join('') === 'ABCD')).toBe(true);
    expect(qs.filter((q) => q.type === 'free').map((q) => q.number)).toEqual([13, 14, 23, 24, 25]);
    expect(doc.hints.choicesPerQuestion).toBe(4);
  });

  it('reads points (section default and per question)', () => {
    expect(qs.filter((q) => q.type === 'mc').every((q) => q.points === 3)).toBe(true);
    const pts = Object.fromEntries(qs.filter((q) => q.type === 'free').map((q) => [q.number, q.points]));
    expect(pts).toEqual({ 13: 6, 14: 8, 23: 8, 24: 8, 25: 10 });
    expect(qs.reduce((s, q) => s + q.points, 0)).toBe(100);
    expect(doc.hints.pointsShown).toBe(true);
    const q14 = qs.find((q) => q.number === 14)!;
    expect(q14.parts?.map((p) => [p.label, p.points])).toEqual([['a', 3], ['b', 3], ['c', 2]]);
  });

  it('finds sections, calculator rules, time, show-work and header fields', () => {
    expect(a.sections.map((s) => [s.calculator, s.questionIds.length])).toEqual([[false, 14], [true, 11]]);
    expect(doc.hints.sections?.[0]).toMatch(/part a/i);
    expect(doc.hints.timeMinutes).toBe(50);
    expect(doc.hints.showWork).toBe(true);
    expect(doc.hints.header).toEqual(['Name', 'Date', 'Period']);
    expect(qs.find((q) => q.number === 5)!.calculator).toBe(false);
    expect(qs.find((q) => q.number === 15)!.calculator).toBe(true);
  });

  it('attaches the end-of-test answer key to every question', () => {
    for (const [n, k] of Object.entries(KEY)) expect(qs.find((q) => q.number === Number(n))!.answer).toBe(k);
    expect(qs.find((q) => q.number === 13)!.answer).toBe('x = 3 or x = -5');
    expect(qs.find((q) => q.number === 24)!.answer).toBe('x = 4, y = 3');
    const q14 = qs.find((q) => q.number === 14)!;
    expect(q14.parts!.map((p) => p.answer)).toEqual(['x = 1 or x = 5', 'f(x) = (x - 3)^2 - 4', '-4']);
    expect(qs.find((q) => q.number === 23)!.parts!.map((p) => p.answer)).toEqual(['144', '5', '144']);
    const q25 = qs.find((q) => q.number === 25)!;
    expect(q25.parts?.[0]?.rubric).toHaveLength(3);
  });

  it('keeps figure text and warns', () => {
    expect(qs.find((q) => q.number === 9)!.figure).toMatch(/parabola/);
    expect(qs.find((q) => q.number === 22)!.figure).toMatch(/g\(x\)\s*\|\s*4/);
    expect(doc.warnings.some((w) => /Question 9 .*figure/.test(w))).toBe(true);
  });

  it('classifies topics', () => {
    const t = (n: number) => qs.find((q) => q.number === n)!.topic;
    expect([t(1), t(2), t(4), t(15), t(16), t(19), t(24)]).toEqual(['linear', 'quadratic', 'exponents', 'percent', 'money', 'stats', 'system']);
    expect(doc.topics[0]!.topic).toBe('quadratic');
    expect(doc.topics[0]!.subtopics).toContain('factoring');
  });

  it('cleans footers and lost superscripts', () => {
    expect(a.removedLines.length).toBe(4);
    expect(qs.find((q) => q.number === 2)!.prompt).toBe('What are the solutions of x^2 - 5x + 6 = 0?');
    expect(qs.find((q) => q.number === 6)!.prompt).toContain('(x - 4)^2');
    expect(qs.find((q) => q.number === 1)!.prompt).toBe('Solve for x: 3x + 7 = 22.');
  });
});

describe('the OCR scan matches the clean text', () => {
  it('extracts the same questions and keys', () => {
    const clean = importText('clean', fixture('algebra2-unit4-test.txt'));
    const ocr = importText('ocr', fixture('algebra2-unit4-test-ocr.txt'));
    const view = (d: typeof clean) => d.questions.map((q) => [q.number, q.type, q.points, q.choices?.length ?? 0, JSON.stringify(q.answer)]);
    expect(view(ocr)).toEqual(view(clean));
    const prompts = (d: typeof clean) => d.questions.filter((q) => q.number <= 12).map((q) => q.prompt.replace(/\s+/g, ''));
    expect(prompts(ocr)).toEqual(prompts(clean));
  });
});

describe('calculus study guide', () => {
  const a = importTextDetailed('calc-guide.txt', fixture('calculus-study-guide.txt'));
  it('is a study guide weighted to derivatives with subtopics', () => {
    expect(a.doc.kind).toBe('study-guide');
    expect(a.doc.topics[0]!.topic).toBe('derivative');
    expect(a.doc.topics[0]!.weight).toBeGreaterThan(0.8);
    expect(a.doc.topics[0]!.subtopics).toEqual(expect.arrayContaining(['chain rule', 'product rule', 'quotient rule', 'power rule']));
  });
  it('picks up the practice problems only', () => {
    expect(a.doc.questions.map((q) => q.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(a.doc.questions[1]!.type).toBe('expression');
    expect(a.doc.questions[5]!.topic).toBe('integral');
  });
});

describe('quiz with inline answers', () => {
  const doc = importText('quiz.txt', fixture('quiz-linear-percent.txt'));
  it('reads questions, lowercase inline choices and inline answers', () => {
    expect(doc.kind).toBe('test');
    expect(doc.questions).toHaveLength(5);
    expect(doc.questions.map((q) => q.answer)).toEqual(['x = 6', '21', 'B', 'x = 5', '$7.20']);
    const q3 = doc.questions[2]!;
    expect(q3.type).toBe('mc');
    expect(q3.choices?.map((c) => c.text)).toEqual(['4', '-3', '3', '-4']);
    expect(doc.questions[0]!.type).toBe('numeric');
  });
});

describe('GRE-style quantitative comparison sample', () => {
  const doc = importText('gre.txt', fixture('gre-quant-sample.txt'));
  it('shares the comparison choices, detects select-all and numeric entry, attaches keys', () => {
    expect(doc.questions).toHaveLength(6);
    const qc = doc.questions.slice(0, 4);
    expect(qc.every((q) => q.type === 'mc' && q.choices?.length === 4 && /Quantity A is greater/.test(q.choices[0]!.text))).toBe(true);
    expect(qc.map((q) => q.answer)).toEqual(['A', 'C', 'D', 'B']);
    expect(doc.questions[4]!.type).toBe('multi');
    expect(doc.questions[4]!.choices).toHaveLength(5);
    expect(doc.questions[4]!.answer).toEqual(['A', 'C', 'D']);
    expect(doc.questions[5]!.type).toBe('numeric');
    expect(doc.questions[5]!.answer).toBe('16');
    expect(doc.topics.find((t) => t.subtopics?.includes('quantitative comparison'))).toBeTruthy();
  });
});

describe('separate answer-key document', () => {
  const full = fixture('algebra2-unit4-test.txt');
  const cut = full.indexOf('Unit 4 Test — ANSWER KEY');
  const key = importText('Unit 4 Test key.txt', full.slice(cut));
  it('is detected as an answer key with stub entries', () => {
    expect(key.kind).toBe('answer-key');
    expect(key.questions).toHaveLength(25);
    expect(key.questions[0]!.answer).toBe('B');
  });
});

describe('helpers', () => {
  it('restores lost exponents without touching words', () => {
    expect(fixLostExponents('3x2 - 5x + 6 = 0')).toBe('3x^2 - 5x + 6 = 0');
    expect(fixLostExponents('(2x3)(4x2)')).toBe('(2x^3)(4x^2)');
    expect(fixLostExponents('log2(8) and Q2 and h(2)')).toBe('log2(8) and Q2 and h(2)');
    expect(fixLostExponents('(x + 1)2 = 9')).toBe('(x + 1)^2 = 9');
  });
  it('parses times and calculator rules', () => {
    expect(parseMinutes('Time: 1 hr 30 min')).toBe(90);
    expect(parseMinutes('You have 50 minutes')).toBe(50);
    expect(parseMinutes('a 90-minute exam')).toBe(90);
    expect(parseCalculator('Part A – No Calculator')).toBe(false);
    expect(parseCalculator('Calculators are not permitted')).toBe(false);
    expect(parseCalculator('Section II: Graphing calculator required')).toBe(true);
  });
  it('drops running headers given page texts', () => {
    const pages = ['Chem Prep — Form B\n1. Solve 2x = 4.\nPage 1', 'Chem Prep — Form B\n2. Solve 3x = 9.\nPage 2', 'Chem Prep — Form B\n3. Solve 4x = 8.\nPage 3'];
    const { lines } = cleanLines('', pages);
    expect(lines.filter((l) => /Chem Prep/.test(l))).toHaveLength(1);
    expect(lines.some((l) => /Page \d/.test(l))).toBe(false);
    const doc = importText('form-b', '', { pages });
    expect(doc.questions.map((q) => q.answer ?? q.prompt)).toEqual(['Solve 2x = 4.', 'Solve 3x = 9.', 'Solve 4x = 8.']);
  });
});
