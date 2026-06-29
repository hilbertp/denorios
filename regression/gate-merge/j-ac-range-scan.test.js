'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// Guards lib/ac-range-scan.js — the live AC manifest the CHECK FOR TEST UPDATES gate
// (Pipeline A) builds from the pending merge range's `AC:` commit trailers. Before this,
// the gate reconciled the STATIC regression/AC-MANIFEST.lock (which lags dev) against
// COVERAGE.lock — two in-sync files — so it went green instantly regardless of the merge.

const { parseAcTrailers, scanRangeManifest } = require('../../lib/ac-range-scan');

test('J-ac-range-scan slice-346-ac-1 — parses AC: trailers from commit bodies into a hashed manifest', () => {
  const body = [
    'fix(dashboard): some change',
    '',
    'AC: slice-341-ac-1: the lilac --ink-4 has contrast >= 5.5:1',
    'AC: slice-342-ac-1: the dark-mode label reads "Dark Mode (LCARS)"',
  ].join('\n');
  const m = parseAcTrailers(body);
  assert.deepEqual(Object.keys(m.byTag).sort(), ['slice-341-ac-1', 'slice-342-ac-1']);
  assert.match(m.byTag['slice-341-ac-1'].acHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(m.byTag['slice-341-ac-1'].legacy, false);
  assert.equal(m.byTag['slice-342-ac-1'].text, 'the dark-mode label reads "Dark Mode (LCARS)"');
});

test('J-ac-range-scan slice-346-ac-2 — ignores non-AC lines; a later declaration supersedes an earlier one', () => {
  const body = 'random line\nAC: slice-1-ac-1: first wording\nmore prose\nAC: slice-1-ac-1: amended wording';
  const m = parseAcTrailers(body);
  assert.equal(Object.keys(m.byTag).length, 1);
  assert.equal(m.byTag['slice-1-ac-1'].text, 'amended wording');
});

test('J-ac-range-scan slice-346-ac-3 — tags are lowercased to match COVERAGE.lock guard tags', () => {
  const m = parseAcTrailers('AC: SLICE-9-AC-2: mixed case tag');
  assert.ok(m.byTag['slice-9-ac-2'], 'tag should be lowercased');
});

test('J-ac-range-scan slice-346-ac-4 — scanRangeManifest fails open to an empty manifest on a git error', () => {
  const m = scanRangeManifest({ gitLog: () => { throw new Error('not a git repository'); } });
  assert.deepEqual(m, { byTag: {} });
});

test('J-ac-range-scan slice-346-ac-5 — an empty range yields an empty manifest (honest green: nothing to check)', () => {
  const m = scanRangeManifest({ gitLog: () => '' });
  assert.deepEqual(m, { byTag: {} });
});
