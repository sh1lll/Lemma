import { ask, expect, test, value } from './helpers';

// The main screen keeps what it shows true: settings redo the answer in place, slow answers don't jump the queue,
// and nothing typed or pinned is lost to an unrelated action.

test('a slow answer that finishes late goes into history in its place and leaves the newer answer on screen', async ({ app }) => {
  test.setTimeout(100_000); // the algebra engine's first load is slow when every browser starts it at once
  const input = app.locator('#input');
  await input.fill('sqrt(-1)'); // needs the algebra engine, which loads on first use
  await input.press('Enter');
  await input.fill('10/3');
  await input.press('Enter');
  await expect(value(app)).toHaveText(/3\.33/);
  await expect(app.locator('#history li')).toHaveCount(2, { timeout: 80_000 });
  await expect(app.locator('#history li').first()).toContainText('10/3');
  await expect(value(app)).toHaveText(/3\.33/);
});

test('switching degrees and radians, or digits, works the answer on screen out again', async ({ app }) => {
  await ask(app, 'sin(30)');
  await expect(value(app)).toHaveText('0.5');
  await app.locator('#angle').click();
  await expect(value(app)).toHaveText(/−0\.988/);
  await app.locator('#angle').click();
  await expect(value(app)).toHaveText('0.5');

  await ask(app, '10/3');
  await app.locator('#open-settings').click();
  await app.locator('#settings select[name="digits"]').selectOption('6');
  await app.keyboard.press('Escape');
  await expect(value(app)).toHaveText('3.33333');
});

test('Copy works after a reload, and says so when there is nothing to copy', async ({ app, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'clipboard permissions are Chromium-only in Playwright');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await ask(app, '6*7');
  await app.reload();
  await expect(value(app)).toHaveText('42');
  await app.locator('#copy').click();
  expect(await app.evaluate(() => navigator.clipboard.readText())).toBe('42');
});

test('Clear empties Recent but keeps pinned answers, and Undo brings Recent back', async ({ app }) => {
  await ask(app, '1+1');
  await ask(app, '2+2');
  await app.locator('#history li').first().locator('.pin').click();
  await app.locator('#clear-history').click();
  await expect(app.locator('#pinned li')).toHaveCount(1);
  await expect(app.locator('#history li')).toHaveCount(0);
  await app.locator('.toast-action').click();
  await expect(app.locator('#history li')).toHaveCount(1);
  await expect(app.locator('#pinned li')).toHaveCount(1);
});

test('saving a variable leaves the main input alone; a bad value stays in the form', async ({ app }) => {
  await app.locator('#input').fill('12+');
  await app.locator('#toggle-vars').click();
  await app.getByLabel('Variable name').fill('r');
  await app.getByLabel('Value').fill('5');
  await app.getByRole('button', { name: 'Save' }).click();
  await expect(app.locator('#formulas').getByRole('button', { name: 'r = 5' })).toBeVisible();
  await expect(app.locator('#input')).toHaveValue('12+');
  await app.getByLabel('Variable name').fill('q');
  await app.getByLabel('Value').fill('3+');
  await app.getByRole('button', { name: 'Save' }).click();
  await expect(app.getByLabel('Value')).toHaveValue('3+');
  await expect(app.locator('#input')).toHaveValue('12+');
});

test('closing a drawer with Escape puts keyboard focus back on its button', async ({ app }) => {
  await app.locator('#open-settings').focus();
  await app.keyboard.press('Enter');
  await expect(app.locator('#settings')).toBeVisible();
  await app.waitForTimeout(250);
  await app.keyboard.press('Escape');
  await expect(app.locator('#open-settings')).toBeFocused();
});

test('a double-click on Settings opens it and leaves it open', async ({ app }) => {
  await app.locator('#open-settings').dblclick();
  await app.waitForTimeout(400);
  await expect(app.locator('#settings')).toBeVisible();
  await expect(app.locator('#settings')).not.toHaveClass(/closing/);
});

test('switching modes mid-typing shows each mode’s own answer under its own input', async ({ app }) => {
  await ask(app, '7*6');
  await app.locator('#input').fill('12+');
  await app.locator('#modes [data-mode="scientific"]').click();
  await ask(app, 'sin(90)');
  await expect(value(app)).toHaveText('1');
  await app.locator('#modes [data-mode="basic"]').click();
  await expect(app.locator('#input')).toHaveValue('12+');
  await expect(value(app)).toHaveText('42');
});

test('edge inputs read sensibly', async ({ app }) => {
  const input = app.locator('#input');
  await ask(app, '5!!');
  await expect(value(app)).toHaveText('15');
  await ask(app, 'x = 5');
  await expect(app.locator('#expr')).not.toHaveText(/=\s*$/);
  await input.fill('😀');
  await input.press('Enter');
  await expect(value(app)).toContainText('😀');
  await input.fill('('.repeat(3000) + '1' + ')'.repeat(3000));
  await input.press('Enter');
  await expect(value(app)).not.toContainText('call stack');
  await input.fill('log(0)');
  await input.press('Enter');
  await expect(value(app)).toContainText('undefined');
  await expect(value(app)).toHaveClass(/error/);
});

test('Escape on an empty input clears the screen back to 0', async ({ app }) => {
  await ask(app, '9*9');
  await expect(value(app)).toHaveText('81');
  await app.locator('#input').press('Escape');
  await expect(value(app)).toHaveText('0');
  await expect(app.locator('#copy')).toBeHidden();
});

test('a phone keeps the input on screen under a long worked answer, and nothing scrolls sideways', async ({ app, isMobile }) => {
  test.skip(!isMobile, 'phone layout');
  await ask(app, 'solve x^2-4=0');
  await expect(app.locator('.steps-slot, .derivation').locator('visible=true').first()).toBeVisible({ timeout: 30_000 });
  const box = (await app.locator('#input').boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(app.viewportSize()!.height + 1);
  await ask(app, '1e100/7');
  expect(await app.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
