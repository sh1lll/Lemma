import type { AnswerResult } from '@lemma/math-core';
import { answer, bad, fix, listAfter, money, need, Ninv, NUM, num, param, paramEither, pct, rateOf, sum, toNum, years, type Lines, type Q, type Table } from './util';

/**
 * Business maths: P&L margins, markup ↔ margin, break-even with target profit, ROAS / ROE / ROA (DuPont), CAC / LTV /
 * payback, churn and retention (cohorts), MRR / ARR growth and net revenue retention, pricing with elasticity,
 * EOQ / reorder point / safety stock, depreciation schedules, payroll gross-to-net (no tax tables: rates as stated),
 * financial ratios, NPS, and conversion funnels.
 */

const m$ = (q: Q, x: number, dp = 2) => money(x, q.cur, dp);

// ---------------------------------------------------------------- margins

export function margins(q: Q): AnswerResult | null {
  const s = q.s;
  const conv = /\b(?:markup|mark-up|mark up)\b.*\b(?:to|into|as|equivalent)\b.*\bmargin\b|\bmargin\b.*\b(?:to|into|as|equivalent)\b.*\bmark-?\s?up\b/.test(s);
  if (conv) {
    const p = /(-?\d+(?:\.\d+)?)%/.exec(s);
    if (!p) return need(q, 'margin', 'Which percentage? e.g. "25% markup to margin"');
    const x = Number(p[1]) / 100;
    const toMargin = s.indexOf('margin') > s.search(/mark-?\s?up/);
    if (!toMargin && x >= 1) return bad(q, 'margin', 'A margin must be below 100%');
    const y = toMargin ? x / (1 + x) : x / (1 - x);
    return answer(q, {
      kind: 'margin',
      expression: toMargin ? `${pct(x)} markup as a margin` : `${pct(x)} margin as a markup`,
      display: pct(y),
      value: y * 100,
      notes: [toMargin ? 'Margin = markup ÷ (1 + markup)' : 'Markup = margin ÷ (1 − margin)', 'Margin = profit ÷ price; markup = profit ÷ cost'],
    });
  }
  if (!/\b(?:gross|operating|net|ebitda|ebit|pre-?tax|profit) (?:profit )?margins?\b|\bincome statement\b|\bp&l\b/.test(s)) return null;
  const rev = param(s, String.raw`revenue|sales|turnover|net sales|top line`)?.v;
  if (rev === undefined) return null;
  const cogs = param(s, String.raw`cogs|cost of (?:goods )?sold|cost of sales|cost of revenue|direct costs?`)?.v;
  const gp = param(s, String.raw`gross profit`)?.v ?? (cogs !== undefined ? rev - cogs : undefined);
  const opex = param(s, String.raw`opex|operating (?:expenses|costs)|sg&a|overheads?`)?.v;
  const da = param(s, String.raw`d&a|depreciation(?: and amortization)?`)?.v ?? 0;
  const ebit = param(s, String.raw`operating (?:income|profit)|ebit`)?.v ?? (gp !== undefined && opex !== undefined ? gp - opex - (opex !== undefined && /\bd&a\b|depreciation/.test(s) ? da : 0) : undefined);
  const interest = param(s, String.raw`interest(?: expense)?`)?.v ?? 0;
  const taxP = param(s, String.raw`tax(?:es)?(?: rate)?`);
  let ni = param(s, String.raw`net (?:income|profit|earnings)|bottom line`)?.v;
  const lines: Lines = [];
  const notes: string[] = [];
  if (ni === undefined && ebit !== undefined) {
    const ebt = ebit - interest;
    const taxes = taxP ? (taxP.pct ? (ebt * taxP.v) / 100 : taxP.v) : 0;
    if (taxP?.pct) notes.push(`Tax at ${num(taxP.v)}% of pre-tax income`);
    ni = ebt - taxes;
  }
  if (gp !== undefined) lines.push({ label: 'Gross margin', display: `${pct(gp / rev)} (${m$(q, gp)})` });
  if (ebit !== undefined) lines.push({ label: 'Operating margin', display: `${pct(ebit / rev)} (${m$(q, ebit)})` });
  if (ebit !== undefined && (da || /ebitda/.test(s))) lines.push({ label: 'EBITDA margin', display: pct((ebit + da) / rev) });
  if (ni !== undefined) lines.push({ label: 'Net margin', display: `${pct(ni / rev)} (${m$(q, ni)})` });
  const want = /\bgross\b/.test(s) ? 'Gross margin' : /\bebitda\b/.test(s) ? 'EBITDA margin' : /\b(?:operating|ebit)\b/.test(s) ? 'Operating margin' : 'Net margin';
  const main = lines.find((l) => l.label === want) ?? lines[0];
  if (!main) return need(q, 'margin', 'I need the figures for that margin, e.g. "gross margin revenue 500000 COGS 300000"');
  const v = want === 'Gross margin' && gp !== undefined ? gp / rev : want === 'Operating margin' && ebit !== undefined ? ebit / rev : want === 'EBITDA margin' && ebit !== undefined ? (ebit + da) / rev : ni !== undefined ? ni / rev : NaN;
  if (main.label !== want) notes.push(`Not enough figures for the ${want.toLowerCase()}; showing the ${main.label.toLowerCase()}`);
  return answer(q, {
    kind: 'margin',
    expression: `${main.label} · revenue ${m$(q, rev)}`,
    display: main.display.replace(/ \(.*\)$/, ''),
    value: Number.isFinite(v) && main.label === want ? v * 100 : undefined,
    lines: lines.filter((l) => l !== main),
    notes: [...notes, 'Gross = (revenue − COGS) ÷ revenue; operating = EBIT ÷ revenue; net = net income ÷ revenue'],
  });
}

// ---------------------------------------------------------------- break-even with targets

