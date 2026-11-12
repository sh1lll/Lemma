import { describe, expect, it } from 'vitest';
import { Temporal } from '@lemma/date-engine';
import { answerProductivity, LOOKS_LIKE_PRODUCTIVITY, type ProductivityAnswer, type ProductivityContext } from '../src';

// Thursday 29 October 2026, 7:00 pm in New York (EDT, UTC-4). US DST ends Sunday 1 November 2026 at 2:00 am.
const ctx: ProductivityContext = {
  now: Temporal.ZonedDateTime.from('2026-10-29T19:00[America/New_York]'),
  dateOrder: 'mdy',
  locale: 'en-US',
};

function ask(input: string): ProductivityAnswer {
  const r = answerProductivity(input, ctx);
  if (!r) throw new Error(`"${input}" not recognised`);
  if (!r.ok) throw new Error(`"${input}" failed: ${r.error.message}`);
  return r;
}

function question(input: string): string {
  const r = answerProductivity(input, ctx);
  if (!r) throw new Error(`"${input}" not recognised`);
  if (r.ok) throw new Error(`"${input}" should ask a question, got ${r.primary.display}`);
  expect(r.error.code).toBe('ambiguous-reference');
  return r.error.message;
}

const action = (input: string) => ask(input).action;

describe('timers', () => {
  it.each([
    // Phrasings apps/web/src/timers.ts already handles.
    ['set a timer for 12 minutes', 720, '12m'],
    ['start a 12-minute timer', 720, '12m'],
    ['timer 90 seconds', 90, '1m 30s'],
    ['countdown 5 minutes', 300, '5m'],
    ['alarm in 5 minutes', 300, '5m'],
    ['timer 2.5 minutes', 150, '2m 30s'],
    ['1 hour 15 minute timer', 4500, '1h 15m'],
    ['timer 1h30m', 5400, '1h 30m'],
    // New phrasings.
    ['3 minute 30 second timer', 210, '3m 30s'],
    ['five minute timer', 300, '5m'],
    ['set a timer for an hour and a half', 5400, '1h 30m'],
    ['Set a timer for twenty-five minutes.', 1500, '25m'],
  ])('%s → %i s', (input, seconds, display) => {
    const a = ask(input);
    expect(a.kind).toBe('timer');
    expect(a.primary.display).toBe(display);
    expect(a.action).toMatchObject({ type: 'timer', seconds });
    expect(a.value?.toNumber()).toBe(seconds);
  });

  it('labels', () => {
    expect(action('timer for the eggs 7 min')).toEqual({ type: 'timer', seconds: 420, label: 'eggs' });
    expect(action('set a timer for 10 minutes to check the oven')).toEqual({ type: 'timer', seconds: 600, label: 'check the oven' });
    expect(action('pasta timer 9 minutes')).toEqual({ type: 'timer', seconds: 540, label: 'pasta' });
    expect(action('set a timer for 5 minutes for the tea')).toEqual({ type: 'timer', seconds: 300, label: 'tea' });
    // No label: the duration is the label, as in timers.ts.
    expect(action('set a timer for 12 minutes')).toEqual({ type: 'timer', seconds: 720, label: '12m' });
  });

  it('pomodoro is 25 minutes with a note', () => {
    for (const input of ['pomodoro', 'start a pomodoro', 'pomodoro timer']) {
      const a = ask(input);
      expect(a.action).toEqual({ type: 'timer', seconds: 1500, label: 'Pomodoro' });
      expect(a.notes.join(' ')).toMatch(/25 minutes of focus.*5-minute break/);
    }
  });

  it('asks how long when no duration is given', () => {
    expect(question('set a timer')).toMatch(/how long/i);
  });
});


describe('notes', () => {
  it.each([
    ['note: chain rule is f\'(g(x))·g\'(x)', { type: 'note', text: "chain rule is f'(g(x))·g'(x)" }],
    ['take a note the gate code is 4471', { type: 'note', text: 'the gate code is 4471' }],
    ['remember that the wifi password is correct horse', { type: 'note', text: 'the wifi password is correct horse' }],
    ['note: integration by parts is uv - ∫v du #calc #exam', { type: 'note', text: 'integration by parts is uv - ∫v du', tags: ['calc', 'exam'] }],
    ['Note: Ask Ms. Rivera about problem 7.', { type: 'note', text: 'Ask Ms. Rivera about problem 7' }],
  ])('%s', (input, expected) => {
    const a = ask(input);
    expect(a.action).toEqual(expected);
  });

  it('asks for the text of an empty note', () => expect(question('note:')).toMatch(/what should the note say/i));

  it.each([
    ['show my notes', 'notes'],
    ['show timers', 'timers'],
    ['my notes', 'notes'],
  ])('%s', (input, what) => expect(action(input)).toEqual({ type: 'show', what }));
});

describe('cancel and manage', () => {
  it.each([
    ['cancel the eggs timer', { type: 'cancel', what: 'timer', match: 'eggs' }],
    ['cancel all timers', { type: 'cancel', what: 'timer', all: true }],
    ['cancel the timer', { type: 'cancel', what: 'timer' }],
    ['stop the timer for the pasta', { type: 'cancel', what: 'timer', match: 'pasta' }],
    ['delete the note about limits', { type: 'cancel', what: 'note', match: 'limits' }],
  ])('%s', (input, expected) => expect(action(input)).toEqual(expected));

});

describe('not productivity', () => {
  it('reminders are gone: no reminder or snooze commands', () => {
    expect(answerProductivity('remind me at 3pm to call Sam', ctx)).toBeNull();
    expect(answerProductivity('snooze 10 minutes', ctx)).toBeNull();
  });

  it.each(['5+5', 'days until christmas', '50 miles to km', 'time in tokyo', 'what time is it', '10 minutes in seconds', 'sqrt(2)', '3pm in london', 'tomorrow'])(
    '%s → null',
    (input) => expect(answerProductivity(input, ctx)).toBeNull(),
  );

  it('the quick check rejects plain math', () => {
    expect(LOOKS_LIKE_PRODUCTIVITY.test('5+5')).toBe(false);
    expect(LOOKS_LIKE_PRODUCTIVITY.test('note: chain rule')).toBe(true);
    expect(LOOKS_LIKE_PRODUCTIVITY.test('remind me at 3pm to call Sam')).toBe(false);
  });

  it('is deterministic given ctx.now', () => {
    expect(answerProductivity('set a timer for 25 minutes', ctx)).toEqual(answerProductivity('set a timer for 25 minutes', ctx));
  });
});

