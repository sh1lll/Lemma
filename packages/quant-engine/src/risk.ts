import type { AnswerResult } from '@lemma/math-core';
import { maxDD } from './portfolio';
import {
  answer, bad, fix, gaussian, listAfter, mean, money, N, need, Ninv, NUM, num, param, paramEither, pct, pdf, rateOf, returnsOf, rng, sampleVar, sum,
  type Lines, type Q, type Tok,
} from './util';

/**
 * Risk and trading maths: historical / parametric / Monte Carlo VaR and expected shortfall, maximum drawdown,
 * credit expected loss (PD × LGD × EAD), stress scenarios, trade expectancy, position sizing by risk, slippage and
 * transaction costs, compounding of returns (CAGR vs arithmetic mean), and annualising volatility and returns.
 */

function confidence(s: string): number | undefined {
  const m = /(\d{2}(?:\.\d+)?)%\s*(?:confidence|var|cvar|es|expected shortfall|value at risk|level|one-tailed|1-tailed)?/.exec(s);
  const c = param(s, String.raw`confidence(?: level)?|alpha|cl`);
  const v = c ? (c.pct || c.v > 1 ? c.v / 100 : c.v) : m && Number(m[1]) >= 80 ? Number(m[1]) / 100 : undefined;
  return v;
}

function horizon(s: string): { days: number; label: string } {
  const m = /(\d+)[\s-]*(?:trading )?(day|week|month|year)s?\b(?! of data)/.exec(s);
  if (!m) return { days: 1, label: '1 day' };
  const n = Number(m[1]);
  const d = m[2] === 'day' ? n : m[2] === 'week' ? n * 5 : m[2] === 'month' ? n * 21 : n * 252;
  return { days: d, label: `${n} ${m[2]}${n === 1 ? '' : 's'}` };
}

