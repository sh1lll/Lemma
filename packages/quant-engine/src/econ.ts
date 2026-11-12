import type { AnswerResult } from '@lemma/math-core';
import { answer, bad, bisect, fix, listAfter, money, need, num, param, pct, rateOf, sum, type Lines, type Q, type Table } from './util';

/**
 * Microeconomics and macroeconomics from equations typed inline: market equilibrium with consumer/producer surplus,
 * per-unit taxes and subsidies (incidence, deadweight loss), price ceilings/floors, elasticities (arc, point, income,
 * cross), Cobb–Douglas / perfect complements / perfect substitutes utility maximisation, cost curves and profit
 * maximisation for competitive firms and monopolies, Cournot / Stackelberg / Bertrand duopoly, GDP and the deflator,
 * CPI inflation, the Fisher equation, fiscal and money multipliers, Gini coefficients with Lorenz tables,
 * unemployment, and comparative advantage.
 */

// ---------------------------------------------------------------- linear equations in P and Q

interface Lin {
  p: number;
  q: number;
  c: number;
}

/** "100 - 2p" → { p: -2, q: 0, c: 100 }. Returns null if anything is not a linear term in p, q. */
function linSide(src: string): Lin | null {
  const t = src.replace(/\s+/g, '').replace(/\*/g, '');
  if (!t) return null;
  const out: Lin = { p: 0, q: 0, c: 0 };
  const re = /([+-]?)(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?|\.\d+)?([pq]?)/gy;
  let i = 0;
  let any = false;
  while (i < t.length) {
    re.lastIndex = i;
    const m = re.exec(t);
    if (!m || m[0] === '' || (!m[2] && !m[3])) return null;
    if (any && !m[1]) return null;
    const coef = m[2] ? (m[2].includes('/') ? Number(m[2].split('/')[0]) / Number(m[2].split('/')[1]) : Number(m[2])) : 1;
    const v = (m[1] === '-' ? -1 : 1) * coef;
    if (m[3] === 'p') out.p += v;
    else if (m[3] === 'q') out.q += v;
    else out.c += v;
    any = true;
    i = re.lastIndex;
  }
  return out;
}

interface Eq extends Lin {
  label?: 'demand' | 'supply';
  text: string;
}

/** Every "lhs = rhs" in the text that is linear in P and Q (Qd, Qs, P_d … count as Q and P). */
function equations(s: string): Eq[] {
  const t = s.replace(/\bq\s*_?\s*\(?[ds]\)?(?![a-z])|\bq(?:d|s|uantity demanded|uantity supplied)\b/g, 'q').replace(/\bp\s*_?\s*[ds](?![a-z])/g, 'p').replace(/\bprice\b(?=\s*=)/g, 'p').replace(/\bquantity\b(?=\s*=)/g, 'q');
  const out: Eq[] = [];
  const re = /=/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const left = /((?:[-+]?\s*\d*\.?\d*\s*\*?\s*[pq]\s*[-+]\s*)?[-+]?\s*\d*\.?\d*\s*\*?\s*[pq])\s*$/.exec(t.slice(0, m.index));
    if (!left) continue;
    let right = /^[\s\d.+\-*/pq]*/.exec(t.slice(m.index + 1))![0];
    let rl: Lin | null = null;
    while (right.trim()) {
      rl = linSide(right);
      if (rl) break;
      right = right.replace(/\s*\S+\s*$/, '');
    }
    const ll = linSide(left[1]!);
    if (!ll || !rl) continue;
    const before = t.slice(Math.max(0, m.index - left[1]!.length - 30), m.index - left[1]!.length);
    const label = /demand\W*$|demand (?:is|curve|function|equation)?\W*$/.test(before) ? 'demand' : /supply\W*$|supply (?:is|curve|function|equation)?\W*$/.test(before) ? 'supply' : undefined;
    out.push({ p: ll.p - rl.p, q: ll.q - rl.q, c: ll.c - rl.c, label, text: `${left[1]!.trim()} = ${right.trim()}` });
  }
  return out;
}

/** Q as a function of P for a line a·P + b·Q + c = 0. */
const qOf = (e: Lin) => (P: number) => -(e.p * P + e.c) / e.q;
/** P as a function of Q. */
const pOf = (e: Lin) => (Qv: number) => -(e.q * Qv + e.c) / e.p;
const slopeQP = (e: Lin) => -e.p / e.q;

function demandSupply(eqs: Eq[]): { d: Eq; s: Eq } | null {
  if (eqs.length < 2) return null;
  const d = eqs.find((e) => e.label === 'demand') ?? eqs.find((e) => e.q !== 0 && slopeQP(e) < 0);
  const sp = eqs.find((e) => e !== d && (e.label === 'supply' || (e.q !== 0 && slopeQP(e) > 0)));
  return d && sp ? { d, s: sp } : null;
}

/** ∫ Q(P) dP from a to b for a linear Q(P) (trapezoid is exact). */
const area = (f: (P: number) => number, a: number, b: number) => ((f(a) + f(b)) / 2) * (b - a);

