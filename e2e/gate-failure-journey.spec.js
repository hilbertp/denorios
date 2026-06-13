'use strict';

const { test, expect } = require('@playwright/test');

// THE UNHAPPY TWIN of gate-success-journey: the operator runs the gate and it FAILS.
//   held → press RUN GATE → queued → regression running → regression FAILED →
//   "gate failed", main HELD (not promoted), button returns so you can fix and retry.
// Same scripted-branch-state technique: step through the gate's lifecycle snapshots,
// forcing the dashboard's own poll, asserting the operator-visible UI at each stage.
// Deterministic, real browser, zero workflow, zero merge.

const MAIN0 = 'aaaaaaa';   // main — must NOT move when the gate fails
const DEV   = 'bbbbbbb';   // the commit being gated
const PAUSE = process.env.E2E_SLOWMO ? 1600 : 150;

const phases = (reg, e2e, ff, regDur) => [
  { key: 'regression',   label: 'regression',   status: reg, duration_s: regDur ?? null },
  { key: 'e2e',          label: 'e2e',           status: e2e, duration_s: e2e === 'passed' ? 34 : null },
  { key: 'fast-forward', label: 'fast-forward',  status: ff,  duration_s: ff === 'passed' ? 1 : null },
];

function branchState({ mainSha, ahead, promoteStatus, promoteSha, ph }) {
  return {
    schema_version: 1,
    main: { tip_sha: mainSha },
    dev: { tip_sha: DEV, commits_ahead_of_main: ahead, commits: ahead > 0 ? [{ sha: DEV, slice_id: '701', subject: 'Gate failure journey', age_s: 30 }] : [] },
    last_merge: { sha: mainSha, age_s: 60 },
    gate: { status: 'IDLE' },
    regression_risk: null,
    github: {
      origin_main_sha: mainSha, origin_dev_sha: DEV, commits_ahead: ahead, ahead,
      dev_commits: ahead > 0 ? [{ sha: DEV, slice_id: '701', subject: 'Gate failure journey', age_s: 30 }] : [],
      promote: { sha: mainSha, age_s: 60 },
      rr: { score: 10, level: 'low', commits: ahead, churn: 40, churn_ins: 30, churn_del: 10, critical_files: [], breakdown: {} },
      ci: { state: 'passing', run_number: 50, url: 'https://example.test/ci/50', head_sha: DEV, updated_at: '2026-06-13T12:00:00.000Z' },
      promote_run: { status: promoteStatus, run_id: 99, url: 'https://github.com/hilbertp/liberation-of-bajor/actions/runs/99', head_sha7: promoteSha, updated_at: '2026-06-13T12:30:00.000Z', phases: ph },
      error: null,
    },
  };
}

const LIFECYCLE = [
  /* 0 HELD     */ branchState({ mainSha: MAIN0, ahead: 1, promoteStatus: 'success',     promoteSha: MAIN0, ph: phases('passed', 'passed', 'passed', 2) }), // stale ⇒ held
  /* 1 QUEUED   */ branchState({ mainSha: MAIN0, ahead: 1, promoteStatus: 'pending',     promoteSha: DEV,   ph: phases('pending', 'pending', 'pending') }),
  /* 2 REG RUN  */ branchState({ mainSha: MAIN0, ahead: 1, promoteStatus: 'in_progress', promoteSha: DEV,   ph: phases('running', 'pending', 'pending') }),
  /* 3 REG FAIL */ branchState({ mainSha: MAIN0, ahead: 1, promoteStatus: 'failure',     promoteSha: DEV,   ph: phases('failed', 'skipped', 'skipped', 2) }), // main HELD
];

test('full gate-FAILURE clicktest: held → run gate → regression FAILS → gate failed, main held', async ({ page }) => {
  let cur = 0;
  await page.route('**/api/branch-state', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LIFECYCLE[cur]) }));
  await page.route('**/api/promote/dispatch', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }));

  async function gateTo(n) { cur = n; await page.evaluate(() => fetchBranchState()); await page.waitForTimeout(PAUSE); }

  await page.goto('/');
  const regression = page.locator('#ci-strip-regression-text');
  const promote    = page.locator('#ci-strip-promote-text');
  const strip      = page.locator('#ci-strip');
  const btn        = page.locator('#promote-gate-btn');

  // Stage 0 · HELD
  await expect(regression).toContainText('not run in the gate yet');
  await expect(promote).toContainText('held');
  await expect(btn).toContainText('RUN GATE');
  await page.waitForTimeout(PAUSE);

  await btn.click();

  // Stage 1 · QUEUED
  await gateTo(1);
  await expect(regression).toContainText('queued in the gate');

  // Stage 2 · REGRESSION RUNNING
  await gateTo(2);
  await expect(regression).toContainText('running in the gate');

  // Stage 3 · REGRESSION FAILED — the unhappy ending
  await gateTo(3);
  // The fix: the regression row reads FAILED (not "not run in the gate yet").
  await expect(regression).toContainText('failed in the gate');
  await expect(page.locator('#ci-strip-regression-glyph')).toHaveText('✗');
  // The promote row flags the gate failure with a deep link to investigate.
  await expect(promote).toContainText('gate failed');
  await expect(promote.locator('.gate-phase-failed', { hasText: 'regression' })).toBeVisible();
  await expect(page.locator('#ci-strip-promote-link')).toHaveAttribute('href', /actions\/runs\/99/);
  // The whole strip turns red.
  await expect(strip).toHaveAttribute('data-state', 'fail');
  // STOP — main was NOT promoted, and control returns so you can fix + retry.
  await expect(promote).not.toContainText('fast-forwarded');
  await expect(btn).toContainText('RUN GATE');
  await expect(btn).toBeEnabled();
});
