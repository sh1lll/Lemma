import { TOPICS, worked, type Topic } from '@lemma/practice-engine';
import { buildExplain, buildLecture, ctxFor, examplesFor, hashSeed, STYLE_IDS, STYLES, subFor } from './build';
import { fromWorked } from './items';
import { sentenceCase, speak } from './speak';
import { NOTES, resolve } from './topics';
import type { LessonScript, Scene, StyleId } from './types';

export * from './types';
export { STYLES };
export { NOTES, type TopicNote, type Subtopic } from './topics';
export { EXTRAS } from './extras';
export { speak } from './speak';
export { checkFor, verifyCheck, type CheckLine, type CheckPair } from './items';

/** Final pass: any written math left in a narration line is read out in words. */
function spoken(scenes: Scene[]): Scene[] {
  const norm = (t: string | undefined) => (t ?? '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  scenes.forEach((s, i) => {
    if (!s.say) return;
    s.say = sentenceCase(speak(s.say));
    // Never say the same sentence twice in a row (a last step "So x = …" followed by the answer "So x = …").
    const prev = scenes[i - 1];
    if (prev?.say && norm(prev.say) === norm(s.say)) s.say = s.kind === 'answer' ? 'And that is the answer.' : 'Same again, written out.';
  });
  return scenes;
}

const isStyle = (s: string): s is StyleId => (STYLE_IDS as string[]).includes(s);

/** A short explainer video script for the user's own question, or null when it can't be solved with confidence. */
export function explain(query: string, style: StyleId, opts: { seed?: number } = {}): LessonScript | null {
  if (!isStyle(style)) return null;
  const w = worked(query);
  if (!w) return null;
  const item = fromWorked(w, query);
  const seed = (opts.seed ?? hashSeed(`${query}|${style}`)) >>> 0;
  const ctx = ctxFor(item.topic, subFor(item), seed);
  const scenes = spoken(buildExplain(style, item, ctx, query));
  return { title: w.title, style, source: w.question, kind: 'explain', scenes };
}

/** A longer topic lecture. `topic` is a topic id or a phrase ("the chain rule", "percent"). */
export function lecture(topic: Topic | string, style: StyleId, opts: { seed?: number; examples?: number } = {}): LessonScript | null {
  if (!isStyle(style)) return null;
  const r = resolve(String(topic));
  if (!r) return null;
  const seed = (opts.seed ?? hashSeed(`${String(topic)}|${style}`)) >>> 0;
  const defaults: Record<StyleId, number> = { chalkboard: 2, marker: 3, visual: 2, lecture: 2, socratic: 2, exam: 2, quick: 1, beginner: 2, proof: 2, story: 2 };
  const count = Math.max(1, Math.min(5, Math.round(opts.examples ?? defaults[style])));
  const examples = examplesFor(r.topic, r.sub, count, seed);
  const ctx = ctxFor(r.topic, r.sub, seed);
  const name = r.sub?.name ?? NOTES[r.topic].name;
  const scenes = spoken(buildLecture(style, examples, ctx, name));
  return { title: name, style, source: r.sub ? `${NOTES[r.topic].name}: ${r.sub.name}` : NOTES[r.topic].name, kind: 'lecture', scenes };
}

/** Maps a phrase ("chain rule", "solving equations", "pythagorean") to a practice topic. */
export function topicFor(phrase: string): Topic | null {
  return resolve(phrase)?.topic ?? null;
}

const words = (s: string | undefined) => (s ? s.split(/\s+/).filter(Boolean).length : 0);

/** Rough running time: narration at about 150 words a minute, plus time to write and to hold. */
export function estimateSeconds(script: LessonScript): number {
  let t = 0;
  for (const s of script.scenes) t += sceneSeconds(s);
  return Math.round(t);
}

function sceneSeconds(s: Scene): number {
  const talk = (words(s.say) / 150) * 60;
  const texLen = 'tex' in s && typeof s.tex === 'string' ? s.tex.length : 0;
  switch (s.kind) {
    case 'title':
      return Math.max(talk, 1.5) + 1;
    case 'pause':
      return talk + s.seconds;
    case 'step':
      return Math.max(talk, 1.5) + 0.5 + Math.min(3, texLen * 0.02);
    case 'graph':
      return Math.max(talk, 3) + 1.5;
    case 'mistake':
      return Math.max(talk, 4) + 1;
    case 'summary':
      return Math.max(talk, s.points.length * 1.5) + 1;
    case 'practice':
      return Math.max(talk, 3) + 3;
    case 'rule':
      return Math.max(talk, 2.5) + 1 + Math.min(2, s.tex.length * 0.01);
    default:
      return Math.max(talk, 2) + 0.75;
  }
}

/** All topic ids, for pickers. */
export const LECTURE_TOPICS: { id: Topic; label: string }[] = TOPICS.map((t) => ({ id: t.id, label: NOTES[t.id].name }));
