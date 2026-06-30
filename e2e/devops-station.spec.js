'use strict';

const { test, expect } = require('@playwright/test');

// USER JOURNEYS for the DevOps Station redesign (slice 340) — the BEHAVIOURAL coverage the
// new ACs demand. The regression guards (j-devops-station) assert the strings exist; THESE
// drive the dashboard in a real browser and prove the feature works. Each maps to its AC.

// dev is ahead of main, gate idle, release-risk in the "rising" band (43%).
const AHEAD = {
  schema_version: 1,
  main: { tip_sha: 'aaaaaaa' },
  dev: { tip_sha: 'bbbbbbb', commits_ahead_of_main: 2, commits: [{ sha: 'bbbbbbb', slice_id: '340', subject: 'DevOps Station', age_s: 60 }] },
  last_merge: { sha: 'aaaaaaa', age_s: 3600 }, gate: { status: 'IDLE' }, regression_risk: null,
  github: {
    origin_main_sha: 'aaaaaaa', origin_dev_sha: 'bbbbbbb', commits_ahead: 2, ahead: 2,
    dev_commits: [{ sha: 'bbbbbbb', slice_id: '340', subject: 'DevOps Station', age_s: 60 }],
    promote: { sha: 'aaaaaaa', age_s: 3600 },
    rr: { score: 43, level: 'rising', commits: 2, churn: 200, churn_ins: 120, churn_del: 80, critical_files: [], breakdown: {} },
    ci: { state: 'passing', run_number: 42, url: 'https://example.test/run', head_sha: 'bbbbbbb', updated_at: '2026-06-13T12:00:00.000Z' },
    promote_run: { status: 'idle', run_id: null, url: null, head_sha7: null, updated_at: null },
    error: null,
  },
};

const aheadState = (page) => page.route('**/api/branch-state', r =>
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AHEAD) }));
const checkClear = (page) => page.route('**/api/check-test-updates', r =>
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ready: true, verdict: 'CLEAR', summary: { checked: 3, passed: 3, autoUpdate: 0, flagged: 0, kept: 0 }, flagged: [], items: [] }) }));

test.beforeEach(async ({ page }) => {
  await page.route('**/api/tests-needed', r => r.fulfill({ json: { decision: 'clear', head7: 'bbbbbbb', counts: {} } }));
  await page.route('**/api/test-changes', r => r.fulfill({ json: { anyChange: false } }));
});

// ── slice-340-ac-1/2/3/5 — the panel renders as DevOps Station with the two named pipelines ──
test('J-devops-station slice-340-ac-1 — DevOps Station panel shows Pipeline A (scan→reconcile→resolve) + Pipeline B, and the Peer Review panel', async ({ page }) => {
  await aheadState(page); await checkClear(page);
  await page.goto('/');

  await expect(page.getByText('DevOps Station', { exact: false }).first()).toBeVisible();
  // "Pipeline A" appears in B's lock text too, so select each track by its unique subtitle.
  const pipeA = page.locator('.dvs-track', { hasText: 'test-update' });
  const pipeB = page.locator('.dvs-track', { hasText: 'run-tests' });
  await expect(pipeA).toBeVisible();
  await expect(pipeB).toBeVisible();
  await expect(pipeA).toContainText('Pipeline A');
  await expect(pipeB).toContainText('Pipeline B');
  // Pipeline A's three steps (ac-5)
  for (const step of ['scan ACs', 'reconcile', 'resolve']) await expect(pipeA).toContainText(step);
  // the renamed review panel (ac-2)
  await expect(page.getByText('Peer Review', { exact: false }).first()).toBeVisible();
});

