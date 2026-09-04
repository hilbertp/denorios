'use strict';

/**
 * Journey: J-unreadable-verdict-retry-cap
 * Category: Review & Verdict
 *
 * What this tests:
 *   An unreadable Nog verdict retries a bounded number of times, waits between
 *   attempts, and then reaches a terminal state that names the reason.
 *
 *   The round counter only advances when Nog appends a "## Nog Review — Round N"
 *   heading to the parked slice — which is precisely what an unreadable verdict
 *   fails to do. So the existing MAX_ROUNDS guard, which only fires at the final
 *   round, was unreachable on this path: the retry re-queued the same round at the
 *   poll interval, forever. Slice 366 logged 297 verdict_unreadable events in a
 *   little over two hours; 798 exist across the register. What the operator saw
 *   was "the reviewer has been working for 71 minutes".
 *
 *   This cap sits WITHIN a round. It does not change how many review rounds a
 *   slice may have, and the final-round guard stays exactly as it was.
 *
 * Guards:
 *   slice-372-ac-5 — bounded retries, backoff between them, a named terminal state
 */

//
// @ac-hash: slice-372-ac-5 sha256:6276c065d9da3c28eb0b51fde8079fac09359383ff99bc4a911c4b9a9430c941

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { makeTmpDir, removeTmpDir } = require('../helpers/tmp-dir');

const ORCHESTRATOR_SRC = path.resolve(__dirname, '..', '..', 'bridge', 'orchestrator.js');
const orchestrator = require('../../bridge/orchestrator');
const {
  countUnreadableVerdicts,
  unreadableBackoffMs,
  retryBackoffElapsed,
  MAX_UNREADABLE_ATTEMPTS,
  UNREADABLE_BACKOFF_MS,
} = orchestrator;

