import { check, classify, generate, similarTo, TOPICS, type AnswerKind, type Difficulty, type Question } from '@lemma/practice-engine';
import type { Attempt, Choice, Exam, ExamProfile, ExamQuestion, ImportedDoc, Part, QuestionType, Result, Section, Topic } from './types';

/**
 * A small, self-contained stand-in for packages/exam-engine, used until the real engine lands (engine.ts
 * picks the real one automatically). It follows the shared contract so the room never knows the difference.
 */

// ---------------------------------------------------------------------------------------------------------
// Random numbers

function rng(seed: number) {
  let a = seed >>> 0 || 1;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]! };
}

const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`;

// ---------------------------------------------------------------------------------------------------------
// Import

const Q_START = /^\s*(?:question\s*|q\.?\s*|problem\s*)?(\d{1,3})\s*[.)]\s*(.*)$|^\s*(?:question|problem)\s+(\d{1,3})\s*[:.-]?\s*(.*)$/i;
const CHOICE_LINE = /^\s*\(?([A-Ea-e])[.)]\s+(.+)$/;
const PART_LINE = /^\s*\(([a-h]|i{1,3}|iv|v)\)\s+(.+)$/;
const POINTS = /[([]\s*(\d+(?:\.\d+)?)\s*(?:pts?|points?|marks?)\s*[)\]]/i;
const SECTION_LINE = /^\s*((?:part|section|paper|module)\s+(?:[IVX]+|\d+|[A-D])\b.*)$/i;
const KEY_HEAD = /^\s*(?:answer\s*key|answers|key)\s*:?\s*$/i;

function splitInlineChoices(s: string): { stem: string; choices: Choice[] } | null {
  const re = /(?:^|\s)\(?([A-E])[.)]\s+/g;
  const marks: { id: string; at: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) marks.push({ id: m[1]!, at: m.index, end: m.index + m[0].length });
  if (marks.length < 2 || marks[0]!.id !== 'A') return null;
  for (let i = 0; i < marks.length; i++) if (marks[i]!.id !== String.fromCharCode(65 + i)) return null;
  const choices = marks.map((mk, i) => ({ id: mk.id, text: s.slice(mk.end, marks[i + 1]?.at ?? s.length).trim() }));
  return { stem: s.slice(0, marks[0]!.at).trim(), choices };
}

function parseKey(lines: string[]): Record<number, string> {
  const key: Record<number, string> = {};
  for (const l of lines) {
    const re = /(\d{1,3})\s*[.):-]\s*([A-E](?![a-z])|[-−]?\d+(?:[./]\d+)?|[^,;\d][^,;]*?)(?=\s+\d{1,3}\s*[.):-]|[,;]|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(l))) key[Number(m[1])] = m[2]!.trim().replace(/−/g, '-');
  }
  return key;
}

export function importText(text: string, name: string): ImportedDoc {
  const clean = text.replace(/\r\n?/g, '\n').replace(/\t/g, ' ');
  const lines = clean.split('\n').map((l) => l.replace(/\s+$/, ''));
  const hints: ImportedDoc['hints'] = {};
  const warnings: string[] = [];

  const time = /(?:time(?:\s+limit)?|you have|allowed)\D{0,20}(\d{1,3})\s*(?:minutes|mins?)\b|(\d{1,3})\s*(?:minutes|mins?)\b/i.exec(clean);
  if (time) hints.timeMinutes = Number(time[1] ?? time[2]);
  if (/\bno\s+calculators?\b|calculators?\s+(?:are\s+|is\s+)?not\s+(?:allowed|permitted)|without\s+(?:a\s+)?calculator/i.test(clean)) hints.calculator = false;
  else if (/calculators?\s+(?:are\s+|is\s+)?(?:allowed|permitted)|(?:may|can)\s+use\s+(?:a\s+)?calculator|calculator\s+(?:active|section)/i.test(clean)) hints.calculator = true;
  if (/show\s+(?:all\s+)?(?:of\s+)?(?:your\s+)?work/i.test(clean)) hints.showWork = true;
  if (POINTS.test(clean)) hints.pointsShown = true;
  const header = ['Name', 'Date', 'Period', 'Class', 'Teacher', 'Score', 'Block'].filter((f) => new RegExp(`\\b${f}\\s*[:_]`, 'i').test(clean));
  if (header.length) hints.header = header;
  const sections = lines.map((l) => SECTION_LINE.exec(l)?.[1]?.trim()).filter((s): s is string => !!s && s.length < 80);
  if (sections.length) hints.sections = [...new Set(sections)];

  // Answer key block at the end ("Answer Key" heading), or a whole file of "1. B  2. C".
  let keyFrom = lines.findIndex((l) => KEY_HEAD.test(l));
  const body = keyFrom >= 0 ? lines.slice(0, keyFrom) : lines;
  const key = keyFrom >= 0 ? parseKey(lines.slice(keyFrom + 1)) : {};

  const questions: ExamQuestion[] = [];
  let cur: { n: number; stem: string[]; choices: Choice[]; parts: Part[]; points?: number; answer?: string; section?: string } | null = null;
  let section: string | undefined;
  const flush = () => {
    if (!cur) return;
    let stem = cur.stem.join(' ').replace(/\s+/g, ' ').trim();
    const pts = POINTS.exec(stem);
    if (pts) {
      cur.points = Number(pts[1]);
      stem = stem.replace(POINTS, '').trim();
    }
    const ans = /\b(?:answer|ans)\s*[:=]\s*(.+)$/i.exec(stem);
    if (ans) {
      cur.answer = ans[1]!.trim();
      stem = stem.slice(0, ans.index).trim();
    }
    if (!cur.choices.length) {
      const inline = splitInlineChoices(stem);
      if (inline) {
        stem = inline.stem;
        cur.choices = inline.choices;
      }
    }
    const multi = /select all|choose all|all that apply/i.test(stem);
    const type: QuestionType = cur.parts.length ? 'free' : cur.choices.length ? (multi ? 'multi' : 'mc') : /^[-−]?\d/.test(cur.answer ?? key[cur.n] ?? '') ? 'numeric' : /explain|justify|why|describe/i.test(stem) ? 'short' : 'numeric';
    const answer = cur.answer ?? key[cur.n];
    const topic = classify(stem) ?? undefined;
    const q: ExamQuestion = {
      id: `imp-${questions.length + 1}-${cur.n}`,
      number: cur.n,
      type,
      prompt: stem,
      points: cur.points ?? (cur.parts.length ? cur.parts.reduce((s, p) => s + p.points, 0) : 1),
      origin: 'imported',
    };
    if (cur.choices.length) q.choices = cur.choices;
    if (cur.parts.length) q.parts = cur.parts;
    if (answer !== undefined) q.answer = type === 'multi' ? answer.split(/[\s,]+/).filter(Boolean) : type === 'mc' ? answer.toUpperCase().slice(0, 1) : answer;
    if (topic) q.topic = topic;
    if (hints.calculator !== undefined) q.calculator = hints.calculator;
    questions.push(q);
    cur = null;
  };
  for (const raw of body) {
    const line = raw.trim();
    if (!line) continue;
    const sec = SECTION_LINE.exec(line);
    if (sec && line.length < 80) {
      flush();
      section = sec[1];
      continue;
    }
    const qs = Q_START.exec(line);
    if (qs && (qs[2] ?? qs[4] ?? '').length > 0 && !/^\d+\s*[.)]\s*\d/.test(line)) {
      flush();
      cur = { n: Number(qs[1] ?? qs[3]), stem: [qs[2] ?? qs[4] ?? ''], choices: [], parts: [], section };
      continue;
    }
    if (!cur) continue;
    const part = PART_LINE.exec(line);
    if (part) {
      const text = part[2]!;
      const pts = POINTS.exec(text);
      cur.parts.push({ label: part[1]!, prompt: text.replace(POINTS, '').trim(), points: pts ? Number(pts[1]) : 1, type: 'short' });
      continue;
    }
    const ch = CHOICE_LINE.exec(line);
    if (ch && /[A-E]/.test(ch[1]!) && !cur.parts.length) {
      const inline = splitInlineChoices(line);
      if (inline && inline.choices.length > 1 && !inline.stem) cur.choices.push(...inline.choices);
      else cur.choices.push({ id: ch[1]!.toUpperCase(), text: ch[2]!.trim() });
      continue;
    }
    if (cur.parts.length) {
      const last = cur.parts[cur.parts.length - 1]!;
      last.prompt += ' ' + line;
    } else cur.stem.push(line);
  }
  flush();

  const choiceCounts = questions.filter((q) => q.choices?.length).map((q) => q.choices!.length);
  if (choiceCounts.length) hints.choicesPerQuestion = Math.round(choiceCounts.reduce((a, b) => a + b, 0) / choiceCounts.length);

  const keyed = questions.filter((q) => q.answer !== undefined).length;
  const keyOnly = !questions.length && Object.keys(parseKey(lines)).length >= 3;
  const kind: ImportedDoc['kind'] = keyOnly
    ? 'answer-key'
    : questions.length >= 2
      ? 'test'
      : /study\s*guide|review\s+sheet|topics?\s+(?:to|covered)|you\s+should\s+know/i.test(clean)
        ? 'study-guide'
        : clean.length > 200
          ? 'notes'
          : 'unknown';

  // Topics: from questions, else from each line of notes.
  const counts = new Map<Topic, number>();
  const sources = questions.length ? questions.map((q) => q.prompt) : lines;
  for (const s of sources) {
    const t = classify(s) ?? TOPICS.find((x) => new RegExp(`\\b${x.label.split(' ')[0]}`, 'i').test(s))?.id ?? null;
    if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0) || 1;
  const topics = [...counts].sort((a, b) => b[1] - a[1]).map(([topic, n]) => ({ topic, weight: Math.round((n / total) * 100) / 100 }));

  if (kind === 'test' && keyed === 0) warnings.push('No answer key found. Add one below so the exam can be scored.');
  else if (kind === 'test' && keyed < questions.length) warnings.push(`Answer key covers ${keyed} of ${questions.length} questions.`);
  if (kind === 'answer-key') warnings.push('This looks like an answer key on its own. It will be matched to your test by question number.');
  if (!questions.length && kind !== 'answer-key') warnings.push('No numbered questions found. It will still guide the topics.');
  if (/\b(?:figure|graph|diagram|table)\s+(?:below|above|shown)\b/i.test(clean)) warnings.push('Some questions mention a figure; figures are described in text, not copied.');
  if (keyFrom >= 0 && !Object.keys(key).length) keyFrom = -1;

  return { name, kind, text: clean, questions, hints, topics, warnings };
}

// ---------------------------------------------------------------------------------------------------------
// Presets

const ph = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}-${i + 1}`);

