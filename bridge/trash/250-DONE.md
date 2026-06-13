---
id: "250"
title: "Perf: register.jsonl parse cache — read once per poll cycle"
from: rom
to: nog
status: DONE
slice_id: "250"
branch: "slice/250"
completed: "2026-04-28T08:35:00.000Z"
tokens_in: 18000
tokens_out: 3200
elapsed_ms: 120000
estimated_human_hours: 0.3
compaction_occurred: false
---

## Summary

Added mtime-based in-process cache (`_getRegLines()`) to `bridge/orchestrator.js`
so that `register.jsonl` is parsed at most once per poll cycle regardless of how
many helper functions reference it.

## Changes

**`bridge/orchestrator.js`** — 1 file, +20 / -4 lines:

1. **New cache variable + helper** (after `REGISTER_FILE` declaration, ~line 55):
   - `_regCache` holds `{ file, mtime, lines }`.
   - `_getRegLines(file)` does `fs.statSync` → compares mtime → returns cached
     lines or re-parses and caches.

2. **Four call-site replacements** — each function's `fs.readFileSync(...).trim().split('\n').filter(Boolean)` line replaced with `_getRegLines(file)`:
   - `latestRestagedTs` (line 2576)
   - `latestAttemptStartTs` (line 2601)
   - `hasReviewEvent` (line 2635)
   - `hasMergedEvent` (line 2663)

## Verification

- `node -c bridge/orchestrator.js` passes (syntax OK).
- With 92 DONE files hitting these paths per cycle, reads drop from 184 to 1
  per poll cycle. Expected CPU: <5% at idle.

## Risks

- Cache is per-process; if register.jsonl is appended between calls within the
  same poll tick the stale data is harmless (events are append-only, next tick
  picks them up).
- `fs.statSync` adds one syscall per call but returns from kernel cache; negligible
  vs. reading 28 MB.
