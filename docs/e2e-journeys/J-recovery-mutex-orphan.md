---
id: J-recovery-mutex-orphan
category: recovery
status: draft
last_reviewed: 2026-05-21
---

# Recover from orphaned gate mutex (Bashir crash mid-gate)

## What the user is trying to accomplish

Bashir crashes or hangs while the gate is running, leaving the mutex file `bridge/state/gate-running.json` behind and not updating the heartbeat. The orchestrator detects the orphan via stale heartbeat, aborts the gate, cleans up the mutex, and allows the next merge attempt.

## Preconditions

- Gate is running (`bridge/state/gate-running.json` exists with valid `started_at` and related fields)
- Bashir's heartbeat file `bridge/state/bashir-heartbeat.json` exists
- Bashir process is dead (crashed, killed, hung) and not updating the heartbeat
- The orchestrator is still running and performing its dispatch cycle
- The heartbeat has been stale for more than the staleness threshold (120 seconds per runbook)

## Steps

1. Bashir is running the regression suite when an error causes it to crash
2. Bashir's process exits without emitting `regression-fail` or `regression-pass`
3. The mutex file `bridge/state/gate-running.json` persists
4. The heartbeat file `bridge/state/bashir-heartbeat.json` stops being updated
5. The orchestrator's next dispatch cycle checks the heartbeat `ts` and compares it to now minus the staleness threshold (120 seconds)
6. The heartbeat is stale; the orchestrator concludes Bashir is dead
7. The orchestrator emits a `gate-abort` event with reason `orchestrator_detected_bashir_orphan` and records the heartbeat age
8. The orchestrator deletes `bridge/state/gate-running.json`
9. Any ACCEPTED slices that were deferred during the gate are now drained (squashed to dev in FIFO order by `accepted_ts`)
10. `branch-state.json` gate.status transitions to a post-abort state (exact state TBD — see Open questions)
11. The dashboard receives the abort signal and closes the progress widget
12. The Merge button is re-enabled; the user can retry the gate

## Expected outcomes

- Mutex file `bridge/state/gate-running.json` is deleted by the orchestrator (not manually)
- Heartbeat file `bridge/state/bashir-heartbeat.json` is preserved (for post-mortem analysis)
- `branch-state.json` gate.status reflects the abort (not GATE_RUNNING)
- Register contains a `gate-abort` event with `reason: orchestrator_detected_bashir_orphan` and `heartbeat_age_seconds: <N>`
- Deferred ACCEPTED slices are squashed to dev after mutex release
- Dashboard reflects the abort state; gate progress widget closes
- Operator can run `node bridge/state-doctor.js` to confirm IDLE state and no anomalies
- Merge button is re-enabled for a future retry attempt

## Known failure modes

- **Heartbeat check is too lenient — false positive abort.** Bashir is actually still running but slow (e.g., in a long compilation loop), and the heartbeat appears stale. *Recovery:* Increase the orphan threshold in configuration. A false-positive abort is recoverable; a false-negative (treating a crashed Bashir as alive) blocks the gate indefinitely.
- **Heartbeat file is missing entirely.** The orchestrator cannot find the `ts` to compare. *Recovery:* The runbook recommends using the PID as a secondary signal: check if the PID is still alive. If dead, abort. If alive, assume Bashir is still working. See `docs/runbooks/RUNBOOK-BASHIR-GATE.md` §F1.
- **Orchestrator itself crashes while detecting the orphan.** The abort sequence is interrupted before the mutex is deleted. *Recovery:* On orchestrator restart, the recovery scan re-derives branch state. If the heartbeat is stale on restart, the mutex is released and gate resets to IDLE.
- **User manually deletes `gate-running.json` while Bashir is still alive.** Bashir later completes and emits `regression-pass`, but the orchestrator ignores it (no active gate). *Recovery:* This is a manual intervention error; the operator should not delete the mutex by hand. Restart the orchestrator to reinitialize state.

## Sources

- `docs/runbooks/RUNBOOK-BASHIR-GATE.md` — §F1 (mutex orphaned, heartbeat stale), §F2 (mutex orphaned, heartbeat fresh), heartbeat staleness threshold (120 seconds), `state-doctor.js` usage, recovery procedure
- `bridge/state/branch-state.json` — gate.status schema
- `bridge/state/gate-mutex.js` — mutex file structure (inferred from state/ directory contents)
- `dashboard/DASHBOARD-REDESIGN-SPEC.md` — gate progress widget, merge button state

## Open questions

- `docs/architecture/BRANCHING-FOR-BASHIR-GATE-ADR.md` does not exist on current main. The heartbeat-primary liveness contract (and why 120s is the threshold) presumably lives in that ADR. Route to Dax.
- After an orchestrator-detected orphan abort, what is the resulting `branch-state.json` gate.status value? The runbook describes state transitions to IDLE for F1/F2 recovery, but the gate-abort path is not as explicitly documented as GATE_FAILED → ACCUMULATING. Confirm with Worf.
- When the orchestrator detects the orphan, does it send a signal (SIGTERM) to the Bashir process before deleting the mutex, or does it trust Bashir is already dead?
- Is the heartbeat file cleaned up after the gate completes (success or abort), or does it persist forever for forensics?
- The runbook mentions 120 seconds as the staleness threshold. The slice-304 invocation prompt says 90 seconds. Confirm the authoritative threshold with Worf.
