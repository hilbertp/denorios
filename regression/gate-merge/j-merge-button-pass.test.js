'use strict';

/**
 * Journey: J-merge-button-pass
 * Category: Gate & Merge
 *
 * What this tests (spec = journey text, not implementation):
 *   Philipp reads the Branch Topology panel (commits ahead, churn, RR score —
 *   step 1), presses RUN GATE & MERGE TO MAIN, the dashboard POSTs
 *   /api/promote/dispatch (step 3), the server dispatches promote.yml via
 *   workflow_dispatch against dev (step 4), the workflow re-runs the FULL
 *   regression suite against the checked-out dev SHA (step 5) and
 *   fast-forwards main to exactly that tested SHA only on green (step 7).
 *   Outcomes pinned: main never receives an untested commit; promotion is
 *   ff-only (no merge commit); nothing auto-promotes (workflow_dispatch only);
 *   commits-ahead/RR return to clean at 0; no local gate machinery involved.
 *   Failure modes pinned: double-press → 409 gate_already_running with no
 *   second dispatch; dispatch failure (gh/auth) → error, no run created,
 *   main/dev untouched; diverged main → ff push refused after green suite,
 *   main untouched. Open-question guard: commits-ahead 0 → 409
 *   nothing_to_promote.
 *
 * Tiers used:
 *   - Static workflow contract: promote.yml triggers/step ordering — the
 *     workflow file IS the journey's named source for "nothing auto-promotes"
 *     and "suite before ff".
 *   - Behavioral: the ff step's `run: |` script is extracted and executed with
 *     bash against a tmp work repo + LOCAL BARE origin (TESTED_SHA provided
 *     via env, standing in for GITHUB_ENV).
 *   - Tier 2: dashboard/server.js compiled against a tmpRoot (REPO_ROOT
 *     rewritten), local bare origin for git, PATH-stubbed `gh` so no call can
 *     ever reach real GitHub (#99992: all state in tmpdirs; a real gh dispatch
 *     of promote.yml from a test is forbidden).
 *
 * Deliberately NOT asserted here (and why):
 *   - The real GitHub Actions run (steps 5-6 executing on a runner), strip
 *     promote-row UI, RR pill rendering, main-dot animation (step 8 visuals):
 *     not headless-testable; the underlying data source (/api/branch-state
 *     github.promote_run + rr) IS asserted.
 *   - Exact RR formula weighting/thresholds and the critical-path file list:
 *     explicitly an open question in the journey — only presence/shape and
 *     clean-vs-non-clean are pinned.
 *   - Dashboard polling latency for run completion: open question.
 *   - Whether the dispatched run pins the dev SHA at dispatch time vs runner
 *     checkout HEAD: open question; what IS pinned (step 5/outcome 1) is that
 *     the suite runs against the same SHA the ff later pushes (TESTED_SHA).
 *
 * Sources: docs/e2e-journeys/J-merge-button-pass.md
 *          .github/workflows/promote.yml (workflow_dispatch, suite, ff push)
 *          .github/workflows/ci.yml (per-push feedback only — not asserted)
 *          docs/adr/ADR-GITHUB-CI-MERGE-MODEL.md (operator-gated amendment)
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');

const { makeTmpDir, removeTmpDir } = require('../helpers/tmp-dir');
const { parseRegisterLines } = require('../helpers/register-helper');
const {
  GIT_ENV, git, initGitFixture, advanceDev, divergeMain,
  installGhStub, setPromoteRuns, setDispatchFail, readDispatches,
  topLevelBlock, parseJobSteps, runBlockOf,
} = require('./j-merge-button-pass-helpers');

const REPO_ROOT_REAL = path.resolve(__dirname, '..', '..');
const PROMOTE_YML    = path.join(REPO_ROOT_REAL, '.github', 'workflows', 'promote.yml');
const SERVER_SRC     = path.join(REPO_ROOT_REAL, 'dashboard', 'server.js');
const FULL_SUITE_CMD = "node --test 'regression/**/*.test.js'";

const promoteSrc = fs.readFileSync(PROMOTE_YML, 'utf8');

// ── shared Tier 2 fixture (server against tmpRoot; #99992: tmpdirs only) ────

let tmpRoot;
let server;
let port;
let bustCache;       // exported _bustGitHubCache — defeats the 30s/60s TTL caches between tests
let stubDir;         // gh stub state dir
let originDir;       // local bare origin inside tmpRoot
let registerPath;
let branchStatePath;
let fixture;         // { mainSha } seed
let devSha = null;   // set once dev advances (sequential top-level tests)

