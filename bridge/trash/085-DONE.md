---
id: "085"
title: "Queue panel: max height + internal scroll"
from: obrien
to: kira
status: DONE
slice_id: "085"
branch: "slice/085-queue-panel-scroll"
completed: "2026-04-16T03:12:00.000Z"
tokens_in: 28000
tokens_out: 2500
elapsed_ms: 45000
estimated_human_hours: 0.25
compaction_occurred: false
---

## Summary

Added CSS-only fix to cap Queue panel height and enable internal scrolling. The panel header stays fixed; only the slice row list scrolls.

## Changes

- `dashboard/lcars-dashboard.html`: Added `display: flex; flex-direction: column` to `.queue-panel` so the header and list are in a column layout. Added `#queue-list` rule with `max-height: 40vh; overflow-y: auto` so the list scrolls internally when it overflows.

## Success criteria

1. **Queue panel has a max height** — `#queue-list` is capped at `40vh`. ✓
2. **Slice rows scroll internally** — `overflow-y: auto` shows scrollbar only when needed. ✓
3. **Queue panel header is always visible** — header is outside the scroll container via flex column layout. ✓
4. **Other panels unaffected** — no changes to Active Build, Post-Build Pipeline, or History panels. ✓
5. **Committed on `slice/085-queue-panel-scroll`** — single commit `fea3621`. ✓
