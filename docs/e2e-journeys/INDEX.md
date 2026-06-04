# E2E Journey Catalog — Index

**Phase 1 scouting output.** Canonical catalog of end-to-end user journeys through the Liberation of Bajor orchestration platform.

Produced via the live Bashir non-gate invocation path (slice 304). Reconciled against the prior scouting output on branch `bashir/phase-1-catalog` (authored outside the pipeline, stale relative to main). All status fields are `draft`; Philipp's sign-off elevates them after Phase 1 acceptance.

---

## Journeys by category

### Authoring & Staging (2 journeys)

| ID | Title | Status | Sources |
|---|---|---|---|
| **J-stage-and-watch-slice** | Stage a new slice and watch it in Ops | draft | `slice-pipeline.md`, `slice-lifecycle.md`, `DASHBOARD-REDESIGN-SPEC.md`, `new-slice.js` |
| **J-approve-and-reorder-queue** | Approve a staged slice and reorder the queue | draft | `slice-pipeline.md`, `slice-lifecycle.md`, `DASHBOARD-REDESIGN-SPEC.md` |

### Dispatch & Execution (2 journeys)

| ID | Title | Status | Sources |
|---|---|---|---|
| **J-rom-completes-slice** | Rom completes a slice and transitions to code review | draft | `slice-format.md`, `slice-lifecycle.md`, `slice-pipeline.md`, `DASHBOARD-REDESIGN-SPEC.md` |
| **J-slice-broken-fast-path** | Rom judges the slice broken and escalates to O'Brien | draft | `slice-pipeline.md §10`, `slice-lifecycle.md`, `slice-format.md` |

### Review & Verdict (3 journeys)

| ID | Title | Status | Sources |
|---|---|---|---|
| **J-nog-accepts-slice** | Nog reviews and accepts a slice | draft | `slice-pipeline.md`, `slice-lifecycle.md`, `slice-format.md`, `DASHBOARD-REDESIGN-SPEC.md` |
| **J-nog-rejects-slice-round-2** | Nog rejects a slice and Rom reworks it (Round 2) | draft | `slice-pipeline.md §9`, `slice-lifecycle.md`, `slice-format.md`, `DASHBOARD-REDESIGN-SPEC.md` |
| **J-nog-max-rounds-escalation** | Nog exhausts the round cap and escalates to O'Brien | draft | `slice-pipeline.md §9`, `slice-lifecycle.md` |

### Gate & Merge (2 journeys)

| ID | Title | Status | Sources |
|---|---|---|---|
| **J-merge-button-pass** | Press merge button and gate passes | draft | `RUNBOOK-BASHIR-GATE.md`, `slice-pipeline.md`, `slice-lifecycle.md`, `branch-state.json`, `DASHBOARD-REDESIGN-SPEC.md` |
| **J-gate-fail-retry** | Gate fails, Bashir flags failed AC, user commissions hotfix and retries | draft | `RUNBOOK-BASHIR-GATE.md`, `branch-state.json`, `slice-pipeline.md`, `DASHBOARD-REDESIGN-SPEC.md` |

### Recovery (2 journeys)

| ID | Title | Status | Sources |
|---|---|---|---|
| **J-recovery-mutex-orphan** | Recover from orphaned gate mutex (Bashir crash mid-gate) | draft | `RUNBOOK-BASHIR-GATE.md §F1/F2`, `branch-state.json`, `state-doctor.js` |
| **J-pipeline-pause-resume** | Pause and resume the dispatch pipeline | draft | `RUNBOOK-BASHIR-GATE.md §F12`, `bridge/.pipeline-paused`, `state-doctor.js` |

### Observability (2 journeys)

| ID | Title | Status | Sources |
|---|---|---|---|
| **J-watch-slice-live-log** | Watch a slice's live log while Rom is implementing | draft | `DASHBOARD-REDESIGN-SPEC.md`, `bridge/logs/`, `orchestrator.js` |
| **J-inspect-slice-history** | Inspect a merged slice's history and artifacts | draft | `DASHBOARD-REDESIGN-SPEC.md`, `slice-format.md`, `slice-lifecycle.md`, `slice-pipeline.md` |

### Direct Controls (1 journey)

