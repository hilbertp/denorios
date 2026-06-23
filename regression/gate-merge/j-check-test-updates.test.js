'use strict';
// J-check-test-updates — stage ① of the merge gate ("Check for test updates"). Tests the
// PURE triage(): each reconcile status maps to a confidence + action, only MISSING needs a
// human, recorded decisions are final, and stage ① is GREEN only when nothing awaits you.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { triage, triageTag, CONF } = require('../../lib/check-test-updates');

// Static source reads → the COVERAGE.lock deriver maps these new behaviour files to this guard.
const CHK_SRC = path.resolve(__dirname, '..', '..', 'lib', 'check-test-updates.js');
const CHK_CLI = path.resolve(__dirname, '..', '..', 'scripts', 'check-test-updates.js');
const GATE_PAGE = path.resolve(__dirname, '..', '..', 'dashboard', 'merge-gate.html');
const DASH = path.resolve(__dirname, '..', '..', 'dashboard', 'lcars-dashboard.html');

const recOf = (byTag) => ({ reconcile: { byTag }, manifest: { byTag: {} }, decisions: {} });

test('J-check-test-updates slice-99831-ac-1 — COVERED → high confidence, auto-pass, no human', () => {
  const r = triageTag('slice-1-ac-1', 'COVERED', null, undefined);
  assert.equal(r.confidence, CONF.HIGH);
  assert.equal(r.action, 'pass');
  assert.equal(r.needsHuman, false);
});

test('J-check-test-updates slice-99831-ac-2 — STALE → high confidence, auto update-test, no human', () => {
  const r = triageTag('slice-1-ac-2', 'STALE', null, undefined);
  assert.equal(r.confidence, CONF.HIGH);
  assert.equal(r.action, 'update-test');
  assert.equal(r.needsHuman, false);
});

test('J-check-test-updates slice-99831-ac-3 — MISSING → LOW confidence, flagged for the human to decide', () => {
  const r = triageTag('slice-1-ac-3', 'MISSING', null, undefined);
  assert.equal(r.confidence, CONF.LOW);
  assert.equal(r.action, 'decide');
  assert.equal(r.needsHuman, true);
});

test('J-check-test-updates slice-99831-ac-4 — a recorded decision is final: keep → kept, update → update-test, never re-flags', () => {
  const kept = triageTag('slice-1-ac-3', 'MISSING', null, 'keep');
  assert.equal(kept.action, 'kept');
  assert.equal(kept.needsHuman, false);
  const upd = triageTag('slice-1-ac-3', 'MISSING', null, 'update');
  assert.equal(upd.action, 'update-test');
  assert.equal(upd.needsHuman, false);
});

test('J-check-test-updates slice-99831-ac-5 — LEGACY_UNHASHED is skipped, never surfaced', () => {
  const r = triage(recOf({ 'slice-9-ac-1': { status: 'LEGACY_UNHASHED' } }));
  assert.equal(r.items.length, 0);
  assert.equal(r.ready, true);
});

test('J-check-test-updates slice-99831-ac-6 — an unresolved MISSING blocks stage ① (NEEDS_YOU); resolving it unlocks', () => {
  const blocked = triage(recOf({ 'slice-2-ac-1': { status: 'MISSING' } }));
  assert.equal(blocked.ready, false);
  assert.equal(blocked.verdict, 'NEEDS_YOU');
  assert.equal(blocked.summary.flagged, 1);

  const resolved = triage({ reconcile: { byTag: { 'slice-2-ac-1': { status: 'MISSING' } } }, manifest: { byTag: {} }, decisions: { 'slice-2-ac-1': 'keep' } });
  assert.equal(resolved.ready, true);
  assert.equal(resolved.summary.flagged, 0);
  assert.equal(resolved.summary.kept, 1);
});

test('J-check-test-updates slice-99831-ac-7 — high-confidence work (COVERED + STALE) does not block the gate; summary counts are honest', () => {
  const r = triage(recOf({
    'slice-3-ac-1': { status: 'COVERED' },
    'slice-3-ac-2': { status: 'STALE' },
    'slice-3-ac-3': { status: 'COVERED' },
  }));
  assert.equal(r.ready, true);                 // nothing needs a human
  assert.equal(r.verdict, 'RESOLVED');         // but there is an auto-update to apply
  assert.equal(r.summary.passed, 2);
  assert.equal(r.summary.autoUpdate, 1);
  assert.equal(r.summary.flagged, 0);
});

