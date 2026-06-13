'use strict';

const { test, expect } = require('@playwright/test');

// Journey: the operator presses "RUN GATE & MERGE TO MAIN". We assert ONLY the
// immediate, pre-network acknowledgement (DISPATCHING…) and the running state — the
// gate must stay INERT in tests: no real gh dispatch, no real merge.
//
// Two routes are stubbed so the journey is deterministic and side-effect-free:
//   • GET /api/branch-state — the real one shells out to git/gh (no .git in the fixture),
//     so we serve a payload with commits ahead + promote_run idle to ENABLE the button.
//   • POST /api/promote/dispatch — fulfilled with a fake 200 so the real workflow_dispatch
//     never runs. A deliberate delay keeps the DISPATCHING… state observable.

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

test('RUN GATE acknowledges the click instantly (DISPATCHING → GATE RUNNING) with no real dispatch', async ({ page }) => {
  // Enable the button deterministically.
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
  await expect(btn).toBeEnabled();
  await expect(btn).toContainText('RUN GATE');

  await btn.click();

  // Pre-network acknowledgement: the click flips the button before the fetch resolves.
  await expect(btn).toContainText('DISPATCHING');
  // After the (stubbed) 200, the optimistic running window holds the button.
  await expect(btn).toContainText('GATE RUNNING', { timeout: 7000 });

  // The real promote workflow was never triggered — only our stub was hit.
  expect(dispatchCalled).toBe(true);
});

// Watch an IMPERFECT run get flagged: press RUN GATE, the gate runs, then comes
// back red — and the dashboard VISIBLY flips to a flagged "gate failed" state, stops,
// and hands control back (Philipp: "on yellow or red, we stop and flag to the user").
// A "yellow" run (cancelled/timed_out) is normalized to `failure` server-side, so it
// lands on this same flag path. main must stay untouched; no silent re-promote.
const FAILURE_RUN = {
  status: 'failure', run_id: 77,
  url: 'https://github.com/hilbertp/liberation-of-bajor/actions/runs/77',
  head_sha7: 'bbbbbbb', updated_at: '2026-06-13T12:30:00.000Z',
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
  await btn.click();
  await expect(btn).toContainText('GATE RUNNING'); // the run is going…

  // …then it comes back imperfect — the dashboard FLAGS it, loudly and visibly.
  const promoteText = page.locator('#ci-strip-promote-text');
  await expect(promoteText).toContainText('gate failed', { timeout: 12000 });
  await expect(page.locator('#ci-strip')).toHaveAttribute('data-state', 'fail'); // strip turns red
  const promoteLink = page.locator('#ci-strip-promote-link');
  await expect(promoteLink).toBeVisible();
  await expect(promoteLink).toHaveAttribute('href', /actions\/runs\/77/); // deep link to investigate

  // STOP, don't promote: no main fast-forward claimed, and control returns to the operator.
  await expect(promoteText).not.toContainText('fast-forwarded');
  await expect(btn).toContainText('RUN GATE');
  await expect(btn).toBeEnabled();
  expect(dispatchCount).toBe(1); // exactly one run — the failure never silently re-fired
});

// The operator must SEE the regression suite run green before main moves. The Promote
// row renders the gate's phases (regression → e2e → fast-forward) with status + duration,
// so "regression ✓ 2s" is visible before "e2e ⟳" — not one opaque "gate running" blob.
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

  const promote = page.locator('#ci-strip-promote-text');
  // Regression is shown PASSED with its real duration — proof it ran, before e2e/merge.
  const regression = promote.locator('.gate-phase-passed', { hasText: 'regression' });
  await expect(regression).toBeVisible();
  await expect(regression).toContainText('2s');
  // e2e is shown running; the fast-forward has not happened yet.
  await expect(promote.locator('.gate-phase-running', { hasText: 'e2e' })).toBeVisible();
  await expect(promote.locator('.gate-phase-pending', { hasText: 'fast-forward' })).toBeVisible();
});
