'use strict';

/**
 * Journey: J-return-to-stage-truthful (Tier 2 — in-process dashboard server +
 *          the orchestrator's own control-file handler)
 * Category: Direct controls
 *
 * Spec source: slice 370 — "Return to stage must actually return the slice —
 * or say why it cannot."
 *
 * WHY THIS EXISTS: the History row's "Return to stage" button was rendered from
 * the row's PAST outcome and posted to an endpoint that answered 200 the moment
 * it had written a control file. The orchestrator picked the file up afterwards
 * and often refused — ARCHIVED is what every merged slice becomes and was never
 * returnable — logging a warning nobody reads while the operator had already
 * been shown a success animation. Two endpoints served the one user-visible
 * action, each with its own idea of what "return" meant.
 *
 * What this pins (behaviour, not implementation):
 *   - eligibility is decided from where the slice's file sits TODAY, and is the
 *     same answer for the button, the endpoint and the orchestrator's handler;
 *   - a refusal reaches the operator with its reason — synchronously when the
 *     server can decide, and through the register when the orchestrator is the
 *     one that refuses;
 *   - a confirmed return puts the slice on the staged list, and only a
 *     confirmed return is reported as success;
 *   - the History control and the slice-detail control run the same code and
 *     give the same answer for the same slice;
 *   - the active-slice guard (IN_PROGRESS / EVALUATING / IN_REVIEW) still
 *     refuses, and still wins over a stale terminal file beside it.
 *
 * Deliberately NOT asserted (and why):
 *   - browser rendering, hover tooltips and the toast animation: Bashir's e2e
 *     owns the rendered page. The WIRING is asserted here against the shipped
 *     source, because that is what decides whether a control is offered at all;
 *   - the body-recovery search order itself (which trash file wins) — slice 226
 *     owns that; trap 4 only pins that recovery still happens;
 *   - the orchestrator's poll loop: handleReturnToStage is driven directly, the
 *     way the control-file dispatcher drives it.
 *
 * #99992: all state lives in a per-test tmpdir; the orchestrator's queue, staged,
 * trash and register paths are redirected into it. Nothing here touches the live
 * bridge/.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const http   = require('node:http');
const Module = require('node:module');

const REAL_ROOT      = path.resolve(__dirname, '..', '..');
const SERVER_SRC     = path.join(REAL_ROOT, 'dashboard', 'server.js');
const DASHBOARD_SRC  = path.join(REAL_ROOT, 'dashboard', 'lcars-dashboard.html');
const ELIGIBILITY_SRC  = path.join(REAL_ROOT, 'bridge', 'return-to-stage-eligibility.js');
const ORCHESTRATOR_SRC = path.join(REAL_ROOT, 'bridge', 'orchestrator.js');

const orchestrator = require(ORCHESTRATOR_SRC);

let tmpRoot, server, port;
let queueDir, stagedDir, trashDir, controlDir, registerPath, heartbeatPath;

// ── fixture ──────────────────────────────────────────────────────────────────

function sliceFile(id, status, extra = {}) {
  const fm = Object.assign({
    id: String(id),
    title: `Return fixture ${id}`,
    goal: 'Prove the return-to-stage control tells the truth.',
    from: 'obrien',
    to: 'rom',
    priority: 'normal',
    created: '2026-09-04T00:00:00.000Z',
    status,
  }, extra);
  return '---\n'
    + Object.entries(fm).map(([k, v]) => `${k}: "${v}"`).join('\n')
    + '\n---\n\n## Goal\n\nThe original brief body.\n';
}

/** The shape the orchestrator itself writes beside a crashed slice: no brief. */
function errorSidecar(id) {
  return [
    '---',
    `id: "${id}"`,
    `title: "Slice ${id} — crash"`,
    'from: orchestrator',
    'to: chiefobrien',
    'status: ERROR',
    `slice_id: "${id}"`,
    'completed: "2026-09-04T01:00:00.000Z"',
    'reason: "crash"',
    '---',
    '',
    'Error: crash',
  ].join('\n');
}

function writeQueue(id, status, content) {
  const p = path.join(queueDir, `${id}-${status}.md`);
  fs.writeFileSync(p, content ?? sliceFile(id, status), 'utf8');
  return p;
}

function readRegister() {
  try {
    return fs.readFileSync(registerPath, 'utf8').split('\n').filter(l => l.trim()).map(JSON.parse);
  } catch (_) { return []; }
}

