'use strict';

// Build the LIVE AC manifest from the pending merge range's `AC:` git trailers — the set
// of acceptance criteria actually being promoted (origin/main..origin/dev). This is what
// the CHECK FOR TEST UPDATES gate (Pipeline A) must reconcile against test coverage.
//
// WHY THIS EXISTS: the gate used to reconcile the STATIC regression/AC-MANIFEST.lock
// (which lags behind dev) against COVERAGE.lock — two files kept in sync on disk — so it
// went GREEN in milliseconds no matter what was being merged. It never read the commits.
// Slices declare their ACs as `AC: slice-N-ac-K: <text>` commit trailers (the decided
// off-canon mechanism); this scans them straight from the range so the gate reflects
// reality.
//
// Pure over an injected `gitLog(range)` so it's unit-testable without a repo.

const { acHashOf } = require('../scripts/build-ac-manifest');

// One AC trailer per line: "AC: slice-341-ac-1: <text>". Global+multiline; case-insensitive
// on the "AC:" key. The tag is lowercased to match COVERAGE.lock guard tags.
const AC_TRAILER = /^AC:\s*(slice-\d+-ac-\d+):\s*(.+?)\s*$/gim;

// parseAcTrailers(body) → { byTag: { tag: { acHash, legacy:false, text } } }
// Last-in-`body` wins if a tag appears twice. CONTRACT: callers must feed the commit bodies
// OLDEST-first (git log --reverse) so "last wins" = the newest declaration (an amendment
// supersedes the original). Feeding the git default (newest-first) inverts this and an
// amended-but-covered AC would false-green — guarded by j-ac-amend-order.
function parseAcTrailers(body) {
  const byTag = {};
  AC_TRAILER.lastIndex = 0;
  let m;
  while ((m = AC_TRAILER.exec(body || '')) !== null) {
    const tag = m[1].toLowerCase();
    const text = m[2].trim();
    if (text) byTag[tag] = { acHash: acHashOf(text), legacy: false, text };
  }
  return { byTag };
}

// scanRangeManifest({ gitLog, range }) — gitLog(range) returns the concatenated commit
// bodies for `range`. Returns the live manifest; { byTag:{} } on any failure (an empty
// range = nothing to promote = nothing to check, which is an HONEST green, unlike before).
function scanRangeManifest({ gitLog, range = 'origin/main..origin/dev' } = {}) {
  let body = '';
  try { body = gitLog(range) || ''; } catch (_) { return { byTag: {} }; }
  return parseAcTrailers(body);
}

module.exports = { scanRangeManifest, parseAcTrailers, AC_TRAILER };
