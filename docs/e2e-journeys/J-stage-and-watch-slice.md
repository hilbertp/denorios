---
id: J-stage-and-watch-slice
category: authoring-staging
status: draft
last_reviewed: 2026-05-21
---

# Stage a new slice and watch it in Ops

## What the user is trying to accomplish

O'Brien drafts a new slice (a unit of work with acceptance criteria), stages it into the queue via `bridge/new-slice.js`, and then opens the Ops Center dashboard to see the slice appear in the staged section of the Queue panel, ready for Philipp's approval.

## Preconditions

- Ops Center is running on a local dashboard server (`dashboard/server.js`)
- Bridge orchestrator is running (`bridge/orchestrator.js`)
- O'Brien has a working idea for a new slice (goal, ACs, estimated scope)
- The `bridge/staged/` directory exists and is writable

## Steps

1. O'Brien runs `bridge/new-slice.js` with the slice scope and title
2. `new-slice.js` validates required fields (id, title, goal, from, to, priority, created, status), assigns the next sequential ID, and writes the file to `bridge/staged/{id}-STAGED.md`
3. The CLI outputs the new slice file path
4. O'Brien opens the Ops Center dashboard in a browser (or refreshes if already open)
5. The Queue panel's staged section updates to show the new slice (labeled "Staged — awaiting your approval")
6. The new slice row displays: slice ID, title, and an Approve button
7. The row is expandable to show the full slice body (goal, ACs, tasks, scope)
8. The Branch Topology panel (`.topo-panel`) is unaffected — dev branch remains unchanged; no commits ahead yet

## Expected outcomes

- Slice file exists at `bridge/staged/{id}-STAGED.md` with valid frontmatter (status: STAGED) and a complete markdown body
- Slice appears in the staged section of the Queue panel within seconds of creation
- Slice row is clickable/expandable to show the full body
- Approve button is visible and enabled in the row's action group
- Register (`bridge/register.jsonl`) contains no events for this slice yet (events start on approval)
- No network errors or timeout warnings in the browser console

## Known failure modes

- **Staging fails silently.** `bridge/staged/` may be write-protected or the orchestrator is not running. *Recovery:* Check file permissions on `bridge/staged/`. Verify the orchestrator is live via `bridge/heartbeat.json`. Re-run `new-slice.js`.
- **Dashboard does not refresh.** The server may not be watching the filesystem. *Recovery:* Hard refresh the browser. Check browser console for network errors. Verify `dashboard/server.js` is running.
- **Slice appears with truncated or malformed body.** The file may not have been fully written. *Recovery:* Check the file size of `bridge/staged/{id}-STAGED.md` and verify all required sections are present.
- **`new-slice.js` rejects the invocation.** Required fields are missing or malformed. *Recovery:* Read the error output and supply the missing fields. O'Brien never writes frontmatter by hand — always use the CLI.

## Sources

- `docs/contracts/slice-pipeline.md` §1–§3 — filesystem layout, file-naming, and frontmatter schema
- `docs/contracts/slice-lifecycle.md` — STAGED state definition and who moves the ticket
- `dashboard/DASHBOARD-REDESIGN-SPEC.md` — Queue panel: staged section, approval flow
- `bridge/new-slice.js` — actual CLI tool for slice creation

## Open questions

- What is the latency guarantee from "slice file written" to "Queue panel updates"? Is it event-driven or polling-based, and what is the poll interval?
- When multiple slices are staged in rapid succession, what is the ordering guarantee in the staged section? Is it file mtime, creation order, or alphabetical by ID?
- Does the dashboard persist scroll position / expansion state when the panel auto-updates, or does it reset to the top?
- Does `new-slice.js` have a `--dry-run` mode for validating a slice spec before committing it to disk?
