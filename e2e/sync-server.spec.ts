import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

// Two browser contexts (two "devices") sync through a real, locally started sync server.
// The server must only ever hold ciphertext.

const ROOT = join(import.meta.dirname, '..');
let server: ChildProcess;
let url = '';
let dataDir = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({}, info) => {
  dataDir = mkdtempSync(join(tmpdir(), 'lemmasync-e2e-'));
  const origin = new URL(String(info.project.use.baseURL)).origin;
  const port = 18_700 + (info.workerIndex % 50) + Math.floor(Math.random() * 200);
  server = spawn(process.execPath, [join(ROOT, 'apps/sync-server/src/main.ts')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, ALLOWED_ORIGINS: origin, LOG: '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((resolve, reject) => {
    server.stdout!.on('data', (d: Buffer) => d.toString().includes('listening') && resolve());
    server.once('exit', (code) => reject(new Error(`sync server exited (${code})`)));
  });
  url = `http://localhost:${port}`;
});

test.afterAll(() => {
  server?.kill();
  rmSync(dataDir, { recursive: true, force: true });
});

const PASS = 'purple elephant tuesday 42';

async function device(browser: Browser, baseURL: string) {
  const ctx = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => void d.accept()); // "Start syncing this device's data to it?"
  await page.goto('/');
  await expect(page.locator('#input')).toBeVisible();
  return { ctx, page, errors };
}

async function calc(page: Page, q: string) {
  await page.locator('#input').fill(q);
  await page.locator('#input').press('Enter');
  await expect(page.locator('#history li').first()).toContainText(q);
}

/** Settings → Data → More, where the sync server rows are. */
async function openServerRows(page: Page) {
  await expect(async () => {
    if (!(await page.locator('#settings').isVisible())) await page.locator('#open-settings').click({ timeout: 1000 });
    const more = page.locator('#set-data details.more');
    if (!(await more.evaluate((d) => (d as HTMLDetailsElement).open))) await more.locator('summary').click({ timeout: 1000 });
    await expect(page.locator('#sync-server-url')).toBeVisible({ timeout: 1000 });
  }).toPass();
}

/** Settings → Data → More → Sync server → Sync now (asks for the passphrase the first time in a session). */
async function syncNow(page: Page, opts: { setUrl?: string; passphrase?: boolean } = {}) {
  await openServerRows(page);
  if (opts.setUrl) {
    await page.locator('#sync-server-url').fill(opts.setUrl);
    await page.locator('#sync-server-url').press('Enter');
    await page.locator('#sync-server-every').selectOption('15');
  }
  await expect(page.locator('#sync-server-now')).toBeEnabled();
  await page.locator('#sync-server-now').click();
  if (opts.passphrase) {
    await page.locator('#pp1').fill(PASS);
    await page.locator('#pp-ok').click();
  }
}

test('two devices sync through the server; it stores only ciphertext', async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const a = await device(browser, baseURL!);
  const b = await device(browser, baseURL!);

  await calc(a.page, '12+8');
  await calc(a.page, '1234567*7');
  await syncNow(a.page, { setUrl: url, passphrase: true });
  await expect(a.page.locator('#toast')).toContainText('Synced: Started syncing', { timeout: 20_000 });
  await expect(a.page.locator('#sync-server-status')).toContainText('Last synced');

  await calc(b.page, '98765+1');
  await syncNow(b.page, { setUrl: url, passphrase: true });
  // B received A's entries: the app reloads to show them, then reports what changed.
  await expect(b.page.locator('#toast')).toContainText(/Synced: .*2 history entries added/, { timeout: 20_000 });
  await expect(b.page.locator('#history')).toContainText('1234567');
  await expect(b.page.locator('#history')).toContainText('98765');
  await expect(b.page.locator('#sync-server-url')).toHaveValue(url);

  // A pulls B's entry. Its passphrase is still in memory for this session: no prompt.
  await syncNow(a.page);
  await expect(a.page.locator('#toast')).toContainText(/Synced: .*1 history entry added/, { timeout: 20_000 });
  await expect(a.page.locator('#history')).toContainText('98765');

  // B again: nothing new.
  await syncNow(b.page);
  await expect(b.page.locator('#toast')).toContainText('Synced: Already up to date', { timeout: 20_000 });

  // Zero knowledge: the server's files contain no plaintext.
  const files = readdirSync(dataDir, { recursive: true, withFileTypes: true }).filter((f) => f.isFile());
  expect(files).toHaveLength(1);
  const raw = readFileSync(join(files[0]!.parentPath, files[0]!.name));
  for (const secret of ['1234567', 'history', PASS]) expect(raw.includes(secret), secret).toBe(false);

  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
  await a.ctx.close();
  await b.ctx.close();
});

test('a mistyped passphrase does not touch the real data', async ({ browser, baseURL }) => {
  const c = await device(browser, baseURL!);
  c.page.removeAllListeners('dialog');
  let question = '';
  c.page.on('dialog', (d) => {
    question = d.message();
    void d.dismiss();
  });
  await openServerRows(c.page);
  await c.page.locator('#sync-server-url').fill(url);
  await c.page.locator('#sync-server-url').press('Enter');
  await c.page.locator('#sync-server-now').click();
  await c.page.locator('#pp1').fill(PASS + 'x');
  await c.page.locator('#pp-ok').click();
  await expect(c.page.locator('#sync-server-status')).toContainText('cancelled');
  expect(question).toContain('nothing stored for this passphrase');
  expect(readdirSync(dataDir, { recursive: true, withFileTypes: true }).filter((f) => f.isFile())).toHaveLength(1);
  await c.ctx.close();
});
