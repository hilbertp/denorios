'use strict';
// J-unrun-test-dir — POLICE ONLY WHAT WE RUN (Philipp's ruling, req. 6; slice 365).
//
// `test/` was bucketed as guarded TEST surface by the Test-Update Gate while nothing
// executed it: not ci.yml, not promote.yml, not the orchestrator, not an npm script, and
// the coverage map never walked it. That combination manufactures blockers no green run
// can ever answer — an edit there could turn the gate RED with no runnable evidence either
// way. Slice 365 de-scoped the directory (81 files out of the blast radius).
//
// This suite locks the de-scope from BOTH sides: behaviourally (a `test/` path buckets
// inert and so never becomes a check) and structurally (the bucket table has no `^test/`
// rule and no walker has quietly re-caught it). Re-policing that directory means porting
// its 76 hand-rolled process.exit scripts into regression/ first — a port, not a rule flip.
//
// @ac-hash: slice-365-ac-1 sha256:4ab372ff3c9d9f8c30534d25fc3b8139489f78becf507e0a281970c13729c875
// @ac-hash: slice-365-ac-2 sha256:a2dfc83b71fb0632ab5582be51cabb813b96ad5e3610a505a393486ff65f6e55
// @ac-hash: slice-365-ac-3 sha256:40a9dbadf30897d7501a560471d821a4e47cde70a7c6c7a63e1e7d4eadd5ab5f
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { bucketOf, decide } = require('../../lib/tests-needed');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ENGINE_SRC = path.join(REPO_ROOT, 'lib', 'tests-needed.js');
const COVERAGE_MAP_SRC = path.join(REPO_ROOT, 'scripts', 'build-coverage-map.js');
const COVERAGE_MD = path.join(REPO_ROOT, 'regression', 'COVERAGE.md');

// The two files that actually turned the gate RED on 2026-09-01, plus shapes around them.
const UNRUN = [
  'test/ensure-main-fresh.test.js',
  'test/squash-slice-to-dev.test.js',
  'test/accept-and-merge-squash-to-dev.test.js',
  'test/nested/deep-helper.test.js',
  'test/fixtures/some-fixture.json',
];

test('J-unrun-test-dir slice-365-ac-1 — a path in the unexecuted test dir buckets INERT, so it never becomes a gate check', () => {
  for (const p of UNRUN) {
    assert.equal(bucketOf(p), 'INERT', `${p} must be inert — nothing runs test/, so the gate must not police it`);
  }
  // INERT is the whole point: gather() splits the changeset on bucketOf, routing only
  // BEHAVIOUR into behaviourFiles and only TEST into the diffed test files. Inert means
  // the path is in NEITHER pile — it can neither raise a masking flag nor demand a guard.
  for (const p of UNRUN) {
    assert.notEqual(bucketOf(p), 'TEST', `${p} must not be guarded test surface`);
    assert.notEqual(bucketOf(p), 'BEHAVIOUR', `${p} must not demand a guard of its own`);
  }
  // End to end on the verdict: the exact RED shape of 2026-09-01 (two removed checks in
  // test/ensure-main-fresh.test.js) cannot be reconstructed, because no check can carry
  // an inert file. With the directory contributing nothing, the changeset reads CLEAR.
  const r = decide({ behaviourFiles: [], checks: [], trailers: { testsNotNeeded: [], loosenOk: [], coverageRemoved: [], rejected: [] } });
  assert.equal(r.decision, 'clear');
});

test('J-unrun-test-dir slice-365-ac-2 — the bucket table has no rule re-policing that directory', () => {
  const eng = fs.readFileSync(ENGINE_SRC, 'utf8');
  const bucketBody = eng.slice(eng.indexOf('function bucketOf'), eng.indexOf('function areaOf'));
  assert.ok(bucketBody.length > 0, 'bucketOf must still exist to be checked');
  assert.ok(!/\^test\\\//.test(bucketBody),
    'lib/tests-needed.js re-added a ^test/ bucket rule. Nothing runs that directory — ' +
    'port its suites into regression/ before policing them, do not just flip the rule.');
  // Live check, not only textual: whatever the rule table looks like, the answer must hold.
  assert.equal(bucketOf('test/ensure-main-fresh.test.js'), 'INERT');
});

test('J-unrun-test-dir slice-365-ac-2 — no downstream walker re-catches the directory', () => {
  // The coverage map is the other place a directory can become policed surface. Its two
  // walkers are pinned to regression/ and e2e/; a third root here would silently re-admit
  // test/ as coverage the gate then expects to move.
  const cov = fs.readFileSync(COVERAGE_MAP_SRC, 'utf8');
  // Match the FIRST literal segment of any path.join(repoRoot, …) — not only the
  // single-arg form — so `path.join(repoRoot, 'test', 'unit')` is caught too.
  const roots = [...cov.matchAll(/path\.join\(\s*repoRoot\s*,\s*'([^']+)'/g)].map(m => m[1]);
  assert.ok(!roots.includes('test'), 'scripts/build-coverage-map.js started walking test/');
  // And the lock itself must never key a guard under that directory.
  const lock = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'regression', 'COVERAGE.lock'), 'utf8'));
  const strays = Object.keys(lock.bySource || {}).filter(k => /^test\//.test(k));
  assert.deepEqual(strays, [], 'COVERAGE.lock keys a guard under the unexecuted test dir');
});

test('J-unrun-test-dir slice-365-ac-3 — the AC the unexecuted dir used to claim is an explicit OPEN gap, not a silent drop', () => {
  const md = fs.readFileSync(COVERAGE_MD, 'utf8');
  // Disambiguate: three lines mention slice-350-ac-3. The gap note is the one in the
  // "Documented gaps" list, keyed by the AC's own subject-format parenthetical.
  const line = md.split('\n').find(l => /^- \*\*slice-350-ac-3\*\* \(squash subject/.test(l));
  assert.ok(line, 'the slice-350-ac-3 gap note was deleted — de-scoping test/ must not silently drop it');

  // It must state an OPEN gap in its own words, and NAME what is uncovered. A gap noted
  // without its content is the pretending the ruling exists to stop.
  assert.match(line, /OPEN — UNGUARDED/, 'the note must read as an open, unguarded item');
  assert.match(line, /conflict/i, 'the note must name the uncovered squash conflict path');
  assert.match(line, /atomic-write/i, 'the note must name the uncovered atomic-write requirement');

  // The two de-scoped files stay named — the note records the history it supersedes
  // rather than erasing it — but must no longer be presented as this AC's live guards.
  assert.match(line, /test\/squash-slice-to-dev\.test\.js/);
  assert.match(line, /test\/accept-and-merge-squash-to-dev\.test\.js/);
  assert.ok(!/^- \*\*slice-350-ac-3\*\* \([^)]*\) — guarded only by/.test(line),
    'the note still presents the de-scoped test/ files as this AC\'s current guards');

  // Truth check, not just prose: the CI guard the note credits must really exist and
  // really carry the tag. If it is ever deleted, this note becomes a lie and this fails.
  const ciGuard = path.join(REPO_ROOT, 'regression', 'gate-merge', 'j-s-numbering-squash-subject.test.js');
  assert.ok(fs.existsSync(ciGuard), 'the CI guard this note credits for slice-350-ac-3 is gone');
  assert.match(fs.readFileSync(ciGuard, 'utf8'), /slice-350-ac-3/);
});