function sec(id: string, title: string, minutes: number | null, calculator: boolean, count: number, extra: Partial<Section> = {}): Section {
  return { id, title, minutes, calculator, questionIds: ph(id, count), canReturn: false, ...extra };
}

const MATH_REFERENCE = 'math-reference';

export const PRESETS: Record<string, ExamProfile> = {
  'sat-style': {
    id: 'preset-sat',
    name: 'Digital SAT-style Math',
    family: 'sat-style',
    room: 'digital-adaptive',
    sections: [
      sec('m1', 'Section 2, Module 1: Math', 35, true, 22, { breakAfterMinutes: 10, instructions: 'The questions in this section address a number of important math skills. Use of a calculator is permitted for all questions. Unless otherwise indicated: all variables and expressions represent real numbers, figures are drawn to scale, and figures lie in a plane.' }),
      sec('m2', 'Section 2, Module 2: Math', 35, true, 22, { adaptive: { after: 'm1', threshold: 0.6, easy: [], hard: [] }, instructions: 'This module follows the same rules as Module 1. Its questions were chosen based on your performance in Module 1.' }),
    ],
    scoring: { kind: 'scaled', min: 200, max: 800 },
    tools: { calculator: 'graphing', referenceSheet: MATH_REFERENCE, scratch: true, highlighter: true, eliminator: true, markForReview: true },
    rules: { fullscreen: true, warnAtMinutes: [5], allowPause: false, showTimer: 'toggle' },
    observations: ['Two math modules of 22 questions, 35 minutes each', 'Module 2 is easier or harder depending on Module 1', 'About 3 in 4 questions are multiple choice; the rest are typed answers', 'Calculator and reference sheet available throughout'],
    topics: [
      { topic: 'linear', weight: 0.25 },
      { topic: 'system', weight: 0.15 },
      { topic: 'quadratic', weight: 0.15 },
      { topic: 'percent', weight: 0.15 },
      { topic: 'stats', weight: 0.1 },
      { topic: 'geometry', weight: 0.1 },
      { topic: 'exponents', weight: 0.1 },
    ],
    mix: { mc: 0.75, numeric: 0.25 },
  },
  'act-style': {
    id: 'preset-act',
    name: 'ACT-style Math',
    family: 'act-style',
    room: 'digital-linear',
    sections: [sec('math', 'Mathematics Test', 50, true, 45, { instructions: 'Solve each problem, choose the correct answer, and then select it. Do not linger over problems that take too much time. You may use a calculator. Illustrative figures are not necessarily drawn to scale.' })],
    scoring: { kind: 'scaled', min: 1, max: 36 },
    tools: { calculator: 'scientific', scratch: true, highlighter: true, eliminator: true, markForReview: true },
    rules: { fullscreen: true, warnAtMinutes: [5], allowPause: false, showTimer: 'toggle' },
    observations: ['One 50-minute math section with 45 questions', 'Four answer choices per question', 'No penalty for guessing', 'Calculator allowed'],
    topics: [
      { topic: 'linear', weight: 0.2 },
      { topic: 'quadratic', weight: 0.15 },
      { topic: 'geometry', weight: 0.2 },
      { topic: 'stats', weight: 0.15 },
      { topic: 'percent', weight: 0.1 },
      { topic: 'fractions', weight: 0.1 },
      { topic: 'exponents', weight: 0.1 },
    ],
    mix: { mc: 1 },
  },
  'ap-style': {
    id: 'preset-ap',
    name: 'AP-style Calculus',
    family: 'ap-style',
    room: 'free-response',
    sections: [
      sec('mc-a', 'Section I, Part A: Multiple Choice (no calculator)', 30, false, 15, { instructions: 'Choose the best answer for each question. No calculator is allowed for this part.' }),
      sec('fr-b', 'Section II: Free Response (calculator)', 30, true, 2, { instructions: 'Show all of your work. Your work will be scored on the correctness and completeness of your methods as well as your answers. Answers without supporting work may not earn credit.' }),
    ],
    scoring: { kind: 'band', bands: [{ minPercent: 70, label: '5' }, { minPercent: 55, label: '4' }, { minPercent: 40, label: '3' }, { minPercent: 25, label: '2' }, { minPercent: 0, label: '1' }] },
    tools: { calculator: 'graphing', formulaSheet: undefined, scratch: true, highlighter: false, eliminator: true, markForReview: true },
    rules: { fullscreen: true, warnAtMinutes: [10, 5], allowPause: false, showTimer: 'toggle' },
    observations: ['A multiple-choice part without a calculator, then free-response with one', 'Free-response questions have parts (a), (b), (c) with points for each', 'Work must be shown for credit', 'Score reported on a 1–5 scale (estimate)'],
    topics: [
      { topic: 'derivative', weight: 0.5 },
      { topic: 'integral', weight: 0.4 },
      { topic: 'quadratic', weight: 0.1 },
    ],
    mix: { mc: 0.8, free: 0.2 },
  },
  'gre-style': {
    id: 'preset-gre',
    name: 'GRE-style Quantitative',
    family: 'gre-style',
    room: 'digital-adaptive',
    sections: [
      sec('q1', 'Quantitative Reasoning, Section 1', 21, true, 12),
      sec('q2', 'Quantitative Reasoning, Section 2', 26, true, 15, { adaptive: { after: 'q1', threshold: 0.6, easy: [], hard: [] } }),
    ],
    scoring: { kind: 'scaled', min: 130, max: 170 },
    tools: { calculator: 'basic', scratch: true, highlighter: false, eliminator: false, markForReview: true },
    rules: { fullscreen: true, warnAtMinutes: [5], allowPause: false, showTimer: 'toggle' },
    observations: ['Two quantitative sections (21 and 26 minutes)', 'The second section adapts to how you did on the first', 'Basic on-screen calculator', 'You can mark questions and move around within a section'],
    topics: [
      { topic: 'arithmetic', weight: 0.2 },
      { topic: 'fractions', weight: 0.15 },
      { topic: 'percent', weight: 0.2 },
      { topic: 'stats', weight: 0.15 },
      { topic: 'geometry', weight: 0.15 },
      { topic: 'linear', weight: 0.15 },
    ],
    mix: { mc: 0.7, numeric: 0.3 },
  },
  'ib-style': {
    id: 'preset-ib',
    name: 'IB-style Mathematics Paper',
    family: 'ib-style',
    room: 'free-response',
    sections: [sec('p1', 'Paper 1 (no calculator)', 90, false, 6, { instructions: 'Answer all questions in the spaces provided. Full marks are not necessarily awarded for a correct answer with no working. Answers must be supported by working and/or explanations.' })],
    scoring: { kind: 'band', bands: [{ minPercent: 80, label: '7' }, { minPercent: 68, label: '6' }, { minPercent: 55, label: '5' }, { minPercent: 42, label: '4' }, { minPercent: 30, label: '3' }, { minPercent: 15, label: '2' }, { minPercent: 0, label: '1' }] },
    tools: { calculator: 'none', scratch: true, highlighter: false, eliminator: false, markForReview: true },
    rules: { fullscreen: true, warnAtMinutes: [15, 5], allowPause: false, showTimer: 'always' },
    observations: ['Written answers with working for every part', 'Marks shown for each part', 'No calculator on this paper', 'Grade reported 1–7 (estimate)'],
    topics: [
      { topic: 'quadratic', weight: 0.3 },
      { topic: 'exponents', weight: 0.2 },
      { topic: 'derivative', weight: 0.3 },
      { topic: 'stats', weight: 0.2 },
    ],
    mix: { free: 1 },
  },
  class: {
    id: 'preset-class',
    name: 'Class test',
    family: 'class',
    room: 'paper',
    sections: [sec('t', 'Unit Test', 50, true, 15, { canReturn: true, instructions: 'Read each question carefully. Show all work for full credit. Circle or fill in your final answer.' })],
    scoring: { kind: 'band', bands: [{ minPercent: 90, label: 'A' }, { minPercent: 80, label: 'B' }, { minPercent: 70, label: 'C' }, { minPercent: 60, label: 'D' }, { minPercent: 0, label: 'F' }] },
    tools: { calculator: 'scientific', scratch: true, highlighter: false, eliminator: true, markForReview: true },
    rules: { fullscreen: false, warnAtMinutes: [10, 5], allowPause: true, showTimer: 'toggle' },
    observations: ['One timed test with points per question', 'Space to show work under each question', 'Letter grade from the percentage'],
    topics: [
      { topic: 'linear', weight: 0.4 },
      { topic: 'system', weight: 0.3 },
      { topic: 'percent', weight: 0.3 },
    ],
    mix: { mc: 0.6, numeric: 0.4 },
  },
};

