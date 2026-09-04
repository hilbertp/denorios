'use strict';

/**
 * Journey: J-untracked-runtime-state
 * Category: Dispatch & Execution
 *
 * What this tests:
 *   The volatile runtime state — heartbeat ticks, queue ordering, branch topology,
 *   timesheets, trash bookkeeping — is not tracked by git.
 *
 *   While it was tracked the working tree was never clean, so the orchestrator's
 *   defensive pre-checkout autocommit ("commit the dirty tree before switching
 *   branches") swept machine bookkeeping into a commit on the integration branch
 *   on every single slice run. Twenty-three such commits landed. Nothing in them
 *   was source.
 *
 *   The fix is not to weaken the autocommit — committing before a checkout is
 *   sound — but to make the tree clean: untrack the files, ignore them, and seed
 *   them at startup so a fresh clone (where git recreates none of them) still
 *   works.
 *
 * Guards:
 *   slice-372-ac-1 — the files are untracked and ignored, and an ignored file can
 *                    never reach the autocommit (it stages tracked changes only)
 *   slice-372-ac-2 — the files survive on disk, are writable, and the seeder
 *                    rebuilds any that a fresh clone lacks
 *   slice-372-ac-6 — the existing autocommit history is intact, not rewritten
 */

//
// @ac-hash: slice-372-ac-1 sha256:9a7366ac20653967e8200c231bd0635bc73fae61c6989de8cc457192b82666af
// @ac-hash: slice-372-ac-2 sha256:a2fadb2068c1cfaec5213252e4c814a2629583888bf6e962df2f174becb34488
// @ac-hash: slice-372-ac-6 sha256:042403c9c5d6477b98df8e42269b27fd58ed7d312fb4de3f144167ff46067951

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { makeTmpDir, removeTmpDir } = require('../helpers/tmp-dir');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ORCHESTRATOR_SRC = path.resolve(__dirname, '..', '..', 'bridge', 'orchestrator.js');
const SEED_SRC = path.resolve(__dirname, '..', '..', 'bridge', 'state', 'seed-runtime-state.js');
const GITIGNORE = path.resolve(__dirname, '..', '..', '.gitignore');

const { ensureRuntimeState, RUNTIME_FILES } = require('../../bridge/state/seed-runtime-state');

// The runtime state named in the slice brief. Repo-relative, git-style paths.
const VOLATILE_PATHS = [
  'bridge/heartbeat.json',
  'bridge/state/branch-state.json',
  'bridge/queue-order.json',
  'bridge/timesheet.jsonl',
  'bridge/trash/nog-active.json.done',
];

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

// ---------------------------------------------------------------------------
// slice-372-ac-1 — untracked, ignored, and unreachable by the autocommit
// ---------------------------------------------------------------------------

test('slice-372-ac-1 the volatile runtime state files are no longer tracked by git', () => {
  const tracked = git(['ls-files', '--', ...VOLATILE_PATHS]).split('\n').filter(Boolean);
  assert.deepEqual(tracked, [],
    `these paths must not be tracked — a tracked runtime file dirties the tree on every tick: ${tracked.join(', ')}`);
});

test('slice-372-ac-1 the volatile runtime state files are ignored going forward', () => {
  for (const rel of VOLATILE_PATHS) {
    let ignored = true;
    try {
      execFileSync('git', ['check-ignore', '-q', '--', rel], { cwd: REPO_ROOT, stdio: 'ignore' });
    } catch (_) {
      ignored = false;
    }
    assert.ok(ignored, `${rel} must be gitignored, or a new one lands untracked-but-committable`);
  }
});

test('slice-372-ac-1 .gitignore names every volatile runtime path', () => {
  const ignoreSrc = fs.readFileSync(GITIGNORE, 'utf8');
  for (const rel of ['bridge/heartbeat.json', 'bridge/queue-order.json',
    'bridge/state/branch-state.json', 'bridge/timesheet.jsonl', 'bridge/trash/']) {
    assert.ok(ignoreSrc.includes(rel),
      `.gitignore must name ${rel} — the brief lists it as volatile runtime state`);
  }
});

