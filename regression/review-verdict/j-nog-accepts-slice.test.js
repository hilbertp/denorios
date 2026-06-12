'use strict';

/**
 * Journey: J-nog-accepts-slice
 * Category: Review & Verdict
 *
 * What this tests (spec = journey text, not implementation):
 *   Nog reviews a slice in IN_REVIEW state, finds all ACs satisfied, and emits
 *   a PASS verdict with a reason (steps 4-5). The orchestrator appends a
 *   `## Nog Review — Round N` block (step 6), renames the file
 *   IN_REVIEW → ACCEPTED (step 7), and emits NOG_PASS + ACCEPTED +
 *   REVIEW_RECEIVED in sequence, each carrying the slice id and round
 *   (step 8 / outcome 2). The slice file stays append-only: original body and
 *   Rom's DONE report are preserved byte-for-byte above the appended block.
 *
 * Tier 1 contract simulation — orchestrator transitions are simulated with the
 * same primitives the orchestrator uses (fs.renameSync for the suffix move,
 * fs.appendFileSync for blocks/events). All state lives in a tmpdir (#99992).
 *
 * Deliberately NOT asserted here (and why):
 *   - "branch-state.json dev ACCEPTED pool" / "Merge button enabled" outcomes:
 *     pre-slice-316 surface. The current surface is RR/commits-ahead via
 *     /api/branch-state, covered by the gate-merge journey files.
 *   - "Post-Build panel transitions": dashboard UI, not headless.
 *   - Steps 1-5 actor internals (orchestrator spawning Nog via `claude -p`,
 *     Nog's five review phases): live LLM spawn, not headless-testable.
 *   - "next QUEUED slice picked up on next poll": orchestrator polling loop,
 *     owned by the dispatch-execution journeys.
 *
 * Sources: docs/e2e-journeys/J-nog-accepts-slice.md
 *          docs/contracts/slice-pipeline.md §5 (transition + events),
 *            §7 (register schema: ts/event/slice_id, round for NOG_PASS),
 *            §8 (append-only discipline)
 *          docs/contracts/slice-format.md (frontmatter + body sections)
 */

const { test, before, after } = require('node:test');
const assert  = require('node:assert/strict');
const fs      = require('node:fs');
const path    = require('node:path');

const { makeTmpDir, removeTmpDir }  = require('../helpers/tmp-dir');
const { buildSliceFile, buildRomDoneReport, buildNogReviewBlock } = require('../helpers/slice-factory');
const { parseFrontmatter, countNogRounds } = require('../helpers/pipeline-logic');
const { parseRegisterLines, assertEventExists, appendRegisterEvent, initRegisterFile } = require('../helpers/register-helper');

let tmpDir;
let queueDir;
let registerFile;
let preVerdictContent; // slice file bytes before Nog's block — for append-only check

const SLICE_ID = '080';
const ROUND    = 1;

before(() => {
  tmpDir       = makeTmpDir('j-nog-accepts');
  queueDir     = path.join(tmpDir, 'queue');
  registerFile = path.join(tmpDir, 'register.jsonl');
  fs.mkdirSync(queueDir);
  initRegisterFile(registerFile);
});

after(() => removeTmpDir(tmpDir));

// ---------------------------------------------------------------------------
// Helpers — build fixture and simulate the Nog PASS flow
// ---------------------------------------------------------------------------

// Precondition: slice in IN_REVIEW with Rom's DONE report already appended.
function writeInReviewFile(id, round = 1) {
  let content = buildSliceFile({ id, status: 'IN_REVIEW' });
  content += buildRomDoneReport(round);
  const filePath = path.join(queueDir, `${id}-IN_REVIEW.md`);
  fs.writeFileSync(filePath, content);
  return { filePath, content };
}

// Journey steps 6-8 with the orchestrator's own primitives:
//   append `## Nog Review — Round N` PASS block (single-writer file-append) →
//   renameSync -IN_REVIEW.md → -ACCEPTED.md (atomic suffix move) →
//   emit NOG_PASS, ACCEPTED, REVIEW_RECEIVED in sequence, each with
//   slice id + round (journey outcome 2).
function simulateNogPass(id, round, qDir, regFile) {
  const inReviewPath = path.join(qDir, `${id}-IN_REVIEW.md`);
  const passBlock    = buildNogReviewBlock(round, 'PASS', 'All ACs satisfied.');
  fs.appendFileSync(inReviewPath, passBlock);

  const acceptedPath = path.join(qDir, `${id}-ACCEPTED.md`);
  fs.renameSync(inReviewPath, acceptedPath);

  appendRegisterEvent(regFile, { event: 'NOG_PASS',        slice_id: id, round });
  appendRegisterEvent(regFile, { event: 'ACCEPTED',        slice_id: id, round });
  appendRegisterEvent(regFile, { event: 'REVIEW_RECEIVED', slice_id: id, round });

  return acceptedPath;
}

