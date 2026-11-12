import type { AnswerResult } from '@lemma/math-core';
import { asProb, blank, f, fail, need, NUM, ok, pctOf, primaryOf, prob, probValue, take, type Ctx } from './common';
import {
  binomCdf, binomPmf, binomSf, normCdf, normInv, normSf, poissonCdf, poissonPmf, poissonSf, tCdf, tInv,
} from './special';

// ---------- events ----------

export interface Interval {
  lo: number;
  loIncl: boolean;
  hi: number;
  hiIncl: boolean;
}

const OPS: Record<string, (a: number) => Interval> = {
  '<': (a) => ({ lo: -Infinity, loIncl: false, hi: a, hiIncl: false }),
  '<=': (a) => ({ lo: -Infinity, loIncl: false, hi: a, hiIncl: true }),
  '>': (a) => ({ lo: a, loIncl: false, hi: Infinity, hiIncl: false }),
  '>=': (a) => ({ lo: a, loIncl: true, hi: Infinity, hiIncl: false }),
  '=': (a) => ({ lo: a, loIncl: true, hi: a, hiIncl: true }),
};

const WORD_OPS: [RegExp, string][] = [
  [new RegExp(`\\b(?:exactly|equal to|equals)\\s+(${NUM})`), '='],
  [new RegExp(`\\b(?:at least|no (?:fewer|less) than|not (?:fewer|less) than|a minimum of)\\s+(${NUM})`), '>='],
  [new RegExp(`(${NUM})\\s+or more\\b`), '>='],
  [new RegExp(`\\b(?:at most|no more than|not more than|up to|a maximum of)\\s+(${NUM})`), '<='],
  [new RegExp(`(${NUM})\\s+or (?:fewer|less)\\b`), '<='],
  [new RegExp(`\\b(?:more than|greater than|above|over|exceeds?|exceeding|higher than|longer than|bigger than|larger than|beyond)\\s+(${NUM})`), '>'],
  [new RegExp(`\\b(?:less than|fewer than|below|under|lower than|shorter than|smaller than|within)\\s+(${NUM})`), '<'],
];

/** Reads the event being asked about from c.rest and consumes it. */
export function parseEvent(c: Ctx): Interval | null {
  const consume = (m: RegExpExecArray) => (c.rest = blank(c.rest, m.index, m.index + m[0].length));
  const pn = new RegExp(`p\\s*\\(\\s*(?:(${NUM})\\s*(<=|<)\\s*)?[a-z]\\s*(<=|<|>=|>|=)\\s*(${NUM})\\s*\\)`).exec(c.rest);
  if (pn) {
    consume(pn);
    const b = Number(pn[4]);
    if (pn[1] !== undefined) {
      if (pn[3] !== '<' && pn[3] !== '<=') return null;
      return { lo: Number(pn[1]), loIncl: pn[2] === '<=', hi: b, hiIncl: pn[3] === '<=' };
    }
    return OPS[pn[3]!]!(b);
  }
  const btw = new RegExp(`\\bbetween\\s+(${NUM})\\s*(?:and|to|&|-)\\s*(${NUM})`).exec(c.rest);
  if (btw) {
    consume(btw);
    const a = Number(btw[1]);
    const b = Number(btw[2]);
    return { lo: Math.min(a, b), loIncl: true, hi: Math.max(a, b), hiIncl: true };
  }
  for (const [re, op] of WORD_OPS) {
    const m = re.exec(c.rest);
    if (m) {
      consume(m);
      return OPS[op]!(Number(m[1]));
    }
  }
  const bare = new RegExp(`(?:^|[^a-z])[xkz]\\s*(<=|<|>=|>|=)\\s*(${NUM})`).exec(c.rest);
  if (bare) {
    consume(bare);
    return OPS[bare[1]!]!(Number(bare[2]));
  }
  return null;
}

function eventLabel(e: Interval, v = 'X'): string {
  const n = (x: number) => f(x, 10);
  if (e.lo === e.hi) return `P(${v} = ${n(e.lo)})`;
  if (e.lo === -Infinity) return `P(${v} ${e.hiIncl ? '≤' : '<'} ${n(e.hi)})`;
  if (e.hi === Infinity) return `P(${v} ${e.loIncl ? '≥' : '>'} ${n(e.lo)})`;
  return `P(${n(e.lo)} ${e.loIncl ? '≤' : '<'} ${v} ${e.hiIncl ? '≤' : '<'} ${n(e.hi)})`;
}

