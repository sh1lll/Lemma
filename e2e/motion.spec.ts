import type { Page } from '@playwright/test';
import { ask, expect, test } from './helpers';

// Motion (apps/web/src/motion.ts): Calm means no animation at all; each kind of motion has its own switch;
// everything that plays is over within 300 ms; dialogs animate out and then really close; folds keep their state.

type Group = 'Answers' | 'Panels' | 'Content' | 'Feedback' | 'Press' | 'Mic';

/** Opens the app with these settings (on top of the test defaults). */
async function openWith(page: Page, settings: Record<string, unknown>) {
  await page.addInitScript((s) => localStorage.setItem('lemma.settings.v1', JSON.stringify({ warmOnStart: false, ...s })), settings);
  await page.goto('/');
  await expect(page.locator('#input')).toBeVisible();
}

/**
 * Animations that really move, running on the page now (or under one element): longer than 1 ms (Calm leaves
 * ~0 ms leftovers), and not colour transitions (the theme settling at start-up), which are no kind of motion.
 */
// Loading shimmers loop until their content arrives (checked separately: none under Calm), so they're not counted here.
const moving = (list: Animation[]) => list.filter((a) => a.playState === 'running' && !('transitionProperty' in a) && Number(a.effect?.getComputedTiming().endTime ?? 0) > 1 && Number(a.effect?.getComputedTiming().endTime) !== Infinity).length;
const running = (page: Page, selector?: string) =>
  page.evaluate(
    ([sel, src]) => {
      const count = new Function(`return ${src}`)() as (l: Animation[]) => number;
      return count(sel ? document.querySelector(sel)!.getAnimations({ subtree: true }) : document.getAnimations());
    },
    [selector, moving.toString()] as const,
  );

/** Clicks in the page and counts what started moving, in the same task (no waiting in between). */
const clickAndCount = (page: Page, click: string, under?: string) =>
  page.evaluate(
    ([click, under, src]) => {
      const count = new Function(`return ${src}`)() as (l: Animation[]) => number;
      document.querySelector<HTMLElement>(click!)!.click();
      return count(under ? document.querySelector(under)!.getAnimations({ subtree: true }) : document.getAnimations());
    },
    [click, under, moving.toString()] as const,
  );

test('Calm: nothing animates, and dialogs close at once', async ({ page }) => {
  await openWith(page, { motion: 'calm' });
  await expect(page.locator('html')).toHaveAttribute('data-anim', '');
  await page.locator('#input').fill('12 * 7');
  await page.locator('#input').press('Enter');
  await expect(page.locator('#history li').first()).toContainText('12 * 7');
  expect(await running(page)).toBe(0);
  // Not even the loading shimmers loop under Calm.
  expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().endTime === Infinity).length)).toBe(0);

  expect(await clickAndCount(page, '#open-settings')).toBe(0);
  await expect(page.locator('#settings')).toBeVisible();
  // Closing is instant: the dialog is closed in the same task as the click.
  const closed = await page.evaluate(() => {
    document.querySelector<HTMLElement>('#settings .sheet-head button')!.click();
    return !document.querySelector<HTMLDialogElement>('#settings')!.open;
  });
  expect(closed).toBe(true);

  expect(await clickAndCount(page, '#recent-toggle')).toBe(0);
  await expect(page.locator('#history')).toBeHidden();
  expect(await clickAndCount(page, '.chip-toggle')).toBe(0);
  expect(await clickAndCount(page, '#open-study')).toBe(0);
  // Durations are ~0 for anything left over from older rules.
  const longest = await page.evaluate(() => Math.max(0, ...document.getAnimations().map((a) => Number(a.effect?.getComputedTiming().endTime ?? 0))));
  expect(longest).toBeLessThan(1);
});

test('Normal: the answer rises in, Recent glides, and every animation is over within 300 ms', async ({ app }) => {
  await expect(app.locator('html')).toHaveAttribute('data-anim', 'answers panels content feedback press mic');
  await ask(app, '12 * 7');
  const ends = await app.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('#input')!;
    input.value = '5 + 5';
    document.querySelector<HTMLFormElement>('#ask')!.requestSubmit();
    document.querySelector<HTMLElement>('#open-settings')!.click();
    return document.getAnimations().map((a) => ({ end: Number(a.effect?.getComputedTiming().endTime ?? 0), what: (a as CSSAnimation).animationName ?? 'script' }));
  });
  expect(ends.length).toBeGreaterThan(2); // the value, the new Recent entry, the chips, the sheet…
  for (const a of ends) expect(a.end, a.what).toBeLessThanOrEqual(300);
  await app.waitForTimeout(350);
  expect(await running(app)).toBe(0);
});

