import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test as base } from './helpers';

// Like the shared `app` fixture, minus one harness artifact: with `serviceWorkers: 'block'`, Playwright touches
// navigator.serviceWorker in every frame, which throws inside the opaque-origin sandbox that runs script extensions.
const test = base.extend<{ app: Page }>({
  app: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => !/service ?worker.*sandboxed/i.test(e.message) && errors.push(e.message));
    await page.goto('/');
    await expect(page.locator('#input')).toBeVisible();
    await use(page);
    expect(errors, 'uncaught page errors').toEqual([]);
  },
});

// Extensions → Marketplace: the signed index bundled with the app (offline), install with the usual approval,
// update checks, and an online index whose signature and hashes are checked.

const SITE = join(import.meta.dirname, '..', 'packages', 'marketplace', 'site');
const site = (p: string) => readFileSync(join(SITE, p), 'utf8');

/** Settings → Extensions → Manage… (retries the first click: on a cold dev server the settings handler binds late). */
async function openExtensions(page: Page) {
  await expect(async () => {
    if (!(await page.locator('#open-extensions').isVisible())) await page.locator('#open-settings').click();
    await page.locator('#open-extensions').click({ timeout: 1000 });
    await expect(page.locator('#extensions')).toBeVisible({ timeout: 1000 });
  }).toPass();
}

async function openMarket(page: Page) {
  await openExtensions(page);
  const ext = page.locator('#extensions');
  await ext.locator('button[data-tab="market"]').click();
  await expect(ext.locator('.market-status')).toContainText('updated');
  return ext;
}

const ask = async (page: Page, q: string) => {
  await page.locator('#input').fill(q);
  await page.locator('#input').press('Enter');
};

test('browse, search, filter and install from the built-in marketplace', async ({ app: page }) => {
  const ext = await openMarket(page);
  await expect(ext.locator('.market-status')).toContainText('Listing built into the app');
  await expect(ext.locator('.market-entry')).toHaveCount(13);
  // No fabricated social proof.
  await expect(ext.locator('.market')).not.toContainText('★');
  await expect(ext.locator('.market')).not.toContainText(/\d+ (ratings|reviews|downloads|installs)/i);

  await ext.locator('.market-search').fill('resistor');
  await expect(ext.locator('.market-entry')).toHaveCount(1);
  await ext.locator('.market-search').press('Enter'); // must not close the dialog
  await expect(ext).toBeVisible();
  await ext.locator('.market-entry', { hasText: 'LED resistor' }).getByRole('button', { name: /Install/ }).click();
  await expect(ext.locator('.market-entry', { hasText: 'LED resistor' })).toContainText('Installed ✓');

  await ext.locator('.market-search').fill('');
  await ext.locator('.market-category').selectOption('cooking');
  await expect(ext.locator('.market-entry')).toHaveCount(1);
  await ext.locator('.market-entry', { hasText: 'Recipe scaler' }).getByRole('button', { name: /Install/ }).click();
  await expect(ext.locator('.market-entry', { hasText: 'Recipe scaler' })).toContainText('Installed ✓');

  // A script extension goes through the same approval prompt; declining installs nothing.
  await ext.locator('.market-category').selectOption('');
  await ext.locator('.market-search').fill('roman');
  const roman = ext.locator('.market-entry', { hasText: 'Roman numerals' });
  await expect(roman).toContainText('no internet access');
  page.once('dialog', (d) => {
    expect(d.message()).toContain('runs its own code');
    void d.dismiss();
  });
  await roman.getByRole('button', { name: /Install/ }).click();
  await expect(roman.getByRole('button', { name: /Install/ })).toBeEnabled();
  page.once('dialog', (d) => void d.accept());
  await roman.getByRole('button', { name: /Install/ }).click();
  await expect(roman).toContainText('Installed ✓');

  await ext.locator('button[data-tab="mine"]').click();
  await expect(ext.locator('.ext-toggle')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await ask(page, 'led resistor 5 v 2 v 20 ma');
  await expect(page.locator('#value')).toHaveText(/^150\s*Ω?$/);
  await ask(page, 'scale 250 from 4 to 6 servings');
  await expect(page.locator('#value')).toHaveText('375.00');
  await ask(page, '2026 in roman numerals');
  await expect(page.locator('#value')).toHaveText('MMXXVI');
});

test('offers updates for installed extensions with a newer release', async ({ app: page }) => {
  const bundle = JSON.parse(site('bundle.json')) as { manifests: Record<string, { release: string; description: string }> };
  const old = { ...bundle.manifests['lemma.bmi']!, release: '0.9.0', description: 'Old version' };
  await page.evaluate((m) => localStorage.setItem('lemma.plugins.v1', JSON.stringify([{ manifest: m, enabled: true, installedAt: 1, granted: [] }])), old);
  await page.reload();
  await openExtensions(page);
  const ext = page.locator('#extensions');
  await expect(ext.locator('button[data-tab="market"]')).toHaveText('Marketplace · 1 update');
  await ext.locator('button[data-tab="market"]').click();
  await expect(ext.locator('.market-results h3').first()).toHaveText('1 update');
  const card = ext.locator('.market-entry', { hasText: 'BMI' }).first();
  await expect(card).toContainText('Installed 0.9.0');
  await card.getByRole('button', { name: /Update to 1\.0\.0/ }).click();
  await expect(ext.locator('.market-results h3')).toHaveCount(0);
  await expect(ext.locator('.market-entry', { hasText: 'BMI' })).toContainText('Installed ✓');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('lemma.plugins.v1')!) as { manifest: { release: string } }[]);
  expect(stored.map((p) => p.manifest.release)).toEqual(['1.0.0']);
});

test('online index: verified listing; a swapped manifest or an altered index is refused', async ({ app: page }) => {
  const HOST = 'https://market.lemma.test';
  let tamperManifest = false;
  let tamperIndex = false;
  await page.route(`${HOST}/**`, (route) => {
    const path = new URL(route.request().url()).pathname.slice(1);
    let body = site(path);
    if (path === 'index.json' && tamperIndex) body = body.replace('Series resistor', 'Series resistor (now free!)');
    if (path.startsWith('manifests/lemma.led-resistor/') && tamperManifest) body = body.replace('(supply - forward) / (current / 1000)', '1');
    return route.fulfill({ body, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.evaluate((u) => localStorage.setItem('lemma.marketplace-url', u), `${HOST}/index.json`);
  await page.reload();

  // 1. Genuine online index; the host serves a modified manifest → hash mismatch, nothing installed.
  tamperManifest = true;
  let ext = await openMarket(page);
  await expect(ext.locator('.market-status')).toContainText('Online listing');
  await ext.locator('.market-search').fill('resistor');
  await ext.locator('.market-entry').getByRole('button', { name: /Install/ }).click();
  await expect(page.locator('#toast')).toContainText('hash mismatch');
  await expect(ext.locator('.market-entry')).not.toContainText('Installed');

  // Served correctly, it installs.
  tamperManifest = false;
  await ext.locator('.market-entry').getByRole('button', { name: /Install/ }).click();
  await expect(ext.locator('.market-entry')).toContainText('Installed ✓');

  // 2. An altered index fails its signature: the app falls back to its built-in copy and says why.
  tamperIndex = true;
  await page.reload();
  ext = await openMarket(page);
  await expect(ext.locator('.market-status')).toContainText('Listing built into the app');
  await expect(ext.locator('.market-note')).toContainText('signature');
  await expect(ext.locator('.market')).not.toContainText('now free');
});
