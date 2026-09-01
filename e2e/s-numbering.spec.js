'use strict';

const { test, expect } = require('@playwright/test');
const seedFixture = require('./seed-fixture');
const { seedRolledBackableSlice } = seedFixture;

// Journey: S-numbering (slice 350) — one identity from slice to commit.
//
// slice-350-ac-1 (label half): History and topology label slice-originated commits as
// "S{n} · {sha7}". (The retirement half — commit-numbers.json no longer read or written —
// is guarded regression-side in regression/observability/j-s-numbering-retirement.test.js.)
// slice-350-ac-2: commits with no originating slice are labeled by short sha alone, with
// no sequence number.
//
// Contract surface: /api/branch-state github.dev_commits[{ sha, slice_id, subject, age_s }]
// — the stubbed shape devops-station.spec.js already relies on. dev_commits is ordered
// OLDEST-first; the topology's "newest" line renders the last element.
//
// Assertions read page.innerText (visible text only) rather than getByText — the branch
// graph duplicates every sha inside hidden SVG <title> tooltips, which getByText matches.

const SLICE_COMMIT = { sha: 'abc1234', slice_id: '350', subject: 'S350: S-numbering' };
const LOOSE_COMMIT = { sha: 'def5678', slice_id: null, subject: 'docs: loose commit, no slice' };

function topoState(commitsOldestFirst) {
  const newest = commitsOldestFirst[commitsOldestFirst.length - 1];
  return {
    schema_version: 1,
    main: { tip_sha: 'aaaaaaa' },
    dev: { tip_sha: newest.sha, commits_ahead_of_main: commitsOldestFirst.length, commits: commitsOldestFirst },
    last_merge: { sha: 'aaaaaaa', age_s: 3600 }, gate: { status: 'IDLE' }, regression_risk: null,
    github: {
      origin_main_sha: 'aaaaaaa', origin_dev_sha: newest.sha, commits_ahead: commitsOldestFirst.length, ahead: commitsOldestFirst.length,
      dev_commits: commitsOldestFirst,
      promote: { sha: 'aaaaaaa', age_s: 3600 },
      rr: { score: 12, level: 'calm', commits: commitsOldestFirst.length, churn: 40, churn_ins: 30, churn_del: 10, critical_files: [], breakdown: {} },
      ci: { state: 'passing', run_number: 42, url: 'https://example.test/run', head_sha: newest.sha, updated_at: '2026-06-13T12:00:00.000Z' },
      promote_run: { status: 'idle', run_id: null, url: null, head_sha7: null, updated_at: null },
      error: null,
    },
  };
}

async function stubTopo(page, state) {
  await page.route('**/api/branch-state', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) }));
  await page.route('**/api/tests-needed', r => r.fulfill({ json: { decision: 'clear', head7: state.dev.tip_sha, counts: {} } }));
  await page.route('**/api/test-changes', r => r.fulfill({ json: { anyChange: false } }));
}

test.afterAll(() => { seedFixture(); }); // restore the default register for later specs

test('J-s-numbering slice-350-ac-1 — topology labels a slice-originated commit by its S-number and sha', async ({ page }) => {
  // Slice commit is newest → it is the labeled commit line under the branch graph.
  await stubTopo(page, topoState([
    { ...LOOSE_COMMIT, age_s: 120 },
    { ...SLICE_COMMIT, age_s: 60 },
  ]));
  await page.goto('/');

  const topo = page.locator('.topo-panel');
  await expect(topo).toBeVisible({ timeout: 10000 });

  // The branch graph's dev-tip node is labeled by the commit's S-number. This label is
  // UI-DERIVED from slice_id (it reads "S350", not the full subject) — the graph fuses
  // the slice identity onto the commit node.
  const graph = page.getByRole('img', { name: /Branch graph/ });
  await expect(graph).toBeVisible();
  expect(await graph.textContent()).toContain('S350');

  // The newest-commit line pairs the sha7 with the S-identified subject.
  const text = await topo.innerText();
  expect(text).toMatch(/abc1234/);
  expect(text).toMatch(/S350/);

  // The retired running-counter label ("commit 017 · sha") must NOT come back.
  expect(text).not.toMatch(/commit \d+ ·/);

  // OPEN QUESTION (Julian, 2026-09-01, routed to Philipp): ac-1's quoted format
  // "S{n} · {sha7}" renders literally on History surfaces (rollback card "S8200"), but
  // the topology renders the same identity as node label "S350" + line "abc1234 S350: …".
  // This test asserts the INTENT (S-number and sha7 fused onto one commit, counter
  // retired). If the literal " · " form is required in topology too, that is a product
  // change — tighten the assertion to /S350 · abc1234/ when it ships.
});

test('J-s-numbering slice-350-ac-2 — a commit with no originating slice is labeled by short sha alone', async ({ page }) => {
  // Loose commit is newest → it is the labeled commit line under the branch graph.
  await stubTopo(page, topoState([
    { ...SLICE_COMMIT, age_s: 120 },
    { ...LOOSE_COMMIT, age_s: 60 },
  ]));
  await page.goto('/');

  const topo = page.locator('.topo-panel');
  await expect(topo).toBeVisible({ timeout: 10000 });
  const text = await topo.innerText();

  // The loose commit is labeled by its sha…
  expect(text).toMatch(/def5678/);
  // …with NO sequence number fused to it, and no counter label anywhere.
  expect(text).not.toMatch(/S\d+ · def5678/);
  expect(text).not.toMatch(/commit \d+ ·/);
});

test('J-s-numbering slice-350-ac-1 — a merged slice in History carries its S-number identity, not the old "slice N" label', async ({ page }) => {
  seedRolledBackableSlice('8200');
  await page.goto('/');

  const row = page.locator('.history-row', { hasText: 'Rolled-backable slice' });
  await expect(row).toBeVisible({ timeout: 10000 });
  await row.locator('.history-chevron').click();

  // The expanded row names the slice by its fused S-identity…
  await expect(row).toContainText('S8200');
  // …and the retired "slice 8200" display label must not resurface.
  const rowText = await row.innerText();
  expect(rowText).not.toMatch(/slice 8200/);
});
