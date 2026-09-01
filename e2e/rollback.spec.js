'use strict';

const { test, expect } = require('@playwright/test');
const seedFixture = require('./seed-fixture');
const { seedRolledBackableSlice } = seedFixture;

// Journey: the operator rolls back a merged slice from its History row. The model is
// revert-forward-through-the-gate (ADR-ROLLBACK-MODEL): "Roll back" adds a git revert
// commit on dev and re-runs the gate — main stays fast-forward-only, nothing is reset
// or force-pushed.
//
// NOTE: the older Branch-Topology "Roll back" button (#topo-rollback-btn) was removed in
// slice 343 (F-REMOVE-ROLLBACK); its e2e tests were trimmed with it (this file's two
// topology tests + the whole rollback-errors.spec.js). The History row is now the SOLE
// rollback entry point, and the test below is its coverage.
//
// The per-slice "Roll back" button inside a History row's expanded detail is offered only
// for slices that reached main AND carry a squash commit. Uses the real /api/bridge to
// render the history row from seeded events; preview + dispatch are stubbed so the revert
// stays inert (no real git revert, no real promote.yml dispatch).
test.describe('History-row rollback', () => {
  test.afterAll(() => { seedFixture(); }); // restore default register for other specs

  test('a merged slice can be rolled back from its History row (preview → confirm, inert)', async ({ page }) => {
    seedRolledBackableSlice('8200');
    let dispatched = false;
    await page.route('**/api/rollback/preview**', route =>
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, slice_id: '8200', squash_sha: 'sq45678', pending_commits: [], dev_level_with_main: true }) }));
    await page.route('**/api/rollback/dispatch', async route => {
      dispatched = true;
      await new Promise(r => setTimeout(r, 300));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, revert_sha: 'rev8200' }) });
    });

    await page.goto('/');

    // The merged slice shows in History; expand the row to reveal its actions.
    const row = page.locator('.history-row', { hasText: 'Rolled-backable slice' });
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.locator('.history-chevron').click();

    // Its Roll back button (rendered only because the row is onMain + has a squash_sha).
    const rollBtn = row.locator('.rollback-btn');
    await expect(rollBtn).toBeVisible();
    await rollBtn.click();

    // The per-slice confirm card names what the revert undoes.
    const card = page.locator('.rollback-card');
    await expect(card).toBeVisible();
    await expect(card.locator('.rb-revert')).toContainText('S8200');

    // Confirm → inert dispatch + a toast naming the revert. No real revert/promote.
    await card.locator('#rollback-confirm-btn').click();
    await expect(page.locator('#rollback-overlay')).toHaveCount(0);
    await expect(page.locator('.return-toast')).toContainText('rev8200');
    expect(dispatched).toBe(true);
  });
});
