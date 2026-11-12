import { test, expect, openTool } from './helpers';
import type { Page } from '@playwright/test';

/** Counts non-background pixels on the whiteboard canvas: a cheap "something was drawn" check. */
const inked = (page: Page) =>
  page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('.wb-view canvas');
    if (!c) return -1;
    const ctx = c.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    const [r0, g0, b0] = [data[0]!, data[1]!, data[2]!];
    let n = 0;
    for (let i = 0; i < data.length; i += 16) if (Math.abs(data[i]! - r0) + Math.abs(data[i + 1]! - g0) + Math.abs(data[i + 2]! - b0) > 60) n++;
    return n;
  });

const command = async (page: Page, text: string) => {
  const bar = page.locator('.wb-view input').last();
  await bar.fill(text);
  await bar.press('Enter');
};

test('whiteboard from Study: typed commands are done on the board', async ({ app }) => {
  await openTool(app, 'whiteboard');
  await expect(app.locator('.wb-view canvas').first()).toBeVisible();
  const before = await inked(app);
  await command(app, 'solve 2x + 3 = 11 and circle the answer');
  await expect(app.locator('.wb-view')).toContainText(/x = 4/, { timeout: 15_000 });
  await expect.poll(() => inked(app), { timeout: 15_000 }).toBeGreaterThan(before + 200);
  const afterSolve = await inked(app);
  await command(app, 'graph sin x');
  await expect(app.locator('.wb-view')).toContainText(/Graphed sin x/);
  // The board scrolls to show the new graph (on a phone that moves the equation off-screen), so check that the
  // view still has plenty drawn rather than that it has more than before.
  await expect.poll(() => inked(app), { timeout: 15_000 }).toBeGreaterThan(Math.min(afterSolve, before + 200));
  await command(app, 'undo');
  await expect(app.locator('.wb-view')).toContainText('Undone');
  await command(app, 'what is 17 * 23');
  await expect(app.locator('.wb-view')).toContainText('391');
});

test('"open the whiteboard" from the main input', async ({ app }) => {
  await app.locator('#input').fill('open the whiteboard');
  await app.locator('#input').press('Enter');
  await expect(app.locator('.wb-view canvas').first()).toBeVisible();
});

test('voice on the whiteboard: what you say is drawn, until you say stop', async ({ page }) => {
  await page.addInitScript(() => {
    class FakeRecognition {
      lang = 'en-US';
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        (window as unknown as { __rec: FakeRecognition }).__rec = this;
      }
      stop() {
        setTimeout(() => this.onend?.(), 0);
      }
      abort() {
        this.stop();
      }
    }
    const w = window as unknown as Record<string, unknown>;
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;
    w.__say = (text: string, final = true) =>
      (window as unknown as { __rec?: FakeRecognition }).__rec?.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: final })] });
    localStorage.setItem('lemma.settings.v1', JSON.stringify({ voiceEngine: 'browser' }));
  });
  await page.goto('/');
  await openTool(page, 'whiteboard');
  const view = page.locator('.wb-view');
  await view.getByRole('button', { name: 'Speak a command' }).click();
  await expect(view.getByRole('button', { name: 'Stop listening' })).toBeVisible();
  const say = (t: string, final = true) => page.evaluate(([x, f]) => (window as unknown as { __say: (t: string, f: boolean) => void }).__say(x as string, f as boolean), [t, final] as const);
  await say('draw a number', false);
  await expect(view.locator('input').last()).toHaveValue('draw a number');
  await say('draw a number line from -5 to 5');
  await expect(view).toContainText('Number line from -5 to 5');
  await say('solve x^2 - 5x + 6 = 0 and box the answer');
  await expect(view).toContainText(/x = 2/, { timeout: 15_000 });
  await say('stop listening');
  await expect(view).toContainText('Stopped listening');
});

test('stray words like "and" are ignored, and Done or Esc leaves the board', async ({ app }) => {
  await openTool(app, 'whiteboard');
  const view = app.locator('.wb-view');
  await command(app, 'write 2x + 3 and');
  await expect(view.locator('.wb-status')).toHaveText('Written');
  for (const stray of ['and', 'and then', 'uh so']) {
    await command(app, stray);
    await expect(view.locator('.wb-status')).not.toContainText('instruction');
  }
  await expect(view.locator('.wb-status')).toHaveText('Written');
  // A clear way out, labelled.
  await expect(view.getByRole('button', { name: 'Close whiteboard' })).toContainText('Done');
  // Esc in the empty command bar leaves.
  await view.locator('input').last().press('Escape');
  await expect(view).toHaveCount(0);
  await openTool(app, 'whiteboard');
  await app.locator('.wb-view canvas[tabindex]').focus();
  await app.keyboard.press('Escape');
  await expect(app.locator('.wb-view')).toHaveCount(0);
});
