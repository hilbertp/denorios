---
id: J-inspect-slice-history
category: observability
status: draft
last_reviewed: 2026-05-21
---

# Inspect a merged slice's history and artifacts

## What the user is trying to accomplish

A slice has been merged to main and is in the ARCHIVED state. Philipp wants to review what was done: the original ACs, Rom's DONE report, Nog's review verdict, and the estimated cost. Philipp clicks the slice in the History panel to expand its detail view.

## Preconditions

- A slice is in ARCHIVED state (`bridge/queue/{id}-ARCHIVED.md` exists with all appended blocks)
- The slice appears in the Slice History panel (`.panel-history`, `.slice-history`)
- All artifacts are readable: Rom DONE report block, Nog Review block, original slice body

## Steps

1. The History panel shows a row for the archived slice: ID, title, outcome (ACCEPTED), cost estimate, duration
2. Philipp clicks the row to expand it (or clicks the expand chevron)
3. The chevron rotates and the row expands to reveal a detail view with tabs: "Slice body", "Rom report", "Nog verdict"
4. The default tab shows the original slice body (goal, ACs, scope)
5. Philipp clicks "Rom report" tab — shows the appended `## Rom DONE Report — Round N` block
6. Philipp clicks "Nog verdict" tab — shows the appended `## Nog Review — Round N` block with verdict and reason
7. Philipp can scroll within each tab independently
8. The slice's cost and duration are displayed in the row header (derived from frontmatter fields: tokens_in, tokens_out, elapsed_ms)

## Expected outcomes

- Slice row expands to show a detail view with multiple tabs
- Each tab has its own data source: frontmatter+body for "Slice body"; appended blocks for "Rom report" and "Nog verdict"
- Tab switching is instant (data is pre-loaded, no async fetch required)
- If a tab has no data (e.g., slice was accepted on Round 1 with no rejection history), placeholder text is shown
- Cost and duration fields are real values from frontmatter (not hardcoded)
- Scrolling within one tab does not affect others

## Known failure modes

- **Tab data is missing or malformed.** A DONE report block may be absent or the Nog Review heading may not match the expected format. *Recovery:* Show a per-tab placeholder; the other tabs should remain functional. If data is genuinely missing, that's a data-integrity issue — escalate to O'Brien.
- **History panel does not show the archived slice.** The dashboard server may not be reading `bridge/queue/` for ARCHIVED files, or the server is filtering by state. *Recovery:* Check `dashboard/server.js` for the history data source. Verify that the `-ARCHIVED.md` file exists and is readable.
- **Cost fields show zero or null.** The DONE report frontmatter may have been submitted with zero metrics. *Recovery:* This is a data quality issue. Zero metrics cause an ERROR status per the DONE report spec; check if the report was accepted or if there's an outstanding error.

## Sources

- `docs/contracts/slice-pipeline.md` §4 — ARCHIVED state definition, file location (`bridge/queue/{id}-ARCHIVED.md`)
- `docs/contracts/slice-format.md` — DONE Report block format, Nog Review block format; frontmatter token/cost fields
- `docs/contracts/slice-lifecycle.md` — ARCHIVED as terminal state; read-only after archive
- `dashboard/DASHBOARD-REDESIGN-SPEC.md` — Slice History table: columns (title, result, apendments, duration, stages); expanded row with tabs; cost fallback

## Open questions

- Is a "Diff" tab present in the current implementation? The prior scouting output described a 4-tab layout including "Diff (N files)", but the DASHBOARD-REDESIGN-SPEC.md does not describe a diff tab explicitly. The spec mentions "Stages" as a column in the history table. Route to Ziyal.
- Does the "Slice body" tab show frontmatter (with token/cost metadata) or only the narrative markdown body sections?
- If Rom worked multiple rounds, which DONE Report is shown? The most recent (Round N)? Or are all rounds available? Should Nog's intermediate rejections be visible?
- Can Philipp export the history detail as markdown for external documentation? No export button is described in the spec.
- Is `bridge/queue/{id}-ARCHIVED.md` the actual location, or does the file move to a different archive directory after some retention period?
