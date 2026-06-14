#!/usr/bin/env node
'use strict';
// CLI for the Test-Update Gate (ADR-TEST-UPDATE-GATE, Slice B).
//
//   node scripts/tests-needed.js            # human summary (advisory; exit 0)
//   node scripts/tests-needed.js --json     # machine JSON (advisory; exit 0)
//   node scripts/tests-needed.js --strict   # ENFORCING: exit 1 on red_flag or input drift
//
// Pins the changeset to the EXACT commit being promoted: base = merge-base(origin/main,
// HEAD), head = HEAD, diffed TWO-DOT. In --strict it FAILS CLOSED if HEAD != origin/dev
// (a push raced the gate), so the classified diff is always the promoted diff.

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { classify } = require('../lib/tests-needed');

const REPO_ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const strict = args.includes('--strict');
const asJson = args.includes('--json');
const git = (a) => execFileSync('git', a, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();

function main() {
  let head, devTip, base;
  try {
    head = git(['rev-parse', 'HEAD']);
    devTip = git(['rev-parse', 'origin/dev']);
    base = git(['merge-base', 'origin/main', 'HEAD']);
  } catch (e) {
    console.error('tests-needed: cannot resolve git refs — ' + e.message);
    process.exit(strict ? 1 : 0);
  }

  const headEqualsDevTip = head === devTip;
  if (strict && !headEqualsDevTip) {
    console.error(`tests-needed: FAIL-CLOSED — HEAD ${head.slice(0, 7)} != origin/dev ${devTip.slice(0, 7)}. ` +
      `A push landed between checkout and the gate; the classified diff would not be the promoted diff. Re-run on the dev tip.`);
    process.exit(1);
  }

  const r = classify({ base, head, repoRoot: REPO_ROOT });
  r.devTipAtGate = devTip;
  r.headEqualsDevTip = headEqualsDevTip;

  try { fs.writeFileSync(path.join(REPO_ROOT, 'regression', 'TESTS-NEEDED.json'), JSON.stringify(r, null, 1)); } catch (_) {}
  if (r.decision === 'red_flag' || r.decision === 'overridden') appendRegister(r);

  if (asJson) process.stdout.write(JSON.stringify(r, null, 1) + '\n');
  else printHuman(r);

  if (strict && r.decision === 'red_flag') process.exit(1);
  process.exit(0);
}

function appendRegister(r) {
  try {
    const line = JSON.stringify({
      type: 'TESTS_UPDATE_GATE', ts: new Date().toISOString(), decision: r.decision, head: r.head,
      loosened: r.loosenedUndeclared.length, removed: r.removedUndeclared.length, skipped: r.skippedUndeclared.length,
      newBehaviourNoTest: r.newBehaviourNoTest.length, overridden: r.overridden.length, mismatchedOverride: r.mismatchedOverride,
    }) + '\n';
    fs.appendFileSync(path.join(REPO_ROOT, 'bridge', 'register.jsonl'), line);
  } catch (_) {}
}

function printHuman(r) {
  const sym = { clear: '✓ CLEAR', needs_review: '● NEEDS REVIEW', overridden: '◑ OVERRIDDEN', red_flag: '✗ RED FLAG' };
  console.log(`Test-Update Gate: ${sym[r.decision] || r.decision}  (base ${r.base.slice(0, 7)} → head ${r.head.slice(0, 7)})`);
  const show = (label, arr, fmt) => { if (arr && arr.length) { console.log(`  ${label} (${arr.length}):`); arr.forEach(x => console.log('    - ' + fmt(x))); } };
  show('⚠ Loosened (undeclared)', r.loosenedUndeclared, c => `${c.tag} [${c.file}]`);
  show('⚠ Removed (undeclared)', r.removedUndeclared, c => `${c.tag} [${c.file}]`);
  show('⚠ Skipped (undeclared)', r.skippedUndeclared, c => `${c.tag} [${c.file}]`);
  show('⚠ New behaviour, no test', r.newBehaviourNoTest, b => b.path);
  show('Rejected trailers', r.rejectedTrailers, t => `${t.kind}: ${t.why}`);
  show('Overridden (declared)', r.overridden, o => `${o.tag} ${o.transition} — ${o.reason}`);
  show('Needs review (uncorroborated)', r.unguardedSourceChanges, b => b.path);
  if (r.decision === 'red_flag') {
    console.log('\n  → A guarded check was weakened/removed/skipped, or new behaviour shipped untested.');
    console.log('    If a feature changed this behaviour: move (don\'t weaken) the assertion (Bashir) and add a');
    console.log('    "Test-Loosen-OK: <tag> <transition> <reason>" trailer. If this is a real regression: FIX THE CODE.');
  }
}

main();