test('slice-372-ac-1 a slice run leaves no runtime file staged for autocommit', () => {
  // The autocommit stages tracked modifications only (`git add -u`, with untracked
  // "??" entries filtered out). An ignored, untracked file therefore cannot reach
  // it — this asserts the property the fix relies on rather than the file list.
  const src = fs.readFileSync(ORCHESTRATOR_SRC, 'utf8');
  const fnStart = src.indexOf('function autoCommitDirtyTree(');
  assert.ok(fnStart > 0, 'autoCommitDirtyTree must still exist');
  const body = src.slice(fnStart, fnStart + 1600);
  assert.ok(body.includes("!l.startsWith('??')"),
    'autocommit must keep skipping untracked files');
  assert.ok(body.includes('git add -u'),
    'autocommit must keep staging tracked modifications only — never `git add -A`');

  // Now prove it end to end: a throwaway repo carrying this repo's ignore rules,
  // with every runtime file dirtied the way a slice run dirties them, must offer
  // the autocommit nothing to stage.
  const tmp = makeTmpDir('j-autocommit-clean');
  try {
    const g = (args) => execFileSync('git', args, { cwd: tmp, encoding: 'utf8' }).trim();
    g(['init', '-q']);
    g(['config', 'user.email', 'gate@denorios.test']);
    g(['config', 'user.name', 'Regression Gate']);
    fs.copyFileSync(GITIGNORE, path.join(tmp, '.gitignore'));
    fs.writeFileSync(path.join(tmp, 'source.js'), 'module.exports = 1;\n');
    g(['add', '-A']);
    g(['commit', '-qm', 'base']);

    // A slice run rewrites every one of these. None is tracked, so none is a change.
    ensureRuntimeState(tmp);
    fs.mkdirSync(path.join(tmp, 'bridge', 'trash'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'bridge', 'trash', 'nog-active.json.done'), '{"slice":"372"}');
    for (const rel of ['bridge/heartbeat.json', 'bridge/queue-order.json',
      'bridge/state/branch-state.json', 'bridge/timesheet.jsonl']) {
      fs.writeFileSync(path.join(tmp, rel), '{"ts":"2026-09-02T16:11:40.849Z"}');
    }

    // autoCommitDirtyTree's own selection rule, applied verbatim.
    const status = g(['status', '--porcelain']);
    const trackedChanges = status.split('\n').filter(l => l && !l.startsWith('??'));
    assert.deepEqual(trackedChanges, [],
      `a slice run must leave nothing for the autocommit to sweep, got: ${trackedChanges.join(' | ')}`);
  } finally {
    removeTmpDir(tmp);
  }
});

// ---------------------------------------------------------------------------
// slice-372-ac-2 — still on disk, still writable, rebuilt on a fresh clone
// ---------------------------------------------------------------------------

test('slice-372-ac-2 untracking did not delete the files from disk', () => {
  for (const rel of ['bridge/heartbeat.json', 'bridge/state/branch-state.json',
    'bridge/queue-order.json', 'bridge/timesheet.jsonl']) {
    const abs = path.join(REPO_ROOT, rel);
    assert.ok(fs.existsSync(abs), `${rel} must still exist — the running system reads and writes it continuously`);
    // W_OK: the orchestrator rewrites these on every tick.
    assert.doesNotThrow(() => fs.accessSync(abs, fs.constants.R_OK | fs.constants.W_OK),
      `${rel} must remain readable and writable`);
  }
});

test('slice-372-ac-2 the seeder rebuilds every runtime file a fresh clone lacks', () => {
  const tmp = makeTmpDir('j-seed-fresh-clone');
  try {
    const { seeded } = ensureRuntimeState(tmp);
    assert.deepEqual(
      seeded.slice().sort(),
      RUNTIME_FILES.map(f => f.rel).sort(),
      'a fresh clone must get every runtime file seeded',
    );
    for (const { rel } of RUNTIME_FILES) {
      assert.ok(fs.existsSync(path.join(tmp, rel)), `${rel} must exist after seeding`);
    }
  } finally {
    removeTmpDir(tmp);
  }
});

