import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

// The agenda isn't wired into the app's Study menu yet, so these tests drive the dev-only harness
// (apps/web/agenda-harness.html) on its own Vite dev server. The harness pins the clock with ?now=… so dates,
// reviews and exam plans are deterministic. Chromium only; one shared dev server keeps the run simple.
const PORT = 5601;
const BASE = `http://localhost:${PORT}/agenda-harness.html`;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
// Thursday 29 October 2026, noon in New York.
const at = (now: string, extra = '') => `${BASE}?now=${now}&tz=America/New_York${extra}`;
const THU = at('2026-10-29T12:00');

test.describe.configure({ mode: 'serial' });
test.skip(() => test.info().project.name !== 'chromium', 'chromium project only');

let server: ChildProcess | null = null;

async function up(): Promise<boolean> {
  try {
    return (await fetch(BASE)).ok;
  } catch {
    return false;
  }
}

test.beforeAll(async ({}, info) => {
  if (info.project.name !== 'chromium') return;
  test.setTimeout(60_000);
  if (await up()) return;
  const vite = `${ROOT}node_modules/.bin/vite`;
  const [cmd, args] = existsSync(vite) ? [vite, ['apps/web', '--port', String(PORT), '--strictPort']] : ['npx', ['vite', 'apps/web', '--port', String(PORT), '--strictPort']];
  server = spawn(cmd, args, { cwd: ROOT, stdio: 'ignore', detached: true });
  for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 300));
  if (!(await up())) throw new Error('agenda harness dev server did not start');
});

test.afterAll(() => {
  if (server?.pid) {
    try {
      process.kill(-server.pid);
    } catch {
      server.kill();
    }
  }
});

const errorsOf = (page: Page) => (page as unknown as { __errors: string[] }).__errors;

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  (page as unknown as { __errors: string[] }).__errors = errors;
  await page.goto(THU);
  await page.evaluate(() => localStorage.clear());
});

test.afterEach(async ({ page }) => {
  expect(errorsOf(page), 'uncaught page errors').toEqual([]);
});

/** Opens the harness at a pinned time (after the beforeEach cleared storage). */
async function open(page: Page, url = THU) {
  await page.goto(url);
  await expect(page.locator('[data-agenda]')).toBeVisible();
}

type Evt = { kind: 'practice' | 'test' | 'exam' | 'calc' | 'lesson'; topic?: string; correct?: boolean; at?: number };
async function record(page: Page, events: Evt[]) {
  await page.evaluate((evts) => {
    for (const e of evts) (window as any).agendaApi.recordActivity(e);
  }, events);
}
/** Noon New York time on a day (EDT/EST handled by the browser's Intl, not by us). */
const noon = (day: string) => Date.parse(`${day}T16:00:00Z`);

const calls = (page: Page) => page.evaluate(() => (window as any).agendaHarness.calls as { practice: (string | null)[]; exam: number; lesson: string[]; spoken: string[]; toasts: string[] });

