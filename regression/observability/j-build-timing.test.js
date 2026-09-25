'use strict';

// J-build-timing — every build says where its minutes went (slice 392).
//
// The register recorded one number per build, `durationMs`, so nobody could
// tell from Ops whether sixteen minutes went into the product change or into
// the proof and paperwork around it. ADR-PROOF-LANES §1 answered that question
// once, for slice 383, with a hand parser over bridge/logs/rom-383.log run
// eleven times by Taylor; §8 wants the same answer for twenty runs. These tests
// hold the automatic version to the same rules: the attribution is pure over a
// session's stream-json, the orchestrator records it on the DONE event and in a
// sidecar beside the log, the History row's detail shows the split, and a
// one-shot script reads the same split out of the runs that came before.
//
// Harness:
//   - lib/build-timing.js and scripts/build-timing.js are required directly:
//     both are pure over text, so no fixture needs a disk.
//   - bridge/orchestrator.js is required with its dirs and register pointed at
//     an os.tmpdir() sandbox (the j-report-metrics-filled pattern) so nothing
//     here can touch the queue the live watcher polls.
//   - The page function is lifted out of dashboard/lcars-dashboard.html the way
//     j-history-chronological-order lifts the history comparator. A hand-kept
//     copy would go on passing after the page changed underneath it.
//
// @ac-hash: slice-392-ac-1 sha256:3f5dd727b3f0c982e825f4871aa2190695533d6809d156e8efa0612c6c0e586e
// @ac-hash: slice-392-ac-2 sha256:150607341e56f9be7e2e0b258063160f12ec25c09a80ea5063c416da6b5e00f0
// @ac-hash: slice-392-ac-3 sha256:deff2b4a6009ddb52e1c38f8e807c2364f89ce3b67cbc621086cacca024d248a
// @ac-hash: slice-392-ac-4 sha256:b65a2435afed2c31dc55424550351017f3d0a9e3b20e5699aad5710c48aee480

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const LIB_PATH = path.join(REPO_ROOT, 'lib', 'build-timing.js');
const ORCH_PATH = path.join(REPO_ROOT, 'bridge', 'orchestrator.js');
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'build-timing.js');
const DASH_PATH = path.join(REPO_ROOT, 'dashboard', 'lcars-dashboard.html');

const { attributeRun, phaseOf } = require('../../lib/build-timing');
const { resolveLogPath } = require('../../scripts/build-timing');

// ── Fixture: a trimmed stream-json run, one call per phase ───────────────────
//
// Trap 1: bridge/logs/ is gitignored, so a fixture cannot be a real log path —
// a test that read one would pass on this machine and fail in every clone and
// in CI. The run below is written out here instead, a dozen events long, and is
// the only session any of these tests sees.

const T0 = Date.parse('2026-09-13T10:00:00.000Z');
const at = ms => new Date(T0 + ms).toISOString();

function assistant(ms, uses) {
  return JSON.stringify({ type: 'assistant', timestamp: at(ms), message: { role: 'assistant', content: uses.map(u => ({ type: 'tool_use', ...u })) } });
}
function userResult(ms, ids) {
  return JSON.stringify({ type: 'user', timestamp: at(ms), message: { role: 'user', content: ids.map(id => ({ type: 'tool_result', tool_use_id: id, content: 'ok' })) } });
}

