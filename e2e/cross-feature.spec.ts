import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect, ask, openTool } from './helpers';

/**
 * Features working together: an answer filed into a notebook, the whiteboard over an exam, voice while the exam
 * is open, settings carried into other tools, backups that include exam results, and a full device.
 */

const PDF = readFileSync('e2e/fixtures/exam-quiz.pdf');

async function startExam(page: Page) {
  await openTool(page, 'exam');
  const view = page.locator('.ex-view');
  await view.getByRole('button', { name: 'Import my tests' }).click();
  await view.locator('#ex-file').setInputFiles([{ name: 'exam-quiz.pdf', mimeType: 'application/pdf', buffer: PDF }]);
  await expect(view.locator('.ex-doc-found')).toContainText('4 questions', { timeout: 20_000 });
  await view.getByRole('button', { name: 'Use these to build my exam' }).click();
  await view.getByRole('button', { name: 'Build exam and start' }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.ex-pp-item')).toHaveCount(4);
}

async function finishExam(page: Page) {
  await page.locator('[data-act="turnin"]').click();
  await page.getByRole('button', { name: 'Turn in', exact: true }).last().click();
  await expect(page.locator('.ex-res-q').first()).toBeVisible({ timeout: 15_000 });
}

/** Fills localStorage until it refuses more. */
const fillStorage = (page: Page) =>
  page.evaluate(() => {
    let chunk = 'x'.repeat(256 * 1024);
    let i = 0;
    while (chunk.length > 8) {
      try {
        localStorage.setItem(`zz-fill-${i++}`, chunk);
      } catch {
        chunk = chunk.slice(0, chunk.length >> 1);
      }
    }
  });

async function passphrase(page: Page, p: string, confirm: boolean) {
  const dialog = page.locator('#passphrase');
  await expect(dialog).toBeVisible();
  await page.locator('#pp1').fill(p);
  if (confirm) await page.locator('#pp2').fill(p);
  await page.locator('#pp-ok').click();
}

test('an answer saved in degrees and filed into a new notebook keeps its value there', async ({ app }) => {
  await ask(app, 'sin(30)');
  await expect(app.locator('#value')).toHaveText('0.5');
  await app.locator('#alts .chip', { hasText: 'Save note' }).click();
  await openTool(app, 'notes');
  await app.locator('#tool-body button', { hasText: 'Add to notebook' }).first().click();
  await expect(app.locator('#toast')).toContainText('Added to');
  await app.locator('#tool-close').click();
  await openTool(app, 'notebooks');
  const cell = app.locator('.nb-cell').last();
  await expect(cell.locator('textarea')).toHaveValue('sin(30)');
  await expect(cell.locator('.nb-out')).toContainText('0.5', { timeout: 15_000 });
  await expect(app.locator('.nb-bar .pill')).toHaveText('DEG');
});

test('the whiteboard answers in the calculator’s angle mode', async ({ app }) => {
  await app.locator('#angle').click();
  await expect(app.locator('#angle')).toHaveText('RAD');
  await openTool(app, 'whiteboard');
  const bar = app.locator('.wb-view input').last();
  await bar.fill('what is sin(pi/2)');
  await bar.press('Enter');
  await expect(app.locator('.wb-view')).toContainText(/(^|\s)1(\s|$)/, { timeout: 15_000 });
  await expect(app.locator('.wb-view')).not.toContainText('0.0274');
});

test('exam: focus moves into the simulator, and closing scratch work returns focus to the exam', async ({ app }) => {
  test.setTimeout(90_000);
  await openTool(app, 'exam');
  await expect.poll(() => app.evaluate(() => !!document.activeElement?.closest('.ex-view'))).toBe(true);
  await app.getByRole('button', { name: 'Close the exam simulator' }).click();

  await startExam(app);
  const scratch = app.locator('.ex-pp-item').first().getByRole('button', { name: 'Open whiteboard' });
  await scratch.click();
  await expect(app.locator('.wb-view canvas').first()).toBeVisible();
  await expect(app.locator('.wb-view canvas[tabindex]')).toBeFocused();
  await app.getByRole('button', { name: 'Close whiteboard' }).click();
  await expect(app.locator('.wb-view')).toHaveCount(0);
  // Back on the button that opened it; Safari never focuses a clicked button, so there it lands on the exam.
  if (test.info().project.name.includes('webkit') || test.info().project.name.includes('ios')) {
    await expect.poll(() => app.evaluate(() => !!document.activeElement?.closest('.ex-view'))).toBe(true);
  } else await expect(scratch).toBeFocused();
  await expect(app.locator('.ex-view')).not.toHaveAttribute('inert', '');
});

test('backups include exam results, and a full device can still make one', async ({ app, browser }) => {
  test.setTimeout(90_000);
  await startExam(app);
  await finishExam(app);
  await app.getByRole('button', { name: 'Close the exam simulator' }).click();
  // Fill storage first: making a backup must still work on a full device.
  await fillStorage(app);
  await app.locator('#open-settings').click();
  const download = app.waitForEvent('download');
  await app.locator('#sync-backup').click();
  await passphrase(app, 'plum-Orbit-7-Saxophone-quiet', true);
  const file = await (await download).path();
  await expect(app.locator('#toast')).toContainText('Saved lemma-backup');

  const other = await browser.newContext({ serviceWorkers: 'block' });
  const page = await other.newPage();
  await page.goto('/');
  await page.locator('#open-settings').click();
  await page.locator('#sync-file').setInputFiles(file);
  await passphrase(page, 'plum-Orbit-7-Saxophone-quiet', false);
  await expect(page.locator('#toast')).toContainText('exam result', { timeout: 15_000 });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('lemma.exam.history.v1') ?? '[]').length)).toBe(1);
  await other.close();
});

