// Lesson-script timing: when each scene starts and ends, and when each thing in it is written. Pure and
// deterministic (no DOM, no measuring), so the player, the seek bar and the video exporter agree exactly.
//
// Types come from the tutor engine's contract (packages/tutor-engine/src/types.ts).
import type { LessonScript, Scene, StyleId } from '@lemma/tutor-engine';
import { texToPlain } from './timeline';

export type { LessonScript, Scene, StyleId };
export type { Ink } from '@lemma/tutor-engine';

/** How a style is drawn: handwritten on a scrolling board, or typeset scene by scene. */
export type Engine = 'board' | 'slide';

export interface LookTiming {
  engine: Engine;
  /** Multiplies every duration (quick < 1). */
  pace: number;
  /** Handwriting speed: characters per second for words and for math. */
  cps: number;
  mcps: number;
}

export const STYLE_LOOKS: Record<StyleId, { label: string; dark: boolean }> = {
  chalkboard: { label: 'Chalkboard', dark: true },
  marker: { label: 'Whiteboard', dark: false },
  visual: { label: 'Visual', dark: true },
  lecture: { label: 'Lecture', dark: false },
  socratic: { label: 'Socratic', dark: true },
  exam: { label: 'Exam prep', dark: false },
  quick: { label: 'Quick', dark: true },
  beginner: { label: 'Beginner', dark: false },
  proof: { label: 'Proof', dark: false },
  story: { label: 'Story', dark: false },
};

export const LOOK_TIMING: Record<StyleId, LookTiming> = {
  chalkboard: { engine: 'board', pace: 1, cps: 17, mcps: 7.5 },
  socratic: { engine: 'board', pace: 1, cps: 17, mcps: 7.5 },
  marker: { engine: 'board', pace: 0.9, cps: 21, mcps: 9 },
  exam: { engine: 'board', pace: 0.9, cps: 21, mcps: 9 },
  visual: { engine: 'slide', pace: 1, cps: 0, mcps: 0 },
  lecture: { engine: 'slide', pace: 1.05, cps: 0, mcps: 0 },
  quick: { engine: 'slide', pace: 0.65, cps: 0, mcps: 0 },
  beginner: { engine: 'board', pace: 1.1, cps: 16, mcps: 7 },
  proof: { engine: 'slide', pace: 1.05, cps: 0, mcps: 0 },
  story: { engine: 'board', pace: 1, cps: 19, mcps: 8 },
};

export const isStyleId = (s: unknown): s is StyleId => typeof s === 'string' && s in STYLE_LOOKS;

/** Narration pace used for timing (words per second). */
export const WORDS_PER_SECOND = 2.6;
const LEAD = 0.35;

export function wordCount(s?: string): number {
  return s ? s.split(/\s+/).filter(Boolean).length : 0;
}

/** Estimated seconds to speak a line. */
export function speechEstimate(say?: string): number {
  const n = wordCount(say);
  return n ? n / WORDS_PER_SECOND + 0.3 : 0;
}

export interface ScriptSceneTiming {
  index: number;
  scene: Scene;
  start: number;
  end: number;
  /** Narration line ('' when the scene has none). */
  say: string;
  speech: number;
  /** Absolute [start, end] of each beat (thing written/shown), keyed by name; see beatsFor. */
  beats: Record<string, [number, number]>;
  /** Pause scenes: the countdown window. */
  countdown?: [number, number];
}

export interface ScriptTimeline {
  style: StyleId;
  timing: LookTiming;
  duration: number;
  scenes: ScriptSceneTiming[];
}