test('J-check-test-updates slice-99831-ac-8 — the engine source surfaces high-confidence acts and flags only the low-confidence (never edits an AC)', () => {
  const src = fs.readFileSync(CHK_SRC, 'utf8');
  assert.match(src, /update-test/);
  assert.match(src, /needsHuman/);
  assert.match(src, /COVERED|STALE|MISSING/);
  assert.doesNotMatch(src, /editAc|rewriteAc|writeFileSync/); // pure: never edits an AC or writes
});

test('J-check-test-updates slice-99831-ac-9 — the CLI drains, triages, writes the artifact, and gates the merge', () => {
  const src = fs.readFileSync(CHK_CLI, 'utf8');
  assert.match(src, /reconcile/);                       // drains the ACs
  assert.match(src, /AC-CHECK\.json/);                  // writes the dashboard artifact
  assert.match(src, /require\(['"]\.\.\/lib\/check-test-updates['"]\)/);
});

test('J-check-test-updates slice-99831-ac-10 — the standalone /merge-gate page: ① check (per-AC Update/Keep) GATES ② run-gate-&-merge', () => {
  const src = fs.readFileSync(GATE_PAGE, 'utf8');
  assert.match(src, /\/api\/check-test-updates/);                 // stage ① reads the triage
  assert.match(src, /\/api\/check-test-updates\/decide/);         // per-AC ruling
  // The two human choices — copy kept consistent with the main-dashboard overlay (ac-11).
  assert.match(src, /Update the test to match/i);
  assert.match(src, /Keep as is/i);
  assert.match(src, /\/api\/promote\/dispatch/);                 // stage ② runs the merge gate
  assert.match(src, /mergeBtn[\s\S]*disabled/);                  // ② is LOCKED until ① is ready
  assert.match(src, /function unlockMerge|unlockMerge\(\)/);     // unlocked only when ready
});

// ── The PRIMARY surface: the in-dashboard stage-① overlay (Ziyal's redesign, f1a97fd) ──
// _renderTestUpdatesBody in lcars-dashboard.html. This is what the operator actually sees;
// it was unguarded after the redesign — these pin its contract.
test('J-check-test-updates slice-99831-ac-11 — the in-dashboard overlay renders each flagged AC with its AC text as the evidence + the two rulings', () => {
  const src = fs.readFileSync(DASH, 'utf8');
  assert.match(src, /\/api\/check-test-updates/);                          // reads the triage
  assert.match(src, /\/api\/check-test-updates\/decide/);                  // records the ruling
  assert.match(src, /Update the test to match/);                          // redesigned copy
  assert.match(src, /Keep as is &mdash; no test update needed|Keep as is — no test update needed/);
  assert.match(src, /_decideTestUpdate\(/);                               // per-AC wiring…
  assert.match(src, /,\s*'update'\)/);                                    // …with the two rulings
  assert.match(src, /,\s*'keep'\)/);
  assert.match(src, /class="utc-ac"/);                                    // the AC text is the on-screen hero
  assert.match(src, /it\.title/);                                         // …sourced from the AC's own text
});

test('J-check-test-updates slice-99831-ac-12 — the overlay surfaces ONLY low-confidence flagged ACs; high-confidence are accounted for, not listed', () => {
  const src = fs.readFileSync(DASH, 'utf8');
  assert.match(src, /const flagged = rep\.flagged/);                      // iterates the FLAGGED set…
  assert.match(src, /for \(const it of flagged\)/);                      // …not every item
  assert.match(src, /utc-scan/);                                         // a one-line scan summary
  assert.match(src, /your call/i);                                        // "N need your call"
  assert.match(src, /already covered or handled automatically/i);        // the rest are trusted, not shown
});

test('J-check-test-updates slice-99831-ac-13 — CHECK FOR TEST UPDATES gates the merge: locked until the check passes for the CURRENT dev tip', () => {
  const src = fs.readFileSync(DASH, 'utf8');
  assert.match(src, /id="check-updates-btn"/);                           // the operator button exists
  assert.match(src, /onclick="runTestUpdateCheck\(\)"/);                 // …runs the drain/triage
  assert.match(src, /const checkPassed = _testUpdatesReady && _testUpdatesSha && _testUpdatesSha === devSha/); // re-check when dev moves
  assert.match(src, /const enabled = [^;]*checkPassed/);                 // merge enabled ONLY when the check passed
  assert.match(src, /ready[\s\S]{0,200}_testUpdatesReady = true[\s\S]{0,120}renderPromoteAction/); // ready → unlock
});