export function breakEvenPlus(q: Q): AnswerResult | null {
  const s = q.s;
  if (!/break[\s-]*even|\btarget profit\b|\bunits (?:needed|required) (?:to|for)\b|\bmargin of safety\b/.test(s)) return null;
  const target = param(s, String.raw`target(?:ed)? (?:profit|income)|desired (?:profit|income)|profit (?:target|goal) of|to (?:make|earn) (?:a profit of)?|profit of`)?.v;
  const cmr = rateOf(param(s, String.raw`contribution margin(?: ratio)?|cm ratio|cmr`));
  const wantsRevenue = /\b(?:revenue|sales dollars|in dollars|dollar sales|sales revenue)\b/.test(s);
  const expected = param(s, String.raw`expected sales|budgeted sales|actual sales|current sales|forecast(?: sales)?|selling`)?.v;
  if (target === undefined && cmr === undefined && !wantsRevenue && expected === undefined) return null;
  const fixed = paramEither(s, String.raw`fixed costs?|fixed expenses|overheads?|fc`)?.v;
  const price = param(s, String.raw`(?:selling )?price(?: per unit)?|sells? (?:for|at)|sp|p`)?.v;
  const vc = param(s, String.raw`variable costs?(?: per unit)?|vc|unit cost|cost per unit|variable expenses`)?.v;
  if (fixed === undefined) return need(q, 'break-even', 'What are the fixed costs?');
  const notes: string[] = [];
  const t = target ?? 0;
  if (cmr !== undefined && (price === undefined || vc === undefined)) {
    const revNeeded = (fixed + t) / cmr;
    return answer(q, {
      kind: 'break-even',
      expression: `Break-even revenue · fixed ${m$(q, fixed)}, contribution margin ratio ${pct(cmr)}${t ? `, target profit ${m$(q, t)}` : ''}`,
      display: m$(q, revNeeded),
      value: revNeeded,
      notes: ['Revenue = (fixed costs + target profit) ÷ contribution margin ratio'],
    });
  }
  if (price === undefined || vc === undefined) return need(q, 'break-even', 'I need the price and the variable cost per unit (or the contribution margin ratio)');
  const cm = price - vc;
  if (cm <= 0) return bad(q, 'break-even', 'The price does not exceed the variable cost, so no volume breaks even');
  const units = (fixed + t) / cm;
  const lines: Lines = [
    { label: 'Revenue needed', display: m$(q, units * price) },
    { label: 'Contribution margin per unit', display: m$(q, cm) },
    { label: 'Contribution margin ratio', display: pct(cm / price) },
  ];
  if (t) lines.push({ label: 'Break-even (no profit)', display: `${num(fixed / cm, 2)} units` });
  if (expected !== undefined) {
    const be = fixed / cm;
    const salesUnits = expected;
    lines.push({ label: 'Margin of safety', display: `${num(salesUnits - be, 2)} units (${pct((salesUnits - be) / salesUnits)})` }, { label: 'Operating leverage', display: fix((salesUnits * cm) / (salesUnits * cm - fixed), 3) });
  }
  return answer(q, {
    kind: 'break-even',
    expression: `${t ? `Units for ${m$(q, t)} profit` : 'Break-even'} · fixed ${m$(q, fixed)}, price ${m$(q, price)}, variable ${m$(q, vc)}`,
    display: wantsRevenue && !t ? m$(q, units * price) : `${num(Math.ceil(units - 1e-9))} units`,
    value: wantsRevenue && !t ? units * price : units,
    lines: [{ label: 'Exact', display: `${num(units, 4)} units` }, ...lines],
    notes: [...notes, 'Units = (fixed costs + target profit) ÷ (price − variable cost); rounded up to whole units'],
  });
}

// ---------------------------------------------------------------- returns: ROAS, ROE, ROA

export function returnsRatios(q: Q): AnswerResult | null {
  const s = q.s;
  const w = /\b(roas|roe|roa|roic|return on (?:ad spend|equity|assets|invested capital)|dupont)\b/.exec(s)?.[1];
  if (!w) return null;
  const notes: string[] = [];
  if (/roas|ad spend/.test(w)) {
    const rev = param(s, String.raw`revenue|sales|return(?:ed)?|generated|made`)?.v;
    const spend = param(s, String.raw`ad spend|spend|spent|cost|budget|advertising(?: cost| spend)?`)?.v;
    if (rev === undefined || spend === undefined) return need(q, 'roas', 'ROAS needs the revenue and the ad spend');
    const r = rev / spend;
    const gm = rateOf(param(s, String.raw`gross margin|margin`));
    const lines: Lines = [{ label: 'As a percentage', display: pct(r, 0) }];
    if (gm !== undefined) lines.push({ label: 'Break-even ROAS at that margin', display: `${fix(1 / gm, 2)}×` }, { label: 'Profit after ad spend', display: m$(q, rev * gm - spend) });
    return answer(q, { kind: 'roas', expression: `ROAS · revenue ${m$(q, rev)}, ad spend ${m$(q, spend)}`, display: `${fix(r, 2)}×`, value: r, lines, notes: ['ROAS = revenue from ads ÷ ad spend'] });
  }
  const ni = param(s, String.raw`net income|net profit|earnings|profit|nopat`)?.v;
  const eq = param(s, String.raw`(?:shareholders'?|stockholders'?|average |total )?equity`)?.v;
  const assets = param(s, String.raw`(?:average |total )?assets`)?.v;
  const rev = param(s, String.raw`revenue|sales`)?.v;
  const ic = param(s, String.raw`invested capital`)?.v;
  if (ni === undefined) return need(q, 'returns', 'I need the net income (profit)');
  const lines: Lines = [];
  if (w === 'roic' || /invested capital/.test(w)) {
    if (ic === undefined) return need(q, 'returns', 'ROIC needs the invested capital');
    return answer(q, { kind: 'returns', expression: `ROIC · NOPAT ${m$(q, ni)}, invested capital ${m$(q, ic)}`, display: pct(ni / ic), value: (ni / ic) * 100, notes: ['ROIC = NOPAT ÷ invested capital'] });
  }
  const isRoe = /roe|equity|dupont/.test(w);
  if (isRoe && eq === undefined) return need(q, 'returns', 'ROE needs the shareholders\' equity');
  if (!isRoe && assets === undefined) return need(q, 'returns', 'ROA needs the total assets');
  if (rev !== undefined && assets !== undefined && eq !== undefined) {
    lines.push(
      { label: 'Net margin (NI ÷ sales)', display: pct(ni / rev) },
      { label: 'Asset turnover (sales ÷ assets)', display: fix(rev / assets, 4) },
      { label: 'Equity multiplier (assets ÷ equity)', display: fix(assets / eq, 4) },
    );
    notes.push('DuPont: ROE = net margin × asset turnover × equity multiplier');
  }
  if (isRoe && assets !== undefined) lines.push({ label: 'ROA', display: pct(ni / assets) });
  if (!isRoe && eq !== undefined) lines.push({ label: 'ROE', display: pct(ni / eq) });
  const v = isRoe ? ni / eq! : ni / assets!;
  return answer(q, {
    kind: 'returns',
    expression: `${isRoe ? 'Return on equity' : 'Return on assets'} · net income ${m$(q, ni)}, ${isRoe ? `equity ${m$(q, eq!)}` : `assets ${m$(q, assets!)}`}`,
    display: pct(v),
    value: v * 100,
    lines,
    notes: [...notes, isRoe ? 'ROE = net income ÷ shareholders\' equity' : 'ROA = net income ÷ total assets'],
  });
}

// ---------------------------------------------------------------- SaaS / customers

