import { defineConfig } from '@playwright/test';

// Visual review + end-to-end. Uses the locally installed Google Chrome (no browser download) and is
// NOT part of `npm run test` (vitest only collects src/**). Run with `npm run e2e`.
// Estimation runs in the browser (Web Workers): the only server is the Vite dev server.
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results/playwright-artifacts',
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    channel: 'chrome',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
