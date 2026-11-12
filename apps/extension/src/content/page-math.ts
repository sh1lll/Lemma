import { cellNumber, convertInlineLatex, latexToInput } from '../core/latex';
import type { SelectionInfo } from '../core/messages';

/**
 * Page awareness, run only when the user invokes an action: reads the current selection and turns page
 * math (MathML, KaTeX/MathJax source, $…$ LaTeX) into Lemma input, and spots a selected table column.
 */

const MO: Record<string, string> = { '−': '-', '×': '*', '⋅': '*', '·': '*', '∗': '*', '÷': '/', '⁢': '', '⁡': '', '⁣': ',', '≤': '<=', '≥': '>=', '≠': '!=' };

export function mathmlToInput(el: Element): string {
  const kids = () => [...el.children].map(mathmlToInput);
  const name = el.localName.toLowerCase();
  switch (name) {
    case 'annotation':
    case 'annotation-xml':
    case 'mphantom':
      return '';
    case 'semantics': {
      const first = el.children[0];
      return first ? mathmlToInput(first) : '';
    }
    case 'mi':
    case 'mn':
    case 'mtext':
      return (el.textContent ?? '').trim();
    case 'mo': {
      const t = (el.textContent ?? '').trim();
      return MO[t] ?? t;
    }
    case 'mfrac': {
      const [a = '', b = ''] = kids();
      return `(${a})/(${b})`;
    }
    case 'msqrt':
      return `sqrt(${kids().join('')})`;
    case 'mroot': {
      const [a = '', n = ''] = kids();
      return `(${a})^(1/(${n}))`;
    }
    case 'msup': {
      const [a = '', b = ''] = kids();
      return `${a}^${/^\w$/.test(b) ? b : `(${b})`}`;
    }
    case 'msub':
      return kids()[0] ?? '';
    case 'msubsup': {
      const [a = '', , c = ''] = kids();
      return `${a}^(${c})`;
    }
    case 'mfenced': {
      const open = el.getAttribute('open') ?? '(';
      const close = el.getAttribute('close') ?? ')';
      return `${open}${kids().join(el.getAttribute('separators') ?? ',')}${close}`;
    }
    default:
      return kids().join('');
  }
}

/** LaTeX or MathML attached to rendered math (KaTeX, MathJax 2/3, Wikipedia), as Lemma input. */
function mathFrom(root: ParentNode): { query: string; source: SelectionInfo['source'] } | null {
  const parts: string[] = [];
  let source: SelectionInfo['source'] = 'tex';
  // KaTeX and MathJax-with-semantics keep the TeX source in an annotation.
  const anns = root.querySelectorAll('annotation[encoding="application/x-tex"]');
  if (anns.length) {
    for (const a of anns) parts.push(latexToInput(a.textContent ?? ''));
    return { query: parts.join(' '), source };
  }
  const scripts = root.querySelectorAll('script[type^="math/tex"]');
  if (scripts.length) {
    for (const s of scripts) parts.push(latexToInput(s.textContent ?? ''));
    return { query: parts.join(' '), source };
  }
  const maths = root.querySelectorAll('math');
  if (maths.length) {
    for (const m of maths) {
      const alt = m.getAttribute('alttext');
      if (alt) parts.push(latexToInput(alt));
      else {
        parts.push(mathmlToInput(m));
        source = 'mathml';
      }
    }
    return { query: parts.join(' '), source };
  }
  const imgs = root.querySelectorAll('img.mwe-math-fallback-image-inline, img.mwe-math-fallback-image-display, img[data-latex]');
  if (imgs.length) {
    for (const i of imgs) parts.push(latexToInput(i.getAttribute('data-latex') ?? i.getAttribute('alt') ?? ''));
    return { query: parts.join(' '), source };
  }
  return null;
}

const MATH_HOST = '.katex, .katex-display, mjx-container, .MathJax, .MathJax_Display, math, .mwe-math-element';

