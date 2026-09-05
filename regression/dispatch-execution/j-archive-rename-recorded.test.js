'use strict';

/**
 * Journey: J-archive-rename-recorded
 * Category: Dispatch & Execution
 *
 * What this tests:
 *   Slice 372 untracked five runtime files and the autocommits shrank — but they
 *   did not stop. Two sources were left, and this slice closes both.
 *
 *   1 · regression/AC-DECISIONS.json — the CHECK overlay's ledger of the
 *       operator's per-AC rulings. Rewritten during normal operation exactly like
 *       the slice-372 files, and tracked, so the tree was never clean and the
 *       pre-checkout autocommit swept it (3f4126a). It joins RUNTIME_FILES rather
 *       than getting a rule of its own, so the ignore file, the seeder and the
 *       autocommit filter keep reading from one list.
 *
 *   2 · The archive rename. Queue reports are permanent records by contract and
 *       they are tracked — but bridge/queue/*.md is gitignored, so the tracking is
 *       force-added and git cannot follow a report when the pipeline renames it.
 *       Archiving renames {id}-DONE.md forward to {id}-ARCHIVED.md and sweeps the
 *       siblings to bridge/trash/; to git a tracked file simply vanished, and the
 *       next autocommit committed four bare deletions at once (027f09c). The fix
 *       is NOT to untrack the reports — that is the audit trail — but to record
 *       the rename in the step that performs it.
 *
 * Guards:
 *   slice-381-ac-1 — the decisions ledger is untracked, still present and
 *                    writable, and a fresh checkout runs without it
 *   slice-381-ac-2 — archiving records the rename of its report, so no later
 *                    commit carries an unexplained deletion of it
 *   slice-381-ac-3 — an ordinary slice run produces no autocommit of bookkeeping
 *   slice-381-ac-4 — the queue's reports stay tracked and retrievable
 *   slice-381-ac-5 — existing history is not rewritten
 */

//
// @ac-hash: slice-381-ac-1 sha256:aba759cd1c2159128889f1c65a1a6021df375fc1f864815e88d5325d66d0e10f
// @ac-hash: slice-381-ac-2 sha256:348a6a6a95ebf61153896af246cd0c7a72d21be8f867ff7eaa3e536563353bd8
// @ac-hash: slice-381-ac-3 sha256:835b7c59385046e53c56832cc7638bd96b5a5818c0efa963eac3022a696e1609
// @ac-hash: slice-381-ac-4 sha256:61c3cc9ff71e1a7e681ba02df683d7ea991677faf07768c69cc648c26108bd10
// @ac-hash: slice-381-ac-5 sha256:042403c9c5d6477b98df8e42269b27fd58ed7d312fb4de3f144167ff46067951

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, execSync, spawnSync } = require('node:child_process');

const { makeTmpDir, removeTmpDir } = require('../helpers/tmp-dir');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const GITIGNORE = path.join(REPO_ROOT, '.gitignore');
const LEDGER_REL = 'regression/AC-DECISIONS.json';

const {
  ensureRuntimeState,
  isVolatileRuntimePath,
  RUNTIME_FILES,
} = require('../../bridge/state/seed-runtime-state');

const orchestrator = require('../../bridge/orchestrator');
const { recordArchivedQueueRename, archiveAcceptedSlice, stageablePathsFrom } = orchestrator;

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function write(root, rel, body) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

// The `git status --porcelain` lines the autocommit would look at.
function dirtyTrackedLines(root) {
  return git(root, ['status', '--porcelain']).split('\n').filter(l => l && !l.startsWith('??'));
}

const REPORT_BODY = [
  '---', 'id: "9381"', 'status: DONE', 'branch: "slice/9381"', '---', '',
  '## Summary', '', 'The permanent record this queue exists to keep.', '',
].join('\n');

/**
 * A miniature of the live repository at the moment a slice is archived: this
 * repo's real ignore rules, a force-added queue report that git tracks under its
 * DONE name, and the runtime state ticking beside it.
 */
