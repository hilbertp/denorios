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
const PROMOTE_YML = path.resolve(__dirname, '..', '..', '.github', 'workflows', 'promote.yml');

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

test('J-direct-controls-ops-ui slice-99809-ac-1 — the RUN GATE button acknowledges the click before any network: DISPATCHING state rendered ahead of the fetch', () => {
  const html = fs.readFileSync(DASHBOARD_SRC, 'utf8');

  // The dispatch handler must render the in-flight state BEFORE the fetch —
  // immediate visual acknowledgement is the spec (Philipp, 2026-06-12).
  const handler = html.match(/async function dispatchPromoteGate\(\)\s*{([\s\S]*?)\n  }/);
  assert.ok(handler, 'dispatchPromoteGate must exist in the shipped dashboard');
  const fetchIdx = handler[1].indexOf("fetch('/api/promote/dispatch'");
  const ackIdx = handler[1].indexOf('renderPromoteAction(');
  assert.ok(fetchIdx > -1 && ackIdx > -1, 'handler must both re-render and fetch');
  assert.ok(ackIdx < fetchIdx,
    'the immediate re-render (DISPATCHING state) must precede the network call');
  assert.match(html, /DISPATCHING&#8230;/, 'the DISPATCHING button label must exist');

  // While running, the UI ticks: elapsed readout plus a 1s ticker so the
  // panel never freezes between branch-state polls.
  assert.match(html, /_gateElapsedLabel/, 'elapsed-time readout must exist');
  assert.match(html, /GATE RUNNING/, 'running button state must exist');
});

test('J-direct-controls-ops-ui slice-99809-ac-2 — the shipped dashboard explains promote in plain language at every surface (button, gate sequence, helper)', () => {
  const html = fs.readFileSync(DASHBOARD_SRC, 'utf8');

  // The button explains the consequence of pressing it.
  assert.match(html, /only on green does promote\.yml fast-forward origin\/main/,
    'button tooltip must explain green -> fast-forward');
  assert.match(html, /Nothing merges automatically/,
    'button tooltip must state nothing is automatic');

  // The Gate Sequence caption replaces the old CI-strip rows: it leads with updating
  // the tests, then explains that a failed step stops the gate (main untouched) and
  // all-green promotes to main.
  assert.match(html, /Step 1 — update the regression &amp; e2e tests/,
    'gate-sequence caption must lead with updating the tests');
  assert.match(html, /step fails → <strong>STOP<\/strong>, main untouched/,
    'gate-sequence caption must explain a failed step stops and leaves main untouched');
  assert.match(html, /all pass → promoted to origin\/main/,
    'gate-sequence caption must explain all-green promotes to main');

  // The Merge Pressure helper (header-level info) names the metric honestly.
  assert.match(html, /it is <strong>not<\/strong> a regression probability/,
    'merge-pressure helper must state it is not a regression probability');
});

// The crucial process rule: "update tests" is step 1 of the gate — the suites test
// intended behaviour, so the tests must be updated BEFORE the suite runs or it fails
// by design. This is enforced at three surfaces: the gate-sequence step, the
// pre-dispatch checkpoint, and the promote.yml workflow.
test('J-direct-controls-ops-ui slice-99811-ac-1 — "update tests" is the explicit first step of the gate, before the regression suite runs', () => {
  const html = fs.readFileSync(DASHBOARD_SRC, 'utf8');

  // Gate sequence renders an "Update tests" step ahead of the GitHub phases.
  assert.match(html, /<span class="gflow-label">Update tests<\/span>/,
    'gate sequence must render an "Update tests" step');

  // RUN GATE opens a checkpoint (not a direct dispatch) requiring the operator to
  // confirm the tests were updated before the suite runs.
  assert.match(html, /onclick="confirmUpdateTests\(\)"/,
    'RUN GATE must open the update-tests checkpoint, not dispatch directly');
  assert.match(html, /function confirmUpdateTests\(\)/, 'the checkpoint function must exist');
  assert.ok(html.includes('Approve &amp; run gate'), 'the checkpoint requires an explicit approval to run');

  // promote.yml runs an "Update tests" step strictly before the regression suite.
  const yml = fs.readFileSync(PROMOTE_YML, 'utf8');
  const updateIdx = yml.indexOf('Update tests — what changed in this promotion');
  const gateIdx   = yml.search(/node --test 'regression/);
  assert.ok(updateIdx !== -1, 'promote.yml has an "Update tests" step');
  assert.ok(gateIdx !== -1, 'promote.yml runs the regression suite');
  assert.ok(updateIdx < gateIdx, 'the "Update tests" step precedes the regression suite');
});

// The operator must be able to tell an INTENDED spec change from a masked regression,
// in plain language, and approve or STOP the pipeline right there.
test('J-direct-controls-ops-ui slice-99811-ac-2 — the gate surfaces regression/e2e check changes in plain language for the operator to approve or stop', () => {
  const server = fs.readFileSync(SERVER_SRC, 'utf8');
  const html   = fs.readFileSync(DASHBOARD_SRC, 'utf8');

  // Server computes which CHECKS changed (added / removed / reworded) in the
  // promotion window, identified by slice-ac tag so a reword is not a false removal,
  // with machine tags stripped for human reading.
  assert.ok(server.includes('/api/test-changes'), 'server exposes /api/test-changes');
  assert.ok(server.includes('function getTestChanges()'), 'getTestChanges computes the suite changes');
  assert.ok(server.includes('origin/main...origin/dev'), 'changes are scoped to the promotion window');
  assert.ok(server.includes('slice-[\\w]+-ac-\\d+'), 'checks identified by slice-ac tag (a reword is not a false removal)');
  assert.ok(server.includes('humanizeTestName'), 'test names are humanised (machine tags stripped)');

  // The checkpoint loads the plain-language changes and lets the operator STOP.
  assert.ok(html.includes("fetch('/api/test-changes')"), 'checkpoint loads the plain-language test changes');
  assert.ok(html.includes("Stop — don't run"), 'operator can stop the pipeline right there');
  assert.ok(html.includes('No longer checked'), 'removed checks are surfaced as a masking risk');
  assert.ok(html.includes('Now also checking'), 'added checks are surfaced');
});

test('J-direct-controls-ops-ui slice-99810-ac-1 — branch-state enrichment: server exposes run recency, commit subjects/ages, and churn split for the topology panel', () => {
  const src = fs.readFileSync(SERVER_SRC, 'utf8');

  // CI run recency: gh run list must request updatedAt and surface it.
  assert.match(src, /--json=status,conclusion,number,url,headSha,updatedAt/,
    'ci query must request the run timestamp');
  assert.match(src, /updated_at:\s*run\.updatedAt\s*\|\|\s*null/,
    'ci payload must carry updated_at');

  // Topology dots: dev commits must carry subject + age (format %H %ct %s).
  assert.match(src, /--format=%H %ct %s/,
    'dev_commits log must include commit time and subject');
  assert.match(src, /subject:\s*subj/, 'dev_commits entries must carry the subject');
  assert.match(src, /age_s:\s*isNaN\(ct\)/, 'dev_commits entries must carry age_s');

  // Churn split for the footer detail line.
  assert.match(src, /churn_ins:\s*churnIns/, 'rr must expose insertions');
  assert.match(src, /churn_del:\s*churnDel/, 'rr must expose deletions');
});

test('J-direct-controls-ops-ui slice-99810-ac-2 — fast green runs stay visible: stale-coverage notice, run age, and run-change flash are wired in the shipped dashboard', () => {
  const html = fs.readFileSync(DASHBOARD_SRC, 'utf8');

  // A verdict for an older commit must be called out, not silently shown green.
  assert.match(html, /awaiting CI/, 'stale-coverage notice must exist');
  assert.match(html, /devTip7 && ciSha7 && devTip7 !== ciSha7/,
    'staleness must be derived from ci.head_sha vs origin/dev tip');

  // Run age on terminal states + flash on run-number change.
  assert.match(html, /ci\.updated_at/, 'run age must come from the real run timestamp');
  assert.match(html, /ci-strip-row-flash/, 'run-change flash class must be wired');
  assert.match(html, /_ciLastSeenSig/, 'run-change detection state must exist');

  // Topology dots carry subject + age tooltips; footer carries churn split.
  assert.match(html, /d\.subject \? _promoteEsc\(d\.subject\)/, 'dot tooltips must carry commit subjects');
  assert.match(html, /churn_ins/, 'footer must use the churn split');
  assert.match(html, /critical file/, 'footer must surface critical-file touches');
});

test('J-direct-controls-ops-ui slice-99808-ac-3 — the shipped dashboard wires the Bashir crew card: active, clickable, opens the crew dossier (coverage now lives in his Artifacts tab)', () => {
  const html = fs.readFileSync(DASHBOARD_SRC, 'utf8');

  // The crew-dossier-tabs slice superseded the old direct-to-coverage click:
  // every crew card now opens the crew menu (New / Resume conversation · Inspect role),
  // and Bashir's coverage overview moved into his Artifacts tab. The
  // /api/regression/coverage endpoint stays for back-compat (asserted in ac-1/ac-2).
  const cardMatch = html.match(/<div class="crew-card ([^"]*)"[^>]*onclick="openCrewMenu\(event, 'bashir'\)"[^>]*>([\s\S]{0,400}?)Bashir/);
  assert.ok(cardMatch, "the Bashir crew card must be clickable and open the crew menu (onclick=\"openCrewMenu(event, 'bashir')\")");
  assert.match(cardMatch[1], /\bactive\b/, 'the card must be active — planned cards have pointer-events: none');
  assert.match(cardMatch[1], /\bcrew-card-clickable\b/, 'the card must carry crew-card-clickable');
  assert.doesNotMatch(cardMatch[1], /\bplanned\b/, 'the card must not be planned/inert');

  // The crew menu + dossier overlay exist, and "Inspect role" opens the dossier.
  assert.match(html, /id="crew-menu"/, 'the crew action menu markup must exist');
  assert.match(html, /onclick="inspectCrewRole\(\)"/, 'the menu must offer "Inspect role"');
  assert.match(html, /id="crew-dossier-overlay"/, 'the crew dossier overlay markup must exist');
  assert.match(html, /async function openCrewDossier\(/, 'the dossier open handler must be defined');

  // Back-compat: the legacy coverage overlay + endpoint fetch still exist for direct callers.
  assert.match(html, /id="regression-coverage-overlay"/, 'the coverage overlay markup must still exist (back-compat)');
  assert.match(html, /fetch\('\/api\/regression\/coverage'\)/, 'the coverage endpoint fetch must still exist (back-compat)');
});

test('J-direct-controls-ops-ui slice-99808-ac-4 — Bashir\'s dossier surfaces the regression coverage as a clickable Artifacts entry (crew-dossier-tabs)', async () => {
  // Inspect role → Artifacts: the coverage overview is reachable from Bashir's dossier.
  const dossier = await request('GET', '/api/crew/bashir/dossier');
  assert.equal(dossier.status, 200, 'bashir dossier must answer 200');
  assert.ok(Array.isArray(dossier.body.artifacts), 'dossier must include an artifacts array');
  const coverage = dossier.body.artifacts.find(a => a.path === 'regression/COVERAGE.md');
  assert.ok(coverage, 'Bashir\'s Artifacts tab must list regression/COVERAGE.md');
  assert.equal(coverage.kind, 'md', 'coverage artifact must render as markdown');

  // The artifact content endpoint serves that file (membership-guarded).
  const art = await request('GET', '/api/crew/artifact?role=bashir&path=regression%2FCOVERAGE.md');
  assert.equal(art.status, 200, 'declared artifact must be served');
  assert.match(art.body.content, /Regression Catalogue/, 'served content must be the coverage markdown');

  // Allowlist + traversal guards: unknown role → 404; non-declared path → 404.
  assert.equal((await request('GET', '/api/crew/dukat/dossier')).status, 404, 'unknown role must 404');
  assert.equal((await request('GET', '/api/crew/artifact?role=bashir&path=..%2F..%2Fetc%2Fpasswd')).status, 404, 'traversal must 404');
});
