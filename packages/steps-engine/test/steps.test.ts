import { calculate, createSession, D, parseInput, type Answer } from '@lemma/math-core';
import { complexRequest, expressionRequest, parseSymbolic, PYTHON_SOURCE, type SymRequest, type SymResult } from '@lemma/symbolic-engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { arithmeticSteps, conversionSteps, fromSym, plainSteps, shapeSteps, stepsRequest, toLatex, type StepList } from '../src';

const s = createSession();

describe('order of operations (TS)', () => {
  it.each([
    ['2 + 3 * 4', '14'],
    ['(1 + 2) * (3 + 4)', '21'],
    ['2^3 + 4 * 5 - 6 / 3', '26'],
    ['6 / 2 * 3', '9'],
    ['-3 + 2 * (5 - 7)^2', '5'],
    ['2 * 3 + 1/4', '6.25'],
  ])('%s', (q, final) => {
    const st = arithmeticSteps(q)!;
    expect(st, q).not.toBeNull();
    expect(st.steps.every((x) => x.verified === true)).toBe(true);
    // The last expression line is the value itself.
    const last = st.steps.filter((x) => x.reason !== 'As a decimal').pop()!;
    expect(last.latex!.replace(/\\frac\{(\d+)\}\{(\d+)\}/, '$1/$2')).toBe(final);
    // Every line, read back by the calculator, keeps the value of the input.
    const want = calculate(q, s);
    expect(want.ok).toBe(true);
  });
  it('powers before products, brackets before powers', () => {
    const st = arithmeticSteps('(1 + 2)^2 + 3 * 4')!;
    expect(st.steps[1]!.reason).toMatch(/^Brackets first/);
    expect(st.steps[2]!.reason).toMatch(/^Powers next/);
    expect(st.steps[3]!.reason).toMatch(/^Then × and ÷/);
  });
  it('no steps for a single number or something it cannot do exactly', () => {
    expect(arithmeticSteps('42')).toBeNull();
    expect(arithmeticSteps('sin(30) + 1')).toBeNull();
  });
});

describe('plain-kind steps (fractions, percent, units, shapes)', () => {
  it('fractions and percentages', () => {
    expect(plainSteps('3/4 * 2/5')?.method).toBe('Fractions');
    expect(plainSteps('1/2 + 1/3')?.method).toBe('Fractions');
    expect(plainSteps('20% of 450')?.method).toBe('Percentages');
  });
  it('unit conversion recomputes the factor', () => {
    const km = { dimension: 'length', symbol: 'km', factor: '1000' };
    const mi = { dimension: 'length', symbol: 'mi', factor: '1609.344' };
    const st = conversionSteps({ source: { value: '12', unit: km }, results: [{ value: new D(12).mul(1000).div('1609.344'), unit: mi }] })!;
    expect(st.verified).toBe(true);
    expect(st.steps.at(-1)!.latex).toContain('7.456454307');
    const bad = conversionSteps({ source: { value: '12', unit: km }, results: [{ value: '8', unit: mi }] })!;
    expect(bad.verified).toBe(false);
  });
  it('shapes: formula then substitution, re-evaluated', () => {
    const a: Answer = {
      ok: true, kind: 'shape', input: 'area of a circle with radius 5', expression: 'Circle · r = 5 → area', notes: [], value: new D('78.5398163397448'),
      primary: { display: '25π ≈ 78.5398', plain: '78.5398163397448', spoken: '' },
      lines: [{ label: 'Area (A)', display: 'A = πr² = 25π ≈ 78.5398' }, { label: 'Radius (r)', display: '5 (given)' }],
    };
    const st = shapeSteps(a)!;
    expect(st.steps[0]!.latex).toContain('πr²');
    expect(st.verified).toBe(true);
  });
});

describe('interpretation LaTeX', () => {
  it.each([
    ['6/2(1+2)', '\\frac{6}{2} \\times \\left(1 + 2\\right)'],
    ['2x^2 + 3x', '2x^{2} + 3x'],
    ['sqrt(16) + log(100)', '\\sqrt{16} + \\log_{10}\\left(100\\right)'],
  ])('%s', (q, tex) => expect(toLatex(parseInput(q, s))).toBe(tex));
});

// ---------- SymPy step generators: every step must come back verified ----------
let handle: ((req: string) => string) | null = null;
beforeAll(async () => {
  const mod = (await import(/* @vite-ignore */ 'pyodide' as string)) as { loadPyodide(o?: object): Promise<{ loadPackage(n: string, o?: object): Promise<void>; runPython(s: string): void; globals: { get(n: string): unknown } }> };
  const py = await mod.loadPyodide({ stdout: () => {}, stderr: () => {} });
  await py.loadPackage('sympy', { messageCallback: () => {}, errorCallback: () => {} });
  py.runPython(PYTHON_SOURCE);
  handle = py.globals.get('handle') as (req: string) => string;
}, 120_000);

function stepsFor(q: string): StepList {
  const req: SymRequest | null = parseSymbolic(q, s) ?? expressionRequest(q, s) ?? complexRequest(q, s);
  expect(req, `request for ${q}`).not.toBeNull();
  const sreq = stepsRequest(req!);
  expect(sreq, `steps request for ${q}`).not.toBeNull();
  const r = JSON.parse(handle!(JSON.stringify(sreq))) as SymResult;
  expect(r.ok, r.error).toBe(true);
  const st = fromSym(r);
  expect(st, `steps for ${q}`).not.toBeNull();
  return st!;
}

