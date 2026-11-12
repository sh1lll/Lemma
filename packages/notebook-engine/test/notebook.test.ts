import { calculate, commit, type Session } from '@lemma/math-core';
import { describe, expect, it } from 'vitest';
import { evaluateNotebook, newNotebook, notebookToMarkdown, parseNotebook, parseTable, serializeNotebook, type Notebook, type RunResult, type Runner } from '../src';

/** Test runner: the real calculator, plus canned answers standing in for other engines. */
const CANNED: Record<string, RunResult> = {
  'derivative of f(x)': { kind: 'answer', input: '', display: '2*x + 3', symbolic: '2*x + 3' },
  'integrate x^2 from 0 to 3': { kind: 'answer', input: '', display: '9', value: '9', symbolic: '9' },
  'integrate 1/x': { kind: 'answer', input: '', display: 'ln(x) + C', symbolic: 'ln(x) + C' },
  'graph f(x), df(x)': { kind: 'graph', input: '', graph: 'graph f(x), df(x)' },
};
const run: Runner = async (q: string, s: Session) => {
  const canned = CANNED[q];
  if (canned) {
    if (canned.value) s.ans = (calculate(canned.value, s) as unknown as { value: never }).value;
    return canned;
  }
  if (/^mean of /.test(q)) {
    const xs = q.slice(8).split(',').map(Number);
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return { kind: 'answer', input: q, display: String(m), value: String(m) };
  }
  const r = calculate(q, s);
  if (!r.ok) return { kind: 'error', input: q, error: r.error.message };
  commit(s, r);
  return { kind: 'value', input: q, display: r.formatted.display, value: r.value.toString() };
};

const nb = (...sources: (string | { data: string } | { text: string })[]): Notebook => ({
  ...newNotebook('Test'),
  cells: sources.map((src, i) =>
    typeof src === 'string' ? { id: `c${i}`, type: 'math', source: src } : 'data' in src ? { id: `c${i}`, type: 'data', source: src.data } : { id: `c${i}`, type: 'text', source: src.text },
  ),
});
const shown = (r: Awaited<ReturnType<typeof evaluateNotebook>>, id: string) => r.outputs.get(id)!.map((o) => o.display ?? o.error);

describe('notebook evaluation', () => {
  it('shares variables and formulas down the page', async () => {
    const r = await evaluateNotebook(nb('rate = 0.05\nyears = 10', 'f(x) = x^2 + 3x', 'f(2) * (1 + rate)^years'), run);
    expect(shown(r, 'c2')).toEqual(['16.2889462678']);
    expect(r.bindings.map((b) => b.name)).toEqual(['rate', 'years', 'f']);
  });

  it('later cells see changes in earlier ones (no stale state)', async () => {
    const a = await evaluateNotebook(nb('x = 2', 'x^3'), run);
    const b = await evaluateNotebook(nb('x = 3', 'x^3'), run);
    expect(shown(a, 'c1')).toEqual(['8']);
    expect(shown(b, 'c1')).toEqual(['27']);
  });

  it('binds any engine’s result: values and functions (cross-engine workflow)', async () => {
    const r = await evaluateNotebook(nb('f(x) = x^2 + 3x', 'df(x) = derivative of f(x)', 'df(-1.5)', 'area = integrate x^2 from 0 to 3', 'area / 3', 'F(x) = integrate 1/x', 'F(e)', 'graph f(x), df(x)'), run);
    expect(shown(r, 'c2')).toEqual(['0']);
    expect(shown(r, 'c4')).toEqual(['3']);
    expect(shown(r, 'c6')).toEqual(['1']);
    expect(r.outputs.get('c1')![0]!.binding).toEqual({ name: 'df', kind: 'function', value: 'df(x) = 2*x + 3' });
    expect(r.outputs.get('c7')![0]!.graph).toBe('graph f(x), df(x)');
  });

  it('only calculator lines define names', async () => {
    const solveRun: Runner = async (q, sess) => (/^solve /.test(q) ? { kind: 'answer', input: q, display: '-3/2' } : run(q, sess));
    const r = await evaluateNotebook(nb('f(x) = 2x + 3', 'solve f(x) = 0', 'f(1)'), solveRun);
    expect(r.outputs.get('c1')![0]!.binding).toBeUndefined();
    expect(shown(r, 'c2')).toEqual(['5']);
  });

  it('lines that use a name still being computed wait instead of misreading it', async () => {
    const slow: Runner = async (q, sess) => (/^derivative/.test(q) ? { kind: 'pending', input: q, display: 'Loading…' } : run(q, sess));
    const r = await evaluateNotebook(nb('f(x) = x^2', 'df(x) = derivative of f(x)', 'graph f(x), df(x)', '2 + 2'), slow);
    expect(r.outputs.get('c2')![0]).toMatchObject({ kind: 'pending', display: 'Waiting for df…' });
    expect(shown(r, 'c3')).toEqual(['4']);
  });

  it('data columns are usable by name', async () => {
    const r = await evaluateNotebook(nb({ data: 'name,height (cm),weight\nAna,160,55\nBo,170,72\nCy,180,80' }, 'mean of height_cm'), run);
    expect(shown(r, 'c1')).toEqual(['170']);
    expect(r.outputs.get('c0')![0]!.notes![1]).toMatch(/name/);
  });

  it('reports errors per line without stopping the notebook', async () => {
    const r = await evaluateNotebook(nb('1/0\n2 + 2', 'g(x) = derivative of nothing here'), run);
    expect(shown(r, 'c0')).toEqual(['Division by zero is undefined', '4']);
    expect(r.outputs.get('c1')![0]!.kind).toBe('error');
  });

  it('text cells and comments produce no output', async () => {
    const r = await evaluateNotebook(nb({ text: '# Notes' }, '# a comment\n1 + 1'), run);
    expect(r.outputs.get('c0')).toEqual([]);
    expect(shown(r, 'c1')).toEqual(['2']);
  });
});

