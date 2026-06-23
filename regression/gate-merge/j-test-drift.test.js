'use strict';
// J-test-drift — the Test Drift Gate (operator-facing review over the Test-Update
// classifier). Tests the PURE re-bucketing (drift) with synthetic classify() results:
// every verdict maps to exactly one action (PROCEED / REVIEW / STOP), masking findings
// land in the POSSIBLE-REGRESSION pile, behaviour-with-no-guard lands in the DELIBERATE
// pile, and a STOP is never causeless. drift() never writes a test — it only describes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { drift, ACTION } = require('../../lib/test-drift');

// Static source paths (so the COVERAGE.lock deriver maps lib/test-drift.js + the CLI to
// this guard — a behaviour file is only "covered" when a test literally reads its bytes).
const DRIFT_SRC = path.resolve(__dirname, '..', '..', 'lib', 'test-drift.js');
const DRIFT_CLI = path.resolve(__dirname, '..', '..', 'scripts', 'test-drift.js');

const chk = (file, tag) => ({ file, tag, area: 'regression', kind: 'modified', direction: 'removed' });
const bf = (path, isNew) => ({ path, area: 'server', isNew: !!isNew });
const base = (decision, extra = {}) => Object.assign({
  decision, base: 'aaaaaaa', head: 'bbbbbbb',
  loosenedUndeclared: [], removedUndeclared: [], skippedUndeclared: [],
  newBehaviourNoTest: [], unguardedSourceChanges: [], overridden: [], rejectedTrailers: [],
  mismatchedOverride: false, coverageShrinkUndeclared: false,
}, extra);

test('J-test-drift slice-99830-ac-1 — a CLEAR verdict → PROCEED with empty piles', () => {
  const d = drift(base('clear'));
  assert.equal(d.action, ACTION.PROCEED);
  assert.equal(d.counts.regression, 0);
  assert.equal(d.counts.deliberate, 0);
  assert.match(d.headline, /No test drift|Clear to proceed/i);
});

test('J-test-drift slice-99830-ac-2 — a loosened guard (red_flag) → STOP, in the regression pile', () => {
  const d = drift(base('red_flag', { loosenedUndeclared: [chk('regression/x.test.js', 'slice-2-ac-1')] }));
  assert.equal(d.action, ACTION.STOP);
  assert.equal(d.counts.regression, 1);
  assert.equal(d.regression[0].kind, 'loosened');
  assert.equal(d.regression[0].file, 'regression/x.test.js');
});

test('J-test-drift slice-99830-ac-3 — new code with no test (red_flag) → STOP, regression pile, NOT double-counted as deliberate', () => {
  const d = drift(base('red_flag', {
    newBehaviourNoTest: [bf('scripts/new.js', true)],
    unguardedSourceChanges: [bf('scripts/new.js', true)], // same file appears here too
  }));
  assert.equal(d.action, ACTION.STOP);
  assert.equal(d.counts.regression, 1);
  assert.equal(d.regression[0].kind, 'untested');
  assert.equal(d.counts.deliberate, 0, 'an untested-new file must not also appear in the deliberate pile');
});

test('J-test-drift slice-99830-ac-4 — behaviour changed, no guard moved (needs_review) → REVIEW, deliberate pile', () => {
  const d = drift(base('needs_review', { unguardedSourceChanges: [bf('dashboard/x.html', false)] }));
  assert.equal(d.action, ACTION.REVIEW);
  assert.equal(d.counts.deliberate, 1);
  assert.equal(d.deliberate[0].kind, 'behaviour-changed');
  assert.equal(d.counts.regression, 0);
});

test('J-test-drift slice-99830-ac-5 — declared-intentional override → PROCEED, informational declared pile', () => {
  const d = drift(base('overridden', { overridden: [{ tag: 'slice-2-ac-1', file: 'e2e/y.spec.js', transition: 'removed', reason: 'renamed' }] }));
  assert.equal(d.action, ACTION.PROCEED);
  assert.equal(d.counts.declared, 1);
  assert.match(d.declared[0].why, /declared intentional/i);
});

test('J-test-drift slice-99830-ac-6 — removed + skipped guards both land in the regression pile', () => {
  const d = drift(base('red_flag', {
    removedUndeclared: [chk('e2e/a.spec.js', 'slice-3-ac-1')],
    skippedUndeclared: [chk('regression/b.test.js', 'slice-3-ac-2')],
  }));
  assert.equal(d.action, ACTION.STOP);
  assert.deepEqual(d.regression.map(x => x.kind).sort(), ['removed', 'skipped']);
});

test('J-test-drift slice-99830-ac-7 — a STOP is never causeless: coverage shrink shows up in the regression pile', () => {
  const d = drift(base('red_flag', { coverageShrinkUndeclared: true, coverageGuardCountBase: 191, coverageGuardCount: 188 }));
  assert.equal(d.action, ACTION.STOP);
  assert.equal(d.counts.regression, 1);
  assert.equal(d.regression[0].kind, 'coverage-shrank');
  assert.match(d.regression[0].why, /191.*188/);
});

test('J-test-drift slice-99830-ac-8 — an unknown/missing verdict fails SAFE → STOP', () => {
  assert.equal(drift({}).action, ACTION.STOP);
  assert.equal(drift(base('weird-future-verdict')).action, ACTION.STOP);
});

test('J-test-drift slice-99830-ac-9 — the drift engine source re-buckets over the classifier and never writes a test', () => {
  const src = fs.readFileSync(DRIFT_SRC, 'utf8');
  assert.match(src, /POSSIBLE REGRESSION/);                 // the two operator-facing piles
  assert.match(src, /DELIBERATE CHANGE/);
  assert.match(src, /PROCEED.*REVIEW.*STOP|PROCEED:|REVIEW:|STOP:/s); // the three actions
  assert.match(src, /fails? safe|fail safe|STOP and investigate/i);   // unclassifiable → STOP
  assert.doesNotMatch(src, /writeFileSync|fs\.write/);      // SHOW-only: the lib never writes
});

test('J-test-drift slice-99830-ac-10 — the CLI pins the promoted changeset, is advisory, and feeds the dashboard', () => {
  const src = fs.readFileSync(DRIFT_CLI, 'utf8');
  assert.match(src, /merge-base/);                         // same base as the promote gate
  assert.match(src, /TEST-DRIFT\.json/);                   // writes the dashboard artifact
  assert.match(src, /process\.exit\(0\)/);                 // advisory — the human's OK/STOP decides
  assert.match(src, /require\(['"]\.\.\/lib\/test-drift['"]\)/);
});
