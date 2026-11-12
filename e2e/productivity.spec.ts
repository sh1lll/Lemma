import { readFileSync } from 'node:fs';
import { test, expect, ask, openTool } from './helpers';

test('study notes: math is typeset, answers save with one tap, notes file into a notebook', async ({ app }) => {
  await ask(app, "note: chain rule is f'(g(x))·g'(x) #calc");
  await expect(app.locator('#toast')).toContainText('Saved to notes');
  await ask(app, '15% tip on 84.50');
  await app.locator('.chip', { hasText: 'Save note' }).click();
  await openTool(app, 'notes');
  const notes = app.locator('#tool-body');
  const rule = notes.locator('.note-row', { hasText: 'chain rule' });
  await expect(rule.locator('.note-math .katex')).toHaveCount(1);
  await expect(rule).toContainText('#calc');
  await expect(notes.locator('.note-row', { hasText: '15% tip on 84.50' })).toContainText('$12.68');
  await rule.getByRole('button', { name: 'Add to notebook' }).click();
  await expect(app.locator('#toast')).toContainText('Added to');
  await rule.getByRole('button', { name: /Delete note/ }).click();
  await expect(notes.locator('.note-row', { hasText: 'chain rule' })).toHaveCount(0);
  await app.reload();
  await openTool(app, 'notes');
  await expect(app.locator('#tool-body .note-row', { hasText: '15% tip' })).toHaveCount(1);
});

test('reminders are gone; shopping-list phrasing is not a note', async ({ app }) => {
  await app.locator('#input').fill('remind me at 3pm to call Sam');
  await app.locator('#input').press('Enter');
  await expect(app.locator('#value')).toHaveClass(/error/);
  await expect(app.locator('#value')).not.toContainText('PM');
});

test('chained steps run in spoken order and show on the tape', async ({ app }) => {
  await app.locator('#input').fill('5 plus 3 then times 2 then minus 4');
  await app.locator('#input').press('Enter');
  await expect(app.locator('#value')).toHaveText('12');
  // The expression shows the running value, not the internal name, and the answer keeps its actions.
  await expect(app.locator('#expr')).toHaveText('16 − 4 =');
  await expect(app.locator('.chip', { hasText: 'Save note' })).toBeVisible();
  const tape = app.locator('#tape');
  await expect(tape.locator('#tape-status')).toHaveText('Running total');
  // On a running total there's no "or a negative number?" offer for "minus 4".
  await expect(app.locator('.alt', { hasText: 'negative number' })).toHaveCount(0);
  await expect(tape).toBeVisible();
  await expect(tape.locator('li')).toHaveCount(3);
  await ask(app, 'square root of that');
  await expect(app.locator('#value')).toContainText('3.464');
  await expect(tape.locator('li')).toHaveCount(4);
  await tape.getByRole('button', { name: 'Start over' }).click();
  await expect(tape).toBeHidden();
});

test("half-typed commands don't flash errors", async ({ app }) => {
  await app.locator('#input').fill('graph ');
  await app.waitForTimeout(1200);
  await expect(app.locator('#meta')).not.toContainText('Unknown name');
  await app.locator('#input').fill('2 +* 3');
  await expect(app.locator('#meta')).toContainText(/./, { timeout: 3000 });
});

test('encrypted backup round trip: back up, wipe, restore', async ({ app }) => {
  await ask(app, '17 * 23');
  await ask(app, 'note: gate code 4471');
  await app.locator('#open-settings').click();

  // Weak passphrases are refused before anything is written.
  await app.locator('#sync-backup').click();
  const dlg = app.locator('#passphrase');
  await expect(dlg).toBeVisible();
  await app.locator('#pp1').fill('password1');
  await app.locator('#pp2').fill('password1');
  await expect(app.locator('#pp-ok')).toBeDisabled();
  await app.locator('#pp1').fill('violet tractor harbor 42');
  await app.locator('#pp2').fill('violet tractor harbor 4');
  await expect(app.locator('#pp-strength')).toContainText('don’t match');
  await app.locator('#pp2').fill('violet tractor harbor 42');
  await expect(app.locator('#pp-ok')).toBeEnabled();
  const [download] = await Promise.all([app.waitForEvent('download'), app.locator('#pp-ok').click()]);
  expect(download.suggestedFilename()).toMatch(/^lemma-backup-\d{4}-\d\d-\d\d\.lemmasync$/);
  const path = await download.path();
  const bytes = readFileSync(path!);
  expect(bytes.subarray(0, 8).toString()).toBe('LEMMENC1');
  expect(bytes.toString('latin1')).not.toContain('4471'); // nothing readable in the file

  // Wipe this device.
  await app.evaluate(() => localStorage.clear());
  await app.reload();
  await expect(app.locator('#history li')).toHaveCount(0);

  // Wrong passphrase: refused, nothing changes.
  await app.locator('#open-settings').click();
  await app.locator('#sync-file').setInputFiles(path!);
  await app.locator('#pp1').fill('not the passphrase');
  await app.locator('#pp-ok').click();
  await expect(app.locator('#toast')).toContainText(/passphrase/i);
  await expect(app.locator('#history li')).toHaveCount(0);

  // Right passphrase: merged in, page reloads with a summary.
  await app.locator('#sync-file').setInputFiles(path!);
  await app.locator('#pp1').fill('violet tractor harbor 42');
  await app.locator('#pp-ok').click();
  await expect(app.locator('#toast')).toContainText('Restored', { timeout: 15000 });
  await expect(app.locator('#history li', { hasText: '17 * 23' })).toHaveCount(1);
  await openTool(app, 'notes');
  await expect(app.locator('#tool-body .note-row', { hasText: 'gate code 4471' })).toHaveCount(1);
});

test('"show my notes" opens the notes', async ({ app }) => {
  await ask(app, 'note: area of a circle is pi r^2');
  await app.locator('#input').fill('show my notes');
  await app.locator('#input').press('Enter');
  await expect(app.locator('#tool')).toBeVisible();
  await expect(app.locator('#tool-title')).toHaveText('Notes');
  await expect(app.locator('#tool-body .note-row', { hasText: 'area of a circle' })).toHaveCount(1);
});

test('the actions under an answer collapse behind an arrow, and stay collapsed', async ({ app }) => {
  await ask(app, '15% tip on 84.50');
  const toggle = app.getByRole('button', { name: 'Hide actions' });
  await expect(app.locator('.chip', { hasText: 'Save note' })).toBeVisible();
  await toggle.click();
  await expect(app.locator('.chip', { hasText: 'Save note' })).toBeHidden();
  await expect(app.getByRole('button', { name: 'Show actions' })).toHaveAttribute('aria-expanded', 'false');
  await ask(app, '2 + 2');
  await expect(app.locator('.chip', { hasText: 'Save note' })).toBeHidden();
  await app.reload();
  await ask(app, '3 * 3');
  await expect(app.locator('.chip', { hasText: 'Save note' })).toBeHidden();
  await app.getByRole('button', { name: 'Show actions' }).click();
  await expect(app.locator('.chip', { hasText: 'Save note' })).toBeVisible();
});

test('simulate works from the main input', async ({ app }) => {
  await ask(app, 'simulate 10000: sum of 2 dice >= 10');
  await expect(app.locator('#value')).toContainText('%');
  await expect(app.getByText('95% interval').first()).toBeVisible();
  await expect(app.getByText(/1\/6/).first()).toBeVisible();
});
