import { describe, expect, it } from 'vitest';
import { buildExam, buildProfile, importedQuestions, importTextDetailed, orderColumns, type ExamQuestion, type LayoutRow } from '../src';
import { splitTextColumns } from '../src/text';
import { fixture } from './helpers';

/** Real-world test layouts that used to be misread (see each case). */
const load = (name: string) => importTextDetailed(name, fixture(`layouts/${name}`));
const byNum = (qs: ExamQuestion[], n: number) => qs.find((q) => q.number === n)!;
const keys = (qs: ExamQuestion[]) => qs.map((q) => q.answer);

describe('import: varied layouts', () => {
  it('two-column page: reads the left column, then the right (questions used to merge)', () => {
    const a = load('two-column.txt');
    const qs = a.doc.questions;
    expect(qs.map((q) => q.number)).toEqual([1, 2, 3]);
    expect(byNum(qs, 1).prompt).toBe('What is the area of a circle with radius 3?');
    expect(byNum(qs, 2).choices!.map((c) => c.text)).toEqual(['2', '3', '4', '6']);
    expect(keys(qs)).toEqual(['B', 'B', 'C']);
    expect(a.doc.warnings).toEqual([]);
  });

  it('choices on the question line, (A) and a) styles', () => {
    const qs = load('one-line-choices.txt').doc.questions;
    expect(qs.every((q) => q.type === 'mc' && q.choices?.length === 4)).toBe(true);
    expect(keys(qs)).toEqual(['C', 'C', 'C', 'A']);
  });

  it('"Q1." numbering with a one-line "KEY: 1-B 2-B 3-A" key', () => {
    const qs = load('q-dot.txt').doc.questions;
    expect(keys(qs)).toEqual(['B', 'B', 'A']);
  });

  it('key decimals are not entry numbers, and a part "Rubric:" is a rubric, not an answer', () => {
    const a = load('roman-sections.txt');
    const q3 = byNum(a.doc.questions, 3);
    expect(q3.parts!.map((p) => p.answer)).toEqual(['5', '4.5', undefined]);
    expect(q3.parts![2]!.rubric).toEqual(['mentions right skew']);
    expect(a.doc.warnings.join(' ')).not.toMatch(/without a matching question/);
    expect(a.sections.map((s) => s.questionIds.length)).toEqual([2, 1]);
  });

  it('matching section: each term is multiple choice over the shared bank; fill-in-the-blank stays separate', () => {
    const a = load('matching.txt');
    const qs = a.doc.questions;
    expect(qs.map((q) => q.number)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const n of [1, 2, 3, 4]) {
      const q = byNum(qs, n);
      expect(q.type).toBe('mc');
      expect(q.choices!.map((c) => c.id)).toEqual(['A', 'B', 'C', 'D']);
    }
    expect(byNum(qs, 1).prompt).toMatch(/Domain/);
    expect(keys(qs.slice(0, 4))).toEqual(['B', 'A', 'C', 'D']);
    expect(byNum(qs, 4).prompt).not.toMatch(/Fill in/i);
    expect([byNum(qs, 5).type, byNum(qs, 5).answer, byNum(qs, 6).answer]).toEqual(['numeric', '4', '9']);
    expect(a.doc.warnings).toEqual([]);
  });

  it('answer key laid out as a table', () => {
    expect(keys(load('key-table.txt').doc.questions)).toEqual(['C', 'C', 'C', 'B']);
  });

  it('OCR: "l." for 1, "3," for 3, and specks between questions', () => {
    const a = load('ocr-garbage.txt');
    const qs = a.doc.questions;
    expect(qs.map((q) => q.number)).toEqual([1, 2, 3, 4]);
    expect(qs.every((q) => q.choices?.length === 4)).toBe(true);
    expect(byNum(qs, 3).choices![3]!.text).toBe('7');
    expect(keys(qs)).toEqual(['C', 'A', 'B', 'A']);
  });

  it('running headers on pages marked only by "Page N of M" are removed', () => {
    const a = load('multipage.txt');
    const qs = a.doc.questions;
    expect(qs).toHaveLength(5);
    for (const q of qs) for (const c of q.choices!) expect(c.text).not.toMatch(/Form B/);
    expect(keys(qs)).toEqual(['B', 'B', 'C', 'A', 'A']);
  });

  it('AP-style FRQ: "Scoring Guidelines" is the key; part answers and part rubrics attach', () => {
    const qs = load('ap-frq.txt').doc.questions;
    expect(byNum(qs, 1).parts!.map((p) => [p.label, p.points, p.answer])).toEqual([['a', 2, '3x^2 - 12x + 9'], ['b', 3, 'x = 1'], ['c', 4, '1']]);
    const q2 = byNum(qs, 2);
    expect(q2.parts!.map((p) => p.answer)).toEqual(['2', undefined, '5']);
    expect(q2.parts![1]!.rubric).toEqual(['speeding up', 'v and a have same sign']);
  });

  it('select-all keys', () => {
    const qs = load('select-all.txt').doc.questions;
    expect(qs.map((q) => q.type)).toEqual(['multi', 'multi']);
    expect(keys(qs)).toEqual([['A', 'C', 'E'], ['A', 'C']]);
  });

  it('every layout builds an exam with every slot filled', () => {
    for (const f of ['two-column.txt', 'matching.txt', 'ocr-garbage.txt', 'ap-frq.txt', 'roman-sections.txt']) {
      const doc = load(f).doc;
      const exam = buildExam(buildProfile([doc]), { imported: importedQuestions([doc]) }, { seed: 7, now: 0 });
      for (const s of exam.profile.sections) for (const id of s.questionIds) expect(exam.questions.some((q) => q.id === id), `${f} ${id}`).toBe(true);
    }
  });
});

