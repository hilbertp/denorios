'use strict';

const { test, expect } = require('@playwright/test');

// THE FULL GATE-SUCCESS CLICKTEST — the journey Philipp watched succeed by hand:
//   held → press RUN GATE → queued → regression running → regression passed →
//   e2e running → e2e passed → fast-forward → main promoted.
//
// How (without a real 70s GitHub run or a real merge): the whole dashboard is a pure
// function of /api/branch-state. So we stub that endpoint with a SEQUENCE of snapshots —
// the gate's lifecycle — and step through it, forcing the dashboard's own
// fetchBranchState() poll between steps and asserting the operator-visible UI at each
// stage. Deterministic, real browser, zero workflow, zero merge. (The gh→phases mapping
// is unit-tested in j-promote-gate-phases; promote.yml ordering in j-merge-button-pass.)
//
// E2E_SLOWMO=<ms> lengthens the pause between stages so a human can watch it --headed.

const MAIN0 = 'aaaaaaa';   // main before promotion
const DEV   = 'bbbbbbb';   // the commit being gated + promoted
const PAUSE = process.env.E2E_SLOWMO ? 1600 : 150;

const phases = (reg, e2e, ff, regDur) => [
  { key: 'regression',   label: 'regression',   status: reg, duration_s: regDur ?? null },
  { key: 'e2e',          label: 'e2e',           status: e2e, duration_s: e2e === 'passed' ? 34 : null },
  { key: 'fast-forward', label: 'fast-forward',  status: ff,  duration_s: ff === 'passed' ? 1 : null },
];

function branchState({ mainSha, ahead, promoteStatus, promoteSha, ph, promoted }) {
  const devCommits = ahead > 0 ? [{ sha: DEV, slice_id: '700', subject: 'Gate success journey', age_s: 30 }] : [];
  return {
    schema_version: 1,
    main: { tip_sha: mainSha },
    dev: { tip_sha: DEV, commits_ahead_of_main: ahead, commits: devCommits },
    last_merge: { sha: mainSha, age_s: 60 },
    gate: { status: 'IDLE' },
    regression_risk: null,
    github: {
      origin_main_sha: mainSha, origin_dev_sha: DEV,
      commits_ahead: ahead, ahead,
      dev_commits: devCommits,
      promote: promoted ? { sha: DEV, age_s: 1 } : { sha: mainSha, age_s: 60 },
      rr: { score: 10, level: 'low', commits: ahead, churn: 40, churn_ins: 30, churn_del: 10, critical_files: [], breakdown: {} },
      ci: { state: 'passing', run_number: 50, url: 'https://example.test/ci/50', head_sha: DEV, updated_at: '2026-06-13T12:00:00.000Z' },
      promote_run: { status: promoteStatus, run_id: 99, url: 'https://example.test/run/99', head_sha7: promoteSha, updated_at: '2026-06-13T12:30:00.000Z', ph_marker: 1, phases: ph },
      error: null,
    },
  };
}

// The gate's lifecycle, one snapshot per stage.
const LIFECYCLE = [
  /* 0 HELD     */ branchState({ mainSha: MAIN0, ahead: 1, promoteStatus: 'success',     promoteSha: MAIN0, ph: phases('passed', 'passed', 'passed', 2), promoted: false }), // stale ⇒ held
  /* 1 QUEUED   */ branchState({ mainSha: MAIN0, ahead: 1, promoteStatus: 'pending',     promoteSha: DEV,   ph: phases('pending', 'pending', 'pending') }),
  /* 2 REG RUN  */ branchState({ mainSha: MAIN0, ahead: 1, promoteStatus: 'in_progress', promoteSha: DEV,   ph: phases('running', 'pending', 'pending') }),
  /* 3 REG PASS */ branchState({ mainSha: MAIN0, ahead: 1, promoteStatus: 'in_progress', promoteSha: DEV,   ph: phases('passed', 'running', 'pending', 2) }),
  /* 4 E2E PASS */ branchState({ mainSha: MAIN0, ahead: 1, promoteStatus: 'in_progress', promoteSha: DEV,   ph: phases('passed', 'passed', 'running', 2) }),
  /* 5 PROMOTED */ branchState({ mainSha: DEV,   ahead: 0, promoteStatus: 'success',     promoteSha: DEV,   ph: phases('passed', 'passed', 'passed', 2), promoted: true }),
];

test('full gate-success clicktest: held → run gate → regression → e2e → fast-forward → promoted', async ({ page }) => {
  let cur = 0;
  await page.route('**/api/branch-state', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LIFECYCLE[cur]) }));
  await page.route('**/api/promote/dispatch', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }));

  // Advance to the next lifecycle snapshot and force the dashboard to re-poll.
  async function gateTo(n) {
    cur = n;
    await page.evaluate(() => fetchBranchState());
    await page.waitForTimeout(PAUSE);
  }

  await page.goto('/');
  const regression = page.locator('#ci-strip-regression-text');
  const promote    = page.locator('#ci-strip-promote-text');
  const btn        = page.locator('#promote-gate-btn');

  // ── Stage 0 · HELD — nothing gated yet, no green tick ──────────────────────
  await expect(regression).toContainText('not run in the gate yet');
  await expect(promote).toContainText('held');
  await expect(btn).toContainText('RUN GATE');
  await expect(btn).toBeEnabled();
  await page.waitForTimeout(PAUSE);

  // ── Press the button ───────────────────────────────────────────────────────
  await btn.click();

  // ── Stage 1 · QUEUED — the run exists, nothing passed yet ──────────────────
  await gateTo(1);
  await expect(regression).toContainText('queued in the gate');
  await expect(promote.locator('.gate-phase-passed')).toHaveCount(0); // nothing green yet

  // ── Stage 2 · REGRESSION RUNNING ───────────────────────────────────────────
  await gateTo(2);
  await expect(regression).toContainText('running in the gate');

  // ── Stage 3 · REGRESSION PASSED (with duration), E2E RUNNING ───────────────
  await gateTo(3);
  await expect(regression).toContainText('passed in the gate');
  await expect(regression).toContainText('2s');
  await expect(promote.locator('.gate-phase-passed', { hasText: 'regression' })).toBeVisible();
  await expect(promote.locator('.gate-phase-running', { hasText: 'e2e' })).toBeVisible();

  // ── Stage 4 · E2E PASSED (34s — proves it really ran), FAST-FORWARD RUNNING ─
  await gateTo(4);
  await expect(promote.locator('.gate-phase-passed', { hasText: 'e2e' })).toContainText('34s');
  await expect(promote.locator('.gate-phase-running', { hasText: 'fast-forward' })).toBeVisible();

  // ── Stage 5 · PROMOTED — main fast-forwarded, nothing left to gate ─────────
  await gateTo(5);
  await expect(promote).toContainText('main fast-forwarded');
  await expect(promote).toContainText(DEV);
  await expect(btn).not.toContainText('GATE RUNNING');
});
