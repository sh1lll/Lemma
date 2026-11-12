import { D, type Answer, type AnswerResult, type Dec } from '@lemma/math-core';
import { findUnit, type UnitDef } from '@lemma/unit-engine';
import { money, NUM_SRC, parseNumber, pct } from './extract';
import { need, ok, type Ctx } from './finance';

const m = (c: Ctx, v: Dec) => money(v, c.x.currency);
const REFERENT = /\b(?:that|it|this|the (?:bill|total|amount))\b/;
/** The previous answer stands in for the amount when the question refers to it ("split that 3 ways"). */
const fromAns = (c: Ctx) => (c.ans && REFERENT.test(c.s) ? { value: c.ans } : undefined);

function people(s: string): number | null {
  const r =
    /split (?:it |the bill |this )?(\d+) ways|(\d+) ways|between (\d+)|among (\d+)|by (\d+)(?! ?%)|into (\d+)|for (\d+) (?:people|persons|of us|friends|guests)|(\d+) (?:people|persons|of us|friends|guests)/.exec(s);
  if (!r) return null;
  const n = Number(r.slice(1).find(Boolean));
  return n > 0 ? n : null;
}

// ---------- tip ----------
export function tip(c: Ctx): AnswerResult | null {
  if (!/\b(?:tip|tips|gratuity|tipping)\b/.test(c.s)) return null;
  const n = people(c.s);
  // The head count is the number right after "between/among/split/into/for" ("split 4 ways"); a money amount there
  // ("split $100 among 3 people") is still the bill.
  const isCount = (a: { value: Dec; before: string; raw: string }) =>
    /(?:between|among|split|into|for)$/.test(a.before) && !/[$€£¥₹]/.test(a.raw) && n !== null && a.value.eq(n);
  const bill = c.x.amounts.find((a) => !/^(?:ways|people|persons|of)/.test(a.after) && !isCount(a)) ?? fromAns(c);
  if (!bill) return need(c, 'tip', 'What is the bill amount?');
  const rateF = c.x.percents[0];
  const rates = rateF ? [rateF.value] : [15, 18, 20, 22].map((x) => new D(x));
  const rows = rates.map((r) => {
    const t = bill.value.mul(r).div(100);
    const total = bill.value.plus(t);
    return { r, t, total, each: n ? total.div(n) : null };
  });
  const first = rows[0]!;
  const lines: Answer['lines'] = [];
  if (rateF) {
    lines.push({ label: 'Total', display: m(c, first.total) });
    if (n) lines.push({ label: `Each (${n} people)`, display: m(c, first.each!) }, { label: 'Tip each', display: m(c, first.t.div(n)) });
  }
  return ok(c, {
    kind: 'tip',
    expression: rateF ? `${rateF.value}% tip on ${m(c, bill.value)}${n ? `, split ${n} ways` : ''}` : `Tip on ${m(c, bill.value)}`,
    primary: rateF
      ? { display: m(c, first.t), plain: first.t.toFixed(2, D.ROUND_HALF_UP), spoken: `tip ${first.t.toFixed(2, D.ROUND_HALF_UP)}, total ${first.total.toFixed(2, D.ROUND_HALF_UP)}${n ? `, ${first.each!.toFixed(2, D.ROUND_HALF_UP)} each` : ''}`, unit: 'tip' }
      : { display: m(c, rows[1]!.t), plain: rows[1]!.t.toFixed(2, D.ROUND_HALF_UP), spoken: `an 18 percent tip is ${rows[1]!.t.toFixed(2, D.ROUND_HALF_UP)}`, unit: 'at 18%' },
    value: (rateF ? (n ? first.each! : first.total) : rows[1]!.total).toDecimalPlaces(2, D.ROUND_HALF_UP),
    lines,
    table: rateF ? undefined : { columns: ['Tip', 'Amount', 'Total', ...(n ? ['Each'] : [])], rows: rows.map((r) => [`${r.r}%`, m(c, r.t), m(c, r.total), ...(r.each ? [m(c, r.each)] : [])]), highlightRow: 1 },
    notes: rateF ? [] : ['Common US tip rates; say a percentage to pick one'],
  });
}

