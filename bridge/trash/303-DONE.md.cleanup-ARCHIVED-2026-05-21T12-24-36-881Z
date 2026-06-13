---
id: "303"
title: "Fix non-gate Bashir template anchor path"
from: rom
to: nog
status: DONE
slice_id: "303"
branch: "slice/303-attempt1"
completed: "2026-05-21T12:22:50.317Z"
tokens_in: 8200
tokens_out: 620
elapsed_ms: 15124
estimated_human_hours: 0.05
compaction_occurred: false
---

## Summary

Corrected the stale anchor path in `bridge/templates/bashir-non-gate-prompt.md`.

**Change:** Line 3: `` `roles/bashir/ROLE.md` `` → `` `.claude/roles/bashir/ROLE.md` ``

## Pre-conditions verified

- `git ls-tree -r --name-only HEAD -- roles/bashir/` → empty (old path gone)
- `.claude/roles/bashir/ROLE.md` confirmed present in HEAD

## Acceptance criteria

`grep -n "roles/bashir" bridge/templates/bashir-non-gate-prompt.md` returns only the corrected `.claude/roles/bashir/ROLE.md` line — no bare `roles/bashir/` references remain. ✓

## Files changed

- `bridge/templates/bashir-non-gate-prompt.md` — single-line path correction only; byte-identical otherwise

## Commit

`6af4314` — slice/303 — fix stale anchor path in bashir-non-gate-prompt.md