// Seconds, so the arithmetic below is readable: orient 10+2, build 8+1,
// tests 9+30, break-it (stash, red run, restore) 5+1 / 4+20 / 5+1,
// report 4+2, git 3+1, suite 7+60, browser-look 5+3, locks 4+6.
const RUN = [
  JSON.stringify({ type: 'system', subtype: 'init', timestamp: at(0), session_id: 'fixture' }),
  assistant(10_000, [{ id: 'c1', name: 'Read', input: { file_path: 'bridge/orchestrator.js' } }]),
  userResult(12_000, ['c1']),
  assistant(20_000, [{ id: 'c2', name: 'Write', input: { file_path: 'lib/build-timing.js' } }]),
  userResult(21_000, ['c2']),
  assistant(30_000, [{ id: 'c3', name: 'Write', input: { file_path: 'regression/observability/j-build-timing.test.js' } }]),
  userResult(60_000, ['c3']),
  assistant(65_000, [{ id: 'c4', name: 'Bash', input: { command: 'git stash push -u -m slice-392' } }]),
  userResult(66_000, ['c4']),
  assistant(70_000, [{ id: 'c5', name: 'Bash', input: { command: 'node --test regression/observability/j-build-timing.test.js' } }]),
  userResult(90_000, ['c5']),
  assistant(95_000, [{ id: 'c6', name: 'Bash', input: { command: 'git stash apply deadbeef' } }]),
  userResult(96_000, ['c6']),
  assistant(100_000, [{ id: 'c7', name: 'Write', input: { file_path: 'bridge/queue/392-DONE.md' } }]),
  userResult(102_000, ['c7']),
  assistant(105_000, [{ id: 'c8', name: 'Bash', input: { command: 'git add -A && git commit -m x' } }]),
  userResult(106_000, ['c8']),
  assistant(113_000, [{ id: 'c9', name: 'Bash', input: { command: 'npm test' } }]),
  userResult(173_000, ['c9']),
  assistant(178_000, [{ id: 'c10', name: 'Bash', input: { command: 'curl -s localhost:3000/api/bridge' } }]),
  userResult(181_000, ['c10']),
  assistant(185_000, [{ id: 'c11', name: 'Bash', input: { command: 'node scripts/build-coverage-map.js' } }]),
  userResult(191_000, ['c11']),
  JSON.stringify({ type: 'result', duration_ms: 191_000, num_turns: 12, total_cost_usd: 1.23, usage: { input_tokens: 91, output_tokens: 4102 } }),
].join('\n');

// ── AC-1 ────────────────────────────────────────────────────────────────────

