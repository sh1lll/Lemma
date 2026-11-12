// Fails the build if the main bundle uses syntax that breaks the supported baseline's oldest engines
// in a way the compatibility notice can't recover from (regex lookbehind is a parse error in Safari < 16.4).
import { readdirSync, readFileSync } from 'node:fs';
const dir = new URL('../apps/web/dist/assets/', import.meta.url);
const main = readdirSync(dir).filter((f) => /^index-.*\.js$/.test(f));
let bad = 0;
for (const f of main) {
  const src = readFileSync(new URL(f, dir), 'utf8');
  const hits = src.match(/\(\?<[=!]/g);
  if (hits) {
    console.error(`${f}: ${hits.length} regex lookbehind(s) in the main bundle`);
    bad++;
  }
}
if (bad) process.exit(1);
console.log(`bundle check: ${main.length} main chunk(s) OK`);
