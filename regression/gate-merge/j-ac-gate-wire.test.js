'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// GATE-WIRE (ADR-AC-RECONCILE §6): the AC manifest is a first-class gate input. decide()
// diffs acHashes across base..head and demands AC-Change-OK + Spec-Owner for any mutation.
// Advisory by default (needs_review); RED only when enforcing. The masking classifier is untouched.

const GATE_SRC = path.resolve(__dirname, '..', '..', 'lib', 'tests-needed.js');
const { decide, bucketOf, parseTrailers } = require(GATE_SRC);

const manifest = (byTag) => ({ byTag });
const facts = (over) => Object.assign({
  behaviourFiles: [], checks: [], trailers: parseTrailers([]),
  acManifest: { base: manifest({}), head: manifest({}) }, acEnforce: false,
}, over);

const baseHead = (baseHash, headHash, extra = {}) => ({
  base: manifest({ 'slice-1-ac-1': Object.assign({ acHash: baseHash, legacy: false }, extra.base) }),
  head: manifest({ 'slice-1-ac-1': Object.assign({ acHash: headHash, legacy: false }, extra.head) }),
});

test('J-ac-gate-wire slice-99829-ac-1 — an undeclared AC mutation is NEEDS_REVIEW in advisory mode (default)', () => {
  const r = decide(facts({ acManifest: baseHead('sha256:OLD', 'sha256:NEW') }));
  assert.deepEqual(r.acMutatedUndeclared, ['slice-1-ac-1']);
  assert.equal(r.decision, 'needs_review');
});

test('J-ac-gate-wire slice-99829-ac-2 — an undeclared AC mutation is RED_FLAG when enforcing', () => {
  const r = decide(facts({ acManifest: baseHead('sha256:OLD', 'sha256:NEW'), acEnforce: true }));
  assert.equal(r.decision, 'red_flag');
});

test('J-ac-gate-wire slice-99829-ac-3 — AC-Change-OK + Spec-Owner makes it OVERRIDDEN (clears RED even enforcing)', () => {
  const trailers = parseTrailers(['AC-Change-OK: slice-1-ac-1 mutated the endpoint contract widened\nSpec-Owner: Philipp']);
  const r = decide(facts({ acManifest: baseHead('sha256:OLD', 'sha256:NEW'), trailers, acEnforce: true }));
  assert.deepEqual(r.acOverridden, ['slice-1-ac-1']);
  assert.equal(r.acMutatedUndeclared.length, 0);
  assert.equal(r.decision, 'overridden');
});

test('J-ac-gate-wire slice-99829-ac-4 — AC-Change-OK with NO Spec-Owner does not clear (still undeclared)', () => {
  const trailers = parseTrailers(['AC-Change-OK: slice-1-ac-1 mutated no owner named']);
  const r = decide(facts({ acManifest: baseHead('sha256:OLD', 'sha256:NEW'), trailers, acEnforce: true }));
  assert.deepEqual(r.acMutatedUndeclared, ['slice-1-ac-1']);
  assert.equal(r.decision, 'red_flag');
});

test('J-ac-gate-wire slice-99829-ac-5 — a retired tag is AC-RETIRED; a legacy backfill (null→hash) is NOT a mutation', () => {
  const retired = decide(facts({ acManifest: {
    base: manifest({ 'slice-1-ac-9': { acHash: 'sha256:X', legacy: false } }),
    head: manifest({}),
  } }));
  assert.deepEqual(retired.acRetiredUndeclared, ['slice-1-ac-9']);

  const backfill = decide(facts({ acManifest: {
    base: manifest({ 'slice-1-ac-1': { acHash: null, legacy: true } }),
    head: manifest({ 'slice-1-ac-1': { acHash: 'sha256:NEW', legacy: false } }),
  } }));
  assert.equal(backfill.acMutated.length, 0, 'backfilling a legacy AC is not a mutation');
  assert.equal(backfill.decision, 'clear');
});

test('J-ac-gate-wire slice-99829-ac-6 — AC-MANIFEST.lock buckets BEHAVIOUR but never trips unguarded/new-behaviour', () => {
  assert.equal(bucketOf('regression/AC-MANIFEST.lock'), 'BEHAVIOUR');
  const r = decide(facts({ behaviourFiles: [{ path: 'regression/AC-MANIFEST.lock', area: 'server', isNew: true }] }));
  assert.equal(r.newBehaviourNoTest.length, 0, 'the manifest is a gate input, not unguarded behaviour');
  assert.equal(r.unguardedSourceChanges.length, 0);
  assert.equal(r.decision, 'clear');
});

test('J-ac-gate-wire slice-99829-ac-7 — the masking classifier is untouched: a loosened test with no trailer is still RED', () => {
  const r = decide(facts({ checks: [{ file: 'regression/x.test.js', tag: 'slice-2-ac-1', area: 'regression', kind: 'modified', direction: 'loosened' }] }));
  assert.equal(r.decision, 'red_flag');
  assert.equal(r.loosenedUndeclared.length, 1);
});

test('J-ac-gate-wire slice-99829-ac-8 — the gate source on disk wires the manifest + the new trailers', () => {
  const src = fs.readFileSync(GATE_SRC, 'utf8');
  assert.match(src, /AC-MANIFEST\.lock/);
  assert.match(src, /AC-Change-OK/);
  assert.match(src, /Spec-Owner/);
  assert.match(src, /acEnforce/);
});

test('J-ac-gate-wire slice-99829-ac-9 — the gate CLI records AC counts on the register line and surfaces them', () => {
  const cli = fs.readFileSync(path.resolve(__dirname, '..', '..', 'scripts', 'tests-needed.js'), 'utf8');
  assert.match(cli, /acMutatedUndeclared/);
  assert.match(cli, /acRetiredUndeclared/);
  assert.match(cli, /AC mutated \(undeclared\)/);
});
