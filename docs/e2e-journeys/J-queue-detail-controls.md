---
id: J-queue-detail-controls
category: authoring-staging
status: draft
last_reviewed: 2026-06-06
---

# Manage a queued slice from the detail overlay

## What the user is trying to accomplish

Philipp opens a queued slice in the Ops Center detail overlay and makes a pre-dispatch decision: edit the markdown body, un-approve it back to staged, remove it from the queue, or return it to O'Brien as a staged amendment request.

This journey is separate from simple approve/reorder because it covers the frontmatter-preserving controls exposed after a slice is already approved but before Rom has picked it up.

## Preconditions

- Ops Center is running on a local dashboard server (`dashboard/server.js`)
- A slice exists in `bridge/queue/{id}-QUEUED.md` or `bridge/queue/{id}-PENDING.md`
- `bridge/queue-order.json` contains the slice ID
- `bridge/staged-order.json` exists or can be created
- `bridge/heartbeat.json` does not list this slice as `current_slice` unless the test is verifying race protection

## Steps

1. Philipp opens the queued slice row in the Queue panel
2. The detail overlay opens with Rendered and Source tabs
3. Philipp switches to Source, edits the markdown body, and clicks "Save edits"
4. The server preserves the existing frontmatter block and writes only the updated body to the slice file
5. Philipp may then choose one of three mutually exclusive queue actions:
   - "Un-approve" moves the slice back to `bridge/staged/{id}-STAGED.md`
   - "Return to O'Brien" moves the slice to `bridge/staged/{id}-NEEDS_APENDMENT.md` with an amendment note
   - "Remove from queue" archives the queued file into `bridge/trash/`
6. The Queue panel refreshes and the slice no longer appears as an approved queued row

## Expected outcomes

- Save edits preserves frontmatter exactly enough to retain `id`, `status`, ownership, priority, and dependency fields
- Un-approve writes `status: STAGED`, removes the ID from `queue-order.json`, appends the ID to `staged-order.json`, and emits `slice-unapproved`
- Return to O'Brien writes `status: NEEDS_APENDMENT`, records `apendment_note`, removes the ID from `queue-order.json`, appends the ID to `staged-order.json`, and emits `returned_to_stage`
- Remove from queue moves the queued markdown file to `bridge/trash/`, removes the ID from `queue-order.json`, and emits `slice-archived-from-queue`
- If `heartbeat.current_slice` equals the slice ID, destructive movement actions return 409 and leave the queued file in place
- User-facing UI uses O'Brien/staged-return language for this path

## Known failure modes

- **Race with dispatch.** The orchestrator can pick up the slice between opening the modal and clicking an action. *Recovery:* The server returns 409; the UI should tell the operator to use the active build controls.
- **Save edits strips frontmatter.** If the frontmatter delimiter parser fails, the slice can lose routing metadata. *Recovery:* Reject the save with 400 rather than writing a malformed file.
- **Order file drift.** The slice file can move but remain in `queue-order.json`, causing stale ordering. *Recovery:* Update order files in the same handler and add regression coverage.
- **Wrong crew vocabulary.** The return action may use obsolete role wording. *Recovery:* User-facing text and new events must use O'Brien/staged-return language.

## Existing coverage

- `test/api-queue-content-return-to-stage.test.js` covers the HTTP save and return-to-stage paths against the dashboard server module
- `regression/authoring-staging/j-queue-detail-controls.test.js` covers the journey-level file, frontmatter, order, register, and race-protection contract
- `test/api-queue-remove*.test.js` covers queued removal success, missing ID, and active-slice 409 variants
- `test/slice-detail-unapprove-button.test.js` covers queued-modal unapprove wiring

## Sources

- `dashboard/lcars-dashboard.html` — queued detail overlay controls
- `dashboard/server.js` — queue content, return-to-stage, unapprove, and remove endpoints
- `docs/contracts/slice-pipeline.md` — state-to-suffix mapping
- `docs/contracts/slice-lifecycle.md` — STAGED, QUEUED, and amendment states

## Open questions

- Should "Return to O'Brien" accept a required operator note, or is the default note enough?
- Should return-to-stage and unapprove share a single endpoint with an explicit reason, or remain separate for audit clarity?
- Should the UI show the previous queue position after an un-approved slice is returned to staged?
