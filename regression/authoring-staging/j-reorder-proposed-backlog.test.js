'use strict';

/**
 * Journey: reorder the proposed backlog by dragging (slice 371)
 * Category: Authoring & Staging
 *
 * The Proposed Improvement list is the delivery plan. Before this slice the operator could
 * only reorder Approved Work Orders; proposals rendered with a locked handle and
 * draggable="false", so the only way to change the plan was hand-editing
 * bridge/staged-order.json. Dragging is SEQUENCE ONLY — it never promotes a proposal and
 * never carries a row across the divider between the two sections.
 *
 * What is pinned here, and why at this tier:
 *   - The drag GATE and the drop HANDLERS are real code lifted out of
 *     dashboard/lcars-dashboard.html and run in a vm sandbox against stub rows. They are
 *     plain decision logic over dataset attributes, so they are worth pinning in the fast
 *     suite: a truth table over every rowState, and the exact refusal on a cross-section
 *     pair. Extraction is by function name — a rename fails loudly rather than silently
 *     guarding nothing.
 *   - The persistence contract (POST /api/staged/order) and the invariant that persisting
 *     an order touches no slice file and writes no register event run against the real
 *     dashboard server handlers in a tmp root.
 *   - GET /api/bridge must report a freshly written staged order on the very next request.
 *     buildBridgeData() is cached, and a drag-reorder rewrites ONLY the order file: without
 *     that file in the cache key the operator drags a row, the POST succeeds, and the next
 *     poll or page reload replays the pre-drag order.
 *
 * Browser-only halves (the grab cursor, the drop highlight, the rendered row sequence, the
 * survives-a-reload journey end to end) are guarded in e2e/staged-reorder.spec.js.
 *
 * Fixture isolation (#99992 rule): the server runs inside an os.tmpdir() root with
 * REPO_ROOT rewritten; live bridge/ is never touched.
 *
 */

// @ac-hash: slice-371-ac-1 sha256:1fac0d587e3eed45a1eee71c3e3486504826cdbbabcfa6d208a70d812a0bb1cd
// @ac-hash: slice-371-ac-2 sha256:b0c0d871210672c41213ff8f7f1d6279befbf75eeb18ae26c113897b43aeaf6a
// @ac-hash: slice-371-ac-3 sha256:9569b7d08648d7542c1c79c217f8b29dfde1f836b629a5607a5f330751b42c8d
// @ac-hash: slice-371-ac-4 sha256:2a603e6096184a531f08ce883abd00fbcefb5eff873b279edc167e6a4d7c5d02
// @ac-hash: slice-371-ac-5 sha256:76bdc2652f6d6eb564cc64690b0c983e8515feede0a2357b0631c56fbb9b6e8f
// @ac-hash: slice-371-ac-6 sha256:e88e5111d0f9835d7f3ca13a31d855588575e3c02a78a2eca07824b733f880fe

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const Module = require('node:module');

const SERVER_SRC = path.resolve(__dirname, '..', '..', 'dashboard', 'server.js');
const DASHBOARD_HTML = path.resolve(__dirname, '..', '..', 'dashboard', 'lcars-dashboard.html');

const HTML = fs.readFileSync(DASHBOARD_HTML, 'utf8');

// ── Extracting the real frontend logic ──────────────────────────────────────
// The dashboard is one HTML file, so its functions cannot be require()d. These helpers
// lift a named function (or an anchored block) out by brace matching and hand it to a vm
// sandbox, so the assertions below run the SHIPPED code rather than matching its text.

function balancedFrom(src, startIdx, what) {
  const open = src.indexOf('{', startIdx);
  assert.notEqual(open, -1, `could not find the body of ${what} in lcars-dashboard.html`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(startIdx, i + 1);
  }
  assert.fail(`unbalanced braces while extracting ${what} from lcars-dashboard.html`);
}

function extractFunction(name) {
  const at = HTML.indexOf(`function ${name}(`);
  assert.notEqual(at, -1, `lcars-dashboard.html no longer defines ${name}() — this guard needs rewiring`);
  return balancedFrom(HTML, at, `${name}()`);
}

