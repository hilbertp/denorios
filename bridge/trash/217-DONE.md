---
id: "217"
title: "F-WB — Branching: --no-ff merge commits + post-archive branch deletion + branch backfill"
from: rom
to: nog
status: DONE
slice_id: "217"
branch: "slice/217"
completed: "2026-04-25T16:10:00.000Z"
tokens_in: 38000
tokens_out: 8500
elapsed_ms: 480000
estimated_human_hours: 1.5
compaction_occurred: false
---

## Summary

All three scope items delivered:

1. **`--no-ff` added to mergeBranch** (orchestrator.js:2706) — `git merge --no-ff main -m "..."` ensures every merge produces a proper two-parent merge commit on main, restoring the per-slice audit trail in `git log main --merges`.

2. **Branch deletion in archiveAcceptedSlice** — already present (lines 2900-2905), added by prior slice. `git branch -D` wrapped in try/catch, idempotent. No change needed.

3. **`backfillBranches()` added** (orchestrator.js, ~line 4728) — marker-guarded by `bridge/.backfill-branches-done`. Walks `git branch --list "slice/*"`, deletes branches whose slice ID has an `-ARCHIVED.md` in queue. Emits `BACKFILL_BRANCHES_COMPLETE { processed, skipped }`. Called at startup after `backfillArchive()`.

**Branch count at time of slice:** 75 local slice branches. Actual backfill removal count depends on how many have corresponding `-ARCHIVED.md` files at runtime.

## Acceptance criteria

| AC | Status | Notes |
|----|--------|-------|
| AC0 | PASS | Skeleton DONE is first commit |
| AC1 | PASS | `git merge --no-ff main -m "..."` at orchestrator.js:2706 |
| AC2 | PASS | Every future merge produces a merge commit (verified by --no-ff semantics) |
| AC3 | PASS | `archiveAcceptedSlice` already has `git branch -D` (lines 2900-2905) |
| AC4 | PASS | Branch deletion wrapped in try/catch — idempotent |
| AC5 | PASS | `backfillBranches()` exists, marker-guarded by `.backfill-branches-done` |
| AC6 | PASS | `BACKFILL_BRANCHES_COMPLETE { processed, skipped }` emitted |
| AC7 | PASS | Backfill will sweep archived branches on next restart |
| AC8 | PASS | Tests A-E pass (5/5) |
| AC9 | PASS | Full suite passes (112 tests across 9 files) |
| AC10 | PASS | Diff is 57 LOC in orchestrator.js (excluding tests) |
| AC11 | PASS | Only bridge/orchestrator.js and test/orchestrator-merge-no-ff.test.js changed |
| AC12 | PASS | 75 local branches present; backfill count depends on ARCHIVED files at runtime |

## Files changed

- `bridge/orchestrator.js` — `--no-ff` flag on merge; `backfillBranches` function + startup call + export
- `test/orchestrator-merge-no-ff.test.js` — new file, 5 regression tests

## Commits

1. `de360be` — skeleton DONE report
2. `6895b13` — add --no-ff to mergeBranch merge command
3. `fc0c55d` — add backfillBranches startup function
4. `1bd6206` — regression tests A-E