function makeArchiveRepo(label, { reportSuffix = 'DONE' } = {}) {
  const tmp = makeTmpDir(label);
  git(tmp, ['init', '-q', '-b', 'dev']);
  git(tmp, ['config', 'user.email', 'gate@denorios.test']);
  git(tmp, ['config', 'user.name', 'Regression Gate']);

  fs.copyFileSync(GITIGNORE, path.join(tmp, '.gitignore'));
  write(tmp, 'bridge/orchestrator.js', '// source\n');
  write(tmp, 'bridge/queue/.gitkeep', '');
  fs.mkdirSync(path.join(tmp, 'bridge', 'trash'), { recursive: true });
  write(tmp, `bridge/queue/9381-${reportSuffix}.md`, REPORT_BODY);
  git(tmp, ['add', '-A']);
  // Queue reports are ignored-but-tracked: force-added, exactly as the contract
  // that makes them permanent records requires.
  git(tmp, ['add', '-f', '--', `bridge/queue/9381-${reportSuffix}.md`]);
  git(tmp, ['commit', '-qm', 'base — the slice report is a tracked permanent record']);
  return tmp;
}

// gitFinalizer.runGit is only wired once the orchestrator's main() has run, and
// it would write LOCK_CLAIMED events into the live register. The recorder takes
// the runner as a seam for exactly this; it mirrors runGit's opts contract.
function tmpRunGit(tmp) {
  return (cmd, o) => {
    o = o || {};
    const execOpts = Object.assign({ cwd: o.cwd || tmp }, o.execOpts || {});
    if (o.encoding) execOpts.encoding = o.encoding;
    return execSync(cmd, execOpts);
  };
}

// Drive the real archival path against a throwaway repo. branchName is null so
// nothing tries to delete a branch in the live checkout.
function runArchive(tmp, opts) {
  orchestrator._testSetRegisterFile(path.join(tmp, 'register.jsonl'));
  orchestrator._testSetProjectDir(tmp);
  try {
    return archiveAcceptedSlice('9381', null, Object.assign({
      queueDir: path.join(tmp, 'bridge', 'queue'),
      trashDir: path.join(tmp, 'bridge', 'trash'),
      repoRoot: tmp,
      runGit: tmpRunGit(tmp),
    }, opts || {}));
  } finally {
    orchestrator._testSetProjectDir(REPO_ROOT);
    orchestrator._testSetRegisterFile(path.join(REPO_ROOT, 'bridge', 'register.jsonl'));
  }
}

// ---------------------------------------------------------------------------
// slice-381-ac-1 — the last tracked runtime file
// ---------------------------------------------------------------------------

test('slice-381-ac-1 the acceptance-decision ledger is untracked, ignored, still on disk and writable', () => {
  const tracked = git(REPO_ROOT, ['ls-files', '--', LEDGER_REL]);
  assert.equal(tracked, '',
    'AC-DECISIONS.json must not be tracked — the CHECK overlay rewrites it and a tracked copy dirties the tree');

  let ignored = true;
  try {
    execFileSync('git', ['check-ignore', '-q', '--', LEDGER_REL], { cwd: REPO_ROOT, stdio: 'ignore' });
  } catch (_) { ignored = false; }
  assert.ok(ignored, 'the ledger must be gitignored, or the next write lands untracked-but-committable');
  assert.ok(fs.readFileSync(GITIGNORE, 'utf8').includes(LEDGER_REL), `.gitignore must name ${LEDGER_REL}`);

  // Untracking is index-only: the running system keeps reading and writing it.
  const abs = path.join(REPO_ROOT, LEDGER_REL);
  assert.ok(fs.existsSync(abs), 'the ledger must survive on disk — the overlay reads it on every CHECK');
  assert.doesNotThrow(() => fs.accessSync(abs, fs.constants.R_OK | fs.constants.W_OK),
    'the ledger must stay readable and writable');

  // One list governs the ignore file, the seeder and the autocommit filter.
  assert.ok(RUNTIME_FILES.some(f => f.rel === LEDGER_REL),
    'the ledger must be in RUNTIME_FILES so the seeder rebuilds it on a fresh checkout');
  assert.ok(isVolatileRuntimePath(LEDGER_REL),
    'the autocommit filter must refuse the ledger even in the window where it is still tracked');
});

