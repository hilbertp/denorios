'use strict';

const { test, expect } = require('@playwright/test');

// Journey: the operator presses "RUN GATE & MERGE TO MAIN". RUN GATE now opens a Step-1
// "Update tests" checkpoint; Approve dispatches. We assert the immediate, pre-network
// acknowledgement (DISPATCHING…) and the running/failed/held states on the gate-flow
// stepper (#gate-flow-steps) + caption (#gate-flow-caption). The gate stays INERT: no
// real gh dispatch, no real merge. Phase keys are the SERVER's real keys (regression /
// e2e / ff) — using the dashboard's display key would let an ff/fast-forward drift hide.
//
// Routes stubbed for determinism + zero side effects:
//   • GET /api/branch-state    — serve commits-ahead + promote_run state to drive the UI.
//   • GET /api/tests-needed     — the checkpoint verdict (CLEAR ⇒ Approve enabled).
//   • GET /api/test-changes     — the checkpoint's plain-language change list.
//   • POST /api/promote/dispatch — fake 200 so the real workflow_dispatch never runs.

const AHEAD_BRANCH_STATE = {
  schema_version: 1,
  main: { tip_sha: 'aaaaaaa' },
  dev: {
    tip_sha: 'bbbbbbb',
    commits_ahead_of_main: 2,
    commits: [{ sha: 'bbbbbbb', slice_id: '321', subject: 'E2E ahead commit', age_s: 60 }],
  },
  last_merge: { sha: 'aaaaaaa', age_s: 3600 },
  gate: { status: 'IDLE' },
  regression_risk: null,
  github: {
    origin_main_sha: 'aaaaaaa', origin_dev_sha: 'bbbbbbb',
    commits_ahead: 2, ahead: 2,
    dev_commits: [{ sha: 'bbbbbbb', slice_id: '321', subject: 'E2E ahead commit', age_s: 60 }],
    promote: { sha: 'aaaaaaa', age_s: 3600 },
    rr: { score: 20, level: 'low', commits: 2, churn: 100, churn_ins: 60, churn_del: 40, critical_files: [], breakdown: {} },
    ci: { state: 'passing', run_number: 42, url: 'https://example.test/run', head_sha: 'bbbbbbb', updated_at: '2026-06-13T12:00:00.000Z' },
    promote_run: { status: 'idle', run_id: null, url: null, head_sha7: null, updated_at: null },
    error: null,
  },
};

// The Step-1 checkpoint fetches these; CLEAR ⇒ Approve enabled, no second-ack needed.
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

test('RUN GATE acknowledges the click instantly (DISPATCHING → GATE RUNNING) with no real dispatch', async ({ page }) => {
  await page.route('**/api/branch-state', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AHEAD_BRANCH_STATE) }));

  // Keep the gate inert: never let the real dispatch run. Delay the fake 200 so the
  // synchronous, pre-network DISPATCHING… state is observable.
  let dispatchCalled = false;
  await page.route('**/api/promote/dispatch', async route => {
    dispatchCalled = true;
    await new Promise(r => setTimeout(r, 700));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/');

  const btn = page.locator('#promote-gate-btn');
  await passCheck(page);
  await expect(btn).toContainText('RUN GATE');

  await approveAndRun(page);

  // Pre-network acknowledgement: Approve flips the button before the fetch resolves.
  await expect(btn).toContainText('DISPATCHING');
  // After the (stubbed) 200, the optimistic running window holds the button.
  await expect(btn).toContainText('GATE RUNNING', { timeout: 7000 });

  // The real promote workflow was never triggered — only our stub was hit.
  expect(dispatchCalled).toBe(true);
});

// Watch an IMPERFECT run get flagged: press RUN GATE, the gate runs, then comes back
// red — the dashboard VISIBLY flips to a flagged "gate failed" state, stops, and hands
// control back via the O'Brien handoff popup (Philipp: "on yellow or red, we stop and
// flag to the user"). A "yellow" run (cancelled/timed_out) is normalized to `failure`
// server-side, so it lands on this same flag path. main must stay untouched.
const FAILURE_RUN = {
  status: 'failure', run_id: 77,
  url: 'https://github.com/hilbertp/liberation-of-bajor/actions/runs/77',
  head_sha7: 'bbbbbbb', updated_at: '2026-06-13T12:30:00.000Z',
  phases: [
    { key: 'regression', label: 'regression', status: 'failed', duration_s: 2 },
    { key: 'e2e', label: 'e2e', status: 'skipped', duration_s: null },
    { key: 'ff', label: 'fast-forward', status: 'skipped', duration_s: null },
  ],
};
const IDLE_RUN = { status: 'idle', run_id: null, url: null, head_sha7: null, updated_at: null };

