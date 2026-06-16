'use strict';

const { test, expect } = require('@playwright/test');

// THE UNHAPPY TWIN of gate-success-journey: the operator runs the gate and it FAILS.
//   held → press RUN GATE → (checkpoint → approve) → queued → regression running →
//   regression FAILED → "gate failed", main HELD (not promoted), the O'Brien handoff
//   popup appears, button returns so you can fix and retry.
// Same scripted-branch-state technique: step through the gate's lifecycle snapshots,
// forcing the dashboard's own poll, asserting the operator-visible UI on the gate-flow
// stepper (#gate-flow-steps) at each stage. Phase keys are the SERVER's real keys
// (regression / e2e / ff). Deterministic, real browser, zero workflow, zero merge.

const MAIN0 = 'aaaaaaa';   // main — must NOT move when the gate fails
const DEV   = 'bbbbbbb';   // the commit being gated
const PAUSE = process.env.E2E_SLOWMO ? 1600 : 150;

const phases = (reg, e2e, ff, regDur) => [
  { key: 'regression', label: 'regression',  status: reg, duration_s: regDur ?? null },
  { key: 'e2e',        label: 'e2e',          status: e2e, duration_s: e2e === 'passed' ? 34 : null },
  { key: 'ff',         label: 'fast-forward', status: ff,  duration_s: ff === 'passed' ? 1 : null },
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
  await page.route('**/api/tests-needed', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ decision: 'clear', head7: DEV, counts: {} }) }));
  await page.route('**/api/test-changes', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ anyChange: false }) }));

  async function gateTo(n) { cur = n; await page.evaluate(() => fetchBranchState()); await page.waitForTimeout(PAUSE); }

  await page.goto('/');
  const steps   = page.locator('#gate-flow-steps');
  const regStep = steps.locator('.gflow-step', { hasText: 'Regression' });
  const caption = page.locator('#gate-flow-caption');
  const btn     = page.locator('#promote-gate-btn');

  // Stage 0 · HELD — the gate hasn't run for this dev tip; press RUN GATE.
  await expect(regStep).not.toHaveClass(/gflow-passed/);
  await expect(btn).toContainText('RUN GATE');
  await page.waitForTimeout(PAUSE);

  // Press the button → Step-1 checkpoint → Approve dispatches the gate.
  await btn.click();
  const approve = page.locator('#utc-approve-btn');
  await expect(approve).toBeEnabled();
  await approve.click();

  // Stage 1 · QUEUED
  await gateTo(1);
  await expect(regStep).toHaveClass(/gflow-pending/);

  // Stage 2 · REGRESSION RUNNING
  await gateTo(2);
  await expect(regStep).toHaveClass(/gflow-running/);

  // Stage 3 · REGRESSION FAILED — the unhappy ending
  await gateTo(3);
  // The regression step reads FAILED (✗), not idle.
  await expect(regStep).toHaveClass(/gflow-failed/);
  await expect(regStep.locator('.gflow-glyph')).toHaveText('✗');
  // The gate flow flags the failure: the caption goes red and states main was held.
  await expect(caption.locator('.gflow-cap-fail')).toBeVisible();
  await expect(caption).toContainText('Stopped');
  await expect(caption).toContainText('main was not touched');
  // STOP — main was NOT promoted (no success caption), and control returns to fix + retry.
  await expect(page.locator('.gflow-cap-ok')).toHaveCount(0);
  await expect(btn).toContainText('RUN GATE');
  await expect(btn).toBeEnabled();

  // The journey no longer dead-ends: a popup hands the operator the exact prompt to send
  // O'Brien, who commissions a repair slice for Rom (no automated trigger yet).
  const popup = page.locator('#gate-failure-overlay');
  await expect(popup).toBeVisible();
  await expect(popup).toContainText('Regression suite failed');
  await expect(popup).toContainText('commission a repair slice'); // the O'Brien handoff intent
  const prompt = popup.locator('#gate-failure-prompt');
  await expect(prompt).toContainText('investigate the failing regression suite');
  await expect(prompt).toContainText(DEV);          // the failed commit, named for the fix
  await expect(prompt).toContainText('runs/99');    // deep link to investigate the failed run
  await expect(popup.locator('#gate-failure-copy')).toBeVisible();
});

test('a failed regression PHASE stops the ticking timer immediately and pops the O\'Brien handoff', async ({ page }) => {
  // The exact bug: promote_run.status is still 'in_progress' (GitHub finalizing) but the
  // regression PHASE has already failed — the timer must not keep ticking GATE RUNNING.
  const state = branchState({ mainSha: MAIN0, ahead: 1, promoteStatus: 'in_progress', promoteSha: DEV, ph: phases('failed', 'skipped', 'skipped', 2) });
  await page.route('**/api/branch-state', r => r.fulfill({ json: state }));
  await page.goto('/');

  await expect(page.locator('#promote-gate-btn')).not.toContainText('GATE RUNNING'); // no ticking
  const regStep = page.locator('#gate-flow-steps .gflow-step', { hasText: 'Regression' });
  await expect(regStep).toHaveClass(/gflow-failed/);
  await expect(page.locator('#gate-flow-caption')).toContainText('Stopped');
  const popup = page.locator('#gate-failure-overlay');
  await expect(popup).toBeVisible();
  await expect(popup.locator('#gate-failure-prompt')).toContainText('investigate the failing regression suite');
});

test('the O\'Brien prompt is copyable from the failure popup', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const state = branchState({ mainSha: MAIN0, ahead: 1, promoteStatus: 'failure', promoteSha: DEV, ph: phases('failed', 'skipped', 'skipped', 2) });
  await page.route('**/api/branch-state', r => r.fulfill({ json: state }));
  await page.goto('/');

  const copy = page.locator('#gate-failure-copy');
  await expect(copy).toBeVisible();
  await copy.click();
  await expect(copy).toContainText('Copied');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('investigate the failing regression suite');
  expect(clip).toContain(DEV);
});
