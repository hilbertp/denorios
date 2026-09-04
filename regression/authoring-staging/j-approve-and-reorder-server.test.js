'use strict';

/**
 * Journey: J-approve-and-reorder-queue (Tier 2 — in-process dashboard server)
 * Category: Authoring & Staging
 *
 * What this tests (against the journey spec, not the implementation):
 *   The approve + reorder HTTP surface, driven through the real dashboard
 *   server handlers compiled into a tmp root:
 *     - Steps 3-4 / Outcome 1: POST /api/bridge/staged/:id/approve →
 *       staged/{id}-STAGED.md no longer in staged/, queue/{id}-QUEUED.md
 *       exists with status QUEUED in parseable frontmatter, slice body
 *       preserved across the move.
 *     - Step 5 / Outcome 2: register.jsonl gains a HUMAN_APPROVAL event with
 *       the slice id (action approved).
 *     - Outcome 8: approving into an EMPTY queue leaves the id present in
 *       queue-order.json immediately, so the orchestrator's next poll can
 *       pick it up.
 *     - Step 9 + Outcome 4: each approval appends the id to queue-order.json
 *       in arrival order.
 *     - Steps 9-10 / Outcome 4: POST /api/queue/order persists exactly the
 *       submitted id array to queue-order.json as complete, valid JSON.
 *     - Failure-mode guard ("queue-order.json write fails silently" /
 *       outcome 4 atomicity): a malformed reorder payload is rejected and
 *       queue-order.json is left untouched — never corrupted.
 *     - Precondition guard: approving an id with no staged file is rejected
 *       and produces no queue file, no order entry, no register event.
 *
 * Deliberately NOT asserted here (and why):
 *   - Outcome 5 (dispatch order consumption): orchestrator-side; covered in
 *     the Tier 1 sibling j-approve-and-reorder-queue.test.js.
 *   - Steps 6-8, 10 + outcomes 3, 6-7 (drag handle, row animation, opacity
 *     0.6, dashed drop border, snap ease): browser-only rendering.
 *
 * Fixture isolation (#99992 rule): everything runs inside an os.tmpdir()
 * root; the server source is rewritten so REPO_ROOT points at the tmp root.
 * Live bridge/queue, bridge/staged, bridge/state, bridge/register.jsonl are
 * never touched. The server is closed in after() before the tmp root is
 * removed.
 *
 * Sources: docs/e2e-journeys/J-approve-and-reorder-queue.md
 *          docs/contracts/slice-pipeline.md §5 (STAGED → QUEUED on POST
 *            /approve, emits HUMAN_APPROVAL), §7 (HUMAN_APPROVAL event)
 *          docs/contracts/slice-lifecycle.md (QUEUED = approved by Philipp)
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');

const SERVER_SRC = path.resolve(__dirname, '..', '..', 'dashboard', 'server.js');

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

const ID_FIRST  = '99201';
const ID_SECOND = '99202';

function sliceFile(id, status, body = '## Goal\n\nOriginal staged body\n') {
  return `---\nid: "${id}"\ntitle: "Approve reorder ${id}"\nfrom: obrien\nto: rom\npriority: normal\ncreated: "2026-06-06T00:00:00.000Z"\nstatus: "${status}"\n---\n\n${body}`;
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

  const mod = new Module('patched-dashboard-server-j-approve-reorder');
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

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const meta = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^"|"$/g, '');
    meta[key] = val;
  }
  return meta;
}

function readOrder(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function registerEventsFor(id) {
  return fs.readFileSync(registerPath, 'utf8')
    .trim().split('\n').filter(Boolean).map(JSON.parse)
    .filter(ev => String(ev.slice_id) === String(id));
}

function seedStaged(id) {
  const filePath = path.join(stagedDir, `${id}-STAGED.md`);
  fs.writeFileSync(filePath, sliceFile(id, 'STAGED'), 'utf8');
  return filePath;
}

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j-approve-reorder-server-'));
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

// ── Steps 3-4 / Outcome 1: approve moves staged → queue ────────────────────

test('J-approve-and-reorder-queue slice-99201-ac-1 — POST /api/bridge/staged/:id/approve writes queue/{id}-QUEUED.md and the staged file is gone', async () => {
  const stagedPath = seedStaged(ID_FIRST);

  const res = await request('POST', `/api/bridge/staged/${ID_FIRST}/approve`, {});

  assert.equal(res.status, 200, 'approve endpoint must respond 200 (failure mode: "Approve does not respond")');
  assert.deepEqual(res.body, { ok: true });
  assert.equal(fs.existsSync(stagedPath), false,
    `staged/${ID_FIRST}-STAGED.md must be gone after approval (outcome 1)`);
  const queuedPath = path.join(queueDir, `${ID_FIRST}-QUEUED.md`);
  assert.equal(fs.existsSync(queuedPath), true,
    `queue/${ID_FIRST}-QUEUED.md must exist after approval (outcome 1)`);

  const queued = fs.readFileSync(queuedPath, 'utf8');
  const meta = parseFrontmatter(queued);
  assert.ok(meta, 'queued file must have parseable frontmatter');
  assert.equal(meta.status, 'QUEUED', 'frontmatter status must be QUEUED (step 4)');
  assert.equal(meta.id, ID_FIRST, 'frontmatter id survives the move');
  assert.match(queued, /Original staged body/, 'slice body must be preserved across the move (atomic move, step 4)');
});

// ── Step 5 / Outcome 2: HUMAN_APPROVAL register event ───────────────────────

test('J-approve-and-reorder-queue slice-99201-ac-2 — approval emits HUMAN_APPROVAL register event with the slice id', async () => {
  const events = registerEventsFor(ID_FIRST);
  const ev = events.find(e => e.event === 'HUMAN_APPROVAL');
  assert.ok(ev, `register.jsonl must contain a HUMAN_APPROVAL event for slice ${ID_FIRST} (step 5 / outcome 2)`);
  assert.equal(ev.action, 'approved', 'HUMAN_APPROVAL must record the approved action');
});

// ── Outcome 8: approval into an empty queue is immediately pickable ────────

test('J-approve-and-reorder-queue slice-99201-ac-6 — approving into an empty queue leaves the id present in queue-order.json for the next poll', async () => {
  // The queue was empty before the first approval (queue-order.json was []).
  const order = readOrder(queueOrderPath);
  assert.deepEqual(order, [ID_FIRST],
    'queue-order.json must contain exactly the freshly approved id so the next orchestrator poll can pick it up (outcome 8)');
});

// ── Step 9 + Outcome 4: approvals append in arrival order ───────────────────

test('J-approve-and-reorder-queue slice-99202-ac-3 — each approval appends the slice id to queue-order.json in arrival order', async () => {
  seedStaged(ID_SECOND);

  const res = await request('POST', `/api/bridge/staged/${ID_SECOND}/approve`, {});

  assert.equal(res.status, 200);
  assert.deepEqual(readOrder(queueOrderPath), [ID_FIRST, ID_SECOND],
    'second approval must append after the first — arrival order is the default priority order');
});

// ── Steps 9-10 / Outcome 4: drag-reorder persists exactly, atomically ──────

test('J-approve-and-reorder-queue slice-99202-ac-4 — POST /api/queue/order persists exactly the submitted id array to queue-order.json as valid JSON', async () => {
  const reordered = [ID_SECOND, ID_FIRST]; // Philipp dragged the second slice to the front

  const res = await request('POST', '/api/queue/order', { order: reordered });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });

  const raw = fs.readFileSync(queueOrderPath, 'utf8');
  let parsed;
  try { parsed = JSON.parse(raw); } catch (err) {
    assert.fail(`queue-order.json must be complete, valid JSON after reorder — got partial/corrupt content: ${err.message}`);
  }
  assert.deepEqual(parsed, reordered,
    'queue-order.json must contain exactly the submitted order — nothing dropped, nothing reordered, nothing extra (outcome 4)');
});

// ── Outcome 4 guard / failure mode "write fails silently" ───────────────────

test('J-approve-and-reorder-queue slice-99202-ac-5 — malformed reorder payload is rejected and queue-order.json is left untouched', async () => {
  const beforeRaw = fs.readFileSync(queueOrderPath, 'utf8');

  const res = await request('POST', '/api/queue/order', { order: 'not-an-array' });

  assert.equal(res.status, 400, 'a non-array order must be rejected, not written');
  assert.equal(fs.readFileSync(queueOrderPath, 'utf8'), beforeRaw,
    'queue-order.json must be byte-identical after a rejected reorder — a corrupt order file silently reorders or orphans every subsequent dispatch');
  assert.ok(Array.isArray(JSON.parse(fs.readFileSync(queueOrderPath, 'utf8'))),
    'queue-order.json must still parse as a JSON array');
});

// ── Precondition guard: approve with no staged file ─────────────────────────

test('J-approve-and-reorder-queue slice-99203-ac-7 — approving an id with no staged file is rejected with no queue file, no order entry, no register event', async () => {
  const ghostId = '99203';
  const beforeOrder = fs.readFileSync(queueOrderPath, 'utf8');

  const res = await request('POST', `/api/bridge/staged/${ghostId}/approve`, {});

  assert.equal(res.status, 404, 'approve of a missing staged slice must be rejected (journey precondition: staged file present)');
  assert.equal(fs.existsSync(path.join(queueDir, `${ghostId}-QUEUED.md`)), false,
    'no QUEUED file may be fabricated for a slice that was never staged');
  assert.equal(fs.readFileSync(queueOrderPath, 'utf8'), beforeOrder,
    'queue-order.json must be untouched by a rejected approval');
  assert.deepEqual(registerEventsFor(ghostId), [],
    'no HUMAN_APPROVAL may be recorded for a slice that was never approved');
});
