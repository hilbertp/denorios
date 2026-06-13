---
id: J-slice-broken-fast-path
category: dispatch-execution
status: draft
last_reviewed: 2026-05-21
---

# Rom judges the slice broken and escalates to O'Brien

## What the user is trying to accomplish

During a rework round, Rom concludes that the acceptance criteria or goal of the slice are inherently wrong or contradictory — not that his implementation is flawed. Rom escalates to O'Brien directly, bypassing Nog, so that O'Brien can rework the slice spec before any further implementation is attempted.

## Preconditions

- A slice is in QUEUED state (a rework pickup, not the first round — though the fast path can technically fire on Round 1 if the ACs are immediately recognized as broken)
- Rom has been spawned in a worktree and has read the slice, including all prior round history (prior Nog review blocks and any prior DONE reports)
- Rom determines that the ACs or goal cannot be satisfied as written — not because of an implementation gap, but because the spec itself is broken

## Steps

1. Rom reads the slice body, prior round history, and Nog's feedback
2. Rom judges that the ACs or goal are wrong (e.g., AC requires a state transition that is architecturally impossible, or two ACs contradict each other)
3. Rom appends a block with the exact heading `## Rom Escalation — Slice Broken` to the slice file
4. Under that heading, Rom writes: which AC(s) or goal elements are wrong (cited verbatim), why they are wrong, and what O'Brien should reconsider
5. Rom does NOT write any code changes to the branch during this pickup
6. Rom signals completion with the escalation block present
7. The watcher detects the `## Rom Escalation — Slice Broken` heading in Rom's output — this triggers the fast path
8. Instead of routing the slice to IN_REVIEW (Nog), the watcher routes the slice back to `bridge/staged/{id}-STAGED.md`
9. O'Brien receives the staged slice and reads the full file history including the escalation block

## Expected outcomes

- Slice file contains `## Rom Escalation — Slice Broken` block with the specific problematic ACs/goal cited verbatim and a clear explanation
- The watcher does NOT advance to IN_REVIEW; no Nog invocation occurs for this pickup
- Slice file is renamed to `bridge/staged/{id}-STAGED.md` (routed back to O'Brien)
- The round counter is NOT incremented (escalation does not count as a Nog review round per `docs/contracts/slice-pipeline.md` §9)
- Register contains an escalation event (exact event name not confirmed — see Open questions)
- O'Brien reads the full slice history and decides whether to rewrite the ACs, split the slice, or push back on Rom's assessment

## Known failure modes

- **Watcher does not recognize the escalation heading.** If the heading differs even slightly from the exact string `## Rom Escalation — Slice Broken`, the fast path is not triggered and the slice advances to Nog normally. *Recovery:* Nog will receive a slice with contradictory ACs; Nog may surface the issue in the review verdict. O'Brien must manually rework the slice.
- **O'Brien disagrees with Rom's assessment.** The spec may not actually be broken; Rom may have misread it. *Recovery:* O'Brien restages the slice with a written counter-argument at the bottom of the body. Rom picks it up again for Round 2.
- **Fast path fires on Round 1 before anything was tried.** Rom may be too quick to judge ACs broken without attempting implementation. *Recovery:* This is a judgment call; O'Brien should scrutinize the escalation reason carefully. If Rom's escalation is not well-reasoned, the slice should be restaged with clarified ACs and an explicit note that Round 2 requires implementation, not re-escalation.

## Sources

- `docs/contracts/slice-pipeline.md` §10 — Rom slice-broken fast path: the exact heading, the watcher recognition pattern, and round-counter exemption
- `docs/contracts/slice-lifecycle.md` — IN_REVIEW→STAGED fast path via O'Brien escalation
- `docs/contracts/slice-format.md` — append-only discipline; escalation block appended after prior content

## Open questions

- What register event is emitted when the fast path fires? The pipeline spec describes the escalation heading and watcher routing but does not specify the event name. Is it `ESCALATED`, `SLICE_BROKEN`, or something else?
- Does the Ops dashboard surface the escalation state visually? The staged section in the Queue panel shows the slice to O'Brien, but is there a badge or label indicating "escalated by Rom" vs "newly staged by O'Brien"?
- Can the fast path be triggered on a fresh Round 1 pickup (first time the slice is dispatched), or only on a rework pickup? The spec does not explicitly restrict it to rework rounds.
- Does the watcher send any legacy escalation signal outside `bridge/register.jsonl` when the fast path fires? Current user-facing routing should go to O'Brien.
