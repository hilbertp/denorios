---
id: "370"
title: "Return to stage must actually return the slice — or say why it cannot"
from: rom
to: nog
status: DONE
slice_id: "370"
branch: "slice/370"
completed: "2026-09-05T00:41:12.000Z"
tokens_in: 141000
tokens_out: 19000
elapsed_ms: 1985000
estimated_human_hours: 2.5
compaction_occurred: false
---

## Summary

Round 2. Nog's rejection was correct and the diagnosis was exact: one ordering
decision inside `STATE_PRECEDENCE` put a live `↩ Return to stage` button on 76
merged slices, and pressing it really did restage merged work. I reproduced his
numbers against the live queue before changing anything, and the count now reads
**0**.

The cause is that a merged slice does not keep one file. **114 of the queue's 259
ids hold two to five**, and `{id}-ACCEPTED.md` beside `{id}-ARCHIVED.md` is the
single commonest shape (65 ids) — archiving writes the terminal file without
deleting the round-level one that produced it. My precedence list ranked
`ACCEPTED`/`STUCK`/`ERROR`/`REVIEWED` above `ARCHIVED`, so a merged slice resolved
to its own superseded sibling and the module answered "returnable" for it. That
failed AC-1 on the exact population the slice was written about, and — as Nog
put it — implemented trap 1's semantics by accident, on rows where dev shows no
button at all.

The fix is the one Nog pointed at: **the archive is the newest fact about a
slice**. `ARCHIVED` now outranks every state except the three canonical in-flight
suffixes, which still win, so trap 2 is untouched. Two neighbouring inversions
went with it — the retired `REVIEWED` spelling (nothing has written that file
since slice 147, so it cannot be newer than an archive beside it) and `PARKED`,
which holds the parked *brief* written early in a round and was outranking the
archive on 3 live ids. I checked the whole table rather than the one line:
`DONE`, `STAGED` and the staged-only names were already in the right place.

Findings 2 and 3 rode along. Neither the module, the 202/status design nor the
page wiring moved — Nog was right that they should survive the fix unchanged.

**The open question for Philipp is still open, and it is now genuinely open.**
Round 1's report said the archived case was left for him to rule on; in fact the
"yes" answer was shipping by accident on 76 rows. It is not any more. See
**Trap 1** below.

## What changed

| File | Why |
|---|---|
| `bridge/return-to-stage-eligibility.js` | The fix. `STATE_PRECEDENCE` reordered so `ARCHIVED` outranks every non-in-flight state; `REVIEWED` and `PARKED` demoted below it; `IN_FLIGHT_STATES` split out of `ACTIVE_STATES` so the two roles are separable and named. Verdicts now carry `path` (finding 3). |
| `bridge/orchestrator.js` | Finding 3: `handleReturnToStage` moves the file the verdict was read from (`verdict.path`) instead of rebuilding the name against `QUEUE_DIR`, which was wrong for any returnable state appearing in `bridge/staged/`. One line, plus the `QUEUE_DIR` fallback kept. |
| `dashboard/server.js` | Finding 2: `returnToStageOutcome()`'s staged-directory fallback now requires the staged file to be *newer than the request*. A stale staged copy beside a live queue file used to answer `returned` on the very first poll. With no `since` to measure against there is no basis for the claim, so it stays `pending`. |
| `dashboard/lcars-dashboard.html` | Comment only, no behaviour: the block comment above `returnBtn` claimed one thing and the code did three. It now states all three branches and why merged rows get nothing. Round 1's report described this inaccurately and Nog caught it. |
| `regression/direct-controls/j-return-to-stage-truthful.test.js` | The coverage gap that let the bug ship green — every fixture wrote one file per slice. AC-1, AC-3 and trap-1 now seed the real multi-file shapes. Still 9 tests: 5 ACs + 4 traps, no additions. |

Nothing under `e2e/` was touched. `regression/COVERAGE.lock` needed no
regeneration — no test names changed, and the coverage-map guards pass 9/9.

## Acceptance criteria verification

Command for all five, run from the worktree:
`node --test regression/direct-controls/j-return-to-stage-truthful.test.js` → **9 tests, 9 pass, 0 fail**.

| Tag | Test file | Result |
|---|---|---|
| slice-370-ac-1 | `regression/direct-controls/j-return-to-stage-truthful.test.js` | **PASS** — and re-verified against the live queue, not just the fixture. See below. |
| slice-370-ac-2 | same file | PASS — unchanged from round 1, which Nog accepted. |
| slice-370-ac-3 | same file | PASS — extended with the stale-staged case from finding 2. |
| slice-370-ac-4 | same file | PASS — unchanged from round 1. |
| slice-370-ac-5 | same file | PASS — unchanged from round 1. Trap 2 intact; the three in-flight suffixes still outrank everything. |

