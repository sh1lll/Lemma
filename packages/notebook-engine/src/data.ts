/** Parses pasted or imported tabular data (CSV, TSV, semicolon or whitespace separated). */

export interface DataTable {
  columns: string[];
  rows: string[][];
  /** Numeric columns by identifier-safe name. */
  numeric: Map<string, number[]>;
}

function splitLine(line: string, sep: string): string[] {
  // Delimited text with quoted fields: "a, b",c  /  "1,200";3
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === sep && !quoted) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const NUMBER = /^[-+]?(?:\d[\d,]*\.?\d*|\.\d+)(?:e[-+]?\d+)?%?$/i;
const toNumber = (s: string) => {
  const t = s.replace(/[$€£¥₹\s]/g, '');
  if (!NUMBER.test(t)) return NaN;
  const n = Number(t.replace(/,/g, '').replace(/%$/, ''));
  return t.endsWith('%') ? n / 100 : n;
};

/** "Height (cm)" → "height_cm". Identifiers must start with a letter and avoid single letters (those are variables). */
export function columnName(header: string, i: number, taken: Set<string>): string {
  let n = header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!/^[a-z]/.test(n)) n = `col${i + 1}${n ? `_${n}` : ''}`;
  if (n.length === 1) n = `${n}_col`;
  let unique = n;
  for (let k = 2; taken.has(unique); k++) unique = `${n}_${k}`;
  taken.add(unique);
  return unique;
}

export function parseTable(text: string): DataTable {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim());
  if (!lines.length) return { columns: [], rows: [], numeric: new Map() };
  const first = lines[0]!;
  const sep = first.includes('\t') ? '\t' : first.includes(';') && !first.includes(',') ? ';' : first.includes(',') ? ',' : /\s{2,}|\s/.test(first.trim()) ? ' ' : ',';
  const grid = lines.map((l) => (sep === ' ' ? l.trim().split(/\s+/) : splitLine(l, sep)));
  const headerRow = grid[0]!.some((c) => c && Number.isNaN(toNumber(c)));
  const width = Math.max(...grid.map((r) => r.length));
  const taken = new Set<string>();
  const headers = headerRow ? grid[0]! : Array.from({ length: width }, (_v, i) => `col${i + 1}`);
  const columns = Array.from({ length: width }, (_v, i) => columnName(headers[i] ?? '', i, taken));
  const rows = (headerRow ? grid.slice(1) : grid).map((r) => Array.from({ length: width }, (_v, i) => r[i] ?? ''));
  const numeric = new Map<string, number[]>();
  columns.forEach((name, i) => {
    const vals = rows.map((r) => toNumber(r[i]!));
    const present = vals.filter((v) => !Number.isNaN(v));
    // A column counts as numeric when every non-empty cell is a number.
    if (present.length && present.length === rows.filter((r) => r[i]!.trim()).length) numeric.set(name, present);
  });
  return { columns, rows, numeric };
}
