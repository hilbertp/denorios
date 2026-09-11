---
id: "387"
title: "The pipeline owns the lock files and hands Sam his hashes"
from: rom
to: nog
status: DONE
slice_id: "387"
branch: "slice/387"
completed: "2026-09-12T09:14:00.000Z"
tokens_in: 186000
tokens_out: 11000
elapsed_ms: 640000
estimated_human_hours: 1.5
compaction_occurred: false
---

## Summary

Round 2, answering Nog's three findings. The mechanism he accepted is unchanged; what
changed is that the new test file no longer contaminates the two derivers it exists to hand
over, and the dirty guard no longer has a hole an untracked directory walks through.

Findings 1 and 2 had the single root cause Nog named. The test file wrote its fixtures'
test lines as source literals, and both scanners read raw source, so those literals read as
*this* file's own tests. `j-gate-fail-retry` saw an untagged name — its regex stops at the
unescaped apostrophe in `fixture's`, leaving the name `${FIX_TAG} the fixture` — and turned
the full suite red. `build-coverage-map`'s `tagsIn` saw a real tag and carried
`slice-999-ac-9` into `COVERAGE.lock`, and through `tagUniverse` into `AC-MANIFEST.lock`. A
fixture string had entered an integrity-locked ledger, in the very slice that takes that
ledger away from the builder. The fixtures' test lines are now assembled from a variable, so
neither scanner finds a quoted title where none is meant, and both locks are regenerated
clean.

Finding 3, the untracked-directory hole, is a one-word repair plus a test: `git status
--porcelain` collapses a wholly untracked directory to a single `?? regression/newdir/`
line, which is not a `.test.js` path, so the guard cleared it — and then the deriver walked
into the directory anyway and baked the files in. `-uall` names the file instead.

## What changed

- `regression/dispatch-execution/j-locks-regenerated-at-landing.test.js`
  - New `CALL`/`fixtureTest(name)` pair: the fixtures' test lines are now built from a
    variable, so the file's raw bytes contain no call to test with a quoted literal that
    belongs to a fixture. Three call sites moved onto it — the fixture's one tagged guard,
    and the uncommitted file used by the ac-2 failure test and by trap 6.
  - The comment explaining why states the shape in words instead of showing it. My first
    attempt wrapped the literal shape in backticks inside that comment, which the name
    scanner promptly matched — comments are raw source too. Caught before committing.
  - One test added, `slice-387-ac-2` — an untracked *directory* of test files must trip the
    dirty guard rather than be collapsed to one line. This takes the file from 14 tests to
    15; see `## Safety-net tests` for why it is not surplus.
- `bridge/orchestrator.js`
  - The landing's dirty check reads `git status --porcelain -uall`, with a comment on why
    the flag is load-bearing. One word plus a comment; nothing else in the file moved.
- `regression/COVERAGE.lock`, `regression/AC-MANIFEST.lock` — regenerated. `slice-999-ac-9`
  is gone from both; the coverage map is 595 guards over 57 sources.

Everything from round 1 stands unchanged: `buildHashLines`, the `## Your hash lines` block
and the three sentences in `buildDoneTemplate`, `LOCK_FILES`/`isLockDeriverInput`,
`newestDoneEvent`/`refillLandedDoneReport`, `regenerateLocksAtLanding`, and the
`squashSliceToDev` changes (pre-squash sha, lock-only drift resolution, the second regex
over the same `bodies` string, the dropped human-only trailers, `devSha` read after the
amend). The second template inside `invokeBashirNonGate` is still untouched. No `e2e/` file
was touched in either round.

## Acceptance criteria verification

Command for every row: `node --test regression/dispatch-execution/j-locks-regenerated-at-landing.test.js`
→ **15/15 pass**.

| Tag | Test | Result |
|---|---|---|
| slice-387-ac-1 | `…a branch carrying stale locks lands on dev with both locks equal to a fresh regeneration…` | pass |
| slice-387-ac-2 | `…the event, branch-state and the push all carry the AMENDED sha` + `…when regeneration fails nothing is pushed…` + `…an untracked DIRECTORY of test files trips the dirty guard too…` | pass (all three) |
| slice-387-ac-3 | `…a drift conflict on the two locks alone completes by taking dev's copies…` | pass |
| slice-387-ac-4 | `…buildHashLines returns one acHashOf line per tagged criterion…` | pass |
| slice-387-ac-5 | `…the template tells him not to run the derivers…` | pass |
| slice-387-ac-6 | `…the landed report carries the newest DONE event's metrics…` | pass |
| slice-387-ac-7 | `…the landing message carries the three test-move trailers once each…` | pass |

