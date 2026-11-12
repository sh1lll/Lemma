import { test, expect } from './helpers';

test('Tools: grouped, searchable, remembers what you used, and ⌘/Ctrl+K opens it', async ({ app }) => {
  const menu = app.locator('#study');
  await expect(app.locator('#open-study')).toContainText('Tools');
  await app.locator('#open-study').click();
  await expect(menu).toBeVisible();
  await expect(menu.locator('h3')).toHaveText(['Draw and explore', 'Practice and exams', 'Learn', 'Your work', 'Add-ons']);
  await expect(menu.locator('.group-make .tool-row')).toHaveCount(3);

  // Search matches other words too ("quiz" finds both practice tools), and hides empty groups.
  const search = menu.getByRole('searchbox', { name: 'Find a tool' });
  await search.fill('quiz');
  await expect(menu.locator('.tool-row:visible')).toHaveCount(2);
  await expect(menu.locator('h3:visible')).toHaveText(['Practice and exams']);
  await search.fill('zzz');
  await expect(menu.locator('.tool-empty')).toBeVisible();

  // Enter opens the first match.
  await search.fill('simulate');
  await search.press('Enter');
  await expect(app.locator('#tool-title')).toHaveText('Physics lab');
  await app.locator('#tool-close').click();
  await expect(app.locator('#tool')).toBeHidden();

  // It's now under Recent; the shortcut opens the menu with the search ready.
  await app.locator('#input').click();
  await app.keyboard.press('ControlOrMeta+k');
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-recent="physics"]')).toBeVisible();

  // No tool by that name: Enter asks it in the calculator instead.
  await search.fill('2 + 3');
  await search.press('Enter');
  await expect(menu).toBeHidden();
  await expect(app.locator('#value')).toHaveText('5');
});
