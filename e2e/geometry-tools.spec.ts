import type { Page } from '@playwright/test';
import { test, expect } from './helpers';

/** The newer geometry tools: compass, bisectors, tangents, regular polygons, transformations, sliders, labels, trace, SVG. */

async function openGeometry(app: Page) {
  await app.locator('#open-study').click();
  await app.locator('.tool-row[data-tool="geometry"]').click();
  await expect(app.locator('#tool-title')).toHaveText('Geometry');
  await expect(app.locator('.geo-canvas')).toBeVisible();
  await app.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
}

async function run(app: Page, cmd: string) {
  const input = app.getByLabel('Geometry command');
  await input.fill(cmd);
  await input.press('Enter');
  await expect(app.locator('.geo')).toHaveAttribute('data-last-ok', 'true');
  await expect(input).toHaveValue('');
}

type Hook = { screenOf(id: string): { x: number; y: number } | null; svg(): string; labels(): string[]; trail(id: string): number };
type W = { __geometry: Hook };
const screenOf = async (app: Page, id: string) => (await app.evaluate((n) => (window as unknown as W).__geometry.screenOf(n), id))!;
const labels = (app: Page) => app.evaluate(() => (window as unknown as W).__geometry.labels());
const trail = (app: Page, id: string) => app.evaluate((n) => (window as unknown as W).__geometry.trail(n), id);
const svgOf = (app: Page) => app.evaluate(() => (window as unknown as W).__geometry.svg());
const item = (app: Page, text: string | RegExp) => app.locator('.geo-list .geo-item', { hasText: text });
const status = (app: Page) => app.locator('.geo-status');

async function pickTool(app: Page, id: string) {
  const b = app.locator(`.geo-tools button[data-tool="${id}"]`);
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
  await app.locator('.geo-canvas').scrollIntoViewIfNeeded();
}
/** Clicks the canvas where a point is drawn. */
async function clickPoint(app: Page, id: string) {
  const p = await screenOf(app, id);
  await app.mouse.click(p.x, p.y);
}
/** Clicks the canvas at a world position, worked out from two points' screen positions (O at the origin, X at (1, 0)). */
async function clickWorld(app: Page, x: number, y: number, origin: string, unitX: string) {
  const o = await screenOf(app, origin);
  const u = await screenOf(app, unitX);
  const s = u.x - o.x;
  await app.mouse.click(o.x + x * s, o.y - y * s);
}

test('geometry tools: compass and bisectors, typed and by toolbar', async ({ app }) => {
  await openGeometry(app);
  await run(app, 'A = (0, 0)');
  await run(app, 'B = (3, 0)');
  await run(app, 'C = (0, 4)');
  await run(app, 'compass A radius BC');
  await expect(item(app, /^Circle c1, centre A, radius BC/)).toContainText('radius 5');
  await run(app, 'perpendicular bisector of AB');
  await expect(item(app, 'Perpendicular bisector l1 of AB')).toBeVisible();
  await run(app, 'intersect l1 and AB');
  await expect(item(app, /^Intersection D of l1 and AB/)).toContainText('(1.5, 0)');
  await run(app, 'angle bisector of BAC');
  await run(app, 'intersect l2 and c1');
  await expect(item(app, '(3.54, 3.54)')).toHaveCount(1);

  // The same tools from the toolbar.
  await pickTool(app, 'perpBisector');
  await clickPoint(app, 'B');
  await clickPoint(app, 'C');
  await expect(item(app, 'Perpendicular bisector l3 of BC')).toBeVisible();
  await pickTool(app, 'angleBisector');
  await clickPoint(app, 'B');
  await clickPoint(app, 'A');
  await clickPoint(app, 'C');
  await expect(item(app, 'Angle bisector l4 of BAC')).toBeVisible();
  await pickTool(app, 'compass');
  await clickPoint(app, 'A');
  await clickPoint(app, 'B');
  await clickPoint(app, 'C');
  await expect(item(app, /^Circle c2, centre C, radius AB/)).toContainText('radius 3');
  // Compass radius stays live: moving B changes it.
  await run(app, 'move B to (2, 0)');
  await expect(item(app, /^Circle c2/)).toContainText('radius 2');
});

test('geometry tools: tangents from a point — two, one, none, live', async ({ app }) => {
  await openGeometry(app);
  await run(app, 'O = (0, 0)');
  await run(app, 'R = (2, 0)');
  await run(app, 'circle centered O through R');
  await run(app, 'P = (4, 0)');
  await run(app, 'tangents from P to c1');
  await expect(status(app)).toContainText('2 tangents');
  await expect(item(app, /^Tangent l\d from P to c1/)).toHaveCount(2);
  await run(app, 'intersect l1 and c1');
  await expect(item(app, /^Intersection A of l1 and c1/)).toContainText(/\(1, -?1\.73\)/);
  await run(app, 'move P to (1, 0)');
  await expect(item(app, 'none right now')).toHaveCount(2);
  await run(app, 'move P to (0, 2)');
  await expect(item(app, 'none right now')).toHaveCount(1);
  await run(app, 'move P to (-4, 0)');
  await expect(item(app, 'none right now')).toHaveCount(0);

  await run(app, 'Q = (0, -4)');
  await pickTool(app, 'tangents');
  await clickPoint(app, 'Q');
  await clickPoint(app, 'R'); // R sits on the circle; the tool wants a circle, so it picks c1
  await expect(status(app)).toContainText('2 tangents');
  await expect(item(app, /^Tangent l\d from Q to c1/)).toHaveCount(2);
});