test('dialogs animate out, then are fully closed (button, Escape, backdrop, two at once)', async ({ app }) => {
  // Close button: still open (animating) right after the click, closed after.
  await app.locator('#open-settings').click();
  await expect(app.locator('#settings')).toBeVisible();
  await app.waitForTimeout(300);
  const during = await app.evaluate(() => {
    const d = document.querySelector<HTMLDialogElement>('#settings')!;
    d.querySelector<HTMLElement>('.sheet-head button')!.click();
    return { open: d.open, moving: d.getAnimations().length > 0 };
  });
  expect(during).toEqual({ open: true, moving: true });
  await app.waitForTimeout(300);
  const after = await app.evaluate(() => {
    const d = document.querySelector<HTMLDialogElement>('#settings')!;
    return { open: d.open, moving: d.getAnimations().length, opacity: getComputedStyle(d).opacity };
  });
  expect(after).toEqual({ open: false, moving: 0, opacity: '1' });
  await app.locator('#input').fill('1 + 1'); // the page behind takes input again

  // Escape on the Study drawer.
  await app.locator('#open-study').click();
  await expect(app.locator('#study')).toBeVisible();
  await app.keyboard.press('Escape');
  await expect(app.locator('#study')).toBeHidden();
  expect(await app.evaluate(() => document.querySelector<HTMLDialogElement>('#study')!.open)).toBe(false);

  // Reopening during the exit keeps it open.
  await app.locator('#open-settings').click();
  await app.waitForTimeout(300);
  const kept = await app.evaluate(async () => {
    const d = document.querySelector<HTMLDialogElement>('#settings')!;
    d.close();
    d.showModal();
    await new Promise((r) => setTimeout(r, 300));
    return { open: d.open, opacity: getComputedStyle(d).opacity };
  });
  expect(kept).toEqual({ open: true, opacity: '1' });

  // Extensions over Settings: Escape twice closes both.
  await app.locator('#open-extensions').click();
  await expect(app.locator('#extensions')).toBeVisible();
  await app.keyboard.press('Escape');
  await app.keyboard.press('Escape');
  await expect(app.locator('#extensions')).toBeHidden();
  await expect(app.locator('#settings')).toBeHidden();
});

const groups: { group: Group; trigger: (page: Page) => Promise<number> }[] = [
  {
    group: 'Answers',
    trigger: async (page) => {
      await ask(page, '6 * 7');
      return page.evaluate(() => {
        const input = document.querySelector<HTMLInputElement>('#input')!;
        input.value = '6 * 8';
        document.querySelector<HTMLFormElement>('#ask')!.requestSubmit();
        return [...document.querySelector('#value')!.getAnimations(), ...document.querySelector('#history')!.getAnimations({ subtree: true })].filter((a) => !('transitionProperty' in a)).length;
      });
    },
  },
  { group: 'Panels', trigger: (page) => clickAndCount(page, '#open-settings', '#settings') },
  {
    group: 'Content',
    trigger: async (page) => {
      await page.locator('#open-study').click();
      await page.locator('.tool-row[data-tool="practice"]').click();
      await expect(page.getByRole('button', { name: 'Show steps' })).toBeVisible();
      return page.evaluate(async () => {
        [...document.querySelectorAll<HTMLElement>('#tool-body button')].find((b) => b.textContent === 'Show steps')!.click();
        // WebKit lists a new element's CSS animations only from the next frame.
        await new Promise(requestAnimationFrame);
        return document.querySelector('#tool-body')!.getAnimations({ subtree: true }).filter((a) => a.playState === 'running' && !('transitionProperty' in a)).length;
      });
    },
  },
  {
    group: 'Feedback',
    trigger: (page) =>
      page.evaluate(() => {
        const input = document.querySelector<HTMLInputElement>('#input')!;
        input.value = '2 * * 3';
        document.querySelector<HTMLFormElement>('#ask')!.requestSubmit();
        return document.querySelector('#ask')!.getAnimations().filter((a) => !('transitionProperty' in a)).length;
      }),
  },
  {
    group: 'Press',
    trigger: (page) => page.evaluate(() => (getComputedStyle(document.querySelector('#open-study')!).transitionProperty.includes('scale') ? 1 : 0)),
  },
  {
    group: 'Mic',
    trigger: (page) =>
      page.evaluate(() => {
        const mic = document.querySelector<HTMLElement>('#mic')!;
        mic.setAttribute('aria-pressed', 'true');
        const n = mic.querySelector('.ring')!.getAnimations().length;
        mic.setAttribute('aria-pressed', 'false');
        return n;
      }),
  },
];