// ── slice-340-ac-3/ac-4 — Pipeline B is LOCKED until Pipeline A passes ──
test('J-devops-station slice-340-ac-4 — Pipeline B is locked ("pass Pipeline A") and the merge button disabled until the check passes, then both unlock', async ({ page }) => {
  await aheadState(page); await checkClear(page);
  await page.goto('/');

  const pipeB = page.locator('.dvs-track', { hasText: 'Pipeline B' });
  const merge = page.locator('#promote-gate-btn');

  // Before the check: B locked, merge disabled.
  await expect(pipeB).toHaveClass(/locked/);
  await expect(pipeB).toContainText(/pass Pipeline A/i);
  await expect(merge).toBeDisabled();

  // Run Pipeline A (the check) — it passes.
  const check = page.locator('#check-updates-btn');
  await expect(check).toBeEnabled();
  await check.click();

  // After: B unlocked, merge enabled.
  await expect(merge).toBeEnabled();
  await expect(pipeB).not.toHaveClass(/locked/);
});

// ── slice-340-ac-5 — the AC-drain decision flow: flagged ACs surface, the operator rules, the gate unlocks ──
test('J-devops-station slice-340-ac-5 — Pipeline A surfaces a low-confidence AC; Julian drafts a guard and "no test needed" unlocks the merge', async ({ page }) => {
  await aheadState(page);
  // The check is NOT ready — one AC has no guard. On the CHECK press Julian drafts one
  // autonomously; the operator's only manual lever is to rule "no test needed". The routes
  // reflect live state: NEEDS_YOU until the AC is ruled on, RESOLVED after.
  let resolved = false;
  const NEEDS_YOU = { ready: false, verdict: 'NEEDS_YOU',
    summary: { checked: 2, passed: 1, autoUpdate: 0, flagged: 1, kept: 0 },
    flagged: [{ tag: 'slice-340-ac-6', title: 'the merge-pressure pill reflects release risk with a rising/falling trend', reason: 'No test guards this AC. Julian is drafting one.' }],
    items: [{ tag: 'slice-340-ac-6', action: 'decide', confidence: 'low', needsHuman: true, title: 'merge-pressure trend', reason: 'No test guards this AC.' }] };
  const RESOLVED = { ready: true, verdict: 'RESOLVED', summary: { checked: 2, passed: 1, autoUpdate: 0, flagged: 0, kept: 1 }, flagged: [], items: [] };
  const reply = (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resolved ? RESOLVED : NEEDS_YOU) });
  // The triage and its poll reflect the live state.
  await page.route('**/api/check-test-updates', reply);
  // The CHECK press kicks Julian off to author — stub it so no real agent spawns in e2e.
  await page.route('**/api/check-test-updates/author', reply);
  // "No test needed" records the keep ruling and resolves the AC.
  let decided = false;
  await page.route('**/api/check-test-updates/decide', r => {
    decided = true; resolved = true; reply(r);
  });

  await page.goto('/');
  await page.locator('#check-updates-btn').click();

  // The overlay surfaces the flagged AC, Julian's autonomous authoring state, and the
  // operator's only manual lever — "no test needed" (he no longer hand-rules update/keep).
  const overlay = page.locator('#test-updates-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('slice-340-ac-6');
  await expect(overlay).toContainText(/Julian is drafting/i);
  await expect(overlay).toContainText(/No test needed for this AC/i);

  // Rule "no test needed" → the AC resolves → the gate unlocks.
  await overlay.getByRole('button', { name: /No test needed for this AC/i }).click();
  expect(decided).toBe(true);
  await expect(page.locator('#promote-gate-btn')).toBeEnabled();
});

// ── slice-340-ac-6 — the merge-pressure pill carries a release-risk band, not just a number ──
test('J-devops-station slice-340-ac-6 — the Merge Pressure pill shows a release-risk band (rising at 43%)', async ({ page }) => {
  await aheadState(page); await checkClear(page);
  await page.goto('/');

  // The pill is now a semicircular gauge: "43% · merge pressure · rising". The collapsed-
  // panel redesign (ca086ee) added a second mini gauge, so scope to the visible one.
  const gauge = page.locator('.dvs-gauge:visible').first();
  await expect(gauge).toBeVisible();
  await expect(gauge).toContainText('43');
  await expect(gauge).toContainText(/merge pressure/i);
  await expect(gauge).toContainText(/rising|low|moderate|high/i);
});
