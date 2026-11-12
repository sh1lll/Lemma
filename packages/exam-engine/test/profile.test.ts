import { describe, expect, it } from 'vitest';
import { ACT_LEGACY_VARIANT, buildProfile, familyRules, importedQuestions, importText, PRESETS, sectionCount, validateProfile, type ExamProfile } from '../src';
import { fixture } from './helpers';

describe('buildProfile mirrors the teacher’s test', () => {
  const test = importText('algebra2-unit4-test.txt', fixture('algebra2-unit4-test.txt'));
  const guide = importText('calc-guide.txt', fixture('calculus-study-guide.txt'));
  const p = buildProfile([test, guide]);

  it('is a valid custom paper profile', () => {
    expect(validateProfile(p)).toEqual([]);
    expect(p.family).toBe('custom');
    expect(p.room).toBe('paper');
    expect(p.name).toMatch(/Unit 4 Test/);
  });

  it('keeps the sections in order with the same counts, calculator rules and time', () => {
    expect(p.sections.map((s) => [s.title, s.questionIds.length, s.calculator])).toEqual([
      ['Part A – No Calculator', 14, false],
      ['Part B – Calculator', 11, true],
    ]);
    expect(p.sections.reduce((s, x) => s + (x.minutes ?? 0), 0)).toBe(50);
    expect(p.sections.every((s) => !s.canReturn)).toBe(true); // Part A handed in before calculators
    expect(p.sections[0]!.questionIds[0]).toBe(test.questions[0]!.id);
  });

  it('mirrors type mix, choices, points, show-work, scoring', () => {
    expect(p.mix).toEqual({ mc: 0.8, free: 0.2 });
    expect(familyRules(p.family, p).choices).toBe(4);
    expect(p.observations.join('\n')).toMatch(/multiple choice 3 pts each/);
    expect(p.observations.join('\n')).toMatch(/Show-work rule/);
    expect(p.observations.join('\n')).toMatch(/Answer key found for 25 of 25/);
    expect(p.scoring.kind).toBe('percent');
    expect(p.scoring.bands?.[0]).toEqual({ minPercent: 93, label: 'A' });
    expect(p.tools.calculator).toBe('scientific');
  });

  it('weights topics from tests above notes', () => {
    expect(p.topics[0]!.topic).toBe('quadratic');
    const d = p.topics.find((t) => t.topic === 'derivative');
    expect(d).toBeTruthy();
    expect(d!.weight).toBeLessThan(p.topics[0]!.weight);
    expect(Math.abs(p.topics.reduce((s, t) => s + t.weight, 0) - 1)).toBeLessThan(0.02);
  });
});

describe('answer keys in a separate document', () => {
  it('are attached to the test by buildProfile', () => {
    const full = fixture('algebra2-unit4-test.txt');
    const cut = full.indexOf('Unit 4 Test — ANSWER KEY');
    const test = importText('Unit 4 Test.txt', full.slice(0, cut));
    const key = importText('Unit 4 Test - key.txt', full.slice(cut));
    expect(test.questions.every((q) => q.answer === undefined && !q.parts?.some((p) => p.answer))).toBe(true);
    const p = buildProfile([key, test]);
    expect(p.observations.some((o) => /Attached answer key/.test(o))).toBe(true);
    expect(test.questions.find((q) => q.number === 7)!.answer).toBe('C');
    expect(test.questions.find((q) => q.number === 14)!.parts![1]!.answer).toBe('f(x) = (x - 3)^2 - 4');
    const qs = importedQuestions([key, test]);
    expect(qs).toHaveLength(25);
    expect(qs.every((q) => q.prompt)).toBe(true);
  });
});

describe('buildProfile with a family preset', () => {
  it('uses the format preset and the uploads’ topics when there is no class test', () => {
    const guide = importText('calc-guide.txt', fixture('calculus-study-guide.txt'));
    const p = buildProfile([guide], { family: 'ap-style' });
    expect(p.family).toBe('ap-style');
    expect(p.sections).toHaveLength(4);
    expect(p.topics[0]!.topic).toBe('derivative');
    expect(validateProfile(p)).toEqual([]);
  });
  it('falls back to the generic class preset with nothing to mirror', () => {
    const p = buildProfile([]);
    expect(p.family).toBe('class');
    expect(p.sections[0]!.minutes).toBe(50);
  });
});

const total = (p: ExamProfile) => ({
  questions: p.sections.reduce((s, x) => s + sectionCount(x), 0),
  minutes: p.sections.reduce((s, x) => s + (x.minutes ?? 0), 0),
});

describe('presets', () => {
  it.each(Object.entries(PRESETS))('%s is valid', (_id, p) => {
    expect(validateProfile(p)).toEqual([]);
    expect(p.name).toMatch(/-style|Class/i);
  });

  it('match the public formats', () => {
    expect(total(PRESETS['sat-style'])).toEqual({ questions: 44, minutes: 70 });
    expect(total(PRESETS['psat-style'])).toEqual({ questions: 44, minutes: 70 });
    expect(total(PRESETS['act-style'])).toEqual({ questions: 45, minutes: 50 });
    expect(total(ACT_LEGACY_VARIANT)).toEqual({ questions: 60, minutes: 60 });
    expect(familyRules('act-style', ACT_LEGACY_VARIANT).choices).toBe(5);
    expect(total(PRESETS['ap-style'])).toEqual({ questions: 51, minutes: 195 });
    expect(total(PRESETS['gre-style'])).toEqual({ questions: 27, minutes: 47 });
    expect(total(PRESETS['ib-style'])).toEqual({ questions: 18, minutes: 180 });
    expect(total(PRESETS.class)).toEqual({ questions: 25, minutes: 50 });
  });

  it('have SAT modules of 22 with ~75% MC and calculator throughout', () => {
    const sat = PRESETS['sat-style'];
    expect(sat.room).toBe('digital-adaptive');
    expect(sat.sections.every((s) => sectionCount(s) === 22 && s.minutes === 35 && s.calculator)).toBe(true);
    const m1 = sat.sections[0]!.questionIds;
    expect(m1.filter((id) => id.includes(':mc:')).length).toBe(17);
    expect(sat.scoring).toMatchObject({ kind: 'scaled', min: 200, max: 800, guessingPenalty: 0 });
    expect(sat.tools.referenceSheet).toBeTruthy();
  });

  it('have the AP calculator pattern and 50/50 MC/FRQ weight', () => {
    const ap = PRESETS['ap-style'];
    expect(ap.sections.map((s) => [sectionCount(s), s.minutes, s.calculator])).toEqual([
      [30, 60, false],
      [15, 45, true],
      [2, 30, true],
      [4, 60, false],
    ]);
    const pts = (i: number) => ap.sections[i]!.questionIds.reduce((s, id) => s + Number(id.split(':')[2]), 0);
    expect(pts(0) + pts(1)).toBeCloseTo(54);
    expect(pts(2) + pts(3)).toBeCloseTo(54);
  });

  it('give IB papers 80 marks each', () => {
    for (const s of PRESETS['ib-style'].sections) expect(s.questionIds.reduce((t, id) => t + Number(id.split(':')[2]), 0)).toBeCloseTo(80);
  });

  it('class preset totals 100 points', () => {
    expect(PRESETS.class.sections[0]!.questionIds.reduce((t, id) => t + Number(id.split(':')[2]), 0)).toBe(100);
  });
});