// ---------------------------------------------------------------------------
// slice-381-ac-2 — archiving records its own rename
// ---------------------------------------------------------------------------

test('slice-381-ac-2 archiving commits the rename, leaving no deletion for a later sweep', () => {
  const tmp = makeArchiveRepo('j-archive-rename', { reportSuffix: 'ACCEPTED' });
  try {
    const before = git(tmp, ['rev-parse', 'HEAD']);

    const result = runArchive(tmp);
    assert.equal(result.archived, true, 'the archival itself must succeed');
    assert.equal(result.renameRecorded, true, `the rename must be recorded, got reason=${result.renameReason}`);

    // One commit, carrying the old name out and the new one in.
    const head = git(tmp, ['rev-parse', 'HEAD']);
    assert.notEqual(head, before, 'archiving must produce the commit that records the rename');
    const changed = git(tmp, ['show', '--name-status', '--format=', 'HEAD']).split('\n').filter(Boolean);
    const paths = changed.map(l => l.split('\t').slice(1).join(' -> '));
    assert.ok(paths.some(p => p.includes('9381-ARCHIVED.md')), `the new name must be in the commit: ${changed.join(' | ')}`);
    assert.ok(paths.some(p => p.includes('9381-ACCEPTED.md')), `the old name must leave in the same commit: ${changed.join(' | ')}`);

    // …and nothing is left over for the next pre-checkout autocommit to find.
    const leftover = dirtyTrackedLines(tmp);
    assert.deepEqual(leftover, [],
      `an unexplained deletion is exactly what this fixes, got: ${leftover.join(' | ')}`);
    assert.deepEqual(stageablePathsFrom(leftover), [],
      'the autocommit must have nothing to stage after an archive');
  } finally {
    removeTmpDir(tmp);
  }
});

test('slice-381-ac-2 the rename is recorded on the integration branch and nowhere else', () => {
  const tmp = makeArchiveRepo('j-archive-rename-branch', { reportSuffix: 'ACCEPTED' });
  try {
    // backfillArchive runs at startup wherever HEAD happens to be. A commit on the
    // trunk would be local-only on the branch the promote gate fast-forwards.
    git(tmp, ['checkout', '-q', '-b', 'main']);
    const before = git(tmp, ['rev-parse', 'HEAD']);
    fs.renameSync(path.join(tmp, 'bridge/queue/9381-ACCEPTED.md'),
      path.join(tmp, 'bridge/queue/9381-ARCHIVED.md'));

    const result = recordArchivedQueueRename('9381', {
      repoRoot: tmp, queueDir: path.join(tmp, 'bridge', 'queue'), runGit: tmpRunGit(tmp),
    });
    assert.equal(result.recorded, false);
    assert.equal(result.reason, 'not_on_integration_branch');
    assert.equal(git(tmp, ['rev-parse', 'HEAD']), before, 'the trunk must not gain a local-only commit');
    assert.equal(git(tmp, ['diff', '--cached', '--name-only']), '', 'and nothing may be left staged');
  } finally {
    removeTmpDir(tmp);
  }
});

// ---------------------------------------------------------------------------
// slice-381-ac-3 — an ordinary slice run commits no paperwork
// ---------------------------------------------------------------------------

