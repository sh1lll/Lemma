/**
 * Text plumbing for transcripts: sentence splitting that survives Whisper output without punctuation,
 * filler removal and tokenisation. Everything here is linear in the input size.
 */

export interface Segment {
  text: string;
  start?: number;
  end?: number;
}

export interface Sentence {
  /** Index in reading order. */
  i: number;
  /** Original wording (whitespace collapsed). */
  raw: string;
  /** Start time in seconds of the segment the sentence begins in, when known. */
  at?: number;
}

/** Above this many words a "sentence" is almost certainly unpunctuated speech and is cut further. */
const MAX_WORDS = 32;
/** Punctuated transcripts get more room: long spoken sentences are real sentences there. */
const MAX_WORDS_PUNCTUATED = 60;
const MIN_CHUNK = 8;
/** Words that commonly open a new thought in speech; good places to cut an unpunctuated run. */
const CUT_BEFORE = new Set(['so', 'now', 'okay', 'ok', 'alright', 'next', 'remember', 'notice', 'then', 'but', 'because', 'which']);
const CUT_BEFORE_PAIRS = new Set(['for example', 'for instance', "let's", 'lets', 'moving on', 'in summary', 'the key', 'part two', 'part three', 'and then', 'and now']);

/** Splits segments into sentences, keeping the start time of the segment each sentence begins in. */
export function toSentences(input: Segment[] | string): Sentence[] {
  const segs: Segment[] = typeof input === 'string' ? [{ text: input }] : input;
  // Concatenate once, remembering where each segment starts, so sentences may span segment seams
  // (Whisper windows routinely cut mid-sentence).
  let full = '';
  const offsets: { pos: number; start?: number }[] = [];
  for (const s of segs) {
    const t = (s.text ?? '').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    if (full) full += ' ';
    offsets.push({ pos: full.length, start: s.start });
    full += t;
  }
  const out: Sentence[] = [];
  if (!full) return out;

  const marks = full.match(/[.!?]/g)?.length ?? 0;
  const approxWords = full.length / 5.5;
  const maxWords = marks >= approxWords / 40 ? MAX_WORDS_PUNCTUATED : MAX_WORDS;
  let seg = 0;
  const timeAt = (pos: number): number | undefined => {
    while (seg + 1 < offsets.length && offsets[seg + 1]!.pos <= pos) seg++;
    return offsets[seg]?.start;
  };

  const re = /[^.!?;]+(?:[.!?;]+|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(full))) {
    const pos = m.index + (m[0].length - m[0].trimStart().length);
    const sentence = m[0].trim();
    if (!sentence) continue;
    for (const piece of cutLong(sentence, pos, maxWords)) {
      const raw = piece.text.trim();
      if (!/[a-z0-9]/i.test(raw)) continue;
      out.push({ i: out.length, raw, at: timeAt(piece.pos) });
    }
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

/** Breaks an over-long unpunctuated run at discourse markers, then at a hard length limit. */
function cutLong(text: string, base: number, maxWords: number): { text: string; pos: number }[] {
  const words: { w: string; pos: number }[] = [];
  const wre = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = wre.exec(text))) words.push({ w: m[0], pos: m.index });
  if (words.length <= maxWords) return [{ text, pos: base }];

  const out: { text: string; pos: number }[] = [];
  let from = 0;
  const emit = (to: number) => {
    const a = words[from]!.pos;
    const b = to < words.length ? words[to]!.pos : text.length;
    out.push({ text: text.slice(a, b), pos: base + a });
    from = to;
  };
  for (let k = 1; k < words.length; k++) {
    const len = k - from;
    const w = bare(words[k]!.w);
    const pair = `${w} ${bare(words[k + 1]?.w ?? '')}`;
    const cue = CUT_BEFORE.has(w) || CUT_BEFORE_PAIRS.has(pair) || /,$/.test(words[k - 1]!.w);
    if ((cue && len >= MIN_CHUNK && words.length - k >= 4) || len >= maxWords - 4) emit(k);
  }
  emit(words.length);
  return out;
}

