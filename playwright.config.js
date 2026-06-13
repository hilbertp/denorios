'use strict';

const { defineConfig, devices } = require('@playwright/test');
const seedFixture = require('./e2e/seed-fixture');

// Build the deterministic fixture before the server boots (config loads first).
const REPO_ROOT = seedFixture();
const PORT = process.env.E2E_PORT ? parseInt(process.env.E2E_PORT, 10) : 4799;

module.exports = defineConfig({
  testDir: './e2e',
  // Journeys share one server + fixture; some mutate state — run serially.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 20000,
  expect: { timeout: 7000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // E2E_SLOWMO=<ms> slows every action so a human can watch the journeys run
    // (set only for live demos with --headed; defaults to 0, no effect on CI).
    launchOptions: { slowMo: process.env.E2E_SLOWMO ? parseInt(process.env.E2E_SLOWMO, 10) : 0 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node dashboard/server.js',
    env: {
      DASHBOARD_REPO_ROOT: REPO_ROOT,
      DASHBOARD_PORT: String(PORT),
      DASHBOARD_HOST: '127.0.0.1',
      LOB_NO_LAUNCH: '1',          // never spawn a real Terminal/claude during tests
    },
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
