'use strict';

const { test, expect } = require('@playwright/test');
const seedFixture = require('./seed-fixture');
const { seedHistorySlice } = seedFixture;

// Journey: the History / Logbook shows a completed slice with a single success/error
// outcome verdict (the dev → reg → main lifecycle chain moved to the Branch Topology
// panel in ff14af9). We seed one merged slice (8001) and assert the row + success pill.

test.beforeEach(async ({ page }) => {
  seedHistorySlice('8001');
  await page.goto('/');
});

test.afterAll(() => { seedFixture(); }); // restore the default register for later specs

test('a merged slice appears in the Logbook with a success outcome verdict', async ({ page }) => {
  const row = page.locator('.history-row', { hasText: 'Merged history slice' });
  await expect(row).toBeVisible({ timeout: 10000 });
  await expect(row).toContainText('8001');

  // Outcome column is a single verdict (ff14af9): a merged slice is a success,
  // not a failure (ERROR / MAX_ROUNDS_EXHAUSTED / ESCALATED_TO_OBRIEN).
  await expect(row.locator('.outcome-pill.outcome-success')).toBeVisible();
});
