'use strict';

/**
 * Journey: J-runtime-state-survives-landing
 * Category: Dispatch & Execution
 *
 * What this tests:
 *   Untracking the volatile runtime state is safe to LAND, not just safe once it
 *   is in effect.
 *
 *   `git rm --cached` spares the worktree that runs it, but the deletion is real
 *   in the commit — so whoever merges the branch has the files removed from their
 *   working tree, and that worktree is the live pipeline. Nog reproduced both
 *   branches of it:
 *
 *     • integration branch dirty at merge time (the normal case — the heartbeat
 *       ticks every 60 s and these files are still tracked there until the slice
 *       lands) → the pre-checkout autocommit puts a MODIFICATION on the target,
 *       the drift merge hits modify/delete, and the slice strands as
 *       `merge_conflict` — the exact failure this slice exists to reduce.
 *     • integration branch clean → the squash merge succeeds and takes
 *       bridge/timesheet.jsonl (46 rows of the project's economics),
 *       bridge/anchors.jsonl, bridge/tt-audit.jsonl and branch-state.json with it.
 *       rebuildMerged() cannot recover them: it reads timesheet-*.jsonl off disk,
 *       and those are untracked by this same slice. Seeding '' over the gap turns
 *       "missing" into "empty", which reads as truth and is not.
 *
 *   Three defences, tested here against real git repositories rather than mocks:
 *     1. scripts/land-untracked-runtime-state.sh lands the index-only removal on
 *        the integration branch FIRST, so branch and target agree and there is no
 *        delete-vs-modify left to resolve.
 *     2. the autocommit refuses to sweep a volatile path even while it is still
 *        tracked — closing the window in which the diverging commit is created.
 *     3. ensureRuntimeState() restores an absent file from git history before it
 *        falls back to the empty body, so the ledgers survive however the change
 *        arrives.
 *
 * Guards:
 *   slice-372-ac-1 — no autocommit of runtime state, including during the
 *                    transition when the paths are still tracked
 *   slice-372-ac-2 — the files stay present on disk through the landing, and are
 *                    recovered rather than blanked if they ever do go missing
 */

//
// @ac-hash: slice-372-ac-1 sha256:9a7366ac20653967e8200c231bd0635bc73fae61c6989de8cc457192b82666af
// @ac-hash: slice-372-ac-2 sha256:a2fadb2068c1cfaec5213252e4c814a2629583888bf6e962df2f174becb34488

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const { makeTmpDir, removeTmpDir } = require('../helpers/tmp-dir');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ORCHESTRATOR_SRC = path.join(REPO_ROOT, 'bridge', 'orchestrator.js');
const LAND_SCRIPT = path.join(REPO_ROOT, 'scripts', 'land-untracked-runtime-state.sh');

const {
  ensureRuntimeState,
  contentFromHistory,
  isVolatileRuntimePath,
} = require('../../bridge/state/seed-runtime-state');

const orchestrator = require('../../bridge/orchestrator');
const { porcelainPaths, stageablePathsFrom, shQuote, recoverRuntimeStateAfterGit } = orchestrator;

// The ledgers that cannot be rebuilt from anything else, with content that is
// recognisable if it survives and unmistakable if it does not.
const LIVE_TIMESHEET = '{"slice":"366","tokens":41200}\n{"slice":"371","tokens":38800}\n';
const LIVE_ANCHORS = '{"anchor":"handoff-366"}\n';
const LIVE_BRANCH_STATE = '{"schema_version":1,"dev":{"deferred_slices":["371"],"commits":[]},"gate":{"status":"IDLE"}}\n';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