// ---------------------------------------------------------------------------
// Step 2: round derivation — count of prior `## Nog Review — Round N`
// headings is 0 before the first review, so Nog reviews as Round 1.
// ---------------------------------------------------------------------------
test('J-nog-accepts-slice slice-080-ac-12 — IN_REVIEW file with no prior Nog blocks derives Round 1 (countNogRounds = 0)', () => {
  const { content } = writeInReviewFile(SLICE_ID, ROUND);
  preVerdictContent = content;
  assert.equal(countNogRounds(content), 0,
    'No Nog Review headings may exist before the first review — current round derives to 0 + 1 = 1');
});

// ---------------------------------------------------------------------------
// Step 7 + Outcome 3: IN_REVIEW file renamed to ACCEPTED after Nog PASS
// ---------------------------------------------------------------------------
test('J-nog-accepts-slice slice-080-ac-1 — IN_REVIEW renamed to ACCEPTED after Nog PASS verdict', () => {
  const inReviewPath = path.join(queueDir, `${SLICE_ID}-IN_REVIEW.md`);
  const acceptedPath = simulateNogPass(SLICE_ID, ROUND, queueDir, registerFile);

  assert.ok(!fs.existsSync(inReviewPath), '-IN_REVIEW.md must no longer exist after PASS');
  assert.ok(fs.existsSync(acceptedPath),  '-ACCEPTED.md must exist after PASS verdict');
});

// ---------------------------------------------------------------------------
// Step 8 + Outcome 2: register contains NOG_PASS with slice id AND round
// ---------------------------------------------------------------------------
test('J-nog-accepts-slice slice-080-ac-2 — register contains NOG_PASS event with slice id and round', () => {
  const events = parseRegisterLines(registerFile);
  const ev = assertEventExists(events, 'NOG_PASS', SLICE_ID);
  assert.equal(ev.round, ROUND, 'NOG_PASS must carry the round number (journey outcome 2, pipeline §7.2)');
  assert.ok(ev.ts, 'NOG_PASS must carry a ts field (pipeline §7.2 minimum schema)');
});

// ---------------------------------------------------------------------------
// Step 8 + Outcome 2: register contains ACCEPTED with slice id AND round
// ---------------------------------------------------------------------------
test('J-nog-accepts-slice slice-080-ac-3 — register contains ACCEPTED event with slice id and round', () => {
  const events = parseRegisterLines(registerFile);
  const ev = assertEventExists(events, 'ACCEPTED', SLICE_ID);
  assert.equal(ev.round, ROUND, 'ACCEPTED must carry the round number (journey outcome 2)');
});

// ---------------------------------------------------------------------------
// Step 8 + Outcome 2: register contains REVIEW_RECEIVED with slice id AND round
// ---------------------------------------------------------------------------
test('J-nog-accepts-slice slice-080-ac-4 — register contains REVIEW_RECEIVED event with slice id and round', () => {
  const events = parseRegisterLines(registerFile);
  const ev = assertEventExists(events, 'REVIEW_RECEIVED', SLICE_ID);
  assert.equal(ev.round, ROUND, 'REVIEW_RECEIVED must carry the round number (journey outcome 2)');
});

// ---------------------------------------------------------------------------
// Step 8: the three events are emitted in sequence —
// NOG_PASS, then ACCEPTED, then REVIEW_RECEIVED
// ---------------------------------------------------------------------------
test('J-nog-accepts-slice slice-080-ac-10 — NOG_PASS, ACCEPTED, REVIEW_RECEIVED emitted in that order', () => {
  const events = parseRegisterLines(registerFile);
  const idx = name => events.findIndex(e => e.event === name && String(e.slice_id) === SLICE_ID);
  const iPass = idx('NOG_PASS'), iAcc = idx('ACCEPTED'), iRecv = idx('REVIEW_RECEIVED');

  assert.ok(iPass !== -1 && iAcc !== -1 && iRecv !== -1, 'all three events must exist');
  assert.ok(iPass < iAcc,  `NOG_PASS (line ${iPass}) must precede ACCEPTED (line ${iAcc}) — journey step 8 sequence`);
  assert.ok(iAcc < iRecv,  `ACCEPTED (line ${iAcc}) must precede REVIEW_RECEIVED (line ${iRecv}) — journey step 8 sequence`);
});

