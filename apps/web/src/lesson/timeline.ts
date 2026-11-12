// The lesson timeline: one pure description of what is on screen at time t, shared by the DOM player
// and the canvas video exporter so a saved video matches what was shown.

export interface LessonStep {
  text: string;
  tex?: string;
}

export interface Lesson {
  title: string;
  question: string;
  questionTex?: string;
  steps: LessonStep[];
  answer: { display: string; tex?: string };
}

export type SegmentKind = 'title' | 'question' | 'step' | 'answer' | 'end';

export interface Segment {
  kind: SegmentKind;
  /** Step index for kind 'step'. */
  index: number;
  start: number;
  end: number;
  /** What narration reads for this segment. */
  speech: string;
}

export type Block =
  | { kind: 'label'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'text'; text: string; size: 'lg' | 'md' | 'sm'; tone: 'ink' | 'muted' }
  | { kind: 'math'; tex: string; size: 'lg' | 'md' }
  | { kind: 'answer'; tex?: string; display: string };

export interface Scene {
  segment: Segment;
  align: 'center' | 'left';
  blocks: Block[];
}

export interface Timeline {
  duration: number;
  scenes: Scene[];
  /** The persistent question header shown during steps and the answer. */
  header: { text: string; start: number; end: number } | null;
}

/** Layout unit sizes, in units of stage-height / 720 (i.e. pixels at 1280x720). */
export const SIZES = {
  heading: 60,
  lg: 36,
  md: 28,
  sm: 22,
  label: 17,
  mathLg: 44,
  mathMd: 34,
  answer: 52,
  header: 20,
  gap: 22,
  labelGap: 14,
  lineHeight: 1.35,
  padX: 120,
  contentTop: 130,
  contentBottom: 80,
  headerTop: 52,
  answerPadX: 40,
  answerPadY: 28,
  answerBorder: 2,
} as const;

export const FADE_IN = 0.45;
export const FADE_OUT = 0.35;
const SECONDS_PER_WORD = 0.35;
const MIN_HOLD = 2;

/** Seconds a block of reading material should stay fully visible. Math tokens count as half a word. */
export function holdFor(text?: string, math?: string): number {
  const count = (s?: string) => (s ? s.split(/\s+/).filter(Boolean).length : 0);
  return Math.max(MIN_HOLD, (count(text) + count(math) * 0.5) * SECONDS_PER_WORD);
}