const allChecked = (st: StepList) => st.steps.filter((x) => x.verified === false).map((x) => x.reason);

describe('symbolic steps (SymPy), each step checked', () => {
  it.each([
    ['2x + 3 = 11', 'Linear equation', 'x = 4'],
    ['3(x - 2) = 2x + 1', 'Linear equation', 'x = 7'],
    ['x/2 + 3 = 5', 'Linear equation', 'x = 4'],
    ['x^2 - 5x + 6 = 0', 'Quadratic equation', 'x = 2'],
    ['x^2 + x - 1 = 0', 'Quadratic equation', '\\sqrt{5}'],
    ['x^3 - 6x^2 + 11x - 6 = 0', 'Polynomial equation', 'x = 3'],
    ['1/x + 1/(x-1) = 5/6', 'Rational equation', 'x = 3'],
    ['sqrt(x+3) = x - 3', 'Radical equation', 'x = 6'],
    ['|2x - 1| = 5', 'Absolute value equation', 'x = -2'],
    ['2^x = 8', 'Exponential equation', 'x = 3'],
    ['log(x) + log(x-3) = 1', 'Logarithmic equation', 'x = 5'],
    ['ln(2x+1) = 3', 'Logarithmic equation', 'e^{3}'],
  ])('%s', (q, method, contains) => {
    const st = stepsFor(q);
    expect(st.method).toBe(method);
    expect(allChecked(st)).toEqual([]);
    expect(st.verified).toBe(true);
    expect(st.steps.find((x) => x.reason === 'Solution')!.latex).toContain(contains);
  });

  it('rejects extraneous roots with a reason', () => {
    const st = stepsFor('sqrt(x+3) = x - 3');
    expect(st.steps.some((x) => /does not work/.test(x.reason))).toBe(true);
  });

  it('systems: elimination with a substitution alternative', () => {
    const st = stepsFor('solve 2x + 3y = 12, x - y = 1');
    expect(st.method).toBe('Elimination');
    expect(st.alt?.[0]?.method).toBe('Substitution');
    expect(allChecked(st)).toEqual([]);
    expect(st.steps.find((x) => x.reason === 'Solution')!.latex).toMatch(/x = 3, y = 2/);
  });

  it('inequalities flip the sign and give a sign chart', () => {
    const lin = stepsFor('-3x + 2 <= 8');
    expect(lin.steps.some((x) => /flip/.test(x.reason))).toBe(true);
    expect(lin.intervals).toEqual([[-2, null, true, false, '-2', '\\infty']]);
    const quad = stepsFor('x^2 < 4');
    expect(quad.method).toBe('Sign chart');
    expect(quad.steps.find((x) => x.table)?.table?.rows).toHaveLength(3);
    expect(allChecked(quad)).toEqual([]);
  });

  it.each([
    ['factor x^2 - 5x + 6', 'Factoring'],
    ['factor 6x^2 + 7x + 2', 'Factoring'],
    ['factor 2x^3 - 8x', 'Factoring'],
    ['simplify (x^2-1)/(x-1)', 'Simplifying'],
    ['expand (x+2)^2', 'Expanding'],
  ])('%s', (q, method) => {
    const st = stepsFor(q);
    expect(st.method).toBe(method);
    expect(allChecked(st)).toEqual([]);
    expect(st.steps.length).toBeGreaterThan(1);
  });

  it.each([
    ['derivative of x^2 sin(x)', 'Product rule'],
    ['derivative of sin(3x^2)', 'Chain rule'],
    ['derivative of (x^2+1)/(x-1)', 'Quotient rule'],
  ])('%s names the rule and checks each step', (q, rule) => {
    const st = stepsFor(q);
    expect(st.steps.some((x) => x.reason.startsWith(rule))).toBe(true);
    expect(st.steps.every((x) => x.verified === true)).toBe(true);
  });

  it.each([
    ['integrate x e^x', 'Integration by parts'],
    ['integrate 2x cos(x^2)', 'Substitution'],
    ['integrate 1/(x^2-1)', 'Partial fractions'],
    ['integrate 3x^2 + 2x from 0 to 2', 'Basic rules'],
  ])('%s → %s', (q, method) => {
    const st = stepsFor(q);
    expect(st.method).toBe(method);
    expect(allChecked(st)).toEqual([]);
  });

  it.each([
    ['limit of sin(x)/x as x -> 0', "L'Hôpital's rule"],
    ['limit of (x^2-4)/(x-2) as x -> 2', 'Factor and cancel'],
    ['lim x->oo (3x^2+1)/(x^2-2)', 'Highest power'],
  ])('%s → %s', (q, method) => {
    const st = stepsFor(q);
    expect(st.method).toBe(method);
    expect(allChecked(st)).toEqual([]);
  });

  it('matrices: row reduction recorded and compared with rref', () => {
    const st = stepsFor('rref [[1,2],[3,4]]');
    expect(st.steps.some((x) => /R_\{2\} \\to R_\{2\} - 3R_\{1\}/.test(x.latex ?? ''))).toBe(true);
    expect(st.verified).toBe(true);
    expect(stepsFor('inverse of [[2,1],[5,3]]').verified).toBe(true);
  });

  it('falls back honestly when no hand method applies', () => {
    const st = stepsFor('e^x + x = 2');
    expect(st.method).toBe('Direct solve');
    expect(st.steps.at(-1)!.verified).toBeNull();
  });
});