**AC-1 against the real population.** I ran the shipped module over the live
`bridge/queue/` (the same check Nog ran), then served the real queue through a
dashboard built from this branch:

```
total ids: 259
ARCHIVED-on-disk slices: 200
ARCHIVED slices reported RETURNABLE (live button): 0        ← was 76
ARCHIVED slices resolving to some OTHER state: 0            ← was 85
```

Nog's named ids all refuse now:

```
190 → {eligible:false, state:"ARCHIVED",
       reason:"Slice 190 is ARCHIVED — its work is already merged, so returning it would not undo anything."}
   … identical for 151, 166, 184, 191, 215, 231, 239.
```

And it is a precedence fix, not a blanket refusal — the slices that genuinely can
be returned kept their control: **27 ERROR + 20 ACCEPTED + 2 STUCK** still
resolve returnable, none of which has an archive on disk.

## Safety-net tests

Nine tests, unchanged in count: one per acceptance criterion plus one per trap.
Three of them were strengthened this round to seed the shape the live queue
actually has.

**Break-it check.** I copied the three product files aside, `git checkout HEAD --`
on them to restore round 1's code, kept the new tests, ran the file, then put the
fix back and re-ran (9/9 green). Red with the fix removed:

| Test | Red? | Failure |
|---|---|---|
| `slice-370-ac-1` | ✅ RED | `a merged slice with a stale ACCEPTED file beside its archive must not be offered the control` — actual `true`, expected `false` |
| `slice-370-ac-3` | ✅ RED | `a staged file older than the request must not be reported as a return that just happened` — actual `'returned'`, expected `'pending'` |
| `trap-1-archived-is-decided-not-guessed` | ✅ RED | eligibility `true`, expected `false` |
| the other 6 | green, as they must be | They pin behaviour that was already correct in round 1 and that this round must *not* change — AC-2, AC-4, AC-5, traps 2, 3, 4. Reverting a fix they do not test cannot turn them red. Every test I touched this round went red. |

**What I changed in the fixtures, and why it matters.** Nog's diagnosis of why the
bug shipped green was right: `writeQueue('37102', 'ARCHIVED')` writes one file,
and the live queue routinely holds several. The fixtures now write the real
shapes — `ACCEPTED+ARCHIVED` (65 live ids), `ERROR+ARCHIVED` (8), `REVIEWED+ARCHIVED`
(5), and `ACCEPTED+DONE+PARKED` as the control case that must *keep* its button
because it has not been merged. Trap 1 seeds exactly Nog's reproduction — the two
files slice 190 holds — and asserts the `ACCEPTED` file is still there afterwards,
because a refusal that consumed it would be the archived-return semantics
implemented by accident all over again.

**What I saw in the browser.** I served the *real* live queue through a dashboard
built from this branch, on a scratch root at port 8099 so nothing live was
touched (the running dashboard on :4747 was left alone, and the scratch root is
deleted). I walked **all 40 pages / 200 History rows** in Chromium and read every
row's control:

```
ABSENT: 152    DISABLED: 9    LIVE: 39
archived rows offering a live button: 0
```

- **S341** (`error`, slice is `ERROR` today) — solid amber `↩ Return to stage`,
  enabled, tooltip *"Return S341 to the staged list for another round"*.
- **S366** (`error`, slice is `ARCHIVED` today) — dashed grey button, disabled,
  tooltip *"Slice 366 is ARCHIVED — its work is already merged, so returning it
  would not undo anything."* The two states are obviously different at a glance.
- **S370** (this slice, `IN_PROGRESS`) — disabled, *"a slice that is being worked
  on cannot be returned. Stop the build first."* Trap 2, on screen.
- **S379 / S376 / S375 / S373 / S372** (merged, `success`) — no control at all.
- Several old rows (196, 195, 193, 297) read *"is not in the queue or the staged
  list — there is nothing to return"*, which is true: their files are gone.
- No page errors in the console.

The button lives inside the expanded row (`.history-expand`), so it is reached by
the chevron, not visible on the collapsed row — worth knowing for Julian.

**Full suite:** `npm test` → **508 tests, 501 pass, 2 fail, 5 skipped**. Identical
to round 1. The 2 failures are the `AC-MANIFEST.lock` staleness
(`j-ac-manifest slice-99826-ac-1` and `slice-379-ac-5`). I re-confirmed they are
not mine by running `regression/gate-merge/j-ac-manifest-trailer-source.test.js`
in the main checkout on `dev` with none of my changes present: **8 pass, 1 fail**.
Still declining to regenerate — it would convert 23 hashed `commit-trailer`
entries to unhashed `legacy-backfill`, which `docs/contracts/ac-custody.md`
forbids. It needs O'Brien/Philipp, as Nog flagged.