export function buildTimeline(lesson: Lesson): Timeline {
  const scenes: Scene[] = [];
  let t = 0;
  const add = (kind: SegmentKind, index: number, hold: number, speech: string, align: Scene['align'], blocks: Block[]) => {
    const seg: Segment = { kind, index, start: t, end: t + FADE_IN + hold + FADE_OUT, speech };
    t = seg.end;
    scenes.push({ segment: seg, align, blocks });
  };
  const n = lesson.steps.length;
  const qPlain = lesson.questionTex ? texToPlain(lesson.questionTex) : undefined;

  add('title', 0, 2.2, lesson.title, 'center', [
    { kind: 'label', text: 'Lesson' },
    { kind: 'heading', text: lesson.title },
    { kind: 'text', text: n === 1 ? '1 step' : `${n} steps`, size: 'md', tone: 'muted' },
  ]);

  const qBlocks: Block[] = [{ kind: 'label', text: 'Question' }];
  if (lesson.question.trim()) qBlocks.push({ kind: 'text', text: lesson.question, size: 'lg', tone: 'ink' });
  if (lesson.questionTex) qBlocks.push({ kind: 'math', tex: lesson.questionTex, size: 'lg' });
  add('question', 0, holdFor(lesson.question, qPlain) + 0.5, lesson.question, 'left', qBlocks);

  lesson.steps.forEach((step, i) => {
    const blocks: Block[] = [{ kind: 'label', text: `Step ${i + 1} of ${n}` }];
    if (step.text.trim()) blocks.push({ kind: 'text', text: step.text, size: 'lg', tone: 'ink' });
    if (step.tex) blocks.push({ kind: 'math', tex: step.tex, size: 'lg' });
    add('step', i, holdFor(step.text, step.tex ? texToPlain(step.tex) : undefined), step.text || texToPlain(step.tex ?? ''), 'left', blocks);
  });

  const answerStart = t;
  add('answer', 0, 3.2, `The answer is ${lesson.answer.display}.`, 'left', [
    { kind: 'label', text: 'Answer' },
    { kind: 'answer', tex: lesson.answer.tex, display: lesson.answer.display },
  ]);
  const answerEnd = t;

  const endBlocks: Block[] = [{ kind: 'label', text: 'Summary' }, { kind: 'text', text: lesson.title, size: 'lg', tone: 'ink' }];
  if (lesson.answer.tex) endBlocks.push({ kind: 'math', tex: lesson.answer.tex, size: 'md' });
  else endBlocks.push({ kind: 'text', text: lesson.answer.display, size: 'md', tone: 'ink' });
  endBlocks.push({ kind: 'text', text: 'Made with Lemma', size: 'sm', tone: 'muted' });
  add('end', 0, 2.4, '', 'center', endBlocks);

  const firstStep = scenes.find((s) => s.segment.kind === 'step');
  const headerText = lesson.question.trim() || qPlain || '';
  const header = headerText ? { text: headerText, start: firstStep ? firstStep.segment.start : answerStart, end: answerEnd } : null;

  return { duration: t, scenes, header };
}

export function lessonDuration(lesson: Lesson): number {
  return buildTimeline(lesson).duration;
}

const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

/** Opacity and vertical offset (in layout units) of something visible on [start, end]. */
export function visualAt(start: number, end: number, t: number, reduced: boolean): { opacity: number; dy: number } {
  if (t < start || t > end) return { opacity: 0, dy: 0 };
  const fin = reduced ? 0.2 : FADE_IN;
  const fout = reduced ? 0.2 : FADE_OUT;
  const a = ease((t - start) / fin);
  const b = ease((end - t) / fout);
  // The very end of the final scene stays visible so the last frame isn't blank.
  const opacity = Math.min(a, b);
  if (reduced) return { opacity, dy: 0 };
  const dy = a < 1 ? (1 - a) * 14 : b < 1 ? -(1 - b) * 8 : 0;
  return { opacity, dy };
}

/** Visual for a scene; the end card holds at full opacity through the last frame. */
export function sceneVisual(scene: Scene, t: number, duration: number, reduced: boolean) {
  const { start, end } = scene.segment;
  const last = Math.abs(end - duration) < 1e-6;
  return visualAt(start, last ? end + 10 : end, Math.min(t, duration), reduced);
}

/** 0..1: how strongly the answer is highlighted (ramps in after the answer appears). */
export function answerHighlight(scene: Scene, t: number, reduced: boolean): number {
  const local = t - scene.segment.start;
  if (reduced) return local >= 0.6 ? 1 : 0;
  return ease((local - 0.6) / 0.7);
}

export function activeSceneIndex(tl: Timeline, t: number): number {
  for (let i = 0; i < tl.scenes.length; i++) {
    const s = tl.scenes[i]!;
    if (t >= s.segment.start && t < s.segment.end) return i;
  }
  return tl.scenes.length - 1;
}

