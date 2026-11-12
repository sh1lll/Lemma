import type { AnswerResult } from '@lemma/math-core';
import { answer, bad, bisect, fix, list, money, need, NUM, num, param, paramEither, pct, rateOf, years, type Lines, type Q, type Table } from './util';

/**
 * Time value of money and fixed income: annuities (ordinary, due, growing), perpetuities, rate conversions
 * (nominal / effective / continuous), doubling time and the rule of 70, capital budgeting (NPV with IRR, MIRR,
 * payback, discounted payback, profitability index), bonds (price, YTM, current yield, accrued interest,
 * Macaulay/modified duration, convexity, DV01), forward rates from spot rates, and par swap rates.
 */

const FREQ: [RegExp, number, string][] = [
  [/continuous(?:ly)?/, Infinity, 'continuously'],
  [/daily|per day/, 365, 'daily'],
  [/bi-?weekly|fortnightly/, 26, 'biweekly'],
  [/weekly|per week/, 52, 'weekly'],
  [/monthly|per month|a month|each month|every month/, 12, 'monthly'],
  [/quarterly|per quarter|each quarter|every quarter/, 4, 'quarterly'],
  [/semi-?annual(?:ly)?|twice a year|half-?yearly|every six months|every 6 months/, 2, 'semiannually'],
  [/\bannual(?:ly)?\b|yearly|per year|a year|each year|every year|per annum|\bpa\b/, 1, 'annually'],
];
function freqIn(s: string): { m: number; label: string } | undefined {
  for (const [re, m, label] of FREQ) if (re.test(s)) return { m, label };
  return undefined;
}

// ---------------------------------------------------------------- rate conversion

export function rateConversion(q: Q): AnswerResult | null {
  const s = q.s;
  if (!/%/.test(s) || /\b(?:loan|mortgage|bond|annuity|perpetuity|forward|swap|spot)\b/.test(s)) return null;
  if (!/\b(?:nominal|effective|continuous(?:ly)?|ear|eff|apr|apy|equivalent|compounded)\b/.test(s)) return null;
  const split = /^(.*)\b(?:to|into|as|equivalent to|expressed as|in terms of|converted to)\b(.*)$/.exec(s);
  if (!split) return null;
  const [src, dst] = [split[1]!, split[2]!];
  if (!/\b(?:nominal|effective|continuous(?:ly)?|ear|eff|apr|apy|compounded|monthly|quarterly|daily|weekly|semi-?annual(?:ly)?|annual(?:ly)?)\b/.test(dst)) return null;
  const rp = param(src, String.raw`rate|apr|nominal|effective|ear|of|convert|r`) ?? (/(-?\d+(?:\.\d+)?)%/.exec(src) ? { v: Number(/(-?\d+(?:\.\d+)?)%/.exec(src)![1]), pct: true, bps: false, index: 0 } : undefined);
  if (!rp) return null;
  const r = rateOf(rp)!;
  const srcEffective = /\b(?:effective|ear|eff|apy)\b/.test(src) && !/compounded/.test(src);
  const sf = srcEffective ? { m: 1, label: 'effective annual' } : freqIn(src);
  if (!sf) return need(q, 'rate', 'How is the starting rate compounded? e.g. "12% compounded monthly to effective"');
  const ear = sf.m === Infinity ? Math.exp(r) - 1 : (1 + r / sf.m) ** sf.m - 1;
  const dstEffective = /\b(?:effective|ear|eff|apy)\b/.test(dst) && !/compounded|nominal/.test(dst);
  const df = dstEffective ? { m: 1, label: 'effective annual' } : freqIn(dst) ?? (/\bannual\b/.test(dst) ? { m: 1, label: 'effective annual' } : undefined);
  if (!df) return need(q, 'rate', 'Convert to which compounding? e.g. "to effective", "to continuous", "to compounded quarterly"');
  const out = df.m === Infinity ? Math.log(1 + ear) : df.m * ((1 + ear) ** (1 / df.m) - 1);
  const label = (f: { m: number; label: string }) => (f.m === Infinity ? 'continuously compounded' : f.label === 'effective annual' ? 'effective annual' : `compounded ${f.label}`);
  return answer(q, {
    kind: 'rate-conversion',
    expression: `${pct(r, 4).replace(/0+%$/, '%').replace(/\.%/, '%')} ${label(sf)} → ${label(df)}`,
    display: pct(out, 4),
    value: out * 100,
    lines: [{ label: 'Effective annual rate', display: pct(ear, 4) }],
    notes: ['EAR = (1 + r/m)^m − 1, or e^r − 1 when continuous; target rate solves the same EAR'],
  });
}

// ---------------------------------------------------------------- doubling time / rule of 70