// renderQueueRow's drag gate: the rowState flags through the end of the enabling `if`.
function extractDragGate() {
  const start = HTML.indexOf('const rowState = row.rowState;');
  assert.notEqual(start, -1, 'renderQueueRow no longer derives rowState — this guard needs rewiring');
  const anchor = HTML.indexOf("draggable = 'true';", start);
  assert.notEqual(anchor, -1, 'renderQueueRow no longer sets draggable="true" for any row');
  const end = HTML.indexOf('}', anchor);
  assert.notEqual(end, -1, 'unbalanced drag-gate block in renderQueueRow');
  return HTML.slice(start, end + 1);
}

const DRAG_GATE = extractDragGate();

// Run the gate for one row → { handleClass, draggable } exactly as renderQueueRow would.
// The result is rebuilt in this realm: values that cross a vm boundary keep the sandbox's
// prototypes, which deepEqual reports as unequal even when every property matches.
function gateFor(row) {
  const r = vm.runInNewContext(`${DRAG_GATE}\n({ handleClass, draggable })`, { row });
  return { handleClass: r.handleClass, draggable: r.draggable };
}

// Same reason: an order array rebuilt inside onDrop belongs to the sandbox realm.
const here = (arr) => [...arr];

const ACTIVE = { handleClass: 'active', draggable: 'true' };
const LOCKED = { handleClass: 'locked', draggable: 'false' };

// ── A sandbox that runs onDragOver/onDrop against stub rows ─────────────────

function makeDragHarness({ rows, queueOrder = [], stagedOrder = [], stagedItems = [] }) {
  const posts = [];
  const el = (row) => ({
    dataset: { id: row.id, state: row.state, apendment: String(!!row.apendment) },
    classList: { add() {}, remove() {} },
  });
  const ctx = {
    dragSrcId: null,
    cachedQueueOrder: [...queueOrder],
    cachedStagedOrder: [...stagedOrder],
    cachedStagedItems: stagedItems.map(s => ({ ...s })),
    renderQueueList() { ctx.renders++; },
    renders: 0,
    fetch(url, opts) {
      posts.push({ url, body: JSON.parse(opts.body) });
      return Promise.resolve({ ok: true });
    },
    document: {
      querySelector(sel) {
        const m = sel.match(/data-id="([^"]*)"/);
        const row = m && rows.find(r => r.id === m[1]);
        return row ? el(row) : null;
      },
    },
  };
  const api = vm.runInNewContext(
    `${extractFunction('onDragOver')}\n${extractFunction('onDrop')}\n({ onDragOver, onDrop })`, ctx);

  const event = (row) => {
    const ev = {
      prevented: false,
      preventDefault() { ev.prevented = true; },
      currentTarget: el(row),
      dataTransfer: {},
    };
    return ev;
  };

  // Drag `srcId` onto `targetId` the way the browser does: dragover marks (or refuses)
  // the drop target, then drop commits. Returns whether the target was accepted.
  function drag(srcId, targetId) {
    const target = rows.find(r => r.id === targetId);
    ctx.dragSrcId = srcId;
    const over = event(target);
    api.onDragOver(over);
    api.onDrop(event(target));
    ctx.dragSrcId = null;
    return over.prevented;
  }

  return { ctx, posts, drag };
}

const STAGED_ROWS = [
  { id: '9101', state: 'STAGED' },
  { id: '9102', state: 'STAGED' },
  { id: '9103', state: 'STAGED' },
  { id: '9104', state: 'NEEDS_APENDMENT' },
  { id: '5001', state: 'QUEUED' },
  { id: '5002', state: 'QUEUED', apendment: true },
];
const STAGED_ITEMS = [
  { id: '9101', status: 'STAGED' },
  { id: '9102', status: 'STAGED' },
  { id: '9103', status: 'STAGED' },
  { id: '9104', status: 'NEEDS_APENDMENT' },
];

const proposedHarness = (over) => makeDragHarness({
  rows: STAGED_ROWS,
  stagedOrder: ['9101', '9102', '9103'],
  stagedItems: STAGED_ITEMS,
  queueOrder: ['5001'],
  ...over,
});

// ── The drag gate: which rows the operator may grab ─────────────────────────

