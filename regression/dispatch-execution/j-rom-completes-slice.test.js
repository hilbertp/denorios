'use strict';

/**
 * Journey: J-rom-completes-slice
 * Category: Dispatch & Execution
 *
 * What this tests:
 *   When Rom finishes a slice, he appends a "## Rom DONE Report — Round N" block
 *   to the slice file.  The orchestrator detects this, renames IN_PROGRESS →
 *   DONE, emits a DONE register event, then renames DONE → IN_REVIEW and spawns
 *   Nog.
 *
 *   These tests cover the observable signals:
 *     • DONE Report block format and detectability
 *     • IN_PROGRESS → DONE file-move contract
 *     • DONE → IN_REVIEW file-move contract
 *     • Register event shape (DONE event)
 *     • Slice file is append-only (original body preserved)
 *
 * Portability note:
 *   No orchestrator process is started.  File moves and register events are
 *   simulated using filesystem operations in isolated temp dirs, matching the
 *   primitives used by orchestrator.js (renameSync + appendFileSync).
 */

const { test, before, after } = require('node:test');
const assert  = require('node:assert/strict');
const fs      = require('node:fs');
const path    = require('node:path');

const { makeTmpDir, removeTmpDir }  = require('../helpers/tmp-dir');
const { buildSliceFile, buildRomDoneReport } = require('../helpers/slice-factory');
const { parseFrontmatter, hasRomDoneReport } = require('../helpers/pipeline-logic');
const { parseRegisterLines, assertEventExists, appendRegisterEvent, initRegisterFile } = require('../helpers/register-helper');

let tmpDir;
let queueDir;
let registerFile;
const SLICE_ID = '060';

before(() => {
  tmpDir       = makeTmpDir('j-rom-completes');
  queueDir     = path.join(tmpDir, 'queue');
  registerFile = path.join(tmpDir, 'register.jsonl');
  fs.mkdirSync(queueDir);
  initRegisterFile(registerFile);
});

after(() => removeTmpDir(tmpDir));

// ---------------------------------------------------------------------------
// Helpers — simulate the three moves the orchestrator makes
// ---------------------------------------------------------------------------

function writeInProgress(id) {
  const content  = buildSliceFile({ id, status: 'IN_PROGRESS' });
  const filePath = path.join(queueDir, `${id}-IN_PROGRESS.md`);
  fs.writeFileSync(filePath, content);
  return { filePath, content };
}

function appendDoneReport(inProgressPath, round = 1) {
  const report = buildRomDoneReport(round);
  fs.appendFileSync(inProgressPath, report);
  return report;
}

function simulateInProgressToDone(id, qDir, regFile) {
  const src = path.join(qDir, `${id}-IN_PROGRESS.md`);
  const dst = path.join(qDir, `${id}-DONE.md`);
  fs.renameSync(src, dst);
  appendRegisterEvent(regFile, { event: 'DONE', slice_id: id, round: 1 });
  return dst;
}

function simulateDoneToInReview(id, qDir) {
  const src = path.join(qDir, `${id}-DONE.md`);
  const dst = path.join(qDir, `${id}-IN_REVIEW.md`);
  fs.renameSync(src, dst);
  return dst;
}

// ---------------------------------------------------------------------------
// AC1: Rom DONE Report block is detectable by the heading pattern
// ---------------------------------------------------------------------------
test('J-rom-completes-slice slice-060-ac-1 — DONE Report block is detectable by exact heading pattern', () => {
  const report = buildRomDoneReport(1);
  assert.ok(hasRomDoneReport(report), 'DONE Report block must match the heading pattern');
});

test('J-rom-completes-slice slice-060-ac-2 — DONE Report heading includes round number', () => {
  const report = buildRomDoneReport(2);
  assert.ok(/^## Rom DONE Report — Round 2/m.test(report), 'Heading must include round number');
});

// ---------------------------------------------------------------------------
// AC3: Append-only — original slice body is preserved when DONE report appended
// ---------------------------------------------------------------------------
test('J-rom-completes-slice slice-060-ac-3 — original slice body is preserved after DONE report appended', () => {
  const { filePath, content: original } = writeInProgress(SLICE_ID);
  appendDoneReport(filePath, 1);

  const updated = fs.readFileSync(filePath, 'utf8');
  assert.ok(
    updated.startsWith(original),
    'Original slice body must be preserved (append-only discipline violated)'
  );
});

// ---------------------------------------------------------------------------
// AC4: IN_PROGRESS → DONE file transition (rename)
// ---------------------------------------------------------------------------
test('J-rom-completes-slice slice-060-ac-4 — IN_PROGRESS file renamed to DONE after Rom completion', () => {
  const { filePath: inProgPath } = writeInProgress(SLICE_ID);
  appendDoneReport(inProgPath, 1);

  const donePath = simulateInProgressToDone(SLICE_ID, queueDir, registerFile);
  assert.ok(!fs.existsSync(inProgPath), '-IN_PROGRESS.md must no longer exist');
  assert.ok(fs.existsSync(donePath),    '-DONE.md must exist after rename');
});

// ---------------------------------------------------------------------------
// AC5: Register contains DONE event after transition
// ---------------------------------------------------------------------------
test('J-rom-completes-slice slice-060-ac-5 — register contains DONE event after IN_PROGRESS → DONE', () => {
  const events = parseRegisterLines(registerFile);
  assertEventExists(events, 'DONE', SLICE_ID);
});

// ---------------------------------------------------------------------------
// AC6: DONE → IN_REVIEW file transition
// ---------------------------------------------------------------------------
test('J-rom-completes-slice slice-060-ac-6 — DONE file renamed to IN_REVIEW before Nog spawn', () => {
  const donePath     = path.join(queueDir, `${SLICE_ID}-DONE.md`);
  const inReviewPath = simulateDoneToInReview(SLICE_ID, queueDir);

  assert.ok(!fs.existsSync(donePath),    '-DONE.md must no longer exist after Nog handover');
  assert.ok(fs.existsSync(inReviewPath), '-IN_REVIEW.md must exist before Nog is invoked');
});

// ---------------------------------------------------------------------------
// AC7: Slice file frontmatter is parseable in IN_REVIEW state
// ---------------------------------------------------------------------------
test('J-rom-completes-slice slice-060-ac-7 — slice file frontmatter is parseable in IN_REVIEW state', () => {
  const inReviewPath = path.join(queueDir, `${SLICE_ID}-IN_REVIEW.md`);
  const content      = fs.readFileSync(inReviewPath, 'utf8');
  const meta         = parseFrontmatter(content);
  assert.ok(meta,   'Frontmatter must parse in IN_REVIEW state');
  assert.ok(meta.id, 'Frontmatter id must be present in IN_REVIEW file');
});

// ---------------------------------------------------------------------------
// AC8: DONE Report heading variant — case and dash sensitivity
// ---------------------------------------------------------------------------
test('J-rom-completes-slice slice-060-ac-8 — wrong heading variants do NOT match DONE Report pattern', () => {
  const wrong = [
    '## Rom Done Report — Round 1',   // lowercase 'one'
    '## ROM DONE Report — Round 1',   // all-caps ROM
    '## Rom DONE report — Round 1',   // lowercase 'report'
    '## Rom DONE Report - Round 1',   // ASCII hyphen instead of em-dash
    '#  Rom DONE Report — Round 1',   // extra space in heading marker
  ];
  for (const variant of wrong) {
    assert.strictEqual(
      hasRomDoneReport(variant), false,
      `Variant "${variant}" must NOT match DONE Report heading`
    );
  }
});
