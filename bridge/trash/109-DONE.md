---
id: "109"
title: "Watcher fix — evaluate-before-commission + checkout main before O'Brien"
from: obrien
to: kira
status: DONE
brief_id: "109"
branch: "slice/109-watcher-fix"
completed: "2026-04-15T00:12:00.000Z"
tokens_in: 42000
tokens_out: 4200
elapsed_ms: 300000
estimated_human_hours: 1.0
compaction_occurred: false
---

## Summary

Fixed both root causes of branch divergence in `bridge/watcher.js` and added a regression guard.

## Tasks completed

### Task 1 — Rewrite `poll()` priority order
- Moved DONE file evaluation **above** the PENDING check in `poll()`.
- Removed the `if (pendingFiles.length === 0)` guard from the DONE evaluation block.
- Both `doneFiles` and `pendingFiles` are now scanned at the top of `poll()` so counts are available throughout.
- DONE evaluation now runs regardless of whether PENDING files exist, ensuring merges complete before new builds start.
- Idle heartbeat print preserved, now fires when both DONE and PENDING arrays are empty.

### Task 2 — `git checkout main` before O'Brien invocation
- Added `git checkout main` at the start of `invokeOBrien()`, before the `doneTemplate` construction.
- Wrapped in try/catch — failure logs a warning but does not crash the watcher.
- Amendment detection: parses `briefContent` frontmatter and checks `references` field. If the brief is an amendment (`references` is set and not `"null"`), the checkout is skipped so O'Brien stays on the existing branch.

### Task 3 — Log line when evaluation takes priority over pending
- When a DONE file is claimed for evaluation and `pendingFiles.length > 0`, logs an info message and prints a terminal line: `⚡ N pending held — evaluating #ID first (merge-first priority)`.
- `pendingFiles` is scanned at the top of `poll()` alongside `doneFiles`, making the count available in the evaluation block.

### Task 4 — Line-count regression guard in `mergeBranch()`
- After `git checkout main` but before `git merge --no-ff`, compares line counts of `dashboard/lcars-dashboard.html` between main and the branch.
- If the branch version is >15% shorter, the merge is blocked with a `MERGE_FAILED` event, clear log output, and terminal warning about likely stale base.
- Wrapped in try/catch — if the file doesn't exist on either branch, the guard is skipped silently.

## Files changed

- `bridge/watcher.js` — all four tasks implemented in this file

## Verification

- `node -c bridge/watcher.js` — syntax check passes.
