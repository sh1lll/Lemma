import { D, MathError, type Answer, type AnswerFailure } from '@lemma/math-core';
import type { Temporal, DateOrder } from '@lemma/date-engine';

/**
 * Productivity engine: timers, study notes and the commands that manage them.
 * Pure and deterministic given `ctx.now`; every side effect is described by `action` and performed by the host.
 * Voice input arrives here as transcribed text; this engine never sees or stores audio.
 */

// ---------- public types ----------
export interface ProductivityContext {
  now: Temporal.ZonedDateTime;
  dateOrder: DateOrder;
  locale: string;
}

export type TimerAction = { type: 'timer'; seconds: number; label: string };
export type NoteAction = { type: 'note'; text: string; tags?: string[] };
export type ShowAction = { type: 'show'; what: 'notes' | 'timers' };
/** No `match` and no `all`: the most recent one. */
export type CancelAction = { type: 'cancel'; what: 'timer' | 'note'; match?: string; all?: boolean };

export type ProductivityAction = TimerAction | NoteAction | ShowAction | CancelAction;

/** An `Answer` whose `action` is one of this package's actions (math-core's `Answer.action` only knows timers). */
export type ProductivityAnswer = Omit<Answer, 'action'> & { action: ProductivityAction };
export type ProductivityResult = ProductivityAnswer | AnswerFailure;

/** Cheap pre-check before calling `answerProductivity`. */
export const LOOKS_LIKE_PRODUCTIVITY =
  /\b(?:timers?|countdown|pomodoro|alarms?|notes?|remember)\b|^\s*(?:cancel|delete|remove|clear|show|stop|dismiss)\b/i;

const TIMER_NOTE = 'Runs while Lemma is open';

// ---------- context & helpers ----------
interface Ctx extends ProductivityContext {
  input: string;
  today: Temporal.PlainDate;
}

function ok(c: Ctx, a: Omit<ProductivityAnswer, 'ok' | 'input' | 'notes'> & { notes?: string[] }): ProductivityAnswer {
  return { ok: true, input: c.input, notes: [], ...a };
}

/** A missing or ambiguous detail is a question back to the user, never a guess. */
function need(c: Ctx, kind: string, question: string): AnswerFailure {
  return { ok: false, kind, input: c.input, error: new MathError('ambiguous-reference', question) };
}

const clean = (s: string) => s.trim().replace(/^[\s:,-]+|[\s.,!?;:]+$/g, '').replace(/\s+/g, ' ');
const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

export function formatDuration(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h && `${h}h`, m && `${m}m`, sec && `${sec}s`].filter(Boolean).join(' ') || '0s';
}

function spokenDuration(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [d && plural(d, 'day'), h && plural(h, 'hour'), m && plural(m, 'minute'), sec && plural(sec, 'second')].filter(Boolean);
  return parts.join(' ') || '0 seconds';
}


// ---------- spoken numbers & durations ----------
const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SMALL_RE = Object.keys(SMALL).sort((a, b) => b.length - a.length).join('|');
const UNIT_WORDS = String.raw`(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|am\b|pm\b|o'?clock)`;

/** Voice transcripts often spell numbers out: "five minute timer", "in an hour and a half", "at nine". */
function spokenNumbers(s: string): string {
  return s
    .replace(/\b(?:half an hour|a half hour|half hour)\b/gi, '30 minutes')
    .replace(/\b(?:a|an)(?= (?:hour|minute|second|day|week)s?\b)/gi, '1')
    .replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[- ](one|two|three|four|five|six|seven|eight|nine)\b/gi, (_, t: string, u: string) => String(SMALL[t.toLowerCase()]! + SMALL[u.toLowerCase()]!))
    .replace(new RegExp(String.raw`\b(${SMALL_RE})\b(?=[ -]?(?:and a half )?${UNIT_WORDS})`, 'gi'), (w: string) => String(SMALL[w.toLowerCase()]))
    .replace(new RegExp(String.raw`\bat (${SMALL_RE})\b`, 'gi'), (_, w: string) => `at ${SMALL[w.toLowerCase()]}`)
    .replace(/\b(\d+) (hours?|minutes?)(?: and a half)\b/gi, (_, n: string, u: string) => `${n}.5 ${u}`);
}

