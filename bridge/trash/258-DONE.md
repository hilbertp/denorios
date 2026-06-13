---
id: "258"
title: "F-W-Bash-A — bridge/state/ directory + atomic-write helper + branch-state.json recovery scan"
from: rom
to: nog
status: DONE
slice_id: "258"
branch: "slice/258"
completed: "2026-04-28T17:45:00.000Z"
tokens_in: 42000
tokens_out: 8500
elapsed_ms: 480000
estimated_human_hours: 2.0
compaction_occurred: false
---

## Summary

Laid the foundation for Bashir-gate persistent state: created `bridge/state/` directory with atomic-write helper, initial branch-state schema, and a startup recovery scan wired into the orchestrator.

## What was delivered

### 1. `bridge/state/` directory + `.gitkeep`
Directory tracked in git, ready for state files.

### 2. `bridge/state/atomic-write.js`
Exports `writeJsonAtomic(filePath, content)` — writes to `.tmp` then `fs.renameSync`. Pretty-prints JSON with 2-space indent. On failure, destination file is left untouched and the error is re-thrown.

### 3. `bridge/state/initial-schema.js`
Exports `createInitialBranchState()` returning the ADR §8 schema: `schema_version: 1`, `main/dev/last_merge` branch sections, and `gate` section starting at `IDLE`.

### 4. `bridge/state/branch-state.json`
Initial file with the schema from §Scope item 3. All branch fields null/empty, gate at IDLE.

### 5. `bridge/state/branch-state-recovery.js`
Exports `reconcileBranchState({ registerEvent, log, runGit })`:
- **Missing file**: writes initial schema, emits `BRANCH_STATE_INITIALIZED`.
- **Present + parseable**: re-derives `main`, `dev`, `last_merge` from git. Preserves `gate` section and `deferred_slices`. Writes atomically.
- **Corrupt file**: logs warning, emits `BRANCH_STATE_RESET_FROM_CORRUPT` with corrupt content truncated to 1KB, writes fresh schema with gate at IDLE.

### 6. Orchestrator wiring
`reconcileBranchState` is required and called in startup sequence after `restagedBootstrap()`. Also exported from `module.exports` for downstream consumption.

### 7. Register events
- `BRANCH_STATE_INITIALIZED` — emitted when file is created from scratch.
- `BRANCH_STATE_RESET_FROM_CORRUPT` — emitted when corrupt file is replaced, includes `corrupt_content` (truncated to 1KB).

## Tests

- `test/state-atomic-write.test.js` — 3 tests: happy path, failure (unwritable dir), failure (no partial artifacts).
- `test/state-branch-recovery.test.js` — 5 tests: absent file, present+parseable with gate preservation, corrupt file, 1KB truncation, idempotency.

All 8 tests pass.

## Acceptance criteria

| AC | Status |
|----|--------|
| AC0. Skeleton DONE first commit | DONE |
| AC1. `bridge/state/` tracked via `.gitkeep` | DONE |
| AC2. `writeJsonAtomic` exported with temp+rename | DONE |
| AC3. Atomic on success, non-destructive on failure | DONE |
| AC4. Initial `branch-state.json` with correct schema | DONE |
| AC5. `reconcileBranchState()` runs at startup, re-derives branch from git | DONE |
| AC6. Missing file → initial schema + `BRANCH_STATE_INITIALIZED` | DONE |
| AC7. Corrupt file → fresh schema + `BRANCH_STATE_RESET_FROM_CORRUPT` with truncated content | DONE |
| AC8. Idempotent across restarts | DONE |
| AC9. Both `writeJsonAtomic` and `reconcileBranchState` exported | DONE |
| AC10. 8 regression tests covering all 5 scenarios | DONE |
| AC11. ~172 LOC excluding tests (well under 300) | DONE |
| AC12. Changes limited to `bridge/state/`, `bridge/orchestrator.js`, and test files | DONE |

## Files changed

- `bridge/state/.gitkeep` (new)
- `bridge/state/atomic-write.js` (new, 25 lines)
- `bridge/state/initial-schema.js` (new, 23 lines)
- `bridge/state/branch-state-recovery.js` (new, 108 lines)
- `bridge/state/branch-state.json` (new, 13 lines)
- `bridge/orchestrator.js` (+3 lines: require, startup call, export)
- `test/state-atomic-write.test.js` (new, 103 lines)
- `test/state-branch-recovery.test.js` (new, 271 lines)
