import { test, expect, openTool } from './helpers';

test('Add to browser: the button matches this browser and the download is a real package', async ({ app, browserName, isMobile }) => {
  await openTool(app, 'extension');
  const body = app.locator('#tool-body');
  await expect(body.locator('.ext-features li')).toHaveCount(4);
  const btn = body.locator('.ext-install-btn');
  await expect(btn).toBeVisible();
  if (browserName === 'webkit' || isMobile) {
    // Safari: not on the App Store yet. Android: Chrome there has no extensions. Either way the button says so
    // instead of offering something that won't work.
    await expect(btn).toBeDisabled();
    return;
  }
  const href = await btn.getAttribute('href');
  expect(href).toMatch(browserName === 'firefox' ? /lemma-firefox\.zip$/ : /lemma-chrome\.zip$/);
  const res = await app.request.get(new URL(href!, app.url()).href);
  expect(res.status()).toBe(200);
  const bytes = await res.body();
  expect(bytes.subarray(0, 2).toString()).toBe('PK'); // a zip
  expect(bytes.length).toBeGreaterThan(1_000_000);
  await expect(body.locator('.ext-install-copy code')).toHaveText(browserName === 'firefox' ? /about:debugging/ : /:\/\/extensions$/);
});

test('Add to browser is in Settings too, and the install link the desktop app uses opens it', async ({ app }) => {
  await app.locator('#open-settings').click();
  await app.locator('#open-add-to-browser').click();
  await expect(app.locator('#tool-title')).toHaveText('Add to browser');
  await app.goto('/#add-to-browser');
  await expect(app.locator('#tool-title')).toHaveText('Add to browser');
});
