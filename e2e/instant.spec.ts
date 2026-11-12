import { ask, expect, test, value } from './helpers';

// Speed without losing anything: keys act on touch-down exactly once, algebra typed and paused on is worked out
// before Enter, the history list stays exact with its cheap one-row update, and the engine's first load shows
// its progress.

test('a tapped keypad key acts on touch-down, once', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'touch');
  await page.addInitScript(() => localStorage.setItem('lemma.settings.v1', JSON.stringify({ warmOnStart: false, showKeypad: true })));
  await page.goto('/');
  const seven = page.locator('#keypad .key', { hasText: /^7$/ }).first();
  await seven.tap();
  await seven.tap();
  await page.locator('#keypad .key', { hasText: /^\+$/ }).first().tap();
  await page.locator('#keypad .key', { hasText: /^1$/ }).first().tap();
  await expect(page.locator('#input')).toHaveValue('77+1');
  await expect(value(page)).toHaveText('78');
});

test('algebra typed and paused on is ready by Enter', async ({ app }) => {
  test.setTimeout(90_000);
  // Get the engine loaded first.
  await app.locator('#input').fill('solve 2x = 6');
  await app.locator('#input').press('Enter');
  await expect(value(app)).toContainText('3', { timeout: 60_000 });
  // Type, pause (the preview works it out in the background), then Enter.
  await app.locator('#input').pressSequentially('solve 7x - 3 = 25', { delay: 20 });
  await app.waitForTimeout(2500);
  const t0 = Date.now();
  await app.locator('#input').press('Enter');
  await expect(value(app)).toContainText('4');
  expect(Date.now() - t0).toBeLessThan(800);
});

test('history stays exact through the quick one-row update', async ({ app }) => {
  for (let i = 1; i <= 55; i++) {
    await app.locator('#input').fill(`${i}+0`);
    await app.locator('#input').press('Enter');
  }
  const rows = app.locator('#history li .h-in');
  await expect(rows).toHaveCount(50);
  await expect(rows.first()).toHaveText('55+0');
  await expect(rows.last()).toHaveText('6+0');
  // A pin (a different kind of change) still redraws everything correctly.
  await app.locator('#history li .pin').nth(2).click();
  await expect(app.locator('#pinned li .h-in')).toHaveText(['53+0']);
  await ask(app, '1000+0');
  await expect(rows.first()).toHaveText('1000+0');
  await expect(app.locator('#history li .h-in', { hasText: /^53\+0$/ })).toHaveCount(0);
});

test('the algebra engine’s first load shows a progress bar under its status', async ({ app }) => {
  test.setTimeout(90_000);
  await app.locator('#input').fill('solve x^2 = 9');
  await app.locator('#input').press('Enter');
  await expect(app.locator('#hint .hint-bar')).toBeVisible({ timeout: 10_000 });
  await expect(value(app)).toContainText('3', { timeout: 60_000 });
  await expect(app.locator('#hint')).toBeHidden({ timeout: 30_000 });
});
