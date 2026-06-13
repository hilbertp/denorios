---
id: "237"
title: "F-S5-7 — History cost fallback: render ~$X.XX est. when cost telemetry is missing"
from: rom
to: nog
status: DONE
slice_id: "237"
branch: "slice/237"
completed: "2026-04-27T14:25:00.000Z"
tokens_in: 42000
tokens_out: 4500
elapsed_ms: 180000
estimated_human_hours: 0.5
compaction_occurred: false
---

## Summary

Implemented cost estimation fallback for the History section of the LCARS dashboard. When a slice's `cost` telemetry is null/absent, the cost column now computes and displays an estimate from token counts using standard Claude Sonnet pricing.

## Changes

**Single file changed:** `dashboard/lcars-dashboard.html`

### Added
- **Pricing constants** (`INPUT_COST_PER_M = 3.00`, `OUTPUT_COST_PER_M = 15.00`) as named JS constants
- **`fmtCostWithFallback(costUsd, tokIn, tokOut)`** function implementing the three-way logic:
  - Real cost present → render actual `$X.XX`
  - Cost null, tokens present → render `~$X.XX est.` with `.cost-estimated` class
  - Cost null, tokens missing → render `—` (em dash)
- **`.cost-estimated`** CSS class with muted color (`#9ca3af`)

### Updated call sites (6 total)
1. Main history row cost column
2. Detail panel context bar (with `rawHtml` flag to bypass `escHtml`)
3. Detail totals bar
4. Per-round breakdown (rounds[] data)
5. Per-round breakdown (legacy children)
6. Single-round fallback

## Acceptance criteria

- [x] AC1 — Null cost + valid tokens → `~$X.XX est.`
- [x] AC2 — Real cost → actual figure unchanged
- [x] AC3 — Null cost + zero/missing tokens → `—`
- [x] AC4 — Estimated cost has `.cost-estimated` class with muted color
- [x] AC5 — Real cost does NOT have `.cost-estimated` class
- [x] AC6 — Pricing constants are named constants (`INPUT_COST_PER_M`, `OUTPUT_COST_PER_M`)
- [x] AC7 — No changes outside `dashboard/lcars-dashboard.html`
- [x] AC8 — Built on slice/236 branch
