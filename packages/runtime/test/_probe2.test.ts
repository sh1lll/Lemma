import { createSession } from '@lemma/math-core';
import { it } from 'vitest';
import { Runtime } from '../src';
import { appendFileSync } from 'node:fs';
it('timing', async () => {
  const rt = new Runtime();
  // warm every chunk
  for (const q of ['1+1','5 km to miles','days until christmas','mean of 1,2','npv at 8% of -1,2','triangle 3 4 5','ohm law','dijkstra','black scholes','simulate 10: x','inflation 1990','density of iron','tip 15% on 80']) { appendFileSync('/private/tmp/claude-502/-Users-sh1ll-Library-Application-Support-Claude-scratch-workspaces-90f4a20a-dfc0-4775-b465-e93ba60ef5be-b75a739c-8627-43a2-a083-5f5ec37886dd-scratch-2026-10-30-fccdb1/e6a4bb7a-6814-4533-8656-e944535fddc3/scratchpad/t.log', 'warm ' + q + '\n'); await rt.compute(q, createSession()); }
  await Promise.all([rt.loadUnits(), rt.loadEveryday(), rt.loadAdvanced(), rt.loadHistory(), rt.loadSimulate(), rt.loadStatsPlus(), rt.loadApplied(), rt.loadDiscrete(), rt.loadQuant(), rt.loadShapes(), rt.loadReference()]);
  const gens: [string, (n: number) => string][] = [
    ['letters', (n) => 'a'.repeat(n)],
    ['digits', (n) => '1'.repeat(n)],
    ['plus', (n) => '1+'.repeat(n / 2) + '1'],
    ['spaces', (n) => '1' + ' '.repeat(n) + 'x'],
    ['words', (n) => 'the '.repeat(n / 4)],
    ['commas', (n) => '1,12'.repeat(n / 4)],
    ['parens', (n) => '('.repeat(n / 2) + '1' + ')'.repeat(n / 2)],
    ['integral', (n) => 'integral from 0 to 1 of x' + ' '.repeat(n) + 'y'],
    ['list', (n) => 'mean of ' + Array.from({ length: n / 3 }, (_, i) => i % 10).join(', ')],
    ['dots', (n) => '1.'.repeat(n / 2)],
    ['point', (n) => 'one point '.repeat(n / 10)],
    ['xs', (n) => '2x'.repeat(n / 2)],
    ['minus', (n) => '-'.repeat(n) + '1'],
    ['dollar', (n) => '$1 '.repeat(n / 3)],
    ['date', (n) => '2024-01-01 '.repeat(n / 11)],
    ['tens', (n) => '10 '.repeat(n / 3)],
  ];
  const out: string[] = [];
  for (const [name, g] of gens) {
    const row = [name];
    for (const n of [100, 400, 1600]) {
      const s = g(n); appendFileSync('/private/tmp/claude-502/-Users-sh1ll-Library-Application-Support-Claude-scratch-workspaces-90f4a20a-dfc0-4775-b465-e93ba60ef5be-b75a739c-8627-43a2-a083-5f5ec37886dd-scratch-2026-10-30-fccdb1/e6a4bb7a-6814-4533-8656-e944535fddc3/scratchpad/t.log', 'start ' + name + ' ' + n + '\n');
      const t = performance.now();
      try { rt.route(s, createSession()); } catch (e) { row.push('THROW ' + String(e).slice(0, 60)); }
      row.push(`${n}:${(performance.now() - t).toFixed(1)}ms`); appendFileSync('/private/tmp/claude-502/-Users-sh1ll-Library-Application-Support-Claude-scratch-workspaces-90f4a20a-dfc0-4775-b465-e93ba60ef5be-b75a739c-8627-43a2-a083-5f5ec37886dd-scratch-2026-10-30-fccdb1/e6a4bb7a-6814-4533-8656-e944535fddc3/scratchpad/t.log', name + ' ' + row.at(-1) + '\n');
    }
    out.push(row.join('  '));
  }
  console.log(out.join('\n'));
}, 600000);