type Beat = [key: string, seconds: number, fixed?: boolean];

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** The beats of one scene, in order, with their unstretched durations. */
export function beatsFor(scene: Scene, lt: LookTiming): Beat[] {
  const p = lt.pace;
  const board = lt.engine === 'board';
  const txt = (s?: string): number => (!s ? 0 : board ? clamp(s.length / lt.cps, 0.5, 5.5) * p : 0.55 * p);
  const tex = (s?: string): number => (!s ? 0 : board ? clamp(texToPlain(s).length / lt.mcps, 0.6, 4.5) * p : 0.6 * p);
  const out: Beat[] = [];
  const add = (k: string, d: number, fixed = false) => d > 0 && out.push([k, d, fixed]);
  switch (scene.kind) {
    case 'title':
      add('title', board ? txt(scene.title) : 0.8 * p);
      add('rule', 0.5 * p);
      add('subtitle', txt(scene.subtitle));
      break;
    case 'concept':
      add('heading', txt(scene.heading));
      add('body', board ? txt(scene.body) : 0.7 * p);
      add('tex', tex(scene.tex));
      break;
    case 'rule':
      add('heading', txt(scene.heading));
      add('tex', tex(scene.tex));
      add('box', 0.7 * p);
      add('note', txt(scene.note));
      break;
    case 'problem':
      add('label', board ? 0.5 * p : 0.35 * p);
      add('text', txt(scene.text));
      add('tex', tex(scene.tex));
      break;
    case 'step':
      add('text', txt(scene.text));
      add('tex', tex(scene.tex));
      add('why', txt(scene.why));
      break;
    case 'pause':
      add('card', 0.5 * p);
      add('prompt', txt(scene.prompt));
      break;
    case 'mistake':
      add('wrong', txt(scene.wrong));
      add('wrongTex', tex(scene.wrongTex));
      add('cross', 0.5 * p);
      add('right', txt(scene.right));
      add('rightTex', tex(scene.rightTex));
      add('check', 0.4 * p);
      break;
    case 'graph':
      add('axes', 0.9 * p);
      scene.exprs.forEach((_, i) => add(`curve${i}`, (board ? 2 : 1.7) * p));
      (scene.mark ?? []).forEach((_, i) => add(`mark${i}`, 0.5 * p));
      add('caption', txt(scene.caption));
      break;
    case 'answer':
      add('answer', scene.tex ? tex(scene.tex) : txt(scene.display));
      add('box', 0.7 * p);
      break;
    case 'summary':
      add('heading', board ? 0.6 * p : 0.45 * p);
      scene.points.forEach((pt, i) => add(`p${i}`, board ? txt(pt) : 0.45 * p));
      break;
    case 'practice':
      add('label', 0.4 * p);
      add('text', txt(scene.text));
      add('tex', tex(scene.tex));
      add('think', 2.4 * p, true);
      add('answer', txt(scene.answer) || 0.5);
      break;
  }
  return out;
}

export function sceneSay(scene: Scene): string {
  return (scene.say ?? '').trim();
}

export function buildScriptTimeline(script: LessonScript, style: StyleId = script.style): ScriptTimeline {
  const st: StyleId = isStyleId(style) ? style : 'chalkboard';
  const lt = LOOK_TIMING[st];
  const tail = (lt.engine === 'board' ? 1.0 : 1.1) * lt.pace;
  const scenes: ScriptSceneTiming[] = [];
  let t = 0;
  script.scenes.forEach((scene, index) => {
    const say = sceneSay(scene);
    const speech = speechEstimate(say);
    const list = beatsFor(scene, lt);
    const stretchable = list.filter((b) => !b[2]).reduce((a, b) => a + b[1], 0);
    const fixed = list.filter((b) => b[2]).reduce((a, b) => a + b[1], 0);
    // A tutor writes while talking: when the line is longer than the writing, write a little slower (up to
    // 1.6x) and then hold until the line is finished.
    const f = lt.engine === 'board' && stretchable > 0 && speech > stretchable + fixed ? Math.min(1.6, (speech - fixed) / stretchable) : 1;
    const beats: Record<string, [number, number]> = {};
    let c = t + LEAD;
    for (const [k, d, isFixed] of list) {
      const dd = isFixed ? d : d * f;
      beats[k] = [c, c + dd];
      c += dd;
    }
    const body = Math.max(c - (t + LEAD), speech);
    let end = t + LEAD + body + tail;
    let countdown: [number, number] | undefined;
    if (scene.kind === 'pause') {
      const secs = clamp(Number(scene.seconds) || 5, 1, 120);
      countdown = [t + LEAD + body + 0.2, t + LEAD + body + 0.2 + secs];
      end = countdown[1] + 0.6;
    }
    if (index === script.scenes.length - 1) end += 1.2;
    scenes.push({ index, scene, start: t, end, say, speech, beats, ...(countdown ? { countdown } : {}) });
    t = end;
  });
  return { style: st, timing: lt, duration: Math.max(t, 0.1), scenes };
}