export function doubling(q: Q): AnswerResult | null {
  const s = q.s;
  const m = /\brule of (69|70|72)\b|\bdoubl(?:e|ing)\b|\btripl(?:e|ing)\b|\bhalv(?:e|ing)\b/.exec(s);
  if (!m || !/%|\brate\b|\bgrowth\b/.test(s)) return null;
  if (/\b(?:option|bond|loan)\b/.test(s)) return null;
  const rp = param(s.replace(/rule of \d+/, ' '), String.raw`growth(?: rate)?|grows? (?:at|by)|rate|at|of|interest|return`) ?? (/(-?\d+(?:\.\d+)?)%/.exec(s) ? { v: Number(/(-?\d+(?:\.\d+)?)%/.exec(s)![1]), pct: true, bps: false, index: 0 } : undefined);
  if (!rp) return need(q, 'doubling', 'At what growth rate? e.g. "rule of 70 at 3.5%"');
  const g = rateOf(rp)!;
  const factor = /tripl/.test(s) ? 3 : /halv/.test(s) ? 0.5 : 2;
  if (factor === 0.5 ? g >= 0 && !/declin|fall|shrink|lose|decay/.test(s) : g <= 0) {
    if (factor !== 0.5) return bad(q, 'doubling', 'The growth rate must be positive to double');
  }
  const rate = factor === 0.5 && g > 0 ? -g : g;
  const exact = Math.log(factor) / Math.log(1 + rate);
  const rule = m[1] ? Number(m[1]) : 70;
  const approx = factor === 2 ? rule / (g * 100) : factor === 3 ? 110 / (g * 100) : 70 / Math.abs(g * 100);
  const word = factor === 2 ? 'double' : factor === 3 ? 'triple' : 'halve';
  const ruleFirst = !!m[1];
  return answer(q, {
    kind: 'doubling',
    expression: `Time to ${word} at ${pct(Math.abs(g), 4).replace(/\.?0+%$/, '%')} per period`,
    display: `${ruleFirst ? num(approx, 2) : num(exact, 2)} years`,
    value: ruleFirst ? approx : exact,
    spoken: `about ${num(ruleFirst ? approx : exact, 1)} years`,
    lines: ruleFirst
      ? [{ label: 'Exact: ln(2) ÷ ln(1 + g)', display: num(exact, 4) }]
      : [{ label: factor === 2 ? 'Rule of 70 (≈ 70 ÷ %)' : factor === 3 ? 'Rule of 110' : 'Rule of 70', display: num(approx, 2) }, { label: 'Rule of 72', display: factor === 2 ? num(72 / (g * 100), 2) : '—' }],
    notes: ['In years for an annual rate (periods, if the rate is per period)', `Exact: n = ln(${factor}) ÷ ln(1 ${rate < 0 ? '−' : '+'} ${num(Math.abs(rate), 6)}); rule of ${rule}: ${rule} ÷ growth in %`],
  });
}

// ---------------------------------------------------------------- annuities & perpetuities

