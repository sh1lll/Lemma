/**
 * @lemma/exam-engine — simulated exams built from the student's own material. Deterministic: no AI,
 * no network. Parsing is rule-based; answers are computed and checked with Lemma's own engines.
 */
import type { ImportedDoc } from './types';
import { analyze } from './importer';
import { remember } from './profile';

export * from './types';
export { PRESETS, ACT_LEGACY_VARIANT, familyRules, validateProfile, sectionCount, parseSlot, type PresetId, type FamilyRules } from './presets';
export { buildProfile, attachAnswerKeys, importedQuestions } from './profile';
export { buildExam, sectionQuestionIds, verifyQuestion, QC_CHOICES } from './build';
export { grade, adaptiveNext, gradeNumeric, gradeQuestion } from './grade';
export { verifyImportedKey, type Analysis, type DetectedSection } from './importer';
export { orderColumns, type LayoutRow, type LayoutPart } from './columns';

/** Parses one uploaded document's text (PDF extraction or OCR). `pages` helps strip running headers/footers. */
export function importText(name: string, text: string, opts: { pages?: string[] } = {}): ImportedDoc {
  return importTextDetailed(name, text, opts).doc;
}

/** importText plus what the contract can't hold: why the kind was chosen, sections with their questions. */
export function importTextDetailed(name: string, text: string, opts: { pages?: string[] } = {}) {
  const a = analyze(name, text, opts);
  remember(a);
  return a;
}
