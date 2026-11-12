/**
 * buildProfile: merges evidence from the student's uploads. With the teacher's own tests it mirrors them
 * (sections, timing, counts, type mix, choices, points, rules); otherwise it uses a format preset.
 */
import type { ExamProfile, ExamQuestion, ImportedDoc, QuestionType, Section } from './types';
import { analyze, attachEntries, type Analysis } from './importer';
import { letterBands, PRESETS, type PresetId } from './presets';
import { TopicTally } from './topics';
import { mode, slug } from './util';

const cache = new WeakMap<ImportedDoc, Analysis>();

/** Remembers the analysis of a doc returned by importText (avoids re-parsing in buildProfile). */
export function remember(a: Analysis): void {
  cache.set(a.doc, a);
}

/** The analysis behind a doc; re-derived from its text when the doc was rebuilt (e.g. after storage). */
export function analysisOf(doc: ImportedDoc): Analysis {
  const hit = cache.get(doc);
  if (hit) return hit;
  const a = analyze(doc.name, doc.text);
  cache.set(doc, a);
  return a;
}

/**
 * Attaches answer keys from 'answer-key' docs to the test docs' questions, IN PLACE, so
 * `docs.flatMap(d => d.questions)` carries the keys afterwards. A key doc goes to the test whose
 * question numbers it covers best (name similarity breaks ties). Returns notes for observations.
 */
export function attachAnswerKeys(docs: ImportedDoc[]): string[] {
  const notes: string[] = [];
  const tests = docs.filter((d) => d.kind === 'test' || d.kind === 'study-guide' || d.kind === 'unknown').filter((d) => d.questions.some((q) => q.prompt));
  for (const key of docs.filter((d) => d.kind === 'answer-key')) {
    const nums = new Set(key.questions.map((q) => q.number));
    const words = new Set(slug(key.name).split('-'));
    let best: ImportedDoc | undefined;
    let bestScore = -1;
    for (const t of tests) {
      const tn = t.questions.filter((q) => q.prompt).map((q) => q.number);
      const cover = tn.filter((n) => nums.has(n)).length / Math.max(tn.length, nums.size, 1);
      const sim = slug(t.name).split('-').filter((w) => w.length > 1 && words.has(w)).length * 0.05;
      const unkeyed = t.questions.filter((q) => q.prompt && q.answer === undefined).length / Math.max(1, tn.length);
      const score = cover + sim + unkeyed * 0.1;
      if (score > bestScore) [best, bestScore] = [t, score];
    }
    if (!best || bestScore < 0.3) {
      notes.push(`Answer key "${key.name}" didn't match any uploaded test.`);
      continue;
    }
    const unmatched = attachEntries(
      best.questions,
      key.questions.map((q) => ({ number: q.number, text: Array.isArray(q.answer) ? q.answer.join(', ') : (q.answer ?? '') })),
    );
    notes.push(`Attached answer key "${key.name}" to "${best.name}"${unmatched.length ? ` (${unmatched.length} entries unmatched)` : ''}.`);
  }
  return notes;
}

/** The questions from all docs with keys attached (copies; key-only stubs excluded). */
export function importedQuestions(docs: ImportedDoc[]): ExamQuestion[] {
  attachAnswerKeys(docs);
  return docs.flatMap((d) => d.questions.filter((q) => q.prompt)).map((q) => structuredClone(q));
}

const DOC_WEIGHT: Record<ImportedDoc['kind'], number> = { test: 3, 'study-guide': 1.5, notes: 1, 'answer-key': 0, unknown: 0.5 };

