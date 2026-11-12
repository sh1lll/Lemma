/** Named matrices, saved on this device (and included in encrypted sync as the "matrices" collection). */
export interface StoredMatrix {
  id: string;
  name: string;
  /** Entries as typed ("1/2", "-3", "sqrt(2)"); "" is 0. */
  rows: string[][];
  updated: number;
}

export const MATRICES_KEY = 'lemma.matrices.v1';
export const MAX_SIZE = 10;
export const NAMES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter((n) => n !== 'T');

export function loadMatrices(): StoredMatrix[] {
  try {
    const raw = JSON.parse(localStorage.getItem(MATRICES_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (m): m is StoredMatrix =>
        !!m && typeof m === 'object' && typeof (m as StoredMatrix).name === 'string' && Array.isArray((m as StoredMatrix).rows) && (m as StoredMatrix).rows.every((r) => Array.isArray(r)),
    );
  } catch {
    return [];
  }
}

export function saveMatrices(list: StoredMatrix[]): boolean {
  try {
    localStorage.setItem(MATRICES_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function nextName(list: StoredMatrix[]): string | null {
  const used = new Set(list.map((m) => m.name));
  return NAMES.find((n) => !used.has(n)) ?? null;
}

/** Resizes, keeping what fits. */
export function resize(rows: string[][], r: number, c: number): string[][] {
  return Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => rows[i]?.[j] ?? ''));
}

/** Spreadsheet or plain text → rows of entries: tabs, commas, semicolons or spaces between, one row per line. */
export function parseGrid(text: string): string[][] | null {
  const lines = text
    .replace(/\r/g, '')
    .replace(/^\s*\[\[|\]\]\s*$/g, '')
    .split(/\n|\]\s*,?\s*\[|;/)
    .map((l) => l.replace(/[[\]]/g, '').trim())
    .filter(Boolean);
  if (!lines.length) return null;
  const split = (l: string) => (l.includes('\t') ? l.split('\t') : l.includes(',') ? l.split(',') : l.split(/\s+/)).map((x) => x.trim());
  const out = lines.map(split);
  if (out.length === 1 && out[0]!.length === 1) return null; // a single value: ordinary paste
  const width = Math.max(...out.map((r) => r.length));
  return out.map((r) => Array.from({ length: width }, (_, j) => r[j] ?? ''));
}
