import { type Page } from '@playwright/test';
import { expect, test, value } from './helpers';

const kb = (page: Page) => page.locator('#keypad .mkb');
/** A key on the shown pane, by its spoken name. */
const key = (page: Page, name: string) => kb(page).locator('.mkb-pane:not([hidden])').getByRole('button', { name, exact: true });
const tab = (page: Page, name: 'main' | 'abc' | 'func') => kb(page).getByRole('tab', { name: `${name} keys` });
const caret = (page: Page) => page.locator('#input').evaluate((i: HTMLInputElement) => [i.selectionStart, i.selectionEnd]);

async function scientific(page: Page) {
  await page.locator('.modes [data-mode="scientific"]').click();
  await expect(kb(page)).toBeVisible();
}

test('main tab: digits, operators and templates that put the cursor inside', async ({ app }) => {
  await scientific(app);
  const input = app.locator('#input');
  for (const k of ['7', 'Times', '8']) await key(app, k).click();
  await expect(input).toHaveValue('7*8');
  await expect(value(app)).toHaveText('56');
  await app.getByRole('button', { name: 'Clear all' }).click();
  await expect(input).toHaveValue('');

  // a/b: the cursor lands in the numerator, → jumps to the denominator.
  await key(app, 'Fraction').click();
  await expect(input).toHaveValue('()/()');
  expect(await caret(app)).toEqual([1, 1]);
  await key(app, '3').click();
  await key(app, 'Move right').click();
  expect(await caret(app)).toEqual([5, 5]);
  await key(app, '4').click();
  await expect(input).toHaveValue('(3)/(4)');
  await expect(value(app)).toHaveText('0.75');

  // A number before a/b becomes the numerator.
  await input.fill('5');
  await key(app, 'Fraction').click();
  await expect(input).toHaveValue('(5)/()');
  expect(await caret(app)).toEqual([5, 5]);
  await key(app, '8').click();
  await expect(value(app)).toHaveText('0.625');

  // ⁿ√: root(x, n), the cursor on x, then → to n.
  await input.fill('');
  await key(app, 'Root: root(x, n)').click();
  await expect(input).toHaveValue('root(, )');
  expect(await caret(app)).toEqual([5, 5]);
  await key(app, '2').click();
  await key(app, '7').click();
  await key(app, 'Move right').click();
  await key(app, '3').click();
  await expect(input).toHaveValue('root(27, 3)');
  await expect(value(app)).toHaveText('3');

  // √ and |a| wrap; ⌫ removes an empty template whole.
  await input.fill('');
  await key(app, 'Square root').click();
  await expect(input).toHaveValue('sqrt()');
  await key(app, 'Delete').click();
  await expect(input).toHaveValue('');
  await key(app, 'Absolute value').click();
  await key(app, 'Minus').click();
  await key(app, '4').click();
  await expect(input).toHaveValue('abs(-4)');
  await expect(value(app)).toHaveText('4');
  expect(await caret(app)).toEqual([6, 6]);
  await key(app, 'Move right').click();
  await key(app, 'Square').click();
  await key(app, 'Plus').click();
  await key(app, 'Previous answer').click();
  await expect(input).toHaveValue('abs(-4)^2+ans');
});

test('RAD|DEG, undo, redo and clear all', async ({ app }) => {
  await scientific(app);
  const input = app.locator('#input');
  await key(app, 'sine').click();
  await key(app, '3').click();
  await key(app, '0').click();
  await expect(input).toHaveValue('sin(30)');
  await expect(value(app)).toHaveText('0.5');
  const angle = kb(app).locator('.mkb-angle');
  await expect(angle).toHaveAttribute('data-angle', 'deg');
  await angle.click();
  await expect(angle).toHaveAttribute('data-angle', 'rad');
  await expect(app.locator('#angle')).toHaveText('RAD');
  await expect(value(app)).toHaveText(/^[−-]0\.98803162409/);
  // The header pill and the keyboard stay in step.
  await app.locator('#angle').click();
  await expect(angle).toHaveAttribute('data-angle', 'deg');

  await app.getByRole('button', { name: 'Clear all' }).click();
  await expect(input).toHaveValue('');
  await app.getByRole('button', { name: 'Undo' }).click();
  await expect(input).toHaveValue('sin(30)');
  await app.getByRole('button', { name: 'Undo' }).click();
  await expect(input).toHaveValue('sin(3)');
  await app.getByRole('button', { name: 'Redo' }).click();
  await expect(input).toHaveValue('sin(30)');
  // ⌘/Ctrl+Z works from the physical keyboard too.
  await input.focus();
  await key(app, '5').click();
  await expect(input).toHaveValue('sin(305)');
  await input.press('ControlOrMeta+z');
  await expect(input).toHaveValue('sin(30)');
});

