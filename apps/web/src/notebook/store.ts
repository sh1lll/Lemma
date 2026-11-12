import { newNotebook, type Notebook } from '@lemma/notebook-engine';

/** Notebooks live in local storage: an index plus one key per notebook. */
const INDEX = 'lemma.notebooks.v1';
const KEY = (id: string) => `lemma.notebook.${id}`;

export interface NotebookMeta {
  id: string;
  title: string;
  updated: number;
}

const read = <T>(k: string): T | null => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
};

export function listNotebooks(): NotebookMeta[] {
  return (read<NotebookMeta[]>(INDEX) ?? []).sort((a, b) => b.updated - a.updated);
}

export function loadNotebook(id: string): Notebook | null {
  return read<Notebook>(KEY(id));
}

/** Returns false when storage is full or unavailable, so the UI can tell the user to export. */
export function saveNotebook(nb: Notebook): boolean {
  try {
    localStorage.setItem(KEY(nb.id), JSON.stringify(nb));
    const index = listNotebooks().filter((m) => m.id !== nb.id);
    index.push({ id: nb.id, title: nb.title, updated: nb.updated });
    localStorage.setItem(INDEX, JSON.stringify(index));
    return true;
  } catch {
    return false;
  }
}

export function deleteNotebook(id: string): void {
  try {
    localStorage.removeItem(KEY(id));
    localStorage.setItem(INDEX, JSON.stringify(listNotebooks().filter((m) => m.id !== id)));
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

/** The most recently edited notebook, or a starter one. */
export function openLatest(): Notebook {
  const latest = listNotebooks()[0];
  return (latest && loadNotebook(latest.id)) ?? starter();
}

/**
 * A new notebook starts in the calculator's angle mode: an answer saved in degrees ("sin(30) = 0.5") and filed
 * into a fresh notebook must not come out in radians (−0.988). Each notebook keeps its own mode after that.
 */
export function blankNotebook(title?: string): Notebook {
  const nb = newNotebook(title);
  nb.angle = read<{ angle?: string }>('lemma.settings.v1')?.angle === 'rad' ? 'rad' : 'deg';
  return nb;
}

export function starter(): Notebook {
  const nb = blankNotebook('My first notebook');
  const c = (type: Notebook['cells'][number]['type'], source: string) => ({ id: Math.random().toString(36).slice(2, 10), type, source });
  nb.cells = [
    c('text', '**Notebooks** keep a whole investigation in one place. Names defined in a cell work in every cell below, and editing a cell updates everything after it.'),
    c('math', 'f(x) = x^2 + 3x\ndf(x) = derivative of f(x)'),
    c('math', 'solve df(x) = 0\nf(-1.5)'),
    c('math', 'graph f(x), df(x)'),
    c('data', 'day,temperature\nMon,18\nTue,21\nWed,19\nThu,24\nFri,23'),
    c('math', 'mean of temperature\nstd dev of temperature'),
  ];
  return nb;
}
