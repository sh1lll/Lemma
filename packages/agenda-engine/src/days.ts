import { Temporal } from '@lemma/date-engine';
import type { Day } from './types';

/**
 * Day arithmetic. Days are plain `YYYY-MM-DD` strings; adding and diffing them uses UTC calendar math, so
 * DST transitions (23- or 25-hour days) can't skip or repeat a day. Only converting an instant to a day
 * needs a time zone.
 */

const pad = (n: number) => String(n).padStart(2, '0');

function parts(d: Day): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) throw new Error(`Not a day: ${d}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

const utc = (d: Day) => {
  const [y, m, dd] = parts(d);
  return Date.UTC(y, m - 1, dd);
};

const fromUtc = (ms: number): Day => {
  const t = new Date(ms);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};

export const isDay = (s: unknown): s is Day => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function addDays(d: Day, n: number): Day {
  return fromUtc(utc(d) + n * 86_400_000);
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function diffDays(a: Day, b: Day): number {
  return Math.round((utc(b) - utc(a)) / 86_400_000);
}

/** 1 = Monday … 7 = Sunday. */
export function weekday(d: Day): number {
  const w = new Date(utc(d)).getUTCDay();
  return w === 0 ? 7 : w;
}

export function lastDayOfMonth(d: Day): Day {
  const [y, m] = parts(d);
  return fromUtc(Date.UTC(y, m, 0));
}

/** The local day of a timestamp in `timeZone` (an IANA name). */
export function dayOf(at: number, timeZone: string): Day {
  return Temporal.Instant.fromEpochMilliseconds(at).toZonedDateTimeISO(timeZone).toPlainDate().toString();
}

export function toPlainDate(d: Day): Temporal.PlainDate {
  return Temporal.PlainDate.from(d);
}

/** "today", "tomorrow", "in 5 days", "yesterday", "3 days ago". */
export function relativeDay(d: Day, today: Day): string {
  const n = diffDays(today, d);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** "Fri, Nov 6" in the given locale. */
export function formatDay(d: Day, locale = 'en-US', opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }): string {
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(new Date(utc(d) + 12 * 3_600_000));
}
