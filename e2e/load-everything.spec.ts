import { test, expect, ask } from './helpers';

test('Recent folds away behind its arrow, and stays folded', async ({ app }) => {
  await ask(app, '12 * 7');
  const toggle = app.getByRole('button', { name: 'Recent' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(app.locator('#history li').first()).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(app.locator('#history')).toBeHidden();
  await app.reload();
  await expect(app.getByRole('button', { name: 'Recent' })).toHaveAttribute('aria-expanded', 'false');
  await expect(app.locator('#history')).toBeHidden();
  await app.getByRole('button', { name: 'Recent' }).click();
  await expect(app.locator('#history li').first()).toBeVisible();
});

test('Settings → Load everything gets every part ready and says so', async ({ app, browserName }) => {
  test.setTimeout(120_000);
  await app.locator('#open-settings').click();
  await app.getByRole('button', { name: 'Load everything' }).click();
  const steps = app.locator('#warm-steps');
  await expect(steps).toBeVisible();
  for (const id of ['engines', 'graphs', 'study', 'notebooks']) await expect(steps.locator(`[data-step="${id}"]`)).toHaveAttribute('data-state', 'done', { timeout: 30_000 });
  // The optional models aren't fetched unless ticked.
  await expect(steps.locator('[data-step="voice"]')).toHaveCount(0);
  if (browserName === 'chromium') {
    // Python and SymPy come from the CDN: allow for the download.
    await expect(steps.locator('[data-step="algebra"]')).toHaveAttribute('data-state', 'done', { timeout: 100_000 });
    await expect(steps.locator('[data-step="offline"]')).toHaveAttribute('data-state', 'skipped', { timeout: 10_000 }); // service workers are blocked in tests
    await expect(app.locator('#warm-when')).toContainText('Everything was loaded');
  }
});

test('typing something symbolic starts the algebra engine before Enter', async ({ app, browserName }) => {
  test.skip(browserName !== 'chromium', 'one engine is enough: it checks a network request');
  const started = app.waitForRequest(/pyodide/, { timeout: 15_000 });
  await app.locator('#input').pressSequentially('derivative of x^3');
  await started;
});

test('pointing at a Study tool loads its code ahead of the click', async ({ app, isMobile }) => {
  test.skip(isMobile, 'touch has no hover; touchstart covers it there');
  await app.locator('#open-study').click();
  const loaded = app.waitForRequest(/\/assets\/(?:lab|physics)[^/]*\.js/, { timeout: 10_000 });
  await app.locator('.tool-row[data-tool="physics"]').hover();
  await loaded;
});

test('typing "load everything" runs it too', async ({ app }) => {
  await app.locator('#input').fill('load everything');
  await app.locator('#input').press('Enter');
  await expect(app.getByText('Loading everything in the background…')).toBeVisible();
});