export function market(q: Q): AnswerResult | null {
  const s = q.s;
  if (!/\b(?:equilibrium|demand|supply|surplus|deadweight|incidence|price ceiling|price floor|subsidy|excise)\b/.test(s) || !/=/.test(s)) return null;
  if (/\b(?:tc|total cost|mc|marginal cost|cournot|bertrand|stackelberg|monopol\w*|elasticity|utility)\b/.test(s)) return null;
  const eqs = equations(s);
  const ds = demandSupply(eqs);
  if (!ds) return eqs.length ? need(q, 'market', 'I need a demand equation and a supply equation, e.g. "demand Q = 100 - 2P, supply Q = 20 + 3P"') : null;
  const { d, s: sp } = ds;
  if (d.q === 0 || sp.q === 0 || d.p === 0) return bad(q, 'market', 'Use equations that involve both P and Q (perfectly elastic/inelastic curves are not handled)');
  const Qd = qOf(d);
  const Qs = qOf(sp);
  // Solve Qd(P) = Qs(P).
  const sd = slopeQP(d);
  const ss = slopeQP(sp);
  if (Math.abs(sd - ss) < 1e-12) return bad(q, 'market', 'The curves are parallel: no equilibrium');
  const P0 = (Qs(0) - Qd(0)) / (sd - ss);
  const Q0 = Qd(P0);
  if (Q0 < 0) return bad(q, 'market', `The curves cross at a negative quantity (P = ${num(P0)}, Q = ${num(Q0)}): no market at a positive quantity`);
  const choke = -Qd(0) / sd; // P where Qd = 0
  const pMin = Math.max(0, -Qs(0) / ss);
  const cs = (P: number) => area(Qd, P, choke);
  const ps = (P: number) => (P > pMin ? area(Qs, pMin, P) : 0);
  const notes: string[] = [];
  const lines: Lines = [];
  const tP = param(s, String.raw`(?:per[\s-]*unit |excise |specific )?(?:tax|subsidy)(?: of)?(?: \$)?`);
  const ceiling = param(s, String.raw`(?:price )?ceiling(?: of| at)?|price cap(?: of| at)?|maximum price(?: of)?`)?.v;
  const floor = param(s, String.raw`(?:price )?floor(?: of| at)?|minimum (?:price|wage)(?: of)?|support price(?: of)?`)?.v;
  const cs0 = cs(P0);
  const ps0 = ps(P0);
  lines.push({ label: 'Equilibrium quantity', display: num(Q0) }, { label: 'Consumer surplus', display: num(cs0) }, { label: 'Producer surplus', display: num(ps0) }, { label: 'Total surplus', display: num(cs0 + ps0) });
  let display = `P = ${num(P0)}, Q = ${num(Q0)}`;
  let value = P0;
  let expression = `Market equilibrium · demand ${d.text}, supply ${sp.text}`;
  let table: Table | undefined;
  if (tP && tP.v !== 0) {
    const t = (/subsid/.test(s) ? -1 : 1) * Math.abs(tP.v);
    // Buyers pay Pb, sellers keep Pb − t: Qd(Pb) = Qs(Pb − t).
    const Pb = (Qs(0) - ss * t - Qd(0)) / (sd - ss);
    const Pseller = Pb - t;
    const Qt = Qd(Pb);
    if (Qt <= 0) return bad(q, 'market', 'That tax is large enough to shut the market down (quantity ≤ 0)');
    const cs1 = cs(Pb);
    const ps1 = ps(Pseller);
    const rev = t * Qt;
    const dwl = cs0 + ps0 - (cs1 + ps1 + rev);
    const buyerShare = (Pb - P0) / t;
    display = `Buyers pay ${num(Pb)}, sellers get ${num(Pseller)}`;
    value = Pb;
    expression = `${t > 0 ? 'Per-unit tax' : 'Per-unit subsidy'} of ${num(Math.abs(t))} · demand ${d.text}, supply ${sp.text}`;
    table = {
      caption: 'Before and after',
      columns: ['', 'No tax', t > 0 ? 'With tax' : 'With subsidy'],
      rows: [
        ['Quantity', num(Q0), num(Qt)],
        ['Price buyers pay', num(P0), num(Pb)],
        ['Price sellers receive', num(P0), num(Pseller)],
        ['Consumer surplus', num(cs0), num(cs1)],
        ['Producer surplus', num(ps0), num(ps1)],
        [t > 0 ? 'Tax revenue' : 'Subsidy cost', '0', num(Math.abs(rev))],
        ['Deadweight loss', '0', num(Math.abs(dwl))],
      ],
    };
    lines.length = 0;
    lines.push(
      { label: 'Quantity', display: `${num(Q0)} → ${num(Qt)}` },
      { label: t > 0 ? 'Tax revenue' : 'Subsidy cost', display: num(Math.abs(rev)) },
      { label: 'Deadweight loss', display: num(Math.abs(dwl)) },
      { label: 'Burden on buyers', display: pct(buyerShare, 1) },
      { label: 'Burden on sellers', display: pct(1 - buyerShare, 1) },
    );
    notes.push('Incidence does not depend on who remits the tax; the more inelastic side bears more of it');
  } else if (ceiling !== undefined || floor !== undefined) {
    const P = (ceiling ?? floor)!;
    const isCeil = ceiling !== undefined;
    const binding = isCeil ? P < P0 : P > P0;
    const qd = Qd(P);
    const qs = Qs(P);
    if (!binding) {
      display = `Not binding (equilibrium P = ${num(P0)})`;
      notes.push(`A ${isCeil ? 'ceiling above' : 'floor below'} the equilibrium price has no effect`);
    } else {
      const traded = Math.min(qd, qs);
      const gap = Math.abs(qd - qs);
      // Surplus with rationing at the controlled price (efficient rationing).
      const pDemandAtTraded = pOf(d)(traded);
      const pSupplyAtTraded = pOf(sp)(traded);
      const dwl = 0.5 * (pDemandAtTraded - pSupplyAtTraded) * (Q0 - traded);
      display = `${isCeil ? 'Shortage' : 'Surplus'} of ${num(gap)}`;
      value = gap;
      lines.length = 0;
      lines.push(
        { label: 'Quantity demanded', display: num(qd) },
        { label: 'Quantity supplied', display: num(qs) },
        { label: 'Quantity traded', display: num(traded) },
        { label: 'Deadweight loss', display: num(dwl) },
        { label: 'Equilibrium without control', display: `P = ${num(P0)}, Q = ${num(Q0)}` },
      );
    }
    expression = `Price ${isCeil ? 'ceiling' : 'floor'} at ${num(P)} · demand ${d.text}, supply ${sp.text}`;
  }
  lines.push({ label: 'Elasticity of demand at equilibrium', display: fix(sd * (P0 / Q0), 4) }, { label: 'Elasticity of supply at equilibrium', display: fix(ss * (P0 / Q0), 4) });
  return answer(q, {
    kind: 'market',
    expression,
    display,
    value,
    lines,
    table,
    notes: [...notes, 'Equilibrium where Qd = Qs; consumer surplus = area under demand above the price; producer surplus = area above supply below the price'],
  });
}

// ---------------------------------------------------------------- elasticity

function classifyPrice(e: number): string {
  const a = Math.abs(e);
  return a > 1 + 1e-12 ? 'elastic (|E| > 1)' : a < 1 - 1e-12 ? 'inelastic (|E| < 1)' : 'unit elastic';
}

function fromTo(s: string, key: string): [number, number] | undefined {
  const m = new RegExp(String.raw`(?:${key})[a-z ]{0,25}?(?:from |of |was |is |=\s*)?\$?(-?\d[\d,]*(?:\.\d+)?)\s*(?:to|->|→|and)\s*\$?(-?\d[\d,]*(?:\.\d+)?)`).exec(s);
  return m ? [Number(m[1]!.replace(/,/g, '')), Number(m[2]!.replace(/,/g, ''))] : undefined;
}

