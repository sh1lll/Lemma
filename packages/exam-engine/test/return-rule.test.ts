import { describe, expect, it } from 'vitest';
import { PRESETS, validateProfile, type ExamProfile } from '../src';

describe('section return rule (returnTo)', () => {
  it('AP-style: Section II Part B lets you go back to Part A, without a calculator', () => {
    const ap = PRESETS['ap-style'];
    const b = ap.sections.find((s) => s.id === 's2b')!;
    expect(b.returnTo).toEqual({ section: 's2a', calculator: false });
    expect(b.calculator).toBe(false);
    expect(ap.sections.filter((s) => s.returnTo)).toHaveLength(1);
    expect(validateProfile(ap)).toEqual([]);
  });

  it('is validated: only to an earlier section, never adding a calculator', () => {
    const base = structuredClone(PRESETS['ap-style']) as ExamProfile;
    const bad = (mut: (p: ExamProfile) => void) => {
      const p = structuredClone(base);
      mut(p);
      return validateProfile(p);
    };
    expect(bad((p) => (p.sections[0]!.returnTo = { section: 's2b', calculator: false }))).toContain('s1a: returnTo must name an earlier section');
    expect(bad((p) => (p.sections[3]!.returnTo = { section: 'nope', calculator: false }))).toContain('s2b: returnTo must name an earlier section');
    expect(bad((p) => (p.sections[3]!.returnTo = { section: 's2a', calculator: true }))).toContain("s2b: returnTo can't allow a calculator this section doesn't");
  });
});
