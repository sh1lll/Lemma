import type { Session } from '@lemma/math-core';
import type { Outcome } from '@lemma/runtime';
import type { SymRequest, SymResult } from '@lemma/symbolic-engine';
import type { Assistant } from '../assistant/controller';

/** What the solve features need from the app shell (main.ts). Kept small so main.ts stays thin. */
export interface SolveHost {
  session: Session;
  /** Routes synchronously (may return `pending`). */
  route(q: string): Outcome;
  /** Routes and waits for lazy engines and SymPy. */
  compute(q: string): Promise<Outcome>;
  /** Puts text in the calculator and commits it, as if typed. */
  submit(q: string): void;
  /** Adds a chip to the answer's action row. */
  chip(label: string, icon: string, on: (b: HTMLButtonElement) => void): HTMLButtonElement;
  toast(m: string): void;
  aiReady(): boolean;
  assistant(): Promise<Assistant>;
  openTool(id: 'practice' | 'video', ctx: { query?: string; result?: string }): void;
  notebook(): Promise<{ appendQuery(q: string): void }>;
  symbolic(): { run(req: SymRequest): Promise<SymResult>; cached(req: SymRequest): SymResult | undefined };
  angle(): 'deg' | 'rad';
  toggleAngle(): void;
  /** Voice: hears phrases until stopped (returns the stop). Absent where there's no speech recognition. */
  listen?(h: { onPartial(t: string): void; onFinal(t: string): void; onEnd(): void; onError(m: string): void }): () => void;
  /** Leaves to the calculator and asks the assistant there (only when an AI provider is set up). */
  askAi?(text: string): void;
}

/** One committed answer: where its extras go, and whether it is still the answer on screen. */
export interface SolveContext {
  input: string;
  outcome: Outcome;
  detail: HTMLElement;
  alts: HTMLElement;
  /** The answer's own number/expression, as shown. */
  display: string;
  alive(): boolean;
}

export const ICON = {
  steps: '<path d="M5 6h14M5 12h10M5 18h6"/>',
  more: '<circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/>',
  share: '<path d="M8 12h8M12 8l4 4-4 4"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6"/>',
  ask: '<path d="M5 5h14v10H10l-4 4v-4H5z"/><path d="M10 9.5a2 2 0 1 1 2.8 1.8c-.5.2-.8.6-.8 1.2"/>',
  simplify: '<path d="M4 7h16M7 12h10M10 17h4"/>',
  factor: '<path d="M8 5c-3 4-3 10 0 14M16 5c3 4 3 10 0 14"/>',
  expand: '<path d="M4 12h16M12 4v16"/>',
  roots: '<path d="M3 12h18"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/>',
  graph: '<path d="M4 4v16h16"/><path d="M7 15c3-8 6-8 10-2"/>',
  derivative: '<path d="M5 19L19 5"/><path d="M12 5h7v7"/>',
  integral: '<path d="M14 4c-2 0-3 1-3 3v10c0 2-1 3-3 3"/>',
  domain: '<path d="M4 12h16"/><path d="M7 9v6M17 9v6"/>',
  evaluate: '<path d="M5 12h4M15 12h4M12 5v4M12 15v4"/><circle cx="12" cy="12" r="2"/>',
  solveFor: '<path d="M5 9h6M5 15h6M15 7l4 10M19 7l-4 10"/>',
};
