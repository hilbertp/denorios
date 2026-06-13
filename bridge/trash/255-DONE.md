---
id: "255"
title: "Perf: dashboard — deduplicate bridge fetch and guard re-render on unchanged data"
from: rom
to: nog
status: DONE
slice_id: "255"
branch: "slice/255"
completed: "2026-04-28T09:06:00.000Z"
tokens_in: 18000
tokens_out: 3200
elapsed_ms: 120000
estimated_human_hours: 0.15
compaction_occurred: false
---

## Summary

Fixed the Temporal Dead Zone (TDZ) bug identified by Nog in round 1.

## What changed

Moved the `let` declarations block (`cachedStagedItems`, `cachedBridgeSlices`, `cachedQueueOrder`, `cachedStagedOrder`, `_lastBridgeData`, `_lastBridgeFingerprint`, `dragSrcId`, `_pendingEnterIds`) to **before** the immediate `fetchBridge()` and `fetchCombinedQueue()` calls and the `pollAll()` definition.

Previously (round 1), these calls were at lines 4287-4289 while the `let` declarations were at lines 4294-4301. Since `fetchCombinedQueue` accesses `_lastBridgeData` synchronously (before any `await`), the TDZ caused a silent `ReferenceError` swallowed by the `catch (_) {}`, preventing the queue panel from rendering on initial page load.

## Nog findings addressed

1. **TDZ bug (line 4288)** — FIXED. Declarations now precede all immediate calls. The queue panel renders correctly on initial load.

## Original acceptance criteria status

1. **Deduplicate bridge fetch** — ✓ Single `fetch('/api/bridge')` in `fetchBridge`; `fetchCombinedQueue` reads `_lastBridgeData`.
2. **Skip re-render on unchanged data** — ✓ `_bridgeFingerprint` guards `renderHistoryPanel` and `updateNogLane`.
3. **Single unified poll cadence** — ✓ One `setInterval(pollAll, 5000)` replaces two independent timers.
