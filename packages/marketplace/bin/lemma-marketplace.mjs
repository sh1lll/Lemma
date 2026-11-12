#!/usr/bin/env node
// Runs the TypeScript CLI through Vite's module runner (resolves the workspace packages without a build step).
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';
const { module } = await runnerImport(fileURLToPath(new URL('../cli/main.ts', import.meta.url)));
process.exitCode = await module.main(process.argv.slice(2));
