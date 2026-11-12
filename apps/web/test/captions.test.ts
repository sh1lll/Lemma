import { describe, expect, it } from 'vitest';
import { CAPTION_CHARS, captionAt, captionChunks } from '../src/lesson/script-timeline';

const LONG =
  'The derivative, f prime of x, is the slope of the curve at each point. It tells you how fast f is changing as x moves. And the chain rule is how we find it when one function sits inside another, like sine of x squared.';

describe('captions page through long narration', () => {
  it('splits into short chunks at sentence and clause breaks, covering the whole line in order', () => {
    const chunks = captionChunks(LONG, 10, 30);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(CAPTION_CHARS);
    expect(chunks.map((c) => c.text).join(' ')).toBe(LONG);
    expect(chunks[0]!.start).toBe(10);
    expect(chunks.at(-1)!.end).toBeCloseTo(30, 6);
    expect(chunks[0]!.text.endsWith('.')).toBe(true);
  });
  it('shows the chunk being spoken', () => {
    expect(captionAt(LONG, 0, 20, 0.1)).toMatch(/^The derivative/);
    expect(captionAt(LONG, 0, 20, 19.9)).toMatch(/sine of x squared\.$/);
  });
  it('short lines stay whole; a single long word run still splits', () => {
    expect(captionChunks('Subtract three from both sides.', 0, 3)).toHaveLength(1);
    const run = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const chunks = captionChunks(run, 0, 6);
    expect(chunks.every((c) => c.text.length <= CAPTION_CHARS)).toBe(true);
    expect(chunks.map((c) => c.text).join(' ')).toBe(run);
  });
});

describe('captions keep pace with the voice', () => {
  it('pages through the line while it is spoken, not across the whole scene', async () => {
    const { buildScriptTimeline, buildVtt, sceneCaptionAt, spokenEnd } = await import('../src/lesson/script-timeline');
    // A pause scene: the countdown runs long after the line is spoken.
    const tl = buildScriptTimeline({
      title: 'T',
      style: 'socratic',
      source: 'T',
      kind: 'explain',
      scenes: [
        { kind: 'title', title: 'T', say: 'Hello.' },
        { kind: 'pause', prompt: 'Try it.', seconds: 12, say: LONG },
      ],
    });
    const st = tl.scenes[1]!;
    expect(st.end - spokenEnd(st)).toBeGreaterThan(10);
    const chunks = captionChunks(st.say, st.start, st.end, spokenEnd(st));
    expect(chunks.at(-1)!.start).toBeLessThan(spokenEnd(st));
    expect(chunks.at(-1)!.end).toBe(st.end);
    // Just before the voice finishes, the last chunk is up; it stays up until the scene ends.
    expect(sceneCaptionAt(st, spokenEnd(st) - 0.05)).toBe(chunks.at(-1)!.text);
    expect(sceneCaptionAt(st, st.end - 0.01)).toBe(chunks.at(-1)!.text);
    expect(buildVtt(tl)).toContain(chunks.at(-1)!.text);
  });
});
