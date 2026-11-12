import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';

/**
 * The browser extension (apps/extension), loaded unpacked into Chromium in the new headless mode.
 * Build it first: npm run build -w @lemma/extension.
 *
 * Extensions get page access from activeTab, which only a real user gesture grants (toolbar click,
 * context menu, keyboard command), and Playwright can't produce those. So the test loads a copy of
 * dist/chrome whose manifest adds host_permissions <all_urls> as a stand-in for that grant, and calls
 * the background's own handlers (the ones the menu and command call). The shipped manifest is unchanged.
 */

const DIST = fileURLToPath(new URL('../apps/extension/dist/chrome', import.meta.url));

test.describe.configure({ mode: 'serial' });
test.skip(() => test.info().project.name !== 'chromium', 'chromium project only');
test.skip(!existsSync(join(DIST, 'manifest.json')), 'extension not built: run npm run build -w @lemma/extension');

const PAGES: Record<string, string> = {
  '/calc.html': `<!doctype html><title>calc</title><body style="font:20px sans-serif;padding:40px">
    <p>Work out <span id="q">3 × 4 + 2</span> please.</p>
    <p>LaTeX: <span id="tex">$\\frac{3}{4} \\cdot 8$</span></p>
    <table id="t" border="1"><thead><tr><th>Item</th><th id="price">Price</th></tr></thead>
      <tbody><tr><td>A</td><td>$10.00</td></tr><tr><td>B</td><td>$20.00</td></tr><tr><td>C</td><td>$33.00</td></tr></tbody></table>
  </body>`,
  '/form.html': `<!doctype html><title>form</title><body style="font:20px sans-serif;padding:40px">
    <p>Solve <span id="eq">2x + 3 = 11</span></p>
    <form id="f" action="/submitted" method="get">
      <label>Your answer <input id="ans" name="ans" type="text"></label>
      <button id="go">Submit</button>
    </form>
    <script>
      window.submits = 0; window.inputEvents = 0; window.changeEvents = 0;
      document.getElementById('f').addEventListener('submit', (e) => { window.submits++; e.preventDefault(); });
      document.getElementById('ans').addEventListener('input', () => window.inputEvents++);
      document.getElementById('ans').addEventListener('change', () => window.changeEvents++);
    </script>
  </body>`,
  '/ocr.html': `<!doctype html><title>ocr</title><body style="margin:0;background:#fff">
    <canvas id="c" width="420" height="110" style="position:absolute;left:60px;top:80px"></canvas>
    <script>
      const c = document.getElementById('c'), x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = '#000'; x.font = '56px Arial, Helvetica, sans-serif'; x.textBaseline = 'middle';
      x.fillText('3x + 5 = 20', 24, 56);
    </script>
  </body>`,
};

let server: Server;
let origin = '';
let ctx: BrowserContext;
let sw: Worker;
let extId = '';
let extDir = '';
const pageErrors: string[] = [];

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const body = PAGES[(req.url ?? '/').split('?')[0]!];
    res.writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body ?? 'not found');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  extDir = mkdtempSync(join(tmpdir(), 'lemma-ext-'));
  cpSync(DIST, extDir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(extDir, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['<all_urls>'];
  writeFileSync(join(extDir, 'manifest.json'), JSON.stringify(manifest));

  // channel 'chromium' = full Chromium in the new headless mode (the headless shell can't load extensions).
  ctx = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  extId = new URL(sw.url()).host;
  ctx.on('page', (p) => {
    p.on('pageerror', (e) => pageErrors.push(`${p.url()}: ${e.message}`));
    p.on('console', (m) => {
      if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) pageErrors.push(`${p.url()}: ${m.text()}`);
    });
  });
});

test.afterAll(async () => {
  await ctx?.close();
  server?.close();
  if (extDir) rmSync(extDir, { recursive: true, force: true });
});

test.afterEach(() => {
  expect(pageErrors, 'page errors / CSP violations').toEqual([]);
});

async function openPage(path: string): Promise<{ page: Page; tabId: number }> {
  const page = await ctx.newPage();
  await page.goto(origin + path);
  await page.bringToFront();
  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url: url.replace(/:\d+/, '') + '*' })).find((t) => t.url?.startsWith(url))?.id ?? -1, origin + path);
  expect(tabId).toBeGreaterThan(-1);
  return { page, tabId };
}

