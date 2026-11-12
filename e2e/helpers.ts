import { expect, test as base, type Page } from '@playwright/test';

/** Fails a test on any uncaught page error, and serves fixed exchange rates so currency tests are deterministic. */
export const test = base.extend<{ app: Page }>({
  app: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://api.frankfurter.dev/**', (r) =>
      r.fulfill({ json: { amount: 1, base: 'EUR', date: '2026-10-29', rates: { USD: 1.113, GBP: 0.83578, JPY: 175.92 } } }),
    );
    await page.goto('/');
    await expect(page.locator('#input')).toBeVisible();
    await use(page);
    expect(errors, 'uncaught page errors').toEqual([]);
  },
});
export { expect };

/** Types a query, submits it, and waits for it to land in history. */
export async function ask(page: Page, q: string) {
  const input = page.locator('#input');
  await input.fill(q);
  await input.press('Enter');
  // Firefox runs the algebra engine's WebAssembly on a slow path: its first load takes ~17 s (others ~4 s).
  await expect(page.locator('#history li').first()).toContainText(q.slice(0, 18), { timeout: 45_000 });
}

export const value = (page: Page) => page.locator('#value');

/** Opens a study tool the way a person would: Study → the tool's row. */
export async function openTool(page: Page, tool: 'whiteboard' | 'notes' | 'notebooks' | 'practice' | 'test' | 'lecture' | 'videos' | 'extensions' | 'geometry' | 'physics') {
  await page.locator('#open-study').click();
  await page.locator(`.tool-row[data-tool="${tool}"]`).click();
}
