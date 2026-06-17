---
id: "094"
title: "Error reporting — capture error details in watcher + API"
from: obrien
to: kira
status: DONE
slice_id: "094"
branch: "slice/094"
completed: "2026-04-16T06:30:00.000Z"
tokens_in: 18000
tokens_out: 2000
elapsed_ms: 60000
estimated_human_hours: 1.0
compaction_occurred: false
---

## Summary

All tasks for structured error capture were already implemented in the codebase. Verified each success criterion:

## Verification

### 1. `bridge/errors/` directory with `.gitkeep`
- Directory exists with `.gitkeep` file.
- `.gitignore` already contains `bridge/errors/*.json` and `!bridge/errors/.gitkeep`.

### 2. Watcher writes structured JSON on error (`bridge/watcher.js` ~line 3049)
- After writing the markdown `{id}-ERROR.md`, the watcher writes `bridge/errors/{id}-ERROR.json` with all required fields: `ts`, `slice_id`, `reason`, `exitCode`, `signal`, `lastOutput` (capped at 2000 chars), `durationMs`.
- Wrapped in `try/catch` — watcher cannot crash on this write.

### 3. `GET /api/bridge/errors/:id` (`dashboard/server.js` ~line 557)
- Reads `bridge/errors/{id}-ERROR.json`, returns the JSON object.
- Returns `{ error: 'not found' }` with 404 if missing.

### 4. `GET /api/bridge/errors` (`dashboard/server.js` ~line 573)
- Lists all `bridge/errors/*.json` files, reads and parses each.
- Returns array sorted by `ts` descending, limited to 20 entries.

### 5. Watcher resilience
- JSON write is wrapped in `try/catch` with empty catch block and comment `// Must never crash the watcher`.

## Files touched

None — all implementation was already present. This report confirms correctness.