// ---------------------------------------------------------------------------------------------------------
// Profile from imports

const TOPIC_LABEL = (t: Topic) => TOPICS.find((x) => x.id === t)?.label ?? t;

export function buildProfile(docs: ImportedDoc[], opts: { family?: ExamProfile['family']; name?: string; topics?: Topic[] } = {}): ExamProfile {
  const base = structuredClone(PRESETS[opts.family && opts.family !== 'custom' ? (opts.family === 'psat-style' ? 'sat-style' : opts.family) : 'class'] ?? PRESETS.class!);
  const tests = docs.filter((d) => d.kind === 'test');
  const keys = docs.filter((d) => d.kind === 'answer-key');
  const questions = tests.flatMap((d) => d.questions);
  const obs: string[] = [];
  const profile: ExamProfile = { ...base, id: uid('profile'), family: docs.length ? 'custom' : base.family, observations: obs };
  if (opts.name) profile.name = opts.name;
  else if (tests[0]) profile.name = tests[0].name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ');

  if (questions.length) {
    const time = tests.map((d) => d.hints.timeMinutes).find((t) => t !== undefined);
    const calc = tests.map((d) => d.hints.calculator).find((c) => c !== undefined);
    const free = questions.filter((q) => q.type === 'free').length;
    profile.room = free > questions.length / 2 ? 'free-response' : 'paper';
    const titles = [...new Set(tests.flatMap((d) => d.hints.sections ?? []))];
    const n = Math.max(1, Math.round(questions.length / Math.max(1, tests.length)));
    if (titles.length > 1) {
      const per = Math.max(1, Math.round(n / titles.length));
      profile.sections = titles.map((t, i) => ({ id: `s${i + 1}`, title: t, minutes: time ? Math.round(time / titles.length) : null, calculator: !/no\s+calculator|non-?calculator/i.test(t) && calc !== false, questionIds: ph(`s${i + 1}`, per), canReturn: true }));
    } else {
      profile.sections = [{ id: 's1', title: titles[0] ?? profile.name, minutes: time ?? null, calculator: calc ?? true, questionIds: ph('s1', n), canReturn: true, instructions: tests.some((d) => d.hints.showWork) ? 'Show all work for full credit.' : 'Answer every question.' }];
    }
    obs.push(`${questions.length} question${questions.length === 1 ? '' : 's'} found in ${tests.length} test${tests.length === 1 ? '' : 's'}; your exam will have ${n}.`);
    obs.push(time ? `Time limit: ${time} minutes.` : 'No time limit was printed, so the exam is untimed. You can set one.');
    if (calc !== undefined) obs.push(calc ? 'A calculator is allowed.' : 'No calculator allowed.');
    const per = Math.round(tests.map((d) => d.hints.choicesPerQuestion ?? 0).filter(Boolean).reduce((a, b, _i, xs) => a + b / xs.length, 0));
    if (per) obs.push(`Multiple-choice questions have ${per} choices (${'ABCDE'.slice(0, per).split('').join(', ')}).`);
    const mc = questions.filter((q) => q.type === 'mc' || q.type === 'multi').length;
    obs.push(`${Math.round((mc / questions.length) * 100)}% multiple choice, ${Math.round(((questions.length - mc - free) / questions.length) * 100)}% written answers${free ? `, ${free} multi-part` : ''}.`);
    if (tests.some((d) => d.hints.pointsShown)) obs.push('Point values are printed next to each question.');
    if (tests.some((d) => d.hints.showWork)) obs.push('Work must be shown: each question gets show-work space.');
    const header = [...new Set(tests.flatMap((d) => d.hints.header ?? []))];
    if (header.length) obs.push(`The header asks for ${header.join(', ')}.`);
    if (titles.length > 1) obs.push(`Sections: ${titles.join('; ')}.`);
    const keyed = questions.filter((q) => q.answer !== undefined).length + (keys.length ? 1 : 0);
    obs.push(keyed ? `Answer key available${keys.length ? ' (from a separate key)' : ''}.` : 'No answer key: Lemma will work out answers where it can.');
    const mix: ExamProfile['mix'] = {};
    for (const q of questions) mix[q.type] = (mix[q.type] ?? 0) + 1 / questions.length;
    profile.mix = mix;
    profile.tools = { ...profile.tools, highlighter: false, calculator: calc === false ? 'none' : 'scientific', eliminator: true, scratch: true, markForReview: true };
    profile.rules = { ...profile.rules, fullscreen: false, allowPause: true, warnAtMinutes: time && time >= 30 ? [10, 5] : [5] };
  }

  const topicDocs = docs.flatMap((d) => d.topics);
  const weights = new Map<Topic, number>();
  for (const t of topicDocs) weights.set(t.topic, (weights.get(t.topic) ?? 0) + t.weight);
  for (const t of opts.topics ?? []) weights.set(t, (weights.get(t) ?? 0) + 1);
  if (weights.size) {
    const sum = [...weights.values()].reduce((a, b) => a + b, 0);
    profile.topics = [...weights].sort((a, b) => b[1] - a[1]).map(([topic, w]) => ({ topic, weight: Math.round((w / sum) * 100) / 100 }));
    obs.push(`Topics: ${profile.topics.slice(0, 4).map((t) => `${TOPIC_LABEL(t.topic)} (${Math.round(t.weight * 100)}%)`).join(', ')}.`);
  }
  if (docs.some((d) => d.kind === 'study-guide' || d.kind === 'notes')) obs.push('Study guides and notes were used to weight the topics.');
  if (!obs.length) obs.push(...base.observations);
  return profile;
}