// @ac-hash: slice-392-ac-1 sha256:3f5dd727b3f0c982e825f4871aa2190695533d6809d156e8efa0612c6c0e586e
test('slice-392-ac-1 attributeRun splits a run into per-phase model and tool seconds, counts the calls, dates the first product edit, and returns nulls for a log with no timestamps', () => {
  // The per-call rules, one call at a time — the ADR §1 vocabulary.
  const rules = [
    ['orient', 'Read', { file_path: 'bridge/orchestrator.js' }],
    ['orient', 'Grep', { pattern: 'sessionTelemetry' }],
    ['orient', 'Bash', { command: "sed -n '1,40p' lib/build-timing.js" }],
    ['build', 'Edit', { file_path: 'dashboard/server.js' }],
    ['build', 'Bash', { command: "sed -i '' 's/a/b/' dashboard/server.js" }],
    ['tests', 'Write', { file_path: 'regression/observability/j-build-timing.test.js' }],
    ['tests', 'Bash', { command: 'node --test regression/observability/j-build-timing.test.js' }],
    // One file is still one file when its stderr is piped somewhere. Reading a
    // redirect as a second target would report a suite run that never happened
    // — the exact number ADR-PROOF-LANES §8 reads twenty runs to watch.
    ['tests', 'Bash', { command: 'node --test regression/observability/j-build-timing.test.js 2>&1 | tail -30' }],
    ['tests', 'Bash', { command: 'node --test regression/x.test.js > /tmp/o.txt' }],
    ['suite', 'Bash', { command: "node --test 'regression/**/*.test.js' 2>&1 | tail -5" }],
    ['break-it', 'Bash', { command: 'git stash push -u -m x' }],
    ['break-it', 'Bash', { command: 'git checkout -- lib/build-timing.js' }],
    ['suite', 'Bash', { command: 'npm test' }],
    ['suite', 'Bash', { command: 'node --test regression/**/*.test.js' }],
    ['locks', 'Bash', { command: 'node scripts/build-ac-manifest.js' }],
    ['report', 'Write', { file_path: 'bridge/queue/392-DONE.md' }],
    ['git', 'Bash', { command: 'git add -A && git commit -m "x"' }],
    // A commit message is paperwork however it is quoted. The heredoc Sam
    // actually types must land where `git commit -F /tmp/msg.txt` lands, and
    // never on the product-change line Philipp reads first — not even when the
    // message names the test file it added.
    ['git', 'Bash', { command: 'git commit -F /tmp/msg.txt' }],
    ['git', 'Bash', { command: `git commit -m "$(cat <<'EOF'\nS392: adds regression/x.test.js\nEOF\n)"` }],
    ['git', 'Bash', { command: `git add -f bridge/queue/392-DONE.md && git commit -m "$(cat <<'EOF'\nS392: done\nEOF\n)"` }],
    // …but a real edit alongside the paperwork is still an edit.
    ['build', 'Bash', { command: `git commit -m "$(cat <<'EOF'\nmsg\nEOF\n)" && sed -i '' 's/a/b/' dashboard/server.js` }],
    ['report', 'Bash', { command: "cat > bridge/queue/392-DONE.md <<'EOF'\nreport\nEOF" }],
    ['browser-look', 'Bash', { command: 'npx playwright test e2e/x.spec.js' }],
    ['other', 'TodoWrite', {}],
  ];
  for (const [expected, tool, input] of rules) {
    assert.equal(phaseOf(tool, input), expected,
      `${tool} ${JSON.stringify(input)} must be attributed to ${expected}`);
  }

  // A commit message is not a command. Sam's messages name the lock files he
  // regenerated and quote the commands he ran, and every slice ends with one of
  // these, so a rung reading the raw text bills that prose on every measured
  // run. One case per rung that could go back to reading it — the first two
  // messages are verbatim from this repo's history.
  const commitOf = msg => `git commit -m "$(cat <<'EOF'\n${msg}\nEOF\n)"`;
  const prose = [
    ['locks', 'chore(gate): regenerate AC-MANIFEST.lock after slice 389\'s landing'],
    ['locks', 'S387: The pipeline owns the lock files and hands Sam his hashes\n\nAC: slice-387-ac-1: regression/COVERAGE.lock and regression/AC-MANIFEST.lock on dev equal a fresh regeneration'],
    ['suite', 'S392: `node --test <one file> 2>&1` was billed to suite; a suite run that never happened'],
    ['suite', 'S392: the rule is npm test, and agents do not run it'],
    ['tests', 'S392: ran `node --test regression/x.test.js | tail -30` and it went red as it should'],
    ['break-it', 'S392: the break-it pass no longer needs git stash, the stack is shared'],
    ['browser-look', 'S392: looked in chromium; npx playwright test stays Julian\'s'],
    ['build', 'S392: the rule table no longer needs a node -e probe'],
  ];
  for (const [rung, msg] of prose) {
    assert.equal(phaseOf('Bash', { command: commitOf(msg) }), 'git',
      `a commit message mentioning ${rung} work is still a commit, not ${rung} work: ${JSON.stringify(msg.slice(0, 60))}`);
  }

  // And the strip stops at the command boundary: it must not reach across `&&`
  // and swallow a heredoc that belongs to the command after it, which would take
  // minutes off the product line instead of putting them there.
  assert.equal(phaseOf('Bash', { command: `git commit -m 'x' && cat > dashboard/server.js <<'EOF'\ncode\nEOF` }), 'build',
    'a product write after a commit is still a product write');

  const r = attributeRun(RUN);

  assert.equal(r.calls, 11, 'every tool call in the run is counted');
  assert.equal(r.span_s, 191, 'the span is the run\'s own first-to-last timestamp');

  // The first Write outside regression/ and outside the DONE report, at 20s.
  assert.equal(r.first_product_edit_s, 20, 'the first product edit is dated from the run\'s start');

  assert.deepEqual(r.phases.orient, { calls: 1, model_s: 10, tool_s: 2 });
  assert.deepEqual(r.phases.build, { calls: 1, model_s: 8, tool_s: 1 });
  assert.deepEqual(r.phases.tests, { calls: 1, model_s: 9, tool_s: 30 });
  assert.deepEqual(r.phases.report, { calls: 1, model_s: 4, tool_s: 2 });
  assert.deepEqual(r.phases.git, { calls: 1, model_s: 3, tool_s: 1 });
  assert.deepEqual(r.phases.suite, { calls: 1, model_s: 7, tool_s: 60 });
  assert.deepEqual(r.phases['browser-look'], { calls: 1, model_s: 5, tool_s: 3 });
  assert.deepEqual(r.phases.locks, { calls: 1, model_s: 4, tool_s: 6 });

  // Break-it is a ritual, not a call: the red run between the stash and the
  // restore belongs to the proof, not to `tests`. Three calls, 36 seconds.
  assert.deepEqual(r.phases['break-it'], { calls: 3, model_s: 14, tool_s: 22 });

  // Every interval is charged exactly once, so the split adds up to the run
  // instead of exceeding it — a split that oversells itself is not a measurement.
  const summed = Object.values(r.phases).reduce((s, p) => s + p.model_s + p.tool_s, 0);
  assert.equal(Math.round(summed), r.span_s, 'the phase seconds add up to the run span');

  // A phase the run never entered is absent, not a zero row.
  assert.equal(r.phases.suite !== undefined, true);
  assert.equal(Object.prototype.hasOwnProperty.call(r.phases, 'never-heard-of-it'), false);

  // A log with no timestamps: nulls, zero seconds, and never a throw.
  const untimed = attributeRun([
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'u1', name: 'Write', input: { file_path: 'lib/x.js' } }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'u1' }] } }),
  ].join('\n'));
  assert.equal(untimed.span_s, null, 'no timestamps means no span, never a zero that reads as a measurement');
  assert.equal(untimed.first_product_edit_s, null);
  assert.equal(untimed.calls, 1, 'the calls are still counted');
  assert.deepEqual(untimed.phases.build, { calls: 1, model_s: 0, tool_s: 0 });

  // Nothing a log can contain may throw.
  for (const junk of ['', '   ', 'not json at all', '{bad', '[]\nnull\n"x"']) {
    assert.doesNotThrow(() => attributeRun(junk), `attributeRun must survive ${JSON.stringify(junk)}`);
  }
  assert.equal(attributeRun(undefined).calls, 0);
});