export function saas(q: Q): AnswerResult | null {
  const s = q.s;
  const isLtv = /\bltv\b|\bclv\b|\bcltv\b|lifetime value/.test(s);
  const isCac = /\bcac\b|customer acquisition cost/.test(s);
  const isChurn = /\bchurn\b|\bretention\b|\bcohort\b|\bcustomer lifetime\b/.test(s);
  const isMrr = /\bmrr\b|\barr\b|\bnet (?:revenue|dollar) retention\b|\bnrr\b|\bndr\b|\bgross (?:revenue )?retention\b|\bgrr\b/.test(s);
  if (!isLtv && !isCac && !isChurn && !isMrr) return null;
  const notes: string[] = [];
  const annual = /\b(?:annual|yearly|per year|a year)\b/.test(s) && !/\bmonthly\b/.test(s);
  const per = annual ? 'year' : 'month';
  // NRR/GRR from MRR components.
  if (/\bnet (?:revenue|dollar) retention\b|\bnrr\b|\bndr\b|\bgross (?:revenue )?retention\b|\bgrr\b|\bexpansion\b/.test(s)) {
    const start = param(s, String.raw`starting mrr|start(?:ing)?(?: arr| mrr| revenue)?|beginning (?:mrr|arr)|opening (?:mrr|arr)|mrr|arr`)?.v;
    const exp = param(s, String.raw`expansion(?: mrr)?|upsell|upgrades?`)?.v ?? 0;
    const churned = param(s, String.raw`churn(?:ed)?(?: mrr)?|lost|cancell?ations?`)?.v ?? 0;
    const contr = param(s, String.raw`contraction(?: mrr)?|downgrades?`)?.v ?? 0;
    const newM = param(s, String.raw`new(?: mrr| business| customers? mrr)?`)?.v ?? 0;
    if (start === undefined) return need(q, 'saas', 'I need the starting MRR (or ARR)');
    const nrr = (start + exp - churned - contr) / start;
    const grr = (start - churned - contr) / start;
    return answer(q, {
      kind: 'saas',
      expression: `Revenue retention · starting ${m$(q, start, 0)}, expansion ${m$(q, exp, 0)}, contraction ${m$(q, contr, 0)}, churn ${m$(q, churned, 0)}`,
      display: pct(nrr, 1),
      value: nrr * 100,
      unit: 'net revenue retention',
      lines: [
        { label: 'Gross revenue retention', display: pct(grr, 1) },
        { label: 'Ending MRR', display: m$(q, start + newM + exp - churned - contr) },
        { label: 'Net new MRR', display: m$(q, newM + exp - churned - contr) },
      ],
      notes: ['NRR = (start + expansion − contraction − churn) ÷ start; GRR excludes expansion'],
    });
  }
  if (isMrr && !isLtv && !isCac) {
    const ft = /(?:from|grew from|went from)\s*\$?(\d[\d,]*(?:\.\d+)?)\s*(k|m)?\s*(?:to)\s*\$?(\d[\d,]*(?:\.\d+)?)\s*(k|m)?/.exec(s);
    const T = years(s, 'over|in|across|during');
    if (ft) {
      const a = toNum(ft[1]!) * (ft[2] === 'k' ? 1e3 : ft[2] === 'm' ? 1e6 : 1);
      const b = toNum(ft[3]!) * (ft[4] === 'k' ? 1e3 : ft[4] === 'm' ? 1e6 : 1);
      const months = T ? Math.round(T.t * 12) : undefined;
      if (!months) return need(q, 'saas', 'Over how many months? e.g. "over 6 months"');
      const g = (b / a) ** (1 / months) - 1;
      const isArr = /\barr\b/.test(s) && !/\bmrr\b/.test(s);
      return answer(q, {
        kind: 'saas',
        expression: `${isArr ? 'ARR' : 'MRR'} growth ${m$(q, a, 0)} → ${m$(q, b, 0)} over ${months} months`,
        display: `${pct(g)} per month`,
        value: g * 100,
        lines: [
          { label: 'Total growth', display: pct(b / a - 1) },
          { label: 'Annualized growth', display: pct((1 + g) ** 12 - 1) },
          { label: isArr ? 'Ending MRR' : 'Ending ARR (MRR × 12)', display: m$(q, isArr ? b / 12 : b * 12, 0) },
        ],
        notes: ['Compound monthly growth rate CMGR = (end ÷ start)^(1/months) − 1'],
      });
    }
    const mrr = param(s, 'mrr')?.v;
    const arr = param(s, 'arr')?.v;
    if (mrr !== undefined) return answer(q, { kind: 'saas', expression: `ARR from MRR ${m$(q, mrr, 0)}`, display: m$(q, mrr * 12, 0), value: mrr * 12, notes: ['ARR = MRR × 12'] });
    if (arr !== undefined) return answer(q, { kind: 'saas', expression: `MRR from ARR ${m$(q, arr, 0)}`, display: m$(q, arr / 12), value: arr / 12, notes: ['MRR = ARR ÷ 12'] });
    return null;
  }
  // Cohort table from counts.
  const cohort = /\bcohort\b/.test(s) ? listAfter(s, /\bcohort(?: retention)?(?: sizes?| counts?| of)?\b|:/) : undefined;
  if (cohort && cohort.length >= 2) {
    const c = cohort.map((t) => t.v);
    const rows = c.map((v, i) => [String(i), num(v), pct(v / c[0]!, 1), i ? pct(v / c[i - 1]!, 1) : '—']);
    const avgRet = (c[c.length - 1]! / c[0]!) ** (1 / (c.length - 1));
    return answer(q, {
      kind: 'saas',
      expression: `Cohort retention over ${c.length - 1} periods`,
      display: pct(c[c.length - 1]! / c[0]!, 1),
      value: (c[c.length - 1]! / c[0]!) * 100,
      unit: `retained after ${c.length - 1} periods`,
      lines: [{ label: 'Average period retention', display: pct(avgRet, 2) }, { label: 'Average period churn', display: pct(1 - avgRet, 2) }],
      table: { caption: 'Cohort retention', columns: ['Period', 'Active', 'Retained (of start)', 'Period retention'], rows },
      notes: ['Average period retention = (last ÷ first)^(1/periods)'],
    });
  }
  const churnP = rateOf(paramEither(s, String.raw`(?:monthly |annual |yearly )?churn(?: rate)?|attrition(?: rate)?`), notes, 'churn');
  const arpu = param(s, String.raw`arpu|arpa|average revenue per (?:user|account|customer)|revenue per (?:user|customer|account)|price|subscription|mrr per customer|pays`)?.v;
  const gm = rateOf(param(s, String.raw`gross margin|margin`), notes, 'margin');
  const spend = param(s, String.raw`marketing (?:spend|costs?|budget)|sales and marketing|s&m|acquisition spend|spend|spent`)?.v;
  const newCust = paramEither(s, String.raw`new customers|customers acquired|customers|acquired|signups`)?.v;
  const cacGiven = param(s, String.raw`cac|customer acquisition cost`)?.v;
  const cac = cacGiven ?? (spend !== undefined && newCust ? spend / newCust : undefined);
  if (isCac && !isLtv && cacGiven === undefined) {
    if (cac === undefined) return need(q, 'saas', 'CAC needs the sales & marketing spend and the number of new customers');
    const lines: Lines = [];
    if (arpu !== undefined) lines.push({ label: 'Payback (months)', display: fix(cac / (arpu * (gm ?? 1)), 1) });
    if (gm === undefined && arpu !== undefined) notes.push('Payback ignores gross margin (add "gross margin 80%")');
    return answer(q, { kind: 'saas', expression: `CAC · spend ${m$(q, spend!)}, ${num(newCust!)} new customers`, display: m$(q, cac), value: cac, lines, notes: [...notes, 'CAC = sales & marketing spend ÷ new customers'] });
  }
  if (isLtv) {
    if (arpu === undefined) return need(q, 'saas', `LTV needs the revenue per customer per ${per} (ARPU)`);
    if (churnP === undefined) return need(q, 'saas', `LTV needs the ${per === 'month' ? 'monthly' : 'annual'} churn rate`);
    if (gm === undefined) notes.push('No gross margin given: revenue LTV (add "gross margin 80%" for profit LTV)');
    const ltv = (arpu * (gm ?? 1)) / churnP;
    const lines: Lines = [{ label: `Average lifetime`, display: `${fix(1 / churnP, 1)} ${per}s` }];
    if (cac !== undefined) {
      lines.push({ label: 'LTV : CAC', display: `${fix(ltv / cac, 2)} : 1` }, { label: `CAC payback (${per}s)`, display: fix(cac / (arpu * (gm ?? 1)), 1) });
      if (ltv / cac < 3) notes.push('Below the common 3:1 benchmark');
    }
    return answer(q, {
      kind: 'saas',
      expression: `Customer lifetime value · ARPU ${m$(q, arpu)}/${per}${gm !== undefined ? `, gross margin ${pct(gm)}` : ''}, churn ${pct(churnP)}/${per}`,
      display: m$(q, ltv),
      value: ltv,
      lines,
      notes: [...notes, 'LTV = ARPU × gross margin ÷ churn rate (constant churn, no discounting)'],
    });
  }
  if (isCac && cacGiven !== undefined) {
    if (arpu === undefined) return need(q, 'saas', 'CAC payback needs the revenue per customer per month');
    const months = cacGiven / (arpu * (gm ?? 1));
    return answer(q, { kind: 'saas', expression: `CAC payback · CAC ${m$(q, cacGiven)}, ARPU ${m$(q, arpu)}${gm !== undefined ? `, margin ${pct(gm)}` : ''}`, display: `${fix(months, 1)} ${per}s`, value: months, notes: ['Payback = CAC ÷ (ARPU × gross margin)'] });
  }
  // Churn from counts, or retention after n periods.
  const startC = param(s, String.raw`start(?:ed)?(?: with)?|beginning(?: of (?:the )?(?:month|period|year))?|starting customers|customers at (?:the )?start`)?.v;
  const lost = paramEither(s, String.raw`lost|churned|cancell?ed|left|cancellations`)?.v;
  if (startC !== undefined && lost !== undefined) {
    const c = lost / startC;
    return answer(q, {
      kind: 'saas',
      expression: `Churn · lost ${num(lost)} of ${num(startC)} customers`,
      display: pct(c),
      value: c * 100,
      lines: [{ label: 'Retention', display: pct(1 - c) }, { label: 'Annualized (if monthly)', display: pct(1 - (1 - c) ** 12) }, { label: 'Average lifetime', display: `${fix(1 / c, 1)} periods` }],
      notes: ['Churn = customers lost ÷ customers at the start'],
    });
  }
  if (churnP !== undefined) {
    const T = years(s, String.raw`after|over|for|in`);
    const months = T ? Math.round(T.t * (per === 'month' ? 12 : 1) * 1e6) / 1e6 : 12;
    if (!T) notes.push(`After 12 ${per}s (say "after N months")`);
    const ret = (1 - churnP) ** months;
    return answer(q, {
      kind: 'saas',
      expression: `Retention after ${num(months)} ${per}s at ${pct(churnP)} churn per ${per}`,
      display: pct(ret),
      value: ret * 100,
      lines: [
        { label: 'Lost', display: pct(1 - ret) },
        { label: 'Average lifetime', display: `${fix(1 / churnP, 1)} ${per}s` },
        ...(per === 'month' ? [{ label: 'Annual churn', display: pct(1 - (1 - churnP) ** 12) }] : []),
      ],
      notes: [...notes, 'Retention = (1 − churn)^periods'],
    });
  }
  return null;
}