function compileServer(root) {
  const dashboardDir = path.join(root, 'dashboard');
  const lifecyclePath = path.join(root, 'bridge', 'lifecycle-translate.js');
  fs.writeFileSync(lifecyclePath, `
'use strict';
module.exports = { translateEvent(ev) { return ev; }, resetDedupeState() {} };
`, 'utf8');
  // The fixture root gets the REAL eligibility module — the point of the slice is
  // that one set of rules answers for every caller, so a stub here would test a
  // second set of rules that ships nowhere.
  fs.writeFileSync(
    path.join(root, 'bridge', 'return-to-stage-eligibility.js'),
    `module.exports = require(${JSON.stringify(ELIGIBILITY_SRC)});\n`,
    'utf8',
  );
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

  const mod = new Module('patched-dashboard-server-j-return-to-stage');
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

before(async () => {
  tmpRoot      = fs.mkdtempSync(path.join(os.tmpdir(), 'j-return-to-stage-'));
  queueDir     = path.join(tmpRoot, 'bridge', 'queue');
  stagedDir    = path.join(tmpRoot, 'bridge', 'staged');
  trashDir     = path.join(tmpRoot, 'bridge', 'trash');
  controlDir   = path.join(tmpRoot, 'bridge', 'control');
  registerPath = path.join(tmpRoot, 'bridge', 'register.jsonl');
  heartbeatPath = path.join(tmpRoot, 'bridge', 'heartbeat.json');

  for (const dir of [queueDir, stagedDir, trashDir, controlDir,
                     path.join(tmpRoot, 'bridge', 'errors'),
                     path.join(tmpRoot, 'bridge', 'state'),
                     path.join(tmpRoot, 'dashboard')]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(registerPath, '', 'utf8');
  fs.writeFileSync(heartbeatPath, JSON.stringify({ current_slice: null }), 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'queue-order.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'staged-order.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'sessions.jsonl'), '', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'first-output.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'nog-active.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'state', 'branch-state.json'), '{}', 'utf8');

  // Point the orchestrator's handler at the same fixture (#99992).
  orchestrator._testSetDirs(queueDir, stagedDir, trashDir);
  orchestrator._testSetRegisterFile(registerPath);

  server = compileServer(tmpRoot);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});