export function elasticity(q: Q): AnswerResult | null {
  const s = q.s;
  if (!/\belasticit(?:y|ies)\b/.test(s)) return null;
  const kind = /\bincome elasticity\b/.test(s) ? 'income' : /\bcross[\s-]*(?:price )?elasticity\b/.test(s) ? 'cross' : /\bsupply\b/.test(s) && !/\bdemand\b/.test(s) ? 'supply' : 'price';
  const notes: string[] = [];
  // Point elasticity on an equation: "point elasticity Q = 100 - 2P at P = 20".
  const eqs = equations(s.replace(/\bat\s+(?:p|price)\s*=\s*\d+(?:\.\d+)?/, ' ').replace(/\bat\s+(?:q|quantity)\s*=\s*\d+(?:\.\d+)?/, ' '));
  const atP = /\bat\s+(?:p|price)\s*=?\s*(\d+(?:\.\d+)?)/.exec(s);
  const atQ = /\bat\s+(?:q|quantity)\s*=?\s*(\d+(?:\.\d+)?)/.exec(s);
  if (eqs.length && (atP || atQ)) {
    const e = eqs[0]!;
    if (e.q === 0 || e.p === 0) return bad(q, 'elasticity', 'The equation must involve both P and Q');
    const P = atP ? Number(atP[1]) : pOf(e)(Number(atQ![1]));
    const Qv = qOf(e)(P);
    if (Qv <= 0) return bad(q, 'elasticity', `Quantity at P = ${num(P)} is ${num(Qv)}: outside the market`);
    const el = slopeQP(e) * (P / Qv);
    return answer(q, {
      kind: 'elasticity',
      expression: `Point elasticity of ${e.text} at P = ${num(P)}, Q = ${num(Qv)}`,
      display: fix(el, 4),
      value: el,
      lines: [{ label: 'dQ/dP', display: num(slopeQP(e)) }, { label: 'Reading', display: kind === 'supply' || el > 0 ? (el > 1 ? 'elastic supply' : 'inelastic supply') : classifyPrice(el) }],
      notes: ['E = (dQ/dP) × (P/Q)', ...(el < 0 ? [`Revenue is maximised where |E| = 1 (P = ${num(-qOf(e)(0) / (2 * slopeQP(e)))})`] : [])],
    });
  }
  // Percentage changes: "quantity falls 10% when price rises 5%".
  const pctQ = /(?:quantity|demand|sales|consumption)[a-z ]{0,20}?(rises?|increases?|grows?|falls?|drops?|decreases?|declines?|changes?)\s*(?:by\s*)?(-?\d+(?:\.\d+)?)%/.exec(s);
  const pctX = /(?:price|income|cost)[a-z ]{0,20}?(rises?|increases?|grows?|falls?|drops?|decreases?|declines?|changes?)\s*(?:by\s*)?(-?\d+(?:\.\d+)?)%/.exec(s);
  if (pctQ && pctX) {
    const sg = (w: string) => (/fall|drop|decreas|declin/.test(w) ? -1 : 1);
    const dq = sg(pctQ[1]!) * Number(pctQ[2]);
    const dx = sg(pctX[1]!) * Number(pctX[2]);
    if (dx === 0) return bad(q, 'elasticity', 'The percentage change in the cause cannot be zero');
    const el = dq / dx;
    return answer(q, {
      kind: 'elasticity',
      expression: `${kind === 'income' ? 'Income' : kind === 'cross' ? 'Cross-price' : 'Price'} elasticity · %ΔQ = ${num(dq)}%, %Δ${kind === 'income' ? 'I' : 'P'} = ${num(dx)}%`,
      display: fix(el, 4),
      value: el,
      lines: [{ label: 'Reading', display: reading(kind, el) }],
      notes: ['E = %ΔQ ÷ %Δ(price or income)'],
    });
  }
  const xKey = kind === 'income' ? 'income' : kind === 'cross' ? String.raw`price of (?:good )?(?:b|y|the other good|[a-z]+)|other price|price of the substitute|price of the complement` : 'price|p';
  const x = fromTo(s, xKey) ?? (kind !== 'income' ? (() => {
    const a = param(s, 'p1|p₁');
    const b = param(s, 'p2|p₂');
    return a && b ? ([a.v, b.v] as [number, number]) : undefined;
  })() : undefined);
  const qq = fromTo(s, kind === 'cross' ? String.raw`quantity of (?:good )?(?:a|x)|quantity|demand(?: for [a-z]+)?|sales|q` : String.raw`quantity(?: demanded| supplied)?|demand|sales|q`) ?? (() => {
    const a = param(s, 'q1|q₁');
    const b = param(s, 'q2|q₂');
    return a && b ? ([a.v, b.v] as [number, number]) : undefined;
  })();
  if (!x || !qq) return need(q, 'elasticity', `I need the two ${kind === 'income' ? 'incomes' : 'prices'} and the two quantities, e.g. "price elasticity price from 10 to 12 quantity from 100 to 80"`);
  const simple = /\bsimple\b|\bpercentage change method\b|\bnot midpoint\b|\bpoint method\b/.test(s);
  const dq = simple ? (qq[1] - qq[0]) / qq[0] : (qq[1] - qq[0]) / ((qq[0] + qq[1]) / 2);
  const dx = simple ? (x[1] - x[0]) / x[0] : (x[1] - x[0]) / ((x[0] + x[1]) / 2);
  if (dx === 0) return bad(q, 'elasticity', 'The two prices are equal, so the elasticity is undefined');
  const el = dq / dx;
  const lines: Lines = [
    { label: '%ΔQ', display: pct(dq) },
    { label: `%Δ${kind === 'income' ? 'income' : 'price'}`, display: pct(dx) },
    { label: 'Reading', display: reading(kind, el) },
  ];
  if (kind === 'price') lines.push({ label: 'Revenue', display: `${num(x[0] * qq[0])} → ${num(x[1] * qq[1])}` });
  return answer(q, {
    kind: 'elasticity',
    expression: `${{ income: 'Income', cross: 'Cross-price', price: 'Price', supply: 'Price elasticity of supply' }[kind]}${kind === 'supply' ? '' : ' elasticity'} (${simple ? 'simple' : 'midpoint'}) · ${kind === 'income' ? 'income' : 'price'} ${num(x[0])} → ${num(x[1])}, quantity ${num(qq[0])} → ${num(qq[1])}`,
    display: fix(el, 4),
    value: el,
    lines,
    notes: [...notes, simple ? 'E = (ΔQ/Q₁) ÷ (ΔX/X₁)' : 'Midpoint (arc) formula: E = [ΔQ ÷ average Q] ÷ [ΔX ÷ average X]'],
  });
}

function reading(kind: string, e: number): string {
  if (kind === 'income') return e < 0 ? 'inferior good (E < 0)' : e > 1 ? 'normal good, luxury (E > 1)' : 'normal good, necessity (0 < E < 1)';
  if (kind === 'cross') return e > 0 ? 'substitutes (E > 0)' : e < 0 ? 'complements (E < 0)' : 'unrelated';
  if (kind === 'supply') return e > 1 ? 'elastic supply' : e < 1 ? 'inelastic supply' : 'unit elastic';
  return classifyPrice(e);
}

// ---------------------------------------------------------------- utility maximisation

function expOf(s: string, v: 'x' | 'y'): number | undefined {
  const m = new RegExp(String.raw`${v}\s*(?:\^|\*\*)\s*\(?\s*(\d+(?:\.\d+)?(?:\s*/\s*\d+(?:\.\d+)?)?)\s*\)?`).exec(s);
  if (!m) return new RegExp(String.raw`${v}`).test(s) ? 1 : undefined;
  const t = m[1]!.replace(/\s/g, '');
  return t.includes('/') ? Number(t.split('/')[0]) / Number(t.split('/')[1]) : Number(t);
}