export function formatTime(s: number): string {
  const total = Math.max(0, Math.floor(s));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// ---------- LaTeX -> plain text (word counts, canvas fallback, narration) ----------

const SYMBOLS: Record<string, string> = {
  cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠',
  approx: '≈', equiv: '≡', infty: '∞', pi: 'π', theta: 'θ', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ',
  Delta: 'Δ', epsilon: 'ε', lambda: 'λ', mu: 'μ', sigma: 'σ', Sigma: 'Σ', phi: 'φ', omega: 'ω', Omega: 'Ω',
  to: '→', rightarrow: '→', Rightarrow: '⇒', implies: '⇒', iff: '⇔', circ: '°', degree: '°', sum: 'Σ', prod: '∏',
  int: '∫', partial: '∂', nabla: '∇', ldots: '…', cdots: '⋯', dots: '…', in: '∈', cup: '∪', cap: '∩', angle: '∠',
  quad: '  ', qquad: '   ', ',': ' ', ';': ' ', ':': ' ', '!': '', ' ': ' ', '%': '%', '$': '$', '{': '{', '}': '}',
  '#': '#', '&': '&', '_': '_',
};
const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', n: 'ⁿ', '(': '⁽', ')': '⁾' };
const SUB: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋' };
const PASSTHROUGH = new Set(['text', 'mathrm', 'mathbf', 'mathit', 'textbf', 'textit', 'operatorname', 'boxed', 'mathbb', 'mathcal', 'displaystyle', 'textstyle', 'left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'color']);

export function texToPlain(tex: string): string {
  let i = 0;
  const src = tex;

  const group = (): string => {
    while (src[i] === ' ') i++;
    if (src[i] === '{') {
      i++;
      const out = seq('}');
      i++;
      return out;
    }
    if (src[i] === '\\') return command();
    const ch = src[i] ?? '';
    i++;
    return ch;
  };
  const wrap = (s: string) => (/^[\w.]+$/.test(s) || /^\(.*\)$/.test(s) ? s : `(${s})`);
  const script = (s: string, map: Record<string, string>, mark: string) =>
    [...s].every((c) => map[c] !== undefined) ? [...s].map((c) => map[c]).join('') : `${mark}${wrap(s)}`;

  const command = (): string => {
    i++; // backslash
    let name = '';
    if (/[a-zA-Z]/.test(src[i] ?? '')) {
      while (/[a-zA-Z]/.test(src[i] ?? '')) name += src[i++];
    } else {
      name = src[i] ?? '';
      i++;
    }
    if (name === '\\') return '; ';
    if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
      const a = group();
      const b = group();
      return `${wrap(a)}/${wrap(b)}`;
    }
    if (name === 'sqrt') {
      let idx = '';
      if (src[i] === '[') {
        const close = src.indexOf(']', i);
        idx = src.slice(i + 1, close);
        i = close + 1;
      }
      const body = group();
      return `${idx ? script(idx, SUP, '') : ''}√${wrap(body)}`;
    }
    if (name === 'color') {
      group();
      return '';
    }
    if (PASSTHROUGH.has(name)) {
      if (name === 'left' || name === 'right') {
        const d = src[i] === '\\' ? (i++, src[i++] ?? '') : (src[i++] ?? '');
        return d === '.' ? '' : d;
      }
      if (/^(big|Big|bigg|Bigg|displaystyle|textstyle)$/.test(name)) return '';
      return group();
    }
    const sym = SYMBOLS[name];
    if (sym !== undefined) return sym;
    if (name === 'begin' || name === 'end') {
      group();
      return ' ';
    }
    return name; // sin, cos, log, ...
  };

  const seq = (until: string): string => {
    let out = '';
    while (i < src.length && src[i] !== until) {
      const c = src[i]!;
      if (c === '\\') out += command();
      else if (c === '{') out += group();
      else if (c === '^') {
        i++;
        out += script(group(), SUP, '^');
      } else if (c === '_') {
        i++;
        out += script(group(), SUB, '_');
      } else if (c === '&') i++;
      else {
        out += c;
        i++;
      }
    }
    return out;
  };

  let out: string;
  try {
    out = seq('\u0000');
  } catch {
    out = tex;
  }
  return out
    .replace(/\s*([=<>≤≥≠≈+×÷±→⇒])\s*/g, ' $1 ')
    .replace(/(\S)\s*-\s*(\S)/g, '$1 − $2')
    .replace(/\s+/g, ' ')
    .trim();
}
