'use strict';

/**
 * Journey: J-commit-kind
 * Category: Dispatch & Execution
 *
 * What this tests (spec = the journey, not the implementation):
 *   Every node on dev says what KIND of thing it is. The pipeline declares it in a
 *   `Kind:` trailer on the commits it writes — `S` for a slice landing, `P` for its
 *   own bookkeeping — and GET /api/branch-state reports, for each commit on
 *   origin/dev that is not on origin/main, its kind, the slice it belongs to, a
 *   label (`S402`, `P404`, `H`), and whether the kind was READ from a trailer or
 *   guessed from the subject.
 *
 *   Before this, the ribbon could only guess. Every pipeline commit and every
 *   hand-made one arrived as an unannotated subject, and the author told you nothing
 *   either: 283 of the last 300 commits on dev — bookkeeping and hand work alike —
 *   are authored `Philipp`. So the kind is declared where it can be declared, and
 *   inferred, honestly marked as inferred, where it cannot.
 *
 * Tiers used:
 *   - Pure: commitKindOfTrailers / commitKindOfSubject / commitKindEntry — the three
 *     decisions, exercised directly on the messages the ACs name.
 *   - Tier 2 (writers): bridge/orchestrator.js against throwaway git fixtures in
 *     os.tmpdir(), redirected through its _testSet* hooks, so no live bridge state is
 *     touched (#99992). The assertion is `git log --format='%(trailers:key=Kind)'` —
 *     git's OWN trailer reader, not a regex over the message.
 *   - Tier 2 (reader): dashboard/server.js compiled against a tmp fixture root with a
 *     LOCAL BARE origin and a PATH-stubbed `gh`, read over HTTP at /api/branch-state.
 *   - Static: the source, for the traps that are about how the answer is obtained
 *     (one git call, never the author).
 *
 * Deliberately NOT asserted here (and why):
 *   - What the screen does with kind/label: no page reads them yet (slice 406).
 *   - The T kind for Julian's test landings, the revert commit's kind, the origin/main
 *     tip's kind: all out of scope in the brief; until then they read H by inference,
 *     which the AC-7 guard already covers.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');

const { makeTmpDir, removeTmpDir } = require('../helpers/tmp-dir');

const REPO_ROOT  = path.resolve(__dirname, '..', '..');
const GITIGNORE  = path.join(REPO_ROOT, '.gitignore');
const SERVER_SRC = path.join(REPO_ROOT, 'dashboard', 'server.js');

const serverSrcText       = fs.readFileSync(SERVER_SRC, 'utf8');
const orchestratorSrcText = fs.readFileSync(path.join(REPO_ROOT, 'bridge', 'orchestrator.js'), 'utf8');

const { commitKindOfTrailers, commitKindOfSubject, commitKindEntry } = require(SERVER_SRC);

const gitFinalizer = require('../../bridge/git-finalizer');
const {
  squashSliceToDev, recordArchivedQueueRename, autoCommitDirtyTree,
  _testSetProjectDir, _testSetRegisterFile, _testSetDirs,
} = require('../../bridge/orchestrator');

// Deterministic identity, and isolation from machine/user git config: a clean CI
// runner has no identity and a dev machine may have gpgsign on.
const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Regression Gate', GIT_AUTHOR_EMAIL: 'gate@denorios.test',
  GIT_COMMITTER_NAME: 'Regression Gate', GIT_COMMITTER_EMAIL: 'gate@denorios.test',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
};
const git = (cwd, args, env) => execFileSync('git', args,
  { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV, ...(env || {}) }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** The Kind trailers git itself reads off a commit, one per line. */
const kindTrailerLines = (cwd, ref) =>
  git(cwd, ['log', '-1', '--format=%(trailers:key=Kind)', ref]).split('\n').filter(Boolean);

/** One trailer's values, read by git rather than by a regex over the message. */
const trailerValues = (cwd, ref, key) =>
  git(cwd, ['log', '-1', `--format=%(trailers:key=${key},valueonly)`, ref]).split('\n').map(v => v.trim()).filter(Boolean);

