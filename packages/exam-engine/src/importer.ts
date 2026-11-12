/**
 * Turns extracted/OCR text of a test, quiz, study guide, notes page or answer key into an ImportedDoc:
 * numbered questions with choices, parts, points and keys; sections with time and calculator rules;
 * header fields; document kind (with reasons); topics.
 */
import type { Topic } from '@lemma/practice-engine';
import type { Choice, ExamQuestion, ImportedDoc, Part, QuestionType } from './types';
import { answerKind, evalNumber, matches, solve } from './math';
import { cleanLines, squash } from './text';
import { classifyText, TopicTally } from './topics';
import { clamp, mode, slug } from './util';

/** A section heading found in the document and the questions under it. */
export interface DetectedSection {
  title: string;
  minutes?: number;
  calculator?: boolean;
  questionIds: string[];
}

export interface KeyEntry {
  number: number;
  text: string;
}

/** Everything the importer learned, including what doesn't fit ImportedDoc's shape. */
export interface Analysis {
  doc: ImportedDoc;
  kindReasons: string[];
  sections: DetectedSection[];
  keyEntries: KeyEntry[];
  /** Header/instruction text before the first question. */
  preamble: string[];
  title: string;
  digital: boolean;
  graphing: boolean;
  removedLines: string[];
}

// ---------- line patterns ----------

const SECTION_RE = /^\s*(?:part|section|module|paper)\s+(?:[A-Z]|[IVX]{1,4}|\d{1,2})(?![a-z])\b.*$/i;
const SUBHEAD_RE = /^\s*(multiple[- ]choice|free[- ]response|short[- ]answer|extended[- ]response|open[- ]response|constructed[- ]response|grid[- ]in|student[- ]produced|matching|fill[- ]in(?:[- ]the[- ]blanks?)?|true[- ]?(?:\/|or)[- ]?false)\b/i;
/** "Matching" directions: numbered terms, lettered descriptions shared by all of them. */
const MATCHING_RE = /^\s*matching\b|\bwrite the letter of the (?:definition|description|answer|term|word|graph|example|matching)/i;
/** A matching row: "1. Domain        A. The set of all inputs" (the bank entry may sit beside the term). */
const MATCH_ROW_RE = /^(.*?\S)\s{2,}\(?([A-Z])[.)]\s+(.+)$/;
const BANK_RE = /^\s*\(?([A-Z])[.)]\s+(.+)$/;
const KEY_HEAD_RE = /answer\s*key|^\s*(?:answers|key|solutions|answer sheet|scoring guidelines?|scoring guide|(?:marking|mark) ?scheme|markscheme|answers? (?:and|&) (?:explanations|solutions))\s*[:—–-]?\s*$|^\s*answers\s*:|^\s*(?:answers?|key)\s*[:—–-]\s*\d{1,3}\s*(?:[.)]|\s*[-–]\s*(?=[A-Ja-j]\b))\s*\S+\s+\d{1,3}\s*(?:[.)]|[-–])/i;
const Q_RE = /^\s*(?:(?:question|problem|q)\s*(\d{1,3})\s*[.:)\-]?|#\s*(\d{1,3})\s*[.:)]?|(\d{1,3})\s*[.)](?=\s|[A-Za-z($]))\s*(.*)$/i;
/**
 * OCR misreads of a question number: "l." / "I." / "|." for 1 (only for the first question) and "3," for "3."
 * (only for the expected next number, followed by a capitalised word).
 */
const OCR_Q_RE = /^\s*(?:([lI|])\s*[.)]\s+(?=[A-Z(])|(\d{1,3}),\s+(?=[A-Z][a-z]))(.*)$/;
const POINTS_RE = /[([]\s*(\d+(?:\.\d+)?)\s*(?:pts?|points?|marks?)\.?\s*(?:each\s*)?[)\]]|(?:^|\s)(\d+(?:\.\d+)?)\s*(?:pts|points|marks)\b\.?(?!\s*each)|\[\s*(\d{1,2})\s*\]\s*$|(?:_{2,}|^)\s*\/\s*(\d{1,3})\s*(?:pts?|points?)?\s*$/i;
const EACH_RE = /(\d+(?:\.\d+)?)\s*(?:pts?|points?|marks?)\s*each/i;
const ANSWER_RE = /^\s*(?:answer|ans|key)\s*[:=]\s*(.+)$/i;
const FIGURE_LINE_RE = /^\s*\[?\s*(?:figure|fig\.|graph|diagram|table|image|picture)\b|^\s*\[[^\]]{3,}\]\s*$|\|.*\|/i;
const FIGURE_REF_RE = /\b(?:graph|figure|diagram|table|picture|shown (?:below|above|at right|at left)|the grid provided|pictured)\b/i;
const CUE_RE = /\b(?:solve|find|evaluate|simplify|compute|calculate|determine|which|what|how|write|graph|factor|explain|show|prove|sketch|state|identify|describe|expand|convert|differentiate|integrate|estimate|compare|list|use|let|given|quantity a|select|indicate|choose)\b|\?|=/i;
const MULTI_RE = /select all|all that apply|indicate all|choose all|mark all|select (?:two|three)\b|more than one (?:answer|choice)/i;
const SHOW_WORK_RE = /show (?:all )?(?:of )?(?:your )?work|work must be shown|without (?:supporting )?work will (?:not|receive no)/i;
const HEADER_FIELD_RE = /\b(name|date|period|per|class|teacher|hour|block|score|section|id)\s*[:.#]?\s*_{2,}/gi;
const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii'];

/** "Time: 1 hr 30 min", "50 minutes", "90-minute" → minutes. */
export function parseMinutes(s: string): number | undefined {
  const hm = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|hr|h)\b(?:\s*(?:and\s*)?(\d+)\s*(?:minutes?|mins?|m)\b)?/i.exec(s);
  if (hm) return Math.round(Number(hm[1]) * 60 + (hm[2] ? Number(hm[2]) : 0));
  const m = /(\d{1,3})\s*[- ]?\s*(?:minutes?|mins?)\b/i.exec(s);
  return m ? Number(m[1]) : undefined;
}