test('clicking RUN GATE on a run that fails: the dashboard visibly flips to a flagged gate-failed state', async ({ page }) => {
  let failed = false;       // becomes true a moment after dispatch — the run "comes back red"
  let dispatchCount = 0;
  const branchState = (promoteRun) => {
    const s = JSON.parse(JSON.stringify(AHEAD_BRANCH_STATE));
    s.github.promote_run = promoteRun;
    return JSON.stringify(s);
  };

  await page.route('**/api/branch-state', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: branchState(failed ? FAILURE_RUN : IDLE_RUN) }));
  await page.route('**/api/promote/dispatch', route => {
    dispatchCount++;
    setTimeout(() => { failed = true; }, 1500); // the gate runs, then the run reports failure
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/');
  const btn = page.locator('#promote-gate-btn');
  await expect(btn).toContainText('RUN GATE');
  await passCheck(page);
  await approveAndRun(page);
  await expect(btn).toContainText('GATE RUNNING'); // the run is going…

  // …then it comes back imperfect — the dashboard FLAGS it, loudly and visibly.
  const caption = page.locator('#gate-flow-caption');
  await expect(caption.locator('.gflow-cap-fail')).toBeVisible({ timeout: 12000 });
  await expect(caption).toContainText('main was not touched');
  // The O'Brien handoff popup pops with a deep link to investigate the failed run.
  const popup = page.locator('#gate-failure-overlay');
  await expect(popup).toBeVisible();
  await expect(popup.locator('#gate-failure-prompt')).toContainText('runs/77');

  // STOP, don't promote: no success caption, and control returns to the operator.
  await expect(page.locator('.gflow-cap-ok')).toHaveCount(0);
  await expect(btn).toContainText('RUN GATE');
  await expect(btn).toBeEnabled();
  expect(dispatchCount).toBe(1); // exactly one run — the failure never silently re-fired
});

// REGRESSION GUARD for the "it skipped directly to merge" bug: a promote_run that
// SUCCEEDED for an already-promoted sha is STALE once dev moves ahead. It must NOT read
// as "fast-forwarded ✓" with green phases — that hid that the new commits were ungated.
// Dev ahead + a stale success must show held ("press RUN GATE") with no stale green.
const STALE_SUCCESS = JSON.parse(JSON.stringify(AHEAD_BRANCH_STATE)); // main=aaaaaaa, dev=bbbbbbb, ahead 2
STALE_SUCCESS.github.promote_run = {
  status: 'success', run_id: 70, url: 'https://example.test/run/70',
  head_sha7: 'aaaaaaa', // the OLD sha (already on main) — NOT the current dev tip bbbbbbb
  updated_at: '2026-06-13T12:00:00.000Z',
  phases: [
    { key: 'regression', label: 'regression', status: 'passed', duration_s: 2 },
    { key: 'e2e', label: 'e2e', status: 'passed', duration_s: 34 },
    { key: 'ff', label: 'fast-forward', status: 'passed', duration_s: 1 },
  ],
};

test('a stale success (already-promoted sha) does NOT read as merged while dev is ahead — it shows held/ungated', async ({ page }) => {
  await page.route('**/api/branch-state', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STALE_SUCCESS) }));
  await page.goto('/');

  const steps  = page.locator('#gate-flow-steps');
  const caption = page.locator('#gate-flow-caption');
  // Held — the new commits are ungated. The gate trigger (button) still says RUN GATE; no success caption.
  await expect(page.locator('#promote-gate-btn')).toContainText('RUN GATE');
  await expect(caption.locator('.gflow-cap-ok')).toHaveCount(0);
  // No stale green: none of the suite steps may paint the old run's done state as the current gate.
  for (const name of ['regression', 'E2E smoke', 'promote']) {
    const node = steps.locator('.dvs-node', { hasText: name });
    await expect(node.locator('.dvs-box')).not.toHaveClass(/done/);
  }

  // The button is live to actually gate the new commits.
  const btn = page.locator('#promote-gate-btn');
  await expect(btn).toContainText('RUN GATE');
  await passCheck(page);
});

