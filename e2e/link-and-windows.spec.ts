import { test, expect, ask, value } from './helpers';

const notesCount = (p: import('@playwright/test').Page) => p.evaluate(() => (JSON.parse(localStorage.getItem('lemma.notes.v1') ?? '[]') as unknown[]).length);

test('a ?q= link previews its question but runs nothing until Enter', async ({ app }) => {
  await ask(app, 'note: keep me');
  await ask(app, 'x = 3');
  expect(await notesCount(app)).toBe(1);

  await app.goto('/?q=delete all notes');
  await expect(app.locator('#input')).toHaveValue('delete all notes');
  await app.waitForTimeout(800);
  expect(await notesCount(app)).toBe(1);

  await app.goto('/?q=x = 5');
  await expect(app.locator('#input')).toHaveValue('x = 5');
  await app.waitForTimeout(500);
  expect(await app.evaluate(() => localStorage.getItem('lemma.vars.v1'))).toContain('"x":"3"');
  // Enter commits it as usual.
  await app.locator('#input').press('Enter');
  await expect.poll(() => app.evaluate(() => localStorage.getItem('lemma.vars.v1'))).toContain('"x":"5"');

  await app.goto('/?q=2%5E10%20%2B%201');
  await expect(value(app)).toHaveText('1,025');
});

test("two windows don't erase each other's variables, formulas, timers and settings", async ({ app, context }) => {
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.locator('#input')).toBeVisible();

  await ask(app, 'x = 5');
  await ask(app, 'f(t) = t^2');
  await ask(app, 'set a timer for 90 seconds');
  await app.locator('#angle').click();
  await expect(other.locator('#formulas')).toContainText('x = 5');
  await expect(other.locator('#formulas')).toContainText('f(t)');
  await expect(other.locator('#timers')).toBeVisible();
  await expect(other.locator('#angle')).toHaveText(await app.locator('#angle').innerText());

  // The other window now saves its own change: what the first one wrote survives.
  await ask(other, 'y = 2');
  const vars = await app.evaluate(() => JSON.parse(localStorage.getItem('lemma.vars.v1') ?? '{}') as Record<string, string>);
  expect(vars).toMatchObject({ x: '5', y: '2' });
  await other.close();
});

test('an answer overtaken by a newer one still runs its action', async ({ page }) => {
  // Hold back the productivity engine so "note: …" waits while a newer answer lands.
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/assets/everyday-*.js', async (r) => {
    await held;
    await r.continue();
  });
  await page.goto('/');
  const input = page.locator('#input');
  await input.fill('note: arrived late');
  await input.press('Enter');
  await input.fill('2 + 2');
  await input.press('Enter');
  await expect(value(page)).toHaveText('4');
  release();
  await expect.poll(() => notesCount(page)).toBe(1);
  await expect(page.locator('#history li', { hasText: 'note: arrived late' })).toHaveCount(1);
  await expect(value(page)).toHaveText('4');
});
