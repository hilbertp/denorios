'use strict';

const { test, expect } = require('@playwright/test');
const seedFixture = require('./seed-fixture');
const { seedRolledBackableSlice } = seedFixture;

// Journey: the operator rolls back the last promotion to main from the Branch
// Topology panel. The model is revert-forward-through-the-gate (ADR-ROLLBACK-MODEL):
// "Roll back" adds a git revert commit on dev and re-runs the gate — main stays
// fast-forward-only, nothing is reset or force-pushed.
//
// INERT by construction: every rollback endpoint is route-stubbed, so NO real
// git revert, NO real promote.yml dispatch, NO write to the live repo. The real
// branch-state shells out to git/gh (no .git in the fixture), so we stub it too —
// to enable the button (origin_main_sha present) and feed a deterministic preview.

const BRANCH_STATE = {
  schema_version: 1,
  main: { tip_sha: 'aaaaaaa' },
  dev: { tip_sha: 'bbbbbbb', commits_ahead_of_main: 0, commits: [] },
  last_merge: { sha: 'aaaaaaa', age_s: 120 },
  gate: { status: 'IDLE' },
  regression_risk: null,
  github: {
    origin_main_sha: 'aaaaaaa', origin_dev_sha: 'aaaaaaa',
    commits_ahead: 0, ahead: 0, dev_commits: [],
    promote: { sha: 'aaaaaaa', age_s: 120 },
    rr: { score: 0, level: 'clean', commits: 0, churn: 0, churn_ins: 0, churn_del: 0, critical_files: [], breakdown: {} },
    ci: { state: 'passing', run_number: 100, url: 'https://example.test/run', head_sha: 'aaaaaaa', updated_at: '2026-06-13T12:00:00.000Z' },
    promote_run: { status: 'success', run_id: 1, url: 'https://example.test/run', head_sha7: 'aaaaaaa', updated_at: '2026-06-13T12:00:00.000Z' },
    error: null,
  },
};

const PREVIEW = {
  ok: true,
  target_sha: 'aaaaaaa',
  pending_commits: [{ sha: 'aaaaaaa', slice_id: '7001', subject: 'Pipeline lifecycle slice' }],
  dev_level_with_main: true,
};

async function stubRollback(page, { onDispatch } = {}) {
  await page.route('**/api/branch-state', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BRANCH_STATE) }));
  await page.route('**/api/rollback/preview**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PREVIEW) }));
  await page.route('**/api/rollback/dispatch', async route => {
    if (onDispatch) onDispatch();
    await new Promise(r => setTimeout(r, 300));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, revert_sha: 'rev1234' }) });
  });
}

test('the topology Roll back button opens a preview of what reverts, then dispatches the revert-forward (inert)', async ({ page }) => {
  let dispatched = false;
  await stubRollback(page, { onDispatch: () => { dispatched = true; } });
  await page.goto('/');

  // The Roll back button sits in the Branch Topology footer, enabled (main has a promotion).
  const rollback = page.locator('#topo-rollback-btn');
  await expect(rollback).toBeVisible();
  await expect(rollback).toBeEnabled();
  await expect(rollback).toContainText('Roll back');

  // Opening it shows the confirm card with the preview of what fast-forwards onto main.
  await rollback.click();
  const card = page.locator('.rollback-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Roll back the last promotion');
  await expect(card.locator('.rb-revert')).toContainText('revert of aaaaaaa'); // main's last promotion

  // Confirm → POST /api/rollback/dispatch (stubbed). Overlay closes; a toast names
  // the revert and confirms the gate is running (rollback IS a promote dispatch).
  await card.locator('#rollback-confirm-btn').click();
  await expect(page.locator('#rollback-overlay')).toHaveCount(0);
  const toast = page.locator('.return-toast');
  await expect(toast).toContainText('revert rev1234'); // the revert commit on dev
  await expect(toast).toContainText('gate running');   // re-runs the gate before main moves
  expect(dispatched).toBe(true);                       // only the stub was hit — no real revert/promote
});

test('Cancel dismisses the rollback confirm without dispatching anything', async ({ page }) => {
  let dispatched = false;
  await stubRollback(page, { onDispatch: () => { dispatched = true; } });
  await page.goto('/');

  await page.locator('#topo-rollback-btn').click();
  const card = page.locator('.rollback-card');
  await expect(card).toBeVisible();

  await card.locator('.rb-btn-cancel').click();
  await expect(page.locator('#rollback-overlay')).toHaveCount(0);
  expect(dispatched).toBe(false);             // cancelling must never trigger a rollback
});

// Second rollback entry point: the per-slice "Roll back" button inside a History row's
// expanded detail (offered only for slices that reached main AND carry a squash commit).
// Uses the real /api/bridge to render the history row from seeded events; preview +
// dispatch are stubbed so the revert stays inert.
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
    await expect(card.locator('.rb-revert')).toContainText('slice #8200');

    // Confirm → inert dispatch + a toast naming the revert. No real revert/promote.
    await card.locator('#rollback-confirm-btn').click();
    await expect(page.locator('#rollback-overlay')).toHaveCount(0);
    await expect(page.locator('.return-toast')).toContainText('rev8200');
    expect(dispatched).toBe(true);
  });
});
