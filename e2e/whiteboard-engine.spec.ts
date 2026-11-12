import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

// The whiteboard engine isn't wired into the app yet, so these tests drive the dev-only harness
// (apps/web/whiteboard-harness.html) on its own Vite dev server. Each worker gets its own port
// (5301 + 3 × parallel index + engine), so parallel workers never share or kill each other's server.
const PORTS: Record<string, number> = { chromium: 0, firefox: 1, webkit: 2 };
const ROOT = fileURLToPath(new URL('..', import.meta.url));

test.describe.configure({ mode: 'serial' });
test.skip(() => !(test.info().project.name in PORTS), 'desktop engines only');

let server: ChildProcess | null = null;
const port = (name: string) => 5301 + test.info().parallelIndex * 3 + PORTS[name]!;
const harness = (name: string) => `http://localhost:${port(name)}/whiteboard-harness.html`;

async function up(url: string): Promise<boolean> {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

test.beforeAll(async ({ browser }, info) => {
  const name = info.project.name;
  if (!(name in PORTS)) return;
  test.setTimeout(90_000);
  const url = harness(name);
  if (!(await up(url))) {
    server = spawn('npx', ['vite', 'apps/web', '--port', String(port(name)), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
    for (let i = 0; i < 100 && !(await up(url)); i++) await new Promise((r) => setTimeout(r, 300));
    if (!(await up(url))) throw new Error('whiteboard harness dev server did not start');
  }
  // Warm up: the first load makes Vite pre-bundle dependencies, which can reload the page once.
  const page = await browser.newPage();
  await page.goto(url);
  await page.waitForSelector('html[data-wb-ready]', { state: 'attached', timeout: 60_000 });
  await page.evaluate(() => (window as any).wb.addMath('x^2'));
  await page.evaluate(() => (window as any).wb.ready());
  // The app wiring (open.ts) pulls in the math engines; load them now so Vite's dependency pass can't reload a page mid-test.
  await page.evaluate(() => import('/src/whiteboard/open.ts' as string)).catch(() => undefined);
  await page.waitForTimeout(800);
  await page.close();
});

test.afterAll(() => {
  if (server?.pid) {
    try {
      process.kill(-server.pid);
    } catch {
      server.kill();
    }
  }
});

test.beforeEach(async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  (page as unknown as { __errors: string[] }).__errors = errors;
  await page.goto(harness(info.project.name));
  await page.waitForSelector('html[data-wb-ready]', { state: 'attached' });
  await expect(page.locator('.wb-canvas')).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect((page as unknown as { __errors: string[] }).__errors, 'uncaught page errors').toEqual([]);
});

/** Pixel (r, g, b) of the board canvas at CSS coordinates. */
async function pixel(page: Page, x: number, y: number): Promise<[number, number, number]> {
  return page.evaluate(
    ([x, y]) => {
      (window as any).wb.renderNow();
      const c = document.querySelector<HTMLCanvasElement>('.wb-canvas')!;
      const k = c.width / c.getBoundingClientRect().width;
      const d = c.getContext('2d')!.getImageData(Math.round(x! * k), Math.round(y! * k), 1, 1).data;
      return [d[0]!, d[1]!, d[2]!] as [number, number, number];
    },
    [x, y],
  );
}
const differs = (a: number[], b: number[], by = 40) => Math.abs(a[0]! - b[0]!) + Math.abs(a[1]! - b[1]!) + Math.abs(a[2]! - b[2]!) > by;
const count = (page: Page) => page.evaluate(() => (window as any).wb.objects().length as number);

test('draws a stroke with the mouse, then undo and redo', async ({ page }) => {
  const box = (await page.locator('.wb-canvas').boundingBox())!;
  const x = box.x + box.width * 0.3;
  const y = box.y + box.height * 0.5;
  const before = await pixel(page, x - box.x + 60, y - box.y);
  await page.keyboard.press('p');
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(x + i * 10, y + Math.sin(i / 2) * 8);
  await page.mouse.up();
  const objs = await page.evaluate(() => (window as any).wb.objects().map((o: any) => ({ kind: o.kind, n: o.pts?.length })));
  expect(objs).toHaveLength(1);
  expect(objs[0].kind).toBe('stroke');
  expect(objs[0].n).toBeGreaterThan(9);
  // Ink is on the canvas along the stroke.
  const b = await page.evaluate(() => (window as any).wb.bounds((window as any).wb.objects()[0].id));
  const s = await page.evaluate((p) => (window as any).wb.toScreen(p), { x: b.x + b.w / 2, y: b.y + b.h / 2 });
  let inked = false;
  for (let dy = -10; dy <= 10 && !inked; dy++) inked = differs(await pixel(page, s.x, s.y + dy), before);
  expect(inked).toBe(true);

  await page.keyboard.press('ControlOrMeta+z');
  expect(await count(page)).toBe(0);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  expect(await count(page)).toBe(1);
  await page.locator('[data-act="undo"]').click();
  expect(await count(page)).toBe(0);
  await page.locator('[data-act="redo"]').click();
  expect(await count(page)).toBe(1);
});

test('pans with the hand tool and space-drag, zooms around the pointer, clamps zoom', async ({ page }) => {
  const box = (await page.locator('.wb-canvas').boundingBox())!;
  const cam = () => page.evaluate(() => (window as any).wb.camera() as { x: number; y: number; z: number });
  const c0 = await cam();
  await page.keyboard.press('h');
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 350, { steps: 5 });
  await page.mouse.up();
  const c1 = await cam();
  expect(c1.x).toBeCloseTo(c0.x - 100, 0);
  expect(c1.y).toBeCloseTo(c0.y - 50, 0);

  // Space + drag with the pen tool pans and draws nothing.
  await page.keyboard.press('p');
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.keyboard.down('Space');
  await page.mouse.down();
  await page.mouse.move(box.x + 250, box.y + 300, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  expect((await cam()).x).toBeCloseTo(c1.x + 50, 0);
  expect(await count(page)).toBe(0);

  // Ctrl+wheel zooms and keeps the world point under the pointer fixed.
  const px = { x: 420, y: 260 };
  const w0 = await page.evaluate((p) => (window as any).wb.toWorld(p), px);
  await page.mouse.move(box.x + px.x, box.y + px.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect.poll(async () => (await cam()).z).toBeGreaterThan(1.5);
  const w1 = await page.evaluate((p) => (window as any).wb.toWorld(p), px);
  expect(w1.x).toBeCloseTo(w0.x, 1);
  expect(w1.y).toBeCloseTo(w0.y, 1);

  // Plain wheel pans.
  const before = await cam();
  await page.mouse.wheel(0, 120);
  await expect.poll(async () => (await cam()).y).toBeGreaterThan(before.y);

  // Buttons and clamping.
  await page.evaluate(() => (window as any).wb.setCamera({ z: 1 }));
  await page.locator('[data-act="zoom-in"]').click();
  expect((await cam()).z).toBeCloseTo(1.25, 5);
  await expect(page.locator('.wb-zoom-pct')).toHaveText('125%');
  await page.locator('[data-act="zoom-out"]').click();
  expect((await cam()).z).toBeCloseTo(1, 5);
  await page.evaluate(() => (window as any).wb.zoomBy(1000));
  expect((await cam()).z).toBe(8);
  await page.evaluate(() => (window as any).wb.zoomBy(0.0001));
  expect((await cam()).z).toBeCloseTo(0.1, 5);
});

test('API adds text, math, graph, shapes and marks; groups move together', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const wb = (window as any).wb;
    const t = wb.addText('Solve 2x + 3 = 11', { size: 30 });
    const m = wb.addMath('2x + 3 = 11 \\Rightarrow x = 4');
    const before = wb.bounds(m);
    await wb.ready();
    const mathB = wb.bounds(m);
    const g = wb.addGraph(['y = x^2', 'sin(x)', 'x^2 + y^2 = 9'], { w: 400, h: 260 });
    const shapes = ['rect', 'ellipse', 'line', 'arrow', 'triangle', 'numberline', 'axes'].map((k) => wb.addShape(k, { label: k === 'numberline' ? 'n' : undefined }));
    const line = wb.addShape('arrow', { at: { x: 1000, y: 1000 }, to: { x: 1200, y: 1100 } });
    const marks = ['circle', 'box', 'underline', 'highlight', 'check'].map((s) => wb.mark(m, s));
    const circle = wb.bounds(marks[0]);
    const grp = wb.group([t, m]);
    const tb0 = wb.bounds(t);
    wb.move(grp, { x: 50, y: 20 });
    const tb1 = wb.bounds(t);
    const circle2 = wb.bounds(marks[0]);
    const kinds = wb.objects().map((o: any) => o.kind);
    return {
      ids: [t, m, g, ...shapes, line, ...marks, grp].every((id: string) => typeof id === 'string' && !!wb.bounds(id)),
      before,
      mathB,
      circle,
      circle2,
      tb0,
      tb1,
      last: wb.last() === grp,
      lineB: wb.bounds(line),
      kinds,
      highlightBelow: wb.get(marks[3]).z < wb.get(m).z,
      title: wb.title,
    };
  });
  expect(r.ids).toBe(true);
  // Math bounds come from the typeset image once it is ready.
  expect(r.mathB.w).toBeGreaterThan(150);
  expect(r.mathB.h).toBeGreaterThan(20);
  // The circle surrounds the math.
  expect(r.circle.x).toBeLessThan(r.mathB.x);
  expect(r.circle.y).toBeLessThan(r.mathB.y);
  expect(r.circle.x + r.circle.w).toBeGreaterThan(r.mathB.x + r.mathB.w);
  // Moving the group moves its members and the mark follows.
  expect(r.tb1.x - r.tb0.x).toBeCloseTo(50, 5);
  expect(r.tb1.y - r.tb0.y).toBeCloseTo(20, 5);
  expect(r.circle2.x - r.circle.x).toBeCloseTo(50, 5);
  expect(r.last).toBe(true);
  expect(r.lineB.x).toBeLessThanOrEqual(1000);
  expect(r.lineB.x + r.lineB.w).toBeGreaterThanOrEqual(1200);
  expect(r.highlightBelow).toBe(true);
  expect(r.kinds.filter((k: string) => k === 'mark')).toHaveLength(5);
  expect(r.title).toBe('Untitled board');

  // Removing the group removes members and their marks; undo restores everything.
  const n = await count(page);
  await page.evaluate(() => (window as any).wb.remove((window as any).wb.last()));
  expect(await count(page)).toBe(n - 8);
  await page.evaluate(() => (window as any).wb.undo());
  expect(await count(page)).toBe(n);
  await page.evaluate(() => (window as any).wb.clear());
  expect(await count(page)).toBe(0);
  await page.evaluate(() => (window as any).wb.undo());
  expect(await count(page)).toBe(n);
});