// ── AC-1 / trap 1 ───────────────────────────────────────────────────────────

// @ac-hash: slice-392-ac-1 sha256:3f5dd727b3f0c982e825f4871aa2190695533d6809d156e8efa0612c6c0e586e
test('slice-392-ac-1 trap 1 the attribution is taken over text, so no test here depends on a log under the gitignored bridge/logs/', () => {
  // attributeRun takes the session's bytes, not a path: that is what lets the
  // orchestrator feed it stdout it already holds, and what lets this file carry
  // its own fixture.
  const fromText = attributeRun(RUN);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'build-timing-trap1-'));
  const onDisk = path.join(tmp, 'rom-fixture.log');
  fs.writeFileSync(onDisk, RUN);
  assert.deepEqual(attributeRun(fs.readFileSync(onDisk, 'utf8')), fromText,
    'the same bytes attribute the same way whether they came from a variable or a file');

  // And the guard against the trap itself: a fixture wired back to a live log
  // would pass here and fail in every fresh clone and in CI. Prose is exempt —
  // the header of this file names rom-383.log as the run the ADR measured, and
  // naming a log is not reading one.
  const code = fs.readFileSync(__filename, 'utf8')
    .split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
  assert.equal(/bridge[/\\]logs[/\\]rom-/.test(code), false,
    'no test in this file may read a real per-slice log — bridge/logs/ is gitignored');
});

