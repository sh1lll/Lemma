import { ask, expect, test, value } from './helpers';

// Downloads Pyodide + SymPy from the CDN in each engine (WebAssembly in Chromium, Firefox and WebKit).
test('SymPy works in this engine', async ({ app, isMobile }) => {
  test.skip(isMobile, 'covered by the desktop engines');
  test.setTimeout(240_000);
  const input = app.locator('#input');
  await input.fill('integrate x^2 from 0 to 3');
  await input.press('Enter');
  await expect(value(app)).toHaveText('9', { timeout: 200_000 });
  await expect(app.locator('#meta')).toContainText('verified');
  await expect(app.locator('.math .katex')).toBeVisible();
  await ask(app, 'sqrt(-4)');
  await expect(value(app)).toHaveText('2i');
});

// A bare expression with letters and no "=" answers usefully instead of "Unknown name".
test('bare expressions: factored form, and a hint for a lone letter', async ({ app, isMobile }) => {
  test.skip(isMobile, 'covered by the desktop engines');
  test.setTimeout(240_000);
  const input = app.locator('#input');
  // A lone letter while typing: no error, then a soft hint once typing pauses.
  await input.fill('x');
  await expect(value(app)).not.toHaveClass(/error/);
  await expect(app.locator('#meta')).toContainText('Add “= …” to solve', { timeout: 3_000 });
  await expect(app.locator('.result')).not.toContainText('Unknown name');
  // Committed: still a hint, not an error, and not added to history.
  await input.press('Enter');
  await expect(value(app)).toHaveText('x');
  await expect(value(app)).not.toHaveClass(/error/);
  await expect(app.locator('#meta')).toContainText('give x a value');
  await expect(app.locator('#history li')).toHaveCount(0);

  await input.fill('x^2 + 2x + 1');
  await input.press('Enter');
  await expect(value(app)).toHaveText('(x + 1)²', { timeout: 200_000 });
  await expect(app.locator('#expr')).toContainText('Factored');
  await expect(app.locator('#lines')).toContainText('x² + 2x + 1');
});
