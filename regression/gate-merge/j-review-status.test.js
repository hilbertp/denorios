'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Guards the recurring "the History success pill appears the instant Rom is done, before
// Nog reviews" bug. Root cause: the staged-backlog START approval (HUMAN_APPROVAL) was fed
// into `acceptedSet`, so a slice flipped to reviewStatus 'accepted' (green success pill)
// as soon as it was approved-to-begin. A slice is only "accepted" once Nog ACCEPTS the
// finished work, or it actually merges to main. (slice-345-ac-1.)

const { deriveReviewStatus } = require('../../dashboard/server');

test('J-review-status slice-345-ac-1 — Rom done, no Nog verdict, not merged → NOT accepted (no premature success)', () => {
  assert.equal(deriveReviewStatus({ verdict: undefined, mergedToMain: false }), 'waiting_for_review');
});

test('J-review-status slice-345-ac-2 — Nog ACCEPTED → accepted (the only path to the green pill via review)', () => {
  assert.equal(deriveReviewStatus({ verdict: 'ACCEPTED', mergedToMain: false }), 'accepted');
});

test('J-review-status slice-345-ac-3 — actually merged to main → accepted', () => {
  assert.equal(deriveReviewStatus({ verdict: undefined, mergedToMain: true }), 'accepted');
});

test('J-review-status slice-345-ac-4 — Nog requested changes → apendment_required (still not a success pill)', () => {
  assert.equal(deriveReviewStatus({ verdict: 'APENDMENT_REQUIRED', mergedToMain: false }), 'apendment_required');
});

test('J-review-status slice-345-ac-5 — acceptedSet is NOT fed by the staged START approval (HUMAN_APPROVAL)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'dashboard', 'server.js'), 'utf8');
  // The acceptedSet membership must never key on HUMAN_APPROVAL again — that is the bug.
  assert.ok(
    !/ev\.event === 'HUMAN_APPROVAL'[\s\S]{0,40}acceptedSet\.add/.test(src),
    'HUMAN_APPROVAL must not feed acceptedSet (it is the START approval, not Nog acceptance)'
  );
});
