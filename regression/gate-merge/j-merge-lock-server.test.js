'use strict';

/**
 * Journey: J-merge-lock-server
 * Category: Gate & Merge
 *
 * Spec source: slice 361 — "Make the merge lock real — the server must refuse,
 * not just the button."
 *
 * WHY THIS EXISTS: the padlock on RUN GATE & MERGE TO MAIN used to live only in
 * the browser. renderPromoteAction() computed `checkPassed` client-side and
 * disabled the button; POST /api/promote/dispatch consulted commits_ahead and the
 * run mutex and nothing else, so any POST fired `gh workflow run promote.yml`.
 * On 2026-09-01 a merge went through with the decision popup still open. A
 * disabled button is a hint — a stale page, a second tab, or a scripted call
 * walks straight past it. This suite pins the rule on the SERVER.
 *
 * What this pins (behavior, not implementation):
 *   - a promote dispatch is refused while any AC in the pending range still
 *     needs a human test-update decision, and NO workflow is invoked;
 *   - the refusal names what is outstanding (count + tags) and is a distinct
 *     code from nothing_to_promote and gate_already_running;
 *   - a check bound to a DIFFERENT integration tip does not unlock a dispatch;
 *   - rollback is governed by the same rule and, refused, leaves origin/dev
 *     exactly where it was — no revert commit to clean up;
 *   - the refusal is DERIVED: a payload asserting "check passed / ready / force"
 *     changes nothing;
 *   - the panel reads the server's reason back rather than failing silently.
 *
 * Deliberately NOT asserted (and why):
 *   - what promote.yml does once dispatched (slice 361 governs WHETHER the
 *     dispatch happens; J-merge-button-pass owns the workflow's own shape);
 *   - the triage engine's per-AC classification (J-check-test-updates owns it);
 *   - browser rendering of the refusal (Bashir's e2e owns the rendered page; the
 *     wiring that carries the reason into it IS asserted here, statically).
 *
 * #99992: all state lives in per-test tmpdirs + a LOCAL BARE origin; a
 * PATH-stubbed `gh` guarantees no call can ever reach real GitHub.
 */

// @ac-hash: slice-361-ac-1 sha256:e6953637487630b71692176dfb2df6c6c07d65a8cb36f4a9d0f9ec0abb5d2eb8
// @ac-hash: slice-361-ac-2 sha256:462912ca3da975aceb60b7b3b4bf702f645f234fa30aa9882e6ddfeb90254667
// @ac-hash: slice-361-ac-3 sha256:c7b4a0cc8963a94a8a85f1a66c342dc5667d04654a31755241971bb1b1726938
// @ac-hash: slice-361-ac-4 sha256:49f619c649f593a785fdab1b3217847f576c9a9360a8bf124f55ba7ca16ba303
// @ac-hash: slice-361-ac-5 sha256:5d80ddba9f39c93900377cf6a83a482561bc9f5357a5f5575f4aef051bfdc74f
// @ac-hash: slice-361-ac-6 sha256:587a2d199ffb987a33d15cbbdf3b7444fa975d64b6c0c11eb85adc5b2498cb1c

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const http = require('node:http');

const {
  GIT_ENV, git, commitFile, initGitFixture,
  installGhStub, compileServer, setPromoteRuns, readDispatches,
} = require('./j-merge-button-pass-helpers');

const REPO_ROOT_REAL = path.resolve(__dirname, '..', '..');
const SERVER_SRC     = path.join(REPO_ROOT_REAL, 'dashboard', 'server.js');
const DASHBOARD_SRC  = path.join(REPO_ROOT_REAL, 'dashboard', 'lcars-dashboard.html');

// A tag well outside the real slice range so a fixture AC can never collide with
// a live one in regression/AC-MANIFEST.lock or COVERAGE.lock.
const FIXTURE_AC = 'slice-99361-ac-1';

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

