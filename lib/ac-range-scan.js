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
const { laneOfCommitBody } = require('./ac-block');

// One AC trailer per line: "AC: slice-341-ac-1: <text>". Global+multiline; case-insensitive
// on the "AC:" key. The tag is lowercased to match COVERAGE.lock guard tags.
const AC_TRAILER = /^AC:\s*(slice-\d+-ac-\d+):\s*(.+?)\s*$/gim;

// parseAcTrailers(body) → { byTag: { tag: { acHash, legacy:false, text, lane } } }
// Last-in-`body` wins if a tag appears twice. CONTRACT: callers must feed the commit bodies
// OLDEST-first (git log --reverse) so "last wins" = the newest declaration (an amendment
// supersedes the original). Feeding the git default (newest-first) inverts this and an
// amended-but-covered AC would false-green — guarded by j-ac-amend-order.
//
// `lane` (slice 390) is read PER RECORD, from the `Lane:` trailer of the same commit whose
// `AC:` lines declared the criterion — so a surface slice and a core slice in one range keep
// their own lanes. `body` may be `\0`-separated records (a `--format=%B%x00` log); a body with
// no separator is ONE record, which is what every caller fed before this and still may.
// The newest declaration carries the lane with it, exactly as it carries the text.
//
// `lane` is `null` when the declaring record named no lane — RAW, not defaulted. This is the
// low-level read: it reports what history says, silence included, so the manifest deriver can
// tell "declared core" from "nobody said" and fall back to the slice file's frontmatter for
// the second. scanRangeManifest below applies the `core` default for everyone else.
function parseAcTrailers(body) {
  const byTag = {};
  for (const record of String(body || '').split('\0')) {
    const lane = laneOfCommitBody(record);
    AC_TRAILER.lastIndex = 0;
    let m;
    while ((m = AC_TRAILER.exec(record)) !== null) {
      const tag = m[1].toLowerCase();
      const text = m[2].trim();
      if (text) byTag[tag] = { acHash: acHashOf(text), legacy: false, text, lane };
    }
  }
  return { byTag };
}

// scanRangeManifest({ gitLog, range }) — gitLog(range) returns the commit bodies for
// `range`, `\0`-separated when the caller wants per-commit lanes. Returns the live manifest;
// { byTag:{} } — and nothing else, pinned by j-ac-range-scan — on any failure (an empty
// range = nothing to promote = nothing to check, which is an HONEST green, unlike before).
//
// EVERY entry it returns carries a lane. A live range is one source with no second look —
// there is no slice file to consult from a commit log — so an undeclared lane is `core` here,
// which is the full rigour the back catalogue gets. The deriver, which does have somewhere
// else to look, reads parseAcTrailers directly and applies the default after its fallback.
function scanRangeManifest({ gitLog, range = 'origin/main..origin/dev' } = {}) {
  let body = '';
  try { body = gitLog(range) || ''; } catch (_) { return { byTag: {} }; }
  const { byTag } = parseAcTrailers(body);
  for (const e of Object.values(byTag)) if (e.lane == null) e.lane = 'core';
  return { byTag };
}

module.exports = { scanRangeManifest, parseAcTrailers, AC_TRAILER };