test('abc tab: letters, shift for capitals, brackets; func tab: list statistics, nPr, the "more" set', async ({ app }) => {
  await scientific(app);
  const input = app.locator('#input');
  await tab(app, 'abc').click();
  await expect(tab(app, 'abc')).toHaveAttribute('aria-selected', 'true');
  await expect(key(app, 'q')).toHaveClass(/\bit\b/);
  await key(app, 'Shift').click();
  await key(app, 'a').click();
  await key(app, 'b').click();
  await expect(input).toHaveValue('Ab');
  for (const k of ['Equals sign', '(', ')', '[', ']', 'Prime', 'Pi']) await expect(key(app, k)).toBeVisible();
  await app.getByRole('button', { name: 'Clear all' }).click();

  await tab(app, 'func').click();
  await key(app, 'Mean of a list').click();
  await expect(input).toHaveValue('mean([])');
  expect(await caret(app)).toEqual([6, 6]);
  await input.pressSequentially('1, 2, 3, 6');
  await expect(value(app)).toHaveText('3');
  await input.fill('');
  await key(app, 'Population standard deviation').click();
  await input.pressSequentially('2, 4, 4, 4, 5, 5, 7, 9');
  await expect(input).toHaveValue('stdevp([2, 4, 4, 4, 5, 5, 7, 9])');
  await expect(value(app)).toHaveText('2');
  await input.fill('');
  await key(app, 'Permutations').click();
  await input.pressSequentially('5');
  await key(app, 'Move right').click();
  await input.pressSequentially('2');
  await expect(input).toHaveValue('nPr(5, 2)');
  await expect(value(app)).toHaveText('20');
  await input.fill('');
  await key(app, 'Round').click();
  await input.pressSequentially('2.567, 2');
  await expect(value(app)).toHaveText('2.57');

  await key(app, 'More functions').click();
  await expect(key(app, 'Hyperbolic sine')).toBeVisible();
  for (const k of ['Floor', 'Ceiling', 'Modulo', 'Greatest common divisor', 'Least common multiple', 'Minimum', 'Maximum', 'Median of a list', 'Sample variance', 'Secant', 'Log base n: log(x, n)', 'Derivative', 'Integral', 'Sum', 'Limit', 'Clear memory'])
    await expect(key(app, k)).toBeVisible();
  await input.fill('');
  await key(app, 'Log base n: log(x, n)').click();
  await input.pressSequentially('8');
  await key(app, 'Move right').click();
  await input.pressSequentially('2');
  await expect(value(app)).toHaveText('3');
  await input.fill('');
  await key(app, 'Derivative').click();
  await expect(input).toHaveValue('d/dx ');
  await key(app, 'Basic functions').click();
  await expect(key(app, 'sine')).toBeVisible();

  // The symbols button opens the symbol menu for this input.
  await kb(app).getByRole('button', { name: 'Symbols' }).click();
  await expect(app.locator('#symbols')).toBeVisible();
});

test('answers switch between decimal, fraction, mixed number and exact; memory keys', async ({ app }) => {
  await scientific(app);
  const input = app.locator('#input');
  await input.fill('1/4 + 1/2');
  await input.press('Enter');
  await expect(value(app)).toHaveText('0.75');
  await key(app, 'Fraction or decimal').click();
  await expect(value(app)).toHaveText('3/4');
  await value(app).click();
  await expect(value(app)).toHaveText('0.75');

  await input.fill('7/2');
  await input.press('Enter');
  await key(app, 'Fraction or decimal').click();
  await expect(value(app)).toHaveText('7/2');
  await key(app, 'Fraction or decimal').click();
  await expect(value(app)).toHaveText('3 1/2');

  await input.fill('sqrt(8)');
  await input.press('Enter');
  await expect(value(app)).toHaveText('2.82842712475');
  await key(app, 'Fraction or decimal').click();
  await expect(value(app)).toHaveText('2√2');

  // Settings: exact answers first, mixed numbers.
  await app.getByRole('button', { name: 'Keyboard settings' }).click();
  await app.getByLabel('Exact answers first').check();
  await app.getByLabel('Mixed numbers').check();
  await app.getByRole('button', { name: 'Done' }).click();
  await input.fill('pi/4');
  await expect(value(app)).toHaveText('π/4');
  await input.fill('11/4');
  await expect(value(app)).toHaveText('2 3/4');

  // Memory: 7 M+, 5 M+, MR → 12
  await input.fill('7');
  await key(app, 'Add to memory').click();
  await input.fill('5');
  await key(app, 'Add to memory').click();
  await input.fill('');
  await key(app, 'Recall memory').click();
  await expect(input).toHaveValue('12');
  await tab(app, 'func').click();
  await key(app, 'More functions').click();
  await key(app, 'Clear memory').click();
  await tab(app, 'main').click();
  await input.fill('');
  await key(app, 'Recall memory').click();
  await expect(input).toHaveValue('');
});

