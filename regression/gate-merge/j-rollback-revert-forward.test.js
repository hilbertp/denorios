'use strict';

/**
 * Journey: J-rollback-revert-forward
 * Category: Gate & Merge
 *
 * Spec source: docs/adr/ADR-ROLLBACK-MODEL.md (revert-forward through the gate).
 *
 * What this pins (behavior, not implementation):
 *   Rollback is NOT a reset/force-push of main. Rolling back a merged slice
 *   creates a `git revert` commit on dev and fires promote.yml exactly like a
 *   promotion — main stays fast-forward-only and the gate re-tests the reverted
 *   state before it can reach main. Pinned outcomes:
 *     - clean rollback: a real revert commit lands on origin/dev (ff, no history
 *       rewrite); main is untouched by the dispatch itself (only promote.yml
 *       moves it); promote.yml is dispatched; a rollback-dispatched audit event
 *       is written.
 *     - revert is built in an isolated worktree: the live REPO_ROOT working tree
 *       (dirty with register/state churn) is never required to be clean.
 *     - not-on-main guard: a slice only on dev (not promoted) cannot be rolled
 *       back — nothing on main to undo — and nothing is pushed or dispatched.
 *     - conflict: when a later slice changed the same lines, the revert is
 *       refused (no auto-resolve, no force), the blamed slice is named, a
 *       rollback-conflict event is written, origin/dev is untouched, and no
 *       promotion is dispatched (degrades to a human forward-fix — ADR Q3).
 *     - mutex: a gate already in flight blocks rollback (409) — you cannot
 *       promote and roll back at once (ADR Q5).
 *     - unknown slice: a slice with no recorded squash commit → 404.
 *     - preview: GET /api/rollback/preview surfaces the revert PLUS the pending
 *       un-promoted dev commits that a rollback would also carry to main (the
 *       one real gotcha of the ff-only model — ADR "what will move").
 *
 * Deliberately NOT asserted (and why):
 *   - The real GitHub Actions run executing the suite + ff (not headless).
 *   - UI rendering of the confirm dialog / CI strip (Bashir's e2e owns the
 *     browser-driven journey; the data sources it reads ARE asserted here).
 *
 * #99992: all state lives in caller-supplied tmpdirs + a LOCAL BARE origin; a
 * PATH-stubbed `gh` guarantees no call can ever reach real GitHub.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');

const { parseRegisterLines } = require('../helpers/register-helper');
const {
  GIT_ENV, git, commitFile, initGitFixture, advanceDev,
  installGhStub, setPromoteRuns, readDispatches, seedMergeLockDeps,
} = require('./j-merge-button-pass-helpers');

const REPO_ROOT_REAL = path.resolve(__dirname, '..', '..');
const SERVER_SRC     = path.join(REPO_ROOT_REAL, 'dashboard', 'server.js');

// ── server compile against a tmpRoot (REPO_ROOT rewritten) ──────────────────
// Identical patching to J-merge-button-pass; the rollback endpoints live in the
// same server.js.
function compileServer(root) {
  const dashboardDir = path.join(root, 'dashboard');
  const lifecyclePath = path.join(root, 'bridge', 'lifecycle-translate.js');
  fs.writeFileSync(lifecyclePath, `
'use strict';
module.exports = { translateEvent(ev) { return ev; }, resetDedupeState() {} };
`, 'utf8');
  fs.writeFileSync(path.join(dashboardDir, 'lcars-dashboard.html'), '<html></html>', 'utf8');
  fs.writeFileSync(path.join(dashboardDir, 'tokens.css'), '', 'utf8');

  const src = fs.readFileSync(SERVER_SRC, 'utf8')
    .replace(/const REPO_ROOT\s*=[\s\S]*?path\.resolve\(__dirname,\s*'\.\.'\);/,
      `const REPO_ROOT = ${JSON.stringify(root)};`)
    .replace(/const DASHBOARD\s*=\s*path\.join\(__dirname,\s*'lcars-dashboard\.html'\);/,
      `const DASHBOARD = ${JSON.stringify(path.join(dashboardDir, 'lcars-dashboard.html'))};`)
    .replace(/const TOKENS_CSS\s*=\s*path\.join\(__dirname,\s*'tokens\.css'\);/,
      `const TOKENS_CSS = ${JSON.stringify(path.join(dashboardDir, 'tokens.css'))};`)
    .replace(/require\(path\.join\(REPO_ROOT,\s*'bridge',\s*'lifecycle-translate'\)\)/,
      `require(${JSON.stringify(lifecyclePath)})`)
    .replace(/if \(require\.main === module\)/, 'if (false)')
    .replace(/module\.exports = \{ /, 'module.exports = { server, _bustGitHubCache, ');

  const mod = new Module('patched-dashboard-server-rollback');
  mod.paths = module.paths;
  mod._compile(src, path.join(dashboardDir, 'server.js'));
  return mod.exports;
}

function request(port, method, urlPath, payload) {
  return new Promise((resolve, reject) => {
    const body = payload == null ? '' : JSON.stringify(payload);
    const req = http.request({
      hostname: '127.0.0.1', port, path: urlPath, method,
      headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {},
    }, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        let parsed = raw;
        try { parsed = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Append an authoritative SLICE_SQUASHED_TO_DEV event (the slice→sha map the
// rollback feature resolves against).
function writeSquashEvent(registerPath, sliceId, sha) {
  fs.appendFileSync(registerPath,
    JSON.stringify({ ts: new Date().toISOString(), id: String(sliceId),
      event: 'SLICE_SQUASHED_TO_DEV', slice_id: String(sliceId),
      squash_sha: sha, dev_tip_sha: sha }) + '\n', 'utf8');
}

// Fast-forward main to dev and push it (simulates a prior promotion).
function promoteToMain(workDir) {
  git(['checkout', '--quiet', 'main'], workDir);
  git(['merge', '--ff-only', 'dev'], workDir);
  git(['push', '--quiet', 'origin', 'main'], workDir);
  git(['checkout', '--quiet', 'dev'], workDir);
}

async function makeFixture(label) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), label));
  const registerPath = path.join(tmpRoot, 'bridge', 'register.jsonl');
  for (const dir of [
    path.join(tmpRoot, 'bridge', 'queue'),
    path.join(tmpRoot, 'bridge', 'staged'),
    path.join(tmpRoot, 'bridge', 'trash'),
    path.join(tmpRoot, 'bridge', 'control'),
    path.join(tmpRoot, 'bridge', 'errors'),
    path.join(tmpRoot, 'bridge', 'state'),
    path.join(tmpRoot, 'dashboard'),
  ]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(registerPath, '', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'heartbeat.json'), JSON.stringify({ current_slice: null }), 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'queue-order.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'staged-order.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'sessions.jsonl'), '', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'first-output.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'nog-active.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'state', 'branch-state.json'), '{}', 'utf8');
  // The rollback dispatch derives the merge lock server-side (slice 361) and
  // fails closed; the fixture needs the real engine and an open gate state.
  seedMergeLockDeps(tmpRoot);

  // gh stub on PATH before compile; git identity in env so the server's own
  // `git revert` can commit (no machine/global config in the fixture).
  const binDir = path.join(tmpRoot, 'bin');
  const stubDir = path.join(tmpRoot, 'gh-stub');
  installGhStub(binDir, stubDir);
  const prevPath = process.env.PATH;
  const prevEnv = {};
  for (const k of Object.keys(GIT_ENV)) prevEnv[k] = process.env[k];
  process.env.PATH = binDir + path.delimiter + process.env.PATH;
  Object.assign(process.env, GIT_ENV);

  const originDir = path.join(tmpRoot, 'origin.git');
  const fixture = initGitFixture({ workDir: tmpRoot, originDir });

  const exported = compileServer(tmpRoot);
  const server = exported.server;
  const bustCache = exported._bustGitHubCache;
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  return {
    tmpRoot, originDir, stubDir, registerPath, server, port, bustCache, fixture,
    _prevPath: prevPath, _prevEnv: prevEnv,
    req: (m, u, p) => request(port, m, u, p),
  };
}

async function teardown(fx) {
  if (fx.server) await new Promise(r => fx.server.close(r));
  process.env.PATH = fx._prevPath;
  for (const k of Object.keys(fx._prevEnv)) {
    if (fx._prevEnv[k] === undefined) delete process.env[k];
    else process.env[k] = fx._prevEnv[k];
  }
  if (fx.tmpRoot) fs.rmSync(fx.tmpRoot, { recursive: true, force: true });
}

// ═════════════════════════════════════════════════════════════════════════════

test('J-rollback-revert-forward ac-1 — clean rollback: a revert commit lands on origin/dev (ff, no rewrite), main untouched by the dispatch, promote.yml fired, rollback-dispatched audited', async () => {
  const fx = await makeFixture('j-rollback-clean-');
  try {
    const shaX = advanceDev(fx.tmpRoot, 'src/feature-401.js', '// slice 401 feature\n', 'slice/401: add feature');
    writeSquashEvent(fx.registerPath, 401, shaX);
    promoteToMain(fx.tmpRoot); // main == dev == shaX (the "merge then immediately roll back" case)
    fx.bustCache();

    const res = await fx.req('POST', '/api/rollback/dispatch', { slice_id: 401 });
    assert.equal(res.status, 200, `clean rollback must succeed — got ${JSON.stringify(res.body)}`);
    assert.equal(res.body.ok, true);
    assert.ok(res.body.revert_sha, 'response carries the revert sha');

    // A real revert commit is now origin/dev tip (ff over shaX, no history rewrite).
    const devTip = git(['rev-parse', 'dev'], fx.originDir);
    assert.notEqual(devTip, shaX, 'origin/dev advanced to the revert commit');
    assert.match(git(['log', '-1', '--format=%s', 'dev'], fx.originDir), /^Revert /,
      'the new dev tip is a git revert commit');
    assert.equal(git(['rev-parse', 'dev~1'], fx.originDir), shaX,
      'the revert sits directly on top of the reverted slice (fast-forward, no merge commit)');

    // The dispatch itself does NOT move main — only promote.yml does, on green.
    assert.equal(git(['rev-parse', 'main'], fx.originDir), shaX,
      'rollback dispatch leaves origin/main untouched (the gate moves it, not the endpoint)');

    // promote.yml dispatched exactly like a promotion.
    const dispatches = readDispatches(fx.stubDir);
    assert.equal(dispatches.length, 1, 'exactly one workflow run dispatched');
    assert.match(dispatches[0], /workflow run promote\.yml/, 'rollback re-uses the promote gate');
    assert.match(dispatches[0], /--ref dev/, 'the gate runs against dev (the reverted state)');

    // Audit trail.
    const events = parseRegisterLines(fx.registerPath);
    const ev = events.find(e => e.event === 'rollback-dispatched');
    assert.ok(ev, `register must record rollback-dispatched — got: [${events.map(e => e.event).join(', ')}]`);
    assert.equal(String(ev.slice_id), '401', 'audit event names the rolled-back slice');
    assert.equal(ev.squash_sha, shaX.slice(0, 7), 'audit event records the reverted commit');
  } finally {
    await teardown(fx);
  }
});

test('J-rollback-revert-forward ac-2 — not-on-main guard: a slice only on dev cannot be rolled back; origin/dev untouched, nothing dispatched', async () => {
  const fx = await makeFixture('j-rollback-notmain-');
  try {
    const shaY = advanceDev(fx.tmpRoot, 'src/feature-402.js', '// slice 402\n', 'slice/402: dev-only');
    writeSquashEvent(fx.registerPath, 402, shaY); // squashed to dev, but NOT promoted
    fx.bustCache();

    const res = await fx.req('POST', '/api/rollback/dispatch', { slice_id: 402 });
    assert.equal(res.status, 409, 'a slice not on main has nothing to roll back');
    assert.equal(res.body.error, 'not_on_main');

    assert.equal(git(['rev-parse', 'dev'], fx.originDir), shaY, 'origin/dev is untouched');
    assert.equal(readDispatches(fx.stubDir).length, 0, 'no promotion is dispatched');
  } finally {
    await teardown(fx);
  }
});

test('J-rollback-revert-forward ac-3 — conflict: a later slice changed the same lines → revert refused, blame named, rollback-conflict audited, origin/dev untouched, no dispatch', async () => {
  const fx = await makeFixture('j-rollback-conflict-');
  try {
    // Base file is the seed README-fixture.md (exists on main). X rewrites it,
    // is promoted; Y rewrites the same file differently on dev. Reverting X then
    // collides with Y → content conflict.
    git(['checkout', '--quiet', 'dev'], fx.tmpRoot);
    const shaX = commitFile(fx.tmpRoot, 'README-fixture.md', 'X-version\n', 'slice/410: rewrite readme');
    git(['push', '--quiet', 'origin', 'dev'], fx.tmpRoot);
    writeSquashEvent(fx.registerPath, 410, shaX);
    promoteToMain(fx.tmpRoot); // main == dev == shaX

    const shaY = commitFile(fx.tmpRoot, 'README-fixture.md', 'Y-version\n', 'slice/411: rewrite readme again');
    git(['push', '--quiet', 'origin', 'dev'], fx.tmpRoot);
    writeSquashEvent(fx.registerPath, 411, shaY); // dev now at Y, main at X
    fx.bustCache();

    const res = await fx.req('POST', '/api/rollback/dispatch', { slice_id: 410 });
    assert.equal(res.status, 409, 'a conflicting revert is refused, not forced');
    assert.equal(res.body.error, 'conflict');
    assert.ok((res.body.conflict_files || []).includes('README-fixture.md'),
      `the conflicted file is surfaced — got ${JSON.stringify(res.body.conflict_files)}`);
    assert.ok(res.body.blame, 'the blamed later commit is identified');
    assert.equal(res.body.blame.slice_id, '411', 'blame names the slice that changed the same code');

    // No revert pushed, no promotion dispatched, but the conflict IS audited so a
    // human can author the forward-fix (ADR Q3).
    assert.equal(git(['rev-parse', 'dev'], fx.originDir), shaY, 'origin/dev is untouched after a refused revert');
    assert.equal(readDispatches(fx.stubDir).length, 0, 'no promotion on a conflicted rollback');
    const events = parseRegisterLines(fx.registerPath);
    const conflictEv = events.find(e => e.event === 'rollback-conflict');
    assert.ok(conflictEv, 'register records rollback-conflict for the forward-fix route');
    assert.equal(String(conflictEv.slice_id), '410', 'conflict event names the slice that could not be rolled back');
  } finally {
    await teardown(fx);
  }
});

test('J-rollback-revert-forward ac-4 — mutex: a gate already in flight blocks rollback (409 gate_already_running), no revert, no dispatch', async () => {
  const fx = await makeFixture('j-rollback-mutex-');
  try {
    const shaX = advanceDev(fx.tmpRoot, 'src/feature-420.js', '// slice 420\n', 'slice/420: feature');
    writeSquashEvent(fx.registerPath, 420, shaX);
    promoteToMain(fx.tmpRoot);
    // A promote run is in flight.
    setPromoteRuns(fx.stubDir, [{ status: 'in_progress', conclusion: null, databaseId: 999,
      url: 'https://github.example/actions/runs/999', headSha: shaX }]);
    fx.bustCache();

    const res = await fx.req('POST', '/api/rollback/dispatch', { slice_id: 420 });
    assert.equal(res.status, 409, 'cannot promote and roll back at once');
    assert.equal(res.body.error, 'gate_already_running');
    assert.equal(git(['rev-parse', 'dev'], fx.originDir), shaX, 'no revert created while the gate runs');
    assert.equal(readDispatches(fx.stubDir).length, 0, 'no second dispatch while a run is in flight');
  } finally {
    await teardown(fx);
  }
});

test('J-rollback-revert-forward ac-5 — unknown slice (no recorded squash commit) → 404 unknown_slice, nothing dispatched', async () => {
  const fx = await makeFixture('j-rollback-unknown-');
  try {
    fx.bustCache();
    const res = await fx.req('POST', '/api/rollback/dispatch', { slice_id: 999 });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'unknown_slice');
    assert.equal(readDispatches(fx.stubDir).length, 0, 'no dispatch for an unresolvable slice');
  } finally {
    await teardown(fx);
  }
});

test('J-rollback-revert-forward ac-6 — preview surfaces the revert PLUS the pending un-promoted dev commits a rollback would also carry to main (the ff gotcha)', async () => {
  const fx = await makeFixture('j-rollback-preview-');
  try {
    const shaX = advanceDev(fx.tmpRoot, 'src/feature-430.js', '// slice 430\n', 'slice/430: promoted feature');
    writeSquashEvent(fx.registerPath, 430, shaX);
    promoteToMain(fx.tmpRoot); // X is on main
    // A later slice Y is pending on dev (NOT promoted) — it would ride along.
    const shaY = advanceDev(fx.tmpRoot, 'src/feature-431.js', '// slice 431\n', 'slice/431: pending feature');
    writeSquashEvent(fx.registerPath, 431, shaY);
    fx.bustCache();

    const res = await fx.req('GET', '/api/rollback/preview?slice_id=430');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.squash_sha, shaX.slice(0, 7), 'preview names the commit to be reverted');
    assert.equal(res.body.dev_level_with_main, false, 'dev is ahead of main — the gotcha applies');
    const pendingShas = (res.body.pending_commits || []).map(c => c.sha);
    assert.ok(pendingShas.includes(shaY.slice(0, 7)),
      `pending Y must be disclosed as also moving to main — got ${JSON.stringify(res.body.pending_commits)}`);
    // will_move = the revert + every pending commit.
    assert.equal(res.body.will_move, res.body.pending_commits.length + 1,
      'will_move counts the revert plus all pending dev commits');
  } finally {
    await teardown(fx);
  }
});
