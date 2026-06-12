'use strict';

/**
 * Journey: J-pipeline-pause-resume
 * Category: Recovery
 *
 * What this tests (spec = journey text, not implementation):
 *   An operator pauses dispatch by creating `bridge/.pipeline-paused`
 *   (journey step 2b). While the flag is present, the orchestrator's poll
 *   cycle performs ZERO new pickups regardless of QUEUED count (steps 3-4,
 *   outcome 1), and any slice already IN_PROGRESS is left untouched — pause
 *   stops pickups, not active work (step 6, outcome 2). Pause and resume
 *   emit NO register events: it is a file-presence signal only (outcome 5).
 *   After the operator removes the flag (step 8b), the next poll cycle
 *   resumes normal dispatch and picks up the first QUEUED slice — the head
 *   of queue-order.json (steps 9-10, outcome 4).
 *
 * Tier 1 contract simulation — the poll-cycle dispatch guard is simulated
 * with the same primitives the orchestrator uses (fs.existsSync existence
 * check FIRST, best-effort JSON read of the flag content, queue-order.json
 * head consumption, fs.renameSync for the QUEUED → IN_PROGRESS suffix move).
 * ALL state lives in a tmpdir (#99992): the pause flag is `.pipeline-paused`
 * in the tmp bridge root, NEVER the live bridge/.pipeline-paused.
 *
 * Deliberately NOT asserted here (and why):
 *   - The REAL guard in bridge/orchestrator.js is not drivable headlessly:
 *     PIPELINE_PAUSED_FILE is hard-anchored to live bridge/.pipeline-paused
 *     (orchestrator.js:83, path.resolve(__dirname, ...)) and is NOT
 *     redirected by _testSetDirs/_testSetProjectDir — creating it from a
 *     test would pause the LIVE pipeline (#99992 violation). Redirection
 *     gap recorded as a finding for Worf in the run report.
 *   - Outcome 3 ("node bridge/state-doctor.js shows Pause flag: PRESENT"):
 *     state-doctor.js is likewise REPO_ROOT-anchored — its output cannot be
 *     exercised against a tmpdir in isolation. Same redirection-gap finding.
 *   - Steps 2a/8a (Ops Center UI toggle): open question in the journey doc
 *     (routed to Ziyal) — no UI control is specified to test against.
 *   - Step 6 "continues to completion" in full (a live Rom child finishing
 *     under pause): requires a spawned worker; the headless-observable
 *     contract is that the paused cycle does not touch the IN_PROGRESS file.
 *   - Known failure mode "pause does not abort an active Bashir gate run":
 *     gate-abort interaction is owned by the runbook/F7 journeys, and the
 *     old local gate lane is retired post slice 316.
 *
 * Sources: docs/e2e-journeys/J-pipeline-pause-resume.md
 *          bridge/orchestrator.js — guard primitives only (existence check
 *            at the top of the dispatch cycle; MERGE_NOT_PUSHED flag payload
 *            shape {ts, event, reason}; queue-order.json head consumption)
 *          docs/runbooks/RUNBOOK-BASHIR-GATE.md §F12 (set/remove recovery)
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const { makeTmpDir, removeTmpDir } = require('../helpers/tmp-dir');
const { buildSliceFile }           = require('../helpers/slice-factory');
const { parseFrontmatter, readQueueOrder, writeQueueOrder } = require('../helpers/pipeline-logic');
const { initRegisterFile, appendRegisterEvent, parseRegisterLines } = require('../helpers/register-helper');

let tmpDir;
let scenarioCount = 0;

before(() => { tmpDir = makeTmpDir('j-pipeline-pause-resume'); });
after(()  => removeTmpDir(tmpDir));

// ---------------------------------------------------------------------------
// Fixture: a fresh tmp "bridge root" per test — queue/, register.jsonl,
// queue-order.json, and the pause flag path .pipeline-paused, laid out the
// way the journey describes them relative to the bridge root. Each test gets
// its own scenario dir so tests stay order-independent.
// ---------------------------------------------------------------------------
function makeScenario({ queuedIds = [], order = null } = {}) {
  const root     = path.join(tmpDir, `scenario-${++scenarioCount}`);
  const queueDir = path.join(root, 'queue');
  fs.mkdirSync(queueDir, { recursive: true });

  const registerFile   = path.join(root, 'register.jsonl');
  const queueOrderPath = path.join(root, 'queue-order.json');
  const pausedFile     = path.join(root, '.pipeline-paused');

  initRegisterFile(registerFile);
  writeQueueOrder(queueOrderPath, order || queuedIds);

  for (const id of queuedIds) {
    fs.writeFileSync(
      path.join(queueDir, `${id}-QUEUED.md`),
      buildSliceFile({ id, status: 'QUEUED' })
    );
  }

  return { root, queueDir, registerFile, queueOrderPath, pausedFile };
}

// ---------------------------------------------------------------------------
// Simulated poll-cycle dispatch step, built from the orchestrator's own
// primitives (journey steps 3-4 + 9-10):
//   1. Guard: fs.existsSync(.pipeline-paused) checked FIRST. If present,
//      content is read best-effort (JSON.parse in a try/catch — malformed or
//      empty content still means paused) and the cycle returns WITHOUT
//      touching the queue. The guard emits no register event.
//   2. Dispatch: head of queue-order.json that has a matching -QUEUED.md is
//      picked up via atomic fs.renameSync QUEUED → IN_PROGRESS. One pickup
//      per cycle.
// Returns { paused, dispatched } for assertion.
// ---------------------------------------------------------------------------
function simulatePollCycleDispatch(scn) {
  // Pause guard — existence first, content best-effort (journey step 3).
  if (fs.existsSync(scn.pausedFile)) {
    try { JSON.parse(fs.readFileSync(scn.pausedFile, 'utf-8')); } catch (_) { /* still paused */ }
    return { paused: true, dispatched: null };
  }

  // Normal dispatch — queue-order.json head consumption (journey step 10).
  const orderIds = readQueueOrder(scn.queueOrderPath);
  const queuedFileMap = {};
  for (const f of fs.readdirSync(scn.queueDir)) {
    if (f.endsWith('-QUEUED.md') || f.endsWith('-PENDING.md')) {
      queuedFileMap[f.replace(/-(?:QUEUED|PENDING)\.md$/, '')] = f;
    }
  }
  for (const id of orderIds.map(String)) {
    if (queuedFileMap[id]) {
      fs.renameSync(
        path.join(scn.queueDir, queuedFileMap[id]),
        path.join(scn.queueDir, `${id}-IN_PROGRESS.md`)
      );
      writeQueueOrder(scn.queueOrderPath, orderIds.filter(o => String(o) !== id));
      return { paused: false, dispatched: id };
    }
  }
  return { paused: false, dispatched: null };
}