// ---------------------------------------------------------------------------
// Step 6 + Outcome 1: accepted file contains the round-numbered Nog Review
// block recording the PASS verdict and a reason
// ---------------------------------------------------------------------------
test('J-nog-accepts-slice slice-080-ac-5 — accepted file contains Nog Review — Round 1 block with PASS verdict and reason', () => {
  const acceptedPath = path.join(queueDir, `${SLICE_ID}-ACCEPTED.md`);
  const content      = fs.readFileSync(acceptedPath, 'utf8');

  assert.ok(/^## Nog Review — Round 1$/m.test(content),
    'Accepted file must contain a `## Nog Review — Round 1` block (slice-format Nog block heading)');
  assert.ok(/\*\*Verdict:\*\* PASS/.test(content),
    'Nog Review block must record the PASS verdict (journey outcome 1)');
  assert.ok(/\*\*Reason:\*\* \S/.test(content),
    'Nog Review block must record a non-empty reason (journey step 5 / outcome 1)');
});

// ---------------------------------------------------------------------------
// Round-counter contract: countNogRounds = 1 after the first review
// ---------------------------------------------------------------------------
test('J-nog-accepts-slice slice-080-ac-6 — countNogRounds returns 1 after first Nog review', () => {
  const acceptedPath = path.join(queueDir, `${SLICE_ID}-ACCEPTED.md`);
  const content      = fs.readFileSync(acceptedPath, 'utf8');
  assert.equal(countNogRounds(content), 1, 'Round count must be 1 after one Nog review');
});

// ---------------------------------------------------------------------------
// Append-only (pipeline §8 + journey preconditions): every byte that was in
// the file before the verdict — frontmatter, O'Brien's body, Rom's DONE
// report — is preserved unchanged above Nog's appended block
// ---------------------------------------------------------------------------
test('J-nog-accepts-slice slice-080-ac-7 — accepted file preserves original body and Rom DONE Report byte-for-byte', () => {
  const acceptedPath = path.join(queueDir, `${SLICE_ID}-ACCEPTED.md`);
  const content      = fs.readFileSync(acceptedPath, 'utf8');

  assert.ok(content.startsWith(preVerdictContent),
    'All pre-verdict bytes (slice body + Rom DONE report) must be preserved unchanged above the Nog block (pipeline §8)');
  assert.ok(/^## Goal$/m.test(content),                'Original ## Goal section must be preserved');
  assert.ok(/^## Acceptance criteria$/m.test(content), 'Original ## Acceptance criteria section must be preserved');
  assert.ok(/^## Rom DONE Report — Round 1$/m.test(content), 'Rom DONE Report must be preserved');
});

// ---------------------------------------------------------------------------
// Frontmatter remains parseable after the suffix move (rename must not
// corrupt content); id still matches the slice
// ---------------------------------------------------------------------------
test('J-nog-accepts-slice slice-080-ac-11 — accepted file frontmatter still parseable with matching id', () => {
  const acceptedPath = path.join(queueDir, `${SLICE_ID}-ACCEPTED.md`);
  const meta = parseFrontmatter(fs.readFileSync(acceptedPath, 'utf8'));

  assert.ok(meta, 'Frontmatter must still parse after IN_REVIEW → ACCEPTED rename');
  assert.equal(meta.id, SLICE_ID, 'Frontmatter id must still match the slice id');
  for (const field of ['title', 'goal', 'from', 'to', 'priority', 'created', 'status']) {
    assert.ok(meta[field], `Required frontmatter field "${field}" must survive the transition`);
  }
});

// ---------------------------------------------------------------------------
// Round-counter contract: multiple round blocks counted correctly
// (Round 2+ derivation per journey step 2)
// ---------------------------------------------------------------------------
test('J-nog-accepts-slice slice-081-ac-8 — countNogRounds counts multiple Nog Review headings correctly', () => {
  let content = buildSliceFile({ id: '081' });
  content += buildRomDoneReport(1);
  content += buildNogReviewBlock(1, 'REJECT', 'AC #1 not met.');
  content += buildRomDoneReport(2);
  content += buildNogReviewBlock(2, 'PASS',   'AC #1 now satisfied.');
  assert.equal(countNogRounds(content), 2, 'Two Nog Review blocks must yield count of 2 — next review derives Round 3');
});

// ---------------------------------------------------------------------------
// Slice-format contract: the Nog Review heading carries the round number
// ---------------------------------------------------------------------------
test('J-nog-accepts-slice slice-080-ac-9 — Nog Review block heading carries the round number', () => {
  const block = buildNogReviewBlock(3, 'PASS', 'Satisfied.');
  assert.ok(/^## Nog Review — Round 3$/m.test(block), 'Heading must carry the round number 3');
});
