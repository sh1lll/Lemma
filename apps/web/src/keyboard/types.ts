import type { Template } from './edit';

/** One key. Exactly one of `ins` (insert a template) or `act` (an action) is set. */
export interface Key {
  /** Label shown on the key. */
  l: string;
  ins?: Template | string;
  act?: 'left' | 'right' | 'back' | 'enter' | 'shift' | 'more' | 'symbols' | 'sd' | 'm+' | 'm-' | 'mr' | 'mc' | 'angle' | 'neg';
  /** Spoken name (defaults to the label). */
  aria?: string;
  /** Style: 'num' digits, 'op' operators, 'fn' functions, 'enter', 'it' italic letters, 'soft' quiet. */
  c?: string;
  /** Column span (default 1). */
  s?: number;
  /** A physical key that lights this key up when typed. */
  k?: string;
  /** Empty spacer of width `s`. */
  gap?: boolean;
}

/** A block of keys in a grid of `cols` columns; a pane shows blocks side by side, sized by their columns. */
export interface Block {
  cols: number;
  keys: Key[];
  cls?: string;
}

export interface Pane {
  blocks: Block[];
  /** A scrolling strip of extra keys above the grid. */
  strip?: Key[];
}

export type TabId = 'main' | 'abc' | 'func' | string;

export interface TabDef {
  id: TabId;
  label: string;
  /** Built on first use; tabs beyond "main" load their layout lazily. */
  pane: () => Pane | Promise<Pane>;
}
