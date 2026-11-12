import type { AnswerResult } from '@lemma/math-core';
import {
  alpha, asProb, blank, confidence, f, fail, meanOf, need, NUM, ok, pctOf, primaryOf, probValue, strip, take, values, varianceOf, type Ctx,
} from './common';
import { chi2Inv, chi2Sf, normInv, normSf, tInv, tTail } from './special';

const SIGMA_NAMES = 'sigma|population (?:standard deviation|std dev|sd|stdev)|known (?:standard deviation|sd|std dev)';
const S_NAMES = 'sample (?:standard deviation|std dev|sd|stdev)|standard deviation|std\\.? dev(?:iation)?\\.?|stdev|stddev|std|sd|s\\.d\\.|s';
const MEAN_N = 'sample mean|mean|xbar|average|avg';
const N_NAMES = 'n|sample size|size';

interface Summary {
  mean: number | null;
  s: number | null;
  sigma: number | null;
  n: number | null;
}

function summary(c: Ctx, suf = ''): Summary {
  const S = (names: string) => (suf ? `(?:${names})\\s*_?${suf}` : names);
  const sigma = take(c, S(SIGMA_NAMES))?.v ?? null;
  const s = take(c, S(S_NAMES))?.v ?? null;
  const mean = take(c, S(MEAN_N))?.v ?? null;
  const n = take(c, S(N_NAMES))?.v ?? null;
  return { mean, s, sigma, n };
}

type Tail = 'two' | 'greater' | 'less';

function tailOf(c: Ctx): { tail: Tail; stated: boolean } {
  if (/\bgreater\b|\bmore than\b|\bexceeds?\b|\blarger\b|\bhigher\b|\babove\b|\bincrease[sd]?\b|\bright[- ]tail|\bupper[- ]tail|>/.test(c.s)) return { tail: 'greater', stated: true };
  if (/\bless than\b|\bsmaller\b|\blower\b|\bbelow\b|\bdecrease[sd]?\b|\bfewer\b|\bleft[- ]tail|\blower[- ]tail|</.test(c.s)) return { tail: 'less', stated: true };
  return { tail: 'two', stated: /\btwo[- ](?:sided|tailed)\b|\b2[- ](?:sided|tailed)\b|\bdifferent\b|\bdiffers\b|\bnot equal\b|!=/.test(c.s) };
}

const H0_NAMES =
  'mu0|mu_0|mu naught|mu ?not|h0\\s*:?\\s*mu|h0\\s*:?\\s*p|h0|null(?: hypothesis)?(?: mean| value| proportion)?|hypothesi[sz]ed (?:mean|value|proportion)|claimed (?:mean|proportion|value)|test(?:ing)? against|against|versus|vs\\.?|compared (?:to|with)|p0|p_0';
const H0_COMPARE = new RegExp(
  `\\b(?:greater than|more than|larger than|higher than|exceeds?|above|less than|smaller than|lower than|fewer than|below|different from|differs from|not equal to|equal to|equals|is not|is)\\s*(${NUM})\\s*(%)?`,
);

function nullValue(c: Ctx, extra = ''): { v: number; pct: boolean } | null {
  const named = take(c, extra ? `${H0_NAMES}|${extra}` : H0_NAMES);
  if (named) return named;
  const m = H0_COMPARE.exec(c.rest);
  if (!m) return null;
  c.rest = blank(c.rest, m.index, m.index + m[0].length);
  return { v: Number(m[1]), pct: !!m[2] };
}

function pValue(stat: number, tail: Tail, upper: (x: number) => number): number {
  if (tail === 'greater') return upper(stat);
  if (tail === 'less') return upper(-stat);
  return Math.min(1, 2 * upper(Math.abs(stat)));
}

const H1 = { two: '≠', greater: '>', less: '<' } as const;

function decision(p: number, a: number): string {
  return p < a ? `Reject H₀ at α = ${f(a)}` : `Fail to reject H₀ at α = ${f(a)}`;
}

