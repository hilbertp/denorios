---
id: "262"
title: "F-Bash-2 — Branch Topology panel (no-op merge button)"
from: rom
to: nog
status: DONE
slice_id: "262"
branch: "slice/262"
completed: "2026-04-29T16:05:00.000Z"
tokens_in: 85000
tokens_out: 12000
elapsed_ms: 720000
estimated_human_hours: 3.5
compaction_occurred: false
---

## Summary

Implemented the Branch Topology panel as the first panel in the Ops dashboard, above the existing 4-panel grid. The panel renders dev/main branch tracks as an inline SVG, with commit dots, annotations, a HEAD badge, and a merge button (visual no-op for this slice).

## What was done

### 1. Server route — `GET /api/branch-state`
Added to `dashboard/server.js`. Reads and returns parsed `bridge/state/branch-state.json` with `Cache-Control: no-store`. Returns 503 with `{"error":"branch-state-unavailable"}` if the file is missing or corrupt.

### 2. Branch Topology panel HTML + CSS
- New `.topo-row` container inserted above `.ops-grid` in `lcars-dashboard.html`
- Panel structure: `.topo-panel` > `.topo-panel-head` (title + collapse toggle) > `.topo-panel-body` (SVG + footer) > `.topo-mini` (collapsed strip)
- All colors reference tokens from `tokens.css` (`--branch-main`, `--branch-dev`, `--rom`, `--ok`, `--warn`, `--err`, `--ink-4`, etc.)
- Only `#fff` appears in JS SVG literals (white on SVG check marks and badge text — not representable as CSS custom properties in inline SVG attributes)

### 3. SVG topology graph
- `viewBox="0 0 920 140"`, `min-width: 920px`, parent has `overflow-x: auto`
- Main track at y=52, dev track at y=92
- Commit dots: r=6 regular, r=7.5 for merge (with white check) and HEAD (with badge)
- HEAD badge: 40x14 rect in `--rom` color with white "HEAD" text
- Annotations: slice ID above dev dots, 7-char hash below, main hash above main dot
- Empty dev state: main dot only, dashed dev continuation line
- Merge dot: rendered at rightmost main position when `last_merge` is non-null
- SVG has `role="img"` and dynamic `aria-label`. Each commit dot has a `<title>` element.

### 4. Topology footer
- Left: "N commits ahead of main" with bold count
- Right: Merge button (IDLE/ACCUMULATING/null) or gate status pill (GATE_RUNNING=warn, GATE_FAILED=err, GATE_ABORTED=warn)
- Merge button disabled when commits_ahead_of_main === 0
- Button click logs `"gate-start placeholder — wired in slice 263"` and does nothing else
- `aria-label="Merge dev to main via Bashir gate"`

### 5. Collapsed state
- Collapse toggle in panel head rotates chevron -90deg via `--motion-slow`
- Collapsed: `.topo-panel-body` hidden, `.topo-mini` shown with mini SVG glyph + stats + gate pill
- State persisted via `localStorage` key `ops:topo-collapsed`

### 6. Data binding
- `fetchBranchState()` fetches `/api/branch-state` and renders the panel
- Polls every 5 seconds via `setInterval`
- Error/503 state renders "Branch state unavailable" in footer
- No flicker — full re-render on each poll (panel is lightweight SVG)

### 7. EventSource placeholder
- Console debug message logged: hook ready, no endpoint yet
- Will become operational when slice 263 adds event emission

### 8. Header pill TODO
- Added TODO comment referencing slice 263 for the BATCH GATE override in the health pill tri-state logic

## Files changed

- `dashboard/lcars-dashboard.html` — CSS + HTML panel + JS rendering logic
- `dashboard/server.js` — `GET /api/branch-state` route

## Acceptance criteria verification

1. Panel renders as first element above `.ops-grid` — full width ✓
2. Empty dev state: main dot, dashed dev line, "0 commits ahead", disabled merge button ✓
3. N>0 dev commits: dots at y=92, slice IDs at y=78ish, hashes at y=115, HEAD badge ✓
4. IDLE gate: active merge button shown ✓
5. GATE_RUNNING: warn pill shown, button hidden ✓
6. Merge button click: console.log only, no network/state changes ✓
7. Collapse toggle: hides body, shows mini, persists via localStorage ✓
8. Server route: 200 with JSON, 503 on missing file ✓
9. 5-second polling re-renders without flicker ✓
10. Existing panels unmodified — no CSS/HTML changes to ops-grid or its children ✓