test('adds a typed task and checks it off as problems are solved', async ({ page }) => {
  await open(page);
  const input = page.getByLabel('Add a task, test or problem set');
  await input.fill('Problem set 4 due Friday, 12 derivative problems');
  await expect(page.locator('.ag-preview')).toHaveText('Problem set 4: Due Fri, Oct 30 · 12 problems · Derivatives');
  await input.press('Enter');
  await expect(input).toHaveValue('');
  expect((await calls(page)).toasts.at(-1)).toBe('Added Problem set 4, due Friday, October 30.');

  const card = page.locator('.ag-upcoming [data-task]');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.ag-task-title')).toContainText('Problem set 4');
  await expect(card.locator('.ag-meta')).toHaveText('Fri, Oct 30 · tomorrow');
  await expect(card.locator('.ag-count')).toHaveText('0 of 12');

  // Solving problems in the app (any time, mounted or not) advances the task live.
  const res = await page.evaluate(() => {
    const api = (window as any).agendaApi;
    let r = null;
    for (let i = 0; i < 7; i++) r = api.recordActivity({ kind: 'practice', topic: 'Derivatives', correct: i % 2 === 0 });
    api.recordActivity({ kind: 'practice', topic: 'integral', correct: true }); // other topic: doesn't count
    api.recordActivity({ kind: 'lesson', topic: 'derivative' }); // lessons aren't problems
    return api.describeProgress(r);
  });
  expect(res).toBe('Problem set 4: 7 of 12');
  await expect(card.locator('.ag-count')).toHaveText('7 of 12');
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '7');

  // A problem done on paper; focus stays on the button through the re-render.
  const plus = card.getByRole('button', { name: 'Log one problem for Problem set 4 done on paper' });
  await plus.click();
  await expect(card.locator('.ag-count')).toHaveText('8 of 12');
  await expect(page.locator('.ag-upcoming [data-task]').getByRole('button', { name: /Log one problem/ })).toBeFocused();

  // Persisted as sync-ready records under one key.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('lemma.agenda.v1') ?? '[]'));
  expect(stored.filter((r: any) => r.type === 'task')).toHaveLength(1);
  expect(stored.filter((r: any) => r.type === 'activity')).toHaveLength(9);
  expect(new Set(stored.map((r: any) => r.id)).size).toBe(stored.length);
  expect(stored.find((r: any) => r.type === 'task')).toMatchObject({ due: '2026-10-30', count: 12, topics: ['derivative'], extra: 1 });

  await page.reload();
  await expect(page.locator('.ag-upcoming [data-task] .ag-count')).toHaveText('8 of 12');

  // Checking it off moves it to Finished; Undo after delete brings it back.
  // (click, not check(): the card re-renders, so the original element is replaced)
  await page.getByRole('checkbox', { name: 'Mark Problem set 4 done' }).click();
  await expect(page.locator('.ag-finished summary')).toHaveText('Finished (1)');
  await page.locator('.ag-finished summary').click();
  await page.getByRole('button', { name: 'Delete Problem set 4' }).click();
  await expect(page.locator('[data-task]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('[data-task]')).toHaveCount(1);
});

test('asks when the date is missing and adds nothing', async ({ page }) => {
  await open(page);
  const input = page.getByLabel('Add a task, test or problem set');
  await input.fill('Problem set 5, 10 problems');
  await expect(page.locator('.ag-preview')).toHaveText('When is "Problem set 5" due? Try "Friday", "on the 14th" or "in 2 weeks".');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('.ag-preview')).toHaveClass(/ag-ask/);
  await expect(input).toHaveValue('Problem set 5, 10 problems');
  await expect(page.locator('[data-task]')).toHaveCount(0);
  await expect(page.locator('.ag-today .ag-empty')).toBeVisible();
});

test('suggests spaced reviews from mistakes and idle topics; each opens practice', async ({ page }) => {
  await open(page);
  await record(page, [
    ...Array.from({ length: 5 }, (_, i) => ({ kind: 'test' as const, topic: 'integral', correct: i === 0, at: noon('2026-10-28') })),
    ...Array.from({ length: 4 }, () => ({ kind: 'practice' as const, topic: 'percent', correct: true, at: noon('2026-10-29') })),
    { kind: 'lesson', topic: 'stats', at: noon('2026-09-20') },
  ]);
  await page.reload();
  const reviews = page.locator('.ag-today .ag-review');
  await expect(reviews).toHaveCount(2);
  await expect(reviews.nth(0)).toHaveAttribute('data-topic', 'integral');
  await expect(reviews.nth(0).locator('.ag-task-title')).toHaveText('Review integrals today');
  await expect(reviews.nth(0).locator('.ag-meta')).toHaveText('You got 1 of 5 right yesterday.');
  await expect(reviews.nth(1)).toHaveAttribute('data-reason', 'stale');
  // Percentages were practised well today, so they're not suggested.
  await expect(page.locator('.ag-review[data-topic="percent"]')).toHaveCount(0);

  await reviews.nth(0).getByRole('button', { name: 'Practice integrals' }).click();
  await reviews.nth(0).getByRole('button', { name: 'Lesson on integrals' }).click();
  const c = await calls(page);
  expect(c.practice).toEqual(['integral']);
  expect(c.lesson).toEqual(['Integrals']);

  // After practising them well today, the review goes away.
  await record(page, Array.from({ length: 5 }, () => ({ kind: 'practice' as const, topic: 'integral', correct: true })));
  await expect(page.locator('.ag-review[data-topic="integral"]')).toHaveCount(0);
});

