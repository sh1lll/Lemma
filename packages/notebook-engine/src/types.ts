import type { Session } from '@lemma/math-core';

export type CellType = 'math' | 'text' | 'data';

export interface Cell {
  id: string;
  type: CellType;
  source: string;
}

export interface Notebook {
  version: 1;
  id: string;
  title: string;
  angle: 'deg' | 'rad';
  cells: Cell[];
  created: number;
  updated: number;
}

/** Serializable output of one statement (a math cell can hold several lines). */
export interface CellOutput {
  /** `pending`: its engine is still loading; the host re-evaluates when it arrives. */
  kind: 'value' | 'answer' | 'graph' | 'binding' | 'text' | 'data' | 'error' | 'pending' | 'simulation';
  /** The line that produced it. */
  input: string;
  expression?: string;
  display?: string;
  plain?: string;
  unit?: string;
  lines?: { label: string; display: string }[];
  table?: { columns: string[]; rows: string[][]; highlightRow?: number; caption?: string };
  latex?: string[];
  notes?: string[];
  verified?: { ok: boolean; how: string };
  exactness?: 'exact' | 'approximate' | 'numeric';
  error?: string;
  /** Graph request text, rendered by the host with the notebook's session. */
  graph?: string;
  /** Monte Carlo result of a `simulate N: …` line. */
  simulation?: import('./simulate').SimulationSummary & { seedGiven: boolean };
  /** What this line defined, for the variables panel. */
  binding?: { name: string; kind: 'variable' | 'function' | 'data'; value: string };
}

/**
 * What the host's runner returns for one query. `value` (a decimal string) and `symbolic`
 * (expression text in Lemma syntax) let results be bound to names.
 */
export interface RunResult extends CellOutput {
  value?: string;
  symbolic?: string;
}

/** Runs one query against a session (same router as the calculator) and commits it to that session. */
export type Runner = (query: string, session: Session, signal?: AbortSignal) => Promise<RunResult>;
