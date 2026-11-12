import { ask, expect, test, value } from './helpers';

test('"How it was read" starts folded, and opening it is remembered', async ({ app }) => {
  await ask(app, 'log(63)');
  await expect(value(app)).toContainText('1.799');
  const toggle = app.getByTestId('interp-toggle');
  await expect(toggle).toHaveText('How it was read · 1 assumption');
  await expect(app.getByTestId('interpretation')).toBeHidden();
  await expect(app.locator('.meta .approx')).toBeHidden();
  await toggle.click();
  await expect(app.getByTestId('interpretation')).toContainText('Assuming log is base 10');
  await expect(app.locator('.meta .approx')).toBeVisible();
  await app.reload();
  await ask(app, 'log(20)');
  await expect(app.getByTestId('interpretation')).toBeVisible();
});

test('the keyboard and number pad type into the calculator without clicking it first', async ({ app }) => {
  await app.locator('#input').blur();
  await app.keyboard.press('Numpad1');
  await app.keyboard.press('Numpad2');
  await app.keyboard.press('NumpadMultiply');
  await app.keyboard.press('3');
  await app.keyboard.press('NumpadDivide');
  await app.keyboard.press('4');
  await expect(app.locator('#input')).toHaveValue('12*3/4');
  await app.locator('#input').blur();
  await app.keyboard.press('Backspace');
  await app.keyboard.press('Numpad6');
  await app.keyboard.press('NumpadEnter');
  await expect(value(app)).toHaveText('6');
});

test('the example hint in the input can be turned off', async ({ app }) => {
  await expect(app.locator('#input')).toHaveAttribute('placeholder', /try “/i);
  await app.locator('#open-settings').click();
  await app.getByLabel('Hint text in the input').uncheck();
  await app.keyboard.press('Escape');
  await expect(app.locator('#input')).toHaveAttribute('placeholder', '');
  await app.reload();
  await expect(app.locator('#input')).toHaveAttribute('placeholder', '');
});
