'use strict';

/**
 * Journey: J-merge-truth-now
 * Category: Gate & Merge
 *
 * What this tests (spec = journey text, not implementation):
 *   The moment a promote succeeds, the panel tells the truth. Philipp presses
 *   RUN GATE & MERGE TO MAIN, the gate goes green, promote.yml fast-forwards
 *   origin/main — and the next thing the panel says is "merged", not "still
 *   pending on dev". On 2026-09-01 it said pending for up to a minute after the
 *   merge landed, an operator read that as commits on an unexpected branch, and
 *   a phantom investigation was opened. Nothing had moved; the panel was
 *   confidently serving pre-merge refs out of a TTL cache.
 *
 *   Pinned here:
 *     - a promote observed to COMPLETE invalidates the cached refs (it used to
 *       be invalidated only on dispatch, minutes earlier)
 *     - the slices that promote carried stop presenting as pending-on-dev at
 *       that same moment, without waiting out a TTL
 *     - where the refs have not caught up yet, the payload says it is
 *       reconciling and the panel renders that instead of the pre-merge answer
 *     - the QUIET path is untouched: a settled promote re-read does not bust
 *       anything, and ordinary reads keep their original 30s/60s lifetimes
 *
 * Tiers used:
 *   - Pure: isFreshPromoteCompletion / isReconciling — the two decisions the
 *     cache layer turns on, tested directly.
 *   - Tier 2: dashboard/server.js compiled against a tmpRoot (REPO_ROOT
 *     rewritten), a LOCAL BARE origin for git, and a PATH-stubbed `gh` so no
 *     call can reach real GitHub (#99992: all state in tmpdirs). The only value
 *     the fixture changes is the in-flight promote TTL (10s → 0), so the live
 *     refresh can be exercised without a ten-second sleep; nothing busts a cache
 *     after the merge lands, which is exactly the condition of the bug.
 *   - Static: the dashboard source, for the reconciling render paths.
 *
 * Deliberately NOT asserted here (and why):
 *   - Real GitHub timing (how long after the ff push the run reports completed):
 *     not testable offline; the panel's response to the reported completion IS.
 *   - Pixel rendering of the reconciling states: covered by static source
 *     assertions here, visual behaviour belongs to e2e.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');

const {
  git, initGitFixture, advanceDev, installGhStub, setPromoteRuns,
} = require('./j-merge-button-pass-helpers');

const REPO_ROOT_REAL = path.resolve(__dirname, '..', '..');
const SERVER_SRC     = path.join(REPO_ROOT_REAL, 'dashboard', 'server.js');
const DASHBOARD_SRC  = path.join(REPO_ROOT_REAL, 'dashboard', 'lcars-dashboard.html');

const serverSrcText = fs.readFileSync(SERVER_SRC, 'utf8');
const dashboardText = fs.readFileSync(DASHBOARD_SRC, 'utf8');

const { isFreshPromoteCompletion, isReconciling, _promoteTtlMs } = require(SERVER_SRC);

let tmpRoot;
let server;
let port;
let bust;          // exported _bustGitHubCache(scope)
let stubDir;
let originDir;
let runIdSeq = 36200;

function compileServer(root) {
  const dashboardDir = path.join(root, 'dashboard');
  const lifecyclePath = path.join(root, 'bridge', 'lifecycle-translate.js');
  // Slice 370: the return-to-stage rules are one shared bridge module, read by the
  // dashboard server and the orchestrator alike. The fixture root gets the REAL one —
  // a stub here would be a second set of rules that ships nowhere.
  fs.writeFileSync(
    path.join(root, 'bridge', 'return-to-stage-eligibility.js'),
    `module.exports = require(${JSON.stringify(path.resolve(__dirname, '..', '..', 'bridge', 'return-to-stage-eligibility.js'))});\n`,
    'utf8',
  );
  fs.writeFileSync(lifecyclePath, `
'use strict';
module.exports = { translateEvent(ev) { return ev; }, resetDedupeState() {} };
`, 'utf8');
  fs.writeFileSync(path.join(dashboardDir, 'lcars-dashboard.html'), '<html></html>', 'utf8');
  fs.writeFileSync(path.join(dashboardDir, 'tokens.css'), '', 'utf8');

  // Every rewrite below is asserted to have applied. A silently-missed rewrite would
  // leave the server pointed at the REAL repo (or keep the real 10s live TTL) and turn
  // this whole file false-green — the trap the e2e suite already got caught by once.
  const rewrite = (text, re, to, what) => {
    const out = text.replace(re, to);
    assert.notEqual(out, text, `fixture rewrite failed to apply: ${what}`);
    return out;
  };

  let src = serverSrcText;
  src = rewrite(src,
    /const REPO_ROOT\s*=[\s\S]*?path\.resolve\(__dirname,\s*'\.\.'\);/,
    `const REPO_ROOT = ${JSON.stringify(root)};`, 'REPO_ROOT');
  // The live promote TTL is 10s in production; here it is 0 so a guard can exercise
  // the in-flight refresh without a ten-second sleep. Production value is pinned by
  // its own static assertion below.
  src = rewrite(src,
    /const GH_PROMOTE_LIVE_TTL_MS = 10 \* 1000;/,
    'const GH_PROMOTE_LIVE_TTL_MS = 0;', 'GH_PROMOTE_LIVE_TTL_MS');
  src = src
    .replace(
      /const DASHBOARD\s*=\s*path\.join\(__dirname,\s*'lcars-dashboard\.html'\);/,
      `const DASHBOARD = ${JSON.stringify(path.join(dashboardDir, 'lcars-dashboard.html'))};`
    )
    .replace(
      /const TOKENS_CSS\s*=\s*path\.join\(__dirname,\s*'tokens\.css'\);/,
      `const TOKENS_CSS = ${JSON.stringify(path.join(dashboardDir, 'tokens.css'))};`
    )
    .replace(
      /require\(path\.join\(REPO_ROOT,\s*'bridge',\s*'lifecycle-translate'\)\)/,
      `require(${JSON.stringify(lifecyclePath)})`
    )
    .replace(/if \(require\.main === module\)/, 'if (false)')
    .replace(/module\.exports = \{ /, 'module.exports = { server, _bustGitHubCache, ');
  assert.match(src, /module\.exports = \{ server, _bustGitHubCache, /, 'export rewrite applied');

  const mod = new Module('patched-dashboard-server-362');
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

/** Fast-forward the bare origin's main to origin/dev — what promote.yml's ff step does. */
function fastForwardOriginMain() {
  git(['push', '--quiet', originDir, 'refs/remotes/origin/dev:refs/heads/main'], tmpRoot);
}