for (const { group, trigger } of groups)
  test(`the ${group} switch turns off just that kind of motion`, async ({ page }) => {
    await openWith(page, {});
    expect(await trigger(page), `${group} moves when on`).toBeGreaterThan(0);
    await openWith(page, { [`motion${group}`]: false });
    await expect(page.locator('html')).not.toHaveAttribute('data-anim', new RegExp(group.toLowerCase()));
    expect(await trigger(page), `${group} is still when off`).toBe(0);
  });

test('the motion switches live under Motion → Customize, and only while Motion is Normal', async ({ app }) => {
  await app.locator('#open-settings').click();
  const custom = app.locator('#motion-more');
  await custom.locator('summary').click();
  await app.getByLabel('Mic pulse').uncheck();
  await expect(app.locator('html')).not.toHaveAttribute('data-anim', /mic/);
  await expect(app.locator('html')).toHaveAttribute('data-anim', /answers/);
  await app.locator('select[name="motion"]').selectOption('calm');
  await expect(custom).toBeHidden();
  await expect(app.locator('html')).toHaveAttribute('data-anim', '');
  await app.locator('select[name="motion"]').selectOption('full');
  await expect(custom).toBeVisible();
  await expect(app.locator('html')).not.toHaveAttribute('data-anim', /mic/);
});

test('Recent and answer-action folds animate and still end in the right state', async ({ app }) => {
  await ask(app, '15% tip on 84.50');
  const recent = app.getByRole('button', { name: 'Recent' });
  const mid = await app.evaluate(() => {
    document.querySelector<HTMLElement>('#recent-toggle')!.click();
    const body = document.querySelector<HTMLElement>('#recent-body')!;
    return { hidden: body.hidden, moving: body.getAnimations().length };
  });
  expect(mid).toEqual({ hidden: false, moving: 1 }); // folding, not yet hidden
  await expect(recent).toHaveAttribute('aria-expanded', 'false');
  await expect(app.locator('#history')).toBeHidden();
  // Two quick clicks: the second wins.
  await app.evaluate(() => {
    const t = document.querySelector<HTMLElement>('#recent-toggle')!;
    t.click();
    t.click();
    t.click();
  });
  await expect(recent).toHaveAttribute('aria-expanded', 'true');
  await expect(app.locator('#history li').first()).toBeVisible();
  await app.waitForTimeout(300);
  await expect(app.locator('#history li').first()).toBeVisible();

  await app.getByRole('button', { name: 'Hide actions' }).click();
  await expect(app.locator('.chip', { hasText: 'Save note' })).toBeHidden();
  await expect(app.getByRole('button', { name: 'Show actions' })).toHaveAttribute('aria-expanded', 'false');
  await app.getByRole('button', { name: 'Show actions' }).click();
  await expect(app.locator('.chip', { hasText: 'Save note' })).toBeVisible();
  // Nothing is left half-folded.
  await app.waitForTimeout(300);
  expect(await running(app)).toBe(0);
  expect(await app.evaluate(() => getComputedStyle(document.querySelector('#chip-items')!).opacity)).toBe('1');
});

test('Clear fades the list out, then empties it', async ({ app }) => {
  await ask(app, '2 + 3');
  await ask(app, '4 + 5');
  const mid = await app.evaluate(() => {
    document.querySelector<HTMLElement>('#clear-history')!.click();
    return document.querySelectorAll('#history li').length;
  });
  expect(mid).toBe(2); // still there, fading
  await expect(app.locator('#history li')).toHaveCount(0);
  await expect(app.locator('#examples')).toBeVisible();
});
