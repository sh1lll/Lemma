import type { AnswerResult } from '@lemma/math-core';
import {
  answer, asMatrix, bad, bracketBlocks, dot, fix, listAfter, matVec, mean, need, num, param, parseNested, pct, rateOf, returnsOf, sampleCov, sampleVar, solve, sum,
  type Lines, type Q, type Table, type Tok,
} from './util';

/**
 * Portfolio mathematics: return and risk from weights and a covariance or correlation matrix, the minimum-variance
 * and maximum-Sharpe (tangency) portfolios, the efficient frontier, CAPM, beta from returns, Sharpe / Sortino /
 * Treynor / Jensen's alpha / information ratio / Calmar, the Kelly criterion, risk parity, and diversification.
 * Optimal weights are the unconstrained (short sales allowed) closed forms of Markowitz (1952) / Merton (1972).
 */

const RET_KEY = /\b(?:expected returns?|mean returns?|returns?|e\[r\]|mus?)\b/;
const VOL_KEY = /\b(?:vols?|volatilit(?:y|ies)|standard deviations?|std devs?|stdevs?|sds?|sigmas?|risks?)\b/;
const COR_KEY = /\b(?:correlations?|corr|rho|ρ)\b/;
const W_KEY = /\b(?:weights?|allocations?|split)\b/;

function frac(t: Tok[] | undefined): number[] | undefined {
  if (!t) return undefined;
  return returnsOf(t);
}

interface Assets {
  mu?: number[];
  vol?: number[];
  cov?: number[][];
  notes: string[];
}