/** A promote run as `gh run list --workflow=promote.yml` reports it. */
function promoteRun(id, headSha, status, conclusion) {
  return [{
    status, conclusion, databaseId: id,
    url: `https://github.example/actions/runs/${id}`,
    headSha,
  }];
}

/**
 * The 2026-09-01 sequence, offline:
 *   1. a slice commit sits on dev and a promote is in flight → the panel reads it.
 *      This warms BOTH sub-caches: the refs reading now holds the PRE-MERGE answer.
 *   2. the gate goes green: origin/main fast-forwards to dev and the run reports
 *      completed/success.
 *   3. the panel is read again — with NO cache busting at all. That is the whole
 *      point: the refs cache is still well inside its 30s lifetime and would happily
 *      keep answering "still pending on dev" (it did, for up to half a minute, on the
 *      day). Only noticing the completion can make this read tell the truth.
 * Returns { sliceId, devSha, before, after }.
 */
async function promoteCompletes(sliceId, { fastForward = true } = {}) {
  const runId = ++runIdSeq;
  const devSha = advanceDev(tmpRoot, `slice-${sliceId}.txt`,
    `work for slice ${sliceId}\n`, `slice/${sliceId} land the work`);
  setPromoteRuns(stubDir, promoteRun(runId, devSha, 'in_progress', null));
  bust(); // stands in for the dispatch that just happened
  const before = (await request('/api/branch-state')).body;

  if (fastForward) fastForwardOriginMain();
  setPromoteRuns(stubDir, promoteRun(runId, devSha, 'completed', 'success'));
  const after = (await request('/api/branch-state')).body;

  return { sliceId, devSha, before, after };
}

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j-merge-truth-now-'));
  for (const dir of [
    path.join(tmpRoot, 'bridge', 'queue'),
    path.join(tmpRoot, 'bridge', 'staged'),
    path.join(tmpRoot, 'bridge', 'trash'),
    path.join(tmpRoot, 'bridge', 'control'),
    path.join(tmpRoot, 'bridge', 'errors'),
    path.join(tmpRoot, 'bridge', 'state'),
    path.join(tmpRoot, 'dashboard'),
  ]) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'register.jsonl'), '', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'heartbeat.json'), JSON.stringify({ current_slice: null }), 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'queue-order.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'staged-order.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'sessions.jsonl'), '', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'first-output.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'nog-active.json'), '{}', 'utf8');
  // A branch-state.json carrying a STALE dev ribbon — the live one on this repo has
  // been frozen since the local merge gate was retired. The GitHub reading must win.
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'state', 'branch-state.json'), JSON.stringify({
    dev: { commits: [{ sha: 'deadbee', slice_id: '999', subject: 'slice/999 stale file entry' }] },
  }), 'utf8');

  const binDir = path.join(tmpRoot, 'bin');
  stubDir = path.join(tmpRoot, 'gh-stub');
  installGhStub(binDir, stubDir);
  process.env.PATH = binDir + path.delimiter + process.env.PATH;
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_SYSTEM = '/dev/null';

  originDir = path.join(tmpRoot, 'origin.git');
  initGitFixture({ workDir: tmpRoot, originDir });

  const exported = compileServer(tmpRoot);
  server = exported.server;
  bust = exported._bustGitHubCache;
  assert.equal(typeof bust, 'function', 'server must export _bustGitHubCache for TTL-cache control');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-1 — a completed promote invalidates the cached GitHub state