// ── AC-1 / trap 2 ───────────────────────────────────────────────────────────

// @ac-hash: slice-392-ac-1 sha256:3f5dd727b3f0c982e825f4871aa2190695533d6809d156e8efa0612c6c0e586e
test('slice-392-ac-1 trap 2 a truncated log (a result with no call) and a killed run (a call with no result) each attribute what they can and never throw', () => {
  // Truncated from the front: the result of a call the log no longer contains.
  const truncated = [
    JSON.stringify({ type: 'user', timestamp: at(1_000), message: { content: [{ type: 'tool_result', tool_use_id: 'gone-with-the-head-of-the-file' }] } }),
    assistant(5_000, [{ id: 'k1', name: 'Write', input: { file_path: 'lib/x.js' } }]),
    userResult(6_000, ['k1']),
  ].join('\n');
  let r;
  assert.doesNotThrow(() => { r = attributeRun(truncated); }, 'an orphan tool_result must not throw');
  assert.equal(r.calls, 1, 'the orphan result is not counted as a call it cannot name');
  assert.deepEqual(r.phases.build, { calls: 1, model_s: 4, tool_s: 1 });
  assert.equal(r.first_product_edit_s, 4);

  // Killed mid-call: the last tool_use never gets its result.
  const killed = [
    JSON.stringify({ type: 'system', subtype: 'init', timestamp: at(0) }),
    assistant(10_000, [{ id: 'k2', name: 'Bash', input: { command: 'npm test' } }]),
  ].join('\n');
  let k;
  assert.doesNotThrow(() => { k = attributeRun(killed); }, 'a tool_use with no result must not throw');
  assert.equal(k.calls, 1, 'the call still happened and is still counted');
  assert.deepEqual(k.phases.suite, { calls: 1, model_s: 10, tool_s: 0 },
    'its model time is known; its tool time never arrived and is not invented');

  // A result block that names nothing at all.
  assert.doesNotThrow(() => attributeRun(JSON.stringify({ type: 'user', timestamp: at(0), message: { content: [{ type: 'tool_result' }] } })));
});

// ── AC-1 / trap 3 ───────────────────────────────────────────────────────────