// Snapshot of the queue dir: sorted filenames → content bytes.
function snapshotQueue(queueDir) {
  const snap = {};
  for (const f of fs.readdirSync(queueDir).sort()) {
    snap[f] = fs.readFileSync(path.join(queueDir, f), 'utf-8');
  }
  return snap;
}

// ---------------------------------------------------------------------------
// Outcome 1 (slice-091-ac-1): while .pipeline-paused is present, a poll
// cycle performs ZERO pickups regardless of QUEUED count — and the skip
// holds for all subsequent cycles until the flag is removed (steps 3-4).
// ---------------------------------------------------------------------------
test('J-pipeline-pause-resume slice-091-ac-1 — paused poll cycle performs zero pickups regardless of QUEUED count', () => {
  const scn = makeScenario({ queuedIds: ['091', '092', '093'] });
  fs.writeFileSync(scn.pausedFile, ''); // step 2b: touch bridge/.pipeline-paused

  const before1 = snapshotQueue(scn.queueDir);
  const cycle1  = simulatePollCycleDispatch(scn);
  assert.equal(cycle1.paused, true, 'cycle must detect the pause flag (journey step 3)');
  assert.equal(cycle1.dispatched, null, 'no slice may be dispatched while paused (outcome 1)');

  // "this cycle and all subsequent cycles until the flag is removed" (step 4)
  const cycle2 = simulatePollCycleDispatch(scn);
  assert.equal(cycle2.dispatched, null, 'every subsequent cycle must also skip dispatch while the flag persists (step 4)');

  const after2 = snapshotQueue(scn.queueDir);
  assert.deepEqual(after2, before1,
    'queue contents must be byte-identical after paused cycles — zero pickups, no renames, no mutation');
  assert.equal(Object.keys(after2).filter(f => f.endsWith('-IN_PROGRESS.md')).length, 0,
    'no -IN_PROGRESS.md may appear while paused, no matter how many slices are QUEUED');
  assert.deepEqual(readQueueOrder(scn.queueOrderPath), ['091', '092', '093'],
    'queue-order.json must be untouched by paused cycles — QUEUED slices accumulate, not consumed (outcome 2)');
});