export function valueAtRisk(q: Q): AnswerResult | null {
  const s = q.s;
  const isES = /\bcvar\b|\bexpected shortfall\b|\b(?:es|etl)\b|\bconditional var\b|\bexpected tail loss\b/.test(s);
  if (!isES && !/\bvar\b|\bvalue at risk\b/.test(s)) return null;
  if (/\bvariance\b/.test(s) && !/\bvalue at risk\b/.test(s)) return null;
  if (!/value at risk|cvar|expected shortfall|conditional var/.test(s) && !/\d%/.test(s)) return null;
  const notes: string[] = [];
  const alpha = confidence(s.replace(/\b(?:vol(?:atility)?|sigma|mean|mu|return|drift)\s*(?:of|=|:|is)?\s*-?\d+(?:\.\d+)?%/g, ' '));
  if (alpha === undefined) return need(q, 'var', 'At what confidence level? e.g. "95% VaR"');
  if (!(alpha > 0.5 && alpha < 1)) return bad(q, 'var', 'The confidence level must be between 50% and 100%');
  const V = param(s, String.raw`portfolio(?: value)?(?: of)?|position(?: of)?|value(?: of)?|exposure|notional|investment|holding|on|worth`)?.v ?? paramEither(s, String.raw`portfolio|position|investment`)?.v;
  const hist = /\bhistorical\b|\bfrom (?:the )?(?:returns|data|history)\b/.test(s);
  const mc = /\bmonte carlo\b|\bsimulat/.test(s);
  const series = listAfter(s, /\b(?:returns?|losses|p&l|pnl|data|history|observations)\b/);
  const amt = (x: number) => (V !== undefined ? money(x * V, q.cur) : pct(x));
  const unit = V !== undefined ? '' : 'of portfolio value';
  if ((hist || (series && series.length >= 5)) && series && series.length >= 5) {
    const isLoss = /\blosses\b/.test(s);
    const rs = isLoss ? series.map((t) => -(t.pct ? t.v / 100 : t.v)) : V !== undefined || series.some((t) => t.pct) ? returnsOf(series, notes) : series.map((t) => t.v);
    const absolute = !series.some((t) => t.pct) && !returnsOf(series).every((x) => Math.abs(x) <= 1) && V === undefined && !/returns?/.test(s);
    const losses = rs.map((r) => -r).sort((a, b) => b - a);
    const n = losses.length;
    const k = Math.max(1, Math.floor(n * (1 - alpha) + 1e-9));
    const varL = losses[k - 1]!;
    const tail = losses.slice(0, k);
    const es = mean(tail);
    const show = (x: number) => (absolute ? money(x, q.cur) : amt(x));
    notes.push(`Historical: VaR = the ${ordinal(k)} worst loss of ${n} (k = ⌊n(1 − α)⌋); ES = average of the ${k} worst losses`);
    if (n * (1 - alpha) < 1) notes.push(`Only ${n} observations: fewer than one falls in the ${pct(1 - alpha, 1)} tail, so the worst loss is used`);
    return answer(q, {
      kind: 'var',
      expression: `Historical ${pct(alpha, 1).replace('.0%', '%')} ${isES ? 'expected shortfall' : 'VaR'} from ${n} observations${V !== undefined ? ` on ${money(V, q.cur)}` : ''}`,
      display: show(isES ? es : varL),
      value: V !== undefined ? (isES ? es : varL) * V : (isES ? es : varL) * (absolute ? 1 : 100),
      unit: absolute ? undefined : unit || undefined,
      lines: [{ label: isES ? 'VaR' : 'Expected shortfall (CVaR)', display: show(isES ? varL : es) }, { label: 'Worst observation', display: show(losses[0]!) }],
      notes,
    });
  }
  const vol = rateOf(param(s, String.raw`(?:daily |annual |monthly )?(?:vol(?:atility)?|sigma|standard deviation|sd|std)`), notes, 'volatility');
  if (vol === undefined) return need(q, 'var', 'VaR needs either a list of returns (historical) or a volatility (parametric), e.g. "95% VaR on 1,000,000 with daily vol 2%"');
  const mu = rateOf(param(s, String.raw`(?:daily |annual )?(?:mean|mu|drift|expected return|average return)`), notes, 'mean') ?? 0;
  const h = horizon(s.replace(/\b(?:\d+(?:,\d{3})*)\s*(?:sims?|simulations|paths|trials)\b/, ''));
  const annual = /\bannual(?:ized)? (?:vol|volatility|sigma|sd)\b/.test(s);
  const perDay = annual ? 1 / 252 : 1;
  const sH = vol * Math.sqrt(h.days * perDay);
  const mH = mu * h.days * perDay;
  if (annual) notes.push('Annual volatility scaled by √(days ÷ 252)');
  else if (h.days > 1) notes.push(`Square-root-of-time: σ × √${h.days}`);
  const z = Ninv(alpha);
  if (mc) {
    const pathsP = /(\d[\d,]*)\s*(?:sims?|simulations|paths|trials|scenarios)\b/.exec(s);
    const paths = Math.min(200000, Math.max(1000, pathsP ? Number(pathsP[1]!.replace(/,/g, '')) : 10000));
    const seedP = param(s, 'seed')?.v;
    const seed = Math.round(seedP ?? 42);
    if (seedP === undefined) notes.push('Seed 42 (say "seed N" for another run)');
    const g = gaussian(rng(seed));
    const losses: number[] = [];
    for (let i = 0; i < paths; i++) losses.push(-(Math.exp(mH - (sH * sH) / 2 + sH * g()) - 1));
    losses.sort((a, b) => b - a);
    const k = Math.max(1, Math.floor(paths * (1 - alpha)));
    const varL = losses[k - 1]!;
    const es = mean(losses.slice(0, k));
    notes.push('Monte Carlo: lognormal value, P&L = e^(μT − σ²T/2 + σ√T·Z) − 1');
    return answer(q, {
      kind: 'var',
      expression: `Monte Carlo ${pct(alpha, 1).replace('.0%', '%')} ${h.label} ${isES ? 'expected shortfall' : 'VaR'} · ${paths.toLocaleString('en-US')} paths, σ=${pct(vol)}${mu ? `, μ=${pct(mu, 3)}` : ''}`,
      display: amt(isES ? es : varL),
      value: V !== undefined ? (isES ? es : varL) * V : (isES ? es : varL) * 100,
      unit: unit || undefined,
      lines: [
        { label: isES ? 'VaR' : 'Expected shortfall', display: amt(isES ? varL : es) },
        { label: 'Parametric (normal) VaR for comparison', display: amt(z * sH - mH) },
      ],
      notes,
      exactness: 'approximate',
    });
  }
  const varP = z * sH - mH;
  const esP = (sH * pdf(z)) / (1 - alpha) - mH;
  return answer(q, {
    kind: 'var',
    expression: `Parametric (normal) ${pct(alpha, 1).replace('.0%', '%')} ${h.label} ${isES ? 'expected shortfall' : 'VaR'} · σ=${pct(vol)}${mu ? `, μ=${pct(mu, 3)}` : ''}${V !== undefined ? ` on ${money(V, q.cur)}` : ''}`,
    display: amt(isES ? esP : varP),
    value: V !== undefined ? (isES ? esP : varP) * V : (isES ? esP : varP) * 100,
    unit: unit || undefined,
    lines: [
      { label: isES ? 'VaR' : 'Expected shortfall (CVaR)', display: amt(isES ? varP : esP) },
      { label: 'z', display: fix(z, 4) },
      { label: 'Horizon σ', display: pct(sH, 3) },
    ],
    notes: [...notes, 'VaR = z·σ√T − μT; ES = σ√T·φ(z) ÷ (1 − α) − μT (normal returns)'],
  });
}

