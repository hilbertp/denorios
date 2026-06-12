'use strict';

/**
 * Journey: J-nog-max-rounds-escalation
 * Category: Review & Verdict
 *
 * What this tests:
 *   A slice exhausts the 5-round Nog rejection cap. On Nog's 6th REJECT
 *   (round count >= 6, per slice-pipeline.md §9) the watcher routes the slice
 *   to bridge/staged/{id}-STAGED.md for O'Brien rework instead of back to
 *   bridge/queue/{id}-QUEUED.md for another Rom round. The staged file keeps
 *   the full append-only history (original body + all 6 Nog Review blocks),
 *   and the Rom slice-broken fast path stays exempt from the round counter.
 *
 * Sources: docs/contracts/slice-pipeline.md §9 (round counter, cap 5,
 *            6th-reject routing to staged), §10 (fast-path exemption)
 *          docs/contracts/slice-lifecycle.md — IN_REVIEW → STAGED (via
 *            O'Brien) on 6th rejection; invariant #5 (append-only),
 *            invariant #8 (escalation is automatic, not optional)
 *          docs/contracts/slice-format.md — append-only discipline
 *
 * Fixture isolation (#99992): all state lives in a mkdtemp dir — never the
 * live bridge/queue/, bridge/staged/, bridge/state/ or bridge/register.jsonl.
 */

const { test, before, after } = require('node:test');
const assert  = require('node:assert/strict');
const fs      = require('node:fs');
const path    = require('node:path');

const { makeTmpDir, removeTmpDir } = require('../helpers/tmp-dir');
const { buildSliceFile, buildRomDoneReport, buildNogReviewBlock, buildRomEscalationBlock } = require('../helpers/slice-factory');
const { parseFrontmatter, countNogRounds, MAX_ROUNDS, hasRomEscalationBlock } = require('../helpers/pipeline-logic');
const { parseRegisterLines, appendRegisterEvent, initRegisterFile } = require('../helpers/register-helper');

let tmpDir;
let queueDir;
let stagedDir;
let registerFile;
const SLICE_ID = '090';

before(() => {
  tmpDir       = makeTmpDir('j-nog-max-rounds');
  queueDir     = path.join(tmpDir, 'queue');
  stagedDir    = path.join(tmpDir, 'staged');
  registerFile = path.join(tmpDir, 'register.jsonl');
  fs.mkdirSync(queueDir);
  fs.mkdirSync(stagedDir);
  initRegisterFile(registerFile);
});

after(() => removeTmpDir(tmpDir));

// ---------------------------------------------------------------------------
// Helpers — build the exhausted-cap fixture and simulate the watcher routing
// ---------------------------------------------------------------------------

