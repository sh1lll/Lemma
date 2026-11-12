import { ask, expect, openTool, test, value } from './helpers';

// Tools and answers: questions about a formula never overwrite it, shortcuts don't open things behind a full-screen
// tool, notices show above sheets, and the wording people actually use is understood.

test('"solve g(x) = 0" solves for x and leaves g as it was', async ({ app }) => {
  test.setTimeout(90_000);
  await ask(app, 'g(x) = 2x + 3');
  await app.locator('#input').fill('solve g(x) = 0');
  await app.locator('#input').press('Enter');
  await expect(value(app)).toContainText('3/2', { timeout: 60_000 });
  await ask(app, 'g(1)');
  await expect(value(app)).toHaveText('5');
});

test('⌘/Ctrl+K does nothing over the whiteboard', async ({ app, isMobile }) => {
  test.skip(isMobile, 'keyboard shortcut');
  await openTool(app, 'whiteboard');
  await expect(app.locator('.wb-done')).toBeVisible({ timeout: 15_000 });
  await app.keyboard.press('ControlOrMeta+k');
  await app.waitForTimeout(300);
  await expect(app.locator('#study')).toBeHidden();
});

test('Enter in an empty tool search opens nothing', async ({ app }) => {
  await app.locator('#open-study').click();
  await app.locator('#tool-search').focus();
  await app.keyboard.press('Enter');
  await app.waitForTimeout(300);
  await expect(app.locator('#study')).toBeVisible();
  await expect(app.locator('.wb-view')).toHaveCount(0);
});

test('a notice from inside a tool sheet shows above the sheet', async ({ app }) => {
  await openTool(app, 'notes');
  const box = app.locator('#tool-body .note-composer input');
  await box.fill('chain rule #calc');
  await box.press('Enter');
  // The box keeps the cursor for the next note.
  await expect(box).toBeFocused();
  await box.fill('');
  await app.locator('#tool-body .note-composer button').click();
  await app.locator('#tool-close').click();
  await app.locator('#toggle-vars').click();
  await app.getByLabel('Variable name').fill('k');
  await app.getByLabel('Value').fill('2');
  await app.locator('#var-editor button[type="submit"]').click();
  await expect(app.locator('#toast')).toBeVisible();
  await openTool(app, 'lecture');
  await app.getByRole('button', { name: 'Summarize text' }).click();
  const toast = app.locator('#toast');
  await expect(toast).toHaveText(/Nothing to summarize/);
  // On top: shown in the top layer (above the sheet and its backdrop) wherever the browser has popovers.
  const onTop = await toast.evaluate((t) => !('showPopover' in t) || t.matches(':popover-open'));
  expect(onTop).toBe(true);
});

test('reverse percentages, limits-first integrals, typos and the hypotenuse are understood', async ({ app }) => {
  test.setTimeout(90_000);
  await ask(app, '30 is 20% of what');
  await expect(value(app)).toHaveText('150');
  await ask(app, 'what percent is 45 of 60');
  await expect(value(app)).toHaveText('75%');
  await ask(app, 'hypotenuse of 3 and 4');
  await expect(value(app)).toHaveText('5');
  await ask(app, 'sqroot 25');
  await expect(value(app)).toHaveText('5');
  await ask(app, 'log2(8)');
  await expect(app.locator('#expr')).toContainText('log₂(8)');
  await ask(app, 'asin(0.5)');
  await expect(value(app)).toHaveText('30°');
  await ask(app, '2^64');
  await expect(app.locator('#meta')).toContainText('18,446,744,073,709,551,616');
  await app.locator('#input').fill('integral from 0 to 1 of x^2');
  await app.locator('#input').press('Enter');
  await expect(value(app)).toContainText('1/3', { timeout: 60_000 });
});

test('a complex-root quadratic: the working reaches the same roots as the answer', async ({ app }) => {
  test.setTimeout(90_000);
  await app.locator('#input').fill('solve x^2 + 4x + 5 = 0');
  await app.locator('#input').press('Enter');
  await expect(value(app)).toContainText('i', { timeout: 60_000 });
  const steps = app.locator('.steps-slot');
  await expect(steps).toContainText('i', { timeout: 30_000 });
  await expect(steps).not.toContainText('no solution');
  await expect(steps).not.toContainText('no real solution');
});
