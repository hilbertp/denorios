'use strict';

/**
 * Journey: J-no-nameless-commits
 * Category: Dispatch & Execution
 *
 * What this tests:
 *   The branch topology showed eleven commits on dev and named three. Of the eight
 *   nameless ones, four were a person's, three were the daemon's archive bookkeeping
 *   — and one was debris: `704975d`, "autocommit: pre-checkout-branch-slice/389
 *   [3 file(s) on dev]", which deleted three report files from git. Eight such
 *   autocommits in thirty days swept reports, the heartbeat, branch-state, the
 *   timesheet and a trash marker into history under a subject that told the operator
 *   nothing.
 *
 *   Root cause, structural: bridge/queue/*.md is gitignored yet the reports inside it
 *   are force-tracked, and the pipeline moves them by plain filesystem rename. Git
 *   reads the move as a deletion and the next landing's safety autocommit — whose
 *   only job is to rescue a PERSON's uncommitted source edit from the checkout about
 *   to overwrite it — committed the deletions.
 *
 *   After this slice: the autocommit refuses every pipeline-owned path; the archive
 *   rename rides the landing commit instead of following it; and every commit the
 *   pipeline writes starts with `S<id>: `, read by one helper the whole dashboard
 *   shares. A nameless commit on dev can then only come from a person.
 *
 * Guards:
 *   slice-395-ac-1 — the autocommit stages no pipeline-owned path, and still commits
 *                    a person's uncommitted source edit
 *   slice-395-ac-2 — a landing is ONE commit: squash + locks + report + archive
 *                    rename, with no chore commit afterwards
 *   slice-395-ac-3 — every pipeline commit subject starts with S<id>: and
 *                    sliceIdOfSubject labels it
 *   slice-395-ac-4 — the one-time index cleanup leaves nothing under bridge/queue and
 *                    moves no report on disk
 *
 *   Traps: 1 the autocommit must still save a person's source edit; 2 a failed amend
 *   must leave nothing half-staged; 3 the prefix helper must reproduce the squash
 *   subject j-s-numbering-squash-subject pins; 4 the cleanup is index-only.
 */

// @ac-hash: slice-395-ac-1 sha256:7f9342149e3dda34279a1466f44566bc09ca05b3075de77819b329b41d84d4ec
// @ac-hash: slice-395-ac-2 sha256:47802057779828a93a5d4911f4f6fd6dce5e043db38edd3d78c608f779a9a4f4
// @ac-hash: slice-395-ac-3 sha256:474a7fc9bfd47dbb70227ca6c5907a870f0a351a21640c2ac8ff845762ad6bff
// @ac-hash: slice-395-ac-4 sha256:ba711619a1ecb1458369da07f61887d0360046b02a4a631e9a5b642983ca301e

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { makeTmpDir, removeTmpDir } = require('../helpers/tmp-dir');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const GITIGNORE = path.join(REPO_ROOT, '.gitignore');

const { isPipelineOwnedPath } = require('../../bridge/state/seed-runtime-state');
const gitFinalizer = require('../../bridge/git-finalizer');
const { pipelineCommitSubject } = gitFinalizer;
const { sliceIdOfSubject } = require('../../dashboard/server');

