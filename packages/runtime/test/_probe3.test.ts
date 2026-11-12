import { createSession } from '@lemma/math-core';
import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Runtime } from '../src';
import { generateCorpus } from './corpus/generate';
it('t', async () => {
  const rt = new Runtime();
  await Promise.all([rt.loadUnits(), rt.loadEveryday(), rt.loadAdvanced(), rt.loadHistory(), rt.loadSimulate(), rt.loadStatsPlus(), rt.loadApplied(), rt.loadDiscrete(), rt.loadQuant(), rt.loadShapes(), rt.loadReference()]);
  const qs = [...new Set([...generateCorpus().map((c) => c.q), ...readFileSync('/private/tmp/claude-502/-Users-sh1ll-Library-Application-Support-Claude-scratch-workspaces-90f4a20a-dfc0-4775-b465-e93ba60ef5be-b75a739c-8627-43a2-a083-5f5ec37886dd-scratch-2026-10-30-fccdb1/e6a4bb7a-6814-4533-8656-e944535fddc3/scratchpad/all.txt', 'utf8').split('\n').filter(Boolean)])];
  const seen = new Map<string, string>();
  let n = 0, slow: string[] = [];
  for (const q of qs) for (let k = 1; k <= q.length; k++) {
    const p = q.slice(0, k); n++;
    const t = performance.now();
    try { rt.route(p, createSession()); } catch (e: any) {
      const key = String(e.message).slice(0, 60) + ' @ ' + (e.stack.split('\n')[1] ?? '').replace(/.*packages\//, '').replace(/\)$/, '');
      if (!seen.has(key)) seen.set(key, p);
    }
    const d = performance.now() - t; if (d > 30) slow.push(d.toFixed(0) + 'ms ' + p);
  }
  console.log('prefixes', n);
  for (const [k, p] of seen) console.log('THROW', JSON.stringify(p), '::', k);
  console.log(slow.slice(0, 15).join('\n'));
}, 900000);
