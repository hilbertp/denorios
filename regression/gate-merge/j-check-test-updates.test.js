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

test('J-check-test-updates slice-99831-ac-10 — the two-stage gate page: ① check (per-AC Update/Keep) GATES ② run-gate-&-merge', () => {
  const src = fs.readFileSync(GATE_PAGE, 'utf8');
  assert.match(src, /\/api\/check-test-updates/);                 // stage ① reads the triage
  assert.match(src, /\/api\/check-test-updates\/decide/);         // per-AC ruling
  assert.match(src, /Update the tests/i);                        // the two human choices
  assert.match(src, /Keep as is/i);
  assert.match(src, /\/api\/promote\/dispatch/);                 // stage ② runs the merge gate
  assert.match(src, /mergeBtn[\s\S]*disabled/);                  // ② is LOCKED until ① is ready
  assert.match(src, /function unlockMerge|unlockMerge\(\)/);     // unlocked only when ready
});
