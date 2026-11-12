import type { Locator, Page } from '@playwright/test';
import { ask, expect, test, value } from './helpers';

// Phase 3 graphs: regression curves, statistical plots and 3D surfaces, in every engine and on phones.

/** Distinct colours on a 2D canvas: more than a handful means something was drawn over the background. */
async function colours(canvas: Locator): Promise<number> {
  return canvas.evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set<number>();
    for (let i = 0; i < d.length; i += 4 * 53) seen.add((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
    return seen.size;
  });
}

/** Relative luminance (0–1) of the pixel near a canvas's top-left corner: the plot background. */
async function corner(canvas: Locator): Promise<number> {
  return canvas.evaluate((c: HTMLCanvasElement) => {
    const [r, g, b] = c.getContext('2d')!.getImageData(6, Math.round(c.height / 2), 1, 1).data;
    return (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255;
  });
}

const plot = (app: Page) => app.locator('.stat-plot');
const plotCanvas = (app: Page) => plot(app).locator('canvas');

test('fit a line: equation, R², residual note and the points with the line', async ({ app }) => {
  await ask(app, 'fit a line to (1,2) (2,4.1) (3,5.9)');
  await expect(value(app)).toHaveText('y = 1.95x + 0.1');
  await expect(app.locator('#lines')).toContainText('r²');
  await expect(app.locator('#lines')).toContainText('Largest residual');
  await expect(app.locator('#meta')).toContainText('Residuals');
  await expect(plotCanvas(app)).toBeVisible();
  await expect.poll(() => colours(plotCanvas(app))).toBeGreaterThan(5);
  await expect(plot(app).locator('.graph-legend')).toContainText('Data (3 points)');
  await expect(plot(app).locator('.graph-legend')).toContainText('y = 1.95x + 0.1');
  // The screen-reader summary is linked to the canvas.
  const id = await plotCanvas(app).getAttribute('aria-describedby');
  await expect(app.locator(`#${id}`)).toHaveText(/3 points.*R² = 0\.998/);
});

test('other models, and refusals with a reason', async ({ app }) => {
  await ask(app, 'quadratic regression of (-2,4.01) (-1,0.96) (0,0.06) (1,0.96) (2,4.01)');
  await expect(value(app)).toHaveText(/^y = x²/);
  await expect(app.locator('#lines')).toContainText('R²');
  await expect.poll(() => colours(plotCanvas(app))).toBeGreaterThan(5);
  // Errors aren't added to history: submit directly.
  await app.locator('#input').fill('exponential regression of (1,2) (2,-1) (3,5)');
  await app.locator('#input').press('Enter');
  await expect(value(app)).toContainText('every y above 0');
  await expect(plot(app)).toHaveCount(0);
  await ask(app, 'best fit for x=1,2,3,4 y=3,5,7,9');
  await expect(value(app)).toHaveText('y = 2x + 1');
});

test('histogram, box plot and dot plot', async ({ app }) => {
  await ask(app, 'histogram of 1 2 2 3 3 3 4');
  await expect(value(app)).toHaveText('4 bars');
  await expect(app.locator('#detail table')).toContainText('42.9%');
  await expect.poll(() => colours(plotCanvas(app))).toBeGreaterThan(5);
  await expect(plot(app).locator('.graph-summary')).toHaveText(/tallest bar is 3 with 3 values/);

  await ask(app, 'box plot of 1 2 3 4 5 6 7 8 9 100');
  await expect(value(app)).toHaveText('5.5');
  await expect(app.locator('#lines')).toContainText('Outliers');
  await expect(plot(app).locator('.graph-summary')).toHaveText(/1 outlier: 100/);
  await expect.poll(() => colours(plotCanvas(app))).toBeGreaterThan(5);

  await ask(app, 'dot plot of 3 1 2 2 3 3 5');
  await expect(value(app)).toHaveText('7 dots');
  await expect(plot(app).locator('.graph-summary')).toHaveText(/tallest stack is 3/);
});

test('normal curve with a shaded area, and the standard normal', async ({ app }) => {
  await ask(app, 'normal curve mean 100 sd 15 shade above 130');
  await expect(value(app)).toHaveText('0.022750132');
  await expect(plot(app).locator('.graph-legend')).toContainText('P(X > 130)');
  await expect(plot(app).locator('.graph-summary')).toHaveText(/area above 130 shaded/);
  await expect.poll(() => colours(plotCanvas(app))).toBeGreaterThan(5);
  await ask(app, 'shade P(-1<z<1)');
  await expect(value(app)).toHaveText('0.68268949');
  await expect(plot(app).locator('.graph-legend')).toContainText('P(−1 < Z < 1)');
});

test('plots follow the theme (light and dark)', async ({ app }) => {
  await app.locator('#open-settings').click();
  await app.locator('select[name="theme"]').selectOption('light');
  await app.keyboard.press('Escape');
  await ask(app, 'scatter plot (1,2) (2,4) (3,5)');
  await expect.poll(() => colours(plotCanvas(app))).toBeGreaterThan(5);
  await expect.poll(() => corner(plotCanvas(app))).toBeGreaterThan(0.8);
  await app.locator('#open-settings').click();
  await app.locator('select[name="theme"]').selectOption('dark');
  await app.keyboard.press('Escape');
  await ask(app, 'scatter plot (0,1) (1,3) (2,4)');
  await expect.poll(() => corner(plotCanvas(app))).toBeLessThan(0.25);
});

test('3D surface: draws, rotates by drag and keyboard, zooms', async ({ app }) => {
  await ask(app, 'graph z = sin(x)*cos(y)');
  const view = app.locator('.surface3d');
  await expect(view).toBeVisible();
  await expect(view).toHaveAttribute('data-renderer', /^(webgl2|canvas)$/);
  await expect(view).toHaveAttribute('data-view', /./);
  await expect(view.locator('.graph-summary')).toHaveText(/3D surface z = sin\(x\) × cos\(y\).*Height ranges from/);
  await expect(view.locator('.surface-key')).toContainText('z');
  const canvas = view.locator('canvas[role="img"]');
  await expect(canvas).toHaveAttribute('aria-label', /3D surface/);
  const stage = view.locator('.graph-stage');
  const before = await stage.screenshot();
  const start = await view.getAttribute('data-view');

  const box = (await canvas.boundingBox())!;
  await app.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await app.mouse.down();
  await app.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 30, { steps: 8 });
  await app.mouse.up();
  await expect(view).not.toHaveAttribute('data-view', start!);
  await expect.poll(async () => Buffer.compare(before, await stage.screenshot())).not.toBe(0);

  const afterDrag = await view.getAttribute('data-view');
  await canvas.focus();
  await app.keyboard.press('ArrowLeft');
  await expect(view).not.toHaveAttribute('data-view', afterDrag!);
  const zoom = () => view.getAttribute('data-view').then((v) => Number(v!.split(' ')[2]));
  const z0 = await zoom();
  await app.keyboard.press('+');
  await expect.poll(zoom).toBeGreaterThan(z0);
  await view.getByRole('button', { name: 'Reset view' }).click();
  await expect(view).toHaveAttribute('data-view', '-0.65 0.50 1.00');

  // Back to a 2D graph: the 3D view goes away.
  await ask(app, 'graph sin(x)');
  await expect(app.locator('.surface3d')).toHaveCount(0);
  await expect(app.locator('.graph-stage canvas').first()).toBeVisible();
});

