import { D, MathError, type Answer, type AnswerResult, type Dec } from '@lemma/math-core';
import { extract, frequency, money, NUM_SRC, parseNumber, pct, type Extracted } from './extract';

export interface Ctx {
  input: string;
  s: string;
  x: Extracted;
  /** The previous answer, for "split that 3 ways" / "tip 20% on it". */
  ans?: Dec | null;
}

const ONE = new D(1);

export function ok(c: Ctx, a: Omit<Answer, 'ok' | 'input' | 'notes'> & { notes?: string[] }): Answer {
  return { ok: true, input: c.input, notes: [], ...a };
}

/** A missing input is a question back to the user, not a guess. */
export function need(c: Ctx, kind: string, what: string): AnswerResult {
  return { ok: false, kind, input: c.input, error: new MathError('ambiguous-reference', what) };
}

const sym = (c: Ctx) => c.x.currency;
const m = (c: Ctx, v: Dec) => money(v, sym(c));
const spokenMoney = (c: Ctx, v: Dec) => `${v.toFixed(2, D.ROUND_HALF_UP)}${sym(c) === '$' ? ' dollars' : ''}`;

// ---------- loans & mortgages ----------
export function loan(c: Ctx): AnswerResult | null {
  if (!/\b(?:loan|mortgage|borrow(?:ing)?|financ(?:e|ing)|car payment|monthly payments?|payment on|amortiz\w*)\b/.test(c.s)) return null;
  const rateF = c.x.percents.find((p) => !/^down/.test(p.after));
  const downPct = c.x.percents.find((p) => /^down/.test(p.after));
  const downAmt = c.x.amounts.find((a) => /^down/.test(a.after));
  const principalF = c.x.amounts.find((a) => a !== downAmt);
  const term = c.x.durations[0];
  if (!principalF) return need(c, 'loan', 'How much is the loan for?');
  if (!rateF) return need(c, 'loan', 'What is the interest rate? (e.g. "at 6.5%")');
  if (!term) return need(c, 'loan', 'Over how long? (e.g. "over 30 years")');

  let principal = principalF.value;
  const notes: string[] = [];
  if (downPct) {
    const dp = principal.mul(downPct.value).div(100);
    notes.push(`${downPct.value}% down (${m(c, dp)}) taken off the price`);
    principal = principal.minus(dp);
  } else if (downAmt) {
    notes.push(`${m(c, downAmt.value)} down taken off the price`);
    principal = principal.minus(downAmt.value);
  }
  if (principal.lte(0)) return need(c, 'loan', 'The down payment covers the whole price, so there is nothing to borrow');
  const perYear = /bi-?weekly|every two weeks/.test(c.s) ? 26 : /weekly/.test(c.s) ? 52 : 12;
  const n = term.months.div(12).mul(perYear).round().toNumber();
  if (n < 1) return need(c, 'loan', 'Over how long? The term must be at least one payment period');
  const r = rateF.value.div(100).div(perYear);
  const payment = r.isZero() ? principal.div(n) : principal.mul(r).div(ONE.minus(ONE.plus(r).pow(-n)));
  const total = payment.mul(n);
  const interest = total.minus(principal);

  // Yearly amortisation summary.
  const rows: string[][] = [];
  let balance = principal;
  let yearInterest = new D(0);
  let yearPrincipal = new D(0);
  for (let k = 1; k <= n; k++) {
    const i = balance.mul(r);
    let p = payment.minus(i);
    if (k === n) p = balance;
    balance = balance.minus(p);
    yearInterest = yearInterest.plus(i);
    yearPrincipal = yearPrincipal.plus(p);
    if (k % perYear === 0 || k === n) {
      rows.push([String(Math.ceil(k / perYear)), m(c, yearPrincipal), m(c, yearInterest), m(c, D.max(balance, 0))]);
      yearInterest = new D(0);
      yearPrincipal = new D(0);
    }
  }
  const period = perYear === 12 ? 'month' : perYear === 26 ? 'two weeks' : 'week';
  notes.push(`Fixed rate, ${perYear === 12 ? 'monthly' : period === 'week' ? 'weekly' : 'biweekly'} payments, interest compounded each payment period. Excludes taxes, insurance and fees.`);
  return ok(c, {
    kind: 'loan',
    expression: `${m(c, principal)} at ${rateF.value}% over ${term.years.toDecimalPlaces(2, D.ROUND_HALF_UP)} years`,
    primary: { display: m(c, payment), plain: payment.toFixed(2, D.ROUND_HALF_UP), spoken: `${spokenMoney(c, payment)} per ${period}`, unit: `/ ${period === 'two weeks' ? '2 wks' : period === 'month' ? 'mo' : 'wk'}` },
    value: payment.toDecimalPlaces(2, D.ROUND_HALF_UP),
    lines: [
      { label: 'Number of payments', display: String(n) },
      { label: 'Total paid', display: m(c, total) },
      { label: 'Total interest', display: m(c, interest) },
      { label: 'Interest share', display: pct(interest.div(total), 1) },
    ],
    table: { caption: 'Amortization by year', columns: ['Year', 'Principal', 'Interest', 'Balance'], rows },
    notes,
  });
}