function testAnswer(
  c: Ctx,
  o: {
    expression: string;
    stat: number;
    statName: string;
    df?: number;
    p: number;
    a: { a: number; stated: boolean };
    tail: { tail: Tail; stated: boolean };
    hyp: string;
    lines?: { label: string; display: string }[];
    notes?: string[];
  },
): AnswerResult {
  const { primary, value } = primaryOf(o.p, 6);
  const dec = decision(o.p, o.a.a);
  const notes = [...(o.notes ?? [])];
  if (!o.a.stated) notes.push('Significance level α = 0.05 (say “alpha 0.01” to change)');
  if (!o.tail.stated) notes.push('Two-sided alternative (say “greater” or “less” for one-sided)');
  return ok(c, {
    expression: o.expression,
    primary: { display: `p = ${primary.display}`, plain: primary.plain, spoken: `p equals ${primary.spoken}. ${dec}` },
    value,
    lines: [
      { label: o.statName, display: f(o.stat, 6) },
      ...(o.df !== undefined ? [{ label: 'Degrees of freedom', display: f(o.df, 6) }] : []),
      { label: 'p-value', display: f(o.p, 6) },
      { label: 'Hypotheses', display: o.hyp },
      { label: 'Decision', display: dec },
      ...(o.lines ?? []),
    ],
    notes,
  });
}

function interval(c: Ctx, o: { expression: string; est: number; me: number; level: number; stated: boolean; lines: { label: string; display: string }[]; notes: string[] }): AnswerResult {
  const lo = o.est - o.me;
  const hi = o.est + o.me;
  const d = `${f(lo, 6)} to ${f(hi, 6)}`;
  const notes = [...o.notes];
  if (!o.stated) notes.push('95% confidence (say e.g. “99% confidence” to change)');
  return ok(c, {
    expression: o.expression,
    primary: { display: d, plain: `${f(lo, 10).replace(/,/g, '').replace('−', '-')}, ${f(hi, 10).replace(/,/g, '').replace('−', '-')}`, spoken: `from ${f(lo, 4)} to ${f(hi, 4)}` },
    lines: [
      { label: 'Point estimate', display: f(o.est, 8) },
      { label: 'Margin of error', display: `± ${f(o.me, 6)}` },
      { label: 'Lower bound', display: f(lo, 8) },
      { label: 'Upper bound', display: f(hi, 8) },
      ...o.lines,
    ],
    notes,
  });
}

// ---------- critical values ----------
export function critical(c: Ctx): AnswerResult | null {
  if (!/\bcritical\b|\b[zt][- ]?star\b|\b[zt]\*/.test(c.s)) return null;
  const which = /\bchi\b|chi-square|chi squared/.test(c.s) ? 'chi' : /\bt\b|\bt[- ]?(?:star|critical|value|\*)|student/.test(c.s) ? 't' : /\bz\b|\bz[- ]?(?:star|critical|value|\*)|normal/.test(c.s) ? 'z' : null;
  if (!which) return need(c, 'Which critical value: z, t or chi-square?');
  const conf = confidence(c);
  const a = alpha(c);
  const oneTail = /\bone[- ](?:sided|tailed)\b|\b1[- ](?:sided|tailed)\b|\bright[- ]tail|\bleft[- ]tail|\bupper[- ]tail|\blower[- ]tail/.test(c.s);
  const notes: string[] = [];
  let level = conf.level;
  if (!conf.stated && a.stated) level = 1 - a.a;
  if (!conf.stated && !a.stated) notes.push('95% confidence / α = 0.05 (say e.g. “99%” to change)');
  const df = take(c, 'df|degrees of freedom|d\\.f\\.')?.v ?? null;
  const area = which === 'chi' ? level : oneTail ? level : 1 - (1 - level) / 2;
  let v: number;
  let expression: string;
  if (which === 'z') {
    v = normInv(area);
    expression = `Critical z for ${pctOf(level)} ${oneTail ? '(one-tailed)' : 'confidence'}`;
  } else {
    if (df === null) return need(c, 'How many degrees of freedom? (e.g. "df 10")');
    if (!(df > 0)) fail('Degrees of freedom must be positive');
    if (which === 't') {
      v = tInv(area, df);
      expression = `Critical t for ${pctOf(level)} ${oneTail ? '(one-tailed)' : 'confidence'}, df = ${f(df)}`;
    } else {
      v = chi2Inv(area, df);
      expression = `Critical χ² (upper tail α = ${f(1 - level)}), df = ${f(df)}`;
    }
  }
  if (which !== 'chi') notes.push(oneTail ? `Area ${f(area)} to the left` : `Two-sided: area ${f(area)} to the left`);
  const { primary, value } = primaryOf(v, 7);
  return ok(c, { expression, primary, value, notes });
}

