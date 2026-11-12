import { expect, test } from '@playwright/test';

// Data saved before the app was renamed Lemma opens under the new names: history and settings in localStorage,
// and a whiteboard in IndexedDB. Nothing saved under a new name is overwritten.
test('data saved under the old names is carried over on first start', async ({ page }) => {
  // Put old-style data on this origin before the app runs (a plain file from the same origin, not the app).
  await page.goto('/icon.svg');
  await page.evaluate(async () => {
    localStorage.clear();
    localStorage.setItem('omnimath.settings.v1', JSON.stringify({ warmOnStart: false, digits: 6 }));
    localStorage.setItem('omnimath.history.v1', JSON.stringify([{ id: 'old1', input: '6*7', expression: '6 × 7', display: '42', plain: '42', at: Date.now() }]));
    localStorage.setItem('omnimath:last-board', 'b1');
    await new Promise<void>((ok, no) => {
      const r = indexedDB.open('omnimath-boards', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('boards', { keyPath: 'id' });
      r.onsuccess = () => {
        const tx = r.result.transaction('boards', 'readwrite');
        tx.objectStore('boards').put({ id: 'b1', title: 'From before', objects: [] });
        tx.oncomplete = () => (r.result.close(), ok());
        tx.onerror = () => no(tx.error);
      };
      r.onerror = () => no(r.error);
    });
  });
  await page.goto('/');
  await expect(page.locator('#history li').first()).toContainText('6*7');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('lemma.legacy-moved'))).toBe('1');
  const after = await page.evaluate(async () => {
    const keys = Object.keys(localStorage);
    const board = await new Promise<unknown>((ok) => {
      const r = indexedDB.open('lemma-boards');
      r.onsuccess = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('boards')) return ok(null);
        const g = db.transaction('boards').objectStore('boards').get('b1');
        g.onsuccess = () => (db.close(), ok(g.result));
      };
    });
    const dbs = (await indexedDB.databases?.())?.map((d) => d.name) ?? [];
    return { keys, board, dbs, settings: localStorage.getItem('lemma.settings.v1') };
  });
  expect(after.keys.filter((k) => k.startsWith('omnimath'))).toEqual([]);
  expect(after.keys).toContain('lemma.history.v1');
  expect(after.keys).toContain('lemma:last-board');
  expect(after.settings).toContain('"digits":6');
  expect(after.board).toMatchObject({ title: 'From before' });
  if (after.dbs.length) expect(after.dbs).not.toContain('omnimath-boards');
});
