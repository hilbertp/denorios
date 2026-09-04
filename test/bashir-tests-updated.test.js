'use strict';

/**
 * bashir-tests-updated.test.js — Slice 267 (updated by slice 268)
 *
 * Tests that the orchestrator transitions correctly when Bashir emits
 * the `tests-updated` event. Slice 268 replaced the placeholder
 * regression-fail with real suite execution, so the first 3 tests now
 * verify async suite-runner behavior:
 *   1. _gateTestsUpdated runs suite and emits regression-pass (no test files → exit 0)
 *   2. _gateTestsUpdated records last_pass in branch-state
 *   3. _gateTestsUpdated does NOT release mutex on pass
 *   4. _checkForEvent finds events after a given timestamp
 *
 * Run: node test/bashir-tests-updated.test.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    failed++;
    console.log(`  \u2717 ${name}`);
    console.log(`    ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Isolation
// ---------------------------------------------------------------------------

const BRANCH_STATE_PATH = path.resolve(__dirname, '..', 'bridge', 'state', 'branch-state.json');
const MUTEX_PATH = path.resolve(__dirname, '..', 'bridge', 'state', 'gate-running.json');
const REGISTER_PATH = path.resolve(__dirname, '..', 'bridge', 'register.jsonl');
const TEST_REGISTER = path.resolve(__dirname, '..', 'bridge', 'state', 'test-register-267-tu.jsonl');

const telemetry = require('../bridge/state/gate-telemetry');
telemetry.setRegisterPath(TEST_REGISTER);

const { writeJsonAtomic } = require('../bridge/state/atomic-write');

// branch-state.json is untracked runtime state (slice 372) — a fresh clone has none.
require('../bridge/state/seed-runtime-state').ensureRuntimeState();
const originalBranchState = fs.readFileSync(BRANCH_STATE_PATH, 'utf-8');

function readTelemetryEvents() {
  try {
    return fs.readFileSync(TEST_REGISTER, 'utf-8')
      .trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch (_) { return []; }
}

function cleanup() {
  try { fs.unlinkSync(MUTEX_PATH); } catch (_) {}
  try { fs.unlinkSync(TEST_REGISTER); } catch (_) {}
  fs.writeFileSync(BRANCH_STATE_PATH, originalBranchState, 'utf-8');
}

// ---------------------------------------------------------------------------
// Load module under test
// ---------------------------------------------------------------------------

const orchestrator = require('../bridge/orchestrator');

// Stub registerEvent and log for ctx
const logEntries = [];
const ctx = {
  registerEvent: () => {},
  log: (level, event, fields) => { logEntries.push({ level, event, fields }); },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\nbashir-tests-updated.test.js');
console.log('\u2500'.repeat(50));

test('_checkForEvent finds matching event after timestamp', () => {
  cleanup();

  const beforeTs = new Date().toISOString();

  // Write a test event to the test register
  telemetry.emit('tests-updated', { suite_size: 5, tests_added: 3, tests_updated: 0 });

  // Point _checkForEvent at our test register — it reads from bridge/register.jsonl by default
  // We need to write to the actual register path for this test
  const actualRegister = path.resolve(__dirname, '..', 'bridge', 'register.jsonl');
  let originalRegister = '';
  try { originalRegister = fs.readFileSync(actualRegister, 'utf-8'); } catch (_) {}

  // Append a tests-updated event
  const entry = JSON.stringify({ ts: new Date().toISOString(), event: 'tests-updated', suite_size: 5 });
  fs.appendFileSync(actualRegister, entry + '\n');

  const found = orchestrator._checkForEvent('tests-updated', beforeTs);
  assert.ok(found, 'Should find the event');
  assert.strictEqual(found.event, 'tests-updated');

  // Restore register
  fs.writeFileSync(actualRegister, originalRegister, 'utf-8');
});

test('_checkForEvent returns null for non-matching event', () => {
  cleanup();

  const futureTs = '2099-01-01T00:00:00.000Z';
  const found = orchestrator._checkForEvent('tests-updated', futureTs);
  assert.strictEqual(found, null, 'Should return null for future timestamp');
});

// ---------------------------------------------------------------------------
// Async test: _gateTestsUpdated runs suite (must be last — sync tests above
// call cleanup() which would delete the mutex while this polls).
// ---------------------------------------------------------------------------

// _gateTestsUpdated is now async (spawns node --test). With no regression
// test files, the runner exits 0 → regression-pass. We poll for the event.
(function asyncTest() {
  cleanup();

  writeJsonAtomic(MUTEX_PATH, {
    schema_version: 1,
    started_ts: new Date().toISOString(),
    dev_tip_sha: 'test123',
    bashir_pid: null,
    bashir_heartbeat_path: null,
  });

  const state = JSON.parse(originalBranchState);
  state.gate = { status: 'GATE_RUNNING', current_run: { started_ts: new Date().toISOString() } };
  writeJsonAtomic(BRANCH_STATE_PATH, state);

  orchestrator._gateTestsUpdated('test123', ctx);

  let attempts = 0;
  const poll = setInterval(() => {
    attempts++;
    const events = readTelemetryEvents();
    const passEvent = events.find(e => e.event === 'regression-pass');
    if (passEvent) {
      clearInterval(poll);

      try {
        assert.ok(typeof passEvent.suite_size === 'number', 'suite_size should be a number');
        assert.ok(typeof passEvent.duration_ms === 'number', 'duration_ms should be a number');

        // Branch-state should have last_pass set
        const bs = JSON.parse(fs.readFileSync(BRANCH_STATE_PATH, 'utf-8'));
        assert.ok(bs.gate.last_pass, 'last_pass should be set');
        assert.strictEqual(bs.gate.last_pass.dev_tip_sha, 'test123');

        // Mutex should NOT be released on pass
        assert.ok(fs.existsSync(MUTEX_PATH), 'Mutex should NOT be released on pass');

        passed++;
        console.log('  \u2713 regression-pass emitted, last_pass set, mutex held');
      } catch (err) {
        failed++;
        console.log('  \u2717 regression-pass assertions failed');
        console.log(`    ${err.message}`);
      }

      cleanup();
      try { fs.unlinkSync(MUTEX_PATH); } catch (_) {}
      report();
      return;
    }
    if (attempts > 60) {
      clearInterval(poll);
      cleanup();
      try { fs.unlinkSync(MUTEX_PATH); } catch (_) {}
      failed++;
      console.log('  \u2717 timed out waiting for regression-pass event');
      report();
    }
  }, 500);
})();

function report() {
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}
