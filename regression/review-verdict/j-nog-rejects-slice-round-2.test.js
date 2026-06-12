'use strict';

/**
 * Journey: J-nog-rejects-slice-round-2
 * Category: Review & Verdict
 *
 * What this tests (spec source: docs/e2e-journeys/J-nog-rejects-slice-round-2.md):
 *   Nog finds an unsatisfied AC, appends a `## Nog Review — Round 1` REJECT
 *   block, and the orchestrator renames the slice IN_REVIEW → QUEUED (same id,
 *   same queue dir) emitting REVIEWED + REVIEW_RECEIVED.  The round counter —
 *   derived by counting `## Nog Review — Round N` headings — is now 1, so the
 *   next Nog invocation is Round 2.  Rom picks the slice up again, appends a
 *   `## Rom DONE Report — Round 2` block AFTER the rejection block, and the
 *   cycle advances to IN_REVIEW again.  Throughout, the slice file is
 *   append-only: nothing deleted, nothing rewritten, the original body and
 *   every prior block survive, and the slice keeps its original id — which is
 *   what anchors Rom to the same slice/{id}-<slug> branch across rounds.
 *
 * Contract sources:
 *   docs/contracts/slice-pipeline.md  §5 (IN_REVIEW→QUEUED reject mechanics),
 *                                     §8 (append-only loop file structure),
 *                                     §9 (round counter derivation, cap 5),
 *                                     §10.1 (no new slice ID across rounds)
 *   docs/contracts/slice-lifecycle.md — rejection flow, invariants #1, #5, #7
 *
 * NOT covered here (out of headless scope per journey plan): Rom actually
 * committing fixes on the git branch; dashboard loopback visualization.
 */

const { test, before, after } = require('node:test');
const assert  = require('node:assert/strict');
const fs      = require('node:fs');
const path    = require('node:path');

const { makeTmpDir, removeTmpDir }  = require('../helpers/tmp-dir');
const { buildSliceFile, buildRomDoneReport, buildNogReviewBlock } = require('../helpers/slice-factory');
const { parseFrontmatter, countNogRounds, MAX_ROUNDS } = require('../helpers/pipeline-logic');
const { parseRegisterLines, assertEventExists, appendRegisterEvent, initRegisterFile } = require('../helpers/register-helper');

let tmpDir;
let queueDir;
let registerFile;
const SLICE_ID    = '090';
const SLICE_TITLE = 'Regression fixture slice';

// Byte-level snapshots captured as the flow advances — used by the final
// append-only test to prove no stage rewrote or truncated prior content.
const snapshots = [];

before(() => {
  tmpDir       = makeTmpDir('j-nog-rejects');
  queueDir     = path.join(tmpDir, 'queue');
  registerFile = path.join(tmpDir, 'register.jsonl');
  fs.mkdirSync(queueDir);
  initRegisterFile(registerFile);
});

after(() => removeTmpDir(tmpDir));

// ---------------------------------------------------------------------------
// Helpers — simulate the IN_REVIEW → QUEUED rejection flow with the same
// primitives the orchestrator uses (fs.renameSync / fs.appendFileSync).
// ---------------------------------------------------------------------------

