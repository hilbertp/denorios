'use strict';

const { test, expect } = require('@playwright/test');
const { seedRegressionReport } = require('./seed-fixture');

// Journey: in the Branch-Topology gate-flow area, the operator clicks the regression
// "report" link and a report overlay opens showing the latest gate result (passing).
//
// The CI-status strip was replaced by the gate-flow stepper; the report link is now the
// `a.gflow-report` anchor in the gate-flow footer. The overlay, its body, and the
// /api/regression/report data contract are unchanged — only the trigger moved.
//
// LAST-RUN.md is gitignored (absent on a fresh CI checkout), so the fixture seeds its
// own deterministic PASS report — the journey then renders identically locally and in CI.

test.beforeEach(async ({ page }) => {
  seedRegressionReport();
  await page.goto('/');
});

test('the regression "report" link opens the report overlay showing a passing suite', async ({ page }) => {
  const link = page.locator('a.gflow-report');
  await expect(link).toBeVisible();
  await link.click();

  const overlay = page.locator('#regression-coverage-overlay');
  await expect(overlay).toBeVisible();
  // The seeded PASS report is rendered into the overlay body.
  const body = page.locator('#regression-coverage-body');
  await expect(body).toContainText('PASS');
  await expect(body).toContainText('168 passed');

  // Close cleanly.
  await overlay.locator('.history-detail-close').first().click();
  await expect(overlay).toBeHidden();
});