test('nextSpot never overlaps existing objects', async ({ page }) => {
  const overlaps = await page.evaluate(async () => {
    const wb = (window as any).wb;
    wb.addShape('rect', { at: { x: -100, y: -60 }, w: 300, h: 200 });
    for (let i = 0; i < 6; i++) {
      wb.addText(`Line ${i}`);
      wb.addMath(`x_${i} = ${i}`);
    }
    wb.addGraph(['y = x']);
    wb.addShape('numberline');
    await wb.ready();
    const ids = wb.objects().map((o: any) => o.id);
    const bs = ids.map((id: string) => wb.bounds(id));
    let bad = 0;
    for (let i = 0; i < bs.length; i++)
      for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i];
        const b = bs[j];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) bad++;
      }
    const s = wb.nextSpot(200, 100);
    const r = { x: s.x, y: s.y, w: 200, h: 100 };
    const hitsSpot = bs.some((b: any) => b.x < r.x + r.w && r.x < b.x + b.w && b.y < r.y + r.h && r.y < b.y + b.h);
    return { bad, hitsSpot };
  });
  expect(overlaps).toEqual({ bad: 0, hitsSpot: false });
});

test('boards persist across reload; rename, new, switch and delete with confirm', async ({ page }) => {
  await page.evaluate(() => {
    const wb = (window as any).wb;
    wb.addText('kept');
    wb.addMath('a^2 + b^2 = c^2');
    wb.addStroke([0, 0, 50, 20, 100, 0]);
  });
  await page.locator('[data-act="boards"]').click();
  await page.locator('.wb-rename').fill('Pythagoras');
  await page.locator('.wb-rename').press('Enter');
  await expect(page.locator('.wb-title')).toHaveText('Pythagoras');
  await page.evaluate(() => (window as any).wb.flush());
  await page.reload();
  await page.waitForSelector('html[data-wb-ready]', { state: 'attached' });
  const after = await page.evaluate(() => ({ title: (window as any).wb.title, kinds: (window as any).wb.objects().map((o: any) => o.kind).sort() }));
  expect(after).toEqual({ title: 'Pythagoras', kinds: ['math', 'stroke', 'text'] });

  // New board, then switch back through the list.
  await page.locator('[data-act="boards"]').click();
  await page.locator('[data-act="new-board"]').click();
  await expect.poll(() => count(page)).toBe(0);
  await expect(page.locator('.wb-title')).toHaveText('Untitled board');
  await page.locator('[data-act="boards"]').click();
  await expect(page.locator('.wb-board')).toHaveCount(2);
  await page.locator('.wb-board', { hasText: 'Pythagoras' }).locator('.wb-board-open').click();
  await expect.poll(() => count(page)).toBe(3);
  // The last-used board opens by default.
  await page.reload();
  await page.waitForSelector('html[data-wb-ready]', { state: 'attached' });
  expect(await page.evaluate(() => (window as any).wb.title)).toBe('Pythagoras');

  // Delete the other board: built-in confirm, cancel first, then confirm.
  await page.locator('[data-act="boards"]').click();
  const other = page.locator('.wb-board', { hasText: 'Untitled board' });
  await other.locator('.wb-board-del').click();
  await expect(page.locator('.wb-confirm-text')).toHaveText('Delete this board?');
  await page.locator('[data-cancel-del]').click();
  await expect(page.locator('.wb-board')).toHaveCount(2);
  await page.locator('.wb-board', { hasText: 'Untitled board' }).locator('.wb-board-del').click();
  await page.locator('[data-confirm-del]').click();
  await expect(page.locator('.wb-board')).toHaveCount(1);
  expect((await page.evaluate(() => (window as any).wb.listBoards())).length).toBe(1);
});