/** Calculator rule stated in a line: false for "no calculator", true for "calculator allowed", else undefined. */
export function parseCalculator(s: string): boolean | undefined {
  if (/\b(?:no|non)[- ]?calculators?\b|calculators? (?:is |are )?not (?:allowed|permitted|used)|without (?:a |the )?calculator|calculators? (?:may|must) not\b|calculator[- ]inactive/i.test(s)) return false;
  if (/calculators? (?:is |are )?(?:allowed|permitted|active|required|may be used|ok)|\bwith (?:a |the )?calculator\b|calculator[- ](?:active|allowed|section|permitted)|graphing calculator|scientific calculator|^\s*(?:part|section|module|paper)\b[^\n]*\bcalculator\b/i.test(s)) return true;
  return undefined;
}

function parsePoints(s: string): { points?: number; rest: string } {
  const m = POINTS_RE.exec(s);
  if (!m) return { rest: s };
  const v = Number(m[1] ?? m[2] ?? m[3] ?? m[4]);
  return { points: Number.isFinite(v) ? v : undefined, rest: (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).replace(/_{2,}/g, ' ') };
}

// ---------- labelled items (choices / parts) ----------

type LabelStyle = 'upper' | 'lower' | 'roman';
interface LabelToken {
  label: string;
  style: LabelStyle;
  index: number; // position in sequence (A=0, a=0, i=0)
  start: number;
  end: number;
}

function labelTokens(line: string): LabelToken[] {
  const out: LabelToken[] = [];
  const re = /(^|\s)(?:\((i{1,3}|iv|vi{0,3}|[A-Ha-h])\)|(i{1,3}|iv|vi{0,3}|[A-Ha-h])[.)])(?=\s|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const label = (m[2] ?? m[3])!;
    const start = m.index + m[1]!.length;
    const romanIdx = ROMAN.indexOf(label);
    let style: LabelStyle;
    let index: number;
    if (romanIdx >= 0) {
      style = 'roman';
      index = romanIdx;
    } else if (/[A-H]/.test(label)) {
      style = 'upper';
      index = label.charCodeAt(0) - 65;
    } else {
      style = 'lower';
      index = label.charCodeAt(0) - 97;
    }
    out.push({ label, style, index, start, end: m.index + m[0].length });
  }
  return out;
}

/**
 * Splits a line into prompt text and labelled items. Items must form a run in order (A, B, C… / a, b… /
 * i, ii…) of one style. A run that doesn't start the line must start at the first label and have ≥ 2 items.
 */
function splitItems(line: string, expectNext?: { style: LabelStyle; index: number }): { before: string; style: LabelStyle; items: { label: string; index: number; text: string }[] } | null {
  const toks = labelTokens(line);
  if (!toks.length) return null;
  for (let s = 0; s < toks.length; s++) {
    const first = toks[s]!;
    const atStart = !line.slice(0, first.start).trim();
    const continuing = expectNext && expectNext.style === first.style && expectNext.index === first.index;
    if (!(first.index === 0 || (atStart && continuing))) continue;
    const run = [first];
    for (let k = s + 1; k < toks.length; k++) {
      const t = toks[k]!;
      const prev = run[run.length - 1]!;
      if (t.style === first.style && t.index === prev.index + 1) run.push(t);
    }
    if (!atStart && run.length < 2) continue;
    if (atStart && run.length < 2 && !continuing && first.index !== 0) continue;
    const items = run.map((t, k) => ({ label: t.label, index: t.index, text: line.slice(t.end, run[k + 1]?.start ?? line.length).trim() }));
    return { before: line.slice(0, first.start).trim(), style: first.style, items };
  }
  return null;
}

// ---------- blocks ----------

interface Item {
  label: string;
  style: LabelStyle;
  text: string;
}

interface Block {
  number: number;
  lines: string[];
  items: Item[];
  points?: number;
  pointsExplicit: boolean;
  inlineAnswer?: string;
  figure: string[];
  section: number;
  blankSinceItem: boolean;
  freeResponseHint: boolean;
  /** Index into the matching groups when this block is a term in a matching section. */
  matchGroup?: number;
}

interface SectionState {
  title: string;
  minutes?: number;
  calculator?: boolean;
  eachPoints?: number;
  questionIds: string[];
}

