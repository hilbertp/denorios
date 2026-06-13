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

// A red gate (regression OR e2e failed in promote.yml) must STOP and be FLAGGED to
// the operator — not promote, not auto-retry (Philipp: "on yellow or red, we stop and
// flag to the user"). A "yellow" run (cancelled/timed_out) is normalized to `failure`
// server-side, so it lands on this same UI path. main must stay untouched.
const FAILED_BRANCH_STATE = JSON.parse(JSON.stringify(AHEAD_BRANCH_STATE));
FAILED_BRANCH_STATE.github.promote_run = {
  status: 'failure', run_id: 77,
  url: 'https://github.com/hilbertp/liberation-of-bajor/actions/runs/77',
  head_sha7: 'bbbbbbb', updated_at: '2026-06-13T12:30:00.000Z',
};

test('a red/yellow gate is flagged to the operator and main is not promoted', async ({ page }) => {
  await page.route('**/api/branch-state', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAILED_BRANCH_STATE) }));
  // Guard: a failed gate must never auto-dispatch a new run on its own.
  let autoDispatched = false;
  await page.route('**/api/promote/dispatch', route => {
    autoDispatched = true;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/');

  // FLAG: the CI strip's Promote row shows the gate failed, with a deep link to investigate.
  const promoteText = page.locator('#ci-strip-promote-text');
  await expect(promoteText).toContainText('gate failed');
  const promoteLink = page.locator('#ci-strip-promote-link');
  await expect(promoteLink).toBeVisible();
  await expect(promoteLink).toHaveAttribute('href', /actions\/runs\/77/);
  // The whole strip flips to its failure state.
  await expect(page.locator('#ci-strip')).toHaveAttribute('data-state', 'fail');

  // STOP, don't promote: the Promote row must NOT claim main moved...
  await expect(promoteText).not.toContainText('fast-forwarded');
  // ...and the button hands control back to the operator (RUN GATE, not GATE RUNNING),
  // without firing a new run on its own.
  const btn = page.locator('#promote-gate-btn');
  await expect(btn).toContainText('RUN GATE');
  await expect(btn).toBeEnabled();
  await page.waitForTimeout(500);
  expect(autoDispatched).toBe(false); // a red gate never silently re-promotes
});
