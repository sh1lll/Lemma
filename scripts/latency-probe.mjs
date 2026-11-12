// Interaction latency: for each action, the browser's Event Timing entry (input → handlers done → next frame
// painted), plus how long until the motion that follows has finished. THROTTLE=4 approximates a mid-range phone.
import { chromium } from '@playwright/test';
const THROTTLE = Number(process.env.THROTTLE ?? 1);
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } }); const p = await ctx.newPage();
await p.addInitScript(() => {
  localStorage.setItem('lemma.settings.v1', JSON.stringify({ warmOnStart: false, showKeypad: true }));
  window.__ev = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__ev.push({ name: e.name, start: e.startTime, wait: e.processingStart - e.startTime, run: e.processingEnd - e.processingStart, total: e.duration }); }).observe({ type: 'event', durationThreshold: 16, buffered: true });
});
const cdp = await ctx.newCDPSession(p); await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
await p.goto('http://localhost:4178/'); await p.locator('#input').waitFor(); await p.waitForTimeout(4000);
const rows = [];
async function m(name, fn, settle = 400) {
  const t0 = await p.evaluate(() => performance.now());
  await fn(); await p.waitForTimeout(settle);
  const r = await p.evaluate((t0) => {
    const ev = window.__ev.filter((e) => e.start >= t0 && /pointerup|click|keydown|keyup|input|pointerdown|keypress/.test(e.name));
    const anims = document.getAnimations().filter((a) => a.playState === 'running' && Number(a.effect?.getComputedTiming().endTime) !== Infinity).length;
    return { n: ev.length, worst: Math.round(Math.max(0, ...ev.map((e) => e.total))), run: Math.round(Math.max(0, ...ev.map((e) => e.run))), anims };
  }, t0);
  rows.push({ action: name, 'input→paint worst ms': r.worst || '<16', 'handler ms': r.run || '<16', events: r.n });
}
const input = p.locator('#input');
await m('type a digit (live preview)', () => input.press('7'));
await m('type 12 chars', () => input.pressSequentially('*8+sqrt(81)', { delay: 30 }));
await m('Enter (arithmetic)', () => input.press('Enter'));
await m('Enter (unit conversion)', async () => { await input.fill('5 km in miles'); await input.press('Enter'); });
await m('Enter (percent)', async () => { await input.fill('18% of 275'); await input.press('Enter'); });
await m('Enter (algebra, warm)', async () => { await input.fill('solve 3x+2=11'); await input.press('Enter'); await p.waitForTimeout(3000); }, 600);
await m('Enter (algebra, 2nd)', async () => { await input.fill('solve 5x-1=9'); await input.press('Enter'); await p.waitForTimeout(1500); }, 600);
await m('Enter (graph)', async () => { await input.fill('graph sin(x)'); await input.press('Enter'); });
await m('keypad button 7', () => p.locator('#keypad button', { hasText: /^7$/ }).first().click());
await m('keypad =', () => p.locator('#keypad button[data-k="act:eq"], #keypad .key.eq').first().click());
await m('copy button', () => p.locator('#copy').click());
await m('pin star', () => p.locator('#history li .pin').first().click({ force: true }));
await m('history item reuse', () => p.locator('#history li .h-out').first().click());
await m('DEG/RAD', () => p.locator('#angle').click());
await m('mode → Scientific', () => p.locator('#modes [data-mode="scientific"]').click());
await m('mode → Basic', () => p.locator('#modes [data-mode="basic"]').click());
await m('open Settings', () => p.locator('#open-settings').click());
await m('close Settings (Esc)', () => p.keyboard.press('Escape'));
await m('open Tools', () => p.locator('#open-study').click());
await m('Tools search typing', () => p.locator('#tool-search').pressSequentially('geo', { delay: 40 }));
await m('open Geometry', () => p.keyboard.press('Enter'), 900);
await m('close tool', () => p.locator('#tool-close').click());
await m('open Whiteboard', async () => { await p.locator('#open-study').click(); await p.locator('.tool-row[data-tool="whiteboard"]').click(); }, 1200);
await m('leave Whiteboard', () => p.locator('.wb-done').click());
await m('steps fold toggle', async () => { await input.fill('solve 2x=8'); await input.press('Enter'); await p.waitForTimeout(1500); await p.locator('.steps-toggle, [data-testid=steps-toggle]').first().click(); });
await m('Recent fold', () => p.locator('#recent-toggle').click());
console.log(`CPU ${THROTTLE}x`); console.table(rows);
// Raw engine compute time for common inputs (no rendering).
console.log(await p.evaluate(async () => {
  const out = {};
  for (const q of ['2+3*4', '17% of 340', '5 km in miles', 'sqrt(2)*pi', '(3/4+5/6)^2', 'monthly payment on $300k at 6.5% for 30 years', 'days until christmas']) {
    const el = document.getElementById('input'); el.value = q; const t = performance.now(); for (let i = 0; i < 50; i++) el.dispatchEvent(new Event('input')); out[q] = +((performance.now() - t) / 50).toFixed(2) + ' ms per keystroke (route+render)';
  }
  return out;
}));
await b.close();