// ---------------------------------------------------------------------------------------------------------
// Exam generation

function answerKind(display: string, topic?: Topic): AnswerKind {
  if (topic === 'system' || /^\(?\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\)?$/.test(display) || /x\s*=.*,\s*y\s*=/.test(display)) return 'pair';
  if (/\bor\b|±/.test(display)) return 'set';
  if (/[a-wyz]|x(?!\s*=)/i.test(display.replace(/^[a-z]\s*=\s*/i, '')) && !/^\$?-?[\d.,]+\s*%?$/.test(display)) return 'expression';
  return 'number';
}

function distractors(display: string, r: ReturnType<typeof rng>): string[] | null {
  const nums = display.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length > 3) return null;
  const variants = new Set<string>();
  const fns = [(n: number) => n + 1, (n: number) => n - 1, (n: number) => -n, (n: number) => n * 2, (n: number) => n + 2, (n: number) => Math.round(n / 2 * 100) / 100, (n: number) => n - 3, (n: number) => n * 10];
  for (let k = 0; variants.size < 3 && k < fns.length * 2; k++) {
    const f = fns[(k + r.int(fns.length)) % fns.length]!;
    let i = 0;
    const v = display.replace(/-?\d+(?:\.\d+)?/g, (m) => {
      const n = Number(m);
      const decimals = (m.split('.')[1] ?? '').length;
      const out = i++ === 0 || r.next() < 0.5 ? f(n) : n;
      return String(Number(out.toFixed(Math.max(decimals, 2))));
    });
    if (v !== display) variants.add(v);
  }
  return variants.size === 3 ? [...variants] : null;
}

