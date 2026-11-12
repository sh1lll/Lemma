import type { Action } from './actions';
import type { Solution } from './solve';

/** What the content script reports about the user's selection (read only when the user invokes an action). */
export interface SelectionInfo {
  text: string;
  /** Lemma input after page-math conversion (MathML, KaTeX/MathJax source, $…$ LaTeX). */
  query: string;
  source: 'text' | 'mathml' | 'tex' | 'latex' | 'table';
  column?: { label: string; values: number[] };
}

/** Background → content script. */
export type ToContent =
  | { type: 'lemma:selection' }
  | { type: 'lemma:bubble'; solution: Solution; mathml: Record<string, string>; tutor: boolean }
  | { type: 'lemma:bubble-loading'; action: Action }
  | { type: 'lemma:region' };

/** Content script / pages → background. */
export type ToBackground =
  | { type: 'lemma:region-done'; rect: { x: number; y: number; w: number; h: number }; vw: number }
  | { type: 'lemma:region-cancel' }
  | { type: 'lemma:open-panel'; query: string; action: Action }
  | { type: 'lemma:start-region'; tabId?: number }
  | { type: 'lemma:open-options' };

/** storage.session keys shared by the background and the side panel. */
export const SESSION_KEYS = {
  pending: 'pendingQuestion',
  capture: 'pendingCapture',
  waiting: 'regionWaiting',
} as const;

export interface PendingQuestion {
  query: string;
  action: Action;
  at: number;
}
export interface PendingCapture {
  dataUrl: string;
  at: number;
}
