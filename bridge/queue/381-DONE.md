---
id: "381"
title: "Finish the debris job: the last tracked runtime file, and the archive rename"
from: rom
to: nog
status: DONE
slice_id: "381"
branch: "slice/381"
completed: "2026-09-05T14:40:10.000Z"
tokens_in: 2870000
tokens_out: 41000
elapsed_ms: 1349000
estimated_human_hours: 4.5
compaction_occurred: false
---

## Summary

Both remaining autocommit sources are closed.

**1 · `regression/AC-DECISIONS.json` is no longer tracked.** It records the CHECK overlay's
per-AC rulings and is rewritten whenever the operator presses update/keep — runtime state by
the same definition slice 372 used, and simply not on that slice's list. It joins
`RUNTIME_FILES` in `bridge/state/seed-runtime-state.js` rather than getting a rule of its own,
so the ignore file, the seeder and the autocommit filter keep reading from one list. Untracked
with `git rm --cached`: the disk is untouched, the running system reads and writes it exactly
as before, and a fresh checkout gets a well-formed empty one from the seeder. Marked
`restore: true` — a ruling is a human decision and no tick recreates it, so an absent file is
recovered from history before it is blanked.

**2 · Archiving now records its own rename.** Queue reports are permanent records by contract
and they *are* tracked, but `bridge/queue/*.md` is gitignored, so the tracking is force-added
and git cannot follow a report when the pipeline renames it forward to `{id}-ARCHIVED.md` and
sweeps the siblings to `bridge/trash/`. On disk the record is intact; to git a tracked file
vanished and no file arrived, so the next pre-checkout autocommit committed four bare
deletions at once (027f09c). `recordArchivedQueueRename()` stages the new name and every
departed one and commits them together, called at the end of `archiveAcceptedSlice()` so the
sibling sweep is inside the same commit.

I did **not** untrack the queue reports (trap 1) and I did **not** rewrite the four commits
(trap 3).

**One thing O'Brien should decide, in "Two things Nog should know" below:** the live damage
from this bug is bigger than the brief's summary implies. 17 acceptance criteria (slices 366,
375, 379) have already degraded from hashed to unhashed-legacy in the static AC manifest,
because their `-DONE.md` blobs left the index in 027f09c. That is a pre-existing red on the
branch tip, not something this slice caused, and repairing it is a human call.

## What changed

- `bridge/state/seed-runtime-state.js` — `regression/AC-DECISIONS.json` added to
  `RUNTIME_FILES` (`restore: true`, seed `{}`). This one line makes it ignored-by-policy,
  seeded on a fresh clone, restored from history if a merge takes it, and invisible to the
  autocommit filter, because all four read `RUNTIME_FILES`.
- `.gitignore` — the ledger named, next to the other AC-reconcile generated outputs.
- `regression/AC-DECISIONS.json` — untracked (`git rm --cached`). Still on disk, unchanged.
- `bridge/orchestrator.js` — new `recordArchivedQueueRename(id, opts)`; called at the end of
  `archiveAcceptedSlice()` after the sibling sweep; exported. `archiveAcceptedSlice` returns
  two extra fields (`renameRecorded`, `renameReason`) and passes `repoRoot` / `runGit` through.
- `dashboard/server.js` — `recordAcDecision()` mkdirs its parent before writing, so the first
  ruling can still land on a checkout that has no ledger (trap 2). No screen change.
- `scripts/land-untracked-runtime-state.sh` — the ledger added to `RUNTIME_PATHS`. See
  "What O'Brien must do".
- `regression/dispatch-execution/j-archive-rename-recorded.test.js` — new (10 tests).
- `regression/COVERAGE.lock` — regenerated (`node scripts/build-coverage-map.js`), 517 → 522
  guards. Required by the integrity meta-test.

No `e2e/` file was created, edited or deleted.

### How the recorder behaves, and why

```
recordArchivedQueueRename(id, opts)
  → git ls-files -- bridge/queue        (what git still believes about this slice)
  → the ARCHIVED name if it is on disk and untracked
  + every tracked name for this slice that is no longer on disk
  → git add -f -A -- <exactly those paths>
  → git commit --only -m "chore(queue): record slice N archive rename (…)" -- <same paths>
```

Four deliberate constraints, all from trap 4 and the merge path it runs in:

- **No lock of its own.** git's `index.lock` is the only lock here and a git command fails on
  it rather than waiting, so there is nothing to deadlock against.
- **No half-staged index.** If the commit fails, the paths it staged are reset. A leftover
  staged path is exactly what the next autocommit sweeps — the failure this exists to stop.
