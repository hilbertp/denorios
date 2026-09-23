'use strict';

/**
 * Builds a deterministic REPO_ROOT fixture for the Playwright e2e suite.
 *
 * The real dashboard frontend (lcars-dashboard.html) is served unchanged; only the
 * DATA layer (bridge/, .claude/, regression/, docs/) points here via DASHBOARD_REPO_ROOT,
 * so journeys run against known state with no risk to the live bridge.
 *
 * Rebuilt fresh on every run (config load) and re-callable from a test's beforeEach to
 * reset state before a mutating journey (approve, auto-approve).
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const REPO = path.resolve(__dirname, '..');
const ROOT = path.join(os.tmpdir(), 'lob-e2e-fixture');

const w = (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };

// Recursively copy every .js file under `src` into `dst`, preserving the directory
// structure (so bridge/state/*.js, bridge/scripts/*.js, etc. all resolve in the fixture).
function copyJsTree(src, dst) {
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) {
      copyJsTree(s, d);
    } else if (ent.isFile() && ent.name.endsWith('.js')) {
      fs.mkdirSync(path.dirname(d), { recursive: true });
      try { fs.cpSync(s, d); } catch (_) {}
    }
  }
}

function stagedSlice(id, title) {
  return `---\nid: "${id}"\ntitle: "${title}"\nfrom: obrien\nto: rom\npriority: normal\n`
       + `created: "2026-06-13T00:00:00.000Z"\nstatus: "STAGED"\n---\n\n`
       + `## Goal\n\nE2E fixture proposal ${id}.\n\n## Acceptance criteria\n\n- it works\n`;
}

function queuedSlice(id, title) {
  return `---\nid: "${id}"\ntitle: "${title}"\nfrom: obrien\nto: rom\npriority: normal\n`
       + `created: "2026-06-13T00:00:00.000Z"\nstatus: "QUEUED"\n---\n\n`
       + `## Goal\n\nE2E queued work order ${id}.\n\n## Acceptance criteria\n\n- it works\n`;
}

// A staged proposal O'Brien sent back for amendment. The server derives the status from
// the FILENAME suffix (-NEEDS_APENDMENT.md), so the suffix — not the frontmatter — is what
// makes the row render pinned and non-draggable.
function apendmentSlice(id, title) {
  return `---\nid: "${id}"\ntitle: "${title}"\nfrom: obrien\nto: rom\npriority: normal\n`
       + `created: "2026-06-13T00:00:00.000Z"\nstatus: "NEEDS_APENDMENT"\napendment_note: "needs another pass"\n---\n\n`
       + `## Goal\n\nE2E fixture amendment ${id}.\n\n## Acceptance criteria\n\n- it works\n`;
}

// ── Journey-specific seed helpers (each fully establishes the state it needs;
//    tests run serially with workers:1, so overwriting shared files is safe). ──

// Regression report (Infirmary CI-strip "report" link). LAST-RUN.md is gitignored,
// so it is ABSENT on a fresh CI checkout — the fixture must write its own deterministic
// copy or the journey behaves differently in CI than locally.
function seedRegressionReport() {
  const b = path.join(ROOT, 'bridge');               // (unused, kept for symmetry)
  void b;
  w(path.join(ROOT, 'regression', 'LAST-RUN.md'),
    '# 🟢 PASS — regression gate\n\n'
    + '**168 passed · 0 failed · 9 skipped**\n\n'
    + 'Deterministic e2e fixture report. The Infirmary "report" link renders this verbatim.\n');
}

// A merged slice in the History/Logbook with the full dev → reg → main lifecycle chain.
// recent[] entries come from DONE/ERROR events; onMain (and regressionPassed) is set by
// SLICE_MERGED_TO_MAIN; the title/goal come from COMMISSIONED; NOG_DECISION = accepted chip.
function seedHistorySlice(id = '8001') {
  const events = [
    { ts: '2026-06-13T10:00:00.000Z', event: 'COMMISSIONED', id, title: 'Merged history slice', goal: 'Prove the lifecycle chain renders.' },
    { ts: '2026-06-13T10:30:00.000Z', event: 'DONE', id, durationMs: 5000, tokensIn: 10000, tokensOut: 20000, costUsd: 0.75 },
    { ts: '2026-06-13T10:35:00.000Z', event: 'NOG_DECISION', id, verdict: 'ACCEPTED' },
    { ts: '2026-06-13T10:40:00.000Z', event: 'SLICE_MERGED_TO_MAIN', id },
  ];
  w(path.join(ROOT, 'bridge', 'register.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n');
}

// A merged slice that is ROLLED-BACK-ABLE: onMain (SLICE_MERGED_TO_MAIN) AND carrying a
// squash commit (SLICE_SQUASHED_TO_DEV → squash_sha) — both are required for the History
// row's "Roll back" button to render (dashboard: c.onMain && c.squash_sha).
function seedRolledBackableSlice(id = '8200') {
  const events = [
    { ts: '2026-06-13T10:00:00.000Z', event: 'COMMISSIONED', id, title: 'Rolled-backable slice', goal: 'Prove the History-row Roll back button.' },
    { ts: '2026-06-13T10:30:00.000Z', event: 'DONE', id, durationMs: 5000, tokensIn: 10000, tokensOut: 20000, costUsd: 0.5 },
    { ts: '2026-06-13T10:35:00.000Z', event: 'NOG_DECISION', id, verdict: 'ACCEPTED' },
    { ts: '2026-06-13T10:38:00.000Z', event: 'SLICE_SQUASHED_TO_DEV', id, squash_sha: 'sq45678' },
    { ts: '2026-06-13T10:40:00.000Z', event: 'SLICE_MERGED_TO_MAIN', id },
  ];
  w(path.join(ROOT, 'bridge', 'register.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n');
  bumpHeartbeat();
}

// Four finished slices for the verdict-recovery journey (slice 400). The register is
// the data layer behind the History/Logbook row, so the NOG_DECISION shape is what this
// seeds: three slices whose verdict was readable — one per `verdict_source` value that
// slice-400-ac-4 enumerates — and one carrying the shape the bug produced before the fix
// (Jordan's ACCEPTED filed as REJECTED/verdict_unreadable, then a second round).
//
// Real-register shapes, copied from bridge/register.jsonl: the row key is `slice_id`
// (not `id`), and NOG_DECISION carries `cycle` and `round` alongside the verdict.
function seedVerdictSourceSlices() {
  const commissioned = (id, title) =>
    ({ ts: '2026-09-23T10:00:00.000Z', slice_id: id, event: 'COMMISSIONED', title,
       goal: "Jordan's verdict is read whatever shape the file arrived in." });
  const done = (id, mm) =>
    ({ ts: `2026-09-23T10:${mm}:00.000Z`, slice_id: id, event: 'DONE',
       durationMs: 600000, tokensIn: 100, tokensOut: 5000, costUsd: 1.5 });
  const accepted = (id, mm, round, source) => {
    const ev = { ts: `2026-09-23T10:${mm}:00.000Z`, slice_id: id, event: 'NOG_DECISION',
                 verdict: 'ACCEPTED', reason: 'All criteria met.', cycle: 1, round };
    if (source) ev.verdict_source = source;   // omitted on the pre-fix shape
    return ev;
  };
  const unreadable = (id, mm, round) =>
    ({ ts: `2026-09-23T10:${mm}:00.000Z`, slice_id: id, event: 'NOG_DECISION',
       verdict: 'REJECTED', reason: 'verdict_unreadable', cycle: 1, round });

  const events = [
    // Read straight out of a well-formed frontmatter block.
    commissioned('7401', 'Verdict read from a closed frontmatter'),
    done('7401', 11), accepted('7401', 12, 1, 'frontmatter'),
    // Recovered from a file whose closing `---` was missing.
    commissioned('7402', 'Verdict recovered from an unfenced file'),
    done('7402', 13), accepted('7402', 14, 1, 'unfenced'),
    // Recovered from the Verdict line in Jordan's review section.
    commissioned('7403', 'Verdict recovered from the review section'),
    done('7403', 15), accepted('7403', 16, 1, 'review_section'),
    // The world before slice 400: the same ACCEPTED, lost, and a round spent to get it back.
    commissioned('7404', 'Verdict lost to an unreadable file'),
    done('7404', 17), unreadable('7404', 18, 1),
    done('7404', 19), accepted('7404', 20, 2, null),
  ];
  w(path.join(ROOT, 'bridge', 'register.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n');
  bumpHeartbeat();
}

// Cost data for Quark's Ledger: a Rom DONE event with real token/cost numbers
// (the ledger always lists every role zeroed; this gives Rom a non-zero row + a total).
function seedCostEvents() {
  const events = [
    { ts: '2026-06-13T12:00:00.000Z', event: 'COMMISSIONED', id: '8100', title: 'Ledger fixture', goal: 'spend' },
    { ts: '2026-06-13T12:05:00.000Z', event: 'DONE', id: '8100', durationMs: 60000, tokensIn: 4200, tokensOut: 1500, costUsd: 0.42 },
  ];
  w(path.join(ROOT, 'bridge', 'register.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n');
}

// Two QUEUED slices in Approved Work Orders for the drag-reorder journey.
function seedQueuedPair() {
  const b = path.join(ROOT, 'bridge');
  for (const d of ['staged', 'queue']) {
    const dir = path.join(b, d);
    try { for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true }); } catch (_) {}
  }
  w(path.join(b, 'queue', '5001-QUEUED.md'), queuedSlice('5001', 'Drag order one'));
  w(path.join(b, 'queue', '5002-QUEUED.md'), queuedSlice('5002', 'Drag order two'));
  w(path.join(b, 'queue-order.json'), JSON.stringify(['5001', '5002']));
  w(path.join(b, 'staged-order.json'), '[]');
  // getCachedBridgeData() keys its cache on register.jsonl + heartbeat.json mtimes only
  // (not the queue dir / queue-order). Writing queue files alone leaves a warm server
  // serving the stale boot state, so bump the heartbeat to force a rebuild.
  bumpHeartbeat();
}

// Both sections populated for the reorder journey (slice 371): three draggable proposals
// in a known order, one pinned NEEDS_APENDMENT proposal, and two approved work orders to
// drag at across the section divider.
function seedReorderableSections() {
  const b = path.join(ROOT, 'bridge');
  for (const d of ['staged', 'queue']) {
    const dir = path.join(b, d);
    try { for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true }); } catch (_) {}
  }
  w(path.join(b, 'staged', '9101-STAGED.md'), stagedSlice('9101', 'Proposed order one'));
  w(path.join(b, 'staged', '9102-STAGED.md'), stagedSlice('9102', 'Proposed order two'));
  w(path.join(b, 'staged', '9103-STAGED.md'), stagedSlice('9103', 'Proposed order three'));
  w(path.join(b, 'staged', '9104-NEEDS_APENDMENT.md'), apendmentSlice('9104', 'Sent back for amendment'));
  w(path.join(b, 'queue', '5001-QUEUED.md'), queuedSlice('5001', 'Approved order one'));
  w(path.join(b, 'queue', '5002-QUEUED.md'), queuedSlice('5002', 'Approved order two'));
  w(path.join(b, 'staged-order.json'), JSON.stringify(['9101', '9102', '9103']));
  w(path.join(b, 'queue-order.json'), JSON.stringify(['5001', '5002']));
  bumpHeartbeat();
}

// Rewrite heartbeat.json with a fresh timestamp so its mtime advances and the server's
// bridge-data cache invalidates (it keys on register + heartbeat mtimes).
function bumpHeartbeat() {
  w(path.join(ROOT, 'bridge', 'heartbeat.json'),
    JSON.stringify({ current_slice: null, ts: new Date().toISOString() }));
}

function seedFixture() {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(ROOT, { recursive: true });

  // Read-only content the dashboard surfaces (crew dossiers, artifacts, coverage).
  for (const dir of ['.claude', 'regression', 'docs']) {
    try { fs.cpSync(path.join(REPO, dir), path.join(ROOT, dir), { recursive: true }); } catch (_) {}
  }

  // Deterministic bridge/ state.
  const b = path.join(ROOT, 'bridge');
  for (const d of ['queue', 'staged', 'trash', 'control', 'errors', 'state', 'logs']) {
    fs.mkdirSync(path.join(b, d), { recursive: true });
  }
  // The server require()s bridge JS modules from REPO_ROOT (lifecycle-translate at boot,
  // gate-alerts on /api/gate-health, orchestrator lazily on gate-start). Those modules
  // pull in bridge/state/*.js (atomic-write, gate-mutex, gate-telemetry, …) too, so copy
  // EVERY .js under bridge/ preserving structure — a flat top-level copy misses
  // bridge/state/ and crashes the server on the first /api/gate-health poll.
  copyJsTree(path.join(REPO, 'bridge'), b);
  w(path.join(b, 'register.jsonl'), '');
  w(path.join(b, 'heartbeat.json'), JSON.stringify({ current_slice: null, ts: '2026-06-13T00:00:00.000Z' }));
  w(path.join(b, 'queue-order.json'), '[]');
  w(path.join(b, 'staged-order.json'), JSON.stringify(['9001', '9002']));
  w(path.join(b, 'sessions.jsonl'), '');
  w(path.join(b, 'first-output.json'), '{}');
  w(path.join(b, 'nog-active.json'), '{}');
  w(path.join(b, 'state', 'branch-state.json'),
    JSON.stringify({ gate: { status: 'IDLE' }, dev: { commits_ahead_of_main: 0 } }, null, 2));
  // Slice 354: the standing auto-approve policy moved out of localStorage onto the
  // server, so it is fixture state now and has to be seeded like any other. Off is
  // the deterministic start every journey assumes — with it on, a page load sweeps
  // every staged proposal to QUEUED before the first assertion runs.
  w(path.join(b, 'state', 'auto-approve.json'),
    JSON.stringify({ enabled: false, ts: null }, null, 2));

  // Two staged proposals → Engineering Queue "Proposed Improvement" section.
  w(path.join(b, 'staged', '9001-STAGED.md'), stagedSlice('9001', 'E2E — first proposal'));
  w(path.join(b, 'staged', '9002-STAGED.md'), stagedSlice('9002', 'E2E — second proposal'));

  return ROOT;
}

// Light reset for mutating journeys: restore the staged proposals + empty the queue,
// WITHOUT nuking the tree the live server is polling (that would crash it mid-request).
function resetQueueState() {
  const b = path.join(ROOT, 'bridge');
  for (const d of ['staged', 'queue']) {
    const dir = path.join(b, d);
    try { for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true }); } catch (_) {}
  }
  w(path.join(b, 'staged-order.json'), JSON.stringify(['9001', '9002']));
  w(path.join(b, 'queue-order.json'), '[]');
  // Slice 354: the auto-approve policy now outlives the browser context that set
  // it, so a journey that flips it on leaves it on for whatever runs next. Clearing
  // it is part of restoring the staged proposals, not a separate concern.
  w(path.join(b, 'state', 'auto-approve.json'),
    JSON.stringify({ enabled: false, ts: null }, null, 2));
  w(path.join(b, 'staged', '9001-STAGED.md'), stagedSlice('9001', 'E2E — first proposal'));
  w(path.join(b, 'staged', '9002-STAGED.md'), stagedSlice('9002', 'E2E — second proposal'));
}

module.exports = seedFixture;
module.exports.ROOT = ROOT;
module.exports.resetQueueState = resetQueueState;
module.exports.seedRegressionReport = seedRegressionReport;
module.exports.seedHistorySlice = seedHistorySlice;
module.exports.seedCostEvents = seedCostEvents;
module.exports.seedQueuedPair = seedQueuedPair;
module.exports.seedReorderableSections = seedReorderableSections;
module.exports.seedRolledBackableSlice = seedRolledBackableSlice;
module.exports.seedVerdictSourceSlices = seedVerdictSourceSlices;