export function scriptDuration(script: LessonScript, style?: StyleId): number {
  return buildScriptTimeline(script, style).duration;
}

export function sceneIndexAt(tl: ScriptTimeline, t: number): number {
  for (let i = 0; i < tl.scenes.length; i++) {
    const s = tl.scenes[i]!;
    if (t >= s.start && t < s.end) return i;
  }
  return Math.max(0, tl.scenes.length - 1);
}

function vttTime(s: number): string {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(sec)}.${pad(ms % 1000, 3)}`;
}

/** WebVTT captions: one cue per scene that has narration, spanning the scene. */
/** Longest caption shown at once: about two lines at caption size. */
export const CAPTION_CHARS = 96;

/**
 * Splits a narration line into caption-sized chunks at sentence, then clause, then word boundaries, each with
 * its time window inside the scene (proportional to its length, as speech is). Chunks are paced over
 * [start, spokenEnd], when the voice is talking; the last one stays up until `end`.
 */
export function captionChunks(say: string, start: number, end: number, spokenEnd = end): { text: string; start: number; end: number }[] {
  const text = say.replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const pieces: string[] = [];
  const pushWords = (s: string) => {
    let cur = '';
    for (const w of s.split(' ')) {
      if (cur && (cur + ' ' + w).length > CAPTION_CHARS) {
        pieces.push(cur);
        cur = w;
      } else cur = cur ? `${cur} ${w}` : w;
    }
    if (cur) pieces.push(cur);
  };
  // Sentences, then clauses within long sentences, then words within long clauses; neighbours merge when they fit.
  const units = text.match(/[^.!?]+[.!?]+["”’)]?\s*|[^.!?]+$/g) ?? [text];
  for (const sentence of units.map((u) => u.trim()).filter(Boolean)) {
    const parts = sentence.length <= CAPTION_CHARS ? [sentence] : sentence.split(/(?<=[,;:—])\s+/);
    for (const p of parts) {
      if (p.length > CAPTION_CHARS) pushWords(p);
      else if (pieces.length && (pieces[pieces.length - 1]! + ' ' + p).length <= CAPTION_CHARS) pieces[pieces.length - 1] += ` ${p}`;
      else pieces.push(p);
    }
  }
  const total = pieces.reduce((n, p) => n + p.length, 0) || 1;
  const talk = Math.min(end, Math.max(start, spokenEnd)) - start;
  let at = start;
  return pieces.map((p, i) => {
    const span = (talk * p.length) / total;
    const chunk = { text: p, start: at, end: i === pieces.length - 1 ? end : at + span };
    at += span;
    return chunk;
  });
}

/** The caption chunk showing at time `t` within a scene. */
export function captionAt(say: string, start: number, end: number, t: number, spokenEnd = end): string {
  const chunks = captionChunks(say, start, end, spokenEnd);
  return (chunks.find((c) => t < c.end) ?? chunks[chunks.length - 1])?.text ?? '';
}

/**
 * When a scene's narration should be finished: the line starts as the scene starts and runs for its estimated
 * length. Scenes are often longer (writing, graphs, a pause countdown), and captions spread over the whole scene
 * would trail the voice by seconds.
 */
export function spokenEnd(st: Pick<ScriptSceneTiming, 'start' | 'end' | 'speech'>): number {
  return Math.min(st.end, st.start + LEAD + st.speech);
}

/** The caption showing at time `t` in a timed scene. */
export function sceneCaptionAt(st: ScriptSceneTiming, t: number): string {
  return st.say ? captionAt(st.say, st.start, st.end, t, spokenEnd(st)) : '';
}

export function buildVtt(tl: ScriptTimeline): string {
  const cues = tl.scenes
    .filter((s) => s.say)
    .flatMap((s) => captionChunks(s.say, s.start, s.end, spokenEnd(s)))
    .map((c, i) => `${i + 1}\n${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text.replace(/-->/g, '→')}`);
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}