function ordinal(k: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = k % 100;
  return `${k}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export function drawdown(q: Q): AnswerResult | null {
  const s = q.s;
  if (!/\bdrawdowns?\b|\bpeak[\s-]*to[\s-]*trough\b/.test(s) || /\bcalmar\b/.test(s)) return null;
  const toks = listAfter(s, /\b(?:of|series|values|prices|equity(?: curve)?|returns?|navs?|balances?|:)\b|:/);
  if (!toks || toks.length < 2) return need(q, 'drawdown', 'Give the series, e.g. "max drawdown of 100, 120, 90, 130, 80, 110"');
  const notes: string[] = [];
  const isReturns = toks.some((t) => t.pct) || /\breturns?\b/.test(s);
  let curve: number[];
  if (isReturns) {
    const rs = returnsOf(toks, notes);
    curve = [100];
    for (const r of rs) curve.push(curve[curve.length - 1]! * (1 + r));
    notes.push('Returns compounded into a value path starting at 100');
  } else curve = toks.map((t) => t.v);
  if (curve.some((v) => v <= 0)) return bad(q, 'drawdown', 'Values must be positive (for returns, add % signs)');
  const dd = maxDD(curve);
  let recovered: number | null = null;
  for (let i = dd.trough + 1; i < curve.length; i++)
    if (curve[i]! >= curve[dd.peak]!) {
      recovered = i;
      break;
    }
  const idx = (i: number) => (isReturns ? `after period ${i}` : `#${i + 1}`);
  return answer(q, {
    kind: 'drawdown',
    expression: `Maximum drawdown of ${curve.length} ${isReturns ? 'compounded values' : 'values'}`,
    display: pct(dd.dd),
    value: dd.dd * 100,
    lines: [
      { label: 'Peak', display: `${num(curve[dd.peak]!, 2)} (${idx(dd.peak)})` },
      { label: 'Trough', display: `${num(curve[dd.trough]!, 2)} (${idx(dd.trough)})` },
      { label: 'Recovery', display: recovered === null ? 'not recovered by the end' : `back to the peak at ${idx(recovered)}` },
      { label: 'Gain needed to recover', display: pct(1 / (1 + dd.dd) - 1) },
    ],
    notes: [...notes, 'Max drawdown = largest fall from a running peak: min over t of (Vₜ − maxₛ≤ₜ Vₛ) ÷ maxₛ≤ₜ Vₛ'],
  });
}

export function creditLoss(q: Q): AnswerResult | null {
  const s = q.s;
  if (!/\b(?:expected|unexpected) (?:credit )?loss\b|\bpd\b.*\blgd\b|\blgd\b.*\bead\b|\bcredit loss\b/.test(s)) return null;
  if (!/\bpd\b|\blgd\b|\bead\b|default|recovery/.test(s)) return null;
  const notes: string[] = [];
  const pd = rateOf(param(s, String.raw`pd|probability of default|default probability`), notes, 'PD');
  let lgd = rateOf(param(s, String.raw`lgd|loss given default|severity`), notes, 'LGD');
  const rec = rateOf(param(s, String.raw`recovery(?: rate)?`), notes, 'recovery');
  if (lgd === undefined && rec !== undefined) {
    lgd = 1 - rec;
    notes.push(`LGD = 1 − recovery = ${pct(lgd)}`);
  }
  const ead = param(s, String.raw`ead|exposure(?: at default)?|exposure|loan(?: amount)?|balance|notional`)?.v;
  if (pd === undefined || lgd === undefined || ead === undefined) {
    const lack = [pd === undefined && 'PD (probability of default)', lgd === undefined && 'LGD (or recovery rate)', ead === undefined && 'EAD (exposure)'].filter(Boolean);
    return need(q, 'credit', `Expected loss needs ${lack.join(', ')}`);
  }
  const el = pd * lgd * ead;
  const ul = ead * lgd * Math.sqrt(pd * (1 - pd));
  return answer(q, {
    kind: 'credit',
    expression: `Expected loss · PD=${pct(pd)}, LGD=${pct(lgd)}, EAD=${money(ead, q.cur)}`,
    display: money(el, q.cur),
    value: el,
    lines: [
      { label: 'EL as % of exposure', display: pct(pd * lgd, 3) },
      { label: 'Unexpected loss (1σ, fixed LGD)', display: money(ul, q.cur) },
    ],
    notes: [...notes, 'EL = PD × LGD × EAD; UL = EAD × LGD × √(PD(1 − PD)) for a single exposure with fixed LGD'],
  });
}

