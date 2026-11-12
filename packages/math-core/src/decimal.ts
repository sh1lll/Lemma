import Decimal from 'decimal.js';

/**
 * Working precision. 50 significant digits leaves ~35 guard digits over what we display,
 * so results like sin(30°) or 0.1 + 0.2 snap cleanly to their exact values.
 */
export const WORKING_PRECISION = 50;

export const D = Decimal.clone({
  precision: WORKING_PRECISION,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -1e6,
  toExpPos: 1e6,
  maxE: 9e15,
  minE: -9e15,
});

export type Dec = Decimal;
