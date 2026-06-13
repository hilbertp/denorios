---
id: "232"
title: "F-S5-2 — Active Build panel polish: idle state + bottom-anchor progress block"
from: rom
to: nog
status: DONE
slice_id: "232"
branch: "slice/232"
completed: "2026-04-27T14:20:00.000Z"
tokens_in: 42000
tokens_out: 4800
elapsed_ms: 360000
estimated_human_hours: 0.5
compaction_occurred: false
---

## Summary

Polished the Active Build panel in `dashboard/lcars-dashboard.html` to match Ziyal's Sprint 5 spec:

### Idle redesign
- Centered clock glyph (⏱) as visual anchor
- "Standing by" as primary heading
- "Picks up the next approved slice automatically" as explanatory copy
- Dynamic staged-count hint pill showing `N staged` (or `0 staged` if queue empty), populated from existing `stagedItemCount`
- Error state still overrides idle with failure details (glyph hidden, pill hidden)

### Running state — flex bottom-anchor
- Wrapped footer and paused-footer in `.active-slice-progress-block` container
- Applied `margin-top: auto` on the progress block so it anchors to the panel base
- Flex chain: `.panel-hero` (flex) → `.active-slice` (flex:1, flex-column) → `.active-slice-progress-block` (margin-top:auto)
- Works correctly regardless of slice title/description length

## Acceptance criteria

- [x] AC1 — Idle: clock glyph, "Standing by", explanatory sentence, staged-count pill with live count
- [x] AC2 — Running: slice info at top, progress block pinned to bottom
- [x] AC3 — Flex chain applied: short and long descriptions both anchor progress block at base
- [x] AC4 — No layout regression on other panels (Pipeline, Queue, History untouched)
- [x] AC5 — Changes only in `dashboard/lcars-dashboard.html`
- [x] AC6 — Visual match: idle scene shows centered glyph + standing by; running scene anchors controls to bottom

## Files changed

- `dashboard/lcars-dashboard.html` — CSS (idle styles, progress block, staged pill) + HTML (idle markup, progress block wrapper) + JS (idle state rendering logic)