// Journey step 9: Rom reworks "on the same slice/{id}-<slug> branch".  The
// branch name is a pure function of the slice id + title, so deriving it from
// frontmatter before and after the rejection pins the same-branch invariant
// at the contract level (the id never changes ⇒ the branch never changes).
function deriveBranchName(meta) {
  const slug = String(meta.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `slice/${meta.id}-${slug}`;
}

function listSliceFiles() {
  return fs.readdirSync(queueDir).filter(f => f.endsWith('.md')).sort();
}

function writeInReviewFile(id, round = 1) {
  let content = buildSliceFile({ id, title: SLICE_TITLE, status: 'IN_REVIEW' });
  content += buildRomDoneReport(round);
  const filePath = path.join(queueDir, `${id}-IN_REVIEW.md`);
  fs.writeFileSync(filePath, content);
  return { filePath, content };
}

// Mirrors slice-pipeline.md §5 "IN_REVIEW → QUEUED (reject, rework)":
//   Nog appends rejection block → watcher writes -QUEUED.md →
//   emits REVIEWED + REVIEW_RECEIVED.  Round counter derives from the file.
function simulateNogReject(id, round, qDir, regFile) {
  const inReviewPath = path.join(qDir, `${id}-IN_REVIEW.md`);
  const rejectBlock  = buildNogReviewBlock(round, 'REJECT', 'AC #1 not met — widget does not render.');
  fs.appendFileSync(inReviewPath, rejectBlock);

  const queuedPath = path.join(qDir, `${id}-QUEUED.md`);
  fs.renameSync(inReviewPath, queuedPath);

  appendRegisterEvent(regFile, { event: 'REVIEWED',        slice_id: id, round });
  appendRegisterEvent(regFile, { event: 'REVIEW_RECEIVED', slice_id: id, round });

  return queuedPath;
}

// ---------------------------------------------------------------------------
// Journey steps 4–5 + outcome 1: REJECT appends the Round-1 block and the
// file renames IN_REVIEW → QUEUED — same id, same queue dir.
// ---------------------------------------------------------------------------
test('J-nog-rejects-slice-round-2 slice-090-ac-1 — REJECT appends Round-1 block and renames IN_REVIEW to QUEUED with same id in same queue dir', () => {
  const { filePath: inReviewPath, content: initialContent } = writeInReviewFile(SLICE_ID, 1);
  snapshots.push(initialContent);

  // Journey precondition: the round counter is below the cap before this rejection.
  assert.ok(countNogRounds(initialContent) < MAX_ROUNDS,
    'Precondition: fewer than MAX_ROUNDS prior Nog rejection blocks');
  assert.strictEqual(countNogRounds(initialContent), 0,
    'Precondition: no Nog Review blocks before the first rejection');

  const queuedPath = simulateNogReject(SLICE_ID, 1, queueDir, registerFile);

  assert.ok(!fs.existsSync(inReviewPath), '-IN_REVIEW.md must no longer exist after rejection');
  assert.ok(fs.existsSync(queuedPath),    '-QUEUED.md must exist so Rom can rework the slice');
  assert.strictEqual(path.dirname(queuedPath), queueDir,
    'Rejected slice must return to the same queue dir (not staged/, not trash/)');
  assert.strictEqual(path.basename(queuedPath), `${SLICE_ID}-QUEUED.md`,
    'Rejected slice must keep its original id in the filename');

  snapshots.push(fs.readFileSync(queuedPath, 'utf8'));
});

// ---------------------------------------------------------------------------
// Journey step 4: the appended block is `## Nog Review — Round 1` carrying a
// REJECT verdict (slice-format.md block format).
// ---------------------------------------------------------------------------
test('J-nog-rejects-slice-round-2 slice-090-ac-2 — rejected file contains "## Nog Review — Round 1" block with REJECT verdict', () => {
  const queuedPath = path.join(queueDir, `${SLICE_ID}-QUEUED.md`);
  const content    = fs.readFileSync(queuedPath, 'utf8');
  assert.ok(/^## Nog Review — Round 1$/m.test(content),
    'Rejected file must contain the Round-1 Nog Review heading exactly (round counter derives from it)');
  assert.ok(/^\*\*Verdict:\*\* REJECT$/m.test(content),
    'Nog Review block must record the REJECT verdict');
});

// ---------------------------------------------------------------------------
// Journey step 6 + outcome 3: register gains REVIEWED + REVIEW_RECEIVED for
// the rejection, each carrying the round.
// ---------------------------------------------------------------------------
test('J-nog-rejects-slice-round-2 slice-090-ac-3 — register gains REVIEWED and REVIEW_RECEIVED events for the rejection', () => {
  const events   = parseRegisterLines(registerFile);
  const reviewed = assertEventExists(events, 'REVIEWED', SLICE_ID);
  const received = assertEventExists(events, 'REVIEW_RECEIVED', SLICE_ID);
  assert.strictEqual(reviewed.round, 1, 'REVIEWED event must carry round 1');
  assert.strictEqual(received.round, 1, 'REVIEW_RECEIVED event must carry round 1');
});

// ---------------------------------------------------------------------------
// Journey outcome 2: the round counter (count of `## Nog Review` headings) is
// 1 after the first rejection, so the next Nog invocation is Round 2 — still
// below the 5-round cap (slice-pipeline.md §9).
// ---------------------------------------------------------------------------
test('J-nog-rejects-slice-round-2 slice-090-ac-4 — countNogRounds is 1 after first rejection so next invocation is Round 2, below MAX_ROUNDS cap', () => {
  const queuedPath = path.join(queueDir, `${SLICE_ID}-QUEUED.md`);
  const content    = fs.readFileSync(queuedPath, 'utf8');
  const rounds     = countNogRounds(content);
  assert.strictEqual(rounds, 1, 'Round counter must be 1 after first Nog rejection');
  assert.strictEqual(rounds + 1, 2, 'Next Nog invocation must be Round 2');
  assert.ok(rounds + 1 <= MAX_ROUNDS, 'Round 2 must be within the 5-round cap — no escalation yet');
});

// ---------------------------------------------------------------------------
// Same-id / same-branch invariant (slice-pipeline.md §10.1 "No new slice ID";
// journey step 9 "same slice/{id}-<slug> branch"; lifecycle invariant #1
// "one file per slice").  The rejection loop must not mint a new id — and
// since the branch name is derived from the id, an unchanged id is what keeps
// Rom's Round-2 commits on the same branch as Round 1.
// ---------------------------------------------------------------------------
test('J-nog-rejects-slice-round-2 slice-090-ac-5 — rejection mints no new slice id: one file, frontmatter id unchanged, same derived slice branch', () => {
  const files = listSliceFiles();
  assert.deepStrictEqual(files, [`${SLICE_ID}-QUEUED.md`],
    'Queue must contain exactly one file for the slice — no new id, no leftover copy');

  const content = fs.readFileSync(path.join(queueDir, files[0]), 'utf8');
  const meta    = parseFrontmatter(content);
  assert.ok(meta, 'Frontmatter must remain parseable after the rejection append');
  assert.strictEqual(meta.id, SLICE_ID, 'Frontmatter id must be unchanged through the rejection');

  // Branch identity: derive slice/{id}-<slug> from the original fixture and
  // from the post-rejection file — they must be the same branch.
  const originalMeta = parseFrontmatter(buildSliceFile({ id: SLICE_ID, title: SLICE_TITLE, status: 'IN_REVIEW' }));
  assert.strictEqual(deriveBranchName(meta), deriveBranchName(originalMeta),
    'Derived slice/{id}-<slug> branch must be identical before and after rejection — Rom reworks on the SAME branch');
});

// ---------------------------------------------------------------------------
// Journey steps 7–10 + outcome 1 ordering: orchestrator re-picks the QUEUED
// slice (QUEUED → IN_PROGRESS), Rom appends `## Rom DONE Report — Round 2`
// AFTER the Round-1 rejection block, and the watcher renames to DONE emitting
// the DONE event.
// ---------------------------------------------------------------------------
test('J-nog-rejects-slice-round-2 slice-090-ac-6 — Round-2 DONE Report appends AFTER the Round-1 rejection block; DONE event emitted for Round 2', () => {
  const queuedPath = path.join(queueDir, `${SLICE_ID}-QUEUED.md`);

  // Step 7: orchestrator's next poll cycle picks up the QUEUED slice again.
  const inProgressPath = path.join(queueDir, `${SLICE_ID}-IN_PROGRESS.md`);
  fs.renameSync(queuedPath, inProgressPath);

  // Steps 8–10: Rom reads the full file (with all prior blocks) and appends
  // his Round-2 DONE report at the bottom.
  fs.appendFileSync(inProgressPath, buildRomDoneReport(2));

  // Step 11 (first half): watcher detects DONE → renames, emits DONE.
  const donePath = path.join(queueDir, `${SLICE_ID}-DONE.md`);
  fs.renameSync(inProgressPath, donePath);
  appendRegisterEvent(registerFile, { event: 'DONE', slice_id: SLICE_ID, round: 2 });

  const content = fs.readFileSync(donePath, 'utf8');
  const rejectIdx = content.indexOf('## Nog Review — Round 1');
  const done2Idx  = content.indexOf('## Rom DONE Report — Round 2');
  assert.ok(rejectIdx !== -1, 'Round-1 rejection block must still be present');
  assert.ok(done2Idx  !== -1, 'Round-2 DONE Report must be appended');
  assert.ok(done2Idx > rejectIdx,
    'Round-2 DONE Report must appear AFTER the Round-1 rejection block (append order)');

  const events = parseRegisterLines(registerFile);
  const done   = assertEventExists(events, 'DONE', SLICE_ID);
  assert.strictEqual(done.round, 2, 'DONE event must carry round 2');

  snapshots.push(content);
});

// ---------------------------------------------------------------------------
// Journey outcome 3 ordering: REVIEWED + REVIEW_RECEIVED for the rejection,
// THEN the DONE for Rom's Round 2 — the register tells the rework story in
// order (lifecycle invariant #6: history auditable from the filesystem).
// ---------------------------------------------------------------------------
test('J-nog-rejects-slice-round-2 slice-090-ac-7 — register order is REVIEWED, REVIEW_RECEIVED, then Round-2 DONE', () => {
  const events = parseRegisterLines(registerFile).filter(e => String(e.slice_id) === SLICE_ID);
  const names  = events.map(e => e.event);
  const reviewedIdx = names.indexOf('REVIEWED');
  const receivedIdx = names.indexOf('REVIEW_RECEIVED');
  const doneIdx     = names.indexOf('DONE');
  assert.ok(reviewedIdx !== -1 && receivedIdx !== -1 && doneIdx !== -1,
    `Expected REVIEWED, REVIEW_RECEIVED and DONE in register — got [${names.join(', ')}]`);
  assert.ok(reviewedIdx < doneIdx,  'REVIEWED (rejection) must precede the Round-2 DONE');
  assert.ok(receivedIdx < doneIdx,  'REVIEW_RECEIVED (rejection) must precede the Round-2 DONE');
});

// ---------------------------------------------------------------------------
// Journey step 11 (second half) + outcome 2: DONE advances to IN_REVIEW
// again; the round counter still reads 1 until Nog writes his Round-2 block.
// ---------------------------------------------------------------------------
test('J-nog-rejects-slice-round-2 slice-090-ac-8 — DONE advances to IN_REVIEW again and round counter stays 1 until Nog reviews Round 2', () => {
  const donePath      = path.join(queueDir, `${SLICE_ID}-DONE.md`);
  const inReview2Path = path.join(queueDir, `${SLICE_ID}-IN_REVIEW.md`);
  fs.renameSync(donePath, inReview2Path);

  const content = fs.readFileSync(inReview2Path, 'utf8');
  assert.strictEqual(countNogRounds(content), 1,
    'Round counter must still be 1 before Nog reviews Round 2 — only Nog headings count, not DONE reports');
  assert.ok(/^## Rom DONE Report — Round 2$/m.test(content),
    'Round-2 DONE Report must be present in the IN_REVIEW file Nog will read');
});

// ---------------------------------------------------------------------------
// Cycle close: after a Round-2 Nog PASS the counter reads 2 and the full
// history is present in strict append order — original body, Round-1 DONE,
// Round-1 REJECT, Round-2 DONE, Round-2 PASS (slice-pipeline.md §8 structure).
// ---------------------------------------------------------------------------
test('J-nog-rejects-slice-round-2 slice-090-ac-9 — after Round-2 PASS the counter reads 2 and all blocks sit in strict append order', () => {
  const inReview2Path = path.join(queueDir, `${SLICE_ID}-IN_REVIEW.md`);
  fs.appendFileSync(inReview2Path, buildNogReviewBlock(2, 'PASS', 'AC #1 now satisfied.'));

  const accepted2Path = path.join(queueDir, `${SLICE_ID}-ACCEPTED.md`);
  fs.renameSync(inReview2Path, accepted2Path);

  const content = fs.readFileSync(accepted2Path, 'utf8');
  assert.strictEqual(countNogRounds(content), 2,
    'Round counter must be 2 after two Nog reviews (1 REJECT + 1 PASS)');

  const order = [
    '## Goal',
    '## Rom DONE Report — Round 1',
    '## Nog Review — Round 1',
    '## Rom DONE Report — Round 2',
    '## Nog Review — Round 2',
  ].map(h => ({ h, idx: content.indexOf(h) }));

  for (const { h, idx } of order) {
    assert.ok(idx !== -1, `Block "${h}" must be present in the final file`);
  }
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i - 1].idx < order[i].idx,
      `"${order[i - 1].h}" must appear before "${order[i].h}" (append order)`);
  }

  snapshots.push(content);
});

