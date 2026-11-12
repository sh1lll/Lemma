import { Temporal } from 'temporal-polyfill';

export type DateOrder = 'mdy' | 'dmy';

export interface DateCtx {
  today: Temporal.PlainDate;
  dateOrder: DateOrder;
}

export interface ParsedDate {
  date: Temporal.PlainDate;
  notes: string[];
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

export const WEEKDAYS: Record<string, number> = {
  monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6, sunday: 7, sun: 7,
};
const WEEKDAY_RE = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).join('|');

/** Anonymous Gregorian algorithm (Meeus/Jones/Butcher). */
export function easter(year: number): Temporal.PlainDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Temporal.PlainDate.from({ year, month, day });
}

function nthWeekday(year: number, month: number, weekday: number, n: number): Temporal.PlainDate {
  const first = Temporal.PlainDate.from({ year, month, day: 1 });
  const offset = (weekday - first.dayOfWeek + 7) % 7;
  return first.add({ days: offset + 7 * (n - 1) });
}

function lastWeekday(year: number, month: number, weekday: number): Temporal.PlainDate {
  const last = Temporal.PlainDate.from({ year, month, day: 1 }).add({ months: 1 }).subtract({ days: 1 });
  return last.subtract({ days: (last.dayOfWeek - weekday + 7) % 7 });
}

