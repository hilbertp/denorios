'use strict';

/**
 * Journey: J-inspect-slice-history (partial)
 * Category: Observability
 *
 * What this tests (spec = journey text + cited contracts, not the implementation):
 *   Philipp inspects a merged/archived slice from the History panel: the row
 *   shows id, title, an accepted outcome, and real cost/duration (steps 1, 8;
 *   outcome 5), and the expanded detail view's tabs are fed per-tab data
 *   sources — original slice body, Rom DONE report, Nog verdict (steps 4-6;
 *   outcomes 2, 4). The History panel's detail view is backed by
 *   GET /api/slice/:id (buildSliceInvestigation); the row itself by the
 *   `recent` array of GET /api/bridge; cost aggregation by GET /api/costs.
 *
 * Harness:
 *   - Tier 2: the real dashboard server compiled into an os.tmpdir() root
 *     (REPO_ROOT rewritten, lifecycle-translate stubbed, no listen guard),
 *     driven over 127.0.0.1 HTTP. #99992: live bridge/* is never touched.
 *   - Tier 3b: direct require of dashboard/server.js pure exports —
 *     buildSliceInvestigation accepts an explicit { queueDir, stagedDir }
 *     override; deriveHistoryOutcome is a pure function. require.main guard
 *     means no server listens; module load only mkdirs existing live dirs.
 *
 * Spec interpretation notes (journey is draft + "partial"):
 *   - Step 1 says outcome "(ACCEPTED)". The journey predates the slice-316
 *     GitHub-CI merge model; the post-316 outcome pill vocabulary is
 *     DONE/ON_DEV/DEFERRED/ERROR, and acceptance is surfaced on the history
 *     row as reviewStatus === 'accepted' (driven by Nog's ACCEPTED verdict).
 *     We assert the acceptance signal plus an outcome that does not mislead
 *     the operator (never ERROR/null for a shipped slice) instead of the
 *     literal string ACCEPTED — asserting the stale literal would fail every
 *     row the current model can produce, including correct ones.
 *   - Step 8 names frontmatter fields tokens_in/tokens_out/elapsed_ms. The
 *     current telemetry contract (slice-pipeline.md §"Per-round telemetry")
 *     is rounds[] entries carrying tokensIn/tokensOut/costUsd/durationMs plus
 *     total_* aggregates; the history row reads the DONE register event's
 *     durationMs/tokensIn/tokensOut/costUsd. What the journey pins is
 *     outcome 5 — "real values from recorded metrics, not hardcoded" — so we
 *     assert two different fixture values produce two different outputs.
 *
 * Deliberately NOT asserted (and why):
 *   - Steps 2-3, 7 + outcomes 1, 3, 6 (click-to-expand, chevron rotation,
 *     instant tab switching, independent scroll): browser UI behavior, not
 *     headless-testable. The headless contract is the per-tab data the UI
 *     pre-loads, which IS asserted.
 *
 * PRODUCT BUG found (rule 6 — see the test.skip below):
 *   buildSliceInvestigation never reads `{id}-ARCHIVED.md`. For a slice in
 *   the journey's precondition state — terminal ARCHIVED, the single
 *   `bridge/queue/{id}-ARCHIVED.md` file holding all appended blocks
 *   (slice-pipeline.md §4 row 8; also the legacy parked suffix that §"Known
 *   code divergences" claims has fallback reads in the dashboard server) —
 *   GET /api/slice/:id returns { prompt: null, report: null, reviews: [] },
 *   so all three tabs of the journey's detail view render placeholders even
 *   though the data exists on disk. Journey steps 4-6 / outcome 2 are not met
 *   for ARCHIVED-state slices. (The history ROW is fine: getTitleAndGoal and
 *   /api/queue/:id/content both have the ARCHIVED fallback.)
 *
 * Sources: docs/e2e-journeys/J-inspect-slice-history.md
 *          docs/contracts/slice-pipeline.md §4 (ARCHIVED state, suffix map),
 *            §5 (append + rename mechanics), per-round telemetry rounds[]
 *          docs/contracts/slice-format.md (DONE report / Nog Review blocks)
 *          docs/contracts/slice-lifecycle.md (ARCHIVED terminal, read-only)
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');

const SERVER_SRC = path.resolve(__dirname, '..', '..', 'dashboard', 'server.js');

// ── Fixture builders (journey-shaped slice files) ────────────────────────────

// Single-file archived slice per slice-pipeline §4/§5: original body with all
// appended blocks (Rom DONE Report, Nog Review PASS), suffix -ARCHIVED.md.
function archivedSliceFile(id, title) {
  return [
    '---',
    `id: "${id}"`,
    `title: "${title}"`,
    'goal: "Validate history inspection end-to-end."',
    'from: obrien',
    'to: rom',
    'priority: normal',
    'created: "2026-06-01T00:00:00.000Z"',
    'status: "ARCHIVED"',
    '---',
    '',
    '## Goal',
    'Validate history inspection end-to-end.',
    '',
    '## Acceptance criteria',
    '1. The archived artifacts stay readable.',
    '',
    '---',
    '## Rom DONE Report — Round 1',
    '',
    '**Round:** 1',
    '**Author:** rom',
    '',
    '### Summary',
    'Implementation complete. All ACs addressed.',
    '',
    '---',
    '## Nog Review — Round 1',
    '',
    '**Verdict:** PASS',
    '**Round:** 1',
    '**Reason:** All ACs satisfied.',
    '',
  ].join('\n');
}

// Merged-but-not-yet-archived slice: per slice-pipeline §4 row 7, the file
// keeps -ACCEPTED.md until archive. Accepted on Round 1, no rejection history.
function acceptedSliceFile(id, title) {
  return archivedSliceFile(id, title).replace('status: "ARCHIVED"', 'status: "ACCEPTED"');
}

// Current-shape parked slice (post-slice-145): original body parked at
// {id}-PARKED.md, per-round telemetry in rounds[] frontmatter
// (slice-pipeline §"Per-round telemetry"), Nog Review sections in the body.
function parkedSliceFile(id, { costUsd, durationMs, tokensIn, tokensOut, reason }) {
  return [
    '---',
    `id: "${id}"`,
    `title: "Parked fixture ${id}"`,
    'goal: "Parked goal."',
    'from: obrien',
    'to: rom',
    'priority: normal',
    'created: "2026-06-01T00:00:00.000Z"',
    'status: "QUEUED"',
    'rounds:',
    '  - round: 1',
    '    done_at: "2026-06-05T00:00:00.000Z"',
    `    durationMs: ${durationMs}`,
    `    tokensIn: ${tokensIn}`,
    `    tokensOut: ${tokensOut}`,
    `    costUsd: ${costUsd}`,
    '    nog_verdict: "NOG_DECISION_ACCEPTED"',
    `    nog_reason: "${reason}"`,
    `total_durationMs: ${durationMs}`,
    `total_tokensIn: ${tokensIn}`,
    `total_tokensOut: ${tokensOut}`,
    `total_costUsd: ${costUsd}`,
    '---',
    '',
    '## Goal',
    'Original parked body.',
    '',
    '## Acceptance criteria',
    '1. The parked body survives review.',
    '',
    '## Nog Review — Round 1',
    '',
    '**Verdict:** PASS',
    `**Reason:** ${reason}`,
    '',
  ].join('\n');
}

// Rom report file carrying Nog's per-round telemetry in rounds[] frontmatter —
// the data source /api/costs aggregates for the nog row.
function doneFileWithRounds(id, rounds) {
  const lines = [
    '---',
    `id: "${id}"`,
    `title: "Done fixture ${id}"`,
    'status: "DONE"',
    'completed: "2026-06-10T00:00:00.000Z"',
    'rounds:',
  ];
  for (const r of rounds) {
    lines.push(`  - round: ${r.round}`);
    lines.push(`    tokensIn: ${r.tokensIn}`);
    lines.push(`    tokensOut: ${r.tokensOut}`);
    lines.push(`    costUsd: ${r.costUsd}`);
  }
  lines.push('---', '', '## Rom DONE Report — Round 1', '', 'Done.', '');
  return lines.join('\n');
}

function approxEqual(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-9,
    `${label}: expected ~${expected}, got ${actual}`);
}

// ── Tier 2 scaffolding (pattern from j-queue-detail-controls-server.test.js) ─

let tmpRoot;
let server;
let port;
let queueDir;
let registerPath;

function compileServer(root) {
  const dashboardDir = path.join(root, 'dashboard');
  const lifecyclePath = path.join(root, 'bridge', 'lifecycle-translate.js');
  fs.writeFileSync(lifecyclePath, `
'use strict';
module.exports = {
  translateEvent(ev) { return ev; },
  resetDedupeState() {},
};
`, 'utf8');
  fs.writeFileSync(path.join(dashboardDir, 'lcars-dashboard.html'), '<html></html>', 'utf8');
  fs.writeFileSync(path.join(dashboardDir, 'tokens.css'), '', 'utf8');

  const src = fs.readFileSync(SERVER_SRC, 'utf8')
    .replace(
      /const REPO_ROOT\s*=[\s\S]*?path\.resolve\(__dirname,\s*'\.\.'\);/,
      `const REPO_ROOT = ${JSON.stringify(root)};`
    )
    .replace(
      /const DASHBOARD\s*=\s*path\.join\(__dirname,\s*'lcars-dashboard\.html'\);/,
      `const DASHBOARD = ${JSON.stringify(path.join(dashboardDir, 'lcars-dashboard.html'))};`
    )
    .replace(
      /const TOKENS_CSS\s*=\s*path\.join\(__dirname,\s*'tokens\.css'\);/,
      `const TOKENS_CSS = ${JSON.stringify(path.join(dashboardDir, 'tokens.css'))};`
    )
    .replace(
      /require\(path\.join\(REPO_ROOT,\s*'bridge',\s*'lifecycle-translate'\)\)/,
      `require(${JSON.stringify(lifecyclePath)})`
    )
    .replace(/if \(require\.main === module\)/, 'if (false)')
    .replace(/module\.exports = \{ /, 'module.exports = { server, ');

  const mod = new Module('patched-dashboard-server-j-inspect-slice-history');
  mod.paths = module.paths;
  mod._compile(src, path.join(dashboardDir, 'server.js'));
  return mod.exports.server;
}

function request(method, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: urlPath, method },
      res => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          let parsed = raw;
          try { parsed = JSON.parse(raw); } catch (_) {}
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j-inspect-slice-history-'));
  queueDir = path.join(tmpRoot, 'bridge', 'queue');
  registerPath = path.join(tmpRoot, 'bridge', 'register.jsonl');

  for (const dir of [
    queueDir,
    path.join(tmpRoot, 'bridge', 'staged'),
    path.join(tmpRoot, 'bridge', 'trash'),
    path.join(tmpRoot, 'bridge', 'control'),
    path.join(tmpRoot, 'bridge', 'errors'),
    path.join(tmpRoot, 'bridge', 'state'),
    path.join(tmpRoot, 'dashboard'),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'heartbeat.json'), JSON.stringify({ current_slice: null }), 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'queue-order.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'staged-order.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'sessions.jsonl'), '', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'first-output.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'nog-active.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'state', 'branch-state.json'), '{}', 'utf8');

  // ── Fixtures ──
  // 901: terminal ARCHIVED slice — the journey's precondition object.
  //      Deliberately NO COMMISSIONED event, so the history row's title can
  //      only come from reading bridge/queue/901-ARCHIVED.md (the legacy /
  //      terminal suffix the journey names).
  fs.writeFileSync(path.join(queueDir, '901-ARCHIVED.md'),
    archivedSliceFile('901', 'Archived history fixture 901'), 'utf8');
  // 902: merged slice still at -ACCEPTED.md (pipeline §4 row 7) — accepted on
  //      Round 1 with no rejection history (journey outcome 4 fixture).
  fs.writeFileSync(path.join(queueDir, '902-ACCEPTED.md'),
    acceptedSliceFile('902', 'Accepted history fixture 902'), 'utf8');
  // 903/904: Rom report files carrying rounds[] telemetry with DISTINCT
  //      values — /api/costs must reflect each (journey outcome 5).
  fs.writeFileSync(path.join(queueDir, '903-DONE.md'), doneFileWithRounds('903', [
    { round: 1, tokensIn: 1000, tokensOut: 100, costUsd: 0.1 },
    { round: 2, tokensIn: 3000, tokensOut: 300, costUsd: 0.3 },
  ]), 'utf8');
  fs.writeFileSync(path.join(queueDir, '904-DONE.md'), doneFileWithRounds('904', [
    { round: 1, tokensIn: 500, tokensOut: 50, costUsd: 0.07 },
  ]), 'utf8');

  // Register events (canonical post-translate names; the translate stub is
  // identity). DONE events carry the row's real duration/token/cost metrics;
  // NOG_DECISION ACCEPTED is the acceptance signal; MERGED marks shipping.
  const events = [
    { ts: '2026-06-09T10:00:00.000Z', event: 'COMMISSIONED', id: '902', title: 'Accepted history fixture 902', goal: 'Validate history inspection end-to-end.' },
    { ts: '2026-06-09T11:00:00.000Z', event: 'DONE', id: '902', durationMs: 120000, tokensIn: 1000, tokensOut: 200, costUsd: 0.25 },
    { ts: '2026-06-09T11:05:00.000Z', event: 'NOG_DECISION', id: '902', verdict: 'ACCEPTED' },
    { ts: '2026-06-10T10:00:00.000Z', event: 'DONE', id: '901', durationMs: 5400000, tokensIn: 48200, tokensOut: 8100, costUsd: 1.3305 },
    { ts: '2026-06-10T10:05:00.000Z', event: 'NOG_DECISION', id: '901', verdict: 'ACCEPTED' },
    { ts: '2026-06-10T10:10:00.000Z', event: 'MERGED', id: '901' },
  ];
  fs.writeFileSync(registerPath, events.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');

  server = compileServer(tmpRoot);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ── Step 1: history row — id, title, accepted outcome ───────────────────────

test('J-inspect-slice-history slice-901-ac-1 — /api/bridge history row carries id, title read from the {id}-ARCHIVED.md file, and the accepted signal', async () => {
  const res = await request('GET', '/api/bridge');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.recent), 'history data source is the recent[] array');

  const row = res.body.recent.find(r => String(r.id) === '901');
  assert.ok(row, 'archived slice 901 must appear in the history rows (failure mode: history panel does not show the archived slice)');
  // Title is resolvable ONLY from bridge/queue/901-ARCHIVED.md here (no
  // COMMISSIONED event was seeded) — pins the journey's precondition naming:
  // the legacy/terminal -ARCHIVED.md suffix is still read for history rows.
  assert.equal(row.title, 'Archived history fixture 901',
    'row title must come from the archived slice file frontmatter');
  // Acceptance signal (journey step 1 "outcome (ACCEPTED)", post-316 surface:
  // reviewStatus carries acceptance; see header note).
  assert.equal(row.reviewStatus, 'accepted', 'Nog-accepted slice must surface as accepted');
  // The outcome must not mislead the operator about what shipped.
  assert.ok(row.outcome, 'outcome must be present');
  assert.notEqual(row.outcome, 'ERROR', 'a shipped slice must not display as ERROR');
});

test('J-inspect-slice-history slice-901-ac-1 — archived slice lives in history, not the live queue panel', async () => {
  const res = await request('GET', '/api/bridge');
  assert.equal(res.status, 200);
  assert.ok(!res.body.slices.some(s => String(s.id) === '901'),
    'terminal ARCHIVED slice must not reappear in the live queue panel — its home is the History panel');
});

// ── Step 8 + Outcome 5: real cost/duration values on the row ────────────────

test('J-inspect-slice-history slice-901-ac-8 — history row duration/cost are the recorded metric values, two slices yield two different values', async () => {
  const res = await request('GET', '/api/bridge');
  assert.equal(res.status, 200);
  const row901 = res.body.recent.find(r => String(r.id) === '901');
  const row902 = res.body.recent.find(r => String(r.id) === '902');
  assert.ok(row901 && row902, 'both completed slices must have history rows');

  assert.equal(row901.durationMs, 5400000, 'duration must be the recorded value');
  assert.equal(row901.tokensIn, 48200, 'tokens_in must be the recorded value');
  assert.equal(row901.tokensOut, 8100, 'tokens_out must be the recorded value');
  approxEqual(row901.costUsd, 1.3305, 'cost must be the recorded value');

  // Outcome 5 (not hardcoded): a second slice with different recorded metrics
  // must surface different numbers.
  approxEqual(row902.costUsd, 0.25, 'second slice cost');
  assert.equal(row902.durationMs, 120000, 'second slice duration');
  assert.notEqual(row901.costUsd, row902.costUsd, 'distinct fixtures must yield distinct displayed costs');
  assert.notEqual(row901.durationMs, row902.durationMs, 'distinct fixtures must yield distinct displayed durations');
});

test('J-inspect-slice-history slice-903-ac-8 — /api/costs aggregates the rounds[] telemetry actually on disk, not hardcoded totals', async () => {
  const res = await request('GET', '/api/costs');
  assert.equal(res.status, 200);
  const byRole = res.body.by_role;
  assert.ok(Array.isArray(byRole), 'costs payload must list per-role rows');

  const rom = byRole.find(r => r.role === 'rom');
  const nog = byRole.find(r => r.role === 'nog');
  assert.ok(rom && nog, 'rom and nog cost rows must exist');

  // Rom row = sum of the two seeded DONE events (1.3305 + 0.25).
  assert.equal(rom.count, 2);
  assert.equal(rom.tokens_in, 48200 + 1000);
  assert.equal(rom.tokens_out, 8100 + 200);
  approxEqual(rom.cost_usd, 1.5805, 'rom cost must equal the sum of recorded DONE metrics');

  // Nog row = sum of the three seeded rounds[] entries (0.1 + 0.3 + 0.07)
  // across the two report files — distinct fixture values, distinct output.
  assert.equal(nog.count, 3);
  assert.equal(nog.tokens_in, 1000 + 3000 + 500);
  assert.equal(nog.tokens_out, 100 + 300 + 50);
  approxEqual(nog.cost_usd, 0.47, 'nog cost must equal the sum of rounds[] frontmatter metrics');

  assert.notEqual(rom.cost_usd, nog.cost_usd, 'distinct fixture values must yield distinct totals');
  approxEqual(res.body.total_cost_usd, 1.5805 + 0.47, 'grand total must be derived from the recorded values');
});

// ── Steps 4-5 + Outcome 2: per-tab data sources via the endpoint the
//    History panel actually fetches (GET /api/slice/:id) ────────────────────

test('J-inspect-slice-history slice-902-ac-4 — detail view default tab source is the original slice body (goal, ACs)', async () => {
  const res = await request('GET', '/api/slice/902');
  assert.equal(res.status, 200);
  assert.ok(res.body.prompt, 'Slice body tab must have data');
  assert.match(res.body.prompt, /^## Goal$/m, 'original ## Goal section must be present');
  assert.match(res.body.prompt, /^## Acceptance criteria$/m, 'original ACs must be present');
  assert.doesNotMatch(res.body.prompt, /^---\n^id:/m, 'tab shows the body, not raw frontmatter');
});

test('J-inspect-slice-history slice-902-ac-5 — Rom report tab source contains the appended "## Rom DONE Report — Round N" block', async () => {
  const res = await request('GET', '/api/slice/902');
  assert.equal(res.status, 200);
  assert.ok(res.body.report, 'Rom report tab must have data for a merged (ACCEPTED-suffix) slice');
  assert.match(res.body.report, /^## Rom DONE Report — Round 1$/m,
    'report must carry the round-numbered Rom DONE Report heading (slice-format block)');
  assert.match(res.body.report, /Implementation complete/, 'report body content must be preserved');
});

// ── Outcome 4: missing per-tab data is a placeholder, not an error ──────────

test('J-inspect-slice-history slice-902-ac-4 — slice accepted on Round 1 with no rejection history yields empty reviews without an error', async () => {
  const res = await request('GET', '/api/slice/902');
  assert.equal(res.status, 200, 'absence of review rounds must not produce an error response');
  assert.ok(Array.isArray(res.body.reviews), 'reviews must still be an array');
  assert.equal(res.body.reviews.length, 0, 'no rejection history -> empty reviews (UI renders the per-tab placeholder)');
  assert.equal(res.body.error, undefined, 'no error field on the placeholder path');
});

// ── Step 6 + Outcome 2 + Step 8: Nog verdict tab + per-round telemetry,
//    current parked shape, via the exported pure function (Tier 3b) ──────────

test('J-inspect-slice-history slice-907-ac-6 — buildSliceInvestigation reviews carry round, verdict, reason and real telemetry from rounds[] frontmatter', () => {
  const srv = require(SERVER_SRC);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'j-inspect-hist-3b-'));
  const qDir = path.join(tmp, 'queue');
  const sDir = path.join(tmp, 'staged');
  fs.mkdirSync(qDir); fs.mkdirSync(sDir);
  try {
    fs.writeFileSync(path.join(qDir, '907-PARKED.md'), parkedSliceFile('907', {
      costUsd: 1.437, durationMs: 4200000, tokensIn: 52800, tokensOut: 8600,
      reason: 'All ACs satisfied; intent achieved.',
    }), 'utf8');

    const inv = srv.buildSliceInvestigation('907', { queueDir: qDir, stagedDir: sDir });

    // Step 4: default tab = original parked slice body.
    assert.ok(inv.prompt, 'Slice body tab must have data');
    assert.match(inv.prompt, /Original parked body/, 'original body must be the prompt source');

    // Step 6 / outcome 2: Nog verdict tab has its own data source.
    assert.equal(inv.reviews.length, 1, 'one review round expected');
    const review = inv.reviews[0];
    assert.equal(review.round, 1, 'review carries its round number');
    assert.ok(review.verdict, 'review carries the verdict');
    assert.equal(review.summary, 'All ACs satisfied; intent achieved.', 'review carries the reason');
    assert.match(review.nog_review, /\*\*Verdict:\*\* PASS/,
      'the appended Nog Review block content feeds the verdict tab');

    // Step 8 / outcome 5: telemetry are the recorded values.
    assert.equal(review.durationMs, 4200000);
    approxEqual(review.costUsd, 1.437, 'per-round cost');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── Blast radius guard: outcome derivation must not mislead the operator ────

test('J-inspect-slice-history slice-901-ac-1 — deriveHistoryOutcome reflects recorded events: raw outcome passes through, shipped slices never show as failed', () => {
  const srv = require(SERVER_SRC);
  const empty = { squashedToDevIds: new Set(), deferredIds: new Set(), acceptedSet: new Set() };

  // No events claim otherwise -> the raw recorded outcome is shown unchanged.
  assert.equal(srv.deriveHistoryOutcome('901', 'DONE', empty), 'DONE');

  // A slice squashed to dev shipped — the row must say so, not invent a value.
  assert.equal(srv.deriveHistoryOutcome('901', 'DONE', {
    ...empty, squashedToDevIds: new Set(['901']),
  }), 'ON_DEV');

  // An ERROR-outcome slice that was nonetheless accepted/merged must not be
  // displayed as a failure — that would mislead the operator about what
  // shipped (the journey's blast radius).
  assert.equal(srv.deriveHistoryOutcome('901', 'ERROR', {
    ...empty, acceptedSet: new Set(['901']),
  }), 'ON_DEV');
});

// ── Journey steps 4-6 / outcome 2 for the journey's own precondition state ────
//
// For a slice in terminal ARCHIVED state, the single bridge/queue/901-ARCHIVED.md
// (full body + Rom DONE Report + Nog Review blocks — slice-pipeline §4 row 8) must
// flow through buildSliceInvestigation → GET /api/slice/901 into the History panel's
// detail tabs. Previously buildSliceInvestigation's candidate lists covered
// IN_PROGRESS/QUEUED/STAGED/PARKED/STUCK/DONE/ERROR/ACCEPTED but never ARCHIVED, so
// every tab rendered its placeholder although the file was readable on disk
// (getTitleAndGoal and /api/queue/:id/content already had the ARCHIVED fallback).
// FIXED 2026-06-14: ARCHIVED added to the prompt + terminal candidate lists.
test('J-inspect-slice-history slice-901-ac-2 — detail tabs surface body, Rom report and Nog verdict for a terminal ARCHIVED slice', async () => {
  const res = await request('GET', '/api/slice/901');
  assert.equal(res.status, 200);
  assert.ok(res.body.prompt, 'Slice body tab must show the archived original body');
  assert.match(res.body.prompt, /^## Goal$/m);
  assert.ok(res.body.report, 'Rom report tab must show the appended DONE report');
  assert.match(res.body.report, /^## Rom DONE Report — Round 1$/m);
  assert.ok(res.body.reviews.length > 0 || /## Nog Review — Round 1/.test(res.body.report),
    'Nog verdict must be reachable from the archived artifacts');
});
