// Puts the packaged browser extension next to the web app, for the "Add to browser" download.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
const out = 'apps/web/dist/extension';
mkdirSync(out, { recursive: true });
for (const f of ['lemma-chrome.zip', 'lemma-firefox.zip']) {
  const src = `apps/extension/dist/${f}`;
  if (!existsSync(src)) throw new Error(`Missing ${src}: run npm run build -w @lemma/extension`);
  copyFileSync(src, `${out}/${f}`);
}
console.log('extension packages copied to', out);
