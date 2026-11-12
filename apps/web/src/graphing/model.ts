import type { Alt, InferTest, Viewport } from '@lemma/graph-engine';
import { DEFAULT_SETTINGS, type ItemStyle, type ViewSettings } from '../graph/view';

/** The graphing workspace's saved state: rows of six kinds, graph settings, 2D or 3D, and the window. */

export interface RowStyle extends ItemStyle {
  /** A flat curve swept along z in the 3D view. */
  extend3d?: boolean;
}

export interface SliderOpts {
  min: number;
  max: number;
  step: number;
  /** Multiplier on the base pace (one sweep in about four seconds). */
  speed: number;
  mode: 'loop' | 'bounce' | 'once';
}

interface Base {
  id: number;
  color: number;
  hidden: boolean;
  folder?: number | null;
  style?: RowStyle;
}

export type ExprRow = Base & { type: 'expr'; text: string; slider?: SliderOpts };
export type NoteRow = Base & { type: 'note'; text: string };
export type TableRow = Base & { type: 'table'; cols: { name: string; values: (number | null)[] }[]; connect: boolean };
export type InferRow = Base & {
  type: 'infer';
  test: InferTest;
  mode: 'test' | 'interval';
  input: 'stats' | 'data';
  data: string;
  data2: string;
  stats: Record<string, string>;
  h0: string;
  alt: Alt;
  level: string;
};
export type FolderRow = Base & { type: 'folder'; title: string; collapsed: boolean };
export type ImageRow = Base & { type: 'image'; name: string; key: string; x: number; y: number; w: number; h: number; opacity: number };
export type RowState = ExprRow | NoteRow | TableRow | InferRow | FolderRow | ImageRow;
export type RowType = RowState['type'];

export interface State {
  v: 2;
  rows: RowState[];
  settings: ViewSettings;
  dim: '2d' | '3d';
  view?: Viewport;
}

export const KEY_V1 = 'lemma.graphing.v1';
export const KEY = 'lemma.graphing.v2';

export function emptyState(): State {
  return { v: 2, rows: [{ id: 1, type: 'expr', text: '', color: 0, hidden: false }], settings: { ...DEFAULT_SETTINGS }, dim: '2d' };
}

/** Checks and repairs a state read from storage or a link; null when it isn't one. */
export function sanitize(raw: unknown): State | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<State> & { rows?: unknown[] };
  if (!Array.isArray(s.rows)) return null;
  const rows: RowState[] = [];
  let id = 1;
  const seen = new Set<number>();
  for (const r of s.rows.slice(0, 200)) {
    if (!r || typeof r !== 'object') continue;
    const row = r as RowState & { text?: unknown };
    const type = (row.type ?? 'expr') as RowType;
    if (!['expr', 'note', 'table', 'infer', 'folder', 'image'].includes(type)) continue;
    let rid = Number.isInteger(row.id) && !seen.has(row.id) ? row.id : 0;
    while (!rid || seen.has(rid)) rid = id++;
    seen.add(rid);
    const base = { id: rid, color: Number.isInteger(row.color) ? row.color : 0, hidden: !!row.hidden, folder: typeof row.folder === 'number' ? row.folder : null, style: row.style && typeof row.style === 'object' ? row.style : undefined };
    if (type === 'expr') rows.push({ ...base, type, text: typeof row.text === 'string' ? row.text.slice(0, 2000) : '', slider: (row as ExprRow).slider });
    else if (type === 'note') rows.push({ ...base, type, text: typeof row.text === 'string' ? row.text.slice(0, 5000) : '' });
    else if (type === 'table') {
      const t = row as TableRow;
      const cols = Array.isArray(t.cols) ? t.cols.slice(0, 12).map((c) => ({ name: String(c?.name ?? 'x_1').slice(0, 20), values: Array.isArray(c?.values) ? c.values.slice(0, 1000).map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)) : [] })) : [];
      rows.push({ ...base, type, cols: cols.length ? cols : [{ name: 'x₁', values: [] }, { name: 'y₁', values: [] }], connect: !!t.connect });
    } else if (type === 'infer') {
      const t = row as InferRow;
      rows.push({
        ...base,
        type,
        test: (['t1', 'z1', 't2', 'p1'] as const).includes(t.test) ? t.test : 't1',
        mode: t.mode === 'interval' ? 'interval' : 'test',
        input: t.input === 'data' ? 'data' : 'stats',
        data: String(t.data ?? ''),
        data2: String(t.data2 ?? ''),
        stats: t.stats && typeof t.stats === 'object' ? Object.fromEntries(Object.entries(t.stats).map(([k, v]) => [k, String(v)])) : {},
        h0: String(t.h0 ?? '0'),
        alt: (['ne', 'lt', 'gt'] as const).includes(t.alt) ? t.alt : 'ne',
        level: String(t.level ?? '0.95'),
      });
    } else if (type === 'folder') rows.push({ ...base, folder: null, type, title: String((row as FolderRow).title ?? 'Folder').slice(0, 200), collapsed: !!(row as FolderRow).collapsed });
    else if (type === 'image') {
      const t = row as ImageRow;
      const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
      rows.push({ ...base, type, name: String(t.name ?? '').slice(0, 200), key: String(t.key ?? ''), x: num(t.x, 0), y: num(t.y, 0), w: num(t.w, 10), h: num(t.h, 10), opacity: Math.min(1, Math.max(0, num(t.opacity, 0.6))) });
    }
  }
  if (!rows.length) rows.push({ id: 1, type: 'expr', text: '', color: 0, hidden: false });
  // Folder members must name a folder that exists.
  const folders = new Set(rows.filter((r) => r.type === 'folder').map((r) => r.id));
  for (const r of rows) if (r.folder != null && !folders.has(r.folder)) r.folder = null;
  const settings = { ...DEFAULT_SETTINGS, ...(s.settings && typeof s.settings === 'object' ? s.settings : {}) };
  const v = s.view;
  const view = v && [v.xMin, v.xMax, v.yMin, v.yMax].every((n) => typeof n === 'number' && Number.isFinite(n)) && v.xMax > v.xMin && v.yMax > v.yMin ? v : undefined;
  return { v: 2, rows: order(rows), settings, dim: s.dim === '3d' ? '3d' : '2d', view };
}

/** Each folder is followed by its members; other rows keep their places. */
export function order(rows: RowState[]): RowState[] {
  const out: RowState[] = [];
  for (const r of rows) {
    if (r.folder != null) continue;
    out.push(r);
    if (r.type === 'folder') for (const m of rows) if (m.folder === r.id) out.push(m);
  }
  return out;
}

export function load(): State {
  try {
    const v2 = sanitize(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
    if (v2) return v2;
    const v1 = JSON.parse(localStorage.getItem(KEY_V1) ?? 'null') as { rows?: { text: string; color: number; hidden: boolean }[] } | null;
    if (v1?.rows?.length) return sanitize({ rows: v1.rows.map((r) => ({ type: 'expr', ...r })) }) ?? emptyState();
  } catch {
    // Unreadable: start fresh.
  }
  return emptyState();
}

export function save(s: State): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    // Older builds read v1; keep the expression rows there too.
    localStorage.setItem(KEY_V1, JSON.stringify({ rows: s.rows.filter((r) => r.type === 'expr').map((r) => ({ text: (r as ExprRow).text, color: r.color, hidden: r.hidden })) }));
  } catch {
    // Storage unavailable: the rows last for this visit.
  }
}