export function stress(q: Q): AnswerResult | null {
  const s = q.s;
  if (!/\bstress(?:ed)?[\s-]*(?:test|scenario)|\bscenario\b|\bshock(?:s|ed)?\b/.test(s) || /\byield\b|\bstrain\b|\bmpa\b|\bpsi\b|\byoung/.test(s)) return null;
  // Segments like "equities 600k -30%", "bonds 400000 shock +5%", "600k in stocks down 30%".
  const segs = s.split(/[,;]|\band\b/).map((x) => x.trim()).filter(Boolean);
  const pos: { name: string; value: number; shock: number }[] = [];
  for (const g of segs) {
    const shockM = /(?:shock(?:ed)?|move|change|falls?|drops?|down|rises?|up|gains?|loses?|by|of)?\s*([-+]?\d+(?:\.\d+)?)%/.exec(g);
    const valM = new RegExp(String.raw`(?:\$|€|£)?(${NUM})\s*(k|m|mm|bn|million|thousand)?\b(?!\s*%)`).exec(g.replace(/[-+]?\d+(?:\.\d+)?%/g, ' '));
    if (!shockM || !valM) continue;
    const scale = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6, bn: 1e9 }[valM[2] ?? ''] ?? 1;
    let shock = Number(shockM[1]) / 100;
    if (/\b(?:falls?|drops?|down|loses?|crash\w*|declines?)\b/.test(g) && shock > 0) shock = -shock;
    const name = (/([a-z][a-z ]*?)\s*(?:\$|€|£)?\d/.exec(g.replace(/^(?:stress(?: test)?|scenario|shock)s?:?\s*/, ''))?.[1] ?? '').replace(/\b(?:shock|in|of|with|portfolio|position)\b/g, '').trim() || `Position ${pos.length + 1}`;
    pos.push({ name, value: Number(valM[1]!.replace(/,/g, '')) * scale, shock });
  }
  if (pos.length < 1) return null;
  const pnl = sum(pos.map((p) => p.value * p.shock));
  const total = sum(pos.map((p) => p.value));
  return answer(q, {
    kind: 'stress',
    expression: `Stress scenario · ${pos.map((p) => `${p.name} ${money(p.value, q.cur, 0)} ${p.shock >= 0 ? '+' : ''}${pct(p.shock, 1)}`).join(', ')}`,
    display: money(pnl, q.cur),
    value: pnl,
    unit: 'P&L',
    lines: [
      { label: 'Portfolio before', display: money(total, q.cur) },
      { label: 'Portfolio after', display: money(total + pnl, q.cur) },
      { label: 'Change', display: pct(pnl / total) },
    ],
    table: { caption: 'Scenario P&L', columns: ['Position', 'Value', 'Shock', 'P&L'], rows: pos.map((p) => [p.name, money(p.value, q.cur), pct(p.shock, 1), money(p.value * p.shock, q.cur)]) },
    notes: ['P&L = Σ position value × shock (linear, no second-order or correlation effects)'],
  });
}

// ---------------------------------------------------------------- trading