function compileServer(root) {
  const dashboardDir = path.join(root, 'dashboard');
  const lifecyclePath = path.join(root, 'bridge', 'lifecycle-translate.js');
  fs.writeFileSync(lifecyclePath, `
'use strict';
module.exports = {
  translateEvent(ev) { return ev; },
  resetDedupeState() {},
};
`, 'utf8');
  fs.writeFileSync(path.join(dashboardDir, 'lcars-dashboard.html'), '<html></html>', 'utf8');
  fs.writeFileSync(path.join(dashboardDir, 'tokens.css'), '', 'utf8');

  const src = fs.readFileSync(SERVER_SRC, 'utf8')
    .replace(
      /const REPO_ROOT\s*=\s*path\.resolve\(__dirname,\s*'\.\.'\);/,
      `const REPO_ROOT = ${JSON.stringify(root)};`
    )
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

  const mod = new Module('patched-dashboard-server');
  mod.paths = module.paths;
  mod._compile(src, path.join(dashboardDir, 'server.js'));
  return mod.exports;
}

function request(method, urlPath, payload) {
  return new Promise((resolve, reject) => {
    const body = payload == null ? '' : JSON.stringify(payload);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {},
    }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
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

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j-merge-button-'));
  registerPath    = path.join(tmpRoot, 'bridge', 'register.jsonl');
  branchStatePath = path.join(tmpRoot, 'bridge', 'state', 'branch-state.json');

  for (const dir of [
    path.join(tmpRoot, 'bridge', 'queue'),
    path.join(tmpRoot, 'bridge', 'staged'),
    path.join(tmpRoot, 'bridge', 'trash'),
    path.join(tmpRoot, 'bridge', 'control'),
    path.join(tmpRoot, 'bridge', 'errors'),
    path.join(tmpRoot, 'bridge', 'state'),
    path.join(tmpRoot, 'dashboard'),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(registerPath, '', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'heartbeat.json'), JSON.stringify({ current_slice: null }), 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'queue-order.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'staged-order.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'sessions.jsonl'), '', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'first-output.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'nog-active.json'), '{}', 'utf8');
  fs.writeFileSync(branchStatePath, '{}', 'utf8');

  // gh stub MUST be on PATH before the server is compiled so its
  // execFileSync('gh', ...) can never hit real GitHub.
  const binDir = path.join(tmpRoot, 'bin');
  stubDir = path.join(tmpRoot, 'gh-stub');
  installGhStub(binDir, stubDir);
  process.env.PATH = binDir + path.delimiter + process.env.PATH;
  // Isolate the server's own git invocations from machine/user git config.
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_SYSTEM = '/dev/null';

  // tmpRoot itself is the work repo (the server runs git with cwd REPO_ROOT);
  // origin is a local bare repo inside tmpRoot — offline by construction.
  originDir = path.join(tmpRoot, 'origin.git');
  fixture = initGitFixture({ workDir: tmpRoot, originDir });

  const exported = compileServer(tmpRoot);
  server = exported.server;
  bustCache = exported._bustGitHubCache;
  assert.equal(typeof bustCache, 'function', 'server must export _bustGitHubCache for TTL-cache control');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// Part A — promote.yml static contract (the workflow file is the journey's
// named source for "nothing auto-promotes" and "suite gates the ff push")
// ═════════════════════════════════════════════════════════════════════════════

test('J-merge-button-pass slice-316-ac-1 — promote.yml is workflow_dispatch-only: no push/schedule/workflow_run trigger, nothing auto-promotes', () => {
  const onBlock = topLevelBlock(promoteSrc, 'on');
  assert.ok(onBlock, 'promote.yml must have a top-level on: block');
  assert.match(onBlock, /workflow_dispatch/,
    'promotion must be operator-dispatched (workflow_dispatch)');
  // ADR amendment: nothing auto-promotes — no event-driven trigger of any kind.
  assert.doesNotMatch(onBlock, /\b(push|schedule|workflow_run|pull_request|merge_group)\b/,
    `promote.yml on: block must contain no automatic trigger — got:\n${onBlock}`);
});

test('J-merge-button-pass slice-316-ac-2 — gate step pins TESTED_SHA from checked-out dev HEAD and runs the full suite before the ff step in the same job', () => {
  const steps = parseJobSteps(promoteSrc);
  assert.ok(steps.length >= 2, 'promote.yml must define job steps');

  // Single job ⇒ suite and ff cannot be split across jobs/runners.
  const runsOnCount = (promoteSrc.match(/runs-on:/g) || []).length;
  assert.equal(runsOnCount, 1, 'gate and promote must live in one job (one runs-on)');

  // Step: checkout dev (journey step 5 — "checks out dev").
  const checkout = steps.find(s => s.includes('actions/checkout'));
  assert.ok(checkout, 'must check out the repo');
  assert.match(checkout, /ref:\s*dev/, 'checkout must target dev');

  // Gate step: full suite + TESTED_SHA pinned from the checked-out HEAD.
  const gateIdx = steps.findIndex(s => (runBlockOf(s) || '').includes('node --test'));
  assert.ok(gateIdx !== -1, 'a step must run the regression suite');
  const gateRun = runBlockOf(steps[gateIdx]);
  assert.ok(gateRun.includes(FULL_SUITE_CMD),
    `gate must run the FULL suite (${FULL_SUITE_CMD}) — got:\n${gateRun}`);
  assert.match(gateRun, /TESTED_SHA="?\$\(git rev-parse HEAD\)"?/,
    'TESTED_SHA must be pinned from the checked-out dev HEAD');
  assert.ok(gateRun.indexOf('git rev-parse HEAD') < gateRun.indexOf('node --test'),
    'the SHA must be pinned BEFORE the suite runs (the tested SHA is the promoted SHA)');

  // ff step comes after the gate step (suite green gates the push — outcome 1).
  const ffIdx = steps.findIndex(s => (runBlockOf(s) || '').includes('merge-base --is-ancestor'));
  assert.ok(ffIdx !== -1, 'a step must guard the push with merge-base --is-ancestor');
  assert.ok(gateIdx < ffIdx, 'the regression suite step must precede the fast-forward step');

  const ffRun = runBlockOf(steps[ffIdx]);
  // Outcome 1: main receives exactly the tested SHA — not a re-resolved dev HEAD.
  assert.ok(ffRun.includes('$TESTED_SHA:refs/heads/main'),
    `ff push must push $TESTED_SHA (the tested commit) to refs/heads/main — got:\n${ffRun}`);
  // Failure mode "Main has diverged": guard precedes the push; divergence exits 1.
  assert.ok(ffRun.indexOf('merge-base --is-ancestor') < ffRun.indexOf('git push'),
    'ff-ancestry guard must run before the push');
  assert.match(ffRun, /exit 1/, 'divergence must fail the job (exit 1)');
});

// ═════════════════════════════════════════════════════════════════════════════
// Part B — ff step behavioral: execute promote.yml's own ff script against a
// tmp work repo + local bare origin (TESTED_SHA via env, as GITHUB_ENV would)
// ═════════════════════════════════════════════════════════════════════════════

function ffScript() {
  const steps = parseJobSteps(promoteSrc);
  const ffStep = steps.find(s => (runBlockOf(s) || '').includes('merge-base --is-ancestor'));
  assert.ok(ffStep, 'promote.yml must contain the ff step');
  return runBlockOf(ffStep);
}

function runFfScript(workDir, testedSha) {
  return spawnSync('bash', ['-c', ffScript()], {
    cwd: workDir,
    encoding: 'utf8',
    env: { ...process.env, ...GIT_ENV, TESTED_SHA: testedSha },
    timeout: 15000,
  });
}

test('J-merge-button-pass slice-316-ac-3 — green path: ff step advances origin/main to exactly the tested dev SHA with no merge commit', () => {
  const tmp = makeTmpDir('j-merge-ff-green');
  try {
    const work = path.join(tmp, 'work');
    const origin = path.join(tmp, 'origin.git');
    const { mainSha } = initGitFixture({ workDir: work, originDir: origin });
    const tested = advanceDev(work, 'src/slice-316-fixture.js',
      '// fixture change promoted by the gate\n', 'slice/316: fixture change on dev');

    const res = runFfScript(work, tested);
    assert.equal(res.status, 0, `ff script must succeed on green+ancestor — stderr:\n${res.stderr}`);

    // Outcome 1: origin/main tip equals the SHA the suite ran against.
    assert.equal(git(['rev-parse', 'main'], origin), tested,
      'origin/main must equal the tested dev SHA — main never receives an untested commit');
    // Outcome 2: fast-forward — no merge commit, old main is an ancestor.
    assert.equal(git(['rev-list', '--merges', 'main'], origin), '',
      'promotion must not create a merge commit');
    git(['merge-base', '--is-ancestor', mainSha, 'main'], origin); // throws if not ff lineage
  } finally {
    removeTmpDir(tmp);
  }
});

test('J-merge-button-pass slice-316-ac-7 — diverged main: ff step exits non-zero after a green suite and leaves origin/main untouched', () => {
  const tmp = makeTmpDir('j-merge-ff-diverged');
  try {
    const work = path.join(tmp, 'work');
    const origin = path.join(tmp, 'origin.git');
    initGitFixture({ workDir: work, originDir: origin });
    const tested = advanceDev(work, 'src/slice-316-fixture.js',
      '// dev work\n', 'slice/316: fixture change on dev');
    const divergent = divergeMain(work, 'hotfix.md',
      'out-of-band push to main\n', 'someone pushed to main outside the gate');

    const res = runFfScript(work, tested);
    assert.notEqual(res.status, 0,
      'ff script must fail when the tested SHA is not a fast-forward of main');
    assert.equal(git(['rev-parse', 'main'], origin), divergent,
      'origin/main must be untouched after a refused non-ff promotion');
    assert.equal(git(['rev-parse', 'dev'], origin), tested,
      'origin/dev must be untouched too');
  } finally {
    removeTmpDir(tmp);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// Part C — Tier 2: /api/promote/dispatch + /api/branch-state on the compiled
// server (local bare origin, PATH-stubbed gh). Tests are order-dependent and
// run sequentially: baseline (dev == main) first, then dev advances.
// ═════════════════════════════════════════════════════════════════════════════

test('J-merge-button-pass slice-316-ac-8 — branch-state baseline: commits-ahead 0 and RR clean when origin/dev == origin/main', async () => {
  bustCache();
  const res = await request('GET', '/api/branch-state');
  assert.equal(res.status, 200);
  const gh = res.body.github;
  assert.ok(gh, '/api/branch-state must carry a github section');
  assert.equal(gh.error, null, `github state must be readable offline — got error: ${gh.error}`);
  assert.equal(gh.commits_ahead, 0, 'zero commits ahead when dev == main');
  assert.equal(gh.rr.level, 'clean', 'RR returns to clean/baseline at zero commits ahead');
  assert.equal(gh.rr.score, 0, 'clean baseline RR score is 0');
  assert.equal(gh.origin_dev_sha, gh.origin_main_sha, 'dev and main tips coincide at baseline');
});

test('J-merge-button-pass slice-316-ac-9 — POST /api/promote/dispatch with nothing to promote returns 409 nothing_to_promote and dispatches nothing', async () => {
  bustCache();
  const res = await request('POST', '/api/promote/dispatch');
  assert.equal(res.status, 409, 'the gate cannot run with nothing to promote');
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'nothing_to_promote');
  assert.equal(readDispatches(stubDir).length, 0, 'no workflow run may be created');
});

test('J-merge-button-pass slice-316-ac-4 — branch-state reports commits-ahead, churn and a non-clean RR score once dev is ahead', async () => {
  devSha = advanceDev(tmpRoot, 'src/promote-fixture.js',
    Array.from({ length: 12 }, (_, i) => `// fixture line ${i + 1}`).join('\n') + '\n',
    'slice/316: promote fixture change');
  bustCache();

  const res = await request('GET', '/api/branch-state');
  assert.equal(res.status, 200);
  const gh = res.body.github;
  assert.equal(gh.error, null, `github state must be readable — got error: ${gh.error}`);
  assert.equal(gh.commits_ahead, 1, 'one slice landed on dev');
  assert.equal(gh.origin_dev_sha, devSha.slice(0, 7), 'dev tip reflects the pushed commit');
  // Step 1: panel inputs — RR score from commits ahead, churn, critical-path files.
  // (Formula weighting + critical-path list are open questions — shape only.)
  assert.equal(gh.rr.commits, 1, 'RR input: commits ahead');
  assert.ok(gh.rr.churn > 0, 'RR input: churn from the dev diff');
  assert.ok(Array.isArray(gh.rr.critical_files), 'RR input: critical-path files touched');
  assert.ok(gh.rr.score > 0, 'RR score is non-zero with work pending');
  assert.notEqual(gh.rr.level, 'clean', 'RR level leaves clean once dev is ahead');
  // Topology overlay the panel renders from:
  assert.equal(res.body.dev.commits_ahead_of_main, 1);
  assert.equal(res.body.dev.tip_sha, devSha.slice(0, 7));
});

test('J-merge-button-pass slice-316-ac-5 — POST /api/promote/dispatch dispatches promote.yml against dev, returns ok, and records a promote-dispatched register event with dev tip sha and commits_ahead', async () => {
  setPromoteRuns(stubDir, []); // no run in flight
  bustCache();

  const res = await request('POST', '/api/promote/dispatch');
  assert.equal(res.status, 200, `dispatch must succeed — got ${JSON.stringify(res.body)}`);
  assert.equal(res.body.ok, true);

  // Step 4: the server dispatched promote.yml via workflow_dispatch against dev.
  const dispatches = readDispatches(stubDir);
  assert.equal(dispatches.length, 1, 'exactly one workflow run dispatched');
  assert.match(dispatches[0], /workflow run promote\.yml/,
    'dispatch must target promote.yml');
  assert.match(dispatches[0], /--ref dev/, 'dispatch must run against dev');

  // Audit trail: promote-dispatched register event carries dev tip + commits_ahead.
  const events = parseRegisterLines(registerPath);
  const ev = events.find(e => e.event === 'promote-dispatched');
  assert.ok(ev, `register must contain promote-dispatched — got: [${events.map(e => e.event).join(', ')}]`);
  assert.equal(ev.dev_tip_sha, devSha.slice(0, 7), 'event carries the dev tip being promoted');
  assert.equal(ev.commits_ahead, 1, 'event carries commits_ahead at dispatch time');
});

test('J-merge-button-pass slice-316-ac-6 — the in-flight promote run reference (status, run id, deep link) is exposed via /api/branch-state', async () => {
  setPromoteRuns(stubDir, [{
    status: 'in_progress', conclusion: null, databaseId: 31616,
    url: 'https://github.example/actions/runs/31616', headSha: devSha,
  }]);
  bustCache();

  const res = await request('GET', '/api/branch-state');
  assert.equal(res.status, 200);
  const run = res.body.github.promote_run;
  assert.ok(run, 'branch-state must expose the promote run');
  assert.equal(run.status, 'in_progress', 'strip promote row data source shows running state');
  assert.equal(run.run_id, 31616, 'run reference (id) is surfaced');
  assert.equal(run.url, 'https://github.example/actions/runs/31616', 'deep link to the Actions run');
  assert.equal(run.head_sha7, devSha.slice(0, 7), 'run is tied to the dev SHA under test');
});

test('J-merge-button-pass slice-316-ac-10 — double-press while the gate is in flight returns 409 gate_already_running and does not dispatch a second run', async () => {
  // stub still reports the in_progress run from the previous test
  bustCache();
  const res = await request('POST', '/api/promote/dispatch');
  assert.equal(res.status, 409);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'gate_already_running');
  assert.equal(readDispatches(stubDir).length, 1,
    'the in-flight run is the only one — no second dispatch');
});

test('J-merge-button-pass slice-316-ac-11 — dispatch failure (gh/auth) errors without creating a run; origin main and dev are untouched', async () => {
  setPromoteRuns(stubDir, [{
    status: 'completed', conclusion: 'success', databaseId: 31616,
    url: 'https://github.example/actions/runs/31616', headSha: devSha,
  }]); // prior gate finished — button retry path
  setDispatchFail(stubDir, true);
  bustCache();
  try {
    const res = await request('POST', '/api/promote/dispatch');
    assert.ok(res.status >= 400, `dispatch failure must surface as an error — got ${res.status}`);
    assert.equal(res.body.ok, false);
    assert.equal(readDispatches(stubDir).length, 1, 'no workflow run created on failed dispatch');
    // main and dev untouched:
    assert.equal(git(['rev-parse', 'dev'], originDir), devSha);
    assert.equal(git(['rev-parse', 'main'], originDir), fixture.mainSha);
  } finally {
    setDispatchFail(stubDir, false);
  }
});

test('J-merge-button-pass slice-316-ac-12 — no local gate machinery: dispatch leaves no gate-running.json mutex and no GATE_RUNNING in branch-state.json', () => {
  assert.equal(fs.existsSync(path.join(tmpRoot, 'bridge', 'state', 'gate-running.json')), false,
    'retired local gate mutex must not appear');
  assert.equal(fs.existsSync(path.join(tmpRoot, 'bridge', 'gate-running.json')), false,
    'retired local gate mutex must not appear');
  const branchState = fs.readFileSync(branchStatePath, 'utf8');
  assert.doesNotMatch(branchState, /GATE_RUNNING/,
    'the dispatch flow must not write a GATE_RUNNING transition');
  assert.equal(branchState.trim(), '{}',
    'branch-state.json is untouched by the GitHub-dispatch promotion flow');
});
