import { expect, openTool, test } from './helpers';

// Practice from your own mistakes: a missed question comes back first, and leaves the list once it's answered right.
test('a missed practice question comes back under "Your mistakes" until it’s answered right', async ({ app }) => {
  await openTool(app, 'practice');
  const body = app.locator('#tool-body');
  const prompt = (await body.locator('.q-prompt').textContent())!;
  await body.getByLabel('Your answer').fill('123456789');
  await body.getByRole('button', { name: 'Check' }).click();
  await expect(body.locator('.feedback.wrong')).toBeVisible();
  await app.locator('#tool-close').click();

  // Next time, practice opens on your mistakes, with that same question first.
  await openTool(app, 'practice');
  await expect(body.locator('.seg button[aria-pressed="true"]').first()).toHaveText('Your mistakes');
  await expect(body.locator('.q-prompt')).toHaveText(prompt);
  await body.getByRole('button', { name: 'Show steps' }).click();
  const answer = (await body.locator('.steps-title ~ .feedback').last().textContent())!.replace(/^Answer:\s*/, '');
  // Right only after seeing the steps doesn't clear it…
  await body.getByLabel('Your answer').fill(answer);
  await body.getByRole('button', { name: 'Check' }).click();
  await expect(body.locator('.feedback.right')).toBeVisible();
  expect(await app.evaluate(() => JSON.parse(localStorage.getItem('lemma.mistakes.v1') ?? '[]').length)).toBe(1);
  // …answering it right first time does.
  await app.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('lemma.mistakes.v1')!);
    localStorage.setItem('lemma.mistakes.v1', JSON.stringify(list));
  });
  await app.locator('#tool-close').click();
  await openTool(app, 'practice');
  await body.getByLabel('Your answer').fill(answer);
  await body.getByRole('button', { name: 'Check' }).click();
  await expect(body.locator('.feedback.right')).toBeVisible();
  expect(await app.evaluate(() => JSON.parse(localStorage.getItem('lemma.mistakes.v1') ?? '[]').length)).toBe(0);
});

test('the sync setup row opens the device-sync fields', async ({ app }) => {
  await app.locator('#open-settings').click();
  await app.locator('#sync-setup').click();
  await expect(app.locator('#sync-server-url')).toBeFocused();
});