| ID | Title | Status | Sources |
|---|---|---|---|
| **J-direct-controls-ops-ui** | Direct controls: every Ops UI button, toggle, and interaction | draft | `DASHBOARD-REDESIGN-SPEC.md`, `lcars-dashboard.html`, `RUNBOOK-BASHIR-GATE.md` |

---

## Totals

- **Categories covered:** 7 / 7 — all mandatory categories have at least 1 journey
- **Total journeys:** 14
- **Status breakdown:**
  - draft: 14
  - reviewed: 0
  - signed-off: 0

---

## Reconciliation summary (vs. prior `bashir/phase-1-catalog` output)

The prior catalog had 11 journeys. This version has 14 (+3 new). Key changes:

**New journeys added:**
- `J-slice-broken-fast-path` — Rom escalation path to O'Brien; documented in `slice-pipeline.md §10` but absent from prior catalog
- `J-nog-max-rounds-escalation` — 6th Nog rejection routes to O'Brien; in `slice-pipeline.md §9`; absent from prior catalog
- `J-pipeline-pause-resume` — `bridge/.pipeline-paused` flag; in runbook §F12; was referenced but not spec'd

**Prior journeys corrected:**
- All Ziyal spec source citations updated: `HANDOFF-OPS-REDESIGN-SPEC-FROM-ZIYAL.md` does not exist on current main; corrected to `dashboard/DASHBOARD-REDESIGN-SPEC.md`
- Three architecture ADRs (`LIFECYCLE-NAMES-ADR.md`, `NOG-GATE-ADR.md`, `BRANCHING-FOR-BASHIR-GATE-ADR.md`) do not exist on current main; flagged as open questions in every spec that referenced them
- J-rom-completes-slice: clarified IN_REVIEW state (DONE→IN_REVIEW is Nog spawn trigger, not just DONE)
- J-gate-fail-retry: corrected post-abort state from IDLE/ONLINE to ACCUMULATING per runbook
- J-recovery-mutex-orphan: corrected heartbeat staleness threshold from 45–90s to 120s per runbook
- J-direct-controls-ops-ui: updated panel class names to match current HTML (`.topo-panel`, `.panel-hero`, `.panel-postbuild`, `.panel-queue`, `.panel-history`, `.gate-health-section`)
- All `last_reviewed` dates updated to 2026-05-21

---

## Coverage validation

Per Phase 1 AC #3–#5:

- [x] **At least one journey per category:** All 7 categories represented
- [x] **User-facing effect of historical slices:** Sampled DONE reports (279, 290, 298, 299, 303) — authoring, dispatch, review, recovery, observability all covered
- [x] **Ops panels from Ziyal spec:**
  - Header bar: J-direct-controls-ops-ui
  - Branch Topology panel (`.topo-panel`): J-merge-button-pass, J-gate-fail-retry, J-direct-controls-ops-ui
  - Active Build panel (`.panel-hero`): J-rom-completes-slice, J-watch-slice-live-log, J-direct-controls-ops-ui
  - Post-Build pipeline panel (`.panel-postbuild`): J-nog-accepts-slice, J-nog-rejects-slice-round-2, J-direct-controls-ops-ui
  - Gate Health section (`.gate-health-section`): J-merge-button-pass, J-gate-fail-retry, J-direct-controls-ops-ui
  - Queue panel (`.panel-queue`): J-stage-and-watch-slice, J-approve-and-reorder-queue, J-direct-controls-ops-ui
  - Slice History panel (`.panel-history`): J-inspect-slice-history, J-direct-controls-ops-ui

---

## Open questions — summary

Cross-journey open questions routed to role inboxes in the Phase 1 closing memo (`roles/dax/inbox/RESPONSE-PHASE-1-SCOUTING-FROM-BASHIR.md`).

Key systemic gaps:
1. Three architecture ADRs referenced by prior catalog do not exist on current main — route to Dax
2. Ziyal's OPS redesign spec location differs from what Dax's brief described — route to Dax/Ziyal
3. Heartbeat staleness threshold discrepancy (120s in runbook vs. 90s in slice-304 prompt) — route to Worf
4. Several gate events and register event names need confirmation (`gate-abort` vs. `GATE_ABORTED`, `regression-fail`, etc.) — route to Worf
