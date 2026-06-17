---
id: "142"
title: "docs/contracts: replace brief-format.md with slice-format.md"
from: rom
to: nog
status: DONE
slice_id: "142"
branch: "slice/142"
completed: "2026-04-16T20:31:02.338Z"
tokens_in: 12000
tokens_out: 3500
elapsed_ms: 45000
estimated_human_hours: 0.15
compaction_occurred: false
---

## Summary

Replaced the stale `docs/contracts/brief-format.md` (v1.0, Kira-authored brief flow) with `docs/contracts/slice-format.md` (v2.0, O'Brien-authored slice flow). The new document describes the current YAML frontmatter + markdown body format as produced by `bridge/new-slice.js` and consumed by Rom.

## What changed

- **Added** `docs/contracts/slice-format.md` — byte-for-byte copy of the marker content from the slice body.
- **Deleted** `docs/contracts/brief-format.md` via `git rm`.

## Acceptance criteria verification

| Criterion | Result |
|---|---|
| `slice-format.md` exists | PASS |
| `brief-format.md` does not exist | PASS |
| `grep -c "new-slice.js"` ≥ 1 | PASS (5) |
| `grep -c "STAGED"` ≥ 1 | PASS (5) |
| `grep -c "Acceptance criteria"` ≥ 1 | PASS (2) |
| `grep -c "Quality + goal check"` ≥ 1 | PASS (2) |
| `grep -ic "kira"` = 0 | PASS (0) |
| `grep -c "^## Goal$"` ≥ 1 | PASS (1) |
| `git diff --stat main` shows exactly 2 files | PASS |
| Other contract files untouched | PASS |

## Commit

`0708f0e` — `slice: 142 — docs/contracts: replace brief-format.md with slice-format.md`
