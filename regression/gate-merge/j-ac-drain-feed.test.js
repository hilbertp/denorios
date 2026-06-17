'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The NEW-AC drain feed (Philipp's workflow): ACs commissioned through a slice surface to
// Julian every pipeline run; he triages which change behaviour, then drains. A NEW AC = an
// ACTIVE manifest entry whose acHash differs from the drained ledger.

const RECONCILE_SRC = path.resolve(__dirname, '..', '..', 'lib', 'ac-reconcile.js');
const { newAcs, drainLedger } = require(RECONCILE_SRC);

const man = (byTag) => ({ byTag });
const led = (drained) => ({ drained });

test('J-ac-drain slice-99830-ac-1 — a freshly-commissioned active AC (not in the ledger) is NEW', () => {
  const out = newAcs({ manifest: man({ 'slice-7-ac-1': { acHash: 'sha256:aa', legacy: false, text: 't', slice: '7' } }), drained: led({}) });
  assert.equal(out.length, 1);
  assert.equal(out[0].tag, 'slice-7-ac-1');
  assert.equal(out[0].changed, false);
});

test('J-ac-drain slice-99830-ac-2 — an AC drained at its current hash does not resurface', () => {
  const out = newAcs({ manifest: man({ 'slice-7-ac-1': { acHash: 'sha256:aa', legacy: false } }), drained: led({ 'slice-7-ac-1': 'sha256:aa' }) });
  assert.equal(out.length, 0);
});

test('J-ac-drain slice-99830-ac-3 — an AC whose text changed since last drain resurfaces as CHANGED', () => {
  const out = newAcs({ manifest: man({ 'slice-7-ac-1': { acHash: 'sha256:NEW', legacy: false } }), drained: led({ 'slice-7-ac-1': 'sha256:OLD' }) });
  assert.equal(out.length, 1);
  assert.equal(out[0].changed, true);
  assert.equal(out[0].previouslyDrainedHash, 'sha256:OLD');
});

test('J-ac-drain slice-99830-ac-4 — legacy (unhashed) entries are NOT in the new feed; a backfill (null→hash) IS', () => {
  const legacyOnly = newAcs({ manifest: man({ 'slice-7-ac-1': { acHash: null, legacy: true } }), drained: led({}) });
  assert.equal(legacyOnly.length, 0, 'grandfathered legacy is the separate backfill task, not the new feed');
  const backfilled = newAcs({ manifest: man({ 'slice-7-ac-1': { acHash: 'sha256:bf', legacy: false } }), drained: led({ 'slice-7-ac-1': null }) });
  assert.equal(backfilled.length, 1, 'backfilling a legacy AC surfaces it for triage');
});

test('J-ac-drain slice-99830-ac-5 — coverage status (MISSING/STALE/COVERED) rides on each new AC for triage', () => {
  const out = newAcs({
    manifest: man({ 'slice-7-ac-1': { acHash: 'sha256:aa', legacy: false } }),
    drained: led({}),
    reconcileByTag: { 'slice-7-ac-1': { status: 'MISSING' } },
  });
  assert.equal(out[0].coverage, 'MISSING');
});

test('J-ac-drain slice-99830-ac-6 — draining records every current AC hash (so a later edit resurfaces)', () => {
  const ledger = drainLedger(man({
    'slice-7-ac-1': { acHash: 'sha256:aa' },
    'slice-9-ac-2': { acHash: null }, // legacy → recorded as null
  }));
  assert.equal(ledger.drained['slice-7-ac-1'], 'sha256:aa');
  assert.equal(ledger.drained['slice-9-ac-2'], null);
  // after draining, nothing is new
  assert.equal(newAcs({ manifest: man({ 'slice-7-ac-1': { acHash: 'sha256:aa', legacy: false } }), drained: ledger }).length, 0);
});

test('J-ac-drain slice-99830-ac-7 — the source on disk exports the drain feed contract', () => {
  const src = fs.readFileSync(RECONCILE_SRC, 'utf8');
  assert.match(src, /module\.exports\s*=\s*{[^}]*newAcs/);
  assert.match(src, /drainLedger/);
});
