// Bundles the CLI and every engine into one Node file. Pyodide stays external (optional, for symbolic algebra).
export default {
  input: 'src/main.ts',
  platform: 'node',
  external: ['pyodide'],
  output: { file: 'dist/lemma.mjs', format: 'esm', banner: '#!/usr/bin/env node', inlineDynamicImports: true },
};