// ---------- split ----------
export function split(c: Ctx): AnswerResult | null {
  if (!/\b(?:split|share|divide|divvy)\b/.test(c.s) || /\btip\b/.test(c.s)) return null;
  const n = people(c.s);
  const amount = c.x.amounts.find((a) => !/^(?:ways|people|persons)/.test(a.after) && !/(?:between|among|into|by|for)$/.test(a.before) && !a.value.eq(n ?? -1)) ?? fromAns(c);
  if (!amount || !n) return null;
  const each = amount.value.div(n);
  const rounded = each.toDecimalPlaces(2, D.ROUND_DOWN);
  const leftover = amount.value.minus(rounded.mul(n)).toDecimalPlaces(2, D.ROUND_HALF_UP);
  return ok(c, {
    kind: 'split',
    expression: `${m(c, amount.value)} split ${n} ways`,
    primary: { display: m(c, each), plain: each.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2, D.ROUND_HALF_UP), spoken: `${each.toFixed(2, D.ROUND_HALF_UP)} each`, unit: 'each' },
    value: each.toDecimalPlaces(2, D.ROUND_HALF_UP),
    notes: leftover.isZero() ? [] : [`${m(c, rounded)} each leaves ${m(c, leftover)} over; someone pays ${m(c, rounded.plus(leftover))}`],
  });
}

// ---------- sales tax / VAT ----------
export function tax(c: Ctx): AnswerResult | null {
  if (!/\b(?:tax|vat|gst|hst)\b/.test(c.s)) return null;
  const rateF = c.x.percents[0];
  const amount = c.x.amounts[0];
  if (!amount) return need(c, 'tax', 'What is the price?');
  if (!rateF) return need(c, 'tax', 'What is the tax rate? e.g. "8.25% tax on 49.99"');
  const r = rateF.value.div(100);
  const label = /vat/.test(c.s) ? 'VAT' : /gst/.test(c.s) ? 'GST' : 'Tax';
  const words = c.s.replace(/\d+(?:\.\d+)?\s?(?:%|percent)\s?/g, '');
  if (/before (?:the )?(?:tax|vat|gst)|pre-?tax|excluding|without (?:the )?(?:tax|vat)|ex(?:cl)?\.? (?:vat|tax)|remove (?:the )?(?:tax|vat)|(?:tax|vat) included|including (?:tax|vat)|incl/.test(words)) {
    const pre = amount.value.div(r.plus(1));
    return ok(c, {
      kind: 'tax',
      expression: `${m(c, amount.value)} including ${rateF.value}% ${label} → before ${label}`,
      primary: { display: m(c, pre), plain: pre.toFixed(2, D.ROUND_HALF_UP), spoken: `${pre.toFixed(2, D.ROUND_HALF_UP)} before ${label}`, unit: `before ${label.toLowerCase()}` },
      value: pre.toDecimalPlaces(2, D.ROUND_HALF_UP),
      lines: [{ label, display: m(c, amount.value.minus(pre)) }],
    });
  }
  const t = amount.value.mul(r);
  const total = amount.value.plus(t);
  return ok(c, {
    kind: 'tax',
    expression: `${rateF.value}% ${label} on ${m(c, amount.value)}`,
    primary: { display: m(c, total), plain: total.toFixed(2, D.ROUND_HALF_UP), spoken: `${total.toFixed(2, D.ROUND_HALF_UP)} total, of which ${t.toFixed(2, D.ROUND_HALF_UP)} is ${label}`, unit: 'total' },
    value: total.toDecimalPlaces(2, D.ROUND_HALF_UP),
    lines: [{ label, display: m(c, t) }],
  });
}

