import { expect, test, value, openTool } from './helpers';

// UI stress and limits. Budgets are generous (CI machines vary) but would catch hangs and pathological slowdowns.
test.describe('UI stress', () => {
  test('400 rapid keystrokes with live preview stay responsive and correct', async ({ app }) => {
    const input = app.locator('#input');
    await input.click();
    const expr = Array.from({ length: 100 }, (_, i) => `${i % 9 + 1}`).join('+');
    const t0 = Date.now();
    await input.pressSequentially(expr, { delay: 0 });
    const ms = Date.now() - t0;
    await expect(value(app)).toHaveText('496');
    expect(ms).toBeLessThan(15_000);
    // Main-thread blocking during typing (Chromium exposes long tasks).
    const longTasks = await app.evaluate(() => (performance.getEntriesByType('longtask') as PerformanceEntry[]).filter((e) => e.duration > 200).length);
    expect(longTasks).toBe(0);
  });

  test('a 50,000-character paste does not freeze the page', async ({ app }) => {
    const big = Array.from({ length: 10_000 }, (_, i) => i % 10).join('+');
    const t0 = Date.now();
    await app.locator('#input').fill(big);
    await expect(value(app)).toHaveText('45,000');
    expect(Date.now() - t0).toBeLessThan(5000);
    // Still interactive afterwards.
    await app.locator('#input').fill('2+2');
    await expect(value(app)).toHaveText('4');
  });

  test('1,000 history entries load quickly and the app stays usable', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const h = Array.from({ length: 1000 }, (_, i) => ({ id: `h${i}`, input: `${i} + 1`, expression: `${i} + 1`, display: String(i + 1), plain: String(i + 1), at: Date.now() - i }));
      localStorage.setItem('lemma.history.v1', JSON.stringify(h));
    });
    const t0 = Date.now();
    await page.reload();
    await expect(page.locator('#history li').first()).toBeVisible();
    expect(Date.now() - t0).toBeLessThan(5000);
    await expect(page.locator('#history li')).toHaveCount(50); // rendered window
    await page.locator('#input').fill('6*7');
    await page.locator('#input').press('Enter');
    await expect(page.locator('#value')).toHaveText('42');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('lemma.history.v1')!).length);
    expect(stored).toBeLessThanOrEqual(300); // trimmed to the cap
  });

  test('storage that throws (private mode / full quota) never breaks calculating', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      };
      Storage.prototype.getItem = () => {
        throw new DOMException('SecurityError', 'SecurityError');
      };
    });
    await page.goto('/');
    await page.locator('#input').fill('20% of 450');
    await page.locator('#input').press('Enter');
    await expect(page.locator('#value')).toHaveText('90');
    await page.locator('#input').fill('x = 5');
    await page.locator('#input').press('Enter');
    await page.locator('#input').fill('x * 2');
    await expect(page.locator('#value')).toHaveText('10');
    await openTool(page, 'notebooks');
    await expect(page.locator('.notebook')).toBeVisible();
    await page.locator('.nb-add .nb-btn', { hasText: 'Math' }).click();
    await page.locator('.nb-cell textarea').last().fill('3^3');
    await expect(page.locator('.nb-cell .nb-out').last()).toContainText('27');
    expect(errors).toEqual([]);
  });

  test('50 concurrent timers', async ({ app }) => {
    for (let i = 1; i <= 50; i++) {
      await app.locator('#input').fill(`timer ${i} minutes`);
      await app.locator('#input').press('Enter');
    }
    await expect(app.locator('.timer')).toHaveCount(50);
    // All 50 tick: the first timer's clock changes within a couple of seconds and stays a valid countdown.
    const first = app.locator('.t-clock').first();
    const before = await first.innerText();
    await expect(first).not.toHaveText(before, { timeout: 3000 });
    expect(await first.innerText()).toMatch(/^[01]:\d\d$/);
    expect((await app.locator('.t-clock').allInnerTexts()).every((c) => /^\d+:\d\d$/.test(c))).toBe(true);
  });

  test('a 200-cell notebook opens, edits and re-evaluates quickly', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const cells = Array.from({ length: 200 }, (_, i) => ({ id: `c${i}`, type: 'math', source: i === 0 ? 'a0 = 1' : `a${i} = a${i - 1} + ${i}` }));
      const nb = { version: 1, id: 'big', title: 'Big', angle: 'rad', cells, created: Date.now(), updated: Date.now() };
      localStorage.setItem('lemma.notebook.big', JSON.stringify(nb));
      localStorage.setItem('lemma.notebooks.v1', JSON.stringify([{ id: 'big', title: 'Big', updated: Date.now() }]));
    });
    await page.reload();
    const t0 = Date.now();
    await openTool(page, 'notebooks');
    await expect(page.locator('.nb-cell').nth(199).locator('.nb-out')).toContainText('19,901');
    expect(Date.now() - t0).toBeLessThan(8000);
    await page.locator('.nb-cell textarea').first().fill('a0 = 1001');
    await expect(page.locator('.nb-cell').nth(199).locator('.nb-out')).toContainText('20,901');
  });

  test('graph survives 200 rapid zoom and pan events', async ({ app, isMobile }) => {
    await app.locator('#input').fill('graph sin(1/x), tan(x), x^2 + y^2 = 4');
    await app.locator('#input').press('Enter');
    const canvas = app.locator('.graph canvas');
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;
    await app.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const t0 = Date.now();
    // Playwright can't send wheel events to mobile WebKit; phones zoom by pinch, which shares the zoom path.
    if (!isMobile) for (let i = 0; i < 100; i++) await app.mouse.wheel(0, i % 2 ? 120 : -100);
    await app.mouse.down();
    for (let i = 0; i < 100; i++) await app.mouse.move(box.x + box.width / 2 + Math.sin(i) * 100, box.y + box.height / 2 + Math.cos(i) * 60);
    await app.mouse.up();
    expect(Date.now() - t0).toBeLessThan(20_000);
    await expect(canvas).toBeVisible();
  });

  test('replacing graphs repeatedly does not leak graph views', async ({ app, browserName }) => {
    test.skip(browserName !== 'chromium', 'heap measurement is Chromium-only');
    for (let i = 0; i < 40; i++) {
      await app.locator('#input').fill(i % 2 ? `graph sin(${i}x)` : `${i} + 1`);
      await app.locator('#input').press('Enter');
    }
    // Only the current result's canvas (if any) should remain in the document.
    expect(await app.locator('canvas').count()).toBeLessThanOrEqual(1);
  });
});
