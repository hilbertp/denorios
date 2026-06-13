'use strict';

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const seedFixture = require('./seed-fixture');

// ─────────────────────────────────────────────────────────────────────────────
// THE BIG ONE — a slice through the WHOLE pipeline, in a real browser:
//   Proposed → approve → Approved Work Order → Active Build (Rom) →
//   Nog review → Accepted/merged → History (dev→reg→main) → RUN GATE.
//
// HONEST BOUNDARY (read this):
//   • The APPROVE click and the RUN GATE acknowledgement are REAL (real endpoint,
//     real UI). The gate dispatch is route-stubbed so NO real merge happens.
//   • The Rom and Nog steps are SIMULATED — but faithfully: each step writes the
//     exact files + register events the orchestrator and the agents actually
//     produce per the pipeline contract (rename to IN_PROGRESS, the DONE event,
//     nog-active.json, NOG_DECISION, SLICE_MERGED_TO_MAIN). No `claude -p` runs
//     here (that is billing-blocked and lives in a separate nightly smoke).
//   • So this proves the PIPELINE PLUMBING end-to-end — that the dashboard
//     correctly reflects every real lifecycle transition — NOT that the agents
//     are intelligent. It catches contract↔dashboard drift, which is the thing
//     a deterministic suite can actually guarantee.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = seedFixture.ROOT;
const ID = '7001';
const TITLE = 'Pipeline lifecycle slice';

const rt = (...p) => path.join(ROOT, ...p);
const writeJson = (p, o) => fs.writeFileSync(p, JSON.stringify(o));
const bumpHeartbeat = (extra = {}) =>
  writeJson(rt('bridge', 'heartbeat.json'), { current_slice: null, ts: new Date().toISOString(), ...extra });