test('exports a non-empty PNG of the content', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const wb = (window as any).wb;
    wb.addMath('\\int_0^1 x^2\\,dx = \\tfrac13');
    wb.addGraph(['y = x^3 - x']);
    wb.addShape('ellipse');
    const blob: Blob = await wb.exportPng();
    const bmp = await createImageBitmap(blob);
    return { type: blob.type, size: blob.size, w: bmp.width, h: bmp.height };
  });
  expect(r.type).toBe('image/png');
  expect(r.size).toBeGreaterThan(5000);
  expect(r.w).toBeGreaterThan(400);
  expect(r.h).toBeGreaterThan(400);
});

test('select by click and marquee, delete with Backspace', async ({ page }) => {
  const ids = await page.evaluate(() => {
    const wb = (window as any).wb;
    wb.setCamera({ x: 0, y: 0, z: 1 });
    return [wb.addShape('rect', { at: { x: 100, y: 200 }, w: 120, h: 80 }), wb.addShape('ellipse', { at: { x: 300, y: 200 }, w: 120, h: 80 })];
  });
  const box = (await page.locator('.wb-canvas').boundingBox())!;
  await page.keyboard.press('v');
  await page.mouse.click(box.x + 160, box.y + 240);
  expect(await page.evaluate(() => (window as any).wb.selection())).toEqual([ids[0]]);
  await page.keyboard.press('Backspace');
  expect(await page.evaluate(() => (window as any).wb.objects().map((o: any) => o.id))).toEqual([ids[1]]);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await count(page)).toBe(2);
  // Marquee both, delete both.
  await page.mouse.move(box.x + 60, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + 470, box.y + 330, { steps: 6 });
  await page.mouse.up();
  expect((await page.evaluate(() => (window as any).wb.selection())).sort()).toEqual([...ids].sort());
  // Drag moves the selection.
  await page.mouse.move(box.x + 160, box.y + 240);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 260, { steps: 4 });
  await page.mouse.up();
  const moved = await page.evaluate((id) => (window as any).wb.bounds(id), ids[1]);
  expect(moved.x).toBeCloseTo(340, 0);
  await page.keyboard.press('Delete');
  expect(await count(page)).toBe(0);
});

test('text tool places editable text; double-click edits it', async ({ page }) => {
  const box = (await page.locator('.wb-canvas').boundingBox())!;
  await page.keyboard.press('t');
  await page.mouse.click(box.x + 200, box.y + 200);
  await expect(page.locator('.wb-editor')).toBeVisible();
  await page.keyboard.type('hello board');
  await page.keyboard.press('Escape');
  const t = await page.evaluate(() => (window as any).wb.objects()[0]);
  expect(t.kind).toBe('text');
  expect(t.text).toBe('hello board');
  await page.keyboard.press('v');
  const s = await page.evaluate((o) => (window as any).wb.toScreen({ x: o.x + 10, y: o.y + 10 }), t);
  await page.mouse.dblclick(box.x + s.x, box.y + s.y);
  await expect(page.locator('.wb-editor')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('edited');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (window as any).wb.objects()[0].text)).toBe('edited');
});

