'use strict';

// J-red-dev-fix-request — slice 388: no agent runs the full safety-net suite any more.
//
// GitHub already ran that suite on every push to dev and nothing acted on the result:
// the report went into an artifact, a pill went red, and the only route into Alex's inbox
// was a LOCAL gate press. So the suite kept being re-run by hand to learn what a finished
// run already knew — six times in one builder session on slice 383, 4.9 of 16.3 minutes,
// four of those repeats spent hunting skipped-test names for one sentence of a report.
//
// Two halves are guarded here. The template half takes the suite off the builder in words
// a brief cannot override. The routing half gives that up nothing: when the newest
// completed ci.yml run on dev is red, the dashboard files one fix request per commit into
// Alex's inbox and records DEV_SUITE_RED.
//
// Everything about the routing is exercised through the injected seams — a fake run, a
// fake download, a temp state file, a temp inbox and a collecting emitter — so no test
// here needs `gh`, touches the live register, or writes into the real inbox (#99992).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { buildDoneTemplate } = require('../../bridge/orchestrator');
const { routeDevSuiteRun, withDevSuiteFixRequest, readDevSuiteState } = require('../../dashboard/server');

const REPO_ROOT  = path.resolve(__dirname, '..', '..');
const SERVER     = path.join(REPO_ROOT, 'dashboard', 'server.js');
const REPORT_JS  = path.join(REPO_ROOT, 'scripts', 'regression-report.js');
const SERVER_SRC = fs.readFileSync(SERVER, 'utf8');
const REPORT_SRC = fs.readFileSync(REPORT_JS, 'utf8');
const HTML_SRC   = fs.readFileSync(path.join(REPO_ROOT, 'dashboard', 'lcars-dashboard.html'), 'utf8');

// scripts/regression-report.js is NOT required at the top of this file, and no test may
// require it — directly or through routeDevSuiteRun — without calling this first.
//
// An unguarded copy of that module runs a suite and then process.exit(0)s *inside this
// runner*. node --test scores a file whose process exited 0 before reporting as ONE
// PASSING TEST, so an in-process load would turn "the guard was removed" into a green
// file: a safety net that goes quiet exactly when it is needed. Assert the guard from the
// source first and every such test fails loudly instead. Trap 4's child process is what
// actually proves the guard works; this only keeps the rest of the file legible.
function requireGuardIntact() {
  assert.match(REPORT_SRC, /if \(require\.main === module\) main\(\);/,
    'scripts/regression-report.js must guard its entry point before anything requires it — '
    + 'an unguarded main() would run a suite and kill this test process');
}

const loadReporter = () => { requireGuardIntact(); return require('../../scripts/regression-report'); };

// ── Fixtures ────────────────────────────────────────────────────────────────

