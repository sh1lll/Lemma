/** One line of a worked solution: a plain one-line reason and the resulting math. */
export interface Step {
  reason: string;
  /** The math after this step, as LaTeX (typeset by the host). */
  latex?: string;
  /** true: checked equivalent to the step before (or against an independent computation); false: a check failed; null: not checked. */
  verified: boolean | null;
  /** A longer explanation, shown when someone asks about this step. */
  detail?: string;
  /** A small table that belongs to this step (sign charts). */
  table?: { columns: string[]; rows: string[][] };
}

export interface StepList {
  /** The method in plain words: "Quadratic formula", "Integration by parts", "Order of operations". */
  method: string;
  steps: Step[];
  /** Other methods for the same problem (a 2×2 system by substitution as well as elimination). */
  alt?: { method: string; steps: Step[] }[];
  /** Whether the whole solution was checked, and how. */
  verified: boolean | null;
  how?: string;
  /** Solution set as intervals, for a number line. */
  intervals?: [number | null, number | null, boolean, boolean, string, string][];
}
