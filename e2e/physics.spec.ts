import type { Page } from '@playwright/test';
import { test, expect } from './helpers';

const read = (app: Page, key: string) => app.locator(`.phys-readout dd[data-key="${key}"]`);
const num = async (app: Page, key: string) => parseFloat((await read(app, key).textContent()) ?? 'NaN');

async function openLab(app: Page) {
  await app.locator('#open-study').click();
  await app.locator('.tool-row[data-tool="physics"]').click();
  await expect(app.locator('#tool-title')).toHaveText('Physics lab');
}

test.describe('with reduced motion', () => {
  test.beforeEach(async ({ app }) => {
    await app.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('starts paused; Step advances by fixed steps; Reset; slider changes the setup', async ({ app }) => {
    await openLab(app);
    await expect(app.locator('.phys-status')).toContainText('reduced motion');
    await expect(app.locator('.phys-play')).toHaveText('Play');
    await expect(read(app, 't')).toHaveText('0.00 s');
    // Nothing moves while paused.
    await app.waitForTimeout(300);
    await expect(read(app, 't')).toHaveText('0.00 s');
    await expect(read(app, 'range')).toHaveText('40.79 m'); // 20² sin 90° / 9.80665
    for (let i = 0; i < 6; i++) await app.getByRole('button', { name: 'Step' }).click();
    await expect(read(app, 't')).toHaveText('0.10 s');
    // y = v sinθ t − g t²/2 at t = 0.1 s.
    expect(await num(app, 'y')).toBeCloseTo(20 * Math.SQRT1_2 * 0.1 - 9.80665 * 0.005, 2);
    await app.getByRole('button', { name: 'Reset' }).click();
    await expect(read(app, 't')).toHaveText('0.00 s');
    await app.getByLabel('Launch angle').fill('30');
    await expect(read(app, 'range')).toHaveText('35.32 m');
    await expect(app.locator('.phys-energy')).toContainText('drift');
  });

  test('each simulation opens with its readout and plot', async ({ app }) => {
    await openLab(app);
    const tabs = app.locator('.phys-tabs');
    await tabs.getByRole('button', { name: 'Pendulum' }).click();
    await expect(read(app, 'period')).toHaveText(/2\.0\d s/);
    await app.getByRole('button', { name: 'Small angle (θ)' }).click();
    await expect(read(app, 'period')).toHaveText('2.01 s');
    await tabs.getByRole('button', { name: 'Spring' }).click();
    await expect(read(app, 'regime')).toHaveText('Underdamped');
    await tabs.getByRole('button', { name: 'Collision' }).click();
    await expect(read(app, 'p')).toHaveText('5.00 kg·m/s');
    await tabs.getByRole('button', { name: 'Incline' }).click();
    await expect(read(app, 'state')).toHaveText('Sliding');
    await expect(read(app, 'a')).toHaveText('3.20 m/s²');
    await app.getByLabel('Slope angle').fill('10');
    await expect(read(app, 'state')).toHaveText('Held by friction');
    await expect(app.locator('.phys-plot')).toBeVisible();
    await expect(app.locator('.phys-plot-cap')).toContainText('Speed');
  });

  test('a collision played to the end conserves momentum', async ({ app }) => {
    await openLab(app);
    await app.locator('.phys-tabs').getByRole('button', { name: 'Collision' }).click();
    await app.locator('.phys-play').click();
    await expect(app.locator('.phys-play')).toHaveText('Pause');
    // 1.35 s until contact (6 m apart less the blocks, closing at 4 m/s).
    await expect(read(app, 'v2')).toHaveText('4.33 m/s', { timeout: 10_000 });
    await expect(read(app, 'v1')).toHaveText('0.33 m/s');
    await expect(read(app, 'p')).toHaveText('5.00 kg·m/s');
    await expect(read(app, 'lost')).toHaveText('0.00 J');
  });
});

test('plays on its own without reduced motion, and pauses', async ({ app }) => {
  await app.emulateMedia({ reducedMotion: 'no-preference' });
  await openLab(app);
  await expect(app.locator('.phys-play')).toHaveText('Pause');
  await expect.poll(() => num(app, 't')).toBeGreaterThan(0.1);
  await app.locator('.phys-play').click();
  const t = await read(app, 't').textContent();
  await app.waitForTimeout(250);
  await expect(read(app, 't')).toHaveText(t!);
});

test('a typed question opens the lab on a preset', async ({ app }) => {
  await app.emulateMedia({ reducedMotion: 'reduce' });
  const input = app.locator('#input');
  await input.fill('simulate a projectile at 20 m/s 45 degrees');
  await input.press('Enter');
  await expect(app.locator('#tool-title')).toHaveText('Physics lab');
  await expect(app.getByLabel('Launch speed')).toHaveValue('20');
  await expect(app.getByLabel('Launch angle')).toHaveValue('45');
  await expect(read(app, 'range')).toHaveText('40.79 m');
  await app.locator('#tool-close').click();

  await input.fill('simulate a 2 m pendulum at 60 degrees');
  await input.press('Enter');
  await expect(app.locator('.phys-tabs button[aria-pressed="true"]')).toHaveText('Pendulum');
  await expect(app.getByLabel('Length')).toHaveValue('2');
  await expect(app.getByLabel('Release angle')).toHaveValue('60');
});
