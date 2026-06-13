'use strict';

const { test, expect } = require('@playwright/test');

// Unhappy paths for the topology ROLL BACK button: when the rollback preview reports a
// problem, the confirm card must SHOW the reason and keep the confirm button disabled —
// it must never let the operator dispatch a rollback that can't work.

const ROLLBACKABLE = {
  schema_version: 1,
  main: { tip_sha: 'aaaaaaa' },
  dev: { tip_sha: 'aaaaaaa', commits_ahead_of_main: 0, commits: [] },
  last_merge: { sha: 'aaaaaaa', age_s: 120 }, gate: { status: 'IDLE' }, regression_risk: null,
  github: {
    origin_main_sha: 'aaaaaaa', origin_dev_sha: 'aaaaaaa', commits_ahead: 0, ahead: 0, dev_commits: [],
    promote: { sha: 'aaaaaaa', age_s: 120 },
    rr: { score: 0, level: 'clean', commits: 0, churn: 0, churn_ins: 0, churn_del: 0, critical_files: [], breakdown: {} },
    ci: { state: 'passing', run_number: 100, url: 'https://example.test/ci', head_sha: 'aaaaaaa', updated_at: '2026-06-13T12:00:00.000Z' },
    promote_run: { status: 'success', run_id: 1, url: 'https://example.test/run', head_sha7: 'aaaaaaa', updated_at: '2026-06-13T12:00:00.000Z', phases: [] },
    error: null,
  },
};

const PREVIEW_ERRORS = [
  { name: 'unknown_sha', error: 'unknown_sha', expectText: 'no commit to revert' },
  { name: 'not_on_main', error: 'not_on_main',  expectText: 'nothing on main to roll back' },
];

for (const c of PREVIEW_ERRORS) {
  test(`rollback preview error: ${c.name} → confirm card shows the reason, confirm stays disabled, nothing dispatches`, async ({ page }) => {
    await page.route('**/api/branch-state', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROLLBACKABLE) }));
    await page.route('**/api/rollback/preview**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: c.error }) }));
    let dispatched = false;
    await page.route('**/api/rollback/dispatch', r => { dispatched = true; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }); });

    await page.goto('/');
    await page.locator('#topo-rollback-btn').click();

    const card = page.locator('.rollback-card');
    await expect(card).toBeVisible();
    await expect(card.locator('.rollback-error')).toContainText(c.expectText);
    await expect(card.locator('#rollback-confirm-btn')).toBeDisabled();

    // Even if the operator tries, a disabled confirm dispatches nothing.
    await card.locator('#rollback-confirm-btn').click({ force: true }).catch(() => {});
    expect(dispatched).toBe(false);
  });
}

test('rollback preview network error → the card shows it could not load, confirm disabled', async ({ page }) => {
  await page.route('**/api/branch-state', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROLLBACKABLE) }));
  await page.route('**/api/rollback/preview**', r => r.abort());

  await page.goto('/');
  await page.locator('#topo-rollback-btn').click();

  const card = page.locator('.rollback-card');
  await expect(card).toBeVisible();
  await expect(card.locator('.rollback-error')).toBeVisible();
  await expect(card.locator('#rollback-confirm-btn')).toBeDisabled();
});