export function annuity(q: Q): AnswerResult | null {
  const s = q.s;
  const perp = /\bperpetuit(?:y|ies)\b|\bconsols?\b|\bforever\b/.test(s);
  const ann = /\bannuit(?:y|ies)\b/.test(s);
  const pvOfStream = new RegExp(String.raw`\b(?:present value|pv|future value|fv|value today|worth today)\b.*?\$?(?:${NUM})\s*k?\s*(?:per|a|each|every|/)\s*(?:year|yr|month|quarter|week|period)\b.*\bfor\b`).test(s);
  if (!perp && !ann && !pvOfStream) return null;
  if (/\bbond\b|\bloan\b|\bmortgage\b/.test(s)) return null;
  const notes: string[] = [];
  const due = /\bdue\b|\bbeginning of (?:each|the|every)\b|\bin advance\b|\bstarting (?:today|now|immediately)\b|\bstart of (?:each|every)\b/.test(s);
  const gP = param(s, String.raw`grow(?:ing|s|th)?(?: rate)?(?: (?:at|by|of))?|g`);
  const g = rateOf(gP, notes, 'growth') ?? 0;
  const rP = param(s.replace(/grow(?:ing|s|th)?(?: rate)?(?: (?:at|by|of))?\s*-?\d+(?:\.\d+)?%/g, ' '), String.raw`at|rate|interest(?: rate)?|discount(?:ed)?(?: rate)?(?: at| of)?|r|required return|return`)
    ?? (() => {
      const m = /(?:^|[^a-z])(-?\d+(?:\.\d+)?)%/.exec(s.replace(/grow(?:ing|s|th)?(?: rate)?(?: (?:at|by|of))?\s*-?\d+(?:\.\d+)?%/g, ' '));
      return m ? { v: Number(m[1]), pct: true, bps: false, index: 0 } : undefined;
    })();
  const pmtRe = new RegExp(String.raw`(?:\$|€|£|¥|₹)?(${NUM})\s*(k)?\s*(?:per|a|each|every|/)\s*(year|yr|month|quarter|week|period)\b`);
  const pm = pmtRe.exec(s);
  const C0 = pm ? Number(pm[1]!.replace(/,/g, '')) * (pm[2] ? 1000 : 1) : param(s, String.raw`payments?(?: of)?|pmt|cash flows?(?: of)?|pays?|annuity of|perpetuity of|coupon|amount|of`)?.v;
  const perWord = pm?.[3];
  const m = perWord === 'month' ? 12 : perWord === 'quarter' ? 4 : perWord === 'week' ? 52 : 1;
  if (rP === undefined) return need(q, 'annuity', 'What discount rate? e.g. "at 5%"');
  const rAnnual = rateOf(rP, notes)!;
  const r = rAnnual / m;
  const gPer = g / m;
  const fvWanted = /\b(?:future value|fv|accumulate|grow to|will be worth|end value)\b/.test(s);
  // Solve for the payment: "annuity payment for PV 10000 at 6% for 5 years".
  const pvGiven = param(s, String.raw`pv|present value(?: of)?|principal|loan amount|lump sum|cost`);
  const fvGiven = param(s, String.raw`fv|future value(?: of)?|target|goal|accumulate`);
  const solvePmt = /\b(?:payment|pmt|payout|withdrawal|how much (?:per|each|every|a))\b/.test(s) && !pm && (pvGiven || fvGiven);
  if (perp) {
    if (C0 === undefined) return need(q, 'perpetuity', 'What is the payment? e.g. "perpetuity paying 100 a year at 5%"');
    if (r <= gPer) return bad(q, 'perpetuity', `A growing perpetuity needs the discount rate above the growth rate (r = ${pct(rAnnual)}, g = ${pct(g)}): otherwise its value is infinite`);
    const pv = C0 / (r - gPer) * (due ? 1 + r : 1);
    return answer(q, {
      kind: 'perpetuity',
      expression: `${g ? 'Growing perpetuity' : 'Perpetuity'}${due ? ' due' : ''} · ${money(C0, q.cur)} per ${perWord ?? 'period'}${g ? `, growing ${pct(g)}` : ''}, discounted at ${pct(rAnnual)}`,
      display: money(pv, q.cur),
      value: pv,
      lines: [{ label: 'Formula', display: g ? `PV = C ÷ (r − g)${due ? ' × (1 + r)' : ''}` : `PV = C ÷ r${due ? ' × (1 + r)' : ''}` }],
      notes: [...notes, due ? 'First payment today (perpetuity due)' : 'First payment one period from now', ...(m !== 1 ? [`Annual rate ÷ ${m} per period`] : [])],
    });
  }
  const nP = /(\d+(?:\.\d+)?)\s*(?:periods|payments|installments)\b/.exec(s);
  const T = years(s, String.raw`for|n|term|over|lasting`);
  let n: number;
  if (nP) n = Number(nP[1]);
  else if (T) n = Math.round(T.t * m * 1e6) / 1e6;
  else return need(q, 'annuity', 'For how many periods? e.g. "for 10 years"');
  if (!(n > 0)) return bad(q, 'annuity', 'The number of periods must be positive');
  if (!Number.isInteger(n)) {
    notes.push(`Rounded to ${Math.round(n)} whole payments`);
    n = Math.round(n);
  }
  const pvFactor = Math.abs(r - gPer) < 1e-12 ? n / (1 + r) : (1 - ((1 + gPer) / (1 + r)) ** n) / (r - gPer);
  const dueF = due ? 1 + r : 1;
  if (solvePmt) {
    const target = pvGiven && !/\b(?:fv|future value|target|goal|accumulate)\b/.test(s) ? 'pv' : 'fv';
    const amount = (target === 'pv' ? pvGiven : fvGiven)!.v;
    const factor = target === 'pv' ? pvFactor * dueF : pvFactor * dueF * (1 + r) ** n;
    const pmt = amount / factor;
    return answer(q, {
      kind: 'annuity',
      expression: `Payment for ${target === 'pv' ? 'present' : 'future'} value ${money(amount, q.cur)} · ${pct(rAnnual)}${m !== 1 ? ` (÷ ${m})` : ''}, ${n} payments${due ? ', annuity due' : ''}${g ? `, growing ${pct(g)}` : ''}`,
      display: money(pmt, q.cur),
      value: pmt,
      unit: `per ${m === 12 ? 'month' : m === 4 ? 'quarter' : m === 52 ? 'week' : 'period'}`,
      lines: [{ label: 'Total paid', display: money(pmt * n, q.cur) }],
      notes: [...notes, target === 'pv' ? 'PMT = PV × r ÷ (1 − (1 + r)^−n)' : 'PMT = FV × r ÷ ((1 + r)^n − 1)', ...(due ? ['Payments at the start of each period'] : [])],
    });
  }
  if (C0 === undefined) return need(q, 'annuity', 'What is the payment per period? e.g. "annuity of 1000 per year for 10 years at 5%"');
  const pv = C0 * pvFactor * dueF;
  const fv = pv * (1 + r) ** n;
  const label = `${g ? 'Growing annuity' : 'Annuity'}${due ? ' due' : ''}`;
  const lines: Lines = [
    { label: fvWanted ? 'Present value' : 'Future value', display: money(fvWanted ? pv : fv, q.cur) },
    { label: 'Total of payments', display: money(g ? C0 * (Math.abs(gPer) < 1e-12 ? n : ((1 + gPer) ** n - 1) / gPer) : C0 * n, q.cur) },
    { label: 'Periods × rate per period', display: `${n} × ${pct(r, 4)}` },
  ];
  return answer(q, {
    kind: 'annuity',
    expression: `${fvWanted ? 'Future' : 'Present'} value of ${label.toLowerCase()} · ${money(C0, q.cur)} per ${perWord ?? 'period'}${g ? ` growing ${pct(g)}` : ''} for ${n} periods at ${pct(rAnnual)}${m !== 1 ? ` (${pct(r, 4)} per period)` : ''}`,
    display: money(fvWanted ? fv : pv, q.cur),
    value: fvWanted ? fv : pv,
    lines,
    notes: [
      ...notes,
      g ? 'PV = C ÷ (r − g) × [1 − ((1 + g)/(1 + r))^n]' : 'PV = C × [1 − (1 + r)^−n] ÷ r; FV = PV × (1 + r)^n',
      due ? 'Annuity due: payments at the start of each period (× (1 + r))' : 'Ordinary annuity: payments at the end of each period',
    ],
  });
}

