'use strict';

/**
 * Journey: J-approve-and-reorder-queue (Tier 1 — contract simulation)
 * Category: Authoring & Staging
 *
 * What this tests (spec = journey text, not implementation):
 *   Philipp approves a staged slice into the execution queue and reorders
 *   approved slices by dragging:
 *     - Steps 3-4 / Outcome 1: approve moves the slice out of staged/ into
 *       queue/{id}-QUEUED.md (atomic move), frontmatter status QUEUED.
 *     - Step 5 / Outcome 2: register gains a HUMAN_APPROVAL event with the
 *       slice id.
 *     - Step 9 / Outcome 4: the order is persisted to queue-order.json as a
 *       valid JSON array — approvals append in arrival order, a drag-reorder
 *       persists exactly the new sequence, never partial/corrupt content,
 *       never duplicate ids.
 *     - Outcome 5: the orchestrator's next pickup cycle consults
 *       queue-order.json and dispatches in that order — the head of the
 *       order wins, NOT the filename-sorted first QUEUED file.
 *     - Outcome 8: approving into an empty queue leaves the id present in
 *       queue-order.json so the very next poll can pick it up.
 *
 * Tier 1 simulation: transitions are driven with the same primitives the
 * server/orchestrator use (writeFileSync for the QUEUED copy, renameSync for
 * the atomic move out of staged/, appendFileSync for register events). All
 * state lives in a tmpdir (#99992) — live bridge/ is never touched.
 *
 * Deliberately NOT asserted here (and why):
 *   - HTTP endpoint behavior (POST /api/bridge/staged/:id/approve,
 *     POST /api/queue/order): covered by the Tier 2 sibling file
 *     j-approve-and-reorder-server.test.js against the real server handlers.
 *   - Steps 6-8, 10 + outcomes 6-7 (row animation, drag handle visuals,
 *     opacity 0.6, dashed drop border, snap ease): browser-only rendering,
 *     not headless-testable.
 *   - The orchestrator's live poll loop itself (Tier 3 is off-limits here:
 *     orchestrator.js anchors queue-order.json to __dirname, which the
 *     _testSetDirs hooks do not redirect — driving it would touch live
 *     bridge/queue-order.json). The dispatch-order CONTRACT is simulated
 *     via computeDispatchOrder in this journey's private helper instead.
 *
 * Sources: docs/e2e-journeys/J-approve-and-reorder-queue.md
 *          docs/contracts/slice-pipeline.md §4 (suffix map, legacy dual-read),
 *            §5 (STAGED → QUEUED on POST /approve, emits HUMAN_APPROVAL),
 *            §7 (HUMAN_APPROVAL register event)
 *          docs/contracts/slice-lifecycle.md (QUEUED definition; Philipp is
 *            the approving actor)
 */

const { test, before, after } = require('node:test');
const assert  = require('node:assert/strict');
const fs      = require('node:fs');
const path    = require('node:path');

const { makeTmpDir, removeTmpDir } = require('../helpers/tmp-dir');
const { buildSliceFile }           = require('../helpers/slice-factory');
const { parseFrontmatter, readQueueOrder, writeQueueOrder } = require('../helpers/pipeline-logic');
const { parseRegisterLines, assertEventExists, initRegisterFile } = require('../helpers/register-helper');
const { approveStaged, computeDispatchOrder } = require('./j-approve-and-reorder-queue-helpers');

let tmpDir;
let stagedDir;
let queueDir;
let trashDir;
let registerFile;
let queueOrderFile;

const ID_A = '050';
const ID_B = '051';

before(() => {
  tmpDir         = makeTmpDir('j-approve-reorder');
  stagedDir      = path.join(tmpDir, 'staged');
  queueDir       = path.join(tmpDir, 'queue');
  trashDir       = path.join(tmpDir, 'trash');
  registerFile   = path.join(tmpDir, 'register.jsonl');
  queueOrderFile = path.join(tmpDir, 'queue-order.json');
  fs.mkdirSync(stagedDir);
  fs.mkdirSync(queueDir);
  fs.mkdirSync(trashDir);
  initRegisterFile(registerFile);
  writeQueueOrder(queueOrderFile, []);
});

