import { describe, expect, it } from 'vitest';
import { catalogSize, categories, search, unicodeBlocks } from '../src/symbols/catalog';

describe('symbol catalog', () => {
  it('covers the Unicode math blocks and the hand-picked groups', () => {
    expect(unicodeBlocks().reduce((n, b) => n + b.items.length, 0)).toBeGreaterThan(2000);
    expect(catalogSize()).toBeGreaterThan(2000);
    const ids = categories().map((c) => c.id);
    for (const id of ['greek', 'operators', 'relations', 'sets', 'arrows', 'calculus', 'scripts', 'fractions', 'geometry', 'units', 'currency', 'accents', 'misc']) expect(ids).toContain(id);
  });

  it.each([
    ['alpha', 'α'],
    ['\\alpha', 'α'],
    ['\\leq', '≤'],
    ['not equal', '≠'],
    ['integral', '∫'],
    ['subset', '⊂'],
    ['degree', '°'],
    ['therefore', '∴'],
    ['\\Rightarrow', '⇒'],
    ['golden ratio', 'φ'],
    ['≈', '≈'],
  ])('"%s" finds %s first', (q, ch) => {
    expect(search(q)[0]?.text).toBe(ch);
  });

  it('lists each character once and ranks your own symbols with the best matches', () => {
    const r = search('wave', [{ text: 'ψ₀', name: 'wave', aliases: [], tex: [] }]);
    expect(r[0]!.text).toBe('ψ₀');
    expect(new Set(r.map((s) => s.text)).size).toBe(r.length);
  });
});