// ---------- margin / markup ----------
export function margin(c: Ctx): AnswerResult | null {
  if (!/\b(?:margin|markup|mark-up|mark up|profit)\b/.test(c.s)) return null;
  const cost = c.x.amounts.find((a) => /(?:cost|costs|paid|buy|bought|cogs|for)$/.test(a.before) || /^cost/.test(a.after));
  const price = c.x.amounts.find((a) => a !== cost && (/(?:price|sell|sells|sold|selling|at|for|revenue)$/.test(a.before) || /^(?:price|sale)/.test(a.after)));
  const targetPct = c.x.percents[0];

  if (cost && targetPct && !price) {
    const p = targetPct.value.div(100);
    const isMarkup = /markup|mark.?up/.test(c.s);
    if (!isMarkup && p.gte(1)) return need(c, 'margin', 'A margin must be below 100%');
    const sell = isMarkup ? cost.value.mul(p.plus(1)) : cost.value.div(new D(1).minus(p));
    return ok(c, {
      kind: 'margin',
      expression: `Price for ${targetPct.value}% ${isMarkup ? 'markup' : 'margin'} on cost ${m(c, cost.value)}`,
      primary: { display: m(c, sell), plain: sell.toFixed(2, D.ROUND_HALF_UP), spoken: `sell for ${sell.toFixed(2, D.ROUND_HALF_UP)}`, unit: 'price' },
      value: sell.toDecimalPlaces(2, D.ROUND_HALF_UP),
      lines: [
        { label: 'Profit per unit', display: m(c, sell.minus(cost.value)) },
        { label: isMarkup ? 'Equivalent margin' : 'Equivalent markup', display: pct(isMarkup ? sell.minus(cost.value).div(sell) : sell.minus(cost.value).div(cost.value)) },
      ],
      notes: ['Margin = profit ÷ price; markup = profit ÷ cost'],
    });
  }
  const [a, b] = c.x.amounts;
  const costV = cost?.value ?? a?.value;
  const priceV = price?.value ?? (cost ? c.x.amounts.find((x) => x !== cost)?.value : b?.value);
  if (!costV || !priceV) return need(c, 'margin', 'Give a cost and a price, e.g. "margin if cost is 40 and price 60"');
  const profit = priceV.minus(costV);
  const mg = profit.div(priceV);
  const mk = profit.div(costV);
  const wantMarkup = /markup|mark.?up/.test(c.s) && !/margin/.test(c.s);
  return ok(c, {
    kind: 'margin',
    expression: `Cost ${m(c, costV)}, price ${m(c, priceV)}`,
    primary: wantMarkup
      ? { display: pct(mk), plain: mk.mul(100).toDecimalPlaces(4).toString(), spoken: `${mk.mul(100).toDecimalPlaces(2, D.ROUND_HALF_UP)} percent markup`, unit: 'markup' }
      : { display: pct(mg), plain: mg.mul(100).toDecimalPlaces(4).toString(), spoken: `${mg.mul(100).toDecimalPlaces(2, D.ROUND_HALF_UP)} percent margin`, unit: 'margin' },
    value: (wantMarkup ? mk : mg).mul(100).toDecimalPlaces(6),
    lines: [
      { label: 'Profit', display: m(c, profit) },
      { label: wantMarkup ? 'Margin' : 'Markup', display: pct(wantMarkup ? mg : mk) },
    ],
    notes: ['Margin = profit ÷ price; markup = profit ÷ cost'],
  });
}

// ---------- break-even ----------
export function breakEven(c: Ctx): AnswerResult | null {
  if (!/break.?even/.test(c.s)) return null;
  // Prefer the label in front of a number ("fixed costs 5000"), then the one after it ("5000 fixed costs").
  const find = (re: RegExp) => c.x.amounts.find((a) => re.test(a.before)) ?? c.x.amounts.find((a) => re.test(a.after));
  const fixed = find(/fixed|overhead/);
  let variable = find(/variable|unit cost|cost per|per unit|costs? each/);
  const notes: string[] = [];
  // With the fixed costs named, a plain "cost 30" can only be the per-unit (variable) cost.
  if (!variable && fixed) {
    variable = c.x.amounts.find((a) => a !== fixed && /\bcosts?$/.test(a.before));
    if (variable) notes.push(`Read “cost ${variable.value.toString()}” as the variable cost per unit`);
  }
  const others = c.x.amounts.filter((a) => a !== fixed && a !== variable);
  const price = others.find((a) => /(?:price|sell|sells|at|for)/.test(a.before)) ?? others.find((a) => /(?:price|each)/.test(a.after));
  if (!fixed || !variable || !price) return need(c, 'breakeven', 'Break-even needs fixed costs, price per unit and variable cost per unit');
  const contribution = price.value.minus(variable.value);
  if (contribution.lte(0)) return need(c, 'breakeven', 'Price must be above the variable cost per unit to ever break even');
  const units = fixed.value.div(contribution);
  return ok(c, {
    kind: 'breakeven',
    expression: `Fixed ${m(c, fixed.value)}, price ${m(c, price.value)}, variable ${m(c, variable.value)} per unit`,
    primary: { display: `${units.ceil().toString()} units`, plain: units.ceil().toString(), spoken: `${units.ceil()} units` },
    value: units.ceil(),
    lines: [
      { label: 'Exact', display: units.toDecimalPlaces(2, D.ROUND_HALF_UP).toString() },
      { label: 'Contribution margin', display: `${m(c, contribution)} per unit (${pct(contribution.div(price.value))})` },
      { label: 'Break-even revenue', display: m(c, units.ceil().mul(price.value)) },
    ],
    notes,
  });
}

