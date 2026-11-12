import { calculate, createSession, D, formatNumber, MathError, type Answer, type AnswerResult, type Dec, type Session } from '@lemma/math-core';

/**
 * Currency conversion. Exchange rates are external, changing data: every answer carries its source and
 * the rates' date, and the engine never invents a rate. The rate source is injected so it can be swapped
 * (and so tests are deterministic).
 */

export interface RatesSnapshot {
  /** All rates are "1 base = rate × code". */
  base: string;
  rates: Record<string, number>;
  /** Publication date of the rates (YYYY-MM-DD). */
  date: string;
  /** When this device fetched them (ms since epoch). */
  fetchedAt: number;
  source: { name: string; url: string };
}

interface CurrencyDef {
  code: string;
  symbol: string;
  name: string;
  aliases: string[];
}

const C = (code: string, symbol: string, name: string, ...aliases: string[]): CurrencyDef => ({ code, symbol, name, aliases: [code.toLowerCase(), ...aliases] });

export const CURRENCIES: CurrencyDef[] = [
  C('USD', '$', 'US dollar', 'us dollars', 'us dollar', 'dollars', 'dollar', 'bucks', 'buck', '$', 'usd$'),
  C('EUR', '€', 'euro', 'euros', 'euro', '€'),
  C('GBP', '£', 'British pound', 'pounds', 'pound', 'pounds sterling', 'sterling', 'quid', '£', 'british pounds'),
  C('JPY', '¥', 'Japanese yen', 'yen', 'japanese yen', '¥'),
  C('CNY', '¥', 'Chinese yuan', 'yuan', 'renminbi', 'rmb', 'chinese yuan'),
  C('INR', '₹', 'Indian rupee', 'rupees', 'rupee', 'indian rupees', '₹'),
  C('CAD', 'C$', 'Canadian dollar', 'canadian dollars', 'canadian dollar', 'c$', 'cad$'),
  C('AUD', 'A$', 'Australian dollar', 'australian dollars', 'australian dollar', 'a$', 'aussie dollars'),
  C('NZD', 'NZ$', 'New Zealand dollar', 'new zealand dollars', 'kiwi dollars', 'nz$'),
  C('CHF', 'CHF', 'Swiss franc', 'swiss francs', 'swiss franc', 'francs', 'franc'),
  C('MXN', 'MX$', 'Mexican peso', 'mexican pesos', 'mexican peso', 'pesos', 'peso'),
  C('BRL', 'R$', 'Brazilian real', 'reais', 'real', 'brazilian reais', 'r$'),
  C('KRW', '₩', 'South Korean won', 'won', 'korean won', '₩'),
  C('SEK', 'kr', 'Swedish krona', 'swedish kronor', 'swedish krona'),
  C('NOK', 'kr', 'Norwegian krone', 'norwegian kroner', 'norwegian krone'),
  C('DKK', 'kr', 'Danish krone', 'danish kroner', 'danish krone'),
  C('PLN', 'zł', 'Polish złoty', 'zloty', 'zlotys', 'złoty'),
  C('CZK', 'Kč', 'Czech koruna', 'koruna', 'czech koruna'),
  C('HUF', 'Ft', 'Hungarian forint', 'forint', 'forints'),
  C('RON', 'lei', 'Romanian leu', 'lei', 'leu'),
  C('ISK', 'kr', 'Icelandic króna', 'icelandic krona'),
  C('TRY', '₺', 'Turkish lira', 'lira', 'turkish lira', '₺'),
  C('ZAR', 'R', 'South African rand', 'rand', 'rands'),
  C('SGD', 'S$', 'Singapore dollar', 'singapore dollars', 's$'),
  C('HKD', 'HK$', 'Hong Kong dollar', 'hong kong dollars', 'hk$'),
  C('THB', '฿', 'Thai baht', 'baht', '฿'),
  C('IDR', 'Rp', 'Indonesian rupiah', 'rupiah'),
  C('PHP', '₱', 'Philippine peso', 'philippine pesos', 'philippine peso', '₱'),
  C('MYR', 'RM', 'Malaysian ringgit', 'ringgit'),
  C('ILS', '₪', 'Israeli shekel', 'shekels', 'shekel', 'nis', '₪'),
];

