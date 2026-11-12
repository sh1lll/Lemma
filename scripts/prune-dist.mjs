// Drops build output the app never loads. The voice runtime's WebAssembly (onnxruntime, ~26 MB) is emitted as a
// fallback, but the speech library always loads it from its pinned CDN path instead (cached by the service worker
// for offline use), so shipping our copy only bloats the site, the desktop installers and the phone app.
import { readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
const dir = new URL('../apps/web/dist/assets/', import.meta.url);
let freed = 0;
for (const f of readdirSync(dir)) {
  if (!/^ort-wasm-.*\.wasm$/.test(f)) continue;
  freed += statSync(new URL(f, dir)).size;
  rmSync(new URL(f, dir));
}
console.log(`prune: removed ${(freed / 1048576).toFixed(1)} MB of unused files`);

// Every file the app can load, for Settings → "Load everything" (it fetches them so the service worker keeps an
// offline copy). Written after pruning so it never lists a removed file.
const files = readdirSync(dir).filter((f) => !f.endsWith('.map'));
const bytes = files.reduce((n, f) => n + statSync(new URL(f, dir)).size, 0);
writeFileSync(new URL('../asset-manifest.json', dir), JSON.stringify({ files: files.map((f) => `/assets/${f}`), bytes }));
console.log(`asset manifest: ${files.length} files, ${(bytes / 1048576).toFixed(1)} MB`);