test('geometry tools: regular polygons by command and toolbar', async ({ app }) => {
  await openGeometry(app);
  await run(app, 'A = (0, 0)');
  await run(app, 'B = (2, 0)');
  await run(app, 'regular polygon AB 6');
  await expect(item(app, 'Regular polygon poly1 on AB, 6 sides')).toContainText('area 10.39, perimeter 12');
  await pickTool(app, 'regular');
  const sides = app.locator('.geo-param-input');
  await expect(sides).toHaveValue('6');
  await sides.fill('4');
  await clickPoint(app, 'A');
  await clickPoint(app, 'B');
  await expect(item(app, 'Regular polygon poly2 on AB, 4 sides')).toContainText('area 4, perimeter 8');
});

test('geometry tools: reflect, rotate, translate, dilate — images follow their sources', async ({ app }) => {
  await openGeometry(app);
  await run(app, 'O = (0, 0)');
  await run(app, 'P = (2, 1)');
  await run(app, 'U = (1, 1)');
  await run(app, 'reflect P over OU');
  await expect(item(app, "Reflection P' of P over OU")).toContainText('(1, 2)');
  await run(app, 'rotate P about O by 90');
  await expect(item(app, 'Rotation A of P about O by 90°')).toContainText('(-1, 2)');
  await run(app, 'translate P by OU');
  await expect(item(app, 'Translation B of P by OU')).toContainText('(3, 2)');
  await run(app, 'dilate P from O by 2');
  await expect(item(app, 'Dilation C of P from O by 2')).toContainText('(4, 2)');
  // Move the source: every image follows.
  await run(app, 'move P to (1, 0)');
  await expect(item(app, "Reflection P'")).toContainText('(0, 1)');
  await expect(item(app, 'Rotation A')).toContainText('(0, 1)');
  await expect(item(app, 'Translation B')).toContainText('(2, 1)');
  await expect(item(app, 'Dilation C')).toContainText('(2, 0)');
  await run(app, 'triangle OPU');
  await run(app, 'rotate poly1 about O by 180');
  await expect(item(app, 'Rotation poly2 of poly1 about O by 180°')).toContainText('area 0.5');

  // Toolbar versions.
  await run(app, 'line OU');
  await pickTool(app, 'reflect');
  await clickPoint(app, 'P');
  await clickWorld(app, 2.5, 2.5, 'O', 'P');
  await expect(item(app, /^Reflection D of P over l1/)).toContainText('(0, 1)');
  await pickTool(app, 'rotate');
  await app.locator('.geo-param-input').fill('-90');
  await clickPoint(app, 'P');
  await clickPoint(app, 'O');
  await expect(item(app, 'Rotation E of P about O by -90°')).toContainText('(0, -1)');
  await pickTool(app, 'translate');
  await clickPoint(app, 'P');
  await clickPoint(app, 'O');
  await clickPoint(app, 'U');
  await expect(item(app, 'Translation F of P by OU')).toContainText('(2, 1)');
  await pickTool(app, 'dilate');
  await app.locator('.geo-param-input').fill('3');
  await clickPoint(app, 'P');
  await clickPoint(app, 'O');
  await expect(item(app, 'Dilation G of P from O by 3')).toContainText('(3, 0)');
});

test('geometry tools: sliders drive constructions (and undo)', async ({ app }) => {
  await openGeometry(app);
  await run(app, 'slider k from 0 to 5');
  await run(app, 'O = (0, 0)');
  await run(app, 'P = (1, 0)');
  await run(app, 'dilate P from O by k');
  await run(app, 'compass O radius k');
  await expect(item(app, "Dilation P' of P from O by k")).toContainText('(1, 0)');
  const k = app.getByRole('slider', { name: 'Slider k' });
  await k.fill('3');
  await expect(item(app, "Dilation P' of P from O by k")).toContainText('(3, 0)');
  await expect(item(app, /^Circle c1, centre O/)).toContainText('radius 3');
  await expect(app.locator('.geo-slider[data-id="k"] output')).toHaveText('3');
  await app.getByRole('button', { name: 'Undo' }).click();
  await expect(item(app, "Dilation P' of P from O by k")).toContainText('(1, 0)');
  await expect(k).toHaveValue('1');

  await run(app, 'slider t from 0 to 360');
  await run(app, 'rotate P about O by t');
  await app.getByRole('slider', { name: 'Slider t' }).fill('90');
  await expect(item(app, 'Rotation A of P about O by t°')).toContainText('(0, 1)');
  await run(app, 'set t to 180');
  await expect(item(app, 'Rotation A')).toContainText('(-1, 0)');
  await expect(app.getByRole('slider', { name: 'Slider t' })).toHaveValue('180');
  // The toolbar's slider tool adds one with the range typed next to it.
  await pickTool(app, 'slider');
  await app.locator('.geo-param-input').fill('-2 to 2');
  await app.locator('.geo-canvas').click({ position: { x: 20, y: 20 } });
  await expect(item(app, 'Slider k1 (-2 to 2) = 1')).toBeVisible();
});

