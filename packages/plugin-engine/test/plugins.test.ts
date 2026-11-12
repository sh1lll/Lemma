import type { Answer } from '@lemma/math-core';
import { describe, expect, it } from 'vitest';
import { buildFormulaPlugin, CATALOG, matchPlugin, PluginError, runFormula, scriptResultToAnswer, validateManifest, type FormulaManifest } from '../src';

const run = (m: FormulaManifest, q: string) => {
  const match = matchPlugin(m, q);
  if (!match) throw new Error(`no match: ${q}`);
  const r = runFormula(m, match, q);
  if (!r.ok) throw new Error(r.error.message);
  return r as Answer;
};

describe('catalog', () => {
  it('every catalog manifest validates and its examples produce the expected result', () => {
    for (const m of CATALOG) {
      validateManifest(JSON.parse(JSON.stringify(m)));
      for (const ex of m.examples ?? []) {
        const match = matchPlugin(m, ex.input);
        expect(match, `${m.id}: ${ex.input}`).not.toBeNull();
        if (m.kind === 'formula' && ex.expect) expect(run(m, ex.input).primary.display).toBe(ex.expect);
      }
    }
  });

  it('BMI bands, defaults and range checks', () => {
    const bmi = CATALOG.find((m) => m.id === 'lemma.bmi') as FormulaManifest;
    expect(run(bmi, 'bmi 70kg 1.75m').lines?.[0]?.display).toBe('Healthy weight');
    expect(run(bmi, 'BMI for 95 kg and 1.75 m').lines?.[0]?.display).toBe('Obese');
    const r = runFormula(bmi, matchPlugin(bmi, 'bmi 70 kg 9 m')!, 'bmi 70 kg 9 m');
    expect(r.ok).toBe(false);
    const paint = CATALOG.find((m) => m.id === 'lemma.paint') as FormulaManifest;
    expect(run(paint, 'paint for 45 m2 2 coats at 12 m2 per litre').lines?.[0]?.display).toBe('8.3 L');
  });

  it('does not capture unrelated input', () => {
    for (const q of ['5 + 5', 'bmi', 'what is bmi', 'download the file', '20% of 450', 'bmi 70 kg 1.75 m and also something else'])
      for (const m of CATALOG) expect(matchPlugin(m, q), `${m.id} vs ${q}`).toBeNull();
  });
});

describe('validation', () => {
  const good = () => JSON.parse(JSON.stringify(CATALOG[0]));
  it.each([
    ['wrong format', (m: Record<string, unknown>) => (m.format = 'x')],
    ['bad id', (m: Record<string, unknown>) => (m.id = 'Evil Id')],
    ['unknown template input', (m: Record<string, unknown>) => (m.templates = ['bmi {nope}'])],
    ['template without inputs', (m: Record<string, unknown>) => (m.templates = ['bmi'])],
    ['template with no fixed words', (m: Record<string, unknown>) => (m.templates = ['{weight}'])],
    ['template of only slots and symbols', (m: Record<string, unknown>) => (m.templates = ['{weight} / {height}'])],
    ['bad input name', (m: Record<string, unknown>) => ((m.inputs as { name: string }[])[0]!.name = 'Weight Kg')],
    ['no kind', (m: Record<string, unknown>) => delete m.kind],
    ['script with network:*', (m: Record<string, unknown>) => Object.assign(m, { kind: 'script', script: 'function run(){}', permissions: ['network:*'] })],
    ['huge script', (m: Record<string, unknown>) => Object.assign(m, { kind: 'script', script: 'x'.repeat(70_000) })],
  ])('rejects %s', (_label, mutate) => {
    const m = good();
    mutate(m);
    expect(() => validateManifest(m)).toThrow(PluginError);
  });
});