// ---------- savings & investment growth ----------
export function compound(c: Ctx): AnswerResult | null {
  if (!/\b(?:compound\w*|interest|invest\w*|grow|growth of|savings?|future value|fv|deposit|be worth)\b/.test(c.s)) return null;
  if (/\b(?:loan|mortgage|cagr|growth rate|present value|apy|npv|irr|roi)\b/.test(c.s)) return null;
  const simple = /simple interest/.test(c.s);
  const contribRe = new RegExp(`(?:adding|add|contribut\\w*|deposit\\w*|plus|putting in|put in|with)\\s+(${NUM_SRC})\\s*(?:a|per|each|every)\\s*(month|year|week)`);
  // "invest $500 a month", "deposit 200 every month": a recurring amount with no verb in front is a contribution too.
  const recurringRe = new RegExp(`(${NUM_SRC})\\s*(?:a|per|each|every)\\s*(month|year|week)\\b`);
  const contrib = contribRe.exec(c.s) ?? recurringRe.exec(c.s);
  const rest = contrib ? c.s.replace(contrib[0], ' ') : c.s;
  const principalF = c.x.amounts.find((a) => !contrib || a.index < c.s.indexOf(contrib[0]) || a.index >= c.s.indexOf(contrib[0]) + contrib[0].length);
  const rateF = c.x.percents[0];
  const term = c.x.durations[0];
  if (!principalF && !contrib) return need(c, 'interest', 'What is the starting amount?');
  if (!rateF) return need(c, 'interest', 'What is the interest rate?');
  if (!term) return need(c, 'interest', 'For how long?');
  const P = principalF?.value ?? new D(0);
  const rate = rateF.value.div(100);
  const t = term.years;
  const notes: string[] = [];
  if (!t.gt(0)) return need(c, 'interest', 'For how long? The time must be more than zero');

  if (simple) {
    const interest = P.mul(rate).mul(t);
    const fv = P.plus(interest);
    return ok(c, {
      kind: 'interest',
      expression: `Simple interest · ${m(c, P)} at ${rateF.value}% for ${t} years`,
      primary: { display: m(c, interest), plain: interest.toFixed(2, D.ROUND_HALF_UP), spoken: `${spokenMoney(c, interest)} of interest` },
      value: interest.toDecimalPlaces(2, D.ROUND_HALF_UP),
      lines: [
        { label: 'Final amount', display: m(c, fv) },
        { label: 'Formula', display: 'I = P × r × t' },
      ],
    });
  }

  const freq = frequency(rest, 1);
  if (!freq.explicit) notes.push('Compounded annually (say “compounded monthly” to change)');
  let fv: Dec;
  let contributed = new D(0);
  if (freq.n === Infinity) fv = P.mul(D.exp(rate.mul(t)));
  else fv = P.mul(ONE.plus(rate.div(freq.n)).pow(t.mul(freq.n)));

  const rows: string[][] = [];
  if (contrib) {
    const amount = parseNumber(contrib[1]!);
    const per = contrib[2] === 'month' ? 12 : contrib[2] === 'week' ? 52 : 1;
    // Contributions at the end of each period, grown at the equivalent periodic rate.
    const periodic = freq.n === Infinity ? D.exp(rate.div(per)).minus(1) : ONE.plus(rate.div(freq.n)).pow(new D(freq.n).div(per)).minus(1);
    const count = t.mul(per).round();
    const fvContrib = periodic.isZero() ? amount.mul(count) : amount.mul(ONE.plus(periodic).pow(count).minus(1)).div(periodic);
    fv = fv.plus(fvContrib);
    contributed = amount.mul(count);
    notes.push(`${m(c, amount)} added at the end of every ${contrib[2]}`);
  }
  const invested = P.plus(contributed);
  for (let y = 1; y <= Math.min(t.ceil().toNumber(), 60); y++) {
    const yy = D.min(y, t);
    const bal = freq.n === Infinity ? P.mul(D.exp(rate.mul(yy))) : P.mul(ONE.plus(rate.div(freq.n)).pow(yy.mul(freq.n)));
    rows.push([String(y), m(c, bal)]);
  }
  return ok(c, {
    kind: 'interest',
    expression: principalF
      ? `${m(c, P)} at ${rateF.value}% compounded ${freq.label} for ${t} years`
      : `${m(c, parseNumber(contrib![1]!))} every ${contrib![2]} at ${rateF.value}% compounded ${freq.label} for ${t} years`,
    primary: { display: m(c, fv), plain: fv.toFixed(2, D.ROUND_HALF_UP), spoken: spokenMoney(c, fv) },
    value: fv.toDecimalPlaces(2, D.ROUND_HALF_UP),
    lines: [
      { label: 'Interest earned', display: m(c, fv.minus(invested)) },
      ...(contrib ? [{ label: 'Total contributed', display: m(c, invested) }] : []),
      { label: 'Effective annual rate', display: pct(freq.n === Infinity ? D.exp(rate).minus(1) : ONE.plus(rate.div(freq.n)).pow(freq.n).minus(1), 3) },
    ],
    table: contrib ? undefined : { caption: 'Balance by year (no contributions)', columns: ['Year', 'Balance'], rows },
    notes,
  });
}

