// The SymPy side of the Full report and of step-by-step limits/integrals, run in Node via Pyodide. Skipped offline.
// Each case was a reported defect: a wrong period, raw SymPy output, or steps contradicting the answer.
import { PYTHON_SOURCE } from '@lemma/symbolic-engine';
import { beforeAll, describe, expect, it } from 'vitest';

type Handle = (req: string) => string;
type Step = { r: string; l: string; v: boolean | null };

describe.skipIf(process.env.LEMMA_OFFLINE === '1')('symbolic reports and steps', () => {
  let h: Handle;
  const call = (req: object) => JSON.parse(h(JSON.stringify(req))) as Record<string, unknown>;
  const items = (req: object) => Object.fromEntries((call(req).items as [string, string, string][]).map(([k, , text]) => [k, text]));

  beforeAll(async () => {
    const mod = (await import('pyodide' as string)) as { loadPyodide(o?: object): Promise<{ loadPackage(n: string, o?: object): Promise<void>; runPython(s: string): unknown; globals: { get(n: string): unknown } }> };
    const quiet = () => {};
    const py = await mod.loadPyodide({ stdout: quiet, stderr: quiet });
    await py.loadPackage('sympy', { messageCallback: quiet, errorCallback: quiet });
    py.runPython(PYTHON_SOURCE);
    h = py.globals.get('handle') as Handle;
  }, 240_000);

  it('reports the fundamental period (sin² has period π, not 2π)', () => {
    const period = (e: string) => items({ op: 'report', what: 'props', exprs: [e], vars: ['x'] }).Period;
    expect(period('sin(x)**2')).toBe('π');
    expect(period('cos(x)**4')).toBe('π');
    expect(period('sin(x)**3')).toBe('2π');
    expect(period('sin(x)*cos(x)')).toBe('π');
    expect(period('sin(x) + cos(2*x)')).toBe('2π');
    expect(period('tan(x)')).toBe('π');
  }, 60_000);

  it('never shows raw SymPy forms in the Limits section', () => {
    const lim = items({ op: 'report', what: 'limits', exprs: ['x**2*sin(x)'], vars: ['x'] });
    expect(Object.values(lim).join(' ')).not.toMatch(/AccumBounds|sign\(|Limit\(/);
    expect(lim['x → ∞']).toBe('no limit (oscillates without bound)');
    expect(items({ op: 'report', what: 'limits', exprs: ['exp(x)'], vars: ['x'] })['x → −∞']).toBe('0');
  }, 60_000);

  it('limit of 1/x at 0: the steps agree with the answer (does not exist)', () => {
    const ans = call({ op: 'limit', exprs: ['1/x'], vars: ['x'], point: '0' });
    expect(ans.text).toBe('Does not exist');
    expect(ans.latex_in).not.toContain('0^+');
    const steps = call({ op: 'steps', task: 'limit', exprs: ['1/x'], vars: ['x'], point: '0' }).steps as Step[];
    expect(steps.at(-1)!.r).toMatch(/does not exist/);
    expect(steps.map((s) => s.l).join(' ')).toContain('-\\infty');
    expect(steps.every((s) => s.v !== false)).toBe(true);
    // A real two-sided limit still goes through its usual method.
    const ok = call({ op: 'steps', task: 'limit', exprs: ['(x**2-9)/(x-3)'], vars: ['x'], point: '3' }).steps as Step[];
    expect(ok.at(-1)!.l).toContain('= 6');
  }, 60_000);

  it('antiderivatives with logs use |u|, in the answer and in the steps', () => {
    expect(call({ op: 'integrate', exprs: ['1/x'], vars: ['x'] }).text).toBe('ln|x| + C');
    expect(call({ op: 'integrate', exprs: ['2*x/(x**2 + 1)'], vars: ['x'] }).text).toBe('ln(x² + 1) + C');
    const steps = call({ op: 'steps', task: 'integrate', exprs: ['1/x'], vars: ['x'] }).steps as Step[];
    expect(steps.at(-1)!.l).toContain('\\left|');
  }, 60_000);
});
