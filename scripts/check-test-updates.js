#!/usr/bin/env node
'use strict';
// CHECK FOR TEST UPDATES — stage ① CLI of the two-stage merge gate.
//
//   node scripts/check-test-updates.js            # human summary
//   node scripts/check-test-updates.js --json      # machine JSON (dashboard / API)
//
// Drains the ACs (AC-MANIFEST.lock), reconciles them against the test suite
// (COVERAGE.lock), applies any recorded human decisions (regression/AC-DECISIONS.json),
// and triages each: high-confidence acts (pass / auto update-test), low-confidence
// (MISSING) is flagged for the operator. Writes regression/AC-CHECK.json. Advisory —
// exits 0; the merge gate consults `ready` to decide whether to unlock.

const fs = require('fs');
const path = require('path');
const { reconcile } = require('../lib/ac-reconcile');
const { triage } = require('../lib/check-test-updates');

const REPO = path.resolve(__dirname, '..');
const MANIFEST = path.join(REPO, 'regression', 'AC-MANIFEST.lock');
const COVERAGE = path.join(REPO, 'regression', 'COVERAGE.lock');
const DECISIONS = path.join(REPO, 'regression', 'AC-DECISIONS.json');
const OUT = path.join(REPO, 'regression', 'AC-CHECK.json');
const asJson = process.argv.includes('--json');

const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return fallback; } };

function build() {
  const manifest = readJson(MANIFEST, { byTag: {} });
  const coverage = readJson(COVERAGE, { bySource: {} });
  const decisions = readJson(DECISIONS, {});
  const rec = reconcile({ manifest, coverage });
  const report = triage({ reconcile: rec, manifest, decisions });
  report.ts = new Date().toISOString();
  return report;
}

const A = { 'decide': '?', 'update-test': '↻', 'pass': '✓', 'kept': '–' };

function render(r) {
  const L = [];
  L.push(`Check for test updates: ${r.ready ? '✓ READY — merge gate unlocked' : '● NEEDS YOU — ' + r.summary.flagged + ' AC(s) to decide'}`);
  L.push(`  checked ${r.summary.checked} · ${r.summary.passed} already covered · ${r.summary.autoUpdate} auto-update · ${r.summary.flagged} flagged · ${r.summary.kept} kept`);
  if (r.flagged.length) {
    L.push('');
    L.push('  LOW CONFIDENCE — your call (Update the tests, or Keep as is):');
    for (const it of r.flagged) L.push(`    ? ${it.tag} — ${it.reason}`);
  }
  const auto = r.items.filter(i => i.action === 'update-test');
  if (auto.length) {
    L.push('');
    L.push('  HIGH CONFIDENCE — Bashir auto-updates these tests from their AC:');
    for (const it of auto) L.push(`    ↻ ${it.tag} — ${it.reason}`);
  }
  L.push('');
  L.push(r.ready
    ? '  → Stage ① clear. The RUN GATE & MERGE button is unlocked.'
    : '  → Resolve each flagged AC, then re-check. The merge gate stays locked until then.');
  return L.join('\n');
}

function main() {
  let report;
  try { report = build(); }
  catch (e) {
    report = { ready: false, verdict: 'ERROR', items: [], flagged: [],
      summary: { checked: 0, passed: 0, autoUpdate: 0, flagged: 0, kept: 0 },
      error: String(e && e.message || e), ts: new Date().toISOString() };
  }
  try { fs.writeFileSync(OUT, JSON.stringify(report, null, 1)); } catch (_) {}
  process.stdout.write((asJson ? JSON.stringify(report, null, 1) : render(report)) + '\n');
  process.exit(0);
}

if (require.main === module) main();
module.exports = { build };