// ---------- sample size ----------
export function sampleSize(c: Ctx): AnswerResult | null {
  if (!/\bsample size\b|\bhow (?:many|large|big)\b.*\b(?:sample|people|respondents|participants|subjects|survey)|\bminimum n\b|\brequired n\b/.test(c.s)) return null;
  if (!/\bmargin\b|\berror\b|\bwithin\b|±|\+\/-|\bplus or minus\b/.test(c.s)) return null;
  const conf = confidence(c);
  const em = new RegExp(`(?:margin of error|margin|error|within|±|\\+/-|plus or minus)\\s*(?:of|=|is|:)?\\s*(?:±|\\+/-)?\\s*(${NUM})\\s*(%|percentage points?)?`).exec(c.rest);
  if (!em) return need(c, 'What margin of error? (e.g. "margin of error 3%")');
  c.rest = blank(c.rest, em.index, em.index + em[0].length);
  const sigma = take(c, `${SIGMA_NAMES}|${S_NAMES}`);
  const z = normInv(1 - (1 - conf.level) / 2);
  const notes: string[] = [];
  if (!conf.stated) notes.push('95% confidence (say e.g. “99% confidence” to change)');
  let n: number;
  let expression: string;
  const lines: { label: string; display: string }[] = [{ label: 'z*', display: f(z, 7) }];
  if (sigma && !/\bproportion\b|%/.test(em[0] + c.s.replace(/\d+\s*%\s*confidence/, ''))) {
    const E = Number(em[1]);
    if (!(E > 0)) fail('The margin of error must be positive');
    n = Math.pow((z * sigma.v) / E, 2);
    expression = `Sample size to estimate a mean within ±${f(E)} (σ = ${f(sigma.v)})`;
    lines.push({ label: 'Formula', display: 'n = (z*·σ / E)²' });
  } else {
    const E = probValue(Number(em[1]), !!em[2], 'For a proportion, the margin of error');
    if (!(E > 0 && E < 1)) fail('The margin of error must be between 0 and 1 (or 0% and 100%)');
    let p = asProb(take(c, 'p|phat|expected proportion|estimated proportion|proportion|anticipated proportion|prior estimate'));
    if (p === null) {
      p = 0.5;
      notes.push('p = 0.5 (most conservative; give an expected proportion to refine)');
    }
    n = (z * z * p * (1 - p)) / (E * E);
    expression = `Sample size to estimate a proportion within ±${pctOf(E)}`;
    lines.push({ label: 'p used', display: f(p) }, { label: 'Formula', display: 'n = z*²·p(1 − p) / E²' });
  }
  const need_ = Math.ceil(n - 1e-9);
  lines.push({ label: 'Exact n', display: f(n, 8) });
  notes.push('Rounded up to the next whole number');
  return ok(c, {
    expression: `${expression} at ${pctOf(conf.level)} confidence`,
    primary: { display: f(need_, 15), plain: String(need_), spoken: String(need_) },
    value: primaryOf(need_, 15).value,
    lines,
    notes,
  });
}