interface Discrete {
  pmf: (k: number) => number;
  cdf: (k: number) => number;
  sf: (k: number) => number;
}

function discreteP(e: Interval, d: Discrete): number {
  const kLo = e.lo === -Infinity ? -Infinity : e.loIncl ? Math.ceil(e.lo) : Math.floor(e.lo) + 1;
  const kHi = e.hi === Infinity ? Infinity : e.hiIncl ? Math.floor(e.hi) : Math.ceil(e.hi) - 1;
  if (kHi < kLo) return 0;
  if (kLo === kHi) return d.pmf(kLo);
  if (kHi === Infinity) return d.sf(kLo - 1);
  if (kLo === -Infinity) return d.cdf(kHi);
  if (kHi - kLo <= 2000) {
    let s = 0;
    for (let k = Math.max(kLo, 0); k <= kHi; k++) s += d.pmf(k);
    return Math.min(1, s);
  }
  return Math.max(0, d.cdf(kHi) - d.cdf(kLo - 1));
}

interface Continuous {
  cdf: (x: number) => number;
  sf: (x: number) => number;
  median: number;
}

function continuousP(e: Interval, d: Continuous): number {
  if (e.lo === e.hi) return 0;
  if (e.hi === Infinity) return d.sf(e.lo);
  if (e.lo === -Infinity) return d.cdf(e.hi);
  return Math.max(0, e.lo >= d.median ? d.sf(e.lo) - d.sf(e.hi) : d.cdf(e.hi) - d.cdf(e.lo));
}

function probAnswer(
  c: Ctx,
  p: number,
  expression: string,
  moments: { mean: number; variance: number },
  notes: string[],
  extra: { label: string; display: string }[] = [],
): AnswerResult {
  const { primary, value } = primaryOf(p, 8);
  return ok(c, {
    expression,
    primary,
    value,
    lines: [
      { label: 'As a percentage', display: pctOf(p, 6) },
      ...extra,
      { label: 'Distribution mean', display: f(moments.mean, 10) },
      { label: 'Distribution variance', display: f(moments.variance, 10) },
      { label: 'Distribution std dev', display: f(Math.sqrt(moments.variance), 10) },
    ],
    notes,
  });
}

const EVENT_HELP = 'Which outcome do you want the probability of? (e.g. "exactly 3", "at least 7", "P(X < 2)")';