// @ac-hash: slice-392-ac-1 sha256:3f5dd727b3f0c982e825f4871aa2190695533d6809d156e8efa0612c6c0e586e
test('slice-392-ac-1 trap 3 lib/build-timing.js pulls in nothing — not a dependency, and above all not bridge/orchestrator.js', () => {
  const src = fs.readFileSync(LIB_PATH, 'utf8');
  const requires = [...src.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  assert.deepEqual(requires, [],
    'lib/build-timing.js must stay dependency-free; loading bridge/orchestrator.js seeds runtime files into the tree');

  // The direction of the arrow: the orchestrator reaches into lib, never back.
  const orch = fs.readFileSync(ORCH_PATH, 'utf8');
  assert.match(orch, /require\(['"]\.\.\/lib\/build-timing['"]\)/,
    'the orchestrator is the one that reaches for the attribution');

  // And it reaches lazily. The daemon has to boot where lib/ is not there at
  // all — the sandbox repo behind slice 393's recovery guard copies bridge/ and
  // nothing else — so the reach happens inside the function that needs it, the
  // way buildHashLines already reaches for lib/ac-block. A measurement is never
  // worth a process that will not start.
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'build-timing-nolib-'));
  const bridgeDir = path.join(sandbox, 'bridge', 'state');
  fs.mkdirSync(bridgeDir, { recursive: true });
  for (const f of fs.readdirSync(path.join(REPO_ROOT, 'bridge'))) {
    if (f.endsWith('.js')) fs.copyFileSync(path.join(REPO_ROOT, 'bridge', f), path.join(sandbox, 'bridge', f));
  }
  for (const f of fs.readdirSync(path.join(REPO_ROOT, 'bridge', 'state'))) {
    if (f.endsWith('.js')) fs.copyFileSync(path.join(REPO_ROOT, 'bridge', 'state', f), path.join(bridgeDir, f));
  }
  assert.equal(fs.existsSync(path.join(sandbox, 'lib')), false, 'the sandbox has no lib/, which is the whole point');

  // Loading it must not throw, and the attribution must degrade to "no phases"
  // rather than taking the run down with it.
  const probe = execFileSync(process.execPath, ['-e', `
    const o = require(${JSON.stringify(path.join(sandbox, 'bridge', 'orchestrator.js'))});
    process.stdout.write(JSON.stringify(o.recordBuildTiming('{"type":"assistant"}', '392', ${JSON.stringify(sandbox)})));
  `], { cwd: sandbox, encoding: 'utf8' });
  assert.equal(probe, '{}',
    'with lib/ absent the orchestrator still loads, and a missing attribution is just a DONE event without phases');
  fs.rmSync(sandbox, { recursive: true, force: true });
});

// ── AC-2 ────────────────────────────────────────────────────────────────────

// @ac-hash: slice-392-ac-2 sha256:150607341e56f9be7e2e0b258063160f12ec25c09a80ea5063c416da6b5e00f0
test('slice-392-ac-2 the session\'s end puts phases, first_product_edit_s and calls on the DONE event beside its existing keys, and a rom-<id>.timing.json next to the log', () => {
  const orchestrator = require('../../bridge/orchestrator.js');
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'build-timing-done-'));
  orchestrator._testSetDirs(TMP, TMP, TMP);
  orchestrator._testSetRegisterFile(path.join(TMP, 'register.jsonl'));

  const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-timing-logs-'));
  const fields = orchestrator.recordBuildTiming(RUN, '392', logsDir);

  // The three fields the DONE event gains.
  assert.deepEqual(Object.keys(fields).sort(), ['calls', 'first_product_edit_s', 'phases']);
  assert.equal(fields.calls, 11);
  assert.equal(fields.first_product_edit_s, 20);
  assert.deepEqual(fields.phases.suite, { calls: 1, model_s: 7, tool_s: 60 });

  // The sidecar sits next to the log it was derived from, named for the slice.
  const sidecar = path.join(logsDir, 'rom-392.timing.json');
  assert.equal(fs.existsSync(sidecar), true, 'the split is parked beside the log');
  const parked = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  assert.deepEqual(parked, attributeRun(RUN), 'the sidecar holds the whole attribution, span included');

  // A run it cannot attribute costs the event nothing it already had.
  assert.deepEqual(orchestrator.recordBuildTiming('', '392', logsDir).calls, 0);

  // An unwritable logs directory loses the sidecar and keeps the split: the
  // measurement must not be hostage to a directory.
  const gone = path.join(logsDir, 'no', 'such', 'place');
  const stillMeasured = orchestrator.recordBuildTiming(RUN, '392', gone);
  assert.equal(stillMeasured.calls, 11, 'a failed sidecar write never costs the DONE event its phases');

  // The wiring: attribution happens in Rom's exit callback, after the session's
  // own numbers, and the DONE event spreads it last so it can take nothing away.
  const orchSrc = fs.readFileSync(ORCH_PATH, 'utf8');
  const telemetryIdx = orchSrc.indexOf('const telemetry = sessionTelemetry(');
  // The session's text is gone (slice 396): the split is produced by an incremental
  // attributor fed event by event, and recordBuildTiming is handed the finished split.
  const timingIdx = orchSrc.indexOf('const buildTiming = recordBuildTiming(buildSplit, id, LOGS_DIR);');
  assert.ok(telemetryIdx > 0 && timingIdx > telemetryIdx,
    'recordBuildTiming runs in the exit callback, after sessionTelemetry');

  const doneEvent = (orchSrc.slice(timingIdx).match(/registerEvent\(id, 'DONE', \{[\s\S]*?\n {10}\}\);/) || [''])[0];
  assert.ok(doneEvent, "the DONE register event must still be written in Rom's exit callback");
  for (const key of ['durationMs:', 'tokensIn:', 'tokensOut:', 'tokensCacheRead:', 'costUsd:', 'laneEventFields(']) {
    assert.ok(doneEvent.includes(key), `the DONE event must keep carrying ${key}`);
  }
  assert.ok(doneEvent.includes('...buildTiming'), 'the DONE event carries the phase split');
  assert.ok(doneEvent.indexOf('...buildTiming') > doneEvent.indexOf('laneEventFields('),
    'the split is spread last, so it adds keys and overwrites none');
});