describe('splitTextColumns', () => {
  it('leaves single-column text with side-by-side choices alone', () => {
    const lines = ['1. Solve 2x = 8.', 'A. 2       B. 4', 'C. 6       D. 8', '', '2. Solve x + 1 = 3.', 'A. 1       B. 2'];
    expect(splitTextColumns(lines)).toEqual(lines);
  });
});

describe('orderColumns (PDF text positions)', () => {
  const row = (y: number, ...parts: [number, string][]): LayoutRow => ({ y, h: 10, parts: parts.map(([x, s]) => ({ x, w: s.length * 5, s })) });
  const text = (rows: LayoutRow[]) => rows.map((r) => r.parts.map((p) => p.s).join(' '));

  it('reads a two-column stretch column by column, keeping full-width rows in place', () => {
    const rows = [
      row(800, [40, 'Geometry Quiz 3 — answer every question on this page please']),
      row(790, [40, 'Name: ______'], [320, 'Date: ______']),
      row(780, [40, '1. What is the area of a circle'], [320, '2. Find the slope of the line']),
      row(766, [40, 'with radius 3?'], [320, 'through (1, 2) and (3, 8).']),
      row(752, [40, 'A. 6π'], [120, 'B. 9π'], [320, 'A. 2'], [400, 'B. 3']),
      row(700, [40, '3. Solve 2x + 5 = 17 and write the answer in the space provided.']),
    ];
    const out = orderColumns(rows);
    expect(text(out)).toEqual([
      'Geometry Quiz 3 — answer every question on this page please',
      'Name: ______ Date: ______',
      '1. What is the area of a circle',
      'with radius 3?',
      'A. 6π B. 9π',
      '2. Find the slope of the line',
      'through (1, 2) and (3, 8).',
      'A. 2 B. 3',
      '3. Solve 2x + 5 = 17 and write the answer in the space provided.',
    ]);
    expect(out[5]!.gap).toBe(true);
  });

  it('does not split side-by-side answer choices of a one-column test', () => {
    const rows = [row(780, [40, '1. Solve 2x = 8.']), row(766, [40, 'A. 2'], [320, 'B. 4']), row(752, [40, 'C. 6'], [320, 'D. 8'])];
    expect(orderColumns(rows)).toEqual(rows);
  });
});
