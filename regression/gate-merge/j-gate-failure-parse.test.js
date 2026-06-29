'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// Guards parseGateFailures (dashboard/server.js): turns a promote run's `gh --log-failed`
// output into the failure_detail the dev-lead handoff prompt names. It must cover ALL gate
// phases, not just Playwright — a Test-Update gate RED used to yield empty detail, leaving
// the prompt generic ("investigate the test-update suite") with no specifics.

const { parseGateFailures } = require('../../dashboard/server');

// gh --log-failed prefixes every line with "<job>\t<step>\t<ISO-timestamp> ".
const TS = '2026-06-29T10:12:57.5167320Z';
const ln = (content) => `gate-and-promote\tTest-Update Gate (verdict)\t${TS} ${content}`;

test('J-gate-failure-parse slice-347-ac-1 — Test-Update ⚠ categories + items become reasons; declared (non-⚠) categories do not', () => {
  const log = [
    ln('Test-Update Gate: ✗ RED FLAG  (base 0da505f → head 159082f)'),
    ln('  ⚠ New behaviour, no test (1):'),
    ln('    - lib/ac-range-scan.js'),
    ln('  ⚠ Removed (undeclared) (1):'),
    ln('    - slice-9-ac-1 [e2e/foo.spec.js]'),
    ln('  Overridden (declared) (1):'),
    ln('    - slice-1-ac-1 removed — DECLARED, must not appear'),
  ].join('\n');
  const d = parseGateFailures(log);
  assert.ok(d && Array.isArray(d.reasons), 'reasons present');
  assert.ok(d.reasons.includes('New behaviour, no test: lib/ac-range-scan.js'));
  assert.ok(d.reasons.includes('Removed (undeclared): slice-9-ac-1 [e2e/foo.spec.js]'));
  assert.ok(!d.reasons.some(r => r.includes('DECLARED, must not appear')), 'declared category not a failure');
});

test('J-gate-failure-parse slice-347-ac-2 — captures "Rejected trailers" (no ⚠) and "Coverage shrank"', () => {
  const log = [
    ln('  Rejected trailers (1):'),
    ln('    - Tests-Not-Needed: needs a path-glob and a reason'),
    ln('  ⚠ Coverage shrank: 12 → 10 guards with no Coverage-Removed trailer'),
  ].join('\n');
  const d = parseGateFailures(log);
  assert.ok(d.reasons.includes('Rejected trailers: Tests-Not-Needed: needs a path-glob and a reason'));
  assert.ok(d.reasons.some(r => r.startsWith('Coverage shrank:')));
});

test('J-gate-failure-parse slice-347-ac-3 — Playwright failures still parse to tests + locators (no regression)', () => {
  const log = [
    ln('  1) [chromium] › e2e/rollback.spec.js:54:1 › the topology Roll back button opens a preview'),
    ln("    Locator: locator('#topo-rollback-btn').locator('.rollback-card')"),
  ].join('\n');
  const d = parseGateFailures(log);
  assert.equal(d.tests.length, 1);
  assert.equal(d.tests[0].spec, 'e2e/rollback.spec.js');
  assert.equal(d.tests[0].line, '54');
  assert.ok(d.locators.some(l => l.includes('rollback-card')));
});

test('J-gate-failure-parse slice-347-ac-4 — node:test regression failures become reasons', () => {
  const d = parseGateFailures(ln('✖ J-foo slice-1-ac-1 — does the thing (2.5ms)'));
  assert.ok(d.reasons.includes('Failing test: J-foo slice-1-ac-1 — does the thing'));
});

test('J-gate-failure-parse slice-347-ac-5 — a clean log yields null (no false failures)', () => {
  assert.equal(parseGateFailures('all good\nnothing failed here'), null);
  assert.equal(parseGateFailures(''), null);
});
