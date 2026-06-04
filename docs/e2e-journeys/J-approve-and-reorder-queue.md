---
id: J-approve-and-reorder-queue
category: authoring-staging
status: draft
last_reviewed: 2026-05-21
---

# Approve a staged slice and reorder the queue

## What the user is trying to accomplish

Philipp reviews a staged slice in the Ops Center, decides to approve it into the execution queue, and optionally reorders approved slices by dragging them so that Rom picks up work in the right priority order.

## Preconditions

- One or more slices exist in the staged section of the Queue panel (`bridge/staged/{id}-STAGED.md` files present)
- Philipp is viewing the Ops Center dashboard
- The approved-queue section may already have other approved slices
- No drag operation is currently in progress

## Steps

1. Philipp clicks a staged row to expand it and review the full slice body
2. Philipp reads the goal, ACs, and estimated scope
3. Philipp clicks the "Approve" button in the expanded row's action group
4. The Ops Center server receives the `POST /approve` request and writes `bridge/queue/{id}-QUEUED.md` (atomic move from staged/ to queue/)
5. The server emits a `HUMAN_APPROVAL` event to `bridge/register.jsonl`
6. The slice row animates from the staged section into the approved-queue section
7. The approved-queue section now contains the newly approved slice as a draggable row
8. If reordering is desired: Philipp grabs the drag handle and drags the slice up or down within the approved-queue section
9. On mouse release, the new order is persisted to `bridge/queue-order.json` (atomic write)
10. All queue rows animate to their new positions

## Expected outcomes

- `bridge/staged/{id}-STAGED.md` is gone; `bridge/queue/{id}-QUEUED.md` exists
- Register contains a `HUMAN_APPROVAL` event with the slice ID
- Slice appears in the approved-queue section with a drag handle visible
- `bridge/queue-order.json` is updated atomically with the new priority order
- Orchestrator's next pickup cycle consults `queue-order.json` and dispatches in that order
- Dragged row opacity reduces to 0.6 during drag; drop target shows a dashed top border
- On drop, the row snaps to its final position with a short ease animation
- If the queue was empty before approval, the orchestrator may pick up this slice immediately on its next poll

## Known failure modes

- **Approve does not respond.** The server may not have the approve route wired, or the dashboard is serving stale JS. *Recovery:* Check browser console for network errors. Verify `dashboard/server.js` is running and the `/approve` route exists.
- **Drag-and-drop does not work.** The drag handle may not have pointer-events enabled, or a conflicting event listener intercepts the drag. *Recovery:* Check that the drag handle is visible and cursor changes to `grabbing` on hover. Check browser console for JS errors.
- **`queue-order.json` write fails silently.** The file may not be writable or the atomic write helper errored. *Recovery:* Check file permissions on `bridge/queue-order.json`. Check register for any ERROR events.
- **Reorder persists but orchestrator ignores it.** The orchestrator's pickup loop may not be consulting `queue-order.json` on each iteration. *Recovery:* Restart the orchestrator to force a fresh read.

## Sources

- `docs/contracts/slice-pipeline.md` §4–§5 — state-to-suffix mapping and STAGED→QUEUED transition mechanics
- `docs/contracts/slice-lifecycle.md` — QUEUED state definition, Philipp as the approving actor
- `dashboard/DASHBOARD-REDESIGN-SPEC.md` — Queue panel: staged section, approved-queue rows, drag-and-drop behavior

## Open questions

- What happens if Philipp approves a slice while a drag operation is in progress on another slice? Is the drag aborted or completed first?
- What is the orchestrator's poll interval for picking up newly approved slices? Is there a visual countdown (poll-ring or similar) in the dashboard?
- If `queue-order.json` write fails, should the row snap back to its original position visually with an error toast, or stay in the dropped position?
- Is there a "Reject" action on staged rows? The direct-controls spec mentions a reject button, but what does rejection do — does it delete the staged file or move it somewhere?
