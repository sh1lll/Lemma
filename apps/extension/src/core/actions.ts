/** Selection actions (context menu items). Kept apart from solve.ts so the content script stays engine-free. */
export type Action = 'calculate' | 'solve' | 'convert' | 'graph' | 'explain' | 'average';

export const ACTION_LABELS: Record<Action, string> = {
  calculate: 'Calculate',
  solve: 'Solve step by step',
  convert: 'Convert',
  graph: 'Graph',
  explain: 'Explain (tutor mode)',
  average: 'Average of this column',
};

/** The context-menu entries, in menu order. */
export const MENU_ACTIONS: Action[] = ['calculate', 'solve', 'convert', 'graph', 'explain'];