function fromPractice(q: Question, number: number, type: QuestionType, r: ReturnType<typeof rng>, calculator: boolean, idPrefix: string): ExamQuestion {
  const out: ExamQuestion = {
    id: `${idPrefix}-${number}-${q.seed % 100000}`,
    number,
    type,
    prompt: q.prompt,
    points: 1,
    topic: q.topic,
    difficulty: q.difficulty,
    calculator,
    steps: q.steps.map((s) => (s.tex ? { text: s.text, tex: s.tex } : { text: s.text })),
    origin: 'generated',
  };
  if (q.promptTex) out.tex = q.promptTex;
  if (type === 'mc') {
    const wrong = distractors(q.answer.display, r);
    if (wrong) {
      const texts = [...wrong];
      const at = r.int(4);
      texts.splice(at, 0, q.answer.display);
      out.choices = texts.map((t, i) => ({ id: 'ABCD'[i]!, text: t }));
      out.answer = 'ABCD'[at]!;
      return out;
    }
    out.type = answerKind(q.answer.display, q.topic) === 'number' ? 'numeric' : 'expression';
  }
  out.answer = q.answer.display;
  return out;
}

function pickTopic(topics: ExamProfile['topics'], r: ReturnType<typeof rng>): Topic {
  const total = topics.reduce((s, t) => s + t.weight, 0);
  if (!topics.length || total <= 0) return r.pick(['linear', 'percent', 'geometry'] as Topic[]);
  let x = r.next() * total;
  for (const t of topics) if ((x -= t.weight) <= 0) return t.topic;
  return topics[topics.length - 1]!.topic;
}