// Commit on dev with a real `AC:` trailer in the body — the off-canon mechanism
// the CHECK gate scans (lib/ac-range-scan.js reads origin/main..origin/dev).
function advanceDevWithAc(workDir, relPath, tag, acText) {
  git(['checkout', '--quiet', 'dev'], workDir);
  const abs = path.join(workDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `behaviour for ${tag}\n`, 'utf8');
  git(['add', relPath], workDir);
  git(['commit', '--quiet', '-m', `feat: ${tag}\n\nAC: ${tag}: ${acText}`], workDir);
  git(['push', '--quiet', 'origin', 'dev'], workDir);
  return git(['rev-parse', 'HEAD'], workDir);
}

function promoteToMain(workDir) {
  git(['checkout', '--quiet', 'main'], workDir);
  git(['merge', '--ff-only', 'dev'], workDir);
  git(['push', '--quiet', 'origin', 'main'], workDir);
  git(['checkout', '--quiet', 'dev'], workDir);
}

// The operator's recorded ruling for a flagged AC (regression/AC-DECISIONS.json).
// Written directly: the lock READS this state and must never write it.
function recordDecision(tmpRoot, tag, decision) {
  const p = path.join(tmpRoot, 'regression', 'AC-DECISIONS.json');
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) {}
  if (decision == null) delete cur[tag]; else cur[tag] = decision;
  fs.writeFileSync(p, JSON.stringify(cur, null, 1), 'utf8');
}

async function makeFixture(label) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), label));
  for (const dir of [
    path.join(tmpRoot, 'bridge', 'queue'),
    path.join(tmpRoot, 'bridge', 'staged'),
    path.join(tmpRoot, 'bridge', 'trash'),
    path.join(tmpRoot, 'bridge', 'control'),
    path.join(tmpRoot, 'bridge', 'errors'),
    path.join(tmpRoot, 'bridge', 'state'),
    path.join(tmpRoot, 'dashboard'),
    path.join(tmpRoot, 'regression'),
    path.join(tmpRoot, 'scripts'),
  ]) fs.mkdirSync(dir, { recursive: true });

  const registerPath = path.join(tmpRoot, 'bridge', 'register.jsonl');
  fs.writeFileSync(registerPath, '', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'heartbeat.json'), JSON.stringify({ current_slice: null }), 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'queue-order.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'staged-order.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'sessions.jsonl'), '', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'first-output.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'nog-active.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'state', 'branch-state.json'), '{}', 'utf8');

  // The gate's real engine, run against the fixture: server.js resolves lib/ and
  // scripts/ relative to REPO_ROOT, so the derivation under test is the shipped
  // one (range scan → reconcile → triage), not a stand-in.
  fs.cpSync(path.join(REPO_ROOT_REAL, 'lib'), path.join(tmpRoot, 'lib'), { recursive: true });
  fs.cpSync(path.join(REPO_ROOT_REAL, 'scripts', 'build-ac-manifest.js'),
            path.join(tmpRoot, 'scripts', 'build-ac-manifest.js'));
  // No guard covers anything in this fixture: every AC in the range reads MISSING
  // until the operator rules on it. AC-DECISIONS starts empty (nothing ruled).
  fs.writeFileSync(path.join(tmpRoot, 'regression', 'COVERAGE.lock'),
                   JSON.stringify({ bySource: {} }), 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'regression', 'AC-DECISIONS.json'), '{}', 'utf8');

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
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  return {
    tmpRoot, originDir, stubDir, registerPath, server, port, fixture,
    bustCache: exported._bustGitHubCache,
    _prevPath: prevPath, _prevEnv: prevEnv,
    req: (m, u, p) => request(port, m, u, p),
    originDevSha: () => git(['rev-parse', 'refs/heads/dev'], originDir),
  };
}

async function teardown(fx) {
  if (fx.server) await new Promise(r => fx.server.close(r));
  process.env.PATH = fx._prevPath;
  for (const k of Object.keys(fx._prevEnv)) {
    if (fx._prevEnv[k] === undefined) delete process.env[k];
    else process.env[k] = fx._prevEnv[k];
  }
  fs.rmSync(fx.tmpRoot, { recursive: true, force: true });
}