test('geometry tools: measurement labels on the figure toggle on and off', async ({ app }) => {
  await openGeometry(app);
  await run(app, 'A = (0, 0)');
  await run(app, 'B = (4, 0)');
  await run(app, 'C = (0, 3)');
  await run(app, 'triangle ABC');
  await run(app, 'circle centered A through B');
  const btn = app.getByRole('button', { name: 'Labels' });
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  expect(await labels(app)).toEqual([]);
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => labels(app)).toEqual(expect.arrayContaining(['4', '5', '3', '90°', '36.9°', '53.1°', 'area 6', 'r 4 · area 50.27']));
  await btn.click();
  await expect.poll(() => labels(app)).toEqual([]);
  await run(app, 'show labels');
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await labels(app)).length).toBeGreaterThan(5);
  await run(app, 'hide labels');
  await expect.poll(() => labels(app)).toEqual([]);
});

test('geometry tools: trace a point as a slider moves it; clear; toolbar toggle', async ({ app }) => {
  await openGeometry(app);
  await run(app, 'O = (0, 0)');
  await run(app, 'P = (2, 0)');
  await run(app, 'slider t from 0 to 360');
  await run(app, 'rotate P about O by t');
  await run(app, "trace P'");
  await expect(item(app, "Rotation P'")).toContainText('tracing');
  const t = app.getByRole('slider', { name: 'Slider t' });
  for (const v of ['30', '60', '90', '120', '150', '180']) await t.fill(v);
  await expect.poll(() => trail(app, "P'")).toBeGreaterThanOrEqual(6);
  await app.getByRole('button', { name: 'Clear trace' }).click();
  await expect.poll(() => trail(app, "P'")).toBe(0);
  await t.fill('200');
  await expect.poll(() => trail(app, "P'")).toBeGreaterThan(0);
  await run(app, 'clear trace');
  await expect.poll(() => trail(app, "P'")).toBe(0);

  // Trace tool: picking a traced point stops it.
  await pickTool(app, 'trace');
  await clickPoint(app, "P'");
  await expect(status(app)).toContainText("Stopped tracing P'");
  await expect(item(app, "Rotation P'")).not.toContainText('tracing');
  await clickPoint(app, 'P');
  await expect(status(app)).toContainText('Tracing P');
});

test('geometry tools: export SVG (download and a valid drawing), snap control', async ({ app }) => {
  await openGeometry(app);
  await run(app, 'A = (0, 0)');
  await run(app, 'B = (5, 0)');
  await run(app, 'C = (0, 4)');
  await run(app, 'triangle ABC');
  await run(app, 'circle centered A through C');
  await run(app, 'measure angle BAC');
  await run(app, 'segment AB');
  await run(app, 'show labels');
  const svg = await svgOf(app);
  expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  expect(svg).toContain('>90°</text>');
  expect(svg).toContain('>area 10</text>');
  expect(svg).toMatch(/<path d="M[^"]*A[\d.]+ [\d.]+ 0 1 1 /); // the circle, as two arcs
  const ok = await app.evaluate((s) => !new DOMParser().parseFromString(s, 'image/svg+xml').querySelector('parsererror'), svg);
  expect(ok).toBe(true);
  const dl = app.waitForEvent('download');
  await app.getByRole('button', { name: 'Export SVG' }).click();
  expect((await dl).suggestedFilename()).toBe('geometry.svg');

  // Snap: grid / objects / off.
  const snapObjects = app.locator('.geo-snap button[data-snap="objects"]');
  await expect(app.locator('.geo-snap button[data-snap="grid"]')).toHaveAttribute('aria-pressed', 'true');
  await snapObjects.click();
  await expect(snapObjects).toHaveAttribute('aria-pressed', 'true');
  await expect(status(app)).toContainText('snap to points and objects');
  // With object snap, a new point near segment AB lands on it.
  await pickTool(app, 'point');
  const a = await screenOf(app, 'A');
  const b = await screenOf(app, 'B');
  await app.mouse.click((a.x + b.x) / 2, a.y + 4);
  await expect(item(app, /^Point D at \([\d.]+, 0\)/)).toBeVisible();
});

test('geometry tools: fits a 360 px wide screen — toolbar scrolls, page does not', async ({ app }) => {
  await app.setViewportSize({ width: 360, height: 740 });
  await openGeometry(app);
  const overflow = await app.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const bar = app.locator('.geo-tools');
  expect(await bar.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
  await pickTool(app, 'trace');
  await expect(app.locator('.geo')).toHaveAttribute('data-tool', 'trace');
  await pickTool(app, 'rotate');
  await expect(app.locator('.geo-param')).toBeVisible();
  expect(await app.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
