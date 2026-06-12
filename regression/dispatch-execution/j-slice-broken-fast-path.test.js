'use strict';

/**
 * Journey: J-slice-broken-fast-path
 * Category: Dispatch & Execution
 *
 * What this tests (asserted FROM the spec, not from the implementation):
 *   When Rom judges the slice SPEC itself broken (not his implementation),
 *   he appends a block with the exact heading "## Rom Escalation — Slice
 *   Broken". The watcher recognises that exact heading, short-circuits the
 *   normal DONE → IN_REVIEW transition (no Nog invocation for this pickup),
 *   and routes the slice file to bridge/staged/{id}-STAGED.md for O'Brien.
 *   The Nog round counter is NOT incremented by the escalation.
 *
 * Spec sources:
 *   - docs/e2e-journeys/J-slice-broken-fast-path.md (steps 3, 7, 8; outcomes 1-4)
 *   - docs/contracts/slice-pipeline.md §5 (IN_PROGRESS → STAGED fast-path row),
 *     §9 (round-counter exemption), §10 (exact heading + STAGED routing)
 *   - docs/contracts/slice-format.md (append-only discipline; `status`
 *     frontmatter kept in sync with the filename suffix)
 *
 * Tiers:
 *   - Tier 1: contract simulation in an isolated tmpdir, using the same
 *     primitives as the watcher (fs.renameSync for moves, fs.appendFileSync
 *     for appended blocks).
 *   - Tier 3a: the orchestrator's exported handleReturnToStage() — the real
 *     product *-to-STAGED move — driven with _testSetDirs /
 *     _testSetRegisterFile / _testSetProjectDir redirection, to confirm the
 *     staged/{id}-STAGED.md naming the journey specifies. (The fast-path
 *     detection itself is inline in the watcher loop and not exported, so it
 *     stays at Tier 1.)
 *
 * Deliberately NOT asserted (and why):
 *   - Register event name for the escalation. The journey lists the exact
 *     event name as an OPEN QUESTION ("Is it ESCALATED, SLICE_BROKEN, or
 *     something else?") and slice-pipeline.md §7.1's canonical event table
 *     does not define one. A previous revision of this file asserted
 *     ROM_ESCALATE sourced from orchestrator.js line numbers — that mirrors
 *     the implementation, not the spec, so the assertion was removed. This
 *     used to be "ac-3"; the index is retired, not reused.
 *   - Rom's actual judgment / claude spawn, and the dashboard escalation
 *     badge — not headless-testable per the journey scope.
 */

const { test, before, after } = require('node:test');
const assert  = require('node:assert/strict');
const fs      = require('node:fs');
const path    = require('node:path');

const { makeTmpDir, removeTmpDir } = require('../helpers/tmp-dir');
const {
  buildSliceFile,
  buildRomDoneReport,
  buildNogReviewBlock,
  buildRomEscalationBlock,
} = require('../helpers/slice-factory');
const {
  parseFrontmatter,
  hasRomEscalationBlock,
  countNogRounds,
} = require('../helpers/pipeline-logic');
const { initRegisterFile } = require('../helpers/register-helper');

// Journey fixture slice id — used in every test name for AC traceability.
const SLICE_ID   = '070'; // escalated rework slice (Tier 1)
const HEALTHY_ID = '071'; // healthy slice, no escalation (over-detection guard)
const NEARMISS_ID = '072'; // near-miss heading slice (mis-detection guard)
const RTS_ID     = '073'; // Tier 3a: real handleReturnToStage move

// The fixture AC text Rom cites verbatim in his escalation (journey step 4).
const FIXTURE_AC = 'The system must persist state without writing any file.';
const ESCALATION_REASON =
  `AC 1 "${FIXTURE_AC}" is architecturally impossible — persistence in this ` +
  'pipeline IS file-writing. O\'Brien should reconsider the AC or the goal.';

let tmpDir;
let queueDir;
let stagedDir;
let trashDir;
let registerFile;
let orch; // bridge/orchestrator.js, dirs redirected in before()

// Content of the escalated slice at the moment Rom signals completion:
// original body + Round-1 DONE report + Nog Round-1 REJECT + Round-2 DONE
// report (rework pickup per journey preconditions) + escalation block.
let preEscalationContent; // everything ABOVE the escalation block
let escalatedContent;     // preEscalationContent + escalation block