function isHeading(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 70 || /[.?]$/.test(t) || Q_RE.test(t)) return false;
  if (/^#{1,4}\s/.test(t) || /:$/.test(t)) return true;
  const words = t.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (!words.length) return false;
  if (t === t.toUpperCase() && /[A-Z]{3}/.test(t)) return true;
  const caps = words.filter((w) => /^[A-Z0-9(]/.test(w)).length;
  return words.length <= 8 && caps / words.length >= 0.6;
}

// ---------- the parser ----------

/** Full analysis of one uploaded document. */
export function analyze(name: string, text: string, opts: { pages?: string[] } = {}): Analysis {
  const { lines, removed } = cleanLines(text, opts.pages);
  const docSlug = slug(name);
  const warnings: string[] = [];
  const sections: SectionState[] = [];
  const blocks: Block[] = [];
  const preamble: string[] = [];
  const header: string[] = [];
  const keyLines: string[] = [];
  let sharedChoices: Choice[] | undefined;
  let region: 'body' | 'key' = 'body';
  let cur: Block | null = null;
  let freeResponseHint = false;
  let docEach: number | undefined;
  let pendingSharedChoices: Choice[] = [];
  const matchGroups: Choice[][] = [];
  let matching = false;

  const flush = () => {
    if (cur) blocks.push(cur);
    cur = null;
  };

  // A key-only document: the key heading comes before any question.
  const firstQ = lines.findIndex((l) => Q_RE.test(l));
  const firstKey = lines.findIndex((l) => KEY_HEAD_RE.test(l));
  if (firstKey >= 0 && (firstQ < 0 || firstKey < firstQ)) region = 'key';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const t = line.trim();
    if (region === 'key') {
      if (t) keyLines.push(t);
      continue;
    }
    if (!t) {
      if (cur) cur.blankSinceItem = cur.items.length > 0 ? true : cur.blankSinceItem;
      continue;
    }
    if (/^[_\s.]+$/.test(t)) continue; // answer blanks / work lines
    if (!/[\p{L}\p{N}√π∫∑=<>≤≥]/u.test(t)) continue; // OCR specks: "~ -- ' . ,, ;"
    if (KEY_HEAD_RE.test(t) && !(cur && ANSWER_RE.test(t) && !/key|answers\s*:/i.test(t))) {
      flush();
      region = 'key';
      const rest = t.replace(/^.*?(?:answer\s*key|answers|key|solutions)\s*[:—–-]?\s*/i, '');
      if (/^\d{1,3}\s*(?:[.)]|[-–]\s*[A-Ja-j]\b)/.test(rest)) keyLines.push(rest);
      continue;
    }
    if (SECTION_RE.test(t)) {
      flush();
      const each = EACH_RE.exec(t);
      sections.push({ title: squash(t.replace(/\(\s*\d+\s*(?:pts?|points?)\s*each\s*\)/i, '')), minutes: parseMinutes(t), calculator: parseCalculator(t), eachPoints: each ? Number(each[1]) : undefined, questionIds: [] });
      freeResponseHint = /free[- ]response|short answer|extended/i.test(t);
      matching = MATCHING_RE.test(t);
      if (matching) matchGroups.push([]);
      continue;
    }
    if (SUBHEAD_RE.test(t) && !Q_RE.test(t)) {
      flush();
      freeResponseHint = /free|short|extended|open|constructed|grid|student/i.test(t);
      matching = MATCHING_RE.test(t);
      if (matching) matchGroups.push([]);
      const each = EACH_RE.exec(t);
      if (each) {
        const sec = sections[sections.length - 1];
        if (sec) sec.eachPoints = Number(each[1]);
        else docEach = Number(each[1]);
      }
      const calc = parseCalculator(t);
      const sec = sections[sections.length - 1];
      if (calc !== undefined && sec && sec.calculator === undefined) sec.calculator = calc;
      continue;
    }

    let q = Q_RE.exec(line);
    if (!q) {
      const o = OCR_Q_RE.exec(line);
      const last: Block | null = cur ?? blocks[blocks.length - 1] ?? null;
      if (o && o[1] && !last) q = Object.assign([o[0], undefined, undefined, '1', o[3]], { index: 0, input: line }) as unknown as RegExpExecArray;
      else if (o && o[2] && last && Number(o[2]) === last.number + 1) q = Object.assign([o[0], undefined, undefined, o[2], o[3]], { index: 0, input: line }) as unknown as RegExpExecArray;
    }
    if (q) {
      const n = Number(q[1] ?? q[2] ?? q[3]);
      const last: Block | null = cur ?? blocks[blocks.length - 1] ?? null;
      const expected: number = last ? last.number + 1 : n;
      const plausible = !last || n === expected || n === 1 || n === expected + 1;
      // Inside a block, "2. …" that isn't the next number is content (e.g. a numbered list in a prompt).
      if (plausible) {
        if (last && n === expected + 1) warnings.push(`Question ${expected} wasn't found (numbering jumps to ${n}); it may have been lost in extraction.`);
        flush();
        cur = { number: n, lines: [], items: [], pointsExplicit: false, figure: [], section: sections.length - 1, blankSinceItem: false, freeResponseHint };
        const body = q[4] ?? '';
        if (matching) {
          // A term; its neighbour on the line (if any) is one entry of the shared bank.
          cur.matchGroup = matchGroups.length - 1;
          const row = MATCH_ROW_RE.exec(body);
          if (row) {
            matchGroups[cur.matchGroup]!.push({ id: row[2]!, text: squash(row[3]!) });
            cur.lines.push(takeTermPoints(cur, row[1]!));
          } else if (body) cur.lines.push(takeTermPoints(cur, body));
          continue;
        }
        if (body) consume(cur, body);
        continue;
      }
    }

    if (!cur && matching) {
      const bank = BANK_RE.exec(t);
      if (bank) {
        matchGroups[matchGroups.length - 1]!.push({ id: bank[1]!, text: squash(bank[2]!) });
        continue;
      }
    }
    if (!cur) {
      // Shared answer choices declared once in directions (quantitative comparison).
      const split = splitItems(t, pendingSharedChoices.length ? { style: 'upper', index: pendingSharedChoices.length } : undefined);
      if (split && split.style === 'upper') {
        for (const it of split.items) pendingSharedChoices.push({ id: it.label.toUpperCase(), text: it.text });
        if (pendingSharedChoices.some((c) => /quantit/i.test(c.text)) && pendingSharedChoices.length >= 4) sharedChoices = pendingSharedChoices.slice(0, 4);
        continue;
      }
      if (sections.length) {
        const sec = sections[sections.length - 1]!;
        sec.minutes ??= parseMinutes(t);
        if (sec.calculator === undefined) sec.calculator = parseCalculator(t);
        const each = EACH_RE.exec(t);
        if (each) sec.eachPoints = Number(each[1]);
      } else {
        const each = EACH_RE.exec(t);
        if (each) docEach = Number(each[1]);
      }
      preamble.push(t);
      if (!sections.length && !blocks.length) header.push(t);
      continue;
    }
    if (/^(?:directions|instructions)\b/i.test(t)) {
      flush();
      preamble.push(t);
      continue;
    }
    if (matching && cur.matchGroup !== undefined) {
      const bank = BANK_RE.exec(t);
      if (bank) matchGroups[cur.matchGroup]!.push({ id: bank[1]!, text: squash(bank[2]!) });
      else cur.lines.push(t);
      continue;
    }
    consume(cur, line);
  }
  flush();

  function takeTermPoints(b: Block, x: string): string {
    const p = parsePoints(x);
    if (p.points === undefined) return x.trim();
    b.points ??= p.points;
    b.pointsExplicit = true;
    return squash(p.rest);
  }

  function consume(b: Block, raw: string): void {
    let s = raw.trim();
    const ans = ANSWER_RE.exec(s);
    if (ans) {
      b.inlineAnswer = ans[1]!.trim();
      return;
    }
    if (FIGURE_LINE_RE.test(s) && !/^\(?[A-Ha-h][.)]/.test(s)) {
      b.figure.push(s.replace(/^\[|\]$/g, '').trim());
      return;
    }
    const takePoints = (x: string): string => {
      const p = parsePoints(x);
      if (p.points === undefined) return x;
      b.points ??= p.points;
      b.pointsExplicit = true;
      return squash(p.rest);
    };
    const lastItem = b.items[b.items.length - 1];
    const inParts = !!lastItem && lastItem.style !== 'upper';
    const expect = lastItem ? { style: lastItem.style, index: indexOf(lastItem) + 1 } : undefined;
    const split = splitItems(s, expect);
    if (split) {
      let before = split.before;
      if (before && !inParts) before = takePoints(before);
      if (before) {
        if (lastItem && !b.blankSinceItem) lastItem.text = squash(lastItem.text + ' ' + before);
        else b.lines.push(before);
      }
      for (const it of split.items) b.items.push({ label: it.label, style: split.style, text: split.style === 'upper' ? takePoints(it.text) : it.text });
      b.blankSinceItem = false;
      return;
    }
    if (lastItem) {
      if (inParts) lastItem.text = squash(lastItem.text + ' ' + s);
      else if (!b.blankSinceItem && s.length < 60) {
        const rest = takePoints(s);
        if (rest) lastItem.text = squash(lastItem.text + ' ' + rest);
      }
      return; // otherwise: stray text after a finished choice list
    }
    s = takePoints(s);
    if (s) b.lines.push(s);
  }

  // ---------- answer key ----------
  const keyEntries = parseKey(keyLines);

  const headerText = header.join('\n');
  const docCalc = parseCalculator(headerText.split('\n').filter((l) => !/_{2,}/.test(l)).join(' '));

  // ---------- blocks → questions ----------
  const seenIds = new Set<string>();
  const questions: ExamQuestion[] = [];
  const sectionQ: string[][] = sections.map(() => []);
  for (const b of blocks) {
    const qq = toQuestion(b);
    if (!qq) continue;
    let id = `${docSlug}-q${b.number}`;
    if (seenIds.has(id)) id = `${docSlug}-s${b.section + 1}-q${b.number}`;
    seenIds.add(id);
    qq.id = id;
    questions.push(qq);
    if (b.section >= 0) sectionQ[b.section]!.push(id);
  }

  function toQuestion(b: Block): ExamQuestion | null {
    if (b.matchGroup !== undefined) return matchQuestion(b);
    let prompt = squash(b.lines.join(' '));
    const sec = b.section >= 0 ? sections[b.section] : undefined;
    let choices: Choice[] | undefined;
    let parts: Part[] | undefined;
    const upper = b.items.filter((it) => it.style === 'upper');
    const lower = b.items.filter((it) => it.style !== 'upper');
    if (upper.length >= 2) choices = upper.map((it) => ({ id: it.label.toUpperCase(), text: squash(it.text) }));
    if (lower.length) {
      const looksLikeChoices =
        !choices && lower.length >= 2 && lower.length <= 6 && lower.every((it) => it.style === 'lower' && it.text.length <= 30 && !CUE_RE.test(it.text.replace(/=/g, '')) && parsePoints(it.text).points === undefined);
      if (looksLikeChoices) choices = lower.map((it) => ({ id: it.label.toUpperCase(), text: squash(it.text) }));
      else
        parts = lower.map((it) => {
          const p = parsePoints(it.text);
          const partPrompt = squash(p.rest);
          return { label: it.label, prompt: partPrompt, points: p.points ?? 0, type: partType(partPrompt) };
        });
    }
    if (!choices && sharedChoices && /quantity a/i.test(prompt)) choices = sharedChoices.map((c) => ({ ...c }));
    if (choices && (choices.length < 2 || choices.length > 6)) {
      warnings.push(`Question ${b.number}: found ${choices.length} choices; kept them as text.`);
      prompt = squash(prompt + ' ' + choices.map((c) => `${c.id}. ${c.text}`).join(' '));
      choices = undefined;
    }
    const questionLike = choices || parts || b.pointsExplicit || b.inlineAnswer || CUE_RE.test(prompt);
    if (!questionLike || !prompt) return null;

    const showWork = SHOW_WORK_RE.test(prompt);
    let type: QuestionType;
    if (choices) type = MULTI_RE.test(prompt) ? 'multi' : 'mc';
    else if (parts && parts.length) type = 'free';
    else if ((b.points ?? 0) >= 3 || showWork || /\b(?:explain|justify|sketch|prove|describe)\b/i.test(prompt) || (b.freeResponseHint && (b.points ?? 0) >= 2)) type = 'free';
    else type = partType(prompt);

    if (parts) {
      const sum = parts.reduce((s, p) => s + p.points, 0);
      if (b.points === undefined && sum > 0) b.points = sum;
      if (b.points !== undefined && parts.some((p) => !p.points)) {
        const left = Math.max(0, b.points - sum);
        const blanks = parts.filter((p) => !p.points);
        blanks.forEach((p) => (p.points = Math.round((left / blanks.length) * 100) / 100 || 1));
      }
    }
    const each = type === 'mc' || type === 'multi' ? (sec?.eachPoints ?? docEach) : undefined;
    const points = b.points ?? each ?? (parts ? parts.reduce((s, p) => s + (p.points || 1), 0) : 1);

    const figureRef = FIGURE_REF_RE.test(prompt);
    let figure: string | undefined;
    if (b.figure.length) figure = b.figure.join('\n');
    else if (figureRef) figure = (prompt.split(/(?<=[.?!])\s+/).find((x) => FIGURE_REF_RE.test(x)) ?? prompt).trim();
    if (figure) warnings.push(`Question ${b.number} refers to a figure or table; only its text was imported, so it is reproduced as text.`);

    const cls = classifyText([prompt, ...(choices ?? []).map((c) => c.text), ...(parts ?? []).map((p) => p.prompt)].join(' '));
    const q: ExamQuestion = { id: '', number: b.number, type, prompt, points, origin: 'imported' };
    if (figure) q.figure = figure;
    if (choices) q.choices = choices;
    if (parts) q.parts = parts;
    if (cls.topic) q.topic = cls.topic;
    const calc = sec?.calculator ?? docCalc;
    if (calc !== undefined) q.calculator = calc;
    if (b.inlineAnswer) attach(q, b.inlineAnswer);
    return q;
  }

  /** A term in a matching section: multiple choice over the section's shared bank. */
  function matchQuestion(b: Block): ExamQuestion | null {
    const term = squash(b.lines.join(' ')).replace(/[_\s]+$/, '').trim();
    const bank = [...new Map(matchGroups[b.matchGroup!]!.map((c) => [c.id, c])).values()].sort((x, y) => x.id.localeCompare(y.id));
    if (!term || bank.length < 2) return null;
    const sec = b.section >= 0 ? sections[b.section] : undefined;
    const q: ExamQuestion = { id: '', number: b.number, type: 'mc', prompt: `Match “${term}” with its description.`, choices: bank.map((c) => ({ ...c })), points: b.points ?? sec?.eachPoints ?? docEach ?? 1, origin: 'imported' };
    const cls = classifyText([term, ...bank.map((c) => c.text)].join(' '));
    if (cls.topic) q.topic = cls.topic;
    const calc = sec?.calculator ?? docCalc;
    if (calc !== undefined) q.calculator = calc;
    if (b.inlineAnswer) attach(q, b.inlineAnswer);
    return q;
  }

  // ---------- header hints ----------
  const allText = lines.join('\n');
  const headerFields = [...new Set([...allText.matchAll(HEADER_FIELD_RE)].map((m) => cap(m[1]!.toLowerCase() === 'per' ? 'period' : m[1]!)))];

  // Attach end-of-document key entries.
  const unmatched = attachEntries(questions, keyEntries);
  if (keyEntries.length && unmatched.length) warnings.push(`Answer key entries without a matching question: ${unmatched.join(', ')}.`);

  // A key-only document keeps its entries as stub questions so buildProfile can attach them elsewhere.
  if (!questions.length && keyEntries.length) {
    for (const e of keyEntries) {
      const stub: ExamQuestion = { id: `${docSlug}-key${e.number}`, number: e.number, type: /^[A-F](?:\s*[,&]\s*[A-F])*$/.test(e.text) ? 'mc' : 'short', prompt: '', points: 0, origin: 'imported' };
      stub.answer = /^[A-F]\s*[,&]/.test(e.text) ? e.text.split(/\s*[,&]\s*/) : e.text;
      questions.push(stub);
    }
  }

  // Difficulty: position in its section plus content features.
  const unsectioned = questions.filter((q) => !sectionQ.some((ids) => ids.includes(q.id))).map((q) => q.id);
  for (const ids of [...sectionQ, unsectioned]) {
    ids.forEach((id, k) => {
      const q = questions.find((x) => x.id === id);
      if (q && q.prompt) q.difficulty = estimateDifficulty(q, k, ids.length);
    });
  }

  const times = sections.map((s) => s.minutes).filter((m): m is number => m !== undefined);
  const headerMinutes = parseMinutes(headerText);
  const hints: ImportedDoc['hints'] = {};
  const timeMinutes = headerMinutes ?? (times.length && times.length === sections.length ? times.reduce((a, b) => a + b, 0) : undefined);
  if (timeMinutes !== undefined) hints.timeMinutes = timeMinutes;
  const secCalcs = sections.map((s) => s.calculator).filter((c): c is boolean => c !== undefined);
  const calcHint = docCalc ?? (secCalcs.length && secCalcs.every((c) => c === secCalcs[0]) ? secCalcs[0] : undefined);
  if (calcHint !== undefined) hints.calculator = calcHint;
  if (SHOW_WORK_RE.test(allText)) hints.showWork = true;
  const matchIds = new Set(blocks.filter((b) => b.matchGroup !== undefined).map((b) => b.number));
  const mcCounts = questions.filter((q) => q.choices && q.type !== 'multi' && !(matchIds.has(q.number) && /^Match “/.test(q.prompt))).map((q) => q.choices!.length);
  const cpq = mode(mcCounts);
  if (cpq !== undefined) hints.choicesPerQuestion = cpq;
  const pointsShown = blocks.some((b) => b.pointsExplicit) || sections.some((s) => s.eachPoints !== undefined) || docEach !== undefined;
  if (questions.some((q) => q.prompt)) hints.pointsShown = pointsShown;
  if (headerFields.length) hints.header = headerFields;
  if (sections.length) hints.sections = sections.map((s) => s.title);

  const title = lines.find((l) => l.trim() && !/_{2,}/.test(l))?.trim() ?? name;
  const kind = detectKind(name, title, allText, questions, keyEntries, hints, headingCount(lines));

  // Topics.
  const tally = new TopicTally();
  const real = questions.filter((q) => q.prompt);
  for (const q of real) {
    const c = classifyText([q.prompt, ...(q.parts ?? []).map((p) => p.prompt)].join(' '));
    tally.add(c.topic, kind.kind === 'test' ? Math.max(1, q.points) : 2, c.subtopics);
  }
  if (kind.kind === 'study-guide' || kind.kind === 'notes' || kind.kind === 'unknown') {
    for (const l of lines) {
      const tl = l.trim();
      if (!tl || Q_RE.test(tl)) continue;
      if (isHeading(tl)) tally.addText(tl, 3);
      else if (/=|d\/dx|∫|\blim\b/.test(tl)) tally.addText(tl, 2);
      else tally.addText(tl, 1);
    }
  }
  const topics = tally.result();
  if (!real.length && kind.kind === 'test') warnings.push('No questions were recognised.');

  const doc: ImportedDoc = { name, kind: kind.kind, text, questions, hints, topics, warnings };
  return {
    doc,
    kindReasons: kind.reasons,
    sections: sections.map((s, k) => {
      const out: DetectedSection = { title: s.title, questionIds: sectionQ[k] ?? [] };
      if (s.minutes !== undefined) out.minutes = s.minutes;
      if (s.calculator !== undefined) out.calculator = s.calculator;
      return out;
    }),
    keyEntries,
    preamble,
    title,
    digital: /\b(?:online|on the computer|digital|desmos|bluebook|canvas|schoology|google forms?|on-screen)\b/i.test(headerText),
    graphing: /graphing calculator|\bti-8\d|desmos/i.test(allText),
    removedLines: removed,
  };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