test('eraser removes whole strokes it touches', async ({ page }) => {
  await page.evaluate(() => {
    const wb = (window as any).wb;
    wb.setCamera({ x: 0, y: 0, z: 1 });
    wb.addStroke([100, 100, 300, 100]);
    wb.addStroke([100, 300, 300, 300]);
  });
  const box = (await page.locator('.wb-canvas').boundingBox())!;
  await page.keyboard.press('e');
  await page.mouse.move(box.x + 200, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 160, { steps: 6 });
  await page.mouse.up();
  expect(await count(page)).toBe(1);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await count(page)).toBe(2);
});

test('theme switch re-renders with the new colours', async ({ page }) => {
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
    const wb = (window as any).wb;
    wb.setCamera({ x: 0, y: 0, z: 1 });
    wb.addStroke([100, 100, 300, 100], { size: 12 });
  });
  await page.waitForTimeout(100);
  const bg0 = await pixel(page, 600, 330);
  const ink0 = await pixel(page, 200, 100);
  await page.locator('#theme').click();
  await expect.poll(async () => differs(await pixel(page, 600, 330), bg0, 120)).toBe(true);
  const ink1 = await pixel(page, 200, 100);
  expect(differs(ink1, ink0, 120)).toBe(true);
  // Light ink on dark background now.
  expect(ink1[0] + ink1[1] + ink1[2]).toBeGreaterThan(ink0[0] + ink0[1] + ink0[2]);
});

test('command bar: Enter sends the command, mic toggles listening', async ({ page }) => {
  const input = page.locator('.wb-command-input');
  await expect(input).toHaveAttribute('placeholder', 'Say or type: solve 2x + 3 = 11 and circle the answer');
  await input.fill('graph y = x^2');
  await input.press('Enter');
  expect(await page.evaluate(() => (window as any).wbLog.commands)).toEqual(['graph y = x^2']);
  await expect(page.locator('.wb-status')).toHaveText('Command: graph y = x^2');
  // Typing in the command bar does not trigger tool shortcuts.
  expect(await page.evaluate(() => (window as any).wb.tool)).toBe('pen');
  await page.locator('.wb-mic').click();
  await expect(page.locator('.wb-mic')).toHaveClass(/is-listening/);
  await expect(page.locator('.wb-mic')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.wb-mic').click();
  await expect(page.locator('.wb-mic')).not.toHaveClass(/is-listening/);
  await page.evaluate(() => (window as any).wb.setCommandText('solve 2x = 4'));
  await expect(input).toHaveValue('solve 2x = 4');
});

test('touch: one finger draws with the pen, two fingers pan and pinch-zoom', async ({ page }) => {
  const r = await page.evaluate(() => {
    const wb = (window as any).wb;
    const c = document.querySelector<HTMLCanvasElement>('.wb-canvas')!;
    const fire = (type: string, id: number, x: number, y: number) =>
      c.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: id === 1, buttons: type === 'pointerup' ? 0 : 1 }));
    wb.setTool('pen');
    wb.setCamera({ x: 0, y: 0, z: 1 });
    fire('pointerdown', 1, 200, 200);
    for (let i = 1; i <= 8; i++) fire('pointermove', 1, 200 + i * 10, 200 + i * 4);
    fire('pointerup', 1, 280, 232);
    const drawn = wb.objects().length;
    // Two fingers: spread from 100px apart to 200px apart around (400, 300), and move the midpoint by +20, +10.
    fire('pointerdown', 11, 350, 300);
    fire('pointerdown', 12, 450, 300);
    for (let i = 1; i <= 10; i++) {
      const half = 50 + i * 5;
      fire('pointermove', 11, 400 + i * 2 - half, 300 + i);
      fire('pointermove', 12, 400 + i * 2 + half, 300 + i);
    }
    fire('pointerup', 11, 370, 310);
    fire('pointerup', 12, 520, 310);
    return { drawn, after: wb.objects().length, cam: wb.camera(), world: wb.toWorld({ x: 420, y: 310 }) };
  });
  expect(r.drawn).toBe(1);
  expect(r.after).toBe(1); // the pinch drew nothing
  expect(r.cam.z).toBeCloseTo(2, 5);
  // The world point that started under the fingers' midpoint (400, 300) is under the new midpoint.
  expect(r.world.x).toBeCloseTo(400, 3);
  expect(r.world.y).toBeCloseTo(300, 3);
});

test('phone width: toolbar scrolls, nothing overflows the page', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.waitForTimeout(100);
  const m = await page.evaluate(() => {
    const tb = document.querySelector<HTMLElement>('.wb-toolbar')!;
    const cmd = document.querySelector<HTMLElement>('.wb-command')!.getBoundingClientRect();
    const tr = document.querySelector<HTMLElement>('.wb-topright')!.getBoundingClientRect();
    const t = tb.getBoundingClientRect();
    return { scroll: tb.scrollWidth > tb.clientWidth, right: t.right, docW: document.documentElement.scrollWidth, cmdR: cmd.right, trTop: tr.top, tbBottom: t.bottom };
  });
  expect(m.scroll).toBe(true);
  expect(m.right).toBeLessThanOrEqual(375);
  expect(m.cmdR).toBeLessThanOrEqual(375);
  expect(m.docW).toBeLessThanOrEqual(375);
  expect(m.trTop).toBeGreaterThanOrEqual(m.tbBottom);
});