test('an exam builds a countdown plan with a mock exam', async ({ page }) => {
  await open(page);
  await page.getByLabel('Add a task, test or problem set').fill('Calc test on the 14th, chapters 3–4');
  await expect(page.locator('.ag-preview')).toHaveText('Calc test: On Sat, Nov 14 · Chapters 3–4 · Derivatives, Integrals (guessed)');
  await page.keyboard.press('Enter');

  // Today: the plan's practice for today, each opening practice on its topic.
  const todayPlan = page.locator('.ag-today .ag-examday');
  await expect(todayPlan.locator('.ag-task-title')).toHaveText('Calc test in 16 days');
  await expect(todayPlan.locator('.ag-plan-item')).toHaveCount(2);
  await todayPlan.getByRole('button', { name: /Practice integrals for Calc test|Practice derivatives for Calc test/ }).first().click();
  expect((await calls(page)).practice[0]).toMatch(/^(derivative|integral)$/);

  const card = page.locator('.ag-upcoming [data-task]');
  await card.getByRole('button', { name: 'Plan' }).click();
  await expect(card.getByRole('button', { name: 'Hide plan' })).toHaveAttribute('aria-expanded', 'true');
  const days = card.locator('.ag-plan-day');
  await expect(days).toHaveCount(17);
  await expect(card.locator('.ag-plan-day[data-day="2026-11-12"] .ag-plan-item[data-kind="mock"]')).toHaveText(/Full mock exam \(Chapters 3–4\)/);
  await expect(card.locator('.ag-plan-day[data-day="2026-11-13"] .ag-plan-label')).toHaveText(/^Light review: 5 /);
  await expect(card.locator('.ag-plan-day[data-day="2026-11-14"]')).toContainText('Calc test');

  // Two days before the exam, Today offers the mock exam.
  await open(page, at('2026-11-12T08:00'));
  const mock = page.locator('.ag-today .ag-examday');
  await expect(mock.locator('.ag-task-title')).toHaveText('Calc test in 2 days');
  await mock.getByRole('button', { name: 'Start mock exam' }).click();
  expect((await calls(page)).exam).toBe(1);
  await record(page, [{ kind: 'exam', topic: 'derivative', correct: true }]);
  await expect(mock.locator('.ag-plan-item[data-kind="mock"] .ag-tag')).toHaveText('Done');

  // On the day: it's due today.
  await open(page, at('2026-11-14T07:00'));
  await expect(page.locator('.ag-today [data-task] .ag-tag.ag-warn')).toHaveText('Today');
});

