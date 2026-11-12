import { readFileSync } from 'node:fs';
import { lex, parse } from '@lemma/math-core';
import { describe, expect, it } from 'vitest';
import { aiSummaryPrompt, findFormulas, summarize, toMarkdown, toSentences, type LectureSummary, type Segment } from '../src';
import { clean } from '../src/text';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), 'utf8');

/** Splits text into Whisper-like segments of ~`size` words, `secs` seconds each. */
function asSegments(text: string, size = 22, secs = 8): Segment[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: Segment[] = [];
  for (let i = 0; i < words.length; i += size) {
    const k = out.length;
    out.push({ text: words.slice(i, i + size).join(' '), start: k * secs, end: (k + 1) * secs });
  }
  return out;
}

const expressions = (s: LectureSummary) => s.formulas.map((f) => f.expression);

function expectParses(s: LectureSummary) {
  for (const f of s.formulas) {
    const sides = /^[a-z]\([a-z]\) = /.test(f.expression) ? [f.expression] : f.expression.split(' = ');
    expect(sides.length, f.expression).toBeGreaterThanOrEqual(1);
    for (const side of sides) expect(() => parse(lex(side)), `${f.expression} ← "${f.spoken}"`).not.toThrow();
  }
}

function expectWellFormedKeyPoints(s: LectureSummary, source: string) {
  expect(s.keyPoints.length).toBeGreaterThanOrEqual(5);
  expect(s.keyPoints.length).toBeLessThanOrEqual(8);
  expect(new Set(s.keyPoints).size).toBe(s.keyPoints.length);
  const lower = source.toLowerCase().replace(/\s+/g, ' ');
  let last = -1;
  for (const k of s.keyPoints) {
    expect(k).not.toMatch(/\b(?:um|uh)\b/i);
    expect(k).toMatch(/^[A-Z]/);
    expect(k).toMatch(/[.!?]$/);
    // In original order: locate a distinctive chunk of each point in the source.
    const probe = k.toLowerCase().replace(/[.!?]$/, '').split(' ').slice(2, 7).join(' ');
    const at = lower.indexOf(probe);
    expect(at, k).toBeGreaterThan(last);
    last = at;
  }
}

