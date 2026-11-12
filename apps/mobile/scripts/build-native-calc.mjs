#!/usr/bin/env node
// Bundles the pure TypeScript calculator (math-core + unit-engine + finance-engine) into one IIFE for JavaScriptCore.
// The iOS app, its widgets and share extension evaluate it to answer Siri / Shortcuts / share-sheet
// questions inline, without starting the web view. Runs as part of `npm run sync -w @lemma/mobile`, or alone:
//   node apps/mobile/scripts/build-native-calc.mjs
// Uses rolldown, the bundler already installed with vite (no per-run download).
import { build } from 'rolldown';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, 'native-calc-entry.ts');
const out = resolve(here, '../ios/App/App/Calc/lemma-calc.js');

await build({
  input: entry,
  platform: 'neutral',
  resolve: { mainFields: ['module', 'main'] },
  transform: { target: ['es2020', 'safari15'] },
  output: { file: out, format: 'iife', name: 'Lemma', minify: true, comments: { legal: false } },
});
console.log(`wrote ${out}`);
