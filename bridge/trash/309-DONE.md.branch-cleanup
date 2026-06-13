---
id: "309"
title: "F-GateHeartbeat-1 — reset bashir heartbeat at gate spawn"
from: rom
to: nog
status: DONE
slice_id: "309"
branch: "slice/309"
completed: "2026-05-24T08:17:36.000Z"
tokens_in: 18400
tokens_out: 2100
elapsed_ms: 231000
estimated_human_hours: 0.3
compaction_occurred: false
---

## Summary

Added a one-line heartbeat reset to `startGate` in `bridge/orchestrator.js`, immediately before the heartbeat poll `setInterval`. Wrote a 6-test suite covering the stale-leftover scenario.

## Root cause

`startGate` never reset `bridge/state/bashir-heartbeat.json` when spawning Bashir. The heartbeat poll (30s interval, 90s stale threshold) read a leftover file from a prior run (ts ~8h old), computed age >> 90s, and SIGTERMed Bashir on the first poll tick — before Bashir had a chance to write its own heartbeat. The poll's `catch` block skips abort for a *missing* file but not for a *stale* existing file.

## Change

**`bridge/orchestrator.js`** — 4 lines added (~line 6184, before the heartbeat poll `setInterval`):

```diff
+  // Reset heartbeat at spawn so a stale leftover file can't insta-abort the gate.
+  // Starts the staleness clock at spawn; Bashir has the full window to take over.
+  try { writeJsonAtomic(BASHIR_HEARTBEAT_PATH, { ts: new Date().toISOString() }); } catch (_) {}
+
   // 6. Heartbeat polling — check every 30s, abort if stale > 90s
   const heartbeatPoll = setInterval(() => {
```

Uses existing `writeJsonAtomic` helper (imported at line 13). Wrapped in try/catch so a write failure can't crash the spawn path.

## Test

**`test/gate-heartbeat-reset-on-spawn.test.js`** — 6 tests, all pass:

```
  ✓ stale leftover (8h) age exceeds BASHIR_HEARTBEAT_STALE_MS without reset
  ✓ after spawn reset, heartbeat ts is within 5s of now
  ✓ after spawn reset, poll does not see stale — no abort triggered
  ✓ stale threshold constant is 90000ms
  ✓ reset overwrites stale leftover (1h old) not just 8h
  ✓ reset writes valid JSON with a ts field

  6 passed, 0 failed
```

## Acceptance criteria

| # | Criterion | Status |
|---|---|---|
| 1 | `startGate` writes `{ts: now}` to `BASHIR_HEARTBEAT_PATH` before poll starts | ✓ |
| 2 | Stale pre-existing file does NOT cause immediate `heartbeat_stale` abort | ✓ (test 3) |
| 3 | Test covers: stale leftover + spawn → heartbeat fresh, first poll no abort | ✓ |
| 4 | Existing gate tests still pass | ✓ |
| 5 | Diff confined to `bridge/orchestrator.js` + test file | ✓ |

## Existing tests verified

- `bashir-lane-heartbeat-stale.test.js` — 7 passed
- `bashir-non-gate-mutex.test.js` — 6 passed
- `post-gate-drain-on-fail.test.js` — 1 passed
- `abort-from-running.test.js` — 2 passed
- `orchestrator-merge-no-ff.test.js` — 5 passed
- `regression-fail.test.js` — 3 passed
