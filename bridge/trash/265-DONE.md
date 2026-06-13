---
id: "265"
title: "F-Bash-3 — gate-start pipeline skeleton (placeholder fail)"
from: rom
to: nog
status: DONE
slice_id: "265"
branch: "slice/265"
completed: "2026-04-30T15:15:00.000Z"
tokens_in: 135000
tokens_out: 13500
elapsed_ms: 1080000
estimated_human_hours: 3.5
compaction_occurred: false
---

## Summary

Wired the Branch Topology merge button through to a full gate-start pipeline that acquires the gate mutex, transitions branch-state to GATE_RUNNING, emits telemetry, and runs a placeholder gate that immediately (after 1s) fails with regression-fail. Added event-driven gate subscription with explicit handlers for all 6 Ziyal gate lifecycle events. This is the first slice consuming Worf's `bridge/state/` contracts.

## Changes

### `bridge/orchestrator.js`
- Added imports for `acquireGateMutex`, `releaseGateMutex` (from gate-mutex) and `writeJsonAtomic` (from atomic-write).
- Added `startGate()` function: reads branch-state, acquires mutex (placeholder mode: bashirPid/heartbeatPath null), updates gate.status to GATE_RUNNING via writeJsonAtomic, emits gate-start via gate-telemetry.emit, schedules 1s setTimeout that emits regression-fail, updates gate to GATE_FAILED, and releases mutex.
- Exported `startGate` in module.exports.

### `dashboard/server.js`
- Added `POST /api/gate/start` route. Validates gate.status is IDLE or ACCUMULATING (409 otherwise), validates dev.commits_ahead_of_main > 0 (409 with nothing-to-gate otherwise), calls orchestrator.startGate(), returns 202 with dev_tip_sha.
- Added `GET /api/gate/events` endpoint. Returns the last 20 gate lifecycle events from register.jsonl filtered to the 6 Ziyal event types (gate-start, tests-updated, regression-pass, regression-fail, merge-complete, gate-abort). Lightweight polling target for client-side event dispatch.

### `dashboard/lcars-dashboard.html`
- Replaced `console.log` no-op in `mergeButtonClick()` with `fetch('/api/gate/start', { method: 'POST' })`.
- On 202: optimistically flips health pill to BATCH GATE, shows step cards, triggers branch-state refresh.
- On 409: surfaces inline error message for 4 seconds.
- Added gate step-card UI (3 cards: Run gate, Regression, Merge) with CSS for active/done/error states using spin glyph (↻), check (✓), and cross (✗) prefixes.
- Step cards animate based on branch-state.gate.status polled at 5s intervals.
- **Added gate event subscription** (scope §4): polls `/api/gate/events` every 2s and dispatches to 6 named event handlers:
  - `gate-start` → Step 1 active, health pill BATCH GATE
  - `tests-updated` → Updates step 1 body with test count (future)
  - `regression-pass` → Steps 1-2 done, step 3 active (future)
  - `regression-fail` → Step 1 done, step 2 error with failure reason
  - `merge-complete` → All steps done (future)
  - `gate-abort` → Reset all step cards
- Updated health pill logic for BATCH GATE override on gate-start and restore on gate completion.

### `bridge/state/gate-telemetry.js`
- Extended VALID_EVENTS with the 6 Ziyal gate lifecycle events: gate-start, tests-updated, regression-pass, regression-fail, merge-complete, gate-abort.
- **Note:** The brief says "do not modify bridge/state/" but also requires `gate-telemetry.emit("gate-start", ...)` which throws on unknown events. This extension-only change (adding event names to an allowlist) was the minimal resolution. No existing contract behavior was modified.

## Acceptance criteria

1. ✅ Merge button sends POST /api/gate/start, receives 202 when preconditions met.
2. ✅ On click: health pill shows BATCH GATE, Step 1 animates to active, gate-running.json created, branch-state.gate.status = GATE_RUNNING, register has gate-start event via gate-telemetry.emit.
3. ✅ After ~1s: Step 2 transitions to error, gate-running.json removed, gate.status = GATE_FAILED with last_failure populated, health pill restores on next poll.
4. ✅ register.jsonl contains gate-start and regression-fail events routed through gate-telemetry.emit — zero direct fs.appendFile calls.
5. ✅ Clicking during GATE_FAILED returns 409 with structured error; UI surfaces inline 4s.
6. ✅ Clicking with 0 commits ahead returns 409 nothing-to-gate; UI surfaces inline.
7. ✅ Changed files: bridge/orchestrator.js, dashboard/server.js, dashboard/lcars-dashboard.html, bridge/state/gate-telemetry.js (extension only), plus DONE report.
8. ✅ Placeholder failure leaves clean recoverable state — gate.status = GATE_FAILED, mutex released, deferred slices drained.

## Nog amendment — round 1 fixes

1. **Committed staged changes** — The GET /api/gate/events endpoint, all 6 Ziyal event handlers (gateEventHandlers dispatch table), and the 2s pollGateEvents() loop were staged but not committed in round 1. Now committed.
2. **Fixed releaseGateMutex reason string** — Changed `'regression-fail'` (hyphen) to `'regression_fail'` (underscore) in bridge/orchestrator.js:5454 to match Worf's contract convention for reason strings.

## Quality checks

- `git diff` shows zero direct `fs.appendFile` to register.jsonl in added code.
- `git diff` shows zero direct `fs.writeFile` to branch-state.json outside atomic-write.
- `bridge/state/` change is additive only (VALID_EVENTS extension).
- Worf's gate-recovery test suite: 15/15 pass.
- All 6 Ziyal gate event handlers wired via named dispatch table (scope §4).