// ---------- calculator-style functions: normalcdf(), invnorm(), binompdf() … ----------
export function tiFunctions(c: Ctx): AnswerResult | null {
  const m = /\b(normalcdf|normcdf|invnorm|norminv|binompdf|binomcdf|poissonpdf|poissoncdf|invt|tcdf)\s*\(([^)]*)\)?/.exec(c.s);
  if (!m) return null;
  const fn = m[1]!;
  const args = (m[2] ?? '').split(',').map((x) => x.trim()).filter(Boolean).map(Number);
  if (args.some((x) => Number.isNaN(x))) fail(`Could not read the arguments of ${fn}()`);
  const a = (i: number) => args[i];
  switch (fn) {
    case 'normalcdf':
    case 'normcdf': {
      if (args.length < 2) return need(c, 'normalcdf needs a lower and an upper bound, e.g. normalcdf(-1.96, 1.96)');
      const mu = a(2) ?? 0;
      const sd = a(3) ?? 1;
      if (!(sd > 0)) fail('The standard deviation must be positive');
      const lo = a(0)!;
      const hi = a(1)!;
      const zl = (lo - mu) / sd;
      const zh = (hi - mu) / sd;
      const p = Math.max(0, zl >= 0 ? normSf(zl) - normSf(zh) : normCdf(zh) - normCdf(zl));
      return probAnswer(c, p, `Normal(μ = ${f(mu)}, σ = ${f(sd)}) · P(${f(lo)} < X < ${f(hi)})`, { mean: mu, variance: sd * sd },
        args.length < 4 ? ['Standard normal (μ = 0, σ = 1)'] : []);
    }
    case 'invnorm':
    case 'norminv': {
      const p = a(0);
      if (p === undefined) return need(c, 'Which area (probability) to the left? e.g. invnorm(0.95)');
      return inverseNormal(c, probValue(p, false, `${fn}'s area`), a(1) ?? 0, a(2) ?? 1, args.length < 3);
    }
    case 'binompdf':
    case 'binomcdf': {
      if (args.length < 3) return need(c, `${fn} needs n, p and k, e.g. ${fn}(10, 0.5, 3)`);
      const [n, p, k] = args as [number, number, number];
      return binomialAnswer(c, n, p, fn === 'binompdf' ? OPS['=']!(k) : OPS['<=']!(k), []);
    }
    case 'poissonpdf':
    case 'poissoncdf': {
      if (args.length < 2) return need(c, `${fn} needs λ and k, e.g. ${fn}(3, 2)`);
      const [lambda, k] = args as [number, number];
      return poissonAnswer(c, lambda, fn === 'poissonpdf' ? OPS['=']!(k) : OPS['<=']!(k), []);
    }
    case 'invt': {
      if (args.length < 2) return need(c, 'invT needs an area and degrees of freedom, e.g. invT(0.975, 10)');
      const [p, df] = args as [number, number];
      if (!(df > 0)) fail('Degrees of freedom must be positive');
      if (!(p > 0 && p < 1)) fail('The area must be strictly between 0 and 1');
      const t = tInv(p, df);
      const { primary, value } = primaryOf(t, 8);
      return ok(c, { expression: `Inverse t · area ${f(p)} to the left, df = ${f(df)}`, primary, value, notes: [] });
    }
    case 'tcdf': {
      if (args.length < 3) return need(c, 'tcdf needs a lower bound, an upper bound and df, e.g. tcdf(-2, 2, 10)');
      const [lo, hi, df] = args as [number, number, number];
      if (!(df > 0)) fail('Degrees of freedom must be positive');
      const p = tCdf(hi, df) - tCdf(lo, df);
      const { primary, value } = primaryOf(p, 8);
      return ok(c, { expression: `t distribution (df = ${f(df)}) · P(${f(lo)} < T < ${f(hi)})`, primary, value, notes: [] });
    }
  }
  return null;
}

// ---------- binomial ----------
function binomialAnswer(c: Ctx, n: number, p: number, e: Interval, notes: string[]): AnswerResult {
  if (!Number.isInteger(n) || n < 0) fail('The number of trials must be a whole number');
  if (!(p >= 0 && p <= 1)) fail('The success probability must be between 0 and 1');
  const P = discreteP(e, { pmf: (k) => binomPmf(k, n, p), cdf: (k) => binomCdf(k, n, p), sf: (k) => binomSf(k, n, p) });
  if (e.lo !== e.hi && e.lo !== -Infinity && e.hi !== Infinity) notes.push('“Between” includes both ends');
  return probAnswer(c, P, `Binomial(n = ${n}, p = ${f(p, 8)}) · ${eventLabel(e)}`, { mean: n * p, variance: n * p * (1 - p) }, notes);
}

const COUNT_NOUNS =
  '(?:heads?|tails?|successes|success|sixes|fives|fours|threes|twos|ones|wins?|hits?|defective(?: items)?|defects|girls|boys|correct(?: answers)?|people|patients|customers|times)';
const TRIAL_NOUNS = '(?:flips|tosses|trials|rolls|attempts|tries|shots|games|times|coins|draws|questions|births|patients|people|items|throws|spins|at bats|children|kids)';

