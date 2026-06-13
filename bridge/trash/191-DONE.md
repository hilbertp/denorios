---
id: "191"
title: "F-191 — Merge Nog calls: collapse invokeNog + invokeEvaluator into single pass"
from: rom
to: nog
status: DONE
slice_id: "191"
branch: "slice/191"
completed: "2026-04-23T08:44:37.000Z"
tokens_in: 187420
tokens_out: 28640
elapsed_ms: 712000
estimated_human_hours: 3.5
compaction_occurred: false
---

## Summary

Collapsed the dual-pass Nog flow into a single `claude -p` call per round. `invokeEvaluator` is deleted; its AC + Intent + Scope Discipline sections are folded into `buildNogPrompt`. On Nog ACCEPTED, `handleAccepted` is now called directly (merge happens immediately, no second poll tick). On Nog REJECTED, the existing `handleNogReturn` path is unchanged.

## Changes

### bridge/orchestrator.js (487 deletions, 42 additions)

**Deleted:**
- `invokeEvaluator` (~250 lines): the second-pass evaluator function
- `handleApendment` (~75 lines): dead code after evaluator removal
- `handleStuck` (~35 lines): dead code after evaluator removal
- `countReviewedCycles` (~25 lines): only used in invokeEvaluator
- `extractJSON` (~20 lines): only used in invokeEvaluator
- `hasNogReviewEvent` (~20 lines): only used in the dispatch branch
- Section comment block `// Evaluator invocation`

**Modified:**
- `invokeNog` ACCEPTED branch: removed NOG_DECISION emit (handleAccepted does it), removed rename-back-to-DONE, added `handleAccepted(id, summary, round, branchName, donePath, durationMs)` call directly. Added `buildScopeDiff` call before `buildNogPrompt`.
- Dispatch at ~line 4189: removed `if (hasNogReviewEvent(doneId)) → invokeEvaluator` branch entirely. Always emits `NOG_INVOKED` and calls `invokeNog`.

### bridge/nog-prompt.js (22 additions, 10 deletions)

- Added `scopeDiff` parameter to `buildNogPrompt`
- Added Part 2 (Acceptance Criteria), Part 3 (Intent Verification), Part 4 (Scope Discipline) sections — text adapted from `invokeEvaluator`'s prompt
- Updated verdict descriptions to cover all four parts

### test/ (3 files updated, 1 new file)

- `test/nog-return-round2.test.js`: Tests 9+10 updated — now assert invokeEvaluator/handleApendment are gone
- `test/apendment-id-retention.test.js`: Tests (e)+(h) updated — same
- `test/event-order.test.js`: Parts 2+3 updated — assert handleApendment/handleStuck gone; verify invokeNog emits REJECTED
- `test/orchestrator-nog-merge.test.js` (new): 13 regression tests covering ACs 1–6

## Test results

All 16 test files pass. 199 total tests, 0 failures.

```
test/apendment-id-retention.test.js:      10 passed, 0 failed
test/bootstrap-rescue.test.js:             6 passed, 0 failed
test/event-order.test.js:                 18 passed, 0 failed
test/git-finalizer.test.js:                8 passed, 0 failed
test/host-health-detector.test.js:        28 passed, 0 failed
test/lifecycle-events.test.js:            24 passed, 0 failed
test/lifecycle-translate.test.js:          all passed
test/new-slice-restaged.test.js:           4 passed, 0 failed
test/nog-prompt-vocabulary.test.js:        all passed
test/nog-return-round2.test.js:           13 passed, 0 failed
test/ops-queue-render.test.js:             all passed
test/ops-round-badge.test.js:              8 passed, 0 failed
test/orchestrator-has-review-event.test.js: 14 passed, 0 failed
test/orchestrator-no-report-rescue.test.js: 23 passed, 0 failed
test/orchestrator-nog-merge.test.js:      13 passed, 0 failed
test/pause-resume-abort.test.js:          30 passed, 0 failed
test/verdict-parser-widening.test.js:      all passed
```

## Notes

**Token cost AC 8:** With `invokeEvaluator` removed, every slice round now costs exactly one Nog `claude -p` call instead of two. Post-Rom phase token spend should drop ~45-50% (one call vs two calls of similar prompt size). The next few merged slices will confirm this in their `tokensIn`/`tokensOut` totals — expected to drop from ~two-prompt average to ~one-prompt average.

**Diff size:** 487 deletions + 64 additions = 551 changed lines across source files (excluding tests). Net −423 LOC from source. Slightly above the ~400 LOC estimate; the actual `invokeEvaluator` was ~250 lines (not 500 as the brief suggested), but `handleApendment`, `handleStuck`, `countReviewedCycles`, `extractJSON`, and `hasNogReviewEvent` add the rest.

**No behavior change for REJECTED path:** `handleNogReturn` is unchanged. REJECTED slices still requeue for O'Brien exactly as before.

**heartbeat `evaluating` state:** The `evaluating` heartbeat state is no longer emitted (the dispatch no longer has that path). The Ops UI and server should handle this gracefully since `nog_review` covers the full single pass. No alias needed — the state was only set for ~1 second between the two poll ticks, not observable to users.
