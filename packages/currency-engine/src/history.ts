import { createSession, MathError, type AnswerResult, type Session } from '@lemma/math-core';
import { convertParsed, FRANKFURTER, parseCurrency, type Parsed, type RatesSnapshot } from './index';

/**
 * Historical exchange rates: "100 usd to eur on 2015-03-01", "eur to gbp last christmas".
 *
 * Rates are ECB reference rates (via Frankfurter), fetched once per requested date and cached; past rates
 * never change, so they are also kept in local storage when the host offers it. ECB publishes on TARGET
 * business days only; for a weekend or holiday Frankfurter returns the previous business day's rates, and
 * the answer says so. Dates are resolved by the caller (the date engine) so this package stays dependency-free.
 */

/** The first day the ECB published euro reference rates. */
export const ECB_FIRST_DATE = '1999-01-04';

export type DateResolver = (text: string) => { iso: string; notes: string[] } | null;

export interface HistoricalQuery {
  parsed: Parsed;
  /** Requested date, YYYY-MM-DD. */
  date: string;
  notes: string[];
}

const LEAD = /^(?:what (?:was|were) |how much (?:was|were) |convert |(?:the )?(?:historical |historic )?(?:exchange )?rates? (?:of |for |from )?)+/;
const JOIN = / (?:on|as of|at|for|in|from|back on|back in|dated)$/;

/** Splits "<currency question> [on] <date>" into its parts, or null when it isn't a dated currency question. */
export function parseHistorical(input: string, resolveDate: DateResolver): HistoricalQuery | null {
  const s = input.toLowerCase().trim().replace(/[?!.]+$/, '').replace(/\s+/g, ' ').replace(LEAD, '');
  if (s.length > 200) return null;
  const words = s.split(' ');
  for (let k = 1; k <= Math.min(6, words.length - 2); k++) {
    const date = resolveDate(words.slice(-k).join(' '));
    if (!date) continue;
    const left = words.slice(0, -k).join(' ').replace(JOIN, '').replace(/,$/, '');
    const parsed = parseCurrency(left) ?? (/^[a-z$€£¥₹]/.test(left) ? parseCurrency(`1 ${left}`) : null);
    if (parsed) return { parsed, date: date.iso, notes: date.notes };
  }
  return null;
}

interface Entry {
  snapshot?: RatesSnapshot;
  error?: string;
  at: number;
}

export interface HistoricalRatesOptions {
  fetchFn?: typeof fetch;
  /** Somewhere to persist past rates (localStorage in browsers). */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  now?: () => number;
  /** Max dates kept. */
  max?: number;
}

const STORE_KEY = 'lemma.fx-history.v1';
const RETRY_AFTER_MS = 30_000;
/** Rates for the last few days can still change (today's are published at 16:00 CET), so they expire. */
const RECENT_TTL_MS = 3600_000;

export class HistoricalRates {
  private cache = new Map<string, Entry>();
  private inflight = new Map<string, Promise<RatesSnapshot>>();
  fetchFn: typeof fetch | undefined;
  private storage: HistoricalRatesOptions['storage'];
  private now: () => number;
  private max: number;

  constructor(opts: HistoricalRatesOptions = {}) {
    this.fetchFn = opts.fetchFn;
    this.storage = opts.storage;
    this.now = opts.now ?? Date.now;
    this.max = opts.max ?? 120;
    try {
      const raw = this.storage?.getItem(STORE_KEY);
      const saved = raw ? (JSON.parse(raw) as Record<string, RatesSnapshot>) : {};
      for (const [d, snap] of Object.entries(saved)) if (snap && typeof snap.date === 'string' && snap.rates) this.cache.set(d, { snapshot: snap, at: snap.fetchedAt });
    } catch {
      // Unreadable storage: start empty.
    }
  }

  private today(): string {
    return new Date(this.now()).toISOString().slice(0, 10);
  }

  private recent(date: string): boolean {
    return (Date.parse(this.today()) - Date.parse(date)) / 86_400_000 < 4;
  }

  /** A usable cached snapshot, a remembered recent failure, or nothing. */
  lookup(date: string): Entry | undefined {
    const e = this.cache.get(date);
    if (!e) return undefined;
    if (e.error) return this.now() - e.at < RETRY_AFTER_MS ? e : undefined;
    if (this.recent(date) && this.now() - e.at > RECENT_TTL_MS) return undefined;
    return e;
  }

