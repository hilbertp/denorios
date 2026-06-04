---
id: J-nog-rejects-slice-round-2
category: review-verdict
status: draft
last_reviewed: 2026-05-21
---

# Nog rejects a slice and Rom reworks it (Round 2)

## What the user is trying to accomplish

Nog finds unsatisfied acceptance criteria or goal misalignment, appends a rejection verdict with specific findings, and the slice returns to Rom for rework. Rom picks it up again, reads Nog's feedback, and commits fixes on the same branch. This cycle repeats up to 5 times before escalation.

## Preconditions

- A slice is in IN_REVIEW state (Rom just completed Round 1 or a prior round)
- The slice body contains a valid Rom DONE Report but one or more ACs are unmet or the goal is not achieved
- Nog has been invoked and reviewed the slice (all five phases)
- The round counter is below the cap (fewer than 5 prior Nog rejection blocks in the file)

## Steps

1. Nog runs all five review phases as in J-nog-accepts-slice
2. Nog finds Phase 4 (AC check) fails: at least one AC is not satisfied by the current state of the diff
3. Nog outputs a REJECT verdict with detailed findings (specific ACs not met, why, what's missing)
4. The orchestrator appends a `## Nog Review — Round N` block with the rejection verdict and reason
5. The orchestrator renames the slice file: `bridge/queue/{id}-IN_REVIEW.md` → `bridge/queue/{id}-QUEUED.md`
6. The orchestrator emits `REVIEWED` and `REVIEW_RECEIVED` events
7. The orchestrator's next poll cycle picks up the QUEUED slice again and spawns Rom with the full slice file (including all prior appended blocks)
8. Rom reads the slice file from top to bottom — the original goal, prior DONE reports, prior Nog reviews — and understands the feedback
9. Rom commits additional fixes on the same `slice/{id}-<slug>` branch, addressing the failed ACs
10. Rom appends a new `## Rom DONE Report — Round 2` block documenting the fixes
11. The orchestrator detects DONE and advances to IN_REVIEW again; the cycle repeats

## Expected outcomes

- Slice file contains appended blocks in order: `## Nog Review — Round 1` (REJECT) + `## Rom DONE Report — Round 2`
- The round counter (number of `## Nog Review` headings) is now 1; the next Nog invocation will be Round 2
- Register contains events: `REVIEWED` + `REVIEW_RECEIVED` for the rejection, then `DONE` for Rom's Round 2
- Dashboard reflects the slice returning to an "in progress" or "queued" state (exact visual depends on implementation)
- Rom's branch has new commits on top of the prior Round 1 work
- No files are deleted or rewritten; the slice file is append-only throughout all rounds

## Known failure modes

- **Nog verdict is unclear or contradictory.** Rom may not understand what to fix. *Recovery:* The reason field should be specific AC citations; if it is not, O'Brien should clarify the slice ACs before the next round. Escalate the ambiguity as an open question.
- **Rom makes changes that do not address the feedback.** Nog may reject again for the same reason. *Recovery:* This results in Round 3. If the cycle repeats 5+ times, it escalates to O'Brien (see J-nog-max-rounds-escalation).
- **Round counter is not derived correctly.** The watcher counts `## Nog Review — Round N` headings. If the file is malformed or the heading does not match exactly, the counter may be off. *Recovery:* Manual inspection of the slice file; count blocks by hand and verify the next round number before the next Nog invocation.
- **Orchestrator picks up the wrong QUEUED slice next.** If multiple QUEUED slices exist, the orchestrator dispatches in priority order per `queue-order.json`. The previously-rejected slice may not be next. *Recovery:* This is expected — other slices can proceed. The rejected slice will be picked up in order.

## Sources

- `docs/contracts/slice-pipeline.md` §5, §9 — IN_REVIEW→QUEUED rejection mechanics, round counter derivation (count of `## Nog Review — Round N` headings), 5-round cap
- `docs/contracts/slice-lifecycle.md` — rejection flow, append-only discipline, 5-round cap and O'Brien escalation
- `docs/contracts/slice-format.md` — Nog Review block format, Rom DONE Report block format; append-only invariant
- `dashboard/DASHBOARD-REDESIGN-SPEC.md` — Active Slice Tracker: apendment-cycle loopback visualization

## Open questions

- `docs/architecture/NOG-GATE-ADR.md` does not exist on current main. Nog's Phase 4 (AC check) logic is referenced in prior scouting output but has no canonical ADR source. Route to Dax.
- When Rom reads Nog's review block on pickup, is it the full appended block or a parsed/excerpted summary? If the slice file grows very large (5 rounds × 2 blocks per round + original body), is there a context-window concern for Rom's invocation?
- Does the round counter reflect "which round was just completed" or "which round we're about to start"? This indexing question matters for how `## Nog Review — Round N` headings are generated.
- Does the Ops dashboard show a round counter or "rejected — rework" badge anywhere? The Ziyal spec mentions an apendment cycle loopback visualization, but it's unclear if this is implemented for Nog rejections specifically or only for the older "apendment" concept.
- If Rom makes no code changes and just re-appends a DONE report for Round 2 with no new commits, will Nog immediately reject again? Should the orchestrator warn Rom if the branch has no new commits since the last DONE?