export function utility(q: Q): AnswerResult | null {
  const s = q.s;
  if (!/\butility\b|\bu\s*\(?\s*x\s*,\s*y\s*\)?\s*=|\bu\s*=|\bcobb[\s-]*douglas\b|\bbudget constraint\b/.test(s)) return null;
  if (/\bproduction\b|\bk\b.*\bl\b/.test(s) && !/\butility\b/.test(s)) return null;
  if (!/\bu\s*(?:\(\s*x\s*,\s*y\s*\))?\s*=|\bcobb|\bmaximi[sz]|\bbudget\b|\bincome\b/.test(s)) return null;
  const I = param(s, String.raw`income|budget|m|i|wealth|spend(?:s|ing)?`)?.v;
  const px = param(s, String.raw`px|p_x|p\(x\)|price of x|x price|x costs?|price x`)?.v;
  const py = param(s, String.raw`py|p_y|p\(y\)|price of y|y price|y costs?|price y`)?.v;
  if (I === undefined || px === undefined || py === undefined) return need(q, 'utility', 'I need the income and both prices, e.g. "maximize U = x^0.5 y^0.5 income 100 px 2 py 5"');
  if (!(px > 0 && py > 0 && I > 0)) return bad(q, 'utility', 'Income and prices must be positive');
  const ufM = /u\s*(?:\(\s*x\s*,\s*y\s*\))?\s*=\s*((?:min\s*\([^)]*\)|[^,;])*?)(?=\s*(?:,|;|\bincome\b|\bbudget\b|\bm\s*=|\bi\s*=|\bpx\b|\bp_x\b|\bprice\b|\bwith\b|$))/.exec(s);
  const uf = ufM?.[1]?.trim() ?? 'x^0.5 y^0.5';
  if (!ufM) return need(q, 'utility', 'What is the utility function? e.g. "U = x^0.5 y^0.5" or "U = min(x, 2y)"');
  const minM = /min\s*\(\s*(\d*\.?\d*)\s*\*?\s*x\s*,\s*(\d*\.?\d*)\s*\*?\s*y\s*\)/.exec(uf);
  if (minM) {
    const a = Number(minM[1] || 1);
    const b = Number(minM[2] || 1);
    const x = I / (px + (py * a) / b);
    const y = (a * x) / b;
    return answer(q, {
      kind: 'utility',
      expression: `Perfect complements U = min(${a === 1 ? '' : num(a)}x, ${b === 1 ? '' : num(b)}y) · income ${num(I)}, px=${num(px)}, py=${num(py)}`,
      display: `x = ${num(x)}, y = ${num(y)}`,
      value: x,
      lines: [{ label: 'Utility', display: num(a * x) }],
      notes: ['Optimum at the kink: ax = by, on the budget line px·x + py·y = I'],
    });
  }
  const subM = /^(\d*\.?\d*)\s*\*?\s*x\s*\+\s*(\d*\.?\d*)\s*\*?\s*y$/.exec(uf.replace(/\s+/g, ' ').trim());
  if (subM) {
    const a = Number(subM[1] || 1);
    const b = Number(subM[2] || 1);
    const bx = a / px;
    const by = b / py;
    const x = bx >= by ? I / px : 0;
    const y = bx >= by ? 0 : I / py;
    return answer(q, {
      kind: 'utility',
      expression: `Perfect substitutes U = ${uf} · income ${num(I)}, px=${num(px)}, py=${num(py)}`,
      display: `x = ${num(x)}, y = ${num(y)}`,
      value: x,
      lines: [{ label: 'Utility', display: num(a * x + b * y) }, { label: 'Marginal utility per $', display: `x: ${num(bx)}, y: ${num(by)}` }],
      notes: [Math.abs(bx - by) < 1e-12 ? 'Equal value per dollar: any bundle on the budget line is optimal (one corner shown)' : 'Corner solution: spend everything on the good with the higher marginal utility per dollar'],
    });
  }
  const a = expOf(uf, 'x');
  const b = expOf(uf, 'y');
  if (a === undefined || b === undefined || !(a > 0 && b > 0)) return need(q, 'utility', 'I can solve Cobb–Douglas (U = x^a y^b), perfect complements (min) and perfect substitutes (ax + by)');
  const lnForm = /\bln\b|\blog\b/.test(uf);
  const x = (a / (a + b)) * (I / px);
  const y = (b / (a + b)) * (I / py);
  const U = lnForm ? a * Math.log(x) + b * Math.log(y) : x ** a * y ** b;
  return answer(q, {
    kind: 'utility',
    expression: `Maximize U = x^${num(a)}·y^${num(b)} subject to ${num(px)}x + ${num(py)}y = ${num(I)}`,
    display: `x = ${num(x)}, y = ${num(y)}`,
    value: x,
    lines: [
      { label: 'Maximum utility', display: num(U) },
      { label: 'Budget shares', display: `x: ${pct(a / (a + b), 1)}, y: ${pct(b / (a + b), 1)}` },
      { label: 'MRS at optimum = px/py', display: num(px / py) },
      { label: 'Lagrange multiplier λ (marginal utility of income)', display: fix(lnForm ? (a + b) / I : ((a + b) * U) / I, 6) },
    ],
    notes: ['Cobb–Douglas demands: x* = [a/(a+b)]·I/px, y* = [b/(a+b)]·I/py (tangency MRS = px/py)'],
  });
}

// ---------------------------------------------------------------- cost curves, competition, monopoly, oligopoly

/** A polynomial in q: "100 + 10q + q^2" → [100, 10, 1]. */
function poly(src: string): number[] | null {
  const t = src.replace(/\s+/g, '').replace(/\*\*/g, '^').replace(/²/g, '^2').replace(/³/g, '^3').replace(/\*/g, '');
  if (!t) return null;
  const out: number[] = [];
  const re = /([+-]?)(\d+(?:\.\d+)?|\.\d+)?(q(?:\^(\d))?)?/gy;
  let i = 0;
  let first = true;
  while (i < t.length) {
    re.lastIndex = i;
    const m = re.exec(t);
    if (!m || m[0] === '' || (!m[2] && !m[3])) return null;
    if (!first && !m[1]) return null;
    const c = (m[1] === '-' ? -1 : 1) * (m[2] ? Number(m[2]) : 1);
    const k = m[3] ? (m[4] ? Number(m[4]) : 1) : 0;
    out[k] = (out[k] ?? 0) + c;
    first = false;
    i = re.lastIndex;
  }
  return Array.from({ length: out.length }, (_, k) => out[k] ?? 0);
}
const ev = (c: number[], x: number) => c.reduce((a, v, k) => a + v * x ** k, 0);
const deriv = (c: number[]) => c.slice(1).map((v, k) => v * (k + 1));
function polyText(c: number[]): string {
  const parts = c.map((v, k) => (v === 0 ? '' : `${num(Math.abs(v))}${k ? (k === 1 ? 'Q' : `Q^${k}`) : ''}`.replace(/^1Q/, 'Q'))).map((t, k) => (t ? (c[k]! < 0 ? `− ${t}` : `+ ${t}`) : '')).filter(Boolean);
  return parts.join(' ').replace(/^\+ /, '').replace(/^− /, '−');
}

function costFn(s: string): number[] | null {
  const m = /\b(?:tc|total cost|cost function|c\(q\))\s*(?:\(q\))?\s*=\s*([-+\d.\sq^*²³]+)/.exec(s);
  if (!m) return null;
  let src = m[1]!;
  let c: number[] | null = null;
  while (src.trim()) {
    c = poly(src);
    if (c) break;
    src = src.replace(/\s*\S+\s*$/, '');
  }
  return c;
}

/** Inverse demand P = a − bQ from "P = 100 - 2Q" or "Q = 50 - 0.5P". */
function inverseDemand(s: string): { a: number; b: number; text: string } | null {
  const eqs = equations(s.replace(/\b(?:tc|total cost|mc|c\(q\))\s*(?:\(q\))?\s*=\s*[-+\d.\sq^*²³]+/g, ' '));
  const e = eqs.find((x) => x.p !== 0 && x.q !== 0 && slopeQP(x) < 0);
  if (!e) return null;
  const P = pOf(e);
  return { a: P(0), b: P(0) - P(1), text: e.text };
}

