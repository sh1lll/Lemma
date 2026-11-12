import { test, expect } from '@playwright/test';

/**
 * Continuous voice with a stand-in recognizer: the page's SpeechRecognition is replaced before the app loads,
 * and the test "speaks" by pushing interim and final transcripts. Covers keep-listening, chaining on the tape,
 * live partial updates, undo, start over, and stop.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    class FakeRecognition extends EventTarget {
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
    w.__say = (text: string, final = true) => {
      const rec = (window as unknown as { __rec?: FakeRecognition }).__rec;
      rec?.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: final })] });
    };
    // Browsers end a session after a pause; the app must resume it while keep-listening is on.
    w.__pause = () => (window as unknown as { __rec?: FakeRecognition }).__rec?.onend?.();
    // Records what would be read aloud.
    const spoken: string[] = [];
    w.__spoken = spoken;
    class FakeUtterance {
      lang = '';
      rate = 1;
      constructor(public text: string) {}
    }
    w.SpeechSynthesisUtterance = FakeUtterance;
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { speak: (u: FakeUtterance) => spoken.push(u.text), cancel() {}, getVoices: () => [], speaking: false, pending: false },
    });
  });
  await page.goto('/');
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('lemma.settings.v1') ?? '{}');
    localStorage.setItem('lemma.settings.v1', JSON.stringify({ ...s, voiceEngine: 'browser' }));
  });
  await page.reload();
});

const say = (page: import('@playwright/test').Page, text: string, final = true) => page.evaluate(([t, f]) => (window as unknown as { __say: (t: string, f: boolean) => void }).__say(t as string, f as boolean), [text, final] as const);

test('keep listening: chain by voice, undo, start over, stop', async ({ page }) => {
  await page.locator('#loop').click();
  await expect(page.locator('#loop')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#mic')).toHaveAttribute('aria-pressed', 'true');
  const tape = page.locator('#tape');
  await expect(tape).toBeVisible();

  await say(page, '12 plus', false);
  await say(page, '12 plus 8');
  await expect(page.locator('#value')).toHaveText('20');
  await say(page, 'times 3');
  await expect(page.locator('#value')).toHaveText('60');
  // The session ends after a pause; keep-listening resumes it.
  await page.evaluate(() => (window as unknown as { __pause: () => void }).__pause());
  await expect(page.locator('#mic')).toHaveAttribute('aria-pressed', 'true');
  await say(page, 'minus 5 then divided by 5');
  await expect(page.locator('#value')).toHaveText('11');
  await expect(tape.locator('li')).toHaveCount(4);

  // Live preview of a spoken chain before it's final.
  await say(page, 'plus 4 then times 2', false);
  await expect(page.locator('#value')).toHaveText('30');

  await say(page, 'undo');
  await expect(tape.locator('li')).toHaveCount(3);
  await say(page, 'plus 1');
  await expect(page.locator('#value')).toHaveText('56');

  await say(page, 'start over');
  await expect(tape.locator('li')).toHaveCount(0);
  await say(page, '7 times 6');
  await expect(page.locator('#value')).toHaveText('42');

  await say(page, 'stop');
  await expect(page.locator('#mic')).toHaveAttribute('aria-pressed', 'false');
});

test('undo and start over never bring a removed result back', async ({ page }) => {
  await page.locator('#loop').click();
  await say(page, '12 plus 8');
  await say(page, 'times 3');
  await expect(page.locator('#value')).toHaveText('60');
  await say(page, 'undo');
  await expect(page.locator('#value')).toHaveText('20');
  // Emptying the input shows the last result that still stands, not the one that was undone.
  await page.locator('#input').fill('9');
  await page.locator('#input').fill('');
  await expect(page.locator('#value')).toHaveText('20');
  await say(page, 'start over');
  await page.locator('#input').fill('9');
  await page.locator('#input').fill('');
  await expect(page.locator('#value')).toHaveText('0');
});

test('a phrase spoken while the previous one waits for an engine runs after it, not instead of it', async ({ page }) => {
  await page.route(/\/assets\/(?!index)[^/]+\.js$|unit-engine/, async (r) => {
    await new Promise((s) => setTimeout(s, 1500));
    await r.continue();
  });
  await page.reload();
  await page.locator('#loop').click();
  await say(page, '5 km to m');
  await say(page, 'plus 1');
  await expect(page.locator('#tape-steps li')).toHaveCount(2, { timeout: 15_000 });
  await expect(page.locator('#value')).toHaveText('5,001');
});

test('hands-free carries into the whiteboard and back to the calculator', async ({ page }) => {
  await page.locator('#loop').click();
  await expect(page.locator('#mic')).toHaveAttribute('aria-pressed', 'true');
  await say(page, 'open the whiteboard');
  await expect(page.locator('.wb-view')).toBeVisible();
  // The board picks up listening on its own.
  await expect(page.getByRole('button', { name: 'Stop listening' })).toBeVisible();
  await say(page, 'write 2 + 2 = 4');
  await say(page, 'close the whiteboard');
  await expect(page.locator('.wb-view')).toHaveCount(0);
  // …and the calculator carries on listening.
  await expect(page.locator('#mic')).toHaveAttribute('aria-pressed', 'true');
  await say(page, '6 times 7');
  await expect(page.locator('#value')).toHaveText('42');
});

// ---------- end-of-speech patience ----------

type Win = { __spoken: string[]; __say: (t: string, f: boolean) => void };
const spoken = (page: import('@playwright/test').Page) => page.evaluate(() => (window as unknown as Win).__spoken.slice());
async function voiceSettings(page: import('@playwright/test').Page, extra: Record<string, unknown>) {
  await page.evaluate((x) => {
    const s = JSON.parse(localStorage.getItem('lemma.settings.v1') ?? '{}');
    localStorage.setItem('lemma.settings.v1', JSON.stringify({ ...s, voiceEngine: 'browser', ...x }));
  }, extra);
  await page.reload();
}
/** Says a final phrase and resolves with how long (ms) until it reached history. */
const timeToCommit = (page: import('@playwright/test').Page, text: string) =>
  page.evaluate(
    (t) =>
      new Promise<number>((resolve) => {
        const before = document.querySelectorAll('#history li').length;
        const t0 = performance.now();
        (window as unknown as Win).__say(t, true);
        const tick = () => (document.querySelectorAll('#history li').length > before ? resolve(performance.now() - t0) : setTimeout(tick, 20));
        tick();
      }),
    text,
  );

