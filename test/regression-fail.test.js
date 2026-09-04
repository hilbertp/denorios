'use strict';

/**
 * regression-fail.test.js — Slice 268
 *
 * Verifies that when the regression suite fails (exit non-zero), the orchestrator:
 *   1. Emits regression-fail with structured failed_acs
 *   2. Updates branch-state: gate.status = GATE_FAILED, last_failure populated
 *   3. Releases the mutex
 *
 * Run: node test/regression-fail.test.js
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
const TEST_REGISTER = path.resolve(__dirname, '..', 'bridge', 'state', 'test-register-268-fail.jsonl');

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
  try { fs.unlinkSync(TEST_REGISTER); } catch (_) {}
  try { fs.unlinkSync(MUTEX_PATH); } catch (_) {}
  try { fs.writeFileSync(BRANCH_STATE_PATH, originalBranchState, 'utf-8'); } catch (_) {}
}

const ctx = {
  registerEvent: () => {},
  log: () => {},
};

const orchestrator = require('../bridge/orchestrator');

// ---------------------------------------------------------------------------
// Unit tests for _parseFailedAcs
// ---------------------------------------------------------------------------

console.log('\nregression-fail.test.js');
console.log('\u2500'.repeat(50));

test('_parseFailedAcs extracts slice_id and ac_index from spec output', () => {
  const output = [
    '\u2714 slice-42-ac-0 widget initializes (0.5ms)',
    '\u2716 slice-42-ac-1 widget renders correctly (1.2ms)',
    '  Expected: true',
    '  Actual: false',
    '\u2714 slice-42-ac-2 widget loads data (0.3ms)',
    '\u2716 slice-43-ac-0 button click handler (0.8ms)',
    '  TypeError: undefined is not a function',
  ].join('\n');

  const { failedAcs, hasNamingViolation } = orchestrator._parseFailedAcs(output);
  assert.strictEqual(failedAcs.length, 2);
  assert.strictEqual(failedAcs[0].slice_id, '42');
  assert.strictEqual(failedAcs[0].ac_index, 1);
  assert.ok(failedAcs[0].failure_excerpt.includes('Expected'));
  assert.strictEqual(failedAcs[1].slice_id, '43');
  assert.strictEqual(failedAcs[1].ac_index, 0);
  assert.strictEqual(hasNamingViolation, false);
});

test('_parseFailedAcs handles empty output', () => {
  const { failedAcs, hasNamingViolation } = orchestrator._parseFailedAcs('');
  assert.strictEqual(failedAcs.length, 0);
  assert.strictEqual(hasNamingViolation, false);
});

// ---------------------------------------------------------------------------
// Integration: _gateTestsUpdated with a failing synthetic suite
// ---------------------------------------------------------------------------

test('regression-fail emits correct event, updates state, releases mutex', (done) => {
  cleanup();

  // Create a synthetic failing suite
  const suiteDir = path.resolve(__dirname, '..', 'regression', '_test_fail_suite');
  fs.mkdirSync(suiteDir, { recursive: true });
  fs.writeFileSync(path.join(suiteDir, 'fail.test.js'),
    `const { test } = require('node:test');
const assert = require('assert');
test('slice-55-ac-0 this test passes', () => { assert.ok(true); });
test('slice-55-ac-1 this test fails', () => { assert.strictEqual(1, 2); });
`, 'utf-8');

  // Set up mutex + branch state
  writeJsonAtomic(MUTEX_PATH, {
    schema_version: 1,
    started_ts: new Date().toISOString(),
    dev_tip_sha: 'failtest456',
    bashir_pid: null,
    bashir_heartbeat_path: null,
  });

  const state = JSON.parse(originalBranchState);
  state.gate = { status: 'GATE_RUNNING', current_run: { started_ts: new Date().toISOString() } };
  writeJsonAtomic(BRANCH_STATE_PATH, state);

  orchestrator._gateTestsUpdated('failtest456', ctx);

  // Poll for telemetry
  let attempts = 0;
  const poll = setInterval(() => {
    attempts++;
    const events = readTelemetryEvents();
    const failEvent = events.find(e => e.event === 'regression-fail');
    if (failEvent) {
      clearInterval(poll);

      assert.ok(Array.isArray(failEvent.failed_acs), 'failed_acs should be an array');
      // At least one failure with correct slice_id
      const ac55 = failEvent.failed_acs.find(a => a.slice_id === '55');
      assert.ok(ac55, 'Should find slice-55 in failed_acs');
      assert.strictEqual(ac55.ac_index, 1);

      // Verify branch-state
      const bsAfter = JSON.parse(fs.readFileSync(BRANCH_STATE_PATH, 'utf-8'));
      assert.strictEqual(bsAfter.gate.status, 'GATE_FAILED');
      assert.strictEqual(bsAfter.gate.current_run, null);
      assert.ok(bsAfter.gate.last_failure, 'last_failure should be set');
      assert.strictEqual(bsAfter.gate.last_failure.dev_tip_sha, 'failtest456');

      // Verify mutex released
      assert.ok(!fs.existsSync(MUTEX_PATH), 'Mutex should be released on fail');

      // Cleanup synthetic suite
      try { fs.unlinkSync(path.join(suiteDir, 'fail.test.js')); } catch (_) {}
      try { fs.rmdirSync(suiteDir); } catch (_) {}
      cleanup();

      passed++;
      console.log('  \u2713 regression-fail: correct event + GATE_FAILED + mutex released');
      report();
      return;
    }
    if (attempts > 60) {
      clearInterval(poll);
      try { fs.unlinkSync(path.join(suiteDir, 'fail.test.js')); } catch (_) {}
      try { fs.rmdirSync(suiteDir); } catch (_) {}
      cleanup();

      failed++;
      console.log('  \u2717 regression-fail: timed out waiting for event');
      report();
    }
  }, 500);
});

// Decrement for async test
passed--;

function report() {
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}