before(() => {
  tmpDir       = makeTmpDir('j-slice-broken-fast-path');
  queueDir     = path.join(tmpDir, 'queue');
  stagedDir    = path.join(tmpDir, 'staged');
  trashDir     = path.join(tmpDir, 'trash');
  registerFile = path.join(tmpDir, 'register.jsonl');
  fs.mkdirSync(queueDir);
  fs.mkdirSync(stagedDir);
  fs.mkdirSync(trashDir);
  // _testSetProjectDir anchors branch-state under <dir>/bridge/state.
  fs.mkdirSync(path.join(tmpDir, 'bridge', 'state'), { recursive: true });
  initRegisterFile(registerFile);

  // Tier 3a: module load mkdirSyncs live bridge dirs (idempotent, creates no
  // files) — redirect ALL state to the tmpdir IMMEDIATELY, before any
  // exported function is called (#99992 rule).
  orch = require('../../bridge/orchestrator.js');
  orch._testSetDirs(queueDir, stagedDir, trashDir);
  orch._testSetProjectDir(tmpDir);
  orch._testSetRegisterFile(registerFile);

  preEscalationContent =
    buildSliceFile({ id: SLICE_ID, status: 'DONE' }, [`1. ${FIXTURE_AC}`]) +
    buildRomDoneReport(1) +
    buildNogReviewBlock(1, 'REJECT', 'AC 1 not satisfied.') +
    buildRomDoneReport(2);
  escalatedContent = preEscalationContent + buildRomEscalationBlock(ESCALATION_REASON);
});

after(() => removeTmpDir(tmpDir));

// ---------------------------------------------------------------------------
// Tier 1 simulation of the watcher's routing decision (slice-pipeline.md §5 +
// §10): detection by the exact heading; renameSync to staged/{id}-STAGED.md
// on escalation, renameSync to {id}-IN_REVIEW.md otherwise. No register write
// is simulated — the escalation event name is unspecified (see header).
// ---------------------------------------------------------------------------