`node scripts/tests-needed.js` → **NEEDS REVIEW**, no RED FLAG, no weakened
check. The two uncorroborated files are the same two as round 1:
`lib/tests-needed.js` (S367's, not in my diff) and `regression/COVERAGE.lock`.

## Screen hooks

Unchanged from round 1 — same names, same elements, all present in the shipped
page. Two starting states are corrected, because round 1 described them wrongly
and Nog was right to say so.

| Hook | Where | Starting state |
|---|---|---|
| `.return-to-stage-btn` | History row, inside the expanded detail | **Three renderings, one per row.** Enabled with `data-return-id` and a "Return S… to the staged list" tooltip when the slice's state is returnable today (39 of 200 live rows). Present but `disabled`, dashed, carrying the refusal sentence in `title`, when the row's outcome was a failure but the slice cannot be returned now (9 rows). **Absent entirely** on a row whose outcome was a success — a merged slice was never a candidate, and 152 disabled buttons down the page would be noise, not an explanation. Reached via the row chevron; not on the collapsed row. |
| `data-return-id` | on every rendered `.return-to-stage-btn` | Carries the slice id, so a row can be selected without depending on row order. Present in both the enabled and disabled renderings. |
| `.rts-waiting` | the button, after a click | Applied while the poll is in flight — the button reads "Returning…" and is disabled. Cleared on outcome. |
| `.rts-refused` | the button, after a refusal | Applied when the outcome is `refused`; the button turns `--err` and runs the `blocked-pulse` keyframe. Not present before a click. |
| `.return-toast` | body-level, transient | Absent until an outcome arrives. Appears only from `succeed()`, which is reachable only from `outcome === 'returned'` — never from a refusal. |
| `.slice-action-return-stage` | slice-detail modal | Present whenever the modal is open on a slice; posts to `/api/queue/${id}/return-to-stage` and runs the same `returnToStage()` the History row runs. |

For Julian: the pair worth pinning is **S341-style (enabled) against S366-style
(disabled + reason)** on the same screen, and the `.rts-waiting` → poll →
`.return-toast` sequence. The disabled tooltip text comes from the server
(`returnReason`), not the page.

## Tests moved or weakened

**None this round.** No test was moved, renamed, removed, or loosened.

Three existing tests in `regression/direct-controls/j-return-to-stage-truthful.test.js`
gained assertions and fixture files. Every one is strictly *stronger* — a case
added, never a check relaxed:

| Test | Change |
|---|---|
| `slice-370-ac-1` | +4 fixture slices holding real multi-file shapes; +8 assertions. No existing assertion altered. |
| `slice-370-ac-3` | +1 fixture slice with a backdated staged file; +1 assertion. No existing assertion altered. |
| `trap-1-archived-is-decided-not-guessed` | fixture goes from one file to the two the live queue holds; +2 assertions. The original assertions all remain, at the same strictness. |

The four assertions listed under this heading in round 1 were signed by Nog and
are not touched again.

## Conflicts with the brief

None.

**Trap 1 — still Philipp's call, and now actually undecided.** Should
`Return to stage` be offered on an archived slice at all?

An archived slice's work is on `main`. Returning it un-merges nothing, so
"return" could only mean *open a fresh round of work from this brief* — nearer to
restaging than to returning, and a different action with different consequences.
I have not implemented that, and this round removed the version of it that was
running by accident. Today all 200 archived slices are refused with *"its work is
already merged, so returning it would not undo anything."*

If the answer is **yes**, it wants its own affordance and its own words — "Restage
from this brief", not "Return to stage" — because the operator's mental model of
the two is different, and it needs a decision about what happens to the merged
commit. That is a slice, not a flag. If the answer is **no**, nothing further is
needed; the refusal sentence already says why.

**Two things for O'Brien**, both carried forward from Nog's flags and both still
live:

1. The `AC-MANIFEST.lock` staleness fails two tests for every slice on dev and
   cannot be cleared without degrading 23 ACs from hashed `commit-trailer` to
   unhashed `legacy-backfill`. It needs a ruling, not a regeneration.
2. `cleanupWorktree` is silently defeated by a read-only `dashboard/` (Layer 2
   lock), and the next `createWorktree` then "reuses" a directory that is not a
   worktree. That is how attempt 1's tree was lost.

## Commit

`f9c7126` — *S370 r2: the archive is the newest fact about a slice*

All five AC trailers declared on it. Five files: the three product files Nog's
findings named, the dashboard comment correction, and the test file. The DONE
report follows in its own commit, per the role file.