test('history: tap the answer to insert it, the expression to edit it again', async ({ app }) => {
  await scientific(app);
  const input = app.locator('#input');
  await input.fill('12*3');
  await input.press('Enter');
  const item = app.locator('#history li').first();
  await expect(item).toContainText('36');
  await item.locator('.h-out').click();
  await expect(input).toHaveValue('36');
  await input.fill('');
  await item.locator('.h-in').click();
  await expect(input).toHaveValue('12*3');
});

test('phones: the math keyboard replaces the system keyboard, with a way back', async ({ app, isMobile }) => {
  test.skip(!isMobile, 'touch screens only');
  await scientific(app);
  const input = app.locator('#input');
  await key(app, '9').tap();
  await expect(input).toHaveValue('9');
  await expect(input).toHaveAttribute('inputmode', 'none');
  // Keys never move the focus (so the system keyboard never pops up).
  await expect(input).toBeFocused();
  await key(app, 'Plus').tap();
  await key(app, '1').tap();
  await expect(value(app)).toHaveText('10');
  await kb(app).getByRole('button', { name: 'Enter' }).tap();
  await expect(app.locator('#history li').first()).toContainText('10');
  // Turned off in the keyboard's settings, the phone keyboard comes back.
  await app.getByRole('button', { name: 'Keyboard settings' }).tap();
  await app.getByLabel('Use instead of the phone keyboard').uncheck();
  await expect(input).toHaveAttribute('inputmode', 'text');
  // No double-tap zoom on keys.
  expect(await key(app, '9').evaluate((b) => getComputedStyle(b).touchAction)).toBe('manipulation');
});

test('docked keyboard types into graph rows; clear all asks before clearing every row', async ({ app }) => {
  await app.locator('.modes [data-mode="graphing"]').click();
  const rows = app.locator('.gw-input');
  await rows.first().fill('y = x');
  await rows.first().press('Enter');
  await expect(rows).toHaveCount(2);
  await rows.nth(1).click();
  await app.getByRole('button', { name: 'Show math keyboard' }).click();
  const dock = app.locator('.mkb-dock .mkb');
  await expect(dock).toBeVisible();
  await dock.getByRole('button', { name: 'Square root', exact: true }).click();
  await dock.getByRole('button', { name: 'x', exact: true }).click();
  await expect(rows.nth(1)).toHaveValue('sqrt(x)');
  await dock.getByRole('button', { name: 'Clear all' }).click();
  await expect(dock.getByRole('alertdialog')).toContainText('Clear all rows?');
  await dock.getByRole('button', { name: 'Just this one' }).click();
  await expect(rows.nth(1)).toHaveValue('');
  await dock.getByRole('button', { name: 'Clear all' }).click();
  await dock.getByRole('button', { name: 'Clear all rows' }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveValue('');
  await dock.getByRole('button', { name: 'Hide keyboard' }).click();
  await expect(dock).toBeHidden();
});

test('basic keeps a simple keypad in the same style', async ({ app }) => {
  const pad = app.locator('#keypad');
  if (!(await pad.isVisible())) await app.locator('#toggle-keypad').click();
  for (const k of ['Plus', 'Minus', 'Times', 'Divide', 'Percent', 'Square root', 'Change sign', 'Fraction or decimal']) await expect(pad.getByRole('button', { name: k, exact: true })).toBeVisible();
  for (const k of ['1', 'Divide', '8', 'Equals']) await pad.getByRole('button', { name: k, exact: true }).click();
  await expect(value(app)).toHaveText('0.125');
  await pad.getByRole('button', { name: 'Fraction or decimal' }).click();
  await expect(value(app)).toHaveText('1/8');
});
