'use strict';

/**
 * Journey: J-queue-detail-controls
 * Category: Authoring & Staging
 *
 * What this tests:
 *   A queued slice can be managed from the Ops detail overlay without losing
 *   frontmatter or leaving stale queue-order entries. These tests mirror the
 *   user-visible file movements behind Save edits, Un-approve, Return to
 *   O'Brien, Remove from queue, and active-slice race protection.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { makeTmpDir, removeTmpDir } = require('../helpers/tmp-dir');
const { buildSliceFile } = require('../helpers/slice-factory');
const { parseFrontmatter, readQueueOrder, writeQueueOrder } = require('../helpers/pipeline-logic');
const { appendRegisterEvent, assertEventExists, initRegisterFile, parseRegisterLines } = require('../helpers/register-helper');

let tmpDir;
let stagedDir;
let queueDir;
let trashDir;
let registerFile;
let queueOrderFile;
let stagedOrderFile;
let heartbeatFile;

beforeEach(() => {
  tmpDir = makeTmpDir('j-queue-detail-controls');
  stagedDir = path.join(tmpDir, 'staged');
  queueDir = path.join(tmpDir, 'queue');
  trashDir = path.join(tmpDir, 'trash');
  registerFile = path.join(tmpDir, 'register.jsonl');
  queueOrderFile = path.join(tmpDir, 'queue-order.json');
  stagedOrderFile = path.join(tmpDir, 'staged-order.json');
  heartbeatFile = path.join(tmpDir, 'heartbeat.json');

  for (const dir of [stagedDir, queueDir, trashDir]) fs.mkdirSync(dir, { recursive: true });
  initRegisterFile(registerFile);
  writeQueueOrder(queueOrderFile, []);
  fs.writeFileSync(stagedOrderFile, '[]\n', 'utf8');
  fs.writeFileSync(heartbeatFile, JSON.stringify({ current_slice: null }, null, 2), 'utf8');
});

afterEach(() => removeTmpDir(tmpDir));

function writeQueued(id, overrides = {}) {
  const content = buildSliceFile({
    id,
    title: `Queue detail ${id}`,
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

function readJsonArray(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonArray(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
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
  assert.notEqual(fmEnd, -1, 'frontmatter must have a closing delimiter');
  fs.writeFileSync(filePath, lines.slice(0, fmEnd + 1).join('\n') + '\n\n' + body, 'utf8');
}

function updateFrontmatter(content, fields) {
  let updated = content;
  for (const [key, value] of Object.entries(fields)) {
    const line = `${key}: "${String(value).replace(/"/g, '\\"')}"`;
    if (new RegExp(`^${key}:`, 'm').test(updated)) {
      updated = updated.replace(new RegExp(`^${key}:.*$`, 'm'), line);
    } else {
      updated = updated.replace(/^---\n/, `---\n${line}\n`);
    }
  }
  return updated;
}

function heartbeatOwns(id) {
  const hb = JSON.parse(fs.readFileSync(heartbeatFile, 'utf8'));
  return String(hb.current_slice || '') === String(id);
}

function assertNotActive(id) {
  if (heartbeatOwns(id)) {
    const err = new Error('already-picked-up');
    err.status = 409;
    throw err;
  }
}

function removeFromQueueOrder(id) {
  writeQueueOrder(queueOrderFile, readQueueOrder(queueOrderFile).filter(oid => oid !== id));
}

function appendStagedOrder(id) {
  const order = readJsonArray(stagedOrderFile);
  if (!order.includes(id)) order.push(id);
  writeJsonArray(stagedOrderFile, order);
}

function unapproveQueued(id) {
  assertNotActive(id);
  const queuedPath = path.join(queueDir, `${id}-QUEUED.md`);
  const content = updateFrontmatter(fs.readFileSync(queuedPath, 'utf8'), { status: 'STAGED' });
  fs.writeFileSync(path.join(stagedDir, `${id}-STAGED.md`), content, 'utf8');
  fs.unlinkSync(queuedPath);
  removeFromQueueOrder(id);
  appendStagedOrder(id);
  appendRegisterEvent(registerFile, { event: 'slice-unapproved', slice_id: id, source: 'dashboard' });
}

function returnToObrien(id, note) {
  assertNotActive(id);
  const queuedPath = path.join(queueDir, `${id}-QUEUED.md`);
  const content = updateFrontmatter(fs.readFileSync(queuedPath, 'utf8'), {
    status: 'NEEDS_APENDMENT',
    apendment_note: note,
  });
  fs.writeFileSync(path.join(stagedDir, `${id}-NEEDS_APENDMENT.md`), content, 'utf8');
  fs.renameSync(queuedPath, path.join(trashDir, `${id}-QUEUED.md.returned-to-stage-fixture`));
  removeFromQueueOrder(id);
  appendStagedOrder(id);
  appendRegisterEvent(registerFile, { event: 'returned_to_stage', slice_id: id, source: 'dashboard', note });
}

function removeQueued(id) {
  assertNotActive(id);
  const queuedPath = path.join(queueDir, `${id}-QUEUED.md`);
  fs.renameSync(queuedPath, path.join(trashDir, `${id}-QUEUED.md.removed-fixture`));
  removeFromQueueOrder(id);
  appendRegisterEvent(registerFile, { event: 'slice-archived-from-queue', slice_id: id, reason: 'user-removed' });
}

test('J-queue-detail-controls slice-060-ac-1 — save edits preserves frontmatter and updates only body', () => {
  const id = '060';
  const filePath = writeQueued(id, { depends_on: '042' });

  replaceBodyPreservingFrontmatter(filePath, '## Goal\n\nUpdated by operator before dispatch.\n');

  const updated = fs.readFileSync(filePath, 'utf8');
  const meta = parseFrontmatter(updated);
  assert.equal(meta.id, id);
  assert.equal(meta.from, 'obrien');
  assert.equal(meta.to, 'rom');
  assert.equal(meta.status, 'QUEUED');
  assert.equal(meta.depends_on, '042');
  assert.match(updated, /Updated by operator before dispatch/);
  assert.doesNotMatch(updated, /Regression fixture slice used by the e2e journey suite/);
});

test('J-queue-detail-controls slice-061-ac-2 — unapprove returns queued slice to staged and updates order/register', () => {
  const id = '061';
  writeQueued(id);

  unapproveQueued(id);

  assert.equal(fs.existsSync(path.join(queueDir, `${id}-QUEUED.md`)), false);
  const stagedPath = path.join(stagedDir, `${id}-STAGED.md`);
  assert.equal(fs.existsSync(stagedPath), true);
  assert.equal(parseFrontmatter(fs.readFileSync(stagedPath, 'utf8')).status, 'STAGED');
  assert.deepEqual(readQueueOrder(queueOrderFile), []);
  assert.deepEqual(readJsonArray(stagedOrderFile), [id]);
  assertEventExists(parseRegisterLines(registerFile), 'slice-unapproved', id);
});

test("J-queue-detail-controls slice-062-ac-3 — return to O'Brien creates NEEDS_APENDMENT staged slice", () => {
  const id = '062';
  writeQueued(id);

  returnToObrien(id, "Needs O'Brien rewrite");

  const stagedPath = path.join(stagedDir, `${id}-NEEDS_APENDMENT.md`);
  const meta = parseFrontmatter(fs.readFileSync(stagedPath, 'utf8'));
  assert.equal(meta.status, 'NEEDS_APENDMENT');
  assert.equal(meta.apendment_note, "Needs O'Brien rewrite");
  assert.deepEqual(readQueueOrder(queueOrderFile), []);
  assert.deepEqual(readJsonArray(stagedOrderFile), [id]);
  assert.ok(fs.existsSync(path.join(trashDir, `${id}-QUEUED.md.returned-to-stage-fixture`)));
  assertEventExists(parseRegisterLines(registerFile), 'returned_to_stage', id);
});

test('J-queue-detail-controls slice-063-ac-4 — remove from queue archives queued file and removes stale order entry', () => {
  const id = '063';
  writeQueued(id);

  removeQueued(id);

  assert.equal(fs.existsSync(path.join(queueDir, `${id}-QUEUED.md`)), false);
  assert.ok(fs.existsSync(path.join(trashDir, `${id}-QUEUED.md.removed-fixture`)));
  assert.deepEqual(readQueueOrder(queueOrderFile), []);
  // Order-file drift: a removed slice leaves the pipeline, so its id must
  // not linger in either order file.
  assert.deepEqual(readJsonArray(stagedOrderFile), []);
  assertEventExists(parseRegisterLines(registerFile), 'slice-archived-from-queue', id);
});

test('J-queue-detail-controls slice-064-ac-5 — active heartbeat blocks destructive queued-slice movement', () => {
  const id = '064';
  writeQueued(id);
  fs.writeFileSync(heartbeatFile, JSON.stringify({ current_slice: id }, null, 2), 'utf8');

  assert.throws(() => returnToObrien(id, 'Should not move'), /already-picked-up/);
  assert.throws(() => unapproveQueued(id), /already-picked-up/);
  assert.throws(() => removeQueued(id), /already-picked-up/);

  assert.equal(fs.existsSync(path.join(queueDir, `${id}-QUEUED.md`)), true);
  assert.equal(fs.existsSync(path.join(stagedDir, `${id}-NEEDS_APENDMENT.md`)), false);
  assert.equal(fs.existsSync(path.join(stagedDir, `${id}-STAGED.md`)), false);
  assert.deepEqual(readQueueOrder(queueOrderFile), [id]);
  // Order-file drift: the blocked slice stays exactly where it was — present
  // in queue-order, absent from staged-order.
  assert.deepEqual(readJsonArray(stagedOrderFile), []);
  assert.deepEqual(parseRegisterLines(registerFile), []);
});