export function expectancy(q: Q): AnswerResult | null {
  const s = q.s;
  if (/\blife expectancy\b/.test(s)) return null;
  if (!/\btrad|\bwin rate\b|\b(?:average|avg) (?:win|loss)\b|\bpayoff\b|\bprofit factor\b|\bbreak[\s-]*even win rate\b/.test(s)) return null;
  if (!/\bexpectancy\b|\bexpected value per trade\b|\bpayoff ratio\b|\bprofit factor\b|\btrade stats\b|\bwin rate\b.*\b(?:average|avg) (?:win|loss)\b|\btrading stats\b|\bbreak[\s-]*even win rate\b/.test(s)) return null;
  const notes: string[] = [];
  const trades = listAfter(s, /\b(?:trades?|results|p&l|pnl|of|stats)\b/);
  if (trades && trades.length >= 3 && !/\bwin rate\b/.test(s)) {
    const t = trades.map((x) => x.v);
    const wins = t.filter((x) => x > 0);
    const losses = t.filter((x) => x < 0);
    const wr = wins.length / t.length;
    const aw = wins.length ? mean(wins) : 0;
    const al = losses.length ? -mean(losses) : 0;
    const pf = al ? sum(wins) / -sum(losses) : Infinity;
    const ex = mean(t);
    return answer(q, {
      kind: 'trading',
      expression: `Trade statistics for ${t.length} trades`,
      display: `${money(ex, q.cur)} per trade`,
      value: ex,
      lines: [
        { label: 'Win rate', display: `${pct(wr, 1)} (${wins.length} of ${t.length})` },
        { label: 'Average win', display: money(aw, q.cur) },
        { label: 'Average loss', display: money(al, q.cur) },
        { label: 'Payoff ratio (avg win ÷ avg loss)', display: al ? fix(aw / al, 3) : '∞' },
        { label: 'Profit factor (gross win ÷ gross loss)', display: Number.isFinite(pf) ? fix(pf, 3) : '∞' },
        { label: 'Total P&L', display: money(sum(t), q.cur) },
      ],
      notes: ['Expectancy = win rate × average win − loss rate × average loss = mean P&L per trade'],
    });
  }
  const wP = param(s, String.raw`win rate|win %|winning %|hit rate|win(?:ning)? (?:probability|percentage)|accuracy|p`);
  const aw = param(s, String.raw`(?:average|avg|mean) win(?:ner|ning trade)?s?|avg gain|average gain|win size|reward`)?.v;
  const al = param(s, String.raw`(?:average|avg|mean) loss(?:es)?|(?:average|avg) loser|avg losing trade|loss size|risk`)?.v;
  if (/break[\s-]*even win rate/.test(s) || (/\bpayoff ratio\b/.test(s) && !wP)) {
    const ratio = param(s, String.raw`payoff ratio|reward[\s-]*(?:to[\s-]*)?risk(?: ratio)?|r:r|rr`)?.v ?? (aw !== undefined && al !== undefined ? aw / Math.abs(al) : undefined);
    if (ratio === undefined) return need(q, 'trading', 'What is the payoff (reward-to-risk) ratio?');
    const be = 1 / (1 + ratio);
    return answer(q, { kind: 'trading', expression: `Break-even win rate at payoff ratio ${num(ratio)}`, display: pct(be), value: be * 100, notes: ['Break-even win rate = 1 ÷ (1 + payoff ratio)'] });
  }
  if (!wP || aw === undefined || al === undefined) return need(q, 'trading', 'Expectancy needs the win rate, the average win and the average loss, e.g. "expectancy win rate 40% average win 300 average loss 100"');
  const w = wP.pct || wP.v > 1 ? wP.v / 100 : wP.v;
  const loss = Math.abs(al);
  const ex = w * aw - (1 - w) * loss;
  return answer(q, {
    kind: 'trading',
    expression: `Expectancy · win rate ${pct(w, 1)}, average win ${money(aw, q.cur)}, average loss ${money(loss, q.cur)}`,
    display: `${money(ex, q.cur)} per trade`,
    value: ex,
    lines: [
      { label: 'In R (per 1 unit risked)', display: `${fix(ex / loss, 3)}R` },
      { label: 'Payoff ratio', display: fix(aw / loss, 3) },
      { label: 'Break-even win rate', display: pct(loss / (aw + loss)) },
    ],
    notes: [...notes, 'E = p × avg win − (1 − p) × avg loss'],
  });
}