function readRegister() {
  try { return fs.readFileSync(rt('bridge', 'register.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse); }
  catch (_) { return []; }
}
function appendRegister(events) {
  const all = readRegister().concat(events);
  fs.writeFileSync(rt('bridge', 'register.jsonl'), all.map(e => JSON.stringify(e)).join('\n') + '\n');
}

function sliceBody(status) {
  return `---\nid: "${ID}"\ntitle: "${TITLE}"\nfrom: obrien\nto: rom\npriority: normal\n`
       + `created: "2026-06-13T00:00:00.000Z"\nstatus: "${status}"\n---\n\n`
       + `## Goal\n\nDrive the full pipeline end to end.\n\n## Acceptance criteria\n\n- every stage shows in Ops\n`;
}

// Fresh single-slice pipeline state: one staged proposal, empty queue, the
// COMMISSIONED event on record (so the title resolves in Active Build + History).
test.beforeAll(() => {
  for (const d of ['queue', 'staged']) {
    const dir = rt('bridge', d);
    try { for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true }); } catch (_) {}
  }
  fs.writeFileSync(rt('bridge', 'staged', `${ID}-STAGED.md`), sliceBody('STAGED'));
  writeJson(rt('bridge', 'staged-order.json'), [ID]);
  writeJson(rt('bridge', 'queue-order.json'), []);
  writeJson(rt('bridge', 'nog-active.json'), {});
  fs.writeFileSync(rt('bridge', 'register.jsonl'),
    JSON.stringify({ ts: '2026-06-13T09:00:00.000Z', event: 'COMMISSIONED', id: ID, title: TITLE, goal: 'Drive the full pipeline end to end.' }) + '\n');
  bumpHeartbeat();
});

test.afterAll(() => { seedFixture(); }); // restore default fixture for other specs

test('a slice travels the whole pipeline: stage → queue → Rom → Nog → history → gate', async ({ page }) => {
  await page.goto('/');

  // ── Stage 1 · PROPOSED ─────────────────────────────────────────────────────
  // O'Brien staged it; it sits in Proposed Improvements awaiting approval.
  const proposed = page.locator(`.queue-row[data-id="${ID}"][data-state="STAGED"]`);
  await expect(proposed).toBeVisible({ timeout: 10000 });
  await expect(proposed).toContainText('Pipeline lifecycle');

  // ── Stage 2 · APPROVE → QUEUED (REAL click, real endpoint) ──────────────────
  // Philipp approves: staged → Approved Work Order; server writes {id}-QUEUED.md.
  await proposed.locator('.queue-btn-accept').click();
  await expect(page.locator(`.queue-row[data-id="${ID}"]:not(.row-exiting)`))
    .toHaveAttribute('data-state', 'QUEUED', { timeout: 10000 });

  // ── Stage 3 · ROM BUILDING (simulated: orchestrator picks up the slice) ─────
  // The orchestrator renames {id}-QUEUED.md → {id}-IN_PROGRESS.md and marks the
  // heartbeat's current_slice. The Active Build panel then shows Rom at work.
  fs.rmSync(rt('bridge', 'queue', `${ID}-QUEUED.md`), { force: true });
  fs.writeFileSync(rt('bridge', 'queue', `${ID}-IN_PROGRESS.md`), sliceBody('IN_PROGRESS'));
  appendRegister([{ ts: new Date().toISOString(), event: 'IN_PROGRESS', id: ID }]);
  bumpHeartbeat({ current_slice: ID, status: 'processing' });
  await page.reload();
  await expect(page.locator('#pipeline-mission-title')).toContainText('Pipeline lifecycle', { timeout: 10000 });
  await expect(page.locator('#mission-id-badge')).toContainText(ID);

  // ── Stage 4 · ROM DONE → NOG REVIEWING (simulated: Rom delivers, Nog spawns) ─
  // Rom finishes: {id}-IN_PROGRESS.md → {id}-DONE.md (+ DONE event with metrics),
  // and the orchestrator opens nog-active.json so the Post-Build lane shows Nog.
  fs.rmSync(rt('bridge', 'queue', `${ID}-IN_PROGRESS.md`), { force: true });
  fs.writeFileSync(rt('bridge', 'queue', `${ID}-DONE.md`),
    sliceBody('DONE').replace('status: "DONE"', 'status: "DONE"\ncompleted: "2026-06-13T11:00:00.000Z"')
    + '\n## Rom DONE Report — Round 1\n\nImplementation complete.\n');
  appendRegister([
    { ts: new Date().toISOString(), event: 'DONE', id: ID, durationMs: 5000, tokensIn: 12000, tokensOut: 24000, costUsd: 0.9 },
    { ts: new Date().toISOString(), event: 'ROM_WAITING_FOR_NOG', id: ID },
  ]);
  writeJson(rt('bridge', 'nog-active.json'), { sliceId: ID, round: 1, startedAt: new Date().toISOString() });
  bumpHeartbeat();
  await page.reload();
  await expect(page.locator('#nog-lane')).toHaveClass(/nog-lane-active/, { timeout: 10000 });
  await expect(page.locator('#nog-lane-status')).toContainText('reviewing');

  // ── Stage 5 · NOG ACCEPTED → MERGED (simulated verdict + squash to main) ────
  // Nog accepts; the slice is squashed/merged and leaves the active lanes. It now
  // belongs to History with the full dev → reg → main lifecycle chain.
  writeJson(rt('bridge', 'nog-active.json'), {});
  appendRegister([
    { ts: new Date().toISOString(), event: 'NOG_DECISION', id: ID, verdict: 'ACCEPTED' },
    { ts: new Date().toISOString(), event: 'SLICE_MERGED_TO_MAIN', id: ID },
  ]);
  bumpHeartbeat();
  await page.reload();
  const historyRow = page.locator('.history-row', { hasText: 'Pipeline lifecycle' });
  await expect(historyRow).toBeVisible({ timeout: 10000 });
  const chain = historyRow.locator('.outcome-chain');
  await expect(chain.locator('.chain-stage.stage-dev.done')).toBeVisible();
  await expect(chain.locator('.chain-stage.stage-reg.done')).toBeVisible();
  await expect(chain.locator('.chain-stage.stage-main.done')).toBeVisible();

  // ── Stage 6 · RUN THE REGRESSION GATE BEFORE MERGING (real UI, inert dispatch) ─
  // The operator's gate: re-run the suite on a clean runner, then fast-forward.
  // Stubbed so the button enables (dev ahead) and the dispatch is a no-op.
  await page.route('**/api/branch-state', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      schema_version: 1, main: { tip_sha: 'aaaaaaa' },
      dev: { tip_sha: 'bbbbbbb', commits_ahead_of_main: 1, commits: [{ sha: 'bbbbbbb', slice_id: ID, subject: TITLE, age_s: 30 }] },
      last_merge: { sha: 'aaaaaaa', age_s: 3600 }, gate: { status: 'IDLE' }, regression_risk: null,
      github: {
        origin_main_sha: 'aaaaaaa', origin_dev_sha: 'bbbbbbb', commits_ahead: 1, ahead: 1,
        dev_commits: [{ sha: 'bbbbbbb', slice_id: ID, subject: TITLE, age_s: 30 }],
        promote: { sha: 'aaaaaaa', age_s: 3600 },
        rr: { score: 10, level: 'low', commits: 1, churn: 40, churn_ins: 30, churn_del: 10, critical_files: [], breakdown: {} },
        ci: { state: 'passing', run_number: 99, url: 'https://example.test/run', head_sha: 'bbbbbbb', updated_at: '2026-06-13T12:00:00.000Z' },
        promote_run: { status: 'idle', run_id: null, url: null, head_sha7: null, updated_at: null }, error: null,
      },
    }),
  }));
  let dispatched = false;
  await page.route('**/api/promote/dispatch', async route => {
    dispatched = true;
    await new Promise(r => setTimeout(r, 600));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.reload();

  const gate = page.locator('#promote-gate-btn');
  await expect(gate).toBeEnabled({ timeout: 10000 });
  await expect(gate).toContainText('RUN GATE');
  await gate.click();
  // The gate runs the suite on a clean runner before any merge. (The pre-network
  // DISPATCHING blink is asserted in gate-button.spec.js, where it is timing-stable;
  // here it is too brief to catch under --headed slowMo, so assert the running state.)
  await expect(gate).toContainText('GATE RUNNING', { timeout: 7000 });
  expect(dispatched).toBe(true);                                   // only the stub was hit — no real merge
});