const DUR_UNIT = String.raw`(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|wks?|w)`;
const DUR_PART = String.raw`(\d+(?:\.\d+)?)\s*-?\s*${DUR_UNIT}(?![a-z])`;
const UNIT_SECONDS = (u: string) => {
  const k = u.toLowerCase();
  return k.startsWith('w') ? 604800 : k.startsWith('d') ? 86400 : k.startsWith('h') ? 3600 : k.startsWith('m') ? 60 : 1;
};

/** "2 hours", "1 hour 30 minutes", "3 minute 30 second", "1h30m". Whole string must be a duration. */
function parseDuration(text: string): number | null {
  const t = text.trim().replace(/,/g, ' ');
  const re = new RegExp(String.raw`^(?:${DUR_PART}(?:\s*(?:and\s+)?)?)+$`, 'i');
  if (!re.test(t)) return null;
  let total = 0;
  for (const m of t.matchAll(new RegExp(DUR_PART, 'gi'))) total += Number(m[1]) * UNIT_SECONDS(m[2]!);
  return total > 0 ? total : null;
}

// ---------- show ----------
function show(s: string, c: Ctx): ProductivityResult | null {
  const m =
    /^(?:show|list|view|see|display|open|read|what are|check)(?: me)?(?: all)?(?: of)?(?: my| the)?(?: active| running| current| upcoming)? (notes|timers|alarms)$/i.exec(s) ??
    /^(?:my )?(notes|timers)$/i.exec(s) ??
    /^what (notes|timers) (?:do i have|are (?:set|running|there))$/i.exec(s);
  if (!m) return null;
  const word = m[1]!.toLowerCase();
  const what = word === 'alarms' ? 'timers' : (word as 'notes' | 'timers');
  return ok(c, {
    kind: 'productivity',
    expression: `Show ${what}`,
    primary: { display: `Your ${what}`, plain: what, spoken: `Here are your ${what}` },
    action: { type: 'show', what },
  });
}

// ---------- cancel ----------
function cancel(s: string, c: Ctx): ProductivityResult | null {
  const m = /^(?:cancel|delete|remove|clear|stop|dismiss|turn off|kill|get rid of)\s+(.+)$/i.exec(s);
  if (!m) return null;
  let rest = m[1]!.replace(/^(?:the|my|that|this)\s+/i, '');
  let all = false;
  if (/^(?:all|every)\b/i.test(rest)) {
    all = true;
    rest = rest.replace(/^(?:all|every)(?: of)?(?: my| the)?\s*/i, '');
  }
  const kw = /\b(timers?|countdowns?|alarms?|pomodoros?|notes?)\b/i.exec(rest);
  if (!kw) return null;
  const k = kw[1]!.toLowerCase();
  const what: CancelAction['what'] = k.startsWith('note') ? 'note' : 'timer';
  const pluralKw = /s$/.test(k);
  // What is left once the keyword is removed names the item: "eggs timer", "reminder about rent", "timer for the eggs".
  let match = clean(
    (rest.slice(0, kw.index) + ' ' + rest.slice(kw.index + kw[0].length))
      .replace(/^\s*(?:about|for|to|called|named|labell?ed|on|of|that says)\s+/i, '')
      .replace(/^(?:the|my)\s+/i, ''),
  );
  if (k.startsWith('pomodoro')) match = match || 'Pomodoro';
  if (pluralKw && !match) all = true;
  const noun = all ? `${what}s` : what;
  const action: CancelAction = { type: 'cancel', what, ...(match ? { match } : {}), ...(all ? { all: true } : {}) };
  const display = all ? (match ? `Cancel all ${noun} matching "${match}"` : `Cancel all ${noun}`) : match ? `Cancel ${what} "${match}"` : `Cancel the latest ${what}`;
  const verb = what === 'note' ? 'Delete' : 'Cancel';
  return ok(c, {
    kind: what,
    expression: display.replace(/^Cancel/, verb),
    primary: { display: display.replace(/^Cancel/, verb), plain: display.replace(/^Cancel/, verb), spoken: display.replace(/^Cancel/, verb) },
    notes: !all && !match ? [`Applies to the most recent ${what}`] : [],
    action,
  });
}