test('5,000 strokes: pan and zoom frames stay under 16 ms', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'timing budget is measured in Chromium');
  test.setTimeout(120_000);
  const r = await page.evaluate(async () => {
    const wb = (window as any).wb;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 5000; i++) {
      let x = rnd() * 6000 - 3000;
      let y = rnd() * 4000 - 2000;
      const pts: number[] = [];
      const n = 15 + Math.floor(rnd() * 40);
      for (let k = 0; k < n; k++) {
        x += rnd() * 12 - 6;
        y += rnd() * 12 - 6;
        pts.push(x, y);
      }
      wb.addStroke(pts, { color: ['ink', 'accent', 'blue'][i % 3], size: 2 + (i % 3) * 2 });
    }
    // Each step moves the camera and renders exactly one frame the way requestAnimationFrame would
    // (canvas flushed with a pixel read, so raster time counts). Tiles left for later frames are counted
    // and the frames needed to finish are reported.
    const times = (fn: (i: number) => void, n: number) => {
      const out: number[] = [];
      let settleFrames = 0;
      wb.renderNow(true);
      for (let i = 0; i < n; i++) {
        fn(i);
        out.push(wb.renderNow(true));
      }
      while (wb.stats.pendingTiles > 0 && settleFrames < 200) {
        out.push(wb.renderNow(true));
        settleFrames++;
      }
      out.sort((a, b) => a - b);
      const q = (f: number) => Math.round(out[Math.min(out.length - 1, Math.floor(out.length * f))]! * 10) / 10;
      return { median: q(0.5), p90: q(0.9), max: q(1), settleFrames };
    };
    wb.setCamera({ x: -600, y: -400, z: 1 });
    const pan100 = times((i) => wb.setCamera({ x: -600 + i * 15, y: -400 + i * 5 }), 40);
    wb.setCamera({ x: -1500, y: -1000, z: 0.4 });
    const pan40 = times((i) => wb.setCamera({ x: -1500 + i * 30 }), 40);
    // Zoomed all the way out: every stroke on screen.
    const zoomAll = times((i) => {
      const z = 0.1 + (i % 10) * 0.01;
      wb.setCamera({ z, x: -innerWidth / 2 / z, y: -innerHeight / 2 / z });
    }, 40);
    const zoomIn = times((i) => {
      const z = 1 + (i % 20) * 0.3;
      wb.setCamera({ z, x: -innerWidth / 2 / z, y: -innerHeight / 2 / z });
    }, 40);
    // A cold full redraw of the overview (every tile rendered at once), for reference.
    wb.setCamera({ z: 0.11, x: -innerWidth / 2 / 0.11, y: -innerHeight / 2 / 0.11 });
    const t0 = performance.now();
    wb.clear();
    wb.undo();
    let frames = 0;
    do {
      wb.renderNow(true);
      frames++;
    } while (wb.stats.pendingTiles > 0 && frames < 500);
    const coldOverview = { ms: Math.round(performance.now() - t0), frames };
    return { count: wb.objects().length, pan100, pan40, zoomAll, zoomIn, coldOverview };
  });
  console.log('whiteboard perf (ms)', JSON.stringify(r));
  expect(r.count).toBe(5000);
  for (const k of ['pan100', 'pan40', 'zoomAll', 'zoomIn'] as const) {
    expect(r[k].median, `${k} median`).toBeLessThan(16);
    expect(r[k].p90, `${k} p90`).toBeLessThan(16);
  }
});

// ---------- regressions from the bug sweep ----------

/** Fraction of canvas pixels that change when every tile is thrown away and redrawn (theme round trip). */
async function stalePixels(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const wb = (window as any).wb;
    await wb.ready();
    for (let i = 0; i < 4; i++) wb.renderNow();
    const cv = document.querySelector<HTMLCanvasElement>('.wb-canvas')!;
    const x = cv.getContext('2d')!;
    const a = x.getImageData(0, 0, cv.width, cv.height).data;
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const root = document.documentElement;
    const was = root.dataset.theme;
    root.dataset.theme = was === 'dark' ? 'light' : 'dark';
    await frames();
    if (was === undefined) delete root.dataset.theme;
    else root.dataset.theme = was;
    await frames();
    for (let i = 0; i < 4; i++) wb.renderNow();
    const b = x.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!) > 40) n++;
    return n;
  });
}

test('a mark around a nested group follows when something inside moves (no ghost left in the tile cache)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(async () => {
    const wb = (window as any).wb;
    wb.setCamera({ x: -300, y: -200, z: 0.8 });
    const a = wb.addText('alpha', { at: { x: 0, y: 0 } });
    const b = wb.addText('beta beta beta beta beta', { at: { x: 0, y: 400 } });
    const inner = wb.group([a]);
    const outer = wb.group([inner, wb.addText('gamma', { at: { x: 300, y: 200 } }), b]);
    wb.mark(outer, 'circle');
    await wb.ready();
    wb.renderNow();
    wb.move(a, { x: -200, y: -150 });
  });
  expect(await stalePixels(page)).toBe(0);
});

test('removing the last thing in a nested group leaves no dangling group references; undo restores', async ({ page }) => {
  const r = await page.evaluate(() => {
    const wb = (window as any).wb;
    const a = wb.addText('a', { at: { x: 0, y: 0 } });
    const b = wb.addText('b', { at: { x: 0, y: 100 } });
    const inner = wb.group([a]);
    const outer = wb.group([inner, b]);
    wb.mark(inner, 'box');
    const integrity = () => {
      const os = wb.objects();
      const m = new Map(os.map((o: any) => [o.id, o]));
      const bad: string[] = [];
      for (const o of os as any[]) {
        if (o.parent && !(m.get(o.parent) as any)?.children.includes(o.id)) bad.push(`orphan ${o.id}`);
        if (o.kind === 'group') for (const c of o.children) if (!m.has(c)) bad.push(`missing child ${c}`);
        if (o.kind === 'group' && !o.children.length) bad.push('empty group');
        if (o.kind === 'mark' && !m.has(o.target)) bad.push('dangling mark');
      }
      return bad;
    };
    const n0 = wb.objects().length;
    wb.remove(a);
    const after = { bad: integrity(), inner: !!wb.get(inner), outerKids: wb.get(outer)?.children };
    wb.undo();
    return { after, restored: wb.objects().length === n0, badAfterUndo: integrity() };
  });
  expect(r.after.bad).toEqual([]);
  expect(r.after.inner).toBe(false);
  expect(r.after.outerKids).toHaveLength(1);
  expect(r.restored).toBe(true);
  expect(r.badAfterUndo).toEqual([]);
});

