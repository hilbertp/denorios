'use strict';

// J-locks-at-landing — slice 387: the pipeline owns the two lock files.
//
// Every commit must carry a regression/COVERAGE.lock and a regression/AC-MANIFEST.lock
// equal to a fresh regeneration (j-coverage-map-integrity, j-ac-manifest-integrity).
// Builders used to run the derivers by hand on their branch — 27 tool calls before a line
// of product code on slice 383, and two merge conflicts on nothing but the locks on 382.
// Now squashSliceToDev regenerates both INSIDE the landing commit, re-fills the landed
// report's metrics from the register, and carries the builder's test-move trailers into
// the squash message.
//
// Fixture model is j-s-numbering-squash-subject's: a throwaway bare+clone repo in
// os.tmpdir() with the orchestrator redirected through its _testSet* hooks, so the live
// bridge state is never touched (#99992 rule). This file's fixtures go further and copy
// the two derivers plus the libs they require, because the point of the slice is that the
// derivers actually run.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  squashSliceToDev, buildHashLines, buildDoneTemplate,
  _testSetProjectDir, _testSetRegisterFile, _testSetDirs,
} = require('../../bridge/orchestrator');
const { acHashOf } = require('../../scripts/build-ac-manifest');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Locks Fixture', GIT_AUTHOR_EMAIL: 'locks@fixture.test',
  GIT_COMMITTER_NAME: 'Locks Fixture', GIT_COMMITTER_EMAIL: 'locks@fixture.test',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
};
const git = (args, cwd) => execFileSync('git', args,
  { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const write = (root, rel, body) => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
};

const DERIVERS = ['scripts/build-coverage-map.js', 'scripts/build-ac-manifest.js'];
const DERIVER_LIBS = ['lib/ac-block.js', 'lib/ac-range-scan.js', 'lib/tests-needed.js', 'lib/assert-direction.js'];
const LOCKS = ['regression/COVERAGE.lock', 'regression/AC-MANIFEST.lock'];
const STALE = '{ "stale": true }\n';

// Both lock derivers and the suite's own naming guard scan RAW SOURCE for a call to
// test with a quoted title — including inside a string, and including inside a comment,
// which is why this one spells the shape out in words. A fixture's test line written
// here as a literal reads as one of THIS file's tests: an untagged name to
// j-gate-fail-retry, and a real tag to build-coverage-map, which would bake a criterion
// nobody declared into the very locks this slice hands to the pipeline. Assembling the
// call from a variable keeps the fixture's text out of title position for both.
const CALL = 'test';
const fixtureTest = name => `${CALL}(${JSON.stringify(name)}, () => {});`;

// The criterion the fixture's slice declares. Its text differs between the report's AC
// block and the commit trailer on purpose: the trailer is the immutable source, and which
// of the two the landed manifest holds is what proves the commit→regenerate→amend order.
const FIX_TAG = 'slice-999-ac-1';
const FALLBACK_TEXT = 'the slice-file fallback text, which the manifest must NOT keep';
const TRAILER_TEXT = 'the commit-trailer text, which the manifest must resolve to';

const cleanups = [];
process.on('exit', () => { for (const d of cleanups) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

/**
 * A bare+clone repo on dev, with the derivers installed and one tagged test under
 * regression/, ready for squashSliceToDev('999', …, 'slice/999').
 *
 * opts.withScripts  false → no scripts/ directory at all (the absent-script skip).
 * opts.doneMetrics  the metric lines the builder committed into his report.
 * opts.branchMsg    extra trailer lines on the slice branch's commit message.
 * opts.layer2Hook   install a pre-commit hook that refuses to run locked or without
 *                   DS9_WATCHER_MERGE=1, plus lock/unlock scripts that toggle a marker.
 */
function makeFixture(opts = {}) {
  const withScripts = opts.withScripts !== false;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'j-locks-landing-'));
  cleanups.push(tmp);
  const bareDir = path.join(tmp, 'bare.git');
  const workDir = path.join(tmp, 'work');

  git(['init', '--quiet', '--bare', '--initial-branch=main', bareDir], tmp);
  git(['clone', '--quiet', bareDir, workDir], tmp);

  // bridge/queue/*.md gitignored exactly as the real repo has it (.gitignore:20) — the
  // landed report only reaches the commit through `git add -f`.
  write(workDir, '.gitignore', 'bridge/queue/*.md\n');
  write(workDir, 'base.txt', 'base\n');
  write(workDir, 'regression/sample/j-sample.test.js', [
    "'use strict';",
    '',
    `// @ac-hash: ${FIX_TAG} ${acHashOf(TRAILER_TEXT)}`,
    "const { test } = require('node:test');",
    fixtureTest(`${FIX_TAG} the fixture's one tagged guard`),
    '',
  ].join('\n'));
  // Stale on purpose: the landing must overwrite both.
  for (const lock of LOCKS) write(workDir, lock, STALE);

  if (withScripts) {
    for (const rel of [...DERIVERS, ...DERIVER_LIBS]) {
      write(workDir, rel, fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
    }
  }

  for (const d of ['state', 'queue', 'staged', 'trash']) {
    fs.mkdirSync(path.join(workDir, 'bridge', d), { recursive: true });
  }
  write(workDir, 'bridge/state/branch-state.json', JSON.stringify({
    schema_version: 1,
    main: { tip_sha: null, tip_subject: null, tip_ts: null },
    dev: { tip_sha: null, tip_ts: null, commits_ahead_of_main: 0, commits: [], deferred_slices: [] },
    last_merge: null,
    gate: { status: 'IDLE', current_run: null, last_failure: null, last_pass: null },
  }, null, 2) + '\n');

  git(['add', '-A'], workDir);
  git(['commit', '--quiet', '-m', 'initial'], workDir);
  git(['push', '--quiet', 'origin', 'main'], workDir);
  git(['checkout', '--quiet', '-b', 'dev'], workDir);
  git(['push', '--quiet', 'origin', 'dev'], workDir);
  // Repo-LOCAL identity: squashSliceToDev commits with the plain process env, and a clean
  // CI runner has no global one — without this its commit aborts only on CI.
  git(['config', 'user.email', 'locks@fixture.test'], workDir);
  git(['config', 'user.name', 'Locks Fixture'], workDir);

  // ── the slice branch ──────────────────────────────────────────────────────
  git(['checkout', '--quiet', '-b', 'slice/999'], workDir);
  write(workDir, 'feature.txt', 'new feature\n');
  const metrics = opts.doneMetrics || ['tokens_in: 0', 'tokens_out: 0', 'elapsed_ms: 0'];
  write(workDir, 'bridge/queue/999-DONE.md', [
    '---',
    'id: "999"',
    'title: "fixture slice"',
    'from: rom',
    'to: nog',
    'status: DONE',
    'slice_id: "999"',
    'branch: "slice/999"',
    'completed: "2026-09-11T00:00:00.000Z"',
    ...metrics,
    'estimated_human_hours: 1.5',
    'compaction_occurred: false',
    '---',
    '',
    '## Summary',
    '',
    'fixture report.',
    '',
    '## Acceptance criteria',
    '',
    `- ${FIX_TAG}: ${FALLBACK_TEXT}`,
    '',
  ].join('\n'));
  git(['add', 'feature.txt'], workDir);
  git(['add', '-f', 'bridge/queue/999-DONE.md'], workDir);
  const msg = ['slice work', '', `AC: ${FIX_TAG}: ${TRAILER_TEXT}`, ...(opts.branchMsg || [])].join('\n');
  git(['commit', '--quiet', '-m', msg], workDir);
  git(['checkout', '--quiet', 'dev'], workDir);

  if (opts.layer2Hook) installLayer2Hook(workDir);

  const registerPath = path.join(workDir, 'bridge', 'register.jsonl');
  fs.writeFileSync(registerPath, opts.registerLines || '');

  _testSetProjectDir(workDir);
  _testSetRegisterFile(registerPath);
  _testSetDirs(path.join(workDir, 'bridge', 'queue'), path.join(workDir, 'bridge', 'staged'), path.join(workDir, 'bridge', 'trash'));

  return { tmp, bareDir, workDir, preSquashSha: git(['rev-parse', 'HEAD'], workDir) };
}

// A pre-commit hook that stands in for both enforcement layers: it refuses while the
// Layer-2 marker exists and refuses without DS9_WATCHER_MERGE=1. Installed after the
// setup commits so those are not caught by it.
function installLayer2Hook(workDir) {
  const hooks = path.join(workDir, '.githooks');
  fs.mkdirSync(hooks, { recursive: true });
  fs.writeFileSync(path.join(hooks, 'pre-commit'), [
    '#!/bin/sh',
    'root=$(git rev-parse --show-toplevel)',
    'if [ -f "$root/.layer2-locked" ]; then echo "layer 2 is locked" >&2; exit 1; fi',
    'if [ "$DS9_WATCHER_MERGE" != "1" ]; then echo "DS9_WATCHER_MERGE not set" >&2; exit 1; fi',
    'exit 0',
    '',
  ].join('\n'), { mode: 0o755 });
  git(['config', 'core.hooksPath', '.githooks'], workDir);

  write(workDir, 'scripts/lock-main.sh', '#!/bin/sh\ntouch "$(git rev-parse --show-toplevel)/.layer2-locked"\n');
  write(workDir, 'scripts/unlock-main.sh', '#!/bin/sh\nrm -f "$(git rev-parse --show-toplevel)/.layer2-locked"\n');
  fs.chmodSync(path.join(workDir, 'scripts', 'lock-main.sh'), 0o755);
  fs.chmodSync(path.join(workDir, 'scripts', 'unlock-main.sh'), 0o755);
  fs.writeFileSync(path.join(workDir, '.layer2-locked'), '');
}

// Run a deriver's own --check: exit 0 means the on-disk lock equals a fresh regeneration.
function derivedLockIsFresh(workDir, script) {
  try {
    execFileSync('node', [script, '--check'], { cwd: workDir, encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch (err) {
    return String((err && err.stderr) || err.message);
  }
}

const showOnDev = (workDir, rel) => git(['show', `dev:${rel}`], workDir);

// ───────────────────────────────────────────────────────────────────────────
// Acceptance criteria
// ───────────────────────────────────────────────────────────────────────────

// @ac-hash: slice-387-ac-1 sha256:19029b1273a9f194cda184e30c03f7c96871cda4a7ea7594cd3bed7ab83c63a5
test('J-locks-at-landing slice-387-ac-1 — a branch carrying stale locks lands on dev with both locks equal to a fresh regeneration, inside the single landing commit', () => {
  const { workDir, preSquashSha } = makeFixture();

  // What the builder committed is junk, and it is what the squash would otherwise land.
  assert.equal(git(['show', `slice/999:${LOCKS[0]}`], workDir) + '\n', STALE);

  const result = squashSliceToDev('999', 'Fixture Feature', 'slice/999');
  assert.equal(result.success, true, `squash must succeed: ${JSON.stringify(result)}`);

  for (const script of DERIVERS) {
    assert.equal(derivedLockIsFresh(workDir, script), true,
      `${script} --check must pass on the landed tree — the committed lock is not a fresh regeneration`);
  }
  for (const lock of LOCKS) {
    assert.notEqual(showOnDev(workDir, lock) + '\n', STALE, `${lock} must not still be the branch's stale copy`);
  }

  // One commit, not a squash plus a lock-fixing follow-up.
  assert.equal(git(['rev-list', '--count', `${preSquashSha}..dev`], workDir), '1');
  assert.equal(git(['log', '-1', '--format=%s', 'dev'], workDir), 'S999: Fixture Feature');
});

// @ac-hash: slice-387-ac-2 sha256:969ea1c5fff051f586d4e4428cab411415571f08b664c6de3626bf092cc1ad97
test('J-locks-at-landing slice-387-ac-2 — the event, branch-state and the push all carry the AMENDED sha', () => {
  const { workDir, bareDir } = makeFixture();

  const result = squashSliceToDev('999', 'Fixture Feature', 'slice/999');
  assert.equal(result.success, true, `squash must succeed: ${JSON.stringify(result)}`);

  const landed = git(['rev-parse', 'dev'], workDir);
  assert.equal(result.dev_sha, landed, 'the returned sha is the amended commit, not the pre-amend one');
  // What makes it the AMENDED sha and not merely a consistent one: the commit it names
  // carries the regenerated locks. Reading devSha before the amend would name a commit
  // that still has the branch's stale copies.
  assert.notEqual(git(['show', `${landed}:${LOCKS[0]}`], workDir), STALE.trim(),
    'the recorded sha must point at the commit that carries the fresh locks');

  const events = fs.readFileSync(path.join(workDir, 'bridge', 'register.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map(JSON.parse)
    .filter(e => e.event === 'SLICE_SQUASHED_TO_DEV');
  assert.equal(events.length, 1);
  assert.equal(events[0].squash_sha, landed, 'squash_sha is what the rollback button reverts — it must be the landed sha');
  assert.equal(events[0].dev_tip_sha, landed);

  const state = JSON.parse(fs.readFileSync(path.join(workDir, 'bridge', 'state', 'branch-state.json'), 'utf8'));
  assert.equal(state.dev.tip_sha, landed);
  assert.equal(state.dev.commits.at(-1).sha, landed);

  // The push carried the amended commit, so origin and the local tip agree.
  assert.equal(git(['rev-parse', 'dev'], bareDir), landed);
});

// @ac-hash: slice-387-ac-2 sha256:969ea1c5fff051f586d4e4428cab411415571f08b664c6de3626bf092cc1ad97
test('J-locks-at-landing slice-387-ac-2 — when regeneration fails nothing is pushed, an ERROR file names lock_regen_failed, and dev is back at its pre-squash sha', () => {
  const { workDir, bareDir, preSquashSha } = makeFixture();

  // An uncommitted test file in the tree: the derivers read the working tree, so letting
  // this one through would bake a file nobody committed into the lock.
  write(workDir, 'regression/sample/j-uncommitted.test.js', fixtureTest('slice-999-ac-9 nobody committed me') + '\n');

  const result = squashSliceToDev('999', 'Fixture Feature', 'slice/999');
  assert.equal(result.success, false);
  assert.match(result.error, /^lock_regen_failed: /);
  assert.match(result.error, /j-uncommitted\.test\.js/, 'the detail names the offending path');

  assert.equal(git(['rev-parse', 'dev'], workDir), preSquashSha, "dev's local tip is back where it started");
  assert.equal(git(['rev-parse', 'dev'], bareDir), preSquashSha, 'nothing was pushed');

  const errorFile = path.join(workDir, 'bridge', 'queue', '999-ERROR.md');
  assert.ok(fs.existsSync(errorFile), 'an ERROR file must be written');
  assert.match(fs.readFileSync(errorFile, 'utf8'), /lock_regen_failed/);

  const errs = fs.readFileSync(path.join(workDir, 'bridge', 'register.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map(JSON.parse).filter(e => e.event === 'ERROR');
  assert.equal(errs.length, 1);
  assert.equal(errs[0].reason, 'lock_regen_failed');
});

// @ac-hash: slice-387-ac-2 sha256:969ea1c5fff051f586d4e4428cab411415571f08b664c6de3626bf092cc1ad97
test('J-locks-at-landing slice-387-ac-2 — an untracked DIRECTORY of test files trips the dirty guard too, rather than being collapsed to one line and baked into the lock', () => {
  const { workDir, bareDir, preSquashSha } = makeFixture();

  // Plain `git status --porcelain` reports a wholly untracked directory as a single
  // `?? regression/newdir/` line, which is not a .test.js path and so clears the guard —
  // but the deriver walks into it regardless. Only -uall names the file inside.
  write(workDir, 'regression/newdir/j-hidden.test.js',
    fixtureTest('slice-999-ac-8 nobody committed my directory either') + '\n');

  const result = squashSliceToDev('999', 'Fixture Feature', 'slice/999');
  assert.equal(result.success, false);
  assert.match(result.error, /^lock_regen_failed: /);
  assert.match(result.error, /regression\/newdir\/j-hidden\.test\.js/,
    'the detail must name the file inside the untracked directory, not the directory');

  assert.equal(git(['rev-parse', 'dev'], bareDir), preSquashSha, 'nothing was pushed');
  assert.doesNotMatch(git(['show', 'dev:regression/COVERAGE.lock'], workDir), /slice-999-ac-8/,
    'a tag from an uncommitted file must never reach a landed lock');
});

// @ac-hash: slice-387-ac-3 sha256:dc1b3aebafd58ce2d20e07117669750bbcce302db37f92b44051a1f9ed213451
test('J-locks-at-landing slice-387-ac-3 — a drift conflict on the two locks alone completes by taking dev\'s copies; any other conflict still fails as merge_conflict', () => {
  // Lock-only conflict: both sides moved both locks after the common ancestor.
  const a = makeFixture();
  git(['checkout', '--quiet', 'slice/999'], a.workDir);
  for (const lock of LOCKS) write(a.workDir, lock, '{ "side": "branch" }\n');
  git(['add', ...LOCKS], a.workDir);
  git(['commit', '--quiet', '-m', 'branch touches the locks'], a.workDir);
  git(['checkout', '--quiet', 'dev'], a.workDir);
  for (const lock of LOCKS) write(a.workDir, lock, '{ "side": "dev" }\n');
  git(['add', ...LOCKS], a.workDir);
  git(['commit', '--quiet', '-m', 'dev touches the locks'], a.workDir);
  git(['push', '--quiet', 'origin', 'dev'], a.workDir);

  const ok = squashSliceToDev('999', 'Fixture Feature', 'slice/999');
  assert.equal(ok.success, true, `a lock-only drift conflict must resolve itself: ${JSON.stringify(ok)}`);
  for (const script of DERIVERS) {
    assert.equal(derivedLockIsFresh(a.workDir, script), true, `${script} --check must pass after a resolved lock drift`);
  }

  // Any other conflicting path: unchanged merge_conflict behaviour.
  const b = makeFixture();
  git(['checkout', '--quiet', 'slice/999'], b.workDir);
  write(b.workDir, LOCKS[0], '{ "side": "branch" }\n');
  write(b.workDir, 'base.txt', 'branch edit\n');
  git(['add', LOCKS[0], 'base.txt'], b.workDir);
  git(['commit', '--quiet', '-m', 'branch touches a lock and a real file'], b.workDir);
  git(['checkout', '--quiet', 'dev'], b.workDir);
  write(b.workDir, LOCKS[0], '{ "side": "dev" }\n');
  write(b.workDir, 'base.txt', 'dev edit\n');
  git(['add', LOCKS[0], 'base.txt'], b.workDir);
  git(['commit', '--quiet', '-m', 'dev touches a lock and a real file'], b.workDir);
  git(['push', '--quiet', 'origin', 'dev'], b.workDir);

  const bad = squashSliceToDev('999', 'Fixture Feature', 'slice/999');
  assert.equal(bad.success, false);
  assert.match(bad.error, /^merge_conflict:/);
  assert.ok(bad.conflicting_files.includes('base.txt'), 'the real conflict is still reported');
});

// @ac-hash: slice-387-ac-4 sha256:fc9647a05f9c40bcb3e6a821a573351729b5018f242e28dc574970f5dd584627
test('J-locks-at-landing slice-387-ac-4 — buildHashLines returns one acHashOf line per tagged criterion, and the template carries them under Your hash lines', () => {
  assert.equal(typeof buildHashLines, 'function', 'buildHashLines must be exported');

  const brief = [
    '## Acceptance criteria',
    '',
    '- slice-412-ac-1: the first criterion',
    '- slice-412-ac-3: the   second   criterion, non-contiguous on purpose',
    '',
    '## Files expected to change',
    '',
    '- nothing',
  ].join('\n');

  const lines = buildHashLines(brief);
  assert.equal(lines.length, 2, 'one line per tagged criterion, and none for the other headings');
  assert.equal(lines[0].trim(), `// @ac-hash: slice-412-ac-1 ${acHashOf('the first criterion')}`);
  assert.equal(lines[1].trim(), `// @ac-hash: slice-412-ac-3 ${acHashOf('the   second   criterion, non-contiguous on purpose')}`);
  // The hash is the criterion's own, not a hash of the tag or of the whole line.
  assert.notEqual(acHashOf('the first criterion'), acHashOf('the second criterion'));

  const tpl = buildDoneTemplate({ id: '412', worktreeDonePath: '/tmp/x/412-DONE.md', sliceBranch: 'slice/412', sliceContent: brief });
  assert.match(tpl, /^## Your hash lines$/m, 'the template carries the heading');
  for (const line of lines) {
    assert.ok(tpl.includes(line), `the template carries ${line.trim()}`);
  }
  assert.ok(tpl.indexOf('## Your hash lines') < tpl.indexOf(lines[0]), 'the lines sit under the heading');
});

// @ac-hash: slice-387-ac-5 sha256:f059f50cba75537a077a8f4abad7b7794e4134da3a929f045711cfd3b286eafd
test('J-locks-at-landing slice-387-ac-5 — the template tells him not to run the derivers, not to edit the locks, and to stage the report with git add -f', () => {
  const brief = ['## Acceptance criteria', '', '- slice-412-ac-1: a criterion'].join('\n');
  const tpl = buildDoneTemplate({ id: '412', worktreeDonePath: '/tmp/x/412-DONE.md', sliceBranch: 'slice/412', sliceContent: brief });

  assert.match(tpl, /Do not run build-coverage-map or build-ac-manifest/,
    'the template must name both derivers as things he does not run');
  assert.match(tpl, /do not edit regression\/\*\.lock/,
    'the template must put the lock files out of bounds');
  assert.match(tpl, /the pipeline regenerates them when the slice lands/,
    'and say who does own them, so the instruction is a handover rather than a prohibition');
  assert.match(tpl, /git add -f bridge\/queue\/412-DONE\.md/,
    'the template must give the -f form, because bridge/queue/*.md is gitignored');

  // The rule holds even for a brief with no tagged criteria: it is the rule, not the data.
  const bare = buildDoneTemplate({ id: '413', worktreeDonePath: '/tmp/x/413-DONE.md', sliceBranch: 'slice/413', sliceContent: '# no criteria here' });
  assert.match(bare, /do not edit regression\/\*\.lock/);
  assert.match(bare, /git add -f bridge\/queue\/413-DONE\.md/);
});

// @ac-hash: slice-387-ac-6 sha256:fde4a5edbd3c5155c06da18858a9061a33587a3a24a2d0ba2aa0ac7ac1b4e66d
test('J-locks-at-landing slice-387-ac-6 — the landed report carries the newest DONE event\'s metrics, not the zeros he committed, with elapsed_ms from durationMs', () => {
  // Two DONE events: a first round and the one that actually produced the landed code.
  const registerLines = [
    JSON.stringify({ ts: '2026-09-10T10:00:00.000Z', slice_id: '999', event: 'DONE', durationMs: 111, tokensIn: 1, tokensOut: 2, tokensCacheRead: 3, costUsd: 0.01 }),
    JSON.stringify({ ts: '2026-09-11T10:00:00.000Z', slice_id: '999', event: 'DONE', durationMs: 874321, tokensIn: 45678, tokensOut: 9012, tokensCacheRead: 345678, costUsd: 1.23 }),
    JSON.stringify({ ts: '2026-09-11T11:00:00.000Z', slice_id: '998', event: 'DONE', durationMs: 999, tokensIn: 99, tokensOut: 99, tokensCacheRead: 99, costUsd: 9.99 }),
  ].join('\n') + '\n';

  const { workDir } = makeFixture({ registerLines });

  // What he committed is zeros — the template told him to leave them alone.
  assert.match(git(['show', 'slice/999:bridge/queue/999-DONE.md'], workDir), /^tokens_in: 0$/m);

  const result = squashSliceToDev('999', 'Fixture Feature', 'slice/999');
  assert.equal(result.success, true, `squash must succeed: ${JSON.stringify(result)}`);

  const landed = showOnDev(workDir, 'bridge/queue/999-DONE.md');
  assert.match(landed, /^tokens_in: 45678$/m, 'the newest DONE event wins, not the first round');
  assert.match(landed, /^tokens_out: 9012$/m);
  assert.match(landed, /^tokens_cache_read: 345678$/m);
  assert.match(landed, /^cost_usd: 1\.23$/m);
  assert.match(landed, /^elapsed_ms: 874321$/m, "the event spells it durationMs; the report spells it elapsed_ms");
  assert.doesNotMatch(landed, /^elapsed_ms: 0$/m);

  // Rom's own judgment fields are his, and the body is untouched.
  assert.match(landed, /^estimated_human_hours: 1\.5$/m);
  assert.match(landed, /^## Summary$/m);
  assert.match(landed, /fixture report\./);
});

// @ac-hash: slice-387-ac-7 sha256:6d91ae759f650405d152d60e1a04a5cbce5a59722c81dceff5c70993abcbd733
test('J-locks-at-landing slice-387-ac-7 — the landing message carries the three test-move trailers once each after the AC lines, and no human-only trailer', () => {
  const { workDir } = makeFixture({
    branchMsg: [
      'Tests-Not-Needed: dashboard/**/*.css a stylesheet has no behaviour to guard',
      'Test-Loosen-OK: slice-999-ac-1 reworded the criterion was restated',
      'Test-Loosen-OK: slice-999-ac-1 reworded the criterion was restated',
      'Coverage-Removed: bridge/dead-module.js the module was deleted',
      'AC-Change-OK: slice-999-ac-1 mutated I would like to authorise myself',
      'Spec-Owner: rom',
    ],
  });

  const result = squashSliceToDev('999', 'Fixture Feature', 'slice/999');
  assert.equal(result.success, true, `squash must succeed: ${JSON.stringify(result)}`);

  const body = git(['log', '-1', '--format=%B', 'dev'], workDir);

  assert.match(body, /^Tests-Not-Needed: dashboard\/\*\*\/\*\.css a stylesheet has no behaviour to guard$/m);
  assert.match(body, /^Coverage-Removed: bridge\/dead-module\.js the module was deleted$/m);
  const loosen = body.split('\n').filter(l => /^Test-Loosen-OK:/.test(l));
  assert.equal(loosen.length, 1, 'a trailer written on two commits is carried once, not twice');

  // The human-only pair is dropped: carrying it would let a builder clear his own
  // AC-MUTATED finding with a signature he typed himself.
  assert.doesNotMatch(body, /^AC-Change-OK:/m);
  assert.doesNotMatch(body, /^Spec-Owner:/m);

  // Order: AC lines first, then the moves.
  assert.ok(body.indexOf(`AC: ${FIX_TAG}:`) < body.indexOf('Tests-Not-Needed:'),
    'the AC lines come first, as the gate reads them');
});

// ───────────────────────────────────────────────────────────────────────────
// Traps
// ───────────────────────────────────────────────────────────────────────────

test('J-locks-at-landing slice-387-trap-1 — regeneration runs AFTER the commit, so a new criterion resolves to its trailer and not to the slice-file fallback', () => {
  const { workDir } = makeFixture();

  const result = squashSliceToDev('999', 'Fixture Feature', 'slice/999');
  assert.equal(result.success, true, `squash must succeed: ${JSON.stringify(result)}`);

  const manifest = JSON.parse(showOnDev(workDir, 'regression/AC-MANIFEST.lock'));
  const entry = manifest.byTag[FIX_TAG];
  assert.ok(entry, `${FIX_TAG} must be in the landed manifest`);
  assert.equal(entry.source, 'commit-trailer',
    'regenerating before the commit would leave this sourced from the slice file');
  assert.equal(entry.text, TRAILER_TEXT);
  assert.notEqual(entry.text, FALLBACK_TEXT, 'the trailer is the immutable source, not the report copy');
  assert.equal(entry.acHash, acHashOf(TRAILER_TEXT));
});

test('J-locks-at-landing slice-387-trap-2 — the amend happens strictly before the push, so a failure between commit and amend pushes nothing', () => {
  const { workDir, bareDir, preSquashSha } = makeFixture();

  // Break the manifest deriver so it exits non-zero AFTER the squash commit exists —
  // the exact window where an amend that had already been pushed would be public history.
  fs.writeFileSync(path.join(workDir, 'scripts', 'build-ac-manifest.js'),
    "process.stderr.write('deriver exploded\\n'); process.exit(3);\n");
  git(['add', 'scripts/build-ac-manifest.js'], workDir);
  git(['commit', '--quiet', '-m', 'break the deriver'], workDir);
  git(['push', '--quiet', 'origin', 'dev'], workDir);
  const breakSha = git(['rev-parse', 'dev'], workDir);
  assert.notEqual(breakSha, preSquashSha);

  const result = squashSliceToDev('999', 'Fixture Feature', 'slice/999');
  assert.equal(result.success, false);
  assert.match(result.error, /^lock_regen_failed: /);
  assert.match(result.error, /build-ac-manifest\.js exited non-zero/);

  assert.equal(git(['rev-parse', 'dev'], bareDir), breakSha, 'origin/dev never moved');
  assert.equal(git(['rev-parse', 'dev'], workDir), breakSha, 'and the local tip was rewound to it');
  assert.equal(git(['log', '--format=%s', 'dev'], workDir).split('\n').filter(s => s === 'S999: Fixture Feature').length, 0,
    'no landing commit survives anywhere');
});

test('J-locks-at-landing slice-387-trap-3 — the branch\'s own locks are overwritten, not merged, and the slice still lands as one commit', () => {
  const { workDir, preSquashSha } = makeFixture();

  const branchLocks = LOCKS.map(l => git(['show', `slice/999:${l}`], workDir));
  assert.deepEqual(branchLocks, [STALE.trim(), STALE.trim()], 'the branch really is carrying stale locks');

  const result = squashSliceToDev('999', 'Fixture Feature', 'slice/999');
  assert.equal(result.success, true, `squash must succeed: ${JSON.stringify(result)}`);

  for (const lock of LOCKS) {
    const landed = showOnDev(workDir, lock);
    assert.notEqual(landed, STALE.trim(), `${lock} kept the branch's stale copy`);
    assert.ok(landed.length > STALE.length, `${lock} looks like a real derived map`);
  }
  // Exactly one new commit, and the amend left no orphan predecessor on dev.
  assert.equal(git(['rev-list', '--count', `${preSquashSha}..dev`], workDir), '1');
  // The landed commit is a first-parent child of the pre-squash tip: an amend, not a follow-up.
  assert.equal(git(['rev-parse', 'dev^'], workDir), preSquashSha);
});

test('J-locks-at-landing slice-387-trap-4 — the amend runs inside DS9_WATCHER_MERGE and the open Layer-2 lock, not after the finally re-locks', () => {
  const { workDir } = makeFixture({ layer2Hook: true });

  // Start from the unset state, so the hook's DS9_WATCHER_MERGE arm is a real check
  // rather than one satisfied by an earlier test in this file.
  delete process.env.DS9_WATCHER_MERGE;
  assert.ok(fs.existsSync(path.join(workDir, '.layer2-locked')), 'the fixture starts locked');

  const result = squashSliceToDev('999', 'Fixture Feature', 'slice/999');
  assert.equal(result.success, true,
    `both the squash commit and the amend must pass a hook that refuses while locked or without DS9_WATCHER_MERGE: ${JSON.stringify(result)}`);

  for (const script of DERIVERS) {
    assert.equal(derivedLockIsFresh(workDir, script), true, `${script} --check must pass — the amend really ran`);
  }
  assert.ok(fs.existsSync(path.join(workDir, '.layer2-locked')), 'and Layer 2 is re-locked by the finally afterwards');
});

test('J-locks-at-landing slice-387-trap-5 — a repo with no derivers skips regeneration and still squashes, so the older squash fixtures stay green', () => {
  const { workDir, bareDir, preSquashSha } = makeFixture({ withScripts: false });
  assert.ok(!fs.existsSync(path.join(workDir, 'scripts')), 'this fixture has no scripts/ directory at all');

  const result = squashSliceToDev('999', 'Fixture Feature', 'slice/999');
  assert.equal(result.success, true, `the absent-script skip must keep this succeeding: ${JSON.stringify(result)}`);
  assert.equal(git(['rev-parse', 'dev'], workDir), result.dev_sha);
  assert.equal(git(['rev-parse', 'dev'], bareDir), result.dev_sha, 'and it still pushes');
  assert.equal(git(['rev-list', '--count', `${preSquashSha}..dev`], workDir), '1');
  assert.ok(!fs.existsSync(path.join(workDir, 'bridge', 'queue', '999-ERROR.md')), 'no ERROR file for a skipped regeneration');
});

test('J-locks-at-landing slice-387-trap-6 — the failure path rewinds with --keep, so a locally modified file the squash never touched survives', () => {
  const { workDir, preSquashSha } = makeFixture();

  // A tracked file the slice does not touch, modified in the live tree and uncommitted —
  // the crew's work-in-progress. `git reset --hard` would erase it.
  write(workDir, 'base.txt', 'the crew was in the middle of something\n');

  // Fail the regeneration.
  write(workDir, 'regression/sample/j-uncommitted.test.js', fixtureTest('slice-999-ac-9 nobody committed me') + '\n');

  const result = squashSliceToDev('999', 'Fixture Feature', 'slice/999');
  assert.equal(result.success, false);
  assert.match(result.error, /^lock_regen_failed: /);

  assert.equal(fs.readFileSync(path.join(workDir, 'base.txt'), 'utf8'), 'the crew was in the middle of something\n',
    'a --hard reset would have thrown this away');
  assert.equal(git(['rev-parse', 'dev'], workDir), preSquashSha);

  // And the rule is stated in the source, not just honoured by this one fixture.
  const orch = fs.readFileSync(path.join(REPO_ROOT, 'bridge', 'orchestrator.js'), 'utf8');
  const fn = orch.slice(orch.indexOf('function regenerateLocksAtLanding'), orch.indexOf('function squashSliceToDev'));
  assert.ok(fn.length > 0, 'regenerateLocksAtLanding must sit above squashSliceToDev');
  assert.doesNotMatch(fn, /reset\s+--hard/, 'the landing failure path must never use git reset --hard');
  assert.match(fn, /reset\s+--keep/);
});
