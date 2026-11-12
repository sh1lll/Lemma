/**
 * Cleaning for text that came out of PDF extraction or OCR: ligatures, look-alike minus signs, lost
 * superscripts ("x2" → x^2), running page headers/footers and page numbers, hyphenated line breaks.
 */

const LIGATURES: Record<string, string> = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'ft', 'ﬆ': 'st' };
const SUPERSCRIPTS: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+' };

/** Character-level fixes that are always safe. */
export function cleanChars(s: string): string {
  return s
    .replace(/[ﬀﬁﬂﬃﬄﬅﬆ]/g, (c) => LIGATURES[c] ?? c)
    .replace(/[−‒﹣－]/g, '-') // minus look-alikes
    .replace(/[   \t]/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/([⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+)/g, (m) => '^' + [...m].map((c) => SUPERSCRIPTS[c] ?? c).join(''))
    // An en dash between math operands is a minus ("3x – 5"), between words it is punctuation.
    .replace(/([\dxy)])\s+–\s+(?=[\dxy(])/g, '$1 - ');
}

/**
 * OCR drops superscripts: "3x2 - 5x" means 3x^2 - 5x. Only a single lowercase variable directly followed by
 * one digit 2–9, standing alone (preceded by a digit, operator, space or bracket and followed by a
 * non-word character), is rewritten. Words ("log2", "Q2") and multi-digit tails are left alone.
 */
export function fixLostExponents(s: string): string {
  // "(x - 4)2 + 1" → "(x - 4)^2 + 1"
  s = s.replace(/(\([^()]*[a-z][^()]*\))([2-9])(?=$|[\s)+\-*/=,.;:?])/g, '$1^$2');
  return s.replace(/(^|[\d\s(+\-*/=·×])([a-z])([2-9])(?=$|[\s)+\-*/=·×,.;:?])/g, (m, pre: string, v: string, d: string) => {
    if (!/[xyztnabkmpqrsuvwh]/.test(v)) return m;
    return `${pre}${v}^${d}`;
  });
}

/**
 * Two-column layouts in fixed-width text (text exports, some OCR): "1. What is…      2. Find…" puts two
 * questions side by side. Where blank-line-separated paragraphs share a gutter (two or more spaces ending at
 * the same column) and one line starts a numbered question on each side, the left column is emitted first,
 * then the right. Paragraphs that cross the gutter end the two-column stretch; nothing is split otherwise.
 */
export function splitTextColumns(lines: string[]): string[] {
  const twoQ = /^(\s*\d{1,3}\s*[.)]\s.*?\S)(\s{3,})(\d{1,3}\s*[.)]\s)/;
  const blank = (l: string | undefined) => l === undefined || l === '\f' || !l.trim();
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = twoQ.exec(lines[i]!);
    if (!m) {
      out.push(lines[i++]!);
      continue;
    }
    const c = m[1]!.length + m[2]!.length; // column where the right side starts
    const rightAt = (l: string) => l.length > c && l[c] !== ' ' && (l.slice(c - 2, c) === '  ' || !l.slice(0, c).trim());
    const fits = (l: string) => l.length <= c - 2 || rightAt(l);
    const left: string[] = [];
    const right: string[] = [];
    let p = i;
    let end = i;
    while (p < lines.length && !blank(lines[p])) {
      let e = p;
      while (!blank(lines[e])) e++;
      const para = lines.slice(p, e);
      // The stretch ends at a paragraph that crosses the gutter or has nothing in the right column.
      if (!para.every(fits) || !para.some(rightAt)) break;
      for (const l of para) {
        left.push(l.slice(0, c).replace(/\s+$/, ''));
        if (rightAt(l)) right.push(l.slice(c).trim());
      }
      left.push('');
      right.push('');
      end = e;
      p = e;
      while (p < lines.length && lines[p] !== '\f' && !lines[p]!.trim()) p++;
    }
    if (end === i || right.filter((l) => l).length < 2) {
      out.push(lines[i++]!);
      continue;
    }
    out.push(...left.filter((l) => l.trim() || l === ''), ...right);
    i = end;
  }
  return out;
}

const PAGE_NUM = /^\s*(?:page\s*\d+(?:\s*(?:of|\/)\s*\d+)?|[-–—]\s*\d{1,3}\s*[-–—]|\d{1,3}\s*\/\s*\d{1,3})\s*$/i;
const TRAILING_PAGE = /\s{2,}(?:page\s*\d+(?:\s*(?:of|\/)\s*\d+)?)\s*$/i;
const QUESTION_LIKE = /^\s*(?:\(?[A-Fa-f][.)]|\d{1,3}\s*[.)]|q(?:uestion)?\s*\d|#\s*\d|\([a-z]+\))/i;

