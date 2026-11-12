import { createSession } from '@lemma/math-core';
import { describe, expect, it } from 'vitest';
import { outcomeToJSON, Runtime } from '@lemma/runtime';

const rt = new Runtime();
const run = async (q: string) => outcomeToJSON(await rt.compute(q, createSession()), q);

describe('quant routes through the runtime (lazy chunk)', () => {
  it.each([
    ['Black-Scholes call S=100 K=105 T=0.5 r=5% vol=20%', '$4.5817'],
    ['portfolio 60/40 with returns 8% and 4%, vols 15% and 5%, correlation 0.2', '6.40%'],
    ['Nash equilibrium [[3,3],[0,5];[5,0],[1,1]]', '(R2, C2)'],
    ['EOQ demand 12000 order cost 50 holding 2', '774.6 units'],
    ['inflation cpi from 250 to 260', '4.00%'],
    ['equilibrium demand Q = 100 - 2P supply Q = 20 + 3P', 'P = 16, Q = 68'],
  ])('%s', async (q, display) => expect((await run(q)).display).toBe(display));
  it('leaves plain arithmetic and finance alone', async () => {
    expect((await run('2 + 2')).display).toBe('4');
    expect((await run('18% tip on $64.50')).display).toBe('$11.61');
  });
});
