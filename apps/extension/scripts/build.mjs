// Builds the extension for every browser from one codebase:
//   dist/chrome/   Chrome, Edge, Brave, Arc, Opera (and the input for Safari's converter)
//   dist/firefox/  Firefox (sidebar_action, background scripts, gecko id)
//   dist/lemma-chrome.zip, dist/lemma-firefox.zip   store uploads
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { noSympySource } from './no-sympy.mjs';
import { zipDir } from './zip.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = join(root, 'dist');
const pub = join(root, '.build', 'public');
const require = createRequire(join(root, 'package.json'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const webPublic = resolve(root, '../web/public');

const log = (s) => console.log(`[extension] ${s}`);
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

// ---------- 1. static files: icons and the OCR runtime

rmSync(join(root, '.build'), { recursive: true, force: true });
rmSync(dist, { recursive: true, force: true });
mkdirSync(join(pub, 'icons'), { recursive: true });
mkdirSync(join(pub, 'ocr', 'core'), { recursive: true });

const ICON_SIZES = [16, 32, 48, 128];
let sharp = null;
try {
  sharp = require('sharp');
} catch {
  sharp = null;
}
// apps/web/public/icon-192.png and icon-512.png are near-black squares (the glyph didn't survive their export),
// so with sharp available the icons are rendered from icon.svg; otherwise the PNGs are reused as they are.
for (const size of ICON_SIZES) {
  const out = join(pub, 'icons', `icon-${size}.png`);
  if (sharp) await sharp(join(webPublic, 'icon.svg'), { density: Math.max(72, (72 * size) / 512 * 4) }).resize(size, size).png().toFile(out);
  // Browsers scale the 192 px PNG down to every size.
  else cpSync(join(webPublic, 'icon-192.png'), out);
}
log(sharp ? 'icons rendered from apps/web/public/icon.svg' : 'icons copied from apps/web/public/icon-192.png (sharp unavailable)');

// tesseract.js: worker script and the LSTM-only WebAssembly cores (SIMD and non-SIMD) ship in the package.
const tessDir = dirname(require.resolve('tesseract.js/package.json'));
const coreDir = dirname(require.resolve('tesseract.js-core/package.json'));
cpSync(join(tessDir, 'dist', 'worker.min.js'), join(pub, 'ocr', 'worker.min.js'));
for (const f of ['tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js']) cpSync(join(coreDir, f), join(pub, 'ocr', 'core', f));
const lang = join(root, 'vendor', 'eng.traineddata.gz');
const bundledLang = existsSync(lang);
if (bundledLang) {
  mkdirSync(join(pub, 'ocr', 'lang'), { recursive: true });
  cpSync(lang, join(pub, 'ocr', 'lang', 'eng.traineddata.gz'));
}
log(bundledLang ? 'OCR language data bundled from vendor/eng.traineddata.gz (offline OCR)' : 'OCR language data not bundled: fetched once from the jsDelivr CDN at first use (see src/config.ts)');

// ---------- 2. pages, then the two classic scripts

const define = { 'process.env.NODE_ENV': '"production"' };
await build({ configFile: join(root, 'vite.config.ts'), logLevel: 'warn', define });

async function classic(entry, name, file) {
  await build({
    configFile: false,
    root,
    logLevel: 'warn',
    publicDir: false,
    plugins: [noSympySource()],
    define,
    build: {
      outDir: join(dist, 'chrome'),
      emptyOutDir: false,
      target: ['chrome116', 'firefox121', 'safari16.4'],
      minify: true,
      copyPublicDir: false,
      chunkSizeWarningLimit: 4096,
      lib: { entry: join(root, entry), formats: ['iife'], name, fileName: () => file },
    },
  });
}
await classic('src/background.ts', 'lemmaBackground', 'background.js');
await classic('src/content/content.ts', 'lemmaContent', 'content.js');

// ---------- 3. manifests

const icons = Object.fromEntries(ICON_SIZES.map((s) => [String(s), `icons/icon-${s}.png`]));
const base = {
  manifest_version: 3,
  name: 'Lemma',
  short_name: 'Lemma',
  version: pkg.version,
  description: 'Calculator, step-by-step solver and tutor on any page. Select math to solve it, or read a problem off the screen. Everything runs on your device.',
  homepage_url: 'https://lemma.app',
  icons,
  action: { default_title: 'Lemma', default_popup: 'popup.html', default_icon: icons },
  options_ui: { page: 'options.html', open_in_tab: true },
  commands: {
    'solve-screen': { suggested_key: { default: 'Alt+Shift+S' }, description: "Solve what's on screen" },
  },
  // 'wasm-unsafe-eval' lets the bundled OCR WebAssembly run; no 'unsafe-eval', no remote scripts.
  content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" },
};

const chromeManifest = {
  ...base,
  minimum_chrome_version: '116',
  permissions: ['activeTab', 'contextMenus', 'storage', 'scripting', 'sidePanel'],
  background: { service_worker: 'background.js' },
  side_panel: { default_path: 'sidepanel.html' },
};

const firefoxManifest = {
  ...base,
  permissions: ['activeTab', 'contextMenus', 'storage', 'scripting'],
  background: { scripts: ['background.js'] },
  sidebar_action: { default_panel: 'sidepanel.html', default_title: 'Lemma', default_icon: icons, open_at_install: false },
  browser_specific_settings: {
    gecko: {
      id: 'lemma@lemma.app',
      strict_min_version: '121.0',
      // Firefox's built-in data-collection disclosure: this add-on collects nothing.
      data_collection_permissions: { required: ['none'] },
    },
  },
};

writeFileSync(join(dist, 'chrome', 'manifest.json'), `${JSON.stringify(chromeManifest, null, 2)}\n`);
rmSync(join(dist, 'firefox'), { recursive: true, force: true });
cpSync(join(dist, 'chrome'), join(dist, 'firefox'), { recursive: true });
writeFileSync(join(dist, 'firefox', 'manifest.json'), `${JSON.stringify(firefoxManifest, null, 2)}\n`);

// ---------- 4. sanity checks: nothing that MV3 reviewers reject

for (const f of ['background.js', 'content.js']) {
  const src = readFileSync(join(dist, 'chrome', f), 'utf8');
  // (Bundled data strings may contain the word "import", e.g. the SymPy program text; look for module syntax only.)
  if (!/^(?:var |\(function)/.test(src) || /\bimport\s*\(|\bimport\.meta\b|^export\s/m.test(src)) throw new Error(`${f} must be a classic script (found module syntax)`);
  if (/\beval\(|new Function\(/.test(src)) throw new Error(`${f} contains eval/new Function`);
}
for (const f of ['popup.html', 'sidepanel.html', 'options.html']) {
  const html = readFileSync(join(dist, 'chrome', f), 'utf8');
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) throw new Error(`${f} has an inline script (blocked by the extension CSP)`);
  if (/(?:src|href)="https?:/i.test(html)) throw new Error(`${f} loads a remote resource`);
}

// ---------- 5. zips

const sizes = {
  chrome: zipDir(join(dist, 'chrome'), join(dist, 'lemma-chrome.zip')),
  firefox: zipDir(join(dist, 'firefox'), join(dist, 'lemma-firefox.zip')),
};
const dirSize = (d) => {
  let n = 0;
  const walk = (p) => {
    const s = statSync(p);
    if (s.isDirectory()) for (const c of require('node:fs').readdirSync(p)) walk(join(p, c));
    else n += s.size;
  };
  walk(d);
  return n;
};
log(`dist/chrome   ${kb(dirSize(join(dist, 'chrome')))} unpacked`);
log(`dist/firefox  ${kb(dirSize(join(dist, 'firefox')))} unpacked`);
log(`dist/lemma-chrome.zip   ${kb(sizes.chrome)}`);
log(`dist/lemma-firefox.zip  ${kb(sizes.firefox)}`);