describe('template matching is linear-time', () => {
  it('adversarial input against every template stays fast', () => {
    const inputs = ['bmi ' + '1'.repeat(290), 'bmi ' + '1 '.repeat(140), 'download ' + 'a'.repeat(280), 'x'.repeat(10_000)];
    const t0 = performance.now();
    for (const m of CATALOG) for (const q of inputs) matchPlugin(m, q);
    expect(performance.now() - t0).toBeLessThan(50);
  });

  // A hostile (or just unlucky) manifest: adjacent text slots, or comma-separated numbers, used to backtrack
  // exponentially in a single regex (5 text inputs: 12 s; 6 numbers: 11 s) and freeze the page on every keystroke.
  it('adversarial templates from an imported manifest stay fast', () => {
    const text = Array.from({ length: 12 }, (_, i) => ({ name: `t${i}`, type: 'text' }));
    const nums = Array.from({ length: 12 }, (_, i) => ({ name: `n${i}` }));
    const base = { format: 'lemma-plugin', version: 1, id: 'evil.plugin', name: 'x', description: 'x', release: '1' };
    const textPlugin = validateManifest({ ...base, kind: 'script', script: 'function run(){}', inputs: text, templates: [text.map((i) => `{${i.name}}`).join(' ') + ' zz'] });
    const numPlugin = validateManifest({ ...base, kind: 'formula', formula: 'n0', output: {}, inputs: nums, templates: [nums.map((i) => `{${i.name}}`).join(',') + ' zz'] });
    const t0 = performance.now();
    expect(matchPlugin(textPlugin, 'a '.repeat(140) + 'q')).toBeNull();
    expect(matchPlugin(numPlugin, '1' + ',111'.repeat(70) + ' q')).toBeNull();
    expect(performance.now() - t0).toBeLessThan(200);
    // Same answers as before for ordinary input.
    expect(matchPlugin(numPlugin, Array.from({ length: 12 }, (_, i) => i + 1).join(',') + ' zz')?.values.n11).toBe('12');
  });

  it('text inputs take the shortest run before the next literal', () => {
    const m = validateManifest({
      format: 'lemma-plugin', version: 1, id: 'x.text', name: 'x', description: 'x', release: '1', kind: 'script', script: 'function run(){}',
      inputs: [{ name: 'n' }, { name: 'city', type: 'text' }, { name: 'who', type: 'text' }],
      templates: ['{n} people in {city} with {who}'],
    });
    expect(matchPlugin(m, '1,200 people in new york with bob and alice?')?.values).toEqual({ n: '1200', city: 'new york', who: 'bob and alice' });
  });
});

describe('no-code tool builder', () => {
  it('builds a working tool from a formula and inputs', () => {
    const m = buildFormulaPlugin({ name: 'Tile cost', formula: 'area * price * 1.1', inputs: [{ name: 'area', unit: 'm2' }, { name: 'price' }], resultUnit: '$', decimals: 2, phrases: ['tiles for {area} m2 at {price} each'] });
    expect(m.id).toBe('user.tile-cost');
    expect(run(m, 'tile cost 12 m2 25').primary.display).toBe('330.00');
    expect(run(m, 'tiles for 12 m2 at 25 each').primary.display).toBe('330.00');
  });
  it('explains mistakes', () => {
    expect(() => buildFormulaPlugin({ name: 'x', formula: 'a * b', inputs: [{ name: 'a' }] })).toThrow(/isn’t an input/);
    expect(() => buildFormulaPlugin({ name: 'x', formula: 'a * 2', inputs: [{ name: 'a' }, { name: 'b' }] })).toThrow(/doesn’t use the input “b”/);
    expect(() => buildFormulaPlugin({ name: '', formula: 'a', inputs: [{ name: 'a' }] })).toThrow(/name/);
  });
});

describe('script results are validated as plain data', () => {
  const roman = CATALOG.find((m) => m.id === 'lemma.roman')!;
  it('accepts well-formed results and rejects anything else', () => {
    expect(scriptResultToAnswer(roman, 'q', { display: 'MMXXVI', value: 2026 }).ok).toBe(true);
    for (const bad of [null, 'str', { display: 5 }, { display: 'x'.repeat(500) }, { display: 'ok', lines: [{ label: 1 }] }, { display: 'ok', value: 'NaNx' }])
      expect(scriptResultToAnswer(roman, 'q', bad).ok).toBe(false);
  });
});
