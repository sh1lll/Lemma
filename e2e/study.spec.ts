import { readFileSync } from 'node:fs';
import { test, expect, ask, openTool } from './helpers';

test('practice: from an answer, check a wrong then a right answer, see steps', async ({ app }) => {
  // An everyday question: no algebra engine to download, so this tests the tool, not the network.
  await ask(app, '15% tip on 84.50');
  await app.locator('.chip', { hasText: 'Practice question' }).click();
  const body = app.locator('#tool-body');
  await expect(app.locator('#tool-title')).toHaveText('Practice');
  await expect(body.locator('.seg button[aria-pressed="true"]').first()).toHaveText('Money and tips');
  const prompt = await body.locator('.q-prompt').textContent();
  expect(prompt).toMatch(/\$/);
  await body.getByLabel('Your answer').fill('123456');
  await body.getByRole('button', { name: 'Check' }).click();
  await expect(body.locator('.feedback.wrong')).toBeVisible();
  await expect(body.locator('.steps li').first()).toBeVisible();
  // Read the expected answer from the shown steps, then answer it.
  const expected = (await body.locator('.feedback').last().textContent())!.replace(/^Answer:\s*/, '');
  await body.getByLabel('Your answer').fill(expected);
  await body.getByRole('button', { name: 'Check' }).click();
  await expect(body.locator('.feedback.right')).toContainText('Right');
  await body.getByRole('button', { name: 'Next question' }).click();
  await expect(body.locator('.q-prompt')).not.toHaveText(prompt!);
});

test('practice test: take a 5-question test and get a score by topic', async ({ app }) => {
  await openTool(app, 'test');
  const body = app.locator('#tool-body');
  await body.getByRole('button', { name: '5 questions' }).click();
  await body.getByRole('button', { name: 'Start test' }).click();
  for (let i = 0; i < 5; i++) {
    await expect(body.locator('.fine').first()).toHaveText(`Question ${i + 1} of 5`);
    await body.getByLabel('Your answer').fill(i % 2 ? '0' : '1');
    await body.getByRole('button', { name: 'Next' }).click();
  }
  await expect(body.locator('.score')).toHaveText(/\d \/ 5/);
  await expect(body.locator('.review > li')).toHaveCount(5);
  await body.locator('.review > li').first().getByRole('button', { name: 'Steps' }).click();
  await expect(body.locator('.review .steps').first()).toBeVisible();
});

test('lecture summarizer: paste a transcript, get formulas and key points, save to notes', async ({ app }) => {
  const text = readFileSync('packages/lecture-engine/test/fixtures/derivatives.txt', 'utf8');
  await openTool(app, 'lecture');
  const body = app.locator('#tool-body');
  await body.getByLabel('Transcript').fill(text);
  await body.getByRole('button', { name: 'Summarize text' }).click();
  await expect(body.locator('.lecture-title')).toContainText(/Derivative/i);
  await expect(body.locator('.card', { hasText: 'Key points' }).locator('li')).not.toHaveCount(0);
  await expect(body.locator('.formulas-list li').first()).toBeVisible();
  await body.getByRole('button', { name: 'Save to notes' }).click();
  await expect(app.locator('#toast')).toContainText('Saved to notes');
});

