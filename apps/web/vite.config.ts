import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // Supported baseline. Older browsers get the core calculator plus a notice (see index.html).
    target: ['chrome100', 'edge100', 'firefox115', 'safari16.4'],
    modulePreload: { polyfill: false },
    reportCompressedSize: true,
  },
  server: { port: 5178 },
  preview: { port: 4178 },
});
