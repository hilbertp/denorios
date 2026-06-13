---
id: "240"
title: "F-WI — Enforce depends_on at dispatch: block slice until dependencies merged"
from: rom
to: nog
status: DONE
slice_id: "240"
branch: "slice/240"
completed: "2026-04-27T16:18:00.000Z"
tokens_in: 28000
tokens_out: 3500
elapsed_ms: 180000
estimated_human_hours: 0.3
compaction_occurred: false
---

## Summary

Implemented `depends_on` enforcement in the orchestrator dispatch loop. QUEUED slices with unmet dependencies are now skipped and automatically reconsidered on subsequent poll ticks.

## What changed

**`bridge/orchestrator.js`** — 2 commits, +23 lines (excluding skeleton stub)

1. **`depsAreMet(sliceMeta)`** — new function (lines ~2662–2669): parses the `depends_on` frontmatter field, splits comma-separated IDs, and checks each against `hasMergedEvent()`. Returns `true` when field is absent, empty, or `'null'`.

2. **Dispatch loop dependency gate** (lines ~4503–4518): replaces the direct `pendingFiles[0]` pick with a loop that iterates candidates, skips blocked ones with a `⏸ Slice N — blocked on #X (not yet merged)` message, and dispatches the first eligible slice. If all candidates are blocked, the tick returns early (no idle-print side effects).

## Acceptance criteria

- [x] AC1. Two commits: skeleton (`f6c8d04`) + implementation (`611cdfc`)
- [x] AC2. QUEUED slice with unmet `depends_on` is skipped — stays QUEUED
- [x] AC3. No `depends_on` / empty / null dispatches normally (early return in `depsAreMet`)
- [x] AC4. All `depends_on` IDs merged → dispatches normally
- [x] AC5. Blocked slices re-evaluated every poll tick automatically
- [x] AC6. Prints `⏸ Slice N — blocked on #X (not yet merged)` using `C.yellow` and `SYM.dash`
- [x] AC7. `hasMergedEvent` reused directly — no duplicate logic
- [x] AC8. No changes outside `bridge/orchestrator.js`
- [x] AC9. Diff is 23 insertions / 2 deletions — well under 50 LOC
