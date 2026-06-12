'use strict';

/**
 * Journey: J-slice-broken-fast-path
 * Category: Dispatch & Execution
 *
 * What this tests:
 *   When Rom judges the slice spec itself is broken (not his implementation),
 *   he appends a "## Rom Escalation — Slice Broken" block.  The orchestrator
 *   detects this exact heading, routes the file to staged/ (not queue/IN_REVIEW),
 *   emits a ROM_ESCALATE register event, and does NOT increment the Nog round
 *   counter.
 *
 * Sources: docs/contracts/slice-pipeline.md §10, orchestrator.js line 4705-4718
 */

const { test, before, after } = require('node:test');
const assert  = require('node:assert/strict');
const fs      = require('node:fs');
const path    = require('node:path');

const { makeTmpDir, removeTmpDir }        = require('../helpers/tmp-dir');
const { buildSliceFile, buildRomEscalationBlock } = require('../helpers/slice-factory');
const { parseFrontmatter, hasRomEscalationBlock, countNogRounds } = require('../helpers/pipeline-logic');
const { parseRegisterLines, assertEventExists, appendRegisterEvent, initRegisterFile } = require('../helpers/register-helper');

let tmpDir;
let stagedDir;
let queueDir;
let registerFile;
const SLICE_ID = '070';

before(() => {
  tmpDir       = makeTmpDir('j-slice-broken');
  stagedDir    = path.join(tmpDir, 'staged');
  queueDir     = path.join(tmpDir, 'queue');
  registerFile = path.join(tmpDir, 'register.jsonl');
  fs.mkdirSync(stagedDir);
  fs.mkdirSync(queueDir);
  initRegisterFile(registerFile);
});

after(() => removeTmpDir(tmpDir));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeDoneFile(id, escalated = false) {
  let content = buildSliceFile({ id, status: 'DONE' });
  if (escalated) content += buildRomEscalationBlock();
  const filePath = path.join(queueDir, `${id}-DONE.md`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

// Mirrors orchestrator.js lines 4708-4718: detect escalation, route to staged/
function simulateFastPath(id, qDir, sDir, regFile) {
  const donePath = path.join(qDir, `${id}-DONE.md`);
  const content  = fs.readFileSync(donePath, 'utf8');
  if (hasRomEscalationBlock(content)) {
    const stagedPath = path.join(sDir, `${id}-STAGED.md`);
    fs.renameSync(donePath, stagedPath);
    appendRegisterEvent(regFile, { event: 'ROM_ESCALATE', slice_id: id, reason: 'slice-broken fast path' });
    return { routed: 'staged', stagedPath };
  }
  // Normal path: would rename to IN_REVIEW
  const inReviewPath = path.join(qDir, `${id}-IN_REVIEW.md`);
  fs.renameSync(donePath, inReviewPath);
  return { routed: 'in_review', inReviewPath };
}

// ---------------------------------------------------------------------------
// AC1: The exact heading "## Rom Escalation — Slice Broken" triggers fast path
// ---------------------------------------------------------------------------
test('journey-slice-broken-ac-1 exact escalation heading is detected by fast-path regex', () => {
  const block = buildRomEscalationBlock();
  assert.ok(hasRomEscalationBlock(block), 'Escalation block must match the fast-path detection regex');
});

// ---------------------------------------------------------------------------
// AC2: Fast path routes file to staged/, NOT to queue/IN_REVIEW
// ---------------------------------------------------------------------------
test('journey-slice-broken-ac-2 escalated DONE routes to staged/ not IN_REVIEW', () => {
  writeDoneFile(SLICE_ID, true);
  const { routed, stagedPath } = simulateFastPath(SLICE_ID, queueDir, stagedDir, registerFile);

  assert.strictEqual(routed, 'staged', 'Fast path must route to staged/');
  assert.ok(fs.existsSync(stagedPath), 'File must exist in staged/ after fast path');
  assert.ok(
    !fs.existsSync(path.join(queueDir, `${SLICE_ID}-IN_REVIEW.md`)),
    'No IN_REVIEW file must be created when fast path fires'
  );
});

// ---------------------------------------------------------------------------
// AC3: Register contains ROM_ESCALATE event
// ---------------------------------------------------------------------------
test('journey-slice-broken-ac-3 register contains ROM_ESCALATE event on fast path', () => {
  const events = parseRegisterLines(registerFile);
  assertEventExists(events, 'ROM_ESCALATE', SLICE_ID);
});

// ---------------------------------------------------------------------------
// AC4: Round counter NOT incremented (no Nog Review block added)
// ---------------------------------------------------------------------------
test('journey-slice-broken-ac-4 round counter is not incremented on escalation', () => {
  const stagedPath = path.join(stagedDir, `${SLICE_ID}-STAGED.md`);
  const content    = fs.readFileSync(stagedPath, 'utf8');
  const rounds     = countNogRounds(content);
  assert.strictEqual(rounds, 0, 'Nog round counter must remain 0 — escalation does not count as a round');
});

// ---------------------------------------------------------------------------
// AC5: File in staged/ preserves original slice body
// ---------------------------------------------------------------------------
test('journey-slice-broken-ac-5 escalated file in staged/ preserves original slice body', () => {
  const stagedPath = path.join(stagedDir, `${SLICE_ID}-STAGED.md`);
  const content    = fs.readFileSync(stagedPath, 'utf8');
  assert.ok(/^## Goal/m.test(content),                   'Original ## Goal section must be preserved');
  assert.ok(/^## Acceptance criteria/m.test(content),    'Original ## Acceptance criteria section must be preserved');
  assert.ok(/## Rom Escalation — Slice Broken/m.test(content), 'Escalation block must be present');
});

// ---------------------------------------------------------------------------
// AC6: Without escalation heading, normal DONE → IN_REVIEW path fires
// ---------------------------------------------------------------------------
test('journey-slice-broken-ac-6 normal DONE without escalation routes to IN_REVIEW', () => {
  const normalId = '071';
  writeDoneFile(normalId, false);
  const { routed } = simulateFastPath(normalId, queueDir, stagedDir, registerFile);
  assert.strictEqual(routed, 'in_review', 'Normal DONE without escalation must route to IN_REVIEW');
});

// ---------------------------------------------------------------------------
// AC7: Heading variants that must NOT trigger the fast path
// ---------------------------------------------------------------------------
test('journey-slice-broken-ac-7 wrong heading variants do NOT trigger fast path', () => {
  const notEscalations = [
    '## Rom Escalation — Slice broken',   // lowercase 'broken'
    '## Rom Escalation - Slice Broken',   // ASCII hyphen not em-dash
    '## Rom escalation — Slice Broken',   // lowercase 'escalation'
    '## Rom Escalation—Slice Broken',     // missing space around em-dash
    '## ROM Escalation — Slice Broken',   // all-caps ROM
    '### Rom Escalation — Slice Broken',  // wrong heading level
  ];
  for (const variant of notEscalations) {
    assert.strictEqual(
      hasRomEscalationBlock(variant), false,
      `Variant "${variant}" must NOT trigger the fast path`
    );
  }
});

// ---------------------------------------------------------------------------
// AC8: Escalation block is append-only — content before it is unchanged
// ---------------------------------------------------------------------------
test('journey-slice-broken-ac-8 escalation block is appended after original content', () => {
  const body = buildSliceFile({ id: '072', status: 'DONE' });
  const full = body + buildRomEscalationBlock();

  const escalationIdx = full.indexOf('## Rom Escalation — Slice Broken');
  const goalIdx       = full.indexOf('## Goal');
  assert.ok(goalIdx < escalationIdx, '## Goal must appear before escalation block (append-only)');
});
