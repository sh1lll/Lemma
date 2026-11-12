import type { CellOutput, Notebook } from './types';

/** Creating, validating, exporting and importing notebooks. */

const id = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function newNotebook(title = 'Untitled notebook'): Notebook {
  const now = Date.now();
  return { version: 1, id: id(), title, angle: 'rad', cells: [{ id: id(), type: 'math', source: '' }], created: now, updated: now };
}

export const newCellId = id;

/** Accepts only well-formed notebooks (imports are untrusted files). */
export function parseNotebook(json: string): Notebook {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('That file isn’t valid JSON');
  }
  const n = raw as Partial<Notebook> & { format?: string };
  if (!n || typeof n !== 'object' || n.version !== 1 || !Array.isArray(n.cells)) throw new Error('That file isn’t an Lemma notebook');
  const cells = n.cells.slice(0, 2000).map((c) => {
    const cell = c as { type?: unknown; source?: unknown };
    if (!['math', 'text', 'data'].includes(cell.type as string) || typeof cell.source !== 'string') throw new Error('The notebook has an invalid cell');
    return { id: id(), type: cell.type as Notebook['cells'][number]['type'], source: cell.source.slice(0, 200_000) };
  });
  const now = Date.now();
  return {
    version: 1,
    id: id(),
    title: typeof n.title === 'string' && n.title.trim() ? n.title.slice(0, 200) : 'Imported notebook',
    angle: n.angle === 'deg' ? 'deg' : 'rad',
    cells: cells.length ? cells : [{ id: id(), type: 'math', source: '' }],
    created: now,
    updated: now,
  };
}

export function serializeNotebook(nb: Notebook): string {
  return JSON.stringify({ format: 'lemma-notebook', ...nb, cells: nb.cells.map(({ type, source }) => ({ type, source })) }, null, 2);
}

/** Markdown with inputs and results, for sharing in docs, chats and repositories. */
export function notebookToMarkdown(nb: Notebook, outputs: Map<string, CellOutput[]>): string {
  const out: string[] = [`# ${nb.title}`, ''];
  for (const cell of nb.cells) {
    if (cell.type === 'text') {
      out.push(cell.source, '');
      continue;
    }
    if (cell.type === 'data') {
      const t = outputs.get(cell.id)?.[0]?.table;
      if (t) {
        out.push(`| ${t.columns.join(' | ')} |`, `|${t.columns.map(() => ' --- ').join('|')}|`, ...t.rows.map((r) => `| ${r.join(' | ')} |`), '');
      }
      continue;
    }
    for (const o of outputs.get(cell.id) ?? []) {
      const result = o.kind === 'error' ? `⚠ ${o.error}` : o.kind === 'graph' ? '(graph)' : `${o.display ?? ''}${o.unit ? ` ${o.unit}` : ''}`;
      out.push('```', o.input, '```', `→ **${result.replace(/\n/g, ' ')}**${o.verified?.ok ? ' ✓' : ''}`);
      for (const l of o.lines ?? []) out.push(`- ${l.label}: ${l.display}`);
      if (o.latex?.length) out.push('', ...o.latex.map((x) => `$$${x}$$`));
      out.push('');
    }
  }
  out.push(`_Exported from Lemma, ${new Date(nb.updated).toISOString().slice(0, 10)}_`);
  return out.join('\n');
}