const orchestrator = require('../../bridge/orchestrator');
const {
  stageablePathsFrom, autoCommitDirtyTree, stageQueueArchiveForLanding, revertQueueArchiveStaging,
  squashSliceToDev, archiveAcceptedSlice, recordArchivedQueueRename,
  _testSetProjectDir, _testSetRegisterFile, _testSetDirs,
} = orchestrator;

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Regression Gate', GIT_AUTHOR_EMAIL: 'gate@denorios.test',
  GIT_COMMITTER_NAME: 'Regression Gate', GIT_COMMITTER_EMAIL: 'gate@denorios.test',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
};
const git = (cwd, args) => execFileSync('git', args,
  { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// gitFinalizer.runGit's contract, backed by a plain shell in a fixture: the recorder
// and the landing's stager both take it as a seam so a test never reaches the live
// register through the real finalizer.
function shRunGit(root) {
  return (cmd, o) => execFileSync('sh', ['-c', cmd], {
    cwd: (o && o.cwd) || root, encoding: (o && o.encoding) || undefined,
    env: { ...process.env, ...GIT_ENV }, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function write(root, rel, body) {
  const abs = path.join(root, rel.split('/').join(path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

// The `git status --porcelain` lines the autocommit looks at: tracked changes only.
function dirtyTrackedLines(root) {
  return git(root, ['status', '--porcelain']).split('\n').filter(l => l && !l.startsWith('??'));
}

function report(id, title) {
  return [
    '---', `id: "${id}"`, 'from: rom', 'to: nog', 'status: DONE',
    `slice_id: "${id}"`, `branch: "slice/${id}"`, 'tokens_in: 0', 'tokens_out: 0',
    'elapsed_ms: 0', '---', '', '## Summary', '', title, '',
  ].join('\n');
}

// gitFinalizer.runGit defaults its cwd to the PROJECT_DIR handed to init(), and
// emits register events through the injected recorder. Point both at the fixture so
// nothing in these tests can reach the live bridge (#99992).
function bindFinalizer(root) {
  gitFinalizer.init({
    PROJECT_DIR: root, registerEvent: () => {}, log: () => {},
    HEARTBEAT_FILE: path.join(root, 'bridge', 'heartbeat.json'),
    QUEUE_DIR: path.join(root, 'bridge', 'queue'),
  });
}

/**
 * A miniature of the live repository: this repo's real ignore rules, source files,
 * and a force-added queue report — ignored-but-tracked, the way the contract that
 * makes reports permanent records requires.
 */
function makeRepo(label, { id = '9395', onDev = true } = {}) {
  const tmp = makeTmpDir(label);
  git(tmp, ['init', '-q', '-b', onDev ? 'dev' : 'main']);
  git(tmp, ['config', 'user.email', 'gate@denorios.test']);
  git(tmp, ['config', 'user.name', 'Regression Gate']);
  fs.copyFileSync(GITIGNORE, path.join(tmp, '.gitignore'));
  write(tmp, 'lib/engine.js', 'module.exports = 1;\n');
  write(tmp, 'bridge/orchestrator.js', '// source\n');
  write(tmp, 'bridge/queue/.gitkeep', '');
  fs.mkdirSync(path.join(tmp, 'bridge', 'trash'), { recursive: true });
  write(tmp, `bridge/queue/${id}-DONE.md`, report(id, 'a permanent record'));
  git(tmp, ['add', '-A']);
  git(tmp, ['add', '-f', '--', `bridge/queue/${id}-DONE.md`]);
  git(tmp, ['commit', '-qm', 'base — the report is a tracked permanent record']);
  return tmp;
}

// ---------------------------------------------------------------------------
// slice-395-ac-1 — the autocommit's only job is a person's source edit
// ---------------------------------------------------------------------------

test('slice-395-ac-1 the autocommit stages no pipeline-owned path and still commits a person\'s source edit', () => {
  const tmp = makeRepo('j-nameless-ac1');
  try {
    bindFinalizer(tmp);
    _testSetProjectDir(tmp);

    // Every path the brief names, dirtied the way an ordinary run dirties it. They
    // must be TRACKED to reach the autocommit at all — an ignored untracked file
    // never could — so this is the window the rule exists to close.
    const owned = [
      'bridge/queue/9395-DONE.md', 'bridge/staged/9395-STAGED.md',
      'bridge/trash/9395-ARCHIVED.md', 'bridge/state/branch-state.json',
      'bridge/logs/run.log', 'bridge/timesheet.jsonl', 'bridge/queue-order.json',
      'regression/AC-DECISIONS.json', 'regression/AC-CHECK.json', 'regression/TEST-DRIFT.json',
    ];
    for (const rel of owned) write(tmp, rel, 'seed\n');
    git(tmp, ['add', '-f', '--', ...owned]);
    git(tmp, ['commit', '-qm', 'the window: pipeline paperwork is still tracked here']);

    // Now an ordinary run: the pipeline rewrites its own paperwork and moves the
    // report out from under git, while a person leaves one source edit uncommitted.
    for (const rel of owned) {
      if (rel.endsWith('.md')) fs.rmSync(path.join(tmp, rel));     // a rename, to git a deletion
      else write(tmp, rel, 'rewritten by the run\n');
    }
    write(tmp, 'lib/engine.js', 'module.exports = 2; // a person was mid-thought\n');

    const lines = dirtyTrackedLines(tmp);
    for (const rel of owned) {
      assert.ok(isPipelineOwnedPath(rel), `${rel} must be pipeline-owned`);
    }
    assert.deepEqual(stageablePathsFrom(lines), ['lib/engine.js'],
      `only the person's source edit may be stageable, got: ${lines.join(' | ')}`);

    // …and the real function commits it.
    assert.equal(autoCommitDirtyTree('pre-checkout-branch-slice/9395', '9395'), true,
      'a person\'s uncommitted source edit must still be rescued before the checkout');

    const changed = git(tmp, ['show', '--name-only', '--format=', 'HEAD']).split('\n').filter(Boolean);
    assert.deepEqual(changed, ['lib/engine.js'],
      `the rescue commit must carry the source file and nothing else, got: ${changed.join(' | ')}`);
    const stillDirty = dirtyTrackedLines(tmp);
    assert.ok(stillDirty.length >= owned.length,
      'the pipeline\'s own paths must be left for the pipeline to record');
  } finally {
    _testSetProjectDir(REPO_ROOT);
    removeTmpDir(tmp);
  }
});

// ---------------------------------------------------------------------------
// slice-395-ac-2 — one landing, one commit
// ---------------------------------------------------------------------------

// A bare origin + clone with dev and a slice branch, the way the squash fixtures do
// it, plus the stub deriver scripts that make squashSliceToDev take its amend path.
function makeLandingRepo(label, id) {
  const tmp = makeTmpDir(label);
  const bare = path.join(tmp, 'bare.git');
  const work = path.join(tmp, 'work');
  git(tmp, ['init', '--quiet', '--bare', '--initial-branch=main', bare]);
  git(tmp, ['clone', '--quiet', bare, work]);
  git(work, ['config', 'user.email', 'gate@denorios.test']);
  git(work, ['config', 'user.name', 'Regression Gate']);

  fs.copyFileSync(GITIGNORE, path.join(work, '.gitignore'));
  write(work, 'lib/engine.js', 'module.exports = 1;\n');
  // Stubs: their only job is to exist, so the landing runs its regenerate-and-amend
  // step. The real derivers are covered by their own integrity tests.
  write(work, 'scripts/build-coverage-map.js', 'process.exit(0);\n');
  write(work, 'scripts/build-ac-manifest.js', 'process.exit(0);\n');
  write(work, 'regression/COVERAGE.lock', '{}\n');
  write(work, 'regression/AC-MANIFEST.lock', '{}\n');
  write(work, 'bridge/queue/.gitkeep', '');
  for (const d of ['state', 'queue', 'staged', 'trash', 'logs']) {
    fs.mkdirSync(path.join(work, 'bridge', d), { recursive: true });
  }
  write(work, 'bridge/state/branch-state.json', JSON.stringify({
    schema_version: 1,
    main: { tip_sha: null, tip_subject: null, tip_ts: null },
    dev: { tip_sha: null, tip_ts: null, commits_ahead_of_main: 0, commits: [], deferred_slices: [] },
    last_merge: null,
    gate: { status: 'IDLE', current_run: null, last_failure: null, last_pass: null },
  }, null, 2) + '\n');
  git(work, ['add', '-A']);
  git(work, ['commit', '-qm', 'base']);
  git(work, ['push', '--quiet', 'origin', 'main']);
  git(work, ['checkout', '--quiet', '-b', 'dev']);
  git(work, ['push', '--quiet', 'origin', 'dev']);

  // The builder's branch: product code plus his force-added report.
  git(work, ['checkout', '--quiet', '-b', `slice/${id}`]);
  write(work, 'lib/engine.js', 'module.exports = 2;\n');
  write(work, `bridge/queue/${id}-DONE.md`, report(id, 'the landed report'));
  git(work, ['add', '--', 'lib/engine.js']);
  git(work, ['add', '-f', '--', `bridge/queue/${id}-DONE.md`]);
  git(work, ['commit', '-qm', `AC: slice-${id}-ac-1: the engine returns two`]);
  git(work, ['checkout', '--quiet', 'dev']);

  // The live journey file: Nog accepted, so acceptAndMerge has already renamed
  // {id}-EVALUATING.md to {id}-ACCEPTED.md. It is untracked and ignored on dev.
  write(work, `bridge/queue/${id}-ACCEPTED.md`, report(id, 'the landed report'));

  const registerPath = path.join(work, 'bridge', 'register.jsonl');
  fs.writeFileSync(registerPath, '');
  bindFinalizer(work);
  _testSetProjectDir(work);
  _testSetRegisterFile(registerPath);
  _testSetDirs(path.join(work, 'bridge', 'queue'), path.join(work, 'bridge', 'staged'),
    path.join(work, 'bridge', 'trash'));
  return { tmp, work };
}

test('slice-395-ac-2 a landing is one commit: squash, locks, report and archive rename, with no chore commit after it', () => {
  const id = '9396';
  const { tmp, work } = makeLandingRepo('j-nameless-ac2', id);
  const prevFlag = process.env.DS9_USE_GATE_FLOW;
  try {
    const before = git(work, ['rev-list', '--count', 'dev']);

    const result = squashSliceToDev(id, 'One landing is one commit', `slice/${id}`, 'core');
    assert.equal(result.success, true, `the landing must succeed, got: ${result.error}`);

    const after = git(work, ['rev-list', '--count', 'dev']);
    assert.equal(Number(after) - Number(before), 1,
      'the landing must add exactly one commit to dev');

    const head = git(work, ['log', '-1', '--format=%s', 'dev']);
    assert.equal(head, `S${id}: One landing is one commit`);

    // Everything the landing owes is in that one commit, and the report arrives
    // under the name it will keep: the archive rename happened inside the amend, so
    // dev never sees the {id}-DONE.md name at all.
    const changed = git(work, ['show', '--name-status', '--format=', 'dev']).split('\n').filter(Boolean);
    const joined = changed.join(' | ');
    assert.ok(changed.includes(`A\tbridge/queue/${id}-ARCHIVED.md`),
      `the archived report must be in the landing commit: ${joined}`);
    assert.ok(!joined.includes(`${id}-DONE.md`),
      `and the name it left behind must never reach dev: ${joined}`);
    assert.ok(joined.includes('lib/engine.js'), `the slice's product code must be in it: ${joined}`);
    assert.ok(git(work, ['show', `dev:bridge/queue/${id}-ARCHIVED.md`]).includes('## Summary'),
      'the landed record must be retrievable under its archived name');

    // …and the archival that follows adds nothing of its own.
    const shaAfterLanding = git(work, ['rev-parse', 'dev']);
    const archived = archiveAcceptedSlice(id, `slice/${id}`);
    assert.equal(archived.archived, true,
      'the archival must still finish the job the landing started (worktree, branch, event)');
    assert.equal(git(work, ['rev-parse', 'dev']), shaAfterLanding,
      'no separate chore commit may follow a landing');

    const subjects = git(work, ['log', '--format=%s', 'dev']).split('\n').filter(Boolean);
    assert.deepEqual(subjects.filter(s => s.startsWith('chore(queue)')), [],
      'the archive bookkeeping must no longer be a commit of its own');

    // Nothing left half-recorded for a later sweep to find.
    const leftover = git(work, ['status', '--porcelain', '--', 'bridge/queue']);
    assert.equal(leftover, '', `the queue must read clean after a landing, got: ${leftover}`);
  } finally {
    if (prevFlag === undefined) delete process.env.DS9_USE_GATE_FLOW;
    _testSetProjectDir(REPO_ROOT);
    removeTmpDir(tmp);
  }
});

// ---------------------------------------------------------------------------
// slice-395-ac-3 — every pipeline commit says which slice it belongs to
// ---------------------------------------------------------------------------

test('slice-395-ac-3 every commit subject the pipeline writes starts with S<id>: and sliceIdOfSubject labels it', () => {
  // The three subjects the pipeline still writes, each through the one helper.
  const subjects = [
    pipelineCommitSubject('9397', 'One landing is one commit'),
    pipelineCommitSubject('9397', 'archive 9397-DONE.md -> 9397-ARCHIVED.md'),
    pipelineCommitSubject('9397', 'autocommit before checkout, 1 source file(s) a person left uncommitted (pre-checkout-branch-slice/9397, on dev)'),
  ];
  for (const s of subjects) {
    assert.ok(s.startsWith('S9397: '), `a pipeline subject must be labelled: ${s}`);
    assert.equal(sliceIdOfSubject(s), '9397',
      `the topology, History and the promote strip all read this: ${s}`);
  }

  // The four readers are one function now, so a labelled commit is labelled
  // everywhere — and a person's commit still claims no slice.
  assert.equal(sliceIdOfSubject('handoff to Alex: 394 retired, work done by hand'), null);
  assert.equal(sliceIdOfSubject('QA: give the six slice-389 trap tests their J-lanes prefix'), null,
    'a slice id mid-sentence is a reference, not a claim of authorship');
  assert.equal(sliceIdOfSubject('slice/42 legacy subject'), '42', 'history written before S<id>: still reads');

  // And every `git commit` the pipeline runs takes its message from the helper —
  // either spelled on the commit line, or through a local assigned from it just
  // above (the autocommit logs its subject before committing it).
  for (const rel of ['bridge/orchestrator.js', 'bridge/git-finalizer.js']) {
    const lines = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').split('\n');
    const messaged = lines
      .map((text, i) => ({ text, i }))
      .filter(({ text }) => /git commit/.test(text) && /(-m|-F)[ \t]/.test(text));
    assert.ok(rel !== 'bridge/orchestrator.js' || messaged.length >= 3,
      'the scan must find the pipeline\'s commit sites, or it is proving nothing');
    for (const { text, i } of messaged) {
      const near = lines.slice(Math.max(0, i - 12), i + 1).join('\n');
      assert.ok(/pipelineCommitSubject|\.squash-commit-msg/.test(near),
        `every message-bearing pipeline commit must be labelled through the helper — ${rel}:${i + 1}: ${text.trim()}`);
    }
  }
});

// ---------------------------------------------------------------------------
// slice-395-ac-4 — the one-time index cleanup is index-only
// ---------------------------------------------------------------------------

test('slice-395-ac-4 the index cleanup leaves nothing under bridge/queue and moves no report on disk', () => {
  // Part 1 — the postcondition, audited against THIS repository, which is the tree
  // the one-time cleanup was for. Every force-tracked queue path must be present on
  // disk (nothing reads as deleted) and git must see nothing under bridge/queue.
  const tracked = execFileSync('git', ['ls-files', 'bridge/queue', 'bridge/staged', 'bridge/trash'],
    { cwd: REPO_ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.ok(tracked.length > 0, 'the queue\'s permanent records must still be tracked');
  const vanished = tracked.filter(rel => !fs.existsSync(path.join(REPO_ROOT, rel.split('/').join(path.sep))));
  assert.deepEqual(vanished, [],
    `a force-tracked report whose disk copy moved reads as deleted and is what the next sweep would commit: ${vanished.join(' | ')}`);
  const status = execFileSync('git', ['status', '--porcelain', '--', 'bridge/queue'],
    { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  assert.equal(status, '', `git must show nothing under bridge/queue, got: ${status}`);

  // Part 2 — and the rule that keeps it that way. The autocommit used to be what
  // "cleared" this, destructively: it committed the deletions and took the records
  // out of git with them. It can no longer reach a queue path at all, so the only
  // thing that may record one is the pipeline step that moved it.
  const tmp = makeRepo('j-nameless-ac4');
  try {
    fs.renameSync(path.join(tmp, 'bridge/queue/9395-DONE.md'),
      path.join(tmp, 'bridge/queue/9395-ARCHIVED.md'));
    const lines = dirtyTrackedLines(tmp);
    assert.ok(lines.length > 0, 'precondition: the rename reads as a deletion to git');
    assert.deepEqual(stageablePathsFrom(lines), [],
      `no sweep may ever again record a queue path on the pipeline\'s behalf: ${lines.join(' | ')}`);
    assert.ok(isPipelineOwnedPath('bridge/queue/9395-DONE.md') &&
              isPipelineOwnedPath('bridge/trash/9395-DONE.md.cleanup-ARCHIVED-x'),
      'both the queue and the trash it is swept into belong to the pipeline');

    // Recording it is index-only: git goes quiet and no report on disk moves.
    const diskBefore = fs.readdirSync(path.join(tmp, 'bridge', 'queue')).sort();
    const recorded = recordArchivedQueueRename('9395', {
      repoRoot: tmp, queueDir: path.join(tmp, 'bridge', 'queue'), runGit: shRunGit(tmp),
    });
    assert.equal(recorded.recorded, true, `the rename must be recorded, got ${recorded.reason}`);
    assert.equal(git(tmp, ['status', '--porcelain', '--', 'bridge/queue']), '',
      'after the cleanup git must show nothing under bridge/queue');
    assert.deepEqual(fs.readdirSync(path.join(tmp, 'bridge', 'queue')).sort(), diskBefore,
      'the cleanup is an index change: no report file on disk may move');
    assert.ok(git(tmp, ['show', 'HEAD:bridge/queue/9395-ARCHIVED.md']).includes('## Summary'));
    assert.ok(git(tmp, ['rev-list', 'HEAD', '--', 'bridge/queue/9395-DONE.md']).length > 0,
      'the old name must stay reachable in history — recording a rename is not purging');
    assert.equal(git(tmp, ['log', '-1', '--format=%s']), 'S9395: archive 9395-DONE.md -> 9395-ARCHIVED.md',
      'and the commit that records it says which slice it belongs to');
  } finally {
    removeTmpDir(tmp);
  }
});

// ---------------------------------------------------------------------------
// Trap 1 — the autocommit exists for the person, and must keep working for them
// ---------------------------------------------------------------------------

test('slice-395-ac-1 trap 1 one dirty lib/ file and one deleted queue file: the first is committed, the second skipped', () => {
  const tmp = makeRepo('j-nameless-trap1');
  try {
    bindFinalizer(tmp);
    _testSetProjectDir(tmp);

    write(tmp, 'lib/engine.js', 'module.exports = 3; // uncommitted, and the checkout would eat it\n');
    fs.rmSync(path.join(tmp, 'bridge/queue/9395-DONE.md'));    // the pipeline's rename

    const lines = dirtyTrackedLines(tmp);
    assert.equal(lines.length, 2, `precondition: exactly two dirty tracked paths, got: ${lines.join(' | ')}`);

    assert.equal(autoCommitDirtyTree('pre-checkout-branch-slice/9395', '9395'), true);

    const changed = git(tmp, ['show', '--name-status', '--format=', 'HEAD']).split('\n').filter(Boolean);
    assert.deepEqual(changed, ['M\tlib/engine.js'],
      `the person's file is committed and the queue deletion is not, got: ${changed.join(' | ')}`);
    assert.equal(git(tmp, ['show', 'HEAD:lib/engine.js']).includes('module.exports = 3'), true);
    const queueStatus = git(tmp, ['status', '--porcelain', '--', 'bridge/queue']);
    assert.match(queueStatus, /^D\s+bridge\/queue\/9395-DONE\.md$/,
      `the queue deletion stays for the pipeline step that caused it: ${queueStatus}`);
    assert.deepEqual(stageablePathsFrom(dirtyTrackedLines(tmp)), [],
      'and it is still not something the autocommit would ever stage');
  } finally {
    _testSetProjectDir(REPO_ROOT);
    removeTmpDir(tmp);
  }
});

// ---------------------------------------------------------------------------
// Trap 2 — a failed landing leaves no half-staged index
// ---------------------------------------------------------------------------

test('slice-395-ac-2 trap 2 a landing whose amend fails unstages the archive rename and puts the ACCEPTED name back', () => {
  const id = '9398';
  const { tmp, work } = makeLandingRepo('j-nameless-trap2', id);
  try {
    // The amend's own failure mode: a deriver that exits non-zero. The landing is
    // then abandoned whole — dev rewound, nothing pushed — and the queue must read
    // exactly as it did before the attempt.
    write(work, 'scripts/build-ac-manifest.js', 'process.exit(1);\n');
    git(work, ['add', '--', 'scripts/build-ac-manifest.js']);
    git(work, ['commit', '-qm', 'a deriver that refuses']);
    const beforeSha = git(work, ['rev-parse', 'dev']);

    const result = squashSliceToDev(id, 'A landing that cannot finish', `slice/${id}`, 'core');
    assert.equal(result.success, false, 'the landing must fail, not half-succeed');
    assert.ok(/lock_regen_failed/.test(result.error), `got: ${result.error}`);

    assert.equal(git(work, ['rev-parse', 'dev']), beforeSha, 'dev must be rewound');
    assert.equal(git(work, ['diff', '--cached', '--name-only']), '',
      'a half-staged index is exactly what the autocommit used to sweep — it must be reset');
    assert.equal(git(work, ['status', '--porcelain']), '',
      'nothing at all may be left dirty or staged by an abandoned landing');

    // The slice must not read as archived — it never landed. The abandoned landing
    // then takes its own ERROR path, and WHAT that path swept is the proof the
    // rename was undone first: it found an ACCEPTED file, not an ARCHIVED one.
    assert.equal(fs.existsSync(path.join(work, 'bridge', 'queue', `${id}-ARCHIVED.md`)), false,
      'a slice archived without landing would never be retried');
    const swept = fs.readdirSync(path.join(work, 'bridge', 'trash'));
    assert.ok(swept.some(f => f.startsWith(`${id}-ACCEPTED.md.cleanup-ERROR`)),
      `the ERROR cleanup must have found the ACCEPTED name restored, got: ${swept.join(' | ')}`);
    assert.ok(!swept.some(f => f.startsWith(`${id}-ARCHIVED.md`)),
      'the ARCHIVED name must not survive an abandoned landing in any form');

    // And the unwind itself round-trips, in isolation: stage the rename, revert it,
    // and the index and the disk must both read exactly as they did before. This is
    // the half that a failing amend depends on and that nothing else exercises.
    const queueDir = path.join(work, 'bridge', 'queue');
    write(work, `bridge/queue/${id}-ACCEPTED.md`, report(id, 'the landed report'));
    const diskBefore = fs.readdirSync(queueDir).sort();
    const indexBefore = git(work, ['ls-files', '--', 'bridge/queue']);

    const staged = stageQueueArchiveForLanding(id, {
      repoRoot: work, queueDir, runGit: shRunGit(work),
    });
    assert.equal(staged.reason, 'ok', `precondition: the rename must have been staged, got ${staged.reason}`);
    assert.notEqual(git(work, ['diff', '--cached', '--name-only']), '',
      'precondition: something must be staged for the unwind to have work to do');

    revertQueueArchiveStaging(id, staged, { repoRoot: work, runGit: shRunGit(work) });
    assert.equal(git(work, ['diff', '--cached', '--name-only']), '',
      'the unwind must leave nothing staged');
    assert.deepEqual(fs.readdirSync(queueDir).sort(), diskBefore,
      'and the disk must read exactly as it did before the attempt');
    assert.equal(git(work, ['ls-files', '--', 'bridge/queue']), indexBefore,
      'and so must the index');
  } finally {
    _testSetProjectDir(REPO_ROOT);
    removeTmpDir(tmp);
  }
});

// ---------------------------------------------------------------------------
// Trap 3 — the prefix helper must reproduce the pinned squash subject
// ---------------------------------------------------------------------------

test('slice-395-ac-3 trap 3 the prefix helper produces exactly the S<id>: <title> subject the squash has always written', () => {
  // j-s-numbering-squash-subject has pinned this since slice 350.
  assert.equal(pipelineCommitSubject('042', 'Test Feature'), 'S042: Test Feature');
  assert.equal(pipelineCommitSubject(350, 'Retire the old numbering'), 'S350: Retire the old numbering');
  // Idempotent for the same slice: a caller that already spelled it is not doubled.
  assert.equal(pipelineCommitSubject('042', 'S042: Test Feature'), 'S042: Test Feature');
  // Untitled and unlabelled edges: never invent a slice that is not there.
  assert.equal(pipelineCommitSubject(null, 'a person\'s commit'), 'a person\'s commit');
  assert.equal(pipelineCommitSubject('', 'a person\'s commit'), 'a person\'s commit');

  // And the squash really routes through it.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'bridge', 'orchestrator.js'), 'utf8');
  assert.ok(/const commitMsg = `\$\{gitFinalizer\.pipelineCommitSubject\(sliceId, sliceTitle\)\}/.test(src),
    'the squash subject must come from the one helper');
});

// ---------------------------------------------------------------------------
// Trap 4 — the landing's staging touches the index, never the disk
// ---------------------------------------------------------------------------

test('slice-395-ac-4 trap 4 folding the rename into a landing stages the index and moves nothing but the ACCEPTED name', () => {
  const tmp = makeRepo('j-nameless-trap4');
  try {
    bindFinalizer(tmp);
    // On dev, mid-landing: the squash has written the builder's report to disk and
    // the accepted journey file sits beside it.
    write(tmp, 'bridge/queue/9395-ACCEPTED.md', report('9395', 'a permanent record'));
    const before = fs.readdirSync(path.join(tmp, 'bridge', 'queue')).sort();

    const staged = stageQueueArchiveForLanding('9395', {
      repoRoot: tmp, queueDir: path.join(tmp, 'bridge', 'queue'), runGit: shRunGit(tmp),
    });
    assert.equal(staged.reason, 'ok', `staging must succeed, got ${staged.reason}`);

    // Index only: nothing committed, and no NEW file on disk beyond the rename the
    // archival itself is (ACCEPTED became ARCHIVED; the report did not move).
    assert.equal(git(tmp, ['log', '--format=%s', '-1']), 'base — the report is a tracked permanent record',
      'the landing stages; it does not commit on its own');
    const after = fs.readdirSync(path.join(tmp, 'bridge', 'queue')).sort();
    assert.deepEqual(after, before.map(f => f === '9395-ACCEPTED.md' ? '9395-ARCHIVED.md' : f).sort(),
      `only the ACCEPTED name may move, got: ${after.join(' | ')}`);
    assert.equal(fs.existsSync(path.join(tmp, 'bridge/queue/9395-DONE.md')), true,
      'the report on disk must not move — archiveSiblingStateFiles sweeps it later, untracked');

    // The staged index is exactly the rename, and it survives being committed.
    const cached = git(tmp, ['diff', '--cached', '--name-status', '-M']).split('\n').filter(Boolean);
    assert.deepEqual(cached, ['R100\tbridge/queue/9395-DONE.md\tbridge/queue/9395-ARCHIVED.md'],
      `the index must hold the rename and nothing else, got: ${cached.join(' | ')}`);
  } finally {
    removeTmpDir(tmp);
  }
});
