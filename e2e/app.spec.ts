import { ask, expect, test, value } from './helpers';

test('instant calculator and the follow-up chain', async ({ app }) => {
  await ask(app, "What's 20% of 450?");
  await expect(value(app)).toHaveText('90');
  await ask(app, 'Add that to the original number');
  await expect(value(app)).toHaveText('540');
  await ask(app, 'now subtract 15');
  await expect(value(app)).toHaveText('525');
});

test('live preview while typing, quiet on incomplete input', async ({ app }) => {
  const input = app.locator('#input');
  await input.fill('12000 + 450');
  await expect(value(app)).toHaveText('12,450');
  await input.fill('12000 +');
  await expect(value(app)).toHaveClass(/quiet/);
});

test('ambiguity is offered, not guessed', async ({ app }) => {
  await ask(app, 'what is 20 percent of 450 plus 30');
  await expect(value(app)).toHaveText('120');
  // The other reading sits under "How it was read", folded by default.
  await app.getByTestId('interp-toggle').click();
  await app.locator('.alt:visible').first().click();
  await expect(value(app)).toHaveText('96');
});

test('everyday engines: units, dates, finance, currency', async ({ app }) => {
  await ask(app, '50 miles to km');
  await expect(value(app)).toContainText('80.4672');
  await ask(app, 'is 2028 a leap year');
  await expect(value(app)).toHaveText('Yes');
  await ask(app, 'monthly payment on a $300,000 loan at 4.5% over 30 years');
  await expect(value(app)).toContainText('$1,520.06');
  await ask(app, '18% tip on $64.50 split 3 ways');
  await expect(value(app)).toContainText('$11.61');
  await ask(app, '100 usd to eur');
  await expect(value(app)).toContainText('€89.85');
  await expect(app.locator('#meta')).toContainText('2026-10-29');
});

test('advanced engines: stats, science, number theory', async ({ app }) => {
  await ask(app, 'std dev of 2 4 4 4 5 5 7 9');
  await expect(value(app)).toHaveText('2.1380899353');
  await ask(app, 'balance C3H8 + O2 -> CO2 + H2O');
  await expect(value(app)).toContainText('5O₂');
  await ask(app, 'prime factorization of 360');
  await expect(value(app)).toHaveText('2³ × 3² × 5');
  await ask(app, '255 in hex');
  await expect(value(app)).toContainText('0xFF');
});

