/**
 * Text editing for the math keyboard, as pure functions on { value, start, end } so they can be tested without
 * a DOM. Templates mark the caret with "§" and, optionally, where a selection goes with "@":
 *   "sqrt(§)"      → sqrt(|)             (with "2x" selected: sqrt(2x|))
 *   "(§)/()"       → (|)/()              a fraction, caret in the numerator
 */

export interface EditState {
  value: string;
  start: number;
  end: number;
}

export interface Template {
  /** Text to insert; "§" is where the caret lands (default: the end). */
  t: string;
  /** Used instead when text is selected: "@" is replaced by the selection. */
  w?: string;
  /** Fraction-style: an operand right before the caret becomes the numerator ("3" → (3)/(|)). */
  frac?: boolean;
}

const CARET = '§';
const SEL = '@';

/** The operand that ends at `pos`: a number, a name, a call or a bracketed group ("12", "x", "sin(x)", "(a+b)"). */
export function operandBefore(value: string, pos: number): number {
  let i = pos;
  if (i > 0 && value[i - 1] === ')') {
    let depth = 0;
    while (i > 0) {
      const c = value[--i]!;
      if (c === ')') depth++;
      else if (c === '(' && --depth === 0) break;
    }
    if (depth !== 0) return pos;
    // A function name in front of the group belongs to it.
    while (i > 0 && /[A-Za-z_]/.test(value[i - 1]!)) i--;
    return i;
  }
  while (i > 0 && /[\w.π]/.test(value[i - 1]!)) i--;
  return i;
}

export function insert(s: EditState, tpl: Template | string): EditState {
  const t: Template = typeof tpl === 'string' ? { t: tpl } : tpl;
  let { start, end } = s;
  let selected = s.value.slice(start, end);
  let text: string;
  if (!selected && t.frac) {
    const from = operandBefore(s.value, start);
    if (from < start) {
      selected = s.value.slice(from, start);
      start = from;
    }
  }
  if (selected && (t.w || t.t.includes(CARET))) {
    const wrap = t.w ?? t.t.replace(CARET, SEL + CARET);
    text = wrap.replace(SEL, selected);
  } else text = t.t;
  const caret = text.indexOf(CARET);
  const clean = text.replace(CARET, '');
  const value = s.value.slice(0, start) + clean + s.value.slice(end);
  const at = start + (caret === -1 ? clean.length : caret);
  return { value, start: at, end: at };
}

/** Steps the caret, jumping over template joints so "→" goes from numerator to denominator in one press. */
export function move(s: EditState, dir: -1 | 1, extend = false): EditState {
  if (!extend && s.start !== s.end) {
    const at = dir < 0 ? s.start : s.end;
    return { value: s.value, start: at, end: at };
  }
  const pos = dir < 0 ? s.start : s.end;
  let next = pos;
  if (dir > 0) {
    const rest = s.value.slice(pos);
    const jump = /^\)\/\(/.exec(rest) ?? /^, ?/.exec(rest);
    next = Math.min(s.value.length, pos + (jump ? jump[0].length : 1));
  } else {
    const head = s.value.slice(0, pos);
    const jump = /\)\/\($/.exec(head) ?? /, ?$/.exec(head);
    next = Math.max(0, pos - (jump ? jump[0].length : 1));
  }
  if (extend) return dir < 0 ? { value: s.value, start: next, end: s.end } : { value: s.value, start: s.start, end: next };
  return { value: s.value, start: next, end: next };
}

/** Backspace: a selection goes; an empty template ("sqrt(|)", "(|)/()") goes whole; a function's "(" takes its name. */
export function backspace(s: EditState): EditState {
  const { value, start, end } = s;
  if (start !== end) return { value: value.slice(0, start) + value.slice(end), start, end: start };
  if (start === 0) return s;
  const before = value.slice(0, start);
  const after = value.slice(start);
  // An empty fraction: "(|)/()".
  if (before.endsWith('(') && after.startsWith(')/()')) {
    const from = start - 1;
    return { value: value.slice(0, from) + value.slice(start + 4), start: from, end: from };
  }
  // "name(|" or "name(|)": the whole call opener (and an empty pair's closer).
  const call = /[A-Za-z_]*\($/.exec(before);
  if (call) {
    const from = start - call[0].length;
    const drop = after.startsWith(')') ? 1 : 0;
    return { value: value.slice(0, from) + value.slice(start + drop), start: from, end: from };
  }
  // Surrogate pairs (rare math symbols) go as one character.
  const width = /[\uDC00-\uDFFF]/.test(before.slice(-1)) && before.length > 1 ? 2 : 1;
  return { value: value.slice(0, start - width) + after, start: start - width, end: start - width };
}

/** Per-field undo and redo; typing bursts count as one step. */
export class EditHistory {
  private undoStack: EditState[] = [];
  private redoStack: EditState[] = [];
  private lastPush = 0;

  /** Call before a change. `burst`: typing within 700 ms of the previous change joins that step. */
  record(s: EditState, burst = false): void {
    const now = Date.now();
    if (burst && now - this.lastPush < 700) {
      this.lastPush = now;
      return;
    }
    const top = this.undoStack.at(-1);
    if (!top || top.value !== s.value) this.undoStack.push({ ...s });
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.lastPush = burst ? now : 0;
  }

  undo(current: EditState): EditState | null {
    let prev = this.undoStack.pop();
    while (prev && prev.value === current.value) prev = this.undoStack.pop();
    if (!prev) return null;
    this.redoStack.push({ ...current });
    this.lastPush = 0;
    return prev;
  }

  redo(current: EditState): EditState | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push({ ...current });
    this.lastPush = 0;
    return next;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
