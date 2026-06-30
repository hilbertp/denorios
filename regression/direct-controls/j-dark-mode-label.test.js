'use strict';

// J-dark-mode-label — guards slice-342-ac-1: the dark-mode toggle label reads
// "Dark Mode (LCARS)" (renamed from the bare "LCARS"). This AC was surfaced as MISSING by
// AC-reconcile — a real merged slice with no guard — so this is its coverage. The @ac-hash
// below links the test to the spec so the reconcile reads COVERED.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DASH = path.resolve(__dirname, '..', '..', 'dashboard', 'lcars-dashboard.html');

// @ac-hash: slice-342-ac-1 sha256:7ca273aff035552ba8ce07eab3d355c8f85b21d341d2fe4941217f2c3e69395e
test('J-dark-mode-label slice-342-ac-1 — the dark-mode toggle label reads "Dark Mode (LCARS)"', () => {
  const src = fs.readFileSync(DASH, 'utf8');
  assert.match(src, /<span class="lcars-switch-text">Dark Mode \(LCARS\)<\/span>/,
    'the .lcars-switch-text span must read "Dark Mode (LCARS)", not the bare "LCARS"');
});
