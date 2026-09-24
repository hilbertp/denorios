'use strict';

/**
 * J-inspect-slice-history — slice 401: the History row tells the truth.
 *
 * The row for slice 399 read TIME 2m, TOKENS 24, COST $1.07. Every number was
 * wrong: 2m was Sam's own session floored to the minute, 24 was the uncached
 * input tokens printed by the Cost Center's fmtTokens (declared second in the
 * page, so it won over History's), and $1.07 was Sam's bill shown as the
 * slice's. Philipp read the row as the slice and could not reconcile it with
 * what he had watched happen.
 *
 * Two sides are tested here, and deliberately joined:
 *   - the server's `stages` object, through the real /api/bridge over HTTP
 *     against a fixture register (REPO_ROOT rewritten into an os.tmpdir() root,
 *     the way j-inspect-slice-history.test.js does it — live bridge/* is never
 *     touched);
 *   - the page's own renderer, lifted out of lcars-dashboard.html and fed the
 *     row the server just produced. A hand-written stages object would let the
 *     two halves drift apart while both tests stayed green, which is the one
 *     thing this net must not allow.
 *
 * The ground truth is the brief's measured table for slice 399 (register
 * events of 2026-09-23): build 143,982 ms, review 218,853 ms, QA 569,327 ms,
 * 1,714 ms waited in the queue, 373,572 ms from Sam's start to landing on dev.
 *
 * Sources: bridge/register.jsonl (the 399 events, copied into the fixture)
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

const SERVER_SRC = path.resolve(__dirname, '..', '..', 'dashboard', 'server.js');
const DASH = path.resolve(__dirname, '..', '..', 'dashboard', 'lcars-dashboard.html');
const SRC = fs.readFileSync(DASH, 'utf8');

// ── The fixture register ────────────────────────────────────────────────────
//
// 399  the measured slice, event for event as the brief recorded it.
// 910  two build rounds and two reviews — rejected, reworked, accepted.
// 911  the 2026-09-17 register wipe: a DONE with no approval and no
//      commission, and a NOG_INVOKED whose decision never arrived.
// 912  the pinned row (slice-901-ac-8 values) with a backwards clock: the only
//      approval lands AFTER the commission and the only squash BEFORE it.
// 913  slice 401's own live shape: one build, Nog invoked TWICE for round 1
//      because the first review never finished, one decision.

const EVENTS = [
  // ── 399 ──
  { ts: '2026-09-23T22:33:23.886Z', event: 'HUMAN_APPROVAL', id: '399', action: 'approved' },
  { ts: '2026-09-23T22:33:25.600Z', event: 'COMMISSIONED', id: '399', title: 'History tells the truth', goal: 'The row shows the slice, not Sam.' },
  { ts: '2026-09-23T22:35:51.218Z', event: 'DONE', id: '399', durationMs: 143982, tokensIn: 24, tokensOut: 12753, tokensCacheRead: 527411, costUsd: 1.0700555 },
  { ts: '2026-09-23T22:35:55.622Z', event: 'NOG_INVOKED', id: '399', round: 1 },
  { ts: '2026-09-23T22:39:34.475Z', event: 'NOG_DECISION', id: '399', verdict: 'ACCEPTED', round: 1 },
  { ts: '2026-09-23T22:39:39.172Z', event: 'SLICE_SQUASHED_TO_DEV', id: '399', squash_sha: 'sq399' },
  { ts: '2026-09-23T22:39:39.258Z', event: 'MERGED', id: '399', sha: 'sq399' },
  { ts: '2026-09-23T22:39:39.443Z', event: 'IN_QA', id: '399', started_ts: '2026-09-23T22:39:39.443Z' },
  { ts: '2026-09-23T22:49:08.771Z', event: 'QA_STAGE_RECORDED', id: '399', started_ts: '2026-09-23T22:39:39.443Z', ended_ts: '2026-09-23T22:49:08.770Z' },

  // ── 910: two rounds ──
  { ts: '2026-09-22T10:00:00.000Z', event: 'HUMAN_APPROVAL', id: '910', action: 'approved' },
  { ts: '2026-09-22T10:00:02.000Z', event: 'COMMISSIONED', id: '910', title: 'Reworked twice', goal: 'Two rounds.' },
  { ts: '2026-09-22T10:05:02.000Z', event: 'DONE', id: '910', durationMs: 300000, tokensIn: 100, tokensOut: 200, tokensCacheRead: 700, costUsd: 0.50 },
  { ts: '2026-09-22T10:05:10.000Z', event: 'NOG_INVOKED', id: '910', round: 1 },
  { ts: '2026-09-22T10:07:10.000Z', event: 'NOG_DECISION', id: '910', verdict: 'REJECTED', round: 1 },
  { ts: '2026-09-22T10:12:10.000Z', event: 'DONE', id: '910', durationMs: 240000, tokensIn: 50, tokensOut: 150, tokensCacheRead: 800, costUsd: 0.25 },
  { ts: '2026-09-22T10:12:20.000Z', event: 'NOG_INVOKED', id: '910', round: 2 },
  { ts: '2026-09-22T10:14:20.000Z', event: 'NOG_DECISION', id: '910', verdict: 'ACCEPTED', round: 2 },
  { ts: '2026-09-22T10:14:30.000Z', event: 'SLICE_SQUASHED_TO_DEV', id: '910', squash_sha: 'sq910' },

  // ── 911: the wiped register ──
  { ts: '2026-09-21T12:00:00.000Z', event: 'DONE', id: '911', durationMs: 60000, tokensIn: 10, tokensOut: 20, costUsd: 0.05 },
  { ts: '2026-09-21T12:00:10.000Z', event: 'NOG_INVOKED', id: '911', round: 1 },

  // ── 912: pinned values, backwards clock ──
  { ts: '2026-09-20T12:50:00.000Z', event: 'SLICE_SQUASHED_TO_DEV', id: '912', squash_sha: 'sq912-stale' },
  { ts: '2026-09-20T13:00:00.000Z', event: 'COMMISSIONED', id: '912', title: 'Pinned metrics', goal: 'Trap 1.' },
  { ts: '2026-09-20T13:00:05.000Z', event: 'HUMAN_APPROVAL', id: '912', action: 'approved' },
  { ts: '2026-09-20T14:30:00.000Z', event: 'DONE', id: '912', durationMs: 5400000, tokensIn: 48200, tokensOut: 8100, costUsd: 1.3305 },

  // ── 913: Nog re-invoked for the same round ──
  // Slice 401's own register, event for event. Numbering rounds by position
  // read these three events as two rounds, and handed round 1's review the
  // abandoned run's start — 21m 43s of "review" for a 7m review.
  { ts: '2026-09-24T00:21:00.000Z', event: 'HUMAN_APPROVAL', id: '913', action: 'approved' },
  { ts: '2026-09-24T00:21:02.905Z', event: 'COMMISSIONED', id: '913', title: 'Reviewed twice, built once', goal: 'One round.' },
  { ts: '2026-09-24T00:37:41.748Z', event: 'DONE', id: '913', durationMs: 998599, tokensIn: 134, tokensOut: 75771, tokensCacheRead: 1000000, costUsd: 6.87 },
  { ts: '2026-09-24T00:37:42.323Z', event: 'NOG_INVOKED', id: '913', round: 1 },
  { ts: '2026-09-24T00:52:25.539Z', event: 'NOG_INVOKED', id: '913', round: 1 },
  { ts: '2026-09-24T00:59:25.501Z', event: 'NOG_DECISION', id: '913', verdict: 'REJECTED', round: 1 },
];

// ── Tier 2 harness: the real server on a fixture root ───────────────────────

let server, port, tmpRoot;

function compileServer(root) {
  const dashboardDir = path.join(root, 'dashboard');
  const lifecyclePath = path.join(root, 'bridge', 'lifecycle-translate.js');
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
    .replace(/const REPO_ROOT\s*=[\s\S]*?path\.resolve\(__dirname,\s*'\.\.'\);/, `const REPO_ROOT = ${JSON.stringify(root)};`)
    .replace(/const DASHBOARD\s*=\s*path\.join\(__dirname,\s*'lcars-dashboard\.html'\);/, `const DASHBOARD = ${JSON.stringify(path.join(dashboardDir, 'lcars-dashboard.html'))};`)
    .replace(/const TOKENS_CSS\s*=\s*path\.join\(__dirname,\s*'tokens\.css'\);/, `const TOKENS_CSS = ${JSON.stringify(path.join(dashboardDir, 'tokens.css'))};`)
    .replace(/require\(path\.join\(REPO_ROOT,\s*'bridge',\s*'lifecycle-translate'\)\)/, `require(${JSON.stringify(lifecyclePath)})`)
    .replace(/if \(require\.main === module\)/, 'if (false)')
    .replace(/module\.exports = \{ /, 'module.exports = { server, ');

  const mod = new Module('patched-dashboard-server-j-history-tells-the-truth');
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
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j-history-truth-'));
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

// ── slice-401-ac-1 ──────────────────────────────────────────────────────────

// @ac-hash: slice-401-ac-1 sha256:3482fc7c2c40775db38a69d5eea4b20364e384693fe99d962b7b11970971e637
test('slice-401-ac-1 — every /api/bridge recent[] row carries a stages object, and the row metrics it sits beside are untouched', async () => {
  assert.ok(Array.isArray(bridge.recent) && bridge.recent.length >= 4,
    'the fixture register must produce a history row per completed slice');

  for (const row of bridge.recent) {
    const s = row.stages;
    assert.ok(s && typeof s === 'object', `row ${row.id} must carry a stages object`);
    for (const key of ['approvedAt', 'startedAt', 'landedAt', 'queuedMs', 'rounds', 'qa', 'totals']) {
      assert.ok(key in s, `stages of row ${row.id} must have ${key}`);
    }
    assert.ok(Array.isArray(s.rounds), `stages.rounds of row ${row.id} must be an array`);
    for (const key of ['elapsedMs', 'tokens', 'costUsd', 'missing']) {
      assert.ok(key in s.totals, `stages.totals of row ${row.id} must have ${key}`);
    }
    assert.ok(Array.isArray(s.totals.missing), 'totals.missing must be a list of role names');
  }

  const r399 = rowOf('399');
  assert.ok(r399.stages.rounds[0].build, 'a build round is derived from the DONE event');
  assert.ok(r399.stages.rounds[0].review, 'a review round is derived from the NOG events');

  // The four fields the row already published are the DONE event's own, still.
  // stages is added beside them, never over them.
  assert.equal(r399.durationMs, 143982, 'durationMs stays the DONE value');
  assert.equal(r399.tokensIn, 24, 'tokensIn stays the DONE value');
  assert.equal(r399.tokensOut, 12753, 'tokensOut stays the DONE value');
  assert.equal(r399.costUsd, 1.0700555, 'costUsd stays the DONE value');
});

// ── slice-401-ac-2 ──────────────────────────────────────────────────────────

// @ac-hash: slice-401-ac-2 sha256:0021c8b92e3f9760f7d4e7a3ac096844da91000794c55fea32eb744d7f15b96b
test('slice-401-ac-2 — the slice-399 register reproduces the measured build, review, QA, queue wait and working time', () => {
  const s = rowOf('399').stages;

  assert.equal(s.rounds.length, 1, 'slice 399 ran one round');
  assert.equal(s.rounds[0].build.durationMs, 143982, "Sam's build, from the DONE event");
  assert.equal(s.rounds[0].build.startedAt, '2026-09-23T22:33:27.236Z',
    'the build start is the DONE timestamp less its own durationMs');
  assert.equal(s.rounds[0].review.durationMs, 218853, "Jordan's review, NOG_INVOKED to NOG_DECISION");
  assert.equal(String(s.rounds[0].review.verdict).toLowerCase(), 'accepted',
    "the round carries Jordan's verdict");
  assert.equal(s.qa.durationMs, 569327, "Julian's stage, IN_QA to the recorded ended_ts");

  assert.equal(s.approvedAt, '2026-09-23T22:33:23.886Z');
  assert.equal(s.startedAt, '2026-09-23T22:33:25.600Z');
  assert.equal(s.landedAt, '2026-09-23T22:39:39.172Z');
  assert.equal(s.queuedMs, 1714, 'the wait between approval and Sam starting');
  assert.equal(s.totals.elapsedMs, 373572,
    "working time is Sam's start to the squash on dev — not the wait, not the wall clock since approval");

  // The queue wait is shown, but it is NOT inside the working time.
  assert.ok(s.totals.elapsedMs < s.totals.elapsedMs + s.queuedMs,
    'queue wait is reported separately from the working time');

  assert.equal(s.totals.tokens, 24 + 12753 + 527411, 'tokens include the cache reads');
  assert.equal(s.totals.costUsd, 1.0700555);
});

// ── slice-401-ac-3 ──────────────────────────────────────────────────────────

// @ac-hash: slice-401-ac-3 sha256:765001c67e8817a68177db7e6dcb10e80751fd3bc3f142233b84464458a5e28c
test('slice-401-ac-3 — a value whose events are missing is null, never 0 or negative, and totals.missing names the roles with nothing recorded', () => {
  const s911 = rowOf('911').stages;

  // No HUMAN_APPROVAL, no COMMISSIONED, no squash: every span that needs a
  // second endpoint is null rather than a confident zero.
  assert.equal(s911.approvedAt, null);
  assert.equal(s911.startedAt, null);
  assert.equal(s911.landedAt, null);
  assert.equal(s911.queuedMs, null, 'an unmeasurable queue wait is null, not 0');
  assert.equal(s911.totals.elapsedMs, null, 'an unmeasurable working time is null, not 0');
  assert.equal(s911.rounds[0].review.durationMs, null, 'a review with no decision has no duration');
  assert.equal(s911.rounds[0].review.verdict, null);
  assert.equal(s911.qa, null, 'a slice that never entered QA has no QA stage');

  // Nothing anywhere in any stages object is a negative span.
  for (const row of bridge.recent) {
    const s = row.stages;
    for (const [what, v] of [['queuedMs', s.queuedMs], ['totals.elapsedMs', s.totals.elapsedMs]]) {
      assert.ok(v === null || v >= 0, `${what} of row ${row.id} must be null or positive, got ${v}`);
    }
    for (const r of s.rounds) {
      for (const stage of [r.build, r.review]) {
        if (stage) assert.ok(stage.durationMs === null || stage.durationMs >= 0,
          `round ${r.round} of row ${row.id} must not report a negative duration`);
      }
    }
    if (s.qa) assert.ok(s.qa.durationMs === null || s.qa.durationMs >= 0);
  }

  // A role with a stage but no recorded numbers is named, and one with numbers
  // is not. 399 has all three stages; only Sam's usage was captured.
  assert.deepEqual(rowOf('399').stages.totals.missing, ['Jordan', 'Julian']);
  assert.deepEqual(s911.totals.missing, ['Jordan'],
    'no QA stage means Julian is not owed a number, so he is not listed');
  assert.deepEqual(rowOf('912').stages.totals.missing, [],
    'a slice whose only stage is a recorded build is missing nothing');
});

// ── slice-401-ac-4 ──────────────────────────────────────────────────────────

// @ac-hash: slice-401-ac-4 sha256:c8be73089e1ecd423690fcfd29f6d541d070dcb6cc8e6f18a613e4d06999a614
test('slice-401-ac-4 — the History row shows working time in minutes and seconds, every recorded token, and a cost marked partial', () => {
  const h = loadHistoryRenderer();
  h.render([asRow(rowOf('399'), '2026-09-23T22:39:39.258Z')]);
  const row = rowHtml(h.listEl.innerHTML, '399');

  assert.equal(spanText(row, 'col-duration'), '6m 13s',
    "TIME is Sam's start to landing on dev, whole seconds and not floored to the minute");
  assert.equal(spanText(row, 'col-tokens'), '540k',
    'TOKENS is the sum of every recorded token, cache reads included — not the 24 uncached input tokens');
  assert.equal(spanText(row, 'col-cost'), '$1.07 partial',
    'COST is the recorded sum, marked partial because two roles recorded nothing');

  const title = (row.match(/<span class="cost-partial" title="([^"]*)"/) || [])[1] || '';
  assert.match(title, /Jordan/, 'the partial marker names Jordan');
  assert.match(title, /Julian/, 'the partial marker names Julian');

  // No invented number anywhere on the row: the estimator prints "est." and a
  // tilde, and neither may appear.
  assert.ok(!/est\./.test(row) && !/~\$/.test(row),
    'a missing cost is never replaced by an estimate');

  // A row with nothing to report shows the em dash, not a zero.
  h.render([asRow(rowOf('911'), '2026-09-21T12:00:00.000Z')]);
  const row911 = rowHtml(h.listEl.innerHTML, '911');
  assert.equal(spanText(row911, 'col-duration'), DASH_CHAR,
    'an unmeasurable working time reads as an em dash');
});

// ── slice-401-ac-5 ──────────────────────────────────────────────────────────

// @ac-hash: slice-401-ac-5 sha256:45856a42f54b03d97cc26dddfc2236e7bdffd465df72da85725072cd9c65821e
test('slice-401-ac-5 — the expanded row lists build, review, QA, the queue wait and the total, with an em dash where nothing was recorded', () => {
  const h = loadHistoryRenderer();
  h.render([asRow(rowOf('399'), '2026-09-23T22:39:39.258Z')]);
  const lines = stageLines(rowHtml(h.listEl.innerHTML, '399'));

  assert.deepEqual(Object.keys(lines), ['build-1', 'review-1', 'qa', 'queued', 'total'],
    'the stages read in the order they happened, with the total last');

  assert.match(lines['build-1'].role, /Build · Sam/);
  assert.equal(lines['build-1'].time, '2m 23s');
  assert.equal(lines['build-1'].tokens, '540k');
  assert.equal(lines['build-1'].cost, '$1.07');

  assert.match(lines['review-1'].role, /Review · Jordan/);
  assert.match(lines['review-1'].role, /accepted/, "the review line carries Jordan's verdict");
  assert.equal(lines['review-1'].time, '3m 38s');
  assert.equal(lines['review-1'].tokens, DASH_CHAR, 'nothing recorded for Jordan is an em dash, not a zero');
  assert.equal(lines['review-1'].cost, DASH_CHAR);

  assert.match(lines.qa.role, /QA · Julian/);
  assert.equal(lines.qa.time, '9m 29s');
  assert.equal(lines.qa.tokens, DASH_CHAR);
  assert.equal(lines.qa.cost, DASH_CHAR);

  assert.match(lines.queued.role, /Waited in queue/);
  assert.equal(lines.queued.time, '1s', 'the queue wait is shown on its own line, outside the working time');

  assert.match(lines.total.role, /Sam start → landed on dev/);
  assert.equal(lines.total.time, '6m 13s');
  assert.equal(lines.total.tokens, '540k');
  assert.equal(lines.total.cost, '$1.07 partial');
});

// ── slice-401-ac-6 ──────────────────────────────────────────────────────────

// @ac-hash: slice-401-ac-6 sha256:5a6cffb19303b8c8b22414731dc8f31f74efe0e5ad85b9e7f72823b798fda1dc
test('slice-401-ac-6 — the inline script declares each top-level function once, and History formats tokens with its own', () => {
  const names = [...SRC.matchAll(/^ {2}(?:async )?function ([A-Za-z_$][\w$]*)\s*\(/gm)].map(m => m[1]);
  const seen = new Map();
  for (const n of names) seen.set(n, (seen.get(n) || 0) + 1);
  const dupes = [...seen].filter(([, c]) => c > 1).map(([n]) => n);
  assert.deepEqual(dupes, [],
    'a second declaration silently replaces the first at load time — the page runs the last one, whatever the caller meant');

  // History's own fmtTokens takes the pair, and the History row calls it.
  assert.match(extractFn('fmtTokens'), /^\s*function fmtTokens\(tokIn, tokOut\)/,
    "the single fmtTokens is History's two-argument one");
  const render = extractFn('renderHistoryPage');
  assert.match(render, /class="col-tokens"[^>]*>\$\{fmtTokens\(/,
    'the TOKENS cell calls fmtTokens');

  // The Cost Center keeps its own single-value formatter under its own name.
  assert.match(SRC, /function fmtTokenCount\(v\)/, 'the Cost Center formatter is renamed, not deleted');
  assert.match(SRC, /\$\{fmtTokenCount\(row\.input\)\}/, 'the ledger calls the renamed formatter');

  const h = loadHistoryRenderer();
  assert.equal(h.fmtTokens(540188, 0), '540k',
    'the function the page runs is the one that sums a pair, not the one that prints a single value');
});

// ── slice-401-ac-7 ──────────────────────────────────────────────────────────

// @ac-hash: slice-401-ac-7 sha256:875cc3b24adfc0f57f110a881ded42f4acc8af5048d7973ced8a54504130a9b3
test('slice-401-ac-7 — a slice built twice shows two rounds, and its totals are the sums of the recorded rounds', () => {
  const s = rowOf('910').stages;

  assert.equal(s.rounds.length, 2, 'two DONE events are two build rounds');
  assert.equal(s.rounds[0].build.durationMs, 300000);
  assert.equal(s.rounds[1].build.durationMs, 240000);
  assert.equal(String(s.rounds[0].review.verdict).toLowerCase(), 'rejected',
    'round 1 was sent back');
  assert.equal(String(s.rounds[1].review.verdict).toLowerCase(), 'accepted');
  assert.equal(s.rounds[0].review.durationMs, 120000);
  assert.equal(s.rounds[1].review.durationMs, 120000,
    "round 2's review must be closed by round 2's decision, not round 1's");

  assert.equal(s.totals.tokens, (100 + 200 + 700) + (50 + 150 + 800),
    'the totals sum both rounds');
  assert.equal(s.totals.costUsd, 0.75);
  assert.equal(s.totals.elapsedMs, 868000, 'working time spans both rounds, start to landing');

  const h = loadHistoryRenderer();
  h.render([asRow(rowOf('910'), '2026-09-22T10:14:30.000Z')]);
  const lines = stageLines(rowHtml(h.listEl.innerHTML, '910'));
  assert.deepEqual(Object.keys(lines), ['build-1', 'review-1', 'build-2', 'review-2', 'qa', 'queued', 'total'],
    'both rounds are drawn, in order');
  assert.match(lines['build-2'].role, /round 2/, 'a reworked slice says which round a line belongs to');
  assert.equal(lines.total.tokens, '2k');
  assert.equal(lines.total.cost, '$0.75 partial');

  // The other side of the same criterion: rounds are counted by the round each
  // NOG_INVOKED names, not by how many of them there are. Slice 401's own
  // register has two NOG_INVOKED round=1 — the first review never finished —
  // against a single DONE. Counted positionally that is a round 2 that never
  // happened, drawn with three em dashes where Sam's second build would be.
  const twice = rowOf('913').stages;
  assert.equal(twice.rounds.length, 1, 'one build and one decided round is one round, not two');
  assert.equal(twice.rounds[0].round, 1);
  assert.equal(twice.rounds[0].build.durationMs, 998599);
  assert.equal(String(twice.rounds[0].review.verdict).toLowerCase(), 'rejected');
  assert.equal(twice.rounds[0].review.startedAt, '2026-09-24T00:52:25.539Z',
    'the review that happened is the run that reached the verdict, not the abandoned one');
  assert.equal(twice.rounds[0].review.durationMs, 419962,
    'Jordan reviewed for 7m; counting from the abandoned invocation would say 21m 43s');
  assert.equal(twice.totals.tokens, 134 + 75771 + 1000000, 'one round, so one build in the sum');

  const h2 = loadHistoryRenderer();
  h2.render([asRow(rowOf('913'), '2026-09-24T00:59:25.501Z')]);
  const reinvoked = stageLines(rowHtml(h2.listEl.innerHTML, '913'));
  assert.deepEqual(Object.keys(reinvoked), ['build-1', 'review-1', 'qa', 'queued', 'total'],
    'no line is drawn for a round that never happened');
  assert.doesNotMatch(reinvoked['build-1'].role, /round/,
    'a slice with one round does not label it');
});


// ── Trap 1: the pinned row fields ───────────────────────────────────────────

// @ac-hash: slice-401-ac-1 sha256:3482fc7c2c40775db38a69d5eea4b20364e384693fe99d962b7b11970971e637
test('slice-401-ac-1 trap 1 — the row fields pinned by slice-901-ac-8 still carry the DONE values', () => {
  // Same numbers j-inspect-slice-history.test.js pins, asserted here so that a
  // future refactor that reroutes the row through stages is caught in the file
  // that introduced stages, not only in the one that predates it. Changing
  // these is a criterion change, and only Philipp may make it.
  const row = rowOf('912');
  assert.equal(row.durationMs, 5400000);
  assert.equal(row.tokensIn, 48200);
  assert.equal(row.tokensOut, 8100);
  assert.ok(Math.abs(row.costUsd - 1.3305) < 1e-9);

  // And the stages beside them tell a different, fuller story without touching them.
  assert.equal(row.stages.rounds[0].build.tokens, 48200 + 8100,
    'the stage total sums the DONE event rather than replacing its fields');
});

// ── Trap 2: the lifted function is the executed function ────────────────────

// @ac-hash: slice-401-ac-6 sha256:5a6cffb19303b8c8b22414731dc8f31f74efe0e5ad85b9e7f72823b798fda1dc
test('slice-401-ac-6 trap 2 — every function the history tests lift is declared exactly once, so the test and the browser run the same code', () => {
  // extractFn takes the FIRST declaration; the browser keeps the LAST. While
  // fmtTokens was declared twice those were different functions, and the tests
  // passed on code the page never ran.
  const lifted = [
    'clampListPage', 'escHtml', 'classifyTerminalOutcome', 'getTerminalRound', 'foldLegacyApendments',
    'historyTerminalTime', 'orderHistoryRowsByRecency', 'renderHistoryPanel', 'fmtDuration',
    'fmtTerminalTs', 'fmtTokens', 'fmtCost', 'fmtCostWithFallback', 'fmtWorkTime', 'fmtStageCost',
    'historyStagesHtml', 'isFailureOutcome', 'outcomeHtml', 'renderHistoryPage', 'historyGoPage',
  ];
  for (const name of lifted) {
    const count = [...SRC.matchAll(new RegExp(`^\\s*(?:async )?function ${name}\\s*\\(`, 'gm'))].length;
    assert.equal(count, 1, `${name}() must be declared exactly once — the history tests lift it by name`);
  }
});

// ── Trap 3: the wiped register ──────────────────────────────────────────────

// @ac-hash: slice-401-ac-3 sha256:765001c67e8817a68177db7e6dcb10e80751fd3bc3f142233b84464458a5e28c
test('slice-401-ac-3 trap 3 — events out of order or missing after the register wipe give null spans, never negative ones', () => {
  // 912: the only HUMAN_APPROVAL is five seconds AFTER the commission and the
  // only squash is ten minutes BEFORE it — the shapes the 2026-09-17 wipe left
  // behind. Subtracting them would print "-5s" and "-10m".
  const s = rowOf('912').stages;
  assert.equal(s.startedAt, '2026-09-20T13:00:00.000Z');
  assert.equal(s.approvedAt, null, 'an approval that post-dates the start is not this run’s approval');
  assert.equal(s.queuedMs, null, 'not -5000');
  assert.equal(s.landedAt, null, 'a squash that pre-dates the start is not this run’s landing');
  assert.equal(s.totals.elapsedMs, null, 'not -600000');

  const h = loadHistoryRenderer();
  h.render([asRow(rowOf('912'), '2026-09-20T14:30:00.000Z')]);
  const row = rowHtml(h.listEl.innerHTML, '912');
  assert.equal(spanText(row, 'col-duration'), DASH_CHAR);
  const lines = stageLines(row);
  assert.equal(lines.queued.time, DASH_CHAR, 'the queue wait reads as an em dash, not a negative number');
  assert.equal(lines.total.time, DASH_CHAR);
  assert.ok(!/-\d+[ms]/.test(row), 'no negative duration is printed anywhere on the row');
});