export function firm(q: Q): AnswerResult | null {
  const s = q.s;
  const tc = costFn(s);
  const mcConst = param(s, String.raw`mc|marginal cost|unit cost|cost per unit|c`)?.v;
  const isOligo = /\b(cournot|bertrand|stackelberg|duopoly|oligopoly)\b/.exec(s)?.[1];
  if (!tc && !isOligo && !(/\bmonopol\w*\b/.test(s) && mcConst !== undefined)) return null;
  const dem = inverseDemand(s);
  const notes: string[] = [];
  if (isOligo) {
    if (!dem) return need(q, 'oligopoly', 'I need the (inverse) demand, e.g. "cournot P = 120 - Q mc 30"');
    const costs = listAfter(s, /\b(?:marginal costs?|mcs?|costs?|unit costs?|c1\s*(?:and|,)\s*c2|c)\b/)?.map((t) => t.v) ?? (() => {
      const c1 = param(s, 'c1|mc1|c₁')?.v;
      const c2 = param(s, 'c2|mc2|c₂')?.v;
      return c1 !== undefined && c2 !== undefined ? [c1, c2] : tc ? [tc[1] ?? 0] : undefined;
    })();
    if (!costs) return need(q, 'oligopoly', 'What is the marginal cost (one for both firms, or one each)?');
    const nF = /(\d+)\s*(?:firms|companies|identical firms)/.exec(s);
    const n = nF ? Number(nF[1]) : 2;
    const [c1, c2] = [costs[0]!, costs[1] ?? costs[0]!];
    const { a, b } = dem;
    const P = (Qv: number) => a - b * Qv;
    let q1: number;
    let q2: number;
    let title: string;
    if (isOligo === 'bertrand') {
      const lo = Math.min(c1, c2);
      const hi = Math.max(c1, c2);
      const price = c1 === c2 ? c1 : Math.min(hi, (a + lo) / 2);
      const Qv = (a - price) / b;
      const winner = c1 === c2 ? 'both (split)' : c1 < c2 ? 'firm 1' : 'firm 2';
      const prof = (price - lo) * Qv;
      return answer(q, {
        kind: 'oligopoly',
        expression: `Bertrand duopoly (identical goods) · P = ${num(a)} − ${num(b)}Q, MC ${num(c1)}${c1 !== c2 ? ` and ${num(c2)}` : ''}`,
        display: `P = ${num(price)}`,
        value: price,
        lines: [
          { label: 'Market quantity', display: num(Qv) },
          { label: 'Sells', display: winner },
          { label: 'Profit', display: c1 === c2 ? '0 each' : num(prof) },
        ],
        notes: [c1 === c2 ? 'Price competition drives price to marginal cost (Bertrand paradox)' : 'The low-cost firm prices just below the rival\'s cost (or at its monopoly price if lower) and takes the market'],
      });
    }
    if (isOligo === 'stackelberg') {
      q1 = Math.max(0, (a - 2 * c1 + c2) / (2 * b));
      q2 = Math.max(0, (a - c2 - b * q1) / (2 * b));
      title = 'Stackelberg (firm 1 leads)';
    } else if (n > 2 && costs.length === 1) {
      const qi = (a - c1) / (b * (n + 1));
      const Qv = n * qi;
      return answer(q, {
        kind: 'oligopoly',
        expression: `Cournot with ${n} identical firms · P = ${num(a)} − ${num(b)}Q, MC ${num(c1)}`,
        display: `q = ${num(qi)} each, P = ${num(P(Qv))}`,
        value: qi,
        lines: [{ label: 'Market quantity', display: num(Qv) }, { label: 'Profit per firm', display: num((P(Qv) - c1) * qi) }, { label: 'Competitive (P = MC) quantity', display: num((a - c1) / b) }],
        notes: ['qᵢ = (a − c) ÷ (b(n + 1)); as n grows the price falls toward MC'],
      });
    } else {
      q1 = (a - 2 * c1 + c2) / (3 * b);
      q2 = (a - 2 * c2 + c1) / (3 * b);
      if (q1 < 0) [q1, q2] = [0, (a - c2) / (2 * b)];
      else if (q2 < 0) [q1, q2] = [(a - c1) / (2 * b), 0];
      title = 'Cournot duopoly';
    }
    const Qv = q1 + q2;
    const price = P(Qv);
    const mono = (a - c1) / (2 * b);
    return answer(q, {
      kind: 'oligopoly',
      expression: `${title} · P = ${num(a)} − ${num(b)}Q, MC ${num(c1)}${c1 !== c2 ? ` and ${num(c2)}` : ''}`,
      display: `q₁ = ${num(q1)}, q₂ = ${num(q2)}, P = ${num(price)}`,
      value: price,
      lines: [
        { label: 'Market quantity', display: num(Qv) },
        { label: 'Profit firm 1', display: num((price - c1) * q1) },
        { label: 'Profit firm 2', display: num((price - c2) * q2) },
        { label: 'Monopoly (collusion) for comparison', display: `Q = ${num(mono)}, P = ${num(P(mono))}` },
        { label: 'Perfect competition for comparison', display: `Q = ${num((a - Math.min(c1, c2)) / b)}, P = ${num(Math.min(c1, c2))}` },
      ],
      notes: [title.startsWith('Cournot') ? 'Best responses qᵢ = (a − cᵢ − b·qⱼ) ÷ 2b, solved together' : 'Leader chooses q₁ anticipating the follower\'s best response q₂ = (a − c₂ − b·q₁) ÷ 2b'],
    });
  }
  const C = tc ?? [param(s, String.raw`fixed costs?|fc`)?.v ?? 0, mcConst ?? 0];
  const MC = deriv(C);
  const fixed = C[0] ?? 0;
  const avc = (x: number) => (ev(C, x) - fixed) / x;
  const ac = (x: number) => ev(C, x) / x;
  const price = param(s, String.raw`price|p|market price`)?.v;
  const lines: Lines = [];
  if (/\bmonopol\w*\b/.test(s) || (dem && price === undefined)) {
    if (!dem) return need(q, 'firm', 'A monopoly needs the demand curve, e.g. "P = 100 - 2Q"');
    const { a, b } = dem;
    const f = (x: number) => a - 2 * b * x - ev(MC, x);
    const Qm = bisect(f, 0, a / b);
    if (Qm === null) return bad(q, 'firm', 'Marginal revenue never meets marginal cost here: the firm would not produce');
    const Pm = a - b * Qm;
    const profit = Pm * Qm - ev(C, Qm);
    const Qc = bisect((x) => a - b * x - ev(MC, x), 0, a / b) ?? NaN;
    const dwlN = 200;
    let dwl = 0;
    if (Number.isFinite(Qc) && Qc > Qm) {
      const h = (Qc - Qm) / dwlN;
      for (let i = 0; i < dwlN; i++) {
        const x = Qm + (i + 0.5) * h;
        dwl += (a - b * x - ev(MC, x)) * h;
      }
    }
    lines.push(
      { label: 'Profit', display: num(profit) },
      { label: 'Marginal revenue', display: `MR = ${num(a)} − ${num(2 * b)}Q` },
      { label: 'Markup (Lerner index)', display: pct((Pm - ev(MC, Qm)) / Pm, 1) },
      { label: 'Competitive outcome (P = MC)', display: Number.isFinite(Qc) ? `Q = ${num(Qc)}, P = ${num(a - b * Qc)}` : '—' },
      { label: 'Deadweight loss', display: num(dwl) },
    );
    return answer(q, {
      kind: 'firm',
      expression: `Monopoly · demand P = ${num(a)} − ${num(b)}Q, TC = ${polyText(C)}`,
      display: `Q = ${num(Qm)}, P = ${num(Pm)}`,
      value: Pm,
      lines,
      notes: ['Profit-maximising monopoly sets MR = MC and charges the demand price'],
    });
  }
  if (price === undefined) {
    // Cost curves only: efficient scale.
    const qMin = bisect((x) => (ac(x + 1e-6) - ac(x - 1e-6)) / 2e-6, 1e-3, 1e6);
    return answer(q, {
      kind: 'firm',
      expression: `Cost curves · TC = ${polyText(C)}`,
      display: qMin !== null ? `Minimum AC at Q = ${num(qMin)}` : `MC = ${polyText(MC)}`,
      value: qMin ?? undefined,
      lines: [
        { label: 'Marginal cost', display: `MC = ${polyText(MC) || '0'}` },
        { label: 'Average cost', display: `AC = TC ÷ Q` },
        ...(qMin !== null ? [{ label: 'Minimum average cost', display: num(ac(qMin)) }] : []),
        { label: 'Fixed cost', display: num(fixed) },
      ],
      notes: ['At the minimum of AC, MC = AC; give a price to find the profit-maximising output'],
    });
  }
  // Competitive firm: P = MC on the rising part of MC.
  const qHi = 1e7;
  const g = (x: number) => price - ev(MC, x);
  let Qs: number | null = null;
  if (MC.length <= 1) return bad(q, 'firm', 'With constant marginal cost a price-taker has no interior optimum (it produces nothing or without limit)');
  // Scan for the last crossing where MC rises through P.
  const step = 0.01;
  let prev = g(step);
  for (let x = 2 * step; x < 1e4; x += step * Math.max(1, x / 10)) {
    const cur = g(x);
    if (prev > 0 && cur <= 0) {
      Qs = bisect(g, x - step * Math.max(1, x / 10), x);
      break;
    }
    prev = cur;
  }
  if (Qs === null) Qs = bisect(g, 1e-9, qHi);
  if (Qs === null) return bad(q, 'firm', 'Marginal cost never reaches that price');
  const profit = price * Qs - ev(C, Qs);
  const qAvcMin = bisect((x) => (avc(x + 1e-6) - avc(x - 1e-6)) / 2e-6, 1e-3, 1e6);
  const avcMin = qAvcMin !== null ? avc(qAvcMin) : avc(1e-6);
  const shut = price < avcMin - 1e-9;
  lines.push(
    { label: 'Profit', display: num(shut ? -fixed : profit) },
    { label: 'Average total cost at that Q', display: num(ac(Qs)) },
    { label: 'Shutdown price (min AVC)', display: num(avcMin) },
  );
  const qAcMin = bisect((x) => (ac(x + 1e-6) - ac(x - 1e-6)) / 2e-6, 1e-3, 1e6);
  if (qAcMin !== null) lines.push({ label: 'Break-even price (min ATC)', display: num(ac(qAcMin)) });
  return answer(q, {
    kind: 'firm',
    expression: `Price-taking firm · TC = ${polyText(C)}, P = ${num(price)}`,
    display: shut ? 'Q = 0 (shut down)' : `Q = ${num(Qs)}`,
    value: shut ? 0 : Qs,
    lines,
    notes: [shut ? 'Price is below minimum average variable cost: shutting down loses only the fixed cost' : 'Profit maximum where P = MC (MC rising)', `MC = ${polyText(MC)}`],
  });
}

