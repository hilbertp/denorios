'use strict';

/**
 * ensure-main-fresh.test.js — Slice 209, retargeted by slice 353
 *
 * Regression tests for the integration-branch refresh (ensureIntegrationIsFresh,
 * formerly ensureMainIsFresh). Holds the 209 push-not-reset fix (the 2026-04-24
 * main-rewind root cause) and adds slice 353's ref-move + post-condition guards.
 *
 * Tests:
 *   A — in sync: no push, no merge, no reset
 *   B — ahead only (3 commits): push invoked, no reset, push event emitted
 *   C — behind only (2 commits), HEAD on dev: merge --ff-only invoked, no push
 *   D — diverged (ahead 1, behind 1): throws Error, no mutations
 *   E — unlock/relock wrapping: marker appears before write op, gone after
 *   F — HEAD elsewhere: the ref is moved explicitly, HEAD is never merged
 *   G — false-success guard: a refresh that did not move the ref raises
 *
 * Run: node test/ensure-main-fresh.test.js
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const assert = require('assert');

const REPO_ROOT     = path.resolve(__dirname, '..');
const BRIDGE_DIR    = path.join(REPO_ROOT, 'bridge');
const MARKER_FILE   = path.join(BRIDGE_DIR, '.main-unlocked');
const LOCK_SCRIPT   = path.join(REPO_ROOT, 'scripts', 'lock-main.sh');
const UNLOCK_SCRIPT = path.join(REPO_ROOT, 'scripts', 'unlock-main.sh');

const gitFinalizer = require('../bridge/git-finalizer');
const { ensureIntegrationIsFresh, _testSetRegisterFile } = require('../bridge/orchestrator.js');

// ---------------------------------------------------------------------------
// Test harness
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
// Helpers
// ---------------------------------------------------------------------------

const TEMP_REG = path.join(os.tmpdir(), `ds9-209-test-register-${process.pid}.jsonl`);

function readRegEvents() {
  try {
    return fs.readFileSync(TEMP_REG, 'utf-8')
      .split('\n').filter(Boolean)
      .map(l => JSON.parse(l));
  } catch (_) {
    return [];
  }
}

function clearReg() {
  try { fs.unlinkSync(TEMP_REG); } catch (_) {}
}

// originalRunGit — saved so we can restore after each test
const originalRunGit = gitFinalizer.runGit;

/**
 * makeMockRunGit(responses)
 *
 * Returns a mock runGit that returns values from `responses` in order.
 * Each entry: { match: regex-or-string, returns: value }
 * If match is null, it's a catch-all.
 * Recorded calls are pushed to the `calls` array on the returned function.
 */
function makeMockRunGit(responses) {
  const calls = [];
  const mock = function mockRunGit(cmd, opts) {
    calls.push(cmd);
    for (const r of responses) {
      if (r.match == null || (typeof r.match === 'string' && cmd.includes(r.match)) ||
          (r.match instanceof RegExp && r.match.test(cmd))) {
        if (r.throws) throw new Error(r.throws);
        return r.returns !== undefined ? r.returns : '';
      }
    }
    return '';
  };
  mock.calls = calls;
  return mock;
}

// Ensure gitFinalizer has minimal init so internal references don't crash
// (registerEvent / log inside runGit are bypassed since we monkeypatch runGit itself)
gitFinalizer.init({
  PROJECT_DIR: REPO_ROOT,
  registerEvent: () => {},
  log: () => {},
  HEARTBEAT_FILE: path.join(BRIDGE_DIR, 'heartbeat.json'),
  QUEUE_DIR: path.join(BRIDGE_DIR, 'queue'),
});

// Redirect orchestrator's REGISTER_FILE to a temp path for all tests
_testSetRegisterFile(TEMP_REG);

// Clean marker state before suite
try { require('child_process').execSync(`bash "${LOCK_SCRIPT}"`, { cwd: REPO_ROOT, stdio: 'pipe' }); } catch (_) {}

// ---------------------------------------------------------------------------
// Test A — in sync: no write ops invoked
// ---------------------------------------------------------------------------

console.log('\nTest group: ensureIntegrationIsFresh (dev) push-not-reset\n');