after(() => removeTmpDir(tmpDir));

// Precondition: a slice exists in staged/ as {id}-STAGED.md (journey preconditions).
function writeStaged(id) {
  const content  = buildSliceFile({ id, status: 'STAGED' });
  const filePath = path.join(stagedDir, `${id}-STAGED.md`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

function approve(id, stagedPath) {
  return approveStaged({
    stagedPath, queueDir, trashDir,
    queueOrderPath: queueOrderFile,
    registerPath: registerFile,
    id,
  });
}

// ---------------------------------------------------------------------------
// Steps 3-4 + Outcome 1: approve moves the file out of staged/ into queue/
// as {id}-QUEUED.md — "staged/{id}-STAGED.md is gone; queue/{id}-QUEUED.md
// exists"
// ---------------------------------------------------------------------------
test('J-approve-and-reorder-queue slice-050-ac-1 — approve moves staged slice into queue/ as -QUEUED.md and staged copy is gone', () => {
  const stagedPath = writeStaged(ID_A);
  approve(ID_A, stagedPath);

  const queuedPath = path.join(queueDir, `${ID_A}-QUEUED.md`);
  assert.ok(fs.existsSync(queuedPath), 'Approved slice must appear as -QUEUED.md in queue/ (outcome 1)');
  assert.ok(!fs.existsSync(stagedPath), `staged/${ID_A}-STAGED.md must be gone after approval (outcome 1)`);
});

// ---------------------------------------------------------------------------
// Step 4 + Outcome 1: frontmatter status updated to QUEUED, file still
// parseable, identity and routing fields survive the move
// ---------------------------------------------------------------------------
test('J-approve-and-reorder-queue slice-050-ac-2 — approved file frontmatter has status QUEUED and survives the move parseable', () => {
  const queuedPath = path.join(queueDir, `${ID_A}-QUEUED.md`);
  const meta       = parseFrontmatter(fs.readFileSync(queuedPath, 'utf8'));

  assert.ok(meta, 'Frontmatter must still parse after the STAGED → QUEUED move');
  assert.strictEqual(meta.status, 'QUEUED', 'status must be QUEUED after approval (lifecycle: QUEUED = approved by Philipp)');
  assert.strictEqual(meta.id, ID_A, 'frontmatter id must still match the slice id');
  for (const field of ['title', 'goal', 'from', 'to', 'priority', 'created']) {
    assert.ok(meta[field], `Required frontmatter field "${field}" must survive the transition`);
  }
});

// ---------------------------------------------------------------------------
// Step 5 + Outcome 2: register contains HUMAN_APPROVAL with the slice id
// ---------------------------------------------------------------------------
test('J-approve-and-reorder-queue slice-050-ac-3 — register gains HUMAN_APPROVAL event carrying the slice id', () => {
  const events = parseRegisterLines(registerFile);
  const ev = assertEventExists(events, 'HUMAN_APPROVAL', ID_A);
  assert.strictEqual(ev.action, 'approved', 'HUMAN_APPROVAL must record the approved action');
  assert.ok(ev.ts, 'HUMAN_APPROVAL must carry a ts field (pipeline §7 minimum schema)');
});

// ---------------------------------------------------------------------------
// Step 9 + Outcome 4: queue-order.json contains the approved slice id as a
// valid JSON array
// ---------------------------------------------------------------------------
test('J-approve-and-reorder-queue slice-050-ac-4 — queue-order.json is a valid JSON array containing the approved slice id', () => {
  const order = readQueueOrder(queueOrderFile);
  assert.ok(Array.isArray(order), 'queue-order.json must be a JSON array');
  assert.ok(order.includes(ID_A), `queue-order.json must include slice id "${ID_A}"`);
});

// ---------------------------------------------------------------------------
// Step 9 + Outcome 4: a second approval appends after the first — arrival
// order is the default priority order
// ---------------------------------------------------------------------------
test('J-approve-and-reorder-queue slice-051-ac-5 — second approval appends after the first in queue-order.json', () => {
  const stagedPath = writeStaged(ID_B);
  approve(ID_B, stagedPath);

  const order = readQueueOrder(queueOrderFile);
  const idxA  = order.indexOf(ID_A);
  const idxB  = order.indexOf(ID_B);
  assert.ok(idxA !== -1, `"${ID_A}" must be in queue-order.json`);
  assert.ok(idxB !== -1, `"${ID_B}" must be in queue-order.json`);
  assert.ok(idxA < idxB, `"${ID_A}" (approved first) must appear before "${ID_B}" in queue-order.json`);
});

// ---------------------------------------------------------------------------
// Steps 8-9 + Outcome 4: drag-reorder persists exactly the new sequence
// ---------------------------------------------------------------------------
test('J-approve-and-reorder-queue slice-051-ac-6 — drag-reorder persists exactly the submitted order to queue-order.json', () => {
  const reordered = [ID_B, ID_A]; // Philipp dragged ID_B to the front (step 8)
  writeQueueOrder(queueOrderFile, reordered);

  const orderAfter = readQueueOrder(queueOrderFile);
  assert.deepStrictEqual(orderAfter, reordered, 'queue-order.json must reflect the new drag order exactly');
  assert.strictEqual(orderAfter[0], ID_B, `Dragged slice "${ID_B}" must be at position 0`);
  assert.strictEqual(orderAfter[1], ID_A, `Slice "${ID_A}" must be at position 1 after reorder`);
});

// ---------------------------------------------------------------------------
// Outcome 4 (atomic write): after the whole approve + reorder cycle the file
// on disk parses as a complete JSON array — no partial content
// ---------------------------------------------------------------------------
test('J-approve-and-reorder-queue slice-050-ac-7 — queue-order.json on disk is complete, parseable JSON after approve + reorder cycle', () => {
  const raw = fs.readFileSync(queueOrderFile, 'utf8');
  let parsed;
  try { parsed = JSON.parse(raw); } catch (err) {
    assert.fail(`queue-order.json is not valid JSON (partial/corrupt write): ${err.message}`);
  }
  assert.ok(Array.isArray(parsed), 'queue-order.json must be a JSON array');
});

// ---------------------------------------------------------------------------
// Outcome 4 integrity: re-approving an already-queued id must not duplicate
// it in queue-order.json (a duplicate would dispatch the same slice twice)
// ---------------------------------------------------------------------------
test('J-approve-and-reorder-queue slice-050-ac-8 — re-approving an already-queued id does not duplicate it in queue-order.json', () => {
  const stagedPath = writeStaged(ID_A); // slice re-staged, then approved again
  approve(ID_A, stagedPath);

  const order = readQueueOrder(queueOrderFile);
  const occurrences = order.filter(x => x === ID_A).length;
  assert.strictEqual(occurrences, 1, `Slice "${ID_A}" must appear exactly once in queue-order.json`);
});

// ---------------------------------------------------------------------------
// Outcome 5: "Orchestrator's next pickup cycle consults queue-order.json and
// dispatches in that order" — head of the order wins, not the filename sort.
// queue-order is [051, 050] (after the drag in ac-6); a filename-sorted pick
// would dispatch 050 first.
// ---------------------------------------------------------------------------
test('J-approve-and-reorder-queue slice-051-ac-9 — dispatch consults queue-order.json: ordered head wins over filename sort', () => {
  writeQueueOrder(queueOrderFile, [ID_B, ID_A]);
  assert.ok(fs.existsSync(path.join(queueDir, `${ID_A}-QUEUED.md`)), 'fixture: both QUEUED files must exist');
  assert.ok(fs.existsSync(path.join(queueDir, `${ID_B}-QUEUED.md`)), 'fixture: both QUEUED files must exist');

  // Demonstrate the trap: lexicographic filename sort would pick ID_A first.
  const sortedFirst = fs.readdirSync(queueDir).sort()[0];
  assert.ok(sortedFirst.startsWith(ID_A), `fixture: filename sort puts "${ID_A}" first — order file must override this`);

  const dispatch = computeDispatchOrder(queueOrderFile, queueDir);
  assert.strictEqual(dispatch[0], ID_B, `Dispatch head must be "${ID_B}" — queue-order.json order, not filename order (outcome 5)`);
  assert.deepStrictEqual(dispatch, [ID_B, ID_A], 'Full dispatch order must follow queue-order.json exactly');
});

// ---------------------------------------------------------------------------
// Outcome 5 + blast radius ("corruption of queue-order.json silently
// reorders or orphans work for every subsequent dispatch"): a stale id with
// no QUEUED file must neither be dispatched nor block/reorder the real
// slices behind it
// ---------------------------------------------------------------------------
test('J-approve-and-reorder-queue slice-051-ac-10 — stale id in queue-order.json does not block or reorder dispatch of real QUEUED slices', () => {
  writeQueueOrder(queueOrderFile, ['099', ID_B, ID_A]); // 099 has no QUEUED file

  const dispatch = computeDispatchOrder(queueOrderFile, queueDir);
  assert.ok(!dispatch.includes('099'), 'An id without a QUEUED file must not be dispatchable');
  assert.deepStrictEqual(dispatch, [ID_B, ID_A],
    'Remaining slices must keep their relative queue-order positions behind a stale entry');
});

// ---------------------------------------------------------------------------
// Outcome 8: "If the queue was empty before approval, the orchestrator may
// pick up this slice immediately on its next poll" — approving into an empty
// queue must leave the id present in queue-order.json right away
// ---------------------------------------------------------------------------
test('J-approve-and-reorder-queue slice-052-ac-11 — approving into an empty queue leaves the id in queue-order.json ready for the next poll', () => {
  // Isolated empty-queue fixture: no QUEUED files, queue-order.json is []
  const emptyRoot   = path.join(tmpDir, 'empty-queue-case');
  const eStagedDir  = path.join(emptyRoot, 'staged');
  const eQueueDir   = path.join(emptyRoot, 'queue');
  const eTrashDir   = path.join(emptyRoot, 'trash');
  const eRegister   = path.join(emptyRoot, 'register.jsonl');
  const eQueueOrder = path.join(emptyRoot, 'queue-order.json');
  fs.mkdirSync(eStagedDir, { recursive: true });
  fs.mkdirSync(eQueueDir,  { recursive: true });
  fs.mkdirSync(eTrashDir,  { recursive: true });
  initRegisterFile(eRegister);
  writeQueueOrder(eQueueOrder, []);

  const id = '052';
  const stagedPath = path.join(eStagedDir, `${id}-STAGED.md`);
  fs.writeFileSync(stagedPath, buildSliceFile({ id, status: 'STAGED' }));

  approveStaged({
    stagedPath, queueDir: eQueueDir, trashDir: eTrashDir,
    queueOrderPath: eQueueOrder, registerPath: eRegister, id,
  });

  const order = readQueueOrder(eQueueOrder);
  assert.deepStrictEqual(order, [id],
    'queue-order.json must contain exactly the newly approved id immediately after approval (outcome 8)');
  const dispatch = computeDispatchOrder(eQueueOrder, eQueueDir);
  assert.strictEqual(dispatch[0], id,
    'The next pickup cycle must be able to dispatch the freshly approved slice immediately (outcome 8)');
});