// ── AC-1 ─────────────────────────────────────────────────────────────────────
test('J-merge-lock-server slice-361-ac-1 — an unresolved AC refuses the promote dispatch, and no workflow is invoked', async () => {
  const fx = await makeFixture('j-merge-lock-ac1-');
  try {
    advanceDevWithAc(fx.tmpRoot, 'src/feature.js', FIXTURE_AC,
      'the dispatch is governed by the server');
    fx.bustCache();

    const res = await fx.req('POST', '/api/promote/dispatch', {});
    assert.equal(res.status, 409, 'an unresolved AC must refuse the dispatch');
    assert.equal(res.body.error, 'test_updates_unresolved');
    assert.equal(res.body.ok, false);
    // The real assertion: the lock is not cosmetic — gh was never called.
    assert.deepEqual(readDispatches(fx.stubDir), [],
      'a refused dispatch must not fire promote.yml');

    // And the same state, once the human has ruled, dispatches.
    recordDecision(fx.tmpRoot, FIXTURE_AC, 'keep');
    fx.bustCache();
    const ok = await fx.req('POST', '/api/promote/dispatch', {});
    assert.equal(ok.status, 200, 'a resolved check must let the gate run');
    assert.equal(ok.body.ok, true);
    assert.equal(readDispatches(fx.stubDir).length, 1, 'promote.yml dispatched exactly once');
  } finally {
    await teardown(fx);
  }
});

// ── AC-2 ─────────────────────────────────────────────────────────────────────
test('J-merge-lock-server slice-361-ac-2 — the refusal names what is outstanding and is distinct from nothing-to-promote / gate-already-running', async () => {
  const fx = await makeFixture('j-merge-lock-ac2-');
  try {
    // (a) dev level with main → nothing to promote. A different, honest reason.
    fx.bustCache();
    const empty = await fx.req('POST', '/api/promote/dispatch', {});
    assert.equal(empty.body.error, 'nothing_to_promote');

    // (b) an unresolved AC → the lock, naming the count and the tags.
    advanceDevWithAc(fx.tmpRoot, 'src/feature.js', FIXTURE_AC, 'the refusal is legible');
    fx.bustCache();
    const locked = await fx.req('POST', '/api/promote/dispatch', {});
    assert.equal(locked.status, 409);
    assert.equal(locked.body.error, 'test_updates_unresolved');
    assert.equal(locked.body.outstanding, 1, 'the refusal states HOW MANY are outstanding');
    assert.deepEqual(locked.body.tags, [FIXTURE_AC], 'the refusal names WHICH ACs');
    assert.ok(Array.isArray(locked.body.items) && locked.body.items[0].tag === FIXTURE_AC,
      'each outstanding AC is itemised so the panel can explain it');
    assert.notEqual(locked.body.error, 'gate_already_running');
    assert.notEqual(locked.body.error, 'nothing_to_promote');

    // (c) a gate already in flight over a RESOLVED check → the mutex reason, not
    // the lock's. A wrong reason is worse than a generic one.
    recordDecision(fx.tmpRoot, FIXTURE_AC, 'keep');
    setPromoteRuns(fx.stubDir, [{ status: 'in_progress', conclusion: null, databaseId: 361,
      url: 'https://github.example/actions/runs/361', headSha: 'deadbee' }]);
    fx.bustCache();
    const running = await fx.req('POST', '/api/promote/dispatch', {});
    assert.equal(running.status, 409);
    assert.equal(running.body.error, 'gate_already_running');

    assert.deepEqual(readDispatches(fx.stubDir), [], 'none of the three refusals fired a workflow');
  } finally {
    await teardown(fx);
  }
});

