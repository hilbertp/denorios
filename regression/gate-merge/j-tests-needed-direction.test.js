'use strict';
// J-tests-needed — the signed assertion-direction engine (ADR-TEST-UPDATE-GATE, Slice A).
// Bashir's gate for the load-bearing anti-masking logic: the engine must make the
// dangerous direction (loosen / delete / skip) LOUD and never let it read as benign.
const { test } = require('node:test');
const assert = require('node:assert');
const { classifyFileDiff, classifyDirection, assertRank, tagOf } = require('../../lib/assert-direction');

// Build a minimal unified diff for ONE test whose body changed (test line is context).
function diffBody(tag, minusLines, plusLines, headLine) {
  const head = headLine || `test('J-x ${tag} — a check', () => {`;
  return ['@@ -1,5 +1,5 @@', ` ${head}`]
    .concat(minusLines.map(l => `-  ${l}`))
    .concat(plusLines.map(l => `+  ${l}`))
    .concat([' });']).join('\n');
}
const dirOf = (tag, diff) => classifyFileDiff(diff)[tag] && classifyFileDiff(diff)[tag].direction;

test('J-tests-needed slice-99820-ac-1 — strict equality weakened to truthiness reads as LOOSENED', () => {
  assert.equal(dirOf('slice-100-ac-1', diffBody('slice-100-ac-1', ['assert.equal(x, 5);'], ['assert.ok(x >= 0);'])), 'loosened');
});

test('J-tests-needed slice-99820-ac-2 — a literal collapsing into a tautology reads as LOOSENED', () => {
  assert.equal(dirOf('slice-100-ac-2', diffBody('slice-100-ac-2', ['assert.equal(status, 200);'], ['assert.equal(status, status);'])), 'loosened');
});

test('J-tests-needed slice-99820-ac-3 — extracting a strict assert into a helper reads as REWORDED, not loosened', () => {
  const diff = [
    '@@ -1,4 +1,4 @@',
    " test('J-x slice-100-ac-3 — c', () => {",
    '-  assert.strictEqual(a, b);',
    '+  expectStrict(a, b);',
    ' });',
    '@@ -20,0 +21,3 @@',
    '+function expectStrict(x, y) {',
    '+  assert.strictEqual(x, y);',
    '+}',
  ].join('\n');
  assert.equal(classifyFileDiff(diff)['slice-100-ac-3'].direction, 'reworded');
});

test('J-tests-needed slice-99820-ac-4 — test(...) becoming test.skip(...) reads as SKIPPED', () => {
  const diff = [
    '@@ -1,3 +1,3 @@',
    "-test('J-x slice-100-ac-4 — d', () => {",
    "+test.skip('J-x slice-100-ac-4 — d', () => {",
    '   assert.equal(x, 1);',
    ' });',
  ].join('\n');
  assert.equal(classifyFileDiff(diff)['slice-100-ac-4'].direction, 'skipped');
});

test('J-tests-needed slice-99820-ac-5 — swapping a known-strict assert for an unrecognised idiom reads as LOOSENED (fail loud)', () => {
  assert.equal(dirOf('slice-100-ac-5', diffBody('slice-100-ac-5', ['assert.strictEqual(x, 5);'], ['myCustomCheck(x);'])), 'loosened');
});

test('J-tests-needed slice-99820-ac-6 — adding an assertion with no removal reads as TIGHTENED', () => {
  const diff = [
    '@@ -1,3 +1,4 @@',
    " test('J-x slice-100-ac-6 — f', () => {",
    '   assert.equal(x, 1);',
    '+  assert.equal(y, 2);',
    ' });',
  ].join('\n');
  assert.equal(classifyFileDiff(diff)['slice-100-ac-6'].direction, 'tightened');
});

test('J-tests-needed slice-99820-ac-7 — deleting an assertion but keeping the test reads as LOOSENED', () => {
  const diff = [
    '@@ -1,4 +1,3 @@',
    " test('J-x slice-100-ac-7 — g', () => {",
    '   assert.equal(x, 1);',
    '-  assert.equal(y, 2);',
    ' });',
  ].join('\n');
  assert.equal(classifyFileDiff(diff)['slice-100-ac-7'].direction, 'loosened');
});

test('J-tests-needed slice-99820-ac-8 — deleting the whole test reads as REMOVED', () => {
  const diff = [
    '@@ -1,3 +0,0 @@',
    "-test('J-x slice-100-ac-8 — h', () => {",
    '-  assert.equal(x, 1);',
    '-});',
  ].join('\n');
  assert.equal(classifyFileDiff(diff)['slice-100-ac-8'].direction, 'removed');
});

test('J-tests-needed slice-99820-ac-9 — tightening (truthiness → strict equality) reads as TIGHTENED', () => {
  assert.equal(dirOf('slice-100-ac-9', diffBody('slice-100-ac-9', ['assert.ok(x);'], ['assert.strictEqual(x, 5);'])), 'tightened');
});

test('J-tests-needed slice-99820-ac-10 — Playwright toBe weakened to toBeVisible reads as LOOSENED', () => {
  assert.equal(dirOf('slice-100-ac-10', diffBody('slice-100-ac-10',
    ['await expect(el).toHaveText("Done");'], ['await expect(el).toBeVisible();'])), 'loosened');
});

test('J-tests-needed slice-99820-ac-11 — tagOf keys on the slice-ac tag, falling back to the trimmed title', () => {
  assert.equal(tagOf('J-foo slice-99-ac-3 — bar'), 'slice-99-ac-3');
  assert.equal(tagOf('an untagged e2e title'), 'an untagged e2e title');
});

test('J-tests-needed slice-99820-ac-12 — the rank table orders strict > pattern > truthiness', () => {
  assert.ok(assertRank('assert.strictEqual(a, b)') > assertRank('assert.match(a, /b/)'));
  assert.ok(assertRank('assert.match(a, /b/)') > assertRank('assert.ok(a)'));
  assert.equal(assertRank('weirdCustomThing(a)'), null);
});