// ---------------------------------------------------------------- pricing with elasticity

export function pricing(q: Q): AnswerResult | null {
  const s = q.s;
  if (!/\belasticity\b/.test(s) || !/\b(?:optimal price|profit[\s-]*maximi[sz]ing price|markup|lerner|price (?:change|increase|cut|rise)|raise (?:the )?price|cut (?:the )?price|revenue (?:change|effect|impact))\b/.test(s)) return null;
  const eP = param(s, String.raw`elasticity(?: of demand)?(?: of)?|e|ε`);
  if (!eP) return need(q, 'pricing', 'What is the price elasticity of demand? e.g. "elasticity -2"');
  let e = eP.v;
  if (e > 0) e = -e;
  const notes: string[] = [];
  if (eP.v > 0) notes.push(`Read elasticity ${num(eP.v)} as ${num(e)} (demand slopes down)`);
  const change = /\b(?:price (?:change|increase|cut|rise)|raise (?:the )?price|cut (?:the )?price|revenue)\b/.test(s) ? /(-?\d+(?:\.\d+)?)%/.exec(s.replace(/elasticity[^%]*?(?=\d+(?:\.\d+)?%|$)/, '')) : null;
  if (change && !/\boptimal\b|\bmarkup\b|\blerner\b/.test(s)) {
    let dp = Number(change[1]) / 100;
    if (/\bcut\b|\blower\b|\breduc/.test(s) && dp > 0) dp = -dp;
    const dq = e * dp;
    const dr = (1 + dp) * (1 + dq) - 1;
    return answer(q, {
      kind: 'pricing',
      expression: `Price change ${pct(dp, 1)} with elasticity ${num(e)}`,
      display: `Revenue ${dr >= 0 ? '+' : ''}${pct(dr)}`,
      value: dr * 100,
      lines: [{ label: 'Quantity change (≈ E × %ΔP)', display: pct(dq) }],
      notes: [...notes, 'Linear approximation: %ΔQ ≈ E × %ΔP; revenue factor (1 + %ΔP)(1 + %ΔQ)', Math.abs(e) > 1 ? 'Elastic demand: raising the price lowers revenue' : 'Inelastic demand: raising the price raises revenue'],
    });
  }
  if (e >= -1) return bad(q, 'pricing', `With |elasticity| ≤ 1 (here ${num(e)}) a profit-maximising price does not exist: raising the price always raises profit`);
  const mc = param(s, String.raw`marginal cost|mc|unit cost|cost(?: per unit)?|variable cost`)?.v;
  const lerner = -1 / e;
  const markupOnCost = e / (1 + e) - 1;
  const lines: Lines = [{ label: 'Lerner index (P − MC)/P', display: pct(lerner) }, { label: 'Markup on cost', display: pct(markupOnCost) }];
  if (mc === undefined)
    return answer(q, { kind: 'pricing', expression: `Optimal markup at elasticity ${num(e)}`, display: `P = ${fix(e / (1 + e), 4)} × MC`, value: e / (1 + e), lines, notes: [...notes, 'Inverse elasticity rule: P = MC × E ÷ (1 + E)'] });
  const P = (mc * e) / (1 + e);
  return answer(q, {
    kind: 'pricing',
    expression: `Profit-maximising price · MC ${m$(q, mc)}, elasticity ${num(e)}`,
    display: m$(q, P),
    value: P,
    lines,
    notes: [...notes, 'Inverse elasticity rule (constant elasticity): P = MC × E ÷ (1 + E)'],
  });
}

// ---------------------------------------------------------------- inventory

