'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// BUILD-1 (ADR-AC-RECONCILE): the pure reconcile(facts) classifier — joins manifest acHash
// with COVERAGE.lock guardAcHash into COVERED / STALE / MISSING / LEGACY_UNHASHED.

const RECONCILE_SRC = path.resolve(__dirname, '..', '..', 'lib', 'ac-reconcile.js');
const RECONCILE_CLI = path.resolve(__dirname, '..', '..', 'scripts', 'ac-reconcile.js');
const { reconcile } = require(RECONCILE_SRC);

const cov = (entries) => ({ bySource: { 'lib/x.js': entries } });
const man = (byTag) => ({ byTag });

test('J-ac-reconcile slice-99827-ac-1 — guard hash matches spec hash → COVERED', () => {
  const r = reconcile({
    manifest: man({ 'slice-1-ac-1': { acHash: 'sha256:aa', legacy: false } }),
    coverage: cov([{ tag: 'slice-1-ac-1', file: 't', guardAcHash: 'sha256:aa' }]),
  });
  assert.equal(r.byTag['slice-1-ac-1'].status, 'COVERED');
  assert.equal(r.verdict, 'GREEN');
});

test('J-ac-reconcile slice-99827-ac-2 — guard hash differs from spec hash → STALE (and NEEDS_RECONCILE)', () => {
  const r = reconcile({
    manifest: man({ 'slice-1-ac-1': { acHash: 'sha256:NEW', legacy: false } }),
    coverage: cov([{ tag: 'slice-1-ac-1', file: 't', guardAcHash: 'sha256:OLD' }]),
  });
  assert.equal(r.byTag['slice-1-ac-1'].status, 'STALE');
  assert.equal(r.verdict, 'NEEDS_RECONCILE');
  assert.equal(r.workSet, 1);
});

test('J-ac-reconcile slice-99827-ac-3 — active AC with no guard → MISSING', () => {
  const r = reconcile({
    manifest: man({ 'slice-1-ac-1': { acHash: 'sha256:aa', legacy: false } }),
    coverage: cov([]),
  });
  assert.equal(r.byTag['slice-1-ac-1'].status, 'MISSING');
  assert.equal(r.verdict, 'NEEDS_RECONCILE');
});

test('J-ac-reconcile slice-99827-ac-4 — legacy (unhashed) tag with a guard is grandfathered, never STALE/blocking', () => {
  const r = reconcile({
    manifest: man({ 'slice-1-ac-1': { acHash: null, legacy: true } }),
    coverage: cov([{ tag: 'slice-1-ac-1', file: 't' }]), // no guardAcHash
  });
  assert.equal(r.byTag['slice-1-ac-1'].status, 'LEGACY_UNHASHED');
  assert.equal(r.verdict, 'GREEN');
  assert.equal(r.workSet, 0);
});

test('J-ac-reconcile slice-99827-ac-5 — active AC whose guard carries no @ac-hash is STALE (unverifiable)', () => {
  const r = reconcile({
    manifest: man({ 'slice-1-ac-1': { acHash: 'sha256:aa', legacy: false } }),
    coverage: cov([{ tag: 'slice-1-ac-1', file: 't' }]),
  });
  assert.equal(r.byTag['slice-1-ac-1'].status, 'STALE');
});

test('J-ac-reconcile slice-99827-ac-6 — the live repo reconciles GREEN today (all tags grandfathered legacy)', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'AC-MANIFEST.lock'), 'utf8'));
  const coverage = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'COVERAGE.lock'), 'utf8'));
  const r = reconcile({ manifest, coverage });
  assert.equal(r.verdict, 'GREEN', `expected GREEN, got ${r.verdict} (${JSON.stringify(r.counts)})`);
  assert.equal(r.counts.STALE, 0);
  assert.equal(r.counts.MISSING, 0);
});

test('J-ac-reconcile slice-99827-ac-7 — the classifier source on disk exports the reconcile contract', () => {
  const src = fs.readFileSync(RECONCILE_SRC, 'utf8');
  assert.match(src, /module\.exports\s*=\s*{[^}]*reconcile/);
  assert.match(src, /LEGACY_UNHASHED/);
  assert.match(src, /never edit an AC|never the reverse|NEVER the/i);
});

test('J-ac-reconcile slice-99827-ac-8 — the STEP-1 driver loads the locks, writes the verdict, and routes Julian', () => {
  const src = fs.readFileSync(RECONCILE_CLI, 'utf8');
  assert.match(src, /require\(['"]\.\.\/lib\/ac-reconcile['"]\)/);
  assert.match(src, /AC-RECONCILE\.json/);
  assert.match(src, /RECONCILE-NEEDED\.md/);            // routes Julian's inbox
  assert.match(src, /never edit an AC|never the reverse|HALTS/i);
});