test('progress: streaks, charts and per-topic counts in light and dark', async ({ page }) => {
  await open(page);
  await record(page, [
    ...Array.from({ length: 6 }, (_, i) => ({ kind: 'practice' as const, topic: 'integral', correct: i < 4, at: noon('2026-10-27') })),
    ...Array.from({ length: 3 }, () => ({ kind: 'calc' as const, topic: 'solve 2x + 3 = 11', at: noon('2026-10-28') })),
    { kind: 'lesson', topic: 'derivative', at: noon('2026-10-29') },
    { kind: 'practice', topic: 'derivative', correct: false, at: noon('2026-10-20') },
  ]);
  await page.reload();
  await expect(page.locator('[data-stat="streak"] .ag-tile-value')).toHaveText('3 days');
  await expect(page.locator('[data-stat="week"] .ag-tile-value')).toHaveText('9 problems');
  await expect(page.locator('[data-stat="accuracy"] .ag-tile-value')).toHaveText('67%');
  await expect(page.locator('.ag-week')).toHaveText('Last 7 days: 9 problems on 3 days, 67% right (up from 0%), 1 lesson. Most practised: integrals.');
  await expect(page.locator('.ag-topic-stats li')).toHaveCount(3);
  await expect(page.locator('.ag-topic-stats li[data-topic="integral"] .ag-topic-num')).toHaveText('6 · 67%');
  await expect(page.locator('.ag-topic-stats li[data-topic="linear"] .ag-topic-num')).toHaveText('3');

  const bars = page.getByRole('img', { name: /^Problems per day, last 14 days: 10 in total/ });
  await expect(bars).toBeVisible();
  await expect(bars.locator('rect.ag-bar')).toHaveCount(3);
  await expect(page.getByRole('img', { name: /^Accuracy by week, last 8 weeks: 0%, 67%/ })).toBeVisible();

  // Readable in every theme: chart marks use the look's accent, and the accent differs from the card background.
  for (const theme of ['light', 'dark']) {
    await open(page, at('2026-10-29T12:00', `&theme=${theme}`));
    const c = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      const bar = document.querySelector('rect.ag-bar')!;
      const fig = document.querySelector('.ag-fig')!;
      const tick = document.querySelector('.ag-tick')!;
      return { fill: getComputedStyle(bar).fill, tick: getComputedStyle(tick).fill, bg: getComputedStyle(fig).backgroundColor, accent: css.getPropertyValue('--accent').trim(), theme: document.documentElement.dataset.theme };
    });
    expect(c.theme).toBe(theme);
    expect(c.fill).not.toBe(c.bg);
    expect(c.tick).not.toBe(c.bg);
    expect(c.accent).toMatch(/^#/);
  }
});

test('phone width: no horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await open(page);
  await page.evaluate(() => {
    const api = (window as any).agendaApi;
    api.addTaskFromText('A rather long assignment title for the statistics course, problems 1-29 odd, due Monday');
    api.addTaskFromText('Calc test on the 14th, chapters 3–4');
  });
  await page.getByRole('button', { name: 'Plan' }).click();
  await page.getByRole('button', { name: 'Topics' }).first().click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('due-today notifications ask for permission only when switched on', async ({ page }) => {
  await page.addInitScript(() => {
    const log = { requests: 0, shown: [] as { title: string; body?: string }[] };
    class FakeNotification {
      static permission: NotificationPermission = 'default';
      static async requestPermission() {
        log.requests++;
        FakeNotification.permission = 'granted';
        return 'granted' as NotificationPermission;
      }
      constructor(title: string, opts?: NotificationOptions) {
        log.shown.push({ title, ...(opts?.body ? { body: opts.body } : {}) });
      }
    }
    Object.assign(window, { Notification: FakeNotification, __notes: log });
  });
  await open(page);
  await page.evaluate(() => (window as any).agendaApi.addTaskFromText('Worksheet due today, 10 problems'));
  await expect(page.locator('.ag-today [data-task]')).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__notes.requests)).toBe(0);

  await page.getByLabel(/Due-today notifications/).check();
  await expect.poll(() => page.evaluate(() => (window as any).__notes.shown)).toEqual([{ title: 'Due today: Worksheet', body: '0 of 10 problems done.' }]);
  expect(await page.evaluate(() => (window as any).__notes.requests)).toBe(1);
  // Once per task per day.
  expect(await page.evaluate(() => (window as any).agendaApi.checkReminders())).toBe(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('lemma.agenda.prefs.v1')!).notify)).toBe(true);
});

test('typing "add a task …" adds it to the agenda, while "add 5 and 3" stays math', async ({ page }) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Calculation' });
  await input.fill('add a task: problem set 4 due friday, 12 problems');
  await input.press('Enter');
  await expect(page.getByText(/Added to your agenda: Problem set 4/i)).toBeVisible();
  await input.fill('add 5 and 3');
  await input.press('Enter');
  await expect(page.locator('#value')).not.toHaveText('0');
  await expect(page.getByText(/Added to your agenda/)).toHaveCount(1);
  const stored = await page.evaluate(() => localStorage.getItem('lemma.agenda.v1') ?? '');
  expect(stored).toContain('Problem set 4');
});