// ---------- chi-square goodness of fit ----------
export function chiSquare(c: Ctx): AnswerResult | null {
  if (!/\bchi\b|chi-square|chi squared|\bgoodness of fit\b|\bgof\b/.test(c.s)) return null;
  const a = alpha(c);
  // p-value of a given statistic: "chi-square p-value for 5 with df 2"
  const df = take(c, 'df|degrees of freedom|d\\.f\\.');
  const statP = take(c, 'chi-square(?: statistic| value)?\\s*(?:=|of)|statistic|x2|x\\^2|x');
  const obsIdx = c.rest.search(/\bobserved\b|\bobs\b|\bo\s*[:=]/);
  if (df && (statP || obsIdx < 0)) {
    const x = statP?.v ?? values(c.rest).find((v) => v >= 0);
    if (x === undefined) return need(c, 'What is the chi-square statistic?');
    const p = chi2Sf(x, df.v);
    const { primary, value } = primaryOf(p, 6);
    return ok(c, {
      expression: `Chi-square upper tail P(χ² ≥ ${f(x)}), df = ${f(df.v)}`,
      primary,
      value,
      lines: [{ label: 'Critical value', display: f(chi2Inv(1 - a.a, df.v), 6) }, { label: 'Decision', display: decision(p, a.a) }],
      notes: a.stated ? [] : ['α = 0.05'],
    });
  }
  const expIdx = c.rest.search(/\bexpected\b|\bexp\b|\be\s*[:=]|\bproportions?\b|\bratios?\b/);
  const obs = values(expIdx >= 0 ? c.rest.slice(Math.max(0, obsIdx), expIdx) : c.rest);
  let exp = expIdx >= 0 ? values(c.rest.slice(expIdx)) : [];
  const notes: string[] = [];
  if (obs.length < 2) return need(c, 'Give the observed counts, e.g. "chi-square observed 50, 30, 20 expected 40, 40, 20"');
  const total = obs.reduce((s, x) => s + x, 0);
  if (obs.some((x) => x < 0)) fail('Observed counts cannot be negative');
  if (exp.length === 0) {
    exp = obs.map(() => total / obs.length);
    notes.push('No expected values given: tested against equal frequencies');
  } else {
    if (exp.length !== obs.length) fail(`There are ${obs.length} observed counts but ${exp.length} expected values`);
    const es = exp.reduce((s, x) => s + x, 0);
    if (Math.abs(es - total) > 1e-9 * Math.max(1, total)) {
      exp = exp.map((e) => (e / es) * total);
      notes.push(Math.abs(es - 1) < 1e-9 || Math.abs(es - 100) < 1e-9 ? 'Expected proportions scaled to the observed total' : `Expected values scaled to the observed total ${f(total)}`);
    }
  }
  if (exp.some((e) => e <= 0)) fail('Expected values must be positive');
  if (exp.some((e) => e < 5)) notes.push('Some expected counts are below 5; the chi-square approximation may be poor');
  let stat = 0;
  for (let i = 0; i < obs.length; i++) stat += Math.pow(obs[i]! - exp[i]!, 2) / exp[i]!;
  const dof = obs.length - 1;
  const p = chi2Sf(stat, dof);
  const rows = obs.map((o, i) => [String(i + 1), f(o, 10), f(exp[i]!, 8), f(Math.pow(o - exp[i]!, 2) / exp[i]!, 6)]);
  const r = testAnswer(c, {
    expression: `Chi-square goodness-of-fit test on ${obs.length} categories`,
    stat,
    statName: 'χ²',
    df: dof,
    p,
    a,
    tail: { tail: 'two', stated: true },
    hyp: 'H₀: the data follow the expected distribution',
    lines: [{ label: 'Critical value', display: f(chi2Inv(1 - a.a, dof), 6) }],
    notes,
  });
  if (r.ok) r.table = { columns: ['Category', 'Observed', 'Expected', '(O − E)²/E'], rows };
  return r;
}

// ---------- groups ----------
function splitGroups(rest: string): [string, string] | null {
  const labelled =
    /\b(?:group|sample|set|list|data|before|treatment|control)?\s*(?:a|1|x|before)\s*[:=]\s*(.*?)\b(?:group|sample|set|list|data|after)?\s*(?:b|2|y|after)\s*[:=]\s*(.*)$/.exec(rest) ??
    /\b(?:group|sample|set|list|data)\s*(?:a|1)\b(.*?)\b(?:group|sample|set|list|data)\s*(?:b|2)\b(.*)$/.exec(rest) ??
    /\bbefore\b(.*?)\bafter\b(.*)$/.exec(rest);
  if (labelled) return [labelled[1]!, labelled[2]!];
  const parts = rest.split(/\s(?:vs\.?|versus|against|compared (?:to|with))\s|;|\|/);
  if (parts.length === 2) return [parts[0]!, parts[1]!];
  const and = rest.split(/\sand\s/);
  if (and.length === 2 && values(and[0]!).length >= 2 && values(and[1]!).length >= 2) return [and[0]!, and[1]!];
  return null;
}

