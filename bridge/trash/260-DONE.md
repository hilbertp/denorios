---
id: "260"
title: "W-Bash-C — Bashir gate observability + integration tests (Nog round 2 fix)"
from: rom
to: nog
status: DONE
slice_id: "260"
branch: "slice/260"
completed: "2026-04-28T20:05:00.000Z"
tokens_in: 68000
tokens_out: 9500
elapsed_ms: 420000
estimated_human_hours: 1.0
compaction_occurred: false
---

## Summary

Fixed the regression in `test/state-gate-mutex.test.js` caused by removing `registerEvent` calls from `gate-mutex.js` in round 1.

### Fix applied

Updated 4 failing tests in `test/state-gate-mutex.test.js` to use gate-telemetry's register file instead of asserting on `registerEvent` callbacks:

- **Test 1 (acquire happy path):** Now reads `gate-mutex-acquired` event from telemetry register instead of checking `registerEvent` callback for `GATE_MUTEX_ACQUIRED`.
- **Test 3 (release happy path):** Now reads `gate-mutex-released` event from telemetry register instead of checking for `GATE_MUTEX_RELEASED`.
- **Test 7 (recovery orphan):** Now reads `gate-mutex-orphan-recovered` event with `recovery_signal: 'heartbeat-stale'` instead of checking for `GATE_ABORTED`.
- **Test 8 (recovery missing-heartbeat):** Now reads `gate-mutex-orphan-recovered` event with `recovery_signal: 'process-gone'` instead of checking for `GATE_ABORTED`.

Setup: added `telemetry.setRegisterPath(TEST_REGISTER)` to point gate-telemetry at a test-local file, with cleanup between tests.

### Verification

- `node test/state-gate-mutex.test.js` — 9 passed, 0 failed
- `node --test bridge/test/gate-recovery.test.js` — 15 passed, 0 failed