// Slice 353: this function now refreshes the INTEGRATION branch (dev), not the
// trunk. Slices are cut from dev, so dev is the ref that must be fresh. The four
// cases (in-sync / ahead / behind / diverged) and the Layer-2 unlock-relock
// contract are unchanged; the branch and the post-conditions are not.

test('A: in sync — no push, no merge, no reset', () => {
  clearReg();
  const mock = makeMockRunGit([
    { match: 'fetch',                 returns: '' },
    { match: 'rev-parse origin/dev',  returns: 'abc123abc123\n' },
    { match: 'rev-parse dev',         returns: 'abc123abc123\n' },
    // No further calls expected — early return on local === remote
  ]);
  gitFinalizer.runGit = mock;
  try {
    ensureIntegrationIsFresh('test-a');
  } finally {
    gitFinalizer.runGit = originalRunGit;
  }

  const writeOps = mock.calls.filter(c =>
    c.includes('push') || c.includes('merge') || c.includes('reset') || c.includes('update-ref'));
  assert.strictEqual(writeOps.length, 0, `Expected no write ops, got: ${writeOps.join(', ')}`);
  const events = readRegEvents().filter(e => e.event === 'MAIN_PUSHED_TO_ORIGIN');
  assert.strictEqual(events.length, 0, 'No push event should be emitted on in-sync');
});

// ---------------------------------------------------------------------------
// Test B — ahead only: push invoked, no reset, push event emitted
// ---------------------------------------------------------------------------

test('B: ahead only (3 commits) — push invoked, no reset, push event emitted with ahead_count=3', () => {
  clearReg();
  // Stateful: origin only carries the local sha AFTER the push succeeds. That
  // ordering is the post-condition — re-reading the local ref would prove nothing.
  let originSha = 'abc123abc123\n';
  const calls = [];
  gitFinalizer.runGit = function (cmd) {
    calls.push(cmd);
    if (cmd.includes('rev-parse origin/dev'))             return originSha;
    if (cmd.includes('rev-parse dev'))                    return 'def456def456\n';
    if (cmd.includes('rev-list --count origin/dev..dev')) return '3\n';
    if (cmd.includes('rev-list --count dev..origin/dev')) return '0\n';
    if (cmd.includes('push origin dev')) { originSha = 'def456def456\n'; return ''; }
    return '';
  };
  try {
    ensureIntegrationIsFresh('test-b');
  } finally {
    gitFinalizer.runGit = originalRunGit;
    try { require('child_process').execSync(`bash "${LOCK_SCRIPT}"`, { cwd: REPO_ROOT, stdio: 'pipe' }); } catch (_) {}
  }

  assert.ok(calls.some(c => c.includes('push origin dev')), 'git push origin dev must be called');
  assert.ok(!calls.some(c => c.includes('reset')), 'git reset must NOT be called');
  assert.ok(!calls.some(c => c.includes('push origin main')), 'the trunk must NOT be pushed');
  const events = readRegEvents().filter(e => e.event === 'MAIN_PUSHED_TO_ORIGIN');
  assert.strictEqual(events.length, 1, 'Exactly one push event expected');
  assert.strictEqual(events[0].ahead_count, 3, 'ahead_count must be 3');
  assert.strictEqual(events[0].branch, 'dev', 'the event must name the branch that was pushed');
  assert.ok(events[0].sha, 'sha must be present');
});

// ---------------------------------------------------------------------------
// Test C — behind only, HEAD on dev: ff-merge moves ref + worktree together
// ---------------------------------------------------------------------------

