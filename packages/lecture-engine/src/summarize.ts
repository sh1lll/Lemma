/**
 * Deterministic extractive summariser for math lectures. Linear time: term frequencies against the
 * document centroid instead of all-pairs TextRank, so a three-hour transcript stays well under a second.
 */
import { findFormulas, type Formula } from './formulas';
import { clean, contentWords, stem, toSentences, wordCount, type Segment, type Sentence } from './text';

export type { Formula };
export type { Segment };

export interface Definition {
  term: string;
  meaning: string;
}

export interface OutlineItem {
  /** Seconds from the start of the recording, when the transcript has timestamps. */
  at?: number;
  heading: string;
}

export interface LectureSummary {
  title: string;
  keyPoints: string[];
  formulas: Formula[];
  definitions: Definition[];
  outline: OutlineItem[];
  examples: string[];
  wordCount: number;
}

const MAX_FORMULAS = 40;
const MAX_DEFINITIONS = 30;
const MAX_EXAMPLES = 12;
const MAX_OUTLINE = 20;

export function summarize(transcript: Segment[] | string): LectureSummary {
  const sentences = toSentences(transcript);
  const words = wordCount(transcript);
  if (!sentences.length) {
    return { title: 'Untitled lecture', keyPoints: [], formulas: [], definitions: [], outline: [], examples: [], wordCount: words };
  }

  const formulas: Formula[] = [];
  const formulaSentences = new Set<number>();
  const seenExpr = new Set<string>();
  for (const s of sentences) {
    if (formulas.length >= MAX_FORMULAS) break;
    if (!/\b(?:equals?|is|gives)\b|=/i.test(s.raw)) continue;
    for (const f of findFormulas(s.raw)) {
      formulaSentences.add(s.i);
      const key = f.expression.replace(/\s+/g, '');
      if (seenExpr.has(key)) continue;
      seenExpr.add(key);
      formulas.push(f);
    }
  }

  const definitions = findDefinitions(sentences);
  const defSentences = new Set(definitions.map((d) => d.i));
  const outline = findOutline(sentences);
  const examples = findExamples(sentences);
  const tf = termFrequencies(sentences);
  const title = makeTitle(tf, definitions, outline);
  const keyPoints = pickKeyPoints(sentences, tf, formulaSentences, defSentences);

  return {
    title,
    keyPoints,
    formulas,
    definitions: definitions.map(({ term, meaning }) => ({ term, meaning })),
    outline: outline.map(({ at, heading }) => (at === undefined ? { heading } : { at, heading })),
    examples,
    wordCount: words,
  };
}

// ── Definitions ─────────────────────────────────────────────────────────────

/** Openers before a defined term. "Right", "like" and "well" only with a pause: "right triangles" and "like terms" are terms. */
const LEAD = /^(?:(?:(?:so|okay|ok|alright|and|now|remember|basically|first|first of all|recall|um|uh|then|also|formally)\b(?!-)|(?:right|well|like)(?=\s*,))[\s,]*)+/i;
const PRONOUNS = /^(?:it|this|that|these|those|which|what|there|he|she|they|we|you|i|one|something|anything|everything)$/i;

function termOf(left: string): string | null {
  let t = left.replace(/^.*[,;:]\s*/, '').trim();
  t = t.replace(LEAD, '').replace(/^(?:the|a|an)\s+/i, '').trim();
  const words = t.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 5) return null;
  if (PRONOUNS.test(words[0]!) || words.every((w) => PRONOUNS.test(w))) return null;
  if (/\b(?:is|are|was|were|we|you|i|if|when|that)\b/i.test(t)) return null;
  if (!/[a-z]/i.test(t)) return null;
  return t.toLowerCase();
}

