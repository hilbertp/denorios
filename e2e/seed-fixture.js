'use strict';

/**
 * Builds a deterministic REPO_ROOT fixture for the Playwright e2e suite.
 *
 * The real dashboard frontend (lcars-dashboard.html) is served unchanged; only the
 * DATA layer (bridge/, .claude/, regression/, docs/) points here via DASHBOARD_REPO_ROOT,
 * so journeys run against known state with no risk to the live bridge.
 *
 * Rebuilt fresh on every run (config load) and re-callable from a test's beforeEach to
 * reset state before a mutating journey (approve, auto-approve).
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const REPO = path.resolve(__dirname, '..');
const ROOT = path.join(os.tmpdir(), 'lob-e2e-fixture');

const w = (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };

function stagedSlice(id, title) {
  return `---\nid: "${id}"\ntitle: "${title}"\nfrom: obrien\nto: rom\npriority: normal\n`
       + `created: "2026-06-13T00:00:00.000Z"\nstatus: "STAGED"\n---\n\n`
       + `## Goal\n\nE2E fixture proposal ${id}.\n\n## Acceptance criteria\n\n- it works\n`;
}

function seedFixture() {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(ROOT, { recursive: true });

  // Read-only content the dashboard surfaces (crew dossiers, artifacts, coverage).
  for (const dir of ['.claude', 'regression', 'docs']) {
    try { fs.cpSync(path.join(REPO, dir), path.join(ROOT, dir), { recursive: true }); } catch (_) {}
  }

  // Deterministic bridge/ state.
  const b = path.join(ROOT, 'bridge');
  for (const d of ['queue', 'staged', 'trash', 'control', 'errors', 'state', 'logs']) {
    fs.mkdirSync(path.join(b, d), { recursive: true });
  }
  // The server require()s bridge JS modules from REPO_ROOT (lifecycle-translate at boot,
  // orchestrator lazily on gate-start) — copy them so requires resolve.
  for (const f of fs.readdirSync(path.join(REPO, 'bridge'))) {
    if (f.endsWith('.js')) {
      try { fs.cpSync(path.join(REPO, 'bridge', f), path.join(b, f)); } catch (_) {}
    }
  }
  w(path.join(b, 'register.jsonl'), '');
  w(path.join(b, 'heartbeat.json'), JSON.stringify({ current_slice: null, ts: '2026-06-13T00:00:00.000Z' }));
  w(path.join(b, 'queue-order.json'), '[]');
  w(path.join(b, 'staged-order.json'), JSON.stringify(['9001', '9002']));
  w(path.join(b, 'sessions.jsonl'), '');
  w(path.join(b, 'first-output.json'), '{}');
  w(path.join(b, 'nog-active.json'), '{}');
  w(path.join(b, 'state', 'branch-state.json'),
    JSON.stringify({ gate: { status: 'IDLE' }, dev: { commits_ahead_of_main: 0 } }, null, 2));

  // Two staged proposals → Engineering Queue "Proposed Improvement" section.
  w(path.join(b, 'staged', '9001-STAGED.md'), stagedSlice('9001', 'E2E — first proposal'));
  w(path.join(b, 'staged', '9002-STAGED.md'), stagedSlice('9002', 'E2E — second proposal'));

  return ROOT;
}

// Light reset for mutating journeys: restore the staged proposals + empty the queue,
// WITHOUT nuking the tree the live server is polling (that would crash it mid-request).
function resetQueueState() {
  const b = path.join(ROOT, 'bridge');
  for (const d of ['staged', 'queue']) {
    const dir = path.join(b, d);
    try { for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true }); } catch (_) {}
  }
  w(path.join(b, 'staged-order.json'), JSON.stringify(['9001', '9002']));
  w(path.join(b, 'queue-order.json'), '[]');
  w(path.join(b, 'staged', '9001-STAGED.md'), stagedSlice('9001', 'E2E — first proposal'));
  w(path.join(b, 'staged', '9002-STAGED.md'), stagedSlice('9002', 'E2E — second proposal'));
}

module.exports = seedFixture;
module.exports.ROOT = ROOT;
module.exports.resetQueueState = resetQueueState;
