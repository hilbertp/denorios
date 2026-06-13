---
id: "225"
title: "F-WP2 — Cache buildBridgeData full result (mtime-keyed)"
from: rom
to: nog
status: DONE
slice_id: "225"
branch: "slice/225"
completed: "2026-04-26T13:30:00.000Z"
tokens_in: 35000
tokens_out: 4000
elapsed_ms: 180000
estimated_human_hours: 0.5
compaction_occurred: false
---

## Summary

Wrapped `buildBridgeData()` and `buildCostsData()` with mtime-based result caches in `dashboard/server.js`. On each call, source file mtimes are checked via `fs.statSync().mtimeMs`; if unchanged, the previously computed result is returned immediately, skipping all downstream processing (translateEvent over 29K+ events, map building, sorting, slicing).

## What changed

**`dashboard/server.js`** (+42 LOC):
- Added `_bridgeDataCache` keyed by `{regMtime, hbMtime}` — caches full `buildBridgeData()` result
- Added `_costsDataCache` keyed by `{regMtime, queueMtime, sessMtime}` — caches full `buildCostsData()` result
- Added `_getMtimeMs(filePath)` helper (try/catch wrapper around statSync)
- `/api/bridge` endpoint now calls `getCachedBridgeData()` instead of `buildBridgeData()`
- `/api/costs` endpoint now calls `getCachedCostsData()` instead of `buildCostsData()`
- Exported new functions for testability

**`test/result-cache.test.js`** (new, 213 lines):
- Test A: `getCachedBridgeData` returns same object reference on second call; translateEvent NOT called on cache hit
- Test B: Cache invalidated after register.jsonl write (mtime change)
- Test C: Cache invalidated after heartbeat.json write (mtime change)
- Test D: `getCachedCostsData` returns same object reference on second call
- Test E: Cache invalidated after register.jsonl write for costs

## Acceptance criteria

- AC1 PASS — `buildBridgeData()` cached by register + heartbeat mtimeMs
- AC2 PASS — Cache hit skips translateEvent and all loops (verified via spy call count = 0)
- AC3 PASS — Cache miss only on mtime change
- AC4 PASS — `buildCostsData()` similarly cached (register + queue dir + sessions mtimes)
- AC5 PASS — Test A: same object reference, translateEvent not called
- AC6 PASS — Test B: append to register invalidates cache
- AC7 PASS — 42 LOC in server.js (under 80)
- AC8 PASS — Only `dashboard/server.js` and `test/result-cache.test.js` touched
