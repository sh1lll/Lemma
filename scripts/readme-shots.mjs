// Screenshots for the README, from the production build. Start `npm run preview` first, then:
//   node scripts/readme-shots.mjs            (writes docs/images/*.png)
import { existsSync, mkdirSync } from 'node:fs';
import { chromium, devices } from '@playwright/test';

const BASE = process.env.BASE ?? 'http://localhost:4178';
const OUT = 'docs/images';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

async function page({ dark = false, phone = false } = {}) {
  const ctx = await browser.newContext({
    ...(phone ? devices['iPhone 14'] : { viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2 }),
    colorScheme: dark ? 'dark' : 'light',
    reducedMotion: 'reduce',
  });
  const p = await ctx.newPage();
  await p.addInitScript(() => localStorage.setItem('lemma.settings.v1', JSON.stringify({ warmOnStart: false })));
  await p.goto(BASE);
  await p.locator('#input').waitFor();
  return p;
}

async function ask(p, q, wait = 1500) {
  await p.locator('#input').fill(q);
  await p.locator('#input').press('Enter');
  await p.locator('#history li').first().filter({ hasText: q.slice(0, 16) }).waitFor({ timeout: 90_000 });
  await p.waitForTimeout(wait);
}

// column: crop to the app's centred column (the page leaves wide margins on a desktop window).
const shot = async (p, name, column = false) => {
  await p.mouse.move(0, 0);
  await p.screenshot({ path: `${OUT}/${name}.png`, ...(column ? { clip: { x: 290, y: 0, width: 700, height: 820 } } : {}) });
  console.log('wrote', name);
};

// The calculator: one plain-language question, the answer with its working.
for (const dark of [false, true]) {
  const p = await page({ dark });
  await ask(p, 'monthly payment on $300k at 6.5% for 30 years');
  await shot(p, dark ? 'calculator-dark' : 'calculator-light', true);
  await p.context().close();
}

// Worked steps from the algebra engine.
{
  const p = await page();
  await ask(p, 'solve x^2 - 5x + 6 = 0', 500);
  await p.locator('#value').filter({ hasText: 'x = 2' }).waitFor({ timeout: 120_000 });
  await p.waitForTimeout(1000);
  // Steps may already be open (the default in line-by-line mode); clicking then would fold them.
  const toggle = p.getByTestId('show-steps');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await p.locator('[data-testid="steps"]:visible .step-math .katex').first().waitFor({ timeout: 60_000 });
  await p.waitForTimeout(800);
  await shot(p, 'steps', true);
  await p.context().close();
}

// Graphing.
{
  const p = await page({ dark: true });
  await ask(p, 'graph sin(x) and x^2/4', 2500);
  await shot(p, 'graph', true);
  await p.context().close();
}

// Photo solve: a worksheet photo, every problem read and solved.
{
  const p = await page();
  await p.locator('#attach').click();
  await p.getByTestId('snap-file').setInputFiles('e2e/fixtures/worksheet-photo.png');
  await p.waitForFunction(() => {
    const cs = [...document.querySelectorAll('[data-testid="snap-card"]')];
    return cs.length > 0 && cs.every((c) => c.getAttribute('data-state') !== 'solving');
  }, null, { timeout: 180_000 });
  await p.waitForTimeout(800);
  await shot(p, 'photo-solve');
  await p.context().close();
}

// On a phone.
{
  const p = await page({ phone: true });
  await ask(p, '18% tip on $64.50 split 3 ways');
  await shot(p, 'phone');
  await p.context().close();
}

await browser.close();

// The desktop quick calculator, from the packaged Mac app's self-test (skipped when there's no Mac build).
const mac = `apps/desktop/release/mac${process.arch === 'arm64' ? '-arm64' : ''}/Lemma.app/Contents/MacOS/Lemma`;
if (process.platform === 'darwin' && existsSync(mac)) {
  const { execFileSync } = await import('node:child_process');
  execFileSync(mac, [], { env: { ...process.env, LEMMA_SMOKE: '1', LEMMA_SMOKE_SHOT: `${OUT}/overlay.png` }, stdio: 'ignore', timeout: 180_000 });
  console.log('wrote overlay');
}
