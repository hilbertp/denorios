---
id: "092"
title: "Kira drain — watcher event emitter"
from: obrien
to: kira
status: DONE
slice_id: "092"
branch: "slice/092-kira-drain-emitter"
completed: "2026-04-16T03:20:00.000Z"
tokens_in: 42000
tokens_out: 8500
elapsed_ms: 180000
estimated_human_hours: 1.0
compaction_occurred: false
---

## Summary

Built the watcher-side event emitter for Kira's self-activation system per ADR Component 1.

## What was done

1. **Created `bridge/kira-events.js`** — `appendKiraEvent()` utility that appends structured JSON lines to `bridge/kira-events.jsonl`. Never throws (same pattern as `appendTimesheet`).

2. **Wired `STUCK` event** in `handleStuck()` — appends after the register event and file rename.

3. **Wired `ERROR` event** at all 5 error paths in `watcher.js`:
   - Branch creation failure (worktree setup)
   - Incomplete metrics in DONE report
   - No report written (exit 0, no DONE file)
   - Crash/timeout/inactivity kill
   - Invalid slice (missing frontmatter fields)

4. **Wired `ALL_COMPLETE` event** in the poll loop — fires once when `sessionHasProcessed` is true, no PENDING files remain, and no IN_PROGRESS files exist. Resets the flag so it only fires once per completion wave.

5. **Created directories** `bridge/kira-escalations/` and `bridge/demo-summaries/` with `.gitkeep` files.

6. **Added `bridge/kira-events.jsonl` to `.gitignore`** — runtime file, not tracked.

## Files changed

- `bridge/kira-events.js` (new) — event emitter module
- `bridge/watcher.js` — require + 7 appendKiraEvent calls (1 STUCK, 5 ERROR, 1 ALL_COMPLETE)
- `.gitignore` — added kira-events.jsonl exclusion
- `bridge/kira-escalations/.gitkeep` (new)
- `bridge/demo-summaries/.gitkeep` (new)

## What was NOT done (by design)

- `NOG_ESCALATION` event — deferred to slice 093
- Event drain (Cowork scheduled task) — not O'Brien's scope
- Wrap-up directive consolidation — not O'Brien's scope
