'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');

const SERVER_SRC = path.resolve(__dirname, '..', 'dashboard', 'server.js');

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
  return `---\nid: "${id}"\ntitle: "Test ${id}"\nfrom: obrien\nto: rom\npriority: normal\ncreated: "2026-06-06T00:00:00.000Z"\nstatus: "${status}"\n---\n\n${body}`;
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

  const mod = new Module('patched-dashboard-server');
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
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lob-api-queue-'));
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

test('slice-100-ac-3 PATCH /api/queue/:id/content preserves frontmatter and updates queued body', async () => {
  const id = '99001';
  const filePath = path.join(queueDir, `${id}-QUEUED.md`);
  fs.writeFileSync(filePath, sliceFile(id, 'QUEUED'), 'utf8');

  const res = await request('PATCH', `/api/queue/${id}/content`, { body: '## Goal\n\nUpdated body\n' });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  const updated = fs.readFileSync(filePath, 'utf8');
  assert.match(updated, /id: "99001"/);
  assert.match(updated, /status: "QUEUED"/);
  assert.match(updated, /## Goal\n\nUpdated body/);
  assert.doesNotMatch(updated, /Original body/);
});

test('slice-100-ac-3 PATCH /api/queue/:id/content rejects missing body', async () => {
  const id = '99004';
  fs.writeFileSync(path.join(queueDir, `${id}-QUEUED.md`), sliceFile(id, 'QUEUED'), 'utf8');

  const res = await request('PATCH', `/api/queue/${id}/content`, {});

  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'Missing required field: body');
});

test('slice-100-ac-5 POST /api/queue/:id/return-to-stage moves queued slice to staged needs-apendment', async () => {
  const id = '99002';
  fs.writeFileSync(path.join(queueDir, `${id}-QUEUED.md`), sliceFile(id, 'QUEUED'), 'utf8');
  fs.writeFileSync(queueOrderPath, JSON.stringify([id, '111']), 'utf8');
  fs.writeFileSync(stagedOrderPath, JSON.stringify(['222']), 'utf8');

  const res = await request('POST', `/api/queue/${id}/return-to-stage`, { note: "Needs O'Brien rewrite" });

  assert.equal(res.status, 200);
  assert.equal(res.body.action, 'returned_to_stage');
  assert.equal(fs.existsSync(path.join(queueDir, `${id}-QUEUED.md`)), false);
  const stagedPath = path.join(stagedDir, `${id}-NEEDS_APENDMENT.md`);
  assert.equal(fs.existsSync(stagedPath), true);
  const staged = fs.readFileSync(stagedPath, 'utf8');
  assert.match(staged, /status: "NEEDS_APENDMENT"/);
  assert.match(staged, /apendment_note: "Needs O'Brien rewrite"/);
  assert.deepEqual(JSON.parse(fs.readFileSync(queueOrderPath, 'utf8')), ['111']);
  assert.deepEqual(JSON.parse(fs.readFileSync(stagedOrderPath, 'utf8')), ['222', id]);
  assert.ok(fs.readdirSync(trashDir).some(file => file.startsWith(`${id}-QUEUED.md.returned-to-stage-`)));

  const events = fs.readFileSync(registerPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  assert.ok(events.some(ev => ev.event === 'returned_to_stage' && ev.slice_id === id));
});

test('slice-100-ac-5 POST /api/queue/:id/return-to-stage returns 409 when heartbeat owns slice', async () => {
  const id = '99003';
  fs.writeFileSync(path.join(queueDir, `${id}-QUEUED.md`), sliceFile(id, 'QUEUED'), 'utf8');
  fs.writeFileSync(heartbeatPath, JSON.stringify({ current_slice: id }), 'utf8');

  const res = await request('POST', `/api/queue/${id}/return-to-stage`, {});

  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'already-picked-up');
  assert.equal(fs.existsSync(path.join(queueDir, `${id}-QUEUED.md`)), true);
  assert.equal(fs.existsSync(path.join(stagedDir, `${id}-NEEDS_APENDMENT.md`)), false);
});
