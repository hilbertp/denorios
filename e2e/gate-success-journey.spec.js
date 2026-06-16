'use strict';

const { test, expect } = require('@playwright/test');

// THE FULL GATE-SUCCESS CLICKTEST — the journey Philipp watched succeed by hand:
//   held → press RUN GATE → (Step-1 checkpoint → approve) → queued → regression running →
//   regression passed → e2e running → e2e passed → fast-forward → main promoted.
//
// How (without a real 70s GitHub run or a real merge): the whole dashboard is a pure
// function of /api/branch-state. So we stub that endpoint with a SEQUENCE of snapshots —
// the gate's lifecycle — and step through it, forcing the dashboard's own
// fetchBranchState() poll between steps and asserting the operator-visible UI at each
// stage. The surface is the gate-flow STEPPER (#gate-flow-steps): ① Update tests →
// ② Regression → ③ Browser e2e → ④ Fast-forward → origin/main, each step's status shown
// by its .gflow-{idle,pending,running,passed,failed} class + glyph + duration.
//
// Phase keys are the SERVER's real keys (regression / e2e / ff) — using the dashboard's
// display key instead would let an ff/fast-forward drift bug hide (see j-promote-gate-phases).
// (The gh→phases mapping is unit-tested in j-promote-gate-phases; promote.yml ordering in
// j-merge-button-pass.) Deterministic, real browser, zero workflow, zero merge.
//
// E2E_SLOWMO=<ms> lengthens the pause between stages so a human can watch it --headed.

const MAIN0 = 'aaaaaaa';   // main before promotion
const DEV   = 'bbbbbbb';   // the commit being gated + promoted
const PAUSE = process.env.E2E_SLOWMO ? 1600 : 150;

const phases = (reg, e2e, ff, regDur) => [
  { key: 'regression', label: 'regression',  status: reg, duration_s: regDur ?? null },
  { key: 'e2e',        label: 'e2e',          status: e2e, duration_s: e2e === 'passed' ? 34 : null },
  { key: 'ff',         label: 'fast-forward', status: ff,  duration_s: ff === 'passed' ? 1 : null },
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
      promote_run: { status: promoteStatus, run_id: 99, url: 'https://example.test/run/99', head_sha7: promoteSha, updated_at: '2026-06-13T12:30:00.000Z', phases: ph },
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
  // RUN GATE opens the Step-1 checkpoint, which fetches the gate verdict + the plain-
  // language test changes; stub them CLEAR/empty so Approve is enabled (the verdict
  // engine is covered by gate-button + the regression suite, not this journey).
  await page.route('**/api/tests-needed', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ decision: 'clear', head7: DEV, counts: {} }) }));
  await page.route('**/api/test-changes', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ anyChange: false }) }));

  // Advance to the next lifecycle snapshot and force the dashboard to re-poll.
  async function gateTo(n) {
    cur = n;
    await page.evaluate(() => fetchBranchState());
    await page.waitForTimeout(PAUSE);
  }

  await page.goto('/');
  const steps  = page.locator('#gate-flow-steps');
  const setupStep = steps.locator('.gflow-step', { hasText: 'Loading pipeline' });
  const regStep = steps.locator('.gflow-step', { hasText: 'Regression' });
  const e2eStep = steps.locator('.gflow-step', { hasText: 'E2E smoke test' });
  const ffStep  = steps.locator('.gflow-step', { hasText: 'Promote' });
  const btn     = page.locator('#promote-gate-btn');

  // ── Stage 0 · HELD — nothing gated yet, no green tick, stale run not shown current ─
  await expect(page.locator('#promote-gate-btn')).toContainText('RUN GATE'); // held: the gate trigger (button) prompts RUN GATE
  // No stale green: none of the SUITE steps (②③④) may show passed for a stale run.
  for (const s of [regStep, e2eStep, ffStep]) await expect(s).not.toHaveClass(/gflow-passed/);
  await expect(btn).toContainText('RUN GATE');
  await expect(btn).toBeEnabled();
  await page.waitForTimeout(PAUSE);

  // ── Press the button → Step-1 checkpoint → Approve dispatches the gate ──────────
  await btn.click();
  const approve = page.locator('#utc-approve-btn');
  await expect(approve).toBeEnabled();
  await approve.click();

  // ── Stage 1 · QUEUED — run exists but no suite step has started; the "Loading
  // pipeline · dependencies" step is the CURRENT one (the ~40-50s runner setup window:
  // checkout, npm install, Playwright browser), so the gap isn't a dead grey nothing.
  await gateTo(1);
  await expect(setupStep).toHaveClass(/gflow-running/);
  // The suite steps haven't started — none running, none green yet.
  for (const s of [regStep, e2eStep, ffStep]) await expect(s).not.toHaveClass(/gflow-running/);
  for (const s of [regStep, e2eStep, ffStep]) await expect(s).not.toHaveClass(/gflow-passed/);

  // ── Stage 2 · REGRESSION RUNNING ───────────────────────────────────────────────
  await gateTo(2);
  await expect(regStep).toHaveClass(/gflow-running/);

  // ── Stage 3 · REGRESSION PASSED (with duration), E2E RUNNING ───────────────────
  await gateTo(3);
  await expect(regStep).toHaveClass(/gflow-passed/);
  await expect(regStep).toContainText('2s');
  await expect(e2eStep).toHaveClass(/gflow-running/);
  await expect(ffStep).not.toHaveClass(/gflow-passed/);            // fast-forward has NOT happened yet

  // ── Stage 4 · E2E PASSED (34s — proves it really ran), FAST-FORWARD RUNNING ─────
  await gateTo(4);
  await expect(e2eStep).toHaveClass(/gflow-passed/);
  await expect(e2eStep).toContainText('34s');
  await expect(ffStep).toHaveClass(/gflow-running/);              // ④ reflects the real ff phase (ff-key bug guard)

  // ── Stage 5 · PROMOTED — main fast-forwarded, every step green, nothing left ────
  await gateTo(5);
  await expect(ffStep).toHaveClass(/gflow-passed/);              // the fast-forward step finally lights up green
  await expect(regStep).toHaveClass(/gflow-passed/);
  await expect(e2eStep).toHaveClass(/gflow-passed/);
  // The merge-success popup confirms the promotion and names the tested commit.
  const success = page.locator('#merge-success-overlay');
  await expect(success).toBeVisible();
  await expect(success).toContainText('Merge complete');
  await expect(success).toContainText(DEV);
  await expect(btn).not.toContainText('GATE RUNNING');
});