// ── AC-3 ─────────────────────────────────────────────────────────────────────
test('J-merge-lock-server slice-361-ac-3 — a check bound to a different integration tip does not unlock the dispatch', async () => {
  const fx = await makeFixture('j-merge-lock-ac3-');
  try {
    const oldTip = advanceDevWithAc(fx.tmpRoot, 'src/a.js', FIXTURE_AC, 'the check is tip-bound');
    recordDecision(fx.tmpRoot, FIXTURE_AC, 'keep');   // the operator ruled, at oldTip
    fx.bustCache();

    // dev moves on under the open page. The triage is still clean (the new commit
    // declares no AC), so ONLY the tip binding can catch this.
    const newTip = commitFile(fx.tmpRoot, 'src/b.js', 'later work\n', 'chore: later work on dev');
    git(['push', '--quiet', 'origin', 'dev'], fx.tmpRoot);
    fx.bustCache();
    assert.notEqual(oldTip, newTip);

    const stale = await fx.req('POST', '/api/promote/dispatch', { checked_sha: oldTip });
    assert.equal(stale.status, 409, 'a pass earned at an older tip must not unlock a newer one');
    assert.equal(stale.body.error, 'stale_check');
    assert.equal(stale.body.dev_sha, newTip.slice(0, 7), 'the refusal names the tip that is actually pending');
    assert.deepEqual(readDispatches(fx.stubDir), [], 'a stale check must not fire promote.yml');

    // Re-checked against the tip that is actually about to merge → through.
    const fresh = await fx.req('POST', '/api/promote/dispatch', { checked_sha: newTip });
    assert.equal(fresh.status, 200);
    assert.equal(readDispatches(fx.stubDir).length, 1);
  } finally {
    await teardown(fx);
  }
});

// ── AC-4 ─────────────────────────────────────────────────────────────────────
test('J-merge-lock-server slice-361-ac-4 — rollback obeys the same lock, and a refused rollback creates no revert commit', async () => {
  const fx = await makeFixture('j-merge-lock-ac4-');
  try {
    // A promoted slice to roll back: commit it on dev, ff main to it, record the
    // squash event the rollback resolves against.
    const squashSha = commitFile(fx.tmpRoot, 'src/slice-777.js', 'slice 777 behaviour\n', 'S777: shipped');
    git(['push', '--quiet', 'origin', 'dev'], fx.tmpRoot);
    promoteToMain(fx.tmpRoot);
    fs.appendFileSync(fx.registerPath, JSON.stringify({
      ts: new Date().toISOString(), id: '777', event: 'SLICE_SQUASHED_TO_DEV',
      slice_id: '777', squash_sha: squashSha, dev_tip_sha: squashSha }) + '\n', 'utf8');

    // Now an unresolved AC lands on dev, ahead of main.
    const devTipBefore = advanceDevWithAc(fx.tmpRoot, 'src/feature.js', FIXTURE_AC,
      'rollback obeys the same rule');
    fx.bustCache();

    const refused = await fx.req('POST', '/api/rollback/dispatch', { slice_id: '777' });
    assert.equal(refused.status, 409, 'rollback is governed by the same rule as promote');
    assert.equal(refused.body.error, 'test_updates_unresolved');
    assert.equal(refused.body.outstanding, 1);
    // The point of refusing BEFORE the revert is built: nothing to clean up.
    assert.equal(fx.originDevSha(), devTipBefore,
      'a refused rollback must leave origin/dev exactly where it was — no revert commit');
    assert.deepEqual(readDispatches(fx.stubDir), [], 'a refused rollback must not fire promote.yml');

    // Once ruled on, the same rollback goes through and DOES create the revert.
    recordDecision(fx.tmpRoot, FIXTURE_AC, 'keep');
    fx.bustCache();
    const ok = await fx.req('POST', '/api/rollback/dispatch', { slice_id: '777' });
    assert.equal(ok.status, 200, 'a resolved check lets the rollback through');
    assert.notEqual(fx.originDevSha(), devTipBefore, 'the revert commit now exists on origin/dev');
    assert.equal(readDispatches(fx.stubDir).length, 1);
  } finally {
    await teardown(fx);
  }
});

