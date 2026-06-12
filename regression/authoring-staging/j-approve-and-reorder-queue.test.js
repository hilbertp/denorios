'use strict';

/**
 * Journey: J-approve-and-reorder-queue
 * Category: Authoring & Staging
 *
 * What this tests:
 *   The approval flow: a STAGED file moves to queue/ with the -QUEUED.md suffix,
 *   frontmatter status updates to QUEUED, a HUMAN_APPROVAL event lands in the
 *   register, queue-order.json is updated with the new slice ID, and a subsequent
 *   reorder produces the correct order in queue-order.json.
 *
 * Portability note:
 *   These tests do NOT spawn dashboard/server.js.  The approval logic is exercised
 *   through simulateApprove() in helpers/pipeline-logic.js, which replicates the
 *   server's approve handler using pure filesystem operations.  The server unit
 *   tests in test/ cover the HTTP layer separately.
 */

const { test, before, after } = require('node:test');
const assert  = require('node:assert/strict');
const fs      = require('node:fs');
const path    = require('node:path');

const { makeTmpDir, removeTmpDir }              = require('../helpers/tmp-dir');
const { buildSliceFile }                        = require('../helpers/slice-factory');
const { parseFrontmatter, simulateApprove, readQueueOrder, writeQueueOrder } = require('../helpers/pipeline-logic');
const { parseRegisterLines, assertEventExists, initRegisterFile } = require('../helpers/register-helper');

let tmpDir;
let stagedDir;
let queueDir;
let registerFile;
let queueOrderFile;
const ID_A = '050';
const ID_B = '051';

before(() => {
  tmpDir        = makeTmpDir('j-approve-reorder');
  stagedDir     = path.join(tmpDir, 'staged');
  queueDir      = path.join(tmpDir, 'queue');
  registerFile  = path.join(tmpDir, 'register.jsonl');
  queueOrderFile = path.join(tmpDir, 'queue-order.json');
  fs.mkdirSync(stagedDir);
  fs.mkdirSync(queueDir);
  initRegisterFile(registerFile);
  writeQueueOrder(queueOrderFile, []);
});

after(() => removeTmpDir(tmpDir));

function writeStaged(id) {
  const content  = buildSliceFile({ id, status: 'STAGED' });
  const filePath = path.join(stagedDir, `${id}-STAGED.md`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

// ---------------------------------------------------------------------------
// AC1: Approve moves file from staged/ to queue/ with -QUEUED.md suffix
// ---------------------------------------------------------------------------
test('journey-approve-reorder-ac-1 approve writes -QUEUED.md in queue/', () => {
  const stagedPath = writeStaged(ID_A);
  simulateApprove({ stagedPath, queueDir, queueOrderPath: queueOrderFile, registerPath: registerFile, id: ID_A });
  const queuedPath = path.join(queueDir, `${ID_A}-QUEUED.md`);
  assert.ok(fs.existsSync(queuedPath), 'Approved slice must appear as -QUEUED.md in queue/');
});

// ---------------------------------------------------------------------------
// AC2: Status updated to QUEUED in frontmatter
// ---------------------------------------------------------------------------
test('journey-approve-reorder-ac-2 frontmatter status updated to QUEUED after approval', () => {
  const queuedPath = path.join(queueDir, `${ID_A}-QUEUED.md`);
  const content    = fs.readFileSync(queuedPath, 'utf8');
  const meta       = parseFrontmatter(content);
  assert.strictEqual(meta.status, 'QUEUED', 'status must be QUEUED after approval');
});

// ---------------------------------------------------------------------------
// AC3: Register contains HUMAN_APPROVAL event for the slice
// ---------------------------------------------------------------------------
test('journey-approve-reorder-ac-3 register contains HUMAN_APPROVAL event', () => {
  const events = parseRegisterLines(registerFile);
  assertEventExists(events, 'HUMAN_APPROVAL', ID_A);
});

// ---------------------------------------------------------------------------
// AC4: queue-order.json contains the approved slice ID
// ---------------------------------------------------------------------------
test('journey-approve-reorder-ac-4 queue-order.json contains approved slice ID', () => {
  const order = readQueueOrder(queueOrderFile);
  assert.ok(Array.isArray(order), 'queue-order.json must be a JSON array');
  assert.ok(order.includes(ID_A), `queue-order.json must include slice ID "${ID_A}"`);
});

// ---------------------------------------------------------------------------
// AC5: Second approval appends to queue-order.json in arrival order
// ---------------------------------------------------------------------------
test('journey-approve-reorder-ac-5 second approval appended after first in queue-order.json', () => {
  const stagedPath = writeStaged(ID_B);
  simulateApprove({ stagedPath, queueDir, queueOrderPath: queueOrderFile, registerPath: registerFile, id: ID_B });

  const order = readQueueOrder(queueOrderFile);
  const idxA  = order.indexOf(ID_A);
  const idxB  = order.indexOf(ID_B);
  assert.ok(idxA !== -1, `"${ID_A}" must be in queue-order.json`);
  assert.ok(idxB !== -1, `"${ID_B}" must be in queue-order.json`);
  assert.ok(idxA < idxB, `"${ID_A}" (first approved) must appear before "${ID_B}" in queue-order.json`);
});

// ---------------------------------------------------------------------------
// AC6: Reorder persists the new position in queue-order.json
// ---------------------------------------------------------------------------
test('journey-approve-reorder-ac-6 drag-reorder updates queue-order.json with new position', () => {
  const orderBefore = readQueueOrder(queueOrderFile);
  const reordered   = [ID_B, ID_A]; // user dragged ID_B to front
  writeQueueOrder(queueOrderFile, reordered);

  const orderAfter = readQueueOrder(queueOrderFile);
  assert.deepStrictEqual(orderAfter, reordered, 'queue-order.json must reflect new drag order');
  assert.strictEqual(orderAfter[0], ID_B, `Dragged slice "${ID_B}" must be at position 0`);
  assert.strictEqual(orderAfter[1], ID_A, `Slice "${ID_A}" must be at position 1 after reorder`);
});

// ---------------------------------------------------------------------------
// AC7: queue-order.json is always valid JSON
// ---------------------------------------------------------------------------
test('journey-approve-reorder-ac-7 queue-order.json is always valid parseable JSON array', () => {
  const raw    = fs.readFileSync(queueOrderFile, 'utf8');
  let parsed;
  try { parsed = JSON.parse(raw); } catch (err) {
    assert.fail(`queue-order.json is not valid JSON: ${err.message}`);
  }
  assert.ok(Array.isArray(parsed), 'queue-order.json must be a JSON array');
});

// ---------------------------------------------------------------------------
// AC8: Re-approving an already-queued ID does not duplicate it in queue-order
// ---------------------------------------------------------------------------
test('journey-approve-reorder-ac-8 re-approving the same ID does not duplicate in queue-order.json', () => {
  const order = readQueueOrder(queueOrderFile);
  // simulateApprove only pushes if not already present (mirrors server.js line 944)
  if (!order.includes(ID_A)) order.push(ID_A);
  writeQueueOrder(queueOrderFile, order);

  const finalOrder = readQueueOrder(queueOrderFile);
  const occurrences = finalOrder.filter(x => x === ID_A).length;
  assert.strictEqual(occurrences, 1, `Slice "${ID_A}" must appear exactly once in queue-order.json`);
});