async function select(page: Page, selector: string) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel)!;
    const r = document.createRange();
    r.selectNodeContents(el);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(r);
  }, selector);
}

type Act = 'calculate' | 'solve' | 'convert' | 'graph' | 'explain';
async function runAction(action: Act, tabId: number) {
  return sw.evaluate(
    ([a, id]) => (globalThis as unknown as { lemmaTest: { runAction(a: string, id: number): Promise<{ ok: boolean; answer?: { display: string } }> } }).lemmaTest.runAction(a, id),
    [action, tabId] as const,
  );
}

test('manifest asks only for the minimal permissions', () => {
  const m = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));
  expect(m.manifest_version).toBe(3);
  expect([...m.permissions].sort()).toEqual(['activeTab', 'contextMenus', 'scripting', 'sidePanel', 'storage']);
  expect(m.host_permissions).toBeUndefined();
  expect(m.content_scripts).toBeUndefined();
  expect(m.commands['solve-screen'].suggested_key.default).toBe('Alt+Shift+S');
});

test('popup computes live and keeps history', async () => {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/popup.html`);
  const input = page.getByTestId('calc-input');
  await input.fill('3 × 4 + 2');
  await expect(page.getByTestId('calc-answer')).toHaveText('14');
  await input.fill('15% of 80');
  await expect(page.getByTestId('calc-answer')).toHaveText('12');
  await input.press('Enter');
  await expect(page.getByRole('list', { name: 'History' })).toContainText('15% of 80');
  await expect(page.getByRole('button', { name: "Solve what's on screen" })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open side panel' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the full app' })).toHaveAttribute('href', 'https://lemma.app');
  await page.close();
});

test('side panel shows typeset steps for "solve 2x+3=11", tutor style', async () => {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/sidepanel.html`);
  await page.getByTestId('question').fill('solve 2x+3=11');
  await page.getByRole('button', { name: 'Show steps' }).click();
  const out = page.getByTestId('steps-out');
  // Tutor mode: a hint first, no answer yet.
  await expect(out.getByTestId('hint')).toContainText('Subtract 3 from both sides');
  await expect(out.getByTestId('answer')).toBeHidden();
  await out.getByRole('button', { name: 'Show the first step' }).click();
  await expect(out.getByTestId('steps').locator('li')).toHaveCount(1);
  await out.getByRole('button', { name: 'Show all steps' }).click();
  await expect(out.getByTestId('steps').locator('li')).toHaveCount(2);
  await expect(out.locator('.katex').first()).toBeVisible();
  await out.getByTestId('show-answer').click();
  await expect(out.getByTestId('answer').locator('[aria-label="x = 4"]')).toBeVisible();
  // Lesson player from apps/web/src/lesson.
  await page.getByRole('button', { name: 'Watch lesson' }).click();
  await expect(page.locator('.ol-script-player')).toBeVisible();
  await expect(page.locator('.ol-script-player')).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });
  await page.close();
});

