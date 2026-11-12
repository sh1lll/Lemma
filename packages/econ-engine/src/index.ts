import { D, formatNumber, MathError, type Answer, type AnswerResult, type Dec } from '@lemma/math-core';
import { cpi, US_CPI, US_CPI_LAST } from './cpi';

export { cpi, US_CPI, US_CPI_LAST };

/**
 * Inflation adjustment from a bundled, published price index (no network, no estimates). Answers:
 *   "$100 in 1990 in today's dollars", "what's $50,000 from 1985 worth in 2020", "$100 in 2020 in 1990 dollars",
 *   "inflation from 2000 to 2024", "inflation since 1990", "inflation in 2022", "cpi in 1980".
 * Years outside the table are refused with the range that is available. Only US CPI-U is bundled.
 */

const KIND = 'inflation';
const SOURCE = () => ({ name: US_CPI.name, url: US_CPI.url, asOf: `${US_CPI_LAST} annual average` });

/** Cheap pre-check for the router. */
export const LOOKS_LIKE_INFLATION =
  /\binflation\b|\bcpi\b|purchasing power|today'?s (?:dollars|money)|(?:1[89]|20)\d\d(?:'s)? dollars|\bworth (?:today|now|in (?:1[89]|20)\d\d)\b|\b(?:in|from) (?:1[89]|20)\d\d (?:in|to|worth) (?:today|now|(?:1[89]|20)\d\d)\b|\bin today'?s\b|\bdollars? (?:from|in) (?:1[89]|20)\d\d\b|\bcurrent dollars\b/i;

const YEAR = String.raw`(1[0-9]\d\d|2\d\d\d)`;
const TODAY = String.raw`(?:today|now|current|present|nowadays|this year)`;
const AMOUNT = String.raw`(?:\$|us\$|usd ?)?(\d[\d,]*(?:\.\d+)?|\.\d+)\s*(k|m|thousand|million|billion|bn)?(?: ?(?:us )?(?:dollars?|usd|bucks))?`;

function fail(input: string, message: string): AnswerResult {
  return { ok: false, kind: KIND, input, error: new MathError('domain', message) };
}

function checkYear(input: string, y: number): AnswerResult | null {
  if (cpi(y) !== undefined) return null;
  const range = `${US_CPI.first}–${US_CPI_LAST}`;
  if (y > US_CPI_LAST) {
    const now = new Date().getUTCFullYear();
    if (y > now) return fail(input, `${y} is in the future. Lemma's US CPI table covers ${range} (BLS annual averages).`);
    return fail(input, `There's no ${y} annual average in Lemma's US CPI table yet; it covers ${range} (BLS annual averages). For ${y}, check bls.gov/cpi.`);
  }
  return fail(input, `US CPI data starts in ${US_CPI.first}; Lemma's table covers ${range} (BLS annual averages).`);
}

const money = (x: Dec) => `$${formatNumber(x, { fixedPlaces: 2 }).display}`;
const pct = (x: Dec, places = 2) => `${formatNumber(x.mul(100), { fixedPlaces: places }).display}%`;

function scale(n: string, suffix: string | undefined): Dec {
  const v = new D(n.replace(/,/g, ''));
  switch (suffix) {
    case 'k':
    case 'thousand':
      return v.mul(1e3);
    case 'm':
    case 'million':
      return v.mul(1e6);
    case 'billion':
    case 'bn':
      return v.mul(1e9);
    default:
      return v;
  }
}

function avgAnnual(ratio: Dec, years: number): Dec | null {
  if (years === 0) return null;
  return new D(Math.pow(ratio.toNumber(), 1 / years) - 1);
}

