---
id: "164"
title: "D3 — Apendment-ID retention + consolidated telemetry + terminology migration"
from: rom
to: nog
status: DONE
slice_id: "164"
branch: "slice/164"
completed: "2026-04-19T03:45:00.000Z"
tokens_in: 185000
tokens_out: 42000
elapsed_ms: 2700000
estimated_human_hours: 6.0
compaction_occurred: false
---

## Summary

Implemented apendment-ID retention: slices now keep their original ID through all Nog review rounds. No new slice IDs are burned on Nog returns. Per-round telemetry is tracked in a `rounds[]` frontmatter array, with slice-level `total_*` fields recomputed after each round. Renamed AMENDMENT → APENDMENT across all production code, contracts, and role specs.

## Changes

### Part 1 — ID retention (`bridge/watcher.js`)
- **`handleNogReturn()`** refactored: no longer calls `nextSliceId()`. Instead reads the PARKED file, updates frontmatter (`status: QUEUED`, `round`, `apendment_cycle`, `apendment`, `branch`), appends `## Apendment round N` section, and writes to `{id}-QUEUED.md` (same ID).
- **`handleApendment()`** (renamed from `handleAmendment`): same treatment — reads PARKED, rewrites in-place, no new ID.
- Register events for round 2+ carry `id: "<parent_id>", round: <N>, apendment_cycle: <N>`.

### Part 2 — Per-round telemetry
- New `appendRoundEntry()` function: appends a YAML entry to the slice file's `rounds:` array with `{ round, commissioned_at, done_at, durationMs, tokensIn, tokensOut, costUsd, nog_verdict, nog_reason }`.
- New `extractRomTelemetry()` function: pulls telemetry from Rom's DONE report frontmatter.
- Called at every Nog verdict site: NOG_PASS, NOG_RETURN, ESCALATE, verdict_unreadable, MAX_ROUNDS_EXHAUSTED.

### Part 3 — Consolidated totals
- After every `rounds[]` append, four slice-level fields are recomputed: `total_durationMs`, `total_tokensIn`, `total_tokensOut`, `total_costUsd`.
- These are denormalized views in frontmatter — no duplicate register events.

### Part 4 — Terminology migration (AMENDMENT → APENDMENT)
- Function: `handleAmendment` → `handleApendment`
- Variable: `isAmendment` → `isApendment`
- Verdict: `AMENDMENT_NEEDED` → `APENDMENT_NEEDED` (evaluator prompt + validation)
- Fields: `amendment` → `apendment`, `amendment_cycle` → `apendment_cycle`
- Back-compat: watcher accepts legacy `amendment`, `AMENDMENT_NEEDED`, `type: amendment` on read. All writes use new spelling.
- Staged scan: accepts both `-NEEDS_APENDMENT.md` and `-NEEDS_AMENDMENT.md`.

### Part 5 — Documentation
- `docs/contracts/slice-pipeline.md`: §10.1 rewritten to document ID retention, `rounds[]` shape, `total_*` fields, and migration note.
- `docs/contracts/slice-format.md`, `docs/contracts/done-report-format.md`: field name updates.
- `docs/architecture/BET2-RELAY-DASHBOARD-ARCHITECTURE.md`: all amendment → apendment.
- `docs/FEATURES.md`: all amendment → apendment, updated protocol description.

### Part 6 — Nog ROLE.md
- Return verdict description updated: "returned to Rom as an APENDMENT"
- Verdicts table: "Requeue slice for Rom (apendment)"

### Tests
- `test/nog-return-round2.test.js`: 13 tests — updated for new scheme, added terminology verification tests.
- `test/apendment-id-retention.test.js`: 10 tests (new) — 5-round ID retention, total_* correctness, MAX_ROUNDS_EXHAUSTED shape, no nextSliceId in handlers, frozen rounds[] entries.
- `test/lifecycle-events.test.js`: 24 tests — terminology update.
- All 47 tests pass. Watcher loads cleanly.

## Acceptance criteria status

1. ✅ Slice keeps original ID on Nog return. `nextSliceId()` removed from Nog-return path.
2. ✅ `rounds[]` array with per-round telemetry + four `total_*` fields.
3. ✅ `MAX_ROUNDS_EXHAUSTED` emits with `id: "<parent>", round: 5`, no round-6 slice.
4. ✅ `ESCALATED_TO_OBRIEN` emits with `id: "<parent>", round: <N>`.
5. ✅ Production code uses `apendment` spelling. Back-compat reads accept legacy.
6. ✅ `grep -n "apendment" bridge/watcher.js` shows rename applied at all sites.
7. ✅ Register lines untouched — append-only preserved.
8. ✅ Watcher reads legacy `type: amendment` / `amendment_cycle` without error.
9. ✅ `node bridge/watcher.js` loads cleanly, exports intact.
10. ✅ New test exercises 5-round run: ID retention, rounds[] integrity, total_* correctness.
11. ✅ `test/nog-return-round2.test.js` passes with updated assertions.
12. ✅ Diff limited to bridge/, test/, docs/contracts/, docs/architecture/, docs/FEATURES.md, .claude/roles/nog/ROLE.md.
