import { D, MathError, type Answer, type AnswerResult } from '@lemma/math-core';
import { Temporal } from 'temporal-polyfill';
import { iso, parseDate, parseTime, type DateCtx, type DateOrder } from './parse';
import { resolveZone } from './zones';
import { COUNTRIES, COUNTRY_RE, findCountry, holidaysIn, holidaysOn, isBusinessDay, movedFrom, type CountryCode, type Holiday } from './holidays';

export { Temporal, iso, parseDate, parseTime, resolveZone, type DateOrder };
export { COUNTRIES, findCountry, holidaysIn, holidaysOn, isBusinessDay, type CountryCode, type Holiday } from './holidays';

export interface DateEngineContext {
  now: Temporal.ZonedDateTime;
  dateOrder: DateOrder;
  locale: string;
}

export function systemContext(locale = typeof navigator !== 'undefined' ? navigator.language : 'en-US'): DateEngineContext {
  // US, Philippines, and a few others write month first; most of the world writes day first.
  const mdy = /^(en-US|en-PH|en-CA|es-US|en)$/i.test(locale);
  return { now: Temporal.Now.zonedDateTimeISO(), dateOrder: mdy ? 'mdy' : 'dmy', locale };
}

type Handler = (s: string, c: Ctx) => AnswerResult | null;

interface Ctx extends DateEngineContext, DateCtx {
  input: string;
  /** Business-day questions that name a country exclude its public holidays. */
  country?: CountryCode;
  countryNote?: string;
}

const UNIT = String.raw`(days?|weeks?|months?|years?|business days?|working days?|weekdays?|hours?|minutes?|mins?|seconds?|secs?)`;

// ---------- formatting ----------
function utcNoon(d: Temporal.PlainDate): Date {
  return new Date(Date.UTC(d.year, d.month - 1, d.day, 12));
}

