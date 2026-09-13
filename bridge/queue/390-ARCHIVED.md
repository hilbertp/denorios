---
id: "390"
title: "The coverage gate learns the lane"
from: rom
to: nog
status: ACCEPTED
slice_id: "390"
branch: "slice/390"
completed: "2026-09-13T21:05:00.000Z"
tokens_in: 70
tokens_out: 36666
elapsed_ms: 519632
estimated_human_hours: 1.5
compaction_occurred: false
tokens_cache_read: 2987047
cost_usd: 3.4950585
---

# The coverage gate learns the lane — amendment round 1

## Summary

Nog's one finding is fixed: `laneOfCommitBody` no longer collapses "this record declared no
lane" into `'core'`, so the frontmatter fallback ac-1 specifies is reachable in the
configuration that is actually live today.

The chain ac-1 asks for is trailer → frontmatter → core. What round 1 built was
trailer-**or-core** → frontmatter *only if no commit named the tag at all* → core. Because
`laneOfCommitBody` answered `'core'` to silence, `build-ac-manifest` pass 3 overwrote pass 1's
frontmatter lane with a value that only meant "nobody said". Every slice landing between now
and the daemon restart carries `AC:` lines without a `Lane:` line, so in that window the
frontmatter is the *only* source of a lane — and it was exactly the source being discarded.
`laneOfSliceFile` was dead code wherever a trailer existed.

The fix is Nog's: the reader reports absence, and each consumer applies the `core` default at
its own boundary. `scanRangeManifest` resolves `null → 'core'` because a commit log has no
slice file to consult, so every live-scan entry still carries a lane. `tests-needed`'s
per-commit attribution does the same, so unlabelled is still policed. Only the deriver — the
one caller with somewhere else to look — reads the `null`, and pass 3 takes
`t.lane || cur.lane`.

Two conflicting `Lane:` lines in one record still read a *declared* `'core'`, unchanged. That
is a concatenation of two commit bodies, not silence, and deferring to the frontmatter there
would be the same guess one file further away.

I also took the two non-blocking notes from the review. Nothing else moved: ac-2 through ac-5
were accepted and I did not touch `lib/ac-reconcile.js`, `lib/check-test-updates.js`,
`scripts/ac-reconcile.js` or `dashboard/server.js` this round.

## What changed

Five files, all on the brief's expected list.

- **`lib/ac-block.js`** — `laneOfCommitBody(body)` → `'core' | 'surface' | null`. `null` when
  the record declares no `Lane:` line; a declared lane when it declares exactly one; a
  declared `'core'` when it declares two different ones (a `%B` log with no separator — the
  trap-5 case, behaviour unchanged). Header comment updated to say where the default is now
  applied and why one caller must see the raw answer.
- **`lib/ac-range-scan.js`** — `parseAcTrailers` passes the raw `lane` through, silence
  included; it is the low-level read. `scanRangeManifest` resolves `null → 'core'` at its own
  boundary, so the guarantee "every live-scan entry carries a lane" is unchanged. The failure
  return is still exactly `{ byTag: {} }`.
- **`scripts/build-ac-manifest.js`** — `trailerTexts()` reads `parseAcTrailers` directly
  rather than through `scanRangeManifest`, because the scan resolves the very `null` the
  deriver needs to see; it keeps the scan's fail-closed behaviour (a log that throws
  contributes no trailers). Pass 3 now writes `lane: t.lane || cur.lane`. The trailer still
  owns the **text** unconditionally — history is the immutable record of what was declared —
  and owns the **lane** only when it declares one.