export function positionSize(q: Q): AnswerResult | null {
  const s = q.s;
  if (!/\bposition siz\w*|\bhow many (?:shares|contracts|units|lots)\b|\bshares to buy\b|\brisk per trade\b|\bsize (?:the|my|a) (?:trade|position)\b/.test(s)) return null;
  const notes: string[] = [];
  const acct = param(s, String.raw`account(?: size| balance| value)?|capital|equity|portfolio|balance|bankroll`)?.v;
  const riskP = param(s, String.raw`risk(?:ing)?(?: per trade)?|risk %|max risk`);
  const entry = param(s, String.raw`entry(?: price)?|buy(?: at)?|enter(?: at)?|price`)?.v;
  const stop = param(s, String.raw`stop(?:[\s-]*loss)?(?: at| price)?|sl`)?.v;
  const stopDist = param(s, String.raw`stop distance|risk per share`)?.v;
  if (acct === undefined || !riskP) return need(q, 'position-size', 'Position sizing needs the account size and the risk per trade, e.g. "position size account 50000 risk 1% entry 100 stop 95"');
  const riskAmt = riskP.pct || riskP.v < 1 ? (riskP.pct ? riskP.v / 100 : riskP.v) * acct : riskP.v;
  const perUnit = stopDist ?? (entry !== undefined && stop !== undefined ? Math.abs(entry - stop) : undefined);
  if (perUnit === undefined) return need(q, 'position-size', 'Where is the stop? Give the entry and stop prices (or the risk per share)');
  if (perUnit === 0) return bad(q, 'position-size', 'The stop equals the entry, so the risk per share is zero');
  const mult = param(s, String.raw`multiplier|point value|contract size|per point`)?.v ?? 1;
  const units = Math.floor(riskAmt / (perUnit * mult));
  const lines: Lines = [
    { label: 'Amount at risk', display: money(riskAmt, q.cur) },
    { label: 'Risk per unit', display: money(perUnit * mult, q.cur) },
  ];
  if (entry !== undefined) lines.push({ label: 'Position value', display: money(units * entry * mult, q.cur) }, { label: 'Share of account', display: pct((units * entry * mult) / acct, 1) });
  if (entry !== undefined && stop !== undefined) notes.push(stop < entry ? 'Long: stop below entry' : 'Short: stop above entry');
  return answer(q, {
    kind: 'position-size',
    expression: `Position size · account ${money(acct, q.cur)}, risk ${riskP.pct ? pct(riskP.v / 100, 2) : money(riskAmt, q.cur)}${entry !== undefined ? `, entry ${num(entry)}` : ''}${stop !== undefined ? `, stop ${num(stop)}` : ''}`,
    display: `${units.toLocaleString('en-US')} ${/contract/.test(s) ? 'contracts' : /lot/.test(s) ? 'lots' : 'shares'}`,
    value: units,
    lines,
    notes: [...notes, 'Units = (account × risk %) ÷ (|entry − stop| × multiplier), rounded down'],
  });
}