export function binomial(c: Ctx): AnswerResult | null {
  if (!/\bbinom(?:ial)?\b|\bheads?\b|\btails?\b|\bcoins?\b|\bflip|\btoss|\btrials?\b|\bsuccess(?:es)?\b|\bdice\b|\bdie\b|\brolls?\b|\brolling\b/.test(c.s)) return null;
  if (!/\bbinom|probab|chance|odds|likelihood|\bp\s*\(|exactly|at least|at most|k\s*=/.test(c.s)) return null;
  const notes: string[] = [];
  const nP =
    take(c, 'n|number of trials|trials') ??
    (() => {
      const m = new RegExp(`(?:^|[^a-z0-9.])(${NUM})\\s+${TRIAL_NOUNS}\\b`).exec(c.rest) ?? new RegExp(`\\b(?:in|out of|of)\\s+(${NUM})\\b(?!\\s*%)`).exec(c.rest);
      if (!m) return null;
      const start = m.index + m[0].indexOf(m[1]!);
      c.rest = blank(c.rest, start, start + m[1]!.length);
      return { v: Number(m[1]), pct: false };
    })();
  let p = asProb(take(c, 'p|probability of success|success probability|chance of success|success rate|with probability|each with probability|probability of a success'));
  if (p === null) {
    const m = new RegExp(`(${NUM})\\s*%\\s*(?:chance|probability|success)`).exec(c.rest);
    if (m) {
      p = Number(m[1]) / 100;
      c.rest = blank(c.rest, m.index, m.index + m[0].length);
    }
  }
  if (p === null && /\bcoins?\b|\bheads?\b|\btails?\b|\bflip|\btoss/.test(c.s) && !/\b(?:biased|unfair|weighted|loaded)\b/.test(c.s)) {
    p = 0.5;
    notes.push('Fair coin: p = 0.5');
  }
  if (p === null && /\bdice\b|\bdie\b|\brolls?\b|\brolling\b/.test(c.s) && !/\b(?:biased|unfair|weighted|loaded)\b/.test(c.s)) {
    p = 1 / 6;
    notes.push('Fair six-sided die: p = 1/6 for one particular face');
  }
  let e = parseEvent(c);
  if (!e) {
    const k = take(c, 'k|x|successes') ?? (() => {
      const m = new RegExp(`(?:^|[^a-z0-9.])(${NUM})\\s+${COUNT_NOUNS}\\b`).exec(c.rest);
      return m ? { v: Number(m[1]), pct: false } : null;
    })();
    if (k) e = OPS['=']!(k.v);
  }
  // "rolling a 6 twice", "heads 3 times in a row", "rolling two sixes": every one of n trials succeeds.
  // (A face named with a count, "a 6 three times", wins over reading "6" as the number of successes.)
  if (p !== null) {
    const W: Record<string, number> = { twice: 2, thrice: 3, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const count = (w: string) => W[w] ?? Number(w);
    const face = '(?:a |an )?(?:[1-6]|one|two|three|four|five|six|heads?|tails?)';
    const m =
      new RegExp(`\\b(?:roll(?:ing|s)?|get(?:ting)?|flip(?:ping)?|toss(?:ing)?|throw(?:ing)?)\\s+${face}\\s+(twice|thrice|(\\d+|two|three|four|five|six|seven|eight|nine|ten) times)(?: in a row| running| consecutively)?\\b`).exec(c.s) ??
      (nP ? null : new RegExp(`\\b(?:roll(?:ing|s)?|get(?:ting)?|throw(?:ing)?)\\s+(?:a )?(two|three|four|five|six|\\d+)\\s+(?:sixes|fives|fours|threes|twos|ones|heads|tails)\\b(?! in| out of)`).exec(c.s));
    if (m) {
      const n = count(m[2] ?? m[1]!.replace(/ times$/, ''));
      if (Number.isInteger(n) && n >= 1 && n <= 1000) {
        notes.push(`${n} independent trials, every one a success: p^${n}`);
        return binomialAnswer(c, n, p, OPS['=']!(n), notes);
      }
    }
  }
  if (!nP) return need(c, 'How many trials? (e.g. "in 10 flips" or "n = 10")');
  if (p === null) return need(c, 'What is the probability of success on each trial? (e.g. "p = 0.3")');
  if (!e) return need(c, EVENT_HELP);
  notes.push('Independent trials with the same success probability');
  return binomialAnswer(c, nP.v, p, e, notes);
}

// ---------- Poisson ----------
function poissonAnswer(c: Ctx, lambda: number, e: Interval, notes: string[]): AnswerResult {
  if (!(lambda >= 0)) fail('The Poisson rate λ must be positive');
  const P = discreteP(e, { pmf: (k) => poissonPmf(k, lambda), cdf: (k) => poissonCdf(k, lambda), sf: (k) => poissonSf(k, lambda) });
  return probAnswer(c, P, `Poisson(λ = ${f(lambda, 8)}) · ${eventLabel(e)}`, { mean: lambda, variance: lambda }, notes);
}

export function poisson(c: Ctx): AnswerResult | null {
  if (!/\bpoisson\b/.test(c.s)) return null;
  const lam = take(c, 'lambda|mean|rate|average|avg|mu|expected(?: number| value)?|λ') ??
    (() => {
      const m = new RegExp(`(${NUM})\\s+(?:\\w+\\s+)?(?:per|an|a|each|every)\\s+(?:hour|minute|min|second|day|week|month|year|page|mile|unit)`).exec(c.rest);
      if (!m) return null;
      c.rest = blank(c.rest, m.index, m.index + m[0].length);
      return { v: Number(m[1]), pct: false };
    })();
  let e = parseEvent(c);
  if (!e) {
    const k = take(c, 'k|x') ?? (() => {
      const m = new RegExp(`(?:^|[^a-z0-9.])(${NUM})\\s+(?:events?|calls?|arrivals?|customers?|accidents?|emails?|goals?|cars?|defects?|errors?|occurrences?|times)\\b`).exec(c.rest);
      return m ? { v: Number(m[1]), pct: false } : null;
    })();
    if (k) e = OPS['=']!(k.v);
  }
  if (!lam) return need(c, 'What is the average rate λ? (e.g. "lambda = 3")');
  if (!e) return need(c, EVENT_HELP);
  return poissonAnswer(c, lam.v, e, ['Events occur independently at a constant average rate']);
}

// ---------- geometric ----------
export function geometric(c: Ctx): AnswerResult | null {
  if (!/\bgeometric(?! mean)\b|\bfirst success\b|\buntil the first\b/.test(c.s)) return null;
  const p = asProb(take(c, 'p|probability of success|success probability|chance of success|success rate|with probability'));
  let e = parseEvent(c);
  if (!e) {
    const m = new RegExp(`(?:on|at)\\s+(?:the\\s+)?(?:trial\\s+|attempt\\s+|try\\s+)?(${NUM})(?:st|nd|rd|th)?(?:\\s+(?:trial|try|attempt|roll|flip|shot|game))?`).exec(c.rest);
    const k = m ? { v: Number(m[1]) } : take(c, 'k|x|trial');
    if (k) e = OPS['=']!(k.v);
  }
  if (p === null) return need(c, 'What is the probability of success on each trial? (e.g. "p = 0.2")');
  if (!(p > 0 && p <= 1)) fail('The success probability must be between 0 and 1');
  if (!e) return need(c, 'On which trial? (e.g. "first success on trial 3" or "at most 3 trials")');
  const q = 1 - p;
  const P = discreteP(e, {
    pmf: (k) => (k >= 1 && Number.isInteger(k) ? Math.pow(q, k - 1) * p : 0),
    cdf: (k) => (k < 1 ? 0 : 1 - Math.pow(q, Math.floor(k))),
    sf: (k) => (k < 1 ? 1 : Math.pow(q, Math.floor(k))),
  });
  return probAnswer(c, P, `Geometric(p = ${f(p, 8)}) · ${eventLabel(e)}`, { mean: 1 / p, variance: q / (p * p) },
    ['X is the number of the trial on which the first success happens (1, 2, 3, …)']);
}

// ---------- exponential ----------
export function exponential(c: Ctx): AnswerResult | null {
  if (!/\bexponential(?:ly)?\b/.test(c.s)) return null;
  const notes: string[] = [];
  let rate = take(c, 'rate|lambda|λ')?.v ?? null;
  if (rate === null) {
    const mean = take(c, 'mean|average|avg|mu|expected(?: value| time| life(?:time)?)?|scale');
    if (mean) {
      rate = 1 / mean.v;
      notes.push(`Rate λ = 1 / mean = ${f(rate, 8)}`);
    }
  }
  const e = parseEvent(c);
  if (rate === null) return need(c, 'What is the rate λ (or the mean)? (e.g. "rate 0.5" or "mean 10")');
  if (!(rate > 0)) fail('The rate must be positive');
  if (!e) return need(c, EVENT_HELP);
  if (e.lo === e.hi) notes.push('A continuous variable has probability 0 at any single value');
  const r = rate;
  const P = continuousP(e, {
    cdf: (x) => (x <= 0 ? 0 : -Math.expm1(-r * x)),
    sf: (x) => (x <= 0 ? 1 : Math.exp(-r * x)),
    median: Math.LN2 / r,
  });
  return probAnswer(c, P, `Exponential(λ = ${f(r, 8)}) · ${eventLabel(e)}`, { mean: 1 / r, variance: 1 / (r * r) }, notes);
}

// ---------- uniform ----------
export function uniform(c: Ctx): AnswerResult | null {
  if (!/\buniform(?:ly)?\b/.test(c.s)) return null;
  let a: number | null = null;
  let b: number | null = null;
  const m = new RegExp(`uniform(?:ly)?(?: distribution| distributed| random(?: variable)?)?(?: on| over| from| between)?\\s*[[(]?\\s*(${NUM})\\s*(?:,|to|and|-|…|\\.\\.)\\s*(${NUM})\\s*[\\])]?`).exec(c.rest);
  if (m) {
    a = Number(m[1]);
    b = Number(m[2]);
    c.rest = blank(c.rest, m.index, m.index + m[0].length);
  } else {
    a = take(c, 'a|min|minimum|lower(?: bound| limit)?|low|from')?.v ?? null;
    b = take(c, 'b|max|maximum|upper(?: bound| limit)?|high|to')?.v ?? null;
  }
  const e = parseEvent(c);
  if (a === null || b === null) return need(c, 'Over which range? (e.g. "uniform from 0 to 10")');
  if (!(b > a)) fail('The upper bound must be greater than the lower bound');
  if (!e) return need(c, EVENT_HELP);
  const lo = a;
  const hi = b;
  const notes = ['Continuous uniform distribution'];
  if (e.lo === e.hi) notes.push('A continuous variable has probability 0 at any single value');
  const cdf = (x: number) => (x <= lo ? 0 : x >= hi ? 1 : (x - lo) / (hi - lo));
  const P = continuousP(e, { cdf, sf: (x) => 1 - cdf(x), median: (lo + hi) / 2 });
  return probAnswer(c, P, `Uniform(${f(lo)}, ${f(hi)}) · ${eventLabel(e)}`, { mean: (lo + hi) / 2, variance: ((hi - lo) * (hi - lo)) / 12 }, notes);
}

// ---------- normal ----------
export const MEAN_NAMES = 'mean|mu|average|avg|expected value|xbar';
export const SD_NAMES = 'standard deviation|std\\.? dev(?:iation)?\\.?|stdev|stddev|std|sd|s\\.d\\.|sigma';

function inverseNormal(c: Ctx, p: number, mu: number, sd: number, standard: boolean, label?: string): AnswerResult {
  if (!(p > 0 && p < 1)) fail('The area must be strictly between 0 and 1');
  if (!(sd > 0)) fail('The standard deviation must be positive');
  const z = normInv(p);
  const x = mu + sd * z;
  const { primary, value } = primaryOf(x, 8);
  const lines = standard ? [] : [{ label: 'z', display: f(z, 8) }];
  return ok(c, {
    expression: `${label ?? `Value with ${pctOf(p, 6)} of the area below it`} · ${standard ? 'standard normal' : `Normal(μ = ${f(mu)}, σ = ${f(sd)})`}`,
    primary,
    value,
    lines: [...lines, { label: 'Area to the left', display: prob(p) }, { label: 'Area to the right', display: prob(1 - p) }],
    notes: standard ? ['Standard normal (μ = 0, σ = 1)'] : [],
  });
}

export function normal(c: Ctx): AnswerResult | null {
  const named = /\bnormal(?:ly)?\b|\bbell(?: curve|-shaped)?\b|\bgaussian\b/.test(c.s);
  const zVar = /\bp\s*\(\s*(?:-?[\d.]+\s*<=?\s*)?z\b|\bz\s*(?:<|>|=)|\bz (?:is|value|score|lies|falls)\b|\bstandard normal\b/.test(c.s);
  const hasMean = new RegExp(`(?:^|[^a-z])(?:${MEAN_NAMES})(?![a-z0-9_])`).test(c.s);
  const hasSd = new RegExp(`(?:^|[^a-z])(?:${SD_NAMES}|variance)(?![a-z0-9_])`).test(c.s);
  if (!named && !zVar && !(hasMean && hasSd)) return null;
  if (/\bconfidence\b|\binterval\b|\btest\b|\bsample size\b/.test(c.s)) return null;

  const notes: string[] = [];
  const meanP = take(c, MEAN_NAMES);
  let sd = take(c, SD_NAMES)?.v ?? null;
  if (sd === null) {
    const v = take(c, 'variance|var');
    if (v) {
      sd = Math.sqrt(v.v);
      notes.push(`σ = √variance = ${f(sd, 8)}`);
    }
  }
  const standard = /\bstandard normal\b/.test(c.s) || (zVar && !meanP && sd === null);
  const mu = standard ? 0 : meanP?.v;
  const sigma = standard ? 1 : sd;

  // inverse: percentile / cutoff
  const pct = new RegExp(`(${NUM})(?:st|nd|rd|th)\\s+percentile`).exec(c.rest);
  const top = new RegExp(`\\b(top|highest|upper|bottom|lowest|lower)\\s+(${NUM})\\s*%`).exec(c.rest);
  const inv = new RegExp(`\\b(?:inverse normal|inverse of|inv ?norm|quantile|percentile|cutoff|critical value)\\s*(?:of|for|at|=)?\\s*(${NUM})\\s*(%)?`).exec(c.rest);
  if (pct || top || inv) {
    if ((mu === undefined || mu === null) && sigma === null && (named || zVar || /\bz\b/.test(c.s))) {
      return inverseNormal(c, pct ? Number(pct[1]) / 100 : top ? (/top|highest|upper/.test(top[1]!) ? 1 - Number(top[2]) / 100 : Number(top[2]) / 100) : probValue(Number(inv![1]), !!inv![2] || /percentile/.test(inv![0]), 'The area to the left'), 0, 1, true);
    }
    if (mu === undefined || mu === null) return need(c, 'What is the mean? (or say “standard normal”)');
    if (sigma === null) return need(c, 'What is the standard deviation?');
    if (pct) return inverseNormal(c, Number(pct[1]) / 100, mu, sigma, standard, `${f(Number(pct[1]))}th percentile`);
    if (top) {
      const share = Number(top[2]) / 100;
      const upper = /top|highest|upper/.test(top[1]!);
      return inverseNormal(c, upper ? 1 - share : share, mu, sigma, standard, `Cutoff for the ${top[1]} ${f(Number(top[2]))}%`);
    }
    const raw = Number(inv![1]);
    // "percentile 90" is in percent by definition; a bare "inverse normal 1.5" is refused, not read as 1.5%.
    return inverseNormal(c, probValue(raw, !!inv![2] || /percentile/.test(inv![0]), 'The area to the left'), mu, sigma, standard);
  }

  const e = parseEvent(c);
  if (!e) {
    if (!named && !zVar) return null;
    return need(c, 'Which probability? (e.g. "P(X < 130)", "above 130" or "between 85 and 115")');
  }
  if (mu === undefined || mu === null) return need(c, 'What is the mean? (or say “standard normal”)');
  if (sigma === null) return need(c, 'What is the standard deviation?');
  if (!(sigma > 0)) fail('The standard deviation must be positive');
  if (standard) notes.push('Standard normal (μ = 0, σ = 1)');
  if (e.lo === e.hi) notes.push('A continuous variable has probability 0 at any single value');
  const z = (x: number) => (x - mu) / sigma;
  const P = continuousP(e, { cdf: (x) => normCdf(z(x)), sf: (x) => normSf(z(x)), median: mu });
  const extra: { label: string; display: string }[] = [];
  if (!standard) {
    if (isFinite(e.lo)) extra.push({ label: `z for ${f(e.lo)}`, display: f(z(e.lo), 8) });
    if (isFinite(e.hi) && e.hi !== e.lo) extra.push({ label: `z for ${f(e.hi)}`, display: f(z(e.hi), 8) });
  }
  const v = standard ? 'Z' : 'X';
  return probAnswer(c, P, `${standard ? 'Standard normal' : `Normal(μ = ${f(mu)}, σ = ${f(sigma)})`} · ${eventLabel(e, v)}`, { mean: mu, variance: sigma * sigma }, notes, extra);
}