test('slice-381-ac-3 an ordinary slice run leaves the autocommit nothing to sweep', () => {
  const tmp = makeArchiveRepo('j-ordinary-run');
  try {
    // What an ordinary run writes: the runtime state ticks, the operator rules on
    // an AC in the CHECK overlay, and the accepted slice archives.
    ensureRuntimeState(tmp);
    write(tmp, 'bridge/heartbeat.json', '{"ts":"2026-09-05T10:00:00.000Z","status":"nog_review"}\n');
    write(tmp, 'bridge/timesheet.jsonl', '{"slice":"9381","tokens":41200}\n');
    write(tmp, LEDGER_REL, '{\n "slice-9381-ac-1": "keep"\n}');
    write(tmp, 'bridge/trash/nog-active.json.done', '{"slice":"9381"}\n');

    // The state machine walks the report forward to ACCEPTED, then archives it.
    fs.renameSync(path.join(tmp, 'bridge/queue/9381-DONE.md'),
      path.join(tmp, 'bridge/queue/9381-ACCEPTED.md'));
    assert.equal(runArchive(tmp).renameRecorded, true);

    const dirty = dirtyTrackedLines(tmp);
    assert.deepEqual(stageablePathsFrom(dirty), [],
      `an ordinary run must produce no autocommit at all, got: ${dirty.join(' | ')}`);

    // The commits on the branch are the slice's own — no `autocommit:` among them.
    const subjects = git(tmp, ['log', '--format=%s']).split('\n').filter(Boolean);
    assert.deepEqual(subjects.filter(s => s.startsWith('autocommit:')), [],
      'pipeline bookkeeping must never reach a commit of its own');
  } finally {
    removeTmpDir(tmp);
  }
});

// ---------------------------------------------------------------------------
// slice-381-ac-4 — the reports stay permanent records
// ---------------------------------------------------------------------------

test('slice-381-ac-4 the queue report stays tracked and retrievable under its new name', () => {
  const tmp = makeArchiveRepo('j-report-retrievable', { reportSuffix: 'ACCEPTED' });
  try {
    runArchive(tmp);

    const tracked = git(tmp, ['ls-files', '--', 'bridge/queue/']).split('\n').filter(Boolean);
    assert.ok(tracked.includes('bridge/queue/9381-ARCHIVED.md'),
      `the archived report must be tracked under its new name, got: ${tracked.join(', ')}`);
    assert.ok(!tracked.includes('bridge/queue/9381-ACCEPTED.md'),
      'the old name must be gone from the index — the rename moved, it did not duplicate');

    // Retrievable from the commit, byte for byte: this is the audit trail.
    assert.equal(git(tmp, ['show', 'HEAD:bridge/queue/9381-ARCHIVED.md']), REPORT_BODY.trim());
    // …and the old name is still reachable in history, so nothing was destroyed.
    assert.equal(git(tmp, ['show', 'HEAD~1:bridge/queue/9381-ACCEPTED.md']), REPORT_BODY.trim());

    // The live queue's own reports are untouched by this slice.
    const live = git(REPO_ROOT, ['ls-files', '--', 'bridge/queue/']).split('\n').filter(Boolean);
    assert.ok(live.filter(f => /-(DONE|ARCHIVED)\.md$/.test(f)).length >= 20,
      `the live queue must still track its reports as permanent records, found ${live.length} entries`);
  } finally {
    removeTmpDir(tmp);
  }
});

// ---------------------------------------------------------------------------
// slice-381-ac-5 — fixed forward
// ---------------------------------------------------------------------------

test('slice-381-ac-5 the existing history is not rewritten', () => {
  const autocommits = git(REPO_ROOT, ['log', '--format=%s', 'HEAD']).split('\n').filter(s => s.startsWith('autocommit:'));
  assert.ok(autocommits.length >= 20,
    `the pre-existing autocommits must remain in the log (found ${autocommits.length}) — this slice fixes forward`);
  // The two the brief names as the remaining damage, by their exact subjects.
  for (const subject of ['autocommit: pre-checkout-branch-slice/379', 'autocommit: pre-checkout-branch-slice/367']) {
    assert.ok(autocommits.some(s => s.startsWith(subject)), `${subject} must still be in the log`);
  }

  // …and the exact commits, by sha. Skipped on a shallow checkout, where the
  // objects are simply absent and their absence proves nothing.
  if (git(REPO_ROOT, ['rev-parse', '--is-shallow-repository']) === 'true') return;
  for (const sha of ['3f4126a', '027f09c', '2a5f9fb', '242442a']) {
    const contains = spawnSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd: REPO_ROOT });
    assert.equal(contains.status, 0, `${sha} must still be an ancestor of HEAD — this slice fixes forward, it does not rebase`);
  }
});