test('graph renders, pans and has sliders', async ({ app }) => {
  await ask(app, 'graph a*sin(x) and x^2/4 - 2');
  const canvas = app.locator('.graph canvas');
  await expect(canvas).toBeVisible();
  await expect(app.locator('.graph-slider')).toHaveCount(1);
  // Something other than the background was drawn.
  // The first frame is drawn on the next animation frame after the canvas is sized; poll for it.
  await expect
    .poll(() =>
      canvas.evaluate((c: HTMLCanvasElement) => {
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        const colours = new Set<number>();
        for (let i = 0; i < d.length; i += 4 * 97) colours.add((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
        return colours.size;
      }),
    )
    .toBeGreaterThan(5);
  const before = await canvas.screenshot();
  const box = (await canvas.boundingBox())!;
  await app.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await app.mouse.down();
  await app.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 40, { steps: 6 });
  await app.mouse.up();
  expect(Buffer.compare(before, await canvas.screenshot())).not.toBe(0);
});

test('history persists across reloads; pinning; formulas', async ({ app }) => {
  await ask(app, 'f(x) = x^2 + 1');
  await ask(app, 'f(4) + 1');
  await expect(value(app)).toHaveText('18');
  await app.locator('#history .pin').first().click();
  await app.reload();
  await expect(app.locator('#pinned')).toContainText('f(4) + 1');
  await expect(app.locator('.formula')).toContainText('f(x)');
  await ask(app, 'f(2)');
  await expect(value(app)).toHaveText('5');
});

test('timer starts and counts down', async ({ app }) => {
  await ask(app, 'set a timer for 90 seconds');
  const clock = app.locator('.t-clock');
  await expect(clock).toHaveText(/1:(29|30)/);
});

test('settings dialog, theme and angle mode', async ({ app }) => {
  await app.locator('#open-settings').click();
  await expect(app.locator('#settings')).toBeVisible();
  await app.locator('select[name="theme"]').selectOption('dark');
  await expect(app.locator('html')).toHaveAttribute('data-theme', 'dark');
  await app.keyboard.press('Escape');
  await app.locator('#angle').click();
  await ask(app, 'sin(pi/2)');
  await expect(value(app)).toHaveText('1');
});

test('voice button is usable or explains why not', async ({ app }) => {
  const mic = app.locator('#mic');
  const disabled = await mic.isDisabled();
  if (disabled) await expect(mic).toHaveAttribute('title', /isn’t supported/);
});

test('layout fits the viewport with no horizontal scroll', async ({ app }) => {
  await ask(app, 'monthly payment on a $300,000 loan at 4.5% over 30 years');
  const overflow = await app.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('Enter commits even if you keep typing before a lazy engine finishes loading', async ({ page }) => {
  await page.goto('/');
  const input = page.locator('#input');
  // Immediately after load: the advanced engines may still be downloading.
  await input.fill('k = 7');
  await input.press('Enter');
  await input.fill('k * 6');
  await expect(page.locator('#value')).toHaveText('42');
});

test('pressing Enter twice while an engine loads commits once', async ({ page }) => {
  // Hold back every lazy chunk so the conversion is still pending when Enter is pressed again.
  await page.route(/\/assets\/(?!index)[^/]+\.js$|unit-engine/, async (r) => {
    await new Promise((s) => setTimeout(s, 1500));
    await r.continue();
  });
  await page.goto('/');
  const input = page.locator('#input');
  await input.fill('5 km to miles');
  await input.press('Enter');
  await input.press('Enter');
  await expect(page.locator('#value')).toContainText('3.1068', { timeout: 15_000 });
  await page.waitForTimeout(500);
  await expect(page.locator('#history .h-in', { hasText: '5 km to miles' })).toHaveCount(1);
});

test('"/" focuses the calculator, but types normally in other fields', async ({ app }) => {
  await app.locator('#open-study').click();
  await app.locator('.tool-row[data-tool="practice"]').click();
  const answer = app.locator('#tool-body input[aria-label="Your answer"]');
  await answer.click();
  await app.keyboard.type('3/4');
  await expect(answer).toHaveValue('3/4');
  await app.locator('#tool-close').click();
  await expect(app.locator('#tool')).toBeHidden(); // the sheet animates out first
  await app.locator('#open-settings').focus();
  await app.keyboard.press('/');
  await expect(app.locator('#input')).toBeFocused();
});

test('unknown names: quiet while a word is being typed, explained once the expression goes on', async ({ app }) => {
  const input = app.locator('#input');
  await input.fill('2 * qq');
  await app.waitForTimeout(1200);
  await expect(app.locator('#meta')).not.toContainText('Unknown name');
  await input.fill('qq * 3');
  await expect(app.locator('#meta')).toContainText('Unknown name "qq"', { timeout: 3000 });
});

test('a long timer label fits a 360px screen at the largest text size', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.addInitScript(() => localStorage.setItem('lemma.settings.v1', JSON.stringify({ textSize: 'xl' })));
  await page.goto('/');
  await page.locator('#input').fill('timer 5 minutes for the very long label tea brewing session');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.timer')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('small text uses readable colours in every look, light and dark', async ({ page }) => {
  await page.goto('/');
  // Muted text sits on the page, on cards and on tinted panels (practice questions): each must reach 4.5:1.
  const looks = ['comfy', 'paper', 'dusk', 'ocean', 'classic', 'contrast'];
  const bad: string[] = [];
  for (const look of looks)
    for (const theme of ['light', 'dark']) {
      await page.evaluate(([look, theme]) => localStorage.setItem('lemma.settings.v1', JSON.stringify({ look, theme })), [look, theme]);
      await page.reload();
      const r = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        const hex = (v: string) => {
          const n = parseInt(cs.getPropertyValue(v).trim().slice(1), 16);
          return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
            const x = c / 255;
            return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
          });
        };
        const L = (v: string) => {
          const [r, g, b] = hex(v) as [number, number, number];
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const ratio = (a: string, b: string) => (Math.max(L(a), L(b)) + 0.05) / (Math.min(L(a), L(b)) + 0.05);
        return { bg: ratio('--muted', '--bg'), surface: ratio('--muted', '--surface'), surface2: ratio('--muted', '--surface-2') };
      });
      for (const [k, v] of Object.entries(r)) if (v < 4.5) bad.push(`${look} ${theme} muted on ${k}: ${v.toFixed(2)}`);
    }
  expect(bad).toEqual([]);
});