// ---------------------------------------------------------------- capital budgeting

function flowsFrom(s: string): number[] {
  const body = s
    .replace(/\b(?:finance|financing|reinvest(?:ment)?|discount|hurdle|cost of capital|wacc|safe|borrowing)?\s*(?:rate)?\s*(?:of|at|=|:)?\s*-?\d+(?:\.\d+)?%/g, ' ')
    .replace(/\b(?:year|yr|t|period)\s*\d+\s*[:=]?/g, ' ')
    .replace(/^.*?(?:cash ?flows?|flows|of|:)\s/, ' ');
  return list(body).map((t) => t.v);
}

function npvAt(flows: number[], r: number): number {
  return flows.reduce((a, f, t) => a + f / (1 + r) ** t, 0);
}

function payback(flows: number[], r = 0): number | null {
  let cum = 0;
  for (let t = 0; t < flows.length; t++) {
    const pv = flows[t]! / (1 + r) ** t;
    const prev = cum;
    cum += pv;
    if (t > 0 && prev < 0 && cum >= 0) return t - 1 + -prev / pv;
  }
  return null;
}

export function budgeting(q: Q): AnswerResult | null {
  const s = q.s;
  const want = {
    mirr: /\bmirr\b|modified (?:irr|internal rate)/.test(s),
    payback: /\bpayback\b|pay back period/.test(s),
    dpayback: /discounted payback/.test(s),
    pi: /profitability index|benefit[\s-]*cost ratio/.test(s),
    full: /capital budgeting|evaluate (?:the |this )?(?:project|investment)|project analysis|(?:npv|net present value).*\b(?:and|with|,)\b.*\b(?:irr|payback|mirr)\b/.test(s),
  };
  if (!want.mirr && !want.payback && !want.pi && !want.full) return null;
  const flows = flowsFrom(s);
  if (flows.length < 2) return need(q, 'capital-budgeting', 'Give the cash flows starting with the initial outlay, e.g. "payback of -1000, 300, 400, 500, 200"');
  if (!flows.some((f) => f < 0) || !flows.some((f) => f > 0)) return need(q, 'capital-budgeting', 'The cash flows need at least one outflow (negative) and one inflow');
  const notes: string[] = [];
  const disc = rateOf(param(s, String.raw`at|discount(?: rate)?|rate|wacc|cost of capital|hurdle(?: rate)?|r`), notes);
  const fin = rateOf(param(s, String.raw`financ(?:e|ing)(?: rate)?|borrowing rate|safe rate`), notes) ?? disc;
  const reinv = rateOf(param(s, String.raw`reinvest(?:ment|ing)?(?: rate)?|reinvested at`), notes) ?? disc;
  const lines: Lines = [];
  const rows: string[][] = [];
  let cum = 0;
  let dcum = 0;
  flows.forEach((f, t) => {
    cum += f;
    const pv = disc !== undefined ? f / (1 + disc) ** t : NaN;
    dcum += pv;
    rows.push([String(t), money(f, q.cur), money(cum, q.cur), ...(disc !== undefined ? [money(pv, q.cur), money(dcum, q.cur)] : [])]);
  });
  const table: Table = { caption: 'Cash flows', columns: ['Year', 'Cash flow', 'Cumulative', ...(disc !== undefined ? ['PV', 'Cumulative PV'] : [])], rows };
  const irr = bisect((r) => npvAt(flows, r), -0.9999, 100, 1e-12);
  const pb = payback(flows);
  const yrs = (x: number | null) => (x === null ? 'never (cumulative cash stays negative)' : `${fix(x, 2)} years`);
  let primary: { label: string; display: string; value: number } | null = null;
  if (want.mirr) {
    if (fin === undefined || reinv === undefined) return need(q, 'capital-budgeting', 'MIRR needs a finance rate and a reinvestment rate, e.g. "MIRR of -1000, 300, 400, 500 finance 10% reinvest 12%"');
    const n = flows.length - 1;
    const pvNeg = flows.reduce((a, f, t) => a + (f < 0 ? f / (1 + fin) ** t : 0), 0);
    const fvPos = flows.reduce((a, f, t) => a + (f > 0 ? f * (1 + reinv) ** (n - t) : 0), 0);
    const mirr = (fvPos / -pvNeg) ** (1 / n) - 1;
    primary = { label: 'MIRR', display: pct(mirr), value: mirr * 100 };
    lines.push({ label: 'PV of outflows at finance rate', display: money(pvNeg, q.cur) }, { label: 'FV of inflows at reinvestment rate', display: money(fvPos, q.cur) });
    notes.push(`MIRR = (FV of inflows at ${pct(reinv)} ÷ −PV of outflows at ${pct(fin)})^(1/${n}) − 1 (Excel MIRR convention)`);
  }
  if (want.dpayback) {
    if (disc === undefined) return need(q, 'capital-budgeting', 'Discounted payback needs a discount rate, e.g. "at 8%"');
    const d = payback(flows, disc);
    if (!primary) primary = { label: 'Discounted payback', display: yrs(d), value: d ?? NaN };
    else lines.push({ label: 'Discounted payback', display: yrs(d) });
  }
  if (want.payback && !want.dpayback) {
    if (!primary) primary = { label: 'Payback period', display: yrs(pb), value: pb ?? NaN };
  }
  if (want.pi) {
    if (disc === undefined) return need(q, 'capital-budgeting', 'The profitability index needs a discount rate, e.g. "at 10%"');
    const pvIn = flows.reduce((a, f, t) => a + (f > 0 ? f / (1 + disc) ** t : 0), 0);
    const pvOut = -flows.reduce((a, f, t) => a + (f < 0 ? f / (1 + disc) ** t : 0), 0);
    const pi = pvIn / pvOut;
    if (!primary) primary = { label: 'Profitability index', display: fix(pi, 4), value: pi };
    else lines.push({ label: 'Profitability index', display: fix(pi, 4) });
    notes.push('PI = PV of inflows ÷ PV of outflows; accept when PI > 1');
  }
  if (disc !== undefined) {
    const npv = npvAt(flows, disc);
    if (!primary) primary = { label: 'NPV', display: money(npv, q.cur), value: npv };
    else lines.unshift({ label: `NPV at ${pct(disc)}`, display: money(npv, q.cur) });
    if (!want.pi) {
      const pvIn = flows.reduce((a, f, t) => a + (f > 0 ? f / (1 + disc) ** t : 0), 0);
      const pvOut = -flows.reduce((a, f, t) => a + (f < 0 ? f / (1 + disc) ** t : 0), 0);
      lines.push({ label: 'Profitability index', display: fix(pvIn / pvOut, 4) });
    }
    if (!want.dpayback) lines.push({ label: 'Discounted payback', display: yrs(payback(flows, disc)) });
  }
  if (irr !== null) lines.push({ label: 'IRR', display: pct(irr) });
  if (primary?.label !== 'Payback period') lines.push({ label: 'Payback', display: yrs(pb) });
  if (!primary) primary = { label: 'Payback period', display: yrs(pb), value: pb ?? NaN };
  const signChanges = flows.slice(1).filter((x, i) => x < 0 !== flows[i]! < 0).length;
  if (signChanges > 1) notes.push('Cash flows change sign more than once, so the IRR may not be unique');
  notes.push('Year 0 is today (not discounted); payback interpolates within the year assuming even cash flow');
  return answer(q, {
    kind: 'capital-budgeting',
    expression: `${primary.label} · cash flows ${flows.map((f) => num(f)).join(', ')}${disc !== undefined ? ` at ${pct(disc)}` : ''}`,
    display: primary.display,
    value: Number.isFinite(primary.value) ? primary.value : undefined,
    lines,
    table,
    notes: [...new Set(notes)],
  });
}