/** Line-level cleanup. Returns cleaned lines with page breaks dropped and running headers/footers removed. */
export function cleanLines(text: string, pages?: string[]): { lines: string[]; removed: string[] } {
  const source = pages && pages.length ? pages.join('\n\f\n') : text;
  const raw = splitTextColumns(source.replace(/\r\n?/g, '\n').replace(/\f/g, '\n\f\n').split('\n').map((l) => (l === '\f' ? l : fixLostExponents(cleanChars(l)).replace(/\s+$/, ''))));
  const removed: string[] = [];

  // Running headers/footers: the same non-question line (digits ignored) on three or more pages/places.
  const key = (l: string) => l.trim().toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ');
  // Only lines within two non-empty lines of a page edge can be running headers/footers.
  const nearEdge = new Set<number>();
  let pageMarkAt = (_j: number) => false;
  const markFrom = (start: number, step: number) => {
    for (let j = start, n = 0; j >= 0 && j < raw.length && n < 2; j += step) {
      if (raw[j] === '\f' || (start !== j && pageMarkAt(j))) break;
      if (pageMarkAt(j)) continue;
      if (raw[j]!.trim()) {
        nearEdge.add(j);
        n++;
      }
    }
  };
  markFrom(0, 1);
  markFrom(raw.length - 1, -1);
  // Without form feeds (pasted or plain-text exports), "Page 2 of 3" / "- 2 -" lines mark the page breaks.
  const hasFeeds = raw.includes('\f');
  const pageMarks = hasFeeds ? [] : raw.map((l, j) => (l !== '\f' && (PAGE_NUM.test(l) || TRAILING_PAGE.test(l)) ? j : -1)).filter((j) => j >= 0);
  pageMarkAt = (j: number) => pageMarks.includes(j);
  const isBreak = (j: number) => raw[j] === '\f' || pageMarks.includes(j);
  raw.forEach((_, j) => {
    if (isBreak(j)) {
      markFrom(j - 1, -1);
      markFrom(j + 1, 1);
    }
  });
  const counts = new Map<string, number>();
  raw.forEach((l, j) => {
    if (nearEdge.has(j) && l.trim().length >= 8 && !QUESTION_LIKE.test(l)) counts.set(key(l), (counts.get(key(l)) ?? 0) + 1);
  });
  const lastMark = pageMarks[pageMarks.length - 1] ?? -1;
  const pageCount = hasFeeds ? raw.filter((l) => l === '\f').length + 1 : pageMarks.length + (raw.slice(lastMark + 1).some((l) => l.trim()) ? 1 : 0);
  // A running header is kept once only when it opens the document (a title); repeats among questions go.
  const firstQuestion = raw.findIndex((l) => l !== '\f' && /^\s*(?:q(?:uestion)?\s*)?\d{1,3}\s*[.)]\s/i.test(l));
  const threshold = Math.max(2, Math.ceil(pageCount * 0.6));
  const seen = new Set<string>();

  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    let l = raw[i]!;
    if (l === '\f') {
      out.push('');
      continue;
    }
    if (PAGE_NUM.test(l)) {
      removed.push(l.trim());
      continue;
    }
    // A bare number alone between blank lines (or page edges) is a page number, not content.
    if (/^\s*\d{1,3}\s*$/.test(l)) {
      const prev = raw[i - 1], next = raw[i + 1];
      const edge = (x: string | undefined) => x === undefined || x === '\f' || !x.trim();
      if (edge(prev) && edge(next)) {
        removed.push(l.trim());
        continue;
      }
    }
    if (TRAILING_PAGE.test(l)) {
      // "Algebra 2 – Unit 4 Test        Page 2 of 4" is a footer as a whole.
      removed.push(l.trim());
      continue;
    }
    const k = key(l);
    if (nearEdge.has(i) && l.trim().length >= 8 && (counts.get(k) ?? 0) >= threshold && !/_{2,}/.test(l)) {
      if (seen.has(k) || (firstQuestion >= 0 && i > firstQuestion)) {
        removed.push(l.trim());
        continue;
      }
      seen.add(k);
    }
    // Repeated "Name: ____" headers on later pages.
    if (/_{2,}/.test(l) && /\b(?:name|date|period)\b/i.test(l)) {
      const hk = 'hdr:' + k;
      if (seen.has(hk)) {
        removed.push(l.trim());
        continue;
      }
      seen.add(hk);
    }
    // Hyphenated word broken across lines.
    const nextLine = raw[i + 1];
    if (/[a-z]-$/.test(l) && nextLine && /^[a-z]/.test(nextLine)) {
      l = l.slice(0, -1) + nextLine.trim();
      i++;
    }
    out.push(l);
  }
  return { lines: out, removed };
}

/** Collapses whitespace, used for prompts assembled from broken lines. */
export const squash = (s: string) => s.replace(/\s+/g, ' ').replace(/\s+([.,;:?])(?=\s|$)/g, '$1').trim();

/** Math text → something math-core parses: minus, times, divide, superscripts. */
export function toCalc(s: string): string {
  return cleanChars(s).replace(/×|·/g, '*').replace(/÷/g, '/').replace(/π/g, 'pi');
}

/** Display form with a typographic minus (Lemma's practice prompts use "−"). */
export const pretty = (s: string) => s.replace(/(^|[\s(=,^])-(?=[\d.a-z(√π])/gi, '$1−').replace(/ - /g, ' − ');
