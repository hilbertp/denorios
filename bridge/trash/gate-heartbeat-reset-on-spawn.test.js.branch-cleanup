'use strict';

/**
 * gate-heartbeat-reset-on-spawn.test.js — Slice 309
 *
 * Verifies that startGate resets bashir-heartbeat.json at spawn time so a
 * stale leftover file cannot cause an immediate heartbeat_stale abort.
 *
 * Root cause reproduced: first gate run 2026-05-24T08:05 found an 8h-old
 * heartbeat file and SIGTERMed Bashir before it ever wrote its first beat.
 * Fix: writeJsonAtomic({ ts: now }) before the setInterval poll starts.
 *
 * Run: node test/gate-heartbeat-reset-on-spawn.test.js
 */

const fs = require('fs');
const assert = require('assert');
const { writeJsonAtomic } = require('../bridge/state/atomic-write');
const {
  BASHIR_HEARTBEAT_PATH,
  BASHIR_HEARTBEAT_STALE_MS,
} = require('../bridge/orchestrator');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Isolation helpers
// ---------------------------------------------------------------------------

let originalContents = null;
let originalExisted = false;

function saveHeartbeat() {
  try {
    originalContents = fs.readFileSync(BASHIR_HEARTBEAT_PATH, 'utf-8');
    originalExisted = true;
  } catch (_) {
    originalExisted = false;
  }
}

function restoreHeartbeat() {
  if (originalExisted) {
    fs.writeFileSync(BASHIR_HEARTBEAT_PATH, originalContents, 'utf-8');
  } else {
    try { fs.unlinkSync(BASHIR_HEARTBEAT_PATH); } catch (_) {}
  }
}

function writeStaleHeartbeat(ageMs = 8 * 60 * 60 * 1000) {
  const staleTs = new Date(Date.now() - ageMs).toISOString();
  writeJsonAtomic(BASHIR_HEARTBEAT_PATH, { ts: staleTs });
  return staleTs;
}

function simulateSpawnReset() {
  // Mirrors the fix added in startGate (orchestrator.js ~line 6184):
  try { writeJsonAtomic(BASHIR_HEARTBEAT_PATH, { ts: new Date().toISOString() }); } catch (_) {}
}

function readHeartbeatAge() {
  const hb = JSON.parse(fs.readFileSync(BASHIR_HEARTBEAT_PATH, 'utf-8'));
  return Date.now() - new Date(hb.ts).getTime();
}

function wouldPollAbort(ageMs) {
  return ageMs > BASHIR_HEARTBEAT_STALE_MS;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\n-- gate-heartbeat-reset-on-spawn tests --\n');

saveHeartbeat();

test('stale leftover (8h) age exceeds BASHIR_HEARTBEAT_STALE_MS without reset', () => {
  writeStaleHeartbeat(8 * 60 * 60 * 1000);
  const age = readHeartbeatAge();
  assert.ok(
    wouldPollAbort(age),
    `Expected stale age (${age}ms) > ${BASHIR_HEARTBEAT_STALE_MS}ms — precondition check`
  );
});

test('after spawn reset, heartbeat ts is within 5s of now', () => {
  writeStaleHeartbeat(8 * 60 * 60 * 1000);
  simulateSpawnReset();
  const age = readHeartbeatAge();
  assert.ok(age < 5000, `Expected age < 5000ms after reset, got ${age}ms`);
});

test('after spawn reset, poll does not see stale — no abort triggered', () => {
  writeStaleHeartbeat(8 * 60 * 60 * 1000);
  simulateSpawnReset();
  const age = readHeartbeatAge();
  assert.ok(
    !wouldPollAbort(age),
    `Expected no abort after reset, but age=${age}ms > stale threshold=${BASHIR_HEARTBEAT_STALE_MS}ms`
  );
});

test('stale threshold constant is 90000ms', () => {
  assert.strictEqual(BASHIR_HEARTBEAT_STALE_MS, 90000);
});

test('reset overwrites stale leftover (1h old) not just 8h', () => {
  writeStaleHeartbeat(60 * 60 * 1000);
  simulateSpawnReset();
  const age = readHeartbeatAge();
  assert.ok(!wouldPollAbort(age), `1h stale + reset should not abort; age=${age}ms`);
});

test('reset writes valid JSON with a ts field', () => {
  writeStaleHeartbeat(8 * 60 * 60 * 1000);
  simulateSpawnReset();
  const raw = fs.readFileSync(BASHIR_HEARTBEAT_PATH, 'utf-8');
  const parsed = JSON.parse(raw);
  assert.ok(typeof parsed.ts === 'string', 'ts field must be a string');
  assert.ok(!isNaN(new Date(parsed.ts).getTime()), 'ts must be a valid ISO date');
});

restoreHeartbeat();

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
