import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { ask, expect, test, value } from './helpers';

/**
 * Step-by-step solutions, "what do you want to do?" choices, the full report, interpretation, sharing, the
 * tutor, photo/worksheet reading, and stat charts that stay. SymPy loads from the CDN in each page.
 */
const FIX = 'e2e/fixtures';

/** Records clipboard writes (every engine), so copy actions can be checked. */
async function captureClipboard(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __copied: string[] };
    w.__copied = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (t: string) => void w.__copied.push(t),
        write: async () => void w.__copied.push('[image]'),
        readText: async () => w.__copied.at(-1) ?? '',
      },
    });
  });
}
const copied = (page: Page) => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied.at(-1) ?? '');

async function openSteps(app: Page) {
  const toggle = app.getByTestId('show-steps');
  await expect(toggle).toBeVisible({ timeout: 30_000 });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  const steps = app.getByTestId('steps');
  await expect(steps).toBeVisible({ timeout: 60_000 });
  return steps;
}

test.describe('solutions', () => {
  test.skip(({ isMobile }) => isMobile, 'covered by the desktop engines');

  test('Show steps: an equation, a derivative and an integral (remembered open)', async ({ app }) => {
    test.setTimeout(240_000);
    await ask(app, '2x + 3 = 11');
    await expect(value(app)).toHaveText('x = 4', { timeout: 200_000 });
    let steps = await openSteps(app);
    await expect(steps).toContainText('Linear equation');
    await expect(steps).toContainText('Subtract 3 from both sides');
    await expect(steps.locator('.step-math .katex').first()).toBeVisible();
    await expect(steps).toContainText('checked');

    await ask(app, 'derivative of x^2 sin(x)');
    await expect(value(app)).toContainText('cos', { timeout: 60_000 });
    // The toggle remembered it was open.
    steps = app.getByTestId('steps');
    await expect(steps).toContainText('Product rule', { timeout: 60_000 });
    await expect(steps).toContainText('Put the pieces together');

    await ask(app, 'integrate x e^x');
    await expect(value(app)).toContainText('+ C', { timeout: 60_000 });
    await expect(app.getByTestId('steps')).toContainText('Integration by parts', { timeout: 60_000 });

    // Collapsing is remembered too.
    await app.getByTestId('show-steps').click();
    await ask(app, '3x - 4 = 8');
    await expect(value(app)).toHaveText('x = 4', { timeout: 60_000 });
    await expect(app.getByTestId('show-steps')).toHaveAttribute('aria-expanded', 'false');
  });

  test('a bare expression offers choices, computed on tap; the report fills in', async ({ app }) => {
    test.setTimeout(240_000);
    await ask(app, 'x^2 - 5x + 6');
    await expect(value(app)).toHaveText('(x − 3)(x − 2)', { timeout: 200_000 });
    for (const label of ['Simplify', 'Factor', 'Expand', 'Find roots', 'Graph', 'Derivative', 'Integral', 'Domain & range', 'Evaluate at…', 'Solve for…']) {
      await expect(app.locator(`.action-chip[data-action="${label}"]`)).toBeVisible();
    }
    // Report sections load progressively.
    const report = app.getByTestId('report');
    await expect(report).toBeVisible();
    await expect(report.locator('[data-section="Roots"]')).toContainText('2', { timeout: 60_000 });
    await expect(report.locator('[data-section="Derivative"] .katex')).toBeVisible({ timeout: 60_000 });
    await expect(report.locator('[data-section="Domain and range"]')).toContainText('Range', { timeout: 60_000 });
    await expect(report.locator('[data-section="Plot"] canvas')).toBeVisible({ timeout: 60_000 });

    await app.locator('.action-chip[data-action="Find roots"]').click();
    await expect(value(app)).toHaveText(/x = 2 or x = 3/, { timeout: 60_000 });

    await ask(app, 'x^2 - 5x + 6');
    await app.locator('.action-chip[data-action="Evaluate at…"]').click();
    await app.locator('.action-input').fill('4');
    await app.locator('.action-input').press('Enter');
    await expect(value(app)).toHaveText('2', { timeout: 60_000 });
  });

  test('numbers get a report; inequalities a number line', async ({ app }) => {
    test.setTimeout(240_000);
    await ask(app, '360');
    const report = app.getByTestId('report');
    await expect(report.locator('[data-section="Prime factorization"]')).toContainText('2', { timeout: 30_000 });
    await expect(report.locator('[data-section="Roman numerals"]')).toContainText('CCCLX', { timeout: 30_000 });
    await expect(report.locator('[data-section="Number name"]')).toContainText('three hundred sixty', { timeout: 30_000 });
    await ask(app, '1/3 + 1/4');
    await expect(report.locator('[data-section="Continued fraction"]')).toBeVisible({ timeout: 30_000 });
    await ask(app, 'x^2 < 4');
    await expect(app.locator('.report .number-line')).toBeVisible({ timeout: 200_000 });
  });

  test('interpretation: alternatives re-run with that assumption', async ({ app }) => {
    test.setTimeout(120_000);
    await ask(app, '6/2(1+2)');
    await expect(value(app)).toHaveText('9');
    // Folded by default; opening it is remembered for the next answer.
    await expect(app.getByTestId('interpretation')).toBeHidden();
    await app.getByTestId('interp-toggle').click();
    const interp = app.getByTestId('interpretation');
    await expect(interp).toContainText('Interpreted as');
    await expect(interp).toContainText('Using left-to-right');
    await interp.getByRole('button', { name: /implied multiplication first/ }).click();
    await expect(value(app)).toHaveText('1');

    await ask(app, 'log(100)');
    await expect(value(app)).toHaveText('2');
    await app.getByTestId('interpretation').getByRole('button', { name: 'use natural log instead' }).click();
    await expect(value(app)).toContainText('4.605');
  });

  test('copy as LaTeX, and a share link that previews its input', async ({ app, page }) => {
    test.setTimeout(120_000);
    await captureClipboard(page);
    await page.reload();
    await ask(app, '2^10 + 1');
    await expect(value(app)).toHaveText('1,025');
    await app.locator('.chip', { hasText: 'Share' }).click();
    await app.getByTestId('copy-latex').click();
    await expect.poll(() => copied(page)).toBe('2^{10} + 1 = 1{,}025');
    await app.locator('.chip', { hasText: 'Share' }).click();
    await app.getByTestId('copy-mathml').click();
    await expect.poll(() => copied(page)).toMatch(/^<math[\s\S]*<\/math>$/);
    await app.locator('.chip', { hasText: 'Share' }).click();
    await app.getByTestId('copy-link').click();
    await expect.poll(() => copied(page)).toContain('?q=2%5E10%20%2B%201');
    const link = await copied(page);
    await page.goto(link);
    // The link previews its question in the input; it's committed on Enter.
    await expect(value(page)).toHaveText('1,025');
    await expect(page.locator('#input')).toHaveValue('2^10 + 1');
  });

  test('tutor without AI: explain a step, practice and video', async ({ app }) => {
    test.setTimeout(240_000);
    await ask(app, 'x^2 - 5x + 6 = 0');
    await expect(value(app)).toHaveText(/x = 2 or x = 3/, { timeout: 200_000 });
    await app.locator('.chip', { hasText: 'Ask about this' }).click();
    const tutor = app.getByTestId('tutor');
    await expect(tutor).toBeVisible();
    await expect(tutor.locator('textarea')).toHaveCount(0);
    await tutor.getByTestId('tutor-explain').click();
    await tutor.locator('.tutor-steps button', { hasText: 'Find two numbers' }).click();
    await expect(tutor.locator('.tutor-detail')).toContainText('p·q = c', { timeout: 30_000 });
    await expect(tutor.getByTestId('tutor-practice')).toBeVisible();
    await expect(tutor.getByTestId('tutor-video')).toBeVisible();
  });

  test('photo of printed math → solved straight away on the photo-solve screen', async ({ app, isMobile }) => {
    test.setTimeout(240_000);
    const reachable = await fetch('https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz', { method: 'HEAD' }).then((r) => r.ok, () => false);
    test.skip(!reachable, 'OCR language data needs one online visit and the CDN is unreachable');
    await addPhotos(app, isMobile, [join(FIX, 'printed-math.png')]);
    const card = app.getByTestId('snap-card').first();
    await expect(card.getByTestId('snap-read')).toHaveValue(/3\s*x\s*\+\s*5\s*=\s*20/, { timeout: 180_000 });
    await expect(card.getByTestId('snap-answer')).toHaveText('x = 5', { timeout: 120_000 });
    await card.getByTestId('snap-open-calc').click();
    await expect(app.getByTestId('snap')).toHaveCount(0);
    await expect(value(app)).toContainText('5', { timeout: 120_000 });
  });

  test('handwriting pad: strokes are read on the device into an editable line', async ({ app, page, isMobile }) => {
    test.setTimeout(240_000);
    const reachable = await fetch('https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz', { method: 'HEAD' }).then((r) => r.ok, () => false);
    test.skip(!reachable, 'OCR language data needs one online visit and the CDN is unreachable');
    test.skip(isMobile, 'the camera button opens the camera itself on phones');
    await app.locator('#attach').click();
    await app.getByTestId('snap-draw').click();
    const picker = app.getByTestId('picker');
    const pad = picker.getByTestId('ink-pad');
    await expect(pad).toBeVisible();
    const box = (await pad.boundingBox())!;
    const line = async (x0: number, y0: number, x1: number, y1: number) => {
      await page.mouse.move(box.x + x0, box.y + y0);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + x0 + ((x1 - x0) * i) / 8, box.y + y0 + ((y1 - y0) * i) / 8);
      await page.mouse.up();
    };
    // "1 + 1", written with straight strokes.
    await line(60, 50, 60, 150);
    await line(110, 100, 170, 100);
    await line(140, 70, 140, 130);
    await line(210, 50, 210, 150);
    await picker.getByTestId('ink-read').click();
    await expect(picker.getByTestId('ink-status')).toContainText(/Check what was read|Couldn’t read/, { timeout: 180_000 });
    // Whatever was read is editable before solving, so a misread is fixed by hand; it's solved on the photo screen.
    const first = picker.getByTestId('pick-line').first();
    await first.fill('1 + 1');
    await picker.getByTestId('pick-solve').first().click();
    await expect(app.getByTestId('snap-card').last().getByTestId('snap-answer')).toHaveText('2');
  });

  test('worksheet PDF → every question solved with steps → notes', async ({ app, isMobile }) => {
    test.setTimeout(300_000);
    test.skip(isMobile, 'the camera button opens the camera itself on phones');
    await app.locator('#attach').click();
    await app.getByTestId('snap-file').setInputFiles({ name: 'worksheet.pdf', mimeType: 'application/pdf', buffer: readFileSync(join(FIX, 'worksheet.pdf')) });
    const qs = app.getByTestId('snap-card');
    await expect(qs).toHaveCount(4, { timeout: 60_000 });
    await expect(qs.nth(0).getByTestId('snap-answer')).toHaveText('x = 4', { timeout: 240_000 });
    await expect(qs.nth(1).getByTestId('snap-answer')).toHaveText(/x = 2 or x = 3/, { timeout: 60_000 });
    await expect(qs.nth(2).getByTestId('snap-answer')).toHaveText('54', { timeout: 60_000 });
    await expect(qs.nth(3).getByTestId('snap-answer')).toHaveText('3x²', { timeout: 60_000 });
    await qs.nth(0).locator('summary').click();
    await expect(qs.nth(0)).toContainText('Subtract 3 from both sides');
    const download = app.waitForEvent('download');
    await app.getByTestId('snap-notes').click();
    const file = await (await download).path();
    expect(readFileSync(file!, 'utf8')).toContain('**Answer:** x = 4');
  });

  test('stat charts committed with Enter stay while typing', async ({ app }) => {
    test.setTimeout(120_000);
    await ask(app, 'histogram of 1, 2, 2, 3, 3, 3');
    const chart = app.locator('#graph-slot .plot-slot canvas').first();
    await expect(chart).toBeVisible({ timeout: 30_000 });
    await app.locator('#input').fill('2 + 2');
    await expect(value(app)).toHaveText('4');
    await expect(chart).toBeVisible();
    await app.locator('#input').press('Enter');
    await expect(app.locator('#graph-slot .plot-slot')).toHaveCount(0);
  });

  test('run-together letters and reference data', async ({ app }) => {
    test.setTimeout(240_000);
    await ask(app, '2xy');
    await expect(value(app)).toHaveText('2xy', { timeout: 200_000 });
    await ask(app, 'x = 3');
    await ask(app, '2xy');
    await expect(value(app)).toHaveText('6y', { timeout: 60_000 });
    await ask(app, 'density of gold');
    await expect(value(app)).toContainText('19.3');
    await ask(app, 'atomic mass of carbon times 2');
    await expect(value(app)).toContainText('24.02');
  });
});

