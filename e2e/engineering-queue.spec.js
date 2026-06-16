'use strict';

const { test, expect } = require('@playwright/test');
const { resetQueueState } = require('./seed-fixture');

// Journey: O'Brien's Engineering Queue — approving a Proposed Improvement promotes it to
// Approved Work Orders. This is a REAL end-to-end: browser click → POST /approve → the
// server moves staged/{id}-STAGED.md → queue/{id}-QUEUED.md → the UI re-renders the row.

// Reset fixture state before each mutating journey so they don't interfere.
test.beforeEach(async ({ page }) => {
  resetQueueState();
  await page.goto('/');
});

test('a Proposed Improvement is shown and can be approved into Approved Work Orders', async ({ page }) => {
  const row = page.locator('.queue-row[data-id="9001"]');
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('data-state', 'STAGED');
  await expect(row).toContainText('first proposal');

  // Approve it (the inline ✓ Approve button).
  await row.locator('.queue-btn-accept').click();

  // The same slice now renders as an Approved Work Order (state flips STAGED → QUEUED).
  await expect(page.locator('.queue-row[data-id="9001"]')).toHaveAttribute('data-state', 'QUEUED');
});

test('the section labels are the DS9 names, not Queue/Stage', async ({ page }) => {
  await expect(page.locator('.queue-section-label', { hasText: 'Approved Work Orders' })).toBeVisible();
  await expect(page.locator('.queue-section-label', { hasText: 'Proposed Improvement' })).toBeVisible();
  await expect(page.locator('.section-title', { hasText: 'Backlog Queue' })).toBeVisible();
});

test('standing Auto-approve promotes every proposal automatically', async ({ page }) => {
  // Both proposals start in the staged section.
  await expect(page.locator('.queue-row[data-id="9001"][data-state="STAGED"]')).toBeVisible();
  await expect(page.locator('.queue-row[data-id="9002"][data-state="STAGED"]')).toBeVisible();

  // Flip the standing auto-approve toggle on.
  await page.locator('.auto-approve-toggle').click();
  await expect(page.locator('.auto-approve-active')).toBeVisible(); // "· promoting automatically"

  // Both proposals drain to QUEUED with no further clicks. The list re-renders on
  // each poll and tags the outgoing row `.row-exiting` mid-animation, so a bare
  // data-id selector transiently matches two elements — scope to the settled
  // (non-exiting) row and assert no STAGED proposal remains for the id.
  for (const id of ['9001', '9002']) {
    await expect(page.locator(`.queue-row[data-id="${id}"][data-state="STAGED"]:not(.row-exiting)`)).toHaveCount(0);
    await expect(page.locator(`.queue-row[data-id="${id}"]:not(.row-exiting)`)).toHaveAttribute('data-state', 'QUEUED');
  }
});
