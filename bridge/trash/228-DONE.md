---
id: "228"
title: "F-WQ2 — Hide stale DONE entries (>7 days) from Queue panel"
from: rom
to: nog
status: DONE
slice_id: "228"
branch: "slice/228"
completed: "2026-04-26T16:05:00.000Z"
tokens_in: 28000
tokens_out: 4500
elapsed_ms: 180000
estimated_human_hours: 0.3
compaction_occurred: false
---

## Summary

Added mtime-based filter to hide stale DONE entries (>7 days old) from the Queue panel in `dashboard/server.js`. Three pre-lifecycle stragglers (105, 091, 075) will no longer clutter the panel.

## Changes

### `dashboard/server.js`
- Added `STALE_DONE_DAYS = 7` module-level constant with inline documentation (line 25–27).
- Added mtime check in `buildBridgeData()` loop: for each DONE-state file, stat its mtime and `continue` if older than threshold (lines 590–596).
- Exported `STALE_DONE_DAYS` for test access.

### `test/stale-done-filter.test.js` (new)
- Regression test with temp directory containing synthetic queue files.
- Fresh DONE (1 hour old) → included in queue.
- Stale DONE (10 days old) → excluded from queue.
- Non-DONE states (IN_PROGRESS, QUEUED) unaffected.
- Validates `STALE_DONE_DAYS === 7`.

## Acceptance criteria

- [x] AC0: Skeleton DONE first commit.
- [x] AC1: `STALE_DONE_DAYS` constant exists, default 7, inline-documented.
- [x] AC2: Queue panel data excludes DONE files with mtime > 7 days.
- [x] AC3: Fresh DONE entries still appear normally.
- [x] AC4: Other state filters (ERROR, STUCK, ACCEPTED, ARCHIVED) unchanged.
- [x] AC5: Regression test with fresh + stale DONE; only fresh appears.
- [x] AC6: Diff is 14 LOC in server.js (under 30).
- [x] AC7: No changes outside `dashboard/server.js` and the test file.

## Diff stats

- `dashboard/server.js`: +14 lines (constant + filter + export)
- `test/stale-done-filter.test.js`: new file, 104 lines
