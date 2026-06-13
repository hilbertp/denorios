---
id: "227"
title: "F-WQ — Queue panel filter: also exclude ERROR + STUCK terminal states"
from: rom
to: nog
status: DONE
slice_id: "227"
branch: "slice/227"
completed: "2026-04-26T15:52:00.000Z"
tokens_in: 18000
tokens_out: 4500
elapsed_ms: 180000
estimated_human_hours: 0.3
compaction_occurred: false
---

## Summary

Extended the Queue panel terminal-state filter in `dashboard/server.js` to exclude ERROR and STUCK slices, matching the existing treatment of ACCEPTED, ARCHIVED, and SLICE states. This removes ~27 stale terminal entries from the Queue display.

## Changes

### `dashboard/server.js` (1 line changed)

- **Line 570**: Added `ERROR|STUCK` to the `TERMINAL_FILE_RE` regex in `buildBridgeData()`. The regex now reads:
  ```
  /^(.+?)-(ACCEPTED|ARCHIVED|ERROR|STUCK|SLICE)\.md$/
  ```
  Any queue file matching these suffixes adds its slice ID to `terminalIds`, which is checked at line 584 to skip the slice from the Queue panel output.

### `test/queue-terminal-filter.test.js` (new, 113 lines)

Regression test with synthetic queue covering all states:
1. **Test 1**: Synthetic queue with one slice per state (QUEUED, PENDING, IN_PROGRESS, DONE, ACCEPTED, ARCHIVED, ERROR, STUCK, SLICE). Verifies only 4 non-terminal slices appear in Queue; all 5 terminal IDs are excluded.
2. **Test 2**: Standalone ERROR file (no separate marker) — confirms terminal filter wins over queue-file match.
3. **Test 3**: History panel is unaffected — ERROR and DONE slices still appear in register-based history.

## Acceptance criteria

| AC | Status | Notes |
|----|--------|-------|
| AC0 | Met | Skeleton DONE committed first |
| AC1 | Met | Filter now excludes ACCEPTED, ARCHIVED, ERROR, STUCK, SLICE |
| AC2 | Met | DONE, IN_PROGRESS, IN_REVIEW, EVALUATING, PARKED, QUEUED, STAGED unaffected |
| AC3 | Met | Regression test covers synthetic queue with all states |
| AC4 | Met | History panel data path unchanged |
| AC5 | Met | 1 LOC changed in server.js |
| AC6 | Met | Only dashboard/server.js and test file modified |