function cleanText(t: string): string {
  return t
    .replace(/[   ]/g, ' ')
    .replace(/[−–]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

const cellOf = (n: Node): HTMLTableCellElement | null => (n.nodeType === 1 ? (n as Element) : n.parentElement)?.closest('td, th') ?? null;

/**
 * A selected table column: the header cell alone ("this column"), a drag from one cell down to another in
 * the same column, or (Firefox) Ctrl-selected cells of one column.
 */
function columnOf(sel: Selection): SelectionInfo['column'] | null {
  const ranges = Array.from({ length: sel.rangeCount }, (_, i) => sel.getRangeAt(i));
  let picked: HTMLTableCellElement[] = [];
  for (const r of ranges) {
    const a = cellOf(r.startContainer);
    const b = cellOf(r.endContainer);
    if (!a || !b) return null;
    picked.push(a);
    if (b !== a) picked.push(b);
  }
  const table = picked[0]?.closest('table');
  if (!table || picked.some((c) => c.closest('table') !== table)) return null;
  const col = picked[0]!.cellIndex;
  if (picked.some((c) => c.cellIndex !== col)) return null;
  const rowsAll = [...table.rows];
  const rowIdx = (c: HTMLTableCellElement) => rowsAll.indexOf(c.parentElement as HTMLTableRowElement);
  const wholeColumn = picked.length === 1 && picked[0]!.localName === 'th';
  if (picked.length === 1 && !wholeColumn) return null;
  // A drag covers every row between its two ends.
  if (ranges.length === 1 && picked.length === 2) {
    const [r0, r1] = [rowIdx(picked[0]!), rowIdx(picked[1]!)].sort((x, y) => x - y) as [number, number];
    picked = rowsAll.slice(r0, r1 + 1).map((r) => r.cells[col]).filter((c): c is HTMLTableCellElement => !!c);
  }
  let label = '';
  const values: number[] = [];
  for (const row of rowsAll) {
    const cell = row.cells[col];
    if (!cell) continue;
    const text = cleanText(cell.textContent ?? '');
    const v = cell.localName === 'th' ? null : cellNumber(text);
    if (v === null) {
      if (!values.length && text && !label) label = text;
      continue;
    }
    if (wholeColumn || picked.includes(cell)) values.push(v);
  }
  if (!values.length) return null;
  return { label, values };
}

export function readSelection(): SelectionInfo {
  const sel = getSelection();
  const text = cleanText(sel?.toString() ?? '');
  const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  if (!range) return { text, query: text, source: 'text' };

  const column = sel ? columnOf(sel) : null;
  if (column && column.values.length > 1) return { text, query: text, source: 'table', column };

  // A selection inside one rendered formula: use the whole formula's source.
  const anc = range.commonAncestorContainer;
  const host = (anc.nodeType === 1 ? (anc as Element) : anc.parentElement)?.closest(MATH_HOST);
  if (host) {
    const top = host.closest('.katex-display') ?? host.closest('.katex') ?? host;
    const m = mathFrom(top) ?? (top.localName === 'math' ? { query: mathmlToInput(top), source: 'mathml' as const } : null);
    if (m?.query) return { text, ...m, query: cleanText(m.query) };
  }

  // A selection spanning prose with formulas: replace each formula by its source.
  const frag = range.cloneContents();
  const wrap = document.createElement('div');
  wrap.append(frag);
  if (wrap.querySelector(MATH_HOST)) {
    for (const f of [...wrap.querySelectorAll('.katex, mjx-container, .MathJax, math, .mwe-math-element')]) {
      if (!f.isConnected || !wrap.contains(f)) continue;
      const m = mathFrom(f) ?? (f.localName === 'math' ? { query: mathmlToInput(f), source: 'mathml' as const } : null);
      if (m) f.replaceWith(` ${m.query} `);
    }
    for (const s of [...wrap.querySelectorAll('script, .MathJax_Preview, mjx-assistive-mml')]) s.remove();
    const q = cleanText(wrap.textContent ?? '');
    if (q) return { text, query: q, source: 'tex' };
  }

  const latex = convertInlineLatex(text);
  if (latex) return { text, query: cleanText(latex), source: 'latex' };
  return { text, query: text, source: 'text' };
}
