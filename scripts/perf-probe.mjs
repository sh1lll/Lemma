// Frame-time probe: runs the main flows in Chromium with the CPU slowed 4x (a mid-range phone) and reports
// dropped frames (>34 ms) and long tasks (>50 ms) per flow. Needs `npm run preview` on :4178.
import { chromium } from '@playwright/test';

const THROTTLE = Number(process.env.THROTTLE ?? 4);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
await ctx.addInitScript(() => {
  localStorage.setItem('lemma.settings.v1', JSON.stringify({ warmOnStart: false }));
  window.__lt = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push({ t: e.startTime, d: e.duration }); }).observe({ type: 'longtask', buffered: true });
  window.__frames = [];
  let last = performance.now();
  const tick = (t) => { window.__frames.push([t, t - last]); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

const t0 = Date.now();
await page.goto('http://localhost:4178/');
await page.locator('#input').waitFor();
const startup = Date.now() - t0;
const nav = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; const p = performance.getEntriesByType('paint'); return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), fcp: Math.round(p.find((x) => x.name === 'first-contentful-paint')?.startTime ?? -1) }; });
await page.waitForTimeout(1500);

const rows = [];
async function flow(name, fn) {
  const start = await page.evaluate(() => performance.now());
  const w0 = Date.now();
  try { await fn(); } catch (e) { rows.push({ name, error: String(e).split('\n')[0] }); return; }
  await page.waitForTimeout(400);
  const r = await page.evaluate((s) => {
    const f = window.__frames.filter(([t]) => t >= s).map(([, d]) => d);
    const lt = window.__lt.filter((e) => e.t >= s);
    return { frames: f.length, dropped: f.filter((d) => d > 34).length, worstFrame: Math.round(Math.max(0, ...f)), longTasks: lt.length, worstTask: Math.round(Math.max(0, ...lt.map((e) => e.d))) };
  }, start);
  rows.push({ name, ms: Date.now() - w0, ...r });
}

const input = page.locator('#input');
await flow('type 2+3*4 live', async () => { await input.click(); await input.pressSequentially('2+3*4-sqrt(16)/2', { delay: 60 }); });
await flow('submit arithmetic', async () => { await input.press('Enter'); await page.locator('#history li').first().waitFor(); });
await flow('type+solve 10x=2', async () => { await input.fill(''); await input.pressSequentially('solve 10x=2', { delay: 40 }); await input.press('Enter'); await page.locator('#history li').first().waitFor({ timeout: 25000 }); });
await flow('fold steps toggle', async () => { const b = page.locator('.steps-toggle, [data-testid=steps-toggle]').first(); if (await b.count()) { await b.click(); await page.waitForTimeout(300); await b.click(); } });
await flow('interp toggle', async () => { const b = page.locator('.interp-toggle').first(); if (await b.count()) { await b.click(); await page.waitForTimeout(300); await b.click(); } });
await flow('graph sin(x)', async () => { await input.fill('graph sin(x)*x'); await input.press('Enter'); await page.locator('#graph-slot svg, #graph-slot canvas').first().waitFor({ timeout: 15000 }); });
await flow('graph pan drag', async () => { const g = page.locator('#graph-slot svg, #graph-slot canvas').first(); const b = await g.boundingBox(); if (b) { await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); for (let i = 0; i < 30; i++) await page.mouse.move(b.x + b.width / 2 - i * 6, b.y + b.height / 2 + i * 2); await page.mouse.up(); } });
await flow('open/close Tools', async () => { await page.locator('#open-study').click(); await page.locator('#study').waitFor(); await page.waitForTimeout(350); await page.keyboard.press('Escape'); });
await flow('open/close Settings', async () => { await page.locator('#open-settings').click(); await page.waitForTimeout(350); await page.keyboard.press('Escape'); });
await flow('open/close Tips', async () => { await page.locator('#open-tips').click(); await page.waitForTimeout(350); await page.keyboard.press('Escape'); });
await flow('20 quick answers', async () => { for (let i = 0; i < 20; i++) { await input.fill(`${i}*${i}+1`); await input.press('Enter'); } await page.waitForTimeout(300); });
await flow('scroll page', async () => { for (let i = 0; i < 15; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(16); } for (let i = 0; i < 15; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(16); } });
await flow('mode switch', async () => { const m = page.locator('#modes [role=radio]'); const n = await m.count(); for (let i = 0; i < n; i++) { await m.nth(i).click(); await page.waitForTimeout(120); } await m.first().click(); });
await flow('keypad toggle', async () => { await page.locator('#toggle-keypad').click(); await page.waitForTimeout(300); await page.locator('#toggle-keypad').click(); });
await flow('symbols panel', async () => { await page.locator('#open-symbols').click(); await page.waitForTimeout(350); await page.keyboard.press('Escape'); });
await flow('whiteboard open', async () => { await page.locator('#open-study').click(); await page.locator('.tool-row[data-tool="whiteboard"]').click(); await page.locator('.wb-done').waitFor({ timeout: 15000 }); await page.waitForTimeout(500); });
await flow('whiteboard draw', async () => { const c = page.locator('canvas').first(); const b = await c.boundingBox(); if (b) { await page.mouse.move(b.x + 200, b.y + 200); await page.mouse.down(); for (let i = 0; i < 60; i++) await page.mouse.move(b.x + 200 + i * 5, b.y + 200 + Math.sin(i / 5) * 40); await page.mouse.up(); } });
await flow('whiteboard close', async () => { await page.locator('.wb-done').click().catch(() => page.keyboard.press('Escape')); await page.waitForTimeout(400); });
await flow('geometry open', async () => { await page.locator('#open-study').click(); await page.locator('.tool-row[data-tool="geometry"]').click(); await page.waitForTimeout(800); await page.locator('#tool-close').click(); });
await flow('physics open', async () => { await page.locator('#open-study').click(); await page.locator('.tool-row[data-tool="physics"]').click(); await page.waitForTimeout(1500); await page.locator('#tool-close').click(); });

console.log(JSON.stringify({ throttle: THROTTLE, startup, nav }, null, 0));
console.table(rows);
if (errors.length) console.log('PAGE ERRORS', errors);
await browser.close();