- **Never throws.** The archival has already happened; a git failure is logged and returned,
  never allowed to unwind it.
- **Integration branch only.** `backfillArchive()` calls `archiveAcceptedSlice()` at startup
  wherever HEAD happens to be. A commit on the trunk would be a local-only change on the
  branch the promote gate fast-forwards, so the recorder declines with
  `not_on_integration_branch` and leaves it to the operator.

`DS9_WATCHER_MERGE=1` is set **per command**, on the commit's env only — never
process-wide — because this commits in the main working tree where the Layer-1 hook lets only
the watcher merge path through. The commit stays local; `ensureIntegrationIsFresh()` already
pushes a local-ahead integration branch on the next cycle, so archival gains no network call.

## Acceptance criteria verification

All in `regression/dispatch-execution/j-archive-rename-recorded.test.js`.
Command: `node --test regression/dispatch-execution/j-archive-rename-recorded.test.js` → **10/10 pass**.

| Tag | Test | Result |
|---|---|---|
| slice-381-ac-1 | `the acceptance-decision ledger is untracked, ignored, still on disk and writable` | pass |
| slice-381-ac-2 | `archiving commits the rename, leaving no deletion for a later sweep` + `the rename is recorded on the integration branch and nowhere else` | pass |
| slice-381-ac-3 | `an ordinary slice run leaves the autocommit nothing to sweep` | pass |
| slice-381-ac-4 | `the queue report stays tracked and retrievable under its new name` | pass |
| slice-381-ac-5 | `the existing history is not rewritten` | pass |
| trap 1 (tagged ac-4) | `nothing in this slice untracks a queue report` | pass |
| trap 2 (tagged ac-1) | `a fresh checkout without the ledger seeds it and reads it as "nothing ruled"` | pass |
| trap 3 (tagged ac-5) | `the ledger was untracked index-only, so its history survives` | pass |
| trap 4 (tagged ac-2) | `a failed rename commit leaves nothing staged and does not throw` | pass |

The ac-2 and ac-3 tests are not source-reads: each builds a real git repository carrying this
repo's actual `.gitignore`, force-adds a queue report the way the contract requires, drives
the real `archiveAcceptedSlice()` against it, and then asserts that
`stageablePathsFrom(git status --porcelain)` — the autocommit's own selection rule — comes
back empty. That is task 3 measured end to end rather than asserted.

Full safety-net suite, once, before commit:
`node --test 'regression/**/*.test.js'` → **518 tests, 511 pass, 2 fail, 5 skipped.**
Both failures are pre-existing at HEAD — see below.

## Safety-net tests

Ten tests, one per acceptance criterion plus one per trap, plus one extra on ac-2 for the
branch guard (which is the same criterion, not a new one).

**Break-it-on-purpose (`git checkout HEAD -- <the five source files>`, ledger re-tracked,
test file kept):**

Went red — 8 of 10:

- `slice-381-ac-1 the acceptance-decision ledger is untracked, ignored, still on disk and writable`
- `slice-381-ac-2 archiving commits the rename, leaving no deletion for a later sweep`
- `slice-381-ac-2 the rename is recorded on the integration branch and nowhere else`
- `slice-381-ac-3 an ordinary slice run leaves the autocommit nothing to sweep`
- `slice-381-ac-4 the queue report stays tracked and retrievable under its new name`
- `slice-381-ac-1 trap 2 a fresh checkout without the ledger seeds it and reads it as "nothing ruled"`
- `slice-381-ac-5 trap 3 the ledger was untracked index-only, so its history survives`
- `slice-381-ac-2 trap 4 a failed rename commit leaves nothing staged and does not throw`

Stayed green — 2 of 10, and they cannot do otherwise:

- `slice-381-ac-5 the existing history is not rewritten`
- `slice-381-ac-4 trap 1 nothing in this slice untracks a queue report`

Both guard a *negative* — "we did not do the destructive thing" — so removing a fix cannot
turn them red. Rather than report them as proven when they are not, I proved their sensitivity
by committing the violation in a throwaway clone (`git clone --no-hardlinks .`, never this
repo):

- trap 1: `git rm --cached bridge/queue/370-DONE.md bridge/queue/371-ARCHIVED.md` + commit →
  **red**: `this slice must delete no queue report: bridge/queue/370-DONE.md, bridge/queue/371-ARCHIVED.md`
- ac-5: `git checkout --orphan` + one commit, i.e. the history rebased flat, tree intact →
  **red**: `the pre-existing autocommits must remain in the log (found 0)`