// ---------- unit-price comparison ----------
interface Item {
  label: string;
  price: Dec;
  qty: Dec;
  unit: UnitDef | null;
  unitWord: string;
  base: Dec; // quantity in the dimension's base unit (or count)
}

const COUNT_WORDS = /^(?:pack|packs|ct|count|pcs?|pieces?|items?|units?|eggs?|rolls?|sheets?|pods?|bottles?|cans?|bars?|tablets?|capsules?|bags?|boxes?|loads?|servings?)$/;

function parseItem(seg: string): Item | null {
  const s = seg.trim().replace(/^(?:and|or|vs\.?|versus)\s+/, '');
  if (!s) return null;
  let label = '';
  let body = s;
  const named = /^([a-z][\w' ]{0,30}?)\s*(?::|-|is|costs?)\s+(.+)$/.exec(s);
  if (named && !/\d/.test(named[1]!)) {
    label = named[1]!.trim();
    body = named[2]!;
  }
  const PRICE = `(${NUM_SRC})`;
  // Unit may be two words ("fl oz", "sq ft") but never swallows the link word ("eggs for $5").
  const QTY = String.raw`(\d+(?:\.\d+)?)\s*(?:x|×|\*)?\s*(\d+(?:\.\d+)?)?\s*(?!(?:for|at|costs?|is|a|per)\b)([a-z"'.]+(?: (?!for\b|at\b|costs?\b|is\b|@)[a-z]+)?)`;
  // A bare count ("3 for $5": three of whatever is being bought) needs an explicit link word, else "5000" could be "500 for 0".
  const COUNT = String.raw`(\d+)`;
  let price: string | undefined;
  let a: string | undefined;
  let b: string | undefined;
  let u: string | undefined;
  const currencyFirst = /^[$€£¥₹]/.test(body);
  const forms: [RegExp, (m: RegExpExecArray) => void][] = [
    [new RegExp(`^${PRICE}\\s*(?:for|per|/|a)\\s*${QTY}$`), (m) => ([, price, a, b, u] = m)],
    [new RegExp(`^${PRICE}\\s*(?:for|/)\\s*${COUNT}$`), (m) => ([, price, a] = m)],
    [new RegExp(`^${QTY}\\s*(?:for|at|@|costs?|is|=|:|-)?\\s*${PRICE}$`), (m) => ([, a, b, u, price] = m)],
    [new RegExp(`^${COUNT}\\s*(?:for|at|@)\\s*${PRICE}$`), (m) => ([, a, price] = m)],
  ];
  // "$5 for 3" is price-first; without a currency mark "3 for 5" reads as 3 items for 5, the way shelf labels say it.
  if (!currencyFirst) forms.push(forms.shift()!, forms.shift()!);
  const hit = forms.find(([re]) => re.test(body));
  if (!hit) return null;
  hit[1](hit[0].exec(body)!);
  // Prices need a currency mark or a "for/at" link, else "500 g 3" is ambiguous; the forms enforce the link or order.
  const qty = b ? new D(a!).mul(b) : new D(a!);
  const word = (u ?? '').replace(/\.$/, '').trim();
  const unit = word ? (findUnit(word) ?? findUnit(word.split(' ')[0]!) ?? null) : null;
  // No size word ("3 for $5") or a plain noun ("3 apples for $5") is a count of items.
  if (!unit && word && !COUNT_WORDS.test(word.split(' ')[0]!) && !/^[a-z]+$/.test(word)) return null;
  if (!word) return { label, price: parseNumber(price!), qty, unit: null, unitWord: 'items', base: qty };
  const base = unit ? (unit.factor ? qty.mul(unit.factor) : qty) : qty;
  return { label, price: parseNumber(price!), qty, unit, unitWord: unit ? unit.symbol : word, base };
}

export function compare(c: Ctx): AnswerResult | null {
  if (!/\b(?:compare|comparison|cheaper|cheapest|better (?:deal|value|buy)|best (?:deal|value)|unit price|price per|cost per|per (?:kg|kilo|lb|pound|oz|ounce|liter|litre|l|ml|gram|g|unit|item|roll|sheet|egg))\b|\bvs\.?\b|\bversus\b/.test(c.s)) return null;
  const body = c.s
    .replace(/^.*?(?:compare|which is (?:the )?(?:cheaper|cheapest|better(?: deal| value)?)|cheapest|better deal|best deal|best value)[:\s]*/, '')
    .replace(/(?:,?\s*(?:and\s+)?(?:calculate|tell me|show|find|which|what)\b.*)$/, '')
    .replace(/\b(?:the )?price per (?:kilogram|kg|kilo|lb|pound|liter|litre|l|unit|item)\b(?: of)?(?: these (?:\w+ )?(?:products|items|options))?:?/, '');
  const segments = body.split(/\s*(?:;|,|\bvs\.?|\bversus\b|\bor\b|\band\b)\s*/).filter(Boolean);
  const items = segments.map(parseItem).filter((x): x is Item => !!x);
  if (items.length < 2) return items.length === 1 ? need(c, 'compare', 'Give at least two items, e.g. "500 g for $3.49 vs 1 kg for $5.99"') : null;

  const dims = new Set(items.map((i) => i.unit?.dimension ?? 'count'));
  if (dims.size > 1) return need(c, 'compare', `Can't compare ${[...dims].join(' with ')}; use the same kind of size for every item`);
  const dim = [...dims][0]!;

  // Price per what? Respect "per lb" etc., else per kg / per L / per item.
  const per = /per (\w+)/.exec(c.s)?.[1];
  const perUnit = (per && findUnit(per)) || null;
  const target =
    perUnit && perUnit.dimension === dim ? perUnit : dim === 'mass' ? findUnit('kg')! : dim === 'volume' ? findUnit('l')! : null;
  const targetLabel = target ? target.symbol : items[0]!.unitWord.replace(/s$/, '');
  const unitPrice = (i: Item) => (target ? i.price.div(i.base.div(target.factor!)) : i.price.div(i.base));

  const priced = items.map((i, k) => ({ ...i, label: i.label || `Option ${k + 1}`, up: unitPrice(i) }));
  const order = [...priced].sort((a, b) => a.up.comparedTo(b.up));
  const best = order[0]!;
  const worst = order[order.length - 1]!;
  const next = order[1]!;
  const cheapestIdx = priced.indexOf(best);
  const saving = worst.up.minus(best.up).div(worst.up);
  const fmtUnitPrice = (v: Dec) => `${m(c, v.toDecimalPlaces(v.lt(1) ? 4 : 2))}`;
  return ok(c, {
    kind: 'compare',
    expression: `Cheapest per ${targetLabel}: ${best.label} (${best.qty.toString()} ${best.unitWord} for ${m(c, best.price)})`,
    primary: { display: fmtUnitPrice(best.up), plain: best.up.toDecimalPlaces(4).toString(), spoken: `${best.label} is cheapest at ${best.up.toFixed(2, D.ROUND_HALF_UP)} per ${targetLabel}`, unit: `/ ${targetLabel}` },
    value: best.up.toDecimalPlaces(4),
    lines: [
      { label: `vs ${next.label}`, display: `${fmtUnitPrice(next.up.minus(best.up))} less per ${targetLabel} (${pct(next.up.minus(best.up).div(next.up), 1)})` },
      ...(order.length > 2 ? [{ label: `vs ${worst.label} (priciest)`, display: `${pct(saving, 1)} cheaper` }] : []),
    ],
    table: {
      columns: ['Item', 'Price', 'Size', `Per ${targetLabel}`],
      rows: priced.map((i) => [i.label, m(c, i.price), `${i.qty.toString()} ${i.unitWord}`, fmtUnitPrice(i.up)]),
      highlightRow: cheapestIdx,
    },
    notes: priced.some((i) => i.up.eq(best.up) && i !== best) ? ['Two or more items tie on unit price'] : [],
  });
}
