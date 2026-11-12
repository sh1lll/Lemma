import { defineConfig } from '@playwright/test';

// Runs only e2e/extension.spec.ts (no web-app preview server needed). Build first: npm run build.
export default defineConfig({
  testDir: '../../e2e',
  testMatch: 'extension.spec.ts',
  outputDir: './.build/test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['list']],
  projects: [{ name: 'chromium' }],
});