export function inventory(q: Q): AnswerResult | null {
  const s = q.s;
  const isEoq = /\beoq\b|economic order quantity|optimal order (?:size|quantity)/.test(s);
  const isRop = /\breorder point\b|\brop\b/.test(s);
  const isSS = /\bsafety stock\b|\bbuffer stock\b/.test(s);
  if (!isEoq && !isRop && !isSS) return null;
  const notes: string[] = [];
  if (isEoq) {
    const D = param(s, String.raw`(?:annual |yearly )?demand|d|units (?:per|a) year|annual usage|usage`)?.v;
    const S = param(s, String.raw`order(?:ing)? cost(?: per order)?|setup cost|cost per order|s|ordering`)?.v;
    const hP = param(s, String.raw`holding(?: cost)?(?: per unit)?(?: per year)?|carrying(?: cost)?(?: per unit)?|storage cost|h`);
    const unitCost = param(s, String.raw`unit (?:cost|price)|cost per unit|price per unit|item cost|purchase price|of (?:the )?(?:unit )?cost|of (?:the )?(?:item|unit) (?:cost|price)`)?.v;
    if (D === undefined || S === undefined || !hP) return need(q, 'eoq', 'EOQ needs annual demand, cost per order and holding cost per unit per year, e.g. "EOQ demand 12000 order cost 50 holding 2"');
    let H = hP.v;
    if (hP.pct) {
      if (unitCost === undefined) return need(q, 'eoq', 'The holding cost is a percentage: of what unit cost?');
      H = (hP.v / 100) * unitCost;
      notes.push(`Holding cost ${num(hP.v)}% × ${m$(q, unitCost)} = ${m$(q, H)} per unit per year`);
    }
    if (!(D > 0 && S > 0 && H > 0)) return bad(q, 'eoq', 'Demand, order cost and holding cost must be positive');
    const Q0 = Math.sqrt((2 * D * S) / H);
    const days = param(s, String.raw`working days|days (?:per|a) year|operating days`)?.v ?? 365;
    const lines: Lines = [
      { label: 'Orders per year', display: fix(D / Q0, 2) },
      { label: 'Time between orders', display: `${fix((Q0 / D) * days, 1)} days` },
      { label: 'Annual ordering cost', display: m$(q, (D / Q0) * S) },
      { label: 'Annual holding cost', display: m$(q, (Q0 / 2) * H) },
      { label: 'Total relevant cost', display: m$(q, Math.sqrt(2 * D * S * H)) },
    ];
    const L = param(s, String.raw`lead time(?: of)?`)?.v;
    if (L !== undefined) lines.push({ label: `Reorder point (lead time ${num(L)} days, no safety stock)`, display: num((D / days) * L, 2) });
    return answer(q, {
      kind: 'eoq',
      expression: `EOQ · demand ${num(D)}/year, order cost ${m$(q, S)}, holding ${m$(q, H)}/unit/year`,
      display: `${num(Q0, 2)} units`,
      value: Q0,
      lines,
      notes: [...notes, 'EOQ = √(2DS ÷ H); at the optimum ordering cost = holding cost'],
    });
  }
  const svc = param(s, String.raw`service level|cycle service level|fill rate|confidence`);
  const z = param(s, String.raw`z(?:[\s-]*score)?`)?.v ?? (svc ? Ninv(svc.pct || svc.v > 1 ? svc.v / 100 : svc.v) : undefined);
  const sd = param(s, String.raw`(?:standard deviation|sd|std(?: dev)?|sigma|σ)(?: of)?(?: (?:daily |weekly )?demand)?|demand (?:sd|standard deviation)|variability`)?.v;
  const ltM = /\blead[\s-]*time(?: of| is|:|=)?\s*(\d+(?:\.\d+)?)\s*(days?|weeks?|months?)?/.exec(s);
  let L = ltM ? Number(ltM[1]) : undefined;
  if (L !== undefined && ltM![2]) {
    const lu = ltM![2]![0]!;
    const du: string = /\b(?:daily|per day|a day)\b/.test(s) ? 'd' : /\b(?:weekly|per week|a week)\b/.test(s) ? 'w' : /\b(?:monthly|per month|a month)\b/.test(s) ? 'm' : lu;
    const days = { d: 1, w: 7, m: 30 } as Record<string, number>;
    if (du !== lu) {
      L = (L * days[lu]!) / days[du]!;
      notes.push(`Lead time converted to ${du === 'd' ? 'days' : du === 'w' ? 'weeks' : 'months'} to match the demand`);
    }
  }
  const d = param(s, String.raw`(?:average |avg )?(?:daily |weekly )?(?:demand|usage|sales)(?: of)?(?: per day| a day)?|d`)?.v;
  const ssGiven = param(s, String.raw`safety stock(?: of)?|buffer(?: stock)?(?: of)?|ss`)?.v;
  let ss = ssGiven;
  const lines: Lines = [];
  if (ss === undefined && (isSS || svc || z !== undefined)) {
    if (z === undefined || sd === undefined || L === undefined) return need(q, 'inventory', 'Safety stock needs the service level (or z), the standard deviation of demand per period and the lead time, e.g. "safety stock 95% service sd 20 lead time 9 days"');
    ss = z * sd * Math.sqrt(L);
    lines.push({ label: 'z', display: fix(z, 4) }, { label: 'σ over lead time (σ√L)', display: fix(sd * Math.sqrt(L), 4) });
    notes.push('Safety stock = z × σ_d × √L (demand variability only)');
  }
  if (isRop) {
    if (d === undefined || L === undefined) return need(q, 'inventory', 'The reorder point needs the demand per period and the lead time, e.g. "reorder point daily demand 50 lead time 7 days"');
    const rop = d * L + (ss ?? 0);
    if (ss === undefined) notes.push('No safety stock');
    return answer(q, {
      kind: 'inventory',
      expression: `Reorder point · demand ${num(d)} per period, lead time ${num(L)} periods${ss ? `, safety stock ${num(ss, 2)}` : ''}`,
      display: `${num(rop, 2)} units`,
      value: rop,
      lines: [{ label: 'Lead-time demand', display: num(d * L, 2) }, ...(ss ? [{ label: 'Safety stock', display: num(ss, 2) }] : []), ...lines],
      notes: [...notes, 'ROP = demand × lead time + safety stock'],
    });
  }
  if (ss === undefined) return need(q, 'inventory', 'Safety stock needs the service level, demand standard deviation and lead time');
  return answer(q, {
    kind: 'inventory',
    expression: `Safety stock · service level ${svc ? pct(svc.pct || svc.v > 1 ? svc.v / 100 : svc.v, 1) : `z = ${num(z!)}`}, σ ${num(sd!)}, lead time ${num(L!)}`,
    display: `${num(ss, 2)} units`,
    value: ss,
    lines: [...lines, ...(d !== undefined ? [{ label: 'Reorder point', display: num(d * L! + ss, 2) }] : [])],
    notes,
  });
}

// ---------------------------------------------------------------- depreciation