// ── AC-3 ────────────────────────────────────────────────────────────────────

// @ac-hash: slice-392-ac-3 sha256:deff2b4a6009ddb52e1c38f8e807c2364f89ce3b67cbc621086cacca024d248a
test('slice-392-ac-3 the History row detail draws one line per phase with its minutes and the first-product-edit minute, and draws nothing new for a row that has none', () => {
  const SRC = fs.readFileSync(DASH_PATH, 'utf8');

  // Lift the page's own function. A copy kept here would go on passing after
  // the page changed underneath it.
  const start = SRC.search(/\n\s*function phaseSplitHtml\s*\(/);
  assert.notEqual(start, -1, 'function phaseSplitHtml() must exist in lcars-dashboard.html');
  const open = SRC.indexOf('{', start);
  let depth = 0, end = -1;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  assert.notEqual(end, -1, 'unbalanced braces while lifting phaseSplitHtml()');
  const phaseSplitHtml = new Function('escHtml',
    `${SRC.slice(start, end)}; return phaseSplitHtml;`)(s => String(s));

  // The row the orchestrator now produces.
  const row = { id: '392', durationMs: 191000, ...(() => {
    const t = attributeRun(RUN);
    return { phases: t.phases, first_product_edit_s: t.first_product_edit_s, calls: t.calls };
  })() };

  const html = phaseSplitHtml(row);

  // One line per phase the run entered, and no line for one it did not.
  const drawn = [...html.matchAll(/data-phase="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(drawn.slice().sort(), Object.keys(row.phases).sort(),
    'every phase of the run gets a line and nothing else does');

  // Longest first: the shape of the build reads off the top of the list.
  const totals = drawn.map(p => row.phases[p].model_s + row.phases[p].tool_s);
  assert.deepEqual(totals, totals.slice().sort((a, b) => b - a), 'the lines are sorted by total');
  assert.equal(drawn[0], 'suite', 'the 67 seconds of suite lead the list of an 191-second run');

  // Minutes, not seconds — the unit Philipp reads the ADR in.
  assert.match(html, /1\.1 min/, 'suite\'s 67 seconds read as 1.1 min');
  assert.match(html, /<span class="phase-split-min">/);

  // The minute of the first product edit.
  assert.match(html, /id="phase-split-first-edit"/);
  assert.match(html, /First product edit:[\s\S]*?minute 0\.3/, '20 seconds in reads as minute 0.3');

  // A row with no attribution — every slice that finished before this landed —
  // shows nothing new at all.
  assert.equal(phaseSplitHtml({ id: '1', durationMs: 900000 }), '', 'no phases, no section');
  assert.equal(phaseSplitHtml({ id: '1', phases: null }), '');
  assert.equal(phaseSplitHtml({ id: '1', phases: {} }), '');
  assert.equal(phaseSplitHtml(null), '');

  // A run whose first product edit was never reached still lists its phases.
  const noEdit = phaseSplitHtml({ phases: { orient: { calls: 2, model_s: 30, tool_s: 10 } }, first_product_edit_s: null });
  assert.match(noEdit, /data-phase="orient"/);
  assert.match(noEdit, /First product edit:[\s\S]*?not recorded/);

  // And the page actually draws it in the History row's detail panel.
  const body = SRC.slice(SRC.indexOf('async function renderHistoryDetailBody'));
  assert.match(body.slice(0, 4000), /html \+= phaseSplitHtml\(item\);/,
    'the detail panel must render the split for the row it is showing');

  // The server has to hand the row those keys for any of this to be reachable.
  const serverSrc = fs.readFileSync(path.join(REPO_ROOT, 'dashboard', 'server.js'), 'utf8');
  assert.match(serverSrc, /phases:\s*ev\.phases\s*\?\?\s*null/);
  assert.match(serverSrc, /first_product_edit_s:\s*ev\.first_product_edit_s\s*\?\?\s*null/);
  assert.match(serverSrc, /calls:\s*ev\.calls\s*\?\?\s*null/);
});

// ── AC-4 ────────────────────────────────────────────────────────────────────

// @ac-hash: slice-392-ac-4 sha256:b65a2435afed2c31dc55424550351017f3d0a9e3b20e5699aad5710c48aee480
test('slice-392-ac-4 scripts/build-timing.js prints the same split for an existing log, given a slice id or a path', () => {
  // Source-shape check (also the static read that registers this guard against
  // scripts/build-timing.js in COVERAGE.lock — the gate credits reads, not executions,
  // and the behavioural run below is what actually proves the AC).
  const scriptSrc = fs.readFileSync(SCRIPT_PATH, 'utf8');
  assert.match(scriptSrc, /resolveLogPath/, 'the CLI exposes the id-or-path resolver the test drives');
  assert.match(scriptSrc, /require\.main === module/, 'the CLI is runnable directly and requireable without side effects');

  const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-timing-cli-'));
  const logPath = path.join(logsDir, 'rom-383.log');
  fs.writeFileSync(logPath, RUN);

  const run = (args, env) => execFileSync(process.execPath, [SCRIPT_PATH, ...args],
    { encoding: 'utf8', env: { ...process.env, DS9_LOGS_DIR: env || logsDir } });

  const byPath = run([logPath]);
  const byId = run(['383']);
  assert.equal(byId, byPath, 'an id and the path it resolves to print the same report');

  // The same split as the library's, in minutes.
  const expected = attributeRun(RUN);
  assert.match(byPath, /rom-383\.log — 3\.2 min over 11 tool calls/);
  for (const name of Object.keys(expected.phases)) {
    const p = expected.phases[name];
    const minutes = ((p.model_s + p.tool_s) / 60).toFixed(1);
    assert.ok(new RegExp(`^\\s*${name.replace('-', '\\-')}\\s+${minutes} min`, 'm').test(byPath),
      `${name} must be printed with its ${minutes} min`);
  }
  assert.match(byPath, /First product edit at minute 0\.3/);

  // --json prints exactly what the sidecar holds, so the script and the
  // pipeline cannot drift into two different answers.
  assert.deepEqual(JSON.parse(run([logPath, '--json'])), expected);

  // Where an id resolves, without touching a disk.
  assert.equal(resolveLogPath('383', '/logs'), path.join('/logs', 'rom-383.log'));
  assert.equal(resolveLogPath('/tmp/some/other.log', '/logs'), path.resolve('/tmp/some/other.log'));

  // A log that is not there says so and fails, rather than printing an empty split.
  let failed = null;
  try {
    execFileSync(process.execPath, [SCRIPT_PATH, '999999'],
      { encoding: 'utf8', env: { ...process.env, DS9_LOGS_DIR: logsDir }, stdio: 'pipe' });
  } catch (err) { failed = err; }
  assert.ok(failed, 'a missing log is an error, not an empty report');
  assert.equal(failed.status, 1);
  assert.match(String(failed.stderr), /No log to read at .*rom-999999\.log/);
});