after(async () => {
  if (server) await new Promise(r => server.close(r));
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ── AC-1 ─────────────────────────────────────────────────────────────────────

test('J-return-to-stage-truthful slice-370-ac-1 — the control is offered only where the slice\'s current state can be returned, and otherwise carries the reason it cannot', async () => {
  writeQueue('37101', 'ERROR');
  writeQueue('37102', 'ARCHIVED');
  writeQueue('37103', 'DONE');
  writeQueue('37104', 'PARKED');

  // The live queue does not keep one file per slice — 114 of its 259 ids hold
  // two to five, because each stage writes its own suffix and archiving does not
  // delete the round-level file that preceded it. These are the real shapes, and
  // they are the ones the operator's History page is actually made of.
  writeQueue('37105', 'ACCEPTED'); writeQueue('37105', 'ARCHIVED');  // 65 live ids
  writeQueue('37106', 'ERROR');    writeQueue('37106', 'ARCHIVED');  // 8 live ids
  writeQueue('37107', 'REVIEWED'); writeQueue('37107', 'ARCHIVED');  // 5 live ids
  writeQueue('37108', 'ACCEPTED'); writeQueue('37108', 'DONE'); writeQueue('37108', 'PARKED');

  fs.writeFileSync(registerPath, [
    { ts: '2026-09-04T10:00:00.000Z', event: 'DONE', id: '37101' },
    { ts: '2026-09-04T10:00:01.000Z', event: 'ERROR', id: '37101' },
    { ts: '2026-09-04T10:01:00.000Z', event: 'DONE', id: '37102' },
    { ts: '2026-09-04T10:02:00.000Z', event: 'DONE', id: '37103' },
    { ts: '2026-09-04T10:03:00.000Z', event: 'DONE', id: '37104' },
    { ts: '2026-09-04T10:04:00.000Z', event: 'DONE', id: '37105' },
    { ts: '2026-09-04T10:05:00.000Z', event: 'DONE', id: '37106' },
    { ts: '2026-09-04T10:06:00.000Z', event: 'DONE', id: '37107' },
    { ts: '2026-09-04T10:07:00.000Z', event: 'DONE', id: '37108' },
  ].map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');

  const res = await request('GET', '/api/bridge');
  assert.equal(res.status, 200);
  const rowOf = id => res.body.recent.find(r => String(r.id) === id);

  // The returnable one is offered, with nothing to explain away.
  assert.equal(rowOf('37101').returnable, true, 'an ERROR slice is returnable and the row must say so');
  assert.equal(rowOf('37101').returnReason, null, 'a returnable row carries no refusal reason');

  // A merged slice reads ARCHIVED whatever else its round left on disk. The
  // archive is the newest fact about it; the sibling is the superseded one.
  // Failure mode: the button is drawn from the stale sibling and restages work
  // that is already merged.
  for (const id of ['37105', '37106', '37107']) {
    const row = rowOf(id);
    assert.equal(row.returnable, false,
      `a merged slice with a stale ${id === '37105' ? 'ACCEPTED' : id === '37106' ? 'ERROR' : 'REVIEWED'} file beside its archive must not be offered the control`);
    assert.equal(row.returnState, 'ARCHIVED', 'the archive outranks every file left beside it');
    assert.match(row.returnReason, /already merged/, 'and the row says so in the operator\'s words');
  }

  // Which is a precedence fix, not a blanket refusal: a slice that has NOT been
  // archived still resolves to its round-level state and keeps its control.
  assert.equal(rowOf('37108').returnable, true,
    'an ACCEPTED slice with DONE and PARKED beside it has not been merged and stays returnable');
  assert.equal(rowOf('37108').returnState, 'ACCEPTED');

  // The three that cannot be returned each carry a reason to show the operator.
  for (const [id, state] of [['37102', 'ARCHIVED'], ['37103', 'DONE'], ['37104', 'PARKED']]) {
    const row = rowOf(id);
    assert.equal(row.returnable, false, `a ${state} slice must not be offered the control`);
    assert.match(row.returnReason, /\S/, `a ${state} row must carry a reason`);
    assert.match(row.returnReason, new RegExp(state), `the reason must name the state (${state})`);
  }

  // The rendered control follows that answer: live when returnable, present but
  // disabled and carrying the reason when not. (Rendering is Bashir's; the
  // decision that produces it is asserted here against the shipped page.)
  const html = fs.readFileSync(DASHBOARD_SRC, 'utf8');
  const block = html.slice(html.indexOf('const returnBtn ='), html.indexOf('const returnBtn =') + 900);
  assert.match(block, /c\.returnable/, 'the History control must be gated on the row\'s returnable answer');
  assert.match(block, /disabled title="\$\{escHtml\(returnReason\)\}"/,
    'an ineligible row must render a disabled control carrying the reason (failure mode: a clickable no-op)');
});

// ── AC-2 ─────────────────────────────────────────────────────────────────────

test('J-return-to-stage-truthful slice-370-ac-2 — a refused return is reported with its reason and never as success, whether the server or the orchestrator refuses', async () => {
  // (a) The server can decide: it refuses before anything is written.
  writeQueue('37201', 'ARCHIVED');
  const refused = await request('POST', '/api/bridge/return-to-stage/37201');
  assert.equal(refused.status, 409, 'an impossible return must not answer 2xx');
  assert.notEqual(refused.body.ok, true, 'a refusal must never carry ok:true');
  assert.match(refused.body.reason, /ARCHIVED/, 'the operator must be told which state refused the action');
  assert.equal(fs.existsSync(path.join(queueDir, '37201-ARCHIVED.md')), true, 'a refused return moves nothing');
  assert.equal(fs.readdirSync(controlDir).length, 0, 'a refusal must not hand the orchestrator a doomed request');

  // (b) Only the orchestrator can decide: an ERROR sidecar whose brief cannot be
  // recovered. The server accepts the request, the orchestrator refuses it, and
  // the operator following the request learns the refusal — not "returned".
  writeQueue('37202', 'ERROR', errorSidecar('37202'));
  const accepted = await request('POST', '/api/bridge/return-to-stage/37202');
  assert.equal(accepted.status, 202, 'a handoff to the orchestrator is accepted, not completed');
  assert.equal(accepted.body.outcome, 'pending', 'an accepted request must not claim the return happened');

  const before = await request('GET', `/api/bridge/return-to-stage/37202/status?since=${accepted.body.requested_at}`);
  assert.equal(before.body.outcome, 'pending', 'until the orchestrator acts there is no outcome to report');

  const verdict = orchestrator.handleReturnToStage('37202');
  assert.equal(verdict.ok, false, 'an unrecoverable ERROR sidecar is refused (slice 226 behaviour, unchanged)');

  const after = await request('GET', `/api/bridge/return-to-stage/37202/status?since=${accepted.body.requested_at}`);
  assert.equal(after.status, 200);
  assert.equal(after.body.outcome, 'refused', 'the orchestrator\'s refusal must reach the operator');
  assert.match(after.body.reason, /\S/, 'the refusal must carry the reason, not just a flag');
  assert.equal(
    readRegister().some(e => e.event === 'RETURN_TO_STAGE' && String(e.slice_id) === '37202'), false,
    'a refusal must not be written to the register as a completed return',
  );
});

// ── AC-3 ─────────────────────────────────────────────────────────────────────

test('J-return-to-stage-truthful slice-370-ac-3 — a return that actually happens is confirmed, and the slice is on the staged list', async () => {
  // The slice that never ran: the server returns it and says so in one answer.
  writeQueue('37301', 'QUEUED');
  const sync = await request('POST', '/api/queue/37301/return-to-stage');
  assert.equal(sync.status, 200);
  assert.equal(sync.body.outcome, 'returned', 'a completed return is reported as returned');

  // The slice that ran: confirmation only after the orchestrator has moved it.
  writeQueue('37302', 'ERROR');
  const async_ = await request('POST', '/api/bridge/return-to-stage/37302');
  assert.equal(async_.body.outcome, 'pending');
  const mid = await request('GET', `/api/bridge/return-to-stage/37302/status?since=${async_.body.requested_at}`);
  assert.equal(mid.body.outcome, 'pending', 'nothing is confirmed while the slice is still in the queue');

  const moved = orchestrator.handleReturnToStage('37302');
  assert.equal(moved.ok, true, `orchestrator refused unexpectedly: ${moved.error}`);
  const done = await request('GET', `/api/bridge/return-to-stage/37302/status?since=${async_.body.requested_at}`);
  assert.equal(done.body.outcome, 'returned', 'once the slice has moved, the return is confirmed');

  // A slice whose queue file is live but which also has an OLD staged copy
  // lying around. Eligibility ignores the staged copy (queue wins), so the
  // return is genuinely still pending — and a staged file that predates the
  // request is not evidence that it happened.
  writeQueue('37303', 'ERROR');
  const stale = path.join(stagedDir, '37303-STAGED.md');
  fs.writeFileSync(stale, sliceFile('37303', 'STAGED'), 'utf8');
  const longAgo = new Date('2026-09-01T00:00:00.000Z');
  fs.utimesSync(stale, longAgo, longAgo);

  const pending = await request('POST', '/api/bridge/return-to-stage/37303');
  const stillPending = await request('GET', `/api/bridge/return-to-stage/37303/status?since=${pending.body.requested_at}`);
  assert.equal(stillPending.body.outcome, 'pending',
    'a staged file older than the request must not be reported as a return that just happened');

  const staged = await request('GET', '/api/bridge/staged');
  const stagedIds = staged.body.map(s => String(s.id));
  assert.ok(stagedIds.includes('37301'), 'the returned queued slice must appear on the staged list');
  assert.ok(stagedIds.includes('37302'), 'the returned terminal slice must appear on the staged list');
  assert.equal(fs.existsSync(path.join(queueDir, '37302-ERROR.md')), false, 'the slice must leave the queue');
});

// ── AC-4 ─────────────────────────────────────────────────────────────────────

test('J-return-to-stage-truthful slice-370-ac-4 — the History control and the slice-detail control give the same answer for the same slice', async () => {
  // Refusal: the same slice, posted to both routes, must be refused identically.
  writeQueue('37401', 'ARCHIVED');
  const viaHistory = await request('POST', '/api/bridge/return-to-stage/37401');
  const viaModal   = await request('POST', '/api/queue/37401/return-to-stage');
  assert.equal(viaHistory.status, viaModal.status, 'the two entry points must agree on the status');
  assert.equal(viaHistory.body.reason, viaModal.body.reason, 'the two entry points must give the same reason');

  // Success: two slices in the same state, one down each route, same outcome.
  writeQueue('37402', 'QUEUED');
  writeQueue('37403', 'QUEUED');
  const modalOk   = await request('POST', '/api/queue/37402/return-to-stage');
  const historyOk = await request('POST', '/api/bridge/return-to-stage/37403');
  assert.equal(historyOk.status, modalOk.status, 'the same state must produce the same status on both routes');
  assert.equal(historyOk.body.outcome, modalOk.body.outcome);
  assert.equal(historyOk.body.mode, modalOk.body.mode);
  assert.equal(fs.existsSync(path.join(stagedDir, '37402-NEEDS_APENDMENT.md')), true);
  assert.equal(fs.existsSync(path.join(stagedDir, '37403-NEEDS_APENDMENT.md')), true,
    'the History route must land a queued slice where the modal route lands it');

  // On the page, both controls run the one function — the drift the slice closes.
  const html = fs.readFileSync(DASHBOARD_SRC, 'utf8');
  const modalFn = html.slice(html.indexOf('async function sliceDetailReturnToStage'),
                             html.indexOf('async function sliceDetailReturnToStage') + 500);
  assert.match(modalFn, /await returnToStage\(/,
    'the slice-detail control must run the same returnToStage() the History row runs');
  assert.equal((html.match(/async function returnToStage\(/g) || []).length, 1,
    'there must be exactly one return-to-stage implementation on the page');

  // And behind the page: one table of returnable states, in the module both
  // callers read. A second copy in either consumer is how the button and the
  // action drifted apart in the first place, so it is pinned out of existence.
  const eligibility = fs.readFileSync(ELIGIBILITY_SRC, 'utf8');
  assert.match(eligibility, /const RETURNABLE_STATES\s*=/,
    'the returnable-state table belongs to the shared module');
  for (const [name, src] of [['dashboard/server.js', fs.readFileSync(SERVER_SRC, 'utf8')],
                             ['bridge/orchestrator.js', fs.readFileSync(ORCHESTRATOR_SRC, 'utf8')]]) {
    assert.match(src, /return-to-stage-eligibility/, `${name} must read the shared rules`);
    assert.doesNotMatch(src, /RETURNABLE_(?:STATES|SUFFIXES)\s*=/,
      `${name} must not keep its own copy of the returnable states (failure mode: the two answers drift apart again)`);
  }
});

// ── AC-5 ─────────────────────────────────────────────────────────────────────

test('J-return-to-stage-truthful slice-370-ac-5 — a slice that is in progress, evaluating or in review is still refused', async () => {
  for (const state of ['IN_PROGRESS', 'EVALUATING', 'IN_REVIEW']) {
    const id = `375${state.length}${state.charCodeAt(0)}`;
    writeQueue(id, state);

    const res = await request('POST', `/api/bridge/return-to-stage/${id}`);
    assert.equal(res.status, 409, `${state} must be refused by the endpoint`);
    assert.match(res.body.reason, new RegExp(state), `the refusal must name ${state}`);

    const direct = orchestrator.handleReturnToStage(id);
    assert.equal(direct.ok, false, `${state} must be refused by the orchestrator's own handler`);

    assert.equal(fs.existsSync(path.join(queueDir, `${id}-${state}.md`)), true,
      `${state} slice must stay exactly where it is`);
    assert.equal(fs.existsSync(path.join(stagedDir, `${id}-STAGED.md`)), false,
      `${state} slice must not appear on the staged list`);
  }
});

// ── Traps ────────────────────────────────────────────────────────────────────

test('J-return-to-stage-truthful slice-370-ac-1 trap-1-archived-is-decided-not-guessed — an archived slice is refused everywhere, with a reason that says the work is already merged', async () => {
  // Seeded the way a merged slice actually sits on disk: the archive AND the
  // round-level file that preceded it. Trap 1 says the semantics of returning an
  // archived slice are Philipp's to decide, so this must be refused by every
  // caller — and "refused" has to survive the sibling file, because it is the
  // sibling that made 76 merged rows offer a live button that restaged them.
  writeQueue('37601', 'ACCEPTED');
  writeQueue('37601', 'ARCHIVED');

  // The button's question.
  const eligibility = await request('GET', '/api/bridge/return-to-stage/37601/eligibility');
  assert.equal(eligibility.body.returnable, false);
  assert.equal(eligibility.body.state, 'ARCHIVED',
    'a merged slice must be read as merged, not as whatever its round left beside the archive');
  assert.match(eligibility.body.reason, /already merged/,
    'the reason must say why an archived slice is not returned, not merely that it is not');

  // The endpoint's answer, and the orchestrator's.
  assert.equal((await request('POST', '/api/bridge/return-to-stage/37601')).status, 409);
  assert.equal(orchestrator.handleReturnToStage('37601').ok, false);

  // Nothing was invented: no restage, no new round, no moved file. Both files
  // are still where they were — a refusal that deleted the ACCEPTED file would
  // be the archived-return semantics, implemented by accident.
  assert.equal(fs.existsSync(path.join(queueDir, '37601-ARCHIVED.md')), true);
  assert.equal(fs.existsSync(path.join(queueDir, '37601-ACCEPTED.md')), true,
    'refusing must not consume the round-level file on the way past');
  assert.equal(fs.readdirSync(stagedDir).some(f => f.startsWith('37601-')), false,
    'refusing must not quietly restage the slice under another name');
});

test('J-return-to-stage-truthful slice-370-ac-5 trap-2-active-guard-not-weakened — an active slice is refused even with a returnable file lying beside it', async () => {
  // A crashed round can leave {id}-ERROR.md behind while the retry is running.
  // The guard must win: whichever file the scan happens to see first, a slice
  // that is being built does not move.
  writeQueue('37701', 'ERROR');
  writeQueue('37701', 'IN_PROGRESS');

  const res = await request('POST', '/api/bridge/return-to-stage/37701');
  assert.equal(res.status, 409, 'the active guard must outrank a stale terminal file');
  assert.match(res.body.reason, /IN_PROGRESS/);

  const direct = orchestrator.handleReturnToStage('37701');
  assert.equal(direct.ok, false, 'the orchestrator must refuse it too');
  assert.equal(fs.existsSync(path.join(queueDir, '37701-IN_PROGRESS.md')), true);
  assert.equal(fs.existsSync(path.join(queueDir, '37701-ERROR.md')), true);
  assert.equal(fs.readdirSync(stagedDir).some(f => f.startsWith('37701-')), false);

  // The dispatched-right-now race is refused ahead of any state read.
  writeQueue('37702', 'ERROR');
  fs.writeFileSync(heartbeatPath, JSON.stringify({ current_slice: '37702' }), 'utf8');
  const raced = await request('POST', '/api/bridge/return-to-stage/37702');
  fs.writeFileSync(heartbeatPath, JSON.stringify({ current_slice: null }), 'utf8');
  assert.equal(raced.status, 409);
  assert.equal(raced.body.error, 'already-picked-up');
});

test('J-return-to-stage-truthful slice-370-ac-2 trap-3-handoff-stays-asynchronous — the server hands a run slice to the orchestrator instead of moving the queue itself', async () => {
  writeQueue('37801', 'ERROR');
  const res = await request('POST', '/api/bridge/return-to-stage/37801');

  assert.equal(res.status, 202, 'the answer is "accepted", which is what asynchronous means here');
  assert.equal(res.body.mode, 'control');
  assert.match(String(res.body.requested_at), /^\d{4}-\d{2}-\d{2}T/, 'the caller needs a point to follow from');

  const control = fs.readdirSync(controlDir).filter(f => f.startsWith('return-37801-'));
  assert.equal(control.length, 1, 'the request must go over as a control file');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(controlDir, control[0]), 'utf8')),
    { action: 'return_to_stage', slice_id: '37801' });

  // The web server did not touch the queue — that is still the orchestrator's.
  assert.equal(fs.existsSync(path.join(queueDir, '37801-ERROR.md')), true,
    'the server must not move a slice that has run');
  assert.equal(fs.readdirSync(stagedDir).some(f => f.startsWith('37801-')), false);
});

test('J-return-to-stage-truthful slice-370-ac-3 trap-4-recovery-behaviour-intact — returning an ERROR sidecar still recovers the original brief from trash', async () => {
  writeQueue('37901', 'ERROR', errorSidecar('37901'));
  fs.writeFileSync(
    path.join(trashDir, '37901-IN_PROGRESS.md.cleanup-ERROR-2026-09-04T02-00-00-000Z'),
    sliceFile('37901', 'IN_PROGRESS'), 'utf8');

  const result = orchestrator.handleReturnToStage('37901');
  assert.equal(result.ok, true, `expected a recovered return, got: ${result.error}`);

  const staged = fs.readFileSync(path.join(stagedDir, '37901-STAGED.md'), 'utf8');
  assert.match(staged, /The original brief body\./, 'the recovered brief is what makes a returned slice usable');
  assert.match(staged, /goal: "Prove the return-to-stage control tells the truth\."/);
  assert.match(staged, /status: "STAGED"/);
  assert.match(staged, /## Return-to-Stage notice/);

  const event = readRegister().reverse().find(e => e.event === 'RETURN_TO_STAGE' && String(e.slice_id) === '37901');
  assert.ok(event, 'a completed return is recorded as RETURN_TO_STAGE');
  assert.equal(event.body_source, 'trash', 'the brief must still be recovered from trash');
});
