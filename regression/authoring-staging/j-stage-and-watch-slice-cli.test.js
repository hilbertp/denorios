'use strict';

/**
 * Journey: J-stage-and-watch-slice (CLI + dashboard data source)
 * Category: Authoring & Staging
 *
 * What this tests (spec: docs/e2e-journeys/J-stage-and-watch-slice.md,
 * docs/contracts/slice-pipeline.md §1–§3):
 *
 *   Tier 3c — drives the REAL bridge/new-slice.js as a child process with
 *   DS9_QUEUE_DIR / DS9_STAGED_DIR / DS9_REGISTER_FILE / DS9_TRASH_DIR
 *   redirected into a tmpdir (env overrides at bridge/new-slice.js lines
 *   43-46). This upgrades the fixture-only contract coverage in
 *   j-stage-and-watch-slice.test.js to the actual CLI:
 *     - Steps 1-2 + Outcome 1: {id}-STAGED.md written to staged/ with
 *       parseable frontmatter, status STAGED, all 8 required fields non-empty
 *       (slice-pipeline §3.1), and a complete markdown body (§3.3).
 *     - Step 2 (sequential ID): with 041-STAGED.md pre-seeded, the CLI
 *       assigns max+1, zero-padded to 3 digits.
 *     - Step 2 (validation): a missing required field rejects the invocation
 *       with a non-zero exit and an error naming the field; nothing is staged
 *       (journey "Known failure modes": "new-slice.js rejects the invocation").
 *     - Step 3: CLI stdout contains the created file path.
 *     - Outcome 4: register contains zero events for the new slice id at
 *       creation time — events start at approval.
 *
 *   Tier 2 — the dashboard server compiled in-process against the SAME
 *   tmpRoot, so the staged file written by the real CLI is served by the
 *   real endpoint:
 *     - Step 5 + Outcome 2: GET /api/bridge/staged lists the new slice
 *       (id + title) exactly once — the Queue panel's staged data source.
 *     - Outcome 3 (data-source analog): the endpoint payload carries the
 *       full slice body, which is what the expandable row renders.
 *
 * NOT covered headlessly (browser-only): refresh latency, row expansion
 * interaction, Approve button visibility/enabled state, Branch Topology
 * panel (journey steps 4, 6-8).
 *
 * #99992 rule: no live bridge/ state is touched. The child process requires
 * bridge/orchestrator.js, whose module load mkdirSyncs the live bridge dirs
 * (idempotent, creates no files — accepted); every read/write path the CLI
 * uses is redirected via the DS9_* env overrides into the tmpRoot.
 *
 * Run: node --test regression/authoring-staging/j-stage-and-watch-slice-cli.test.js
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const http   = require('node:http');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');

const { buildSliceFile, buildSliceBody, REQUIRED_FIELDS } = require('../helpers/slice-factory');
const { parseFrontmatter }                                = require('../helpers/pipeline-logic');
const { parseRegisterLines, initRegisterFile }            = require('../helpers/register-helper');

const REPO_ROOT  = path.resolve(__dirname, '..', '..');
const NEW_SLICE  = path.join(REPO_ROOT, 'bridge', 'new-slice.js');
const SERVER_SRC = path.join(REPO_ROOT, 'dashboard', 'server.js');

const NEW_TITLE = 'F-99 — Stage-and-watch journey fixture';
const NEW_GOAL  = 'Prove the staging CLI produces a valid slice file.';

let tmpRoot;
let queueDir;
let stagedDir;
let trashDir;
let registerPath;
let bodyFilePath;
let server;
let port;
let createResult; // spawnSync result of the journey's primary CLI run (creates 042)

// ---------------------------------------------------------------------------
// Tier 3c plumbing — real CLI, redirected state
// ---------------------------------------------------------------------------

function runNewSlice(args) {
  return spawnSync(process.execPath, [NEW_SLICE, ...args], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      DS9_QUEUE_DIR:     queueDir,
      DS9_STAGED_DIR:    stagedDir,
      DS9_REGISTER_FILE: registerPath,
      DS9_TRASH_DIR:     trashDir,
    },
    input: '',          // close stdin immediately — CLI falls back to /dev/stdin when no --body-file
    encoding: 'utf8',
    timeout: 15000,
  });
}

// ---------------------------------------------------------------------------
// Tier 2 plumbing — in-process dashboard server against the same tmpRoot
// (copied verbatim from test/api-queue-content-return-to-stage.test.js)
// ---------------------------------------------------------------------------

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

  const mod = new Module('patched-dashboard-server');
  mod.paths = module.paths;
  mod._compile(src, path.join(dashboardDir, 'server.js'));
  return mod.exports.server;
}

function request(method, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: urlPath, method },
      res => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          let parsed = raw;
          try { parsed = JSON.parse(raw); } catch (_) {}
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------

before(async () => {
  tmpRoot      = fs.mkdtempSync(path.join(os.tmpdir(), 'j-stage-watch-cli-'));
  queueDir     = path.join(tmpRoot, 'bridge', 'queue');
  stagedDir    = path.join(tmpRoot, 'bridge', 'staged');
  trashDir     = path.join(tmpRoot, 'bridge', 'trash');
  registerPath = path.join(tmpRoot, 'bridge', 'register.jsonl');

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
  initRegisterFile(registerPath);
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'heartbeat.json'), JSON.stringify({ current_slice: null }), 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'queue-order.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'staged-order.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'sessions.jsonl'), '', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'first-output.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'nog-active.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'state', 'branch-state.json'), '{}', 'utf8');

  // Pre-seed 041 so the journey's "next sequential ID" is observable as 042.
  fs.writeFileSync(
    path.join(stagedDir, '041-STAGED.md'),
    buildSliceFile({ id: '041', title: 'Pre-seeded fixture slice', status: 'STAGED' }),
    'utf8'
  );

  // O'Brien's drafted body — the mandatory sections of slice-pipeline §3.3.
  bodyFilePath = path.join(tmpRoot, 'slice-body.md');
  fs.writeFileSync(bodyFilePath, buildSliceBody(['1. The staged slice is visible in Ops.']).trim() + '\n', 'utf8');

  // Journey steps 1-2: O'Brien runs new-slice.js with scope and title.
  createResult = runNewSlice([
    '--title', NEW_TITLE,
    '--goal', NEW_GOAL,
    '--priority', 'normal',
    '--body-file', bodyFilePath,
  ]);

  server = compileServer(tmpRoot);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Steps 1-2 + Outcome 1 — real CLI writes {id}-STAGED.md into staged/
// ---------------------------------------------------------------------------

test('J-stage-and-watch-slice slice-042-ac-1 — real CLI exits 0 and writes {id}-STAGED.md into staged/, not queue/', () => {
  assert.strictEqual(
    createResult.status, 0,
    `new-slice.js must exit 0 — stderr: ${createResult.stderr}`
  );
  const stagedPath = path.join(stagedDir, '042-STAGED.md');
  assert.ok(fs.existsSync(stagedPath), '042-STAGED.md must exist in staged/');
  assert.deepEqual(
    fs.readdirSync(queueDir), [],
    'staging must not write anything into queue/ — approval does that'
  );
});

test('J-stage-and-watch-slice slice-042-ac-2 — staged file frontmatter is parseable with all 8 required fields non-empty', () => {
  const content = fs.readFileSync(path.join(stagedDir, '042-STAGED.md'), 'utf8');
  const meta = parseFrontmatter(content);
  assert.ok(meta, 'frontmatter block must be parseable');
  for (const field of REQUIRED_FIELDS) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(meta, field),
      `required frontmatter field missing: "${field}"`
    );
    assert.ok(
      String(meta[field]).trim().length > 0,
      `required frontmatter field "${field}" must be non-empty`
    );
  }
  assert.strictEqual(meta.title, NEW_TITLE, 'title must round-trip from the CLI args');
  assert.strictEqual(meta.goal, NEW_GOAL, 'goal must round-trip from the CLI args');
});

test('J-stage-and-watch-slice slice-042-ac-3 — frontmatter status is STAGED and id matches the filename', () => {
  const content = fs.readFileSync(path.join(stagedDir, '042-STAGED.md'), 'utf8');
  const meta = parseFrontmatter(content);
  assert.strictEqual(meta.status, 'STAGED', 'status must be STAGED at creation time');
  assert.strictEqual(meta.id, '042', 'frontmatter id must match the filename prefix');
  assert.strictEqual(meta.from, 'obrien', "O'Brien is the sole slice author (pipeline §3.1)");
});

// ---------------------------------------------------------------------------
// Outcome 4 — register has no events for the slice at creation time
// ---------------------------------------------------------------------------

test('J-stage-and-watch-slice slice-042-ac-4 — register contains zero events for the new slice at creation (events start at approval)', () => {
  const events = parseRegisterLines(registerPath);
  const sliceEvents = events.filter(e => String(e.slice_id || e.id || '') === '042');
  assert.strictEqual(
    sliceEvents.length, 0,
    `register must hold no events for slice 042 before approval — got: ${JSON.stringify(sliceEvents)}`
  );
});

// ---------------------------------------------------------------------------
// Outcome 1 (complete body) — all mandatory sections of pipeline §3.3
// ---------------------------------------------------------------------------

test('J-stage-and-watch-slice slice-042-ac-5 — staged file body contains all mandatory sections (pipeline §3.3)', () => {
  const content = fs.readFileSync(path.join(stagedDir, '042-STAGED.md'), 'utf8');
  const required = [
    '## Goal',
    '## Context',
    '## Scope',
    '## Out of scope',
    '## Tasks',
    '## Acceptance criteria',
    '## Quality + goal check',
    '## Files expected to change',
  ];
  for (const section of required) {
    assert.ok(
      new RegExp(`^${section.replace(/[+]/g, '\\+')}`, 'm').test(content),
      `staged slice body missing required section: "${section}"`
    );
  }
});

// ---------------------------------------------------------------------------
// Step 2 — sequential ID assignment by the real CLI
// ---------------------------------------------------------------------------

test('J-stage-and-watch-slice slice-042-ac-7 — real CLI assigns the next sequential ID (max+1, zero-padded 3 digits)', () => {
  // staged/ currently holds 041 and 042 → the next staging must be 043.
  const result = runNewSlice([
    '--title', 'Sequential-ID probe',
    '--goal', 'Verify max+1 ID assignment.',
    '--priority', 'normal',
  ]);
  assert.strictEqual(result.status, 0, `second staging must succeed — stderr: ${result.stderr}`);
  const probePath = path.join(stagedDir, '043-STAGED.md');
  assert.ok(
    fs.existsSync(probePath),
    `expected 043-STAGED.md (max 042 + 1, zero-padded) — staged/ holds: ${fs.readdirSync(stagedDir).join(', ')}`
  );
  const meta = parseFrontmatter(fs.readFileSync(probePath, 'utf8'));
  assert.strictEqual(meta.id, '043', 'frontmatter id must be the zero-padded sequential ID');
  // Remove the probe so the dashboard-endpoint assertions below see a stable staged set.
  fs.unlinkSync(probePath);
});

// ---------------------------------------------------------------------------
// Step 3 — CLI outputs the created file path
// ---------------------------------------------------------------------------

test('J-stage-and-watch-slice slice-042-ac-10 — CLI stdout contains the created slice file path', () => {
  assert.ok(
    createResult.stdout.includes(path.join(stagedDir, '042-STAGED.md')),
    `stdout must contain the created file path — got: ${createResult.stdout.slice(0, 300)}`
  );
});

// ---------------------------------------------------------------------------
// Step 2 (validation) — known failure mode: CLI rejects missing fields
// ---------------------------------------------------------------------------

test('J-stage-and-watch-slice slice-042-ac-11 — CLI rejects an invocation missing a required field and stages nothing', () => {
  const filesBefore = fs.readdirSync(stagedDir).sort();
  const result = runNewSlice([
    '--title', 'Missing-goal probe',
    '--priority', 'normal',
    // --goal deliberately omitted
  ]);
  assert.notStrictEqual(result.status, 0, 'missing --goal must produce a non-zero exit');
  assert.match(
    result.stderr, /goal/i,
    'error output must name the missing field so O\'Brien can supply it'
  );
  assert.deepEqual(
    fs.readdirSync(stagedDir).sort(), filesBefore,
    'a rejected invocation must not write any staged file'
  );
});

// ---------------------------------------------------------------------------
// Step 5 + Outcome 2 — the Queue panel's staged data source serves the slice
// ---------------------------------------------------------------------------

test('J-stage-and-watch-slice slice-042-ac-12 — GET /api/bridge/staged lists the new slice id and title exactly once', async () => {
  const res = await request('GET', '/api/bridge/staged');
  assert.strictEqual(res.status, 200, 'staged listing endpoint must return 200');
  assert.ok(Array.isArray(res.body), 'staged listing must be a JSON array');
  const matches = res.body.filter(item => item.id === '042');
  assert.strictEqual(matches.length, 1, 'the new slice must appear exactly once in the staged listing');
  assert.strictEqual(matches[0].title, NEW_TITLE, 'the listing must carry the slice title for the Queue panel row');
  assert.strictEqual(matches[0].status, 'STAGED', 'the listing must report the slice as STAGED');
});

// ---------------------------------------------------------------------------
// Outcome 3 (data-source analog) — full body is served for the expandable row
// ---------------------------------------------------------------------------

test('J-stage-and-watch-slice slice-042-ac-13 — staged listing payload carries the full slice body for row expansion', async () => {
  const res = await request('GET', '/api/bridge/staged');
  assert.strictEqual(res.status, 200);
  const item = res.body.find(entry => entry.id === '042');
  assert.ok(item, 'slice 042 must be present in the staged listing');
  assert.ok(typeof item.body === 'string' && item.body.length > 0, 'listing must include the slice body');
  for (const section of ['## Goal', '## Tasks', '## Acceptance criteria']) {
    assert.ok(
      item.body.includes(section),
      `served body must include "${section}" so the expanded row shows goal/ACs/tasks/scope`
    );
  }
});
