import { parseDate, parseTime, Temporal, type DateOrder } from '@lemma/date-engine';
import { classify, type Topic } from '@lemma/practice-engine';
import { addDays, diffDays, formatDay, lastDayOfMonth, weekday } from './days';
import { subjectTopics, topicsIn } from './topics';
import type { Day, Task, TaskKind } from './types';

/**
 * Plain-language study tasks, typed or spoken:
 *   "Problem set 4 due Friday, 12 problems"   → assignment, due the coming Friday, 12 problems
 *   "Calc test on the 14th, chapters 3–4"    → exam on the next 14th, scope "Chapters 3–4", calculus topics
 *   "20 integral problems in 2 weeks"         → assignment, integrals, due 14 days out
 * Dates go through @lemma/date-engine's parseDate (weekdays, month names, numeric dates in the locale's
 * order, holidays); this file finds the date phrase inside a sentence and adds the forms that only make sense
 * for a due date ("on the 14th", "in 2 weeks", "end of the week").
 */

export type Now = Temporal.ZonedDateTime | Date | number;

export interface ParseOptions {
  /** IANA zone for "today" when `now` is a Date or timestamp. Defaults to the system zone. */
  timeZone?: string;
  /** Record id for the new task (tests pass a fixed one). */
  id?: string;
}

export type ParseResult = Task | { ask: string };

export function toZoned(now: Now, timeZone?: string): Temporal.ZonedDateTime {
  if (now instanceof Temporal.ZonedDateTime) return timeZone ? now.withTimeZone(timeZone) : now;
  const ms = typeof now === 'number' ? now : now.getTime();
  return Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(timeZone ?? Temporal.Now.timeZoneId());
}

/** Same rule as date-engine's systemContext: the US and a few others write month first. */
export const dateOrderFor = (locale: string): DateOrder => (/^(en-US|en-PH|en-CA|es-US|en)$/i.test(locale) ? 'mdy' : 'dmy');

export function newId(prefix: string, at = Date.now()): string {
  const rnd = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, '0');
  return `${prefix}-${at.toString(36)}-${rnd}`;
}

// ---------------------------------------------------------------------------------------------------------
// Spoken numbers ("twelve problems", "the fourteenth", "in two weeks")
// ---------------------------------------------------------------------------------------------------------

const UNITS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
  eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30,
};
const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec';

