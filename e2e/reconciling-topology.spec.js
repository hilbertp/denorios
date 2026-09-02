'use strict';

const { test, expect } = require('@playwright/test');

// Journey: the gate has merged, the panel's refs have not caught up yet.
//
// On 2026-09-01 the panel spent up to a minute after a successful merge still drawing
// the just-merged commits as pending on dev, with a merge ✓ next to the sha main had
// been promoted to LAST time. An operator read that as commits appearing on an
// unexpected branch and opened an investigation into a display artifact.
//
// Slice 362's server half stops serving that stale answer. This spec covers the other
// half — what the operator SEES in the window where the truth is not available yet.
// The branch graph must present as unsettled rather than assert the pre-merge numbers.
// Asserted against the real rendered DOM, because a render nobody can reach is not a
// guarantee: /api/branch-state is stubbed, nothing touches real git or GitHub.

const DEV_SHA = 'bbbbbbb';
const OLD_MAIN = 'aaaaaaa';

// main still at the PREVIOUS promotion, dev two ahead, and a promote that succeeded
// for the current dev tip — i.e. those two commits are already on main and our refs
// simply have not seen it. This is exactly what the server flags as reconciling.
const RECONCILING_STATE = {
  schema_version: 1,
  main: { tip_sha: OLD_MAIN },
  dev: {
    tip_sha: DEV_SHA,
    commits_ahead_of_main: 2,
    commits: [
      { sha: 'ccccccc', slice_id: '361', subject: 'first landed commit', age_s: 300, number: 42 },
      { sha: DEV_SHA, slice_id: '362', subject: 'second landed commit', age_s: 120, number: 43 },
    ],
  },
  last_merge: { sha: OLD_MAIN, age_s: 3600, number: 41 },
  gate: { status: 'IDLE' },
  regression_risk: null,
  github: {
    origin_main_sha: OLD_MAIN, origin_dev_sha: DEV_SHA,
    commits_ahead: 2, ahead: 2,
    dev_commits: [
      { sha: 'ccccccc', slice_id: '361', subject: 'first landed commit', age_s: 300 },
      { sha: DEV_SHA, slice_id: '362', subject: 'second landed commit', age_s: 120 },
    ],
    promote: { sha: OLD_MAIN, age_s: 3600 },
    rr: { score: 20, level: 'low', commits: 2, churn: 100, churn_ins: 60, churn_del: 40, critical_files: [], breakdown: {} },
    ci: { state: 'passing', run_number: 42, url: 'https://example.test/run', head_sha: DEV_SHA, updated_at: '2026-09-01T19:00:00.000Z' },
    promote_run: {
      status: 'success', run_id: 362, url: 'https://example.test/run/362',
      head_sha7: DEV_SHA, updated_at: '2026-09-01T19:10:00.000Z',
    },
    reconciling: true,
    error: null,
  },
};

// The control: byte-identical except the server is NOT telling us it is behind. Every
// assertion below is paired against this, so none of them can pass by describing how
// the graph always looks.
const SETTLED_STATE = JSON.parse(JSON.stringify(RECONCILING_STATE));
SETTLED_STATE.github.reconciling = false;
SETTLED_STATE.github.promote_run = { status: 'idle', run_id: null, url: null, head_sha7: null, updated_at: null };

function serve(page, state) {
  return page.route('**/api/branch-state', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) }));
}

const topo = page => page.locator('#topo-svg-wrap');
// The merge ✓ drawn inside the origin/main node — the only white stroke in the graph.
const mergeTick = page => page.locator('#topo-svg-wrap svg path[stroke="#fff"]');

test('while reconciling, the branch graph does not tick the superseded sha as promoted', async ({ page }) => {
  await serve(page, RECONCILING_STATE);
  await page.goto('/');
  await expect(topo(page).locator('svg')).toBeVisible();

  // The ✓ means "main was promoted to this commit". The sha it would sit next to is the
  // PREVIOUS promotion's; a newer promote has already moved main past it.
  await expect(mergeTick(page)).toHaveCount(0);
  // The base sha is still shown — it is real, just superseded — and labelled as such.
  await expect(topo(page)).toContainText(OLD_MAIN);
  await expect(topo(page).locator('.topo-c-premerge')).toContainText('pre-merge');
  // And the graph says why it cannot be trusted yet.
  await expect(topo(page).locator('.topo-c-reconciling')).toContainText('reconciling');
});

test('while reconciling, the dev head badge stops asserting a commits-ahead count', async ({ page }) => {
  await serve(page, RECONCILING_STATE);
  await page.goto('/');
  await expect(topo(page).locator('svg')).toBeVisible();

  // Those 2 commits are already on main. "dev +2" is the confidently-wrong number that
  // sent an operator looking for a branch that did not exist.
  await expect(topo(page).locator('svg')).not.toContainText('dev +2');
  await expect(topo(page).locator('svg')).toContainText('dev ↻');
  // The screen-reader description and the visible graph agree.
  await expect(topo(page).locator('svg')).toHaveAttribute('aria-label', /reconciling/);
});

test('while reconciling, the header readout says so instead of counting pending commits', async ({ page }) => {
  await serve(page, RECONCILING_STATE);
  await page.goto('/');

  await expect(page.locator('#topo-mini-stat')).toHaveText(/reconciling/);
  await expect(page.locator('#topo-mini-pill')).toContainText('RECONCILING');
  // Acting on pre-merge numbers would re-promote landed work: the controls are held.
  await expect(page.locator('#promote-gate-btn')).toBeDisabled();
});

test('CONTROL — with the refs settled, the same payload draws the merge ✓, the count, and no reconciling copy', async ({ page }) => {
  await serve(page, SETTLED_STATE);
  await page.goto('/');
  await expect(topo(page).locator('svg')).toBeVisible();

  // Proves the assertions above are about the reconciling state, not about the graph.
  await expect(mergeTick(page)).toHaveCount(1);
  await expect(topo(page).locator('svg')).toContainText('dev +2');
  await expect(topo(page).locator('.topo-c-reconciling')).toHaveCount(0);
  await expect(topo(page).locator('.topo-c-premerge')).toHaveCount(0);
  await expect(page.locator('#topo-mini-stat')).toHaveText(/2 ahead/);
});
