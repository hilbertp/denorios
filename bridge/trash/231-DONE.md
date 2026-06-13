---
id: "231"
title: "F-S5-1 — Header pill collapse to orchestrator-only tri-state"
from: rom
to: nog
status: DONE
slice_id: "231"
branch: "slice/231"
completed: "2026-04-27T14:18:00.000Z"
tokens_in: 48000
tokens_out: 6500
elapsed_ms: 280000
estimated_human_hours: 0.75
compaction_occurred: false
---

## Summary

Collapsed the Ops header status area from a three-service indicator layout (Orchestrator · Server · Detector) to a single orchestrator-only tri-state health pill matching Ziyal's Sprint 5 redesign spec.

## Changes

All changes in `dashboard/lcars-dashboard.html`:

**CSS:**
- Removed `.header-status-dot` styles (unused server-up dot)
- Removed `#services-panel`, `.svc-sep`, `.service-row`, `.service-dot`, `.service-row-tooltip` styles
- Updated `.health-pill` to match reference design: 99px border-radius, 11px font, 600 weight, 0.02em letter-spacing
- Added `.health-pill-dot` with colored box-shadow per state (green/amber/red glow rings)
- Added `.health-pill.degraded .health-pill-dot` and `.health-pill.offline .health-pill-dot` shadow variants
- Updated `.health-pill-tooltip` to dark-mono style (#0f172a bg, nowrap, 0.18 opacity shadow)
- Added `.health-tooltip-meta` class for secondary tooltip text
- Removed dead selectors: `.health-tooltip-detail`, `.health-tooltip-sep`, `.health-tooltip-dot.active`, `.health-tooltip-dot.dim`

**HTML:**
- Replaced the `#services-panel` div (three service rows with separator dots) with a single `<span class="health-pill" id="ops-health-pill">` containing dot, label, and tooltip

**JavaScript (`updateServicesPanel`):**
- Tri-state logic: BATCH GATE (amber, `.degraded`) when orchestrator is paused; OFFLINE (red, `.offline`) when heartbeat >= 60s or absent; ONLINE (green, default) when heartbeat fresh
- Batch-gate detection checks `health.watcher.paused` (placeholder — not yet in heartbeat payload) and falls back to `isSlicePaused()` on the active slice
- Tooltip shows orchestrator status, heartbeat age, paused reason (when applicable), and processing/idle detail
- `serviceHealthDown` gate preserved for approve-button disabling

## Acceptance criteria

- [x] AC1: Single pill, no separate server-up dot or second indicator
- [x] AC2: ONLINE with green background when heartbeat fresh (< 60s)
- [x] AC3: BATCH GATE with amber background when paused/batch-gate
- [x] AC4: OFFLINE with red background when heartbeat stale (>= 60s) or absent
- [x] AC5: Hover tooltip in dark-mono style showing heartbeat age and paused reason
- [x] AC6: Old CSS selectors cleaned up — no dead selectors remain
- [x] AC7: All changes within `dashboard/lcars-dashboard.html`
- [x] AC8: Visual regression — pill reads ONLINE with fresh orchestrator heartbeat

## Notes

- **Batch-gate placeholder:** The heartbeat payload doesn't currently include a `paused` field. The pill checks `health.watcher.paused` (will be falsy until the watcher wires it) and also checks `isSlicePaused()` on the active slice as a fallback. A follow-up slice should add `paused` and `pausedReason` to the heartbeat/health API so the pill can detect batch-gate state independently of register events.
- **Test files:** `test/services-panel.test.js` and `test/host-health-detector.test.js` reference the old `svc-*` selectors. These tests will need updating in a follow-up slice (AC7 restricts changes to the dashboard file only).