function mergedTopics(docs: ImportedDoc[]): ExamProfile['topics'] {
  const t = new TopicTally();
  for (const d of docs) t.merge(d.topics, DOC_WEIGHT[d.kind]);
  return t.result();
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function buildProfile(docs: ImportedDoc[], opts: { family?: ExamProfile['family']; name?: string } = {}): ExamProfile {
  const keyNotes = attachAnswerKeys(docs);
  const tests = docs.filter((d) => d.kind === 'test' && d.questions.some((q) => q.prompt));
  const topics = mergedTopics(docs);
  const presetFamily = opts.family && opts.family !== 'custom' && opts.family !== 'class' ? (opts.family as PresetId) : undefined;

  if (!tests.length || presetFamily) {
    const base = structuredClone(PRESETS[presetFamily ?? 'class']);
    const observations = [...base.observations, ...keyNotes];
    if (tests.length) observations.push(`Uploaded tests (${tests.map((t) => t.name).join(', ')}) supply topics and question variants; the format follows the ${base.name} preset.`);
    if (topics.length) {
      base.topics = topics;
      observations.push(`Topic weights come from your uploads: ${topics.slice(0, 4).map((t) => `${t.topic} ${pct(t.weight)}`).join(', ')}.`);
    }
    return { ...base, id: `${base.id}-${slug(opts.name ?? base.name)}`, name: opts.name ?? base.name, observations };
  }

  // Mirror the most complete class test.
  const template = [...tests].sort((a, b) => b.questions.filter((q) => q.prompt).length - a.questions.filter((q) => q.prompt).length)[0]!;
  const a = analysisOf(template);
  const qs = template.questions.filter((q) => q.prompt);
  const byId = new Map(qs.map((q) => [q.id, q]));
  const observations: string[] = [...keyNotes];
  if (tests.length > 1) observations.push(`${tests.length} tests uploaded; mirrored "${template.name}" (the most complete) and used the others for topics and variants.`);

  const total = template.hints.timeMinutes ?? 50;
  if (template.hints.timeMinutes === undefined) observations.push('No time limit found; assumed a 50-minute class period.');
  const detected = a.sections.filter((s) => s.questionIds.some((id) => byId.has(id)));
  const loose = qs.filter((q) => !detected.some((s) => s.questionIds.includes(q.id)));
  const groups: { title: string; minutes?: number; calculator?: boolean; ids: string[] }[] = detected.map((s) => ({ title: s.title, minutes: s.minutes, calculator: s.calculator, ids: s.questionIds.filter((id) => byId.has(id)) }));
  if (loose.length) {
    if (groups.length) groups[groups.length - 1]!.ids.push(...loose.map((q) => q.id));
    else groups.push({ title: a.title || template.name, calculator: template.hints.calculator, ids: loose.map((q) => q.id) });
  }

  // Time split: stated per section, otherwise by points (what a teacher budgets), rounded to whole minutes.
  const stated = groups.every((g) => g.minutes !== undefined);
  const pts = groups.map((g) => g.ids.reduce((s, id) => s + (byId.get(id)?.points ?? 1), 0));
  const allPts = pts.reduce((x, y) => x + y, 0) || 1;
  let minutes = groups.map((g, i) => (stated ? g.minutes! : Math.round((total * pts[i]!) / allPts)));
  if (!stated) {
    const drift = total - minutes.reduce((x, y) => x + y, 0);
    if (minutes.length) minutes[minutes.length - 1]! += drift;
    if (groups.length > 1) observations.push(`Total time ${total} min split by points: ${groups.map((g, i) => `${g.title} ${minutes[i]} min`).join(', ')} (estimated).`);
  }
  if (!minutes.length) minutes = [total];

  const calcRules = groups.map((g) => g.calculator ?? template.hints.calculator ?? true);
  const calcDiffers = new Set(calcRules).size > 1;
  const sections: Section[] = groups.map((g, i) => {
    const s: Section = {
      id: `part-${i + 1}`,
      title: g.title,
      minutes: minutes[i]!,
      calculator: calcRules[i]!,
      questionIds: g.ids,
      // When calculator rules differ, the no-calculator part is handed in before calculators come out.
      canReturn: !calcDiffers,
    };
    const types = new Set(g.ids.map((id) => byId.get(id)!.type));
    if (template.hints.showWork && (types.has('free') || types.has('short'))) s.instructions = 'Show all work for full credit.';
    return s;
  });

  // Type mix and counts.
  const counts: Partial<Record<QuestionType, number>> = {};
  for (const q of qs) counts[q.type] = (counts[q.type] ?? 0) + 1;
  const mix: ExamProfile['mix'] = {};
  for (const [t, n] of Object.entries(counts) as [QuestionType, number][]) mix[t] = Math.round((n / qs.length) * 1000) / 1000;
  observations.push(`${qs.length} questions: ${Object.entries(counts).map(([t, n]) => `${n} ${label(t as QuestionType)}`).join(', ')}.`);
  observations.push(`Sections in order: ${sections.map((s) => `${s.title} (${s.questionIds.length} Q, ${s.calculator ? 'calculator' : 'no calculator'})`).join('; ')}.`);

  const choiceCounts = qs.filter((q) => q.type === 'mc' && q.choices).map((q) => q.choices!.length);
  const choices = mode(choiceCounts);
  if (choices !== undefined) observations.push(`Answer choices per question: ${choices}.`);
  const mcPts = mode(qs.filter((q) => q.type === 'mc' || q.type === 'multi').map((q) => q.points));
  if (template.hints.pointsShown) observations.push(`Points shown per question${mcPts !== undefined ? ` (multiple choice ${mcPts} pts each)` : ''}; total ${allPts} pts.`);
  if (template.hints.showWork) observations.push('Show-work rule: free response requires work.');
  if (template.hints.header?.length) observations.push(`Header fields: ${template.hints.header.join(', ')}.`);
  const figures = qs.filter((q) => q.figure).length;
  if (figures) observations.push(`${figures} question(s) use a figure or table (shown as text).`);
  const keyed = qs.filter((q) => q.answer !== undefined || q.parts?.some((p) => p.answer !== undefined || p.rubric)).length;
  observations.push(`Answer key found for ${keyed} of ${qs.length} questions.`);

  const room = a.digital ? 'digital-linear' : 'paper';
  const anyCalc = calcRules.some(Boolean);
  return {
    id: `custom-${slug(opts.name ?? template.name)}`,
    name: opts.name ?? a.title ?? template.name,
    family: opts.family === 'class' ? 'class' : 'custom',
    room,
    sections,
    scoring: { kind: 'percent', bands: letterBands(), guessingPenalty: 0 },
    tools: { calculator: anyCalc ? (a.graphing ? 'graphing' : 'scientific') : 'none', scratch: true, highlighter: false, eliminator: room === 'paper', markForReview: true },
    rules: { fullscreen: false, warnAtMinutes: total >= 30 ? [10, 5] : [5], allowPause: false, showTimer: 'always' },
    observations,
    topics,
    mix,
  };
}

function label(t: QuestionType): string {
  return { mc: 'multiple choice', multi: 'select-all', numeric: 'numeric', expression: 'expression', short: 'short answer', free: 'free response' }[t];
}