test('working, line by line by default (steps open, foldable); "One line" in settings gives the compact summary', async ({ app }) => {
  test.setTimeout(120_000);
  await ask(app, 'solve 2x + 3 = 11');
  await expect(value(app)).toContainText('x = 4', { timeout: 100_000 });
  await expect(app.locator('#lines')).toBeEmpty();
  // Line by line: the steps are already open, one per line; no one-line summary.
  const steps = app.getByTestId('steps').locator('.step-reason');
  await expect(steps).toHaveText(['Start with the equation', 'Subtract 3 from both sides', 'Divide both sides by 2', /^Check/]);
  await expect(app.locator('.math .derivation:visible')).toHaveCount(0);
  // Reassurance ("✓ verified", "exact", which engine) is fine print, under Extra details.
  await expect(app.locator('#meta .fine').first()).toBeHidden();
  await app.getByTestId('show-steps').click();
  await expect(app.getByTestId('steps')).toBeHidden();

  // One line: the compact "2x − 8 = 0 ⇒ x = 4", steps folded.
  await app.locator('#open-settings').click();
  await app.locator('select[name="working"]').selectOption('inline');
  await app.keyboard.press('Escape');
  await ask(app, 'solve 10x = 2');
  await expect(value(app)).toContainText('1/5', { timeout: 100_000 });
  await expect(app.locator('.math .derivation.one-line')).toBeVisible();
  await expect(app.locator('.math .derivation.by-line')).toBeHidden();
  await expect(app.getByTestId('show-steps')).toHaveAttribute('aria-expanded', 'false');
});

/** The camera button: on a phone it opens the camera (a file chooser here); on a computer, the photo-solve screen. */
async function addPhotos(app: Page, isMobile: boolean, files: string[]) {
  if (isMobile) {
    const chooser = app.waitForEvent('filechooser');
    await app.locator('#attach').click();
    await (await chooser).setFiles(files);
  } else {
    await app.locator('#attach').click();
    await app.getByTestId('snap-file').setInputFiles(files);
  }
}
