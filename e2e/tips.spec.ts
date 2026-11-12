import { test, expect } from './helpers';

test('Tips lists what has no button, and every example works', async ({ app }) => {
  test.setTimeout(240_000);
  await app.getByRole('button', { name: 'Tips: what you can say or type' }).click();
  const sheet = app.locator('#tips');
  await expect(sheet).toBeVisible();
  const tries = await sheet.locator('[data-try]').evaluateAll((b) => b.map((x) => (x as HTMLElement).dataset.try!));
  expect(tries.length).toBeGreaterThan(15);
  await sheet.getByRole('button', { name: 'Close tips' }).click();
  // Tapping fills the input without running it.
  await app.getByRole('button', { name: 'Tips: what you can say or type' }).click();
  await sheet.locator('[data-try="15% tip on 84.50"]').click();
  await expect(app.locator('#input')).toHaveValue('15% tip on 84.50');
  await expect(sheet).toBeHidden();
  // The ones that answer in place: each gives an answer, not an error.
  const opensSomething = /^(?:open|simulate a projectile|explain|load everything)/;
  const bad: string[] = [];
  for (const q of tries.filter((t) => !opensSomething.test(t))) {
    await app.locator('#input').fill(q);
    await app.locator('#input').press('Enter');
    // Done when the input clears (answers and commands both clear it); an error leaves the error state on.
    await expect(app.locator('#input'), q).toHaveValue('', { timeout: 60_000 }).catch(() => undefined);
    if ((await app.locator('#value.error').count()) || (await app.locator('#input').inputValue())) bad.push(`${q} → ${await app.locator('#value').textContent()}`);
  }
  expect(bad).toEqual([]);
});
