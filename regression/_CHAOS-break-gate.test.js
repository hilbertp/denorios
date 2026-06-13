'use strict';

// ⚠️ TEMPORARY CHAOS TEST — deliberately fails to prove the regression gate STOPS a
// merge on red. It is pushed to dev on purpose, gated once, then REVERTED. It must
// NOT survive on dev or main. If you are reading this on main, something went wrong:
// the gate failed to block, or the revert never landed.

const { test } = require('node:test');
const assert = require('node:assert/strict');

test('CHAOS slice-000-ac-1 — intentional failure: a red regression suite must block promotion to main', () => {
  assert.equal(1, 2, 'deliberate break — the gate must fail here and leave origin/main untouched');
});