export function presentValue(c: Ctx): AnswerResult | null {
  if (!/\b(?:present value|pv|discount(?:ed)? value|how much (?:do i need to|should i) (?:invest|save|put away)(?: now| today)?)\b/.test(c.s)) return null;
  const F = c.x.amounts[0];
  const rateF = c.x.percents[0];
  const term = c.x.durations[0];
  if (!F || !rateF || !term) return need(c, 'pv', 'Present value needs a future amount, a rate and a time, e.g. "present value of 10000 in 5 years at 6%"');
  const freq = frequency(c.s, 1);
  const r = rateF.value.div(100);
  const pv = freq.n === Infinity ? F.value.div(D.exp(r.mul(term.years))) : F.value.div(ONE.plus(r.div(freq.n)).pow(term.years.mul(freq.n)));
  return ok(c, {
    kind: 'pv',
    expression: `Present value of ${m(c, F.value)} in ${term.years} years at ${rateF.value}%`,
    primary: { display: m(c, pv), plain: pv.toFixed(2, D.ROUND_HALF_UP), spoken: spokenMoney(c, pv) },
    value: pv.toDecimalPlaces(2, D.ROUND_HALF_UP),
    lines: [{ label: 'Discount', display: m(c, F.value.minus(pv)) }],
    notes: freq.explicit ? [] : ['Discounted annually'],
  });
}

export function cagr(c: Ctx): AnswerResult | null {
  if (!/\b(?:cagr|growth rate|annual(?:ized)? (?:growth|return)|average annual return)\b/.test(c.s)) return null;
  const [a, b] = c.x.amounts;
  const term = c.x.durations[0];
  if (!a || !b || !term) return need(c, 'cagr', 'CAGR needs a start value, an end value and a period, e.g. "CAGR from 1000 to 2500 over 5 years"');
  if (a.value.lte(0)) return need(c, 'cagr', 'The starting value must be positive');
  if (!term.years.gt(0)) return need(c, 'cagr', 'The period must be longer than zero');
  const g = b.value.div(a.value).pow(ONE.div(term.years)).minus(1);
  return ok(c, {
    kind: 'cagr',
    expression: `${m(c, a.value)} → ${m(c, b.value)} over ${term.years} years`,
    primary: { display: pct(g), plain: g.mul(100).toDecimalPlaces(4).toString(), spoken: `${g.mul(100).toDecimalPlaces(2, D.ROUND_HALF_UP)} percent per year` },
    value: g.mul(100).toDecimalPlaces(6),
    lines: [{ label: 'Total growth', display: pct(b.value.div(a.value).minus(1)) }],
    notes: ['Compound annual growth rate: (end ÷ start)^(1 ÷ years) − 1'],
  });
}

export function apy(c: Ctx): AnswerResult | null {
  if (!/\b(?:apy|effective (?:annual )?rate|ear)\b/.test(c.s)) return null;
  const rateF = c.x.percents[0];
  if (!rateF) return need(c, 'apy', 'Which APR? e.g. "APY of 5% compounded daily"');
  const freq = frequency(c.s, 12);
  const r = rateF.value.div(100);
  const ear = freq.n === Infinity ? D.exp(r).minus(1) : ONE.plus(r.div(freq.n)).pow(freq.n).minus(1);
  return ok(c, {
    kind: 'apy',
    expression: `APY of ${rateF.value}% APR compounded ${freq.label}`,
    primary: { display: pct(ear, 4), plain: ear.mul(100).toDecimalPlaces(6).toString(), spoken: `${ear.mul(100).toDecimalPlaces(3)} percent` },
    value: ear.mul(100).toDecimalPlaces(6),
    notes: freq.explicit ? [] : ['Assumed monthly compounding'],
  });
}