test('3D surface without WebGL falls back to a 2D renderer and says so', async ({ app }) => {
  await app.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgl2' || type === 'webgl') return null;
      return (get as (...a: unknown[]) => RenderingContext | null).call(this, type, ...rest);
    } as typeof get;
  });
  await app.reload();
  await ask(app, '3d plot x^2 - y^2');
  const view = app.locator('.surface3d');
  await expect(view).toHaveAttribute('data-renderer', 'canvas');
  await expect(view.locator('.surface-note')).toContainText('WebGL isn’t available');
  await expect.poll(() => colours(view.locator('canvas[role="img"]'))).toBeGreaterThan(20);
});

test('3D surface: no gliding after a flick under reduced motion', async ({ app }) => {
  await app.emulateMedia({ reducedMotion: 'reduce' });
  await ask(app, 'graph z = x*y');
  const view = app.locator('.surface3d');
  const canvas = view.locator('canvas[role="img"]');
  await expect(view).toHaveAttribute('data-view', /./);
  const box = (await canvas.boundingBox())!;
  await app.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await app.mouse.down();
  await app.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2, { steps: 3 });
  await app.mouse.up();
  await app.waitForTimeout(100);
  const released = await view.getAttribute('data-view');
  await app.waitForTimeout(400);
  await expect(view).toHaveAttribute('data-view', released!);
});
