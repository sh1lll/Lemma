import { ask, expect, test, value } from './helpers';

// Shape engine: solve a figure from what is known, with formulas, exact forms, units and a labelled diagram.

test('cylinder back-solve: exact height with units, formulas and a figure', async ({ app }) => {
  await ask(app, 'cylinder volume 500 cm³ radius 4, height?');
  await expect(value(app)).toContainText('125/(4π) ≈ 9.94718');
  await expect(value(app)).toContainText('cm');
  await expect(app.locator('#lines')).toContainText('h = V/(πr²)');
  await expect(app.locator('#lines')).toContainText('Total surface area');
  await expect(app.locator('figure.answer-figure svg')).toBeVisible();
});

test('ambiguous SSA triangle shows both triangles', async ({ app }) => {
  await ask(app, 'triangle a=7, b=9, A=40');
  await expect(value(app)).toContainText(' or ');
  await expect(app.locator('table')).toContainText('Triangle 2');
});

test('polygon from vertices by the shoelace formula', async ({ app }) => {
  await ask(app, 'polygon with vertices (0,0) (4,0) (5,3) (1,4)');
  await expect(value(app)).toHaveText('14.5');
  await expect(app.locator('figure.answer-figure svg polygon').first()).toBeVisible();
});

test("exact triangle, circle equation, and other engines' inputs still route correctly", async ({ app }) => {
  await ask(app, 'equilateral triangle side 5 area');
  await expect(value(app)).toContainText('25√3/4');
  await ask(app, 'circle with center (2,-3) radius 4');
  await expect(value(app)).toContainText('(x − 2)² + (y + 3)² = 16');
  await ask(app, 'square root of 144');
  await expect(value(app)).toHaveText('12');
});
