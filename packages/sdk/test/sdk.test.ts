import { describe, expect, it } from 'vitest';
import { createLemma } from '../src';

describe('SDK', () => {
  it('computes with context across calls, offline', async () => {
    const om = await createLemma({ liveRates: false });
    expect((await om.compute("what's 20% of 450")).display).toBe('90');
    expect((await om.compute('add that to the original number')).display).toBe('540');
    expect((await om.compute('rate = 0.05')).value).toBe('0.05');
    expect((await om.compute('1000 * (1 + rate)^10')).display).toBe('1,628.89462678');
    expect((await om.compute('100 usd to eur')).error?.message).toMatch(/turned off/);
    om.reset();
    expect((await om.compute('rate * 2')).ok).toBe(false);
  }, 60_000);
});
