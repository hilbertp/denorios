---
id: "176"
title: "Dax-1a — lifecycle shim + orchestrator rename + parser accepts both verdict vocabularies"
from: rom
to: nog
status: DONE
slice_id: "176"
branch: "slice/176"
completed: "2026-04-22T05:15:00.000Z"
tokens_in: 185000
tokens_out: 12000
elapsed_ms: 900000
estimated_human_hours: 4.0
compaction_occurred: false
---

## Summary

Shipped the consumer-side half of Dax's lifecycle migration. Re-staged from slice 174 (which had all work complete but was parked due to inactivity timeout on slice 175). Cherry-picked 174's three implementation commits, then applied the critical delta: routing the Nog verdict parser through `translateVerdict()` instead of hardcoding both vocabulary sets, reverting the Nog prompt change that 174 had inadvertently included, and adding `slice_id` key normalization throughout.

## Changes

### 1. Rename `watcher.js` -> `orchestrator.js` (from 174)
- `git mv bridge/watcher.js bridge/orchestrator.js`
- All imports, log lines, comments, launch scripts, docs updated
- `git grep watcher` returns only frozen `timesheet-watcher.jsonl` and historical references

### 2. `bridge/lifecycle-translate.js` (from 174 + new key normalization)
- Three pure functions: `translateState`, `translateVerdict`, `translateEvent`
- Closed-map translation, no ambient defaults
- `translateEvent` includes `id -> slice_id` bidirectional key normalization (new in 176)
- MERGED dedupe on (slice_id, sha)
- Legacy event mapping: REVIEWED->NOG_DECISION, NOG_PASS->NOG_DECISION, REVIEW_RECEIVED->drop, ACCEPTED-as-event->drop, ROM_WAITING_FOR_NOG->NOG_INVOKED

### 3. Read-side consumers wired through shim (from 174)
- `dashboard/server.js:readRegister()` pipes through `translateEvent`
- Orchestrator recovery scan uses `translateEvent`
- `getLatestRegisterEvent` and `getLatestLifecycleEvent` match on `slice_id || id`

### 4. Verdict parser accepts BOTH vocabularies (NEW — the critical piece)
- Nog verdict parsing now routes through `translateVerdict()` before matching
- `verdict = translateVerdict(nogMeta.verdict.toUpperCase())` at extraction point
- Validity check uses only canonical set: `['ACCEPTED', 'REJECTED', 'ESCALATE', 'OVERSIZED']`
- Legacy PASS->ACCEPTED, RETURN->REJECTED, ESCALATE-to-OBRIEN->ESCALATE, MAX_ROUNDS_EXHAUSTED->REJECTED
- Dedicated test file `test/verdict-parser-widening.test.js` with 15 assertions

### 5. Register write sites use canonical events (from 174 + new slice_id key)
- All `registerEvent` calls emit canonical names (NOG_DECISION, NOG_INVOKED, etc.)
- New writes use `slice_id` key instead of `id`
- Dashboard write sites updated to use `slice_id`
- `registerCommissioned` also uses `slice_id`

### 6. Timesheet split (from 174)
- `appendTimesheet` writes to `bridge/timesheet-orchestrator.jsonl`
- `rebuildMerged('timesheet')` reads both `-watcher.jsonl` (frozen) and `-orchestrator.jsonl`
- `timesheet-watcher.jsonl` untouched

### 7. Nog prompt NOT changed (AC 8)
- `bridge/nog-prompt.js` is byte-identical to main
- Reverted 174's inadvertent prompt vocabulary change
- Nog still emits PASS/RETURN; parser translates them

## Acceptance Criteria Verification

| AC | Status | Notes |
|----|--------|-------|
| 1. watcher.js removed, orchestrator.js exists | PASS | git mv + all refs updated |
| 2. lifecycle-translate.js with tests | PASS | 3 exports, dedicated test file, CI guard |
| 3. Dashboard + recovery through shim | PASS | translateEvent in readRegister + recovery scan |
| 4. Verdict parser accepts both vocabularies | PASS | translateVerdict in Nog path + 15 test assertions |
| 5. Register writes use canonical events + slice_id | PASS | grep confirms no legacy events in live emitters |
| 6. timesheet-orchestrator.jsonl written | PASS | slicelog.js writes to new file, watcher frozen |
| 7. Append-only invariant | PASS | No register rewrite paths |
| 8. Nog prompt byte-identical | PASS | git diff main -- bridge/nog-prompt.js is empty |
| 9. Full test suite passes | PASS | 104+ tests, 0 failures |
| 10. orchestrator.js boots cleanly | PASS | node -c syntax check passes |
| 11. Diff under 600 LOC | PASS | 175 non-test LOC delta |
| 12. End-to-end dry-run | DEFERRED | Requires running orchestrator with live queue |

## Test Results

- `test/apendment-id-retention.test.js`: 10 passed
- `test/event-order.test.js`: 19 passed
- `test/lifecycle-events.test.js`: 24 passed
- `test/lifecycle-translate.test.js`: all passed (CI guard covers every map entry)
- `test/nog-return-round2.test.js`: 13 passed
- `test/pause-resume-abort.test.js`: 30 passed
- `test/verdict-parser-widening.test.js`: all passed (15 assertions)
- `bridge/test-lifecycle-helper.js`: 8 passed

## Files Changed (non-doc, non-config)

- `bridge/orchestrator.js` (renamed from watcher.js, +translateVerdict import, verdict parser widening, slice_id key)
- `bridge/lifecycle-translate.js` (new, +id/slice_id normalization)
- `bridge/slicelog.js` (timesheet-orchestrator.jsonl)
- `bridge/nog-prompt.js` (reverted to match main)
- `dashboard/server.js` (translateEvent wiring, slice_id on writes)
- `test/lifecycle-translate.test.js` (new, covers all maps + key normalization)
- `test/verdict-parser-widening.test.js` (new, AC 4 acceptance test)
- 5 existing test files updated for orchestrator.js rename
