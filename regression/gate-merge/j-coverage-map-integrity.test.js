'use strict';
// J-tests-needed — the COVERAGE.lock backstop (ADR-TEST-UPDATE-GATE, Slice C).
//
// COVERAGE.lock is the source→guard map the Test-Update Gate uses to corroborate a
// behaviour change FILE-grained. This suite is its keeper:
//   • INTEGRITY  — the committed lock is exactly what the deriver regenerates
//                  (catches "edited tests but forgot to rebuild the map").
//   • PURITY     — the deriver is deterministic (no clock/random) so the gate can
//                  trust regeneration.
//   • SHAPE      — every key is a BEHAVIOUR source, every guard is a real slice tag.
//   • RATCHET    — the load-bearing sources stay covered; the gate's own engine,
//                  CLI and deriver are themselves guarded (this file reads them).
//
// Reading the gate's sources here is deliberate: it makes lib/tests-needed.js,
// scripts/tests-needed.js and scripts/build-coverage-map.js appear in the map, so
// the machinery that enforces coverage cannot itself ship coverage-blind.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { buildCoverageMap } = require('../../scripts/build-coverage-map');
const { bucketOf, guardCountOf } = require('../../lib/tests-needed');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const LOCK_PATH = path.resolve(__dirname, '..', 'COVERAGE.lock');
const ENGINE_SRC = path.resolve(__dirname, '..', '..', 'lib', 'tests-needed.js');
const CLI_SRC = path.resolve(__dirname, '..', '..', 'scripts', 'tests-needed.js');
const DERIVER_SRC = path.resolve(__dirname, '..', '..', 'scripts', 'build-coverage-map.js');

const readLock = () => JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));

test('J-tests-needed slice-99822-ac-1 — committed COVERAGE.lock equals a fresh regeneration (integrity)', () => {
  const onDisk = readLock();
  const fresh = buildCoverageMap(REPO_ROOT);
  assert.deepEqual(onDisk, fresh,
    'COVERAGE.lock is stale — run `node scripts/build-coverage-map.js` and commit the result');
});

test('J-tests-needed slice-99822-ac-2 — the deriver is deterministic (two builds are byte-identical)', () => {
  const a = JSON.stringify(buildCoverageMap(REPO_ROOT));
  const b = JSON.stringify(buildCoverageMap(REPO_ROOT));
  assert.equal(a, b, 'buildCoverageMap must be a pure function of the on-disk tree');
});

