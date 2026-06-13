---
id: "214"
title: "F-W3 — TDZ fix: remove inner sliceMeta shadow at orchestrator.js:2113"
from: rom
to: nog
status: DONE
slice_id: "214"
branch: "slice/214"
completed: "2026-04-25T11:14:00.000Z"
tokens_in: 28000
tokens_out: 8500
elapsed_ms: 180000
estimated_human_hours: 0.3
compaction_occurred: false
---

## Summary

Deleted the inner `const sliceMeta = parseFrontmatter(sliceContent) || {};` at `bridge/orchestrator.js:2113` that created a Temporal Dead Zone crash. The outer `sliceMeta` (line 1834) is identical and already in closure scope — all references in the execFile callback now resolve to it.

## Incident reference

On 2026-04-25 ~10:14Z, slice 210 triggered the crash. Rom reported "work already on main via slice 212" and committed only the DONE skeleton. `verifyRomActuallyWorked` correctly returned `{ ok: false, reason: 'rom_no_commits' }`. The error-handling block at line 2098 then accessed `sliceMeta.root_commission_id` (line 2101), which hit the TDZ from the inner `const sliceMeta` declaration at line 2113 (in the sibling else-block, but same enclosing block scope). The orchestrator process crashed with `ReferenceError: Cannot access 'sliceMeta' before initialization`. Pipeline halted until Philipp manually restarted.

This fix would have prevented that crash. The orchestrator now completes the error-handling path cleanly for any `rom_no_commits` (or other verification failure) case.

## Changes

| File | Change | LOC |
|------|--------|-----|
| `bridge/orchestrator.js` | Deleted inner `const sliceMeta` at line 2113 | -1 |
| `test/orchestrator-rom-verification-no-crash.test.js` | New regression test (6 assertions) | +196 |

## Acceptance criteria

- **AC0** ✅ Skeleton DONE first commit.
- **AC1** ✅ Inner `const sliceMeta` deleted from orchestrator.js line 2113.
- **AC2** ✅ No new `let sliceMeta` or `const sliceMeta` in execFile callback. Outer line-1834 declaration is the only one in `invokeRom` scope.
- **AC3** ✅ All `sliceMeta.*` references in the callback body resolve to outer scope. Full test suite passes (29 files, 0 failures).
- **AC4** ✅ Regression test exists with 6 assertions: static analysis confirms no shadow, verify-failure block references `sliceMeta.root_commission_id`, `rom_no_commits` path completes without ReferenceError, `appendO'BrienEvent` receives valid `root_id`.
- **AC5** ✅ Full test suite passes — 29 test files, all green.
- **AC6** ✅ Diff is 1 LOC deletion in orchestrator.js (excluding tests).
- **AC7** ✅ Only `bridge/orchestrator.js` and the new test file changed.
- **AC8** ✅ This report cites the 2026-04-25 crash, names slice 210 as trigger, confirms fix prevents orchestrator exit.

## Test results

All 29 test files pass. New test: `test/orchestrator-rom-verification-no-crash.test.js` — 6 passed, 0 failed.
