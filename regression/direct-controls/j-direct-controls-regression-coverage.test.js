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

  // The idle gate-sequence caption (the "Step 1 — update the tests…" teaching block)
  // was removed as clutter: the numbered stepper and RUN GATE trigger already convey
  // the flow. The failure/success captions remain (asserted in the gate-button/journey
  // e2e specs) — they report what happened, they don't teach.

  // The Merge Pressure metric still names itself honestly — the standalone helper
  // caption was removed as clutter; the disclaimer now rides the pill's tooltip.
  assert.match(html, /Not a regression probability\./,
    'merge-pressure tooltip must state it is not a regression probability');
});

// The crucial process rule: "update tests" runs BEFORE the regression suite — the
// suites test intended behaviour, so the tests must be reconciled first or the gate
// fails by design. In the rewritten DevOps Station this is the dedicated
// "Pipeline A · test-update" track that must clear before Pipeline B (run-tests &
// merge) unlocks. Enforced at three surfaces: the gate-flow track, the pre-dispatch
// checkpoint, and the promote.yml workflow.
test('J-direct-controls-ops-ui slice-99811-ac-1 — test-update is a distinct pipeline that runs before the regression suite', () => {
  const html = fs.readFileSync(DASHBOARD_SRC, 'utf8');

  // The gate flow renders the test-update work as its own "Pipeline A · test-update"
  // track (owner Julian), built by dvsTrack with the scan ACs → reconcile → resolve nodes.
  assert.match(html, /dvsTrack\('Pipeline A &middot; test-update', 'Julian'/,
    'the gate flow must render a "Pipeline A · test-update" track (owner Julian)');
  assert.match(html, /l:'scan ACs'[\s\S]*?l:'reconcile'[\s\S]*?l:'resolve'/,
    'Pipeline A must carry the scan ACs → reconcile → resolve nodes');

  // The track is driven by the live tests_changed signal: when the dev changeset
  // touched no check, no test update is required (Pipeline A clears to ready/idle);
  // when ACs are outstanding, the "resolve" node surfaces the count back to the operator.
  assert.match(html, /gh \? gh\.tests_changed/, 'the gate flow must read the tests_changed signal');
  assert.match(html, /l:'resolve',s:'need',t:needCount\+' to you'/,
    'the resolve node must surface outstanding ACs ("N to you") when a test update is owed');

  // RUN GATE opens a checkpoint (not a direct dispatch) requiring the operator to
  // confirm the tests were updated before the suite runs.
  assert.match(html, /onclick="confirmUpdateTests\(\)"/,
    'RUN GATE must open the update-tests checkpoint, not dispatch directly');
  assert.match(html, /function confirmUpdateTests\(\)/, 'the checkpoint function must exist');
  assert.match(html, /id="utc-approve-btn"[^>]*>Run gate</,
    'the checkpoint requires an explicit approval (Run gate) to dispatch');

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

  // Server computes which CHECKS changed in the promotion window, via the signed
  // assertion-direction engine (lib/assert-direction.js); the engine keys checks by
  // slice-ac tag so a reword is not a false removal, and reports a direction.
  const engine = fs.readFileSync(path.resolve(__dirname, '..', '..', 'lib', 'assert-direction.js'), 'utf8');
  assert.ok(server.includes('/api/test-changes'), 'server exposes /api/test-changes');
  assert.ok(server.includes('function getTestChanges()'), 'getTestChanges computes the suite changes');
  assert.ok(server.includes('origin/main...origin/dev'), 'changes are scoped to the promotion window');
  assert.ok(server.includes("require(path.join(__dirname, '..', 'lib', 'assert-direction'))"), 'getTestChanges uses the shared direction engine (resolved as code, not via REPO_ROOT)');
  assert.ok(server.includes('classifyFileDiff'), 'getTestChanges classifies each check via the engine');
  assert.ok(engine.includes('slice-[\\w]+-ac-\\d+'), 'the engine identifies checks by slice-ac tag');
  assert.ok(server.includes('humanizeTestName'), 'test names are humanised (machine tags stripped)');

  // The checkpoint loads the plain-language changes and lets the operator STOP.
  assert.ok(html.includes("fetch('/api/test-changes')"), 'checkpoint loads the plain-language test changes');
  assert.ok(server.includes('tests_changed'), 'branch-state surfaces tests_changed so the gate-flow "Pipeline A · test-update" track can read it');
  assert.match(html, /onclick="closeUpdateTestsOverlay\(\)">Cancel</,
    'operator can stop the pipeline right there (Cancel)');
  assert.ok(html.includes('No longer checked'), 'removed checks are surfaced as a masking risk');
  assert.ok(html.includes('Now also checking'), 'added checks are surfaced');
});

// Slice D: above the plain-language list sits the GATE VERDICT — the engine's
// decision for the exact promoted changeset. The server pins the changeset and
// classifies it; the dashboard shows a banded chip and, on RED, defaults to STOP
// behind a second-reviewer acknowledgement.
test('J-direct-controls-ops-ui slice-99812-ac-1 — server exposes /api/tests-needed: the verdict for the pinned merge-base..dev changeset', () => {
  const server = fs.readFileSync(SERVER_SRC, 'utf8');
  assert.ok(server.includes('/api/tests-needed'), 'server exposes /api/tests-needed');
  assert.ok(server.includes('function getTestsNeeded()'), 'getTestsNeeded computes the gate verdict');
  assert.ok(server.includes("require(path.join(__dirname, '..', 'lib', 'tests-needed'))"),
    'the verdict comes from the shared engine (resolved as code, not via REPO_ROOT)');
  assert.ok(/merge-base['"\],\s]+origin\/main['"\],\s]+origin\/dev/.test(server),
    'the changeset is pinned to base = merge-base(origin/main, origin/dev)');
  // no-store: the operator must always see the verdict for the current dev tip.
  assert.match(server, /\/api\/tests-needed[\s\S]{0,200}?Cache-Control['"]:\s*'no-store'/,
    'the verdict endpoint must be no-store');
});

test('J-direct-controls-ops-ui slice-99812-ac-2 — the checkpoint shows the banded verdict and defaults to STOP on RED behind a non-author second-ack', () => {
  const html = fs.readFileSync(DASHBOARD_SRC, 'utf8');

  // The checkpoint fetches the verdict and renders a banded chip + pinned SHA.
  assert.ok(html.includes("fetch('/api/tests-needed')"), 'checkpoint loads the gate verdict');
  assert.match(html, /utc-verdict-chip/, 'a banded verdict chip is rendered');
  assert.match(html, /utc-verdict-sha/, 'the pinned dev SHA is shown with the verdict');
  for (const band of ['CLEAR', 'NEEDS REVIEW', 'OVERRIDDEN', 'RED FLAG']) {
    assert.ok(html.includes(band), `verdict band "${band}" must be present`);
  }

  // RED defaults to STOP: Approve is disabled until a second (non-author) reviewer acks.
  assert.match(html, /id="utc-approve-btn"/, 'the Approve button is addressable for gating');
  const apply = html.match(/function _utcApplyVerdict\([\s\S]*?\n  }/);
  assert.ok(apply, '_utcApplyVerdict must exist');
  assert.match(apply[0], /red_flag/, 'the verdict gate keys off red_flag');
  assert.match(apply[0], /approve\.disabled = true/, 'RED disables Approve by default');
  assert.match(html, /function utcToggleSecondAck\(\)/, 'a second-ack toggle gates Approve');
  assert.ok(html.includes('I am not the author'), 'the acknowledgement is explicitly non-author');
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

  // Topology dots carry subject + age tooltips; the Merge Pressure pill tooltip
  // carries churn + critical-file context (the footer stats line was removed as clutter).
  assert.match(html, /d\.subject \? _promoteEsc\(d\.subject\)/, 'dot tooltips must carry commit subjects');
  assert.match(html, /\$\{churn\} lines churn/, 'the merge-pressure tooltip must surface churn');
  assert.match(html, /critical file/, 'the merge-pressure tooltip must surface critical-file touches');
});

test('J-direct-controls-ops-ui slice-99808-ac-3 — the shipped dashboard wires the Bashir crew card: active, clickable, opens the crew dossier (coverage now lives in his Artifacts tab)', () => {
  const html = fs.readFileSync(DASHBOARD_SRC, 'utf8');

  // The crew-dossier-tabs slice superseded the old direct-to-coverage click:
  // every crew card now opens the crew menu (New / Resume conversation · Inspect role),
  // and Bashir's coverage overview moved into his Artifacts tab. The
  // /api/regression/coverage endpoint stays for back-compat (asserted in ac-1/ac-2).
  //
  // Crew identity is mode-dependent (ROLE map): the card shows the neutral HUMAN name
  // in light mode (Priya) and the DS9 CHARACTER (Bashir) only in the LCARS skin. So the
  // card is matched by its stable data-role key — never the display name — and we assert
  // the light-mode human label here plus the LCARS lore name in the ROLE map below.
  const cardMatch = html.match(/<div class="crew-card ([^"]*)"[^>]*data-role="bashir"[^>]*onclick="openCrewMenu\(event, 'bashir'\)"[^>]*>([\s\S]{0,400}?)<\/div>\s*<\/div>/);
  assert.ok(cardMatch, "the Bashir crew card must be keyed by data-role=\"bashir\" and open the crew menu (onclick=\"openCrewMenu(event, 'bashir')\")");
  assert.match(cardMatch[1], /\bactive\b/, 'the card must be active — planned cards have pointer-events: none');
  assert.match(cardMatch[1], /\bcrew-card-clickable\b/, 'the card must carry crew-card-clickable');
  assert.doesNotMatch(cardMatch[1], /\bplanned\b/, 'the card must not be planned/inert');
  // Light mode: the card shows the neutral human name.
  assert.match(cardMatch[2], /Priya/, "the card's light-mode label must be the human name (Priya)");
  // LCARS mode: the DS9 character name is the source of truth in the ROLE identity map.
  assert.match(html, /bashir:\s*\{[^}]*lore:\s*'Bashir'[^}]*name:\s*'Priya'/,
    "the ROLE identity map must carry the DS9 lore name (Bashir, shown in LCARS) and the human name (Priya, shown in light mode)");

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