// ---------------------------------------------------------------- macro

export function macro(q: Q): AnswerResult | null {
  const s = q.s;
  const notes: string[] = [];
  // GDP deflator
  if (/\bdeflator\b|\bnominal gdp\b.*\breal gdp\b|\breal gdp\b.*\bnominal gdp\b/.test(s)) {
    const N = param(s, String.raw`nominal gdp|nominal`)?.v;
    const R = param(s, String.raw`real gdp|real`)?.v;
    const Df = param(s, String.raw`(?:gdp )?deflator(?: of)?`)?.v;
    if (N !== undefined && R !== undefined) {
      const d = (N / R) * 100;
      return answer(q, { kind: 'macro', expression: `GDP deflator · nominal ${num(N)}, real ${num(R)}`, display: fix(d, 2), value: d, lines: [{ label: 'Price level vs base year', display: pct(d / 100 - 1) }], notes: ['Deflator = nominal GDP ÷ real GDP × 100'] });
    }
    if (N !== undefined && Df !== undefined) {
      const r = (N / Df) * 100;
      return answer(q, { kind: 'macro', expression: `Real GDP · nominal ${num(N)}, deflator ${num(Df)}`, display: num(r, 2), value: r, notes: ['Real GDP = nominal GDP ÷ deflator × 100'] });
    }
    if (R !== undefined && Df !== undefined) {
      const n = (R * Df) / 100;
      return answer(q, { kind: 'macro', expression: `Nominal GDP · real ${num(R)}, deflator ${num(Df)}`, display: num(n, 2), value: n, notes: ['Nominal = real × deflator ÷ 100'] });
    }
    return need(q, 'macro', 'Give two of nominal GDP, real GDP and the deflator');
  }
  // GDP by expenditure
  if (/\bgdp\b/.test(s) && /\b(?:consumption|investment|government|net exports|exports|c\s*=|i\s*=|g\s*=)/.test(s)) {
    const C = param(s, String.raw`consumption|c`)?.v;
    const I = param(s, String.raw`investment|i`)?.v;
    const G = param(s, String.raw`government(?: spending| purchases)?|g`)?.v;
    const NX = param(s, String.raw`net exports|nx`)?.v;
    const X = param(s, String.raw`exports|x`)?.v;
    const M = param(s, String.raw`imports|m`)?.v;
    if (C === undefined || I === undefined || G === undefined || (NX === undefined && (X === undefined || M === undefined))) return need(q, 'macro', 'GDP by expenditure needs C, I, G and net exports (or exports and imports)');
    const nx = NX ?? X! - M!;
    const y = C + I + G + nx;
    return answer(q, { kind: 'macro', expression: `GDP = C + I + G + NX · ${num(C)} + ${num(I)} + ${num(G)} + ${num(nx)}`, display: num(y), value: y, lines: [{ label: 'Net exports', display: num(nx) }, { label: 'Consumption share', display: pct(C / y, 1) }], notes: ['Expenditure approach'] });
  }
  // Inflation from index levels (not years: those go to the CPI table).
  if (/\b(?:inflation|cpi|price index|price level)\b/.test(s) && !/\b(?:1[89]|20)\d\d\b/.test(s)) {
    const ft = /(?:from|was|of)\s*(\d+(?:\.\d+)?)\s*(?:to|->|→|and(?: now)?|rose to|fell to)\s*(\d+(?:\.\d+)?)/.exec(s);
    const basket = /basket/.test(s) ? listAfter(s, /\bbasket(?: costs?)?\b/) : undefined;
    if (basket && basket.length >= 2) {
      const [b0, b1] = [basket[0]!.v, basket[1]!.v];
      return answer(q, { kind: 'macro', expression: `CPI from a basket costing ${num(b0)} (base) and ${num(b1)}`, display: fix((b1 / b0) * 100, 2), value: (b1 / b0) * 100, lines: [{ label: 'Inflation', display: pct(b1 / b0 - 1) }], notes: ['CPI = cost of basket ÷ cost in base year × 100'] });
    }
    if (ft) {
      const [a, b] = [Number(ft[1]), Number(ft[2])];
      const yrs = param(s, String.raw`over|in`)?.v;
      const lines: Lines = [];
      if (yrs && /years?/.test(s)) lines.push({ label: 'Average per year', display: pct((b / a) ** (1 / yrs) - 1) });
      return answer(q, { kind: 'macro', expression: `Inflation from index ${num(a)} to ${num(b)}`, display: pct(b / a - 1), value: (b / a - 1) * 100, lines, notes: ['Inflation = (CPI₂ − CPI₁) ÷ CPI₁'] });
    }
  }
  // Fisher: real vs nominal rates or growth.
  if (/\breal\b/.test(s) && /\b(?:nominal|inflation)\b/.test(s) && /%/.test(s) && !/\bgdp\b(?! growth)/.test(s)) {
    const n = rateOf(param(s, String.raw`nominal(?: interest)?(?: rate| return| growth| yield)?`), notes);
    const pi = rateOf(param(s, String.raw`inflation(?: rate)?|expected inflation`), notes);
    const r = rateOf(param(s, String.raw`real(?: interest)?(?: rate| return| growth| yield)?`), notes);
    const what = /growth/.test(s) ? 'growth' : 'rate';
    if (n !== undefined && pi !== undefined) {
      const real = (1 + n) / (1 + pi) - 1;
      return answer(q, { kind: 'macro', expression: `Real ${what} · nominal ${pct(n)}, inflation ${pct(pi)}`, display: pct(real, 3), value: real * 100, lines: [{ label: 'Approximation (nominal − inflation)', display: pct(n - pi) }], notes: ['Fisher: (1 + nominal) = (1 + real)(1 + inflation)'] });
    }
    if (r !== undefined && pi !== undefined) {
      const nom = (1 + r) * (1 + pi) - 1;
      return answer(q, { kind: 'macro', expression: `Nominal ${what} · real ${pct(r)}, inflation ${pct(pi)}`, display: pct(nom, 3), value: nom * 100, lines: [{ label: 'Approximation (real + inflation)', display: pct(r + pi) }], notes: ['Fisher: (1 + nominal) = (1 + real)(1 + inflation)'] });
    }
  }
  // Fiscal multipliers.
  if ((/\bmpc\b|\bmps\b|marginal propensity|\b(?:spending|fiscal|keynesian|tax|investment|government|expenditure|balanced[\s-]*budget|simple|income) multiplier\b/.test(s)) && !/\bmoney multiplier\b|\breserve\b|\blagrange\b/.test(s)) {
    let c = param(s, String.raw`mpc|marginal propensity to consume`)?.v;
    const mps = param(s, String.raw`mps|marginal propensity to save`)?.v;
    if (c === undefined && mps !== undefined) c = 1 - (mps > 1 ? mps / 100 : mps);
    if (c !== undefined && c > 1) c /= 100;
    if (c === undefined) return need(q, 'macro', 'What is the marginal propensity to consume (MPC)?');
    if (!(c >= 0 && c < 1)) return bad(q, 'macro', 'The MPC must be between 0 and 1');
    const t = rateOf(param(s, String.raw`tax rate|income tax rate|t`), notes) ?? 0;
    const m = param(s, String.raw`mpm|marginal propensity to import|import propensity`)?.v ?? 0;
    const k = 1 / (1 - c * (1 - t) + (m > 1 ? m / 100 : m));
    const tax = -c * k;
    const change = param(s, String.raw`(?:increase|rise|change|cut|boost|injection|spending|investment)(?: in [a-z ]+?)?(?: of| by)?|by`)?.v;
    const isTax = /\btax multiplier\b|\btax (?:cut|increase|rise)\b|\bcut taxes\b|\braise taxes\b/.test(s);
    const isBal = /\bbalanced[\s-]*budget\b/.test(s);
    const mult = isBal ? 1 : isTax ? tax : k;
    const lines: Lines = [
      { label: 'Spending multiplier', display: fix(k, 4) },
      { label: 'Tax multiplier', display: fix(tax, 4) },
      { label: 'Balanced-budget multiplier', display: '1 (simple model)' },
    ];
    if (change !== undefined) {
      const sign = /\bcut\b/.test(s) && isTax ? -1 : 1;
      const dY = mult * change * sign;
      return answer(q, {
        kind: 'macro',
        expression: `ΔY from ${isTax ? 'a tax change' : isBal ? 'a balanced-budget change' : 'a spending change'} of ${num(change * sign)} · MPC ${num(c)}${t ? `, tax rate ${pct(t)}` : ''}${m ? `, MPM ${num(m)}` : ''}`,
        display: num(dY, 2),
        value: dY,
        lines,
        notes: [t || m ? 'k = 1 ÷ (1 − MPC(1 − t) + MPM)' : 'k = 1 ÷ (1 − MPC); tax multiplier = −MPC ÷ (1 − MPC)'],
      });
    }
    return answer(q, {
      kind: 'macro',
      expression: `${isTax ? 'Tax' : isBal ? 'Balanced-budget' : 'Spending'} multiplier · MPC ${num(c)}${t ? `, tax rate ${pct(t)}` : ''}${m ? `, MPM ${num(m)}` : ''}`,
      display: fix(mult, 4),
      value: mult,
      lines: lines.filter((l) => !l.label.startsWith(isTax ? 'Tax' : isBal ? 'Balanced' : 'Spending')),
      notes: [t || m ? 'k = 1 ÷ (1 − MPC(1 − t) + MPM)' : 'k = 1 ÷ (1 − MPC) = 1 ÷ MPS'],
    });
  }
  if (/\bmoney multiplier\b|\breserve (?:ratio|requirement)\b|\bdeposit multiplier\b/.test(s)) {
    const rr = rateOf(param(s, String.raw`reserve (?:ratio|requirement)(?: of)?|rr|required reserves?(?: ratio)?`), notes, 'reserve ratio');
    if (rr === undefined) return need(q, 'macro', 'What is the reserve ratio? e.g. "reserve ratio 10%"');
    const cr = rateOf(param(s, String.raw`currency(?:[\s-]*(?:deposit|to deposit))? ratio|currency ratio|c`), notes);
    const mm = cr !== undefined ? (1 + cr) / (rr + cr) : 1 / rr;
    const dep = param(s, String.raw`deposits?(?: of)?|new deposit|initial deposit|injection|reserves? (?:of|increase(?: by| of)?)|open market purchase(?: of)?|buys? bonds?(?: worth)?`)?.v;
    const lines: Lines = [];
    if (dep !== undefined) lines.push({ label: 'Maximum change in money supply', display: num(dep * mm, 2) }, { label: 'New money created by lending', display: num(dep * mm - dep, 2) });
    return answer(q, {
      kind: 'macro',
      expression: `Money multiplier · reserve ratio ${pct(rr)}${cr !== undefined ? `, currency ratio ${pct(cr)}` : ''}`,
      display: fix(mm, 4),
      value: mm,
      lines,
      notes: [cr !== undefined ? 'm = (1 + c) ÷ (r + c)' : 'Simple deposit multiplier m = 1 ÷ reserve ratio (no cash leakage, no excess reserves)'],
    });
  }
  if (/\bunemployment rate\b|\blabou?r force participation\b|\bparticipation rate\b/.test(s)) {
    const u = param(s, String.raw`unemployed`)?.v;
    const e = param(s, String.raw`employed`)?.v;
    const lf = param(s, String.raw`labou?r force`)?.v ?? (u !== undefined && e !== undefined ? u + e : undefined);
    const pop = param(s, String.raw`(?:working[\s-]*age |adult |civilian )?population`)?.v;
    if (/participation/.test(s)) {
      if (lf === undefined || pop === undefined) return need(q, 'macro', 'Participation needs the labour force (or employed + unemployed) and the working-age population');
      return answer(q, { kind: 'macro', expression: `Labour force participation · labour force ${num(lf)}, population ${num(pop)}`, display: pct(lf / pop), value: (lf / pop) * 100, notes: ['Participation = labour force ÷ working-age population'] });
    }
    if (u === undefined || lf === undefined) return need(q, 'macro', 'The unemployment rate needs the number unemployed and the labour force (or employed)');
    return answer(q, { kind: 'macro', expression: `Unemployment rate · unemployed ${num(u)}, labour force ${num(lf)}`, display: pct(u / lf), value: (u / lf) * 100, notes: ['Unemployment rate = unemployed ÷ labour force'] });
  }
  return null;
}