test('J-tests-needed slice-99822-ac-3 — the deriver has no wall-clock or randomness (regeneration is trustworthy)', () => {
  const src = fs.readFileSync(DERIVER_SRC, 'utf8');
  assert.ok(!/Date\.now\(|Math\.random\(|new Date\(/.test(src),
    'a non-deterministic deriver would make the integrity check flap');
});

test('J-tests-needed slice-99822-ac-4 — guardCount is self-consistent with bySource', () => {
  const lock = readLock();
  // TIGHTENED 2026-09-01: the old check compared guardCount to guardCountOf(),
  // which prefers the very field under test — a tautology. Recount directly:
  // guardCount is the anti-shrink ratchet's currency and counts only the
  // read-corroborated (product-source-keyed) entries; annotation-declared
  // entries (test-file keys) are classification signals and MUST NOT move it.
  const TEST_KEY_RE = /^(regression\/.+\.test\.js|e2e\/.+\.spec\.js)$/;
  const form1 = Object.keys(lock.bySource)
    .filter(k => !TEST_KEY_RE.test(k))
    .reduce((n, k) => n + lock.bySource[k].length, 0);
  assert.equal(lock.guardCount, form1, 'guardCount must equal the number of read-corroborated guards');
  assert.equal(typeof lock.guardCount, 'number');
  assert.ok(lock.guardCount > 0, 'an empty coverage map would corroborate nothing');
});

// MOVED 2026-09-01 (Philipp's ruling: the AC classifier must recognize real
// guards over INERT-bucketed sources and in the browser suite). A key is now
// EITHER a BEHAVIOUR source (form 1, read-corroborated) OR a test/spec file's
// own path (form 2, annotation-declared) — and the form-2 shape is pinned
// STRICTLY: self-referential file, hash on every entry, no other keys admitted.
test('J-tests-needed slice-99822-ac-5 — every key is a BEHAVIOUR source or a self-referential annotated guard file; every guard is a real slice tag', () => {
  const { bySource } = readLock();
  for (const src of Object.keys(bySource)) {
    const isTestFileKey = /^(regression\/.+\.test\.js|e2e\/.+\.spec\.js)$/.test(src);
    if (isTestFileKey) {
      // Form 2 — annotation-declared: every entry must be the file's own
      // explicit @ac-hash claim. No hashless or foreign entries sneak in here.
      for (const g of bySource[src]) {
        assert.equal(g.file, src, `annotation-declared guard on ${src} must be self-referential (got ${g.file})`);
        assert.match(String(g.guardAcHash || ''), /^sha256:[0-9a-f]{6,64}$/,
          `annotation-declared guard ${g.tag} on ${src} must carry its @ac-hash`);
      }
    } else {
      assert.equal(bucketOf(src), 'BEHAVIOUR', `${src} is mapped but is not a BEHAVIOUR source`);
    }
    for (const g of bySource[src]) {
      assert.match(g.tag, /^slice-\d+-ac-\d+$/, `guard tag ${g.tag} on ${src} is not a slice-N-ac-M tag`);
      assert.match(g.file, /^(regression\/.+\.test\.js|e2e\/.+\.spec\.js)$/, `guard file ${g.file} on ${src} is not a suite test/spec`);
    }
  }
});

test('J-tests-needed slice-99822-ac-6 — each source list is sorted by (tag, file) and deduped (stable diffs)', () => {
  // Same comparator the deriver guarantees: tag first, then file, both as plain strings.
  const cmp = (a, b) => (a.tag === b.tag ? (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) : (a.tag < b.tag ? -1 : 1));
  const { bySource } = readLock();
  for (const src of Object.keys(bySource)) {
    const list = bySource[src];
    assert.deepEqual(list, [...list].sort(cmp), `${src} guards are not in (tag, file) order`);
    const keys = list.map(g => g.tag + '|' + g.file);
    assert.equal(new Set(keys).size, keys.length, `${src} has duplicate guards`);
  }
  const srcKeys = Object.keys(bySource);
  assert.deepEqual(srcKeys, [...srcKeys].sort(), 'source keys are not in sorted order');
});

test('J-tests-needed slice-99822-ac-7 — the load-bearing behaviour sources stay covered (anti-shrink ratchet)', () => {
  const { bySource } = readLock();
  for (const src of [
    'dashboard/server.js',
    'dashboard/lcars-dashboard.html',
    '.github/workflows/promote.yml',
    'lib/assert-direction.js',
  ]) {
    assert.ok(bySource[src] && bySource[src].length > 0,
      `${src} must keep at least one test guard — removing its coverage needs a Coverage-Removed trailer`);
  }
});

test('J-tests-needed slice-99822-ac-8 — the gate engine loads the lock and corroborates file-grained', () => {
  const engine = fs.readFileSync(ENGINE_SRC, 'utf8');
  assert.match(engine, /COVERAGE\.lock/, 'the engine must read regression/COVERAGE.lock');
  assert.match(engine, /function corroborated/, 'the engine must own the file-grained corroboration check');
  assert.match(engine, /coverageShrinkUndeclared/, 'the engine must enforce the anti-shrink invariant');
});

test('J-tests-needed slice-99822-ac-9 — the gate CLI pins the changeset and fails closed in --strict', () => {
  const cli = fs.readFileSync(CLI_SRC, 'utf8');
  assert.match(cli, /merge-base/, 'the CLI must pin base = merge-base(origin/main, HEAD)');
  assert.match(cli, /FAIL-CLOSED/, 'the CLI must fail closed when HEAD raced past origin/dev');
});