// ---------------------------------------------------------------------------
// Journey outcome: "No files are deleted or rewritten; the slice file is
// append-only throughout all rounds."  Every later snapshot must start with
// the previous one byte-for-byte, the original body sections must survive,
// and frontmatter must still parse with the original id.
// ---------------------------------------------------------------------------
test('J-nog-rejects-slice-round-2 slice-090-ac-10 — append-only through all rounds: every stage strictly extends the prior bytes and the original body survives', () => {
  assert.ok(snapshots.length >= 4, 'Flow must have captured snapshots at each stage');
  for (let i = 1; i < snapshots.length; i++) {
    assert.ok(snapshots[i].startsWith(snapshots[i - 1]),
      `Stage ${i} content must start with stage ${i - 1} content byte-for-byte — nothing rewritten or deleted`);
  }

  const finalContent = snapshots[snapshots.length - 1];
  assert.ok(/^## Goal$/m.test(finalContent),                'Original ## Goal section must survive all rounds');
  assert.ok(/^## Acceptance criteria$/m.test(finalContent), 'Original ## Acceptance criteria section must survive all rounds');
  assert.ok(/^## Rom DONE Report — Round 1$/m.test(finalContent), 'Round-1 DONE report must survive all rounds');
  assert.ok(/^\*\*Verdict:\*\* REJECT$/m.test(finalContent), 'Round-1 REJECT verdict must survive as audit trail');

  const meta = parseFrontmatter(finalContent);
  assert.ok(meta, 'Frontmatter must still be parseable after all rounds');
  assert.strictEqual(meta.id, SLICE_ID, 'Slice id must be unchanged after the full rework cycle');
});
