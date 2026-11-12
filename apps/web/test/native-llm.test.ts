import { describe, expect, it, vi } from 'vitest';
import { NativeModelClient } from '../src/local-llm/native';

/** A fake desktop bridge whose model load finishes when the test says so. */
function bridge() {
  let finishLoad!: () => void;
  const b = {
    load: vi.fn(() => new Promise<{ model: string; device: string }>((r) => (finishLoad = () => r({ model: 'm', device: 'native' })))),
    generate: vi.fn(async () => 'generated'),
    abort: vi.fn(),
    onToken: () => () => {},
    onProgress: () => () => {},
  };
  return { b, finishLoad: () => finishLoad() };
}

describe('NativeModelClient', () => {
  it('a Stop pressed while the model is still downloading never starts a generation', async () => {
    const { b, finishLoad } = bridge();
    const c = new NativeModelClient('m', b);
    const ac = new AbortController();
    const p = c.generate({ messages: [], maxTokens: 10 }, () => {}, ac.signal);
    ac.abort();
    finishLoad();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(b.generate).not.toHaveBeenCalled();
  });

  it('generates normally once loaded', async () => {
    const { b, finishLoad } = bridge();
    const c = new NativeModelClient('m', b);
    const p = c.generate({ messages: [], maxTokens: 10 }, () => {});
    finishLoad();
    await expect(p).resolves.toBe('generated');
  });
});