// ---------------------------------------------------------------- inequality

export function gini(q: Q): AnswerResult | null {
  const s = q.s;
  if (!/\bgini\b|\blorenz\b/.test(s)) return null;
  const sharesMode = /\b(?:quintile|decile|quartile|income) shares\b|\bshares\b/.test(s);
  const toks = listAfter(s, /\b(?:shares|incomes?|of|data|wealth|values|for)\b|:/);
  if (!toks || toks.length < 2) return need(q, 'gini', 'Give the incomes (or group income shares), e.g. "gini of 10, 20, 30, 40"');
  const x = toks.map((t) => t.v);
  if (x.some((v) => v < 0)) return bad(q, 'gini', 'Incomes must not be negative');
  const n = x.length;
  const notes: string[] = [];
  if (sharesMode) {
    const tot = sum(x);
    const ys = [...x].sort((a, b) => a - b).map((v) => v / tot);
    let cum = 0;
    let B = 0;
    const rows: string[][] = [['0%', '0%']];
    ys.forEach((y, i) => {
      const prev = cum;
      cum += y;
      B += (1 / n) * (prev + cum);
      rows.push([pct((i + 1) / n, 0), pct(cum, 1)]);
    });
    const G = 1 - B;
    if (Math.abs(tot - 100) > 0.5 && Math.abs(tot - 1) > 0.005) notes.push(`Shares sum to ${num(tot)}; normalised`);
    return answer(q, {
      kind: 'gini',
      expression: `Gini from ${n} equal-sized group shares`,
      display: fix(G, 4),
      value: G,
      table: { caption: 'Lorenz curve', columns: ['Population (cumulative)', 'Income (cumulative)'], rows },
      notes: [...notes, 'G = 1 − Σ (Xₖ − Xₖ₋₁)(Yₖ + Yₖ₋₁) (trapezoids under the Lorenz curve); a lower bound since within-group inequality is ignored'],
    });
  }
  const mu = sum(x) / n;
  if (mu === 0) return bad(q, 'gini', 'Total income is zero');
  const sorted = [...x].sort((a, b) => a - b);
  let diff = 0;
  sorted.forEach((v, i) => (diff += (2 * (i + 1) - n - 1) * v));
  const G = diff / (n * n * mu);
  const rows: string[][] = [['0%', '0%']];
  let cum = 0;
  sorted.forEach((v, i) => {
    cum += v;
    rows.push([pct((i + 1) / n, 1), pct(cum / (n * mu), 1)]);
  });
  return answer(q, {
    kind: 'gini',
    expression: `Gini coefficient of ${n} values`,
    display: fix(G, 4),
    value: G,
    lines: [
      { label: 'Sample-corrected (× n/(n−1))', display: fix((G * n) / (n - 1), 4) },
      { label: 'Mean', display: num(mu) },
      { label: 'Share of the top value', display: pct(sorted[n - 1]! / (n * mu), 1) },
    ],
    table: n <= 30 ? { caption: 'Lorenz curve', columns: ['Population (cumulative)', 'Income (cumulative)'], rows } : undefined,
    notes: ['G = Σᵢ Σⱼ |xᵢ − xⱼ| ÷ (2n²μ); 0 = perfect equality, 1 = one person has everything'],
  });
}

