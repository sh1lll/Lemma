/**
 * Symbolic correctness corpus (SymPy in Pyodide, so browser-only): solving, factoring, expanding, derivatives,
 * integrals and limits, each with an answer checked by hand and pinned exactly as the app displays it in #value.
 *
 * Chromium only (the CAS is the same WebAssembly everywhere; e2e/symbolic.spec.ts covers the other engines).
 * Run on its own:  npx playwright test e2e/corpus-symbolic.spec.ts --project=chromium
 * The node-side corpus (arithmetic, units, dates, finance, stats…) is packages/runtime/test/corpus/.
 */
import { ask, expect, test, value } from './helpers';

const CORPUS: Record<string, [input: string, display: string][]> = {
  "solving (linear, quadratic incl. complex roots, cubic, systems)": [
    ["2x + 3 = 11", "x = 4"],
    ["5x - 7 = 3x + 9", "x = 8"],
    ["3(x - 2) = 2x + 4", "x = 10"],
    ["x/4 + 1 = 3", "x = 8"],
    ["0.5x + 1.5 = 4", "x = 5"],
    ["solve 7 - 2x = 15", "x = −4"],
    ["solve 4x + 1 = 4x + 3", "No solution"], // the x terms cancel (was a bare "False")
    ["solve 2(x + 1) = 2x + 2", "All real numbers"], // an identity (was a bare "True")
    ["x^2 - 5x + 6 = 0", "x = 2 or x = 3"],
    ["x^2 - 9 = 0", "x = −3 or x = 3"],
    ["x^2 + 6x + 9 = 0", "x = −3 (double root)"],
    ["2x^2 - 7x + 3 = 0", "x = 1/2 or x = 3"],
    ["x^2 - 2x - 1 = 0", "x = 1 ± √2"],
    ["x^2 = 16", "x = −4 or x = 4"],
    ["solve x^2 + 1 = 0", "x = ±i"],
    ["solve x^2 + 2x + 5 = 0", "x = −1 ± 2i"],
    ["solve x^2 - 4x + 13 = 0", "x = 2 ± 3i"],
    ["solve x^2 + x + 1 = 0", "x = −1/2 ± √3·i/2"],
    ["solve 3x^2 + 2x + 1 = 0", "x = −1/3 ± √2·i/3"],
    ["solve x^3 - 6x^2 + 11x - 6 = 0", "x = 1, 2, 3"],
    ["solve x^3 = 27", "x = 3, −3√3·i/2 − 3/2, 3√3·i/2 − 3/2"],
    ["x^4 - 5x^2 + 4 = 0", "x = −2, −1, 1, 2"],
    ["solve x + y = 10, x - y = 2", "x = 6, y = 4"],
    ["solve 2x + 3y = 12, x - y = 1", "x = 3, y = 2"],
    ["solve x^2 + 4 = 0", "x = ±2i"],
    ["solve x^2 - 6x + 10 = 0", "x = 3 ± i"],
  ],
  "factor & expand": [
    ["factor x^2 - 5x + 6", "(x − 3)(x − 2)"],
    ["factor x^2 - 16", "(x − 4)(x + 4)"],
    ["factor x^3 - 27", "(x − 3)(x² + 3x + 9)"],
    ["factor 2x^2 + 7x + 3", "(x + 3)(2x + 1)"],
    ["factor x^4 - 1", "(x − 1)(x + 1)(x² + 1)"],
    ["factor x^2 + 4x + 4", "(x + 2)²"],
    ["factor 6x^2 - x - 2", "(2x + 1)(3x − 2)"],
    ["factor x^3 + x^2 - x - 1", "(x − 1)(x + 1)²"],
    ["expand (x + 2)^2", "x² + 4x + 4"],
    ["expand (x - 3)(x + 3)", "x² − 9"],
    ["expand (x + 1)^3", "x³ + 3x² + 3x + 1"],
    ["expand (2x + 1)(x - 4)", "2x² − 7x − 4"],
    ["expand (a + b)^2", "a² + 2ab + b²"],
    ["expand (x + y)(x - y)", "x² − y²"],
  ],
  "derivatives": [
    ["derivative of x^3", "3x²"],
    ["derivative of 5x^2 + 3x - 7", "10x + 3"],
    ["derivative of sin(x)", "cos(x)"],
    ["derivative of cos(x)", "−sin(x)"],
    ["derivative of e^x", "e^x"],
    ["derivative of ln(x)", "1/x"],
    ["derivative of x^2 sin(x)", "x²cos(x) + 2x·sin(x)"],
    ["derivative of e^(2x)", "2e^(2x)"],
    ["derivative of sqrt(x)", "1/(2√x)"],
    ["derivative of 1/x", "−1/x²"],
    ["derivative of tan(x)", "1/cos(x)²"],
    ["derivative of (x^2 + 1)^3", "6x(x² + 1)²"],
    ["derivative of x e^x", "(x + 1)·e^x"],
    ["derivative of sin(x)/x", "cos(x)/x − sin(x)/x²"],
    ["second derivative of x^4", "12x²"],
    ["derivative of ln(x^2 + 1)", "2x/(x² + 1)"],
  ],
  "integrals (indefinite & definite)": [
    ["integrate x^2", "x³/3 + C"],
    ["integrate 3x^2 + 2x", "x³ + x² + C"],
    ["integrate sin(x)", "−cos(x) + C"],
    ["integrate cos(x)", "sin(x) + C"],
    ["integrate e^x", "e^x + C"],
    ["integrate 1/x", "ln|x| + C"], // ln|x|, valid on both sides of 0 (was ln(x))
    ["integrate x e^x", "(x − 1)·e^x + C"],
    ["integrate 1/(1 + x^2)", "atan(x) + C"],
    ["integrate sec(x)^2", "tan(x) + C"],
    ["integrate x^2 from 0 to 3", "9"],
    ["integrate x from 1 to 4", "15/2"],
    ["integrate sin(x) from 0 to pi", "2"],
    ["integrate e^x from 0 to 1", "e − 1"],
    ["integrate 1/x from 1 to e", "1"],
    ["integrate 2x + 1 from 0 to 2", "6"],
    ["integrate x^3 from -1 to 1", "0"],
    ["integrate cos(x) from 0 to pi/2", "1"],
    ["integrate tan(x)", "−ln|cos(x)| + C"], // −ln|cos x| (was −ln(cos x))
    ["integrate 1/(x^2 - 1)", "ln|x − 1|/2 − ln|x + 1|/2 + C"],
    ["integrate x^2 e^x", "(x² − 2x + 2)·e^x + C"],
  ],
  "limits": [
    ["limit of (x^2 - 9)/(x - 3) as x approaches 3", "6"],
    ["limit of sin(x)/x as x approaches 0", "1"],
    ["limit of (1 + 1/x)^x as x approaches infinity", "e"],
    ["limit of 1/x as x approaches infinity", "0"],
    ["limit of (3x^2 + 1)/(x^2 - 2) as x approaches infinity", "3"],
    ["limit of (e^x - 1)/x as x approaches 0", "1"],
    ["limit 1/x as x->0", "Does not exist"], // one-sided limits differ; the steps now agree
    ["limit of x^2 as x approaches 2", "4"],
    ["limit of (1 - cos(x))/x^2 as x approaches 0", "1/2"],
    ["limit of 1/x as x approaches 0 from the right", "∞"],
    ["limit of x sin(1/x) as x approaches 0", "0"],
  ],
  "simplify & complex arithmetic": [
    ["simplify (x^2 - 1)/(x - 1)", "x + 1"],
    ["simplify sin(x)^2 + cos(x)^2", "1"],
    ["sqrt(-9)", "3i"],
    ["(2+3i)(1-i)", "5 + i"],
  ],
};

// One page for the whole corpus (Pyodide loads once); each area is a step, and every wrong answer is reported
// (soft assertions) rather than stopping at the first.
test('symbolic corpus', async ({ app }, info) => {
  test.skip(info.project.name !== 'chromium', 'Chromium only');
  const total = Object.values(CORPUS).reduce((n, r) => n + r.length, 0);
  test.setTimeout(240_000 + total * 15_000);
  // The first symbolic question downloads Pyodide + SymPy.
  await ask(app, 'integrate x^2 from 0 to 3');
  await expect(value(app)).toHaveText('9', { timeout: 200_000 });
  for (const [area, rows] of Object.entries(CORPUS)) {
    await test.step(`${area} (${rows.length})`, async () => {
      // Equal answers back to back could pass on the previous #value, so the table must not have any.
      for (let i = 1; i < rows.length; i++) expect(rows[i]![1], `rows ${i - 1} and ${i} of "${area}" share an answer`).not.toBe(rows[i - 1]![1]);
      for (const [q, want] of rows) {
        await ask(app, q);
        await expect.soft(value(app), q).toHaveText(want, { timeout: 20_000 });
      }
    });
  }
});
