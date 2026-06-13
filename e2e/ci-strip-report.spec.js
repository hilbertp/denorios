'use strict';

const { test, expect } = require('@playwright/test');
const { seedRegressionReport } = require('./seed-fixture');

// Journey: in the Infirmary / CI strip, the operator clicks the regression "report"
// link and a report overlay opens showing the latest gate result (passing).
//
// LAST-RUN.md is gitignored (absent on a fresh CI checkout), so the fixture seeds its
// own deterministic PASS report — the journey then renders identically locally and in CI.

test.beforeEach(async ({ page }) => {
  seedRegressionReport();
  await page.goto('/');
});

test('the regression "report" link opens the report overlay showing a passing suite', async ({ page }) => {
  const link = page.locator('#ci-strip-regression-report');
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