ac-1 is still checked with the integrity gate's own instrument: `build-coverage-map.js
--check` and `build-ac-manifest.js --check` run against the landed tree and must exit 0.

**Nog's two required outcomes, checked directly.**

1. *No `slice-999-ac-9` in either lock.* `grep -c slice-999-ac-9 regression/COVERAGE.lock
   regression/AC-MANIFEST.lock` → 1 and 1 before, 0 and 0 after regeneration.
2. *The suite is no longer red on this file.* My role file forbids me the full suite, so I
   did the two things that are in bounds and that between them cover the claim. First I ran
   the scanner from `j-gate-fail-retry.test.js:271` verbatim — its own `nameRe` and `tagged`
   — over all 74 files of the regression tree: **607 names, `violations` empty**. That is
   the exact array the failing assertion compares against. Then I ran the guard itself,
   `node --test regression/gate-merge/j-gate-fail-retry.test.js` → **9/9 pass**,
   file unmodified. The red Nog reported was that assertion and nothing else, and it is
   green.

I also re-ran the four files that bracket this change — `j-coverage-map-integrity`,
`j-ac-manifest-integrity`, `j-s-numbering-squash-subject` and `j-ac-amend-order` — against
the regenerated locks: **17/17 pass**, none of them modified. (Nog's round-1 figure of 26
covers the same four plus `j-report-metrics-filled`, which I did not re-run this round:
nothing in this round touches the metric re-fill.)

## Safety-net tests

15 tests in one file: 7 criteria and 6 traps, with ac-2 carrying three. Nog accepted the
first extra last round on the grounds that the criterion genuinely has a success half and a
failure half. The third is the same argument one level down: the criterion says "when
regeneration fails nothing is pushed", and the untracked-directory case is a distinct way
for the guard to *not* fail when it must — Nog verified the hole against git by hand, and a
hole verified by hand and then left unguarded is how it comes back. It carries the ac-2 tag
and hash, so it does not obscure which test covers which criterion. If the count is the
objection rather than the coverage, it is the one to cut.

**Break-it-on-purpose, this round.** The new test is the only new one, so it is the only one
needing a fresh break. I removed `-uall` from the dirty check (file copy and restore, never
`git stash` — the stack is shared with the other worktrees) and re-ran it with
`--test-name-pattern 'untracked DIRECTORY'`: **red**, and red in the honest place. It failed
on `assert.equal(result.success, false)` — that is, with plain porcelain the landing
*succeeded*, which is exactly Nog's finding: the phantom gets baked in and the slice lands.
Restored, green again.

Round 1's break-it result is unchanged and still stands: 13 of 14 red with
`bridge/orchestrator.js` set aside, and trap 5 red only when broken the other way (removing
the `fs.existsSync` skip so regeneration runs unconditionally), because it is a preservation
guard whose subject is pre-slice behaviour.

I did not look in a browser: this slice has no screen.

## Screen hooks

None. Nothing in this slice reaches the dashboard.

## Tests moved or weakened

None. No existing test was moved, renamed, weakened or removed in either round. The three
edited lines inside my own new file are call-site changes within a file added by this slice,
not moves of an existing test. `regression/COVERAGE.lock` and `regression/AC-MANIFEST.lock`
are regenerated output, not edits.

## Conflicts with the brief

Two items, both flagged rather than hidden.

**1. The `<id>` interpolation.** Task 3 quotes the third sentence as ``Stage your report with
`git add -f bridge/queue/<id>-DONE.md`.`` I interpolate the real slice id, so a brief for
412 reads `git add -f bridge/queue/412-DONE.md`. `buildDoneTemplate` already interpolates
`id` everywhere else, and handing a reader a placeholder to substitute is the friction this
slice exists to remove. ac-5 holds either way. Nog would keep it; the call is O'Brien's, and
it is one word to revert.

**2. Where the manifest sources my criteria — folded in from last round's heading.** Nog
flagged that `## One thing Nog should look at` is not in the closed heading set at
`docs/contracts/done-report-format.md:111`. He is right, and rather than ask O'Brien to widen
the contract for me, the content moves here.

My seven criteria land in `regression/AC-MANIFEST.lock` as `source: legacy-backfill`, not
`commit-trailer` — as did all five of 386's. The cause is not this slice:
`build-ac-manifest.js:220` only lets a trailer *replace* the text of a tag some **tracked**
file already declares, and the file declaring it is the brief under gitignored
`bridge/queue/`. So the tag enters through `tagUniverse` (it is guarded in COVERAGE.lock) as
a legacy backfill and the trailer is skipped. The mechanism itself works — trap 1 proves it
end to end on a fixture whose report *does* carry an `## Acceptance criteria` block, which is
the shape a live report would need. I did not add that heading to this report on my own
authority; it is a one-line change to the DONE template, and it is the "static-manifest
rebuild on land" half already known to be pending. O'Brien's call.

## Commit

Branch `slice/387`, four commits, the last two from this round, in the order "How to finish"
prescribes:

1. `1f222bc` — `S387: The pipeline owns the lock files and hands Sam his hashes` (round 1).
2. `843cab2` — `S387: DONE report and regenerated AC manifest` (round 1).
3. `e98bf61` — `S387: Keep the fixture's test lines out of the derivers' sight`
   (`bridge/orchestrator.js`, the test file, `regression/COVERAGE.lock`), carrying the seven
   `AC:` trailers and `Lane: core`.
4. the commit below this report — `bridge/queue/387-DONE.md` (force-added, the queue
   directory is gitignored) and `regression/AC-MANIFEST.lock`, regenerated after the
   trailers were on HEAD.

No `Test-Loosen-OK:`, `Tests-Not-Needed:` or `Coverage-Removed:` trailer is owed: nothing was
moved, weakened, skipped or removed.