- **`lib/tests-needed.js`** — `laneOfCommitBody(...) || 'core'` at the per-commit attribution
  site, so unlabelled reads core and the file stays policed exactly as before. Plus the note
  Nog asked for on the `facts` comment: `facts.surfaceOnlyFiles` holds path **strings** (the
  gate's question) while the output field of the same name holds behaviourFile **objects**
  (its answer), and `decide()`'s result is not a facts object.
- **`regression/gate-merge/j-gate-lanes.test.js`** — ac-1 gains the three-link fallback chain
  including the configuration that failed review; trap 3 updated for the raw read; the two
  brittle pins Nog flagged addressed (below).

`regression/AC-MANIFEST.lock` is **unchanged and was not regenerated**, per this round's
instructions. It is also provably still correct: no tracked slice file carries a frontmatter
`lane:` yet (Nog checked all 41), so every entry derives `'core'` with or without this fix,
and `j-ac-manifest-integrity` — a full serialized string compare of the committed lock against
a fresh derivation — is green.

## Acceptance criteria verification

- **slice-390-ac-1** — the fallback chain is now trailer → frontmatter → core, all three links
  reachable. Verified against the deriver in a temp repo with a tracked slice file carrying
  `lane: surface`:
  - landing commit with `Lane: core` → `core` (a declared lane outranks the file);
  - landing commit with `AC:` lines and **no** `Lane:` line → `surface` (**was `core`** — the
    finding), `source` still `commit-trailer`, so history still owns the text;
  - no trailer naming the tag at all → `surface` (unchanged from round 1).
  The live scan still carries a lane on every entry: `scanRangeManifest` resolves the
  undeclared case to `core`.
- **slice-390-ac-2, ac-3, ac-4, ac-5** — met, and unchanged from the round Nog accepted. Their
  modules were not edited. ac-4's `laneFlipped` reads `(b.lane || 'core')`, so the `null` that
  now exists upstream still resolves to core on a base entry; ac-5's whole-object `deepEqual`s
  against the copied fixtures are green.

## Safety-net tests

`regression/gate-merge/j-gate-lanes.test.js` — **10 tests, 10 pass, 0 fail**. Still exactly 5
criterion tests + 5 trap tests; no test was added or removed this round, and all five
`@ac-hash` lines are unchanged.

**Break-it, whole slice.** With all eight modules reverted to `5d2a963` (the pre-slice parent)
and the test file kept, **all 10 go red — 0 pass, 10 fail** — and every one is an
`ERR_ASSERTION`, not a module-load crash. Restored: 10/10 green.

**Break-it, this round's fix specifically.** With the four modules reverted to round 1's
committed code (`15d03e9`), **2 of the 10 go red**: `slice-390-ac-1` and `trap 3`, both on the
`'core'` vs `null` distinction. Because ac-1 short-circuits at that first assertion, I also
ran the frontmatter-clobber case standalone against round-1 code to confirm the finding itself
is what the test now catches:

    round-1 code:  source: commit-trailer   lane: core      ← the defect
    with the fix:  source: commit-trailer   lane: surface   ← expected

**Two brittle pins from Nog's flags, addressed:**
- The `/const workSet = counts\.MISSING \+ counts\.STALE;/` source grep is **removed**. The
  same test already asserts the claim behaviourally and more strongly, twice
  (`r.workSet === 2` with a SURFACE present, `green.workSet === 0`), so the grep pinned
  nothing the test did not already own and went red on reordering two addends.
- The STEP-1 console pin is loosened from `/surface \$\{r\.counts\.SURFACE\}/` to
  `/surface \$\{[^}]*\.SURFACE\}/`, so renaming the local no longer trips it while dropping
  the count still does. It stays a source grep because a `console.log` has no other surface.
- The third, `/split\('\\0'\)/`, I left as it is: it guards the per-commit boundary the whole
  slice rests on, and there is no behavioural expression of "the scanner splits on NUL" that a
  fixture someone already split correctly could show.

**Consumers.** The nine files the brief permits, run one by one, all green: j-gate-lanes 10,
j-ac-reconcile-classifier 8, j-tests-needed-verdict 20, j-check-test-updates 13, j-ac-gate-wire
10, j-ac-amend-order 2, j-ac-range-scan 5, j-ac-drain-feed 7, j-ac-manifest-integrity 5,
j-ac-manifest-trailer-source 9. I did not run the full safety-net suite or the browser suite.
`node --check` is clean on all five changed files.

I did not look in a browser this round: no markup changed and the overlay was untouched.

## Screen hooks

None new. No markup changed this round — the overlay renders `flagged` and counts the rest,
and a SURFACE criterion is simply never in `flagged`. The hooks named in round 1's report
(`#check-updates-btn`, `.utc-clear`, `.utc-clear-head`, `.utc-scan`/`.utc-scan-rest`,
`.utc-ac`) all still exist and are unchanged.

## Tests moved or weakened

No test file other than my own was touched, and nothing was moved. Three changes inside
`j-gate-lanes.test.js`, none of them a weakening:

1. **ac-1, line 128** — `parseAcTrailers` on a record with no `Lane:` line: expected `'core'` →
   expected `null`. The claim was not dropped, it moved to the boundary that owns it: the same
   test now asserts `scanRangeManifest` resolves that same record to `'core'`, which is what
   ac-1's "defaulting to core" actually governs. Net: one assertion became two, and the pair
   now distinguishes a declared core from silence, which is the whole finding.
2. **trap 3** — same change, same reason, for the un-separated single body.
3. **ac-2** — the redundant `workSet` source grep removed, the console pin loosened, as set
   out above. The criterion's behavioural assertions are untouched.

ac-1 also **gained** three assertions (a trailer declaring `core` overriding a frontmatter
`surface`; the no-`Lane:`-trailer clobber case; `laneOfCommitBody`'s three answers). No `e2e/`
file was touched and no browser test was written.

## Commit

`74f8f80` — *S390 r1: the lane reader reports silence, so the frontmatter fallback lives*
(branch `slice/390`), carrying all five `AC:` trailers and `Lane: core`.

Five files: `lib/ac-block.js`, `lib/ac-range-scan.js`, `lib/tests-needed.js`,
`scripts/build-ac-manifest.js`, `regression/gate-merge/j-gate-lanes.test.js`. No lock was
regenerated or edited, per this round's instructions.
