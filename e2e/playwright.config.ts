import { defineConfig, devices } from '@playwright/test';

/**
 * FireISP 5.0 — Playwright configuration
 *
 * The default base URL points at the Vite dev server which proxies /api → the
 * Express backend.  Override with the BASE_URL env var when running against a
 * different host (e.g. docker-compose.e2e.yml sets BASE_URL=http://web:5173).
 *
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests',

  // Maximum time one test can run (ms)
  timeout: 60_000,

  // Retry once in CI to absorb transient flakiness
  retries: process.env.CI ? 1 : 0,

  // Run tests serially — the smoke test creates clients, contracts, invoices,
  // payments, and tickets in a shared database.  Parallel workers would race
  // on the same seed rows.  When isolation (unique-per-worker DB schemas or
  // transaction rollback) is added in a future iteration, raise this to
  // the number of CPU cores (or 'auto').
  workers: 1,

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],

  use: {
    // In CI the Express server serves both the API and the React bundle on
    // port 3000 (production build).  Override BASE_URL to test against a
    // different host (e.g. vite dev on port 5173 with proxy during development).
    baseURL: process.env.BASE_URL || 'http://localhost:3000',

    // Capture screenshot + trace on the first retry so failures are debuggable
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
