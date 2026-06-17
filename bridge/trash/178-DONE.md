---
id: "178"
title: "Orchestrator — preserve worktree on no_report, classify Rom self-termination"
from: rom
to: nog
status: DONE
slice_id: "178"
branch: "slice/178"
completed: "2026-04-22T07:08:00.000Z"
tokens_in: 52000
tokens_out: 12000
elapsed_ms: 540000
estimated_human_hours: 2.5
compaction_occurred: false
---

## Summary

Implemented worktree rescue for no_report exits. When Rom self-terminates without a DONE file, the orchestrator now classifies the exit by git state (empty/uncommitted/committed/mixed) and either wipes (empty) or rescues (non-empty) the worktree to `bridge/worktree-rescue/<id>/` with a forensic `RESCUE.md` summary.

## Changes

### bridge/orchestrator.js
- **`isRomSelfTerminated(reason)`** — backward-compat helper returns true for all 4 classified reasons AND legacy `no_report`. Used in `writeErrorFile` and available to any future code that switches on reason strings.
- **`classifyNoReportExit(id, worktreePath, branchName)`** — inspects git state in worktree: checks `git log main..branch` for commits, `git status --porcelain` for uncommitted changes, `git diff HEAD` for diff summary. Returns `{ reason, hasCommits, hasDiff, commits, diffSummary, porcelain }`.
- **`rescueWorktree(id, branchName, classification, stdout, stderr)`** — moves worktree to `bridge/worktree-rescue/<id>/`, prunes git registry, writes `RESCUE.md` with full forensic summary (timestamps, commits, diff, status, stdout/stderr tails). Preserves branch ref for committed/mixed cases; deletes ref for empty/uncommitted.
- **No_report emission path (line ~1824)** rewired: calls `classifyNoReportExit` before any error handling, then dispatches to `rescueWorktree` (non-empty) or `cleanupWorktree` (empty). Classified reason flows into `writeErrorFile`, register event, and Kira event.
- **`writeErrorFile`** — 3 comparisons updated from `=== 'no_report'` to `isRomSelfTerminated(reason)` for forward-compat with all classified reason strings.
- **Exports** — added `classifyNoReportExit`, `rescueWorktree`, `isRomSelfTerminated` for testability.

### dashboard/lcars-dashboard.html
- Added 4 new entries to `REASON_LABELS` for the classified reason strings. Legacy `no_report` entry preserved for historical events.

### .gitignore
- Added `bridge/worktree-rescue/` — rescue artifacts are runtime, not tracked.

### test/orchestrator-no-report-rescue.test.js (new)
- 23 tests: static analysis (function existence, call order, compat), behavioral (3 git-repo-based classification cases), isRomSelfTerminated truth table, dashboard labels, .gitignore.

## Test results

All 8 test files pass:
- apendment-id-retention: 10 passed
- event-order: 19 passed
- lifecycle-events: 24 passed
- lifecycle-translate: all passed
- nog-return-round2: 13 passed
- orchestrator-no-report-rescue: 23 passed
- pause-resume-abort: 30 passed
- verdict-parser-widening: all passed

## Acceptance criteria checklist

1. DONE skeleton written as first commit — YES
2. `classifyNoReportExit` exists with 4-variant classification — YES
3. `rescueWorktree` exists, moves worktree, writes RESCUE.md — YES
4. No_report path rewired to classify then wipe-or-rescue — YES
5. Register events use classified reasons, ERROR file includes rescue_path — YES
6. `isRomSelfTerminated` covers all 4 + legacy `no_report` — YES
7. Regression test covers empty, uncommitted, committed — YES (23 tests)
8. Full test suite passes — YES (all 8 files)
9. Append-only invariant preserved — YES (no changes to register.jsonl or trash/)
10. Diff under ~200 LOC (191 lines including comments; 144 code lines) — YES
11. `bridge/worktree-rescue/` in .gitignore — YES
12. Manual E2E: synthesize no_report with uncommitted changes → worktree rescued — READY FOR VERIFICATION

## Notes

- Scope 6 (Rom prompt hardening) dropped to stay within LOC budget as the brief allowed.
- No other `cleanupWorktree` call sites were touched (lines 2580, 2699, 2857, 3088, 3704 unchanged).
- No modifications to `bridge/register.jsonl`, `bridge/trash/`, or any `-ARCHIVED.md`/`-STUCK.md` files.
