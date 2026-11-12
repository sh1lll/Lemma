import { type Locator, type Page } from '@playwright/test';
import { expect, test, value } from './helpers';

const mode = (page: Page, m: 'basic' | 'scientific' | 'graphing') => page.locator(`.modes [data-mode="${m}"]`).click();

/** Coloured (curve) pixels on a graph canvas: grid lines and the background are grey, curves are not. */
async function inked(canvas: Locator): Promise<number> {
  return canvas.evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 16) if (Math.max(d[i]!, d[i + 1]!, d[i + 2]!) - Math.min(d[i]!, d[i + 1]!, d[i + 2]!) > 25) n++;
    return n;
  });
}

test('modes switch from the control and the keyboard, each keeps its own input, and the choice is remembered', async ({ app }) => {
  const input = app.locator('#input');
  await expect(app.locator('.modes [data-mode="basic"]')).toHaveAttribute('aria-checked', 'true');
  await input.fill('1 + 1');
  await mode(app, 'scientific');
  await expect(app.locator('#keypad.sci')).toBeVisible();
  await expect(input).toHaveValue('');
  await input.fill('2 * 3');
  await expect(value(app)).toHaveText('6');
  await mode(app, 'basic');
  await expect(input).toHaveValue('1 + 1');
  await expect(value(app)).toHaveText('2');
  await mode(app, 'scientific');
  await expect(input).toHaveValue('2 * 3');

  await mode(app, 'graphing');
  await expect(app.locator('.gw')).toBeVisible();
  await expect(input).toBeHidden();
  await app.locator('.gw-input').first().fill('y = 2x');
  await mode(app, 'basic');
  await expect(app.locator('.gw')).toBeHidden();
  await expect(input).toHaveValue('1 + 1');
  await mode(app, 'matrix');
  await expect(app.locator('.mx')).toBeVisible();
  await expect(input).toBeHidden();
  await mode(app, 'basic');
  await expect(app.locator('.mx')).toBeHidden();
  await expect(input).toHaveValue('1 + 1');

  // Alt+2 / Alt+3 / Alt+1
  await input.press('Alt+2');
  await expect(app.locator('.modes [data-mode="scientific"]')).toHaveAttribute('aria-checked', 'true');
  await input.press('Alt+3');
  await expect(app.locator('.gw-input').first()).toHaveValue('y = 2x');

  // Remembered after a reload, rows and all.
  await app.waitForTimeout(400); // rows save after a short pause
  await app.reload();
  await expect(app.locator('.modes [data-mode="graphing"]')).toHaveAttribute('aria-checked', 'true');
  await expect(app.locator('.gw-input').first()).toHaveValue('y = 2x');
  // …and in Settings.
  await app.locator('#open-settings').click();
  await expect(app.locator('select[name="calcMode"]')).toHaveValue('graphing');
  await app.locator('select[name="calcMode"]').selectOption('basic');
  await app.keyboard.press('Escape');
  await expect(app.locator('.modes [data-mode="basic"]')).toHaveAttribute('aria-checked', 'true');
  await expect(input).toBeVisible();
});

test('scientific: typing a graph request never flips the preview into a graph; a committed graph stays until the next commit', async ({ app }) => {
  await mode(app, 'scientific');
  const input = app.locator('#input');
  await input.click();
  // Record every moment the graph slot holds anything while typing.
  await app.evaluate(() => {
    const slot = document.getElementById('graph-slot')!;
    (window as unknown as { graphSeen: number }).graphSeen = 0;
    new MutationObserver(() => {
      if (slot.childElementCount) (window as unknown as { graphSeen: number }).graphSeen++;
    }).observe(slot, { childList: true, subtree: true });
  });
  const seen = () => app.evaluate(() => (window as unknown as { graphSeen: number }).graphSeen);
  for (const ch of 'graph sin(x)') {
    await input.press(ch === ' ' ? 'Space' : ch);
    await expect(app.locator('#graph-slot canvas')).toHaveCount(0);
  }
  // Delete and add characters: "graph sin" … "graph sin(x)+1".
  for (let i = 0; i < 3; i++) {
    await input.press('Backspace');
    await expect(app.locator('#graph-slot canvas')).toHaveCount(0);
  }
  for (const ch of '(x)+1') {
    await input.press(ch);
    await expect(app.locator('#graph-slot canvas')).toHaveCount(0);
  }
  await app.waitForTimeout(250);
  expect(await seen()).toBe(0);
  await expect(app.locator('#meta')).toContainText(/to draw the graph/);

  // Enter draws it; it then stays while the next thing is typed (numbers preview above it).
  await input.press('Enter');
  const canvas = app.locator('#graph-slot .graph canvas').first();
  await expect(canvas).toBeVisible();
  await canvas.evaluate((c) => ((c as unknown as { tagged: boolean }).tagged = true));
  for (const ch of '2+3') await input.press(ch);
  await expect(value(app)).toHaveText('5');
  await input.press('Backspace');
  await input.press('Backspace');
  for (const ch of 'graph cos(x') await input.press(ch === ' ' ? 'Space' : ch);
  await expect(canvas).toBeVisible();
  expect(await canvas.evaluate((c) => (c as unknown as { tagged?: boolean }).tagged === true)).toBe(true);

  // The next commit replaces it.
  await input.fill('2 + 3');
  await input.press('Enter');
  await expect(value(app)).toHaveText('5');
  await expect(app.locator('#graph-slot canvas')).toHaveCount(0);
});