export function tradingCosts(q: Q): AnswerResult | null {
  const s = q.s;
  if (!/\bslippage\b|\btransaction costs?\b|\btrading costs?\b|\bcommissions?\b.*\b(?:shares|trade)\b|\bround[\s-]*trip\b.*\b(?:bps?|basis points|shares|trades?)\b|\bcost drag\b/.test(s)) return null;
  const notes: string[] = [];
  const shares = (/(\d[\d,]*)\s*(?:shares|units|contracts)\b/.exec(s) ? Number(/(\d[\d,]*)\s*(?:shares|units|contracts)\b/.exec(s)![1]!.replace(/,/g, '')) : undefined) ?? param(s, String.raw`shares|qty|quantity`)?.v;
  const expected = param(s, String.raw`expected(?: price)?|quoted(?: price)?|intended(?: price)?|limit|signal price|arrival price|mid`)?.v;
  const fill = param(s, String.raw`filled(?: at)?|fill(?: price)?|executed(?: at)?|bought at|sold at|got`)?.v;
  const price = param(s, String.raw`at|price`)?.v ?? expected;
  const commPer = param(s, String.raw`commission(?: of)?(?: per share)?|fee per share|per share`);
  const commFlat = param(s, String.raw`commission(?: of)? \$?|flat fee|fee|ticket`);
  const costP = param(s, String.raw`(?:round[\s-]*trip )?costs?(?: per trade)?(?: of)?`);
  const bps = param(s, String.raw`slippage(?: of)?|spread(?: of)?|(?:market )?impact(?: of)?`) ?? (costP && (costP.bps || costP.pct) ? costP : undefined);
  const tradesYr = param(s, String.raw`trades? (?:a|per) year|trades|turnover`)?.v ?? (/(\d+)\s*(?:round[\s-]*trips|trades)\s*(?:a|per)\s*year/.exec(s) ? Number(/(\d+)\s*(?:round[\s-]*trips|trades)\s*(?:a|per)\s*year/.exec(s)![1]) : undefined);
  if (expected !== undefined && fill !== undefined) {
    const per = fill - expected;
    const sell = /\bsold|\bsell\b|\bshort\b/.test(s);
    const cost = (sell ? -per : per) * (shares ?? 1);
    const b = ((sell ? -per : per) / expected) * 1e4;
    return answer(q, {
      kind: 'trading-cost',
      expression: `Slippage · expected ${num(expected)}, filled ${num(fill)}${shares ? `, ${num(shares)} shares` : ''}`,
      display: shares ? money(cost, q.cur) : money(sell ? -per : per, q.cur, 4),
      value: shares ? cost : sell ? -per : per,
      lines: [
        { label: 'Per share', display: money(sell ? -per : per, q.cur, 4) },
        { label: 'In basis points', display: `${fix(b, 2)} bp` },
      ],
      notes: [`${sell ? 'Sell: slippage = expected − fill' : 'Buy: slippage = fill − expected'} (positive = cost)`],
    });
  }
  if (bps && tradesYr !== undefined && !shares) {
    const c = bps.bps ? bps.v / 1e4 : bps.pct ? bps.v / 100 : bps.v / 1e4;
    const drag = c * tradesYr * (/round[\s-]*trip/.test(s) ? 1 : 1);
    return answer(q, {
      kind: 'trading-cost',
      expression: `Annual cost drag · ${fix(c * 1e4, 1)} bp per trade × ${num(tradesYr)} trades a year`,
      display: pct(drag),
      value: drag * 100,
      lines: [{ label: 'Compounded drag', display: pct(1 - (1 - c) ** tradesYr) }],
      notes: ['Drag ≈ cost per trade × number of trades'],
    });
  }
  if (shares !== undefined && price !== undefined) {
    const notional = shares * price;
    const comm = commPer && /per share/.test(s) ? commPer.v * shares : commFlat?.v ?? 0;
    const slip = bps ? (bps.bps ? bps.v / 1e4 : bps.pct ? bps.v / 100 : bps.v / 1e4) * notional : 0;
    if (bps && !bps.bps && !bps.pct) notes.push(`Read ${num(bps.v)} as basis points`);
    const total = comm + slip;
    const rt = /round[\s-]*trip/.test(s) ? 2 : 1;
    return answer(q, {
      kind: 'trading-cost',
      expression: `Transaction cost · ${num(shares)} × ${money(price, q.cur)}${rt === 2 ? ', round trip' : ''}`,
      display: money(total * rt, q.cur),
      value: total * rt,
      lines: [
        { label: 'Notional', display: money(notional, q.cur) },
        { label: 'Commission', display: money(comm * rt, q.cur) },
        { label: 'Slippage / spread', display: money(slip * rt, q.cur) },
        { label: 'Cost in basis points', display: `${fix(((total * rt) / notional) * 1e4, 2)} bp` },
      ],
      notes: [...notes, 'Cost = commission + slippage × notional'],
    });
  }
  return need(q, 'trading-cost', 'Give the shares and price (and commission/slippage), or the expected and fill prices, e.g. "slippage expected 50.00 filled 50.10 1000 shares"');
}