test('selection → Calculate shows the answer in an inline bubble; LaTeX and table columns are understood', async () => {
  const { page, tabId } = await openPage('/calc.html');
  await select(page, '#q');
  const r = await runAction('calculate', tabId);
  expect(r.answer?.display).toBe('14');
  const bubble = page.getByTestId('bubble');
  await expect(bubble).toBeVisible();
  await expect(page.getByRole('dialog', { name: /Lemma/ })).toBeVisible();
  await expect(page.getByTestId('bubble-answer')).toHaveText('14');
  await expect(page.getByTestId('bubble-copy')).toBeVisible();
  await expect(page.getByTestId('bubble-open-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bubble).toHaveCount(0);

  await select(page, '#tex');
  expect((await runAction('calculate', tabId)).answer?.display).toBe('6');
  await expect(page.getByTestId('bubble-answer')).toHaveText('6');

  // Selecting the "Price" header means "this column": average 10, 20, 33 → 21.
  await select(page, '#price');
  expect((await runAction('calculate', tabId)).answer?.display).toBe('21');
  await expect(page.getByTestId('bubble-query')).toContainText('average of “Price”');
  await page.close();
});

test('Fill writes into the clicked field, fires input/change, marks it, and never submits', async () => {
  const { page, tabId } = await openPage('/form.html');
  await select(page, '#eq');
  await runAction('calculate', tabId);
  await expect(page.getByTestId('bubble-answer')).toContainText('x');
  // Learning first is on by default: the steps must be opened before filling.
  await expect(page.getByTestId('fill')).toBeDisabled();
  await expect(page.getByTestId('fill-status')).toContainText('Learning first');
  await page.getByTestId('bubble-show-steps').click();
  await expect(page.getByTestId('bubble-step-list').locator('li')).toHaveCount(2);
  await expect(page.getByTestId('fill-status')).toContainText('Click the field');
  // "Choose field" moves the bubble out of the way; clicking the field picks it.
  await page.getByTestId('fill-pick').click();
  await expect(page.getByTestId('bubble')).toBeHidden();
  await page.locator('#ans').click();
  await expect(page.getByTestId('bubble')).toBeVisible();
  await expect(page.getByTestId('fill')).toBeEnabled();
  await expect(page.getByTestId('fill-status')).toContainText('Your answer');
  await page.getByTestId('fill').click();
  await expect(page.locator('#ans')).toHaveValue('4');
  await expect(page.getByTestId('fill-badge')).toHaveCount(1);
  const counts = await page.evaluate(() => ({ s: (window as unknown as { submits: number }).submits, i: (window as unknown as { inputEvents: number }).inputEvents, c: (window as unknown as { changeEvents: number }).changeEvents }));
  expect(counts).toEqual({ s: 0, i: 1, c: 1 });
  expect(new URL(page.url()).pathname).toBe('/form.html');
  await page.close();
});

test('Fill is off on a domain marked as an assessment', async () => {
  await sw.evaluate(() => chrome.storage.sync.set({ assessmentDomains: ['127.0.0.1'] }));
  try {
    const { page, tabId } = await openPage('/form.html');
    await select(page, '#eq');
    await runAction('calculate', tabId);
    await page.getByTestId('bubble-show-steps').click();
    await expect(page.getByTestId('fill-pick')).toBeHidden();
    await expect(page.getByTestId('fill')).toBeDisabled();
    await expect(page.getByTestId('fill-status')).toContainText('Filling is off on 127.0.0.1');
    await expect(page.locator('#ans')).toHaveValue('');
    await page.close();
  } finally {
    await sw.evaluate(() => chrome.storage.sync.set({ assessmentDomains: [] }));
  }
});

test('region capture + on-device OCR yields editable "3x + 5 = 20"', async () => {
  test.setTimeout(120_000);
  // tesseract.js needs its English data: bundled (vendor/eng.traineddata.gz) or fetched once from jsDelivr.
  const bundled = existsSync(join(DIST, 'ocr', 'lang', 'eng.traineddata.gz'));
  if (!bundled) {
    const reachable = await fetch('https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz', { method: 'HEAD' })
      .then((r) => r.ok)
      .catch(() => false);
    test.skip(!reachable, 'OCR language data is not bundled and the jsDelivr CDN is unreachable (offline)');
  }
  const { page, tabId } = await openPage('/ocr.html');
  await sw.evaluate((id) => (globalThis as unknown as { lemmaTest: { startRegion(id: number): Promise<void> } }).lemmaTest.startRegion(id), tabId);
  await expect(page.getByTestId('region-overlay')).toBeVisible();
  const box = (await page.locator('#c').boundingBox())!;
  const panelPage = ctx.waitForEvent('page', (p) => p.url().includes('/sidepanel.html'));
  await page.mouse.move(box.x - 6, box.y - 6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(box.x + box.width + 6, box.y + box.height + 6, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId('region-overlay')).toHaveCount(0);
  // No side panel is open in the test, so the review page opens in a tab.
  const panel = await panelPage;
  const text = panel.getByTestId('ocr-text');
  await expect(text).toBeVisible({ timeout: 90_000 });
  await expect(text).toBeEditable();
  const status = panel.locator('#capture-status');
  await expect(status, 'OCR status').toContainText(/Done|No text|Could not/);
  await expect(status).toContainText('Done');
  expect((await text.inputValue()).replace(/\s+/g, ' ').trim()).toBe('3x + 5 = 20');
  // Editable before solving: change it, then solve with steps.
  await text.fill('3x + 5 = 26');
  await panel.getByRole('button', { name: 'Solve with steps' }).click();
  await panel.getByTestId('steps-out').getByRole('button', { name: 'Show all steps' }).click();
  await panel.getByTestId('show-answer').click();
  await expect(panel.getByTestId('answer').locator('[aria-label="x = 7"]')).toBeVisible();
  await panel.close();
  await page.close();
});