test('exporting right after adding math waits for its real size (not clipped)', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const wb = (window as any).wb;
    wb.addMath('\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6} \\quad \\int_0^{\\infty} e^{-x^2}\\,dx', { at: { x: 0, y: 0 }, size: 40 });
    const bmp = await createImageBitmap(await wb.exportPng());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const x = c.getContext('2d')!;
    x.drawImage(bmp, 0, 0);
    const d = x.getImageData(0, 0, bmp.width, bmp.height).data;
    let edge = 0;
    for (let y = 0; y < bmp.height; y++)
      for (let i = 0; i < bmp.width; i++) {
        if (i > 3 && y > 3 && i < bmp.width - 4 && y < bmp.height - 4) continue;
        const k = (y * bmp.width + i) * 4;
        if (Math.abs(d[k]! - d[0]!) + Math.abs(d[k + 1]! - d[1]!) + Math.abs(d[k + 2]! - d[2]!) > 60) edge++;
      }
    return edge;
  });
  expect(r).toBe(0);
});

test('reloading right after an edit keeps it; deleting the open board with a save pending keeps it deleted', async ({ page }) => {
  await page.evaluate(async () => {
    const wb = (window as any).wb;
    await wb.newBoard('Quick');
    wb.addText('just typed');
  });
  await page.reload();
  await page.waitForSelector('html[data-wb-ready]', { state: 'attached' });
  expect(await page.evaluate(() => (window as any).wb.objects().map((o: any) => o.text))).toEqual(['just typed']);
  // The stash is written back to IndexedDB, then forgotten.
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('lemma:board-stash:')).length)).toBe(0);

  const r = await page.evaluate(async () => {
    const wb = (window as any).wb;
    await wb.newBoard('Doomed');
    const id = wb.boardId;
    wb.addText('a');
    void wb.flush();
    wb.addText('b');
    void wb.flush();
    await wb.deleteBoard(id);
    await new Promise((res) => setTimeout(res, 1200));
    return { listed: (await wb.listBoards()).some((b: any) => b.id === id), open: wb.boardId === id };
  });
  expect(r).toEqual({ listed: false, open: false });
});

test('Space presses a focused toolbar button instead of starting a pan', async ({ page }) => {
  await page.evaluate(() => (window as any).wb.setTool('pen'));
  await page.locator('.wb-toolbar [data-tool="eraser"]').focus();
  await page.keyboard.press(' ');
  expect(await page.evaluate(() => (window as any).wb.tool)).toBe('eraser');
});

test('openWhiteboard: a double open makes one board; commands run in order; close cleans up', async ({ page }) => {
  const r = await page.evaluate(async () => {
    (window as any).wb.destroy();
    document.getElementById('board')!.remove();
    const mod = await import('/src/whiteboard/open.ts' as string);
    const host = { voiceSupported: false, toast: () => undefined, listen: () => () => undefined };
    await Promise.all([mod.openWhiteboard(host), mod.openWhiteboard(host)]);
    const views = document.querySelectorAll('.wb-view').length;
    const wb = mod.currentBoard();
    await wb.newBoard('Order');
    const input = document.querySelector<HTMLInputElement>('.wb-command-input')!;
    const form = document.querySelector<HTMLFormElement>('.wb-command')!;
    input.value = 'solve 2x + 3 = 11, just the answer';
    form.requestSubmit();
    input.value = 'circle it';
    form.requestSubmit();
    for (let i = 0; i < 100 && !wb.objects().some((o: any) => o.kind === 'mark' && o.style === 'circle'); i++) await new Promise((res) => setTimeout(res, 100));
    const objs = wb.objects();
    const circle = objs.find((o: any) => o.kind === 'mark' && o.style === 'circle');
    const box = objs.find((o: any) => o.kind === 'mark' && o.style === 'box');
    document.querySelector<HTMLButtonElement>('[data-act="close"]')!.click();
    return {
      views,
      sameTarget: !!circle && circle.target === box?.target,
      after: { views: document.querySelectorAll('.wb-view').length, inert: [...document.body.children].filter((c) => (c as HTMLElement).inert).length, open: document.documentElement.classList.contains('wb-open') },
    };
  });
  expect(r.views).toBe(1);
  expect(r.sameTarget).toBe(true);
  expect(r.after).toEqual({ views: 0, inert: 0, open: false });
});

/** Reloads with the slow-storage stand-in in place. */
async function reloadSlow(page: Page) {
  await page.reload();
  if (!(await page.evaluate(() => !!(window as unknown as { __slowIdb?: boolean }).__slowIdb))) throw new Error('the slow IndexedDB stand-in was not installed');
}

