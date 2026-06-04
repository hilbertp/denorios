---
id: J-pipeline-pause-resume
category: recovery
status: draft
last_reviewed: 2026-05-21
---

# Pause and resume the dispatch pipeline

## What the user is trying to accomplish

An operator needs to temporarily stop the orchestrator from picking up new QUEUED slices — for example, to investigate an error, reconfigure the system, or wait for a human decision before more work proceeds. The operator sets the pause flag; the orchestrator stops dispatching. When ready, the operator removes the flag and dispatch resumes.

## Preconditions

- The orchestrator is running
- No slice is currently IN_PROGRESS (or one is, and the operator wants to pause after it completes, not mid-execution)
- `bridge/.pipeline-paused` does not currently exist (pipeline is running normally)

## Steps

**To pause:**
1. Operator identifies that dispatch should halt (e.g., an error was detected, a reconfiguration is needed)
2. Operator sets the pause flag — either:
   a. Via the Ops Center UI (if a "pause dispatch" button exists — see Open questions), or
   b. Directly on the filesystem: `touch bridge/.pipeline-paused`
3. The orchestrator's next poll cycle checks for the presence of `bridge/.pipeline-paused`
4. The orchestrator skips the dispatch step for this cycle and all subsequent cycles until the flag is removed
5. The Ops dashboard surfaces the paused state via `state-doctor.js` output ("Pause flag: PRESENT") or via a dashboard indicator (if wired)
6. Any slice currently IN_PROGRESS continues to completion — the pause does not abort active work, only prevents new pickups

**To resume:**
7. Operator resolves the underlying issue (error investigated, reconfiguration complete, human decision made)
8. Operator removes the pause flag — either:
   a. Via the Ops Center UI, or
   b. Directly: `rm bridge/.pipeline-paused`
9. The orchestrator's next poll cycle detects the flag is absent and resumes normal dispatch
10. The next QUEUED slice is picked up and Rom is spawned

## Expected outcomes

- While `bridge/.pipeline-paused` is present: no new slices are dispatched regardless of QUEUED count
- While paused: IN_PROGRESS slices continue to completion; QUEUED slices accumulate without being picked up
- `node bridge/state-doctor.js` shows "Pause flag: PRESENT" while paused
- After flag removal: first QUEUED slice is dispatched within one poll cycle
- No events are emitted to the register for the pause/resume actions (it is a file-presence signal only)

## Known failure modes

- **Pause flag set but dispatch continues.** The orchestrator may not check the flag on every cycle, or a race condition exists between flag creation and the current dispatch check. *Recovery:* Verify the flag exists on disk (`ls bridge/.pipeline-paused`). Wait one full poll cycle.
- **Pause flag persists after operator forgets to remove it.** The pipeline remains paused indefinitely. *Recovery:* `rm bridge/.pipeline-paused`. `state-doctor.js` will surface this anomaly if run.
- **Slices accumulate beyond capacity during pause.** A very long pause with many incoming QUEUED slices could overwhelm the queue. *Recovery:* Monitor QUEUED count via state-doctor. Resume promptly.
- **Pause flag does not stop a Bashir gate run in progress.** The pause flag is for dispatch (new slice pickups). It does not abort an active gate run. *Recovery:* To halt an active gate, use the Abort button or follow F7 recovery in the runbook.

## Sources

- `docs/runbooks/RUNBOOK-BASHIR-GATE.md` — §F12 (pause flag: set and recovery), §F7 option B (touch bridge/.pipeline-paused as a gate-abort alternative)
- `bridge/orchestrator.js` — pause flag check location (~`bridge/.pipeline-paused` presence detection)
- `bridge/state-doctor.js` — "Pause flag: PRESENT/absent" output

## Open questions

- Is there a UI button in the Ops Center to set/remove the pause flag? The direct-controls spec (J-direct-controls-ops-ui) references `bridge/.pipeline-paused` but does not describe a toggle control. Route to Ziyal.
- Does the orchestrator emit any register event when it detects the pause flag and skips dispatch? Or is it a silent operational hold?
- Is there a maximum recommended pause duration? No limit is documented; long pauses may cause QUEUED slices to pile up.
- Does the pause flag interact with the gate run? The runbook uses it as an option to indirectly abort a gate (set pause, then kill Bashir) — the interaction may be more complex than a simple dispatch-halt.
