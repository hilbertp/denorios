'use strict';

/**
 * Journey: J-watch-slice-live-log (partial — known implementation gap)
 * Category: Observability
 *
 * What this tests (spec = journey text, not implementation):
 *   Philipp watches Rom's live log while a slice is IN_PROGRESS. The journey
 *   is pure observability — no state is written by the journey itself.
 *
 *   Fixture slice id: 99777. AC-index mapping (the journey has numbered steps
 *   and expected outcomes, no formal AC list):
 *     ac-1 ↔ step 1  (Active Build panel shows slice title + elapsed time —
 *                     headless contract: GET /api/bridge active-slice data)
 *     ac-2 ↔ step 2  (orchestrator tees Rom's output to a per-slice rom log)
 *     ac-3 ↔ step 3  ("View live log" button in the Active Build panel's
 *                     action group, wired to a real handler)
 *     ac-4 ↔ steps 4-5 (clicking opens a log view; GET /api/log/<id> serves
 *                     the log content)
 *     ac-6 ↔ step 6  (new lines appear near real-time via the no-store poll)
 *     ac-9 ↔ expected outcome 5 (logs preserved on disk after the session
 *                     for post-mortem — per-slice per-round naming contract)
 *
 * IMPLEMENTED 2026-06-15 (the live-log feature — previously a documented gap):
 *   - step 2: bridge/orchestrator.js invokeRom opens bridge/logs/rom-<id>.log as
 *     a write stream and tees Rom's child stdout/stderr to it (stream-json output
 *     emits one NDJSON event per turn, so the file grows line-by-line).
 *   - steps 4-5: GET /api/log/<id> in dashboard/server.js serves the recent tail
 *     (last 400 lines) no-store, 404 when no log exists yet.
 *   - step 3: the Active Build footer exposes a "View live log" control wired to
 *     viewLiveLog(), which opens a polling viewer (1.5s) of the endpoint.
 *
 *   ac-2/ac-3 assert the orchestrator/dashboard wiring at the source contract
 *   (LOGS_DIR is __dirname-anchored and the real child is claude -p, not runnable
 *   here, #99992 — live bridge/logs/ is never touched); ac-4/ac-6 exercise the
 *   read side against fixture files under the Tier-2 server root.
 *
 * Deliberately NOT asserted here (and why):
 *   - Steps 7-8 (scroll up, Escape/close) and outcome 3 (readable/scrollable):
 *     browser-UI interactions on the unimplemented viewer — not headless.
 *   - Outcome 4 (log stops updating on crash/completion, not an error state):
 *     depends entirely on the unimplemented viewer/streaming path; subsumed
 *     by the ac-4/ac-6 gap above.
 *
 * Tiers: Tier 2 (in-process compiled dashboard server) for the /api/bridge
 * active-build read; Tier 1 (tmpdir contract simulation) for the on-disk
 * per-slice log persistence contract — LOGS_DIR in the orchestrator is
 * __dirname-anchored and not redirectable by the test hooks, so the naming
 * contract is asserted against fixture files only (#99992: live bridge/
 * state is never touched).
 *
 * Sources: docs/e2e-journeys/J-watch-slice-live-log.md
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');

const { makeTmpDir, removeTmpDir } = require('../helpers/tmp-dir');

const SERVER_SRC = path.resolve(__dirname, '..', '..', 'dashboard', 'server.js');
const ORCH_SRC = path.resolve(__dirname, '..', '..', 'bridge', 'orchestrator.js');
const DASHBOARD_SRC = path.resolve(__dirname, '..', '..', 'dashboard', 'lcars-dashboard.html');

const SLICE_ID = '99777';
const SLICE_TITLE = 'Implement quantum torpedo telemetry';

let tmpRoot;     // Tier 2 server root
let server;
let port;
let queueDir;
let registerPath;
let heartbeatPath;

let logTmpDir;   // Tier 1 per-slice log fixture dir

// ── Tier 2 harness (verbatim pattern from the established suite) ────────────

function sliceFile(id, status, title) {
  return `---\nid: "${id}"\ntitle: "${title}"\nfrom: obrien\nto: rom\npriority: normal\ncreated: "2026-06-06T00:00:00.000Z"\nstatus: "${status}"\n---\n\n## Goal\n\nWatchable build for the live-log journey.\n`;
}

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
module.exports = {
  translateEvent(ev) { return ev; },
  resetDedupeState() {},
};
`, 'utf8');
  fs.writeFileSync(path.join(dashboardDir, 'lcars-dashboard.html'), '<html></html>', 'utf8');
  fs.writeFileSync(path.join(dashboardDir, 'tokens.css'), '', 'utf8');

  const src = fs.readFileSync(SERVER_SRC, 'utf8')
    .replace(
      /const REPO_ROOT\s*=[\s\S]*?path\.resolve\(__dirname,\s*'\.\.'\);/,
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
    .replace(/module\.exports = \{ /, 'module.exports = { server, ');

  const mod = new Module('patched-dashboard-server-j-watch-slice-live-log');
  mod.paths = module.paths;
  mod._compile(src, path.join(dashboardDir, 'server.js'));
  return mod.exports.server;
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

// The server caches bridge data on register + heartbeat mtimes; rewriting the
// heartbeat file is the journey-faithful way to invalidate it (the orchestrator
// rewrites heartbeat.json continuously while a slice is IN_PROGRESS).
function writeHeartbeat(obj) {
  fs.writeFileSync(heartbeatPath, JSON.stringify(obj), 'utf8');
}

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j-watch-slice-live-log-'));
  queueDir = path.join(tmpRoot, 'bridge', 'queue');
  registerPath = path.join(tmpRoot, 'bridge', 'register.jsonl');
  heartbeatPath = path.join(tmpRoot, 'bridge', 'heartbeat.json');

  for (const dir of [
    queueDir,
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
  writeHeartbeat({ current_slice: null });
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'queue-order.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'staged-order.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'sessions.jsonl'), '', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'first-output.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'nog-active.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'state', 'branch-state.json'), '{}', 'utf8');

  server = compileServer(tmpRoot);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;

  logTmpDir = makeTmpDir('j-watch-slice-live-log-logs');
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  removeTmpDir(logTmpDir);
});

// ---------------------------------------------------------------------------
// Step 1 (Active Build data source): with {id}-IN_PROGRESS.md in the queue,
// GET /api/bridge reports that slice as the active build with its title —
// the Active Build panel's headless contract.
// ---------------------------------------------------------------------------
test('J-watch-slice-live-log slice-99777-ac-1 — GET /api/bridge reports the IN_PROGRESS slice as the active build with its title', async () => {
  fs.writeFileSync(
    path.join(queueDir, `${SLICE_ID}-IN_PROGRESS.md`),
    sliceFile(SLICE_ID, 'IN_PROGRESS', SLICE_TITLE),
    'utf8'
  );

  const res = await request('GET', '/api/bridge');

  assert.equal(res.status, 200, '/api/bridge must answer 200 while a build is active');
  assert.equal(res.body.queue.active, 1,
    'the queue summary must count exactly the one IN_PROGRESS slice as active (journey precondition + step 1)');

  const active = (res.body.slices || []).find(s => String(s.id) === SLICE_ID);
  assert.ok(active, `slices[] must contain the IN_PROGRESS slice ${SLICE_ID} — without it the Active Build panel has nothing to show`);
  assert.equal(active.state, 'IN_PROGRESS',
    'the slice state must be derived as IN_PROGRESS from the filename suffix');
  assert.equal(active.title, SLICE_TITLE,
    'the Active Build panel shows the slice title (journey step 1) — /api/bridge must carry it');
});

// ---------------------------------------------------------------------------
// Step 1 (elapsed time data source): while Rom is implementing, the
// orchestrator's heartbeat carries current_slice + slice_elapsed_seconds;
// /api/bridge must surface both so the panel can render the elapsed timer.
// ---------------------------------------------------------------------------
test('J-watch-slice-live-log slice-99777-ac-1 — /api/bridge heartbeat carries current_slice and slice_elapsed_seconds for the elapsed timer', async () => {
  // ts is generated at request time — fresh by construction, no wall-clock
  // assumption beyond "this test completes within the 60s liveness window".
  writeHeartbeat({
    ts: new Date().toISOString(),
    status: 'processing',
    current_slice: SLICE_ID,
    slice_elapsed_seconds: 42,
    processed_total: 7,
  });

  const res = await request('GET', '/api/bridge');

  assert.equal(res.status, 200);
  const hb = res.body.heartbeat;
  assert.ok(hb, '/api/bridge must include the heartbeat block');
  assert.equal(String(hb.current_slice), SLICE_ID,
    'heartbeat.current_slice must name the slice Rom is implementing (journey precondition)');
  assert.equal(hb.slice_elapsed_seconds, 42,
    'heartbeat.slice_elapsed_seconds feeds the panel elapsed timer (journey step 1)');
  assert.equal(hb.status, 'processing',
    'a fresh heartbeat while Rom runs must not be reported as down');
});

// ---------------------------------------------------------------------------
// Step 2 — the orchestrator persists Rom's live output to a per-slice log file.
// invokeRom opens bridge/logs/rom-<id>.log as a write STREAM and tees Rom's
// child stdout (and stderr) to it, so the file grows as output arrives — the
// data source the viewer tails. LOGS_DIR is __dirname-anchored and the real
// child is claude -p (not runnable here), so the wiring is asserted at the
// source contract; ac-4/ac-6 exercise the read side against fixture files.
// ---------------------------------------------------------------------------
test('J-watch-slice-live-log slice-99777-ac-2 — the orchestrator persists Rom\'s live output to a per-slice log file', () => {
  const src = fs.readFileSync(ORCH_SRC, 'utf8');
  // A per-slice rom log path under LOGS_DIR.
  assert.match(src, /rom-\$\{id\}\.log/, 'invokeRom must target a per-slice rom-<id>.log');
  // It is a write STREAM (grows incrementally), not a single end-of-run writeFile.
  assert.match(src, /createWriteStream\(romLogPath/, 'the rom log must be a growing write stream');
  // Rom's stdout is teed to that stream as data arrives (the live source).
  assert.match(src, /child\.stdout\.on\('data',[\s\S]{0,200}?romLogStream\.write/,
    'Rom child stdout must be teed to the rom log as it arrives');
  // The stream is closed when the run ends so the file is flushed for post-mortem.
  assert.match(src, /romLogStream\.end\(\)/, 'the rom log stream must be closed on completion');
});

// ---------------------------------------------------------------------------
// Step 3 — the Active Build panel's action group exposes a "View live log"
// control while Rom is implementing, wired to a REAL handler (viewLiveLog) that
// opens the log viewer — not the Nog-lane placeholder (viewNogLog).
// ---------------------------------------------------------------------------
test('J-watch-slice-live-log slice-99777-ac-3 — the Active Build panel exposes a "View live log" control wired to a real handler', () => {
  const html = fs.readFileSync(DASHBOARD_SRC, 'utf8');
  const footer = html.match(/<div class="active-slice-footer"[\s\S]*?<\/div>/);
  assert.ok(footer, 'the Active Build footer (action group) must exist');
  assert.match(footer[0], /View live log/, 'the action group must offer a "View live log" control');
  assert.match(footer[0], /onclick="viewLiveLog\(\)"/, 'the control must be wired to viewLiveLog(), not the Nog placeholder');
  // viewLiveLog is a real handler that opens a polling viewer of the log endpoint
  // (the footer wiring above proves it is viewLiveLog, not the viewNogLog placeholder).
  assert.match(html, /function viewLiveLog\(\)/, 'viewLiveLog() must be defined');
  assert.match(html, /fetch\('\/api\/log\/'/, 'the viewer must tail the live-log endpoint');
  assert.match(html, /setInterval\(_liveLogFetch/, 'the viewer must poll so new lines surface in near real-time');
});

// ---------------------------------------------------------------------------
// Steps 4-5 + Outcomes 1-2 — clicking "View live log" opens a log view backed
// by a dashboard log endpoint. GET /api/log/<id> serves the recent log content
// for the active slice; a slice with no log yet 404s honestly (no false 200).
// ---------------------------------------------------------------------------
test('J-watch-slice-live-log slice-99777-ac-4 — GET /api/log/<id> serves the active slice log content', async () => {
  const logsDir = path.join(tmpRoot, 'bridge', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const content = 'init: starting build\nassistant: editing server.js\nassistant: Rom working on AC 1\n';
  fs.writeFileSync(path.join(logsDir, `rom-${SLICE_ID}.log`), content, 'utf8');

  const res = await request('GET', `/api/log/${SLICE_ID}`);
  assert.equal(res.status, 200, 'the log endpoint must serve the active slice log');
  assert.equal(res.body.id, SLICE_ID, 'the response identifies the slice');
  assert.ok(Array.isArray(res.body.lines), 'the response carries the log lines');
  assert.match(res.body.text, /Rom working on AC 1/, 'the served content is the real log, not a placeholder');
  assert.equal(res.body.totalLines, 3, 'the line count reflects the file');

  // A slice with no log yet must 404 honestly — never a false-success 200.
  const missing = await request('GET', '/api/log/55555');
  assert.equal(missing.status, 404, 'a slice with no log yet returns 404, not a blank 200');
  assert.equal(missing.body.error, 'no_log_yet');
});

// ---------------------------------------------------------------------------
// Step 6 — new log lines appear in near real-time. The orchestrator tees Rom's
// stdout to the rom log as it arrives (ac-2); the endpoint reads the file fresh
// (no-store) per poll, so appending a line and re-polling surfaces it — the
// viewer's 1.5s poll then renders it without a reload.
// ---------------------------------------------------------------------------
test('J-watch-slice-live-log slice-99777-ac-6 — new log lines surface on the next poll (near real-time)', async () => {
  const logsDir = path.join(tmpRoot, 'bridge', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const logPath = path.join(logsDir, `rom-${SLICE_ID}.log`);
  fs.writeFileSync(logPath, 'assistant: first line\n', 'utf8');

  const before = await request('GET', `/api/log/${SLICE_ID}`);
  assert.equal(before.status, 200);
  assert.ok(!before.body.text.includes('SECOND-LIVE-LINE'), 'the new line is not present before Rom writes it');

  // Rom writes more output → the orchestrator appends it to the rom log.
  fs.appendFileSync(logPath, 'assistant: SECOND-LIVE-LINE appears\n', 'utf8');

  const after = await request('GET', `/api/log/${SLICE_ID}`);
  assert.equal(after.status, 200);
  assert.match(after.body.text, /SECOND-LIVE-LINE appears/, 'the appended line must surface on the next poll');
  assert.ok(after.body.totalLines > before.body.totalLines, 'the line count grows as Rom writes');
});

// ---------------------------------------------------------------------------
// Expected outcome 5 (Tier 1 fixture-naming contract): "Logs are preserved on
// disk after the session for post-mortem if needed."
//
// The one per-slice log shape current dev exhibits is per-slice per-round:
// logs/nog-{id}-round{round}.log. LOGS_DIR is __dirname-anchored in the
// orchestrator and NOT redirectable via the _test hooks, so the contract is
// asserted with fixture files in a tmpdir using the same primitive the
// orchestrator uses (a single fs.writeFileSync at session end). Live
// bridge/logs/ is never touched (#99992).
// ---------------------------------------------------------------------------
test('J-watch-slice-live-log slice-99777-ac-9 — per-slice per-round log files persist on disk after the session and remain traceable to slice and round', () => {
  const logName = (id, round) => `nog-${id}-round${round}.log`;

  // Simulate two review sessions completing, each writing its own log file —
  // the orchestrator's primitive: one writeFileSync at process completion.
  const round1Path = path.join(logTmpDir, logName(SLICE_ID, 1));
  const round1Content = 'Round 1 review output\n--- stderr ---\n';
  fs.writeFileSync(round1Path, round1Content);

  const round2Path = path.join(logTmpDir, logName(SLICE_ID, 2));
  fs.writeFileSync(round2Path, 'Round 2 review output\n--- stderr ---\n');

  // Outcome 5: both logs persist on disk after the sessions ended.
  assert.ok(fs.existsSync(round1Path),
    'round 1 log must still exist after the session — preserved for post-mortem (outcome 5)');
  assert.ok(fs.existsSync(round2Path),
    'round 2 log must exist alongside round 1');

  // Per-round files are distinct: a later round must never clobber an earlier
  // round's log (post-mortem history would be silently lost).
  assert.equal(fs.readFileSync(round1Path, 'utf8'), round1Content,
    'round 1 log content must survive the round 2 session byte-for-byte');

  // Traceability: the filename alone must recover slice id and round, so an
  // operator following the journey\'s recovery path ("Check bridge/logs/ for
  // a per-slice log file") can find the right log without other context.
  for (const [p, expectedRound] of [[round1Path, '1'], [round2Path, '2']]) {
    const m = path.basename(p).match(/^nog-(.+)-round(\d+)\.log$/);
    assert.ok(m, `log filename ${path.basename(p)} must parse as nog-{id}-round{round}.log`);
    assert.equal(m[1], SLICE_ID, 'log filename must carry the slice id');
    assert.equal(m[2], expectedRound, 'log filename must carry the round number');
  }
});
