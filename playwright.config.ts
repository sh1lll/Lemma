import { defineConfig, devices } from '@playwright/test';

// Runs the production build (vite preview) in every engine Lemma targets: Chromium (Chrome/Edge/Electron),
// Firefox, WebKit (Safari, and every browser on iOS), plus phone-sized touch emulation.
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  workers: 4,
  reporter: [['list']],
  // Start-up "load everything" is off in tests (it would start Python from the CDN in every page); the specs that
  // cover it turn it on themselves.
  use: { baseURL: 'http://localhost:4178', serviceWorkers: 'block', storageState: 'e2e/storage-state.json' },
  webServer: { command: 'npm run preview', port: 4178, reuseExistingServer: true },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-android', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-ios', use: { ...devices['iPhone 14'] } },
  ],
});