// ── AC-5 ─────────────────────────────────────────────────────────────────────
test('J-merge-lock-server slice-361-ac-5 — the refusal is derived on the server; no value in the request can satisfy it', async () => {
  const fx = await makeFixture('j-merge-lock-ac5-');
  try {
    // A rollback target so the rollback path reaches the lock rather than 404ing
    // on an unknown slice (unknown_slice is the more specific, earlier refusal).
    const squashSha = commitFile(fx.tmpRoot, 'src/slice-777.js', 'slice 777 behaviour\n', 'S777: shipped');
    git(['push', '--quiet', 'origin', 'dev'], fx.tmpRoot);
    promoteToMain(fx.tmpRoot);
    fs.appendFileSync(fx.registerPath, JSON.stringify({
      ts: new Date().toISOString(), id: '777', event: 'SLICE_SQUASHED_TO_DEV',
      slice_id: '777', squash_sha: squashSha, dev_tip_sha: squashSha }) + '\n', 'utf8');

    const tip = advanceDevWithAc(fx.tmpRoot, 'src/feature.js', FIXTURE_AC,
      'the client cannot assert the answer');
    fx.bustCache();

    // Every shape a forger would reach for, including a truthful checked_sha —
    // the tip binding can only ADD a refusal, never remove the derived one.
    const forged = {
      checked_sha: tip, check_passed: true, checkPassed: true, ready: true,
      test_updates_ready: true, testUpdatesReady: true, force: true, override: true,
      test_updates: { ready: true, flagged: [] },
      flagged: [], outstanding: 0, verdict: 'CLEAR',
    };
    for (const url of ['/api/promote/dispatch', '/api/rollback/dispatch']) {
      const res = await fx.req('POST', url, { ...forged, slice_id: '777' });
      assert.equal(res.status, 409, `${url} must derive the lock, not read it off the request`);
      assert.equal(res.body.error, 'test_updates_unresolved', url);
    }
    assert.deepEqual(readDispatches(fx.stubDir), [], 'no forged payload may fire promote.yml');

    // The derivation is the shipped triage, called fresh — not a cached or
    // client-supplied verdict. (Trap 2: a fast stale answer IS the bug.)
    const src = fs.readFileSync(SERVER_SRC, 'utf8');
    const fn = src.slice(src.indexOf('function mergeLockRefusal'),
                         src.indexOf('function _shaMatches'));
    assert.ok(fn.length > 0, 'mergeLockRefusal must exist in dashboard/server.js');
    assert.match(fn, /getCheckTestUpdates\(\)/, 'the lock derives its answer from the live triage');
    assert.ok(!/payload|req\.|body/.test(fn),
      'the lock must not reach into the request for anything but the tip it is given');
  } finally {
    await teardown(fx);
  }
});

// ── AC-6 ─────────────────────────────────────────────────────────────────────
test('J-merge-lock-server slice-361-ac-6 — the panel reads the server’s reason back instead of failing silently', () => {
  const src = fs.readFileSync(DASHBOARD_SRC, 'utf8');

  // One translator for all three refusal codes, shared by the promote slot and
  // both rollback overlays — so they can never disagree about why.
  assert.match(src, /function _mergeLockMessage\(/);
  for (const code of ['test_updates_unresolved', 'stale_check', 'test_updates_unavailable']) {
    assert.ok(src.includes(`'${code}'`), `the panel must explain ${code}`);
  }
  // The reason reaches the operator through the existing failure affordance.
  assert.match(src, /_promoteSlotError\s*=\s*lock\.short/);
  assert.match(src, /_promoteSlotErrorTitle\s*=\s*lock\.full/);
  assert.match(src, /class="promote-gate-err"[^`]*_promoteSlotErrorTitle \|\| _promoteSlotError/);

  // Both rollback overlays surface it too (one call in each confirm handler).
  const rollbackUses = src.match(/const _lock = _mergeLockMessage\(code, data\);/g) || [];
  assert.equal(rollbackUses.length, 2, 'both rollback confirm paths must explain a lock refusal');
  assert.match(src, /_lock\.full \+ ' Nothing was committed to dev\.'/);

  // And the page tells the server which tip it checked, on every dispatch path.
  const carriesTip = src.match(/checked_sha: _testUpdatesSha \|\| null/g) || [];
  assert.equal(carriesTip.length, 3,
    'promote + both rollback dispatches must carry the tip their check was made against');
});
