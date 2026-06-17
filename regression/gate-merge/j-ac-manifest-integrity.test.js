'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// BUILD-1 (ADR-AC-RECONCILE): AC-MANIFEST.lock integrity + the staleness primitive.
// The manifest is keyed by the LITERAL slice-N-ac-K tag; acHash is the spec's identity;
// normalization is conservative so a one-token semantic flip MUST change the hash.

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST_SRC = path.resolve(REPO_ROOT, 'scripts', 'build-ac-manifest.js');
const MANIFEST_LOCK = path.resolve(REPO_ROOT, 'regression', 'AC-MANIFEST.lock');
const { buildAcManifest, acHashOf, serialize } = require(MANIFEST_SRC);

test('J-ac-manifest slice-99826-ac-1 — committed AC-MANIFEST.lock equals a fresh regeneration (integrity)', () => {
  const onDisk = fs.readFileSync(MANIFEST_LOCK, 'utf8');
  const fresh = serialize(buildAcManifest(REPO_ROOT));
  assert.equal(onDisk, fresh, 'AC-MANIFEST.lock is stale — run: node scripts/build-ac-manifest.js');
});

test('J-ac-manifest slice-99826-ac-2 — the deriver is deterministic (two builds are deep-equal)', () => {
  assert.deepEqual(buildAcManifest(REPO_ROOT), buildAcManifest(REPO_ROOT));
});

test('J-ac-manifest slice-99826-ac-3 — every entry has the schema; legacy entries are unhashed, active entries are sha256', () => {
  const m = buildAcManifest(REPO_ROOT);
  assert.equal(typeof m.acCount, 'number');
  assert.equal(m.acCount, Object.keys(m.byTag).length);
  for (const [tag, e] of Object.entries(m.byTag)) {
    assert.match(tag, /^slice-\d+-ac-\d+$/, `key ${tag} is a literal tag`);
    assert.ok('legacy' in e && 'status' in e && 'source' in e);
    if (e.legacy) {
      assert.equal(e.text, null, `${tag}: legacy text must be null (never backfilled from DONE reports)`);
      assert.equal(e.acHash, null, `${tag}: legacy is never hash-ratcheted`);
    } else {
      assert.equal(typeof e.text, 'string');
      assert.match(e.acHash, /^sha256:[0-9a-f]{64}$/);
    }
  }
});

test('J-ac-manifest slice-99826-ac-4 — acHash is conservative: a one-token semantic flip changes it; whitespace does not', () => {
  // Semantic flip MUST change the hash (no fuzzy normalization).
  assert.notEqual(acHashOf('the request must be rejected'), acHashOf('the request must not be rejected'));
  // Conservative normalization: trailing whitespace + collapsed inner spaces are equal.
  assert.equal(acHashOf('returns 200'), acHashOf('returns 200   '));
  assert.equal(acHashOf('returns   200'), acHashOf('returns 200'));
  // But case is NOT folded (conservative).
  assert.notEqual(acHashOf('Returns 200'), acHashOf('returns 200'));
});

test('J-ac-manifest slice-99826-ac-5 — the deriver source on disk implements the keyed-by-tag contract', () => {
  const src = fs.readFileSync(MANIFEST_SRC, 'utf8');
  assert.match(src, /module\.exports\s*=\s*{[^}]*buildAcManifest/);
  assert.match(src, /acHashOf/);
  assert.match(src, /legacy-backfill/);
});
