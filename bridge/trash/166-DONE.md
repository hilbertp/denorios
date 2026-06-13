---
id: "166"
title: "UI2 — Pause/Resume/Abort controls (Rom subprocess + dashboard wiring)"
from: rom
to: nog
status: DONE
slice_id: "166"
branch: "slice/166"
completed: "2026-04-19T03:42:52.199Z"
tokens_in: 185000
tokens_out: 12000
elapsed_ms: 480000
estimated_human_hours: 4.0
compaction_occurred: false
---

## Summary

Shipped Pause/Resume/Abort controls on the Rom panel per Ziyal's wireframe screens and handoff. Backend extends the control-file handler with three new actions; frontend enables the disabled Pause button and wires the paused-state footer.

## Changes

### Backend (bridge/watcher.js)

1. **PID bookkeeping**: Added `activeChildren` Map keyed by slice ID, tracking child process + worktree path. Populated on Rom spawn, cleaned up on all terminal events.

2. **Three control-file actions**:
   - `pause`: Validates IN_PROGRESS + live child, sends `SIGSTOP`, emits `ROM_PAUSED` register event.
   - `resume`: Validates latest event is `ROM_PAUSED`, sends `SIGCONT`, emits `ROM_RESUMED`.
   - `abort`: Sends `SIGCONT` (if paused) then `SIGKILL`, cleans up worktree, moves slice to `bridge/staged/` with `status: STAGED`, emits `ROM_ABORTED`, resets processing state.

3. **Paused-state survival**: On watcher restart, startup recovery detects IN_PROGRESS slices with `ROM_PAUSED` as latest register event. Leaves them in place (no re-queue), sets `processing = true`, and emits `ERROR` with `phase: "paused_child_died"` since the child process is gone.

4. **Control file processing moved before processing gate** in the poll loop so pause/resume/abort files are consumed even while a slice is processing.

5. **Helper functions**: `getLatestRegisterEvent(sliceId)` and `getRoundFromRegister(sliceId)` for register state derivation.

### Server (dashboard/server.js)

- Added `/api/bridge/{pause|resume|abort}/{id}` POST routes that write control files to `bridge/control/`, matching the return-to-stage pattern.

### Frontend (dashboard/lcars-dashboard.html)

1. **Pause button enabled**: Removed `disabled` attribute, removed "coming in UI2" tooltip, updated CSS from disabled style to active hover style.

2. **Resume + Abort buttons enabled**: Removed `disabled` attributes, added `onclick` handlers.

3. **Pause/Resume/Abort JS functions**: `pauseBuild()`, `resumeBuild()`, `showAbortConfirm()`, `confirmAbort()`, `cancelAbort()` — all write control files via the server API.

4. **Paused-state detection**: `isSlicePaused(sliceId)` checks register events for active `ROM_PAUSED` state.

5. **Timer freeze**: On pause, timer freezes at the `ROM_PAUSED` timestamp, displays "Paused at Xm XXs". On resume, timer unfreezes and resumes counting.

6. **Footer swap**: Active footer (Pause button) swaps to paused footer (Resume + Abort) when paused. Abort uses inline confirmation ("Abort? [Yes] [Cancel]"), not a modal.

7. **Build status text**: Shows "Build paused" in amber during paused state.

### Tests (test/pause-resume-abort.test.js)

30 tests covering:
- Pause/resume/abort action dispatch in watcher
- SIGSTOP/SIGCONT/SIGKILL signal usage
- PID bookkeeping existence
- ROM_PAUSED/ROM_RESUMED/ROM_ABORTED event emission
- Rejection preconditions (not IN_PROGRESS, not paused)
- Paused-state persistence and paused_child_died error
- Frontend: buttons enabled, no UI2 tooltip, event handling, timer freeze
- Server API endpoints
- APENDMENT spelling compliance (AC 8)

## Acceptance criteria status

| AC | Status |
|----|--------|
| 1. Pause emits ROM_PAUSED, freezes subprocess, swaps footer | DONE |
| 2. Resume emits ROM_RESUMED, continues subprocess, restores footer | DONE |
| 3. Abort emits ROM_ABORTED, kills subprocess, cleans worktree, returns to STAGED | DONE |
| 4. Pause/Resume rejected on wrong state | DONE |
| 5. Watcher restart preserves paused state | DONE |
| 6. Paused child death emits ERROR with paused_child_died | DONE |
| 7. Disabled Pause button + UI2 tooltip removed | DONE |
| 8. No "amendment" in dashboard/watcher (excluding compat) | DONE |
| 9. Diff limited to watcher, test, dashboard | DONE |
| 10. watcher.js starts cleanly, existing tests green | DONE |
