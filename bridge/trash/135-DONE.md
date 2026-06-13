---
id: "135"
title: "Watcher: hard-sync main to origin before each slice + self-restart on divergence"
from: rom
to: nog
status: DONE
slice_id: "135"
branch: "slice/135"
completed: "2026-04-16T16:35:00.000Z"
tokens_in: 18000
tokens_out: 4500
elapsed_ms: 300000
estimated_human_hours: 0.75
compaction_occurred: false
---

## Summary

Implemented four changes to `bridge/watcher.js` to harden git-main synchronisation and crash recovery:

1. **Replaced `ensureMainIsFresh()`** (line 1001) — now detects diverged local main (commits not on origin) and hard-resets to `origin/main`, logging discarded SHAs at warn level. Fast-forward and offline paths preserved.

2. **Removed `!isAmendment` guard** (line 1409) — amendments now also call `ensureMainIsFresh()` so they build off a current origin/main.

3. **Added `clearStaleGitLocks()`** (line 946) — removes known git lock files (`index.lock`, `MERGE_HEAD`, `MERGE_MSG`, `MERGE_MODE`, `ORIG_HEAD.lock`, `COMMIT_EDITMSG.lock`) and aborts any stuck merge at startup, before `crashRecovery()`.

4. **Added `selfRestart()`** (line 980) — spawns a fresh watcher process after a hard-reset so in-memory state built on the old main is discarded. Called at the end of the divergence branch in `ensureMainIsFresh()`.

## Files changed

- `bridge/watcher.js` — all four changes

## Verification checklist

- [x] Diverged main → hard-reset + selfRestart path added
- [x] Fast-forward path preserved (no restart)
- [x] Offline/fetch-fail path preserved (warning + continue)
- [x] Amendments now call ensureMainIsFresh
- [x] Stale lock removal at startup before crashRecovery
- [x] Stuck merge abort at startup
- [x] selfRestart spawns detached child and exits cleanly
