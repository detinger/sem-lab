import { defineConfig } from '@playwright/test';

// Visual review + end-to-end. Uses the locally installed Google Chrome (no browser download) and is
// NOT part of `npm run test` (vitest only collects src/**). Run with `npm run e2e`.
//
// The analysis flow (e2e/analysis.spec.ts) runs against the REAL API and R engine: the second web
// server below starts apps/api on :8000 with a throw-away DATA_DIR (needs `uv` and R with cSEM, see
// services/r-engine/README.md). By hand:
//   cd apps/api && DATA_DIR=$(mktemp -d) ALLOWED_ORIGINS=http://localhost:5173 \
//     uv run uvicorn app.main:app_factory --factory --port 8000
//   VITE_API_BASE_URL=http://localhost:8000 npm run dev
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results/playwright-artifacts',
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    channel: 'chrome',
  },
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 60_000,
      env: { VITE_API_BASE_URL: 'http://localhost:8000' },
    },
    {
      command:
        'DATA_DIR=$(mktemp -d) ALLOWED_ORIGINS=http://localhost:5173 uv run uvicorn app.main:app_factory --factory --port 8000',
      cwd: '../api',
      url: 'http://localhost:8000/api/health',
      reuseExistingServer: true,
      timeout: 90_000,
    },
  ],
});
