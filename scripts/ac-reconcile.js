#!/usr/bin/env node
'use strict';

// AC-reconcile STEP-1 driver — BUILD-1 of ADR-AC-RECONCILE.
// Loads the two locks, classifies every AC tag, writes regression/AC-RECONCILE.json, and
// routes a handoff to Julian's inbox when there is reconcile work (clears it on green).
//
//   node scripts/ac-reconcile.js            # advisory: classify + report (exit 0)
//   node scripts/ac-reconcile.js --strict   # enforcing (§11.1): exit 1 on MISSING/STALE
//
// HARD RULING (encode, never soften): reconcile may update a TEST from an AC, NEVER the
// reverse. An AC-vs-test contradiction Julian can't resolve HALTS and escalates to Philipp.

const fs = require('fs');
const path = require('path');
const { reconcile } = require('../lib/ac-reconcile');

const REPO = path.resolve(__dirname, '..');
const MANIFEST = path.join(REPO, 'regression', 'AC-MANIFEST.lock');
const COVERAGE = path.join(REPO, 'regression', 'COVERAGE.lock');
const OUT = path.join(REPO, 'regression', 'AC-RECONCILE.json');
const INBOX = path.join(REPO, '.claude', 'roles', 'bashir', 'inbox', 'RECONCILE-NEEDED.md');

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; } };

function handoff(report) {
  const list = (tags) => tags.length ? tags.map(t => `- ${t}`).join('\n') : '_(none)_';
  return [
    `# 🔧 AC reconcile needed — ${report.ts.slice(0, 10)} (STEP 1)`,
    '',
    '**To:** Julian (Bashir, QA) · **From:** the reconcile gate',
    `**Verdict:** ${report.verdict} — ${report.workSet} tag(s) need work.`,
    '',
    'Work each tag below INSIDE the blind reconcile bundle (no source visible). Update the',
    'TEST from the AC text and re-embed its `@ac-hash`. **Never edit an AC to go green** — if a',
    'test cannot pass without contradicting its AC, HALT and escalate to Philipp (the hard ruling).',
    '',
    '## STALE — guard exists but its @ac-hash no longer matches the spec',
    list(report.stale),
    '',
    '## MISSING — AC has no guard yet (needs a test)',
    list(report.missing),
    '',
    '*Full verdict: `regression/AC-RECONCILE.json`. Auto-cleared when reconcile goes green.*',
    '',
  ].join('\n');
}

function main() {
  const strict = process.argv.includes('--strict');
  const r = reconcile({
    manifest: readJson(MANIFEST) || { byTag: {} },
    coverage: readJson(COVERAGE) || { bySource: {} },
  });
  const ts = new Date().toISOString();
  const report = {
    ts, verdict: r.verdict, counts: r.counts, workSet: r.workSet,
    missing: Object.entries(r.byTag).filter(([, v]) => v.status === 'MISSING').map(([t]) => t).sort(),
    stale: Object.entries(r.byTag).filter(([, v]) => v.status === 'STALE').map(([t]) => t).sort(),
  };
  try { fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n'); } catch (_) {}
  try {
    if (r.verdict !== 'GREEN') { fs.mkdirSync(path.dirname(INBOX), { recursive: true }); fs.writeFileSync(INBOX, handoff(report)); }
    else if (fs.existsSync(INBOX)) fs.rmSync(INBOX);
  } catch (_) {}
  console.log(`AC-reconcile: ${r.verdict} — covered ${r.counts.COVERED}, stale ${r.counts.STALE}, `
    + `missing ${r.counts.MISSING}, legacy ${r.counts.LEGACY_UNHASHED}`);
  process.exit(strict && r.verdict !== 'GREEN' ? 1 : 0);
}

module.exports = { handoff };

if (require.main === module) main();
