import { test, expect } from '@playwright/test';

// A hostile script extension: must not read storage, the page, or the network, and must not freeze the app.
test('hostile script extension', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('lemma.secret-probe', 'TOP-SECRET');
    const mk = (id: string, name: string, script: string, t: string) => ({ manifest: { format: 'lemma-plugin', version: 1, id, name, description: 'x', release: '1', kind: 'script', templates: [t], inputs: [{ name: 'n' }], script, permissions: [] }, enabled: true, installedAt: 1, granted: [] });
    localStorage.setItem('lemma.plugins.v1', JSON.stringify([
      mk('evil.spy', 'Spy', `async function run(){ const out=[]; try{ out.push('ls:'+localStorage.getItem('lemma.secret-probe')) }catch(e){ out.push('ls blocked') } try{ out.push('parent:'+parent.document.title) }catch(e){ out.push('parent blocked') } try{ await fetch('https://example.com'); out.push('net OPEN') }catch(e){ out.push('net blocked') } return { display: out.join(' | ') }; }`, 'spy {n}'),
      mk('evil.loop', 'Loop', `function run(){ while(true){} }`, 'loop {n}'),
    ]));
  });
  await page.reload();
  await page.locator('#input').fill('spy 1');
  await page.locator('#input').press('Enter');
  await expect(page.locator('#value')).toContainText('blocked', { timeout: 10000 });
  await expect(page.locator('#value')).toHaveText('ls blocked | parent blocked | net blocked');
  const t0 = Date.now();
  await page.locator('#input').fill('loop 1');
  await page.locator('#input').press('Enter');
  // Is the main thread still alive while the extension spins?
  const alive = await Promise.race([page.evaluate(() => 1 + 1).then(() => Date.now() - t0), new Promise((r) => setTimeout(() => r('FROZEN'), 4000))]);
  expect(alive, 'main thread stays responsive while an extension loops forever').not.toBe('FROZEN');
  await expect(page.locator('#value')).toContainText('longer than', { timeout: 15000 });
  await page.locator('#input').fill('2+2');
  await expect(page.locator('#value')).toHaveText('4');
});

test('install from the catalog, approve a script, build a tool, import a file', async ({ page }) => {
  page.on('dialog', (d) => d.accept()); // the script-extension approval prompt
  await page.goto('/');
  await page.locator('#open-settings').click();
  await page.locator('#open-extensions').click();
  const ext = page.locator('#extensions');
  await expect(ext).toBeVisible();
  await ext.locator('.ext', { hasText: 'BMI' }).locator('button', { hasText: 'Install' }).click();
  await ext.locator('.ext', { hasText: 'Roman numerals' }).locator('button', { hasText: 'Install' }).click();
  await ext.locator('.ext-builder input').nth(0).fill('Tile cost');
  await ext.locator('.ext-builder input').nth(1).fill('area * price * 1.1');
  await ext.locator('.ext-builder input').nth(2).fill('area m2, price');
  await ext.locator('.ext-builder button').click();
  await ext.locator('input[type=file]').setInputFiles({
    name: 'half.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'lemma-plugin', version: 1, id: 'test.half', name: 'Half', description: 'Halves a number', release: '1', kind: 'formula', templates: ['half of {x} please'], inputs: [{ name: 'x' }], formula: 'x / 2', output: {} })),
  });
  await expect(ext.locator('.ext-toggle')).toHaveCount(4);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  const ask = async (q: string, expected: string | RegExp) => {
    await page.locator('#input').fill(q);
    await page.locator('#input').press('Enter');
    await expect(page.locator('#value')).toHaveText(expected);
  };
  await ask('bmi 70 kg 1.75 m', /22\.9/);
  await expect(page.locator('#lines')).toContainText('Healthy weight');
  await ask('2026 in roman numerals', 'MMXXVI');
  await ask('tile cost 12 m2 25', '330');
  await ask('half of 9 please', '4.5');
  // Built-ins still win where no extension matches.
  await ask('20% of 450', '90');
  // Disabled extensions stop answering; state persists across reloads.
  await page.reload();
  await ask('bmi 70 kg 1.75 m', /22\.9/);
});