test('slice-371-ac-1 a proposed row renders with a live drag handle, on the same terms an approved row does', () => {
  assert.deepEqual(gateFor({ rowState: 'STAGED', isApendment: false }), ACTIVE,
    'a proposed slice must be draggable — reordering the backlog is the whole point of the list');
  assert.deepEqual(gateFor({ rowState: 'QUEUED', isApendment: false }), ACTIVE,
    'approved work orders keep the handle they already had');
});

test('slice-371-ac-3 amendment rows keep the locked affordance in both flavours', () => {
  assert.deepEqual(gateFor({ rowState: 'NEEDS_APENDMENT', isApendment: false }), LOCKED,
    'a proposal sent back for amendment is pinned: locked handle, not draggable');
  assert.deepEqual(gateFor({ rowState: 'QUEUED', isApendment: true }), LOCKED,
    'an approved amendment is pinned to the head of its section and stays locked');
});

test('slice-371-ac-6 no row outside the two reorderable sections became draggable', () => {
  for (const rowState of ['IN_PROGRESS', 'DONE', 'ERROR']) {
    assert.deepEqual(gateFor({ rowState, isApendment: false }), LOCKED,
      `${rowState} rows are not reorderable and must keep the locked handle`);
  }
});

// ── The drop handlers: what a drag may and may not do ───────────────────────

test('slice-371-ac-1 dropping a proposal onto another proposal moves it ahead and persists the sequence', () => {
  const h = proposedHarness();
  assert.equal(h.drag('9103', '9101'), true, 'a same-section pair must be accepted as a drop target');

  assert.deepEqual(here(h.ctx.cachedStagedOrder), ['9103', '9101', '9102'],
    'the dragged proposal lands immediately before the row it was dropped on');
  assert.equal(h.posts.length, 1, 'one reorder, one POST');
  assert.equal(h.posts[0].url, '/api/staged/order',
    'the new sequence is persisted to the staged order endpoint, not held client-side');
  assert.deepEqual(here(h.posts[0].body.order), ['9103', '9101', '9102'], 'carrying the new sequence');
});

test('slice-371-ac-1 proposals missing from staged-order.json are backfilled, never dropped', () => {
  // staged-order.json is a PARTIAL list: 9102/9103 render but are not in it yet.
  const h = proposedHarness({ stagedOrder: ['9101'] });
  h.drag('9103', '9101');

  assert.deepEqual(here(h.posts[0].body.order).sort(), ['9101', '9102', '9103'],
    'every currently-proposed id survives the reorder — dragging one row must not orphan the rest');
  assert.deepEqual(here(h.posts[0].body.order), ['9103', '9101', '9102'],
    'and the backfilled ids keep their rendered positions behind the dragged row');
});

test('slice-371-ac-4 a cross-section pair is refused as a drop target and persists nothing', () => {
  for (const [src, target] of [['9101', '5001'], ['5001', '9101']]) {
    const h = proposedHarness();
    assert.equal(h.drag(src, target), false,
      `${src} → ${target} crosses the divider: dragover must not mark it a legal drop target`);
    assert.deepEqual(h.posts, [], 'a refused drop must not POST an order anywhere');
    assert.deepEqual(here(h.ctx.cachedStagedOrder), ['9101', '9102', '9103'], 'the proposed order is untouched');
    assert.deepEqual(here(h.ctx.cachedQueueOrder), ['5001'], 'the approved order is untouched');
  }
});

test('slice-371-ac-3 a pinned amendment row is refused as a drop target too', () => {
  const h = proposedHarness();
  assert.equal(h.drag('9101', '9104'), false,
    'NEEDS_APENDMENT is its own rowState, so dropping a proposal onto it is a cross-section pair');
  assert.deepEqual(h.posts, []);
  assert.deepEqual(here(h.ctx.cachedStagedOrder), ['9101', '9102', '9103']);

  const q = proposedHarness();
  assert.equal(q.drag('5001', '5002'), false, 'the pinned approved amendment is not a drop target either');
  assert.deepEqual(q.posts, []);
});

