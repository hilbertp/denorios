---
id: "259"
title: "F-W-Bash-B — gate-running.json mutex lifecycle with heartbeat-primary liveness"
from: rom
to: nog
status: DONE
slice_id: "259"
branch: "slice/259"
completed: "2026-04-28T19:35:00.000Z"
tokens_in: 12000
tokens_out: 3500
elapsed_ms: 180000
estimated_human_hours: 0.15
compaction_occurred: false
---

## Summary

Amendment round 1: Addressed all Nog findings. Cleaned up `test/state-gate-mutex.test.js` by removing 5 unused variables and ~25 lines of stream-of-consciousness comments. No production code changes needed. All 9 tests still pass.

## Nog round 1 fixes

1. Removed unused `TEST_ROOT` variable and its `mkdirSync`/`rmSync` lifecycle.
2. Removed `ORIGINAL_MUTEX_PATH` and `ORIGINAL_BRANCH_STATE_PATH` declarations.
3. Removed `drainOrder`, `origModule`, and `origExports` unused variables.
4. Removed ~25 lines of stream-of-consciousness comments explaining abandoned isolation/mocking approaches.
5. Removed unused `os` import (only consumer was `TEST_ROOT`).

Net: 43 lines deleted, 0 lines added.

## Deliverables (unchanged from round 1)

### `bridge/state/gate-mutex.js` (196 LOC)

| Function | Purpose |
|---|---|
| `acquireGateMutex(devTipSha, bashirPid, heartbeatPath, deps)` | Creates mutex via `writeJsonAtomic`. Returns `{ ok: false, reason: "already_held" }` if file exists. Emits `GATE_MUTEX_ACQUIRED`. |
| `releaseGateMutex(reason, deps)` | Deletes mutex file, emits `GATE_MUTEX_RELEASED`, triggers `drainDeferredSlices()`. |
| `drainDeferredSlices(deps)` | Walks `branch-state.json.dev.deferred_slices` in FIFO order (by `accepted_ts`, tiebreak: numeric slice ID). Calls `squashSliceToDev(sliceId)` stub for each. Removes entries on success. |
| `shouldDeferSquash()` | Returns `true` iff `gate-running.json` exists. |
| `recoverGateMutex(deps)` | Startup recovery: checks heartbeat freshness. Fresh (< 90s) = resume. Stale/missing = emit `GATE_ABORTED`, delete mutex, drain. |

### `test/state-gate-mutex.test.js` (9 scenarios, all passing)

1. Acquire happy path — file appears, event fires.
2. Acquire while held — `already_held`, no overwrite.
3. Release happy path — file deleted, event fires, drain runs.
4. Drain FIFO ordering — earlier `accepted_ts` drains first.
5. Drain tiebreak — same timestamp, smaller slice ID first.
6. Recovery happy — fresh heartbeat, resume, mutex untouched.
7. Recovery orphan — stale heartbeat, `GATE_ABORTED`, mutex deleted, drain.
8. Recovery missing-heartbeat — absent file treated as stale.
9. `shouldDeferSquash` — true when mutex exists, false otherwise.

## Acceptance criteria

- [x] AC0–AC11 — All satisfied (unchanged from round 1; production code untouched).
- [x] All Nog findings addressed.
