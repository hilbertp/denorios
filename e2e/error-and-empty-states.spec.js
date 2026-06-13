'use strict';

const { test, expect } = require('@playwright/test');

// Graceful-degradation unhappy paths: the dashboard must surface "down" / "degraded" /
// "could not load" honestly instead of looking healthy when it isn't.

test('orchestrator down → header pulse reads OFFLINE', async ({ page }) => {
  await page.route('**/api/health', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ watcher: { status: 'down', heartbeatAge_s: null } }) }));
  await page.goto('/');
  await expect(page.locator('#ops-health-label')).toHaveText('OFFLINE');
  await expect(page.locator('#ops-health-pill')).toHaveClass(/offline/);
});

test('orchestrator heartbeat stale → header pulse reads DEGRADED', async ({ page }) => {
  await page.route('**/api/health', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ watcher: { status: 'stale', heartbeatAge_s: 45 } }) }));
  await page.goto('/');
  await expect(page.locator('#ops-health-label')).toHaveText('DEGRADED');
  await expect(page.locator('#ops-health-pill')).toHaveClass(/degraded/);
});

test('report overlay: no run yet → "No regression report yet", not a false pass', async ({ page }) => {
  await page.route('**/api/regression/report', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ markdown: null, updated: null, status: 'none' }) }));
  await page.goto('/');

  await page.locator('#ci-strip-regression-report').click();
  await expect(page.locator('#regression-coverage-body')).toContainText('No regression report yet');
});

test('report overlay: a failed /api/regression/report shows "could not load", not a blank/false success', async ({ page }) => {
  await page.route('**/api/regression/report', r =>
    r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'read_failed' }) }));
  await page.goto('/');

  await page.locator('#ci-strip-regression-report').click();
  await expect(page.locator('#regression-coverage-body')).toContainText('Could not load report');
});