export function compounding(q: Q): AnswerResult | null {
  const s = q.s;
  const annualize = /\bannuali[sz]e\w*\b/.test(s);
  const compoundList = /\b(?:compound(?:ed)?|cumulative|total|geometric|chain(?:ed)?|link(?:ed)?)\b.*\breturns?\b|\breturns?\b.*\b(?:compound(?:ed)?|cumulative|geometric)\b|\bcagr\b.*\b(?:vs|versus|and)\b.*\b(?:average|arithmetic|mean)\b|\b(?:average|arithmetic) return\b.*\b(?:vs|versus)\b|\bcagr of returns\b/.test(s);
  if (!annualize && !compoundList) return null;
  if (/\bloan|mortgage|bond\b/.test(s)) return null;
  const notes: string[] = [];
  if (annualize) {
    const isVol = /\bvol(?:atility)?\b|\bstandard deviation\b|\bsd\b|\bsigma\b|\brisk\b/.test(s);
    const per = /\bdaily\b|\bper day\b|\ba day\b/.test(s) ? { n: 252, label: 'daily' } : /\bweekly\b/.test(s) ? { n: 52, label: 'weekly' } : /\bmonthly\b|\ba month\b|\bper month\b/.test(s) ? { n: 12, label: 'monthly' } : /\bquarterly\b/.test(s) ? { n: 4, label: 'quarterly' } : undefined;
    const days = param(s, String.raw`trading days|days(?: a| per) year`)?.v;
    const listT = listAfter(s, /\breturns?\b|\bof\b/);
    if (!per) return need(q, 'annualize', 'How often is it measured: daily, weekly or monthly?');
    const n = per.n === 252 && days ? days : per.n;
    if (per.n === 252 && !days) notes.push('252 trading days a year (say "365 days a year" to change)');
    if (listT && listT.length >= 3) {
      const rs = returnsOf(listT, notes);
      const sd = Math.sqrt(sampleVar(rs));
      const g = rs.reduce((a, r) => a * (1 + r), 1) ** (n / rs.length) - 1;
      return answer(q, {
        kind: 'annualize',
        expression: `Annualized from ${rs.length} ${per.label} returns`,
        display: isVol ? pct(sd * Math.sqrt(n)) : pct(g),
        value: (isVol ? sd * Math.sqrt(n) : g) * 100,
        lines: isVol ? [{ label: `${per.label} sd`, display: pct(sd, 3) }, { label: 'Annualized return (geometric)', display: pct(g) }] : [{ label: 'Annualized volatility', display: pct(sd * Math.sqrt(n)) }, { label: 'Arithmetic mean × periods', display: pct(mean(rs) * n) }],
        notes: [...notes, isVol ? `σ_annual = σ × √${n}` : `(Π(1 + r))^(${n}/N) − 1`],
      });
    }
    const p = param(s, String.raw`vol(?:atility)?|standard deviation|sd|sigma|risk|returns?|of|is`) ?? (/(-?\d+(?:\.\d+)?)%/.exec(s) ? { v: Number(/(-?\d+(?:\.\d+)?)%/.exec(s)![1]), pct: true, bps: false, index: 0 } : undefined);
    if (!p) return need(q, 'annualize', 'Which value? e.g. "annualize daily vol 1%"');
    const x = rateOf(p, notes)!;
    if (isVol) {
      const a = x * Math.sqrt(n);
      return answer(q, { kind: 'annualize', expression: `Annualize ${per.label} volatility ${pct(x, 3)}`, display: pct(a), value: a * 100, lines: [{ label: 'Variance scales with time', display: `σ × √${n} = ${pct(x, 3)} × ${fix(Math.sqrt(n), 4)}` }], notes: [...notes, 'Assumes independent returns (square-root-of-time rule)'] });
    }
    const a = (1 + x) ** n - 1;
    return answer(q, { kind: 'annualize', expression: `Annualize ${per.label} return ${pct(x, 3)}`, display: pct(a), value: a * 100, lines: [{ label: 'Simple (× periods)', display: pct(x * n) }], notes: [...notes, `(1 + r)^${n} − 1`] });
  }
  const toks = listAfter(s, /\breturns?\b|\bof\b|:/);
  if (!toks || toks.length < 2) return need(q, 'compounding', 'Give the period returns, e.g. "compound returns 10%, -5%, 20%"');
  const rs = returnsOf(toks as Tok[], notes);
  const growth = rs.reduce((a, r) => a * (1 + r), 1);
  const n = rs.length;
  const cagr = growth ** (1 / n) - 1;
  const avg = mean(rs);
  const wantCagr = /\bcagr\b|\bgeometric\b|\bannual(?:ized)?\b/.test(s);
  return answer(q, {
    kind: 'compounding',
    expression: `Compounded ${n} period returns ${rs.map((r) => pct(r, 2)).join(', ')}`,
    display: wantCagr ? pct(cagr) : pct(growth - 1),
    value: (wantCagr ? cagr : growth - 1) * 100,
    unit: wantCagr ? 'per period (geometric)' : 'total',
    lines: [
      ...(wantCagr ? [{ label: 'Total return', display: pct(growth - 1) }] : [{ label: 'Geometric mean (CAGR per period)', display: pct(cagr) }]),
      { label: 'Arithmetic average', display: pct(avg) },
      { label: 'Volatility drag (arithmetic − geometric)', display: pct(avg - cagr) },
      { label: 'Growth of 100', display: num(100 * growth, 2) },
    ],
    notes: [...notes, 'Total = Π(1 + rᵢ) − 1; CAGR = (Π(1 + rᵢ))^(1/n) − 1; the arithmetic mean overstates compounded growth'],
  });
}

export { N };