// ---------------------------------------------------------------- comparative advantage

export function comparativeAdvantage(q: Q): AnswerResult | null {
  const s = q.s;
  if (!/\bcomparative advantage\b|\babsolute advantage\b|\bopportunity cost\b.*\bor\b|\bgains from trade\b/.test(s)) return null;
  const re = /([a-z][a-z ]*?)\s*(?::|can (?:produce|make)|produces|makes|-)\s*(\d+(?:\.\d+)?)\s*(?:units of\s*)?([a-z]+)\s*or\s*(\d+(?:\.\d+)?)\s*(?:units of\s*)?([a-z]+)/g;
  const found = [...s.matchAll(re)].map((m) => ({ who: m[1]!.replace(/^(?:and|while|whereas|country|comparative advantage|absolute advantage|in one (?:hour|day))\s*/g, '').replace(/\b(?:in one (?:hour|day)|per (?:hour|day))\b/g, '').trim() || 'producer', a: Number(m[2]), ga: m[3]!, b: Number(m[4]), gb: m[5]! }));
  if (found.length < 2) return need(q, 'trade', 'Give what each producer can make, e.g. "comparative advantage A: 10 wine or 5 cloth, B: 6 wine or 4 cloth"');
  const [p1, p2] = [found[0]!, found[1]!];
  const g1 = p1.ga.replace(/s$/, '');
  const g2 = p1.gb.replace(/s$/, '');
  const norm = (p: typeof p1) => (p.ga.replace(/s$/, '') === g1 ? { a: p.a, b: p.b } : { a: p.b, b: p.a });
  const hours = /\bhours?\b|\btakes?\b|\bminutes?\b|\bdays? to\b|\blabou?r (?:hours|units) (?:per|to)\b/.test(s);
  // Outputs per unit of input: invert when the numbers are input requirements.
  const o1 = norm(p1);
  const o2 = norm(p2);
  const out1 = hours ? { a: 1 / o1.a, b: 1 / o1.b } : o1;
  const out2 = hours ? { a: 1 / o2.a, b: 1 / o2.b } : o2;
  const oc1 = out1.b / out1.a; // cost of 1 unit of good a in units of b
  const oc2 = out2.b / out2.a;
  const n1 = p1.who.replace(/\b\w/g, (c) => c.toUpperCase());
  const n2 = p2.who.replace(/\b\w/g, (c) => c.toUpperCase());
  const caA = oc1 < oc2 ? n1 : oc2 < oc1 ? n2 : null;
  const caB = caA === null ? null : caA === n1 ? n2 : n1;
  const table: Table = {
    caption: `Opportunity costs${hours ? ' (from labour requirements)' : ''}`,
    columns: ['Producer', `1 ${g1} costs`, `1 ${g2} costs`],
    rows: [
      [n1, `${num(oc1)} ${g2}`, `${num(1 / oc1)} ${g1}`],
      [n2, `${num(oc2)} ${g2}`, `${num(1 / oc2)} ${g1}`],
    ],
  };
  const absA = out1.a > out2.a ? n1 : out2.a > out1.a ? n2 : 'neither';
  const absB = out1.b > out2.b ? n1 : out2.b > out1.b ? n2 : 'neither';
  return answer(q, {
    kind: 'trade',
    expression: `Comparative advantage · ${n1}: ${num(o1.a)} ${g1} or ${num(o1.b)} ${g2}; ${n2}: ${num(o2.a)} ${g1} or ${num(o2.b)} ${g2}${hours ? ' (input requirements)' : ''}`,
    display: caA === null ? 'No comparative advantage (same opportunity costs)' : `${caA}: ${g1}; ${caB}: ${g2}`,
    lines: [
      { label: `Absolute advantage in ${g1}`, display: absA },
      { label: `Absolute advantage in ${g2}`, display: absB },
      ...(caA ? [{ label: `Mutually beneficial price of 1 ${g1}`, display: `between ${num(Math.min(oc1, oc2))} and ${num(Math.max(oc1, oc2))} ${g2}` }] : []),
    ],
    table,
    notes: ['Comparative advantage = lower opportunity cost; specialise in it and trade at a price between the two opportunity costs'],
  });
}

export { money };