function pickType(mix: ExamProfile['mix'], r: ReturnType<typeof rng>, inFree: boolean): QuestionType {
  const entries = Object.entries(mix).filter(([, w]) => (w ?? 0) > 0) as [QuestionType, number][];
  if (inFree) return 'free';
  const pool = entries.filter(([t]) => t !== 'free');
  if (!pool.length) return 'mc';
  const total = pool.reduce((s, [, w]) => s + w, 0);
  let x = r.next() * total;
  for (const [t, w] of pool) if ((x -= w) <= 0) return t === 'multi' || t === 'short' ? 'mc' : t;
  return pool[0]![0];
}

function freeQuestion(topic: Topic, number: number, seed: number, calculator: boolean, idPrefix: string): ExamQuestion {
  const parts: Part[] = [];
  const steps: { text: string; tex?: string }[] = [];
  const labels = ['a', 'b', 'c'];
  for (let i = 0; i < 3; i++) {
    const g = generate(topic, { difficulty: (i + 1) as Difficulty, seed: seed + i * 7919 });
    const kind = answerKind(g.answer.display, topic);
    const part: Part = { label: labels[i]!, prompt: g.prompt, points: i + 2, answer: g.answer.display, type: kind === 'number' ? 'numeric' : 'expression', rubric: [`Correct method (${i + 1} pt${i ? 's' : ''})`, 'Correct answer (1 pt)'] };
    if (g.promptTex) part.tex = g.promptTex;
    parts.push(part);
    steps.push({ text: `Part (${labels[i]}).` }, ...g.steps.map((s) => (s.tex ? { text: s.text, tex: s.tex } : { text: s.text })));
  }
  return {
    id: `${idPrefix}-${number}-${seed % 100000}`,
    number,
    type: 'free',
    prompt: `${TOPIC_LABEL(topic)}. Answer each part. Show the work that leads to each answer.`,
    parts,
    points: parts.reduce((s, p) => s + p.points, 0),
    topic,
    difficulty: 2,
    calculator,
    steps,
    origin: 'generated',
  };
}