const suffix = (n: number) => (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
const alt = (o: Record<string, number>) => Object.keys(o).sort((a, b) => b.length - a.length).join('|');

function spokenNumbers(s: string): string {
  const unitOrd = alt(Object.fromEntries(Object.entries(ORDINALS).filter(([, v]) => v < 10)));
  const unitCard = alt(Object.fromEntries(Object.entries(UNITS).filter(([, v]) => v < 10)));
  return s
    .replace(new RegExp(`\\b(twenty|thirty)[ -](${unitOrd})\\b`, 'gi'), (_, t: string, o: string) => {
      const n = TENS[t.toLowerCase()]! + ORDINALS[o.toLowerCase()]!;
      return `${n}${suffix(n)}`;
    })
    .replace(new RegExp(`(?<=\\b(?:the|on|${MONTHS})\\.? )(${alt(ORDINALS)})\\b`, 'gi'), (o: string) => {
      const n = ORDINALS[o.toLowerCase()]!;
      return `${n}${suffix(n)}`;
    })
    .replace(new RegExp(`\\b(${alt(TENS)})[ -](${unitCard})\\b`, 'gi'), (_, t: string, u: string) => String(TENS[t.toLowerCase()]! + UNITS[u.toLowerCase()]!))
    .replace(new RegExp(`\\b(${alt(TENS)})\\b`, 'gi'), (t: string) => String(TENS[t.toLowerCase()]!))
    .replace(new RegExp(`\\b(${alt(UNITS)})\\b`, 'gi'), (u: string, _g: string, offset: number, all: string) => {
      // "one" is often not a number ("this one", "one of"); only take it before a unit or a count noun.
      if (u.toLowerCase() === 'one' && !/^ (?:more )?(?:days?|weeks?|months?|problems?|questions?|exercises?)\b/i.test(all.slice(offset + u.length))) return u;
      return String(UNITS[u.toLowerCase()]!);
    });
}

// ---------------------------------------------------------------------------------------------------------
// A sentence with spans that can be cut out once they've been understood
// ---------------------------------------------------------------------------------------------------------

class Text {
  src: string;
  low: string;
  constructor(s: string) {
    this.src = s;
    this.low = s.toLowerCase();
    if (this.low.length !== this.src.length) this.src = this.low; // rare Unicode case-mapping; keep indices aligned
  }
  find(re: RegExp): RegExpExecArray | null {
    return re.exec(this.low);
  }
  cut(start: number, end: number): void {
    const blank = ' '.repeat(end - start);
    this.src = this.src.slice(0, start) + blank + this.src.slice(end);
    this.low = this.low.slice(0, start) + blank + this.low.slice(end);
  }
  cutMatch(m: RegExpExecArray): void {
    this.cut(m.index, m.index + m[0].length);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------------------

interface DateCtx {
  today: Day;
  dateOrder: DateOrder;
}

const pd = (raw: string, c: DateCtx): Day | null => {
  const r = parseDate(raw, { today: Temporal.PlainDate.from(c.today), dateOrder: c.dateOrder }, 'future');
  return r ? r.date.toString() : null;
};

/** The next `n`th of a month on or after today ("on the 14th"); skips months without that day. */
function nextDayOfMonth(n: number, today: Day): Day | null {
  if (n < 1 || n > 31) return null;
  const t = Temporal.PlainDate.from(today);
  for (let k = 0; k < 13; k++) {
    const first = t.with({ day: 1 }).add({ months: k });
    if (n > first.daysInMonth) continue;
    const d = first.with({ day: n }).toString();
    if (diffDays(today, d) >= 0) return d;
  }
  return null;
}

const endOfWeek = (today: Day) => addDays(today, (5 - weekday(today) + 7) % 7); // the coming Friday (school week)

type DateRule = { re: RegExp; day: (m: RegExpExecArray, c: DateCtx) => Day | null };

const WD_FULL = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues|tue|wed|thurs|thur|thu|fri';
const AMOUNT = (s: string) => (s === 'a' || s === 'an' || s === 'one' ? 1 : s === 'a couple of' || s === 'a couple' ? 2 : s === 'a few' ? 3 : Number(s));
const addUnit = (today: Day, n: number, unit: string): Day =>
  unit.startsWith('month') ? Temporal.PlainDate.from(today).add({ months: n }).toString() : addDays(today, unit.startsWith('week') ? 7 * n : n);

const DATE_RULES: DateRule[] = [
  { re: /\b(\d{4}-\d{1,2}-\d{1,2})\b/, day: (m, c) => pd(m[1]!, c) },
  { re: /\b(\d{1,2}\/\d{1,2}(?:\/(?:\d{4}|\d{2}))?)(?![\d/])/, day: (m, c) => pd(m[1]!, c) },
  {
    re: new RegExp(`\\b((?:${MONTHS})\\.? \\d{1,2}(?:st|nd|rd|th)?(?:,? \\d{4})?|\\d{1,2}(?:st|nd|rd|th)? (?:of )?(?:${MONTHS})\\.?(?:,? \\d{4})?)\\b`),
    day: (m, c) => pd(m[1]!.replace(/(\d)(st|nd|rd|th)\b/, '$1').replace(/,/g, ''), c),
  },
  { re: /\b(?:(?:on|by|for|due) )?the (\d{1,2})(?:st|nd|rd|th)\b/, day: (m, c) => nextDayOfMonth(Number(m[1]), c.today) },
  { re: /\bon the (\d{1,2})\b(?![./:-]?\d)/, day: (m, c) => nextDayOfMonth(Number(m[1]), c.today) },
  {
    re: /\bin (\d{1,3}|an?|a couple(?: of)?|a few) (days?|weeks?|months?)(?:'? time)?\b/,
    day: (m, c) => addUnit(c.today, AMOUNT(m[1]!), m[2]!),
  },
  {
    re: /\b(\d{1,3}|an?|one) (days?|weeks?|months?) from (?:now|today)\b/,
    day: (m, c) => addUnit(c.today, AMOUNT(m[1]!), m[2]!),
  },
  { re: /\b(?:by )?(?:the )?end of (?:the |this )?week\b/, day: (_m, c) => endOfWeek(c.today) },
  { re: /\b(?:by )?(?:the )?end of (?:the |this )?month\b/, day: (_m, c) => lastDayOfMonth(c.today) },
  { re: /\b(?:by )?(?:the )?end of next week\b/, day: (_m, c) => addDays(endOfWeek(c.today), 7) },
  { re: /\b(?:the )?day after (?:tomorrow|tmrw)\b/, day: (_m, c) => addDays(c.today, 2) },
  { re: /\b(today|tonight|tomorrow|tmrw|tmr)\b/, day: (m, c) => addDays(c.today, m[1] === 'today' || m[1] === 'tonight' ? 0 : 1) },
  { re: new RegExp(`\\b(?:(next|this|coming) )?(${WD_FULL})\\b`), day: (m, c) => pd(`${m[1] ? `${m[1]} ` : ''}${m[2]!}`, c) },
  // "sat" and "sun" are also the SAT and the sun; only as days after a cue word.
  { re: /\b(?:due|on|by|next|this|coming) (sat|sun)\b/, day: (m, c) => pd(`${/^(?:next|this|coming)/.test(m[0]) ? `${m[0].split(' ')[0]} ` : ''}${m[1]!}`, c) },
  { re: /\b(?:(?:this|next) )?weekend\b/, day: (m, c) => addDays(c.today, ((6 - weekday(c.today) + 7) % 7) + (m[0].startsWith('next') ? 7 : 0)) },
  { re: /\bthis week\b/, day: (_m, c) => endOfWeek(c.today) },
  { re: /\bnext week\b/, day: (_m, c) => addDays(endOfWeek(c.today), 7) },
  { re: /\bnext month\b/, day: (_m, c) => pd('next month', c) },
];

function findDate(t: Text, c: DateCtx): Day | null {
  for (const rule of DATE_RULES) {
    const m = t.find(rule.re);
    if (!m) continue;
    const d = rule.day(m, c);
    if (!d) continue;
    t.cutMatch(m);
    // "Friday the 13th", "Fri, Nov 6": drop a weekday name right before the date we used.
    const before = new RegExp(`\\b(?:${WD_FULL}|sat|sun),? *(?:the *)?$`).exec(t.low.slice(0, m.index));
    if (before) t.cut(before.index, m.index);
    return d;
  }
  return null;
}

function findTime(t: Text): string | undefined {
  const m =
    t.find(/\b(?:at |@ ?)?(\d{1,2}(?::\d{2})? ?(?:am|pm|a\.m\.|p\.m\.))(?![a-z])/) ?? t.find(/\b(?:at|@) (\d{1,2}:\d{2}|noon|midnight)\b/) ?? t.find(/\b(noon|midnight)\b/);
  if (!m) return undefined;
  const p = parseTime(m[1]!.replace(/\s+/g, ''));
  if (!p) return undefined;
  t.cutMatch(m);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------------------------------------
// Counts and scope
// ---------------------------------------------------------------------------------------------------------

function findCount(t: Text): number | undefined {
  // "problems 1–29 odd", "#1-12", "questions 5 to 20": counted, but left in the title (it says which ones).
  const r = t.find(/(?:\b(?:problems?|questions?|exercises?|qs?|nos?\.?|numbers?)|#)\s*#?(\d{1,3})\s*(?:-|to|through|thru)\s*#?(\d{1,3})\b(?:,?\s*(?:all |only |the )?(odds?|evens?|odd[- ]numbered|even[- ]numbered|odd numbers|even numbers)\b)?/);
  if (r) {
    const a = Number(r[1]);
    const b = Number(r[2]);
    if (b >= a) {
      const parity = r[3]?.startsWith('odd') ? 'odd' : r[3]?.startsWith('even') ? 'even' : null;
      if (parity === 'odd') return Math.floor((b + 1) / 2) - Math.floor(a / 2);
      if (parity === 'even') return Math.floor(b / 2) - Math.floor((a - 1) / 2);
      return b - a + 1;
    }
  }
  const m = t.find(/\b(\d{1,3})\s+(?:(?!due\b|by\b|on\b|in\b)[a-z-]+\s+){0,3}?(?:problems?|questions?|exercises?|qs|proofs?)\b/);
  if (m && Number(m[1]) > 0) {
    t.cutMatch(m);
    return Number(m[1]);
  }
  return undefined;
}

function findScope(t: Text): string | undefined {
  const m = t.find(/\b(chapters?|chs?\.|ch|sections?|secs?\.?|§|units?|lessons?|modules?)\s*(\d+(?:\.\d+)?(?:\s*(?:-|to|through|and|&|,)\s*\d+(?:\.\d+)?)*)/);
  if (!m) return undefined;
  const word = m[1]!.replace(/\.$/, '');
  const plural = /(?:-|to|through|and|&|,)/.test(m[2]!);
  const names: Record<string, string> = { ch: 'Chapter', chs: 'Chapters', sec: 'Section', secs: 'Sections', '§': 'Section' };
  let label = names[word] ?? word[0]!.toUpperCase() + word.slice(1);
  if (plural && !label.endsWith('s')) label += 's';
  const nums = m[2]!
    .replace(/\s*(?:-|to|through)\s*/g, '–')
    .replace(/\s*(?:and|&)\s*/g, ' and ')
    .replace(/\s*,\s*/g, ', ');
  t.cutMatch(m);
  return `${label} ${nums}`;
}

// ---------------------------------------------------------------------------------------------------------
// Title
// ---------------------------------------------------------------------------------------------------------

function cleanTitle(s: string): string {
  let t = ` ${s.replace(/\s+/g, ' ')} `;
  t = t.replace(/\b(?:is |it'?s )?due\b/gi, ' ');
  for (let i = 0; i < 3; i++) {
    t = t
      .replace(/\s+/g, ' ')
      .replace(/\s+([,;.:])/g, '$1')
      .replace(/\b(?:on|by|for|at|before|in|the|of|with|and|from)\s*(?=[,;.:]|$)/gi, '')
      .replace(/([,;:])\s*(?=[,;.:])/g, '')
      .trim();
  }
  t = t.replace(/^[\s,;:.\-–]+|[\s,;:.\-–]+$/g, '').replace(/\s+/g, ' ');
  return t ? t[0]!.toUpperCase() + t.slice(1) : t;
}

// ---------------------------------------------------------------------------------------------------------
// parseTask
// ---------------------------------------------------------------------------------------------------------

const EXAM_RE = /\b(?:tests?|exams?|quiz(?:zes)?|midterms?|finals?|mock|sat|psat|act|gre|gmat|ap exam|ib exam)\b/;
const ASSIGN_RE = /\b(?:problem ?sets?|psets?|p-sets?|homework|hw|worksheets?|assignments?|exercises?|problems?|questions?)\b/;

/**
 * Parses one task. Returns the task, or `{ ask }` with a question to put back to the user when the date is
 * missing or already past. `now` fixes "today" (tests inject it); `locale` sets the numeric date order.
 */
export function parseTask(text: string, now: Now, locale = 'en-US', opts: ParseOptions = {}): ParseResult {
  const raw = text.normalize('NFKC').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().replace(/^(?:add|new|remind me(?: about| of| that)?|add a task|task)\s*:?\s+/i, '');
  if (!raw) return { ask: 'What should I add? For example "Problem set 4 due Friday, 12 problems".' };
  const zdt = toZoned(now, opts.timeZone);
  const today = zdt.toPlainDate().toString();
  const t = new Text(spokenNumbers(raw));
  const fullLow = t.low;

  const scope = findScope(t);
  const count = findCount(t);
  const time = findTime(t);
  const due = findDate(t, { today, dateOrder: dateOrderFor(locale) });

  let topics: Topic[] = topicsIn(fullLow);
  let topicsGuessed = false;
  if (!topics.length) {
    topics = subjectTopics(fullLow);
    topicsGuessed = topics.length > 0;
  }
  if (!topics.length) {
    const c = classify(t.low.replace(/\s+/g, ' '));
    if (c && c !== 'arithmetic') topics = [c];
  }

  const kind: TaskKind = EXAM_RE.test(fullLow) ? 'exam' : count !== undefined || ASSIGN_RE.test(fullLow) ? 'assignment' : 'study';
  const title = cleanTitle(t.src) || (kind === 'exam' ? 'Test' : kind === 'assignment' ? 'Problems' : 'Study');

  if (!due) {
    return kind === 'exam'
      ? { ask: `When is ${title}? Try "on the 14th" or "next Friday".` }
      : { ask: `When is "${title}" due? Try "Friday", "on the 14th" or "in 2 weeks".` };
  }
  if (diffDays(today, due) < 0) return { ask: `${formatDay(due, locale, { month: 'long', day: 'numeric', year: 'numeric' })} has already passed. When is "${title}" due?` };

  const at = zdt.epochMilliseconds;
  const task: Task = {
    id: opts.id ?? newId('t', at),
    type: 'task',
    kind,
    title,
    text: text.trim(),
    due,
    topics,
    start: today,
    created: at,
    updated: at,
  };
  if (time) task.time = time;
  if (count !== undefined) task.count = count;
  if (scope) task.scope = scope;
  if (topicsGuessed) task.topicsGuessed = true;
  return task;
}

export const isAsk = (r: ParseResult): r is { ask: string } => 'ask' in r;
