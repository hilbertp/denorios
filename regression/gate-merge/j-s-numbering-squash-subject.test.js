'use strict';

// J-s-numbering — slice-350-ac-3: a new slice's squash commit subject is
// "S{id}: {title}" while the Slice-Id, Slice-Branch and AC trailer formats are
// unchanged. This is the CI-portable guard for the AC that was previously
// covered only by test/squash-slice-to-dev.test.js (intentionally outside the
// CI gate). Same fixture model: a throwaway bare+clone git repo in os.tmpdir(),
// the orchestrator redirected through its _testSet* hooks — live bridge state
// is never touched (#99992 rule).
//
// @ac-hash: slice-350-ac-3 sha256:132ee7f47f6ed32af361bb72fd530efe8abf463f6c31c44be539f0a14f022225

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { squashSliceToDev, _testSetProjectDir, _testSetRegisterFile, _testSetDirs } =
  require('../../bridge/orchestrator');

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Bashir Fixture', GIT_AUTHOR_EMAIL: 'bashir@fixture.test',
  GIT_COMMITTER_NAME: 'Bashir Fixture', GIT_COMMITTER_EMAIL: 'bashir@fixture.test',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
};
const git = (args, cwd) => execFileSync('git', args,
  { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

let tmp, workDir;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'j-squash-subject-'));
  const bareDir = path.join(tmp, 'bare.git');
  workDir = path.join(tmp, 'work');
  git(['init', '--quiet', '--bare', '--initial-branch=main', bareDir], tmp);
  git(['clone', '--quiet', bareDir, workDir], tmp);

  fs.writeFileSync(path.join(workDir, 'base.txt'), 'base\n');
  git(['add', 'base.txt'], workDir);
  git(['commit', '--quiet', '-m', 'initial'], workDir);
  git(['push', '--quiet', 'origin', 'main'], workDir);
  git(['checkout', '--quiet', '-b', 'dev'], workDir);
  git(['push', '--quiet', 'origin', 'dev'], workDir);
  // Repo-LOCAL identity: squashSliceToDev runs `git commit` with the plain
  // process env (no GIT_AUTHOR_*/GIT_COMMITTER_* injection), and a clean CI
  // runner has no global identity — without this, its commit aborts with
  // "unable to auto-detect email address" and the test fails only on CI.
  git(['config', 'user.email', 'bashir@fixture.test'], workDir);
  git(['config', 'user.name', 'Bashir Fixture'], workDir);

  git(['checkout', '--quiet', '-b', 'slice/042'], workDir);
  fs.writeFileSync(path.join(workDir, 'feature.txt'), 'new feature\n');
  git(['add', 'feature.txt'], workDir);
  git(['commit', '--quiet', '-m', 'slice work'], workDir);

  const bridgeDir = path.join(workDir, 'bridge');
  for (const d of ['state', 'queue', 'staged', 'trash'].map(x => path.join(bridgeDir, x))) {
    fs.mkdirSync(d, { recursive: true });
  }
  fs.writeFileSync(path.join(bridgeDir, 'state', 'branch-state.json'), JSON.stringify({
    schema_version: 1,
    main: { tip_sha: null, tip_subject: null, tip_ts: null },
    dev: { tip_sha: null, tip_ts: null, commits_ahead_of_main: 0, commits: [], deferred_slices: [] },
    last_merge: null,
    gate: { status: 'IDLE', current_run: null, last_failure: null, last_pass: null },
  }, null, 2) + '\n');
  const registerPath = path.join(bridgeDir, 'register.jsonl');
  fs.writeFileSync(registerPath, '');

  _testSetProjectDir(workDir);
  _testSetRegisterFile(registerPath);
  _testSetDirs(path.join(bridgeDir, 'queue'), path.join(bridgeDir, 'staged'), path.join(bridgeDir, 'trash'));
});

after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} });

test('slice-350-ac-3 a new slice squash commit subject is "S{id}: {title}" with Slice-Id and Slice-Branch trailers unchanged', () => {
  const result = squashSliceToDev('042', 'Test Feature', 'slice/042');
  assert.equal(result.success, true, `squash must succeed: ${JSON.stringify(result)}`);

  const body = git(['log', '-1', '--format=%B', 'dev'], workDir).trim();
  const subject = body.split('\n')[0];

  // The fused S-identity IS the subject — not the retired "slice 042:" form.
  assert.equal(subject, 'S042: Test Feature');
  assert.doesNotMatch(subject, /^slice /, 'the retired "slice N:" subject form must not come back');

  // Trailer formats unchanged by the S-numbering move.
  assert.match(body, /^Slice-Id: 042$/m, 'Slice-Id trailer format unchanged');
  assert.match(body, /^Slice-Branch: slice\/042$/m, 'Slice-Branch trailer format unchanged');
});