function writeDoneFile(id, content) {
  const filePath = path.join(queueDir, `${id}-DONE.md`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

function simulateFastPath(id) {
  const donePath = path.join(queueDir, `${id}-DONE.md`);
  const content  = fs.readFileSync(donePath, 'utf8');
  if (hasRomEscalationBlock(content)) {
    const stagedPath = path.join(stagedDir, `${id}-STAGED.md`);
    fs.renameSync(donePath, stagedPath);
    return { routed: 'staged', finalPath: stagedPath };
  }
  const inReviewPath = path.join(queueDir, `${id}-IN_REVIEW.md`);
  fs.renameSync(donePath, inReviewPath);
  return { routed: 'in_review', finalPath: inReviewPath };
}

// ---------------------------------------------------------------------------
// ac-1 — journey steps 3+7: the exact heading triggers the fast path
// ---------------------------------------------------------------------------
test('J-slice-broken-fast-path slice-070-ac-1 — exact heading "## Rom Escalation — Slice Broken" is detected, including amid prior round history', () => {
  assert.ok(
    hasRomEscalationBlock(buildRomEscalationBlock(ESCALATION_REASON)),
    'Escalation block alone must match the fast-path detection pattern'
  );
  assert.ok(
    hasRomEscalationBlock(escalatedContent),
    'Escalation heading must be detected inside a full rework-history slice file'
  );
  assert.ok(
    !hasRomEscalationBlock(preEscalationContent),
    'A rework file WITHOUT the escalation block must not be detected (prior DONE reports + Nog reviews are not escalations)'
  );
});

// ---------------------------------------------------------------------------
// ac-7 — failure mode 1: a heading that differs even slightly from the exact
// string must NOT trigger the fast path (mis-detection guard)
// ---------------------------------------------------------------------------
test('J-slice-broken-fast-path slice-070-ac-7 — near-miss heading variants do NOT trigger the fast path', () => {
  const notEscalations = [
    '## Rom Escalation — Slice broken',          // lowercase 'broken'
    '## Rom Escalation - Slice Broken',          // ASCII hyphen, not em-dash
    '## Rom escalation — Slice Broken',          // lowercase 'escalation'
    '## Rom Escalation—Slice Broken',            // missing spaces around em-dash
    '## ROM Escalation — Slice Broken',          // all-caps ROM
    '### Rom Escalation — Slice Broken',         // wrong heading level
    '## Rom Escalation — Slice Broken (Round 2)', // trailing text after heading
    '  ## Rom Escalation — Slice Broken',        // indented, not the exact heading line
    'Rom Escalation — Slice Broken',             // missing heading marker entirely
  ];
  for (const variant of notEscalations) {
    assert.strictEqual(
      hasRomEscalationBlock(variant), false,
      `Variant ${JSON.stringify(variant)} must NOT trigger the fast path`
    );
  }
});

// ---------------------------------------------------------------------------
// ac-2 — journey step 8 + outcomes 2+3: escalated slice routes to
// staged/{id}-STAGED.md and does NOT land in queue/{id}-IN_REVIEW.md
// ---------------------------------------------------------------------------
test('J-slice-broken-fast-path slice-070-ac-2 — escalated slice routes to staged/{id}-STAGED.md, not queue/{id}-IN_REVIEW.md', () => {
  writeDoneFile(SLICE_ID, escalatedContent);
  const { routed, finalPath } = simulateFastPath(SLICE_ID);

  assert.strictEqual(routed, 'staged', 'Fast path must route to staged/');
  assert.strictEqual(
    finalPath, path.join(stagedDir, `${SLICE_ID}-STAGED.md`),
    'Staged file must use exactly the {id}-STAGED.md naming'
  );
  assert.ok(fs.existsSync(finalPath), 'staged/{id}-STAGED.md must exist after the fast path');
  assert.ok(
    !fs.existsSync(path.join(queueDir, `${SLICE_ID}-IN_REVIEW.md`)),
    'No IN_REVIEW file may be created — no Nog invocation for this pickup'
  );
  assert.ok(
    !fs.existsSync(path.join(queueDir, `${SLICE_ID}-DONE.md`)),
    'The DONE file must be gone from queue/ (renamed, not copied)'
  );
});

// ---------------------------------------------------------------------------
// ac-4 — outcome 4 + slice-pipeline.md §9: escalation does not consume a round
// ---------------------------------------------------------------------------
test('J-slice-broken-fast-path slice-070-ac-4 — round counter is unchanged by the escalation (§9 exemption)', () => {
  const roundsBefore = countNogRounds(preEscalationContent);
  assert.strictEqual(roundsBefore, 1, 'Fixture sanity: one prior Nog review round');

  const stagedContent = fs.readFileSync(path.join(stagedDir, `${SLICE_ID}-STAGED.md`), 'utf8');
  assert.strictEqual(
    countNogRounds(stagedContent), roundsBefore,
    'Escalation must not add a "## Nog Review — Round N" heading — the round counter (counted from the file per §9) stays unchanged'
  );
});

// ---------------------------------------------------------------------------
// ac-8 — outcome 1 + slice-format append-only: escalation block is appended
// after the original body and ALL prior round history, everything preserved
// ---------------------------------------------------------------------------
test('J-slice-broken-fast-path slice-070-ac-8 — escalation block appends after original body and prior rounds; all prior content preserved verbatim', () => {
  const stagedContent = fs.readFileSync(path.join(stagedDir, `${SLICE_ID}-STAGED.md`), 'utf8');

  assert.ok(
    stagedContent.startsWith(preEscalationContent),
    'Everything above the escalation block must be byte-identical (append-only discipline)'
  );
  const escalationIdx = stagedContent.indexOf('## Rom Escalation — Slice Broken');
  assert.ok(escalationIdx !== -1, 'Escalation heading must be present in the staged file');
  assert.ok(
    stagedContent.lastIndexOf('## Rom DONE Report — Round 2') < escalationIdx,
    'Escalation block must come AFTER the last prior round block (appended, not inserted)'
  );
  assert.ok(
    stagedContent.includes(FIXTURE_AC),
    'The problematic AC cited verbatim by Rom must survive the routing (outcome 1)'
  );
  assert.ok(
    stagedContent.includes(ESCALATION_REASON),
    'Rom\'s explanation of why the spec is broken must survive the routing (outcome 1)'
  );
});

// ---------------------------------------------------------------------------
// ac-5 — O'Brien pickup (journey step 9): staged file is still a parseable slice
// ---------------------------------------------------------------------------
test('J-slice-broken-fast-path slice-070-ac-5 — staged escalated file keeps parseable frontmatter with the same id', () => {
  const stagedContent = fs.readFileSync(path.join(stagedDir, `${SLICE_ID}-STAGED.md`), 'utf8');
  const meta = parseFrontmatter(stagedContent);
  assert.ok(meta, 'Frontmatter must still parse after the fast-path move');
  assert.strictEqual(meta.id, SLICE_ID, 'Slice id must be unchanged');
});

// ---------------------------------------------------------------------------
// ac-6 — blast-radius guard (over-detection): a healthy DONE slice without the
// escalation heading takes the normal DONE → IN_REVIEW path
// ---------------------------------------------------------------------------
test('J-slice-broken-fast-path slice-070-ac-6 — healthy DONE without escalation routes to IN_REVIEW, never silently back to staged', () => {
  const healthy = buildSliceFile({ id: HEALTHY_ID, status: 'DONE' }) + buildRomDoneReport(1);
  writeDoneFile(HEALTHY_ID, healthy);
  const { routed } = simulateFastPath(HEALTHY_ID);

  assert.strictEqual(routed, 'in_review', 'Healthy DONE must advance to IN_REVIEW (Nog)');
  assert.ok(
    fs.existsSync(path.join(queueDir, `${HEALTHY_ID}-IN_REVIEW.md`)),
    'queue/{id}-IN_REVIEW.md must exist for the healthy slice'
  );
  assert.ok(
    !fs.existsSync(path.join(stagedDir, `${HEALTHY_ID}-STAGED.md`)),
    'Healthy slice must NOT be yanked back to staged/ without review'
  );
});

// ---------------------------------------------------------------------------
// ac-9 — failure mode 1, end to end: a near-miss heading inside a real DONE
// file does NOT fire the fast path; the slice advances to Nog normally
// ---------------------------------------------------------------------------
test('J-slice-broken-fast-path slice-070-ac-9 — DONE file containing only a near-miss heading routes to IN_REVIEW (fast path not triggered)', () => {
  const nearMiss =
    buildSliceFile({ id: NEARMISS_ID, status: 'DONE' }) +
    buildRomDoneReport(1) +
    '\n\n---\n## Rom Escalation - Slice Broken\n\nASCII hyphen — not the exact heading.\n';
  writeDoneFile(NEARMISS_ID, nearMiss);
  const { routed } = simulateFastPath(NEARMISS_ID);

  assert.strictEqual(
    routed, 'in_review',
    'A heading that differs even slightly must not trigger the fast path — slice advances to Nog (journey failure mode 1)'
  );
  assert.ok(
    !fs.existsSync(path.join(stagedDir, `${NEARMISS_ID}-STAGED.md`)),
    'Near-miss slice must not land in staged/'
  );
});

// ---------------------------------------------------------------------------
// Tier 3a — the real product *-to-STAGED move. handleReturnToStage(sliceId)
// is the orchestrator's exported return-to-stage routine; the journey's
// outcome 3 pins the staged/{id}-STAGED.md naming for any route back to
// O'Brien. (The fast-path detection block itself is inline in the watcher
// loop and not exported — it is covered at Tier 1 above.)
// ---------------------------------------------------------------------------

test('J-slice-broken-fast-path slice-070-ac-10 — real handleReturnToStage move lands the slice at staged/{id}-STAGED.md and removes it from queue/', () => {
  const content =
    buildSliceFile({ id: RTS_ID, status: 'QUEUED' }, [`1. ${FIXTURE_AC}`]) +
    buildRomDoneReport(1) +
    buildNogReviewBlock(1, 'REJECT', 'AC 1 not satisfied.') +
    buildRomDoneReport(2) +
    buildRomEscalationBlock(ESCALATION_REASON);
  fs.writeFileSync(path.join(queueDir, `${RTS_ID}-QUEUED.md`), content);

  const res = orch.handleReturnToStage(RTS_ID);
  assert.strictEqual(res.ok, true, `handleReturnToStage must succeed: ${res.error || ''}`);

  const stagedPath = path.join(stagedDir, `${RTS_ID}-STAGED.md`);
  assert.ok(fs.existsSync(stagedPath), 'Slice must land at exactly staged/{id}-STAGED.md (outcome 3 naming)');
  assert.ok(
    !fs.readdirSync(queueDir).some(f => f.startsWith(`${RTS_ID}-`)),
    'No file for the slice may remain in queue/ — one live file per id'
  );
  assert.ok(
    !fs.existsSync(path.join(queueDir, `${RTS_ID}-IN_REVIEW.md`)),
    'Return-to-stage must not create an IN_REVIEW file'
  );
});

test('J-slice-broken-fast-path slice-070-ac-11 — real return-to-stage preserves full history, syncs status to STAGED, and does not consume a round', () => {
  const stagedContent = fs.readFileSync(path.join(stagedDir, `${RTS_ID}-STAGED.md`), 'utf8');

  // O'Brien reads the FULL history (journey step 9 / outcome 6).
  assert.ok(/^## Goal/m.test(stagedContent), 'Original ## Goal section must be preserved');
  assert.ok(/^## Acceptance criteria/m.test(stagedContent), 'Original ## Acceptance criteria section must be preserved');
  assert.ok(/^## Nog Review — Round 1/m.test(stagedContent), 'Prior Nog review round must be preserved');
  assert.ok(hasRomEscalationBlock(stagedContent), 'Escalation block must be preserved');
  assert.ok(stagedContent.includes(ESCALATION_REASON), 'Escalation explanation must be preserved verbatim');

  // slice-format.md: status frontmatter kept in sync with the filename suffix.
  const meta = parseFrontmatter(stagedContent);
  assert.ok(meta, 'Frontmatter must parse after return-to-stage');
  assert.strictEqual(meta.id, RTS_ID, 'Slice id must be unchanged');
  assert.strictEqual(meta.status, 'STAGED', 'status must be synced to STAGED in the staged file');

  // §9 exemption holds through the real move too.
  assert.strictEqual(countNogRounds(stagedContent), 1, 'Round counter must be unchanged by the move');
});