interface Group {
  mean: number;
  sd: number;
  n: number;
  fromData: boolean;
}

function groupFrom(text: string): Group | null {
  const c: Ctx = { input: text, s: text, rest: text };
  const sm = summary(c);
  const sd = sm.s ?? sm.sigma;
  if (sm.mean !== null && sd !== null && sm.n !== null) return { mean: sm.mean, sd, n: sm.n, fromData: false };
  const xs = values(text);
  if (xs.length < 2) return null;
  return { mean: meanOf(xs), sd: Math.sqrt(varianceOf(xs)), n: xs.length, fromData: true };
}

export function twoSample(c: Ctx): AnswerResult | null {
  const named = /\btwo[- ]sample\b|\b2[- ]sample\b|\bwelch\b|\bindependent(?: samples?| groups?| t)\b|\bunpaired\b|\bdifference (?:in|of|between) (?:the )?(?:two )?means\b|\bcompare (?:the )?(?:two )?means\b|\bpaired\b/.test(c.s);
  const testy = /\bt[- ]?test\b|\bttest\b|\bt test\b/.test(c.s);
  if (!named && !testy) return null;
  const a = alpha(c);
  const conf = confidence(c);
  const tail = tailOf(c);
  const pairedTest = /\bpaired\b|\bmatched\b|\bbefore\b.*\bafter\b/.test(c.s);

  // summary statistics with suffixes: mean1 … n2
  const s1 = summary(c, '1');
  const s2 = summary(c, '2');
  let g1: Group | null = null;
  let g2: Group | null = null;
  const sd1 = s1.s ?? s1.sigma;
  const sd2 = s2.s ?? s2.sigma;
  if (s1.mean !== null && sd1 !== null && s1.n !== null && s2.mean !== null && sd2 !== null && s2.n !== null) {
    g1 = { mean: s1.mean, sd: sd1, n: s1.n, fromData: false };
    g2 = { mean: s2.mean, sd: sd2, n: s2.n, fromData: false };
  } else {
    const parts = splitGroups(c.rest.replace(/\b(?:two|2)[- ]sample\b|\bwelch'?s?\b|\bt[- ]?test\b|\bpaired\b|\bunpaired\b|\bindependent\b/g, ' '));
    if (parts) {
      g1 = groupFrom(parts[0]);
      g2 = groupFrom(parts[1]);
      if (pairedTest && g1?.fromData && g2?.fromData) {
        const x = values(parts[0]);
        const y = values(parts[1]);
        if (x.length !== y.length) fail(`The paired samples have ${x.length} and ${y.length} values`);
        const d = y.map((v, i) => v - x[i]!);
        return oneSampleT(c, d, 0, a, tail, conf, `Paired t-test on ${d.length} differences (second − first)`);
      }
    }
  }
  if (!named && !(g1 && g2)) return null; // a one-sample t-test
  if (!g1 || !g2) return need(c, 'Give both samples, e.g. "two sample t test 1, 2, 3 vs 4, 5, 6" or "mean1 20 sd1 5 n1 30 mean2 22 sd2 6 n2 35"');
  if (g1.n < 2 || g2.n < 2) fail('Each sample needs at least 2 values');
  const v1 = (g1.sd * g1.sd) / g1.n;
  const v2 = (g2.sd * g2.sd) / g2.n;
  const se = Math.sqrt(v1 + v2);
  if (se === 0) fail('Both samples have zero variance');
  const diff = g1.mean - g2.mean;
  const t = diff / se;
  const df = ((v1 + v2) * (v1 + v2)) / ((v1 * v1) / (g1.n - 1) + (v2 * v2) / (g2.n - 1));
  const p = pValue(t, tail.tail, (x) => (x >= 0 ? tTail(x, df) : 1 - tTail(x, df)));
  const tc = tInv(1 - (1 - conf.level) / 2, df);
  return testAnswer(c, {
    expression: `Welch two-sample t-test · ${g1.n} vs ${g2.n} values`,
    stat: t,
    statName: 't',
    df,
    p,
    a,
    tail,
    hyp: `H₀: μ₁ = μ₂ · H₁: μ₁ ${H1[tail.tail]} μ₂`,
    lines: [
      { label: 'Mean 1', display: f(g1.mean, 8) },
      { label: 'Mean 2', display: f(g2.mean, 8) },
      { label: 'Difference (1 − 2)', display: f(diff, 8) },
      { label: 'Standard error', display: f(se, 6) },
      { label: `${pctOf(conf.level)} CI for the difference`, display: `${f(diff - tc * se, 6)} to ${f(diff + tc * se, 6)}` },
    ],
    notes: ["Welch's test: variances not assumed equal"],
  });
}

// ---------- one-sample tests ----------
function oneSampleT(
  c: Ctx,
  xs: number[],
  mu0: number,
  a: { a: number; stated: boolean },
  tail: { tail: Tail; stated: boolean },
  conf: { level: number },
  expression?: string,
  given?: Group,
): AnswerResult {
  const g = given ?? { mean: meanOf(xs), sd: Math.sqrt(varianceOf(xs)), n: xs.length, fromData: true };
  if (g.n < 2) fail('A t-test needs at least 2 values');
  const se = g.sd / Math.sqrt(g.n);
  if (se === 0) fail('The standard deviation is 0, so the t statistic is undefined');
  const t = (g.mean - mu0) / se;
  const df = g.n - 1;
  const p = pValue(t, tail.tail, (x) => (x >= 0 ? tTail(x, df) : 1 - tTail(x, df)));
  const tc = tInv(1 - (1 - conf.level) / 2, df);
  return testAnswer(c, {
    expression: expression ?? `One-sample t-test · ${g.n} values against μ₀ = ${f(mu0)}`,
    stat: t,
    statName: 't',
    df,
    p,
    a,
    tail,
    hyp: `H₀: μ = ${f(mu0)} · H₁: μ ${H1[tail.tail]} ${f(mu0)}`,
    lines: [
      { label: 'Sample mean', display: f(g.mean, 8) },
      { label: 'Sample SD', display: f(g.sd, 8) },
      { label: 'Standard error', display: f(se, 6) },
      { label: `${pctOf(conf.level)} CI for the mean`, display: `${f(g.mean - tc * se, 6)} to ${f(g.mean + tc * se, 6)}` },
    ],
  });
}

/** "45 out of 100", "45 successes in 100", "phat 0.45 n 100". */
function proportionData(c: Ctx): { x: number; n: number } | { phat: number; n: number } | null {
  const m = new RegExp(`(${NUM})\\s*(?:successes|yes(?:es)?|people|respondents|voters|of them|favou?rable|defective|heads)?\\s*(?:out of|of|in|/)\\s*(${NUM})`).exec(c.rest);
  if (m) {
    c.rest = blank(c.rest, m.index, m.index + m[0].length);
    return { x: Number(m[1]), n: Number(m[2]) };
  }
  const ph = take(c, 'phat|sample proportion|proportion|p');
  const n = take(c, N_NAMES);
  if (ph && n) return { phat: asProb(ph)!, n: n.v };
  return null;
}

export function oneSampleTest(c: Ctx): AnswerResult | null {
  const isT = /\bt[- ]?test\b|\bttest\b|\bstudent'?s? t\b/.test(c.s);
  const isZ = /\bz[- ]?test\b|\bztest\b/.test(c.s);
  const generic = /\bhypothesis test\b|\btest (?:whether|if|that)\b|\bsignifican(?:t|ce) test\b|\bis (?:it|this|the difference) significant\b/.test(c.s);
  if (!isT && !isZ && !generic) return null;
  const a = alpha(c);
  const conf = confidence(c);
  const tail = tailOf(c);
  strip(c, /\b(?:one|1)[- ]sample\b|\b[tz][- ]?test\b|\bhypothesis test\b|\bstudent'?s? t\b/);

  // proportion z-test
  if (/\bproportion\b|\bphat\b|\bout of\b|\bsuccesses\b|\bp0\b|\bp_0\b/.test(c.s)) {
    const p0p = nullValue(c, 'p');
    const pd = proportionData(c);
    if (!pd) return need(c, 'What was observed? (e.g. "60 out of 100")');
    if (!p0p) return need(c, 'What proportion are you testing against? (e.g. "against 0.5")');
    const p0 = asProb(p0p)!;
    const phat = 'x' in pd ? pd.x / pd.n : pd.phat;
    if (!(p0 > 0 && p0 < 1)) fail('The null proportion must be between 0 and 1');
    const se = Math.sqrt((p0 * (1 - p0)) / pd.n);
    const z = (phat - p0) / se;
    const p = pValue(z, tail.tail, normSf);
    const notes: string[] = [];
    if (pd.n * p0 < 10 || pd.n * (1 - p0) < 10) notes.push('n·p₀ or n·(1 − p₀) is below 10; the normal approximation may be poor');
    return testAnswer(c, {
      expression: `One-proportion z-test · p̂ = ${f(phat, 6)} (n = ${f(pd.n)}) against p₀ = ${f(p0)}`,
      stat: z,
      statName: 'z',
      p,
      a,
      tail,
      hyp: `H₀: p = ${f(p0)} · H₁: p ${H1[tail.tail]} ${f(p0)}`,
      lines: [{ label: 'Sample proportion', display: f(phat, 8) }, { label: 'Standard error', display: f(se, 6) }],
      notes,
    });
  }

  const sm = summary(c);
  let mu0 = nullValue(c, 'mu')?.v ?? null;
  const xs = values(c.rest);
  // "t test 5.1, 4.9, 5.6 mean 5": with raw data, a lone "mean" is the hypothesised value
  if (mu0 === null && sm.mean !== null && xs.length >= 2 && (sm.s === null || sm.n === null)) {
    mu0 = sm.mean;
    sm.mean = null;
  }
  const fromSummary = sm.mean !== null && (sm.s !== null || sm.sigma !== null) && sm.n !== null;
  if (!fromSummary && xs.length < 2) return need(c, 'Give the data or the sample mean, standard deviation and n (e.g. "mean 52 sd 8 n 30")');
  if (mu0 === null) return need(c, 'What mean are you testing against? (e.g. "against 50" or "mu0 = 50")');

  const useZ = isZ || sm.sigma !== null;
  if (useZ) {
    const sigma = sm.sigma ?? (isZ ? sm.s : null);
    if (sigma === null) return need(c, 'A z-test needs the population standard deviation σ (e.g. "sigma 8")');
    const n = fromSummary ? sm.n! : xs.length;
    const mean = fromSummary ? sm.mean! : meanOf(xs);
    const se = sigma / Math.sqrt(n);
    const z = (mean - mu0) / se;
    const p = pValue(z, tail.tail, normSf);
    const zc = normInv(1 - (1 - conf.level) / 2);
    return testAnswer(c, {
      expression: `One-sample z-test · mean ${f(mean, 8)} (n = ${f(n)}, σ = ${f(sigma)}) against μ₀ = ${f(mu0)}`,
      stat: z,
      statName: 'z',
      p,
      a,
      tail,
      hyp: `H₀: μ = ${f(mu0)} · H₁: μ ${H1[tail.tail]} ${f(mu0)}`,
      lines: [
        { label: 'Standard error', display: f(se, 6) },
        { label: `${pctOf(conf.level)} CI for the mean`, display: `${f(mean - zc * se, 6)} to ${f(mean + zc * se, 6)}` },
      ],
      notes: ['σ treated as known'],
    });
  }
  if (fromSummary) return oneSampleT(c, [], mu0, a, tail, conf, undefined, { mean: sm.mean!, sd: sm.s!, n: sm.n!, fromData: false });
  return oneSampleT(c, xs, mu0, a, tail, conf);
}

// ---------- confidence intervals ----------
export function confInterval(c: Ctx): AnswerResult | null {
  if (!/\bconfidence interval\b|\bconfidence\b|\bci\b|\bc\.i\.|\binterval estimate\b|\bmargin of error\b/.test(c.s)) return null;
  const conf = confidence(c);
  strip(c, /\bconfidence interval\b|\binterval\b|\bci\b|\bc\.i\.|\bmargin of error\b|\bconfidence\b/);
  const zc = normInv(1 - (1 - conf.level) / 2);

  if (/\bproportion\b|\bphat\b|\bout of\b|\bsuccesses\b|\bpercent of\b|\bsaid yes\b/.test(c.s)) {
    const pd = proportionData(c);
    if (!pd) return need(c, 'What was observed? (e.g. "45 out of 100")');
    const phat = 'x' in pd ? pd.x / pd.n : pd.phat;
    const n = pd.n;
    if (!(n > 0) || phat < 0 || phat > 1) fail('The proportion must be between 0 and 1');
    const se = Math.sqrt((phat * (1 - phat)) / n);
    // Wilson score interval, shown alongside
    const z2 = zc * zc;
    const centre = (phat + z2 / (2 * n)) / (1 + z2 / n);
    const half = (zc / (1 + z2 / n)) * Math.sqrt((phat * (1 - phat)) / n + z2 / (4 * n * n));
    const notes = ['Wald (normal-approximation) interval p̂ ± z*·√(p̂(1 − p̂)/n)'];
    if (n * phat < 10 || n * (1 - phat) < 10) notes.push('Fewer than 10 successes or failures; prefer the Wilson interval');
    return interval(c, {
      expression: `${pctOf(conf.level)} confidence interval for a proportion · p̂ = ${f(phat, 6)}, n = ${f(n)}`,
      est: phat,
      me: zc * se,
      level: conf.level,
      stated: conf.stated,
      lines: [
        { label: 'z*', display: f(zc, 7) },
        { label: 'Standard error', display: f(se, 6) },
        { label: 'Wilson interval', display: `${f(centre - half, 6)} to ${f(centre + half, 6)}` },
      ],
      notes,
    });
  }

  const sm = summary(c);
  const fromSummary = sm.mean !== null && (sm.s !== null || sm.sigma !== null) && sm.n !== null;
  let mean: number;
  let n: number;
  let sd: number;
  if (fromSummary) {
    mean = sm.mean!;
    n = sm.n!;
    sd = (sm.sigma ?? sm.s)!;
  } else {
    const xs = values(c.rest);
    if (xs.length < 2) {
      if (sm.mean !== null && sm.n === null) return need(c, 'What is the sample size n?');
      if (sm.mean !== null) return need(c, 'What is the standard deviation?');
      return need(c, 'Give the data or the mean, standard deviation and n (e.g. "mean 50 sd 10 n 25")');
    }
    n = xs.length;
    mean = meanOf(xs);
    sd = sm.sigma ?? Math.sqrt(varianceOf(xs));
  }
  if (!(n >= 2)) fail('Need a sample size of at least 2');
  if (!(sd >= 0)) fail('The standard deviation cannot be negative');
  const se = sd / Math.sqrt(n);
  if (sm.sigma !== null) {
    return interval(c, {
      expression: `${pctOf(conf.level)} z-interval for the mean · x̄ = ${f(mean, 8)}, σ = ${f(sd)}, n = ${f(n)}`,
      est: mean,
      me: zc * se,
      level: conf.level,
      stated: conf.stated,
      lines: [{ label: 'z*', display: f(zc, 7) }, { label: 'Standard error', display: f(se, 6) }],
      notes: ['σ known: normal (z) critical value'],
    });
  }
  const df = n - 1;
  const tc = tInv(1 - (1 - conf.level) / 2, df);
  return interval(c, {
    expression: `${pctOf(conf.level)} t-interval for the mean · x̄ = ${f(mean, 8)}, s = ${f(sd, 8)}, n = ${f(n)}`,
    est: mean,
    me: tc * se,
    level: conf.level,
    stated: conf.stated,
    lines: [{ label: 't*', display: f(tc, 7) }, { label: 'Degrees of freedom', display: String(df) }, { label: 'Standard error', display: f(se, 6) }],
    notes: ['σ unknown: Student t critical value with the sample standard deviation'],
  });
}

