/**
 * Study notes. Quick captures ("note: chain rule is f'(g(x))·g'(x)") and saved answers (question, result and
 * steps), with math typeset inline. A note can be filed into a notebook as a text cell. Voice notes arrive as
 * transcripts; audio is never stored. Timers are handled here too because the same commands manage both.
 */

export interface Note {
  id: string;
  text: string;
  tags: string[];
  at: number;
  updated: number;
  /** Set when the note was saved from an answer. */
  saved?: { question: string; result: string; steps?: { text: string; tex?: string }[] };
}

const KEY = 'lemma.notes.v1';
const read = (): Note[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Note[];
  } catch {
    return [];
  }
};
const uid = () => Math.random().toString(36).slice(2, 10);

export interface NotesHost {
  root: HTMLElement;
  toast: (msg: string) => void;
  startTimer: (seconds: number, label: string) => void;
  cancelTimers: (match?: string, all?: boolean) => number;
}

type Action = { type: string; [k: string]: unknown };

/** Splits note text into prose and math runs: "chain rule is f'(g(x))·g'(x)" → prose "chain rule is", math "f'(g(x))·g'(x)". */
export function splitMath(text: string): { math: boolean; text: string }[] {
  const tokens = text.split(/(\s+)/);
  const mathy = (t: string) =>
    /[=^'·×÷√∫∑π≤≥≠±]|[a-z]\(|\d[a-z]|[a-z]\d|^[+\-*/<>]$|^\(|\)$/i.test(t) || /^-?\d+(?:[./]\d+)?$/.test(t) || /^[a-z]$/i.test(t);
  const runs: { math: boolean; text: string }[] = [];
  for (const t of tokens) {
    if (!t) continue;
    const space = /^\s+$/.test(t);
    const m = space ? (runs.at(-1)?.math ?? false) : mathy(t);
    const last = runs.at(-1);
    if (last && last.math === m) last.text += t;
    else runs.push({ math: m, text: t });
  }
  // A lone letter or number inside prose ("a", "I", "7") stays prose.
  for (const r of runs) if (r.math && /^\s*(?:[a-z]|\d+)\s*$/i.test(r.text)) r.math = false;
  const merged: typeof runs = [];
  for (const r of runs) {
    const last = merged.at(-1);
    if (last && last.math === r.math) last.text += r.text;
    else merged.push({ ...r });
  }
  return merged;
}

/** Light plain-math → TeX: "x^2·sin(x)" → "x^{2}\cdot \sin(x)". */
export function toTex(s: string): string {
  return s
    .trim()
    .replace(/\^\(([^()]*)\)/g, '^{$1}')
    .replace(/\^(-?[\w.]+)/g, '^{$1}')
    .replace(/sqrt\(([^()]*)\)/g, '\\sqrt{$1}')
    .replace(/[·*×]/g, '\\cdot ')
    .replace(/÷/g, '\\div ')
    .replace(/∫/g, '\\int ')
    .replace(/π|\bpi\b/g, '\\pi ')
    .replace(/≤/g, '\\le ')
    .replace(/≥/g, '\\ge ')
    .replace(/≠/g, '\\ne ')
    .replace(/±/g, '\\pm ')
    .replace(/\b(sin|cos|tan|ln|log|exp)\b/g, '\\$1');
}

export class StudyNotes {
  notes: Note[] = read();

  constructor(private host: NotesHost) {
    this.render();
  }

  /** Performs an action from the productivity engine. Returns false if it isn't one of ours. */
  handle(a: Action): boolean {
    switch (a.type) {
      case 'timer':
        this.host.startTimer(Number(a.seconds), String(a.label ?? ''));
        return true;
      case 'note':
        // add() already said so when storage is full; don't follow that with "Saved".
        if (this.add({ text: String(a.text ?? ''), tags: (a.tags as string[]) ?? [] })) this.host.toast('Saved to notes');
        return true;
      case 'show':
        this.render();
        this.host.root.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return true;
      case 'cancel': {
        const match = typeof a.match === 'string' ? a.match.toLowerCase() : undefined;
        if (a.what === 'timer') {
          const n = this.host.cancelTimers(match, !!a.all);
          this.host.toast(n ? `Cancelled ${n} timer${n > 1 ? 's' : ''}` : 'No matching timer');
        } else {
          const doomed = a.all ? this.notes : match ? this.notes.filter((n) => n.text.toLowerCase().includes(match)) : this.notes.slice(0, 1);
          this.notes = this.notes.filter((n) => !doomed.includes(n));
          this.save();
          this.host.toast(doomed.length ? `Deleted ${doomed.length} note${doomed.length > 1 ? 's' : ''}` : 'No matching note');
        }
        return true;
      }
    }
    return false;
  }

  /** Returns the note, or null when it couldn't be stored (the user has been told why). */
  add(n: Pick<Note, 'text' | 'tags' | 'saved'>): Note | null {
    const note: Note = { id: uid(), at: Date.now(), updated: Date.now(), ...n, tags: n.tags ?? [] };
    this.notes.unshift(note);
    return this.save() ? note : null;
  }

  /** Saves an answer: the question, the result and any worked steps. */
  /** False when it couldn't be stored (the toast says why). */
  saveAnswer(question: string, result: string, steps?: { text: string; tex?: string }[]): boolean {
    const ok = !!this.add({ text: `${question} = ${result}`, tags: [], saved: { question, result, steps } });
    if (ok) this.host.toast('Saved to notes');
    return ok;
  }

  private save(): boolean {
    let ok = true;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.notes));
    } catch {
      ok = false;
      this.host.toast('Notes are full: export a notebook or delete some notes');
    }
    this.render();
    return ok;
  }

  /** Appends the note to the most recently edited notebook as a text cell (math cells for saved answers). */
  private async file(n: Note): Promise<void> {
    const { listNotebooks, loadNotebook, saveNotebook, openLatest } = await import('./notebook/store');
    const latest = listNotebooks()[0];
    const nb = (latest && loadNotebook(latest.id)) ?? openLatest();
    const cell = (type: 'math' | 'text', source: string) => ({ id: uid(), type, source });
    if (n.saved) {
      nb.cells.push(cell('math', n.saved.question));
      for (const s of n.saved.steps ?? []) nb.cells.push(cell('text', s.text));
    } else nb.cells.push(cell('text', n.text + (n.tags.length ? `  ${n.tags.map((t) => `#${t}`).join(' ')}` : '')));
    nb.updated = Date.now();
    this.host.toast(saveNotebook(nb) ? `Added to “${nb.title}”` : 'Couldn’t save the notebook: storage is full');
  }

  render(): void {
    const root = this.host.root;
    root.replaceChildren();
    root.hidden = !this.notes.length;
    if (!this.notes.length) return;
    const head = document.createElement('div');
    head.className = 'history-head';
    const h = document.createElement('h2');
    h.textContent = 'Notes';
    head.append(h);
    root.append(head);
    const pending: [HTMLElement, string][] = [];
    for (const n of this.notes) {
      const row = document.createElement('div');
      row.className = 'note-row';
      const body = document.createElement('div');
      body.className = 'note-body';
      if (n.saved) {
        const q = document.createElement('div');
        q.className = 'note-q';
        q.textContent = n.saved.question;
        const r = document.createElement('div');
        r.className = 'note-main';
        r.textContent = n.saved.result;
        body.append(q, r);
        if (n.saved.steps?.length) {
          const ol = document.createElement('ol');
          ol.className = 'note-steps';
          for (const s of n.saved.steps) {
            const li = document.createElement('li');
            li.textContent = s.text;
            if (s.tex) {
              const m = document.createElement('span');
              m.className = 'note-math';
              pending.push([m, s.tex]);
              li.append(' ', m);
            }
            ol.append(li);
          }
          body.append(ol);
        }
      } else {
        const main = document.createElement('div');
        main.className = 'note-main';
        for (const run of splitMath(n.text)) {
          if (!run.math) {
            main.append(run.text);
            continue;
          }
          const m = document.createElement('span');
          m.className = 'note-math';
          m.textContent = run.text;
          pending.push([m, toTex(run.text)]);
          main.append(m);
        }
        body.append(main);
      }
      if (n.tags.length) {
        const t = document.createElement('div');
        t.className = 'note-tags';
        t.textContent = n.tags.map((x) => `#${x}`).join(' ');
        body.append(t);
      }
      const actions = document.createElement('div');
      actions.className = 'note-actions';
      const file = document.createElement('button');
      file.type = 'button';
      file.className = 'link';
      file.textContent = 'Add to notebook';
      file.addEventListener('click', () => void this.file(n));
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'icon-btn';
      del.textContent = '×';
      del.setAttribute('aria-label', `Delete note ${n.saved?.question ?? n.text}`);
      del.addEventListener('click', () => {
        this.notes = this.notes.filter((x) => x !== n);
        this.save();
      });
      actions.append(file, del);
      row.append(body, actions);
      root.append(row);
    }
    if (pending.length)
      void import('./math-render').then(({ renderInlineMath }) => {
        for (const [el, tex] of pending) renderInlineMath(el, tex, false);
      });
  }
}