function normalise(input: string): string {
  return input
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[?!]+$|\.$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:hey |ok |so |please |tell me |calculate |compute |can you tell me |what(?:'s| is| was| would be) |how much (?:is|was|would be) |how much |convert )+/, '')
    .replace(/\btoday's\b/g, 'today')
    .replace(/\btodays\b/g, 'today')
    .replace(/(\d{4})'?s dollars/g, '$1 dollars');
}

/** Amount conversions between years. */
function adjust(input: string, s: string): AnswerResult | null {
  const lead = new RegExp(`^(?:the )?(?:value of |inflation[- ]adjusted |adjust )?${AMOUNT} (?:in |from |of |back in )?${YEAR}(?: dollars)?\\b(.*)$`).exec(s);
  if (!lead) return null;
  const amount = scale(lead[1]!, lead[2]);
  const from = Number(lead[3]);
  const rest = lead[4]!.trim();
  if (!/\$|dollar|usd|bucks/.test(s) && !/\b(?:worth|inflation|adjusted|today)\b/.test(rest)) return null;

  let to: number | null = null;
  let m: RegExpExecArray | null;
  if (rest === '' || new RegExp(`^(?:(?:is |are |would be |be )?worth )?(?:in )?${TODAY}(?: dollars)?$|^(?:adjusted )?for inflation$|^(?:in |to )?${TODAY}(?: dollars| money)?$|^(?:adjusted|inflation adjusted)(?: to ${TODAY})?$`).test(rest)) {
    to = US_CPI_LAST;
  } else if ((m = new RegExp(`^(?:(?:is |are |would be |be )?worth |in |to |into |as |=)?(?:in )?${YEAR}(?: dollars| money)?$`).exec(rest))) {
    to = Number(m[1]);
  } else if ((m = new RegExp(`^(?:adjusted|inflation adjusted) (?:to|for) ${YEAR}$`).exec(rest))) {
    to = Number(m[1]);
  } else return null;

  for (const y of [from, to]) {
    const bad = checkYear(input, y);
    if (bad) return bad;
  }
  const a = new D(cpi(from)!);
  const b = new D(cpi(to)!);
  const ratio = b.div(a);
  const result = amount.mul(ratio);
  const notes: string[] = [];
  if (/today|now|current|present/.test(rest) || rest === '' || /for inflation$|adjusted$/.test(rest)) notes.push(`“Today” means ${US_CPI_LAST}, the latest full year in the bundled table`);
  notes.push('Annual-average CPI-U; calculators that use a single month (like BLS’s online one) can differ slightly');
  const lines: Answer['lines'] = [
    { label: `CPI-U ${from}`, display: String(cpi(from)) },
    { label: `CPI-U ${to}`, display: String(cpi(to)) },
    { label: to >= from ? 'Cumulative inflation' : 'Cumulative deflation back', display: pct(ratio.sub(1)) },
  ];
  const avg = avgAnnual(to >= from ? ratio : new D(1).div(ratio), Math.abs(to - from));
  if (avg) lines.push({ label: 'Average per year', display: pct(avg) });
  lines.push({ label: `$1 in ${from}`, display: `${money(ratio)} in ${to}` });
  return {
    ok: true,
    kind: KIND,
    input,
    expression: `${money(amount)} in ${from} → ${to} dollars (US CPI-U)`,
    primary: { display: money(result), plain: result.toDecimalPlaces(2).toString(), spoken: `about ${result.toDecimalPlaces(2).toString()} dollars in ${to} money`, unit: 'USD' },
    value: result.toDecimalPlaces(2),
    lines,
    notes,
    source: SOURCE(),
  };
}

/** Inflation rates: between two years, since a year, or for one year. */
function rate(input: string, s: string): AnswerResult | null {
  let m = new RegExp(`^(?:the )?(?:us |u\\.s\\. |american )?(?:cumulative |total |overall )?(?:inflation|cpi(?: inflation)?|price (?:increase|rise|change))(?: rate)? (?:from|between) ${YEAR} (?:to|and|through|until|till) (${YEAR}|${TODAY.slice(3, -1)})$`).exec(s);
  let from: number;
  let to: number;
  if (m) {
    from = Number(m[1]);
    to = /^\d/.test(m[2]!) ? Number(m[2]) : US_CPI_LAST;
  } else if ((m = new RegExp(`^(?:the )?(?:us |u\\.s\\. )?(?:cumulative |total )?(?:inflation|cpi inflation|price (?:increase|rise))(?: rate)? since ${YEAR}$`).exec(s))) {
    from = Number(m[1]);
    to = US_CPI_LAST;
  } else if ((m = new RegExp(`^(?:the )?(?:us |u\\.s\\. |annual )*(?:inflation|cpi inflation)(?: rate)?(?: in| for| during|,)? ${YEAR}$|^${YEAR} (?:us )?inflation(?: rate)?$`).exec(s))) {
    const y = Number(m[1] ?? m[2]);
    const bad = checkYear(input, y) ?? (y === US_CPI.first ? fail(input, `${US_CPI.first} is the first year in the table, so there's no earlier year to compare it with`) : null);
    if (bad) return bad;
    const r = new D(cpi(y)!).div(cpi(y - 1)!).sub(1);
    return {
      ok: true,
      kind: KIND,
      input,
      expression: `US inflation in ${y} (annual average CPI-U vs ${y - 1})`,
      primary: { display: pct(r, 1), plain: r.mul(100).toDecimalPlaces(4).toString(), spoken: `${r.mul(100).toDecimalPlaces(1)} percent` },
      value: r.mul(100).toDecimalPlaces(4),
      lines: [
        { label: `CPI-U ${y - 1}`, display: String(cpi(y - 1)) },
        { label: `CPI-U ${y}`, display: String(cpi(y)) },
        { label: 'Change, more precisely', display: pct(r, 3) },
      ],
      notes: ['Change in the annual average index, the figure BLS reports as the annual inflation rate'],
      source: SOURCE(),
    };
  } else if ((m = new RegExp(`^(?:the )?(?:us )?cpi(?:-u)?(?: index)?(?: in| for)? ${YEAR}$`).exec(s))) {
    const y = Number(m[1]);
    const bad = checkYear(input, y);
    if (bad) return bad;
    return {
      ok: true,
      kind: KIND,
      input,
      expression: `US CPI-U annual average, ${y}`,
      primary: { display: String(cpi(y)), plain: String(cpi(y)), spoken: String(cpi(y)) },
      value: new D(cpi(y)!),
      lines: [{ label: 'Base', display: '1982–84 = 100' }],
      notes: [],
      source: SOURCE(),
    };
  } else return null;

  for (const y of [from, to]) {
    const bad = checkYear(input, y);
    if (bad) return bad;
  }
  if (from > to) [from, to] = [to, from];
  const ratio = new D(cpi(to)!).div(cpi(from)!);
  const avg = avgAnnual(ratio, to - from);
  return {
    ok: true,
    kind: KIND,
    input,
    expression: `US inflation ${from} → ${to} (annual average CPI-U)`,
    primary: { display: pct(ratio.sub(1)), plain: ratio.sub(1).mul(100).toDecimalPlaces(4).toString(), spoken: `${ratio.sub(1).mul(100).toDecimalPlaces(1)} percent` },
    value: ratio.sub(1).mul(100).toDecimalPlaces(4),
    lines: [
      { label: `CPI-U ${from}`, display: String(cpi(from)) },
      { label: `CPI-U ${to}`, display: String(cpi(to)) },
      { label: 'Prices multiplied by', display: `×${ratio.toSignificantDigits(5).toString()}` },
      ...(avg ? [{ label: 'Average per year', display: pct(avg) }] : []),
      { label: `$100 in ${from}`, display: `${money(ratio.mul(100))} in ${to}` },
    ],
    notes: to === US_CPI_LAST && !/\b20\d\d$/.test(s) ? [`Up to ${US_CPI_LAST}, the latest full year in the bundled table`] : [],
    source: SOURCE(),
  };
}

/** Answers inflation questions, or returns null when the input isn't one. */
export function answerInflation(input: string): AnswerResult | null {
  if (!LOOKS_LIKE_INFLATION.test(input)) return null;
  const s = normalise(input);
  if (s.length > 200) return null;
  if (/\b(?:uk|u\.k\.|british|britain|england|pounds?|£|eurozone|euro|€|canada|canadian|australia|japan|india|germany|france)\b|[£€¥₹]/.test(s) && /\binflation|\bcpi\b|\btoday|\bmoney\b|\bdollars?\b|worth/.test(s)) {
    return fail(input, 'Only US inflation (BLS CPI-U) is bundled with Lemma; other countries’ price indices aren’t included');
  }
  return rate(input, s) ?? adjust(input, s);
}
