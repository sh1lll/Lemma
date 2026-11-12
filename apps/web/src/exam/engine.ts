import * as real from '@lemma/exam-engine';
import * as fallback from './engine-fallback';
import type { Attempt, Exam, ExamProfile, ImportedDoc, Result, Section, Topic } from './types';

/**
 * The exam room's only door to the exam engine (packages/exam-engine). Every call goes to the real engine;
 * if one throws (the engine is young), the built-in stand-in in engine-fallback.ts answers instead so the
 * room never dead-ends. Both speak the shared contract.
 */

function guard<A extends unknown[], R>(name: string, primary: (...a: A) => R, backup: (...a: A) => R): (...a: A) => R {
  return (...args: A) => {
    try {
      return primary(...args);
    } catch (e) {
      console.warn(`[exam] engine.${name} failed; using the built-in version`, e);
      return backup(...args);
    }
  };
}

/** The section id of an attempt.sectionOrder entry ("m2" or "m2:hard"). */
export const sectionIdOf = (entry: string): string => entry.split(':')[0] ?? entry;

/** How many questions a student answers in a section (one adaptive pool, not both). */
export function sectionCount(s: Section): number {
  return s.adaptive ? Math.max(s.adaptive.hard.length, s.adaptive.easy.length, s.questionIds.length) : s.questionIds.length;
}

function withTopics(p: ExamProfile, topics: Topic[] | undefined): ExamProfile {
  if (!topics?.length) return p;
  const have = new Set(p.topics.map((t) => t.topic));
  const extra = topics.filter((t) => !have.has(t));
  if (!extra.length) return p;
  const all = [...p.topics, ...extra.map((topic) => ({ topic, weight: 1 / (p.topics.length + extra.length) }))];
  const sum = all.reduce((s, t) => s + t.weight, 0);
  return { ...p, topics: all.map((t) => ({ ...t, weight: Math.round((t.weight / sum) * 100) / 100 })) };
}

export const engine = {
  importText: guard(
    'importText',
    (text: string, name: string, pages?: string[]): ImportedDoc => real.importText(name, text, pages ? { pages } : {}),
    (text: string, name: string, _pages?: string[]): ImportedDoc => fallback.importText(text, name),
  ),
  buildProfile: guard(
    'buildProfile',
    (docs: ImportedDoc[], opts: { family?: ExamProfile['family']; name?: string; topics?: Topic[] } = {}): ExamProfile =>
      withTopics(real.buildProfile(docs, { ...(opts.family ? { family: opts.family } : {}), ...(opts.name ? { name: opts.name } : {}) }), opts.topics),
    (docs: ImportedDoc[], opts: { family?: ExamProfile['family']; name?: string; topics?: Topic[] } = {}): ExamProfile => fallback.buildProfile(docs, opts),
  ),
  PRESETS: (real.PRESETS as Record<string, ExamProfile>) ?? fallback.PRESETS,
  buildExam: guard(
    'buildExam',
    (profile: ExamProfile, opts: { docs?: ImportedDoc[]; seed?: number } = {}): Exam => real.buildExam(profile, { imported: real.importedQuestions(opts.docs ?? []) }, opts.seed !== undefined ? { seed: opts.seed } : {}),
    (profile: ExamProfile, opts: { docs?: ImportedDoc[]; seed?: number } = {}): Exam => fallback.buildExam(profile, opts),
  ),
  grade: guard('grade', (exam: Exam, attempt: Attempt): Result => real.grade(exam, attempt), (exam: Exam, attempt: Attempt): Result => fallback.grade(exam, attempt)),
  /**
   * The questions a student gets in `section` and the attempt.sectionOrder entry recording that choice
   * ("m2:hard" for an adaptive module, plain "m1" otherwise).
   */
  route: guard(
    'adaptiveNext',
    (exam: Exam, attempt: Attempt, section: Section): { ids: string[]; entry: string } => {
      if (!section.adaptive) return { ids: section.questionIds, entry: section.id };
      const r = real.adaptiveNext(exam, attempt, section.id);
      return { ids: r === 'hard' ? section.adaptive.hard : section.adaptive.easy, entry: `${section.id}:${r}` };
    },
    (exam: Exam, attempt: Attempt, section: Section): { ids: string[]; entry: string } => {
      const ids = fallback.adaptiveNext(exam, attempt, section);
      return { ids, entry: section.adaptive ? `${section.id}:${ids === section.adaptive.hard ? 'hard' : 'easy'}` : section.id };
    },
  ),
};

/** Format names as shown to students (no official names or marks). */
export const FORMAT_LABELS: { family: ExamProfile['family']; label: string; blurb: string }[] = [
  { family: 'sat-style', label: 'Digital SAT-style', blurb: 'Two adaptive math modules, on-screen tools' },
  { family: 'act-style', label: 'ACT-style', blurb: 'One long timed section, four choices each' },
  { family: 'ap-style', label: 'AP-style', blurb: 'Multiple choice, then multi-part free response' },
  { family: 'gre-style', label: 'GRE-style', blurb: 'Two quantitative sections, second adapts' },
  { family: 'ib-style', label: 'IB-style', blurb: 'Written paper with marks per part' },
  { family: 'class', label: 'Class test', blurb: 'Printed test with points and show-work space' },
];

/** Shown wherever a named format appears: these are unofficial practice formats. */
export const TRADEMARK_NOTE =
  'Unofficial practice formats. SAT, PSAT/NMSQT and AP are trademarks registered by the College Board; ACT is a trademark of ACT Education Corp.; GRE is a trademark of ETS; IB is a trademark of the International Baccalaureate Organization. None of them is affiliated with or endorses Lemma.';

/** Families named after a real test (everything except the student's own class tests). */
export const isNamedFormat = (family: ExamProfile['family']): boolean => family !== 'class' && family !== 'custom';

export function preset(family: ExamProfile['family']): ExamProfile | undefined {
  const p = engine.PRESETS[family] ?? Object.values(engine.PRESETS).find((x) => x.family === family);
  return p ? structuredClone(p) : undefined;
}
