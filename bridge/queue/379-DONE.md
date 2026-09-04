---
id: "379"
title: "Derive acceptance criteria from commit trailers, not from working files"
from: rom
to: nog
status: DONE
slice_id: "379"
branch: "slice/379"
completed: "2026-09-04T17:16:40.000Z"
tokens_in: 168000
tokens_out: 15000
elapsed_ms: 633000
estimated_human_hours: 2.5
compaction_occurred: false
---

## Summary

Round 2 closes Nog's finding. Round 1 moved criterion text to the `AC: slice-N-ac-K: <text>`
commit trailers and repaired 34 of the 40 active criteria; the six with no trailer — slice 340's —
were still sourced by reading their tracked path **off disk**, so archiving slice 340 still took
legacy **198 → 204**. Nog was right, and the round-1 report's claim that *"rename it, archive it,
delete it from the tree: the manifest does not move"* was false for those six. I reproduced his
counterexample against this repo before touching anything, and got his numbers exactly.

The repair is the one he named. `git ls-files` already enumerates the **index**, so the content now
comes from the index too — one `git cat-file --batch` over every tracked slice path. A rename, an
archive, a move into `bridge/trash/`, or an outright delete cannot touch an index blob, so the
manifest no longer has any dependency on the working tree for either half of its text.

Two things I found while fixing it that Nog should see:

1. **`archiveSiblingStateFiles` is the wider hole**, and it now has a test. It does not rename in
   place — it moves `{id}-DONE.md` clean out of `bridge/queue/` into gitignored `bridge/trash/`, on
   *every* terminal transition, not only on acceptance. I verified all three shapes (rename in
   place, move to `bridge/trash/`, delete) against the live repo with slice 340's real file, and
   all three now `deepEqual` the untouched manifest.

2. **The fallback is no longer silent.** While building this I hit a real bug — `encoding: 'buffer'`
   is a `spawnSync` spelling that `execFileSync` rejects — and my `catch (_) {}` swallowed it and
   fell back to the working tree, reproducing the exact failure I was fixing, silently. That is the
   shape of this whole slice, so the fallback now writes to stderr. A fallback nobody sees is how a
   criterion degrades unnoticed.

Manifest is byte-identical either way: **238 tags, 198 legacy**, no active tag lost, no text or hash
moved on any tag shared with the pre-slice baseline.

## What changed

- `scripts/build-ac-manifest.js` — new `indexBlobs()` reads every tracked slice path out of the git
  index in one `git cat-file --batch`, slicing each blob by the byte length in its header so
  newlines in the content cannot desync the walk. `trackedSliceFiles()` now takes content from
  there; the working tree survives only as a last resort for a wholesale batch failure, and that
  fallback announces itself on stderr. Comments updated: the header no longer claims the deriver is
  pure over disk, and the `orphanedSlices` note now says what it means (a path *git itself* could
  not produce, not merely one the tree lost).
- `regression/gate-merge/j-ac-manifest-trailer-source.test.js` — ac-2 extended and traps 1 and 3
  adjusted; see `## Tests moved or weakened`.

No lock file changed this round: `AC-MANIFEST.lock` and `COVERAGE.lock` are both already up to date
against the new deriver. No `e2e/` file touched.

## Acceptance criteria verification

Command for all of them: `node --test regression/gate-merge/j-ac-manifest-trailer-source.test.js`
→ **9 tests, 9 pass, 0 fail.** All nine live in that one file.

| Tag | Test | Result |
|---|---|---|
| slice-379-ac-1 | `slice-379-ac-1 criterion text comes from the commit trailer, not from the working file` | PASS |
| slice-379-ac-2 | `slice-379-ac-2 archiving, renaming or deleting the queue file leaves the manifest unchanged` | PASS |
| slice-379-ac-3 | `slice-379-ac-3 every criterion active today stays active, and the legacy count does not grow` | PASS |
| slice-379-ac-4 | `slice-379-ac-4 a criterion amended across commits resolves to the newest declaration` | PASS |
| slice-379-ac-5 | `slice-379-ac-5 the manifest integrity and determinism guards still pass` | PASS |

**ac-2, the rejected one, measured on the live repo** with slice 340's real file — the trailer-less
case. Before, `legacyCount 198`, `slice-340-ac-1.source = bridge/queue/340-DONE.md`. Then, in turn:
rename to `340-ARCHIVED.md`; move to `bridge/trash/340-DONE.md.cleanup-x`; delete outright. All
three `deepEqual` the before-manifest, `legacyCount` **198 at every step**. Against the round-1
deriver the same script gave **204** at the first step, which is Nog's number.

