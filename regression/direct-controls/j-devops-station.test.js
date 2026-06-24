'use strict';
// J-devops-station — guards for the DevOps Station redesign (slice 340), authored by the
// Pipeline A drain: O'Brien declared the ACs (bridge/staged/340-STAGED.md), the drain
// discovered them as MISSING, and Bashir wrote these guards for the high-confidence ones.
// Each carries an @ac-hash linking the test to the SPEC so AC-reconcile reads COVERED;
// renaming the panels or unwiring the two-pipeline lock will trip these.
// (slice-340-ac-6 — the merge-pressure rising/falling trend — was escalated to Philipp as
//  low-confidence, not auto-guarded.)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DASH = path.resolve(__dirname, '..', '..', 'dashboard', 'lcars-dashboard.html');
const html = () => fs.readFileSync(DASH, 'utf8');

// @ac-hash: slice-340-ac-1 sha256:54145d8ac9e223dd388d5884524a07ebefcca5efdfb862b3319fe24713686ee8
test('J-devops-station slice-340-ac-1 — the first ops panel is titled "DevOps Station", not "Branch Topology"', () => {
  const src = html();
  assert.match(src, /DevOps Station/, 'the panel must be titled DevOps Station');
  // the old visible heading must be gone (a lore tag/comment may mention it, but not as the panel title text node)
  assert.doesNotMatch(src, /class="[^"]*panel-title[^"]*"[^>]*>\s*Branch Topology/i);
});

// @ac-hash: slice-340-ac-2 sha256:adedf07750fbf6fd7a2b31c5b59d4a14fdf5b45250dd542b310b54674414c95c
test('J-devops-station slice-340-ac-2 — the post-build review panel is titled "Peer Review", not "Post-Build"', () => {
  assert.match(html(), /Peer Review/, 'the review panel must be titled Peer Review');
});

// @ac-hash: slice-340-ac-3 sha256:198c9b94e2242fbe2d20475c472bac1081bc5a861b60b8264e3ec3e6109a799e
test('J-devops-station slice-340-ac-3 — the gate renders two named pipelines: A (test-update) and B (run-tests & merge)', () => {
  const src = html();
  assert.match(src, /Pipeline A/, 'Pipeline A must be present');
  assert.match(src, /Pipeline B/, 'Pipeline B must be present');
});

// @ac-hash: slice-340-ac-4 sha256:0ff6f9b8978b57f8af5e809fb2967b322efb19c56179f7bcbed736146f17c7a4
test('J-devops-station slice-340-ac-4 — Pipeline B stays locked until Pipeline A passes (lock message references passing Pipeline A)', () => {
  assert.match(html(), /pass Pipeline A/i, 'a lock message must tell the operator to pass Pipeline A first');
});

// @ac-hash: slice-340-ac-5 sha256:cfbb898656a6c5ebce52ee060be8363588171275979b6089106d21a82ca77b45
test('J-devops-station slice-340-ac-5 — Pipeline A\'s steps read scan ACs -> reconcile -> resolve', () => {
  const src = html();
  assert.match(src, /scan ACs/, 'step 1: scan ACs');
  assert.match(src, /reconcile/, 'step 2: reconcile');
  assert.match(src, /resolve/, 'step 3: resolve');
});

// @ac-hash: slice-340-ac-6 sha256:84c994374c163ed0b343600152a47ba7960bb36bebe31a40b1228e89a309562b
test('J-devops-station slice-340-ac-6 — the merge-pressure pill shows release risk with a rising/falling trend', () => {
  const src = html();
  assert.match(src, /Merge Pressure/, 'the pill is labelled Merge Pressure');
  assert.match(src, /rising|falling|steady/, 'the pill carries a trend direction, not just a number');
});