// ---------------------------------------------------------------------------
// Trap 1 — do not untrack the queue files to make the deletions go away
// ---------------------------------------------------------------------------

test('slice-381-ac-4 trap 1 nothing in this slice untracks a queue report', () => {
  // The cheap way to silence the deletions would be to stop tracking the reports.
  // That destroys the audit trail, so the ignore rules must keep the force-add
  // door open and the index must still hold every report it held before.
  const ignoreSrc = fs.readFileSync(GITIGNORE, 'utf8');
  assert.ok(!/^\s*bridge\/queue\/\*\*?\s*$/m.test(ignoreSrc),
    'the queue must stay force-addable — a blanket rule would make the reports uncommittable');

  const tracked = git(REPO_ROOT, ['ls-files', '--', 'bridge/queue/']).split('\n').filter(Boolean);
  const reports = tracked.filter(f => /-(DONE|ARCHIVED)\.md$/.test(f));
  assert.ok(reports.length >= 20, `the tracked reports must survive this slice, found ${reports.length}`);

  // Prove it against the branch point rather than a magic number: this slice
  // removed no report from the index. (No integration ref to compare against —
  // a bare CI checkout — leaves the count assertion above as the guard.)
  const baseRef = ['origin/dev', 'dev', 'origin/main', 'main']
    .find(ref => spawnSync('git', ['rev-parse', '--verify', '-q', ref], { cwd: REPO_ROOT }).status === 0);
  if (!baseRef) return;
  const base = git(REPO_ROOT, ['merge-base', 'HEAD', baseRef]);
  const removed = git(REPO_ROOT, ['diff', '--diff-filter=D', '--name-only', base, 'HEAD', '--', 'bridge/queue/'])
    .split('\n').filter(Boolean);
  assert.deepEqual(removed, [],
    `this slice must delete no queue report: ${removed.join(', ')}`);
});

// ---------------------------------------------------------------------------
// Trap 2 — a fresh clone must still work without the ledger
// ---------------------------------------------------------------------------

test('slice-381-ac-1 trap 2 a fresh checkout without the ledger seeds it and reads it as "nothing ruled"', () => {
  const tmp = makeTmpDir('j-ledger-fresh-clone');
  try {
    git(tmp, ['init', '-q', '-b', 'dev']);
    git(tmp, ['config', 'user.email', 'gate@denorios.test']);
    git(tmp, ['config', 'user.name', 'Regression Gate']);
    write(tmp, 'source.js', '// source\n');
    git(tmp, ['add', '-A']);
    git(tmp, ['commit', '-qm', 'fresh clone — the ledger was never tracked here']);

    const abs = path.join(tmp, LEDGER_REL);
    assert.ok(!fs.existsSync(abs), 'the fixture must start without the ledger');

    // Every reader defaults an unreadable ledger to {} — absent is "nothing ruled".
    const readJson = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return fb; } };
    assert.deepEqual(readJson(abs, {}), {},
      'an absent ledger must read as an empty decision set, not crash the CHECK gate');

    // …and the seeder puts a well-formed empty one back.
    const { seeded } = ensureRuntimeState(tmp);
    assert.ok(seeded.includes(LEDGER_REL), 'the seeder must rebuild the ledger a fresh clone lacks');
    assert.deepEqual(JSON.parse(fs.readFileSync(abs, 'utf8')), {},
      'a seeded ledger must claim no rulings that were never made');

    // A live ledger is never clobbered by a later boot.
    fs.writeFileSync(abs, '{"slice-9381-ac-1":"keep"}');
    assert.deepEqual(ensureRuntimeState(tmp).seeded, [], 'a second pass must seed nothing');
    assert.deepEqual(JSON.parse(fs.readFileSync(abs, 'utf8')), { 'slice-9381-ac-1': 'keep' });
  } finally {
    removeTmpDir(tmp);
  }
});

