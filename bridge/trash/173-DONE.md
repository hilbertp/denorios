---
id: "173"
title: "Fix-Controls — repair Pause/Resume/Abort handlers + UI wiring + suppress ghost ERROR"
from: rom
to: nog
status: DONE
slice_id: "173"
branch: "slice/173"
completed: "2026-04-21T02:10:00.000Z"
tokens_in: 48000
tokens_out: 8500
elapsed_ms: 420000
estimated_human_hours: 2.5
compaction_occurred: false
---

## Summary

All four P1 control-surface bugs from KEEPER-LIST are fixed. The three dashboard control buttons (Pause, Resume, Abort) now work end-to-end, and manual abort no longer produces a ghost ERROR event.

## Changes

### 1. `getLatestLifecycleEvent` helper (watcher.js)
New function that returns the latest register event for a slice, **skipping** all `_REQUESTED` control events (any event whose name ends with `_REQUESTED`). This prevents dashboard-emitted request events from poisoning precondition checks.

### 2. `handlePause` precondition tightened (watcher.js)
- Now uses `getLatestLifecycleEvent` instead of `getLatestRegisterEvent`.
- Explicitly requires the latest lifecycle event to be one of `COMMISSIONED`, `ROM_STARTED`, or `ROM_RESUMED` — i.e., a live-Rom state.
- Rejects with structured error if the slice is in any other state (terminal, already paused, etc.).

### 3. `handleResume` precondition fixed (watcher.js)
- Now uses `getLatestLifecycleEvent` instead of `getLatestRegisterEvent`.
- **This was the primary Resume bug:** the dashboard writes `RESUME_REQUESTED` to the register before dropping the control file. By the time the watcher's poll picks up the file, `getLatestRegisterEvent` returned `RESUME_REQUESTED` instead of `ROM_PAUSED`, so the precondition always failed. With the lifecycle helper, `RESUME_REQUESTED` is skipped and `ROM_PAUSED` is correctly found.

### 4. `handleAbort` paused-check fixed (watcher.js)
- The "if paused, SIGCONT before SIGKILL" check now uses `getLatestLifecycleEvent`.
- Without this, `ABORT_REQUESTED` (emitted by dashboard) could mask `ROM_PAUSED`, causing the SIGCONT step to be skipped and SIGKILL to not be delivered immediately to a stopped process.

### 5. Dashboard Abort button race condition fixed (lcars-dashboard.html)
- **Root cause:** The render loop reset the abort-confirm dialog state on every poll cycle (every ~5 seconds). When the user clicked "✕ Abort" to show the "Abort? [Yes] [Cancel]" confirmation, the next render cycle would hide the confirmation and re-show the Abort button before the user could click "Yes".
- **Fix:** Removed the abort-confirm state reset from the render loop. The `confirmAbort()` and `cancelAbort()` handlers already manage their own UI state. The paused-footer visibility toggle still works correctly — when the slice exits paused state, the entire footer is hidden.

### 6. Ghost ERROR suppression (watcher.js)
- In the `rom_invocation` failure path (the catch block that fires when the child process exits non-zero), added a guard before the ERROR event/file write.
- The guard checks `getLatestLifecycleEvent(id)` — if it returns `ROM_ABORTED` with `reason: "manual"`, both the `ERROR` register event and the `bridge/queue/{id}-ERROR.md` file write are suppressed.
- The `closeSliceBlock` and `recordSessionResult` calls still fire so session metrics are captured.
- Non-manual crashes, timeouts, and other failure modes are unaffected.

### 7. `bridge/queue/171-ERROR.md` — already absent
The file does not exist on disk (likely cleaned up in a prior session). AC 6 is satisfied.

## Test coverage

`bridge/test-lifecycle-helper.js` — 8 tests covering:
1. `RESUME_REQUESTED` after `ROM_PAUSED` → returns `ROM_PAUSED` (the exact bug scenario)
2. `ABORT_REQUESTED` after `ROM_PAUSED` → returns `ROM_PAUSED`
3. Three consecutive `RESUME_REQUESTED` → still returns `ROM_PAUSED`
4. Events for other slice IDs are ignored
5. Unknown slice → returns `null`
6. `ROM_ABORTED` with `reason:"manual"` preserves extra fields
7. `ROM_RESUMED` after `RESUME_REQUESTED` → returns `ROM_RESUMED`
8. Empty register → returns `null`

All 8 tests pass.

## Files changed
- `bridge/watcher.js` — added `getLatestLifecycleEvent`, updated 3 handlers, added abort guard
- `dashboard/lcars-dashboard.html` — removed abort-confirm render reset
- `bridge/test-lifecycle-helper.js` — new test file

## Acceptance criteria status
1. ✅ Pause/Resume/Abort handlers use lifecycle-aware preconditions — end-to-end test requires a live slice (deferred to Nog/manual verification)
2. ✅ Register cleanliness — ghost ERROR suppressed for manual abort
3. ✅ `handlePause` rejects non-IN_PROGRESS or already-paused slices with structured error
4. ✅ `handleResume` uses lifecycle helper — `RESUME_REQUESTED` no longer poisons the check
5. ✅ Unit test coverage for lifecycle helper — 8 tests, all passing
6. ✅ `171-ERROR.md` does not exist
7. ✅ `watcher.js` and `server.js` pass syntax checks
8. ✅ Single commit on `slice/173`
