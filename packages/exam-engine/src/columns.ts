/**
 * Two-column PDF pages. pdf.js gives text items with positions; grouping them by baseline alone reads a
 * two-column test straight across ("1. What is the area…    2. Find the slope…"). This finds a vertical gutter
 * that no item crosses and, for each stretch of rows that stays on its own side of it, reads the left column
 * and then the right. Only stretches where a numbered question starts in the right column are split, so
 * answer choices laid out side by side ("A. 6π      B. 9π") stay on one line.
 */

export interface LayoutPart {
  x: number;
  w: number;
  s: string;
}

export interface LayoutRow {
  y: number;
  h: number;
  parts: LayoutPart[];
  /** Set on the first row of a right column: the reader should start a new paragraph there. */
  gap?: boolean;
}

const QUESTION_START = /^\s*(?:q(?:uestion)?\s*)?\d{1,3}\s*[.)]/i;

/** Rows (top to bottom) in reading order, with two-column stretches read column by column. */
export function orderColumns<R extends LayoutRow>(rows: R[]): R[] {
  const parts = rows.flatMap((r) => r.parts);
  if (rows.length < 3 || !parts.length) return rows;
  const minX = Math.min(...parts.map((p) => p.x));
  const maxX = Math.max(...parts.map((p) => p.x + p.w));
  const width = maxX - minX;
  if (!(width > 0)) return rows;

  const crosses = (r: R, g: number) => r.parts.some((p) => p.x < g - 0.5 && p.x + p.w > g + 0.5);
  const sides = (r: R, g: number) => {
    const left = r.parts.filter((p) => p.x + p.w <= g + 0.5).sort((a, b) => a.x - b.x);
    const right = r.parts.filter((p) => p.x >= g - 0.5).sort((a, b) => a.x - b.x);
    return { left, right };
  };

  // Best gutter: most rows with a question starting right of it, then most rows with text on both sides.
  let best: { g: number; q: number; both: number } | null = null;
  for (let k = 30; k <= 70; k++) {
    const g = minX + (width * k) / 100;
    let q = 0;
    let both = 0;
    for (const r of rows) {
      if (crosses(r, g)) continue;
      const { left, right } = sides(r, g);
      if (left.length && right.length) both++;
      if (right.length && QUESTION_START.test(right[0]!.s + (right[1]?.s ?? ''))) q++;
    }
    if (q >= 1 && both >= 2 && (!best || q > best.q || (q === best.q && both > best.both))) best = { g, q, both };
  }
  if (!best) return rows;
  const g = best.g;

  const out: R[] = [];
  let i = 0;
  while (i < rows.length) {
    if (crosses(rows[i]!, g)) {
      out.push(rows[i++]!);
      continue;
    }
    let j = i;
    while (j < rows.length && !crosses(rows[j]!, g)) j++;
    let stretch = rows.slice(i, j);
    // Rows above the first right-column question (a "Name: … Date: …" line) stay as they are.
    const startsQ = (r: R) => {
      const { right } = sides(r, g);
      return right.length > 0 && QUESTION_START.test(right[0]!.s + (right[1]?.s ?? ''));
    };
    const first = stretch.findIndex(startsQ);
    if (first > 0) {
      out.push(...stretch.slice(0, first));
      stretch = stretch.slice(first);
    }
    const split = stretch.map((r) => ({ r, ...sides(r, g) }));
    const twoColumn = first >= 0 && split.filter((x) => x.left.length && x.right.length).length >= 2;
    if (!twoColumn) out.push(...stretch);
    else {
      for (const x of split) if (x.left.length) out.push({ ...x.r, parts: x.left, gap: false });
      split.filter((x) => x.right.length).forEach((x, k) => out.push({ ...x.r, parts: x.right, gap: k === 0 }));
    }
    i = j;
  }
  return out;
}