test('a full device: notes say they weren’t saved, and a restore changes nothing instead of half the data', async ({ app, browser }) => {
  // A backup with a note in it, made on another device.
  const other = await browser.newContext({ serviceWorkers: 'block' });
  const src = await other.newPage();
  await src.goto('/');
  await ask(src, '6*7');
  await src.locator('#alts .chip', { hasText: 'Save note' }).click();
  await src.locator('#open-settings').click();
  const download = src.waitForEvent('download');
  await src.locator('#sync-backup').click();
  await passphrase(src, 'plum-Orbit-7-Saxophone-quiet', true);
  const file = { name: 'backup.lemmasync', mimeType: 'application/octet-stream', buffer: readFileSync(await (await download).path()) };
  await other.close();

  await ask(app, '5*5');
  await fillStorage(app);
  await app.locator('#alts .chip', { hasText: 'Save note' }).click();
  await expect(app.locator('#toast')).toContainText('Notes are full');

  const before = await app.evaluate(() => Object.keys(localStorage).filter((k) => !k.startsWith('zz-')).map((k) => [k, localStorage.getItem(k)]));
  await app.locator('#open-settings').click();
  await app.locator('#sync-file').setInputFiles(file);
  await passphrase(app, 'plum-Orbit-7-Saxophone-quiet', false);
  await expect(app.locator('#toast')).toContainText('enough storage');
  const after = await app.evaluate(() => Object.keys(localStorage).filter((k) => !k.startsWith('zz-')).map((k) => [k, localStorage.getItem(k)]));
  expect(after).toEqual(before);
});

test('keep listening stops when the exam opens: the hidden calculator doesn’t answer what is said', async ({ page }) => {
  await page.addInitScript(() => {
    class FakeRecognition {
      lang = 'en-US';
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      live = false;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        this.live = true;
        (window as unknown as { __rec: FakeRecognition }).__rec = this;
      }
      stop() {
        this.live = false;
        setTimeout(() => this.onend?.(), 0);
      }
      abort() {
        this.stop();
      }
    }
    const w = window as unknown as Record<string, unknown>;
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;
    w.__say = (text: string) => {
      const rec = (window as unknown as { __rec?: FakeRecognition }).__rec;
      if (rec?.live) rec.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] });
    };
  });
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('lemma.settings.v1', JSON.stringify({ voiceEngine: 'browser' })));
  await page.reload();
  const say = (t: string) => page.evaluate((x) => (window as unknown as { __say: (t: string) => void }).__say(x), t);
  await page.locator('#loop').click();
  await expect(page.locator('#mic')).toHaveAttribute('aria-pressed', 'true');
  await say('2 plus 3');
  await expect(page.locator('#value')).toHaveText('5');
  await openTool(page, 'exam');
  await expect(page.locator('.ex-view')).toBeVisible();
  await expect(page.locator('#mic')).toHaveAttribute('aria-pressed', 'false');
  await say('9 times 9');
  await page.waitForTimeout(300);
  await expect(page.locator('#history li')).toHaveCount(1);
});

test('background folder sync never reloads the page under an exam in progress', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.lemmaDesktop = {
      isOverlay: false,
      platform: 'darwin',
      hideOverlay() {},
      resizeOverlay() {},
      openMain() {},
      onOverlayShown: () => () => {},
      sync: {
        status: async () => ({ folder: '/sync', hasPassphrase: true, keychain: true }),
        chooseFolder: async () => '/sync',
        read: async () => (w.__remote as Uint8Array | undefined) ?? null,
        write: async (b: Uint8Array) => void (w.__remote = b),
        savePassphrase: async () => {},
        passphrase: async () => 'a long sync passphrase 42',
      },
    };
  });
  await page.goto('/');
  // Another device adds history to the shared file.
  await ask(page, '1+1');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __remote?: unknown }).__remote)).toBe(true);
  const remote = await page.evaluate(() => Array.from((window as unknown as { __remote: Uint8Array }).__remote));
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.evaluate((bytes) => ((window as unknown as { __remote: Uint8Array }).__remote = new Uint8Array(bytes)), remote);

  await startExam(page);
  await page.locator('.ex-pp-item').first().getByRole('radio').first().click();
  await page.evaluate(() => ((window as unknown as { __marker: number }).__marker = 1));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(1);
  await expect(page.locator('.ex-pp-item')).toHaveCount(4);
});

test('the text-size setting reaches the exam simulator and the whiteboard', async ({ app }) => {
  // Same tokens as Settings → Text size → Extra large.
  await app.evaluate(() => document.documentElement.style.setProperty('--scale', '1.22'));
  const zoomOf = (sel: string) => app.locator(sel).first().evaluate((e) => Number(getComputedStyle(e).zoom));
  await openTool(app, 'exam');
  await app.locator('.ex-view').waitFor();
  expect(await zoomOf('.ex-view > div')).toBeCloseTo(1.22, 2);
  await app.getByRole('button', { name: 'Close the exam simulator' }).click();
  await openTool(app, 'whiteboard');
  await app.locator('.wb-toolbar').waitFor();
  expect(await zoomOf('.wb-toolbar')).toBeCloseTo(1.22, 2);
  // The drawing surface itself keeps its own scale, so pen input stays under the pointer.
  expect(await zoomOf('.wb-canvas')).toBe(1);
});