// Does `git <args>` succeed? Used where the exit CODE is the assertion — a drift
// merge that conflicts is the failure this slice is about.
function gitOk(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function write(root, rel, body) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

/**
 * A miniature of the real repository at the moment slice 372 is about to land:
 * an integration branch that tracks the runtime state and keeps ticking it, and a
 * slice branch that has untracked it. Returns the repo root.
 */
function makeLandingRepo(label) {
  const tmp = makeTmpDir(label);
  git(tmp, ['init', '-q', '-b', 'dev']);
  git(tmp, ['config', 'user.email', 'gate@denorios.test']);
  git(tmp, ['config', 'user.name', 'Regression Gate']);
  // The hook path the real repo installs would block the landing commit; a
  // throwaway repo has none, which is what we want to exercise.

  write(tmp, 'bridge/orchestrator.js', '// source\n');
  write(tmp, 'bridge/heartbeat.json', '{"ts":"2026-09-02T16:00:00.000Z","status":"idle"}\n');
  write(tmp, 'bridge/queue-order.json', '["371"]\n');
  write(tmp, 'bridge/state/branch-state.json', LIVE_BRANCH_STATE);
  write(tmp, 'bridge/timesheet.jsonl', LIVE_TIMESHEET);
  write(tmp, 'bridge/anchors.jsonl', LIVE_ANCHORS);
  write(tmp, 'bridge/trash/nog-active.json.done', '{"slice":"366"}\n');
  write(tmp, 'bridge/trash/366-DONE.md', '# permanent record\n');
  git(tmp, ['add', '-A']);
  git(tmp, ['commit', '-qm', 'base — runtime state tracked']);

  // The slice branch: untrack + ignore, exactly as slice/372 does.
  git(tmp, ['checkout', '-q', '-b', 'slice/372']);
  git(tmp, ['rm', '-q', '--cached', '--',
    'bridge/heartbeat.json', 'bridge/queue-order.json', 'bridge/state/branch-state.json',
    'bridge/timesheet.jsonl', 'bridge/anchors.jsonl', 'bridge/trash/nog-active.json.done']);
  write(tmp, '.gitignore', [
    'bridge/heartbeat.json', 'bridge/queue-order.json', 'bridge/state/branch-state.json',
    'bridge/timesheet.jsonl', 'bridge/anchors.jsonl', 'bridge/trash/*', '!bridge/trash/.gitkeep', '',
  ].join('\n'));
  write(tmp, 'bridge/state/seed-runtime-state.js', '// the seeder\n');
  git(tmp, ['add', '.gitignore', 'bridge/state/seed-runtime-state.js']);
  git(tmp, ['commit', '-qm', 'S372: untrack the volatile runtime state']);

  // Back on the integration branch, the pipeline keeps running: the heartbeat
  // ticks and the timesheet gains a row. This is the dirty tree the autocommit
  // sees, and the reason the naive merge conflicts.
  git(tmp, ['checkout', '-q', 'dev']);
  write(tmp, 'bridge/heartbeat.json', '{"ts":"2026-09-04T10:00:00.000Z","status":"nog_review"}\n');
  write(tmp, 'bridge/timesheet.jsonl', LIVE_TIMESHEET + '{"slice":"372","tokens":41200}\n');
  return tmp;
}

// ---------------------------------------------------------------------------
// slice-372-ac-2 — the landing procedure, against real git
// ---------------------------------------------------------------------------

test('slice-372-ac-2 without the landing step the drift merge conflicts (the defect being fixed)', () => {
  const tmp = makeLandingRepo('j-landing-unfixed');
  try {
    // The autocommit the orchestrator performs before switching branches — this is
    // the commit that puts a MODIFICATION on the target and makes the merge diverge.
    git(tmp, ['add', '-u']);
    git(tmp, ['commit', '-qm', 'autocommit: pre-checkout-branch-slice/372']);

    // squashSliceToDev step 1 → checkout the slice branch; step 1b → merge in the target.
    git(tmp, ['checkout', '-q', 'slice/372']);
    const merge = gitOk(tmp, ['merge', '--no-ff', 'dev', '-m', 'drift']);
    assert.equal(merge.ok, false, 'this is the reproduction — it must still fail without the landing step');
    assert.match(merge.out, /CONFLICT \(modify\/delete\)/,
      'the stranding failure is a modify/delete conflict; if the shape changed the landing procedure needs revisiting');
  } finally {
    removeTmpDir(tmp);
  }
});

test('slice-372-ac-2 the landing script untracks on the integration branch without touching the disk', () => {
  const tmp = makeLandingRepo('j-landing-script');
  try {
    const r = spawnSync('bash', [LAND_SCRIPT], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, `landing script must succeed:\n${r.stdout}\n${r.stderr}`);

    // Index: nothing volatile left tracked.
    const tracked = git(tmp, ['ls-files', '--', 'bridge/heartbeat.json', 'bridge/timesheet.jsonl',
      'bridge/anchors.jsonl', 'bridge/state/branch-state.json', 'bridge/queue-order.json']);
    assert.equal(tracked, '', `nothing volatile may remain tracked, got: ${tracked}`);

    // Disk: every byte still there, including the row written after the last commit.
    assert.equal(fs.readFileSync(path.join(tmp, 'bridge/timesheet.jsonl'), 'utf8'),
      LIVE_TIMESHEET + '{"slice":"372","tokens":41200}\n',
      'the live timesheet must be untouched — --cached is index-only');
    assert.equal(fs.readFileSync(path.join(tmp, 'bridge/anchors.jsonl'), 'utf8'), LIVE_ANCHORS);
    assert.equal(fs.readFileSync(path.join(tmp, 'bridge/state/branch-state.json'), 'utf8'), LIVE_BRANCH_STATE);
  } finally {
    removeTmpDir(tmp);
  }
});

test('slice-372-ac-2 after the landing step the slice merges clean and every ledger survives', () => {
  const tmp = makeLandingRepo('j-landing-merge');
  try {
    assert.equal(spawnSync('bash', [LAND_SCRIPT], { cwd: tmp, encoding: 'utf8' }).status, 0);

    // squashSliceToDev's own sequence: drift-merge the target into the slice,
    // then squash the slice onto the target.
    const drift = gitOk(tmp, ['checkout', '-q', 'slice/372']);
    assert.ok(drift.ok);
    const merged = gitOk(tmp, ['merge', '--no-ff', 'dev', '-m', 'drift']);
    assert.equal(merged.ok, true, `drift merge must not conflict after landing:\n${merged.out}`);

    git(tmp, ['checkout', '-q', 'dev']);
    const squash = gitOk(tmp, ['merge', '--squash', 'slice/372']);
    assert.equal(squash.ok, true, `squash must not conflict:\n${squash.out}`);
    git(tmp, ['commit', '-qm', 'S372: squashed']);

    for (const rel of ['bridge/heartbeat.json', 'bridge/queue-order.json',
      'bridge/state/branch-state.json', 'bridge/timesheet.jsonl', 'bridge/anchors.jsonl']) {
      assert.ok(fs.existsSync(path.join(tmp, rel)),
        `${rel} must still be on disk after the merge — this is the loss the finding named`);
    }
    assert.equal(fs.readFileSync(path.join(tmp, 'bridge/timesheet.jsonl'), 'utf8'),
      LIVE_TIMESHEET + '{"slice":"372","tokens":41200}\n',
      'the economics ledger must come through the merge with every row');
  } finally {
    removeTmpDir(tmp);
  }
});

test('slice-372-ac-2 the landing script refuses to run from a worktree or off the integration branch', () => {
  const tmp = makeLandingRepo('j-landing-refuse');
  try {
    // The fixture leaves the tick uncommitted; commit it so the checkout below is
    // about the script's refusal and not about a dirty tree.
    git(tmp, ['add', '-u']);
    git(tmp, ['commit', '-qm', 'autocommit: tick']);
    git(tmp, ['checkout', '-q', 'slice/372']);
    const wrongBranch = spawnSync('bash', [LAND_SCRIPT], { cwd: tmp, encoding: 'utf8' });
    assert.notEqual(wrongBranch.status, 0, 'must refuse to land anywhere but the integration branch');
    assert.match(`${wrongBranch.stdout}${wrongBranch.stderr}`, /refusing/);

    git(tmp, ['checkout', '-q', 'dev']);

    // The worktree shape, without `git worktree add`: git honours GIT_DIR and
    // GIT_COMMON_DIR, and a worktree is exactly the case where the two differ —
    // which is the comparison the script makes. (Creating a real worktree here
    // wedged every concurrently-running suite on this machine; the env-var form
    // exercises the same branch of the script and costs one process.)
    const fakeWorktreeGitDir = path.join(tmp, '.git', 'worktrees', 'fake');
    fs.mkdirSync(fakeWorktreeGitDir, { recursive: true });
    const inWorktree = spawnSync('bash', [LAND_SCRIPT], {
      cwd: tmp,
      encoding: 'utf8',
      env: Object.assign({}, process.env, {
        GIT_DIR: fakeWorktreeGitDir,
        GIT_COMMON_DIR: path.join(tmp, '.git'),
      }),
    });
    assert.notEqual(inWorktree.status, 0, 'must refuse to land from a worktree — the removal has to reach the main tree');
    assert.match(`${inWorktree.stdout}${inWorktree.stderr}`, /worktree/);
  } finally {
    removeTmpDir(tmp);
  }
});

test('slice-372-ac-2 the landing script is idempotent', () => {
  const tmp = makeLandingRepo('j-landing-idempotent');
  try {
    assert.equal(spawnSync('bash', [LAND_SCRIPT], { cwd: tmp, encoding: 'utf8' }).status, 0);
    const second = spawnSync('bash', [LAND_SCRIPT], { cwd: tmp, encoding: 'utf8' });
    assert.equal(second.status, 0, 'a second run must be a clean no-op, not an error');
    assert.match(second.stdout, /nothing to do/);
  } finally {
    removeTmpDir(tmp);
  }
});

test('slice-372-ac-2 the landing script keeps archived reports tracked and unsweeps only the markers', () => {
  const tmp = makeLandingRepo('j-landing-trash');
  try {
    assert.equal(spawnSync('bash', [LAND_SCRIPT], { cwd: tmp, encoding: 'utf8' }).status, 0);
    const trash = git(tmp, ['ls-files', '--', 'bridge/trash/']).split('\n').filter(Boolean);
    assert.ok(trash.includes('bridge/trash/366-DONE.md'),
      'archived slice reports are permanent records (CLAUDE.md) — they stay tracked');
    assert.ok(!trash.includes('bridge/trash/nog-active.json.done'),
      'volatile pipeline markers must be untracked');
  } finally {
    removeTmpDir(tmp);
  }
});

// ---------------------------------------------------------------------------
// slice-372-ac-2 — recovery: absent is not the same as empty
// ---------------------------------------------------------------------------

test('slice-372-ac-2 a runtime file removed by a merge is restored from history, not blanked', () => {
  const tmp = makeLandingRepo('j-restore-history');
  try {
    git(tmp, ['add', '-u']);
    git(tmp, ['commit', '-qm', 'autocommit: the last state git ever saw']);

    // What the clean-target squash does to the live working tree.
    for (const rel of ['bridge/timesheet.jsonl', 'bridge/anchors.jsonl',
      'bridge/state/branch-state.json', 'bridge/queue-order.json']) {
      fs.unlinkSync(path.join(tmp, rel));
    }

    const { restored } = ensureRuntimeState(tmp);
    assert.ok(restored.includes('bridge/timesheet.jsonl'),
      'the economics ledger must be reported as RECOVERED, not quietly seeded');

    assert.equal(fs.readFileSync(path.join(tmp, 'bridge/timesheet.jsonl'), 'utf8'),
      LIVE_TIMESHEET + '{"slice":"372","tokens":41200}\n',
      'every committed row must come back — an empty timesheet reads as truth and is not');
    assert.equal(fs.readFileSync(path.join(tmp, 'bridge/anchors.jsonl'), 'utf8'), LIVE_ANCHORS);

    const state = JSON.parse(fs.readFileSync(path.join(tmp, 'bridge/state/branch-state.json'), 'utf8'));
    assert.deepEqual(state.dev.deferred_slices, ['371'],
      'deferred slices are accepted work waiting on the gate — a blank branch-state drops them silently');
  } finally {
    removeTmpDir(tmp);
  }
});

test('slice-372-ac-2 a heartbeat is never restored from history — it would claim liveness it has not earned', () => {
  const tmp = makeLandingRepo('j-restore-heartbeat');
  try {
    git(tmp, ['add', '-u']);
    git(tmp, ['commit', '-qm', 'autocommit']);
    fs.unlinkSync(path.join(tmp, 'bridge/heartbeat.json'));

    const { restored } = ensureRuntimeState(tmp);
    assert.ok(!restored.includes('bridge/heartbeat.json'),
      'the heartbeat is worth one 60-second tick; restoring one makes every liveness check read a dead orchestrator as alive');
    const hb = JSON.parse(fs.readFileSync(path.join(tmp, 'bridge/heartbeat.json'), 'utf8'));
    assert.equal(hb.ts, null);
    assert.equal(hb.status, 'idle');
  } finally {
    removeTmpDir(tmp);
  }
});

test('slice-372-ac-2 a fresh clone, where history has nothing, still gets the empty seed body', () => {
  const tmp = makeTmpDir('j-restore-fresh');
  try {
    git(tmp, ['init', '-q', '-b', 'dev']);
    git(tmp, ['config', 'user.email', 'gate@denorios.test']);
    git(tmp, ['config', 'user.name', 'Regression Gate']);
    write(tmp, 'source.js', '// source\n');
    git(tmp, ['add', '-A']);
    git(tmp, ['commit', '-qm', 'fresh clone — runtime state was never tracked']);

    const { seeded, restored } = ensureRuntimeState(tmp);
    assert.deepEqual(restored, [], 'nothing to restore when the paths were never in history');
    assert.ok(seeded.includes('bridge/timesheet.jsonl'));
    assert.equal(fs.readFileSync(path.join(tmp, 'bridge/timesheet.jsonl'), 'utf8'), '',
      'a fresh clone gets an empty ledger, which is the truth there');
    assert.equal(contentFromHistory(tmp, 'bridge/timesheet.jsonl'), null);
  } finally {
    removeTmpDir(tmp);
  }
});

test('slice-372-ac-2 restoring never overwrites a file that is already on disk', () => {
  const tmp = makeLandingRepo('j-restore-no-clobber');
  try {
    git(tmp, ['add', '-u']);
    git(tmp, ['commit', '-qm', 'autocommit']);
    const live = LIVE_TIMESHEET + '{"slice":"372","tokens":41200}\n{"slice":"373","tokens":9000}\n';
    write(tmp, 'bridge/timesheet.jsonl', live);

    const { restored, seeded } = ensureRuntimeState(tmp);
    assert.ok(!restored.includes('bridge/timesheet.jsonl'));
    assert.ok(!seeded.includes('bridge/timesheet.jsonl'));
    assert.equal(fs.readFileSync(path.join(tmp, 'bridge/timesheet.jsonl'), 'utf8'), live,
      'a present file is live state and outranks anything in history');
  } finally {
    removeTmpDir(tmp);
  }
});

test('slice-372-ac-2 the orchestrator re-asserts the runtime state after a git operation rewrites the tree', () => {
  const tmp = makeLandingRepo('j-recover-after-git');
  const restoreProjectDir = path.resolve(REPO_ROOT);
  try {
    git(tmp, ['add', '-u']);
    git(tmp, ['commit', '-qm', 'autocommit']);
    fs.unlinkSync(path.join(tmp, 'bridge/timesheet.jsonl'));

    orchestrator._testSetProjectDir(tmp);
    const result = recoverRuntimeStateAfterGit('squash-slice/372', '372');
    assert.ok(result.restored.includes('bridge/timesheet.jsonl'),
      'the merge path must put the ledgers back before anything appends to a blank one');
    assert.equal(fs.readFileSync(path.join(tmp, 'bridge/timesheet.jsonl'), 'utf8'),
      LIVE_TIMESHEET + '{"slice":"372","tokens":41200}\n');
  } finally {
    orchestrator._testSetProjectDir(restoreProjectDir);
    removeTmpDir(tmp);
  }
});

test('slice-372-ac-2 the merge and checkout paths call the recovery', () => {
  const src = fs.readFileSync(ORCHESTRATOR_SRC, 'utf8');
  const squash = src.slice(src.indexOf('function squashSliceToDev('));
  assert.ok(/recoverRuntimeStateAfterGit\(`squash-/.test(squash),
    'squashSliceToDev must re-assert the runtime state after the squash applies the slice tree');
  const checkout = src.slice(src.indexOf('function fuseSafeCheckoutBranch('),
    src.indexOf('function createBranchFromMain('));
  assert.ok(/recoverRuntimeStateAfterGit\(`checkout-/.test(checkout),
    'fuseSafeCheckoutBranch must re-assert the runtime state after moving HEAD');
  assert.ok(/if \(isVolatileRuntimePath\(file\)\) continue;/.test(checkout),
    'the checkout must not sweep a volatile runtime file to trash just because the target branch lacks it');
});

// ---------------------------------------------------------------------------
// slice-372-ac-1 — the autocommit cannot sweep runtime state, tracked or not
// ---------------------------------------------------------------------------

test('slice-372-ac-1 the autocommit stages nothing when only runtime state is dirty — even while it is tracked', () => {
  const tmp = makeLandingRepo('j-autocommit-transition');
  try {
    // Deliberately BEFORE the landing step: on the integration branch these paths
    // are still tracked and dirty. This is the window that created 23 commits.
    const status = git(tmp, ['status', '--porcelain']);
    const tracked = status.split('\n').filter(l => l && !l.startsWith('??'));
    assert.ok(tracked.length >= 2, 'the fixture must present dirty TRACKED runtime files');
    assert.ok(tracked.every(l => porcelainPaths(l).some(isVolatileRuntimePath)),
      `every dirty path here is runtime state: ${tracked.join(' | ')}`);

    // autoCommitDirtyTree's own rule: stage exactly the non-volatile paths, and
    // when there are none, commit nothing at all.
    const stagePaths = stageablePathsFrom(tracked);
    assert.deepEqual(stagePaths, [],
      'nothing here is committable — this is how the 23 bookkeeping commits stop');
  } finally {
    removeTmpDir(tmp);
  }
});

test('slice-372-ac-1 the autocommit still commits real source changes alongside dirty runtime state', () => {
  const tmp = makeLandingRepo('j-autocommit-real-work');
  try {
    write(tmp, 'bridge/orchestrator.js', '// source, genuinely edited\n');
    const stagePaths = stageablePathsFrom(git(tmp, ['status', '--porcelain']).split('\n').filter(Boolean));
    assert.deepEqual(stagePaths, ['bridge/orchestrator.js'],
      'the filter narrows the autocommit; it must not disable it — an uncommitted source edit is lost at checkout');

    // …and the command it builds really does stage that and only that.
    execFileSync('bash', ['-c', `git add -u -- ${stagePaths.map(shQuote).join(' ')}`], { cwd: tmp, stdio: 'ignore' });
    assert.equal(git(tmp, ['diff', '--cached', '--name-only']), 'bridge/orchestrator.js');
  } finally {
    removeTmpDir(tmp);
  }
});

test('slice-372-ac-1 porcelainPaths reads both sides of a rename and unquotes', () => {
  assert.deepEqual(porcelainPaths(' M bridge/heartbeat.json'), ['bridge/heartbeat.json']);
  // autoCommitDirtyTree trims the whole `git status --porcelain` output, which eats
  // the leading space off the FIRST line only. A fixed slice(3) read that as
  // 'ridge/heartbeat.json' — matching no rule, so the heartbeat was staged anyway.
  assert.deepEqual(porcelainPaths('M bridge/heartbeat.json'), ['bridge/heartbeat.json']);
  assert.deepEqual(porcelainPaths('D bridge/timesheet.jsonl'), ['bridge/timesheet.jsonl']);
  assert.deepEqual(porcelainPaths('MM bridge/orchestrator.js'), ['bridge/orchestrator.js']);
  assert.deepEqual(porcelainPaths('R  bridge/timesheet.jsonl -> bridge/timesheet-old.jsonl'),
    ['bridge/timesheet.jsonl', 'bridge/timesheet-old.jsonl']);
  assert.deepEqual(porcelainPaths(' M "bridge/heartbeat.json"'), ['bridge/heartbeat.json'],
    'core.quotepath wraps a path in quotes; an unstripped quote makes runtime state look like source');
  assert.deepEqual(porcelainPaths('   '), []);
});

test('slice-372-ac-1 isVolatileRuntimePath names bookkeeping and nothing else', () => {
  for (const rel of ['bridge/heartbeat.json', 'bridge/queue-order.json',
    'bridge/state/branch-state.json', 'bridge/timesheet.jsonl', 'bridge/anchors.jsonl',
    'bridge/tt-audit.jsonl', 'bridge/trash/nog-active.json.done',
    'bridge/trash/372-QUEUED.md.stale-after-MERGED', 'bridge/trash/orchestrator.js.branch-checkout']) {
    assert.ok(isVolatileRuntimePath(rel), `${rel} is runtime bookkeeping`);
  }
  for (const rel of ['bridge/orchestrator.js', 'bridge/state/branch-state-recovery.js',
    'bridge/state/gate-mutex.js', 'dashboard/server.js', 'bridge/queue/372-DONE.md',
    'regression/COVERAGE.lock', 'bridge/timesheet.js', 'bridge/trash/366-DONE.md',
    'bridge/trash/311-ARCHIVED.md']) {
    assert.ok(!isVolatileRuntimePath(rel),
      `${rel} is source or a permanent record — excluding it from the autocommit would lose real work`);
  }
});