/** Makes IndexedDB answer `delayMs` late (Infinity: never), by delaying the open request's events. */
async function slowIndexedDb(page: Page, delayMs: number) {
  await page.addInitScript((delay: number) => {
    (window as unknown as { __slowIdb: boolean }).__slowIdb = true;
    // On the prototype: WebKit may collect the `indexedDB` wrapper object and hand out a fresh one without an
    // expando `open`, so patching the instance only works some of the time there.
    const proto = IDBFactory.prototype;
    const realOpen = proto.open;
    const real = (name: string, version?: number) => realOpen.call(indexedDB, name, version);
    proto.open = function (name: string, version?: number) {
      const fake: Record<string, unknown> = { result: undefined, error: null };
      if (delay === -1) return fake as unknown as IDBOpenDBRequest;
      const req = real(name, version);
      for (const ev of ['upgradeneeded', 'success', 'error', 'blocked'] as const) {
        req.addEventListener(ev, () => {
          if (ev === 'upgradeneeded') return void (fake.onupgradeneeded as (() => void) | undefined)?.call(req);
          setTimeout(() => {
            fake.result = ev === 'success' ? req.result : undefined;
            fake.error = req.error;
            (fake[`on${ev}`] as (() => void) | undefined)?.call(req);
          }, delay);
        });
      }
      Object.defineProperty(fake, 'result', { get: () => req.result });
      return fake as unknown as IDBOpenDBRequest;
    } as typeof proto.open;
  }, delayMs);
}

test('a hung IndexedDB: the board opens at once, says saving is unavailable, and still works', async ({ page }) => {
  await slowIndexedDb(page, -1);
  const t0 = Date.now();
  await reloadSlow(page);
  await page.waitForSelector('html[data-wb-ready]', { state: 'attached' });
  // Was ~8.4 s (the store's 8 s timeout); now the open waits only a short grace period.
  expect(Date.now() - t0).toBeLessThan(3000);
  await expect(page.locator('.wb-notice')).toBeVisible();
  await expect(page.locator('.wb-notice')).toContainText('Saving unavailable');
  await page.evaluate(() => (window as any).wb.addText('works offline-ish'));
  expect(await count(page)).toBe(1);
  // When the store gives up, the notice says why and stays.
  await page.evaluate(() => (window as any).wb.whenLoaded());
  await expect(page.locator('.wb-notice')).toContainText('IndexedDB did not respond');
  expect(await count(page)).toBe(1);
});

test('a slow IndexedDB: the saved board replaces the empty one when storage answers, keeping what was added meanwhile', async ({ page }) => {
  await page.evaluate(async () => {
    const wb = (window as any).wb;
    await wb.newBoard('Slow');
    wb.addText('saved before');
    await wb.flush();
  });
  await slowIndexedDb(page, 2500);
  await reloadSlow(page);
  await page.waitForSelector('html[data-wb-ready]', { state: 'attached' });
  await expect(page.locator('.wb-notice')).toBeVisible();
  expect(await count(page)).toBe(0);
  await page.evaluate(() => (window as any).wb.addText('added meanwhile'));
  await page.evaluate(() => (window as any).wb.whenLoaded());
  await expect(page.locator('.wb-notice')).toBeHidden();
  const texts = () => page.evaluate(() => (window as any).wb.objects().map((o: any) => o.text).sort());
  expect(await page.evaluate(() => (window as any).wb.title)).toBe('Slow');
  expect(await texts()).toEqual(['added meanwhile', 'saved before']);
  await page.evaluate(() => (window as any).wb.flush());
  // Both were saved: they come back on the next open (storage still slow, so wait for it).
  await page.reload();
  await page.waitForSelector('html[data-wb-ready]', { state: 'attached' });
  await page.evaluate(() => (window as any).wb.whenLoaded());
  expect(await texts()).toEqual(['added meanwhile', 'saved before']);
});

test('every failed save is reported, and the notice clears once a save works', async ({ page }) => {
  const statuses = await page.evaluate(async () => {
    const wb = (window as any).wb;
    await wb.newBoard('Quota');
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () {
      throw new DOMException('disk full', 'QuotaExceededError');
    };
    const seen: string[] = [];
    const statusEl = document.querySelector('.wb-status')!;
    for (const t of ['one', 'two', 'three']) {
      statusEl.textContent = '';
      wb.addText(t);
      await wb.flush();
      seen.push(statusEl.textContent ?? '');
    }
    const noticeWhileFailing = !document.querySelector<HTMLElement>('.wb-notice')!.hidden;
    IDBObjectStore.prototype.put = put;
    wb.addText('four');
    await wb.flush();
    return { seen, noticeWhileFailing, noticeAfter: !document.querySelector<HTMLElement>('.wb-notice')!.hidden };
  });
  expect(statuses.seen).toHaveLength(3);
  for (const s of statuses.seen) expect(s).toMatch(/disk full/);
  expect(statuses.noticeWhileFailing).toBe(true);
  expect(statuses.noticeAfter).toBe(false);
});

test('scale grows a group about its centre in one undo step; strike marks and right triangles draw', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const wb = (window as any).wb;
    await wb.newBoard('Shapes');
    const t = wb.addText('scale me', { at: { x: 0, y: 0 }, size: 30 });
    const m = wb.addMath('x^2', { at: { x: 0, y: 60 }, size: 36 });
    const s = wb.addStroke([0, 140, 100, 160]);
    const g = wb.group([t, m, s]);
    await wb.ready();
    const before = wb.bounds(g);
    wb.scale(g, 2);
    await wb.ready();
    const after = wb.bounds(g);
    wb.undo();
    const undone = wb.bounds(g);
    const tri = wb.addShape('triangle', { at: { x: 400, y: 0 }, w: 200, h: 160, right: true });
    const strike = wb.mark(t, 'strike');
    wb.renderNow(true);
    return { before, after, undone, triRight: wb.get(tri).right, strike: wb.get(strike).style, strikeBounds: !!wb.bounds(strike) };
  });
  const cx = (b: any) => b.x + b.w / 2;
  // Text is re-measured at the new size, so it's close to (not exactly) twice as wide.
  expect(r.after.w / r.before.w).toBeGreaterThan(1.9);
  expect(r.after.w / r.before.w).toBeLessThan(2.1);
  expect(r.after.h / r.before.h).toBeGreaterThan(1.9);
  expect(r.after.h / r.before.h).toBeLessThan(2.1);
  expect(Math.abs(cx(r.after) - cx(r.before))).toBeLessThan(r.before.w * 0.05);
  expect(r.undone).toEqual(r.before);
  expect(r.triRight).toBe(true);
  expect(r.strike).toBe('strike');
  expect(r.strikeBounds).toBe(true);
});