// ═══════════════════════════════════════════════════════════════════════════

test('J-merge-truth-now slice-362-ac-1 — a promote observed to COMPLETE drops the cached refs, so the next panel read reflects the merge instead of serving pre-merge state', async () => {
  const { devSha, before, after } = await promoteCompletes('3621');

  // Precondition: the panel had cached the pre-merge answer.
  assert.equal(before.github.commits_ahead, 1, 'dev was one commit ahead while the gate ran');
  assert.equal(before.github.origin_main_sha, before.main.tip_sha);
  assert.notEqual(before.github.origin_main_sha, devSha.slice(0, 7),
    'main had not moved yet when the cache was warmed');

  // The merge landed and the run reported success. NOTHING was invalidated by the
  // test — under the pre-362 code the warm refs cache keeps answering "1 ahead" for
  // the rest of its 30s lifetime, which is precisely what Philipp read on 2026-09-01.
  assert.equal(after.github.promote_run.status, 'success');
  assert.equal(after.github.commits_ahead, 0,
    'the completed promote invalidated the refs — main is level with dev in the SAME read');
  assert.equal(after.github.origin_main_sha, devSha.slice(0, 7),
    'origin/main is re-read at the promoted sha, not the cached pre-merge tip');
});

test('J-merge-truth-now slice-362-ac-1 — the completion is noticed on the promote read the panel already makes; no second GitHub poller is introduced', () => {
  // Trap 2: detection must ride the existing `gh run list` read that drives the
  // promote strip. If a timer ever appears against the promote API, this fails.
  const promoteFn = serverSrcText.slice(serverSrcText.indexOf('function _getGhPromote()'));
  const body = promoteFn.slice(0, promoteFn.indexOf('\nfunction '));
  assert.match(body, /isFreshPromoteCompletion/,
    'completion is detected inside the existing _getGhPromote read');
  assert.doesNotMatch(serverSrcText, /setInterval\([^)]*(?:_getGhPromote|promote)/i,
    'no polling timer may be added against the promote API');
});