function cashFlows(c: Ctx): Dec[] {
  // Everything after the rate (NPV) or keyword (IRR); negatives allowed: "-1000, 300, 400".
  const after = c.s.replace(/^.*?\b(?:npv|irr)\b/, '').replace(new RegExp(`(?:at|rate|discount rate)?\\s*\\d+(?:\\.\\d+)?\\s?(?:%|percent)`), '');
  return [...after.matchAll(/(-|−|minus\s)?\s?[$€£]?(\d[\d,]*(?:\.\d+)?)/g)].map((x) => {
    const v = new D(x[2]!.replace(/,/g, ''));
    return x[1] ? v.neg() : v;
  });
}

export function npv(c: Ctx): AnswerResult | null {
  if (!/\bnpv\b|net present value/.test(c.s)) return null;
  const rateF = c.x.percents[0];
  const flows = cashFlows(c);
  if (!rateF || flows.length < 2) return need(c, 'npv', 'NPV needs a rate and cash flows, e.g. "NPV at 8% of -1000, 300, 400, 500"');
  const r = rateF.value.div(100);
  const value = flows.reduce((acc, f, t) => acc.plus(f.div(ONE.plus(r).pow(t))), new D(0));
  return ok(c, {
    kind: 'npv',
    expression: `NPV at ${rateF.value}% of ${flows.map((f) => f.toString()).join(', ')}`,
    primary: { display: m(c, value), plain: value.toFixed(2, D.ROUND_HALF_UP), spoken: spokenMoney(c, value) },
    value: value.toDecimalPlaces(2, D.ROUND_HALF_UP),
    notes: ['First cash flow is at time 0 (not discounted); the rest are one period apart'],
  });
}

export function irr(c: Ctx): AnswerResult | null {
  if (!/\birr\b|internal rate of return/.test(c.s)) return null;
  const flows = cashFlows(c);
  if (flows.length < 2 || !flows.some((f) => f.isNegative()) || !flows.some((f) => f.isPositive())) {
    return need(c, 'irr', 'IRR needs cash flows with at least one negative and one positive, e.g. "IRR of -1000, 300, 400, 500"');
  }
  const f = (r: number) => flows.reduce((acc, cf, t) => acc + cf.toNumber() / (1 + r) ** t, 0);
  // Bisection on a bracket, then a few Newton steps for precision: robust and fast.
  let lo = -0.9999;
  let hi = 10;
  if (f(lo) * f(hi) > 0) return need(c, 'irr', 'No IRR exists for these cash flows (NPV never crosses zero)');
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(lo) * f(mid) <= 0) hi = mid;
    else lo = mid;
  }
  const r = (lo + hi) / 2;
  const signChanges = flows.slice(1).filter((x, i) => x.isNegative() !== flows[i]!.isNegative()).length;
  return ok(c, {
    kind: 'irr',
    expression: `IRR of ${flows.map((x) => x.toString()).join(', ')}`,
    primary: { display: `${(r * 100).toFixed(2)}%`, plain: (r * 100).toFixed(6), spoken: `${(r * 100).toFixed(2)} percent` },
    value: new D(r * 100).toDecimalPlaces(6),
    notes: signChanges > 1 ? ['Cash flows change sign more than once, so other IRRs may exist'] : [],
  });
}

export function roi(c: Ctx): AnswerResult | null {
  if (!/\broi\b|return on (?:investment|my investment)|percent (?:gain|return)|what(?:'s| is) my return/.test(c.s)) return null;
  const [a, b] = c.x.amounts;
  if (!a || !b) return need(c, 'roi', 'ROI needs what you put in and what you got back, e.g. "ROI if I invest 1000 and get 1500"');
  if (a.value.lte(0)) return need(c, 'roi', 'The amount invested must be more than zero');
  const gain = b.value.minus(a.value);
  const r = gain.div(a.value);
  const term = c.x.durations[0];
  const lines: Answer['lines'] = [{ label: 'Gain', display: m(c, gain) }];
  if (term && term.years.gt(0)) lines.push({ label: 'Annualized', display: pct(b.value.div(a.value).pow(ONE.div(term.years)).minus(1)) });
  return ok(c, {
    kind: 'roi',
    expression: `${m(c, a.value)} → ${m(c, b.value)}`,
    primary: { display: pct(r), plain: r.mul(100).toDecimalPlaces(4).toString(), spoken: `${r.mul(100).toDecimalPlaces(2, D.ROUND_HALF_UP)} percent` },
    value: r.mul(100).toDecimalPlaces(6),
    lines,
  });
}

export { extract };