test('step by step, like a person at a board: dictation, "next one", follow-up working, filler ignored', async ({ page }) => {
  test.setTimeout(90_000);
  const r = await page.evaluate(async () => {
    (window as any).wb.destroy();
    document.getElementById('board')!.remove();
    const mod = await import('/src/whiteboard/open.ts' as string);
    await mod.openWhiteboard({ voiceSupported: false, toast: () => undefined, listen: () => () => undefined });
    const wb = mod.currentBoard();
    await wb.newBoard('Steps');
    const input = document.querySelector<HTMLInputElement>('.wb-command-input')!;
    const form = document.querySelector<HTMLFormElement>('.wb-command')!;
    // Each command finishes when the board clears its command text.
    const setText = wb.setCommandText.bind(wb);
    let finished: (() => void) | null = null;
    wb.setCommandText = (t: string) => {
      setText(t);
      if (!t) finished?.();
    };
    const say = (t: string) =>
      new Promise<string>((res) => {
        finished = () => res(document.querySelector('.wb-status')!.textContent ?? '');
        input.value = t;
        form.requestSubmit();
      });
    const squash = (s: string) => s.replace(/\\left|\\right|\\,|\s|[{}]/g, '');
    const maths = () => wb.objects().filter((o: any) => o.kind === 'math').map((o: any) => squash(o.tex));
    const texts = () => wb.objects().filter((o: any) => o.kind === 'text').map((o: any) => o.text);

    const out: Record<string, unknown> = {};
    // Dictation: a bare expression is written as it is, with no "= 3x + 3" under it.
    await say('three x plus three');
    out.dictated = { maths: maths(), texts: texts() };
    const firstBottom = (() => {
      const b = wb.bounds(wb.last());
      return b.y + b.h;
    })();
    // Narration that means "new problem".
    out.next = await say("Okay so I'm gonna go to the next one.");
    out.filler = await say('um');
    // A run of instructions, done in order, each working on the line before.
    await say('write 2x + 3 = 11, then subtract 3 from both sides, then divide both sides by 2, then circle it');
    out.equation = maths().slice(1);
    out.notes = texts();
    const eqTop = wb.bounds(wb.objects().find((o: any) => o.kind === 'math' && squash(o.tex).includes('=11'))!.id)!.y;
    out.gap = eqTop - firstBottom;
    out.circled = wb.objects().some((o: any) => o.kind === 'mark' && o.style === 'circle' && squash(wb.get(o.target)?.tex ?? '').includes('x=4'));
    // Checking an answer by plugging it in, then factoring a new expression.
    await say('next one');
    await say('write x^2 - 5x + 6');
    out.factored = await say('factor it');
    out.plugged = await say('plug in x = 2');
    document.querySelector<HTMLButtonElement>('[data-act="close"]')!.click();
    return out;
  });
  expect(r.dictated).toEqual({ maths: ['3x+3'], texts: [] });
  expect(r.next).toBe('Ready for the next one');
  expect(r.filler).toBe('Ready for the next one'); // "um" does nothing, so the status is unchanged
  expect(r.equation).toEqual(['2x+3=11', '2x=8', 'x=4']);
  expect(r.notes).toEqual(['− 3', '÷ 2']);
  expect(r.gap as number).toBeGreaterThan(100);
  expect(r.circled).toBe(true);
  expect(String(r.factored).replace(/\s/g, '')).toMatch(/factored:\(x-2\)\(x-3\)|factored:\(x-3\)\(x-2\)/);
  expect(String(r.plugged)).toMatch(/x = 2: 0$/);
});

test('"factor …" on the board: the word stays a word, and an expression that won\'t factor says why', async ({ page }) => {
  test.setTimeout(90_000);
  const r = await page.evaluate(async () => {
    (window as any).wb.destroy();
    document.getElementById('board')!.remove();
    const mod = await import('/src/whiteboard/open.ts' as string);
    await mod.openWhiteboard({ voiceSupported: false, toast: () => undefined, listen: () => () => undefined });
    const wb = mod.currentBoard();
    await wb.newBoard('Factor');
    const input = document.querySelector<HTMLInputElement>('.wb-command-input')!;
    const form = document.querySelector<HTMLFormElement>('.wb-command')!;
    const setText = wb.setCommandText.bind(wb);
    let finished: (() => void) | null = null;
    wb.setCommandText = (t: string) => {
      setText(t);
      if (!t) finished?.();
    };
    const say = (t: string) =>
      new Promise<string>((res) => {
        finished = () => res(document.querySelector('.wb-status')!.textContent ?? '');
        input.value = t;
        form.requestSubmit();
      });
    const out: Record<string, unknown> = {};
    out.none = await say('factor 10x^2 + 2x + 1');
    out.first = wb.objects().find((o: any) => o.kind === 'math')?.tex;
    out.texts = wb.objects().filter((o: any) => o.kind === 'text').map((o: any) => o.text);
    out.irrational = await say('factor x^2 - 2');
    out.works = await say('factor x^2 - 5x + 6');
    document.querySelector<HTMLButtonElement>('[data-act="close"]')!.click();
    return out;
  });
  expect(r.none).toBe('Doesn’t factor over the real numbers: 10x^2 + 2x + 1 = 0 has no real roots');
  expect(String(r.first)).toMatch(/^\\text\{Factor\}/);
  expect(r.texts).toEqual([r.none]);
  expect(String(r.irrational)).toMatch(/^Doesn’t factor with whole numbers\. Its roots are /);
  expect(String(r.works).replace(/\s/g, '').replace(/−/g, '-')).toMatch(/\(x-2\)\(x-3\)|\(x-3\)\(x-2\)/);
});
