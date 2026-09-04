'use strict';

/**
 * Journey: J-finished-slice-not-redispatched
 * Category: Dispatch & Execution
 *
 * What this tests:
 *   A slice that has already landed is never commissioned again.
 *
 *   On 2026-09-02 slice 366 was reviewed, squashed onto the integration branch and
 *   archived at 16:11:51 — then re-dispatched at 16:13:58 from a QUEUED file the
 *   archival had left behind. The re-run crashed, and its ERROR replaced the
 *   slice's real outcome: a merged slice displayed as failed. A leftover queue file
 *   is debris, not an instruction.
 *
 *   The refusal is keyed on a terminal LANDED event — merged, squashed, archived —
 *   and never on "have I seen this id before", because the pipeline reuses ids on
 *   purpose: a Nog rejection re-queues the same id for another round, and a
 *   restaged slice reuses its id outright. Both must still dispatch.
 *
 * Guards:
 *   slice-372-ac-3 — a landed slice is refused, its stale queue file cleared, the
 *                    refusal logged rather than swallowed
 *   slice-372-ac-4 — a review rejection round and a restaged slice still dispatch
 */

//
// @ac-hash: slice-372-ac-3 sha256:d55029bf3e943d6c4d89ec20ac6897bea3eab8245ef4d03d178b7d3f3749db49
// @ac-hash: slice-372-ac-4 sha256:4ed6a16ee6649ff661450fb62bdf0e93b79166d327c4de704915b6ac0ce5d420

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { makeTmpDir, removeTmpDir } = require('../helpers/tmp-dir');

const ORCHESTRATOR_SRC = path.resolve(__dirname, '..', '..', 'bridge', 'orchestrator.js');
const orchestrator = require('../../bridge/orchestrator');
const { hasTerminalLandedEvent } = orchestrator;