export function depreciation(q: Q): AnswerResult | null {
  const s = q.s;
  if (!/\bdepreciat\w*\b|\bbook value\b|\bmacrs\b/.test(s)) return null;
  if (!/\bcost|\bsalvage|\bresidual|useful life|straight[\s-]*line|declining|sum[\s-]*of[\s-]*(?:the[\s-]*)?years|\bsyd\b|\bddb\b|units[\s-]*of[\s-]*production|\bbought\b|\bpurchased?\b|\basset\b/.test(s)) return null;
  const notes: string[] = [];
  const cost = param(s, String.raw`cost(?: of)?|costs|asset (?:cost|price)|purchase(?:d)?(?: price)?(?: for| at)?|price|basis|bought (?:for|at)|machine (?:costing|cost)|costing`)?.v;
  const salvage = param(s, String.raw`salvage(?: value)?|residual(?: value)?|scrap(?: value)?|resale(?: value)?|terminal value`)?.v ?? 0;
  const life = param(s, String.raw`useful life(?: of)?|life(?: of)?|over|lasting`)?.v ?? years(s, 'life|useful life|over')?.t;
  if (cost === undefined) return need(q, 'depreciation', 'What did the asset cost?');
  if (!param(s, String.raw`salvage(?: value)?|residual(?: value)?|scrap(?: value)?|resale(?: value)?`)) notes.push('Salvage value 0');
  const uop = /units[\s-]*of[\s-]*production|units of output|per unit|machine hours|activity/.test(s);
  if (uop) {
    const total = param(s, String.raw`total (?:units|output|hours|production|miles)|lifetime (?:units|output|hours)|expected (?:units|output|hours|production)|capacity`)?.v;
    const used = param(s, String.raw`(?:units |hours )?(?:produced|used|this year|in year \d+|output this year)|this year`)?.v;
    if (total === undefined) return need(q, 'depreciation', 'Units-of-production needs the total expected units (and the units this year)');
    const rate = (cost - salvage) / total;
    const lines: Lines = [{ label: 'Rate per unit', display: m$(q, rate, 4) }];
    if (used === undefined) return answer(q, { kind: 'depreciation', expression: `Units-of-production rate · cost ${m$(q, cost)}, salvage ${m$(q, salvage)}, ${num(total)} units`, display: `${m$(q, rate, 4)} per unit`, value: rate, notes: [...notes, 'Rate = (cost − salvage) ÷ total units'] });
    return answer(q, { kind: 'depreciation', expression: `Units-of-production · cost ${m$(q, cost)}, salvage ${m$(q, salvage)}, ${num(used)} of ${num(total)} units`, display: m$(q, rate * used), value: rate * used, lines, notes: [...notes, 'Depreciation = (cost − salvage) ÷ total units × units used'] });
  }
  if (life === undefined) return need(q, 'depreciation', 'What is the useful life? e.g. "over 5 years"');
  if (!(life > 0) || !Number.isInteger(life) || life > 100) return bad(q, 'depreciation', 'The life must be a whole number of years (1–100)');
  if (salvage >= cost) return bad(q, 'depreciation', 'The salvage value must be below the cost');
  const method = /sum[\s-]*of[\s-]*(?:the[\s-]*)?years|\bsyd\b|\bsoyd\b/.test(s) ? 'syd' : /double[\s-]*declining|\bddb\b|200%/.test(s) ? 'ddb' : /150%|declining[\s-]*balance|reducing[\s-]*balance|\bdb\b/.test(s) ? 'db' : 'sl';
  const factor = method === 'ddb' ? 2 : /150%/.test(s) ? 1.5 : 2;
  const fixedRate = method === 'db' && !/150%/.test(s) ? rateOf(param(s, String.raw`rate(?: of)?|at`)) : undefined;
  const rows: string[][] = [];
  const dep: number[] = [];
  let book = cost;
  const syd = (life * (life + 1)) / 2;
  for (let y = 1; y <= life; y++) {
    let d: number;
    if (method === 'sl') d = (cost - salvage) / life;
    else if (method === 'syd') d = ((cost - salvage) * (life - y + 1)) / syd;
    else {
      const r = fixedRate ?? factor / life;
      d = book * r;
      if (book - d < salvage) d = book - salvage;
      if (y === life && !fixedRate) d = book - salvage;
    }
    book -= d;
    dep.push(d);
    rows.push([String(y), m$(q, d), m$(q, cost - book), m$(q, book)]);
  }
  const yearM = /\byear (\d+)\b|\b(\d+)(?:st|nd|rd|th) year\b/.exec(s);
  const yr = yearM ? Number(yearM[1] ?? yearM[2]) : 1;
  if (yr < 1 || yr > life) return bad(q, 'depreciation', `Year ${yr} is outside the ${life}-year life`);
  const name = { sl: 'Straight-line', syd: 'Sum-of-years-digits', ddb: 'Double-declining balance', db: fixedRate ? `Declining balance at ${pct(fixedRate)}` : `${factor * 100}% declining balance` }[method];
  const formula = { sl: 'Annual = (cost − salvage) ÷ life', syd: `Year t = (cost − salvage) × (life − t + 1) ÷ ${syd}`, ddb: `Year t = book value × 2/life (${pct(2 / life)}), never below salvage; last year brings book value to salvage`, db: `Year t = book value × rate, never below salvage` }[method];
  const wantBook = /\bbook value\b/.test(s) && yearM;
  const bookAfter = cost - dep.slice(0, yr).reduce((a, b) => a + b, 0);
  return answer(q, {
    kind: 'depreciation',
    expression: `${name} depreciation · cost ${m$(q, cost)}, salvage ${m$(q, salvage)}, ${life} years${method === 'sl' && !yearM ? '' : ` — ${wantBook ? 'book value after' : ''} year ${yr}`}`,
    display: wantBook ? m$(q, bookAfter) : m$(q, dep[yr - 1]!),
    value: wantBook ? bookAfter : dep[yr - 1]!,
    unit: wantBook ? 'book value' : method === 'sl' ? 'per year' : `year ${yr}`,
    lines: [{ label: `Book value after year ${yr}`, display: m$(q, bookAfter) }, ...(method === 'sl' ? [{ label: 'Rate', display: pct(1 / life) }] : [])],
    table: { caption: 'Depreciation schedule', columns: ['Year', 'Depreciation', 'Accumulated', 'Book value'], rows, highlightRow: yr - 1 },
    notes: [...notes, formula],
  });
}

// ---------------------------------------------------------------- payroll

