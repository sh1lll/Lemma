// Copies the production web build (apps/web/dist) into www/, which Capacitor bundles into the native apps.
// Everything ships inside the app, so it works offline; there is no server.url.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', '..', 'web', 'dist');
const dest = join(here, '..', 'www');
if (!existsSync(join(src, 'index.html'))) {
  console.error('apps/web/dist is missing. Run `npm run build -w @lemma/web` first.');
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
// Skip dist/extension: the browser-extension zips are a web download, not app content.
cpSync(src, dest, { recursive: true, filter: (p) => p !== join(src, 'extension') });
console.log(`Copied ${src} -> ${dest}`);
