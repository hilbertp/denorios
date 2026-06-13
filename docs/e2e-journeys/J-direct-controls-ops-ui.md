---
id: J-direct-controls-ops-ui
category: direct-controls
status: draft
last_reviewed: 2026-05-21
---

# Direct controls: every Ops UI button, toggle, and interaction

## What the user is trying to accomplish

Reference catalog of every clickable, draggable, or keyboard-accessible surface in the Ops Center dashboard. This journey is a listing, not a typical user flow.

## Preconditions

- Ops Center is running (`dashboard/server.js` active, browser open to the dashboard URL)
- All panels are visible (or collapsed but available to toggle)
- A functional orchestrator is running and returning data to the server API

## Controls — per panel

### Header bar

| Control | Action | Expected behavior |
|---------|--------|-------------------|
| System pulse pill | Hover | Tooltip: orchestrator state and heartbeat age |
| System pulse pill | View | Shows NOMINAL (green) / IDLE (amber) / DOWN (red) derived from `bridge/heartbeat.json` |
| Clock | View | Displays server time in HH:MM:SS format (24-hour) |

### Branch Topology panel (`.topo-panel`)

| Control | Action | Expected behavior |
|---------|--------|-------------------|
| Collapse toggle (chevron, `.topo-panel-head`) | Click | Toggle `.topo-collapsed` state; panel body hides, compact view shows |
| Merge to main button (`.merge-btn`) | Click | Emit gate-start; progress widget replaces button; gate.status → GATE_RUNNING |
| Merge button (disabled) | Hover | `cursor: not-allowed`; button does not respond |
| Gate step cards (`.gate-step-card`) | View | Three cards during gate run: "Tests updated", "Regression pass", "Merge"; each transitions pending → active → done / error |
| Gate fail actions (`.gate-fail-actions`) | View | Appear when gate step 2 fails; includes Abort button |
| Abort button | Click | POST to gate-abort endpoint; gate.status → ACCUMULATING |
| RR pill | View/Hover | Shows risk percentage; tooltip provides formula breakdown |
| Gate status pill (`.gate-status-pill`) | View | Shows GATE_RUNNING (warn color) or GATE_FAILED (error color) during gate activity |

### Active Build panel (`.panel-hero` / `.active-slice`)

| Control | Action | Expected behavior |
|---------|--------|-------------------|
| Panel | View | Shows active slice title, elapsed time, current owner badge |
| "View live log" button | Click | Open log view with streaming output from Rom's process |
| Log view close button | Click | Close log view |
| Panel (idle state) | View | Shows "NO ACTIVE SLICE" with last completed slice info |

### Post-Build pipeline panel (`.panel-postbuild` / `.postbuild-panel`)

| Control | Action | Expected behavior |
|---------|--------|-------------------|
| Panel | View | Shows Nog's review status when a slice is IN_REVIEW; gate checklist (`.nog-gate-grid`) when Nog is active |
| Panel (idle state) | View | Shows standby state; no interaction |

### Gate Health section (`.gate-health-section` / `.gate-health-panel`)

| Control | Action | Expected behavior |
|---------|--------|-------------------|
| Gate health pill (`.gate-health-pill`) | View | Color-coded gate status: green (ok), yellow (warn), red (error) |
| Gate events list (`.gate-events-list`) | View | Shows recent gate events from register; read-only |

### Queue panel (`.panel-queue` / `.queue-panel`)