export function payroll(q: Q): AnswerResult | null {
  const s = q.s;
  if (!/\bgross pay\b|\bnet pay\b|\btake[\s-]*home\b|\bpaycheck\b|\bpayroll\b|\bovertime\b|\bgross[\s-]*to[\s-]*net\b/.test(s)) return null;
  const notes: string[] = [];
  const rate = param(s, String.raw`hourly (?:rate|wage)|rate|wage|per hour at|at`)?.v ?? (/\$?(\d+(?:\.\d+)?)\s*(?:\/|per|an|a)\s*(?:hour|hr)\b/.exec(s) ? Number(/\$?(\d+(?:\.\d+)?)\s*(?:\/|per|an|a)\s*(?:hour|hr)\b/.exec(s)![1]) : undefined);
  const hoursM = /(\d+(?:\.\d+)?)\s*(?:regular )?hours?\b(?! (?:of )?overtime)/.exec(s);
  const otM = /(\d+(?:\.\d+)?)\s*(?:hours? (?:of )?)?overtime(?: hours?)?|overtime(?: hours?)?(?: of)?\s*(\d+(?:\.\d+)?)/.exec(s);
  const salary = param(s, String.raw`salary|gross(?: pay)?(?: of)?|earns?|annual pay|pay of`)?.v;
  let gross: number;
  const lines: Lines = [];
  if (rate !== undefined && hoursM) {
    let h = Number(hoursM[1]);
    let ot = otM ? Number(otM[1] ?? otM[2]) : 0;
    const threshold = param(s, String.raw`overtime (?:after|above|over|threshold)`)?.v ?? 40;
    if (!otM && h > threshold && /\bovertime\b|\bweek\b/.test(s)) {
      ot = h - threshold;
      h = threshold;
      notes.push(`Hours above ${num(threshold)} paid as overtime`);
    }
    const mult = param(s, String.raw`overtime (?:rate|multiplier)|time and a|at`)?.v && /double time/.test(s) ? 2 : /double time/.test(s) ? 2 : 1.5;
    gross = h * rate + ot * rate * mult;
    lines.push({ label: 'Regular pay', display: `${num(h)} h × ${m$(q, rate)} = ${m$(q, h * rate)}` });
    if (!ot && h > 40) notes.push('Hours over 40 in a week are often paid at 1.5× (say "overtime" to apply it)');
    if (ot) lines.push({ label: 'Overtime pay', display: `${num(ot)} h × ${m$(q, rate * mult)} = ${m$(q, ot * rate * mult)}` });
  } else if (salary !== undefined) {
    const periods = /\bbi-?weekly\b|every two weeks/.test(s) ? 26 : /\bweekly\b/.test(s) ? 52 : /\bsemi-?monthly\b|twice a month/.test(s) ? 24 : /\bmonthly\b/.test(s) ? 12 : 1;
    gross = salary / periods;
    if (periods > 1) lines.push({ label: 'Annual salary', display: m$(q, salary) });
  } else return need(q, 'payroll', 'I need the hours and hourly rate, or the salary, e.g. "gross pay 45 hours at $20 an hour"');
  // Deductions as stated: percentages of gross or flat amounts. No jurisdiction tax tables.
  const ded: { name: string; amt: number }[] = [];
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) {
    const words = s.slice(0, m.index).replace(/\s*(?:of|at|=|:)\s*$/, '').trim().split(/\s+/);
    let name = words.pop() ?? '';
    if (/^(?:federal|state|income|social|payroll|local|city|medicare|pension|retirement)$/.test(words.at(-1) ?? '')) name = `${words.pop()} ${name}`;
    if (!/[a-z]/.test(name) || /hour|overtime|time/.test(name)) continue;
    ded.push({ name, amt: (Number(m[1]) / 100) * gross });
  }
  for (const m of s.matchAll(new RegExp(String.raw`(health(?: insurance)?|insurance|union dues|dues|benefits|garnishment|parking|deduction)\s*(?:of|=|:)?\s*\$?(${NUM})(?!\s*%)`, 'g'))) ded.push({ name: m[1]!, amt: toNum(m[2]!) });
  const total = sum(ded.map((d) => d.amt));
  const net = gross - total;
  if (!ded.length) notes.push('No deductions given: add them as stated, e.g. "tax 20%, 401k 5%, health 100" (no jurisdiction tax tables are applied)');
  else notes.push('Deductions as stated (percentages of gross); no jurisdiction tax tables are applied');
  const wantNet = /\bnet\b|\btake[\s-]*home\b|\bpaycheck\b/.test(s) && ded.length > 0;
  return answer(q, {
    kind: 'payroll',
    expression: `${wantNet ? 'Net' : 'Gross'} pay${ded.length ? ` with ${ded.length} deduction${ded.length === 1 ? '' : 's'}` : ''}`,
    display: m$(q, wantNet ? net : gross),
    value: wantNet ? net : gross,
    lines: [...lines, ...(wantNet ? [{ label: 'Gross pay', display: m$(q, gross) }] : ded.length ? [{ label: 'Net pay', display: m$(q, net) }] : []), ...ded.map((d) => ({ label: d.name, display: `−${m$(q, d.amt)}` }))],
    notes,
  });
}

// ---------------------------------------------------------------- financial ratios

export function finRatios(q: Q): AnswerResult | null {
  const s = q.s;
  const asks = {
    current: /\bcurrent ratio\b/.test(s),
    quick: /\bquick ratio\b|\bacid[\s-]*test\b/.test(s),
    de: /\bdebt[\s-]*(?:to[\s-]*)?equity\b|\bd\/e\b|\bgearing\b|\bleverage ratio\b/.test(s),
    cov: /\binterest coverage\b|\btimes interest earned\b|\btie\b/.test(s),
    dso: /\bdso\b|\bdays sales outstanding\b|\bdebtor days\b|\breceivables? days\b|\bcollection period\b/.test(s),
    turn: /\binventory turnover\b|\binventory turns\b|\bstock turn\w*\b|\bdio\b|\bdays inventory\b/.test(s),
    dpo: /\bdpo\b|\bdays payables?\b|\bcreditor days\b/.test(s),
    at: /\basset turnover\b/.test(s),
    all: /\bfinancial ratios\b|\bliquidity ratios\b/.test(s),
  };
  if (!Object.values(asks).some(Boolean)) return null;
  if (!/assets|liabilit|equity|debt|ebit|interest|receivable|revenue|sales|cogs|inventor|payable|cash/.test(s)) return null;
  const v = (names: string) => param(s, names)?.v;
  const ca = v(String.raw`current assets|ca`);
  const cl = v(String.raw`current liabilities|cl`);
  const inv = v(String.raw`(?:average )?inventor(?:y|ies)|stock`);
  const cash = v(String.raw`cash(?: and equivalents)?`);
  const ar = v(String.raw`(?:accounts |average )?receivables?|ar|debtors`);
  const ms = v(String.raw`marketable securities|short[\s-]*term investments`);
  const debt = v(String.raw`total debt|debt|total liabilities|liabilities`);
  const eq = v(String.raw`(?:shareholders'?|stockholders'?|total )?equity`);
  const ebit = v(String.raw`ebit|operating income|operating profit|earnings before interest(?: and taxes)?`);
  const intr = v(String.raw`interest(?: expense)?`);
  const rev = v(String.raw`(?:annual |credit )?(?:revenue|sales)`);
  const cogs = v(String.raw`cogs|cost of (?:goods )?sold|cost of sales`);
  const ap = v(String.raw`(?:accounts |average )?payables?|ap|creditors`);
  const assets = v(String.raw`total assets|assets`);
  const days = v(String.raw`days(?: in (?:the )?(?:year|period))?`) ?? 365;
  const out: { label: string; display: string; value: number; formula: string }[] = [];
  const lack: string[] = [];
  if (asks.current || asks.all) {
    if (ca !== undefined && cl !== undefined) out.push({ label: 'Current ratio', display: fix(ca / cl, 2), value: ca / cl, formula: 'current assets ÷ current liabilities' });
    else if (asks.current) lack.push('current assets and current liabilities');
  }
  if (asks.quick || asks.all) {
    const quickAssets = ca !== undefined && inv !== undefined ? ca - inv : cash !== undefined && ar !== undefined ? cash + ar + (ms ?? 0) : undefined;
    if (quickAssets !== undefined && cl !== undefined) out.push({ label: 'Quick ratio', display: fix(quickAssets / cl, 2), value: quickAssets / cl, formula: '(current assets − inventory) ÷ current liabilities' });
    else if (asks.quick) lack.push('current assets, inventory and current liabilities');
  }
  if (asks.de || asks.all) {
    if (debt !== undefined && eq !== undefined) out.push({ label: 'Debt-to-equity', display: fix(debt / eq, 2), value: debt / eq, formula: 'debt ÷ equity' });
    else if (asks.de) lack.push('debt and equity');
  }
  if (asks.cov || asks.all) {
    if (ebit !== undefined && intr !== undefined) out.push({ label: 'Interest coverage', display: `${fix(ebit / intr, 2)}×`, value: ebit / intr, formula: 'EBIT ÷ interest expense' });
    else if (asks.cov) lack.push('EBIT and interest expense');
  }
  if (asks.dso || asks.all) {
    if (ar !== undefined && rev !== undefined) out.push({ label: 'Days sales outstanding', display: `${fix((ar / rev) * days, 1)} days`, value: (ar / rev) * days, formula: `receivables ÷ revenue × ${days}` });
    else if (asks.dso) lack.push('receivables and revenue');
  }
  if (asks.turn || asks.all) {
    if (cogs !== undefined && inv !== undefined) {
      out.push({ label: 'Inventory turnover', display: `${fix(cogs / inv, 2)}×`, value: cogs / inv, formula: 'COGS ÷ average inventory' });
      out.push({ label: 'Days inventory outstanding', display: `${fix((inv / cogs) * days, 1)} days`, value: (inv / cogs) * days, formula: `inventory ÷ COGS × ${days}` });
      if (/\bdio\b|\bdays inventory\b/.test(s)) out.reverse();
    } else if (asks.turn) lack.push('COGS and (average) inventory');
  }
  if (asks.dpo) {
    if (ap !== undefined && cogs !== undefined) out.push({ label: 'Days payables outstanding', display: `${fix((ap / cogs) * days, 1)} days`, value: (ap / cogs) * days, formula: `payables ÷ COGS × ${days}` });
    else lack.push('payables and COGS');
  }
  if (asks.at) {
    if (rev !== undefined && assets !== undefined) out.push({ label: 'Asset turnover', display: `${fix(rev / assets, 2)}×`, value: rev / assets, formula: 'revenue ÷ total assets' });
    else lack.push('revenue and total assets');
  }
  if (!out.length) return need(q, 'ratios', `I need ${lack.join('; ') || 'the balance-sheet figures'}`);
  const main = out[0]!;
  return answer(q, {
    kind: 'ratios',
    expression: `${main.label}${out.length > 1 ? ` and ${out.length - 1} more` : ''}`,
    display: main.display,
    value: main.value,
    lines: out.slice(1).map((o) => ({ label: o.label, display: o.display })),
    notes: [...new Set(out.map((o) => `${o.label} = ${o.formula}`)), ...(lack.length ? [`Also asked for, but missing: ${lack.join('; ')}`] : [])],
  });
}