test('video lessons: explain an answer in a teaching style, lecture a topic, save it', async ({ app, browserName }) => {
  test.skip(browserName !== 'chromium', 'Recording is covered in Chromium');
  test.setTimeout(240_000);
  await app.addInitScript(() => {
    // Narration is spoken with speechSynthesis; stub it so tests are silent and can see the lines.
    (window as unknown as { __said: string[] }).__said = [];
    window.speechSynthesis.speak = (u: SpeechSynthesisUtterance) => void (window as unknown as { __said: string[] }).__said.push(u.text);
  });
  await app.reload();
  await ask(app, '15% tip on 84.50');
  await app.locator('.chip', { hasText: 'Create video' }).click();
  const body = app.locator('#tool-body');
  await expect(app.locator('#tool-title')).toHaveText('Video lesson');
  await expect(body.locator('.style-card')).toHaveCount(10);
  await body.locator('.style-card[data-style="exam"]').click();
  await body.getByRole('button', { name: 'Make lesson' }).click();
  await expect(body.locator('.video-stage canvas')).toBeVisible();
  await expect(body.locator('.fine').first()).toContainText(/Exam prep · about \d+ min/);
  await expect.poll(() => app.evaluate(() => (window as unknown as { __said: string[] }).__said.length), { timeout: 20_000 }).toBeGreaterThan(0);

  // A lecture on a topic, in another style.
  await body.getByRole('button', { name: 'Lecture on a topic' }).click();
  await body.locator('.style-card[data-style="chalkboard"]').click();
  await body.getByLabel('Question or topic').fill('the chain rule');
  await body.getByRole('button', { name: 'Make lesson' }).click();
  await expect(body.locator('.fine').first()).toContainText(/Chalkboard · about \d+ min/);
  await body.getByRole('button', { name: 'Save to gallery' }).click();
  await expect(app.locator('#toast')).toContainText(/Saved .* to your lessons/, { timeout: 200_000 });
  await expect(body.locator('.gallery-list')).toContainText(/Chalkboard/);
});

for (const [said, style] of [
  ['teach me fractions in real-world story style', 'story'],
  ['explain 2x + 3 = 11 in proof-first style', 'proof'],
  ['make a lecture on percentages as a beginner friendly lesson', 'beginner'],
] as const) {
  test(`lesson style from words: "${said}"`, async ({ app }) => {
    await app.locator('#input').fill(said);
    await app.locator('#input').press('Enter');
    await expect(app.locator(`#tool-body .style-card[data-style="${style}"]`)).toHaveAttribute('aria-checked', 'true');
  });
}

test('"make a lecture on percentages in quick style" from the main input', async ({ app }) => {
  await app.locator('#input').fill('make a lecture on percentages in quick style');
  await app.locator('#input').press('Enter');
  const body = app.locator('#tool-body');
  await expect(body.locator('.style-card[data-style="quick"]')).toHaveAttribute('aria-checked', 'true');
  await expect(body.locator('.video-stage canvas')).toBeVisible();
});

test('every Study row does something from a fresh start', async ({ app }) => {
  const body = app.locator('#tool-body');
  const back = async () => {
    if (await app.locator('#tool').evaluate((d: HTMLDialogElement) => d.open)) await app.locator('#tool-close').click();
  };

  await openTool(app, 'practice');
  await expect(body.locator('.q-prompt')).not.toBeEmpty();
  await back();

  await openTool(app, 'test');
  await body.getByRole('button', { name: 'Start test' }).click();
  await expect(body.getByLabel('Your answer')).toBeVisible();
  await back();

  await openTool(app, 'lecture');
  await body.getByRole('button', { name: 'Try a sample lecture' }).click();
  await expect(body.locator('.lecture-title')).toContainText(/Pythagorean/i);
  await expect(body.locator('.formulas-list li')).not.toHaveCount(0);
  await back();

  await openTool(app, 'notes');
  await body.getByLabel('New note').fill("chain rule is f'(g(x))·g'(x) #calc");
  await body.getByRole('button', { name: 'Save' }).click();
  await expect(body.locator('.note-row', { hasText: 'chain rule' }).locator('.katex')).toHaveCount(1);
  await back();

  await openTool(app, 'videos');
  await body.getByRole('button', { name: 'solve 3x - 7 = 11' }).click();
  await expect(body.locator('.video-stage canvas')).toBeVisible();
  await back();

  await openTool(app, 'geometry');
  await body.getByLabel('Geometry command').fill('point A at (1, 2)');
  await body.getByLabel('Geometry command').press('Enter');
  await expect(body.locator('.geo-item', { hasText: 'Point A at (1, 2)' })).toBeVisible();
  await back();

  await openTool(app, 'physics');
  await expect(body.locator('.phys-readout dd[data-key="t"]')).toHaveText(/s$/);
  await back();

  await openTool(app, 'notebooks');
  await expect(app.locator('.nb-cell').first()).toBeVisible();
  await app.locator('.nb-back').click();

  await openTool(app, 'extensions');
  await expect(app.locator('#extensions')).toBeVisible();
});