| Control | Action | Expected behavior |
|---------|--------|-------------------|
| Queue panel header | View | Shows "Queue" label; shows "Staged" section and approved-queue section |
| Staged section header | View | Shows "Staged — awaiting approval" label |
| Staged row | Click (row body) | Toggle `.expanded` state; chevron rotates; detail block slides open |
| Approve button (staged rows) | Click | Move slice from staged → queue; server writes `{id}-QUEUED.md`; emit `HUMAN_APPROVAL` event |
| Reject button (staged rows) | Click | Show inline confirm dialog |
| Confirm reject | Click | Archive or remove the staged slice; remove row with animation |
| Cancel reject | Click | Close dialog; row remains |
| Approved-queue row | Click (row body) | Toggle `.expanded` state; show detail body |
| Drag handle (6-dot grid, approved rows only) | Grab and drag | Begin drag; row opacity → 0.6; drop target shows dashed border; cursor → `grabbing` |
| Drag handle | Release | Row snaps to final position; `bridge/queue-order.json` updated atomically |
| Row expand chevron | Click | Toggle `.expanded` state |
| Detail tabs (in expanded body) | Click | Switch active tab; show content for selected tab |
| Save edits (queued detail) | Click | Preserve frontmatter and write updated markdown body |
| Return to O'Brien (queued detail) | Click | Move queued slice to `staged/{id}-NEEDS_APENDMENT.md`; emit `returned_to_stage` |
| Un-approve (queued detail) | Click | Move queued slice back to `staged/{id}-STAGED.md`; emit `slice-unapproved` |
| Remove from queue (queued detail) | Click | Move queued file to `bridge/trash/`; emit `slice-archived-from-queue` |

### Slice History panel (`.panel-history` / `.slice-history`)

| Control | Action | Expected behavior |
|---------|--------|-------------------|
| History row | Click (row body) | Toggle `.expanded` state; chevron rotates; detail view opens |
| Expand chevron | Click | Same as row click |
| Detail tabs | Click | Switch active tab (Slice body / Rom report / Nog verdict) |

### Universal

| Control | Action | Expected behavior |
|---------|--------|-------------------|
| Any `.btn` | Hover | Background transitions to hover state; 120ms ease |
| Any `.btn` | Focus (keyboard Tab) | Outline appears |
| Any `.btn` | Click (active) | Translate down 1px; 80ms fast animation |
| Any `.btn` (disabled) | Hover | No state change; `cursor: not-allowed` |
| Keyboard: `Tab` / `Shift+Tab` | Focus navigation | Navigate through interactive elements in document order |
| Keyboard: `Escape` | Close modal/expanded row | Dismiss any open modal; collapse expanded row |
| Keyboard: `Enter` on row | Toggle expanded | Same as click on row |

## Known failure modes and edge cases

- **Merge button disabled state not visually obvious.** Users may not realize it is not clickable. *Recommendation:* Add a tooltip explaining why (gate running, no accepted slices, etc.).
- **Drag handle is hard to grab on touch devices.** The 6-dot grid may have insufficient touch target size. *Recommendation:* Expand touch target.
- **Approve button is disabled while gate is running.** New approvals cannot land during a gate run. *Recommendation:* Tooltip on disabled Approve: "Cannot approve while gate is running."

## Sources

- `dashboard/DASHBOARD-REDESIGN-SPEC.md` — full panel spec, interaction patterns, motion primitives
- `dashboard/lcars-dashboard.html` — actual implementation of panels (`.panel-hero`, `.panel-postbuild`, `.panel-queue`, `.panel-history`, `.topo-panel`, `.gate-health-section`)
- `docs/runbooks/RUNBOOK-BASHIR-GATE.md` — gate controls (abort button, pause flag)

## Open questions

- Is there a "Pause dispatch" toggle in the Ops UI? The runbook describes `bridge/.pipeline-paused` as a touch-file, but no UI toggle is described in the current spec. Route to Ziyal.
- Are there keyboard shortcuts beyond Tab, Escape, and Enter? (e.g., `Ctrl+M` for "Merge to main") No shortcuts beyond these three are documented.
- Can users filter or search the Queue panel (e.g., by slice ID or status)? Not documented.
- Does the RR dial support click-through to a detailed breakdown view, or is it tooltip-only?
- The Gate Health section (`.gate-health-section`) appears to be a separate panel from the Branch Topology panel. Is it always visible, or only during gate activity?
- Is the `staged-panel` CSS class (`.staged-panel`) a separate panel element or a section within the Queue panel? The HTML has both `.queue-panel` and `.staged-panel` CSS rules.
