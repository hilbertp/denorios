'use strict';

const { test, expect } = require('@playwright/test');

// Unhappy paths for the RUN GATE button's dispatch: every way POST /api/promote/dispatch
// can fail must surface a readable error to the operator — and must NOT claim success or
// move main. Covers 409 nothing_to_promote, 409 gate_already_running, 502 dispatch_failed,
// and a network error. RUN GATE now opens a Step-1 checkpoint; Approve is what dispatches,
// so each case clicks through the checkpoint, then asserts the error on the live
// .promote-gate-err slot (the CI strip that used to show it was removed).

const ENABLED = {
  schema_version: 1,
  main: { tip_sha: 'aaaaaaa' },
  dev: { tip_sha: 'bbbbbbb', commits_ahead_of_main: 2, commits: [{ sha: 'bbbbbbb', slice_id: '321', subject: 'x', age_s: 30 }] },
  last_merge: { sha: 'aaaaaaa', age_s: 120 }, gate: { status: 'IDLE' }, regression_risk: null,
  github: {
    origin_main_sha: 'aaaaaaa', origin_dev_sha: 'bbbbbbb', commits_ahead: 2, ahead: 2,
    dev_commits: [{ sha: 'bbbbbbb', slice_id: '321', subject: 'x', age_s: 30 }],
    promote: { sha: 'aaaaaaa', age_s: 120 },
    rr: { score: 20, level: 'low', commits: 2, churn: 100, churn_ins: 60, churn_del: 40, critical_files: [], breakdown: {} },
    ci: { state: 'passing', run_number: 42, url: 'https://example.test/ci', head_sha: 'bbbbbbb', updated_at: '2026-06-13T12:00:00.000Z' },
    // stale success ⇒ held + button enabled; clicking dispatches.
    promote_run: { status: 'success', run_id: 1, url: 'https://example.test/run', head_sha7: 'aaaaaaa', updated_at: '2026-06-13T12:00:00.000Z', phases: [] },
    error: null,
  },
};

// The Step-1 checkpoint fetches the verdict (CLEAR ⇒ Approve enabled) + the change list.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/tests-needed', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ decision: 'clear', head7: 'bbbbbbb', counts: {} }) }));
  await page.route('**/api/test-changes', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ anyChange: false }) }));
  await page.route('**/api/check-test-updates', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ready: true, summary: { checked: 3, passed: 3, autoUpdate: 0, flagged: 0, kept: 0 }, flagged: [], verdict: 'CLEAR' }) }));
});

// RUN GATE → checkpoint → Approve (the path that actually dispatches the gate).
async function approveAndRun(page) {
  await page.locator('#promote-gate-btn').click();
  const approve = page.locator('#utc-approve-btn');
  await expect(approve).toBeEnabled();
  await approve.click();
}

// Stage ① — "Check for test updates" gates the merge; drive it (CLEAR ⇒ unlocks RUN GATE).
async function passCheck(page) {
  const checkBtn = page.locator('#check-updates-btn');
  await expect(checkBtn).toBeEnabled();
  await checkBtn.click();
  await expect(page.locator('#promote-gate-btn')).toBeEnabled();
}

const CASES = [
  { name: '409 nothing_to_promote', fulfill: { status: 409, body: { ok: false, error: 'nothing_to_promote' } }, expectText: 'nothing to promote' },
  { name: '409 gate_already_running', fulfill: { status: 409, body: { ok: false, error: 'gate_already_running' } }, expectText: 'gate already running' },
  { name: '502 dispatch_failed', fulfill: { status: 502, body: { ok: false, error: 'dispatch_failed', detail: 'gh: auth required' } }, expectText: 'dispatch failed' },
];

for (const c of CASES) {
  test(`dispatch error: ${c.name} → button surfaces it, no false success`, async ({ page }) => {
    await page.route('**/api/branch-state', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ENABLED) }));
    await page.route('**/api/promote/dispatch', r =>
      r.fulfill({ status: c.fulfill.status, contentType: 'application/json', body: JSON.stringify(c.fulfill.body) }));

    await page.goto('/');
    const btn = page.locator('#promote-gate-btn');
    await passCheck(page);
    await approveAndRun(page);

    await expect(page.locator('.promote-gate-err:visible').first()).toContainText(c.expectText);
    // It must never read as a started/running gate, nor a promotion, from a failed dispatch.
    await expect(btn).not.toContainText('GATE RUNNING');
    await expect(page.locator('.gflow-cap-ok')).toHaveCount(0);
  });
}

test('dispatch error: network failure → "dispatch failed: network error"', async ({ page }) => {
  await page.route('**/api/branch-state', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ENABLED) }));
  await page.route('**/api/promote/dispatch', r => r.abort()); // network-level failure

  await page.goto('/');
  const btn = page.locator('#promote-gate-btn');
  await passCheck(page);
  await approveAndRun(page);

  await expect(page.locator('.promote-gate-err:visible').first()).toContainText('network error');
  await expect(btn).not.toContainText('GATE RUNNING');
});
