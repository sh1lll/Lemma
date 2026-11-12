import { type Page } from '@playwright/test';
import { expect, test } from './helpers';

const mx = (page: Page) => page.locator('.mx');
const kb = (page: Page) => mx(page).locator('.mkb');
const key = (page: Page, name: string) => kb(page).locator('.mkb-pane:not([hidden])').getByRole('button', { name, exact: true });
const result = (page: Page) => mx(page).locator('.mx-result');
const cells = (page: Page, name: string) => mx(page).locator(`.mx-card[data-name="${name}"] .mx-in`);
/** A matrix result as text, row by row: "2 1 | 4 3". */
const shown = (page: Page) =>
  result(page)
    .locator('.mx-mat')
    .first()
    .evaluate((m) => {
      const cols = getComputedStyle(m).gridTemplateColumns.split(' ').length;
      const xs = [...m.querySelectorAll('.mx-cell')].map((c) => c.textContent);
      const rows: string[] = [];
      for (let i = 0; i < xs.length; i += cols) rows.push(xs.slice(i, i + cols).join(' '));
      return rows.join(' | ');
    });

async function openMatrix(page: Page) {
  await page.locator('.modes [data-mode="matrix"]').click();
  await expect(mx(page)).toBeVisible();
}

async function run(page: Page, expr: string) {
  const input = mx(page).getByLabel('Matrix expression');
  await input.fill(expr);
  await input.press('Enter');
  await expect(mx(page).locator('.mx-expr')).toContainText('=');
}

test('create A by grid and B by pasting, then A·B, A⁻¹, det, rref and eigen; store a result; everything persists', async ({ app }) => {
  await openMatrix(app);
  await expect(mx(app).locator('.mx-empty')).toBeVisible();

  // A: 2×2 by typing, Tab between cells.
  await mx(app).getByRole('button', { name: '+ New matrix' }).click();
  await expect(mx(app).locator('.mx-badge')).toHaveText(['A']);
  const a = cells(app, 'A');
  await expect(a).toHaveCount(4);
  await a.first().click();
  for (const v of ['1', '2', '3', '4']) {
    await app.keyboard.type(v);
    await app.keyboard.press('Tab');
  }
  await expect(a.nth(3)).toHaveValue('4');

  // B: pasted from a spreadsheet (tab-separated rows).
  await mx(app).getByRole('button', { name: '+ New matrix' }).click();
  const b = cells(app, 'B');
  await b.first().evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '0\t1\n1\t0\n');
    // Firefox ignores clipboardData in the constructor, so it's attached afterwards.
    const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: dt });
    el.dispatchEvent(ev);
  });
  await expect(b.nth(1)).toHaveValue('1');
  await expect(b.nth(2)).toHaveValue('1');

  // A·B with the matrix keyboard: A × B ↵
  const input = mx(app).getByLabel('Matrix expression');
  await input.click();
  await key(app, 'Matrix A').click();
  await key(app, 'Times').click();
  await key(app, 'Matrix B').click();
  await expect(input).toHaveValue('A·B');
  await key(app, 'Enter').click();
  expect(await shown(app)).toBe('2 1 | 4 3');

  // A⁻¹ (exact fractions), then decimals.
  await key(app, 'Matrix A').click();
  await key(app, 'Inverse').click();
  await key(app, 'Enter').click();
  expect(await shown(app)).toBe('−2 1 | 3/2 −1/2');
  await mx(app).getByRole('button', { name: 'Switch fractions and decimals' }).click();
  expect(await shown(app)).toBe('−2 1 | 1.5 −0.5');
  await mx(app).getByRole('button', { name: 'Switch fractions and decimals' }).click();

  // Store the inverse as C.
  await mx(app).getByRole('button', { name: 'Store the result as a new matrix' }).click();
  await expect(mx(app).locator('.mx-badge')).toHaveText(['A', 'B', 'C']);
  await expect(cells(app, 'C').nth(2)).toHaveValue('3/2');

  // det from the strip, A·C = I.
  await key(app, 'Determinant').click();
  await key(app, 'Matrix A').click();
  await expect(input).toHaveValue('det(A)');
  await key(app, 'Enter').click();
  await expect(result(app)).toHaveText('−2');
  await run(app, 'A·C');
  expect(await shown(app)).toBe('1 0 | 0 1');

  await run(app, 'rref([[1, 2, 3], [4, 5, 6], [7, 8, 9]])');
  expect(await shown(app)).toBe('1 0 −1 | 0 1 2 | 0 0 0');
  await run(app, 'eigenvalues([[2, 0, 0], [0, 3, 4], [0, 4, 9]])');
  await expect(result(app).locator('.mx-part')).toHaveText(['λ₁11', 'λ₂2', 'λ₃1']);
  await run(app, 'eigenvectors(B)');
  await expect(result(app)).toContainText('λ₁ = 1');
  await expect(result(app)).toContainText('λ₂ = −1');
  await run(app, 'A^T + 2B');
  expect(await shown(app)).toBe('1 5 | 4 4');
  await run(app, 'lu(A)');
  await expect(result(app).locator('.mx-part-label')).toHaveText(['P', 'L', 'U']);

  // Mistakes are explained.
  await input.fill('A + [[1, 2, 3]]');
  await input.press('Enter');
  await expect(result(app)).toContainText("Can't add a 1×3 matrix to a 2×2 one");

  // Results can be reused from the list.
  await mx(app).locator('.mx-h', { hasText: 'det(A)' }).click();
  await expect(input).toHaveValue('det(A)');

  // Reload: the mode and the matrices are still there.
  await app.waitForTimeout(400);
  await app.reload();
  await expect(app.locator('.modes [data-mode="matrix"]')).toHaveAttribute('aria-checked', 'true');
  await expect(mx(app).locator('.mx-badge')).toHaveText(['A', 'B', 'C']);
  await expect(cells(app, 'A').nth(3)).toHaveValue('4');
  await run(app, 'det(C)');
  await expect(result(app)).toHaveText('−1/2');
});

test('resize a matrix, bad entries are marked, and delete', async ({ app }) => {
  await openMatrix(app);
  await mx(app).getByRole('button', { name: '+ New matrix' }).click();
  await mx(app).getByLabel('Rows of A').selectOption('3');
  await mx(app).getByLabel('Columns of A').selectOption('1');
  await expect(cells(app, 'A')).toHaveCount(3);
  const first = cells(app, 'A').first();
  await first.fill('sqrt(4)');
  await expect(first).not.toHaveClass(/bad/);
  await first.fill('abc');
  await expect(first).toHaveClass(/bad/);
  await first.fill('1/2');
  await run(app, 'A^T A');
  await expect(result(app)).toHaveText('1/4');
  await mx(app).getByRole('button', { name: 'Delete matrix A' }).click();
  await expect(mx(app).locator('.mx-card')).toHaveCount(0);
});

test('matrix mode fits a 360px screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.addInitScript(() => localStorage.setItem('lemma.settings.v1', JSON.stringify({ calcMode: 'matrix', warmOnStart: false, textSize: 'xl' })));
  await page.goto('/');
  await expect(page.locator('.mx .mkb')).toBeVisible();
  await page.locator('.mx').getByRole('button', { name: '+ New matrix' }).click();
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(1);
});