const bare = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, '');

const FILLERS: [RegExp, string][] = [
  [/\b(?:u+m+|u+h+|e+r+m+|hmm+|mm+)\b[,.]?\s*/gi, ''],
  [/\b(?:you know|i mean)\b,?\s*/gi, ''],
  [/\bso,? like,?\s+/gi, 'so '],
  [/,\s*like,\s*/gi, ', '],
  // "Like, the slope…" is filler; "like terms" is algebra.
  [/^like,\s*/i, ''],
  [/\b(?:kind of|sort of)\s+/gi, ''],
  [/\b(?:basically|literally|actually)\b,?\s*/gi, ''],
  [/,?\s*(?:right|okay|ok)\?\s*$/i, '.'],
  // Stutters ("the the"). Numbers and single letters repeat for real: "the data 2 2 3", "x x squared".
  [/\b([a-z]{2,})(?:\s+\1\b)+/gi, '$1'],
];
/** Openers with no content. "Right" and "well" only count with a pause after them: "right triangles", "well-known". */
const LEADING = /^(?:(?:(?:so|okay|ok|alright|all right|and|now|yeah|anyway|oh)\b(?!-)|(?:right|well)(?=\s*[,.!?]))[\s,.!?]*)+/i;

/** Removes spoken filler ("um", "you know", "so, like") and stutters, and tidies capitalisation. */
export function clean(s: string): string {
  let t = s.replace(/\s+/g, ' ').trim();
  for (const [re, to] of FILLERS) t = t.replace(re, to);
  t = t.replace(LEADING, '').replace(/\s+([,.!?;])/g, '$1').replace(/[,;]+([.!?])/g, '$1').replace(/^[,;\s]+/, '').replace(/\s+/g, ' ').trim();
  if (!t) return t;
  t = t[0]!.toUpperCase() + t.slice(1);
  t = t.replace(/[,;:\s]+$/, '');
  if (!/[.!?]$/.test(t)) t += '.';
  return t;
}

export const STOPWORDS = new Set(
  (
    'a an the and or but if then so of to in on at by for with from as is are was were be been being it its this that these those ' +
    'i you he she we they me him her us them my your our their what which who whom whose when where why how all any both each few more most other ' +
    'some such no nor not only own same than too very can will just do does did doing have has had having would should could might must shall may ' +
    "here there up down out over under again further once about into through during before after above below off between also get got go going gonna " +
    "let's lets let okay ok right yeah um uh like know see look thing things way want need really kind sort well actually basically say says said " +
    "now today one two three four five six seven eight nine ten first second third next mean means call called use used make makes made just " +
    "lot little bit pretty because whatever something anything everything every guys everyone class time gonna wanna gotta i'm you're we're it's that's " +
    "don't doesn't isn't aren't can't won't what's there's here's let us maybe probably remember important idea key notice equals equal plus minus times squared"
  ).split(/\s+/),
);

/** Lower-case content words (stop words and numbers removed), lightly stemmed so "derivatives" counts as "derivative". */
export function contentWords(s: string): string[] {
  const out: string[] = [];
  const re = /[a-z][a-z'-]*/g;
  const lower = s.toLowerCase();
  let m: RegExpExecArray | null;
  while ((m = re.exec(lower))) {
    const w = m[0].replace(/'s$/, '');
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    out.push(stem(w));
  }
  return out;
}

/** Very small plural folding; enough to merge "derivatives"/"derivative", "angles"/"angle". */
export function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith('sses')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) return w.slice(0, -1);
  return w;
}

export function wordCount(segs: Segment[] | string): number {
  const all = typeof segs === 'string' ? segs : segs.map((s) => s.text ?? '').join(' ');
  const m = all.match(/[A-Za-z0-9']+/g);
  return m ? m.length : 0;
}