Both guards are live. The clone was deleted afterwards.

**Browser:** I did not open one. Nothing in this slice is visible on screen — the only
dashboard edit is a `mkdirSync` inside `recordAcDecision`, which changes no markup, no route
and no response body.

## Screen hooks

None. No acceptance criterion touches the screen; there is nothing for Julian to select.

## Tests moved or weakened

None. No existing test was moved, renamed, changed, skipped or removed.

`regression/COVERAGE.lock` was regenerated, which is a required derived artifact, not a test
change: guard count moved 517 → 522 (up by exactly this slice's five tags) and no existing
entry changed.

## Two things Nog should know

### 1 · The suite has two reds. Both pre-date this slice. Here is the proof.

- `J-ac-manifest slice-99826-ac-1 — committed AC-MANIFEST.lock equals a fresh regeneration`
- `slice-379-ac-5 the manifest integrity and determinism guards still pass`

Verified at HEAD (`212e835`) with **every** one of my changes removed — the five source files
reverted, the ledger re-tracked, and the new test file moved out of the tree entirely: both
still fail. `node scripts/build-ac-manifest.js --check` reports `STALE` against HEAD's own
`COVERAGE.lock`, before this slice touches anything.

**I deliberately did not regenerate `regression/AC-MANIFEST.lock`,** and this is the part
worth reading. The fresh regeneration is not a harmless rebuild — it would *bake in* damage:

| | committed | fresh regeneration |
|---|---|---|
| acCount | 242 | 252 |
| legacyCount (unhashed) | 202 | 229 |

Ten of the eleven new tags are legitimate (slice 370's five, which nobody rebuilt after
`212e835`, and this slice's five). But **17 criteria flip from hashed to unhashed-legacy**:

```
slice-366-ac-1..5   slice-375-ac-1..7   slice-379-ac-1..5
```

Those are precisely the slices whose `-DONE.md` reports were deleted in `027f09c` — the
autocommit this brief is about. `scripts/build-ac-manifest.js` sources an AC's text from the
tracked queue file *via the index*; the deletion took the blob out of the index, so the text
is gone and the criterion degrades to unhashed. Regenerating the lock would silently relax
custody for 17 criteria to make a red go green, which is the one thing the AC-custody rule
forbids. Committing 370's five tags requires the same regeneration, so it cannot be done by
halves either.

The reports are not recoverable from disk — `366`, `375` and `379` are gone from
`bridge/queue/` and from `bridge/trash/` alike; only `371-ARCHIVED.md` survives, because
Philipp repaired that one by hand. They are still in history:

```
git show 027f09c^:bridge/queue/366-DONE.md   # and 375, 379
```

The repair is a human call: restore those blobs to the index under the names the pipeline
would have given them (`{id}-ARCHIVED.md`), then rebuild the manifest — at which point the 17
criteria come back hashed and the regeneration is safe. I did not do it because writing files
back into the live queue directory changes what the state machine reads, and that is scope
this brief does not give me.

### 2 · This slice needs the same landing step slice 372 needed

Untracking with `--cached` spares this worktree, but the deletion is real in the commit — so
whoever merges `slice/381` has `regression/AC-DECISIONS.json` removed from *their* working
tree, and that tree is the live pipeline. Slice 372 hit both branches of this and built
`scripts/land-untracked-runtime-state.sh` for it. I added the ledger to that script's
`RUNTIME_PATHS` rather than writing a second one, so the existing procedure covers it and the
existing landing tests still pass.

The recorder's own defences are already on this branch, but they cannot defend the run that
lands them: the orchestrator performing that merge is still executing dev's code, where the
ledger is tracked and ticking. Hence the landing step below.

## What O'Brien must do

Before merging `slice/381`, from the **main** checkout on `dev`:

```
bash scripts/land-untracked-runtime-state.sh --dry-run   # shows regression/AC-DECISIONS.json
bash scripts/land-untracked-runtime-state.sh
```

It backs the file up, untracks it index-only, commits with `DS9_WATCHER_MERGE=1`, and verifies
nothing left the disk. Idempotent — a second run says "nothing to do". After that, `slice/381`
merges normally: there is no delete-vs-modify left to resolve.

## Commit

- `50a2e89` — `S381: Finish the debris job — the last tracked runtime file, and the archive rename`
  (8 files; all five ACs declared as `AC:` trailers, verified scannable by
  `lib/ac-range-scan` over `origin/dev..HEAD`)
- this DONE report, in its own commit

Branch: `slice/381`, cut from the branch tip. No history was rewritten.