test('half-heard words never show an error or get read aloud', async ({ page }) => {
  await voiceSettings(page, { speakResults: true });
  await page.locator('#mic').click();
  await expect(page.locator('#mic')).toHaveAttribute('aria-pressed', 'true');
  // Watch for any error state at all while speaking.
  await page.evaluate(() => {
    const w = window as unknown as { __sawError: boolean };
    w.__sawError = false;
    new MutationObserver(() => {
      if (document.querySelector('#value.error') || /Unknown name/.test(document.querySelector('.result')?.textContent ?? '')) w.__sawError = true;
    }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  for (const partial of ['what', 'what is x', 'what is x plus', 'twelve blah', 'x times']) {
    await say(page, partial, false);
    await page.waitForTimeout(150);
  }
  await expect(page.locator('#input')).toHaveValue('x times');
  await page.waitForTimeout(1200);
  await say(page, '6 times', false);
  await expect(page.locator('#value')).not.toHaveClass(/error/);
  // A clean partial shows a quiet live result.
  await say(page, '6 times 7', false);
  await expect(page.locator('#value')).toHaveText('42');
  expect(await page.evaluate(() => (window as unknown as { __sawError: boolean }).__sawError)).toBe(false);
  expect(await spoken(page)).toEqual([]);
  // The finished phrase is read aloud once.
  await say(page, '6 times 7');
  await expect(page.locator('#history li')).toHaveCount(1);
  await expect.poll(() => spoken(page)).toEqual(['42']);
});

test('a phrase split across two quick finals is used once, whole', async ({ page }) => {
  await page.locator('#mic').click();
  await say(page, 'twelve plus');
  await page.waitForTimeout(400);
  await say(page, 'eight');
  await expect(page.locator('#value')).toHaveText('20');
  await expect(page.locator('#history li')).toHaveCount(1);
  await expect(page.locator('#history li').first()).toContainText('20');
  // Without "keep listening" the mic stops after the phrase.
  await expect(page.locator('#mic')).toHaveAttribute('aria-pressed', 'false');
});

test('ending on a connector waits longer for the rest', async ({ page }) => {
  await page.locator('#loop').click();
  await say(page, '12 plus');
  // Past the normal pause (900 ms), still waiting: "plus" needs more.
  await page.waitForTimeout(1200);
  await expect(page.locator('#history li')).toHaveCount(0);
  await say(page, '8');
  await expect(page.locator('#value')).toHaveText('20');
  await expect(page.locator('#history li')).toHaveCount(1);
});

test('"Wait after I stop" changes the pause', async ({ page }) => {
  // Set from Settings → Voice → More, like a person would.
  await page.locator('#open-settings').click();
  const select = page.locator('select[name="voicePatience"]');
  await select.evaluate((el) => el.closest('details')?.setAttribute('open', ''));
  await expect(select).toHaveValue('normal');
  await select.selectOption('short');
  await page.keyboard.press('Escape');
  await page.locator('#loop').click();
  const short = await timeToCommit(page, '7 times 6');
  expect(short).toBeGreaterThanOrEqual(450);
  expect(short).toBeLessThan(880);

  await voiceSettings(page, { voicePatience: 'long', continuousListening: false });
  await page.locator('#loop').click();
  await expect(page.locator('#mic')).toHaveAttribute('aria-pressed', 'true');
  const long = await timeToCommit(page, '7 times 6');
  expect(long).toBeGreaterThanOrEqual(1450);
});

test('a phrase that makes no sense shows what was heard, and nothing is read aloud', async ({ page }) => {
  await voiceSettings(page, { speakResults: true });
  await page.locator('#loop').click();
  await say(page, 'purple monkey dishwasher');
  await expect(page.locator('#expr')).toContainText('Heard: “purple monkey dishwasher”');
  await expect(page.locator('#value')).toHaveText('Try again');
  await expect(page.locator('#value')).not.toHaveClass(/error/);
  await expect(page.locator('.result')).not.toContainText('Unknown name');
  await page.waitForTimeout(300);
  expect(await spoken(page)).toEqual([]);
  // "Scratch that" right after a phrase drops it instead of undoing the step before.
  await say(page, '5 plus 5');
  await expect(page.locator('#history li')).toHaveCount(1);
  await say(page, '9 times 9');
  await say(page, 'scratch that');
  await page.waitForTimeout(1500);
  await expect(page.locator('#history li')).toHaveCount(1);
  await expect(page.locator('#value')).toHaveText('10');
});
