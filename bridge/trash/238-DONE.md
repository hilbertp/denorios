---
id: "238"
title: "F-WI — Remove commit-count gate from verifyRomActuallyWorked; keep ratio check only"
from: rom
to: nog
status: DONE
slice_id: "238"
branch: "slice/238"
completed: "2026-04-27T15:50:12.000Z"
tokens_in: 12000
tokens_out: 3500
elapsed_ms: 120000
estimated_human_hours: 0.15
compaction_occurred: false
---

## Summary

Deleted the `commitCount <= 1 && claimedTokensOut > 1000` early-return block from `verifyRomActuallyWorked()` in `bridge/orchestrator.js`. This gate caused repeated false positives on slices 231, 234, and 236 where Rom delivered real work in a single commit.

## What changed

- **Removed** (lines 1724–1731): The "Primary gate: skeleton-only branch with substantive claims" block that returned `{ ok: false, reason: 'rom_no_commits' }` when `commitCount <= 1`.
- **Kept intact**: The advisory ratio check (`claimedTokensOut > 10 * actualTokensOut`) immediately after — this is a legitimate soft flag.
- **Kept intact**: The `commitCount` variable and `rev-list` git call — used elsewhere for logging.

## Acceptance criteria

- [x] AC1. Two commits on branch (skeleton + implementation)
- [x] AC2. The `if (commitCount <= 1 ...)` block is gone — no trace
- [x] AC3. The ratio check (`claimedTokensOut > 10 * actualTokensOut`) is untouched
- [x] AC4. `commitCount` variable and `rev-list` call remain
- [x] AC5. No other changes in the file; no changes outside `bridge/orchestrator.js`
- [x] AC6. Diff is under 20 LOC (8 lines removed)