test('clicking RUN GATE past a stale success shows GATE RUNNING (optimism is not cancelled by the old ✓)', async ({ page }) => {
  await page.route('**/api/branch-state', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STALE_SUCCESS) }));
  await page.route('**/api/promote/dispatch', async route => {
    await new Promise(r => setTimeout(r, 400));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.goto('/');

  const btn = page.locator('#promote-gate-btn');
  await passCheck(page);
  await approveAndRun(page);
  // The fix: the stale success must not snap the button back — GATE RUNNING holds.
  await expect(btn).toContainText('GATE RUNNING', { timeout: 7000 });

  // And — the bug Philipp caught — while running past a stale success, the stepper must
  // NOT paint the OLD run's all-green phases as the current gate. No done suite steps;
  // it waits for the real run to report.
  const steps = page.locator('#gate-flow-steps');
  for (const name of ['regression', 'E2E smoke', 'promote']) {
    const node = steps.locator('.dvs-node', { hasText: name });
    await expect(node.locator('.dvs-box')).not.toHaveClass(/done/);
  }
});

// During a gate run, the REGRESSION step must reflect the GATE's regression (queued →
// running → passed), NOT the already-green per-push ci.yml run — otherwise it reads as
// "pre-passed / never started" (Philipp's screenshot). On the new surface the gate's
// regression is the stepper step; the per-push run is a clearly separate #gflow-ci line.
const GATE_REG_RUNNING = JSON.parse(JSON.stringify(AHEAD_BRANCH_STATE)); // dev=bbbbbbb
GATE_REG_RUNNING.github.ci = { state: 'passing', run_number: 44, url: 'https://example.test/ci/44', head_sha: 'bbbbbbb', updated_at: '2026-06-13T12:00:00.000Z' };
GATE_REG_RUNNING.github.promote_run = {
  status: 'in_progress', run_id: 91, url: 'https://example.test/run/91', head_sha7: 'bbbbbbb',
  updated_at: '2026-06-13T12:30:00.000Z',
  phases: [
    { key: 'regression', label: 'regression', status: 'running', duration_s: null },
    { key: 'e2e', label: 'e2e', status: 'pending', duration_s: null },
    { key: 'ff', label: 'fast-forward', status: 'pending', duration_s: null },
  ],
};

test('during a gate run the REGRESSION row shows the gate step running — not the pre-passed per-push ✓', async ({ page }) => {
  await page.route('**/api/branch-state', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(GATE_REG_RUNNING) }));
  await page.goto('/');

  const regStep = page.locator('#gate-flow-steps .dvs-node', { hasText: 'regression' });
  await expect(regStep.locator('.dvs-box')).toHaveClass(/act/); // it's the gate's regression, running
  await expect(regStep).not.toContainText('run #44');          // NOT the stale per-push green ✓
  await expect(regStep).not.toContainText('passing');
  // The per-push ci.yml run is shown SEPARATELY and clearly labeled — never conflated with the gate.
  const ci = page.locator('#gflow-ci');
  await expect(ci).toContainText('Per-push checks');
  await expect(ci).toContainText('run #44');
});

const RUNNING_WITH_PHASES = JSON.parse(JSON.stringify(AHEAD_BRANCH_STATE));
RUNNING_WITH_PHASES.github.promote_run = {
  status: 'in_progress', run_id: 88, url: 'https://example.test/run/88', head_sha7: 'bbbbbbb',
  updated_at: '2026-06-13T12:30:00.000Z',
  phases: [
    { key: 'regression', label: 'regression', status: 'passed', duration_s: 2 },
    { key: 'e2e', label: 'e2e', status: 'running', duration_s: null },
    { key: 'ff', label: 'fast-forward', status: 'pending', duration_s: null },
  ],
};

test('the Promote row shows the gate phases live — regression passes (with duration) before e2e and the merge', async ({ page }) => {
  await page.route('**/api/branch-state', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RUNNING_WITH_PHASES) }));
  await page.goto('/');

  const steps = page.locator('#gate-flow-steps');
  // Regression is shown DONE with its real duration — proof it ran, before e2e/merge.
  const regStep = steps.locator('.dvs-node', { hasText: 'regression' });
  await expect(regStep.locator('.dvs-box')).toHaveClass(/done/);
  await expect(regStep).toContainText('2s');
  // e2e is shown running; the fast-forward has not happened yet (its node is pending — no state class).
  const e2eStep = steps.locator('.dvs-node', { hasText: 'E2E smoke' });
  await expect(e2eStep.locator('.dvs-box')).toHaveClass(/act/);
  const promoteStep = steps.locator('.dvs-node', { hasText: 'promote' });
  await expect(promoteStep.locator('.dvs-box')).not.toHaveClass(/done|act|fail/);
});