export function buildExam(profile: ExamProfile, opts: { docs?: ImportedDoc[]; seed?: number } = {}): Exam {
  const seed = (opts.seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0;
  const r = rng(seed);
  const p: ExamProfile = structuredClone(profile);
  const questions: ExamQuestion[] = [];
  const key = new Map<number, string>();
  for (const d of opts.docs ?? []) if (d.kind === 'answer-key') for (const [n, a] of Object.entries(parseKey(d.text.split('\n')))) key.set(Number(n), a);
  const pool = (opts.docs ?? []).filter((d) => d.kind === 'test').flatMap((d) => d.questions);
  let poolAt = 0;
  let number = 0;
  const seen = new Set<string>();
  const freeRoom = p.room === 'free-response';

  const make = (s: Section, difficulty: Difficulty | null, prefix: string): ExamQuestion => {
    number++;
    const imported = pool[poolAt];
    if (imported && difficulty === null && poolAt < pool.length) {
      poolAt++;
      const q: ExamQuestion = { ...structuredClone(imported), id: `${prefix}-${number}-i`, number, calculator: s.calculator };
      if (q.answer === undefined && key.has(imported.number)) q.answer = key.get(imported.number)!;
      if (q.answer === undefined && q.type !== 'free') {
        const v = similarTo(q.prompt);
        if (v && !q.choices) q.steps = v.steps;
      }
      return q;
    }
    // Variants of imported questions first, then fresh generation.
    const base = pool.length ? pool[(number - 1) % pool.length] : undefined;
    const freeHere = freeRoom && (/free\s*response|section\s*ii|paper/i.test(s.title) || (p.mix.free ?? 0) >= 1);
    const type = pickType(p.mix, r, freeHere);
    const topic = base?.topic ?? pickTopic(p.topics, r);
    if (type === 'free') return freeQuestion(topic, number, seed + number * 131, s.calculator, prefix);
    let g: Question | null = null;
    for (let i = 0; i < 12; i++) {
      const d = difficulty ?? (Math.min(3, 1 + Math.floor((3 * (number % 10)) / 10)) as Difficulty);
      g = base && i < 3 ? similarTo(base.prompt, { seed: seed + number * 977 + i, difficulty: d }) : generate(topic, { difficulty: d, seed: seed + number * 977 + i });
      if (g && !seen.has(g.prompt)) break;
    }
    g ??= generate(topic, { seed: seed + number });
    seen.add(g.prompt);
    const q = fromPractice(g, number, type, r, s.calculator, prefix);
    if (base) q.origin = 'variant';
    return q;
  };

  for (const s of p.sections) {
    const count = Math.max(1, s.adaptive ? Math.max(s.adaptive.easy.length, s.adaptive.hard.length, s.questionIds.length) : s.questionIds.length);
    if (s.adaptive) {
      const start = number;
      s.adaptive.easy = Array.from({ length: count }, () => {
        const q = make(s, r.next() < 0.6 ? 1 : 2, `${s.id}e`);
        questions.push(q);
        return q.id;
      });
      number = start;
      s.adaptive.hard = Array.from({ length: count }, () => {
        const q = make(s, r.next() < 0.6 ? 3 : 2, `${s.id}h`);
        questions.push(q);
        return q.id;
      });
      s.questionIds = [...s.adaptive.easy];
    } else {
      s.questionIds = Array.from({ length: count }, () => {
        const q = make(s, null, s.id);
        questions.push(q);
        return q.id;
      });
    }
    // Numbering restarts per section, as printed on most tests.
    number = 0;
    const ids = s.adaptive ? [s.adaptive.easy, s.adaptive.hard] : [s.questionIds];
    for (const list of ids) list.forEach((id, i) => {
      const q = questions.find((x) => x.id === id);
      if (q) q.number = i + 1;
    });
  }
  return { id: uid('exam'), profile: p, questions, createdAt: Date.now(), seed };
}

// ---------------------------------------------------------------------------------------------------------
// Adaptive routing and grading

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '').replace(/−/g, '-').replace(/^[a-z]=/, '').replace(/[.]$/, '');
}

function checkValue(expected: string, given: string, kindHint: QuestionType | Part['type'], topic?: Topic): boolean {
  if (!given.trim()) return false;
  if (normalize(expected) === normalize(given)) return true;
  if (kindHint === 'short') return false;
  try {
    const kind = kindHint === 'numeric' ? 'number' : answerKind(expected, topic);
    const q = { id: 'x', topic: topic ?? 'arithmetic', difficulty: 1, prompt: '', answer: { display: expected, kind }, steps: [], hint: '', seed: 0 } as Question;
    return check(q, given).correct;
  } catch {
    return false;
  }
}

function correctFraction(exam: Exam, attempt: Attempt, sectionId: string): number {
  const s = exam.profile.sections.find((x) => x.id === sectionId);
  if (!s) return 0;
  const ids = resolveIds(exam, attempt, s);
  let right = 0;
  for (const id of ids) {
    const q = exam.questions.find((x) => x.id === id);
    if (q && gradeOne(q, attempt.answers[id]).earned >= q.points) right++;
  }
  return ids.length ? right / ids.length : 0;
}

export function adaptiveNext(exam: Exam, attempt: Attempt, section: Section): string[] {
  if (!section.adaptive) return section.questionIds;
  return correctFraction(exam, attempt, section.adaptive.after) >= section.adaptive.threshold ? section.adaptive.hard : section.adaptive.easy;
}

function resolveIds(exam: Exam, attempt: Attempt, s: Section): string[] {
  if (!s.adaptive) return s.questionIds;
  // The route taken is recorded in attempt.sectionOrder as "<id>:easy" / "<id>:hard".
  const taken = attempt.sectionOrder.find((e) => e.startsWith(`${s.id}:`))?.split(':')[1];
  if (taken === 'hard') return s.adaptive.hard;
  if (taken === 'easy') return s.adaptive.easy;
  return adaptiveNext(exam, attempt, s);
}

function show(a: string | string[] | Record<string, string> | undefined): string {
  if (a === undefined) return '';
  if (typeof a === 'string') return a;
  if (Array.isArray(a)) return a.join(', ');
  return Object.entries(a).map(([k, v]) => `(${k}) ${v}`).join('; ');
}

