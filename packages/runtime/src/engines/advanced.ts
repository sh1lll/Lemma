// Phase 3 engines as one lazily loaded chunk: graphing, symbolic requests, number theory, statistics, science.
export { isGraphRequest, parseGraph, type GraphSpec } from '@lemma/graph-engine';
export { answerArithmetic, answerNumberExtras, commaDecimal, LOOKS_LIKE_ARITH, LOOKS_LIKE_NUMBER_EXTRAS } from '@lemma/symbolic-engine';
export { answerNumberTheory, complexRequest, expressionRequest, LOOKS_LIKE_NUMBER_THEORY, LOOKS_LIKE_SYMBOLIC, parseSymbolic, toAnswer, type SymRequest } from '@lemma/symbolic-engine';
export { answerStats, LOOKS_LIKE_STATS } from '@lemma/stats-engine';
export { answerScience, LOOKS_LIKE_SCIENCE } from '@lemma/science-engine';
