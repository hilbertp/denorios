'use strict';

/**
 * Journey: J-direct-controls-ops-ui (Tier 2 — in-process dashboard server)
 * Category: Direct controls
 *
 * The journey is a catalog of every Ops UI control. Most rows are visual
 * (hover/focus/drag/animation) or duplicate other journeys' server contracts.
 * The unique HEADLESS surfaces pinned here, straight from the journey table:
 *
 *   Header bar / "System pulse pill — View":
 *     Tri-state liveness derived from bridge/heartbeat.json. The journey
 *     names the states NOMINAL (green) / IDLE (amber) / DOWN (red); the
 *     server-side derivation contract the pill consumes is GET /api/health
 *     -> watcher.status 'up' | 'stale' | 'down' (the HTML maps that field
 *     to the pill, see lcars-dashboard.html "orchStatus"). Headless spec:
 *     fresh heartbeat ts -> healthy state, aging ts -> intermediate state,
 *     old/missing heartbeat -> down state, plus heartbeat age exposed for
 *     the hover tooltip ("orchestrator state and heartbeat age").
 *
 *   Queue panel / "Approve button (staged rows)":
 *     staged -> queue; server writes {id}-QUEUED.md; emits HUMAN_APPROVAL.
 *     (Deep coverage lives in J-approve-and-reorder-queue; one
 *     representative cross-assertion here.)
 *
 *   Queue panel / "Confirm reject":
 *     "Archive or remove the staged slice; remove row" — the ONLY place the
 *     reject control is specified. Asserted: the slice stops being listed by
 *     GET /api/bridge/staged and its file leaves bridge/staged/, while other
 *     staged rows survive (row-scoped removal).
 *
 *   Queued-detail rows (Save edits / Return to O'Brien / Un-approve /
 *   Remove from queue): one representative endpoint+event cross-assertion
 *   each (returned_to_stage, slice-unapproved, slice-archived-from-queue;
 *   Save edits names no event — frontmatter preservation only). Deep
 *   coverage delegated to the J-queue-detail-controls files.
 *
 *   STALE-SKIP: the Branch Topology rows "Merge to main button -> gate-start
 *   / GATE_RUNNING", "Gate step cards", "Abort -> ACCUMULATING" and "Gate
 *   status pill GATE_RUNNING/GATE_FAILED" describe the RETIRED local gate.
 *   ADR-GITHUB-CI-MERGE-MODEL (Amendment 2026-06-06): "The retired local
 *   gate stays retired." The live control is RUN GATE & MERGE TO MAIN ->
 *   /api/promote/dispatch, covered under regression/gate-merge/. Encoded as
 *   skipped tests so the stale spec rows stay visible without asserting
 *   dead semantics.
 *
 * NOT covered here (browser-only, out of headless scope): hover/focus/
 * active states, tooltips' rendering, collapse toggles, drag visuals,
 * keyboard navigation, clock display, log-view streaming.
 *
 * Fixture isolation (#99992 rule): everything runs inside an os.tmpdir()
 * root; the server source is rewritten so REPO_ROOT points at the tmp root.
 * Live bridge/queue, bridge/staged, bridge/state, bridge/register.jsonl are
 * never touched.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');

const SERVER_SRC = path.resolve(__dirname, '..', '..', 'dashboard', 'server.js');

const STALE_GATE_SKIP =
  'STALE journey rows: local gate (gate-start, GATE_RUNNING, gate step cards, abort->ACCUMULATING) ' +
  'is retired per docs/adr/ADR-GITHUB-CI-MERGE-MODEL.md Amendment 2026-06-06 ' +
  '("The retired local gate stays retired"). Live control: RUN GATE & MERGE TO MAIN -> ' +
  '/api/promote/dispatch, covered in regression/gate-merge/.';

let tmpRoot;
let server;
let port;
let queueDir;
let stagedDir;
let trashDir;
let registerPath;
let heartbeatPath;
let queueOrderPath;
let stagedOrderPath;

// Monotonic fake mtime for heartbeat writes: /api/health reads heartbeat.json
// through an mtime-keyed cache (getCachedFile), so every rewrite gets an
// explicitly distinct mtime to make cache invalidation deterministic.
let hbStamp = 1700000000;

function writeHeartbeat(obj) {
  fs.writeFileSync(heartbeatPath, JSON.stringify(obj), 'utf8');
  hbStamp += 10;
  fs.utimesSync(heartbeatPath, hbStamp, hbStamp);
}

function sliceFile(id, status, body = '## Goal\n\nOriginal body\n') {
  return `---\nid: "${id}"\ntitle: "Direct controls ${id}"\nfrom: obrien\nto: rom\npriority: normal\ncreated: "2026-06-06T00:00:00.000Z"\nstatus: "${status}"\n---\n\n${body}`;
}

function readRegisterEvents() {
  return fs.readFileSync(registerPath, 'utf8')
    .trim().split('\n').filter(Boolean).map(JSON.parse);
}

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
    .replace(/module\.exports = \{ /, 'module.exports = { server, ');

  const mod = new Module('patched-dashboard-server-direct-controls');
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

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lob-direct-controls-'));
  queueDir = path.join(tmpRoot, 'bridge', 'queue');
  stagedDir = path.join(tmpRoot, 'bridge', 'staged');
  trashDir = path.join(tmpRoot, 'bridge', 'trash');
  registerPath = path.join(tmpRoot, 'bridge', 'register.jsonl');
  heartbeatPath = path.join(tmpRoot, 'bridge', 'heartbeat.json');
  queueOrderPath = path.join(tmpRoot, 'bridge', 'queue-order.json');
  stagedOrderPath = path.join(tmpRoot, 'bridge', 'staged-order.json');

  for (const dir of [
    queueDir,
    stagedDir,
    trashDir,
    path.join(tmpRoot, 'bridge', 'control'),
    path.join(tmpRoot, 'bridge', 'errors'),
    path.join(tmpRoot, 'bridge', 'state'),
    path.join(tmpRoot, 'dashboard'),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(registerPath, '', 'utf8');
  fs.writeFileSync(heartbeatPath, JSON.stringify({ current_slice: null }), 'utf8');
  fs.writeFileSync(queueOrderPath, '[]', 'utf8');
  fs.writeFileSync(stagedOrderPath, '[]', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'sessions.jsonl'), '', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'first-output.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'nog-active.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'state', 'branch-state.json'), '{}', 'utf8');

  server = compileServer(tmpRoot);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ── Header bar: System pulse pill — tri-state derivation from heartbeat ────

test('J-direct-controls-ops-ui slice-99801-ac-1 — System pulse: fresh heartbeat ts derives the healthy state (NOMINAL/green row) with heartbeat age exposed', async () => {
  writeHeartbeat({ ts: new Date().toISOString(), current_slice: null, processed_total: 3 });

  const res = await request('GET', '/api/health');

  assert.equal(res.status, 200);
  assert.equal(res.body.watcher.status, 'up'); // healthy tier — pill renders this green/NOMINAL
  // Tooltip row: "orchestrator state and heartbeat age" — age must be a real number
  assert.equal(typeof res.body.watcher.heartbeatAge_s, 'number');
  assert.ok(res.body.watcher.heartbeatAge_s < 30,
    `fresh heartbeat must sit in the healthy band, got age ${res.body.watcher.heartbeatAge_s}s`);
});

test('J-direct-controls-ops-ui slice-99801-ac-2 — System pulse: aging heartbeat ts derives the intermediate state (IDLE/amber row)', async () => {
  writeHeartbeat({ ts: new Date(Date.now() - 45 * 1000).toISOString(), current_slice: null });

  const res = await request('GET', '/api/health');

  assert.equal(res.status, 200);
  assert.equal(res.body.watcher.status, 'stale'); // intermediate tier — pill renders this amber
  assert.ok(res.body.watcher.heartbeatAge_s >= 30 && res.body.watcher.heartbeatAge_s < 60,
    `45s-old heartbeat must sit in the intermediate band, got age ${res.body.watcher.heartbeatAge_s}s`);
});

test('J-direct-controls-ops-ui slice-99801-ac-3 — System pulse: old heartbeat ts derives the down state (DOWN/red row)', async () => {
  writeHeartbeat({ ts: new Date(Date.now() - 120 * 1000).toISOString(), current_slice: null });

  const res = await request('GET', '/api/health');

  assert.equal(res.status, 200);
  assert.equal(res.body.watcher.status, 'down'); // dead tier — pill renders this red
});

test('J-direct-controls-ops-ui slice-99801-ac-4 — System pulse: missing heartbeat.json derives the down state with no heartbeat age (DOWN/red row)', async () => {
  fs.rmSync(heartbeatPath, { force: true });

  const res = await request('GET', '/api/health');

  assert.equal(res.status, 200);
  assert.equal(res.body.watcher.status, 'down');
  assert.equal(res.body.watcher.heartbeatAge_s, null); // tooltip shows "no heartbeat"

  // Restore the idle-heartbeat fixture for the queue-control tests below.
  writeHeartbeat({ current_slice: null });
});

// ── Queue panel: Approve button (staged rows) ──────────────────────────────

test('J-direct-controls-ops-ui slice-99802-ac-1 — Approve: staged slice moves to queue as {id}-QUEUED.md and HUMAN_APPROVAL is emitted', async () => {
  const id = '99802';
  fs.writeFileSync(path.join(stagedDir, `${id}-STAGED.md`), sliceFile(id, 'STAGED'), 'utf8');

  const res = await request('POST', `/api/bridge/staged/${id}/approve`);

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  // "server writes {id}-QUEUED.md"
  assert.equal(fs.existsSync(path.join(queueDir, `${id}-QUEUED.md`)), true);
  // "Move slice from staged → queue" — staged side no longer offers the row
  assert.equal(fs.existsSync(path.join(stagedDir, `${id}-STAGED.md`)), false);
  const listed = await request('GET', '/api/bridge/staged');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.some(item => String(item.id) === id), false);
  // "emit HUMAN_APPROVAL event"
  assert.ok(readRegisterEvents().some(ev => ev.event === 'HUMAN_APPROVAL' && String(ev.slice_id) === id),
    'register must gain a HUMAN_APPROVAL event for the approved slice');
});

// ── Queue panel: Confirm reject (the only journey specifying this control) ──

test('J-direct-controls-ops-ui slice-99803-ac-1 — Confirm reject: staged slice is archived/removed and no longer listed by /api/bridge/staged; other staged rows survive', async () => {
  const id = '99803';
  const bystanderId = '99809';
  fs.writeFileSync(path.join(stagedDir, `${id}-STAGED.md`), sliceFile(id, 'STAGED'), 'utf8');
  fs.writeFileSync(path.join(stagedDir, `${bystanderId}-STAGED.md`), sliceFile(bystanderId, 'STAGED'), 'utf8');

  const res = await request('POST', `/api/bridge/staged/${id}/reject`);

  assert.equal(res.status, 200);
  // "Archive or remove the staged slice" — it must leave bridge/staged/
  assert.equal(fs.existsSync(path.join(stagedDir, `${id}-STAGED.md`)), false);
  // ...and it must never land in the queue (reject is not an approval path)
  assert.equal(fs.existsSync(path.join(queueDir, `${id}-QUEUED.md`)), false);
  // "remove row" — the staged listing drops exactly this slice
  const listed = await request('GET', '/api/bridge/staged');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.some(item => String(item.id) === id), false,
    'rejected slice must no longer be listed in /api/bridge/staged');
  assert.equal(listed.body.some(item => String(item.id) === bystanderId), true,
    'reject is row-scoped: other staged slices must remain listed');

  // cleanup bystander so later listings stay independent
  fs.rmSync(path.join(stagedDir, `${bystanderId}-STAGED.md`), { force: true });
});

// ── Queued-detail rows: one representative cross-assertion each.
//    Deep coverage: regression/authoring-staging/j-queue-detail-controls*.test.js

test('J-direct-controls-ops-ui slice-99804-ac-1 — Save edits (queued detail): frontmatter preserved, markdown body updated', async () => {
  const id = '99804';
  const filePath = path.join(queueDir, `${id}-QUEUED.md`);
  fs.writeFileSync(filePath, sliceFile(id, 'QUEUED'), 'utf8');

  const res = await request('PATCH', `/api/queue/${id}/content`, { body: '## Goal\n\nEdited via Ops UI\n' });

  assert.equal(res.status, 200);
  const updated = fs.readFileSync(filePath, 'utf8');
  // "Preserve frontmatter"
  assert.match(updated, /id: "99804"/);
  assert.match(updated, /status: "QUEUED"/);
  assert.match(updated, /title: "Direct controls 99804"/);
  assert.match(updated, /priority: normal/);
  // "write updated markdown body"
  assert.match(updated, /Edited via Ops UI/);
  assert.doesNotMatch(updated, /Original body/);
});

test("J-direct-controls-ops-ui slice-99805-ac-1 — Return to O'Brien (queued detail): slice moves to staged/{id}-NEEDS_APENDMENT.md and returned_to_stage is emitted", async () => {
  const id = '99805';
  fs.writeFileSync(path.join(queueDir, `${id}-QUEUED.md`), sliceFile(id, 'QUEUED'), 'utf8');

  const res = await request('POST', `/api/queue/${id}/return-to-stage`, { note: 'Scope needs a rewrite' });

  assert.equal(res.status, 200);
  assert.equal(res.body.action, 'returned_to_stage');
  // "Move queued slice to staged/{id}-NEEDS_APENDMENT.md"
  assert.equal(fs.existsSync(path.join(stagedDir, `${id}-NEEDS_APENDMENT.md`)), true);
  assert.equal(fs.existsSync(path.join(queueDir, `${id}-QUEUED.md`)), false);
  // "emit returned_to_stage"
  assert.ok(readRegisterEvents().some(ev => ev.event === 'returned_to_stage' && String(ev.slice_id) === id),
    'register must gain a returned_to_stage event for the slice');
});

test('J-direct-controls-ops-ui slice-99806-ac-1 — Un-approve (queued detail): slice moves back to staged/{id}-STAGED.md and slice-unapproved is emitted', async () => {
  const id = '99806';
  fs.writeFileSync(path.join(queueDir, `${id}-QUEUED.md`), sliceFile(id, 'QUEUED'), 'utf8');
  fs.writeFileSync(queueOrderPath, JSON.stringify([id]), 'utf8');

  const res = await request('POST', `/api/slice/${id}/unapprove`);

  assert.equal(res.status, 200);
  // "Move queued slice back to staged/{id}-STAGED.md"
  assert.equal(fs.existsSync(path.join(stagedDir, `${id}-STAGED.md`)), true);
  assert.equal(fs.existsSync(path.join(queueDir, `${id}-QUEUED.md`)), false);
  // "emit slice-unapproved"
  assert.ok(readRegisterEvents().some(ev => ev.event === 'slice-unapproved' && String(ev.slice_id) === id),
    'register must gain a slice-unapproved event for the slice');

  // cleanup for independence of later listings
  fs.rmSync(path.join(stagedDir, `${id}-STAGED.md`), { force: true });
  fs.writeFileSync(queueOrderPath, '[]', 'utf8');
});

test('J-direct-controls-ops-ui slice-99807-ac-1 — Remove from queue (queued detail): queued file moves to bridge/trash/ and slice-archived-from-queue is emitted', async () => {
  const id = '99807';
  fs.writeFileSync(path.join(queueDir, `${id}-QUEUED.md`), sliceFile(id, 'QUEUED'), 'utf8');

  const res = await request('POST', `/api/queue/${id}/remove`);

  assert.equal(res.status, 200);
  // "Move queued file to bridge/trash/"
  assert.equal(fs.existsSync(path.join(queueDir, `${id}-QUEUED.md`)), false);
  assert.ok(fs.readdirSync(trashDir).some(f => f.startsWith(`${id}-QUEUED.md`)),
    'removed queued file must be archived under bridge/trash/');
  // "emit slice-archived-from-queue"
  assert.ok(readRegisterEvents().some(ev => ev.event === 'slice-archived-from-queue' && String(ev.slice_id) === id),
    'register must gain a slice-archived-from-queue event for the slice');
});

// ── STALE journey rows: retired local gate (Branch Topology panel) ─────────
// These four table rows assert the OLD local gate machinery. Per
// docs/adr/ADR-GITHUB-CI-MERGE-MODEL.md (Amendment 2026-06-06) the retired
// local gate stays retired; /api/gate/start and /api/gate/abort remain in
// server.js only as legacy surface and their old semantics must not be
// asserted. Kept as named skips so the journey rows remain traceable.

test('J-direct-controls-ops-ui slice-99800-ac-1 — STALE ROW: Merge-to-main button emits gate-start and gate.status -> GATE_RUNNING (retired local gate)',
  { skip: STALE_GATE_SKIP }, () => {});

test('J-direct-controls-ops-ui slice-99800-ac-2 — STALE ROW: gate step cards "Tests updated / Regression pass / Merge" transition pending -> active -> done (retired local gate)',
  { skip: STALE_GATE_SKIP }, () => {});

test('J-direct-controls-ops-ui slice-99800-ac-3 — STALE ROW: Abort button POSTs gate-abort and gate.status -> ACCUMULATING (retired local gate)',
  { skip: STALE_GATE_SKIP }, () => {});

test('J-direct-controls-ops-ui slice-99800-ac-4 — STALE ROW: gate status pill shows GATE_RUNNING / GATE_FAILED during gate activity (retired local gate)',
  { skip: STALE_GATE_SKIP }, () => {});
