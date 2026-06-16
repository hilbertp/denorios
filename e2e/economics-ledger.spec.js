'use strict';

const { test, expect } = require('@playwright/test');
const seedFixture = require('./seed-fixture');
const { seedCostEvents } = seedFixture;

// Journey: Quark's Ledger (Economics / cost center) shows per-role spend and the
// header collapse toggle hides/reveals the table. We seed a Rom DONE event so at
// least one role row carries real numbers.

test.beforeEach(async ({ page }) => {
  seedCostEvents();
  await page.goto('/');
});

test.afterAll(() => { seedFixture(); });

test('the ledger shows a per-role row with real spend', async ({ page }) => {
  const panel = page.locator('#cost-center');
  await expect(panel).toBeVisible();

  // Rom's row reflects the seeded DONE event (4200 in / 1500 out, $0.42). The ledger
  // labels rows by the mode-aware person name — "Sam" in light mode (default), "Rom" in
  // the LCARS skin — so we match the light-mode human name here.
  const romRow = panel.locator('#cost-center-tbody tr', { hasText: 'Sam' });
  await expect(romRow).toBeVisible({ timeout: 10000 });
  await expect(romRow).toContainText('0.42');
});

test('the header toggle collapses and re-expands the ledger body', async ({ page }) => {
  const body = page.locator('#cost-center-body');
  const toggle = page.locator('#cost-center-toggle');
  await expect(body).toBeVisible();

  await toggle.click();
  await expect(body).toBeHidden();

  await toggle.click();
  await expect(body).toBeVisible();
});
