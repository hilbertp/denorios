#!/usr/bin/env node
'use strict';

// AC-reconcile STEP-1 driver — BUILD-1 of ADR-AC-RECONCILE + the NEW-AC drain feed.
//
// Every pipeline/gate run, this surfaces the ACs commissioned (or changed) since Julian's
// last drain into his inbox as a worklist, and classifies coverage. Julian triages — decides
// which ACs deliberately change behaviour (→ a test update) — then DRAINS:
//
//   node scripts/ac-reconcile.js            # advisory: classify + write the drain worklist (exit 0)
//   node scripts/ac-reconcile.js --strict   # enforcing (§11.1): exit 1 on MISSING/STALE
//   node scripts/ac-reconcile.js --drain    # Julian: mark all current ACs triaged; clear the feed
//
// HARD RULING (encode, never soften): reconcile may update a TEST from an AC, NEVER the
// reverse. An AC-vs-test contradiction Julian can't resolve HALTS and escalates to Philipp.

const fs = require('fs');
const path = require('path');
const { reconcile, newAcs, drainLedger } = require('../lib/ac-reconcile');

const REPO = path.resolve(__dirname, '..');
const MANIFEST = path.join(REPO, 'regression', 'AC-MANIFEST.lock');
const COVERAGE = path.join(REPO, 'regression', 'COVERAGE.lock');
const DRAINED = path.join(REPO, 'regression', 'AC-DRAINED.json');
const OUT = path.join(REPO, 'regression', 'AC-RECONCILE.json');
const INBOX_DIR = path.join(REPO, '.claude', 'roles', 'bashir', 'inbox');
const RECONCILE_NEEDED = path.join(INBOX_DIR, 'RECONCILE-NEEDED.md');
const NEW_ACS = path.join(INBOX_DIR, 'NEW-ACS.md');

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; } };
const rm = (p) => { try { if (fs.existsSync(p)) fs.rmSync(p); } catch (_) {} };
const write = (p, s) => { try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); } catch (_) {} };
const serialize = (o) => JSON.stringify(o, null, 2) + '\n';

function reconcileHandoff(report) {
  const list = (tags) => tags.length ? tags.map(t => `- ${t}`).join('\n') : '_(none)_';
  return [
    `# 🔧 AC reconcile needed — ${report.ts.slice(0, 10)} (STEP 1)`, '',
    '**To:** Julian (Bashir, QA) · **From:** the reconcile gate',
    `**Verdict:** ${report.verdict} — ${report.workSet} tag(s) need work.`, '',
    'Update the TEST from the AC text and re-embed its `@ac-hash`, INSIDE the blind reconcile',
    'bundle (no source visible). **Never edit an AC to go green** — if a test cannot pass without',
    'contradicting its AC, HALT and escalate to Philipp (the hard ruling).', '',
    '## STALE — guard exists but its @ac-hash no longer matches the spec', list(report.stale), '',
    '## MISSING — AC has no guard yet (needs a test)', list(report.missing), '',
    '*Full verdict: `regression/AC-RECONCILE.json`. Auto-cleared when reconcile goes green.*', '',
  ].join('\n');
}

function newAcsWorklist(news, ts) {
  const lines = [
    `# 🆕 New acceptance criteria to drain — ${ts.slice(0, 10)}`, '',
    '**To:** Julian (Bashir, QA)',
    `**${news.length} AC(s)** were commissioned or changed since your last drain. For EACH, decide:`, '',
    '- Deliberately **changes existing behaviour**? → update/add the guard test and re-embed its',
    '  `// @ac-hash: <tag> <hash>` — that is the test update; the gate audits it.',
    '- **New behaviour, no guard** (coverage MISSING)? → write the test.',
    '- **Does not change the suite**? → no test change; it drains as-is.',
    '',
    '**Never edit an AC to go green.** If a test cannot pass without contradicting its AC → HALT and escalate to Philipp.',
    '',
  ];
  for (const a of news) {
    lines.push(`## ${a.tag}  ·  ${a.changed ? 'CHANGED' : 'NEW'}  ·  coverage: ${a.coverage}  ·  slice ${a.slice}`);
    lines.push(`> ${a.text}`);
    lines.push('');
  }
  lines.push('When you have triaged them all:  `node scripts/ac-reconcile.js --drain`');
  lines.push('(advances `regression/AC-DRAINED.json` so these stop showing as new — commit it.)');
  lines.push('');
  return lines.join('\n');
}

function main() {
  const manifest = readJson(MANIFEST) || { byTag: {} };

  // Julian's drain: record every current AC as triaged, clear the feed, done.
  if (process.argv.includes('--drain')) {
    write(DRAINED, serialize(drainLedger(manifest)));
    rm(NEW_ACS);
    const n = Object.keys(manifest.byTag || {}).length;
    console.log(`AC-reconcile: drained ${n} tag(s) → regression/AC-DRAINED.json (commit it). New-AC feed cleared.`);
    process.exit(0);
  }

  // One flag controls both halves of AC custody (§11.1): the gate's red_flag and this step.
  const strict = process.argv.includes('--strict') || process.env.AC_CUSTODY_ENFORCE === '1';
  const r = reconcile({ manifest, coverage: readJson(COVERAGE) || { bySource: {} } });
  const drained = readJson(DRAINED) || { drained: {} };
  const news = newAcs({ manifest, drained, reconcileByTag: r.byTag });
  const ts = new Date().toISOString();

  const report = {
    ts, verdict: r.verdict, counts: r.counts, workSet: r.workSet,
    missing: Object.entries(r.byTag).filter(([, v]) => v.status === 'MISSING').map(([t]) => t).sort(),
    stale: Object.entries(r.byTag).filter(([, v]) => v.status === 'STALE').map(([t]) => t).sort(),
    newAcCount: news.length, newAcs: news,
  };
  write(OUT, serialize(report));

  // Surface the reconcile work set (clears on green) ...
  if (r.verdict !== 'GREEN') write(RECONCILE_NEEDED, reconcileHandoff(report));
  else rm(RECONCILE_NEEDED);
  // ... and the NEW-AC drain feed (clears when nothing is undrained).
  if (news.length) write(NEW_ACS, newAcsWorklist(news, ts));
  else rm(NEW_ACS);

  console.log(`AC-reconcile: ${r.verdict} — covered ${r.counts.COVERED}, stale ${r.counts.STALE}, `
    + `missing ${r.counts.MISSING}, legacy ${r.counts.LEGACY_UNHASHED} · ${news.length} new AC(s) to drain`);
  process.exit(strict && r.verdict !== 'GREEN' ? 1 : 0);
}

module.exports = { reconcileHandoff, newAcsWorklist };

if (require.main === module) main();
