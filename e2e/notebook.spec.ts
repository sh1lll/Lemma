import { readFileSync } from 'node:fs';
import { ask, expect, test, openTool } from './helpers';
import type { Page } from '@playwright/test';

async function openNew(app: Page) {
  await openTool(app, 'notebooks');
  await expect(app.locator('.notebook')).toBeVisible();
  await app.locator('.nb-list').selectOption('__new');
  await expect(app.locator('.nb-cell')).toHaveCount(1);
}

const cellOut = (app: Page, i: number) => app.locator('.nb-cell').nth(i).locator('.nb-out');

test('shared variables, live re-evaluation, data and graph cells', async ({ app }) => {
  await openNew(app);
  const first = app.locator('.nb-cell textarea').first();
  await first.fill('rate = 0.05\nyears = 10');
  await first.press('Shift+Enter');
  const second = app.locator('.nb-cell textarea').nth(1);
  await expect(second).toBeFocused();
  await second.fill('1000 * (1 + rate)^years');
  await expect(cellOut(app, 1)).toContainText('1,628.89462678');
  // Editing an earlier cell updates everything below it.
  await first.fill('rate = 0.1\nyears = 10');
  await expect(cellOut(app, 1)).toContainText('2,593.7424601');
  await expect(app.locator('.nb-vars')).toContainText('rate = 0.1');

  await app.locator('.nb-add .nb-btn', { hasText: 'Data' }).click();
  await app.locator('.nb-cell textarea').nth(2).fill('x,score\n1,2\n2,4\n3,7');
  await app.locator('.nb-add .nb-btn', { hasText: 'Math' }).click();
  await app.locator('.nb-cell textarea').nth(3).fill('mean of score');
  await expect(cellOut(app, 3)).toContainText('4.3333333333');

  await app.locator('.nb-add .nb-btn', { hasText: 'Math' }).click();
  await app.locator('.nb-cell textarea').nth(4).fill('graph x^2 - 4');
  await expect(app.locator('.nb-cell').nth(4).locator('.graph canvas')).toBeVisible();
});

test('persists, renames, exports and imports', async ({ app }) => {
  await openNew(app);
  await app.locator('.nb-title').fill('Budget');
  await app.locator('.nb-cell textarea').first().fill('x = 21\nx * 2');
  await expect(cellOut(app, 0)).toContainText('42');
  // The URL keeps #notebook, so a reload reopens the notebook directly.
  await app.reload();
  await expect(app.locator('.notebook')).toBeVisible();
  await expect(app.locator('.nb-title')).toHaveValue('Budget');
  await expect(cellOut(app, 0)).toContainText('42');

  const download = app.waitForEvent('download');
  await app.locator('.nb-btn', { hasText: 'Export' }).click();
  const file = await (await download).path();
  const json = readFileSync(file, 'utf8');
  expect(JSON.parse(json)).toMatchObject({ format: 'lemma-notebook', title: 'Budget' });

  await app.locator('.nb-more input[type=file]').setInputFiles({ name: 'copy.lemma.json', mimeType: 'application/json', buffer: Buffer.from(json.replace('Budget', 'Budget copy')) });
  await expect(app.locator('.nb-title')).toHaveValue('Budget copy');
  await expect(cellOut(app, 0)).toContainText('42');
});

test('send a calculator result to the notebook, and back', async ({ app }) => {
  await ask(app, '15% off 80');
  await app.locator('.chip', { hasText: 'Notebook' }).click();
  await openTool(app, 'notebooks');
  await expect(app.locator('.nb-cell textarea').last()).toHaveValue('15% off 80');
  await expect(app.locator('.nb-cell').last().locator('.nb-out')).toContainText('68');
  await app.locator('.nb-back').click();
  await expect(app.locator('#input')).toBeVisible();
  await app.goBack();
  await app.goForward();
  await expect(app.locator('#input')).toBeVisible();
});

test('cross-engine binding with SymPy', async ({ app, browserName, isMobile }) => {
  test.skip(browserName !== 'chromium' || isMobile, 'SymPy itself is covered per engine in symbolic.spec');
  test.setTimeout(240_000);
  await openNew(app);
  await app.locator('.nb-cell textarea').first().fill('f(x) = x^3 - 3x\ndf(x) = derivative of f(x)\ndf(2)\narea = integrate f(x) from 0 to 2\narea');
  await expect(cellOut(app, 0)).toContainText('df(2)  →  9', { timeout: 200_000 });
  await expect(cellOut(app, 0)).toContainText('area  →  −2');
  await expect(app.locator('.nb-vars')).toContainText('df(x)');
});

test('simulation cells: estimate with CI, exact comparison, histogram, reproducible re-run', async ({ app }) => {
  await openNew(app);
  // No AI configured: the notebook assistant stays hidden.
  await expect(app.locator('.nb-ask')).toBeHidden();
  const ta = app.locator('.nb-cell textarea').first();
  await ta.fill('simulate 10000: sum of 2 dice >= 10');
  const out = cellOut(app, 0);
  await expect(out.locator('.nb-sim-est')).toContainText(/P ≈ 0\.1[67]/);
  await expect(out.locator('.nb-sim-ci')).toContainText('95% CI');
  await expect(out.locator('.nb-sim-exact')).toContainText('1/6 ≈ 0.166667');
  await expect(out.locator('.nb-sim-exact')).toContainText('inside the 95% CI');
  // Sums 2–12, with 10, 11 and 12 highlighted as the event.
  await expect(out.locator('svg.nb-hist g')).toHaveCount(11);
  await expect(out.locator('svg.nb-hist rect.nb-hist-hit')).toHaveCount(3);
  await expect(out.locator('.nb-sim-meta')).toContainText('(from the line’s text)');

  await out.locator('.nb-sim-rerun').click();
  await expect(ta).toHaveValue(/^simulate 10000 seed \d+: sum of 2 dice >= 10$/);
  const seed = /seed (\d+)/.exec(await ta.inputValue())![1]!;
  await expect(out.locator('.nb-sim-meta')).toContainText(`seed ${seed} ·`);

  // 100k trials run in the worker; notebook variables are usable and the estimate can be bound to a name.
  await ta.fill('mu = 100\np = simulate 100000 seed 1: x = normal(mu, 15); x > 130\np * 1000');
  await expect(out.locator('.nb-sim-exact')).toContainText('0.02275');
  await expect(out.locator('.nb-sim-meta')).toContainText('100,000 trials · seed 1 ·');
  await expect(out).toContainText('p * 1000  →  2');
  await expect(app.locator('.nb-vars')).toContainText('p = 0.02');
});
