---
id: J-rom-completes-slice
category: dispatch-execution
status: draft
last_reviewed: 2026-05-21
---

# Rom completes a slice and transitions to code review

## What the user is trying to accomplish

Rom implements a slice in a worktree, writes a completion report appended to the slice file, and signals done. The orchestrator detects completion, moves the slice to IN_REVIEW, and spawns Nog immediately to evaluate the implementation.

## Preconditions

- A slice is in QUEUED state (`bridge/queue/{id}-QUEUED.md` exists)
- The orchestrator has picked up the slice and spawned Rom in a worktree at `/private/tmp/ds9-worktrees/{branch}/`
- The slice is now `bridge/queue/{id}-IN_PROGRESS.md` and the Active Build panel shows it as active
- Rom has been implementing the slice's ACs on the `slice/{id}-<slug>` branch

## Steps

1. Rom implements the ACs on the `slice/{id}-<slug>` branch, committing regularly in the worktree
2. Rom appends a DONE report block to the slice file: `## Rom DONE Report — Round 1` with summary of implementation, key changes, and any uncertainties
3. Rom commits the slice file update and any code changes on the branch
4. The orchestrator's watcher detects the completed DONE report block in the slice file
5. The orchestrator renames the slice file: `bridge/queue/{id}-IN_PROGRESS.md` → `bridge/queue/{id}-DONE.md` and emits a `DONE` event
6. Immediately after, the orchestrator renames again: `bridge/queue/{id}-DONE.md` → `bridge/queue/{id}-IN_REVIEW.md` and spawns Nog
7. The Active Build panel transitions: shows the slice as handed to Nog for review

## Expected outcomes

- Slice file contains the appended `## Rom DONE Report — Round 1` block with author timestamp and implementation summary
- Register contains a `DONE` event with the slice ID and round
- File suffix transitions IN_PROGRESS → DONE → IN_REVIEW in sequence
- Nog is spawned by the orchestrator with the slice body and diff
- Active Build panel no longer shows the slice as IN_PROGRESS; Post-Build panel shows Nog's lane active
- Rom's branch (`slice/{id}-<slug>`) remains in the worktree for Nog's diff review
- The orchestrator may pick up the next QUEUED slice in its next poll cycle (dispatch is not blocked by the Nog review)

## Known failure modes

- **Orchestrator does not detect the DONE report.** Rom may have written the block but the orchestrator's poll cycle hasn't fired. *Recovery:* Wait one poll cycle (default: 20 min inactivity timeout). Check `bridge/heartbeat.json` to verify orchestrator is alive.
- **DONE report is malformed.** Rom may have appended a block with missing required fields. *Recovery:* The orchestrator should be lenient on format. If parsing fails, check orchestrator logs.
- **Nog spawn fails.** The `claude -p` invocation may fail due to auth or quota. *Recovery:* Check orchestrator logs for the spawn error. An `ERROR` event is emitted to the register. Restart the orchestrator to retry.
- **Rom's branch has uncommitted work.** The DONE report is in the slice file but code changes aren't committed. *Recovery:* This is Rom's error — the slice should not be marked DONE until all work is committed.

## Sources

- `docs/contracts/slice-pipeline.md` §4–§5 — IN_PROGRESS→DONE→IN_REVIEW transition mechanics and actors
- `docs/contracts/slice-lifecycle.md` — DONE and IN_REVIEW state definitions
- `docs/contracts/slice-format.md` — DONE Report block format and required fields
- `dashboard/DASHBOARD-REDESIGN-SPEC.md` — Active Build panel, Post-Build panel visualization

## Open questions

- Is the IN_PROGRESS→DONE→IN_REVIEW transition atomic (single poll cycle) or does the slice actually sit in DONE state for a perceptible duration? The pipeline spec suggests Nog is spawned immediately on DONE detection, but the intermediate DONE state is observable on disk.
- Does the orchestrator validate the DONE block format before advancing to IN_REVIEW, or does it advance unconditionally and let Nog surface any problems?
- Is Rom's DONE block appended while Rom is still technically "active" on the slice, or after an explicit "release worktree" signal? If Rom can push more commits after appending DONE, does that invalidate Nog's review?
- What is the relationship between the `docs/contracts/slice-format.md` DONE Report block format and what Nog actually requires to run a review?
- `docs/architecture/LIFECYCLE-NAMES-ADR.md` is referenced in the prior scouting output but does not exist on current main. The canonical state names are in `docs/contracts/slice-lifecycle.md` and `docs/contracts/slice-pipeline.md`. If the ADR exists elsewhere or was never merged, this is a documentation gap to route to Dax.
