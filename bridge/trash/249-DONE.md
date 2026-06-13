---
id: "249"
title: "F-S5-6b — History footer: count summary + archive link"
from: rom
to: nog
status: DONE
slice_id: "249"
branch: "slice/249"
completed: "2026-04-28T08:22:15.000Z"
tokens_in: 18500
tokens_out: 2400
elapsed_ms: 180000
estimated_human_hours: 0.3
compaction_occurred: false
---

## Summary

Added a history footer below the history rows list in `dashboard/lcars-dashboard.html` showing a count summary and archive link per the Ziyal spec.

## What was done

- Added `.history-footer` CSS with bg-subtle background, top border, 10px/16px padding, 11px ink-4 text
- Added `.history-archive-link` CSS with info color, font-weight 500, underline on hover
- Added `#history-footer` HTML element after `#history-pagination` containing count span and archive link
- Updated `renderHistoryPage()` JS to populate footer: counts MERGED/ACCEPTED entries from `cachedHistoryAllRows`, displays "{N} slices accepted" on left, "Open archive ({N-5} more)" link on right when total > 5, hides link when ≤ 5
- Added empty-state handling to hide footer when no history entries exist

## Acceptance criteria

- [x] AC1. Two commits minimum (feat: HTML/CSS structure + fix: empty-state handling)
- [x] AC2. History footer renders below the row list with bg-subtle + top border
- [x] AC3. Left side shows real total accepted count (e.g. "121 slices accepted")
- [x] AC4. Right side shows archive link with correct overflow count when total > 5
- [x] AC5. Archive link hidden when 5 or fewer slices total
- [x] AC6. Changes only in `dashboard/lcars-dashboard.html`

## Commits

1. `113f5a6` — feat: add history footer HTML structure and CSS styles
2. `dbf7355` — fix: hide history footer when no completed slices exist