// ---------------------------------------------------------------------------
// Trap 3 — the untracking preserves history rather than purging it
// ---------------------------------------------------------------------------

test('slice-381-ac-5 trap 3 the ledger was untracked index-only, so its history survives', () => {
  // `git rm --cached` — the index forgets, nothing else does. The rulings recorded
  // before this slice are still retrievable, which is what lets the seeder restore
  // them instead of blanking the file on a checkout that lacks it.
  const revs = git(REPO_ROOT, ['rev-list', '-n', '5', 'HEAD', '--', LEDGER_REL]).split('\n').filter(Boolean);
  assert.ok(revs.length > 0, 'the ledger must still be reachable in history — untracking is not purging');

  const entry = RUNTIME_FILES.find(f => f.rel === LEDGER_REL);
  assert.equal(entry.restore, true,
    'a ruling is a human decision no tick recreates: restore it from history, never seed over it');

  // The file is still on disk here despite being untracked in this very commit.
  assert.ok(fs.existsSync(path.join(REPO_ROOT, LEDGER_REL)),
    '--cached spares the working tree; a real rm would have taken the live rulings with it');
});

// ---------------------------------------------------------------------------
// Trap 4 — the recorder must not deadlock, nor leave a half-staged index
// ---------------------------------------------------------------------------

test('slice-381-ac-2 trap 4 a failed rename commit leaves nothing staged and does not throw', () => {
  const tmp = makeArchiveRepo('j-archive-rename-fails', { reportSuffix: 'ACCEPTED' });
  try {
    // A pre-commit hook that refuses is the real failure mode: this runs in the
    // main working tree, where Layer 1 blocks anything but the watcher merge path.
    const hooks = path.join(tmp, 'refusing-hooks');
    fs.mkdirSync(hooks, { recursive: true });
    fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\necho "refused" >&2\nexit 1\n', { mode: 0o755 });
    git(tmp, ['config', 'core.hooksPath', hooks]);

    fs.renameSync(path.join(tmp, 'bridge/queue/9381-ACCEPTED.md'),
      path.join(tmp, 'bridge/queue/9381-ARCHIVED.md'));
    const before = git(tmp, ['rev-parse', 'HEAD']);

    // No throw: the archival already happened and must not be undone by git.
    let result;
    assert.doesNotThrow(() => {
      result = recordArchivedQueueRename('9381', {
        repoRoot: tmp, queueDir: path.join(tmp, 'bridge', 'queue'),
        runGit: tmpRunGit(tmp),
      });
    }, 'a git failure inside the merge path must be reported, not thrown');
    assert.equal(result.recorded, false);
    assert.equal(result.reason, 'git_failed');

    assert.equal(git(tmp, ['rev-parse', 'HEAD']), before, 'nothing may have been committed');
    assert.equal(git(tmp, ['diff', '--cached', '--name-only']), '',
      'a half-staged index is exactly what the next autocommit would sweep — it must be reset');

    // And it takes no lock of its own: the only one in play is git's index.lock,
    // which a git command fails on rather than waits for.
    const src = fs.readFileSync(path.join(REPO_ROOT, 'bridge', 'orchestrator.js'), 'utf8');
    const fn = src.slice(src.indexOf('function recordArchivedQueueRename('),
      src.indexOf('function archiveAcceptedSlice('));
    assert.ok(!/acquire|Mutex|while\s*\(|sleep|setTimeout/i.test(fn),
      'the recorder must not wait on anything — it runs inside the lock-holding merge path');
    assert.ok(/git reset -q HEAD --/.test(fn), 'the failure path must unstage what it staged');
  } finally {
    removeTmpDir(tmp);
  }
});
