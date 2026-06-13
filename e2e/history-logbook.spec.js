'use strict';

const { test, expect } = require('@playwright/test');
const seedFixture = require('./seed-fixture');
const { seedHistorySlice } = seedFixture;

// Journey: the History / Logbook shows a completed slice with its dev → reg → main
// lifecycle chain and an outcome chip. We seed one merged slice (8001) via register
// events and assert the row + the lifecycle chain render with main reached.

test.beforeEach(async ({ page }) => {
  seedHistorySlice('8001');
  await page.goto('/');
});

test.afterAll(() => { seedFixture(); }); // restore the default register for later specs

test('a merged slice appears in the Logbook with its dev → reg → main lifecycle chain', async ({ page }) => {
  const row = page.locator('.history-row', { hasText: 'Merged history slice' });
  await expect(row).toBeVisible({ timeout: 10000 });
  await expect(row).toContainText('8001');

  // The lifecycle chain: dev, reg, main — all reached for a merged slice.
  const chain = row.locator('.outcome-chain');
  await expect(chain).toBeVisible();
  await expect(chain.locator('.chain-stage.stage-dev.done')).toBeVisible();
  await expect(chain.locator('.chain-stage.stage-reg.done')).toBeVisible();
  await expect(chain.locator('.chain-stage.stage-main.done')).toBeVisible();
});
