import { type Page } from '@playwright/test';
import { expect, test, value } from './helpers';

const menu = (page: Page) => page.locator('#symbols');
const search = (page: Page) => page.getByRole('searchbox', { name: 'Search symbols' });

async function openMenu(page: Page) {
  await page.locator('#open-symbols').click();
  await expect(menu(page)).toBeVisible();
  await expect(search(page)).toBeFocused();
}

test('search by name and by LaTeX command, and insert at the cursor', async ({ app }) => {
  const input = app.locator('#input');
  await input.fill('2+3');
  await input.evaluate((i: HTMLInputElement) => i.setSelectionRange(1, 1));
  await openMenu(app);
  await search(app).fill('alpha');
  const first = menu(app).locator('.sym').first();
  await expect(first).toHaveAttribute('data-text', 'α');
  await expect(first).toHaveAttribute('aria-label', 'alpha');
  await first.click();
  await expect(menu(app)).toBeHidden();
  await expect(input).toHaveValue('2α+3');
  await expect(input).toBeFocused();
  expect(await input.evaluate((i: HTMLInputElement) => i.selectionStart)).toBe(2);

  await input.fill('');
  await openMenu(app);
  await search(app).fill('\\leq');
  await expect(menu(app).locator('.sym').first()).toHaveAttribute('data-text', '≤');
  for (const [q, ch] of [['not equal', '≠'], ['integral', '∫'], ['subset', '⊂'], ['degree', '°'], ['therefore', '∴'], ['\\alpha', 'α']]) {
    await search(app).fill(q);
    await expect(menu(app).locator('.sym').first(), q).toHaveAttribute('data-text', ch);
  }
  // Enter in the search box inserts the best match.
  await search(app).fill('pi');
  await search(app).press('Enter');
  await expect(input).toHaveValue('π');
  await expect(value(app)).toHaveText('3.14159265359');
});

test('recently used symbols come first', async ({ app }) => {
  for (const name of ['beta', 'gamma']) {
    await openMenu(app);
    await search(app).fill(name);
    await menu(app).locator('.sym').first().click();
    await expect(menu(app)).toBeHidden();
  }
  await openMenu(app);
  const recent = menu(app).locator('#sym-recent .sym');
  await expect(recent.nth(0)).toHaveAttribute('data-text', 'γ');
  await expect(recent.nth(1)).toHaveAttribute('data-text', 'β');
  // The Recent group is the first thing in the menu.
  await expect(menu(app).locator('.sym-sec').first()).toHaveAttribute('id', 'sym-recent');
});

test('your own symbols: add, use in a calculation, edit, delete; they persist', async ({ app }) => {
  await openMenu(app);
  await menu(app).getByRole('button', { name: '+ Add your own' }).click();
  const form = menu(app).locator('.sym-form');
  await form.getByLabel('Symbol').fill('ψ');
  await form.getByLabel('Name').fill('wave');
  await form.getByLabel('Value').fill('2.5');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(menu(app).locator('.sym-mine-row')).toHaveCount(1);
  await expect(menu(app).locator('.sym-mine-row')).toContainText('wave');
  // Found by search, too.
  await search(app).fill('wave');
  await expect(menu(app).locator('.sym').first()).toHaveAttribute('data-text', 'ψ');
  await menu(app).locator('.sym').first().click();
  const input = app.locator('#input');
  await expect(input).toHaveValue('ψ');
  await input.press('Home');
  await input.pressSequentially('2');
  await expect(value(app)).toHaveText('5');

  await app.reload();
  await openMenu(app);
  await expect(menu(app).locator('.sym-mine-row')).toContainText('wave');
  await menu(app).getByRole('button', { name: 'Edit wave' }).click();
  await menu(app).locator('.sym-form').getByLabel('Name').fill('psi');
  await menu(app).locator('.sym-form').getByRole('button', { name: 'Save' }).click();
  await expect(menu(app).locator('.sym-mine-row')).toContainText('psi');
  await expect(menu(app).locator('.sym-mine-row')).toHaveCount(1);
  await menu(app).getByRole('button', { name: 'Delete psi' }).click();
  await expect(menu(app).locator('.sym-mine-row')).toHaveCount(0);
  await app.keyboard.press('Escape');
  await app.reload();
  await openMenu(app);
  await expect(menu(app).locator('.sym-mine-row')).toHaveCount(0);
});

test('keyboard: arrows move through the grid, Enter inserts, Escape closes', async ({ app }) => {
  await openMenu(app);
  await search(app).fill('arrow');
  await search(app).press('ArrowDown');
  const syms = menu(app).locator('.sym');
  await expect(syms.nth(0)).toBeFocused();
  await app.keyboard.press('ArrowRight');
  await expect(syms.nth(1)).toBeFocused();
  await app.keyboard.press('ArrowLeft');
  await expect(syms.nth(0)).toBeFocused();
  await app.keyboard.press('ArrowDown');
  const below = await app.evaluate(() => document.activeElement?.getAttribute('data-text'));
  expect(below).not.toBe(await syms.nth(0).getAttribute('data-text'));
  await app.keyboard.press('ArrowUp');
  await expect(syms.nth(0)).toBeFocused();
  await app.keyboard.press('ArrowRight');
  const text = await syms.nth(1).getAttribute('data-text');
  await app.keyboard.press('Enter');
  await expect(menu(app)).toBeHidden();
  await expect(app.locator('#input')).toHaveValue(text!);

  await openMenu(app);
  await search(app).fill('sum');
  await app.keyboard.press('Escape');
  await expect(menu(app)).toBeHidden();
  // Alt+S opens it too.
  await app.locator('#input').press('Alt+s');
  await expect(menu(app)).toBeVisible();
  await app.keyboard.press('Escape');
  await expect(menu(app)).toBeHidden();
});

test('symbols go into a graph row in Graphing mode', async ({ app }) => {
  await app.locator('.modes [data-mode="graphing"]').click();
  const row = app.locator('.gw-input').first();
  await row.fill('y = sin(x)');
  await row.press('End');
  await app.locator('.gw').getByRole('button', { name: 'Symbols' }).click();
  await search(app).fill('pi');
  await menu(app).locator('.sym').first().click();
  await expect(row).toHaveValue('y = sin(x)π');
  await expect(row).toBeFocused();
});

test('the menu browses every group and can list every Unicode math symbol', async ({ app }) => {
  await openMenu(app);
  for (const g of ['Greek', 'Operators', 'Relations', 'Sets & logic', 'Arrows', 'Calculus', 'Super & subscripts', 'Fractions', 'Geometry', 'Units & physics', 'Currency', 'Accents', 'More']) {
    await expect(menu(app).locator('.sym-cats button', { hasText: g }).first()).toBeAttached();
  }
  await menu(app).locator('.sym-cats button', { hasText: 'Every symbol' }).click();
  await expect.poll(() => menu(app).locator('#sym-all .sym').count()).toBeGreaterThan(2000);
});
