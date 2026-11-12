/**
 * The lesson script: what a tutor says and writes, scene by scene. Produced by the tutor engine, played and
 * recorded by the lesson renderer (apps/web/src/lesson). This file is the contract between the two.
 */

/** Teaching styles. Each changes both the script (pacing, wording, structure) and the look. */
export type StyleId = 'chalkboard' | 'marker' | 'visual' | 'lecture' | 'socratic' | 'exam' | 'quick' | 'beginner' | 'proof' | 'story';

export interface StyleInfo {
  id: StyleId;
  label: string;
  /** One line for the picker, e.g. "Patient and conversational, written out on a dark board". */
  blurb: string;
}

/** Ink colours a scene can ask for; the renderer maps them to each style's palette. */
export type Ink = 'main' | 'accent' | 'second' | 'third' | 'muted' | 'warn' | 'good';

/** Every scene may carry `say`: the narration line (spoken in the player, shown as a caption in exports). */
interface Base {
  say?: string;
}

export type Scene = Base &
  (
    | { kind: 'title'; title: string; subtitle?: string }
    /** A plain-language idea, optionally with a formula. */
    | { kind: 'concept'; heading: string; body: string; tex?: string }
    /** The rule/formula to remember, written large. */
    | { kind: 'rule'; heading: string; tex: string; note?: string }
    /** A problem statement (a new worked example starts here). */
    | { kind: 'problem'; label?: string; text: string; tex?: string }
    /** One move in the working. `ink` colours the written line; `why` is a short margin note. */
    | { kind: 'step'; text: string; tex?: string; ink?: Ink; why?: string }
    /** "Pause and try it": the renderer holds for `seconds` with a visible countdown. */
    | { kind: 'pause'; prompt: string; seconds: number }
    /** A common mistake next to the correct version. */
    | { kind: 'mistake'; wrong: string; wrongTex?: string; right: string; rightTex?: string }
    /** A plot that builds the picture (graph-engine expressions, e.g. "x^2", "sin(x)"). */
    | { kind: 'graph'; exprs: string[]; caption?: string; xRange?: [number, number]; yRange?: [number, number]; mark?: { x: number; y: number; label?: string }[] }
    | { kind: 'answer'; display: string; tex?: string }
    | { kind: 'summary'; points: string[] }
    /** A question for the viewer to try after the video, with its answer revealed at the end. */
    | { kind: 'practice'; text: string; tex?: string; answer: string }
  );

export interface LessonScript {
  title: string;
  style: StyleId;
  /** What was asked ("solve 2x + 3 = 11") or the lecture topic. */
  source: string;
  kind: 'explain' | 'lecture';
  scenes: Scene[];
}
