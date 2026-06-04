---
id: J-gate-fail-retry
category: gate-merge
status: draft
last_reviewed: 2026-05-21
---

# Gate fails, Bashir flags failed AC, user commissions hotfix and retries

## What the user is trying to accomplish

Philipp presses merge; Bashir runs the regression suite and one test fails. The failure is traced to an unmet AC from one of the unmerged slices. The gate halts in GATE_FAILED state. O'Brien commissions a hotfix slice, Rom fixes the issue, Nog approves, and Philipp retries the merge.

## Preconditions

- Merge gate is running (GATE_RUNNING; `bridge/state/gate-running.json` present)
- Bashir has already passed the "tests-updated" step (Step 1 of the progress widget is done)
- Bashir's regression suite is executing (Step 2 is active)
- One or more acceptance criteria from an unmerged slice are not met by the current state of dev

## Steps

1. Bashir runs the regression suite
2. One test fails — e.g., "Slice 247 AC#2: queue-reorder persists order atomically"
3. Bashir emits a `regression-fail` event with payload: `{ slice_id, ac_index, test_path, failure_excerpt }`
4. `bridge/state/gate-running.json` mutex is deleted (gate mutex released)
5. `branch-state.json` gate.status transitions GATE_RUNNING → GATE_FAILED; gate.last_failure is populated with the failed AC details
6. Step 2 card in the progress widget transitions to error (✗) with the failure excerpt displayed
7. Gate fail actions appear: the user can click "Abort" to acknowledge the failure
8. Philipp (or O'Brien) reads the failure report and understands which AC failed
9. O'Brien commissions a hotfix slice targeting the specific failing test/AC
10. Rom picks up the hotfix slice, reads the AC, identifies and fixes the bug, appends DONE
11. Nog reviews the hotfix and accepts it
12. The orchestrator squash-merges the hotfix slice to dev (no gate running, so it squashes immediately)
13. Philipp clicks "Abort" in the gate fail actions to acknowledge the failure
14. `branch-state.json` gate.status transitions GATE_FAILED → ACCUMULATING
15. The dashboard returns to ONLINE state (header health pill); `gate.last_failure` is preserved for audit
16. Philipp re-presses the Merge button
17. Gate runs again; the full regression suite passes (including the previously-failing test)
18. Merge completes; `branch-state.json` gate.status → GATE_PASSED

## Expected outcomes

- Register contains: `regression-fail` event with failed AC payload, then (after hotfix and retry) `regression-pass` and `MERGED` events
- `branch-state.json` gate.status progression: GATE_RUNNING → GATE_FAILED → ACCUMULATING → GATE_RUNNING → GATE_PASSED
- `gate.last_failure` is preserved through the ACCUMULATING state (only cleared by a new gate failure overwriting it)
- The hotfix slice lands on dev and is included in the next merge batch
- On retry, all three step cards complete successfully
- History panel shows all slices (including the hotfix) as merged

## Known failure modes

- **Failure report is unclear.** Bashir's `failure_excerpt` doesn't identify which AC failed. *Recovery:* O'Brien must inspect Bashir's test directly and cross-reference the slice body. Consider filing an open question to improve Bashir's payload specificity.
- **Deferred slices don't get squashed after the mutex is deleted.** Slices that were ACCEPTED during the gate run may be stuck. *Recovery:* Restart the orchestrator; recovery scan detects ACCEPTED files and drains them.
- **Hotfix introduces a new failure.** Rom's fix for the failing AC breaks something else. *Recovery:* Another hotfix is commissioned; the retry cycle continues. Hotfixes are normal slices through the pipeline.
- **User presses Abort while gate is GATE_RUNNING (not GATE_FAILED).** The abort endpoint returns 409 — abort is only valid from GATE_FAILED. *Recovery:* To abort a running gate, the operator must kill the Bashir process directly (see J-recovery-mutex-orphan and runbook F7).

## Sources

- `docs/runbooks/RUNBOOK-BASHIR-GATE.md` — GATE_FAILED state, abort flow, ACCUMULATING state, `gate.last_failure` persistence, F7 (Bashir runs forever)
- `docs/contracts/slice-pipeline.md` — ACCEPTED slice handling during gate; squash-merge mechanics
- `docs/contracts/slice-lifecycle.md` — ACCEPTED state definition; what "deferred slices" means
- `bridge/state/branch-state.json` — gate.status schema (GATE_FAILED, ACCUMULATING); gate.last_failure structure
- `dashboard/DASHBOARD-REDESIGN-SPEC.md` — gate progress widget error state, gate-fail-actions (abort button)
- `.claude/roles/bashir/ROLE.md` — Bashir's regression-fail payload format; bad-test diagnosis

## Open questions

- `docs/architecture/BRANCHING-FOR-BASHIR-GATE-ADR.md` does not exist on current main. The gate failure and deferred-squash mechanics are described in the runbook, but the architectural record is absent. Route to Dax.
- When Bashir reports `regression-fail`, is the payload persisted in the register, in `branch-state.json` under `gate.last_failure`, or both? The runbook says `last_failure` is preserved; the register should also have the event. Confirm with Worf.
- After the user clicks Abort from GATE_FAILED → ACCUMULATING: is there any additional UI change beyond the gate progress widget closing and the health pill returning to ONLINE? Is there an explicit "ACCUMULATING" label anywhere in the dashboard?
- If O'Brien commissions multiple hotfixes in response to a single gate failure, do they all need to land on dev before the retry, or can Philipp retry after each hotfix?
- The runbook mentions `gate.last_failure` is "preserved" and only overwritten by a subsequent gate failure. Is it displayed anywhere in the dashboard as a persistent reminder of what failed?
