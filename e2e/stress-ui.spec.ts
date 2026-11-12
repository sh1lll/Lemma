import type { Page } from '@playwright/test';
import { expect, test, value } from './helpers';

// UI limits: opening and closing everything over and over leaves nothing behind, the layout holds at every size,
// and a long session stays correct. Budgets are loose; they catch leaks, stuck overlays and runaway slowdowns.

// The page's own elements (code fetched ahead of time adds <link>s to <head>, which isn't a leak).
const nodes = (page: Page) => page.evaluate(() => document.body.getElementsByTagName('*').length);
const openDialogs = (page: Page) => page.evaluate(() => [...document.querySelectorAll('dialog[open]')].map((d) => d.id));
/** The page scrolls sideways (something sticks out past the right edge). */
/** Open for real: modal, not the still picture of a sheet on its way out (which is visible too). */
const modal = (page: Page, sel: string) => expect.poll(() => page.evaluate((s) => document.querySelector(s)!.matches(':modal'), sel)).toBe(true);
const overflowX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

/** The calculator still takes input and answers once everything above it has gone. */
async function stillWorks(page: Page, q = '6*7', a = '42') {
  await expect.poll(() => openDialogs(page)).toEqual([]);
  await page.locator('#input').fill(q);
  await page.locator('#input').press('Enter');
  await expect(value(page)).toHaveText(a);
}

test.describe('UI stress', () => {
  test('every drawer opened and shut 15 times in a row leaves nothing open and nothing behind', async ({ app }) => {
    const round = async () => {
      for (const [btn, dlg] of [['#open-settings', '#settings'], ['#open-tips', '#tips'], ['#open-study', '#study']]) {
        await app.locator(btn).click();
        await modal(app, dlg);
        await app.keyboard.press('Escape');
      }
    };
    // The first opening builds each drawer's contents; after that, every round should add nothing.
    await round();
    await app.waitForTimeout(400);
    const before = await nodes(app);
    for (let i = 0; i < 14; i++) await round();
    await app.waitForTimeout(400);
    expect(await nodes(app)).toBeLessThanOrEqual(before + 5);
    await stillWorks(app);
  });

  test('clicking a drawer button as fast as possible never strands a half-closed sheet', async ({ app }) => {
    for (let i = 0; i < 20; i++) {
      await app.locator('#open-settings').click();
      await modal(app, '#settings');
      await app.keyboard.press('Escape');
    }
    await app.locator('#open-settings').click();
    await expect(app.locator('#settings')).toBeVisible();
    await expect(app.locator('#settings')).not.toHaveClass(/closing/);
    await app.keyboard.press('Escape');
    await stillWorks(app);
  });

  test('each tool opened and closed 5 times: no leftovers, no growth, the calculator still works', async ({ app }) => {
    test.setTimeout(120_000);
    await app.waitForTimeout(500);
    const tools = ['geometry', 'physics', 'practice', 'test', 'notes', 'agenda', 'lecture', 'videos'];
    // Warm each one once (first opens load code and build caches), then measure.
    const cycle = async () => {
      for (const t of tools) {
        await app.locator('#open-study').click();
        await app.locator(`.tool-row[data-tool="${t}"]`).click();
        await expect(app.locator('#tool')).toBeVisible();
        await app.locator('#tool-close').click();
        await expect(app.locator('#tool')).toBeHidden();
      }
    };
    await cycle();
    await app.waitForTimeout(400);
    const base = await nodes(app);
    for (let i = 0; i < 4; i++) await cycle();
    await app.waitForTimeout(400);
    expect(await nodes(app)).toBeLessThan(base + 60);
    await stillWorks(app);
  });

  test('the whiteboard opened and left 6 times leaves no board behind', async ({ app }) => {
    test.setTimeout(90_000);
    for (let i = 0; i < 6; i++) {
      await app.locator('#open-study').click();
      await app.locator('.tool-row[data-tool="whiteboard"]').click();
      await expect(app.locator('.wb-done')).toBeVisible({ timeout: 15_000 });
      await app.locator('.wb-done').click();
      await expect(app.locator('.wb-view')).toHaveCount(0);
    }
    await expect(app.locator('html')).not.toHaveClass(/wb-open/);
    await stillWorks(app);
  });

  test('switching modes 40 times lands in the last one chosen with a working keypad', async ({ app }) => {
    const radios = app.locator('#modes [role=radio]');
    const n = await radios.count();
    for (let i = 0; i < 40; i++) await radios.nth(i % n).click();
    await radios.nth(1).click();
    await expect(radios.nth(1)).toHaveAttribute('aria-checked', 'true');
    await radios.nth(0).click();
    await stillWorks(app);
  });

  test('the layout holds at every size, with an answer, steps and a graph on screen', async ({ app, isMobile }) => {
    test.skip(isMobile, 'phones have one size');
    test.setTimeout(60_000);
    await app.locator('#input').fill('solve x^2-5x+6=0');
    await app.locator('#input').press('Enter');
    await expect(value(app)).toContainText('x', { timeout: 40_000 });
    for (const [w, h] of [[1440, 900], [1024, 700], [768, 1024], [600, 800], [414, 896], [375, 667], [320, 568], [1280, 400]]) {
      await app.setViewportSize({ width: w, height: h });
      await app.waitForTimeout(120);
      expect(await overflowX(app), `sideways scroll at ${w}×${h}`).toBeLessThanOrEqual(1);
    }
    await app.locator('#input').fill('graph sin(x)/x');
    await app.locator('#input').press('Enter');
    await expect(app.locator('#graph-slot canvas, #graph-slot svg').first()).toBeVisible();
    for (const [w, h] of [[320, 568], [1280, 800], [375, 667]]) {
      await app.setViewportSize({ width: w, height: h });
      await app.waitForTimeout(150);
      expect(await overflowX(app), `sideways scroll with a graph at ${w}×${h}`).toBeLessThanOrEqual(1);
    }
  });

  test('a 120-question session stays correct to the end', async ({ app }) => {
    test.setTimeout(90_000);
    const input = app.locator('#input');
    for (let i = 1; i <= 120; i++) {
      await input.fill(i % 3 === 0 ? `${i} km in m` : i % 3 === 1 ? `${i}*${i}` : `${i}% of 200`);
      await input.press('Enter');
    }
    await expect(value(app)).toHaveText(/^120,000\s?m$/);
    await expect(app.locator('#history li')).toHaveCount(50);
    await stillWorks(app);
  });

  test('opening a drawer never blocks the main thread for long', async ({ app, browserName }) => {
    test.skip(browserName !== 'chromium', 'long tasks are reported by Chromium only');
    await app.waitForTimeout(800);
    const longest = await app.evaluate(async () => {
      const seen: number[] = [];
      const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => seen.push(e.duration)));
      po.observe({ type: 'longtask' });
      for (const id of ['open-settings', 'open-tips', 'open-study', 'open-symbols']) {
        document.getElementById(id)!.click();
        await new Promise((r) => setTimeout(r, 350));
        document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((d) => d.close());
        await new Promise((r) => setTimeout(r, 300));
      }
      po.disconnect();
      return Math.max(0, ...seen);
    });
    expect(longest).toBeLessThan(150);
  });
});
