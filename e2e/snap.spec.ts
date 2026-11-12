import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './helpers';

// Photo solve: its own screen. Every problem in a photo is solved straight away, a likely misread is held back for
// checking (never answered), several photos go one at a time or all at once, and follow-ups carry on in place.
const SHEET = 'e2e/fixtures/worksheet-photo.png';

test.beforeEach(async ({}, info) => {
  test.skip(!['chromium', 'mobile-android', 'mobile-ios', 'webkit'].includes(info.project.name), 'reading photos is slow; one desktop and one phone engine');
});

async function open(app: Page, isMobile: boolean, files: string[]) {
  if (isMobile) {
    const chooser = app.waitForEvent('filechooser');
    await app.locator('#attach').click();
    await (await chooser).setFiles(files);
  } else {
    await app.locator('#attach').click();
    await expect(app.getByTestId('snap')).toBeVisible();
    await app.getByTestId('snap').getByTestId('snap-file').setInputFiles(files);
  }
  await expect(app.getByTestId('snap')).toBeVisible();
}

const settled = (app: Page) =>
  expect.poll(() => app.getByTestId('snap-card').evaluateAll((cs) => cs.length > 0 && cs.every((c) => c.getAttribute('data-state') !== 'solving')), { timeout: 150_000 }).toBe(true);

test('a worksheet photo: readable problems are solved at once, misreads are held back with fixes', async ({ app, isMobile }) => {
  test.setTimeout(240_000);
  await open(app, isMobile, [SHEET]);
  await settled(app);
  const cards = app.getByTestId('snap-card');
  await expect(cards).toHaveCount(5);
  await expect(cards.nth(0).getByTestId('snap-answer')).toHaveText('x = 5');
  await expect(cards.nth(1).getByTestId('snap-answer')).toHaveText('x = 2 or x = 3');
  await expect(cards.nth(2).getByTestId('snap-answer')).toHaveText('45');
  // The stacked fraction and the misread root: no answer until confirmed, a best guess, and the bit of the photo.
  for (const i of [3, 4]) {
    await expect(cards.nth(i)).toHaveAttribute('data-state', 'check');
    await expect(cards.nth(i).getByTestId('snap-answer')).toBeEmpty();
    await expect(cards.nth(i).getByTestId('snap-flag')).toContainText('Best guess');
    await expect(cards.nth(i).locator('.snap-crop')).toBeVisible();
  }
  // The misread root comes back as the reader's best guess, already put right and typeset, with what it comes to:
  // one tap on Solve (or an edit first).
  const root = cards.nth(4);
  await expect(root.getByTestId('snap-read')).toHaveValue('sqrt(144) + 2^3');
  await expect(root.getByTestId('snap-guess')).toBeVisible();
  await expect(root.getByTestId('snap-preview')).toHaveText('= 20', { timeout: 30_000 });
  await root.getByTestId('snap-solve').click();
  await expect(root.getByTestId('snap-answer')).toHaveText('20', { timeout: 60_000 });
  // Editing a guess updates its preview before solving.
  const frac = cards.nth(3);
  await frac.getByTestId('snap-edit').click();
  await frac.getByTestId('snap-read').fill('3/4 + 1/6');
  await expect(frac.getByTestId('snap-preview')).toHaveText(/= 0\.91|11\/12/, { timeout: 30_000 });
  await frac.getByTestId('snap-solve').click();
  await expect(frac.getByTestId('snap-answer')).toContainText(/0\.91|11\/12/, { timeout: 60_000 });
  // Each problem is outlined on the photo.
  await expect(app.getByTestId('crop-mark')).toHaveCount(5);
});

test('follow-ups carry on in place: typed, about the last problem, and Back returns to the calculator', async ({ app, isMobile }) => {
  test.setTimeout(240_000);
  await open(app, isMobile, [SHEET]);
  await settled(app);
  const text = app.getByTestId('snap-text');
  await text.fill('factor x^2 - 5x + 6');
  await text.press('Enter');
  const last = app.getByTestId('snap-card').last();
  await expect(last.getByTestId('snap-answer')).toHaveText(/\(x\s*[−-]\s*3\)\s*\(x\s*[−-]\s*2\)|\(x\s*[−-]\s*2\)\s*\(x\s*[−-]\s*3\)/, { timeout: 60_000 });
  await text.fill('what if x = 4');
  await text.press('Enter');
  // About the last answered problem (the factoring): x² − 5x + 6 at x = 4 is 2.
  await expect(app.getByTestId('snap-card').last().getByTestId('snap-answer')).toHaveText('2', { timeout: 60_000 });
  await app.getByTestId('snap-back').click();
  await expect(app.getByTestId('snap')).toHaveCount(0);
  await expect(app.locator('#input')).toBeVisible();
});

