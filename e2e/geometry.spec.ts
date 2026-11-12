import type { Page } from '@playwright/test';
import { test, expect } from './helpers';

async function openGeometry(app: Page) {
  await app.locator('#open-study').click();
  await app.locator('.tool-row[data-tool="geometry"]').click();
  await expect(app.locator('#tool-title')).toHaveText('Geometry');
  await expect(app.locator('.geo-canvas')).toBeVisible();
  // The sheet grows out of its row (a view transition, 0.24 s); browsers don't deliver presses until it ends.
  await app.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
}

async function run(app: Page, cmd: string) {
  const input = app.getByLabel('Geometry command');
  await input.fill(cmd);
  await input.press('Enter');
  await expect(app.locator('.geo')).toHaveAttribute('data-last-ok', 'true');
}

const screenOf = (app: Page, id: string) => app.evaluate((n) => (window as unknown as { __geometry: { screenOf(id: string): { x: number; y: number } | null } }).__geometry.screenOf(n), id);
const item = (app: Page, text: string | RegExp) => app.locator('.geo-list .geo-item', { hasText: text });

test('geometry: typed constructions, measurements, live dependents, undo, save and reload', async ({ app }) => {
  await openGeometry(app);
  await run(app, 'point A at (0, 0)');
  await run(app, 'point B at (4, 0)');
  await run(app, 'C = (0, 3)');
  await run(app, 'triangle ABC');
  await run(app, 'midpoint M of BC');
  await run(app, 'circle centered A through B');
  await run(app, 'measure angle BAC');
  await run(app, 'measure BC');
  await expect(item(app, 'Midpoint M of BC')).toContainText('(2, 1.5)');
  await expect(item(app, 'Angle BAC')).toContainText('90°');
  await expect(item(app, 'Length BC')).toContainText('= 5');
  await expect(item(app, 'Polygon ABC')).toContainText('area 6');

  // Moving a free point by command updates everything built on it.
  await run(app, 'move B to (3, 3)');
  await expect(item(app, 'Angle BAC')).toContainText('45°');
  await expect(item(app, 'Midpoint M of BC')).toContainText('(1.5, 3)');
  await expect(item(app, /^Circle c1/)).toContainText('radius 4.24');

  // Undo goes back one step.
  await run(app, 'undo');
  await expect(item(app, 'Angle BAC')).toContainText('90°');

  // A mistake is explained, not thrown.
  const input = app.getByLabel('Geometry command');
  await input.fill('segment AZ');
  await input.press('Enter');
  await expect(app.locator('.geo-status')).toContainText('There is no point Z');

  // Saved on the device: closing and reopening (or reloading) brings it back.
  await app.locator('#tool-close').click();
  await app.reload();
  await openGeometry(app);
  await expect(item(app, 'Angle BAC')).toContainText('90°');
  await expect(app.locator('.geo-status')).toContainText('restored');
});

test('geometry: drag a free point with the pointer; dependents follow; drawing tools', async ({ app }) => {
  await openGeometry(app);
  await run(app, 'A = (-2, 0)');
  await run(app, 'B = (2, 0)');
  await run(app, 'midpoint of AB');
  await run(app, 'measure AB');
  await expect(item(app, 'Midpoint C of AB')).toContainText('(0, 0)');

  const a = (await screenOf(app, 'A'))!;
  const b = (await screenOf(app, 'B'))!;
  const unit = (b.x - a.x) / 4;
  await app.mouse.move(a.x, a.y);
  await app.mouse.down();
  await app.mouse.move(a.x - unit, a.y - unit, { steps: 4 });
  await app.mouse.move(a.x - 2 * unit, a.y - 2 * unit, { steps: 4 });
  await app.mouse.up();
  // Snapped to the grid: A is now (-4, 2), so the midpoint is (-1, 1).
  await expect(item(app, 'Point A')).toContainText('(-4, 2)');
  await expect(item(app, 'Midpoint C of AB')).toContainText('(-1, 1)');
  // The whole drag is one undo step.
  await app.getByRole('button', { name: 'Undo' }).click();
  await expect(item(app, 'Point A')).toContainText('(-2, 0)');

  // Segment tool: click two empty spots (makes points) to draw a segment.
  await app.locator('.geo-tools button[data-tool="segment"]').click();
  const box = (await app.locator('.geo-canvas').boundingBox())!;
  const origin = (await screenOf(app, 'C'))!; // (0, 0)
  await app.mouse.click(origin.x + unit, origin.y - 2 * unit);
  await app.mouse.click(origin.x + 3 * unit, origin.y - 2 * unit);
  await expect(item(app, 'Segment DE')).toBeVisible();
  await expect(item(app, 'Point D')).toContainText('(1, 2)');
  expect(box.width).toBeGreaterThan(100);
});

test('geometry: keyboard picks objects and arrow keys move points', async ({ app }) => {
  await openGeometry(app);
  await run(app, 'A = (1, 1)');
  await run(app, 'B = (3, 1)');
  await run(app, 'segment AB');
  const canvas = app.locator('.geo-canvas');
  await canvas.focus();
  await canvas.press('Escape');
  await canvas.press(']');
  await expect(app.locator('.geo-status')).toContainText('Point A at (1, 1)');
  await canvas.press('ArrowRight');
  await canvas.press('ArrowUp');
  await expect(item(app, 'Point A')).toContainText('(2, 2)');
  await canvas.press('Shift+ArrowLeft');
  await expect(item(app, 'Point A')).toContainText('(1.9, 2)');
  await canvas.press(']');
  await canvas.press(']');
  await expect(app.locator('.geo-status')).toContainText('Segment AB');
  await canvas.press('Delete');
  await expect(item(app, 'Segment AB')).toHaveCount(0);
  await canvas.press('Control+z');
  await expect(item(app, 'Segment AB')).toHaveCount(1);
  // The tool sheet is still open (Escape on the canvas only let go of the pick).
  await expect(app.locator('#tool')).toHaveJSProperty('open', true);
});

test('geometry: export PNG, intersections, dark theme', async ({ app }) => {
  await openGeometry(app);
  await run(app, 'A = (0, 0)');
  await run(app, 'B = (2, 0)');
  await run(app, 'circle centered A through B');
  await run(app, 'circle centered B through A');
  await run(app, 'intersect c1 and c2');
  await expect(item(app, /^Intersection C/)).toContainText('(1, 1.73)');
  await expect(item(app, /^Intersection D/)).toContainText('(1, -1.73)');
  await run(app, 'measure angle ACB');
  await expect(item(app, 'Angle ACB')).toContainText('60°');

  const dl = app.waitForEvent('download');
  await app.getByRole('button', { name: 'Export PNG' }).click();
  expect((await dl).suggestedFilename()).toBe('geometry.png');

  // Comfy dark: the canvas paints with the dark theme's surface (tokens are read at draw time).
  const corner = () => app.locator('.geo-canvas').evaluate((c: HTMLCanvasElement) => [...c.getContext('2d')!.getImageData(2, 2, 1, 1).data].slice(0, 3).reduce((a, b) => a + b, 0));
  await expect.poll(corner).toBeGreaterThan(500);
  await app.locator('#tool-close').click();
  await app.emulateMedia({ colorScheme: 'dark' });
  await app.reload();
  await openGeometry(app);
  await expect(item(app, 'Angle ACB')).toContainText('60°');
  await expect.poll(corner).toBeLessThan(200);
});

test('geometry: opens from a typed request', async ({ app }) => {
  const input = app.locator('#input');
  await input.fill('open geometry');
  await input.press('Enter');
  await expect(app.locator('#tool-title')).toHaveText('Geometry');
});
