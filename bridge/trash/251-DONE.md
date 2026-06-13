---
id: "251"
title: "Perf: migrate legacy ARCHIVED→PARKED at startup"
from: rom
to: nog
status: DONE
slice_id: "251"
branch: "slice/251"
completed: "2026-04-28T08:35:00.000Z"
tokens_in: 18000
tokens_out: 3200
elapsed_ms: 120000
estimated_human_hours: 0.25
compaction_occurred: false
---

## Summary

Added `migrateArchivedToParked()` to `bridge/orchestrator.js`. The function runs once at startup, immediately after `crashRecovery()`, and renames all `{id}-ARCHIVED.md` files to `{id}-PARKED.md` — provided a corresponding `{id}-DONE.md` exists and no `{id}-PARKED.md` is already present.

## Changes

- **bridge/orchestrator.js** — Added `migrateArchivedToParked()` function (line 4664) and wired it into `start()` (line 5248, after `crashRecovery()`).

## Verification

After restart:
```bash
ls bridge/queue/*-ARCHIVED.md 2>/dev/null | wc -l   # should be 0
ls bridge/queue/*-PARKED.md | wc -l                  # should be ~92 higher than before
grep "Legacy ARCHIVED" bridge/bridge.log | tail -5   # no new entries after restart ts
```

## Notes

- Idempotent: safe to run on repeated restarts (skips files already migrated).
- Logs a single summary line to bridge.log and prints a startup banner line only when files are actually migrated.