// ---------- notes ----------
function note(s: string, c: Ctx): ProductivityResult | null {
  let text: string | undefined;
  let m = /^(?:note|memo|jot(?: down)?)\s*[:,-]\s*(.*)$/i.exec(s) ?? /^(?:new note|note(?: that| down)?)\s+(.*)$/i.exec(s);
  if (m) text = m[1];
  if (text === undefined && (m = /^(?:take|make|add|write|save)(?: down)? (?:a )?(?:quick )?note(?: that| saying| to self)?\s*[:,-]?\s*(.*)$/i.exec(s))) text = m[1];
  if (text === undefined && (m = /^remember(?: that)?\s*[:,-]?\s*(.*)$/i.exec(s))) text = m[1];
  if (text === undefined) return null;
  const tags = [...new Set([...[...text.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)].map((t) => t[1]!.toLowerCase())])];
  const body = clean(text.replace(/(?:^|\s)#[\p{L}\p{N}_-]+/gu, ' '));
  if (!body) return need(c, 'note', 'What should the note say?');
  const tagText = tags.length ? ` ${tags.map((t) => `#${t}`).join(' ')}` : '';
  return ok(c, {
    kind: 'note',
    expression: 'Note',
    primary: { display: body, plain: body, spoken: `Noted: ${body}` },
    lines: tags.length ? [{ label: 'Tags', display: tagText.trim() }] : undefined,
    action: { type: 'note', text: body, ...(tags.length ? { tags } : {}) },
  });
}

// ---------- timers ----------
const TIMER_FILLER = new Set(['set', 'start', 'make', 'create', 'begin', 'a', 'an', 'the', 'my', 'timer', 'countdown', 'for', 'of', 'please', 'alarm', 'in', 'me', 'on', 'up', 'and', 'called', 'named', 'labeled', 'labelled', 'go', 'run', '-']);

function timer(s: string, c: Ctx): ProductivityResult | null {
  if (!/\b(?:timer|countdown|alarm in|pomodoro)\b/i.test(s)) return null;
  const t = spokenNumbers(s);
  // Days and weeks count too ("timer for 2 days"); the 7-day cap below answers anything longer.
  const parts = [...t.matchAll(new RegExp(DUR_PART, 'gi'))];
  const pomodoro = /\bpomodoro\b/i.test(t);
  let seconds = parts.reduce((sum, p) => sum + Number(p[1]) * UNIT_SECONDS(p[2]!), 0);
  const notes: string[] = [];
  if (!parts.length) {
    if (!pomodoro) {
      return /^(?:(?:set|start|make|create)(?: me)? (?:a |an )?)?(?:new )?(?:timer|countdown)$/i.test(t) ? need(c, 'timer', 'How long? e.g. "timer 10 minutes"') : null;
    }
    seconds = 25 * 60;
  }
  if (pomodoro) notes.push('Pomodoro: 25 minutes of focus, then a 5-minute break');
  if (!(seconds > 0)) return null;
  if (seconds > 7 * 86400) return need(c, 'timer', 'Timers run for up to 7 days; use a reminder for anything longer');

  let label = /\bto (.+)$/i.exec(t)?.[1];
  if (!label) {
    let rest = t;
    for (const p of parts) rest = rest.replace(p[0], ' ');
    const words = rest.replace(/[,:]/g, ' ').split(/\s+/).filter(Boolean);
    while (words.length && TIMER_FILLER.has(words[0]!.toLowerCase())) words.shift();
    while (words.length && TIMER_FILLER.has(words[words.length - 1]!.toLowerCase())) words.pop();
    label = words.join(' ');
  }
  label = clean(label ?? '');
  if (/^pomodoro$/i.test(label) || (pomodoro && !label)) label = 'Pomodoro';
  const pretty = formatDuration(seconds);
  notes.push(TIMER_NOTE);
  return ok(c, {
    kind: 'timer',
    expression: label ? `Timer · ${label}` : 'Timer',
    primary: { display: pretty, plain: String(seconds), spoken: `Timer set for ${spokenDuration(seconds)}${label ? `: ${label}` : ''}` },
    value: new D(seconds),
    notes,
    action: { type: 'timer', seconds, label: label || pretty },
  });
}

// ---------- entry point ----------
const HANDLERS = [show, cancel, note, timer];

export function answerProductivity(input: string, ctx: ProductivityContext): ProductivityResult | null {
  const s = input
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!?]+$/, '')
    .replace(/^(?:(?:hey|ok|okay) )?(?:lemma[,:]? )?/i, '')
    .replace(/^please,? /i, '')
    .replace(/,? please$/i, '');
  if (!s || !LOOKS_LIKE_PRODUCTIVITY.test(s)) return null;
  const c: Ctx = { ...ctx, input, today: ctx.now.toPlainDate() };
  for (const h of HANDLERS) {
    const r = h(s, c);
    if (r) return r;
  }
  return null;
}
