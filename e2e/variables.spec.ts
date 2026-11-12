import { test, expect, ask } from './helpers';

test('variables: define from the panel or by typing, see them, use them, delete them, and they persist', async ({ app }) => {
  await app.getByRole('button', { name: 'Variables' }).click();
  await app.getByLabel('Variable name').fill('rate');
  await app.getByLabel('Value').fill('0.2');
  await app.getByRole('button', { name: 'Save' }).click();
  const chips = app.locator('#formulas');
  await expect(chips.getByRole('button', { name: 'rate = 0.2' })).toBeVisible();
  await ask(app, 'a = 3, b = 4');
  await expect(chips.getByRole('button', { name: 'a = 3' })).toBeVisible();
  await expect(chips.getByRole('button', { name: 'b = 4' })).toBeVisible();
  await ask(app, 'sqrt(a^2 + b^2)');
  await expect(app.locator('#value')).toHaveText('5');
  await app.reload();
  await expect(app.locator('#formulas').getByRole('button', { name: 'rate = 0.2' })).toBeVisible();
  await app.locator('#formulas').getByRole('button', { name: 'Delete variable rate' }).click();
  await expect(app.locator('#formulas').getByRole('button', { name: 'rate = 0.2' })).toHaveCount(0);
  await app.reload();
  await expect(app.locator('#formulas').getByRole('button', { name: 'rate = 0.2' })).toHaveCount(0);
});
