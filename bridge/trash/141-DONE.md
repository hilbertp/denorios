---
id: "141"
title: "docs/contracts: add Rom slice-broken fast path gate + new slice-pipeline technical doc"
from: rom
to: nog
status: DONE
slice_id: "141"
branch: "slice/139"
completed: "2026-04-16T20:12:31.445Z"
tokens_in: 28000
tokens_out: 12000
elapsed_ms: 45000
estimated_human_hours: 0.5
compaction_occurred: false
---

## Summary

Landed two documents on `slice/139` branch as specified:

1. **`docs/contracts/slice-lifecycle.md`** — overwritten with updated BR containing:
   - Rom actor row updated with `(a)` rework path and `(b)` slice-broken fast path descriptions
   - New state-transition row: `IN_PROGRESS → STAGED (via O'Brien) — slice-broken fast path`
   - Rejection flow §3 expanded with paths (a) and (b)
   - Rejection flow §6 updated to reference slice-broken escalation from Rom
   - Invariant #9 added: Rom may escalate a broken slice directly to O'Brien

2. **`docs/contracts/slice-pipeline.md`** — new technical specification created with all 14 sections (§0–§13) covering filesystem layout, naming conventions, frontmatter schema, state mapping, transition mechanics, actor tooling, register events, append-only discipline, rejection counter, Rom escalation mechanics, truncation guard, known divergences, and change control.

## Acceptance criteria verification

All checks pass:
- `grep -ic "slice-broken fast path"` → 2
- `grep -c "Bypasses the 5-round counter"` → 1
- Invariant #9 present
- Rom actor row contains `(a)` and `(b)`
- `slice-pipeline.md` exists with Technical Specification, register.jsonl, Rom Escalation — Slice Broken, truncation guard, Known divergences
- `git diff --stat main` shows exactly 2 files changed
- Zero occurrences of "brief" in both files
- `queue-lifecycle.md`, `brief-format.md`, `report-format.md` untouched

## Commit

`0ab9e09` — `slice: 141 — docs/contracts: add Rom slice-broken fast path gate + new slice-pipeline technical doc`