test('basic: a half-typed input keeps the last answer on screen (faded) instead of blanking it', async ({ app }) => {
  const input = app.locator('#input');
  await input.fill('12 * 3');
  await expect(value(app)).toHaveText('36');
  await input.fill('12 * 3 +');
  await expect(value(app)).toHaveText('36');
  await expect(value(app)).toHaveClass(/quiet/);
  await input.fill('12 * 3 + 4');
  await expect(value(app)).toHaveText('40');
  await expect(value(app)).not.toHaveClass(/quiet/);
});

test('scientific keyboard: trig with the angle toggle, inverse trig in func, memory and the sign', async ({ app }) => {
  await mode(app, 'scientific');
  const kb = app.locator('#keypad .mkb');
  const key = (name: string) => kb.locator('.mkb-pane:not([hidden])').getByRole('button', { name, exact: true });
  const input = app.locator('#input');
  await key('sine').click();
  await key('3').click();
  await key('0').click();
  await expect(input).toHaveValue('sin(30)');
  await expect(value(app)).toHaveText('0.5');
  await kb.getByRole('button', { name: 'Clear all' }).click();
  await kb.getByRole('tab', { name: 'func keys' }).click();
  await key('Inverse sine').click();
  await input.pressSequentially('0.5');
  await expect(input).toHaveValue('asin(0.5)');
  await expect(value(app)).toHaveText('30°');
  await kb.getByRole('tab', { name: 'main keys' }).click();
  // Memory: 7 M+, 5 M+, MR → 12
  await input.fill('7');
  await key('Add to memory').click();
  await input.fill('5');
  await key('Add to memory').click();
  await input.fill('');
  await key('Recall memory').click();
  await expect(input).toHaveValue('12');
  await key('Subtract from memory').click();
  await input.fill('');
  await key('Recall memory').click();
  await expect(input).toHaveValue('0');
  // The angle toggle follows the setting.
  await kb.getByRole('button', { name: /^Angle mode/ }).click();
  await expect(app.locator('#angle')).toHaveText('RAD');
  await kb.getByRole('button', { name: /^Angle mode/ }).click();
  await expect(app.locator('#angle')).toHaveText('DEG');
});

test('graphing: an invalid row keeps its last good plot, faded, with a hint; the graph never blanks', async ({ app }) => {
  await mode(app, 'graphing');
  const row = app.locator('.gw-input').first();
  await row.fill('y = x^2 - 3');
  const canvas = app.locator('.gw .graph-stage canvas');
  await expect.poll(() => inked(canvas)).toBeGreaterThan(40);
  const before = await inked(canvas);
  await canvas.evaluate((c) => ((c as unknown as { tagged: boolean }).tagged = true));
  await row.press('End');
  // Every keystroke of a broken edit: the curve stays drawn.
  for (const ch of [' ', '+', ' ', '*']) {
    await row.press(ch === ' ' ? 'Space' : ch);
    await app.waitForTimeout(60);
    expect(await inked(canvas)).toBeGreaterThan(before * 0.2);
  }
  await expect(app.locator('.gw-row').first()).toHaveClass(/stale/);
  await expect(app.locator('.gw-hint').first()).toBeVisible();
  await expect(app.locator('.gw-hint').first()).toContainText('last version');
  expect(await inked(canvas)).toBeGreaterThan(before * 0.2);
  // Fixing it brings it back to full strength, same canvas throughout.
  await row.press('Backspace');
  await row.pressSequentially('2');
  await expect(app.locator('.gw-row').first()).not.toHaveClass(/stale/);
  await expect(app.locator('.gw-hint').first()).toBeHidden();
  expect(await canvas.evaluate((c) => (c as unknown as { tagged?: boolean }).tagged === true)).toBe(true);
});

test('graphing: rows add, hide, delete; sliders drive other rows', async ({ app }) => {
  await mode(app, 'graphing');
  const rows = app.locator('.gw-input');
  await rows.first().fill('y = a*x');
  await rows.first().press('Enter');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toBeFocused();
  await rows.nth(1).fill('a = 2');
  const range = app.locator('.gw-row').nth(1).locator('input[type=range]');
  await expect(range).toBeVisible();
  // "a" is defined by its row, so no automatic slider for it under the graph.
  await expect(app.locator('.gw .graph-slider')).toHaveCount(0);
  await range.fill('5');
  await expect(rows.nth(1)).toHaveValue('a = 5');
  await app.getByRole('button', { name: 'Hide expression 1' }).click();
  await expect(app.getByRole('button', { name: 'Show expression 1' })).toHaveAttribute('aria-pressed', 'false');
  await app.getByRole('button', { name: 'Delete expression 2' }).click();
  await expect(rows).toHaveCount(1);
  await expect(app.locator('.gw .graph-slider')).toHaveCount(1); // now "a" is a free parameter again
});

test('modes fit a 360px screen at the largest text size', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.addInitScript(() => localStorage.setItem('lemma.settings.v1', JSON.stringify({ textSize: 'xl', calcMode: 'scientific', warmOnStart: false })));
  await page.goto('/');
  await expect(page.locator('#keypad.sci')).toBeVisible();
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(1);
  const bar = await page.locator('.bar').boundingBox();
  expect(bar!.x + bar!.width).toBeLessThanOrEqual(361);
  await page.locator('.modes [data-mode="graphing"]').click();
  await expect(page.locator('.gw')).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(1);
});