describe('summarize: derivatives lecture (timestamped segments)', () => {
  const text = fixture('derivatives');
  const s = summarize(asSegments(text));

  it('titles the lecture from its salient terms', () => {
    expect(s.title).toBe('Derivatives and the chain rule');
    expect(s.wordCount).toBeGreaterThan(600);
  });

  it('turns spoken math into parser-ready expressions with TeX', () => {
    const ex = expressions(s);
    expect(ex).toContain('d/dx(x^2) = 2x');
    expect(ex).toContain('d/dx(x^3) = 3x^2');
    expect(ex).toContain('d/dx(x^n) = n * x^(n - 1)');
    expect(ex).toContain('f(x) = 3x^2 + 5x + 2');
    expect(ex).toContain('g(x) = 4x^3 - 2x');
    expect(ex).toContain('h(x) = (x^2 + 1)^3');
    expect(ex).toContain('d/dx(sin(x)) = cos(x)');
    expect(ex).toContain('d/dx(cos(x)) = -sin(x)');
    const sq = s.formulas.find((f) => f.expression === 'd/dx(x^2) = 2x')!;
    expect(sq.spoken).toBe('the derivative of x squared is two x');
    expect(sq.tex).toBe('\\frac{d}{dx}\\left(x^{2}\\right) = 2x');
    expect(s.formulas.find((f) => f.expression.startsWith('h(x)'))!.tex).toBe('h(x) = \\left(x^{2} + 1\\right)^{3}');
    // "f prime of g of x" has no parser form, so the chain rule statement is not half-extracted.
    expect(ex.some((e) => / = f$/.test(e))).toBe(false);
    expectParses(s);
  });

  it('finds definitions', () => {
    const terms = s.definitions.map((d) => d.term);
    expect(terms).toContain('derivative of a function');
    expect(terms).toContain('composite function');
    expect(s.definitions.find((d) => d.term === 'derivative of a function')!.meaning).toMatch(/^the instantaneous rate of change/);
  });

  it('picks key points in order, without filler', () => {
    expectWellFormedKeyPoints(s, text);
    expect(s.keyPoints.some((k) => /power rule/i.test(k))).toBe(true);
    expect(s.keyPoints.some((k) => /^In summary/.test(k))).toBe(true);
  });

  it('outlines topic shifts with timestamps', () => {
    const headings = s.outline.map((o) => o.heading);
    expect(headings).toEqual(expect.arrayContaining(['Derivatives', 'The power rule', 'The chain rule']));
    const times = s.outline.map((o) => o.at);
    for (const t of times) expect(typeof t).toBe('number');
    expect([...(times as number[])].sort((a, b) => a - b)).toEqual(times);
    expect(s.outline.find((o) => o.heading === 'The chain rule')!.at!).toBeGreaterThan(s.outline.find((o) => o.heading === 'The power rule')!.at!);
  });

  it('collects worked examples with their numbers', () => {
    expect(s.examples.length).toBeGreaterThanOrEqual(3);
    expect(s.examples.some((e) => /g of x equals four x cubed/.test(e) && /twelve x squared/.test(e))).toBe(true);
    expect(s.examples.every((e) => !/^Let's try one more\.$/.test(e))).toBe(true);
  });
});

describe('summarize: Pythagorean theorem lecture', () => {
  const text = fixture('pythagoras');
  const s = summarize(text);

  it('title', () => {
    expect(s.title).toMatch(/Pythagorean theorem/);
  });

  it('formulas, including grouping words and subscripts', () => {
    const ex = expressions(s);
    expect(ex[0]).toBe('a^2 + b^2 = c^2');
    expect(ex).toContain('5^2 + b^2 = 13^2');
    expect(ex).toContain('d = sqrt((x2 - x1)^2 + (y2 - y1)^2)');
    expect(ex).toContain('area = (a + b)^2');
    expect(ex).toContain('area = 1 / 2 * base * height');
    expect(s.formulas.find((f) => f.expression.startsWith('d = sqrt'))!.tex).toBe(
      'd = \\sqrt{\\left(x_{2} - x_{1}\\right)^{2} + \\left(y_{2} - y_{1}\\right)^{2}}',
    );
    expect(s.formulas[0]!.tex).toBe('a^{2} + b^{2} = c^{2}');
    expectParses(s);
  });

  it('definitions from "called", "which we call", "means", "is defined as"', () => {
    const byTerm = new Map(s.definitions.map((d) => [d.term, d.meaning]));
    expect(byTerm.get('legs')).toMatch(/two sides that form the right angle/i);
    expect(byTerm.get('hypotenuse')).toMatch(/longest side/i);
    expect(byTerm.get('pythagorean triple')).toMatch(/three positive whole numbers/);
    expect([...byTerm.keys()].some((t) => t.startsWith('converse'))).toBe(true);
  });

  it('key points and outline', () => {
    expectWellFormedKeyPoints(s, text);
    expect(s.keyPoints.some((k) => /a squared plus b squared equals c squared/.test(k))).toBe(true);
    expect(s.outline.map((o) => o.heading)).toEqual(['The Pythagorean theorem', 'Why the theorem is true', 'The distance formula', 'The converse', 'Special right triangles']);
    expect(s.outline.every((o) => o.at === undefined)).toBe(true);
  });

  it('examples include the ladder problem worked through', () => {
    expect(s.examples.some((e) => /ladder/.test(e) && /b is twelve feet/.test(e))).toBe(true);
  });
});

describe('summarize: intro statistics lecture', () => {
  const text = fixture('statistics');
  const s = summarize(text);

  it('formulas with Greek letters and "all over"', () => {
    const z = s.formulas.find((f) => f.expression === 'z_score = (x - mu) / sigma');
    expect(z).toBeDefined();
    expect(z!.tex).toBe('\\text{z score} = \\frac{x - \\mu}{\\sigma}');
    expect(expressions(s)).toContain('z = (85 - 70) / 10');
    expect(expressions(s).some((e) => e.includes('sqrt()'))).toBe(false);
    expectParses(s);
  });

  it('definitions', () => {
    const byTerm = new Map(s.definitions.map((d) => [d.term, d.meaning]));
    expect(byTerm.get('mean')).toBe('the sum of all the values divided by the number of values');
    expect(byTerm.get('variance')).toBe('the average of the squared deviations from the mean');
    expect(byTerm.get('mode')).toMatch(/^the value that appears most often/);
  });

  it('key points, outline, examples', () => {
    expectWellFormedKeyPoints(s, text);
    expect(s.keyPoints.some((k) => /median is usually a better summary/.test(k))).toBe(true);
    expect(s.outline.map((o) => o.heading)).toEqual(expect.arrayContaining(['The normal distribution', 'Z scores']));
    expect(s.examples.some((e) => /two, four, and six/.test(e) && /sample variance is four/.test(e))).toBe(true);
    expect(s.title.length).toBeGreaterThan(3);
  });
});

describe('formulas: individual phrases', () => {
  const one = (s: string) => findFormulas(s).map((f) => f.expression);
  it.each([
    ['so the derivative of x squared is two x', 'd/dx(x^2) = 2x'],
    ['a squared plus b squared equals c squared', 'a^2 + b^2 = c^2'],
    ['f of x equals three x plus two', 'f(x) = 3x + 2'],
    ['and y equals two x plus one is a line', 'y = 2x + 1'],
    ['the area of a circle is pi r squared', 'area = pi r^2'],
    ['two plus two equals four', '2 + 2 = 4'],
  ])('%s', (spoken, expected) => {
    expect(one(spoken)).toEqual([expected]);
  });
  it.each(['the answer is two', 'x is three', 'this is a function', 'it is equal to that', 'we call this the slope', 'the slope is the rise over the run'])(
    'ignores "%s"',
    (spoken) => {
      expect(one(spoken)).toEqual([]);
    },
  );
});

describe('robustness', () => {
  it('empty input', () => {
    for (const input of ['', '   ', [], [{ text: '' }], [{ text: '  ', start: 0, end: 1 }]] as const) {
      const s = summarize(input as string | Segment[]);
      expect(s).toEqual({ title: 'Untitled lecture', keyPoints: [], formulas: [], definitions: [], outline: [], examples: [], wordCount: 0 });
    }
  });

  it('very short input', () => {
    const s = summarize('um okay');
    expect(s.wordCount).toBe(2);
    expect(s.keyPoints).toEqual([]);
  });

  it('50k words in under 500 ms', { retry: 2 }, () => {
    const base = [fixture('derivatives'), fixture('pythagoras'), fixture('statistics')].join('\n');
    const reps = Math.ceil(50000 / base.split(/\s+/).length);
    const big = Array.from({ length: reps }, () => base).join('\n');
    expect(big.split(/\s+/).length).toBeGreaterThanOrEqual(50000);
    summarize(fixture('derivatives')); // warm up the JIT
    const t0 = performance.now();
    const s = summarize(asSegments(big));
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(500);
    expect(s.keyPoints.length).toBeLessThanOrEqual(8);
    expect(s.formulas.length).toBeGreaterThan(10);
    // Repeated content is de-duplicated.
    expect(new Set(s.formulas.map((f) => f.expression)).size).toBe(s.formulas.length);
  });

  it('Whisper-style text without punctuation', () => {
    const raw = fixture('derivatives').toLowerCase().replace(/[.,!?;:]/g, ' ').replace(/\s+/g, ' ');
    const sentences = toSentences(raw);
    expect(sentences.length).toBeGreaterThan(20);
    for (const x of sentences) expect(x.raw.split(' ').length).toBeLessThanOrEqual(32);
    const s = summarize(asSegments(raw, 30, 10));
    expect(expressions(s)).toEqual(expect.arrayContaining(['d/dx(x^2) = 2x', 'd/dx(x^3) = 3x^2', 'f(x) = 3x^2 + 5x + 2']));
    expect(s.keyPoints.length).toBeGreaterThanOrEqual(5);
    for (const k of s.keyPoints) expect(k.split(' ').length).toBeLessThanOrEqual(40);
    expect(s.outline.map((o) => o.heading.toLowerCase())).toEqual(expect.arrayContaining(['the power rule', 'the chain rule']));
    expect(s.title).toBe('Derivatives and the chain rule');
    expectParses(s);
  });

  it('strips filler from key points', () => {
    const t =
      'Um, so, like, the key idea is that the derivative is a limit, you know. Uh, remember the derivative measures rate of change. ' +
      'The derivative of a constant is zero. Important: the power rule handles polynomials quickly. In summary, derivatives measure change.';
    const s = summarize(t);
    expect(s.keyPoints[0]).toBe('The key idea is that the derivative is a limit.');
    for (const k of s.keyPoints) expect(k).not.toMatch(/\b(?:um|uh|you know)\b/i);
  });

  it('keeps words that only look like filler, and repeated numbers', () => {
    expect(clean('right triangles always have one ninety degree angle')).toBe('Right triangles always have one ninety degree angle.');
    expect(clean('like terms can be combined')).toBe('Like terms can be combined.');
    expect(clean('well-known result')).toBe('Well-known result.');
    expect(clean('Right, so the hypotenuse is the longest side')).toBe('The hypotenuse is the longest side.');
    expect(clean('Like, the slope is rise over run')).toBe('The slope is rise over run.');
    expect(clean('the mode of 1 1 2 3 is 1')).toBe('The mode of 1 1 2 3 is 1.');
    expect(clean('the the derivative is 2x')).toBe('The derivative is 2x.');
    const s = summarize('Right triangles are defined as triangles with one ninety degree angle. Like terms are defined as terms with the same variable and power.');
    expect(s.definitions.map((d) => d.term)).toEqual(['right triangles', 'like terms']);
  });

  it('never extracts false arithmetic from run-on speech', () => {
    const s = summarize('so the mean of 2 4 and 9 is 15 divided by 3 which is 5 and the range of 2 4 9 is 9 minus 2 which is 7');
    expect(s.formulas.map((f) => f.expression)).not.toContain('9 = 15 / 3');
    expect(s.formulas.map((f) => f.expression)).not.toContain('9 = 9 - 2');
    expect(findFormulas('so 10 divided by 2 is 5').map((f) => f.expression)).toEqual(['10 / 2 = 5']);
    expect(findFormulas('and 2 plus 2 is 5')).toEqual([]);
  });
});

describe('aiSummaryPrompt / toMarkdown', () => {
  const text = fixture('pythagoras');
  const s = summarize(text);

  it('builds a grounded prompt that reuses the extracted formulas', () => {
    const p = aiSummaryPrompt(text, s);
    expect(p.system).toMatch(/only facts stated in the transcript/i);
    expect(p.system).toMatch(/Copy formulas exactly/);
    expect(p.user).toContain('a^2 + b^2 = c^2');
    expect(p.user).toContain('TRANSCRIPT:');
    expect(p.user).toContain('ladder');
  });

  it('keeps the prompt compact for long lectures', () => {
    const long = text.repeat(40);
    const p = aiSummaryPrompt(long, summarize(long));
    expect(p.user.length).toBeLessThan(32000);
    expect(p.user).toContain('middle of the transcript omitted');
  });

  it('renders markdown for a notebook', () => {
    const md = toMarkdown(s);
    expect(md.startsWith('# The Pythagorean theorem') || md.startsWith('# ')).toBe(true);
    expect(md).toContain('## Key points');
    expect(md).toContain('## Formulas');
    expect(md).toContain('$a^{2} + b^{2} = c^{2}$');
    expect(md).toContain('- **hypotenuse**: ');
    expect(md).toContain('## Examples');
    const timed = toMarkdown(summarize(asSegments(fixture('derivatives'))));
    expect(timed).toMatch(/- \*\*\d+:\d\d\*\* The chain rule/);
  });
});