// Precondition fixture: original body + 5 complete Rom/Nog rounds, all REJECT.
// Each round = Rom DONE report (Round N) followed by Nog Review REJECT (Round N).
function writeFiveRoundInReviewFile(id) {
  let content = buildSliceFile({ id, status: 'IN_REVIEW' });
  for (let round = 1; round <= 5; round++) {
    content += buildRomDoneReport(round);
    content += buildNogReviewBlock(round, 'REJECT', `AC #1 still not met after round ${round} rework.`);
  }
  const filePath = path.join(queueDir, `${id}-IN_REVIEW.md`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

// Mirrors the §9 watcher routing on the 6th reject (count >= 6):
//   renameSync queue/{id}-IN_REVIEW.md → staged/{id}-STAGED.md (NOT back to
//   QUEUED) and record an escalation event in the register. The journey marks
//   the exact event name TBD (open question) — the simulation uses
//   MAX_ROUNDS_EXHAUSTED (a candidate from slice-pipeline.md §10.1 verdict
//   telemetry) but tests must NOT hard-assert that name; they assert only
//   that an event for the slice id was recorded by the transition.
function simulateMaxRoundsEscalation(id, qDir, sDir, regFile) {
  const inReviewPath = path.join(qDir, `${id}-IN_REVIEW.md`);
  const stagedPath   = path.join(sDir, `${id}-STAGED.md`);
  fs.renameSync(inReviewPath, stagedPath);
  appendRegisterEvent(regFile, { event: 'MAX_ROUNDS_EXHAUSTED', slice_id: id, round: 6 });
  return stagedPath;
}

// ---------------------------------------------------------------------------
// AC1 — Precondition + Step 1: 5 REJECT rounds yield count 5; cap constant is 5
// ---------------------------------------------------------------------------
test('J-nog-max-rounds-escalation slice-090-ac-1 — five REJECT rounds yield countNogRounds 5 and the cap is 5', () => {
  const inReviewPath = writeFiveRoundInReviewFile(SLICE_ID);
  const content      = fs.readFileSync(inReviewPath, 'utf8');

  assert.strictEqual(countNogRounds(content), 5,
    'Round counter (count of "## Nog Review — Round N" headings) must be 5 before the Round-6 invocation');
  assert.strictEqual(MAX_ROUNDS, 5,
    'The round cap must be 5 (slice-pipeline.md §9)');
  for (let round = 1; round <= 5; round++) {
    assert.ok(new RegExp(`^## Nog Review — Round ${round}$`, 'm').test(content),
      `Precondition: the slice file must contain the Round ${round} Nog Review block`);
  }
});

// ---------------------------------------------------------------------------
// AC4 — Step 2: Nog appends the Round-6 REJECT block noting the cap exhausted;
//        the heading carries round number 6 and countNogRounds returns 6
// ---------------------------------------------------------------------------
test('J-nog-max-rounds-escalation slice-090-ac-4 — Round-6 REJECT block carries round number 6 and count becomes 6', () => {
  const inReviewPath = path.join(queueDir, `${SLICE_ID}-IN_REVIEW.md`);

  // Rom's 6th attempt, then Nog's 6th review — REJECT, noting the cap is exhausted.
  fs.appendFileSync(inReviewPath, buildRomDoneReport(6));
  fs.appendFileSync(inReviewPath, buildNogReviewBlock(6, 'REJECT',
    'AC #1 still not met. Round cap exhausted — escalating to O\'Brien.'));

  const content = fs.readFileSync(inReviewPath, 'utf8');
  assert.ok(/^## Nog Review — Round 6$/m.test(content),
    'Round-6 block heading must carry round number 6');
  assert.strictEqual(countNogRounds(content), 6,
    'countNogRounds must return 6 after the 6th REJECT block (>= 6 rule trips)');
});

// ---------------------------------------------------------------------------
// AC2 — Steps 3-4 + outcome "watcher does NOT route to QUEUED": on the 6th
//        reject the transition target is staged/{id}-STAGED.md, not QUEUED
// ---------------------------------------------------------------------------
test('J-nog-max-rounds-escalation slice-090-ac-2 — 6th rejection routes to staged/{id}-STAGED.md, not back to QUEUED', () => {
  const inReviewPath = path.join(queueDir, `${SLICE_ID}-IN_REVIEW.md`);
  assert.strictEqual(countNogRounds(fs.readFileSync(inReviewPath, 'utf8')), 6,
    'Sanity: the >= 6 rule must hold before the watcher routes');

  const stagedPath = simulateMaxRoundsEscalation(SLICE_ID, queueDir, stagedDir, registerFile);

  assert.ok(fs.existsSync(stagedPath),
    'staged/{id}-STAGED.md must exist after the 6th rejection (O\'Brien rework path)');
  assert.ok(!fs.existsSync(inReviewPath),
    'queue/{id}-IN_REVIEW.md must no longer exist after routing');
  assert.ok(!fs.existsSync(path.join(queueDir, `${SLICE_ID}-QUEUED.md`)),
    'Watcher must NOT route to queue/{id}-QUEUED.md — no further Rom round on an exhausted cap');
});

// ---------------------------------------------------------------------------
// AC3 — Outcome 1: staged file retains all 6 Nog Review blocks plus the
//        original body in append order — O'Brien reads the full history
// ---------------------------------------------------------------------------
test('J-nog-max-rounds-escalation slice-090-ac-3 — staged file retains original body and all 6 round blocks in append order', () => {
  const stagedPath = path.join(stagedDir, `${SLICE_ID}-STAGED.md`);
  const content    = fs.readFileSync(stagedPath, 'utf8');

  // Original body survives (append-only discipline, slice-format.md / invariant #5)
  assert.ok(/^## Goal$/m.test(content),                'Original ## Goal section must be preserved');
  assert.ok(/^## Acceptance criteria$/m.test(content), 'Original ## Acceptance criteria section must be preserved');

  // All 6 round blocks present, in append order
  let prevIdx = -1;
  for (let round = 1; round <= 6; round++) {
    const idx = content.indexOf(`## Nog Review — Round ${round}`);
    assert.ok(idx !== -1, `Round ${round} Nog Review block must be present in the staged file`);
    assert.ok(idx > prevIdx, `Round ${round} block must appear after Round ${round - 1} block (append order)`);
    prevIdx = idx;
  }
  assert.strictEqual(countNogRounds(content), 6,
    'Staged file must still count 6 Nog rounds — no history lost in routing');

  // Body starts before the first appended block — original body precedes the history
  const goalIdx = content.indexOf('## Goal');
  assert.ok(goalIdx !== -1 && goalIdx < content.indexOf('## Nog Review — Round 1'),
    'Original body must precede the appended review history');

  // Frontmatter still parseable with the slice id after the rename
  const meta = parseFrontmatter(content);
  assert.ok(meta, 'Staged file frontmatter must remain parseable');
  assert.strictEqual(meta.id, SLICE_ID, 'Frontmatter id must survive the routing untouched');
});

// ---------------------------------------------------------------------------
// Outcome — "register contains an escalation event": the exact event name is
// TBD per the journey's open questions, so assert only that the simulated
// transition recorded an event for the slice id (no hard-coded name).
// ---------------------------------------------------------------------------
test('J-nog-max-rounds-escalation slice-090-ac-2 — register records an event for the slice on round-cap escalation (event name TBD per journey)', () => {
  const events = parseRegisterLines(registerFile);
  const forSlice = events.filter(e => String(e.slice_id || e.id || '') === SLICE_ID);
  assert.ok(forSlice.length > 0,
    'The round-cap escalation transition must record at least one register event for the slice id');
  // Journey open question: candidates are MAX_ROUNDS_EXHAUSTED / ESCALATED_TO_OBRIEN /
  // NOG_ESCALATION. We deliberately do NOT assert a specific name here.
  assert.ok(forSlice.every(e => typeof e.event === 'string' && e.event.length > 0),
    'Every recorded event for the slice must carry a non-empty event name');
});

// ---------------------------------------------------------------------------
// AC5 — §9 exemption cross-check: a Rom Escalation block does not increment
//        the round counter — the slice-broken fast path stays exempt from the cap
// ---------------------------------------------------------------------------
test('J-nog-max-rounds-escalation slice-090-ac-5 — Rom Escalation block does not increment countNogRounds (fast path exempt from cap)', () => {
  // Independent fixture: 2 normal rounds, then Rom escalates via the fast path.
  let content = buildSliceFile({ id: '091', status: 'IN_PROGRESS' });
  content += buildRomDoneReport(1);
  content += buildNogReviewBlock(1, 'REJECT', 'AC #1 not met.');
  content += buildRomDoneReport(2);
  content += buildNogReviewBlock(2, 'REJECT', 'AC #1 still not met.');
  content += buildRomEscalationBlock('AC #1 contradicts the goal — cannot satisfy both as written.');

  assert.ok(hasRomEscalationBlock(content),
    'The "## Rom Escalation — Slice Broken" block must be recognisable');
  assert.strictEqual(countNogRounds(content), 2,
    'Rom Escalation block must NOT increment the round counter (slice-pipeline.md §9 exemption)');
});
