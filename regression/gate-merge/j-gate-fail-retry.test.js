'use strict';

// J-gate-fail-retry — gate fails on the runner, operator retries after a fix.
// Journey: docs/e2e-journeys/J-gate-fail-retry.md (gate-merge, post-slice-316
// GitHub-CI merge model). Blast radius: if a red gate can move main, the
// entire merge model is void.
//
// Coverage here (per plan):
//  - promote.yml as the protection-path spec artifact: red suite terminates
//    the job before the fast-forward step; retry is always a fresh full run.
//  - /api/promote/dispatch retry semantics against a stub gh: failed previous
//    run does not wedge the button; in-flight run yields 409; gh failure
//    yields 502 with no phantom register event.
//  - Naming meta-guard: failure output must identify the culprit journey/AC.
//
// Out of scope (per plan): the actual red Actions run, deep-link UI rendering,
// ci.yml-green-on-fix observation, RR persistence across fail/retry.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const H = require('./j-gate-fail-retry-helpers');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PROMOTE_YML = path.join(REPO_ROOT, '.github', 'workflows', 'promote.yml');
const REGRESSION_DIR = path.join(REPO_ROOT, 'regression');

let tmpRoot;
let gitState;
let stub;
let server;
let bustGitHubCache;
let port;

before(async () => {
  tmpRoot = H.makeBridgeFixture('j-gate-fail-retry-');
  gitState = H.initGitFixture(tmpRoot);
  stub = H.writeStubGh(tmpRoot);

  // Stub gh shadows any real gh; server git calls ignore user/system config.
  process.env.PATH = stub.binDir + path.delimiter + process.env.PATH;
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_NOSYSTEM = '1';

  ({ server, bustGitHubCache } = H.compileServer(tmpRoot));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ── stub-state helpers ──────────────────────────────────────────────────────

function setPromoteRun(run) {
  fs.writeFileSync(stub.promoteJson, JSON.stringify(run == null ? [] : [run]), 'utf8');
  bustGitHubCache();
}

function promoteRun(status, conclusion, overrides = {}) {
  return {
    status,
    conclusion,
    databaseId: 4242,
    url: 'https://github.com/example/liberation-of-bajor/actions/runs/4242',
    headSha: gitState.devSha,
    ...overrides,
  };
}

function dispatchCallCount() {
  return fs.readFileSync(stub.callsLog, 'utf8')
    .split('\n')
    .filter(line => line.startsWith('workflow run promote.yml')).length;
}

function promoteDispatchedEvents() {
  return fs.readFileSync(path.join(tmpRoot, 'bridge', 'register.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(JSON.parse)
    .filter(ev => ev.event === 'promote-dispatched');
}

// ── promote.yml as spec artifact ────────────────────────────────────────────

function readPromoteSteps() {
  const src = fs.readFileSync(PROMOTE_YML, 'utf8');
  const parts = src.split(/\n\s*steps:\s*\n/);
  assert.equal(parts.length, 2, 'promote.yml has exactly one steps: block');
  const chunks = ('\n' + parts[1])
    .split(/\n(?=\s*-\s+(?:name|uses):)/)
    .map(chunk => chunk.trim())
    .filter(chunk => chunk.startsWith('-'));
  const gateIdx = chunks.findIndex(chunk => /node --test/.test(chunk));
  const pushIdx = chunks.findIndex(chunk => /git push origin .*refs\/heads\/main/.test(chunk));
  return { src, chunks, gateIdx, pushIdx };
}

// Journey steps 3-4 + expected outcome 1: "promote.yml exits red BEFORE the
// fast-forward step" / "a red gate never moves main". The suite step must be
// fail-fast (set -euo pipefail) and the only push of main must live in a
// separate, later step — so a failing suite terminates the job before any
// git push of main can execute.
test('J-gate-fail-retry slice-316-ac-1 — promote.yml runs the suite fail-fast in a step strictly before the only main push step', () => {
  const { src, chunks, gateIdx, pushIdx } = readPromoteSteps();

  assert.notEqual(gateIdx, -1, 'a step running node --test exists');
  assert.notEqual(pushIdx, -1, 'a step pushing refs/heads/main exists');
  assert.notEqual(gateIdx, pushIdx, 'suite and main-push are separate steps');
  assert.ok(gateIdx < pushIdx, 'suite step precedes the main-push step');

  const gate = chunks[gateIdx];
  assert.match(gate, /set -euo pipefail/, 'gate step is fail-fast');
  assert.doesNotMatch(gate, /git push/, 'gate step itself never pushes');

  // The ONLY push of main in the whole workflow is in the later ff step.
  const mainPushes = src.match(/git push[^\n]*main/g) || [];
  assert.equal(mainPushes.length, 1, 'exactly one push of main in promote.yml');
});

// Journey expected outcome: red gate never moves main — no escape hatch may
// let the job continue past a red suite into the push step.
test('J-gate-fail-retry slice-316-ac-2 — promote.yml has no continue-on-error, no always()/failure() condition, and no if: skip on gate or push steps', () => {
  const { src, chunks, gateIdx, pushIdx } = readPromoteSteps();

  assert.doesNotMatch(src, /continue-on-error/, 'no continue-on-error anywhere');
  assert.doesNotMatch(src, /always\(\)/, 'no always() condition');
  assert.doesNotMatch(src, /failure\(\)/, 'no failure() condition');
  assert.doesNotMatch(chunks[gateIdx], /^\s*if:/m, 'suite step is unconditional');
  assert.doesNotMatch(chunks[pushIdx], /^\s*if:/m,
    'push step relies on default success() dependency, not a custom condition');
});

// Journey expected outcome: "The retry is a fresh, full promote.yml run — no
// partial re-run, no state carried over from the failed attempt." Every
// workflow_dispatch runs the identical job: full suite glob, no test caching.
test('J-gate-fail-retry slice-316-ac-3 — retry is a fresh full run: workflow_dispatch trigger, full suite glob, no test caching', () => {
  const { src, chunks, gateIdx } = readPromoteSteps();

  assert.match(src, /\bworkflow_dispatch\s*:/, 'promote.yml is dispatch-triggered');
  assert.match(chunks[gateIdx], /node --test '?regression\/\*\*\/\*\.test\.js'?/,
    'gate runs the FULL regression glob, same suite as ci.yml');
  assert.doesNotMatch(src, /actions\/cache/, 'no cache step can carry state across runs');
});

// ── /api/promote/dispatch retry semantics (Tier 2, stub gh) ────────────────

// Journey steps 9-10: after a failed gate run, pressing the button again must
// dispatch a new promote.yml run — a completed/failure run must not wedge the
// button behind a stale gate_already_running.
test('J-gate-fail-retry slice-316-ac-4 — POST /api/promote/dispatch returns 200 and dispatches again after the previous run completed with failure', async () => {
  setPromoteRun(promoteRun('completed', 'failure'));
  const callsBefore = dispatchCallCount();
  const eventsBefore = promoteDispatchedEvents().length;

  const res = await H.request(port, 'POST', '/api/promote/dispatch');

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(dispatchCallCount(), callsBefore + 1, 'exactly one new gh dispatch');
  assert.equal(promoteDispatchedEvents().length, eventsBefore + 1,
    'promote-dispatched register event appended for the retry');
});

// Journey steps 9-10 (variant): cancelled and timed_out previous runs are
// also terminal failures and must not wedge the retry button.
test('J-gate-fail-retry slice-316-ac-5 — cancelled or timed_out previous runs do not wedge the retry button', async () => {
  for (const conclusion of ['cancelled', 'timed_out']) {
    setPromoteRun(promoteRun('completed', conclusion));
    const callsBefore = dispatchCallCount();

    const res = await H.request(port, 'POST', '/api/promote/dispatch');

    assert.equal(res.status, 200, `200 after previous run ${conclusion}`);
    assert.equal(res.body.ok, true);
    assert.equal(dispatchCallCount(), callsBefore + 1,
      `dispatch goes out after previous run ${conclusion}`);
  }
});

// Journey failure mode: "Re-dispatch while the retry is already running.
// Second press during the in-flight retry returns 409 gate_already_running;
// no duplicate run."
test('J-gate-fail-retry slice-316-ac-6 — second press during in-flight retry returns 409 gate_already_running with no duplicate dispatch', async () => {
  setPromoteRun(promoteRun('in_progress', null));
  const callsBefore = dispatchCallCount();
  const eventsBefore = promoteDispatchedEvents().length;

  const res = await H.request(port, 'POST', '/api/promote/dispatch');

  assert.equal(res.status, 409);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'gate_already_running');
  assert.equal(dispatchCallCount(), callsBefore, 'no duplicate gh dispatch');
  assert.equal(promoteDispatchedEvents().length, eventsBefore,
    'no promote-dispatched event for the rejected press');
});

// Journey failure mode: "Dispatch itself fails on retry (gh/auth). No run is
// created." The button must surface the failure (502 dispatch_failed) and must
// NOT record a phantom promote-dispatched event in the register.
test('J-gate-fail-retry slice-316-ac-7 — gh failure on retry returns 502 dispatch_failed and appends no promote-dispatched register event', async () => {
  setPromoteRun(promoteRun('completed', 'failure'));
  fs.writeFileSync(stub.dispatchFailFlag, '', 'utf8');
  const eventsBefore = promoteDispatchedEvents().length;

  try {
    const res = await H.request(port, 'POST', '/api/promote/dispatch');

    assert.equal(res.status, 502);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, 'dispatch_failed');
    assert.equal(promoteDispatchedEvents().length, eventsBefore,
      'no phantom promote-dispatched event when no run was created');
  } finally {
    fs.rmSync(stub.dispatchFailFlag, { force: true });
    bustGitHubCache();
  }
});

// Journey steps 4-5 + expected outcomes: after the failed run the API still
// reports main's tip unchanged, commits-ahead/RR as they were, and the failed
// promote run with its Actions URL (the deep-link data source) — with no
// local gate state (GATE_FAILED/GATE_RUNNING) anywhere in the payload.
test('J-gate-fail-retry slice-316-ac-8 — after a failed gate /api/branch-state shows unchanged main tip, intact commits-ahead, and the failure with its Actions deep link', async () => {
  setPromoteRun(promoteRun('completed', 'failure'));

  const res = await H.request(port, 'GET', '/api/branch-state');

  assert.equal(res.status, 200);
  const gh = res.body.github;
  assert.ok(gh, 'github overlay present');
  assert.equal(gh.promote_run.status, 'failure', 'failed gate surfaced as failure');
  assert.equal(gh.promote_run.url,
    'https://github.com/example/liberation-of-bajor/actions/runs/4242',
    'Actions run URL preserved as the deep link / audit record');
  assert.equal(gh.origin_main_sha, gitState.mainSha.slice(0, 7),
    'a red gate never moves main: origin/main tip unchanged');
  assert.equal(gh.origin_dev_sha, gitState.devSha.slice(0, 7), 'dev untouched by the gate');
  assert.equal(gh.commits_ahead, 1, 'commits-ahead remains as it was');
  assert.ok(gh.rr && gh.rr.score > 0, 'RR score still reflects the pending work');

  const raw = JSON.stringify(res.body);
  assert.doesNotMatch(raw, /GATE_FAILED/, 'no local GATE_FAILED state');
  assert.doesNotMatch(raw, /GATE_RUNNING/, 'no local gate mutex state');
});

// ── naming meta-guard ───────────────────────────────────────────────────────

// Journey failure mode: "Failure output doesn't identify the culprit. The test
// name lacks the slice-<id>-ac-<index> / J-* tag, so Philipp can't map the
// failure to a journey/AC." Naming is load-bearing for journey step 6 (reading
// the failing Actions output). Per regression/README.md every test name must
// carry a slice-<id>-ac-<index> (or a J-/journey- tag).
test('J-gate-fail-retry slice-316-ac-9 — every regression test name carries a slice-<id>-ac-<index> or J-/journey- tag so failures trace to a journey/AC', () => {
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile() && entry.name.endsWith('.test.js')) files.push(p);
    }
  })(REGRESSION_DIR);
  assert.ok(files.length >= 5, 'sanity: regression suite files were found');

  const nameRe = /\btest(?:\.skip)?\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  const tagged = name =>
    /slice-\d+-ac-\d+/.test(name) ||
    /(?:^|[^\w-])J-[A-Za-z0-9]/.test(name) ||
    /journey-/.test(name);

  let namesSeen = 0;
  const violations = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const match of src.matchAll(nameRe)) {
      namesSeen += 1;
      if (!tagged(match[2])) {
        violations.push(`${path.relative(REPO_ROOT, file)}: ${match[2]}`);
      }
    }
  }
  assert.ok(namesSeen >= 10, 'sanity: test names were extracted');
  assert.deepEqual(violations, [],
    'untagged test names would leave a red gate without a culprit');
});