test('J-merge-truth-now slice-362-ac-1 — a settled run re-read is NOT a completion: only the transition into terminal busts', () => {
  const running = { run_id: 7, status: 'in_progress' };
  const done    = { run_id: 7, status: 'success' };

  assert.equal(isFreshPromoteCompletion(running, done), true, 'running → success is the event');
  assert.equal(isFreshPromoteCompletion(done, done), false,
    'a settled run re-read every TTL must not keep busting — that would defeat the cache');
  assert.equal(isFreshPromoteCompletion(done, { run_id: 7, status: 'in_progress' }), false,
    'going back to running is not a completion');
  assert.equal(isFreshPromoteCompletion(running, { run_id: 7, status: 'failure' }), true,
    'a failed gate also settles the refs question — main did not move, and we should say so freshly');
  assert.equal(isFreshPromoteCompletion(done, { run_id: 8, status: 'success' }), true,
    'a different run that is already terminal started and finished between reads');
  assert.equal(isFreshPromoteCompletion(done, { run_id: null, status: 'idle' }), false,
    'a gh outage degrades to idle/null and must not be read as a completion');
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-2 — the slices that promote carried present as merged, not pending
// ═══════════════════════════════════════════════════════════════════════════

test('J-merge-truth-now slice-362-ac-2 — a slice carried by a successful promote stops presenting as pending-on-dev immediately, without waiting out a cache expiry', async () => {
  const { sliceId, before, after } = await promoteCompletes('3622');

  const pendingBefore = (before.github.dev_commits || []).map(c => c.slice_id);
  assert.ok(pendingBefore.includes(sliceId),
    `slice ${sliceId} was pending on dev while the gate ran — got [${pendingBefore.join(', ')}]`);

  const pendingAfter = (after.github.dev_commits || []).map(c => c.slice_id);
  assert.deepEqual(pendingAfter, [],
    'origin/main..origin/dev is empty the moment the promote completes — nothing still reads as pending');
  assert.ok(!pendingAfter.includes(sliceId),
    `slice ${sliceId} presents as merged, not pending`);
});

test('J-merge-truth-now slice-362-ac-2 — the emptied dev ribbon is not refilled from the frozen branch-state.json', async () => {
  const { after } = await promoteCompletes('3623');
  // branch-state.json (written before) carries a stale slice/999 entry. A healthy
  // GitHub reading is authoritative even when it is EMPTY — otherwise the just-merged
  // commits get drawn back onto the topology from a file nothing updates any more.
  assert.deepEqual(after.dev.commits, [],
    'the topology ribbon is empty after the merge — no fallback to the stale file');
  assert.equal(after.dev.commits_ahead_of_main, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-3 — honest transience: say "reconciling", never assert the pre-merge answer
// ═══════════════════════════════════════════════════════════════════════════

test('J-merge-truth-now slice-362-ac-3 — a success whose fast-forward we cannot see yet reports reconciling instead of the pre-merge answer, and clears once the refs catch up', async () => {
  // The gate reported success but our view of origin/main has not caught up (a slow
  // ref, a failed fetch — whatever the reason, the answer we hold is pre-merge).
  const { devSha, after: unreconciled } = await promoteCompletes('3624', { fastForward: false });

  assert.equal(unreconciled.github.promote_run.status, 'success');
  assert.equal(unreconciled.github.reconciling, true,
    'the panel is told it is behind rather than being handed the stale answer as fact');
  assert.notEqual(unreconciled.github.origin_main_sha, devSha.slice(0, 7),
    'precondition: main genuinely has not been observed at the promoted sha');

  // The refs catch up — the transient state must clear on its own.
  fastForwardOriginMain();
  bust('refs'); // stand in for the refs reading reaching its own expiry
  const reconciled = (await request('/api/branch-state')).body;
  assert.equal(reconciled.github.reconciling, false, 'reconciling is transient, not sticky');
  assert.equal(reconciled.github.origin_main_sha, devSha.slice(0, 7));
});

test('J-merge-truth-now slice-362-ac-3 — a PAST promote does not flag reconciling: dev moving on is real pending work, not a stale read', () => {
  const tips = { origin_main_sha: 'aaaaaaa', origin_dev_sha: 'ccccccc' };
  assert.equal(isReconciling(tips, { status: 'success', head_sha7: 'bbbbbbb' }), false,
    'a success for a sha dev has moved past is history — the commits since ARE pending');
  assert.equal(isReconciling({ origin_main_sha: 'bbbbbbb', origin_dev_sha: 'bbbbbbb' },
    { status: 'success', head_sha7: 'bbbbbbb' }), false, 'main at the promoted sha is settled');
  assert.equal(isReconciling({ origin_main_sha: 'aaaaaaa', origin_dev_sha: 'bbbbbbb' },
    { status: 'success', head_sha7: 'bbbbbbb' }), true, 'main still behind the promoted dev tip');
  assert.equal(isReconciling({ origin_main_sha: 'aaaaaaa', origin_dev_sha: 'bbbbbbb' },
    { status: 'failure', head_sha7: 'bbbbbbb' }), false,
    'a red gate did not move main — pending is the honest answer there');
  // Unreadable refs are a different failure (github.error). Calling them "reconciling"
  // would latch the state — and the merge button shut — for as long as git fetch fails.
  assert.equal(isReconciling({ error: 'fetch failed', origin_main_sha: null, origin_dev_sha: null },
    { status: 'success', head_sha7: 'bbbbbbb' }), false,
    'a broken refs read is not a merge landing, and must not latch reconciling on');
});

test('J-merge-truth-now slice-362-ac-3 — the panel renders reconciling rather than the pre-merge numbers', () => {
  assert.match(dashboardText, /function _ghReconciling\(gh\)/,
    'the dashboard reads the reconciling flag off the payload');
  assert.match(dashboardText, /_ghReconciling\(bs\.github\) \? 'reconciling…' : `\$\{ahead\} ahead`/,
    'the commits-ahead readout says reconciling instead of stating a pre-merge count');
  assert.match(dashboardText, /RECONCILING/,
    'the topology pill names the reconciling state');
  assert.match(dashboardText, /const reconciling = _ghReconciling\(gh\);/,
    'the promote/rollback controls read the reconciling flag');
  assert.match(dashboardText, /const enabled = ahead > 0 && !running && !reconciling/,
    'the merge button is held while the refs are known to be behind');
});

test('J-merge-truth-now slice-362-ac-3 — the branch graph renders the pre-merge base as unsettled instead of ticking it as promoted', () => {
  // The confidently-wrong render: a merge ✓ next to the sha main was promoted to LAST
  // time, while a newer promote has already moved main past it. That tick is drawn in
  // renderTopoSvg — the surface that ACTUALLY renders. (The old #ci-strip promote row
  // is not: its elements were removed in the redesign, so nothing there can be a
  // guard.) The rendered result is asserted for real in e2e/reconciling-topology.spec.js;
  // pinned here so the honest branch cannot be deleted without a red.
  const start = dashboardText.indexOf('function renderTopoSvg(bs)');
  const topo  = dashboardText.slice(start, dashboardText.indexOf('function mergePressureBand'));
  assert.ok(start !== -1 && topo.length > 0, 'found the branch-graph renderer');

  const unsettledNode = topo.indexOf('if (mainSha && reconciling)');
  const mergeTick     = topo.indexOf('if (isMerge) svg +=');
  assert.ok(unsettledNode !== -1, 'the graph has a reconciling branch for the origin/main node');
  assert.ok(mergeTick !== -1, 'precondition: the merge ✓ is still drawn on the settled path');
  assert.ok(unsettledNode < mergeTick,
    'the reconciling node is chosen BEFORE the branch that ticks a sha we know is superseded');

  assert.match(topo, /reconciling \? 'dev ↻' : `dev \+\$\{ahead\}`/,
    'the dev head badge stops asserting a commits-ahead count the caption disclaims');
  assert.match(topo, /topo-c-premerge/,
    'the base row marks its sha as pre-merge rather than printing it as the current tip');
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-4 — the quiet path is untouched (trap 1: do not just shorten the TTLs)
// ═══════════════════════════════════════════════════════════════════════════

test('J-merge-truth-now slice-362-ac-4 — the 10s live lifetime is bounded, so a gh outage mid-run cannot leave ordinary reads on the fast path forever', () => {
  // The live lifetime keys off the LAST status we managed to fetch, and that status is
  // sticky on purpose (a gh blip must not lose the run we are watching). Sticky plus
  // unbounded = if gh breaks while a run is in flight, every later read degrades to
  // idle and is discarded, the held status stays in_progress, and the dashboard retries
  // a blocking `gh` call every 10s indefinitely instead of resting at 60s.
  const now = 1_800_000_000_000;
  assert.equal(_promoteTtlMs({ status: 'in_progress', live_since: now - 1000 }, now), 10 * 1000,
    'a run that started a second ago is watched at the live rate');
  assert.equal(_promoteTtlMs({ status: 'in_progress', live_since: now - 20 * 60 * 1000 }, now), 60 * 1000,
    'a status still in flight 20 minutes on has outlived the window — back to the quiet lifetime');
  assert.equal(_promoteTtlMs({ status: 'success', live_since: now }, now), 60 * 1000,
    'a settled run is always the quiet lifetime');
  assert.equal(_promoteTtlMs({ status: null, live_since: 0 }, now), 60 * 1000,
    'nothing seen yet is the quiet lifetime, not the fast one');
});

test('J-merge-truth-now slice-362-ac-4 — cache lifetimes for the quiet path are unchanged: 30s git, 60s gh', () => {
  assert.match(serverSrcText, /const GIT_TTL_MS = 30 \* 1000;/,
    'the git TTL is still 30s — the fix is event-driven, not a faster poll');
  assert.match(serverSrcText, /const GH_TTL_MS {2}= 60 \* 1000;/,
    'the gh TTL is still 60s');
});

test('J-merge-truth-now slice-362-ac-4 — with no promote transition, ordinary reads are still served from cache and do not re-hit the network', async () => {
  // Settle a run so the next reads carry no transition at all.
  const runId = ++runIdSeq;
  const devSha = advanceDev(tmpRoot, 'quiet-path.txt', 'quiet\n', 'slice/3625 quiet path work');
  setPromoteRuns(stubDir, promoteRun(runId, devSha, 'completed', 'success'));
  bust();
  const first = (await request('/api/branch-state')).body;
  assert.equal(first.github.commits_ahead, 1, 'one commit pending on dev');

  // Dev moves out of band. Nothing about the promote changed, so nothing may bust:
  // the warm refs cache must still answer, exactly as it did before slice 362.
  const movedSha = advanceDev(tmpRoot, 'quiet-path-2.txt', 'more\n', 'slice/3625 more quiet work');
  const second = (await request('/api/branch-state')).body;

  assert.equal(second.github.commits_ahead, 1,
    'the refs are still served from the warm cache — with no run in flight nothing re-reads');
  assert.notEqual(second.github.origin_dev_sha, movedSha.slice(0, 7),
    'the cached (pre-move) dev tip is what was served, proving the TTL still holds for quiet reads');
});
