export type MathErrorCode =
  | 'empty'
  | 'incomplete' // input ends mid-expression (e.g. "5 +"); UIs should stay quiet while the user is still typing
  | 'syntax'
  | 'unknown-name'
  | 'domain'
  | 'division-by-zero'
  | 'overflow'
  | 'ambiguous-reference';

export class MathError extends Error {
  constructor(
    public readonly code: MathErrorCode,
    message: string,
    public readonly position?: number,
  ) {
    super(message);
    this.name = 'MathError';
  }
}
