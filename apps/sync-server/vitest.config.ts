import { defineConfig } from 'vitest/config';
// Run from the repo root with: npx vitest run --config apps/sync-server/vitest.config.ts
export default defineConfig({ test: { root: import.meta.dirname, include: ['test/**/*.test.ts'], testTimeout: 60_000 } });
