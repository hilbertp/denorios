'use strict';

/**
 * Journey: J-direct-controls-ops-ui — addendum: Bashir crew card (2026-06-12)
 * Category: Direct controls
 *
 * Philipp's spec (verbal, 2026-06-12): the Bashir crew card on the Ops Center
 * is active and clickable; clicking it opens a regression-catalogue coverage
 * overview readable by PMs. Implementation surface:
 *   - GET /api/regression/coverage serves regression/COVERAGE.md as
 *     { markdown, updated } (404 { error: 'coverage_not_found' } when absent)
 *   - the crew card is wired to viewRegressionCatalogue(), which renders the
 *     markdown into the regression-coverage overlay
 *
 * Tier 2 (in-process compiled dashboard server, REPO_ROOT rewritten into an
 * os.tmpdir() root — #99992: live bridge/* and regression/* never touched)
 * for the endpoint contract; a static source-contract check pins the card
 * wiring in the real dashboard/lcars-dashboard.html (the Tier-2 harness stubs
 * the HTML, so the wiring must be asserted against the shipped file).
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');

const SERVER_SRC = path.resolve(__dirname, '..', '..', 'dashboard', 'server.js');
const DASHBOARD_SRC = path.resolve(__dirname, '..', '..', 'dashboard', 'lcars-dashboard.html');

const FIXTURE_COVERAGE = [
  '# Regression Catalogue — Coverage',
  '',
  '| Fact | Value |',
  '|---|---|',
  '| Total tests | 165 |',
  '',
  'Fixture body for the Bashir crew card overview.',
  '',
].join('\n');

let tmpRoot;
let server;
let port;
let coveragePath;

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

  const mod = new Module('patched-dashboard-server-regression-coverage');
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

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j-regression-coverage-'));
  for (const dir of [
    path.join(tmpRoot, 'bridge', 'queue'),
    path.join(tmpRoot, 'bridge', 'staged'),
    path.join(tmpRoot, 'bridge', 'trash'),
    path.join(tmpRoot, 'bridge', 'control'),
    path.join(tmpRoot, 'bridge', 'errors'),
    path.join(tmpRoot, 'bridge', 'state'),
    path.join(tmpRoot, 'dashboard'),
    path.join(tmpRoot, 'regression'),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'register.jsonl'), '', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'heartbeat.json'), JSON.stringify({ current_slice: null }), 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'queue-order.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'staged-order.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'sessions.jsonl'), '', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'first-output.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'nog-active.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'bridge', 'state', 'branch-state.json'), '{}', 'utf8');

  coveragePath = path.join(tmpRoot, 'regression', 'COVERAGE.md');
  fs.writeFileSync(coveragePath, FIXTURE_COVERAGE, 'utf8');

  server = compileServer(tmpRoot);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('J-direct-controls-ops-ui slice-99808-ac-1 — GET /api/regression/coverage serves regression/COVERAGE.md verbatim with an ISO updated timestamp', async () => {
  const res = await request('GET', '/api/regression/coverage');

  assert.equal(res.status, 200, 'coverage endpoint must answer 200 when COVERAGE.md exists');
  assert.equal(res.body.markdown, FIXTURE_COVERAGE,
    'the served markdown must be the COVERAGE.md content byte-for-byte — the overlay renders exactly what QA maintains');
  assert.ok(!Number.isNaN(Date.parse(res.body.updated)),
    'updated must be a parseable timestamp so the overlay can show data freshness');
});

test('J-direct-controls-ops-ui slice-99808-ac-2 — missing COVERAGE.md yields 404 coverage_not_found, not a crash or empty 200', async () => {
  fs.rmSync(coveragePath, { force: true });
  try {
    const res = await request('GET', '/api/regression/coverage');
    assert.equal(res.status, 404, 'absent coverage file must be a clean 404');
    assert.equal(res.body.error, 'coverage_not_found',
      'the error code must name the condition so the overlay can explain it');
  } finally {
    fs.writeFileSync(coveragePath, FIXTURE_COVERAGE, 'utf8');
  }
});

test('J-direct-controls-ops-ui slice-99808-ac-3 — the shipped dashboard wires the Bashir crew card: active, clickable, opens the coverage overlay', () => {
  const html = fs.readFileSync(DASHBOARD_SRC, 'utf8');

  // The card itself: active (not planned/inert) and wired to the handler.
  const cardMatch = html.match(/<div class="crew-card ([^"]*)"[^>]*onclick="viewRegressionCatalogue\(\)"[^>]*>([\s\S]{0,400}?)Bashir/);
  assert.ok(cardMatch, 'the Bashir crew card must carry onclick="viewRegressionCatalogue()"');
  assert.match(cardMatch[1], /\bactive\b/, 'the card must be active — planned cards have pointer-events: none');
  assert.doesNotMatch(cardMatch[1], /\bplanned\b/, 'the card must not be planned/inert');

  // The overlay and its handler functions exist and fetch the endpoint.
  assert.match(html, /id="regression-coverage-overlay"/, 'the coverage overlay markup must exist');
  assert.match(html, /async function viewRegressionCatalogue\(\)/, 'the open handler must be defined');
  assert.match(html, /function closeRegressionCoverage\(\)/, 'the close handler must be defined');
  assert.match(html, /fetch\('\/api\/regression\/coverage'\)/, 'the handler must fetch the coverage endpoint');
});