test('follow-ups on an inequality and with an instruction; Esc spares a typed follow-up; reopening restores the session', async ({ app, isMobile }) => {
  test.setTimeout(300_000);
  await open(app, isMobile, [SHEET]);
  await settled(app);
  const cards = app.getByTestId('snap-card');
  const text = app.getByTestId('snap-text');
  await text.fill('x^2 - 4 >= 0');
  await text.press('Enter');
  await expect(cards).toHaveCount(6);
  await expect(cards.nth(5)).not.toHaveAttribute('data-state', 'solving', { timeout: 60_000 });
  // "factor it" factors the polynomial side of the inequality.
  await text.fill('factor it');
  await text.press('Enter');
  await expect(cards.nth(6).getByTestId('snap-read')).toHaveValue('factor (x^2 - 4)');
  await expect(cards.nth(6).getByTestId('snap-answer')).toHaveText(/\(x\s*[−-]\s*2\)\s*\(x\s*\+\s*2\)|\(x\s*\+\s*2\)\s*\(x\s*[−-]\s*2\)/, { timeout: 60_000 });
  // A worksheet-style instruction is kept when the line is retried without its colon.
  await text.fill('Differentiate: x^3');
  await text.press('Enter');
  await expect(cards.nth(7).getByTestId('snap-answer')).toHaveText(/3\s*[·*]?\s*x\s*(\^\s*2|²)/, { timeout: 60_000 });
  // Esc while a follow-up is typed does nothing; with the box empty it closes.
  await text.fill('draft');
  await text.press('Escape');
  await expect(app.getByTestId('snap')).toBeVisible();
  await text.fill('');
  await text.press('Escape');
  await expect(app.getByTestId('snap')).toHaveCount(0);
  // Reopening in the same page session brings every photo and card back.
  await open(app, isMobile, [SHEET]);
  await expect(cards.nth(0).getByTestId('snap-answer')).toHaveText('x = 5');
  await expect(cards.nth(6).getByTestId('snap-read')).toHaveValue('factor (x^2 - 4)');
});

test('several photos: the user chooses one at a time or all at once', async ({ app, isMobile }) => {
  test.skip(isMobile, 'the phone camera takes one photo at a time');
  test.setTimeout(300_000);
  const dir = mkdtempSync(join(tmpdir(), 'snap-'));
  const a = join(dir, 'page-1.png');
  const b = join(dir, 'page-2.png');
  copyFileSync(SHEET, a);
  copyFileSync('e2e/fixtures/printed-math.png', b);
  await open(app, false, [a, b]);
  await expect(app.getByTestId('snap-choose')).toContainText('2 photos');
  await app.getByTestId('snap-one').click();
  // One at a time: the first is read, then "Next photo" reads the second.
  await expect(app.getByTestId('snap-next')).toBeVisible({ timeout: 150_000 });
  await expect(app.getByTestId('snap-group')).toHaveCount(1);
  await app.getByTestId('snap-next').click();
  await expect(app.getByTestId('snap-group')).toHaveCount(2);
  await expect(app.getByTestId('snap-group').nth(1).getByTestId('snap-card').first().getByTestId('snap-answer')).toHaveText('x = 5', { timeout: 150_000 });

  // All at once, after closing and reopening (the earlier two are still there).
  await app.getByTestId('snap-back').click();
  await open(app, false, [a, b]);
  await app.getByTestId('snap').getByTestId('snap-all').click();
  await expect(app.getByTestId('snap').getByTestId('snap-group')).toHaveCount(4);
  await expect(app.getByTestId('snap').getByTestId('snap-group').nth(3).getByTestId('snap-card').first().getByTestId('snap-answer')).toHaveText('x = 5', { timeout: 200_000 });
  await expect(app.getByTestId('snap').getByTestId('snap-next')).toHaveCount(0);
});

test('desktop gets two panes side by side; a phone stacks them', async ({ app, isMobile }) => {
  test.setTimeout(240_000);
  await open(app, isMobile, [SHEET]);
  // Both boxes in one go: the photo shrinks to a strip when answers arrive, which would move one between two reads.
  const [src, thread] = await app.evaluate(() => ['.snap-source', '.snap-thread'].map((s) => document.querySelector(s)!.getBoundingClientRect().toJSON() as DOMRect));
  if (isMobile) expect(thread.y).toBeGreaterThanOrEqual(src.y + src.height - 1);
  else {
    expect(thread.x).toBeGreaterThanOrEqual(src.x + src.width - 1);
    expect(Math.abs(thread.y - src.y)).toBeLessThan(2);
  }
  expect(await app.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test('desktop: Camera shows a live view and Capture adds the picture', async ({ app, isMobile, browserName }) => {
  test.skip(isMobile, 'phones use their own camera app');
  test.skip(browserName === 'webkit', 'the stand-in webcam needs canvas streams, which test WebKit lacks');
  // A stand-in webcam: a canvas stream (no camera, permission prompt or launch flags needed).
  await app.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const c = document.createElement('canvas');
      c.width = 640;
      c.height = 360;
      const g = c.getContext('2d')!;
      g.fillStyle = '#f6f2e8';
      g.fillRect(0, 0, 640, 360);
      g.fillStyle = '#222';
      g.font = '48px Georgia';
      g.fillText('12 + 30', 200, 200);
      setInterval(() => g.fillRect(0, 0, 1, 1), 100);
      return c.captureStream(10);
    };
  });
  await app.locator('#attach').click();
  await app.getByTestId('snap-camera').click();
  await expect(app.getByTestId('snap-video')).toBeVisible();
  await expect.poll(() => app.getByTestId('snap-video').evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);
  await app.getByTestId('snap-capture').click();
  await expect(app.getByTestId('snap-video')).toHaveCount(0);
  await expect(app.getByTestId('snap').getByTestId('snap-group')).toHaveCount(1);
});