const HOLIDAYS: { re: RegExp; name: string; on: (y: number) => Temporal.PlainDate; note?: string }[] = [
  { re: /^christmas eve$/, name: 'Christmas Eve', on: (y) => Temporal.PlainDate.from({ year: y, month: 12, day: 24 }) },
  { re: /^(?:christmas|xmas)(?: day)?$/, name: 'Christmas', on: (y) => Temporal.PlainDate.from({ year: y, month: 12, day: 25 }) },
  { re: /^new year'?s eve$/, name: "New Year's Eve", on: (y) => Temporal.PlainDate.from({ year: y, month: 12, day: 31 }) },
  { re: /^(?:new year'?s?(?: day)?|the new year)$/, name: "New Year's Day", on: (y) => Temporal.PlainDate.from({ year: y, month: 1, day: 1 }) },
  { re: /^halloween$/, name: 'Halloween', on: (y) => Temporal.PlainDate.from({ year: y, month: 10, day: 31 }) },
  { re: /^valentine'?s?(?: day)?$/, name: "Valentine's Day", on: (y) => Temporal.PlainDate.from({ year: y, month: 2, day: 14 }) },
  { re: /^(?:st\.? )?patrick'?s day$/, name: "St Patrick's Day", on: (y) => Temporal.PlainDate.from({ year: y, month: 3, day: 17 }) },
  { re: /^(?:independence day|(?:the )?fourth of july|july 4th)$/, name: 'Independence Day (US)', on: (y) => Temporal.PlainDate.from({ year: y, month: 7, day: 4 }) },
  { re: /^thanksgiving$/, name: 'Thanksgiving (US)', on: (y) => nthWeekday(y, 11, 4, 4), note: 'US Thanksgiving: fourth Thursday of November' },
  { re: /^mother'?s day$/, name: "Mother's Day (US)", on: (y) => nthWeekday(y, 5, 7, 2), note: "US Mother's Day: second Sunday of May" },
  { re: /^father'?s day$/, name: "Father's Day (US)", on: (y) => nthWeekday(y, 6, 7, 3), note: "US Father's Day: third Sunday of June" },
  { re: /^memorial day$/, name: 'Memorial Day (US)', on: (y) => lastWeekday(y, 5, 1) },
  { re: /^labou?r day$/, name: 'Labor Day (US)', on: (y) => nthWeekday(y, 9, 1, 1), note: 'US Labor Day: first Monday of September' },
  { re: /^easter(?: sunday)?$/, name: 'Easter Sunday', on: easter, note: 'Western (Gregorian) Easter' },
  { re: /^good friday$/, name: 'Good Friday', on: (y) => easter(y).subtract({ days: 2 }), note: 'Western (Gregorian) Easter' },
  { re: /^easter monday$/, name: 'Easter Monday', on: (y) => easter(y).add({ days: 1 }), note: 'Western (Gregorian) Easter' },
  { re: /^boxing day$/, name: 'Boxing Day', on: (y) => Temporal.PlainDate.from({ year: y, month: 12, day: 26 }) },
  { re: /^juneteenth$/, name: 'Juneteenth', on: (y) => Temporal.PlainDate.from({ year: y, month: 6, day: 19 }) },
  { re: /^canada day$/, name: 'Canada Day', on: (y) => Temporal.PlainDate.from({ year: y, month: 7, day: 1 }) },
  { re: /^bastille day$/, name: 'Bastille Day', on: (y) => Temporal.PlainDate.from({ year: y, month: 7, day: 14 }) },
  { re: /^australia day$/, name: 'Australia Day', on: (y) => Temporal.PlainDate.from({ year: y, month: 1, day: 26 }) },
  { re: /^anzac day$/, name: 'Anzac Day', on: (y) => Temporal.PlainDate.from({ year: y, month: 4, day: 25 }) },
  { re: /^(?:veterans|remembrance|armistice) day$/, name: 'Veterans/Remembrance Day', on: (y) => Temporal.PlainDate.from({ year: y, month: 11, day: 11 }) },
  { re: /^(?:mlk|martin luther king(?: jr\.?)?) day$/, name: 'Martin Luther King Jr. Day (US)', on: (y) => nthWeekday(y, 1, 1, 3) },
  { re: /^(?:presidents'?|washington'?s birthday)(?: day)?$/, name: "Presidents' Day (US)", on: (y) => nthWeekday(y, 2, 1, 3) },
  { re: /^columbus day$/, name: 'Columbus Day (US)', on: (y) => nthWeekday(y, 10, 1, 2) },
];

const pad = (n: number) => String(n).padStart(2, '0');

function make(year: number, month: number, day: number): Temporal.PlainDate | null {
  try {
    return Temporal.PlainDate.from({ year, month, day }, { overflow: 'reject' });
  } catch {
    return null;
  }
}

/** Two-digit years: 2000s by default; for dates in the past (birthdays, "since") a year that would be in the future means 1900s. */
const fullYear = (y: string, today: Temporal.PlainDate, prefer: 'future' | 'current' | 'past') => {
  if (y.length !== 2) return Number(y);
  const y2000 = 2000 + Number(y);
  return prefer === 'past' && y2000 > today.year ? y2000 - 100 : y2000;
};

/**
 * Parses a single calendar date. `prefer: 'future'` resolves a yearless date ("dec 25", "christmas")
 * to its next occurrence; `'current'` to this year.
 */
export function parseDate(raw: string, ctx: DateCtx, prefer: 'future' | 'current' | 'past' = 'current'): ParsedDate | null {
  const text = raw.trim().replace(/^(?:on|the)\s+/, '').replace(/[,.]+$/, '').replace(/\s+/g, ' ');
  const { today } = ctx;
  const notes: string[] = [];

  const relative: Record<string, number> = { today: 0, now: 0, tomorrow: 1, yesterday: -1, 'day after tomorrow': 2, 'the day after tomorrow': 2, 'day before yesterday': -2 };
  if (text in relative) return { date: today.add({ days: relative[text]! }), notes };

  let m = new RegExp(`^(next|this|last|coming)? ?(${WEEKDAY_RE})$`).exec(text);
  if (m) {
    const wd = WEEKDAYS[m[2]!]!;
    const diff = (wd - today.dayOfWeek + 7) % 7;
    if (m[1] === 'last') return { date: today.subtract({ days: (today.dayOfWeek - wd + 7) % 7 || 7 }), notes };
    // "next friday" on a Friday means a week out; bare "friday" means the upcoming one.
    const days = m[1] === 'next' ? diff || 7 : diff;
    return { date: today.add({ days }), notes };
  }

  m = /^(next|last|this) (week|month|year)$/.exec(text);
  if (m) {
    const sign = m[1] === 'next' ? 1 : m[1] === 'last' ? -1 : 0;
    return { date: today.add({ [`${m[2]}s`]: sign }), notes };
  }

  // "last christmas", "next easter", "this thanksgiving".
  const rel = /^(last|this|next|coming) (.+)$/.exec(text);
  if (rel) {
    const h = HOLIDAYS.find((x) => x.re.test(rel[2]!));
    if (h) {
      if (h.note) notes.push(h.note);
      let d = h.on(today.year);
      if (rel[1] === 'last' && Temporal.PlainDate.compare(d, today) >= 0) d = h.on(today.year - 1);
      if ((rel[1] === 'next' || rel[1] === 'coming') && Temporal.PlainDate.compare(d, today) <= 0) d = h.on(today.year + 1);
      return { date: d, notes };
    }
  }

  // Holidays, optionally with a year.
  const hy = /^(.+?)(?: (\d{4}))?$/.exec(text)!;
  for (const h of HOLIDAYS) {
    if (!h.re.test(hy[1]!)) continue;
    if (h.note) notes.push(h.note);
    if (hy[2]) return { date: h.on(Number(hy[2])), notes };
    let d = h.on(today.year);
    if (prefer === 'future' && Temporal.PlainDate.compare(d, today) < 0) d = h.on(today.year + 1);
    if (prefer === 'past' && Temporal.PlainDate.compare(d, today) > 0) d = h.on(today.year - 1);
    return { date: d, notes };
  }

  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (m) {
    const d = make(Number(m[1]), Number(m[2]), Number(m[3]));
    return d ? { date: d, notes } : null;
  }

  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(text);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    let [month, day] = ctx.dateOrder === 'mdy' ? [a, b] : [b, a];
    // If the preferred reading is impossible but the other one works (13/4), use it and say so.
    if (month > 12 && day <= 12) {
      [month, day] = [day, month];
      notes.push(`Read ${text} as day/month`);
    } else if (a <= 12 && b <= 12 && a !== b) {
      notes.push(`Read ${text} as ${ctx.dateOrder === 'mdy' ? 'month/day' : 'day/month'}`);
    }
    const year = m[3] ? fullYear(m[3], today, prefer) : today.year;
    let d = make(year, month, day);
    if (d && !m[3]) d = bump(d, today, prefer);
    return d ? { date: d, notes } : null;
  }

  // "december 25", "dec 25th 2027", "25 december", "25th of dec, 2027", "december 2027".
  m = new RegExp(`^(${MONTH_RE})\\.? (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?$`).exec(text) ??
    new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)? (?:of )?(${MONTH_RE})\\.?(?:,? (\\d{4}))?$`).exec(text);
  if (m) {
    const monthFirst = /^[a-z]/.test(m[1]!);
    const month = MONTHS[monthFirst ? m[1]! : m[2]!]!;
    const day = Number(monthFirst ? m[2] : m[1]);
    let d = make(m[3] ? Number(m[3]) : today.year, month, day);
    if (d && !m[3]) d = bump(d, today, prefer);
    return d ? { date: d, notes } : null;
  }

  m = new RegExp(`^(${MONTH_RE}) (\\d{4})$`).exec(text);
  if (m) {
    notes.push(`Taken as the 1st of the month`);
    return { date: Temporal.PlainDate.from({ year: Number(m[2]), month: MONTHS[m[1]!]!, day: 1 }), notes };
  }

  return null;
}

function bump(d: Temporal.PlainDate, today: Temporal.PlainDate, prefer: 'future' | 'current' | 'past'): Temporal.PlainDate {
  if (prefer === 'future' && Temporal.PlainDate.compare(d, today) < 0) return d.add({ years: 1 });
  if (prefer === 'past' && Temporal.PlainDate.compare(d, today) > 0) return d.subtract({ years: 1 });
  return d;
}

export interface ParsedTime {
  hour: number;
  minute: number;
}

/** "3pm", "3:30 pm", "15:30", "noon", "midnight". */
export function parseTime(raw: string): ParsedTime | null {
  const t = raw.trim().replace(/\./g, '');
  if (t === 'noon' || t === 'midday') return { hour: 12, minute: 0 };
  if (t === 'midnight') return { hour: 0, minute: 0 };
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/.exec(t);
  if (!m || (!m[2] && !m[3])) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  const ap = m[3]?.[0];
  if (minute > 59 || hour > 23 || (ap && (hour < 1 || hour > 12))) return null;
  if (ap === 'p' && hour !== 12) hour += 12;
  if (ap === 'a' && hour === 12) hour = 0;
  return { hour, minute };
}

export const iso = (d: Temporal.PlainDate) => `${d.year}-${pad(d.month)}-${pad(d.day)}`;
