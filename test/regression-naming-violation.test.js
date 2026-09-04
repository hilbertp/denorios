'use strict';

/**
 * regression-naming-violation.test.js — Slice 268
 *
 * Verifies that when a failing test doesn't follow the slice-<id>-ac-<index>
 * naming convention:
 *   1. Fallback payload: slice_id = "unknown", ac_index = -1
 *   2. BASHIR_TEST_NAMING_VIOLATION register event is emitted
 *   3. Pipeline does NOT block — regression-fail still emits normally
 *
 * Run: node test/regression-naming-violation.test.js
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
const TEST_REGISTER = path.resolve(__dirname, '..', 'bridge', 'state', 'test-register-268-naming.jsonl');
const MAIN_REGISTER = path.resolve(__dirname, '..', 'bridge', 'register.jsonl');

const telemetry = require('../bridge/state/gate-telemetry');
telemetry.setRegisterPath(TEST_REGISTER);

const { writeJsonAtomic } = require('../bridge/state/atomic-write');

// branch-state.json is untracked runtime state (slice 372) — a fresh clone has none.
require('../bridge/state/seed-runtime-state').ensureRuntimeState();
const originalBranchState = fs.readFileSync(BRANCH_STATE_PATH, 'utf-8');
let originalMainRegister = '';
try { originalMainRegister = fs.readFileSync(MAIN_REGISTER, 'utf-8'); } catch (_) {}

function readTelemetryEvents() {
  try {
    return fs.readFileSync(TEST_REGISTER, 'utf-8')
      .trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch (_) { return []; }
}

function readMainRegister() {
  try {
    return fs.readFileSync(MAIN_REGISTER, 'utf-8')
      .trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch (_) { return []; }
}

function cleanup() {
  try { fs.unlinkSync(TEST_REGISTER); } catch (_) {}
  try { fs.unlinkSync(MUTEX_PATH); } catch (_) {}
  try { fs.writeFileSync(BRANCH_STATE_PATH, originalBranchState, 'utf-8'); } catch (_) {}
  try { fs.writeFileSync(MAIN_REGISTER, originalMainRegister, 'utf-8'); } catch (_) {}
}

const ctx = {
  registerEvent: () => {},
  log: () => {},
};

const orchestrator = require('../bridge/orchestrator');

// Redirect orchestrator's register file to main register so we can capture
// registerEvent calls (BASHIR_TEST_NAMING_VIOLATION goes through registerEvent,
// not gate-telemetry)
orchestrator._testSetRegisterFile(MAIN_REGISTER);

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

console.log('\nregression-naming-violation.test.js');
console.log('\u2500'.repeat(50));

test('_parseFailedAcs flags naming violation for non-convention test', () => {
  const output = [
    '\u2716 some test without proper naming (0.5ms)',
    '  Error: expected true',
  ].join('\n');

  const { failedAcs, hasNamingViolation } = orchestrator._parseFailedAcs(output);
  assert.strictEqual(failedAcs.length, 1);
  assert.strictEqual(failedAcs[0].slice_id, 'unknown');
  assert.strictEqual(failedAcs[0].ac_index, -1);
  assert.strictEqual(hasNamingViolation, true);
});

test('_parseFailedAcs handles mix of convention and non-convention', () => {
  const output = [
    '\u2716 slice-10-ac-0 proper test (0.3ms)',
    '  Error: fails',
    '\u2716 badly named test (0.2ms)',
    '  Error: also fails',
  ].join('\n');

  const { failedAcs, hasNamingViolation } = orchestrator._parseFailedAcs(output);
  assert.strictEqual(failedAcs.length, 2);
  assert.strictEqual(failedAcs[0].slice_id, '10');
  assert.strictEqual(failedAcs[0].ac_index, 0);
  assert.strictEqual(failedAcs[1].slice_id, 'unknown');
  assert.strictEqual(failedAcs[1].ac_index, -1);
  assert.strictEqual(hasNamingViolation, true);
});

// ---------------------------------------------------------------------------
// Integration: naming-violation emits BASHIR_TEST_NAMING_VIOLATION event
// ---------------------------------------------------------------------------

test('naming-violation emits register event + regression-fail still fires', (done) => {
  cleanup();

  // Create a synthetic suite with a badly-named failing test
  const suiteDir = path.resolve(__dirname, '..', 'regression', '_test_naming_suite');
  fs.mkdirSync(suiteDir, { recursive: true });
  fs.writeFileSync(path.join(suiteDir, 'badname.test.js'),
    `const { test } = require('node:test');
const assert = require('assert');
test('this test has no convention name and fails', () => { assert.strictEqual(1, 2); });
`, 'utf-8');

  // Set up mutex + branch state
  writeJsonAtomic(MUTEX_PATH, {
    schema_version: 1,
    started_ts: new Date().toISOString(),
    dev_tip_sha: 'namingtest000',
    bashir_pid: null,
    bashir_heartbeat_path: null,
  });

  const state = JSON.parse(originalBranchState);
  state.gate = { status: 'GATE_RUNNING', current_run: { started_ts: new Date().toISOString() } };
  writeJsonAtomic(BRANCH_STATE_PATH, state);

  // Mark the register position before the test
  const beforeLen = readMainRegister().length;

  orchestrator._gateTestsUpdated('namingtest000', ctx);

  // Poll for telemetry
  let attempts = 0;
  const poll = setInterval(() => {
    attempts++;
    const events = readTelemetryEvents();
    const failEvent = events.find(e => e.event === 'regression-fail');
    if (failEvent) {
      clearInterval(poll);

      // Check failEvent has unknown fallback
      const unknown = failEvent.failed_acs.find(a => a.slice_id === 'unknown');
      assert.ok(unknown, 'Should have fallback entry with slice_id=unknown');
      assert.strictEqual(unknown.ac_index, -1);

      // Check BASHIR_TEST_NAMING_VIOLATION in main register
      const allRegEvents = readMainRegister();
      const newEvents = allRegEvents.slice(beforeLen);
      const violation = newEvents.find(e => e.event === 'BASHIR_TEST_NAMING_VIOLATION');
      assert.ok(violation, 'BASHIR_TEST_NAMING_VIOLATION should be emitted via registerEvent');

      // Pipeline did not block — regression-fail fired
      assert.ok(failEvent, 'regression-fail should still emit despite naming violation');

      // Verify mutex released (pipeline not blocked)
      assert.ok(!fs.existsSync(MUTEX_PATH), 'Mutex should be released');

      // Cleanup
      try { fs.unlinkSync(path.join(suiteDir, 'badname.test.js')); } catch (_) {}
      try { fs.rmdirSync(suiteDir); } catch (_) {}
      cleanup();

      passed++;
      console.log('  \u2713 naming-violation: fallback payload + register event + pipeline continues');
      report();
      return;
    }
    if (attempts > 60) {
      clearInterval(poll);
      try { fs.unlinkSync(path.join(suiteDir, 'badname.test.js')); } catch (_) {}
      try { fs.rmdirSync(suiteDir); } catch (_) {}
      cleanup();

      failed++;
      console.log('  \u2717 naming-violation: timed out waiting for event');
      report();
    }
  }, 500);
});

// Decrement for async test
passed--;

function report() {
  // Restore register file path
  orchestrator._testSetRegisterFile(path.resolve(__dirname, '..', 'bridge', 'register.jsonl'));
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}
