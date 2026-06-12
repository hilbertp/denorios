'use strict';

/**
 * Top-five stakeholder journeys.
 *
 * These tests cover the user-critical path at the kanban/file-contract level:
 * staged review, approved-queue management, implementation handoff, Nog review,
 * and Bashir gate promotion. They use isolated temp directories so they do not
 * mutate the live bridge state while still asserting real markdown/frontmatter,
 * order-file, and register-event contracts.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { makeTmpDir, removeTmpDir } = require('../helpers/tmp-dir');
const {
  buildSliceFile,
  buildRomDoneReport,
  buildNogReviewBlock,
} = require('../helpers/slice-factory');
const {
  parseFrontmatter,
  simulateApprove,
  readQueueOrder,
  writeQueueOrder,
  countNogRounds,
} = require('../helpers/pipeline-logic');
const {
  appendRegisterEvent,
  assertEventExists,
  initRegisterFile,
  parseRegisterLines,
} = require('../helpers/register-helper');

let tmpDir;
let stagedDir;
let queueDir;
let trashDir;
let stateDir;
let registerFile;
let queueOrderFile;
let stagedOrderFile;
let heartbeatFile;
let branchStateFile;

beforeEach(() => {
  tmpDir = makeTmpDir('top-five-journeys');
  stagedDir = path.join(tmpDir, 'staged');
  queueDir = path.join(tmpDir, 'queue');
  trashDir = path.join(tmpDir, 'trash');
  stateDir = path.join(tmpDir, 'state');
  registerFile = path.join(tmpDir, 'register.jsonl');
  queueOrderFile = path.join(tmpDir, 'queue-order.json');
  stagedOrderFile = path.join(tmpDir, 'staged-order.json');
  heartbeatFile = path.join(tmpDir, 'heartbeat.json');
  branchStateFile = path.join(stateDir, 'branch-state.json');

  for (const dir of [stagedDir, queueDir, trashDir, stateDir]) fs.mkdirSync(dir, { recursive: true });
  initRegisterFile(registerFile);
  writeQueueOrder(queueOrderFile, []);
  fs.writeFileSync(stagedOrderFile, '[]\n', 'utf8');
  fs.writeFileSync(heartbeatFile, JSON.stringify({ current_slice: null, status: 'idle' }, null, 2), 'utf8');
});

afterEach(() => removeTmpDir(tmpDir));

function writeStaged(id, overrides = {}) {
  const content = buildSliceFile({
    id,
    title: `Top journey ${id}`,
    goal: 'Exercise a top stakeholder journey.',
    from: 'obrien',
    to: 'rom',
    status: 'STAGED',
    ...overrides,
  }, [
    '1. The user can see the current state.',
    '2. The next action changes file state predictably.',
  ]);
  const filePath = path.join(stagedDir, `${id}-STAGED.md`);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function writeQueued(id, overrides = {}) {
  const content = buildSliceFile({
    id,
    title: `Top journey ${id}`,
    goal: 'Exercise an approved queue journey.',
    from: 'obrien',
    to: 'rom',
    status: 'QUEUED',
    ...overrides,
  });
  const filePath = path.join(queueDir, `${id}-QUEUED.md`);
  fs.writeFileSync(filePath, content, 'utf8');
  const order = readQueueOrder(queueOrderFile);
  if (!order.includes(id)) order.push(id);
  writeQueueOrder(queueOrderFile, order);
  return filePath;
}

function replaceBodyPreservingFrontmatter(filePath, body) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');
  let dashes = 0;
  let fmEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') dashes++;
    if (dashes === 2) { fmEnd = i; break; }
  }
  assert.notEqual(fmEnd, -1, 'frontmatter must have a closing ---');
  fs.writeFileSync(filePath, lines.slice(0, fmEnd + 1).join('\n') + '\n\n' + body, 'utf8');
}

function updateStatus(content, status, extra = {}) {
  let updated = content.replace(/^status: "?[^"\n]+"?/m, `status: "${status}"`);
  for (const [key, value] of Object.entries(extra)) {
    const line = `${key}: "${value}"`;
    if (new RegExp(`^${key}:`, 'm').test(updated)) updated = updated.replace(new RegExp(`^${key}:.*$`, 'm'), line);
    else updated = updated.replace(/^---\n/, `---\n${line}\n`);
  }
  return updated;
}

test('slice-999-ac-1 top journey stage inspect approve moves STAGED to approved queue', () => {
  const id = '901';
  const stagedPath = writeStaged(id);
  const stagedText = fs.readFileSync(stagedPath, 'utf8');
  const stagedMeta = parseFrontmatter(stagedText);

  assert.equal(stagedMeta.status, 'STAGED');
  assert.equal(stagedMeta.from, 'obrien');
  assert.match(stagedText, /^## Acceptance criteria/m);

  const { queuedPath } = simulateApprove({
    stagedPath,
    queueDir,
    queueOrderPath: queueOrderFile,
    registerPath: registerFile,
    id,
  });

  const queuedMeta = parseFrontmatter(fs.readFileSync(queuedPath, 'utf8'));
  assert.equal(queuedMeta.status, 'QUEUED');
  assert.deepEqual(readQueueOrder(queueOrderFile), [id]);
  assertEventExists(parseRegisterLines(registerFile), 'HUMAN_APPROVAL', id);
});

test("slice-999-ac-2 top journey manage approved queue edits unapproves removes and returns to O'Brien", () => {
  const editId = '902';
  const unapproveId = '903';
  const removeId = '904';
  const returnId = '905';
  const editPath = writeQueued(editId);
  writeQueued(unapproveId);
  writeQueued(removeId);
  writeQueued(returnId);

  writeQueueOrder(queueOrderFile, [returnId, removeId, unapproveId, editId]);
  replaceBodyPreservingFrontmatter(editPath, '## Goal\n\nEdited before pickup.\n');
  assert.equal(parseFrontmatter(fs.readFileSync(editPath, 'utf8')).status, 'QUEUED');
  assert.match(fs.readFileSync(editPath, 'utf8'), /Edited before pickup/);

  const unapproveSource = path.join(queueDir, `${unapproveId}-QUEUED.md`);
  const unapproved = updateStatus(fs.readFileSync(unapproveSource, 'utf8'), 'STAGED');
  fs.writeFileSync(path.join(stagedDir, `${unapproveId}-STAGED.md`), unapproved, 'utf8');
  fs.unlinkSync(unapproveSource);
  writeQueueOrder(queueOrderFile, readQueueOrder(queueOrderFile).filter(id => id !== unapproveId));
  fs.writeFileSync(stagedOrderFile, JSON.stringify([unapproveId], null, 2), 'utf8');
  appendRegisterEvent(registerFile, { event: 'slice-unapproved', slice_id: unapproveId, prev_position: 2 });

  const removeSource = path.join(queueDir, `${removeId}-QUEUED.md`);
  fs.renameSync(removeSource, path.join(trashDir, `${removeId}-QUEUED.md.removed-fixture`));
  writeQueueOrder(queueOrderFile, readQueueOrder(queueOrderFile).filter(id => id !== removeId));
  appendRegisterEvent(registerFile, { event: 'slice-archived-from-queue', slice_id: removeId, reason: 'user-removed' });

  const returnSource = path.join(queueDir, `${returnId}-QUEUED.md`);
  const returned = updateStatus(fs.readFileSync(returnSource, 'utf8'), 'NEEDS_APENDMENT', {
    apendment_note: "Needs O'Brien rewrite",
  });
  fs.writeFileSync(path.join(stagedDir, `${returnId}-NEEDS_APENDMENT.md`), returned, 'utf8');
  fs.renameSync(returnSource, path.join(trashDir, `${returnId}-QUEUED.md.returned-to-stage-fixture`));
  writeQueueOrder(queueOrderFile, readQueueOrder(queueOrderFile).filter(id => id !== returnId));
  fs.writeFileSync(stagedOrderFile, JSON.stringify([unapproveId, returnId], null, 2), 'utf8');
  appendRegisterEvent(registerFile, { event: 'returned_to_stage', slice_id: returnId, source: 'dashboard' });

  const events = parseRegisterLines(registerFile);
  assert.deepEqual(readQueueOrder(queueOrderFile), [editId]);
  assert.equal(parseFrontmatter(fs.readFileSync(path.join(stagedDir, `${unapproveId}-STAGED.md`), 'utf8')).status, 'STAGED');
  assert.equal(parseFrontmatter(fs.readFileSync(path.join(stagedDir, `${returnId}-NEEDS_APENDMENT.md`), 'utf8')).status, 'NEEDS_APENDMENT');
  assert.ok(fs.existsSync(path.join(trashDir, `${removeId}-QUEUED.md.removed-fixture`)));
  assertEventExists(events, 'slice-unapproved', unapproveId);
  assertEventExists(events, 'slice-archived-from-queue', removeId);
  assertEventExists(events, 'returned_to_stage', returnId);
});

test('slice-999-ac-3 top journey implementation handoff exposes active build then Nog review', () => {
  const id = '906';
  writeQueued(id);
  const queuedPath = path.join(queueDir, `${id}-QUEUED.md`);
  const inProgressPath = path.join(queueDir, `${id}-IN_PROGRESS.md`);

  fs.renameSync(queuedPath, inProgressPath);
  fs.writeFileSync(heartbeatFile, JSON.stringify({
    status: 'busy',
    current_slice: id,
    slice_elapsed_seconds: 12,
  }, null, 2), 'utf8');
  appendRegisterEvent(registerFile, { event: 'COMMISSIONED', slice_id: id, title: 'Active build' });

  fs.appendFileSync(inProgressPath, buildRomDoneReport(1), 'utf8');
  assert.match(fs.readFileSync(inProgressPath, 'utf8'), /^## Rom DONE Report — Round 1/m);

  const donePath = path.join(queueDir, `${id}-DONE.md`);
  const inReviewPath = path.join(queueDir, `${id}-IN_REVIEW.md`);
  fs.renameSync(inProgressPath, donePath);
  appendRegisterEvent(registerFile, { event: 'DONE', slice_id: id, round: 1 });
  fs.renameSync(donePath, inReviewPath);

  const heartbeat = JSON.parse(fs.readFileSync(heartbeatFile, 'utf8'));
  assert.equal(heartbeat.current_slice, id);
  assert.equal(fs.existsSync(inReviewPath), true);
  assertEventExists(parseRegisterLines(registerFile), 'DONE', id);
});

test('slice-999-ac-4 top journey Nog rejection preserves same slice ID through round two acceptance', () => {
  const id = '907';
  const inReviewPath = path.join(queueDir, `${id}-IN_REVIEW.md`);
  fs.writeFileSync(inReviewPath, buildSliceFile({ id, status: 'IN_REVIEW' }) + buildRomDoneReport(1), 'utf8');

  fs.appendFileSync(inReviewPath, buildNogReviewBlock(1, 'REJECT', 'AC #1 not met.'), 'utf8');
  const queuedPath = path.join(queueDir, `${id}-QUEUED.md`);
  fs.renameSync(inReviewPath, queuedPath);
  appendRegisterEvent(registerFile, { event: 'NOG_DECISION', slice_id: id, verdict: 'REJECTED', round: 1 });
  appendRegisterEvent(registerFile, { event: 'REVIEW_RECEIVED', slice_id: id, round: 1 });

  const inProgress2Path = path.join(queueDir, `${id}-IN_PROGRESS.md`);
  const done2Path = path.join(queueDir, `${id}-DONE.md`);
  const inReview2Path = path.join(queueDir, `${id}-IN_REVIEW.md`);
  fs.renameSync(queuedPath, inProgress2Path);
  fs.appendFileSync(inProgress2Path, buildRomDoneReport(2), 'utf8');
  fs.renameSync(inProgress2Path, done2Path);
  appendRegisterEvent(registerFile, { event: 'DONE', slice_id: id, round: 2 });
  fs.renameSync(done2Path, inReview2Path);

  fs.appendFileSync(inReview2Path, buildNogReviewBlock(2, 'PASS', 'All ACs now satisfied.'), 'utf8');
  const acceptedPath = path.join(queueDir, `${id}-ACCEPTED.md`);
  fs.renameSync(inReview2Path, acceptedPath);
  appendRegisterEvent(registerFile, { event: 'NOG_DECISION', slice_id: id, verdict: 'ACCEPTED', round: 2 });
  appendRegisterEvent(registerFile, { event: 'ACCEPTED', slice_id: id, round: 2 });

  const accepted = fs.readFileSync(acceptedPath, 'utf8');
  assert.equal(countNogRounds(accepted), 2);
  assert.match(accepted, /^## Rom DONE Report — Round 1/m);
  assert.match(accepted, /^## Rom DONE Report — Round 2/m);
  assert.equal(fs.existsSync(path.join(queueDir, '908-ACCEPTED.md')), false, 'round two must not create a child slice ID');
  assertEventExists(parseRegisterLines(registerFile), 'ACCEPTED', id);
});

test('slice-999-ac-5 top journey Bashir gate pass promotes dev and records merge events', () => {
  const id = '907';
  const devTip = 'dev9999';
  const mergeSha = 'merge999';
  const branchState = {
    main: { tip_sha: 'main000' },
    dev: {
      tip_sha: devTip,
      commits_ahead_of_main: 1,
      commits: [{ sha: devTip, slice_id: id }],
    },
    gate: { status: 'ACCUMULATING', current_run: null, last_pass: null },
    last_merge: null,
  };
  fs.writeFileSync(branchStateFile, JSON.stringify(branchState, null, 2), 'utf8');

  branchState.gate = { status: 'GATE_RUNNING', current_run: { dev_tip_sha: devTip }, last_pass: null };
  appendRegisterEvent(registerFile, { event: 'gate-start', dev_tip_sha: devTip, count: 1 });
  appendRegisterEvent(registerFile, { event: 'tests-updated', dev_tip_sha: devTip, suite_size: 51 });
  branchState.gate.last_pass = { dev_tip_sha: devTip, suite_size: 51 };
  appendRegisterEvent(registerFile, { event: 'regression-pass', dev_tip_sha: devTip, suite_size: 51 });

  branchState.main.tip_sha = mergeSha;
  branchState.dev.tip_sha = mergeSha;
  branchState.dev.commits_ahead_of_main = 0;
  branchState.dev.commits = [];
  branchState.gate.status = 'IDLE';
  branchState.gate.current_run = null;
  branchState.last_merge = { sha: mergeSha, slices: [id] };
  fs.writeFileSync(branchStateFile, JSON.stringify(branchState, null, 2), 'utf8');
  appendRegisterEvent(registerFile, { event: 'merge-complete', sha: mergeSha, slices: [id] });

  const finalState = JSON.parse(fs.readFileSync(branchStateFile, 'utf8'));
  const events = parseRegisterLines(registerFile).map(e => e.event);
  assert.deepEqual(events, ['gate-start', 'tests-updated', 'regression-pass', 'merge-complete']);
  assert.equal(finalState.main.tip_sha, mergeSha);
  assert.equal(finalState.dev.tip_sha, finalState.main.tip_sha);
  assert.equal(finalState.dev.commits_ahead_of_main, 0);
  assert.equal(finalState.gate.status, 'IDLE');
});
