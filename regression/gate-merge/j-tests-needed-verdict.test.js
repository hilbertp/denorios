'use strict';
// J-tests-needed — the Test-Update Gate verdict matrix (ADR-TEST-UPDATE-GATE, Slice B).
// Tests the PURE decision (decide) with synthetic facts, one per matrix cell. The gate
// must fail toward FIX-THE-CODE: a loosened/removed/skipped guard, or new untested
// behaviour, blocks unless a verified, transition-matched override clears it.
const { test } = require('node:test');
const assert = require('node:assert');
const { decide, bucketOf, parseTrailers, transitionFor, globToRe } = require('../../lib/tests-needed');

const noTrailers = () => ({ testsNotNeeded: [], loosenOk: [], coverageRemoved: [], rejected: [] });
const check = (tag, direction, kind) => ({ file: 'regression/x.test.js', tag, area: 'regression', kind: kind || 'modified', direction });
const bfile = (p, isNew) => ({ path: p, area: /^dashboard\//.test(p) ? 'ui' : 'server', isNew: !!isNew });

test('J-tests-needed slice-99821-ac-1 — nothing relevant changed → CLEAR', () => {
  assert.equal(decide({ behaviourFiles: [], checks: [], trailers: noTrailers() }).decision, 'clear');
});

test('J-tests-needed slice-99821-ac-2 — behaviour changed + its MAPPED guard moved (non-masking) → CLEAR', () => {
  const r = decide({
    behaviourFiles: [bfile('dashboard/server.js')],
    checks: [check('slice-1-ac-1', 'tightened')],
    trailers: noTrailers(),
    covMap: { bySource: { 'dashboard/server.js': [{ tag: 'slice-1-ac-1' }] } },
  });
  assert.equal(r.decision, 'clear');
});

test('J-tests-needed slice-99821-ac-3 — behaviour changed + NO mapped guard moved → NEEDS REVIEW', () => {
  const r = decide({ behaviourFiles: [bfile('dashboard/server.js')], checks: [], trailers: noTrailers() });
  assert.equal(r.decision, 'needs_review');
  assert.equal(r.unguardedSourceChanges.length, 1);
});

test('J-tests-needed slice-99821-ac-4 — NEW behaviour file, no test, no trailer → RED FLAG', () => {
  const r = decide({ behaviourFiles: [bfile('scripts/new-thing.js', true)], checks: [], trailers: noTrailers() });
  assert.equal(r.decision, 'red_flag');
  assert.equal(r.newBehaviourNoTest.length, 1);
});

test('J-tests-needed slice-99821-ac-5 — a guard LOOSENED with no override → RED FLAG', () => {
  const r = decide({ behaviourFiles: [], checks: [check('slice-2-ac-1', 'loosened')], trailers: noTrailers() });
  assert.equal(r.decision, 'red_flag');
  assert.equal(r.loosenedUndeclared.length, 1);
});

test('J-tests-needed slice-99821-ac-6 — a guard loosened + matching Test-Loosen-OK → OVERRIDDEN', () => {
  const t = noTrailers(); t.loosenOk = [{ target: 'slice-2-ac-1', transition: 'strict→weak', reason: 'contract changed on purpose' }];
  const r = decide({ behaviourFiles: [], checks: [check('slice-2-ac-1', 'loosened')], trailers: t });
  assert.equal(r.decision, 'overridden');
  assert.equal(r.loosenedUndeclared.length, 0);
  assert.equal(r.overridden.length, 1);
});

test('J-tests-needed slice-99821-ac-7 — loosened + override with the WRONG transition → RED FLAG', () => {
  const t = noTrailers(); t.loosenOk = [{ target: 'slice-2-ac-1', transition: 'removed', reason: 'mislabelled' }];
  const r = decide({ behaviourFiles: [], checks: [check('slice-2-ac-1', 'loosened')], trailers: t });
  assert.equal(r.decision, 'red_flag');
  assert.equal(r.mismatchedOverride, true);
});

test('J-tests-needed slice-99821-ac-8 — a guard SKIPPED (test.skip) → RED FLAG', () => {
  assert.equal(decide({ behaviourFiles: [], checks: [check('slice-3-ac-1', 'skipped')], trailers: noTrailers() }).decision, 'red_flag');
});

test('J-tests-needed slice-99821-ac-9 — a guard REMOVED (deleted test) → RED FLAG', () => {
  assert.equal(decide({ behaviourFiles: [], checks: [check('slice-3-ac-2', 'removed', 'removed')], trailers: noTrailers() }).decision, 'red_flag');
});

test('J-tests-needed slice-99821-ac-10 — a scoped Tests-Not-Needed glob clears new untested behaviour → CLEAR', () => {
  const t = noTrailers(); t.testsNotNeeded = [{ glob: 'scripts/*', reason: 'pure config, no behaviour' }];
  const r = decide({ behaviourFiles: [bfile('scripts/new-thing.js', true)], checks: [], trailers: t });
  assert.equal(r.decision, 'clear');
});

test('J-tests-needed slice-99821-ac-11 — an unscoped/garbage trailer is REJECTED → RED FLAG', () => {
  const t = noTrailers(); t.rejected = [{ kind: 'Tests-Not-Needed', line: 'Tests-Not-Needed: trustme', why: 'needs a path-glob and a reason' }];
  assert.equal(decide({ behaviourFiles: [], checks: [], trailers: t }).decision, 'red_flag');
});

test('J-tests-needed slice-99821-ac-12 — path buckets: behaviour vs test vs inert', () => {
  assert.equal(bucketOf('dashboard/server.js'), 'BEHAVIOUR');
  assert.equal(bucketOf('lib/tests-needed.js'), 'BEHAVIOUR');
  assert.equal(bucketOf('bridge/orchestrator.js'), 'BEHAVIOUR');
  assert.equal(bucketOf('.github/workflows/promote.yml'), 'BEHAVIOUR');
  assert.equal(bucketOf('regression/COVERAGE.lock'), 'BEHAVIOUR');   // gate's own backstop is not inert
  assert.equal(bucketOf('regression/x.test.js'), 'TEST');
  assert.equal(bucketOf('e2e/x.spec.js'), 'TEST');
  assert.equal(bucketOf('docs/adr/foo.md'), 'INERT');
  assert.equal(bucketOf('.claude/roles/dax/ROLE.md'), 'INERT');
  assert.equal(bucketOf('bridge/queue/123-STATUS.md'), 'INERT');
});

test('J-tests-needed slice-99821-ac-13 — trailers parse scoped overrides and reject unscoped ones', () => {
  const t = parseTrailers([
    'feat: x\n\nTest-Loosen-OK: slice-9-ac-1 strict→weak the contract genuinely changed',
    'fix: y\n\nTests-Not-Needed: docs/** prose only',
    'oops\n\nTests-Not-Needed: trustme',
  ]);
  assert.equal(t.loosenOk.length, 1);
  assert.equal(t.loosenOk[0].transition, 'strict→weak');
  assert.equal(t.testsNotNeeded.length, 1);
  assert.equal(t.rejected.length, 1);
});

test('J-tests-needed slice-99821-ac-15 — COVERAGE.lock guard count dropped, no Coverage-Removed trailer → RED FLAG', () => {
  const r = decide({ behaviourFiles: [], checks: [], trailers: noTrailers(), coverage: { baseCount: 123, headCount: 120 } });
  assert.equal(r.decision, 'red_flag');
  assert.equal(r.coverageShrink, true);
  assert.equal(r.coverageShrinkUndeclared, true);
});

test('J-tests-needed slice-99821-ac-16 — coverage dropped + matching Coverage-Removed trailer → OVERRIDDEN', () => {
  const t = noTrailers(); t.coverageRemoved = [{ source: 'dashboard/server.js', reason: 'endpoint deleted on purpose' }];
  const r = decide({ behaviourFiles: [], checks: [], trailers: t, coverage: { baseCount: 123, headCount: 120 } });
  assert.equal(r.decision, 'overridden');
  assert.equal(r.coverageShrinkUndeclared, false);
  assert.equal(r.coverageRemovals.length, 1);
});

test('J-tests-needed slice-99821-ac-17 — coverage count UNCHANGED → no shrink signal, stays CLEAR', () => {
  const r = decide({ behaviourFiles: [], checks: [], trailers: noTrailers(), coverage: { baseCount: 123, headCount: 123 } });
  assert.equal(r.decision, 'clear');
  assert.equal(r.coverageShrink, false);
});

test('J-tests-needed slice-99821-ac-14 — transition mapping + glob matching', () => {
  assert.equal(transitionFor('loosened'), 'strict→weak');
  assert.equal(transitionFor('removed'), 'removed');
  assert.equal(transitionFor('skipped'), 'skipped');
  // paths bound to vars so RegExp.test(...) isn't mistaken for a test() definition
  const scriptsGlob = globToRe('scripts/*'), dashGlob = globToRe('dashboard/**');
  const flat = 'scripts/x.js', nested = 'scripts/sub/x.js', deep = 'dashboard/a/b.js';
  assert.ok(scriptsGlob.test(flat));
  assert.ok(!scriptsGlob.test(nested));
  assert.ok(dashGlob.test(deep));
});

// An untagged e2e test is keyed by its prose TITLE (spaces), which the single-token
// Test-Loosen-OK grammar can't name — so renaming one produced a RED that no trailer
// could clear. A FILE-PATH override declares the intentional change by file.
const proseCheck = (file, direction) => ({ file, tag: 'a merged slice appears in the logbook with its dev → reg → main lifecycle chain', area: 'e2e', kind: direction === 'removed' ? 'removed' : 'modified', direction });

test('J-tests-needed slice-99821-ac-18 — a removed untagged e2e check + matching FILE-PATH Test-Loosen-OK → OVERRIDDEN', () => {
  const t = noTrailers(); t.loosenOk = [{ target: 'e2e/history-logbook.spec.js', transition: 'removed', reason: 'renamed when the Logbook outcome column became a single success/error pill (ff14af9); assertion relocated, coverage preserved' }];
  const r = decide({ behaviourFiles: [], checks: [proseCheck('e2e/history-logbook.spec.js', 'removed')], trailers: t });
  assert.equal(r.decision, 'overridden');
  assert.equal(r.removedUndeclared.length, 0);
  assert.equal(r.overridden.length, 1);
});

test('J-tests-needed slice-99821-ac-19 — a FILE-PATH override with the WRONG transition does NOT clear it → RED FLAG', () => {
  const t = noTrailers(); t.loosenOk = [{ target: 'e2e/history-logbook.spec.js', transition: 'skipped', reason: 'mislabelled transition' }];
  const r = decide({ behaviourFiles: [], checks: [proseCheck('e2e/history-logbook.spec.js', 'removed')], trailers: t });
  assert.equal(r.decision, 'red_flag');
  assert.equal(r.mismatchedOverride, true);
});

test('J-tests-needed slice-99821-ac-20 — a FILE-PATH override for a DIFFERENT file does not clear it → RED FLAG', () => {
  const t = noTrailers(); t.loosenOk = [{ target: 'e2e/some-other.spec.js', transition: 'removed', reason: 'wrong file' }];
  const r = decide({ behaviourFiles: [], checks: [proseCheck('e2e/history-logbook.spec.js', 'removed')], trailers: t });
  assert.equal(r.decision, 'red_flag');
  assert.equal(r.removedUndeclared.length, 1);
});