function assets(s: string): Assets | string {
  const notes: string[] = [];
  const covBlock = /\bcov(?:ariance)?(?: matrix)?\b/.test(s) ? bracketBlocks(s.slice(s.search(/\bcov/))).at(0) : undefined;
  const corBlock = /\bcorrelation matrix\b|\bcorr(?:elation)?s?\s*[:=]?\s*\[/.test(s) ? bracketBlocks(s.slice(s.search(/\bcorr/))).at(0) : undefined;
  const mu = frac(listAfter(s, RET_KEY));
  let vol = frac(listAfter(s.replace(/\bdownside\b.*$/, ''), VOL_KEY));
  let cov: number[][] | undefined;
  if (covBlock) {
    const m = asMatrix(parseNested(covBlock));
    if (!m || m.length !== m[0]!.length) return 'The covariance matrix must be square, e.g. [[0.04, 0.006], [0.006, 0.01]]';
    cov = m;
    vol = m.map((r, i) => Math.sqrt(r[i]!));
  } else if (vol) {
    const n = vol.length;
    let C: number[][] | null = null;
    if (corBlock) {
      C = asMatrix(parseNested(corBlock));
      if (!C || C.length !== n) return `The correlation matrix must be ${n}×${n} to match ${n} volatilities`;
    } else {
      const rhos = listAfter(s, COR_KEY)?.map((t) => (t.pct ? t.v / 100 : t.v));
      if (n === 1) C = [[1]];
      else if (!rhos) return '';
      else {
        const pairs = (n * (n - 1)) / 2;
        let vals = rhos;
        if (rhos.length === 1 && pairs > 1) {
          vals = Array(pairs).fill(rhos[0]);
          notes.push(`Same correlation ${num(rhos[0]!)} for every pair`);
        } else if (rhos.length !== pairs) return `${n} assets need ${pairs} correlations (in the order 1-2, 1-3, 2-3…); got ${rhos.length}`;
        C = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
        let k = 0;
        for (let i = 0; i < n; i++)
          for (let j = i + 1; j < n; j++) {
            C[i]![j] = C[j]![i] = vals[k++]!;
          }
      }
      if (C.some((r) => r.some((x) => x < -1 || x > 1))) return 'Correlations must be between −1 and 1';
    }
    cov = C.map((r, i) => r.map((x, j) => x * vol![i]! * vol![j]!));
  }
  return { mu, vol, cov, notes };
}

function weightsOf(s: string, n: number): number[] | undefined {
  const slash = /\b(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?(?:\s*\/\s*(\d+(?:\.\d+)?))?\b/.exec(s);
  let w: number[] | undefined;
  const listed = listAfter(s, W_KEY);
  if (listed) w = listed.map((t) => t.v);
  else if (slash) w = slash.slice(1).filter(Boolean).map(Number);
  else if (n === 2) {
    const m = /(\d+(?:\.\d+)?)%\s*(?:in|of|stocks?|equit|bonds?|asset|a\b)/.exec(s);
    if (m) {
      const a = Number(m[1]) / 100;
      w = [a, 1 - a];
    }
  }
  if (!w) return undefined;
  const tot = sum(w);
  if (tot > 1.5) w = w.map((x) => x / 100);
  return w;
}

function pVar(w: number[], cov: number[][]): number {
  return dot(w, matVec(cov, w));
}

const ones = (n: number) => Array<number>(n).fill(1);

function gmv(cov: number[][]): number[] | null {
  const x = solve(cov, ones(cov.length));
  if (!x) return null;
  const t = sum(x);
  return x.map((v) => v / t);
}

function tangency(cov: number[][], mu: number[], rf: number): number[] | null {
  const x = solve(cov, mu.map((m) => m - rf));
  if (!x) return null;
  const t = sum(x);
  if (Math.abs(t) < 1e-14) return null;
  return x.map((v) => v / t);
}

const wFmt = (w: number[]) => w.map((x) => pct(x, 2)).join(' / ');

function riskTable(w: number[], cov: number[][], mu?: number[], names?: string[]): Table {
  const sp = Math.sqrt(pVar(w, cov));
  const mrc = matVec(cov, w);
  return {
    caption: 'Weights and risk contributions',
    columns: ['Asset', 'Weight', ...(mu ? ['Return'] : []), 'Volatility', 'Risk contribution'],
    rows: w.map((x, i) => [names?.[i] ?? `Asset ${i + 1}`, pct(x), ...(mu ? [pct(mu[i]!)] : []), pct(Math.sqrt(cov[i]![i]!)), pct((x * mrc[i]!) / (sp * sp))]),
  };
}

export function portfolioStats(q: Q): AnswerResult | null {
  const s = q.s;
  if (!/\bportfolio\b|\bdiversification ratio\b/.test(s) || /\b(?:min(?:imum)?[\s-]*var|max(?:imum)?[\s-]*sharpe|tangency|frontier|optimal|risk parity|var\b|value at risk|cvar|expected shortfall|stress|drawdown|kelly|sharpe|sortino|treynor|calmar)\b/i.test(s)) return null;
  const a = assets(s);
  if (typeof a === 'string') return a ? bad(q, 'portfolio', a) : need(q, 'portfolio', 'What is the correlation between the assets? e.g. "correlation 0.2"');
  const n = a.vol?.length ?? a.mu?.length ?? 0;
  if (!n) return null;
  const w = weightsOf(s, n);
  if (!w) return need(q, 'portfolio', 'What are the weights? e.g. "60/40" or "weights 0.5 0.3 0.2"');
  if (w.length !== n) return bad(q, 'portfolio', `${w.length} weights for ${n} assets`);
  const notes = [...a.notes];
  if (Math.abs(sum(w) - 1) > 1e-6) notes.push(`Weights sum to ${pct(sum(w))}, not 100%`);
  const rf = rateOf(param(s, String.raw`risk[- ]?free(?: rate)?|rf|r_f|cash(?: rate)?|t-?bill(?: rate)?`), notes, 'risk-free rate');
  const lines: Lines = [];
  let er: number | undefined;
  if (a.mu) {
    if (a.mu.length !== n) return bad(q, 'portfolio', `${a.mu.length} returns for ${n} assets`);
    er = dot(w, a.mu);
  }
  if (!a.cov) {
    if (er === undefined) return null;
    return answer(q, {
      kind: 'portfolio',
      expression: `Portfolio return · weights ${wFmt(w)}, returns ${a.mu!.map((x) => pct(x)).join(', ')}`,
      display: pct(er),
      value: er * 100,
      notes: [...notes, 'E[Rp] = Σ wᵢ·E[Rᵢ]; add volatilities and a correlation for the risk'],
    });
  }
  const sp = Math.sqrt(pVar(w, a.cov));
  const wavg = dot(w, a.vol!);
  if (er !== undefined) lines.push({ label: 'Volatility', display: pct(sp) });
  lines.push({ label: 'Variance', display: fix(sp * sp, 6) });
  if (er !== undefined && rf !== undefined) lines.push({ label: `Sharpe ratio (rf ${pct(rf)})`, display: fix((er - rf) / sp, 4) });
  lines.push({ label: 'Weighted average volatility', display: pct(wavg) }, { label: 'Diversification ratio', display: fix(wavg / sp, 4) });
  const wantRatio = /diversification ratio/.test(s);
  return answer(q, {
    kind: 'portfolio',
    expression: `Portfolio · weights ${wFmt(w)}${a.mu ? `, returns ${a.mu.map((x) => pct(x)).join(', ')}` : ''}, vols ${a.vol!.map((x) => pct(x)).join(', ')}`,
    display: wantRatio ? fix(wavg / sp, 4) : er !== undefined ? pct(er) : pct(sp),
    value: wantRatio ? wavg / sp : er !== undefined ? er * 100 : sp * 100,
    unit: wantRatio ? 'diversification ratio' : er !== undefined ? 'expected return' : 'volatility',
    lines,
    table: riskTable(w, a.cov, a.mu),
    notes: [...notes, 'σp² = Σᵢ Σⱼ wᵢwⱼρᵢⱼσᵢσⱼ; diversification ratio = Σ wᵢσᵢ ÷ σp'],
  });
}

export function optimalPortfolio(q: Q): AnswerResult | null {
  const s = q.s;
  const isMin = /\bmin(?:imum)?[\s-]*var(?:iance)?\b|\bglobal minimum\b|\bgmv\b|\bmin(?:imum)?[\s-]*(?:risk|vol(?:atility)?)\b/.test(s);
  const isMax = /\bmax(?:imum|imise|imize)?[\s-]*sharpe\b|\btangency\b|\boptimal risky\b|\bmarket portfolio\b/.test(s);
  const isFront = /\befficient frontier\b|\bmean[\s-]*variance frontier\b|\bfrontier\b/.test(s);
  if (!isMin && !isMax && !isFront) return null;
  if (!/portfolio|weights?|frontier|assets?|stocks?|vols?|volatilit/.test(s)) return null;
  const a = assets(s);
  if (typeof a === 'string') return a ? bad(q, 'portfolio', a) : need(q, 'portfolio', 'What is the correlation between the assets? e.g. "correlation 0.2"');
  if (!a.cov) return need(q, 'portfolio', 'Give the volatilities and correlation(s) (or a covariance matrix), e.g. "vols 15% 5% correlation 0.2"');
  const n = a.cov.length;
  if (n < 2) return bad(q, 'portfolio', 'Need at least two assets');
  const notes = [...a.notes];
  const rf = rateOf(param(s, String.raw`risk[- ]?free(?: rate)?|rf|r_f|cash(?: rate)?|t-?bill(?: rate)?`), notes, 'risk-free rate');
  if ((isMax || isFront) && !a.mu) return need(q, 'portfolio', 'What are the expected returns? e.g. "returns 8% and 4%"');
  if (a.mu && a.mu.length !== n) return bad(q, 'portfolio', `${a.mu.length} returns for ${n} assets`);
  const g = gmv(a.cov);
  if (!g) return bad(q, 'portfolio', 'The covariance matrix is singular (perfectly correlated assets?), so the optimum is not unique');
  const stats = (w: number[]) => ({ er: a.mu ? dot(w, a.mu) : undefined, sd: Math.sqrt(pVar(w, a.cov!)) });
  const short = (w: number[]) => (w.some((x) => x < -1e-9) ? ['Negative weight = short sale (unconstrained solution)'] : []);
  if (isMax && !isFront) {
    if (rf === undefined) return need(q, 'portfolio', 'The maximum-Sharpe portfolio needs the risk-free rate, e.g. "rf 2%"');
    const w = tangency(a.cov, a.mu!, rf);
    if (!w) return bad(q, 'portfolio', 'No tangency portfolio exists for these inputs');
    const st = stats(w);
    const sh = (st.er! - rf) / st.sd;
    if (sh < 0) notes.push('Every asset returns less than the risk-free rate here, so the "tangency" portfolio is on the inefficient side');
    return answer(q, {
      kind: 'portfolio',
      expression: `Maximum-Sharpe (tangency) portfolio · returns ${a.mu!.map((x) => pct(x)).join(', ')}, vols ${a.vol!.map((x) => pct(x)).join(', ')}, rf ${pct(rf)}`,
      display: wFmt(w),
      value: w[0]! * 100,
      unit: 'weights',
      lines: [
        { label: 'Expected return', display: pct(st.er!) },
        { label: 'Volatility', display: pct(st.sd) },
        { label: 'Sharpe ratio', display: fix(sh, 4) },
      ],
      table: riskTable(w, a.cov, a.mu),
      notes: [...notes, 'w ∝ Σ⁻¹(μ − rf·1), scaled to sum to 1', ...short(w)],
    });
  }
  if (isMin && !isFront) {
    const st = stats(g);
    const lines: Lines = [{ label: 'Volatility', display: pct(st.sd) }];
    if (st.er !== undefined) lines.unshift({ label: 'Expected return', display: pct(st.er) });
    if (n === 2) {
      const [s1, s2] = [a.vol![0]!, a.vol![1]!];
      const c = a.cov[0]![1]!;
      lines.push({ label: 'Formula', display: `w₁ = (σ₂² − σ₁₂) ÷ (σ₁² + σ₂² − 2σ₁₂) = ${fix((s2 * s2 - c) / (s1 * s1 + s2 * s2 - 2 * c), 4)}` });
    }
    return answer(q, {
      kind: 'portfolio',
      expression: `Minimum-variance portfolio · vols ${a.vol!.map((x) => pct(x)).join(', ')}`,
      display: wFmt(g),
      value: g[0]! * 100,
      unit: 'weights',
      lines,
      table: riskTable(g, a.cov, a.mu),
      notes: [...notes, 'w = Σ⁻¹1 ÷ (1ᵀΣ⁻¹1)', ...short(g)],
    });
  }
  // Frontier: n = 2 sweeps the weight; n ≥ 3 uses the two-fund closed form between the GMV and a second frontier portfolio.
  const mu = a.mu!;
  const rows: string[][] = [];
  const tan = rf !== undefined ? tangency(a.cov, mu, rf) : null;
  let highlight: number | undefined;
  if (n === 2) {
    for (let k = 0; k <= 10; k++) {
      const w = [k / 10, 1 - k / 10];
      const st = stats(w);
      rows.push([wFmt(w), pct(st.er!), pct(st.sd), ...(rf !== undefined ? [fix((st.er! - rf) / st.sd, 3)] : [])]);
    }
    rows.push([`${wFmt(g)} (min variance)`, pct(stats(g).er!), pct(stats(g).sd), ...(rf !== undefined ? [fix((stats(g).er! - rf) / stats(g).sd, 3)] : [])]);
    highlight = rows.length - 1;
  } else {
    const inv1 = solve(a.cov, ones(n))!;
    const invMu = solve(a.cov, mu)!;
    const A = sum(inv1);
    const B = sum(invMu);
    const C = dot(mu, invMu);
    const Dd = A * C - B * B;
    const lo = B / A;
    const hi = Math.max(...mu) * 1.25;
    for (let k = 0; k <= 8; k++) {
      const target = lo + ((hi - lo) * k) / 8;
      const l1 = (C - B * target) / Dd;
      const l2 = (A * target - B) / Dd;
      const w = inv1.map((x, i) => l1 * x + l2 * invMu[i]!);
      const sd = Math.sqrt(pVar(w, a.cov));
      rows.push([wFmt(w), pct(target), pct(sd), ...(rf !== undefined ? [fix((target - rf) / sd, 3)] : [])]);
    }
    highlight = 0;
  }
  const lines: Lines = [{ label: 'Minimum-variance weights', display: wFmt(g) }, { label: 'Minimum volatility', display: pct(stats(g).sd) }];
  if (tan) lines.push({ label: 'Tangency weights', display: wFmt(tan) }, { label: 'Max Sharpe', display: fix((stats(tan).er! - rf!) / stats(tan).sd, 4) });
  return answer(q, {
    kind: 'portfolio',
    expression: `Efficient frontier · returns ${mu.map((x) => pct(x)).join(', ')}, vols ${a.vol!.map((x) => pct(x)).join(', ')}`,
    display: `min σ ${pct(stats(g).sd)} at ${pct(stats(g).er!)}`,
    value: stats(g).sd * 100,
    lines,
    table: { caption: n === 2 ? 'Frontier (weight sweep)' : 'Frontier points (short sales allowed)', columns: ['Weights', 'Return', 'Volatility', ...(rf !== undefined ? ['Sharpe'] : [])], rows, highlightRow: highlight },
    notes: [...notes, 'Points above the minimum-variance portfolio are efficient'],
  });
}

export function capm(q: Q): AnswerResult | null {
  const s = q.s;
  if (!/\bcapm\b|\bsecurity market line\b|\bsml\b|\b(?:expected|required) return\b.*\bbeta\b|\bbeta\b.*\b(?:market (?:return|premium)|risk[- ]?free)\b|\bcost of equity\b.*\bbeta\b/.test(s)) return null;
  if (/\b(?:treynor|jensen|alpha|sharpe|sortino)\b/.test(s)) return null;
  if (listAfter(s, /\bmarket returns?\b/)?.length! > 2) return null;
  const notes: string[] = [];
  const beta = param(s, String.raw`beta|β|b`)?.v;
  const rf = rateOf(param(s, String.raw`risk[- ]?free(?: rate)?|rf|r_f|t-?bill(?: rate)?|treasury(?: rate| yield)?`), notes, 'risk-free rate');
  const prem = rateOf(param(s, String.raw`market (?:risk )?premium|mrp|equity (?:risk )?premium|erp|risk premium`), notes, 'premium');
  const rm = rateOf(param(s, String.raw`market(?: portfolio)?(?: return)?|expected market return|rm|r_m|e\(rm\)|index return`), notes, 'market return');
  if (beta === undefined) return need(q, 'capm', 'What is the beta?');
  if (rf === undefined) return need(q, 'capm', 'What is the risk-free rate?');
  if (prem === undefined && rm === undefined) return need(q, 'capm', 'What is the expected market return (or the market risk premium)?');
  const mp = prem ?? rm! - rf;
  const er = rf + beta * mp;
  const actual = rateOf(param(s, String.raw`actual return|forecast return|analyst(?:'s)? (?:forecast|estimate)|expected to return|realized return`), notes);
  const lines: Lines = [{ label: 'Market risk premium', display: pct(mp) }, { label: 'Risk premium (β × MRP)', display: pct(beta * mp) }];
  if (actual !== undefined) lines.push({ label: 'Alpha vs forecast', display: `${pct(actual - er)} (${actual > er ? 'under-priced: above the SML' : actual < er ? 'over-priced: below the SML' : 'on the SML'})` });
  return answer(q, {
    kind: 'capm',
    expression: `CAPM · β=${num(beta)}, rf=${pct(rf)}, ${prem !== undefined ? `MRP=${pct(prem)}` : `E[Rm]=${pct(rm!)}`}`,
    display: pct(er),
    value: er * 100,
    unit: 'expected return',
    lines,
    notes: [...notes, 'E[R] = rf + β·(E[Rm] − rf)'],
  });
}

function twoSeries(s: string): { a: number[]; b: number[]; notes: string[] } | null {
  const notes: string[] = [];
  const bKey = /\b(?:market(?: returns?)?|benchmark(?: returns?)?|index(?: returns?)?|s&p(?: 500)?(?: returns?)?)\b/;
  const aKey = /\b(?:stock|asset|portfolio|fund|security|strategy|manager)?\s*returns?\b|\bstock\b|\bportfolio\b|\bfund\b/;
  const bIdx = s.search(bKey);
  const aText = bIdx >= 0 ? s.slice(0, bIdx) : s;
  const aT = listAfter(aText, aKey) ?? listAfter(aText, /\bof\b/);
  const bT = bIdx >= 0 ? listAfter(s.slice(bIdx), bKey) : undefined;
  if (!aT || !bT) return null;
  const all = [...aT, ...bT];
  const scale = all.some((t) => t.pct) || !all.every((t) => Math.abs(t.v) <= 1) ? 0.01 : 1;
  if (scale === 0.01 && !all.some((t) => t.pct)) notes.push('Read the returns as percentages');
  return { a: aT.map((t) => t.v * scale), b: bT.map((t) => t.v * scale), notes };
}

export function betaFromReturns(q: Q): AnswerResult | null {
  const s = q.s;
  if (!/\bbeta\b/.test(s) || /\bcapm\b/.test(s)) return null;
  const ser = twoSeries(s);
  if (!ser || ser.a.length < 3) return null;
  const { a, b, notes } = ser;
  if (a.length !== b.length) return bad(q, 'beta', `The two return series have different lengths (${a.length} and ${b.length})`);
  const vb = sampleVar(b);
  if (vb === 0) return bad(q, 'beta', 'The market returns do not vary, so beta is undefined');
  const beta = sampleCov(a, b) / vb;
  const alpha = mean(a) - beta * mean(b);
  const corr = sampleCov(a, b) / Math.sqrt(sampleVar(a) * vb);
  return answer(q, {
    kind: 'beta',
    expression: `Beta from ${a.length} paired returns`,
    display: fix(beta, 4),
    value: beta,
    lines: [
      { label: 'Alpha (intercept, per period)', display: pct(alpha, 3) },
      { label: 'Correlation', display: fix(corr, 4) },
      { label: 'R²', display: fix(corr * corr, 4) },
      { label: 'Covariance', display: fix(sampleCov(a, b), 8) },
      { label: 'Market variance', display: fix(vb, 8) },
    ],
    notes: [...notes, 'β = Cov(Rᵢ, Rm) ÷ Var(Rm) (sample, n − 1) = the OLS slope of the stock on the market'],
  });
}

function maxDD(values: number[]): { dd: number; peak: number; trough: number } {
  let peak = values[0]!;
  let pk = 0;
  let best = { dd: 0, peak: 0, trough: 0 };
  values.forEach((v, i) => {
    if (v > peak) {
      peak = v;
      pk = i;
    }
    const dd = (v - peak) / peak;
    if (dd < best.dd) best = { dd, peak: pk, trough: i };
  });
  return best;
}

const PERIODS: [RegExp, number, string][] = [
  [/\bdaily\b/, 252, 'daily'],
  [/\bweekly\b/, 52, 'weekly'],
  [/\bmonthly\b/, 12, 'monthly'],
  [/\bquarterly\b/, 4, 'quarterly'],
];

export function ratios(q: Q): AnswerResult | null {
  const s = q.s;
  const m = /\b(sharpe|sortino|treynor|jensen'?s?(?: alpha)?|information ratio|calmar|modigliani)\b/.exec(s);
  if (!m || /\bmax(?:imum|imise|imize)?[\s-]*sharpe\b|\btangency\b/.test(s)) return null;
  const which = m[1]!.startsWith('jensen') ? 'jensen' : m[1]!.startsWith('information') ? 'ir' : m[1]!.startsWith('m') ? 'm2' : m[1]!;
  const notes: string[] = [];
  const rf = rateOf(param(s, String.raw`risk[- ]?free(?: rate)?|rf|r_f|t-?bill(?: rate)?|cash(?: rate)?`), notes, 'risk-free rate');
  const per = PERIODS.find(([re]) => re.test(s));
  const series = listAfter(s, /\breturns?\b/) ?? listAfter(s, /\bof\b/);
  const isSeries = series && series.length >= 3;
  const rp = rateOf(param(s, String.raw`(?:portfolio |fund |annual(?:ized)? |average |expected |mean )?returns?|rp|r_p|cagr`), notes, 'return');
  const vol = rateOf(param(s, String.raw`vol(?:atility)?|standard deviation|std(?: dev)?|sd|sigma|total risk`), notes, 'volatility');
  const beta = param(s, String.raw`beta|β`)?.v;
  const rm = rateOf(param(s, String.raw`market(?: return)?|rm|r_m|benchmark return`), notes, 'market return');
  const label = { sharpe: 'Sharpe ratio', sortino: 'Sortino ratio', treynor: 'Treynor ratio', jensen: "Jensen's alpha", ir: 'Information ratio', calmar: 'Calmar ratio', m2: 'M² (Modigliani)' }[which]!;

  if (isSeries && ['sharpe', 'sortino', 'calmar', 'ir'].includes(which)) {
    if (which === 'ir') {
      const ser = twoSeries(s);
      if (!ser) return need(q, 'ratio', 'The information ratio from data needs two series, e.g. "information ratio of returns 1%, 2%, … vs benchmark 0.5%, 1.5%, …"');
      if (ser.a.length !== ser.b.length) return bad(q, 'ratio', 'The portfolio and benchmark series have different lengths');
      const act = ser.a.map((x, i) => x - ser.b[i]!);
      const te = Math.sqrt(sampleVar(act));
      const ir = mean(act) / te;
      const lines: Lines = [{ label: 'Mean active return', display: pct(mean(act), 3) }, { label: 'Tracking error', display: pct(te, 3) }];
      if (per) lines.push({ label: `Annualized (× √${per[1]})`, display: fix(ir * Math.sqrt(per[1]), 4) });
      return answer(q, { kind: 'ratio', expression: `Information ratio from ${act.length} periods`, display: fix(ir, 4), value: ir, lines, notes: [...ser.notes, 'IR = mean(Rp − Rb) ÷ sd(Rp − Rb) (per period, sample sd)'] });
    }
    if (which === 'calmar') {
      const vals = series.map((t) => t.v);
      const asPrices = !series.some((t) => t.pct) && vals.every((v) => v > 0) && vals.some((v) => v > 1);
      const curve = asPrices ? vals : (() => {
        const rs = returnsOf(series, notes);
        const out = [1];
        for (const r of rs) out.push(out[out.length - 1]! * (1 + r));
        return out;
      })();
      if (!per) return need(q, 'ratio', 'How often are the observations (daily, weekly, monthly)? The Calmar ratio needs the annual return');
      const yrs = (curve.length - 1) / per[1];
      const cagr = (curve[curve.length - 1]! / curve[0]!) ** (1 / yrs) - 1;
      const dd = maxDD(curve);
      if (dd.dd === 0) return bad(q, 'ratio', 'There is no drawdown in this series, so the Calmar ratio is undefined');
      const c = cagr / Math.abs(dd.dd);
      return answer(q, {
        kind: 'ratio',
        expression: `Calmar ratio from ${curve.length} ${per[2]} ${asPrices ? 'values' : 'returns'}`,
        display: fix(c, 4),
        value: c,
        lines: [{ label: 'CAGR', display: pct(cagr) }, { label: 'Max drawdown', display: pct(dd.dd) }],
        notes: [...notes, 'Calmar = annualized return ÷ |maximum drawdown|'],
      });
    }
    const rs = returnsOf(series, notes);
    const rfp = rf !== undefined ? (per && !/per[\s-]*period/.test(s) ? rf / per[1] : rf) : 0;
    if (rf !== undefined && per) notes.push(`Risk-free ${pct(rf)} a year ÷ ${per[1]} per period`);
    if (rf === undefined) notes.push('Risk-free rate 0 (say "rf 2%" to change)');
    const ex = rs.map((r) => r - rfp);
    const mu = mean(ex);
    let ratio: number;
    const lines: Lines = [{ label: 'Mean return per period', display: pct(mean(rs), 3) }];
    if (which === 'sharpe') {
      const sd = Math.sqrt(sampleVar(rs));
      ratio = mu / sd;
      lines.push({ label: 'Standard deviation (sample)', display: pct(sd, 3) });
      notes.push('Sharpe = mean(R − rf) ÷ sd(R)');
    } else {
      const tP = param(s, String.raw`target(?: return)?|mar|minimum acceptable(?: return)?|threshold`);
      const T = tP ? rateOf(tP)! : rfp;
      const dd = Math.sqrt(rs.reduce((a2, r) => a2 + Math.min(0, r - T) ** 2, 0) / rs.length);
      if (dd === 0) return bad(q, 'ratio', 'No return falls below the target, so downside deviation is 0 and the Sortino ratio is undefined');
      ratio = (mean(rs) - T) / dd;
      lines.push({ label: `Downside deviation (target ${pct(T, 3)})`, display: pct(dd, 3) });
      notes.push('Sortino = (mean R − target) ÷ √(Σ min(0, R − target)² ÷ n)');
    }
    const ann = per ? ratio * Math.sqrt(per[1]) : undefined;
    if (ann !== undefined) lines.push({ label: 'Per period', display: fix(ratio, 4) });
    return answer(q, {
      kind: 'ratio',
      expression: `${label} from ${rs.length} ${per ? per[2] : ''} returns`.replace(/\s+/g, ' '),
      display: fix(ann ?? ratio, 4),
      value: ann ?? ratio,
      unit: ann !== undefined ? `annualized (× √${per![1]})` : 'per period',
      lines,
      notes,
    });
  }

  const ask = (what: string) => need(q, 'ratio', `${label} needs ${what}`);
  let val: number;
  let formula: string;
  const lines: Lines = [];
  switch (which) {
    case 'sharpe':
      if (rp === undefined || vol === undefined) return ask('the portfolio return, the risk-free rate and the volatility, e.g. "Sharpe ratio return 12% rf 2% vol 15%"');
      if (rf === undefined) notes.push('Risk-free rate 0 (say "rf 2%" to change)');
      val = (rp - (rf ?? 0)) / vol;
      formula = 'Sharpe = (Rp − rf) ÷ σp';
      break;
    case 'sortino': {
      const dd = rateOf(param(s, String.raw`downside (?:deviation|risk|vol(?:atility)?|sd)|semi[\s-]*deviation|dd`), notes);
      const tP = param(s, String.raw`target(?: return)?|mar|minimum acceptable(?: return)?`);
      const T = tP ? rateOf(tP)! : rf ?? 0;
      if (rp === undefined || dd === undefined) return ask('the return and the downside deviation, e.g. "Sortino return 12% rf 2% downside deviation 8%"');
      val = (rp - T) / dd;
      formula = 'Sortino = (Rp − target) ÷ downside deviation';
      break;
    }
    case 'treynor':
      if (rp === undefined || beta === undefined || rf === undefined) return ask('the return, the risk-free rate and beta');
      val = (rp - rf) / beta;
      formula = 'Treynor = (Rp − rf) ÷ β';
      return answer(q, { kind: 'ratio', expression: `Treynor ratio · Rp=${pct(rp)}, rf=${pct(rf)}, β=${num(beta)}`, display: pct(val, 2), value: val, lines, notes: [...notes, formula, 'Excess return per unit of systematic risk'] });
    case 'jensen': {
      if (rp === undefined || beta === undefined || rf === undefined || rm === undefined) return ask('the portfolio return, the risk-free rate, beta and the market return');
      const req = rf + beta * (rm - rf);
      val = rp - req;
      lines.push({ label: 'CAPM required return', display: pct(req) });
      return answer(q, { kind: 'ratio', expression: `Jensen's alpha · Rp=${pct(rp)}, rf=${pct(rf)}, β=${num(beta)}, Rm=${pct(rm)}`, display: pct(val), value: val * 100, lines, notes: [...notes, "α = Rp − [rf + β(Rm − rf)]", val > 0 ? 'Positive: beat its CAPM benchmark' : 'Negative: lagged its CAPM benchmark'] });
    }
    case 'ir': {
      const rb = rateOf(param(s, String.raw`benchmark(?: return)?|rb|r_b|index return|market(?: return)?`), notes);
      const te = rateOf(param(s, String.raw`tracking error|te|active risk`), notes);
      if (rp === undefined || rb === undefined || te === undefined) return ask('the portfolio return, the benchmark return and the tracking error');
      val = (rp - rb) / te;
      lines.push({ label: 'Active return', display: pct(rp - rb) });
      formula = 'IR = (Rp − Rb) ÷ tracking error';
      break;
    }
    case 'calmar': {
      const dd = rateOf(param(s, String.raw`max(?:imum)? drawdown|mdd|drawdown`), notes);
      if (rp === undefined || dd === undefined) return ask('the annual return (CAGR) and the maximum drawdown');
      val = rp / Math.abs(dd);
      formula = 'Calmar = annual return ÷ |max drawdown|';
      break;
    }
    default: {
      // M²: (Sharpe_p × σ_m) + rf
      const vm = rateOf(param(s, String.raw`market vol(?:atility)?|benchmark vol(?:atility)?|σm|sigma_?m`), notes);
      if (rp === undefined || vol === undefined || rf === undefined || vm === undefined) return ask('the return, volatility, risk-free rate and market volatility');
      val = ((rp - rf) / vol) * vm + rf;
      return answer(q, { kind: 'ratio', expression: `M² · Rp=${pct(rp)}, σp=${pct(vol)}, rf=${pct(rf)}, σm=${pct(vm)}`, display: pct(val), value: val * 100, notes: [...notes, 'M² = rf + Sharpe × σm: the return at market risk'] });
    }
  }
  return answer(q, {
    kind: 'ratio',
    expression: `${label} · ${[rp !== undefined ? `Rp=${pct(rp)}` : '', rf !== undefined ? `rf=${pct(rf)}` : '', vol !== undefined && which === 'sharpe' ? `σ=${pct(vol)}` : ''].filter(Boolean).join(', ')}`,
    display: fix(val, 4),
    value: val,
    lines,
    notes: [...notes, formula],
  });
}

export function kelly(q: Q): AnswerResult | null {
  const s = q.s;
  if (!/\bkelly\b/.test(s)) return null;
  const notes: string[] = [];
  const mu = rateOf(param(s, String.raw`mu|drift|expected (?:excess )?return|mean return|return`), notes, 'expected return');
  const vol = rateOf(param(s, String.raw`sigma|vol(?:atility)?|standard deviation|sd`), notes, 'volatility');
  const pP = param(s, String.raw`win(?:ning)? (?:prob(?:ability)?|rate|chance|%)|p|prob(?:ability)?(?: of (?:winning|success))?|chance(?: of winning)?|win`);
  if (mu !== undefined && vol !== undefined && !pP) {
    const rf = rateOf(param(s, String.raw`risk[- ]?free(?: rate)?|rf|r`), notes) ?? 0;
    const f = (mu - rf) / (vol * vol);
    return answer(q, {
      kind: 'kelly',
      expression: `Continuous Kelly · μ=${pct(mu)}, rf=${pct(rf)}, σ=${pct(vol)}`,
      display: `${fix(f, 4)}× (${pct(f, 1)})`,
      value: f,
      unit: 'leverage',
      lines: [
        { label: 'Half Kelly', display: `${fix(f / 2, 4)}×` },
        { label: 'Growth rate at full Kelly', display: pct(rf + (mu - rf) ** 2 / (2 * vol * vol)) },
      ],
      notes: [...notes, 'f* = (μ − r) ÷ σ² for a lognormal asset (Merton/Thorp)', ...(f > 1 ? ['Above 1 means borrowing to invest'] : [])],
    });
  }
  if (!pP) return need(q, 'kelly', 'Kelly needs the win probability and the odds, e.g. "kelly win probability 60% odds 1:1"');
  const p = pP.pct || pP.v > 1 ? pP.v / 100 : pP.v;
  if (!(p > 0 && p < 1)) return bad(q, 'kelly', 'The win probability must be between 0 and 1');
  let b: number | undefined;
  const ratio = /(\d+(?:\.\d+)?)\s*(?::|to)\s*(\d+(?:\.\d+)?)/.exec(s.replace(/\d+(?:\.\d+)?%/g, ''));
  const dec = param(s, String.raw`decimal odds`);
  if (dec) b = dec.v - 1;
  else if (/even money|evens\b/.test(s)) b = 1;
  else if (ratio && /odds|pays|payout|reward/.test(s)) b = Number(ratio[1]) / Number(ratio[2]);
  else b = param(s, String.raw`odds|b|net odds|payoff(?: ratio)?|win[\s/-]*loss ratio|reward[\s-]*(?:to[\s-]*)?risk(?: ratio)?|pays|payout|win size|avg win(?:\/loss)?`)?.v;
  if (b === undefined) return need(q, 'kelly', 'What are the net odds (how much you win per 1 risked)? e.g. "odds 2:1" or "b = 2"');
  if (!(b > 0)) return bad(q, 'kelly', 'The odds must be positive');
  const lossP = param(s, String.raw`loss fraction|lose fraction|lose`);
  const a = lossP ? (lossP.pct || lossP.v > 1 ? lossP.v / 100 : lossP.v) : 1;
  const f = p / a - (1 - p) / b;
  const growth = (x: number) => p * Math.log(1 + b! * x) + (1 - p) * Math.log(1 - a * x);
  const lines: Lines = [
    { label: 'Edge (expected gain per 1 bet)', display: fix(p * b - (1 - p) * a, 4) },
    { label: 'Half Kelly', display: pct(f / 2) },
  ];
  if (f > 0 && f * a < 1) lines.push({ label: 'Expected log growth per bet', display: fix(growth(f), 6) });
  return answer(q, {
    kind: 'kelly',
    expression: `Kelly criterion · p=${num(p)}, net odds b=${num(b)}${a !== 1 ? `, loss fraction ${num(a)}` : ''}`,
    display: f <= 0 ? '0% (no edge: do not bet)' : pct(f),
    value: Math.max(0, f) * 100,
    unit: 'of bankroll',
    lines,
    notes: [...notes, a === 1 ? 'f* = p − (1 − p) ÷ b' : 'f* = p/a − (1 − p)/b', ...(f <= 0 ? [`The raw formula gives ${pct(f)}: the bet has negative expectation`] : [])],
  });
}

export function riskParity(q: Q): AnswerResult | null {
  const s = q.s;
  if (!/\brisk parity\b|\bequal risk contribution\b|\berc\b|\binverse[\s-]*vol(?:atility)?\b/.test(s)) return null;
  const a = assets(s);
  if (typeof a === 'string' && a) return bad(q, 'risk-parity', a);
  const vol = typeof a === 'string' ? frac(listAfter(s, VOL_KEY)) : a.vol;
  if (!vol || vol.length < 2) return need(q, 'risk-parity', 'Give the volatilities, e.g. "risk parity weights vols 10% 20% 30%"');
  const notes = typeof a === 'string' ? [] : [...a.notes];
  const cov = typeof a === 'string' ? undefined : a.cov;
  const n = vol.length;
  const inv = vol.map((v) => 1 / v);
  const naive = inv.map((x) => x / sum(inv));
  if (!cov || /inverse[\s-]*vol/.test(s)) {
    if (!cov) notes.push('No correlations given: inverse-volatility weights (exact risk parity when correlations are equal)');
    return answer(q, {
      kind: 'risk-parity',
      expression: `Inverse-volatility weights · vols ${vol.map((v) => pct(v)).join(', ')}`,
      display: wFmt(naive),
      value: naive[0]! * 100,
      unit: 'weights',
      table: { caption: 'Weights', columns: ['Asset', 'Volatility', 'Weight'], rows: naive.map((w, i) => [`Asset ${i + 1}`, pct(vol[i]!), pct(w)]) },
      notes: [...notes, 'wᵢ = (1/σᵢ) ÷ Σ (1/σⱼ)'],
    });
  }
  // Equal risk contribution: minimise ½yᵀΣy − (1/n)Σ ln yᵢ (Spinu 2013) by damped Newton, then normalise.
  let y = naive.map((w) => w / Math.sqrt(pVar(naive, cov)));
  for (let it = 0; it < 100; it++) {
    const Sy = matVec(cov, y);
    const grad = Sy.map((v, i) => v - 1 / (n * y[i]!));
    if (Math.max(...grad.map(Math.abs)) < 1e-13) break;
    const H = cov.map((r, i) => r.map((v, j) => v + (i === j ? 1 / (n * y[i]! ** 2) : 0)));
    const step = solve(H, grad);
    if (!step) break;
    let t = 1;
    while (y.some((v, i) => v - t * step[i]! <= 0) && t > 1e-8) t /= 2;
    y = y.map((v, i) => v - t * step[i]!);
  }
  const w = y.map((v) => v / sum(y));
  return answer(q, {
    kind: 'risk-parity',
    expression: `Risk parity (equal risk contribution) · vols ${vol.map((v) => pct(v)).join(', ')}`,
    display: wFmt(w),
    value: w[0]! * 100,
    unit: 'weights',
    lines: [
      { label: 'Portfolio volatility', display: pct(Math.sqrt(pVar(w, cov))) },
      { label: 'Inverse-volatility weights (for comparison)', display: wFmt(naive) },
    ],
    table: riskTable(w, cov),
    notes: [...notes, 'Each asset contributes the same share of portfolio variance: wᵢ(Σw)ᵢ = σp² ÷ n'],
  });
}

export function diversification(q: Q): AnswerResult | null {
  const s = q.s;
  if (!/\bdiversif\w*\b|\bequally[\s-]*weighted\b/.test(s) || /\bdiversification ratio\b/.test(s)) return null;
  const nM = /(\d+)\s*(?:equally[\s-]*weighted\s*)?(?:assets|stocks|securities|holdings|positions|shares)\b/.exec(s);
  const n = nM ? Number(nM[1]) : param(s, String.raw`n|number of (?:assets|stocks)`)?.v;
  const notes: string[] = [];
  const vol = rateOf(param(s, String.raw`(?:average |avg )?(?:vol(?:atility)?|standard deviation|sd|sigma|risk)(?: of each| each)?`), notes, 'volatility');
  const rho = param(s, String.raw`(?:average |avg |pairwise )?(?:correlation|corr|rho)`);
  if (n === undefined || vol === undefined || !rho) return null;
  const r = rho.pct ? rho.v / 100 : rho.v;
  const v2 = vol * vol * (1 / n + (1 - 1 / n) * r);
  if (v2 < 0) return bad(q, 'diversification', 'These inputs give a negative variance: the correlation is too negative for that many assets');
  const sp = Math.sqrt(v2);
  const limit = vol * Math.sqrt(Math.max(0, r));
  return answer(q, {
    kind: 'diversification',
    expression: `${n} equally weighted assets · σ=${pct(vol)}, ρ=${num(r)}`,
    display: pct(sp),
    value: sp * 100,
    unit: 'portfolio volatility',
    lines: [
      { label: 'Risk reduction vs one asset', display: pct(1 - sp / vol) },
      { label: 'Limit as n → ∞ (systematic risk)', display: pct(limit) },
    ],
    notes: [...notes, 'σp² = σ²[1/n + (1 − 1/n)ρ]'],
  });
}

export { maxDD };