function indexOf(it: Item): number {
  if (it.style === 'roman') return ROMAN.indexOf(it.label);
  return it.label.toLowerCase().charCodeAt(0) - 97;
}

function headingCount(lines: string[]): number {
  return lines.filter((l) => isHeading(l)).length;
}

/** Type of an unlabelled answer from the wording. */
function partType(prompt: string): Exclude<QuestionType, 'free'> {
  if (/\b(?:explain|justify|describe|sketch|interpret|why|in (?:complete )?sentences)\b/i.test(prompt)) return 'short';
  if (/∫|\b(?:simplify|factor|expand|derivative|differentiate|antiderivative|integral|write (?:an?|the) (?:expression|equation|function)|vertex form|equivalent expression|in terms of)\b/i.test(prompt) && !/\bvalue\b/i.test(prompt)) return 'expression';
  if (/\d|=|\bhow (?:many|much|long|far)\b|\bwhat is\b|\bfind\b|\bsolve\b/i.test(prompt)) return 'numeric';
  return 'short';
}

function estimateDifficulty(q: ExamQuestion, k: number, n: number): 1 | 2 | 3 {
  let score = 1 + (n > 1 ? (2 * k) / (n - 1) : 0) * 0.6; // position: tests ramp up
  if (q.parts && q.parts.length >= 2) score += 0.8;
  if (q.prompt.length > 140) score += 0.4;
  if (/\d\s*x\s*\^\s*2/.test(q.prompt) || /\(.*\)\s*\^/.test(q.prompt)) score += 0.3;
  if (q.figure) score += 0.2;
  return clamp(Math.round(score), 1, 3) as 1 | 2 | 3;
}

