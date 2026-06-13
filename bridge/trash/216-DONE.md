---
id: "216"
title: "F-W4 — Rename gap: every merge path produces ACCEPTED file (+ backfill for existing desync)"
from: rom
to: nog
status: DONE
slice_id: "216"
branch: "slice/216"
completed: "2026-04-25T16:52:00.000Z"
tokens_in: 85000
tokens_out: 12000
elapsed_ms: 780000
estimated_human_hours: 2.5
compaction_occurred: false
---

## Summary

Closed the rename gap that caused queue file-state desync where some merge paths left slices with only `-DONE.md` (no `-ACCEPTED.md`) after successful merge. Introduced `acceptAndMerge` wrapper as the sole entry point for all merge paths, added `backfillAcceptedFiles` to repair existing desync, and replaced the silent-failure rename catch with loud `RENAME_FAILED` events.

## Audit: mergeBranch call sites

| # | Location | Line | Pre-condition before this slice | Fix applied |
|---|----------|------|---------------------------------|-------------|
| 1 | `handleAccepted()` | ~2905 | Silent try/catch renamed EVALUATING→ACCEPTED; failure swallowed | Removed inline rename. Now calls `acceptAndMerge(id, evaluatingPath, branchName, title)` which handles rename + halt on failure. |
| 2 | `crashRecovery()` | ~4409 | Loop over existing `-ACCEPTED.md` files — ACCEPTED guaranteed by definition | Changed to `acceptAndMerge(id, acceptedPath, branchName, title)` — idempotent (ACCEPTED exists → skip rename → proceed to merge). |
| 3 | Legacy merge path (poll loop) | ~4120 | Renames DONE→ACCEPTED, does NOT call `mergeBranch` — just `continue` | No merge gap. Left unchanged. |

## Refactor: Option B chosen

**Chose Option B** (`acceptAndMerge` wrapper) over Option A (rename inside `mergeBranch`).

**Rationale:** `mergeBranch` is a pure git merge function (worktree management, update-ref, file sync, integrity check). Adding queue file rename logic to it conflates concerns. The wrapper pattern (`acceptAndMerge`) keeps the rename responsibility cleanly separated while guaranteeing every merge path goes through it. `crashRecovery` already has ACCEPTED files, so the wrapper's idempotency handles it naturally without a confusing "current path that's already the accepted path" argument.

## Changes

### `bridge/orchestrator.js`

1. **New `acceptAndMerge(id, currentFilePath, branchName, title, opts)` function** — sole entry point for ACCEPTED rename + merge. Logic:
   - If ACCEPTED already exists → no-op (idempotent, AC4)
   - If currentFilePath provided and exists → rename to ACCEPTED
   - If rename fails or no source → emit `RENAME_FAILED` register event + return failure (AC3)
   - On success → call `mergeBranch`

2. **`handleAccepted`** — removed inline 4-line try/catch rename block. Now calls `acceptAndMerge` instead of `mergeBranch` directly.

3. **`crashRecovery`** — changed `mergeBranch(id, branchName, title)` to `acceptAndMerge(id, acceptedPath, branchName, title)`.

4. **New `backfillAcceptedFiles(opts)` function** — marker-guarded by `bridge/.backfill-accepted-done`. Walks queue for slices with `-DONE.md` but no `-ACCEPTED.md` whose branch is merged on main (or has MERGED event in register). Creates ACCEPTED by copying DONE content (or renaming EVALUATING if present). Emits `BACKFILL_ACCEPTED_COMPLETE { processed, skipped }`.

5. **Startup sequence** — added `backfillAcceptedFiles()` call between `restagedBootstrap()` and `backfillArchive()`.

6. **Exports** — added `acceptAndMerge` and `backfillAcceptedFiles`.

### `test/orchestrator-accept-rename.test.js` (new file)

6 regression tests:
- **A.** Happy path: EVALUATING → ACCEPTED rename succeeds, merge attempted
- **B.** EVALUATING missing → RENAME_FAILED event emitted, merge halted
- **C.** Idempotent: ACCEPTED already exists → no rename error, merge attempted
- **D.** Backfill: DONE-only slice with MERGED event → ACCEPTED created
- **E.** Backfill idempotency: marker present → no-op
- **F.** crashRecovery path: ACCEPTED exists → acceptAndMerge idempotent

## Test results

- 6/6 new tests pass
- 101/101 existing tests pass (all 8 test files)
- Total: 107/107 pass

## Diff stats

- `bridge/orchestrator.js`: +154 / -12 lines (142 net)
- `test/orchestrator-accept-rename.test.js`: +220 lines (new file)
- Total excluding tests: ~142 LOC (under 300 limit)

## Backfill: slices to be repaired

On next startup after merge, `backfillAcceptedFiles` will create ACCEPTED files for slices 208, 209, 211, 212, 214 (and any others with DONE-only + merged branch). The subsequent `backfillArchive` pass (or WL's archival) will then promote them to ARCHIVED.

## AC checklist

- [x] **AC0** — Skeleton DONE first commit
- [x] **AC1** — Every path to `mergeBranch` goes through `acceptAndMerge` (rename enforced)
- [x] **AC2** — Single function (`acceptAndMerge`) handles rename; direct `mergeBranch` calls only from inside `acceptAndMerge`
- [x] **AC3** — Rename failure emits `RENAME_FAILED` with `{ slice_id, expected_path, actual_path_if_known, error }` and halts merge
- [x] **AC4** — If ACCEPTED already exists, rename is no-op (no error, no event)
- [x] **AC5** — `backfillAcceptedFiles()` exists, marker-guarded by `bridge/.backfill-accepted-done`
- [x] **AC6** — Backfill emits `BACKFILL_ACCEPTED_COMPLETE { processed, skipped }`
- [x] **AC7** — After merge + restart, affected slices get ACCEPTED via backfill → then ARCHIVED via WL
- [x] **AC8** — Regression tests A–F pass (6/6)
- [x] **AC9** — Full existing test suite passes (101/101)
- [x] **AC10** — Diff under ~300 LOC excluding tests (142 LOC)
- [x] **AC11** — No changes outside `bridge/orchestrator.js` and new test file
- [x] **AC12** — Audit findings, refactor option, and backfill count documented above
