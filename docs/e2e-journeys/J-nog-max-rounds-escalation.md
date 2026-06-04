---
id: J-nog-max-rounds-escalation
category: review-verdict
status: draft
last_reviewed: 2026-05-21
---

# Nog exhausts the round cap and escalates to O'Brien

## What the user is trying to accomplish

After five failed rework rounds, the slice's round cap is exhausted. On Nog's sixth review — finding the slice still failing — the watcher routes the slice back to O'Brien (not back to Rom) so that O'Brien can address the root cause: unclear ACs, an over-scoped slice, or a goal that cannot be achieved as written.

## Preconditions

- A slice has been through exactly 5 complete Nog review rounds, all with REJECT verdicts
- The slice file contains 5 `## Nog Review — Round N` blocks (N = 1 through 5)
- Nog has been invoked for Round 6 with the full slice history
- The round counter (count of `## Nog Review` headings) = 5 before this invocation

## Steps

1. The orchestrator's round counter detects 5 prior Nog rejection blocks in the slice file
2. On Nog's Round 6 review, Nog appends a `## Nog Review — Round 6` block with the rejection reason and specifically notes the round cap is exhausted
3. The watcher recognizes the round cap (count now = 6, per the ≥ 6 rule in `slice-pipeline.md` §9)
4. Instead of routing the slice back to QUEUED for another Rom pickup, the watcher routes the slice to `bridge/staged/{id}-STAGED.md`
5. O'Brien reads the full slice file — the original goal, all 5 prior rounds of Nog/Rom back-and-forth, and the latest Nog rejection
6. O'Brien diagnoses the root cause:
   - If the ACs were unclear or contradictory, O'Brien rewrites them
   - If the slice was too large, O'Brien splits it
   - If the goal was wrong or unachievable, O'Brien rewrites the goal
7. O'Brien restages the slice (now with corrected body) by moving it back to the STAGED state for Philipp's re-approval

## Expected outcomes

- Slice file in `bridge/staged/{id}-STAGED.md` with 6 Nog review blocks appended (all REJECT)
- Watcher does NOT route to QUEUED for another Rom round
- Register contains an escalation event (exact event name TBD — see Open questions)
- O'Brien's reworked slice is re-submitted to `bridge/staged/` as a fresh or amended version
- Philipp sees the reworked slice in the staged section and re-approves it before it re-enters the queue
- The round counter for the next dispatch starts fresh (the reworked body may or may not retain the prior history)

## Known failure modes

- **O'Brien does not address the root cause.** O'Brien may only make superficial changes to the ACs without fixing the underlying problem. *Recovery:* Rom or Nog will flag the issue again in the next cycle. The round cap applies to each dispatch cycle; if O'Brien restages without meaningful changes, the pattern repeats.
- **O'Brien misidentifies the root cause.** O'Brien may rewrite ACs that were actually fine, when the real problem was an implementation gap that Rom failed to close. *Recovery:* This requires a human review of the full round history. O'Brien should read all prior Nog review blocks carefully before deciding on a root cause.
- **Watcher route to staged/ fails.** The `bridge/staged/` directory may be write-protected or full. *Recovery:* Check file permissions. Check disk space. Manual rename from `bridge/queue/{id}-IN_REVIEW.md` to `bridge/staged/{id}-STAGED.md`.

## Sources

- `docs/contracts/slice-pipeline.md` §9 — round counter derivation, the 5-round cap, 6th-rejection routing to O'Brien via `bridge/staged/`
- `docs/contracts/slice-lifecycle.md` — IN_REVIEW→STAGED (via O'Brien) transition after 6th rejection; O'Brien's role in rework; invariant #8 (escalation is automatic, not optional)
- `docs/contracts/slice-format.md` — append-only discipline; all 6 round blocks remain visible in the file

## Open questions

- What register event is emitted when the round cap is exhausted and the slice routes to O'Brien? The pipeline spec describes the routing but does not specify the event name (candidates: `MAX_ROUNDS_EXHAUSTED`, `ESCALATED_TO_OBRIEN`, `NOG_ESCALATION`).
- Does the watcher send a `NOG_ESCALATION` event to `bridge/kira-events.jsonl` on round-cap exhaustion? The Kira Activation ADR lists `NOG_ESCALATION` as a kira-event type; the pipeline spec does not reference kira-events. Route to Dax/Worf to confirm.
- Does the dashboard surface the max-rounds-escalation state visually to Philipp? The Queue panel would show the slice in the staged section, but is there a badge or warning indicating why it returned to staged rather than being newly authored?
- After O'Brien reworks the slice and restages it, does it retain its original ID or does O'Brien create a new slice with a new ID? The pipeline spec does not specify this.
- If O'Brien determines that the slice cannot be fixed and should be abandoned, is there a "reject/kill" action available on staged slices?