test('C: behind only (2 commits), HEAD on dev — merge --ff-only invoked, no push', () => {
  clearReg();
  let devSha = 'abc123abc123\n';
  gitFinalizer.runGit = function (cmd) {
    gitFinalizer.runGit.calls.push(cmd);
    if (cmd.includes('rev-parse --abbrev-ref HEAD'))     return 'dev\n';
    if (cmd.includes('rev-parse origin/dev'))            return 'xyz789xyz789\n';
    if (cmd.includes('rev-parse dev'))                   return devSha;
    if (cmd.includes('rev-list --count origin/dev..dev')) return '0\n';
    if (cmd.includes('rev-list --count dev..origin/dev')) return '2\n';
    // The ff-merge is what actually moves the ref in this HEAD state.
    if (cmd.includes('merge --ff-only origin/dev')) { devSha = 'xyz789xyz789\n'; return ''; }
    return '';
  };
  gitFinalizer.runGit.calls = [];
  const calls = gitFinalizer.runGit.calls;

  try {
    ensureIntegrationIsFresh('test-c');
  } finally {
    gitFinalizer.runGit = originalRunGit;
    try { require('child_process').execSync(`bash "${LOCK_SCRIPT}"`, { cwd: REPO_ROOT, stdio: 'pipe' }); } catch (_) {}
  }

  assert.ok(calls.some(c => c.includes('merge --ff-only origin/dev')), 'merge --ff-only must be called');
  assert.ok(!calls.some(c => c.includes('push')), 'git push must NOT be called');
  assert.ok(!calls.some(c => c.includes('reset')), 'git reset must NOT be called');
  assert.ok(!calls.some(c => c.includes('origin/main')), 'the trunk must not be touched');
});

// ---------------------------------------------------------------------------
// Test D — diverged: throws Error, no mutations
// ---------------------------------------------------------------------------

test('D: diverged (ahead 1, behind 1) — throws Error with counts, no mutations', () => {
  clearReg();
  const mock = makeMockRunGit([
    { match: 'fetch',                            returns: '' },
    { match: 'rev-parse origin/dev',             returns: 'bbb222bbb222\n' },
    { match: 'rev-parse dev',                    returns: 'aaa111aaa111\n' },
    { match: 'rev-list --count origin/dev..dev', returns: '1\n' },
    { match: 'rev-list --count dev..origin/dev', returns: '1\n' },
    // No further calls expected — divergence throws before unlock/push/merge
  ]);
  gitFinalizer.runGit = mock;
  let thrown = null;
  try {
    ensureIntegrationIsFresh('test-d');
  } catch (err) {
    thrown = err;
  } finally {
    gitFinalizer.runGit = originalRunGit;
  }

  assert.ok(thrown, 'An error must be thrown for true divergence');
  assert.ok(thrown.message.includes('1'), 'Error message must include the counts');
  assert.ok(thrown.message.includes('Operator intervention required'), 'Error must mention operator intervention');
  const mutations = mock.calls.filter(c =>
    c.includes('reset') || c.includes('push') || c.includes('merge') || c.includes('update-ref'));
  assert.strictEqual(mutations.length, 0, `No git mutations must occur: ${mutations.join(', ')}`);
});

// ---------------------------------------------------------------------------
// Test E — unlock/relock wrapping
//
// Strategy: monkeypatch runGit so that when push/merge is called, we verify
// the .main-unlocked marker exists (unlock ran before the op). After the
// full call, verify the marker is gone (lock ran in finally).
// ---------------------------------------------------------------------------

test('E: push path — unlock marker present during push, gone after', () => {
  clearReg();
  try { require('child_process').execSync(`bash "${LOCK_SCRIPT}"`, { cwd: REPO_ROOT, stdio: 'pipe' }); } catch (_) {}
  assert.ok(!fs.existsSync(MARKER_FILE), 'Marker must not exist before test');

  let markerDuringPush = null;

  let originSha = 'abc123\n';
  gitFinalizer.runGit = function (cmd) {
    if (cmd.includes('push origin dev')) {
      markerDuringPush = fs.existsSync(MARKER_FILE);
      originSha = 'def456\n';
      return '';
    }
    if (cmd.includes('rev-parse origin/dev'))             return originSha;
    if (cmd.includes('rev-parse dev'))                    return 'def456\n';
    if (cmd.includes('rev-list --count origin/dev..dev')) return '2\n';
    if (cmd.includes('rev-list --count dev..origin/dev')) return '0\n';
    return '';
  };

  try {
    ensureIntegrationIsFresh('test-e');
  } finally {
    gitFinalizer.runGit = originalRunGit;
    try { require('child_process').execSync(`bash "${LOCK_SCRIPT}"`, { cwd: REPO_ROOT, stdio: 'pipe' }); } catch (_) {}
  }

  assert.strictEqual(markerDuringPush, true, 'Unlock marker must exist during push (unlock ran before op)');
  assert.ok(!fs.existsSync(MARKER_FILE), 'Unlock marker must be gone after call (lock ran in finally)');
});