function gradeOne(q: ExamQuestion, a: Attempt['answers'][string] | undefined): { earned: number; correct: boolean | 'partial'; feedback: string; expected?: string; keyed: boolean } {
  if (q.type === 'free' && q.parts?.length) {
    const given = (a && typeof a === 'object' && !Array.isArray(a) ? a : {}) as Record<string, string>;
    let earned = 0;
    let keyed = false;
    const notes: string[] = [];
    for (const p of q.parts) {
      if (p.answer === undefined) continue;
      keyed = true;
      const ok = checkValue(p.answer, given[p.label] ?? '', p.type, q.topic);
      if (ok) earned += p.points;
      notes.push(`(${p.label}) ${ok ? 'correct' : `expected ${p.answer}`}`);
    }
    const expected = q.parts.map((p) => `(${p.label}) ${p.answer ?? '—'}`).join('; ');
    if (!keyed) return { earned: 0, correct: false, feedback: 'No answer key: not scored.', expected, keyed };
    return { earned, correct: earned >= q.points ? true : earned > 0 ? 'partial' : false, feedback: notes.join('; '), expected, keyed };
  }
  if (q.answer === undefined) return { earned: 0, correct: false, feedback: 'No answer key: not scored.', keyed: false };
  const expected = Array.isArray(q.answer) ? q.answer.join(', ') : q.answer;
  const expectedShow = q.choices && typeof q.answer === 'string' ? `${q.answer}${q.choices.find((c) => c.id === q.answer) ? ` (${q.choices.find((c) => c.id === q.answer)!.text})` : ''}` : expected;
  if (a === undefined || (typeof a === 'string' && !a.trim()) || (Array.isArray(a) && !a.length)) return { earned: 0, correct: false, feedback: 'Not answered.', expected: expectedShow, keyed: true };
  let ok = false;
  if (q.type === 'mc') ok = typeof a === 'string' && a.toUpperCase() === String(q.answer).toUpperCase();
  else if (q.type === 'multi') {
    const want = (Array.isArray(q.answer) ? q.answer : [q.answer]).map((x) => x.toUpperCase()).sort().join();
    ok = Array.isArray(a) && [...a].map((x) => x.toUpperCase()).sort().join() === want;
  } else ok = checkValue(expected, show(a), q.type, q.topic);
  return { earned: ok ? q.points : 0, correct: ok, feedback: ok ? 'Correct.' : `Expected ${expectedShow}.`, expected: expectedShow, keyed: true };
}

export function grade(exam: Exam, attempt: Attempt): Result {
  const order = attempt.sectionOrder.length ? attempt.sectionOrder : exam.profile.sections.map((s) => s.id);
  const bySection: Result['bySection'] = [];
  const perQuestion: Result['perQuestion'] = [];
  const topics = new Map<Topic, { right: number; total: number }>();
  let raw = 0;
  let possible = 0;
  let wrong = 0;
  let unkeyed = 0;
  for (const entry of order) {
    const s = exam.profile.sections.find((x) => x.id === entry.split(':')[0]);
    if (!s) continue;
    let sr = 0;
    let sp = 0;
    for (const id of resolveIds(exam, attempt, s)) {
      const q = exam.questions.find((x) => x.id === id);
      if (!q) continue;
      const g = gradeOne(q, attempt.answers[id]);
      const timeMs = attempt.timeSpent[id] ?? 0;
      perQuestion.push({ id, correct: g.correct, earned: g.earned, points: q.points, ...(g.expected !== undefined ? { expected: g.expected } : {}), feedback: g.feedback, timeMs });
      if (!g.keyed) {
        unkeyed++;
        continue;
      }
      sr += g.earned;
      sp += q.points;
      if (g.correct === false && attempt.answers[id] !== undefined) wrong++;
      if (q.topic) {
        const t = topics.get(q.topic) ?? { right: 0, total: 0 };
        t.total++;
        if (g.correct === true) t.right++;
        topics.set(q.topic, t);
      }
    }
    bySection.push({ id: s.id, title: s.title, raw: sr, possible: sp });
    raw += sr;
    possible += sp;
  }
  const penalty = (exam.profile.scoring.guessingPenalty ?? 0) * wrong;
  raw = Math.max(0, raw - penalty);
  const percent = possible ? Math.round((raw / possible) * 1000) / 10 : 0;
  const sc = exam.profile.scoring;
  let score = `${percent}%`;
  let estimate = false;
  if (sc.kind === 'points') score = `${raw} / ${possible}`;
  if (sc.kind === 'scaled' && sc.min !== undefined && sc.max !== undefined) {
    const span = sc.max - sc.min;
    const step = span >= 100 ? 10 : 1;
    score = `≈ ${Math.round((sc.min + (span * percent) / 100) / step) * step} (estimate)`;
    estimate = true;
  }
  if (sc.kind === 'band' && sc.bands?.length) {
    const b = [...sc.bands].sort((a, c) => c.minPercent - a.minPercent).find((x) => percent >= x.minPercent);
    const letter = b && /^[A-F]/.test(b.label);
    score = b ? (letter ? b.label : `${b.label} (estimate)`) : `${percent}%`;
    estimate = !letter;
  }
  if (unkeyed) estimate = true;

  // Pacing: each section's minutes spread evenly over its questions.
  const onPaceAt: string[] = [];
  for (const entry of order) {
    const s = exam.profile.sections.find((x) => x.id === entry.split(':')[0]);
    if (!s?.minutes) continue;
    const ids = resolveIds(exam, attempt, s);
    const pace = (s.minutes * 60000) / Math.max(1, ids.length);
    for (const id of ids) if ((attempt.timeSpent[id] ?? 0) <= pace * 1.25) onPaceAt.push(id);
  }
  const slowest = [...perQuestion].sort((a, b) => b.timeMs - a.timeMs).slice(0, 3).filter((p) => p.timeMs > 0).map((p) => p.id);
  return {
    raw,
    possible,
    percent,
    score,
    estimate,
    bySection,
    byTopic: [...topics].map(([topic, v]) => ({ topic, ...v })),
    perQuestion,
    pacing: { onPaceAt, slowest },
  };
}
