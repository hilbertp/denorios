'use strict';
// J-tests-needed — ENGINE SELF-LOCK (ADR-TEST-UPDATE-GATE, Slice F).
//
// The gate's whole value is that it fails toward FIX-THE-CODE: the dangerous
// direction (loosen / delete / skip / shrink coverage) must be LOUD, never benign,
// and an unknown idiom must be assumed weak. These properties are easy to weaken in
// a "harmless" refactor. This suite locks them — behaviourally through the public
// API, and structurally on the two guard clauses that are easiest to delete.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { decide, parseTrailers } = require('../../lib/tests-needed');
const { classifyDirection, assertRank } = require('../../lib/assert-direction');

const ENGINE_SRC = path.resolve(__dirname, '..', '..', 'lib', 'tests-needed.js');
const DIRECTION_SRC = path.resolve(__dirname, '..', '..', 'lib', 'assert-direction.js');
const noTrailers = () => ({ testsNotNeeded: [], loosenOk: [], coverageRemoved: [], rejected: [] });
const check = (direction, kind) => ({ file: 'regression/x.test.js', tag: 'slice-1-ac-1', area: 'regression', kind: kind || 'modified', direction });

test('J-tests-needed slice-99823-ac-1 — EVERY masking direction is RED with no override (fail toward fix-the-code)', () => {
  for (const dir of ['loosened', 'removed', 'skipped']) {
    const r = decide({ behaviourFiles: [], checks: [check(dir, dir === 'removed' ? 'removed' : 'modified')], trailers: noTrailers() });
    assert.equal(r.decision, 'red_flag', `a ${dir} check must read RED without an override`);
  }
});

test('J-tests-needed slice-99823-ac-2 — a non-masking direction never trips RED on its own', () => {
  for (const dir of ['tightened', 'reworded']) {
    const r = decide({ behaviourFiles: [], checks: [check(dir)], trailers: noTrailers() });
    assert.notEqual(r.decision, 'red_flag', `a ${dir} check must not read RED`);
  }
});

test('J-tests-needed slice-99823-ac-3 — an unknown idiom replacing a strict assert reads as LOOSENED (fail loud)', () => {
  // added, removed: a known-strict assertion swapped for an unrecognised call.
  assert.equal(classifyDirection(['mysteryCheck(x)'], ['assert.strictEqual(x, 5)']), 'loosened');
  assert.equal(assertRank('mysteryCheck(x)'), null, 'an unrecognised idiom must have no rank (so it cannot earn strictness)');
  // A pure deletion of assertions (test kept) is loosened, never benign.
  assert.equal(classifyDirection([], ['assert.equal(y, 2)']), 'loosened');
});

test('J-tests-needed slice-99823-ac-4 — unscoped / malformed override trailers are REJECTED, not honoured', () => {
  const t = parseTrailers([
    'feat\n\nTests-Not-Needed: trustme',
    'fix\n\nTest-Loosen-OK: slice-1-ac-1 not-a-transition because reasons',
  ]);
  assert.ok(t.rejected.length >= 1, 'a bare Tests-Not-Needed must be rejected');
  assert.equal(t.loosenOk.length, 0, 'a malformed transition must not parse as a valid override');
  // A rejected trailer itself forces RED.
  const r = decide({ behaviourFiles: [], checks: [], trailers: Object.assign(noTrailers(), { rejected: t.rejected }) });
  assert.equal(r.decision, 'red_flag');
});

test('J-tests-needed slice-99823-ac-5 — a mismatched override does NOT clear the masking (RED holds)', () => {
  const t = noTrailers();
  t.loosenOk = [{ target: 'slice-1-ac-1', transition: 'removed', reason: 'mislabelled' }];
  const r = decide({ behaviourFiles: [], checks: [check('loosened')], trailers: t });
  assert.equal(r.decision, 'red_flag', 'wrong transition must not override a loosen');
  assert.equal(r.mismatchedOverride, true);
});

test('J-tests-needed slice-99823-ac-6 — the engine source keeps its fail-loud + fail-toward-RED guard clauses', () => {
  const dir = fs.readFileSync(DIRECTION_SRC, 'utf8');
  const eng = fs.readFileSync(ENGINE_SRC, 'utf8');

  // assert-direction: deleting assertions reads loosened; the unknown-idiom asymmetry
  // (added-unknown = weak/0, removed-unknown = strict/3) must survive refactors.
  assert.match(dir, /a === 0 && r > 0\) return 'loosened'/, 'deleting assertions must stay loosened');
  assert.match(dir, /k == null \? 0/, 'an unknown ADDED assertion must count as weak');
  assert.match(dir, /k == null \? 3/, 'an unknown REMOVED assertion must count as strict (loss is loud)');

  // tests-needed: the verdict lattice ranks red_flag worst, masking triggers RED, and
  // the anti-shrink invariant is part of the RED trigger.
  assert.match(eng, /red_flag:\s*3/, 'the verdict lattice must rank red_flag as the worst outcome');
  assert.match(eng, /loosenedUndeclared\.length \|\| removedUndeclared\.length \|\| skippedUndeclared\.length/,
    'masking directions must remain part of the RED trigger');
  assert.match(eng, /coverageShrinkUndeclared/, 'the anti-shrink invariant must remain part of the RED trigger');
});
