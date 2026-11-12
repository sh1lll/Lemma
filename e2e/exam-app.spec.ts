import { readFileSync } from 'node:fs';
import { test, expect, openTool } from './helpers';

const PDF = readFileSync('e2e/fixtures/exam-quiz.pdf');

test('exam simulator in the app: import, build, take it, turn in, results, practice and scratch', async ({ app }) => {
  test.setTimeout(120_000);
  await openTool(app, 'exam');
  const view = app.locator('.ex-view');
  await expect(view).toBeVisible();
  await view.getByRole('button', { name: 'Import my tests' }).click();
  await view.locator('#ex-file').setInputFiles([{ name: 'exam-quiz.pdf', mimeType: 'application/pdf', buffer: PDF }]);
  await expect(view.locator('.ex-doc-found')).toContainText('4 questions', { timeout: 20_000 });
  await view.getByRole('button', { name: 'Use these to build my exam' }).click();
  await expect(view.getByRole('heading', { name: 'What your exam will match' })).toBeVisible();
  await view.getByRole('button', { name: 'Build exam and start' }).click();
  await app.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(app.locator('.ex-pp-item')).toHaveCount(4);

  // Scratch work opens the whiteboard on top of the exam.
  const scratch = app.getByRole('button', { name: /whiteboard/i }).first();
  if (await scratch.count()) {
    await scratch.click();
    await expect(app.locator('.wb-view canvas').first()).toBeVisible();
    await app.getByRole('button', { name: 'Close whiteboard' }).click();
  }

  // Answer the first question, leave the rest, turn in.
  await app.locator('.ex-pp-item').first().getByRole('radio').first().click();
  await app.locator('[data-act="turnin"]').click();
  await app.getByRole('button', { name: 'Turn in', exact: true }).last().click();
  await expect(app.locator('.ex-view')).toContainText(/%|\/ ?\d+/, { timeout: 15_000 });

  // A missed question opens to its key, steps and links to practice.
  await app.locator('.ex-res-q.is-miss summary').first().click();
  await app.getByRole('button', { name: 'Practice this' }).first().click();
  await expect(app.locator('#tool-title')).toHaveText('Practice');
  await expect(app.locator('#tool-body .q-prompt')).not.toBeEmpty();
  await app.locator('#tool-close').click();
});

test('the exam simulator can be closed from its hub', async ({ app }) => {
  await openTool(app, 'exam');
  await expect(app.locator('.ex-view')).toContainText('New exam');
  await app.getByRole('button', { name: 'Close the exam simulator' }).click();
  await expect(app.locator('.ex-view')).toHaveCount(0);
  await expect(app.locator('#input')).toBeFocused();
});