function fmtDate(d: Temporal.PlainDate, c: Ctx, style: 'long' | 'short' = 'long'): string {
  return new Intl.DateTimeFormat(c.locale, {
    weekday: style === 'long' ? 'long' : 'short',
    year: 'numeric',
    month: style === 'long' ? 'long' : 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(utcNoon(d));
}

function fmtTime(z: Temporal.ZonedDateTime, c: Ctx, withDay: boolean): string {
  return new Intl.DateTimeFormat(c.locale, {
    hour: 'numeric',
    minute: '2-digit',
    ...(withDay ? { weekday: 'short', month: 'short', day: 'numeric' } : {}),
    timeZone: z.timeZoneId,
  }).format(new Date(z.epochMilliseconds));
}

const plural = (n: number, unit: string) => `${n.toLocaleString('en-US')} ${unit}${Math.abs(n) === 1 ? '' : 's'}`;

function breakdown(dur: Temporal.Duration): string {
  const parts: string[] = [];
  if (dur.years) parts.push(plural(Math.abs(dur.years), 'year'));
  if (dur.months) parts.push(plural(Math.abs(dur.months), 'month'));
  if (dur.weeks) parts.push(plural(Math.abs(dur.weeks), 'week'));
  if (dur.days) parts.push(plural(Math.abs(dur.days), 'day'));
  if (dur.hours) parts.push(plural(Math.abs(dur.hours), 'hour'));
  if (dur.minutes) parts.push(plural(Math.abs(dur.minutes), 'minute'));
  return parts.join(', ') || '0 days';
}

function answer(c: Ctx, a: Omit<Answer, 'ok' | 'input' | 'notes'> & { notes?: string[] }): Answer {
  return { ok: true, input: c.input, notes: [], ...a };
}

function fail(c: Ctx, kind: string, message: string): AnswerResult {
  return { ok: false, kind, input: c.input, error: new MathError('domain', message) };
}

/** Weekday holidays of `country` in (from, to]. */
function holidaysBetween(country: CountryCode, from: Temporal.PlainDate, to: Temporal.PlainDate): Holiday[] {
  const out: Holiday[] = [];
  for (let y = from.year; y <= to.year; y++) {
    for (const h of holidaysIn(country, y)) {
      if (h.date.dayOfWeek <= 5 && Temporal.PlainDate.compare(h.date, from) > 0 && Temporal.PlainDate.compare(h.date, to) <= 0) out.push(h);
    }
  }
  return out;
}

function businessDaysBetween(a: Temporal.PlainDate, b: Temporal.PlainDate, country?: CountryCode): number {
  if (country) {
    const sign = Temporal.PlainDate.compare(b, a) >= 0 ? 1 : -1;
    const [from, to] = sign > 0 ? [a, b] : [b, a];
    return sign * (Math.abs(businessDaysBetween(a, b)) - holidaysBetween(country, from, to).length);
  }
  // Counts weekdays after `a` up to and including `b` (so Mon→Fri is 4).
  const sign = Temporal.PlainDate.compare(b, a) >= 0 ? 1 : -1;
  const [from, to] = sign > 0 ? [a, b] : [b, a];
  const total = from.until(to).days;
  const weeks = Math.floor(total / 7);
  let count = weeks * 5;
  let d = from.add({ days: weeks * 7 });
  while (Temporal.PlainDate.compare(d, to) < 0) {
    d = d.add({ days: 1 });
    if (d.dayOfWeek <= 5) count++;
  }
  return sign * count;
}

function addBusinessDays(d: Temporal.PlainDate, n: number, country?: CountryCode): Temporal.PlainDate {
  const step = n >= 0 ? 1 : -1;
  let left = Math.abs(n);
  if (left > 100_000) throw new RangeError('That is too many business days to count');
  while (left > 0) {
    d = d.add({ days: step });
    if (isBusinessDay(country ?? null, d)) left--;
  }
  return d;
}

const normUnit = (u: string) =>
  u.startsWith('business') || u.startsWith('working') || u.startsWith('weekday')
    ? 'business'
    : u.startsWith('min')
      ? 'minute'
      : u.startsWith('sec')
        ? 'second'
        : u.replace(/s$/, '');

// ---------- handlers ----------
const leapYear: Handler = (s, c) => {
  const m = /^(?:is )?(\d{4}) (?:a )?leap year$|^leap year (\d{4})$/.exec(s) ?? (/^is (?:this|it) a leap year$/.test(s) ? ['', String(c.today.year)] : null);
  if (!m) return null;
  const y = Number(m[1] ?? m[2]);
  const leap = Temporal.PlainDate.from({ year: y, month: 1, day: 1 }).inLeapYear;
  return answer(c, {
    kind: 'date',
    expression: `Is ${y} a leap year?`,
    primary: { display: leap ? 'Yes' : 'No', plain: leap ? 'yes' : 'no', spoken: `${y} is ${leap ? '' : 'not '}a leap year` },
    lines: [{ label: 'Days in year', display: leap ? '366' : '365' }],
    notes: [`Divisible by 4, except centuries not divisible by 400`],
  });
};

const unix: Handler = (s, c) => {
  if (/^(?:current |now in )?(?:unix|epoch)(?: time| timestamp)?(?: now)?$|^(?:current )?timestamp$/.test(s)) {
    const sec = Math.floor(c.now.epochMilliseconds / 1000);
    return answer(c, {
      kind: 'date',
      expression: 'Unix time now',
      primary: { display: String(sec), plain: String(sec), spoken: String(sec) },
      value: new D(sec),
      lines: [{ label: 'Milliseconds', display: String(c.now.epochMilliseconds) }],
      notes: ['Seconds since 1970-01-01 00:00 UTC'],
    });
  }
  const m = /^(?:unix|epoch|timestamp) (\d{9,13})(?: to date)?$|^(\d{9,13}) (?:unix|epoch|timestamp)?(?: ?(?:to|in|as) date)?$/.exec(s);
  if (!m) {
    const back = /^(.+?) (?:to|in|as) (?:unix|epoch)(?: time| timestamp)?$/.exec(s);
    const d = back && parseDate(back[1]!, c);
    if (!d) return null;
    const sec = d.date.toZonedDateTime('UTC').epochMilliseconds / 1000;
    return answer(c, {
      kind: 'date',
      expression: `${iso(d.date)} 00:00 UTC → Unix time`,
      primary: { display: String(sec), plain: String(sec), spoken: String(sec) },
      value: new D(sec),
      notes: d.notes,
    });
  }
  const raw = m[1] ?? m[2]!;
  const ms = raw.length > 11 ? Number(raw) : Number(raw) * 1000;
  const inst = Temporal.Instant.fromEpochMilliseconds(ms);
  const local = inst.toZonedDateTimeISO(c.now.timeZoneId);
  return answer(c, {
    kind: 'date',
    expression: `Unix ${raw}${raw.length > 11 ? ' ms' : ''}`,
    primary: { display: fmtTime(local, c, true) + ` ${local.year}`, plain: local.toString({ timeZoneName: 'never' }), spoken: fmtTime(local, c, true) },
    lines: [
      { label: 'UTC', display: inst.toString() },
      { label: 'Local zone', display: c.now.timeZoneId },
    ],
  });
};

const timeIn: Handler = (s, c) => {
  let m = /^(?:what(?:'s| is)? )?(?:the )?(?:current )?time(?: is it)?(?: right now| now)? in (.+)$|^(.+?) time(?: now)?$|^now in (.+)$/.exec(s);
  if (m) {
    const z = resolveZone(m[1] ?? m[2] ?? m[3]!);
    if (!z) return null;
    const there = c.now.withTimeZone(z.zone);
    const dayDiff = there.toPlainDate().since(c.today).days;
    return answer(c, {
      kind: 'time',
      expression: `Time in ${z.label}`,
      primary: { display: fmtTime(there, c, false), plain: there.toPlainTime().toString({ smallestUnit: 'minute' }), spoken: `It's ${fmtTime(there, c, false)} in ${z.label}` },
      lines: [
        { label: 'Date', display: fmtDate(there.toPlainDate(), c) + (dayDiff ? ` (${dayDiff > 0 ? 'tomorrow' : 'yesterday'} here)` : '') },
        { label: 'UTC offset', display: there.offset },
        { label: 'Difference from you', display: offsetDiff(c.now, there) },
      ],
      notes: [z.note, `IANA zone ${there.timeZoneId}`].filter(Boolean) as string[],
    });
  }

  // "3pm new york to london", "9:30 am pst in ist", "3pm in tokyo" (from local).
  // The time is one explicit token ("9:30 am", "3pm", "15:30", "noon"), so "9:30 am pst" isn't split after "9:30".
  const TIME = String.raw`(?:\d{1,2}(?::\d\d)?\s?(?:am|pm|a|p)|\d{1,2}:\d\d|noon|midday|midnight)`;
  m = new RegExp(`^(${TIME}) (?:in |from )?(.+?) (?:to|in|into|for) (.+)$`).exec(s) ?? new RegExp(`^(${TIME}) (?:here |local(?: time)? )?(?:to|in) (.+)$`).exec(s);
  if (!m) return null;
  const time = parseTime(m[1]!);
  if (!time) return null;
  const fromZone = m.length === 4 && m[3] ? resolveZone(m[2]!) : { zone: c.now.timeZoneId, label: 'your time' };
  const toZone = resolveZone(m.length === 4 && m[3] ? m[3] : m[2]!);
  if (!fromZone || !toZone) return null;
  const start = c.now.withTimeZone(fromZone.zone).withPlainTime({ hour: time.hour, minute: time.minute });
  const there = start.withTimeZone(toZone.zone);
  const dayShift = there.toPlainDate().since(start.toPlainDate()).days;
  return answer(c, {
    kind: 'time',
    expression: `${fmtTime(start, c, false)} ${fromZone.label} → ${toZone.label}`,
    primary: {
      display: fmtTime(there, c, false) + (dayShift ? (dayShift > 0 ? ' (+1 day)' : ' (−1 day)') : ''),
      plain: there.toPlainTime().toString({ smallestUnit: 'minute' }),
      spoken: `${fmtTime(there, c, false)} in ${toZone.label}${dayShift ? (dayShift > 0 ? ', the next day' : ', the previous day') : ''}`,
    },
    lines: [
      { label: toZone.label, display: fmtTime(there, c, true) },
      { label: fromZone.label, display: fmtTime(start, c, true) },
      { label: 'Difference', display: offsetDiff(start, there) },
    ],
    notes: [fromZone.note, toZone.note, 'Uses today’s daylight-saving rules for both places'].filter(Boolean) as string[],
  });
};

function offsetDiff(a: Temporal.ZonedDateTime, b: Temporal.ZonedDateTime): string {
  const diff = (b.offsetNanoseconds - a.offsetNanoseconds) / 3.6e12;
  if (diff === 0) return 'Same time';
  const h = Math.trunc(Math.abs(diff));
  const mins = Math.round((Math.abs(diff) - h) * 60);
  return `${h}h${mins ? ` ${mins}m` : ''} ${diff > 0 ? 'ahead' : 'behind'}`;
}

const timeSpan: Handler = (s, c) => {
  const m = /^(?:how long|how many hours|hours|duration|time) (?:is it )?(?:from|between) (.+?) (?:to|and|until|till) (.+)$/.exec(s);
  if (!m) return null;
  const a = parseTime(m[1]!);
  const b = parseTime(m[2]!);
  if (!a || !b) return null;
  let mins = b.hour * 60 + b.minute - (a.hour * 60 + a.minute);
  const overnight = mins < 0;
  if (overnight) mins += 24 * 60;
  const h = Math.floor(mins / 60);
  const mm = mins % 60;
  return answer(c, {
    kind: 'time',
    expression: `${m[1]} → ${m[2]}`,
    primary: { display: `${h}h ${String(mm).padStart(2, '0')}m`, plain: (mins / 60).toFixed(4).replace(/\.?0+$/, ''), spoken: `${plural(h, 'hour')} ${mm ? `and ${plural(mm, 'minute')}` : ''}` },
    value: new D(mins).div(60),
    lines: [
      { label: 'Hours', display: (mins / 60).toFixed(2).replace(/\.?0+$/, '') },
      { label: 'Minutes', display: String(mins) },
    ],
    notes: overnight ? ['Ends the next day'] : [],
  });
};

const age: Handler = (s, c) => {
  const m = /^(?:how old (?:am i|is (?:someone|a person|he|she|they)|would i be|are you)|age|my age)(?: if| of)?(?: (?:i was|someone|a person))?(?: born)?(?: on| in)? (.+)$/.exec(s);
  if (!m) return null;
  const birth = parseDate(m[1]!, c, 'past');
  if (!birth) return null;
  if (Temporal.PlainDate.compare(birth.date, c.today) > 0) return fail(c, 'date', 'That birth date is in the future');
  const dur = birth.date.until(c.today, { largestUnit: 'years' });
  let next = birth.date.with({ year: c.today.year });
  if (Temporal.PlainDate.compare(next, c.today) < 0) next = next.add({ years: 1 });
  const toNext = c.today.until(next).days;
  return answer(c, {
    kind: 'date',
    expression: `Age, born ${fmtDate(birth.date, c, 'short')}`,
    primary: { display: plural(dur.years, 'year'), plain: String(dur.years), spoken: `${plural(dur.years, 'year')} old` },
    value: new D(dur.years),
    lines: [
      { label: 'Exactly', display: breakdown(dur) },
      { label: 'In days', display: birth.date.until(c.today).days.toLocaleString('en-US') },
      { label: 'Next birthday', display: toNext === 0 ? 'Today 🎂' : `${fmtDate(next, c, 'short')} · in ${plural(toNext, 'day')}` },
    ],
    notes: birth.notes,
  });
};

const weekNumber: Handler = (s, c) => {
  let m = /^(?:what )?(?:week number|week of (?:the )?year|week)(?: is (?:it|today))?(?: (?:of|for|is) (.+))?$/.exec(s);
  if (m && /week/.test(s) && (m[1] || /is (?:it|today)|^week number$|^what week/.test(s))) {
    const d = m[1] ? parseDate(m[1], c) : { date: c.today, notes: [] };
    if (!d) return null;
    return answer(c, {
      kind: 'date',
      expression: `ISO week of ${fmtDate(d.date, c, 'short')}`,
      primary: { display: `Week ${d.date.weekOfYear}`, plain: String(d.date.weekOfYear), spoken: `week ${d.date.weekOfYear}` },
      value: new D(d.date.weekOfYear!),
      lines: [{ label: 'ISO week-year', display: String(d.date.yearOfWeek) }],
      notes: [...d.notes, 'ISO 8601 weeks start on Monday; week 1 contains the year’s first Thursday'],
    });
  }
  m = /^(?:what )?day of (?:the )?year(?: is (?:it|today))?(?: (?:of|for|is) (.+))?$/.exec(s);
  if (!m) return null;
  const d = m[1] ? parseDate(m[1], c) : { date: c.today, notes: [] };
  if (!d) return null;
  return answer(c, {
    kind: 'date',
    expression: `Day of year, ${fmtDate(d.date, c, 'short')}`,
    primary: { display: `Day ${d.date.dayOfYear}`, plain: String(d.date.dayOfYear), spoken: `day ${d.date.dayOfYear}` },
    value: new D(d.date.dayOfYear),
    lines: [{ label: 'Days left in year', display: String(d.date.daysInYear - d.date.dayOfYear) }],
    notes: d.notes,
  });
};

const weekday: Handler = (s, c) => {
  const m = /^what day(?: of the week)? (?:is|was|will be|falls on|is it on) (.+)$|^(?:what weekday|which day) (?:is|was|will be) (.+)$|^(.+) is (?:a|on) what day$|^day of (?:the )?week (?:for |of )?(.+)$/.exec(s);
  if (!m) return null;
  const text = m[1] ?? m[2] ?? m[3] ?? m[4]!;
  if (/^(?:it|today)$/.test(text)) return today(s.replace(/.*/, 'today'), c);
  const d = parseDate(text, c);
  if (!d) return null;
  const name = new Intl.DateTimeFormat(c.locale, { weekday: 'long', timeZone: 'UTC' }).format(utcNoon(d.date));
  const rel = c.today.until(d.date).days;
  return answer(c, {
    kind: 'date',
    expression: `Weekday of ${iso(d.date)}`,
    primary: { display: name, plain: name, spoken: `${fmtDate(d.date, c)}` },
    lines: [
      { label: 'Date', display: fmtDate(d.date, c) },
      { label: rel >= 0 ? 'From today' : 'Ago', display: rel === 0 ? 'Today' : plural(Math.abs(rel), 'day') },
    ],
    notes: d.notes,
  });
};

function countBetween(c: Ctx, unitRaw: string | undefined, from: Temporal.PlainDate, to: Temporal.PlainDate, notes: string[], label: string): Answer {
  const unit = normUnit(unitRaw ?? 'days');
  const days = from.until(to).days;
  const dir = days < 0 ? -1 : 1;
  const lines: Answer['lines'] = [
    { label: 'From', display: fmtDate(from, c) },
    { label: 'To', display: fmtDate(to, c) },
  ];
  let display: string;
  let value: Temporal.Duration | number;
  switch (unit) {
    case 'business': {
      const n = businessDaysBetween(from, to, c.country);
      display = plural(Math.abs(n), 'business day');
      value = n;
      lines.push({ label: 'Calendar days', display: plural(Math.abs(days), 'day') });
      const [lo, hi] = days < 0 ? [to, from] : [from, to];
      if (c.country) {
        const info = COUNTRIES[c.country];
        const skipped = holidaysBetween(c.country, lo, hi);
        notes.push(`Mon–Fri, excluding ${info.noun} in ${info.name}`);
        if (c.countryNote) notes.push(c.countryNote);
        lines.push({ label: `${capital(info.noun)} skipped`, display: skipped.length ? skipped.map((h) => `${h.name} (${fmtShort(h.date, c)})`).join(', ') : 'None' });
      } else {
        notes.push('Mon–Fri only; public holidays are not excluded (add “in the US”, “in Germany”… to exclude them)');
        try {
          const us = holidaysBetween('US', lo, hi).length;
          if (us) lines.push({ label: 'Excluding US federal holidays', display: plural(Math.abs(n) - us, 'business day') });
        } catch {
          // Outside the US rules' years: nothing extra to show.
        }
      }
      break;
    }
    case 'week':
      display = plural(Math.abs(Math.trunc(days / 7)), 'week') + (days % 7 ? `, ${plural(Math.abs(days % 7), 'day')}` : '');
      value = days / 7;
      lines.push({ label: 'Days', display: plural(Math.abs(days), 'day') });
      break;
    case 'month':
    case 'year': {
      const dur = from.until(to, { largestUnit: unit === 'month' ? 'months' : 'years' });
      display = breakdown(dur);
      value = unit === 'month' ? dur.months : dur.years;
      lines.push({ label: 'Days', display: plural(Math.abs(days), 'day') });
      break;
    }
    case 'hour':
    case 'minute':
    case 'second': {
      const start = from.equals(c.today) ? c.now : from.toZonedDateTime(c.now.timeZoneId);
      const end = to.toZonedDateTime(c.now.timeZoneId);
      const total = start.until(end, { largestUnit: `${unit}s` as 'hours' })[`${unit}s` as 'hours'];
      display = plural(Math.abs(Math.round(total)), unit);
      value = Math.round(total);
      notes.push(`Counted to midnight at the start of ${iso(to)}, your time zone`);
      break;
    }
    default:
      display = plural(Math.abs(days), 'day');
      value = days;
      if (Math.abs(days) >= 14) lines.push({ label: 'That is', display: breakdown(from.until(to, { largestUnit: 'years' })) });
      lines.push({ label: 'Business days', display: String(Math.abs(businessDaysBetween(from, to))) });
  }
  if (dir < 0) notes.push('That date is in the past');
  return answer(c, {
    kind: 'date',
    expression: label,
    primary: { display, plain: String(typeof value === 'number' ? Math.abs(value) : value), spoken: display },
    value: typeof value === 'number' ? new D(Math.abs(value)).toDecimalPlaces(6) : undefined,
    lines,
    notes,
  });
}

const until: Handler = (s, c) => {
  let m = new RegExp(`^(?:how many )?(?:${UNIT} )?(?:are there |is it |left |remain(?:ing)? )?(?:until|till|til|to|before|left until) (.+)$`).exec(s);
  if (m && (m[1] || /^(?:how many |until|till|til)/.test(s))) {
    const target = m[2]!;
    const t = parseTime(target);
    if (t && (!m[1] || /hour|min|sec/.test(m[1]))) {
      let end = c.now.withPlainTime({ hour: t.hour, minute: t.minute });
      if (Temporal.ZonedDateTime.compare(end, c.now) <= 0) end = end.add({ days: 1 });
      const dur = c.now.until(end, { largestUnit: 'hours', smallestUnit: 'minute', roundingMode: 'halfExpand' });
      const mins = dur.hours * 60 + dur.minutes;
      // "how many seconds until 5pm" answers in seconds, "minutes until …" in minutes; otherwise hours and minutes.
      const asked = m[1] ? normUnit(m[1]) : '';
      const secs = Math.round(c.now.until(end, { largestUnit: 'seconds' }).seconds);
      const display = asked === 'second' ? plural(secs, 'second') : asked === 'minute' ? plural(mins, 'minute') : breakdown(dur);
      return answer(c, {
        kind: 'time',
        expression: `Until ${fmtTime(end, c, false)}`,
        primary: { display, plain: String(asked === 'second' ? secs : mins), spoken: display },
        value: new D(asked === 'second' ? secs : mins),
        lines: asked === 'second' ? [{ label: 'That is', display: breakdown(dur) }] : [{ label: 'Minutes', display: String(mins) }],
      });
    }
    const d = parseDate(target, c, 'future');
    if (!d) return null;
    return countBetween(c, m[1], c.today, d.date, d.notes, `${capital(m[1] ?? 'days')} until ${fmtDate(d.date, c, 'short')}`);
  }
  m = new RegExp(`^(?:how many )?(?:${UNIT} )?(?:has it been |have passed |since|ago was) ?(?:since )?(.+?)(?: ago)?$`).exec(s);
  if (m && /since/.test(s)) {
    const d = parseDate(m[2]!, c, 'past');
    if (!d) return null;
    return countBetween(c, m[1], d.date, c.today, d.notes, `${capital(m[1] ?? 'days')} since ${fmtDate(d.date, c, 'short')}`);
  }
  m = new RegExp(`^(?:how many )?(?:${UNIT} )?(?:are there )?(?:between|from) (.+?) (?:and|to|until|till) (.+)$`).exec(s);
  if (m) {
    const a = parseDate(m[2]!, c);
    const b = a && parseDate(m[3]!, c);
    if (!a || !b) return null;
    // "dec 20 to jan 5" without years: the end follows the start.
    let end = b.date;
    if (!/\d{4}/.test(m[3]!) && Temporal.PlainDate.compare(end, a.date) < 0 && !/\d{4}/.test(m[2]!)) end = end.add({ years: 1 });
    return countBetween(c, m[1], a.date, end, [...a.notes, ...b.notes], `${capital(m[1] ?? 'days')} between ${fmtDate(a.date, c, 'short')} and ${fmtDate(end, c, 'short')}`);
  }
  return null;
};

const capital = (s: string) => s[0]!.toUpperCase() + s.slice(1);

const arithmetic: Handler = (s, c) => {
  let base: Temporal.PlainDate | null = null;
  let n = 0;
  let unit = '';
  let notes: string[] = [];
  // "what date is 100 days from now", "what is the date 90 days ago", "when is 3 weeks from today".
  s = s.replace(/^(?:what(?:'s| is) the date|what date (?:is|was|will it be)|when is|when was) (?=\d|an? )/, '');
  let m = new RegExp(`^(?:what(?:'s| is) )?(?:the date )?(\\d+|a|an|one) ${UNIT} (from|after|before|since) (.+)$`).exec(s);
  if (m) {
    const d = parseDate(m[4]!.replace(/^now$/, 'today'), c);
    if (!d) return null;
    base = d.date;
    notes = d.notes;
    n = Number(/^\d/.test(m[1]!) ? m[1] : 1) * (m[3] === 'before' ? -1 : 1);
    unit = m[2]!;
  }
  if (!m) {
    m = new RegExp(`^(?:in )(\\d+|a|an|one) ${UNIT}$|^(\\d+|a|an|one) ${UNIT} (ago|from now|from today|later|hence)$`).exec(s);
    if (m) {
      base = c.today;
      const count = m[1] ?? m[3]!;
      n = Number(/^\d/.test(count) ? count : 1) * (m[5] === 'ago' ? -1 : 1);
      unit = m[2] ?? m[4]!;
    }
  }
  if (!m) {
    m = new RegExp(`^(.+?) (plus|\\+|minus|-|add|subtract) (\\d+) ${UNIT}$`).exec(s);
    if (m) {
      const d = parseDate(m[1]!, c);
      if (!d) return null;
      base = d.date;
      notes = d.notes;
      n = Number(m[3]) * (m[2] === 'minus' || m[2] === '-' || m[2] === 'subtract' ? -1 : 1);
      unit = m[4]!;
    }
  }
  if (!m || !base) return null;
  const u = normUnit(unit);
  if (u === 'hour' || u === 'minute' || u === 'second') {
    const start = base.equals(c.today) ? c.now : base.toZonedDateTime(c.now.timeZoneId);
    const end = start.add({ [`${u}s`]: n });
    return answer(c, {
      kind: 'time',
      expression: `${fmtTime(start, c, true)} ${n < 0 ? '−' : '+'} ${plural(Math.abs(n), u)}`,
      primary: { display: fmtTime(end, c, !end.toPlainDate().equals(start.toPlainDate())), plain: end.toString({ timeZoneName: 'never', smallestUnit: 'minute' }), spoken: fmtTime(end, c, true) },
      notes,
    });
  }
  const result = u === 'business' ? addBusinessDays(base, n, c.country) : base.add({ [`${u}s`]: n });
  if ((u === 'month' || u === 'year') && result.day !== base.day) notes.push(`${base.day} doesn’t exist in that month, so it lands on the last day`);
  if (u === 'business') {
    if (c.country) notes.push(`Skips weekends and ${COUNTRIES[c.country].noun} in ${COUNTRIES[c.country].name}`, ...(c.countryNote ? [c.countryNote] : []));
    else notes.push('Skips weekends; public holidays are not skipped (add “in the US”, “in the UK”… to skip them)');
  }
  return answer(c, {
    kind: 'date',
    expression: `${fmtDate(base, c, 'short')} ${n < 0 ? '−' : '+'} ${plural(Math.abs(n), u === 'business' ? 'business day' : u)}`,
    primary: { display: fmtDate(result, c), plain: iso(result), spoken: fmtDate(result, c) },
    lines: [{ label: 'From today', display: (() => { const k = c.today.until(result).days; return k === 0 ? 'Today' : `${plural(Math.abs(k), 'day')} ${k > 0 ? 'ahead' : 'ago'}`; })() }],
    notes,
  });
};

const today: Handler = (s, c) => {
  if (!/^(?:what(?:'s| is) )?(?:the |today'?s )?(?:date|day)(?: today| is it| is it today)?$|^today$|^what day is it$|^(?:what(?:'s| is) )?today$/.test(s)) return null;
  return answer(c, {
    kind: 'date',
    expression: 'Today',
    primary: { display: fmtDate(c.today, c), plain: iso(c.today), spoken: fmtDate(c.today, c) },
    lines: [
      { label: 'ISO week', display: String(c.today.weekOfYear) },
      { label: 'Day of year', display: String(c.today.dayOfYear) },
      { label: 'Time zone', display: c.now.timeZoneId },
    ],
  });
};

/** "what time is it", "current time", "time now": the local clock (with "in <place>" it is {@link timeIn}). */
const localTime: Handler = (s, c) => {
  if (!/^(?:what(?:'s| is) )?(?:the )?(?:current |local )?time(?: is it)?(?: (?:right )?now| here)?$|^what time is it(?: (?:right )?now| here)?$/.test(s)) return null;
  return answer(c, {
    kind: 'time',
    expression: 'Time now',
    primary: { display: fmtTime(c.now, c, false), plain: c.now.toPlainTime().toString({ smallestUnit: 'minute' }), spoken: `It's ${fmtTime(c.now, c, false)}` },
    lines: [
      { label: 'Date', display: fmtDate(c.today, c) },
      { label: 'Time zone', display: c.now.timeZoneId },
      { label: 'UTC offset', display: c.now.offset },
    ],
  });
};

// ---------- public holidays ----------
const fmtShort = (d: Temporal.PlainDate, c: Ctx) =>
  new Intl.DateTimeFormat(c.locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(utcNoon(d));

const HOLIDAY_WORD = String.raw`(?:public |bank |federal |national |statutory |official |legal )*holidays?`;

/** Pulls "in the UK" / "UK" / "german" out of a holiday question. Default: the US. */
function takeCountry(s: string): { rest: string; code: CountryCode; note?: string; named: boolean } | null {
  const m = new RegExp(`(?:^| )(?:in|for|of) (${COUNTRY_RE})(?= |$)`).exec(s) ?? new RegExp(`(?:^| )(${COUNTRY_RE}) (?=${HOLIDAY_WORD}|business|working)`).exec(s);
  if (!m) return { rest: s, code: 'US', named: false };
  const found = findCountry(m[1]!.replace(/^the /, ''));
  if (!found) return null;
  return { rest: (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim(), code: found.code, note: found.note, named: true };
}

function holidayRows(list: Holiday[], c: Ctx): string[][] {
  return list.map((h) => [fmtShort(h.date, c), h.name + (h.actual ? ` · falls on ${fmtShort(h.actual, c)}` : '')]);
}

const holidayList: Handler = (s, c) => {
  if (!/\bholidays\b/.test(s) || /^is |^are |\bnext (?:\w+ )?holiday|\bbusiness\b|\bworking\b|\buntil\b|\bbetween\b/.test(s)) return null;
  const k = takeCountry(s);
  if (!k) return null;
  let rest = k.rest;
  let year = c.today.year;
  const ym = /\b(1[89]\d\d|20\d\d)\b/.exec(rest);
  if (ym) {
    year = Number(ym[1]);
    rest = rest.replace(ym[0], ' ');
  } else if (/\bnext year\b/.test(rest)) {
    year++;
    rest = rest.replace('next year', ' ');
  } else if (/\blast year\b/.test(rest)) {
    year--;
    rest = rest.replace('last year', ' ');
  }
  const leftover = rest
    .replace(/\b(?:what|which|are|the|list|show|me|all|this|year|calendar|days|off|when|how|many|there|of|in|for|during|is|a|give|tell)\b/g, ' ')
    .replace(new RegExp(HOLIDAY_WORD, 'g'), ' ')
    .trim();
  if (leftover) return null;
  const info = COUNTRIES[k.code];
  let list: Holiday[];
  try {
    list = holidaysIn(k.code, year);
  } catch (e) {
    return fail(c, 'holiday', e instanceof Error ? e.message : String(e));
  }
  const upcoming = list.findIndex((h) => Temporal.PlainDate.compare(h.date, c.today) >= 0);
  return answer(c, {
    kind: 'holiday',
    expression: `${capital(info.noun)} in ${info.name}, ${year}`,
    primary: { display: `${list.length} ${list.length === 1 ? info.noun.replace(/s$/, '') : info.noun}`, plain: String(list.length), spoken: `${list.length} ${info.noun} in ${year}` },
    value: new D(list.length),
    table: { columns: ['Date', 'Holiday'], rows: holidayRows(list, c), caption: `${capital(info.noun)}, ${info.name} ${year}`, highlightRow: year === c.today.year && upcoming >= 0 ? upcoming : undefined },
    notes: [info.scope, ...(k.note ? [k.note] : []), ...(!k.named ? ['Showing US federal holidays; name a country for others (“holidays in Japan”)'] : [])],
  });
};

const isHoliday: Handler = (s, c) => {
  const m = new RegExp(`^is (.+?) (?:a |an )?${HOLIDAY_WORD}(.*)$`).exec(s);
  if (!m) return null;
  const k = takeCountry(`${m[1]} ${m[2]!.trim()}`.trim());
  if (!k) return null;
  const d = parseDate(k.rest.replace(/^(?:on )/, ''), c, 'future');
  if (!d) return null;
  const info = COUNTRIES[k.code];
  let on: Holiday[];
  let moved: Holiday[];
  try {
    on = holidaysOn(k.code, d.date);
    moved = movedFrom(k.code, d.date);
  } catch (e) {
    return fail(c, 'holiday', e instanceof Error ? e.message : String(e));
  }
  const where = `${info.name}`;
  const notes = [...d.notes, info.scope, ...(k.note ? [k.note] : []), ...(!k.named ? ['Checked against US federal holidays; name a country for others (“… in Canada”)'] : [])];
  const lines: Answer['lines'] = [{ label: 'Date', display: fmtDate(d.date, c) }];
  let display: string;
  let spoken: string;
  if (on.length) {
    const h = on[0]!;
    display = `Yes · ${h.name}`;
    spoken = `Yes, ${fmtDate(d.date, c)} is ${h.name} in ${where}`;
    if (h.actual) lines.push({ label: 'Holiday’s own date', display: fmtDate(h.actual, c) });
  } else if (moved.length) {
    const h = moved[0]!;
    const base = h.name.replace(/ \((?:observed|substitute day)\)$/, '').replace(/^振替休日 Substitute holiday \(for (.+)\)$/, '$1');
    display = `Yes · ${base}, observed ${fmtShort(h.date, c)}`;
    spoken = `It's ${base}, but it falls on a ${new Intl.DateTimeFormat(c.locale, { weekday: 'long', timeZone: 'UTC' }).format(utcNoon(d.date))}, so the day off is ${fmtDate(h.date, c)}`;
    lines.push({ label: 'Day off (observed)', display: fmtDate(h.date, c) });
    notes.unshift(`${base} falls on a weekend, so the day off moves to ${fmtDate(h.date, c)}`);
  } else {
    display = 'No';
    spoken = `No, ${fmtDate(d.date, c)} isn't one of the ${info.noun} in ${where}`;
    if (d.date.dayOfWeek >= 6) lines.push({ label: 'But', display: `It’s a ${d.date.dayOfWeek === 6 ? 'Saturday' : 'Sunday'}` });
    const next = nextHoliday(k.code, d.date);
    if (next) lines.push({ label: 'Next holiday', display: `${next.name} · ${fmtDate(next.date, c)}` });
  }
  return answer(c, {
    kind: 'holiday',
    expression: `Is ${fmtShort(d.date, c)} ${d.date.year} a holiday in ${where}?`,
    primary: { display, plain: on.length || moved.length ? 'yes' : 'no', spoken },
    lines,
    notes,
  });
};

function nextHoliday(code: CountryCode, after: Temporal.PlainDate): Holiday | null {
  for (let y = after.year; y <= after.year + 1; y++) {
    const h = holidaysIn(code, y).find((x) => Temporal.PlainDate.compare(x.date, after) > 0);
    if (h) return h;
  }
  return null;
}

const nextHolidayHandler: Handler = (s, c) => {
  if (!new RegExp(`\\bnext ${HOLIDAY_WORD}\\b`).test(s)) return null;
  const k = takeCountry(s);
  if (!k) return null;
  const left = k.rest
    .replace(new RegExp(`next ${HOLIDAY_WORD}`), ' ')
    .replace(/\b(?:when|what|is|the|whats|what's|days?|until|till|how|many|to|left)\b/g, ' ')
    .trim();
  if (left) return null;
  let h: Holiday | null;
  try {
    h = nextHoliday(k.code, c.today.subtract({ days: 1 }));
  } catch (e) {
    return fail(c, 'holiday', e instanceof Error ? e.message : String(e));
  }
  if (!h) return fail(c, 'holiday', 'No upcoming holiday found');
  const info = COUNTRIES[k.code];
  const n = c.today.until(h.date).days;
  return answer(c, {
    kind: 'holiday',
    expression: `Next ${info.noun.replace(/s$/, '')} in ${info.name}`,
    primary: { display: `${h.name} · ${fmtShort(h.date, c)}`, plain: iso(h.date), spoken: `${h.name}, ${fmtDate(h.date, c)}${n ? `, in ${plural(n, 'day')}` : ', today'}` },
    lines: [
      { label: 'Date', display: fmtDate(h.date, c) },
      { label: 'From today', display: n === 0 ? 'Today' : plural(n, 'day') },
      ...(h.actual ? [{ label: 'Holiday’s own date', display: fmtDate(h.actual, c) }] : []),
    ],
    notes: [info.scope, ...(k.note ? [k.note] : []), ...(!k.named ? ['US federal holidays; name a country for others'] : [])],
  });
};

const HANDLERS: Handler[] = [leapYear, unix, timeSpan, localTime, holidayList, nextHolidayHandler, isHoliday, timeIn, age, weekNumber, weekday, until, arithmetic, today];

/** Answers date and time questions, or returns null when the input isn't one. */
export function answerDate(input: string, ctx: DateEngineContext = systemContext()): AnswerResult | null {
  let s = input
    .toLowerCase()
    .trim()
    .replace(/[’]/g, "'")
    .replace(/[?!]+$|\.$/, '')
    .replace(/\s+/g, ' ')
    .replace(/^(?:hey |ok |okay |so |please |tell me |calculate |compute |can you tell me )+/, '')
    .replace(/^(?:what(?:'s| is) )?(?:the )?number of /, 'how many ');
  const c: Ctx = { ...ctx, input, today: ctx.now.toPlainDate() };
  // "business days until christmas in germany": the country decides which holidays are skipped.
  if (/\b(?:business|working) days?\b|\bweekdays?\b/.test(s)) {
    let word = '';
    let rest = '';
    let m = new RegExp(`^(.+?) (?:in|for|using) (${COUNTRY_RE})(?: holidays)?$`).exec(s);
    if (m) [rest, word] = [m[1]!, m[2]!];
    else if ((m = new RegExp(`^(${COUNTRY_RE}) (.+)$`).exec(s))) [word, rest] = [m[1]!, m[2]!];
    if (word) {
      const found = findCountry(word.replace(/^the /, ''));
      if (found) {
        c.country = found.code;
        c.countryNote = found.note;
        s = rest;
      }
    }
  }
  for (const h of HANDLERS) {
    try {
      const r = h(s, c);
      if (r) return r;
    } catch (e) {
      return fail(c, 'date', e instanceof Error ? e.message : String(e));
    }
  }
  return null;
}

/** Cheap pre-check so the router only loads this engine for date/time-looking input. */
export const LOOKS_LIKE_DATE =
  /\b(?:days?|weeks?|months?|years?|business|weekday|today|tomorrow|yesterday|until|till|since|ago|leap|unix|epoch|timestamp|time in|time is it|o'?clock|am|pm|noon|midnight|birthday|born|old|christmas|xmas|halloween|thanksgiving|easter|new year|valentine|holidays?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|date|week|hours? (?:from|between)|how long)\b|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d(?:am|pm)\b|\b\d{1,2}:\d\d\b/i;
