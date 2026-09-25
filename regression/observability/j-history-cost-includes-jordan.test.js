'use strict';

/**
 * J-history-cost-includes-jordan — slice 402: the row's cost includes Jordan.
 *
 * Jordan's session has always ended with a `result` event carrying what the
 * review cost — bridge/logs/nog-399-round1.log says $1.7242135, against Sam's
 * $1.0700555 for the same slice — and nothing read it. The History row summed
 * Sam alone, marked itself "partial", and named two roles as missing. One of
 * them, Julian, runs a test suite rather than a metered session: he was never
 * going to arrive, so the mark could never clear.
 *
 * After this slice the orchestrator writes Jordan's numbers onto the event his
 * verdict ends on, /api/bridge sums them into the row, and Julian is no longer
 * a reason for "partial".
 *
 * Two sides, deliberately joined the way slice 401 joined them:
 *   - the orchestrator's own reader, required from bridge/orchestrator.js;
 *   - the server's `stages` object through the real /api/bridge over HTTP
 *     against a fixture register (REPO_ROOT rewritten into an os.tmpdir() root
 *     — live bridge/* is never touched), and the page's own renderer lifted out
 *     of lcars-dashboard.html and fed the row the server just produced.
 *
 * The ground truth is slice 399's real pair of sessions: Sam 24 / 12,753 /
 * 527,411 tokens at $1.0700555, Jordan 34 / 17,732 / 1,045,779 at $1.7242135.
 *
 * Sources: bridge/logs/nog-399-round1.log (Jordan's result event)
 *          docs/adr/ADR-PROOF-LANES.md §2 (core lane: one test per criterion
 *            plus one per trap)
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');

const REPO = path.resolve(__dirname, '..', '..');
const SERVER_SRC = path.join(REPO, 'dashboard', 'server.js');
const DASH = path.join(REPO, 'dashboard', 'lcars-dashboard.html');
const SRC = fs.readFileSync(DASH, 'utf8');
const ORCH_SRC = fs.readFileSync(path.join(REPO, 'bridge', 'orchestrator.js'), 'utf8');
const SERVER_TEXT = fs.readFileSync(SERVER_SRC, 'utf8');

const orchestrator = require('../../bridge/orchestrator.js');
const { reviewTelemetry, sessionTelemetry } = orchestrator;

// Sandbox: nothing here may touch the queue the running watcher polls.
const ORCH_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jordan-cost-orch-'));
orchestrator._testSetDirs(ORCH_TMP, ORCH_TMP, ORCH_TMP);
orchestrator._testSetRegisterFile(path.join(ORCH_TMP, 'register.jsonl'));

// ── Jordan's sessions, as the CLI really writes them ────────────────────────

// The result line of bridge/logs/nog-399-round1.log, trimmed to the fields that
// matter. Round 1 of slice 399: the review this slice exists to price.
const NOG_399_STDOUT = [
  '{"type":"system","subtype":"init","session_id":"ad1b2fa8"}',
  '{"type":"assistant","message":{"usage":{"input_tokens":2,"output_tokens":984,"cache_read_input_tokens":84592}}}',
  '{"type":"result","subtype":"success","total_cost_usd":1.7242135,"duration_ms":217574,"num_turns":31,"session_id":"ad1b2fa8","usage":{"input_tokens":34,"output_tokens":17732,"cache_read_input_tokens":1045779,"cache_creation_input_tokens":74795}}',
].join('\n');

const NOG_399 = { tokensIn: 34, tokensOut: 17732, tokensCacheRead: 1045779, costUsd: 1.7242135 };

// A review that never reached its result: the stream stops after a turn. The
// last JSON object on it is an assistant message WITH a usage block — the shape
// that would hand one turn's 984 output tokens over as the whole review's.
const NOG_KILLED_STDOUT = [
  '{"type":"system","subtype":"init","session_id":"beef"}',
  '{"type":"assistant","message":{"usage":{"input_tokens":2,"output_tokens":984,"cache_read_input_tokens":84592}}}',
].join('\n');

// Rate-limited: the CLI ends on an error event, not a result.
const NOG_RATE_LIMITED_STDOUT = [
  '{"type":"system","subtype":"init","session_id":"cafe"}',
  '{"type":"error","error":{"type":"rate_limit_error","message":"429"}}',
].join('\n');

// ── The fixture register ────────────────────────────────────────────────────
//
// 399  the measured slice, both sessions recorded, Julian's stage with no
//      numbers on it — the row that must read $2.79 and not say "partial".
// 920  two builds and two reviews, all four recorded.
// 921  Sam recorded, Jordan's review recorded nothing — still "partial",
//      naming Jordan and nobody else.

const EVENTS = [
  // ── 399 ──
  { ts: '2026-09-23T22:33:23.886Z', event: 'HUMAN_APPROVAL', id: '399', action: 'approved' },
  { ts: '2026-09-23T22:33:25.600Z', event: 'COMMISSIONED', id: '399', title: 'History tells the truth', goal: 'The row shows the slice, not Sam.' },
  { ts: '2026-09-23T22:35:51.218Z', event: 'DONE', id: '399', durationMs: 143982, tokensIn: 24, tokensOut: 12753, tokensCacheRead: 527411, costUsd: 1.0700555 },
  { ts: '2026-09-23T22:35:55.622Z', event: 'NOG_INVOKED', id: '399', round: 1 },
  { ts: '2026-09-23T22:39:34.475Z', event: 'NOG_DECISION', id: '399', verdict: 'ACCEPTED', round: 1, ...NOG_399 },
  { ts: '2026-09-23T22:39:39.172Z', event: 'SLICE_SQUASHED_TO_DEV', id: '399', squash_sha: 'sq399' },
  { ts: '2026-09-23T22:39:39.258Z', event: 'MERGED', id: '399', sha: 'sq399' },
  { ts: '2026-09-23T22:39:39.443Z', event: 'IN_QA', id: '399', started_ts: '2026-09-23T22:39:39.443Z' },
  { ts: '2026-09-23T22:49:08.771Z', event: 'QA_STAGE_RECORDED', id: '399', started_ts: '2026-09-23T22:39:39.443Z', ended_ts: '2026-09-23T22:49:08.770Z' },

  // ── 920: two rounds, four recorded sessions ──
  { ts: '2026-09-22T10:00:00.000Z', event: 'HUMAN_APPROVAL', id: '920', action: 'approved' },
  { ts: '2026-09-22T10:00:02.000Z', event: 'COMMISSIONED', id: '920', title: 'Reworked once', goal: 'Two rounds, four bills.' },
  { ts: '2026-09-22T10:05:02.000Z', event: 'DONE', id: '920', durationMs: 300000, tokensIn: 100, tokensOut: 200, tokensCacheRead: 700, costUsd: 0.50 },
  { ts: '2026-09-22T10:05:10.000Z', event: 'NOG_INVOKED', id: '920', round: 1 },
  { ts: '2026-09-22T10:07:10.000Z', event: 'NOG_DECISION', id: '920', verdict: 'REJECTED', round: 1, tokensIn: 10, tokensOut: 20, tokensCacheRead: 30, costUsd: 0.25 },
  { ts: '2026-09-22T10:12:10.000Z', event: 'DONE', id: '920', durationMs: 240000, tokensIn: 50, tokensOut: 150, tokensCacheRead: 800, costUsd: 0.25 },
  { ts: '2026-09-22T10:12:20.000Z', event: 'NOG_INVOKED', id: '920', round: 2 },
  { ts: '2026-09-22T10:14:20.000Z', event: 'NOG_DECISION', id: '920', verdict: 'ACCEPTED', round: 2, tokensIn: 5, tokensOut: 15, tokensCacheRead: 25, costUsd: 0.50 },
  { ts: '2026-09-22T10:14:30.000Z', event: 'SLICE_SQUASHED_TO_DEV', id: '920', squash_sha: 'sq920' },

  // ── 921: Jordan's review recorded nothing ──
  { ts: '2026-09-21T09:00:00.000Z', event: 'HUMAN_APPROVAL', id: '921', action: 'approved' },
  { ts: '2026-09-21T09:00:02.000Z', event: 'COMMISSIONED', id: '921', title: 'Review not priced', goal: 'The session died before its result.' },
  { ts: '2026-09-21T09:02:26.000Z', event: 'DONE', id: '921', durationMs: 143982, tokensIn: 24, tokensOut: 12753, tokensCacheRead: 527411, costUsd: 1.0700555 },
  { ts: '2026-09-21T09:02:30.000Z', event: 'NOG_INVOKED', id: '921', round: 1 },
  { ts: '2026-09-21T09:06:08.000Z', event: 'NOG_DECISION', id: '921', verdict: 'ACCEPTED', round: 1 },
  { ts: '2026-09-21T09:06:12.000Z', event: 'SLICE_SQUASHED_TO_DEV', id: '921', squash_sha: 'sq921' },
  { ts: '2026-09-21T09:06:13.000Z', event: 'IN_QA', id: '921', started_ts: '2026-09-21T09:06:13.000Z' },
  { ts: '2026-09-21T09:15:42.000Z', event: 'QA_STAGE_RECORDED', id: '921', started_ts: '2026-09-21T09:06:13.000Z', ended_ts: '2026-09-21T09:15:42.000Z' },
];

// ── Tier 2 harness: the real server on a fixture root ───────────────────────

let server, port, tmpRoot;

function compileServer(root) {
  const dashboardDir = path.join(root, 'dashboard');
  const lifecyclePath = path.join(root, 'bridge', 'lifecycle-translate.js');
  fs.writeFileSync(
    path.join(root, 'bridge', 'return-to-stage-eligibility.js'),
    `module.exports = require(${JSON.stringify(path.join(REPO, 'bridge', 'return-to-stage-eligibility.js'))});\n`,
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

  const src = SERVER_TEXT
    .replace(/const REPO_ROOT\s*=[\s\S]*?path\.resolve\(__dirname,\s*'\.\.'\);/, `const REPO_ROOT = ${JSON.stringify(root)};`)
    .replace(/const DASHBOARD\s*=\s*path\.join\(__dirname,\s*'lcars-dashboard\.html'\);/, `const DASHBOARD = ${JSON.stringify(path.join(dashboardDir, 'lcars-dashboard.html'))};`)
    .replace(/const TOKENS_CSS\s*=\s*path\.join\(__dirname,\s*'tokens\.css'\);/, `const TOKENS_CSS = ${JSON.stringify(path.join(dashboardDir, 'tokens.css'))};`)
    .replace(/require\(path\.join\(REPO_ROOT,\s*'bridge',\s*'lifecycle-translate'\)\)/, `require(${JSON.stringify(lifecyclePath)})`)
    .replace(/if \(require\.main === module\)/, 'if (false)')
    .replace(/module\.exports = \{ /, 'module.exports = { server, ');

  const mod = new Module('patched-dashboard-server-j-history-cost-includes-jordan');
  mod.paths = module.paths;
  mod._compile(src, path.join(dashboardDir, 'server.js'));
  return mod.exports.server;
}

function request(method, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: urlPath, method }, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        let parsed = raw;
        try { parsed = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

let bridge;      // the /api/bridge payload
const rowOf = id => bridge.recent.find(r => String(r.id) === id);

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j-jordan-cost-'));
  for (const dir of ['queue', 'staged', 'trash', 'control', 'errors', 'state'].map(d => path.join(tmpRoot, 'bridge', d)).concat(path.join(tmpRoot, 'dashboard'))) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const b = f => path.join(tmpRoot, 'bridge', f);
  fs.writeFileSync(b('heartbeat.json'), JSON.stringify({ current_slice: null }), 'utf8');
  fs.writeFileSync(b('queue-order.json'), '[]', 'utf8');
  fs.writeFileSync(b('staged-order.json'), '[]', 'utf8');
  fs.writeFileSync(b('sessions.jsonl'), '', 'utf8');
  fs.writeFileSync(b('first-output.json'), '{}', 'utf8');
  fs.writeFileSync(b('nog-active.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'state', 'branch-state.json'), '{}', 'utf8');
  fs.writeFileSync(b('register.jsonl'), EVENTS.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');

  server = compileServer(tmpRoot);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  port = server.address().port;

  const res = await request('GET', '/api/bridge');
  assert.equal(res.status, 200);
  bridge = res.body;
});

after(async () => {
  if (server) await new Promise(r => server.close(r));
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  if (ORCH_TMP) fs.rmSync(ORCH_TMP, { recursive: true, force: true });
});

// ── Tier 2 harness: the page's own History renderer ─────────────────────────

function extractFn(name) {
  const start = SRC.search(new RegExp(`\\n\\s*(?:async )?function ${name}\\s*\\(`));
  assert.notEqual(start, -1, `function ${name}() must exist in lcars-dashboard.html`);
  const i = SRC.indexOf('{', start);
  let depth = 0;
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}' && --depth === 0) return SRC.slice(start, j + 1);
  }
  throw new Error(`unbalanced braces while extracting ${name}()`);
}

function extractConst(name) {
  const m = SRC.match(new RegExp(`\\n\\s*const ${name}\\s*=\\s*[^;]+;`));
  assert.ok(m, `const ${name} must exist in lcars-dashboard.html`);
  return m[0];
}

function fakeEl() {
  const classes = new Set(['hidden']);
  return {
    innerHTML: '',
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
  };
}

// The real renderHistoryPage with the real formatters around it. Nothing here
// is a copy of page logic: every function comes out of the shipped file.
function loadHistoryRenderer() {
  const listEl = fakeEl();
  const pageEl = fakeEl();
  const factory = new Function('deps', `
    const document = deps.document;
    const historyExpandedSet = new Set();
    const humanReason = (r) => String(r);
    let cachedHistoryItems = [];
    let cachedHistoryAllRows = [];
    let historyPage = 1;
    ${extractConst('LIST_PAGE_SIZE')}
    ${extractConst('INPUT_COST_PER_M')}
    ${extractConst('OUTPUT_COST_PER_M')}
    ${extractFn('clampListPage')}
    ${extractFn('escHtml')}
    ${extractFn('fmtDuration')}
    ${extractFn('fmtTerminalTs')}
    ${extractFn('fmtTokens')}
    ${extractFn('fmtCost')}
    ${extractFn('fmtCostWithFallback')}
    ${extractFn('fmtWorkTime')}
    ${extractFn('fmtStageCost')}
    ${extractFn('historyStagesHtml')}
    ${extractFn('isFailureOutcome')}
    ${extractFn('outcomeHtml')}
    ${extractFn('renderHistoryPage')}
    return {
      render(rows) { cachedHistoryAllRows = rows; historyPage = 1; renderHistoryPage(); },
      fmtTokens, fmtWorkTime, fmtStageCost,
    };
  `);
  const api = factory({ document: { getElementById: id => ({ 'history-list': listEl, 'history-pagination': pageEl }[id] || null) } });
  return { ...api, listEl, pageEl };
}

// A row as renderHistoryPanel would hand it over: the server's row plus the
// three terminal fields the classifier adds.
const asRow = (row, ts) => ({ ...row, _terminalOutcome: 'MERGED', _terminalTs: ts, _terminalRound: 1 });

// Text inside a span, inner tags stripped, matched by brace depth so a nested
// span (the partial-cost marker, the verdict) does not truncate the read.
function spanText(html, cls) {
  const at = html.indexOf(`class="${cls}"`);
  if (at < 0) return null;
  let i = html.indexOf('>', at) + 1;
  let depth = 1, out = '';
  while (i < html.length && depth > 0) {
    if (html.startsWith('<span', i)) { depth++; i = html.indexOf('>', i) + 1; continue; }
    if (html.startsWith('</span>', i)) { depth--; i += 7; continue; }
    out += html[i++];
  }
  return out.trim();
}

function rowHtml(html, id) {
  const at = html.indexOf(`data-history-id="${id}"`);
  assert.notEqual(at, -1, `row ${id} must be drawn`);
  const next = html.indexOf('<div class="history-row"', at);
  return html.slice(at, next === -1 ? html.length : next);
}

function stageLines(html) {
  const out = {};
  const re = /<div class="history-stage-line[^"]*" data-stage="([^"]+)">([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    out[m[1]] = {
      role:   spanText(m[2], 'history-stage-role'),
      time:   spanText(m[2], 'history-stage-time'),
      tokens: spanText(m[2], 'history-stage-tokens'),
      cost:   spanText(m[2], 'history-stage-cost'),
      html:   m[2],
    };
  }
  return out;
}

const DASH_CHAR = '—';

// ── slice-402-ac-1 ──────────────────────────────────────────────────────────

// @ac-hash: slice-402-ac-1 sha256:893d7f947eb2730d141252cd0c76c7d88ddb533e3ddea8042ae05b0c7297ee44
test('slice-402-ac-1 — a review that reached a verdict writes its own tokens and cost onto the event the round ends on', () => {
  // The numbers are the result event's, unrounded and unrescaled.
  assert.deepEqual(reviewTelemetry(NOG_399_STDOUT), NOG_399,
    "Jordan's four numbers come straight off his session's result event");
  assert.equal(reviewTelemetry(NOG_399_STDOUT).costUsd, 1.7242135,
    'costUsd IS total_cost_usd — the only figure that prices cache reads');

  // One read per review, shared by every path out of the callback: two reads
  // would be two different bills for one session.
  assert.match(ORCH_SRC, /const reviewUsage = reviewTelemetry\(retained\.resultLine \|\| retained\.lastJsonLine \|\| ''\);/,
    "invokeNog's exit handler reads Jordan's session once — off the result line the stream kept (slice 396)");
  assert.equal((ORCH_SRC.match(/= reviewTelemetry\(/g) || []).length, 1,
    'exactly one call site');

  // And every verdict a review can end on carries it. ACCEPTED, REJECTED and
  // unreadable each write a NOG_DECISION; ESCALATE and OVERSIZED write no
  // NOG_DECISION at all, so their numbers ride the event they do write.
  const carries = [
    ['ACCEPTED', /const acceptedDecision = \{[^}]*\.\.\.reviewUsage[^}]*\};/],
    ['ACCEPTED (handed to handleAccepted)', /handleAccepted\(id, summary \|\| '', round, branchName, donePath, durationMs, verdictSource, reviewUsage\);/],
    ['REJECTED', /const rejectedDecision = \{[^}]*\.\.\.reviewUsage[^}]*\};/],
    ['unreadable', /registerEvent\(id, 'NOG_DECISION', \{ round, verdict: 'REJECTED', reason: 'verdict_unreadable'[^}]*\.\.\.reviewUsage[^}]*\}\);/],
    ['ESCALATE and OVERSIZED', /registerEvent\(id, 'ESCALATED_TO_OBRIEN', \{[\s\S]{0,400}?\.\.\.reviewUsage,\n\s*\}\);/],
  ];
  for (const [verdict, re] of carries) {
    assert.match(ORCH_SRC, re, `the ${verdict} path must carry the review's numbers`);
  }

  // The server reads them back off the decision, rather than inventing a stage.
  assert.match(SERVER_TEXT, /tokens:\s*dec \? stageTokens\(dec\) : null,/,
    "the review stage's tokens are the decision's own, cache reads included");
  assert.match(SERVER_TEXT, /costUsd:\s*dec \? stageNum\(dec\.costUsd\) : null,/);
});

// ── slice-402-ac-2 ──────────────────────────────────────────────────────────

// @ac-hash: slice-402-ac-2 sha256:9288ad480f45353024e9be84de691d1a416932d1da8afceb244dc71f192fd8f9
test('slice-402-ac-2 — a review whose session never reached a result writes no number at all, and none is estimated', () => {
  for (const [what, stdout] of [
    ['killed mid-turn', NOG_KILLED_STDOUT],
    ['rate-limited', NOG_RATE_LIMITED_STDOUT],
    ['no output at all', ''],
    ['stdout undefined (execFile errored)', undefined],
    ['not JSON', 'Error: spawn claude ENOENT'],
  ]) {
    const out = reviewTelemetry(stdout);
    assert.deepEqual(out, {}, `${what} must record nothing`);
    assert.equal(Object.keys(out).length, 0,
      `${what} must not even write nulls — an absent key and a null are different facts downstream`);
  }

  // The killed session's last object IS an assistant message with a usage block.
  // Reading it would have filed one turn's 984 output tokens as the review's.
  assert.equal(reviewTelemetry(NOG_KILLED_STDOUT).tokensOut, undefined,
    "a turn's usage is not the review's usage");

  // Spread onto a decision, a session that recorded nothing leaves it untouched.
  const base = { round: 1, verdict: 'REJECTED', reason: 'verdict_unreadable', apendment_cycle: 1 };
  assert.deepEqual({ ...base, ...reviewTelemetry(NOG_KILLED_STDOUT) }, base,
    'the event is written exactly as it was before');

  // No price list anywhere near Jordan's reader.
  const reader = ORCH_SRC.slice(ORCH_SRC.indexOf('function reviewTelemetry('));
  const body = reader.slice(0, reader.indexOf('\n}\n') + 2);
  assert.doesNotMatch(body, /computeCost|COST_PER_M/,
    'Jordan\'s path never estimates a cost from a price list');
});

// ── slice-402-ac-3 ──────────────────────────────────────────────────────────

// @ac-hash: slice-402-ac-3 sha256:08446c74f55107f8587128f460696bd6b0f6dd91b427f001b7944817777ed3a3
test('slice-402-ac-3 — a slice with every session recorded sums them all and shows no partial mark', () => {
  const s = rowOf('399').stages;

  const samTokens = 24 + 12753 + 527411;
  const jordanTokens = 34 + 17732 + 1045779;
  assert.equal(s.rounds[0].build.tokens, samTokens, "Sam's build is unchanged");
  assert.equal(s.rounds[0].review.tokens, jordanTokens, "Jordan's review carries his own tokens");
  assert.equal(s.rounds[0].review.costUsd, 1.7242135);

  assert.equal(s.totals.tokens, samTokens + jordanTokens, 'TOKENS is both sessions');
  assert.ok(Math.abs(s.totals.costUsd - (1.0700555 + 1.7242135)) < 1e-9,
    'COST is both bills');
  assert.deepEqual(s.totals.missing, [], 'nobody is owed a number');

  const h = loadHistoryRenderer();
  h.render([asRow(rowOf('399'), '2026-09-23T22:39:39.258Z')]);
  const row = rowHtml(h.listEl.innerHTML, '399');

  assert.equal(spanText(row, 'col-cost'), '$2.79',
    "COST is Sam's $1.07 plus Jordan's $1.72 — and says nothing about being partial");
  assert.ok(!/partial/.test(row), 'no partial mark anywhere on the row');
  assert.equal(spanText(row, 'col-tokens'), '1.6M', 'TOKENS is the sum of both sessions');
  assert.ok(!/est\./.test(row) && !/~\$/.test(row), 'and still nothing estimated');
});

// ── slice-402-ac-4 ──────────────────────────────────────────────────────────

// @ac-hash: slice-402-ac-4 sha256:a3b6ea3e5de7e65f9eb17bb8a7a3aba980d71fdc53ed89ef7303580dbe3668d3
test('slice-402-ac-4 — Julian is never named among the missing and never makes a row partial', () => {
  // 399 and 921 both have a QA stage with no numbers on it. One is otherwise
  // complete and one is not; neither may mention Julian.
  for (const id of ['399', '921']) {
    const s = rowOf(id).stages;
    assert.ok(s.qa, `slice ${id} really does have a QA stage with no numbers`);
    assert.equal(s.qa.tokens, undefined, 'and Julian records none');
    assert.ok(!s.totals.missing.includes('Julian'),
      `slice ${id} must not name Julian among the missing`);
  }
  assert.deepEqual(rowOf('399').stages.totals.missing, [],
    "Julian's absent numbers do not make a fully recorded slice partial");

  for (const row of bridge.recent) {
    assert.ok(!row.stages.totals.missing.includes('Julian'),
      `row ${row.id} must not name Julian`);
  }

  const h = loadHistoryRenderer();
  h.render([asRow(rowOf('399'), '2026-09-23T22:39:39.258Z')]);
  const row = rowHtml(h.listEl.innerHTML, '399');
  assert.ok(!/Julian/.test(row.match(/<span class="cost-partial"[^>]*>/) || ''),
    'and the cost cell never explains itself by naming him');

  assert.doesNotMatch(SERVER_TEXT, /missing\.push\(STAGE_ROLE_QA\)/,
    'the QA stage is never pushed onto the missing list');
});

// ── slice-402-ac-5 ──────────────────────────────────────────────────────────

// @ac-hash: slice-402-ac-5 sha256:1c844027f240b96a77df06a329f6efc353ecf2d85cc431aa4a3fb2cf4e035c9f
test('slice-402-ac-5 — a slice built twice and reviewed twice totals all four sessions', () => {
  const s = rowOf('920').stages;
  assert.equal(s.rounds.length, 2, 'two rounds');

  assert.equal(s.rounds[0].review.tokens, 10 + 20 + 30);
  assert.equal(s.rounds[0].review.costUsd, 0.25);
  assert.equal(s.rounds[1].review.tokens, 5 + 15 + 25);
  assert.equal(s.rounds[1].review.costUsd, 0.50, "the second review's bill is its own, not the first's");

  assert.equal(s.totals.tokens, (100 + 200 + 700) + (10 + 20 + 30) + (50 + 150 + 800) + (5 + 15 + 25),
    'TOKENS is both builds and both reviews');
  assert.ok(Math.abs(s.totals.costUsd - (0.50 + 0.25 + 0.25 + 0.50)) < 1e-9,
    'COST is all four bills');
  assert.deepEqual(s.totals.missing, []);

  const h = loadHistoryRenderer();
  h.render([asRow(rowOf('920'), '2026-09-22T10:14:30.000Z')]);
  const row = rowHtml(h.listEl.innerHTML, '920');
  assert.equal(spanText(row, 'col-cost'), '$1.50');
  const lines = stageLines(row);
  assert.equal(lines['review-1'].cost, '$0.25', 'each round shows its own review');
  assert.equal(lines['review-2'].cost, '$0.50');
  assert.equal(lines.total.cost, '$1.50');
});

// ── slice-402-ac-6 ──────────────────────────────────────────────────────────

// @ac-hash: slice-402-ac-6 sha256:6c0c08013cb039969e9ac2f39db443a98f6a8a1c42ee2f2c6c5899e2ac709d36
test('slice-402-ac-6 — a review that recorded nothing still reads partial, names Jordan, and is never counted as $0', () => {
  const s = rowOf('921').stages;
  assert.equal(s.rounds[0].review.costUsd, null, 'an unrecorded review has no cost');
  assert.equal(s.rounds[0].review.tokens, null);
  assert.notEqual(s.rounds[0].review.costUsd, 0, 'and it is not zero');
  assert.deepEqual(s.totals.missing, ['Jordan'], 'Jordan is named; nobody else is');
  assert.ok(Math.abs(s.totals.costUsd - 1.0700555) < 1e-9,
    "the total is Sam's bill alone — Jordan's blank did not add 0 to it");

  const h = loadHistoryRenderer();
  h.render([asRow(rowOf('921'), '2026-09-21T09:06:12.000Z')]);
  const row = rowHtml(h.listEl.innerHTML, '921');
  assert.equal(spanText(row, 'col-cost'), '$1.07 partial');
  const title = (row.match(/<span class="cost-partial" title="([^"]*)"/) || [])[1] || '';
  assert.match(title, /Jordan/, 'the partial marker names Jordan');
  assert.doesNotMatch(title, /Julian/, 'and only Jordan');
  assert.ok(!/est\./.test(row) && !/~\$/.test(row), 'nothing is estimated in his place');
});

// ── slice-402-ac-7 ──────────────────────────────────────────────────────────

// @ac-hash: slice-402-ac-7 sha256:6335e3ba0ec2ae55b1eeb482870ba08e7ef2dc13b68607b71ef92d19ff8a2b68
test('slice-402-ac-7 — the expanded row shows each review\'s tokens and cost, and an em dash when it recorded none', () => {
  const h = loadHistoryRenderer();
  h.render([asRow(rowOf('399'), '2026-09-23T22:39:39.258Z')]);
  const lines = stageLines(rowHtml(h.listEl.innerHTML, '399'));

  assert.match(lines['review-1'].role, /Review · Jordan/);
  assert.equal(lines['review-1'].tokens, '1.1M', "the review line shows Jordan's own tokens");
  assert.equal(lines['review-1'].cost, '$1.72', "and his own cost");
  assert.equal(lines['build-1'].cost, '$1.07', "Sam's line is untouched beside it");

  // The unrecorded review: two em dashes, not two zeros.
  const h2 = loadHistoryRenderer();
  h2.render([asRow(rowOf('921'), '2026-09-21T09:06:12.000Z')]);
  const blank = stageLines(rowHtml(h2.listEl.innerHTML, '921'));
  assert.match(blank['review-1'].role, /Review · Jordan/);
  assert.equal(blank['review-1'].tokens, DASH_CHAR);
  assert.equal(blank['review-1'].cost, DASH_CHAR);
  assert.notEqual(blank['review-1'].cost, '$0.00');
  assert.equal(blank['review-1'].time, '3m 38s', 'the minutes it did record are still there');
});

// ── Trap 1: Sam still estimates, Jordan never does ──────────────────────────

// @ac-hash: slice-402-ac-2 sha256:9288ad480f45353024e9be84de691d1a416932d1da8afceb244dc71f192fd8f9
test('slice-402-ac-2 trap 1 — sessionTelemetry still falls back to computeCost for Sam, and reviewTelemetry never does', () => {
  // Sam's pinned numbers (j-report-metrics-filled.test.js, slice 383's session).
  const SAM = '{"type":"result","total_cost_usd":5.136778,"duration_ms":979908,"num_turns":66,"session_id":"x","usage":{"input_tokens":116,"output_tokens":52142,"cache_read_input_tokens":5155296,"cache_creation_input_tokens":125132}}';
  assert.deepEqual(sessionTelemetry(SAM, 979908), {
    tokensIn: 116, tokensOut: 52142, tokensCacheRead: 5155296, elapsedMs: 979908, costUsd: 5.136778,
  }, "Sam's reader is untouched");

  // A result with no total_cost_usd — the older CLI. Sam's reader still prices
  // it at list, which is the behaviour j-report-metrics-filled pins.
  const NO_COST = '{"type":"result","duration_ms":1000,"session_id":"x","usage":{"input_tokens":1000,"output_tokens":2000,"cache_read_input_tokens":900}}';
  const sam = sessionTelemetry(NO_COST, 1000);
  assert.equal(sam.costUsd, (1000 * 15.00 / 1e6) + (2000 * 75.00 / 1e6),
    'sessionTelemetry still estimates when the session carried no cost');
  assert.ok(sam.costUsd > 0);

  // Jordan's reader, on the very same output, records the tokens and no money.
  const jordan = reviewTelemetry(NO_COST);
  assert.deepEqual(jordan, { tokensIn: 1000, tokensOut: 2000, tokensCacheRead: 900 },
    'the tokens are measured, the cost is simply absent');
  assert.ok(!('costUsd' in jordan), 'no estimated cost is written for a review');

  // And the two readers are separate functions: one is not a call to the other.
  assert.match(ORCH_SRC, /function reviewTelemetry\(stdout\) \{/);
  const reader = ORCH_SRC.slice(ORCH_SRC.indexOf('function reviewTelemetry('));
  assert.doesNotMatch(reader.slice(0, reader.indexOf('\n}\n') + 2), /sessionTelemetry\(/,
    'reviewTelemetry does not route through the estimating reader');
});