function withRegister(lines, fn) {
  const tmp = makeTmpDir('j-unreadable-cap');
  try {
    const regFile = path.join(tmp, 'register.jsonl');
    fs.writeFileSync(regFile, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
    return fn(regFile, tmp);
  } finally {
    removeTmpDir(tmp);
  }
}

const unreadable = (slice_id, round, ts) => ({
  ts, slice_id, event: 'NOG_DECISION', verdict: 'REJECTED', reason: 'verdict_unreadable', round,
});

// A QUEUED slice file with an optional not_before backoff stamp.
function writeQueued(dir, id, notBefore) {
  const fm = [
    '---',
    `id: "${id}"`,
    'title: "A slice"',
    'from: obrien',
    'to: rom',
    'priority: high',
    'created: "2026-09-02T14:00:00.000Z"',
    'status: "QUEUED"',
  ];
  if (notBefore !== undefined) fm.push(`not_before: "${notBefore}"`);
  fm.push('---', '', '# Body', '');
  const p = path.join(dir, `${id}-QUEUED.md`);
  fs.writeFileSync(p, fm.join('\n'));
  return p;
}

// ---------------------------------------------------------------------------
// The cap is bounded and counted per round
// ---------------------------------------------------------------------------

test('slice-372-ac-5 the retry budget is a small fixed number', () => {
  assert.equal(typeof MAX_UNREADABLE_ATTEMPTS, 'number');
  assert.ok(MAX_UNREADABLE_ATTEMPTS >= 2 && MAX_UNREADABLE_ATTEMPTS <= 5,
    `the budget must be small — 297 retries is the bug being fixed, got ${MAX_UNREADABLE_ATTEMPTS}`);
});

test('slice-372-ac-5 unreadable verdicts are counted within their round', () => {
  withRegister([
    unreadable('366', 1, '2026-09-02T15:00:00.000Z'),
    unreadable('366', 1, '2026-09-02T15:00:10.000Z'),
    unreadable('366', 2, '2026-09-02T15:30:00.000Z'),
  ], (regFile) => {
    assert.equal(countUnreadableVerdicts('366', 1, regFile), 2);
    assert.equal(countUnreadableVerdicts('366', 2, regFile), 1,
      'a new round gets a fresh budget — the cap is within a round, not across them');
    assert.equal(countUnreadableVerdicts('366', 3, regFile), 0);
  });
});

test('slice-372-ac-5 only unreadable verdicts count toward the cap', () => {
  withRegister([
    { ts: '2026-09-02T15:00:00.000Z', slice_id: '366', event: 'NOG_DECISION', verdict: 'REJECTED', round: 1 },
    { ts: '2026-09-02T15:01:00.000Z', slice_id: '366', event: 'NOG_INVOKED', round: 1 },
    unreadable('366', 1, '2026-09-02T15:02:00.000Z'),
    unreadable('365', 1, '2026-09-02T15:03:00.000Z'),
  ], (regFile) => {
    assert.equal(countUnreadableVerdicts('366', 1, regFile), 1,
      'an ordinary rejection is a real verdict, not a failure to parse one');
  });
});

test('slice-372-ac-5 restaging clears the accumulated retry count', () => {
  withRegister([
    unreadable('366', 1, '2026-09-02T15:00:00.000Z'),
    unreadable('366', 1, '2026-09-02T15:00:10.000Z'),
    { ts: '2026-09-02T16:00:00.000Z', slice_id: '366', event: 'RESTAGED' },
    unreadable('366', 1, '2026-09-02T16:30:00.000Z'),
  ], (regFile) => {
    assert.equal(countUnreadableVerdicts('366', 1, regFile), 1,
      'a restaged slice must not inherit an exhausted budget');
  });
});

// ---------------------------------------------------------------------------
// Backoff between attempts
// ---------------------------------------------------------------------------

test('slice-372-ac-5 the delay between retries backs off and never runs off the end', () => {
  assert.ok(Array.isArray(UNREADABLE_BACKOFF_MS) && UNREADABLE_BACKOFF_MS.length > 0);
  assert.ok(unreadableBackoffMs(1) > 0, 'the first retry must wait — no immediate re-dispatch');

  for (let i = 1; i < UNREADABLE_BACKOFF_MS.length; i++) {
    assert.ok(UNREADABLE_BACKOFF_MS[i] > UNREADABLE_BACKOFF_MS[i - 1],
      'each wait must be longer than the last');
  }
  const last = UNREADABLE_BACKOFF_MS[UNREADABLE_BACKOFF_MS.length - 1];
  assert.equal(unreadableBackoffMs(UNREADABLE_BACKOFF_MS.length + 99), last,
    'the schedule must saturate rather than return undefined');

  // The bug was a retry every ~10 seconds. The floor has to be well above that.
  assert.ok(unreadableBackoffMs(1) >= 30000,
    `the first backoff must be substantial, got ${unreadableBackoffMs(1)}ms`);
});

test('slice-372-ac-5 a slice held by backoff is not dispatched until it is due', () => {
  const tmp = makeTmpDir('j-backoff-hold');
  try {
    const future = new Date(Date.now() + 120000).toISOString();
    assert.equal(retryBackoffElapsed(writeQueued(tmp, '372', future), '372'), false,
      'a slice still inside its backoff window must be held');

    const past = new Date(Date.now() - 1000).toISOString();
    assert.equal(retryBackoffElapsed(writeQueued(tmp, '373', past), '373'), true,
      'once the window elapses the slice must dispatch');
  } finally {
    removeTmpDir(tmp);
  }
});

test('slice-372-ac-5 backoff never delays a slice that carries no stamp', () => {
  const tmp = makeTmpDir('j-backoff-absent');
  try {
    assert.equal(retryBackoffElapsed(writeQueued(tmp, '372'), '372'), true,
      'an ordinary slice has no not_before and must dispatch immediately');
    assert.equal(retryBackoffElapsed(writeQueued(tmp, '373', 'null'), '373'), true,
      'a cleared stamp must not hold the slice');
    assert.equal(retryBackoffElapsed(writeQueued(tmp, '374', 'not-a-date'), '374'), true,
      'an unparseable stamp must fail open — never strand a slice on bad data');
    assert.equal(retryBackoffElapsed(path.join(tmp, 'missing-QUEUED.md'), '375'), true,
      'an unreadable file must fail open and let downstream validation handle it');
  } finally {
    removeTmpDir(tmp);
  }
});

// ---------------------------------------------------------------------------
// The terminal state, and the guard it must not disturb
// ---------------------------------------------------------------------------

test('slice-372-ac-5 exhausting the budget reaches a terminal state that names the reason', () => {
  const src = fs.readFileSync(ORCHESTRATOR_SRC, 'utf8');
  const capIdx = src.indexOf('if (unreadableAttempts >= MAX_UNREADABLE_ATTEMPTS) {');
  assert.ok(capIdx > 0, 'the unreadable path must cap its retries');
  const block = src.slice(capIdx, capIdx + 2200);

  assert.ok(block.includes("'VERDICT_UNREADABLE_EXHAUSTED'"),
    'the terminal state must be its own register event, distinguishable from MAX_ROUNDS');
  assert.ok(/reason:\s*`Nog returned an unreadable verdict/.test(block),
    'the event must carry a reason an operator can read');
  assert.ok(block.includes('-STUCK.md'),
    'the slice must end in STUCK, not linger as EVALUATING');
  assert.ok(block.includes("reason: 'verdict_unreadable_retry_cap'"),
    'the state transition must name why it happened — "reviewing" must be distinguishable from "looping"');
  assert.ok(block.includes('cleanupWorktree('),
    'the worktree must be released when the slice goes terminal');
  assert.ok(block.includes("heartbeatState.status = 'idle'"),
    'the pipeline must return to idle rather than showing an endless review');
});

test('slice-372-ac-5 the retry re-queue carries a backoff stamp', () => {
  const src = fs.readFileSync(ORCHESTRATOR_SRC, 'utf8');
  const capIdx = src.indexOf('if (unreadableAttempts >= MAX_UNREADABLE_ATTEMPTS) {');
  const tail = src.slice(capIdx, capIdx + 3600);

  assert.ok(/const backoffMs = unreadableBackoffMs\(unreadableAttempts\)/.test(tail),
    'the retry must compute its backoff from the attempts already made');
  assert.ok(/handleNogReturn\([^)]*notBefore\)/.test(tail),
    'the re-queue must carry the backoff stamp through to the QUEUED file');

  // handleNogReturn must write it into the frontmatter the dispatch loop reads —
  // and must clear it when there is none, so an ordinary return is not delayed.
  const hnr = src.slice(src.indexOf('function handleNogReturn('), src.indexOf('function handleNogReturn(') + 2600);
  assert.ok(/not_before: notBefore \? String\(notBefore\) : 'null'/.test(hnr),
    'not_before must always be written — an empty value clears a stale stamp');
});

test('slice-372-ac-5 the final-round MAX_ROUNDS guard is untouched', () => {
  const src = fs.readFileSync(ORCHESTRATOR_SRC, 'utf8');
  const guardIdx = src.indexOf('// ── MAX_ROUNDS guard (verdict_unreadable path) ──');
  assert.ok(guardIdx > 0, 'the final-round guard must still exist');
  const guard = src.slice(guardIdx, guardIdx + 900);
  assert.ok(guard.includes('if (round >= MAX_ROUNDS) {'),
    'the final-round condition must be unchanged');
  assert.ok(guard.includes("'MAX_ROUNDS_EXHAUSTED'"),
    'the final-round guard must still emit MAX_ROUNDS_EXHAUSTED');

  // And it must run FIRST: a slice at the final round is terminal outright, no retry.
  const capIdx = src.indexOf('if (unreadableAttempts >= MAX_UNREADABLE_ATTEMPTS) {');
  assert.ok(guardIdx < capIdx,
    'the final-round guard must be evaluated before the within-round cap');
});
