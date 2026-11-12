import { describe, expect, it } from 'vitest';
import { cellNumber, convertInlineLatex, latexToInput } from '../src/core/latex';
import { isAssessmentHost, normalizeDomain, normalizeSettings } from '../src/core/settings';
import { conversionQuery, fillValue, solve } from '../src/core/solve';
import { cleanOcr } from '../src/ui/ocr';

describe('page math → input', () => {
  it('converts LaTeX', () => {
    expect(latexToInput('\\frac{3}{4} \\cdot 8')).toBe('3/4 * 8');
    expect(latexToInput('\\sqrt{16} + 2^{10}')).toBe('sqrt(16) + 2^(10)');
    expect(latexToInput('\\left( 1 + \\frac{1}{x+1} \\right)')).toBe('( 1 + (1)/(x+1) )');
    expect(convertInlineLatex('Find $2x + 3 = 11$ now')).toBe('Find 2x + 3 = 11 now');
    expect(convertInlineLatex('no math here')).toBeNull();
  });
  it('reads table cells', () => {
    expect(cellNumber('$1,299.00')).toBe(1299);
    expect(cellNumber('(12.50)')).toBe(-12.5);
    expect(cellNumber('n/a')).toBeNull();
  });
});

describe('settings', () => {
  it('normalizes domains and matches subdomains', () => {
    expect(normalizeDomain('https://Quiz.Example.edu/path?q=1')).toBe('quiz.example.edu');
    expect(normalizeDomain('not a domain')).toBeNull();
    expect(isAssessmentHost('a.quiz.example.edu', ['quiz.example.edu'])).toBe(true);
    expect(isAssessmentHost('example.edu', ['quiz.example.edu'])).toBe(false);
    expect(isAssessmentHost('notexample.edu', ['example.edu'])).toBe(false);
  });
  it('defaults to tutor mode with learning first on', () => {
    expect(normalizeSettings({})).toMatchObject({ mode: 'tutor', learningFirst: true, assessmentDomains: [] });
    expect(normalizeSettings({ mode: 'x', tutorStyle: 'nope' })).toMatchObject({ mode: 'tutor', tutorStyle: 'chalkboard' });
  });
});

describe('solve', () => {
  it('answers, with steps where the exact solvers apply', async () => {
    expect((await solve('calculate', '3 × 4 + 2')).answer?.display).toBe('14');
    const eq = await solve('solve', 'solve 2x+3=11');
    expect(eq.answer?.display).toBe('x = 4');
    expect(eq.steps.length).toBeGreaterThan(0);
    expect(eq.hint).toMatch(/Subtract 3/);
    expect((await solve('convert', '5 miles')).answer?.display).toMatch(/^8\.04672 km$/);
    expect((await solve('graph', 'y = x^2 - 4')).graph?.paths[0]).toMatch(/^M/);
    expect((await solve('average', '', { label: 'Price', values: [10, 20, 33] })).answer?.display).toBe('21');
  });
  it('fills just the value', () => {
    expect(fillValue('x = 4')).toBe('4');
    expect(fillValue('x = 2 or x = 3')).toBe('2, 3');
    expect(conversionQuery('100 °F')).toBe('100 °F to °C');
    expect(conversionQuery('3 ft to cm')).toBe('3 ft to cm');
  });
  it('tidies OCR text', () => {
    expect(cleanOcr('3x+5=20\n\n| 2x — 1 = 7')).toBe('3x + 5 = 20\n2x - 1 = 7');
  });
});