test('slice-371-ac-5 reordering proposals never touches the approved queue or its order', () => {
  const h = proposedHarness();
  h.drag('9102', '9101');

  assert.deepEqual(here(h.ctx.cachedQueueOrder), ['5001'],
    'a proposed reorder must leave the approved sequence alone — reordering is not approving');
  assert.equal(h.posts.every(p => p.url === '/api/staged/order'), true,
    'the only endpoint a proposed reorder may call is the staged order endpoint');
  assert.equal(h.posts.some(p => /approve/.test(p.url)), false,
    'no drag may reach an approval endpoint');
});

test('slice-371-ac-6 reordering approved work orders still persists to the queue order endpoint', () => {
  const rows = [{ id: '5001', state: 'QUEUED' }, { id: '5003', state: 'QUEUED' }];
  const q = makeDragHarness({ rows, queueOrder: ['5001', '5003'], stagedOrder: ['9101'], stagedItems: STAGED_ITEMS });

  assert.equal(q.drag('5003', '5001'), true, 'two approved rows are still a legal pair');
  assert.deepEqual(here(q.ctx.cachedQueueOrder), ['5003', '5001'], 'the approved reorder still applies');
  assert.equal(q.posts.length, 1, 'one reorder, one POST');
  assert.equal(q.posts[0].url, '/api/queue/order', 'and still persists to /api/queue/order exactly as before');
  assert.deepEqual(here(q.posts[0].body.order), ['5003', '5001'], 'carrying the new approved sequence');
  assert.deepEqual(here(q.ctx.cachedStagedOrder), ['9101'], 'the proposed order is not rewritten as a side effect');
});

// ── The server: persistence, and the invariant that it persists ONLY order ──

let tmpRoot;
let server;
let port;
let stagedDir;
let queueDir;
let registerPath;
let stagedOrderPath;

function compileServer(root) {
  const dashboardDir = path.join(root, 'dashboard');
  const lifecyclePath = path.join(root, 'bridge', 'lifecycle-translate.js');
  fs.writeFileSync(lifecyclePath,
    "'use strict';\nmodule.exports = { translateEvent(ev) { return ev; }, resetDedupeState() {} };\n", 'utf8');
  fs.writeFileSync(path.join(dashboardDir, 'lcars-dashboard.html'), '<html></html>', 'utf8');
  fs.writeFileSync(path.join(dashboardDir, 'tokens.css'), '', 'utf8');

  const src = fs.readFileSync(SERVER_SRC, 'utf8')
    .replace(/const REPO_ROOT\s*=[\s\S]*?path\.resolve\(__dirname,\s*'\.\.'\);/,
      `const REPO_ROOT = ${JSON.stringify(root)};`)
    .replace(/const DASHBOARD\s*=\s*path\.join\(__dirname,\s*'lcars-dashboard\.html'\);/,
      `const DASHBOARD = ${JSON.stringify(path.join(dashboardDir, 'lcars-dashboard.html'))};`)
    .replace(/const TOKENS_CSS\s*=\s*path\.join\(__dirname,\s*'tokens\.css'\);/,
      `const TOKENS_CSS = ${JSON.stringify(path.join(dashboardDir, 'tokens.css'))};`)
    .replace(/require\(path\.join\(REPO_ROOT,\s*'bridge',\s*'lifecycle-translate'\)\)/,
      `require(${JSON.stringify(lifecyclePath)})`)
    .replace(/if \(require\.main === module\)/, 'if (false)')
    .replace(/module\.exports = \{ /, 'module.exports = { server, ');

  const mod = new Module('patched-dashboard-server-j-reorder-proposed-backlog');
  mod.paths = module.paths;
  mod._compile(src, path.join(dashboardDir, 'server.js'));
  return mod.exports.server;
}

function request(method, urlPath, payload) {
  return new Promise((resolve, reject) => {
    const body = payload == null ? '' : JSON.stringify(payload);
    const req = http.request({
      hostname: '127.0.0.1', port, path: urlPath, method,
      headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {},
    }, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
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

const stagedFile = (id) =>
  `---\nid: "${id}"\ntitle: "Proposal ${id}"\nfrom: obrien\nto: rom\npriority: normal\n`
  + `created: "2026-09-02T00:00:00.000Z"\nstatus: "STAGED"\n---\n\n## Goal\n\nProposal ${id}.\n`;

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j-reorder-proposed-'));
  stagedDir = path.join(tmpRoot, 'bridge', 'staged');
  queueDir = path.join(tmpRoot, 'bridge', 'queue');
  registerPath = path.join(tmpRoot, 'bridge', 'register.jsonl');
  stagedOrderPath = path.join(tmpRoot, 'bridge', 'staged-order.json');

  for (const dir of [stagedDir, queueDir, path.join(tmpRoot, 'bridge', 'trash'),
    path.join(tmpRoot, 'bridge', 'control'), path.join(tmpRoot, 'bridge', 'errors'),
    path.join(tmpRoot, 'bridge', 'state'), path.join(tmpRoot, 'dashboard')]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(registerPath, '', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'heartbeat.json'), JSON.stringify({ current_slice: null }), 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'queue-order.json'), '[]', 'utf8');
  fs.writeFileSync(stagedOrderPath, JSON.stringify(['9101', '9102', '9103']), 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'sessions.jsonl'), '', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'first-output.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'nog-active.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'state', 'branch-state.json'), '{}', 'utf8');
  for (const id of ['9101', '9102', '9103']) {
    fs.writeFileSync(path.join(stagedDir, `${id}-STAGED.md`), stagedFile(id), 'utf8');
  }

  server = compileServer(tmpRoot);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});

