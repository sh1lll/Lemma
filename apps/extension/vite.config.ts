import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
// @ts-expect-error plain .mjs helper shared with scripts/build.mjs
import { noSympySource } from './scripts/no-sympy.mjs';

/**
 * Extension pages (popup, side panel, options) as a multi-entry build. scripts/build.mjs runs this, then
 * builds background.js and content.js as single classic scripts (a service worker can't use dynamic
 * import() and an injected content script can't use ES modules), then writes the manifests and zips.
 */
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('./src'),
  plugins: [noSympySource()],
  base: './',
  // Icons and the OCR worker/core, prepared by scripts/build.mjs.
  publicDir: here('./.build/public'),
  build: {
    outDir: here('./dist/chrome'),
    emptyOutDir: true,
    target: ['chrome116', 'firefox121', 'safari16.4'],
    modulePreload: { polyfill: false },
    chunkSizeWarningLimit: 4096,
    rolldownOptions: {
      input: {
        popup: here('./src/popup.html'),
        sidepanel: here('./src/sidepanel.html'),
        options: here('./src/options.html'),
      },
    },
  },
});