// ---------------------------------------------------------------- bonds

interface BondIn {
  F: number;
  c: number;
  m: number;
  n: number;
  notes: string[];
}

export function bondPrice(F: number, c: number, y: number, n: number, m: number): number {
  const k = Math.round(n * m);
  const cp = (F * c) / m;
  const j = y / m;
  if (Math.abs(j) < 1e-14) return cp * k + F;
  return cp * (1 - (1 + j) ** -k) / j + F * (1 + j) ** -k;
}

export function bondRisk(F: number, c: number, y: number, n: number, m: number): { price: number; mac: number; mod: number; conv: number } {
  const k = Math.round(n * m);
  const cp = (F * c) / m;
  const j = y / m;
  let P = 0;
  let D = 0;
  let C = 0;
  for (let i = 1; i <= k; i++) {
    const cf = cp + (i === k ? F : 0);
    const pv = cf / (1 + j) ** i;
    P += pv;
    D += (i / m) * pv;
    C += ((i * (i + 1)) / (m * m)) * pv;
  }
  const mac = D / P;
  return { price: P, mac, mod: mac / (1 + j), conv: C / (P * (1 + j) ** 2) };
}

export function bonds(q: Q): AnswerResult | null {
  const s = q.s;
  const accrued = /accrued interest|dirty price|clean price|full price|invoice price/.test(s);
  const zero = /zero[\s-]*coupon|\bzcb\b|discount bond/.test(s);
  if (!/\bbonds?\b|\bytm\b|yield to maturity|current yield|\bmacaulay\b|modified duration|\bconvexity\b|\bdv01\b|\bpvbp\b/.test(s) && !(/\bcoupon\b/.test(s) && /\byield|matur|\bface\b|\bpar\b/.test(s)) && !accrued && !zero) return null;
  if (/\bduration\b/.test(s) && !/\bbond|coupon|ytm|yield|macaulay|modified/.test(s)) return null;
  if (/\bswap\b|\bforward rate|\bspot rates\b|\boption\b|\bstress|\bscenario\b|\bshock|\bportfolio\b/.test(s)) return null;
  const notes: string[] = [];
  const cP = param(s, String.raw`coupon(?: rate)?|cpn|pays?|paying`) ?? (/(\d+(?:\.\d+)?)%\s*coupon/.exec(s) ? { v: Number(/(\d+(?:\.\d+)?)%\s*coupon/.exec(s)![1]), pct: true, bps: false, index: 0 } : undefined);
  const yP = param(s, String.raw`ytm|yield to maturity|yield|market rate|market yield|discount rate|required (?:rate of )?return|required yield|rate|y|r`);
  const priceP = param(s, String.raw`price(?:d at)?|trading at|trades at|sells for|selling for|market price|quoted at|clean price|costs?`);
  const faceP = param(s, String.raw`face(?: value)?|par(?: value)?|principal|redemption(?: value)?|fv|nominal(?: value)?|denomination`) ?? (/(?:\$|€|£)?(\d[\d,]*)\s*(?:face|par)\b/.exec(s) ? { v: Number(/(?:\$|€|£)?(\d[\d,]*)\s*(?:face|par)\b/.exec(s)![1]!.replace(/,/g, '')), pct: false, bps: false, index: 0 } : undefined);
  const f = freqIn(s.replace(/compounded \w+/, ''));
  const m = zero && !f ? 1 : f && f.m !== Infinity && f.m <= 12 ? f.m : 1;
  if (!f && !zero && !accrued) notes.push('Annual coupons assumed (say "semiannual" to change)');

  if (accrued) {
    const c = rateOf(cP, notes, 'coupon');
    if (c === undefined) return need(q, 'bond', 'Accrued interest needs the coupon rate, e.g. "accrued interest 6% coupon semiannual 60 days since last coupon"');
    const F = faceP?.v ?? 1000;
    if (!faceP) notes.push(`Face value ${num(F)} assumed`);
    const mm = f && f.m !== Infinity ? f.m : 2;
    if (!f) notes.push('Semiannual coupons assumed');
    const days = paramEither(s, String.raw`days? since (?:the )?last coupon|days accrued|accrued days|days elapsed|days`)?.v ?? (/(\d+)\s*days?\b/.exec(s) ? Number(/(\d+)\s*days?\b/.exec(s)![1]) : undefined);
    if (days === undefined) return need(q, 'bond', 'How many days since the last coupon? e.g. "60 days since last coupon"');
    const periodDays = param(s, String.raw`days in (?:the )?(?:coupon )?period|period(?: of| length)?|out of|of a`)?.v ?? (/\bactual\b|act\/act/.test(s) ? 182.5 : 360 / mm);
    if (!param(s, String.raw`days in (?:the )?(?:coupon )?period|period(?: of| length)?|out of|of a`)) notes.push(`30/360 day count: ${num(periodDays)} days per coupon period`);
    const cpn = (F * c) / mm;
    const ai = cpn * (days / periodDays);
    const clean = param(s, String.raw`clean price|quoted price|price`)?.v;
    const lines: Lines = [
      { label: 'Coupon per period', display: money(cpn, q.cur) },
      { label: 'Fraction of period', display: `${num(days)} ÷ ${num(periodDays)} = ${fix(days / periodDays, 6)}` },
    ];
    if (clean !== undefined) {
      // Quotes below ~200 are per 100 of face.
      const cleanAmt = clean < 200 && F >= 1000 ? (clean * F) / 100 : clean;
      lines.push({ label: 'Dirty (full) price', display: money(cleanAmt + ai, q.cur) });
    }
    return answer(q, {
      kind: 'bond',
      expression: `Accrued interest · ${pct(c)} coupon on ${money(F, q.cur)}, ${mm === 2 ? 'semiannual' : mm === 1 ? 'annual' : `${mm}×/yr`}, ${num(days)} days accrued`,
      display: money(ai, q.cur),
      value: ai,
      lines,
      notes: [...notes, 'AI = coupon per period × days since last coupon ÷ days in the period; dirty price = clean + AI'],
    });
  }

  const c = zero ? 0 : rateOf(cP, notes, 'coupon');
  const T = years(s, String.raw`maturity|matures in|maturing in|n|term|tenor|t|years? to maturity`);
  const F = faceP?.v ?? (priceP && priceP.v < 200 ? 100 : 1000);
  if (!faceP) notes.push(`Face value ${num(F)} assumed`);
  if (c === undefined) return need(q, 'bond', 'What is the coupon rate? e.g. "5% coupon" (or say zero-coupon)');
  if (!T) return need(q, 'bond', 'When does the bond mature? e.g. "10 years"');
  const n = T.t;
  if (Math.abs(n * m - Math.round(n * m)) > 1e-6) notes.push(`Rounded to ${Math.round(n * m)} whole coupon periods`);
  if (Math.round(n * m) < 1) return bad(q, 'bond', 'The bond must have at least one coupon period left');
  const yGiven = rateOf(yP?.index !== cP?.index ? yP : undefined, notes, 'yield');
  const wantYtm = /\bytm\b|yield to maturity|what(?:'s| is) the yield|\byield\b(?! ?(?:of|=|is|at)? ?\d)/.test(s) && priceP !== undefined;
  let y: number;
  let solved = false;
  if (wantYtm || (yGiven === undefined && priceP)) {
    const P = priceP!.v;
    const r = bisect((yy) => bondPrice(F, c, yy, n, m) - P, -0.99 * m, 10 * m, 1e-13);
    if (r === null) return bad(q, 'bond', 'No yield reproduces that price');
    y = r;
    solved = true;
  } else if (yGiven !== undefined) y = yGiven;
  else return need(q, 'bond', 'What is the yield to maturity (or the price, to solve for the yield)?');
  const rk = bondRisk(F, c, y, n, m);
  const price = rk.price;
  const cy = (F * c) / price;
  const dy = rateOf(param(s, String.raw`(?:yields? )?(?:rises?|increases?|goes up|falls?|drops?|decreases?|goes down|changes?|shifts?|moves?|shock)(?: by| of)?`), notes);
  const sign = /falls?|drops?|decreases?|goes down/.test(s) ? -1 : 1;
  const lines: Lines = [];
  const wants = {
    mac: /macaulay/.test(s),
    mod: /modified duration/.test(s),
    dur: /\bduration\b/.test(s),
    conv: /convexity/.test(s),
    cy: /current yield/.test(s),
    dv01: /\bdv01\b|\bpvbp\b|price value of a basis point/.test(s),
  };
  if (!solved) lines.push({ label: 'Price', display: money(price, q.cur) });
  else lines.push({ label: 'Yield to maturity', display: pct(y, 4) });
  lines.push(
    { label: 'Current yield', display: pct(cy, 4) },
    { label: 'Macaulay duration', display: `${fix(rk.mac, 4)} years` },
    { label: 'Modified duration', display: fix(rk.mod, 4) },
    { label: 'Convexity', display: fix(rk.conv, 4) },
    { label: 'DV01 (per 1 bp)', display: money(rk.mod * price * 1e-4, q.cur, 4) },
  );
  if (m > 1 && (solved || wants.cy)) lines.push({ label: 'Effective annual yield', display: pct((1 + y / m) ** m - 1, 4) });
  if (dy !== undefined && dy !== 0) {
    const d = sign * Math.abs(dy);
    const est = -rk.mod * d + 0.5 * rk.conv * d * d;
    const actual = bondPrice(F, c, y + d, n, m) / price - 1;
    lines.push(
      { label: `Price change if yield ${d > 0 ? '+' : '−'}${fix(Math.abs(d) * 1e4, 0)} bp (duration + convexity)`, display: `${pct(est, 3)} → ${money(price * (1 + est), q.cur)}` },
      { label: 'Exact repricing', display: `${pct(actual, 3)} → ${money(price * (1 + actual), q.cur)}` },
    );
  }
  const describe = `${zero ? 'Zero-coupon' : `${pct(c, 3).replace(/\.?0+%$/, '%')} coupon`} ${money(F, q.cur, 0)} bond, ${num(n)} years${m > 1 ? `, ${m === 2 ? 'semiannual' : m === 4 ? 'quarterly' : `${m}×/yr`} coupons` : ''}`;
  const pick = (label: string, display: string, value: number) => ({ label, display, value });
  const main = wants.mac || (wants.dur && !wants.mod)
    ? pick('Macaulay duration', `${fix(rk.mac, 4)} years`, rk.mac)
    : wants.mod
      ? pick('Modified duration', fix(rk.mod, 4), rk.mod)
      : wants.conv
        ? pick('Convexity', fix(rk.conv, 4), rk.conv)
        : wants.cy
          ? pick('Current yield', pct(cy, 4), cy * 100)
          : wants.dv01
            ? pick('DV01', money(rk.mod * price * 1e-4, q.cur, 4), rk.mod * price * 1e-4)
            : solved
              ? pick('Yield to maturity', pct(y, 4), y * 100)
              : pick('Price', money(price, q.cur), price);
  return answer(q, {
    kind: 'bond',
    expression: `${main.label} · ${describe}, ${solved ? `price ${money(priceP!.v, q.cur)}` : `YTM ${pct(y, 3)}`}`,
    display: main.display,
    value: main.value,
    lines: lines.filter((l) => l.label !== main.label),
    notes: [
      ...notes,
      'P = Σ (cF/m)/(1 + y/m)^k + F/(1 + y/m)^(nm); Macaulay D = Σ tₖ·PVₖ ÷ P; modified = D ÷ (1 + y/m); convexity = Σ k(k+1)/m²·PVₖ ÷ (P(1 + y/m)²)',
      ...(solved ? ['YTM solved by bisection; quoted as a nominal annual rate compounded at the coupon frequency'] : []),
    ],
  });
}

// ---------------------------------------------------------------- forward rates, swap rates

/** Spot rates in order of maturity: "1-year 4%, 2-year 5%" or "spot rates 3%, 3.5%, 4%". */
function spotCurve(s: string): { t: number; r: number }[] {
  const labelled = [...s.matchAll(/(\d+(?:\.\d+)?)\s*-?\s*(?:years?|yrs?|y)\b[^%\d]{0,20}?(-?\d+(?:\.\d+)?)%/g)].map((m) => ({ t: Number(m[1]), r: Number(m[2]) / 100 }));
  if (labelled.length >= 2) return labelled.sort((a, b) => a.t - b.t);
  const pcts = [...s.matchAll(/(-?\d+(?:\.\d+)?)%/g)].map((m) => Number(m[1]) / 100);
  return pcts.map((r, i) => ({ t: i + 1, r }));
}

export function forwardRates(q: Q): AnswerResult | null {
  const s = q.s;
  if (!/\bforward rates?\b|\bimplied forward\b|\b\d+y\d+y\b|\bforward\b.*\bspot rates?\b|\bspot rates?\b.*\bforward\b/.test(s)) return null;
  const cont = /continuous/.test(s);
  const curve = spotCurve(s.replace(/\b\d+y\d+y\b/, ' '));
  if (curve.length < 2) return need(q, 'forward-rate', 'Give at least two spot rates, e.g. "forward rate from 1-year spot 4% and 2-year spot 5%"');
  let a: number | undefined;
  let b: number | undefined;
  const yy = /\b(\d+)y(\d+)y\b/.exec(s);
  const between = /\b(?:between|from) (?:year |yr |t ?= ?)?(\d+(?:\.\d+)?) (?:and|to) (?:year |yr |t ?= ?)?(\d+(?:\.\d+)?)\b/.exec(s);
  const fab = /\bf\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\)/.exec(s);
  if (yy) [a, b] = [Number(yy[1]), Number(yy[1]) + Number(yy[2])];
  else if (fab) [a, b] = [Number(fab[1]), Number(fab[2])];
  else if (between && !curve.some((c) => c.t === Number(between[1]) && /from \d+[\s-]*(?:year|yr|y)/.test(s))) [a, b] = [Number(between[1]), Number(between[2])];
  const at = (t: number) => curve.find((c) => Math.abs(c.t - t) < 1e-9)?.r;
  const growth = (t: number, r: number) => (cont ? Math.exp(r * t) : (1 + r) ** t);
  const fwd = (t1: number, r1: number, t2: number, r2: number) => (cont ? (r2 * t2 - r1 * t1) / (t2 - t1) : (growth(t2, r2) / growth(t1, r1)) ** (1 / (t2 - t1)) - 1);
  const rows = curve.slice(1).map((c, i) => {
    const p = curve[i]!;
    return [`${num(p.t)} → ${num(c.t)}`, pct(p.r, 3), pct(c.r, 3), pct(fwd(p.t, p.r, c.t, c.r), 4)];
  });
  if (a === undefined || b === undefined) {
    const last = curve[curve.length - 1]!;
    const prev = curve[curve.length - 2]!;
    a = prev.t;
    b = last.t;
  }
  const ra = a === 0 ? 0 : at(a);
  const rb = at(b);
  if (ra === undefined || rb === undefined) return need(q, 'forward-rate', `I need spot rates for years ${num(a)} and ${num(b)}`);
  if (!(b > a)) return bad(q, 'forward-rate', 'The forward period must end after it starts');
  const f = fwd(a, ra, b, rb);
  return answer(q, {
    kind: 'forward-rate',
    expression: `Forward rate from year ${num(a)} to ${num(b)} · spot ${pct(ra, 3)} (${num(a)}y), ${pct(rb, 3)} (${num(b)}y)${cont ? ', continuous' : ''}`,
    display: pct(f, 4),
    value: f * 100,
    table: rows.length > 1 ? { caption: 'One-period forwards', columns: ['Period', 'Spot (start)', 'Spot (end)', 'Forward'], rows } : undefined,
    notes: [cont ? 'Continuous: f = (r₂t₂ − r₁t₁) ÷ (t₂ − t₁)' : '(1 + s₂)^t₂ = (1 + s₁)^t₁ × (1 + f)^(t₂ − t₁), annual compounding (say "continuous" to change)'],
  });
}