after(async () => {
  if (server) await new Promise(r => server.close(r));
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('slice-371-ac-2 POST /api/staged/order persists exactly the submitted sequence', async () => {
  const res = await request('POST', '/api/staged/order', { order: ['9103', '9101', '9102'] });

  assert.equal(res.status, 200, 'the staged order endpoint must accept a reorder');
  assert.deepEqual(res.body, { ok: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(stagedOrderPath, 'utf8')), ['9103', '9101', '9102'],
    'staged-order.json holds the dragged sequence verbatim');
});

test('slice-371-ac-2 GET /api/bridge reports the new order on the very next request', async () => {
  // A drag rewrites ONLY the order file. If the bridge-data cache does not key on it, the
  // reload after a reorder replays the pre-drag order and the drag appears to spring back.
  const before = await request('GET', '/api/bridge');
  assert.deepEqual(before.body.stagedOrder, ['9103', '9101', '9102'], 'baseline: cache is warm on this order');

  await request('POST', '/api/staged/order', { order: ['9102', '9103', '9101'] });

  const after = await request('GET', '/api/bridge');
  assert.deepEqual(after.body.stagedOrder, ['9102', '9103', '9101'],
    'the reordered sequence must be visible immediately — nothing else on disk changed to invalidate the cache');
});

test('slice-371-ac-5 persisting an order moves no slice file and writes no register event', async () => {
  const stagedBefore = fs.readdirSync(stagedDir).sort();
  const queueBefore = fs.readdirSync(queueDir).sort();
  const registerBefore = fs.readFileSync(registerPath, 'utf8');

  await request('POST', '/api/staged/order', { order: ['9101', '9103', '9102'] });

  assert.deepEqual(fs.readdirSync(stagedDir).sort(), stagedBefore,
    'every proposal stays in bridge/staged/ — a reorder is not an approval');
  assert.deepEqual(fs.readdirSync(queueDir).sort(), queueBefore,
    'nothing appears in bridge/queue/ as a result of a reorder');
  assert.equal(fs.readFileSync(registerPath, 'utf8'), registerBefore,
    'no HUMAN_APPROVAL (or any other) register event is emitted by a reorder');

  const staged = await request('GET', '/api/bridge/staged');
  assert.deepEqual(staged.body.map(s => s.status), ['STAGED', 'STAGED', 'STAGED'],
    'all three proposals are still STAGED after the reorder');
});

test('slice-371-ac-2 a malformed reorder payload is rejected and leaves staged-order.json intact', async () => {
  const before = fs.readFileSync(stagedOrderPath, 'utf8');

  const res = await request('POST', '/api/staged/order', { order: 'not-an-array' });

  assert.equal(res.status, 400, 'a non-array order must be refused, not written');
  assert.equal(fs.readFileSync(stagedOrderPath, 'utf8'), before,
    'staged-order.json is never left partially written or corrupted by a bad payload');
});
