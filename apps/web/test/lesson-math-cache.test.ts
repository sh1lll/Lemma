import { describe, expect, it } from 'vitest';
import { MATH_CACHE_LIMIT, mathCacheSize, renderMathImage } from '../src/lesson/export';

// Every cached formula image is an SVG document carrying all the KaTeX fonts. A long session plays many lessons
// (and resizing changes the pixel size in the key), so the cache must stay bounded.
describe('lesson formula image cache', () => {
  it('keeps at most MATH_CACHE_LIMIT images, most recently used last out', async () => {
    const all: Promise<unknown>[] = [];
    // No DOM here: each build fails, which is fine; only the bookkeeping is under test.
    for (let i = 0; i < MATH_CACHE_LIMIT * 3; i++) all.push(renderMathImage(`x^{${i}}`, 20 + (i % 7), '#222').catch(() => null));
    expect(mathCacheSize()).toBe(MATH_CACHE_LIMIT);
    const recent = renderMathImage(`x^{${MATH_CACHE_LIMIT * 3 - 1}}`, 20 + ((MATH_CACHE_LIMIT * 3 - 1) % 7), '#222');
    expect(recent).toBe(renderMathImage(`x^{${MATH_CACHE_LIMIT * 3 - 1}}`, 20 + ((MATH_CACHE_LIMIT * 3 - 1) % 7), '#222'));
    recent.catch(() => null);
    expect(mathCacheSize()).toBe(MATH_CACHE_LIMIT);
    await Promise.all(all);
  });
});