// ---------------------------------------------------------------------------
// Outcome 2 (slice-091-ac-1): pause stops new pickups only — a slice already
// IN_PROGRESS is untouched by paused cycles (step 6: active work continues;
// the pause does not abort it).
// ---------------------------------------------------------------------------
test('J-pipeline-pause-resume slice-091-ac-1 — pause leaves an existing IN_PROGRESS slice untouched (stops pickups, not active work)', () => {
  const scn = makeScenario({ queuedIds: ['092'] });
  const inProgressPath    = path.join(scn.queueDir, '090-IN_PROGRESS.md');
  const inProgressContent = buildSliceFile({ id: '090', status: 'IN_PROGRESS' });
  fs.writeFileSync(inProgressPath, inProgressContent);

  fs.writeFileSync(scn.pausedFile, '');
  const cycle = simulatePollCycleDispatch(scn);

  assert.equal(cycle.dispatched, null, 'paused cycle must not dispatch the QUEUED slice');
  assert.ok(fs.existsSync(inProgressPath),
    '090-IN_PROGRESS.md must still exist after a paused cycle — pause must not abort active work (step 6)');
  assert.equal(fs.readFileSync(inProgressPath, 'utf-8'), inProgressContent,
    'IN_PROGRESS file must be byte-identical — paused cycles may not mutate active work (outcome 2)');
  assert.ok(fs.existsSync(path.join(scn.queueDir, '092-QUEUED.md')),
    'the QUEUED slice must still be waiting, accumulated, not picked up (outcome 2)');
});

// ---------------------------------------------------------------------------
// Outcome 5 (slice-091-ac-2): pause and resume are a file-presence signal
// only — NO events are appended to the register for either action. The
// register is byte-identical before pause / after resume.
// ---------------------------------------------------------------------------
test('J-pipeline-pause-resume slice-091-ac-2 — pause and resume append no register events (file-presence signal only)', () => {
  const scn = makeScenario({ queuedIds: ['091'] });
  // Seed prior history so the byte-compare is meaningful, not trivially empty.
  appendRegisterEvent(scn.registerFile, { event: 'HUMAN_APPROVAL', slice_id: '091', action: 'approved' });

  const registerBefore = fs.readFileSync(scn.registerFile, 'utf-8');
  const eventsBefore   = parseRegisterLines(scn.registerFile).length;

  fs.writeFileSync(scn.pausedFile, '');        // pause action (step 2b)
  simulatePollCycleDispatch(scn);              // a paused cycle passes
  fs.unlinkSync(scn.pausedFile);               // resume action (step 8b)

  const registerAfter = fs.readFileSync(scn.registerFile, 'utf-8');
  assert.equal(registerAfter, registerBefore,
    'register.jsonl must be byte-identical across pause → paused cycle → resume (outcome 5: no events emitted)');
  assert.equal(parseRegisterLines(scn.registerFile).length, eventsBefore,
    'no register event may be appended for pause or resume actions');
});

// ---------------------------------------------------------------------------
// Steps 9-10 + Outcome 4 (slice-091-ac-3): after the flag is removed, the
// very next poll cycle resumes dispatch and picks up the FIRST QUEUED slice
// — the head of queue-order.json, not lowest-id order.
// ---------------------------------------------------------------------------
test('J-pipeline-pause-resume slice-091-ac-3 — after flag removal the next cycle dispatches the queue-order.json head slice', () => {
  // Order head (093) deliberately differs from lowest id (092) to pin
  // head-of-queue-order semantics for "the next QUEUED slice".
  const scn = makeScenario({ queuedIds: ['092', '093'], order: ['093', '092'] });

  fs.writeFileSync(scn.pausedFile, '');
  assert.equal(simulatePollCycleDispatch(scn).dispatched, null, 'precondition: dispatch is held while paused');

  fs.unlinkSync(scn.pausedFile); // step 8b: rm bridge/.pipeline-paused

  const cycle = simulatePollCycleDispatch(scn); // step 9: next poll cycle detects absence
  assert.equal(cycle.paused, false, 'cycle after removal must detect the flag is absent (step 9)');
  assert.equal(cycle.dispatched, '093',
    'first QUEUED slice (queue-order.json head) must be dispatched within one poll cycle of flag removal (outcome 4)');

  const inProgressPath = path.join(scn.queueDir, '093-IN_PROGRESS.md');
  assert.ok(fs.existsSync(inProgressPath), 'head slice must be renamed to -IN_PROGRESS.md (step 10: picked up)');
  assert.ok(!fs.existsSync(path.join(scn.queueDir, '093-QUEUED.md')), 'head slice must no longer be QUEUED');
  assert.ok(fs.existsSync(path.join(scn.queueDir, '092-QUEUED.md')),
    'non-head slice must remain QUEUED — one pickup per cycle, FIFO order respected');

  // The suffix move must not corrupt the slice: frontmatter still parseable.
  const meta = parseFrontmatter(fs.readFileSync(inProgressPath, 'utf-8'));
  assert.ok(meta, 'dispatched slice frontmatter must still parse after the QUEUED → IN_PROGRESS rename');
  assert.equal(meta.id, '093', 'dispatched slice id must match the queue-order head');
});

