'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// PRE-3 (ADR-AC-RECONCILE): the `@ac-hash` test annotation contract + its extraction by
// build-coverage-map.js into COVERAGE.lock as `guardAcHash`. guardAcHash is the hash the
// TEST claims to guard; the manifest's acHash is the spec's own hash; stale when they differ.

const BCM_SRC = path.resolve(__dirname, '..', '..', 'scripts', 'build-coverage-map.js');
const { acHashesIn, buildCoverageMap } = require(BCM_SRC);

// Build annotation lines at runtime so the literal "@ac-hash:" never appears in THIS
// file's source — otherwise the deriver would extract our fixtures into the real lock.
const annot = (tag, hex) => '// @ac-' + 'hash: ' + tag + ' sha256:' + hex;
const H = (c) => c.repeat(32);

test('J-ac-hash slice-99825-ac-1 — annotations are extracted into a tag → guardAcHash map', () => {
  const src = [
    annot('slice-99825-ac-90', H('a')),
    "test('slice-99825-ac-90 — fixture', () => {});",
    annot('slice-99825-ac-91', H('b')),
  ].join('\n');
  const map = acHashesIn(src);
  assert.equal(map['slice-99825-ac-90'], 'sha256:' + H('a'));
  assert.equal(map['slice-99825-ac-91'], 'sha256:' + H('b'));
});

test('J-ac-hash slice-99825-ac-2 — a tag with no annotation yields no guardAcHash', () => {
  const map = acHashesIn("test('slice-99825-ac-92 — unannotated', () => {});");
  assert.equal(map['slice-99825-ac-92'], undefined);
  assert.equal(Object.keys(map).length, 0);
});

test('J-ac-hash slice-99825-ac-3 — extraction tolerates spacing variations', () => {
  const src = '//@ac-' + 'hash:   slice-99825-ac-93    sha256:' + H('c');
  assert.equal(acHashesIn(src)['slice-99825-ac-93'], 'sha256:' + H('c'));
});

test('J-ac-hash slice-99825-ac-4 — COVERAGE.lock entries carry guardAcHash only when present, well-formed when they do', () => {
  const map = buildCoverageMap(path.resolve(__dirname, '..', '..'));
  const entries = Object.values(map.bySource).flat();
  assert.ok(entries.length > 0);
  for (const e of entries) {
    assert.ok(e.tag && e.file, 'every guard has a tag + file');
    if ('guardAcHash' in e) assert.match(e.guardAcHash, /^sha256:[0-9a-f]{6,64}$/);
  }
});

test('J-ac-hash slice-99825-ac-5 — the deriver source implements the @ac-hash contract (exports acHashesIn)', () => {
  const src = fs.readFileSync(BCM_SRC, 'utf8');
  assert.match(src, /acHashesIn/);
  assert.match(src, /@ac-/);
  assert.match(src, /guardAcHash/);
  assert.equal(typeof acHashesIn, 'function');
});