test('E: ff-merge path — unlock marker present during merge, gone after', () => {
  clearReg();
  try { require('child_process').execSync(`bash "${LOCK_SCRIPT}"`, { cwd: REPO_ROOT, stdio: 'pipe' }); } catch (_) {}
  assert.ok(!fs.existsSync(MARKER_FILE), 'Marker must not exist before test');

  let markerDuringMerge = null;
  let devSha = 'abc123\n';

  gitFinalizer.runGit = function (cmd) {
    if (cmd.includes('merge --ff-only origin/dev')) {
      markerDuringMerge = fs.existsSync(MARKER_FILE);
      devSha = 'xyz789\n';
      return '';
    }
    if (cmd.includes('rev-parse --abbrev-ref HEAD'))      return 'dev\n';
    if (cmd.includes('rev-parse origin/dev'))             return 'xyz789\n';
    if (cmd.includes('rev-parse dev'))                    return devSha;
    if (cmd.includes('rev-list --count origin/dev..dev')) return '0\n';
    if (cmd.includes('rev-list --count dev..origin/dev')) return '2\n';
    return '';
  };

  try {
    ensureIntegrationIsFresh('test-e2');
  } finally {
    gitFinalizer.runGit = originalRunGit;
    try { require('child_process').execSync(`bash "${LOCK_SCRIPT}"`, { cwd: REPO_ROOT, stdio: 'pipe' }); } catch (_) {}
  }

  assert.strictEqual(markerDuringMerge, true, 'Unlock marker must exist during merge (unlock ran before op)');
  assert.ok(!fs.existsSync(MARKER_FILE), 'Unlock marker must be gone after call (lock ran in finally)');
});

// ---------------------------------------------------------------------------
// Test F — HEAD is NOT on the integration branch (slice 353's root cause).
//
// The predecessor ran `git merge --ff-only origin/main` unconditionally. That
// acts on HEAD, so with HEAD parked elsewhere it was a no-op that still exited
// 0 — and on the conflicted-squash return path, where HEAD sits on the SLICE
// branch, it would fast-forward the slice instead of the integration branch.
// ---------------------------------------------------------------------------

test('F: behind only, HEAD on a slice branch — ref is moved explicitly, HEAD never merged', () => {
  clearReg();
  let devSha = 'abc123\n';
  const calls = [];
  gitFinalizer.runGit = function (cmd) {
    calls.push(cmd);
    if (cmd.includes('rev-parse --abbrev-ref HEAD'))      return 'slice/353\n';
    if (cmd.includes('rev-parse origin/dev'))             return 'xyz789\n';
    if (cmd.includes('rev-parse dev'))                    return devSha;
    if (cmd.includes('rev-list --count origin/dev..dev')) return '0\n';
    if (cmd.includes('rev-list --count dev..origin/dev')) return '2\n';
    if (cmd.includes('fetch origin dev:dev')) { devSha = 'xyz789\n'; return ''; }
    return '';
  };

  let thrown = null;
  try {
    ensureIntegrationIsFresh('test-f');
  } catch (err) {
    thrown = err;
  } finally {
    gitFinalizer.runGit = originalRunGit;
    try { require('child_process').execSync(`bash "${LOCK_SCRIPT}"`, { cwd: REPO_ROOT, stdio: 'pipe' }); } catch (_) {}
  }

  assert.strictEqual(thrown, null, `Refresh must succeed when HEAD is elsewhere: ${thrown && thrown.message}`);
  assert.ok(calls.some(c => c.includes('fetch origin dev:dev')), 'the ref must be moved explicitly');
  assert.ok(!calls.some(c => c.includes('merge --ff-only')),
    'merge --ff-only acts on HEAD — it must NOT run while HEAD is on the slice branch');
});