const cleanups = [];
process.on('exit', () => { for (const d of cleanups) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

/** A throwaway state file + inbox + event sink, with a download call counter. */
function makeSink(log) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-suite-'));
  cleanups.push(dir);
  const sink = {
    stateFile: path.join(dir, 'state', 'dev-suite.json'),
    inboxDir: path.join(dir, 'inbox'),
    events: [],
    downloads: 0,
    writeRegisterEvent(e) { sink.events.push(e); },
    downloadArtifact() { sink.downloads += 1; return log === undefined ? SUITE_LOG : log; },
    inbox() { try { return fs.readdirSync(sink.inboxDir).sort(); } catch (_) { return []; } },
    eventsNamed(name) { return sink.events.filter(e => e.event === name); },
  };
  return sink;
}

const SHA_RED   = 'aaaaaaa111111111111111111111111111111111';
const SHA_GREEN = 'bbbbbbb222222222222222222222222222222222';

const completedRun = (conclusion, sha, extra) => ({
  status: 'completed', conclusion, head_sha: sha,
  run_id: 4711, url: 'https://github.test/denorios/actions/runs/4711', ...extra,
});

// Raw `node --test` spec output, the shape the artifact now carries. The failing names
// are deliberately untagged: a real slice-<id>-ac-<n> tag written into this file would be
// read by the lock derivers as a criterion THIS file guards.
const SUITE_LOG = [
  '✔ J-something — a check that passed (2.1ms)',
  '✖ J-fixture-red — the first check that broke (3.4ms)',
  "  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal",
  '    at TestContext.<anonymous> (/repo/regression/fixture/a.test.js:9:10)',
  '✖ J-fixture-red — the second check that broke (1.0ms)',
  '  AssertionError [ERR_ASSERTION]: nope',
  'ℹ tests 3',
  'ℹ pass 1',
  'ℹ fail 2',
  'ℹ duration_ms 812.5',
].join('\n');

const FIX_FILE_RED = 'REGRESSION-FAILURE-dev-aaaaaaa.md';

// ───────────────────────────────────────────────────────────────────────────
// Acceptance criteria
// ───────────────────────────────────────────────────────────────────────────

// @ac-hash: slice-388-ac-1 sha256:20fd87192e8a06128b4abed94bbf758cb9f3079b55e4e4420c9a7f361ecc1532
test('J-red-dev-fix-request slice-388-ac-1 — the template glued to every brief tells the builder, in at most four lines under "What you run", to run only his own test file and never the full safety-net suite or the browser suite', () => {
  const tpl = buildDoneTemplate({
    id: '388',
    worktreeDonePath: '/tmp/ds9-worktrees/388/bridge/queue/388-DONE.md',
    sliceBranch: 'slice/388',
    sliceContent: '# a brief\n\n## Acceptance criteria\n\n- slice-388-ac-1: a criterion\n',
  });

  assert.match(tpl, /^## What you run$/m, 'the heading is what a brief cannot talk him out of');

  // The section is everything between the heading and the next one.
  const after = tpl.split(/^## What you run$/m)[1];
  assert.ok(after, 'the heading has a section under it');
  const section = after.split(/^## /m)[0];
  const items = section.split('\n').map(l => l.trim()).filter(l => l.startsWith('- '));

  assert.ok(items.length >= 1, 'a heading over an empty section reads as a missing list');
  assert.ok(items.length <= 4, `at most four lines, got ${items.length} — a wall of rules is a rule nobody reads`);

  const body = items.join('\n');
  assert.match(body, /Run only the test file you wrote/, 'what he DOES run, stated first');
  assert.match(body, /Never run the full safety-net suite/, 'the full suite is off him');
  assert.match(body, /npm test/, 'named the way he would type it');
  assert.match(body, /node --test regression/, 'and the way the brief would tempt him to type it');
  assert.match(body, /never the browser suite/, 'the browser suite is Julian\'s');
  assert.match(body, /GitHub runs the safety-net suite/, 'because a machine already runs it');
  assert.match(body, /fix request/, 'and a red run reaches Alex without him');
  assert.match(body, /no suite section/, 'so there is nothing left to chase numbers for');
});

// @ac-hash: slice-388-ac-2 sha256:ef9fab7649933dbc1eadf4f2c4a66b89187a0a62362d09d30d62e33842dad348
test('J-red-dev-fix-request slice-388-ac-2 — a red run on dev leaves exactly one fix request named for that commit and exactly one DEV_SUITE_RED, however many times the dashboard polls', () => {
  requireGuardIntact();  // routeDevSuiteRun loads the reporter on the red path
  const sink = makeSink();
  const run = completedRun('failure', SHA_RED);

  const first = routeDevSuiteRun({ run, ...sink });
  assert.deepEqual(first, { colour: 'red', sha7: 'aaaaaaa', file: FIX_FILE_RED });

  // Five more polls of the same run — a dashboard left open for five minutes.
  for (let i = 0; i < 5; i++) assert.equal(routeDevSuiteRun({ run, ...sink }), null, 'a re-poll routes nothing');

  assert.deepEqual(sink.inbox(), [FIX_FILE_RED], 'one request, named for the commit');
  assert.equal(sink.eventsNamed('DEV_SUITE_RED').length, 1, 'one event');

  const ev = sink.eventsNamed('DEV_SUITE_RED')[0];
  assert.equal(ev.sha, SHA_RED);
  assert.equal(ev.run_id, 4711);
  assert.equal(ev.url, run.url);
  assert.deepEqual(ev.failing,
    ['J-fixture-red — the first check that broke', 'J-fixture-red — the second check that broke'],
    'the event names the checks, so the register answers "what broke" without a download');
  assert.equal(ev.ts, undefined, 'the timestamp is writeRegisterEvent\'s to stamp, not this function\'s');

  // The request itself must be readable by a person who is nowhere near the failure.
  const body = fs.readFileSync(path.join(sink.inboxDir, FIX_FILE_RED), 'utf8');
  assert.match(body, /\*\*Commit:\*\* `aaaaaaa` on dev/, 'it names the commit');
  assert.match(body, /actions\/runs\/4711/, 'and the run');
  assert.match(body, /the first check that broke/, 'and what failed');
  assert.match(body, /Alex removes this file when the fix slice is queued; a later green does not clear it/,
    'and who clears it — a file that auto-clears on green is a fix request that disappears unfixed');
});

// @ac-hash: slice-388-ac-3 sha256:0e189ca08f74f69f7923a0835469d56b12fa2572dbc9f7883b2fe3970e1b9287
test('J-red-dev-fix-request slice-388-ac-3 — a later green on a newer commit appends exactly one DEV_SUITE_GREEN however many times the dashboard polls, and leaves the fix request in place', () => {
  requireGuardIntact();  // routeDevSuiteRun loads the reporter on the red path
  const sink = makeSink();
  routeDevSuiteRun({ run: completedRun('failure', SHA_RED), ...sink });
  assert.deepEqual(sink.inbox(), [FIX_FILE_RED], 'precondition: the red filed its request');

  const green = completedRun('success', SHA_GREEN, { run_id: 4712 });
  const routed = routeDevSuiteRun({ run: green, ...sink });
  assert.equal(routed.colour, 'green');

  for (let i = 0; i < 5; i++) assert.equal(routeDevSuiteRun({ run: green, ...sink }), null, 'a re-poll appends nothing');

  const greens = sink.eventsNamed('DEV_SUITE_GREEN');
  assert.equal(greens.length, 1, 'one event, not one a minute for as long as dev stays green');
  assert.equal(greens[0].sha, SHA_GREEN);
  assert.equal(greens[0].run_id, 4712);

  assert.deepEqual(sink.inbox(), [FIX_FILE_RED],
    'the request survives the green: the commit that broke is still broken until a fix slice is queued');
  assert.equal(sink.eventsNamed('DEV_SUITE_RED').length, 1, 'and the green did not re-route the red');
});

// @ac-hash: slice-388-ac-4 sha256:3c018e7ce2c9fbb8d06fe87eda5704dca725f0e290c4e5eb891b9030bfdb680d
test('J-red-dev-fix-request slice-388-ac-4 — once a request is filed the ci object carries fix_request with the sha7 and the file name, and it is null for a red run without a request and for a green run', () => {
  requireGuardIntact();  // routeDevSuiteRun loads the reporter on the red path
  const sink = makeSink();
  const rawCi = { state: 'failing', status: 'completed', conclusion: 'failure', run_number: 9, url: 'u' };

  // Nothing routed yet.
  assert.equal(withDevSuiteFixRequest(rawCi, sink.stateFile).fix_request, null,
    'no request on a state file that has never been written');

  routeDevSuiteRun({ run: completedRun('failure', SHA_RED), ...sink });
  const filed = withDevSuiteFixRequest(rawCi, sink.stateFile);
  assert.deepEqual(filed.fix_request, { sha7: 'aaaaaaa', file: FIX_FILE_RED },
    'the panel gets the commit and the file name, not a colour it has to guess from');
  assert.equal(filed.state, 'failing', 'and everything the panel already read is untouched');
  assert.equal(filed.run_number, 9);

  // A CANCELLED run: _getGhCi folds it into state 'failing', and it files nothing.
  const cancelled = makeSink();
  assert.equal(routeDevSuiteRun({ run: completedRun('cancelled', SHA_RED), ...cancelled }), null,
    'a cancelled run is not a regression');
  assert.deepEqual(cancelled.inbox(), [], 'so no request');
  assert.deepEqual(cancelled.events, [], 'and no event');
  assert.equal(withDevSuiteFixRequest({ state: 'failing' }, cancelled.stateFile).fix_request, null,
    'red-without-a-request must read null, or the panel points at a file that is not there');

  // A green run clears the pointer (the file stays — ac-3).
  routeDevSuiteRun({ run: completedRun('success', SHA_GREEN, { run_id: 4712 }), ...sink });
  assert.equal(withDevSuiteFixRequest(rawCi, sink.stateFile).fix_request, null, 'green carries no request');

  // And the panel renders from that object, never from the colour alone.
  assert.match(HTML_SRC, /ci && ci\.fix_request \? ci\.fix_request : null/,
    'the CI line of the pipeline strip reads fix_request');
  assert.match(HTML_SRC, /data-ci-fix-request="\$\{fr\.sha7\}"/, 'under the declared stable attribute');
  assert.match(HTML_SRC, /fix request in Alex's inbox/, 'and says where the request went');
});

// @ac-hash: slice-388-ac-5 sha256:49542b434b4aa376a09f984d7a4566d1ac33624fb26b071b8aad712f46b92941
test('J-red-dev-fix-request slice-388-ac-5 — with gh unavailable the panel behaves exactly as today and no file or event is written', () => {
  const sink = makeSink();

  // gh missing/unauthenticated: the poll swallows it and yields null.
  assert.equal(withDevSuiteFixRequest(null, sink.stateFile), null,
    'a null ci stays null — the panel must not start seeing an object where it saw nothing');
  assert.equal(withDevSuiteFixRequest(undefined, sink.stateFile), undefined);

  assert.equal(routeDevSuiteRun({ run: null, ...sink }), null);
  assert.equal(routeDevSuiteRun({ ...sink }), null, 'and with no run at all');
  // A run that has not finished is not a verdict either.
  assert.equal(routeDevSuiteRun({ run: { status: 'in_progress', head_sha: SHA_RED }, ...sink }), null);
  assert.equal(routeDevSuiteRun({ run: completedRun('failure', '') , ...sink }), null, 'nor one with no commit');

  assert.deepEqual(sink.inbox(), [], 'no file');
  assert.deepEqual(sink.events, [], 'no event');
  assert.equal(fs.existsSync(sink.stateFile), false, 'and no state file: nothing happened, so nothing is recorded');
  assert.equal(sink.downloads, 0, 'and nothing was downloaded');
});

// ───────────────────────────────────────────────────────────────────────────
// Traps
// ───────────────────────────────────────────────────────────────────────────

// Trap 1 — once per sha, never once per poll, for BOTH colours. _getGhCi runs on every
// dashboard request behind a 60-second cache and now on a timer too, so "once" has to be
// anchored to the commit, not to the call.
test('J-red-dev-fix-request — trap 1: the state file records the last routed sha with its verdict, so red→green→red across many polls writes one file and one event each', () => {
  requireGuardIntact();  // routeDevSuiteRun loads the reporter on the red path
  const sink = makeSink();
  const red = completedRun('failure', SHA_RED);
  const green = completedRun('success', SHA_GREEN, { run_id: 4712 });
  const SHA_RED2 = 'ccccccc333333333333333333333333333333333';
  const red2 = completedRun('failure', SHA_RED2, { run_id: 4713 });

  for (const run of [red, red, green, green, green, red2, red2]) routeDevSuiteRun({ run, ...sink });

  assert.equal(sink.eventsNamed('DEV_SUITE_RED').length, 2, 'one per red commit');
  assert.equal(sink.eventsNamed('DEV_SUITE_GREEN').length, 1, 'one per green commit');
  assert.deepEqual(sink.inbox(), ['REGRESSION-FAILURE-dev-aaaaaaa.md', 'REGRESSION-FAILURE-dev-ccccccc.md'],
    'one request per red commit — the per-sha name is what keeps the second from overwriting the first');

  const st = readDevSuiteState(sink.stateFile);
  assert.equal(st.last_sha, SHA_RED2, 'the ledger holds the last routed sha');
  assert.equal(st.last_state, 'failing', 'and its verdict, so a colour change is distinguishable from a re-poll');

  // Going BACK to a sha already routed must still route nothing (the ledger holds one
  // sha, so this documents the boundary rather than pretending to a full history).
  const before = sink.events.length;
  routeDevSuiteRun({ run: red2, ...sink });
  assert.equal(sink.events.length, before, 'the newest run re-polled is still one event');
});

// Trap 2 — gh may be absent or unauthenticated; the poll already swallows that. The new
// step has to fail the same quiet way and never break the panel.
test('J-red-dev-fix-request — trap 2: a download that throws or comes back empty still files the request with the run URL, and nothing propagates', () => {
  requireGuardIntact();  // routeDevSuiteRun loads the reporter on the red path
  const thrower = makeSink();
  thrower.downloadArtifact = () => { thrower.downloads += 1; throw new Error('gh: command not found'); };
  const routed = routeDevSuiteRun({ run: completedRun('failure', SHA_RED), ...thrower });
  assert.deepEqual(routed, { colour: 'red', sha7: 'aaaaaaa', file: FIX_FILE_RED },
    'the request goes out anyway: "open the run" beats no request at all');

  const body = fs.readFileSync(path.join(thrower.inboxDir, FIX_FILE_RED), 'utf8');
  assert.match(body, /artifact unavailable; open the run/, 'it says why there is no list');
  assert.match(body, /actions\/runs\/4711/, 'and where to look instead');
  assert.deepEqual(thrower.eventsNamed('DEV_SUITE_RED')[0].failing, [],
    'and the event claims no failures it could not read');

  // An artifact from before this slice carries LAST-RUN.md and no raw log.
  const empty = makeSink(null);
  routeDevSuiteRun({ run: completedRun('failure', SHA_RED), ...empty });
  assert.match(fs.readFileSync(path.join(empty.inboxDir, FIX_FILE_RED), 'utf8'), /artifact unavailable/);

  // Red, log readable, zero failures in THIS suite: another job in the run broke.
  const other = makeSink('ℹ tests 412\nℹ pass 412\nℹ fail 0\n');
  routeDevSuiteRun({ run: completedRun('failure', SHA_RED), ...other });
  const otherBody = fs.readFileSync(path.join(other.inboxDir, FIX_FILE_RED), 'utf8');
  assert.match(otherBody, /another job in this run failed; open the run/,
    'an empty failure list under a red run is a lie about a green suite');
  assert.doesNotMatch(otherBody, /artifact unavailable/, 'and it is not the no-artifact message');

  // An unwritable inbox must not take the panel or the event down with it.
  const blocked = makeSink();
  blocked.inboxDir = path.join(blocked.inboxDir, 'not-a-dir');
  fs.mkdirSync(path.dirname(blocked.inboxDir), { recursive: true });
  fs.writeFileSync(blocked.inboxDir, 'I am a file, not a directory');
  const still = routeDevSuiteRun({ run: completedRun('failure', SHA_RED), ...blocked });
  assert.equal(still.colour, 'red');
  assert.equal(still.file, null, 'it does not claim a file it failed to write');
  assert.equal(blocked.eventsNamed('DEV_SUITE_RED').length, 1, 'the event still lands');
  assert.equal(withDevSuiteFixRequest({ state: 'failing' }, blocked.stateFile).fix_request, null,
    'and the panel is not pointed at a file that is not there');
});

// Trap 3 — the download takes seconds. It runs once per sha, off the state file
// afterwards, never on every request, and never inside a request.
test('J-red-dev-fix-request — trap 3: the artifact is downloaded once per sha however many polls, never for a green run, and the routing is called off the poll rather than inside a request', () => {
  requireGuardIntact();  // routeDevSuiteRun loads the reporter on the red path
  const sink = makeSink();
  const run = completedRun('failure', SHA_RED);
  for (let i = 0; i < 6; i++) routeDevSuiteRun({ run, ...sink });
  assert.equal(sink.downloads, 1, 'six polls, one download — this is the seconds-long step');

  routeDevSuiteRun({ run: completedRun('success', SHA_GREEN, { run_id: 4712 }), ...sink });
  assert.equal(sink.downloads, 1, 'a green run has nothing to parse');

  // The request path must return before the download starts, and the timer must be the
  // server's, not the module's.
  assert.match(SERVER_SRC, /if \(_devSuiteArmed\) setImmediate\(\(\) => \{ try \{ routeDevSuiteRun\(\{ run: result \}\); \} catch \(_\) \{\} \}\);/,
    'the routing is scheduled after the poll is cached, not run inside the request that polled');
  assert.match(SERVER_SRC, /_devSuiteTimer = setInterval\(tick, GH_TTL_MS\);/,
    'and a red is routed within a minute whether or not an Ops tab is open');
  assert.match(SERVER_SRC, /_devSuiteTimer\.unref\(\);/, 'the heartbeat never holds the process open');
});

// Trap 4 — requiring scripts/regression-report.js from another module must run nothing:
// no suite, no LAST-RUN.md, no inbox file, no process.exit. Unguarded, the dashboard's
// require would have run the whole suite inside the server process and then killed it.
test('J-red-dev-fix-request — trap 4: requiring scripts/regression-report.js runs no suite, writes no file and does not exit, and exports parse, renderObrienHandoff and OBRIEN_INBOX', () => {
  const probe = `
    const fs = require('fs'), cp = require('child_process');
    const writes = [], spawns = [];
    for (const fn of ['writeFileSync', 'appendFileSync', 'rmSync', 'unlinkSync']) {
      const o = fs[fn]; fs[fn] = function (...a) { writes.push(fn + ' ' + a[0]); return o.apply(fs, a); };
    }
    for (const fn of ['execFileSync', 'execSync', 'spawnSync', 'execFile', 'spawn', 'fork']) {
      const o = cp[fn]; cp[fn] = function (...a) { spawns.push(String(a[0])); return o.apply(cp, a); };
    }
    const m = require(${JSON.stringify(REPORT_JS)});
    console.log(JSON.stringify({ writes, spawns, keys: Object.keys(m).sort() }));
  `;
  // If main() still ran, process.exit fires before this line is printed and there is no
  // stdout to parse — which is exactly the failure this guards.
  const out = execFileSync('node', ['-e', probe], { encoding: 'utf8', cwd: os.tmpdir(), timeout: 60000 }).trim();
  const seen = JSON.parse(out.split('\n').pop());

  assert.deepEqual(seen.writes, [], 'no LAST-RUN.md and no inbox file');
  assert.deepEqual(seen.spawns, [], 'and above all no `node --test` — that is the 16-minute mistake');
  assert.deepEqual(seen.keys, ['OBRIEN_INBOX', 'parse', 'renderObrienHandoff'],
    'the three seams the routing needs; the constant keeps its name because slice 378 reads it');
  assert.match(REPORT_SRC, /if \(require\.main === module\) main\(\);/,
    'a bare main() is what made the module unrequirable');
});

// Trap 5 — requiring dashboard/server.js writes no register line and no state; only the
// STARTED server routes. Four test files require this module and one calls
// buildBridgeData(); the register path is not redirectable, so a module-load poll would
// write a real event into the real register on every one of them.
test('J-red-dev-fix-request — trap 5: requiring dashboard/server.js polls nothing, writes no register line and no dev-suite state; the timer is armed only from the require.main block', () => {
  const probe = `
    const fs = require('fs'), cp = require('child_process');
    const hits = [];
    // The module-load runtime-state seeder legitimately writes its own gitignored files;
    // what must never happen is a write to the register, the ledger or an inbox.
    const WATCH = /register\\.jsonl|dev-suite\\.json|[\\\\/]inbox[\\\\/]/;
    for (const fn of ['writeFileSync', 'appendFileSync', 'rmSync', 'unlinkSync']) {
      const o = fs[fn];
      fs[fn] = function (...a) { if (WATCH.test(String(a[0]))) hits.push(fn + ' ' + a[0]); return o.apply(fs, a); };
    }
    for (const fn of ['execFileSync', 'execSync', 'spawnSync', 'execFile', 'spawn']) {
      const o = cp[fn];
      cp[fn] = function (...a) { if (String(a[0]) === 'gh') hits.push('poll ' + String(a[0])); return o.apply(cp, a); };
    }
    const m = require(${JSON.stringify(SERVER)});
    console.log(JSON.stringify({ hits, armed: typeof m.startDevSuiteRouting, routed: typeof m.routeDevSuiteRun }));
  `;
  const out = execFileSync('node', ['-e', probe], { encoding: 'utf8', cwd: REPO_ROOT, timeout: 60000 }).trim();
  const seen = JSON.parse(out.split('\n').pop());

  assert.deepEqual(seen.hits, [], 'no gh poll, no register line, no ledger, no inbox file on require');
  assert.equal(seen.armed, 'function', 'arming is a function the entry point calls');
  assert.equal(seen.routed, 'function', 'and the routing itself is exported so it is testable without gh');
  // The probe also proves the process EXITS: an interval that was not unref'd would hold
  // it open until the 60s timeout instead.

  const main = SERVER_SRC.split(/^if \(require\.main === module\) \{$/m)[1];
  assert.ok(main, 'the entry-point block is still there');
  assert.match(main.split(/^\}/m)[0], /startDevSuiteRouting\(\);/, 'and it is what arms the routing');
  assert.equal(SERVER_SRC.match(/startDevSuiteRouting\(\);/g).length, 1,
    'armed from exactly one place — a second caller is a module-load poll waiting to happen');
});

// Task 5 — the single overwritten REGRESSION-FAILURE.md the LOCAL gate writes is
// unchanged. The renderer grew an options argument; with no options it must still render
// the same bytes, or this slice silently rewrites Bashir's gate handoff.
test('J-red-dev-fix-request — the local gate handoff is untouched: with no options the renderer names no commit, no run, and keeps the auto-cleared-on-green footer', () => {
  const { renderObrienHandoff } = loadReporter();
  const parsed = { summary: { pass: 1, fail: 1 }, failures: [{ name: 'J-x — a thing', slice: null, ac: null, excerpt: '  AssertionError: nope' }] };
  const local = renderObrienHandoff(parsed, '2026-09-13T10:00:00.000Z');

  assert.doesNotMatch(local, /\*\*Commit:\*\*/, 'the local gate reader is standing in the tree that failed');
  assert.doesNotMatch(local, /\*\*Run:\*\*/);
  assert.match(local, /This handoff is auto-cleared when regression goes green again\.\*$/m,
    'and the old footer is the old footer');
  assert.doesNotMatch(local, /Alex removes this file/, 'the persistent wording belongs to the per-commit files only');

  assert.match(REPORT_SRC, /const OBRIEN_HANDOFF = path\.join\(OBRIEN_INBOX, 'REGRESSION-FAILURE\.md'\);/,
    'and the one overwritten file still has its one name');
});

// Task 4 — a red per-push run must not be hidden behind "N ahead" in the mini pill: a
// landed slice is exactly what puts dev ahead of main, which is the state the branch
// order used to lose the red in.
test('J-red-dev-fix-request — the mini pill reads a red per-push run before it reads "N ahead"', () => {
  const mini = HTML_SRC.slice(HTML_SRC.indexOf('Slice 316: gate state takes priority in the mini pill'));
  const failingAt = mini.indexOf("ci && ci.state === 'failing'");
  const aheadAt = mini.indexOf("prStatus === 'idle' && ghAhead > 0");
  assert.ok(failingAt > -1 && aheadAt > -1, 'both branches are still there');
  assert.ok(failingAt < aheadAt, 'the red branch is tested first, so a landing push that went red is visible');
  assert.equal((mini.slice(0, aheadAt + 2000).match(/CI ✗ failing/g) || []).length, 1,
    'moved, not copied — two branches painting the same pill is the next ordering bug');
});