// ---------------------------------------------------------------------------
// Step 2b flag tolerance (slice-091-ac-4): the guard reads existence FIRST,
// content best-effort. All three flag shapes mean paused:
//   (a) empty touch-file (`touch bridge/.pipeline-paused`),
//   (b) the JSON payload orchestrator.js writes on MERGE_NOT_PUSHED
//       ({ts, event, reason}),
//   (c) malformed JSON.
// ---------------------------------------------------------------------------
test('J-pipeline-pause-resume slice-091-ac-4 — empty touch-file pause flag halts dispatch', () => {
  const scn = makeScenario({ queuedIds: ['091'] });
  fs.writeFileSync(scn.pausedFile, ''); // bare `touch` — zero bytes

  const cycle = simulatePollCycleDispatch(scn);
  assert.equal(cycle.paused, true, 'empty flag file must mean paused (step 2b: touch is the documented interface)');
  assert.equal(cycle.dispatched, null, 'no dispatch under an empty touch-file flag');
  assert.ok(fs.existsSync(path.join(scn.queueDir, '091-QUEUED.md')), 'QUEUED slice must remain untouched');
});

test('J-pipeline-pause-resume slice-091-ac-4 — JSON payload pause flag ({reason,event} MERGE_NOT_PUSHED shape) halts dispatch', () => {
  const scn = makeScenario({ queuedIds: ['091'] });
  // The shape the orchestrator itself writes when it self-pauses on a
  // failed merge push: { ts, event: 'MERGE_NOT_PUSHED', ...payload }.
  fs.writeFileSync(scn.pausedFile, JSON.stringify({
    ts: '2026-01-01T00:00:00Z',
    event: 'MERGE_NOT_PUSHED',
    reason: 'merge commit could not be pushed to origin',
  }, null, 2) + '\n');

  const cycle = simulatePollCycleDispatch(scn);
  assert.equal(cycle.paused, true, 'JSON-payload flag must mean paused — same file-presence signal');
  assert.equal(cycle.dispatched, null, 'no dispatch while the self-pause payload flag exists');
  assert.ok(fs.existsSync(path.join(scn.queueDir, '091-QUEUED.md')), 'QUEUED slice must remain untouched');
});

test('J-pipeline-pause-resume slice-091-ac-4 — malformed JSON in pause flag still pauses (existence first, content best-effort)', () => {
  const scn = makeScenario({ queuedIds: ['091'] });
  fs.writeFileSync(scn.pausedFile, '{not valid json — operator scribble\n');

  const cycle = simulatePollCycleDispatch(scn);
  assert.equal(cycle.paused, true,
    'malformed flag content must still pause — the guard keys on file EXISTENCE, content is read best-effort only');
  assert.equal(cycle.dispatched, null, 'no dispatch under a malformed flag');
  assert.ok(fs.existsSync(path.join(scn.queueDir, '091-QUEUED.md')), 'QUEUED slice must remain untouched');
});

// ---------------------------------------------------------------------------
// Round-trip (slice-091-ac-1 + slice-091-ac-3 composed): pause-accumulate-
// resume — slices queued DURING the pause accumulate and are dispatched in
// order once the flag is removed (outcomes 1, 2, 4 as one operator story).
// ---------------------------------------------------------------------------
test('J-pipeline-pause-resume slice-091-ac-3 — slices queued during the pause accumulate and dispatch in order after resume', () => {
  const scn = makeScenario({ queuedIds: ['094'] });
  fs.writeFileSync(scn.pausedFile, '');

  assert.equal(simulatePollCycleDispatch(scn).dispatched, null, 'held while paused');

  // More work arrives during the pause (outcome 2: accumulates, not picked up).
  fs.writeFileSync(path.join(scn.queueDir, '095-QUEUED.md'), buildSliceFile({ id: '095', status: 'QUEUED' }));
  writeQueueOrder(scn.queueOrderPath, ['094', '095']);
  assert.equal(simulatePollCycleDispatch(scn).dispatched, null,
    'still held — QUEUED count grew during pause but zero pickups occur (outcome 1)');
  assert.equal(fs.readdirSync(scn.queueDir).filter(f => f.endsWith('-QUEUED.md')).length, 2,
    'both slices accumulate as QUEUED during the pause (outcome 2)');

  fs.unlinkSync(scn.pausedFile);

  assert.equal(simulatePollCycleDispatch(scn).dispatched, '094',
    'first post-resume cycle dispatches the head of the accumulated queue (outcome 4)');
  assert.equal(simulatePollCycleDispatch(scn).dispatched, '095',
    'subsequent cycle dispatches the next accumulated slice — normal dispatch fully restored (step 9)');
});