// ---------------------------------------------------------------- NPS and funnels

export function nps(q: Q): AnswerResult | null {
  const s = q.s;
  if (!/\bnps\b|\bnet promoter\b/.test(s)) return null;
  const pr = paramEither(s, 'promoters')?.v;
  const pa = paramEither(s, 'passives|neutrals')?.v ?? 0;
  const de = paramEither(s, 'detractors')?.v;
  let P: number;
  let D: number;
  let T: number;
  let how: string;
  if (pr !== undefined && de !== undefined) {
    T = pr + pa + de;
    P = pr;
    D = de;
    how = `${num(pr)} promoters, ${num(pa)} passives, ${num(de)} detractors`;
  } else {
    const scores = listAfter(s, /\b(?:scores?|responses?|ratings?|of|from)\b|:/)?.map((t) => t.v);
    if (!scores || scores.length < 2) return need(q, 'nps', 'Give promoter/passive/detractor counts or the 0–10 scores, e.g. "NPS promoters 60 passives 25 detractors 15"');
    if (scores.some((x) => x < 0 || x > 10 || !Number.isInteger(x))) return bad(q, 'nps', 'NPS scores are whole numbers from 0 to 10');
    T = scores.length;
    P = scores.filter((x) => x >= 9).length;
    D = scores.filter((x) => x <= 6).length;
    how = `${T} responses`;
  }
  if (!T) return bad(q, 'nps', 'No responses');
  const score = ((P - D) / T) * 100;
  return answer(q, {
    kind: 'nps',
    expression: `Net Promoter Score · ${how}`,
    display: fix(score, 1).replace(/\.0$/, ''),
    value: score,
    lines: [
      { label: 'Promoters (9–10)', display: pct(P / T, 1) },
      { label: 'Passives (7–8)', display: pct((T - P - D) / T, 1) },
      { label: 'Detractors (0–6)', display: pct(D / T, 1) },
    ],
    notes: ['NPS = % promoters − % detractors (range −100 to +100)'],
  });
}

export function funnel(q: Q): AnswerResult | null {
  const s = q.s;
  if (!/\bfunnel\b|\bconversion rates?\b.*\d.*\d.*\d/.test(s)) return null;
  const steps = [...s.matchAll(new RegExp(String.raw`(${NUM})\s*(k)?\s+([a-z][a-z-]*(?: [a-z][a-z-]*)?)`, 'g'))]
    .map((m) => ({ n: toNum(m[1]!) * (m[2] ? 1e3 : 1), name: m[3]!.replace(/\s+(?:and|then|to)$/, '') }))
    .filter((x) => !/^(?:percent|per|%)/.test(x.name));
  if (steps.length < 2) return need(q, 'funnel', 'Give each step with its count, e.g. "funnel 10000 visitors 2000 signups 500 trials 100 paid"');
  if (steps.some((x, i) => i && x.n > steps[i - 1]!.n)) return bad(q, 'funnel', 'Each funnel step should be no larger than the one before');
  const table: Table = {
    caption: 'Funnel',
    columns: ['Step', 'Count', 'From previous', 'From top', 'Drop-off'],
    rows: steps.map((x, i) => [x.name, num(x.n), i ? pct(x.n / steps[i - 1]!.n, 1) : '—', pct(x.n / steps[0]!.n, 2), i ? pct(1 - x.n / steps[i - 1]!.n, 1) : '—']),
  };
  const worst = steps.slice(1).reduce((w, x, i) => (x.n / steps[i]!.n < w.r ? { r: x.n / steps[i]!.n, i: i + 1 } : w), { r: Infinity, i: 1 });
  const overall = steps[steps.length - 1]!.n / steps[0]!.n;
  return answer(q, {
    kind: 'funnel',
    expression: `Conversion funnel · ${steps.map((x) => `${num(x.n)} ${x.name}`).join(' → ')}`,
    display: pct(overall, 2),
    value: overall * 100,
    unit: 'overall conversion',
    lines: [{ label: 'Biggest drop', display: `${steps[worst.i - 1]!.name} → ${steps[worst.i]!.name} (${pct(worst.r, 1)} convert)` }],
    table,
    notes: ['Step conversion = step ÷ previous step; overall = last ÷ first'],
  });
}