test('slice-372-ac-2 the seeded branch-state carries the recovery schema', () => {
  const tmp = makeTmpDir('j-seed-schema');
  try {
    ensureRuntimeState(tmp);
    const state = JSON.parse(fs.readFileSync(path.join(tmp, 'bridge/state/branch-state.json'), 'utf8'));
    // The schema the dashboard, the gate and branch-state-recovery all parse.
    assert.equal(state.schema_version, 1);
    assert.ok(state.main && 'tip_sha' in state.main, 'main.tip_sha must be present');
    assert.ok(state.dev && Array.isArray(state.dev.commits), 'dev.commits must be an array');
    assert.ok(state.gate && state.gate.status === 'IDLE', 'gate must seed IDLE');

    const order = JSON.parse(fs.readFileSync(path.join(tmp, 'bridge/queue-order.json'), 'utf8'));
    assert.deepEqual(order, [], 'queue order must seed as an empty list, not null');
  } finally {
    removeTmpDir(tmp);
  }
});

test('slice-372-ac-2 seeding never claims liveness it has not earned', () => {
  const tmp = makeTmpDir('j-seed-heartbeat');
  try {
    ensureRuntimeState(tmp);
    const hb = JSON.parse(fs.readFileSync(path.join(tmp, 'bridge/heartbeat.json'), 'utf8'));
    // A seeded heartbeat with a fresh `ts` would read as a live orchestrator to
    // every liveness check in the system. It has never ticked; say so.
    assert.equal(hb.ts, null, 'a seeded heartbeat must not carry a timestamp');
    assert.equal(hb.status, 'idle');
    assert.equal(hb.current_slice, null);
  } finally {
    removeTmpDir(tmp);
  }
});

test('slice-372-ac-2 seeding is idempotent and never clobbers live state', () => {
  const tmp = makeTmpDir('j-seed-idempotent');
  try {
    ensureRuntimeState(tmp);
    const hbPath = path.join(tmp, 'bridge/heartbeat.json');
    fs.writeFileSync(hbPath, JSON.stringify({ ts: '2026-09-02T16:11:40.849Z', status: 'nog_review' }));

    const second = ensureRuntimeState(tmp);
    assert.deepEqual(second.seeded, [], 'a second pass must seed nothing');
    assert.equal(JSON.parse(fs.readFileSync(hbPath, 'utf8')).status, 'nog_review',
      'seeding must never overwrite live runtime state');
  } finally {
    removeTmpDir(tmp);
  }
});

test('slice-372-ac-2 the entry points seed before they read', () => {
  const orchSrc = fs.readFileSync(ORCHESTRATOR_SRC, 'utf8');
  assert.ok(/require\(['"]\.\/state\/seed-runtime-state['"]\)/.test(orchSrc),
    'the orchestrator must require the seeder');
  assert.ok(orchSrc.includes('ensureRuntimeState('),
    'the orchestrator must call ensureRuntimeState at startup');

  const serverSrc = fs.readFileSync(path.join(REPO_ROOT, 'dashboard', 'server.js'), 'utf8');
  assert.ok(serverSrc.includes('seed-runtime-state') && serverSrc.includes('ensureRuntimeState('),
    'the dashboard server must seed the runtime state before serving panels that read it');

  const seedSrc = fs.readFileSync(SEED_SRC, 'utf8');
  assert.ok(seedSrc.includes("flag: 'wx'"),
    'the seeder must create-exclusively so it can never truncate a live file');
});

// ---------------------------------------------------------------------------
// slice-372-ac-6 — fix forward; the old autocommits stay in history
// ---------------------------------------------------------------------------

test('slice-372-ac-6 the existing autocommit history is not rewritten', () => {
  const subjects = git(['log', '--format=%s', 'HEAD']).split('\n').filter(Boolean);
  const autocommits = subjects.filter(l => l.startsWith('autocommit:'));
  assert.ok(autocommits.length >= 20,
    `the pre-existing autocommits must remain reachable from HEAD (found ${autocommits.length}) — this was fixed forward, not rebased away`);
});
