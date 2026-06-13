'use strict';

/**
 * Journey: J-queue-detail-controls (Tier 2 — in-process dashboard server)
 * Category: Authoring & Staging
 *
 * What this tests (against the journey spec, not the implementation):
 *   The queued-slice detail overlay's pre-dispatch controls, driven through
 *   the real dashboard server HTTP handlers compiled into a tmp root:
 *     - Steps 3-4 / Outcome 1: Save edits preserves the frontmatter block
 *       (id, status, ownership, priority, dependency fields) and writes only
 *       the updated body. Failure mode "save strips frontmatter": a missing
 *       body or an unparseable frontmatter block must yield 400 and leave the
 *       file unchanged rather than writing a malformed file.
 *     - Step 5a / Outcome 2: Un-approve -> staged/{id}-STAGED.md, status
 *       STAGED, queue-order loses the id, staged-order gains it,
 *       slice-unapproved register event.
 *     - Step 5b / Outcome 3: Return to O'Brien -> staged/{id}-NEEDS_APENDMENT.md,
 *       status NEEDS_APENDMENT with apendment_note, both order files updated,
 *       returned_to_stage register event, O'Brien/staged-return vocabulary.
 *     - Step 5c / Outcome 4: Remove from queue -> queued file archived into
 *       bridge/trash/, queue-order loses the id, slice-archived-from-queue event.
 *     - Outcome 5: with heartbeat.current_slice === id every destructive
 *       movement action returns 409 and the queued file stays in place.
 *     - Failure mode "order file drift": after each action the id lives in
 *       exactly one order file for staged-bound moves (staged-order only),
 *       and in neither order file after remove (the slice leaves the
 *       pipeline entirely) — never both, never a stale queue-order entry.
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

function sliceFile(id, status, body = '## Goal\n\nOriginal body\n') {
  return `---\nid: "${id}"\ntitle: "Queue detail ${id}"\nfrom: obrien\nto: rom\npriority: normal\ncreated: "2026-06-06T00:00:00.000Z"\nstatus: "${status}"\ndepends_on: "042"\n---\n\n${body}`;
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

  const mod = new Module('patched-dashboard-server-j-queue-detail');
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

function orderMembership(id) {
  return {
    inQueue: readOrder(queueOrderPath).includes(id),
    inStaged: readOrder(stagedOrderPath).includes(id),
  };
}

function registerEventsFor(id) {
  return fs.readFileSync(registerPath, 'utf8')
    .trim().split('\n').filter(Boolean).map(JSON.parse)
    .filter(ev => String(ev.slice_id) === String(id));
}

function seedQueued(id, opts = {}) {
  const suffix = opts.suffix || 'QUEUED';
  const filePath = path.join(queueDir, `${id}-${suffix}.md`);
  fs.writeFileSync(filePath, opts.raw || sliceFile(id, suffix === 'PENDING' ? 'PENDING' : 'QUEUED'), 'utf8');
  const order = readOrder(queueOrderPath);
  if (!order.includes(id)) order.push(id);
  fs.writeFileSync(queueOrderPath, JSON.stringify(order), 'utf8');
  return filePath;
}

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j-queue-detail-controls-server-'));
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

// ── Steps 3-4 / Outcome 1: Save edits preserves frontmatter ────────────────

test('J-queue-detail-controls slice-100-ac-3 — PATCH /api/queue/:id/content preserves frontmatter and replaces only the body', async () => {
  const id = '99101';
  const filePath = seedQueued(id);

  const res = await request('PATCH', `/api/queue/${id}/content`, { body: '## Goal\n\nUpdated by operator before dispatch.\n' });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  const updated = fs.readFileSync(filePath, 'utf8');
  const meta = parseFrontmatter(updated);
  assert.ok(meta, 'saved file must still open with a parseable frontmatter block');
  // Outcome 1: id, status, ownership, priority, and dependency fields retained
  assert.equal(meta.id, id);
  assert.equal(meta.status, 'QUEUED');
  assert.equal(meta.from, 'obrien');
  assert.equal(meta.to, 'rom');
  assert.equal(meta.priority, 'normal');
  assert.equal(meta.depends_on, '042');
  assert.match(updated, /Updated by operator before dispatch/);
  assert.doesNotMatch(updated, /Original body/);
});

test('J-queue-detail-controls slice-100-ac-3 — PATCH content also edits a PENDING queue file without losing frontmatter', async () => {
  // Precondition in the journey: the slice may live as {id}-QUEUED.md or {id}-PENDING.md
  const id = '99102';
  const filePath = seedQueued(id, { suffix: 'PENDING' });

  const res = await request('PATCH', `/api/queue/${id}/content`, { body: 'Edited pending body.\n' });

  assert.equal(res.status, 200);
  const updated = fs.readFileSync(filePath, 'utf8');
  const meta = parseFrontmatter(updated);
  assert.equal(meta.id, id);
  assert.equal(meta.to, 'rom');
  assert.equal(meta.depends_on, '042');
  assert.match(updated, /Edited pending body/);
});

test('J-queue-detail-controls slice-100-ac-3 — PATCH content with missing body returns 400 and leaves the file unchanged', async () => {
  const id = '99103';
  const filePath = seedQueued(id);
  const beforeRaw = fs.readFileSync(filePath, 'utf8');

  const res = await request('PATCH', `/api/queue/${id}/content`, {});

  assert.equal(res.status, 400);
  assert.equal(fs.readFileSync(filePath, 'utf8'), beforeRaw, 'a rejected save must not touch the slice file');
});

test('J-queue-detail-controls slice-100-ac-3 — PATCH content on a file with broken frontmatter returns 400 instead of writing a malformed file', async () => {
  // Failure mode "Save edits strips frontmatter": if the delimiter parse
  // fails, the journey demands a 400 rather than a write that loses routing
  // metadata.
  const id = '99104';
  const raw = `---\nid: "${id}"\nstatus: "QUEUED"\n\nNo closing delimiter here.\n`;
  const filePath = seedQueued(id, { raw });
  const beforeRaw = fs.readFileSync(filePath, 'utf8');

  const res = await request('PATCH', `/api/queue/${id}/content`, { body: 'attempted overwrite' });

  assert.equal(res.status, 400);
  assert.equal(fs.readFileSync(filePath, 'utf8'), beforeRaw, 'no malformed write may occur');
});

// ── Step 5a / Outcome 2: Un-approve ─────────────────────────────────────────

test('J-queue-detail-controls slice-99111-ac-2 — POST /api/slice/:id/unapprove moves slice to staged STAGED, updates both order files, emits slice-unapproved', async () => {
  const id = '99111';
  seedQueued(id);

  const res = await request('POST', `/api/slice/${id}/unapprove`, {});

  assert.equal(res.status, 200);
  assert.equal(fs.existsSync(path.join(queueDir, `${id}-QUEUED.md`)), false, 'queued file must leave the queue');
  const stagedPath = path.join(stagedDir, `${id}-STAGED.md`);
  assert.equal(fs.existsSync(stagedPath), true, 'slice must land in bridge/staged/{id}-STAGED.md');
  const meta = parseFrontmatter(fs.readFileSync(stagedPath, 'utf8'));
  assert.equal(meta.status, 'STAGED');
  assert.equal(meta.id, id, 'frontmatter id survives the move');
  assert.equal(meta.to, 'rom', 'routing metadata survives the move');

  // Order-file drift failure mode: id in exactly one order file (staged)
  const membership = orderMembership(id);
  assert.equal(membership.inQueue, false, 'queue-order.json must drop the id');
  assert.equal(membership.inStaged, true, 'staged-order.json must gain the id');

  const events = registerEventsFor(id);
  assert.ok(events.some(ev => ev.event === 'slice-unapproved'), 'register must record slice-unapproved');
});

// ── Step 5b / Outcome 3: Return to O'Brien ──────────────────────────────────

test("J-queue-detail-controls slice-99112-ac-3 — POST /api/queue/:id/return-to-stage creates NEEDS_APENDMENT staged slice with apendment_note and emits returned_to_stage", async () => {
  const id = '99112';
  seedQueued(id);

  const res = await request('POST', `/api/queue/${id}/return-to-stage`, { note: "Needs O'Brien rewrite" });

  assert.equal(res.status, 200);
  assert.equal(res.body.action, 'returned_to_stage');
  assert.equal(fs.existsSync(path.join(queueDir, `${id}-QUEUED.md`)), false, 'queued file must leave the queue');
  const stagedPath = path.join(stagedDir, `${id}-NEEDS_APENDMENT.md`);
  assert.equal(fs.existsSync(stagedPath), true, 'slice must land in bridge/staged/{id}-NEEDS_APENDMENT.md');
  const meta = parseFrontmatter(fs.readFileSync(stagedPath, 'utf8'));
  assert.equal(meta.status, 'NEEDS_APENDMENT');
  assert.equal(meta.apendment_note, "Needs O'Brien rewrite");
  assert.equal(meta.id, id, 'frontmatter id survives the move');

  // Order-file drift failure mode: id in exactly one order file (staged)
  const membership = orderMembership(id);
  assert.equal(membership.inQueue, false, 'queue-order.json must drop the id');
  assert.equal(membership.inStaged, true, 'staged-order.json must gain the id');

  const events = registerEventsFor(id);
  assert.ok(events.some(ev => ev.event === 'returned_to_stage'), 'register must record returned_to_stage');
});

test("J-queue-detail-controls slice-99113-ac-3 — return-to-stage default note uses O'Brien/staged-return vocabulary, never the obsolete role", async () => {
  // Failure mode "Wrong crew vocabulary": user-facing text and new events
  // must use O'Brien/staged-return language.
  const id = '99113';
  seedQueued(id);

  const res = await request('POST', `/api/queue/${id}/return-to-stage`, {});

  assert.equal(res.status, 200);
  const staged = fs.readFileSync(path.join(stagedDir, `${id}-NEEDS_APENDMENT.md`), 'utf8');
  const meta = parseFrontmatter(staged);
  assert.ok(meta.apendment_note && meta.apendment_note.length > 0, 'a default amendment note must be recorded');
  assert.match(meta.apendment_note, /O'Brien/, "default note speaks O'Brien language");

  const obsoleteRole = String.fromCharCode(75, 105, 114, 97); // legacy crew name, kept out of source
  assert.ok(!staged.includes(obsoleteRole), 'staged file must not mention the obsolete role');
  const events = registerEventsFor(id);
  const ev = events.find(e => e.event === 'returned_to_stage');
  assert.ok(ev, 'register must record returned_to_stage');
  assert.ok(!JSON.stringify(ev).includes(obsoleteRole), 'register event must not mention the obsolete role');
});

// ── Step 5c / Outcome 4: Remove from queue ──────────────────────────────────

test('J-queue-detail-controls slice-99114-ac-4 — POST /api/queue/:id/remove archives the queued file into trash, drops the order entry, emits slice-archived-from-queue', async () => {
  const id = '99114';
  seedQueued(id);

  const res = await request('POST', `/api/queue/${id}/remove`, {});

  assert.equal(res.status, 200);
  assert.equal(fs.existsSync(path.join(queueDir, `${id}-QUEUED.md`)), false, 'queued file must leave the queue');
  const trashed = fs.readdirSync(trashDir).filter(f => f.startsWith(`${id}-QUEUED.md`));
  assert.equal(trashed.length, 1, 'queued markdown must be archived into bridge/trash/');
  const archived = fs.readFileSync(path.join(trashDir, trashed[0]), 'utf8');
  assert.match(archived, /Original body/, 'archived file keeps the slice content');

  // Order-file drift failure mode: a removed slice leaves the pipeline, so
  // its id must appear in NEITHER order file — a stale queue-order entry is
  // exactly the drift the journey warns about.
  const membership = orderMembership(id);
  assert.equal(membership.inQueue, false, 'queue-order.json must drop the id');
  assert.equal(membership.inStaged, false, 'a removed slice must not leak into staged-order.json');

  const events = registerEventsFor(id);
  assert.ok(events.some(ev => ev.event === 'slice-archived-from-queue'), 'register must record slice-archived-from-queue');
});

// ── Outcome 5: race protection against active dispatch ─────────────────────

test('J-queue-detail-controls slice-99115-ac-5 — all three destructive actions return 409 and leave the queued file untouched while heartbeat owns the slice', async () => {
  const id = '99115';
  const filePath = seedQueued(id);
  const beforeRaw = fs.readFileSync(filePath, 'utf8');
  const beforeQueueOrder = fs.readFileSync(queueOrderPath, 'utf8');
  const beforeStagedOrder = fs.readFileSync(stagedOrderPath, 'utf8');
  fs.writeFileSync(heartbeatPath, JSON.stringify({ current_slice: id }), 'utf8');

  try {
    const attempts = [
      await request('POST', `/api/slice/${id}/unapprove`, {}),
      await request('POST', `/api/queue/${id}/return-to-stage`, { note: 'should not move' }),
      await request('POST', `/api/queue/${id}/remove`, {}),
    ];

    for (const res of attempts) {
      assert.equal(res.status, 409, 'destructive action on the active slice must be rejected');
      assert.equal(res.body.error, 'already-picked-up');
    }

    assert.equal(fs.readFileSync(filePath, 'utf8'), beforeRaw, 'queued file must remain in place, byte-identical');
    assert.equal(fs.existsSync(path.join(stagedDir, `${id}-STAGED.md`)), false);
    assert.equal(fs.existsSync(path.join(stagedDir, `${id}-NEEDS_APENDMENT.md`)), false);
    assert.equal(fs.readdirSync(trashDir).filter(f => f.startsWith(`${id}-`)).length, 0, 'nothing moved to trash');
    assert.equal(fs.readFileSync(queueOrderPath, 'utf8'), beforeQueueOrder, 'queue-order.json unchanged');
    assert.equal(fs.readFileSync(stagedOrderPath, 'utf8'), beforeStagedOrder, 'staged-order.json unchanged');
    assert.deepEqual(registerEventsFor(id), [], 'no register events for a blocked action');
  } finally {
    fs.writeFileSync(heartbeatPath, JSON.stringify({ current_slice: null }), 'utf8');
  }
});
