#!/usr/bin/env node
'use strict';
// Test Drift Gate — the operator-facing pre-gate review (BUILD-1, show + decide).
//
//   node scripts/test-drift.js            # plain-English review of dev's pending changes
//   node scripts/test-drift.js --json     # machine JSON (for the dashboard / API)
//
// Pins the SAME changeset the promote gate will judge: base = merge-base(origin/main,
// HEAD), head = HEAD, two-dot. Runs the Test-Update classifier and re-buckets it into
// PROCEED / REVIEW / STOP with two plain-English piles. ADVISORY — this is a review, not
// an enforcer (the Test-Update Gate enforces at promote). Always exits 0; the human's
// OK/STOP is the decision. Writes regression/TEST-DRIFT.json for the dashboard surface.

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { classify } = require('../lib/tests-needed');
const { drift, render } = require('../lib/test-drift');

const REPO = path.resolve(__dirname, '..');
const OUT = path.join(REPO, 'regression', 'TEST-DRIFT.json');
const git = (a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8' }).trim();

function resolveRange() {
  const head = git(['rev-parse', 'HEAD']);
  let baseRef = 'origin/main';
  try { git(['rev-parse', '--verify', 'origin/main']); } catch (_) { baseRef = 'main'; }
  const base = git(['merge-base', baseRef, 'HEAD']);
  return { base, head };
}

// Build the drift report for the current changeset. Reused by the dashboard server.
// Fails safe to a STOP report (never throws) so an advisory review can't crash a caller.
function build() {
  try {
    const { base, head } = resolveRange();
    const report = drift(classify({ base, head, repoRoot: REPO }));
    report.ts = new Date().toISOString();
    return report;
  } catch (e) {
    return { decision: 'unknown', action: 'STOP',
      headline: 'Could not read the changeset: ' + (e && e.message || e),
      regression: [], deliberate: [], declared: [],
      counts: { regression: 0, deliberate: 0, declared: 0 }, base: null, head: null,
      ts: new Date().toISOString() };
  }
}

function main() {
  const report = build();
  try { fs.writeFileSync(OUT, JSON.stringify(report, null, 1)); } catch (_) {}
  process.stdout.write((process.argv.includes('--json') ? JSON.stringify(report, null, 1) : render(report)) + '\n');
  process.exit(0); // advisory — the human's OK/STOP is the decision
}

if (require.main === module) main();
module.exports = { build, resolveRange };
