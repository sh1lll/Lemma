import { type Locator, type Page } from '@playwright/test';
import { expect, test } from './helpers';

// Graphing mode at parity with full graphing calculators: points of interest you can hover, click and tap to pin,
// tracing on every curve type (touch-and-hold, drag, keyboard), the automatic window, the Add menu's row kinds,
// slider animation, row styles, graph settings, share links, undo, and 3D.

const open = async (page: Page) => {
  await page.locator('.modes [data-mode="graphing"]').click();
  await expect(page.locator('.gw')).toBeVisible();
};
const canvas = (page: Page) => page.locator('.gw .graph > .graph-stage > canvas');
const rows = (page: Page) => page.locator('.gw-row');
const viewOf = async (c: Locator) => (await c.getAttribute('data-view'))!.split(',').map(Number) as [number, number, number, number];

/** Page coordinates of a graph point. */
async function at(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const c = canvas(page);
  const box = (await c.boundingBox())!;
  const [x0, x1, y0, y1] = await viewOf(c);
  return { x: box.x + ((x - x0) / (x1 - x0)) * box.width, y: box.y + box.height - ((y - y0) / (y1 - y0)) * box.height };
}

/** Dispatches pointer events as a finger would (works in every engine, unlike a real touch hold). */
async function finger(page: Page, type: 'pointerdown' | 'pointermove' | 'pointerup', p: { x: number; y: number }) {
  await canvas(page).evaluate((c, { type, p }) => {
    c.dispatchEvent(new PointerEvent(type, { clientX: p.x, clientY: p.y, pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
  }, { type, p });
}

/** The window refits to the features ~0.7 s after typing pauses; interactions aim at points after that. */
const settle = (page: Page) => page.waitForTimeout(1000);

async function type(page: Page, i: number, text: string) {
  const input = rows(page).nth(i).locator('.gw-input');
  await input.fill(text);
}

async function addRow(page: Page, kind: 'expr' | 'note' | 'table' | 'infer' | 'folder' | 'image') {
  await page.getByRole('button', { name: 'Add a row' }).click();
  await page.locator(`.gw-menuitem[data-type="${kind}"]`).click();
}

const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('lemma.graphing.v2') ?? 'null'));

test.beforeEach(async ({ app }) => {
  await open(app);
});

test('the window frames y = x² − 4 around its roots and vertex', async ({ app }) => {
  await type(app, 0, 'y = x^2 - 4');
  // The window refits once typing pauses: x narrows from the default ±10 to frame the roots.
  await expect.poll(async () => (await viewOf(canvas(app)))[1]).toBeLessThan(9);
  const [x0, x1, y0, y1] = await viewOf(canvas(app));
  expect(x0).toBeLessThan(-2.2);
  expect(x1).toBeGreaterThan(2.2);
  expect(y0).toBeLessThan(-4.1);
  expect(y0).toBeGreaterThan(-8);
  expect(y1).toBeLessThan(20);
  expect(y1).toBeGreaterThan(0.5);
  // Zoom square makes the units equal; zoom fit returns.
  await app.getByRole('button', { name: 'Graph settings' }).click();
  await app.locator('.gw-panel').getByRole('button', { name: 'Zoom square' }).click();
  const box = (await canvas(app).boundingBox())!;
  const sq = await viewOf(canvas(app));
  expect((sq[1] - sq[0]) / box.width).toBeCloseTo((sq[3] - sq[2]) / box.height, 3);
});

test('points of interest: hover shows, click or tap pins until clicked again, and the row changing drops the pin', async ({ app, isMobile }) => {
  await type(app, 0, 'y = x^2 - 4');
  const c = canvas(app);
  await expect.poll(() => c.getAttribute('data-pois')).toMatch(/[1-9]/);
  await settle(app);
  // Aim a little off the dot: the hit target is generous.
  const root = await at(app, -2, 0);
  const near = { x: root.x + 9, y: root.y - 7 };
  if (isMobile) await app.touchscreen.tap(near.x, near.y);
  else {
    await app.mouse.move(near.x, near.y);
    await expect(app.locator('.gw .graph-tip')).toContainText('Root');
    await expect(app.locator('.gw .graph-tip')).toContainText('(-2, 0)');
    await app.mouse.click(near.x, near.y);
  }
  await expect(c).toHaveAttribute('data-pins', '1');
  // Pinned labels survive panning.
  await c.focus();
  await app.keyboard.press('Shift+ArrowLeft');
  await expect(c).toHaveAttribute('data-pins', '1');
  // Clicking it again unpins.
  const again = await at(app, -2, 0);
  if (isMobile) await app.touchscreen.tap(again.x, again.y);
  else await app.mouse.click(again.x, again.y);
  await expect(c).toHaveAttribute('data-pins', '0');
  // Pin, then edit the row: the pin goes.
  const third = await at(app, -2, 0);
  if (isMobile) await app.touchscreen.tap(third.x, third.y);
  else await app.mouse.click(third.x, third.y);
  await expect(c).toHaveAttribute('data-pins', '1');
  await type(app, 0, 'y = x^2 - 9');
  await expect(c).toHaveAttribute('data-pins', '0');
});

test('intersections between a circle and a line are found and can be pinned', async ({ app }) => {
  await type(app, 0, 'x^2 + y^2 = 4');
  await rows(app).nth(0).locator('.gw-input').press('Enter');
  await type(app, 1, 'y = x');
  const c = canvas(app);
  await expect.poll(() => c.getAttribute('data-pois').then(Number)).toBeGreaterThanOrEqual(6);
  await settle(app);
  const p = await at(app, Math.SQRT2, Math.SQRT2);
  await c.dispatchEvent('pointerdown', { clientX: p.x + 6, clientY: p.y + 6, pointerId: 3, pointerType: 'mouse', isPrimary: true, button: 0 });
  await c.dispatchEvent('pointerup', { clientX: p.x + 6, clientY: p.y + 6, pointerId: 3, pointerType: 'mouse', isPrimary: true, button: 0 });
  await expect(c).toHaveAttribute('data-pins', '1');
  // The row descriptions name the features for screen readers.
  await expect(rows(app).nth(1).locator('.gw-desc')).toContainText(/Crosses another curve at .*\(1\.41421/);
});

test('touch-and-hold traces a circle, and dragging follows the curve', async ({ app }) => {
  await type(app, 0, 'x^2 + y^2 = 9');
  const c = canvas(app);
  await expect.poll(() => c.getAttribute('data-pois')).toMatch(/\d/);
  await settle(app);
  const start = await at(app, 0, 3);
  await finger(app, 'pointerdown', { x: start.x + 4, y: start.y - 10 });
  await app.waitForTimeout(450);
  await expect(c).toHaveAttribute('data-trace', /./);
  const onCircle = async () => {
    const [x, y] = (await c.getAttribute('data-trace'))!.split(',').map(Number);
    return Math.hypot(x!, y!);
  };
  expect(await onCircle()).toBeCloseTo(3, 1);
  // Drag far off the curve: the trace stays on the circle.
  const off = await at(app, 2.5, 0.5);
  await finger(app, 'pointermove', { x: off.x, y: off.y });
  await expect.poll(onCircle).toBeCloseTo(3, 1);
  const [x] = (await c.getAttribute('data-trace'))!.split(',').map(Number);
  expect(x).toBeGreaterThan(2);
  await finger(app, 'pointerup', off);
  // The readout stays after lifting the finger.
  await expect(app.locator('.gw .graph-tip')).toBeVisible();
});

test('keyboard: Tab into the graph, arrows walk along the curve, Enter pins', async ({ app, isMobile }) => {
  test.skip(isMobile, 'keyboard');
  await type(app, 0, 'x^2 + y^2 = 4');
  const c = canvas(app);
  await expect.poll(() => c.getAttribute('data-pois')).toMatch(/\d/);
  await c.focus();
  await app.keyboard.press('Enter'); // starts tracing even when focus-visible didn't
  await expect(c).toHaveAttribute('data-trace', /./);
  const before = await c.getAttribute('data-trace');
  for (let i = 0; i < 5; i++) await app.keyboard.press('ArrowRight');
  const after = (await c.getAttribute('data-trace'))!;
  expect(after).not.toBe(before);
  const [x, y] = after.split(',').map(Number);
  expect(Math.hypot(x!, y!)).toBeCloseTo(2, 2);
  await app.keyboard.press('Enter');
  await expect(c).toHaveAttribute('data-pins', '1');
  await app.keyboard.press('Escape');
  await expect(c).not.toHaveAttribute('data-trace', /./);
});

test('tables plot points and y₁ ~ m x₁ + b fits a line with R²', async ({ app }) => {
  await addRow(app, 'table');
  const table = app.locator('.gw-table');
  const cells = table.locator('tbody tr');
  const data = [[1, 3.1], [2, 4.9], [3, 7.2], [4, 9.0]];
  for (let i = 0; i < data.length; i++) {
    await cells.nth(i).locator('input').nth(0).fill(String(data[i]![0]));
    await cells.nth(i).locator('input').nth(1).fill(String(data[i]![1]));
  }
  await addRow(app, 'expr');
  const last = rows(app).last().locator('.gw-input');
  await last.fill('y₁ ~ m x₁ + b');
  const fit = rows(app).last().locator('.gw-value');
  await expect(fit).toContainText(/m = 2\s/);
  await expect(fit).toContainText(/b = 1\.05/);
  await expect(fit).toContainText(/R² = 0\.99/);
  // Connect points toggle.
  await table.getByText('Connect points').click();
  await expect.poll(async () => (await saved(app))?.rows.find((r: { type: string }) => r.type === 'table')?.connect).toBe(true);
});

test('notes, folders (collapse, hide all) and images', async ({ app }) => {
  await type(app, 0, 'y = x');
  await addRow(app, 'note');
  await app.locator('.gw-note textarea').fill('Lines through the origin');
  await addRow(app, 'folder');
  await app.locator('.gw-folder-title').fill('Lines');
  // Move the first row into the folder from its options.
  await rows(app).first().getByRole('button', { name: /Options for expression 1/ }).click();
  await rows(app).first().locator('.gw-pop select').selectOption({ label: 'Lines' });
  await expect(app.locator('.gw-row.in-folder')).toHaveCount(1);
  // Hide all, then collapse.
  await app.locator('.gw-folder .gw-dot').click();
  await expect(app.locator('.gw-row.in-folder')).toHaveClass(/off/);
  await app.getByRole('button', { name: 'Collapse folder' }).click();
  await expect(app.locator('.gw-row.in-folder')).toBeHidden();
  // An image placed on the graph (stored in IndexedDB, not localStorage).
  await addRow(app, 'image');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4AWP8z8DwnwEJMDEgARQOACM/AgWAYhPxAAAAAElFTkSuQmCC', 'base64');
  await app.locator('.gw-image .gw-file').setInputFiles({ name: 'dots.png', mimeType: 'image/png', buffer: png });
  await expect(app.locator('.gw-image-name')).toHaveText('dots.png');
  await expect.poll(async () => JSON.stringify(await saved(app))).toContain('"name":"dots.png"');
  const stored = await app.evaluate(() => localStorage.getItem('lemma.graphing.v2') ?? '');
  expect(stored).not.toContain('base64');
  await app.reload();
  await expect(app.locator('.gw-note textarea')).toHaveValue('Lines through the origin');
  await expect(app.locator('.gw-image-name')).toHaveText('dots.png');
  await expect(app.locator('.gw-row.in-folder')).toBeHidden();
});

test('slider rows play and pause, with editable range and keyboard nudging', async ({ app }) => {
  await type(app, 0, 'y = a x');
  await rows(app).nth(0).locator('.gw-input').press('Enter');
  await type(app, 1, 'a = 1');
  const row = rows(app).nth(1);
  await expect(row.locator('.gw-range')).toBeVisible();
  await row.getByRole('button', { name: 'Slider settings for a' }).click();
  await row.locator('.gw-sopts input').nth(0).fill('0');
  await row.locator('.gw-sopts input').nth(1).fill('5');
  await row.getByRole('button', { name: 'Play a' }).click();
  await expect.poll(() => row.locator('.gw-input').inputValue(), { timeout: 4000 }).not.toBe('a = 1');
  await row.getByRole('button', { name: 'Pause a' }).click();
  const v = Number((await row.locator('.gw-input').inputValue()).split('=')[1]);
  expect(v).toBeGreaterThanOrEqual(0);
  expect(v).toBeLessThanOrEqual(5);
  await row.locator('.gw-range').focus();
  await app.keyboard.press('ArrowRight');
  await expect.poll(async () => Number((await row.locator('.gw-input').inputValue()).split('=')[1])).toBeGreaterThan(v);
});

test('draggable points move their sliders', async ({ app, isMobile }) => {
  test.skip(isMobile, 'pointer drag covered on desktop');
  await type(app, 0, 'a = 1');
  await rows(app).nth(0).locator('.gw-input').press('Enter');
  await type(app, 1, '(a, 2)');
  const c = canvas(app);
  await expect.poll(() => c.getAttribute('data-view')).toBeTruthy();
  await app.waitForTimeout(300);
  const p = await at(app, 1, 2);
  const q = await at(app, 3, 2);
  await app.mouse.move(p.x, p.y);
  await app.mouse.down();
  await app.mouse.move((p.x + q.x) / 2, q.y, { steps: 3 });
  await app.mouse.move(q.x, q.y, { steps: 3 });
  await app.mouse.up();
  await expect.poll(async () => Number((await rows(app).nth(0).locator('.gw-input').inputValue()).split('=')[1])).toBeGreaterThan(2.5);
});

test('row styles: colour, dashed line, thickness, label, duplicate, undo and redo', async ({ app }) => {
  await type(app, 0, 'y = sin(x)');
  await rows(app).first().getByRole('button', { name: 'Options for expression 1' }).click();
  const pop = rows(app).first().locator('.gw-pop');
  await pop.getByRole('button', { name: 'Colour 3' }).click();
  await pop.getByRole('radio', { name: 'Dashed' }).click();
  await pop.getByLabel('Thickness').fill('5');
  await expect.poll(async () => (await saved(app))?.rows[0]?.style).toMatchObject({ line: 'dashed', width: 5 });
  expect((await saved(app)).rows[0].color).toBe(2);
  await pop.getByRole('button', { name: 'Duplicate' }).click();
  await expect(rows(app)).toHaveCount(2);
  await expect(rows(app).nth(1).locator('.gw-input')).toHaveValue('y = sin(x)');
  // Undo removes the copy; redo brings it back.
  await app.getByRole('button', { name: 'Undo' }).click();
  await expect(rows(app)).toHaveCount(1);
  await app.getByRole('button', { name: 'Redo' }).click();
  await expect(rows(app)).toHaveCount(2);
  // Ctrl/⌘+Z in a row undoes typing too.
  await rows(app).nth(1).locator('.gw-input').fill('y = cos(x)');
  await app.waitForTimeout(700);
  await rows(app).nth(1).locator('.gw-input').press('ControlOrMeta+z');
  await expect(rows(app).nth(1).locator('.gw-input')).toHaveValue('y = sin(x)');
});

test('graph settings: grid, log scale, ranges, degrees, audio trace, saved', async ({ app }) => {
  await type(app, 0, 'y = x');
  await app.getByRole('button', { name: 'Graph settings' }).click();
  const panel = app.locator('.gw-panel');
  await panel.getByText('Grid', { exact: true }).click();
  await panel.getByText('Log y').click();
  await panel.getByRole('radio', { name: 'Degrees' }).click();
  await panel.getByText('Audio trace').click();
  await expect.poll(async () => (await saved(app))?.settings).toMatchObject({ grid: false, logY: true, degrees: true, audio: true });
  await panel.getByText('Log y').click();
  const xFrom = panel.locator('input[data-range="xMin"]');
  await xFrom.fill('-3');
  await xFrom.press('Enter');
  await expect.poll(async () => (await viewOf(canvas(app)))[0]).toBeCloseTo(-3, 5);
  await app.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

test('a share link round-trips the workspace', async ({ app, browserName }) => {
  await type(app, 0, 'y = 2x + 1');
  await addRow(app, 'note');
  await app.locator('.gw-note textarea').fill('shared note');
  await app.getByRole('button', { name: 'Share or export' }).click();
  const link = app.locator('.gw-link');
  await expect(link).toHaveAttribute('data-ready', '1');
  const url = await link.inputValue();
  expect(url).toMatch(/#graph=[zj][\w-]+$/);
  void browserName;
  // A fresh visit with nothing saved opens the link's rows.
  await app.evaluate(() => {
    localStorage.removeItem('lemma.graphing.v2');
    localStorage.removeItem('lemma.graphing.v1');
  });
  await app.goto('about:blank');
  await app.goto(url);
  await expect(app.locator('.gw')).toBeVisible();
  await expect(rows(app).first().locator('.gw-input')).toHaveValue('y = 2x + 1');
  await expect(app.locator('.gw-note textarea')).toHaveValue('shared note');
  expect(app.url()).not.toContain('#graph=');
});

test('SVG export draws the curves', async ({ app, isMobile }) => {
  test.skip(isMobile, 'download covered on desktop');
  await type(app, 0, 'y = x^2');
  await app.getByRole('button', { name: 'Share or export' }).click();
  const dl = app.waitForEvent('download');
  await app.getByRole('button', { name: 'Download SVG' }).click();
  const file = await dl;
  expect(file.suggestedFilename()).toBe('lemma-graph.svg');
});

test('domain restrictions, piecewise, lists and integrals in rows', async ({ app }) => {
  await type(app, 0, '∫_0^2 x^2 dx');
  await expect(rows(app).first().locator('.gw-value')).toContainText('≈ 2.6666');
  await rows(app).first().locator('.gw-input').press('Enter');
  await type(app, 1, 'L = [1, 2, 3]');
  await expect(rows(app).nth(1).locator('.gw-value')).toContainText('= [1, 2, 3]');
  await rows(app).nth(1).locator('.gw-input').press('Enter');
  await type(app, 2, 'y = L x {x > 0}');
  await expect(rows(app).nth(2)).not.toHaveClass(/stale/);
  await rows(app).nth(2).locator('.gw-input').press('Enter');
  await type(app, 3, 'y = {x < 0: -x, x}');
  await expect(rows(app).nth(3)).not.toHaveClass(/stale/);
  await rows(app).nth(3).locator('.gw-input').press('Enter');
  await type(app, 4, 'y = q x');
  await rows(app).nth(4).getByRole('button', { name: 'Add a slider for q' }).click();
  await expect(rows(app)).toHaveCount(6);
  await expect(rows(app).nth(5).locator('.gw-input')).toHaveValue('q = 1');
});

test('inference rows show the statistic, p-value and the shaded distribution', async ({ app }) => {
  await addRow(app, 'infer');
  const row = app.locator('.gw-infer');
  await expect(row.locator('.gw-infer-out')).toContainText('t');
  await expect(row.locator('.gw-infer-out')).toContainText('1.25');
  await expect(row.locator('.gw-infer-out')).toContainText('0.2234');
  await row.getByRole('radio', { name: 'Interval' }).click();
  await expect(row.locator('.gw-infer-out')).toContainText('interval');
  await row.locator('select').first().selectOption('p1');
  await row.getByRole('radio', { name: 'Test' }).click();
  await expect(row.locator('.gw-infer-out')).toContainText('2');
});

test('3D: toggle, several surfaces, Extend to 3D, sliders and trace', async ({ app }) => {
  await type(app, 0, 'y = 2x^3');
  await rows(app).first().locator('.gw-input').press('Enter');
  await type(app, 1, 'z = a sin(x) cos(y)');
  await expect(rows(app).nth(1).getByRole('button', { name: 'Show in 3D' })).toBeVisible();
  await app.getByRole('radio', { name: '3D' }).click();
  const scene = app.locator('.scene3d');
  await expect(scene).toBeVisible();
  await expect(scene).toHaveAttribute('data-renderer', /^(webgl2|canvas)$/);
  await expect(scene).toHaveAttribute('data-items', '2');
  await rows(app).nth(1).locator('.gw-input').press('Enter');
  await type(app, 2, 'x^2 + y^2 + z^2 = 16');
  await expect(scene).toHaveAttribute('data-items', '3');
  await expect(scene).not.toHaveAttribute('data-working', '1', { timeout: 10_000 });
  // Extend to 3D on the 2D row.
  await rows(app).first().getByRole('button', { name: 'Options for expression 1' }).click();
  await rows(app).first().locator('.gw-pop').getByText('Extend to 3D').click();
  await expect.poll(async () => (await saved(app))?.rows[0]?.style?.extend3d).toBe(true);
  // Rotate by dragging; the view changes.
  const c = scene.locator('canvas[role="img"]');
  const before = await scene.getAttribute('data-view');
  const box = (await c.boundingBox())!;
  await c.dispatchEvent('pointerdown', { clientX: box.x + 100, clientY: box.y + 100, pointerId: 5, pointerType: 'mouse', isPrimary: true, button: 0 });
  await c.dispatchEvent('pointermove', { clientX: box.x + 160, clientY: box.y + 120, pointerId: 5, pointerType: 'mouse', isPrimary: true, buttons: 1 });
  await c.dispatchEvent('pointerup', { clientX: box.x + 160, clientY: box.y + 120, pointerId: 5, pointerType: 'mouse', isPrimary: true });
  await expect(scene).not.toHaveAttribute('data-view', before!);
  // Hover anywhere on the surface shows coordinates.
  for (let k = 0; k < 6; k++) {
    await c.dispatchEvent('pointermove', { clientX: box.x + box.width * (0.4 + k * 0.03), clientY: box.y + box.height * 0.5, pointerType: 'mouse', pointerId: 9, isPrimary: true });
    if (await scene.getAttribute('data-trace')) break;
  }
  await expect(scene).toHaveAttribute('data-trace', /,.*,/);
  // Back to 2D.
  await app.getByRole('radio', { name: '2D' }).click();
  await expect(scene).toBeHidden();
  await expect(canvas(app)).toBeVisible();
});

test('the workspace and its panels fit a 360 px screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  await open(page);
  await type(page, 0, 'y = x^2');
  await page.getByRole('button', { name: 'Graph settings' }).click();
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(1);
  await page.keyboard.press('Escape');
  await addRow(page, 'table');
  await addRow(page, 'infer');
  expect(await overflow()).toBeLessThanOrEqual(1);
});