**ac-3, against `17b4dcc`** (the commit before this slice): `acCount` 233 → 238, `legacyCount`
**198 → 198**, active 35 → 40 (the +5 are this slice's own), **active tags lost: none**, and text or
hash changed on a shared active tag: **0**. `node scripts/ac-reconcile.js` →
`GREEN — covered 40, stale 0, missing 0, legacy 198`.

**ac-5:** `node scripts/build-ac-manifest.js --check` → `up to date (238 tags, 198 legacy)`;
`node scripts/build-coverage-map.js --check` → `up to date (489 guards over 46 sources)`.

**Full safety-net suite**, once, before commit: `node --test regression/**/*.test.js` →
**491 tests, 486 pass, 0 fail, 5 skipped**, exit 0. Nog's non-reproduction of my round-1 flake was
right — `j-untracked-runtime-state` passed for me this time too.

## Safety-net tests

Nine tests, five AC + four traps — unchanged in count and in which test covers which criterion. All
five `@ac-hash` lines still match the manifest (`build-coverage-map --check` confirms it).

**Break it on purpose, twice.** I kept a copy of the fix, restored the deriver from git, ran the
file, and put the fix back.

- **Against `HEAD` (round 1's deriver — trailers in place, working-tree read):** **2 red** —
  `slice-379-ac-2` and `trap 3`. Those are exactly the two guarding this round's change; the other
  seven guard round 1's, which is still in `HEAD`, so they correctly stay green. ac-2 fails on the
  archive rename with `legacyCount 0 → 1` on the trailer-less slice.
- **Against `17b4dcc` (pre-slice, file-only deriver):** **9 red, 0 pass.** The whole slice is
  load-bearing.
- Fix restored → 9/9 green.

I also ran the classifier the promote gate uses, on both ranges. Whole slice `17b4dcc..HEAD`: all
nine checks classify **`tightened`**. This round `HEAD~1..HEAD`: `slice-379-ac-2` → **`reworded`**,
nothing else classified. Nothing is `loosened`, `removed` or `skipped`, so no `Test-Loosen-OK` is
owed. `node scripts/test-drift.js` → **REVIEW**, regression bucket **0**, the single deliberate item
being round 1's `COVERAGE.lock` regeneration that Nog already reviewed.

No browser: nothing here renders.

## Screen hooks

None. This slice is a build script and its guards; no criterion touches the screen.

## Tests moved or weakened

Three changes to tests I wrote in round 1. Nothing existing was removed, skipped or renamed.

1. **`slice-379-ac-2` — extended (tightened).** It previously exercised only a criterion that *has*
   a trailer, which is why it stayed green over the hole Nog found. It now carries a second slice
   with **no** trailer — the live shape of slice 340 — and walks three states rather than two:
   archive rename, move out to `bridge/trash/`, delete. `deepEqual` **and** `legacyCount` are
   asserted at each. This is the assertion Nog asked for.
2. **`trap 3` — premise moved (tightened).** Its "genuinely lost source" case deleted the file from
   the *working tree*, which under this round's fix is no longer a loss — so the test failed, which
   is the fix working. It now drops the path from the **index** as well, which is what "no source of
   any kind is left" has to mean once the deriver reads the index. The half above it is now the
   stronger claim: file gone from the tree, *no trailer at all*, and the criterion still resolves.
3. **`trap 1` — one assertion loosened, deliberately.** Per Nog's flag I dropped the match on the
   deriver's exact argv spelling (`/'log', range, '--reverse'/`) for a plain `/--reverse/`. The
   behavioural half above it — a real two-commit repo, no injected log — is what actually guards the
   ordering, and it goes red if the flag goes. **But the `readFileSync(MANIFEST_SRC)` itself had to
   stay, and that is worth Nog's attention:** removing the line outright is what I tried first, and
   `COVERAGE.lock` immediately fell **489 → 484**, dropping all five slice-379 guards. A
   `readFileSync(<source>)` inside a regression test is precisely how `build-coverage-map` registers
   *which source a tag guards*; that line was the only thing tying this test file to
   `scripts/build-ac-manifest.js`. So the regex was earning its keep — for a different reason than
   either of us had in mind. The read stays, the brittle spelling goes.

## Conflicts with the brief

None that changes the work. Three notes:

1. **The legacy drain — unchanged from round 1, and I am glad to leave it with Philipp.** The 38
   grandfathered criteria that carry trailers stay legacy. `docs/contracts/ac-custody.md` reserves
   that backfill for a human against brief intent, and draining it flips the live reconcile verdict
   to NEEDS_RECONCILE. The brief's own constraint — the legacy count must not grow — is met with the
   count unmoved at 198.
2. **`docs/contracts/ac-custody.md` is now more stale than it was after round 1.** It describes the
   deriver as "pure over disk"; as of this slice its inputs are the git **index** and git **history**,
   and the working tree is a last resort. Not mine to edit — flagging it for O'Brien, as Nog did.
3. **Nog's second flag stands and I have not addressed it** (correctly, I think — it is not mine):
   the trailer scan spans all of `HEAD`, so any commit-message line starting `AC: slice-N-ac-K:` can
   redefine a live criterion's text and hash with no `AC-Change-OK` trailer in the way. The brief
   mandated reading from history and ac-4 mandates newest-wins, so the two cannot both hold without
   this surface existing. It is a decision for Philipp about whether the AC-MUTATED ratchet needs to
   cover commit messages.

## Commit

- `988925d` — round 1: the deriver on trailers, and the nine safety-net tests.
- `957f66c`, `bb4404a`, `3b1b1f1` — round 1's report and lock regeneration.
- `b77a8cf` — **round 2**: `S379: Read the tracked slice blob from the git index, not the working
  tree` — `indexBlobs()`, the non-silent fallback, and the three test changes above. Carries the
  five `AC:` trailers.
- This report, in its own commit. No lock regeneration is needed after it: both locks are already
  `--check` clean against the new deriver.

## Acceptance criteria

- slice-379-ac-1: criterion text is taken from immutable commit history rather than from working files that can be renamed or deleted
- slice-379-ac-2: archiving a slice, renaming its queue file, or deleting it from the working tree leaves the manifest unchanged
- slice-379-ac-3: every criterion that resolves as active today still resolves as active, and the legacy count does not grow
- slice-379-ac-4: a criterion whose text was amended across commits resolves to the newest declaration
- slice-379-ac-5: the manifest integrity and determinism guards still pass
