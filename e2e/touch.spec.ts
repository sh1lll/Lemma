import { expect, test, value } from './helpers';

test('keypad entry on touch devices', async ({ app, isMobile }) => {
  test.skip(!isMobile, 'touch only');
  await expect(app.locator('#keypad')).toBeVisible();
  for (const k of ['7', '×', '8', '=']) await app.locator('.key', { hasText: new RegExp(`^${k === '×' ? '×' : k}$`) }).tap();
  await expect(value(app)).toHaveText('56');
});