export function swapRate(q: Q): AnswerResult | null {
  const s = q.s;
  if (!/\bswap rate\b|\bpar swap\b|\bswap\b.*\b(?:discount factors?|spot|zero)\b|\bfixed (?:leg|rate) of (?:a|an|the) (?:interest rate )?swap\b/.test(s)) return null;
  const f = freqIn(s.replace(/compounded \w+/, ''));
  const m = f && f.m !== Infinity ? f.m : 1;
  let dfs: number[] = [];
  const notes: string[] = [];
  const dfText = /discount factors?:?\s*([^a-z]*)/.exec(s);
  if (dfText) dfs = list(dfText[1]!).map((t) => t.v);
  else {
    const curve = spotCurve(s);
    if (curve.length < 1) return need(q, 'swap', 'Give discount factors or zero (spot) rates, e.g. "swap rate with discount factors 0.97 0.94 0.91"');
    const cont = /continuous/.test(s);
    dfs = curve.map((c) => (cont ? Math.exp(-c.r * c.t) : (1 + c.r) ** -c.t));
    notes.push(`Discount factors from the zero rates (${cont ? 'continuous' : 'annual'} compounding): ${dfs.map((d) => fix(d, 6)).join(', ')}`);
    if (m !== 1) notes.push('Spot rates are taken one per payment date');
  }
  if (!dfs.length || dfs.some((d) => !(d > 0 && d <= 1.5))) return need(q, 'swap', 'Discount factors must be positive numbers like 0.97');
  const annuity = dfs.reduce((a, d) => a + d / m, 0);
  const rate = (1 - dfs[dfs.length - 1]!) / annuity;
  return answer(q, {
    kind: 'swap',
    expression: `Par swap rate · ${dfs.length} ${m === 1 ? 'annual' : m === 2 ? 'semiannual' : m === 4 ? 'quarterly' : `${m}×/yr`} payments`,
    display: pct(rate, 4),
    value: rate * 100,
    lines: [
      { label: 'Annuity factor Σ τ·P(tᵢ)', display: fix(annuity, 6) },
      { label: 'Final discount factor', display: fix(dfs[dfs.length - 1]!, 6) },
    ],
    notes: [...notes, 'Par swap rate = (1 − P(tₙ)) ÷ Σ τ·P(tᵢ): the fixed rate that makes the swap worth zero (single-curve)'],
  });
}

export { npvAt, payback };
export const _internal = { flowsFrom, spotCurve, NUM };