  /** Checks a requested date before anything is fetched. */
  validate(date: string): string | null {
    if (date < ECB_FIRST_DATE) return `Historical rates start on 4 January 1999, when the ECB began publishing euro reference rates`;
    if (date > this.today()) return `${date} is in the future, so there is no exchange rate for it yet`;
    return null;
  }

  /** Fetches (or joins a fetch of) the rates for one date. Rejects with a readable message. */
  request(date: string): Promise<RatesSnapshot> {
    const hit = this.lookup(date);
    if (hit?.snapshot) return Promise.resolve(hit.snapshot);
    if (hit?.error) return Promise.reject(new Error(hit.error));
    let p = this.inflight.get(date);
    if (!p) {
      p = this.fetch(date).then(
        (snap) => {
          this.inflight.delete(date);
          this.remember(date, { snapshot: snap, at: this.now() });
          return snap;
        },
        (e: unknown) => {
          this.inflight.delete(date);
          const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
          const message = offline
            ? 'Historical exchange rates need an internet connection the first time; you appear to be offline'
            : `Couldn't load historical exchange rates (${e instanceof Error ? e.message : String(e)})`;
          this.cache.set(date, { error: message, at: this.now() });
          throw new Error(message);
        },
      );
      this.inflight.set(date, p);
    }
    return p;
  }

  private async fetch(date: string): Promise<RatesSnapshot> {
    const f = this.fetchFn ?? (typeof fetch === 'function' ? fetch : null);
    if (!f) throw new Error('no network access here');
    const res = await f(`https://api.frankfurter.dev/v1/${date}?from=EUR`, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`exchange-rate service returned ${res.status}`);
    const body = (await res.json()) as { base?: unknown; date?: unknown; rates?: unknown };
    if (body.base !== 'EUR' || typeof body.date !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(body.date) || typeof body.rates !== 'object' || !body.rates) {
      throw new Error('unexpected response');
    }
    const rates: Record<string, number> = {};
    for (const [k, v] of Object.entries(body.rates as Record<string, unknown>)) if (typeof v === 'number' && v > 0 && /^[A-Z]{3}$/.test(k)) rates[k] = v;
    return { base: 'EUR', date: body.date, rates, fetchedAt: this.now(), source: FRANKFURTER };
  }

  private remember(date: string, e: Entry): void {
    this.cache.delete(date);
    this.cache.set(date, e);
    while (this.cache.size > this.max) this.cache.delete(this.cache.keys().next().value!);
    if (!this.storage || this.recent(date)) return;
    try {
      const keep: Record<string, RatesSnapshot> = {};
      for (const [d, x] of this.cache) if (x.snapshot && !this.recent(d)) keep[d] = x.snapshot;
      this.storage.setItem(STORE_KEY, JSON.stringify(keep));
    } catch {
      // Storage full or unavailable: the in-memory cache still works.
    }
  }

  /**
   * Answers a dated currency question. `{ pending: date }` means the rates for that date must be fetched
   * first (call {@link request}); null means the input isn't a dated currency question.
   */
  answer(input: string, resolveDate: DateResolver, session: Session = createSession()): AnswerResult | { pending: string } | null {
    const q = parseHistorical(input, resolveDate);
    if (!q) return null;
    const bad = this.validate(q.date);
    if (bad) return { ok: false, kind: 'currency', input, error: new MathError('domain', bad) };
    const hit = this.lookup(q.date);
    if (!hit) return { pending: q.date };
    if (hit.error) return { ok: false, kind: 'currency', input, error: new MathError('domain', hit.error) };
    const snap = hit.snapshot!;
    const notes = [...q.notes];
    if (snap.date !== q.date) {
      const wd = (iso: string) => new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
      const day = new Date(`${q.date}T12:00:00Z`).getUTCDay();
      const why =
        q.date === this.today()
          ? 'Today’s ECB rates aren’t published yet (they come out around 16:00 CET)'
          : day === 0 || day === 6
            ? `${q.date} was a ${wd(q.date)}`
            : `The ECB published no rates on ${q.date} (a TARGET holiday)`;
      notes.push(`${why}, so this uses the previous business day’s rates (${wd(snap.date)} ${snap.date})`);
    }
    return convertParsed(input, q.parsed, snap, session, this.now(), { requested: q.date, notes });
  }
}