const BY_ALIAS = new Map<string, CurrencyDef>();
for (const c of CURRENCIES) for (const a of c.aliases) if (!BY_ALIAS.has(a)) BY_ALIAS.set(a, c);
const ALIASES_LONGEST = [...BY_ALIAS.keys()].sort((a, b) => b.length - a.length);

/** Symbols and words that several currencies share; we pick the common one and say so. */
const AMBIGUOUS: Record<string, string> = {
  $: 'Read "$" as US dollars',
  dollars: 'Read "dollars" as US dollars',
  dollar: 'Read "dollars" as US dollars',
  '¥': 'Read "¥" as Japanese yen',
  pesos: 'Read "pesos" as Mexican pesos',
  peso: 'Read "pesos" as Mexican pesos',
  francs: 'Read "francs" as Swiss francs',
  kr: '',
};

export function findCurrency(word: string): CurrencyDef | undefined {
  return BY_ALIAS.get(word.trim().toLowerCase());
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ALIAS_RE = ALIASES_LONGEST.map(escape).join('|');
// The quantity may be any expression the calculator understands ("50 * 3", "that", "1.2k").
const PAIR = new RegExp(
  `^(?:convert |change |exchange |how much is |what(?:'s| is) )*(?:(${ALIAS_RE})\\s?)?(.*?)\\s*(${ALIAS_RE})?\\s+(?:to|in|into|as|=)\\s+((?:${ALIAS_RE})(?:\\s*(?:,|and)\\s*(?:${ALIAS_RE}))*)$`,
);

/** Every currency question ends in "to/in <currency>[, <currency>…]". Checked first: it is linear, while PAIR backtracks. */
const TAIL = new RegExp(`\\s(?:to|in|into|as|=)\\s+(?:${ALIAS_RE})(?:\\s*(?:,|and)\\s*(?:${ALIAS_RE}))*$`);

export interface Parsed {
  quantity: string;
  from: CurrencyDef;
  to: CurrencyDef[];
  notes: string[];
}

export function parseCurrency(input: string): Parsed | null {
  const s = input.toLowerCase().trim().replace(/[?!.]+$/, '').replace(/\s+/g, ' ').replace(/(\d+)(?:\.(\d+))?k\b/g, (_m, i: string, f = '') => `${i}${f.padEnd(3, '0').slice(0, 3)}${f.length > 3 ? `.${f.slice(3)}` : ''}`.replace(/^0+(?=\d)/, ''));
  // Real questions are short; long inputs (pasted lists, repeated words) would make PAIR backtrack quadratically.
  if (s.length > 300 || !TAIL.test(s)) return null;
  const m = PAIR.exec(s);
  if (!m) return null;
  const fromWord = m[1] ?? m[3];
  if (!fromWord) return null;
  const from = findCurrency(fromWord)!;
  const toWords = m[4]!.split(/\s*(?:,|and)\s*/).filter(Boolean);
  const to = toWords.map((w) => findCurrency(w)!).filter((c) => c.code !== from.code || toWords.length === 1);
  const notes = [fromWord, ...toWords].map((w) => AMBIGUOUS[w]).filter((n): n is string => !!n);
  let quantity = m[2]!.trim().replace(/,(?=\d{3}\b)/g, '').replace(/\s+(?:many|much)$/, '');
  // "usd to eur" with no amount converts one unit, and says so.
  if (!quantity) notes.push(`No amount given, so this converts 1 ${from.code}`);
  if (!quantity || quantity === 'a' || quantity === 'one') quantity = '1';
  return { quantity, from, to, notes: [...new Set(notes)] };
}

export const LOOKS_LIKE_CURRENCY = new RegExp(`(?:^|[\\s\\d])(?:${ALIAS_RE})(?:$|[\\s\\d,.?])|[$€£¥₹₩₺₪₱฿]`, 'i');

export type CurrencyOutcome = AnswerResult | { pending: true } | null;

/**
 * Converts with the given snapshot. Returns `{ pending: true }` when the input is a currency question
 * but no rates are available yet, so the caller can fetch and retry.
 */
export function answerCurrency(input: string, rates: RatesSnapshot | null, session: Session = createSession(), now = Date.now()): CurrencyOutcome {
  const p = parseCurrency(input);
  if (!p) return null;
  if (!rates) return { pending: true };
  return convertParsed(input, p, rates, session, now);
}

/** Converts an already-parsed question with the given rates. `historical` marks a dated (past) rate. */
export function convertParsed(
  input: string,
  p: Parsed,
  rates: RatesSnapshot,
  session: Session,
  now = Date.now(),
  historical?: { requested: string; notes: string[] },
): AnswerResult {
  const q = calculate(p.quantity, session);
  if (!q.ok) return { ok: false, kind: 'currency', input, error: q.error };
  const rateOf = (c: CurrencyDef): Dec | null => (c.code === rates.base ? new D(1) : rates.rates[c.code] !== undefined ? new D(rates.rates[c.code]!) : null);
  const fromRate = rateOf(p.from);
  if (!fromRate) return { ok: false, kind: 'currency', input, error: new MathError('domain', `No rate available for ${p.from.code}`) };

  const missing = p.to.find((t) => !rateOf(t));
  if (missing) return { ok: false, kind: 'currency', input, error: new MathError('domain', `No rate available for ${missing.code}${historical ? ` on ${rates.date}` : ''}`) };
  const results = p.to.map((t) => {
    const unit = rateOf(t)!.div(fromRate);
    return { cur: t, unit, value: q.value.mul(unit) };
  });
  const first = results[0]!;
  const places = (c: CurrencyDef, v: Dec) => (['JPY', 'KRW', 'IDR', 'HUF', 'ISK'].includes(c.code) && v.abs().gte(100) ? 0 : 2);
  const fmt = (c: CurrencyDef, v: Dec) => `${c.symbol.length === 1 ? c.symbol : ''}${formatNumber(v, { fixedPlaces: places(c, v) }).display}${c.symbol.length === 1 ? '' : ` ${c.code}`}`;

  const ageDays = (now - Date.parse(`${rates.date}T16:00:00Z`)) / 86_400_000;
  const stale = !historical && ageDays > 4; // ECB publishes on working days; a long weekend is ~3 days.
  const answer: Answer = {
    ok: true,
    kind: 'currency',
    input,
    expression: `${fmt(p.from, q.value)} → ${results.map((r) => r.cur.code).join(', ')}${historical ? ` on ${historical.requested}` : ''}`,
    primary: { display: fmt(first.cur, first.value), plain: first.value.toDecimalPlaces(places(first.cur, first.value)).toString(), spoken: `${first.value.toDecimalPlaces(2)} ${first.cur.name}s`, unit: first.cur.code },
    value: first.value.toDecimalPlaces(4),
    lines: [
      ...results.slice(1).map((r) => ({ label: r.cur.code, display: fmt(r.cur, r.value) })),
      ...results.map((r) => ({ label: `1 ${p.from.code}`, display: `${r.unit.toSignificantDigits(6).toString()} ${r.cur.code}` })),
    ],
    notes: [...p.notes, ...(historical?.notes ?? []), historical ? `ECB reference rate for ${rates.date}; banks and card networks add fees and spreads` : 'Reference mid-market rate; banks and card networks add fees and spreads'],
    source: { ...rates.source, asOf: rates.date, stale },
  };
  return answer;
}

// ---------- rate fetching ----------
export const FRANKFURTER = { name: 'European Central Bank via Frankfurter', url: 'https://www.frankfurter.app/' };

/** Fetches the latest ECB reference rates. Throws on network or schema errors. */
export async function fetchRates(fetchFn: typeof fetch = fetch): Promise<RatesSnapshot> {
  const res = await fetchFn('https://api.frankfurter.dev/v1/latest?base=EUR', { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Exchange-rate service returned ${res.status}`);
  const body = (await res.json()) as { base?: unknown; date?: unknown; rates?: unknown };
  if (body.base !== 'EUR' || typeof body.date !== 'string' || typeof body.rates !== 'object' || !body.rates) throw new Error('Unexpected exchange-rate response');
  const rates: Record<string, number> = {};
  for (const [k, v] of Object.entries(body.rates as Record<string, unknown>)) if (typeof v === 'number' && v > 0 && /^[A-Z]{3}$/.test(k)) rates[k] = v;
  return { base: 'EUR', date: body.date, rates, fetchedAt: Date.now(), source: FRANKFURTER };
}

export { HistoricalRates, parseHistorical, ECB_FIRST_DATE, type HistoricalQuery, type DateResolver } from './history';
