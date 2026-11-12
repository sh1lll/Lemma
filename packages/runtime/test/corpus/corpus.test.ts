/**
 * The correctness corpus: several thousand generated problems with independently computed answers (see generate.ts),
 * run through the same router the apps use. Runs on every build (`npm run corpus`, part of `npm run build`).
 *
 * "Never be wrong, and show that it isn't": a case passes only when the numeric value matches (exactly for
 * integers and terminating decimals, within a stated tolerance otherwise) and, where the case says so, the display
 * and the exact fraction match too. Symbolic (SymPy) answers are covered in the browser: e2e/corpus-symbolic.spec.ts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Runtime } from '../../src/router';
import { run, verdict } from './check';
import { generateCorpus, type Case } from './generate';

const corpus = generateCorpus();
const byCat = new Map<string, Case[]>();
for (const c of corpus) byCat.set(c.cat, [...(byCat.get(c.cat) ?? []), c]);

describe(`correctness corpus (${corpus.length} cases)`, () => {
  let rt: Runtime;
  beforeAll(async () => {
    rt = new Runtime();
    await rt.loadAll();
  }, 60_000);

  it('is large, deterministic and broad', () => {
    expect(corpus.length).toBeGreaterThan(5000);
    expect(byCat.size).toBeGreaterThan(20);
    expect(generateCorpus().map((c) => c.q)).toEqual(corpus.map((c) => c.q));
  });

  for (const [cat, cases] of byCat) {
    it(`${cat} (${cases.length})`, async () => {
      const wrong: string[] = [];
      for (const c of cases) {
        const v = verdict(c, await run(rt, c.q));
        if (v) wrong.push(`${JSON.stringify(c.q)}: ${v}`);
      }
      expect(wrong.length ? `${wrong.length} of ${cases.length} wrong:\n  ${wrong.slice(0, 40).join('\n  ')}` : '').toBe('');
    }, 60_000);
  }
});
