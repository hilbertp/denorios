---
id: J-merge-button-pass
category: gate-merge
status: draft
last_reviewed: 2026-05-21
---

# Press merge button and gate passes

## What the user is trying to accomplish

Philipp reviews the accumulated ACCEPTED slices on dev (via the Branch Topology panel and RR pill), decides the risk is acceptable, clicks "Merge to main," and Bashir's gate runs. All tests pass, the merge completes, and the slices land on main.

## Preconditions

- One or more slices are in ACCEPTED state (`bridge/queue/{id}-ACCEPTED.md` files exist)
- The Branch Topology panel (`.topo-panel`) shows commits ahead of main (non-zero)
- RR pill shows a risk percentage
- `branch-state.json` gate.status is IDLE (not GATE_RUNNING, GATE_FAILED, or ACCUMULATING)
- Merge button (`.merge-btn`) is enabled
- The orchestrator can spawn Bashir via `claude -p`
- No `bridge/.pipeline-paused` flag is present

## Steps

1. Philipp observes the Branch Topology panel: dev has commits ahead of main, RR shows a risk level
2. Philipp clicks the "Merge to main" button
3. The orchestrator receives the gate-start signal; `bridge/state/gate-running.json` mutex is created
4. `branch-state.json` gate.status transitions from IDLE → GATE_RUNNING
5. The Branch Topology panel shows a gate progress widget with three step cards: "Tests updated" → "Regression pass" → "Merge"
6. Bashir is invoked via `claude -p` with the list of unmerged slice files on dev
7. Bashir reads the slices' acceptance criteria, authors/updates regression tests in the `regression/` directory, commits them to dev
8. Bashir emits `tests-updated` event; Step 1 card transitions to done (✓)
9. Bashir runs the full regression suite — all tests pass
10. Bashir emits `regression-pass` event; Step 2 card transitions to done (✓)
11. `bridge/state/gate-running.json` mutex is deleted
12. The orchestrator unlocks main (`scripts/unlock-main.sh`), squash-merges slice branches to dev (if not already squashed), merges dev→main, relocks main (`scripts/lock-main.sh`)
13. `branch-state.json` gate.status transitions GATE_RUNNING → GATE_PASSED
14. The orchestrator emits a `MERGED` event
15. Step 3 card transitions to done (✓); the progress widget closes
16. The Branch Topology panel updates: new merge commit visible on main, dev fast-forwards to match
17. RR indicator resets to zero; merge button re-appears enabled

## Expected outcomes

- `bridge/state/gate-running.json` is created at gate-start and deleted on gate completion
- All three step cards transition from pending → active → done in order
- Bashir's heartbeat file is updated periodically while the gate runs (`bridge/state/bashir-heartbeat.json`)
- Register contains events: `gate-start` (or equivalent), `tests-updated`, `regression-pass`, `MERGED`
- Main branch has a new merge commit; dev branch tip equals main tip
- `branch-state.json` gate.status = GATE_PASSED; gate.last_pass populated
- Active Build panel shows no in-flight slice (if none is queued)
- Slice History panel shows the merged slices
- Merge button is re-enabled (disabled during GATE_RUNNING state)
- Any slices that were deferred (ACCEPTED but arriving while the gate was running) are now squashed to dev

## Known failure modes

- **Bashir heartbeat goes stale (Bashir crashed mid-gate).** The orchestrator detects the orphan and aborts the gate. *Recovery:* See J-recovery-mutex-orphan.
- **Merge conflicts during dev→main merge.** The orchestrator emits `MERGE_FAILED` and halts. *Recovery:* Manual conflict resolution required; escalate to O'Brien.
- **Main lock cannot be released.** `unlock-main.sh` errors. *Recovery:* Worf-only operation per runbook. See `docs/runbooks/RUNBOOK-BASHIR-GATE.md` §F6.
- **Regression-fail occurs.** See J-gate-fail-retry.

## Sources

- `docs/runbooks/RUNBOOK-BASHIR-GATE.md` — gate state machine (IDLE→GATE_RUNNING→GATE_PASSED), mutex lifecycle, heartbeat liveness, F1–F12 failure catalog
- `docs/contracts/slice-pipeline.md` §5 — ACCEPTED→MERGED transition mechanics
- `docs/contracts/slice-lifecycle.md` — ACCEPTED and MERGED state definitions
- `dashboard/DASHBOARD-REDESIGN-SPEC.md` — Branch Topology panel, merge button, gate progress widget, RR pill
- `bridge/state/branch-state.json` — gate.status schema (IDLE, GATE_RUNNING, GATE_PASSED, GATE_FAILED, ACCUMULATING)
- `scripts/unlock-main.sh`, `scripts/lock-main.sh` — main-lock protocol

## Open questions

- `docs/architecture/BRANCHING-FOR-BASHIR-GATE-ADR.md` is referenced in prior scouting output but does not exist on current main. The gate state machine and merge flow are described in the runbook but the architectural decision record is absent. Route to Dax.
- Does the merge button show a tooltip during GATE_RUNNING state explaining why it is disabled? Or is it replaced silently by the step-card progress widget?
- If Rom has commissioned a new slice while the gate is running, does that slice remain ACCEPTED (deferred) until after the merge completes? After the mutex is deleted, is it squashed immediately or on the next poll cycle?
- The RR pill — is it computed in real-time from current branch state, or is it a snapshot computed at some earlier checkpoint?
- What is the exact format of the gate-start event in the register? Is it a single event or does the orchestrator emit a sequence?
