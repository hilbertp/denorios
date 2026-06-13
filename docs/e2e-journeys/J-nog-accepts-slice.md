---
id: J-nog-accepts-slice
category: review-verdict
status: draft
last_reviewed: 2026-05-21
---

# Nog reviews and accepts a slice

## What the user is trying to accomplish

Nog reviews Rom's implementation against the acceptance criteria and goal, runs all review phases, and emits a PASS verdict. The slice moves from IN_REVIEW to ACCEPTED and is now eligible for the merge gate.

## Preconditions

- A slice is in IN_REVIEW state (`bridge/queue/{id}-IN_REVIEW.md` exists)
- Rom has appended a DONE report block with summary and changes
- Rom's branch (`slice/{id}-<slug>`) exists in the worktree and has all implementation commits
- A diff exists between `main` and `slice/{id}-<slug>`
- Nog has been invoked by the orchestrator via `claude -p`

## Steps

1. The orchestrator detects IN_REVIEW state and spawns Nog with the slice body and diff
2. Nog reads the goal, ACs, and the current round number (count of prior `## Nog Review — Round N` headings)
3. Nog runs all review phases (lint, anti-pattern checks, team-standards checks, AC verification, goal-sanity check)
4. Nog finds all ACs satisfied and the goal achieved
5. Nog outputs a PASS verdict with a concise prose reason
6. The orchestrator receives the verdict, appends a `## Nog Review — Round N` block to the slice file with the verdict and reason
7. The orchestrator renames the slice file: `bridge/queue/{id}-IN_REVIEW.md` → `bridge/queue/{id}-ACCEPTED.md`
8. The orchestrator emits three events in sequence: `NOG_PASS`, `ACCEPTED`, `REVIEW_RECEIVED`
9. The Ops Center dashboard reflects the slice as ACCEPTED — eligible for the next merge gate run

## Expected outcomes

- Slice file contains a `## Nog Review — Round N` block with `PASS` verdict and reason
- Register contains `NOG_PASS`, `ACCEPTED`, and `REVIEW_RECEIVED` events with the slice ID and round number
- File suffix changes from `-IN_REVIEW.md` to `-ACCEPTED.md`
- `branch-state.json` dev section records the slice as in the ACCEPTED pool (commits ahead of main increases)
- Merge button in the Branch Topology panel is enabled (user can press it when ready)
- Post-Build panel transitions from "Nog reviewing" to a completed state
- If other slices are in the QUEUED state, the orchestrator picks up the next one in its next poll cycle

## Known failure modes

- **Nog cannot read the diff.** Rom may have deleted the branch or the diff path is malformed. *Recovery:* Verify `slice/{id}-<slug>` exists in the worktree. If the branch is gone, O'Brien must escalate.
- **Nog's verdict is REJECT.** Nog found an unsatisfied AC or goal mismatch. *Recovery:* See J-nog-rejects-slice-round-2.
- **Nog outputs an escalation verdict.** Nog cannot judge the slice (too large, contradictory ACs) or triggers a max-rounds path. *Recovery:* See J-nog-max-rounds-escalation or the orchestrator routes the slice back to O'Brien.
- **Nog process times out.** The diff may be too large or Nog's context window is exhausted. *Recovery:* The orchestrator should detect the hung process via the inactivity timeout and abort. An ERROR event is emitted to the register.

## Sources

- `docs/contracts/slice-pipeline.md` §5 — IN_REVIEW→ACCEPTED transition mechanics and events (NOG_PASS, ACCEPTED, REVIEW_RECEIVED)
- `docs/contracts/slice-lifecycle.md` — ACCEPTED state definition and Nog's role as the approving actor
- `docs/contracts/slice-format.md` — Nog Review block format (`## Nog Review — Round N`)
- `docs/runbooks/RUNBOOK-BASHIR-GATE.md` — gate state after slices accumulate in ACCEPTED pool
- `dashboard/DASHBOARD-REDESIGN-SPEC.md` — Post-Build panel, Active Slice Tracker state

## Open questions

- `docs/architecture/NOG-GATE-ADR.md` is referenced in prior scouting output but does not exist on current main. Nog's five review phases are described in `.claude/roles/nog/ROLE.md` (if it exists) but the ADR itself is absent. Route to Dax to confirm whether the ADR was merged or is forthcoming.
- Does Nog receive prior round reviews when reviewing Round 2+? The pipeline spec describes appended blocks as auditable history, but it's unclear whether Nog's context window includes all prior rounds automatically or whether O'Brien must explicitly include them in the invocation.
- The `REVIEW_RECEIVED` event is emitted alongside `NOG_PASS` and `ACCEPTED` — what consumes `REVIEW_RECEIVED` specifically? Is it for the dashboard's history panel or another legacy event drain?
- After a slice is ACCEPTED, does it appear in a distinct "ACCEPTED" section of the dashboard or just disappear from the active view until the next gate run?