function meaningOf(s: string): string | null {
  let m = s.replace(/^[,:\s]+/, '').replace(/[.!?;]+$/, '').trim();
  // Stop at a clear change of thought.
  m = m.replace(/\s*,?\s*\b(?:okay|so now|now let's|and so|anyway)\b.*$/i, '').trim();
  const words = m.split(/\s+/);
  if (words.length < 2) return null;
  if (words.length > 35) m = `${words.slice(0, 35).join(' ')}…`;
  return m;
}

interface FoundDefinition extends Definition {
  i: number;
}

function findDefinitions(sentences: Sentence[]): FoundDefinition[] {
  const out: FoundDefinition[] = [];
  const seen = new Set<string>();
  const add = (i: number, term: string | null, meaning: string | null) => {
    if (!term || !meaning || out.length >= MAX_DEFINITIONS) return;
    const key = stem(term.replace(/^(?:the|a|an)\s+/, ''));
    const head = stem(key.split(/\s+(?:of|for|in)\s+/)[0]!);
    if (seen.has(key) || seen.has(head)) return;
    seen.add(head);
    if (meaning.toLowerCase().startsWith(term.toLowerCase())) return;
    seen.add(key);
    out.push({ i, term, meaning });
  };

  for (const s of sentences) {
    const raw = s.raw.replace(/\b(?:um+|uh+)\b,?\s*/gi, '').replace(/\s+/g, ' ');
    let m: RegExpExecArray | null;
    if ((m = /^(.*?)\b(?:is|are) defined as\b(.+)$/i.exec(raw))) {
      add(s.i, termOf(m[1]!), meaningOf(m[2]!));
      continue;
    }
    if ((m = /^(.*?)\s*,?\s*(?:which|that) (?:we|people|mathematicians) (?:call|name)\s+(?:the |a |an )?([a-z][a-z' -]{1,40}?)\s*[.,;!?]?$/i.exec(raw))) {
      add(s.i, termOf(m[2]!), meaningOf(m[1]!.replace(/^.*\b(?:is|are|have|has|get|got)\s+/i, '')));
      continue;
    }
    if ((m = /\bwe call (?:this|that|it|these|those)(?: \w+)? (?:the |a |an )?([a-z][a-z' -]{1,40}?)\s*[.,;!?]?$/i.exec(raw))) {
      const prev = sentences[s.i - 1];
      const before = raw.slice(0, m.index).replace(/[,\s]*(?:and|so)?\s*$/i, '');
      const meaning = before.split(/\s+/).length >= 4 ? before : prev ? clean(prev.raw) : null;
      add(s.i, termOf(m[1]!), meaning ? meaningOf(meaning) : null);
      continue;
    }
    if ((m = /\bwe call (?:the |a |an )?([a-z][a-z' -]{1,30}?) (?:a |an |the )([a-z][a-z' -]{1,40}?)\s*[.,;!?]?$/i.exec(raw))) {
      add(s.i, termOf(m[2]!), meaningOf(`a name for the ${m[1]}`));
      continue;
    }
    if ((m = /^(.*?)\s+(?:is|are) called (?:the |a |an )?([a-z][a-z' -]{1,40}?)\s*[.,;!?]?$/i.exec(raw))) {
      const left = m[1]!.replace(LEAD, '').replace(/^(?:this|that|it)\s*$/i, '');
      if (left.split(/\s+/).length >= 2) add(s.i, termOf(m[2]!), meaningOf(left));
      continue;
    }
    if ((m = /^(.*?)\b(?:means|refers to|is when|are when|is the name for|stands for)\b(.+)$/i.exec(raw))) {
      add(s.i, termOf(m[1]!), meaningOf(m[2]!));
    }
  }
  return out;
}

// ── Outline ─────────────────────────────────────────────────────────────────

const SHIFT =
  /^(?:(?:so|okay|ok|alright|all right|and|um|uh|well|right)\b[\s,]*)*(?:next|now let's|now let us|now we're going to|now we will|now we'll|moving on|let's move on|let's turn|let's talk about|let's look at|let's start|let's begin|today we're going to|today we'll|in this lecture|part (?:one|two|three|four|five|\d+)|the next (?:topic|thing|idea|part)|our next|finally|to start|first up|the last thing)\b/i;
const TOPIC_VERB = /\b(?:talk about|look at|move on to|turn to|cover|discuss|learn about|introduce|start with|begin with|get to|go over|is|are|on to|about)\s+(.+)$/i;

function findOutline(sentences: Sentence[]): (OutlineItem & { i: number })[] {
  const out: (OutlineItem & { i: number })[] = [];
  const seen = new Set<string>();
  for (const s of sentences) {
    if (out.length >= MAX_OUTLINE) break;
    if (!SHIFT.test(s.raw)) continue;
    const heading = headingOf(s.raw);
    if (!heading) continue;
    const key = contentWords(heading).join(' ');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ i: s.i, at: s.at, heading });
  }
  return out;
}

function headingOf(raw: string): string | null {
  let t = raw.replace(/[.!?;]+$/, '').replace(/\b(?:um+|uh+)\b,?\s*/gi, '');
  const part = /\bpart (one|two|three|four|five|\d+)\b[\s,:-]*(.*)$/i.exec(t);
  const m = TOPIC_VERB.exec(t);
  if (m) t = m[1]!;
  else if (part) t = part[2] || `Part ${part[1]}`;
  else t = t.replace(SHIFT, '');
  t = t
    .replace(/^(?:the idea of|the concept of|something called|what we call|what's called|a little bit about|a bit about|some)\s+/i, '')
    .split(/,|\bwhich\b|\bwhere\b|\bbecause\b|\bso that\b|\band then\b|\bso\b|\bokay\b/i)[0]!
    .trim();
  // Without punctuation the heading runs straight into the next clause: stop where one begins.
  if (!/[,.!?;:]/.test(raw)) t = t.split(/\s+\b(?:this|that|it|we|you|i|doing|let's|there|here|is|are|was|were|briefly|quickly|then|when|if|since|as|now)\b/i)[0]!;
  const words = t.split(/\s+/).filter(Boolean);
  if (!words.length || !contentWords(t).length) return null;
  if (words.length > 8) t = words.slice(0, 8).join(' ');
  t = t.replace(/\s+and (?:a few|some|a couple of|other) .*$/i, '').replace(/\s+(?:and|or|the|a|an|of|to|with|for|in|on|is|are|that|briefly|quickly)$/i, '');
  return t[0]!.toUpperCase() + t.slice(1);
}

// ── Examples ────────────────────────────────────────────────────────────────

const EXAMPLE_CUE = /\b(?:for example|for instance|let's try|let's do an example|let's do one|let's work (?:through|out)|here's an example|as an example|example:|say we have|suppose we have|suppose|let's say|let's take|try this one|let's plug in)\b/i;
const NUMBER_G = /\d+(?:\.\d+)?|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|half|squared|cubed)\b/gi;
const numbersIn = (s: string) => s.match(NUMBER_G)?.length ?? 0;
const HAS_NUMBER = /\d|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|half)\b/i;

function findExamples(sentences: Sentence[]): string[] {
  const out: string[] = [];
  let skipUntil = -1;
  for (const s of sentences) {
    if (out.length >= MAX_EXAMPLES) break;
    if (s.i <= skipUntil || !EXAMPLE_CUE.test(s.raw)) continue;
    // Include the worked steps that follow, while they carry numbers.
    const parts = [clean(s.raw)];
    let words = s.raw.split(/\s+/).length;
    let j = s.i + 1;
    while (j < sentences.length && j <= s.i + 4 && words < 70) {
      const next = sentences[j]!;
      // "Let's try one more." introduces the next sentence, whatever it is.
      const intro = j === s.i + 1 && words < 7;
      const question = /\?\s*$/.test(next.raw) && next.raw.split(/\s+/).length < 12;
      if (!intro && (!(HAS_NUMBER.test(next.raw) || question) || SHIFT.test(next.raw) || EXAMPLE_CUE.test(next.raw))) break;
      parts.push(clean(next.raw));
      words += next.raw.split(/\s+/).length;
      j++;
    }
    const text = parts.filter(Boolean).join(' ');
    if (numbersIn(text) < 2) continue;
    skipUntil = j - 1;
    out.push(text);
  }
  return out;
}

// ── Key points ──────────────────────────────────────────────────────────────

const CUES: [RegExp, number][] = [
  [/\b(?:the key (?:idea|point|thing|takeaway)|key idea|main idea|the big idea|the takeaway|the main point|the most important)\b/i, 3],
  [/\b(?:in summary|to summarize|to sum up|in conclusion|so overall|the bottom line)\b/i, 3],
  [/\b(?:remember|important|crucial|essential|never forget|don't forget|make sure|always|the rule is|the trick is|notice that|keep in mind)\b/i, 2],
  [/\b(?:theorem|rule|formula|definition|law|principle|property)\b/i, 1],
];
const LOW_VALUE = /^(?:(?:so|okay|ok|alright|um|uh|and)\b[\s,]*)*(?:any questions|does that make sense|can everyone see|let me|i'll|i will|hold on|hang on|wait|good morning|hi everyone|hello|see you|that's it for today|thanks|thank you|alright everyone)\b/i;

interface Tf {
  /** term → weight, normalised so the strongest term is 1. */
  weight: Map<string, number>;
  /** term → raw count */
  count: Map<string, number>;
  /** bigram → count */
  bigrams: Map<string, number>;
  /** original surface form of each stem */
  surface: Map<string, string>;
  /** stem → capitalised form for words written as proper nouns mid-sentence ("Pythagorean") */
  proper: Map<string, string>;
  /** stem → plural surface form, when the lecture used one */
  plural: Map<string, string>;
  words: string[][];
}

function termFrequencies(sentences: Sentence[]): Tf {
  const count = new Map<string, number>();
  const df = new Map<string, number>();
  const bigrams = new Map<string, number>();
  const surface = new Map<string, string>();
  const plural = new Map<string, string>();
  const proper = new Map<string, string>();
  const words: string[][] = [];
  for (const s of sentences) {
    const w = contentWords(s.raw);
    words.push(w);
    const seen = new Set<string>();
    for (let k = 0; k < w.length; k++) {
      const t = w[k]!;
      count.set(t, (count.get(t) ?? 0) + 1);
      if (!seen.has(t)) df.set(t, (df.get(t) ?? 0) + 1);
      seen.add(t);
      const next = w[k + 1];
      if (next && next !== t) {
        const b = `${t} ${next}`;
        bigrams.set(b, (bigrams.get(b) ?? 0) + 1);
      }
    }
    const cased = s.raw.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
    for (let k = 1; k < cased.length; k++) {
      const w = cased[k]!;
      if (/^[A-Z][a-z]/.test(w) && w.length > 2) proper.set(stem(w.toLowerCase()), w);
    }
    // Remember a readable surface form (singular wins over plural when both appear).
    const lower = s.raw.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [];
    for (const raw of lower) {
      const st = stem(raw);
      const cur = surface.get(st);
      if (cur === undefined || (raw === st && cur !== st)) surface.set(st, raw);
      if (raw !== st && raw.endsWith('s')) plural.set(st, raw);
    }
  }
  const weight = new Map<string, number>();
  let max = 0;
  for (const [t, c] of count) {
    // Terms that appear in nearly every sentence are lecture noise ("going", "here").
    const spread = (df.get(t) ?? 0) / sentences.length;
    const v = c > 1 ? Math.log(1 + c) * (spread > 0.5 ? 0.3 : 1) : 0;
    weight.set(t, v);
    if (v > max) max = v;
  }
  if (max > 0) for (const [t, v] of weight) weight.set(t, v / max);
  return { weight, count, bigrams, surface, plural, proper, words };
}

function pickKeyPoints(sentences: Sentence[], tf: Tf, formulaSentences: Set<number>, defSentences: Set<number>): string[] {
  const n = sentences.length;
  const scored: { i: number; score: number; text: string; terms: Set<string> }[] = [];
  for (const s of sentences) {
    const text = clean(s.raw);
    const len = text.split(/\s+/).length;
    if (len < 6 || len > 60) continue;
    if (/\?\s*$/.test(s.raw) || LOW_VALUE.test(s.raw)) continue;
    const terms = tf.words[s.i]!;
    if (terms.length < 2) continue;
    let sum = 0;
    for (const t of terms) sum += tf.weight.get(t) ?? 0;
    let score = sum / Math.sqrt(terms.length + 2);
    for (const [re, boost] of CUES) if (re.test(s.raw)) score += boost * 0.5;
    // "This is the most important rule…" says something is important without saying what.
    if (/^(?:this|that|it|these|those)(?:'s| is| are| was)\b/i.test(text)) score -= 1.5;
    if (formulaSentences.has(s.i)) score += 0.6;
    if (defSentences.has(s.i)) score += 0.8;
    const pos = s.i / n;
    if (pos < 0.08 || pos > 0.92) score += 0.3;
    scored.push({ i: s.i, score, text, terms: new Set(terms) });
  }
  const want = Math.max(5, Math.min(8, Math.round(n / 12)));
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  const picked: typeof scored = [];
  for (const c of scored) {
    if (picked.length >= want) break;
    if (picked.some((p) => jaccard(p.terms, c.terms) > 0.5 || p.text === c.text)) continue;
    picked.push(c);
  }
  return picked.sort((a, b) => a.i - b.i).map((p) => p.text);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

// ── Title ───────────────────────────────────────────────────────────────────

const TITLE_NOISE = new Set(['example', 'question', 'answer', 'problem', 'number', 'value', 'side', 'case', 'step', 'part', 'lecture', 'today', 'class', 'thing', 'got', 'gives', 'give', 'take', 'put', 'write', 'try', 'work', 'find', 'plug', 'add', 'multiply', 'divide', 'subtract', 'call', 'mean', 'means', 'start', 'back', 'times', 'over', 'equal']);

function makeTitle(tf: Tf, defs: FoundDefinition[], outline: OutlineItem[]): string {
  const cand = new Map<string, number>();
  for (const [t, c] of tf.count) {
    if (c < 2 || TITLE_NOISE.has(t) || t.length < 4) continue;
    cand.set(t, c);
  }
  for (const [b, c] of tf.bigrams) {
    const [x, y] = b.split(' ') as [string, string];
    if (c < 2 || TITLE_NOISE.has(x) || TITLE_NOISE.has(y)) continue;
    cand.set(b, c * 2.2);
  }
  // "rule" alone says less than "chain rule": a strong bigram demotes its parts.
  for (const [b, c] of tf.bigrams) {
    if (c < 3) continue;
    for (const w of b.split(' ')) {
      const u = cand.get(w);
      if (u !== undefined && c >= 0.3 * (tf.count.get(w) ?? 0)) cand.set(w, u * 0.6);
    }
  }
  // Terms the lecturer defines or names in the outline are what the lecture is about.
  for (const d of defs) {
    const k = contentWords(d.term).join(' ');
    if (k) cand.set(k, (cand.get(k) ?? 1) * 1.5 + 2);
  }
  for (const o of outline) {
    for (const t of contentWords(o.heading)) if (cand.has(t)) cand.set(t, cand.get(t)! + 1);
  }
  const ranked = [...cand.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const chosen: string[] = [];
  for (const [term] of ranked) {
    if (chosen.length >= 2) break;
    const parts = term.split(' ');
    if (chosen.some((c) => c.split(' ').some((w) => parts.includes(w)))) continue;
    chosen.push(term);
  }
  if (!chosen.length) return 'Lecture notes';
  const words = chosen.map((c) => c.split(' ').map((w) => tf.proper.get(w) ?? tf.surface.get(w) ?? w).join(' '));
  const first = pluralHead(words[0]!, tf);
  const title = words.length > 1 ? `${first} and ${articled(words[1]!)}` : first;
  return title[0]!.toUpperCase() + title.slice(1);
}

/** "derivative" → "derivatives" when the lecture also used the plural; reads more like a title. */
function pluralHead(phrase: string, tf: Tf): string {
  if (phrase.includes(' ')) return phrase;
  return tf.plural.get(stem(phrase)) ?? phrase;
}

function articled(phrase: string): string {
  return phrase.includes(' ') ? `the ${phrase}` : phrase;
}