describe('data parsing', () => {
  it.each([
    ['a,b\n1,2\n3,4', ['a_col', 'b_col'], [1, 3]],
    ['x\ty\n1\t2\n3\t4', ['x_col', 'y_col'], [1, 3]],
    ['1 2\n3 4', ['col1', 'col2'], [1, 3]],
    ['price;qty\n"1,200";3\n$5;4', ['price', 'qty'], [1200, 5]],
  ])('%j', (text, cols, first) => {
    const t = parseTable(text);
    expect(t.columns).toEqual(cols);
    expect(t.numeric.get(cols[0]!)).toEqual(first);
  });

  it('handles quoted CSV, percentages and blanks', () => {
    const t = parseTable('label,share\n"a, b",10%\nc,\nd,30%');
    expect(t.rows[0]).toEqual(['a, b', '10%']);
    expect(t.numeric.get('share')).toEqual([0.1, 0.3]);
    expect(t.numeric.has('label')).toBe(false);
  });
});

describe('import / export', () => {
  it('round-trips and rejects malformed files', () => {
    const n = nb('x = 1', { text: 'hello' });
    const back = parseNotebook(serializeNotebook(n));
    expect(back.cells.map((c) => [c.type, c.source])).toEqual([['math', 'x = 1'], ['text', 'hello']]);
    expect(() => parseNotebook('{"version":2}')).toThrow();
    expect(() => parseNotebook('not json')).toThrow();
    expect(() => parseNotebook('{"version":1,"cells":[{"type":"script","source":"x"}]}')).toThrow();
  });

  it('exports markdown with results', async () => {
    const n = nb({ text: 'Intro' }, 'x = 2\nx^2');
    const r = await evaluateNotebook(n, run);
    const md = notebookToMarkdown(n, r.outputs);
    expect(md).toContain('# Test');
    expect(md).toContain('→ **4**');
  });
});

describe('data columns named like functions', () => {
  it('"max of max" and "sum(price)" keep the function and substitute only the column', async () => {
    const seen: string[] = [];
    const recorder: Runner = async (query) => {
      seen.push(query);
      return { kind: 'value', input: query, display: '' };
    };
    const nb = newNotebook();
    nb.cells = [
      { id: 'd', type: 'data', source: 'item,sum,max,price\na,3,9,1.5\nb,4,8,2.5' },
      { id: 'm', type: 'math', source: 'max of max\nsum(price)\ntotal = sum of sum\nmean of price' },
    ];
    await evaluateNotebook(nb, recorder);
    // Before: "9, 8 of 9, 8", "3, 4(1.5, 2.5)", "total = 3, 4 of 3, 4".
    expect(seen).toEqual(['max of 9, 8', 'sum(1.5, 2.5)', 'sum of 3, 4', 'mean of 1.5, 2.5']);
  });
});