// Write a register fixture and ask the real predicate about it.
function withRegister(lines, fn) {
  const tmp = makeTmpDir('j-finished-slice');
  try {
    const regFile = path.join(tmp, 'register.jsonl');
    fs.writeFileSync(regFile, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
    return fn(regFile, tmp);
  } finally {
    removeTmpDir(tmp);
  }
}

const ev = (slice_id, event, ts, extra) => Object.assign({ ts, slice_id, event }, extra || {});

// ---------------------------------------------------------------------------
// slice-372-ac-3 — a landed slice is refused
// ---------------------------------------------------------------------------

test('slice-372-ac-3 a merged slice is recognised as finished', () => {
  withRegister([
    ev('366', 'COMMISSIONED', '2026-09-02T14:57:25.104Z'),
    ev('366', 'NOG_DECISION', '2026-09-02T16:11:40.000Z', { verdict: 'ACCEPTED', round: 1 }),
    ev('366', 'MERGED', '2026-09-02T16:11:51.000Z', { branch: 'slice/366' }),
  ], (regFile) => {
    assert.equal(hasTerminalLandedEvent('366', regFile), 'MERGED');
  });
});

test('slice-372-ac-3 a squashed-to-dev slice is recognised as finished', () => {
  withRegister([
    ev('366', 'SLICE_SQUASHED_TO_DEV', '2026-09-02T16:11:51.000Z', { branch: 'slice/366' }),
  ], (regFile) => {
    assert.equal(hasTerminalLandedEvent('366', regFile), 'SLICE_SQUASHED_TO_DEV');
  });
});

test('slice-372-ac-3 an archived slice is recognised as finished', () => {
  withRegister([
    ev('366', 'ARCHIVED', '2026-09-02T16:11:51.000Z', { branch: 'slice/366' }),
  ], (regFile) => {
    assert.equal(hasTerminalLandedEvent('366', regFile), 'ARCHIVED');
  });
});

test('slice-372-ac-3 the dispatch loop refuses, clears the file, and logs the refusal', () => {
  const src = fs.readFileSync(ORCHESTRATOR_SRC, 'utf8');

  // Locate the finished-slice gate inside the candidate-selection loop.
  const gateIdx = src.indexOf('const landedEvent = hasTerminalLandedEvent(candId);');
  assert.ok(gateIdx > 0, 'the dispatch loop must consult hasTerminalLandedEvent before commissioning');
  // Wide enough to reach the `continue` at the end of the gate — the block grew
  // when the refusal gained its once-per-process guard.
  const gate = src.slice(gateIdx, gateIdx + 2600);

  assert.ok(/fs\.renameSync\(candPath,\s*cleared\)/.test(gate),
    'the stale queue file must be cleared, not left to be picked up again next tick');
  assert.ok(gate.includes('TRASH_DIR'),
    'the cleared file must go to trash — it is a record, not garbage');
  assert.ok(/log\(clearedOk \? 'warn' : 'error', 'dispatch'/.test(gate),
    'a skipped dispatch must be visible in the log, not silent — and louder still when its file could not be cleared');
  assert.ok(gate.includes("'SLICE_DISPATCH_REFUSED'"),
    'the refusal must be a register event so the operator can see it after the fact');
  assert.ok(gate.includes('print('),
    'the refusal must print to the operator console');
  assert.ok(/\bcontinue;/.test(gate),
    'a refused candidate must not block the slices behind it');

  // The gate must run BEFORE the slice is renamed to IN_PROGRESS and commissioned.
  const commissionIdx = src.indexOf('registerCommissioned(id, { title, goal, body: sliceContent });');
  assert.ok(commissionIdx > gateIdx,
    'the refusal must come before commissioning, not after');
});

// ---------------------------------------------------------------------------
// slice-372-ac-4 — legitimate re-entry paths still dispatch
// ---------------------------------------------------------------------------

test('slice-372-ac-4 a Nog rejection round is not treated as finished', () => {
  withRegister([
    ev('366', 'COMMISSIONED', '2026-09-02T14:00:00.000Z'),
    ev('366', 'NOG_INVOKED', '2026-09-02T15:00:00.000Z', { round: 1 }),
    ev('366', 'NOG_DECISION', '2026-09-02T15:05:00.000Z', { verdict: 'REJECTED', round: 1 }),
  ], (regFile) => {
    assert.equal(hasTerminalLandedEvent('366', regFile), null,
      'a rejection re-queues the same id for another round — it must still dispatch');
  });
});

test('slice-372-ac-4 an unreadable verdict is not treated as finished', () => {
  withRegister([
    ev('366', 'NOG_DECISION', '2026-09-02T15:05:00.000Z',
      { verdict: 'REJECTED', reason: 'verdict_unreadable', round: 1 }),
  ], (regFile) => {
    assert.equal(hasTerminalLandedEvent('366', regFile), null);
  });
});

test('slice-372-ac-4 a restaged slice dispatches again even though its id once merged', () => {
  withRegister([
    ev('366', 'MERGED', '2026-09-02T16:11:51.000Z', { branch: 'slice/366' }),
    ev('366', 'ARCHIVED', '2026-09-02T16:11:52.000Z', { branch: 'slice/366' }),
    // Philipp deliberately restages the id for a fresh run.
    ev('366', 'RESTAGED', '2026-09-02T17:00:00.000Z'),
  ], (regFile) => {
    assert.equal(hasTerminalLandedEvent('366', regFile), null,
      'RESTAGED is a cutoff — a restaged slice starts a new life for that id');
  });
});

test('slice-372-ac-4 a slice that merged AFTER its last restage is finished again', () => {
  withRegister([
    ev('366', 'MERGED', '2026-09-02T16:11:51.000Z'),
    ev('366', 'RESTAGED', '2026-09-02T17:00:00.000Z'),
    ev('366', 'MERGED', '2026-09-02T18:30:00.000Z'),
  ], (regFile) => {
    assert.equal(hasTerminalLandedEvent('366', regFile), 'MERGED',
      'the cutoff must not permanently exempt a restaged id from the refusal');
  });
});

test('slice-372-ac-4 another slice\'s landing never blocks this one', () => {
  withRegister([
    ev('365', 'MERGED', '2026-09-02T16:11:51.000Z'),
    ev('366', 'COMMISSIONED', '2026-09-02T16:20:00.000Z'),
  ], (regFile) => {
    assert.equal(hasTerminalLandedEvent('366', regFile), null);
  });
});

test('slice-372-ac-4 a slice with no register history at all dispatches', () => {
  withRegister([
    ev('001', 'COMMISSIONED', '2026-09-02T10:00:00.000Z'),
  ], (regFile) => {
    assert.equal(hasTerminalLandedEvent('372', regFile), null,
      'a brand-new slice must never be refused');
  });
});

// ---------------------------------------------------------------------------
// slice-372-ac-3 — a refusal that cannot clear its file must not spin
// ---------------------------------------------------------------------------

test('slice-372-ac-3 a refusal whose file cannot be cleared is announced once, not once per poll', () => {
  const src = fs.readFileSync(ORCHESTRATOR_SRC, 'utf8');
  const gateIdx = src.indexOf('const landedEvent = hasTerminalLandedEvent(candId);');
  const gate = src.slice(gateIdx, gateIdx + 2600);

  // A failed renameSync leaves the file QUEUED, so the next poll refuses it again.
  // Unguarded, that is the same unbounded-event shape the retry cap below fixes:
  // slice 366 logged 297 verdict_unreadable events at one every ten seconds.
  assert.ok(/_refusalEmitted\.has\(candId\)/.test(gate),
    'the refusal must be deduped per slice per process, the way SLICE_DISPATCH_DEFERRED is');
  assert.ok(/_refusalEmitted\.add\(candId\)/.test(gate));
  assert.ok(/if \(firstRefusal\)/.test(gate),
    'the register event, the log line and the console print must all sit behind the guard');

  // …and a clear that failed is an operator problem, not routine bookkeeping.
  assert.ok(/clearedOk \? 'warn' : 'error'/.test(gate),
    'a stale queue file that cannot be moved aside must be logged at error level');
  assert.ok(/clear_error/.test(gate),
    'the reason the clear failed must be recorded, not swallowed');
});

test('slice-372-ac-3 the refusal dedupe set is per slice, not global', () => {
  orchestrator._testResetRefusalEmitted();
  const seen = orchestrator._testGetRefusalEmitted();
  assert.equal(seen.size, 0, 'the reset hook must actually clear it');

  seen.add('366');
  assert.ok(seen.has('366'));
  assert.ok(!seen.has('372'),
    'one slice being refused must never silence the refusal of another');
  orchestrator._testResetRefusalEmitted();
});