// ---------- answer keys ----------

/** Parses "1. B  2. D", "1) x = 4", "14. (a) 3 (b) 5", "25. Rubric: …" lines. */
export function parseKey(lines: string[]): KeyEntry[] {
  const out: KeyEntry[] = [];
  for (const raw of lines) {
    let line = raw.trim();
    // Key tables: "| 1 | C |" rows (header and rule rows skipped), and "1      C" columns from PDF tables.
    if (/^\|?[\s|:–—-]+\|?$/.test(line)) continue;
    if (/^\|.*\|/.test(line)) {
      const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length < 2 || !/^(?:#|q)?\d{1,3}$/i.test(cells[0]!)) continue;
      line = `${cells[0]!.replace(/^(?:#|q)/i, '')}. ${cells.slice(1).join(' ')}`;
    } else line = line.replace(/^(\d{1,3})\s{2,}(?=\S)/, '$1. ');
    if (!line || SECTION_RE.test(line) || /^(?:answer\s*key|answers|key|solutions)\b/i.test(line) && !/\d\s*[.)]/.test(line)) continue;
    // "4." before a digit is a decimal ("(b) 4.5"), not entry 4; "1-B" / "1 – C" is an entry when a letter follows.
    const re = /(?:^|\s)(?:#|q)?(\d{1,3})\s*(?:[.):](?!\d)|[-–](?=\s*[A-Ja-j](?![A-Za-z(])))\s*(?=\S)/gi;
    const toks: { n: number; start: number; end: number }[] = [];
    let m: RegExpExecArray | null;
    const lastN = out[out.length - 1]?.number;
    while ((m = re.exec(line))) {
      const n = Number(m[1]);
      const prev = toks[toks.length - 1]?.n ?? lastN;
      const atStart = !line.slice(0, m.index).trim();
      if ((atStart && toks.length === 0) || prev === undefined || n === prev + 1) toks.push({ n, start: m.index, end: m.index + m[0].length });
    }
    if (!toks.length || line.slice(0, toks[0]!.start).trim()) {
      const last = out[out.length - 1];
      if (last && !toks.length) last.text = squash(last.text + ' ' + line);
      if (!toks.length) continue;
    }
    toks.forEach((tk, k) => {
      const text = line.slice(tk.end, toks[k + 1]?.start ?? line.length).trim();
      out.push({ number: tk.n, text });
    });
  }
  return out;
}

/** Applies one key entry (or inline "Answer: …") to a question. */
export function attach(q: ExamQuestion, rawText: string): void {
  const text = rawText.trim().replace(/[.;]\s*$/, '');
  if (!text) return;
  const rubric = /^(?:rubric|scoring|grading)\s*[:—-]\s*(.+)$/i.exec(text);
  if (rubric) {
    const items = rubric[1]!.split(/\s*;\s*/).map((s) => s.trim()).filter(Boolean);
    if (q.parts && q.parts.length) q.parts[q.parts.length - 1]!.rubric = items;
    else q.parts = [{ label: 'a', prompt: '', points: q.points, rubric: items, type: 'short' }];
    if (q.type !== 'free') q.type = 'free';
    return;
  }
  if (q.choices) {
    const letters = /^\(?([A-Fa-f])\)?(?:[.),&]|\s|$)/.test(text) && text.replace(/[^A-Za-z]/g, '').length <= q.choices.length * 2
      ? [...text.matchAll(/\b([A-Fa-f])\b/g)].map((m) => m[1]!.toUpperCase())
      : [];
    const valid = letters.filter((l) => q.choices!.some((c) => c.id === l));
    if (valid.length) {
      q.answer = q.type === 'multi' ? [...new Set(valid)] : valid[0]!;
      return;
    }
    // The key gave the value instead of the letter.
    const hit = q.choices.find((c) => matches(text, c.text).correct || c.text.replace(/\s+/g, '') === text.replace(/\s+/g, ''));
    if (hit) q.answer = q.type === 'multi' ? [hit.id] : hit.id;
    return;
  }
  const partRe = /\(([a-h]|i{1,3}|iv|vi{0,3})\)\s*/g;
  if (q.parts && q.parts.length && partRe.test(text)) {
    const bits = text.split(/\(([a-h]|i{1,3}|iv|vi{0,3})\)\s*/).slice(1);
    for (let k = 0; k + 1 < bits.length; k += 2) {
      const part = q.parts.find((p) => p.label === bits[k]);
      if (part) {
        const partRubric = /^(?:rubric|scoring|grading)\s*[:—-]\s*(.+)$/i.exec(bits[k + 1]!.trim());
        if (partRubric) {
          // "(c) Rubric: mentions right skew" is how to grade the part, not its answer.
          part.rubric = partRubric[1]!.replace(/[.;,]\s*$/, '').split(/\s*;\s*/).filter(Boolean);
          continue;
        }
        part.answer = bits[k + 1]!.trim().replace(/[.;,]\s*$/, '');
        if (part.type === 'short' && answerKind(part.answer) !== 'expression') part.type = 'numeric';
      }
    }
    return;
  }
  q.answer = text;
  if (q.type === 'numeric' || q.type === 'short' || q.type === 'expression') {
    const k = answerKind(text);
    if (k === 'expression' && evalNumber(text) === null && /[a-z]/i.test(text.replace(/^[a-z]\s*=\s*/i, '')) && !/\b(?:shift|left|right|up|down|the|because)\b/i.test(text)) q.type = 'expression';
    else if (k !== 'expression' && q.type === 'short') q.type = 'numeric';
  }
}

