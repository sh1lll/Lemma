/**
 * Cheap pre-check, also copied into the runtime router so the main bundle doesn't import this package.
 * Must hold for every phrase a handler accepts.
 */
export const LOOKS_LIKE_DISCRETE =
  /\b(?:bisection|newton|secant|fixed[- ]point|regula falsi|false position|interpolat\w*|divided differences?|spline|numerical(?:ly)?|finite differences?|forward differences?|backward differences?|central differences?|trapez\w*|simpson\w*|midpoint|gauss\w*|romberg|riemann|quadrature|euler'?s?|runge|rk[24]|heun\w*|jacobi|seidel|sor|over[- ]?relaxation|power (?:method|iteration)|dominant eigen\w*|machine epsilon|unit roundoff|ieee|float\w*|binary(?:32|64)|single precision|double precision|condition number|rounding|round-?off|relative error|absolute error|percent(?:age)? error)\b/i;