test('F: ref-move falls back to update-ref when the refspec fetch is refused', () => {
  clearReg();
  let devSha = 'abc123\n';
  const calls = [];
  gitFinalizer.runGit = function (cmd) {
    calls.push(cmd);
    if (cmd.includes('rev-parse --abbrev-ref HEAD'))      return 'slice/353\n';
    if (cmd.includes('rev-parse origin/dev'))             return 'xyz789\n';
    if (cmd.includes('rev-parse dev'))                    return devSha;
    if (cmd.includes('rev-list --count origin/dev..dev')) return '0\n';
    if (cmd.includes('rev-list --count dev..origin/dev')) return '2\n';
    if (cmd.includes('fetch origin dev:dev')) {
      throw new Error("refusing to fetch into branch 'refs/heads/dev' checked out at ...");
    }
    if (cmd.includes('update-ref refs/heads/dev')) { devSha = 'xyz789\n'; return ''; }
    return '';
  };

  let thrown = null;
  try {
    ensureIntegrationIsFresh('test-f2');
  } catch (err) {
    thrown = err;
  } finally {
    gitFinalizer.runGit = originalRunGit;
    try { require('child_process').execSync(`bash "${LOCK_SCRIPT}"`, { cwd: REPO_ROOT, stdio: 'pipe' }); } catch (_) {}
  }

  assert.strictEqual(thrown, null, `Fallback must succeed: ${thrown && thrown.message}`);
  assert.ok(calls.some(c => c.includes('update-ref refs/heads/dev xyz789')),
    'a refused refspec fetch must fall back to update-ref at the remote sha');
});

// ---------------------------------------------------------------------------
// Test G — the false-success guard (slice 353's headline bug).
//
// `Fast-forwarded main: f7fd230 → f7fd230` was logged for 42 commits' worth of
// staleness because the verify trusted the merge's exit code. A refresh that
// leaves the ref where it was must now RAISE.
// ---------------------------------------------------------------------------

test('G: a no-op refresh raises instead of reporting a fast-forward', () => {
  clearReg();
  const calls = [];
  gitFinalizer.runGit = function (cmd) {
    calls.push(cmd);
    if (cmd.includes('rev-parse --abbrev-ref HEAD'))      return 'slice/353\n';
    if (cmd.includes('rev-parse origin/dev'))             return 'xyz789\n';
    // The ref never moves — exactly the frozen-ref condition.
    if (cmd.includes('rev-parse dev'))                    return 'abc123\n';
    if (cmd.includes('rev-list --count origin/dev..dev')) return '0\n';
    if (cmd.includes('rev-list --count dev..origin/dev')) return '42\n';
    return ''; // every mutation "succeeds" — as git did, with exit 0
  };

  let thrown = null;
  try {
    ensureIntegrationIsFresh('test-g');
  } catch (err) {
    thrown = err;
  } finally {
    gitFinalizer.runGit = originalRunGit;
    try { require('child_process').execSync(`bash "${LOCK_SCRIPT}"`, { cwd: REPO_ROOT, stdio: 'pipe' }); } catch (_) {}
  }

  assert.ok(thrown, 'A refresh that did not move the local ref must throw, not log success');
  assert.ok(/did not move the local ref/.test(thrown.message),
    `Error must name the unmoved ref, got: ${thrown.message}`);
  assert.ok(!fs.existsSync(MARKER_FILE), 'Layer-2 must be re-locked even when the verify throws');
});

test('G: a push that does not advance origin raises', () => {
  clearReg();
  gitFinalizer.runGit = function (cmd) {
    if (cmd.includes('rev-parse origin/dev'))             return 'aaa111\n'; // never advances
    if (cmd.includes('rev-parse dev'))                    return 'bbb222\n';
    if (cmd.includes('rev-list --count origin/dev..dev')) return '2\n';
    if (cmd.includes('rev-list --count dev..origin/dev')) return '0\n';
    return '';
  };

  let thrown = null;
  try {
    ensureIntegrationIsFresh('test-g2');
  } catch (err) {
    thrown = err;
  } finally {
    gitFinalizer.runGit = originalRunGit;
    try { require('child_process').execSync(`bash "${LOCK_SCRIPT}"`, { cwd: REPO_ROOT, stdio: 'pipe' }); } catch (_) {}
  }

  assert.ok(thrown, 'A push that left origin where it was must throw');
  assert.ok(/did not advance origin/.test(thrown.message),
    `Error must say origin did not advance, got: ${thrown.message}`);
  const events = readRegEvents().filter(e => e.event === 'MAIN_PUSHED_TO_ORIGIN');
  assert.strictEqual(events.length, 0, 'No success event may be emitted when the post-condition fails');
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

clearReg();
// Restore register file path to real path
_testSetRegisterFile(path.join(BRIDGE_DIR, 'register.jsonl'));

console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`);
if (failed > 0) process.exit(1);