/** Attaches key entries to questions by number (k-th entry for n → k-th question numbered n). Returns unmatched numbers. */
export function attachEntries(questions: ExamQuestion[], entries: KeyEntry[]): number[] {
  const used = new Map<number, number>();
  const unmatched: number[] = [];
  for (const e of entries) {
    const k = used.get(e.number) ?? 0;
    used.set(e.number, k + 1);
    const q = questions.filter((x) => x.number === e.number && x.prompt)[k];
    if (q) attach(q, e.text);
    else unmatched.push(e.number);
  }
  return unmatched;
}

// ---------- document kind ----------

function detectKind(
  name: string,
  title: string,
  text: string,
  questions: ExamQuestion[],
  keyEntries: KeyEntry[],
  hints: ImportedDoc['hints'],
  headings: number,
): { kind: ImportedDoc['kind']; reasons: string[] } {
  const real = questions.filter((q) => q.prompt);
  const top = (name + ' ' + title + ' ' + text.slice(0, 400)).toLowerCase();
  const s = { test: 0, 'answer-key': 0, 'study-guide': 0, notes: 0 };
  const why: Record<keyof typeof s, string[]> = { test: [], 'answer-key': [], 'study-guide': [], notes: [] };
  const add = (k: keyof typeof s, v: number, reason: string) => {
    s[k] += v;
    why[k].push(reason);
  };
  if (/\b(?:test|exam|quiz|assessment|midterm|final)\b/.test(top) && !/study guide|review/.test(top)) add('test', 2, 'title names a test/quiz');
  if (real.length >= 5) add('test', 2, `${real.length} numbered questions`);
  if (hints.header?.length) add('test', 2, `header fields (${hints.header.join(', ')})`);
  if (hints.timeMinutes) add('test', 2, `time limit ${hints.timeMinutes} min`);
  if (hints.pointsShown) add('test', 1, 'point values shown');
  if (real.some((q) => q.choices)) add('test', 1, 'multiple-choice options');
  if (keyEntries.length && real.length) add('test', 1, 'answer key at the end');
  if (/answer key|\bsolutions\b|\bkey\b/.test(top) && !real.length) add('answer-key', 5, 'titled as an answer key');
  if (keyEntries.length >= 3 && !real.length) add('answer-key', 3, `${keyEntries.length} key entries and no question text`);
  if (/study guide|review (?:sheet|packet|guide)|unit review|practice problems|topics to know|you should be able to|test review/.test(text.toLowerCase().slice(0, 4000)) || /study guide|review/.test(top)) add('study-guide', 4, 'study-guide wording');
  if (headings >= 3 && (real.length > 0 || /=/.test(text))) add('study-guide', 1, `${headings} headings with practice/formulas`);
  if (/\bnotes\b|\blecture\b|\bclass notes\b/.test(top)) add('notes', 4, 'titled as notes/lecture');
  const prose = (text.match(/\b(?:definition|example|theorem|recall|note:|key idea)\b/gi) ?? []).length;
  if (prose >= 2) add('notes', 2, `${prose} definition/example markers`);
  if (!real.length && text.length > 200 && prose < 2 && headings >= 2) add('notes', 1, 'prose with headings and no questions');
  const best = (Object.keys(s) as (keyof typeof s)[]).sort((a, b) => s[b] - s[a])[0]!;
  if (s[best] < 2) return { kind: 'unknown', reasons: ['not enough evidence for any document kind'] };
  return { kind: best, reasons: why[best] };
}

/** Topic of an arbitrary prompt (exported for tests and the UI). */
export function topicOf(text: string): Topic | null {
  return classifyText(text).topic;
}

/** Re-checks an imported key with Lemma: true/false when it can be computed, null when it can't. */
export function verifyImportedKey(q: ExamQuestion): boolean | null {
  const s = solve(q.prompt);
  if (!s || q.answer === undefined) return null;
  const key = Array.isArray(q.answer) ? q.answer.join(', ') : q.answer;
  if (q.choices) {
    const choice = q.choices.find((c) => c.id === key);
    return choice ? matches(s.answer, choice.text).correct : null;
  }
  return matches(s.answer, key).correct;
}