function write(root, rel, body) {
  const abs = path.join(root, rel.split('/').join(path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

function report(id, title) {
  return [
    '---', `id: "${id}"`, 'from: rom', 'to: nog', 'status: DONE',
    `slice_id: "${id}"`, `branch: "slice/${id}"`, 'tokens_in: 0', 'tokens_out: 0',
    'elapsed_ms: 0', '---', '', '## Summary', '', title, '',
  ].join('\n');
}

// gitFinalizer.runGit defaults its cwd to the PROJECT_DIR handed to init() and emits
// register events through the injected recorder. Point both at the fixture so nothing
// here can reach the live bridge (#99992).
function bindFinalizer(root) {
  gitFinalizer.init({
    PROJECT_DIR: root, registerEvent: () => {}, log: () => {},
    HEARTBEAT_FILE: path.join(root, 'bridge', 'heartbeat.json'),
    QUEUE_DIR: path.join(root, 'bridge', 'queue'),
  });
}

// gitFinalizer.runGit's contract backed by a plain shell in a fixture — the seam the
// archive recorder takes so a test never reaches the live register.
function shRunGit(root) {
  return (cmd, o) => execFileSync('sh', ['-c', cmd], {
    cwd: (o && o.cwd) || root, encoding: (o && o.encoding) || undefined,
    env: { ...process.env, ...GIT_ENV }, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// ───────────────────────────────────────────────────────────────────────────────
// Writer fixtures — a bare origin + clone with dev and a slice branch, the shape the
// landing runs in, plus the stub derivers that make squashSliceToDev take its amend
// path. (The real derivers have their own integrity tests.)
// ───────────────────────────────────────────────────────────────────────────────
function makeLandingRepo(label, id) {
  const tmp  = makeTmpDir(label);
  const bare = path.join(tmp, 'bare.git');
  const work = path.join(tmp, 'work');
  git(tmp, ['init', '--quiet', '--bare', '--initial-branch=main', bare]);
  git(tmp, ['clone', '--quiet', bare, work]);
  git(work, ['config', 'user.email', 'gate@denorios.test']);
  git(work, ['config', 'user.name', 'Regression Gate']);

  fs.copyFileSync(GITIGNORE, path.join(work, '.gitignore'));
  write(work, 'lib/engine.js', 'module.exports = 1;\n');
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

  const registerPath = path.join(work, 'bridge', 'register.jsonl');
  fs.writeFileSync(registerPath, '');
  bindFinalizer(work);
  _testSetProjectDir(work);
  _testSetRegisterFile(registerPath);
  _testSetDirs(path.join(work, 'bridge', 'queue'), path.join(work, 'bridge', 'staged'),
    path.join(work, 'bridge', 'trash'));
  return { tmp, work };
}

/** The builder's branch: product code, his force-added report, and the given message. */
function cutSliceBranch(work, id, message) {
  git(work, ['checkout', '--quiet', '-b', `slice/${id}`]);
  write(work, 'lib/engine.js', 'module.exports = 2;\n');
  write(work, `bridge/queue/${id}-DONE.md`, report(id, 'the landed report'));
  git(work, ['add', '--', 'lib/engine.js']);
  git(work, ['add', '-f', '--', `bridge/queue/${id}-DONE.md`]);
  fs.writeFileSync(path.join(work, '.branch-commit-msg'), message);
  git(work, ['commit', '--quiet', '-F', '.branch-commit-msg']);
  fs.rmSync(path.join(work, '.branch-commit-msg'), { force: true });
  git(work, ['checkout', '--quiet', 'dev']);
  // The live journey file: Nog accepted, so the report has already been renamed.
  write(work, `bridge/queue/${id}-ACCEPTED.md`, report(id, 'the landed report'));
}

/** A repo on dev holding one tracked, ignored-but-force-added queue report. */
function makeArchiveRepo(label, id) {
  const tmp = makeTmpDir(label);
  git(tmp, ['init', '-q', '-b', 'dev']);
  git(tmp, ['config', 'user.email', 'gate@denorios.test']);
  git(tmp, ['config', 'user.name', 'Regression Gate']);
  fs.copyFileSync(GITIGNORE, path.join(tmp, '.gitignore'));
  write(tmp, 'lib/engine.js', 'module.exports = 1;\n');
  write(tmp, 'bridge/queue/.gitkeep', '');
  write(tmp, `bridge/queue/${id}-DONE.md`, report(id, 'a permanent record'));
  git(tmp, ['add', '-A']);
  git(tmp, ['add', '-f', '--', `bridge/queue/${id}-DONE.md`]);
  git(tmp, ['commit', '-qm', 'base — the report is a tracked permanent record']);
  return tmp;
}

// ───────────────────────────────────────────────────────────────────────────────
// Reader fixture — dashboard/server.js compiled against a tmp root, a LOCAL BARE
// origin for git, and a PATH-stubbed `gh` so no call can reach real GitHub.
// ───────────────────────────────────────────────────────────────────────────────
let tmpRoot, originDir, server, port, bust, baseSha;

function installGhStub(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  const ghPath = path.join(binDir, 'gh');
  fs.writeFileSync(ghPath, '#!/bin/sh\n# offline gh stub — never contacts GitHub.\necho "[]"\nexit 0\n', { mode: 0o755 });
}

function compileServer(root) {
  const dashboardDir = path.join(root, 'dashboard');
  const lifecyclePath = path.join(root, 'bridge', 'lifecycle-translate.js');
  fs.writeFileSync(
    path.join(root, 'bridge', 'return-to-stage-eligibility.js'),
    `module.exports = require(${JSON.stringify(path.join(REPO_ROOT, 'bridge', 'return-to-stage-eligibility.js'))});\n`,
    'utf8');
  fs.writeFileSync(lifecyclePath,
    "'use strict';\nmodule.exports = { translateEvent(ev) { return ev; }, resetDedupeState() {} };\n", 'utf8');
  fs.writeFileSync(path.join(dashboardDir, 'lcars-dashboard.html'), '<html></html>', 'utf8');
  fs.writeFileSync(path.join(dashboardDir, 'tokens.css'), '', 'utf8');

  // Every rewrite is asserted to have applied. A silently-missed REPO_ROOT rewrite
  // would point this suite at the REAL repo and turn the whole file false-green —
  // the trap the e2e suite was caught by once.
  const rewrite = (text, re, to, what) => {
    const out = text.replace(re, to);
    assert.notEqual(out, text, `fixture rewrite failed to apply: ${what}`);
    return out;
  };
  let src = serverSrcText;
  src = rewrite(src, /const REPO_ROOT\s*=[\s\S]*?path\.resolve\(__dirname,\s*'\.\.'\);/,
    `const REPO_ROOT = ${JSON.stringify(root)};`, 'REPO_ROOT');
  src = rewrite(src, /const DASHBOARD\s*=\s*path\.join\(__dirname,\s*'lcars-dashboard\.html'\);/,
    `const DASHBOARD = ${JSON.stringify(path.join(dashboardDir, 'lcars-dashboard.html'))};`, 'DASHBOARD');
  src = rewrite(src, /const TOKENS_CSS\s*=\s*path\.join\(__dirname,\s*'tokens\.css'\);/,
    `const TOKENS_CSS = ${JSON.stringify(path.join(dashboardDir, 'tokens.css'))};`, 'TOKENS_CSS');
  src = rewrite(src, /require\(path\.join\(REPO_ROOT,\s*'bridge',\s*'lifecycle-translate'\)\)/,
    `require(${JSON.stringify(lifecyclePath)})`, 'lifecycle-translate');
  src = rewrite(src, /if \(require\.main === module\)/, 'if (false)', 'autolisten');
  src = rewrite(src, /module\.exports = \{ /, 'module.exports = { server, _bustGitHubCache, ', 'exports');

  const mod = new Module('patched-dashboard-server-405');
  mod.paths = module.paths;
  mod._compile(src, path.join(dashboardDir, 'server.js'));
  return mod.exports;
}

function request(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: urlPath, method: 'GET' }, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        let parsed = raw;
        try { parsed = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Rebuild origin/dev from the seed commit with exactly these messages, oldest first,
 * and drop the server's 30s refs cache so the next read sees them. A spec is either a
 * message string or { message, author }.
 */
function setDevCommits(specs) {
  git(tmpRoot, ['checkout', '--quiet', '-B', 'dev', baseSha]);
  const msgFile = path.join(tmpRoot, '.fixture-commit-msg');
  const shas = [];
  specs.forEach((spec, i) => {
    const message = typeof spec === 'string' ? spec : spec.message;
    const author  = typeof spec === 'string' ? null : spec.author;
    fs.writeFileSync(path.join(tmpRoot, `work-${i}.txt`), `${i}\n`);
    git(tmpRoot, ['add', `work-${i}.txt`]);
    fs.writeFileSync(msgFile, message.endsWith('\n') ? message : `${message}\n`);
    git(tmpRoot, ['commit', '--quiet', '-F', '.fixture-commit-msg'],
      author ? { GIT_AUTHOR_NAME: author, GIT_AUTHOR_EMAIL: `${author.replace(/\W+/g, '')}@fixture.test` } : null);
    shas.push(git(tmpRoot, ['rev-parse', 'HEAD']));
  });
  fs.rmSync(msgFile, { force: true });
  git(tmpRoot, ['push', '--quiet', '--force', 'origin', 'dev']);
  bust();
  return shas;
}

/** The ribbon as /api/branch-state reports it, from both places it is served. */
async function readRibbon() {
  const { body } = await request('/api/branch-state');
  assert.ok(body && body.github, 'branch-state must carry the github reading');
  assert.equal(body.github.error, null, `the refs read must succeed: ${body.github.error}`);
  return body;
}

/** One entry by subject, so an assertion names the commit it means. */
function entryFor(commits, subject) {
  const hit = commits.filter(c => c.subject === subject);
  assert.equal(hit.length, 1, `exactly one entry for ${JSON.stringify(subject)}, got ${hit.length}`);
  return hit[0];
}

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j-commit-kind-'));
  for (const dir of ['bridge/queue', 'bridge/staged', 'bridge/trash', 'bridge/control',
                     'bridge/errors', 'bridge/state', 'dashboard']) {
    fs.mkdirSync(path.join(tmpRoot, ...dir.split('/')), { recursive: true });
  }
  for (const [rel, body] of [
    ['bridge/register.jsonl', ''],
    ['bridge/heartbeat.json', JSON.stringify({ current_slice: null })],
    ['bridge/queue-order.json', '[]'],
    ['bridge/staged-order.json', '[]'],
    ['bridge/sessions.jsonl', ''],
    ['bridge/first-output.json', '{}'],
    ['bridge/nog-active.json', '{}'],
    // A STALE dev ribbon in the file the retired local gate used to write. The
    // GitHub reading must win — including when it is EMPTY.
    ['bridge/state/branch-state.json', JSON.stringify({
      dev: { commits: [{ sha: 'deadbee', slice_id: '999', subject: 'slice/999 stale file entry' }] },
    })],
  ]) fs.writeFileSync(path.join(tmpRoot, ...rel.split('/')), body, 'utf8');

  installGhStub(path.join(tmpRoot, 'bin'));
  process.env.PATH = path.join(tmpRoot, 'bin') + path.delimiter + process.env.PATH;
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_SYSTEM = '/dev/null';

  originDir = path.join(tmpRoot, 'origin.git');
  git(tmpRoot, ['init', '--quiet', '--bare', originDir]);
  git(tmpRoot, ['init', '--quiet', '-b', 'main']);
  git(tmpRoot, ['config', 'user.email', 'gate@denorios.test']);
  git(tmpRoot, ['config', 'user.name', 'Regression Gate']);
  fs.writeFileSync(path.join(tmpRoot, 'README-fixture.md'), 'seed for J-commit-kind\n', 'utf8');
  git(tmpRoot, ['add', 'README-fixture.md']);
  git(tmpRoot, ['commit', '--quiet', '-m', 'seed: initial main commit']);
  baseSha = git(tmpRoot, ['rev-parse', 'HEAD']);
  git(tmpRoot, ['remote', 'add', 'origin', originDir]);
  git(tmpRoot, ['push', '--quiet', 'origin', 'main']);
  git(tmpRoot, ['checkout', '--quiet', '-b', 'dev', 'main']);
  git(tmpRoot, ['push', '--quiet', 'origin', 'dev']);

  const exported = compileServer(tmpRoot);
  server = exported.server;
  bust = exported._bustGitHubCache;
  assert.equal(typeof bust, 'function', 'the server must export _bustGitHubCache for TTL-cache control');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  _testSetProjectDir(REPO_ROOT);
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// The writers — every commit the pipeline puts on dev declares its own kind
// ═══════════════════════════════════════════════════════════════════════════════

// @ac-hash: slice-405-ac-1 sha256:9f3e6f95dd05adc203ceb793d0d9be3f9b014ea99905a98733dbeab4417a40ee
test('slice-405-ac-1 — a slice landing keeps its S042: Test Feature subject and declares exactly one Kind: S beside the slice trailers', () => {
  const { tmp, work } = makeLandingRepo('j-commit-kind-ac1', '042');
  try {
    // The builder's branch commit carries its OWN `Kind: P` trailer — a slice-branch
    // autocommit looks exactly like this. It must stay on the branch: harvested up,
    // it would give the landing two Kind trailers and the first one would win.
    cutSliceBranch(work, '042', [
      'a branch autocommit', '', 'AC: slice-042-ac-1: the engine returns two', 'Kind: P', '',
    ].join('\n'));

    const result = squashSliceToDev('042', 'Test Feature', 'slice/042', 'core');
    assert.equal(result.success, true, `the landing must succeed, got: ${result.error}`);

    assert.equal(git(work, ['log', '-1', '--format=%s', 'dev']), 'S042: Test Feature',
      'the subject j-s-numbering-squash-subject has pinned since slice 350 is unchanged');
    assert.deepEqual(kindTrailerLines(work, 'dev'), ['Kind: S'],
      'exactly one Kind trailer, and it says this node is a slice landing');

    // The trailers that were already there are still read AS trailers by git — a
    // Kind line in the block must not push any of them out of it.
    assert.deepEqual(trailerValues(work, 'dev', 'Slice-Id'), ['042']);
    assert.deepEqual(trailerValues(work, 'dev', 'Slice-Branch'), ['slice/042']);
    assert.deepEqual(trailerValues(work, 'dev', 'Lane'), ['core']);
    assert.deepEqual(trailerValues(work, 'dev', 'AC'), ['slice-042-ac-1: the engine returns two'],
      'the harvested AC declaration still reaches the gate');

    // …and the branch's own P is where the builder left it.
    assert.deepEqual(kindTrailerLines(work, 'slice/042'), ['Kind: P'],
      'the branch commit keeps the kind it declared for itself');
  } finally {
    _testSetProjectDir(REPO_ROOT);
    removeTmpDir(tmp);
  }
});

// @ac-hash: slice-405-ac-2 sha256:b1dcb2c595b4e52e78f1429ed45190f8fc09acb207674f70c3a69dc2c0cc1958
test('slice-405-ac-2 — the archive rename commit keeps its subject and declares exactly one Kind: P', () => {
  const tmp = makeArchiveRepo('j-commit-kind-ac2', '9395');
  try {
    bindFinalizer(tmp);
    fs.renameSync(path.join(tmp, 'bridge/queue/9395-DONE.md'),
      path.join(tmp, 'bridge/queue/9395-ARCHIVED.md'));

    const result = recordArchivedQueueRename('9395', {
      repoRoot: tmp, queueDir: path.join(tmp, 'bridge', 'queue'), runGit: shRunGit(tmp),
    });
    assert.equal(result.recorded, true, `the rename must be recorded, got reason=${result.reason}`);

    assert.equal(git(tmp, ['log', '-1', '--format=%s', 'HEAD']),
      'S9395: archive 9395-DONE.md -> 9395-ARCHIVED.md',
      'the subject the topology labels is unchanged — the kind rides the trailer block');
    assert.deepEqual(kindTrailerLines(tmp, 'HEAD'), ['Kind: P'],
      'bookkeeping declares itself bookkeeping, exactly once');
  } finally {
    removeTmpDir(tmp);
  }
});

// @ac-hash: slice-405-ac-3 sha256:d912e76ad3392ae4a92fb0100409e5fe3fe47e4a1ed45480da6c8af02c3d82a9
test('slice-405-ac-3 — the pre-checkout autocommit keeps its subject and declares exactly one Kind: P', () => {
  const tmp = makeArchiveRepo('j-commit-kind-ac3', '9402');
  try {
    bindFinalizer(tmp);
    _testSetProjectDir(tmp);
    // A person left one source file modified on dev, and the pipeline is about to
    // check out slice/9402 over the top of it.
    write(tmp, 'lib/engine.js', 'module.exports = 2; // a person was mid-thought\n');

    assert.equal(autoCommitDirtyTree('pre-checkout-branch-slice/9402', '9402'), true,
      'the rescue must still happen');

    assert.equal(git(tmp, ['log', '-1', '--format=%s', 'HEAD']),
      'S9402: autocommit before checkout, 1 source file(s) a person left uncommitted (pre-checkout-branch-slice/9402, on dev)',
      'the subject that tells the operator what was swept in is unchanged');
    assert.deepEqual(kindTrailerLines(tmp, 'HEAD'), ['Kind: P'],
      'the rescue is pipeline bookkeeping, declared exactly once');
  } finally {
    _testSetProjectDir(REPO_ROOT);
    removeTmpDir(tmp);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// The reader — GET /api/branch-state reports a kind for every commit on dev
// ═══════════════════════════════════════════════════════════════════════════════

// @ac-hash: slice-405-ac-4 sha256:598a689a09200b976c9a643e7dee3359ff1869559b597cdebdda25b6516c606d
test('slice-405-ac-4 — both ribbons hold one entry per unmerged dev commit, oldest first, each keeping today\'s fields and adding kind, label and inferred', async () => {
  // Nothing on dev yet: both lists are EMPTY, and the stale branch-state.json ribbon
  // does not get to stand in for them.
  bust();
  const empty = await readRibbon();
  assert.deepEqual(empty.github.dev_commits, [], 'no unmerged commits means no entries');
  assert.deepEqual(empty.dev.commits, [], 'and the same list is served under dev.commits');

  // Two commits with the SAME message and DIFFERENT authors, plus one with a trailer:
  // 283 of the last 300 commits on dev are authored `Philipp`, bookkeeping and hand
  // work alike, so the author must not reach the answer.
  const landed  = 'S9404: the oldest of the three';
  const byHand  = 'handoff: the middle one';
  const shas = setDevCommits([
    landed,
    { message: byHand, author: 'Philipp' },
    { message: `S9405: the newest of the three\n\nKind: P\n`, author: 'Taylor (architect)' },
  ]);

  const body = await readRibbon();
  for (const [where, commits] of [['github.dev_commits', body.github.dev_commits], ['dev.commits', body.dev.commits]]) {
    assert.equal(commits.length, 3, `${where} must hold one entry per unmerged commit`);
    assert.deepEqual(commits.map(c => c.full_sha), shas, `${where} is oldest first`);
    assert.deepEqual(commits.map(c => c.subject),
      [landed, byHand, 'S9405: the newest of the three'],
      `${where} carries exactly what git log --format=%s prints`);
    assert.deepEqual(commits.map(c => c.kind),  ['S', 'H', 'P'], `${where} kinds`);
    assert.deepEqual(commits.map(c => c.label), ['S9404', 'H', 'P9405'], `${where} labels`);
    assert.deepEqual(commits.map(c => c.inferred), [true, true, false],
      `${where} marks a guessed kind as inferred and a declared one as read`);
    assert.deepEqual(commits.map(c => c.slice_id), ['9404', null, '9405'], `${where} slice ids`);
    for (const c of commits) {
      assert.equal(c.sha, c.full_sha.slice(0, 7), 'sha is still the seven-character form');
      assert.ok(typeof c.age_s === 'number' && c.age_s >= 0, `age_s must still be a number: ${c.age_s}`);
      assert.equal(c._ct, undefined, 'the internal sort key is still stripped');
    }
  }

  // The same message gives the same entry whoever authored it.
  const same = 'S9406: one message, two authors';
  setDevCommits([{ message: same, author: 'Philipp' }, { message: same, author: 'Taylor (architect)' }]);
  const pair = (await readRibbon()).dev.commits;
  assert.equal(pair.length, 2);
  for (const field of ['kind', 'label', 'inferred', 'slice_id', 'subject']) {
    assert.equal(pair[0][field], pair[1][field], `${field} must not depend on who authored the commit`);
  }

  // The ceiling is unchanged: the 60 NEWEST, still oldest first.
  const many = Array.from({ length: 63 }, (_, i) => `S94${String(i).padStart(2, '0')}: commit number ${i}`);
  setDevCommits(many);
  const capped = (await readRibbon()).dev.commits;
  assert.equal(capped.length, 60, 'the --max-count=60 ceiling still holds');
  assert.deepEqual(capped.map(c => c.subject), many.slice(3),
    'the 60 newest, oldest first — the three oldest fall off the top');
});

// @ac-hash: slice-405-ac-5 sha256:7647cdd3f9f8ca3da0a4a4f0e27915aa211ad14e48800c63140aaa4082f39e7e
test('slice-405-ac-5 — a pre-405 slice landing, trailers and all, reads S402 by inference', async () => {
  // 12b70a2 as it actually sits on dev: the slice trailers and the AC declarations
  // are there, a Kind trailer is not, because it landed before this slice existed.
  const subject = 'S402: History cost includes Jordan: his tokens and cost are recorded per review';
  setDevCommits([[
    subject, '',
    'Kind-of-thing: not a trailer git reads for us',
    'Slice-Id: 402',
    'Slice-Branch: slice/402',
    'Lane: core',
    'AC: slice-402-ac-1: a review that reached a verdict writes its own tokens',
    'AC: slice-402-ac-2: a review whose session never reached a result writes no number',
  ].join('\n')]);

  const entry = entryFor((await readRibbon()).dev.commits, subject);
  assert.equal(entry.kind, 'S', 'a labelled subject that is neither archive nor autocommit is a landing');
  assert.equal(entry.slice_id, '402');
  assert.equal(entry.label, 'S402');
  assert.equal(entry.inferred, true, 'nothing declared it, so the panel must say it guessed');
});

// @ac-hash: slice-405-ac-6 sha256:518aa3dfc06b69833c838a0a588c112061ecba576538922122bcfc3119979414
test('slice-405-ac-6 — an untrailered archive or autocommit subject reads P, with the slice it belongs to', async () => {
  const autocommit = 'S402: autocommit before checkout, 1 source file(s) a person left uncommitted (pre-checkout-branch-slice/402, on dev)';
  const archive    = 'S404: archive (nothing tracked) -> 404-ARCHIVED.md';
  setDevCommits([autocommit, archive]);

  const commits = (await readRibbon()).dev.commits;
  assert.deepEqual(
    [autocommit, archive].map(s => {
      const e = entryFor(commits, s);
      return [e.kind, e.slice_id, e.label, e.inferred];
    }),
    [['P', '402', 'P402', true], ['P', '404', 'P404', true]],
    'the two bookkeeping subjects the pipeline has ever written read as bookkeeping');
});

// @ac-hash: slice-405-ac-7 sha256:790377f6b77757ac12f7a43077e0a232fdb5ac627c49c53502574f466522c120
test('slice-405-ac-7 — a subject that does not start with an upper-case S<id>: reads H, and only a leading slice reference gives it a number', async () => {
  const nameless = [
    // 77293b1 — a real body, ending in a trailer block that has no Kind in it.
    ['QA: make the author-sandbox and qa-stage guards visible to the gate',
     'QA: make the author-sandbox and qa-stage guards visible to the gate\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n'],
    ['test(e2e): browser guard for slice-400-ac-4 — a recovered verdict costs no round', null],
    ['docs(qa): slice 404 stage — no browser test, and the break-it script\'s blind spot', null],
    ['handoff to Chris: full-disk outage 2026-09-14, dashboard has no supervisor, bridge.log never rotates, .return suffix in isTerminal', null],
    ['ADR (Proposed): Julian alongside — the line never waits, suites run at the button, a red explains itself', null],
  ];
  setDevCommits(nameless.map(([subject, message]) => message || subject));

  const commits = (await readRibbon()).dev.commits;
  for (const [subject] of nameless) {
    const e = entryFor(commits, subject);
    assert.equal(e.kind, 'H', `a person's commit is H: ${subject}`);
    assert.equal(e.slice_id, null, `and claims no slice: ${subject}`);
    assert.equal(e.label, 'H', `so the label is the bare letter: ${subject}`);
    assert.equal(e.inferred, true, `read from the subject, not declared: ${subject}`);
  }

  // A leading slice reference still names its slice, and a lower-case s is a person
  // typing in a hurry — never the pipeline's label.
  setDevCommits(['slice/42 legacy subject', 's402: fix by hand']);
  const later = (await readRibbon()).dev.commits;
  assert.deepEqual(
    ['slice/42 legacy subject', 's402: fix by hand'].map(s => {
      const e = entryFor(later, s);
      return [e.kind, e.slice_id, e.label, e.inferred];
    }),
    [['H', '42', 'H42', true], ['H', '402', 'H402', true]]);
});

// @ac-hash: slice-405-ac-8 sha256:b5a52540d882a06d335049427d297fd0060f83a4da75562ce874ffa888e2b6d7
test('slice-405-ac-8 — a declared Kind of S, P or H beats the subject and is not marked inferred', async () => {
  const cases = [
    ['S405: archive the old reports',    'Kind: S',                      'S', '405', 'S405'],
    ['S406: fix the landing by hand',    'Kind: H',                      'H', '406', 'H406'],
    ['S407: regenerate the locks',       'kind: p',                      'P', '407', 'P407'],
    ['S410: land by hand',               'Kind: X\nKind: P\nKind: S',    'P', '410', 'P410'],
  ];
  setDevCommits(cases.map(([subject, trailers]) => `${subject}\n\n${trailers}\n`));

  const commits = (await readRibbon()).dev.commits;
  for (const [subject, trailers, kind, sliceId, label] of cases) {
    const e = entryFor(commits, subject);
    assert.equal(e.kind, kind, `${JSON.stringify(trailers)} must win over the subject`);
    assert.equal(e.slice_id, sliceId);
    assert.equal(e.label, label);
    assert.equal(e.inferred, false, `a declared kind is not a guess: ${subject}`);
  }
});

// @ac-hash: slice-405-ac-9 sha256:73edf0716baae4287256f2312347455d8d1838332744c320cb693fe02f431db3
test('slice-405-ac-9 — a Kind that is not S, P or H, and a Kind that is not a trailer, are both ignored and the subject decides', async () => {
  const cases = [
    // A letter outside the vocabulary — T is Julian's, and ADR-JULIAN-ALONGSIDE has
    // not been accepted, so until then his landings read by inference like any other.
    ['S408: autocommit before checkout, 1 source file(s) a person left uncommitted (pre-checkout-branch-slice/408, on dev)',
     'Kind: T', 'P', 'P408'],
    ['S412: land the reconcile engine', 'Kind: X', 'S', 'S412'],
    ['S413: land the reconcile engine', 'Kind:',   'S', 'S413'],
    // `Kind: P` inside ANOTHER trailer's text is that trailer's value, not a kind.
    ['S409: Every dev commit says what kind it is',
     'AC: slice-409-ac-1: the landing commit says Kind: P for bookkeeping', 'S', 'S409'],
  ];
  setDevCommits(cases.map(([subject, trailers]) => `${subject}\n\n${trailers}\n`));

  const commits = (await readRibbon()).dev.commits;
  for (const [subject, trailers, kind, label] of cases) {
    const e = entryFor(commits, subject);
    assert.equal(e.kind, kind, `${JSON.stringify(trailers)} is not a kind declaration`);
    assert.equal(e.label, label);
    assert.equal(e.inferred, true, `so the kind is inferred: ${subject}`);
  }

  // …and a `Kind: P` line that opens the body but is not the CLOSING paragraph is
  // body prose. git's own trailer reader knows that; a regex over %B would not.
  const prose = 'S411: Every dev commit says what kind it is';
  setDevCommits([`${prose}\n\nKind: P\n\nThe kind letter is explained in a paragraph of prose that ends the body,\nwhich is what makes the line above not a trailer.\n`]);
  const e = entryFor((await readRibbon()).dev.commits, prose);
  assert.equal(e.kind, 'S', 'a Kind outside the closing trailer block does not count');
  assert.equal(e.label, 'S411');
  assert.equal(e.inferred, true);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Traps
// ═══════════════════════════════════════════════════════════════════════════════

// @ac-hash: slice-405-ac-4 sha256:598a689a09200b976c9a643e7dee3359ff1869559b597cdebdda25b6516c606d
test('slice-405-ac-4 trap 1 — the kind rides the one existing git log; no call is made per commit', () => {
  // The ribbon is rebuilt every GIT_TTL_MS (30s) on a poll. One git call per commit
  // would be sixty processes a minute for a list nothing had asked to change.
  const tips = serverSrcText.slice(serverSrcText.indexOf('function _getGitTips()'));
  const body = tips.slice(0, tips.indexOf('\nfunction _getGhCi()'));
  const devLogCalls = body.match(/'log', 'origin\/dev'/g) || [];
  assert.equal(devLogCalls.length, 1, 'exactly one git log against origin/dev builds the whole ribbon');
  assert.match(body, /--max-count=60/, 'the ceiling is unchanged');
  assert.match(body, /'--reverse'/, 'and the list is still oldest first');

  const mapStart = body.indexOf('.map(record =>');
  assert.ok(mapStart > 0, 'the ribbon is still built by mapping over the log records');
  const mapBody = body.slice(mapStart, body.indexOf('    const mainLog', mapStart));
  for (const runner of ['execFileSync', 'execSync', 'spawnSync']) {
    assert.ok(!mapBody.includes(runner),
      `no child process may be spawned per commit — found ${runner} in the map`);
  }
  // And git's own trailer reader does the parsing, so a `Kind:` in prose cannot count.
  assert.match(body, /%\(trailers:key=Kind,valueonly\)/,
    'the kind must come from git\'s trailer reader, not from a regex over the body');
});

// @ac-hash: slice-405-ac-4 sha256:598a689a09200b976c9a643e7dee3359ff1869559b597cdebdda25b6516c606d
test('slice-405-ac-4 trap 2 — records survive a multi-line trailer block, because a newline cannot separate them', async () => {
  // The trailer block IS newlines. Splitting records on one would shred a landing
  // like this into a dozen half-entries and silently mislabel the ribbon.
  const landing = 'S9407: a landing with a full trailer block';
  const plain   = 'S9408: the one that follows it';
  setDevCommits([
    [landing, '',
     'Kind: S', 'Slice-Id: 9407', 'Slice-Branch: slice/9407', 'Lane: core',
     'AC: slice-9407-ac-1: the first criterion',
     'AC: slice-9407-ac-2: the second criterion',
     'Tests-Not-Needed: docs only',
     'Coverage-Removed: regression/gone.test.js',
    ].join('\n'),
    plain,
  ]);

  const commits = (await readRibbon()).dev.commits;
  assert.equal(commits.length, 2, 'a nine-line trailer block is still ONE entry');
  assert.deepEqual(commits.map(c => c.subject), [landing, plain],
    'and the commit after it is not swallowed by the block above');
  assert.deepEqual(commits.map(c => c.label), ['S9407', 'S9408']);
  assert.equal(entryFor(commits, landing).inferred, false, 'the declared kind is still read');
  for (const c of commits) {
    assert.ok(!/[\x1e\x1f]/.test(c.subject), `no separator byte may leak into a subject: ${c.subject}`);
    assert.match(c.full_sha, /^[0-9a-f]{40}$/, `and none into a sha: ${c.full_sha}`);
  }
});

// @ac-hash: slice-405-ac-1 sha256:9f3e6f95dd05adc203ceb793d0d9be3f9b014ea99905a98733dbeab4417a40ee
test('slice-405-ac-1 trap 3 — the message-building code other suites pin is where they pin it', () => {
  // These are pinned by tests Rom does not run. A Kind line in a trailer block breaks
  // none of them; MOVING the code that builds the message does, and dev goes red
  // after the landing rather than here.
  assert.match(orchestratorSrcText,
    /const commitMsg = `\$\{gitFinalizer\.pipelineCommitSubject\(sliceId, sliceTitle\)\}/,
    'j-no-nameless-commits pins this literal opening of the squash message');
  assert.match(orchestratorSrcText, /git log dev\.\.\$\{sliceBranch\} --reverse/,
    'j-ac-amend-order pins the oldest-first harvest log');

  // Every message-bearing pipeline commit still sits within twelve lines of the
  // helper that labels it — the window j-no-nameless-commits scans.
  const lines = orchestratorSrcText.split('\n');
  const messaged = lines.map((text, i) => ({ text, i }))
    .filter(({ text }) => /git commit/.test(text) && /(-m|-F)[ \t]/.test(text));
  assert.ok(messaged.length >= 3, 'the scan must find the pipeline\'s commit sites, or it proves nothing');
  for (const { text, i } of messaged) {
    const near = lines.slice(Math.max(0, i - 12), i + 1).join('\n');
    assert.ok(/pipelineCommitSubject|\.squash-commit-msg/.test(near),
      `a Kind trailer must not push a commit out of the labelling window — bridge/orchestrator.js:${i + 1}: ${text.trim()}`);
  }

  // The squash trailer block: one Lane line, after Slice-Branch (j-lanes), and Kind
  // is NOT in the harvest — the kind describes the commit being written, so a branch
  // commit's own declaration must not be carried up into the landing.
  const msgLine = lines.find(l => l.includes('const commitMsg = `${gitFinalizer.pipelineCommitSubject'));
  const blankLine = msgLine.indexOf('\\n\\n');
  assert.ok(blankLine > 0, 'the trailer block still opens with the blank line after the subject');
  assert.ok(msgLine.indexOf('Kind: S') > blankLine,
    'the kind is declared inside the trailer block and never in the subject');
  assert.equal((msgLine.match(/Lane: /g) || []).length, 1, 'exactly one Lane trailer is written');
  assert.ok(msgLine.indexOf('Lane: ') > msgLine.indexOf('Slice-Branch: '),
    'the Lane trailer still sits after Slice-Branch');
  const harvest = orchestratorSrcText.slice(
    orchestratorSrcText.indexOf('let acTrailers = \'\';'),
    orchestratorSrcText.indexOf('const commitMsg = `${gitFinalizer.pipelineCommitSubject'));
  // Code only: the prose around it is allowed to explain why Kind is NOT harvested.
  const harvestCode = harvest.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.ok(!/Kind/.test(harvestCode), 'Kind must not be harvested from the branch commits');
  assert.match(harvestCode, /Tests-Not-Needed\|Test-Loosen-OK\|Coverage-Removed/,
    'the harvest still carries the three test-move trailers it was written for');
});

// @ac-hash: slice-405-ac-4 sha256:598a689a09200b976c9a643e7dee3359ff1869559b597cdebdda25b6516c606d
test('slice-405-ac-4 trap 4 — the author is never read, and the three decisions are one shared rule', () => {
  // The author cannot distinguish anything here: 283 of the last 300 commits on dev
  // are authored `Philipp`, pipeline and hand-made alike. Reading it would look like
  // evidence and be noise.
  const tips = serverSrcText.slice(serverSrcText.indexOf('function _getGitTips()'));
  const body = tips.slice(0, tips.indexOf('\nfunction _getGhCi()'));
  for (const fmt of ['%an', '%ae', '%aN', '%aE', '%cn', '%ce', '%aL', '%cL']) {
    assert.ok(!body.includes(fmt), `_getGitTips must not ask git for the author — found ${fmt}`);
  }
  assert.ok(!/author/i.test(body), '…nor derive anything from an author field');

  // The rules themselves, exercised where the ribbon is not: one vocabulary, one
  // first-wins order, one case-sensitive subject reading.
  assert.equal(commitKindOfTrailers(['S']), 'S');
  assert.equal(commitKindOfTrailers([' p ']), 'P', 'a declaration is trimmed and case-folded');
  assert.equal(commitKindOfTrailers(['T', 'X', '']), null, 'nothing outside S, P and H is a kind');
  assert.equal(commitKindOfTrailers([]), null);
  assert.equal(commitKindOfTrailers(undefined), null, 'a commit with no trailers declares nothing');
  assert.equal(commitKindOfTrailers(['H', 'S']), 'H', 'the first understood value wins');

  assert.equal(commitKindOfSubject('S1: archive one thing'), 'P');
  assert.equal(commitKindOfSubject('S1: autocommit one thing'), 'P');
  assert.equal(commitKindOfSubject('S1: archived by hand'), 'S', 'the P prefixes end with a space');
  assert.equal(commitKindOfSubject('S1: autocommitter notes'), 'S');
  assert.equal(commitKindOfSubject('s1: archive one thing'), 'H', 'a lower-case s is a person');
  assert.equal(commitKindOfSubject('S1:no space'), 'H');
  assert.equal(commitKindOfSubject(''), 'H');
  assert.equal(commitKindOfSubject(null), 'H', 'an absent subject is never a landing');

  assert.deepEqual(commitKindEntry('S9: a landing', []),
    { kind: 'S', slice_id: '9', label: 'S9', inferred: true });
  assert.deepEqual(commitKindEntry('a person\'s commit', ['p']),
    { kind: 'P', slice_id: null, label: 'P', inferred: false },
    'a declared kind with no slice gives the bare letter as its label');
});
